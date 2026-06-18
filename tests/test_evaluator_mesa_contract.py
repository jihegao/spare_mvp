from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
import unittest

from src.spare_mvp_abm.smoke_model import SmokeSpareMvpModel


REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_aviation_module():
    model_path = REPO_ROOT / "src" / "spare_mvp_abm" / "aviation_support" / "model.py"
    spec = importlib.util.spec_from_file_location("evaluator_aviation_support_model", model_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class EvaluatorMesaContractTest(unittest.TestCase):
    def _result_schema(self) -> dict:
        return json.loads((REPO_ROOT / "contracts" / "result.schema.json").read_text(encoding="utf-8"))

    def _required_metrics(self, model_family: str) -> set[str]:
        schema = self._result_schema()
        for branch in schema["oneOf"]:
            if branch["properties"]["model_family"]["const"] == model_family:
                return set(branch["properties"]["metrics"]["required"])
        raise AssertionError(f"missing result schema branch for {model_family}")

    def test_smoke_result_schema_metrics_exist_in_live_snapshot(self) -> None:
        model = SmokeSpareMvpModel(
            projectJsonPath=str(REPO_ROOT / "scenarios" / "frontend-project-smoke" / "project.json"),
            ontologyPath=str(REPO_ROOT / "ontology" / "spare_mvp.ontology.json"),
            seed=20260618,
        )
        for _ in range(3):
            model.step()

        snapshot_keys = set(model.snapshot())
        self.assertLessEqual(self._required_metrics("smoke"), snapshot_keys)

    def test_aviation_result_schema_metrics_exist_in_snapshot_and_visualization_metrics(self) -> None:
        module = _load_aviation_module()
        asset_dir = REPO_ROOT / "src" / "spare_mvp_abm" / "aviation_support"
        model = module.AviationSupportModel(
            ontology_path=str(asset_dir / "ontology.json"),
            use_ontology_scenario=True,
            lru_failure_multiplier=0,
            seed=20260618,
        )
        for _ in range(3):
            model.step()

        required_metrics = self._required_metrics("aviation_support")
        state = model.visualization_state()
        snapshot_keys = set(state["snapshot"])
        visualization_metric_ids = {metric["metric_id"] for metric in state["metrics"]}

        self.assertLessEqual(required_metrics, snapshot_keys)
        self.assertLessEqual(required_metrics, visualization_metric_ids)


if __name__ == "__main__":
    unittest.main()
