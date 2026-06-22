from __future__ import annotations

import json
import unittest
from pathlib import Path

from independent_mesa.model import IndependentMesaModel


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestModelIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_model_initializes_from_import_package(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        self.assertEqual(model.steps_planned, 48)
        self.assertEqual(len(model.aircraft), 6)
        self.assertIn("carrier-deck", model.support_network.nodes)

    def test_model_runs_48_steps_without_error(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(48):
            model.step()
        self.assertEqual(model.steps_run, 48)
        self.assertGreater(model.sim_time, 0)

    def test_snapshot_has_expected_fields(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        model.step()
        snap = model.snapshot()
        self.assertIn("time", snap)
        self.assertIn("aircraft_count", snap)
        self.assertIn("launched_sorties", snap)
        self.assertIn("spare_stock_total", snap)
        self.assertIn("sortie_completion_rate", snap)

    def test_visualization_state_has_full_structure(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(5):
            model.step()
        state = model.visualization_state()
        for key in ["snapshot", "aircraft", "resources", "spares", "missions", "jobs", "events"]:
            self.assertIn(key, state)

    def test_metrics_computed_at_end(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(48):
            model.step()
        metrics = model.compute_final_metrics()
        self.assertIn("sortie_completion_rate", metrics)
        self.assertIn("spare_fill_rate", metrics)
        self.assertGreaterEqual(metrics["sortie_completion_rate"], 0.0)
        self.assertLessEqual(metrics["sortie_completion_rate"], 1.0)

    def test_reproducible_with_same_seed(self) -> None:
        m1 = IndependentMesaModel(self.package, steps=10, seed=42)
        m2 = IndependentMesaModel(self.package, steps=10, seed=42)
        for _ in range(10):
            m1.step()
            m2.step()
        self.assertEqual(m1.snapshot()["launched_sorties"], m2.snapshot()["launched_sorties"])

    def test_threat_level_increases_failures(self) -> None:
        m_low = IndependentMesaModel(self.package, steps=48, seed=100)
        m_high = IndependentMesaModel(self.package, steps=48, seed=100, threat_multiplier_override=3.0)
        for _ in range(48):
            m_low.step()
            m_high.step()
        self.assertGreaterEqual(m_high.lru_failures, m_low.lru_failures)


if __name__ == "__main__":
    unittest.main()
