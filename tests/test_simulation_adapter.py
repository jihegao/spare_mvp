from __future__ import annotations

import copy
import hashlib
import json
import tempfile
from pathlib import Path
import unittest
import warnings

import jsonschema

from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter
from src.spare_mvp_backend.m9_6_case_package import build_m9_6_platform_case_export


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

    def test_compile_aviation_support_scenario_from_project_contract(self) -> None:
        project = self._load_fixture("aviation_support_project.json")
        schema = json.loads((REPO_ROOT / "contracts" / "scenario.schema.json").read_text(encoding="utf-8"))

        scenario = self.adapter.compile_scenario(project, model_family="aviation_support")

        jsonschema.validate(instance=scenario, schema=schema)
        self.assertEqual(scenario["schema_version"], "scenario-v0")
        self.assertEqual(scenario["scenario_id"], "scenario-aviation-support-contract-demo")
        self.assertEqual(scenario["project_id"], "project-aviation-support-contract-001")
        self.assertEqual(
            scenario["simulation_model"],
            {
                "family": "aviation_support",
                "model_id": "AviationSupportModel",
                "contract_version": "1.0.0",
            },
        )
        self.assertEqual(
            scenario["simulation_inputs"],
            {
                "aircraft_count": 8,
                "mission_count": 3,
                "mission_aircraft_required": 5,
                "mechanic_teams": 3,
                "fuel_trucks": 2,
                "maintenance_bays": 2,
                "lru_failure_multiplier": 1,
                "seed": 20260618,
            },
        )
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertEqual(provenance["model_family"], "aviation_support")
        self.assertEqual(provenance["mapping_version"], "aviation-support-input-v0")
        self.assertIn("equipment.quantity", provenance["consumed_fields"])
        self.assertIn("basicMission.equipmentQuantity", provenance["consumed_fields"])
        self.assertIn("supportNodes[].personnelCapacity", provenance["consumed_fields"])
        self.assertEqual(provenance["unsupported_fields"], [])

    def test_aviation_support_compile_gate_returns_compiled_scenario(self) -> None:
        project = self._load_fixture("aviation_support_project.json")

        result = self.adapter.compile_scenario_with_gate(project, model_family="aviation_support")

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(result["scenario"]["simulation_model"]["family"], "aviation_support")
        self.assertEqual(result["provenance"]["model_family"], "aviation_support")
        self.assertEqual(result["issues"], [])

    def test_invalid_aviation_support_project_keeps_current_mapping_provenance(self) -> None:
        project = self._load_fixture("aviation_support_project.json")
        del project["components"]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aviation_support")

        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "aviation_support")
        self.assertEqual(result["provenance"]["mapping_version"], "aviation-support-input-v0")
        self.assertEqual(result["provenance"]["unsupported_fields"], [])
        self.assertEqual(result["issues"][0]["field_path"], "components")

    def test_compile_aircraft_support_v1_scenario_from_m9_6_platform_case(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        scenario_schema = json.loads((REPO_ROOT / "contracts" / "scenario.schema.json").read_text(encoding="utf-8"))
        input_schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8")
        )
        scenario_schema["oneOf"][2]["allOf"][1]["then"]["properties"]["simulation_inputs"] = input_schema

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            jsonschema.validate(instance=scenario, schema=scenario_schema)
            jsonschema.validate(instance=scenario["simulation_inputs"], schema=input_schema)
        self.assertEqual(
            scenario["simulation_model"],
            {
                "family": "aircraft_support_v1",
                "model_id": "AircraftSupportV1Model",
                "contract_version": "1.0.0",
            },
        )
        inputs = scenario["simulation_inputs"]
        self.assertEqual(inputs["time"]["tick_minutes"], 1)
        self.assertEqual(inputs["time"]["sample_every_minutes"], 30)
        self.assertEqual(inputs["time"]["max_state_frames_single"], 2000)
        self.assertEqual(inputs["aircraft"]["fleet_count"], 6)
        self.assertEqual(inputs["aircraft"]["initial_ready"], 6)
        self.assertEqual(len(inputs["equipment_tree"]["components"]), len(project["components"]))
        self.assertEqual(len(inputs["support_network"]["nodes"]), len(project["supportNodes"]))
        self.assertEqual(len(inputs["support_activities"]["activities"]), len(project["supportActivities"]))
        self.assertEqual(inputs["monte_carlo"]["sample_count"], 24)
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertEqual(provenance["model_family"], "aircraft_support_v1")
        self.assertEqual(provenance["mapping_version"], "aircraft-support-v1-input-v0")
        self.assertIn("components[].failureDistribution", provenance["consumed_fields"])
        self.assertIn("supportActivities[].jobs[].predecessors", provenance["consumed_fields"])
        self.assertIn("projectInfo", provenance["governance_only_fields"])
        self.assertIn("supportOrganization", provenance["unsupported_fields"])

    def test_aircraft_support_v1_compile_gate_blocks_invalid_references(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportActivities"][0]["resourceId"] = "missing-support-node"
        project["supportActivities"][0]["jobs"][1]["predecessors"] = ["missing-job-code"]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "aircraft_support_v1")
        issue_codes = {issue["code"] for issue in result["issues"]}
        self.assertIn("missing_support_resource_reference", issue_codes)
        self.assertIn("missing_support_activity_predecessor", issue_codes)

    def test_run_aviation_support_scenario_writes_backend_aligned_artifacts(self) -> None:
        project = self._load_fixture("aviation_support_project.json")
        scenario = self.adapter.compile_scenario(project, model_family="aviation_support")
        result_schema = json.loads((REPO_ROOT / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
        manifest_schema = json.loads((REPO_ROOT / "contracts" / "artifact_manifest.schema.json").read_text(encoding="utf-8"))
        state_series_schema = json.loads(
            (REPO_ROOT / "contracts" / "visualization_state_series.schema.json").read_text(encoding="utf-8")
        )

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=Path(tmp),
                steps=3,
                run_id="run-aviation-support-contract",
            )

            run = bundle["run"]
            result = bundle["result"]
            manifest = bundle["artifact_manifest"]

            jsonschema.validate(instance=result, schema=result_schema)
            jsonschema.validate(instance=manifest, schema=manifest_schema)
            self.assertEqual(run["status"], "succeeded")
            self.assertEqual(run["run_id"], "run-aviation-support-contract")
            self.assertEqual(run["model_family"], "aviation_support")
            self.assertEqual(run["model_id"], "AviationSupportModel")
            self.assertEqual(result["model_family"], "aviation_support")
            self.assertEqual(result["run_id"], run["run_id"])
            self.assertEqual(result["scenario_id"], scenario["scenario_id"])
            for metric in [
                "sortie_completion_rate",
                "available_aircraft",
                "active_jobs",
                "spare_stock_total",
                "avg_departure_delay",
                "spare_consumed_total",
                "maintenance_backlog",
            ]:
                self.assertIn(metric, result["metrics"])

            artifact_kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            self.assertEqual(
                artifact_kinds,
                {
                    "run_config",
                    "input_project",
                    "compiled_scenario",
                    "snapshot",
                    "result_summary",
                    "metrics",
                    "report",
                    "log",
                    "visualization_state_series",
                    "analysis_projection_spare_shortfall",
                    "analysis_projection_carry_list",
                    "analysis_projection_mission_reliability",
                    "analysis_projection_downtime_factors",
                },
            )
            for artifact in manifest["artifacts"]:
                target = Path(tmp) / artifact["path"]
                self.assertTrue(target.exists(), artifact)
                self.assertGreater(artifact["size_bytes"], 0)
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")
                if artifact["kind"] == "input_project":
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    self.assertEqual(payload, project)
                if artifact["kind"] == "compiled_scenario":
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    self.assertEqual(payload, scenario)
                if artifact["kind"].startswith("analysis_projection_"):
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    self.assertEqual(artifact["source_artifact_id"], f"result_summary-{run['run_id']}")
                    self.assertEqual(payload["projection_type"], artifact["analysis_type"])
                if artifact["kind"] == "visualization_state_series":
                    self.assertEqual(artifact["source_run_id"], run["run_id"])
                    self.assertEqual(artifact["source_result_summary_id"], run["result_summary_id"])
                    self.assertEqual(artifact["source_scenario_id"], scenario["scenario_id"])
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    jsonschema.validate(instance=payload, schema=state_series_schema)
                    self.assertEqual(payload["model_family"], "aviation_support")
                    self.assertEqual(payload["run_id"], run["run_id"])
                    self.assertEqual(payload["scenario_id"], scenario["scenario_id"])
                    self.assertGreater(len(payload["frames"]), 0)
                    for frame in payload["frames"]:
                        self.assertEqual(frame["run_id"], run["run_id"])
                        self.assertEqual(frame["trace"]["run_id"], run["run_id"])
                        self.assertEqual(frame["trace"]["scenario_id"], scenario["scenario_id"])
                        self.assertIn("aircraft", frame)
                        self.assertIn("missions", frame)
                        self.assertIn("resources", frame)
                        self.assertIn("events", frame)

    def test_aviation_support_monte_carlo_writes_formal_projection_artifacts(self) -> None:
        project = self._load_fixture("aviation_support_project.json")
        scenario = self.adapter.compile_scenario(project, model_family="aviation_support")
        result_schema = json.loads((REPO_ROOT / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
        manifest_schema = json.loads((REPO_ROOT / "contracts" / "artifact_manifest.schema.json").read_text(encoding="utf-8"))
        state_series_schema = json.loads(
            (REPO_ROOT / "contracts" / "visualization_state_series.schema.json").read_text(encoding="utf-8")
        )

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=Path(tmp),
                steps=2,
                run_id="run-aviation-mc-contract",
                monte_carlo_config={
                    "sample_count": 8,
                    "sweep": {
                        "failureRates": [0.05, 0.08],
                        "spareMultipliers": [1.0, 1.25],
                        "supportCapacities": [2, 3],
                    },
                    "mc_experiment_id": "mc-aviation-contract",
                },
            )
            run = bundle["run"]
            result = bundle["result"]
            manifest = bundle["artifact_manifest"]
            kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
            base_payload = json.loads((Path(tmp) / base_artifact["path"]).read_text(encoding="utf-8"))
            projection_artifacts = [
                artifact for artifact in manifest["artifacts"] if artifact["kind"].startswith("analysis_projection_")
            ]
            state_series_artifact = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "visualization_state_series"
            )
            state_payload = json.loads((Path(tmp) / state_series_artifact["path"]).read_text(encoding="utf-8"))

        jsonschema.validate(instance=result, schema=result_schema)
        jsonschema.validate(instance=manifest, schema=manifest_schema)
        jsonschema.validate(instance=state_payload, schema=state_series_schema)
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["model_family"], "aviation_support")
        self.assertEqual(run["run_type"], "monte_carlo")
        self.assertEqual(run["mc_experiment_id"], "mc-aviation-contract")
        self.assertEqual(result["model_family"], "aviation_support")
        self.assertEqual(result["run_id"], run["run_id"])
        self.assertEqual(kinds & {
            "sample_results",
            "aggregate_result",
            "monte_carlo_base",
            "visualization_state_series",
        }, {
            "sample_results",
            "aggregate_result",
            "monte_carlo_base",
            "visualization_state_series",
        })
        self.assertEqual(len(projection_artifacts), 4)
        self.assertTrue(all(artifact["source_artifact_id"] == base_artifact["artifact_id"] for artifact in projection_artifacts))
        self.assertEqual(base_payload["model_family"], "aviation_support")
        self.assertEqual(base_payload["sample_count"], 8)
        self.assertEqual(base_payload["sampling_contract"]["schema_version"], "aviation-support-monte-carlo-sampling-v0")
        self.assertEqual(
            base_payload["sampling_contract"]["dimensions"][0]["interpretation"],
            "multiplier applied to the compiled aviation LRU hazard baseline",
        )
        self.assertEqual(base_payload["sweep"]["failureRates"], [0.05, 0.08])
        self.assertEqual(base_payload["sweep"]["spareMultipliers"], [1.0, 1.25])
        self.assertEqual(base_payload["sweep"]["supportCapacities"], [2, 3])
        self.assertEqual(len(base_payload["samples"]), 8)
        self.assertEqual(
            {
                (
                    sample["sweep"]["failure_rate"],
                    sample["sweep"]["spare_multiplier"],
                    sample["sweep"]["support_capacity"],
                )
                for sample in base_payload["samples"]
            },
            {
                (0.05, 1.0, 2),
                (0.05, 1.0, 3),
                (0.05, 1.25, 2),
                (0.05, 1.25, 3),
                (0.08, 1.0, 2),
                (0.08, 1.0, 3),
                (0.08, 1.25, 2),
                (0.08, 1.25, 3),
            },
        )
        self.assertEqual(state_payload["model_family"], "aviation_support")
        self.assertEqual(state_payload["run_id"], run["run_id"])
        self.assertGreater(len(state_payload["frames"]), 0)
        self.assertEqual(
            [frame["simulation_time"] for frame in state_payload["frames"]],
            sorted(frame["simulation_time"] for frame in state_payload["frames"]),
        )
        self.assertTrue(all("sample_index" in frame and "sample_step" in frame for frame in state_payload["frames"]))

    def test_monte_carlo_scenario_rejects_sample_count_below_sweep_point_count(self) -> None:
        scenario = self.adapter.compile_scenario(
            self._load_fixture("aviation_support_project.json"),
            model_family="aviation_support",
        )
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(AdapterError) as ctx:
                self.adapter.run_monte_carlo_scenario(
                    scenario,
                    output_dir=Path(tmp),
                    steps=1,
                    monte_carlo_config={
                        "sample_count": 4,
                        "sweep": {
                            "failureRates": [0.05, 0.08],
                            "spareMultipliers": [1.0, 1.25],
                            "supportCapacities": [2, 3],
                        },
                    },
                )

        self.assertEqual(ctx.exception.code, "bad_analysis_request")
        self.assertEqual(ctx.exception.details["sweep_point_count"], 8)
        self.assertEqual(list(Path(tmp).glob("**/*")), [])

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
                {
                    "run_config",
                    "input_project",
                    "compiled_scenario",
                    "snapshot",
                    "result_summary",
                    "metrics",
                    "report",
                    "log",
                    "visualization_state_series",
                },
            )
            for artifact in manifest["artifacts"]:
                target = Path(tmp) / artifact["path"]
                self.assertTrue(target.exists(), artifact)
                self.assertGreater(artifact["size_bytes"], 0)
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")
                if artifact["kind"] == "visualization_state_series":
                    self.assertEqual(artifact["source_run_id"], run["run_id"])
                    self.assertEqual(artifact["source_result_summary_id"], run["result_summary_id"])
                    self.assertEqual(artifact["source_scenario_id"], scenario["scenario_id"])
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    self.assertEqual(payload["schema_version"], "visualization-state-series-v0")
                    self.assertEqual(payload["run_id"], run["run_id"])
                    self.assertEqual(payload["scenario_id"], scenario["scenario_id"])
                    self.assertEqual(payload["artifact_manifest_id"], run["artifact_manifest_id"])
                    self.assertEqual(payload["result_summary_id"], run["result_summary_id"])
                    self.assertGreater(len(payload["frames"]), 0)
                    for frame in payload["frames"]:
                        self.assertEqual(frame["run_id"], run["run_id"])
                        self.assertEqual(frame["trace"]["run_id"], run["run_id"])
                        self.assertEqual(frame["trace"]["scenario_id"], scenario["scenario_id"])
                        self.assertEqual(frame["trace"]["result_summary_id"], run["result_summary_id"])
                        self.assertIn("aircraft", frame)
                        self.assertIn("missions", frame)
                        self.assertIn("resources", frame)
                        self.assertIn("events", frame)
                        for event in frame["events"]:
                            self.assertEqual(event["run_id"], run["run_id"])
                            self.assertEqual(event["step"], frame["step"])
                            self.assertTrue(event["event_id"])

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

    def test_m9_6_expected_artifact_kinds_match_runtime_aviation_support_manifest(self) -> None:
        export = build_m9_6_platform_case_export(
            self._load_fixture("modeling_import_project.json"),
            repo_root=REPO_ROOT,
        )
        expected = self._load_fixture("m9_6_expected_artifact_kinds.json")

        with tempfile.TemporaryDirectory() as tmp:
            single_bundle = self.adapter.run_scenario(
                export["compiled_scenario"],
                output_dir=tmp,
                steps=1,
                run_id="run-m9-6-runtime-single",
            )
            monte_carlo_config = copy.deepcopy(export["monte_carlo_config"])
            monte_carlo_config["sample_count"] = _sweep_point_count(monte_carlo_config["sweep"])
            monte_carlo_bundle = self.adapter.run_monte_carlo_scenario(
                export["compiled_scenario"],
                output_dir=tmp,
                steps=1,
                run_id="run-m9-6-runtime-mc",
                monte_carlo_config=monte_carlo_config,
            )

        self.assertEqual(_artifact_kinds(single_bundle), expected["single"])
        self.assertEqual(_artifact_kinds(monte_carlo_bundle), expected["monte_carlo"])

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


def _artifact_kinds(bundle: dict) -> list[str]:
    return [artifact["kind"] for artifact in bundle["artifact_manifest"]["artifacts"]]


def _sweep_point_count(sweep: dict) -> int:
    total = 1
    for values in sweep.values():
        total *= len(values)
    return total


if __name__ == "__main__":
    unittest.main()
