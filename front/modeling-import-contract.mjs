export const MODELING_IMPORT_PAGE_MAP = {
  missionProfiles: "任务剖面参数",
  equipmentAssets: "装备系统建模",
  reliabilityBlockDiagram: "装备系统建模",
  supportResources: "保障资源建模",
  supportActivities: "保障活动建模",
  supportOrganization: "保障组织建模",
  transportPolicies: "保障资源建模"
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

const CORE_TABLE_DOMAINS = new Set(["missionProfiles", "equipmentAssets"]);
const DISABLEABLE_COLLECTIONS = new Set(["supportResources", "supportActivities"]);
const OBJECT_TABLE_DOMAINS = new Set(["reliabilityBlockDiagram", "supportOrganization"]);
const MODELING_IMPORT_TABLE_DOMAINS = [
  "missionProfiles",
  "equipmentAssets",
  "reliabilityBlockDiagram",
  "supportResources",
  "supportActivities",
  "supportOrganization",
  "transportPolicies"
];

export function validateModelingImportPackage(importPackage) {
  const issues = [];
  const scope = normalizeValidationScope(importPackage, issues);
  validatePackageRoots(importPackage, issues, scope);

  const objects = importPackage?.objects || {};
  const objectIds = collectObjectIds(objects, issues);

  for (const [collection, rules] of Object.entries(COLLECTION_RULES)) {
    if (isDisabledCollectionMissing(collection, objects, scope.usedTables)) continue;
    const rows = Array.isArray(objects[collection]) ? objects[collection] : [];
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        issues.push(createIssue({
          code: "invalid_object",
          collection,
          objectId: `${collection}[${index}]`,
          fieldPath: `objects.${collection}[${index}]`,
          message: "对象必须是 JSON object。"
        }));
        return;
      }
      validateRequiredFields(collection, row, index, rules.requiredFields || [], issues);
      validateNumericFields(collection, row, index, rules.numericFields || [], issues);
      validateReferences(collection, row, index, rules.references || [], objectIds, issues);
    });
  }

  validateEquipmentAssetHierarchy(objects.equipmentAssets, issues);
  validatePublishedReferenceProtection(importPackage, issues);

  return issues;
}

export function projectToModelingImportPackage(projectJson, basePackage = {}) {
  const project = cloneJson(projectJson || {});
  const base = cloneJson(basePackage || {});
  const sourceImportId = String(project.missionProfile?.sourceImportId || "").trim();
  const importId = sourceImportId || String(base.importId || "").trim() || importIdForProject(project);
  const projectId = String(project.project_id || base.projectId || project.scenarioId || "project-current");
  const missionProfile = projectMissionProfile(project, projectId);
  const objects = {
    ...preservedObjectSurfaces(base.objects),
    missionProfiles: [missionProfile],
    equipmentAssets: normalizeObjectRows(project.components),
    supportResources: normalizeObjectRows(project.supportNodes),
    supportActivities: normalizeSupportActivities(project.supportActivities, project),
    equipment: cloneJson(project.equipment || base.objects?.equipment || {}),
    projectInfo: cloneJson(project.projectInfo || base.objects?.projectInfo || {}),
    airports: normalizeObjectRows(project.airports),
    missionAreas: normalizeObjectRows(project.missionAreas),
    supportOrganization: cloneJson(project.supportOrganization || base.objects?.supportOrganization || {}),
    reliabilityBlockDiagram: cloneJson(project.reliabilityBlockDiagram || missionProfile.reliabilityBlockDiagram || {}),
    monteCarlo: cloneJson(project.monteCarlo || missionProfile.monteCarlo || {}),
    analysisRequests: cloneJson(project.analysisRequests || missionProfile.analysisRequests || {})
  };
  const lifecycle = {
    state: "draft",
    version: positiveInteger(base.lifecycle?.version, 1),
    referencedRunIds: Array.isArray(base.lifecycle?.referencedRunIds) ? [...base.lifecycle.referencedRunIds] : []
  };
  const usedTables = inferUsedTables(objects);
  const validationLevel = Object.values(usedTables).every(Boolean) ? "level1" : "level0";
  const nextPackage = {
    schemaVersion: "modeling-import-v1",
    importId,
    projectId,
    validationLevel,
    usedTables,
    source: {
      ...(base.source && typeof base.source === "object" && !Array.isArray(base.source) ? cloneJson(base.source) : {}),
      type: "current_project_backfill",
      name: "current_project_backfill",
      projectId: project.project_id || projectId,
      scenarioId: project.scenarioId || ""
    },
    lifecycle,
    objects,
    changes: []
  };
  const issues = validateModelingImportPackage(nextPackage);
  nextPackage.validation = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "valid" : "invalid",
    issues
  };
  return nextPackage;
}

