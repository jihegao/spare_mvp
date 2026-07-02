"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def strip_project_sweep(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload without runtime ExperimentPlan sweep config."""

    project = deepcopy(project_json)
    analysis_requests = project.get("analysisRequests")
    if not isinstance(analysis_requests, dict):
        return project

    large_sample = analysis_requests.get("largeSample")
    if isinstance(large_sample, dict):
        large_sample.pop("sweep", None)
    return project
