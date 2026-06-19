export const MODELING_IMPORT_PAGE_MAP = {
  missionProfiles: "任务剖面参数",
  equipmentAssets: "装备组成建模",
  supportResources: "保障资源建模",
  supportActivities: "保障活动建模"
};

const COLLECTION_RULES = {
  missionProfiles: {
    requiredFields: ["id", "name", "durationHours"],
    numericFields: ["durationHours"]
  },
  equipmentAssets: {
    requiredFields: ["id", "name", "quantity"],
    numericFields: ["quantity", "mtbfHours"],
    references: [{ field: "parentId", target: "equipmentAssets" }]
  },
  supportResources: {
    requiredFields: ["id", "name", "capacity"],
    numericFields: ["capacity"]
  },
  supportActivities: {
    requiredFields: ["id", "name", "equipmentId", "resourceId", "durationHours"],
    numericFields: ["durationHours"],
    references: [
      { field: "equipmentId", target: "equipmentAssets" },
      { field: "resourceId", target: "supportResources" }
    ]
  }
};

export function validateModelingImportPackage(importPackage) {
  const issues = [];
  validatePackageRoots(importPackage, issues);

  const objects = importPackage?.objects || {};
  const objectIds = collectObjectIds(objects, issues);

  for (const [collection, rules] of Object.entries(COLLECTION_RULES)) {
    const rows = Array.isArray(objects[collection]) ? objects[collection] : [];
    rows.forEach((row, index) => {
      validateRequiredFields(collection, row, index, rules.requiredFields || [], issues);
      validateNumericFields(collection, row, index, rules.numericFields || [], issues);
      validateReferences(collection, row, index, rules.references || [], objectIds, issues);
    });
  }

  validatePublishedReferenceProtection(importPackage, issues);

  return issues;
}

function validatePackageRoots(importPackage, issues) {
  if (importPackage?.schemaVersion !== "modeling-import-v1") {
    issues.push(createIssue({
      code: "invalid_schema_version",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "schemaVersion",
      message: "schemaVersion 必须是 modeling-import-v1。"
    }));
  }

  for (const field of ["importId", "projectId", "lifecycle"]) {
    if (importPackage?.[field] !== undefined && importPackage[field] !== null && importPackage[field] !== "") continue;
    issues.push(createIssue({
      code: "missing_required_root",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: field,
      message: `${field} 是导入包必填字段。`
    }));
  }
  validateLifecycle(importPackage, issues);

  for (const collection of Object.keys(COLLECTION_RULES)) {
    if (Array.isArray(importPackage?.objects?.[collection])) continue;
    issues.push(createIssue({
      code: "missing_required_root",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: `objects.${collection}`,
      message: `objects.${collection} 是导入包必填对象集合。`
    }));
  }
}

function validateLifecycle(importPackage, issues) {
  const lifecycle = importPackage?.lifecycle;
  if (lifecycle === undefined || lifecycle === null || lifecycle === "") return;
  if (typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    issues.push(createIssue({
      code: "invalid_lifecycle",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "lifecycle",
      message: "lifecycle 必须是包含 state、version 和 referencedRunIds 的对象。"
    }));
    return;
  }
  if (!["draft", "published"].includes(lifecycle.state)) {
    issues.push(createIssue({
      code: "invalid_lifecycle_state",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "lifecycle.state",
      message: "lifecycle.state 必须是 draft 或 published。"
    }));
  }
  if (!Number.isInteger(lifecycle.version) || lifecycle.version < 1) {
    issues.push(createIssue({
      code: "invalid_lifecycle_version",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "lifecycle.version",
      message: "lifecycle.version 必须是大于等于 1 的整数。"
    }));
  }
  if (!Array.isArray(lifecycle.referencedRunIds) || lifecycle.referencedRunIds.some((item) => typeof item !== "string")) {
    issues.push(createIssue({
      code: "invalid_lifecycle_references",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "lifecycle.referencedRunIds",
      message: "lifecycle.referencedRunIds 必须是 run_id 字符串数组。"
    }));
  }
}

function collectObjectIds(objects, issues) {
  const objectIds = {};

  for (const collection of Object.keys(COLLECTION_RULES)) {
    objectIds[collection] = new Set();
    const rows = Array.isArray(objects[collection]) ? objects[collection] : [];
    rows.forEach((row, index) => {
      if (!row?.id) return;
      if (objectIds[collection].has(row.id)) {
        issues.push(createIssue({
          code: "duplicate_id",
          collection,
          objectId: row.id,
          fieldPath: `objects.${collection}[${index}].id`,
          message: `对象编号 ${row.id} 在 ${collection} 中重复。`
        }));
      }
      objectIds[collection].add(row.id);
    });
  }

  return objectIds;
}

function validateRequiredFields(collection, row, index, fields, issues) {
  for (const field of fields) {
    if (row?.[field] !== undefined && row[field] !== null && row[field] !== "") continue;
    issues.push(createIssue({
      code: "missing_required_field",
      collection,
      objectId: row?.id || `${collection}[${index}]`,
      fieldPath: `objects.${collection}[${index}].${field}`,
      message: `${field} 是必填字段。`
    }));
  }
}

function validateNumericFields(collection, row, index, fields, issues) {
  for (const field of fields) {
    if (!(field in row)) continue;
    const value = row[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      issues.push(createIssue({
        code: "invalid_number",
        collection,
        objectId: row.id || `${collection}[${index}]`,
        fieldPath: `objects.${collection}[${index}].${field}`,
        message: `${field} 必须是大于 0 的数值。`
      }));
    }
  }
}

function validateReferences(collection, row, index, references, objectIds, issues) {
  for (const reference of references) {
    const value = row[reference.field];
    if (!value) continue;
    if (!objectIds[reference.target]?.has(value)) {
      issues.push(createIssue({
        code: "missing_reference",
        collection,
        objectId: row.id || `${collection}[${index}]`,
        fieldPath: `objects.${collection}[${index}].${reference.field}`,
        message: `${reference.field} 引用了不存在的 ${reference.target} 对象 ${value}。`
      }));
    }
  }
}

function validatePublishedReferenceProtection(importPackage, issues) {
  const lifecycle = importPackage?.lifecycle || {};
  const referencedRunIds = Array.isArray(lifecycle.referencedRunIds) ? lifecycle.referencedRunIds : [];
  if (lifecycle.state !== "published" || referencedRunIds.length === 0) return;

  const changes = Array.isArray(importPackage?.changes) ? importPackage.changes : [];
  for (const change of changes) {
    if (!["update", "delete"].includes(change.operation)) continue;
    issues.push(createIssue({
      code: "published_reference_protection",
      collection: change.objectType,
      objectId: change.objectId || change.objectType,
      fieldPath: change.fieldPath || `objects.${change.objectType}`,
      message: `已发布且被运行 ${referencedRunIds.join(", ")} 引用的项目数据不能无痕覆盖，应生成新版本。`
    }));
  }
}

function createIssue({ code, collection, objectId, fieldPath, message }) {
  return {
    code,
    severity: "error",
    page: MODELING_IMPORT_PAGE_MAP[collection] || "建模数据入口",
    object_id: objectId,
    field_path: fieldPath,
    message
  };
}
