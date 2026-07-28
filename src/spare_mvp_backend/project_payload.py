"""Helpers for normalizing persisted Project payloads."""

from __future__ import annotations

import json
import hashlib
import math
import re
from copy import deepcopy
from decimal import Decimal, InvalidOperation
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
    "products",
    "components",
    "reliabilityBlockDiagram",
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
    "products",
    "components",
    "supportNodes",
    "supportResources",
    "transportPolicies",
    "supportOrganization",
    "supportActivities",
}
_MODELING_IMPORT_VALIDATION_FIELDS = {"importId", "usedTables", "disabledDomains", "warnings"}
_AIRPORT_FIELDS = {"id", "name", "location", "supportNodeId"}
_MISSION_PROFILE_FIELDS = {
    "id",
    "profileId",
    "sourceImportId",
    "name",
    "durationDays",
    "combatUnit",
    "compositeTasks",
    "periodicProfileLists",
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
    "compositeTasks",
    "compositeTaskIds",
)
_MISSION_PROFILE_PERIODIC_TASK_FIELD_SET = set(_MISSION_PROFILE_PERIODIC_TASK_FIELDS)
_MISSION_PROFILE_PERIODIC_COMPOSITE_TASK_FIELDS = (
    "compositeTaskId",
    "weekday",
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
    "preLifeCalendarDays",
    "preLifeFlightHours",
    "preLifeTakeoffLandingCount",
}

