"""Server-side validation for M5 modeling import packages."""

from __future__ import annotations

from copy import deepcopy
from math import isfinite
from typing import Any


MODELING_IMPORT_PAGE_MAP = {
    "missionProfiles": "任务剖面参数",
    "equipmentAssets": "装备系统建模",
    "supportResources": "保障资源建模",
    "supportActivities": "保障活动建模",
}

COLLECTION_RULES = {
    "missionProfiles": {
        "required_fields": ["id", "name", "durationHours"],
        "numeric_fields": ["durationHours"],
    },
    "equipmentAssets": {
        "required_fields": ["id", "name", "quantity"],
        "numeric_fields": ["quantity", "mtbfHours"],
        "references": [{"field": "parentId", "target": "equipmentAssets"}],
    },
    "supportResources": {
        "required_fields": ["id", "name", "capacity"],
        "numeric_fields": ["capacity"],
    },
    "supportActivities": {
        "required_fields": ["id", "name", "equipmentId", "resourceId", "durationHours"],
        "numeric_fields": ["durationHours"],
        "references": [
            {"field": "equipmentId", "target": "equipmentAssets"},
            {"field": "resourceId", "target": "supportResources"},
        ],
    },
}


def validate_modeling_import_package(import_package: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    _validate_package_roots(import_package, issues)
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    object_ids = _collect_object_ids(objects, issues)

    for collection, rules in COLLECTION_RULES.items():
        rows = objects.get(collection) if isinstance(objects.get(collection), list) else []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                issues.append(_issue("invalid_object", collection, f"{collection}[{index}]", f"objects.{collection}[{index}]", "对象必须是 JSON object。"))
                continue
            _validate_required_fields(collection, row, index, rules.get("required_fields", []), issues)
            _validate_numeric_fields(collection, row, index, rules.get("numeric_fields", []), issues)
            _validate_references(collection, row, index, rules.get("references", []), object_ids, issues)

    _validate_published_reference_protection(import_package, issues)

    return {
        "ok": not issues,
        "schemaVersion": "modeling-import-v1",
        "status": "valid" if not issues else "invalid",
        "issues": issues,
    }


def modeling_import_to_project(import_package: dict[str, Any]) -> dict[str, Any]:
    objects = import_package.get("objects", {})
    mission = _first_dict(objects.get("missionProfiles")) or {}
    equipment_profile = objects.get("equipment") if isinstance(objects.get("equipment"), dict) else {}
    equipment_assets = [row for row in objects.get("equipmentAssets", []) if isinstance(row, dict)]
    resources = [row for row in objects.get("supportResources", []) if isinstance(row, dict)]
    activities = [row for row in objects.get("supportActivities", []) if isinstance(row, dict)]
    lifecycle = import_package.get("lifecycle") if isinstance(import_package.get("lifecycle"), dict) else {}
    version = _safe_positive_int(lifecycle.get("version"), 1)
    duration_hours = _safe_positive_float(mission.get("durationHours"), 1)
    equipment = _equipment_profile_to_project(equipment_profile, equipment_assets, activities)

    return {
        "schema_version": "project-v0",
        "project_id": str(import_package["projectId"]),
        "project_version": f"import-v{version}",
        "scenarioId": str(import_package["importId"]).replace("_", "-"),
        "activeModule": "sparePlanning",
        "projectInfo": _project_object(objects, mission, "projectInfo", {}),
        "airports": _project_object_list(objects, mission, "airports"),
        "missionAreas": _project_object_list(objects, mission, "missionAreas"),
        "experiment": _project_object(objects, mission, "experiment", {"seed": 20260619, "steps": max(1, int(duration_hours))}),
        "missionProfile": _mission_profile_to_project(mission, import_package["importId"]),
        "basicMission": _project_object(objects, mission, "basicMission", {"minRequiredSorties": max(1, len(activities))}),
        "missionPhases": _project_object_list(objects, mission, "missionPhases"),
        "combatUnit": _project_object(objects, mission, "combatUnit", {}),
        "equipment": equipment,
        "components": [_equipment_asset_to_component(row) for row in equipment_assets],
        "supportNodes": [_support_resource_to_node(row) for row in resources],
        "supportActivities": [_support_activity_to_project(row) for row in activities],
        "supportOrganization": _project_object(objects, mission, "supportOrganization", {}),
        "reliabilityBlockDiagram": _project_object(objects, mission, "reliabilityBlockDiagram", {}),
        "monteCarlo": _project_object(objects, mission, "monteCarlo", {"spareMultipliers": [1]}),
        "analysisRequests": _project_object(objects, mission, "analysisRequests", {}),
    }


def _validate_package_roots(import_package: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    if import_package.get("schemaVersion") != "modeling-import-v1":
        issues.append(_issue("invalid_schema_version", None, "modeling-import-package", "schemaVersion", "schemaVersion 必须是 modeling-import-v1。"))

    for field in ("importId", "projectId", "lifecycle"):
        if import_package.get(field) not in (None, ""):
            continue
        issues.append(_issue("missing_required_root", None, "modeling-import-package", field, f"{field} 是导入包必填字段。"))
    _validate_lifecycle(import_package, issues)

    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    for collection in COLLECTION_RULES:
        if isinstance(objects.get(collection), list):
            continue
        issues.append(_issue("missing_required_root", None, "modeling-import-package", f"objects.{collection}", f"objects.{collection} 是导入包必填对象集合。"))


def _validate_lifecycle(import_package: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    lifecycle = import_package.get("lifecycle")
    if lifecycle in (None, ""):
        return
    if not isinstance(lifecycle, dict):
        issues.append(_issue("invalid_lifecycle", None, "modeling-import-package", "lifecycle", "lifecycle 必须是包含 state、version 和 referencedRunIds 的对象。"))
        return
    if lifecycle.get("state") not in ("draft", "published"):
        issues.append(_issue("invalid_lifecycle_state", None, "modeling-import-package", "lifecycle.state", "lifecycle.state 必须是 draft 或 published。"))
    version = lifecycle.get("version")
    if not _is_positive_integer_value(version):
        issues.append(_issue("invalid_lifecycle_version", None, "modeling-import-package", "lifecycle.version", "lifecycle.version 必须是大于等于 1 的整数。"))
    referenced_run_ids = lifecycle.get("referencedRunIds")
    if not isinstance(referenced_run_ids, list) or any(not isinstance(item, str) for item in referenced_run_ids):
        issues.append(_issue("invalid_lifecycle_references", None, "modeling-import-package", "lifecycle.referencedRunIds", "lifecycle.referencedRunIds 必须是 run_id 字符串数组。"))


def _collect_object_ids(objects: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, set[str]]:
    object_ids: dict[str, set[str]] = {}
    for collection in COLLECTION_RULES:
        object_ids[collection] = set()
        rows = objects.get(collection) if isinstance(objects.get(collection), list) else []
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not row.get("id"):
                continue
            object_id = str(row["id"])
            if object_id in object_ids[collection]:
                issues.append(_issue("duplicate_id", collection, object_id, f"objects.{collection}[{index}].id", f"对象编号 {object_id} 在 {collection} 中重复。"))
            object_ids[collection].add(object_id)
    return object_ids


def _validate_required_fields(
    collection: str,
    row: dict[str, Any],
    index: int,
    fields: list[str],
    issues: list[dict[str, Any]],
) -> None:
    for field in fields:
        if row.get(field) not in (None, ""):
            continue
        issues.append(_issue("missing_required_field", collection, str(row.get("id") or f"{collection}[{index}]"), f"objects.{collection}[{index}].{field}", f"{field} 是必填字段。"))


def _validate_numeric_fields(
    collection: str,
    row: dict[str, Any],
    index: int,
    fields: list[str],
    issues: list[dict[str, Any]],
) -> None:
    for field in fields:
        if field not in row:
            continue
        value = row[field]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not isfinite(value) or value <= 0:
            issues.append(_issue("invalid_number", collection, str(row.get("id") or f"{collection}[{index}]"), f"objects.{collection}[{index}].{field}", f"{field} 必须是大于 0 的数值。"))


def _validate_references(
    collection: str,
    row: dict[str, Any],
    index: int,
    references: list[dict[str, str]],
    object_ids: dict[str, set[str]],
    issues: list[dict[str, Any]],
) -> None:
    for reference in references:
        value = row.get(reference["field"])
        if not value:
            continue
        if str(value) not in object_ids.get(reference["target"], set()):
            issues.append(_issue("missing_reference", collection, str(row.get("id") or f"{collection}[{index}]"), f"objects.{collection}[{index}].{reference['field']}", f"{reference['field']} 引用了不存在的 {reference['target']} 对象 {value}。"))


def _validate_published_reference_protection(import_package: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    lifecycle = import_package.get("lifecycle") if isinstance(import_package.get("lifecycle"), dict) else {}
    referenced_run_ids = lifecycle.get("referencedRunIds") if isinstance(lifecycle.get("referencedRunIds"), list) else []
    if lifecycle.get("state") != "published" or not referenced_run_ids:
        return

    changes = import_package.get("changes") if isinstance(import_package.get("changes"), list) else []
    for change in changes:
        if not isinstance(change, dict) or change.get("operation") not in ("update", "delete"):
            continue
        object_type = str(change.get("objectType") or "modeling-import")
        object_id = str(change.get("objectId") or object_type)
        field_path = str(change.get("fieldPath") or f"objects.{object_type}")
        issues.append(_issue("published_reference_protection", object_type, object_id, field_path, f"已发布且被运行 {', '.join(referenced_run_ids)} 引用的项目数据不能无痕覆盖，应生成新版本。"))


def _issue(code: str, collection: str | None, object_id: str, field_path: str, message: str) -> dict[str, str]:
    return {
        "code": code,
        "severity": "error",
        "page": MODELING_IMPORT_PAGE_MAP.get(collection or "", "建模数据入口"),
        "object_id": object_id,
        "field_path": field_path,
        "message": message,
    }


def _first_dict(rows: Any) -> dict[str, Any] | None:
    if not isinstance(rows, list):
        return None
    for row in rows:
        if isinstance(row, dict):
            return row
    return None


def _project_object(objects: dict[str, Any], mission: dict[str, Any], key: str, fallback: dict[str, Any]) -> dict[str, Any]:
    value = objects.get(key)
    if isinstance(value, dict):
        return deepcopy(value)
    value = mission.get(key)
    if isinstance(value, dict):
        return deepcopy(value)
    return deepcopy(fallback)


def _project_object_list(objects: dict[str, Any], mission: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = objects.get(key)
    if isinstance(value, list):
        return deepcopy([row for row in value if isinstance(row, dict)])
    value = mission.get(key)
    if isinstance(value, list):
        return deepcopy([row for row in value if isinstance(row, dict)])
    return []


def _mission_profile_to_project(mission: dict[str, Any], import_id: str) -> dict[str, Any]:
    project_only_fields = {
        "airports",
        "missionAreas",
        "experiment",
        "basicMission",
        "missionPhases",
        "combatUnit",
        "equipment",
        "reliabilityBlockDiagram",
        "monteCarlo",
    }
    profile = {key: deepcopy(value) for key, value in mission.items() if key not in project_only_fields}
    profile["sourceImportId"] = import_id
    return profile


def _equipment_profile_to_project(
    equipment_profile: dict[str, Any],
    equipment_assets: list[dict[str, Any]],
    activities: list[dict[str, Any]],
) -> dict[str, Any]:
    equipment = deepcopy(equipment_profile)
    aircraft_models = [
        str(row.get("aircraftModel"))
        for row in equipment_assets
        if row.get("aircraftModel") not in (None, "")
    ]
    unique_models = list(dict.fromkeys(aircraft_models))
    if unique_models:
        equipment.setdefault("wholeMachineModels", unique_models)
        equipment.setdefault("model", unique_models[0])
    equipment.setdefault("quantity", sum(_safe_positive_int(row.get("quantity"), 1) for row in equipment_assets if not row.get("parentId")))
    equipment.setdefault("minRequiredSorties", max(1, len(activities)))
    return equipment


def _equipment_asset_to_component(row: dict[str, Any]) -> dict[str, Any]:
    component = deepcopy(row)
    component["id"] = str(row.get("id") or "equipment")
    component["name"] = str(row.get("name") or row.get("id") or "equipment")
    component["quantity"] = _safe_positive_int(row.get("quantity"), 1)
    if row.get("parentId") not in (None, ""):
        component["parentId"] = str(row["parentId"])
    mtbf_hours = _safe_positive_float(row.get("mtbfHours"), 0)
    if mtbf_hours > 0:
        component["mtbfHours"] = mtbf_hours
        component.setdefault("failureRate", 1 / mtbf_hours)
    return component


def _support_resource_to_node(row: dict[str, Any]) -> dict[str, Any]:
    capacity = _safe_positive_int(row.get("capacity"), 1)
    node = deepcopy(row)
    node["id"] = str(row.get("id") or "support-resource")
    node["name"] = str(row.get("name") or row.get("id") or "support-resource")
    node["capacity"] = capacity
    node.setdefault("personnelCapacity", capacity)
    node.setdefault("equipmentCapacity", capacity)
    node.setdefault("inventory", {})
    return node


def _support_activity_to_project(row: dict[str, Any]) -> dict[str, Any]:
    activity = deepcopy(row)
    activity.setdefault("activityName", row.get("name") or row.get("id") or "保障活动")
    activity.setdefault("activityType", row.get("type") or row.get("name") or "保障活动")
    activity.setdefault("requiredPersonnel", 1)
    activity.setdefault("requiredDevices", 1)
    activity.setdefault("priority", 1)
    activity.setdefault("jobs", [])
    return activity


def _safe_positive_int(value: Any, fallback: int) -> int:
    number = _safe_positive_float(value, fallback)
    return max(1, int(number))


def _is_positive_integer_value(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value >= 1
    if isinstance(value, float):
        return isfinite(value) and value.is_integer() and value >= 1
    return False


def _safe_positive_float(value: Any, fallback: float) -> float:
    if isinstance(value, bool):
        return float(fallback)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if not isfinite(number) or number <= 0:
        return float(fallback)
    return number
