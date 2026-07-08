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
            "missionAreas": [],
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
                }
            ],
            "missionPhases": [],
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
                    "failureRate": 0.01,
                    "failureDistribution": {"distributionType": "exponential"},
                    "kOutOfN": {"k": 1, "n": 1},
                    "rms": {"target": {"reliability": 0.98}},
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
                    "durationHours": 1,
                    "requiredDevices": 1,
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
            "reliabilityBlockDiagram": {
                "nodes": [{"id": "whole-aircraft", "type": "system"}],
                "edges": [],
            },
        }

    def _schema_errors(self, project: dict) -> list[jsonschema.ValidationError]:
        return sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))

    def test_schema_accepts_minimal_clean_project(self) -> None:
        self.assertEqual(self._schema_errors(self._clean_project()), [])

    def test_schema_rejects_polluting_roots(self) -> None:
        for field in (
            "uiState",
            "pageState",
            "formState",
            "experiment",
            "monteCarlo",
            "analysisRequests",
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
        ):
            with self.subTest(field=field):
                project = self._clean_project()
                project[field] = {}
                self.assertTrue(self._schema_errors(project))

    def test_schema_rejects_nested_non_model_fields(self) -> None:
        project = self._clean_project()
        project["components"][0]["rms"]["prediction"] = {"reliability": 0.95}
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivities"][0]["requireDevices"] = 1
        self.assertTrue(self._schema_errors(project))

        project = self._clean_project()
        project["supportActivities"][0]["jobs"] = [{"activityCode": "job-1"}]
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
        project["missionAreas"].append({"id": "area-a", "uiState": {"expanded": True}})
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