_AIRCRAFT_PRE_LIFE_FIELDS = (
    ("preLifeCalendarDays", None, "integer"),
    ("preLifeFlightHours", None, "number"),
    ("preLifeTakeoffLandingCount", None, "integer"),
)
_PRODUCT_FIELDS = {
    "id",
    "name",
    "model",
    "kind",
    "mtbfHours",
    "meanRepairTimeMinutes",
    "failureDistribution",
    "repairDistribution",
}
_COMPONENT_FIELDS = {
    "id",
    "name",
    "productId",
    "parentId",
    "aircraftModel",
    "productType",
    "quantity",
    "failureDistribution",
    "repairDistribution",
    "kOutOfN",
    "specialRepairProfile",
}
_RELIABILITY_BLOCK_NODE_FIELDS = {
    "id",
    "name",
    "type",
    "parentId",
    "componentId",
    "aircraftModel",
    "connectionType",
    "relation",
    "logic",
    "gateType",
    "quantity",
    "k",
    "failureRate",
    "failureRateUnit",
    "mtbfHours",
    "mtbfUnit",
    "reliability",
    "reliabilityUnit",
    "failureDistribution",
    "kOutOfN",
}
_RELIABILITY_BLOCK_EDGE_FIELDS = {
    "from", "to", "source", "target", "type", "relation", "logic", "connectionType", "weight"
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
    "organizationNodeId",
    "type",
    "name",
    "model",
    "quantity",
    "capacity",
    "productId",
}
_TRANSPORT_POLICY_FIELDS = {
    "id",
    "name",
    "fromSupportNodeName",
    "from",
    "toSupportNodeName",
    "to",
    "productId",
    "direction",
    "triggerMode",
    "criticalInventory",
    "transferCycleHours",
    "capacity",
    "priority",
    "transportMode",
    "transportTimeHours",
    "transport_time_hours",
    "fromOrganizationNodeId",
    "toOrganizationNodeId",
}
_ORGANIZATION_NODE_FIELDS = {"id", "name", "description", "serviceScope", "children"}
_ORGANIZATION_RELATION_FIELDS = {
    "id",
    "type",
    "enabled",
    "fromOrganizationNodeId",
    "toOrganizationNodeId",
    "priority",
}
_SERVICE_SCOPE_FIELDS = {"airportIds", "aircraftModels", "productIds", "resourceTypes"}
_RESOURCE_TYPES = {"personnel", "equipment", "spare"}
_SUPPORT_ACTIVITY_FIELDS = {
    "id",
    "activityName",
    "activityType",
    "planType",
    "planGroupId",
    "aircraftModel",
    "equipmentId",
    "resourceId",
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
    "maintenanceMethods",
    "replacementRatio",
    "activityCodes",
    "predecessors",
}
_SUPPORT_ACTIVITY_PLAN_TYPES = {
    "使用保障方案",
    "直接准备方案",
    "再次出动准备方案",
    "飞行后检查方案",
    "修复性维修方案",
    "预防性维修方案",
    "后勤保障方案",
}
_MAINTENANCE_SUPPORT_ACTIVITY_PLAN_TYPES = {"修复性维修方案", "预防性维修方案"}
_MAINTENANCE_METHOD_VALUES = ("non_replacement", "replacement")
_LEGACY_REPAIR_TYPE_MIGRATIONS = {
    "原位维修": (["non_replacement"], 0.0),
    "换件维修": (["replacement"], 1.0),
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
_FAILURE_DISTRIBUTION_RATE_KEYS = ("rate", "lambda", "λ", "failure_rate")
_FAILURE_DISTRIBUTION_RATE_ALIASES = ("lambda", "λ", "failure_rate")
_FAILURE_DISTRIBUTION_REL_TOL = 1e-9
_FAILURE_DISTRIBUTION_ABS_TOL = 1e-12


class FailureDistributionContractError(ValueError):
    """Fail-closed Project reliability normalization error."""

    def __init__(self, issues: list[dict[str, Any]]) -> None:
        self.issues = deepcopy(issues)
        first = self.issues[0] if self.issues else {}
        super().__init__(str(first.get("message") or "invalid exponential failure distribution"))


class ProjectJsonExporter:
    """Export persisted Project JSON into a model-family clean Project boundary."""

    def __init__(self, target: str = ACTIVE_CLEAN_PROJECT_TARGET, repo_root: Path | str | None = None) -> None:
        self.target = str(target or "").strip()
        self.repo_root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
        if self.target != ACTIVE_CLEAN_PROJECT_TARGET:
            raise ValueError(f"unsupported clean Project JSON target: {target}")

    def export(self, project_json: dict[str, Any]) -> dict[str, Any]:
        project = normalize_project_products(strip_project_sweep(project_json))
        project, _failure_distribution_report = normalize_project_failure_distributions(project, strict=True)
        project, _pre_life_changes = normalize_aircraft_pre_life(project)
        project, _organization_changes = normalize_support_organization_contract(project)
        _strip_pollution_keys(project)
        _prune_clean_project(project)
        preserve_empty_organization_tree = (
            isinstance(project.get("supportOrganization"), dict)
            and "tree" in project["supportOrganization"]
            and project["supportOrganization"]["tree"] is None
        )
        _drop_none_values(project)
        if preserve_empty_organization_tree:
            project["supportOrganization"]["tree"] = None
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
            _validate_product_references(project, self.target)
            _validate_support_resource_identities(project, self.target)
            return
        if not hasattr(jsonschema, "Draft202012Validator"):
            _validate_clean_project_fallback(project, self.target)
            _validate_basic_mission_support_activity_names(project, self.target)
            _validate_basic_mission_phase_ids(project, self.target)
            _validate_clean_support_activity_references(project, self.target)
            _validate_product_references(project, self.target)
            _validate_support_resource_identities(project, self.target)
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
        _validate_product_references(project, self.target)
        _validate_support_resource_identities(project, self.target)


def export_project_json(project_json: dict[str, Any], target: str = ACTIVE_CLEAN_PROJECT_TARGET) -> dict[str, Any]:
    return ProjectJsonExporter(target=target).export(project_json)


class OrganizationContractError(ValueError):
    """A precise fail-closed organization contract error."""

    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(f"organization contract failed at {path}: {message}")
        self.code = code
        self.path = path
        self.message = message


def normalize_support_organization_contract(
    project_json: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Canonicalize support organization identity without changing runtime selection.

    Canonical Project data keeps a single nested tree as its authoring source,
    explicit lateral relations, stable organization links on support nodes and
    resources, and top-level transport policies with ID endpoints. Legacy names
    migrate only when they resolve uniquely.
    """

    project = deepcopy(project_json)
    changes: list[str] = []
    organization = project.get("supportOrganization")
    if organization in (None, {}):
        organization = {}
    if not isinstance(organization, dict):
        raise OrganizationContractError(
            "invalid_organization_contract", "supportOrganization", "expected object; supportOrganization must be an object"
        )
    runtime_mode = organization.get("runtimeMode")
    if runtime_mode not in (None, "legacy", "vertical", "vertical_lateral"):
        raise OrganizationContractError(
            "invalid_organization_runtime_mode",
            "supportOrganization.runtimeMode",
            "runtimeMode must be legacy, vertical, or vertical_lateral",
        )

    raw_tree = organization.get("tree")
    if isinstance(raw_tree, list):
        if len(raw_tree) != 1:
            raise OrganizationContractError(
                "multiple_organization_roots",
                "supportOrganization.tree",
                "legacy tree arrays must contain exactly one root",
            )
        raw_tree = raw_tree[0]
        changes.append("supportOrganization.tree[0]->supportOrganization.tree")
    if raw_tree in (None, {}):
        raw_tree = _organization_tree_from_support_nodes(project.get("supportNodes"))
        if raw_tree:
            changes.append("supportOrganization.tree=derivedSupportNodes")
            runtime_mode = "legacy"
    if raw_tree is None:
        if project.get("supportResources") or project.get("transportPolicies"):
            raise OrganizationContractError(
                "missing_organization_root",
                "supportOrganization.tree",
                "organization-scoped resources or policies require one organization root",
            )
        project["supportOrganization"] = {
            "runtimeMode": "legacy",
            "tree": None,
            "relations": [],
        }
        project["transportPolicies"] = []
        changes.append("supportOrganization=emptyGraph")
        return project, changes
    if not isinstance(raw_tree, dict):
        raise OrganizationContractError(
            "missing_organization_root", "supportOrganization.tree", "one canonical organization root is required"
        )

    nodes: list[dict[str, Any]] = []
    id_path: dict[str, str] = {}
    name_ids: dict[str, set[str]] = {}
    canonical_tree = _canonical_organization_tree(
        raw_tree,
        "supportOrganization.tree",
        nodes,
        id_path,
        name_ids,
        set(),
    )
    node_ids = set(id_path)
    for node in nodes:
        for field in node.get("_scope_defaults", []):
            changes.append(f"{node['_source_path']}.serviceScope.{field}=[](unrestricted)")
    _validate_organization_service_scope(nodes, project)
    aliases = _organization_aliases(nodes, project.get("supportNodes"), name_ids)
    runtime_node_ids = _canonicalize_support_node_ownership(
        project.get("supportNodes"),
        aliases,
        node_ids,
        changes,
    )

    relations = _canonical_lateral_relations(
        organization.get("relations"), aliases, node_ids, changes
    )
    if not relations:
        relations = _legacy_lateral_relations(project.get("supportNodes"), aliases, node_ids)
        if relations:
            changes.append("supportNodes[].lateralSupportNodes->supportOrganization.relations[]")
    _validate_lateral_relation_siblings(relations, canonical_tree)
    _validate_lateral_relation_dag(relations)

    policies = _canonical_top_level_transport_policies(project, aliases, node_ids, nodes, changes)
    _canonicalize_support_activity_ownership(project.get("supportActivities"), aliases, node_ids, changes)
    _validate_lateral_runtime_endpoints(
        relations,
        runtime_node_ids,
        runtime_mode=str(runtime_mode or "vertical"),
    )
    _canonicalize_support_resource_ownership(project.get("supportResources"), aliases, node_ids, nodes, changes)
    _validate_operational_support_node_mappings(
        project,
        relations,
        policies,
        runtime_node_ids,
        runtime_mode=str(runtime_mode or "vertical"),
    )
    _strip_legacy_support_node_relationships(project.get("supportNodes"))

    _strip_organization_internal_paths(canonical_tree)
    organization = {
        "runtimeMode": str(runtime_mode or "vertical"),
        "tree": canonical_tree,
        "relations": sorted(relations, key=lambda item: item["id"]),
    }
    if runtime_mode is None:
        changes.append("supportOrganization.runtimeMode=vertical")
    project["supportOrganization"] = organization
    project["transportPolicies"] = sorted(policies, key=lambda item: item["id"])
    return project, changes


def _organization_tree_from_support_nodes(value: Any) -> dict[str, Any] | None:
    support_nodes = [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
    if not support_nodes:
        return None
    children = []
    for index, node in enumerate(support_nodes):
        node_id = _clean_text(node.get("organizationNodeId") or node.get("id"))
        if not node_id:
            raise OrganizationContractError(
                "missing_organization_node_id", f"supportNodes[{index}].id", "stable organization node ID is required"
            )
        child: dict[str, Any] = {"id": node_id, "name": _clean_text(node.get("name")) or node_id}
        airport_id = _clean_text(node.get("airportId") or node.get("baseAirportId"))
        if airport_id:
            child["serviceScope"] = {"airportIds": [airport_id]}
        children.append(child)
    if len(children) == 1:
        return children[0]
    return {"id": "support-organization-root", "name": "保障组织", "children": children}


def _canonical_service_scope(value: Any, path: str) -> dict[str, list[str]]:
    if value in (None, {}):
        return {field: [] for field in sorted(_SERVICE_SCOPE_FIELDS)}
    if not isinstance(value, dict):
        raise OrganizationContractError("invalid_service_scope", path, "serviceScope must be an object")
    extra = sorted(set(value) - _SERVICE_SCOPE_FIELDS)
    if extra:
        raise OrganizationContractError(
            "invalid_service_scope", f"{path}.{extra[0]}", "unknown service scope field"
        )
    result: dict[str, list[str]] = {}
    for field in sorted(_SERVICE_SCOPE_FIELDS):
        raw_values = value.get(field, [])
        if not isinstance(raw_values, list):
            raise OrganizationContractError(
                "invalid_service_scope", f"{path}.{field}", "service scope dimension must be an array"
            )
        values = sorted({_clean_text(item) for item in raw_values if _clean_text(item)})
        if field == "resourceTypes" and any(item not in _RESOURCE_TYPES for item in values):
            raise OrganizationContractError(
                "invalid_service_scope", f"{path}.{field}", "resourceTypes contains an unsupported value"
            )
        result[field] = values
    return result


def _validate_organization_service_scope(nodes: list[dict[str, Any]], project: dict[str, Any]) -> None:
    airport_ids: set[str] = set()
    if isinstance(project.get("airports"), list):
        airport_ids = set()
        for item in project["airports"]:
            if isinstance(item, dict):
                for value in (item.get("id"), item.get("name")):
                    if _clean_text(value):
                        airport_ids.add(_clean_text(value))
            elif _clean_text(item):
                airport_ids.add(_clean_text(item))
    models = {
        _clean_text(item.get("aircraftModel"))
        for item in project.get("components", []) if isinstance(item, dict) and _clean_text(item.get("aircraftModel"))
    }
    combat_unit = project.get("combatUnit") if isinstance(project.get("combatUnit"), dict) else {}
    models.update(
        _clean_text(item.get("model"))
        for item in combat_unit.get("members", []) if isinstance(item, dict) and _clean_text(item.get("model"))
    )
    product_ids = {
        _clean_text(item.get("id"))
        for item in project.get("products", []) if isinstance(item, dict) and _clean_text(item.get("id"))
    }
    known = {
        "airportIds": airport_ids,
        "aircraftModels": models,
        "productIds": product_ids,
    }
    for node_index, node in enumerate(nodes):
        scope = node["serviceScope"]
        source_path = str(node.get("_source_path") or "supportOrganization.tree")
        for field, known_values in known.items():
            for value_index, value in enumerate(scope[field]):
                if value not in known_values:
                    raise OrganizationContractError(
                        "unknown_organization_service_scope_reference",
                        f"{source_path}.serviceScope.{field}[{value_index}]",
                        f"organization node {node['id']} service scope references unknown {field} value {value}",
                    )


def _canonical_organization_tree(
    raw: dict[str, Any],
    path: str,
    nodes: list[dict[str, Any]],
    id_path: dict[str, str],
    name_ids: dict[str, set[str]],
    visiting: set[int],
) -> dict[str, Any]:
    marker = id(raw)
    if marker in visiting:
        raise OrganizationContractError(
            "circular_organization_parent", path, "organization children contain a parent cycle"
        )
    visiting.add(marker)
    node_id = _clean_text(raw.get("id"))
    if not node_id:
        raise OrganizationContractError(
            "missing_organization_node_id", f"{path}.id", "stable organization node ID is required"
        )
    if node_id in id_path:
        raise OrganizationContractError(
            "duplicate_organization_node_id", f"{path}.id", f"organization node ID {node_id} duplicates {id_path[node_id]}"
        )
    id_path[node_id] = f"{path}.id"
    name = _clean_text(raw.get("name")) or node_id
    name_ids.setdefault(name, set()).add(node_id)
    node: dict[str, Any] = {
        "id": node_id,
        "name": name,
        "serviceScope": _canonical_service_scope(raw.get("serviceScope"), f"{path}.serviceScope"),
        "_source_path": path,
        "_scope_defaults": [
            field
            for field in sorted(_SERVICE_SCOPE_FIELDS)
            if not isinstance(raw.get("serviceScope"), dict) or field not in raw["serviceScope"]
        ],
    }
    description = _clean_text(raw.get("description"))
    if description:
        node["description"] = description
    children = raw.get("children", [])
    if children is None:
        children = []
    if not isinstance(children, list):
        raise OrganizationContractError(
            "invalid_organization_children", f"{path}.children", "children must be an array"
        )
    node["children"] = [
        _canonical_organization_tree(child, f"{path}.children[{index}]", nodes, id_path, name_ids, visiting)
        if isinstance(child, dict)
        else _raise_organization_child(f"{path}.children[{index}]")
        for index, child in enumerate(children)
    ]
    nodes.append(node)
    visiting.remove(marker)
    return node


def _strip_organization_internal_paths(node: Any) -> None:
    if not isinstance(node, dict):
        return
    node.pop("_source_path", None)
    node.pop("_scope_defaults", None)
    for child in node.get("children", []) if isinstance(node.get("children"), list) else []:
        _strip_organization_internal_paths(child)


def _raise_organization_child(path: str) -> dict[str, Any]:
    raise OrganizationContractError("invalid_organization_node", path, "organization child must be an object")


def _organization_aliases(
    nodes: list[dict[str, Any]], support_nodes: Any, name_ids: dict[str, set[str]]
) -> dict[str, str]:
    candidates: dict[str, set[str]] = {node["id"]: {node["id"]} for node in nodes}
    for name, ids in name_ids.items():
        candidates.setdefault(name, set()).update(ids)
    for support_node in support_nodes if isinstance(support_nodes, list) else []:
        if not isinstance(support_node, dict):
            continue
        explicit = _clean_text(support_node.get("organizationNodeId"))
        node_id = explicit if explicit in candidates and len(candidates[explicit]) == 1 else ""
        if not node_id:
            for ref in (_clean_text(support_node.get("id")), _clean_text(support_node.get("name"))):
                matches = candidates.get(ref, set())
                if len(matches) == 1:
                    node_id = next(iter(matches))
                    break
        if node_id:
            for field in ("id", "name", "supportNodeName", "organizationNodeId"):
                ref = _clean_text(support_node.get(field))
                if ref:
                    candidates.setdefault(ref, set()).add(node_id)
    return {ref: next(iter(ids)) for ref, ids in candidates.items() if len(ids) == 1}


def _resolve_organization_ref(
    value: Any, aliases: dict[str, str], node_ids: set[str], path: str, code: str
) -> str:
    ref = _clean_text(value)
    if ref in node_ids:
        return ref
    if ref in aliases:
        return aliases[ref]
    raise OrganizationContractError(
        code,
        path,
        f"{'unknown support organization; ' if 'organization' in code else ''}organization reference {ref or '<empty>'} does not resolve to one stable node ID",
    )


def _canonical_lateral_relations(
    value: Any,
    aliases: dict[str, str],
    node_ids: set[str],
    changes: list[str],
) -> list[dict[str, Any]]:
    if value in (None, []):
        return []
    if not isinstance(value, list):
        raise OrganizationContractError(
            "invalid_organization_relations", "supportOrganization.relations", "relations must be an array"
        )
    result: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for index, raw in enumerate(value):
        path = f"supportOrganization.relations[{index}]"
        if not isinstance(raw, dict):
            raise OrganizationContractError("invalid_organization_relation", path, "relation must be an object")
        relation_id = _clean_text(raw.get("id"))
        if not relation_id:
            raise OrganizationContractError(
                "missing_organization_relation_id", f"{path}.id", "stable lateral relation ID is required"
            )
        if relation_id in seen:
            raise OrganizationContractError(
                "duplicate_organization_relation_id", f"{path}.id", f"relation ID {relation_id} duplicates relations[{seen[relation_id]}]"
            )
        seen[relation_id] = index
        if _clean_text(raw.get("type")) != "lateral":
            raise OrganizationContractError(
                "invalid_organization_relation_type", f"{path}.type", "explicit relations must use type=lateral"
            )
        source = _resolve_organization_ref(
            raw.get("fromOrganizationNodeId"), aliases, node_ids, f"{path}.fromOrganizationNodeId", "missing_organization_relation_endpoint"
        )
        target = _resolve_organization_ref(
            raw.get("toOrganizationNodeId"), aliases, node_ids, f"{path}.toOrganizationNodeId", "missing_organization_relation_endpoint"
        )
        enabled = raw.get("enabled", True)
        if not isinstance(enabled, bool):
            raise OrganizationContractError(
                "invalid_organization_relation_enabled",
                f"{path}.enabled",
                "lateral relation enabled must be a boolean",
            )
        if "enabled" not in raw:
            changes.append(f"{path}.enabled=true")
        result.append({
            "id": relation_id,
            "type": "lateral",
            "enabled": enabled,
            "fromOrganizationNodeId": source,
            "toOrganizationNodeId": target,
            "priority": _positive_int(raw.get("priority"), 1),
        })
    return result


def _legacy_lateral_relations(value: Any, aliases: dict[str, str], node_ids: set[str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for node_index, node in enumerate(value if isinstance(value, list) else []):
        if not isinstance(node, dict) or not isinstance(node.get("lateralSupportNodes"), list):
            continue
        source = _resolve_organization_ref(
            node.get("organizationNodeId") or node.get("id") or node.get("name"),
            aliases,
            node_ids,
            f"supportNodes[{node_index}].organizationNodeId",
            "missing_organization_relation_endpoint",
        )
        for relation_index, target_ref in enumerate(node["lateralSupportNodes"]):
            target = _resolve_organization_ref(
                target_ref,
                aliases,
                node_ids,
                f"supportNodes[{node_index}].lateralSupportNodes[{relation_index}]",
                "missing_organization_relation_endpoint",
            )
            result.append({
                "id": f"migrated-lateral-{source}-{target}",
                "type": "lateral",
                "enabled": True,
                "fromOrganizationNodeId": source,
                "toOrganizationNodeId": target,
                "priority": relation_index + 1,
            })
    return result


def _validate_lateral_relation_dag(relations: list[dict[str, Any]]) -> None:
    graph: dict[str, list[tuple[str, int]]] = {}
    seen_edges: set[tuple[str, str]] = set()
    for index, relation in enumerate(relations):
        edge = (relation["fromOrganizationNodeId"], relation["toOrganizationNodeId"])
        if edge in seen_edges:
            raise OrganizationContractError(
                "duplicate_lateral_relation",
                f"supportOrganization.relations[{index}].toOrganizationNodeId",
                "lateral relation endpoint pair is duplicated",
            )
        seen_edges.add(edge)
        graph.setdefault(edge[0], []).append((edge[1], index))
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visited:
            return
        visiting.add(node_id)
        for target, index in graph.get(node_id, []):
            if target in visiting:
                raise OrganizationContractError(
                    "circular_lateral_relation",
                    f"supportOrganization.relations[{index}].toOrganizationNodeId",
                    "lateral relation graph must be acyclic",
                )
            visit(target)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in sorted(graph):
        visit(node_id)


def _validate_lateral_relation_siblings(
    relations: list[dict[str, Any]],
    tree: dict[str, Any],
) -> None:
    parent_by_id: dict[str, str | None] = {}

    def visit(node: dict[str, Any], parent_id: str | None) -> None:
        node_id = str(node.get("id") or "")
        parent_by_id[node_id] = parent_id
        for child in node.get("children", []):
            if isinstance(child, dict):
                visit(child, node_id)

    visit(tree, None)
    for index, relation in enumerate(relations):
        source = relation["fromOrganizationNodeId"]
        target = relation["toOrganizationNodeId"]
        if parent_by_id.get(source) != parent_by_id.get(target):
            raise OrganizationContractError(
                "non_sibling_lateral_relation",
                f"supportOrganization.relations[{index}].toOrganizationNodeId",
                "lateral relation endpoints must be sibling organizations with the same parent",
            )


def _canonicalize_support_node_ownership(
    value: Any,
    aliases: dict[str, str],
    node_ids: set[str],
    changes: list[str],
) -> set[str]:
    runtime_node_ids: set[str] = set()
    legacy_ids: dict[str, int] = {}
    for index, node in enumerate(value if isinstance(value, list) else []):
        if not isinstance(node, dict):
            continue
        path = f"supportNodes[{index}]"
        legacy_id = _clean_text(node.get("id"))
        if legacy_id:
            if legacy_id in legacy_ids:
                raise OrganizationContractError(
                    "duplicate_support_node_id",
                    f"{path}.id",
                    f"support node ID {legacy_id} duplicates supportNodes[{legacy_ids[legacy_id]}].id",
                )
            legacy_ids[legacy_id] = index

        resolved_fields: list[tuple[str, str]] = []
        explicit_ref = _clean_text(node.get("organizationNodeId"))
        if explicit_ref:
            resolved_fields.append((
                "organizationNodeId",
                _resolve_organization_ref(
                    explicit_ref,
                    aliases,
                    node_ids,
                    f"{path}.organizationNodeId",
                    "unknown_support_node_organization",
                ),
            ))

        if legacy_id in node_ids or legacy_id in aliases:
            resolved_fields.append((
                "id",
                _resolve_organization_ref(
                    legacy_id,
                    aliases,
                    node_ids,
                    f"{path}.id",
                    "unknown_support_node_organization",
                ),
            ))

        if not resolved_fields:
            for field in ("name", "supportNodeName"):
                ref = _clean_text(node.get(field))
                if not ref:
                    continue
                if ref not in node_ids and ref not in aliases:
                    continue
                resolved_fields.append((
                    field,
                    _resolve_organization_ref(
                        ref,
                        aliases,
                        node_ids,
                        f"{path}.{field}",
                        "unknown_support_node_organization",
                    ),
                ))
                break

        resolved = {organization_id for _field, organization_id in resolved_fields}
        if len(resolved) != 1:
            conflict_field = next(
                (
                    field
                    for field, organization_id in resolved_fields[1:]
                    if organization_id != resolved_fields[0][1]
                ),
                "organizationNodeId" if explicit_ref else "id",
            )
            raise OrganizationContractError(
                "conflicting_support_node_organization" if len(resolved) > 1 else "unknown_support_node_organization",
                f"{path}.{conflict_field}",
                "support node must link to exactly one organization node",
            )
        canonical_id = next(iter(resolved))
        if canonical_id in runtime_node_ids:
            raise OrganizationContractError(
                "duplicate_support_node_organization",
                f"{path}.id",
                f"organization node {canonical_id} already maps to another runtime support node",
            )
        runtime_node_ids.add(canonical_id)
        if legacy_id != canonical_id:
            changes.append(f"{path}.id={canonical_id}(migratedOrganizationNodeId)")
        if "organizationNodeId" in node:
            changes.append(f"{path}.organizationNodeId->id")
        node["id"] = canonical_id
        node.pop("organizationNodeId", None)
    return runtime_node_ids


def _strip_legacy_support_node_relationships(value: Any) -> None:
    for node in value if isinstance(value, list) else []:
        if not isinstance(node, dict):
            continue
        node.pop("lateralSupportNodes", None)
        node.pop("transportPolicies", None)


def _validate_lateral_runtime_endpoints(
    relations: list[dict[str, Any]],
    runtime_node_ids: set[str],
    *,
    runtime_mode: str,
) -> None:
    if runtime_mode != "vertical_lateral":
        return
    for index, relation in enumerate(relations):
        for field in ("fromOrganizationNodeId", "toOrganizationNodeId"):
            organization_id = relation[field]
            if organization_id not in runtime_node_ids:
                raise OrganizationContractError(
                    "unreachable_lateral_relation_endpoint",
                    f"supportOrganization.relations[{index}].{field}",
                    f"vertical_lateral relation endpoint {organization_id} must map to exactly one runtime support node; found 0",
                )


def _canonicalize_support_activity_ownership(
    value: Any,
    aliases: dict[str, str],
    node_ids: set[str],
    changes: list[str],
) -> None:
    for index, activity in enumerate(value if isinstance(value, list) else []):
        if not isinstance(activity, dict):
            continue
        ref = _clean_text(activity.get("resourceId"))
        if not ref:
            continue
        canonical_id = _resolve_organization_ref(
            ref,
            aliases,
            node_ids,
            f"supportActivities[{index}].resourceId",
            "unknown_support_activity_organization",
        )
        if canonical_id != ref:
            changes.append(f"supportActivities[{index}].resourceId={canonical_id}(migratedOrganizationAlias)")
        activity["resourceId"] = canonical_id


def _validate_operational_support_node_mappings(
    project: dict[str, Any],
    relations: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    runtime_node_ids: set[str],
    *,
    runtime_mode: str,
) -> None:
    refs: list[tuple[str, str]] = []
    for index, activity in enumerate(project.get("supportActivities", []) if isinstance(project.get("supportActivities"), list) else []):
        if isinstance(activity, dict) and _clean_text(activity.get("resourceId")):
            refs.append((f"supportActivities[{index}].resourceId", _clean_text(activity.get("resourceId"))))
    for index, resource in enumerate(project.get("supportResources", []) if isinstance(project.get("supportResources"), list) else []):
        if isinstance(resource, dict) and _clean_text(resource.get("organizationNodeId")):
            refs.append((
                f"supportResources[{index}].organizationNodeId",
                _clean_text(resource.get("organizationNodeId")),
            ))
    for index, policy in enumerate(policies):
        for field in ("fromOrganizationNodeId", "toOrganizationNodeId"):
            refs.append((f"transportPolicies[{index}].{field}", _clean_text(policy.get(field))))
    if runtime_mode == "vertical_lateral":
        for index, relation in enumerate(relations):
            for field in ("fromOrganizationNodeId", "toOrganizationNodeId"):
                refs.append((
                    f"supportOrganization.relations[{index}].{field}",
                    _clean_text(relation.get(field)),
                ))
    for path, organization_id in refs:
        if organization_id and organization_id not in runtime_node_ids:
            raise OrganizationContractError(
                "missing_runtime_support_node_mapping",
                path,
                f"operational organization node {organization_id} must map to exactly one supportNodes[] row; found 0",
            )


def _canonicalize_support_resource_ownership(
    value: Any,
    aliases: dict[str, str],
    node_ids: set[str],
    nodes: list[dict[str, Any]],
    changes: list[str],
) -> None:
    owners_by_id: dict[str, tuple[str, int]] = {}
    node_by_id = {node["id"]: node for node in nodes}
    for index, resource in enumerate(value if isinstance(value, list) else []):
        if not isinstance(resource, dict):
            continue
        resource_id = _clean_text(resource.get("id"))
        if not resource_id:
            raise OrganizationContractError(
                "missing_support_resource_id",
                f"supportResources[{index}].id",
                "support resource id must be a non-empty stable identifier",
            )
        if resource_id in owners_by_id:
            raise OrganizationContractError(
                "duplicate_support_resource_id",
                f"supportResources[{index}].id",
                f"support resource ID {resource_id} duplicates supportResources[{owners_by_id[resource_id][1]}].id",
            )
        had_explicit_owner = bool(_clean_text(resource.get("organizationNodeId")))
        refs = [
            (field, resource.get(field))
            for field in ("organizationNodeId", "organizationNodeName", "supportNodeName")
            if _clean_text(resource.get(field))
        ]
        owner = ""
        for field, ref in refs:
            if owner and field in {"organizationNodeName", "supportNodeName"}:
                ref_text = _clean_text(ref)
                if ref_text not in node_ids and ref_text not in aliases:
                    continue
            resolved = _resolve_organization_ref(
                ref,
                aliases,
                node_ids,
                f"supportResources[{index}].{field}",
                "unknown_support_resource_organization",
            )
            if owner and resolved != owner:
                raise OrganizationContractError(
                    "multiple_resource_ownership",
                    f"supportResources[{index}].{field}",
                    "resource ownership aliases resolve to different organization nodes",
                )
            owner = resolved
        if not owner:
            raise OrganizationContractError(
                "missing_resource_ownership",
                f"supportResources[{index}].organizationNodeId",
                "personnel, equipment, and spare resources must each have exactly one organization owner",
            )
        resource_type = _clean_text(resource.get("type")).lower()
        allowed_types = node_by_id[owner]["serviceScope"]["resourceTypes"]
        if allowed_types and resource_type not in allowed_types:
            raise OrganizationContractError(
                "resource_owner_scope_conflict",
                f"supportResources[{index}].type",
                f"resource type {resource_type or '<empty>'} is outside owner {owner} service scope",
            )
        product_id = _clean_text(resource.get("productId"))
        allowed_products = node_by_id[owner]["serviceScope"]["productIds"]
        if resource_type == "spare" and product_id and allowed_products and product_id not in allowed_products:
            raise OrganizationContractError(
                "resource_owner_scope_conflict",
                f"supportResources[{index}].productId",
                f"resource product {product_id} is outside owner {owner} service scope",
            )
        resource["organizationNodeId"] = owner
        if not had_explicit_owner:
            changes.append(f"supportResources[{index}].organizationNodeId=migratedUniqueAlias")
        owners_by_id[resource_id] = (owner, index)


def _canonical_top_level_transport_policies(
    project: dict[str, Any],
    aliases: dict[str, str],
    node_ids: set[str],
    nodes: list[dict[str, Any]],
    changes: list[str],
) -> list[dict[str, Any]]:
    top = project.get("transportPolicies")
    node_scoped = [
        (node_index, policy_index, policy)
        for node_index, node in enumerate(project.get("supportNodes", []) if isinstance(project.get("supportNodes"), list) else [])
        if isinstance(node, dict)
        for policy_index, policy in enumerate(node.get("transportPolicies", []) if isinstance(node.get("transportPolicies"), list) else [])
        if isinstance(policy, dict)
    ]
    if isinstance(top, list) and top and node_scoped:
        raise OrganizationContractError(
            "conflicting_transport_policy_sources",
            f"supportNodes[{node_scoped[0][0]}].transportPolicies",
            "node-scoped legacy policies cannot coexist with canonical top-level transportPolicies",
        )
    sources = [
        (f"transportPolicies[{index}]", policy, None)
        for index, policy in enumerate(top if isinstance(top, list) else [])
        if isinstance(policy, dict)
    ]
    if not sources and node_scoped:
        sources = [
            (
                f"supportNodes[{node_index}].transportPolicies[{policy_index}]",
                policy,
                (project["supportNodes"][node_index].get("organizationNodeId")
                 or project["supportNodes"][node_index].get("id")
                 or project["supportNodes"][node_index].get("name")),
            )
            for node_index, policy_index, policy in node_scoped
        ]
        changes.append("supportNodes[].transportPolicies[]->transportPolicies[]")
    node_by_id = {node["id"]: node for node in nodes}
    result: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    for index, (path, raw, host_ref) in enumerate(sources):
        from_verbose = raw.get("fromOrganizationNodeId")
        to_verbose = raw.get("toOrganizationNodeId")
        source_ref = from_verbose or raw.get("fromSupportNodeName") or raw.get("from") or host_ref
        target_ref = to_verbose or raw.get("toSupportNodeName") or raw.get("to")
        route_fields = (
            "fromOrganizationNodeId", "fromSupportNodeName", "from",
            "toOrganizationNodeId", "toSupportNodeName", "to",
        )
        business_fields = (
            "productId", "capacity", "priority", "transportTimeHours", "transport_time_hours",
            "transferCycleHours", "criticalInventory", "triggerMode", "transportMode", "direction", "name",
        )
        if not any(raw.get(field) not in (None, "", [], {}) for field in (*route_fields, *business_fields)):
            changes.append(f"{path}=droppedLegacyEmptyDraft")
            continue
        source = _resolve_organization_ref(
            source_ref, aliases, node_ids, f"{path}.fromOrganizationNodeId", "missing_transport_policy_endpoint"
        )
        target = _resolve_organization_ref(
            target_ref, aliases, node_ids, f"{path}.toOrganizationNodeId", "missing_transport_policy_endpoint"
        )
        if source == target:
            raise OrganizationContractError(
                "self_transport_policy",
                f"{path}.toOrganizationNodeId",
                "transport policy endpoints must be different organization nodes",
            )
        if host_ref not in (None, ""):
            host = _resolve_organization_ref(
                host_ref,
                aliases,
                node_ids,
                f"{path}.fromOrganizationNodeId",
                "missing_transport_policy_endpoint",
            )
            if source != host:
                conflict_field = "fromOrganizationNodeId" if _clean_text(from_verbose) else (
                    "fromSupportNodeName" if _clean_text(raw.get("fromSupportNodeName")) else "from"
                )
                raise OrganizationContractError(
                    "conflicting_transport_policy_host",
                    f"{path}.{conflict_field}",
                    "node-scoped transport policy source conflicts with its host support node",
                )
            if not any(_clean_text(raw.get(field)) for field in ("fromOrganizationNodeId", "fromSupportNodeName", "from")):
                changes.append(f"{path}.fromOrganizationNodeId=migratedHostOrganizationNodeId")
        for legacy_field, legacy_ref, canonical in (
            ("fromSupportNodeName", raw.get("fromSupportNodeName"), source),
            ("from", raw.get("from"), source),
            ("toSupportNodeName", raw.get("toSupportNodeName"), target),
            ("to", raw.get("to"), target),
        ):
            if _clean_text(legacy_ref):
                legacy_resolved = _resolve_organization_ref(
                    legacy_ref,
                    aliases,
                    node_ids,
                    f"{path}.{legacy_field}",
                    "missing_transport_policy_endpoint",
                )
                if legacy_resolved != canonical:
                    raise OrganizationContractError(
                        "conflicting_transport_policy_endpoint",
                        f"{path}.{legacy_field}",
                        "canonical endpoint conflicts with legacy endpoint reference",
                    )
        for verbose_field, verbose_ref, resolved in (
            ("fromOrganizationNodeId", from_verbose, source),
            ("toOrganizationNodeId", to_verbose, target),
        ):
            if _clean_text(verbose_ref) and _resolve_organization_ref(
                verbose_ref, aliases, node_ids, f"{path}.{verbose_field}", "missing_transport_policy_endpoint"
            ) != resolved:
                raise OrganizationContractError(
                    "conflicting_transport_policy_endpoint", f"{path}.{verbose_field}", "canonical endpoint conflicts with legacy endpoint reference"
                )
        if not _clean_text(from_verbose):
            changes.append(f"{path}.fromOrganizationNodeId=migratedUniqueAlias")
        if not _clean_text(to_verbose):
            changes.append(f"{path}.toOrganizationNodeId=migratedUniqueAlias")
        product_id = _clean_text(raw.get("productId"))
        for endpoint in (source, target):
            allowed_products = node_by_id[endpoint]["serviceScope"]["productIds"]
            if product_id and allowed_products and product_id not in allowed_products:
                raise OrganizationContractError(
                    "transport_policy_scope_conflict", f"{path}.productId", f"productId is outside organization node {endpoint} service scope"
                )
        policy_id = _clean_text(raw.get("id"))
        if not policy_id:
            identity = {
                "fromOrganizationNodeId": source,
                "toOrganizationNodeId": target,
                "productId": product_id,
                "capacity": raw.get("capacity"),
                "priority": raw.get("priority"),
                "transportTimeHours": raw.get("transportTimeHours", raw.get("transport_time_hours")),
            }
            digest = hashlib.sha256(
                json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()[:12]
            policy_id = f"migrated-transport-{digest}"
            changes.append(f"{path}.id=stableContentHash")
        if policy_id in seen:
            raise OrganizationContractError(
                "duplicate_transport_policy_id", f"{path}.id", f"transport policy ID {policy_id} duplicates {seen[policy_id]}"
            )
        seen[policy_id] = path
        item: dict[str, Any] = {
            "id": policy_id,
            "fromOrganizationNodeId": source,
            "toOrganizationNodeId": target,
        }
        for field in ("name", "productId", "direction", "triggerMode", "criticalInventory", "transferCycleHours", "capacity", "priority", "transportMode", "transportTimeHours", "transport_time_hours"):
            if raw.get(field) not in (None, ""):
                item[field] = deepcopy(raw[field])
        result.append(item)
    return result


def normalize_project_products(project_json: dict[str, Any]) -> dict[str, Any]:
    """Migrate legacy spare labels to deterministic Product references."""

    project = deepcopy(project_json)
    components = [item for item in project.get("components", []) if isinstance(item, dict)]
    resources = [item for item in project.get("supportResources", []) if isinstance(item, dict)]
    policies = [item for item in project.get("transportPolicies", []) if isinstance(item, dict)]
    for node in project.get("supportNodes", []) if isinstance(project.get("supportNodes"), list) else []:
        if isinstance(node, dict) and isinstance(node.get("transportPolicies"), list):
            policies.extend(item for item in node["transportPolicies"] if isinstance(item, dict))

    products = [deepcopy(item) for item in project.get("products", []) if isinstance(item, dict)]
    products_by_id = {
        _clean_text(product.get("id")): product
        for product in products
        if _clean_text(product.get("id"))
    }
    component_by_id = {
        _clean_text(component.get("id")): component
        for component in components
        if _clean_text(component.get("id"))
    }
    components_by_identity: dict[str, list[dict[str, Any]]] = {}
    for component in components:
        for identity in (_clean_text(component.get("id")), _clean_text(component.get("name"))):
            if identity:
                components_by_identity.setdefault(identity.casefold(), []).append(component)

    for component in components:
        legacy_product_name = _clean_text(component.get("spareType") or component.get("spare_type"))
        component.pop("spareType", None)
        component.pop("spare_type", None)
        product_id = _clean_text(component.get("productId"))
        if not product_id:
            seed = _clean_text(component.get("id")) or _clean_text(component.get("name")) or "component"
            product_id = _unique_migrated_product_id(seed, products_by_id, component)
            component["productId"] = product_id
        if product_id not in products_by_id:
            component_name = _clean_text(component.get("name")) or _clean_text(component.get("id")) or product_id
            product = {"id": product_id, "name": legacy_product_name or component_name, "model": component_name}
            kind = _clean_text(component.get("productType"))
            if kind:
                product["kind"] = kind
            products.append(product)
            products_by_id[product_id] = product

    for resource in resources:
        if _clean_text(resource.get("type")).casefold() != "spare":
            continue
        legacy_labels = _legacy_product_labels(resource)
        product_id = _clean_text(resource.get("productId"))
        component = _legacy_resource_component(resource, component_by_id, components_by_identity)
        if not product_id and component is not None:
            product_id = _clean_text(component.get("productId"))
        if not product_id:
            product_id = _product_id_for_labels(legacy_labels, products_by_id)
        if not product_id:
            seed = _clean_text(resource.get("id")) or next(iter(legacy_labels), "spare")
            product_id = _unique_migrated_product_id(seed, products_by_id, resource)
        resource["productId"] = product_id
        if product_id not in products_by_id:
            name = _clean_text(resource.get("name")) or next(iter(legacy_labels), "") or _clean_text(resource.get("id")) or product_id
            product = {"id": product_id, "name": name, "kind": "spare"}
            model = _clean_text(resource.get("model"))
            if model:
                product["model"] = model
            products.append(product)
            products_by_id[product_id] = product
        for field in ("spareName", "spareType", "spare_type"):
            resource.pop(field, None)

    for policy in policies:
        legacy_labels = [
            label
            for field in ("spareName", "spareType", "spare_type")
            for label in [_clean_text(policy.get(field))]
            if label
        ]
        product_id = _clean_text(policy.get("productId")) or _product_id_for_labels(legacy_labels, products_by_id)
        if not product_id and legacy_labels:
            seed = _clean_text(policy.get("id")) or next(iter(legacy_labels), "transport-spare")
            product_id = _unique_migrated_product_id(seed, products_by_id, policy)
        if product_id:
            policy["productId"] = product_id
        if product_id and product_id not in products_by_id:
            name = next(iter(legacy_labels), "") or product_id
            product = {"id": product_id, "name": name, "kind": "spare"}
            products.append(product)
            products_by_id[product_id] = product
        for field in ("spareName", "spareType", "spare_type"):
            policy.pop(field, None)

    for job in project.get("supportActivityJobs", []) if isinstance(project.get("supportActivityJobs"), list) else []:
        if not isinstance(job, dict) or not isinstance(job.get("spare"), list):
            continue
        for spare_index, requirement in enumerate(job["spare"]):
            if not isinstance(requirement, dict):
                continue
            labels = _legacy_product_labels(requirement)
            product_id = _clean_text(requirement.get("productId")) or _product_id_for_labels(labels, products_by_id)
            if not product_id:
                seed = f"{_clean_text(job.get('activityCode')) or 'job'}-{spare_index + 1}-{next(iter(labels), 'spare')}"
                product_id = _unique_migrated_product_id(seed, products_by_id, requirement)
            requirement["productId"] = product_id
            if product_id not in products_by_id:
                name = _clean_text(requirement.get("name")) or next(iter(labels), "") or product_id
                product = {"id": product_id, "name": name, "kind": "spare"}
                model = _clean_text(requirement.get("model"))
                if model:
                    product["model"] = model
                products.append(product)
                products_by_id[product_id] = product
            for field in ("spareName", "spareType", "spare_type"):
                requirement.pop(field, None)

    project["products"] = products
    return project


def _legacy_product_labels(value: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for field in ("model", "name", "spareName", "spareType", "spare_type"):
        label = _clean_text(value.get(field))
        if label and label not in labels:
            labels.append(label)
    return labels


def _legacy_resource_component(
    resource: dict[str, Any],
    component_by_id: dict[str, dict[str, Any]],
    components_by_identity: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    model = _clean_text(resource.get("model"))
    if model and model in component_by_id:
        return component_by_id[model]
    for label in _legacy_product_labels(resource):
        matches = components_by_identity.get(label.casefold(), [])
        if len(matches) == 1:
            return matches[0]
    return None


def _product_id_for_labels(labels: list[str], products_by_id: dict[str, dict[str, Any]]) -> str:
    for label in labels:
        matches = [
            product_id
            for product_id, product in products_by_id.items()
            if label in {product_id, _clean_text(product.get("name")), _clean_text(product.get("model"))}
        ]
        if len(matches) == 1:
            return matches[0]
    return ""


def _unique_migrated_product_id(
    seed: str,
    products_by_id: dict[str, dict[str, Any]],
    owner: dict[str, Any],
) -> str:
    token = re.sub(r"[^\w.-]+", "-", seed.strip().casefold(), flags=re.UNICODE).strip("-._") or "item"
    candidate = f"product-{token}"
    if candidate not in products_by_id:
        return candidate
    fingerprint = json.dumps(owner, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    suffix = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:8]
    candidate = f"product-{token}-{suffix}"
    index = 2
    while candidate in products_by_id:
        candidate = f"product-{token}-{suffix}-{index}"
        index += 1
    return candidate


def normalize_project_basic_mission_support_activity_names(project_json: dict[str, Any]) -> dict[str, Any]:
    """Migrate unambiguous legacy support-activity display-name references.

    ``basicMissions[].supportActivityName`` is formally a reference to
    ``supportActivities[].activityName``.  Older saved projects instead used
    the activity's former ``name`` field.  Preserve the formal relationship
    when it is already valid, and only rewrite a legacy reference when both
    the old-name source and the canonical target are unique.
    """

    project = normalize_project_equipment_tree_integrity(project_json)
    _normalize_basic_mission_support_activity_names(project)
    return project


def normalize_project_equipment_tree_integrity(project_json: dict[str, Any]) -> dict[str, Any]:
    """Repair unambiguous legacy equipment-tree references and distributions."""

    project = deepcopy(project_json)
    components = project.get("components")
    if not isinstance(components, list):
        components = []
        project["components"] = components
    component_ids = {
        _clean_text(component.get("id"))
        for component in components
        if isinstance(component, dict) and _clean_text(component.get("id"))
    }
    needs_root = any(
        isinstance(component, dict) and _clean_text(component.get("parentId")) == "aircraft-root"
        for component in components
    )
    if needs_root and "aircraft-root" not in component_ids:
        aircraft_model = _project_primary_aircraft_model(project)
        quantity = _project_aircraft_quantity(project)
        components.append({
            "id": "aircraft-root",
            "name": f"{aircraft_model}（整机）" if aircraft_model else "整机",
            "productId": "product-aircraft-root",
            "aircraftModel": aircraft_model,
            "productType": "whole",
            "quantity": quantity,
            "kOutOfN": {"enabled": quantity > 1, "n": quantity, "k": quantity},
        })
        component_ids.add("aircraft-root")

    for owner in [
        *(project.get("products") if isinstance(project.get("products"), list) else []),
        *components,
    ]:
        if isinstance(owner, dict):
            _normalize_legacy_failure_distribution_type(owner.get("failureDistribution"))

    resolved_ids = {
        _clean_text(component.get("id"))
        for component in components
        if isinstance(component, dict) and _clean_text(component.get("id"))
    }
    if "aircraft-root" in resolved_ids:
        for activity in project.get("supportActivities", []) if isinstance(project.get("supportActivities"), list) else []:
            if not isinstance(activity, dict):
                continue
            equipment_id = _clean_text(activity.get("equipmentId"))
            activity_name = _clean_text(activity.get("activityName") or activity.get("name"))
            if equipment_id and equipment_id not in resolved_ids and re.search(r"整机|舰载机", activity_name):
                activity["equipmentId"] = "aircraft-root"

    if "aircraft-root" in resolved_ids:
        products = project.get("products")
        if not isinstance(products, list):
            products = []
            project["products"] = products
        if not any(
            isinstance(product, dict) and _clean_text(product.get("id")) == "product-aircraft-root"
            for product in products
        ):
            root = next(
                component
                for component in components
                if isinstance(component, dict) and _clean_text(component.get("id")) == "aircraft-root"
            )
            products.append({
                "id": "product-aircraft-root",
                "name": _clean_text(root.get("name")) or "整机",
                "model": _clean_text(root.get("aircraftModel")) or "aircraft-root",
                "kind": "whole",
            })
    project, _failure_distribution_report = normalize_project_failure_distributions(project, strict=False)
    return project


def _project_primary_aircraft_model(project: dict[str, Any]) -> str:
    equipment = project.get("equipment") if isinstance(project.get("equipment"), dict) else {}
    aircraft_types = equipment.get("aircraftTypes") if isinstance(equipment.get("aircraftTypes"), list) else []
    for aircraft_type in aircraft_types:
        if isinstance(aircraft_type, str) and _clean_text(aircraft_type):
            return _clean_text(aircraft_type)
        if isinstance(aircraft_type, dict):
            model = _clean_text(aircraft_type.get("model") or aircraft_type.get("name") or aircraft_type.get("id"))
            if model:
                return model
    whole_models = equipment.get("wholeMachineModels") if isinstance(equipment.get("wholeMachineModels"), list) else []
    for model in whole_models:
        if _clean_text(model):
            return _clean_text(model)
    return _clean_text(equipment.get("model"))


def _project_aircraft_quantity(project: dict[str, Any]) -> int:
    equipment = project.get("equipment") if isinstance(project.get("equipment"), dict) else {}
    try:
        quantity = int(equipment.get("quantity"))
    except (TypeError, ValueError):
        quantity = 0
    if quantity > 0:
        return quantity
    combat_unit = project.get("combatUnit") if isinstance(project.get("combatUnit"), dict) else {}
    members = combat_unit.get("members") if isinstance(combat_unit.get("members"), list) else []
    return max(1, len(members))


def _normalize_legacy_failure_distribution_type(distribution: Any) -> None:
    if not isinstance(distribution, dict):
        return
    parameters = _clean_text(distribution.get("parameters") or distribution.get("params")).casefold()
    distribution_type = _clean_text(
        distribution.get("distributionType") or distribution.get("distribution_type")
    ).casefold()
    if not parameters or not distribution_type:
        return
    has_rate = re.search(r"(?:^|[,，;；\s])(lambda|λ|rate|failure_rate)\s*=", parameters) is not None
    has_mean = re.search(r"(?:^|[,，;；\s])(mean|mu)\s*=", parameters) is not None
    if ("exponential" in distribution_type or "指数" in distribution_type) and has_mean and not has_rate:
        distribution["distributionType"] = "正态分布" if "指数" in distribution_type else "normal"
    elif ("normal" in distribution_type or "正态" in distribution_type) and has_rate:
        distribution["distributionType"] = "指数分布" if "正态" in distribution_type else "exponential"


def project_failure_distribution_errors(project_json: dict[str, Any]) -> list[dict[str, Any]]:
    """Return fail-closed exponential-distribution issues without mutating Project JSON."""

    try:
        normalize_project_failure_distributions(project_json, strict=True)
    except FailureDistributionContractError as exc:
        return deepcopy(exc.issues)
    return []


def normalize_project_failure_distributions(
    project_json: dict[str, Any],
    *,
    strict: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Canonicalize Project exponential rates and synchronize exact Product references.

    ``failureDistribution.rate`` remains the sole behavior-driving Project
    representation.  MTBF hours are an editor projection and are therefore
    removed from exponential owners after reciprocal consistency is checked.
    """

    original = deepcopy(project_json)
    project = deepcopy(project_json)
    owners = _project_failure_distribution_owners(project)
    for owner in owners:
        _normalize_legacy_failure_distribution_type(owner["value"].get("failureDistribution"))

    issues: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    candidates: dict[tuple[str, int], dict[str, Any]] = {}
    rates: dict[tuple[str, int], float] = {}
    for owner in owners:
        value = owner["value"]
        distribution = value.get("failureDistribution")
        if not _is_exponential_failure_distribution(distribution):
            continue
        owner_path = owner["path"]
        sources, source_issues = _failure_distribution_rate_sources(
            value,
            distribution,
            f"{owner_path}.failureDistribution",
        )
        issues.extend(source_issues)
        if source_issues or not sources:
            continue
        reference_rate = sources[0]["rate"]
        if any(
            not math.isclose(
                source["rate"],
                reference_rate,
                rel_tol=_FAILURE_DISTRIBUTION_REL_TOL,
                abs_tol=_FAILURE_DISTRIBUTION_ABS_TOL,
            )
            for source in sources[1:]
        ):
            issues.append({
                "code": "conflicting_exponential_failure_rate_sources",
                "path": f"{owner_path}.failureDistribution",
                "field_path": f"{owner_path}.failureDistribution",
                "message": "指数分布包含互相冲突的故障率或 MTBF 来源，无法安全迁移。",
                "sources": deepcopy(sources),
            })
            continue
        key = (owner["kind"], owner["index"])
        raw_distribution_type = _clean_text(
            distribution.get("distributionType")
            or distribution.get("distribution_type")
        )
        canonical = {
            "distributionType": (
                "指数分布"
                if "指数" in raw_distribution_type
                else "exponential"
            ),
            "rate": reference_rate,
        }
        candidates[key] = canonical
        rates[key] = reference_rate
        records.append({
            "owner_type": owner["kind"],
            "owner_id": _clean_text(value.get("id")),
            "product_id": _clean_text(value.get("id") if owner["kind"] == "product" else value.get("productId")),
            "path": f"{owner_path}.failureDistribution",
            "sources": deepcopy(sources),
            "rate": reference_rate,
            "mtbf_hours": 1.0 / reference_rate,
            "status": "canonical" if distribution == canonical and "mtbfHours" not in value else "convert",
        })

    products = {
        _clean_text(owner["value"].get("id")): owner
        for owner in owners
        if owner["kind"] == "product" and _clean_text(owner["value"].get("id"))
    }
    components_by_product: dict[str, list[dict[str, Any]]] = {}
    for owner in owners:
        if owner["kind"] != "component":
            continue
        product_id = _clean_text(owner["value"].get("productId"))
        if product_id:
            components_by_product.setdefault(product_id, []).append(owner)

    synchronized_groups: list[dict[str, Any]] = []
    for product_id, component_owners in components_by_product.items():
        product_owner = products.get(product_id)
        if product_owner is None:
            continue
        grouped_owners = [product_owner, *component_owners]
        grouped_rates = [
            (owner, rates[(owner["kind"], owner["index"])])
            for owner in grouped_owners
            if (owner["kind"], owner["index"]) in rates
        ]
        if not grouped_rates:
            continue
        reference_owner, reference_rate = grouped_rates[0]
        conflicting = [
            (owner, rate)
            for owner, rate in grouped_rates[1:]
            if not math.isclose(
                rate,
                reference_rate,
                rel_tol=_FAILURE_DISTRIBUTION_REL_TOL,
                abs_tol=_FAILURE_DISTRIBUTION_ABS_TOL,
            )
        ]
        incompatible = [
            owner
            for owner in grouped_owners
            if isinstance(owner["value"].get("failureDistribution"), dict)
            and owner["value"].get("failureDistribution")
            and not _is_exponential_failure_distribution(owner["value"].get("failureDistribution"))
        ]
        if conflicting or incompatible:
            for owner, rate in conflicting:
                issues.append({
                    "code": "conflicting_product_failure_distribution",
                    "path": f'{owner["path"]}.failureDistribution',
                    "field_path": f'{owner["path"]}.failureDistribution',
                    "message": (
                        f"同一产品 {product_id} 的指数分布故障率冲突："
                        f"期望 {reference_rate:g}，当前为 {rate:g}。"
                    ),
                    "product_id": product_id,
                })
            for owner in incompatible:
                issues.append({
                    "code": "conflicting_product_failure_distribution",
                    "path": f'{owner["path"]}.failureDistribution',
                    "field_path": f'{owner["path"]}.failureDistribution',
                    "message": f"同一产品 {product_id} 混用了指数分布与其他故障分布。",
                    "product_id": product_id,
                })
            continue

        reference_key = (reference_owner["kind"], reference_owner["index"])
        canonical_distribution = deepcopy(candidates[reference_key])
        for owner in grouped_owners:
            key = (owner["kind"], owner["index"])
            candidates[key] = deepcopy(canonical_distribution)
            rates[key] = reference_rate
        synchronized_groups.append({
            "product_id": product_id,
            "rate": reference_rate,
            "component_paths": [owner["path"] for owner in component_owners],
        })

    issue_paths = {
        issue.get("path") or issue.get("field_path")
        for issue in issues
    }
    for owner in owners:
        distribution = owner["value"].get("failureDistribution")
        key = (owner["kind"], owner["index"])
        path = f'{owner["path"]}.failureDistribution'
        if (
            _is_exponential_failure_distribution(distribution)
            and key not in candidates
            and not any(
                isinstance(issue_path, str) and issue_path.startswith(path)
                for issue_path in issue_paths
            )
        ):
            issues.append({
                "code": "missing_exponential_failure_rate",
                "path": path,
                "field_path": path,
                "message": "指数分布必须提供有限正数故障率，或可由同一产品的无冲突引用补全。",
            })

    report = {
        "schema_version": "issue-344-mtbf-migration-report-v1",
        "records": records,
        "synchronized_products": synchronized_groups,
        "issues": issues,
        "changed": False,
    }
    if issues:
        if strict:
            raise FailureDistributionContractError(issues)
        return original, report

    for owner in owners:
        key = (owner["kind"], owner["index"])
        if key not in candidates:
            continue
        owner["value"]["failureDistribution"] = deepcopy(candidates[key])
        owner["value"].pop("mtbfHours", None)
    report["changed"] = project != original
    return project, report


def _project_failure_distribution_owners(project: dict[str, Any]) -> list[dict[str, Any]]:
    owners: list[dict[str, Any]] = []
    for kind, field in (("product", "products"), ("component", "components")):
        values = project.get(field)
        if not isinstance(values, list):
            continue
        for index, value in enumerate(values):
            if isinstance(value, dict):
                owners.append({
                    "kind": kind,
                    "index": index,
                    "path": f"{field}[{index}]",
                    "value": value,
                })
    return owners


def _is_exponential_failure_distribution(distribution: Any) -> bool:
    if not isinstance(distribution, dict):
        return False
    distribution_type = _clean_text(
        distribution.get("distributionType") or distribution.get("distribution_type")
    ).casefold()
    return "exponential" in distribution_type or "指数" in distribution_type


def _failure_distribution_rate_sources(
    owner: dict[str, Any],
    distribution: dict[str, Any],
    path: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sources: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    allowed_fields = {
        "distributionType",
        "distribution_type",
        "parameters",
        "params",
        *_FAILURE_DISTRIBUTION_RATE_KEYS,
    }
    for field in distribution:
        if field in allowed_fields:
            continue
        issues.append({
            "code": "ambiguous_exponential_failure_distribution",
            "path": f"{path}.{field}",
            "field_path": f"{path}.{field}",
            "message": f"指数分布包含无法识别的直接参数：{field}",
        })

    def append_source(source_path: str, raw_value: Any, *, reciprocal: bool = False) -> None:
        rate = _positive_finite_number(raw_value)
        if rate is None:
            issues.append({
                "code": "invalid_exponential_failure_rate",
                "path": source_path,
                "field_path": source_path,
                "message": "指数分布故障率和 MTBF 必须是有限正数。",
                "value": raw_value,
            })
            return
        sources.append({
            "path": source_path,
            "value": raw_value,
            "rate": 1.0 / rate if reciprocal else rate,
            "kind": "mtbf_hours" if reciprocal else "failure_rate",
        })

    for key in _FAILURE_DISTRIBUTION_RATE_KEYS:
        if key in distribution:
            append_source(f"{path}.{key}", distribution[key])

    for field in ("parameters", "params"):
        if field not in distribution:
            continue
        parameters = distribution[field]
        if isinstance(parameters, (int, float)) and not isinstance(parameters, bool):
            append_source(f"{path}.{field}", parameters)
            continue
        if not isinstance(parameters, str):
            issues.append({
                "code": "invalid_exponential_failure_rate",
                "path": f"{path}.{field}",
                "field_path": f"{path}.{field}",
                "message": "指数分布历史参数必须是故障率数值或 key=value 字符串。",
                "value": parameters,
            })
            continue
        for item_index, item in enumerate(re.split(r"[,，;；]", parameters)):
            token = item.strip()
            if not token:
                continue
            if "=" not in token:
                issues.append({
                    "code": "ambiguous_exponential_failure_distribution",
                    "path": f"{path}.{field}",
                    "field_path": f"{path}.{field}",
                    "message": f"指数分布包含无法识别的历史参数：{token}",
                })
                continue
            raw_key, raw_value = [part.strip() for part in token.split("=", 1)]
            normalized_key = raw_key.casefold()
            if normalized_key not in _FAILURE_DISTRIBUTION_RATE_KEYS:
                issues.append({
                    "code": "ambiguous_exponential_failure_distribution",
                    "path": f"{path}.{field}",
                    "field_path": f"{path}.{field}",
                    "message": f"指数分布包含非故障率历史参数：{raw_key}",
                })
                continue
            append_source(f"{path}.{field}[{item_index}].{raw_key}", raw_value)

    if "mtbfHours" in owner:
        append_source(path.rsplit(".", 1)[0] + ".mtbfHours", owner["mtbfHours"], reciprocal=True)
    return sources, issues


def _positive_finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _normalize_basic_mission_support_activity_names(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    basic_missions = project.get("basicMissions")
    if not isinstance(activities, list) or not isinstance(basic_missions, list):
        return

    activity_name_counts: dict[str, int] = {}
    activities_by_legacy_name: dict[str, list[dict[str, Any]]] = {}
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        activity_name = _clean_text(activity.get("activityName"))
        if activity_name:
            activity_name_counts[activity_name] = activity_name_counts.get(activity_name, 0) + 1
        legacy_name = _clean_text(activity.get("name"))
        if legacy_name:
            activities_by_legacy_name.setdefault(legacy_name, []).append(activity)

    for mission in basic_missions:
        if not isinstance(mission, dict):
            continue
        reference = _clean_text(mission.get("supportActivityName"))
        # A unique canonical reference always takes precedence over any old
        # display name that happens to have the same text.
        if not reference or activity_name_counts.get(reference) == 1:
            continue
        legacy_matches = activities_by_legacy_name.get(reference, [])
        if len(legacy_matches) != 1:
            continue
        canonical_name = _clean_text(legacy_matches[0].get("activityName"))
        if canonical_name and activity_name_counts.get(canonical_name) == 1:
            mission["supportActivityName"] = canonical_name


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
    for field in ("airports", "basicMissions", "products", "supportNodes", "supportActivities"):
        _require_clean_list(project, field, target)
    _require_clean_dict(project, "missionProfile", target)
    _validate_clean_airports(project["airports"], target)
    _validate_clean_mission_profile(project["missionProfile"], target)
    _validate_clean_basic_missions(project["basicMissions"], target)
    _require_clean_dict(project, "combatUnit", target)
    _validate_clean_combat_unit(project["combatUnit"], target)
    _validate_clean_products(project["products"], target)
    components = _require_clean_list(project, "components", target)
    if not components:
        raise ValueError(f"clean Project JSON failed {target} schema at components: expected at least one component")
    _validate_clean_components(components, target)
    if "reliabilityBlockDiagram" in project:
        _validate_clean_reliability_block_diagram(project["reliabilityBlockDiagram"], target)
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
    _validate_product_references(project, target)


def _validate_clean_reliability_block_diagram(value: Any, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at reliabilityBlockDiagram: expected object")
    extra = sorted(field for field in value if field not in {"nodes", "edges"})
    if extra:
        raise ValueError(
            f"clean Project JSON failed {target} schema at reliabilityBlockDiagram: unexpected field {extra[0]}"
        )
    for collection, allowed_fields in (
        ("nodes", _RELIABILITY_BLOCK_NODE_FIELDS),
        ("edges", _RELIABILITY_BLOCK_EDGE_FIELDS),
    ):
        rows = value.get(collection)
        if not isinstance(rows, list):
            raise ValueError(
                f"clean Project JSON failed {target} schema at reliabilityBlockDiagram.{collection}: expected array"
            )
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(
                    f"clean Project JSON failed {target} schema at reliabilityBlockDiagram.{collection}.{index}: expected object"
                )
            unexpected = sorted(field for field in row if field not in allowed_fields)
            if unexpected:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at reliabilityBlockDiagram.{collection}.{index}: "
                    f"unexpected field {unexpected[0]}"
                )
            if collection == "nodes" and not isinstance(row.get("id"), str):
                raise ValueError(
                    f"clean Project JSON failed {target} schema at reliabilityBlockDiagram.nodes.{index}.id: "
                    "expected string"
                )


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
    if "durationDays" not in profile:
        raise ValueError(f"clean Project JSON failed {target} schema at missionProfile.durationDays: required")
    _validate_optional_clean_integer(profile, "durationDays", "missionProfile.durationDays", target, minimum=1)
    if profile["durationDays"] > 3650:
        raise ValueError(
            f"clean Project JSON failed {target} schema at missionProfile.durationDays: expected <= 3650"
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
    if "periodicProfileLists" in profile:
        _validate_clean_periodic_profile_lists(profile["periodicProfileLists"], target)


def _validate_clean_periodic_profile_lists(value: Any, target: str) -> None:
    path = "missionProfile.periodicProfileLists"
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
    extra = sorted(field for field in value if field not in {"week", "month", "year"})
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
    for profile_type in ("week", "month", "year"):
        profiles = value.get(profile_type)
        if not isinstance(profiles, list):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.{profile_type}: expected array")
        for index, profile in enumerate(profiles):
            profile_path = f"{path}.{profile_type}.{index}"
            if not isinstance(profile, dict):
                raise ValueError(f"clean Project JSON failed {target} schema at {profile_path}: expected object")
            allowed_fields = {"id", "name"}
            if profile_type == "month":
                allowed_fields.add("weekProfileIds")
            elif profile_type == "year":
                allowed_fields.add("monthProfileIds")
            unexpected = sorted(field for field in profile if field not in allowed_fields)
            if unexpected:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at {profile_path}: unexpected field {unexpected[0]}"
                )
            _require_clean_non_empty_string(profile, "id", f"{profile_path}.id", target)
            _require_clean_non_empty_string(profile, "name", f"{profile_path}.name", target)
            if profile_type == "month":
                refs = profile.get("weekProfileIds")
                if not isinstance(refs, list) or not 4 <= len(refs) <= 5:
                    raise ValueError(
                        f"clean Project JSON failed {target} schema at {profile_path}.weekProfileIds: expected 4 to 5 items"
                    )
                ref_path = f"{profile_path}.weekProfileIds"
            elif profile_type == "year":
                refs = profile.get("monthProfileIds")
                if not isinstance(refs, list) or len(refs) != 12:
                    raise ValueError(
                        f"clean Project JSON failed {target} schema at {profile_path}.monthProfileIds: expected 12 items"
                    )
                ref_path = f"{profile_path}.monthProfileIds"
            else:
                continue
            for ref_index, ref in enumerate(refs):
                if not isinstance(ref, str):
                    raise ValueError(
                        f"clean Project JSON failed {target} schema at {ref_path}.{ref_index}: expected string"
                    )


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
                for field in ("compositeTaskId", "weekday"):
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
        for field in _COMBAT_UNIT_MEMBER_FIELDS - {
            "preLifeCalendarDays", "preLifeFlightHours", "preLifeTakeoffLandingCount"
        }:
            _validate_optional_clean_string(member, field, f"{member_path}.{field}", target)
        _validate_optional_clean_integer(
            member, "preLifeCalendarDays", f"{member_path}.preLifeCalendarDays", target, minimum=0
        )
        _validate_optional_clean_number(
            member, "preLifeFlightHours", f"{member_path}.preLifeFlightHours", target, minimum=0
        )
        _validate_optional_clean_integer(
            member,
            "preLifeTakeoffLandingCount",
            f"{member_path}.preLifeTakeoffLandingCount",
            target,
            minimum=0,
        )


def _validate_clean_components(components: list[Any], target: str) -> None:
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at components.{index}: expected object")
        for field in ("id", "name", "productId", "quantity"):
            if field not in component:
                raise ValueError(f"clean Project JSON failed {target} schema at components.{index}.{field}: required")
        _require_clean_non_empty_string(component, "id", f"components.{index}.id", target)
        _require_clean_non_empty_string(component, "name", f"components.{index}.name", target)
        _require_clean_non_empty_string(component, "productId", f"components.{index}.productId", target)
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


def _validate_clean_products(products: list[Any], target: str) -> None:
    if not products:
        raise ValueError(f"clean Project JSON failed {target} schema at products: expected at least one product")
    for index, product in enumerate(products):
        path = f"products.{index}"
        if not isinstance(product, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        extra = sorted(field for field in product if field not in _PRODUCT_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in ("id", "name"):
            _require_clean_non_empty_string(product, field, f"{path}.{field}", target)
        for field in ("model", "kind"):
            _validate_optional_clean_string(product, field, f"{path}.{field}", target)
        _validate_optional_clean_number(
            product,
            "mtbfHours",
            f"{path}.mtbfHours",
            target,
            minimum=0,
        )
        if "mtbfHours" in product and product["mtbfHours"] <= 0:
            raise ValueError(
                f"clean Project JSON failed {target} schema at {path}.mtbfHours: expected > 0"
            )
        _validate_optional_clean_number(
            product,
            "meanRepairTimeMinutes",
            f"{path}.meanRepairTimeMinutes",
            target,
            minimum=0,
        )
        for field in ("failureDistribution", "repairDistribution"):
            if field in product and not isinstance(product[field], dict):
                raise ValueError(
                    f"clean Project JSON failed {target} schema at {path}.{field}: expected object"
                )


def _validate_product_references(project: dict[str, Any], target: str) -> None:
    products = project.get("products") if isinstance(project.get("products"), list) else []
    product_ids: set[str] = set()
    for index, product in enumerate(products):
        if not isinstance(product, dict):
            continue
        product_id = _clean_text(product.get("id"))
        if not product_id:
            continue
        if product_id in product_ids:
            raise ValueError(
                f"clean Project JSON failed {target} schema at products.{index}.id: duplicate product id {product_id}"
            )
        product_ids.add(product_id)

    components = project.get("components") if isinstance(project.get("components"), list) else []
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            continue
        product_id = _clean_text(component.get("productId"))
        if product_id and product_id not in product_ids:
            raise ValueError(
                f"clean Project JSON failed {target} schema at components.{index}.productId: "
                f"unknown product id {product_id}"
            )

    resources = project.get("supportResources") if isinstance(project.get("supportResources"), list) else []
    for index, resource in enumerate(resources):
        if not isinstance(resource, dict):
            continue
        product_id = _clean_text(resource.get("productId"))
        if resource.get("type") == "spare" and not product_id:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}.productId: required for spare resource"
            )
        if product_id and product_id not in product_ids:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}.productId: "
                f"unknown product id {product_id}"
            )

    policies = [item for item in project.get("transportPolicies", []) if isinstance(item, dict)]
    for node in project.get("supportNodes", []) if isinstance(project.get("supportNodes"), list) else []:
        if isinstance(node, dict) and isinstance(node.get("transportPolicies"), list):
            policies.extend(item for item in node["transportPolicies"] if isinstance(item, dict))
    for index, policy in enumerate(policies):
        product_id = _clean_text(policy.get("productId"))
        if product_id and product_id not in product_ids:
            raise ValueError(
                f"clean Project JSON failed {target} schema at transportPolicies.{index}.productId: "
                f"unknown product id {product_id}"
            )

    jobs = project.get("supportActivityJobs") if isinstance(project.get("supportActivityJobs"), list) else []
    for job_index, job in enumerate(jobs):
        if not isinstance(job, dict) or not isinstance(job.get("spare"), list):
            continue
        for spare_index, requirement in enumerate(job["spare"]):
            if not isinstance(requirement, dict):
                continue
            product_id = _clean_text(requirement.get("productId"))
            if not product_id:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivityJobs.{job_index}.spare.{spare_index}.productId: required"
                )
            if product_id not in product_ids:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivityJobs.{job_index}.spare.{spare_index}.productId: "
                    f"unknown product id {product_id}"
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
        for field in ("id", "organizationNodeId", "type", "name", "quantity"):
            if field not in resource:
                raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
        extra = sorted(field for field in resource if field not in _SUPPORT_RESOURCE_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in (
            "supportNodeName",
            "organizationNodeName",
            "organizationNodeId",
            "name",
            "model",
            "productId",
        ):
            _validate_optional_clean_string(resource, field, f"{path}.{field}", target)
        _require_clean_non_empty_string(resource, "id", f"{path}.id", target)
        if resource.get("type") not in {"personnel", "equipment", "spare"}:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.type: unsupported resource type")
        if resource.get("type") == "spare":
            _require_clean_non_empty_string(resource, "productId", f"{path}.productId", target)
        for field in ("quantity", "capacity"):
            _validate_optional_clean_integer(resource, field, f"{path}.{field}", target, minimum=0)


def _validate_support_resource_identities(project: dict[str, Any], target: str) -> None:
    resources = [item for item in project.get("supportResources", []) if isinstance(item, dict)]
    resource_index_by_id: dict[str, int] = {}
    for index, resource in enumerate(resources):
        resource_id = _clean_text(resource.get("id"))
        if not resource_id:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}.id: "
                "expected non-empty string"
            )
        if resource_id in resource_index_by_id:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}.id: "
                f"duplicate support resource ID {resource_id}"
            )
        resource_index_by_id[resource_id] = index

    organization_ids: set[str] = set()
    organization_ids_by_name: dict[str, set[str]] = {}
    organization_descendant_leaf_ids: dict[str, set[str]] = {}
    organization = project.get("supportOrganization") if isinstance(project.get("supportOrganization"), dict) else {}
    raw_tree = organization.get("tree")
    roots = raw_tree if isinstance(raw_tree, list) else [raw_tree]

    def collect_organization(node: Any) -> set[str]:
        if not isinstance(node, dict):
            return set()
        node_id = _clean_text(node.get("id"))
        node_name = _clean_text(node.get("name"))
        if node_id:
            organization_ids.add(node_id)
            if node_name:
                organization_ids_by_name.setdefault(node_name, set()).add(node_id)
        child_leaves: set[str] = set()
        children = node.get("children") if isinstance(node.get("children"), list) else []
        for child in children:
            child_leaves.update(collect_organization(child))
        leaves = child_leaves or ({node_id} if node_id else set())
        if node_id:
            organization_descendant_leaf_ids[node_id] = leaves
        return leaves

    for root in roots:
        collect_organization(root)

    support_node_ids: set[str] = set()
    support_node_ids_by_name: dict[str, set[str]] = {}
    for node in project.get("supportNodes", []) if isinstance(project.get("supportNodes"), list) else []:
        if not isinstance(node, dict):
            continue
        node_id = _clean_text(node.get("id"))
        node_name = _clean_text(node.get("name") or node.get("supportNodeName"))
        if node_id:
            support_node_ids.add(node_id)
            if node_name:
                support_node_ids_by_name.setdefault(node_name, set()).add(node_id)

    logical_index: dict[tuple[str, str], int] = {}
    for index, resource in enumerate(resources):
        if _clean_text(resource.get("type")).casefold() != "spare":
            continue
        if _clean_text(resource.get("id")).startswith("support-spare-tombstone:"):
            continue
        product_id = _clean_text(resource.get("productId"))
        explicit_organization_id = _clean_text(resource.get("organizationNodeId"))
        explicit_organization_name = _clean_text(resource.get("organizationNodeName"))
        organization_ref = (
            explicit_organization_id
            or explicit_organization_name
            or _clean_text(resource.get("supportNodeName"))
        )
        canonical_org = organization_ref
        identity_resolved = False
        if organization_ids:
            if organization_ref in organization_ids:
                canonical_org = organization_ref
                identity_resolved = True
            else:
                matches = organization_ids_by_name.get(organization_ref, set())
                support_ref = _clean_text(resource.get("supportNodeName"))
                support_matches = (
                    {support_ref} if support_ref in support_node_ids else support_node_ids_by_name.get(support_ref, set())
                )
                if len(matches) == 1:
                    canonical_org = next(iter(matches))
                    identity_resolved = True
                elif not explicit_organization_id and not explicit_organization_name and len(support_matches) == 1:
                    canonical_org = f"support-node:{next(iter(support_matches))}"
                    identity_resolved = True
                else:
                    reason = "ambiguous" if len(matches) > 1 else "unknown"
                    raise ValueError(
                        f"clean Project JSON failed {target} schema at supportResources.{index}."
                        f"{'organizationNodeId' if explicit_organization_id else 'organizationNodeName' if explicit_organization_name else 'supportNodeName'}: "
                        f"{reason} support organization {organization_ref or '<empty>'}"
                    )
        else:
            support_matches = (
                {organization_ref} if organization_ref in support_node_ids else support_node_ids_by_name.get(organization_ref, set())
            )
            if len(support_matches) == 1:
                canonical_org = f"support-node:{next(iter(support_matches))}"
                identity_resolved = True
            else:
                canonical_org = f"legacy:{organization_ref}"
        descendant_leaves = organization_descendant_leaf_ids.get(canonical_org, set())
        if len(descendant_leaves) > 1 and _non_negative_int(resource.get("quantity")) > 0:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}.organizationNodeName: "
                f"non-zero spare on organization {canonical_org} cannot be distributed across multiple leaf organizations"
            )
        logical_key = (canonical_org, product_id)
        if identity_resolved and canonical_org and product_id and logical_key in logical_index:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportResources.{index}: "
                f"duplicate live spare identity ({canonical_org}, {product_id})"
            )
        if identity_resolved and canonical_org and product_id:
            logical_index[logical_key] = index

    known_ids = set(resource_index_by_id)
    stable_identity_payload = any(resource_id.startswith("support-spare:") for resource_id in known_ids)
    for job_index, job in enumerate(project.get("supportActivityJobs", []) if isinstance(project.get("supportActivityJobs"), list) else []):
        if not isinstance(job, dict):
            continue
        for spare_index, requirement in enumerate(job.get("spare", []) if isinstance(job.get("spare"), list) else []):
            if not isinstance(requirement, dict):
                continue
            key = _clean_text(requirement.get("key"))
            if stable_identity_payload and key and key not in known_ids:
                raise ValueError(
                    f"clean Project JSON failed {target} schema at supportActivityJobs.{job_index}.spare.{spare_index}.key: "
                    f"unknown support resource {key}"
                )


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
        for required in ("id", "fromOrganizationNodeId", "toOrganizationNodeId"):
            _require_clean_non_empty_string(policy, required, f"{policy_path}.{required}", target)
        if "productId" in policy:
            _require_clean_non_empty_string(policy, "productId", f"{policy_path}.productId", target)
        for field in ("id", "name", "fromSupportNodeName", "from", "toSupportNodeName", "to", "fromOrganizationNodeId", "toOrganizationNodeId", "productId", "direction", "triggerMode", "transportMode"):
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
        for field in ("activityName", "activityType", "planType", "planGroupId", "aircraftModel", "equipmentId"):
            _validate_optional_clean_string(activity, field, f"supportActivities.{index}.{field}", target)
        if activity.get("planType") not in (None, "") and activity.get("planType") not in _SUPPORT_ACTIVITY_PLAN_TYPES:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportActivities.{index}.planType: unexpected plan type"
            )
        if activity.get("planType") in _OPERATIONS_SUPPORT_PHASE_TYPES and not _clean_text(activity.get("planGroupId")):
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportActivities.{index}.planGroupId: "
                "operations support phase requires a stable plan group"
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
        if (
            "maintenanceMethods" in activity or "replacementRatio" in activity
        ) and activity.get("planType") not in _MAINTENANCE_SUPPORT_ACTIVITY_PLAN_TYPES:
            raise ValueError(
                f"clean Project JSON failed {target} schema at supportActivities.{index}: "
                "maintenance method fields require a corrective or preventive plan"
            )
        _validate_support_activity_maintenance_methods(activity, f"supportActivities.{index}", target)
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
    extra = sorted(field for field in value if field not in {"runtimeMode", "tree", "relations"})
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at supportOrganization: unexpected field {extra[0]}")
    if "runtimeMode" not in value or "tree" not in value or "relations" not in value:
        raise ValueError(
            f"clean Project JSON failed {target} schema at supportOrganization: runtimeMode, tree and relations are required"
        )
    if value["runtimeMode"] not in {"legacy", "vertical", "vertical_lateral"}:
        raise ValueError(
            f"clean Project JSON failed {target} schema at supportOrganization.runtimeMode: expected legacy, vertical, or vertical_lateral"
        )
    tree = value["tree"]
    if tree is not None:
        _validate_clean_support_organization_node(tree, "supportOrganization.tree", target)
    relations = value["relations"]
    if not isinstance(relations, list):
        raise ValueError(f"clean Project JSON failed {target} schema at supportOrganization.relations: expected array")
    for index, relation in enumerate(relations):
        path = f"supportOrganization.relations.{index}"
        if not isinstance(relation, dict):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
        extra = sorted(set(relation) - _ORGANIZATION_RELATION_FIELDS)
        if extra:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
        for field in ("id", "type", "fromOrganizationNodeId", "toOrganizationNodeId"):
            _require_clean_non_empty_string(relation, field, f"{path}.{field}", target)
        if relation["type"] != "lateral":
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.type: expected lateral")
        _require_clean_integer(relation, "priority", f"{path}.priority", target, minimum=1)
        if not isinstance(relation.get("enabled"), bool):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.enabled: expected boolean")


