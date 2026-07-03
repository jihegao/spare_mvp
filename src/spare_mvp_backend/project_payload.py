"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def project_runtime_config_paths(project_json: dict[str, Any]) -> list[str]:
    """Return runtime Monte Carlo config paths that are not Project modeling data."""

    paths: list[str] = []
    _collect_project_runtime_config_paths(project_json, "", paths)
    return paths


def strip_project_sweep(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload without runtime ExperimentPlan sweep config."""

    project = deepcopy(project_json)
    _strip_project_runtime_config(project)
    return project


def _strip_project_runtime_config(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("monteCarlo", None)
        analysis_requests = value.get("analysisRequests")
        if isinstance(analysis_requests, dict):
            large_sample = analysis_requests.get("largeSample")
            if isinstance(large_sample, dict):
                large_sample.pop("sweep", None)
        for child in value.values():
            _strip_project_runtime_config(child)
    elif isinstance(value, list):
        for item in value:
            _strip_project_runtime_config(item)


def _collect_project_runtime_config_paths(value: Any, path: str, paths: list[str]) -> None:
    if isinstance(value, dict):
        if "monteCarlo" in value:
            paths.append(_join_path(path, "monteCarlo"))
        analysis_requests = value.get("analysisRequests")
        if isinstance(analysis_requests, dict):
            large_sample = analysis_requests.get("largeSample")
            if isinstance(large_sample, dict) and "sweep" in large_sample:
                paths.append(_join_path(path, "analysisRequests.largeSample.sweep"))
        for key, child in value.items():
            _collect_project_runtime_config_paths(child, _join_path(path, str(key)), paths)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _collect_project_runtime_config_paths(item, f"{path}[{index}]" if path else f"[{index}]", paths)


def _join_path(prefix: str, key: str) -> str:
    return f"{prefix}.{key}" if prefix else key
