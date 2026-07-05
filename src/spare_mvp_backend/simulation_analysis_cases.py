"""Phase 6P simulation-analysis fixture pack helpers."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package


SIMULATION_ANALYSIS_CASE_IDS = [
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
    "canonical_platform_case": {
        "used_tables": DEFAULT_USED_TABLES,
    },
}


def build_simulation_analysis_case_pack(repo_root: Path | str) -> dict[str, Any]:
    """Build deterministic Phase 6P modeling-import cases for analysis validation."""
    root = Path(repo_root)
    canonical = _load_canonical_import(root)
    cases = [
        _case("canonical_platform_case", _canonical_platform_import(canonical), "M9.6/M9.7/M9.8 平台标准案例"),
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
    (output_dir / "minimal_single_aircraft.json").unlink(missing_ok=True)
    (template_dir / "minimal_single_aircraft.json").unlink(missing_ok=True)
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
    stale_minimal_case = root / "tests" / "fixtures" / "simulation_analysis_cases" / "minimal_single_aircraft.json"
    if stale_minimal_case.exists():
        drifted.append("tests/fixtures/simulation_analysis_cases/minimal_single_aircraft.json")
    stale_minimal_template = root / "public" / "import-templates" / "minimal_single_aircraft.json"
    if stale_minimal_template.exists():
        drifted.append("public/import-templates/minimal_single_aircraft.json")
    stale_max_case = root / "tests" / "fixtures" / "simulation_analysis_cases" / "max_granularity_multi_aircraft.json"
    if stale_max_case.exists():
        drifted.append("tests/fixtures/simulation_analysis_cases/max_granularity_multi_aircraft.json")
    stale_max_template = root / "public" / "import-templates" / "max_granularity_multi_aircraft.json"
    if stale_max_template.exists():
        drifted.append("public/import-templates/max_granularity_multi_aircraft.json")
    return drifted


def _case(case_id: str, import_package: dict[str, Any], description: str) -> dict[str, Any]:
    used_tables = _apply_validation_scope(case_id, import_package)
    validation = validate_modeling_import_package(import_package)
    if not validation["ok"]:
        raise ValueError(f"{case_id} modeling import package is invalid: {validation['issues']}")
    project = modeling_import_to_project(import_package)
    return {
        "schema_version": "simulation-analysis-case-v0",
        "phase": "6P",
        "case_id": case_id,
        "description": description,
        "source_fixture": BASE_CASE_FIXTURE,
        "model_family": "aircraft_support_v1",
        "used_tables": used_tables,
        "modeling_import": import_package,
        "validation": validation,
        "project": project,
    }


def _load_canonical_import(repo_root: Path) -> dict[str, Any]:
    return json.loads((repo_root / BASE_CASE_FIXTURE).read_text(encoding="utf-8"))


def _canonical_platform_import(source: dict[str, Any]) -> dict[str, Any]:
    case = copy.deepcopy(source)
    _remove_preset_airports(case)
    _remove_equipment_deployment_locations(case)
    _apply_combat_unit_aircraft_defaults(case, airport="A", pre_life_calendar_days=0)
    _move_composite_equipment_quantities_to_basic_tasks(case)
    _structure_support_activity_personnel(case)
    case["source"] = {
        "type": "json_fixture",
        "name": "simulation_analysis_cases/canonical_platform_case.json",
        "derivedFrom": BASE_CASE_FIXTURE,
    }
    return case


def _apply_combat_unit_aircraft_defaults(
    import_package: dict[str, Any],
    *,
    airport: str,
    pre_life_calendar_days: int,
) -> None:
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    missions = objects.get("missionProfiles") if isinstance(objects.get("missionProfiles"), list) else []
    for mission in missions:
        combat_unit = mission.get("combatUnit") if isinstance(mission, dict) else None
        members = combat_unit.get("members") if isinstance(combat_unit, dict) else None
        if not isinstance(members, list):
            continue
        for member in members:
            if not isinstance(member, dict):
                continue
            member["airport"] = airport
            member["preLifeCalendarDays"] = pre_life_calendar_days


def _remove_preset_airports(import_package: dict[str, Any]) -> None:
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    objects.pop("airports", None)
    missions = objects.get("missionProfiles") if isinstance(objects.get("missionProfiles"), list) else []
    for mission in missions:
        if isinstance(mission, dict):
            mission.pop("airports", None)


def _remove_equipment_deployment_locations(import_package: dict[str, Any]) -> None:
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    equipment = objects.get("equipment") if isinstance(objects.get("equipment"), dict) else None
    if equipment is not None:
        equipment.pop("deploymentLocation", None)
    missions = objects.get("missionProfiles") if isinstance(objects.get("missionProfiles"), list) else []
    for mission in missions:
        if not isinstance(mission, dict):
            continue
        mission_equipment = mission.get("equipment") if isinstance(mission.get("equipment"), dict) else None
        if mission_equipment is not None:
            mission_equipment.pop("deploymentLocation", None)


def _structure_support_activity_personnel(import_package: dict[str, Any]) -> None:
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    activities = objects.get("supportActivities") if isinstance(objects.get("supportActivities"), list) else []
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        jobs = activity.get("jobs") if isinstance(activity.get("jobs"), list) else []
        for job in jobs:
            if not isinstance(job, dict):
                continue
            personnel = _personnel_requirements(job.get("personnel"))
            if personnel:
                job["personnel"] = personnel
            job["equipment"] = _material_requirements(job.get("equipment"))
            job["spare"] = _material_requirements(job.get("spare"))
            job.pop("servicePersonnel", None)
            job.pop("personnelRequirements", None)
            job.pop("equipmentRequirements", None)
            job.pop("spareRequirements", None)


def _personnel_requirements(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [
            _normalize_personnel_requirement(item, index)
            for index, item in enumerate(value)
            if isinstance(item, dict)
        ]
    return []


def _normalize_personnel_requirement(item: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "professional": str(item.get("professional") or "").strip(),
        "quantity": _positive_int(item.get("quantity"), 1),
    }


def _material_requirements(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        _normalize_material_requirement(item)
        for item in value
        if isinstance(item, dict)
    ]


def _normalize_material_requirement(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": str(item.get("model") or "").strip(),
        "name": str(item.get("name") or "").strip(),
        "quantity": _positive_int(item.get("quantity"), 1),
    }


def _move_composite_equipment_quantities_to_basic_tasks(import_package: dict[str, Any]) -> None:
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    missions = objects.get("missionProfiles") if isinstance(objects.get("missionProfiles"), list) else []
    for mission in missions:
        if not isinstance(mission, dict):
            continue
        composite_tasks = mission.get("compositeTasks") if isinstance(mission.get("compositeTasks"), list) else []
        task_items: list[dict[str, Any]] = []
        for composite_task in composite_tasks:
            if not isinstance(composite_task, dict):
                continue
            items = composite_task.get("taskItems") if isinstance(composite_task.get("taskItems"), list) else []
            task_items.extend(item for item in items if isinstance(item, dict))

        basic_tasks: list[dict[str, Any]] = []
        if isinstance(mission.get("basicMissions"), list):
            basic_tasks.extend(copy.deepcopy(task) for task in mission["basicMissions"] if isinstance(task, dict))
        if not basic_tasks:
            basic_tasks.append({})

        first_task_name = str(task_items[0].get("basicTaskName") or "").strip() if task_items else ""
        if first_task_name:
            basic_tasks[0]["name"] = first_task_name
            basic_tasks[0]["basicTaskName"] = first_task_name

        normalized_basic_tasks: list[dict[str, Any]] = []
        task_by_alias: dict[str, dict[str, Any]] = {}
        seen_aliases: set[str] = set()
        for task in basic_tasks:
            task["id"] = _basic_task_id(task, len(normalized_basic_tasks))
            if task.get("name") in (None, "") and task.get("basicTaskName") not in (None, ""):
                task["name"] = str(task["basicTaskName"])
            if task.get("basicTaskName") in (None, "") and task.get("name") not in (None, ""):
                task["basicTaskName"] = str(task["name"])
            aliases = _basic_task_aliases(task)
            if aliases and seen_aliases.intersection(aliases):
                continue
            normalized_basic_tasks.append(task)
            seen_aliases.update(aliases)
            for alias in aliases:
                task_by_alias.setdefault(alias, task)
        if not normalized_basic_tasks:
            normalized_basic_tasks.append({"id": "basic-task-1", "name": "基本任务1", "basicTaskName": "基本任务1"})

        for item in task_items:
            task_name = str(item.get("basicTaskName") or "").strip()
            preparation_minutes = _positive_int(item.get("preparationMinutes"), 0)
            task = task_by_alias.get(str(item.get("basicMissionId") or "").strip()) or task_by_alias.get(task_name)
            if task is None:
                derived = copy.deepcopy(normalized_basic_tasks[0])
                derived["name"] = task_name
                derived["basicTaskName"] = task_name
                derived["missionId"] = str(item.get("id") or task_name)
                derived["taskNo"] = str(item.get("id") or task_name)
                derived["id"] = _basic_task_id(derived, len(normalized_basic_tasks))
                if item.get("equipmentType") not in (None, ""):
                    derived["equipmentType"] = item["equipmentType"]
                equipment_quantity = _positive_int(item.get("equipmentQuantity"), 0)
                if equipment_quantity > 0:
                    derived["equipmentQuantity"] = equipment_quantity
                min_required = _positive_int(item.get("minRequiredSystems"), 0)
                if min_required > 0:
                    derived["minRequiredSorties"] = min_required
                if preparation_minutes > 0:
                    derived["preparationMinutes"] = preparation_minutes
                normalized_basic_tasks.append(derived)
                for alias in _basic_task_aliases(derived):
                    task_by_alias.setdefault(alias, derived)
                task = derived
            elif preparation_minutes > 0:
                task["preparationMinutes"] = preparation_minutes
            item["basicMissionId"] = str(task.get("id") or "")
            display_name = str(task.get("name") or task.get("basicTaskName") or task.get("missionId") or "").strip()
            if display_name:
                item["basicTaskName"] = display_name
            item.pop("equipmentQuantity", None)
            item.pop("minRequiredSystems", None)
            item.pop("preparationMinutes", None)
            item.pop("requiredEquipmentQuantity", None)

        mission["basicMissions"] = normalized_basic_tasks
        mission.pop("basicMission", None)


def _basic_task_aliases(task: dict[str, Any]) -> set[str]:
    return {
        str(value).strip()
        for value in (task.get("id"), task.get("name"), task.get("basicTaskName"), task.get("missionId"), task.get("taskNo"))
        if value not in (None, "") and str(value).strip()
    }


def _basic_task_id(task: dict[str, Any], index: int) -> str:
    for value in (task.get("id"), task.get("missionId"), task.get("taskNo"), task.get("basicTaskName"), task.get("name")):
        text = str(value or "").strip()
        if not text:
            continue
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in text).strip("-")
        return slug or f"basic-task-{index + 1}"
    return f"basic-task-{index + 1}"


def _apply_validation_scope(case_id: str, import_package: dict[str, Any]) -> dict[str, bool]:
    scope = CASE_VALIDATION_SCOPES[case_id]
    used_tables = copy.deepcopy(scope["used_tables"])
    import_package.pop("validationLevel", None)
    import_package["usedTables"] = used_tables
    return used_tables


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _positive_int(value: Any, fallback: int = 0) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback
