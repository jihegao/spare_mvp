from __future__ import annotations

import json
from pathlib import Path
import unittest

import jsonschema


REPO_ROOT = Path(__file__).resolve().parents[1]


class AircraftSupportV1CleanProjectSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_project.schema.json").read_text(encoding="utf-8")
        )
        jsonschema.Draft202012Validator.check_schema(self.schema)
        self.validator = jsonschema.Draft202012Validator(self.schema)

    def _clean_project(self) -> dict:
        return {
            "schema_version": "project-v0",
            "project_id": "project-clean-aircraft-support-v1",
            "project_version": "project-v0.1",
            "scenarioId": "scenario-clean-aircraft-support-v1",
            "activeModule": "sparePlanning",
            "airports": ["A"],
            "missionProfile": {
                "name": "clean mission",
                "durationHours": 1,
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
                    "missionPhases": [
                        {"id": "phase-sortie", "name": "sortie", "sequence": 1, "durationMinutes": 30}
                    ],
                }
            ],
            "combatUnit": {
                "members": [
                    {
                        "aircraftNo": "J15-001",
                        "model": "J-15",
                        "status": "ready",
                        "airport": "A",
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
                    "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.01"},
                    "kOutOfN": {"k": 1, "n": 1},
                }
            ],
            "supportNodes": [
                {
                    "id": "node-a",
                    "name": "node A",
                    "personnelCapacity": 1,
                    "equipmentCapacity": 1,
                    "inventory": {"aircraft_support_v1_spares": 2},
                }
            ],
            "supportResources": [
                {
                    "id": "node-a-personnel",
                    "supportNodeName": "node A",
                    "type": "personnel",
                    "name": "crew",
                    "quantity": 1,
                }
            ],
            "transportPolicies": [
                {
                    "id": "tp-1",
                    "fromSupportNodeName": "node A",
                    "toSupportNodeName": "node A",
                    "spareName": "aircraft_support_v1_spares",
                    "capacity": 1,
                }
            ],
            "supportActivities": [
                {
                    "id": "corrective",
                    "activityType": "corrective",
                    "planType": "修复性维修方案",
                    "durationHours": 1,
                    "activityCodes": ["job-1"],
                    "predecessors": {"job-1": []},
                }
            ],
            "supportActivityJobs": [
                {
                    "activityCode": "job-1",
                    "workName": "repair",
                    "durationMinutes": 30,
                }
            ],
        }

    def _schema_errors(self, project: dict) -> list[jsonschema.ValidationError]:
        return sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))

    def test_schema_accepts_minimal_clean_project(self) -> None:
        self.assertEqual(self._schema_errors(self._clean_project()), [])

    def test_schema_accepts_canonical_mission_profile_tasks(self) -> None:
        project = self._clean_project()
        project["missionProfile"].pop("durationHours", None)
        project["missionProfile"]["compositeTasks"] = [
            {
                "id": "composite-day",
                "name": "day mission",
                "taskItems": [
                    {
                        "basicMissionId": "basic-small",
                        "basicTaskName": "small sortie",
                        "groupName": "A",
                        "firstWaveTime": "08:00",
                        "dailyRepeatCount": 2,
                        "intervalHours": 6,
                        "equipmentType": "J-15",
                    }
                ],
            }
        ]
        project["missionProfile"]["periodicTasks"] = [
            {
                "id": "periodic-a",
                "name": "weekly mission",
                "repeatWeeks": 2,
                "cycleDays": 7,
                "compositeTaskIds": ["composite-day"],
                "compositeTasks": [
                    {"compositeTaskId": "composite-day", "weekIndex": 1, "weekday": "monday"},
                ],
            }
        ]

        self.assertEqual(self._schema_errors(project), [])

    def test_schema_rejects_legacy_mission_profile_task_fields(self) -> None:
        for field in (
            "id",
            "equipmentQuantity",
            "minRequiredSystems",
            "preparationMinutes",
            "priority",
            "recoveryTime",
            "taskDurationMinutes",
        ):
            with self.subTest(field=field, path="missionProfile.compositeTasks.taskItems"):
                project = self._clean_project()
                project["missionProfile"]["compositeTasks"] = [
                    {
                        "id": "composite-day",
                        "taskItems": [
                            {
                                "basicMissionId": "basic-small",
                                "basicTaskName": "small sortie",
                                field: "legacy",
                            }
                        ],
                    }
                ]
                self.assertTrue(self._schema_errors(project))

        for field in (
            "dailyRepeatCount",
            "experimentName",
            "fridayCompositeTaskId",
            "mondayCompositeTaskId",
            "parentTask",
            "parentTaskName",
            "periodDays",
            "periodicTaskName",
            "repeatCount",
            "repeatCycleDays",
            "repeatCycleUnit",
            "repeatCycleValue",
            "repeatRounds",
            "saturdayCompositeTaskId",
            "sundayCompositeTaskId",
            "taskCategory",
            "taskGroupName",
            "taskName",
            "taskPeriodDays",
            "thursdayCompositeTaskId",
            "tuesdayCompositeTaskId",
            "wednesdayCompositeTaskId",
            "weekdayAssignments",
        ):
            with self.subTest(field=field, path="missionProfile.periodicTasks"):
                project = self._clean_project()
                project["missionProfile"]["periodicTasks"] = [{"id": "periodic-a", field: "legacy"}]
                self.assertTrue(self._schema_errors(project))

    def test_schema_rejects_duration_hours_when_periodic_duration_exists(self) -> None:
        project = self._clean_project()
        project["missionProfile"]["periodicTasks"] = [{"id": "periodic-a", "repeatWeeks": 2, "cycleDays": 7}]

        self.assertTrue(self._schema_errors(project))

    def test_schema_rejects_polluting_roots(self) -> None:
        for field in (
            "uiState",
            "pageState",
            "formState",
            "experiment",
            "monteCarlo",
            "analysisRequests",
            "missionAreas",
            "seedPolicy",
            "scenarioComposition",
            "stopPolicy",
            "rmsAllocationPlan",
            "rmsAllocationResult",
            "allocationResults",
            "missionExposure",
            "exposureMatrix",
            "rmsNodeResult",
            "simulationRun",
            "resultSummary",
            "runResults",
            "runtimeOutputs",
            "artifactManifest",
            "resultArtifacts",
            "artifactPayload",
            "reliabilityBlockDiagram",
        ):
            with self.subTest(field=field):
                project = self._clean_project()
                project[field] = {}
                self.assertTrue(self._schema_errors(project))

    def test_schema_rejects_nested_non_model_fields(self) -> None:
        for field in (
            "connectionType",
            "failureModel",
            "failureRate",
            "lifeLimitHours",
            "mtbfHours",
            "rms",
            "spareType",
        ):
            with self.subTest(field=field, path="components"):
                project = self._clean_project()
                project["components"][0][field] = 0
                self.assertTrue(self._schema_errors(project))

        for field in ("repairRatio", "replacementRatio"):
            with self.subTest(field=field, path="components.specialRepairProfile"):
                project = self._clean_project()
                project["components"][0]["specialRepairProfile"] = {"repairTimeMinutes": 30, field: 0.5}
                self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivities"][0]["requireDevices"] = 1
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivities"][0]["jobs"] = [{"activityCode": "job-1"}]
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivities"][0]["spareType"] = "legacy"
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivityJobs"][0]["predecessors"] = []
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivityJobs"][0]["maxRepairTimeMinutes"] = 999
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivityJobs"][0]["repairDistribution"] = {"distributionType": "固定值", "value": 999}
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["combatUnit"]["members"][0]["deploymentLocation"] = "航母飞行甲板"
        self.assertTrue(self._schema_errors(project))

        for field in ("missionAreas", "mission_areas"):
            with self.subTest(field=field, path="basicMissions"):
                project = self._clean_project()
                project["basicMissions"][0][field] = []
                self.assertTrue(self._schema_errors(project))

            with self.subTest(field=field, path="missionProfile.compositeTasks"):
                project = self._clean_project()
                project["missionProfile"]["compositeTasks"] = [{field: []}]
                self.assertTrue(self._schema_errors(project))

            with self.subTest(field=field, path="missionProfile.periodicTasks"):
                project = self._clean_project()
                project["missionProfile"]["periodicTasks"] = [{field: []}]
                self.assertTrue(self._schema_errors(project))

            with self.subTest(field=field, path="supportActivityJobs"):
                project = self._clean_project()
                project["supportActivityJobs"][0][field] = []
                self.assertTrue(self._schema_errors(project))

            with self.subTest(field=field, path="supportActivities.transportStrategies"):
                project = self._clean_project()
                project["supportActivities"][0]["transportStrategies"] = [{field: []}]
                self.assertTrue(self._schema_errors(project))

        for field in (
            "monteCarlo",
            "analysisRequests",
            "experiment",
            "seedPolicy",
            "scenarioComposition",
            "stopPolicy",
        ):
            with self.subTest(field=field):
                project = self._clean_project()
                project["supportActivities"][0][field] = {}
                self.assertTrue(self._schema_errors(project))


if __name__ == "__main__":
    unittest.main()
