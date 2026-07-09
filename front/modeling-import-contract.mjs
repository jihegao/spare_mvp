import {
  normalizeEquipmentComponentKOutOfN,
  validateEquipmentComponentKOutOfN
} from "./equipment-tree-model.mjs";

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
    requiredFields: ["id", "name"],
    numericFields: ["capacity", "quantity"]
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
      if (collection === "equipmentAssets") {
        validateEquipmentAssetKOutOfN(row, index, issues);
      }
      validateReferences(collection, row, index, rules.references || [], objectIds, issues);
    });
  }

  validateEquipmentAssetHierarchy(objects.equipmentAssets, issues);
  if (scope.usedTables.supportActivities !== false) {
    validateBasicMissionSupportActivityNames(objects.missionProfiles, objects.supportActivities, issues);
  }
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
  const supportResources = projectSupportResources(project);
  const objects = {
    ...preservedObjectSurfaces(base.objects),
    missionProfiles: [missionProfile],
    equipmentAssets: normalizeEquipmentAssetRows(project.components),
    supportResources,
    transportPolicies: projectTransportPolicies(project),
    supportActivities: normalizeSupportActivities(project.supportActivities, { ...project, supportResources }),
    supportActivityJobs: normalizeObjectRows(project.supportActivityJobs),
    equipment: cloneJson(project.equipment || base.objects?.equipment || {}),
    projectInfo: cloneJson(project.projectInfo || base.objects?.projectInfo || {}),
    supportOrganization: normalizeSupportOrganization(project.supportOrganization || base.objects?.supportOrganization || {}),
    reliabilityBlockDiagram: cloneJson(project.reliabilityBlockDiagram || missionProfile.reliabilityBlockDiagram || {}),
    analysisRequests: cloneJson(project.analysisRequests || missionProfile.analysisRequests || {})
  };
  const lifecycle = {
    state: "draft",
    version: positiveInteger(base.lifecycle?.version, 1),
    referencedRunIds: Array.isArray(base.lifecycle?.referencedRunIds) ? [...base.lifecycle.referencedRunIds] : []
  };
  const usedTables = inferUsedTables(objects);
  const nextPackage = {
    schemaVersion: "modeling-import-v1",
    importId,
    projectId,
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
    transportPolicies: normalizeObjectRows(objects.transportPolicies).length > 0
  };
}

function hasPlainObjectContent(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function hasSupportOrganizationTree(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && ((Array.isArray(value.tree) && value.tree.length > 0) || (value.tree && typeof value.tree === "object" && !Array.isArray(value.tree))));
}

function projectMissionProfile(project, projectId) {
  const mission = cloneJson(project.missionProfile || {});
  delete mission.sourceImportId;
  delete mission.missionAreas;
  delete mission.monteCarlo;
  mission.id ||= mission.profileId || `${projectId}-mission-profile`;
  mission.name ||= project.projectInfo?.name || project.experiment?.name || "当前项目任务剖面";
  mission.durationHours = positiveNumber(mission.durationHours, durationHoursForProject(project));
  delete mission.basicMission;
  for (const key of [
    "basicMissions",
    "missionPhases",
    "combatUnit",
    "experiment",
    "equipment",
    "reliabilityBlockDiagram",
    "analysisRequests"
  ]) {
    if (mission[key] !== undefined) continue;
    if (project[key] !== undefined) mission[key] = cloneJson(project[key]);
  }
  stripCompositeTaskItemEquipmentQuantity(mission);
  return mission;
}

