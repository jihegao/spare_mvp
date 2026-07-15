"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


ACTIVE_CLEAN_PROJECT_TARGET = "aircraft_support_v1"
_POLLUTION_KEYS = {
    "uiState",
    "pageState",
    "formState",
    "selectedNodeId",
    "expandedKeys",
    "treeLayout",
    "canvasLayout",
    "draftState",
    "missionAreas",
    "mission_areas",
    "monteCarlo",
    "analysisRequests",
    "experiment",
    "seedPolicy",
    "scenarioComposition",
    "stopPolicy",
    "validationReports",
    "verificationResult",
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
}
_FRONTEND_POLLUTION_TOKENS = {"frontend", "ui"}
_ROOT_CLEAN_PROJECT_FIELDS = {
    "schema_version",
    "project_id",
    "project_version",
    "scenarioId",
    "activeModule",
    "projectInfo",
    "equipment",
    "airports",
    "missionProfile",
    "basicMissions",
    "combatUnit",
    "components",
    "supportNodes",
    "supportResources",
    "transportPolicies",
    "supportActivityJobs",
    "supportActivities",
    "supportOrganization",
    "modelingImportValidation",
}
_REQUIRED_CLEAN_PROJECT_FIELDS = {
    "scenarioId",
    "activeModule",
    "airports",
    "missionProfile",
    "basicMissions",
    "combatUnit",
    "components",
    "supportNodes",
    "supportActivities",
}
_MODELING_IMPORT_VALIDATION_FIELDS = {"importId", "usedTables", "disabledDomains", "warnings"}
_AIRPORT_FIELDS = {"id", "name", "location", "supportNodeId"}
_MISSION_PROFILE_FIELDS = {
    "id",
    "profileId",
    "sourceImportId",
    "name",
    "durationHours",
    "durationMinutes",
    "combatUnit",
    "compositeTasks",
    "periodicTasks",
}
_MISSION_PROFILE_TASK_ITEM_FIELDS = (
    "basicMissionId",
    "basicTaskName",
    "groupName",
    "firstWaveTime",
    "dailyRepeatCount",
    "intervalHours",
    "equipmentType",
)
_MISSION_PROFILE_TASK_ITEM_FIELD_SET = set(_MISSION_PROFILE_TASK_ITEM_FIELDS)
_MISSION_PROFILE_PERIODIC_TASK_FIELDS = (
    "id",
    "name",
    "repeatWeeks",
    "cycleDays",
    "compositeTasks",
    "compositeTaskIds",
)
_MISSION_PROFILE_PERIODIC_TASK_FIELD_SET = set(_MISSION_PROFILE_PERIODIC_TASK_FIELDS)
_MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELDS = (
    "compositeTaskId",
    "week",
    "weekIndex",
    "weekday",
    "dayOfWeek",
)
_MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELD_SET = set(_MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELDS)
_PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS = (
    ("mondayCompositeTaskId", "monday"),
    ("tuesdayCompositeTaskId", "tuesday"),
    ("wednesdayCompositeTaskId", "wednesday"),
    ("thursdayCompositeTaskId", "thursday"),
    ("fridayCompositeTaskId", "friday"),
    ("saturdayCompositeTaskId", "saturday"),
    ("sundayCompositeTaskId", "sunday"),
)
_COMBAT_UNIT_FIELDS = {"id", "name", "quantity", "members"}
_COMBAT_UNIT_MEMBER_FIELDS = {
    "id",
    "name",
    "aircraftNo",
    "tailNumber",
    "tail_number",
    "model",
    "status",
    "airport",
    "airportId",
    "baseAirportId",
}
_COMPONENT_FIELDS = {
    "id",
    "name",
    "parentId",
    "aircraftModel",
    "productType",
    "spareType",
    "quantity",
    "failureDistribution",
    "repairDistribution",
    "kOutOfN",
    "specialRepairProfile",
}
_SPECIAL_REPAIR_PROFILE_FIELDS = {"repairTimeMinutes"}
_SUPPORT_NODE_FIELDS = {
    "id",
    "name",
    "supportNodeName",
    "airport",
    "airportId",
    "baseAirportId",
    "nodeType",
    "supportLevel",
    "capacity",
    "personnelCapacity",
    "equipmentCapacity",
    "inventory",
    "lateralSupportNodes",
    "transportPolicies",
    "policy",
    "organizationStrategy",
}
_SUPPORT_RESOURCE_FIELDS = {
    "id",
    "supportNodeName",
    "organizationNodeName",
    "type",
    "name",
    "model",
    "quantity",
    "capacity",
    "spareName",
    "spareType",
}
_TRANSPORT_POLICY_FIELDS = {
    "id",
    "name",
    "fromSupportNodeName",
    "from",
    "toSupportNodeName",
    "to",
    "spareName",
    "spareType",
    "spare_type",
    "direction",
    "triggerMode",
    "criticalInventory",
    "transferCycleHours",
    "capacity",
    "priority",
    "transportMode",
    "transportTimeHours",
    "transport_time_hours",
}
_SUPPORT_ACTIVITY_FIELDS = {
    "id",
    "activityName",
    "activityType",
    "planType",
    "aircraftModel",
    "equipmentId",
    "priority",
    "durationMinutes",
    "durationHours",
    "maxWorkTimeRefMinutes",
    "plannedDowntimeHours",
    "spareQuantity",
    "calendarDayInterval",
    "runHourInterval",
    "takeoffLandingInterval",
    "floatRatio",
    "activityCodes",
    "predecessors",
}
_SUPPORT_ACTIVITY_PLAN_TYPES = {
    "使用保障方案",
    "修复性维修方案",
    "预防性维修方案",
    "后勤保障方案",
}
_SUPPORT_ACTIVITY_MTTR_FIELDS = {
    "maxRepairTimeMinutes",
    "meanRepairTimeMinutes",
    "mttrMinutes",
    "mttr",
    "repairDistribution",
    "repairDistributionType",
    "repairTypes",
}
_SUPPORT_ACTIVITY_JOB_FORBIDDEN_FIELDS = {"predecessors", *_SUPPORT_ACTIVITY_MTTR_FIELDS}
_SUPPORT_ACTIVITY_RULE_UI_FIELDS = {
    "calendarDayFloatRatio",
    "runHourFloatRatio",
    "takeoffLandingFloatRatio",
    "useCalendarRule",
    "useFlightHourRule",
    "useTakeoffLandingRule",
}


class ProjectJsonExporter:
    """Export persisted Project JSON into a model-family clean Project boundary."""

    def __init__(self, target: str = ACTIVE_CLEAN_PROJECT_TARGET, repo_root: Path | str | None = None) -> None:
        self.target = str(target or "").strip()
        self.repo_root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
        if self.target != ACTIVE_CLEAN_PROJECT_TARGET:
            raise ValueError(f"unsupported clean Project JSON target: {target}")

    def export(self, project_json: dict[str, Any]) -> dict[str, Any]:
        project = strip_project_sweep(project_json)
        _strip_pollution_keys(project)
        _prune_clean_project(project)
        _drop_none_values(project)
        self._validate(project)
        return project

    def _validate(self, project: dict[str, Any]) -> None:
        try:
            import jsonschema
        except ModuleNotFoundError:
            _validate_clean_project_fallback(project, self.target)
            _validate_basic_mission_support_activity_names(project, self.target)
            _validate_basic_mission_phase_ids(project, self.target)
            _validate_clean_support_activity_references(project, self.target)
            return
        if not hasattr(jsonschema, "Draft202012Validator"):
            _validate_clean_project_fallback(project, self.target)
            _validate_basic_mission_support_activity_names(project, self.target)
            _validate_basic_mission_phase_ids(project, self.target)
            _validate_clean_support_activity_references(project, self.target)
            return

        schema_path = self.repo_root / "contracts" / "aircraft_support_v1_project.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(schema)
        validator = jsonschema.Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(project), key=lambda error: list(error.path))
        if errors:
            first = errors[0]
            path = ".".join(str(part) for part in first.path) or "<root>"
            raise ValueError(f"clean Project JSON failed {self.target} schema at {path}: {first.message}")
        _validate_basic_mission_support_activity_names(project, self.target)
        _validate_basic_mission_phase_ids(project, self.target)
        _validate_clean_support_activity_references(project, self.target)


def export_project_json(project_json: dict[str, Any], target: str = ACTIVE_CLEAN_PROJECT_TARGET) -> dict[str, Any]:
    return ProjectJsonExporter(target=target).export(project_json)


def project_basic_mission_support_activity_name_errors(project: dict[str, Any]) -> list[dict[str, str]]:
    activity_name_counts: dict[str, int] = {}
    activities = project.get("supportActivities")
    if isinstance(activities, list):
        for activity in activities:
            if not isinstance(activity, dict):
                continue
            activity_name = _clean_text(activity.get("activityName"))
            if activity_name:
                activity_name_counts[activity_name] = activity_name_counts.get(activity_name, 0) + 1

    errors: list[dict[str, str]] = []
    basic_missions = project.get("basicMissions")
    if not isinstance(basic_missions, list):
        return errors
    for index, mission in enumerate(basic_missions):
        if not isinstance(mission, dict):
            continue
        support_activity_name = _clean_text(mission.get("supportActivityName"))
        if not support_activity_name:
            continue
        match_count = activity_name_counts.get(support_activity_name, 0)
        if match_count != 1:
            errors.append({
                "code": "invalid_basic_mission_support_activity_name",
                "path": f"basicMissions[{index}].supportActivityName",
                "message": (
                    "basicMissions[].supportActivityName must uniquely match "
                    "supportActivities[].activityName; supportActivities[].name/id fallback is not allowed"
                ),
            })
    return errors


def _validate_basic_mission_support_activity_names(project: dict[str, Any], target: str) -> None:
    errors = project_basic_mission_support_activity_name_errors(project)
    if not errors:
        return
    first = errors[0]
    schema_path = first["path"].replace("[", ".").replace("]", "")
    raise ValueError(f"clean Project JSON failed {target} schema at {schema_path}: {first['message']}")


