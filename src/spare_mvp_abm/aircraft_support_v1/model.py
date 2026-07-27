"""Aircraft support v1 runtime core.

The model uses deterministic minute ticks and declares the M9.7.4 field
coverage boundary through ``behavior_scope()``.
"""

from __future__ import annotations

import copy
import random
from typing import Any

from src.spare_mvp_abm.aircraft_support_v1.component_index import (
    ComponentApplicabilityIndex,
)
from src.spare_mvp_abm.aircraft_support_v1.failure_engine import FailureEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.maintenance_engine import MaintenanceEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.metrics_engine import MetricsEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.mission_engine import MissionEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.model_builders import ModelBuilderMixin
from src.spare_mvp_abm.aircraft_support_v1.support_engine import SupportEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.telemetry import TelemetryMixin
from src.spare_mvp_abm.aircraft_support_v1.transport_engine import TransportEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.runtime_utils import (
    _normalized_stop_policy,
    _positive_int,
    _resource_quantity,
    _truthy_input_flag,
)
from src.spare_mvp_abm.aircraft_support_v1.organization_observability import (
    organization_dispatch_summary,
    organization_graph_identity,
)
from src.spare_mvp_abm.aircraft_support_v1.state import (
    AircraftState,
    JobState,
    MissionState,
    ResourceTransit,
    TransportShipment,
)


BEHAVIOR_DRIVING_FIELDS = [
    "combatUnit.members",
    "combatUnit.members[].preLifeCalendarDays",
    "combatUnit.members[].preLifeFlightHours",
    "combatUnit.members[].preLifeTakeoffLandingCount",
    "missionProfile.combatUnit.members",
    "missionProfile.combatUnit.members[].preLifeCalendarDays",
    "missionProfile.combatUnit.members[].preLifeFlightHours",
    "missionProfile.combatUnit.members[].preLifeTakeoffLandingCount",
    "missionProfile.durationHours",
    "missionProfile.compositeTasks",
    "missionProfile.periodicTasks",
    "basicMissions",
    "basicMissions[].missionPhases",
    "airports",
    "products[]",
    "components[].productId",
    "components[].aircraftModel",
    "components[].failureDistribution",
    "components[].kOutOfN",
    "components[].specialRepairProfile",
    "supportResources[].quantity",
    "supportResources[].type",
    "supportResources[].productId",
    "supportResources[].supportNodeName",
    "transportPolicies[]",
    "support_network.nodes[].organization_node_id",
    "support_network.organization_graph.nodes[]",
    "support_network.organization_graph.runtime_mode",
    "support_network.organization_graph.parent_edges[]",
    "support_network.organization_graph.lateral_edges[]",
    "support_network.organization_graph.transport_policies[]",
    "supportActivityJobs[]",
    "supportActivities[].aircraftModel",
    "supportActivities[].equipmentId",
    "supportActivities[].calendarDayInterval",
    "supportActivities[].runHourInterval",
    "supportActivities[].takeoffLandingInterval",
    "supportActivities[].activityCodes",
    "supportActivities[].predecessors",
    "supportActivities[].maintenanceMethods",
    "supportActivities[].replacementRatio",
    "experiment.seed",
    "experiment.samples",
    "ExperimentPlan.config.stopPolicy",
    "monteCarlo.failureRates",
    "monteCarlo.spareMultipliers",
    "monteCarlo.supportCapacities",
]

FAIL_CLOSED_FIELDS: list[str] = [
    "combatUnit.members[].preLifeCalendarDays",
    "combatUnit.members[].preLifeFlightHours",
    "combatUnit.members[].preLifeTakeoffLandingCount",
    "supportActivities[].aircraftModel",
    "supportActivities[].equipmentId",
    "supportActivities[].calendarDayInterval",
    "supportActivities[].runHourInterval",
    "supportActivities[].takeoffLandingInterval",
    "support_network.nodes[].organization_node_id",
    "support_network.organization_graph.nodes[]",
    "support_network.organization_graph.runtime_mode",
    "support_network.organization_graph.parent_edges[]",
    "support_network.organization_graph.lateral_edges[]",
    "support_network.organization_graph.transport_policies[]",
]

