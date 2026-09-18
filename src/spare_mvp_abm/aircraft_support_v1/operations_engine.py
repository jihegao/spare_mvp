"""Daily operations support, consuming explicit adapter phase/group identities."""

from __future__ import annotations

from typing import Any

from .component_index import aircraft_type_tokens


class OperationsEngineMixin:
    def _operations_activity(self, group_id: str, phase: str, aircraft) -> dict[str, Any]:
        if not group_id:
            # No operations plan is configured: all three stages are empty.
            return {"id": f"operations-empty-{phase}", "name": phase, "jobs": [],
                    "operations_phase": phase, "plan_group_id": ""}
        candidates = [activity for activity in self.activities
                      if activity.get("plan_group_id") == group_id
                      and activity.get("operations_phase") == phase]
        models = aircraft_type_tokens(aircraft.aircraft_type) | aircraft_type_tokens(aircraft.model)
        candidates = [activity for activity in candidates
                      if not aircraft_type_tokens(activity.get("aircraft_model"))
                      or aircraft_type_tokens(activity.get("aircraft_model")) & models]
        if len(candidates) != 1:
            raise ValueError(f"operations group {group_id!r} requires one compatible {phase} stage")
        return candidates[0]

    def _operations_preparation_activity(self, mission, aircraft):
        day = max(self.minute, mission.planned_start) // 1440
        phase = "relaunch" if aircraft.operations_day == day and aircraft.daily_takeoffs else "preflight"
        aircraft.prepared_operations_day = day
        return self._operations_activity(mission.operations_plan_group_id, phase, aircraft)

    def _cancel_aircraft_operations_preparation(self, aircraft) -> None:
        jobs = [job for job in self.jobs if job.tail_number == aircraft.tail_number
                and job.kind == "preflight" and job.state in {"waiting", "running"}]
        ids = {job.job_id for job in jobs}
        for job in jobs:
            if job.state == "running" or job.resource_reservations:
                self._release_job_resources(job)
            job.state = "cancelled"
            job.remaining = 0
            job.remote_resources_pending.clear()
        self.resource_transits = [transit for transit in self.resource_transits if transit.job_id not in ids]
        self._return_cancelled_spare_reservations()
        aircraft.prepared_mission_ids.clear()
        aircraft.prepared_operations_day = None
        aircraft.current_mission_id = None
        if aircraft.state in {"pre_support", "mission_ready"}:
            aircraft.state = "available"
        self._event("operations_preparation_invalidated", "Preparation crossed its departure day",
                    {"tail_number": aircraft.tail_number, "cancelled_job_ids": sorted(ids)})

    def _has_remaining_operations_mission(self, aircraft) -> bool:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if max(self.minute, mission.planned_start) // 1440 != aircraft.operations_day:
                continue
            if self.minute > mission.planned_start + mission.cancel_minutes:
                continue
            if not self._aircraft_matches_mission_type(aircraft, mission):
                continue
            if aircraft.current_mission_id == mission.mission_id:
                return True
            if self._mission_preflight_commissioned_count(mission) < mission.required_aircraft:
                return True
        return False

    def _coordinate_operations_postflight(self, *, cutoff: bool = False) -> None:
        if not self.operations_phases_enabled:
            return
        day = self.minute // 1440
        for aircraft in self.aircraft:
            if aircraft.prepared_operations_day is not None and aircraft.prepared_operations_day < day:
                self._cancel_aircraft_operations_preparation(aircraft)
            if aircraft.operations_day is None or not aircraft.daily_takeoffs:
                continue
            # A previous departure day closes even while the aircraft is airborne.
            if (day > aircraft.operations_day or cutoff) and (aircraft.postflight_required or aircraft.state == "flying"):
                aircraft.postflight_due = True
            if not aircraft.postflight_required:
                continue
            if not self._has_remaining_operations_mission(aircraft):
                aircraft.postflight_due = True
            if not aircraft.postflight_due:
                continue
            if aircraft.state in {"flying", "maintenance", "preventive", "post_support"}:
                continue
            if aircraft.state in {"pre_support", "mission_ready"}:
                self._cancel_aircraft_operations_preparation(aircraft)
            aircraft.state = "post_support"
            self._create_job(
                aircraft,
                self._operations_activity(aircraft.operations_plan_group_id, "postflight", aircraft),
                kind="postflight", mission_id=aircraft.last_operations_mission_id,
            )

    def _operations_departure(self, aircraft, mission) -> None:
        day = self.minute // 1440
        if aircraft.operations_day != day:
            aircraft.operations_day = day
            aircraft.daily_takeoffs = 0
        aircraft.daily_takeoffs += 1
        aircraft.operations_plan_group_id = mission.operations_plan_group_id
        aircraft.last_operations_mission_id = mission.mission_id
        aircraft.prepared_operations_day = None

    def _operations_step_event(self, event_type: str, job, task=None) -> None:
        if not job.operations_phase:
            return
        self._event(event_type, f"{job.tail_number} {job.operations_phase}", {
            "tail_number": job.tail_number, "mission_id": job.mission_id,
            "job_id": job.job_id, "activity_id": job.activity_id,
            "plan_group_id": job.plan_group_id, "operations_phase": job.operations_phase,
            "activity_code": (task or {}).get("activityCode"),
            "predecessors": list((task or {}).get("predecessors") or []),
            "resource_node_id": job.resource_node_id,
        })

    def _finalize_operations_cutoff(self) -> None:
        if not self.operations_phases_enabled:
            return
        self._coordinate_operations_postflight(cutoff=True)
        for aircraft in self.aircraft:
            if aircraft.postflight_required or (aircraft.state == "flying" and aircraft.daily_takeoffs):
                self._event("operations_postflight_pending", "Postflight remains incomplete at simulation cutoff", {
                    "tail_number": aircraft.tail_number,
                    "mission_id": aircraft.last_operations_mission_id,
                    "plan_group_id": aircraft.operations_plan_group_id,
                    "operations_phase": "postflight", "aircraft_state": aircraft.state,
                })
