"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


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