def _validate_clean_support_organization_node(value: Any, path: str, target: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: expected object")
    for field in ("id", "name"):
        if field not in value:
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.{field}: required")
        _require_clean_string(value, field, f"{path}.{field}", target)
    extra = sorted(field for field in value if field not in _ORGANIZATION_NODE_FIELDS)
    if extra:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}: unexpected field {extra[0]}")
    _validate_optional_clean_string(value, "description", f"{path}.description", target)
    scope = value.get("serviceScope")
    if not isinstance(scope, dict) or set(scope) != _SERVICE_SCOPE_FIELDS:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}.serviceScope: expected canonical scope object")
    for field in _SERVICE_SCOPE_FIELDS:
        if not isinstance(scope[field], list) or any(not isinstance(item, str) or not item for item in scope[field]):
            raise ValueError(f"clean Project JSON failed {target} schema at {path}.serviceScope.{field}: expected non-empty string array")
    if "children" not in value:
        raise ValueError(f"clean Project JSON failed {target} schema at {path}.children: required")
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
    _normalize_basic_mission_support_activity_names(project)
    _normalize_support_model_tables(project)
    project.pop("modelingDictionaries", None)
    _strip_modeling_import_validation_non_model_fields(project)
    _strip_support_resource_non_model_fields(project)
    _strip_legacy_support_node_resource_fields(project)
    normalized_project, _failure_distribution_report = normalize_project_failure_distributions(project, strict=True)
    project.clear()
    project.update(normalized_project)
    _normalize_project_component_k_out_of_n(project)
    _strip_component_non_model_fields(project.get("components"))
    _strip_reliability_block_diagram_non_model_fields(project.get("reliabilityBlockDiagram"))
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
    _normalize_support_activity_maintenance_methods(project)
    _strip_support_activity_rule_ui_fields(project.get("supportActivities"))
    _strip_support_activity_spare_type_fields(project.get("supportActivities"))
    _strip_support_activity_mttr_fields(project.get("supportActivities"))
    _strip_support_activity_mttr_fields(project.get("supportActivityJobs"))
    _validate_support_activity_reference_fields_before_migration(project)
    _lift_support_activity_jobs_to_top_level(project)
    _validate_support_activity_reference_fields_before_migration(project)
    _materialize_operations_support_activity_phases(project)
    _materialize_support_activity_job_applicability(project)
    _normalize_support_activity_reference_fields(project)
    project.update(normalize_support_organization_contract(project)[0])


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
            "spareType",
            "spare_type",
        ):
            component.pop(field, None)
        profile = component.get("specialRepairProfile")
        if isinstance(profile, dict):
            _keep_fields(profile, _SPECIAL_REPAIR_PROFILE_FIELDS)
            if not profile:
                component.pop("specialRepairProfile", None)


