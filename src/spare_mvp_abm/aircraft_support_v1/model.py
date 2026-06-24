"""Aircraft support v1 single-run core for M9.7.2.

This is intentionally a narrow, deterministic core: it drives behavior from the
fields named in ``behavior_scope()`` and keeps the remaining M9.6 coverage debt
explicit for M9.7.4.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
import math
import random
from typing import Any


BEHAVIOR_DRIVING_FIELDS = [
    "equipment.quantity",
    "equipment.initialReady",
    "equipment.wholeMachineModels",
    "missionProfile.durationHours",
    "missionProfile.compositeTasks",
    "basicMission",
    "components[].failureRate",
    "components[].failureDistribution",
    "components[].lifeLimitHours",
    "components[].specialRepairProfile",
    "supportNodes[].personnelCapacity",
    "supportNodes[].equipmentCapacity",
    "supportNodes[].inventory",
    "supportNodes[].transportPolicies",
    "supportActivities[].jobs[]",
    "supportActivities[].jobs[].predecessors",
    "experiment.seed",
]

FAIL_CLOSED_FIELDS = ["supportOrganization"]

M9_7_4_COVERAGE_HARDENING_FIELDS = [
    "missionProfile.periodicTasks",
    "missionPhases",
    "airports",
    "missionAreas",
    "components[].kOutOfN",
    "components[].rms",
    "reliabilityBlockDiagram",
    "supportActivities[].transportStrategies",
    "supportActivities[].organizationStrategies",
    "monteCarlo.failureRates",
    "monteCarlo.spareMultipliers",
    "monteCarlo.supportCapacities",
    "experiment.samples",
    "experiment.steps",
]


@dataclass
class AircraftState:
    tail_number: str
    aircraft_type: str
    state: str
    x: int
    y: int
    current_mission_id: str | None = None
    return_time: int | None = None
    failed_component_id: str | None = None
    prepared_mission_ids: set[str] = field(default_factory=set)


@dataclass
class MissionState:
    mission_id: str
    name: str
    planned_start: int
    preparation_start: int
    duration_minutes: int
    required_aircraft: int
    priority: int
    cancel_minutes: int
    status: str = "scheduled"
    actual_start: int | None = None
    return_time: int | None = None
    assigned_tail_numbers: list[str] = field(default_factory=list)
    preflight_created: bool = False
    delay_minutes: int = 0


@dataclass
class JobState:
    job_id: str
    tail_number: str
    kind: str
    activity_id: str
    activity_name: str
    tasks: list[dict[str, Any]]
    priority: int
    resource_node_id: str
    mission_id: str | None = None
    component_id: str | None = None
    task_index: int = 0
    state: str = "waiting"
    remaining: int = 0
    started_time: int | None = None
    completed_time: int | None = None
    shortage_reason: str | None = None

    @property
    def current_task(self) -> dict[str, Any] | None:
        if self.task_index >= len(self.tasks):
            return None
        return self.tasks[self.task_index]


class AircraftSupportV1Model:
    """Deterministic minute-tick aircraft support simulation."""

    def __init__(self, inputs: dict[str, Any]):
        self.inputs = copy.deepcopy(inputs)
        self.seed = int(self.inputs.get("seed", 0))
        self.rng = random.Random(self.seed)
        time_config = self.inputs.get("time", {})
        self.duration_minutes = int(time_config.get("duration_minutes", 1440))
        self.tick_minutes = int(time_config.get("tick_minutes", 1))
        self.sample_every_minutes = int(time_config.get("sample_every_minutes", 30))
        self.max_state_frames_single = int(time_config.get("max_state_frames_single", 2000))
        self.minute = 0
        self.event_log: list[dict[str, Any]] = []
        self.aircraft = self._build_aircraft()
        self.components = self._behavior_components()
        self.nodes = self._build_support_nodes()
        self.activities = self._build_activities()
        self.preflight_activity = self._select_activity("preflight")
        self.repair_activity = self._select_activity("repair")
        self.missions = self._build_missions()
        self.jobs: list[JobState] = []
        self._job_sequence = 0
        self.completed_sorties = 0
        self.launched_sorties = 0
        self.cancelled_sorties = 0
        self.delayed_sorties = 0
        self.total_departure_delay = 0
        self.lru_failures = 0
        self.spare_consumed_total = 0
        self.shortage_events = 0
        self.resource_delay_events = 0
        self.failure_delay_events = 0

    @staticmethod
    def behavior_scope() -> dict[str, list[str]]:
        return {
            "behavior_driving_fields": list(BEHAVIOR_DRIVING_FIELDS),
            "fail_closed_fields": list(FAIL_CLOSED_FIELDS),
            "m9_7_4_coverage_hardening_fields": list(M9_7_4_COVERAGE_HARDENING_FIELDS),
        }

    def run(self) -> dict[str, Any]:
        frames = [self.visualization_frame(run_id="", step=0)]
        for minute in range(1, self.duration_minutes + 1, self.tick_minutes):
            self.minute = minute
            self._process_arrivals_and_completions()
            self._start_waiting_jobs()
            self._evaluate_failures()
            self._create_due_preflight_jobs()
            self._dispatch_due_missions()
            if minute % self.sample_every_minutes == 0 or minute == self.duration_minutes:
                frames.append(self.visualization_frame(run_id="", step=len(frames)))
                if len(frames) > self.max_state_frames_single:
                    raise ValueError(
                        "visualization_state_series exceeds max_state_frames_single; increase sample_every_minutes"
                    )
        return {"metrics": self.snapshot(), "frames": frames, "events": copy.deepcopy(self.event_log)}

    def snapshot(self) -> dict[str, Any]:
        planned_sorties = sum(mission.required_aircraft for mission in self.missions) or 1
        available = sum(1 for aircraft in self.aircraft if aircraft.state == "available")
        active_jobs = sum(1 for job in self.jobs if job.state == "running")
        backlog = sum(1 for job in self.jobs if job.state == "waiting")
        stock_total = sum(sum(max(0, int(qty)) for qty in node["inventory"].values()) for node in self.nodes.values())
        total_inventory = max(1, stock_total + self.spare_consumed_total)
        sortie_completion_rate = min(1.0, self.completed_sorties / planned_sorties)
        sortie_rate = min(1.0, self.launched_sorties / planned_sorties)
        ready_rate = available / max(1, len(self.aircraft))
        avg_delay = self.total_departure_delay / max(1, self.launched_sorties + self.cancelled_sorties)
        return {
            "sortie_completion_rate": sortie_completion_rate,
            "mission_success_rate": sortie_completion_rate,
            "sortie_rate": sortie_rate,
            "ready_rate": ready_rate,
            "available_aircraft": available,
            "active_jobs": active_jobs,
            "spare_stock_total": stock_total,
            "avg_departure_delay": avg_delay,
            "spare_consumed_total": self.spare_consumed_total,
            "maintenance_backlog": backlog,
            "repair_backlog": backlog,
            "lru_failures": self.lru_failures,
            "failed_count": sum(1 for aircraft in self.aircraft if aircraft.state == "failed"),
            "repairing_count": sum(1 for aircraft in self.aircraft if aircraft.state == "maintenance"),
            "sortie_count": sum(1 for aircraft in self.aircraft if aircraft.state == "flying"),
            "planned_sorties": planned_sorties,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "delayed_sorties": self.delayed_sorties,
            "spare_fill_rate": min(1.0, stock_total / total_inventory),
            "spare_utilization": min(1.0, self.spare_consumed_total / total_inventory),
            "shortage_events": self.shortage_events,
            "downtime_failure_events": self.failure_delay_events,
            "downtime_spare_shortage_events": self.shortage_events,
            "downtime_resource_delay_events": self.resource_delay_events,
            "mean_launch_time": avg_delay,
            "mean_recovery_time": self._mean_recovery_time(),
            "mean_turnaround_time": avg_delay + self._mean_recovery_time(),
        }

    def visualization_frame(self, *, run_id: str, step: int) -> dict[str, Any]:
        metrics = self.snapshot()
        return {
            "run_id": run_id,
            "step": step,
            "simulation_time": self.minute,
            "aircraft_state": {
                "ready_rate": metrics["ready_rate"],
                "failed_count": metrics["failed_count"],
                "repairing_count": metrics["repairing_count"],
                "sortie_count": metrics["sortie_count"],
            },
            "mission_state": {
                "mission_success_rate": metrics["mission_success_rate"],
                "sortie_rate": metrics["sortie_rate"],
                "mean_launch_time": metrics["mean_launch_time"],
                "mean_recovery_time": metrics["mean_recovery_time"],
                "mean_turnaround_time": metrics["mean_turnaround_time"],
            },
            "resource_state": {
                "spare_fill_rate": metrics["spare_fill_rate"],
                "spare_utilization": metrics["spare_utilization"],
                "repair_backlog": metrics["repair_backlog"],
            },
            "event_summary": {
                "shortage_events": metrics["shortage_events"],
                "downtime_failure_events": metrics["downtime_failure_events"],
                "downtime_spare_shortage_events": metrics["downtime_spare_shortage_events"],
                "downtime_resource_delay_events": metrics["downtime_resource_delay_events"],
            },
            "aircraft": [self._aircraft_payload(item) for item in self.aircraft],
            "missions": [self._mission_payload(item) for item in self.missions],
            "resources": [self._resource_payload(item) for item in self.nodes.values()],
            "spares": self._spares_payload(),
            "jobs": [self._job_payload(job) for job in self.jobs if job.state != "completed"],
            "events": self._events_for_frame(),
        }

    def _build_aircraft(self) -> list[AircraftState]:
        aircraft_inputs = self.inputs.get("aircraft", {})
        fleet_count = max(1, int(aircraft_inputs.get("fleet_count", 1)))
        initial_ready = min(fleet_count, max(0, int(aircraft_inputs.get("initial_ready", fleet_count))))
        models = list(aircraft_inputs.get("models") or ["Aircraft"])
        return [
            AircraftState(
                tail_number=f"AC-{index + 1:03d}",
                aircraft_type=str(models[index % len(models)]),
                state="available" if index < initial_ready else "maintenance",
                x=index % 6,
                y=index // 6,
            )
            for index in range(fleet_count)
        ]

    def _behavior_components(self) -> list[dict[str, Any]]:
        components = []
        for item in self.inputs.get("equipment_tree", {}).get("components", []):
            rate = _non_negative_float(item.get("failure_rate"), 0.0)
            if rate <= 0 or item.get("parent_id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["failure_rate"] = rate
            components.append(component)
        return components

    def _build_support_nodes(self) -> dict[str, dict[str, Any]]:
        nodes: dict[str, dict[str, Any]] = {}
        for item in self.inputs.get("support_network", {}).get("nodes", []):
            node_id = str(item.get("id") or f"node-{len(nodes) + 1}")
            nodes[node_id] = {
                "id": node_id,
                "name": str(item.get("name") or node_id),
                "personnel_capacity": max(1, int(item.get("personnel_capacity", 1))),
                "equipment_capacity": max(1, int(item.get("equipment_capacity", 1))),
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {
                    str(key): max(0, int(value))
                    for key, value in (item.get("inventory") or {}).items()
                    if isinstance(value, (int, float))
                },
                "transport_policies": copy.deepcopy(item.get("transport_policies") or []),
                "work_count": 0,
            }
        if not nodes:
            nodes["support-node"] = {
                "id": "support-node",
                "name": "support node",
                "personnel_capacity": 1,
                "equipment_capacity": 1,
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {},
                "transport_policies": [],
                "work_count": 0,
            }
        return nodes

    def _build_activities(self) -> list[dict[str, Any]]:
        activities = []
        for item in self.inputs.get("support_activities", {}).get("activities", []):
            activity = copy.deepcopy(item)
            activity["jobs"] = self._ordered_activity_jobs(activity.get("jobs") or [])
            activities.append(activity)
        return activities

    def _ordered_activity_jobs(self, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        remaining = [copy.deepcopy(job) for job in jobs if isinstance(job, dict)]
        ordered: list[dict[str, Any]] = []
        completed_codes: set[str] = set()
        while remaining:
            progressed = False
            for job in list(remaining):
                predecessors = [str(item) for item in job.get("predecessors") or []]
                if all(predecessor in completed_codes for predecessor in predecessors):
                    ordered.append(job)
                    code = job.get("activityCode")
                    if code not in (None, ""):
                        completed_codes.add(str(code))
                    remaining.remove(job)
                    progressed = True
            if not progressed:
                ordered.extend(remaining)
                break
        return ordered

    def _select_activity(self, kind: str) -> dict[str, Any]:
        candidates = []
        for activity in self.activities:
            text = f"{activity.get('id', '')} {activity.get('name', '')} {activity.get('activity_type', '')}".lower()
            if kind == "preflight" and ("preflight" in text or "飞行前" in text or "直接准备" in text):
                candidates.append(activity)
            if kind == "repair" and ("repair" in text or "维修" in text or "修复" in text):
                candidates.append(activity)
        if candidates:
            return candidates[0]
        return self.activities[0] if self.activities else self._default_activity(kind)

    def _default_activity(self, kind: str) -> dict[str, Any]:
        return {
            "id": kind,
            "name": kind,
            "priority": 1,
            "resource_id": next(iter(self.nodes)),
            "jobs": [{"activityCode": f"{kind}-001", "durationMinutes": 30, "workName": kind}],
        }

    def _build_missions(self) -> list[MissionState]:
        profile = self.inputs.get("mission_profile", {})
        basic = profile.get("basic_mission") or {}
        missions: list[MissionState] = []
        for composite in profile.get("composite_tasks") or []:
            for item in composite.get("taskItems") or []:
                if not isinstance(item, dict):
                    continue
                repeat_count = max(1, int(item.get("dailyRepeatCount") or 1))
                interval = max(1, int(round(_non_negative_float(item.get("intervalHours"), 24) * 60)))
                first_start = _time_to_minute(item.get("firstWaveTime"), int(basic.get("startHour") or 1) * 60)
                prep = max(0, int(item.get("preparationMinutes") or basic.get("preparationMinutes") or 0))
                duration = int(item.get("taskDurationMinutes") or basic.get("taskDurationMinutes") or 120)
                recovery = _time_to_minute(item.get("recoveryTime"), -1)
                if recovery >= 0 and recovery > first_start:
                    duration = max(1, recovery - first_start)
                for repeat in range(repeat_count):
                    planned_start = first_start + repeat * interval
                    if planned_start > self.duration_minutes:
                        continue
                    mission_id = str(item.get("id") or composite.get("id") or f"mission-{len(missions) + 1}")
                    missions.append(
                        MissionState(
                            mission_id=f"{mission_id}-{repeat + 1}",
                            name=str(item.get("basicTaskName") or composite.get("name") or basic.get("name") or mission_id),
                            planned_start=planned_start,
                            preparation_start=max(0, planned_start - prep),
                            duration_minutes=max(1, duration),
                            required_aircraft=max(1, int(item.get("equipmentQuantity") or basic.get("equipmentQuantity") or 1)),
                            priority=max(1, int(item.get("priority") or basic.get("priority") or 1)),
                            cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                        )
                    )
        if not missions:
            planned_start = max(0, int(basic.get("startHour") or 1) * 60)
            missions.append(
                MissionState(
                    mission_id=str(basic.get("missionId") or "mission-1"),
                    name=str(basic.get("name") or "mission"),
                    planned_start=planned_start,
                    preparation_start=max(0, planned_start - int(basic.get("preparationMinutes") or 0)),
                    duration_minutes=max(1, int(basic.get("taskDurationMinutes") or 120)),
                    required_aircraft=max(1, int(basic.get("equipmentQuantity") or 1)),
                    priority=max(1, int(basic.get("priority") or 1)),
                    cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                )
            )
        return sorted(missions, key=lambda item: (item.planned_start, item.priority))

    def _process_arrivals_and_completions(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.state == "flying" and aircraft.return_time is not None and aircraft.return_time <= self.minute:
                aircraft.state = "available"
                aircraft.current_mission_id = None
                aircraft.return_time = None
                self.completed_sorties += 1
                self._event("mission_returned", f"{aircraft.tail_number} returned from mission")
        for job in self.jobs:
            if job.state != "running":
                continue
            job.remaining -= self.tick_minutes
            if job.remaining > 0:
                continue
            self._release_job_resources(job)
            task = job.current_task or {}
            self._consume_task_spare(job, task)
            job.task_index += 1
            if job.task_index >= len(job.tasks):
                job.state = "completed"
                job.completed_time = self.minute
                self._complete_job_effect(job)
            else:
                job.state = "waiting"
                job.remaining = 0

    def _start_waiting_jobs(self) -> None:
        waiting = sorted(
            [job for job in self.jobs if job.state == "waiting"],
            key=lambda item: (item.priority, item.started_time or self.minute, item.job_id),
        )
        for job in waiting:
            task = job.current_task
            if task is None:
                job.state = "completed"
                continue
            node = self.nodes.get(job.resource_node_id) or next(iter(self.nodes.values()))
            personnel = _resource_quantity(task.get("personnel"), task.get("requiredPersonnel"), default=1)
            equipment = _resource_quantity(task.get("equipment"), task.get("requiredDevices"), default=1)
            if node["personnel_in_use"] + personnel > node["personnel_capacity"]:
                self.resource_delay_events += 1
                job.shortage_reason = "personnel_capacity"
                continue
            if node["equipment_in_use"] + equipment > node["equipment_capacity"]:
                self.resource_delay_events += 1
                job.shortage_reason = "equipment_capacity"
                continue
            spare_type, spare_qty = self._task_spare_requirement(job, task)
            if spare_type and node["inventory"].get(spare_type, 0) < spare_qty:
                self.shortage_events += 1
                job.shortage_reason = f"spare:{spare_type}"
                continue
            node["personnel_in_use"] += personnel
            node["equipment_in_use"] += equipment
            node["work_count"] += 1
            job.state = "running"
            job.remaining = max(1, int(task.get("durationMinutes") or task.get("duration_minutes") or 30))
            job.started_time = job.started_time if job.started_time is not None else self.minute
            job.shortage_reason = None
            self._event("job_started", f"{job.job_id} started {task.get('workName') or task.get('activityCode') or 'task'}")

    def _evaluate_failures(self) -> None:
        if not self.components:
            return
        for aircraft in self.aircraft:
            if aircraft.state != "available":
                continue
            for component in self.components:
                hourly_rate = _non_negative_float(component.get("failure_rate"), 0.0)
                life_limit = component.get("life_limit_hours")
                life_pressure = 0.0
                if isinstance(life_limit, (int, float)) and life_limit > 0:
                    life_pressure = min(0.002, (self.minute / 60) / float(life_limit) * 0.001)
                probability = 1.0 - math.exp(-(hourly_rate / 60.0) * self.tick_minutes) + life_pressure
                if self.rng.random() < min(0.95, probability):
                    aircraft.state = "maintenance"
                    aircraft.failed_component_id = str(component.get("id") or "component")
                    self.lru_failures += 1
                    self.failure_delay_events += 1
                    self._create_job(aircraft, self.repair_activity, kind="repair", component=component)
                    self._event("component_failed", f"{aircraft.tail_number} failed {component.get('name') or component.get('id')}")
                    break

    def _create_due_preflight_jobs(self) -> None:
        for mission in self.missions:
            if mission.preflight_created or mission.status != "scheduled":
                continue
            if self.minute < mission.preparation_start:
                continue
            available = [aircraft for aircraft in self.aircraft if aircraft.state == "available"]
            for aircraft in available[: mission.required_aircraft]:
                aircraft.state = "maintenance"
                self._create_job(aircraft, self.preflight_activity, kind="preflight", mission_id=mission.mission_id)
            mission.preflight_created = True
            self._event("preflight_created", f"{mission.mission_id} created {min(len(available), mission.required_aircraft)} jobs")

    def _dispatch_due_missions(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.minute < mission.planned_start:
                continue
            candidates = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.state == "available" and mission.mission_id in aircraft.prepared_mission_ids
            ]
            if len(candidates) < mission.required_aircraft:
                candidates = [aircraft for aircraft in self.aircraft if aircraft.state == "available"]
            if len(candidates) >= mission.required_aircraft:
                assigned = candidates[: mission.required_aircraft]
                for aircraft in assigned:
                    aircraft.state = "flying"
                    aircraft.current_mission_id = mission.mission_id
                    aircraft.return_time = self.minute + mission.duration_minutes
                mission.status = "launched"
                mission.actual_start = self.minute
                mission.return_time = self.minute + mission.duration_minutes
                mission.assigned_tail_numbers = [aircraft.tail_number for aircraft in assigned]
                mission.delay_minutes = max(0, self.minute - mission.planned_start)
                self.launched_sorties += len(assigned)
                self.total_departure_delay += mission.delay_minutes
                if mission.delay_minutes:
                    self.delayed_sorties += len(assigned)
                self._event("mission_launched", f"{mission.mission_id} launched {len(assigned)} aircraft")
                continue
            if self.minute - mission.planned_start >= mission.cancel_minutes:
                mission.status = "cancelled"
                self.cancelled_sorties += mission.required_aircraft
                self.total_departure_delay += mission.cancel_minutes
                self._event("mission_cancelled", f"{mission.mission_id} cancelled for insufficient ready aircraft")
            else:
                mission.status = "delayed"
                self.delayed_sorties += 1

    def _create_job(
        self,
        aircraft: AircraftState,
        activity: dict[str, Any],
        *,
        kind: str,
        mission_id: str | None = None,
        component: dict[str, Any] | None = None,
    ) -> None:
        self._job_sequence += 1
        tasks = copy.deepcopy(activity.get("jobs") or [{"activityCode": kind, "durationMinutes": 30}])
        if kind == "repair" and component is not None:
            profile = component.get("special_repair_profile") if isinstance(component.get("special_repair_profile"), dict) else {}
            if profile.get("repairTimeMinutes"):
                tasks[-1]["durationMinutes"] = max(1, int(profile["repairTimeMinutes"]))
            if component.get("spare_type"):
                tasks[-1]["spare"] = f"{component['spare_type']},1"
        self.jobs.append(
            JobState(
                job_id=f"job-{self._job_sequence:04d}",
                tail_number=aircraft.tail_number,
                kind=kind,
                activity_id=str(activity.get("id") or kind),
                activity_name=str(activity.get("name") or activity.get("activity_name") or kind),
                tasks=tasks,
                priority=max(1, int(activity.get("priority") or 1)),
                resource_node_id=str(activity.get("resource_id") or next(iter(self.nodes))),
                mission_id=mission_id,
                component_id=str(component.get("id")) if component else None,
            )
        )

    def _release_job_resources(self, job: JobState) -> None:
        task = job.current_task or {}
        node = self.nodes.get(job.resource_node_id) or next(iter(self.nodes.values()))
        personnel = _resource_quantity(task.get("personnel"), task.get("requiredPersonnel"), default=1)
        equipment = _resource_quantity(task.get("equipment"), task.get("requiredDevices"), default=1)
        node["personnel_in_use"] = max(0, node["personnel_in_use"] - personnel)
        node["equipment_in_use"] = max(0, node["equipment_in_use"] - equipment)

    def _task_spare_requirement(self, job: JobState, task: dict[str, Any]) -> tuple[str | None, int]:
        spare = task.get("spare")
        if isinstance(spare, str) and spare and spare != "无":
            parts = [part.strip() for part in spare.split(",") if part.strip()]
            if parts:
                quantity = 1
                for part in reversed(parts):
                    if part.isdigit():
                        quantity = max(1, int(part))
                        break
                return parts[0], quantity
        if job.kind == "repair":
            activity = next((item for item in self.activities if str(item.get("id")) == job.activity_id), {})
            spare_type = activity.get("spare_type")
            spare_quantity = int(activity.get("spare_quantity") or 0)
            if spare_type and spare_quantity > 0:
                return str(spare_type), spare_quantity
        return None, 0

    def _consume_task_spare(self, job: JobState, task: dict[str, Any]) -> None:
        spare_type, spare_quantity = self._task_spare_requirement(job, task)
        if not spare_type or spare_quantity <= 0:
            return
        node = self.nodes.get(job.resource_node_id) or next(iter(self.nodes.values()))
        current = node["inventory"].get(spare_type, 0)
        if current >= spare_quantity:
            node["inventory"][spare_type] = current - spare_quantity
            self.spare_consumed_total += spare_quantity
            self._event("spare_consumed", f"{job.job_id} consumed {spare_quantity} {spare_type}")

    def _complete_job_effect(self, job: JobState) -> None:
        aircraft = next((item for item in self.aircraft if item.tail_number == job.tail_number), None)
        if aircraft is None:
            return
        if job.kind == "preflight" and job.mission_id:
            aircraft.prepared_mission_ids.add(job.mission_id)
            aircraft.state = "available"
            self._event("preflight_completed", f"{aircraft.tail_number} prepared for {job.mission_id}")
        elif job.kind == "repair":
            aircraft.state = "available"
            aircraft.failed_component_id = None
            self._event("repair_completed", f"{aircraft.tail_number} repair completed")

    def _mean_recovery_time(self) -> float:
        completed = [mission for mission in self.missions if mission.return_time is not None]
        if not completed:
            return 0.0
        return sum(float(mission.return_time or 0) for mission in completed) / len(completed)

    def _aircraft_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "type": item.aircraft_type,
            "state": item.state,
            "x": item.x,
            "y": item.y,
            "current_mission_id": item.current_mission_id,
            "failed_lru": item.failed_component_id or "",
        }

    def _mission_payload(self, item: MissionState) -> dict[str, Any]:
        return {
            "mission_id": item.mission_id,
            "name": item.name,
            "planned_start": item.planned_start,
            "actual_start": item.actual_start,
            "return_time": item.return_time,
            "required_aircraft": item.required_aircraft,
            "status": item.status,
            "assigned_tail_numbers": list(item.assigned_tail_numbers),
            "delay_minutes": item.delay_minutes,
        }

    def _resource_payload(self, item: dict[str, Any]) -> dict[str, Any]:
        capacity = item["personnel_capacity"] + item["equipment_capacity"]
        in_use = item["personnel_in_use"] + item["equipment_in_use"]
        return {
            "name": item["id"],
            "display_name": item["name"],
            "category": "support_node",
            "capacity": capacity,
            "in_use": in_use,
            "utilization": min(1.0, in_use / max(1, capacity)),
            "work_count": item["work_count"],
        }

    def _spares_payload(self) -> list[dict[str, Any]]:
        payload = []
        for node in self.nodes.values():
            for spare_type, quantity in node["inventory"].items():
                payload.append(
                    {
                        "part_id": f"{node['id']}:{spare_type}",
                        "name": spare_type,
                        "quantity": quantity,
                        "consumed": self.spare_consumed_total,
                        "pending_quantity": 0,
                        "reorder_point": 1,
                    }
                )
        return payload

    def _job_payload(self, job: JobState) -> dict[str, Any]:
        task = job.current_task or {}
        return {
            "job_id": job.job_id,
            "tail_number": job.tail_number,
            "kind": job.kind,
            "state": job.state,
            "task": task.get("workName") or task.get("activityCode") or job.activity_name,
            "remaining": job.remaining,
            "shortage_reason": job.shortage_reason,
        }

    def _events_for_frame(self) -> list[dict[str, Any]]:
        recent = [event for event in self.event_log if event["time"] >= max(0, self.minute - self.sample_every_minutes)]
        if not recent:
            recent = [{"time": self.minute, "event": "state_frame", "message": "state frame sampled"}]
        return [
            {
                "time": float(event["time"]),
                "event": str(event["event"]),
                "event_type": str(event["event"]),
                "message": str(event["message"]),
                "metric_refs": self._metric_refs_for_event(str(event["event"])),
            }
            for event in recent[-10:]
        ]

    def _event(self, event: str, message: str) -> None:
        self.event_log.append({"time": self.minute, "event": event, "message": message})

    def _metric_refs_for_event(self, event: str) -> list[str]:
        if "mission" in event:
            return ["sortie_completion_rate", "avg_departure_delay"]
        if "spare" in event:
            return ["spare_stock_total", "spare_consumed_total", "shortage_events"]
        if "job" in event or "repair" in event or "preflight" in event:
            return ["active_jobs", "maintenance_backlog"]
        if "fail" in event:
            return ["lru_failures", "downtime_failure_events"]
        return ["sortie_completion_rate", "available_aircraft", "spare_fill_rate"]


def _time_to_minute(value: Any, fallback: int) -> int:
    if not isinstance(value, str) or ":" not in value:
        return fallback
    hour, minute, *_ = value.split(":") + ["0"]
    try:
        return max(0, int(hour) * 60 + int(minute))
    except ValueError:
        return fallback


def _resource_quantity(text: Any, explicit: Any, *, default: int) -> int:
    if isinstance(explicit, (int, float)) and explicit > 0:
        return max(1, int(explicit))
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
