"""Telemetry behavior for aircraft-support v1."""

from __future__ import annotations

import copy
from typing import Any

from .organization_observability import (
    normalize_organization_event,
    organization_dispatch_summary,
)
from .state import AircraftState, JobState, MissionState

class TelemetryMixin:


    def visualization_frame(self, *, run_id: str, step: int) -> dict[str, Any]:
        metrics = self.snapshot()
        return {
            "run_id": run_id,
            "step": step,
            "simulation_time": self.minute,
            "aircraft_state": {
                "ready_rate": metrics["ready_rate"],
                "operational_availability": metrics["operational_availability"],
                "operational_availability_sample_count": metrics["operational_availability_sample_count"],
                "available_aircraft_hours": metrics["available_aircraft_hours"],
                "total_aircraft_hours": metrics["total_aircraft_hours"],
                "failed_count": metrics["failed_count"],
                "repairing_count": metrics["repairing_count"],
                "sortie_count": metrics["sortie_count"],
                "postflight_count": metrics["postflight_count"],
                "preventive_count": metrics["preventive_count"],
            },
            "mission_state": {
                "mission_success_rate": metrics["mission_success_rate"],
                "sortie_rate": metrics["sortie_rate"],
                "mean_launch_time": metrics["mean_launch_time"],
                "mean_recovery_time": metrics["mean_recovery_time"],
                "mean_turnaround_time": metrics["mean_turnaround_time"],
            },
            "resource_state": {
                "spare_fill_rate": metrics["spare_fill_rate"],
                "spare_utilization": metrics["spare_utilization"],
                "repair_backlog": metrics["repair_backlog"],
                "postflight_backlog": metrics["postflight_backlog"],
                "preventive_backlog": metrics["preventive_backlog"],
            },
            "event_summary": {
                "shortage_events": metrics["shortage_events"],
                "downtime_failure_events": metrics["downtime_failure_events"],
                "downtime_spare_shortage_events": metrics["downtime_spare_shortage_events"],
                "downtime_resource_delay_events": metrics["downtime_resource_delay_events"],
                "downtime_equipment_shortage_events": metrics["downtime_equipment_shortage_events"],
                "downtime_failure_hours": metrics["downtime_failure_hours"],
                "downtime_equipment_shortage_hours": metrics["downtime_equipment_shortage_hours"],
                "downtime_spare_shortage_hours": metrics["downtime_spare_shortage_hours"],
                "downtime_preventive_hours": metrics["downtime_preventive_hours"],
            },
            "organization_graph_identity": copy.deepcopy(self.organization_graph_identity),
            "organization_dispatch_summary": organization_dispatch_summary(
                self.event_log,
                identity=self.organization_graph_identity,
            ),
            "aircraft": [self._aircraft_payload(item) for item in self.aircraft],
            "missions": [self._mission_payload(item) for item in self.missions],
            "resources": [self._resource_payload(item) for item in self.nodes.values()],
            "spares": self._spares_payload(),
            "jobs": [
                self._job_payload(job)
                for job in self.jobs
                if job.state in {"waiting", "running"}
            ],
            "events": self._events_for_frame(),
        }

    def _activity_by_id(self, activity_id: str) -> dict[str, Any]:
        return next((item for item in self.activities if str(item.get("id")) == str(activity_id)), {})

    def _mission_by_id(self, mission_id: str | None) -> MissionState | None:
        if mission_id is None:
            return None
        return next((item for item in self.missions if item.mission_id == mission_id), None)

    def _component_by_id(self, component_id: str | None) -> dict[str, Any] | None:
        if component_id is None:
            return None
        component = next(
            (item for item in self.components if str(item.get("id")) == str(component_id)),
            None,
        )
        if component is not None:
            return component
        return next(
            (
                item
                for item in self.equipment_tree_components
                if str(item.get("id")) == str(component_id)
            ),
            None,
        )

    def _mean_recovery_time(self) -> float:
        completed = [
            mission
            for mission in self.missions
            if mission.actual_start is not None and mission.return_time is not None
        ]
        if not completed:
            return 0.0
        return sum(float((mission.return_time or 0) - (mission.actual_start or 0)) for mission in completed) / len(completed)

    def _aircraft_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "type": item.aircraft_type,
            "state": item.state,
            "x": item.x,
            "y": item.y,
            "current_mission_id": item.current_mission_id,
            "failed_lru": item.failed_component_id or self._first_failed_component_id(item) or "",
            "flight_hours": item.flight_hours,
            "takeoff_count": item.takeoff_count,
            "landing_count": item.landing_count,
            "postflight_required": item.postflight_required,
            "preventive_due": item.preventive_due,
            "initial_life_state": copy.deepcopy(item.initial_life_state),
            "preventive_thresholds": copy.deepcopy(item.preventive_thresholds),
            "preventive_threshold_sources": copy.deepcopy(item.preventive_threshold_sources),
            "initial_due_dimensions": list(item.initial_due_dimensions),
            "due_dimensions": list(item.preventive_due_dimensions),
            "calendar_days": self._calendar_days_since_preventive(item),
            "in_flight_failure": item.in_flight_failure,
            "failure_tree": self._aircraft_failure_tree_payload(item),
        }

    def _calendar_days_since_preventive(self, item: AircraftState) -> float:
        return max(0.0, (self.minute - item.last_preventive_minute) / 1440.0)

    def _lifecycle_trace_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "initial_life_state": copy.deepcopy(item.initial_life_state),
            "preventive_thresholds": copy.deepcopy(item.preventive_thresholds),
            "preventive_threshold_sources": copy.deepcopy(item.preventive_threshold_sources),
            "initial_due_dimensions": list(item.initial_due_dimensions),
            "due_dimensions": list(item.preventive_due_dimensions),
            "current_life_state": {
                "calendar_days": self._calendar_days_since_preventive(item),
                "flight_hours": item.flight_hours,
                "takeoff_landing_cycles": item.landing_count,
            },
            "preventive_due": item.preventive_due,
        }

    def _aircraft_failure_tree_payload(self, item: AircraftState) -> dict[str, Any]:
        component_nodes = [
            copy.deepcopy(component)
            for component in self.equipment_tree_components
            if self._component_applies_to_aircraft(component, item)
        ]
        if not component_nodes:
            component_nodes = [copy.deepcopy(component) for component in self.equipment_tree_components]
        equipment_root_id = self._equipment_tree_root_id(component_nodes)
        node_ids = {str(component.get("id")) for component in component_nodes}
        direct_failed = {str(component_id) for component_id in item.component_failure_minutes}
        for failed_id in sorted(direct_failed - node_ids):
            failed_component = self._component_by_id(failed_id)
            if failed_component is None:
                continue
            component_nodes.append(
                {
                    "id": failed_id,
                    "name": str(failed_component.get("name") or failed_id),
                    "parent_id": str(failed_component.get("parent_id") or equipment_root_id),
                    "aircraft_model": item.aircraft_type,
                    "product_type": str(failed_component.get("product_type") or "LRU"),
                    "quantity": max(1, int(failed_component.get("quantity") or 1)),
                    "k_out_of_n": failed_component.get("k_out_of_n") if isinstance(failed_component.get("k_out_of_n"), dict) else {},
                }
            )
            node_ids.add(failed_id)
        whole_aircraft_root_id = self._whole_aircraft_root_id(node_ids | {equipment_root_id})
        if equipment_root_id not in node_ids:
            component_nodes.append(
                {
                    "id": equipment_root_id,
                    "name": f"{item.aircraft_type} 装备构型",
                    "parent_id": whole_aircraft_root_id,
                    "aircraft_model": item.aircraft_type,
                    "product_type": "装备构型",
                    "quantity": 1,
                    "k_out_of_n": {},
                }
            )
            node_ids.add(equipment_root_id)
        for component in component_nodes:
            if str(component.get("id")) == equipment_root_id:
                component["parent_id"] = whole_aircraft_root_id
        root_node = {
            "id": whole_aircraft_root_id,
            "name": f"{item.tail_number} 整机",
            "parent_id": "",
            "aircraft_model": item.aircraft_type,
            "product_type": "整机",
            "quantity": 1,
            "k_out_of_n": {},
        }
        nodes = [root_node, *component_nodes]
        node_map = {str(node.get("id")): node for node in nodes}
        children_by_parent: dict[str, list[str]] = {str(node.get("id")): [] for node in nodes}
        for node in nodes:
            node_id = str(node.get("id"))
            parent_id = str(node.get("parent_id") or "")
            if parent_id and parent_id in node_map and node_id != whole_aircraft_root_id:
                children_by_parent.setdefault(parent_id, []).append(node_id)
        failure_time_by_id: dict[str, int] = {}
        for failed_id, failure_minute in item.component_failure_minutes.items():
            failure_time_by_id[str(failed_id)] = int(failure_minute)
        failed_ids = set(direct_failed)
        propagated_ids: set[str] = set()
        changed = True
        while changed:
            changed = False
            for node_id in sorted(node_map.keys(), key=lambda value: self._failure_tree_depth(value, node_map), reverse=True):
                if node_id in failed_ids:
                    continue
                failed_children = [child_id for child_id in children_by_parent.get(node_id, []) if child_id in failed_ids]
                threshold = self._failure_threshold(node_map[node_id])
                if failed_children and len(failed_children) >= threshold:
                    failed_ids.add(node_id)
                    propagated_ids.add(node_id)
                    failure_time_by_id[node_id] = min(failure_time_by_id.get(child_id, self.minute) for child_id in failed_children)
                    changed = True
        payload_nodes = []
        for node in nodes:
            node_id = str(node.get("id"))
            if node_id == equipment_root_id:
                continue
            failed_children = [child_id for child_id in children_by_parent.get(node_id, []) if child_id in failed_ids]
            threshold = self._failure_threshold(node)
            parent_id = str(node.get("parent_id") or "")
            if parent_id == equipment_root_id:
                parent_id = whole_aircraft_root_id
            payload_nodes.append(
                {
                    "id": node_id,
                    "name": str(node.get("name") or node_id),
                    "parent_id": parent_id,
                    "product_type": str(node.get("product_type") or ""),
                    "quantity": max(1, int(node.get("quantity") or 1)),
                    "k_out_of_n": copy.deepcopy(node.get("k_out_of_n") if isinstance(node.get("k_out_of_n"), dict) else {}),
                    "failure_threshold": threshold,
                    "failed_children": len(failed_children),
                    "failed": node_id in failed_ids,
                    "direct_failed": node_id in direct_failed,
                    "propagated_failed": node_id in propagated_ids,
                    "failure_time": failure_time_by_id.get(node_id),
                }
            )
        return {
            "tail_number": item.tail_number,
            "aircraft_type": item.aircraft_type,
            "root_id": whole_aircraft_root_id,
            "equipment_root_id": equipment_root_id,
            "nodes": payload_nodes,
            "edges": [
                {
                    "from": str(node.get("parent_id") or ""),
                    "to": str(node.get("id")),
                    "active": str(node.get("id")) in failed_ids and str(node.get("parent_id") or "") in failed_ids,
                }
                for node in payload_nodes
                if node.get("parent_id")
            ],
        }

    def _aircraft_failure_tree_root_failed(self, item: AircraftState) -> bool:
        tree = self._aircraft_failure_tree_payload(item)
        root_id = str(tree.get("root_id") or "")
        return any(str(node.get("id")) == root_id and node.get("failed") for node in tree.get("nodes", []))

    def _first_failed_component_id(self, item: AircraftState) -> str | None:
        if not item.component_failure_minutes:
            return None
        return min(item.component_failure_minutes.items(), key=lambda pair: pair[1])[0]

    def _equipment_tree_root_id(self, component_nodes: list[dict[str, Any]]) -> str:
        configured_root = self.inputs.get("equipment_tree", {}).get("root_component_id")
        if configured_root:
            return str(configured_root)
        parent_ids = {str(node.get("parent_id")) for node in component_nodes if node.get("parent_id") not in (None, "")}
        for candidate in ("aircraft-root", "aircraft"):
            if candidate in parent_ids:
                return candidate
        return sorted(parent_ids)[0] if parent_ids else "aircraft-root"

    def _whole_aircraft_root_id(self, component_node_ids: set[str]) -> str:
        root_id = "whole-aircraft-root"
        if root_id not in component_node_ids:
            return root_id
        index = 1
        while f"{root_id}-{index}" in component_node_ids:
            index += 1
        return f"{root_id}-{index}"

    def _failure_threshold(self, component: dict[str, Any]) -> int:
        k_out = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
        if k_out.get("enabled"):
            return max(1, int(k_out.get("k") or 1))
        return 1

    def _failure_tree_depth(self, node_id: str, node_map: dict[str, dict[str, Any]]) -> int:
        depth = 0
        current = node_map.get(node_id)
        seen = {node_id}
        while current and current.get("parent_id") not in (None, ""):
            parent_id = str(current.get("parent_id"))
            if parent_id in seen:
                break
            seen.add(parent_id)
            depth += 1
            current = node_map.get(parent_id)
        return depth

    def _mission_payload(self, item: MissionState) -> dict[str, Any]:
        return {
            "mission_id": item.mission_id,
            "name": item.name,
            "planned_start": item.planned_start,
            "actual_start": item.actual_start,
            "return_time": item.return_time,
            "required_aircraft": item.required_aircraft,
            "required_aircraft_type": item.required_aircraft_type,
            "task_category": item.task_category,
            "periodic_task_id": item.periodic_task_id,
            "periodic_task_name": item.periodic_task_name,
            "composite_task_id": item.composite_task_id,
            "composite_task_name": item.composite_task_name,
            "basic_task_id": item.basic_task_id,
            "basic_task_name": item.basic_task_name or item.name,
            "support_activity_name": item.support_activity_name,
            "group_name": item.group_name,
            "wave_index": item.wave_index,
            "day_index": item.day_index,
            "duration_minutes": item.duration_minutes,
            "preparation_start": item.preparation_start,
            "status": item.status,
            "assigned_tail_numbers": list(item.assigned_tail_numbers),
            "delay_minutes": item.delay_minutes,
        }

    def _resource_payload(self, item: dict[str, Any]) -> dict[str, Any]:
        capacity = item["personnel_capacity"] + item["equipment_capacity"]
        in_use = item["personnel_in_use"] + item["equipment_in_use"]
        return {
            "name": item["id"],
            "display_name": item["name"],
            "category": "support_node",
            "capacity": capacity,
            "in_use": in_use,
            "utilization": min(1.0, in_use / max(1, capacity)),
            "work_count": item["work_count"],
        }

    def _spares_payload(self) -> list[dict[str, Any]]:
        payload = []
        for node in self.nodes.values():
            for spare_type, quantity in node["inventory"].items():
                display_name = self._product_display_name(spare_type)
                payload.append(
                    {
                        "part_id": f"{node['id']}:{spare_type}",
                        "product_id": spare_type,
                        "name": display_name,
                        "support_node_id": node["id"],
                        "support_node_name": node["name"],
                        "airport_id": node.get("airport_id") or node.get("airport") or "",
                        "quantity": quantity,
                        "consumed": self.spare_consumed_by_node_product.get((str(node["id"]), str(spare_type)), 0),
                        "pending_quantity": sum(
                            shipment.quantity
                            for shipment in self.transport_shipments
                            if shipment.destination_node_id == node["id"] and shipment.spare_type == spare_type
                        ),
                        "reorder_point": 1,
                    }
                )
        return payload

    def _job_payload(self, job: JobState) -> dict[str, Any]:
        task = job.current_task or {}
        return {
            "job_id": job.job_id,
            "tail_number": job.tail_number,
            "kind": job.kind,
            "mission_id": job.mission_id,
            "state": job.state,
            "task": task.get("workName") or task.get("activityCode") or job.activity_name,
            "remaining": job.remaining,
            "shortage_reason": job.shortage_reason,
            "maintenance_method": job.maintenance_method,
            "replacement_ratio": job.replacement_ratio,
            "maintenance_decision_roll": job.maintenance_decision_roll,
            "maintenance_rng_stream": job.maintenance_rng_stream,
            "maintenance_occurrence": job.maintenance_occurrence,
            "due_dimensions": list(job.due_dimensions),
        }

    def _events_for_frame(self) -> list[dict[str, Any]]:
        recent = [event for event in self.event_log if event["time"] >= max(0, self.minute - self.sample_every_minutes)]
        if not recent:
            recent = [{"time": self.minute, "event": "state_frame", "message": "state frame sampled"}]
        payload = []
        for event in recent[-10:]:
            event_type = str(event["event"])
            item = {
                "time": float(event["time"]),
                "event": event_type,
                "event_type": event_type,
                "message": str(event["message"]),
                "metric_refs": self._metric_refs_for_event(event_type),
            }
            if (
                event_type.startswith("organization_")
                or event_type in {"preflight_resource_conflict", "mission_preflight_released"}
            ) and isinstance(event.get("details"), dict):
                item["details"] = copy.deepcopy(event["details"])
            if event_type.startswith("organization_"):
                item["source_event_id"] = str(event["source_event_id"])
                item["event_sequence"] = int(event["event_sequence"])
            payload.append(item)
        return payload

    def _event(self, event: str, message: str, details: dict[str, Any] | None = None) -> None:
        if event.startswith("organization_"):
            self._organization_event_sequence += 1
            details = normalize_organization_event(
                event,
                details,
                minute=self.minute,
                identity=self.organization_graph_identity,
            )
        item: dict[str, Any] = {"time": self.minute, "event": event, "message": message}
        if event.startswith("organization_"):
            item["event_sequence"] = self._organization_event_sequence
            item["source_event_id"] = f"organization-{self._organization_event_sequence:06d}"
        if details:
            item["details"] = copy.deepcopy(details)
        if (
            self.write_event_snapshots
            and self._event_snapshot_count < self.event_snapshot_limit
            and self._should_write_event_snapshot(event)
        ):
            item["snapshot"] = self._event_snapshot(event, details or {})
            self._event_snapshot_count += 1
        self.event_log.append(item)

    def _organization_event_once(
        self,
        fact_key: tuple[Any, ...],
        event: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        if fact_key in self._organization_fact_keys:
            return
        self._organization_fact_keys.add(fact_key)
        self._event(event, message, details)

    def _should_write_event_snapshot(self, event: str) -> bool:
        normalized = event.lower()
        return any(token in normalized for token in ("fail", "shortage", "delay"))

    def _event_snapshot(self, event: str, details: dict[str, Any]) -> dict[str, Any]:
        metrics = self.snapshot()
        return {
            "schema_version": "aircraft-support-event-snapshot-v0",
            "event": event,
            "time": self.minute,
            "aircraft_state": {
                "summary": {
                    "ready_rate": metrics["ready_rate"],
                    "available_aircraft": metrics["available_aircraft"],
                    "failed_count": metrics["failed_count"],
                    "repairing_count": metrics["repairing_count"],
                    "flying_count": metrics["flying_count"],
                    "postflight_count": metrics["postflight_count"],
                    "preventive_count": metrics["preventive_count"],
                },
                "aircraft": [self._event_aircraft_snapshot_payload(item) for item in self.aircraft],
            },
            "support_resources": [self._event_resource_snapshot(node) for node in self.nodes.values()],
            "spare_shortages": self._event_spare_shortages(details),
            "active_jobs": [
                self._job_payload(job)
                for job in self.jobs
                if job.state in {"waiting", "running"}
            ],
        }

    def _event_aircraft_snapshot_payload(self, item: AircraftState) -> dict[str, Any]:
        return {
            "tail_number": item.tail_number,
            "type": item.aircraft_type,
            "state": item.state,
            "current_mission_id": item.current_mission_id,
            "failed_lru": item.failed_component_id or self._first_failed_component_id(item) or "",
            "flight_hours": item.flight_hours,
            "takeoff_count": item.takeoff_count,
            "landing_count": item.landing_count,
            "postflight_required": item.postflight_required,
            "preventive_due": item.preventive_due,
            "initial_life_state": copy.deepcopy(item.initial_life_state),
            "preventive_thresholds": copy.deepcopy(item.preventive_thresholds),
            "preventive_threshold_sources": copy.deepcopy(item.preventive_threshold_sources),
            "initial_due_dimensions": list(item.initial_due_dimensions),
            "due_dimensions": list(item.preventive_due_dimensions),
            "calendar_days": self._calendar_days_since_preventive(item),
            "in_flight_failure": item.in_flight_failure,
        }

    def _event_resource_snapshot(self, node: dict[str, Any]) -> dict[str, Any]:
        return {
            "resource_id": node["id"],
            "name": node["name"],
            "display_name": node.get("display_name") or node["name"],
            "personnel_in_use": node["personnel_in_use"],
            "personnel_capacity": node["personnel_capacity"],
            "equipment_in_use": node["equipment_in_use"],
            "equipment_capacity": node["equipment_capacity"],
            "work_count": node["work_count"],
            "inventory": copy.deepcopy(node["inventory"]),
        }

    def _event_spare_shortages(self, details: dict[str, Any]) -> list[dict[str, Any]]:
        shortages = []
        spare_type = str(details.get("spare_type") or "")
        if spare_type:
            shortages.append(
                {
                    "product_id": str(details.get("product_id") or ""),
                    "spare_type": spare_type,
                    "required_quantity": int(details.get("required_quantity", 0) or 0),
                    "available_quantity": int(details.get("available_quantity", 0) or 0),
                    "resource_id": str(details.get("resource_id") or ""),
                    "job_id": str(details.get("job_id") or ""),
                    "reason": str(details.get("reason") or "spare_shortage"),
                }
            )
        for job in self.jobs:
            if not job.shortage_reason or not str(job.shortage_reason).startswith("spare:"):
                continue
            node = self.nodes.get(job.resource_node_id)
            task = job.current_task or {}
            job_spare_type, job_spare_qty = self._task_spare_requirement(job, task)
            if not job_spare_type:
                continue
            shortages.append(
                {
                    "product_id": job_spare_type,
                    "spare_type": self._product_display_name(job_spare_type),
                    "required_quantity": job_spare_qty,
                    "available_quantity": int((node or {}).get("inventory", {}).get(job_spare_type, 0) or 0),
                    "resource_id": job.resource_node_id,
                    "job_id": job.job_id,
                    "reason": str(job.shortage_reason),
                }
            )
        seen: set[tuple[str, str, str]] = set()
        unique = []
        for shortage in shortages:
            key = (shortage["spare_type"], shortage["resource_id"], shortage["job_id"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(shortage)
        return unique

    def _metric_refs_for_event(self, event: str) -> list[str]:
        if "mission" in event:
            return ["sortie_completion_rate", "avg_departure_delay"]
        if "spare" in event:
            return ["spare_stock_total", "spare_consumed_total", "shortage_events"]
        if "job" in event or "repair" in event or "preflight" in event:
            return ["active_jobs", "maintenance_backlog"]
        if "fail" in event:
            return ["lru_failures", "downtime_failure_events"]
        return ["sortie_completion_rate", "available_aircraft", "spare_fill_rate"]


__all__ = ["TelemetryMixin"]
