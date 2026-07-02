"""Controlled current-analysis profile config for formal Scenario overrides."""

from __future__ import annotations

import copy
from math import isfinite
from typing import Any

from src.spare_mvp_backend.errors import RunServiceError


ANALYSIS_PROFILE_SCHEMA_VERSION = "analysis-profile-config-v0"
ANALYSIS_TYPES = {"spare_shortfall", "carry_list", "mission_reliability", "downtime_factors"}
MAX_OVERRIDE_QUANTITY = 1_000_000
MAX_MISSION_DURATION_MINUTES = 10 * 365 * 24 * 60


def normalize_analysis_profile_config(plan_config: dict[str, Any]) -> dict[str, Any]:
    """Return the controlled current-profile config stored on ExperimentPlan.config."""
    if not isinstance(plan_config, dict):
        return {}
    analysis_type = str(plan_config.get("analysisType") or plan_config.get("analysis_type") or "").strip()
    has_profile_fields = any(key in plan_config for key in ("scenarioOverrides", "scenario_overrides", "carryListConfig", "carry_list_config"))
    if not analysis_type and not has_profile_fields:
        return {}
    if analysis_type not in ANALYSIS_TYPES:
        raise RunServiceError(
            "bad_run_request",
            "ExperimentPlan.config.analysisType must be one of the current analysis page types",
            field="ExperimentPlan.config.analysisType",
            analysis_type=analysis_type,
            allowed=sorted(ANALYSIS_TYPES),
        )

    raw_overrides = _optional_dict(
        plan_config.get("scenarioOverrides", plan_config.get("scenario_overrides", {})),
        "ExperimentPlan.config.scenarioOverrides",
    )
    scenario_overrides: dict[str, Any] = {}
    spares = _spares_by_support_point(raw_overrides.get("sparesBySupportPoint", raw_overrides.get("spares_by_support_point", [])))
    if spares:
        scenario_overrides["sparesBySupportPoint"] = spares
    if "missionDurationMinutes" in raw_overrides or "mission_duration_minutes" in raw_overrides:
        scenario_overrides["missionDurationMinutes"] = _positive_int(
            raw_overrides.get("missionDurationMinutes", raw_overrides.get("mission_duration_minutes")),
            field_path="ExperimentPlan.config.scenarioOverrides.missionDurationMinutes",
            max_value=MAX_MISSION_DURATION_MINUTES,
        )

    profile: dict[str, Any] = {
        "schema_version": ANALYSIS_PROFILE_SCHEMA_VERSION,
        "analysis_type": analysis_type,
        "scenarioOverrides": scenario_overrides,
    }
    raw_carry = _optional_dict(
        plan_config.get("carryListConfig", plan_config.get("carry_list_config", {})),
        "ExperimentPlan.config.carryListConfig",
    )
    if raw_carry and analysis_type != "carry_list":
        raise RunServiceError(
            "bad_run_request",
            "ExperimentPlan.config.carryListConfig is only supported for analysisType=carry_list",
            field="ExperimentPlan.config.carryListConfig",
            analysis_type=analysis_type,
        )
    if analysis_type == "carry_list" and raw_carry:
        profile["carryListConfig"] = {
            "missionConfidenceTarget": _confidence_target(
                raw_carry.get("missionConfidenceTarget", raw_carry.get("mission_confidence_target")),
                field_path="ExperimentPlan.config.carryListConfig.missionConfidenceTarget",
            )
        }
    return profile


