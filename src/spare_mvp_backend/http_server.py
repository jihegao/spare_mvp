"""Small standard-library HTTP facade for the contract-first backend API."""

from __future__ import annotations

import json
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
import sqlite3
import traceback
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.run_service import ACTIVE_FORMAL_MODEL_FAMILY
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


MAX_JSON_BODY_BYTES = 1024 * 1024
LEGACY_RUN_API_MIGRATION = {
    "docs": "docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md",
    "mapping": {
        "/api/simulation-runs": "/api/runs",
        "/api/simulation-runs/{run_id}": "/api/runs/{run_id}",
        "/api/simulation-runs/{run_id}/result": "/api/runs/{run_id}/result",
        "/api/simulation-runs/{run_id}/artifacts": "/api/runs/{run_id}/artifacts",
        "/api/simulation-runs/{run_id}/chain": "/api/runs/{run_id}/chain",
    },
}


class RetiredRouteError(Exception):
    def __init__(self, route: str, replacement: str) -> None:
        super().__init__(f"{route} is retired; use {replacement}")
        self.route = route
        self.replacement = replacement


def create_backend_server(
    address: tuple[str, int],
    *,
    repo_root: Path | str | None = None,
    database_path: Path | str = ":memory:",
    output_dir: Path | str | None = None,
) -> ThreadingHTTPServer:
    """Create a local HTTP server exposing the frontend `/api` contract."""
    root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
    artifact_dir = Path(output_dir).resolve() if output_dir else root / "runs" / "m3-0-http"
    database_target = str(database_path)
    connect_kwargs: dict[str, Any] = {}
    if database_target == ":memory:":
        database_target = f"file:spare_mvp_{uuid4().hex}?mode=memory&cache=shared"
        connect_kwargs["uri"] = True
    elif not database_target.startswith("file:"):
        Path(database_target).expanduser().parent.mkdir(parents=True, exist_ok=True)

    def open_connection() -> sqlite3.Connection:
        connection = sqlite3.connect(database_target, **connect_kwargs)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    anchor_connection = open_connection()
    initialize_database(anchor_connection)
    adapter = SimulationAdapter(root)

    class BackendRequestHandler(BaseHTTPRequestHandler):
        server_version = "SpareMvpBackend/0.1"

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._handle()

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._handle()

        def do_DELETE(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._handle()

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _handle(self) -> None:
            parsed_path = unquote(urlparse(self.path).path)
            if self.command == "GET" and not parsed_path.startswith("/api"):
                self._send_static(parsed_path)
                return
            request_connection = None
            try:
                request_connection = open_connection()
                self._request_api = BackendApi(
                    ContractRepository(request_connection),
                    adapter,
                    output_dir=artifact_dir,
                )
                payload = self._dispatch()
                if isinstance(payload, dict) and "__sse_stream__" in payload:
                    self._send_sse(200, payload["__sse_stream__"])
                elif isinstance(payload, dict) and "__file_download__" in payload:
                    self._send_file_download(200, payload["__file_download__"])
                else:
                    self._send_json(200, payload)
            except KeyError as exc:
                self._send_json(404, {"code": "not_found", "message": str(exc)})
            except BackendApiError as exc:
                status = 400
                if exc.code == "unauthorized":
                    status = 401
                elif exc.code == "forbidden":
                    status = 403
                elif exc.code == "run_deleted":
                    status = 410
                elif exc.code == "request_too_large":
                    status = 413
                self._send_json(status, {"code": exc.code, "message": str(exc), "details": exc.details})
            except RetiredRouteError as exc:
                self._send_json(
                    410,
                    {
                        "code": "legacy_run_api_retired",
                        "message": str(exc),
                        "details": {
                            "route": exc.route,
                            "replacement": exc.replacement,
                            "migration": LEGACY_RUN_API_MIGRATION,
                        },
                    },
                )
            except ValueError as exc:
                self._send_json(400, {"code": "bad_request", "message": str(exc)})
            except Exception as exc:  # pragma: no cover - defensive HTTP boundary
                traceback.print_exc()
                self._send_json(500, {"code": "internal_error", "message": str(exc)})
            finally:
                self._request_api = None
                if request_connection is not None:
                    request_connection.close()

        def _dispatch(self) -> dict[str, Any]:
            api = self._request_api
            path = urlparse(self.path).path
            if not path.startswith("/api"):
                raise KeyError(path)
            route = path[4:] or "/"
            decoded_route = unquote(route)
            parts = [unquote(part) for part in route.split("/") if part]
            if decoded_route == "/simulation-runs" or decoded_route.startswith("/simulation-runs/"):
                raise RetiredRouteError("/api/simulation-runs", "/api/runs")
            body = self._read_json()

            if self.command == "POST" and route == "/auth/login":
                return api.login(str(body.get("username") or ""), str(body.get("password") or ""))
            if self.command == "GET" and route == "/auth/session":
                return {"user": self._require_user()}
            if self.command == "GET" and route.startswith("/audit-events"):
                actor = self._require_user({"系统管理员", "数据管理员"})
                query = urlparse(self.path).query
                resource_id = None
                if query.startswith("resource_id="):
                    resource_id = unquote(query.removeprefix("resource_id="))
                return {"actor": actor, "events": api.repository.list_audit_events(resource_id=resource_id)}
            if self.command == "GET" and route == "/users":
                actor = self._require_user({"系统管理员"})
                return api.list_users(actor_user_id=actor["user_id"])
            if self.command == "POST" and route == "/users":
                actor = self._require_user()
                return api.create_user(body, actor_user_id=actor["user_id"])
            if self.command == "POST" and route == "/projects/validate":
                return api.validate_project(body)
            if self.command == "POST" and route == "/projects":
                return api.save_project(body)
            if self.command == "GET" and route == "/projects":
                return api.list_projects()
            if self.command == "POST" and route == "/modeling-imports/validate":
                return api.validate_modeling_import(body)
            if self.command == "POST" and route == "/modeling-imports":
                actor = self._require_user()
                return api.save_modeling_import(body, actor_user_id=actor["user_id"])

            if self.command == "GET" and len(parts) == 2 and parts[0] == "modeling-imports":
                return api.get_modeling_import(parts[1])
            if self.command == "POST" and len(parts) == 2 and parts[0] == "users":
                actor = self._require_user()
                return api.update_user(parts[1], body, actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "publish":
                actor = self._require_user()
                return api.publish_modeling_import(parts[1], actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "create-project":
                actor = self._require_user()
                return api.create_project_from_modeling_import(parts[1], actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "compile-scenario":
                self._require_user()
                return api.compile_modeling_import_scenario(parts[1], body.get("model_family", ACTIVE_FORMAL_MODEL_FAMILY))
            if self.command == "GET" and len(parts) == 2 and parts[0] == "projects":
                return api.get_project(parts[1])
            if self.command == "DELETE" and len(parts) == 2 and parts[0] == "projects":
                return api.delete_project(parts[1])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "projects" and parts[2] == "modeling-snapshots":
                return api.create_modeling_snapshot(parts[1])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "projects" and parts[2] == "experiment-plans":
                return api.create_experiment_plan(parts[1], body.get("config", {}))
            if self.command == "POST" and route == "/runs":
                formal_body = dict(body)
                formal_body.setdefault("model_family", ACTIVE_FORMAL_MODEL_FAMILY)
                formal_body["formal_run"] = True
                return api.submit_run(formal_body)
            if self.command == "GET" and route == "/runs":
                query = parse_qs(urlparse(self.path).query)
                filters = {key: values[-1] for key, values in query.items() if values}
                return api.list_runs(filters)
            if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "state-stream":
                self._require_user(allow_access_token=True)
                return {"__sse_stream__": api.subscribe_run_state_stream(parts[1])}
            if self.command == "GET" and len(parts) == 2 and parts[0] == "runs":
                return api.get_run_status(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "detail":
                return api.get_run_detail(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "result":
                return api.get_run_result(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "artifacts":
                return api.get_run_artifacts(parts[1])
            if self.command == "GET" and len(parts) == 4 and parts[0] == "runs" and parts[2] == "artifacts":
                actor = self._require_user()
                return {
                    "__file_download__": api.get_run_artifact_download(
                        parts[1],
                        parts[3],
                        actor_user_id=actor["user_id"],
                    )
                }
            if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "chain":
                return api.get_run_chain(parts[1])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "control":
                actor = self._require_user()
                return api.control_run(parts[1], str(body.get("action") or ""), actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "archive":
                actor = self._require_user({"系统管理员", "数据管理员"})
                return api.archive_run(parts[1], actor_user_id=actor["user_id"])
            if self.command == "DELETE" and len(parts) == 2 and parts[0] == "runs":
                actor = self._require_user({"系统管理员", "数据管理员"})
                return api.soft_delete_run(parts[1], actor_user_id=actor["user_id"])

            raise KeyError(route)

        def _require_user(
            self,
            allowed_roles: set[str] | None = None,
            *,
            allow_access_token: bool = False,
        ) -> dict[str, Any]:
            api = self._request_api
            auth_header = self.headers.get("authorization") or ""
            prefix = "Bearer "
            if auth_header.startswith(prefix):
                token = auth_header.removeprefix(prefix).strip()
            elif allow_access_token:
                query = parse_qs(urlparse(self.path).query)
                token = str((query.get("access_token") or [""])[-1]).strip()
            else:
                token = ""
            if not token:
                raise BackendApiError("unauthorized", "M4 session is required")
            try:
                user = api.get_session_user(token)
            except KeyError as exc:
                raise BackendApiError("unauthorized", "M4 session is invalid") from exc
            if allowed_roles is not None and user["role"] not in allowed_roles:
                raise BackendApiError("forbidden", "User is not allowed to perform this action")
            return user

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("content-length", "0") or "0")
            if length == 0:
                return {}
            if length > MAX_JSON_BODY_BYTES:
                raise BackendApiError(
                    "request_too_large",
                    f"JSON request body exceeds {MAX_JSON_BODY_BYTES} bytes",
                    limit_bytes=MAX_JSON_BODY_BYTES,
                    received_bytes=length,
                )
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw)

        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def _send_sse(self, status: int, envelope: dict[str, Any]) -> None:
            chunks = []
            for event in envelope.get("events") or []:
                event_type = str(event.get("event_type") or "message")
                data = json.dumps(event.get("payload") or {}, ensure_ascii=False, sort_keys=True)
                chunks.append(f"event: {event_type}\ndata: {data}\n\n")
            body = "".join(chunks).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "text/event-stream; charset=utf-8")
            self.send_header("cache-control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def _send_file_download(self, status: int, download: dict[str, Any]) -> None:
            data = bytes(download["body"])
            self.send_response(status)
            self.send_header("content-type", str(download["content_type"]))
            self.send_header("content-length", str(len(data)))
            self.send_header("content-disposition", f'attachment; filename="{_safe_download_filename(download["filename"])}"')
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def _send_static(self, path: str) -> None:
            if path not in ("", "/") and not path.startswith("/front/"):
                self._send_json(404, {"code": "not_found", "message": path})
                return
            relative = path.lstrip("/") or "front/index.html"
            target = (root / relative).resolve()
            if root not in target.parents and target != root:
                self._send_json(404, {"code": "not_found", "message": path})
                return
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                self._send_json(404, {"code": "not_found", "message": path})
                return
            data = target.read_bytes()
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix == ".mjs":
                content_type = "text/javascript"
            self.send_response(200)
            self.send_header("content-type", f"{content_type}; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    class BackendHTTPServer(ThreadingHTTPServer):
        def server_close(self) -> None:
            try:
                anchor_connection.close()
            finally:
                super().server_close()

    server = BackendHTTPServer(address, BackendRequestHandler)
    return server


def _safe_download_filename(filename: str) -> str:
    safe_chars = []
    for char in str(filename):
        if char in {'"', "\\"} or ord(char) < 32 or ord(char) == 127:
            safe_chars.append("_")
        else:
            safe_chars.append(char)
    safe = "".join(safe_chars).strip()
    return safe or "download"


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve spare_mvp frontend and M3 backend API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--database", default="")
    parser.add_argument("--output-dir", default="runs/m3-0-http")
    args = parser.parse_args()
    default_database_path = Path(args.repo_root) / "runs" / "system-start" / "spare_mvp.sqlite3"

    server = create_backend_server(
        (args.host, args.port),
        repo_root=args.repo_root,
        database_path=args.database or default_database_path,
        output_dir=Path(args.repo_root) / args.output_dir,
    )
    print(f"Serving spare_mvp frontend and /api on http://{args.host}:{args.port}/front/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
