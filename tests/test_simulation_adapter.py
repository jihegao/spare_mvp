from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class SimulationAdapterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = SimulationAdapter(REPO_ROOT)

    def _load_fixture(self, name: str) -> dict:
        path = REPO_ROOT / "tests" / "fixtures" / name
        return json.loads(path.read_text(encoding="utf-8"))

    def test_validate_project_accepts_contract_fixture(self) -> None:
        project = self._load_fixture("smoke_project.json")

        result = self.adapter.validate_project(project)

        self.assertTrue(result["ok"])
        self.assertEqual(result["project_id"], "project-smoke-contract-001")
        self.assertEqual(result["project_schema_version"], "project-v0")
        self.assertEqual(result["errors"], [])

    def test_validate_project_reports_missing_contract_roots(self) -> None:
        project = self._load_fixture("smoke_project.json")
        del project["components"]

        result = self.adapter.validate_project(project)

        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["path"], "components")
        self.assertEqual(result["errors"][0]["code"], "missing_required")

    def test_compile_smoke_scenario_from_project_contract(self) -> None:
        project = self._load_fixture("smoke_project.json")

        scenario = self.adapter.compile_scenario(project)

        self.assertEqual(scenario["schema_version"], "scenario-v0")
        self.assertEqual(scenario["scenario_id"], "scenario-smoke-contract-demo")
        self.assertEqual(scenario["project_id"], "project-smoke-contract-001")
        self.assertEqual(scenario["compiled_by"], "Simulation Adapter Agent")
        self.assertEqual(
            scenario["simulation_model"],
            {
                "family": "smoke",
                "model_id": "SmokeSpareMvpModel",
                "contract_version": "1.0.0",
            },
        )
        self.assertEqual(
            scenario["compiled_from"],
            {
                "project_id": "project-smoke-contract-001",
                "project_version": "project-v0.1",
                "project_schema_version": "project-v0",
                "ontology_version": "spare-mvp-ontology-v0",
                "mesa_contract_version": "1.0.0",
            },
        )
        self.assertEqual(scenario["simulation_inputs"]["active_module"], "sparePlanning")
        self.assertEqual(scenario["simulation_inputs"]["spare_multiplier"], 1)
        self.assertEqual(scenario["simulation_inputs"]["failure_rate"], 0.07)
        self.assertEqual(scenario["simulation_inputs"]["support_capacity"], 3)
        self.assertEqual(scenario["simulation_inputs"]["min_required_sorties"], 5)
        self.assertEqual(scenario["simulation_inputs"]["seed"], 20260618)

    def test_aviation_support_compilation_requires_approved_rules(self) -> None:
        project = self._load_fixture("aviation_support_project.json")

        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario(project, model_family="aviation_support")

        self.assertEqual(ctx.exception.code, "unsupported_model_family")
        self.assertIn("Claude-approved compilation rule", str(ctx.exception))

    def test_run_smoke_scenario_writes_result_and_artifact_manifest(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(scenario, output_dir=Path(tmp), steps=3)

            run = bundle["run"]
            result = bundle["result"]
            manifest = bundle["artifact_manifest"]

            self.assertEqual(run["status"], "succeeded")
            self.assertEqual(run["run_id"], "run-scenario-smoke-contract-demo")
            self.assertEqual(run["artifact_manifest_id"], manifest["artifact_manifest_id"])
            self.assertEqual(run["result_summary_id"], result["result_id"])
            self.assertEqual(result["model_family"], "smoke")
            self.assertEqual(result["run_id"], run["run_id"])
            self.assertIn("mission_success_rate", result["metrics"])
            self.assertIn("spare_fill_rate", result["metrics"])
            self.assertEqual(manifest["run_id"], run["run_id"])
            self.assertEqual(manifest["scenario_id"], scenario["scenario_id"])

            artifact_kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            self.assertEqual(
                artifact_kinds,
                {"input_project", "compiled_scenario", "snapshot", "result_summary"},
            )
            for artifact in manifest["artifacts"]:
                target = Path(tmp) / artifact["path"]
                self.assertTrue(target.exists(), artifact)
                self.assertGreater(artifact["size_bytes"], 0)
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
