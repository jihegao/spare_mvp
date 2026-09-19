"""Experimental event calendar; deliberately not wired into production.

Reuse domain transitions and their ordering from the reference runtime. This is
a scheduler experiment, not a second Project compiler or a complete HPC IR.
"""
from bisect import bisect_right
from dataclasses import dataclass
import math

from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model


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
    use_simpy = False

    def __init__(self, inputs):
        super().__init__(inputs)
        if self.tick_minutes != 1 or not self.disable_visualization_frames or self.write_event_snapshots:
            raise ValueError("experiment requires tick=1, frames disabled, snapshots disabled")
        self.calendar = CalendarIR.compile(self)
        self.executed_ticks = 0
        self.skipped_ticks = 0
        if self.use_simpy:
            import simpy
            self.env = simpy.Environment()

    def _next_wakeup(self):
        now = self.minute
        if now == 0:
            return 1
        # Waiting retries emit minute-based facts and increment counters. Keep
        # these exact instead of silently redefining the public metrics.
        if any(j.state == "waiting" for j in self.jobs):
            return now + 1
        for mission in self.missions:
            if mission.status in {"scheduled", "delayed"} and mission.preparation_start <= now:
                return now + 1
        deadlines = [self.duration_minutes,
                     self._next_operational_availability_sample_minute,
                     ((now - 840) // 1440 + 1) * 1440 + 840]
        index = bisect_right(self.calendar.wakeups, now)
        if index < len(self.calendar.wakeups):
            deadlines.append(self.calendar.wakeups[index])
        for mission in self.missions:
            if not mission.success_evaluated:
                deadlines.append(mission.success_minute)
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
                if days > 0:
                    due = int(cycle.get("last_preventive_minute") or 0) + days * 1440
                    if due > now:
                        deadlines.append(due)
            # A due flag may have been reset by job completion within this tick.
            if self._due_preventive_cycles(aircraft) and (
                aircraft.state == "available" or not aircraft.preventive_due
            ):
                return now + 1
        return max(now + 1, min(deadlines))

    def _advance_stable_interval(self, skipped):
        for job in self.jobs:
            if job.state == "running":
                job.remaining -= skipped
        # Repeat the exact subtraction to retain IEEE-754 countdown state and
        # same-seed trajectories. No RNG calls occur in a stable interval.
        for aircraft in self.aircraft:
            if aircraft.state != "flying" or aircraft.in_flight_failure:
                continue
            for component in self.component_applicability_index.for_aircraft(aircraft):
                key = str(component.get("id") or "component")
                if key in aircraft.component_failure_minutes:
                    continue
                remaining = aircraft.lru_failure_remaining_minutes[key]
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
        if not self.running:
            return False
        target = self._next_wakeup()
        if self.use_simpy:
            self.env.run(until=self.env.timeout(target - self.env.now))
        skipped = target - self.minute - 1
        if skipped:
            self._advance_stable_interval(skipped)
        self.executed_ticks += 1
        return super().step()


class SimpyCalendarModel(CalendarModel):
    use_simpy = True