def project_basic_mission_phase_id_errors(project: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    basic_missions = project.get("basicMissions")
    if not isinstance(basic_missions, list):
        return errors
    for mission_index, mission in enumerate(basic_missions):
        if not isinstance(mission, dict):
            continue
        phases = mission.get("missionPhases")
        if not isinstance(phases, list):
            continue
        seen_ids: set[str] = set()
        for phase_index, phase in enumerate(phases):
            if not isinstance(phase, dict) or "id" not in phase or phase.get("id") in (None, ""):
                continue
            path = f"basicMissions[{mission_index}].missionPhases[{phase_index}].id"
            phase_id = phase.get("id")
            if not isinstance(phase_id, str):
                errors.append({
                    "code": "invalid_basic_mission_phase_id",
                    "path": path,
                    "message": "basicMissions[].missionPhases[].id must be a string when present",
                })
                continue
            normalized = phase_id.strip()
            if not normalized:
                continue
            if normalized in seen_ids:
                errors.append({
                    "code": "duplicate_basic_mission_phase_id",
                    "path": path,
                    "message": "basicMissions[].missionPhases[].id must be unique within its basic mission",
                })
                continue
            seen_ids.add(normalized)
    return errors


def _validate_basic_mission_phase_ids(project: dict[str, Any], target: str) -> None:
    errors = project_basic_mission_phase_id_errors(project)
    if not errors:
        return
    first = errors[0]
    schema_path = first["path"].replace("[", ".").replace("]", "")
    raise ValueError(f"clean Project JSON failed {target} schema at {schema_path}: {first['message']}")


def _validate_clean_project_fallback(project: dict[str, Any], target: str) -> None:
    """Small runtime guard used when the optional jsonschema package is unavailable."""

    if not isinstance(project, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at <root>: expected object")
    missing = sorted(field for field in _REQUIRED_CLEAN_PROJECT_FIELDS if field not in project)
    if missing:
        raise ValueError(f"clean Project JSON failed {target} schema at <root>: missing required {missing[0]}")
    extra = sorted(field for field in project if field not in _ROOT_CLEAN_PROJECT_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at <root>: unexpected field {extra[0]}")
    if project.get("schema_version") not in (None, "project-v0"):
        raise ValueError(f"clean Project JSON failed {target} schema at schema_version: expected project-v0")
    for field in ("project_id", "project_version"):
        _validate_optional_clean_string(project, field, field, target)
    for field in ("projectInfo", "equipment"):
        _validate_optional_clean_dict(project, field, field, target)
    _require_clean_non_empty_string(project, "scenarioId", "scenarioId", target)
    if project.get("activeModule") not in {"sparePlanning", "missionReliability"}:
        raise ValueError(f"clean Project JSON failed {target} schema at activeModule: unsupported module")
    for field in ("airports", "basicMissions", "supportNodes", "supportActivities"):
        _require_clean_list(project, field, target)
    _require_clean_dict(project, "missionProfile", target)
    _validate_clean_airports(project["airports"], target)
    _validate_clean_mission_profile(project["missionProfile"], target)
    _validate_clean_basic_missions(project["basicMissions"], target)
    _require_clean_dict(project, "combatUnit", target)
    _validate_clean_combat_unit(project["combatUnit"], target)
    components = _require_clean_list(project, "components", target)
    if not components:
        raise ValueError(f"clean Project JSON failed {target} schema at components: expected at least one component")
    _validate_clean_components(components, target)
    _validate_clean_support_nodes(project["supportNodes"], target)
    if "supportResources" in project:
        _validate_clean_support_resources(project["supportResources"], target)
    if "transportPolicies" in project:
        _validate_clean_transport_policies(project["transportPolicies"], "transportPolicies", target)
    if "supportActivityJobs" in project:
        _validate_clean_support_activity_jobs(project["supportActivityJobs"], target)
    if "supportOrganization" in project:
        _validate_clean_support_organization(project["supportOrganization"], target)
    _validate_clean_support_activities(project.get("supportActivities"), target)
    if "modelingImportValidation" in project:
        _validate_clean_modeling_import_validation(project["modelingImportValidation"], target)


def _require_clean_dict(project: dict[str, Any], field: str, target: str) -> dict[str, Any]:
    value = project.get(field)
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at {field}: expected object")
    return value


def _require_clean_list(project: dict[str, Any], field: str, target: str) -> list[Any]:
    value = project.get(field)
    if not isinstance(value, list):
        raise ValueError(f"clean Project JSON failed {target} schema at {field}: expected array")
    return value


def _validate_clean_airports(airports: list[Any], target: str) -> None:
    for index, airport in enumerate(airports):
        path = f"airports.{index}"
        if isinstance(airport, str):
            continue
        if not isinstance(airport, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected string or object")
        extra = sorted(field for field in airport if field not in _AIRPORT_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in _AIRPORT_FIELDS:
            _validate_optional_clean_string(airport, field, f"{path}.{field}", target)


def _validate_clean_open_model_array(values: list[Any], path: str, target: str) -> None:
    for index, item in enumerate(values):
        if not isinstance(item, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.{index}: expected object")
        pollution = sorted(field for field in item if _is_pollution_key(field))
        if pollution:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.{index}: unexpected field {pollution[0]}")


def _validate_clean_mission_profile(profile: dict[str, Any], target: str) -> None:
    extra = sorted(field for field in profile if field not in _MISSION_PROFILE_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at missionProfile: unexpected field {extra[0]}")
    if "name" not in profile:
        raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.name: required")
    _require_clean_non_empty_string(profile, "name", "missionProfile.name", target)
    for field in ("id", "profileId", "sourceImportId"):
        _validate_optional_clean_string(profile, field, f"missionProfile.{field}", target)
    _validate_optional_clean_number(profile, "durationHours", "missionProfile.durationHours", target, minimum=0)
    _validate_optional_clean_integer(profile, "durationMinutes", "missionProfile.durationMinutes", target, minimum=1)
    if "durationHours" in profile and _mission_profile_has_periodic_duration(profile):
        raise ValueError(
            f"clean Project JSON failed {target} schema at missionProfile.durationHours: "
            "unexpected when periodicTasks define duration"
        )
    if "combatUnit" in profile:
        if not isinstance(profile["combatUnit"], dict):
            raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.combatUnit: expected object")
        _validate_clean_combat_unit(profile["combatUnit"], target, path="missionProfile.combatUnit")
    if "compositeTasks" in profile:
        if not isinstance(profile["compositeTasks"], list):
            raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.compositeTasks: expected array")
        _validate_clean_composite_tasks(profile["compositeTasks"], target)
    if "periodicTasks" in profile:
        if not isinstance(profile["periodicTasks"], list):
            raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.periodicTasks: expected array")
        _validate_clean_periodic_tasks(profile["periodicTasks"], target)


def _validate_clean_composite_tasks(values: list[Any], target: str) -> None:
    for index, item in enumerate(values):
        path = f"missionProfile.compositeTasks.{index}"
        if not isinstance(item, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        pollution = sorted(field for field in item if _is_pollution_key(field))
        if pollution:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {pollution[0]}")
        _validate_optional_clean_integer(item, "priority", f"{path}.priority", target, minimum=1)
        task_items = item.get("taskItems")
        if task_items is None:
            continue
        if not isinstance(task_items, list):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.taskItems: expected array")
        for item_index, task_item in enumerate(task_items):
            item_path = f"{path}.taskItems.{item_index}"
            if not isinstance(task_item, dict):
                raise ValueError(f"clean Project JSON failed {target} schema at {item_path}: expected object")
            extra = sorted(field for field in task_item if field not in _MISSION_PROFILE_TASK_ITEM_FIELD_SET)
            if extra:
                raise ValueError(f"clean Project JSON failed {target} schema at {item_path}: unexpected field {extra[0]}")
            for field in ("basicMissionId", "basicTaskName", "groupName", "firstWaveTime", "equipmentType"):
                _validate_optional_clean_string(task_item, field, f"{item_path}.{field}", target)
            _validate_optional_clean_integer(task_item, "dailyRepeatCount", f"{item_path}.dailyRepeatCount", target, minimum=0)
            _validate_optional_clean_number(task_item, "intervalHours", f"{item_path}.intervalHours", target, minimum=0)


def _validate_clean_periodic_tasks(values: list[Any], target: str) -> None:
    for index, item in enumerate(values):
        path = f"missionProfile.periodicTasks.{index}"
        if not isinstance(item, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        extra = sorted(field for field in item if field not in _MISSION_PROFILE_PERIODIC_TASK_FIELD_SET)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in ("id", "name"):
            _validate_optional_clean_string(item, field, f"{path}.{field}", target)
        _validate_optional_clean_number(item, "repeatWeeks", f"{path}.repeatWeeks", target, minimum=0)
        _validate_optional_clean_number(item, "cycleDays", f"{path}.cycleDays", target, minimum=0)
        if "compositeTaskIds" in item:
            if not isinstance(item["compositeTaskIds"], list):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.compositeTaskIds: expected array")
            if any(not isinstance(value, str) for value in item["compositeTaskIds"]):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.compositeTaskIds: expected string array")
        if "compositeTasks" in item:
            if not isinstance(item["compositeTasks"], list):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.compositeTasks: expected array")
            for task_index, composite in enumerate(item["compositeTasks"]):
                composite_path = f"{path}.compositeTasks.{task_index}"
                if not isinstance(composite, dict):
                    raise ValueError(f"clean Project JSON failed {target} schema at {composite_path}: expected object")
                extra = sorted(field for field in composite if field not in _MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELD_SET)
                if extra:
                    raise ValueError(f"clean Project JSON failed {target} schema at {composite_path}: unexpected field {extra[0]}")
                for field in ("compositeTaskId", "week", "weekIndex", "weekday", "dayOfWeek"):
                    if field in composite and not isinstance(composite[field], (str, int)):
                        raise ValueError(f"clean Project JSON failed {target} schema at {composite_path}.{field}: expected string or integer")


def _validate_clean_basic_missions(missions: list[Any], target: str) -> None:
    for index, mission in enumerate(missions):
        path = f"basicMissions.{index}"
        if not isinstance(mission, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        pollution = sorted(field for field in mission if _is_pollution_key(field))
        if pollution:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {pollution[0]}")
        if "priority" in mission:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.priority: priority belongs to compositeTasks")
        for field in ("id", "name"):
            if field not in mission:
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
            _require_clean_string(mission, field, f"{path}.{field}", target)
        for field in ("missionId", "equipmentType", "supportActivityName"):
            _validate_optional_clean_string(mission, field, f"{path}.{field}", target)
        for field in ("minRequiredSorties", "equipmentQuantity", "requiredEquipmentQuantity"):
            _validate_optional_clean_integer(mission, field, f"{path}.{field}", target, minimum=0)
        _validate_optional_clean_integer(mission, "taskDurationMinutes", f"{path}.taskDurationMinutes", target, minimum=1)
        if "missionPhases" in mission:
            if not isinstance(mission["missionPhases"], list):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.missionPhases: expected array")
            _validate_clean_open_model_array(mission["missionPhases"], f"{path}.missionPhases", target)


def _validate_clean_combat_unit(value: dict[str, Any], target: str, path: str = "combatUnit") -> None:
    extra = sorted(field for field in value if field not in _COMBAT_UNIT_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
    for field in ("id", "name"):
        _validate_optional_clean_string(value, field, f"{path}.{field}", target)
    _validate_optional_clean_integer(value, "quantity", f"{path}.quantity", target, minimum=0)
    if "members" not in value:
        return
    members = value["members"]
    if not isinstance(members, list):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}.members: expected array")
    for index, member in enumerate(members):
        member_path = f"{path}.members.{index}"
        if not isinstance(member, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {member_path}: expected object")
        extra_member = sorted(field for field in member if field not in _COMBAT_UNIT_MEMBER_FIELDS)
        if extra_member:
            raise ValueError(f"clean Project JSON failed {target} schema at {member_path}: unexpected field {extra_member[0]}")
        for field in _COMBAT_UNIT_MEMBER_FIELDS:
            _validate_optional_clean_string(member, field, f"{member_path}.{field}", target)


def _validate_clean_components(components: list[Any], target: str) -> None:
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at components.{index}: expected object")
        for field in ("id", "name", "quantity"):
            if field not in component:
                raise ValueError(f"clean Project JSON failed {target} schema at components.{index}.{field}: required")
        _require_clean_non_empty_string(component, "id", f"components.{index}.id", target)
        _require_clean_non_empty_string(component, "name", f"components.{index}.name", target)
        _require_clean_integer(component, "quantity", f"components.{index}.quantity", target, minimum=0)
        extra = sorted(field for field in component if field not in _COMPONENT_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at components.{index}: unexpected field {extra[0]}")
        _validate_optional_clean_string(component, "parentId", f"components.{index}.parentId", target, nullable=True)
        for field in ("aircraftModel", "productType"):
            _validate_optional_clean_string(component, field, f"components.{index}.{field}", target)
        for field in ("failureDistribution", "repairDistribution", "kOutOfN", "specialRepairProfile"):
            _validate_optional_clean_dict(component, field, f"components.{index}.{field}", target)
        profile = component.get("specialRepairProfile")
        if isinstance(profile, dict):
            extra_profile = sorted(field for field in profile if field not in _SPECIAL_REPAIR_PROFILE_FIELDS)
            if extra_profile:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at components.{index}.specialRepairProfile: "
                    f"unexpected field {extra_profile[0]}"
                )
            _validate_optional_clean_integer(
                profile,
                "repairTimeMinutes",
                f"components.{index}.specialRepairProfile.repairTimeMinutes",
                target,
                minimum=1,
            )


def _validate_clean_support_nodes(nodes: list[Any], target: str) -> None:
    for index, node in enumerate(nodes):
        path = f"supportNodes.{index}"
        if not isinstance(node, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        for field in ("id", "name"):
            if field not in node:
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
            _require_clean_string(node, field, f"{path}.{field}", target)
        extra = sorted(field for field in node if field not in _SUPPORT_NODE_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in ("supportNodeName", "airport", "airportId", "baseAirportId", "nodeType", "supportLevel", "policy", "organizationStrategy"):
            _validate_optional_clean_string(node, field, f"{path}.{field}", target)
        for field in ("capacity", "personnelCapacity", "equipmentCapacity"):
            _validate_optional_clean_integer(node, field, f"{path}.{field}", target, minimum=0)
        inventory = node.get("inventory")
        if inventory is not None:
            if not isinstance(inventory, dict) or any(
                not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 0
                for quantity in inventory.values()
            ):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.inventory: expected non-negative integer map")
        if "lateralSupportNodes" in node:
            lateral_nodes = node["lateralSupportNodes"]
            if not isinstance(lateral_nodes, list) or any(not isinstance(item, str) for item in lateral_nodes):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.lateralSupportNodes: expected string array")
        if "transportPolicies" in node:
            _validate_clean_transport_policies(node["transportPolicies"], f"{path}.transportPolicies", target)


def _validate_clean_support_resources(resources: Any, target: str) -> None:
    if not isinstance(resources, list):
        raise ValueError(f"clean Project JSON failed {target} schema at supportResources: expected array")
    for index, resource in enumerate(resources):
        path = f"supportResources.{index}"
        if not isinstance(resource, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        for field in ("id", "type", "name", "quantity"):
            if field not in resource:
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
        extra = sorted(field for field in resource if field not in _SUPPORT_RESOURCE_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in ("id", "supportNodeName", "organizationNodeName", "name", "model", "spareName", "spareType"):
            _validate_optional_clean_string(resource, field, f"{path}.{field}", target)
        if resource.get("type") not in {"personnel", "equipment", "spare"}:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.type: unsupported resource type")
        for field in ("quantity", "capacity"):
            _validate_optional_clean_integer(resource, field, f"{path}.{field}", target, minimum=0)


def _validate_clean_transport_policies(policies: Any, path: str, target: str) -> None:
    if not isinstance(policies, list):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected array")
    for index, policy in enumerate(policies):
        policy_path = f"{path}.{index}"
        if not isinstance(policy, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {policy_path}: expected object")
        extra = sorted(field for field in policy if field not in _TRANSPORT_POLICY_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {policy_path}: unexpected field {extra[0]}")
        for field in ("id", "name", "fromSupportNodeName", "from", "toSupportNodeName", "to", "spareName", "spareType", "spare_type", "direction", "triggerMode", "transportMode"):
            _validate_optional_clean_string(policy, field, f"{policy_path}.{field}", target)
        for field in ("capacity", "priority", "criticalInventory"):
            _validate_optional_clean_integer(policy, field, f"{policy_path}.{field}", target, minimum=0)
        for field in ("transferCycleHours", "transportTimeHours", "transport_time_hours"):
            _validate_optional_clean_number(policy, field, f"{policy_path}.{field}", target, minimum=0)


def _validate_clean_support_activities(activities: Any, target: str) -> None:
    if not isinstance(activities, list):
        return
    for index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at supportActivities.{index}: expected object")
        if "id" not in activity:
            raise ValueError(f"clean Project JSON failed {target} schema at supportActivities.{index}.id: required")
        _require_clean_string(activity, "id", f"supportActivities.{index}.id", target)
        extra = sorted(field for field in activity if field not in _SUPPORT_ACTIVITY_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at supportActivities.{index}: unexpected field {extra[0]}")
        for field in ("activityName", "activityType", "planType", "aircraftModel", "equipmentId"):
            _validate_optional_clean_string(activity, field, f"supportActivities.{index}.{field}", target)
        if activity.get("planType") not in (None, "") and activity.get("planType") not in _SUPPORT_ACTIVITY_PLAN_TYPES:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportActivities.{index}.planType: unexpected plan type"
            )
        for field in ("priority", "durationMinutes", "maxWorkTimeRefMinutes", "spareQuantity"):
            minimum = 1 if field == "durationMinutes" else 0
            _validate_optional_clean_integer(activity, field, f"supportActivities.{index}.{field}", target, minimum=minimum)
        for field in ("calendarDayInterval", "takeoffLandingInterval"):
            _validate_optional_clean_integer(
                activity,
                field,
                f"supportActivities.{index}.{field}",
                target,
                minimum=0,
                nullable=True,
            )
        _validate_optional_clean_number(activity, "durationHours", f"supportActivities.{index}.durationHours", target, minimum=0)
        _validate_optional_clean_number(activity, "plannedDowntimeHours", f"supportActivities.{index}.plannedDowntimeHours", target, minimum=0)
        _validate_optional_clean_number(
            activity,
            "runHourInterval",
            f"supportActivities.{index}.runHourInterval",
            target,
            minimum=0,
            nullable=True,
        )
        _validate_optional_clean_number(activity, "floatRatio", f"supportActivities.{index}.floatRatio", target, nullable=True)
        if "activityCodes" in activity:
            codes = activity["activityCodes"]
            if not isinstance(codes, list) or any(not isinstance(code, str) for code in codes):
                raise ValueError(f"clean Project JSON failed {target} schema at supportActivities.{index}.activityCodes: expected string array")
        if "predecessors" in activity:
            predecessors = activity["predecessors"]
            if not isinstance(predecessors, dict) or any(
                not isinstance(values, list) or any(not isinstance(value, str) for value in values)
                for values in predecessors.values()
            ):
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivities.{index}.predecessors: expected string array map"
                )


def _validate_clean_support_activity_references(project: dict[str, Any], target: str) -> None:
    job_codes = {
        str(job.get("activityCode"))
        for job in project.get("supportActivityJobs", [])
        if isinstance(job, dict) and job.get("activityCode") not in (None, "")
    }
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return
    for activity_index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            continue
        raw_codes = activity.get("activityCodes") if isinstance(activity.get("activityCodes"), list) else []
        activity_codes = [str(code) for code in raw_codes if str(code or "").strip()]
        activity_code_set = set(activity_codes)
        for code_index, code in enumerate(activity_codes):
            if code not in job_codes:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivities.{activity_index}.activityCodes.{code_index}: unknown supportActivityJobs activityCode"
                )
        predecessors = activity.get("predecessors") if isinstance(activity.get("predecessors"), dict) else {}
        for code, values in predecessors.items():
            code_text = str(code)
            if code_text not in activity_code_set:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivities.{activity_index}.predecessors.{code_text}: predecessor key is outside activityCodes"
                )
            for predecessor in values:
                predecessor_text = str(predecessor)
                if predecessor_text not in activity_code_set:
                    raise ValueError(
                        f"clean Project JSON failed {target} schema at supportActivities.{activity_index}.predecessors.{code_text}: predecessor value is outside activityCodes"
                    )
def _validate_clean_support_activity_jobs(jobs: Any, target: str) -> None:
    if not isinstance(jobs, list):
        raise ValueError(f"clean Project JSON failed {target} schema at supportActivityJobs: expected array")
    for index, job in enumerate(jobs):
        path = f"supportActivityJobs.{index}"
        if not isinstance(job, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        if "activityCode" not in job:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.activityCode: required")
        _require_clean_non_empty_string(job, "activityCode", f"{path}.activityCode", target)
        forbidden = sorted(field for field in job if field in _SUPPORT_ACTIVITY_JOB_FORBIDDEN_FIELDS)
        if forbidden:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {forbidden[0]}")

def _validate_clean_support_organization(value: Any, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at supportOrganization: expected object")
    extra = sorted(field for field in value if field != "tree")
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at supportOrganization: unexpected field {extra[0]}")
    if "tree" not in value:
        return
    tree = value["tree"]
    if isinstance(tree, list):
        for index, node in enumerate(tree):
            _validate_clean_support_organization_node(node, f"supportOrganization.tree.{index}", target)
        return
    _validate_clean_support_organization_node(tree, "supportOrganization.tree", target)


def _validate_clean_support_organization_node(value: Any, path: str, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
    for field in ("id", "name"):
        if field not in value:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
        _require_clean_string(value, field, f"{path}.{field}", target)
    extra = sorted(field for field in value if field not in {"id", "name", "description", "children"})
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
    _validate_optional_clean_string(value, "description", f"{path}.description", target)
    if "children" not in value:
        return
    children = value["children"]
    if not isinstance(children, list):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}.children: expected array")
    for index, child in enumerate(children):
        _validate_clean_support_organization_node(child, f"{path}.children.{index}", target)


def _validate_clean_modeling_import_validation(value: Any, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at modelingImportValidation: expected object")
    extra = sorted(field for field in value if field not in _MODELING_IMPORT_VALIDATION_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at modelingImportValidation: unexpected field {extra[0]}")
    used_tables = value.get("usedTables")
    if used_tables is not None and (
        not isinstance(used_tables, dict) or any(not isinstance(enabled, bool) for enabled in used_tables.values())
    ):
        raise ValueError(f"clean Project JSON failed {target} schema at modelingImportValidation.usedTables: expected boolean map")
    for field in ("disabledDomains", "warnings"):
        if field in value and not isinstance(value[field], list):
            raise ValueError(f"clean Project JSON failed {target} schema at modelingImportValidation.{field}: expected array")
    if "importId" in value:
        _require_clean_string(value, "importId", "modelingImportValidation.importId", target)
    if "disabledDomains" in value and any(not isinstance(domain, str) for domain in value["disabledDomains"]):
        raise ValueError(
            f"clean Project JSON failed {target} schema at modelingImportValidation.disabledDomains: expected string array"
        )


def _require_clean_non_empty_string(value: dict[str, Any], field: str, path: str, target: str) -> None:
    _require_clean_string(value, field, path, target)
    if not value[field]:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected non-empty string")


def _require_clean_string(value: dict[str, Any], field: str, path: str, target: str) -> None:
    if not isinstance(value.get(field), str):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected string")


def _validate_optional_clean_string(
    value: dict[str, Any],
    field: str,
    path: str,
    target: str,
    *,
    nullable: bool = False,
) -> None:
    if field not in value:
        return
    if nullable and value[field] is None:
        return
    _require_clean_string(value, field, path, target)


def _require_clean_integer(
    value: dict[str, Any],
    field: str,
    path: str,
    target: str,
    *,
    minimum: int | None = None,
) -> None:
    raw_value = value.get(field)
    if not isinstance(raw_value, int) or isinstance(raw_value, bool):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected integer")
    if minimum is not None and raw_value < minimum:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected >= {minimum}")


def _validate_optional_clean_integer(
    value: dict[str, Any],
    field: str,
    path: str,
    target: str,
    *,
    minimum: int | None = None,
    nullable: bool = False,
) -> None:
    if field not in value:
        return
    if nullable and value[field] is None:
        return
    _require_clean_integer(value, field, path, target, minimum=minimum)


def _require_clean_number(
    value: dict[str, Any],
    field: str,
    path: str,
    target: str,
    *,
    minimum: float | None = None,
) -> None:
    raw_value = value.get(field)
    if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected number")
    if minimum is not None and raw_value < minimum:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected >= {minimum:g}")


def _validate_optional_clean_number(
    value: dict[str, Any],
    field: str,
    path: str,
    target: str,
    *,
    minimum: float | None = None,
    nullable: bool = False,
) -> None:
    if field not in value:
        return
    if nullable and value[field] is None:
        return
    _require_clean_number(value, field, path, target, minimum=minimum)


def _validate_optional_clean_dict(value: dict[str, Any], field: str, path: str, target: str) -> None:
    if field in value and not isinstance(value[field], dict):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")


def _validate_optional_clean_list(value: dict[str, Any], field: str, path: str, target: str) -> None:
    if field in value and not isinstance(value[field], list):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected array")


def project_runtime_config_paths(project_json: dict[str, Any]) -> list[str]:
    """Return runtime Monte Carlo config paths that are not Project modeling data."""

    paths: list[str] = []
    _collect_project_runtime_config_paths(project_json, "", paths)
    return paths


def strip_project_sweep(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload without runtime or non-model Project fields."""

    project = deepcopy(project_json)
    _strip_project_runtime_config(project)
    _strip_project_non_model_fields(project)
    return project


def normalize_project_mission_task_field_ownership(project_json: dict[str, Any]) -> dict[str, Any]:
    """Migrate only issue-127 mission task ownership without pruning Project data."""

    project = deepcopy(project_json)
    _normalize_mission_task_field_ownership(project)
    return project


def project_k_out_of_n_errors(project_json: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    components = project_json.get("components") if isinstance(project_json.get("components"), list) else []
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            continue
        quantity = _positive_int(component.get("quantity"), 1)
        k_out = component.get("kOutOfN")
        if not isinstance(k_out, dict):
            continue
        raw_k = k_out.get("k")
        if not _is_positive_int(raw_k):
            errors.append(_project_k_out_of_n_error(index, "K 值必须为正整数，且满足 1 ≤ k ≤ n。"))
            continue
        if int(float(raw_k)) > quantity:
            errors.append(_project_k_out_of_n_error(index, "K 值不能大于数量 n；K 值必须满足 1 ≤ k ≤ n。"))
    return errors


def materialize_scenario_composition(project_json: dict[str, Any]) -> dict[str, Any]:
    """Return a Project payload with scenarioComposition overrides applied."""

    project = deepcopy(project_json)
    composition = project.get("scenarioComposition")
    if not isinstance(composition, dict):
        return project
    overrides = composition.get("overrides")
    if not isinstance(overrides, list):
        return project
    for override in overrides:
        if not isinstance(override, dict):
            continue
        path = str(override.get("path") or "").strip()
        if not path:
            continue
        _set_object_path(project, path, _scenario_override_value(override))
    return project


def _strip_project_runtime_config(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("monteCarlo", None)
        value.pop("analysisRequests", None)
        value.pop("experiment", None)
        value.pop("seedPolicy", None)
        value.pop("scenarioComposition", None)
        value.pop("stopPolicy", None)
        for child in value.values():
            _strip_project_runtime_config(child)
    elif isinstance(value, list):
        for item in value:
            _strip_project_runtime_config(item)


def _scenario_override_value(override: dict[str, Any]) -> Any:
    value_type = override.get("valueType")
    value = override.get("value")
    if value_type == "number":
        number = float(value)
        return int(number) if number.is_integer() else number
    if value_type == "boolean":
        return value is True or value == "true"
    if value_type == "json" and isinstance(value, str):
        return json.loads(value)
    return str(value if value is not None else "")


def _set_object_path(project: dict[str, Any], path: str, value: Any) -> None:
    parts = [part.strip() for part in path.split(".") if part.strip()]
    if not parts:
        return
    current: Any = project
    for index, part in enumerate(parts[:-1]):
        next_part = parts[index + 1]
        next_container: Any = [] if _array_index(next_part) is not None else {}
        if isinstance(current, list):
            item_index = _array_index(part)
            if item_index is None:
                raise ValueError(f"scenario override path segment must be an array index: {part}")
            while item_index >= len(current):
                current.append(deepcopy(next_container))
            if not isinstance(current[item_index], (dict, list)):
                current[item_index] = deepcopy(next_container)
            current = current[item_index]
            continue
        if not isinstance(current, dict):
            raise ValueError(f"scenario override path segment is not a container: {part}")
        if not isinstance(current.get(part), (dict, list)):
            current[part] = deepcopy(next_container)
        current = current[part]

    last_part = parts[-1]
    if isinstance(current, list):
        item_index = _array_index(last_part)
        if item_index is None:
            raise ValueError(f"scenario override path segment must be an array index: {last_part}")
        while item_index >= len(current):
            current.append(None)
        current[item_index] = deepcopy(value)
        return
    if not isinstance(current, dict):
        raise ValueError(f"scenario override target is not a container: {last_part}")
    current[last_part] = deepcopy(value)


def _array_index(value: str) -> int | None:
    if not value.isdigit():
        return None
    if len(value) > 1 and value.startswith("0"):
        return None
    return int(value)


def _strip_project_non_model_fields(project: dict[str, Any]) -> None:
    project.pop("deletedSupportResourceKeys", None)
    project.pop("supportResourceOverrides", None)
    _materialize_legacy_support_tables(project)
    _normalize_support_model_tables(project)
    project.pop("modelingDictionaries", None)
    _strip_modeling_import_validation_non_model_fields(project)
    _strip_support_resource_non_model_fields(project)
    _strip_legacy_support_node_resource_fields(project)
    _normalize_project_component_k_out_of_n(project)
    _strip_component_non_model_fields(project.get("components"))
    project.pop("reliabilityBlockDiagram", None)
    _migrate_root_mission_phases_to_basic_missions(project)
    project.pop("missionPhases", None)
    mission_profile = project.get("missionProfile")
    if isinstance(mission_profile, dict):
        mission_profile.pop("profileType", None)
        mission_profile.pop("endCondition", None)
        mission_profile.pop("repeatCycleHours", None)
        mission_profile.pop("analysisRequests", None)
        _normalize_mission_task_field_ownership(project)
        _normalize_mission_profile_reference_fields(project)
    _strip_typo_only_support_activity_fields(project)
    _strip_deprecated_support_activity_strategy_fields(project)
    _strip_support_activity_rule_ui_fields(project.get("supportActivities"))
    _strip_support_activity_spare_type_fields(project.get("supportActivities"))
    _strip_support_activity_mttr_fields(project.get("supportActivities"))
    _strip_support_activity_mttr_fields(project.get("supportActivityJobs"))
    _lift_support_activity_jobs_to_top_level(project)
    _materialize_support_activity_job_applicability(project)
    _normalize_support_activity_reference_fields(project)


def _project_k_out_of_n_error(index: int, message: str) -> dict[str, str]:
    return {
        "code": "invalid_equipment_k_out_of_n",
        "path": f"components[{index}].kOutOfN.k",
        "message": message,
    }


def _normalize_project_component_k_out_of_n(project: dict[str, Any]) -> None:
    components = project.get("components") if isinstance(project.get("components"), list) else []
    for component in components:
        if not isinstance(component, dict):
            continue
        quantity = _positive_int(component.get("quantity"), 1)
        component["quantity"] = quantity
        k_out = component.get("kOutOfN")
        if not isinstance(k_out, dict):
            component["kOutOfN"] = {"enabled": quantity > 1, "n": quantity, "k": quantity}
            continue
        raw_k = k_out.get("k")
        k = int(float(raw_k)) if _is_positive_int(raw_k) and int(float(raw_k)) <= quantity else quantity
        component["kOutOfN"] = {**k_out, "enabled": quantity > 1, "n": quantity, "k": k}


def _migrate_root_mission_phases_to_basic_missions(project: dict[str, Any]) -> None:
    root_phases = project.get("missionPhases")
    basic_missions = project.get("basicMissions")
    if not isinstance(root_phases, list) or not root_phases:
        return
    if not isinstance(basic_missions, list):
        return
    clean_phases = [deepcopy(phase) for phase in root_phases if isinstance(phase, dict)]
    if not clean_phases:
        return
    for mission in basic_missions:
        if not isinstance(mission, dict):
            continue
        phases = mission.get("missionPhases")
        if isinstance(phases, list) and phases:
            continue
        mission["missionPhases"] = deepcopy(clean_phases)


def _strip_component_non_model_fields(value: Any) -> None:
    if not isinstance(value, list):
        return
    for component in value:
        if not isinstance(component, dict):
            continue
        for field in (
            "connectionType",
            "failureModel",
            "failureRate",
            "lifeLimitHours",
            "mtbfHours",
            "rms",
        ):
            component.pop(field, None)
        profile = component.get("specialRepairProfile")
        if isinstance(profile, dict):
            _keep_fields(profile, _SPECIAL_REPAIR_PROFILE_FIELDS)
            if not profile:
                component.pop("specialRepairProfile", None)


def _normalize_mission_profile_reference_fields(project: dict[str, Any]) -> None:
    mission_profile = project.get("missionProfile")
    if not isinstance(mission_profile, dict):
        return
    basic_missions = project.get("basicMissions") if isinstance(project.get("basicMissions"), list) else []
    basic_mission_ids = {mission_id for mission in basic_missions for mission_id in [_basic_mission_id(mission)] if mission_id}
    _normalize_mission_profile_composite_tasks(mission_profile, basic_mission_ids)
    _normalize_mission_profile_periodic_tasks(mission_profile)
    if _mission_profile_has_periodic_duration(mission_profile):
        mission_profile.pop("durationHours", None)


def _normalize_mission_task_field_ownership(project: dict[str, Any]) -> None:
    basic_missions = project.get("basicMissions") if isinstance(project.get("basicMissions"), list) else []
    basics_by_ref: dict[str, dict[str, Any]] = {}
    for basic in basic_missions:
        if not isinstance(basic, dict):
            continue
        basic.pop("priority", None)
        for value in (basic.get("id"), basic.get("missionId"), basic.get("taskNo"), basic.get("name"), basic.get("basicTaskName")):
            reference = _clean_text(value)
            if reference:
                basics_by_ref[reference] = basic

    mission_profile = project.get("missionProfile")
    composites = mission_profile.get("compositeTasks") if isinstance(mission_profile, dict) else []
    if not isinstance(composites, list):
        return
    for composite in composites:
        if not isinstance(composite, dict):
            continue
        task_items = composite.get("taskItems") if isinstance(composite.get("taskItems"), list) else []
        inherited_priority = next(
            (
                _positive_int(item.get("priority"), 0)
                for item in task_items
                if isinstance(item, dict) and _positive_int(item.get("priority"), 0) > 0
            ),
            1,
        )
        composite["priority"] = _positive_int(composite.get("priority"), inherited_priority)
        for item in task_items:
            if not isinstance(item, dict):
                continue
            legacy_minimum = int(float(item["minRequiredSystems"])) if _is_positive_int(item.get("minRequiredSystems")) else 0
            basic = basics_by_ref.get(_clean_text(item.get("basicMissionId"))) or basics_by_ref.get(_clean_text(item.get("basicTaskName")))
            if legacy_minimum and isinstance(basic, dict):
                basic_minimum = int(float(basic["minRequiredSorties"])) if _is_positive_int(basic.get("minRequiredSorties")) else 0
                if basic_minimum and basic_minimum != legacy_minimum:
                    raise ValueError(
                        "clean Project JSON cannot migrate conflicting minRequiredSystems for "
                        f"basic mission {_basic_mission_id(basic) or basic.get('name') or '<unknown>'}"
                    )
                basic["minRequiredSorties"] = legacy_minimum
            item.pop("priority", None)
            item.pop("minRequiredSystems", None)
            item.pop("equipmentQuantity", None)
            item.pop("requiredEquipmentQuantity", None)


def _basic_mission_id(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _clean_text(value.get("id") or value.get("missionId") or value.get("taskNo"))


def _normalize_mission_profile_composite_tasks(mission_profile: dict[str, Any], basic_mission_ids: set[str]) -> None:
    composites = mission_profile.get("compositeTasks")
    if not isinstance(composites, list):
        return
    for composite in composites:
        if not isinstance(composite, dict):
            continue
        task_items = composite.get("taskItems")
        if not isinstance(task_items, list):
            continue
        normalized_items: list[dict[str, Any]] = []
        for item in task_items:
            if not isinstance(item, dict):
                continue
            normalized = _normalized_mission_profile_task_item(item, basic_mission_ids)
            if normalized:
                normalized_items.append(normalized)
        composite["taskItems"] = normalized_items


def _normalized_mission_profile_task_item(item: dict[str, Any], basic_mission_ids: set[str]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    basic_mission_id = _clean_text(item.get("basicMissionId") or item.get("missionId"))
    if basic_mission_id:
        normalized["basicMissionId"] = basic_mission_id
    else:
        legacy_id = _clean_text(item.get("id"))
        if legacy_id and legacy_id in basic_mission_ids:
            normalized["basicMissionId"] = legacy_id
    for field in _MISSION_PROFILE_TASK_ITEM_FIELDS:
        if field == "basicMissionId":
            continue
        if item.get(field) not in (None, ""):
            normalized[field] = deepcopy(item[field])
    return normalized


def _normalize_mission_profile_periodic_tasks(mission_profile: dict[str, Any]) -> None:
    periodic_tasks = mission_profile.get("periodicTasks")
    if not isinstance(periodic_tasks, list):
        return
    normalized_tasks: list[dict[str, Any]] = []
    for task in periodic_tasks:
        if not isinstance(task, dict):
            continue
        normalized = _normalized_mission_profile_periodic_task(task)
        if normalized:
            normalized_tasks.append(normalized)
    mission_profile["periodicTasks"] = normalized_tasks


def _normalized_mission_profile_periodic_task(task: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for field in ("id",):
        if task.get(field) not in (None, ""):
            normalized[field] = deepcopy(task[field])
    name = _clean_text(task.get("name") or task.get("periodicTaskName") or task.get("taskName") or task.get("experimentName"))
    if name:
        normalized["name"] = name
    repeat_weeks = _first_positive_number(task.get("repeatWeeks"), task.get("repeatRounds"), task.get("repeatCount"))
    if repeat_weeks is not None:
        normalized["repeatWeeks"] = repeat_weeks
    cycle_days = _periodic_cycle_days(task)
    if cycle_days is None and repeat_weeks is not None:
        cycle_days = 7.0
    if cycle_days is not None:
        normalized["cycleDays"] = cycle_days
    composite_tasks = _normalized_periodic_composite_tasks(task, repeat_weeks)
    composite_task_ids = _unique_clean_strings([
        *(task.get("compositeTaskIds") if isinstance(task.get("compositeTaskIds"), list) else []),
        *(item.get("compositeTaskId") for item in composite_tasks),
    ])
    if composite_tasks:
        normalized["compositeTasks"] = composite_tasks
    if composite_task_ids:
        normalized["compositeTaskIds"] = composite_task_ids
    _keep_fields(normalized, _MISSION_PROFILE_PERIODIC_TASK_FIELD_SET)
    return normalized


def _normalized_periodic_composite_tasks(task: dict[str, Any], repeat_weeks: float | None) -> list[dict[str, Any]]:
    raw_composites = task.get("compositeTasks")
    if isinstance(raw_composites, list):
        explicit_tasks: list[dict[str, Any]] = []
        for item in raw_composites:
            if not isinstance(item, dict):
                continue
            normalized: dict[str, Any] = {}
            for field in _MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELDS:
                if item.get(field) not in (None, ""):
                    normalized[field] = deepcopy(item[field])
            if _clean_text(normalized.get("compositeTaskId")):
                explicit_tasks.append(normalized)
        if explicit_tasks:
            return explicit_tasks

    assignments: list[tuple[str, Any]] = []
    raw_assignments = task.get("weekdayAssignments") if isinstance(task.get("weekdayAssignments"), dict) else {}
    for legacy_field, weekday in _PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS:
        assignments.append((weekday, raw_assignments.get(weekday) or raw_assignments.get(legacy_field) or task.get(legacy_field)))
    week_count = max(1, int(round(repeat_weeks or 1)))
    composite_tasks: list[dict[str, Any]] = []
    for week_index in range(1, week_count + 1):
        for weekday, composite_id in assignments:
            composite_text = _clean_text(composite_id)
            if not composite_text:
                continue
            composite_tasks.append({
                "compositeTaskId": composite_text,
                "weekIndex": week_index,
                "weekday": weekday,
            })
    return composite_tasks


def _periodic_cycle_days(task: dict[str, Any]) -> float | None:
    direct = _first_positive_number(
        task.get("cycleDays"),
        task.get("repeatCycleDays"),
        task.get("periodDays"),
        task.get("taskPeriodDays"),
    )
    if direct is not None:
        return direct
    value = _first_positive_number(task.get("repeatCycleValue"))
    if value is None:
        return None
    unit = _clean_text(task.get("repeatCycleUnit") or "day").lower()
    if unit in {"week", "weeks", "周", "星期"}:
        return value * 7
    if unit in {"hour", "hours", "小时"}:
        return value / 24
    return value


def _mission_profile_has_periodic_duration(mission_profile: dict[str, Any]) -> bool:
    periodic_tasks = mission_profile.get("periodicTasks")
    if not isinstance(periodic_tasks, list):
        return False
    return any(
        isinstance(task, dict)
        and (_first_positive_number(task.get("repeatWeeks")) is not None or _first_positive_number(task.get("cycleDays")) is not None)
        for task in periodic_tasks
    )


def _first_positive_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number > 0:
            return number
    return None


def _unique_clean_strings(values: list[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _positive_int(value: Any, fallback: int) -> int:
    if not _is_positive_int(value):
        return max(1, int(fallback))
    return int(float(value))


def _is_positive_int(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return number.is_integer() and number >= 1


def _materialize_legacy_support_tables(project: dict[str, Any]) -> None:
    support_nodes = project.get("supportNodes")
    if not isinstance(support_nodes, list):
        return
    if not isinstance(project.get("supportResources"), list) or not project["supportResources"]:
        resources: list[dict[str, Any]] = []
        for node_index, node in enumerate(support_nodes):
            if not isinstance(node, dict):
                continue
            node_name = str(node.get("name") or node.get("id") or "保障节点")
            personnel = _non_negative_int(node.get("personnelCapacity", node.get("capacity", 0)))
            if personnel > 0:
                resources.append({
                    "id": f"{node.get('id') or f'support-node-{node_index}'}-personnel",
                    "supportNodeName": node_name,
                    "type": "personnel",
                    "name": str(node.get("personnelName") or f"{node_name}人员"),
                    "model": str(node.get("personnelModel") or node.get("personnelType") or ""),
                    "quantity": personnel,
                })
            equipment = _non_negative_int(node.get("equipmentCapacity", node.get("capacity", 0)))
            if equipment > 0:
                resources.append({
                    "id": f"{node.get('id') or f'support-node-{node_index}'}-equipment",
                    "supportNodeName": node_name,
                    "type": "equipment",
                    "name": str(node.get("supportEquipmentName") or node.get("equipmentName") or f"{node_name}设备"),
                    "model": str(node.get("supportEquipmentModel") or node.get("nodeType") or ""),
                    "quantity": equipment,
                })
            inventory = node.get("inventory") if isinstance(node.get("inventory"), dict) else {}
            for spare_index, (spare_name, quantity) in enumerate(inventory.items()):
                resources.append({
                    "id": f"{node.get('id') or f'support-node-{node_index}'}-spare-{spare_index}",
                    "supportNodeName": node_name,
                    "type": "spare",
                    "name": str(spare_name),
                    "model": str((node.get("spareModels") or {}).get(spare_name) or spare_name),
                    "quantity": _non_negative_int(quantity),
                })
        if resources:
            project["supportResources"] = resources
    if not isinstance(project.get("transportPolicies"), list) or not project["transportPolicies"]:
        name_by_id = {
            str(node.get("id")): str(node.get("name") or node.get("id"))
            for node in support_nodes
            if isinstance(node, dict) and node.get("id") not in (None, "")
        }
        policies: list[dict[str, Any]] = []
        for node_index, node in enumerate(support_nodes):
            if not isinstance(node, dict):
                continue
            for policy_index, policy in enumerate(node.get("transportPolicies") if isinstance(node.get("transportPolicies"), list) else []):
                if not isinstance(policy, dict):
                    continue
                next_policy = deepcopy(policy)
                next_policy.setdefault("id", f"{node.get('id') or f'support-node-{node_index}'}-transport-{policy_index}")
                next_policy["fromSupportNodeName"] = str(policy.get("fromSupportNodeName") or name_by_id.get(str(policy.get("from") or ""), policy.get("from") or ""))
                next_policy["toSupportNodeName"] = str(policy.get("toSupportNodeName") or name_by_id.get(str(policy.get("to") or ""), policy.get("to") or ""))
                next_policy["spareName"] = str(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type") or "")
                policies.append(next_policy)
        policies.extend(_legacy_transport_policies_from_support_activities(project.get("supportActivities"), name_by_id))
        if policies:
            project["transportPolicies"] = policies


def _legacy_transport_policies_from_support_activities(activities: Any, name_by_ref: dict[str, str] | None = None) -> list[dict[str, Any]]:
    policies: list[dict[str, Any]] = []
    aliases = name_by_ref or {}
    if not isinstance(activities, list):
        return policies
    for activity_index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            continue
        strategies = activity.get("transportStrategies")
        if not isinstance(strategies, list):
            continue
        for policy_index, policy in enumerate(strategies):
            if not isinstance(policy, dict):
                continue
            next_policy = deepcopy(policy)
            next_policy.setdefault("id", f"{activity.get('id') or f'support-activity-{activity_index}'}-transport-{policy_index}")
            from_ref = str(policy.get("fromSupportNodeName") or policy.get("from") or "")
            to_ref = str(policy.get("toSupportNodeName") or policy.get("to") or "")
            next_policy["fromSupportNodeName"] = str(policy.get("fromSupportNodeName") or aliases.get(from_ref, from_ref))
            next_policy["toSupportNodeName"] = str(policy.get("toSupportNodeName") or aliases.get(to_ref, to_ref))
            next_policy["spareName"] = str(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type") or "")
            if "transportMode" not in next_policy and "direction" in next_policy:
                next_policy["transportMode"] = next_policy["direction"]
            policies.append(next_policy)
    return policies


def _normalize_support_model_tables(project: dict[str, Any]) -> None:
    legacy_name_by_ref = _legacy_support_node_name_by_ref(project.get("supportNodes"))
    node_scope_by_ref = _support_node_scope_by_ref(project.get("supportNodes"))
    organization_names, organization_name_by_ref = _normalize_support_organization(project.get("supportOrganization"), legacy_name_by_ref)
    name_by_ref = {**legacy_name_by_ref, **organization_name_by_ref}
    node_scope_by_name = _support_node_scope_by_name(node_scope_by_ref, name_by_ref)
    _normalize_support_resource_refs(project, name_by_ref)
    support_node_names = organization_names or _support_node_names_from_support_nodes(project.get("supportNodes"))
    project["supportNodes"] = [
        {
            "id": f"support-node-{index + 1}",
            "name": name,
            **node_scope_by_name.get(name, {}),
        }
        for index, name in enumerate(support_node_names)
    ]
    _normalize_top_level_transport_policies(project, name_by_ref)
    _normalize_support_node_refs_in_project(project, name_by_ref)


def _legacy_support_node_name_by_ref(support_nodes: Any) -> dict[str, str]:
    name_by_ref: dict[str, str] = {}
    if not isinstance(support_nodes, list):
        return name_by_ref
    for node in support_nodes:
        if not isinstance(node, dict):
            continue
        name = _clean_text(node.get("name") or node.get("supportNodeName") or node.get("id"))
        if not name:
            continue
        for ref in (node.get("id"), node.get("name"), node.get("supportNodeName"), node.get("organizationNodeId")):
            key = _clean_text(ref)
            if key:
                name_by_ref[key] = name
    return name_by_ref


def _support_node_scope_by_ref(support_nodes: Any) -> dict[str, dict[str, str]]:
    scope_by_ref: dict[str, dict[str, str]] = {}
    if not isinstance(support_nodes, list):
        return scope_by_ref
    for node in support_nodes:
        if not isinstance(node, dict):
            continue
        scope = {
            field: value
            for field in ("airport", "airportId", "baseAirportId")
            if (value := _clean_text(node.get(field)))
        }
        if not scope:
            continue
        for ref in (node.get("id"), node.get("name"), node.get("supportNodeName"), node.get("organizationNodeId")):
            key = _clean_text(ref)
            if key:
                scope_by_ref[key] = scope
    return scope_by_ref


def _support_node_scope_by_name(
    scope_by_ref: dict[str, dict[str, str]],
    name_by_ref: dict[str, str],
) -> dict[str, dict[str, str]]:
    scope_by_name: dict[str, dict[str, str]] = {}
    for ref, scope in scope_by_ref.items():
        name = _clean_text(name_by_ref.get(ref) or ref)
        if name:
            scope_by_name[name] = scope
    return scope_by_name


def _normalize_support_organization(support_organization: Any, fallback_name_by_ref: dict[str, str]) -> tuple[list[str], dict[str, str]]:
    support_node_names: list[str] = []
    name_by_ref: dict[str, str] = {}
    if not isinstance(support_organization, dict):
        return support_node_names, name_by_ref
    raw_tree = support_organization.get("tree")
    if isinstance(raw_tree, list):
        raw_tree = raw_tree[0] if raw_tree else None
    if not isinstance(raw_tree, dict):
        return support_node_names, name_by_ref
    state = {"index": 0}
    support_organization["tree"] = _normalize_support_organization_node(
        raw_tree,
        fallback_name_by_ref,
        name_by_ref,
        support_node_names,
        state,
        is_root=True,
    )
    return support_node_names, name_by_ref


def _normalize_support_organization_node(
    node: dict[str, Any],
    fallback_name_by_ref: dict[str, str],
    name_by_ref: dict[str, str],
    support_node_names: list[str],
    state: dict[str, int],
    *,
    is_root: bool,
) -> dict[str, Any]:
    node_id = _clean_text(node.get("id"))
    name = _clean_text(node.get("name") or fallback_name_by_ref.get(node_id) or node.get("id") or ("保障组织" if is_root else "保障点"))
    normalized: dict[str, Any] = {
        "id": node_id or ("support-org-root" if is_root else f"support-org-node-{state['index'] + 1}"),
        "name": name,
    }
    description = _clean_text(node.get("description"))
    if description:
        normalized["description"] = description
    for ref in (node.get("id"), node.get("name"), node.get("supportNodeId"), node.get("code"), node.get("sourceId")):
        key = _clean_text(ref)
        if key:
            name_by_ref[key] = name
    if not is_root:
        state["index"] += 1
        if name not in support_node_names:
            support_node_names.append(name)
    children = [
        _normalize_support_organization_node(
            child,
            fallback_name_by_ref,
            name_by_ref,
            support_node_names,
            state,
            is_root=False,
        )
        for child in node.get("children", [])
        if isinstance(child, dict)
    ]
    normalized["children"] = children
    return normalized


def _normalize_support_resource_refs(project: dict[str, Any], name_by_ref: dict[str, str]) -> None:
    support_resources = project.get("supportResources")
    if not isinstance(support_resources, list):
        return
    for resource in support_resources:
        if not isinstance(resource, dict):
            continue
        resource["supportNodeName"] = _support_node_name_for_ref(
            resource.get("supportNodeName") or resource.get("supportNodeId") or resource.get("organizationNodeId"),
            name_by_ref,
        )
        resource.pop("supportNodeId", None)
        resource.pop("organizationNodeId", None)


def _support_node_names_from_support_nodes(support_nodes: Any) -> list[str]:
    names: list[str] = []
    if not isinstance(support_nodes, list):
        return names
    for node in support_nodes:
        if not isinstance(node, dict) or _is_legacy_support_resource_row(node):
            continue
        name = _clean_text(node.get("name") or node.get("supportNodeName") or node.get("id"))
        if name and name not in names:
            names.append(name)
    return names


def _is_legacy_support_resource_row(node: dict[str, Any]) -> bool:
    node_id = str(node.get("id") or "")
    return bool(
        node.get("importedResourceType")
        or node.get("organizationNodeId")
        or re.search(r"(^|[-_])(personnel|equipment|spare|stock)([-_]|$)", node_id, re.IGNORECASE)
    )


def _normalize_top_level_transport_policies(project: dict[str, Any], name_by_ref: dict[str, str]) -> None:
    transport_policies = project.get("transportPolicies")
    if not isinstance(transport_policies, list):
        return
    normalized_policies: list[dict[str, Any]] = []
    for index, policy in enumerate(transport_policies):
        if not isinstance(policy, dict):
            continue
        normalized: dict[str, Any] = {
            "id": _clean_text(policy.get("id")) or f"transport-policy-{index + 1}",
            "fromSupportNodeName": _support_node_name_for_ref(policy.get("fromSupportNodeName") or policy.get("from"), name_by_ref),
            "toSupportNodeName": _support_node_name_for_ref(policy.get("toSupportNodeName") or policy.get("to"), name_by_ref),
            "spareName": _clean_text(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type")),
        }
        for field in ("name", "direction", "triggerMode", "criticalInventory", "transferCycleHours", "capacity", "priority", "transportMode", "transportTimeHours"):
            if field in policy:
                normalized[field] = policy[field]
        if "direction" in normalized and "transportMode" not in normalized:
            normalized["transportMode"] = normalized["direction"]
        normalized_policies.append(normalized)
    project["transportPolicies"] = normalized_policies


def _normalize_support_node_refs_in_project(project: dict[str, Any], name_by_ref: dict[str, str]) -> None:
    airports = project.get("airports")
    if isinstance(airports, list):
        for airport in airports:
            if isinstance(airport, dict) and "supportNodeId" in airport:
                airport["supportNodeId"] = _support_node_name_for_ref(airport.get("supportNodeId"), name_by_ref)
    for activity in project.get("supportActivities", []) if isinstance(project.get("supportActivities"), list) else []:
        _normalize_support_activity_refs(activity, name_by_ref)


def _normalize_support_activity_refs(value: Any, name_by_ref: dict[str, str]) -> None:
    if isinstance(value, list):
        for item in value:
            _normalize_support_activity_refs(item, name_by_ref)
        return
    if not isinstance(value, dict):
        return
    for field in ("supportNodeId", "resourceId"):
        if field in value:
            value[field] = _support_node_name_for_ref(value.get(field), name_by_ref)
    if isinstance(value.get("lateralSupportNodes"), list):
        value["lateralSupportNodes"] = [_support_node_name_for_ref(ref, name_by_ref) for ref in value["lateralSupportNodes"]]
    for child in value.values():
        _normalize_support_activity_refs(child, name_by_ref)


def _support_node_name_for_ref(value: Any, name_by_ref: dict[str, str]) -> str:
    text = _clean_text(value)
    return name_by_ref.get(text, text)


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _non_negative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return int(number)


def _strip_legacy_support_node_resource_fields(project: dict[str, Any]) -> None:
    support_nodes = project.get("supportNodes")
    if not isinstance(support_nodes, list):
        return
    legacy_fields = {
        "capacity",
        "equipmentCapacity",
        "inventory",
        "lateralSupportNodes",
        "nodeType",
        "organizationStrategy",
        "personnelCapacity",
        "policy",
        "supportLevel",
        "transportPolicies",
        "organizationNodeId",
        "importedResourceType",
        "personnelModel",
        "personnelType",
        "supportEquipmentName",
        "supportEquipmentModel",
        "equipmentName",
        "spareModels",
        "spareEquipment",
    }
    for node in support_nodes:
        if not isinstance(node, dict):
            continue
        for field in legacy_fields:
            node.pop(field, None)


def _strip_modeling_import_validation_non_model_fields(project: dict[str, Any]) -> None:
    validation = project.get("modelingImportValidation")
    if isinstance(validation, dict):
        validation.pop("validationLevel", None)


def _strip_support_resource_non_model_fields(project: dict[str, Any]) -> None:
    resources = project.get("supportResources")
    if not isinstance(resources, list):
        return
    for resource in resources:
        if not isinstance(resource, dict):
            continue
        resource.pop("equipment", None)
        resource.pop("equipmentId", None)


def _strip_typo_only_support_activity_fields(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("requireDevices", None)
        for child in value.values():
            _strip_typo_only_support_activity_fields(child)
    elif isinstance(value, list):
        for item in value:
            _strip_typo_only_support_activity_fields(item)


def _strip_deprecated_support_activity_strategy_fields(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        activity.pop("transportStrategies", None)
        activity.pop("organizationStrategies", None)


def _strip_support_activity_rule_ui_fields(value: Any) -> None:
    if not isinstance(value, list):
        return
    for activity in value:
        if not isinstance(activity, dict):
            continue
        for field in _SUPPORT_ACTIVITY_RULE_UI_FIELDS:
            activity.pop(field, None)


def _strip_support_activity_spare_type_fields(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _strip_support_activity_spare_type_fields(item)
        return
    if not isinstance(value, dict):
        return
    value.pop("spareType", None)
    for child in value.values():
        _strip_support_activity_spare_type_fields(child)


def _normalize_support_activity_reference_fields(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        if activity.get("activityName") in (None, ""):
            activity["activityName"] = str(activity.get("name") or activity.get("id") or "保障活动")
        activity["planType"] = _canonical_support_activity_plan_type(activity)
        for field in ("name", "planGroupId", "resourceId", "supportNodeId", "requiredDevices", "requiredPersonnel"):
            activity.pop(field, None)


def _canonical_support_activity_plan_type(activity: dict[str, Any]) -> str:
    plan_type = str(activity.get("planType") or "").strip()
    activity_type = str(activity.get("activityType") or "").strip()
    combined = f"{plan_type} {activity_type}".lower()
    if plan_type == "修复性维修方案" or "修复性维修" in combined or "corrective" in combined:
        return "修复性维修方案"
    if plan_type == "预防性维修方案" or "预防性维修" in combined or "preventive" in combined:
        return "预防性维修方案"
    if plan_type in {"后勤保障方案", "后勤保障活动方案"} or "后勤保障" in combined or "logistics" in combined:
        return "后勤保障方案"
    if plan_type in {"使用保障方案", "直接准备方案", "再次出动准备方案", "飞行后检查方案"}:
        return "使用保障方案"
    if any(token in combined for token in ("飞行前保障", "使用保障", "operations", "preflight", "relaunch", "postflight")):
        return "使用保障方案"
    return "使用保障方案"


def _strip_support_activity_mttr_fields(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _strip_support_activity_mttr_fields(item)
        return
    if not isinstance(value, dict):
        return
    for field in _SUPPORT_ACTIVITY_MTTR_FIELDS:
        value.pop(field, None)
    jobs = value.get("jobs")
    if isinstance(jobs, list):
        for job in jobs:
            if isinstance(job, dict):
                for field in _SUPPORT_ACTIVITY_MTTR_FIELDS:
                    job.pop(field, None)


def _lift_support_activity_jobs_to_top_level(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return
    jobs_by_code: dict[str, dict[str, Any]] = {}
    for job in project.get("supportActivityJobs") if isinstance(project.get("supportActivityJobs"), list) else []:
        if not isinstance(job, dict):
            continue
        code = _clean_text(job.get("activityCode"))
        if not code or code in jobs_by_code:
            continue
        jobs_by_code[code] = _support_activity_job_definition(job)
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        if not isinstance(activity.get("jobs"), list):
            continue
        jobs = [job for job in activity.get("jobs") if isinstance(job, dict)]
        if not jobs:
            activity.setdefault("activityCodes", [])
            activity.setdefault("predecessors", {})
            activity.pop("jobs", None)
            continue
        activity_codes: list[str] = []
        code_assignments: list[tuple[dict[str, Any], str, str]] = []
        local_code_map: dict[str, str] = {}
        predecessors: dict[str, list[str]] = {}
        for job in jobs:
            requested_code = _clean_text(job.get("activityCode"))
            if not requested_code:
                continue
            definition = _support_activity_job_definition(job)
            code = _support_activity_job_code_for_definition(requested_code, definition, jobs_by_code)
            definition["activityCode"] = code
            activity_codes.append(code)
            code_assignments.append((job, requested_code, code))
            local_code_map.setdefault(requested_code, code)
            jobs_by_code.setdefault(code, definition)
        activity_code_set = set(activity_codes)
        for job, _requested_code, code in code_assignments:
            raw_predecessors = job.get("predecessors")
            predecessors[code] = [
                mapped
                for predecessor in raw_predecessors
                if (mapped := local_code_map.get(_clean_text(predecessor), _clean_text(predecessor)))
                and mapped in activity_code_set
            ] if isinstance(raw_predecessors, list) else []
        activity["activityCodes"] = activity_codes
        activity["predecessors"] = predecessors
        activity.pop("jobs", None)
    project["supportActivityJobs"] = list(jobs_by_code.values())


def _materialize_support_activity_job_applicability(project: dict[str, Any]) -> None:
    jobs = project.get("supportActivityJobs")
    activities = project.get("supportActivities")
    if not isinstance(jobs, list) or not isinstance(activities, list):
        return
    jobs_by_code = {
        _clean_text(job.get("activityCode")): job
        for job in jobs
        if isinstance(job, dict) and _clean_text(job.get("activityCode"))
    }
    components_by_id = {
        _clean_text(component.get("id")): component
        for component in project.get("components", [])
        if isinstance(component, dict) and _clean_text(component.get("id"))
    }
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        component = components_by_id.get(_clean_text(activity.get("equipmentId")), {})
        aircraft_model = (
            _clean_text(activity.get("aircraftModel"))
            or _clean_text(activity.get("equipmentType"))
            or _clean_text(component.get("aircraftModel"))
        )
        if not aircraft_model or not isinstance(activity.get("activityCodes"), list):
            continue
        for raw_code in activity["activityCodes"]:
            job = jobs_by_code.get(_clean_text(raw_code))
            if not isinstance(job, dict) or "applicableAircraft" in job:
                continue
            job["applicableAircraft"] = aircraft_model


def _support_activity_job_code_for_definition(
    requested_code: str,
    definition: dict[str, Any],
    jobs_by_code: dict[str, dict[str, Any]],
) -> str:
    existing = jobs_by_code.get(requested_code)
    if existing is None or existing == definition:
        return requested_code
    return _unique_support_activity_job_code(requested_code, set(jobs_by_code))


def _unique_support_activity_job_code(requested_code: str, used_codes: set[str]) -> str:
    if requested_code not in used_codes:
        return requested_code
    match = re.match(r"^(.*?)(?:-(\d+))?$", requested_code)
    prefix = (match.group(1) if match else requested_code).rstrip("-") or "BA"
    index = int(match.group(2)) if match and match.group(2) else 2
    code = f"{prefix}-{index:03d}"
    while code in used_codes:
        index += 1
        code = f"{prefix}-{index:03d}"
    return code


def _support_activity_job_definition(job: dict[str, Any]) -> dict[str, Any]:
    definition = deepcopy(job)
    definition.pop("predecessors", None)
    for field in _SUPPORT_ACTIVITY_MTTR_FIELDS:
        definition.pop(field, None)
    _normalize_support_activity_job_resource_fields(definition)
    return definition


def _normalize_support_activity_job_resource_fields(job: dict[str, Any]) -> None:
    for field in ("personnel", "equipment", "spare", "ammunition"):
        if field in job and not isinstance(job[field], list):
            job.pop(field, None)


def _strip_pollution_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key in list(value):
            if _is_pollution_key(key):
                value.pop(key, None)
                continue
            _strip_pollution_keys(value[key])
    elif isinstance(value, list):
        for item in value:
            _strip_pollution_keys(item)


def _prune_clean_project(project: dict[str, Any]) -> None:
    _keep_fields(project, _ROOT_CLEAN_PROJECT_FIELDS)
    _prune_airports(project.get("airports"))
    if isinstance(project.get("missionProfile"), dict):
        _prune_mission_profile(project["missionProfile"])
    _prune_open_model_list(project.get("basicMissions"))
    if isinstance(project.get("combatUnit"), dict):
        _prune_combat_unit(project["combatUnit"])
    _prune_components(project.get("components"))
    _prune_typed_list(project.get("supportNodes"), _SUPPORT_NODE_FIELDS)
    _prune_typed_list(project.get("supportResources"), _SUPPORT_RESOURCE_FIELDS)
    _prune_typed_list(project.get("transportPolicies"), _TRANSPORT_POLICY_FIELDS)
    _prune_support_activity_jobs(project.get("supportActivityJobs"))
    _prune_support_activities(project.get("supportActivities"))
    if isinstance(project.get("supportOrganization"), dict):
        _prune_support_organization(project["supportOrganization"])
    if isinstance(project.get("modelingImportValidation"), dict):
        _keep_fields(project["modelingImportValidation"], _MODELING_IMPORT_VALIDATION_FIELDS)


def _keep_fields(value: dict[str, Any], allowed_fields: set[str]) -> None:
    for key in list(value):
        if key not in allowed_fields:
            value.pop(key, None)


def _prune_airports(value: Any) -> None:
    if not isinstance(value, list):
        return
    for item in value:
        if isinstance(item, dict):
            _keep_fields(item, _AIRPORT_FIELDS)


def _prune_open_model_list(value: Any) -> None:
    if not isinstance(value, list):
        return
    for item in value:
        _strip_pollution_keys(item)


def _prune_mission_profile(value: dict[str, Any]) -> None:
    _keep_fields(value, _MISSION_PROFILE_FIELDS)
    if isinstance(value.get("combatUnit"), dict):
        _prune_combat_unit(value["combatUnit"])
    _prune_composite_tasks(value.get("compositeTasks"))
    _prune_periodic_tasks(value.get("periodicTasks"))


def _prune_composite_tasks(value: Any) -> None:
    if not isinstance(value, list):
        return
    for composite in value:
        if not isinstance(composite, dict):
            continue
        _strip_pollution_keys(composite)
        task_items = composite.get("taskItems")
        if not isinstance(task_items, list):
            continue
        for item in task_items:
            if isinstance(item, dict):
                _keep_fields(item, _MISSION_PROFILE_TASK_ITEM_FIELD_SET)


def _prune_periodic_tasks(value: Any) -> None:
    if not isinstance(value, list):
        return
    for periodic in value:
        if not isinstance(periodic, dict):
            continue
        _keep_fields(periodic, _MISSION_PROFILE_PERIODIC_TASK_FIELD_SET)
        composite_tasks = periodic.get("compositeTasks")
        if isinstance(composite_tasks, list):
            for composite in composite_tasks:
                if isinstance(composite, dict):
                    _keep_fields(composite, _MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELD_SET)


def _prune_combat_unit(value: dict[str, Any]) -> None:
    _keep_fields(value, _COMBAT_UNIT_FIELDS)
    members = value.get("members")
    if not isinstance(members, list):
        return
    for member in members:
        if isinstance(member, dict):
            _keep_fields(member, _COMBAT_UNIT_MEMBER_FIELDS)


def _prune_components(value: Any) -> None:
    if not isinstance(value, list):
        return
    for component in value:
        if not isinstance(component, dict):
            continue
        _keep_fields(component, _COMPONENT_FIELDS)
        profile = component.get("specialRepairProfile")
        if isinstance(profile, dict):
            _keep_fields(profile, _SPECIAL_REPAIR_PROFILE_FIELDS)
            if not profile:
                component.pop("specialRepairProfile", None)


def _prune_typed_list(value: Any, allowed_fields: set[str]) -> None:
    if not isinstance(value, list):
        return
    for item in value:
        if isinstance(item, dict):
            _keep_fields(item, allowed_fields)


def _prune_support_activities(value: Any) -> None:
    if not isinstance(value, list):
        return
    for activity in value:
        if not isinstance(activity, dict):
            continue
        if activity.get("activityName") in (None, ""):
            activity["activityName"] = str(activity.get("name") or activity.get("id") or "保障活动")
        activity["planType"] = _canonical_support_activity_plan_type(activity)
        _keep_fields(activity, _SUPPORT_ACTIVITY_FIELDS)


def _prune_support_activity_jobs(value: Any) -> None:
    if not isinstance(value, list):
        return
    for job in value:
        if not isinstance(job, dict):
            continue
        for field in _SUPPORT_ACTIVITY_JOB_FORBIDDEN_FIELDS:
            job.pop(field, None)
        _normalize_support_activity_job_resource_fields(job)


def _prune_support_organization(value: dict[str, Any]) -> None:
    _keep_fields(value, {"tree"})
    tree = value.get("tree")
    if isinstance(tree, dict):
        _prune_support_organization_node(tree)
    elif isinstance(tree, list):
        for node in tree:
            if isinstance(node, dict):
                _prune_support_organization_node(node)


def _prune_support_organization_node(value: dict[str, Any]) -> None:
    _keep_fields(value, {"id", "name", "description", "children"})
    children = value.get("children")
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            _prune_support_organization_node(child)


def _drop_none_values(value: Any) -> None:
    if isinstance(value, dict):
        for key in list(value):
            if value[key] is None:
                value.pop(key, None)
                continue
            _drop_none_values(value[key])
    elif isinstance(value, list):
        for item in value:
            _drop_none_values(item)


def _is_pollution_key(key: Any) -> bool:
    if key in _POLLUTION_KEYS:
        return True
    if not isinstance(key, str):
        return False
    return bool(_FRONTEND_POLLUTION_TOKENS & set(_field_name_tokens(key)))


def _field_name_tokens(key: str) -> list[str]:
    tokens: list[str] = []
    for part in re.sub(r"[^0-9A-Za-z]+", " ", key).split():
        tokens.extend(match.group(0).lower() for match in re.finditer(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|\d+", part))
    return tokens


def _collect_project_runtime_config_paths(value: Any, path: str, paths: list[str]) -> None:
    if isinstance(value, dict):
        if "monteCarlo" in value:
            paths.append(_join_path(path, "monteCarlo"))
        if "seedPolicy" in value:
            paths.append(_join_path(path, "seedPolicy"))
        if "scenarioComposition" in value:
            paths.append(_join_path(path, "scenarioComposition"))
        if "stopPolicy" in value:
            paths.append(_join_path(path, "stopPolicy"))
        analysis_requests = value.get("analysisRequests")
        if isinstance(analysis_requests, dict) and (not path or _analysis_requests_has_sweep(analysis_requests)):
            paths.append(_join_path(path, "analysisRequests"))
        for key, child in value.items():
            _collect_project_runtime_config_paths(child, _join_path(path, str(key)), paths)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _collect_project_runtime_config_paths(item, f"{path}[{index}]" if path else f"[{index}]", paths)


def _join_path(prefix: str, key: str) -> str:
    return f"{prefix}.{key}" if prefix else key


def _analysis_requests_has_sweep(value: dict[str, Any]) -> bool:
    large_sample = value.get("largeSample")
    return isinstance(large_sample, dict) and "sweep" in large_sample
