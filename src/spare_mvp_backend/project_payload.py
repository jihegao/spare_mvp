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
    "validationReports",
    "verificationResult",
    "rmsAllocationPlan",
    "missionExposure",
    "exposureMatrix",
    "rmsNodeResult",
    "simulationRun",
    "resultSummary",
    "artifactManifest",
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
    "missionAreas",
    "missionProfile",
    "basicMissions",
    "missionPhases",
    "combatUnit",
    "components",
    "supportNodes",
    "supportResources",
    "transportPolicies",
    "supportActivities",
    "supportOrganization",
    "reliabilityBlockDiagram",
    "modelingImportValidation",
}
_REQUIRED_CLEAN_PROJECT_FIELDS = {
    "scenarioId",
    "activeModule",
    "airports",
    "missionAreas",
    "missionProfile",
    "basicMissions",
    "missionPhases",
    "combatUnit",
    "components",
    "supportNodes",
    "supportActivities",
    "reliabilityBlockDiagram",
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
    "deploymentLocation",
}
_COMPONENT_FIELDS = {
    "id",
    "name",
    "parentId",
    "aircraftModel",
    "productType",
    "quantity",
    "failureRate",
    "failureDistribution",
    "kOutOfN",
    "lifeLimitHours",
    "mtbfHours",
    "rms",
    "spareType",
    "specialRepairProfile",
}
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
    "fromSupportNodeName",
    "from",
    "toSupportNodeName",
    "to",
    "spareName",
    "spareType",
    "spare_type",
    "capacity",
    "priority",
    "transportMode",
    "transportTimeHours",
    "transport_time_hours",
}
_SUPPORT_ACTIVITY_FIELDS = {
    "id",
    "name",
    "activityName",
    "activityType",
    "planType",
    "equipmentId",
    "resourceId",
    "priority",
    "durationMinutes",
    "durationHours",
    "requiredPersonnel",
    "requiredDevices",
    "spareType",
    "spareQuantity",
    "calendarDayInterval",
    "runHourInterval",
    "takeoffLandingInterval",
    "floatRatio",
    "jobs",
    "transportStrategies",
    "organizationStrategies",
}
_RBD_FIELDS = {"nodes", "edges"}


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
            return
        if not hasattr(jsonschema, "Draft202012Validator"):
            _validate_clean_project_fallback(project, self.target)
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


def export_project_json(project_json: dict[str, Any], target: str = ACTIVE_CLEAN_PROJECT_TARGET) -> dict[str, Any]:
    return ProjectJsonExporter(target=target).export(project_json)


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
    for field in ("airports", "missionAreas", "basicMissions", "missionPhases", "supportNodes", "supportActivities"):
        _require_clean_list(project, field, target)
    _require_clean_dict(project, "missionProfile", target)
    _validate_clean_airports(project["airports"], target)
    _validate_clean_open_model_array(project["missionAreas"], "missionAreas", target)
    _validate_clean_mission_profile(project["missionProfile"], target)
    _validate_clean_basic_missions(project["basicMissions"], target)
    _validate_clean_open_model_array(project["missionPhases"], "missionPhases", target)
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
    if "supportOrganization" in project:
        _validate_clean_support_organization(project["supportOrganization"], target)
    _validate_clean_support_activities(project.get("supportActivities"), target)
    _validate_clean_rbd(project.get("reliabilityBlockDiagram"), target)
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
    if "combatUnit" in profile:
        if not isinstance(profile["combatUnit"], dict):
            raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.combatUnit: expected object")
        _validate_clean_combat_unit(profile["combatUnit"], target, path="missionProfile.combatUnit")
    for field in ("compositeTasks", "periodicTasks"):
        if field in profile:
            if not isinstance(profile[field], list):
                raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.{field}: expected array")
            _validate_clean_open_model_array(profile[field], f"missionProfile.{field}", target)


