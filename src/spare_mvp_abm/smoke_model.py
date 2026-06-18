"""Project-level Mesa smoke model for spare planning and mission reliability.

This is a runnable evidence scaffold, not the aviation support scenario package
runtime. It keeps ontology-derived structures visible while adding explicit
behavior rules for failure, spare consumption, repair, mission success, and
downtime attribution.
"""

from __future__ import annotations

import json
from pathlib import Path
import random
from typing import Any

try:  # Mesa is available when run through mesa-abm-skill's runner.
    import mesa
except ModuleNotFoundError:  # Keep local unit smoke tests possible without Mesa.
    mesa = None


BaseModel = mesa.Model if mesa is not None else object


class EquipmentState:
    def __init__(self, equipment_id: str, status: str = "ready") -> None:
        self.equipment_id = equipment_id
        self.status = status
        self.repair_remaining = 0
        self.sorties = 0
        self.failures = 0
        self.waiting_for_spares = False


class SmokeSpareMvpModel(BaseModel):
    """Minimal ABM driven by the frontend project data model."""

    def __init__(
        self,
        projectData: dict[str, Any] | None = None,
        projectJsonPath: str | None = None,
        activeModule: str | None = None,
        spareMultiplier: float = 1.0,
        failureRate: float | None = None,
        supportCapacity: int | None = None,
        minRequiredSorties: int | None = None,
        ontologyPath: str | None = None,
        seed: int | None = None,
    ) -> None:
        if mesa is not None:
            super().__init__(rng=seed)
        self.project_path = self._resolve_repo_path(projectJsonPath)
        self.project_data = self._load_project_data(projectData, self.project_path)
        self.ontology_path = self._resolve_ontology_path(ontologyPath)
        self.ontology = self._load_ontology(self.ontology_path)
        self._simulated_entity_type_ids = self._select_simulated_entity_types()
        self._simulated_relationship_ids = self._select_simulated_relationships()
        self.project_id = str(self.project_data.get("scenarioId", "frontend-project"))
        self.mode = str(activeModule or self.project_data.get("activeModule", "sparePlanning"))
        self.random = random.Random(seed)
        self.step_count = 0
        self.min_required_sorties = self._derive_min_required_sorties(minRequiredSorties)
        self.initial_spare_stock = self._derive_initial_spare_stock(spareMultiplier)
        self.spare_stock = int(self.initial_spare_stock)
        self.failure_rate = self._derive_failure_rate(failureRate)
        self.support_capacity = self._derive_support_capacity(supportCapacity)
        self.repair_duration = self._derive_repair_duration()
        self.sortie_duration = self._derive_sortie_duration()
        self.wave_interval = self._derive_wave_interval()
        self.equipment = self._derive_equipment()
        self.repair_queue: list[EquipmentState] = []
        self.event_count = 0
        self.spare_demands = 0
        self.spare_fills = 0
        self.shortage_events = 0
        self.sortie_attempts = 0
        self.successful_sorties = 0
        self.mission_checks = 0
        self.mission_successes = 0
        self.downtime_failure_events = 0
        self.downtime_spare_shortage_events = 0
        self.downtime_resource_delay_events = 0
        self.launch_times: list[int] = []
        self.recovery_times: list[int] = []
        self.turnaround_times: list[int] = []

    def _resolve_repo_path(self, path: str | None) -> Path | None:
        if path:
            candidate = Path(path)
            if candidate.is_absolute():
                return candidate
            cwd_candidate = Path.cwd() / candidate
            if cwd_candidate.exists():
                return cwd_candidate
            return Path(__file__).resolve().parents[2] / candidate
        return None

    def _resolve_ontology_path(self, ontology_path: str | None) -> Path | None:
        explicit = self._resolve_repo_path(ontology_path)
        if explicit is not None:
            return explicit
        default_path = Path(__file__).resolve().parents[2] / "ontology" / "spare_mvp.ontology.json"
        return default_path if default_path.exists() else None

    def _load_project_data(self, project_data: dict[str, Any] | None, project_path: Path | None) -> dict[str, Any]:
        if project_data is not None:
            return dict(project_data)
        if project_path is None:
            raise ValueError("SmokeSpareMvpModel requires frontend projectData or projectJsonPath")
        return json.loads(project_path.read_text(encoding="utf-8"))

    def _load_ontology(self, ontology_path: Path | None) -> dict[str, Any]:
        if ontology_path is None:
            return {"entityTypes": [], "relationships": [], "bindings": [], "metadata": {}}
        return json.loads(ontology_path.read_text(encoding="utf-8"))

    def _derive_equipment(self) -> list[EquipmentState]:
        equipment_data = self.project_data.get("equipment", {})
        members = self.project_data.get("combatUnit", {}).get("members", [])
        count = self._positive_int(equipment_data.get("quantity"), len(members) or 1)
        initial_ready = self._positive_int(
            equipment_data.get("initialReady"),
            sum(1 for member in members if str(member.get("status", "")) not in {"停用", "故障", "维修"}),
        )
        initial_ready = max(0, min(initial_ready, count))
        equipment = []
        for index in range(count):
            member = members[index] if index < len(members) else {}
            equipment_id = str(member.get("aircraftNo") or f"EQ-{index + 1:02d}")
            status = "ready" if index < initial_ready else "idle"
            equipment.append(EquipmentState(equipment_id, status=status))
        return equipment

    def _derive_min_required_sorties(self, override: int | None) -> int:
        if override is not None:
            return self._positive_int(override, 1)
        basic_mission = self.project_data.get("basicMission", {})
        equipment = self.project_data.get("equipment", {})
        combat_unit = self.project_data.get("combatUnit", {})
        return self._positive_int(
            basic_mission.get("minRequiredSorties")
            or equipment.get("minRequiredSorties")
            or combat_unit.get("requiredCount"),
            1,
        )

    def _derive_initial_spare_stock(self, spare_multiplier: float) -> int:
        support_nodes = self.project_data.get("supportNodes", [])
        inventory = support_nodes[0].get("inventory", {}) if support_nodes else {}
        scaled = [
            max(0, round(float(value) * float(spare_multiplier)))
            for value in inventory.values()
            if self._is_number(value)
        ]
        return int(sum(scaled))

    def _derive_failure_rate(self, override: float | None) -> float:
        if override is not None:
            return max(0.0, float(override))
        rates = [
            float(component.get("failureRate"))
            for component in self.project_data.get("components", [])
            if self._is_number(component.get("failureRate"))
        ]
        if not rates:
            rates = [
                float(node.get("failureRate"))
                for node in self.project_data.get("reliabilityBlockDiagram", {}).get("nodes", [])
                if node.get("type") == "component" and self._is_number(node.get("failureRate"))
            ]
        return sum(rates) / len(rates) if rates else 0.05

    def _derive_support_capacity(self, override: int | None) -> int:
        if override is not None:
            return self._positive_int(override, 1)
        support_nodes = self.project_data.get("supportNodes", [])
        capacity = support_nodes[0].get("equipmentCapacity") if support_nodes else None
        return self._positive_int(capacity, 1)

    def _derive_repair_duration(self) -> int:
        for activity in self.project_data.get("supportActivities", []):
            if "修复" in str(activity.get("activityType", "")) or str(activity.get("id", "")) == "corrective":
                return self._positive_int(activity.get("durationHours"), 1)
        return 3

    def _derive_sortie_duration(self) -> int:
        basic_mission = self.project_data.get("basicMission", {})
        minutes = basic_mission.get("taskDurationMinutes")
        if self._is_number(minutes):
            return max(1, round(float(minutes) / 60))
        for phase in self.project_data.get("missionPhases", []):
            if str(phase.get("state", "")) == "sortie":
                return self._positive_int(phase.get("limitHours"), 1)
        return 3

    def _derive_wave_interval(self) -> int:
        mission_profile = self.project_data.get("missionProfile", {})
        return self._positive_int(mission_profile.get("repeatCycleHours"), 6)

    def _positive_int(self, value: Any, fallback: int) -> int:
        if not self._is_number(value):
            return int(fallback)
        return max(1, int(round(float(value))))

    def _is_number(self, value: Any) -> bool:
        try:
            float(value)
        except (TypeError, ValueError):
            return False
        return True

    def _ontology_entity_ids(self) -> set[str]:
        return {str(entity.get("id")) for entity in self.ontology.get("entityTypes", [])}

    def _ontology_relationship_ids(self) -> set[str]:
        return {str(relationship.get("id")) for relationship in self.ontology.get("relationships", [])}

    def _select_simulated_entity_types(self) -> list[str]:
        implemented = {
            "mission_profile",
            "basic_mission",
            "equipment",
            "component",
            "support_node",
            "support_activity",
        }
        return sorted(implemented & self._ontology_entity_ids())

    def _select_simulated_relationships(self) -> list[str]:
        implemented = {
            "mission_belongs_to_profile",
            "equipment_assigned_to_mission",
            "component_installed_on_equipment",
            "equipment_creates_support_activity",
            "activity_staged_at_node",
            "node_dispatches_activity",
            "activity_repairs_component",
            "activity_updates_inventory",
            "activity_changes_equipment_state",
        }
        return sorted(implemented & self._ontology_relationship_ids())

    def ontology_mapping(self) -> dict[str, Any]:
        """Return the explicit boundary between ontology structure and Mesa rules."""
        return {
            "development_mode": self.ontology.get("metadata", {}).get(
                "developmentMode", "Simulation-Contract-First Development"
            ),
            "ontology_path": str(self.ontology_path) if self.ontology_path else "",
            "project_path": str(self.project_path) if self.project_path else "",
            "project_id": self.project_id,
            "input_contract": "front/sim-engine.mjs defaultScenario",
            "simulated_entity_types": list(self._simulated_entity_type_ids),
            "simulated_relationships": list(self._simulated_relationship_ids),
            "added_behavior_rules": [
                "seeded equipment failure events",
                "spare stock consumption and shortage accounting",
                "resource-constrained repair queue",
                "mission success checks over sortie demand",
                "downtime attribution by failure, spare shortage, and resource delay",
            ],
        }

    def step(self) -> None:
        self.step_count += 1
        ready = [item for item in self.equipment if item.status == "ready"]
        preparing = [item for item in self.equipment if item.status == "preparing"]
        sortie = [item for item in self.equipment if item.status == "sortie"]

        if (self.step_count - 1) % self.wave_interval == 0:
            demand = min(len(ready), self.min_required_sorties)
            self.sortie_attempts += self.min_required_sorties
            for item in ready[:demand]:
                item.status = "preparing"
                item.repair_remaining = 1
            self.launch_times.append(1 + max(0, self.min_required_sorties - demand))

        for item in preparing:
            item.repair_remaining -= 1
            if item.repair_remaining <= 0:
                item.status = "sortie"
                item.repair_remaining = self.sortie_duration
                item.sorties += 1
                self.successful_sorties += 1

        for item in sortie:
            if self.random.random() < self.failure_rate:
                self._fail_equipment(item)
                continue
            item.repair_remaining -= 1
            if item.repair_remaining <= 0:
                item.status = "ready"
                self.recovery_times.append(self.sortie_duration)
                self.turnaround_times.append(self.sortie_duration + 1)

        self._process_repairs()

        if self.step_count % self.wave_interval == 0:
            self.mission_checks += 1
            if self.successful_sorties >= self.mission_checks * self.min_required_sorties:
                self.mission_successes += 1

    def _fail_equipment(self, item: EquipmentState) -> None:
        item.status = "failed"
        item.failures += 1
        item.waiting_for_spares = False
        self.downtime_failure_events += 1
        self.repair_queue.append(item)

    def _process_repairs(self) -> None:
        active = [item for item in self.equipment if item.status == "repairing"]
        for item in active:
            item.repair_remaining -= 1
            if item.repair_remaining <= 0:
                item.status = "ready"
                item.waiting_for_spares = False

        open_capacity = max(0, self.support_capacity - len([item for item in self.equipment if item.status == "repairing"]))
        remaining_queue = []
        for item in self.repair_queue:
            if open_capacity <= 0:
                self.downtime_resource_delay_events += 1
                remaining_queue.append(item)
                continue
            self.spare_demands += 1
            if self.spare_stock > 0:
                self.spare_stock -= 1
                self.spare_fills += 1
                item.status = "repairing"
                item.repair_remaining = self.repair_duration
                item.waiting_for_spares = False
                open_capacity -= 1
            else:
                self.shortage_events += 1
                self.downtime_spare_shortage_events += 1
                item.waiting_for_spares = True
                remaining_queue.append(item)
        self.repair_queue = remaining_queue

    def snapshot(self) -> dict[str, float]:
        total = len(self.equipment) or 1
        ready = sum(1 for item in self.equipment if item.status == "ready")
        repairing = sum(1 for item in self.equipment if item.status == "repairing")
        failed = sum(1 for item in self.equipment if item.status == "failed")
        in_sortie = sum(1 for item in self.equipment if item.status == "sortie")
        used_spares = self.initial_spare_stock - self.spare_stock
        return {
            "ready_rate": ready / total,
            "mission_success_rate": self.mission_successes / max(1, self.mission_checks),
            "sortie_rate": self.successful_sorties / max(1, self.sortie_attempts),
            "spare_fill_rate": self.spare_fills / max(1, self.spare_demands),
            "spare_utilization": used_spares / max(1, self.initial_spare_stock),
            "shortage_events": float(self.shortage_events),
            "repair_backlog": float(len(self.repair_queue)),
            "repairing_count": float(repairing),
            "failed_count": float(failed),
            "sortie_count": float(in_sortie),
            "mean_launch_time": sum(self.launch_times) / max(1, len(self.launch_times)),
            "mean_recovery_time": sum(self.recovery_times) / max(1, len(self.recovery_times)),
            "mean_turnaround_time": sum(self.turnaround_times) / max(1, len(self.turnaround_times)),
            "downtime_failure_events": float(self.downtime_failure_events),
            "downtime_spare_shortage_events": float(self.downtime_spare_shortage_events),
            "downtime_resource_delay_events": float(self.downtime_resource_delay_events),
            "ontology_entity_types": float(len(self.ontology.get("entityTypes", []))),
            "ontology_relationships": float(len(self.ontology.get("relationships", []))),
            "ontology_bound_entities": float(
                len({binding.get("boundEntityId") for binding in self.ontology.get("bindings", [])})
            ),
            "ontology_simulated_entity_types": float(len(self._simulated_entity_type_ids)),
            "ontology_simulated_relationships": float(len(self._simulated_relationship_ids)),
        }
