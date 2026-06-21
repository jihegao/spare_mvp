from __future__ import annotations

import copy
import hashlib
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

    def _smoke_scenario(self) -> dict:
        return self.adapter.compile_scenario(self._load_fixture("smoke_project.json"))

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
        self.assertNotIn("ontology_version", scenario["compiled_from"])
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

    def test_smoke_scenario_schema_rejects_ontology_version_in_compiled_from(self) -> None:
        project = self._load_fixture("smoke_project.json")
        schema = json.loads((REPO_ROOT / "contracts" / "scenario.schema.json").read_text(encoding="utf-8"))
        scenario = self.adapter.compile_scenario(project)
        scenario["compiled_from"]["ontology_version"] = "spare-mvp-ontology-v0"

        with self.assertRaises(jsonschema.ValidationError):
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
                {"run_config", "input_project", "compiled_scenario", "snapshot", "result_summary", "metrics", "report", "log"},
            )
            for artifact in manifest["artifacts"]:
                target = Path(tmp) / artifact["path"]
                self.assertTrue(target.exists(), artifact)
                self.assertGreater(artifact["size_bytes"], 0)
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")

    def test_run_smoke_scenario_writes_m7_management_artifacts(self) -> None:
        scenario = self._smoke_scenario()
        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(scenario, output_dir=tmp, steps=2, run_id="run-m7-single")
            manifest = bundle["artifact_manifest"]
            kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            self.assertGreaterEqual(
                kinds,
                {"run_config", "input_project", "compiled_scenario", "snapshot", "result_summary", "metrics", "report", "log"},
            )
            for artifact in manifest["artifacts"]:
                target = Path(tmp) / artifact["path"]
                self.assertTrue(target.is_file(), artifact)
                self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), artifact["sha256"])
                self.assertEqual(target.stat().st_size, artifact["size_bytes"])

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

    def test_monte_carlo_scenario_consumes_normalized_config_without_project_snapshot_fallback(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        scenario["simulation_inputs"]["project_snapshot"]["monteCarlo"] = {
            "failureRates": [0.99],
            "spareMultipliers": [9.9],
            "supportCapacities": [99],
        }

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=Path(tmp),
                steps=3,
                run_id="run-normalized-mc-config",
                monte_carlo_config={
                    "sample_count": 4,
                    "sweep": {
                        "failureRates": [0.05],
                        "spareMultipliers": [1.0, 1.25],
                        "supportCapacities": [2],
                    },
                    "mc_experiment_id": "mc-normalized-config",
                },
            )
            base = next(
                artifact
                for artifact in bundle["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "monte_carlo_base"
            )
            payload = json.loads((Path(tmp) / base["path"]).read_text(encoding="utf-8"))

        self.assertEqual(payload["sample_count"], 4)
        self.assertEqual(payload["mc_experiment_id"], "mc-normalized-config")
        self.assertEqual(payload["sweep"]["failureRates"], [0.05])
        self.assertEqual(payload["sweep"]["spareMultipliers"], [1.0, 1.25])
        self.assertEqual(payload["sweep"]["supportCapacities"], [2])
        self.assertNotEqual(payload["sweep"]["failureRates"], [0.99])

    def test_run_monte_carlo_scenario_registers_support_and_m7_artifacts(self) -> None:
        scenario = self._smoke_scenario()
        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=tmp,
                steps=2,
                run_id="run-m7-mc",
                monte_carlo_config={
                    "sample_count": 2,
                    "sweep": {"failureRates": [0.05], "spareMultipliers": [1.0], "supportCapacities": [1]},
                    "mc_experiment_id": "mc-m7",
                },
            )
            kinds = {artifact["kind"] for artifact in bundle["artifact_manifest"]["artifacts"]}
            self.assertGreaterEqual(
                kinds,
                {
                    "run_config",
                    "input_project",
                    "compiled_scenario",
                    "sample_results",
                    "aggregate_result",
                    "result_summary",
                    "metrics",
                    "report",
                    "log",
                    "monte_carlo_base",
                    "analysis_projection_spare_shortfall",
                    "analysis_projection_carry_list",
                    "analysis_projection_mission_reliability",
                    "analysis_projection_downtime_factors",
                },
            )

    def test_monte_carlo_scenario_rejects_missing_normalized_config_without_fallback(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        scenario["simulation_inputs"]["project_snapshot"]["monteCarlo"] = {
            "failureRates": [0.99],
            "spareMultipliers": [9.9],
            "supportCapacities": [99],
        }

        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(AdapterError) as ctx:
                self.adapter.run_monte_carlo_scenario(
                    scenario,
                    output_dir=Path(tmp),
                    steps=1,
                    run_id="run-missing-normalized-config",
                )

            self.assertEqual(ctx.exception.code, "bad_analysis_request")
            self.assertIn("monte_carlo_config", ctx.exception.details.get("field_path", ""))
            self.assertEqual(list(Path(tmp).glob("**/*")), [])

    def test_monte_carlo_scenario_rejects_legacy_sample_count_and_sweep_paths(self) -> None:
        project = self._load_fixture("smoke_project.json")
        scenario = self.adapter.compile_scenario(project)
        legacy_cases = [
            ("sample_count", {"sample_count": 4}),
            (
                "sweep",
                {
                    "sweep": {
                        "failureRates": [0.05],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [2],
                    }
                },
            ),
            (
                "sample_count_and_sweep",
                {
                    "sample_count": 4,
                    "sweep": {
                        "failureRates": [0.05],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [2],
                    },
                },
            ),
        ]

        for label, kwargs in legacy_cases:
            with self.subTest(label), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(AdapterError) as ctx:
                    self.adapter.run_monte_carlo_scenario(
                        scenario,
                        output_dir=Path(tmp),
                        steps=1,
                        run_id=f"run-legacy-{label}",
                        **kwargs,
                    )

                self.assertEqual(ctx.exception.code, "bad_analysis_request")
                self.assertIn("monte_carlo_config", str(ctx.exception))
                self.assertEqual(list(Path(tmp).glob("**/*")), [])


if __name__ == "__main__":
    unittest.main()
