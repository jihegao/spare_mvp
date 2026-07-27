"""Mutable runtime state records for the aircraft-support v1 simulation."""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any


@dataclass
class AircraftState:
    tail_number: str
    aircraft_type: str
    state: str
    x: int
    y: int
    model: str = ""
    airport: str = ""
    airport_id: str = ""
    current_mission_id: str | None = None
    return_time: int | None = None
    failed_component_id: str | None = None
    failed_component_minute: int | None = None
    component_failure_minutes: dict[str, int] = field(default_factory=dict)
    flight_hours: float = 0.0
    takeoff_count: int = 0
    landing_count: int = 0
    postflight_required: bool = False
    preventive_due: bool = False
    in_flight_failure: bool = False
    last_preventive_minute: int = 0
    prepared_mission_ids: set[str] = field(default_factory=set)
    lru_failure_remaining_minutes: dict[str, float] = field(default_factory=dict)
    initial_life_state: dict[str, int | float] = field(default_factory=dict)
    preventive_thresholds: dict[str, int | float] = field(default_factory=dict)
    preventive_threshold_sources: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    preventive_cycles: dict[str, dict[str, Any]] = field(default_factory=dict)
    initial_due_dimensions: list[str] = field(default_factory=list)
    preventive_due_dimensions: list[str] = field(default_factory=list)
    source_initial_state: str = "available"
    initial_preventive_due: bool = False


@dataclass
class MissionState:
    mission_id: str
    name: str
    planned_start: int
    preparation_start: int
    duration_minutes: int
    required_aircraft: int
    min_required_aircraft: int
    priority: int
    cancel_minutes: int
    success_point: float = 1.0
    status: str = "scheduled"
    actual_start: int | None = None
    return_time: int | None = None
    assigned_tail_numbers: list[str] = field(default_factory=list)
    preflight_created: bool = False
    delay_minutes: int = 0
    task_category: str = "basic"
    periodic_task_id: str = ""
    periodic_task_name: str = ""
    composite_task_id: str = ""
    composite_task_name: str = ""
    basic_task_id: str = ""
    basic_task_name: str = ""
    required_aircraft_type: str = ""
    support_activity_name: str = ""
    group_name: str = ""
    wave_index: int = 1
    day_index: int = 1
    failed_tail_numbers: list[str] = field(default_factory=list)
    success_evaluated: bool = False
    success_member_count: int = 0
    success_at_minute: int | None = None
    succeeded: bool = False

    @property
    def success_minute(self) -> int:
        """Task-success checkpoint, anchored to the actual task start when launched."""
        start = self.actual_start if self.actual_start is not None else self.planned_start
        return start + math.ceil(self.duration_minutes * self.success_point)


@dataclass
class JobState:
    job_id: str
    tail_number: str
    kind: str
    activity_id: str
    activity_name: str
    tasks: list[dict[str, Any]]
    priority: int
    resource_node_id: str
    mission_id: str | None = None
    component_id: str | None = None
    task_index: int = 0
    state: str = "waiting"
    remaining: int = 0
    started_time: int | None = None
    completed_time: int | None = None
    shortage_reason: str | None = None
    maintenance_method: str | None = None
    replacement_ratio: float | None = None
    maintenance_decision_roll: float | None = None
    maintenance_rng_stream: str | None = None
    maintenance_occurrence: int | None = None
    consumed_spare_task_indexes: set[int] = field(default_factory=set)
    spare_shortage_signature: tuple[tuple[str, int, int, str], ...] | None = None
    due_dimensions: list[str] = field(default_factory=list)
    resource_reservations: dict[str, tuple[str, int]] = field(default_factory=dict)
    remote_resources_pending: set[str] = field(default_factory=set)
    spare_reservations: dict[tuple[int, str], int] = field(default_factory=dict)
    spare_reservation_supply_modes: dict[tuple[int, str], set[str]] = field(default_factory=dict)

    @property
    def current_task(self) -> dict[str, Any] | None:
        if self.task_index >= len(self.tasks):
            return None
        return self.tasks[self.task_index]


@dataclass
class TransportShipment:
    source_node_id: str
    destination_node_id: str
    spare_type: str
    quantity: int
    requested_minute: int
    arrival_minute: int
    job_id: str = ""
    task_index: int = 0
    path_organization_node_ids: tuple[str, ...] = ()
    transport_policy_ids: tuple[str, ...] = ()
    batch_sequence: int = 1
    supply_mode: str = "legacy"
    relation_id: str = ""


@dataclass
class ResourceTransit:
    job_id: str
    task_index: int
    resource_kind: str
    quantity: int
    source_node_id: str
    destination_node_id: str
    requested_minute: int
    arrival_minute: int
    path_organization_node_ids: tuple[str, ...]
    transport_policy_ids: tuple[str, ...]
    batch_sequence: int = 1
    supply_mode: str = "legacy"
    relation_id: str = ""


__all__ = [
    "AircraftState",
    "JobState",
    "MissionState",
    "ResourceTransit",
    "TransportShipment",
]
