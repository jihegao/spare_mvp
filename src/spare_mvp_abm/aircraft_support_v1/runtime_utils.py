"""Pure normalization helpers shared by aircraft-support v1 runtime modules."""

from __future__ import annotations

import math
from typing import Any

from .component_index import aircraft_type_tokens


def _time_to_minute(value: Any, fallback: int) -> int:
    if not isinstance(value, str) or ":" not in value:
        return fallback
    hour, minute, *_ = value.split(":") + ["0"]
    try:
        return max(0, int(hour) * 60 + int(minute))
    except ValueError:
        return fallback


def _truthy_input_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _normalized_stop_policy(value: Any, duration_minutes: int) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    mode = "and" if str(source.get("mode") or "").strip().lower() == "and" else "or"
    raw_conditions = source.get("conditions") if isinstance(source.get("conditions"), list) else []
    defaulted = _truthy_input_flag(source.get("defaulted")) or not isinstance(value, dict) or not raw_conditions
    conditions = [
        condition
        for raw_condition in raw_conditions
        if (condition := _normalized_stop_condition(raw_condition, duration_minutes)) is not None
    ]
    if not conditions:
        conditions = [{"type": "duration", "duration_minutes": max(1, int(duration_minutes))}]
    return {
        "schema_version": str(source.get("schema_version") or source.get("schemaVersion") or "stop-policy-v0"),
        "mode": mode,
        "conditions": conditions,
        "defaulted": defaulted,
    }


def _normalized_stop_condition(value: Any, duration_minutes: int) -> dict[str, Any] | None:
    if isinstance(value, str):
        value = {"type": value}
    if not isinstance(value, dict):
        return None
    condition_type = _stop_condition_type(value.get("type"))
    if condition_type == "duration":
        duration = _positive_int(value.get("duration_minutes") or value.get("durationMinutes"), max(1, int(duration_minutes)))
        return {"type": "duration", "duration_minutes": duration}
    if condition_type == "failure":
        return {"type": "failure"}
    if condition_type == "specified_time":
        minute = _positive_int(
            value.get("minute")
            or value.get("timeMinute")
            or value.get("time_minute")
            or value.get("specifiedMinute")
            or value.get("specified_minute"),
            0,
        )
        if minute <= 0:
            return None
        return {"type": "specified_time", "minute": minute}
    return None


