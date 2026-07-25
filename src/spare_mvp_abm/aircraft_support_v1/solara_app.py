"""Solara sidecar page for interactive aircraft_support_v1 visual simulation."""

from __future__ import annotations

import copy
import hashlib
import html
import json
import math
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import ProxyHandler, Request, build_opener

import solara
from mesa.visualization.solara_viz import update_counter

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.organization_observability import (
    organization_dispatch_summary,
)
from src.spare_mvp_contract.adapter import SimulationAdapter


SOLARA_PROJECT_JSON_ENV = "SPARE_MVP_SOLARA_PROJECT_JSON"
SOLARA_BACKEND_API_BASE_ENV = "SPARE_MVP_SOLARA_BACKEND_API_BASE"
SOLARA_DURATION_MINUTES_ENV = "SPARE_MVP_SOLARA_DURATION_MINUTES"
SOLARA_SEED_ENV = "SPARE_MVP_SOLARA_SEED"
DEFAULT_BACKEND_API_BASE = "http://127.0.0.1:4173/api"
LOCAL_BACKEND_OPENER = build_opener(ProxyHandler({}))
METRICS_PANEL_TITLE = "指标"
VISUAL_TAB_LABELS = ["飞机视图", "任务视图", "保障视图"]
CONTROL_PANEL_TITLE = "运行控制"
PLAY_INTERVAL_LABEL = "播放速度(x)"
RENDER_INTERVAL_LABEL = "渲染周期帧数"
RESET_BUTTON_LABEL = "重置"
STEP_BUTTON_LABEL = "单步推进"
MODEL_PARAMETERS_TITLE = "模型参数"
INFORMATION_TITLE = "信息"
EVENT_TYPE_LABELS = {
    "simulation_stopped": "推演结束",
    "transport_arrived": "备件到达",
    "mission_failed_returned": "任务故障返场",
    "mission_failed_after_return": "任务返场后判定失败",
    "mission_returned_with_component_failure": "任务返场后维修",
    "mission_returned": "任务返场",
    "mission_failed_minimum_aircraft": "任务失败",
    "personnel_delay": "保障人员不足",
    "equipment_shortage": "保障设备短缺",
    "spare_shortage": "备件短缺",
    "job_started": "保障作业开始",
    "component_failed": "部件故障",
    "aircraft_failed": "飞机故障",
    "preventive_created": "预防性维修创建",
    "preflight_created": "飞行前保障创建",
    "preflight_resource_conflict": "飞行前保障资源冲突",
    "mission_preflight_released": "任务预保障释放",
    "mission_launched": "任务启动",
    "mission_cancelled": "任务取消",
    "mission_success_point_succeeded": "任务判定成功",
    "mission_success_point_failed": "任务判定失败",
    "spare_consumed": "备件消耗",
    "transport_dispatched": "备件调运",
    "transport_replenished": "备件补充",
    "organization_local_fulfilled": "本级满足",
    "organization_resource_selected": "组织资源选择",
    "organization_supply_selected": "组织供给选择",
    "organization_candidate_rejected": "组织候选跳过",
    "organization_resource_dispatched": "组织资源调运",
    "organization_transport_dispatched": "组织备件调运",
    "organization_resource_arrived": "组织资源到达",
    "organization_transport_arrived": "组织备件到达",
    "organization_resource_blocked": "组织资源受阻",
    "organization_dispatch_failed": "组织供给失败",
    "preflight_completed": "飞行前保障完成",
    "repair_completed": "修复性维修完成",
    "postflight_completed": "航后保障完成",
    "preventive_completed": "预防性维修完成",
}
JOB_STATE_LABELS = {
    "waiting": "等待中",
    "queued": "排队中",
    "pending": "待执行",
    "running": "执行中",
    "active": "执行中",
    "blocked": "受阻",
    "delayed": "延误",
    "completed": "已完成",
    "succeeded": "已完成",
    "failed": "失败",
    "cancelled": "已取消",
}
JOB_KIND_LABELS = {
    "preflight": "飞行前保障",
    "postflight": "航后保障",
    "repair": "修复性维修",
    "preventive": "预防性维修",
    "transport": "备件调运",
}
SHORTAGE_REASON_LABELS = {
    "personnel_capacity": "保障人员数量不足",
    "equipment_capacity": "保障设备可用数量不足",
    "in_transit": "所需备件正在调运途中",
    "spare_shortage": "所需备件库存不足",
    "equipment_shortage": "所需保障设备不足",
}


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


def _normalize_visualization_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if (
        not session_id
        or len(session_id) > 200
        or not re.fullmatch(r"[A-Za-z0-9._:-]+", session_id)
    ):
        raise ValueError("可视化会话编号无效")
    return session_id


def _normalize_visualization_session_token(value: Any) -> str:
    token = str(value or "").strip()
    if (
        not token
        or len(token) > 4096
        or any(character.isspace() or ord(character) < 33 or ord(character) > 126 for character in token)
    ):
        raise ValueError("可视化会话 capability token 无效")
    return token


def _normalize_playback_speed(value: Any) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("可视化会话 playback_speed 无效") from exc
    if not math.isfinite(speed) or speed <= 0:
        raise ValueError("可视化会话 playback_speed 无效")
    return speed


def _canonical_json_sha256(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_backend_visualization_session(
    visualization_session_id: str,
    visualization_session_token: str,
) -> dict[str, Any]:
    session_id = _normalize_visualization_session_id(visualization_session_id)
    capability_token = _normalize_visualization_session_token(
        visualization_session_token
    )
    url = f"{_backend_api_base()}/visualization-sessions/{quote(session_id, safe='')}"
    request = Request(
        url,
        headers={"Authorization": f"VisualizationSession {capability_token}"},
        method="GET",
    )
    try:
        with LOCAL_BACKEND_OPENER.open(request, timeout=5) as response:  # nosec B310 - local managed backend endpoint.
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"可视化会话 {session_id} 已过期或不可用：{exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"可视化会话响应数据必须是对象：{session_id}")
    return payload


def _required_session_text(payload: dict[str, Any], key: str) -> str:
    raw_value = payload.get(key)
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ValueError(f"可视化会话缺少 {key}")
    return raw_value.strip()


def _required_session_int(
    payload: dict[str, Any],
    key: str,
    *,
    minimum: int = 1,
) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"可视化会话 {key} 无效")
    return value


