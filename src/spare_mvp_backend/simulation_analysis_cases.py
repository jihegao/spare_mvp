"""Phase 6P simulation-analysis fixture pack helpers."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_backend.monte_carlo_config import normalize_monte_carlo_run_config


SIMULATION_ANALYSIS_CASE_IDS = [
    "minimal_single_aircraft",
    "canonical_platform_case",
    "max_granularity_multi_aircraft",
]


def build_simulation_analysis_case_pack(repo_root: Path | str) -> dict[str, Any]:
    """Build deterministic Phase 6P modeling-import cases for analysis validation."""
    root = Path(repo_root)
    canonical = _load_canonical_import(root)
    cases = [
        _case("minimal_single_aircraft", _minimal_single_aircraft_import(canonical), "最小单机建模粒度"),
        _case("canonical_platform_case", copy.deepcopy(canonical), "M9.6/M9.7/M9.8 平台标准案例"),
        _case("max_granularity_multi_aircraft", _max_granularity_import(canonical), "最大多机建模粒度"),
    ]
    return {
        "schema_version": "simulation-analysis-case-pack-v0",
        "phase": "6P",
        "source_fixture": "tests/fixtures/modeling_import_project.json",
        "cases": cases,
    }


def write_simulation_analysis_case_fixtures(repo_root: Path | str) -> None:
    """Write one golden fixture per Phase 6P analysis case."""
    root = Path(repo_root)
    output_dir = root / "tests" / "fixtures" / "simulation_analysis_cases"
    output_dir.mkdir(parents=True, exist_ok=True)
    for case in build_simulation_analysis_case_pack(root)["cases"]:
        _write_json(output_dir / f"{case['case_id']}.json", case)


def simulation_analysis_case_fixture_drift(repo_root: Path | str) -> list[str]:
    """Return fixture paths that are missing or stale against generated Phase 6P cases."""
    root = Path(repo_root)
    drifted: list[str] = []
    for case in build_simulation_analysis_case_pack(root)["cases"]:
        relative_path = f"tests/fixtures/simulation_analysis_cases/{case['case_id']}.json"
        path = root / relative_path
        if not path.exists():
            drifted.append(relative_path)
            continue
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing != case:
            drifted.append(relative_path)
    return drifted


def _case(case_id: str, import_package: dict[str, Any], description: str) -> dict[str, Any]:
    validation = validate_modeling_import_package(import_package)
    if not validation["ok"]:
        raise ValueError(f"{case_id} modeling import package is invalid: {validation['issues']}")
    project = modeling_import_to_project(import_package)
    analysis_config = {"analysisRequests": copy.deepcopy(project.get("analysisRequests", {}))}
    monte_carlo_config = normalize_monte_carlo_run_config(
        analysis_config,
        mc_experiment_id=f"mc-6p-{case_id}",
    ).to_adapter_payload()
    monte_carlo_config["sample_count"] = max(
        int(monte_carlo_config.get("sample_count") or 1),
        _sweep_point_count(monte_carlo_config.get("sweep") or {}),
    )
    return {
        "schema_version": "simulation-analysis-case-v0",
        "phase": "6P",
        "case_id": case_id,
        "description": description,
        "source_fixture": "tests/fixtures/modeling_import_project.json",
        "model_family": "aircraft_support_v1",
        "modeling_import": import_package,
        "validation": validation,
        "project": project,
        "monte_carlo_config": monte_carlo_config,
        "expected_artifact_kinds": [
            "monte_carlo_base",
            "visualization_state_series",
            "analysis_projection_spare_shortfall",
            "analysis_projection_carry_list",
            "analysis_projection_mission_reliability",
            "analysis_projection_downtime_factors",
        ],
    }


def _load_canonical_import(repo_root: Path) -> dict[str, Any]:
    return json.loads((repo_root / "tests" / "fixtures" / "modeling_import_project.json").read_text(encoding="utf-8"))


def _minimal_single_aircraft_import(source: dict[str, Any]) -> dict[str, Any]:
    case = copy.deepcopy(source)
    case["importId"] = "import-6p-minimal-single-aircraft"
    case["projectId"] = "project-6p-minimal-single-aircraft"
    case["source"] = {
        "type": "json_fixture",
        "name": "simulation_analysis_cases/minimal_single_aircraft.json",
        "derivedFrom": "tests/fixtures/modeling_import_project.json",
    }
    case["lifecycle"] = {"state": "draft", "version": 1, "referencedRunIds": []}
    objects = case["objects"]
    mission = objects["missionProfiles"][0]
    mission["id"] = "mission-profile-6p-minimal"
    mission["name"] = "6P 最小单机任务剖面"
    mission["durationHours"] = 6
    mission["endCondition"] = "完成 1 个最小单机出动波次"
    mission["compositeTasks"] = [
        {
            "id": "composite-6p-minimal",
            "name": "最小单机复合任务",
            "taskItems": [
                {
                    "id": "task-6p-minimal",
                    "basicTaskName": "最小单机巡检任务",
                    "dailyRepeatCount": 1,
                    "equipmentQuantity": 1,
                    "requiredEquipmentQuantity": 1,
                    "equipmentType": "J-15",
                    "firstWaveTime": "08:00",
                    "groupName": "单机编队",
                    "intervalHours": 6,
                    "minRequiredSystems": 1,
                    "preparationMinutes": 20,
                    "priority": 1,
                    "recoveryTime": "09:30",
                    "taskDispatchTime": "07:40",
                }
            ],
        }
    ]
    mission["periodicTasks"] = [
        {
            "id": "periodic-6p-minimal",
            "name": "单日最小周期任务",
            "taskName": "单日最小周期任务",
            "compositeTaskIds": ["composite-6p-minimal"],
            "compositeTasks": [{"compositeTaskId": "composite-6p-minimal", "week": "1"}],
            "cycleDays": 1,
            "periodDays": 1,
            "repeatCount": 1,
            "repeatCycleDays": 1,
            "repeatCycleUnit": "day",
            "repeatCycleValue": 1,
            "repeatRounds": 1,
            "repeatWeeks": 1,
            "weekdayAssignments": {"monday": "composite-6p-minimal"},
        }
    ]
    mission["combatUnit"]["members"] = [copy.deepcopy(mission["combatUnit"]["members"][0])]
    mission["combatUnit"]["members"][0]["aircraftNo"] = "J15-6P-001"
    mission["combatUnit"]["members"][0]["status"] = "备用"
    mission["basicMission"]["equipmentQuantity"] = 1
    mission["basicMission"]["minRequiredSorties"] = 1
    mission["basicMission"]["taskDurationMinutes"] = 60

    objects["equipment"] = {
        **copy.deepcopy(objects.get("equipment", {})),
        "quantity": 1,
        "initialReady": 1,
        "minRequiredSorties": 1,
        "wholeMachineModels": ["J-15"],
    }
    kept_asset_ids = {"aircraft-root", "j15-engine"}
    objects["equipmentAssets"] = [
        _asset_with_quantity(asset, 1)
        for asset in objects["equipmentAssets"]
        if asset.get("id") in kept_asset_ids
    ]
    objects["supportResources"] = [_resource_with_capacity(objects["supportResources"][0], 1)]
    preflight = copy.deepcopy(objects["supportActivities"][0])
    preflight["id"] = "preflight-6p-minimal"
    preflight["name"] = "最小飞行前保障"
    preflight["equipmentId"] = "j15-engine"
    preflight["resourceId"] = objects["supportResources"][0]["id"]
    preflight["durationHours"] = 0.5
    preflight["jobs"] = [copy.deepcopy(preflight["jobs"][0])]
    preflight["jobs"][0]["activityCode"] = "MIN-001"
    preflight["jobs"][0]["predecessors"] = []
    objects["supportActivities"] = [preflight]
    objects["analysisRequests"]["largeSample"] = {
        "enabled": True,
        "samples": 2,
        "sweep": {
            "failureRates": [0.02],
            "spareMultipliers": [1.0],
            "supportCapacities": [1],
        },
    }
    return case


def _max_granularity_import(source: dict[str, Any]) -> dict[str, Any]:
    case = copy.deepcopy(source)
    case["importId"] = "import-6p-max-granularity-multi-aircraft"
    case["projectId"] = "project-6p-max-granularity-multi-aircraft"
    case["source"] = {
        "type": "json_fixture",
        "name": "simulation_analysis_cases/max_granularity_multi_aircraft.json",
        "derivedFrom": "tests/fixtures/modeling_import_project.json",
    }
    case["lifecycle"] = {"state": "draft", "version": 1, "referencedRunIds": []}
    objects = case["objects"]
    mission = objects["missionProfiles"][0]
    mission["id"] = "mission-profile-6p-max"
    mission["name"] = "6P 最大多机多保障节点任务剖面"
    mission["durationHours"] = 36
    members = [copy.deepcopy(member) for member in mission["combatUnit"]["members"]]
    for index in range(6, 9):
        template = copy.deepcopy(members[index % len(members)])
        template["aircraftNo"] = f"J15-6P-{index + 1:03d}"
        template["model"] = "J-15" if index % 2 == 0 else "J-35"
        template["status"] = "备用"
        template["remainingLifeHours"] = 150 + index
        members.append(template)
    mission["combatUnit"]["members"] = members
    for composite in mission["compositeTasks"]:
        for item in composite.get("taskItems", []):
            item["equipmentQuantity"] = max(3, int(item.get("equipmentQuantity") or 1))
            item["requiredEquipmentQuantity"] = max(3, int(item.get("requiredEquipmentQuantity") or item["equipmentQuantity"]))
            item["dailyRepeatCount"] = max(2, int(item.get("dailyRepeatCount") or 1))
    objects["equipment"] = {
        **copy.deepcopy(objects.get("equipment", {})),
        "quantity": len(members),
        "initialReady": len(members),
        "minRequiredSorties": 6,
    }
    root = objects["equipmentAssets"][0]
    root["quantity"] = len(members)
    extra_resource = copy.deepcopy(objects["supportResources"][0])
    extra_resource["id"] = "expeditionary-6p-node"
    extra_resource["name"] = "6P 前出保障点"
    extra_resource["capacity"] = 3
    extra_resource["personnelCapacity"] = 3
    extra_resource["equipmentCapacity"] = 2
    extra_resource["inventory"] = {"发动机备件": 2, "液压备件": 2, "航电模块": 2}
    objects["supportResources"].append(extra_resource)
    for index in range(6, 9):
        template = copy.deepcopy(objects["supportActivities"][index % 3])
        template["id"] = f"phase-6p-extra-activity-{index}"
        template["name"] = f"6P 扩展保障活动 {index}"
        template["resourceId"] = "expeditionary-6p-node" if index % 2 == 0 else template["resourceId"]
        for job_index, job in enumerate(template.get("jobs", [])):
            job["activityCode"] = f"6P-{index}-{job_index + 1:03d}"
            job["predecessors"] = [] if job_index == 0 else [template["jobs"][job_index - 1]["activityCode"]]
        objects["supportActivities"].append(template)
    objects["analysisRequests"]["largeSample"] = {
        "enabled": True,
        "samples": 4,
        "sweep": {
            "failureRates": [0.025, 0.055],
            "spareMultipliers": [0.8, 1.2],
            "supportCapacities": [2, 4],
        },
    }
    return case


def _asset_with_quantity(asset: dict[str, Any], quantity: int) -> dict[str, Any]:
    updated = copy.deepcopy(asset)
    updated["quantity"] = quantity
    return updated


def _resource_with_capacity(resource: dict[str, Any], capacity: int) -> dict[str, Any]:
    updated = copy.deepcopy(resource)
    updated["capacity"] = capacity
    updated["personnelCapacity"] = capacity
    updated["equipmentCapacity"] = capacity
    updated["inventory"] = {key: 1 for key in (updated.get("inventory") or {"通用备件": 1})}
    updated["transportPolicies"] = []
    return updated


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sweep_point_count(sweep: dict[str, Any]) -> int:
    total = 1
    for key in ("failureRates", "spareMultipliers", "supportCapacities"):
        values = sweep.get(key)
        total *= max(1, len(values) if isinstance(values, list) else 0)
    return total
