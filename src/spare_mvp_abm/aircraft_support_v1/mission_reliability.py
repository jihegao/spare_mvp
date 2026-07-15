"""Pure helpers for whole-period mission reliability accounting."""

from __future__ import annotations

from typing import Any, Iterable


def mission_period_outcome(missions: Iterable[Any], *, duration_days: Any) -> dict[str, Any]:
    """Describe whether every planned mission in one simulation sample succeeded."""
    mission_rows = list(missions)
    planned = len(mission_rows)
    evaluated = sum(1 for mission in mission_rows if bool(getattr(mission, "success_evaluated", False)))
    successful = sum(
        1
        for mission in mission_rows
        if bool(getattr(mission, "success_evaluated", False)) and bool(getattr(mission, "succeeded", False))
    )
    failed = max(0, planned - successful)
    return {
        "duration_days": max(0.0, _number(duration_days)),
        "planned_missions": planned,
        "evaluated_missions": evaluated,
        "successful_missions": successful,
        "failed_missions": failed,
        "period_complete": planned > 0 and evaluated == planned and successful == planned,
    }


def sample_period_outcome(sample: dict[str, Any]) -> dict[str, Any]:
    """Read the explicit outcome, with a compatibility fallback for older samples."""
    explicit = sample.get("period_outcome")
    if isinstance(explicit, dict):
        planned = max(0, _integer(explicit.get("planned_missions")))
        evaluated = max(0, _integer(explicit.get("evaluated_missions")))
        successful = max(0, _integer(explicit.get("successful_missions")))
        return {
            "duration_days": max(0.0, _number(explicit.get("duration_days"))),
            "planned_missions": planned,
            "evaluated_missions": evaluated,
            "successful_missions": successful,
            "failed_missions": max(0, planned - successful),
            "period_complete": planned > 0 and evaluated == planned and successful == planned,
        }

    daily_rows = [row for row in sample.get("daily_mission_reliability") or [] if isinstance(row, dict)]
    planned = sum(_integer(row.get("plannedWaves", row.get("planned_waves"))) for row in daily_rows)
    successful = sum(_integer(row.get("successfulWaves", row.get("successful_waves"))) for row in daily_rows)
    metrics = sample.get("metrics") if isinstance(sample.get("metrics"), dict) else {}
    if planned <= 0:
        planned = max(0, _integer(metrics.get("planned_mission_waves")))
        successful = max(0, _integer(metrics.get("successful_mission_waves")))
    duration_days = max(0.0, _number(metrics.get("simulation_days")))
    return {
        "duration_days": duration_days,
        "planned_missions": planned,
        "evaluated_missions": planned,
        "successful_missions": successful,
        "failed_missions": max(0, planned - successful),
        "period_complete": planned > 0 and successful == planned,
    }


def period_completion_summary(samples: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate whole-period outcomes using every executed sample as denominator."""
    outcomes = [sample_period_outcome(sample) for sample in samples]
    total = len(outcomes)
    successful = sum(1 for outcome in outcomes if outcome["period_complete"])
    failed = total - successful
    return {
        "total_samples": total,
        "successful_samples": successful,
        "failed_samples": failed,
        "completion_probability": successful / total if total else 0.0,
        "duration_days": max((outcome["duration_days"] for outcome in outcomes), default=0.0),
    }


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _integer(value: Any) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0
