from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest

import jsonschema

from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class ProjectJsonExporterTest(unittest.TestCase):
    def setUp(self) -> None:
        schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_project.schema.json").read_text(encoding="utf-8")
        )
        self.validator = jsonschema.Draft202012Validator(schema)

    def _schema_errors(self, project: dict) -> list[jsonschema.ValidationError]:
        return sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))

    def _polluted_project(self) -> dict:
        return {
            "schema_version": "project-v0",
            "project_id": "project-polluted-aircraft-support-v1",
            "project_version": "project-v0.1",
            "scenarioId": "scenario-polluted-aircraft-support-v1",
            "activeModule": "sparePlanning",
            "uiState": {"selected": "debug"},
            "analysisRequests": {"largeSample": {"sweep": [1, 2]}},
            "seedPolicy": {"mode": "fixed"},
            "scenarioComposition": {"overrides": []},
            "resultSummary": {"mission_success_rate": 1},
            "rmsAllocationPlan": {"method": "equal"},
            "airports": [{"id": "airport-a", "name": "Airport A", "uiState": {"expanded": True}}],
            "missionAreas": [{"id": "area-a", "name": "Area A", "canvasLayout": {"x": 1}}],
            "missionProfile": {
                "name": "clean mission",
                "durationHours": 1,
                "profileType": "legacy-ui",
                "analysisRequests": {"largeSample": {"samples": 10}},
                "compositeTasks": [],
                "periodicTasks": [],
            },
            "basicMissions": [
                {
                    "id": "basic-small",
                    "name": "small sortie",
                    "missionId": "basic-small",
                    "taskDurationMinutes": 30,
                    "equipmentType": "J-15",
                    "draftState": {"dirty": True},
                }
            ],
            "missionPhases": [],
            "combatUnit": {
                "members": [
                    {
                        "aircraftNo": "J15-001",
                        "model": "J-15",
                        "status": "ready",
                        "airport": "Airport A",
                    }
                ]
            },
            "components": [
                {
                    "id": "whole-aircraft",
                    "name": "whole aircraft",
                    "aircraftModel": "J-15",
                    "productType": "whole",
                    "quantity": 1,
                    "failureRate": 0.01,
                    "failureDistribution": {"distributionType": "exponential"},
                    "kOutOfN": {"k": 1, "n": 1},
                    "rms": {
                        "target": {"reliability": 0.98},
                        "prediction": {"mtbfHours": 100},
                        "actual": {"mtbfHours": 90},
                    },
                    "formState": {"open": True},
                }
            ],
            "supportOrganization": {
                "tree": {
                    "id": "org-root",
                    "name": "保障组织",
                    "children": [{"id": "node-a", "name": "node A"}],
                }
            },
            "supportNodes": [
                {
                    "id": "node-a",
                    "name": "node A",
                    "personnelCapacity": 1,
                    "equipmentCapacity": 1,
                    "inventory": {"aircraft_support_v1_spares": 2},
                    "transportPolicies": [
                        {
                            "from": "node-a",
                            "to": "node-a",
                            "spareType": "aircraft_support_v1_spares",
                            "capacity": 1,
                        }
                    ],
                }
            ],
            "supportActivities": [
                {
                    "id": "corrective",
                    "activityType": "corrective",
                    "durationHours": 1,
                    "requiredDevices": 1,
                    "requireDevices": 999,
                    "jobs": [
                        {
                            "id": "job-1",
                            "predecessors": [],
                            "selectedNodeId": "debug-node",
                        }
                    ],
                }
            ],
            "reliabilityBlockDiagram": {
                "nodes": [{"id": "whole-aircraft", "type": "system", "treeLayout": {"x": 1}}],
                "edges": [],
            },
        }

    def test_aircraft_support_v1_exporter_produces_schema_valid_clean_project(self) -> None:
        project = self._polluted_project()
        original = deepcopy(project)

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        self.assertEqual(project, original)
        self.assertEqual(self._schema_errors(clean), [])
        self.assertNotIn("uiState", clean)
        self.assertNotIn("analysisRequests", clean)
        self.assertNotIn("seedPolicy", clean)
        self.assertNotIn("scenarioComposition", clean)
        self.assertNotIn("resultSummary", clean)
        self.assertNotIn("rmsAllocationPlan", clean)
        self.assertEqual(clean["components"][0]["rms"], {"target": {"reliability": 0.98}})
        self.assertNotIn("formState", clean["components"][0])
        self.assertNotIn("draftState", clean["basicMissions"][0])
        self.assertNotIn("uiState", clean["airports"][0])
        self.assertNotIn("canvasLayout", clean["missionAreas"][0])
        self.assertNotIn("profileType", clean["missionProfile"])
        self.assertNotIn("analysisRequests", clean["missionProfile"])
        self.assertNotIn("inventory", clean["supportNodes"][0])
        self.assertNotIn("transportPolicies", clean["supportNodes"][0])
        self.assertGreaterEqual(len(clean["supportResources"]), 3)
        self.assertNotIn("requireDevices", clean["supportActivities"][0])
        self.assertEqual(clean["supportActivities"][0]["requiredDevices"], 1)
        self.assertNotIn("selectedNodeId", clean["supportActivities"][0]["jobs"][0])

    def test_aircraft_support_v1_exporter_rejects_unknown_target(self) -> None:
        with self.assertRaises(ValueError):
            ProjectJsonExporter(target="smoke").export(self._polluted_project())

    def test_project_payload_import_does_not_require_jsonschema_until_export_validation(self) -> None:
        script = """
import builtins

real_import = builtins.__import__

def guarded_import(name, *args, **kwargs):
    if name == "jsonschema":
        raise ModuleNotFoundError("blocked jsonschema")
    return real_import(name, *args, **kwargs)

builtins.__import__ = guarded_import

from src.spare_mvp_backend.project_payload import strip_project_sweep

print(strip_project_sweep({"scenarioId": "scenario-a"})["scenarioId"])
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "scenario-a")

    def test_aircraft_support_v1_exporter_accepts_full_platform_case(self) -> None:
        package = json.loads((REPO_ROOT / "tests" / "fixtures" / "m9_6_platform_case_export.json").read_text(encoding="utf-8"))

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(package["project"])

        self.assertEqual(self._schema_errors(clean), [])
        self.assertEqual(clean["project_id"], package["project"]["project_id"])
        self.assertNotIn("modelingImportValidation", clean)
        self.assertGreater(len(clean["components"]), 1)
        self.assertGreater(len(clean["supportActivities"]), 1)
        compile_result = SimulationAdapter(repo_root=REPO_ROOT).compile_scenario_with_gate(
            clean,
            model_family="aircraft_support_v1",
        )
        self.assertEqual(compile_result["status"], "compiled")


if __name__ == "__main__":
    unittest.main()
