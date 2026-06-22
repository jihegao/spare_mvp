from __future__ import annotations

import json
import unittest
from pathlib import Path

from independent_mesa.monte_carlo import MonteCarloRunner
from independent_mesa.monte_carlo_visualization import build_monte_carlo_html


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestMonteCarloVisualization(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def _run_small_sweep(self) -> list[dict]:
        runner = MonteCarloRunner(self.package, steps=4, samples=2, seed=20260621)
        return runner.run_sweep()

    def test_build_html_contains_all_sections(self) -> None:
        results = self._run_small_sweep()
        doc = build_monte_carlo_html(
            results,
            steps=4,
            samples=2,
            seed=20260621,
            failure_rates=[0.035, 0.055, 0.075],
            spare_multipliers=[0.75, 1, 1.25],
            support_capacities=[2, 3, 4],
        )
        for marker in [
            "id=\"sceneMetrics\"",
            "id=\"scene\"",
            "id=\"waves\"",
            "id=\"resources\"",
            "id=\"events\"",
            "const frames =",
            "聚合指标表",
            "敏感度趋势",
            "代表样本回放",
            "setFrame(0)",
        ]:
            self.assertIn(marker, doc)
        self.assertIn("GLM 蒙特卡洛扫描可视化", doc)

    def test_build_html_has_five_key_metric_columns(self) -> None:
        results = self._run_small_sweep()
        doc = build_monte_carlo_html(
            results,
            steps=4,
            samples=2,
            seed=20260621,
            failure_rates=[0.035, 0.055, 0.075],
            spare_multipliers=[0.75, 1, 1.25],
            support_capacities=[2, 3, 4],
        )
        for metric_name in ["可用度", "出动架次率", "再出动准备", "备件满足率", "平均备件延误"]:
            self.assertIn(metric_name, doc)

    def test_build_html_embeds_frames_without_leaks(self) -> None:
        results = self._run_small_sweep()
        doc = build_monte_carlo_html(
            results,
            steps=4,
            samples=2,
            seed=20260621,
            failure_rates=[0.035, 0.055, 0.075],
            spare_multipliers=[0.75, 1, 1.25],
            support_capacities=[2, 3, 4],
        )
        for placeholder in ["{frames_json}", "{phase_labels_json}", "{phase_colors_json}", "{phase_lanes_json}"]:
            self.assertNotIn(placeholder, doc)

    def test_build_html_has_27_table_rows(self) -> None:
        results = self._run_small_sweep()
        doc = build_monte_carlo_html(
            results,
            steps=4,
            samples=2,
            seed=20260621,
            failure_rates=[0.035, 0.055, 0.075],
            spare_multipliers=[0.75, 1, 1.25],
            support_capacities=[2, 3, 4],
        )
        self.assertEqual(doc.count("<tr><td>"), 27)

    def test_run_group_carries_representative_frames(self) -> None:
        results = self._run_small_sweep()
        self.assertEqual(len(results), 27)
        # At least one group should carry representative frames from a successful sample.
        groups_with_frames = [r for r in results if r.get("representative_frames")]
        self.assertTrue(groups_with_frames)
        self.assertIn("snapshot", groups_with_frames[0]["representative_frames"][0])

    def test_save_visualization_writes_html(self) -> None:
        import tempfile
        runner = MonteCarloRunner(self.package, steps=4, samples=1, seed=20260621)
        results = runner.run_sweep()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "mc.html"
            runner.save_visualization(results, out, steps=4, samples=1, seed=20260621)
            self.assertTrue(out.exists())
            doc = out.read_text(encoding="utf-8")
            self.assertIn("GLM 蒙特卡洛扫描可视化", doc)


if __name__ == "__main__":
    unittest.main()
