"""Server-side validation for M5 modeling import packages."""

from __future__ import annotations

from copy import deepcopy
import hashlib
from math import isfinite
import re
from typing import Any

from src.spare_mvp_backend.project_payload import strip_project_sweep


MODELING_IMPORT_PAGE_MAP = {
    "missionProfiles": "任务剖面参数",
    "equipmentAssets": "装备系统建模",
    "reliabilityBlockDiagram": "装备系统建模",
    "supportResources": "保障资源建模",
    "supportActivities": "保障活动建模",
    "supportOrganization": "保障组织建模",
    "transportPolicies": "保障资源建模",
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
        "required_fields": ["id", "name"],
        "numeric_fields": ["capacity", "quantity"],
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

CORE_TABLE_DOMAINS = {"missionProfiles", "equipmentAssets"}
DISABLEABLE_COLLECTIONS = {"supportResources", "supportActivities"}
OBJECT_TABLE_DOMAINS = {"reliabilityBlockDiagram", "supportOrganization"}
MODELING_IMPORT_TABLE_DOMAINS = [
    "missionProfiles",
    "equipmentAssets",
    "reliabilityBlockDiagram",
    "supportResources",
    "supportActivities",
    "supportOrganization",
    "transportPolicies",
]


def validate_modeling_import_package(import_package: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    _validate_retired_validation_level(import_package, issues)
    used_tables = _normalize_used_tables(import_package, issues)

    _validate_package_roots(import_package, issues, warnings, used_tables)
    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    object_ids = _collect_object_ids(objects, issues)

    for collection, rules in COLLECTION_RULES.items():
        if _is_disabled_collection_missing(collection, objects, used_tables):
            continue
        rows = objects.get(collection) if isinstance(objects.get(collection), list) else []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                issues.append(_issue("invalid_object", collection, f"{collection}[{index}]", f"objects.{collection}[{index}]", "对象必须是 JSON object。"))
                continue
            _validate_required_fields(collection, row, index, rules.get("required_fields", []), issues)
            _validate_numeric_fields(collection, row, index, rules.get("numeric_fields", []), issues)
            if collection == "equipmentAssets":
                _validate_equipment_asset_k_out_of_n(row, index, issues)
            _validate_references(collection, row, index, rules.get("references", []), object_ids, issues)

    _validate_equipment_asset_hierarchy(objects.get("equipmentAssets"), issues)
    _validate_mission_profile_basic_missions(objects.get("missionProfiles"), issues)
    if used_tables.get("supportActivities") is not False:
        _validate_basic_mission_support_activity_names(
            objects.get("missionProfiles"),
            objects.get("supportActivities"),
            issues,
        )
    _validate_published_reference_protection(import_package, issues)

    return {
        "ok": not issues,
        "schemaVersion": "modeling-import-v1",
        "status": "valid" if not issues else "invalid",
        "usedTables": used_tables,
        "issues": issues,
        "warnings": warnings,
    }


def modeling_import_to_project(import_package: dict[str, Any], validation: dict[str, Any] | None = None) -> dict[str, Any]:
    objects = import_package.get("objects", {})
    mission = _first_dict(objects.get("missionProfiles")) or {}
    equipment_assets = [row for row in objects.get("equipmentAssets", []) if isinstance(row, dict)]
    resources = [row for row in objects.get("supportResources", []) if isinstance(row, dict)]
    transport_policies = [row for row in objects.get("transportPolicies", []) if isinstance(row, dict)]
    activities = [row for row in objects.get("supportActivities", []) if isinstance(row, dict)]
    lifecycle = import_package.get("lifecycle") if isinstance(import_package.get("lifecycle"), dict) else {}
    version = _safe_positive_int(lifecycle.get("version"), 1)
    duration_hours = _safe_positive_float(mission.get("durationHours"), 1)

    if validation is None:
        validation = validate_modeling_import_package(import_package)
    used_tables = validation.get("usedTables") if isinstance(validation.get("usedTables"), dict) else {}
    if used_tables.get("supportResources") is False:
        resources = []
    if used_tables.get("transportPolicies") is False:
        transport_policies = []
    if used_tables.get("supportActivities") is False:
        activities = []

    combat_unit = _project_object(objects, mission, "combatUnit", {})
    basic_missions = _project_basic_missions(objects, mission, activities)
    if used_tables.get("supportActivities") is False:
        _drop_basic_mission_support_activity_names(basic_missions)
    mission_profile = _mission_profile_to_project(mission, import_package["importId"])
    _sync_composite_task_basic_mission_refs(mission_profile, basic_missions)

    return strip_project_sweep({
        "schema_version": "project-v0",
        "project_id": str(import_package["projectId"]),
        "project_version": f"import-v{version}",
        "scenarioId": str(import_package["importId"]).replace("_", "-"),
        "activeModule": "sparePlanning",
        "projectInfo": _project_object(objects, mission, "projectInfo", {}),
        "airports": _combat_unit_airports(combat_unit),
        "missionProfile": mission_profile,
        "basicMissions": basic_missions,
        "missionPhases": _project_object_list(objects, mission, "missionPhases"),
        "combatUnit": combat_unit,
        "components": [_equipment_asset_to_component(row) for row in equipment_assets],
        "supportNodes": _support_nodes_from_resources(resources),
        "supportResources": _support_resources_from_import_resources(resources),
        "transportPolicies": _transport_policies_from_import_resources(resources, transport_policies),
        "supportActivities": [
            _support_activity_to_project(row, _support_resource_name_by_id(resources))
            for row in activities
        ],
        "supportOrganization": (
            {}
            if used_tables.get("supportOrganization") is False
            else _support_organization_to_project(_project_object(objects, mission, "supportOrganization", {}))
        ),
        "reliabilityBlockDiagram": _project_object(objects, mission, "reliabilityBlockDiagram", {}),
        "modelingImportValidation": {
            "importId": str(import_package["importId"]),
            "usedTables": deepcopy(validation["usedTables"]),
            "warnings": deepcopy(validation["warnings"]),
            "disabledDomains": _disabled_domains(validation["usedTables"]),
        },
    })


def _validate_retired_validation_level(import_package: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    if "validationLevel" not in import_package:
        return
    issues.append(
        _issue(
            "retired_validation_level",
            None,
            "modeling-import-package",
            "validationLevel",
            "validationLevel 已退役；请使用 usedTables 声明已建模或未建模的表域。",
        )
    )


def _normalize_used_tables(
    import_package: dict[str, Any],
    issues: list[dict[str, Any]],
) -> dict[str, bool]:
    raw_used_tables = import_package.get("usedTables")
    if raw_used_tables is None:
        raw_used_tables = {}
    elif not isinstance(raw_used_tables, dict):
        issues.append(_issue("invalid_used_tables", None, "modeling-import-package", "usedTables", "usedTables 必须是对象，且每个字段必须是布尔值。"))
        raw_used_tables = {}

    normalized: dict[str, bool] = {}
    for collection in COLLECTION_RULES:
        normalized[collection] = _normalize_used_table_flag(raw_used_tables, collection, issues)
    for domain in MODELING_IMPORT_TABLE_DOMAINS:
        if domain in normalized:
            continue
        normalized[domain] = _normalize_used_table_flag(raw_used_tables, domain, issues)
    for domain in sorted(str(key) for key in raw_used_tables if str(key) not in normalized):
        issues.append(_issue("invalid_used_table_domain", None, "modeling-import-package", f"usedTables.{domain}", f"usedTables.{domain} 不是 modeling-import-v1 支持的表域。"))
    return normalized


def _normalize_used_table_flag(
    raw_used_tables: dict[str, Any],
    domain: str,
    issues: list[dict[str, Any]],
) -> bool:
    if domain not in raw_used_tables:
        return True
    value = raw_used_tables[domain]
    if isinstance(value, bool):
        if domain in CORE_TABLE_DOMAINS and not value:
            issues.append(_issue("invalid_used_table_flag", None, "modeling-import-package", f"usedTables.{domain}", f"usedTables.{domain} 是核心表域，不能声明为 false。"))
            return True
        return value
    issues.append(_issue("invalid_used_table_flag", None, "modeling-import-package", f"usedTables.{domain}", f"usedTables.{domain} 必须是布尔值。"))
    return True


def _validate_package_roots(
    import_package: dict[str, Any],
    issues: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    used_tables: dict[str, bool],
) -> None:
    if import_package.get("schemaVersion") != "modeling-import-v1":
        issues.append(_issue("invalid_schema_version", None, "modeling-import-package", "schemaVersion", "schemaVersion 必须是 modeling-import-v1。"))

    for field in ("importId", "projectId", "lifecycle"):
        if import_package.get(field) not in (None, ""):
            continue
        issues.append(_issue("missing_required_root", None, "modeling-import-package", field, f"{field} 是导入包必填字段。"))
    _validate_lifecycle(import_package, issues)

    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    for collection in COLLECTION_RULES:
        value = objects.get(collection)
        if isinstance(value, list) and value:
            continue
        if isinstance(value, list):
            if _is_disabled_domain(collection, used_tables):
                _append_scope_warning(warnings, collection, f"objects.{collection}")
                continue
            issues.append(_issue("invalid_declared_table", collection, "modeling-import-package", f"objects.{collection}", f"objects.{collection} 是导入包声明建模的必填对象集合，且至少需要一行。"))
            continue
        if _is_disabled_domain(collection, used_tables):
            _append_scope_warning(warnings, collection, f"objects.{collection}")
            continue
        issues.append(_issue("invalid_declared_table", collection, "modeling-import-package", f"objects.{collection}", f"objects.{collection} 是导入包声明建模的必填对象集合。"))

    for domain in OBJECT_TABLE_DOMAINS:
        _validate_declared_object_domain(objects, domain, used_tables, issues, warnings)
    _validate_declared_transport_policies(objects, used_tables, issues, warnings)

    for domain in _disabled_domains(used_tables):
        if domain in COLLECTION_RULES or domain in OBJECT_TABLE_DOMAINS or domain == "transportPolicies":
            continue
        _append_scope_warning(warnings, domain, f"objects.{domain}")


def _validate_declared_object_domain(
    objects: dict[str, Any],
    domain: str,
    used_tables: dict[str, bool],
    issues: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    value = objects.get(domain)
    disabled = _is_disabled_domain(domain, used_tables)
    if isinstance(value, dict):
        if domain == "reliabilityBlockDiagram":
            if value:
                return
            if disabled:
                _append_scope_warning(warnings, domain, f"objects.{domain}")
                return
            issues.append(_issue("invalid_declared_table", domain, "modeling-import-package", f"objects.{domain}", f"objects.{domain} 是导入包声明建模的必填对象，且至少需要一个字段。"))
            return
        if domain == "supportOrganization":
            tree = value.get("tree")
            if (isinstance(tree, list) and tree) or isinstance(tree, dict):
                return
            if disabled:
                _append_scope_warning(warnings, domain, f"objects.{domain}")
                return
            field_path = f"objects.{domain}.tree" if "tree" in value else f"objects.{domain}"
            issues.append(_issue("invalid_declared_table", domain, "modeling-import-package", field_path, f"objects.{domain}.tree 是导入包声明建模的必填组织树，且至少需要一个节点。"))
            return
        return
    if disabled:
        _append_scope_warning(warnings, domain, f"objects.{domain}")
        return
    issues.append(_issue("invalid_declared_table", domain, "modeling-import-package", f"objects.{domain}", f"objects.{domain} 是导入包声明建模的必填对象。"))


def _validate_declared_transport_policies(
    objects: dict[str, Any],
    used_tables: dict[str, bool],
    issues: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    policies = objects.get("transportPolicies")
    if _is_disabled_domain("transportPolicies", used_tables):
        _append_scope_warning(warnings, "transportPolicies", "objects.transportPolicies")
        return
    if not isinstance(policies, list):
        issues.append(_issue("invalid_declared_table", "transportPolicies", "modeling-import-package", "objects.transportPolicies", "声明使用 transportPolicies，但缺少 transportPolicies 表。"))
        return
    if not policies:
        issues.append(_issue("invalid_declared_table", "transportPolicies", "modeling-import-package", "objects.transportPolicies", "声明使用 transportPolicies，但 transportPolicies 表为空。"))
        return


def _is_disabled_collection_missing(collection: str, objects: dict[str, Any], used_tables: dict[str, bool]) -> bool:
    return collection in DISABLEABLE_COLLECTIONS and _is_disabled_domain(collection, used_tables) and not isinstance(objects.get(collection), list)


def _is_disabled_domain(domain: str, used_tables: dict[str, bool]) -> bool:
    return used_tables.get(domain) is False


def _disabled_domains(used_tables: dict[str, bool]) -> list[str]:
    return [domain for domain, enabled in used_tables.items() if enabled is False]


def _append_scope_warning(warnings: list[dict[str, Any]], domain: str, field_path: str) -> None:
    if any(warning.get("code") == "scope_not_modeled" and warning.get("field_path") == field_path for warning in warnings):
        return
    warnings.append(
        _warning(
            "scope_not_modeled",
            domain,
            "modeling-import-package",
            field_path,
            f"导入声明未建模 {domain}，该域不会阻断校验或编译。",
        )
    )


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
            if collection == "supportResources":
                support_node_name = str(row.get("supportNodeName") or "").strip()
                if support_node_name:
                    object_ids[collection].add(support_node_name)
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


def _validate_equipment_asset_k_out_of_n(row: dict[str, Any], index: int, issues: list[dict[str, Any]]) -> None:
    if "kOutOfN" not in row:
        return
    k_out = row.get("kOutOfN")
    object_id = str(row.get("id") or f"equipmentAssets[{index}]")
    field_path = f"objects.equipmentAssets[{index}].kOutOfN.k"
    if not isinstance(k_out, dict):
        issues.append(_issue("invalid_equipment_k_out_of_n", "equipmentAssets", object_id, field_path, "K 值不能为空；默认应等于数量 n。"))
        return
    quantity = _safe_positive_int(row.get("quantity"), 1)
    raw_k = k_out.get("k")
    if not _is_positive_integer_value(raw_k):
        issues.append(_issue("invalid_equipment_k_out_of_n", "equipmentAssets", object_id, field_path, "K 值必须为正整数，且满足 1 ≤ k ≤ n。"))
        return
    if int(float(raw_k)) > quantity:
        issues.append(_issue("invalid_equipment_k_out_of_n", "equipmentAssets", object_id, field_path, "K 值不能大于数量 n；K 值必须满足 1 ≤ k ≤ n。"))


def _validate_equipment_asset_hierarchy(rows: Any, issues: list[dict[str, Any]]) -> None:
    assets = rows if isinstance(rows, list) else []
    by_id = {str(row["id"]): row for row in assets if isinstance(row, dict) and row.get("id") not in (None, "")}
    for index, row in enumerate(assets):
        if not isinstance(row, dict):
            continue
        if str(row.get("productType") or "").strip() != "SRU":
            continue
        parent = by_id.get(str(row.get("parentId") or ""))
        if str((parent or {}).get("productType") or "").strip() == "LRU":
            continue
        issues.append(_issue("invalid_sru_parent", "equipmentAssets", str(row.get("id") or f"equipmentAssets[{index}]"), f"objects.equipmentAssets[{index}].parentId", "SRU 的上级必须是 LRU。"))


def _validate_mission_profile_basic_missions(rows: Any, issues: list[dict[str, Any]]) -> None:
    profiles = rows if isinstance(rows, list) else []
    for index, row in enumerate(profiles):
        if not isinstance(row, dict):
            continue
        object_id = str(row.get("id") or f"missionProfiles[{index}]")
        if isinstance(row.get("basicMission"), dict):
            issues.append(_issue("retired_basic_mission", "missionProfiles", object_id, f"objects.missionProfiles[{index}].basicMission", "basicMission 已退役；请使用 basicMissions 数组。"))
        basic_missions = row.get("basicMissions")
        if not isinstance(basic_missions, list) or not any(isinstance(item, dict) for item in basic_missions):
            issues.append(_issue("missing_basic_missions", "missionProfiles", object_id, f"objects.missionProfiles[{index}].basicMissions", "basicMissions 必须包含至少一个基本任务。"))
            continue
        for mission_index, basic_mission in enumerate(basic_missions):
            if not isinstance(basic_mission, dict):
                continue
            if basic_mission.get("id") in (None, ""):
                issues.append(_issue("missing_basic_mission_id", "missionProfiles", object_id, f"objects.missionProfiles[{index}].basicMissions[{mission_index}].id", "basicMissions[].id 是必填字段。"))


def _validate_basic_mission_support_activity_names(
    mission_profiles: Any,
    support_activities: Any,
    issues: list[dict[str, Any]],
) -> None:
    activity_name_counts: dict[str, int] = {}
    for activity in support_activities if isinstance(support_activities, list) else []:
        if not isinstance(activity, dict):
            continue
        activity_name = _clean_text(activity.get("activityName"))
        if activity_name:
            activity_name_counts[activity_name] = activity_name_counts.get(activity_name, 0) + 1

    profiles = mission_profiles if isinstance(mission_profiles, list) else []
    for profile_index, profile in enumerate(profiles):
        if not isinstance(profile, dict):
            continue
        object_id = str(profile.get("id") or f"missionProfiles[{profile_index}]")
        basic_missions = profile.get("basicMissions")
        if not isinstance(basic_missions, list):
            continue
        for mission_index, basic_mission in enumerate(basic_missions):
            if not isinstance(basic_mission, dict):
                continue
            support_activity_name = _clean_text(basic_mission.get("supportActivityName"))
            if not support_activity_name:
                continue
            if activity_name_counts.get(support_activity_name, 0) == 1:
                continue
            issues.append(_issue(
                "invalid_basic_mission_support_activity_name",
                "missionProfiles",
                object_id,
                f"objects.missionProfiles[{profile_index}].basicMissions[{mission_index}].supportActivityName",
                "basicMissions[].supportActivityName 必须唯一匹配 supportActivities[].activityName，不能回退匹配 name 或 id。",
            ))


def _drop_basic_mission_support_activity_names(basic_missions: list[dict[str, Any]]) -> None:
    for basic_mission in basic_missions:
        if isinstance(basic_mission, dict):
            basic_mission.pop("supportActivityName", None)


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


def _warning(code: str, collection: str | None, object_id: str, field_path: str, message: str) -> dict[str, str]:
    return {
        "code": code,
        "severity": "warning",
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


def _project_basic_missions(objects: dict[str, Any], mission: dict[str, Any], activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    basic_missions = _project_object_list(objects, mission, "basicMissions")
    if not basic_missions:
        basic_missions = [{"minRequiredSorties": max(1, len(activities))}]
    for index, basic_mission in enumerate(basic_missions):
        basic_mission["id"] = _basic_mission_id(basic_mission, index)
        if basic_mission.get("name") in (None, "") and basic_mission.get("basicTaskName") not in (None, ""):
            basic_mission["name"] = str(basic_mission["basicTaskName"])
        if basic_mission.get("basicTaskName") in (None, "") and basic_mission.get("name") not in (None, ""):
            basic_mission["basicTaskName"] = str(basic_mission["name"])
    return basic_missions


def _sync_composite_task_basic_mission_refs(mission_profile: dict[str, Any], basic_missions: list[dict[str, Any]]) -> None:
    basic_by_id = {str(row.get("id")): row for row in basic_missions if row.get("id") not in (None, "")}
    basic_by_name: dict[str, dict[str, Any]] = {}
    for row in basic_missions:
        for value in (row.get("name"), row.get("basicTaskName"), row.get("missionId"), row.get("taskNo")):
            key = str(value or "").strip()
            if key:
                basic_by_name.setdefault(key, row)
    composite_tasks = mission_profile.get("compositeTasks") if isinstance(mission_profile.get("compositeTasks"), list) else []
    for composite_task in composite_tasks:
        if not isinstance(composite_task, dict):
            continue
        task_items = composite_task.get("taskItems") if isinstance(composite_task.get("taskItems"), list) else []
        for item in task_items:
            if not isinstance(item, dict):
                continue
            basic = None
            basic_id = str(item.get("basicMissionId") or "").strip()
            if basic_id:
                basic = basic_by_id.get(basic_id)
            if basic is None:
                basic = basic_by_name.get(str(item.get("basicTaskName") or "").strip())
            if basic is None:
                continue
            item["basicMissionId"] = str(basic.get("id"))
            display_name = str(basic.get("name") or basic.get("basicTaskName") or basic.get("missionId") or "").strip()
            if display_name:
                item["basicTaskName"] = display_name


def _basic_mission_id(basic_mission: dict[str, Any], index: int) -> str:
    for key in ("id", "missionId", "taskNo", "basicTaskName", "name"):
        value = str(basic_mission.get(key) or "").strip()
        if value:
            slug = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-").lower()
            if slug:
                return slug
            return hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
    return f"basic-mission-{index + 1}"


def _combat_unit_airports(combat_unit: Any) -> list[str]:
    airport_names: list[str] = []

    def append_airport(value: Any) -> None:
        airport = str(value or "").strip()
        if airport and airport not in airport_names:
            airport_names.append(airport)

    if isinstance(combat_unit, dict):
        members = combat_unit.get("members") if isinstance(combat_unit.get("members"), list) else []
        for member in members:
            if not isinstance(member, dict):
                continue
            append_airport(
                member.get("airport")
                or member.get("airportName")
                or member.get("deploymentAirport")
            )
        if not airport_names:
            append_airport(
                combat_unit.get("airport")
                or combat_unit.get("airportName")
                or combat_unit.get("deploymentAirport")
            )
    else:
        append_airport(combat_unit)

    return airport_names


def _mission_profile_to_project(mission: dict[str, Any], import_id: str) -> dict[str, Any]:
    project_only_fields = {
        "airports",
        "missionAreas",
        "experiment",
        "basicMission",
        "basicMissions",
        "missionPhases",
        "combatUnit",
        "equipment",
        "reliabilityBlockDiagram",
        "monteCarlo",
        "analysisRequests",
        "profileType",
        "endCondition",
        "repeatCycleHours",
    }
    profile = {key: deepcopy(value) for key, value in mission.items() if key not in project_only_fields}
    profile["sourceImportId"] = import_id
    return profile


def _equipment_asset_to_component(row: dict[str, Any]) -> dict[str, Any]:
    component = deepcopy(row)
    component["id"] = str(row.get("id") or "equipment")
    component["name"] = str(row.get("name") or row.get("id") or "equipment")
    component["quantity"] = _safe_positive_int(row.get("quantity"), 1)
    component["kOutOfN"] = _normalized_equipment_k_out_of_n(row, component["quantity"])
    if row.get("parentId") not in (None, ""):
        component["parentId"] = str(row["parentId"])
    mtbf_hours = _safe_positive_float(row.get("mtbfHours"), 0)
    if mtbf_hours > 0:
        component["mtbfHours"] = mtbf_hours
        component.setdefault("failureRate", 1 / mtbf_hours)
    return component


def _normalized_equipment_k_out_of_n(row: dict[str, Any], quantity: int) -> dict[str, Any]:
    k_out = row.get("kOutOfN") if isinstance(row.get("kOutOfN"), dict) else {}
    raw_k = k_out.get("k")
    k = int(float(raw_k)) if _is_positive_integer_value(raw_k) and int(float(raw_k)) <= quantity else quantity
    return {**k_out, "enabled": quantity > 1, "n": quantity, "k": k}


def _support_nodes_from_resources(resources: list[dict[str, Any]]) -> list[dict[str, str]]:
    nodes: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, row in enumerate(resources):
        name = _support_node_name_for_resource(row)
        if not name or name in seen:
            continue
        seen.add(name)
        nodes.append({"id": _stable_uid("support-node", name, index), "name": name})
    return nodes


def _support_resources_from_import_resources(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, row in enumerate(resources):
        if _is_typed_support_resource(row):
            rows.append(_normalized_support_resource(row, index))
            continue
        support_node_name = _support_node_name_for_resource(row)
        personnel_quantity = _safe_non_negative_int(row.get("personnelCapacity"), _safe_non_negative_int(row.get("capacity"), 0))
        if personnel_quantity > 0:
            rows.append({
                "id": _stable_uid("support-resource-personnel", support_node_name, index),
                "supportNodeName": support_node_name,
                "type": "personnel",
                "name": str(row.get("personnelName") or row.get("name") or f"{support_node_name}人员"),
                "model": str(row.get("personnelModel") or row.get("personnelType") or ""),
                "quantity": personnel_quantity,
            })
        equipment_quantity = _safe_non_negative_int(row.get("equipmentCapacity"), _safe_non_negative_int(row.get("capacity"), 0))
        if equipment_quantity > 0:
            rows.append({
                "id": _stable_uid("support-resource-equipment", support_node_name, index),
                "supportNodeName": support_node_name,
                "type": "equipment",
                "name": str(row.get("supportEquipmentName") or row.get("equipmentName") or row.get("name") or f"{support_node_name}设备"),
                "model": str(row.get("supportEquipmentModel") or row.get("nodeType") or row.get("model") or ""),
                "quantity": equipment_quantity,
            })
        inventory = row.get("inventory") if isinstance(row.get("inventory"), dict) else {}
        for spare_index, (spare_name, quantity) in enumerate(inventory.items()):
            spare_quantity = _safe_non_negative_int(quantity, 0)
            if spare_quantity <= 0:
                continue
            rows.append({
                "id": _stable_uid("support-resource-spare", support_node_name, spare_name, spare_index),
                "supportNodeName": support_node_name,
                "type": "spare",
                "name": str(spare_name),
                "model": str((row.get("spareModels") or {}).get(spare_name) or spare_name),
                "quantity": spare_quantity,
            })
    return rows


def _transport_policies_from_import_resources(
    resources: list[dict[str, Any]],
    transport_policies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    name_by_id = _support_resource_name_by_id(resources)
    rows: list[dict[str, Any]] = []
    for index, policy in enumerate(transport_policies):
        rows.append(_normalized_transport_policy(policy, name_by_id, index))
    for resource_index, resource in enumerate(resources):
        for policy_index, policy in enumerate(resource.get("transportPolicies") if isinstance(resource.get("transportPolicies"), list) else []):
            if isinstance(policy, dict):
                rows.append(_normalized_transport_policy(policy, name_by_id, resource_index * 100 + policy_index))
    return rows


def _support_organization_to_project(value: dict[str, Any]) -> dict[str, Any]:
    organization = deepcopy(value) if isinstance(value, dict) else {}
    tree = organization.get("tree")
    if isinstance(tree, list):
        tree = tree[0] if tree else {"id": "support-org-root", "name": "保障组织", "description": "", "children": []}
    if not isinstance(tree, dict):
        tree = {"id": "support-org-root", "name": "保障组织", "description": "", "children": []}
    organization["tree"] = _clean_support_organization_node(tree)
    return organization


def _clean_support_organization_node(node: dict[str, Any]) -> dict[str, Any]:
    cleaned = {
        "id": str(node.get("id") or node.get("name") or "support-org-node"),
        "name": str(node.get("name") or node.get("id") or "保障组织"),
        "description": str(node.get("description") or ""),
        "children": [],
    }
    children = node.get("children") if isinstance(node.get("children"), list) else []
    cleaned["children"] = [
        _clean_support_organization_node(child)
        for child in children
        if isinstance(child, dict)
    ]
    return cleaned


def _support_activity_to_project(row: dict[str, Any], resource_name_by_id: dict[str, str] | None = None) -> dict[str, Any]:
    activity = deepcopy(row)
    activity.setdefault("activityName", row.get("name") or row.get("id") or "保障活动")
    activity.setdefault("activityType", row.get("type") or row.get("name") or "保障活动")
    activity.setdefault("requiredPersonnel", 1)
    activity.setdefault("requiredDevices", 1)
    activity.setdefault("priority", 1)
    activity.setdefault("jobs", [])
    resource_id = activity.get("resourceId")
    if resource_name_by_id and resource_id not in (None, ""):
        activity["resourceId"] = resource_name_by_id.get(str(resource_id), str(resource_id))
    return activity


def _support_node_name_for_resource(row: dict[str, Any]) -> str:
    return str(row.get("supportNodeName") or row.get("organizationNodeName") or row.get("name") or row.get("id") or "保障节点")


def _support_resource_name_by_id(resources: list[dict[str, Any]]) -> dict[str, str]:
    return {
        str(row.get("id")): _support_node_name_for_resource(row)
        for row in resources
        if row.get("id") not in (None, "")
    }


def _is_typed_support_resource(row: dict[str, Any]) -> bool:
    return str(row.get("type") or "").strip().lower() in {"personnel", "equipment", "spare"}


def _normalized_support_resource(row: dict[str, Any], index: int) -> dict[str, Any]:
    resource_type = str(row.get("type") or "").strip().lower()
    support_node_name = _support_node_name_for_resource(row)
    return {
        "id": str(row.get("id") or _stable_uid("support-resource", support_node_name, index)),
        "supportNodeName": support_node_name,
        "type": resource_type,
        "name": str(row.get("name") or row.get("model") or resource_type),
        "model": str(row.get("model") or ""),
        "quantity": _safe_non_negative_int(row.get("quantity"), _safe_non_negative_int(row.get("capacity"), 0)),
    }


def _normalized_transport_policy(policy: dict[str, Any], name_by_id: dict[str, str], index: int) -> dict[str, Any]:
    from_value = str(policy.get("fromSupportNodeName") or policy.get("from") or "")
    to_value = str(policy.get("toSupportNodeName") or policy.get("to") or "")
    return {
        "id": str(policy.get("id") or _stable_uid("transport-policy", from_value, to_value, index)),
        "fromSupportNodeName": name_by_id.get(from_value, from_value),
        "toSupportNodeName": name_by_id.get(to_value, to_value),
        "spareName": str(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type") or ""),
        "capacity": _safe_positive_int(policy.get("capacity"), 1),
        "priority": _safe_positive_int(policy.get("priority"), 1),
        "transportMode": str(policy.get("transportMode") or policy.get("transport_mode") or ""),
        "transportTimeHours": _safe_positive_float(policy.get("transportTimeHours") or policy.get("transport_time_hours"), 0),
    }


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _stable_uid(prefix: str, *parts: Any) -> str:
    raw = "|".join(str(part) for part in parts if part not in (None, ""))
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def _safe_positive_int(value: Any, fallback: int) -> int:
    number = _safe_positive_float(value, fallback)
    return max(1, int(number))


def _safe_non_negative_int(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return max(0, int(fallback))
    try:
        number = float(value)
    except (TypeError, ValueError):
        return max(0, int(fallback))
    if not isfinite(number) or number < 0:
        return max(0, int(fallback))
    return int(number)


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
