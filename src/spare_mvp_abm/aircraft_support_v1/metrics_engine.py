"""MetricsEngine behavior for aircraft-support v1."""

from __future__ import annotations

import copy
from typing import Any

from .runtime_utils import _resource_quantity
from .state import AircraftState, JobState


class MetricsEngineMixin:
    def snapshot(self) -> dict[str, Any]:
        downtime_summary = self._downtime_event_summary()
        planned_sorties = sum(mission.required_aircraft for mission in self.missions) or 1
        unassigned_available = sum(
            1 for aircraft in self.aircraft
            if aircraft.state == "available" and not aircraft.preventive_due
        )
        mission_ready = sum(1 for aircraft in self.aircraft if aircraft.state == "mission_ready")
        available = unassigned_available + sum(
            1 for aircraft in self.aircraft
            if aircraft.state == "mission_ready" and not aircraft.preventive_due
        )
        active_jobs = sum(1 for job in self.jobs if job.state == "running")
        backlog = sum(1 for job in self.jobs if job.state == "waiting")
        repair_backlog = sum(1 for job in self.jobs if job.kind == "repair" and job.state in {"waiting", "running"})
        postflight_backlog = sum(1 for job in self.jobs if job.kind == "postflight" and job.state in {"waiting", "running"})
        preventive_backlog = sum(1 for job in self.jobs if job.kind == "preventive" and job.state in {"waiting", "running"})
        stock_total = sum(sum(max(0, int(qty)) for qty in node["inventory"].values()) for node in self.nodes.values())
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
        operational_availability = (
            self.available_aircraft_hours / self.total_aircraft_hours
            if self.total_aircraft_hours > 0
            else None
        )
        avg_delay = self.total_departure_delay / max(1, self.launched_sorties + self.cancelled_sorties)
        mean_transport_delay = (self.total_transport_delay / 60.0) / max(1, self.transport_replenishment_events)
        return {
            "sortie_completion_rate": sortie_completion_rate,
            "mission_success_rate": mission_success_rate,
            "sortie_rate": sortie_rate,
            "ready_rate": ready_rate,
            "operational_availability": operational_availability,
            "operational_availability_sample_count": self.operational_availability_sample_count,
            "available_aircraft_hours": self.available_aircraft_hours,
            "total_aircraft_hours": self.total_aircraft_hours,
            "aircraft_count": aircraft_count,
            "simulation_days": simulation_days,
            "available_aircraft": available,
            "unassigned_available_aircraft": unassigned_available,
            "mission_ready_aircraft": mission_ready,
            "daily_readiness_sample_count": len(self.daily_readiness_samples),
            "active_jobs": active_jobs,
            "spare_stock_total": stock_total,
            "avg_departure_delay": avg_delay,
            "spare_consumed_total": self.spare_consumed_total,
            "spare_carried_total": self.spare_carried_total,
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
            "preventive_maintenance_events": self.preventive_maintenance_events,
            "downtime_preventive_events": downtime_summary["preventive"]["event_count"],
            "planned_sorties": planned_sorties,
            "planned_mission_waves": len(executable_missions),
            "successful_mission_waves": successful_mission_waves,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "failed_sorties": self.failed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "delayed_sorties": self.delayed_sorties,
            "spare_demand_total": self.spare_demand_total,
            "spare_immediately_filled_total": self.spare_immediately_filled_total,
            "spare_fill_rate": (
                self.spare_immediately_filled_total / self.spare_demand_total
                if self.spare_demand_total > 0
                else None
            ),
            "spare_utilization": (
                self.spare_consumed_total / self.spare_carried_total
                if self.spare_carried_total > 0
                else None
            ),
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
        active_jobs_by_tail: dict[str, list[JobState]] = {}
        for job in self.jobs:
            if job.state in {"waiting", "running"}:
                active_jobs_by_tail.setdefault(job.tail_number, []).append(job)
        current = {}
        for aircraft in self.aircraft:
            context = self._current_downtime_context(
                aircraft, active_jobs=active_jobs_by_tail.get(aircraft.tail_number, ()),
            )
            if context is not None:
                factor, job = context
                current[aircraft.tail_number] = (
                    aircraft, factor, job, self._downtime_context_key(factor, aircraft, job)
                )
        # Preserve event closure order (insertion order), independently of aircraft
        # iteration order, while only constructing payloads for new intervals.
        for tail_number, active in tuple(self._active_downtime_events.items()):
            candidate = current.get(tail_number)
            if candidate is None or candidate[3] != self._downtime_event_context_key(active):
                self._close_downtime_event(tail_number)
        for tail_number, (aircraft, factor, job, _) in current.items():
            active = self._active_downtime_events.get(tail_number)
            if active is None:
                active = self._downtime_event_payload(factor, aircraft, job, interval_start)
                self._downtime_event_sequence += 1
                active["event_id"] = f"downtime-{self._downtime_event_sequence:06d}"
                self._active_downtime_events[tail_number] = active
            self._refresh_downtime_event(active, aircraft, job)
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

    def _current_downtime_event(
        self,
        aircraft: AircraftState,
        start_minute: float,
        *,
        active_jobs: list[JobState] | tuple[JobState, ...] | None = None,
    ) -> dict[str, Any] | None:
        if active_jobs is None:
            active_jobs = [
                job for job in self.jobs
                if job.tail_number == aircraft.tail_number and job.state in {"waiting", "running"}
            ]
        context = self._current_downtime_context(aircraft, active_jobs=active_jobs)
        if context is None:
            return None
        factor, job = context
        return self._downtime_event_payload(factor, aircraft, job, start_minute)

    def _current_downtime_context(
        self,
        aircraft: AircraftState,
        *,
        active_jobs: list[JobState] | tuple[JobState, ...],
    ) -> tuple[str, JobState | None] | None:
        spare_job = next(
            (job for job in active_jobs if job.state == "waiting" and self._is_spare_shortage_job(job)),
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
            return "spare_shortage", spare_job
        if equipment_job is not None:
            return "equipment_shortage", equipment_job
        if aircraft.failed_component_id is not None or repair_job is not None:
            return "failure", repair_job
        if preventive_job is not None:
            return "preventive", preventive_job
        return None

    def _refresh_downtime_event(
        self,
        event: dict[str, Any],
        aircraft: AircraftState,
        job: JobState | None,
    ) -> None:
        """Refresh mutable end-state facts without changing the segment identity/count."""

        event["fault_related"] = bool(
            aircraft.failed_component_id is not None
            or event.get("fault_related")
            or (job is not None and job.kind == "repair")
        )
        if event.get("factor") != "spare_shortage" or job is None:
            return
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        task = job.current_task if isinstance(job.current_task, dict) else {}
        spare_type, required = self._shortage_spare_requirement(job, task)
        node = self.nodes.get(job.resource_node_id)
        available = int((node or {}).get("inventory", {}).get(spare_type, 0) or 0) if spare_type else None
        arrivals = [
            shipment.arrival_minute for shipment in self.transport_shipments
            if shipment.job_id == job.job_id
            and shipment.task_index == job.task_index
            and shipment.spare_type == spare_type
        ]
        details.update({
            "shortage_reason": job.shortage_reason,
            "product_id": spare_type,
            "spare_name": self._product_display_name(spare_type) if spare_type else None,
            "required_quantity": required or None,
            "available_quantity": available,
            "shortage_quantity": max(0, required - available) if available is not None else None,
            "scheduled_arrival_minute": min(arrivals) if arrivals else details.get("scheduled_arrival_minute"),
        })

    def _is_spare_shortage_job(self, job: JobState) -> bool:
        """Classify only actual spare gates, including the four organization outcomes."""

        reason = str(job.shortage_reason or "")
        if reason == "in_transit" or reason.startswith("spare:"):
            return True
        reason_code, separator, product_id = reason.partition(":")
        if not separator or reason_code not in {
            "organization_no_available_ancestor",
            "organization_no_available_supplier",
            "organization_no_vertical_path",
            "organization_no_supply_path",
        }:
            return False
        task = job.current_task if isinstance(job.current_task, dict) else {}
        return product_id in {
            spare_type for spare_type, quantity in self._task_spare_requirements(job, task) if quantity > 0
        }

    @staticmethod
    def _downtime_context_key(
        factor: str,
        aircraft: AircraftState,
        job: JobState | None,
    ) -> tuple[str, ...]:
        task = job.current_task if job is not None and isinstance(job.current_task, dict) else {}
        mission_id = job.mission_id if job is not None else aircraft.current_mission_id
        phase_id = str(task.get("activityCode") or task.get("id") or (job.kind if job is not None else ""))
        phase_name = str(
            task.get("workName")
            or task.get("name")
            or (job.activity_name if job is not None else "")
        )
        return (
            factor,
            str(mission_id or ""),
            str(job.kind if job is not None else ""),
            phase_id,
            phase_name,
            str(job.resource_node_id if job is not None else ""),
            str(job.job_id if job is not None else ""),
        )

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
                "shortage_reason": job.shortage_reason if job is not None else None,
                "scheduled_arrival_minute": min(arrivals) if arrivals else None,
                "arrival_minute": None,
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
            spare_requirements = self._task_spare_requirements(job, task) if job is not None else []
            selected_method = job.maintenance_method if job is not None else None
            effective_method = (
                "replacement"
                if selected_method == "replacement" and bool(spare_requirements)
                else "non_replacement" if selected_method in {"replacement", "non_replacement"} else None
            )
            details = {
                "component_id": component_id or None,
                "component_name": (component or {}).get("name"),
                "failure_mode": (component or {}).get("failure_mode"),
                "failure_minute": failure_minute,
                "repair_completed_minute": None,
                "maintenance_method": effective_method,
                "selected_maintenance_method": selected_method,
                "requires_spare": bool(spare_requirements),
            }
        else:
            activity = self._activity_by_id(job.activity_id) if job is not None else self._select_activity("preventive", aircraft=aircraft)
            trigger_types = (
                list(job.due_dimensions)
                if job is not None and job.due_dimensions
                else self._preventive_due_dimensions(aircraft, activity)
            )
            details = {
                "maintenance_type": job.activity_name if job is not None else activity.get("name"),
                "maintenance_method": job.maintenance_method if job is not None else None,
                "trigger_type": ",".join(trigger_types) if trigger_types else None,
                "due_dimensions": trigger_types,
                "initial_life_state": copy.deepcopy(aircraft.initial_life_state),
                "preventive_thresholds": copy.deepcopy(aircraft.preventive_thresholds),
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
            "fault_related": bool(aircraft.failed_component_id is not None or (job is not None and job.kind == "repair")),
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

    def _close_downtime_event(self, tail_number: str, *, simulation_cutoff: bool = False) -> None:
        event = self._active_downtime_events.pop(tail_number, None)
        if event is None or float(event.get("duration_minutes", 0) or 0) <= 0:
            return
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        factor = str(event.get("factor") or "")
        aircraft = self._aircraft_by_tail(tail_number)
        active_jobs = [
            job for job in self.jobs
            if job.tail_number == tail_number and job.state in {"waiting", "running"}
        ]
        next_context = self._current_downtime_context(aircraft, active_jobs=active_jobs) if aircraft is not None else None
        next_factor = next_context[0] if next_context is not None else ""
        event_job = next((job for job in self.jobs if job.job_id == event.get("job_id")), None)
        if simulation_cutoff:
            event["end_reason"] = "simulation_cutoff"
            event["status"] = "unresolved"
            if factor == "spare_shortage":
                shortage_reason = str(details.get("shortage_reason") or "")
                event["end_state"] = "waiting_transfer" if shortage_reason == "in_transit" else "waiting_spare"
            elif factor == "failure":
                repair_job = next((job for job in active_jobs if job.kind == "repair"), None)
                event["end_state"] = "repairing" if repair_job is not None and repair_job.state == "running" else "waiting_repair"
            elif factor == "preventive":
                event["end_state"] = "preventive_incomplete"
            else:
                event["end_state"] = "waiting_equipment"
        elif factor in {"spare_shortage", "equipment_shortage"} and next_factor in {"failure", "preventive"}:
            event["end_reason"] = "wait_completed"
            event["end_state"] = "repairing" if next_factor == "failure" else "preventive_in_progress"
            event["status"] = "continued"
        elif factor == "failure" and aircraft is not None and aircraft.failed_component_id is None and not any(
            job.kind == "repair" for job in active_jobs
        ):
            event["end_reason"] = "repair_completed"
            event["end_state"] = "available"
            event["status"] = "completed"
        elif factor == "preventive" and aircraft is not None and not aircraft.preventive_due and not any(
            job.kind == "preventive" for job in active_jobs
        ):
            event["end_reason"] = "maintenance_completed"
            event["end_state"] = "available"
            event["status"] = "completed"
        else:
            event["end_reason"] = "segment_changed"
            event["end_state"] = next_factor or (aircraft.state if aircraft is not None else "unknown")
            event["status"] = "continued" if next_factor else "completed"
        if factor == "equipment_shortage":
            details["wait_minutes"] = float(event["duration_minutes"])
        elif factor == "spare_shortage":
            if not simulation_cutoff and next_factor != "spare_shortage":
                details["wait_end_minute"] = event.get("end_minute")
                arrived = [
                    item for item in self.event_log
                    if item.get("event") in {"transport_arrived", "organization_transport_arrived"}
                    and isinstance(item.get("details"), dict)
                    and (
                        item["details"].get("job_id") == event.get("job_id")
                        or (
                            item["details"].get("product_id") == details.get("product_id")
                            and item["details"].get("resource_id") == event.get("support_node_id")
                        )
                    )
                ]
                actual_arrivals = [
                    item["details"].get("arrival_minute", item.get("time")) for item in arrived
                    if item["details"].get("arrival_minute", item.get("time")) is not None
                ]
                details["arrival_minute"] = max(actual_arrivals) if actual_arrivals else None
        elif factor == "failure":
            active_repair = any(
                job.tail_number == tail_number and job.kind == "repair" and job.state in {"waiting", "running"}
                for job in self.jobs
            )
            if aircraft is not None and aircraft.failed_component_id is None and not active_repair:
                details["repair_completed_minute"] = (
                    event_job.completed_time if event_job is not None and event_job.completed_time is not None
                    else event.get("end_minute")
                )
        elif factor == "preventive":
            active_preventive = any(
                job.tail_number == tail_number and job.kind == "preventive" and job.state in {"waiting", "running"}
                for job in self.jobs
            )
            if aircraft is not None and not aircraft.preventive_due and not active_preventive:
                details["completed_minute"] = event.get("end_minute")
        self.downtime_events.append(copy.deepcopy(event))

    def _close_all_downtime_events(self) -> None:
        for tail_number in list(self._active_downtime_events):
            self._close_downtime_event(tail_number, simulation_cutoff=not self.running)

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
            aircraft.state in {"flying", "mission_ready", "pre_support", "post_support"}
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
        available = sum(
            1 for aircraft in self.aircraft
            if aircraft.state in {"available", "mission_ready"}
            and not aircraft.preventive_due
        )
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

    def _record_operational_availability_sample_if_due(self) -> None:
        while self.minute >= self._next_operational_availability_sample_minute:
            available_count = sum(
                1 for aircraft in self.aircraft
                if self._aircraft_is_operationally_available(aircraft)
            )
            self.available_aircraft_hours += available_count
            self.total_aircraft_hours += len(self.aircraft)
            self.operational_availability_sample_count += 1
            self._next_operational_availability_sample_minute += (
                self.operational_availability_sample_interval_minutes
            )

    def _aircraft_is_operationally_available(self, aircraft: AircraftState) -> bool:
        if aircraft.in_flight_failure or aircraft.failed_component_id is not None:
            return False
        if aircraft.state == "maintenance":
            return False
        return not any(
            job.tail_number == aircraft.tail_number
            and job.kind in {"repair", "preventive"}
            and job.state in {"waiting", "running"}
            for job in self.jobs
        )


__all__ = ["MetricsEngineMixin"]