function inferUsedTables(objects) {
  const supportResources = normalizeObjectRows(objects.supportResources);
  return {
    missionProfiles: true,
    equipmentAssets: true,
    reliabilityBlockDiagram: hasPlainObjectContent(objects.reliabilityBlockDiagram),
    supportResources: supportResources.length > 0,
    supportActivities: normalizeObjectRows(objects.supportActivities).length > 0,
    supportOrganization: hasSupportOrganizationTree(objects.supportOrganization),
    transportPolicies: supportResources.some((resource) => Array.isArray(resource.transportPolicies) && resource.transportPolicies.length > 0)
  };
}

function hasPlainObjectContent(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function hasSupportOrganizationTree(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tree) && value.tree.length > 0);
}

function projectMissionProfile(project, projectId) {
  const mission = cloneJson(project.missionProfile || {});
  delete mission.sourceImportId;
  mission.id ||= mission.profileId || `${projectId}-mission-profile`;
  mission.name ||= project.projectInfo?.name || project.experiment?.name || "当前项目任务剖面";
  mission.durationHours = positiveNumber(mission.durationHours, durationHoursForProject(project));
  for (const key of [
    "basicMission",
    "basicMissions",
    "missionPhases",
    "combatUnit",
    "airports",
    "missionAreas",
    "experiment",
    "equipment",
    "reliabilityBlockDiagram",
    "monteCarlo",
    "analysisRequests"
  ]) {
    if (mission[key] !== undefined) continue;
    if (project[key] !== undefined) mission[key] = cloneJson(project[key]);
  }
  stripCompositeTaskItemEquipmentQuantity(mission);
  return mission;
}

function stripCompositeTaskItemEquipmentQuantity(mission) {
  const compositeTasks = Array.isArray(mission?.compositeTasks) ? mission.compositeTasks : [];
  for (const compositeTask of compositeTasks) {
    const taskItems = Array.isArray(compositeTask?.taskItems) ? compositeTask.taskItems : [];
    for (const taskItem of taskItems) {
      if (taskItem && typeof taskItem === "object" && !Array.isArray(taskItem)) {
        delete taskItem.equipmentQuantity;
      }
    }
  }
}

function preservedObjectSurfaces(objects = {}) {
  const preserved = {};
  for (const [key, value] of Object.entries(objects || {})) {
    if (COLLECTION_RULES[key]) continue;
    if ([
      "equipment",
      "projectInfo",
      "airports",
      "missionAreas",
      "supportOrganization",
      "reliabilityBlockDiagram",
      "monteCarlo",
      "analysisRequests"
    ].includes(key)) continue;
    preserved[key] = cloneJson(value);
  }
  return preserved;
}

function normalizeObjectRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => cloneJson(row));
}

function normalizeSupportActivities(rows, project = {}) {
  if (!Array.isArray(rows)) return [];
  const equipmentAssets = Array.isArray(project.components) ? project.components : [];
  const supportResources = Array.isArray(project.supportNodes) ? project.supportNodes : [];
  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      const next = cloneJson(row);
      next.name ||= next.activityName || next.planType || next.id;
      next.equipmentId ||= defaultEquipmentIdForActivity(next, equipmentAssets);
      next.resourceId ||= supportResources.find((resource) => resource?.id)?.id;
      next.durationHours = positiveNumber(next.durationHours, durationHoursForActivity(next));
      return next;
    });
}

