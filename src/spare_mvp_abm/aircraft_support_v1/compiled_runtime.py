"""Headless execution over precompiled structure and state-triggered active jobs.

Consumes canonical SimulationAdapter inputs, never Project JSON. Business
transitions and their ordering remain owned by AircraftSupportV1Model. Waiting
resource diagnostics count state-triggered attempts rather than minute retries.
Per-minute visualization and non-unit ticks use the reference executor.
"""
from bisect import bisect_right
from contextlib import contextmanager
from dataclasses import dataclass
import copy
import math

from .model import AircraftSupportV1Model

@dataclass(frozen=True)
class JobDAG:
    codes: tuple[str, ...]
    predecessors: tuple[tuple[int, ...], ...]
    successors: tuple[tuple[int, ...], ...]
    durations: tuple[int, ...]
    critical_path_minutes: int
    serial_minutes: int

    @classmethod
    def compile(cls, activity):
        jobs = activity.get("jobs") or []
        codes = tuple(str(j.get("activityCode") or f"task-{i}") for i, j in enumerate(jobs))
        if len(set(codes)) != len(codes):
            raise ValueError(f"duplicate task code: {activity['id']}")
        index = {code: i for i, code in enumerate(codes)}
        predecessors = []
        for job in jobs:
            unknown = set(job.get("predecessors") or []) - index.keys()
            if unknown:
                raise ValueError(f"unknown predecessor in {activity['id']}: {sorted(unknown)}")
            predecessors.append(tuple(dict.fromkeys(index[p] for p in job.get("predecessors") or [])))
        durations = tuple(max(1, int(j.get("durationMinutes") or j.get("duration_minutes") or activity.get("duration_minutes") or 30)) for j in jobs)
        ends = {}
        while len(ends) < len(jobs):
            ready = [i for i in range(len(jobs)) if i not in ends and all(p in ends for p in predecessors[i])]
            if not ready:
                raise ValueError(f"cycle in {activity['id']}")
            for i in ready:
                ends[i] = max((ends[p] for p in predecessors[i]), default=0) + durations[i]
        successors = tuple(tuple(i for i, ps in enumerate(predecessors) if parent in ps) for parent in range(len(jobs)))
        return cls(codes, tuple(predecessors), successors, durations, max(ends.values(), default=0), sum(durations))


@dataclass(frozen=True)
class CompiledSimulation:
    # Private templates are copied into each run; mutable inventories and RNG
    # state are never shared between Monte Carlo samples.
    aircraft: list
    components: list
    equipment: list
    nodes: dict
    activities: list
    missions: list
    dags: dict[str, JobDAG]

    @classmethod
    def compile(cls, inputs):
        model = AircraftSupportV1Model(inputs)
        return cls(model._build_aircraft(), copy.deepcopy(model.components),
                   copy.deepcopy(model.equipment_tree_components), model._build_support_nodes(),
                   copy.deepcopy(model.activities), model._build_missions(),
                   {a["id"]: JobDAG.compile(a) for a in model.activities})

    def summary(self):
        return {"aircraft": len(self.aircraft), "components": len(self.components),
                "missions": len(self.missions), "nodes": len(self.nodes),
                "activity_dags": {key: {"tasks": len(dag.codes),
                    "edges": sum(map(len, dag.predecessors)),
                    "critical_path_minutes": dag.critical_path_minutes,
                    "serial_minutes": dag.serial_minutes} for key, dag in self.dags.items()}}


@dataclass(frozen=True)
class CalendarIR:
    """Immutable static wakeups compiled from the initialized canonical model."""

    wakeups: tuple[int, ...]

    @classmethod
    def compile(cls, model):
        times = {1, model.duration_minutes}
        for mission in model.missions:
            times.update((mission.preparation_start, mission.planned_start,
                          mission.planned_start + mission.cancel_minutes))
        for condition in model.stop_policy.get("conditions", []):
            if condition.get("type") == "duration":
                times.add(int(condition.get("duration_minutes") or model.duration_minutes))
            elif condition.get("type") == "specified_time":
                times.add(int(condition.get("minute") or model.duration_minutes))
        return cls(tuple(sorted(t for t in times if t > 0)))


