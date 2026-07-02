"""Canonical Monte Carlo run config normalization for ExperimentPlan-backed runs."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from math import isfinite
from typing import Any

from src.spare_mvp_backend.errors import RunServiceError


MAX_MONTE_CARLO_SAMPLES = 1000
MAX_SUPPORT_CAPACITY = 1_000_000
_FORBIDDEN_REQUEST_CONFIG_FIELDS = (
    "sample_count",
    "sampleCount",
    "samples",
    "sweep",
    "monte_carlo",
    "monteCarlo",
    "analysisRequests",
    "largeSample",
)


@dataclass(frozen=True)
class MonteCarloRunConfig:
    """Normalized config consumed by the simulation adapter."""

    sample_count: int
    sweep: dict[str, list[float] | list[int]]
    mc_experiment_id: str | None = None
    analysis_type: str = ""
    scenario_overrides: dict[str, Any] | None = None
    carry_list_config: dict[str, Any] | None = None

    def to_adapter_payload(self) -> dict[str, Any]:
        payload = {
            "sample_count": self.sample_count,
            "sweep": {
                "failureRates": list(self.sweep["failureRates"]),
                "spareMultipliers": list(self.sweep["spareMultipliers"]),
                "supportCapacities": list(self.sweep["supportCapacities"]),
            },
        }
        if self.mc_experiment_id:
            payload["mc_experiment_id"] = self.mc_experiment_id
        if self.analysis_type == "carry_list":
            if self.scenario_overrides:
                payload["scenarioOverrides"] = dict(self.scenario_overrides)
            if self.carry_list_config:
                payload["carryListConfig"] = dict(self.carry_list_config)
        return payload


def reject_request_level_monte_carlo_config(request: dict[str, Any]) -> None:
    """Reject request-level MC numeric config for formal ExperimentPlan runs."""
    forbidden = [field for field in _FORBIDDEN_REQUEST_CONFIG_FIELDS if field in request]
    if forbidden:
        raise RunServiceError(
            "bad_run_request",
            "Monte Carlo numeric config must be stored under ExperimentPlan.config.analysisRequests.largeSample",
            fields=forbidden,
            field="ExperimentPlan.config.analysisRequests.largeSample",
        )


def normalize_monte_carlo_run_config(
    plan_config: dict[str, Any],
    *,
    mc_experiment_id: str | None = None,
    analysis_type: str | None = None,
) -> MonteCarloRunConfig:
    """Normalize the only supported formal MC numeric config source."""
    analysis_requests = _require_dict(plan_config.get("analysisRequests"), "analysisRequests")
    large_sample = _require_dict(analysis_requests.get("largeSample"), "analysisRequests.largeSample")
    if large_sample.get("enabled") is not True:
        raise RunServiceError(
            "bad_run_request",
            "analysisRequests.largeSample.enabled must be true for run_type=monte_carlo",
            field="analysisRequests.largeSample.enabled",
        )

    sample_count = _positive_int(
        large_sample.get("samples"),
        field_path="analysisRequests.largeSample.samples",
        max_value=MAX_MONTE_CARLO_SAMPLES,
    )
    sweep = _require_dict(large_sample.get("sweep"), "analysisRequests.largeSample.sweep")
    normalized_analysis_type = str(analysis_type or "").strip()
    scenario_overrides, carry_list_config = _carry_list_current_result_config(
        analysis_requests,
        normalized_analysis_type,
    )
    return MonteCarloRunConfig(
        sample_count=sample_count,
        sweep={
            "failureRates": _positive_numbers(
                sweep.get("failureRates"),
                "analysisRequests.largeSample.sweep.failureRates",
            ),
            "spareMultipliers": _positive_numbers(
                sweep.get("spareMultipliers"),
                "analysisRequests.largeSample.sweep.spareMultipliers",
            ),
            "supportCapacities": _positive_int_list(
                sweep.get("supportCapacities"),
                "analysisRequests.largeSample.sweep.supportCapacities",
            ),
        },
        mc_experiment_id=mc_experiment_id,
        analysis_type=normalized_analysis_type,
        scenario_overrides=scenario_overrides,
        carry_list_config=carry_list_config,
    )


def _carry_list_current_result_config(
    analysis_requests: dict[str, Any],
    analysis_type: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if analysis_type != "carry_list":
        return None, None
    carry_list = analysis_requests.get("carryList")
    if not isinstance(carry_list, dict):
        return None, None
    return (
        _normalized_carry_list_scenario_overrides(carry_list.get("scenarioOverrides")),
        _normalized_carry_list_config(carry_list.get("carryListConfig")),
    )


def _normalized_carry_list_scenario_overrides(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    normalized: dict[str, Any] = {}
    spares_by_support_point = value.get("sparesBySupportPoint")
    if isinstance(spares_by_support_point, (dict, list)):
        normalized["sparesBySupportPoint"] = copy.deepcopy(spares_by_support_point)
    if "missionDurationMinutes" in value:
        normalized["missionDurationMinutes"] = _positive_int(
            value.get("missionDurationMinutes"),
            field_path="analysisRequests.carryList.scenarioOverrides.missionDurationMinutes",
            max_value=10_000_000,
        )
    return normalized or None


def _normalized_carry_list_config(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    normalized: dict[str, Any] = {}
    if "missionConfidenceTarget" in value:
        normalized["missionConfidenceTarget"] = _positive_probability(
            value.get("missionConfidenceTarget"),
            field_path="analysisRequests.carryList.carryListConfig.missionConfidenceTarget",
        )
    return normalized or None


def _positive_probability(value: Any, *, field_path: str) -> float:
    if isinstance(value, bool):
        raise RunServiceError("bad_run_request", f"{field_path} must be between 0 and 1", field=field_path)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RunServiceError("bad_run_request", f"{field_path} must be between 0 and 1", field=field_path) from exc
    if not isfinite(number) or number <= 0 or number > 1:
        raise RunServiceError(
            "bad_run_request",
            f"{field_path} must be between 0 and 1",
            field=field_path,
            minimum=0,
            maximum=1,
        )
    return number


def _require_dict(value: Any, field_path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RunServiceError("bad_run_request", f"{field_path} must be an object", field=field_path)
    return value


def _positive_int(value: Any, *, field_path: str, max_value: int) -> int:
    if isinstance(value, bool):
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path) from exc
    if not isfinite(number) or not number.is_integer():
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path)
    parsed = int(number)
    if parsed < 1 or parsed > max_value:
        raise RunServiceError(
            "bad_run_request",
            f"{field_path} must be between 1 and {max_value}",
            field=field_path,
            minimum=1,
            maximum=max_value,
        )
    return parsed


def _positive_numbers(values: Any, field_path: str) -> list[float]:
    if not isinstance(values, list) or not values:
        raise RunServiceError("bad_run_request", f"{field_path} must be a non-empty number array", field=field_path)
    parsed = []
    for value in values:
        if isinstance(value, bool):
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path)
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path) from exc
        if not isfinite(number) or number <= 0:
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path)
        parsed.append(number)
    return parsed


def _positive_int_list(values: Any, field_path: str) -> list[int]:
    if not isinstance(values, list) or not values:
        raise RunServiceError("bad_run_request", f"{field_path} must be a non-empty integer array", field=field_path)
    return [_positive_int(value, field_path=field_path, max_value=MAX_SUPPORT_CAPACITY) for value in values]
