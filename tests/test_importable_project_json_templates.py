from __future__ import annotations

import json
import base64
import importlib.util
from unittest import mock
from pathlib import Path
import sqlite3
import tempfile
import unittest

import jsonschema

from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATHS = (
    REPO_ROOT / "exports" / "project-case-large.json",
    REPO_ROOT / "exports" / "project-minimum-001.json",
)
CASE_LARGE_SOURCE_PROJECT_ID = "project-j35-8aircraft-43day-availability-20260909"


class ImportableProjectJsonTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_project.schema.json").read_text(encoding="utf-8")
        )
        cls.validator = jsonschema.Draft202012Validator(schema)

    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        initialize_database(self.connection)
        self.tempdir = tempfile.TemporaryDirectory()
        self.adapter = SimulationAdapter(REPO_ROOT)
        self.api = BackendApi(
            ContractRepository(self.connection),
            self.adapter,
            output_dir=Path(self.tempdir.name),
        )

    def tearDown(self) -> None:
        self.connection.close()
        self.tempdir.cleanup()

    def test_fixture_regeneration_is_deterministic_without_runtime_database(self) -> None:
        spec = importlib.util.spec_from_file_location("project_template_generator", REPO_ROOT / "scripts/export-project-json-templates.py")
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        with mock.patch.object(generator, "_load_project", side_effect=AssertionError("default generation must not read a runtime database")):
            first = generator.build_templates()
            self.assertEqual(first, generator.build_templates())
            self.assertEqual(generator.template_drift(), [])
        large = first[REPO_ROOT / "exports/project-case-large.json"]
        self.assertEqual(large["project_id"], "project-case-large")
        self.assertEqual(large["scenarioId"], "scenario-case-large")
        self.assertEqual(large["projectInfo"]["sourceProjectId"], CASE_LARGE_SOURCE_PROJECT_ID)
        self.assertEqual(large["missionProfile"]["durationDays"], 43)
        self.assertEqual(large["combatUnit"]["quantity"], 8)
        self.assertEqual(len(large["combatUnit"]["members"]), 8)
        self.assertEqual({member["model"] for member in large["combatUnit"]["members"]}, {"J35"})
        self.assertEqual({mission["equipmentType"] for mission in large["basicMissions"]}, {"J35"})
        self.assertTrue(any(resource.get("type") == "spare" for resource in large["supportResources"]))

    def test_explicit_case_large_database_uses_fixed_source_project_and_keeps_minimum(self) -> None:
        spec = importlib.util.spec_from_file_location("project_template_generator", REPO_ROOT / "scripts/export-project-json-templates.py")
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        expected_large = json.loads((REPO_ROOT / "exports/project-case-large.json").read_text(encoding="utf-8"))
        source_large = json.loads(json.dumps(expected_large))
        source_large["project_id"] = generator.CASE_LARGE_SOURCE_PROJECT_ID
        source_large["scenarioId"] = generator.CASE_LARGE_SOURCE_SCENARIO_ID
        source_large["projectInfo"].pop("sourceProjectId", None)
        source_large["projectInfo"]["isTemplate"] = False
        source_large["projectInfo"]["is_template"] = False

        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "source.sqlite3"
            connection = sqlite3.connect(database)
            initialize_database(connection)
            api = BackendApi(ContractRepository(connection), self.adapter, output_dir=Path(tmp) / "outputs")
            self.assertEqual(api.save_project(source_large)["status"], "saved")
            connection.close()

            generated = generator.build_templates(case_large_database_path=database)

        self.assertEqual(generated[REPO_ROOT / "exports/project-case-large.json"], expected_large)
        self.assertEqual(
            generated[REPO_ROOT / "exports/project-minimum-001.json"],
            json.loads((REPO_ROOT / "exports/project-minimum-001.json").read_text(encoding="utf-8")),
        )

    def test_default_excel_download_and_upload_keep_explicit_j35_case_plan_bindings(self) -> None:
        download = self.api.project_excel_template()
        self.assertEqual(download["filename"], "Project标准模板-v1.xlsx")
        preview = self.api.preview_project_xlsx({"content_base64": base64.b64encode(download["body"]).decode(), "file_name": download["filename"]})
        self.assertTrue(preview["ok"], preview["errors"])
        self.assertEqual(preview["compile_status"], "compiled")
        gate = self.adapter.compile_scenario_with_gate(preview["project_json"], model_family="aircraft_support_v1")
        inputs = gate["scenario"]["simulation_inputs"]
        expected = {"J35": "j35-service-0103"}
        for composite in inputs["mission_profile"]["composite_tasks"]:
            for item in composite["taskItems"]:
                self.assertEqual(item["operations_plan_group_id"], expected[item["equipmentType"]])
        input_schema = json.loads((REPO_ROOT / "contracts/aircraft_support_v1_input.schema.json").read_text())
        jsonschema.Draft202012Validator(input_schema).validate(inputs)

    def test_templates_are_clean_importable_and_runnable(self) -> None:
        for path in TEMPLATE_PATHS:
            with self.subTest(path=path.name):
                project = json.loads(path.read_text(encoding="utf-8"))
                errors = sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))
                self.assertEqual(errors, [])
                for owner in [*project["products"], *project["components"]]:
                    distribution = owner.get("failureDistribution")
                    distribution_type = str((distribution or {}).get("distributionType") or "").lower()
                    if "exponential" not in distribution_type and "指数" not in distribution_type:
                        continue
                    self.assertEqual(set(distribution), {"distributionType", "rate"})
                    self.assertGreater(distribution["rate"], 0)
                    self.assertNotIn("mtbfHours", owner)
                self.assertTrue(project["projectInfo"]["isTemplate"])
                self.assertTrue(project["projectInfo"]["is_template"])
                serialized = json.dumps(project, ensure_ascii=False)
                for forbidden in ("C:\\Users\\", "备份数据库0923", "spare_mvp.sqlite3"):
                    self.assertNotIn(forbidden, serialized)
                for runtime_key in ("runs", "results", "artifacts", "sessions", "auditEvents"):
                    self.assertNotIn(runtime_key, project)
                self.assertTrue(project["products"])
                self.assertTrue(project["supportActivityJobs"])
                self.assertTrue(all("jobs" not in activity for activity in project["supportActivities"]))
                operations_phases = [
                    activity
                    for activity in project["supportActivities"]
                    if activity.get("planType") in {
                        "直接准备方案",
                        "再次出动准备方案",
                        "飞行后检查方案",
                    }
                ]
                operations_groups = {
                    activity["planGroupId"]
                    for activity in operations_phases
                }
                self.assertTrue(operations_groups)
                for group_id in operations_groups:
                    group = [
                        activity
                        for activity in operations_phases
                        if activity["planGroupId"] == group_id
                    ]
                    self.assertEqual(
                        {activity["planType"] for activity in group},
                        {"直接准备方案", "再次出动准备方案", "飞行后检查方案"},
                    )
                    self.assertEqual(len({id(activity["activityCodes"]) for activity in group}), 3)
                    self.assertEqual(len({id(activity["predecessors"]) for activity in group}), 3)

                canonical_node_ids = {
                    str(node.get("id") or "")
                    for node in project["supportNodes"]
                }
                self.assertTrue(all(
                    "organizationNodeId" not in node
                    for node in project["supportNodes"]
                ))
                self.assertTrue(all(
                    not activity.get("resourceId") or activity["resourceId"] in canonical_node_ids
                    for activity in project["supportActivities"]
                ))

                saved = self.api.save_project(project)
                self.assertEqual(saved["status"], "saved")
                stored = self.api.get_project(project["project_id"])
                compiled = self.adapter.compile_scenario_with_gate(
                    stored,
                    model_family="aircraft_support_v1",
                )
                self.assertEqual(compiled["status"], "compiled")
                self.assertEqual(compiled.get("issues", []), [])
                input_schema = json.loads((REPO_ROOT / "contracts/aircraft_support_v1_input.schema.json").read_text())
                jsonschema.Draft202012Validator(input_schema).validate(compiled["scenario"]["simulation_inputs"])


if __name__ == "__main__":
    unittest.main()
