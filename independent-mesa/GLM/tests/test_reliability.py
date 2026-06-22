from __future__ import annotations

import math
import unittest

from independent_mesa.reliability import (
    ReliabilityBlock,
    build_reliability_diagram,
    evaluate_system_reliability,
)


class TestReliabilityDiagram(unittest.TestCase):
    def _sample_rbd(self) -> dict:
        return {
            "nodes": [
                {"id": "aircraft", "name": "整机", "type": "system", "connectionType": "串联", "failureRate": 0.01, "mtbfHours": 300, "parentId": None},
                {"id": "engine", "name": "发动机", "type": "component", "connectionType": "串联", "failureRate": 0.055, "mtbfHours": 95, "parentId": "aircraft"},
                {"id": "avionics", "name": "航电系统", "type": "component", "connectionType": "并联", "failureRate": 0.04, "mtbfHours": 120, "parentId": "aircraft"},
                {"id": "hydraulic", "name": "液压系统", "type": "component", "connectionType": "备用", "failureRate": 0.05, "mtbfHours": 105, "parentId": "aircraft"},
            ],
            "edges": [
                {"from": "aircraft", "to": "engine", "type": "串联", "weight": 1},
                {"from": "aircraft", "to": "avionics", "type": "并联", "weight": 0.6},
                {"from": "aircraft", "to": "hydraulic", "type": "备用", "weight": 0.8},
            ],
        }

    def test_build_diagram_creates_blocks(self) -> None:
        rbd = self._sample_rbd()
        blocks = build_reliability_diagram(rbd)
        self.assertEqual(len(blocks), 4)
        self.assertIn("aircraft", blocks)
        self.assertEqual(blocks["engine"].connection_type, "串联")

    def test_series_reliability_is_product(self) -> None:
        rbd = self._sample_rbd()
        blocks = build_reliability_diagram(rbd)
        reliability = evaluate_system_reliability(blocks, dt_hours=1.0)
        self.assertGreater(reliability, 0.0)
        self.assertLessEqual(reliability, 1.0)

    def test_series_lower_than_parallel(self) -> None:
        blocks_series = build_reliability_diagram({
            "nodes": [
                {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
                {"id": "a", "name": "a", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
                {"id": "b", "name": "b", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
            ],
            "edges": [
                {"from": "s", "to": "a", "type": "串联"},
                {"from": "s", "to": "b", "type": "串联"},
            ],
        })
        blocks_parallel = build_reliability_diagram({
            "nodes": [
                {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
                {"id": "a", "name": "a", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
                {"id": "b", "name": "b", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
            ],
            "edges": [
                {"from": "s", "to": "a", "type": "并联"},
                {"from": "s", "to": "b", "type": "并联"},
            ],
        })
        r_series = evaluate_system_reliability(blocks_series, 1.0)
        r_parallel = evaluate_system_reliability(blocks_parallel, 1.0)
        self.assertGreater(r_parallel, r_series)

    def test_standby_reliability_between_series_and_parallel(self) -> None:
        rbd_series = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "串联"}, {"from": "s", "to": "b", "type": "串联"}]}
        rbd_standby = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "备用", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "备用", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "备用"}, {"from": "s", "to": "b", "type": "备用"}]}
        rbd_parallel = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "并联"}, {"from": "s", "to": "b", "type": "并联"}]}
        r_s = evaluate_system_reliability(build_reliability_diagram(rbd_series), 1.0)
        r_sb = evaluate_system_reliability(build_reliability_diagram(rbd_standby), 1.0)
        r_p = evaluate_system_reliability(build_reliability_diagram(rbd_parallel), 1.0)
        self.assertGreater(r_sb, r_s)
        self.assertLessEqual(r_sb, r_p)


if __name__ == "__main__":
    unittest.main()