def _strip_reliability_block_diagram_non_model_fields(value: Any) -> None:
    if not isinstance(value, dict):
        return
    _keep_fields(value, {"nodes", "edges"})
    nodes = value.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if isinstance(node, dict):
                _keep_fields(node, _RELIABILITY_BLOCK_NODE_FIELDS)
    edges = value.get("edges")
    if isinstance(edges, list):
        for edge in edges:
            if isinstance(edge, dict):
                _keep_fields(edge, _RELIABILITY_BLOCK_EDGE_FIELDS)


def _normalize_mission_profile_reference_fields(project: dict[str, Any]) -> None:
    mission_profile = project.get("missionProfile")
    if not isinstance(mission_profile, dict):
        return
    basic_missions = project.get("basicMissions") if isinstance(project.get("basicMissions"), list) else []
    basic_mission_ids = {mission_id for mission in basic_missions for mission_id in [_basic_mission_id(mission)] if mission_id}
    mission_profile["durationDays"] = _canonical_mission_duration_days(mission_profile)
    mission_profile.pop("durationHours", None)
    mission_profile.pop("durationMinutes", None)
    _normalize_mission_profile_composite_tasks(mission_profile, basic_mission_ids)
    _normalize_mission_profile_periodic_tasks(mission_profile)


def _canonical_mission_duration_days(mission_profile: dict[str, Any]) -> int:
    duration_days = _first_positive_number(mission_profile.get("durationDays"))
    if duration_days is not None:
        return max(1, int(math.ceil(duration_days)))
    duration_minutes = _first_positive_number(mission_profile.get("durationMinutes"))
    if duration_minutes is not None:
        return max(1, int(math.ceil(duration_minutes / (24 * 60))))
    duration_hours = _first_positive_number(mission_profile.get("durationHours"))
    if duration_hours is not None:
        return max(1, int(math.ceil(duration_hours / 24)))

    legacy_days = [
        period_days * repeat_count
        for task in mission_profile.get("periodicTasks") or []
        if isinstance(task, dict)
        for period_days in [_periodic_cycle_days(task)]
        for repeat_count in [
            _first_positive_number(task.get("repeatWeeks"), task.get("repeatRounds"), task.get("repeatCount")) or 1.0
        ]
        if period_days is not None
    ]
    if legacy_days:
        return max(1, int(math.ceil(max(legacy_days))))
    raise ValueError(
        "clean Project JSON cannot derive missionProfile.durationDays; "
        "provide durationDays or an unambiguous legacy duration"
    )


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
    composite_tasks = _normalized_periodic_composite_tasks(task)
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


