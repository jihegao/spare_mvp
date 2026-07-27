"""Failure-timer execution for aircraft-support v1.

The mixin owns runtime failure countdown and propagation entry points.  It
expects the facade to provide event, mission-return, maintenance, and failure
tree helpers; keeping those calls explicit preserves the historical step and
RNG order while the surrounding domains are extracted independently.
"""

from __future__ import annotations

import math
from typing import Any

from .component_index import component_applies_to_aircraft
from .runtime_utils import _non_negative_float
from .state import AircraftState


class FailureEngineMixin:
    """Failure behavior mixed into :class:`AircraftSupportV1Model`."""

    aircraft: list[AircraftState]
    components: list[dict[str, Any]]
    tick_minutes: int

    def _initialize_aircraft_lru_failure_timers(self) -> None:
        for aircraft in self.aircraft:
            timers: dict[str, float] = {}
            # Preserve the historical RNG draw order: every behavior component
            # draws before applicability is checked, even when its timer is not
            # retained for this aircraft.
            for component in self.components:
                sampled_minutes = self._sample_lru_failure_minutes(component)
                if self.component_applicability_index.contains(aircraft, component):
                    timers[str(component.get("id") or "component")] = sampled_minutes
            aircraft.lru_failure_remaining_minutes = timers

    def _sample_lru_failure_minutes(self, component: dict[str, Any]) -> float:
        hourly_rate = _non_negative_float(component.get("failure_rate"), 0.0)
        samples: list[float] = []
        quantity = max(1, int(component.get("quantity") or 1))
        if hourly_rate > 0:
            samples.extend(self.rng.expovariate(hourly_rate) * 60.0 for _ in range(quantity))
        return min(samples) if samples else math.inf

    def _evaluate_failures(self) -> None:
        if not self.components:
            return
        for aircraft in self.aircraft:
            if aircraft.state != "flying":
                continue
            if aircraft.in_flight_failure:
                continue
            for component in self.component_applicability_index.for_aircraft(aircraft):
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
                    self._event(
                        "component_failed",
                        f"{aircraft.tail_number} failed {component.get('name') or component.get('id')}",
                    )
                    if self._aircraft_failure_tree_root_failed(aircraft):
                        aircraft.failed_component_id = component_id
                        aircraft.failed_component_minute = self.minute
                        self.failure_delay_events += 1
                        aircraft.in_flight_failure = True
                        self.in_flight_failures += 1
                        self._event(
                            "aircraft_failed",
                            f"{aircraft.tail_number} failure propagated to whole aircraft",
                        )
                        self._return_aircraft_from_mission(aircraft, early_return=True)
                        break

    def _component_applies_to_aircraft(self, component: dict[str, Any], item: AircraftState) -> bool:
        return component_applies_to_aircraft(component, item)


__all__ = ["FailureEngineMixin"]
