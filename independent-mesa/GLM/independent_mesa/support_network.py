"""Support network: 3-level nodes, resource pools, inventory, transport."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ResourcePool:
    capacity: int
    in_use: int = 0
    busy_time: float = 0.0
    work_count: int = 0

    @property
    def available(self) -> int:
        return self.capacity - self.in_use

    def allocate(self, amount: int) -> bool:
        if self.available < amount:
            return False
        self.in_use += amount
        self.work_count += amount
        return True

    def release(self, amount: int) -> None:
        self.in_use = max(0, self.in_use - amount)

    def charge_busy_time(self, dt: float) -> None:
        self.busy_time += self.in_use * dt

    def utilization(self, elapsed: float) -> float:
        if self.capacity <= 0 or elapsed <= 0:
            return 0.0
        return min(1.0, self.busy_time / (self.capacity * elapsed))


@dataclass
class SupportNode:
    id: str
    name: str
    node_type: str
    support_level: str
    capacity: int
    personnel_pool: ResourcePool
    equipment_pool: ResourcePool
    inventory: dict[str, int]
    critical_inventory: dict[str, int] = field(default_factory=dict)
    lateral_support_nodes: list[str] = field(default_factory=list)
    transport_policies: list[dict[str, Any]] = field(default_factory=list)
    policy: str = ""


@dataclass
class TransportOrder:
    order_id: int
    spare_type: str
    quantity: int
    from_node: str
    to_node: str
    transport_time_hours: float
    created_time: float
    due_time: float
    transport_mode: str = ""
    status: str = "in_transit"


class SupportNetwork:
    """Manages support nodes, their inventories, resource pools, and transport."""

    def __init__(self, resources: list[dict[str, Any]]) -> None:
        self.nodes: dict[str, SupportNode] = {}
        self._order_counter = 0
        self.pending_orders: list[TransportOrder] = []
        self.arrived_order_delays: list[float] = []
        for res in resources:
            node_id = str(res["id"])
            personnel_cap = int(res.get("personnelCapacity", res.get("capacity", 1)))
            equip_cap = int(res.get("equipmentCapacity", res.get("capacity", 1)))
            inventory = dict(res.get("inventory", {}))
            critical = {k: max(1, v // 3) for k, v in inventory.items() if v > 0}
            self.nodes[node_id] = SupportNode(
                id=node_id,
                name=str(res.get("name", node_id)),
                node_type=str(res.get("nodeType", "")),
                support_level=str(res.get("supportLevel", "")),
                capacity=int(res.get("capacity", 1)),
                personnel_pool=ResourcePool(capacity=personnel_cap),
                equipment_pool=ResourcePool(capacity=equip_cap),
                inventory=inventory,
                critical_inventory=critical,
                lateral_support_nodes=list(res.get("lateralSupportNodes", [])),
                transport_policies=list(res.get("transportPolicies", [])),
                policy=str(res.get("policy", "")),
            )

    def consume_spare(self, node_id: str, spare_type: str, amount: int) -> bool:
        node = self.nodes.get(node_id)
        if node is None:
            return False
        current = node.inventory.get(spare_type, 0)
        if current < amount:
            return False
        node.inventory[spare_type] = current - amount
        return True

    def add_spare(self, node_id: str, spare_type: str, amount: int) -> None:
        node = self.nodes.get(node_id)
        if node is None:
            return
        node.inventory[spare_type] = node.inventory.get(spare_type, 0) + amount

    def create_transport_order(
        self,
        spare_type: str,
        quantity: int,
        from_node: str,
        to_node: str,
        transport_time_hours: float,
        sim_time: float,
        transport_mode: str = "",
    ) -> TransportOrder:
        self._order_counter += 1
        order = TransportOrder(
            order_id=self._order_counter,
            spare_type=spare_type,
            quantity=quantity,
            from_node=from_node,
            to_node=to_node,
            transport_time_hours=transport_time_hours,
            created_time=sim_time,
            due_time=sim_time + transport_time_hours * 60,
            transport_mode=transport_mode,
        )
        self.pending_orders.append(order)
        return order

    def process_arrivals(self, sim_time: float) -> None:
        arrived = [o for o in self.pending_orders if o.due_time <= sim_time]
        self.pending_orders = [o for o in self.pending_orders if o.due_time > sim_time]
        for order in arrived:
            order.status = "arrived"
            self.arrived_order_delays.append(order.due_time - order.created_time)
            self.add_spare(order.to_node, order.spare_type, order.quantity)

    def check_and_trigger_replenishment(self, sim_time: float) -> None:
        """Check all nodes for critical inventory and trigger transport orders."""
        for node in self.nodes.values():
            for spare_type, quantity in node.inventory.items():
                critical = node.critical_inventory.get(spare_type, 0)
                if critical > 0 and quantity <= critical:
                    for policy in node.transport_policies:
                        from_id = str(policy.get("from", ""))
                        to_id = str(policy.get("to", ""))
                        if to_id == node.id and from_id in self.nodes:
                            source = self.nodes[from_id]
                            source_qty = source.inventory.get(spare_type, 0)
                            if source_qty > 0:
                                transfer = min(source_qty, int(policy.get("capacity", 1)))
                                self.create_transport_order(
                                    spare_type=spare_type,
                                    quantity=transfer,
                                    from_node=from_id,
                                    to_node=node.id,
                                    transport_time_hours=float(policy.get("transportTimeHours", 1)),
                                    sim_time=sim_time,
                                    transport_mode=str(policy.get("transportMode", "")),
                                )
                                source.inventory[spare_type] = source_qty - transfer
                                break

    def get_total_inventory(self, spare_type: str) -> int:
        return sum(node.inventory.get(spare_type, 0) for node in self.nodes.values())

    def charge_busy_time(self, dt: float) -> None:
        for node in self.nodes.values():
            node.personnel_pool.charge_busy_time(dt)
            node.equipment_pool.charge_busy_time(dt)
