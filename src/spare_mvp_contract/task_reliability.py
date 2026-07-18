"""Stable result fields for task reliability analysis consumers."""

from __future__ import annotations

from typing import Any


TASK_RELIABILITY_RESULT_FIELD_ORDER = (
    "sortie_rate",
    "wave_success_rate",
    "period_completion_probability",
    "period_duration_days",
)


def build_task_reliability_result_fields(
    *,
    sortie_rate: Any,
    wave_success_rate: Any,
    period_completion_probability: Any,
    period_duration_days: Any,
) -> list[dict[str, Any]]:
    """Return the one ordered display/export contract for task reliability."""
    sortie = _number(sortie_rate)
    wave_success = _ratio(wave_success_rate)
    period_reliability = _ratio(period_completion_probability)
    duration = _positive_number_or_none(period_duration_days)
    return [
        {
            "key": "sortie_rate",
            "label": "出动架次率",
            "value": sortie,
            "display_value": f"{sortie:.3f}",
            "unit": "",
        },
        {
            "key": "wave_success_rate",
            "label": "波次成功率",
            "value": wave_success,
            "display_value": format_reliability_percent(wave_success),
            "unit": "%",
        },
        {
            "key": "period_completion_probability",
            "label": "整周期任务可靠度",
            "value": period_reliability,
            "display_value": format_reliability_percent(period_reliability),
            "unit": "%",
        },
        {
            "key": "period_duration_days",
            "label": "任务周期",
            "value": duration,
            "display_value": format_task_period_days(duration),
            "unit": "天" if duration is not None else "",
        },
    ]


def task_reliability_metrics(result_fields: list[dict[str, Any]]) -> list[list[str]]:
    """Project ordered result fields into the existing metric-pair transport."""
    by_key = {str(field.get("key") or ""): field for field in result_fields}
    return [
        [str(by_key[key]["label"]), str(by_key[key]["display_value"])]
        for key in TASK_RELIABILITY_RESULT_FIELD_ORDER
    ]


def format_reliability_percent(value: Any) -> str:
    """Format ratios or already-percent values once, with at most one decimal."""
    if isinstance(value, str) and value.strip().endswith("%"):
        numeric = _number(value.strip()[:-1])
    else:
        numeric = _number(value)
        if abs(numeric) <= 1:
            numeric *= 100
    rounded = round(numeric, 1)
    text = f"{rounded:.1f}".rstrip("0").rstrip(".")
    return f"{text}%"


def format_task_period_days(value: Any) -> str:
    duration = _positive_number_or_none(value)
    if duration is None:
        return "--"
    text = f"{duration:.2f}".rstrip("0").rstrip(".")
    return f"{text} 天"


def _ratio(value: Any) -> float:
    if isinstance(value, str) and value.strip().endswith("%"):
        return min(1.0, max(0.0, _number(value.strip()[:-1]) / 100))
    numeric = _number(value)
    if numeric > 1:
        numeric /= 100
    return min(1.0, max(0.0, numeric))


def _positive_number_or_none(value: Any) -> float | None:
    numeric = _number(value)
    return numeric if numeric > 0 else None


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
