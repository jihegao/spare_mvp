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

    def _with_product_catalog(self, project: dict) -> dict:
        project = copy.deepcopy(project)
        products = []
        component_products = {}
        for component in project.get("components", []):
            product_id = f"product-{component['id']}"
            component["productId"] = product_id
            component.pop("spareType", None)
            products.append({"id": product_id, "name": component.get("name") or component["id"], "model": component.get("name") or component["id"]})
            component_products[str(component.get("id"))] = product_id
        for resource in project.get("supportResources", []):
            if resource.get("type") != "spare":
                continue
            resource["productId"] = component_products.get(str(resource.get("model"))) or products[0]["id"]
        project["products"] = products
        return project

    def test_downtime_projection_maps_four_factor_event_ledger_without_duplicate_ids(self) -> None:
        samples = [
            {
                "sample_index": sample_index,
                "seed": 100 + sample_index,
                "downtime_events": [
                    {
                        "event_id": "downtime-000001",
                        "factor": factor,
                        "start_minute": 0,
                        "end_minute": duration,
                        "duration_minutes": duration,
                        "details": {},
                    }
                ],
            }
            for sample_index, (factor, duration) in enumerate([
                ("spare_shortage", 120),
                ("equipment_shortage", 60),
                ("failure", 30),
                ("preventive", 15),
            ])
        ]

        projection = self.adapter._aircraft_support_v1_analysis_projections(
            {},
            "base-artifact",
            samples=samples,
            run_id="run-downtime-ledger",
        )["downtime_factors"]

        rows = {row["factor"]: row for row in projection["data"]}
        self.assertEqual(set(rows), {"spare_shortage", "equipment_shortage", "failure", "preventive"})
        self.assertEqual(rows["spare_shortage"]["event_count"], 1)
        self.assertEqual(rows["spare_shortage"]["downtime_hours"], 2)
        self.assertAlmostEqual(sum(row["duration_contribution"] for row in rows.values()), 1.0)
        details = projection["event_details"]
        self.assertEqual(len(details), 4)
        self.assertEqual(len({event["event_id"] for event in details}), 4)
        self.assertEqual({event["source_event_id"] for event in details}, {"downtime-000001"})

    def test_validate_project_accepts_contract_fixture(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")

        result = self.adapter.validate_project(project)

        self.assertTrue(result["ok"])
        self.assertEqual(result["project_id"], "project-aircraft-support-contract-001")
        self.assertEqual(result["project_schema_version"], "project-v0")
        self.assertEqual(result["errors"], [])

    def test_validate_project_reports_missing_contract_roots(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        del project["components"]

        result = self.adapter.validate_project(project)

        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["path"], "components")
        self.assertEqual(result["errors"][0]["code"], "missing_required")

    def test_aircraft_support_v1_compiles_product_ids_and_product_display_names(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        components = scenario["simulation_inputs"]["equipment_tree"]["components"]
        self.assertTrue(all(component["product_id"] for component in components))
        self.assertTrue(all("spare_type" not in component and "spareType" not in component for component in components))
        self.assertEqual(
            {component["product_name"] for component in components},
            {product["name"] for product in project["products"]},
        )
        provenance = scenario["compiled_from"]["mapping_provenance"]["consumed_fields"]
        self.assertIn("products[]", provenance)
        self.assertIn("components[].productId", provenance)
        self.assertNotIn("components[].spareType", provenance)

    def test_issue_237_current_project_and_saved_plan_keep_the_same_aircraft_product_pairs(self) -> None:
        current_project = self._with_product_catalog(self._load_fixture("m9_6_platform_case_export.json")["project"])
        saved_plan_project = copy.deepcopy(current_project)

        identities = []
        for project in (current_project, saved_plan_project):
            scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
            projections = self.adapter._aircraft_support_v1_analysis_projections(
                {"planned_sorties": 1, "spare_fill_rate": 1.0, "spare_utilization": 0.0},
                "issue-237-probe",
                simulation_inputs=scenario["simulation_inputs"],
            )
            rows = projections["carry_list"]["data"]
            self.assertTrue(rows)
            self.assertNotIn("全部机型", {row["aircraft_model"] for row in rows})
            self.assertTrue(all(row["product_id"] for row in rows))
            identities.append(
                {(row["aircraft_model"], row["product_id"], row["spare_type"]) for row in rows}
            )

        self.assertEqual(identities[0], identities[1])

    def test_aircraft_support_v1_blocks_duplicate_product_ids_after_normalization(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))
        project["products"].append(dict(project["products"][0]))

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertTrue(
            any(issue["code"] == "duplicate_product_id" for issue in result["issues"])
        )

    def test_compile_smoke_scenario_is_retired(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")

        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario(project, model_family="smoke")

        self.assertEqual(ctx.exception.code, "retired_model_family")
        self.assertEqual(ctx.exception.details["model_family"], "smoke")
        self.assertEqual(ctx.exception.details["replacement_model_family"], "aircraft_support_v1")

    def test_smoke_compile_gate_returns_retired_family(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")

        result = self.adapter.compile_scenario_with_gate(project, model_family="smoke")

        self.assertEqual(result["status"], "unsupported")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "smoke")
        self.assertEqual(result["provenance"]["mapping_version"], "retired-model-family")
        self.assertEqual(result["issues"][0]["code"], "retired_model_family")
        self.assertEqual(result["issues"][0]["field_path"], "model_family")

    def test_compile_invalid_project_raises_invalid_project_with_validation_errors(self) -> None:
        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario({})

        self.assertEqual(ctx.exception.code, "invalid_project")
        self.assertIn("errors", ctx.exception.details)
        self.assertTrue(ctx.exception.details["errors"])
        self.assertEqual(ctx.exception.details["errors"][0]["code"], "missing_required")

    def test_compile_aviation_support_scenario_is_retired(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")

        with self.assertRaises(AdapterError) as ctx:
            self.adapter.compile_scenario(project, model_family="aviation_support")

        self.assertEqual(ctx.exception.code, "retired_model_family")
        self.assertEqual(ctx.exception.details["model_family"], "aviation_support")
        self.assertEqual(ctx.exception.details["replacement_model_family"], "aircraft_support_v1")

    def test_aviation_support_compile_gate_returns_retired_family(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        del project["components"]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aviation_support")

        self.assertEqual(result["status"], "unsupported")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "aviation_support")
        self.assertEqual(result["provenance"]["mapping_version"], "retired-model-family")
        self.assertEqual(result["issues"][0]["code"], "retired_model_family")
        self.assertEqual(result["issues"][0]["field_path"], "model_family")

    def test_compile_aircraft_support_v1_scenario_from_m9_6_platform_case(self) -> None:
        export = self._load_fixture("m9_6_platform_case_export.json")
        project = export["project"]
        runtime_config = export["experiment_plan"]["config"]
        scenario_schema = json.loads((REPO_ROOT / "contracts" / "scenario.schema.json").read_text(encoding="utf-8"))
        input_schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8")
        )
        aircraft_branch = next(
            branch
            for branch in scenario_schema["oneOf"]
            if branch.get("allOf", [{}])[0]
            .get("properties", {})
            .get("simulation_model", {})
            .get("$ref", "")
            .endswith("/AircraftSupportV1ModelSelector")
        )
        aircraft_branch["allOf"][1]["then"]["properties"]["simulation_inputs"] = input_schema
        project["basicMissions"][0]["missionAreas"] = [{"id": "nested-basic-area"}]
        project["missionProfile"]["compositeTasks"][0]["mission_areas"] = [{"id": "nested-composite-area"}]
        project["supportActivityJobs"][0]["missionAreas"] = [{"id": "nested-job-area"}]
        project["supportActivities"][0].setdefault("transportStrategies", []).append(
            {"missionAreas": [{"id": "nested-strategy-area"}]}
        )

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1", runtime_config=runtime_config)

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
        self.assertEqual(
            inputs["stop_policy"],
            {
                "schema_version": "stop-policy-v0",
                "mode": "or",
                "conditions": [{"type": "duration", "duration_minutes": inputs["time"]["duration_minutes"]}],
                "defaulted": True,
            },
        )
        self.assertEqual(inputs["aircraft"]["fleet_count"], 6)
        self.assertEqual(inputs["aircraft"]["initial_ready"], 6)
        self.assertNotIn("mission_areas", inputs["mission_profile"])
        serialized_inputs = json.dumps(inputs, ensure_ascii=False)
        self.assertNotIn("missionAreas", serialized_inputs)
        self.assertNotIn("mission_areas", serialized_inputs)
        self.assertFalse(any("transport_strategies" in activity for activity in inputs["support_activities"]["activities"]))
        self.assertFalse(any("organization_strategies" in activity for activity in inputs["support_activities"]["activities"]))
        self.assertNotIn("experiment", project)
        self.assertNotIn("analysisRequests", project)
        self.assertNotIn("monteCarlo", project)
        self.assertEqual(len(inputs["equipment_tree"]["components"]), len(project["components"]))
        self.assertTrue(
            all(
                "spare_type" not in component and "spareType" not in component
                for component in inputs["equipment_tree"]["components"]
            )
        )
        self.assertEqual(
            [component["product_name"] for component in inputs["equipment_tree"]["components"]],
            [str(component.get("spareType") or component.get("name") or "") for component in project["components"]],
        )
        self.assertEqual(len(inputs["support_network"]["nodes"]), len(project["supportNodes"]))
        self.assertEqual(len(inputs["support_activities"]["activities"]), len(project["supportActivities"]))
        self.assertEqual(inputs["monte_carlo"]["sample_count"], 24)
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertEqual(provenance["model_family"], "aircraft_support_v1")
        self.assertEqual(provenance["mapping_version"], "aircraft-support-v1-input-v0")
        self.assertIn("components[].failureDistribution", provenance["consumed_fields"])
        self.assertIn("components[].productId", provenance["consumed_fields"])
        self.assertNotIn("components[].spareType", provenance["consumed_fields"])
        self.assertIn("supportOrganization.tree", provenance["governance_only_fields"])
        self.assertIn("supportActivityJobs[]", provenance["consumed_fields"])
        self.assertIn("supportActivities[].activityCodes", provenance["consumed_fields"])
        self.assertIn("supportActivities[].predecessors", provenance["consumed_fields"])
        self.assertIn("ExperimentPlan.config.stopPolicy", provenance["consumed_fields"])
        self.assertNotIn("missionAreas", provenance["consumed_fields"])
        self.assertIn("projectInfo", provenance["governance_only_fields"])
        self.assertEqual(provenance["unsupported_fields"], [])

    def test_aircraft_support_v1_components_are_corrective_mttr_source_of_truth(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        component = project["components"][0]
        component_id = component["id"]
        component["repairDistribution"] = {
            "distributionType": "固定值",
            "value": 42,
        }
        job = project["supportActivityJobs"][0]
        job["activityCode"] = "CM-MTTR"
        job["maxRepairTimeMinutes"] = 999
        job["meanRepairTimeMinutes"] = 888
        job["mttrMinutes"] = 777
        job["repairDistribution"] = {
            "distributionType": "固定值",
            "value": 999,
        }
        project["supportActivities"] = [
            {
                "id": "corrective-mttr-source",
                "activityType": "修复性维修",
                "equipmentId": component_id,
                "activityCodes": ["CM-MTTR"],
                "predecessors": {"CM-MTTR": []},
            }
        ]

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        compiled_component = next(
            row
            for row in scenario["simulation_inputs"]["equipment_tree"]["components"]
            if row["id"] == component_id
        )
        self.assertEqual(
            compiled_component["repair_distribution"],
            {"distributionType": "固定值", "value": 42},
        )
        compiled_job = scenario["simulation_inputs"]["support_activities"]["activities"][0]["jobs"][0]
        self.assertNotIn("maxRepairTimeMinutes", compiled_job)
        self.assertNotIn("meanRepairTimeMinutes", compiled_job)
        self.assertNotIn("mttrMinutes", compiled_job)
        self.assertNotIn("repairDistribution", compiled_job)

    def test_aircraft_support_v1_runtime_stop_policy_reaches_model_inputs(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]

        scenario = self.adapter.compile_scenario(
            project,
            model_family="aircraft_support_v1",
            runtime_config={
                "stopPolicy": {
                    "schemaVersion": "stop-policy-v0",
                    "mode": "and",
                    "conditions": [
                        {"type": "specifiedTime", "minute": 90},
                        {"type": "failure"},
                    ],
                }
            },
        )

        self.assertEqual(
            scenario["simulation_inputs"]["stop_policy"],
            {
                "schema_version": "stop-policy-v0",
                "mode": "and",
                "conditions": [
                    {"type": "specified_time", "minute": 90},
                    {"type": "failure"},
                ],
                "defaulted": False,
            },
        )

    def test_aircraft_support_v1_composite_task_legacy_equipment_quantity_is_not_runtime_input(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        task_item = project["missionProfile"]["compositeTasks"][0]["taskItems"][0]
        task_item["equipmentQuantity"] = 1
        task_item["requiredEquipmentQuantity"] = 4

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        compiled_item = scenario["simulation_inputs"]["mission_profile"]["composite_tasks"][0]["taskItems"][0]
        self.assertNotIn("equipmentQuantity", compiled_item)
        self.assertNotIn("requiredEquipmentQuantity", compiled_item)

    def test_aircraft_support_v1_derives_runtime_airport_objects_from_project_strings(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["airports"] = ["A", "B"]

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        self.assertEqual(
            scenario["simulation_inputs"]["mission_profile"]["airports"],
            [
                {"id": "airport-a", "name": "A", "location": "A", "supportNodeId": "airport-a"},
                {"id": "airport-b", "name": "B", "location": "B", "supportNodeId": "airport-b"},
            ],
        )

    def test_aircraft_support_v1_derives_aircraft_inputs_without_equipment_summary(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project.pop("equipment", None)
        project["missionProfile"].pop("equipment", None)
        project["combatUnit"]["members"][0]["deploymentLocation"] = "航母飞行甲板"

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        inputs = scenario["simulation_inputs"]
        self.assertEqual(inputs["aircraft"]["fleet_count"], len(project["combatUnit"]["members"]))
        self.assertEqual(inputs["aircraft"]["initial_ready"], len(project["combatUnit"]["members"]))
        self.assertEqual(inputs["aircraft"]["models"], ["J-15", "J-35"])
        self.assertEqual(
            [asset["tail_number"] for asset in inputs["aircraft"]["assets"]],
            [member["aircraftNo"] for member in project["combatUnit"]["members"]],
        )
        self.assertNotIn("deployment_location", inputs["aircraft"]["assets"][0])
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertIn("combatUnit.members", provenance["consumed_fields"])
        self.assertNotIn("equipment.quantity", provenance["consumed_fields"])

    def test_aircraft_support_v1_aircraft_models_accept_equipment_aircraft_types(self) -> None:
        models = self.adapter._aircraft_support_v1_aircraft_models(
            {
                "aircraftTypes": [
                    {"id": "aircraft-type-j15", "model": "J-15", "name": "歼-15"},
                    {"id": "aircraft-type-j35", "model": "J-35", "name": "歼-35"},
                ]
            },
            [],
            [],
        )

        self.assertEqual(models, ["J-15", "J-35"])

    def test_aircraft_support_v1_compiles_nested_mission_phases_per_basic_mission(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project.pop("missionPhases", None)
        project["basicMissions"][0]["missionPhases"] = [
            {"id": "phase-shared", "name": "day prep", "phaseRatio": 0.25},
            {"id": "phase-day-sortie", "name": "day sortie", "phaseRatio": 0.75},
        ]
        project["basicMissions"][1]["missionPhases"] = [
            {"id": "phase-shared", "name": "night prep", "phaseRatio": 0.2},
            {"id": "phase-night-return", "name": "night return", "phaseRatio": 0.8},
        ]

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        phases = scenario["simulation_inputs"]["mission_profile"]["mission_phases"]
        self.assertEqual(
            [(phase["basicMissionId"], phase["id"], phase["name"]) for phase in phases],
            [
                ("bm-cv-01", "phase-shared", "day prep"),
                ("bm-cv-01", "phase-day-sortie", "day sortie"),
                ("night-alert-main", "phase-shared", "night prep"),
                ("night-alert-main", "phase-night-return", "night return"),
            ],
        )
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertIn("basicMissions[].missionPhases", provenance["consumed_fields"])
        self.assertNotIn("basicMissions[].missionPhases=legacyRootMissionPhases", provenance["defaults_applied"])

    def test_aircraft_support_v1_falls_back_to_legacy_root_mission_phases(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionPhases"] = [
            {"id": "legacy-root-phase", "name": "legacy root phase", "phaseRatio": 1}
        ]
        for mission in project["basicMissions"]:
            mission.pop("missionPhases", None)

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        self.assertEqual(
            scenario["simulation_inputs"]["mission_profile"]["mission_phases"],
            [{"id": "legacy-root-phase", "name": "legacy root phase", "phaseRatio": 1}],
        )
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertIn("basicMissions[].missionPhases=legacyRootMissionPhases", provenance["defaults_applied"])

    def test_aircraft_support_v1_compile_gate_blocks_invalid_references(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportActivities"][0]["resourceId"] = "missing-support-node"
        second_code = project["supportActivities"][0]["activityCodes"][1]
        project["supportActivities"][0]["predecessors"][second_code] = ["missing-job-code"]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["scenario"])
        self.assertEqual(result["provenance"]["model_family"], "aircraft_support_v1")
        issue_codes = {issue["code"] for issue in result["issues"]}
        self.assertIn("missing_support_resource_reference", issue_codes)
        self.assertIn("missing_support_activity_predecessor", issue_codes)

    def test_aircraft_support_v1_compile_gate_resolves_support_activity_job_table(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        activity = project["supportActivities"][0]

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        compiled_jobs = scenario["simulation_inputs"]["support_activities"]["activities"][0]["jobs"]
        self.assertEqual([job["activityCode"] for job in compiled_jobs], activity["activityCodes"])
        self.assertEqual(compiled_jobs[1]["predecessors"], activity["predecessors"][compiled_jobs[1]["activityCode"]])

    def test_aircraft_support_v1_compile_gate_blocks_missing_support_activity_job_reference(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        activity = project["supportActivities"][0]
        activity["activityCodes"] = [activity["activityCodes"][0], "missing-job-code"]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIn("missing_support_activity_job_reference", {issue["code"] for issue in result["issues"]})

    def test_aircraft_support_v1_compile_gate_infers_duration_from_periodic_tasks_without_duration_hours(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["periodicTasks"] = [
            {"id": "periodic-1", "name": "weekly", "repeatCycleValue": 2, "repeatCycleUnit": "week", "repeatCount": 2}
        ]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(result["scenario"]["simulation_inputs"]["time"]["duration_minutes"], 28 * 24 * 60)

    def test_aircraft_support_v1_compile_gate_blocks_uninferrable_periodic_duration_without_duration_hours(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["periodicTasks"] = [
            {"id": "periodic-1", "name": "bad periodic", "repeatCycleValue": "", "repeatCount": ""}
        ]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIn("missing_mission_duration", {issue["code"] for issue in result["issues"]})

    def test_aircraft_support_v1_compile_gate_blocks_daily_repeat_only_duration_without_duration_hours(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["periodicTasks"] = [
            {"id": "periodic-1", "name": "daily repeat only", "dailyRepeatCount": 3}
        ]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIn("missing_mission_duration", {issue["code"] for issue in result["issues"]})

    def test_aircraft_support_v1_compile_gate_blocks_circular_support_activity_predecessors(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        activity = project["supportActivities"][0]
        codes = activity["activityCodes"][:2]
        activity["predecessors"][codes[0]] = [codes[1]]
        activity["predecessors"][codes[1]] = [codes[0]]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIn("circular_support_activity_predecessor", {issue["code"] for issue in result["issues"]})

    def test_aircraft_support_v1_compile_gate_blocks_normalized_duplicate_aircraft_tail_numbers(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        members = project["combatUnit"]["members"]
        members[0]["aircraftNo"] = " J15-101 "
        members[1]["aircraftNo"] = "J15-101"

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertIn("duplicate_aircraft_tail_number", {issue["code"] for issue in result["issues"]})

    def test_run_aircraft_support_v1_single_run_writes_real_artifacts_and_behavior_scope(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        self.assertEqual(scenario["simulation_inputs"]["time"]["duration_minutes"], 14 * 24 * 60)
        self.assertEqual(
            [asset["tail_number"] for asset in scenario["simulation_inputs"]["aircraft"]["assets"][:3]],
            ["J15-101", "J15-102", "J35-201"],
        )
        result_schema = json.loads((REPO_ROOT / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
        manifest_schema = json.loads((REPO_ROOT / "contracts" / "artifact_manifest.schema.json").read_text(encoding="utf-8"))
        state_series_schema = json.loads(
            (REPO_ROOT / "contracts" / "visualization_state_series.schema.json").read_text(encoding="utf-8")
        )

        with tempfile.TemporaryDirectory() as first_tmp, tempfile.TemporaryDirectory() as second_tmp:
            first = self.adapter.run_scenario(
                scenario,
                output_dir=Path(first_tmp),
                run_id="run-aircraft-v1-single",
            )
            second = self.adapter.run_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(second_tmp),
                run_id="run-aircraft-v1-single",
            )

            run = first["run"]
            result = first["result"]
            manifest = first["artifact_manifest"]
            kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            state_artifact = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "visualization_state_series"
            )
            report_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "report")
            log_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "log")
            projection_artifact = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "analysis_projection_downtime_factors"
            )
            state_payload = json.loads((Path(first_tmp) / state_artifact["path"]).read_text(encoding="utf-8"))
            report_payload = json.loads((Path(first_tmp) / report_artifact["path"]).read_text(encoding="utf-8"))
            log_payload = json.loads((Path(first_tmp) / log_artifact["path"]).read_text(encoding="utf-8"))
            projection_payload = json.loads((Path(first_tmp) / projection_artifact["path"]).read_text(encoding="utf-8"))

        jsonschema.validate(instance=result, schema=result_schema)
        jsonschema.validate(instance=manifest, schema=manifest_schema)
        jsonschema.validate(instance=state_payload, schema=state_series_schema)
        missing_compact_status_payload = copy.deepcopy(state_payload)
        del missing_compact_status_payload["frames"][0]["missions"][0]["status"]
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(instance=missing_compact_status_payload, schema=state_series_schema)
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["model_family"], "aircraft_support_v1")
        self.assertEqual(run["model_id"], "AircraftSupportV1Model")
        self.assertEqual(result["model_family"], "aircraft_support_v1")
        self.assertEqual(result["metrics"], second["result"]["metrics"])
        self.assertIn("anomaly_snapshots", projection_payload)
        self.assertTrue(projection_payload["anomaly_snapshots"])
        downtime_snapshot = projection_payload["anomaly_snapshots"][0]
        self.assertIn(
            downtime_snapshot["event_type"],
            {"failure", "equipment_shortage", "spare_shortage", "preventive"},
        )
        self.assertIn("simulation_time", downtime_snapshot)
        self.assertIn("result", downtime_snapshot)
        self.assertIn("support_activity_state", downtime_snapshot)
        self.assertIn("job_node", downtime_snapshot)
        self.assertIn("frame_ref", downtime_snapshot)
        self.assertEqual(
            kinds,
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
        self.assertEqual(state_payload["model_family"], "aircraft_support_v1")
        self.assertEqual(state_payload["run_id"], run["run_id"])
        self.assertEqual(state_payload["scenario_id"], scenario["scenario_id"])
        self.assertEqual(state_payload["frames"][0]["simulation_time"], 0)
        self.assertEqual(state_payload["frames"][1]["simulation_time"], 30)
        self.assertLessEqual(len(state_payload["frames"]), scenario["simulation_inputs"]["time"]["max_state_frames_single"])
        self.assertIn("mission_templates", state_payload)
        self.assertTrue(state_payload["mission_templates"])
        self.assertIn("mission_id", state_payload["frames"][0]["missions"][0])
        self.assertIn("status", state_payload["frames"][0]["missions"][0])
        self.assertNotIn("day_index", state_payload["frames"][0]["missions"][0])
        self.assertIn("failure_tree_templates", state_payload)
        self.assertTrue(state_payload["failure_tree_templates"])
        self.assertIn("failure_tree_ref", state_payload["frames"][0]["aircraft"][0])
        self.assertIn("failure_tree_state", state_payload["frames"][0]["aircraft"][0])
        self.assertNotIn("failure_tree", state_payload["frames"][0]["aircraft"][0])
        for metric in [
            "sortie_completion_rate",
            "available_aircraft",
            "active_jobs",
            "spare_stock_total",
            "avg_departure_delay",
            "spare_consumed_total",
            "maintenance_backlog",
            "lru_failures",
            "failed_sorties",
            "postflight_backlog",
            "preventive_backlog",
            "transport_in_transit_count",
        ]:
            self.assertIn(metric, result["metrics"])
        for frame in state_payload["frames"]:
            self.assertEqual(frame["run_id"], run["run_id"])
            self.assertEqual(frame["trace"]["run_id"], run["run_id"])
            self.assertEqual(frame["trace"]["scenario_id"], scenario["scenario_id"])
            self.assertIn("aircraft", frame)
            self.assertIn("missions", frame)
            self.assertIn("resources", frame)
            self.assertIn("spares", frame)
            self.assertIn("jobs", frame)
            self.assertIn("events", frame)
        first_frame_missions = [
            {**state_payload["mission_templates"][mission["mission_id"]], **mission}
            for mission in state_payload["frames"][0]["missions"]
        ]
        first_mission = first_frame_missions[0]
        self.assertEqual(max(mission["day_index"] for mission in first_frame_missions), 14)
        self.assertGreater(max(mission["wave_index"] for mission in first_frame_missions), 1)
        self.assertTrue(all(mission["day_index"] >= 1 for mission in first_frame_missions))
        self.assertTrue(all(mission["duration_minutes"] > 0 for mission in first_frame_missions))
        self.assertTrue(all(mission["required_aircraft"] > 0 for mission in first_frame_missions))
        self.assertTrue(all(mission["required_aircraft_type"] for mission in first_frame_missions))
        self.assertEqual(first_mission["task_category"], "periodic")
        self.assertEqual(first_mission["periodic_task_name"], "航母昼夜保障周期任务")
        self.assertEqual(first_mission["composite_task_name"], "昼间制空复合任务")
        self.assertEqual(first_mission["basic_task_name"], "近海制空巡逻任务")
        self.assertEqual(first_mission["required_aircraft_type"], "J-15")
        self.assertEqual(first_mission["day_index"], 1)
        self.assertEqual(first_mission["wave_index"], 1)
        self.assertIn("duration_minutes", first_mission)

        self.assertEqual(projection_payload["model_family"], "aircraft_support_v1")
        self.assertEqual(
            {row["factor"] for row in projection_payload["data"]},
            {"failure", "equipment_shortage", "spare_shortage", "preventive"},
        )

        scope = report_payload["m9_7_4_behavior_scope"]
        self.assertIn("combatUnit.members", scope["behavior_driving_fields"])
        self.assertIn("components[].aircraftModel", scope["behavior_driving_fields"])
        self.assertIn("missionProfile.compositeTasks", scope["behavior_driving_fields"])
        self.assertIn("missionProfile.periodicTasks", scope["behavior_driving_fields"])
        self.assertIn("components[].failureDistribution", scope["behavior_driving_fields"])
        self.assertIn("transportPolicies[]", scope["behavior_driving_fields"])
        self.assertIn("supportResources[].quantity", scope["behavior_driving_fields"])
        self.assertIn("supportActivityJobs[]", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].activityCodes", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].predecessors", scope["behavior_driving_fields"])
        self.assertNotIn("experiment.steps", scope["behavior_driving_fields"])
        self.assertEqual(scope["fail_closed_fields"], [])
        self.assertEqual(scope["m9_7_4_coverage_hardening_fields"], [])
        self.assertTrue(
            any(event.get("event") == "m9_7_4_behavior_scope_declared" for event in log_payload["events"])
        )

    def test_aircraft_support_v1_repeat_count_without_period_defaults_to_daily_duration(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        periodic = project["missionProfile"]["periodicTasks"][0]
        for key in (
            "taskPeriodDays",
            "periodDays",
            "cycleDays",
            "repeatCycleDays",
            "repeatCycleValue",
            "repeatRounds",
            "repeatWeeks",
        ):
            periodic.pop(key, None)
        periodic["repeatCount"] = 3

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        self.assertEqual(scenario["simulation_inputs"]["time"]["duration_minutes"], 3 * 24 * 60)

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=Path(tmp),
                run_id="run-aircraft-v1-repeat-count-only",
            )
            state_artifact = next(
                artifact
                for artifact in bundle["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "visualization_state_series"
            )
            state_payload = json.loads((Path(tmp) / state_artifact["path"]).read_text(encoding="utf-8"))

        first_frame_missions = [
            {**state_payload["mission_templates"][mission["mission_id"]], **mission}
            for mission in state_payload["frames"][0]["missions"]
        ]
        self.assertEqual(max(mission["day_index"] for mission in first_frame_missions), 3)

    def test_compile_aircraft_support_v1_aggregates_slim_support_resources_and_transport_policies(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportNodes"] = [
            {"id": "support-node-1", "name": "基地"},
            {"id": "support-node-2", "name": "基层"},
        ]
        project["supportResources"] = [
            {"id": "personnel-1", "supportNodeName": "基地", "type": "personnel", "name": "航电人员", "quantity": 5},
            {"id": "equipment-1", "supportNodeName": "基地", "type": "equipment", "name": "电源车", "quantity": 3},
            {"id": "spare-1", "supportNodeName": "基地", "type": "spare", "name": "航电模块", "productId": "product-j15-avionics", "quantity": 6},
            {"id": "personnel-2", "supportNodeName": "基层", "type": "personnel", "name": "库房人员", "quantity": 2},
            {"id": "equipment-2", "supportNodeName": "基层", "type": "equipment", "name": "转运车", "quantity": 1},
            {"id": "spare-2", "supportNodeName": "基层", "type": "spare", "name": "航电模块", "productId": "product-j15-avionics", "quantity": 9},
        ]
        project["transportPolicies"] = [{
            "id": "transport-1",
            "fromSupportNodeName": "基层",
            "toSupportNodeName": "基地",
            "productId": "product-j15-avionics",
            "capacity": 2,
            "priority": 1,
            "transportTimeHours": 1,
        }]
        for activity in project["supportActivities"]:
            if activity.get("resourceId") == "carrier-stock":
                activity["resourceId"] = "基层"
            else:
                activity["resourceId"] = "基地"

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        nodes = {node["id"]: node for node in scenario["simulation_inputs"]["support_network"]["nodes"]}
        avionics_product_id = next(
            component["product_id"]
            for component in scenario["simulation_inputs"]["equipment_tree"]["components"]
            if component["id"] == "j15-avionics"
        )
        self.assertEqual(nodes["基地"]["personnel_capacity"], 5)
        self.assertEqual(nodes["基地"]["equipment_capacity"], 3)
        self.assertEqual(nodes["基地"]["inventory"][avionics_product_id], 6)
        self.assertEqual(nodes["基层"]["inventory"][avionics_product_id], 9)
        self.assertEqual(nodes["基地"]["transport_policies"][0]["from"], "基层")
        self.assertEqual(nodes["基地"]["transport_policies"][0]["to"], "基地")
        self.assertEqual(nodes["基地"]["transport_policies"][0]["product_id"], avionics_product_id)

    def test_aircraft_support_v1_treats_support_organization_as_governance_only(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportOrganization"] = {"tree": [{"id": "carrier-wing-support"}]}
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        provenance = scenario["compiled_from"]["mapping_provenance"]

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=Path(tmp),
                run_id="run-aircraft-v1-governance-only",
            )

        self.assertEqual(provenance["unsupported_fields"], [])
        self.assertIn("supportOrganization.tree", provenance["governance_only_fields"])
        self.assertEqual(bundle["run"]["status"], "succeeded")

    def test_aircraft_support_v1_monte_carlo_writes_formal_projection_artifacts(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        result_schema = json.loads((REPO_ROOT / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
        manifest_schema = json.loads((REPO_ROOT / "contracts" / "artifact_manifest.schema.json").read_text(encoding="utf-8"))
        state_series_schema = json.loads(
            (REPO_ROOT / "contracts" / "visualization_state_series.schema.json").read_text(encoding="utf-8")
        )
        config = {
            "sample_count": 4,
            "parallel_cores": 1,
            "sweep": {
                "failureRates": [0.01, 0.02],
                "spareMultipliers": [1.0],
                "supportCapacities": [1, 2],
            },
            "mc_experiment_id": "mc-aircraft-v1-contract",
        }

        with tempfile.TemporaryDirectory() as first_tmp, tempfile.TemporaryDirectory() as second_tmp:
            first = self.adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=Path(first_tmp),
                run_id="run-aircraft-v1-mc",
                monte_carlo_config=copy.deepcopy(config),
            )
            parallel_config = copy.deepcopy(config)
            parallel_config["parallel_cores"] = 2
            second = self.adapter.run_monte_carlo_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(second_tmp),
                run_id="run-aircraft-v1-mc",
                monte_carlo_config=parallel_config,
            )
            run = first["run"]
            result = first["result"]
            manifest = first["artifact_manifest"]
            kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
            base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
            aggregate_artifact = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "aggregate_result"
            )
            projection_artifacts = [
                artifact for artifact in manifest["artifacts"] if artifact["kind"].startswith("analysis_projection_")
            ]
            spare_shortfall_artifact = next(
                artifact for artifact in projection_artifacts if artifact["kind"] == "analysis_projection_spare_shortfall"
            )
            mission_reliability_artifact = next(
                artifact for artifact in projection_artifacts if artifact["kind"] == "analysis_projection_mission_reliability"
            )
            state_artifact = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "visualization_state_series"
            )
            base_payload = json.loads((Path(first_tmp) / base_artifact["path"]).read_text(encoding="utf-8"))
            aggregate_payload = json.loads(
                (Path(first_tmp) / aggregate_artifact["path"]).read_text(encoding="utf-8")
            )
            spare_shortfall_payload = json.loads(
                (Path(first_tmp) / spare_shortfall_artifact["path"]).read_text(encoding="utf-8")
            )
            mission_reliability_payload = json.loads(
                (Path(first_tmp) / mission_reliability_artifact["path"]).read_text(encoding="utf-8")
            )
            second_base_payload = json.loads(
                (Path(second_tmp) / base_artifact["path"]).read_text(encoding="utf-8")
            )
            state_payload = json.loads((Path(first_tmp) / state_artifact["path"]).read_text(encoding="utf-8"))

        jsonschema.validate(instance=result, schema=result_schema)
        jsonschema.validate(instance=manifest, schema=manifest_schema)
        jsonschema.validate(instance=state_payload, schema=state_series_schema)
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["model_family"], "aircraft_support_v1")
        self.assertEqual(run["model_id"], "AircraftSupportV1Model")
        self.assertEqual(run["run_type"], "monte_carlo")
        self.assertEqual(run["mc_experiment_id"], "mc-aircraft-v1-contract")
        self.assertEqual(result["model_family"], "aircraft_support_v1")
        self.assertEqual(result["metrics"], second["result"]["metrics"])
        self.assertEqual(
            result["metrics"]["mission_success_probability"],
            result["metrics"]["mission_success_rate"],
        )
        self.assertEqual(base_payload["aggregate_metrics"], second_base_payload["aggregate_metrics"])
        self.assertEqual(base_payload["samples"], second_base_payload["samples"])
        self.assertEqual([sample["sample_index"] for sample in second_base_payload["samples"]], [0, 1, 2, 3])
        self.assertEqual(base_payload["logs_summary"]["worker_count"], 1)
        self.assertEqual(second_base_payload["logs_summary"]["worker_count"], 2)
        self.assertEqual(second_base_payload["logs_summary"]["executor"], "process_pool_aircraft_support_v1")
        self.assertEqual(
            kinds & {"sample_results", "aggregate_result", "monte_carlo_base", "visualization_state_series"},
            {"sample_results", "aggregate_result", "monte_carlo_base", "visualization_state_series"},
        )
        self.assertEqual(len(projection_artifacts), 4)
        self.assertTrue(all(artifact["source_artifact_id"] == base_artifact["artifact_id"] for artifact in projection_artifacts))
        self.assertEqual(spare_shortfall_payload["constraints"]["fill_rate"], [0.85, 0.9, 0.95])
        self.assertEqual(spare_shortfall_payload["constraints"]["utilization"], [0.85, 0.9, 0.95])
        self.assertEqual(spare_shortfall_payload["truncation"]["mode"], "clamp_0_1")
        self.assertEqual(
            spare_shortfall_payload["truncation"]["fields"],
            ["fill_rate", "utilization", "shortage_probability"],
        )
        self.assertIn("utilization", spare_shortfall_payload["data"][0])
        self.assertIn("constraint_results", spare_shortfall_payload["data"][0])
        mission_series = mission_reliability_payload["data"]["series"]
        mission_wave_rows = mission_reliability_payload["data"]["mission_wave_rows"]
        mission_result_fields = mission_reliability_payload["data"]["result_fields"]
        self.assertEqual(mission_series, mission_wave_rows)
        self.assertEqual([field["key"] for field in mission_result_fields], [
            "sortie_rate", "wave_success_rate", "period_completion_probability", "period_duration_days"
        ])
        self.assertEqual(mission_reliability_payload["data"]["wave_success_rate"], mission_reliability_payload["data"]["profile_reliability"])
        self.assertGreaterEqual(len(mission_series), 1)
        wave_keys = [(row["day_index"], row["wave_index"]) for row in mission_series]
        self.assertEqual(wave_keys, sorted(wave_keys))
        self.assertEqual(wave_keys[0], (1, 1))
        self.assertTrue(all(row["sample_count"] <= 4 for row in mission_series))
        self.assertTrue(
            all(
                0 <= row["mission_success_probability"] <= 1
                and 0 <= row["mean_mission_success_rate"] <= 1
                and 0 <= row["sortie_rate"] <= 1
                and row["successful_waves"] <= row["planned_waves"]
                for row in mission_series
            )
        )
        self.assertEqual(base_payload["artifact_type"], "monte_carlo_base")
        self.assertEqual(base_payload["model_family"], "aircraft_support_v1")
        self.assertEqual(base_payload["sample_count"], 4)
        self.assertEqual(base_payload["logs_summary"]["completed_samples"], 4)
        self.assertEqual(base_payload["logs_summary"]["failed_samples"], 0)
        self.assertEqual(base_payload["metric_moments"]["variance_denominator"], "n-1")
        self.assertEqual(base_payload["metric_moments"]["total_sample_count"], 4)
        self.assertEqual(base_payload["metric_moments"]["successful_sample_count"], 4)
        self.assertEqual(base_payload["metric_moments"]["failed_sample_count"], 0)
        self.assertEqual(
            first["result"]["analysis_outputs"]["monte_carlo_metric_moments"],
            base_payload["metric_moments"],
        )
        self.assertEqual(aggregate_payload["metric_moments"], base_payload["metric_moments"])
        self.assertEqual(len(base_payload["samples"]), 4)
        self.assertEqual(
            {
                (
                    sample["sweep"]["failure_rate"],
                    sample["sweep"]["spare_multiplier"],
                    sample["sweep"]["support_capacity"],
                )
                for sample in base_payload["samples"]
            },
            {(0.01, 1.0, 1), (0.01, 1.0, 2), (0.02, 1.0, 1), (0.02, 1.0, 2)},
        )
        self.assertEqual(state_payload["model_family"], "aircraft_support_v1")
        self.assertEqual(state_payload["run_id"], run["run_id"])
        self.assertEqual(state_artifact["representative_sample_id"], 0)
        self.assertEqual(state_artifact["representative_sample_seed"], base_payload["samples"][0]["seed"])
        self.assertEqual(state_artifact["representative_sample_sweep"], base_payload["samples"][0]["sweep"])
        self.assertEqual(state_artifact["representative_sample_frame_count"], len(base_payload["samples"][0]["frames"]))
        self.assertEqual(state_artifact["representative_sample_reason"], "first successful deterministic sample")
        self.assertTrue(all("sample_index" in frame and "sample_step" in frame for frame in state_payload["frames"]))
        self.assertEqual(
            {frame["sample_index"] for frame in state_payload["frames"]},
            {state_artifact["representative_sample_id"]},
        )
        self.assertEqual(len(state_payload["frames"]), state_artifact["representative_sample_frame_count"])

    def test_aircraft_support_v1_mission_reliability_series_aggregates_waves_across_samples(self) -> None:
        rows = self.adapter._aircraft_support_v1_mission_reliability_series(
            metrics={"mission_success_rate": 0.8, "sortie_rate": 0.9, "planned_sorties": 4},
            samples=[
                {
                    "mission_wave_reliability": [
                        {"day_index": 1, "wave_index": 1, "planned_sorties": 2, "launched_sorties": 2, "successful_sorties": 1, "planned_waves": 1, "successful_waves": 1, "mission_success_rate": 1, "sortie_rate": 1},
                        {"day_index": 1, "wave_index": 2, "planned_sorties": 2, "launched_sorties": 1, "successful_sorties": 0, "planned_waves": 1, "successful_waves": 0, "mission_success_rate": 0, "sortie_rate": 0.5},
                    ]
                },
                {
                    "mission_wave_reliability": [
                        {"day_index": 1, "wave_index": 1, "planned_sorties": 6, "launched_sorties": 4, "successful_sorties": 0, "planned_waves": 1, "successful_waves": 0, "mission_success_rate": 0, "sortie_rate": 4 / 6},
                    ]
                },
            ],
        )

        self.assertEqual([row["wave_key"] for row in rows], ["d1-w1", "d1-w2"])
        self.assertEqual([row["sample_count"] for row in rows], [2, 1])
        self.assertAlmostEqual(rows[0]["planned_sorties"], 4)
        self.assertAlmostEqual(rows[0]["successful_sorties"], 0.5)
        self.assertAlmostEqual(rows[0]["planned_waves"], 1)
        self.assertAlmostEqual(rows[0]["successful_waves"], 0.5)
        self.assertAlmostEqual(rows[0]["mean_mission_success_rate"], 1 / 2)
        self.assertAlmostEqual(rows[0]["sortie_rate"], 6 / 8)
        self.assertEqual(rows[1]["mean_mission_success_rate"], 0)
        self.assertTrue(all(0 <= row["mission_success_probability"] <= 1 for row in rows))

    def test_aircraft_support_v1_monte_carlo_isolates_failed_samples(self) -> None:
        class FailingSampleAdapter(SimulationAdapter):
            def _run_aircraft_support_v1_monte_carlo_sample(self, *args, sample_index: int, **kwargs):
                if sample_index == 1:
                    raise AdapterError("sample_failed", "synthetic sample failure", sample_index=sample_index)
                return super()._run_aircraft_support_v1_monte_carlo_sample(*args, sample_index=sample_index, **kwargs)

        adapter = FailingSampleAdapter(REPO_ROOT)
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        scenario = adapter.compile_scenario(project, model_family="aircraft_support_v1")

        with tempfile.TemporaryDirectory() as tmp:
            bundle = adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=Path(tmp),
                run_id="run-aircraft-v1-mc-partial",
                monte_carlo_config={
                    "sample_count": 2,
                    "sweep": {
                        "failureRates": [0.01],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [1],
                    },
                    "mc_experiment_id": "mc-aircraft-v1-partial",
                },
            )
            base_artifact = next(
                artifact for artifact in bundle["artifact_manifest"]["artifacts"] if artifact["kind"] == "monte_carlo_base"
            )
            sample_artifact = next(
                artifact for artifact in bundle["artifact_manifest"]["artifacts"] if artifact["kind"] == "sample_results"
            )
            base_payload = json.loads((Path(tmp) / base_artifact["path"]).read_text(encoding="utf-8"))
            sample_payload = json.loads((Path(tmp) / sample_artifact["path"]).read_text(encoding="utf-8"))

        self.assertEqual(bundle["run"]["status"], "succeeded")
        self.assertEqual(base_payload["logs_summary"]["completed_samples"], 1)
        self.assertEqual(base_payload["logs_summary"]["failed_samples"], 1)
        self.assertEqual(len(base_payload["samples"]), 1)
        self.assertEqual(len(base_payload["failed_samples"]), 1)
        self.assertEqual(base_payload["failed_samples"][0]["sample_index"], 1)
        self.assertEqual(base_payload["aggregate_metrics"]["sample_count"], 1)
        self.assertEqual(base_payload["metric_moments"]["total_sample_count"], 2)
        self.assertEqual(base_payload["metric_moments"]["successful_sample_count"], 1)
        self.assertEqual(base_payload["metric_moments"]["failed_sample_count"], 1)
        self.assertTrue(
            all(metric["sample_variance"] is None for metric in base_payload["metric_moments"]["metrics"])
        )
        self.assertEqual(sample_payload["failed_samples"][0]["error"]["code"], "sample_failed")

    def test_aircraft_support_v1_single_run_metrics_change_when_behavior_fields_change(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportOrganization"] = {}
        baseline_scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        constrained_project = copy.deepcopy(project)
        for resource in constrained_project["supportResources"]:
            if resource["type"] in {"personnel", "equipment"}:
                resource["quantity"] = 1
            if resource["type"] == "spare":
                resource["quantity"] = 0
        constrained_scenario = self.adapter.compile_scenario(constrained_project, model_family="aircraft_support_v1")
        self.assertNotEqual(
            baseline_scenario["simulation_inputs"]["support_network"]["nodes"],
            constrained_scenario["simulation_inputs"]["support_network"]["nodes"],
        )

        with tempfile.TemporaryDirectory() as baseline_tmp, tempfile.TemporaryDirectory() as constrained_tmp:
            baseline = self.adapter.run_scenario(
                baseline_scenario,
                output_dir=Path(baseline_tmp),
                run_id="run-aircraft-v1-baseline",
            )["result"]["metrics"]
            constrained = self.adapter.run_scenario(
                constrained_scenario,
                output_dir=Path(constrained_tmp),
                run_id="run-aircraft-v1-constrained",
            )["result"]["metrics"]

        self.assertNotEqual(
            constrained["downtime_resource_delay_events"],
            baseline["downtime_resource_delay_events"],
        )
        self.assertGreaterEqual(constrained["maintenance_backlog"], baseline["maintenance_backlog"])
        self.assertNotEqual(constrained, baseline)

    def test_aircraft_support_v1_m9_7_4_fields_drive_behavior(self) -> None:
        low_risk_project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        low_risk_project["supportOrganization"] = {}
        for node in low_risk_project["supportNodes"]:
            node["personnelCapacity"] = 50
            node["equipmentCapacity"] = 50
            inventory = node.get("inventory")
            if isinstance(inventory, list):
                for item in inventory:
                    if isinstance(item, dict):
                        item["quantity"] = 1000
            elif isinstance(inventory, dict):
                for spare_type in list(inventory):
                    inventory[spare_type] = 1000
            node["transportPolicies"] = []
        for activity in low_risk_project["supportActivities"]:
            activity.pop("calendarDayInterval", None)
            activity.pop("runHourInterval", None)
            activity.pop("takeoffLandingInterval", None)
            activity["requiredPersonnel"] = 1
            activity["requiredDevices"] = 1
        for job in low_risk_project["supportActivityJobs"]:
            job["durationMinutes"] = 1
            job["requiredPersonnel"] = 1
            job["requiredDevices"] = 1
            job["spare"] = "无"
            for job in activity.get("jobs", []):
                job["durationMinutes"] = 1
                job["requiredPersonnel"] = 1
                job["requiredDevices"] = 1
                job["spare"] = "无"
        for component in low_risk_project["components"]:
            if component.get("parentId"):
                component["failureDistribution"] = {"distributionType": "指数分布", "parameters": "lambda=0"}
                component["kOutOfN"] = {"enabled": True, "k": 1, "n": 2}
        low_risk_project["missionProfile"]["periodicTasks"][0]["dailyRepeatCount"] = 1
        low_risk_project["missionProfile"]["periodicTasks"][0]["repeatCount"] = 1

        high_risk_project = copy.deepcopy(low_risk_project)
        for component in high_risk_project["components"]:
            if component.get("parentId"):
                component["failureDistribution"] = {"distributionType": "指数分布", "parameters": "lambda=0.8"}
                component["kOutOfN"] = {"enabled": False, "k": 1, "n": 1}
        high_risk_project["missionProfile"]["periodicTasks"][0]["dailyRepeatCount"] = 3
        high_risk_project["missionProfile"]["periodicTasks"][0]["repeatCount"] = 3

        low_scenario = self.adapter.compile_scenario(low_risk_project, model_family="aircraft_support_v1")
        high_scenario = self.adapter.compile_scenario(high_risk_project, model_family="aircraft_support_v1")

        with tempfile.TemporaryDirectory() as low_tmp, tempfile.TemporaryDirectory() as high_tmp:
            low_metrics = self.adapter.run_scenario(
                low_scenario,
                output_dir=Path(low_tmp),
                run_id="run-aircraft-v1-low-risk",
            )["result"]["metrics"]
            high_metrics = self.adapter.run_scenario(
                high_scenario,
                output_dir=Path(high_tmp),
                run_id="run-aircraft-v1-high-risk",
            )["result"]["metrics"]

        self.assertGreater(high_metrics["planned_sorties"], low_metrics["planned_sorties"])
        self.assertGreater(high_metrics["lru_failures"], low_metrics["lru_failures"])
        self.assertGreaterEqual(high_metrics["maintenance_backlog"], low_metrics["maintenance_backlog"])

    def test_aircraft_support_v1_transport_policies_replenish_spare_shortages(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["supportOrganization"] = {}
        target_lru = next(
            component
            for component in project["components"]
            if component.get("parentId") and str(component.get("productType") or "").upper() == "LRU"
        )
        target_spare_name = str(target_lru["name"])
        for component in project["components"]:
            if component.get("parentId"):
                component["failureDistribution"] = {
                    "distributionType": "指数分布",
                    "parameters": "lambda=0.8" if component.get("id") == target_lru.get("id") else "lambda=0",
                }
                component["kOutOfN"] = {"enabled": False, "k": 1, "n": 1}
        for activity in project["supportActivities"]:
            activity.pop("calendarDayInterval", None)
            activity.pop("runHourInterval", None)
            activity.pop("takeoffLandingInterval", None)
            activity["requiredPersonnel"] = 1
            activity["requiredDevices"] = 1
        for job in project["supportActivityJobs"]:
            job["durationMinutes"] = 1
            job["requiredPersonnel"] = 1
            job["requiredDevices"] = 1
            job["spare"] = "无"
        for periodic_task in project["missionProfile"].get("periodicTasks", []):
            periodic_task["dailyRepeatCount"] = 1
            periodic_task["repeatCount"] = 1
        for node in project["supportNodes"]:
            node["personnelCapacity"] = 50
            node["equipmentCapacity"] = 50
        for resource in project["supportResources"]:
            if resource["type"] in {"personnel", "equipment"}:
                resource["quantity"] = 50
            elif resource["type"] == "spare":
                resource["quantity"] = 0
        project.setdefault("supportResources", []).append(
            {
                "id": "target-lru-spare-source",
                "supportNodeName": "基层1",
                "type": "spare",
                "name": target_spare_name,
                "model": target_lru["id"],
                "quantity": 6,
            }
        )
        project.setdefault("supportResources", []).append(
            {
                "id": "target-lru-spare-base",
                "supportNodeName": "基地",
                "type": "spare",
                "name": target_spare_name,
                "model": target_lru["id"],
                "quantity": 0,
            }
        )
        project["transportPolicies"] = [
            {
                "fromSupportNodeName": "基层1",
                "toSupportNodeName": "基地",
                "productId": f"product-{target_lru['id']}",
                "capacity": 4,
                "priority": 1,
                "transportTimeHours": 0,
            }
        ]
        without_transport = copy.deepcopy(project)
        without_transport["transportPolicies"] = []

        with_transport_scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        without_transport_scenario = self.adapter.compile_scenario(without_transport, model_family="aircraft_support_v1")

        with tempfile.TemporaryDirectory() as with_tmp, tempfile.TemporaryDirectory() as without_tmp:
            with_metrics = self.adapter.run_scenario(
                with_transport_scenario,
                output_dir=Path(with_tmp),
                run_id="run-aircraft-v1-with-transport",
            )["result"]["metrics"]
            without_metrics = self.adapter.run_scenario(
                without_transport_scenario,
                output_dir=Path(without_tmp),
                run_id="run-aircraft-v1-without-transport",
            )["result"]["metrics"]

        self.assertLess(with_metrics["shortage_events"], without_metrics["shortage_events"])
        self.assertGreater(with_metrics["spare_consumed_total"], without_metrics["spare_consumed_total"])

    def test_monte_carlo_scenario_rejects_sample_count_below_sweep_point_count(self) -> None:
        scenario = self.adapter.compile_scenario(
            self._load_fixture("m9_6_platform_case_export.json")["project"],
            model_family="aircraft_support_v1",
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

if __name__ == "__main__":
    unittest.main()
