"""AircraftAgent: Mesa agent carrying per-aircraft equipment state."""

from __future__ import annotations

from typing import Any

from mesa import Agent

from .equipment import EquipmentNode, build_equipment_tree


class AircraftAgent(Agent):
    """An aircraft with equipment tree, mission state, and history."""

    def __init__(
        self,
        model: "IndependentMesaModel",
        tail_number: str,
        aircraft_type: str,
        index: int,
        member_data: dict[str, Any],
        equipment_tree: dict[str, EquipmentNode],
    ) -> None:
        super().__init__(model)
        self.tail_number = tail_number
        self.aircraft_type = aircraft_type
        self.index = index
        self.remaining_life_hours = float(member_data.get("remainingLifeHours", 0))
        self.takeoff_landing_count = int(member_data.get("takeoffLandingCount", 0))
        self.deployment_location = str(member_data.get("deploymentLocation", ""))
        self.role = str(member_data.get("role", ""))
        self.status_label = str(member_data.get("status", "执行"))
        self.equipment_tree = equipment_tree
        self.phase = "idle"
        self.current_mission_id: int | None = None
        self.current_job_id: int | None = None
        self.scheduled_return_time: float | None = None
        self.failed_lru_id: str | None = None
        self.flight_hours_since_last_pm = 0.0
        self.days_since_last_pm = index * 0.15
        self.landings_since_last_pm = 0
        self.total_flight_hours = float(member_data.get("remainingLifeHours", 0))
        self.lru_failures = 0

    @property
    def is_mission_ready(self) -> bool:
        if self.phase != "ready":
            return False
        if self.failed_lru_id:
            return False
        if self.current_job_id is not None:
            return False
        for node in self.equipment_tree.values():
            if node.health == "failed":
                return False
        return True

    def get_failed_lrus(self) -> list[str]:
        return [n.id for n in self.equipment_tree.values() if n.health == "failed"]

    def restore_failed_lru(self, lru_id: str) -> None:
        if lru_id in self.equipment_tree:
            self.equipment_tree[lru_id].health = "healthy"
        self.failed_lru_id = None

    def equipment_snapshot(self) -> list[dict[str, Any]]:
        result = []
        for node in self.equipment_tree.values():
            if node.parent_id is None:
                result.append({
                    "id": node.id,
                    "name": node.name,
                    "health": node.health,
                    "accumulated_hours": round(node.accumulated_hours, 2),
                    "failure_count": node.failure_count,
                    "children": [
                        {
                            "id": child.id,
                            "name": child.name,
                            "health": child.health,
                            "accumulated_hours": round(child.accumulated_hours, 2),
                            "failure_count": child.failure_count,
                        }
                        for child in node.children
                    ],
                })
        return result