def _validate_clean_basic_missions(missions: list[Any], target: str) -> None:
    for index, mission in enumerate(missions):
        path = f"basicMissions.{index}"
        if not isinstance(mission, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        pollution = sorted(field for field in mission if _is_pollution_key(field))
        if pollution:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {pollution[0]}")
        for field in ("id", "name"):
            if field not in mission:
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
            _require_clean_string(mission, field, f"{path}.{field}", target)
        for field in ("missionId", "equipmentType"):
            _validate_optional_clean_string(mission, field, f"{path}.{field}", target)
        for field in ("minRequiredSorties", "equipmentQuantity", "requiredEquipmentQuantity"):
            _validate_optional_clean_integer(mission, field, f"{path}.{field}", target, minimum=0)
        _validate_optional_clean_integer(mission, "taskDurationMinutes", f"{path}.taskDurationMinutes", target, minimum=1)


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
        for field in ("id", "name", "quantity", "failureRate"):
            if field not in component:
                raise ValueError(f"clean Project JSON failed {target} schema at components.{index}.{field}: required")
        _require_clean_non_empty_string(component, "id", f"components.{index}.id", target)
        _require_clean_non_empty_string(component, "name", f"components.{index}.name", target)
        _require_clean_integer(component, "quantity", f"components.{index}.quantity", target, minimum=0)
        _require_clean_number(component, "failureRate", f"components.{index}.failureRate", target, minimum=0)
        extra = sorted(field for field in component if field not in _COMPONENT_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at components.{index}: unexpected field {extra[0]}")
        _validate_optional_clean_string(component, "parentId", f"components.{index}.parentId", target, nullable=True)
        for field in ("aircraftModel", "productType", "spareType"):
            _validate_optional_clean_string(component, field, f"components.{index}.{field}", target)
        for field in ("lifeLimitHours", "mtbfHours"):
            _validate_optional_clean_number(component, field, f"components.{index}.{field}", target, minimum=0, nullable=True)
        for field in ("failureDistribution", "kOutOfN", "specialRepairProfile"):
            _validate_optional_clean_dict(component, field, f"components.{index}.{field}", target)
        rms = component.get("rms")
        if isinstance(rms, dict):
            extra_rms = sorted(field for field in rms if field != "target")
            if extra_rms:
                raise ValueError(f"clean Project JSON failed {target} schema at components.{index}.rms: unexpected field {extra_rms[0]}")
            _validate_optional_clean_dict(rms, "target", f"components.{index}.rms.target", target)
        elif rms is not None:
            raise ValueError(f"clean Project JSON failed {target} schema at components.{index}.rms: expected object")


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
        for field in ("id", "fromSupportNodeName", "from", "toSupportNodeName", "to", "spareName", "spareType", "spare_type", "transportMode"):
            _validate_optional_clean_string(policy, field, f"{policy_path}.{field}", target)
        for field in ("capacity", "priority"):
            _validate_optional_clean_integer(policy, field, f"{policy_path}.{field}", target, minimum=0)
        for field in ("transportTimeHours", "transport_time_hours"):
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
        for field in ("name", "activityName", "activityType", "planType", "equipmentId", "resourceId", "spareType"):
            _validate_optional_clean_string(activity, field, f"supportActivities.{index}.{field}", target)
        for field in ("priority", "durationMinutes", "requiredPersonnel", "requiredDevices", "spareQuantity"):
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
        _validate_optional_clean_number(
            activity,
            "runHourInterval",
            f"supportActivities.{index}.runHourInterval",
            target,
            minimum=0,
            nullable=True,
        )
        _validate_optional_clean_number(activity, "floatRatio", f"supportActivities.{index}.floatRatio", target, nullable=True)
        for field in ("jobs", "transportStrategies", "organizationStrategies"):
            if field not in activity:
                continue
            path = f"supportActivities.{index}.{field}"
            if not isinstance(activity[field], list):
                raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected array")
            _validate_clean_open_model_array(activity[field], path, target)


def _validate_clean_rbd(value: Any, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at reliabilityBlockDiagram: expected object")
    extra = sorted(field for field in value if field not in _RBD_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at reliabilityBlockDiagram: unexpected field {extra[0]}")
    for field in ("nodes", "edges"):
        if not isinstance(value.get(field), list):
            raise ValueError(f"clean Project JSON failed {target} schema at reliabilityBlockDiagram.{field}: expected array")
        _validate_clean_open_model_array(value[field], f"reliabilityBlockDiagram.{field}", target)


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
    _strip_legacy_support_node_resource_fields(project)
    _normalize_project_component_k_out_of_n(project)
    mission_profile = project.get("missionProfile")
    if isinstance(mission_profile, dict):
        mission_profile.pop("profileType", None)
        mission_profile.pop("endCondition", None)
        mission_profile.pop("repeatCycleHours", None)
        mission_profile.pop("analysisRequests", None)
    _strip_typo_only_support_activity_fields(project)


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
        if policies:
            project["transportPolicies"] = policies


def _normalize_support_model_tables(project: dict[str, Any]) -> None:
    legacy_name_by_ref = _legacy_support_node_name_by_ref(project.get("supportNodes"))
    organization_names, organization_name_by_ref = _normalize_support_organization(project.get("supportOrganization"), legacy_name_by_ref)
    name_by_ref = {**legacy_name_by_ref, **organization_name_by_ref}
    _normalize_support_resource_refs(project, name_by_ref)
    support_node_names = organization_names or _support_node_names_from_support_nodes(project.get("supportNodes"))
    project["supportNodes"] = [
        {"id": f"support-node-{index + 1}", "name": name}
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
        for field in ("capacity", "priority", "transportMode", "transportTimeHours"):
            if field in policy:
                normalized[field] = policy[field]
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


def _strip_typo_only_support_activity_fields(value: Any) -> None:
    if isinstance(value, dict):
        value.pop("requireDevices", None)
        for child in value.values():
            _strip_typo_only_support_activity_fields(child)
    elif isinstance(value, list):
        for item in value:
            _strip_typo_only_support_activity_fields(item)


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
    _prune_open_model_list(project.get("missionAreas"))
    if isinstance(project.get("missionProfile"), dict):
        _prune_mission_profile(project["missionProfile"])
    _prune_open_model_list(project.get("basicMissions"))
    _prune_open_model_list(project.get("missionPhases"))
    if isinstance(project.get("combatUnit"), dict):
        _prune_combat_unit(project["combatUnit"])
    _prune_components(project.get("components"))
    _prune_typed_list(project.get("supportNodes"), _SUPPORT_NODE_FIELDS)
    _prune_typed_list(project.get("supportResources"), _SUPPORT_RESOURCE_FIELDS)
    _prune_typed_list(project.get("transportPolicies"), _TRANSPORT_POLICY_FIELDS)
    _prune_support_activities(project.get("supportActivities"))
    if isinstance(project.get("supportOrganization"), dict):
        _prune_support_organization(project["supportOrganization"])
    if isinstance(project.get("reliabilityBlockDiagram"), dict):
        _prune_reliability_block_diagram(project["reliabilityBlockDiagram"])


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
    _prune_open_model_list(value.get("compositeTasks"))
    _prune_open_model_list(value.get("periodicTasks"))


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
        rms = component.get("rms")
        if isinstance(rms, dict):
            _keep_fields(rms, {"target"})


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
        _keep_fields(activity, _SUPPORT_ACTIVITY_FIELDS)
        _prune_open_model_list(activity.get("jobs"))
        _prune_open_model_list(activity.get("transportStrategies"))
        _prune_open_model_list(activity.get("organizationStrategies"))


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


def _prune_reliability_block_diagram(value: dict[str, Any]) -> None:
    _keep_fields(value, _RBD_FIELDS)
    _prune_open_model_list(value.get("nodes"))
    _prune_open_model_list(value.get("edges"))


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
