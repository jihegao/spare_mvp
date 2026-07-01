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
]

BASE_CASE_FIXTURE = "tests/fixtures/case_new.json"

DEFAULT_USED_TABLES = {
    "missionProfiles": True,
    "equipmentAssets": True,
    "reliabilityBlockDiagram": True,
    "supportResources": True,
    "supportActivities": True,
    "supportOrganization": True,
    "transportPolicies": True,
}

CASE_VALIDATION_SCOPES = {
    "minimal_single_aircraft": {
        "validation_level": "level0",
        "used_tables": {
            **DEFAULT_USED_TABLES,
            "supportResources": False,
            "supportActivities": False,
            "supportOrganization": False,
            "transportPolicies": False,
        },
    },
    "canonical_platform_case": {
        "validation_level": "level1",
        "used_tables": DEFAULT_USED_TABLES,
    },
}


def build_simulation_analysis_case_pack(repo_root: Path | str) -> dict[str, Any]:
    """Build deterministic Phase 6P modeling-import cases for analysis validation."""
    root = Path(repo_root)
    canonical = _load_canonical_import(root)
    cases = [
        _case("minimal_single_aircraft", _minimal_single_aircraft_import(canonical), "最小单机建模粒度"),
        _case("canonical_platform_case", copy.deepcopy(canonical), "M9.6/M9.7/M9.8 平台标准案例"),
    ]
    return {
        "schema_version": "simulation-analysis-case-pack-v0",
        "phase": "6P",
        "source_fixture": BASE_CASE_FIXTURE,
        "cases": cases,
    }


def write_simulation_analysis_case_fixtures(repo_root: Path | str) -> None:
    """Write one golden fixture per Phase 6P analysis case."""
    root = Path(repo_root)
    output_dir = root / "tests" / "fixtures" / "simulation_analysis_cases"
    template_dir = root / "public" / "import-templates"
    output_dir.mkdir(parents=True, exist_ok=True)
    template_dir.mkdir(parents=True, exist_ok=True)
    for case in build_simulation_analysis_case_pack(root)["cases"]:
        _write_json(output_dir / f"{case['case_id']}.json", case)
        _write_json(template_dir / f"{case['case_id']}.json", case["modeling_import"])
    (template_dir / "case_new.json").unlink(missing_ok=True)
    (output_dir / "max_granularity_multi_aircraft.json").unlink(missing_ok=True)
    (template_dir / "max_granularity_multi_aircraft.json").unlink(missing_ok=True)


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
        template_relative_path = f"public/import-templates/{case['case_id']}.json"
        template_path = root / template_relative_path
        if not template_path.exists():
            drifted.append(template_relative_path)
            continue
        existing_template = json.loads(template_path.read_text(encoding="utf-8"))
        if existing_template != case["modeling_import"]:
            drifted.append(template_relative_path)
    stale_template = root / "public" / "import-templates" / "case_new.json"
    if stale_template.exists():
        drifted.append("public/import-templates/case_new.json")
    stale_max_case = root / "tests" / "fixtures" / "simulation_analysis_cases" / "max_granularity_multi_aircraft.json"
    if stale_max_case.exists():
        drifted.append("tests/fixtures/simulation_analysis_cases/max_granularity_multi_aircraft.json")
    stale_max_template = root / "public" / "import-templates" / "max_granularity_multi_aircraft.json"
    if stale_max_template.exists():
        drifted.append("public/import-templates/max_granularity_multi_aircraft.json")
    return drifted


def _case(case_id: str, import_package: dict[str, Any], description: str) -> dict[str, Any]:
    validation_level, used_tables = _apply_validation_scope(case_id, import_package)
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
        "source_fixture": BASE_CASE_FIXTURE,
        "model_family": "aircraft_support_v1",
        "validation_level": validation_level,
        "used_tables": used_tables,
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
    return json.loads((repo_root / BASE_CASE_FIXTURE).read_text(encoding="utf-8"))


