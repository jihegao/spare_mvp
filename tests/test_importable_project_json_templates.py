from __future__ import annotations

import json
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

    def test_templates_are_clean_importable_and_runnable(self) -> None:
        for path in TEMPLATE_PATHS:
            with self.subTest(path=path.name):
                project = json.loads(path.read_text(encoding="utf-8"))
                errors = sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))
                self.assertEqual(errors, [])
                self.assertTrue(project["projectInfo"]["isTemplate"])
                self.assertTrue(project["projectInfo"]["is_template"])
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


if __name__ == "__main__":
    unittest.main()