function defaultEquipmentIdForActivity(activity, equipmentAssets) {
  const aircraftModel = String(activity.aircraftModel || "").trim();
  const byAircraftModel = aircraftModel
    ? equipmentAssets.find((asset) => asset?.id && String(asset.aircraftModel || "") === aircraftModel && asset.parentId)
    : null;
  return byAircraftModel?.id || equipmentAssets.find((asset) => asset?.id && asset.parentId)?.id || equipmentAssets.find((asset) => asset?.id)?.id || "";
}

function durationHoursForActivity(activity) {
  const jobMinutes = Array.isArray(activity.jobs)
    ? activity.jobs.reduce((sum, job) => sum + positiveNumber(job?.durationMinutes, 0), 0)
    : 0;
  if (jobMinutes > 0) return jobMinutes / 60;
  return positiveNumber(activity.maxWorkTimeRefMinutes, 0) / 60;
}

function durationHoursForProject(project) {
  const missionMinutes = Number(project.basicMission?.taskDurationMinutes || 0);
  if (Number.isFinite(missionMinutes) && missionMinutes > 0) return missionMinutes / 60;
  return positiveNumber(project.experiment?.steps, 1);
}

function importIdForProject(project) {
  const rawId = String(project.project_id || project.scenarioId || "current-project");
  return `import-${rawId.replace(/^project-/, "").replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeValidationScope(importPackage, issues) {
  const validationLevel = importPackage?.validationLevel || "level1";
  if (!["level0", "level1"].includes(validationLevel)) {
    issues.push(createIssue({
      code: "invalid_validation_level",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "validationLevel",
      message: "validationLevel 必须是 level0 或 level1。"
    }));
  }

  const rawUsedTables = importPackage?.usedTables;
  const usedTables = {};
  if (rawUsedTables !== undefined && (!rawUsedTables || typeof rawUsedTables !== "object" || Array.isArray(rawUsedTables))) {
    issues.push(createIssue({
      code: "invalid_used_tables",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "usedTables",
      message: "usedTables 必须是对象，且每个字段必须是布尔值。"
    }));
  }
  const tableFlags = rawUsedTables && typeof rawUsedTables === "object" && !Array.isArray(rawUsedTables) ? rawUsedTables : {};
  const normalizedValidationLevel = ["level0", "level1"].includes(validationLevel) ? validationLevel : "level1";
  for (const domain of MODELING_IMPORT_TABLE_DOMAINS) {
    usedTables[domain] = normalizeUsedTableFlag(tableFlags, domain, issues, normalizedValidationLevel);
  }
  for (const domain of Object.keys(tableFlags)) {
    if (MODELING_IMPORT_TABLE_DOMAINS.includes(domain)) continue;
    issues.push(createIssue({
      code: "invalid_used_table_domain",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: `usedTables.${domain}`,
      message: `usedTables.${domain} 不是 modeling-import-v1 支持的表域。`
    }));
  }
  return {
    validationLevel: normalizedValidationLevel,
    usedTables
  };
}

function normalizeUsedTableFlag(rawUsedTables, domain, issues, validationLevel) {
  if (!(domain in rawUsedTables)) return true;
  const value = rawUsedTables[domain];
  if (typeof value === "boolean") {
    if (CORE_TABLE_DOMAINS.has(domain) && value === false) {
      issues.push(createIssue({
        code: "invalid_used_table_flag",
        collection: undefined,
        objectId: "modeling-import-package",
        fieldPath: `usedTables.${domain}`,
        message: `usedTables.${domain} 是核心表域，不能声明为 false。`
      }));
      return true;
    }
    if (value === false && validationLevel !== "level0") {
      issues.push(createIssue({
        code: "invalid_used_table_flag",
        collection: undefined,
        objectId: "modeling-import-package",
        fieldPath: `usedTables.${domain}`,
        message: `usedTables.${domain} 只有 validationLevel=level0 时才能声明为 false。`
      }));
      return true;
    }
    return value;
  }
  issues.push(createIssue({
    code: "invalid_used_table_flag",
    collection: undefined,
    objectId: "modeling-import-package",
    fieldPath: `usedTables.${domain}`,
    message: `usedTables.${domain} 必须是布尔值。`
  }));
  return true;
}

function validatePackageRoots(importPackage, issues, scope) {
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
    const value = importPackage?.objects?.[collection];
    if (Array.isArray(value) && value.length > 0) continue;
    if (isDisabledDomain(collection, scope.usedTables) && DISABLEABLE_COLLECTIONS.has(collection)) {
      continue;
    }
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection,
      objectId: "modeling-import-package",
      fieldPath: `objects.${collection}`,
      message: `声明使用 ${collection} 表，但缺少有效数据。`
    }));
  }

  for (const domain of OBJECT_TABLE_DOMAINS) {
    validateDeclaredObjectDomain(importPackage, issues, scope, domain);
  }
  validateDeclaredTransportPolicies(importPackage, issues, scope);
}

function validateDeclaredObjectDomain(importPackage, issues, scope, domain) {
  const value = importPackage?.objects?.[domain];
  const disabled = isDisabledDomain(domain, scope.usedTables);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (domain === "reliabilityBlockDiagram") {
      if (Object.keys(value).length > 0 || disabled) return;
      issues.push(createIssue({
        code: "invalid_declared_table",
        collection: domain,
        objectId: "modeling-import-package",
        fieldPath: `objects.${domain}`,
        message: `声明使用 ${domain} 表，但缺少有效数据。`
      }));
      return;
    }
    if (domain === "supportOrganization") {
      if (Array.isArray(value.tree) && value.tree.length > 0) return;
      if (disabled) return;
      issues.push(createIssue({
        code: "invalid_declared_table",
        collection: domain,
        objectId: "modeling-import-package",
        fieldPath: `objects.${domain}.tree`,
        message: `objects.${domain}.tree 是导入包声明建模的必填组织树，且至少需要一个节点。`
      }));
      return;
    }
    return;
  }
  if (disabled) return;
  issues.push(createIssue({
    code: "invalid_declared_table",
    collection: domain,
    objectId: "modeling-import-package",
    fieldPath: `objects.${domain}`,
    message: `声明使用 ${domain} 表，但缺少有效数据。`
  }));
}

function validateDeclaredTransportPolicies(importPackage, issues, scope) {
  if (isDisabledDomain("transportPolicies", scope.usedTables)) return;
  const resources = importPackage?.objects?.supportResources;
  if (!Array.isArray(resources)) {
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection: "transportPolicies",
      objectId: "modeling-import-package",
      fieldPath: "objects.supportResources",
      message: "声明使用 transportPolicies，但缺少 supportResources 表。"
    }));
    return;
  }
  if (resources.length === 0) {
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection: "transportPolicies",
      objectId: "modeling-import-package",
      fieldPath: "objects.supportResources",
      message: "声明使用 transportPolicies，但 supportResources 表没有可承载运输策略的资源行。"
    }));
    return;
  }
  resources.forEach((resource, index) => {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) return;
    if (Array.isArray(resource.transportPolicies) && resource.transportPolicies.length) return;
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection: "transportPolicies",
      objectId: resource.id || `supportResources[${index}]`,
      fieldPath: `objects.supportResources[${index}].transportPolicies`,
      message: "声明使用 transportPolicies，但保障资源缺少有效运输策略数组。"
    }));
  });
}

function isDisabledCollectionMissing(collection, objects, usedTables) {
  return DISABLEABLE_COLLECTIONS.has(collection) && isDisabledDomain(collection, usedTables) && !Array.isArray(objects[collection]);
}

function isDisabledDomain(domain, usedTables) {
  return usedTables[domain] === false;
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

function validateEquipmentAssetHierarchy(rows, issues) {
  const assets = Array.isArray(rows) ? rows : [];
  const byId = new Map(assets.filter((row) => row?.id).map((row) => [String(row.id), row]));
  assets.forEach((row, index) => {
    if (String(row?.productType || "").trim() !== "SRU") return;
    const parent = byId.get(String(row.parentId || ""));
    if (String(parent?.productType || "").trim() === "LRU") return;
    issues.push(createIssue({
      code: "invalid_sru_parent",
      collection: "equipmentAssets",
      objectId: row.id || `equipmentAssets[${index}]`,
      fieldPath: `objects.equipmentAssets[${index}].parentId`,
      message: "SRU 的上级必须是 LRU。"
    }));
  });
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
