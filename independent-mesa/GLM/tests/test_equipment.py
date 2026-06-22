from __future__ import annotations

import math
import unittest

import numpy as np

from independent_mesa.equipment import (
    sample_exponential_failure,
    sample_weibull_failure,
    sample_normal_lifetime,
)


class TestFailureSamplers(unittest.TestCase):
    def test_exponential_failure_probability_scales_with_dt(self) -> None:
        rng = np.random.default_rng(42)
        rate = 0.01
        dt = 60.0
        fails = sum(sample_exponential_failure(rate, dt, rng) for _ in range(10000))
        prob = fails / 10000
        expected = 1 - math.exp(-rate * dt)
        self.assertAlmostEqual(prob, expected, places=2)

    def test_exponential_zero_rate_never_fails(self) -> None:
        rng = np.random.default_rng(0)
        self.assertFalse(sample_exponential_failure(0.0, 60.0, rng))

    def test_weibull_failure_probability_matches_cdf(self) -> None:
        rng = np.random.default_rng(99)
        beta = 1.8
        eta = 140.0
        dt = 50.0
        fails = sum(sample_weibull_failure(beta, eta, dt, rng) for _ in range(10000))
        prob = fails / 10000
        expected = 1 - math.exp(-((dt / eta) ** beta))
        self.assertAlmostEqual(prob, expected, places=2)

    def test_normal_lifetime_returns_remaining_fraction(self) -> None:
        rng = np.random.default_rng(7)
        mean = 105.0
        sigma = 12.0
        elapsed = 90.0
        remaining = sample_normal_lifetime(mean, sigma, elapsed, rng)
        self.assertIsInstance(remaining, float)
        self.assertGreater(remaining, 0.0)

    def test_normal_lifetime_past_mean_returns_small_remaining(self) -> None:
        rng = np.random.default_rng(3)
        remaining = sample_normal_lifetime(100.0, 10.0, 150.0, rng)
        self.assertLessEqual(remaining, 20.0)


from independent_mesa.equipment import (
    EquipmentNode,
    build_equipment_tree,
    parse_failure_distribution,
    check_k_out_of_n,
)


class TestEquipmentTree(unittest.TestCase):
    def _sample_assets(self) -> list[dict]:
        return [
            {"id": "aircraft-root", "name": "舰载机", "quantity": 6, "mtbfHours": 600},
            {
                "id": "j15-engine", "aircraftModel": "J-15", "name": "发动机",
                "parentId": "aircraft-root", "productType": "SRU",
                "failureModel": "随机",
                "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.055"},
                "failureRate": 0.055, "mtbfHours": 95, "lifeLimitHours": 240,
                "connectionType": "串联", "quantity": 2,
                "kOutOfN": {"enabled": True, "n": 2, "k": 1},
                "specialRepairProfile": {"repairTimeMinutes": 220, "repairRatio": 0.4, "replacementRatio": 0.6},
                "rms": {"reliability": 0.94, "maintainability": 0.89, "supportability": 0.9,
                        "mttrHours": 3.4, "mldtHours": 1.2, "availability": 0.96},
            },
            {
                "id": "j15-engine-control", "aircraftModel": "J-15", "name": "发动机控制模块",
                "parentId": "j15-engine", "productType": "LRU",
                "failureModel": "随机",
                "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.04"},
                "failureRate": 0.04, "mtbfHours": 120, "lifeLimitHours": 260,
                "connectionType": "串联", "quantity": 1,
                "kOutOfN": {"enabled": False, "n": 1, "k": 1},
                "specialRepairProfile": {"repairTimeMinutes": 160, "repairRatio": 0.45, "replacementRatio": 0.55},
                "rms": {"reliability": 0.95, "maintainability": 0.9, "supportability": 0.9,
                        "mttrHours": 2.8, "mldtHours": 1.1, "availability": 0.97},
            },
        ]

    def test_build_equipment_tree_creates_parent_child_links(self) -> None:
        tree = build_equipment_tree(self._sample_assets())
        self.assertIn("aircraft-root", tree)
        root = tree["aircraft-root"]
        self.assertEqual(len(root.children), 1)
        engine = root.children[0]
        self.assertEqual(engine.id, "j15-engine")
        self.assertEqual(len(engine.children), 1)
        self.assertEqual(engine.children[0].id, "j15-engine-control")

    def test_parse_exponential_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "指数分布", "parameters": "lambda=0.055"},
            failure_model="随机",
            mtbf_hours=95.0,
        )
        self.assertEqual(dist["type"], "exponential")
        self.assertAlmostEqual(dist["rate"], 0.055)

    def test_parse_weibull_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "威布尔分布", "parameters": "beta=1.8, eta=140"},
            failure_model="退化",
            mtbf_hours=125.0,
        )
        self.assertEqual(dist["type"], "weibull")
        self.assertAlmostEqual(dist["beta"], 1.8)
        self.assertAlmostEqual(dist["eta"], 140.0)

    def test_parse_normal_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "正态分布", "parameters": "mean=105, sigma=12"},
            failure_model="寿命",
            mtbf_hours=105.0,
        )
        self.assertEqual(dist["type"], "normal")
        self.assertAlmostEqual(dist["mean"], 105.0)
        self.assertAlmostEqual(dist["sigma"], 12.0)

    def test_parse_distribution_fallback_on_missing(self) -> None:
        dist = parse_failure_distribution(None, failure_model="随机", mtbf_hours=100.0)
        self.assertEqual(dist["type"], "exponential")
        self.assertAlmostEqual(dist["rate"], 1.0 / 100.0)

    def test_k_out_of_n_not_failed_when_below_threshold(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=2)
        node.k_out_of_n = {"enabled": True, "n": 2, "k": 1}
        node.failed_children_count = 0
        self.assertFalse(check_k_out_of_n(node))

    def test_k_out_of_n_failed_when_at_threshold(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=2)
        node.k_out_of_n = {"enabled": True, "n": 2, "k": 1}
        node.failed_children_count = 1
        self.assertTrue(check_k_out_of_n(node))

    def test_k_out_of_n_disabled_always_false(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1)
        node.k_out_of_n = {"enabled": False, "n": 1, "k": 1}
        node.failed_children_count = 5
        self.assertFalse(check_k_out_of_n(node))


