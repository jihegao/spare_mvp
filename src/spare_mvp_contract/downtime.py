"""Canonical user-facing downtime event fields shared by analysis projections."""

from __future__ import annotations

import copy
import math
from typing import Any


DOWNTIME_FACTOR_LABELS = {
    "failure": "装备故障",
    "equipment_shortage": "保障设备短缺",
    "spare_shortage": "备件短缺",
    "preventive": "预防性维修",
}

_DOWNTIME_DESCRIPTIONS = {
    "failure": "装备发生故障，当前不可用并等待修复",
    "equipment_shortage": "保障设备不足，当前作业正在等待资源",
    "spare_shortage": "所需备件短缺，当前作业正在等待补给",
    "preventive": "装备正在执行预防性维修",
}

_PHASE_LABELS = {
    "preflight": "飞行前保障",
    "flight": "任务执行",
    "mission": "任务执行",
    "repair": "修复性维修",
    "corrective": "修复性维修",
    "postflight": "飞行后保障",
    "preventive": "预防性维修",
    "waiting": "等待保障资源",
    "transport": "备件运输",
}

_HIDDEN_ANALYSIS_KEYS = {"failure_mode", "failureMode", "故障模式"}


def sanitize_downtime_user_projection(value: Any) -> Any:
    """Return a detached downtime projection without user-hidden fault-mode fields."""

    if isinstance(value, dict):
        return {
            key: sanitize_downtime_user_projection(item)
            for key, item in value.items()
            if key not in _HIDDEN_ANALYSIS_KEYS
        }
    if isinstance(value, list):
        return [sanitize_downtime_user_projection(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_downtime_user_projection(item) for item in value)
    return copy.deepcopy(value)


def format_simulation_minute(value: Any, *, empty: str = "暂无时间") -> str:
    """Format a simulation minute as the single user-facing DAY_n HH:MM form."""

    if value in (None, "") or isinstance(value, bool):
        return empty
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return empty
    if not math.isfinite(numeric) or numeric < 0:
        return empty
    minute = int(round(numeric))
    day, minute_of_day = divmod(minute, 1440)
    hour, minute_within_hour = divmod(minute_of_day, 60)
    return f"DAY_{day + 1} {hour:02d}:{minute_within_hour:02d}"


def normalize_downtime_event_for_analysis(event: dict[str, Any]) -> dict[str, Any]:
    """Preserve trace fields while adding stable Chinese analysis display fields."""

    item = sanitize_downtime_user_projection(event)
    factor = str(_first(item, "factor", "event_type", "eventType", "reason") or "").strip()
    mission_id = _text(_first(item, "mission_id", "missionId", "task_id", "taskId"))
    mission_name = _text(
        _first(item, "mission_name", "missionName", "basic_task_name", "basicTaskName", "task_label", "taskLabel")
    )
    phase_id = _text(_first(item, "mission_phase_id", "missionPhaseId", "phase_id", "phaseId"))
    phase_source = _text(
        _first(
            item,
            "mission_phase_name",
            "missionPhaseName",
            "phase_name",
            "phaseName",
            "task_name",
            "taskName",
            "mission_phase",
            "missionPhase",
            "phase_id",
            "phaseId",
        )
    )
    phase_name = _localized_phase(phase_source)
    start_minute = _first(item, "start_minute", "startMinute", "start_time", "startTime")
    end_minute = _first(item, "end_minute", "endMinute", "end_time", "endTime")
    details = item.get("details") if isinstance(item.get("details"), dict) else {}
    details = copy.deepcopy(details)
    failure_minute = _first(details, "failure_minute", "failureMinute", "failure_time", "failureTime")
    repair_completed_minute = _first(
        details,
        "repair_completed_minute",
        "repairCompletedMinute",
        "repair_completed_time",
        "repairCompletedTime",
    )
    details["failure_minute"] = failure_minute
    details["repair_completed_minute"] = repair_completed_minute
    details["failure_time_label"] = format_simulation_minute(failure_minute)
    details["repair_completed_time_label"] = format_simulation_minute(repair_completed_minute)

    tail_number = _text(_first(item, "tail_number", "tailNumber"))
    subject = f"飞机{tail_number}" if tail_number else "当前装备"
    item.update(
        {
            "factor": factor,
            "factor_label": DOWNTIME_FACTOR_LABELS.get(factor, "其他停机因素"),
            "mission_id": mission_id or None,
            "mission_name": mission_name or None,
            "mission_phase_id": phase_id or None,
            "mission_phase_name": phase_name or None,
            "task_phase_label": _task_phase_label(mission_id, mission_name, phase_name),
            "start_minute": start_minute,
            "end_minute": end_minute,
            "start_time_label": format_simulation_minute(start_minute),
            "end_time_label": format_simulation_minute(end_minute),
            "description": f"{subject}{_DOWNTIME_DESCRIPTIONS.get(factor, '记录到未识别的停机事件')}",
            "details": details,
        }
    )
    return item


def _task_phase_label(mission_id: str, mission_name: str, phase_name: str) -> str:
    if not mission_id and not mission_name:
        return f"任务外事件；阶段：{phase_name}" if phase_name else "不在任务阶段"
    task_label = mission_name or "任务名称未解析"
    return f"{task_label}；阶段：{phase_name or '未记录'}"


def _localized_phase(value: str) -> str:
    if not value:
        return ""
    mapped = _PHASE_LABELS.get(value.casefold())
    if mapped:
        return mapped
    return value if any("\u3400" <= char <= "\u9fff" for char in value) else "其他阶段"


def _first(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return None


def _text(value: Any) -> str:
    return str(value or "").strip()