function stripCompositeTaskItemEquipmentQuantity(mission) {
  const basicsByReference = new Map();
  for (const basic of Array.isArray(mission?.basicMissions) ? mission.basicMissions : []) {
    if (!basic || typeof basic !== "object" || Array.isArray(basic)) continue;
    delete basic.priority;
    for (const value of [basic.id, basic.missionId, basic.taskNo, basic.name, basic.basicTaskName]) {
      const reference = String(value || "").trim();
      if (reference) basicsByReference.set(reference, basic);
    }
  }
  const compositeTasks = Array.isArray(mission?.compositeTasks) ? mission.compositeTasks : [];
  for (const compositeTask of compositeTasks) {
    if (!compositeTask || typeof compositeTask !== "object" || Array.isArray(compositeTask)) continue;
    const taskItems = Array.isArray(compositeTask?.taskItems) ? compositeTask.taskItems : [];
    const inheritedPriority = taskItems
      .map((taskItem) => positiveInteger(taskItem?.priority, 0))
      .find((priority) => priority > 0);
    compositeTask.priority = positiveInteger(compositeTask.priority, inheritedPriority || 1);
    for (const taskItem of taskItems) {
      if (taskItem && typeof taskItem === "object" && !Array.isArray(taskItem)) {
        const minimum = positiveInteger(taskItem.minRequiredSystems, 0);
        const basic = basicsByReference.get(String(taskItem.basicMissionId || "").trim())
          || basicsByReference.get(String(taskItem.basicTaskName || "").trim());
        if (minimum > 0 && basic && positiveInteger(basic.minRequiredSorties, 0) === 0) {
          basic.minRequiredSorties = minimum;
        }
        delete taskItem.equipmentQuantity;
        delete taskItem.requiredEquipmentQuantity;
        delete taskItem.minRequiredSystems;
        delete taskItem.priority;
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
      "supportOrganization",
      "reliabilityBlockDiagram",
      "basicMission",
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

function normalizeEquipmentAssetRows(rows) {
  return normalizeObjectRows(rows).map((row) => normalizeEquipmentComponentKOutOfN(row));
}

function normalizeSupportActivities(rows, project = {}) {
  if (!Array.isArray(rows)) return [];
  const equipmentAssets = Array.isArray(project.components) ? project.components : [];
  const supportResources = Array.isArray(project.supportResources) ? project.supportResources : [];
  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      const next = cloneJson(row);
      next.name ||= next.activityName || next.planType || next.id;
      next.equipmentId ||= defaultEquipmentIdForActivity(next, equipmentAssets);
      const resourceId = String(next.resourceId || "");
      const hasResourceScope = supportResources.some((resource) => (
        resource?.id === resourceId || resource?.supportNodeName === resourceId
      ));
      if (!resourceId || !hasResourceScope) {
        const defaultResource = supportResources.find((resource) => resource?.supportNodeName || resource?.id);
        next.resourceId = defaultResource?.supportNodeName || defaultResource?.id;
      }
      next.durationHours = positiveNumber(next.durationHours, durationHoursForActivity(next));
      delete next.transportStrategies;
      delete next.organizationStrategies;
      return next;
    });
}

function projectSupportResources(project = {}) {
  const resources = normalizeObjectRows(project.supportResources);
  if (resources.length) return resources;
  return legacySupportResourcesFromSupportNodes(project.supportNodes);
}

function legacySupportResourcesFromSupportNodes(supportNodes) {
  return normalizeObjectRows(supportNodes).flatMap((node, nodeIndex) => {
    const supportNodeName = String(node.name || node.id || "保障节点");
    const rows = [];
    const personnelQuantity = positiveNumber(node.personnelCapacity, positiveNumber(node.capacity, 0));
    if (personnelQuantity > 0) {
      rows.push({
        id: `${node.id || `support-node-${nodeIndex}`}-personnel`,
        supportNodeName,
        type: "personnel",
        name: node.personnelName || `${supportNodeName}人员`,
        model: node.personnelModel || node.personnelType || "",
        quantity: personnelQuantity
      });
    }
    const equipmentQuantity = positiveNumber(node.equipmentCapacity, positiveNumber(node.capacity, 0));
    if (equipmentQuantity > 0) {
      rows.push({
        id: `${node.id || `support-node-${nodeIndex}`}-equipment`,
        supportNodeName,
        type: "equipment",
        name: node.supportEquipmentName || node.equipmentName || `${supportNodeName}设备`,
        model: node.supportEquipmentModel || node.nodeType || "",
        quantity: equipmentQuantity
      });
    }
    Object.entries(node.inventory || {}).forEach(([spareName, quantity], spareIndex) => {
      rows.push({
        id: `${node.id || `support-node-${nodeIndex}`}-spare-${spareIndex}`,
        supportNodeName,
        type: "spare",
        name: spareName,
        model: node.spareModels?.[spareName] || spareName,
        quantity: positiveNumber(quantity, 0)
      });
    });
    return rows;
  });
}

function projectTransportPolicies(project = {}) {
  const policies = normalizeObjectRows(project.transportPolicies);
  if (policies.length) return policies;
  const nameById = new Map(normalizeObjectRows(project.supportNodes).map((node) => [String(node.id || ""), String(node.name || node.id || "")]));
  const nodePolicies = normalizeObjectRows(project.supportNodes).flatMap((node, nodeIndex) => {
    return normalizeObjectRows(node.transportPolicies).map((policy, policyIndex) => ({
      ...policy,
      id: policy.id || `${node.id || `support-node-${nodeIndex}`}-transport-${policyIndex}`,
      fromSupportNodeName: policy.fromSupportNodeName || nameById.get(String(policy.from || "")) || policy.from || "",
      toSupportNodeName: policy.toSupportNodeName || nameById.get(String(policy.to || "")) || policy.to || "",
      spareName: policy.spareName || policy.spareType || policy.spare_type || ""
    }));
  });
  return [
    ...nodePolicies,
    ...legacyTransportPoliciesFromSupportActivities(project, nameById)
  ];
}

function legacyTransportPoliciesFromSupportActivities(project = {}, nameByRef = new Map()) {
  return normalizeObjectRows(project.supportActivities).flatMap((activity, activityIndex) => {
    return normalizeObjectRows(activity.transportStrategies).map((policy, policyIndex) => {
      const fromRef = policy.fromSupportNodeName || policy.from || "";
      const toRef = policy.toSupportNodeName || policy.to || "";
      return {
        ...policy,
        id: policy.id || `${activity.id || `support-activity-${activityIndex}`}-transport-${policyIndex}`,
        fromSupportNodeName: policy.fromSupportNodeName || nameByRef.get(String(fromRef)) || fromRef,
        toSupportNodeName: policy.toSupportNodeName || nameByRef.get(String(toRef)) || toRef,
        spareName: policy.spareName || policy.spareType || policy.spare_type || "",
        transportMode: policy.transportMode || policy.direction || ""
      };
    });
  });
}

function normalizeSupportOrganization(value = {}) {
  const organization = cloneJson(value || {});
  if (!organization || typeof organization !== "object" || Array.isArray(organization)) return {};
  if (Array.isArray(organization.tree)) {
    organization.tree = organization.tree[0] || { id: "support-org-root", name: "保障组织", description: "", children: [] };
  }
  return organization;
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
  const missionMinutes = Number(primaryBasicMissionRecord(project)?.taskDurationMinutes || 0);
  if (Number.isFinite(missionMinutes) && missionMinutes > 0) return missionMinutes / 60;
  return positiveNumber(project.experiment?.steps, 1);
}

function primaryBasicMissionRecord(project) {
  const records = Array.isArray(project?.basicMissions) ? project.basicMissions : [];
  return records.find((record) => record && typeof record === "object" && !Array.isArray(record)) || null;
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
  if ("validationLevel" in (importPackage || {})) {
    issues.push(createIssue({
      code: "retired_validation_level",
      collection: undefined,
      objectId: "modeling-import-package",
      fieldPath: "validationLevel",
      message: "validationLevel 已退役；请使用 usedTables 声明已建模或未建模的表域。"
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
  for (const domain of MODELING_IMPORT_TABLE_DOMAINS) {
    usedTables[domain] = normalizeUsedTableFlag(tableFlags, domain, issues);
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
    usedTables
  };
}

function normalizeUsedTableFlag(rawUsedTables, domain, issues) {
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
      if ((Array.isArray(value.tree) && value.tree.length > 0) || (value.tree && typeof value.tree === "object" && !Array.isArray(value.tree))) return;
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
  const policies = importPackage?.objects?.transportPolicies;
  const legacyPolicies = legacyTransportPoliciesFromSupportActivities(importPackage?.objects || {});
  if (!Array.isArray(policies)) {
    if (legacyPolicies.length > 0) return;
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection: "transportPolicies",
      objectId: "modeling-import-package",
      fieldPath: "objects.transportPolicies",
      message: "声明使用 transportPolicies，但缺少 transportPolicies 表。"
    }));
    return;
  }
  if (policies.length === 0) {
    if (legacyPolicies.length > 0) return;
    issues.push(createIssue({
      code: "invalid_declared_table",
      collection: "transportPolicies",
      objectId: "modeling-import-package",
      fieldPath: "objects.transportPolicies",
      message: "声明使用 transportPolicies，但 transportPolicies 表为空。"
    }));
  }
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
      if (collection === "supportResources" && row.supportNodeName) {
        objectIds[collection].add(row.supportNodeName);
      }
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

function validateEquipmentAssetKOutOfN(row, index, issues) {
  if (!row || typeof row !== "object" || Array.isArray(row) || row.kOutOfN === undefined) return;
  const message = validateEquipmentComponentKOutOfN(row);
  if (!message) return;
  issues.push(createIssue({
    code: "invalid_equipment_k_out_of_n",
    collection: "equipmentAssets",
    objectId: row.id || `equipmentAssets[${index}]`,
    fieldPath: `objects.equipmentAssets[${index}].kOutOfN.k`,
    message
  }));
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

function validateBasicMissionSupportActivityNames(missionProfiles, supportActivities, issues) {
  const activityNameCounts = new Map();
  for (const activity of Array.isArray(supportActivities) ? supportActivities : []) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    const activityName = String(activity.activityName || "").trim();
    if (!activityName) continue;
    activityNameCounts.set(activityName, (activityNameCounts.get(activityName) || 0) + 1);
  }

  (Array.isArray(missionProfiles) ? missionProfiles : []).forEach((profile, profileIndex) => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return;
    const basicMissions = Array.isArray(profile.basicMissions) ? profile.basicMissions : [];
    basicMissions.forEach((basicMission, missionIndex) => {
      if (!basicMission || typeof basicMission !== "object" || Array.isArray(basicMission)) return;
      const supportActivityName = String(basicMission.supportActivityName || "").trim();
      if (!supportActivityName || activityNameCounts.get(supportActivityName) === 1) return;
      issues.push(createIssue({
        code: "invalid_basic_mission_support_activity_name",
        collection: "missionProfiles",
        objectId: profile.id || `missionProfiles[${profileIndex}]`,
        fieldPath: `objects.missionProfiles[${profileIndex}].basicMissions[${missionIndex}].supportActivityName`,
        message: "basicMissions[].supportActivityName 必须唯一匹配 supportActivities[].activityName，不能回退匹配 name 或 id。"
      }));
    });
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
