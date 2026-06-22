from __future__ import annotations

import json
import unittest
from pathlib import Path

from independent_mesa.monte_carlo import MonteCarloRunner


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestMonteCarloRunner(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_param_grid_has_27_combinations(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        grid = runner.build_param_grid()
        self.assertEqual(len(grid), 27)

    def test_run_single_sample_returns_metrics(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=1)
        metrics = runner.run_single(
            failure_rate=0.055, spare_multiplier=1.0,
            support_capacity=3, seed=42,
        )
        self.assertIn("sortie_completion_rate", metrics)

    def test_run_group_returns_aggregated(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        result = runner.run_group(
            failure_rate=0.055, spare_multiplier=1.0,
            support_capacity=3,
        )
        self.assertIn("mean", result)
        self.assertIn("std", result)
        self.assertIn("samples", result)
        self.assertEqual(result["samples"], 2)

    def test_failed_sample_does_not_crash_group(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        result = runner.run_group(
            failure_rate=-1.0,  # invalid, will cause issues but shouldn't crash
            spare_multiplier=1.0,
            support_capacity=3,
        )
        self.assertIn("samples", result)


if __name__ == "__main__":
    unittest.main()