def apply_analysis_profile_to_scenario(scenario: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Apply controlled overrides to a compiled run-scoped Scenario in place."""
    if not profile:
        return {}
    if scenario.get("simulation_model", {}).get("family") != "aircraft_support_v1":
        return {}
    inputs = scenario.get("simulation_inputs")
    if not isinstance(inputs, dict):
        raise RunServiceError("bad_run_request", "compiled Scenario is missing simulation_inputs")

    applied = copy.deepcopy(profile)
    applied["source"] = "ExperimentPlan.config"
    applied["applied_to"] = "compiled Scenario"
    overrides = applied.setdefault("scenarioOverrides", {})
    raw_overrides = profile.get("scenarioOverrides") if isinstance(profile.get("scenarioOverrides"), dict) else {}

    applied_spares = []
    for item in raw_overrides.get("sparesBySupportPoint", []):
        applied_spares.append(_apply_spare_override(inputs, item))
    if applied_spares:
        overrides["sparesBySupportPoint"] = applied_spares

    if "missionDurationMinutes" in raw_overrides:
        baseline_duration = _current_duration_minutes(inputs)
        override_duration = int(raw_overrides["missionDurationMinutes"])
        _set_duration_minutes(inputs, override_duration)
        overrides["missionDurationMinutes"] = {
            "baselineMinutes": baseline_duration,
            "overrideMinutes": override_duration,
        }

    if profile.get("carryListConfig") and profile.get("analysis_type") == "carry_list":
        applied["carryListConfig"] = copy.deepcopy(profile["carryListConfig"])

    inputs["analysis_profile"] = copy.deepcopy(applied)
    scenario["analysis_profile"] = copy.deepcopy(applied)
    provenance = scenario.get("compiled_from", {}).get("mapping_provenance")
    if isinstance(provenance, dict):
        provenance["analysis_profile"] = copy.deepcopy(applied)
    return applied


def _spares_by_support_point(values: Any) -> list[dict[str, Any]]:
    if values in (None, ""):
        return []
    if not isinstance(values, list):
        raise RunServiceError(
            "bad_run_request",
            "ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint must be an array",
            field="ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint",
        )
    normalized = []
    seen = set()
    for index, item in enumerate(values):
        if not isinstance(item, dict):
            raise RunServiceError(
                "bad_run_request",
                "sparesBySupportPoint entries must be objects",
                field=f"ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint[{index}]",
            )
        support_point_id = _required_string(
            item.get("supportPointId", item.get("support_point_id")),
            f"ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint[{index}].supportPointId",
        )
        spare_type_id = _required_string(
            item.get("spareTypeId", item.get("spare_type_id")),
            f"ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint[{index}].spareTypeId",
        )
        key = (support_point_id, spare_type_id)
        if key in seen:
            raise RunServiceError(
                "bad_run_request",
                "sparesBySupportPoint cannot repeat the same support point and spare type",
                field=f"ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint[{index}]",
                support_point_id=support_point_id,
                spare_type_id=spare_type_id,
            )
        seen.add(key)
        normalized.append(
            {
                "supportPointId": support_point_id,
                "spareTypeId": spare_type_id,
                "quantity": _non_negative_int(
                    item.get("quantity"),
                    field_path=f"ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint[{index}].quantity",
                    max_value=MAX_OVERRIDE_QUANTITY,
                ),
            }
        )
    return normalized


def _apply_spare_override(inputs: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    support_point_id = override["supportPointId"]
    spare_type_id = override["spareTypeId"]
    nodes = inputs.get("support_network", {}).get("nodes", [])
    if not isinstance(nodes, list):
        raise RunServiceError("bad_run_request", "compiled Scenario support_network.nodes must be an array")
    for node in nodes:
        if not isinstance(node, dict) or str(node.get("id") or "") != support_point_id:
            continue
        inventory = node.get("inventory")
        if not isinstance(inventory, dict):
            raise RunServiceError(
                "bad_run_request",
                "support point inventory is not available for scenario override",
                field="ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint",
                support_point_id=support_point_id,
            )
        if spare_type_id not in inventory:
            raise RunServiceError(
                "bad_run_request",
                "spare type is not present in the compiled Scenario support point inventory",
                field="ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint",
                support_point_id=support_point_id,
                spare_type_id=spare_type_id,
            )
        baseline = int(inventory.get(spare_type_id) or 0)
        quantity = int(override["quantity"])
        inventory[spare_type_id] = quantity
        return {
            "supportPointId": support_point_id,
            "spareTypeId": spare_type_id,
            "baselineQuantity": baseline,
            "quantity": quantity,
        }
    raise RunServiceError(
        "bad_run_request",
        "support point is not present in the compiled Scenario",
        field="ExperimentPlan.config.scenarioOverrides.sparesBySupportPoint",
        support_point_id=support_point_id,
    )


def _current_duration_minutes(inputs: dict[str, Any]) -> int | None:
    mission_profile = inputs.get("mission_profile") if isinstance(inputs.get("mission_profile"), dict) else {}
    time_config = inputs.get("time") if isinstance(inputs.get("time"), dict) else {}
    value = mission_profile.get("duration_minutes", time_config.get("duration_minutes"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _set_duration_minutes(inputs: dict[str, Any], minutes: int) -> None:
    mission_profile = inputs.setdefault("mission_profile", {})
    time_config = inputs.setdefault("time", {})
    if isinstance(mission_profile, dict):
        mission_profile["duration_minutes"] = minutes
    if isinstance(time_config, dict):
        time_config["duration_minutes"] = minutes


def _optional_dict(value: Any, field_path: str) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise RunServiceError("bad_run_request", f"{field_path} must be an object", field=field_path)
    return value


def _required_string(value: Any, field_path: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise RunServiceError("bad_run_request", f"{field_path} is required", field=field_path)
    return text


def _positive_int(value: Any, *, field_path: str, max_value: int) -> int:
    parsed = _integer(value, field_path)
    if parsed < 1 or parsed > max_value:
        raise RunServiceError(
            "bad_run_request",
            f"{field_path} must be between 1 and {max_value}",
            field=field_path,
            minimum=1,
            maximum=max_value,
        )
    return parsed


def _non_negative_int(value: Any, *, field_path: str, max_value: int) -> int:
    parsed = _integer(value, field_path)
    if parsed < 0 or parsed > max_value:
        raise RunServiceError(
            "bad_run_request",
            f"{field_path} must be between 0 and {max_value}",
            field=field_path,
            minimum=0,
            maximum=max_value,
        )
    return parsed


def _integer(value: Any, field_path: str) -> int:
    if isinstance(value, bool):
        raise RunServiceError("bad_run_request", f"{field_path} must be an integer", field=field_path)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RunServiceError("bad_run_request", f"{field_path} must be an integer", field=field_path) from exc
    if not isfinite(number) or not number.is_integer():
        raise RunServiceError("bad_run_request", f"{field_path} must be an integer", field=field_path)
    return int(number)


def _confidence_target(value: Any, *, field_path: str) -> float:
    if isinstance(value, bool):
        raise RunServiceError("bad_run_request", f"{field_path} must be a number between 0 and 1", field=field_path)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RunServiceError("bad_run_request", f"{field_path} must be a number between 0 and 1", field=field_path) from exc
    if not isfinite(number) or number <= 0 or number > 1:
        raise RunServiceError("bad_run_request", f"{field_path} must be a number between 0 and 1", field=field_path)
    return number
