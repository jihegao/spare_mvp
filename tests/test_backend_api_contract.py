from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
from pathlib import Path
import unittest

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class RecordingAdapter(SimulationAdapter):
    def __init__(self) -> None:
        super().__init__(REPO_ROOT)
        self.compile_calls: list[tuple[dict, str]] = []
        self.run_calls: list[tuple[dict, int]] = []

    def compile_scenario(self, project: dict, model_family: str = "smoke") -> dict:
        self.compile_calls.append((copy.deepcopy(project), model_family))
        return super().compile_scenario(project, model_family=model_family)

    def run_scenario(self, scenario: dict, output_dir: Path | str, steps: int = 3) -> dict[str, dict]:
        self.run_calls.append((copy.deepcopy(scenario), steps))
        return super().run_scenario(scenario, output_dir=output_dir, steps=steps)


class BackendApiContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)
        self.adapter = RecordingAdapter()
        self.tempdir = tempfile.TemporaryDirectory()
        self.api = BackendApi(self.repository, self.adapter, output_dir=Path(self.tempdir.name))

    def tearDown(self) -> None:
        self.connection.close()
        self.tempdir.cleanup()

    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def test_smoke_backend_flow_persists_complete_run_chain(self) -> None:
        project = self._fixture("smoke_project.json")

        validation = self.api.validate_project(project)
        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "contract smoke", "steps": 4})
        run = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")

        self.assertTrue(validation["ok"])
        self.assertEqual(saved["project_id"], "project-smoke-contract-001")
        self.assertEqual(snapshot["project_id"], saved["project_id"])
        self.assertEqual(snapshot["project_version"], "project-v0.1")
        self.assertEqual(plan["project_id"], saved["project_id"])
        self.assertEqual(plan["config"]["steps"], 4)
        self.assertEqual(
            run,
            {
                "run_id": "run-scenario-smoke-contract-demo",
                "project_id": "project-smoke-contract-001",
                "scenario_id": "scenario-smoke-contract-demo",
                "result_summary_id": "result-run-scenario-smoke-contract-demo",
                "artifact_manifest_id": "artifact-manifest-run-scenario-smoke-contract-demo",
                "status": "succeeded",
            },
        )

        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0], (project, "smoke"))
        self.assertEqual(len(self.adapter.run_calls), 1)
        self.assertEqual(self.adapter.run_calls[0][0]["scenario_id"], run["scenario_id"])
        self.assertEqual(self.adapter.run_calls[0][1], 4)

        stored_run = self.api.get_run(run["run_id"])
        result = self.api.get_run_result(run["run_id"])
        manifest = self.api.get_run_artifacts(run["run_id"])
        chain = self.api.get_run_chain(run["run_id"])

        self.assertEqual(stored_run["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(stored_run["status"], "succeeded")
        self.assertEqual(result["result_id"], run["result_summary_id"])
        self.assertEqual(result["run_id"], run["run_id"])
        self.assertIn("mission_success_rate", result["metrics"])
        self.assertEqual(manifest["artifact_manifest_id"], run["artifact_manifest_id"])
        self.assertEqual(manifest["run_id"], run["run_id"])
        self.assertEqual(chain["project_id"], run["project_id"])
        self.assertEqual(chain["scenario_id"], run["scenario_id"])
        self.assertEqual(chain["run_id"], run["run_id"])
        self.assertEqual(chain["result_summary_id"], run["result_summary_id"])
        self.assertEqual(chain["artifact_manifest_id"], run["artifact_manifest_id"])

    def test_unsupported_aviation_support_path_is_explicit(self) -> None:
        project = self._fixture("aviation_support_project.json")
        self.api.save_project(project)
        plan = self.api.create_experiment_plan(project["project_id"], {"steps": 1})

        with self.assertRaises(BackendApiError) as ctx:
            self.api.start_simulation_run(
                project["project_id"],
                plan["experiment_plan_id"],
                model_family="aviation_support",
            )

        self.assertEqual(ctx.exception.code, "unsupported_model_family")
        self.assertEqual(
            str(ctx.exception),
            "aviation_support scenario compilation is blocked until governed field derivation rules are approved",
        )
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "aviation_support")
        self.assertEqual(self.adapter.run_calls, [])


if __name__ == "__main__":
    unittest.main()
