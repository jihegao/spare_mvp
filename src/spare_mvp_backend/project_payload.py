"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any


def project_runtime_config_paths(project_json: dict[str, Any]) -> list[str]:
    """Return runtime Monte Carlo config paths that are not Project modeling data."""

    paths: list[str] = []
    _collect_project_runtime_config_paths(project_json, "", paths)
    return paths


def strip_project_sweep(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload without runtime or non-model Project fields."""

    project = deepcopy(project_json)
    _strip_project_runtime_config(project)
    _strip_project_non_model_fields(project)
    return project


def materialize_scenario_composition(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload with scenarioComposition overrides applied."""

    project = deepcopy(project_json)
    composition = project.get("scenarioComposition")
    if not isinstance(composition, dict):
        return project
    overrides = composition.get("overrides")
    if not isinstance(overrides, list):
        return project
    for override in overrides:
        if not isinstance(override, dict):
            continue
        path = str(override.get("path") or "").strip()
        if not path:
            continue
        _set_object_path(project, path, _scenario_override_value(override))
    return project


def _strip_project_runtime_config(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("monteCarlo", None)
        value.pop("analysisRequests", None)
        value.pop("experiment", None)
        value.pop("seedPolicy", None)
        value.pop("scenarioComposition", None)
        value.pop("stopPolicy", None)
        for child in value.values():
            _strip_project_runtime_config(child)
    elif isinstance(value, list):
        for item in value:
            _strip_project_runtime_config(item)


def _scenario_override_value(override: dict[str, Any]) -> Any:
    value_type = override.get("valueType")
    value = override.get("value")
    if value_type == "number":
        number = float(value)
        return int(number) if number.is_integer() else number
    if value_type == "boolean":
        return value is True or value == "true"
    if value_type == "json" and isinstance(value, str):
        return json.loads(value)
    return str(value if value is not None else "")


def _set_object_path(project: dict[str, Any], path: str, value: Any) -> None:
    parts = [part.strip() for part in path.split(".") if part.strip()]
    if not parts:
        return
    current: Any = project
    for index, part in enumerate(parts[:-1]):
        next_part = parts[index + 1]
        next_container: Any = [] if _array_index(next_part) is not None else {}
        if isinstance(current, list):
            item_index = _array_index(part)
            if item_index is None:
                raise ValueError(f"scenario override path segment must be an array index: {part}")
            while item_index >= len(current):
                current.append(deepcopy(next_container))
            if not isinstance(current[item_index], (dict, list)):
                current[item_index] = deepcopy(next_container)
            current = current[item_index]
            continue
        if not isinstance(current, dict):
            raise ValueError(f"scenario override path segment is not a container: {part}")
        if not isinstance(current.get(part), (dict, list)):
            current[part] = deepcopy(next_container)
        current = current[part]

    last_part = parts[-1]
    if isinstance(current, list):
        item_index = _array_index(last_part)
        if item_index is None:
            raise ValueError(f"scenario override path segment must be an array index: {last_part}")
        while item_index >= len(current):
            current.append(None)
        current[item_index] = deepcopy(value)
        return
    if not isinstance(current, dict):
        raise ValueError(f"scenario override target is not a container: {last_part}")
    current[last_part] = deepcopy(value)


def _array_index(value: str) -> int | None:
    if not value.isdigit():
        return None
    if len(value) > 1 and value.startswith("0"):
        return None
    return int(value)


def _strip_project_non_model_fields(project: dict[str, Any]) -> None:
    project.pop("deletedSupportResourceKeys", None)
    mission_profile = project.get("missionProfile")
    if isinstance(mission_profile, dict):
        mission_profile.pop("profileType", None)
        mission_profile.pop("endCondition", None)
        mission_profile.pop("repeatCycleHours", None)
        mission_profile.pop("analysisRequests", None)
    _strip_typo_only_support_activity_fields(project)


def _strip_typo_only_support_activity_fields(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("requireDevices", None)
        for child in value.values():
            _strip_typo_only_support_activity_fields(child)
    elif isinstance(value, list):
        for item in value:
            _strip_typo_only_support_activity_fields(item)


def _collect_project_runtime_config_paths(value: Any, path: str, paths: list[str]) -> None:
    if isinstance(value, dict):
        if "monteCarlo" in value:
            paths.append(_join_path(path, "monteCarlo"))
        if "seedPolicy" in value:
            paths.append(_join_path(path, "seedPolicy"))
        if "scenarioComposition" in value:
            paths.append(_join_path(path, "scenarioComposition"))
        if "stopPolicy" in value:
            paths.append(_join_path(path, "stopPolicy"))
        analysis_requests = value.get("analysisRequests")
        if isinstance(analysis_requests, dict) and (not path or _analysis_requests_has_sweep(analysis_requests)):
            paths.append(_join_path(path, "analysisRequests"))
        for key, child in value.items():
            _collect_project_runtime_config_paths(child, _join_path(path, str(key)), paths)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _collect_project_runtime_config_paths(item, f"{path}[{index}]" if path else f"[{index}]", paths)


def _join_path(prefix: str, key: str) -> str:
    return f"{prefix}.{key}" if prefix else key


def _analysis_requests_has_sweep(value: dict[str, Any]) -> bool:
    large_sample = value.get("largeSample")
    return isinstance(large_sample, dict) and "sweep" in large_sample
