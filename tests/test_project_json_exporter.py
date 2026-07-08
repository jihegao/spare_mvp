from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

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

    def _export_with_old_jsonschema(self, project: dict) -> dict:
        class OldJsonschema:
            pass

        real_import = __import__

        def guarded_import(name, *args, **kwargs):
            if name == "jsonschema":
                return OldJsonschema()
            return real_import(name, *args, **kwargs)

        with mock.patch("builtins.__import__", side_effect=guarded_import):
            return ProjectJsonExporter(target="aircraft_support_v1").export(project)

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
                    "supportActivityName": "Corrective support plan",
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
                        "deploymentLocation": "航母飞行甲板",
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
                    "activityName": "Corrective support plan",
                    "activityType": "corrective",
                    "durationHours": 1,
                    "requiredDevices": 1,
                    "requireDevices": 999,
                    "jobs": [
                        {
                            "id": "job-1",
                            "activityCode": "JOB-1",
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
        self.assertEqual(clean["basicMissions"][0]["supportActivityName"], "Corrective support plan")
        self.assertNotIn("uiState", clean["airports"][0])
        self.assertNotIn("canvasLayout", clean["missionAreas"][0])
        self.assertNotIn("deploymentLocation", clean["combatUnit"]["members"][0])
        self.assertNotIn("profileType", clean["missionProfile"])
        self.assertNotIn("analysisRequests", clean["missionProfile"])
        self.assertNotIn("inventory", clean["supportNodes"][0])
        self.assertNotIn("transportPolicies", clean["supportNodes"][0])
        self.assertGreaterEqual(len(clean["supportResources"]), 3)
        self.assertNotIn("requireDevices", clean["supportActivities"][0])
        self.assertEqual(clean["supportActivities"][0]["requiredDevices"], 1)
        self.assertNotIn("jobs", clean["supportActivities"][0])
        self.assertEqual(clean["supportActivities"][0]["activityCodes"], ["JOB-1"])
        self.assertEqual(clean["supportActivities"][0]["predecessors"], {"JOB-1": []})
        self.assertNotIn("selectedNodeId", clean["supportActivityJobs"][0])
        self.assertNotIn("predecessors", clean["supportActivityJobs"][0])

    def test_exporter_rejects_basic_mission_support_activity_name_matching_only_legacy_name(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["supportActivityName"] = "Legacy display name"
        project["supportActivities"][0]["name"] = "Legacy display name"
        project["supportActivities"][0]["activityName"] = "Canonical support plan"

        with self.assertRaisesRegex(ValueError, "basicMissions.0.supportActivityName"):
            ProjectJsonExporter(target="aircraft_support_v1").export(project)

    def test_exporter_rejects_basic_mission_support_activity_name_with_duplicate_activity_names(self) -> None:
        project = self._polluted_project()
        project["supportActivities"].append({
            **project["supportActivities"][0],
            "id": "duplicate-corrective",
        })

        with self.assertRaisesRegex(ValueError, "basicMissions.0.supportActivityName"):
            ProjectJsonExporter(target="aircraft_support_v1").export(project)

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

    def test_aircraft_support_v1_exporter_uses_builtin_guard_without_jsonschema(self) -> None:
        real_import = __import__

        def guarded_import(name, *args, **kwargs):
            if name == "jsonschema":
                raise ModuleNotFoundError("blocked jsonschema")
            return real_import(name, *args, **kwargs)

        with mock.patch("builtins.__import__", side_effect=guarded_import):
            clean = ProjectJsonExporter(target="aircraft_support_v1").export(self._polluted_project())

        self.assertNotIn("resultSummary", clean)
        self.assertNotIn("prediction", clean["components"][0]["rms"])
        self.assertEqual(clean["scenarioId"], "scenario-polluted-aircraft-support-v1")

    def test_aircraft_support_v1_exporter_uses_builtin_guard_for_old_jsonschema(self) -> None:
        clean = self._export_with_old_jsonschema(self._polluted_project())

        self.assertNotIn("resultSummary", clean)
        self.assertEqual(clean["components"][0]["rms"], {"target": {"reliability": 0.98}})

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_component_numbers(self) -> None:
        invalid_failure_rate = self._polluted_project()
        invalid_failure_rate["components"][0]["failureRate"] = "not-a-number"
        with self.assertRaisesRegex(ValueError, "components.0.failureRate: expected number"):
            self._export_with_old_jsonschema(invalid_failure_rate)

        invalid_life_limit = self._polluted_project()
        invalid_life_limit["components"][0]["lifeLimitHours"] = "bad"
        with self.assertRaisesRegex(ValueError, "components.0.lifeLimitHours: expected number"):
            self._export_with_old_jsonschema(invalid_life_limit)

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_activity_numbers(self) -> None:
        invalid_duration = self._polluted_project()
        invalid_duration["supportActivities"][0]["durationHours"] = -1
        with self.assertRaisesRegex(ValueError, "supportActivities.0.durationHours: expected >= 0"):
            self._export_with_old_jsonschema(invalid_duration)

        invalid_required_devices = self._polluted_project()
        invalid_required_devices["supportActivities"][0]["requiredDevices"] = True
        with self.assertRaisesRegex(ValueError, "supportActivities.0.requiredDevices: expected integer"):
            self._export_with_old_jsonschema(invalid_required_devices)

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_object_shapes(self) -> None:
        invalid_project_info = self._polluted_project()
        invalid_project_info["projectInfo"] = "bad"
        with self.assertRaisesRegex(ValueError, "projectInfo: expected object"):
            self._export_with_old_jsonschema(invalid_project_info)

        invalid_support_organization = self._polluted_project()
        invalid_support_organization["supportOrganization"] = "bad"
        with self.assertRaisesRegex(ValueError, "supportOrganization: expected object"):
            self._export_with_old_jsonschema(invalid_support_organization)

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_open_model_items(self) -> None:
        invalid_rbd = self._polluted_project()
        invalid_rbd["reliabilityBlockDiagram"]["nodes"] = [1]
        with self.assertRaisesRegex(ValueError, "reliabilityBlockDiagram.nodes.0: expected object"):
            self._export_with_old_jsonschema(invalid_rbd)

    def test_aircraft_support_v1_exporter_accepts_full_platform_case(self) -> None:
        package = json.loads((REPO_ROOT / "tests" / "fixtures" / "m9_6_platform_case_export.json").read_text(encoding="utf-8"))

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(package["project"])

        self.assertEqual(self._schema_errors(clean), [])
        self.assertEqual(clean["project_id"], package["project"]["project_id"])
        self.assertEqual(clean["modelingImportValidation"]["importId"], package["project"]["modelingImportValidation"]["importId"])
        self.assertEqual(clean["modelingImportValidation"]["usedTables"]["supportResources"], True)
        self.assertGreater(len(clean["components"]), 1)
        self.assertGreater(len(clean["supportActivities"]), 1)
        compile_result = SimulationAdapter(repo_root=REPO_ROOT).compile_scenario_with_gate(
            clean,
            model_family="aircraft_support_v1",
        )
        self.assertEqual(compile_result["status"], "compiled")


if __name__ == "__main__":
    unittest.main()
