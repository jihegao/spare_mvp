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


def _contains_key(value: object, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(_contains_key(child, key) for child in value.values())
    if isinstance(value, list):
        return any(_contains_key(item, key) for item in value)
    return False


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

    def test_export_migrates_legacy_task_item_ownership(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["priority"] = 9
        composite = project["missionProfile"]["compositeTasks"][0]
        composite.pop("priority", None)
        item = composite["taskItems"][0]
        item["priority"] = 3
        item["minRequiredSystems"] = 2

        exported = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        exported_composite = exported["missionProfile"]["compositeTasks"][0]
        exported_item = exported_composite["taskItems"][0]
        self.assertEqual(exported_composite["priority"], 3)
        self.assertEqual(exported["basicMissions"][0]["minRequiredSorties"], 2)
        self.assertNotIn("priority", exported["basicMissions"][0])
        self.assertNotIn("priority", exported_item)
        self.assertNotIn("minRequiredSystems", exported_item)

    def test_export_preserves_support_node_airport_association(self) -> None:
        project = self._polluted_project()
        project["supportNodes"][0].update({"name": "历史基层", "airport": "Airport A"})
        project["supportOrganization"]["tree"]["children"] = [{
            "id": "org-line",
            "name": "基层",
            "supportNodeId": "node-a",
        }]

        exported = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        self.assertEqual(exported["supportNodes"], [{
            "id": "support-node-1",
            "name": "基层",
            "airport": "Airport A",
        }])

    def _polluted_project(self) -> dict:
        return {
            "schema_version": "project-v0",
            "project_id": "project-polluted-aircraft-support-v1",
            "project_version": "project-v0.1",
            "scenarioId": "scenario-polluted-aircraft-support-v1",
            "activeModule": "sparePlanning",
            "modelingImportValidation": {
                "importId": "import-polluted",
                "usedTables": {"supportResources": True},
                "validationLevel": "level1",
            },
            "modelingDictionaries": {
                "personnelSpecialties": ["航电", "军械", "机械", "特设"],
            },
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
                "compositeTasks": [
                    {
                        "id": "wave-a",
                        "missionAreas": [{"id": "nested-area"}],
                        "taskItems": [
                            {
                                "id": "basic-small",
                                "basicMissionId": "basic-small",
                                "basicTaskName": "small sortie",
                                "dailyRepeatCount": 2,
                                "equipmentQuantity": 2,
                                "equipmentType": "J-15",
                                "firstWaveTime": "08:00",
                                "groupName": "A",
                                "intervalHours": 6,
                                "minRequiredSystems": 2,
                                "preparationMinutes": 30,
                                "priority": 1,
                                "recoveryTime": "11:00",
                                "taskDurationMinutes": 180,
                            }
                        ],
                    }
                ],
                "periodicTasks": [
                    {
                        "id": "periodic-a",
                        "name": "periodic clean",
                        "dailyRepeatCount": 2,
                        "experimentName": "legacy experiment",
                        "mission_areas": [{"id": "nested-area"}],
                        "parentTask": "legacy parent",
                        "parentTaskName": "legacy parent",
                        "periodDays": 7,
                        "periodicTaskName": "legacy periodic",
                        "repeatCount": 2,
                        "repeatCycleDays": 7,
                        "repeatCycleUnit": "day",
                        "repeatCycleValue": 7,
                        "repeatRounds": 2,
                        "taskCategory": "periodic",
                        "taskGroupName": "legacy group",
                        "taskName": "legacy task",
                        "taskPeriodDays": 7,
                        "weekdayAssignments": {
                            "monday": "wave-a",
                            "tuesday": "wave-a",
                        },
                    }
                ],
            },
            "basicMissions": [
                {
                    "id": "basic-small",
                    "name": "small sortie",
                    "missionId": "basic-small",
                    "taskDurationMinutes": 30,
                    "equipmentType": "J-15",
                    "supportActivityName": "Corrective support plan",
                    "missionPhases": [
                        {"id": "phase-sortie", "name": "sortie", "sequence": 1, "durationMinutes": 30}
                    ],
                    "missionAreas": [{"id": "basic-nested-area"}],
                    "draftState": {"dirty": True},
                }
            ],
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
                    "connectionType": "series",
                    "failureModel": "legacy",
                    "failureRate": 0.01,
                    "failureDistribution": {"distributionType": "exponential"},
                    "kOutOfN": {"k": 1, "n": 1},
                    "lifeLimitHours": 240,
                    "mtbfHours": 100,
                    "rms": {
                        "target": {"reliability": 0.98},
                        "prediction": {"mtbfHours": 100},
                        "actual": {"mtbfHours": 90},
                    },
                    "spareType": "legacy spare",
                    "specialRepairProfile": {
                        "repairTimeMinutes": 45,
                        "repairRatio": 0.5,
                        "replacementRatio": 0.5,
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
            "supportResources": [
                {
                    "id": "node-a-personnel",
                    "supportNodeName": "node A",
                    "type": "personnel",
                    "name": "node A人员",
                    "model": "机械",
                    "quantity": 1,
                },
                {
                    "id": "node-a-equipment",
                    "supportNodeName": "node A",
                    "type": "equipment",
                    "name": "node A设备",
                    "model": "通用设备",
                    "quantity": 1,
                    "equipmentId": "J-15",
                },
                {
                    "id": "node-a-spare",
                    "supportNodeName": "node A",
                    "type": "spare",
                    "name": "aircraft_support_v1_spares",
                    "model": "aircraft_support_v1_spares",
                    "quantity": 2,
                    "equipment": "J-15",
                },
            ],
            "supportActivities": [
                {
                    "id": "corrective",
                    "activityName": "Corrective support plan",
                    "activityType": "corrective",
                    "durationHours": 1,
                    "spareType": "legacy spare",
                    "requiredDevices": 1,
                    "requireDevices": 999,
                    "useCalendarRule": True,
                    "useFlightHourRule": True,
                    "useTakeoffLandingRule": False,
                    "calendarDayFloatRatio": 0.2,
                    "runHourFloatRatio": 0.3,
                    "takeoffLandingFloatRatio": 0.4,
                    "transportStrategies": [{"missionAreas": [{"id": "transport-nested-area"}]}],
                    "organizationStrategies": [{"mission_areas": [{"id": "organization-nested-area"}]}],
                    "jobs": [
                        {
                            "id": "job-1",
                            "activityCode": "JOB-1",
                            "missionAreas": [{"id": "job-nested-area"}],
                            "predecessors": [],
                            "selectedNodeId": "debug-node",
                        }
                    ],
                }
            ],
            "reliabilityBlockDiagram": {
                "nodes": [{"id": "whole-aircraft", "type": "system", "mission_areas": [], "treeLayout": {"x": 1}}],
                "edges": [{"from": "whole-aircraft", "to": "whole-aircraft", "missionAreas": []}],
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
        self.assertEqual(clean["reliabilityBlockDiagram"]["nodes"][0]["id"], "whole-aircraft")
        self.assertNotIn("treeLayout", clean["reliabilityBlockDiagram"]["nodes"][0])
        self.assertNotIn("missionAreas", clean["reliabilityBlockDiagram"]["edges"][0])
        self.assertNotIn("modelingDictionaries", clean)
        self.assertNotIn("validationLevel", clean["modelingImportValidation"])
        for field in (
            "connectionType",
            "failureModel",
            "failureRate",
            "lifeLimitHours",
            "mtbfHours",
            "rms",
        ):
            self.assertNotIn(field, clean["components"][0])
        self.assertEqual(clean["components"][0]["spareType"], "legacy spare")
        self.assertEqual(clean["components"][0]["specialRepairProfile"], {"repairTimeMinutes": 45})
        self.assertNotIn("formState", clean["components"][0])
        self.assertNotIn("draftState", clean["basicMissions"][0])
        self.assertEqual(clean["basicMissions"][0]["supportActivityName"], "Corrective support plan")
        self.assertNotIn("uiState", clean["airports"][0])
        self.assertNotIn("missionAreas", clean)
        self.assertNotIn("deploymentLocation", clean["combatUnit"]["members"][0])
        self.assertNotIn("profileType", clean["missionProfile"])
        self.assertNotIn("analysisRequests", clean["missionProfile"])
        self.assertNotIn("durationHours", clean["missionProfile"])
        task_item = clean["missionProfile"]["compositeTasks"][0]["taskItems"][0]
        self.assertEqual(
            task_item,
            {
                "basicMissionId": "basic-small",
                "basicTaskName": "small sortie",
                "groupName": "A",
                "firstWaveTime": "08:00",
                "dailyRepeatCount": 2,
                "intervalHours": 6,
                "equipmentType": "J-15",
            },
        )
        periodic_task = clean["missionProfile"]["periodicTasks"][0]
        self.assertEqual(periodic_task["id"], "periodic-a")
        self.assertEqual(periodic_task["name"], "periodic clean")
        self.assertEqual(periodic_task["repeatWeeks"], 2)
        self.assertEqual(periodic_task["cycleDays"], 7)
        self.assertEqual(periodic_task["compositeTaskIds"], ["wave-a"])
        self.assertEqual(
            periodic_task["compositeTasks"],
            [
                {"compositeTaskId": "wave-a", "weekIndex": 1, "weekday": "monday"},
                {"compositeTaskId": "wave-a", "weekIndex": 1, "weekday": "tuesday"},
                {"compositeTaskId": "wave-a", "weekIndex": 2, "weekday": "monday"},
                {"compositeTaskId": "wave-a", "weekIndex": 2, "weekday": "tuesday"},
            ],
        )
        for field in (
            "dailyRepeatCount",
            "experimentName",
            "parentTask",
            "parentTaskName",
            "periodDays",
            "periodicTaskName",
            "repeatCount",
            "repeatCycleDays",
            "repeatCycleUnit",
            "repeatCycleValue",
            "repeatRounds",
            "taskCategory",
            "taskGroupName",
            "taskName",
            "taskPeriodDays",
            "weekdayAssignments",
        ):
            self.assertNotIn(field, periodic_task)
        self.assertNotIn("inventory", clean["supportNodes"][0])
        self.assertNotIn("transportPolicies", clean["supportNodes"][0])
        self.assertGreaterEqual(len(clean["supportResources"]), 3)
        for resource in clean["supportResources"]:
            self.assertNotIn("equipment", resource)
            self.assertNotIn("equipmentId", resource)
        self.assertNotIn("requireDevices", clean["supportActivities"][0])
        self.assertNotIn("transportStrategies", clean["supportActivities"][0])
        self.assertNotIn("organizationStrategies", clean["supportActivities"][0])
        self.assertNotIn("name", clean["supportActivities"][0])
        self.assertNotIn("resourceId", clean["supportActivities"][0])
        self.assertNotIn("requiredDevices", clean["supportActivities"][0])
        self.assertNotIn("requiredPersonnel", clean["supportActivities"][0])
        self.assertNotIn("spareType", clean["supportActivities"][0])
        for field in (
            "calendarDayFloatRatio",
            "runHourFloatRatio",
            "takeoffLandingFloatRatio",
            "useCalendarRule",
            "useFlightHourRule",
            "useTakeoffLandingRule",
        ):
            self.assertNotIn(field, clean["supportActivities"][0])
        self.assertEqual(clean["supportActivities"][0]["planType"], "修复性维修方案")
        self.assertNotIn("jobs", clean["supportActivities"][0])
        self.assertEqual(clean["supportActivities"][0]["activityCodes"], ["JOB-1"])
        self.assertEqual(clean["supportActivities"][0]["predecessors"], {"JOB-1": []})
        self.assertNotIn("selectedNodeId", clean["supportActivityJobs"][0])
        self.assertNotIn("predecessors", clean["supportActivityJobs"][0])
        self.assertFalse(_contains_key(clean, "missionAreas"))
        self.assertFalse(_contains_key(clean, "mission_areas"))

    def test_exporter_materializes_legacy_activity_applicability_on_jobs(self) -> None:
        project = self._polluted_project()
        project["supportActivities"][0]["aircraftModel"] = "J-15"

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        self.assertEqual(clean["supportActivities"][0]["aircraftModel"], "J-15")
        self.assertEqual(clean["supportActivityJobs"][0]["applicableAircraft"], "J-15")

    def test_exporter_migrates_basic_mission_support_activity_name_matching_legacy_name(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["supportActivityName"] = "Legacy display name"
        project["supportActivities"][0]["name"] = "Legacy display name"
        project["supportActivities"][0]["activityName"] = "Canonical support plan"

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        self.assertEqual(clean["basicMissions"][0]["supportActivityName"], "Canonical support plan")
        self.assertEqual(project["basicMissions"][0]["supportActivityName"], "Legacy display name")

    def test_exporter_rejects_ambiguous_legacy_support_activity_name(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["supportActivityName"] = "Legacy display name"
        project["supportActivities"][0].update({"name": "Legacy display name", "activityName": "Canonical support plan"})
        project["supportActivities"].append({
            **deepcopy(project["supportActivities"][0]),
            "id": "duplicate-legacy-display-name",
            "activityName": "Other support plan",
        })

        with self.assertRaisesRegex(ValueError, "basicMissions.0.supportActivityName"):
            ProjectJsonExporter(target="aircraft_support_v1").export(project)

    def test_exporter_rejects_legacy_name_targeting_duplicate_activity_name(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["supportActivityName"] = "Legacy display name"
        project["supportActivities"][0].update({"name": "Legacy display name", "activityName": "Canonical support plan"})
        project["supportActivities"].append({
            **deepcopy(project["supportActivities"][0]),
            "id": "duplicate-canonical-support-plan",
            "name": "Different legacy display name",
        })

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

    def test_exporter_allows_basic_mission_local_phase_ids(self) -> None:
        project = self._polluted_project()
        project["basicMissions"].append({
            **deepcopy(project["basicMissions"][0]),
            "id": "basic-large",
            "name": "large sortie",
            "missionId": "basic-large",
            "missionPhases": [
                {"id": "phase-sortie", "name": "large sortie", "sequence": 1, "durationMinutes": 45}
            ],
        })

        clean = ProjectJsonExporter(target="aircraft_support_v1").export(project)

        self.assertEqual(clean["basicMissions"][0]["missionPhases"][0]["id"], "phase-sortie")
        self.assertEqual(clean["basicMissions"][1]["missionPhases"][0]["id"], "phase-sortie")

    def test_exporter_rejects_duplicate_phase_id_within_basic_mission(self) -> None:
        project = self._polluted_project()
        project["basicMissions"][0]["missionPhases"].append({
            "id": "phase-sortie",
            "name": "duplicate sortie",
            "sequence": 2,
            "durationMinutes": 45,
        })

        with self.assertRaisesRegex(ValueError, "basicMissions.0.missionPhases.1.id"):
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
        self.assertNotIn("rms", clean["components"][0])
        self.assertNotIn("repairRatio", clean["components"][0]["specialRepairProfile"])
        self.assertEqual(clean["scenarioId"], "scenario-polluted-aircraft-support-v1")

    def test_aircraft_support_v1_exporter_uses_builtin_guard_for_old_jsonschema(self) -> None:
        clean = self._export_with_old_jsonschema(self._polluted_project())

        self.assertNotIn("resultSummary", clean)
        self.assertIn("reliabilityBlockDiagram", clean)
        self.assertNotIn("failureRate", clean["components"][0])
        self.assertEqual(clean["components"][0]["specialRepairProfile"], {"repairTimeMinutes": 45})

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_component_profile_numbers(self) -> None:
        invalid_repair_time = self._polluted_project()
        invalid_repair_time["components"][0]["specialRepairProfile"]["repairTimeMinutes"] = "not-an-integer"
        with self.assertRaisesRegex(
            ValueError,
            "components.0.specialRepairProfile.repairTimeMinutes: expected integer",
        ):
            self._export_with_old_jsonschema(invalid_repair_time)

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_activity_numbers(self) -> None:
        invalid_duration = self._polluted_project()
        invalid_duration["supportActivities"][0]["durationHours"] = -1
        with self.assertRaisesRegex(ValueError, "supportActivities.0.durationHours: expected >= 0"):
            self._export_with_old_jsonschema(invalid_duration)

        invalid_plan_type = self._polluted_project()
        invalid_plan_type["supportActivities"][0]["activityType"] = ""
        invalid_plan_type["supportActivities"][0]["planType"] = "自定义保障方案"
        clean = self._export_with_old_jsonschema(invalid_plan_type)
        self.assertEqual(clean["supportActivities"][0]["planType"], "使用保障方案")

    def test_aircraft_support_v1_exporter_rejects_invalid_support_activity_references(self) -> None:
        unknown_job = self._polluted_project()
        unknown_job["supportActivities"][0]["jobs"] = []
        unknown_job["supportActivities"][0]["activityCodes"] = ["missing-job"]
        unknown_job["supportActivities"][0]["predecessors"] = {"missing-job": []}
        with self.assertRaisesRegex(ValueError, "unknown supportActivityJobs activityCode"):
            ProjectJsonExporter(target="aircraft_support_v1").export(unknown_job)

        cross_plan_predecessor = self._polluted_project()
        cross_plan_predecessor["supportActivityJobs"] = [{"activityCode": "JOB-1"}]
        cross_plan_predecessor["supportActivities"][0].pop("jobs", None)
        cross_plan_predecessor["supportActivities"][0]["activityCodes"] = ["JOB-1"]
        cross_plan_predecessor["supportActivities"][0]["predecessors"] = {"JOB-1": ["OTHER-JOB"]}
        with self.assertRaisesRegex(ValueError, "predecessor value is outside activityCodes"):
            ProjectJsonExporter(target="aircraft_support_v1").export(cross_plan_predecessor)

    def test_aircraft_support_v1_builtin_guard_rejects_invalid_object_shapes(self) -> None:
        invalid_project_info = self._polluted_project()
        invalid_project_info["projectInfo"] = "bad"
        with self.assertRaisesRegex(ValueError, "projectInfo: expected object"):
            self._export_with_old_jsonschema(invalid_project_info)

        invalid_support_organization = self._polluted_project()
        invalid_support_organization["supportOrganization"] = "bad"
        with self.assertRaisesRegex(ValueError, "supportOrganization: expected object"):
            self._export_with_old_jsonschema(invalid_support_organization)

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