class CalendarModel(AircraftSupportV1Model):

    def __init__(self, inputs):
        super().__init__(inputs)
        self._compiled_enabled = self.tick_minutes == 1 and self.disable_visualization_frames
        self.calendar = CalendarIR.compile(self)
        self.executed_ticks = 0
        self.skipped_ticks = 0

    def _advance_stable_interval(self, skipped):
        for job in self.jobs:
            if job.state == "running":
                job.remaining -= skipped
        # Below 2**53, subtracting an integer while the countdown stays positive
        # is exact in binary64. Unusually large timers retain repeated rounding.
        # No RNG calls occur in a stable interval.
        for aircraft in self.aircraft:
            if aircraft.state != "flying" or aircraft.in_flight_failure:
                continue
            for component in self.component_applicability_index.for_aircraft(aircraft):
                key = str(component.get("id") or "component")
                if key in aircraft.component_failure_minutes:
                    continue
                remaining = aircraft.lru_failure_remaining_minutes[key]
                if skipped < remaining <= 2**53:
                    remaining -= skipped
                else:
                    for _ in range(skipped):
                        remaining -= 1
                aircraft.lru_failure_remaining_minutes[key] = remaining
        self.minute += skipped
        self.time = self.minute
        self.steps += skipped
        # No transition occurs inside this interval. Integrate downtime with
        # unchanged context; boundary tick still uses the reference ordering.
        self.tick_minutes = skipped
        try:
            self._record_downtime_minutes()
        finally:
            self.tick_minutes = 1
        self.skipped_ticks += skipped

    def step(self):
        if not self._compiled_enabled:
            return AircraftSupportV1Model.step(self)
        if not self.running:
            return False
        target = self._next_wakeup()
        skipped = target - self.minute - 1
        if skipped:
            self._advance_stable_interval(skipped)
        self.executed_ticks += 1
        return super().step()


