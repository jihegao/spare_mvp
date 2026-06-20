from __future__ import annotations

import copy
import json
import tempfile
from pathlib import Path
import unittest

import jsonschema

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
                "mapping_provenance": {
                    "project_id": "project-smoke-contract-001",
                    "modeling_snapshot_id": None,
                    "experiment_plan_id": None,
                    "model_family": "smoke",
                    "mapping_version": "smoke-input-v0",
                    "consumed_fields": [
                        "activeModule",
                        "monteCarlo.spareMultipliers",
                        "components[].failureRate",
                        "supportNodes[].equipmentCapacity",
                        "equipment.minRequiredSorties",
                        "basicMission.minRequiredSorties",
                        "experiment.seed",
                    ],
                    "defaults_applied": [],
                    "derived_fields": ["simulation_inputs.failure_rate"],
                    "ignored_fields": ["monteCarlo.failureRates", "monteCarlo.supportCapacities"],
                    "unsupported_fields": [],
                },
            },
        )
        self.assertEqual(scenario["simulation_inputs"]["active_module"], "sparePlanning")
        self.assertEqual(scenario["simulation_inputs"]["spare_multiplier"], 1)
        self.assertEqual(scenario["simulation_inputs"]["failure_rate"], 0.07)
        self.assertEqual(scenario["simulation_inputs"]["support_capacity"], 3)
        self.assertEqual(scenario["simulation_inputs"]["min_required_sorties"], 5)
        self.assertEqual(scenario["simulation_inputs"]["seed"], 20260618)

    def test_compile_smoke_scenario_includes_mapping_provenance(self) -> None:
        project = self._load_fixture("smoke_project.json")

        scenario = self.adapter.compile_scenario(project)

        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertEqual(provenance["model_family"], "smoke")
        self.assertEqual(provenance["mapping_version"], "smoke-input-v0")
        self.assertIn("components[].failureRate", provenance["consumed_fields"])
        self.assertIn("monteCarlo.failureRates", provenance["ignored_fields"])

    def test_smoke_mapping_provenance_records_defaults_that_feed_inputs(self) -> None:
        project = self._load_fixture("smoke_project.json")
        project["monteCarlo"]["spareMultipliers"] = []
        project["components"] = []
        project["supportNodes"] = []
        project["equipment"] = {}
        project["basicMission"] = {}
        project["experiment"] = {}

        scenario = self.adapter.compile_scenario(project)

        self.assertEqual(
            scenario["compiled_from"]["mapping_provenance"]["defaults_applied"],
            [
                "monteCarlo.spareMultipliers=1.0",
                "components[].failureRate=0.05",
                "supportNodes[].equipmentCapacity=1",
                "equipment.minRequiredSorties|basicMission.minRequiredSorties=1",
                "experiment.seed=0",
            ],
        )
        self.assertEqual(scenario["simulation_inputs"]["spare_multiplier"], 1.0)
        self.assertEqual(scenario["simulation_inputs"]["failure_rate"], 0.05)
        self.assertEqual(scenario["simulation_inputs"]["support_capacity"], 1)
        self.assertEqual(scenario["simulation_inputs"]["min_required_sorties"], 1)
        self.assertEqual(scenario["simulation_inputs"]["seed"], 0)

    def test_generated_smoke_scenario_with_mapping_provenance_validates_against_schema(self) -> None:
        project = self._load_fixture("smoke_project.json")
        schema = json.loads((REPO_ROOT / "contracts" / "scenario.schema.json").read_text(encoding="utf-8"))

        scenario = self.adapter.compile_scenario(project)

        jsonschema.validate(instance=scenario, schema=schema)

    def test_compile_invalid_project_raises_invalid_project_with_validation_errors(self) -> None:
        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario({})

        self.assertEqual(ctx.exception.code, "invalid_project")
        self.assertIn("errors", ctx.exception.details)
        self.assertTrue(ctx.exception.details["errors"])
        self.assertEqual(ctx.exception.details["errors"][0]["code"], "missing_required")

    def test_smoke_compile_inputs_change_when_consumed_project_fields_change(self) -> None:
        project = self._load_fixture("smoke_project.json")
        baseline = self.adapter.compile_scenario(project)["simulation_inputs"]

        changed_failure_rate = copy.deepcopy(project)
        changed_failure_rate["components"][0]["failureRate"] = 0.21
        changed_support_capacity = copy.deepcopy(project)
        changed_support_capacity["supportNodes"][0]["equipmentCapacity"] = 8
        changed_seed = copy.deepcopy(project)
        changed_seed["experiment"]["seed"] = 99

        self.assertNotEqual(
            baseline["failure_rate"],
            self.adapter.compile_scenario(changed_failure_rate)["simulation_inputs"]["failure_rate"],
        )
        self.assertNotEqual(
            baseline["support_capacity"],
            self.adapter.compile_scenario(changed_support_capacity)["simulation_inputs"]["support_capacity"],
        )
        self.assertNotEqual(
            baseline["seed"],
            self.adapter.compile_scenario(changed_seed)["simulation_inputs"]["seed"],
        )

    def test_aviation_support_compilation_requires_approved_rules(self) -> None:
        project = self._load_fixture("aviation_support_project.json")

        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario(project, model_family="aviation_support")

        self.assertEqual(ctx.exception.code, "unsupported_model_family")
        self.assertIn("Claude-approved compilation rule", str(ctx.exception))

    def test_aviation_support_compile_gate_returns_field_level_diagnostics(self) -> None:
        project = self._load_fixture("aviation_support_project.json")

        result = self.adapter.compile_scenario_with_gate(project, model_family="aviation_support")

        self.assertEqual(result["status"], "unsupported")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "aviation_support")
        self.assertTrue(result["issues"])
        self.assertEqual(
            {"code", "message", "field_path", "page", "severity", "suggestion"},
            set(result["issues"][0]),
        )

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

    def test_run_smoke_scenario_sanitizes_scenario_id_for_artifact_paths(self) -> None:
        project = self._load_fixture("smoke_project.json")
        project["scenarioId"] = "../escape/path"
        scenario = self.adapter.compile_scenario(project)

        self.assertNotIn("/", scenario["scenario_id"])
        self.assertNotIn("..", scenario["scenario_id"])
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp).resolve()
            bundle = self.adapter.run_scenario(scenario, output_dir=output_root, steps=1)

            for artifact in bundle["artifact_manifest"]["artifacts"]:
                artifact_path = artifact["path"]
                self.assertNotIn("..", artifact_path.split("/"))
                target = (output_root / artifact_path).resolve()
                self.assertTrue(target.is_relative_to(output_root))

    def test_run_monte_carlo_batch_writes_base_artifact_with_provenance_seed_and_samples(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        plan_config = {
            "name": "m6.2 batch",
            "steps": 2,
            "seed": 20260620,
            "analysisRequests": {
                "largeSample": {
                    "enabled": True,
                    "samples": 4,
                    "sweep": {
                        "failureRates": [0.05, 0.08],
                        "spareMultipliers": [1.0, 1.25],
                        "capacities": [2],
                    },
                },
                "spareShortfall": {"enabled": True, "threshold": 0.95},
                "carryList": {"enabled": True, "missionWindowHours": 72},
                "missionReliability": {"enabled": True, "target": 0.9},
                "downtimeFactors": {"enabled": True, "topN": 3},
            },
        }

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_monte_carlo_batch(
                scenario,
                plan_config=plan_config,
                output_dir=Path(tmp),
                run_id="run-m6-2-batch",
            )
            manifest = bundle["artifact_manifest"]
            base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
            base_payload = json.loads((Path(tmp) / base_artifact["path"]).read_text(encoding="utf-8"))
            projection_artifacts = [
                artifact for artifact in manifest["artifacts"] if artifact["kind"] in {
                    "large_sample_summary",
                    "spare_shortfall",
                    "carry_list",
                    "mission_reliability",
                    "downtime_factors",
                }
            ]

            self.assertEqual(bundle["run"]["run_type"], "monte_carlo")
            self.assertEqual(bundle["run"]["seed"], 20260620)
            self.assertEqual(bundle["result"]["metrics"]["sample_count"], 4)
            self.assertEqual(base_payload["compiled_scenario_identity"]["scenario_id"], scenario["scenario_id"])
            self.assertEqual(base_payload["mapping_version"], "smoke-input-v0")
            self.assertEqual(base_payload["seed"], 20260620)
            self.assertEqual(base_payload["sample_count"], 4)
            self.assertEqual(len(base_payload["per_sample_metrics"]), 4)
            self.assertIn("failureRates", base_payload["sweep_dimensions"])
            self.assertIn("mission_success_rate", base_payload["aggregate_metrics"])
            self.assertIn("logs_summary", base_payload)
            self.assertEqual(len(projection_artifacts), 5)
            for artifact in projection_artifacts:
                payload = json.loads((Path(tmp) / artifact["path"]).read_text(encoding="utf-8"))
                self.assertEqual(payload["base_monte_carlo_artifact_id"], base_artifact["artifact_id"])
                if artifact["kind"] == "carry_list":
                    self.assertEqual(payload["summary"]["recommended_spare_multiplier"], 1.125)

    def test_monte_carlo_batch_is_reproducible_for_same_seed_mapping_and_plan(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        plan_config = {
            "steps": 2,
            "seed": 7,
            "analysisRequests": {
                "largeSample": {
                    "enabled": True,
                    "samples": 3,
                    "sweep": {
                        "failureRates": [0.05, 0.08],
                        "spareMultipliers": [1.0],
                        "capacities": [2, 3],
                    },
                }
            },
        }

        with tempfile.TemporaryDirectory() as tmp:
            first = self.adapter.run_monte_carlo_batch(
                scenario,
                plan_config=plan_config,
                output_dir=Path(tmp),
                run_id="run-mc-first",
            )
            second = self.adapter.run_monte_carlo_batch(
                scenario,
                plan_config=plan_config,
                output_dir=Path(tmp),
                run_id="run-mc-second",
            )
            first_base = next(artifact for artifact in first["artifact_manifest"]["artifacts"] if artifact["kind"] == "monte_carlo_base")
            second_base = next(artifact for artifact in second["artifact_manifest"]["artifacts"] if artifact["kind"] == "monte_carlo_base")
            first_payload = json.loads((Path(tmp) / first_base["path"]).read_text(encoding="utf-8"))
            second_payload = json.loads((Path(tmp) / second_base["path"]).read_text(encoding="utf-8"))

            self.assertEqual(first_payload["aggregate_metrics"], second_payload["aggregate_metrics"])
            self.assertEqual(first_payload["per_sample_inputs"], second_payload["per_sample_inputs"])

    def test_monte_carlo_batch_rejects_invalid_analysis_request_before_writing_artifacts(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        plan_config = {
            "steps": 2,
            "seed": 7,
            "analysisRequests": {
                "largeSample": {"enabled": True, "samples": 2},
                "spareShortfall": {"enabled": True, "threshold": "bad"},
            },
        }

        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(AdapterError) as ctx:
                self.adapter.run_monte_carlo_batch(
                    scenario,
                    plan_config=plan_config,
                    output_dir=Path(tmp),
                    run_id="run-invalid-analysis-config",
                )

            self.assertEqual(ctx.exception.code, "bad_analysis_request")
            self.assertFalse(list(Path(tmp).rglob("monte-carlo-base.json")))


if __name__ == "__main__":
    unittest.main()
