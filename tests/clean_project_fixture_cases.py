from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.project_payload import ProjectJsonExporter


def minimal_clean_project() -> dict[str, Any]:
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
        "supportActivityJobs": [{"activityCode": "job-1"}],
    }


def legacy_polluted_project() -> dict[str, Any]:
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
                "missionPhases": [
                    {"id": "phase-sortie", "name": "sortie", "sequence": 1, "durationMinutes": 30}
                ],
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
                        "activityCode": "job-1",
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


def clean_project_fixture_payloads(repo_root: Path) -> dict[str, dict[str, Any]]:
    exporter = ProjectJsonExporter(target="aircraft_support_v1", repo_root=repo_root)
    m9_6_export = json.loads((repo_root / "tests/fixtures/m9_6_platform_case_export.json").read_text(encoding="utf-8"))
    return {
        "minimal_clean_project.json": minimal_clean_project(),
        "legacy_polluted_clean_project.json": exporter.export(legacy_polluted_project()),
        "full_platform_case_clean_project.json": exporter.export(m9_6_export["project"]),
    }


def add_frontend_drift_fields(project: dict[str, Any]) -> dict[str, Any]:
    drifted = deepcopy(project)
    drifted["artifactManifest"] = {"draft": True}
    drifted["artifactPayload"] = {"kind": "debug-export"}
    drifted["rmsAllocationResult"] = {"status": "calculated"}
    drifted["allocationResults"] = [{"nodeId": "whole-aircraft"}]
    drifted["runResults"] = [{"runId": "run-debug"}]
    drifted["runtimeOutputs"] = {"state": "debug"}
    drifted["components"][0]["uiState"] = {"open": True}
    drifted["components"][0]["resultArtifacts"] = [{"artifact_id": "artifact-debug"}]
    drifted["supportActivities"][0]["draftState"] = {"dirty": True}
    drifted["supportActivities"][0]["jobs"][0]["futureUiPanelState"] = "must stay out of clean Project"
    drifted["supportActivities"][0]["jobs"][0]["analysisRequests"] = {"largeSample": {"samples": 10}}
    drifted["supportActivities"][0]["jobs"][0]["runtimeOutputs"] = {"state": "debug"}
    drifted["reliabilityBlockDiagram"]["nodes"][0]["canvasLayout"] = {"x": 1, "y": 2}
    drifted["reliabilityBlockDiagram"]["nodes"][0]["futureFrontendPanelState"] = "must stay out of clean Project"
    return drifted
