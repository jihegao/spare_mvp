#!/usr/bin/env python3
"""Mesa contract provider: a zero-dependency (stdlib ``http.server``) JSON service.

The service exposes :class:`AviationSupportModel` and
:class:`SmokeSpareMvpModel` state as a stable JSON contract so that swarm
agents can consume simulation state without importing model code or coupling to
the local Mesa environment. It is the single source of truth described in
``agent.md`` under "Mesa 后台契约服务（Contract Provider）".

Ownership: this module, its endpoint list, the default port 8521, the query
parameter allow-list, the response envelope, and ``CONTRACT_VERSION`` are owned
by the Claude maintainer. Other agents are read-only consumers; any change must
be filed in ``agent.md`` first (see ``/contract``).
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import sys
import traceback
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
SCENARIOS_DIR = REPO_ROOT / "scenarios"
AVI_DIR = SRC_DIR / "spare_mvp_abm" / "aviation_support"
DEFAULT_SMOKE_PROJECT = SCENARIOS_DIR / "frontend-project-smoke" / "project.json"

CONTRACT_VERSION = "1.0.0"
DEFAULT_STEPS = 0
MAX_STEPS = 1000
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8521

#: AviationSupportModel constructor parameters exposed to query strings.
#: ``(cast, default)``; ``default`` of ``None`` means "omit unless provided".
AVI_PARAMS: dict[str, tuple[type, Any]] = {
    "aircraft_count": (int, None),
    "aircraft_type": (str, None),
    "mission_count": (int, None),
    "mechanic_teams": (int, None),
    "fuel_trucks": (int, None),
    "power_carts": (int, None),
    "weapons_crews": (int, None),
    "maintenance_bays": (int, None),
    "tick_minutes": (float, None),
    "lru_failure_multiplier": (float, None),
    "seed": (int, None),
}


def _bootstrap() -> dict[str, type]:
    """Import both Mesa model classes once via package import (prefers ``__init__``)."""
    if str(SRC_DIR) not in sys.path:
        sys.path.insert(0, str(SRC_DIR))
    from spare_mvp_abm.aviation_support.model import AviationSupportModel
    from spare_mvp_abm.smoke_model import SmokeSpareMvpModel

    return {"aviation": AviationSupportModel, "smoke": SmokeSpareMvpModel}


def _bootstrap_or_die() -> dict[str, type]:
    try:
        return _bootstrap()
    except Exception as exc:  # noqa: BLE001 - startup guard with actionable hint
        sys.stderr.write(
            "[contract_server] failed to import Mesa models: "
            f"{exc}\n"
            "Run the service with the project's Mesa environment, e.g.\n"
            "  .abm-mesa-test-env/bin/python src/spare_mvp_abm/contract_server.py\n"
        )
        sys.exit(1)


MODEL_REGISTRY = _bootstrap_or_die()


class ContractError(Exception):
    """Structured error surfaced through the response envelope."""

    def __init__(self, code: str, message: str, status: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra


def _envelope(ok: bool, data: Any = None, error: ContractError | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"ok": ok, "contract_version": CONTRACT_VERSION}
    if ok:
        body["data"] = data
        body["error"] = None
        return body
    err = error or ContractError("error", "unknown error")
    payload: dict[str, Any] = {"code": err.code, "message": err.message}
    if err.extra:
        payload.update(err.extra)
    body["data"] = None
    body["error"] = payload
    return body


def _build_aviation_params(query: dict[str, list[str]]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for name, (cast, _) in AVI_PARAMS.items():
        if name not in query:
            continue
        raw = query[name][0]
        try:
            params[name] = cast(raw)
        except (TypeError, ValueError):
            raise ContractError(
                "bad_param",
                f"parameter {name!r} expects {cast.__name__}, got {raw!r}",
                param=name,
            )
    return params


def _build_smoke_params(query: dict[str, list[str]]) -> dict[str, str]:
    raw = query.get("project", [None])[0]
    if raw:
        project_path = Path(raw)
        if not project_path.is_absolute():
            project_path = (REPO_ROOT / project_path).resolve()
        if not project_path.exists():
            raise ContractError("bad_param", f"project file not found: {raw}", param="project")
    else:
        project_path = DEFAULT_SMOKE_PROJECT
        if not project_path.exists():
            raise ContractError(
                "bad_param",
                f"default project file missing: {project_path}",
                param="project",
            )
    return {"projectJsonPath": str(project_path)}


def _steps(query: dict[str, list[str]]) -> int:
    raw = query.get("steps", [str(DEFAULT_STEPS)])[0]
    try:
        steps = int(raw)
    except (TypeError, ValueError):
        raise ContractError("bad_param", f"parameter 'steps' expects int, got {raw!r}", param="steps")
    if steps < 0 or steps > MAX_STEPS:
        raise ContractError(
            "bad_param",
            f"parameter 'steps' must be in 0..{MAX_STEPS}, got {steps}",
            param="steps",
        )
    return steps


def _model_name(query: dict[str, list[str]], default: str = "aviation") -> str:
    name = query.get("model", [default])[0]
    if name not in MODEL_REGISTRY:
        raise ContractError(
            "bad_param",
            f"unknown model {name!r}; choose from {sorted(MODEL_REGISTRY)}",
            param="model",
        )
    return name


def _require_model(query: dict[str, list[str]], expected: str) -> str:
    name = _model_name(query, expected)
    if name != expected:
        raise ContractError(
            "bad_param",
            f"endpoint only supports model={expected!r}, got {name!r}",
            param="model",
        )
    return name


def _run_model(name: str, steps: int, params: dict[str, Any]) -> Any:
    model = MODEL_REGISTRY[name](**params)
    for _ in range(steps):
        model.step()
    return model


class ContractHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mesa-contract-provider/1.0"

    def _send(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_error(self, err: ContractError) -> None:
        self._send(err.status, _envelope(False, error=err))

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[contract_server] %s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib handler convention
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler convention
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        try:
            data = self._route(parsed.path, query)
            self._send(200, _envelope(True, data=data))
        except ContractError as err:
            self._send_error(err)
        except Exception as exc:  # noqa: BLE001 - turn model/runtime errors into a 500 envelope
            err = ContractError(
                "model_error",
                str(exc),
                status=500,
                traceback=traceback.format_exc(limit=4),
            )
            self._send_error(err)

    def _route(self, path: str, query: dict[str, list[str]]) -> Any:
        if path == "/health":
            return {
                "status": "ok",
                "contract_version": CONTRACT_VERSION,
                "models": sorted(MODEL_REGISTRY),
            }
        if path == "/contract":
            return self._contract()
        if path == "/snapshot":
            name = _model_name(query)
            steps = _steps(query)
            params = _build_aviation_params(query) if name == "aviation" else _build_smoke_params(query)
            return _run_model(name, steps, params).snapshot()
        if path == "/visualization":
            _require_model(query, "aviation")
            steps = _steps(query)
            return _run_model("aviation", steps, _build_aviation_params(query)).visualization_state()
        if path == "/experiment":
            return self._experiment(query)
        raise ContractError("not_found", f"unknown endpoint: {path}", status=404)

    def _contract(self) -> dict[str, Any]:
        return {
            "service": "mesa-contract-provider",
            "contract_version": CONTRACT_VERSION,
            "port_default": DEFAULT_PORT,
            "max_steps": MAX_STEPS,
            "ownership": (
                "本服务源文件 src/spare_mvp_abm/contract_server.py、端点清单、默认端口 8521、"
                "查询参数白名单、响应信封与 CONTRACT_VERSION 归 Claude 维护；其他 swarm agent "
                "只读消费，变更须先在 agent.md 登记。"
            ),
            "change_policy": "契约变更流程见 agent.md「Mesa 后台契约服务（Contract Provider）」段落。",
            "envelope": {
                "ok": "bool",
                "contract_version": "str",
                "data": "payload | null",
                "error": "{code,message,...} | null",
            },
            "errors": {
                "400": "bad_param 参数非法（类型/范围/模型不匹配）",
                "404": "not_found 未知端点或 experiment 配置缺失",
                "500": "model_error 模型运行异常（附带 traceback）",
            },
            "endpoints": [
                {"path": "/health", "method": "GET", "params": {}, "returns": "存活状态 + contract_version + 可用模型"},
                {"path": "/contract", "method": "GET", "params": {}, "returns": "本自描述（端点 / 信封 / 错误 / 所有权）"},
                {
                    "path": "/snapshot",
                    "method": "GET",
                    "params": {"model": "aviation|smoke", "steps": "int 0..1000（默认 0）", "aviation入参": list(AVI_PARAMS), "project": "smoke 的 project.json 路径"},
                    "returns": "model.snapshot()",
                },
                {
                    "path": "/visualization",
                    "method": "GET",
                    "params": {"model": "aviation（仅）", "steps": "int"},
                    "returns": "snapshot/aircraft/resources/spares/missions/jobs/support_tasks/metrics/object_relationships/events",
                },
                {
                    "path": "/experiment",
                    "method": "GET",
                    "params": {"name": "scenarios 下目录名，缺省读 aviation_support/experiment.json"},
                    "returns": "experiment.json 原文",
                },
            ],
            "aviation_params": {name: cast.__name__ for name, (cast, _) in AVI_PARAMS.items()},
        }

    def _experiment(self, query: dict[str, list[str]]) -> dict[str, Any]:
        name = query.get("name", [None])[0]
        if name:
            target = SCENARIOS_DIR / name / "experiment.json"
        else:
            target = AVI_DIR / "experiment.json"
        if not target.exists():
            raise ContractError("not_found", f"experiment config not found: {target}", status=404)
        return json.loads(target.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Mesa contract provider (stdlib http.server)")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), ContractHandler)
    sys.stderr.write(
        f"[contract_server] serving Mesa contract on http://{args.host}:{args.port} "
        f"(contract_version={CONTRACT_VERSION}, models={sorted(MODEL_REGISTRY)})\n"
    )
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    main()
