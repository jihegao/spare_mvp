"""TransportEngine behavior for aircraft-support v1."""

from __future__ import annotations

from typing import Any

from .state import TransportShipment

class TransportEngineMixin:
    def _process_arrivals_and_completions(self) -> None:
        self._process_transport_arrivals()
        self._process_mission_returns()
        self._process_job_progress_and_completions()

    def _process_transport_arrivals(self) -> None:
        self._return_cancelled_spare_reservations()
        arrived = [shipment for shipment in self.transport_shipments if shipment.arrival_minute <= self.minute]
        self.transport_shipments = [
            shipment for shipment in self.transport_shipments if shipment.arrival_minute > self.minute
        ]
        for shipment in arrived:
            node = self.nodes.get(shipment.destination_node_id)
            if node is None:
                continue
            requesting_job = next(
                (job for job in self.jobs if job.job_id == shipment.job_id),
                None,
            )
            reserve_for_job = bool(
                self.canonical_organization_enabled
                and requesting_job is not None
                and requesting_job.task_index == shipment.task_index
                and requesting_job.state == "waiting"
            )
            if reserve_for_job:
                reservation_key = (shipment.task_index, shipment.spare_type)
                requesting_job.spare_reservations[reservation_key] = (
                    int(requesting_job.spare_reservations.get(reservation_key, 0)) + shipment.quantity
                )
                requesting_job.spare_reservation_supply_modes.setdefault(reservation_key, set()).add(
                    shipment.supply_mode
                )
            else:
                node["inventory"][shipment.spare_type] = (
                    int(node["inventory"].get(shipment.spare_type, 0)) + shipment.quantity
                )
            self.total_transport_delay += max(0, shipment.arrival_minute - shipment.requested_minute)
            self._event(
                "transport_arrived",
                f"{shipment.quantity} {shipment.spare_type} arrived at {shipment.destination_node_id}",
                {
                    "product_id": shipment.spare_type,
                    "quantity": shipment.quantity,
                    "source_resource_id": shipment.source_node_id,
                    "resource_id": shipment.destination_node_id,
                },
            )
            if self.canonical_organization_enabled:
                self._event(
                    "organization_transport_arrived",
                    f"organization shipment arrived for {shipment.job_id}",
                    {
                        "job_id": shipment.job_id,
                        "task_index": shipment.task_index,
                        "product_id": shipment.spare_type,
                        "quantity": shipment.quantity,
                        "source_resource_id": shipment.source_node_id,
                        "resource_id": shipment.destination_node_id,
                        "organization_path": list(shipment.path_organization_node_ids),
                        "transport_policy_ids": list(shipment.transport_policy_ids),
                        "supply_mode": shipment.supply_mode,
                        "relation_id": shipment.relation_id,
                        "reserved_for_job": reserve_for_job,
                        "requested_minute": shipment.requested_minute,
                        "arrival_minute": shipment.arrival_minute,
                        "wait_minutes": max(0, shipment.arrival_minute - shipment.requested_minute),
                    },
                )

        arrived_resources = [
            transit for transit in self.resource_transits if transit.arrival_minute <= self.minute
        ]
        self.resource_transits = [
            transit for transit in self.resource_transits if transit.arrival_minute > self.minute
        ]
        arrived_resource_keys: set[tuple[str, int, str]] = set()
        for transit in arrived_resources:
            job = next((item for item in self.jobs if item.job_id == transit.job_id), None)
            if job is None or job.task_index != transit.task_index:
                continue
            arrived_resource_keys.add((job.job_id, job.task_index, transit.resource_kind))
            self._event(
                "organization_resource_arrived",
                f"{transit.resource_kind} arrived for {transit.job_id}",
                {
                    "job_id": transit.job_id,
                    "task_index": transit.task_index,
                    "resource_kind": transit.resource_kind,
                    "quantity": transit.quantity,
                    "source_resource_id": transit.source_node_id,
                    "resource_id": transit.destination_node_id,
                    "organization_path": list(transit.path_organization_node_ids),
                    "transport_policy_ids": list(transit.transport_policy_ids),
                    "batch_sequence": transit.batch_sequence,
                    "supply_mode": transit.supply_mode,
                    "relation_id": transit.relation_id,
                    "requested_minute": transit.requested_minute,
                    "arrival_minute": transit.arrival_minute,
                    "wait_minutes": max(0, transit.arrival_minute - transit.requested_minute),
                },
            )
        for job_id, task_index, resource_kind in arrived_resource_keys:
            if any(
                transit.job_id == job_id
                and transit.task_index == task_index
                and transit.resource_kind == resource_kind
                for transit in self.resource_transits
            ):
                continue
            job = next((item for item in self.jobs if item.job_id == job_id), None)
            if job is not None and job.task_index == task_index:
                job.remote_resources_pending.discard(resource_kind)

    def _return_cancelled_spare_reservations(self) -> None:
        for job in self.jobs:
            if job.state not in {"cancelled", "canceled"} or not job.spare_reservations:
                continue
            destination = self.nodes.get(job.resource_node_id)
            if destination is None:
                continue
            returned: list[dict[str, Any]] = []
            for (task_index, spare_type), quantity in list(job.spare_reservations.items()):
                destination["inventory"][spare_type] = (
                    int(destination["inventory"].get(spare_type, 0)) + quantity
                )
                returned.append(
                    {"task_index": task_index, "product_id": spare_type, "quantity": quantity}
                )
            job.spare_reservations.clear()
            job.spare_reservation_supply_modes.clear()
            self._event(
                "organization_spare_reservation_returned",
                f"returned cancelled spare reservations for {job.job_id}",
                {"job_id": job.job_id, "resource_id": destination["id"], "products": returned},
            )

    def _has_in_transit_spare(self, node_id: str, spare_type: str) -> bool:
        return any(
            shipment.destination_node_id == node_id and shipment.spare_type == spare_type
            for shipment in self.transport_shipments
        )

    def _try_transport_replenishment(self, node: dict[str, Any], spare_type: str, needed: int) -> None:
        shortage = max(0, needed - int(node["inventory"].get(spare_type, 0)))
        if shortage <= 0:
            return

        for policy in node.get("transport_policies") or []:
            if policy.get("to") and policy["to"] != node["id"]:
                continue
            if policy.get("spare_type") and policy["spare_type"] != spare_type:
                continue
            source = self.nodes.get(str(policy.get("from") or ""))
            if source is None:
                continue
            available = int(source["inventory"].get(spare_type, 0))
            moved = min(available, shortage, max(1, int(policy.get("capacity") or 1)))
            if moved <= 0:
                continue
            source["inventory"][spare_type] = available - moved
            self.transport_replenishment_events += 1
            transport_minutes = max(0, int(policy.get("transport_minutes") or 0))
            if transport_minutes:
                self.transport_shipments.append(
                    TransportShipment(
                        source_node_id=str(source["id"]),
                        destination_node_id=str(node["id"]),
                        spare_type=spare_type,
                        quantity=moved,
                        requested_minute=self.minute,
                        arrival_minute=self.minute + transport_minutes,
                    )
                )
                self._event(
                    "transport_dispatched",
                    f"{moved} {spare_type} dispatched from {source['id']} to {node['id']}",
                    {
                        "product_id": spare_type,
                        "quantity": moved,
                        "source_resource_id": source["id"],
                        "resource_id": node["id"],
                        "arrival_minute": self.minute + transport_minutes,
                    },
                )
                return
            node["inventory"][spare_type] = int(node["inventory"].get(spare_type, 0)) + moved
            self._event(
                "transport_replenished",
                f"{moved} {spare_type} moved from {source['id']} to {node['id']}",
                {
                    "product_id": spare_type,
                    "quantity": moved,
                    "source_resource_id": source["id"],
                    "resource_id": node["id"],
                },
            )
            return


__all__ = ["TransportEngineMixin"]
