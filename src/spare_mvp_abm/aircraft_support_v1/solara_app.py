"""Solara sidecar page for interactive aircraft_support_v1 visual simulation."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import ProxyHandler, build_opener

import solara
from mesa.visualization import SolaraViz
from mesa.visualization.solara_viz import update_counter

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_contract.adapter import SimulationAdapter


SOLARA_PROJECT_JSON_ENV = "SPARE_MVP_SOLARA_PROJECT_JSON"
SOLARA_BACKEND_API_BASE_ENV = "SPARE_MVP_SOLARA_BACKEND_API_BASE"
SOLARA_DURATION_MINUTES_ENV = "SPARE_MVP_SOLARA_DURATION_MINUTES"
SOLARA_SEED_ENV = "SPARE_MVP_SOLARA_SEED"
DEFAULT_BACKEND_API_BASE = "http://127.0.0.1:4173/api"
LOCAL_BACKEND_OPENER = build_opener(ProxyHandler({}))


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _project_json_path() -> Path:
    configured = os.environ.get(SOLARA_PROJECT_JSON_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    repo_root = _repo_root()
    for candidate in (
        repo_root / "exports" / "frontend_project.json",
        repo_root / "exports" / "project-case-large.json",
        repo_root / "public" / "import-templates" / "canonical_platform_case.json",
    ):
        if candidate.exists():
            return candidate
    return repo_root / "exports" / "frontend_project.json"


def _load_project_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, dict):
        raise ValueError(f"Project JSON must be an object: {path}")
    return payload


def _backend_api_base() -> str:
    configured = os.environ.get(SOLARA_BACKEND_API_BASE_ENV, DEFAULT_BACKEND_API_BASE)
    parsed = urlparse(configured)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return DEFAULT_BACKEND_API_BASE
    return configured.rstrip("/")


def _load_backend_project_json(project_id: str) -> dict[str, Any]:
    normalized_project_id = str(project_id or "").strip()
    if not normalized_project_id:
        raise ValueError("project_id is required")
    url = f"{_backend_api_base()}/projects/{quote(normalized_project_id, safe='')}"
    try:
        with LOCAL_BACKEND_OPENER.open(url, timeout=5) as response:  # nosec B310 - local managed backend endpoint.
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Backend Project {normalized_project_id} unavailable: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Backend Project payload must be an object: {normalized_project_id}")
    return payload


def _load_project_source(project_id: str | None = None) -> dict[str, Any]:
    if project_id:
        project = _load_backend_project_json(project_id)
        return {
            "project": project,
            "path": f"{_backend_api_base()}/projects/{project_id}",
            "source": "backend_project",
            "requested_project_id": project_id,
        }

    path = _project_json_path()
    return {
        "project": _load_project_json(path),
        "path": str(path),
        "source": "project_json_file",
        "requested_project_id": "",
        "fallback_reason": "",
    }


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _model_inputs(project_id: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    source = _load_project_source(project_id)
    project = source["project"]
    adapter = SimulationAdapter(_repo_root())
    result = adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")
    if result.get("status") != "compiled" or not isinstance(result.get("scenario"), dict):
        issues = result.get("issues") or result.get("errors") or []
        raise ValueError(f"Project JSON cannot compile to aircraft_support_v1: {issues}")
    scenario = result["scenario"]
    inputs = copy.deepcopy(scenario["simulation_inputs"])
    inputs.setdefault("time", {})
    inputs["time"]["duration_minutes"] = max(1, _int_env(SOLARA_DURATION_MINUTES_ENV, int(inputs["time"].get("duration_minutes") or 1440)))
    inputs["seed"] = _int_env(SOLARA_SEED_ENV, int(inputs.get("seed") or 1))
    inputs["source_context"] = {
        "source": source["source"],
        "path": source["path"],
        "project_id": project.get("project_id") or project.get("scenarioId") or source.get("requested_project_id") or "",
        "fallback_reason": source.get("fallback_reason", ""),
    }
    return inputs, {"project": project, "scenario": scenario, **source}


def _safe_model_inputs(project_id: str | None = None) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str]:
    try:
        inputs, source = _model_inputs(project_id)
        return inputs, source, ""
    except Exception as exc:
        return None, None, str(exc)


@solara.component
def MetricsPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    metrics = model.snapshot()
    source_context = model.inputs.get("source_context") if isinstance(model.inputs.get("source_context"), dict) else {}
    source_label = "后端 Project" if source_context.get("source") == "backend_project" else "文件回退"
    rows = [
        ("仿真分钟", model.minute),
        ("数据来源", source_label),
        ("任务成功率", f"{metrics['mission_success_rate']:.1%}"),
        ("战备完好率", f"{metrics['ready_rate']:.1%}"),
        ("可用飞机", metrics["available_aircraft"]),
        ("维修中", metrics["repairing_count"]),
        ("缺件事件", metrics["shortage_events"]),
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 会话指标",
                "",
                "| 指标 | 当前值 |",
                "| --- | ---: |",
                *[f"| {label} | {value} |" for label, value in rows],
            ]
        )
    )


@solara.component
def AircraftPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    frame = model.visualization_frame(run_id="solara-session", step=model.steps)
    aircraft_rows = [
        f"| {item.get('tail_number')} | {item.get('type')} | {item.get('state')} | {item.get('current_mission_id') or '-'} |"
        for item in frame.get("aircraft", [])
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 飞机状态",
                "",
                "| 编号 | 型号 | 状态 | 任务 |",
                "| --- | --- | --- | --- |",
                *(aircraft_rows or ["| - | - | - | - |"]),
            ]
        )
    )


@solara.component
def EventPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    events = list(model.event_log[-12:])
    event_rows = [
        f"| {item.get('time')} | {item.get('type')} | {str(item.get('message') or '')[:120]} |"
        for item in events
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 事件流",
                "",
                "| 分钟 | 类型 | 事件 |",
                "| ---: | --- | --- |",
                *(event_rows or ["| - | - | 等待模型推进 |"]),
            ]
        )
    )


@solara.component
def Page() -> None:
    router = solara.use_router()
    query = parse_qs(router.search or "")
    project_id = str((query.get("project_id") or [""])[-1] or "").strip()
    inputs, _source, error = solara.use_memo(lambda: _safe_model_inputs(project_id), [project_id])
    if error or inputs is None:
        solara.Markdown(f"### Solara 推演输入加载失败\n\n{error or '未知错误'}")
        return
    solara.Style(
        """
        a[href*="solara.dev"],
        .solara-watermark {
            display: none !important;
        }
        .v-main__wrap {
            padding-bottom: 24px;
        }
        """
    )
    model = AircraftSupportV1Model(copy.deepcopy(inputs))
    SolaraViz(
        model,
        components=[
            (MetricsPanel, 0),
            (AircraftPanel, 0),
            (EventPanel, 1),
        ],
        model_params={"inputs": copy.deepcopy(inputs)},
        name="aircraft_support_v1 Solara 推演",
        play_interval=250,
        render_interval=10,
    )
