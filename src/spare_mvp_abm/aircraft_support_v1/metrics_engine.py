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
        if preventive_job is not None:
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
