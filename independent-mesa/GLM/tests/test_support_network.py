from __future__ import annotations

import unittest

import numpy as np

from independent_mesa.support_network import (
    SupportNetwork,
    TransportOrder,
)


def _sample_resources() -> list[dict]:
    return [
        {
            "id": "carrier-deck", "name": "航母飞行甲板", "capacity": 4,
            "nodeType": "甲板保障点", "supportLevel": "一线保障",
            "personnelCapacity": 5, "equipmentCapacity": 3,
            "policy": "优先保障高优先级任务",
            "lateralSupportNodes": ["forward-sea-base"],
            "transportPolicies": [
                {"from": "carrier-stock", "to": "carrier-deck", "transportMode": "升降机转运",
                 "transportTimeHours": 1, "priority": 1, "capacity": 4}
            ],
            "inventory": {"发动机备件": 4, "航电模块": 6, "液压备件": 5},
        },
        {
            "id": "forward-sea-base", "name": "前出海上保障点", "capacity": 3,
            "nodeType": "海上保障点", "supportLevel": "前进保障",
            "personnelCapacity": 4, "equipmentCapacity": 2,
            "lateralSupportNodes": ["carrier-deck"],
            "transportPolicies": [
                {"from": "carrier-deck", "to": "forward-sea-base", "transportMode": "补给艇转运",
                 "transportTimeHours": 2, "priority": 1, "capacity": 2}
            ],
            "inventory": {"发动机备件": 2, "航电模块": 3, "液压备件": 2},
        },
        {
            "id": "carrier-stock", "name": "航母备件库", "capacity": 5,
            "nodeType": "备件库", "supportLevel": "后方保障",
            "personnelCapacity": 3, "equipmentCapacity": 2,
            "lateralSupportNodes": ["carrier-deck"],
            "transportPolicies": [
                {"from": "carrier-deck", "to": "carrier-stock", "transportMode": "返修转运",
                 "transportTimeHours": 3, "priority": 2, "capacity": 3}
            ],
            "inventory": {"发动机备件": 6, "航电模块": 8, "液压备件": 6},
        },
    ]


class TestSupportNetwork(unittest.TestCase):
    def test_init_creates_three_nodes(self) -> None:
        net = SupportNetwork(_sample_resources())
        self.assertIn("carrier-deck", net.nodes)
        self.assertIn("forward-sea-base", net.nodes)
        self.assertIn("carrier-stock", net.nodes)

    def test_initial_inventory(self) -> None:
        net = SupportNetwork(_sample_resources())
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 4)
        self.assertEqual(net.nodes["carrier-stock"].inventory["航电模块"], 8)

    def test_consume_spare_decreases_inventory(self) -> None:
        net = SupportNetwork(_sample_resources())
        ok = net.consume_spare("carrier-deck", "航电模块", 2)
        self.assertTrue(ok)
        self.assertEqual(net.nodes["carrier-deck"].inventory["航电模块"], 4)

    def test_consume_spare_insufficient_returns_false(self) -> None:
        net = SupportNetwork(_sample_resources())
        ok = net.consume_spare("carrier-deck", "航电模块", 999)
        self.assertFalse(ok)

    def test_resource_pool_allocate_and_release(self) -> None:
        net = SupportNetwork(_sample_resources())
        pool = net.nodes["carrier-deck"].personnel_pool
        self.assertEqual(pool.available, 5)
        pool.allocate(2)
        self.assertEqual(pool.available, 3)
        pool.release(2)
        self.assertEqual(pool.available, 5)

    def test_transport_order_arrives(self) -> None:
        net = SupportNetwork(_sample_resources())
        order = net.create_transport_order(
            spare_type="发动机备件", quantity=2,
            from_node="carrier-stock", to_node="carrier-deck",
            transport_time_hours=1.0, sim_time=0.0,
        )
        self.assertIsInstance(order, TransportOrder)
        self.assertEqual(order.due_time, 60.0)
        # Before arrival
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 4)
        # Advance to arrival
        net.process_arrivals(60.0)
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 6)

    def test_critical_inventory_triggers_replenishment(self) -> None:
        net = SupportNetwork(_sample_resources())
        # Set critical inventory config via transport strategy
        net.check_and_trigger_replenishment(sim_time=0.0)
        # Carrier-deck has plenty, should not trigger
        self.assertEqual(len(net.pending_orders), 0)
        # Drain inventory to trigger
        net.nodes["carrier-deck"].inventory["航电模块"] = 1
        net.nodes["carrier-deck"].critical_inventory["航电模块"] = 2
        net.check_and_trigger_replenishment(sim_time=0.0)
        self.assertGreater(len(net.pending_orders), 0)


if __name__ == "__main__":
    unittest.main()
