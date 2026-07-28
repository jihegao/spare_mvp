"""ModelBuilder behavior for aircraft-support v1."""

from __future__ import annotations

import copy
import math
from typing import Any

from .runtime_utils import (
    _failure_distribution_rate,
    _mission_calendar_days_by_composite,
    _non_negative_float,
    _non_negative_int,
    _periodic_explicit_composite_days,
    _periodic_period_days,
    _periodic_total_days,
    _periodic_weekday_assignment_days,
    _positive_int,
    _success_point,
    _time_to_minute,
)
from .state import AircraftState, MissionState


class ModelBuilderMixin:
    def _build_aircraft(self) -> list[AircraftState]:
        aircraft_inputs = self.inputs.get("aircraft", {})
        configured_fleet_count = _positive_int(aircraft_inputs.get("fleet_count"), 0)
        assets = [item for item in aircraft_inputs.get("assets") or [] if isinstance(item, dict)]
        fleet_count = max(1, configured_fleet_count, len(assets))
        initial_ready = min(fleet_count, max(0, int(aircraft_inputs.get("initial_ready", fleet_count))))
        models = list(aircraft_inputs.get("models") or ["Aircraft"])
        if assets:
            aircraft = []
            for index, item in enumerate(assets[:fleet_count]):
                tail_number = str(item.get("tailNumber") or item.get("tail_number") or f"AC-{index + 1:03d}")
                aircraft_type = str(item.get("aircraftType") or item.get("aircraft_type") or item.get("type") or item.get("model") or "Aircraft")
                state = str(item.get("initialState") or item.get("initial_state") or item.get("state") or "available")
                if state not in {"available", "maintenance", "flying"}:
                    state = "available"
                initial_life_state = self._initial_life_state(item)
                aircraft.append(
                    AircraftState(
                        tail_number=tail_number,
                        aircraft_type=aircraft_type,
                        model=str(item.get("model") or aircraft_type),
                        airport=str(item.get("airport") or ""),
                        airport_id=str(item.get("airport_id") or item.get("airportId") or item.get("baseAirportId") or ""),
                        state=state,
                        x=index % 6,
                        y=index // 6,
                        flight_hours=float(initial_life_state["flight_hours"]),
                        takeoff_count=int(initial_life_state["takeoff_landing_cycles"]),
                        landing_count=int(initial_life_state["takeoff_landing_cycles"]),
                        last_preventive_minute=-int(initial_life_state["calendar_days"]) * 1440,
                        initial_life_state=initial_life_state,
                        preventive_thresholds=copy.deepcopy(item.get("preventive_thresholds") or {}),
                        preventive_threshold_sources=copy.deepcopy(item.get("preventive_threshold_sources") or {}),
                        preventive_cycles=self._initial_preventive_cycles(item, initial_life_state),
                        source_initial_state=str(item.get("source_initial_state") or state),
                        initial_preventive_due=bool(item.get("initial_preventive_due")),
                    )
                )
            used_tail_numbers = {item.tail_number for item in aircraft}
            for index in range(len(aircraft), fleet_count):
                tail_number = f"AC-{index + 1:03d}"
                while tail_number in used_tail_numbers:
                    index += 1
                    tail_number = f"AC-{index + 1:03d}"
                aircraft_type = str(models[index % len(models)])
                aircraft.append(
                    AircraftState(
                        tail_number=tail_number,
                        aircraft_type=aircraft_type,
                        model=aircraft_type,
                        state="available" if index < initial_ready else "maintenance",
                        x=index % 6,
                        y=index // 6,
                    )
                )
                used_tail_numbers.add(tail_number)
            return aircraft
        return [
            AircraftState(
                tail_number=f"AC-{index + 1:03d}",
                aircraft_type=str(models[index % len(models)]),
                model=str(models[index % len(models)]),
                state="available" if index < initial_ready else "maintenance",
                x=index % 6,
                y=index // 6,
            )
            for index in range(fleet_count)
        ]

    @staticmethod
    def _initial_life_state(asset: dict[str, Any]) -> dict[str, int | float]:
        raw = asset.get("initial_life_state")
        raw = raw if isinstance(raw, dict) else {}
        return {
            "calendar_days": _non_negative_int(raw.get("calendar_days"), 0),
            "flight_hours": _non_negative_float(raw.get("flight_hours"), 0.0),
            "takeoff_landing_cycles": _non_negative_int(raw.get("takeoff_landing_cycles"), 0),
        }

    @staticmethod
    def _initial_preventive_cycles(
        asset: dict[str, Any],
        fallback_life_state: dict[str, int | float],
    ) -> dict[str, dict[str, Any]]:
        cycles: dict[str, dict[str, Any]] = {}
        raw_cycles = asset.get("preventive_cycles")
        for index, raw_cycle in enumerate(raw_cycles if isinstance(raw_cycles, list) else []):
            if not isinstance(raw_cycle, dict):
                continue
            activity_id = str(raw_cycle.get("activity_id") or raw_cycle.get("activityId") or "").strip()
            if not activity_id:
                activity_id = f"preventive-cycle-{index + 1}"
            raw_thresholds = raw_cycle.get("thresholds") if isinstance(raw_cycle.get("thresholds"), dict) else {}
            thresholds = {
                "calendar_days": _non_negative_int(raw_thresholds.get("calendar_days"), 0),
                "flight_hours": _non_negative_float(raw_thresholds.get("flight_hours"), 0.0),
                "takeoff_landing_cycles": _non_negative_int(raw_thresholds.get("takeoff_landing_cycles"), 0),
            }
            if not any(value > 0 for value in thresholds.values()):
                continue
            raw_life = raw_cycle.get("initial_life_state") if isinstance(raw_cycle.get("initial_life_state"), dict) else fallback_life_state
            cycles[activity_id] = {
                "activity_id": activity_id,
                "equipment_id": str(raw_cycle.get("equipment_id") or raw_cycle.get("equipmentId") or ""),
                "thresholds": thresholds,
                "life_state": {
                    "calendar_days": _non_negative_int(raw_life.get("calendar_days"), 0),
                    "flight_hours": _non_negative_float(raw_life.get("flight_hours"), 0.0),
                    "takeoff_landing_cycles": _non_negative_int(raw_life.get("takeoff_landing_cycles"), 0),
                },
                "last_preventive_minute": -_non_negative_int(raw_life.get("calendar_days"), 0) * 1440,
            }
        return cycles

    def _behavior_components(self) -> list[dict[str, Any]]:
        components = []
        for item in self.equipment_tree_components:
            if item.get("parent_id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["quantity"] = max(1, int(component.get("quantity") or 1))
            component["root_component_id"] = self.inputs.get("equipment_tree", {}).get("root_component_id")
            effective_rate = self._effective_component_failure_rate(component)
            effective_rate *= max(1.0, math.sqrt(float(component["quantity"])))
            if effective_rate <= 0:
                continue
            component["failure_rate"] = effective_rate
            component["repair_duration_minutes"] = self._component_repair_duration_minutes(component)
            components.append(component)
        return components

    def _equipment_tree_components(self) -> list[dict[str, Any]]:
        components = []
        for item in self.inputs.get("equipment_tree", {}).get("components", []):
            if not isinstance(item, dict) or item.get("id") in (None, ""):
                continue
            component = copy.deepcopy(item)
            component["id"] = str(component.get("id"))
            component["name"] = str(component.get("name") or component["id"])
            parent_id = component.get("parent_id")
            component["parent_id"] = "" if parent_id in (None, "") else str(parent_id)
            component["aircraft_model"] = str(component.get("aircraft_model") or "")
            component["product_id"] = str(component.get("product_id") or component.get("spare_type") or "")
            component["product_name"] = str(component.get("product_name") or component.get("name") or component["product_id"])
            component["spare_type"] = component["product_id"]
            component["product_type"] = str(component.get("product_type") or "")
            component["quantity"] = max(1, int(component.get("quantity") or 1))
            component["k_out_of_n"] = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
            components.append(component)
        return components

    def _effective_component_failure_rate(self, component: dict[str, Any]) -> float:
        distribution = component.get("failure_distribution")
        rate = _failure_distribution_rate(distribution) if isinstance(distribution, dict) else None
        if rate is None:
            rate = 0.0
        k_out = component.get("k_out_of_n") if isinstance(component.get("k_out_of_n"), dict) else {}
        if k_out.get("enabled"):
            k = max(1, int(k_out.get("k") or 1))
            n = max(k, int(k_out.get("n") or k))
            tolerated_failures = max(0, n - k)
            rate = rate / max(1, tolerated_failures + 1)
        return max(0.0, rate)

    def _component_repair_duration_minutes(self, component: dict[str, Any]) -> int | None:
        profile = component.get("special_repair_profile") if isinstance(component.get("special_repair_profile"), dict) else {}
        if profile.get("repairTimeMinutes"):
            return max(1, int(profile["repairTimeMinutes"]))
        return None

    def _build_support_nodes(self) -> dict[str, dict[str, Any]]:
        nodes: dict[str, dict[str, Any]] = {}
        raw_graph = self.inputs.get("support_network", {}).get("organization_graph")
        configured_mode = str(
            (raw_graph or {}).get("runtime_mode") or (raw_graph or {}).get("runtimeMode") or ""
        ).strip().casefold() if isinstance(raw_graph, dict) else ""
        if configured_mode and configured_mode not in {"legacy", "vertical", "vertical_lateral"}:
            raise ValueError(f"unsupported organization_graph runtime_mode {configured_mode!r}")
        canonical_requested = configured_mode in {"vertical", "vertical_lateral"} or bool(
            not configured_mode
            and isinstance(raw_graph, dict)
            and isinstance(raw_graph.get("nodes"), list)
            and raw_graph["nodes"]
        )
        minimum_capacity = 0 if canonical_requested else 1
        for item in self.inputs.get("support_network", {}).get("nodes", []):
            node_id = str(item.get("id") or f"node-{len(nodes) + 1}")
            nodes[node_id] = {
                "id": node_id,
                "name": str(item.get("name") or node_id),
                "airport": str(item.get("airport") or ""),
                "airport_id": str(item.get("airport_id") or item.get("airportId") or item.get("baseAirportId") or ""),
                "organization_node_id": str(
                    item.get("organization_node_id") or item.get("organizationNodeId") or ""
                ).strip(),
                "personnel_capacity": max(minimum_capacity, int(item.get("personnel_capacity", 1))),
                "equipment_capacity": max(minimum_capacity, int(item.get("equipment_capacity", 1))),
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {
                    str(key): max(0, int(value))
                    for key, value in (item.get("inventory") or {}).items()
                    if isinstance(value, (int, float))
                },
                "product_names": {
                    str(key): str(value or key)
                    for key, value in (item.get("product_names") or {}).items()
                },
                "transport_policies": self._normalized_transport_policies(item.get("transport_policies") or []),
                "work_count": 0,
            }
        if not nodes:
            nodes["support-node"] = {
                "id": "support-node",
                "name": "support node",
                "airport": "",
                "airport_id": "",
                "organization_node_id": "",
                "personnel_capacity": 1,
                "equipment_capacity": 1,
                "personnel_in_use": 0,
                "equipment_in_use": 0,
                "inventory": {},
                "product_names": {},
                "transport_policies": [],
                "work_count": 0,
            }
        return nodes

    def _initialize_organization_graph(self) -> None:
        raw_graph = self.inputs.get("support_network", {}).get("organization_graph")
        graph_nodes = raw_graph.get("nodes") if isinstance(raw_graph, dict) else None
        configured_mode = str(
            (raw_graph or {}).get("runtime_mode") or (raw_graph or {}).get("runtimeMode") or ""
        ).strip().casefold() if isinstance(raw_graph, dict) else ""
        self.canonical_organization_enabled = configured_mode in {"vertical", "vertical_lateral"} or bool(
            not configured_mode
            and isinstance(graph_nodes, list)
            and graph_nodes
        )
        self.lateral_organization_enabled = configured_mode == "vertical_lateral"
        self.organization_nodes: dict[str, dict[str, Any]] = {}
        self.organization_parent_by_id: dict[str, str | None] = {}
        self.runtime_node_by_organization_id: dict[str, str] = {}
        self.organization_lateral_edges: list[dict[str, Any]] = []
        self.organization_transport_policies: list[dict[str, Any]] = []
        if not self.canonical_organization_enabled:
            return

        for raw_node in graph_nodes:
            if not isinstance(raw_node, dict):
                raise ValueError("canonical organization_graph nodes must be objects")
            organization_id = str(raw_node.get("id") or "").strip()
            if not organization_id or organization_id in self.organization_nodes:
                raise ValueError("canonical organization_graph node ids must be non-empty and unique")
            normalized_node = copy.deepcopy(raw_node)
            normalized_node["service_scope"] = self._normalized_organization_service_scope(
                raw_node.get("service_scope", raw_node.get("serviceScope", {})),
                organization_id,
            )
            self.organization_nodes[organization_id] = normalized_node

        parent_by_child: dict[str, str] = {}
        for edge in raw_graph.get("parent_edges") or []:
            if not isinstance(edge, dict):
                continue
            parent_id = str(edge.get("from_node_id") or edge.get("fromOrganizationNodeId") or "").strip()
            child_id = str(edge.get("to_node_id") or edge.get("toOrganizationNodeId") or "").strip()
            if not parent_id or not child_id:
                continue
            if child_id in parent_by_child and parent_by_child[child_id] != parent_id:
                raise ValueError(f"canonical organization node {child_id!r} has multiple parents")
            parent_by_child[child_id] = parent_id
        for organization_id, raw_node in self.organization_nodes.items():
            declared_parent = str(raw_node.get("parent_id") or raw_node.get("parentId") or "").strip() or None
            edge_parent = parent_by_child.get(organization_id)
            if declared_parent and edge_parent and declared_parent != edge_parent:
                raise ValueError(f"canonical organization node {organization_id!r} has conflicting parents")
            parent_id = declared_parent or edge_parent
            if parent_id is not None and parent_id not in self.organization_nodes:
                raise ValueError(f"canonical organization node {organization_id!r} has unknown parent {parent_id!r}")
            self.organization_parent_by_id[organization_id] = parent_id

        for organization_id in self.organization_nodes:
            seen: set[str] = set()
            cursor: str | None = organization_id
            while cursor is not None:
                if cursor in seen:
                    raise ValueError("canonical organization_graph parent relation must be acyclic")
                seen.add(cursor)
                cursor = self.organization_parent_by_id.get(cursor)

        for node_id, node in self.nodes.items():
            organization_id = str(node.get("organization_node_id") or "").strip()
            if not organization_id:
                raise ValueError(f"canonical runtime support node {node_id!r} requires organization_node_id")
            if organization_id not in self.organization_nodes:
                raise ValueError(
                    f"canonical runtime support node {node_id!r} references unknown organization node {organization_id!r}"
                )
            if organization_id in self.runtime_node_by_organization_id:
                raise ValueError(f"canonical organization node {organization_id!r} maps to multiple runtime nodes")
            self.runtime_node_by_organization_id[organization_id] = node_id

        if self.lateral_organization_enabled:
            self._initialize_lateral_organization_edges(raw_graph.get("lateral_edges") or [])

        for index, raw_policy in enumerate(raw_graph.get("transport_policies") or []):
            if not isinstance(raw_policy, dict):
                continue
            policy_id = str(raw_policy.get("id") or f"organization-policy-{index + 1}").strip()
            source_id = str(
                raw_policy.get("from_organization_node_id")
                or raw_policy.get("fromOrganizationNodeId")
                or ""
            ).strip()
            destination_id = str(
                raw_policy.get("to_organization_node_id")
                or raw_policy.get("toOrganizationNodeId")
                or ""
            ).strip()
            if source_id not in self.organization_nodes or destination_id not in self.organization_nodes:
                continue
            self.organization_transport_policies.append(
                {
                    "id": policy_id,
                    "from_organization_node_id": source_id,
                    "to_organization_node_id": destination_id,
                    "product_id": str(
                        raw_policy.get("product_id") or raw_policy.get("productId") or ""
                    ).strip(),
                    "capacity": max(1, int(raw_policy.get("capacity") or 1)),
                    "priority": max(1, int(raw_policy.get("priority") or 1)),
                    "transport_minutes": self._transport_policy_minutes(raw_policy),
                }
            )

        self.organization_transport_policies.sort(
            key=lambda item: (
                item["from_organization_node_id"],
                item["to_organization_node_id"],
                item["product_id"],
                item["priority"],
                item["transport_minutes"],
                item["id"],
            )
        )

    def _normalized_organization_service_scope(
        self,
        raw_scope: Any,
        organization_id: str,
    ) -> dict[str, tuple[str, ...]]:
        if raw_scope in (None, {}):
            raw_scope = {}
        if not isinstance(raw_scope, dict):
            raise ValueError(
                f"canonical organization node {organization_id!r} service_scope must be an object"
            )
        allowed_resource_types = {"personnel", "equipment", "spare"}
        normalized: dict[str, tuple[str, ...]] = {}
        for field in ("airport_ids", "aircraft_models", "product_ids", "resource_types"):
            camel_field = {
                "airport_ids": "airportIds",
                "aircraft_models": "aircraftModels",
                "product_ids": "productIds",
                "resource_types": "resourceTypes",
            }[field]
            values = raw_scope.get(field, raw_scope.get(camel_field, []))
            if not isinstance(values, list):
                raise ValueError(
                    f"canonical organization node {organization_id!r} service_scope.{field} must be an array"
                )
            if any(not isinstance(value, str) or not value.strip() for value in values):
                raise ValueError(
                    f"canonical organization node {organization_id!r} service_scope.{field} has invalid values"
                )
            cleaned = tuple(sorted({value.strip() for value in values}))
            if field == "resource_types" and not set(cleaned).issubset(allowed_resource_types):
                raise ValueError(
                    f"canonical organization node {organization_id!r} service_scope.resource_types has invalid values"
                )
            normalized[field] = cleaned
        return normalized

    def _initialize_lateral_organization_edges(self, raw_edges: Any) -> None:
        if not isinstance(raw_edges, list):
            raise ValueError("canonical organization_graph lateral_edges must be an array")
        seen_ids: set[str] = set()
        seen_endpoints: set[tuple[str, str]] = set()
        adjacency: dict[str, list[str]] = {}
        for index, raw_edge in enumerate(raw_edges):
            if not isinstance(raw_edge, dict):
                raise ValueError("canonical organization_graph lateral edges must be objects")
            relation_id = str(raw_edge.get("id") or "").strip()
            source_id = str(
                raw_edge.get("from_node_id") or raw_edge.get("fromOrganizationNodeId") or ""
            ).strip()
            destination_id = str(
                raw_edge.get("to_node_id") or raw_edge.get("toOrganizationNodeId") or ""
            ).strip()
            enabled = raw_edge.get("enabled", True)
            priority = raw_edge.get("priority", 1)
            if not relation_id or relation_id in seen_ids:
                raise ValueError("canonical lateral relation ids must be non-empty and unique")
            seen_ids.add(relation_id)
            if not isinstance(enabled, bool):
                raise ValueError(f"canonical lateral relation {relation_id!r} enabled must be boolean")
            if isinstance(priority, bool) or not isinstance(priority, int) or priority < 1:
                raise ValueError(f"canonical lateral relation {relation_id!r} priority must be positive integer")
            if source_id not in self.organization_nodes or destination_id not in self.organization_nodes:
                raise ValueError(f"canonical lateral relation {relation_id!r} has unknown endpoint")
            endpoints = (source_id, destination_id)
            if source_id == destination_id or endpoints in seen_endpoints:
                raise ValueError(f"canonical lateral relation {relation_id!r} has invalid duplicate endpoint")
            seen_endpoints.add(endpoints)
            source_parent = self.organization_parent_by_id.get(source_id)
            destination_parent = self.organization_parent_by_id.get(destination_id)
            if source_parent is None or source_parent != destination_parent:
                raise ValueError(f"canonical lateral relation {relation_id!r} endpoints must be siblings")
            if source_id not in self.runtime_node_by_organization_id or destination_id not in self.runtime_node_by_organization_id:
                raise ValueError(f"canonical lateral relation {relation_id!r} endpoint is not runtime reachable")
            edge = {
                "id": relation_id,
                "from_node_id": source_id,
                "to_node_id": destination_id,
                "priority": priority,
                "enabled": enabled,
            }
            self.organization_lateral_edges.append(edge)
            adjacency.setdefault(source_id, []).append(destination_id)

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(organization_id: str) -> None:
            if organization_id in visited:
                return
            if organization_id in visiting:
                raise ValueError("canonical organization_graph lateral relation must be acyclic")
            visiting.add(organization_id)
            for target_id in sorted(adjacency.get(organization_id, [])):
                visit(target_id)
            visiting.remove(organization_id)
            visited.add(organization_id)

        for organization_id in sorted(adjacency):
            visit(organization_id)
        self.organization_lateral_edges.sort(
            key=lambda item: (item["priority"], item["id"], item["from_node_id"])
        )

    def _normalized_transport_policies(self, policies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = []
        for item in policies:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "from": str(item.get("from") or ""),
                    "to": str(item.get("to") or ""),
                    "spare_type": str(item.get("productId") or item.get("product_id") or item.get("spare_type") or ""),
                    "capacity": max(1, int(item.get("capacity") or 1)),
                    "priority": max(1, int(item.get("priority") or 1)),
                    "transport_minutes": self._transport_policy_minutes(item),
                }
            )
        return sorted(normalized, key=lambda item: (item["priority"], item["transport_minutes"]))

    def _transport_policy_minutes(self, item: dict[str, Any]) -> int:
        if item.get("transport_minutes") not in (None, ""):
            return max(0, int(round(_non_negative_float(item.get("transport_minutes"), 0.0))))
        if item.get("transportMinutes") not in (None, ""):
            return max(0, int(round(_non_negative_float(item.get("transportMinutes"), 0.0))))
        hours = item.get("transportTimeHours", item.get("transport_time_hours"))
        return max(0, int(round(_non_negative_float(hours, 0.0) * 60)))

    def _build_activities(self) -> list[dict[str, Any]]:
        activities = []
        for item in self.inputs.get("support_activities", {}).get("activities", []):
            activity = copy.deepcopy(item)
            activity["jobs"] = self._ordered_activity_jobs(activity.get("jobs") or [])
            activity["aircraft_model"] = str(activity.get("aircraft_model") or "")
            activity["equipment_id"] = str(activity.get("equipment_id") or "")
            if self._activity_kind_matches(activity, "repair") or self._activity_kind_matches(activity, "preventive"):
                methods = [
                    str(value)
                    for value in activity.get("maintenance_methods", [])
                    if str(value) in {"non_replacement", "replacement"}
                ] if isinstance(activity.get("maintenance_methods"), list) else []
                activity["maintenance_methods"] = list(dict.fromkeys(methods)) or ["non_replacement"]
                if activity["maintenance_methods"] == ["replacement"]:
                    activity["replacement_ratio"] = 1.0
                elif "replacement" not in activity["maintenance_methods"]:
                    activity["replacement_ratio"] = 0.0
                else:
                    activity["replacement_ratio"] = min(
                        1.0,
                        _non_negative_float(activity.get("replacement_ratio"), 0.0),
                    )
            activities.append(activity)
        return activities

    def _ordered_activity_jobs(self, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        remaining = [copy.deepcopy(job) for job in jobs if isinstance(job, dict)]
        ordered: list[dict[str, Any]] = []
        completed_codes: set[str] = set()
        while remaining:
            progressed = False
            for job in list(remaining):
                predecessors = [str(item) for item in job.get("predecessors") or []]
                if all(predecessor in completed_codes for predecessor in predecessors):
                    ordered.append(job)
                    code = job.get("activityCode")
                    if code not in (None, ""):
                        completed_codes.add(str(code))
                    remaining.remove(job)
                    progressed = True
            if not progressed:
                ordered.extend(remaining)
                break
        return ordered

    def _activity_kind_matches(self, activity: dict[str, Any], kind: str) -> bool:
        text = f"{activity.get('id', '')} {activity.get('name', '')} {activity.get('activity_type', '')}".lower()
        if kind == "preflight":
            return (
                "preflight" in text
                or "飞行前" in text
                or "直接准备" in text
                or "使用保障" in text
            )
        if kind == "repair":
            return "corrective" in text or "repair" in text or "修复性维修" in text or "故障修复" in text
        if kind == "postflight":
            return "postflight" in text or "飞行后" in text or "航后" in text
        if kind == "preventive":
            return "preventive" in text or "预防" in text or "定检" in text
        return False

    def _select_activity(
        self,
        kind: str,
        *,
        aircraft: AircraftState | None = None,
        component: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        candidates = [activity for activity in self.activities if self._activity_kind_matches(activity, kind)]
        if kind in {"repair", "preventive"} and candidates:
            candidates = self._maintenance_activity_candidates(candidates, aircraft=aircraft, component=component)
        if candidates:
            return candidates[0]
        if kind in {"repair", "postflight", "preventive"}:
            return self._default_activity(kind)
        return self.activities[0] if self.activities else self._default_activity(kind)

    def _maintenance_activity_candidates(
        self,
        candidates: list[dict[str, Any]],
        *,
        aircraft: AircraftState | None,
        component: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        component_ids = {
            str((component or {}).get(field) or "").strip().casefold()
            for field in ("id", "product_id")
        } - {""}
        aircraft_models = {
            str(value or "").strip().casefold()
            for value in (
                aircraft.aircraft_type if aircraft is not None else "",
                aircraft.model if aircraft is not None else "",
                (component or {}).get("aircraft_model"),
            )
        } - {""}
        ranked: list[tuple[int, int, dict[str, Any]]] = []
        for index, activity in enumerate(candidates):
            equipment_id = str(activity.get("equipment_id") or "").strip().casefold()
            activity_model = str(activity.get("aircraft_model") or "").strip().casefold()
            if not activity_model and equipment_id:
                scoped_component = self._component_by_id(equipment_id)
                activity_model = str((scoped_component or {}).get("aircraft_model") or "").strip().casefold()
            if component_ids and equipment_id and equipment_id not in component_ids:
                continue
            if aircraft_models and activity_model and activity_model not in aircraft_models:
                continue
            score = (4 if equipment_id and equipment_id in component_ids else 0) + (
                2 if activity_model and activity_model in aircraft_models else 0
            ) + (1 if not equipment_id and not activity_model else 0)
            ranked.append((-score, index, activity))
        return [activity for _, _, activity in sorted(ranked, key=lambda item: (item[0], item[1]))]

    def _default_activity(self, kind: str) -> dict[str, Any]:
        return {
            "id": kind,
            "name": kind,
            "priority": 1,
            # Resolve a missing activity's node from the aircraft when the job
            # is created.  Node insertion order commonly places the parent
            # base first, which is not the aircraft's flight-line support site.
            "resource_id": "",
            "jobs": [{"activityCode": f"{kind}-001", "durationMinutes": 30, "workName": kind}],
        }

    def _build_missions(self) -> list[MissionState]:
        profile = self.inputs.get("mission_profile", {})
        basic_missions = self._basic_missions_by_id(profile)
        default_basic = next(iter(basic_missions.values()), {})
        missions: list[MissionState] = []
        has_explicit_calendar = isinstance(profile.get("mission_calendar"), list)
        periodic_contexts = self._periodic_contexts_by_composite(profile)
        schedule_duration_minutes = min(
            self.duration_minutes,
            _positive_int(profile.get("duration_minutes"), self.duration_minutes),
        )
        mission_duration_adjustment = self.mission_context["duration_adjustment_minutes"]
        for composite in profile.get("composite_tasks") or []:
            composite_id = str(composite.get("id") or "")
            if has_explicit_calendar and composite_id not in periodic_contexts:
                continue
            periodic_context = periodic_contexts.get(composite_id, {})
            for item_index, item in enumerate(composite.get("taskItems") or []):
                if not isinstance(item, dict):
                    continue
                basic = self._basic_mission_for_item(item, basic_missions, default_basic)
                item_id = str(item.get("id") or "").strip()
                mission_base_id = item_id or (
                    f"{composite_id}__item-{item_index + 1}"
                    if composite_id
                    else f"mission-{item_index + 1}"
                )
                interval = max(1, int(round(_non_negative_float(item.get("intervalHours"), 24) * 60)))
                first_start = _time_to_minute(item.get("firstWaveTime"), int(basic.get("startHour") or 1) * 60)
                preflight_notice = self._preflight_notice_minutes(item, basic)
                duration = int(item.get("taskDurationMinutes") or basic.get("taskDurationMinutes") or 120) + mission_duration_adjustment
                recovery = _time_to_minute(item.get("recoveryTime"), -1)
                if recovery >= 0 and recovery > first_start:
                    duration = max(1, recovery - first_start + mission_duration_adjustment)
                mission_days = self._mission_days_for_item(item, periodic_context)
                daily_repeat_count = self._daily_repeat_count(item, periodic_context)
                for day_offset in mission_days:
                    for repeat in range(daily_repeat_count):
                        planned_start = day_offset * 1440 + first_start + repeat * interval
                        if (
                            planned_start >= schedule_duration_minutes
                            if has_explicit_calendar
                            else planned_start > schedule_duration_minutes
                        ):
                            continue
                        day_index = planned_start // 1440 + 1
                        wave_index = repeat + 1
                        missions.append(
                            MissionState(
                                mission_id=f"{mission_base_id}-d{day_index}-w{wave_index}",
                                name=str(
                                    item.get("basicTaskName")
                                    or composite.get("name")
                                    or basic.get("name")
                                    or mission_base_id
                                ),
                                planned_start=planned_start,
                                preparation_start=max(0, planned_start - preflight_notice),
                                duration_minutes=max(1, duration),
                                required_aircraft=max(1, int(item.get("equipmentQuantity") or basic.get("equipmentQuantity") or 1)),
                                min_required_aircraft=max(1, int(basic.get("minRequiredSorties") or basic.get("equipmentQuantity") or 1)),
                                priority=max(1, int(composite.get("priority") or 1)),
                                cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                                success_point=_success_point(basic.get("successPoint")),
                                task_category="periodic" if periodic_context else "composite",
                                periodic_task_id=str(periodic_context.get("id") or ""),
                                periodic_task_name=str(periodic_context.get("name") or ""),
                                composite_task_id=composite_id,
                                composite_task_name=str(composite.get("name") or composite_id),
                                basic_task_id=str(item.get("basicMissionId") or basic.get("id") or item.get("id") or ""),
                                basic_task_name=str(item.get("basicTaskName") or basic.get("name") or ""),
                                required_aircraft_type=str(item.get("equipmentType") or basic.get("equipmentType") or ""),
                                support_activity_name=str(basic.get("supportActivityName") or ""),
                                group_name=str(item.get("groupName") or ""),
                                wave_index=wave_index,
                                day_index=day_index,
                            )
                        )
        if not missions and not has_explicit_calendar:
            basic = default_basic
            planned_start = max(0, int(basic.get("startHour") or 1) * 60)
            preflight_notice = self._preflight_notice_minutes({}, basic)
            missions.append(
                MissionState(
                    mission_id=str(basic.get("missionId") or "mission-1"),
                    name=str(basic.get("name") or "mission"),
                    planned_start=planned_start,
                    preparation_start=max(0, planned_start - preflight_notice),
                    duration_minutes=max(1, int(basic.get("taskDurationMinutes") or 120)),
                    required_aircraft=max(1, int(basic.get("equipmentQuantity") or 1)),
                    min_required_aircraft=max(1, int(basic.get("minRequiredSorties") or basic.get("equipmentQuantity") or 1)),
                    priority=1,
                    cancel_minutes=max(0, int(basic.get("cancelMinutes") or 20)),
                    success_point=_success_point(basic.get("successPoint")),
                    task_category="basic",
                    basic_task_id=str(basic.get("id") or basic.get("missionId") or ""),
                    basic_task_name=str(basic.get("name") or "mission"),
                    required_aircraft_type=str(basic.get("equipmentType") or ""),
                    support_activity_name=str(basic.get("supportActivityName") or ""),
                    day_index=planned_start // 1440 + 1,
                )
            )
        return sorted(missions, key=lambda item: (item.planned_start, item.priority))

    def _preflight_notice_minutes(self, item: dict[str, Any], basic: dict[str, Any]) -> int:
        for source in (item, basic):
            if "advanceNoticeMinutes" not in source:
                continue
            value = source.get("advanceNoticeMinutes")
            if value not in (None, ""):
                return max(0, int(value))
        return max(0, int(item.get("preparationMinutes") or basic.get("preparationMinutes") or 0))

    def _basic_missions_by_id(self, profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
        records = profile.get("basic_missions") if isinstance(profile.get("basic_missions"), list) else []
        result: dict[str, dict[str, Any]] = {}
        for index, mission in enumerate(records):
            if not isinstance(mission, dict):
                continue
            mission_id = str(mission.get("id") or mission.get("missionId") or mission.get("taskNo") or f"basic-{index + 1}")
            result[mission_id] = mission
            for alias in (mission.get("name"), mission.get("basicTaskName"), mission.get("missionId"), mission.get("taskNo")):
                alias_text = str(alias or "").strip()
                if alias_text:
                    result.setdefault(alias_text, mission)
        return result

    def _basic_mission_for_item(
        self,
        item: dict[str, Any],
        basic_missions: dict[str, dict[str, Any]],
        default_basic: dict[str, Any],
    ) -> dict[str, Any]:
        for value in (item.get("basicMissionId"), item.get("basicTaskName")):
            key = str(value or "").strip()
            if key and key in basic_missions:
                return basic_missions[key]
        return default_basic

    def _periodic_contexts_by_composite(self, profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
        if isinstance(profile.get("mission_calendar"), list):
            return {
                composite_task_id: {
                    "id": "mission-calendar",
                    "name": "mission calendar",
                    "daily_repeat_count": 1,
                    "active_days": active_days,
                }
                for composite_task_id, active_days in _mission_calendar_days_by_composite(profile).items()
            }
        contexts: dict[str, dict[str, Any]] = {}
        for periodic in profile.get("periodic_tasks") or []:
            if not isinstance(periodic, dict):
                continue
            name = str(
                periodic.get("periodicTaskName")
                or periodic.get("taskName")
                or periodic.get("name")
                or periodic.get("id")
                or ""
            )
            context = {
                "id": str(periodic.get("id") or ""),
                "name": name,
                "daily_repeat_count": _positive_int(periodic.get("dailyRepeatCount"), 1),
                "period_days": _periodic_period_days(periodic),
                "total_days": _periodic_total_days(periodic),
            }
            total_days = int(context["total_days"])
            period_days = int(context["period_days"])
            composite_days = _periodic_explicit_composite_days(periodic, total_days, period_days)
            if not composite_days:
                composite_days = _periodic_weekday_assignment_days(periodic, total_days, period_days)
            if not composite_days:
                composite_days = {
                    str(item): set(range(total_days))
                    for item in periodic.get("compositeTaskIds") or []
                    if item
                }
            for composite_id, active_days in composite_days.items():
                composite_context = dict(context)
                composite_context["active_days"] = sorted(active_days)
                if composite_id in contexts:
                    existing = contexts[composite_id]
                    raise ValueError(
                        "Duplicate periodic task reference for composite task "
                        f"{composite_id}: {existing.get('id') or existing.get('name')} and "
                        f"{composite_context.get('id') or composite_context.get('name')}"
                    )
                contexts[composite_id] = composite_context
        return contexts

    def _mission_days_for_item(self, item: dict[str, Any], periodic_context: dict[str, Any]) -> list[int]:
        if periodic_context:
            profile = self.inputs.get("mission_profile", {})
            duration_minutes = min(
                self.duration_minutes,
                _positive_int(profile.get("duration_minutes"), self.duration_minutes),
            )
            days = [
                int(day)
                for day in periodic_context.get("active_days", [])
                if isinstance(day, int) and day >= 0 and day * 1440 < duration_minutes
            ]
            if isinstance(profile.get("mission_calendar"), list):
                return days
            return days or [0]
        return [0]

    def _daily_repeat_count(self, item: dict[str, Any], periodic_context: dict[str, Any]) -> int:
        if item.get("dailyRepeatCount") not in (None, ""):
            return _positive_int(item.get("dailyRepeatCount"), 1)
        if periodic_context:
            return _positive_int(periodic_context.get("daily_repeat_count"), 1)
        return 1

    def _mission_context(self) -> dict[str, int]:
        profile = self.inputs.get("mission_profile", {})
        airports = [item for item in profile.get("airports") or [] if isinstance(item, dict)]
        phases = [item for item in profile.get("mission_phases") or [] if isinstance(item, dict)]
        distance_km = 0.0
        if airports:
            distance_km += max(_non_negative_float(item.get("distanceToMissionKm"), 0.0) for item in airports)
        phase_minutes = sum(int(round(_non_negative_float(item.get("limitHours"), 0.0) * 10)) for item in phases)
        travel_minutes = int(round((distance_km / 900.0) * 60)) if distance_km else 0
        return {"duration_adjustment_minutes": max(0, travel_minutes + phase_minutes)}


__all__ = ["ModelBuilderMixin"]
