from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = REPO_ROOT / "src" / "spare_mvp_abm" / "aviation_support"


class LocalAviationSupportModelTest(unittest.TestCase):
    def test_local_model_exposes_visualization_state_contract(self) -> None:
        model_path = ASSET_DIR / "model.py"
        self.assertTrue(model_path.exists(), "local aviation support model copy is missing")

        spec = importlib.util.spec_from_file_location("local_aviation_support_model", model_path)
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)

        model = module.AviationSupportModel(
            ontology_path=str(ASSET_DIR / "ontology.json"),
            use_ontology_scenario=True,
            lru_failure_multiplier=0,
            seed=17,
        )
        for _ in range(5):
            model.step()

        state = model.visualization_state()
        for key in ["snapshot", "aircraft", "resources", "spares", "missions", "jobs", "events"]:
            self.assertIn(key, state)
        self.assertGreaterEqual(len(state["aircraft"]), 2)
        self.assertGreaterEqual(len(state["resources"]), 3)
        self.assertGreaterEqual(len(state["spares"]), 3)
        self.assertIsInstance(state["snapshot"]["sortie_completion_rate"], float)


if __name__ == "__main__":
    unittest.main()
