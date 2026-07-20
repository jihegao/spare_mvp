"""Aircraft support v1 runtime core.

The model uses deterministic minute ticks and declares the M9.7.4 field
coverage boundary through ``behavior_scope()``.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
import hashlib
import math
import random
from typing import Any


BEHAVIOR_DRIVING_FIELDS = [
    "combatUnit.members",
    "missionProfile.combatUnit.members",
    "missionProfile.durationHours",
    "missionProfile.compositeTasks",
    "missionProfile.periodicTasks",
    "basicMissions",
    "basicMissions[].missionPhases",
    "airports",
    "products[]",
    "components[].productId",
    "components[].aircraftModel",
    "components[].failureDistribution",
    "components[].kOutOfN",
    "components[].specialRepairProfile",
    "supportResources[].quantity",
    "supportResources[].type",
    "supportResources[].productId",
    "supportResources[].supportNodeName",
    "transportPolicies[]",
    "supportActivityJobs[]",
    "supportActivities[].aircraftModel",
    "supportActivities[].equipmentId",
    "supportActivities[].activityCodes",
    "supportActivities[].predecessors",
    "supportActivities[].maintenanceMethods",
    "supportActivities[].replacementRatio",
    "experiment.seed",
    "experiment.samples",
    "ExperimentPlan.config.stopPolicy",
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
    airport: str = ""
    airport_id: str = ""
    current_mission_id: str | None = None
    return_time: int | None = None
    failed_component_id: str | None = None
    failed_component_minute: int | None = None
    component_failure_minutes: dict[str, int] = field(default_factory=dict)
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
    min_required_aircraft: int
    priority: int
    cancel_minutes: int
    success_point: float = 1.0
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
    success_evaluated: bool = False
    success_member_count: int = 0
    success_at_minute: int | None = None
    succeeded: bool = False

    @property
    def success_minute(self) -> int:
        """Task-success checkpoint, anchored to the actual task start when launched."""
        start = self.actual_start if self.actual_start is not None else self.planned_start
        return start + math.ceil(self.duration_minutes * self.success_point)


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
    maintenance_method: str | None = None
    replacement_ratio: float | None = None
    maintenance_decision_roll: float | None = None
    maintenance_rng_stream: str | None = None
    maintenance_occurrence: int | None = None
    consumed_spare_task_indexes: set[int] = field(default_factory=set)
    spare_shortage_signature: tuple[tuple[str, int, int, str], ...] | None = None

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
        self.write_event_snapshots = _truthy_input_flag(
            self.inputs.get("write_event_snapshots")
            or self.inputs.get("writeEventSnapshots")
            or self.inputs.get("capture_event_snapshots")
        )
        self.event_snapshot_limit = _positive_int(
            self.inputs.get("event_snapshot_limit") or self.inputs.get("eventSnapshotLimit"),
            20,
        )
        self._event_snapshot_count = 0
        time_config = self.inputs.get("time", {})
        self.disable_visualization_frames = _truthy_input_flag(
            self.inputs.get("disable_visualization_frames")
            or self.inputs.get("disableVisualizationFrames")
            or time_config.get("disable_visualization_frames")
        )
        self.duration_minutes = int(time_config.get("duration_minutes", 1440))
        self.tick_minutes = int(time_config.get("tick_minutes", 1))
        self.sample_every_minutes = int(time_config.get("sample_every_minutes", 30))
        self.max_state_frames_single = int(time_config.get("max_state_frames_single", 2000))
        self.stop_policy = _normalized_stop_policy(self.inputs.get("stop_policy"), self.duration_minutes)
        self.stop_reason = ""
        self.stop_conditions_met: list[str] = []
        self.minute = 0
        self.time = 0
        self.event_log: list[dict[str, Any]] = []
        self.aircraft = self._build_aircraft()
        self.equipment_tree_components = self._equipment_tree_components()
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
        self._maintenance_occurrence_by_kind = {"repair": 0, "preventive": 0}
        self.completed_sorties = 0
        self.failed_sorties = 0
        self.launched_sorties = 0
        self.cancelled_sorties = 0
        self.delayed_sorties = 0
        self.total_departure_delay = 0
        self.total_transport_delay = 0
        self.lru_failures = 0
        self.in_flight_failures = 0
        self.spare_consumed_total = 0
        self.shortage_events = 0
        self.transport_replenishment_events = 0
        self.resource_delay_events = 0
        self.equipment_shortage_events = 0
        self.preventive_maintenance_events = 0
        self.downtime_minutes = {"failure": 0.0, "equipment_shortage": 0.0, "spare_shortage": 0.0, "preventive": 0.0}
        self.downtime_events: list[dict[str, Any]] = []
        self._active_downtime_events: dict[str, dict[str, Any]] = {}
        self._downtime_event_sequence = 0
        self.failure_delay_events = 0
        self.daily_readiness_samples: list[dict[str, Any]] = []
        self._daily_readiness_sample_days: set[int] = set()
        self.running = True
        self.steps = 0

    @staticmethod
    def behavior_scope() -> dict[str, list[str]]:
        return {
            "behavior_driving_fields": list(BEHAVIOR_DRIVING_FIELDS),
            "fail_closed_fields": list(FAIL_CLOSED_FIELDS),
            "m9_7_4_coverage_hardening_fields": list(M9_7_4_COVERAGE_HARDENING_FIELDS),
        }

    def run(self) -> dict[str, Any]:
        frames = [] if self.disable_visualization_frames else [self.visualization_frame(run_id="", step=0)]
        while self.running:
            self.step()
            should_stop = not self.running
            if should_stop:
                self._finalize_unresolved_mission_successes()
            if not self.disable_visualization_frames and (
                self.minute % self.sample_every_minutes == 0 or self.minute == self.duration_minutes or should_stop
            ):
                frames.append(self.visualization_frame(run_id="", step=len(frames)))
                if len(frames) > self.max_state_frames_single:
                    raise ValueError(
                        "visualization_state_series exceeds max_state_frames_single; increase sample_every_minutes"
                    )
            if should_stop:
                break
        self._finalize_unresolved_mission_successes()
        self._close_all_downtime_events()
        return {
            "metrics": self.snapshot(),
            "frames": frames,
            "events": copy.deepcopy(self.event_log),
            "downtime_events": copy.deepcopy(self.downtime_events),
        }

    def step(self) -> bool:
        """Advance the model by one runtime tick for Solara/Mesa controls."""
        if not self.running:
            return False
        self.minute = 1 if self.minute <= 0 else min(self.duration_minutes, self.minute + self.tick_minutes)
        self.time = self.minute
        self.steps += 1
        try:
            self._process_transport_arrivals()
            self._process_mission_returns()
            self._process_job_progress_and_completions()
            self._evaluate_failures()
            self._generate_preventive_jobs()
            self._create_due_preflight_jobs()
            self._start_waiting_jobs()
            self._dispatch_due_missions()
            self._evaluate_mission_success_points()
            self._record_daily_readiness_sample_if_due()
            self._record_downtime_minutes()
            stop_reason, stop_conditions = self._stop_decision()
            should_stop = bool(stop_reason)
            if should_stop:
                self.stop_reason = stop_reason
                self.stop_conditions_met = stop_conditions
                self._event(
                    "simulation_stopped",
                    f"simulation stopped by {stop_reason}",
                    {"reason": stop_reason, "conditions": stop_conditions},
                )
            if should_stop or self.minute >= self.duration_minutes:
                self.running = False
            return True
        except Exception:
            self.running = False
            raise

    def snapshot(self) -> dict[str, Any]:
        downtime_summary = self._downtime_event_summary()
        planned_sorties = sum(mission.required_aircraft for mission in self.missions) or 1
        available = sum(1 for aircraft in self.aircraft if aircraft.state == "available")
        active_jobs = sum(1 for job in self.jobs if job.state == "running")
        backlog = sum(1 for job in self.jobs if job.state == "waiting")
        repair_backlog = sum(1 for job in self.jobs if job.kind == "repair" and job.state in {"waiting", "running"})
        postflight_backlog = sum(1 for job in self.jobs if job.kind == "postflight" and job.state in {"waiting", "running"})
        preventive_backlog = sum(1 for job in self.jobs if job.kind == "preventive" and job.state in {"waiting", "running"})
        stock_total = sum(sum(max(0, int(qty)) for qty in node["inventory"].values()) for node in self.nodes.values())
        total_inventory = max(1, stock_total + self.spare_consumed_total)
        aircraft_count = max(1, len(self.aircraft))
        simulation_days = max(1.0, self.duration_minutes / 1440.0)
        sortie_completion_rate = min(1.0, self.completed_sorties / planned_sorties)
        executable_missions = [mission for mission in self.missions if mission.planned_start <= self.minute]
        successful_mission_waves = sum(1 for mission in executable_missions if mission.succeeded)
        mission_success_rate = successful_mission_waves / max(1, len(executable_missions))
        sortie_rate = max(0.0, self.launched_sorties / aircraft_count / simulation_days)
        ready_rate = (
            sum(float(sample["ready_rate"]) for sample in self.daily_readiness_samples)
            / len(self.daily_readiness_samples)
            if self.daily_readiness_samples
            else available / aircraft_count
        )
        avg_delay = self.total_departure_delay / max(1, self.launched_sorties + self.cancelled_sorties)
        mean_transport_delay = (self.total_transport_delay / 60.0) / max(1, self.transport_replenishment_events)
        return {
            "sortie_completion_rate": sortie_completion_rate,
            "mission_success_rate": mission_success_rate,
            "sortie_rate": sortie_rate,
            "ready_rate": ready_rate,
            "aircraft_count": aircraft_count,
            "simulation_days": simulation_days,
            "available_aircraft": available,
            "daily_readiness_sample_count": len(self.daily_readiness_samples),
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
            "downtime_preventive_events": downtime_summary["preventive"]["event_count"],
            "planned_sorties": planned_sorties,
            "planned_mission_waves": len(executable_missions),
            "successful_mission_waves": successful_mission_waves,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "failed_sorties": self.failed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "delayed_sorties": self.delayed_sorties,
            "spare_fill_rate": min(1.0, stock_total / total_inventory),
            "spare_utilization": min(1.0, self.spare_consumed_total / total_inventory),
            "shortage_events": self.shortage_events,
            "transport_in_transit_count": len(self.transport_shipments),
            "downtime_failure_events": downtime_summary["failure"]["event_count"],
            "downtime_spare_shortage_events": downtime_summary["spare_shortage"]["event_count"],
            "downtime_resource_delay_events": self.resource_delay_events,
            "downtime_equipment_shortage_events": downtime_summary["equipment_shortage"]["event_count"],
            "downtime_failure_hours": downtime_summary["failure"]["duration_minutes"] / 60.0,
            "downtime_equipment_shortage_hours": downtime_summary["equipment_shortage"]["duration_minutes"] / 60.0,
            "downtime_spare_shortage_hours": downtime_summary["spare_shortage"]["duration_minutes"] / 60.0,
            "downtime_preventive_hours": downtime_summary["preventive"]["duration_minutes"] / 60.0,
            "transport_replenishment_events": self.transport_replenishment_events,
            "total_transport_delay_minutes": self.total_transport_delay,
            "mean_transport_delay": mean_transport_delay,
            "elapsed_minutes": self.minute,
            "stop_reason": self.stop_reason,
            "stop_conditions_met": list(self.stop_conditions_met),
            "in_flight_failures": self.in_flight_failures,
            "mean_launch_time": avg_delay,
            "mean_recovery_time": self._mean_recovery_time(),
            "mean_turnaround_time": avg_delay + self._mean_recovery_time(),
        }

    def _record_downtime_minutes(self) -> None:
        tick = max(1.0, float(self.tick_minutes or 1))
        interval_start = max(0.0, float(self.minute) - tick)
        current: dict[str, dict[str, Any]] = {}
        for aircraft in self.aircraft:
            event = self._current_downtime_event(aircraft, interval_start)
            if event is not None:
                current[aircraft.tail_number] = event

        for tail_number, active in list(self._active_downtime_events.items()):
            candidate = current.get(tail_number)
            if (
                candidate is None
                or self._downtime_event_context_key(candidate) != self._downtime_event_context_key(active)
            ):
                self._close_downtime_event(tail_number)

        for tail_number, candidate in current.items():
            active = self._active_downtime_events.get(tail_number)
            if active is None:
                self._downtime_event_sequence += 1
                candidate["event_id"] = f"downtime-{self._downtime_event_sequence:06d}"
                self._active_downtime_events[tail_number] = candidate
                active = candidate
            active["end_minute"] = float(self.minute)
            active["duration_minutes"] = max(0.0, float(active["end_minute"]) - float(active["start_minute"]))

        summary = self._downtime_event_summary()
        self.downtime_minutes = {factor: values["duration_minutes"] for factor, values in summary.items()}

    @staticmethod
    def _downtime_event_context_key(event: dict[str, Any]) -> tuple[str, ...]:
        return tuple(
            str(event.get(field) or "")
            for field in (
                "factor",
                "mission_id",
                "mission_phase",
                "mission_phase_id",
                "mission_phase_name",
                "support_node_id",
                "job_id",
            )
        )

    def _current_downtime_event(self, aircraft: AircraftState, start_minute: float) -> dict[str, Any] | None:
        active_jobs = [
            job for job in self.jobs
            if job.tail_number == aircraft.tail_number and job.state in {"waiting", "running"}
        ]
        spare_job = next(
            (job for job in active_jobs if job.state == "waiting" and str(job.shortage_reason or "").startswith(("spare:", "in_transit"))),
            None,
        )
        equipment_job = next(
            (job for job in active_jobs if job.state == "waiting" and job.shortage_reason == "equipment_capacity"),
            None,
        )
        repair_job = next((job for job in active_jobs if job.kind == "repair"), None)
        preventive_job = next((job for job in active_jobs if job.kind == "preventive"), None)
        # A direct waiting gate overrides the underlying maintenance cause.  If no
        # gate exists, unplanned repair precedes planned preventive maintenance.
        if spare_job is not None:
            return self._downtime_event_payload("spare_shortage", aircraft, spare_job, start_minute)
        if equipment_job is not None:
            return self._downtime_event_payload("equipment_shortage", aircraft, equipment_job, start_minute)
        if aircraft.failed_component_id is not None or repair_job is not None:
            return self._downtime_event_payload("failure", aircraft, repair_job, start_minute)
        if preventive_job is not None or aircraft.preventive_due:
            return self._downtime_event_payload("preventive", aircraft, preventive_job, start_minute)
        return None

    def _downtime_event_payload(
        self,
        factor: str,
        aircraft: AircraftState,
        job: JobState | None,
        start_minute: float,
    ) -> dict[str, Any]:
        task = job.current_task if job is not None else None
        task = task if isinstance(task, dict) else {}
        node = self.nodes.get(job.resource_node_id) if job is not None else None
        mission_id = job.mission_id if job is not None else aircraft.current_mission_id
        mission = self._mission_by_id(mission_id)
        component = self._component_by_id(job.component_id if job is not None else aircraft.failed_component_id)
        component_id = str(
            (component or {}).get("id")
            or (job.component_id if job is not None else None)
            or aircraft.failed_component_id
            or ""
        )
        failure_minute = aircraft.failed_component_minute
        if failure_minute is None and component_id:
            failure_minute = aircraft.component_failure_minutes.get(component_id)
        details: dict[str, Any]
        if factor == "spare_shortage":
            spare_type, required = self._shortage_spare_requirement(job, task) if job is not None else (None, 0)
            available = int((node or {}).get("inventory", {}).get(spare_type, 0) or 0) if spare_type else None
            arrivals = [
                shipment.arrival_minute for shipment in self.transport_shipments
                if job is not None
                and shipment.destination_node_id == job.resource_node_id
                and shipment.spare_type == spare_type
            ]
            details = {
                "product_id": spare_type,
                "spare_name": self._product_display_name(spare_type) if spare_type else None,
                "spare_model": None,
                "required_quantity": required or None,
                "available_quantity": available,
                "shortage_quantity": max(0, required - available) if available is not None else None,
                "arrival_minute": min(arrivals) if arrivals else None,
                "wait_end_minute": None,
            }
        elif factor == "equipment_shortage":
            activity = self._activity_by_id(job.activity_id) if job is not None else {}
            required = _resource_quantity(
                task.get("equipment"),
                task.get("requiredDevices", task.get("required_devices", activity.get("required_devices"))),
                default=1,
            )
            available = max(0, int((node or {}).get("equipment_capacity", 0)) - int((node or {}).get("equipment_in_use", 0)))
            details = {
                "equipment_name": task.get("equipmentName") or task.get("equipment_name"),
                "equipment_model": task.get("equipmentModel") or task.get("equipment_model"),
                "required_quantity": required,
                "available_quantity": available,
                "shortage_quantity": max(0, required - available),
                "wait_minutes": None,
            }
        elif factor == "failure":
            details = {
                "component_id": component_id or None,
                "component_name": (component or {}).get("name"),
                "failure_mode": (component or {}).get("failure_mode"),
                "failure_minute": failure_minute,
                "repair_completed_minute": None,
            }
        else:
            activity = self._activity_by_id(job.activity_id) if job is not None else self._select_activity("preventive", aircraft=aircraft)
            trigger_types = []
            if self._preventive_interval_days(activity) > 0 and self.minute - aircraft.last_preventive_minute >= self._preventive_interval_days(activity) * 1440:
                trigger_types.append("calendar_time")
            if self._preventive_interval_hours(activity) > 0 and aircraft.flight_hours >= self._preventive_interval_hours(activity):
                trigger_types.append("flight_hours")
            if self._preventive_interval_landings(activity) > 0 and aircraft.landing_count >= self._preventive_interval_landings(activity):
                trigger_types.append("landings")
            details = {
                "maintenance_type": job.activity_name if job is not None else activity.get("name"),
                "maintenance_method": job.maintenance_method if job is not None else None,
                "trigger_type": ",".join(trigger_types) if trigger_types else None,
                "trigger_condition": None,
                "planned_start_minute": start_minute,
                "completed_minute": None,
            }
        phase_id = str(task.get("activityCode") or task.get("id") or (job.kind if job is not None else ""))
        phase_name = str(
            task.get("workName")
            or task.get("name")
            or (job.activity_name if job is not None else "")
        )
        mission_name = ""
        if mission is not None:
            mission_name = str(mission.basic_task_name or mission.name or "")
        return {
            "event_id": "",
            "factor": factor,
            "tail_number": aircraft.tail_number,
            "aircraft_type": aircraft.aircraft_type,
            "mission_id": mission_id,
            "mission_name": mission_name or None,
            "mission_phase": job.kind if job is not None else None,
            "mission_phase_id": phase_id or None,
            "mission_phase_name": phase_name or None,
            "support_node_id": job.resource_node_id if job is not None else None,
            "support_node_name": (node or {}).get("name"),
            "job_id": job.job_id if job is not None else None,
            "job_kind": job.kind if job is not None else None,
            "task_name": task.get("workName") or task.get("activityCode") or (job.activity_name if job is not None else None),
            "start_minute": start_minute,
            "end_minute": float(self.minute),
            "duration_minutes": max(0.0, float(self.minute) - start_minute),
            "description": self._downtime_description(factor, aircraft, job),
            "details": details,
        }

    @staticmethod
    def _downtime_description(factor: str, aircraft: AircraftState, job: JobState | None) -> str:
        labels = {
            "spare_shortage": "因所需备件短缺而等待",
            "equipment_shortage": "因保障设备不足而等待",
            "failure": "装备故障后不可用，等待修复",
            "preventive": "正在执行预防性维修",
        }
        phase = ""
        if job is not None:
            task = job.current_task if isinstance(job.current_task, dict) else {}
            phase_name = str(task.get("workName") or task.get("name") or job.activity_name or "").strip()
            if phase_name:
                phase = f"，当前阶段为{phase_name}"
        return f"飞机{aircraft.tail_number}{labels[factor]}{phase}"

    def _close_downtime_event(self, tail_number: str) -> None:
        event = self._active_downtime_events.pop(tail_number, None)
        if event is None or float(event.get("duration_minutes", 0) or 0) <= 0:
            return
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        factor = str(event.get("factor") or "")
        if factor == "equipment_shortage":
            details["wait_minutes"] = float(event["duration_minutes"])
        elif factor == "spare_shortage":
            details["wait_end_minute"] = event.get("end_minute")
        elif factor == "failure":
            aircraft = self._aircraft_by_tail(tail_number)
            active_repair = any(
                job.tail_number == tail_number and job.kind == "repair" and job.state in {"waiting", "running"}
                for job in self.jobs
            )
            if aircraft is not None and aircraft.failed_component_id is None and not active_repair:
                details["repair_completed_minute"] = event.get("end_minute")
        elif factor == "preventive":
            aircraft = self._aircraft_by_tail(tail_number)
            active_preventive = any(
                job.tail_number == tail_number and job.kind == "preventive" and job.state in {"waiting", "running"}
                for job in self.jobs
            )
            if aircraft is not None and not aircraft.preventive_due and not active_preventive:
                details["completed_minute"] = event.get("end_minute")
        self.downtime_events.append(copy.deepcopy(event))

    def _close_all_downtime_events(self) -> None:
        for tail_number in list(self._active_downtime_events):
            self._close_downtime_event(tail_number)

    def _downtime_event_summary(self) -> dict[str, dict[str, float | int]]:
        events = [*self.downtime_events, *self._active_downtime_events.values()]
        summary: dict[str, dict[str, float | int]] = {
            factor: {"event_count": 0, "duration_minutes": 0.0}
            for factor in ("failure", "equipment_shortage", "spare_shortage", "preventive")
        }
        for event in events:
            factor = str(event.get("factor") or "")
            if factor not in summary:
                continue
            summary[factor]["event_count"] = int(summary[factor]["event_count"]) + 1
            summary[factor]["duration_minutes"] = float(summary[factor]["duration_minutes"]) + max(
                0.0, float(event.get("duration_minutes", 0) or 0)
            )
        return summary

    def _stop_decision(self) -> tuple[str, list[str]]:
        policy_met, policy_conditions = self._stop_policy_met()
        if policy_met:
            reason = policy_conditions[0] if len(policy_conditions) == 1 else "stop_policy"
            return reason, policy_conditions
        if self._natural_completion_reached() and not self._explicit_temporal_stop_pending():
            return "natural_complete", ["natural_complete"]
        return "", []

    def _explicit_temporal_stop_pending(self) -> bool:
        if self.stop_policy.get("defaulted"):
            return False
        for condition in self.stop_policy.get("conditions", []):
            condition_type = str(condition.get("type") or "")
            if condition_type == "duration":
                if self.minute < int(condition.get("duration_minutes") or self.duration_minutes):
                    return True
            elif condition_type == "specified_time":
                if self.minute < int(condition.get("minute") or self.duration_minutes):
                    return True
        return False

    def _stop_policy_met(self) -> tuple[bool, list[str]]:
        evaluations: list[tuple[str, bool]] = []
        for condition in self.stop_policy.get("conditions", []):
            condition_type = str(condition.get("type") or "")
            if condition_type == "duration":
                evaluations.append((condition_type, self.minute >= int(condition.get("duration_minutes") or self.duration_minutes)))
            elif condition_type == "failure":
                evaluations.append((condition_type, self._has_task_failure()))
            elif condition_type == "specified_time":
                evaluations.append((condition_type, self.minute >= int(condition.get("minute") or self.duration_minutes)))
        if not evaluations:
            return False, []
        mode = str(self.stop_policy.get("mode") or "or")
        met = all(item[1] for item in evaluations) if mode == "and" else any(item[1] for item in evaluations)
        return met, [condition_type for condition_type, is_met in evaluations if is_met]

    def _has_task_failure(self) -> bool:
        if self.failed_sorties > 0:
            return True
        return any(mission.status == "failed" for mission in self.missions)

    def _natural_completion_reached(self) -> bool:
        if not self.missions:
            return self.minute >= self.duration_minutes
        if any(mission.status not in {"completed", "failed", "cancelled"} for mission in self.missions):
            return False
        if any(job.state in {"waiting", "running"} for job in self.jobs):
            return False
        if self.transport_shipments:
            return False
        if any(
            aircraft.state in {"flying", "pre_support", "post_support"}
            or aircraft.postflight_required
            or aircraft.preventive_due
            for aircraft in self.aircraft
        ):
            return False
        last_planned_start = max(mission.planned_start for mission in self.missions)
        return self.minute >= last_planned_start

    def _record_daily_readiness_sample_if_due(self) -> None:
        if self.minute <= 0 or self.minute % 1440 != 14 * 60:
            return
        day_index = self.minute // 1440 + 1
        if day_index in self._daily_readiness_sample_days:
            return
        aircraft_count = max(1, len(self.aircraft))
        available = sum(1 for aircraft in self.aircraft if aircraft.state == "available")
        self.daily_readiness_samples.append(
            {
                "day": day_index,
                "minute": self.minute,
                "available_aircraft": available,
                "aircraft_count": aircraft_count,
                "ready_rate": available / aircraft_count,
            }
        )
        self._daily_readiness_sample_days.add(day_index)

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
                "downtime_equipment_shortage_events": metrics["downtime_equipment_shortage_events"],
                "downtime_failure_hours": metrics["downtime_failure_hours"],
                "downtime_equipment_shortage_hours": metrics["downtime_equipment_shortage_hours"],
                "downtime_spare_shortage_hours": metrics["downtime_spare_shortage_hours"],
                "downtime_preventive_hours": metrics["downtime_preventive_hours"],
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
                        airport=str(item.get("airport") or ""),
                        airport_id=str(item.get("airport_id") or item.get("airportId") or item.get("baseAirportId") or ""),
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
        for item in self.equipment_tree_components:
            if item.get("parent_id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["quantity"] = max(1, int(component.get("quantity") or 1))
            component["root_component_id"] = self.inputs.get("equipment_tree", {}).get("root_component_id")
            effective_rate = self._effective_component_failure_rate(component)
            effective_rate *= max(1.0, math.sqrt(float(component["quantity"])))
            if effective_rate <= 0:
                continue
            component["failure_rate"] = effective_rate
            component["repair_duration_minutes"] = self._component_repair_duration_minutes(component)
            components.append(component)
        return components

    def _equipment_tree_components(self) -> list[dict[str, Any]]:
        components = []
        for item in self.inputs.get("equipment_tree", {}).get("components", []):
            if not isinstance(item, dict) or item.get("id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["id"] = str(component.get("id"))
            component["name"] = str(component.get("name") or component["id"])
            parent_id = component.get("parent_id")
            component["parent_id"] = "" if parent_id in (None, "") else str(parent_id)
            component["aircraft_model"] = str(component.get("aircraft_model") or "")
            component["product_id"] = str(component.get("product_id") or component.get("spare_type") or "")
            component["product_name"] = str(component.get("product_name") or component.get("name") or component["product_id"])
            component["spare_type"] = component["product_id"]
            component["product_type"] = str(component.get("product_type") or "")
            component["quantity"] = max(1, int(component.get("quantity") or 1))
            component["k_out_of_n"] = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
            components.append(component)
        return components

    def _effective_component_failure_rate(self, component: dict[str, Any]) -> float:
        distribution = component.get("failure_distribution")
        rate = _failure_distribution_rate(distribution) if isinstance(distribution, dict) else None
        if rate is None:
            rate = 0.0
        k_out = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
        if k_out.get("enabled"):
            k = max(1, int(k_out.get("k") or 1))
            n = max(k, int(k_out.get("n") or k))
            tolerated_failures = max(0, n - k)
            rate = rate / max(1, tolerated_failures + 1)
        return max(0.0, rate)

    def _component_repair_duration_minutes(self, component: dict[str, Any]) -> int | None:
        profile = component.get("special_repair_profile") if isinstance(component.get("special_repair_profile"), dict) else {}
        if profile.get("repairTimeMinutes"):
            return max(1, int(profile["repairTimeMinutes"]))
        return None

    def _initialize_aircraft_lru_failure_timers(self) -> None:
        for aircraft in self.aircraft:
            aircraft.lru_failure_remaining_minutes = {
                str(component.get("id") or "component"): self._sample_lru_failure_minutes(component)
                for component in self.components
            }

    def _sample_lru_failure_minutes(self, component: dict[str, Any]) -> float:
        hourly_rate = _non_negative_float(component.get("failure_rate"), 0.0)
        samples: list[float] = []
        quantity = max(1, int(component.get("quantity") or 1))
        if hourly_rate > 0:
            samples.extend(self.rng.expovariate(hourly_rate) * 60.0 for _ in range(quantity))
        return min(samples) if samples else math.inf

    def _build_support_nodes(self) -> dict[str, dict[str, Any]]:
        nodes: dict[str, dict[str, Any]] = {}
        for item in self.inputs.get("support_network", {}).get("nodes", []):
            node_id = str(item.get("id") or f"node-{len(nodes) + 1}")
            nodes[node_id] = {
                "id": node_id,
                "name": str(item.get("name") or node_id),
                "airport": str(item.get("airport") or ""),
                "airport_id": str(item.get("airport_id") or item.get("airportId") or item.get("baseAirportId") or ""),
                "personnel_capacity": max(1, int(item.get("personnel_capacity", 1))),
                "equipment_capacity": max(1, int(item.get("equipment_capacity", 1))),
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {
                    str(key): max(0, int(value))
                    for key, value in (item.get("inventory") or {}).items()
                    if isinstance(value, (int, float))
                },
                "product_names": {
                    str(key): str(value or key)
                    for key, value in (item.get("product_names") or {}).items()
                },
                "transport_policies": self._normalized_transport_policies(item.get("transport_policies") or []),
                "work_count": 0,
            }
        if not nodes:
            nodes["support-node"] = {
                "id": "support-node",
                "name": "support node",
                "airport": "",
                "airport_id": "",
                "personnel_capacity": 1,
                "equipment_capacity": 1,
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {},
                "product_names": {},
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
                    "spare_type": str(item.get("productId") or item.get("product_id") or item.get("spare_type") or ""),
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
            activity["aircraft_model"] = str(activity.get("aircraft_model") or "")
            activity["equipment_id"] = str(activity.get("equipment_id") or "")
            if self._activity_kind_matches(activity, "repair") or self._activity_kind_matches(activity, "preventive"):
                methods = [
                    str(value)
                    for value in activity.get("maintenance_methods", [])
                    if str(value) in {"non_replacement", "replacement"}
                ] if isinstance(activity.get("maintenance_methods"), list) else []
                activity["maintenance_methods"] = list(dict.fromkeys(methods)) or ["non_replacement"]
                if activity["maintenance_methods"] == ["replacement"]:
                    activity["replacement_ratio"] = 1.0
                elif "replacement" not in activity["maintenance_methods"]:
                    activity["replacement_ratio"] = 0.0
                else:
                    activity["replacement_ratio"] = min(
                        1.0,
                        _non_negative_float(activity.get("replacement_ratio"), 0.0),
                    )
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

    def _activity_kind_matches(self, activity: dict[str, Any], kind: str) -> bool:
        text = f"{activity.get('id', '')} {activity.get('name', '')} {activity.get('activity_type', '')}".lower()
        if kind == "preflight":
            return "preflight" in text or "飞行前" in text or "直接准备" in text
        if kind == "repair":
            return "corrective" in text or "repair" in text or "修复性维修" in text or "故障修复" in text
        if kind == "postflight":
            return "postflight" in text or "飞行后" in text or "航后" in text
        if kind == "preventive":
            return "preventive" in text or "预防" in text or "定检" in text
        return False

    def _select_activity(
        self,
        kind: str,
        *,
        aircraft: AircraftState | None = None,
        component: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        candidates = [activity for activity in self.activities if self._activity_kind_matches(activity, kind)]
        if kind in {"repair", "preventive"} and candidates:
            candidates = self._maintenance_activity_candidates(candidates, aircraft=aircraft, component=component)
        if candidates:
            return candidates[0]
        if kind in {"repair", "postflight", "preventive"}:
            return self._default_activity(kind)
        return self.activities[0] if self.activities else self._default_activity(kind)

    def _maintenance_activity_candidates(
        self,
        candidates: list[dict[str, Any]],
        *,
        aircraft: AircraftState | None,
        component: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        component_ids = {
            str((component or {}).get(field) or "").strip().casefold()
            for field in ("id", "product_id")
        } - {""}
        aircraft_models = {
            str(value or "").strip().casefold()
            for value in (
                aircraft.aircraft_type if aircraft is not None else "",
                aircraft.model if aircraft is not None else "",
                (component or {}).get("aircraft_model"),
            )
        } - {""}
        ranked: list[tuple[int, int, dict[str, Any]]] = []
        for index, activity in enumerate(candidates):
            equipment_id = str(activity.get("equipment_id") or "").strip().casefold()
            activity_model = str(activity.get("aircraft_model") or "").strip().casefold()
            if not activity_model and equipment_id:
                scoped_component = self._component_by_id(equipment_id)
                activity_model = str((scoped_component or {}).get("aircraft_model") or "").strip().casefold()
            if component_ids and equipment_id and equipment_id not in component_ids:
                continue
            if aircraft_models and activity_model and activity_model not in aircraft_models:
                continue
            score = (4 if equipment_id and equipment_id in component_ids else 0) + (
                2 if activity_model and activity_model in aircraft_models else 0
            ) + (1 if not equipment_id and not activity_model else 0)
            ranked.append((-score, index, activity))
        return [activity for _, _, activity in sorted(ranked, key=lambda item: (item[0], item[1]))]

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
        basic_missions = self._basic_missions_by_id(profile)
        default_basic = next(iter(basic_missions.values()), {})
        missions: list[MissionState] = []
        periodic_contexts = self._periodic_contexts_by_composite(profile)
        mission_duration_adjustment = self.mission_context["duration_adjustment_minutes"]
        for composite in profile.get("composite_tasks") or []:
            composite_id = str(composite.get("id") or "")
            periodic_context = periodic_contexts.get(composite_id, {})
            for item in composite.get("taskItems") or []:
                if not isinstance(item, dict):
                    continue
                basic = self._basic_mission_for_item(item, basic_missions, default_basic)
                interval = max(1, int(round(_non_negative_float(item.get("intervalHours"), 24) * 60)))
                first_start = _time_to_minute(item.get("firstWaveTime"), int(basic.get("startHour") or 1) * 60)
                preflight_notice = self._preflight_notice_minutes(item, basic)
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
                                preparation_start=max(0, planned_start - preflight_notice),
                                duration_minutes=max(1, duration),
                                required_aircraft=max(1, int(item.get("equipmentQuantity") or basic.get("equipmentQuantity") or 1)),
                                min_required_aircraft=max(1, int(basic.get("minRequiredSorties") or basic.get("equipmentQuantity") or 1)),
                                priority=max(1, int(composite.get("priority") or 1)),
                                cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                                success_point=_success_point(basic.get("successPoint")),
                                task_category="periodic" if periodic_context else "composite",
                                periodic_task_id=str(periodic_context.get("id") or ""),
                                periodic_task_name=str(periodic_context.get("name") or ""),
                                composite_task_id=composite_id,
                                composite_task_name=str(composite.get("name") or composite_id),
                                basic_task_id=str(item.get("basicMissionId") or basic.get("id") or item.get("id") or ""),
                                basic_task_name=str(item.get("basicTaskName") or basic.get("name") or ""),
                                required_aircraft_type=str(item.get("equipmentType") or basic.get("equipmentType") or ""),
                                group_name=str(item.get("groupName") or ""),
                                wave_index=wave_index,
                                day_index=day_index,
                            )
                        )
        if not missions:
            basic = default_basic
            planned_start = max(0, int(basic.get("startHour") or 1) * 60)
            preflight_notice = self._preflight_notice_minutes({}, basic)
            missions.append(
                MissionState(
                    mission_id=str(basic.get("missionId") or "mission-1"),
                    name=str(basic.get("name") or "mission"),
                    planned_start=planned_start,
                    preparation_start=max(0, planned_start - preflight_notice),
                    duration_minutes=max(1, int(basic.get("taskDurationMinutes") or 120)),
                    required_aircraft=max(1, int(basic.get("equipmentQuantity") or 1)),
                    min_required_aircraft=max(1, int(basic.get("minRequiredSorties") or basic.get("equipmentQuantity") or 1)),
                    priority=1,
                    cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                    success_point=_success_point(basic.get("successPoint")),
                    task_category="basic",
                    basic_task_id=str(basic.get("id") or basic.get("missionId") or ""),
                    basic_task_name=str(basic.get("name") or "mission"),
                    required_aircraft_type=str(basic.get("equipmentType") or ""),
                    day_index=planned_start // 1440 + 1,
                )
            )
        return sorted(missions, key=lambda item: (item.planned_start, item.priority))

    def _preflight_notice_minutes(self, item: dict[str, Any], basic: dict[str, Any]) -> int:
        for source in (item, basic):
            if "advanceNoticeMinutes" not in source:
                continue
            value = source.get("advanceNoticeMinutes")
            if value not in (None, ""):
                return max(0, int(value))
        return max(0, int(item.get("preparationMinutes") or basic.get("preparationMinutes") or 0))

    def _basic_missions_by_id(self, profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
        records = profile.get("basic_missions") if isinstance(profile.get("basic_missions"), list) else []
        result: dict[str, dict[str, Any]] = {}
        for index, mission in enumerate(records):
            if not isinstance(mission, dict):
                continue
            mission_id = str(mission.get("id") or mission.get("missionId") or mission.get("taskNo") or f"basic-{index + 1}")
            result[mission_id] = mission
            for alias in (mission.get("name"), mission.get("basicTaskName"), mission.get("missionId"), mission.get("taskNo")):
                alias_text = str(alias or "").strip()
                if alias_text:
                    result.setdefault(alias_text, mission)
        return result

    def _basic_mission_for_item(
        self,
        item: dict[str, Any],
        basic_missions: dict[str, dict[str, Any]],
        default_basic: dict[str, Any],
    ) -> dict[str, Any]:
        for value in (item.get("basicMissionId"), item.get("basicTaskName")):
            key = str(value or "").strip()
            if key and key in basic_missions:
                return basic_missions[key]
        return default_basic

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
            composite_days = _periodic_explicit_composite_days(periodic, total_days, period_days)
            if not composite_days:
                composite_days = _periodic_weekday_assignment_days(periodic, total_days, period_days)
            if not composite_days:
                composite_days = {
                    str(item): set(range(total_days))
                    for item in periodic.get("compositeTaskIds") or []
                    if item
                }
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
        phases = [item for item in profile.get("mission_phases") or [] if isinstance(item, dict)]
        distance_km = 0.0
        if airports:
            distance_km += max(_non_negative_float(item.get("distanceToMissionKm"), 0.0) for item in airports)
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
                {
                    "product_id": shipment.spare_type,
                    "quantity": shipment.quantity,
                    "source_resource_id": shipment.source_node_id,
                    "resource_id": shipment.destination_node_id,
                },
            )

    def _process_mission_returns(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.state == "flying" and aircraft.return_time is not None and aircraft.return_time <= self.minute:
                self._return_aircraft_from_mission(aircraft, early_return=False)

    def _return_aircraft_from_mission(self, aircraft: AircraftState, *, early_return: bool) -> None:
        mission = self._mission_by_id(aircraft.current_mission_id)
        if mission is not None and aircraft.tail_number not in mission.failed_tail_numbers and aircraft.in_flight_failure:
            mission.failed_tail_numbers.append(aircraft.tail_number)
        return_minute = self.minute if early_return else aircraft.return_time
        end_minute = return_minute if return_minute is not None else self.minute
        start_minute = 0
        if mission is not None:
            start_minute = mission.actual_start if mission.actual_start is not None else mission.planned_start
        aircraft.flight_hours += max(0.0, float((end_minute - start_minute) / 60.0))
        aircraft.landing_count += 1
        if aircraft.in_flight_failure:
            aircraft.state = "maintenance"
            self.failed_sorties += 1
            component = self._component_by_id(aircraft.failed_component_id)
            repair_activity = self._select_activity("repair", aircraft=aircraft, component=component)
            self._create_job(
                aircraft,
                repair_activity,
                kind="repair",
                mission_id=mission.mission_id if mission is not None else aircraft.current_mission_id,
                component=component,
            )
            self._event(
                "mission_failed_returned" if early_return else "mission_failed_after_return",
                f"{aircraft.tail_number} {'early returned' if early_return else 'returned'} with propagated aircraft failure",
            )
            if mission is not None:
                self._update_mission_failure_status(mission)
        elif aircraft.component_failure_minutes:
            aircraft.state = "maintenance"
            component = self._component_by_id(self._first_failed_component_id(aircraft))
            repair_activity = self._select_activity("repair", aircraft=aircraft, component=component)
            self._create_job(
                aircraft,
                repair_activity,
                kind="repair",
                mission_id=mission.mission_id if mission is not None else aircraft.current_mission_id,
                component=component,
            )
            self._event("mission_returned_with_component_failure", f"{aircraft.tail_number} returned with component failure and needs repair")
        else:
            aircraft.state = "post_support"
            aircraft.postflight_required = True
            self._create_job(
                aircraft,
                self.postflight_activity,
                kind="postflight",
                mission_id=mission.mission_id if mission is not None else aircraft.current_mission_id,
            )
            self._event("mission_returned", f"{aircraft.tail_number} returned from mission and needs postflight")
        aircraft.current_mission_id = None
        aircraft.return_time = None
        if mission is not None and not aircraft.in_flight_failure:
            self._update_mission_completion_status(mission)

    def _update_mission_failure_status(self, mission: MissionState) -> None:
        effective_aircraft = len(set(mission.assigned_tail_numbers) - set(mission.failed_tail_numbers))
        if effective_aircraft < mission.min_required_aircraft and mission.status not in {"failed", "cancelled"}:
            mission.status = "failed"
            mission.return_time = self.minute
            self._event("mission_failed_minimum_aircraft", f"{mission.mission_id} failed below required aircraft count")

    def _update_mission_completion_status(self, mission: MissionState) -> None:
        if mission.status != "launched":
            return
        active_tails = {
            aircraft.tail_number
            for aircraft in self.aircraft
            if aircraft.current_mission_id == mission.mission_id and aircraft.state == "flying"
        }
        if not active_tails:
            mission.status = "completed"

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
                self._event(
                    "personnel_delay",
                    f"{job.job_id} waiting for personnel at {node['id']}",
                    {
                        "job_id": job.job_id,
                        "resource_id": node["id"],
                        "required_personnel": personnel,
                        "available_personnel": max(0, node["personnel_capacity"] - node["personnel_in_use"]),
                    },
                )
                continue
            if node["equipment_in_use"] + equipment > node["equipment_capacity"]:
                self.resource_delay_events += 1
                self.equipment_shortage_events += 1
                job.shortage_reason = "equipment_capacity"
                self._event(
                    "equipment_shortage",
                    f"{job.job_id} waiting for equipment at {node['id']}",
                    {
                        "job_id": job.job_id,
                        "resource_id": node["id"],
                        "required_equipment": equipment,
                        "available_equipment": max(0, node["equipment_capacity"] - node["equipment_in_use"]),
                    },
                )
                continue
            spare_requirements = self._task_spare_requirements(job, task)
            for spare_type, spare_qty in spare_requirements:
                if node["inventory"].get(spare_type, 0) < spare_qty and not self._has_in_transit_spare(node["id"], spare_type):
                    self._try_transport_replenishment(node, spare_type, spare_qty)
            shortages = [
                (
                    spare_type,
                    spare_qty,
                    int(node["inventory"].get(spare_type, 0) or 0),
                    (
                        "in_transit"
                        if self._has_in_transit_spare(node["id"], spare_type)
                        else f"spare:{spare_type}"
                    ),
                )
                for spare_type, spare_qty in spare_requirements
                if node["inventory"].get(spare_type, 0) < spare_qty
            ]
            if shortages:
                job.shortage_reason = shortages[0][3]
                shortage_signature = tuple(shortages)
                if job.spare_shortage_signature == shortage_signature:
                    continue
                job.spare_shortage_signature = shortage_signature
                aircraft = self._aircraft_by_tail(job.tail_number)
                for spare_type, spare_qty, available_quantity, reason in shortages:
                    self.shortage_events += 1
                    display_name = self._product_display_name(spare_type)
                    self._event(
                        "spare_shortage",
                        f"{job.job_id} blocked by {display_name} shortage at {node['id']}",
                        {
                            "job_id": job.job_id,
                            "aircraft_model": aircraft.aircraft_type if aircraft is not None else "全部机型",
                            "resource_id": node["id"],
                            "product_id": spare_type,
                            "spare_type": display_name,
                            "required_quantity": spare_qty,
                            "available_quantity": available_quantity,
                            "reason": reason,
                        },
                    )
                continue
            job.spare_shortage_signature = None
            if not self._consume_task_spare(job, task):
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
            if aircraft.in_flight_failure:
                continue
            for component in self.components:
                component_id = str(component.get("id") or "component")
                if component_id in aircraft.component_failure_minutes:
                    continue
                remaining = aircraft.lru_failure_remaining_minutes.get(component_id)
                if remaining is None:
                    remaining = self._sample_lru_failure_minutes(component)
                remaining -= self.tick_minutes
                aircraft.lru_failure_remaining_minutes[component_id] = remaining
                if remaining <= 0:
                    aircraft.component_failure_minutes[component_id] = self.minute
                    self.lru_failures += 1
                    self._event("component_failed", f"{aircraft.tail_number} failed {component.get('name') or component.get('id')}")
                    if self._aircraft_failure_tree_root_failed(aircraft):
                        aircraft.failed_component_id = component_id
                        aircraft.failed_component_minute = self.minute
                        self.failure_delay_events += 1
                        aircraft.in_flight_failure = True
                        self.in_flight_failures += 1
                        self._event("aircraft_failed", f"{aircraft.tail_number} failure propagated to whole aircraft")
                        self._return_aircraft_from_mission(aircraft, early_return=True)
                        break

    def _generate_preventive_jobs(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.state != "available" or aircraft.preventive_due:
                continue
            if any(job.kind == "preventive" and job.tail_number == aircraft.tail_number and job.state != "completed" for job in self.jobs):
                continue
            activity = self._select_activity("preventive", aircraft=aircraft)
            interval_days = self._preventive_interval_days(activity)
            interval_hours = self._preventive_interval_hours(activity)
            interval_landings = self._preventive_interval_landings(activity)
            if interval_days <= 0 and interval_hours <= 0 and interval_landings <= 0:
                continue
            due_by_day = interval_days > 0 and self.minute - aircraft.last_preventive_minute >= interval_days * 1440
            due_by_hours = interval_hours > 0 and aircraft.flight_hours >= interval_hours
            due_by_landings = interval_landings > 0 and aircraft.landing_count >= interval_landings
            if due_by_day or due_by_hours or due_by_landings:
                aircraft.state = "maintenance"
                aircraft.preventive_due = True
                self.preventive_maintenance_events += 1
                self._create_job(aircraft, activity, kind="preventive")
                self._event("preventive_created", f"{aircraft.tail_number} preventive maintenance created")

    def _preventive_interval_days(self, activity: dict[str, Any] | None = None) -> int:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        value = (
            activity.get("calendarDayInterval")
            or activity.get("calendar_day_interval")
            or activity.get("intervalDays")
        )
        return _positive_int(value, 0)

    def _preventive_interval_hours(self, activity: dict[str, Any] | None = None) -> int:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        value = activity.get("runHourInterval") or activity.get("run_hour_interval")
        return _positive_int(value, 0)

    def _preventive_interval_landings(self, activity: dict[str, Any] | None = None) -> int:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        value = activity.get("takeoffLandingInterval") or activity.get("takeoff_landing_interval")
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
                aircraft.state = "pre_support"
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

    def _evaluate_mission_success_points(self) -> None:
        """Lock each task wave's outcome at its task-success checkpoint.

        The checkpoint is part of the task timeline, not the postflight process.
        Members that have already returned normally at a 100% checkpoint count as
        available; members that suffered an in-flight failure do not.
        """
        for mission in self.missions:
            if mission.success_evaluated or mission.success_minute > self.minute:
                continue
            failed_members = set(mission.failed_tail_numbers)
            mission.success_member_count = sum(
                1 for tail_number in mission.assigned_tail_numbers if tail_number not in failed_members
            )
            mission.success_at_minute = self.minute
            mission.success_evaluated = True
            mission.succeeded = mission.success_member_count >= mission.min_required_aircraft
            outcome = "succeeded" if mission.succeeded else "failed"
            self._event(
                f"mission_success_point_{outcome}",
                (
                    f"{mission.mission_id} {outcome} at success point with "
                    f"{mission.success_member_count}/{mission.min_required_aircraft} available members"
                ),
            )

    def _finalize_unresolved_mission_successes(self) -> None:
        """Fail waves that entered the executed time window without reaching success."""
        for mission in self.missions:
            if mission.success_evaluated or mission.planned_start > self.minute:
                continue
            mission.success_evaluated = True
            mission.success_member_count = 0
            mission.success_at_minute = self.minute
            mission.succeeded = False
            self._event(
                "mission_success_point_failed",
                f"{mission.mission_id} did not reach its success point in the simulation window",
            )

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
        job_id = f"job-{self._job_sequence:04d}"
        tasks = copy.deepcopy(activity.get("jobs") or [{"activityCode": kind, "durationMinutes": 30}])
        for task in tasks:
            task.setdefault("durationMinutes", activity.get("duration_minutes") or 30)
            task.setdefault("requiredPersonnel", activity.get("required_personnel") or 1)
            task.setdefault("requiredDevices", activity.get("required_devices") or 1)
        maintenance_method = None
        replacement_ratio = None
        decision_roll = None
        rng_stream = None
        maintenance_occurrence = None
        if kind in {"repair", "preventive"}:
            (
                maintenance_method,
                replacement_ratio,
                decision_roll,
                rng_stream,
                maintenance_occurrence,
            ) = self._maintenance_method_for_event(
                activity=activity,
                kind=kind,
            )
        if kind == "repair" and component is not None:
            if component.get("repair_duration_minutes"):
                tasks[-1]["durationMinutes"] = max(1, int(component["repair_duration_minutes"]))
            has_explicit_spares = any(self._task_has_explicit_spare_requirement(task) for task in tasks)
            if (
                maintenance_method == "replacement"
                and not has_explicit_spares
                and str(component.get("product_type") or "").strip().upper() == "LRU"
            ):
                product_id = str(component.get("product_id") or "").strip()
                if product_id:
                    tasks[-1]["spare"] = f"{product_id},1"
        job = JobState(
            job_id=job_id,
            tail_number=aircraft.tail_number,
            kind=kind,
            activity_id=str(activity.get("id") or kind),
            activity_name=str(activity.get("name") or activity.get("activity_name") or kind),
            tasks=tasks,
            priority=max(1, int(activity.get("priority") or 1)),
            resource_node_id=str(activity.get("resource_id") or self._default_resource_node_id(aircraft)),
            mission_id=mission_id,
            component_id=str(component.get("id")) if component else None,
            maintenance_method=maintenance_method,
            replacement_ratio=replacement_ratio,
            maintenance_decision_roll=decision_roll,
            maintenance_rng_stream=rng_stream,
            maintenance_occurrence=maintenance_occurrence,
        )
        self.jobs.append(job)
        if maintenance_method is not None:
            self._event(
                "maintenance_method_selected",
                f"{job_id} selected {maintenance_method}",
                {
                    "job_id": job_id,
                    "tail_number": aircraft.tail_number,
                    "aircraft_model": aircraft.model or aircraft.aircraft_type,
                    "activity_id": job.activity_id,
                    "component_id": job.component_id,
                    "maintenance_kind": kind,
                    "maintenance_method": maintenance_method,
                    "replacement_ratio": replacement_ratio,
                    "decision_roll": decision_roll,
                    "rng_stream": rng_stream,
                    "maintenance_occurrence": maintenance_occurrence,
                },
            )

    def _maintenance_method_for_event(
        self,
        *,
        activity: dict[str, Any],
        kind: str,
    ) -> tuple[str, float, float, str, int]:
        methods = [
            str(value)
            for value in activity.get("maintenance_methods", [])
            if str(value) in {"non_replacement", "replacement"}
        ] if isinstance(activity.get("maintenance_methods"), list) else []
        methods = list(dict.fromkeys(methods)) or ["non_replacement"]
        ratio = min(1.0, _non_negative_float(activity.get("replacement_ratio"), 0.0))
        if methods == ["replacement"]:
            ratio = 1.0
        elif "replacement" not in methods:
            ratio = 0.0
        self._maintenance_occurrence_by_kind[kind] = self._maintenance_occurrence_by_kind.get(kind, 0) + 1
        occurrence = self._maintenance_occurrence_by_kind[kind]
        stream_key = f"{self.seed}|maintenance-method|{kind}|{occurrence}"
        digest = hashlib.sha256(stream_key.encode("utf-8")).digest()
        stream_seed = int.from_bytes(digest[:16], "big")
        decision_roll = random.Random(stream_seed).random()
        method = "replacement" if "replacement" in methods and decision_roll < ratio else "non_replacement"
        return method, ratio, decision_roll, digest.hex()[:16], occurrence

    def _default_resource_node_id(self, aircraft: AircraftState) -> str:
        """Choose the aircraft's explicitly associated support node before list-order fallback."""
        aircraft_scope = {value.strip().casefold() for value in (aircraft.airport, aircraft.airport_id) if value and value.strip()}
        if aircraft_scope:
            for node_id, node in self.nodes.items():
                node_scope = {
                    str(node.get("airport") or "").strip().casefold(),
                    str(node.get("airport_id") or "").strip().casefold(),
                }
                if aircraft_scope & (node_scope - {""}):
                    return node_id
        return next(iter(self.nodes))

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

    def _raw_task_spare_requirements(self, task: dict[str, Any]) -> list[tuple[str, int]]:
        spare = task.get("spare")
        requirements: list[tuple[str, int]] = []
        if isinstance(spare, list):
            for item in spare:
                if not isinstance(item, dict):
                    continue
                spare_type = str(item.get("productId") or item.get("product_id") or item.get("name") or item.get("model") or "").strip()
                if _is_no_spare_value(spare_type):
                    continue
                quantity = _non_negative_int(item.get("quantity"), 1)
                if spare_type and quantity > 0:
                    requirements.append((self._product_id_for_label(spare_type), quantity))
        if isinstance(spare, str) and spare and not _is_no_spare_value(spare):
            parts = [part.strip() for part in spare.split(",") if part.strip()]
            if parts:
                quantity = 1
                for part in reversed(parts):
                    if part.isdigit():
                        quantity = max(0, int(part))
                        break
                if quantity > 0:
                    requirements.append((self._product_id_for_label(parts[0]), quantity))
        return requirements

    def _task_has_explicit_spare_requirement(self, task: dict[str, Any]) -> bool:
        if self._raw_task_spare_requirements(task):
            return True
        spare = task.get("spare")
        if isinstance(spare, list):
            return any(
                isinstance(item, dict)
                and str(item.get("productId") or item.get("product_id") or item.get("name") or item.get("model") or "").strip()
                and _non_negative_int(item.get("quantity"), 1) == 0
                for item in spare
            )
        if isinstance(spare, str) and spare and not _is_no_spare_value(spare):
            parts = [part.strip() for part in spare.split(",") if part.strip()]
            return bool(parts and parts[-1].isdigit() and int(parts[-1]) == 0)
        return False

    def _task_spare_requirements(self, job: JobState, task: dict[str, Any]) -> list[tuple[str, int]]:
        if job.kind in {"repair", "preventive"} and job.maintenance_method == "non_replacement":
            return []
        quantities: dict[str, int] = {}
        for spare_type, quantity in self._raw_task_spare_requirements(task):
            quantities[spare_type] = quantities.get(spare_type, 0) + quantity
        return list(quantities.items())

    def _task_spare_requirement(self, job: JobState, task: dict[str, Any]) -> tuple[str | None, int]:
        requirements = self._task_spare_requirements(job, task)
        return requirements[0] if requirements else (None, 0)

    def _shortage_spare_requirement(self, job: JobState, task: dict[str, Any]) -> tuple[str | None, int]:
        requirements = self._task_spare_requirements(job, task)
        shortage_type = str(job.shortage_reason or "").split(":", 1)[1] if ":" in str(job.shortage_reason or "") else ""
        if shortage_type:
            for spare_type, quantity in requirements:
                if spare_type == shortage_type:
                    return spare_type, quantity
        return requirements[0] if requirements else (None, 0)

    def _product_id_for_label(self, label: str) -> str:
        value = str(label or "").strip()
        if not value:
            return ""
        if any(value in node["inventory"] for node in self.nodes.values()):
            return value
        for component in self.equipment_tree_components:
            if value in {
                str(component.get("product_id") or ""),
                str(component.get("product_name") or ""),
            }:
                return str(component.get("product_id") or value)
        for node in self.nodes.values():
            for product_id, name in (node.get("product_names") or {}).items():
                if value in {str(product_id), str(name)}:
                    return str(product_id)
        return value

    def _consume_task_spare(self, job: JobState, task: dict[str, Any]) -> bool:
        if job.task_index in job.consumed_spare_task_indexes:
            return True
        requirements = self._task_spare_requirements(job, task)
        if not requirements:
            return True
        node = self.nodes.get(job.resource_node_id) or next(iter(self.nodes.values()))
        if any(node["inventory"].get(spare_type, 0) < spare_quantity for spare_type, spare_quantity in requirements):
            return False
        job.consumed_spare_task_indexes.add(job.task_index)
        for spare_type, spare_quantity in requirements:
            current = node["inventory"].get(spare_type, 0)
            node["inventory"][spare_type] = current - spare_quantity
            self.spare_consumed_total += spare_quantity
            aircraft = self._aircraft_by_tail(job.tail_number)
            display_name = self._product_display_name(spare_type)
            self._event(
                "spare_consumed",
                f"{job.job_id} consumed {spare_quantity} {display_name}",
                {
                    "job_id": job.job_id,
                    "aircraft_model": aircraft.aircraft_type if aircraft is not None else "全部机型",
                    "resource_id": node["id"],
                    "product_id": spare_type,
                    "spare_type": display_name,
                    "quantity": spare_quantity,
                    "maintenance_method": job.maintenance_method,
                },
            )
        return True

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
                    {
                        "product_id": spare_type,
                        "quantity": moved,
                        "source_resource_id": source["id"],
                        "resource_id": node["id"],
                        "arrival_minute": self.minute + transport_minutes,
                    },
                )
                return
            node["inventory"][spare_type] = int(node["inventory"].get(spare_type, 0)) + moved
            self._event(
                "transport_replenished",
                f"{moved} {spare_type} moved from {source['id']} to {node['id']}",
                {
                    "product_id": spare_type,
                    "quantity": moved,
                    "source_resource_id": source["id"],
                    "resource_id": node["id"],
                },
            )
            return

    def _product_display_name(self, product_id: str) -> str:
        key = str(product_id or "")
        for component in self.equipment_tree_components:
            if str(component.get("product_id") or "") == key:
                return str(component.get("product_name") or key)
        for node in self.nodes.values():
            name = (node.get("product_names") or {}).get(key)
            if name:
                return str(name)
        return key

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
            aircraft.failed_component_minute = None
            aircraft.component_failure_minutes = {}
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
        component = next(
            (item for item in self.components if str(item.get("id")) == str(component_id)),
            None,
        )
        if component is not None:
            return component
        return next(
            (
                item
                for item in self.equipment_tree_components
                if str(item.get("id")) == str(component_id)
            ),
            None,
        )

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
            "failed_lru": item.failed_component_id or self._first_failed_component_id(item) or "",
            "flight_hours": item.flight_hours,
            "takeoff_count": item.takeoff_count,
            "landing_count": item.landing_count,
            "postflight_required": item.postflight_required,
            "preventive_due": item.preventive_due,
            "in_flight_failure": item.in_flight_failure,
            "failure_tree": self._aircraft_failure_tree_payload(item),
        }

    def _aircraft_failure_tree_payload(self, item: AircraftState) -> dict[str, Any]:
        component_nodes = [
            copy.deepcopy(component)
            for component in self.equipment_tree_components
            if self._component_applies_to_aircraft(component, item)
        ]
        if not component_nodes:
            component_nodes = [copy.deepcopy(component) for component in self.equipment_tree_components]
        equipment_root_id = self._equipment_tree_root_id(component_nodes)
        node_ids = {str(component.get("id")) for component in component_nodes}
        direct_failed = {str(component_id) for component_id in item.component_failure_minutes}
        for failed_id in sorted(direct_failed - node_ids):
            failed_component = self._component_by_id(failed_id)
            if failed_component is None:
                continue
            component_nodes.append(
                {
                    "id": failed_id,
                    "name": str(failed_component.get("name") or failed_id),
                    "parent_id": str(failed_component.get("parent_id") or equipment_root_id),
                    "aircraft_model": item.aircraft_type,
                    "product_type": str(failed_component.get("product_type") or "LRU"),
                    "quantity": max(1, int(failed_component.get("quantity") or 1)),
                    "k_out_of_n": failed_component.get("k_out_of_n") if isinstance(failed_component.get("k_out_of_n"), dict) else {},
                }
            )
            node_ids.add(failed_id)
        whole_aircraft_root_id = self._whole_aircraft_root_id(node_ids | {equipment_root_id})
        if equipment_root_id not in node_ids:
            component_nodes.append(
                {
                    "id": equipment_root_id,
                    "name": f"{item.aircraft_type} 装备构型",
                    "parent_id": whole_aircraft_root_id,
                    "aircraft_model": item.aircraft_type,
                    "product_type": "装备构型",
                    "quantity": 1,
                    "k_out_of_n": {},
                }
            )
            node_ids.add(equipment_root_id)
        for component in component_nodes:
            if str(component.get("id")) == equipment_root_id:
                component["parent_id"] = whole_aircraft_root_id
        root_node = {
            "id": whole_aircraft_root_id,
            "name": f"{item.tail_number} 整机",
            "parent_id": "",
            "aircraft_model": item.aircraft_type,
            "product_type": "整机",
            "quantity": 1,
            "k_out_of_n": {},
        }
        nodes = [root_node, *component_nodes]
        node_map = {str(node.get("id")): node for node in nodes}
        children_by_parent: dict[str, list[str]] = {str(node.get("id")): [] for node in nodes}
        for node in nodes:
            node_id = str(node.get("id"))
            parent_id = str(node.get("parent_id") or "")
            if parent_id and parent_id in node_map and node_id != whole_aircraft_root_id:
                children_by_parent.setdefault(parent_id, []).append(node_id)
        failure_time_by_id: dict[str, int] = {}
        for failed_id, failure_minute in item.component_failure_minutes.items():
            failure_time_by_id[str(failed_id)] = int(failure_minute)
        failed_ids = set(direct_failed)
        propagated_ids: set[str] = set()
        changed = True
        while changed:
            changed = False
            for node_id in sorted(node_map.keys(), key=lambda value: self._failure_tree_depth(value, node_map), reverse=True):
                if node_id in failed_ids:
                    continue
                failed_children = [child_id for child_id in children_by_parent.get(node_id, []) if child_id in failed_ids]
                threshold = self._failure_threshold(node_map[node_id])
                if failed_children and len(failed_children) >= threshold:
                    failed_ids.add(node_id)
                    propagated_ids.add(node_id)
                    failure_time_by_id[node_id] = min(failure_time_by_id.get(child_id, self.minute) for child_id in failed_children)
                    changed = True
        payload_nodes = []
        for node in nodes:
            node_id = str(node.get("id"))
            if node_id == equipment_root_id:
                continue
            failed_children = [child_id for child_id in children_by_parent.get(node_id, []) if child_id in failed_ids]
            threshold = self._failure_threshold(node)
            parent_id = str(node.get("parent_id") or "")
            if parent_id == equipment_root_id:
                parent_id = whole_aircraft_root_id
            payload_nodes.append(
                {
                    "id": node_id,
                    "name": str(node.get("name") or node_id),
                    "parent_id": parent_id,
                    "product_type": str(node.get("product_type") or ""),
                    "quantity": max(1, int(node.get("quantity") or 1)),
                    "k_out_of_n": copy.deepcopy(node.get("k_out_of_n") if isinstance(node.get("k_out_of_n"), dict) else {}),
                    "failure_threshold": threshold,
                    "failed_children": len(failed_children),
                    "failed": node_id in failed_ids,
                    "direct_failed": node_id in direct_failed,
                    "propagated_failed": node_id in propagated_ids,
                    "failure_time": failure_time_by_id.get(node_id),
                }
            )
        return {
            "tail_number": item.tail_number,
            "aircraft_type": item.aircraft_type,
            "root_id": whole_aircraft_root_id,
            "equipment_root_id": equipment_root_id,
            "nodes": payload_nodes,
            "edges": [
                {
                    "from": str(node.get("parent_id") or ""),
                    "to": str(node.get("id")),
                    "active": str(node.get("id")) in failed_ids and str(node.get("parent_id") or "") in failed_ids,
                }
                for node in payload_nodes
                if node.get("parent_id")
            ],
        }

    def _aircraft_failure_tree_root_failed(self, item: AircraftState) -> bool:
        tree = self._aircraft_failure_tree_payload(item)
        root_id = str(tree.get("root_id") or "")
        return any(str(node.get("id")) == root_id and node.get("failed") for node in tree.get("nodes", []))

    def _first_failed_component_id(self, item: AircraftState) -> str | None:
        if not item.component_failure_minutes:
            return None
        return min(item.component_failure_minutes.items(), key=lambda pair: pair[1])[0]

    def _equipment_tree_root_id(self, component_nodes: list[dict[str, Any]]) -> str:
        configured_root = self.inputs.get("equipment_tree", {}).get("root_component_id")
        if configured_root:
            return str(configured_root)
        parent_ids = {str(node.get("parent_id")) for node in component_nodes if node.get("parent_id") not in (None, "")}
        for candidate in ("aircraft-root", "aircraft"):
            if candidate in parent_ids:
                return candidate
        return sorted(parent_ids)[0] if parent_ids else "aircraft-root"

    def _whole_aircraft_root_id(self, component_node_ids: set[str]) -> str:
        root_id = "whole-aircraft-root"
        if root_id not in component_node_ids:
            return root_id
        index = 1
        while f"{root_id}-{index}" in component_node_ids:
            index += 1
        return f"{root_id}-{index}"

    def _component_applies_to_aircraft(self, component: dict[str, Any], item: AircraftState) -> bool:
        model = str(component.get("aircraft_model") or "")
        return not model or model in {item.aircraft_type, item.model}

    def _failure_threshold(self, component: dict[str, Any]) -> int:
        k_out = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
        if k_out.get("enabled"):
            return max(1, int(k_out.get("k") or 1))
        return 1

    def _failure_tree_depth(self, node_id: str, node_map: dict[str, dict[str, Any]]) -> int:
        depth = 0
        current = node_map.get(node_id)
        seen = {node_id}
        while current and current.get("parent_id") not in (None, ""):
            parent_id = str(current.get("parent_id"))
            if parent_id in seen:
                break
            seen.add(parent_id)
            depth += 1
            current = node_map.get(parent_id)
        return depth

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
                display_name = self._product_display_name(spare_type)
                payload.append(
                    {
                        "part_id": f"{node['id']}:{spare_type}",
                        "product_id": spare_type,
                        "name": display_name,
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
            "maintenance_method": job.maintenance_method,
            "replacement_ratio": job.replacement_ratio,
            "maintenance_decision_roll": job.maintenance_decision_roll,
            "maintenance_rng_stream": job.maintenance_rng_stream,
            "maintenance_occurrence": job.maintenance_occurrence,
        }

    def _events_for_frame(self) -> list[dict[str, Any]]:
        recent = [event for event in self.event_log if event["time"] >= max(0, self.minute - self.sample_every_minutes)]
        if not recent:
            recent = [{"time": self.minute, "event": "state_frame", "message": "state frame sampled"}]
        payload = []
        for event in recent[-10:]:
            payload.append(
                {
                    "time": float(event["time"]),
                    "event": str(event["event"]),
                    "event_type": str(event["event"]),
                    "message": str(event["message"]),
                    "metric_refs": self._metric_refs_for_event(str(event["event"])),
                }
            )
        return payload

    def _event(self, event: str, message: str, details: dict[str, Any] | None = None) -> None:
        item: dict[str, Any] = {"time": self.minute, "event": event, "message": message}
        if details:
            item["details"] = copy.deepcopy(details)
        if (
            self.write_event_snapshots
            and self._event_snapshot_count < self.event_snapshot_limit
            and self._should_write_event_snapshot(event)
        ):
            item["snapshot"] = self._event_snapshot(event, details or {})
            self._event_snapshot_count += 1
        self.event_log.append(item)

    def _should_write_event_snapshot(self, event: str) -> bool:
        normalized = event.lower()
        return any(token in normalized for token in ("fail", "shortage", "delay"))

    def _event_snapshot(self, event: str, details: dict[str, Any]) -> dict[str, Any]:
        metrics = self.snapshot()
        return {
            "schema_version": "aircraft-support-event-snapshot-v0",
            "event": event,
            "time": self.minute,
            "aircraft_state": {
                "summary": {
                    "ready_rate": metrics["ready_rate"],
                    "available_aircraft": metrics["available_aircraft"],
                    "failed_count": metrics["failed_count"],
                    "repairing_count": metrics["repairing_count"],
                    "flying_count": metrics["flying_count"],
                    "postflight_count": metrics["postflight_count"],
                    "preventive_count": metrics["preventive_count"],
                },
                "aircraft": [self._event_aircraft_snapshot_payload(item) for item in self.aircraft],
            },
            "support_resources": [self._event_resource_snapshot(node) for node in self.nodes.values()],
            "spare_shortages": self._event_spare_shortages(details),
            "active_jobs": [self._job_payload(job) for job in self.jobs if job.state != "completed"],
        }

    def _event_aircraft_snapshot_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "type": item.aircraft_type,
            "state": item.state,
            "current_mission_id": item.current_mission_id,
            "failed_lru": item.failed_component_id or self._first_failed_component_id(item) or "",
            "flight_hours": item.flight_hours,
            "takeoff_count": item.takeoff_count,
            "landing_count": item.landing_count,
            "postflight_required": item.postflight_required,
            "preventive_due": item.preventive_due,
            "in_flight_failure": item.in_flight_failure,
        }

    def _event_resource_snapshot(self, node: dict[str, Any]) -> dict[str, Any]:
        return {
            "resource_id": node["id"],
            "name": node["name"],
            "display_name": node.get("display_name") or node["name"],
            "personnel_in_use": node["personnel_in_use"],
            "personnel_capacity": node["personnel_capacity"],
            "equipment_in_use": node["equipment_in_use"],
            "equipment_capacity": node["equipment_capacity"],
            "work_count": node["work_count"],
            "inventory": copy.deepcopy(node["inventory"]),
        }

    def _event_spare_shortages(self, details: dict[str, Any]) -> list[dict[str, Any]]:
        shortages = []
        spare_type = str(details.get("spare_type") or "")
        if spare_type:
            shortages.append(
                {
                    "product_id": str(details.get("product_id") or ""),
                    "spare_type": spare_type,
                    "required_quantity": int(details.get("required_quantity", 0) or 0),
                    "available_quantity": int(details.get("available_quantity", 0) or 0),
                    "resource_id": str(details.get("resource_id") or ""),
                    "job_id": str(details.get("job_id") or ""),
                    "reason": str(details.get("reason") or "spare_shortage"),
                }
            )
        for job in self.jobs:
            if not job.shortage_reason or not str(job.shortage_reason).startswith("spare:"):
                continue
            node = self.nodes.get(job.resource_node_id)
            task = job.current_task or {}
            job_spare_type, job_spare_qty = self._task_spare_requirement(job, task)
            if not job_spare_type:
                continue
            shortages.append(
                {
                    "product_id": job_spare_type,
                    "spare_type": self._product_display_name(job_spare_type),
                    "required_quantity": job_spare_qty,
                    "available_quantity": int((node or {}).get("inventory", {}).get(job_spare_type, 0) or 0),
                    "resource_id": job.resource_node_id,
                    "job_id": job.job_id,
                    "reason": str(job.shortage_reason),
                }
            )
        seen: set[tuple[str, str, str]] = set()
        unique = []
        for shortage in shortages:
            key = (shortage["spare_type"], shortage["resource_id"], shortage["job_id"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(shortage)
        return unique

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


def _truthy_input_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _normalized_stop_policy(value: Any, duration_minutes: int) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    mode = "and" if str(source.get("mode") or "").strip().lower() == "and" else "or"
    raw_conditions = source.get("conditions") if isinstance(source.get("conditions"), list) else []
    defaulted = _truthy_input_flag(source.get("defaulted")) or not isinstance(value, dict) or not raw_conditions
    conditions = [
        condition
        for raw_condition in raw_conditions
        if (condition := _normalized_stop_condition(raw_condition, duration_minutes)) is not None
    ]
    if not conditions:
        conditions = [{"type": "duration", "duration_minutes": max(1, int(duration_minutes))}]
    return {
        "schema_version": str(source.get("schema_version") or source.get("schemaVersion") or "stop-policy-v0"),
        "mode": mode,
        "conditions": conditions,
        "defaulted": defaulted,
    }


def _normalized_stop_condition(value: Any, duration_minutes: int) -> dict[str, Any] | None:
    if isinstance(value, str):
        value = {"type": value}
    if not isinstance(value, dict):
        return None
    condition_type = _stop_condition_type(value.get("type"))
    if condition_type == "duration":
        duration = _positive_int(value.get("duration_minutes") or value.get("durationMinutes"), max(1, int(duration_minutes)))
        return {"type": "duration", "duration_minutes": duration}
    if condition_type == "failure":
        return {"type": "failure"}
    if condition_type == "specified_time":
        minute = _positive_int(
            value.get("minute")
            or value.get("timeMinute")
            or value.get("time_minute")
            or value.get("specifiedMinute")
            or value.get("specified_minute"),
            0,
        )
        if minute <= 0:
            return None
        return {"type": "specified_time", "minute": minute}
    return None


def _stop_condition_type(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", "_")
    compact = text.replace("_", "")
    if compact in {"duration", "taskduration", "reachtaskduration", "maxduration"}:
        return "duration"
    if compact in {"failure", "taskfailure", "missionfailure"}:
        return "failure"
    if compact in {"specifiedtime", "targettime", "time", "specifiedminute"}:
        return "specified_time"
    return ""


def _resource_quantity(text: Any, explicit: Any, *, default: int) -> int:
    if isinstance(explicit, (int, float)) and explicit > 0:
        return max(1, int(explicit))
    if isinstance(text, list):
        total = 0
        for item in text:
            if not isinstance(item, dict):
                continue
            try:
                quantity = int(float(item.get("quantity", 1)))
            except (TypeError, ValueError):
                quantity = 1
            total += max(0, quantity)
        if total > 0:
            return total
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


def _non_negative_int(value: Any, fallback: int) -> int:
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return fallback


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _is_no_spare_value(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return text in {"", "无", "none", "null", "n/a", "na", "-", "不需要", "无需"}


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


_WEEKDAY_INDEXES = {
    "monday": 0,
    "mondaycompositetaskid": 0,
    "mon": 0,
    "周一": 0,
    "星期一": 0,
    "tuesday": 1,
    "tuesdaycompositetaskid": 1,
    "tue": 1,
    "周二": 1,
    "星期二": 1,
    "wednesday": 2,
    "wednesdaycompositetaskid": 2,
    "wed": 2,
    "周三": 2,
    "星期三": 2,
    "thursday": 3,
    "thursdaycompositetaskid": 3,
    "thu": 3,
    "周四": 3,
    "星期四": 3,
    "friday": 4,
    "fridaycompositetaskid": 4,
    "fri": 4,
    "周五": 4,
    "星期五": 4,
    "saturday": 5,
    "saturdaycompositetaskid": 5,
    "sat": 5,
    "周六": 5,
    "星期六": 5,
    "sunday": 6,
    "sundaycompositetaskid": 6,
    "sun": 6,
    "周日": 6,
    "星期日": 6,
    "星期天": 6,
}

_WEEKDAY_ASSIGNMENT_FIELDS = (
    "mondayCompositeTaskId",
    "tuesdayCompositeTaskId",
    "wednesdayCompositeTaskId",
    "thursdayCompositeTaskId",
    "fridayCompositeTaskId",
    "saturdayCompositeTaskId",
    "sundayCompositeTaskId",
)


def _periodic_weekday_index(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    return _WEEKDAY_INDEXES.get(text.replace("_", "").replace("-", "").lower())


def _periodic_explicit_composite_days(
    periodic: dict[str, Any],
    total_days: int,
    period_days: int,
) -> dict[str, set[int]]:
    composite_days: dict[str, set[int]] = {}
    for item in periodic.get("compositeTasks") or []:
        if not isinstance(item, dict):
            continue
        composite_id = str(item.get("compositeTaskId") or "").strip()
        if not composite_id:
            continue
        weekday_index = _periodic_weekday_index(item.get("weekday") or item.get("dayOfWeek"))
        if weekday_index is not None:
            week_index = _positive_int(item.get("weekIndex", item.get("week")), 1)
            active_day = (week_index - 1) * period_days + weekday_index
            if 0 <= active_day < total_days:
                composite_days.setdefault(composite_id, set()).add(active_day)
            continue
        period_index = _positive_int(item.get("week", item.get("weekIndex")), 1)
        start_day = max(0, (period_index - 1) * period_days)
        active_days = set(range(start_day, min(total_days, start_day + period_days)))
        if active_days:
            composite_days.setdefault(composite_id, set()).update(active_days)
    return composite_days


def _periodic_weekday_assignment_days(
    periodic: dict[str, Any],
    total_days: int,
    period_days: int,
) -> dict[str, set[int]]:
    assignments: dict[int, str] = {}
    raw_assignments = periodic.get("weekdayAssignments") if isinstance(periodic.get("weekdayAssignments"), dict) else {}
    for key, composite_id in raw_assignments.items():
        weekday_index = _periodic_weekday_index(key)
        composite_text = str(composite_id or "").strip()
        if weekday_index is not None and composite_text:
            assignments[weekday_index] = composite_text
    for key in _WEEKDAY_ASSIGNMENT_FIELDS:
        weekday_index = _periodic_weekday_index(key)
        composite_text = str(periodic.get(key) or "").strip()
        if weekday_index is not None and composite_text:
            assignments[weekday_index] = composite_text

    composite_days: dict[str, set[int]] = {}
    for start_day in range(0, total_days, max(1, period_days)):
        for weekday_index, composite_id in assignments.items():
            active_day = start_day + weekday_index
            if active_day < total_days:
                composite_days.setdefault(composite_id, set()).add(active_day)
    return composite_days


def _bounded_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(0.0, parsed))


def _success_point(value: Any) -> float:
    """Normalize the Project's 0..1 task-success point; task end is the fallback."""
    normalized = _bounded_float(value)
    return normalized if normalized is not None else 1.0


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