from independent_mesa.equipment import (
    age_and_sample_failures,
    decide_repair_or_replace,
    is_life_limit_exceeded,
)


class TestAgingAndFailure(unittest.TestCase):
    def test_age_and_sample_failures_marks_lru_failed(self) -> None:
        nodes = build_equipment_tree([
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
            {
                "id": "lru1", "name": "lru1", "parentId": "root",
                "failureModel": "随机", "failureRate": 1.0,
                "mtbfHours": 1, "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=1.0"},
                "lifeLimitHours": 0, "quantity": 1,
            },
        ])
        rng = np.random.default_rng(0)
        failures = age_and_sample_failures(nodes, dt_hours=1.0, rng=rng, threat_multiplier=1.0)
        self.assertIsInstance(failures, list)
        if failures:
            self.assertEqual(nodes[failures[0]].health, "failed")

    def test_age_accumulates_hours(self) -> None:
        nodes = build_equipment_tree([
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
        ])
        rng = np.random.default_rng(0)
        age_and_sample_failures(nodes, dt_hours=5.0, rng=rng, threat_multiplier=1.0)
        self.assertGreater(nodes["root"].accumulated_hours, 0)

    def test_life_limit_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=100.0)
        node.accumulated_hours = 120.0
        self.assertTrue(is_life_limit_exceeded(node))

    def test_life_limit_not_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=100.0)
        node.accumulated_hours = 50.0
        self.assertFalse(is_life_limit_exceeded(node))

    def test_life_limit_zero_not_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=0.0)
        node.accumulated_hours = 9999.0
        self.assertFalse(is_life_limit_exceeded(node))

    def test_decide_repair_uses_ratio(self) -> None:
        profile = {"repairTimeMinutes": 220, "repairRatio": 0.4, "replacementRatio": 0.6}
        rng = np.random.default_rng(0)
        decisions = [decide_repair_or_replace(profile, rng) for _ in range(1000)]
        repair_count = sum(1 for d in decisions if d == "repair")
        self.assertGreater(repair_count, 200)
        self.assertLess(repair_count, 600)

    def test_threat_multiplier_increases_failures(self) -> None:
        asset = [
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
            {
                "id": "lru1", "name": "lru1", "parentId": "root",
                "failureModel": "随机", "failureRate": 0.01,
                "mtbfHours": 100, "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.01"},
                "lifeLimitHours": 0, "quantity": 1,
            },
        ]
        rng_low = np.random.default_rng(100)
        rng_high = np.random.default_rng(100)
        low = sum(len(age_and_sample_failures(build_equipment_tree(asset), 10.0, rng_low, 1.0)) for _ in range(500))
        high = sum(len(age_and_sample_failures(build_equipment_tree(asset), 10.0, rng_high, 3.0)) for _ in range(500))
        self.assertGreater(high, low)


if __name__ == "__main__":
    unittest.main()