def _normalized_periodic_composite_tasks(task: dict[str, Any]) -> list[dict[str, Any]]:
    raw_composites = task.get("compositeTasks")
    if isinstance(raw_composites, list):
        explicit_tasks: list[dict[str, Any]] = []
        for item in raw_composites:
            if not isinstance(item, dict):
                continue
            if any(item.get(field) not in (None, "") for field in ("week", "weekIndex")):
                raise ValueError(
                    "clean Project JSON cannot silently migrate absolute week/weekIndex rows; "
                    "convert them to weekday-only week profiles explicitly"
                )
            normalized: dict[str, Any] = {}
            composite_task_id = _clean_text(item.get("compositeTaskId"))
            weekday = item.get("weekday", item.get("dayOfWeek"))
            if composite_task_id:
                normalized["compositeTaskId"] = composite_task_id
            if weekday not in (None, ""):
                normalized["weekday"] = _normalized_periodic_weekday(weekday)
            if _clean_text(normalized.get("compositeTaskId")):
                explicit_tasks.append(normalized)
        if explicit_tasks:
            return explicit_tasks

    assignments: list[tuple[str, Any]] = []
    raw_assignments = task.get("weekdayAssignments") if isinstance(task.get("weekdayAssignments"), dict) else {}
    for legacy_field, weekday in _PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS:
        assignments.append((weekday, raw_assignments.get(weekday) or raw_assignments.get(legacy_field) or task.get(legacy_field)))
    composite_tasks: list[dict[str, Any]] = []
    for weekday, composite_id in assignments:
        composite_text = _clean_text(composite_id)
        if not composite_text:
            continue
        composite_tasks.append({
            "compositeTaskId": composite_text,
            "weekday": weekday,
        })
    return composite_tasks


