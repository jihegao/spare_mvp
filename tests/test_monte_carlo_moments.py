from __future__ import annotations

import math
from pathlib import Path
import unittest

from src.spare_mvp_contract.adapter import SimulationAdapter
from src.spare_mvp_contract.monte_carlo_moments import build_monte_carlo_metric_moments


class MonteCarloMomentsTest(unittest.TestCase):
    def test_empty_and_single_value_metrics_report_unavailable_variance(self) -> None:
        empty = build_monte_carlo_metric_moments([], total_sample_count=4, failed_sample_count=4)
        self.assertEqual(empty["successful_sample_count"], 0)
        self.assertEqual(empty["failed_sample_count"], 4)
        self.assertTrue(all(metric["mean"] is None for metric in empty["metrics"]))
        self.assertTrue(all(metric["sample_variance"] is None for metric in empty["metrics"]))
        self.assertTrue(all(metric["valid_sample_count"] == 0 for metric in empty["metrics"]))

        single = build_monte_carlo_metric_moments(
            [{"metrics": {"mission_success_rate": 0.75}}],
            total_sample_count=1,
            failed_sample_count=0,
        )
        mission = single["metrics"][0]
        self.assertEqual(mission["mean"], 0.75)
        self.assertIsNone(mission["sample_variance"])
        self.assertEqual(mission["valid_sample_count"], 1)

    def test_mixed_samples_use_only_finite_native_numbers_and_n_minus_one(self) -> None:
        samples = [
            {
                "sample_id": 123456,
                "name": "sample-a",
                "metrics": {
                    "mission_success_rate": 0.2,
                    "spare_fill_rate": math.nan,
                    "spare_utilization": "0.5",
                    "ready_rate": True,
                    "sortie_rate": 1.0,
                    "mean_transport_delay": 2.0,
                    "repair_backlog": 1,
                    "debug_counter": 999,
                },
                "logs": [{"duration": 800}],
            },
            {
                "sample_id": 654321,
                "metrics": {
                    "mission_success_rate": 0.8,
                    "spare_fill_rate": 0.6,
                    "spare_utilization": math.inf,
                    "ready_rate": 0.4,
                    "sortie_rate": 10**1000,
                    "mean_transport_delay": "3.0",
                    "repair_backlog": 3,
                },
            },
            {"metrics": {"mission_success_rate": "bad", "repair_backlog": None}},
        ]
        moments = build_monte_carlo_metric_moments(
            samples,
            total_sample_count=5,
            failed_sample_count=2,
        )
        metrics = {metric["metric_id"]: metric for metric in moments["metrics"]}

        self.assertEqual(set(metrics), {
            "mission_success_rate", "spare_fill_rate", "spare_utilization", "ready_rate",
            "sortie_rate", "mean_transport_delay", "repair_backlog",
        })
        self.assertEqual(moments["variance_denominator"], "n-1")
        self.assertEqual(moments["total_sample_count"], 5)
        self.assertEqual(moments["successful_sample_count"], 3)
        self.assertEqual(moments["failed_sample_count"], 2)
        self.assertAlmostEqual(metrics["mission_success_rate"]["mean"], 0.5)
        self.assertAlmostEqual(metrics["mission_success_rate"]["sample_variance"], 0.18)
        self.assertEqual(metrics["mission_success_rate"]["valid_sample_count"], 2)
        self.assertEqual(metrics["spare_fill_rate"]["valid_sample_count"], 1)
        self.assertIsNone(metrics["spare_fill_rate"]["sample_variance"])
        self.assertEqual(metrics["spare_utilization"]["valid_sample_count"], 0)
        self.assertIsNone(metrics["spare_utilization"]["mean"])
        self.assertEqual(metrics["sortie_rate"]["valid_sample_count"], 1)
        self.assertAlmostEqual(metrics["repair_backlog"]["mean"], 2.0)
        self.assertAlmostEqual(metrics["repair_backlog"]["sample_variance"], 2.0)

    def test_legacy_aggregate_does_not_zero_fill_or_coerce_strings_and_nonfinite_values(self) -> None:
        adapter = SimulationAdapter(Path(__file__).resolve().parents[1])
        aggregate = adapter._aggregate_sample_metrics(  # noqa: SLF001 - direct aggregation boundary regression.
            [
                {"metrics": {"mission_success_rate": 0.2, "repair_backlog": 2, "shortage_events": 1}},
                {"metrics": {"mission_success_rate": 0.8, "repair_backlog": "4", "shortage_events": math.inf}},
                {"metrics": {"mission_success_rate": math.nan}},
            ],
        )

        self.assertAlmostEqual(aggregate["mission_success_rate"], 0.5)
        self.assertEqual(aggregate["repair_backlog"], 2.0)
        self.assertEqual(aggregate["spare_shortage_probability"], 1.0)

        invalid_only = adapter._aggregate_sample_metrics(  # noqa: SLF001 - direct aggregation boundary regression.
            [{"metrics": {"mission_success_rate": "0.5", "shortage_events": math.nan}}]
        )
        self.assertNotIn("mission_success_rate", invalid_only)
        self.assertNotIn("mission_success_probability", invalid_only)
        self.assertNotIn("spare_shortage_probability", invalid_only)


if __name__ == "__main__":
    unittest.main()
