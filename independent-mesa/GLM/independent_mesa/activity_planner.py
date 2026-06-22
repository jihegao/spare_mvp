"""Support activity planner: job DAG, duration profile sampling, preventive triggers."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import networkx as nx
import numpy as np


@dataclass
class ActivityJob:
    activity_id: str
    activity_type: str
    aircraft_tail: str
    equipment_id: str
    resource_id: str
    tasks: list[dict[str, Any]]
    priority: int
    required_personnel: int
    required_devices: int
    spare_type: str | None
    spare_quantity: int
    task_index: int = 0
    state: str = "waiting"
    remaining: float = 0.0
    active_task: dict[str, Any] | None = None
    started_time: float | None = None
    completed_time: float | None = None
    created_time: float = 0.0
    is_turnaround: bool = False


def sample_duration(
    profile: dict[str, Any],
    rng: np.random.Generator,
    fallback_minutes: float = 30.0,
) -> float:
    """Sample a duration in minutes from a durationProfile dict."""
    dist_type = str(profile.get("distributionType", ""))
    if "三角" in dist_type or "triangular" in dist_type.lower():
        return float(rng.triangular(
            float(profile.get("min", 0)),
            float(profile.get("mode", fallback_minutes)),
            float(profile.get("max", fallback_minutes)),
        ))
    if "均匀" in dist_type or "uniform" in dist_type.lower():
        return float(rng.uniform(
            float(profile.get("min", 0)),
            float(profile.get("max", fallback_minutes)),
        ))
    if "正态" in dist_type or "normal" in dist_type.lower():
        mean = float(profile.get("mean", fallback_minutes))
        sigma = float(profile.get("stdDev", mean * 0.1))
        return max(0.0, float(rng.normal(mean, sigma)))
    if "固定" in dist_type or "fixed" in dist_type.lower():
        return float(profile.get("value", fallback_minutes))
    if "对数正态" in dist_type or "lognormal" in dist_type.lower():
        params = str(profile.get("params", "mu=5, sigma=0.3"))
        mu = _extract_param(params, "mu", 5.0)
        sigma = _extract_param(params, "sigma", 0.3)
        return float(np.random.default_rng().lognormal(mu, sigma))
    return fallback_minutes


def _extract_param(params_str: str, key: str, fallback: float) -> float:
    match = re.search(rf"{key}\s*=\s*([0-9.eE+-]+)", params_str)
    if match:
        return float(match.group(1))
    return fallback


def build_job_dag(jobs: list[dict[str, Any]]) -> nx.DiGraph:
    """Build a networkx DAG from job list with predecessors."""
    dag = nx.DiGraph()
    for job in jobs:
        code = str(job["activityCode"])
        dag.add_node(code, job=job)
        for pred in job.get("predecessors", []):
            dag.add_edge(str(pred), code)
    if not nx.is_directed_acyclic_graph(dag):
        raise ValueError("Activity job DAG contains a cycle")
    return dag


def topological_sort(dag: nx.DiGraph) -> list[str]:
    """Return topological sort of DAG, raising on cycle."""
    if not nx.is_directed_acyclic_graph(dag):
        raise ValueError("Activity job DAG contains a cycle")
    return list(nx.topological_sort(dag))


class ActivityPlanner:
    """Manages support activities and creates ActivityJobs on demand."""

    def __init__(self, activities: list[dict[str, Any]]) -> None:
        self.activities = {str(a["id"]): a for a in activities}
        self._job_counter = 0

    def get_activity(self, activity_id: str) -> dict[str, Any] | None:
        return self.activities.get(activity_id)

    def create_activity_job(
        self,
        activity_id: str,
        aircraft_tail: str,
        sim_time: float = 0.0,
    ) -> ActivityJob:
        activity = self.activities[activity_id]
        self._job_counter += 1
        tasks_sorted = topological_sort(build_job_dag(activity["jobs"]))
        job_map = {str(j["activityCode"]): j for j in activity["jobs"]}
        tasks = [job_map[code] for code in tasks_sorted]
        return ActivityJob(
            activity_id=activity_id,
            activity_type=str(activity.get("activityType", "")),
            aircraft_tail=aircraft_tail,
            equipment_id=str(activity.get("equipmentId", "")),
            resource_id=str(activity.get("resourceId", "")),
            tasks=tasks,
            priority=int(activity.get("priority", 1)),
            required_personnel=int(activity.get("requiredPersonnel", 1)),
            required_devices=int(activity.get("requiredDevices", 1)),
            spare_type=str(activity["spareType"]) if activity.get("spareType") else None,
            spare_quantity=int(activity.get("spareQuantity", 0)),
            created_time=sim_time,
        )

    def check_preventive_due(
        self,
        flight_hours_since_last: float,
        days_since_last: float,
        landings_since_last: int,
    ) -> bool:
        """Check if preventive maintenance is due by any of the three rules."""
        for activity in self.activities.values():
            if activity.get("activityType") != "预防性维修":
                continue
            if activity.get("useCalendarRule", False):
                interval = float(activity.get("calendarDayInterval", 999))
                float_ratio = float(activity.get("calendarDayFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if days_since_last >= threshold:
                    return True
            if activity.get("useFlightHourRule", False):
                interval = float(activity.get("runHourInterval", 999))
                float_ratio = float(activity.get("runHourFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if flight_hours_since_last >= threshold:
                    return True
            if activity.get("useTakeoffLandingRule", False):
                interval = int(activity.get("takeoffLandingInterval", 999))
                float_ratio = float(activity.get("takeoffLandingFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if landings_since_last >= threshold:
                    return True
        return False