def _normalized_periodic_weekday(value: Any) -> Any:
    text = _clean_text(value).lower()
    for legacy_field, weekday in _PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS:
        if text in {legacy_field.lower(), weekday}:
            return weekday
    return deepcopy(value)


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
            if not isinstance(node, dict) or _is_legacy_support_resource_row(node):
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
            if not isinstance(node, dict) or _is_legacy_support_resource_row(node):
                continue
            for policy_index, policy in enumerate(node.get("transportPolicies") if isinstance(node.get("transportPolicies"), list) else []):
                if not isinstance(policy, dict):
                    continue
                next_policy = deepcopy(policy)
                meaningful_fields = {
                    "fromOrganizationNodeId", "fromSupportNodeName", "from",
                    "toOrganizationNodeId", "toSupportNodeName", "to",
                    "productId", "capacity", "priority", "transportTimeHours", "transport_time_hours",
                    "transferCycleHours", "criticalInventory", "triggerMode", "transportMode", "direction", "name",
                }
                if any(policy.get(field) not in (None, "", [], {}) for field in meaningful_fields):
                    next_policy.setdefault("fromOrganizationNodeId", str(node.get("organizationNodeId") or node.get("id") or ""))
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
    legacy_support_nodes = deepcopy(project.get("supportNodes")) if isinstance(project.get("supportNodes"), list) else []
    legacy_name_by_ref = _legacy_support_node_name_by_ref(project.get("supportNodes"))
    node_scope_by_ref = _support_node_scope_by_ref(project.get("supportNodes"))
    _organization_names, organization_name_by_ref = _normalize_support_organization(
        project.get("supportOrganization"),
        legacy_name_by_ref,
    )
    name_by_ref = {**legacy_name_by_ref, **organization_name_by_ref}
    node_scope_by_name = _support_node_scope_by_name(node_scope_by_ref, name_by_ref)
    organization_id_by_ref, organization_name_by_id = _support_organization_aliases_for_legacy_refs(
        project.get("supportOrganization"),
        legacy_support_nodes,
        name_by_ref,
    )
    _normalize_support_resource_refs(project, name_by_ref, organization_id_by_ref)
    project["supportNodes"] = []
    for node in legacy_support_nodes:
        if not isinstance(node, dict) or _is_legacy_support_resource_row(node):
            continue
        legacy_id = _clean_text(node.get("id") or node.get("organizationNodeId"))
        name = _clean_text(node.get("name") or node.get("supportNodeName") or legacy_id)
        explicit_owner = _clean_text(node.get("organizationNodeId"))
        migrated_owner = (
            explicit_owner
            or organization_id_by_ref.get(legacy_id)
            or organization_id_by_ref.get(name)
            or ""
        )
        canonical_name = organization_name_by_id.get(migrated_owner) or name
        normalized_node = {
            "id": legacy_id,
            "name": canonical_name,
            **(
                node_scope_by_ref.get(legacy_id)
                or node_scope_by_ref.get(explicit_owner)
                or node_scope_by_name.get(name)
                or {}
            ),
        }
        if migrated_owner:
            normalized_node["organizationNodeId"] = migrated_owner
        project["supportNodes"].append(normalized_node)
    _normalize_top_level_transport_policies(project, name_by_ref, organization_id_by_ref)
    _normalize_support_node_refs_in_project(project, name_by_ref, organization_id_by_ref)


def _support_organization_aliases_for_legacy_refs(
    support_organization: Any,
    legacy_support_nodes: list[Any],
    name_by_ref: dict[str, str],
) -> tuple[dict[str, str], dict[str, str]]:
    organization = support_organization if isinstance(support_organization, dict) else {}
    root = organization.get("tree")
    if not isinstance(root, dict):
        return {}, {}
    node_ids: list[str] = []
    name_ids: dict[str, set[str]] = {}
    name_by_id: dict[str, str] = {}

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        node_id = _clean_text(node.get("id"))
        name = _clean_text(node.get("name") or node_id)
        if node_id:
            node_ids.append(node_id)
            name_by_id[node_id] = name
            name_ids.setdefault(name, set()).add(node_id)
        for child in node.get("children", []) if isinstance(node.get("children"), list) else []:
            visit(child)

    visit(root)
    candidates: dict[str, set[str]] = {
        node_id: {node_id}
        for node_id in node_ids
    }
    for name, ids in name_ids.items():
        candidates.setdefault(name, set()).update(ids)
    for ref, name in name_by_ref.items():
        ids = name_ids.get(_clean_text(name), set())
        if ids:
            candidates.setdefault(_clean_text(ref), set()).update(ids)
    for legacy_node in legacy_support_nodes:
        if not isinstance(legacy_node, dict):
            continue
        explicit = _clean_text(legacy_node.get("organizationNodeId"))
        owner_ids = candidates.get(explicit, set())
        if len(owner_ids) != 1:
            continue
        owner = next(iter(owner_ids))
        for field in ("id", "name", "supportNodeName", "organizationNodeId"):
            ref = _clean_text(legacy_node.get(field))
            if ref:
                candidates.setdefault(ref, set()).add(owner)
    aliases = {
        ref: next(iter(ids))
        for ref, ids in candidates.items()
        if ref and len(ids) == 1
    }
    return aliases, name_by_id


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


def _support_node_scope_by_ref(support_nodes: Any) -> dict[str, dict[str, Any]]:
    scope_by_ref: dict[str, dict[str, Any]] = {}
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
    scope_by_ref: dict[str, dict[str, Any]],
    name_by_ref: dict[str, str],
) -> dict[str, dict[str, Any]]:
    scope_by_name: dict[str, dict[str, Any]] = {}
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
    if not support_node_names:
        root_name = _clean_text(support_organization["tree"].get("name"))
        root_id = _clean_text(support_organization["tree"].get("id"))
        if root_name:
            support_node_names.append(root_name)
            if root_id:
                name_by_ref[root_id] = root_name
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
    if isinstance(node.get("serviceScope"), dict):
        normalized["serviceScope"] = deepcopy(node["serviceScope"])
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


def _normalize_support_resource_refs(
    project: dict[str, Any],
    name_by_ref: dict[str, str],
    organization_id_by_ref: dict[str, str],
) -> None:
    support_resources = project.get("supportResources")
    if not isinstance(support_resources, list):
        return
    for resource in support_resources:
        if not isinstance(resource, dict):
            continue
        owner_ref = resource.get("organizationNodeId") or resource.get("organizationNodeName") or resource.get("supportNodeId") or resource.get("supportNodeName")
        resource["supportNodeName"] = _support_node_name_for_ref(
            resource.get("supportNodeName") or resource.get("supportNodeId") or owner_ref,
            name_by_ref,
        )
        organization_id = organization_id_by_ref.get(_clean_text(owner_ref)) or organization_id_by_ref.get(
            _clean_text(resource.get("supportNodeName"))
        )
        if organization_id:
            resource["organizationNodeId"] = organization_id
        resource.pop("supportNodeId", None)


def _is_legacy_support_resource_row(node: dict[str, Any]) -> bool:
    return bool(node.get("importedResourceType"))


def _normalize_top_level_transport_policies(
    project: dict[str, Any],
    name_by_ref: dict[str, str],
    organization_id_by_ref: dict[str, str],
) -> None:
    transport_policies = project.get("transportPolicies")
    if not isinstance(transport_policies, list):
        return
    normalized_policies: list[dict[str, Any]] = []
    for index, policy in enumerate(transport_policies):
        if not isinstance(policy, dict):
            continue
        from_ref = _clean_text(policy.get("fromOrganizationNodeId") or policy.get("fromSupportNodeName") or policy.get("from"))
        to_ref = _clean_text(policy.get("toOrganizationNodeId") or policy.get("toSupportNodeName") or policy.get("to"))
        normalized: dict[str, Any] = {
            "spareName": _clean_text(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type")),
        }
        from_organization_id = organization_id_by_ref.get(from_ref)
        to_organization_id = organization_id_by_ref.get(to_ref)
        if from_organization_id:
            normalized["fromOrganizationNodeId"] = from_organization_id
        else:
            normalized["fromSupportNodeName"] = _support_node_name_for_ref(from_ref, name_by_ref)
        if to_organization_id:
            normalized["toOrganizationNodeId"] = to_organization_id
        else:
            normalized["toSupportNodeName"] = _support_node_name_for_ref(to_ref, name_by_ref)
        if _clean_text(policy.get("id")):
            normalized["id"] = _clean_text(policy.get("id"))
        if _clean_text(policy.get("productId")):
            normalized["productId"] = _clean_text(policy.get("productId"))
        for field in ("name", "direction", "triggerMode", "criticalInventory", "transferCycleHours", "capacity", "priority", "transportMode", "transportTimeHours"):
            if field in policy:
                normalized[field] = policy[field]
        if "direction" in normalized and "transportMode" not in normalized:
            normalized["transportMode"] = normalized["direction"]
        normalized_policies.append(normalized)
    project["transportPolicies"] = normalized_policies


def _normalize_support_node_refs_in_project(
    project: dict[str, Any],
    name_by_ref: dict[str, str],
    organization_id_by_ref: dict[str, str],
) -> None:
    airports = project.get("airports")
    if isinstance(airports, list):
        for airport in airports:
            if isinstance(airport, dict) and "supportNodeId" in airport:
                airport["supportNodeId"] = _support_node_name_for_ref(airport.get("supportNodeId"), name_by_ref)
    for activity in project.get("supportActivities", []) if isinstance(project.get("supportActivities"), list) else []:
        _normalize_support_activity_refs(activity, name_by_ref, organization_id_by_ref)


def _normalize_support_activity_refs(
    value: Any,
    name_by_ref: dict[str, str],
    organization_id_by_ref: dict[str, str],
) -> None:
    if isinstance(value, list):
        for item in value:
            _normalize_support_activity_refs(item, name_by_ref, organization_id_by_ref)
        return
    if not isinstance(value, dict):
        return
    if "supportNodeId" in value:
        value["supportNodeId"] = _support_node_name_for_ref(value.get("supportNodeId"), name_by_ref)
    if "resourceId" in value:
        ref = _clean_text(value.get("resourceId"))
        value["resourceId"] = organization_id_by_ref.get(ref) or _support_node_name_for_ref(ref, name_by_ref)
    if isinstance(value.get("lateralSupportNodes"), list):
        value["lateralSupportNodes"] = [_support_node_name_for_ref(ref, name_by_ref) for ref in value["lateralSupportNodes"]]
    for child in value.values():
        _normalize_support_activity_refs(child, name_by_ref, organization_id_by_ref)


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
        for field in ("name", "supportNodeId", "requiredDevices", "requiredPersonnel"):
            activity.pop(field, None)


_OPERATIONS_SUPPORT_PHASE_CONFIGS = (
    {
        "planType": "直接准备方案",
        "idSuffix": "preflight",
        "nameSuffix": "飞行前准备",
        "maxWorkTimeRefMinutes": 30,
    },
    {
        "planType": "再次出动准备方案",
        "idSuffix": "relaunch",
        "nameSuffix": "再次出动准备",
        "maxWorkTimeRefMinutes": 45,
    },
    {
        "planType": "飞行后检查方案",
        "idSuffix": "postflight",
        "nameSuffix": "飞行后检查",
        "maxWorkTimeRefMinutes": 60,
    },
)
_OPERATIONS_SUPPORT_PHASE_TYPES = {
    str(config["planType"])
    for config in _OPERATIONS_SUPPORT_PHASE_CONFIGS
}


def _materialize_operations_support_activity_phases(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    if not isinstance(activities, list) or not activities:
        return
    used_ids = {
        _clean_text(activity.get("id"))
        for activity in activities
        if isinstance(activity, dict) and _clean_text(activity.get("id"))
    }
    used_names = {
        _clean_text(activity.get("activityName") or activity.get("name"))
        for activity in activities
        if isinstance(activity, dict) and _clean_text(activity.get("activityName") or activity.get("name"))
    }
    rows: list[dict[str, Any]] = []
    for index, activity in enumerate(activities):
        if not _is_operations_support_activity_for_contract(activity):
            continue
        if activity.get("activityName") in (None, ""):
            activity["activityName"] = str(
                activity.get("name") or activity.get("id") or f"使用保障方案{index + 1}"
            )
        inference = _inferred_legacy_operations_phase(activity)
        raw_plan_type = _clean_text(activity.get("planType"))
        if (
            raw_plan_type in _OPERATIONS_SUPPORT_PHASE_TYPES
            and inference.get("hasEvidence")
            and inference.get("planType") != raw_plan_type
        ):
            raise ValueError(
                "clean Project JSON failed aircraft_support_v1 schema at "
                f"supportActivities.{index}.planType: conflicting operations support phase evidence"
            )
        phase_type = (
            raw_plan_type
            if raw_plan_type in _OPERATIONS_SUPPORT_PHASE_TYPES
            else str(inference.get("planType") or "直接准备方案")
        )
        activity.setdefault("activityCodes", [])
        activity.setdefault("predecessors", {})
        rows.append({
            "activity": activity,
            "index": index,
            "phaseType": phase_type,
            "explicitGroupId": _clean_text(activity.get("planGroupId")),
            "baseId": str(inference.get("baseId") or ""),
            "baseName": str(inference.get("baseName") or ""),
        })

    groups = _group_operations_support_rows(rows)
    for plan_group_id in sorted(groups):
        phase_rows = groups[plan_group_id]
        template = phase_rows.get("直接准备方案") or min(
            phase_rows.values(),
            key=_operations_support_row_sort_key,
            default=None,
        )
        if template is None:
            continue
        base_name = _clean_text(
            phase_rows.get("直接准备方案", {}).get("activityName")
            or template.get("activityName")
            or template.get("name")
            or template.get("id")
        ) or "使用保障方案"
        for config in _OPERATIONS_SUPPORT_PHASE_CONFIGS:
            phase_type = str(config["planType"])
            if phase_type in phase_rows:
                continue
            id_base = f"{_clean_text(template.get('id')) or plan_group_id}-{config['idSuffix']}"
            activity_id = id_base
            id_suffix = 2
            while activity_id in used_ids:
                activity_id = f"{id_base}-{id_suffix}"
                id_suffix += 1
            used_ids.add(activity_id)
            name_base = f"{base_name}（{config['nameSuffix']}）"
            activity_name = name_base
            name_suffix = 2
            while activity_name in used_names:
                activity_name = f"{name_base}（{name_suffix}）"
                name_suffix += 1
            used_names.add(activity_name)
            created: dict[str, Any] = {
                "id": activity_id,
                "activityName": activity_name,
                "activityType": "使用保障",
                "planType": phase_type,
                "planGroupId": plan_group_id,
                "aircraftModel": _clean_text(template.get("aircraftModel")),
                "activityCodes": [],
                "predecessors": {},
                "maxWorkTimeRefMinutes": int(config["maxWorkTimeRefMinutes"]),
            }
            for field in (
                "equipmentId",
                "resourceId",
                "priority",
                "durationMinutes",
                "durationHours",
                "spareQuantity",
            ):
                if field in template:
                    created[field] = deepcopy(template[field])
            activities.append(created)
            phase_rows[phase_type] = created


def _group_operations_support_rows(
    rows: list[dict[str, Any]],
) -> dict[str, dict[str, dict[str, Any]]]:
    groups: dict[str, dict[str, dict[str, Any]]] = {}
    ungrouped: list[dict[str, Any]] = []
    for row in rows:
        explicit_group_id = str(row["explicitGroupId"])
        if not explicit_group_id:
            ungrouped.append(row)
            continue
        _add_operations_support_row_to_group(groups, explicit_group_id, row)

    identity_index: dict[str, set[int]] = {}
    for row_index, row in enumerate(ungrouped):
        for identity in _operations_support_row_identities(row):
            identity_index.setdefault(identity, set()).add(row_index)

    remaining = set(range(len(ungrouped)))
    components: list[list[dict[str, Any]]] = []
    while remaining:
        pending = [min(remaining, key=lambda value: _operations_support_row_sort_key(ungrouped[value]["activity"]))]
        component_indexes: set[int] = set()
        while pending:
            row_index = pending.pop()
            if row_index in component_indexes:
                continue
            component_indexes.add(row_index)
            for identity in _operations_support_row_identities(ungrouped[row_index]):
                pending.extend(identity_index.get(identity, set()) - component_indexes)
        remaining -= component_indexes
        components.append([ungrouped[row_index] for row_index in component_indexes])

    reserved_group_ids = set(groups)
    for component in sorted(
        components,
        key=lambda value: min(_operations_support_row_sort_key(row["activity"]) for row in value),
    ):
        plan_group_id = _operations_support_component_group_id(component)
        if plan_group_id in reserved_group_ids:
            raise ValueError(
                "clean Project JSON failed aircraft_support_v1 schema at supportActivities: "
                f"ambiguous operations support plan group {plan_group_id!r}"
            )
        reserved_group_ids.add(plan_group_id)
        for row in component:
            _add_operations_support_row_to_group(groups, plan_group_id, row)
    return groups


def _add_operations_support_row_to_group(
    groups: dict[str, dict[str, dict[str, Any]]],
    plan_group_id: str,
    row: dict[str, Any],
) -> None:
    phase_type = str(row["phaseType"])
    phase_rows = groups.setdefault(plan_group_id, {})
    if phase_type in phase_rows:
        raise ValueError(
            "clean Project JSON failed aircraft_support_v1 schema at supportActivities: "
            f"duplicate operations support phase ({plan_group_id}, {phase_type})"
        )
    activity = row["activity"]
    activity["planType"] = phase_type
    activity["planGroupId"] = plan_group_id
    phase_rows[phase_type] = activity


def _operations_support_row_identities(row: dict[str, Any]) -> set[str]:
    activity = row["activity"]
    scope = "|".join((
        _clean_text(activity.get("aircraftModel")),
        _clean_text(activity.get("equipmentId")),
    ))
    identities: set[str] = set()
    base_id = str(row.get("baseId") or "")
    base_name = str(row.get("baseName") or "")
    if base_id:
        identities.add(f"{scope}|id:{base_id}")
    if base_name:
        identities.add(f"{scope}|name:{base_name}")
    if not identities:
        activity_id = _clean_text(activity.get("id"))
        activity_name = _clean_text(activity.get("activityName") or activity.get("name"))
        if activity_id:
            identities.add(f"{scope}|id:{activity_id}")
        if activity_name:
            identities.add(f"{scope}|name:{activity_name}")
    return identities


def _operations_support_component_group_id(component: list[dict[str, Any]]) -> str:
    direct_rows = [row for row in component if row["phaseType"] == "直接准备方案"]
    candidates = direct_rows or component
    base_ids = sorted({
        str(row.get("baseId") or "")
        for row in candidates
        if str(row.get("baseId") or "")
    })
    if base_ids:
        return base_ids[0]
    activity_ids = sorted({
        _clean_text(row["activity"].get("id"))
        for row in candidates
        if _clean_text(row["activity"].get("id"))
    })
    if activity_ids:
        return activity_ids[0]
    base_names = sorted({
        str(row.get("baseName") or "")
        for row in candidates
        if str(row.get("baseName") or "")
    })
    if base_names:
        return base_names[0]
    return f"operations-support-plan-{min(int(row['index']) for row in component) + 1}"


def _operations_support_row_sort_key(activity: dict[str, Any]) -> tuple[str, str]:
    return (
        _clean_text(activity.get("id")),
        _clean_text(activity.get("activityName") or activity.get("name")),
    )


def _inferred_legacy_operations_phase(activity: dict[str, Any]) -> dict[str, str]:
    activity_id = _clean_text(activity.get("id"))
    activity_name = _clean_text(activity.get("activityName") or activity.get("name"))
    evidence: list[dict[str, str]] = []
    for config in _OPERATIONS_SUPPORT_PHASE_CONFIGS:
        id_suffix = f"-{config['idSuffix']}"
        name_suffixes = (
            f"（{config['nameSuffix']}）",
            f"({config['nameSuffix']})",
            f"{config['nameSuffix']}活动",
        )
        if activity_id.endswith(id_suffix):
            evidence.append({
                "planType": str(config["planType"]),
                "baseId": activity_id[:-len(id_suffix)],
                "baseName": next(
                    (
                        activity_name[:-len(name_suffix)]
                        for name_suffix in name_suffixes
                        if activity_name.endswith(name_suffix)
                    ),
                    "",
                ),
            })
        for name_suffix in name_suffixes:
            if activity_name.endswith(name_suffix):
                evidence.append({
                    "planType": str(config["planType"]),
                    "baseId": "",
                    "baseName": activity_name[:-len(name_suffix)],
                })
                break
    evidence_types = {item["planType"] for item in evidence}
    if len(evidence_types) > 1:
        raise ValueError(
            "clean Project JSON failed aircraft_support_v1 schema at supportActivities: "
            "conflicting operations support phase identity"
        )
    if evidence:
        base_ids = sorted({item["baseId"] for item in evidence if item["baseId"]})
        base_names = sorted({item["baseName"] for item in evidence if item["baseName"]})
        return {
            "planType": evidence[0]["planType"],
            "baseId": base_ids[0] if base_ids else "",
            "baseName": base_names[0] if base_names else "",
            "hasEvidence": "true",
        }
    return {
        "planType": "直接准备方案",
        "baseId": activity_id,
        "baseName": activity_name,
        "hasEvidence": "",
    }


def _is_operations_support_activity_for_contract(activity: Any) -> bool:
    if not isinstance(activity, dict):
        return False
    plan_type = _clean_text(activity.get("planType"))
    if plan_type:
        return plan_type == "使用保障方案" or plan_type in _OPERATIONS_SUPPORT_PHASE_TYPES
    activity_type = _clean_text(activity.get("activityType")).lower()
    return any(
        token in activity_type
        for token in ("使用保障", "飞行前保障", "operations", "preflight", "relaunch", "postflight")
    )


def _validate_support_activity_reference_fields_before_migration(project: dict[str, Any]) -> None:
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return
    for activity_index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            continue
        path = f"supportActivities.{activity_index}"
        raw_codes = activity.get("activityCodes", [])
        if "activityCodes" in activity:
            if not isinstance(raw_codes, list):
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.activityCodes: "
                    "expected string array"
                )
            activity_codes: list[str] = []
            for code_index, code in enumerate(raw_codes):
                if not isinstance(code, str) or not _clean_text(code):
                    raise ValueError(
                        f"clean Project JSON failed aircraft_support_v1 schema at "
                        f"{path}.activityCodes.{code_index}: expected non-empty string"
                    )
                activity_codes.append(_clean_text(code))
            if len(activity_codes) != len(set(activity_codes)):
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.activityCodes: "
                    "duplicate activity code"
                )
        else:
            activity_codes = []
        raw_predecessors = activity.get("predecessors", {})
        if "predecessors" not in activity:
            continue
        if not isinstance(raw_predecessors, dict):
            raise ValueError(
                f"clean Project JSON failed aircraft_support_v1 schema at {path}.predecessors: "
                "expected string array map"
            )
        activity_code_set = set(activity_codes)
        for code, values in raw_predecessors.items():
            if not isinstance(code, str) or not _clean_text(code):
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.predecessors: "
                    "expected non-empty string keys"
                )
            code_text = _clean_text(code)
            if code_text not in activity_code_set:
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at "
                    f"{path}.predecessors.{code_text}: predecessor key is outside activityCodes"
                )
            if not isinstance(values, list):
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at "
                    f"{path}.predecessors.{code_text}: expected string array"
                )
            predecessors: list[str] = []
            for value_index, value in enumerate(values):
                if not isinstance(value, str) or not _clean_text(value):
                    raise ValueError(
                        f"clean Project JSON failed aircraft_support_v1 schema at "
                        f"{path}.predecessors.{code_text}.{value_index}: expected non-empty string"
                    )
                predecessor = _clean_text(value)
                if predecessor not in activity_code_set:
                    raise ValueError(
                        f"clean Project JSON failed aircraft_support_v1 schema at "
                        f"{path}.predecessors.{code_text}: predecessor value is outside activityCodes"
                    )
                predecessors.append(predecessor)
            if len(predecessors) != len(set(predecessors)):
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at "
                    f"{path}.predecessors.{code_text}: duplicate predecessor"
                )


