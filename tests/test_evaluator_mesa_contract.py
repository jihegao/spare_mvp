from __future__ import annotations

import json
from pathlib import Path
import unittest

from src.spare_mvp_abm.smoke_model import DEFAULT_SMOKE_PROJECT_DATA, SmokeSpareMvpModel


REPO_ROOT = Path(__file__).resolve().parents[1]


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
            projectData=DEFAULT_SMOKE_PROJECT_DATA,
            seed=20260618,
        )
        for _ in range(3):
            model.step()

        snapshot_keys = set(model.snapshot())
        self.assertLessEqual(self._required_metrics("smoke"), snapshot_keys)


if __name__ == "__main__":
    unittest.main()