def _visualization_session_inputs(
    visualization_session_id: str,
    visualization_session_token: str,
    playback_speed: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    requested_session_id = _normalize_visualization_session_id(visualization_session_id)
    capability_token = _normalize_visualization_session_token(
        visualization_session_token
    )
    normalized_playback_speed = _normalize_playback_speed(playback_speed)
    payload = _load_backend_visualization_session(
        requested_session_id,
        capability_token,
    )
    returned_session_id = _required_session_text(payload, "visualization_session_id")
    if returned_session_id != requested_session_id:
        raise ValueError("可视化会话响应编号与请求不一致")

    context_key = _required_session_text(payload, "context_key")
    input_fingerprint = _required_session_text(payload, "input_fingerprint")
    duration_minutes = _required_session_int(payload, "duration_minutes")
    tick_minutes = _required_session_int(payload, "tick_minutes")
    max_steps = _required_session_int(payload, "max_steps")
    frame_sample_every_steps = _required_session_int(payload, "frame_sample_every_steps")
    seed = _required_session_int(payload, "seed", minimum=0)

    raw_inputs = payload.get("simulation_inputs")
    if not isinstance(raw_inputs, dict):
        raise ValueError("可视化会话缺少已编译 simulation_inputs")
    inputs = copy.deepcopy(raw_inputs)
    if not re.fullmatch(r"[0-9a-f]{64}", input_fingerprint):
        raise ValueError("可视化会话 input_fingerprint 格式无效")
    if _canonical_json_sha256(inputs) != input_fingerprint:
        raise ValueError("可视化会话 simulation_inputs 指纹不匹配")
    time_config = inputs.get("time")
    if not isinstance(time_config, dict):
        raise ValueError("可视化会话 simulation_inputs.time 无效")
    for key, expected in (
        ("duration_minutes", duration_minutes),
        ("tick_minutes", tick_minutes),
    ):
        actual = time_config.get(key)
        if isinstance(actual, bool) or not isinstance(actual, int) or actual != expected:
            raise ValueError(f"可视化会话 canonical {key} 不一致")
    actual_seed = inputs.get("seed")
    if isinstance(actual_seed, bool) or not isinstance(actual_seed, int) or actual_seed != seed:
        raise ValueError("可视化会话 canonical seed 不一致")

    path = (
        f"{_backend_api_base()}/visualization-sessions/"
        f"{quote(requested_session_id, safe='')}"
    )
    inputs["source_context"] = {
        "source": "visualization_session",
        "visualization_session_id": requested_session_id,
        "context_key": context_key,
        "input_fingerprint": input_fingerprint,
    }
    return inputs, {
        "source": "backend_visualization_session",
        "path": path,
        "visualization_session_id": requested_session_id,
        "context_key": context_key,
        "input_fingerprint": input_fingerprint,
        "runtime": {
            "duration_minutes": duration_minutes,
            "tick_minutes": tick_minutes,
            "max_steps": max_steps,
            "frame_sample_every_steps": frame_sample_every_steps,
            "seed": seed,
            "playback_speed": normalized_playback_speed,
        },
    }


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


def _query_runtime_config(query: dict[str, list[str]]) -> dict[str, Any]:
    experiment_plan_id = str((query.get("experiment_plan_id") or [""])[-1] or "").strip()
    if not experiment_plan_id or len(experiment_plan_id) > 200 or not re.fullmatch(r"[A-Za-z0-9._:-]+", experiment_plan_id):
        return {}
    experiment: dict[str, int] = {}
    for query_key, config_key, minimum, maximum in (
        ("plan_steps", "steps", 1, 1_000_000),
        ("plan_samples", "samples", 1, 1_000),
        ("plan_seed", "seed", 0, 2_147_483_647),
    ):
        raw_value = str((query.get(query_key) or [""])[-1] or "").strip()
        if not re.fullmatch(r"[0-9]+", raw_value):
            continue
        value = int(raw_value)
        if minimum <= value <= maximum:
            experiment[config_key] = value
    return {
        "experiment_plan_id": experiment_plan_id,
        **({"experiment": experiment} if experiment else {}),
    }


def _query_input_request(
    query: dict[str, list[str]],
) -> tuple[str, str, dict[str, Any]]:
    if "visualization_session_id" in query:
        session_ids = query.get("visualization_session_id") or []
        session_tokens = query.get("visualization_session_token") or []
        playback_speeds = query.get("playback_speed") or []
        if len(session_ids) != 1:
            raise ValueError("必须且只能提供一个可视化会话编号")
        if len(session_tokens) != 1:
            raise ValueError("必须且只能提供一个可视化会话 capability token")
        if len(playback_speeds) != 1:
            raise ValueError("必须且只能提供一个 playback_speed")
        return (
            "visualization_session",
            _normalize_visualization_session_id(session_ids[0]),
            {
                "visualization_session_token": (
                    _normalize_visualization_session_token(session_tokens[0])
                ),
                "playback_speed": _normalize_playback_speed(playback_speeds[0]),
            },
        )
    project_id = str((query.get("project_id") or [""])[-1] or "").strip()
    return "project", project_id, _query_runtime_config(query)


def _model_inputs(
    project_id: str | None = None,
    runtime_config: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    source = _load_project_source(project_id)
    project = source["project"]
    adapter = SimulationAdapter(_repo_root())
    result = adapter.compile_scenario_with_gate(
        project,
        model_family="aircraft_support_v1",
        runtime_config=runtime_config,
    )
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
        "experiment_plan_id": str((runtime_config or {}).get("experiment_plan_id") or ""),
    }
    return inputs, {"project": project, "scenario": scenario, **source}


def _safe_model_inputs(
    project_id: str | None = None,
    runtime_config: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str]:
    try:
        inputs, source = _model_inputs(project_id, runtime_config=runtime_config)
        return inputs, source, ""
    except Exception as exc:
        return None, None, str(exc)


def _safe_visualization_session_inputs(
    visualization_session_id: str,
    visualization_session_token: str,
    playback_speed: Any,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str]:
    try:
        inputs, source = _visualization_session_inputs(
            visualization_session_id,
            visualization_session_token,
            playback_speed,
        )
        return inputs, source, ""
    except Exception as exc:
        return None, None, str(exc)


@solara.component
def MetricsPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    metrics = model.snapshot()
    rows = _metrics_rows(model, metrics)
    metric_cards = "".join(
        f'<div class="sim-metric"><span>{html.escape(str(label))}</span><strong>{html.escape(str(value))}</strong></div>'
        for label, value in rows
    )
    solara.HTML(
        unsafe_innerHTML=f'<div class="sim-section-title">{METRICS_PANEL_TITLE}</div><div class="sim-metric-grid">{metric_cards}</div>',
        classes=["sim-html"],
    )


def _metrics_rows(model: AircraftSupportV1Model, metrics: dict[str, Any] | None = None) -> list[tuple[str, Any]]:
    values = metrics or model.snapshot()
    organization = organization_dispatch_summary(
        model.event_log,
        identity=model.organization_graph_identity,
    )
    fulfillment_rate = organization.get("observed_fulfillment_rate")
    return [
        ("仿真分钟", model.minute),
        ("任务成功率", f"{values['mission_success_rate']:.1%}"),
        ("战备完好率", f"{values['ready_rate']:.1%}"),
        ("可用飞机", values["available_aircraft"]),
        ("维修中", values["repairing_count"]),
        ("缺件事件", values["shortage_events"]),
        ("组织已观察满足率", "--" if fulfillment_rate is None else f"{fulfillment_rate:.1%}"),
        ("组织调运批次", organization["transport_batch_count"]),
    ]


def _frame(model: AircraftSupportV1Model) -> dict[str, Any]:
    session_id = str(getattr(model, "_visualization_session_id", "") or "")
    input_fingerprint = str(getattr(model, "_input_fingerprint", "") or "")
    frame = model.visualization_frame(
        run_id=session_id or "solara-session",
        step=model.steps,
    )
    if session_id:
        frame["visualization_session_id"] = session_id
    if input_fingerprint:
        frame["input_fingerprint"] = input_fingerprint
    return frame


def _state_label(state: Any) -> str:
    labels = {
        "available": "可用",
        "mission_ready": "待出动",
        "pre_support": "使用保障",
        "post_support": "使用保障",
        "support": "使用保障",
        "flying": "任务中",
        "maintenance": "维修中",
        "repair": "维修中",
        "repairing": "维修中",
        "unavailable": "维修/不可用",
        "failed": "维修/不可用",
    }
    return labels.get(str(state or "").lower(), "未知状态")


def _state_class(state: Any) -> str:
    value = str(state or "available").lower()
    if value in {"flying", "mission", "launched"}:
        return "mission"
    if value in {"pre_support", "post_support", "support", "operations_support"}:
        return "support"
    if value in {"maintenance", "repair", "repairing", "unavailable", "failed"}:
        return "maintenance"
    return "available"


def _status_label(status: Any) -> str:
    labels = {
        "scheduled": "计划中",
        "preparing": "准备中",
        "ready": "待执行",
        "launched": "执行中",
        "flying": "执行中",
        "completed": "已完成",
        "failed": "失败",
        "cancelled": "已取消",
        "delayed": "延误",
    }
    return labels.get(str(status or "").lower(), "未知状态")


def _mission_task_name(item: dict[str, Any] | None) -> str:
    mission = item if isinstance(item, dict) else {}
    internal_ids = {
        str(mission.get(key) or "").strip()
        for key in ("mission_id", "periodic_task_id", "composite_task_id", "basic_task_id", "task_id", "wave_id")
        if str(mission.get(key) or "").strip()
    }
    mission_id = str(mission.get("mission_id") or "").strip()
    for key in ("task_name", "basic_task_name", "name", "composite_task_name", "periodic_task_name"):
        candidate = str(mission.get(key) or "").strip()
        if not candidate or candidate in internal_ids:
            continue
        if mission_id and mission_id.startswith(f"{candidate}-d"):
            continue
        return candidate
    return "未命名任务"


def _mission_business_context(item: dict[str, Any] | None) -> str:
    mission = item if isinstance(item, dict) else {}
    parts = []
    day_index = int(mission.get("day_index") or 0)
    wave_index = int(mission.get("wave_index") or 0)
    aircraft_type = str(mission.get("required_aircraft_type") or "").strip()
    if day_index > 0:
        parts.append(f"第{day_index}天")
    if wave_index > 0:
        parts.append(f"第{wave_index}波")
    if aircraft_type:
        parts.append(aircraft_type)
    return " / ".join(parts) or "任务计划"


def _current_mission_task_name(mission_id: Any, missions: list[dict[str, Any]]) -> str:
    normalized_id = str(mission_id or "").strip()
    if not normalized_id:
        return "无"
    mission = next((item for item in missions if str(item.get("mission_id") or "") == normalized_id), None)
    return _mission_task_name(mission or {"mission_id": normalized_id})


def _support_job_task_name(item: dict[str, Any] | None) -> str:
    job = item if isinstance(item, dict) else {}
    task_name = str(job.get("task") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    if task_name and task_name != job_id and any(ord(character) > 127 for character in task_name):
        return task_name
    return JOB_KIND_LABELS.get(str(job.get("kind") or "").strip().lower(), "保障作业")


def _job_state_label(state: Any) -> str:
    return JOB_STATE_LABELS.get(str(state or "").strip().lower(), "未知状态")


def _shortage_reason_label(reason: Any, spare_type: Any = "") -> str:
    normalized = str(reason or "").strip()
    if not normalized:
        return "保障资源暂不可用"
    if normalized.startswith("spare:"):
        spare = normalized.removeprefix("spare:") or str(spare_type or "")
        return f"{_display_entity(spare, '备件')}库存不足"
    return SHORTAGE_REASON_LABELS.get(normalized.lower(), "保障资源暂不可用")


def _display_entity(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    if any(ord(character) > 127 for character in text):
        return text
    return fallback


def _event_type_label(event_type: Any) -> str:
    normalized = str(event_type or "").strip().lower()
    if normalized in EVENT_TYPE_LABELS:
        return EVENT_TYPE_LABELS[normalized]
    if "shortage" in normalized:
        return "保障资源短缺"
    if "fail" in normalized:
        return "故障事件"
    if "mission" in normalized:
        return "任务事件"
    if "repair" in normalized:
        return "维修事件"
    if "support" in normalized or "job" in normalized:
        return "保障作业"
    if "transport" in normalized or "spare" in normalized:
        return "备件保障"
    return "仿真事件"


def _event_display(event: dict[str, Any]) -> tuple[str, str, str]:
    event_type = str(event.get("event") or event.get("type") or "")
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    context = details.get("context") if isinstance(details.get("context"), dict) else {}
    details = {**context, **details}
    raw_message = str(event.get("message") or "")
    tokens = raw_message.split()
    first = tokens[0] if tokens else ""
    last = tokens[-1] if tokens else ""
    number = next((token for token in tokens if re.fullmatch(r"\d+(?:\.\d+)?", token)), "")
    job_id = str(details.get("job_id") or (first if "job" in first.lower() else ""))
    mission_id = str(details.get("mission_id") or (first if event_type.startswith("mission_") else ""))
    aircraft_id = str(details.get("tail_number") or (first if event_type in {
        "mission_failed_returned", "mission_failed_after_return", "mission_returned_with_component_failure",
        "mission_returned", "component_failed", "aircraft_failed", "preventive_created", "preflight_completed",
        "repair_completed", "postflight_completed", "preventive_completed",
    } else ""))
    internal_id = job_id or mission_id or aircraft_id
    label = _event_type_label(event_type)
    resource = _display_entity(details.get("resource_name") or details.get("resource_id") or (last if " at " in raw_message else ""), "保障节点")
    spare = _display_entity(details.get("spare_name") or details.get("spare_type") or "", "备件")
    quantity = str(details.get("quantity") or details.get("required_quantity") or number or "所需")

    if event_type == "simulation_stopped":
        message = "推演达到终止条件，已停止推进。"
    elif event_type == "spare_shortage":
        message = f"{spare}库存不足，保障作业等待备件补给；保障节点：{resource}。"
    elif event_type == "equipment_shortage":
        message = f"保障设备可用数量不足，保障作业等待设备；保障节点：{resource}。"
    elif event_type == "personnel_delay":
        message = f"保障人员数量不足，保障作业等待人员；保障节点：{resource}。"
    elif event_type == "job_started":
        message = "保障作业已开始。"
    elif event_type == "spare_consumed":
        message = f"保障作业已消耗 {quantity} 件{spare}。"
    elif event_type == "transport_dispatched":
        message = f"{quantity} 件{spare}已发起调运。"
    elif event_type == "transport_arrived":
        message = f"{quantity} 件{spare}已到达{resource}。"
    elif event_type == "transport_replenished":
        message = f"{quantity} 件{spare}已完成库存补充。"
    elif event_type.startswith("organization_"):
        mode_label = {"local": "本级", "vertical": "上级", "lateral": "横向"}.get(
            str(details.get("source_mode") or details.get("supply_mode") or ""),
            "组织",
        )
        if details.get("fact_type") == "candidate_rejected":
            message = f"{mode_label}候选与服务范围不匹配，已继续检查下一候选。"
        elif details.get("fact_type") == "supply_blocked":
            message = f"{mode_label}保障未满足；原因：{details.get('reason') or '无可用供给'}。"
        elif details.get("fact_type") == "dispatch_started":
            message = f"{mode_label}保障已发起调运，预计等待 {details.get('wait_minutes', 0):g} 分钟。"
        elif details.get("fact_type") == "dispatch_arrived":
            message = f"{mode_label}保障已到达，实际调运等待 {details.get('wait_minutes', 0):g} 分钟。"
        else:
            message = f"已选择{mode_label}保障来源。"
    elif event_type == "component_failed":
        message = f"飞机发生部件故障：{_display_entity(last, '故障部件')}。"
    elif event_type == "aircraft_failed":
        message = "飞机故障已影响整机可用状态。"
    elif event_type == "mission_failed_returned":
        message = "飞机因故障提前返场并转入维修。"
    elif event_type == "mission_failed_after_return":
        message = "飞机返场后判定任务失败并转入维修。"
    elif event_type == "mission_returned_with_component_failure":
        message = "飞机返场后发现部件故障，已转入维修。"
    elif event_type == "mission_returned":
        message = "飞机已完成返场并进入航后保障。"
    elif event_type == "mission_failed_minimum_aircraft":
        message = "可用飞机数量低于最低要求，任务判定失败。"
    elif event_type == "mission_launched":
        message = f"任务已启动{f'，投入 {number} 架飞机' if number else ''}。"
    elif event_type == "mission_cancelled":
        message = "就绪飞机数量不足，任务已取消。"
    elif event_type == "mission_preflight_released":
        message = "任务取消后已释放待出动飞机和关联飞行前保障资源。"
    elif event_type == "mission_success_point_succeeded":
        message = "任务在成功判定点达到要求，判定成功。"
    elif event_type == "mission_success_point_failed":
        message = "任务在成功判定点未达到要求，判定失败。"
    elif event_type == "preflight_created":
        message = "已创建飞行前保障作业。"
    elif event_type == "preflight_resource_conflict":
        message = "同型飞机已被较早任务保留，当前任务飞行前保障等待资源。"
    elif event_type == "preflight_completed":
        message = "飞机已完成飞行前保障。"
    elif event_type == "postflight_completed":
        message = "飞机已完成航后保障。"
    elif event_type == "preventive_created":
        message = "飞机已进入预防性维修。"
    elif event_type == "preventive_completed":
        message = "飞机已完成预防性维修并恢复可用。"
    elif event_type == "repair_completed":
        message = "飞机已完成修复性维修并恢复可用。"
    else:
        message = f"已记录{label}。"
    return label, message, internal_id


def _time_label(minutes: Any) -> str:
    value = max(0, int(float(minutes or 0)))
    day = value // 1440 + 1
    hour = (value % 1440) // 60
    minute = value % 60
    return f"第{day}天 {hour:02d}:{minute:02d}"


@solara.component
def ResourceOverviewPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    resources = _frame(model).get("resources", [])
    cards = "".join(
        "<div class=\"sim-resource\">"
        f"<strong>{html.escape(str(item.get('display_name') or item.get('name') or '保障资源'))}</strong>"
        f"<span>占用 {html.escape(str(item.get('in_use', 0)))} / {html.escape(str(item.get('capacity', 0)))}</span>"
        f"<i><b style=\"width:{max(0, min(100, round(float(item.get('utilization', 0)) * 100)))}%\"></b></i>"
        "</div>"
        for item in resources
    ) or '<div class="sim-empty">当前项目没有可展示的保障资源。</div>'
    solara.HTML(
        unsafe_innerHTML=f'<div class="sim-section-title">资源概览</div><div class="sim-resource-list">{cards}</div>',
        classes=["sim-html"],
    )


@solara.component
def AircraftPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    frame = _frame(model)
    missions = frame.get("missions", [])
    rows = "".join(
        "<tr>"
        f"<td>{html.escape(str(item.get('tail_number') or '-'))}</td>"
        f"<td>{html.escape(str(item.get('type') or '-'))}</td>"
        f"<td><span class=\"sim-state {html.escape(_state_class(item.get('state')))}\">{html.escape(_state_label(item.get('state')))}</span></td>"
        f"<td>{html.escape(_current_mission_task_name(item.get('current_mission_id'), missions))}</td>"
        "</tr>"
        for item in frame.get("aircraft", [])
    ) or "<tr><td colspan=\"4\">当前没有飞机对象。</td></tr>"
    solara.HTML(
        unsafe_innerHTML=(
            '<div class="sim-detail-title">飞机状态</div><table class="sim-table"><thead><tr>'
            '<th>编号</th><th>型号</th><th>状态</th><th>任务</th></tr></thead><tbody>'
            f"{rows}</tbody></table>"
        ),
        classes=["sim-html"],
    )


@solara.component
def EventPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    events = list(model.event_log[-12:])
    event_rows = "".join(_event_row_html(item) for item in events) or '<div class="sim-empty">等待模型推进后显示事件。</div>'
    solara.HTML(
        unsafe_innerHTML=f'<div class="sim-detail-title">事件流</div><div class="sim-event-list">{event_rows}</div>',
        classes=["sim-html"],
    )


def _event_row_html(event: dict[str, Any]) -> str:
    label, message, _internal_id = _event_display(event)
    return (
        '<div class="sim-event">'
        f"<span>T+{html.escape(str(event.get('time', 0)))}</span>"
        f"<strong>{html.escape(label)}</strong>"
        f"<p>{html.escape(message)}</p>"
        "</div>"
    )


def _new_model(inputs: dict[str, Any]) -> AircraftSupportV1Model:
    model = AircraftSupportV1Model(copy.deepcopy(inputs))
    source_context = (
        inputs.get("source_context")
        if isinstance(inputs.get("source_context"), dict)
        else {}
    )
    model._visualization_session_id = str(  # noqa: SLF001
        source_context.get("visualization_session_id") or ""
    )
    model._input_fingerprint = str(  # noqa: SLF001
        source_context.get("input_fingerprint") or ""
    )
    return model


def _reset_model_in_place(model: AircraftSupportV1Model, inputs: dict[str, Any]) -> None:
    """Restore model state without replacing Solara's subscribed object reference."""
    replacement = _new_model(inputs)
    model.__dict__.clear()
    model.__dict__.update(replacement.__dict__)


def _notify_model_changed() -> None:
    update_counter.set(update_counter.get() + 1)


def _playback_delay_seconds(playback_speed: Any) -> float:
    try:
        speed = float(playback_speed)
    except (TypeError, ValueError):
        speed = 1.0
    if not math.isfinite(speed) or speed <= 0:
        speed = 1.0
    return 1.0 / speed


def _step_model_once(
    model: AircraftSupportV1Model,
    *,
    max_steps: int,
    frame_sample_every_steps: int,
) -> bool:
    normalized_max_steps = max(1, int(max_steps or 1))
    sample_every = max(1, int(frame_sample_every_steps or 1))
    if not model.running:
        return False
    if model.steps >= normalized_max_steps:
        model.running = False
        return True
    model.step()
    if model.steps >= normalized_max_steps:
        model.running = False
    return model.steps % sample_every == 0 or not model.running


@solara.component
def ControlPanel(
    model_state: solara.Reactive[AircraftSupportV1Model],
    inputs: dict[str, Any],
    runtime: dict[str, Any] | None = None,
) -> None:
    update_counter.get()
    runtime_config = runtime or {}
    initial_playback_speed = float(runtime_config.get("playback_speed") or 1.0)
    initial_frame_sample = max(
        1,
        int(runtime_config.get("frame_sample_every_steps") or 1),
    )
    max_steps = max(
        1,
        int(
            runtime_config.get("max_steps")
            or inputs.get("time", {}).get("requested_steps")
            or math.ceil(
                int(inputs.get("time", {}).get("duration_minutes") or 1)
                / max(1, int(inputs.get("time", {}).get("tick_minutes") or 1))
            )
        ),
    )
    playback_speed = solara.use_reactive(initial_playback_speed)
    render_interval = solara.use_reactive(initial_frame_sample)
    playing = solara.use_reactive(False)

    def step_once() -> None:
        model = model_state.value
        should_publish = _step_model_once(
            model,
            max_steps=max_steps,
            frame_sample_every_steps=render_interval.value,
        )
        if not model.running:
            playing.set(False)
        if should_publish:
            _notify_model_changed()

    def reset_model() -> None:
        playing.set(False)
        _reset_model_in_place(model_state.value, inputs)
        _notify_model_changed()

    def toggle_playing() -> None:
        playing.set(not playing.value)

    def play_loop() -> None:
        while playing.value and model_state.value.running:
            time.sleep(_playback_delay_seconds(playback_speed.value))
            # Reset/pause may occur while this worker is sleeping.  Recheck
            # before advancing so an already-scheduled iteration cannot step
            # the freshly reset model.
            if not playing.value or not model_state.value.running:
                break
            step_once()

    solara.lab.use_task(play_loop, dependencies=[playing.value], prefer_threaded=True)

    with solara.Column(classes=["sim-control-panel"], gap="0px", style="width:100%;"):
        with solara.Card(CONTROL_PANEL_TITLE, margin=0):
            with solara.Row(classes=["sim-control-content"], gap="16px", style="width:100%; flex-wrap:wrap; align-items:flex-end;"):
                with solara.Column(gap="0px", style="flex:1 1 220px; min-width:180px;"):
                    solara.SliderFloat(
                        label=PLAY_INTERVAL_LABEL,
                        value=playback_speed,
                        on_value=playback_speed.set,
                        min=0.1,
                        max=max(10.0, initial_playback_speed),
                        step=0.1,
                    )
                with solara.Column(gap="0px", style="flex:1 1 220px; min-width:180px;"):
                    solara.SliderInt(
                        label=RENDER_INTERVAL_LABEL,
                        value=render_interval,
                        on_value=render_interval.set,
                        min=1,
                        max=100,
                        step=1,
                    )
                with solara.Row(classes=["sim-control-actions"], gap="8px", style="flex:0 1 auto; flex-wrap:wrap;"):
                    solara.Button(label=RESET_BUTTON_LABEL, color="primary", on_click=reset_model)
                    solara.Button(
                        label="暂停" if playing.value else "推演",
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
    rows = _model_parameter_rows(inputs)
    solara.Markdown("\n".join(f"- {label}：{value}" for label, value in rows))


def _model_parameter_rows(inputs: dict[str, Any]) -> list[tuple[str, Any]]:
    time_config = inputs.get("time") if isinstance(inputs.get("time"), dict) else {}
    return [
        ("仿真时长", f"{time_config.get('duration_minutes', '-')} 分钟"),
        ("随机种子", inputs.get("seed", "-")),
    ]


@solara.component
def InformationPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    solara.Markdown(
        "\n".join(
            [
                f"- 当前步数：{model.steps}",
                f"- 运行状态：{'运行中' if model.running else '已结束'}",
                f"- 组织运行模式：{model.organization_graph_identity['runtime_mode']}",
                f"- 组织图摘要：{model.organization_graph_identity['graph_hash'][:12]}",
            ]
        )
    )


@solara.component
def AircraftStage(model: AircraftSupportV1Model, selected_tail: solara.Reactive[str]) -> None:
    update_counter.get()
    frame = _frame(model)
    aircraft = frame.get("aircraft", [])
    solara.HTML(
        unsafe_innerHTML=(
            '<div class="sim-stage-heading"><div><span>飞机态势</span>'
            f"<strong>{html.escape(_time_label(frame.get('simulation_time')))}</strong></div>"
            '<div class="sim-legend"><i class="available"></i>可用<i class="support"></i>保障'
            '<i class="mission"></i>任务<i class="maintenance"></i>维修</div></div>'
        ),
        classes=["sim-html"],
    )
    with solara.v.Container(fluid=True, class_="sim-aircraft-board", children=[]):
        for item in aircraft:
            tail = str(item.get("tail_number") or "-")
            state = _state_class(item.get("state"))

            def select_aircraft(value: str = tail) -> None:
                selected_tail.set(value)

            solara.Button(
                label=tail,
                on_click=select_aircraft,
                color="primary",
                outlined=True,
                classes=["sim-aircraft-node", state, "selected" if selected_tail.value == tail else ""],
                style="min-width:108px; min-height:80px;",
            )
    MissionTimeline(model)


@solara.component
def MissionTimeline(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    missions = _frame(model).get("missions", [])
    solara.HTML(unsafe_innerHTML=_mission_timeline_html(missions), classes=["sim-html"])


def _mission_timeline_html(missions: list[dict[str, Any]]) -> str:
    cards = "".join(
        "<div class=\"sim-mission\">"
        f"<span>{html.escape(_mission_business_context(item))}</span>"
        f"<strong>{html.escape(_mission_task_name(item))}</strong>"
        f"<small>{html.escape(_time_label(item.get('planned_start')))} / {html.escape(str(item.get('required_aircraft', 0)))} 架</small>"
        f"<em class=\"{html.escape(str(item.get('status') or 'scheduled'))}\">{html.escape(_status_label(item.get('status')))}</em>"
        "</div>"
        for item in missions
    ) or '<div class="sim-empty">当前没有任务计划。</div>'
    return f'<div class="sim-timeline"><div class="sim-timeline-title">任务时间线</div><div class="sim-mission-list">{cards}</div></div>'


@solara.component
def MissionStage(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    missions = _frame(model).get("missions", [])
    rows = _mission_stage_rows_html(missions)
    solara.HTML(
        unsafe_innerHTML=(
            '<div class="sim-stage-heading"><div><span>任务视图</span><strong>任务计划与执行进度</strong></div></div>'
            '<div class="sim-table-wrap"><table class="sim-table"><thead><tr><th>任务名称</th><th>业务上下文</th><th>计划时间</th>'
            f"<th>需求</th><th>状态</th></tr></thead><tbody>{rows}</tbody></table></div>"
        ),
        classes=["sim-html"],
    )
    MissionTimeline(model)


def _mission_stage_rows_html(missions: list[dict[str, Any]]) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{html.escape(_mission_task_name(item))}</td>"
        f"<td>{html.escape(_mission_business_context(item))}</td>"
        f"<td>{html.escape(_time_label(item.get('planned_start')))}</td>"
        f"<td>{html.escape(str(item.get('required_aircraft', 0)))}</td>"
        f"<td><span class=\"sim-state mission\">{html.escape(_status_label(item.get('status')))}</span></td>"
        "</tr>"
        for item in missions
    ) or "<tr><td colspan=\"5\">当前没有任务计划。</td></tr>"
    return rows


@solara.component
def SupportStage(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    frame = _frame(model)
    resources = frame.get("resources", [])
    spares = frame.get("spares", [])
    resource_cards = "".join(
        "<div class=\"sim-support-card\">"
        f"<strong>{html.escape(str(item.get('display_name') or item.get('name') or '保障资源'))}</strong>"
        f"<span>占用 {html.escape(str(item.get('in_use', 0)))} / {html.escape(str(item.get('capacity', 0)))}</span>"
        "</div>"
        for item in resources
    ) or '<div class="sim-empty">暂无保障资源。</div>'
    spare_rows = "".join(
        "<tr>"
        f"<td>{html.escape(str(item.get('name') or '-'))}</td>"
        f"<td>{html.escape(str(item.get('quantity', 0)))}</td>"
        f"<td>{html.escape(str(item.get('consumed', 0)))}</td>"
        f"<td>{html.escape(str(item.get('pending_quantity', 0)))}</td>"
        "</tr>"
        for item in spares
    ) or "<tr><td colspan=\"4\">暂无备件库存。</td></tr>"
    solara.HTML(
        unsafe_innerHTML=(
            '<div class="sim-stage-heading"><div><span>保障视图</span><strong>资源、备件与保障作业</strong></div></div>'
            f'<div class="sim-support-grid">{resource_cards}</div><div class="sim-detail-title">备件库存量 / 已消耗 / 在途</div>'
            '<div class="sim-table-wrap"><table class="sim-table"><thead><tr><th>备件</th><th>库存</th><th>已消耗</th><th>在途</th>'
            f"</tr></thead><tbody>{spare_rows}</tbody></table></div>"
        ),
        classes=["sim-html"],
    )


@solara.component
def AircraftDetailPanel(model: AircraftSupportV1Model, selected_tail: solara.Reactive[str]) -> None:
    update_counter.get()
    frame = _frame(model)
    aircraft = frame.get("aircraft", [])
    tails = [str(item.get("tail_number") or "-") for item in aircraft]
    if tails and selected_tail.value not in tails:
        selected_tail.set(tails[0])
    if tails:
        solara.Select("单机状态", value=selected_tail, values=tails, dense=True)
    item = next((entry for entry in aircraft if str(entry.get("tail_number")) == selected_tail.value), aircraft[0] if aircraft else {})
    failed = str(item.get("failed_lru") or "无")
    rows = [
        ("当前状态", _state_label(item.get("state"))),
        ("当前任务", _current_mission_task_name(item.get("current_mission_id"), frame.get("missions", []))),
        ("累计飞行时间", f"{float(item.get('flight_hours') or 0):.1f} h"),
        ("起降次数", f"{item.get('takeoff_count', 0)} / {item.get('landing_count', 0)}"),
        ("当前保障作业", next((_support_job_task_name(job) for job in frame.get("jobs", []) if job.get("tail_number") == item.get("tail_number")), "无")),
        ("故障件", failed),
    ]
    detail_rows = "".join(
        f'<div class="sim-detail-row"><span>{html.escape(label)}</span><strong>{html.escape(str(value))}</strong></div>'
        for label, value in rows
    )
    solara.HTML(unsafe_innerHTML=f'<div class="sim-detail-title">装备状态</div><div class="sim-detail-list">{detail_rows}</div>', classes=["sim-html"])


@solara.component
def MissionDetailPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    missions = _frame(model).get("missions", [])
    cards = _mission_detail_cards_html(missions)
    solara.HTML(unsafe_innerHTML=f'<div class="sim-detail-title">执行进度</div><div class="sim-detail-list">{cards}</div>', classes=["sim-html"])


def _mission_detail_cards_html(missions: list[dict[str, Any]]) -> str:
    cards = "".join(
        "<div class=\"sim-detail-row\">"
        f"<span>{html.escape(_mission_task_name(item))}</span>"
        f"<strong>{html.escape(_status_label(item.get('status')))}</strong>"
        f"<small>{html.escape(_mission_business_context(item))} / {html.escape(str(item.get('assigned_aircraft', 0)))} / {html.escape(str(item.get('required_aircraft', 0)))} 架</small>"
        "</div>"
        for item in missions
    ) or '<div class="sim-empty">暂无任务执行状态。</div>'
    return cards


@solara.component
def SupportDetailPanel(model: AircraftSupportV1Model) -> None:
    update_counter.get()
    jobs = _frame(model).get("jobs", [])
    cards = "".join(_support_job_row_html(item) for item in jobs) or '<div class="sim-empty">当前没有等待或执行中的保障作业。</div>'
    solara.HTML(unsafe_innerHTML=f'<div class="sim-detail-title">保障作业</div><div class="sim-detail-list">{cards}</div>', classes=["sim-html"])
    EventPanel(model)


def _support_job_row_html(item: dict[str, Any]) -> str:
    reason = f" / 原因：{_shortage_reason_label(item.get('shortage_reason'))}" if item.get("shortage_reason") else ""
    task_name = _support_job_task_name(item)
    return (
        "<div class=\"sim-detail-row\">"
        f"<span>{html.escape(str(item.get('tail_number') or '保障作业'))}</span>"
        f"<strong>{html.escape(task_name)}</strong>"
        f"<small>{html.escape(_job_state_label(item.get('state')))}{html.escape(reason)}"
        f" / 剩余 {html.escape(str(item.get('remaining', 0)))} 分钟</small>"
        "</div>"
    )


@solara.component
def VisualPanelTabs(model: AircraftSupportV1Model) -> None:
    current_view = solara.use_reactive("飞机视图")
    selected_tail = solara.use_reactive("")
    with solara.Row(classes=["sim-view-tabs"], gap="0px"):
        for label in VISUAL_TAB_LABELS:
            def select_view(value: str = label) -> None:
                current_view.set(value)

            solara.Button(
                label=label,
                on_click=select_view,
                color="primary",
                outlined=current_view.value != label,
                style="min-width:102px; border-radius:0;",
            )
    with solara.Row(classes=["sim-content-row"], gap="12px", style="width:100%; flex-wrap:nowrap;"):
        with solara.Column(classes=["sim-stage-card"], gap="12px", style="flex: 1 1 450px; min-width:0;"):
            if current_view.value == "飞机视图":
                AircraftStage(model, selected_tail)
            elif current_view.value == "任务视图":
                MissionStage(model)
            else:
                SupportStage(model)
        with solara.Column(classes=["sim-detail-card"], gap="12px", style="flex: 0 1 270px; min-width:240px;"):
            if current_view.value == "飞机视图":
                AircraftDetailPanel(model, selected_tail)
            elif current_view.value == "任务视图":
                MissionDetailPanel(model)
            else:
                SupportDetailPanel(model)


VISUAL_SIMULATION_STYLE = """
.visual-simulation-page { min-height: 100vh; padding: 14px; background: #f3f7fb; color: #172033; }
.visual-simulation-page .v-sheet, .visual-simulation-page .v-card, .visual-simulation-page .v-card__text { background: transparent; color: inherit; }
.visual-simulation-page .sim-control-panel { width: 100%; }
.visual-simulation-page .sim-control-panel .v-card { background: #ffffff !important; }
.visual-simulation-page .sim-control-content { align-items: flex-end; }
.visual-simulation-page .sim-control-actions { align-items: center; padding-bottom: 4px; }
.visual-simulation-page .sim-left-rail, .visual-simulation-page .sim-detail-card, .visual-simulation-page .sim-stage-card { background: #ffffff !important; border: 1px solid #d8e2ed; border-radius: 8px; padding: 12px; }
.visual-simulation-page .sim-left-rail { flex: 0 1 310px; min-width: 270px; }
.visual-simulation-page .sim-main { flex: 1 1 0; min-width: 0; }
.visual-simulation-page .v-card { box-shadow: none !important; border: 1px solid #d8e2ed !important; border-radius: 6px !important; background: #fbfdff !important; }
.visual-simulation-page .v-card__title { color: #52677f; font-size: 14px; font-weight: 700; padding-bottom: 4px; }
.visual-simulation-page .v-card__text { padding-top: 4px; }
.visual-simulation-page .v-btn { color: #172033; border-color: #cbd7e6; background: #f7faff; box-shadow: none; }
.visual-simulation-page .v-btn.primary { background: #0f766e !important; border-color: #0f766e !important; }
.visual-simulation-page .v-input input { color: #172033; }
.visual-simulation-page .sim-html { width: 100%; }
.visual-simulation-page .sim-section-title, .visual-simulation-page .sim-detail-title { margin: 2px 0 9px; color: #52677f; font-size: 14px; font-weight: 700; }
.visual-simulation-page .sim-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.visual-simulation-page .sim-metric { min-height: 64px; padding: 9px; border: 1px solid #d8e2ed; border-radius: 6px; background: #fbfdff; }
.visual-simulation-page .sim-metric span, .visual-simulation-page .sim-resource span, .visual-simulation-page .sim-detail-row span, .visual-simulation-page .sim-detail-row small { display: block; color: #64748b; font-size: 12px; }
.visual-simulation-page .sim-metric strong { display: block; margin-top: 4px; font-size: 18px; }
.visual-simulation-page .sim-resource-list, .visual-simulation-page .sim-event-list, .visual-simulation-page .sim-detail-list { display: grid; gap: 7px; }
.visual-simulation-page .sim-resource, .visual-simulation-page .sim-event, .visual-simulation-page .sim-detail-row { padding: 9px; border: 1px solid #d8e2ed; border-radius: 6px; background: #fbfdff; }
.visual-simulation-page .sim-resource strong, .visual-simulation-page .sim-detail-row strong { display: block; margin-bottom: 3px; font-size: 13px; }
.visual-simulation-page .sim-resource i { display: block; height: 6px; margin-top: 7px; overflow: hidden; border-radius: 99px; background: #e4ebf3; }
.visual-simulation-page .sim-resource i b { display: block; height: 100%; border-radius: inherit; background: #63d4c5; }
.visual-simulation-page .sim-view-tabs { display: inline-flex; width: fit-content; margin-bottom: 2px; border: 1px solid #cbd7e6; border-radius: 6px; overflow: hidden; }
.visual-simulation-page .sim-view-tabs .v-btn { min-width: 102px; border: 0; border-radius: 0; color: #172033 !important; background: #ffffff !important; }
.visual-simulation-page .sim-view-tabs .v-btn--active { background: #0f766e !important; }
.visual-simulation-page .sim-stage-card { background: #ffffff !important; }
.visual-simulation-page .sim-stage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 50px; padding: 2px 0 10px; }
.visual-simulation-page .sim-stage-heading span { display: block; color: #64748b; font-size: 12px; }
.visual-simulation-page .sim-stage-heading strong { font-size: 16px; }
.visual-simulation-page .sim-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #52677f; font-size: 12px; }
.visual-simulation-page .sim-legend i { width: 9px; height: 9px; border-radius: 999px; }
.visual-simulation-page .sim-legend .available { background: #bcc6cf; }.visual-simulation-page .sim-legend .support { background: #f4c95d; }.visual-simulation-page .sim-legend .mission { background: #6ab7ff; }.visual-simulation-page .sim-legend .maintenance { background: #ff7d73; }
.visual-simulation-page .sim-aircraft-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 8px; min-height: 220px; padding: 14px; border: 1px solid #d8e2ed; border-radius: 6px; background-image: linear-gradient(90deg, rgba(100,116,139,.08) 1px, transparent 1px), linear-gradient(0deg, rgba(100,116,139,.06) 1px, transparent 1px); background-color: #f8fbff; background-size: 44px 44px; }
.visual-simulation-page .sim-aircraft-node { position: relative; justify-content: center; color: #172033 !important; background: #ffffff !important; font-weight: 700; }.visual-simulation-page .sim-aircraft-node.available { border-left: 4px solid #94a3b8; }.visual-simulation-page .sim-aircraft-node.support { border-left: 4px solid #d97706; }.visual-simulation-page .sim-aircraft-node.mission { border-left: 4px solid #2563eb; }.visual-simulation-page .sim-aircraft-node.maintenance { border-left: 4px solid #dc2626; }.visual-simulation-page .sim-aircraft-node.selected { outline: 1px solid #0f766e; }
.visual-simulation-page .sim-timeline { padding-top: 2px; }.visual-simulation-page .sim-timeline-title { margin: 8px 0; color: #52677f; font-size: 13px; font-weight: 700; }.visual-simulation-page .sim-mission-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }.visual-simulation-page .sim-mission { position: relative; min-height: 92px; padding: 9px; border: 1px solid #d8e2ed; border-radius: 6px; background: #fbfdff; }.visual-simulation-page .sim-mission span, .visual-simulation-page .sim-mission small { display: block; color: #64748b; font-size: 12px; }.visual-simulation-page .sim-mission strong { display: block; margin: 4px 0; font-size: 13px; }.visual-simulation-page .sim-mission em { display: inline-block; margin-top: 4px; color: #0f766e; font-size: 12px; font-style: normal; }.visual-simulation-page .sim-mission em.failed, .visual-simulation-page .sim-mission em.cancelled { color: #dc2626; }
.visual-simulation-page .sim-table-wrap { overflow-x: auto; }.visual-simulation-page .sim-table { width: 100%; border-collapse: collapse; font-size: 13px; }.visual-simulation-page .sim-table th, .visual-simulation-page .sim-table td { padding: 8px; border-bottom: 1px solid #d8e2ed; text-align: left; }.visual-simulation-page .sim-table th { color: #52677f; background: #f3f7fb; font-weight: 700; }.visual-simulation-page .sim-state { display: inline-block; padding: 2px 6px; border-radius: 99px; font-size: 12px; }.visual-simulation-page .sim-state.available { color: #475569; background: #e2e8f0; }.visual-simulation-page .sim-state.support { color: #a16207; background: #fef3c7; }.visual-simulation-page .sim-state.mission { color: #1d4ed8; background: #dbeafe; }.visual-simulation-page .sim-state.maintenance { color: #b91c1c; background: #fee2e2; }
.visual-simulation-page .sim-support-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 14px; }.visual-simulation-page .sim-support-card { padding: 10px; border: 1px solid #d8e2ed; border-radius: 6px; background: #fbfdff; }.visual-simulation-page .sim-support-card strong, .visual-simulation-page .sim-support-card span { display: block; }.visual-simulation-page .sim-support-card span { margin-top: 5px; color: #64748b; font-size: 12px; }
.visual-simulation-page .sim-event span, .visual-simulation-page .sim-event p { color: #64748b; font-size: 12px; }.visual-simulation-page .sim-event strong { display: block; margin: 3px 0; color: #0f766e; font-size: 12px; }.visual-simulation-page .sim-event p { margin: 0; line-height: 1.4; }.visual-simulation-page .sim-empty { padding: 10px; color: #64748b; border: 1px dashed #cbd7e6; border-radius: 6px; font-size: 13px; }
@media (max-width: 840px) { .visual-simulation-page { padding: 8px; }.visual-simulation-page .sim-control-actions { flex-basis: 100% !important; padding-bottom: 0; }.visual-simulation-page .sim-left-rail, .visual-simulation-page .sim-detail-card { flex-basis: 100%; }.visual-simulation-page .sim-content-row { flex-wrap: wrap !important; }.visual-simulation-page .sim-aircraft-board { min-height: 160px; }.visual-simulation-page .sim-stage-heading { align-items: flex-start; flex-direction: column; } }
"""


@solara.component
def Page() -> None:
    router = solara.use_router()
    query = parse_qs(router.search or "", keep_blank_values=True)
    try:
        input_mode, input_id, runtime_config = _query_input_request(query)
    except ValueError as exc:
        solara.Markdown(f"### Solara 推演输入加载失败\n\n{exc}")
        return
    if input_mode == "visualization_session":
        capability_token = runtime_config["visualization_session_token"]
        playback_speed = runtime_config["playback_speed"]
        input_loader = lambda: _safe_visualization_session_inputs(
            input_id,
            capability_token,
            playback_speed,
        )
        token_fingerprint = hashlib.sha256(
            capability_token.encode("utf-8")
        ).hexdigest()
        input_key = (
            f"visualization-session:{input_id}:"
            f"{token_fingerprint}:{playback_speed}"
        )
    else:
        input_loader = lambda: _safe_model_inputs(
            input_id,
            runtime_config=runtime_config,
        )
        input_key = (
            f"project:{input_id}:"
            f"{json.dumps(runtime_config, ensure_ascii=False, sort_keys=True)}"
        )
    inputs, source, error = solara.use_memo(input_loader, [input_key])
    if error or inputs is None:
        solara.Markdown(f"### Solara 推演输入加载失败\n\n{error or '未知错误'}")
        return
    solara.Style(VISUAL_SIMULATION_STYLE + """
        a[href*="solara.dev"], .solara-watermark { display: none !important; }
        .v-main__wrap { padding-bottom: 0; background: #f3f7fb; }
    """)
    model_state = solara.use_reactive(_new_model(inputs))  # noqa: SH101
    with solara.Column(classes=["visual-simulation-page"], gap="12px", style="width:100%;"):
        ControlPanel(model_state, inputs, runtime=(source or {}).get("runtime"))
        with solara.Row(classes=["sim-layout"], gap="12px", style="width:100%; flex-wrap:wrap;"):
            with solara.Column(classes=["sim-left-rail"], gap="12px"):
                MetricsPanel(model_state.value)
                ResourceOverviewPanel(model_state.value)
                with solara.Card(MODEL_PARAMETERS_TITLE, margin=0):
                    ModelParametersPanel(inputs)
                with solara.Card(INFORMATION_TITLE, margin=0):
                    InformationPanel(model_state.value)
            with solara.Column(classes=["sim-main"], gap="12px"):
                VisualPanelTabs(model_state.value)
