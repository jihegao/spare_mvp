"""MaintenanceEngine behavior for aircraft-support v1."""

from __future__ import annotations

import copy
import hashlib
import random
from typing import Any

from .runtime_utils import (
    _non_negative_float,
    _non_negative_int,
    _positive_float,
    _positive_int,
    _resource_quantity,
)
from .state import AircraftState, JobState


class MaintenanceEngineMixin:
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
            node = self.nodes.get(job.resource_node_id)
            if node is None:
                if self.canonical_organization_enabled:
                    job.shortage_reason = "organization_unknown_runtime_node"
                    self._event(
                        "organization_dispatch_failed",
                        f"{job.job_id} references unknown runtime support node",
                        {"job_id": job.job_id, "reason": "unknown_runtime_node", "resource_id": job.resource_node_id},
                    )
                    continue
                node = next(iter(self.nodes.values()))
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
            if not self.canonical_organization_enabled and node["personnel_in_use"] + personnel > node["personnel_capacity"]:
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
            if not self.canonical_organization_enabled and node["equipment_in_use"] + equipment > node["equipment_capacity"]:
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
            canonical_failure_reasons: dict[str, str] = {}
            if self.canonical_organization_enabled:
                canonical_failure_reasons = self._ensure_canonical_spare_dispatches(
                    job, node, spare_requirements
                )
            else:
                for spare_type, spare_qty in spare_requirements:
                    if node["inventory"].get(spare_type, 0) < spare_qty and not self._has_in_transit_spare(node["id"], spare_type):
                        self._try_transport_replenishment(node, spare_type, spare_qty)
            shortages = [
                (
                    spare_type,
                    spare_qty,
                    self._available_spare_for_job(job, node, spare_type),
                    (
                        "in_transit"
                        if (
                            self._has_in_transit_spare_for_job(job, spare_type)
                            if self.canonical_organization_enabled
                            else self._has_in_transit_spare(node["id"], spare_type)
                        )
                        else canonical_failure_reasons.get(spare_type, f"spare:{spare_type}")
                    ),
                )
                for spare_type, spare_qty in spare_requirements
                if self._available_spare_for_job(job, node, spare_type) < spare_qty
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
            if self.canonical_organization_enabled:
                if not self._ensure_canonical_job_resources(job, node, personnel, equipment):
                    continue
                if job.remote_resources_pending:
                    continue
            spare_supply_modes = {
                mode
                for spare_type, _ in spare_requirements
                for mode in job.spare_reservation_supply_modes.get((job.task_index, spare_type), set())
            }
            if self.canonical_organization_enabled and spare_requirements and spare_supply_modes <= {"local"}:
                for product_id, _quantity in spare_requirements:
                    self._event(
                        "organization_local_fulfilled",
                        f"{job.job_id} {product_id} fulfilled at {node['id']}",
                        {
                            "job_id": job.job_id,
                            "task_index": job.task_index,
                            "organization_node_id": node["organization_node_id"],
                            "resource_id": node["id"],
                            "product_id": product_id,
                            "supply_mode": "local",
                            "relation_id": "",
                        },
                    )
            if not self._consume_task_spare(job, task):
                continue
            if not self.canonical_organization_enabled:
                node["personnel_in_use"] += personnel
                node["equipment_in_use"] += equipment
            node["work_count"] += 1
            job.state = "running"
            job.remaining = max(1, int(task.get("durationMinutes") or task.get("duration_minutes") or activity.get("duration_minutes") or 30))
            job.started_time = job.started_time if job.started_time is not None else self.minute
            job.shortage_reason = None
            self._event("job_started", f"{job.job_id} started {task.get('workName') or task.get('activityCode') or 'task'}")

    def _generate_preventive_jobs(self) -> None:
        for aircraft in self.aircraft:
            if any(
                job.kind == "preventive"
                and job.tail_number == aircraft.tail_number
                and job.state in {"waiting", "running"}
                for job in self.jobs
            ):
                continue
            due_cycles = self._due_preventive_cycles(aircraft)
            if not due_cycles:
                continue
            activity_id, due_dimensions = due_cycles[0]
            minute_zero_due = self.minute == 0

            aircraft.preventive_due = True
            aircraft.preventive_due_dimensions = list(due_dimensions)
            # An aircraft already committed to a mission keeps that commitment.
            # Preventive work starts only after return and postflight processing
            # make the aircraft available again.
            if aircraft.state != "available" and not minute_zero_due:
                continue

            activity = self._activity_by_id(activity_id) or self._select_activity("preventive", aircraft=aircraft)
            aircraft.state = "maintenance"
            self.preventive_maintenance_events += 1
            self._create_job(
                aircraft,
                activity,
                kind="preventive",
                due_dimensions=due_dimensions,
            )
            self._event(
                "preventive_created",
                f"{aircraft.tail_number} preventive maintenance created",
                {
                    "tail_number": aircraft.tail_number,
                    "activity_id": str(activity.get("id") or "preventive"),
                    "initial_life_state": copy.deepcopy(aircraft.initial_life_state),
                    "preventive_thresholds": copy.deepcopy(aircraft.preventive_thresholds),
                    "preventive_threshold_sources": copy.deepcopy(aircraft.preventive_threshold_sources),
                    "preventive_cycle_id": activity_id,
                    "due_dimensions": list(due_dimensions),
                },
            )

    def _preventive_activity_for_due(
        self,
        aircraft: AircraftState,
        fallback: dict[str, Any],
        due_dimensions: list[str],
    ) -> dict[str, Any]:
        activity_ids = sorted({
            str(source.get("activity_id") or "")
            for dimension in due_dimensions
            for source in aircraft.preventive_threshold_sources.get(dimension, [])
            if isinstance(source, dict) and str(source.get("activity_id") or "")
        })
        for activity_id in activity_ids:
            activity = self._activity_by_id(activity_id)
            if activity:
                return activity
        return fallback

    def _initialize_preventive_lifecycle(self) -> None:
        for aircraft in self.aircraft:
            if not aircraft.initial_life_state:
                aircraft.initial_life_state = {
                    "calendar_days": 0,
                    "flight_hours": 0.0,
                    "takeoff_landing_cycles": 0,
                }
            activity = self._select_activity("preventive", aircraft=aircraft)
            if not aircraft.preventive_thresholds:
                aircraft.preventive_thresholds = self._preventive_thresholds(activity)
            if not aircraft.preventive_cycles:
                thresholds = aircraft.preventive_thresholds or self._preventive_thresholds(activity)
                if any(value > 0 for value in thresholds.values()):
                    activity_id = str(activity.get("id") or "preventive")
                    aircraft.preventive_cycles[activity_id] = {
                        "activity_id": activity_id,
                        "equipment_id": str(activity.get("equipment_id") or ""),
                        "thresholds": copy.deepcopy(thresholds),
                        "life_state": copy.deepcopy(aircraft.initial_life_state),
                        "last_preventive_minute": -int(aircraft.initial_life_state.get("calendar_days") or 0) * 1440,
                    }
            aircraft.initial_due_dimensions = self._preventive_due_dimensions(aircraft, activity)

    def _preventive_thresholds(self, activity: dict[str, Any]) -> dict[str, int | float]:
        return {
            "calendar_days": self._preventive_interval_days(activity),
            "flight_hours": self._preventive_interval_hours(activity),
            "takeoff_landing_cycles": self._preventive_interval_landings(activity),
        }

    def _preventive_due_dimensions(
        self,
        aircraft: AircraftState,
        activity: dict[str, Any],
    ) -> list[str]:
        due_cycles = self._due_preventive_cycles(aircraft)
        if due_cycles:
            return list(dict.fromkeys(
                dimension
                for _activity_id, dimensions in due_cycles
                for dimension in dimensions
            ))
        thresholds = aircraft.preventive_thresholds or self._preventive_thresholds(activity)
        due_dimensions = []
        calendar_days = int(thresholds["calendar_days"])
        calendar_due_minute = (
            (aircraft.last_preventive_minute // 1440) + calendar_days
        ) * 1440
        if calendar_days > 0 and self.minute >= calendar_due_minute:
            due_dimensions.append("calendar_days")
        if thresholds["flight_hours"] > 0 and aircraft.flight_hours >= thresholds["flight_hours"]:
            due_dimensions.append("flight_hours")
        if (
            thresholds["takeoff_landing_cycles"] > 0
            and aircraft.landing_count >= thresholds["takeoff_landing_cycles"]
        ):
            due_dimensions.append("takeoff_landing_cycles")
        return due_dimensions

    def _due_preventive_cycles(self, aircraft: AircraftState) -> list[tuple[str, list[str]]]:
        due_cycles: list[tuple[str, list[str]]] = []
        for activity_id, cycle in aircraft.preventive_cycles.items():
            thresholds = cycle.get("thresholds") if isinstance(cycle.get("thresholds"), dict) else {}
            life_state = cycle.get("life_state") if isinstance(cycle.get("life_state"), dict) else {}
            due_dimensions: list[str] = []
            calendar_days = _non_negative_int(thresholds.get("calendar_days"), 0)
            last_preventive_minute = int(cycle.get("last_preventive_minute") or 0)
            if calendar_days > 0 and self.minute >= last_preventive_minute + calendar_days * 1440:
                due_dimensions.append("calendar_days")
            flight_hours = _non_negative_float(thresholds.get("flight_hours"), 0.0)
            if flight_hours > 0 and _non_negative_float(life_state.get("flight_hours"), 0.0) >= flight_hours:
                due_dimensions.append("flight_hours")
            landing_cycles = _non_negative_int(thresholds.get("takeoff_landing_cycles"), 0)
            if landing_cycles > 0 and _non_negative_int(life_state.get("takeoff_landing_cycles"), 0) >= landing_cycles:
                due_dimensions.append("takeoff_landing_cycles")
            if due_dimensions:
                due_cycles.append((activity_id, due_dimensions))
        return due_cycles

    @staticmethod
    def _legacy_preventive_activity_id(aircraft: AircraftState) -> str:
        return next(iter(aircraft.preventive_cycles), "")

    def _record_preventive_usage(
        self,
        aircraft: AircraftState,
        *,
        flight_hours: float = 0.0,
        takeoffs: int = 0,
        landings: int = 0,
    ) -> None:
        for cycle in aircraft.preventive_cycles.values():
            life_state = cycle.setdefault("life_state", {})
            life_state["flight_hours"] = _non_negative_float(life_state.get("flight_hours"), 0.0) + flight_hours
            life_state["takeoff_landing_cycles"] = _non_negative_int(life_state.get("takeoff_landing_cycles"), 0) + landings

    def _preventive_interval_days(self, activity: dict[str, Any] | None = None) -> int:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        for field_name in ("calendarDayInterval", "calendar_day_interval", "intervalDays"):
            if field_name in activity:
                return _positive_int(activity.get(field_name), 0)
        return 0

    def _preventive_interval_hours(self, activity: dict[str, Any] | None = None) -> float:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        for field_name in ("runHourInterval", "run_hour_interval"):
            if field_name in activity:
                return _positive_float(activity.get(field_name), 0.0)
        return 0.0

    def _preventive_interval_landings(self, activity: dict[str, Any] | None = None) -> int:
        activity = activity if isinstance(activity, dict) else self.preventive_activity
        for field_name in ("takeoffLandingInterval", "takeoff_landing_interval"):
            if field_name in activity:
                return _positive_int(activity.get(field_name), 0)
        return 0

    def _create_job(
        self,
        aircraft: AircraftState,
        activity: dict[str, Any],
        *,
        kind: str,
        mission_id: str | None = None,
        component: dict[str, Any] | None = None,
        due_dimensions: list[str] | None = None,
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
            due_dimensions=list(due_dimensions or []),
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

    def _release_job_resources(self, job: JobState) -> None:
        task = job.current_task or {}
        if self.canonical_organization_enabled and job.resource_reservations:
            released: list[dict[str, Any]] = []
            for resource_kind, (supplier_node_id, quantity) in job.resource_reservations.items():
                supplier = self.nodes.get(supplier_node_id)
                if supplier is None:
                    continue
                in_use_key = f"{resource_kind}_in_use"
                supplier[in_use_key] = max(0, int(supplier[in_use_key]) - quantity)
                released.append(
                    {
                        "resource_kind": resource_kind,
                        "quantity": quantity,
                        "supplier_resource_id": supplier_node_id,
                    }
                )
            job.resource_reservations.clear()
            job.remote_resources_pending.clear()
            self._event(
                "organization_resources_released",
                f"released canonical resources for {job.job_id}",
                {"job_id": job.job_id, "task_index": job.task_index, "resources": released},
            )
            return
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

    def _complete_job_effect(self, job: JobState) -> None:
        aircraft = next((item for item in self.aircraft if item.tail_number == job.tail_number), None)
        if aircraft is None:
            return
        if job.kind == "preflight" and job.mission_id:
            aircraft.prepared_mission_ids.add(job.mission_id)
            aircraft.current_mission_id = job.mission_id
            aircraft.state = "mission_ready"
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
            aircraft.preventive_due_dimensions = []
            cycle = aircraft.preventive_cycles.get(job.activity_id)
            if cycle is not None:
                thresholds = cycle.get("thresholds") if isinstance(cycle.get("thresholds"), dict) else {}
                life_state = cycle.setdefault("life_state", {})
                for dimension in ("calendar_days", "flight_hours", "takeoff_landing_cycles"):
                    if _non_negative_float(thresholds.get(dimension), 0.0) > 0:
                        life_state[dimension] = 0.0 if dimension == "flight_hours" else 0
                cycle["last_preventive_minute"] = self.minute
            if job.activity_id == self._legacy_preventive_activity_id(aircraft):
                aircraft.last_preventive_minute = self.minute
                aircraft.flight_hours = 0.0
                aircraft.takeoff_count = 0
                aircraft.landing_count = 0
            self._event("preventive_completed", f"{aircraft.tail_number} preventive maintenance completed")


__all__ = ["MaintenanceEngineMixin"]
