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
    record_rng_requests: bool
    sample_requests: list[dict[str, Any]]
    _component_source_paths: dict[str, str]

    def _initialize_aircraft_lru_failure_timers(self) -> None:
        for aircraft in self.aircraft:
            timers: dict[str, float] = {}
            # Preserve the historical RNG draw order: every behavior component
            # draws before applicability is checked, even when its timer is not
            # retained for this aircraft.
            for component in self.components:
                sampled_minutes = self._sample_lru_failure_minutes(
                    component,
                    aircraft=aircraft,
                    phase="initialize",
                    reason="initialize",
                )
                if self.component_applicability_index.contains(aircraft, component):
                    timers[str(component.get("id") or "component")] = sampled_minutes
            aircraft.lru_failure_remaining_minutes = timers

    def _sample_lru_failure_minutes(
        self,
        component: dict[str, Any],
        *,
        aircraft: AircraftState,
        phase: str,
        reason: str,
    ) -> float:
        hourly_rate = _non_negative_float(component.get("failure_rate"), 0.0)
        samples: list[float] = []
        quantity = max(1, int(component.get("quantity") or 1))
        if hourly_rate > 0:
            for quantity_index in range(quantity):
                # Keep this as the only RNG call in the loop. Recording must
                # observe the historical value, never draw another sample.
                value_minutes = self.rng.expovariate(hourly_rate) * 60.0
                samples.append(value_minutes)
                if self.record_rng_requests:
                    component_id = str(component.get("id") or "component")
                    source_path = self._component_source_paths.get(component_id)
                    if source_path is None:
                        raise ValueError(f"missing canonical source path for component {component_id}")
                    self.sample_requests.append({
                        "sequence": len(self.sample_requests) + 1,
                        "time": self.minute,
                        "phase": phase,
                        "stream": "legacy-sequential-v1",
                        "distribution": "exponential",
                        "entity": aircraft.tail_number,
                        "component_id": component_id,
                        "quantity_index": quantity_index,
                        "rate_per_hour": hourly_rate,
                        "value_minutes": value_minutes,
                        "reason": reason,
                        "source_path": source_path,
                    })
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
                    remaining = self._sample_lru_failure_minutes(
                        component,
                        aircraft=aircraft,
                        phase="failures",
                        reason="missing_timer",
                    )
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
