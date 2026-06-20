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
from urllib.parse import unquote, urlparse

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


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
    connection = sqlite3.connect(str(database_path), check_same_thread=False)
    initialize_database(connection)
    api = BackendApi(
        ContractRepository(connection),
        SimulationAdapter(root),
        output_dir=artifact_dir,
    )

    class BackendRequestHandler(BaseHTTPRequestHandler):
        server_version = "SpareMvpBackend/0.1"

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._handle()

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._handle()

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _handle(self) -> None:
            parsed_path = unquote(urlparse(self.path).path)
            if self.command == "GET" and not parsed_path.startswith("/api"):
                self._send_static(parsed_path)
                return
            try:
                payload = self._dispatch()
                self._send_json(200, payload)
            except KeyError as exc:
                self._send_json(404, {"code": "not_found", "message": str(exc)})
            except BackendApiError as exc:
                status = 400
                if exc.code == "unauthorized":
                    status = 401
                elif exc.code == "forbidden":
                    status = 403
                self._send_json(status, {"code": exc.code, "message": str(exc), "details": exc.details})
            except ValueError as exc:
                self._send_json(400, {"code": "bad_request", "message": str(exc)})
            except Exception as exc:  # pragma: no cover - defensive HTTP boundary
                traceback.print_exc()
                self._send_json(500, {"code": "internal_error", "message": str(exc)})

        def _dispatch(self) -> dict[str, Any]:
            path = urlparse(self.path).path
            if not path.startswith("/api"):
                raise KeyError(path)
            route = path[4:] or "/"
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
            if self.command == "POST" and route == "/modeling-imports/validate":
                return api.validate_modeling_import(body)
            if self.command == "POST" and route == "/modeling-imports":
                actor = self._require_user()
                return api.save_modeling_import(body, actor_user_id=actor["user_id"])

            parts = [unquote(part) for part in route.split("/") if part]
            if self.command == "GET" and len(parts) == 2 and parts[0] == "modeling-imports":
                return api.get_modeling_import(parts[1])
            if self.command == "POST" and len(parts) == 2 and parts[0] == "users":
                actor = self._require_user()
                return api.update_user(parts[1], body, actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "publish":
                actor = self._require_user()
                return api.publish_modeling_import(parts[1], actor_user_id=actor["user_id"])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "compile-scenario":
                self._require_user()
                return api.compile_modeling_import_scenario(parts[1], body.get("model_family", "smoke"))
            if self.command == "GET" and len(parts) == 2 and parts[0] == "projects":
                return api.get_project(parts[1])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "projects" and parts[2] == "modeling-snapshots":
                return api.create_modeling_snapshot(parts[1])
            if self.command == "POST" and len(parts) == 3 and parts[0] == "projects" and parts[2] == "experiment-plans":
                return api.create_experiment_plan(parts[1], body.get("config", {}))
            if self.command == "POST" and route == "/simulation-runs":
                if "project_id" not in body or "experiment_plan_id" not in body:
                    raise ValueError("project_id and experiment_plan_id are required")
                return api.start_simulation_run(
                    body["project_id"],
                    body["experiment_plan_id"],
                    body.get("model_family", "smoke"),
                )
            if self.command == "GET" and len(parts) == 2 and parts[0] == "simulation-runs":
                return api.get_run(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "result":
                return api.get_run_result(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "artifacts":
                return api.get_run_artifacts(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "chain":
                return api.get_run_chain(parts[1])

            raise KeyError(route)

        def _require_user(self, allowed_roles: set[str] | None = None) -> dict[str, Any]:
            auth_header = self.headers.get("authorization") or ""
            prefix = "Bearer "
            if not auth_header.startswith(prefix):
                raise BackendApiError("unauthorized", "M4 session is required")
            token = auth_header.removeprefix(prefix).strip()
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
                connection.close()
            finally:
                super().server_close()

    server = BackendHTTPServer(address, BackendRequestHandler)
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve spare_mvp frontend and M3 backend API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--database", default=":memory:")
    parser.add_argument("--output-dir", default="runs/m3-0-http")
    args = parser.parse_args()

    server = create_backend_server(
        (args.host, args.port),
        repo_root=args.repo_root,
        database_path=args.database,
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
