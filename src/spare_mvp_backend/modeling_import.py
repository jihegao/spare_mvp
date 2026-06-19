"""Server-side validation for M5 modeling import packages."""

from __future__ import annotations

from math import isfinite
from typing import Any


MODELING_IMPORT_PAGE_MAP = {
    "missionProfiles": "任务剖面参数",
    "equipmentAssets": "装备组成建模",
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


def _validate_package_roots(import_package: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    if import_package.get("schemaVersion") != "modeling-import-v1":
        issues.append(_issue("invalid_schema_version", None, "modeling-import-package", "schemaVersion", "schemaVersion 必须是 modeling-import-v1。"))

    for field in ("importId", "projectId", "lifecycle"):
        if import_package.get(field) not in (None, ""):
            continue
        issues.append(_issue("missing_required_root", None, "modeling-import-package", field, f"{field} 是导入包必填字段。"))

    objects = import_package.get("objects") if isinstance(import_package.get("objects"), dict) else {}
    for collection in COLLECTION_RULES:
        if isinstance(objects.get(collection), list):
            continue
        issues.append(_issue("missing_required_root", None, "modeling-import-package", f"objects.{collection}", f"objects.{collection} 是导入包必填对象集合。"))


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