def _normalize_support_activity_maintenance_methods(project: dict[str, Any]) -> list[str]:
    changes: list[str] = []
    activities = project.get("supportActivities")
    if not isinstance(activities, list):
        return changes
    for index, activity in enumerate(activities):
        if not isinstance(activity, dict):
            continue
        path = f"supportActivities.{index}"
        plan_type = _canonical_support_activity_plan_type(activity)
        has_methods = "maintenanceMethods" in activity
        has_ratio = "replacementRatio" in activity
        has_legacy = "repairType" in activity
        if plan_type not in _MAINTENANCE_SUPPORT_ACTIVITY_PLAN_TYPES:
            if has_methods or has_ratio or has_legacy:
                raise ValueError(f"clean Project JSON failed aircraft_support_v1 schema at {path}: maintenance method fields require a maintenance plan")
            continue
        if has_methods != has_ratio:
            raise ValueError(
                f"clean Project JSON failed aircraft_support_v1 schema at {path}: "
                "maintenanceMethods and replacementRatio must appear together"
            )
        legacy_migration: tuple[list[str], float] | None = None
        if has_legacy:
            legacy_value = str(activity.get("repairType") or "").strip()
            if plan_type != "修复性维修方案":
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.repairType: "
                    "legacy repairType migration is only supported for corrective maintenance"
                )
            legacy_migration = _LEGACY_REPAIR_TYPE_MIGRATIONS.get(legacy_value)
            if legacy_migration is None:
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.repairType: "
                    f"unsupported legacy value {legacy_value!r}"
                )
        if not has_methods:
            methods, ratio = legacy_migration or (["non_replacement"], 0.0)
            activity["maintenanceMethods"] = list(methods)
            activity["replacementRatio"] = ratio
            source = (
                f"legacyRepairType:{str(activity.get('repairType') or '').strip()}"
                if legacy_migration
                else "historicalDefault"
            )
            changes.extend((
                f"{path}.maintenanceMethods={source}",
                f"{path}.replacementRatio={source}",
            ))
        _validate_support_activity_maintenance_methods(activity, path, "aircraft_support_v1")
        if legacy_migration is not None:
            legacy_methods, legacy_ratio = legacy_migration
            if activity["maintenanceMethods"] != legacy_methods or activity["replacementRatio"] != legacy_ratio:
                raise ValueError(
                    f"clean Project JSON failed aircraft_support_v1 schema at {path}.repairType: "
                    "legacy value conflicts with canonical maintenance fields"
                )
        activity.pop("repairType", None)
    return changes


def normalize_support_activity_maintenance_plans(project: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Return a canonical copy for direct compiler paths plus migration provenance."""
    normalized = deepcopy(project)
    return normalized, _normalize_support_activity_maintenance_methods(normalized)


def normalize_aircraft_pre_life(project: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Materialize canonical pre-life counters before clean-Project pruning.

    The counters are cumulative consumption since the last preventive action.
    Legacy required-life, remaining-life, and total-cycle fields are not
    convertible to consumption since the last preventive action.
    """
    normalized = deepcopy(project)
    changes: list[str] = []
    containers: list[tuple[str, Any]] = [("combatUnit", normalized.get("combatUnit"))]
    mission_profile = normalized.get("missionProfile")
    if isinstance(mission_profile, dict):
        containers.append(("missionProfile.combatUnit", mission_profile.get("combatUnit")))
    for unit_path, combat_unit in containers:
        if not isinstance(combat_unit, dict) or not isinstance(combat_unit.get("members"), list):
            continue
        for member_index, member in enumerate(combat_unit["members"]):
            if not isinstance(member, dict):
                continue
            member_path = f"{unit_path}.members[{member_index}]"
            for canonical, legacy, kind in _AIRCRAFT_PRE_LIFE_FIELDS:
                canonical_present = canonical in member
                legacy_present = legacy is not None and legacy in member
                if canonical_present and legacy_present and member[canonical] != member[legacy]:
                    raise ValueError(
                        f"clean Project JSON failed aircraft_support_v1 schema at {member_path}.{legacy}: "
                        f"legacy value conflicts with {canonical}"
                    )
                if not canonical_present:
                    if legacy_present:
                        member[canonical] = member[legacy]
                        changes.append(f"{member_path}.{canonical}=legacy:{legacy}")
                    else:
                        member[canonical] = 0
                        changes.append(f"{member_path}.{canonical}=historicalDefault:0")
                value = member[canonical]
                is_number = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                is_valid = is_number and value >= 0 and (kind != "integer" or isinstance(value, int))
                if not is_valid:
                    expected = "non-negative integer" if kind == "integer" else "non-negative finite number"
                    raise ValueError(
                        f"clean Project JSON failed aircraft_support_v1 schema at {member_path}.{canonical}: "
                        f"expected {expected}"
                    )
                if legacy is not None:
                    member.pop(legacy, None)
    return normalized, changes


def _validate_support_activity_maintenance_methods(activity: dict[str, Any], path: str, target: str) -> None:
    has_methods = "maintenanceMethods" in activity
    has_ratio = "replacementRatio" in activity
    if has_methods != has_ratio:
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}: "
            "maintenanceMethods and replacementRatio must appear together"
        )
    if not has_methods:
        return
    methods = activity["maintenanceMethods"]
    if (
        not isinstance(methods, list)
        or not 1 <= len(methods) <= len(_MAINTENANCE_METHOD_VALUES)
        or any(not isinstance(method, str) or method not in _MAINTENANCE_METHOD_VALUES for method in methods)
        or len(set(methods)) != len(methods)
    ):
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}.maintenanceMethods: "
            "expected one or both canonical maintenance methods without duplicates"
        )
    ratio = activity["replacementRatio"]
    if not isinstance(ratio, (int, float)) or isinstance(ratio, bool) or not math.isfinite(ratio) or not 0 <= ratio <= 1:
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}.replacementRatio: expected a finite number between 0 and 1"
        )
    if methods == ["non_replacement"] and ratio != 0:
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}.replacementRatio: non_replacement-only plans require 0"
        )
    if methods == ["replacement"] and ratio != 1:
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}.replacementRatio: replacement-only plans require 1"
        )
    try:
        decimal_ratio = Decimal(str(ratio))
    except (InvalidOperation, ValueError):
        decimal_ratio = Decimal("NaN")
    if not decimal_ratio.is_finite() or decimal_ratio != decimal_ratio.quantize(Decimal("0.0001")):
        raise ValueError(
            f"clean Project JSON failed {target} schema at {path}.replacementRatio: expected at most four decimal places"
        )


def _canonical_support_activity_plan_type(activity: dict[str, Any]) -> str:
    plan_type = str(activity.get("planType") or "").strip()
    activity_type = str(activity.get("activityType") or "").strip()
    if plan_type in _SUPPORT_ACTIVITY_PLAN_TYPES:
        return plan_type
    if plan_type in {"后勤保障活动方案"}:
        return "后勤保障方案"
    if plan_type:
        return plan_type
    combined = activity_type.lower()
    if "修复性维修" in combined or "corrective" in combined:
        return "修复性维修方案"
    if "预防性维修" in combined or "preventive" in combined:
        return "预防性维修方案"
    if "后勤保障" in combined or "logistics" in combined:
        return "后勤保障方案"
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
    _prune_typed_list(project.get("products"), _PRODUCT_FIELDS)
    _prune_components(project.get("components"))
    _strip_reliability_block_diagram_non_model_fields(project.get("reliabilityBlockDiagram"))
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
    _keep_fields(value, {"runtimeMode", "tree", "relations"})
    tree = value.get("tree")
    if isinstance(tree, dict):
        _prune_support_organization_node(tree)
    elif isinstance(tree, list):
        for node in tree:
            if isinstance(node, dict):
                _prune_support_organization_node(node)
    _prune_typed_list(value.get("relations"), _ORGANIZATION_RELATION_FIELDS)


def _prune_support_organization_node(value: dict[str, Any]) -> None:
    _keep_fields(value, _ORGANIZATION_NODE_FIELDS)
    if isinstance(value.get("serviceScope"), dict):
        _keep_fields(value["serviceScope"], _SERVICE_SCOPE_FIELDS)
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
