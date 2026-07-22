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
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from tests.test_aircraft_support_v1_model import (
    _lateral_organization_inputs,
    _vertical_organization_inputs,
)


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

    def test_failure_distribution_rate_accepts_current_editor_fields(self) -> None:
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "指数分布", "rate": 0.04}),
            0.04,
        )
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "正态分布", "mean": 125, "variance": 14}),
            1 / 125,
        )
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "均匀分布", "min": 80, "max": 120}),
            0.01,
        )
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "固定值", "value": 100}),
            0.01,
        )
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "固定值", "mean": 200}),
            0.005,
        )
        self.assertAlmostEqual(
            self.adapter._failure_distribution_rate({"distributionType": "固定值", "value": 100, "mean": 200}),
            0.01,
        )
        for invalid_value in (None, 0, -1):
            with self.subTest(invalid_value=invalid_value):
                self.assertIsNone(
                    self.adapter._failure_distribution_rate({
                        "distributionType": "固定值",
                        "value": invalid_value,
                        "mean": 200,
                    })
                )

    def test_aircraft_support_v1_compile_gate_keeps_explicit_invalid_fixed_value_fail_closed(self) -> None:
        for invalid_value in (None, 0, -1):
            with self.subTest(invalid_value=invalid_value):
                project = self._load_fixture("m9_6_platform_case_export.json")["project"]
                project["components"][1]["failureDistribution"] = {
                    "distributionType": "固定值",
                    "value": invalid_value,
                    "mean": 200,
                }

                result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

                self.assertEqual(result["status"], "blocked")
                self.assertIsNone(result["scenario"])
                self.assertIn(
                    {
                        "code": "invalid_component_failure_distribution",
                        "field_path": "components[1].failureDistribution",
                    },
                    [
                        {"code": issue["code"], "field_path": issue["field_path"]}
                        for issue in result["issues"]
                    ],
                )

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

    def test_downtime_projection_removes_fault_mode_from_details_and_snapshots(self) -> None:
        event = {
            "event_id": "failure-1",
            "event_type": "failure",
            "factor": "failure",
            "time": 30,
            "duration_minutes": 15,
            "failureMode": "must-not-project-alias",
            "details": {"failure_mode": "must-not-project"},
            "snapshot": {
                "aircraft_state": {"failure_mode": "must-not-project-from-state"},
                "active_jobs": [],
            },
        }
        projection = self.adapter._aircraft_support_v1_analysis_projections(
            {},
            "base-artifact",
            samples=[{
                "sample_index": 0,
                "seed": 101,
                "downtime_events": [event],
                "events": [event],
            }],
            run_id="run-hidden-fault-mode",
        )["downtime_factors"]

        serialized = json.dumps(projection, ensure_ascii=False)
        self.assertNotIn("failure_mode", serialized)
        self.assertNotIn("failureMode", serialized)
        self.assertNotIn("must-not-project", serialized)
        self.assertEqual(projection["event_details"][0]["task_phase_label"], "不在任务阶段")
        self.assertEqual(projection["event_details"][0]["start_time_label"], "暂无时间")
        self.assertEqual(projection["anomaly_snapshots"][0]["simulation_time"], 30.0)

    def test_validate_project_accepts_contract_fixture(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")

        result = self.adapter.validate_project(project)

        self.assertTrue(result["ok"])
        self.assertEqual(result["project_id"], "project-aircraft-support-contract-001")
        self.assertEqual(result["project_schema_version"], "project-v0")
        self.assertEqual(result["errors"], [])

    def _project_with_pre_life(self) -> dict:
        project = self._load_fixture("aircraft_support_v1_project.json")
        project["combatUnit"]["members"][0].update({
            "preLifeCalendarDays": 1,
            "preLifeFlightHours": 2.5,
            "preLifeTakeoffLandingCount": 3,
        })
        project["supportActivities"].append({
            "id": "preventive",
            "activityName": "preventive",
            "activityType": "preventive",
            "planType": "预防性维修方案",
            "aircraftModel": "J-15",
            "equipmentId": "whole-aircraft",
            "calendarDayInterval": 2,
            "runHourInterval": 4,
            "takeoffLandingInterval": 6,
            "activityCodes": ["job-1"],
            "predecessors": {"job-1": []},
        })
        return project

    def test_compile_maps_aircraft_pre_life_and_provenance_to_initial_life_state(self) -> None:
        scenario = self.adapter.compile_scenario(self._project_with_pre_life())

        asset = scenario["simulation_inputs"]["aircraft"]["assets"][0]
        self.assertEqual(asset["initial_life_state"], {
            "calendar_days": 1,
            "flight_hours": 2.5,
            "takeoff_landing_cycles": 3,
        })
        self.assertEqual(asset["source_initial_life_state"], asset["initial_life_state"])
        provenance = scenario["compiled_from"]["mapping_provenance"]
        self.assertIn("combatUnit.members[].preLifeFlightHours", provenance["consumed_fields"])
        self.assertIn("simulation_inputs.aircraft.assets[].initial_life_state", provenance["derived_fields"])

    def test_compile_reduces_completed_preventive_intervals_to_zero_remainders(self) -> None:
        project = self._project_with_pre_life()
        project["combatUnit"]["members"][0].update({
            "preLifeCalendarDays": 2,
            "preLifeFlightHours": 4,
            "preLifeTakeoffLandingCount": 6,
        })

        scenario = self.adapter.compile_scenario(project)
        inputs = scenario["simulation_inputs"]
        asset = inputs["aircraft"]["assets"][0]

        self.assertEqual(inputs["aircraft"]["initial_ready"], 1)
        self.assertEqual(asset["source_initial_state"], "available")
        self.assertEqual(asset["initial_state"], "available")
        self.assertEqual(asset["source_initial_life_state"], {
            "calendar_days": 2,
            "flight_hours": 4.0,
            "takeoff_landing_cycles": 6,
        })
        self.assertEqual(asset["initial_life_state"], {
            "calendar_days": 0,
            "flight_hours": 0.0,
            "takeoff_landing_cycles": 0,
        })
        self.assertFalse(asset["initial_preventive_due"])
        self.assertEqual(asset["initial_due_dimensions"], [])
        model = AircraftSupportV1Model(inputs)
        preventive_jobs = [job for job in model.jobs if job.kind == "preventive"]
        self.assertEqual(preventive_jobs, [])

    def test_compile_merges_unique_threshold_dimensions_across_applicable_preventive_plans(self) -> None:
        project = self._project_with_pre_life()
        project["combatUnit"]["members"][0].update({
            "preLifeCalendarDays": 0,
            "preLifeFlightHours": 10.5,
            "preLifeTakeoffLandingCount": 0,
        })
        first = project["supportActivities"][-1]
        first.update({"calendarDayInterval": 0, "runHourInterval": 0, "takeoffLandingInterval": 0})
        second = copy.deepcopy(first)
        second.update({"id": "preventive-flight", "activityName": "preventive flight", "runHourInterval": 8})
        project["supportActivities"].append(second)
        project["supportActivityJobs"][0]["durationMinutes"] = 1

        scenario = self.adapter.compile_scenario(project)
        inputs = scenario["simulation_inputs"]
        asset = inputs["aircraft"]["assets"][0]

        self.assertEqual(asset["preventive_thresholds"]["flight_hours"], 8.0)
        self.assertEqual(
            asset["preventive_threshold_sources"]["flight_hours"],
            [{"activity_id": "preventive-flight", "equipment_id": "whole-aircraft"}],
        )
        self.assertEqual(asset["source_initial_life_state"]["flight_hours"], 10.5)
        self.assertEqual(asset["initial_life_state"]["flight_hours"], 2.5)
        self.assertEqual(asset["initial_due_dimensions"], [])
        model = AircraftSupportV1Model(inputs)
        preventive_jobs = [job for job in model.jobs if job.kind == "preventive"]
        self.assertEqual(preventive_jobs, [])

    def test_compile_blocks_positive_pre_life_without_dimension_threshold_at_exact_field(self) -> None:
        project = self._project_with_pre_life()
        project["supportActivities"][-1]["runHourInterval"] = 0

        result = self.adapter.compile_scenario_with_gate(project)

        self.assertEqual(result["status"], "blocked")
        issue = next(issue for issue in result["issues"] if issue["code"] == "missing_preventive_threshold")
        self.assertEqual(issue["field_path"], "combatUnit.members[0].preLifeFlightHours")

    def test_compile_blocks_conflicting_or_unknown_preventive_threshold_scope(self) -> None:
        project = self._project_with_pre_life()
        conflict = copy.deepcopy(project["supportActivities"][-1])
        conflict["id"] = "preventive-conflict"
        conflict["activityName"] = "preventive conflict"
        conflict["runHourInterval"] = 5
        project["supportActivities"].append(conflict)
        project["combatUnit"]["members"][0].update({
            "preLifeCalendarDays": 0,
            "preLifeFlightHours": 0,
            "preLifeTakeoffLandingCount": 0,
        })

        result = self.adapter.compile_scenario_with_gate(project)
        conflict_issue = next(issue for issue in result["issues"] if issue["code"] == "conflicting_preventive_threshold")
        self.assertEqual(conflict_issue["field_path"], "supportActivities[2].runHourInterval")

        project = self._project_with_pre_life()
        project["supportActivities"][-1]["aircraftModel"] = "UNKNOWN"
        result = self.adapter.compile_scenario_with_gate(project)
        unknown_issue = next(issue for issue in result["issues"] if issue["code"] == "unknown_preventive_aircraft_model")
        self.assertEqual(unknown_issue["field_path"], "supportActivities[1].aircraftModel")

    def test_validate_project_reports_missing_contract_roots(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        del project["components"]

        result = self.adapter.validate_project(project)

        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["path"], "components")
        self.assertEqual(result["errors"][0]["code"], "missing_required")

    def test_validate_project_rejects_duplicate_stable_support_resource_identity_and_dangling_job_key(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))
        product_id = project["products"][0]["id"]
        project["supportOrganization"] = {
            "tree": {
                "id": "support-org-root",
                "name": "保障组织",
                "children": [{"id": "leaf-a", "name": "基层A", "children": []}],
            }
        }
        project["supportResources"].extend([
            {
                "id": "support-spare:leaf-a:product-a",
                "organizationNodeName": "leaf-a",
                "supportNodeName": "基层A",
                "type": "spare",
                "productId": product_id,
                "name": "备件A",
                "quantity": 2,
            },
            {
                "id": "support-spare:leaf-a:product-a:legacy-2",
                "organizationNodeName": "leaf-a",
                "supportNodeName": "基层A",
                "type": "spare",
                "productId": product_id,
                "name": "备件A冲突记录",
                "quantity": 3,
            },
        ])
        project["supportActivityJobs"] = [{
            "activityCode": "USE-001",
            "spare": [{"key": "missing-resource", "productId": product_id, "quantity": 1}],
        }]

        result = self.adapter.validate_project(project)
        codes = {error["code"] for error in result["errors"]}

        self.assertIn("duplicate_support_resource_identity", codes)
        self.assertIn("missing_support_resource_key_reference", codes)

    def test_validate_project_rejects_duplicate_support_resource_ids_and_unknown_explicit_org(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        duplicate = copy.deepcopy(project["supportResources"][0])
        duplicate["type"] = "spare"
        duplicate["productId"] = "product-unknown"
        duplicate["organizationNodeName"] = "missing-org"
        project["supportResources"].append(duplicate)
        project["supportOrganization"] = {
            "tree": {"id": "root", "name": "保障组织", "children": []}
        }

        result = self.adapter.validate_project(project)
        codes = {error["code"] for error in result["errors"]}

        self.assertIn("duplicate_support_resource_id", codes)
        self.assertIn("unknown_support_resource_organization", codes)

    def test_validate_project_rejects_legacy_support_name_duplicate_and_unknown_identity(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))
        product_id = project["products"][0]["id"]
        project["supportOrganization"] = {
            "tree": {
                "id": "root",
                "name": "保障组织",
                "children": [{"id": "leaf-a", "name": "基层A", "children": []}],
            }
        }
        project["supportNodes"] = [{"id": "support-leaf-a", "name": "基层A"}]
        project["supportResources"] = [
            {"id": "legacy-a", "supportNodeName": "基层A", "type": "spare", "productId": product_id, "quantity": 2},
            {"id": "legacy-b", "supportNodeName": "基层A", "type": "spare", "productId": product_id, "quantity": 3},
            {"id": "legacy-unknown", "supportNodeName": "不存在", "type": "spare", "productId": product_id, "quantity": 1},
        ]

        result = self.adapter.validate_project(project)
        codes = {error["code"] for error in result["errors"]}

        self.assertIn("duplicate_support_resource_identity", codes)
        self.assertIn("unknown_support_resource_organization", codes)

    def test_validate_project_rejects_nonzero_spare_on_multi_leaf_ancestor(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))
        product_id = project["products"][0]["id"]
        project["supportOrganization"] = {
            "tree": {
                "id": "root",
                "name": "保障组织",
                "children": [{
                    "id": "relay",
                    "name": "中继",
                    "children": [
                        {"id": "leaf-a", "name": "基层A", "children": []},
                        {"id": "leaf-b", "name": "基层B", "children": []},
                    ],
                }],
            }
        }
        project["supportResources"] = [{
            "id": "legacy-relay-stock",
            "organizationNodeName": "relay",
            "supportNodeName": "中继",
            "type": "spare",
            "productId": product_id,
            "quantity": 4,
        }]

        result = self.adapter.validate_project(project)

        self.assertIn("ambiguous_support_resource_migration", {error["code"] for error in result["errors"]})

    def test_validate_project_rejects_deleted_stable_key_instead_of_cross_org_rebinding(self) -> None:
        project = self._with_product_catalog(self._load_fixture("aircraft_support_v1_project.json"))
        product_id = project["products"][0]["id"]
        deleted_key = f"support-spare:leaf-a:{product_id}"
        project["supportOrganization"] = {
            "tree": {
                "id": "root",
                "name": "保障组织",
                "children": [
                    {"id": "leaf-a", "name": "基层A", "children": []},
                    {"id": "leaf-b", "name": "基层B", "children": []},
                ],
            }
        }
        project["supportResources"] = [
            {
                "id": f"support-spare-tombstone:leaf-a:{product_id}",
                "organizationNodeName": "leaf-a",
                "supportNodeName": "基层A",
                "type": "spare",
                "productId": product_id,
                "quantity": 0,
            },
            {
                "id": f"support-spare:leaf-b:{product_id}",
                "organizationNodeName": "leaf-b",
                "supportNodeName": "基层B",
                "type": "spare",
                "productId": product_id,
                "quantity": 8,
            },
        ]
        project["supportActivityJobs"] = [{
            "activityCode": "USE-001",
            "spare": [{"key": deleted_key, "productId": product_id, "quantity": 1}],
        }]

        result = self.adapter.validate_project(project)

        missing = [error for error in result["errors"] if error["code"] == "missing_support_resource_key_reference"]
        self.assertEqual(len(missing), 1)
        self.assertIn(deleted_key, missing[0]["message"])

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
        legacy_spare_products = {}
        for resource in current_project["supportResources"]:
            if resource.get("type") != "spare":
                continue
            spare_name = str(resource.get("model") or resource.get("name") or resource["id"])
            product_id = legacy_spare_products.setdefault(spare_name, f"product-legacy-spare-{len(legacy_spare_products) + 1}")
            resource["productId"] = product_id
        current_project["products"].extend(
            {"id": product_id, "name": spare_name, "model": spare_name}
            for spare_name, product_id in legacy_spare_products.items()
        )
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
            historical = copy.deepcopy(scenario)
            historical.pop("organization_observability_version")
            historical["compiled_from"]["mapping_provenance"].pop("organization_graph_identity")
            historical["compiled_from"]["mapping_provenance"].pop("migration_notices")
            jsonschema.validate(instance=historical, schema=scenario_schema)
            marked_missing_identity = copy.deepcopy(scenario)
            marked_missing_identity["compiled_from"]["mapping_provenance"].pop("organization_graph_identity")
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate(instance=marked_missing_identity, schema=scenario_schema)
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
        self.assertIn("supportOrganization.tree[].id", provenance["consumed_fields"])
        self.assertIn(
            "simulation_inputs.support_network.organization_graph.lateral_edges",
            provenance["runtime_deferred_fields"],
        )
        self.assertNotIn(
            "simulation_inputs.support_network.organization_graph",
            provenance["runtime_deferred_fields"],
        )
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
                "resourceId": "基地",
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

    def test_aircraft_support_v1_compiles_maintenance_policy_scope_and_provenance(self) -> None:
        for replacement_ratio in (0.3, 0.7):
            project = self._load_fixture("aircraft_support_v1_project.json")
            activity = project["supportActivities"][0]
            activity["aircraftModel"] = "J-15"
            activity["maintenanceMethods"] = ["non_replacement", "replacement"]
            activity["replacementRatio"] = replacement_ratio

            scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

            compiled = scenario["simulation_inputs"]["support_activities"]["activities"][0]
            self.assertEqual(compiled["replacement_ratio"], replacement_ratio)
            input_schema = json.loads(
                (REPO_ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8")
            )
            jsonschema.validate(instance=scenario["simulation_inputs"], schema=input_schema)

        compiled = scenario["simulation_inputs"]["support_activities"]["activities"][0]
        self.assertEqual(compiled["aircraft_model"], "J-15")
        self.assertEqual(compiled["equipment_id"], "")
        self.assertEqual(compiled["maintenance_methods"], ["non_replacement", "replacement"])
        self.assertEqual(compiled["replacement_ratio"], 0.7)
        self.assertNotIn("maintenanceMethods", compiled)
        self.assertNotIn("replacementRatio", compiled)
        consumed = scenario["compiled_from"]["mapping_provenance"]["consumed_fields"]
        self.assertIn("supportActivities[].aircraftModel", consumed)
        self.assertIn("supportActivities[].equipmentId", consumed)
        self.assertIn("supportActivities[].maintenanceMethods", consumed)
        self.assertIn("supportActivities[].replacementRatio", consumed)
        derived = scenario["compiled_from"]["mapping_provenance"]["derived_fields"]
        self.assertIn("simulation_inputs.support_activities.activities[].aircraft_model", derived)
        self.assertIn("simulation_inputs.support_activities.activities[].equipment_id", derived)
        self.assertIn("simulation_inputs.support_activities.activities[].maintenance_methods", derived)
        self.assertIn("simulation_inputs.support_activities.activities[].replacement_ratio", derived)
        invalid_inputs = copy.deepcopy(scenario["simulation_inputs"])
        invalid_inputs["support_activities"]["activities"][0]["maintenance_methods"] = ["replacement"]
        invalid_inputs["support_activities"]["activities"][0]["replacement_ratio"] = 0.7
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(instance=invalid_inputs, schema=input_schema)

    def test_aircraft_support_v1_plan_type_only_compiles_to_canonical_activity_type(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        project["supportActivities"][0].pop("activityType", None)

        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

        compiled = scenario["simulation_inputs"]["support_activities"]["activities"][0]
        self.assertEqual(compiled["activity_type"], "corrective")
        input_schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8")
        )
        jsonschema.validate(instance=scenario["simulation_inputs"], schema=input_schema)

    def test_aircraft_support_v1_direct_compile_normalizes_only_valid_maintenance_history(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        activity = project["supportActivities"][0]

        historical = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        compiled = historical["simulation_inputs"]["support_activities"]["activities"][0]
        self.assertEqual(compiled["maintenance_methods"], ["non_replacement"])
        self.assertEqual(compiled["replacement_ratio"], 0)
        defaults = historical["compiled_from"]["mapping_provenance"]["defaults_applied"]
        self.assertIn("supportActivities.0.maintenanceMethods=historicalDefault", defaults)
        self.assertIn("supportActivities.0.replacementRatio=historicalDefault", defaults)

        legacy = copy.deepcopy(project)
        legacy["supportActivities"][0]["repairType"] = "换件维修"
        migrated = self.adapter.compile_scenario(legacy, model_family="aircraft_support_v1")
        compiled = migrated["simulation_inputs"]["support_activities"]["activities"][0]
        self.assertEqual(compiled["maintenance_methods"], ["replacement"])
        self.assertEqual(compiled["replacement_ratio"], 1)
        defaults = migrated["compiled_from"]["mapping_provenance"]["defaults_applied"]
        self.assertIn("supportActivities.0.maintenanceMethods=legacyRepairType:换件维修", defaults)
        self.assertIn("supportActivities.0.replacementRatio=legacyRepairType:换件维修", defaults)

    def test_aircraft_support_v1_direct_compile_rejects_invalid_maintenance_plans_with_path(self) -> None:
        base = self._load_fixture("aircraft_support_v1_project.json")
        invalid_cases = (
            ({"maintenanceMethods": ["replacement"], "replacementRatio": 0.5}, "replacementRatio"),
            ({"maintenanceMethods": ["non_replacement", "replacement"], "replacementRatio": 0.12345}, "replacementRatio"),
            ({"maintenanceMethods": ["replacement", "replacement"], "replacementRatio": 1}, "maintenanceMethods"),
            ({"maintenanceMethods": ["unknown"], "replacementRatio": 0}, "maintenanceMethods"),
        )
        for patch, expected_path in invalid_cases:
            with self.subTest(patch=patch):
                project = copy.deepcopy(base)
                project["supportActivities"][0].update(patch)
                result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["issues"][0]["code"], "invalid_maintenance_plan")
                self.assertIn(expected_path, result["issues"][0]["field_path"])
                with self.assertRaises(AdapterError):
                    self.adapter.compile_scenario(project, model_family="aircraft_support_v1")

    def test_aircraft_support_v1_does_not_classify_maintenance_by_generic_name(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        activity = project["supportActivities"][0]
        activity.update({
            "activityType": "使用保障",
            "planType": "使用保障方案",
            "activityName": "repair-looking-name",
            "maintenanceMethods": ["non_replacement"],
            "replacementRatio": 0,
        })
        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["issues"][0]["code"], "invalid_maintenance_plan")

        activity.pop("maintenanceMethods", None)
        activity.pop("replacementRatio", None)
        compiled = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        runtime_activity = compiled["simulation_inputs"]["support_activities"]["activities"][0]
        self.assertNotIn("maintenance_methods", runtime_activity)
        self.assertNotIn("replacement_ratio", runtime_activity)

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
            {
                "id": "periodic-1", "name": "weekly", "repeatCycleValue": 2,
                "repeatCycleUnit": "week", "repeatCount": 2,
                "compositeTaskIds": ["composite-day-cap"],
            }
        ]

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(result["scenario"]["simulation_inputs"]["time"]["duration_minutes"], 28 * 24 * 60)
        self.assertEqual(
            result["scenario"]["simulation_inputs"]["mission_profile"]["periodic_source"],
            {"level": "week", "label": "周剖面", "configured_slots": 1},
        )

    def test_aircraft_support_v1_compiles_three_day_week_profile_without_higher_profiles(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["periodicTasks"] = [{
            "id": "week-three-day", "name": "three day", "cycleDays": 7, "repeatWeeks": 1,
            "compositeTaskIds": ["composite-day-cap"],
            "compositeTasks": [
                {"weekIndex": 1, "weekday": day, "compositeTaskId": "composite-day-cap"}
                for day in ("mondayCompositeTaskId", "tuesdayCompositeTaskId", "wednesdayCompositeTaskId")
            ],
        }]
        project["missionProfile"]["periodicProfileLists"] = {
            "week": [{"id": "week-three-day", "name": "three day"}],
            "month": [{"id": "month-empty", "name": "empty", "weekProfileIds": ["", "", "", ""]}],
            "year": [{"id": "year-empty", "name": "empty", "monthProfileIds": [""] * 12}],
        }

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "compiled")
        inputs = result["scenario"]["simulation_inputs"]
        self.assertEqual(inputs["mission_profile"]["periodic_source"]["level"], "week")
        self.assertEqual(inputs["time"]["duration_minutes"], 3 * 24 * 60)
        model = AircraftSupportV1Model(inputs)
        self.assertEqual(sorted({mission.day_index for mission in model.missions}), [1, 2, 3])

    def test_aircraft_support_v1_compiles_month_profile_without_year_configuration(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["periodicProfileLists"] = {
            "week": [{"id": "periodic-carrier-day-night", "name": "week"}],
            "month": [{"id": "month-one", "name": "month", "weekProfileIds": ["periodic-carrier-day-night", "", "", ""]}],
            "year": [{"id": "year-empty", "name": "empty", "monthProfileIds": [""] * 12}],
        }

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "compiled")
        inputs = result["scenario"]["simulation_inputs"]
        self.assertEqual(inputs["mission_profile"]["periodic_source"]["level"], "month")
        self.assertEqual(inputs["mission_profile"]["periodic_source"]["configured_slots"], 1)
        self.assertTrue(all("__month_1" in item["id"] for item in inputs["mission_profile"]["composite_tasks"]))
        self.assertGreater(len(AircraftSupportV1Model(inputs).missions), 0)

    def test_aircraft_support_v1_periodic_profile_references_fail_closed(self) -> None:
        cases = (
            ("missing-basic", "missing_periodic_basic_mission_reference"),
            ("missing-composite", "missing_periodic_composite_reference"),
            ("missing-week", "missing_periodic_week_profile_reference"),
            ("missing-month", "missing_periodic_month_profile_reference"),
            ("empty-schedule", "empty_periodic_task_schedule"),
        )
        for missing_reference, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                project = self._load_fixture("m9_6_platform_case_export.json")["project"]
                project["missionProfile"]["periodicProfileLists"] = {
                    "week": [{"id": "periodic-carrier-day-night", "name": "week"}],
                    "month": [{"id": "month-one", "name": "month", "weekProfileIds": ["", "", "", ""]}],
                    "year": [{"id": "year-one", "name": "year", "monthProfileIds": [""] * 12}],
                }
                if expected_code == "missing_periodic_basic_mission_reference":
                    project["missionProfile"]["compositeTasks"][0]["taskItems"][0]["basicMissionId"] = missing_reference
                elif expected_code == "missing_periodic_composite_reference":
                    project["missionProfile"]["periodicTasks"][0]["compositeTasks"][0]["compositeTaskId"] = missing_reference
                elif expected_code == "missing_periodic_week_profile_reference":
                    project["missionProfile"]["periodicProfileLists"]["month"][0]["weekProfileIds"][0] = missing_reference
                elif expected_code == "missing_periodic_month_profile_reference":
                    project["missionProfile"]["periodicProfileLists"]["year"][0]["monthProfileIds"][0] = missing_reference
                else:
                    project["missionProfile"]["periodicTasks"][0]["compositeTaskIds"] = []
                    project["missionProfile"]["periodicTasks"][0]["compositeTasks"] = []

                result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

                self.assertEqual(result["status"], "blocked")
                self.assertIn(expected_code, {issue["code"] for issue in result["issues"]})

    def test_aircraft_support_v1_periodic_profile_slot_shapes_fail_closed(self) -> None:
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        project["missionProfile"]["periodicProfileLists"] = {
            "month": [{"id": "month-invalid", "weekProfileIds": 3}],
            "year": [{"id": "year-invalid", "monthProfileIds": ["month-invalid", 7]}],
        }

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        issue_codes = {issue["code"] for issue in result["issues"]}
        self.assertIn("invalid_periodic_week_profile_slots", issue_codes)
        self.assertIn("invalid_periodic_month_profile_slot", issue_codes)

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
        historical_result = copy.deepcopy(result)
        historical_result.pop("organization_observability_version")
        historical_result.pop("organization_graph_identity")
        historical_result.pop("organization_dispatch_summary")
        jsonschema.validate(instance=historical_result, schema=result_schema)
        marked_result_without_summary = copy.deepcopy(result)
        marked_result_without_summary.pop("organization_dispatch_summary")
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(instance=marked_result_without_summary, schema=result_schema)
        historical_state = copy.deepcopy(state_payload)
        historical_state.pop("organization_observability_version")
        historical_state.pop("organization_graph_identity")
        historical_state.pop("organization_dispatch_summary")
        for frame in historical_state["frames"]:
            frame.pop("organization_graph_identity")
            frame.pop("organization_dispatch_summary")
        jsonschema.validate(instance=historical_state, schema=state_series_schema)
        marked_state_without_identity = copy.deepcopy(state_payload)
        marked_state_without_identity.pop("organization_graph_identity")
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(instance=marked_state_without_identity, schema=state_series_schema)
        missing_compact_status_payload = copy.deepcopy(state_payload)
        del missing_compact_status_payload["frames"][0]["missions"][0]["status"]
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(instance=missing_compact_status_payload, schema=state_series_schema)
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["model_family"], "aircraft_support_v1")
        self.assertEqual(result["lifecycle_trace"][0]["initial_life_state"]["takeoff_landing_cycles"], 0)
        j35_trace = next(item for item in result["lifecycle_trace"] if item["tail_number"] == "J35-201")
        self.assertEqual(j35_trace["initial_life_state"]["takeoff_landing_cycles"], 0)
        self.assertEqual(j35_trace["initial_due_dimensions"], [])
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
        self.assertIn(
            "support_network.nodes[].organization_node_id",
            scope["behavior_driving_fields"],
        )
        self.assertIn(
            "support_network.organization_graph.parent_edges[]",
            scope["behavior_driving_fields"],
        )
        self.assertIn(
            "support_network.organization_graph.lateral_edges[]",
            scope["behavior_driving_fields"],
        )
        self.assertIn(
            "support_network.organization_graph.transport_policies[]",
            scope["behavior_driving_fields"],
        )
        self.assertIn("supportActivityJobs[]", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].aircraftModel", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].equipmentId", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].activityCodes", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].predecessors", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].maintenanceMethods", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].replacementRatio", scope["behavior_driving_fields"])
        self.assertNotIn("experiment.steps", scope["behavior_driving_fields"])
        self.assertEqual(
            set(scope["fail_closed_fields"]),
            {
                "combatUnit.members[].preLifeCalendarDays",
                "combatUnit.members[].preLifeFlightHours",
                "combatUnit.members[].preLifeTakeoffLandingCount",
                "supportActivities[].aircraftModel",
                "supportActivities[].equipmentId",
                "supportActivities[].calendarDayInterval",
                "supportActivities[].runHourInterval",
                "supportActivities[].takeoffLandingInterval",
                "support_network.nodes[].organization_node_id",
                "support_network.organization_graph.nodes[]",
                "support_network.organization_graph.runtime_mode",
                "support_network.organization_graph.parent_edges[]",
                "support_network.organization_graph.lateral_edges[]",
                "support_network.organization_graph.transport_policies[]",
            },
        )
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
            {"id": "support-node-1", "name": "基地", "organizationNodeId": "support-node-1"},
            {"id": "support-node-2", "name": "基层", "organizationNodeId": "support-node-2"},
        ]
        project["supportOrganization"] = {
            "tree": {
                "id": "support-root",
                "name": "保障组织",
                "children": [
                    {"id": "support-node-1", "name": "基地", "children": []},
                    {"id": "support-node-2", "name": "基层", "children": []},
                ],
            },
            "relations": [],
        }
        project["supportResources"] = [
            {"id": "personnel-1", "supportNodeName": "基地", "organizationNodeId": "support-node-1", "type": "personnel", "name": "航电人员", "quantity": 5},
            {"id": "equipment-1", "supportNodeName": "基地", "organizationNodeId": "support-node-1", "type": "equipment", "name": "电源车", "quantity": 3},
            {"id": "spare-1", "supportNodeName": "基地", "organizationNodeId": "support-node-1", "type": "spare", "name": "航电模块", "productId": "product-j15-avionics", "quantity": 6},
            {"id": "personnel-2", "supportNodeName": "基层", "organizationNodeId": "support-node-2", "type": "personnel", "name": "库房人员", "quantity": 2},
            {"id": "equipment-2", "supportNodeName": "基层", "organizationNodeId": "support-node-2", "type": "equipment", "name": "转运车", "quantity": 1},
            {"id": "spare-2", "supportNodeName": "基层", "organizationNodeId": "support-node-2", "type": "spare", "name": "航电模块", "productId": "product-j15-avionics", "quantity": 9},
        ]
        project["transportPolicies"] = [{
            "id": "transport-1",
            "fromOrganizationNodeId": "support-node-2",
            "toOrganizationNodeId": "support-node-1",
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

    def test_aircraft_support_v1_compiles_vertical_organization_runtime_and_defers_only_lateral_edges(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        provenance = scenario["compiled_from"]["mapping_provenance"]

        with tempfile.TemporaryDirectory() as tmp:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=Path(tmp),
                run_id="run-aircraft-v1-organization-deferred",
            )

        self.assertEqual(provenance["unsupported_fields"], [])
        self.assertIn("supportOrganization.tree[].id", provenance["consumed_fields"])
        runtime_nodes = scenario["simulation_inputs"]["support_network"]["nodes"]
        self.assertTrue(runtime_nodes)
        self.assertTrue(all(node["organization_node_id"] for node in runtime_nodes))
        self.assertIn(
            "simulation_inputs.support_network.organization_graph.lateral_edges",
            provenance["runtime_deferred_fields"],
        )
        self.assertNotIn(
            "simulation_inputs.support_network.organization_graph",
            provenance["runtime_deferred_fields"],
        )
        self.assertEqual(bundle["run"]["status"], "succeeded")

    def test_canonical_blank_activity_resource_defaults_only_to_unique_mapped_root(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        self.assertNotIn("resourceId", project["supportActivities"][0])

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(
            result["scenario"]["simulation_inputs"]["support_activities"]["activities"][0]["resource_id"],
            "node A",
        )
        self.assertIn(
            "supportActivities[0].resourceId=node A (unique organization root mapping)",
            result["provenance"]["defaults_applied"],
        )

    def test_canonical_blank_activity_resource_blocks_when_root_has_no_runtime_mapping(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        project["supportOrganization"]["tree"] = {
            "id": "organization-root",
            "name": "Organization Root",
            "children": [copy.deepcopy(project["supportOrganization"]["tree"])],
        }

        result = self.adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(
            [issue["code"] for issue in result["issues"]],
            ["missing_canonical_activity_resource_reference"],
        )
        self.assertNotIn("support-node", json.dumps(result["provenance"]["defaults_applied"]))

    def test_canonical_missing_capacities_compile_to_zero_but_legacy_retains_one(self) -> None:
        canonical = self._load_fixture("aircraft_support_v1_project.json")
        canonical["supportNodes"][0].pop("personnelCapacity")
        canonical["supportNodes"][0].pop("equipmentCapacity")
        canonical["supportResources"] = []
        canonical_scenario = self.adapter.compile_scenario(
            canonical,
            model_family="aircraft_support_v1",
        )

        legacy = copy.deepcopy(canonical)
        legacy["supportOrganization"] = {}
        legacy["supportNodes"][0].pop("organizationNodeId")
        legacy_scenario = self.adapter.compile_scenario(
            legacy,
            model_family="aircraft_support_v1",
        )

        canonical_node = canonical_scenario["simulation_inputs"]["support_network"]["nodes"][0]
        legacy_node = legacy_scenario["simulation_inputs"]["support_network"]["nodes"][0]
        self.assertEqual((canonical_node["personnel_capacity"], canonical_node["equipment_capacity"]), (0, 0))
        self.assertEqual((legacy_node["personnel_capacity"], legacy_node["equipment_capacity"]), (1, 1))

    def test_vertical_dispatch_events_and_metrics_are_equivalent_for_single_and_monte_carlo_sample(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        inputs["schema_version"] = "aircraft-support-v1-input-v0"
        for node in inputs["support_network"]["nodes"]:
            node["personnel_capacity"] = 2
            node["equipment_capacity"] = 2
        inputs["support_network"]["organization_graph"]["transport_policies"][0]["capacity"] = 1
        inputs["support_network"]["organization_graph"]["transport_policies"][0]["transport_time_hours"] = 0
        preflight = inputs["support_activities"]["activities"][0]
        preflight["resource_id"] = "deck"
        preflight["jobs"] = [{
            "activityCode": "prepare",
            "durationMinutes": 1,
            "spare": [{"product_id": "shared-spare", "quantity": 1}],
        }]
        inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
        scenario["simulation_inputs"] = inputs
        monte_carlo_config = {
            "sample_count": 1,
            "parallel_cores": 1,
            "sweep": {
                "failureRates": [1.0],
                "spareMultipliers": [1.0],
                "supportCapacities": [2],
            },
        }

        with tempfile.TemporaryDirectory() as single_tmp, tempfile.TemporaryDirectory() as mc_tmp:
            single = self.adapter.run_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(single_tmp),
                run_id="run-vertical-single",
            )
            monte_carlo = self.adapter.run_monte_carlo_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(mc_tmp),
                run_id="run-vertical-mc",
                monte_carlo_config=monte_carlo_config,
            )
            single_log_artifact = next(
                artifact for artifact in single["artifact_manifest"]["artifacts"] if artifact["kind"] == "log"
            )
            single_log = json.loads(
                (Path(single_tmp) / single_log_artifact["path"]).read_text(encoding="utf-8")
            )
            mc_base_artifact = next(
                artifact
                for artifact in monte_carlo["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "monte_carlo_base"
            )
            mc_base = json.loads((Path(mc_tmp) / mc_base_artifact["path"]).read_text(encoding="utf-8"))

        self.assertEqual(single["result"]["metrics"], mc_base["samples"][0]["metrics"])
        single_dispatch = next(
            event for event in single_log["events"] if event["event"] == "organization_transport_dispatched"
        )
        mc_dispatch = next(
            event
            for event in mc_base["samples"][0]["events"]
            if event["event"] == "organization_transport_dispatched"
        )
        required_detail_fields = {
            "relation_id",
            "fact_type",
            "runtime_mode",
            "organization_graph_hash",
            "source_mode",
            "source_organization_node_id",
            "destination_organization_node_id",
            "destination_resource_id",
            "reason",
            "requested_minute",
            "wait_minutes",
            "requirement_type",
            "requirement_id",
            "context",
        }
        self.assertEqual(set(single_dispatch["details"]), required_detail_fields)
        self.assertEqual(set(single_dispatch["details"]["context"]), {
            "job_id", "task_index", "product_id", "quantity", "source_resource_id", "resource_id",
            "organization_path", "transport_policy_ids", "batch_sequence", "arrival_minute", "supply_mode",
        })
        self.assertEqual(single_dispatch["details"], mc_dispatch["details"])

    def test_lateral_dispatch_events_and_metrics_are_equivalent_for_single_and_monte_carlo_sample(self) -> None:
        project = self._load_fixture("aircraft_support_v1_project.json")
        scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        inputs["schema_version"] = "aircraft-support-v1-input-v0"
        for node in inputs["support_network"]["nodes"]:
            node["personnel_capacity"] = 2
            node["equipment_capacity"] = 2
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"][-1]["capacity"] = 1
        graph["transport_policies"][-1]["transport_time_hours"] = 0
        preflight = inputs["support_activities"]["activities"][0]
        preflight["resource_id"] = "deck"
        preflight["jobs"] = [{
            "activityCode": "prepare",
            "durationMinutes": 1,
            "spare": [{"product_id": "shared-spare", "quantity": 1}],
        }]
        inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
        scenario["simulation_inputs"] = inputs
        monte_carlo_config = {
            "sample_count": 1,
            "parallel_cores": 1,
            "sweep": {
                "failureRates": [1.0],
                "spareMultipliers": [1.0],
                "supportCapacities": [2],
            },
        }

        with tempfile.TemporaryDirectory() as single_tmp, tempfile.TemporaryDirectory() as mc_tmp:
            single = self.adapter.run_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(single_tmp),
                run_id="run-lateral-single",
            )
            monte_carlo = self.adapter.run_monte_carlo_scenario(
                copy.deepcopy(scenario),
                output_dir=Path(mc_tmp),
                run_id="run-lateral-mc",
                monte_carlo_config=monte_carlo_config,
            )
            single_log_artifact = next(
                artifact for artifact in single["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "log"
            )
            single_log = json.loads(
                (Path(single_tmp) / single_log_artifact["path"]).read_text(encoding="utf-8")
            )
            mc_base_artifact = next(
                artifact for artifact in monte_carlo["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "monte_carlo_base"
            )
            mc_base = json.loads((Path(mc_tmp) / mc_base_artifact["path"]).read_text(encoding="utf-8"))

        self.assertEqual(single["result"]["metrics"], mc_base["samples"][0]["metrics"])
        single_dispatch = next(
            event for event in single_log["events"]
            if event["event"] == "organization_transport_dispatched"
        )
        mc_dispatch = next(
            event for event in mc_base["samples"][0]["events"]
            if event["event"] == "organization_transport_dispatched"
        )
        self.assertEqual(single_dispatch["details"], mc_dispatch["details"])
        self.assertEqual(single_dispatch["details"]["source_mode"], "lateral")
        self.assertEqual(single_dispatch["details"]["relation_id"], "lateral-to-leaf")

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
        self.assertEqual(base_payload["initial_life_state"][0]["initial_life_state"]["takeoff_landing_cycles"], 0)
        self.assertTrue(base_payload["samples"][0]["lifecycle_trace"])
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
        sample_wave_keys = [(row["sample_index"], row["day_index"], row["wave_index"]) for row in mission_series]
        self.assertEqual(sample_wave_keys, sorted(sample_wave_keys))
        self.assertEqual(wave_keys[0], (1, 1))
        self.assertEqual({row["sample_index"] for row in mission_series}, {0, 1, 2, 3})
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

    def test_aircraft_support_v1_mission_reliability_series_preserves_every_sample_wave(self) -> None:
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

        self.assertEqual([row["wave_key"] for row in rows], ["d1-w1", "d1-w2", "d1-w1"])
        self.assertEqual([row["sample_index"] for row in rows], [0, 0, 1])
        self.assertEqual([row["sample_label"] for row in rows], ["样本 1", "样本 1", "样本 2"])
        self.assertAlmostEqual(rows[0]["planned_sorties"], 2)
        self.assertAlmostEqual(rows[0]["successful_sorties"], 1)
        self.assertAlmostEqual(rows[0]["planned_waves"], 1)
        self.assertAlmostEqual(rows[0]["successful_waves"], 1)
        self.assertAlmostEqual(rows[0]["mean_mission_success_rate"], 1)
        self.assertAlmostEqual(rows[0]["sortie_rate"], 1)
        self.assertEqual(rows[1]["mean_mission_success_rate"], 0)
        self.assertEqual(rows[2]["mean_mission_success_rate"], 0)
        self.assertTrue(all(0 <= row["mission_success_probability"] <= 1 for row in rows))

        self.assertEqual(
            self.adapter._aircraft_support_v1_mission_reliability_series(
                metrics={"mission_success_rate": 0.8, "sortie_rate": 0.9},
                samples=[],
            ),
            [],
        )

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

    def test_aircraft_support_v1_monte_carlo_keeps_finite_extremes_json_safe(self) -> None:
        class ExtremeFiniteSampleAdapter(SimulationAdapter):
            def _run_aircraft_support_v1_monte_carlo_sample(self, *args, sample_index: int, **kwargs):
                sample = super()._run_aircraft_support_v1_monte_carlo_sample(
                    *args,
                    sample_index=sample_index,
                    **kwargs,
                )
                sample["metrics"]["repair_backlog"] = 1e308 if sample_index == 0 else -1e308
                return sample

        adapter = ExtremeFiniteSampleAdapter(REPO_ROOT)
        project = self._load_fixture("m9_6_platform_case_export.json")["project"]
        scenario = adapter.compile_scenario(project, model_family="aircraft_support_v1")
        with tempfile.TemporaryDirectory() as tmp:
            bundle = adapter.run_monte_carlo_scenario(
                scenario,
                output_dir=Path(tmp),
                run_id="run-aircraft-v1-mc-finite-extremes",
                monte_carlo_config={
                    "sample_count": 2,
                    "parallel_cores": 1,
                    "sweep": {
                        "failureRates": [0.01],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [1],
                    },
                    "mc_experiment_id": "mc-aircraft-v1-finite-extremes",
                },
            )
            base_artifact = next(
                artifact for artifact in bundle["artifact_manifest"]["artifacts"]
                if artifact["kind"] == "monte_carlo_base"
            )
            base_payload = json.loads((Path(tmp) / base_artifact["path"]).read_text(encoding="utf-8"))

        repair_backlog = next(
            metric for metric in base_payload["metric_moments"]["metrics"]
            if metric["metric_id"] == "repair_backlog"
        )
        self.assertEqual(bundle["run"]["status"], "succeeded")
        self.assertEqual(base_payload["aggregate_metrics"]["repair_backlog"], 0)
        self.assertEqual(repair_backlog["mean"], 0)
        self.assertIsNone(repair_backlog["sample_variance"])
        self.assertEqual(repair_backlog["valid_sample_count"], 2)
        self.assertEqual(repair_backlog["invalid_reason"], "sample_variance_not_finite")

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
            activity_type = f"{activity.get('activityType', '')} {activity.get('planType', '')}"
            if "修复" in activity_type:
                activity["equipmentId"] = target_lru["id"]
                activity["maintenanceMethods"] = ["replacement"]
                activity["replacementRatio"] = 1
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
