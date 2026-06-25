"""Aircraft support v1 runtime core.

The model uses deterministic minute ticks and declares the M9.7.4 field
coverage boundary through ``behavior_scope()``.
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
    "missionProfile.periodicTasks",
    "basicMission",
    "missionPhases",
    "airports",
    "missionAreas",
    "components[].failureRate",
    "components[].failureDistribution",
    "components[].kOutOfN",
    "components[].lifeLimitHours",
    "components[].rms",
    "reliabilityBlockDiagram",
    "components[].specialRepairProfile",
    "supportNodes[].personnelCapacity",
    "supportNodes[].equipmentCapacity",
    "supportNodes[].inventory",
    "supportNodes[].transportPolicies",
    "supportActivities[].jobs[]",
    "supportActivities[].jobs[].predecessors",
    "experiment.seed",
    "experiment.samples",
    "monteCarlo.failureRates",
    "monteCarlo.spareMultipliers",
    "monteCarlo.supportCapacities",
]

FAIL_CLOSED_FIELDS: list[str] = []

M9_7_4_COVERAGE_HARDENING_FIELDS: list[str] = []


@dataclass
class AircraftState:
    tail_number: str
    aircraft_type: str
    state: str
    x: int
    y: int
    model: str = ""
    current_mission_id: str | None = None
    return_time: int | None = None
    failed_component_id: str | None = None
    flight_hours: float = 0.0
    takeoff_count: int = 0
    landing_count: int = 0
    postflight_required: bool = False
    preventive_due: bool = False
    in_flight_failure: bool = False
    last_preventive_minute: int = 0
    prepared_mission_ids: set[str] = field(default_factory=set)
    lru_failure_remaining_minutes: dict[str, float] = field(default_factory=dict)


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
    task_category: str = "basic"
    periodic_task_id: str = ""
    periodic_task_name: str = ""
    composite_task_id: str = ""
    composite_task_name: str = ""
    basic_task_id: str = ""
    basic_task_name: str = ""
    required_aircraft_type: str = ""
    group_name: str = ""
    wave_index: int = 1
    day_index: int = 1
    failed_tail_numbers: list[str] = field(default_factory=list)


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


@dataclass
class TransportShipment:
    source_node_id: str
    destination_node_id: str
    spare_type: str
    quantity: int
    requested_minute: int
    arrival_minute: int


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
        self._initialize_aircraft_lru_failure_timers()
        self.nodes = self._build_support_nodes()
        self.activities = self._build_activities()
        self.mission_context = self._mission_context()
        self.preflight_activity = self._select_activity("preflight")
        self.repair_activity = self._select_activity("repair")
        self.postflight_activity = self._select_activity("postflight")
        self.preventive_activity = self._select_activity("preventive")
        self.missions = self._build_missions()
        self.jobs: list[JobState] = []
        self.transport_shipments: list[TransportShipment] = []
        self._job_sequence = 0
        self.completed_sorties = 0
        self.failed_sorties = 0
        self.launched_sorties = 0
        self.cancelled_sorties = 0
        self.delayed_sorties = 0
        self.total_departure_delay = 0
        self.total_transport_delay = 0
        self.lru_failures = 0
        self.in_flight_failures = 0
        self.rbd_root_failures = 0
        self.spare_consumed_total = 0
        self.shortage_events = 0
        self.transport_replenishment_events = 0
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
            self._process_transport_arrivals()
            self._process_mission_returns()
            self._process_job_progress_and_completions()
            self._evaluate_failures()
            self._generate_preventive_jobs()
            self._create_due_preflight_jobs()
            self._start_waiting_jobs()
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
        repair_backlog = sum(1 for job in self.jobs if job.kind == "repair" and job.state in {"waiting", "running"})
        postflight_backlog = sum(1 for job in self.jobs if job.kind == "postflight" and job.state in {"waiting", "running"})
        preventive_backlog = sum(1 for job in self.jobs if job.kind == "preventive" and job.state in {"waiting", "running"})
        stock_total = sum(sum(max(0, int(qty)) for qty in node["inventory"].values()) for node in self.nodes.values())
        total_inventory = max(1, stock_total + self.spare_consumed_total)
        sortie_completion_rate = min(1.0, self.completed_sorties / planned_sorties)
        sortie_rate = min(1.0, self.launched_sorties / planned_sorties)
        ready_rate = available / max(1, len(self.aircraft))
        avg_delay = self.total_departure_delay / max(1, self.launched_sorties + self.cancelled_sorties)
        mean_transport_delay = self.total_transport_delay / max(1, self.transport_replenishment_events)
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
            "repair_backlog": repair_backlog,
            "postflight_backlog": postflight_backlog,
            "preventive_backlog": preventive_backlog,
            "lru_failures": self.lru_failures,
            "failed_count": sum(1 for aircraft in self.aircraft if aircraft.failed_component_id is not None),
            "repairing_count": sum(1 for aircraft in self.aircraft if aircraft.state == "maintenance"),
            "flying_count": sum(1 for aircraft in self.aircraft if aircraft.state == "flying"),
            "sortie_count": sum(1 for aircraft in self.aircraft if aircraft.state == "flying"),
            "postflight_count": sum(1 for aircraft in self.aircraft if aircraft.postflight_required),
            "preventive_count": sum(1 for aircraft in self.aircraft if aircraft.preventive_due),
            "planned_sorties": planned_sorties,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "failed_sorties": self.failed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "delayed_sorties": self.delayed_sorties,
            "spare_fill_rate": min(1.0, stock_total / total_inventory),
            "spare_utilization": min(1.0, self.spare_consumed_total / total_inventory),
            "shortage_events": self.shortage_events,
            "transport_in_transit_count": len(self.transport_shipments),
            "downtime_failure_events": self.failure_delay_events,
            "downtime_spare_shortage_events": self.shortage_events,
            "downtime_resource_delay_events": self.resource_delay_events,
            "transport_replenishment_events": self.transport_replenishment_events,
            "mean_transport_delay": mean_transport_delay,
            "in_flight_failures": self.in_flight_failures,
            "rbd_root_failures": self.rbd_root_failures,
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
                "postflight_count": metrics["postflight_count"],
                "preventive_count": metrics["preventive_count"],
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
                "postflight_backlog": metrics["postflight_backlog"],
                "preventive_backlog": metrics["preventive_backlog"],
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
        configured_fleet_count = _positive_int(aircraft_inputs.get("fleet_count"), 0)
        assets = [item for item in aircraft_inputs.get("assets") or [] if isinstance(item, dict)]
        fleet_count = max(1, configured_fleet_count, len(assets))
        initial_ready = min(fleet_count, max(0, int(aircraft_inputs.get("initial_ready", fleet_count))))
        models = list(aircraft_inputs.get("models") or ["Aircraft"])
        if assets:
            aircraft = []
            for index, item in enumerate(assets[:fleet_count]):
                tail_number = str(item.get("tailNumber") or item.get("tail_number") or f"AC-{index + 1:03d}")
                aircraft_type = str(item.get("aircraftType") or item.get("aircraft_type") or item.get("type") or item.get("model") or "Aircraft")
                state = str(item.get("initialState") or item.get("initial_state") or item.get("state") or "available")
                if state not in {"available", "maintenance", "flying"}:
                    state = "available"
                aircraft.append(
                    AircraftState(
                        tail_number=tail_number,
                        aircraft_type=aircraft_type,
                        model=str(item.get("model") or aircraft_type),
                        state=state,
                        x=index % 6,
                        y=index // 6,
                    )
                )
            used_tail_numbers = {item.tail_number for item in aircraft}
            for index in range(len(aircraft), fleet_count):
                tail_number = f"AC-{index + 1:03d}"
                while tail_number in used_tail_numbers:
                    index += 1
                    tail_number = f"AC-{index + 1:03d}"
                aircraft_type = str(models[index % len(models)])
                aircraft.append(
                    AircraftState(
                        tail_number=tail_number,
                        aircraft_type=aircraft_type,
                        model=aircraft_type,
                        state="available" if index < initial_ready else "maintenance",
                        x=index % 6,
                        y=index // 6,
                    )
                )
                used_tail_numbers.add(tail_number)
            return aircraft
        return [
            AircraftState(
                tail_number=f"AC-{index + 1:03d}",
                aircraft_type=str(models[index % len(models)]),
                model=str(models[index % len(models)]),
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
            if item.get("parent_id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["quantity"] = max(1, int(component.get("quantity") or 1))
            component["root_component_id"] = self.inputs.get("equipment_tree", {}).get("root_component_id")
            effective_rate = self._effective_component_failure_rate(component, rate)
            effective_rate *= max(1.0, math.sqrt(float(component["quantity"])))
            if effective_rate <= 0:
                continue
            component["failure_rate"] = effective_rate
            component["repair_duration_minutes"] = self._component_repair_duration_minutes(component)
            components.append(component)
        components.extend(self._rbd_components())
        return components

    def _effective_component_failure_rate(self, component: dict[str, Any], fallback_rate: float) -> float:
        distribution = component.get("failure_distribution")
        rate = fallback_rate
        if isinstance(distribution, dict):
            parsed_rate = _failure_distribution_rate(distribution)
            if parsed_rate is not None:
                rate = parsed_rate
        k_out = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
        if k_out.get("enabled"):
            k = max(1, int(k_out.get("k") or 1))
            n = max(k, int(k_out.get("n") or k))
            tolerated_failures = max(0, n - k)
            rate = rate / max(1, tolerated_failures + 1)
        rms = component.get("rms") if isinstance(component.get("rms"), dict) else {}
        reliability = _bounded_float(rms.get("reliability"))
        if reliability is not None:
            rate *= max(0.05, 1.0 - reliability)
        return max(0.0, rate)

    def _component_repair_duration_minutes(self, component: dict[str, Any]) -> int | None:
        profile = component.get("special_repair_profile") if isinstance(component.get("special_repair_profile"), dict) else {}
        if profile.get("repairTimeMinutes"):
            return max(1, int(profile["repairTimeMinutes"]))
        rms = component.get("rms") if isinstance(component.get("rms"), dict) else {}
        mttr = _non_negative_float(rms.get("mttrHours"), 0.0)
        mldt = _non_negative_float(rms.get("mldtHours"), 0.0)
        if mttr or mldt:
            return max(1, int(round((mttr + mldt) * 60)))
        return None

    def _rbd_components(self) -> list[dict[str, Any]]:
        diagram = self.inputs.get("reliability_block_diagram") if isinstance(self.inputs.get("reliability_block_diagram"), dict) else {}
        incoming_edges = {
            str(edge.get("to")): edge
            for edge in diagram.get("edges") or []
            if isinstance(edge, dict) and edge.get("to") not in (None, "")
        }
        children_by_parent: dict[str, list[dict[str, Any]]] = {}
        for node in diagram.get("nodes") or []:
            if isinstance(node, dict) and node.get("parentId") not in (None, ""):
                children_by_parent.setdefault(str(node["parentId"]), []).append(node)
        components = []
        for node in diagram.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or len(components) + 1)
            rate = _non_negative_float(node.get("failureRate"), 0.0)
            mtbf = _non_negative_float(node.get("mtbfHours"), 0.0)
            if rate <= 0 and mtbf > 0:
                rate = 1.0 / mtbf
            if rate <= 0:
                continue
            edge = incoming_edges.get(node_id) if node_id else None
            edge_type = str(edge.get("type") if isinstance(edge, dict) else "").lower()
            edge_weight = _non_negative_float(edge.get("weight") if isinstance(edge, dict) else None, 1.0)
            parent_id = str(node.get("parentId") or "")
            sibling_count = len(children_by_parent.get(parent_id, [])) if parent_id else 1
            connection = f"{node.get('connectionType') or ''} {edge_type}".lower()
            if "并" in connection or "parallel" in connection or "备用" in connection:
                rate *= 0.5
            if parent_id and sibling_count > 1:
                rate /= math.sqrt(float(sibling_count))
            rate *= edge_weight if edge_weight > 0 else 1.0
            components.append(
                {
                    "id": f"rbd:{node_id}",
                    "name": str(node.get("name") or node_id or "rbd node"),
                    "failure_rate": rate,
                    "spare_type": "",
                    "special_repair_profile": {},
                    "repair_duration_minutes": None,
                    "quantity": 1,
                    "root_component_id": parent_id or node_id,
                    "rbd_root": parent_id == "",
                }
            )
        return components

    def _initialize_aircraft_lru_failure_timers(self) -> None:
        for aircraft in self.aircraft:
            aircraft.lru_failure_remaining_minutes = {
                str(component.get("id") or "component"): self._sample_lru_failure_minutes(component)
                for component in self.components
            }

    def _sample_lru_failure_minutes(self, component: dict[str, Any]) -> float:
        hourly_rate = _non_negative_float(component.get("failure_rate"), 0.0)
        life_limit = component.get("life_limit_hours")
        life_limit_minutes = math.inf
        if isinstance(life_limit, (int, float)) and life_limit > 0:
            life_limit_minutes = float(life_limit) * 60.0
        samples: list[float] = []
        quantity = max(1, int(component.get("quantity") or 1))
        if hourly_rate > 0:
            samples.extend(self.rng.expovariate(hourly_rate) * 60.0 for _ in range(quantity))
        if math.isfinite(life_limit_minutes):
            samples.append(life_limit_minutes)
        return min(samples) if samples else math.inf

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
                "transport_policies": self._normalized_transport_policies(item.get("transport_policies") or []),
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

    def _normalized_transport_policies(self, policies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = []
        for item in policies:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "from": str(item.get("from") or ""),
                    "to": str(item.get("to") or ""),
                    "spare_type": str(item.get("spareType") or item.get("spare_type") or ""),
                    "capacity": max(1, int(item.get("capacity") or 1)),
                    "priority": max(1, int(item.get("priority") or 1)),
                    "transport_minutes": self._transport_policy_minutes(item),
                }
            )
        return sorted(normalized, key=lambda item: (item["priority"], item["transport_minutes"]))

    def _transport_policy_minutes(self, item: dict[str, Any]) -> int:
        if item.get("transport_minutes") not in (None, ""):
            return max(0, int(round(_non_negative_float(item.get("transport_minutes"), 0.0))))
        if item.get("transportMinutes") not in (None, ""):
            return max(0, int(round(_non_negative_float(item.get("transportMinutes"), 0.0))))
        hours = item.get("transportTimeHours", item.get("transport_time_hours"))
        return max(0, int(round(_non_negative_float(hours, 0.0) * 60)))

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
            if kind == "postflight" and ("postflight" in text or "飞行后" in text or "航后" in text):
                candidates.append(activity)
            if kind == "preventive" and ("preventive" in text or "预防" in text or "定检" in text):
                candidates.append(activity)
        if candidates:
            return candidates[0]
        if kind in {"postflight", "preventive"}:
            return self._default_activity(kind)
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
        periodic_contexts = self._periodic_contexts_by_composite(profile)
        mission_duration_adjustment = self.mission_context["duration_adjustment_minutes"]
        for composite in profile.get("composite_tasks") or []:
            composite_id = str(composite.get("id") or "")
            periodic_context = periodic_contexts.get(composite_id, {})
            for item in composite.get("taskItems") or []:
                if not isinstance(item, dict):
                    continue
                interval = max(1, int(round(_non_negative_float(item.get("intervalHours"), 24) * 60)))
                first_start = _time_to_minute(item.get("firstWaveTime"), int(basic.get("startHour") or 1) * 60)
                prep = max(0, int(item.get("preparationMinutes") or basic.get("preparationMinutes") or 0))
                duration = int(item.get("taskDurationMinutes") or basic.get("taskDurationMinutes") or 120) + mission_duration_adjustment
                recovery = _time_to_minute(item.get("recoveryTime"), -1)
                if recovery >= 0 and recovery > first_start:
                    duration = max(1, recovery - first_start + mission_duration_adjustment)
                mission_days = self._mission_days_for_item(item, periodic_context)
                daily_repeat_count = self._daily_repeat_count(item, periodic_context)
                for day_offset in mission_days:
                    for repeat in range(daily_repeat_count):
                        planned_start = day_offset * 1440 + first_start + repeat * interval
                        if planned_start > self.duration_minutes:
                            continue
                        day_index = planned_start // 1440 + 1
                        wave_index = repeat + 1
                        mission_id = str(item.get("id") or composite.get("id") or f"mission-{len(missions) + 1}")
                        missions.append(
                            MissionState(
                                mission_id=f"{mission_id}-d{day_index}-w{wave_index}",
                                name=str(item.get("basicTaskName") or composite.get("name") or basic.get("name") or mission_id),
                                planned_start=planned_start,
                                preparation_start=max(0, planned_start - prep),
                                duration_minutes=max(1, duration),
                                required_aircraft=max(1, int(item.get("equipmentQuantity") or basic.get("equipmentQuantity") or 1)),
                                priority=max(1, int(item.get("priority") or basic.get("priority") or 1)),
                                cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                                task_category="periodic" if periodic_context else "composite",
                                periodic_task_id=str(periodic_context.get("id") or ""),
                                periodic_task_name=str(periodic_context.get("name") or ""),
                                composite_task_id=composite_id,
                                composite_task_name=str(composite.get("name") or composite_id),
                                basic_task_id=str(item.get("id") or basic.get("id") or ""),
                                basic_task_name=str(item.get("basicTaskName") or basic.get("name") or ""),
                                required_aircraft_type=str(item.get("equipmentType") or basic.get("equipmentType") or ""),
                                group_name=str(item.get("groupName") or ""),
                                wave_index=wave_index,
                                day_index=day_index,
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
                    task_category="basic",
                    basic_task_id=str(basic.get("id") or basic.get("missionId") or ""),
                    basic_task_name=str(basic.get("name") or "mission"),
                    required_aircraft_type=str(basic.get("equipmentType") or ""),
                    day_index=planned_start // 1440 + 1,
                )
            )
        return sorted(missions, key=lambda item: (item.planned_start, item.priority))

    def _periodic_contexts_by_composite(self, profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
        contexts: dict[str, dict[str, Any]] = {}
        for periodic in profile.get("periodic_tasks") or []:
            if not isinstance(periodic, dict):
                continue
            name = str(
                periodic.get("periodicTaskName")
                or periodic.get("taskName")
                or periodic.get("name")
                or periodic.get("id")
                or ""
            )
            context = {
                "id": str(periodic.get("id") or ""),
                "name": name,
                "daily_repeat_count": _positive_int(periodic.get("dailyRepeatCount"), 1),
                "period_days": _periodic_period_days(periodic),
                "total_days": _periodic_total_days(periodic),
            }
            total_days = int(context["total_days"])
            period_days = int(context["period_days"])
            composite_days: dict[str, set[int]] = {
                str(item): set(range(total_days))
                for item in periodic.get("compositeTaskIds") or []
                if item
            }
            for item in periodic.get("compositeTasks") or []:
                if isinstance(item, dict) and item.get("compositeTaskId"):
                    composite_id = str(item["compositeTaskId"])
                    start_day = max(0, _positive_int(item.get("week"), 1) - 1) * period_days
                    active_days = set(range(start_day, min(total_days, start_day + period_days)))
                    if active_days:
                        composite_days.setdefault(composite_id, set()).update(active_days)
            for composite_id, active_days in composite_days.items():
                composite_context = dict(context)
                composite_context["active_days"] = sorted(active_days)
                if composite_id in contexts:
                    existing = contexts[composite_id]
                    raise ValueError(
                        "Duplicate periodic task reference for composite task "
                        f"{composite_id}: {existing.get('id') or existing.get('name')} and "
                        f"{composite_context.get('id') or composite_context.get('name')}"
                    )
                contexts[composite_id] = composite_context
        return contexts

    def _mission_days_for_item(self, item: dict[str, Any], periodic_context: dict[str, Any]) -> list[int]:
        if periodic_context:
            days = [
                int(day)
                for day in periodic_context.get("active_days", [])
                if isinstance(day, int) and day >= 0 and day * 1440 <= self.duration_minutes
            ]
            return days or [0]
        return [0]

    def _daily_repeat_count(self, item: dict[str, Any], periodic_context: dict[str, Any]) -> int:
        if item.get("dailyRepeatCount") not in (None, ""):
            return _positive_int(item.get("dailyRepeatCount"), 1)
        if periodic_context:
            return _positive_int(periodic_context.get("daily_repeat_count"), 1)
        return 1

    def _mission_context(self) -> dict[str, int]:
        profile = self.inputs.get("mission_profile", {})
        airports = [item for item in profile.get("airports") or [] if isinstance(item, dict)]
        areas = [item for item in profile.get("mission_areas") or [] if isinstance(item, dict)]
        phases = [item for item in profile.get("mission_phases") or [] if isinstance(item, dict)]
        distance_km = 0.0
        if airports:
            distance_km += max(_non_negative_float(item.get("distanceToMissionKm"), 0.0) for item in airports)
        if areas:
            distance_km += max(_non_negative_float(item.get("distanceFromDepartureKm"), 0.0) for item in areas)
            distance_km += max(_non_negative_float(item.get("patrolRadiusKm"), 0.0) for item in areas) * 0.25
        phase_minutes = sum(int(round(_non_negative_float(item.get("limitHours"), 0.0) * 10)) for item in phases)
        travel_minutes = int(round((distance_km / 900.0) * 60)) if distance_km else 0
        return {"duration_adjustment_minutes": max(0, travel_minutes + phase_minutes)}

    def _process_arrivals_and_completions(self) -> None:
        self._process_transport_arrivals()
        self._process_mission_returns()
        self._process_job_progress_and_completions()

    def _process_transport_arrivals(self) -> None:
        arrived = [shipment for shipment in self.transport_shipments if shipment.arrival_minute <= self.minute]
        self.transport_shipments = [
            shipment for shipment in self.transport_shipments if shipment.arrival_minute > self.minute
        ]
        for shipment in arrived:
            node = self.nodes.get(shipment.destination_node_id)
            if node is None:
                continue
            node["inventory"][shipment.spare_type] = int(node["inventory"].get(shipment.spare_type, 0)) + shipment.quantity
            self.total_transport_delay += max(0, shipment.arrival_minute - shipment.requested_minute)
            self._event(
                "transport_arrived",
                f"{shipment.quantity} {shipment.spare_type} arrived at {shipment.destination_node_id}",
            )

    def _process_mission_returns(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.state == "flying" and aircraft.return_time is not None and aircraft.return_time <= self.minute:
                mission = self._mission_by_id(aircraft.current_mission_id)
                if mission is not None and aircraft.tail_number not in mission.failed_tail_numbers and aircraft.in_flight_failure:
                    mission.failed_tail_numbers.append(aircraft.tail_number)
                aircraft.flight_hours += max(0.0, float((aircraft.return_time - (mission.actual_start if mission else 0)) / 60.0))
                aircraft.landing_count += 1
                aircraft.state = "maintenance"
                if aircraft.in_flight_failure:
                    self.failed_sorties += 1
                    component = self._component_by_id(aircraft.failed_component_id)
                    self._create_job(aircraft, self.repair_activity, kind="repair", component=component)
                    self._event("mission_failed_returned", f"{aircraft.tail_number} returned with failure")
                else:
                    aircraft.postflight_required = True
                    self._create_job(aircraft, self.postflight_activity, kind="postflight")
                    self._event("mission_returned", f"{aircraft.tail_number} returned from mission and needs postflight")
                aircraft.current_mission_id = None
                aircraft.return_time = None

    def _process_job_progress_and_completions(self) -> None:
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
            activity = self._activity_by_id(job.activity_id)
            personnel = _resource_quantity(
                task.get("personnel"),
                task.get("requiredPersonnel", task.get("required_personnel", activity.get("required_personnel"))),
                default=1,
            )
            equipment = _resource_quantity(
                task.get("equipment"),
                task.get("requiredDevices", task.get("required_devices", activity.get("required_devices"))),
                default=1,
            )
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
                if not self._has_in_transit_spare(node["id"], spare_type):
                    self._try_transport_replenishment(node, spare_type, spare_qty)
            if spare_type and node["inventory"].get(spare_type, 0) < spare_qty:
                self.shortage_events += 1
                reason = "in_transit" if self._has_in_transit_spare(node["id"], spare_type) else f"spare:{spare_type}"
                job.shortage_reason = reason
                continue
            node["personnel_in_use"] += personnel
            node["equipment_in_use"] += equipment
            node["work_count"] += 1
            job.state = "running"
            job.remaining = max(1, int(task.get("durationMinutes") or task.get("duration_minutes") or activity.get("duration_minutes") or 30))
            job.started_time = job.started_time if job.started_time is not None else self.minute
            job.shortage_reason = None
            self._event("job_started", f"{job.job_id} started {task.get('workName') or task.get('activityCode') or 'task'}")

    def _evaluate_failures(self) -> None:
        if not self.components:
            return
        for aircraft in self.aircraft:
            if aircraft.state != "flying":
                continue
            if aircraft.failed_component_id:
                continue
            for component in self.components:
                component_id = str(component.get("id") or "component")
                remaining = aircraft.lru_failure_remaining_minutes.get(component_id)
                if remaining is None:
                    remaining = self._sample_lru_failure_minutes(component)
                remaining -= self.tick_minutes
                aircraft.lru_failure_remaining_minutes[component_id] = remaining
                if remaining <= 0:
                    aircraft.failed_component_id = component_id
                    self.lru_failures += 1
                    if component.get("rbd_root"):
                        self.rbd_root_failures += 1
                    self.failure_delay_events += 1
                    aircraft.in_flight_failure = True
                    self.in_flight_failures += 1
                    self._event("component_failed", f"{aircraft.tail_number} failed {component.get('name') or component.get('id')}")
                    break

    def _generate_preventive_jobs(self) -> None:
        interval_days = self._preventive_interval_days()
        interval_hours = self._preventive_interval_hours()
        interval_landings = self._preventive_interval_landings()
        if interval_days <= 0 and interval_hours <= 0 and interval_landings <= 0:
            return
        for aircraft in self.aircraft:
            if aircraft.state != "available" or aircraft.preventive_due:
                continue
            if any(job.kind == "preventive" and job.tail_number == aircraft.tail_number and job.state != "completed" for job in self.jobs):
                continue
            due_by_day = interval_days > 0 and self.minute - aircraft.last_preventive_minute >= interval_days * 1440
            due_by_hours = interval_hours > 0 and aircraft.flight_hours >= interval_hours
            due_by_landings = interval_landings > 0 and aircraft.landing_count >= interval_landings
            if due_by_day or due_by_hours or due_by_landings:
                aircraft.state = "maintenance"
                aircraft.preventive_due = True
                self._create_job(aircraft, self.preventive_activity, kind="preventive")
                self._event("preventive_created", f"{aircraft.tail_number} preventive maintenance created")

    def _preventive_interval_days(self) -> int:
        value = (
            self.preventive_activity.get("calendarDayInterval")
            or self.preventive_activity.get("calendar_day_interval")
            or self.preventive_activity.get("intervalDays")
        )
        return _positive_int(value, 0)

    def _preventive_interval_hours(self) -> int:
        value = self.preventive_activity.get("runHourInterval") or self.preventive_activity.get("run_hour_interval")
        return _positive_int(value, 0)

    def _preventive_interval_landings(self) -> int:
        value = self.preventive_activity.get("takeoffLandingInterval") or self.preventive_activity.get("takeoff_landing_interval")
        return _positive_int(value, 0)

    def _create_due_preflight_jobs(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.minute < mission.preparation_start:
                continue
            if self._mission_preflight_commissioned_count(mission) >= mission.required_aircraft:
                mission.preflight_created = True
                continue
            active_preflight_tails = self._active_preflight_tail_numbers(mission.mission_id)
            available = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.state == "available"
                and self._aircraft_matches_mission_type(aircraft, mission)
                and mission.mission_id not in aircraft.prepared_mission_ids
                and aircraft.tail_number not in active_preflight_tails
            ]
            needed = mission.required_aircraft - self._mission_preflight_commissioned_count(mission)
            created = 0
            for aircraft in available[: max(0, needed)]:
                aircraft.state = "maintenance"
                self._create_job(aircraft, self.preflight_activity, kind="preflight", mission_id=mission.mission_id)
                created += 1
            mission.preflight_created = self._mission_preflight_commissioned_count(mission) >= mission.required_aircraft
            if created:
                self._event("preflight_created", f"{mission.mission_id} created {created} jobs")

    def _dispatch_due_missions(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.minute < mission.planned_start:
                continue
            candidates = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.state == "available"
                and mission.mission_id in aircraft.prepared_mission_ids
                and self._aircraft_matches_mission_type(aircraft, mission)
            ]
            if len(candidates) >= mission.required_aircraft:
                assigned = candidates[: mission.required_aircraft]
                for aircraft in assigned:
                    aircraft.state = "flying"
                    aircraft.current_mission_id = mission.mission_id
                    aircraft.return_time = self.minute + mission.duration_minutes
                    aircraft.takeoff_count += 1
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

    def _has_in_transit_spare(self, node_id: str, spare_type: str) -> bool:
        return any(
            shipment.destination_node_id == node_id and shipment.spare_type == spare_type
            for shipment in self.transport_shipments
        )

    def _active_preflight_tail_numbers(self, mission_id: str) -> set[str]:
        return {
            job.tail_number
            for job in self.jobs
            if job.kind == "preflight" and job.mission_id == mission_id and job.state != "completed"
        }

    def _mission_preflight_commissioned_count(self, mission: MissionState) -> int:
        active_preflight_tails = self._active_preflight_tail_numbers(mission.mission_id)
        prepared_available_tails = {
            aircraft.tail_number
            for aircraft in self.aircraft
            if aircraft.state == "available"
            and mission.mission_id in aircraft.prepared_mission_ids
            and self._aircraft_matches_mission_type(aircraft, mission)
        }
        matching_active_tails = {
            tail_number
            for tail_number in active_preflight_tails
            if (aircraft := self._aircraft_by_tail(tail_number)) is not None
            and self._aircraft_matches_mission_type(aircraft, mission)
        }
        return len(matching_active_tails | prepared_available_tails)

    def _aircraft_matches_mission_type(self, aircraft: AircraftState, mission: MissionState) -> bool:
        required_tokens = _aircraft_type_tokens(mission.required_aircraft_type)
        if not required_tokens:
            return True
        candidate_tokens = _aircraft_type_tokens(aircraft.aircraft_type) | _aircraft_type_tokens(aircraft.model)
        if not candidate_tokens:
            return False
        for candidate in candidate_tokens:
            for required in required_tokens:
                if candidate == required or candidate.startswith(required) or required.startswith(candidate):
                    return True
        return False

    def _aircraft_by_tail(self, tail_number: str) -> AircraftState | None:
        return next((aircraft for aircraft in self.aircraft if aircraft.tail_number == tail_number), None)

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
        for task in tasks:
            task.setdefault("durationMinutes", activity.get("duration_minutes") or 30)
            task.setdefault("requiredPersonnel", activity.get("required_personnel") or 1)
            task.setdefault("requiredDevices", activity.get("required_devices") or 1)
            if activity.get("spare_type") and activity.get("spare_quantity") and not task.get("spare"):
                task["spare"] = f"{activity['spare_type']},{activity['spare_quantity']}"
        if kind == "repair" and component is not None:
            if component.get("repair_duration_minutes"):
                tasks[-1]["durationMinutes"] = max(1, int(component["repair_duration_minutes"]))
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
        activity = self._activity_by_id(job.activity_id)
        personnel = _resource_quantity(
            task.get("personnel"),
            task.get("requiredPersonnel", task.get("required_personnel", activity.get("required_personnel"))),
            default=1,
        )
        equipment = _resource_quantity(
            task.get("equipment"),
            task.get("requiredDevices", task.get("required_devices", activity.get("required_devices"))),
            default=1,
        )
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

    def _try_transport_replenishment(self, node: dict[str, Any], spare_type: str, needed: int) -> None:
        shortage = max(0, needed - int(node["inventory"].get(spare_type, 0)))
        if shortage <= 0:
            return
        for policy in node.get("transport_policies") or []:
            if policy.get("to") and policy["to"] != node["id"]:
                continue
            if policy.get("spare_type") and policy["spare_type"] != spare_type:
                continue
            source = self.nodes.get(str(policy.get("from") or ""))
            if source is None:
                continue
            available = int(source["inventory"].get(spare_type, 0))
            moved = min(available, shortage, max(1, int(policy.get("capacity") or 1)))
            if moved <= 0:
                continue
            source["inventory"][spare_type] = available - moved
            self.transport_replenishment_events += 1
            transport_minutes = max(0, int(policy.get("transport_minutes") or 0))
            if transport_minutes:
                self.transport_shipments.append(
                    TransportShipment(
                        source_node_id=str(source["id"]),
                        destination_node_id=str(node["id"]),
                        spare_type=spare_type,
                        quantity=moved,
                        requested_minute=self.minute,
                        arrival_minute=self.minute + transport_minutes,
                    )
                )
                self._event(
                    "transport_dispatched",
                    f"{moved} {spare_type} dispatched from {source['id']} to {node['id']}",
                )
                return
            node["inventory"][spare_type] = int(node["inventory"].get(spare_type, 0)) + moved
            self._event("transport_replenished", f"{moved} {spare_type} moved from {source['id']} to {node['id']}")
            return

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
            component = self._component_by_id(job.component_id)
            if component is not None:
                aircraft.lru_failure_remaining_minutes[str(component.get("id") or "component")] = self._sample_lru_failure_minutes(component)
            aircraft.failed_component_id = None
            aircraft.in_flight_failure = False
            self._event("repair_completed", f"{aircraft.tail_number} repair completed")
        elif job.kind == "postflight":
            aircraft.state = "available"
            aircraft.postflight_required = False
            self.completed_sorties += 1
            self._event("postflight_completed", f"{aircraft.tail_number} postflight completed")
        elif job.kind == "preventive":
            aircraft.state = "available"
            aircraft.preventive_due = False
            aircraft.last_preventive_minute = self.minute
            aircraft.flight_hours = 0.0
            aircraft.takeoff_count = 0
            aircraft.landing_count = 0
            self._event("preventive_completed", f"{aircraft.tail_number} preventive maintenance completed")

    def _activity_by_id(self, activity_id: str) -> dict[str, Any]:
        return next((item for item in self.activities if str(item.get("id")) == str(activity_id)), {})

    def _mission_by_id(self, mission_id: str | None) -> MissionState | None:
        if mission_id is None:
            return None
        return next((item for item in self.missions if item.mission_id == mission_id), None)

    def _component_by_id(self, component_id: str | None) -> dict[str, Any] | None:
        if component_id is None:
            return None
        return next((item for item in self.components if str(item.get("id")) == str(component_id)), None)

    def _mean_recovery_time(self) -> float:
        completed = [
            mission
            for mission in self.missions
            if mission.actual_start is not None and mission.return_time is not None
        ]
        if not completed:
            return 0.0
        return sum(float((mission.return_time or 0) - (mission.actual_start or 0)) for mission in completed) / len(completed)

    def _aircraft_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "type": item.aircraft_type,
            "state": item.state,
            "x": item.x,
            "y": item.y,
            "current_mission_id": item.current_mission_id,
            "failed_lru": item.failed_component_id or "",
            "flight_hours": item.flight_hours,
            "takeoff_count": item.takeoff_count,
            "landing_count": item.landing_count,
            "postflight_required": item.postflight_required,
            "preventive_due": item.preventive_due,
            "in_flight_failure": item.in_flight_failure,
        }

    def _mission_payload(self, item: MissionState) -> dict[str, Any]:
        return {
            "mission_id": item.mission_id,
            "name": item.name,
            "planned_start": item.planned_start,
            "actual_start": item.actual_start,
            "return_time": item.return_time,
            "required_aircraft": item.required_aircraft,
            "required_aircraft_type": item.required_aircraft_type,
            "task_category": item.task_category,
            "periodic_task_id": item.periodic_task_id,
            "periodic_task_name": item.periodic_task_name,
            "composite_task_id": item.composite_task_id,
            "composite_task_name": item.composite_task_name,
            "basic_task_id": item.basic_task_id,
            "basic_task_name": item.basic_task_name or item.name,
            "group_name": item.group_name,
            "wave_index": item.wave_index,
            "day_index": item.day_index,
            "duration_minutes": item.duration_minutes,
            "preparation_start": item.preparation_start,
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
                        "pending_quantity": sum(
                            shipment.quantity
                            for shipment in self.transport_shipments
                            if shipment.destination_node_id == node["id"] and shipment.spare_type == spare_type
                        ),
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


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _aircraft_type_tokens(value: Any) -> set[str]:
    if value in (None, ""):
        return set()
    text = str(value).upper()
    for separator in ("、", "，", ",", "/", "\\", "|", ";", "；", "&"):
        text = text.replace(separator, " ")
    for word_separator in (" OR ", " 或 ", " 和 "):
        text = text.replace(word_separator, " ")
    tokens = set()
    for part in text.split():
        canonical = "".join(character for character in part if character.isalnum())
        if canonical:
            tokens.add(canonical)
    return tokens


def _periodic_period_days(periodic: dict[str, Any]) -> int:
    for key in ("taskPeriodDays", "periodDays", "cycleDays", "repeatCycleDays"):
        parsed = _positive_int(periodic.get(key), 0)
        if parsed > 0:
            return parsed
    repeat_cycle_value = _positive_int(periodic.get("repeatCycleValue"), 0)
    if repeat_cycle_value > 0:
        unit = str(periodic.get("repeatCycleUnit") or "day").lower()
        if unit in {"week", "weeks", "周", "星期"}:
            return repeat_cycle_value * 7
        if unit in {"hour", "hours", "小时"}:
            return max(1, math.ceil(repeat_cycle_value / 24))
        return repeat_cycle_value
    return 1


def _periodic_total_days(periodic: dict[str, Any]) -> int:
    period_days = _periodic_period_days(periodic)
    repeat_count = 1
    for key in ("repeatCount", "repeatRounds", "repeatWeeks"):
        parsed = _positive_int(periodic.get(key), 0)
        if parsed > 0:
            repeat_count = parsed
            break
    return max(1, period_days * repeat_count)


def _bounded_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(0.0, parsed))


def _failure_distribution_rate(distribution: dict[str, Any]) -> float | None:
    parameters = distribution.get("parameters") or distribution.get("params")
    multiplier = _non_negative_float(distribution.get("_rate_multiplier"), 1.0)
    if isinstance(parameters, (int, float)):
        return max(0.0, float(parameters)) * multiplier
    if not isinstance(parameters, str):
        return None
    values = _distribution_parameters(parameters)
    distribution_type = str(distribution.get("distributionType") or distribution.get("distribution_type") or "").lower()
    if "lambda" in values or "λ" in values or "rate" in values or "failure_rate" in values:
        return (
            values.get("lambda")
            or values.get("λ")
            or values.get("rate")
            or values.get("failure_rate")
            or 0.0
        ) * multiplier
    if "weibull" in distribution_type or "威布尔" in distribution_type:
        beta = values.get("beta") or values.get("shape") or 1.0
        eta = values.get("eta") or values.get("scale") or values.get("mean")
        if eta and eta > 0:
            mean_time = eta * math.gamma(1.0 + 1.0 / max(beta, 0.001))
            return (1.0 / mean_time) * multiplier
    if "normal" in distribution_type or "正态" in distribution_type:
        mean = values.get("mean") or values.get("mu")
        if mean and mean > 0:
            return (1.0 / mean) * multiplier
    return None


def _distribution_parameters(parameters: str) -> dict[str, float]:
    text = parameters.replace("，", ",").replace("；", ",").replace(";", ",")
    values: dict[str, float] = {}
    for item in text.split(","):
        if "=" not in item:
            continue
        key, value = [part.strip().lower() for part in item.split("=", 1)]
        values[key] = _non_negative_float(value, 0.0)
    return values