def _minimal_single_aircraft_import(source: dict[str, Any]) -> dict[str, Any]:
    case = copy.deepcopy(source)
    case["importId"] = "import-6p-minimal-single-aircraft"
    case["projectId"] = "project-6p-minimal-single-aircraft"
    case["source"] = {
        "type": "json_fixture",
        "name": "simulation_analysis_cases/minimal_single_aircraft.json",
        "derivedFrom": BASE_CASE_FIXTURE,
    }
    case["lifecycle"] = {"state": "draft", "version": 1, "referencedRunIds": []}
    objects = case["objects"]
    mission = objects["missionProfiles"][0]
    mission["id"] = "mission-profile-6p-minimal"
    mission["name"] = "6P 最小单机任务剖面"
    mission["durationHours"] = 6
    mission["endCondition"] = "完成 1 个最小单机出动波次"
    for phase in mission.get("missionPhases", []):
        phase.pop("transitionCondition", None)
    if isinstance(objects.get("missionPhases"), list):
        for phase in objects["missionPhases"]:
            phase.pop("transitionCondition", None)
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
    mission["basicMission"]["supportActivityName"] = ""
    mission["experiment"] = {
        **copy.deepcopy(mission.get("experiment", {})),
        "samples": 1,
    }
    objects["experiment"] = copy.deepcopy(mission["experiment"])
    single_monte_carlo = {
        "failureRates": [0.02],
        "minRequiredSorties": [1],
        "spareMultipliers": [1.0],
        "supportCapacities": [1],
    }
    objects["monteCarlo"] = copy.deepcopy(single_monte_carlo)
    mission["monteCarlo"] = copy.deepcopy(single_monte_carlo)
    airport0 = {
        "id": "airport0",
        "name": "airport0",
        "location": "最小案例起降点",
        "runwayType": "单一起降点",
        "distanceToMissionKm": 180,
        "supportNodeId": None,
    }
    objects["airports"] = [copy.deepcopy(airport0)]
    mission["airports"] = [copy.deepcopy(airport0)]

    objects["equipment"] = {
        **copy.deepcopy(objects.get("equipment", {})),
        "quantity": 1,
        "initialReady": 1,
        "minRequiredSorties": 1,
        "model": "J-15",
        "deploymentLocation": "null",
        "wholeMachineModels": ["J-15"],
    }
    mission["equipment"] = copy.deepcopy(objects["equipment"])
    whole_aircraft_asset = {
        "id": "whole-aircraft",
        "name": "全机",
        "aircraftModel": "J-15",
        "productType": "整机",
        "quantity": 1,
        "failureRate": 0.05,
        "mtbfHours": 20,
        "failureDistribution": {
            "distributionType": "指数分布",
            "parameters": "lambda=0.05",
        },
        "meanRepairTimeMinutes": 120,
        "repairDistribution": {
            "distributionType": "固定值",
            "parameters": "value=120",
        },
    }
    objects["equipmentAssets"] = [whole_aircraft_asset]
    minimal_rbd = {
        "nodes": [
            {
                "id": "whole-aircraft",
                "name": "全机",
                "type": "system",
                "parentId": None,
                "connectionType": "串联",
                "failureRate": 0.05,
                "mtbfHours": 20,
                "failureDistribution": {
                    "distributionType": "指数分布",
                    "parameters": "lambda=0.05",
                },
                "meanRepairTimeMinutes": 120,
                "repairDistribution": {
                    "distributionType": "固定值",
                    "parameters": "value=120",
                },
            }
        ],
        "edges": [],
    }
    objects["reliabilityBlockDiagram"] = copy.deepcopy(minimal_rbd)
    mission["reliabilityBlockDiagram"] = copy.deepcopy(minimal_rbd)
    objects.pop("supportResources", None)
    objects.pop("supportActivities", None)
    objects.pop("supportOrganization", None)
    mission.pop("supportOrganization", None)
    single_large_sample = {
        "enabled": True,
        "samples": 1,
        "sweep": {
            "failureRates": [0.02],
            "spareMultipliers": [1.0],
            "supportCapacities": [1],
        },
    }
    objects["analysisRequests"]["largeSample"] = copy.deepcopy(single_large_sample)
    mission["analysisRequests"] = {"largeSample": copy.deepcopy(single_large_sample)}
    return case


def _apply_validation_scope(case_id: str, import_package: dict[str, Any]) -> tuple[str, dict[str, bool]]:
    scope = CASE_VALIDATION_SCOPES[case_id]
    validation_level = str(scope["validation_level"])
    used_tables = copy.deepcopy(scope["used_tables"])
    import_package["validationLevel"] = validation_level
    import_package["usedTables"] = used_tables
    return validation_level, used_tables


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sweep_point_count(sweep: dict[str, Any]) -> int:
    total = 1
    for key in ("failureRates", "spareMultipliers", "supportCapacities"):
        values = sweep.get(key)
        total *= max(1, len(values) if isinstance(values, list) else 0)
    return total
