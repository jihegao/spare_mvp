"""MissionEngine behavior for aircraft-support v1."""

from __future__ import annotations

from typing import Any

from .component_index import aircraft_type_tokens as _aircraft_type_tokens
from .state import AircraftState, MissionState


class MissionEngineMixin:
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
        flight_hours = max(0.0, float((end_minute - start_minute) / 60.0))
        aircraft.flight_hours += flight_hours
        aircraft.landing_count += 1
        self._record_preventive_usage(aircraft, flight_hours=flight_hours, landings=1)
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

    def _create_due_preflight_jobs(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.minute < mission.preparation_start:
                continue
            commissioned = self._mission_preflight_commissioned_count(mission)
            if commissioned >= mission.required_aircraft:
                mission.preflight_created = True
                continue
            active_preflight_tails = self._active_preflight_tail_numbers(mission.mission_id)
            available = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.state == "available"
                and self._aircraft_matches_mission_type(aircraft, mission)
                and not aircraft.prepared_mission_ids
                and aircraft.tail_number not in active_preflight_tails
            ]
            needed = mission.required_aircraft - commissioned
            created = 0
            for aircraft in available[: max(0, needed)]:
                aircraft.state = "pre_support"
                aircraft.current_mission_id = mission.mission_id
                activity = self._preflight_activity_for_mission(mission, aircraft)
                self._create_job(aircraft, activity, kind="preflight", mission_id=mission.mission_id)
                created += 1
            commissioned = self._mission_preflight_commissioned_count(mission)
            mission.preflight_created = commissioned >= mission.required_aircraft
            if created:
                self._event("preflight_created", f"{mission.mission_id} created {created} jobs")
            if not mission.preflight_created:
                self._report_preflight_resource_conflict(mission, commissioned)

    def _preflight_activity_for_mission(
        self,
        mission: MissionState,
        aircraft: AircraftState,
    ) -> dict[str, Any]:
        candidates = [
            activity
            for activity in self.activities
            if self._activity_kind_matches(activity, "preflight")
        ]
        aircraft_models = _aircraft_type_tokens(aircraft.aircraft_type) | _aircraft_type_tokens(aircraft.model)

        def applies_to_aircraft(activity: dict[str, Any]) -> bool:
            activity_models = _aircraft_type_tokens(activity.get("aircraft_model"))
            return not activity_models or bool(activity_models & aircraft_models)

        compatible = [activity for activity in candidates if applies_to_aircraft(activity)]
        expected_name = mission.support_activity_name.strip().casefold()
        if expected_name:
            for activity in compatible:
                if str(activity.get("name") or "").strip().casefold() == expected_name:
                    return activity
        if compatible:
            return compatible[0]
        return self.preflight_activity

    def _dispatch_due_missions(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.minute < mission.planned_start:
                continue
            candidates = [
                aircraft
                for aircraft in self.aircraft
                if self._aircraft_ready_for_mission(aircraft, mission)
                and self._aircraft_matches_mission_type(aircraft, mission)
            ]
            if len(candidates) >= mission.required_aircraft:
                assigned = candidates[: mission.required_aircraft]
                for aircraft in assigned:
                    aircraft.state = "flying"
                    aircraft.current_mission_id = mission.mission_id
                    aircraft.prepared_mission_ids.discard(mission.mission_id)
                    aircraft.return_time = self.minute + mission.duration_minutes
                    aircraft.takeoff_count += 1
                    self._record_preventive_usage(aircraft, takeoffs=1)
                mission.status = "launched"
                mission.actual_start = self.minute
                mission.return_time = self.minute + mission.duration_minutes
                mission.assigned_tail_numbers = [aircraft.tail_number for aircraft in assigned]
                mission.delay_minutes = max(0, self.minute - mission.planned_start)
                self.launched_sorties += len(assigned)
                self.total_departure_delay += mission.delay_minutes
                if mission.delay_minutes and mission.mission_id not in self._delayed_mission_ids:
                    self.delayed_sorties += len(assigned)
                    self._delayed_mission_ids.add(mission.mission_id)
                self._event("mission_launched", f"{mission.mission_id} launched {len(assigned)} aircraft")
                continue
            if self.minute - mission.planned_start >= mission.cancel_minutes:
                mission.status = "cancelled"
                self.cancelled_sorties += mission.required_aircraft
                self.total_departure_delay += mission.cancel_minutes
                self._cancel_mission_preflight(mission)
                self._event("mission_cancelled", f"{mission.mission_id} cancelled for insufficient ready aircraft")
            else:
                mission.status = "delayed"
                if mission.mission_id not in self._delayed_mission_ids:
                    self.delayed_sorties += mission.required_aircraft
                    self._delayed_mission_ids.add(mission.mission_id)

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

    def _active_preflight_tail_numbers(self, mission_id: str) -> set[str]:
        return {
            job.tail_number
            for job in self.jobs
            if job.kind == "preflight"
            and job.mission_id == mission_id
            and job.state in {"waiting", "running"}
        }

    def _mission_preflight_commissioned_count(self, mission: MissionState) -> int:
        active_preflight_tails = self._active_preflight_tail_numbers(mission.mission_id)
        mission_ready_tails = {
            aircraft.tail_number
            for aircraft in self.aircraft
            if self._aircraft_ready_for_mission(aircraft, mission)
            and self._aircraft_matches_mission_type(aircraft, mission)
        }
        matching_active_tails = {
            tail_number
            for tail_number in active_preflight_tails
            if (aircraft := self._aircraft_by_tail(tail_number)) is not None
            and self._aircraft_matches_mission_type(aircraft, mission)
        }
        return len(matching_active_tails | mission_ready_tails)

    @staticmethod
    def _aircraft_ready_for_mission(
        aircraft: AircraftState,
        mission: MissionState,
    ) -> bool:
        if mission.mission_id not in aircraft.prepared_mission_ids:
            return False
        if aircraft.state == "mission_ready":
            return aircraft.current_mission_id == mission.mission_id
        # Compatibility for focused tests and callers that directly seed the
        # preflight marker instead of progressing a real preflight job.
        return aircraft.state == "available" and aircraft.current_mission_id in {None, mission.mission_id}

    def _report_preflight_resource_conflict(
        self,
        mission: MissionState,
        commissioned: int,
    ) -> None:
        blockers = tuple(sorted(
            (
                aircraft.tail_number,
                str(aircraft.current_mission_id or ""),
                aircraft.state,
            )
            for aircraft in self.aircraft
            if self._aircraft_matches_mission_type(aircraft, mission)
            and aircraft.current_mission_id not in {None, mission.mission_id}
            and aircraft.state in {"pre_support", "mission_ready", "flying", "post_support"}
        ))
        state_counts = tuple(sorted(
            (
                state,
                sum(
                    1 for aircraft in self.aircraft
                    if aircraft.state == state
                    and self._aircraft_matches_mission_type(aircraft, mission)
                ),
            )
            for state in {aircraft.state for aircraft in self.aircraft}
        ))
        shortfall = max(0, mission.required_aircraft - commissioned)
        fact_key = (
            "preflight_resource_conflict",
            mission.mission_id,
            shortfall,
            blockers,
            state_counts,
        )
        if shortfall <= 0 or not blockers or fact_key in self._mission_scheduling_fact_keys:
            return
        self._mission_scheduling_fact_keys.add(fact_key)
        self._event(
            "preflight_resource_conflict",
            f"{mission.mission_id} preflight shortfall {shortfall}; earlier missions retain reservations",
            {
                "mission_id": mission.mission_id,
                "required_aircraft": mission.required_aircraft,
                "commissioned_aircraft": commissioned,
                "shortfall": shortfall,
                "policy": "no_preemption_earlier_mission",
                "blocking_reservations": [
                    {
                        "tail_number": tail_number,
                        "mission_id": blocking_mission_id,
                        "state": state,
                    }
                    for tail_number, blocking_mission_id, state in blockers
                ],
            },
        )

    def _cancel_mission_preflight(self, mission: MissionState) -> None:
        cancelled_jobs = [
            job for job in self.jobs
            if job.kind == "preflight"
            and job.mission_id == mission.mission_id
            and job.state in {"waiting", "running"}
        ]
        cancelled_job_ids = {job.job_id for job in cancelled_jobs}
        affected_tails = {job.tail_number for job in cancelled_jobs}
        for job in cancelled_jobs:
            if job.state == "running" or job.resource_reservations:
                self._release_job_resources(job)
            job.state = "cancelled"
            job.remaining = 0
            job.shortage_reason = None
            job.remote_resources_pending.clear()
        if cancelled_job_ids:
            self.resource_transits = [
                transit for transit in self.resource_transits
                if transit.job_id not in cancelled_job_ids
            ]
        self._return_cancelled_spare_reservations()

        released_tails: list[str] = []
        for aircraft in self.aircraft:
            reserved_for_mission = (
                aircraft.current_mission_id == mission.mission_id
                and aircraft.state in {"pre_support", "mission_ready"}
            )
            if reserved_for_mission or aircraft.tail_number in affected_tails:
                aircraft.state = "available"
                aircraft.current_mission_id = None
                released_tails.append(aircraft.tail_number)
            aircraft.prepared_mission_ids.discard(mission.mission_id)
        self._event(
            "mission_preflight_released",
            f"{mission.mission_id} released preflight reservations",
            {
                "mission_id": mission.mission_id,
                "cancelled_job_ids": sorted(cancelled_job_ids),
                "released_tail_numbers": sorted(set(released_tails)),
            },
        )

    def _aircraft_matches_mission_type(self, aircraft: AircraftState, mission: MissionState) -> bool:
        required_tokens = _aircraft_type_tokens(mission.required_aircraft_type)
        if not required_tokens:
            return True
        candidate_tokens = _aircraft_type_tokens(aircraft.aircraft_type) | _aircraft_type_tokens(aircraft.model)
        return bool(candidate_tokens & required_tokens)

    def _aircraft_by_tail(self, tail_number: str) -> AircraftState | None:
        return next((aircraft for aircraft in self.aircraft if aircraft.tail_number == tail_number), None)


__all__ = ["MissionEngineMixin"]