M9_7_4_COVERAGE_HARDENING_FIELDS: list[str] = []


class AircraftSupportV1Model(
    FailureEngineMixin,
    MissionEngineMixin,
    MaintenanceEngineMixin,
    SupportEngineMixin,
    TransportEngineMixin,
    MetricsEngineMixin,
    TelemetryMixin,
    ModelBuilderMixin,
):
    """Deterministic minute-tick aircraft support simulation."""

    def __init__(self, inputs: dict[str, Any]):
        self.inputs = copy.deepcopy(inputs)
        self.seed = int(self.inputs.get("seed", 0))
        self.rng = random.Random(self.seed)
        self.write_event_snapshots = _truthy_input_flag(
            self.inputs.get("write_event_snapshots")
            or self.inputs.get("writeEventSnapshots")
            or self.inputs.get("capture_event_snapshots")
        )
        self.event_snapshot_limit = _positive_int(
            self.inputs.get("event_snapshot_limit") or self.inputs.get("eventSnapshotLimit"),
            20,
        )
        self._event_snapshot_count = 0
        time_config = self.inputs.get("time", {})
        self.disable_visualization_frames = _truthy_input_flag(
            self.inputs.get("disable_visualization_frames")
            or self.inputs.get("disableVisualizationFrames")
            or time_config.get("disable_visualization_frames")
        )
        self.duration_minutes = int(time_config.get("duration_minutes", 1440))
        self.tick_minutes = int(time_config.get("tick_minutes", 1))
        self.sample_every_minutes = int(time_config.get("sample_every_minutes", 30))
        self.max_state_frames_single = int(time_config.get("max_state_frames_single", 2000))
        self.stop_policy = _normalized_stop_policy(self.inputs.get("stop_policy"), self.duration_minutes)
        self.stop_reason = ""
        self.stop_conditions_met: list[str] = []
        self.minute = 0
        self.time = 0
        self.event_log: list[dict[str, Any]] = []
        self.aircraft = self._build_aircraft()
        self.equipment_tree_components = self._equipment_tree_components()
        self.components = self._behavior_components()
        self.component_applicability_index = ComponentApplicabilityIndex(self.components, self.aircraft)
        self._initialize_aircraft_lru_failure_timers()
        self.nodes = self._build_support_nodes()
        self._initialize_organization_graph()
        self.organization_graph_identity = organization_graph_identity(
            self.inputs.get("support_network", {}).get("organization_graph")
        )
        self.activities = self._build_activities()
        self.mission_context = self._mission_context()
        self.preflight_activity = self._select_activity("preflight")
        self.repair_activity = self._select_activity("repair")
        self.postflight_activity = self._select_activity("postflight")
        self.preventive_activity = self._select_activity("preventive")
        self.missions = self._build_missions()
        self.jobs: list[JobState] = []
        self.transport_shipments: list[TransportShipment] = []
        self.resource_transits: list[ResourceTransit] = []
        self._transport_shipment_keys: set[tuple[str, int, str, tuple[str, ...], int]] = set()
        self._transport_batch_counts: dict[tuple[str, int, str], int] = {}
        self._organization_fact_keys: set[tuple[Any, ...]] = set()
        self._mission_scheduling_fact_keys: set[tuple[Any, ...]] = set()
        self._organization_event_sequence = 0
        self._job_sequence = 0
        self._maintenance_occurrence_by_kind = {"repair": 0, "preventive": 0}
        self.completed_sorties = 0
        self.failed_sorties = 0
        self.launched_sorties = 0
        self.cancelled_sorties = 0
        self.delayed_sorties = 0
        self._delayed_mission_ids: set[str] = set()
        self.total_departure_delay = 0
        self.total_transport_delay = 0
        self.lru_failures = 0
        self.in_flight_failures = 0
        self.spare_consumed_total = 0
        self.shortage_events = 0
        self.transport_replenishment_events = 0
        self.resource_delay_events = 0
        self.equipment_shortage_events = 0
        self.preventive_maintenance_events = 0
        self.downtime_minutes = {"failure": 0.0, "equipment_shortage": 0.0, "spare_shortage": 0.0, "preventive": 0.0}
        self.downtime_events: list[dict[str, Any]] = []
        self._active_downtime_events: dict[str, dict[str, Any]] = {}
        self._downtime_event_sequence = 0
        self.failure_delay_events = 0
        self.daily_readiness_samples: list[dict[str, Any]] = []
        self._daily_readiness_sample_days: set[int] = set()
        self.operational_availability_sample_interval_minutes = 60
        self._next_operational_availability_sample_minute = 60
        self.operational_availability_sample_count = 0
        self.available_aircraft_hours = 0
        self.total_aircraft_hours = 0
        self.running = True
        self.steps = 0
        # Pre-life is an initial condition, so an already-due aircraft must be
        # unavailable in the minute-zero frame rather than waiting for step 1.
        self._initialize_preventive_lifecycle()
        self._generate_preventive_jobs()

    @staticmethod
    def behavior_scope() -> dict[str, list[str]]:
        return {
            "behavior_driving_fields": list(BEHAVIOR_DRIVING_FIELDS),
            "fail_closed_fields": list(FAIL_CLOSED_FIELDS),
            "m9_7_4_coverage_hardening_fields": list(M9_7_4_COVERAGE_HARDENING_FIELDS),
        }

    def run(self) -> dict[str, Any]:
        frames = [] if self.disable_visualization_frames else [self.visualization_frame(run_id="", step=0)]
        while self.running:
            self.step()
            should_stop = not self.running
            if should_stop:
                self._finalize_unresolved_mission_successes()
            if not self.disable_visualization_frames and (
                self.minute % self.sample_every_minutes == 0 or self.minute == self.duration_minutes or should_stop
            ):
                frames.append(self.visualization_frame(run_id="", step=len(frames)))
                if len(frames) > self.max_state_frames_single:
                    raise ValueError(
                        "visualization_state_series exceeds max_state_frames_single; increase sample_every_minutes"
                    )
            if should_stop:
                break
        self._finalize_unresolved_mission_successes()
        self._close_all_downtime_events()
        return {
            "metrics": self.snapshot(),
            "frames": frames,
            "events": copy.deepcopy(self.event_log),
            "organization_graph_identity": copy.deepcopy(self.organization_graph_identity),
            "organization_dispatch_summary": organization_dispatch_summary(
                self.event_log,
                identity=self.organization_graph_identity,
            ),
            "downtime_events": copy.deepcopy(self.downtime_events),
            "lifecycle_trace": [self._lifecycle_trace_payload(item) for item in self.aircraft],
        }

    def step(self) -> bool:
        """Advance the model by one runtime tick for Solara/Mesa controls."""
        if not self.running:
            return False
        self.minute = 1 if self.minute <= 0 else min(self.duration_minutes, self.minute + self.tick_minutes)
        self.time = self.minute
        self.steps += 1
        try:
            self._process_transport_arrivals()
            self._process_mission_returns()
            self._process_job_progress_and_completions()
            self._evaluate_failures()
            self._generate_preventive_jobs()
            self._create_due_preflight_jobs()
            self._start_waiting_jobs()
            self._dispatch_due_missions()
            self._evaluate_mission_success_points()
            self._record_daily_readiness_sample_if_due()
            self._record_operational_availability_sample_if_due()
            self._record_downtime_minutes()
            stop_reason, stop_conditions = self._stop_decision()
            should_stop = bool(stop_reason)
            if should_stop:
                self.stop_reason = stop_reason
                self.stop_conditions_met = stop_conditions
                self._event(
                    "simulation_stopped",
                    f"simulation stopped by {stop_reason}",
                    {"reason": stop_reason, "conditions": stop_conditions},
                )
            if should_stop or self.minute >= self.duration_minutes:
                self.running = False
            return True
        except Exception:
            self.running = False
            raise