class TriggeredModel(CalendarModel):
    """Wake blocked work only after a state change; no minute retry loop."""
    def __init__(self, inputs):
        self.resource_epoch = 0
        self.attempted_epoch = -1
        self.resource_dispatch_passes = 0
        self.resource_jobs_examined = 0
        super().__init__(inputs)
        self.settle_until = 1

    def _create_job(self, *args, **kwargs):
        super()._create_job(*args, **kwargs)
        self.resource_epoch += 1

    def _release_job_resources(self, job):
        super()._release_job_resources(job)
        self.resource_epoch += 1

    def _event(self, event, message, details=None):
        # Stock may be returned without any personnel/equipment release, or
        # supplied synchronously by a legacy zero-minute transport policy.
        if event in {"organization_spare_reservation_returned", "transport_replenished"}:
            self.resource_epoch += 1
        super()._event(event, message, details)

    def _process_transport_arrivals(self):
        before = len(self.transport_shipments) + len(self.resource_transits)
        super()._process_transport_arrivals()
        if before != len(self.transport_shipments) + len(self.resource_transits):
            self.resource_epoch += 1

    def _start_waiting_jobs(self):
        if not getattr(self, "_compiled_enabled", True):
            return super()._start_waiting_jobs()
        if self.attempted_epoch == self.resource_epoch:
            return
        self.resource_dispatch_passes += 1
        self.resource_jobs_examined += sum(j.state == "waiting" for j in self.jobs)
        observed_epoch = self.resource_epoch
        super()._start_waiting_jobs()
        self.attempted_epoch = observed_epoch

    def _next_wakeup(self):
        now = self.minute
        if now == 0 or now < self.settle_until or self.attempted_epoch != self.resource_epoch:
            return now + 1
        deadlines = [self.duration_minutes,
                     self._next_operational_availability_sample_minute,
                     ((now - 840) // 1440 + 1) * 1440 + 840]
        i = bisect_right(self.calendar.wakeups, now)
        if i < len(self.calendar.wakeups):
            deadlines.append(self.calendar.wakeups[i])
        deadlines.extend(m.success_minute for m in self.missions if not m.success_evaluated)
        deadlines.extend(s.arrival_minute for s in self.transport_shipments)
        deadlines.extend(s.arrival_minute for s in self.resource_transits)
        deadlines.extend(now + max(1, math.ceil(j.remaining)) for j in self.jobs if j.state == "running")
        for aircraft in self.aircraft:
            if aircraft.state == "flying":
                if aircraft.return_time is not None:
                    deadlines.append(aircraft.return_time)
                if not aircraft.in_flight_failure:
                    nearest_failure = math.inf
                    for key in self._failure_component_keys[aircraft.tail_number]:
                        if key in aircraft.component_failure_minutes:
                            continue
                        remaining = aircraft.lru_failure_remaining_minutes.get(key)
                        if remaining is None:
                            return now + 1
                        if remaining < nearest_failure:
                            nearest_failure = remaining
                    if math.isfinite(nearest_failure):
                        deadlines.append(now + max(1, math.ceil(nearest_failure)))
            for cycle in aircraft.preventive_cycles.values():
                days = int(cycle.get("thresholds", {}).get("calendar_days") or 0)
                due = int(cycle.get("last_preventive_minute") or 0) + days * 1440
                if days > 0 and due > now:
                    deadlines.append(due)
            if self._due_preventive_cycles(aircraft) and (aircraft.state == "available" or not aircraft.preventive_due):
                return now + 1
        return max(now + 1, min(deadlines))

    def step(self):
        old_epoch = self.resource_epoch
        old_aircraft = tuple((a.state, a.current_mission_id) for a in self.aircraft)
        result = super().step()
        if old_epoch != self.resource_epoch or old_aircraft != tuple((a.state, a.current_mission_id) for a in self.aircraft):
            self.settle_until = self.minute + 1
        return result


class CompiledAircraftSupportModel(TriggeredModel):
    """Reusable structural templates plus precomputed DAGs and static indexes."""
    def __init__(self, inputs, compiled=None):
        self.ir = compiled if compiled is not None else CompiledSimulation.compile(inputs)
        self._activity_index = None
        super().__init__(inputs)
        self._activity_index = {a["id"]: a for a in self.activities}
        self._active_view_depth = 0
        self._active_jobs = list(self.jobs)
        self._known_job_ids = {j.job_id for j in self.jobs}
        self._failure_component_keys = {
            a.tail_number: tuple(str(c.get("id") or "component")
                                 for c in self.component_applicability_index.for_aircraft(a))
            for a in self.aircraft
        }

    @contextmanager
    def _active_view(self):
        if self._active_view_depth:
            yield
            return
        all_jobs = self.jobs
        self._historical_jobs = all_jobs
        self.jobs = self._active_jobs
        self._active_view_depth += 1
        try:
            yield
        finally:
            for job in self.jobs:
                if job.job_id not in self._known_job_ids:
                    all_jobs.append(job)
                    self._known_job_ids.add(job.job_id)
            self._active_jobs = [j for j in self.jobs if j.state in {"waiting", "running", "blocked"} or j.spare_reservations]
            self.jobs = all_jobs
            self._active_view_depth -= 1

    def _event_snapshot(self, event, details):
        # Event snapshots can include historical shortage context. Expose the
        # complete job history only during observation, never during scheduling.
        if not getattr(self, "_active_view_depth", 0):
            return super()._event_snapshot(event, details)
        active_jobs = self.jobs
        self.jobs = self._historical_jobs + [
            job for job in active_jobs if job.job_id not in self._known_job_ids
        ]
        try:
            return super()._event_snapshot(event, details)
        finally:
            self.jobs = active_jobs

    def _next_wakeup(self):
        with self._active_view():
            return super()._next_wakeup()

    def step(self):
        if not self._compiled_enabled:
            return AircraftSupportV1Model.step(self)
        with self._active_view():
            return super().step()

    def _build_aircraft(self):
        return copy.deepcopy(self.ir.aircraft)

    def _equipment_tree_components(self):
        return copy.deepcopy(self.ir.equipment)

    def _behavior_components(self):
        return copy.deepcopy(self.ir.components)

    def _build_support_nodes(self):
        return copy.deepcopy(self.ir.nodes)

    def _build_activities(self):
        return copy.deepcopy(self.ir.activities)

    def _build_missions(self):
        return copy.deepcopy(self.ir.missions)

    def _activity_by_id(self, activity_id):
        if self._activity_index is not None:
            return self._activity_index.get(activity_id, {})
        return super()._activity_by_id(activity_id)
