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
}
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
        import jsonschema

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
            if key in _POLLUTION_KEYS:
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
