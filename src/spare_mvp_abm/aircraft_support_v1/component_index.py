"""Static aircraft/component compatibility indexes.

Project compilation has already canonicalized component fields before this
module sees them.  The index therefore prepares immutable runtime lookup data;
it does not compile or reinterpret Project JSON.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Iterable

from .state import AircraftState


def aircraft_type_tokens(value: Any) -> frozenset[str]:
    """Return canonical tokens while accepting legacy non-string values."""
    if value in (None, ""):
        return frozenset()
    return _cached_aircraft_type_tokens(str(value))


@lru_cache(maxsize=512)
def _cached_aircraft_type_tokens(value: str) -> frozenset[str]:
    text = value.upper()
    for separator in ("、", "，", ",", "/", "\\", "|", ";", "；", "&"):
        text = text.replace(separator, " ")
    for word_separator in (" OR ", " 或 ", " 和 "):
        text = text.replace(word_separator, " ")
    return frozenset(
        canonical
        for part in text.split()
        if (canonical := "".join(character for character in part if character.isalnum()))
    )


# Keep cache controls on the public helper for diagnostics and regression tests.
aircraft_type_tokens.cache_clear = _cached_aircraft_type_tokens.cache_clear  # type: ignore[attr-defined]
aircraft_type_tokens.cache_info = _cached_aircraft_type_tokens.cache_info  # type: ignore[attr-defined]


def component_applies_to_aircraft(component: dict[str, Any], aircraft: AircraftState) -> bool:
    component_models = aircraft_type_tokens(component.get("aircraft_model"))
    if not component_models:
        return True
    aircraft_models = aircraft_type_tokens(aircraft.aircraft_type) | aircraft_type_tokens(aircraft.model)
    return bool(component_models & aircraft_models)


class ComponentApplicabilityIndex:
    """Precompute the stable component scope for every initialized aircraft."""

    def __init__(
        self,
        components: Iterable[dict[str, Any]],
        aircraft: Iterable[AircraftState],
    ) -> None:
        component_rows = tuple(components)
        self._by_tail_number = {
            item.tail_number: tuple(
                component
                for component in component_rows
                if component_applies_to_aircraft(component, item)
            )
            for item in aircraft
        }
        self._component_object_ids_by_tail_number = {
            tail_number: frozenset(id(component) for component in components_for_aircraft)
            for tail_number, components_for_aircraft in self._by_tail_number.items()
        }

    def for_aircraft(self, aircraft: AircraftState) -> tuple[dict[str, Any], ...]:
        return self._by_tail_number.get(aircraft.tail_number, ())

    def contains(self, aircraft: AircraftState, component: dict[str, Any]) -> bool:
        return id(component) in self._component_object_ids_by_tail_number.get(aircraft.tail_number, ())


__all__ = [
    "ComponentApplicabilityIndex",
    "aircraft_type_tokens",
    "component_applies_to_aircraft",
]
