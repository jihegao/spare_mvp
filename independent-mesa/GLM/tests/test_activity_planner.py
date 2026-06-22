from __future__ import annotations

import unittest

import numpy as np

from independent_mesa.activity_planner import (
    ActivityJob,
    ActivityPlanner,
    sample_duration,
    build_job_dag,
    topological_sort,
)


def _sample_activities() -> list[dict]:
    return [
        {
            "id": "preflight", "name": "飞行前保障", "activityType": "飞行前保障",
            "equipmentId": "j15-avionics", "resourceId": "carrier-deck",
            "durationHours": 1, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": None, "spareQuantity": 0, "priority": 1,
            "jobs": [
                {
                    "activityCode": "OPS-001", "workName": "机务检查", "predecessors": [],
                    "durationMinutes": 45,
                    "durationProfile": {"distributionType": "三角分布", "min": 35, "mode": 45, "max": 60},
                    "personnel": "机务/航电,2", "facility": "甲板保障站位",
                    "equipment": "检测仪,DT-01,1", "spare": "无",
                },
                {
                    "activityCode": "OPS-002", "workName": "燃油加注", "predecessors": ["OPS-001"],
                    "durationMinutes": 60,
                    "durationProfile": {"distributionType": "均匀分布", "min": 50, "max": 70},
                    "personnel": "机务/油料,1", "facility": "甲板加油站位",
                    "equipment": "加油车,F-01,1", "spare": "无",
                },
            ],
        },
        {
            "id": "corrective", "name": "航电模块故障修复", "activityType": "修复性维修",
            "equipmentId": "j15-avionics", "resourceId": "carrier-deck",
            "durationHours": 3, "requiredPersonnel": 3, "requiredDevices": 1,
            "spareType": "航电模块", "spareQuantity": 1, "priority": 1,
            "repairDistribution": {"distributionType": "对数正态分布", "params": "mu=5.1, sigma=0.35"},
            "jobs": [
                {
                    "activityCode": "REP-001", "workName": "故障定位", "predecessors": [],
                    "durationMinutes": 40,
                    "durationProfile": {"distributionType": "三角分布", "min": 30, "mode": 40, "max": 55},
                    "personnel": "维修/航电,2", "facility": "维修工位",
                    "equipment": "检测仪,DT-01,1", "spare": "无",
                },
                {
                    "activityCode": "REP-002", "workName": "换件维修", "predecessors": ["REP-001"],
                    "durationMinutes": 90,
                    "durationProfile": {"distributionType": "正态分布", "mean": 90, "stdDev": 15},
                    "personnel": "维修/航电,2", "facility": "维修工位",
                    "equipment": "通用工具箱,TK-01,1", "spare": "航电模块,LRU,1",
                },
            ],
        },
    ]


class TestDurationSampling(unittest.TestCase):
    def test_triangular_in_range(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "三角分布", "min": 35, "mode": 45, "max": 60}, rng)
            self.assertGreaterEqual(d, 35)
            self.assertLessEqual(d, 60)

    def test_uniform_in_range(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "均匀分布", "min": 50, "max": 70}, rng)
            self.assertGreaterEqual(d, 50)
            self.assertLessEqual(d, 70)

    def test_normal_positive(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "正态分布", "mean": 90, "stdDev": 15}, rng)
            self.assertGreater(d, 0)

    def test_fixed_value(self) -> None:
        rng = np.random.default_rng(0)
        d = sample_duration({"distributionType": "固定值", "value": 30}, rng)
        self.assertEqual(d, 30)

    def test_lognormal_positive(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "对数正态分布", "params": "mu=5.1, sigma=0.35"}, rng)
            self.assertGreater(d, 0)

    def test_unknown_falls_back_to_duration_minutes(self) -> None:
        rng = np.random.default_rng(0)
        d = sample_duration({"distributionType": "未知"}, rng, fallback_minutes=42)
        self.assertEqual(d, 42)


class TestJobDAG(unittest.TestCase):
    def test_build_dag_preserves_predecessors(self) -> None:
        dag = build_job_dag(_sample_activities()[0]["jobs"])
        self.assertIn("OPS-001", dag)
        self.assertIn("OPS-002", dag)
        self.assertEqual(list(dag.predecessors("OPS-002")), ["OPS-001"])

    def test_topological_sort_orders_predecessors_first(self) -> None:
        dag = build_job_dag(_sample_activities()[0]["jobs"])
        order = topological_sort(dag)
        self.assertEqual(order, ["OPS-001", "OPS-002"])

    def test_cycle_detected_raises(self) -> None:
        import networkx as nx
        dag = nx.DiGraph()
        dag.add_edge("A", "B")
        dag.add_edge("B", "A")
        with self.assertRaises(ValueError):
            topological_sort(dag)


class TestActivityPlanner(unittest.TestCase):
    def test_create_activity_job(self) -> None:
        planner = ActivityPlanner(_sample_activities())
        job = planner.create_activity_job("preflight", aircraft_tail="J15-101")
        self.assertIsInstance(job, ActivityJob)
        self.assertEqual(job.activity_id, "preflight")
        self.assertEqual(len(job.tasks), 2)
        self.assertEqual(job.tasks[0]["activityCode"], "OPS-001")

    def test_preventive_activity_exists(self) -> None:
        activities = _sample_activities() + [{
            "id": "preventive", "name": "8小时定检", "activityType": "预防性维修",
            "equipmentId": "j35-hydraulic", "resourceId": "carrier-deck",
            "durationHours": 2, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": "液压备件", "spareQuantity": 1, "priority": 2,
            "calendarDayInterval": 1, "runHourInterval": 8, "takeoffLandingInterval": 6,
            "calendarDayFloatRatio": 0.1, "runHourFloatRatio": 0.15, "takeoffLandingFloatRatio": 0.1,
            "jobs": [{"activityCode": "PM-001", "workName": "定检准备", "predecessors": [],
                      "durationMinutes": 30, "durationProfile": {"distributionType": "固定值", "value": 30},
                      "personnel": "维修/机体,1", "facility": "定检工位", "equipment": "检查灯,LT-01,1", "spare": "无"}],
        }]
        planner = ActivityPlanner(activities)
        preventive = planner.get_activity("preventive")
        self.assertIsNotNone(preventive)
        self.assertEqual(preventive["calendarDayInterval"], 1)

    def test_check_preventive_due_by_flight_hours(self) -> None:
        activities = _sample_activities() + [{
            "id": "preventive", "name": "8小时定检", "activityType": "预防性维修",
            "equipmentId": "j35-hydraulic", "resourceId": "carrier-deck",
            "durationHours": 2, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": "液压备件", "spareQuantity": 1, "priority": 2,
            "useCalendarRule": True, "calendarDayInterval": 1, "calendarDayFloatRatio": 0.1,
            "useFlightHourRule": True, "runHourInterval": 8, "runHourFloatRatio": 0.15,
            "useTakeoffLandingRule": True, "takeoffLandingInterval": 6, "takeoffLandingFloatRatio": 0.1,
            "jobs": [{"activityCode": "PM-001", "workName": "定检准备", "predecessors": [],
                      "durationMinutes": 30, "durationProfile": {"distributionType": "固定值", "value": 30},
                      "personnel": "维修/机体,1", "facility": "定检工位", "equipment": "检查灯,LT-01,1", "spare": "无"}],
        }]
        planner = ActivityPlanner(activities)
        due = planner.check_preventive_due(
            flight_hours_since_last=10.0,
            days_since_last=0.0,
            landings_since_last=0,
        )
        self.assertTrue(due)


if __name__ == "__main__":
    unittest.main()
