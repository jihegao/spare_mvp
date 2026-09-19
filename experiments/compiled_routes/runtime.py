"""Experimental trigger, compiled calendar and independent SimPy schedulers.

All domain transitions remain the repository's authoritative implementations.
Independent means independent scheduler, not a new definition of the business.
"""
from bisect import bisect_right
from contextlib import contextmanager
import copy
import math

from experiments.event_calendar.runtime import CalendarModel
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model


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
                    for component in self.component_applicability_index.for_aircraft(aircraft):
                        key = str(component.get("id") or "component")
                        if key in aircraft.component_failure_minutes:
                            continue
                        remaining = aircraft.lru_failure_remaining_minutes.get(key)
                        if remaining is None:
                            return now + 1
                        if math.isfinite(remaining):
                            deadlines.append(now + max(1, math.ceil(remaining)))
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


class CompiledModel(TriggeredModel):
    """Reusable structural templates plus precomputed DAGs and static indexes."""
    def __init__(self, inputs, ir):
        self.ir = ir
        self._activity_index = None
        super().__init__(inputs)
        self._activity_index = {a["id"]: a for a in self.activities}
        self._active_view_depth = 0
        self._active_jobs = list(self.jobs)
        self._known_job_ids = {j.job_id for j in self.jobs}

    @contextmanager
    def _active_view(self):
        if self._active_view_depth:
            yield
            return
        all_jobs = self.jobs
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

    def _next_wakeup(self):
        with self._active_view():
            return super()._next_wakeup()

    def step(self):
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


class SimpyProcessModel(CompiledModel):
    """A SimPy generator owns execution; never calls the minute step method.

Event phases reuse business transitions. Resources use the atomic repository
allocator on release/arrival/create signals, avoiding a polling Resource loop.
"""
    def step(self):
        raise RuntimeError("independent SimPy executor has run(), not tick step()")

    def _phase_transition(self, target):
        with self._active_view():
            yield from self._execute_phases(target)

    def _execute_phases(self, target):
        skipped = target - self.minute - 1
        if skipped:
            self._advance_stable_interval(skipped)
        self.minute = target
        self.time = target
        self.steps += 1
        self.executed_ticks += 1
        old_epoch = self.resource_epoch
        old_aircraft = tuple((a.state, a.current_mission_id) for a in self.aircraft)
        self._process_transport_arrivals()
        self._process_mission_returns()
        self._process_job_progress_and_completions()
        self._evaluate_failures()
        self._generate_preventive_jobs()
        self._create_due_preflight_jobs()
        if self.attempted_epoch != self.resource_epoch:
            ack = self.env.event()
            self._resource_signal.succeed(ack)
            yield ack
        self._dispatch_due_missions()
        self._evaluate_mission_success_points()
        self._record_daily_readiness_sample_if_due()
        self._record_operational_availability_sample_if_due()
        self._record_downtime_minutes()
        reason, conditions = self._stop_decision()
        if reason:
            self.stop_reason, self.stop_conditions_met = reason, conditions
            self._event("simulation_stopped", f"simulation stopped by {reason}", {"reason": reason, "conditions": conditions})
        if reason or self.minute >= self.duration_minutes:
            self.running = False
        if old_epoch != self.resource_epoch or old_aircraft != tuple((a.state, a.current_mission_id) for a in self.aircraft):
            self.settle_until = self.minute + 1

    def run(self):
        import simpy
        env = simpy.Environment()
        self.env = env
        self._resource_signal = env.event()

        def resource_broker():
            while True:
                ack = yield self._resource_signal
                self._resource_signal = env.event()
                self._start_waiting_jobs()
                ack.succeed()

        env.process(resource_broker())

        def execute():
            while self.running:
                target = self._next_wakeup()
                yield env.timeout(target - env.now)
                yield from self._phase_transition(target)

        env.run(until=env.process(execute()))
        # Shared result materialization only; running=False so no step executes.
        return AircraftSupportV1Model.run(self)


class ParallelDAGMixin:
    """Opt-in behavioral experiment: execute independent preflight DAG nodes.

    Each ready node is admitted atomically by the existing resource allocator.
    A blocked dependency never polls. Finishing a node decrements successor
    indegrees and wakes the ready frontier. No global stochastic branch DAG is
    materialized, and repair/preventive lifecycle transitions remain shared.
    """
    def __init__(self, inputs, ir):
        self.dag_groups = {}
        self.dag_nodes = {}
        self.dag_unlocked_nodes = 0
        super().__init__(inputs, ir)

    def _create_job(self, *args, **kwargs):
        super()._create_job(*args, **kwargs)
        parent = self.jobs[-1]
        if parent.kind != "preflight" or len(parent.tasks) <= 1:
            return
        dag = self.ir.dags[parent.activity_id]
        if tuple(str(t.get("activityCode")) for t in parent.tasks) != dag.codes:
            raise ValueError("runtime tasks differ from compiled DAG")
        group = {"parent": parent, "children": [], "remaining": len(dag.codes),
                 "indegrees": [len(p) for p in dag.predecessors], "dag": dag}
        self.dag_groups[parent.job_id] = group
        self.jobs.pop()
        for i, task in enumerate(parent.tasks):
            child = copy.deepcopy(parent)
            child.job_id = f"{parent.job_id}/node-{i:03d}"
            child.tasks = [copy.deepcopy(task)]
            child.state = "blocked" if dag.predecessors[i] else "waiting"
            group["children"].append(child)
            self.dag_nodes[child.job_id] = (group, i)
            self.jobs.append(child)

    def _complete_job_effect(self, job):
        item = self.dag_nodes.get(job.job_id)
        if item is None:
            return super()._complete_job_effect(job)
        group, index = item
        group["remaining"] -= 1
        for successor in group["dag"].successors[index]:
            group["indegrees"][successor] -= 1
            if group["indegrees"][successor] == 0:
                group["children"][successor].state = "waiting"
                self.dag_unlocked_nodes += 1
                self.resource_epoch += 1
        if group["remaining"] == 0:
            parent = group["parent"]
            parent.state = "completed"
            parent.completed_time = self.minute
            super()._complete_job_effect(parent)

    def _cancel_mission_preflight(self, mission):
        # Cancellation must also reach not-yet-ready descendants.
        for job in self.jobs:
            if job.kind == "preflight" and job.mission_id == mission.mission_id and job.state == "blocked":
                job.state = "waiting"
        super()._cancel_mission_preflight(mission)


class ParallelDAGModel(ParallelDAGMixin, CompiledModel):
    pass


class SimpyDAGModel(ParallelDAGMixin, SimpyProcessModel):
    pass
