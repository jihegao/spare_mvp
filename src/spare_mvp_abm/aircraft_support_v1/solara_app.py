"""Solara sidecar page for interactive aircraft_support_v1 visual simulation."""

from __future__ import annotations

import copy
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import ProxyHandler, build_opener

import solara
from mesa.visualization.solara_viz import update_counter

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_contract.adapter import SimulationAdapter


SOLARA_PROJECT_JSON_ENV = "SPARE_MVP_SOLARA_PROJECT_JSON"
SOLARA_BACKEND_API_BASE_ENV = "SPARE_MVP_SOLARA_BACKEND_API_BASE"
SOLARA_DURATION_MINUTES_ENV = "SPARE_MVP_SOLARA_DURATION_MINUTES"
SOLARA_SEED_ENV = "SPARE_MVP_SOLARA_SEED"
DEFAULT_BACKEND_API_BASE = "http://127.0.0.1:4173/api"
LOCAL_BACKEND_OPENER = build_opener(ProxyHandler({}))
APP_TITLE = "可视化推演"
METRICS_PANEL_TITLE = "指标"
VISUAL_TAB_LABELS = ["装备状态", "事件日志"]
CONTROL_PANEL_TITLE = "运行控制"
PLAY_INTERVAL_LABEL = "刷新间隔(ms)"
RENDER_INTERVAL_LABEL = "渲染周期帧数"
RESET_BUTTON_LABEL = "重置"
STEP_BUTTON_LABEL = "单步推进"
MODEL_PARAMETERS_TITLE = "模型参数"
INFORMATION_TITLE = "信息"


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
        raise ValueError(f"项目数据必须是对象：{path}")
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
        raise ValueError("缺少项目编号")
    url = f"{_backend_api_base()}/projects/{quote(normalized_project_id, safe='')}"
    try:
        with LOCAL_BACKEND_OPENER.open(url, timeout=5) as response:  # nosec B310 - local managed backend endpoint.
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"后端项目 {normalized_project_id} 不可用：{exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"后端项目响应数据必须是对象：{normalized_project_id}")
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
        raise ValueError(f"项目数据无法编译为 aircraft_support_v1：{issues}")
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
    source_label = "后端项目" if source_context.get("source") == "backend_project" else "文件回退"
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
                f"### {METRICS_PANEL_TITLE}",
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


def _new_model(inputs: dict[str, Any]) -> AircraftSupportV1Model:
    return AircraftSupportV1Model(copy.deepcopy(inputs))


def _notify_model_changed() -> None:
    update_counter.set(update_counter.get() + 1)


@solara.component
def ControlPanel(model_state: solara.Reactive[AircraftSupportV1Model], inputs: dict[str, Any]) -> None:
    update_counter.get()
    play_interval = solara.use_reactive(250)
    render_interval = solara.use_reactive(10)
    playing = solara.use_reactive(False)

    def step_once() -> None:
        model = model_state.value
        step_count = max(1, int(render_interval.value or 1))
        for _ in range(step_count):
            if not model.running:
                break
            model.step()
        if not model.running:
            playing.set(False)
        _notify_model_changed()

    def reset_model() -> None:
        playing.set(False)
        model_state.set(_new_model(inputs))
        _notify_model_changed()

    def toggle_playing() -> None:
        playing.set(not playing.value)

    def play_loop() -> None:
        while playing.value and model_state.value.running:
            time.sleep(max(1, int(play_interval.value or 1)) / 1000)
            step_once()

    solara.lab.use_task(play_loop, dependencies=[playing.value], prefer_threaded=True)

    with solara.Card(CONTROL_PANEL_TITLE):
        solara.SliderInt(
            label=PLAY_INTERVAL_LABEL,
            value=play_interval,
            on_value=play_interval.set,
            min=1,
            max=500,
            step=10,
        )
        solara.SliderInt(
            label=RENDER_INTERVAL_LABEL,
            value=render_interval,
            on_value=render_interval.set,
            min=1,
            max=100,
            step=1,
        )
        with solara.Row(justify="space-between"):
            solara.Button(label=RESET_BUTTON_LABEL, color="primary", on_click=reset_model)
            solara.Button(
                label="暂停" if playing.value else "播放",
                color="primary",
                on_click=toggle_playing,
                disabled=not model_state.value.running,
            )
            solara.Button(
                label=STEP_BUTTON_LABEL,
                color="primary",
                on_click=step_once,
                disabled=playing.value or not model_state.value.running,
            )


@solara.component
def ModelParametersPanel(inputs: dict[str, Any]) -> None:
    time_config = inputs.get("time") if isinstance(inputs.get("time"), dict) else {}
    source_context = inputs.get("source_context") if isinstance(inputs.get("source_context"), dict) else {}
    rows = [
        ("项目编号", source_context.get("project_id") or "-"),
        ("数据来源", "后端项目" if source_context.get("source") == "backend_project" else "文件回退"),
        ("仿真时长", f"{time_config.get('duration_minutes', '-')} 分钟"),
        ("随机种子", inputs.get("seed", "-")),
    ]
    solara.Markdown("\n".join(f"- {label}：{value}" for label, value in rows))


@solara.component
def InformationPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    solara.Markdown(
        "\n".join(
            [
                f"- 当前步数：{model.steps}",
                f"- 运行状态：{'运行中' if model.running else '已结束'}",
            ]
        )
    )


@solara.component
def VisualPanelTabs(model: AircraftSupportV1Model) -> None:
    current_tab_index, set_current_tab_index = solara.use_state(0)
    with solara.v.Tabs(v_model=current_tab_index, on_v_model=set_current_tab_index):
        for label in VISUAL_TAB_LABELS:
            solara.v.Tab(children=[label])
    with solara.v.Window(v_model=current_tab_index):
        with solara.v.WindowItem():
            AircraftPanel(model)
        with solara.v.WindowItem():
            EventPanel(model)


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
    model_state = solara.use_reactive(_new_model(inputs))  # noqa: SH101
    with solara.AppBar():
        solara.AppBarTitle(APP_TITLE)
    with solara.Sidebar(), solara.Column():
        ControlPanel(model_state, inputs)
        with solara.Card(MODEL_PARAMETERS_TITLE):
            ModelParametersPanel(inputs)
        with solara.Card(INFORMATION_TITLE):
            InformationPanel(model_state.value)
    with solara.Column():
        MetricsPanel(model_state.value)
        VisualPanelTabs(model_state.value)
