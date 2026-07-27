"""SupportEngine behavior for aircraft-support v1."""

from __future__ import annotations

from typing import Any

from .runtime_utils import _is_no_spare_value, _non_negative_int
from .state import AircraftState, JobState, ResourceTransit, TransportShipment


class SupportEngineMixin:


    def _default_resource_node_id(self, aircraft: AircraftState) -> str:
        """Choose the aircraft's explicitly associated support node before list-order fallback."""
        aircraft_scope = {value.strip().casefold() for value in (aircraft.airport, aircraft.airport_id) if value and value.strip()}
        if aircraft_scope:
            for node_id, node in self.nodes.items():
                node_scope = {
                    str(node.get("airport") or "").strip().casefold(),
                    str(node.get("airport_id") or "").strip().casefold(),
                }
                if aircraft_scope & (node_scope - {""}):
                    return node_id
        if self.canonical_organization_enabled:
            capable_nodes = [
                node_id
                for node_id, node in self.nodes.items()
                if int(node.get("personnel_capacity") or 0) > 0
                or int(node.get("equipment_capacity") or 0) > 0
            ]
            return capable_nodes[0] if len(capable_nodes) == 1 else ""
        return next(iter(self.nodes))

    def _canonical_resource_plan(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        resource_kind: str,
        quantity: int,
    ) -> tuple[dict[str, Any] | None, str]:
        capacity_key = f"{resource_kind}_capacity"
        in_use_key = f"{resource_kind}_in_use"
        local_available = int(destination_node[capacity_key]) - int(destination_node[in_use_key])
        local_in_scope = self._organization_candidate_scope_matches(
            job,
            destination_node,
            destination_node["organization_node_id"],
            resource_kind,
            "",
        )
        if local_in_scope and local_available >= quantity:
            return (
                {
                    "source_node_id": destination_node["id"],
                    "path": (destination_node["organization_node_id"],),
                    "policies": (),
                    "batches": (),
                    "supply_mode": "local",
                    "relation_id": "",
                },
                "",
            )

        supplier_with_missing_path = False
        for candidate in self._organization_remote_candidates(destination_node["organization_node_id"]):
            path = candidate["path"]
            source_node_id = self.runtime_node_by_organization_id.get(path[0])
            if not source_node_id:
                continue
            source_node = self.nodes[source_node_id]
            if not self._organization_candidate_scope_matches(
                job,
                destination_node,
                path[0],
                resource_kind,
                "",
                supply_mode=candidate["supply_mode"],
                relation_id=candidate["relation_id"],
            ):
                continue
            available = int(source_node[capacity_key]) - int(source_node[in_use_key])
            if available < quantity:
                continue
            policies = self._organization_policies_for_path(path, resource_kind)
            if policies is None:
                supplier_with_missing_path = True
                continue
            batch_capacity = min(policy["capacity"] for policy in policies)
            remaining = quantity
            batches: list[int] = []
            while remaining > 0:
                batch = min(remaining, batch_capacity)
                batches.append(batch)
                remaining -= batch
            return (
                {
                    "source_node_id": source_node_id,
                    "path": path,
                    "policies": policies,
                    "batches": tuple(batches),
                    "supply_mode": candidate["supply_mode"],
                    "relation_id": candidate["relation_id"],
                },
                "",
            )
        if self.lateral_organization_enabled:
            return None, "no_supply_resource_path" if supplier_with_missing_path else "no_available_resource_supplier"
        return None, "no_vertical_resource_path" if supplier_with_missing_path else "no_available_resource_ancestor"

    def _ensure_canonical_job_resources(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        personnel: int,
        equipment: int,
    ) -> bool:
        if job.resource_reservations:
            return True

        requirements = {"personnel": personnel, "equipment": equipment}
        plans: dict[str, dict[str, Any]] = {}
        for resource_kind, quantity in requirements.items():
            plan, reason = self._canonical_resource_plan(job, destination_node, resource_kind, quantity)
            if plan is None:
                if resource_kind == "personnel":
                    self.resource_delay_events += 1
                else:
                    self.resource_delay_events += 1
                    self.equipment_shortage_events += 1
                job.shortage_reason = f"organization_{reason}:{resource_kind}"
                self._organization_event_once(
                    ("resource-blocked", job.job_id, job.task_index, resource_kind, reason),
                    "organization_resource_blocked",
                    f"{job.job_id} blocked by {resource_kind}",
                    {
                        "job_id": job.job_id,
                        "task_index": job.task_index,
                        "resource_kind": resource_kind,
                        "required_quantity": quantity,
                        "resource_id": destination_node["id"],
                        "organization_node_id": destination_node["organization_node_id"],
                        "reason": reason,
                    },
                )
                return False
            plans[resource_kind] = plan

        # All plans are validated before any capacity is mutated, so personnel and
        # equipment reservations are atomic even when their suppliers differ.
        for resource_kind, plan in plans.items():
            quantity = requirements[resource_kind]
            supplier = self.nodes[plan["source_node_id"]]
            supplier[f"{resource_kind}_in_use"] += quantity
            job.resource_reservations[resource_kind] = (supplier["id"], quantity)
        for resource_kind, plan in plans.items():
            quantity = requirements[resource_kind]
            policies = plan["policies"]
            policy_ids = tuple(policy["id"] for policy in policies)
            details = {
                "job_id": job.job_id,
                "task_index": job.task_index,
                "resource_kind": resource_kind,
                "quantity": quantity,
                "source_resource_id": plan["source_node_id"],
                "resource_id": destination_node["id"],
                "organization_path": list(plan["path"]),
                "transport_policy_ids": list(policy_ids),
                "supply_mode": plan["supply_mode"],
                "relation_id": plan["relation_id"],
            }
            self._event(
                "organization_resource_selected",
                f"selected {resource_kind} at {plan['source_node_id']} for {job.job_id}",
                details,
            )
            if not policies:
                self._event(
                    "organization_local_fulfilled",
                    f"{resource_kind} fulfilled locally for {job.job_id}",
                    details,
                )
                continue
            transport_minutes = sum(policy["transport_minutes"] for policy in policies)
            arrival_minute = self.minute + max(self.tick_minutes, transport_minutes)
            job.remote_resources_pending.add(resource_kind)
            for batch_sequence, batch_quantity in enumerate(plan["batches"], start=1):
                self.resource_transits.append(
                    ResourceTransit(
                        job_id=job.job_id,
                        task_index=job.task_index,
                        resource_kind=resource_kind,
                        quantity=batch_quantity,
                        source_node_id=plan["source_node_id"],
                        destination_node_id=destination_node["id"],
                        requested_minute=self.minute,
                        arrival_minute=arrival_minute,
                        path_organization_node_ids=plan["path"],
                        transport_policy_ids=policy_ids,
                        batch_sequence=batch_sequence,
                        supply_mode=plan["supply_mode"],
                        relation_id=plan["relation_id"],
                    )
                )
                self._event(
                    "organization_resource_dispatched",
                    f"dispatched {resource_kind} batch {batch_sequence} for {job.job_id}",
                    {
                        **details,
                        "quantity": batch_quantity,
                        "batch_sequence": batch_sequence,
                        "arrival_minute": arrival_minute,
                    },
                )
        job.shortage_reason = "organization_resources_in_transit" if job.remote_resources_pending else None
        return True

    def _raw_task_spare_requirements(self, task: dict[str, Any]) -> list[tuple[str, int]]:
        spare = task.get("spare")
        requirements: list[tuple[str, int]] = []
        if isinstance(spare, list):
            for item in spare:
                if not isinstance(item, dict):
                    continue
                spare_type = str(item.get("productId") or item.get("product_id") or item.get("name") or item.get("model") or "").strip()
                if _is_no_spare_value(spare_type):
                    continue
                quantity = _non_negative_int(item.get("quantity"), 1)
                if spare_type and quantity > 0:
                    requirements.append((self._product_id_for_label(spare_type), quantity))
        if isinstance(spare, str) and spare and not _is_no_spare_value(spare):
            parts = [part.strip() for part in spare.split(",") if part.strip()]
            if parts:
                quantity = 1
                for part in reversed(parts):
                    if part.isdigit():
                        quantity = max(0, int(part))
                        break
                if quantity > 0:
                    requirements.append((self._product_id_for_label(parts[0]), quantity))
        return requirements

    def _task_has_explicit_spare_requirement(self, task: dict[str, Any]) -> bool:
        if self._raw_task_spare_requirements(task):
            return True
        spare = task.get("spare")
        if isinstance(spare, list):
            return any(
                isinstance(item, dict)
                and str(item.get("productId") or item.get("product_id") or item.get("name") or item.get("model") or "").strip()
                and _non_negative_int(item.get("quantity"), 1) == 0
                for item in spare
            )
        if isinstance(spare, str) and spare and not _is_no_spare_value(spare):
            parts = [part.strip() for part in spare.split(",") if part.strip()]
            return bool(parts and parts[-1].isdigit() and int(parts[-1]) == 0)
        return False

    def _task_spare_requirements(self, job: JobState, task: dict[str, Any]) -> list[tuple[str, int]]:
        if job.kind in {"repair", "preventive"} and job.maintenance_method == "non_replacement":
            return []
        quantities: dict[str, int] = {}
        for spare_type, quantity in self._raw_task_spare_requirements(task):
            quantities[spare_type] = quantities.get(spare_type, 0) + quantity
        return list(quantities.items())

    def _task_spare_requirement(self, job: JobState, task: dict[str, Any]) -> tuple[str | None, int]:
        requirements = self._task_spare_requirements(job, task)
        return requirements[0] if requirements else (None, 0)

    def _shortage_spare_requirement(self, job: JobState, task: dict[str, Any]) -> tuple[str | None, int]:
        requirements = self._task_spare_requirements(job, task)
        shortage_type = str(job.shortage_reason or "").split(":", 1)[1] if ":" in str(job.shortage_reason or "") else ""
        if shortage_type:
            for spare_type, quantity in requirements:
                if spare_type == shortage_type:
                    return spare_type, quantity
        return requirements[0] if requirements else (None, 0)

    def _product_id_for_label(self, label: str) -> str:
        value = str(label or "").strip()
        if not value:
            return ""
        if any(value in node["inventory"] for node in self.nodes.values()):
            return value
        for component in self.equipment_tree_components:
            if value in {
                str(component.get("product_id") or ""),
                str(component.get("product_name") or ""),
            }:
                return str(component.get("product_id") or value)
        for node in self.nodes.values():
            for product_id, name in (node.get("product_names") or {}).items():
                if value in {str(product_id), str(name)}:
                    return str(product_id)
        return value

    def _consume_task_spare(self, job: JobState, task: dict[str, Any]) -> bool:
        if job.task_index in job.consumed_spare_task_indexes:
            return True
        requirements = self._task_spare_requirements(job, task)
        if not requirements:
            return True
        node = self.nodes.get(job.resource_node_id)
        if node is None:
            if self.canonical_organization_enabled:
                return False
            node = next(iter(self.nodes.values()))
        if any(
            self._available_spare_for_job(job, node, spare_type) < spare_quantity
            for spare_type, spare_quantity in requirements
        ):
            return False
        job.consumed_spare_task_indexes.add(job.task_index)
        for spare_type, spare_quantity in requirements:
            reservation_key = (job.task_index, spare_type)
            reserved = int(job.spare_reservations.get(reservation_key, 0))
            consumed_reserved = min(reserved, spare_quantity)
            if consumed_reserved:
                remaining_reserved = reserved - consumed_reserved
                if remaining_reserved:
                    job.spare_reservations[reservation_key] = remaining_reserved
                else:
                    job.spare_reservations.pop(reservation_key, None)
                    job.spare_reservation_supply_modes.pop(reservation_key, None)
            shared_quantity = spare_quantity - consumed_reserved
            if shared_quantity:
                current = int(node["inventory"].get(spare_type, 0))
                node["inventory"][spare_type] = current - shared_quantity
            self.spare_consumed_total += spare_quantity
            consumption_key = (str(node["id"]), str(spare_type))
            self.spare_consumed_by_node_product[consumption_key] = (
                self.spare_consumed_by_node_product.get(consumption_key, 0) + spare_quantity
            )
            aircraft = self._aircraft_by_tail(job.tail_number)
            display_name = self._product_display_name(spare_type)
            self._event(
                "spare_consumed",
                f"{job.job_id} consumed {spare_quantity} {display_name}",
                {
                    "job_id": job.job_id,
                    "aircraft_model": aircraft.aircraft_type if aircraft is not None else "全部机型",
                    "resource_id": node["id"],
                    "product_id": spare_type,
                    "spare_type": display_name,
                    "quantity": spare_quantity,
                    "maintenance_method": job.maintenance_method,
                },
            )
        return True

    def _available_spare_for_job(
        self,
        job: JobState,
        node: dict[str, Any],
        spare_type: str,
    ) -> int:
        shared = int(node["inventory"].get(spare_type, 0) or 0)
        if not self.canonical_organization_enabled:
            return shared
        if not self._organization_candidate_scope_matches(
            job,
            node,
            node["organization_node_id"],
            "spare",
            spare_type,
        ):
            shared = 0
        return shared + int(job.spare_reservations.get((job.task_index, spare_type), 0))

    def _has_in_transit_spare_for_job(self, job: JobState, spare_type: str) -> bool:
        return any(
            shipment.job_id == job.job_id
            and shipment.task_index == job.task_index
            and shipment.spare_type == spare_type
            for shipment in self.transport_shipments
        )

    def _organization_ancestor_paths(self, destination_organization_id: str) -> list[tuple[str, ...]]:
        """Return nearest-first vertical paths from each ancestor down to the destination."""
        reversed_path = [destination_organization_id]
        cursor = self.organization_parent_by_id.get(destination_organization_id)
        paths: list[tuple[str, ...]] = []
        while cursor is not None:
            reversed_path.append(cursor)
            paths.append(tuple(reversed(reversed_path)))
            cursor = self.organization_parent_by_id.get(cursor)
        return paths

    def _organization_remote_candidates(
        self,
        destination_organization_id: str,
    ) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        if self.lateral_organization_enabled:
            for relation in self.organization_lateral_edges:
                if not relation["enabled"] or relation["to_node_id"] != destination_organization_id:
                    continue
                candidates.append(
                    {
                        "path": (relation["from_node_id"], destination_organization_id),
                        "supply_mode": "lateral",
                        "relation_id": relation["id"],
                    }
                )
        candidates.extend(
            {
                "path": path,
                "supply_mode": "vertical",
                "relation_id": "",
            }
            for path in self._organization_ancestor_paths(destination_organization_id)
        )
        return candidates

    def _organization_candidate_scope_matches(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        source_organization_id: str,
        resource_kind: str,
        product_id: str,
        *,
        supply_mode: str = "local",
        relation_id: str = "",
    ) -> bool:
        if not self.lateral_organization_enabled:
            return True
        mismatch = self._organization_candidate_scope_mismatch(
            job,
            destination_node,
            source_organization_id,
            resource_kind,
            product_id,
        )
        if mismatch is None:
            return True
        scope_dimension, requested_value, allowed_values = mismatch
        source_resource_id = self.runtime_node_by_organization_id.get(source_organization_id, "")
        details = {
            "job_id": job.job_id,
            "task_index": job.task_index,
            "resource_kind": resource_kind,
            "product_id": product_id,
            "source_resource_id": source_resource_id,
            "source_organization_node_id": source_organization_id,
            "destination_resource_id": destination_node["id"],
            "destination_organization_node_id": destination_node["organization_node_id"],
            "supply_mode": supply_mode,
            "relation_id": relation_id,
            "reason": "scope_mismatch",
            "scope_dimension": scope_dimension,
            "requested_value": requested_value,
            "allowed_values": list(allowed_values),
        }
        self._organization_event_once(
            (
                "organization_candidate_rejected",
                job.job_id,
                job.task_index,
                resource_kind,
                product_id,
                source_organization_id,
                destination_node["organization_node_id"],
                supply_mode,
                relation_id,
                scope_dimension,
                requested_value,
                allowed_values,
            ),
            "organization_candidate_rejected",
            f"rejected {supply_mode} organization candidate {source_organization_id} for scope mismatch",
            details,
        )
        return False

    def _organization_candidate_scope_mismatch(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        source_organization_id: str,
        resource_kind: str,
        product_id: str,
    ) -> tuple[str, str, tuple[str, ...]] | None:
        scope = self.organization_nodes[source_organization_id]["service_scope"]
        if scope["resource_types"] and resource_kind not in scope["resource_types"]:
            return "resource_types", resource_kind, scope["resource_types"]
        if resource_kind == "spare" and scope["product_ids"] and product_id not in scope["product_ids"]:
            return "product_ids", product_id, scope["product_ids"]
        aircraft = self._aircraft_by_tail(job.tail_number)
        aircraft_model = ""
        if aircraft is not None:
            aircraft_model = str(aircraft.model or aircraft.aircraft_type or "").strip()
        if scope["aircraft_models"] and aircraft_model not in scope["aircraft_models"]:
            return "aircraft_models", aircraft_model, scope["aircraft_models"]
        destination_airport = str(
            destination_node.get("airport_id") or destination_node.get("airport") or ""
        ).strip()
        if scope["airport_ids"] and destination_airport not in scope["airport_ids"]:
            return "airport_ids", destination_airport, scope["airport_ids"]
        return None

    def _organization_policy_for_edge(
        self,
        source_organization_id: str,
        destination_organization_id: str,
        product_id: str,
    ) -> dict[str, Any] | None:
        edge_policies = [
            policy
            for policy in self.organization_transport_policies
            if policy["from_organization_node_id"] == source_organization_id
            and policy["to_organization_node_id"] == destination_organization_id
        ]
        product_specific = [policy for policy in edge_policies if policy["product_id"] == product_id]
        candidates = product_specific or [
            policy for policy in edge_policies if policy["product_id"] in {"", "*"}
        ]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda policy: (
                policy["priority"],
                policy["transport_minutes"],
                policy["id"],
            ),
        )

    def _organization_policies_for_path(
        self,
        path: tuple[str, ...],
        product_id: str,
    ) -> tuple[dict[str, Any], ...] | None:
        policies: list[dict[str, Any]] = []
        for source_id, destination_id in zip(path, path[1:]):
            policy = self._organization_policy_for_edge(source_id, destination_id, product_id)
            if policy is None:
                return None
            policies.append(policy)
        return tuple(policies)

    def _canonical_spare_dispatch_plan(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        spare_type: str,
        needed: int,
    ) -> tuple[dict[str, Any] | None, str]:
        shortage = max(0, needed - self._available_spare_for_job(job, destination_node, spare_type))
        if shortage <= 0 or self._has_in_transit_spare_for_job(job, spare_type):
            return None, ""
        destination_organization_id = destination_node["organization_node_id"]
        supplier_with_missing_path = False
        for candidate in self._organization_remote_candidates(destination_organization_id):
            path = candidate["path"]
            source_node_id = self.runtime_node_by_organization_id.get(path[0])
            if not source_node_id:
                continue
            source_node = self.nodes[source_node_id]
            if not self._organization_candidate_scope_matches(
                job,
                destination_node,
                path[0],
                "spare",
                spare_type,
                supply_mode=candidate["supply_mode"],
                relation_id=candidate["relation_id"],
            ):
                continue
            available = int(source_node["inventory"].get(spare_type, 0))
            if available <= 0:
                continue
            policies = self._organization_policies_for_path(path, spare_type)
            if policies is None:
                supplier_with_missing_path = True
                continue
            path_capacity = min(policy["capacity"] for policy in policies)
            moved = min(shortage, available, path_capacity)
            if moved <= 0:
                continue
            policy_ids = tuple(policy["id"] for policy in policies)
            batch_counter_key = (job.job_id, job.task_index, spare_type)
            batch_sequence = self._transport_batch_counts.get(batch_counter_key, 0) + 1
            shipment_key = (job.job_id, job.task_index, spare_type, policy_ids, batch_sequence)
            if shipment_key in self._transport_shipment_keys:
                return None, ""
            transport_minutes = sum(policy["transport_minutes"] for policy in policies)
            arrival_minute = self.minute + max(self.tick_minutes, transport_minutes)
            return {
                "source_node": source_node,
                "available": available,
                "batch_counter_key": batch_counter_key,
                "shipment_key": shipment_key,
                "shipment": TransportShipment(
                    source_node_id=source_node_id,
                    destination_node_id=destination_node["id"],
                    spare_type=spare_type,
                    quantity=moved,
                    requested_minute=self.minute,
                    arrival_minute=arrival_minute,
                    job_id=job.job_id,
                    task_index=job.task_index,
                    path_organization_node_ids=path,
                    transport_policy_ids=policy_ids,
                    batch_sequence=batch_sequence,
                    supply_mode=candidate["supply_mode"],
                    relation_id=candidate["relation_id"],
                ),
                "details": {
                    "job_id": job.job_id,
                    "task_index": job.task_index,
                    "product_id": spare_type,
                    "quantity": moved,
                    "source_resource_id": source_node_id,
                    "resource_id": destination_node["id"],
                    "organization_path": list(path),
                    "transport_policy_ids": list(policy_ids),
                    "batch_sequence": batch_sequence,
                    "arrival_minute": arrival_minute,
                    "supply_mode": candidate["supply_mode"],
                    "relation_id": candidate["relation_id"],
                },
            }, ""

        if self.lateral_organization_enabled:
            reason = "no_supply_path" if supplier_with_missing_path else "no_available_supplier"
        else:
            reason = "no_vertical_path" if supplier_with_missing_path else "no_available_ancestor"
        return None, reason

    def _ensure_canonical_spare_dispatches(
        self,
        job: JobState,
        destination_node: dict[str, Any],
        requirements: list[tuple[str, int]],
    ) -> dict[str, str]:
        plans: list[dict[str, Any]] = []
        local_reservations: list[tuple[str, int]] = []
        failures: dict[str, str] = {}
        for spare_type, needed in requirements:
            reservation_key = (job.task_index, spare_type)
            already_reserved = int(job.spare_reservations.get(reservation_key, 0))
            local_in_scope = self._organization_candidate_scope_matches(
                job,
                destination_node,
                destination_node["organization_node_id"],
                "spare",
                spare_type,
            )
            shared_quantity = (
                int(destination_node["inventory"].get(spare_type, 0) or 0)
                if local_in_scope else 0
            )
            local_quantity = min(shared_quantity, max(0, needed - already_reserved))
            if local_quantity:
                local_reservations.append((spare_type, local_quantity))
            plan, reason = self._canonical_spare_dispatch_plan(
                job, destination_node, spare_type, needed
            )
            if reason:
                failures[spare_type] = f"organization_{reason}:{spare_type}"
            elif plan is not None:
                plans.append(plan)
        if failures:
            for spare_type, failure_reason in failures.items():
                reason = failure_reason.split(":", 1)[0].removeprefix("organization_")
                details = {
                    "job_id": job.job_id,
                    "task_index": job.task_index,
                    "product_id": spare_type,
                    "resource_id": destination_node["id"],
                    "organization_node_id": destination_node["organization_node_id"],
                    "reason": reason,
                }
                self._organization_event_once(
                    ("spare-blocked", job.job_id, job.task_index, spare_type, reason),
                    "organization_dispatch_failed",
                    f"unable to dispatch {spare_type} for {job.job_id}",
                    details,
                )
            return failures

        # Planning is side-effect free. Local stock and every ancestor shipment
        # are committed together only after the whole task is feasible.
        for spare_type, quantity in local_reservations:
            reservation_key = (job.task_index, spare_type)
            destination_node["inventory"][spare_type] = (
                int(destination_node["inventory"].get(spare_type, 0)) - quantity
            )
            job.spare_reservations[reservation_key] = (
                int(job.spare_reservations.get(reservation_key, 0)) + quantity
            )
            job.spare_reservation_supply_modes.setdefault(reservation_key, set()).add("local")
        for plan in plans:
            shipment = plan["shipment"]
            source_node = plan["source_node"]
            source_node["inventory"][shipment.spare_type] = plan["available"] - shipment.quantity
            self.transport_shipments.append(shipment)
            self._transport_shipment_keys.add(plan["shipment_key"])
            self._transport_batch_counts[plan["batch_counter_key"]] = shipment.batch_sequence
            self.transport_replenishment_events += 1
            self._event(
                "organization_supply_selected",
                f"selected {shipment.source_node_id} for {job.job_id}",
                plan["details"],
            )
            self._event(
                "organization_transport_dispatched",
                f"dispatched {shipment.quantity} {shipment.spare_type} from {shipment.source_node_id}",
                plan["details"],
            )
        return {}


    def _product_display_name(self, product_id: str) -> str:
        key = str(product_id or "")
        for component in self.equipment_tree_components:
            if str(component.get("product_id") or "") == key:
                return str(component.get("product_name") or key)
        for node in self.nodes.values():
            name = (node.get("product_names") or {}).get(key)
            if name:
                return str(name)
        return key


__all__ = ["SupportEngineMixin"]