def _stop_condition_type(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", "_")
    compact = text.replace("_", "")
    if compact in {"duration", "taskduration", "reachtaskduration", "maxduration"}:
        return "duration"
    if compact in {"failure", "taskfailure", "missionfailure"}:
        return "failure"
    if compact in {"specifiedtime", "targettime", "time", "specifiedminute"}:
        return "specified_time"
    return ""


def _resource_quantity(text: Any, explicit: Any, *, default: int) -> int:
    if isinstance(explicit, (int, float)) and explicit > 0:
        return max(1, int(explicit))
    if isinstance(text, list):
        total = 0
        for item in text:
            if not isinstance(item, dict):
                continue
            try:
                quantity = int(float(item.get("quantity", 1)))
            except (TypeError, ValueError):
                quantity = 1
            total += max(0, quantity)
        if total > 0:
            return total
    if isinstance(text, str):
        for part in reversed([item.strip() for item in text.split(",") if item.strip()]):
            if part.isdigit():
                return max(1, int(part))
    return default


def _non_negative_float(value: Any, fallback: float) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return fallback


def _non_negative_int(value: Any, fallback: int) -> int:
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return fallback


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _positive_float(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) and parsed > 0 else fallback


def _is_no_spare_value(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return text in {"", "无", "none", "null", "n/a", "na", "-", "不需要", "无需"}


_aircraft_type_tokens = aircraft_type_tokens


def _periodic_period_days(periodic: dict[str, Any]) -> int:
    for key in ("taskPeriodDays", "periodDays", "cycleDays", "repeatCycleDays"):
        parsed = _positive_int(periodic.get(key), 0)
        if parsed > 0:
            return parsed
    repeat_cycle_value = _positive_int(periodic.get("repeatCycleValue"), 0)
    if repeat_cycle_value > 0:
        unit = str(periodic.get("repeatCycleUnit") or "day").lower()
        if unit in {"week", "weeks", "周", "星期"}:
            return repeat_cycle_value * 7
        if unit in {"hour", "hours", "小时"}:
            return max(1, math.ceil(repeat_cycle_value / 24))
        return repeat_cycle_value
    return 1


def _periodic_total_days(periodic: dict[str, Any]) -> int:
    period_days = _periodic_period_days(periodic)
    repeat_count = 1
    for key in ("repeatCount", "repeatRounds", "repeatWeeks"):
        parsed = _positive_int(periodic.get(key), 0)
        if parsed > 0:
            repeat_count = parsed
            break
    return max(1, period_days * repeat_count)


_WEEKDAY_INDEXES = {
    "monday": 0,
    "mondaycompositetaskid": 0,
    "mon": 0,
    "周一": 0,
    "星期一": 0,
    "tuesday": 1,
    "tuesdaycompositetaskid": 1,
    "tue": 1,
    "周二": 1,
    "星期二": 1,
    "wednesday": 2,
    "wednesdaycompositetaskid": 2,
    "wed": 2,
    "周三": 2,
    "星期三": 2,
    "thursday": 3,
    "thursdaycompositetaskid": 3,
    "thu": 3,
    "周四": 3,
    "星期四": 3,
    "friday": 4,
    "fridaycompositetaskid": 4,
    "fri": 4,
    "周五": 4,
    "星期五": 4,
    "saturday": 5,
    "saturdaycompositetaskid": 5,
    "sat": 5,
    "周六": 5,
    "星期六": 5,
    "sunday": 6,
    "sundaycompositetaskid": 6,
    "sun": 6,
    "周日": 6,
    "星期日": 6,
    "星期天": 6,
}

_WEEKDAY_ASSIGNMENT_FIELDS = (
    "mondayCompositeTaskId",
    "tuesdayCompositeTaskId",
    "wednesdayCompositeTaskId",
    "thursdayCompositeTaskId",
    "fridayCompositeTaskId",
    "saturdayCompositeTaskId",
    "sundayCompositeTaskId",
)


def _periodic_weekday_index(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    return _WEEKDAY_INDEXES.get(text.replace("_", "").replace("-", "").lower())


def _periodic_explicit_composite_days(
    periodic: dict[str, Any],
    total_days: int,
    period_days: int,
) -> dict[str, set[int]]:
    composite_days: dict[str, set[int]] = {}
    for item in periodic.get("compositeTasks") or []:
        if not isinstance(item, dict):
            continue
        composite_id = str(item.get("compositeTaskId") or "").strip()
        if not composite_id:
            continue
        weekday_index = _periodic_weekday_index(item.get("weekday") or item.get("dayOfWeek"))
        if weekday_index is not None:
            week_index = _positive_int(item.get("weekIndex", item.get("week")), 1)
            active_day = (week_index - 1) * period_days + weekday_index
            if 0 <= active_day < total_days:
                composite_days.setdefault(composite_id, set()).add(active_day)
            continue
        period_index = _positive_int(item.get("week", item.get("weekIndex")), 1)
        start_day = max(0, (period_index - 1) * period_days)
        active_days = set(range(start_day, min(total_days, start_day + period_days)))
        if active_days:
            composite_days.setdefault(composite_id, set()).update(active_days)
    return composite_days


def _periodic_weekday_assignment_days(
    periodic: dict[str, Any],
    total_days: int,
    period_days: int,
) -> dict[str, set[int]]:
    assignments: dict[int, str] = {}
    raw_assignments = periodic.get("weekdayAssignments") if isinstance(periodic.get("weekdayAssignments"), dict) else {}
    for key, composite_id in raw_assignments.items():
        weekday_index = _periodic_weekday_index(key)
        composite_text = str(composite_id or "").strip()
        if weekday_index is not None and composite_text:
            assignments[weekday_index] = composite_text
    for key in _WEEKDAY_ASSIGNMENT_FIELDS:
        weekday_index = _periodic_weekday_index(key)
        composite_text = str(periodic.get(key) or "").strip()
        if weekday_index is not None and composite_text:
            assignments[weekday_index] = composite_text

    composite_days: dict[str, set[int]] = {}
    for start_day in range(0, total_days, max(1, period_days)):
        for weekday_index, composite_id in assignments.items():
            active_day = start_day + weekday_index
            if active_day < total_days:
                composite_days.setdefault(composite_id, set()).add(active_day)
    return composite_days


def _bounded_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(0.0, parsed))


def _success_point(value: Any) -> float:
    """Normalize the Project's 0..1 task-success point; task end is the fallback."""
    normalized = _bounded_float(value)
    return normalized if normalized is not None else 1.0


def _failure_distribution_rate(distribution: dict[str, Any]) -> float | None:
    parameters = distribution.get("parameters") or distribution.get("params")
    multiplier = _non_negative_float(distribution.get("_rate_multiplier"), 1.0)
    if isinstance(parameters, (int, float)):
        return max(0.0, float(parameters)) * multiplier
    distribution_type = str(distribution.get("distributionType") or distribution.get("distribution_type") or "").lower()
    if isinstance(parameters, str):
        values = _distribution_parameters(parameters)
        if "lambda" in values or "λ" in values or "rate" in values or "failure_rate" in values:
            return (
                values.get("lambda")
                or values.get("λ")
                or values.get("rate")
                or values.get("failure_rate")
                or 0.0
            ) * multiplier
        if "weibull" in distribution_type or "威布尔" in distribution_type:
            beta = values.get("beta") or values.get("shape") or 1.0
            eta = values.get("eta") or values.get("scale") or values.get("mean")
            if eta and eta > 0:
                mean_time = eta * math.gamma(1.0 + 1.0 / max(beta, 0.001))
                return (1.0 / mean_time) * multiplier
        if "normal" in distribution_type or "正态" in distribution_type:
            mean = values.get("mean") or values.get("mu")
            if mean and mean > 0:
                return (1.0 / mean) * multiplier
    if "exponential" in distribution_type or "指数" in distribution_type:
        rate = _non_negative_float(distribution.get("lambda") or distribution.get("rate"), 0.0)
        if rate > 0:
            return rate * multiplier
    if "normal" in distribution_type or "正态" in distribution_type:
        mean = _non_negative_float(distribution.get("mean") or distribution.get("mu"), 0.0)
        if mean > 0:
            return (1.0 / mean) * multiplier
    if "uniform" in distribution_type or "均匀" in distribution_type:
        minimum = _non_negative_float(distribution.get("min"), -1.0)
        maximum = _non_negative_float(distribution.get("max"), -1.0)
        if minimum >= 0 and maximum >= minimum and minimum + maximum > 0:
            return (2.0 / (minimum + maximum)) * multiplier
    if "fixed" in distribution_type or "固定" in distribution_type:
        if "value" in distribution:
            value = _positive_float(distribution.get("value"), 0.0)
        elif "mean" in distribution:
            value = _positive_float(distribution.get("mean"), 0.0)
        else:
            value = 0.0
        if value <= 0:
            return None
        return (1.0 / value) * multiplier
    return None


def _distribution_parameters(parameters: str) -> dict[str, float]:
    text = parameters.replace("，", ",").replace("；", ",").replace(";", ",")
    values: dict[str, float] = {}
    for item in text.split(","):
        if "=" not in item:
            continue
        key, value = [part.strip().lower() for part in item.split("=", 1)]
        values[key] = _non_negative_float(value, 0.0)
    return values

__all__ = [
    "_aircraft_type_tokens",
    "_bounded_float",
    "_distribution_parameters",
    "_failure_distribution_rate",
    "_is_no_spare_value",
    "_non_negative_float",
    "_non_negative_int",
    "_normalized_stop_condition",
    "_normalized_stop_policy",
    "_periodic_explicit_composite_days",
    "_periodic_period_days",
    "_periodic_total_days",
    "_periodic_weekday_assignment_days",
    "_periodic_weekday_index",
    "_positive_float",
    "_positive_int",
    "_resource_quantity",
    "_stop_condition_type",
    "_success_point",
    "_time_to_minute",
    "_truthy_input_flag",
]
