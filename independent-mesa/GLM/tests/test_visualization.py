from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from independent_mesa.model import IndependentMesaModel
from independent_mesa.visualization import build_visualization_html, export_frames, write_outputs


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestVisualization(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_export_frames_returns_initial_plus_sampled(self) -> None:
        model = IndependentMesaModel(self.package, steps=6, seed=20260621)
        frames = export_frames(model, steps=6, sample_every=2)
        self.assertEqual(len(frames), 4)
        for frame in frames:
            for key in ["snapshot", "aircraft", "resources", "spares", "missions", "jobs", "events"]:
                self.assertIn(key, frame)

    def test_build_visualization_html_contains_all_sections(self) -> None:
        model = IndependentMesaModel(self.package, steps=4, seed=20260621)
        frames = export_frames(model, steps=4, sample_every=1)
        metrics = model.compute_final_metrics()
        html_doc = build_visualization_html(frames, metrics)
        for marker in [
            'id="metrics"',
            'id="scene"',
            'id="waves"',
            'id="resources"',
            'id="spares"',
            'id="jobs"',
            'id="events"',
            'id="aircraftDetail"',
            "const frames =",
            "setFrame(0)",
        ]:
            self.assertIn(marker, html_doc)
        self.assertIn("方案一 Independent Mesa", html_doc)

    def test_build_visualization_html_embeds_frames_without_leaks(self) -> None:
        model = IndependentMesaModel(self.package, steps=2, seed=20260621)
        frames = export_frames(model, steps=2, sample_every=1)
        metrics = model.compute_final_metrics()
        html_doc = build_visualization_html(frames, metrics)
        for placeholder in ["{frames_json}", "{phase_labels_json}", "{phase_colors_json}", "{phase_lanes_json}", "{metrics_rows}"]:
            self.assertNotIn(placeholder, html_doc)

    def test_write_outputs_creates_three_artifacts(self) -> None:
        model = IndependentMesaModel(self.package, steps=4, seed=20260621)
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "run"
            write_outputs(model, out_dir, steps=4, sample_every=1)
            self.assertTrue((out_dir / "frames.json").exists())
            self.assertTrue((out_dir / "metrics.json").exists())
            self.assertTrue((out_dir / "visualization.html").exists())
            frames_data = json.loads((out_dir / "frames.json").read_text(encoding="utf-8"))
            self.assertIn("frames", frames_data)
            html_doc = (out_dir / "visualization.html").read_text(encoding="utf-8")
            self.assertIn("方案一 Independent Mesa", html_doc)


if __name__ == "__main__":
    unittest.main()
