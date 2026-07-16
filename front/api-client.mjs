import {
  runMonteCarlo,
  runSimulation
} from "./sim-engine.mjs";
import { normalizeProjectProducts } from "./product-catalog.mjs";

const DEFAULT_API_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 10000;
const RUN_SUBMIT_TIMEOUT_MS = 180000;
const DEFAULT_FORMAL_MODEL_FAMILY = "aircraft_support_v1";

export function createBackendApiClient({ baseUrl = DEFAULT_API_BASE, transport, getAuthToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const request = wrapAuthTransport(transport || createFetchTransport(baseUrl, { timeoutMs }), getAuthToken);
  return {
    login(username, password) {
      return request({ method: "POST", path: "/auth/login", body: { username, password }, auth: false });
    },
    getSession() {
      return request({ method: "GET", path: "/auth/session" });
    },
    listUsers() {
      return request({ method: "GET", path: "/users" });
    },
    createUser(user) {
      return request({ method: "POST", path: "/users", body: user });
    },
    updateUser(userId, updates) {
      return request({ method: "POST", path: `/users/${encodeURIComponent(userId)}`, body: updates });
    },
    deleteUser(userId) {
      return request({ method: "DELETE", path: `/users/${encodeURIComponent(userId)}` });
    },
    getSystemConfig(configKey) {
      return request({ method: "GET", path: `/system-configs/${encodeURIComponent(configKey)}` });
    },
    saveSystemConfig(configKey, payload) {
      return request({
        method: "POST",
        path: `/system-configs/${encodeURIComponent(configKey)}`,
        body: { payload }
      });
    },
    validateProject(projectJson) {
      return request({ method: "POST", path: "/projects/validate", body: projectJson });
    },
    validateModelingImport(importPackage) {
      return request({ method: "POST", path: "/modeling-imports/validate", body: importPackage });
    },
    listProjectDataTemplates({ state = "published" } = {}) {
      const query = state ? `?state=${encodeURIComponent(state)}` : "";
      return request({ method: "GET", path: `/project-data-templates${query}` });
    },
    saveModelingImport(importPackage) {
      return request({ method: "POST", path: "/modeling-imports", body: importPackage });
    },
    getModelingImport(importId) {
      return request({ method: "GET", path: `/modeling-imports/${encodeURIComponent(importId)}` });
    },
    publishModelingImport(importId) {
      return request({ method: "POST", path: `/modeling-imports/${encodeURIComponent(importId)}/publish` });
    },
    createProjectFromModelingImport(importId) {
      return request({
        method: "POST",
        path: `/modeling-imports/${encodeURIComponent(importId)}/create-project`
      });
    },
    compileModelingImportScenario(importId, modelFamily = DEFAULT_FORMAL_MODEL_FAMILY) {
      return request({
        method: "POST",
        path: `/modeling-imports/${encodeURIComponent(importId)}/compile-scenario`,
        body: { model_family: modelFamily }
      });
    },
    listProjects() {
      return request({ method: "GET", path: "/projects" });
    },
    async saveProject(projectJson) {
      await request({ method: "POST", path: "/projects/validate", body: projectJson });
      return request({ method: "POST", path: "/projects", body: projectJson });
    },
    getProject(projectId) {
      return request({ method: "GET", path: `/projects/${encodeURIComponent(projectId)}` });
    },
    replaceProject(projectId, projectJson, expectedUpdatedAt) {
      return request({
        method: "PUT",
        path: `/projects/${encodeURIComponent(projectId)}/replace`,
        body: { project_json: projectJson, expected_updated_at: expectedUpdatedAt }
      });
    },
    exportRmsAllocationXlsx(payload) {
      return request({ method: "POST", path: "/rms-allocation/export-xlsx", body: payload, responseType: "blob" });
    },
    deleteProject(projectId) {
      return request({ method: "DELETE", path: `/projects/${encodeURIComponent(projectId)}` });
    },
    createModelingSnapshot(projectId) {
      return request({ method: "POST", path: `/projects/${encodeURIComponent(projectId)}/modeling-snapshots` });
    },
    createExperimentPlan(projectId, config) {
      return request({
        method: "POST",
        path: `/projects/${encodeURIComponent(projectId)}/experiment-plans`,
        body: { config }
      });
    },
    updateExperimentPlan(projectId, experimentPlanId, config) {
      return request({
        method: "PUT",
        path: `/projects/${encodeURIComponent(projectId)}/experiment-plans/${encodeURIComponent(experimentPlanId)}`,
        body: { config }
      });
    },
    listExperimentPlans(projectId) {
      return request({
        method: "GET",
        path: `/projects/${encodeURIComponent(projectId)}/experiment-plans`
      });
    },
    deleteExperimentPlan(projectId, experimentPlanId) {
      return request({
        method: "DELETE",
        path: `/projects/${encodeURIComponent(projectId)}/experiment-plans/${encodeURIComponent(experimentPlanId)}`
      });
    },
    submitRun(runRequest) {
      return request({
        method: "POST",
        path: "/runs",
        body: runRequest,
        timeoutMs: RUN_SUBMIT_TIMEOUT_MS
      });
    },
    runLiteMesaAnalysis(projectJson, analysisType, settings = {}, modelFamily = DEFAULT_FORMAL_MODEL_FAMILY) {
      return request({
        method: "POST",
        path: "/mesa-analysis-runs",
        body: {
          project: projectJson,
          analysis_type: analysisType,
          settings,
          model_family: modelFamily
        },
        timeoutMs: RUN_SUBMIT_TIMEOUT_MS
      });
    },
    startSimulationRun(projectId, experimentPlanId, modelFamily = DEFAULT_FORMAL_MODEL_FAMILY) {
      return request({
        method: "POST",
        path: "/runs",
        timeoutMs: RUN_SUBMIT_TIMEOUT_MS,
        body: {
          project_id: projectId,
          experiment_plan_id: experimentPlanId,
          model_family: modelFamily,
          run_type: "single"
        }
      });
    },
    startMonteCarloRun(projectId, experimentPlanId, modelFamily = DEFAULT_FORMAL_MODEL_FAMILY, monteCarloExperimentId = "") {
      return request({
        method: "POST",
        path: "/runs",
        body: {
          project_id: projectId,
          experiment_plan_id: experimentPlanId,
          model_family: modelFamily,
          run_type: "monte_carlo",
          ...(monteCarloExperimentId ? { mc_experiment_id: monteCarloExperimentId } : {})
        }
      });
    },
    getRunStatus(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}` });
    },
    getRunResult(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/result` });
    },
    getRunArtifacts(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/artifacts` });
    },
    getRunChain(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/chain` });
    },
    listRuns(filters = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      }
      const suffix = query.toString() ? `?${query.toString()}` : "";
      return request({ method: "GET", path: `/runs${suffix}` });
    },
    getRunDetail(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/detail` });
    },
    controlRun(runId, action) {
      return request({
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/control`,
        body: { action }
      });
    },
    downloadRunArtifact(runId, artifactId) {
      return request({
        method: "GET",
        path: `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        responseType: "blob"
      });
    },
    getRunArtifactPayload(runId, artifactId) {
      return request({
        method: "GET",
        path: `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        responseType: "json"
      });
    },
    getCurrentAnalysisResult(projectId, analysisType) {
      return request({
        method: "GET",
        path: `/projects/${encodeURIComponent(projectId)}/analysis-results/${encodeURIComponent(analysisType)}`,
        responseType: "json"
      });
    },
    listAircraftMissionReliabilityAnalyses(projectId) {
      return request({
        method: "GET",
        path: `/projects/${encodeURIComponent(projectId)}/aircraft-mission-reliability-analyses`
      });
    },
    saveAircraftMissionReliabilityAnalysis(projectId, snapshot) {
      return request({
        method: "POST",
        path: `/projects/${encodeURIComponent(projectId)}/aircraft-mission-reliability-analyses`,
        body: snapshot
      });
    },
    archiveRun(runId) {
      return request({ method: "POST", path: `/runs/${encodeURIComponent(runId)}/archive` });
    },
    deleteRun(runId) {
      return request({ method: "DELETE", path: `/runs/${encodeURIComponent(runId)}` });
    }
  };
}

export function buildBackendProjectJson(scenario, project = {}) {
  const projectJson = normalizeProjectJsonForClientDraft(scenario);
  stripProjectRuntimeConfig(projectJson);
  stripProjectNonModelFields(projectJson);
  liftSupportActivityJobsToTopLevel(projectJson);
  materializeSupportActivityJobApplicability(projectJson);
  projectJson.schema_version ||= "project-v0";
  projectJson.project_id ||= project.id ? `project-${project.id}` : `project-${projectJson.scenarioId}`;
  projectJson.project_version ||= "project-v0.1";
  if (project.isTemplate !== undefined || project.is_template !== undefined) {
    projectJson.projectInfo = {
      ...(projectJson.projectInfo && typeof projectJson.projectInfo === "object" ? projectJson.projectInfo : {}),
      isTemplate: Boolean(project.isTemplate || project.is_template)
    };
  }
  return projectJson;
}

export function normalizeProjectJsonForClientDraft(projectJson) {
  const normalized = cloneJson(projectJson);
  normalizeProjectProducts(normalized);
  normalizeProjectJsonBasicMissions(normalized);
  ensureUniqueSupportActivityNames(normalized);
  normalizeMissionTaskFieldOwnership(normalized);
  syncCompositeTaskInheritedBasicFields(normalized);
  canonicalizeSupportActivityJobPredecessors(normalized);
  delete normalized.deletedSupportResourceKeys;
  delete normalized.supportResourceOverrides;
  materializeLegacySupportTables(normalized);
  normalizeSupportModelTables(normalized);
  materializeSupportActivityJobApplicability(normalized);
  stripLegacySupportNodeResourceFields(normalized);
  stripSupportActivityTypoFields(normalized);
  stripDeprecatedSupportActivityStrategyFields(normalized);
  normalizeProjectProducts(normalized);
  return normalized;
}

export function normalizeProjectJsonBasicMissions(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return projectJson;
  const legacyBasicMission = projectJson.basicMission;
  const missionProfile = projectJson.missionProfile;
  const legacyProfileBasicMission = missionProfile && typeof missionProfile === "object" && !Array.isArray(missionProfile)
    ? missionProfile.basicMission
    : null;
  const missionLists = [
    Array.isArray(projectJson.basicMissions) ? projectJson.basicMissions : [],
    legacyBasicMission && typeof legacyBasicMission === "object" && !Array.isArray(legacyBasicMission) ? [legacyBasicMission] : [],
    legacyProfileBasicMission && typeof legacyProfileBasicMission === "object" && !Array.isArray(legacyProfileBasicMission)
      ? [legacyProfileBasicMission]
      : [],
    Array.isArray(missionProfile?.basicMissions) ? missionProfile.basicMissions : []
  ];
  const normalized = [];
  const seen = new Set();
  for (const task of missionLists.flat()) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    const clonedTask = cloneJson(task);
    ensureBasicMissionIdentity(clonedTask, normalized.length);
    const dedupeKey = basicMissionId(clonedTask) || basicMissionDisplayName(clonedTask) || `mission-${normalized.length}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(clonedTask);
  }
  if (normalized.length) {
    projectJson.basicMissions = normalized;
  } else if (!Array.isArray(projectJson.basicMissions)) {
    projectJson.basicMissions = [];
  }
  delete projectJson.basicMission;
  if (missionProfile && typeof missionProfile === "object" && !Array.isArray(missionProfile)) {
    delete missionProfile.basicMission;
    delete missionProfile.basicMissions;
  }
  stripLegacyBasicMissionFields(projectJson);
  return projectJson;
}

// Basic missions own aircraft demand. Composite tasks own scheduling priority.
// Read old child-level values once, then remove them so new drafts have one
// behavior-driving source for each field.
function normalizeMissionTaskFieldOwnership(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return;
  const basicMissions = Array.isArray(projectJson.basicMissions) ? projectJson.basicMissions : [];
  const basicsByReference = new Map();
  for (const mission of basicMissions) {
    if (!mission || typeof mission !== "object" || Array.isArray(mission)) continue;
    delete mission.priority;
    for (const value of [mission.id, mission.missionId, mission.taskNo, mission.name, mission.basicTaskName]) {
      const reference = String(value || "").trim();
      if (reference) basicsByReference.set(reference, mission);
    }
  }

  const composites = Array.isArray(projectJson.missionProfile?.compositeTasks)
    ? projectJson.missionProfile.compositeTasks
    : [];
  for (const composite of composites) {
    if (!composite || typeof composite !== "object" || Array.isArray(composite)) continue;
    const items = Array.isArray(composite.taskItems) ? composite.taskItems : [];
    const inheritedPriority = items
      .map((item) => positiveInteger(item?.priority, 0))
      .find((priority) => priority > 0);
    composite.priority = positiveInteger(composite.priority, inheritedPriority || 1);
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const legacyMinimum = positiveInteger(item.minRequiredSystems, 0);
      const basic = basicsByReference.get(String(item.basicMissionId || "").trim())
        || basicsByReference.get(String(item.basicTaskName || "").trim());
      if (legacyMinimum > 0 && basic && positiveInteger(basic.minRequiredSorties, 0) === 0) {
        basic.minRequiredSorties = legacyMinimum;
      }
      delete item.priority;
      delete item.minRequiredSystems;
      delete item.equipmentQuantity;
      delete item.requiredEquipmentQuantity;
    }
  }
}

function stripProjectRuntimeConfig(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripProjectRuntimeConfig(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  delete value.monteCarlo;
  delete value.analysisRequests;
  delete value.experiment;
  delete value.seedPolicy;
  delete value.scenarioComposition;
  delete value.stopPolicy;
  for (const child of Object.values(value)) stripProjectRuntimeConfig(child);
}

function stripProjectNonModelFields(projectJson) {
  if (!projectJson || typeof projectJson !== "object") return;
  const equipmentCatalog = projectEquipmentCatalog(projectJson);
  delete projectJson.deletedSupportResourceKeys;
  delete projectJson.supportResourceOverrides;
  materializeLegacySupportTables(projectJson);
  normalizeSupportModelTables(projectJson);
  delete projectJson.modelingDictionaries;
  stripModelingImportValidationNonModelFields(projectJson);
  stripLegacySupportNodeResourceFields(projectJson);
  stripSupportResourceNonModelFields(projectJson);
  if (equipmentCatalog) {
    projectJson.equipment = equipmentCatalog;
  } else {
    delete projectJson.equipment;
  }
  delete projectJson.basicMission;
  stripLegacyBasicMissionFields(projectJson);
  normalizeMissionTaskFieldOwnership(projectJson);
  stripMissionProfileNonModelFields(projectJson.missionProfile);
  normalizeMissionProfileReferenceFields(projectJson);
  migrateRootMissionPhasesToBasicMissions(projectJson);
  delete projectJson.missionPhases;
  stripComponentNonModelFields(projectJson.components);
  stripReliabilityBlockDiagramNonModelFields(projectJson.reliabilityBlockDiagram);
  stripSupportActivityTypoFields(projectJson);
  stripDeprecatedSupportActivityStrategyFields(projectJson);
  stripSupportActivityRuleUiFields(projectJson.supportActivities);
  normalizeSupportActivityReferenceFields(projectJson);
  stripSupportActivitySpareTypeFields(projectJson.supportActivities);
  stripSupportActivityMttrFields(projectJson.supportActivities);
  stripSupportActivityMttrFields(projectJson.supportActivityJobs);
}

function stripReliabilityBlockDiagramNonModelFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  keepObjectFields(value, new Set(["nodes", "edges"]));
  const nodeFields = new Set([
    "id", "name", "type", "parentId", "componentId", "aircraftModel", "connectionType",
    "relation", "logic", "gateType", "quantity", "k", "failureRate", "failureRateUnit", "mtbfHours",
    "mtbfUnit", "reliability", "reliabilityUnit", "failureDistribution", "kOutOfN"
  ]);
  const edgeFields = new Set(["from", "to", "source", "target", "type", "relation", "logic", "connectionType", "weight"]);
  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node) => keepObjectFields(node, nodeFields));
  }
  if (Array.isArray(value.edges)) {
    value.edges.forEach((edge) => keepObjectFields(edge, edgeFields));
  }
}

function keepObjectFields(value, allowedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  Object.keys(value).forEach((key) => {
    if (!allowedFields.has(key)) delete value[key];
  });
}

function materializeLegacySupportTables(projectJson) {
  const supportNodes = Array.isArray(projectJson.supportNodes) ? projectJson.supportNodes : [];
  if (supportNodes.length && (!Array.isArray(projectJson.supportResources) || projectJson.supportResources.length === 0)) {
    const resources = [];
    supportNodes.forEach((node, nodeIndex) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      const nodeName = String(node.name || node.id || "保障节点");
      const personnel = nonNegativeInteger(node.personnelCapacity ?? node.capacity);
      if (personnel > 0) {
        resources.push({
          id: `${node.id || `support-node-${nodeIndex}`}-personnel`,
          supportNodeName: nodeName,
          type: "personnel",
          name: node.personnelName || `${nodeName}人员`,
          model: node.personnelModel || node.personnelType || "",
          quantity: personnel
        });
      }
      const equipment = nonNegativeInteger(node.equipmentCapacity ?? node.capacity);
      if (equipment > 0) {
        resources.push({
          id: `${node.id || `support-node-${nodeIndex}`}-equipment`,
          supportNodeName: nodeName,
          type: "equipment",
          name: node.supportEquipmentName || node.equipmentName || `${nodeName}设备`,
          model: node.supportEquipmentModel || node.nodeType || "",
          quantity: equipment
        });
      }
      Object.entries(node.inventory || {}).forEach(([spareName, quantity], spareIndex) => {
        resources.push({
          id: `${node.id || `support-node-${nodeIndex}`}-spare-${spareIndex}`,
          supportNodeName: nodeName,
          type: "spare",
          name: spareName,
          model: node.spareModels?.[spareName] || spareName,
          quantity: nonNegativeInteger(quantity)
        });
      });
    });
    if (resources.length) projectJson.supportResources = resources;
  }
  if (!Array.isArray(projectJson.transportPolicies) || projectJson.transportPolicies.length === 0) {
    const nameById = new Map(supportNodes.map((node) => [String(node?.id || ""), String(node?.name || node?.id || "")]));
    const nodePolicies = supportNodes.flatMap((node, nodeIndex) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return [];
      return (Array.isArray(node.transportPolicies) ? node.transportPolicies : []).map((policy, policyIndex) => ({
        ...policy,
        id: policy.id || `${node.id || `support-node-${nodeIndex}`}-transport-${policyIndex}`,
        fromSupportNodeName: policy.fromSupportNodeName || nameById.get(String(policy.from || "")) || policy.from || "",
        toSupportNodeName: policy.toSupportNodeName || nameById.get(String(policy.to || "")) || policy.to || ""
      }));
    });
    const policies = [
      ...nodePolicies,
      ...legacyTransportPoliciesFromSupportActivities(projectJson, nameById)
    ];
    if (policies.length) projectJson.transportPolicies = policies;
  }
}

function legacyTransportPoliciesFromSupportActivities(projectJson, nameByRef = new Map()) {
  if (!Array.isArray(projectJson.supportActivities)) return [];
  return projectJson.supportActivities.flatMap((activity, activityIndex) => {
    if (!activity || typeof activity !== "object" || Array.isArray(activity) || !Array.isArray(activity.transportStrategies)) return [];
    return activity.transportStrategies
      .filter((policy) => policy && typeof policy === "object" && !Array.isArray(policy))
      .map((policy, policyIndex) => {
        const fromRef = policy.fromSupportNodeName || policy.from || "";
        const toRef = policy.toSupportNodeName || policy.to || "";
        return {
          ...policy,
          id: policy.id || `${activity.id || `support-activity-${activityIndex}`}-transport-${policyIndex}`,
          fromSupportNodeName: policy.fromSupportNodeName || nameByRef.get(String(fromRef)) || fromRef,
          toSupportNodeName: policy.toSupportNodeName || nameByRef.get(String(toRef)) || toRef,
          transportMode: policy.transportMode || policy.direction || ""
        };
      });
  });
}

function normalizeSupportModelTables(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return;
  const legacyNameByRef = legacySupportNodeNameByRef(projectJson.supportNodes);
  const nodeScopeByRef = supportNodeScopeByRef(projectJson.supportNodes);
  const organization = normalizeSupportOrganization(projectJson.supportOrganization, legacyNameByRef);
  const nameByRef = new Map([...legacyNameByRef, ...organization.nameByRef]);
  const nodeScopeByName = supportNodeScopeByName(nodeScopeByRef, nameByRef);
  normalizeSupportResourceNodeRefs(projectJson, nameByRef);
  const supportNodeNames = organization.supportNodeNames.length
    ? organization.supportNodeNames
    : supportNodeNamesFromSupportNodes(projectJson.supportNodes);
  normalizeSupportResourcePersonnelModels(projectJson);
  normalizeSupportResourceSpareRows(projectJson, supportNodeNames);
  projectJson.supportNodes = supportNodeNames.map((name, index) => ({
    id: `support-node-${index + 1}`,
    name,
    ...(nodeScopeByName.get(name) || {})
  }));
  normalizeTopLevelTransportPolicies(projectJson, nameByRef);
  normalizeSupportNodeRefsInProject(projectJson, nameByRef);
}

function supportNodeScopeByRef(supportNodes) {
  const scopeByRef = new Map();
  if (!Array.isArray(supportNodes)) return scopeByRef;
  for (const node of supportNodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const scope = {};
    for (const field of ["airport", "airportId", "baseAirportId"]) {
      const value = cleanText(node[field]);
      if (value) scope[field] = value;
    }
    if (!Object.keys(scope).length) continue;
    for (const ref of [node.id, node.name, node.supportNodeName, node.organizationNodeId]) {
      const key = cleanText(ref);
      if (key) scopeByRef.set(key, scope);
    }
  }
  return scopeByRef;
}

function supportNodeScopeByName(scopeByRef, nameByRef) {
  const scopeByName = new Map();
  for (const [ref, scope] of scopeByRef) {
    const name = cleanText(nameByRef.get(ref) || ref);
    if (name) scopeByName.set(name, scope);
  }
  return scopeByName;
}

function legacySupportNodeNameByRef(supportNodes) {
  const nameByRef = new Map();
  if (!Array.isArray(supportNodes)) return nameByRef;
  for (const node of supportNodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const name = cleanText(node.name || node.supportNodeName || node.id);
    if (!name) continue;
    for (const ref of [node.id, node.name, node.supportNodeName, node.organizationNodeId]) {
      const key = cleanText(ref);
      if (key) nameByRef.set(key, name);
    }
  }
  return nameByRef;
}

function normalizeSupportOrganization(supportOrganization, fallbackNameByRef) {
  const supportNodeNames = [];
  const nameByRef = new Map();
  if (!supportOrganization || typeof supportOrganization !== "object" || Array.isArray(supportOrganization)) {
    return { supportNodeNames, nameByRef };
  }
  const rawTree = Array.isArray(supportOrganization.tree) ? supportOrganization.tree[0] : supportOrganization.tree;
  if (!rawTree || typeof rawTree !== "object" || Array.isArray(rawTree)) return { supportNodeNames, nameByRef };
  supportOrganization.tree = normalizeSupportOrganizationNode(rawTree, {
    fallbackNameByRef,
    nameByRef,
    supportNodeNames,
    index: { value: 0 }
  }, true);
  return { supportNodeNames, nameByRef };
}

function normalizeSupportOrganizationNode(node, context, isRoot) {
  const name = cleanText(node.name || context.fallbackNameByRef.get(cleanText(node.id)) || node.id || (isRoot ? "保障组织" : "保障点"));
  const id = cleanText(node.id) || (isRoot ? "support-org-root" : `support-org-node-${context.index.value + 1}`);
  const normalized = { id, name };
  const description = cleanText(node.description);
  if (description) normalized.description = description;
  for (const ref of [node.id, node.name, node.supportNodeId, node.code, node.sourceId]) {
    const key = cleanText(ref);
    if (key) context.nameByRef.set(key, name);
  }
  if (!isRoot) {
    context.index.value += 1;
    if (!context.supportNodeNames.includes(name)) context.supportNodeNames.push(name);
  }
  const children = Array.isArray(node.children) ? node.children : [];
  normalized.children = children
    .filter((child) => child && typeof child === "object" && !Array.isArray(child))
    .map((child) => normalizeSupportOrganizationNode(child, context, false));
  return normalized;
}

function normalizeSupportResourceNodeRefs(projectJson, nameByRef) {
  if (!Array.isArray(projectJson.supportResources)) return;
  for (const resource of projectJson.supportResources) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) continue;
    resource.supportNodeName = supportNodeNameForRef(resource.supportNodeName || resource.supportNodeId || resource.organizationNodeId, nameByRef);
    delete resource.supportNodeId;
    delete resource.organizationNodeId;
  }
}

function normalizeSupportResourcePersonnelModels(projectJson) {
  if (!Array.isArray(projectJson.supportResources)) return;
  const specialties = projectPersonnelSpecialties(projectJson);
  if (!specialties.length) return;
  const usedByNode = new Map();
  for (const resource of projectJson.supportResources) {
    if (!isPersonnelSupportResource(resource)) continue;
    const model = cleanText(resource.model);
    if (!model) continue;
    const nodeName = cleanText(resource.supportNodeName);
    if (!usedByNode.has(nodeName)) usedByNode.set(nodeName, new Set());
    usedByNode.get(nodeName).add(model);
  }
  for (const resource of projectJson.supportResources) {
    if (!isPersonnelSupportResource(resource) || cleanText(resource.model)) continue;
    const nodeName = cleanText(resource.supportNodeName);
    const used = usedByNode.get(nodeName) || new Set();
    const nextModel = specialties.find((specialty) => !used.has(specialty)) || specialties[0];
    resource.model = nextModel;
    if (!usedByNode.has(nodeName)) usedByNode.set(nodeName, used);
    used.add(nextModel);
  }
}

function projectPersonnelSpecialties(projectJson) {
  const rows = Array.isArray(projectJson?.modelingDictionaries?.personnelSpecialties)
    ? projectJson.modelingDictionaries.personnelSpecialties
    : [];
  const seen = new Set();
  return rows.map((item) => cleanText(typeof item === "string" ? item : item?.name || item?.value || item?.label))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function isPersonnelSupportResource(resource) {
  return resource && typeof resource === "object" && !Array.isArray(resource)
    && cleanText(resource.type).toLowerCase() === "personnel";
}

function normalizeSupportResourceSpareRows(projectJson, supportNodeNames) {
  if (!Array.isArray(projectJson.supportResources)) return;
  const hardwareSpares = projectHardwareSpareRows(projectJson);
  if (!hardwareSpares.length || !Array.isArray(supportNodeNames) || !supportNodeNames.length) return;
  const existingSpareByKey = new Map();
  for (const resource of projectJson.supportResources) {
    if (!isSpareSupportResource(resource)) continue;
    const key = supportSpareResourceIdentityKey(
      resource.supportNodeName,
      resource.name,
      resource.model,
      resource.equipment || resource.equipmentId
    );
    if (!existingSpareByKey.has(key)) existingSpareByKey.set(key, resource);
    const fallbackKey = supportSpareResourceIdentityKey(resource.supportNodeName, resource.name, resource.model, "");
    if (!existingSpareByKey.has(fallbackKey)) existingSpareByKey.set(fallbackKey, resource);
  }
  const nonSpareResources = projectJson.supportResources.filter((resource) => !isSpareSupportResource(resource));
  const nextSpareResources = supportNodeNames.flatMap((nodeName, nodeIndex) => {
    return hardwareSpares.map((spare, spareIndex) => {
      const key = supportSpareResourceIdentityKey(nodeName, spare.name, spare.model, spare.equipment);
      const fallbackKey = supportSpareResourceIdentityKey(nodeName, spare.name, spare.model, "");
      const existing = existingSpareByKey.get(key) || existingSpareByKey.get(fallbackKey);
      return {
        id: cleanText(existing?.id) || `support-resource-${nodeIndex + 1}-spare-${spareIndex + 1}`,
        supportNodeName: nodeName,
        type: "spare",
        name: spare.name,
        model: spare.model,
        quantity: nonNegativeInteger(existing?.quantity ?? 0)
      };
    });
  });
  projectJson.supportResources = [...nonSpareResources, ...nextSpareResources];
}

function stripModelingImportValidationNonModelFields(projectJson) {
  if (!projectJson?.modelingImportValidation || typeof projectJson.modelingImportValidation !== "object") return;
  delete projectJson.modelingImportValidation.validationLevel;
}

function stripSupportResourceNonModelFields(projectJson) {
  if (!Array.isArray(projectJson?.supportResources)) return;
  for (const resource of projectJson.supportResources) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) continue;
    delete resource.equipment;
    delete resource.equipmentId;
  }
}

function projectHardwareSpareRows(projectJson) {
  const components = Array.isArray(projectJson?.components) ? projectJson.components : [];
  const seen = new Set();
  return components
    .filter((component) => component && typeof component === "object" && !Array.isArray(component))
    .filter((component) => {
      const productType = cleanText(component.productType).toUpperCase();
      return productType === "LRU";
    })
    .map((component, index) => ({
      name: cleanText(component.name || component.id) || `未命名LRU${index + 1}`,
      model: cleanText(component.model || component.partNo || component.id || component.name) || "LRU",
      equipment: cleanText(component.aircraftModel || component.equipment || component.equipmentType)
    }))
    .filter((spare) => {
      const key = supportSpareResourceIdentityKey("", spare.name, spare.model, spare.equipment);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isSpareSupportResource(resource) {
  const type = cleanText(resource?.type);
  return resource && typeof resource === "object" && !Array.isArray(resource)
    && (type.toLowerCase() === "spare" || type === "备件");
}

function supportSpareResourceIdentityKey(nodeName, name, model, equipment) {
  return [nodeName, name, model, equipment].map((value) => cleanText(value)).join("\u0001");
}

function supportNodeNamesFromSupportNodes(supportNodes) {
  const names = [];
  if (!Array.isArray(supportNodes)) return names;
  for (const node of supportNodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    if (isLegacySupportResourceRow(node)) continue;
    const name = cleanText(node.name || node.supportNodeName || node.id);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function isLegacySupportResourceRow(node) {
  return Boolean(
    node.importedResourceType
    || node.organizationNodeId
    || /(^|[-_])(personnel|equipment|spare|stock)([-_]|$)/i.test(String(node.id || ""))
  );
}

function normalizeTopLevelTransportPolicies(projectJson, nameByRef) {
  if (!Array.isArray(projectJson.transportPolicies)) return;
  projectJson.transportPolicies = projectJson.transportPolicies
    .filter((policy) => policy && typeof policy === "object" && !Array.isArray(policy))
    .map((policy, index) => {
      const normalized = {
        id: cleanText(policy.id) || `transport-policy-${index + 1}`,
        fromSupportNodeName: supportNodeNameForRef(policy.fromSupportNodeName || policy.from, nameByRef),
        toSupportNodeName: supportNodeNameForRef(policy.toSupportNodeName || policy.to, nameByRef)
      };
      for (const field of ["name", "direction", "triggerMode", "criticalInventory", "transferCycleHours", "capacity", "priority", "transportMode", "transportTimeHours"]) {
        if (policy[field] !== undefined) normalized[field] = policy[field];
      }
      if (normalized.direction !== undefined && normalized.transportMode === undefined) normalized.transportMode = normalized.direction;
      return normalized;
    });
}

function normalizeSupportNodeRefsInProject(projectJson, nameByRef) {
  for (const airport of Array.isArray(projectJson.airports) ? projectJson.airports : []) {
    if (airport && typeof airport === "object" && !Array.isArray(airport) && airport.supportNodeId !== undefined) {
      airport.supportNodeId = supportNodeNameForRef(airport.supportNodeId, nameByRef);
    }
  }
  for (const activity of Array.isArray(projectJson.supportActivities) ? projectJson.supportActivities : []) {
    normalizeSupportActivityNodeRefs(activity, nameByRef);
  }
}

function normalizeSupportActivityNodeRefs(value, nameByRef) {
  if (Array.isArray(value)) {
    for (const item of value) normalizeSupportActivityNodeRefs(item, nameByRef);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const field of ["supportNodeId", "resourceId"]) {
    if (value[field] !== undefined) value[field] = supportNodeNameForRef(value[field], nameByRef);
  }
  for (const field of ["lateralSupportNodes"]) {
    if (Array.isArray(value[field])) value[field] = value[field].map((ref) => supportNodeNameForRef(ref, nameByRef));
  }
  for (const child of Object.values(value)) normalizeSupportActivityNodeRefs(child, nameByRef);
}

function supportNodeNameForRef(value, nameByRef) {
  const text = cleanText(value);
  return nameByRef.get(text) || text;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function stripLegacySupportNodeResourceFields(projectJson) {
  if (!Array.isArray(projectJson.supportNodes)) return;
  const legacyFields = [
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
    "spareEquipment"
  ];
  for (const node of projectJson.supportNodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    for (const field of legacyFields) delete node[field];
  }
}

function projectEquipmentCatalog(projectJson) {
  const equipment = projectJson?.equipment && typeof projectJson.equipment === "object" && !Array.isArray(projectJson.equipment)
    ? projectJson.equipment
    : {};
  const aircraftTypes = [];
  const seen = new Set();

  const addAircraftType = (modelValue, source = {}) => {
    const model = cleanText(modelValue || source.model || source.name || source.id);
    if (!model || seen.has(model)) return;
    seen.add(model);
    aircraftTypes.push({
      id: cleanText(source.id) || aircraftTypeId(model, aircraftTypes.length + 1),
      model,
      name: cleanText(source.name) || model
    });
  };

  if (Array.isArray(equipment.aircraftTypes)) {
    for (const aircraftType of equipment.aircraftTypes) {
      if (typeof aircraftType === "string") {
        addAircraftType(aircraftType);
      } else if (aircraftType && typeof aircraftType === "object" && !Array.isArray(aircraftType)) {
        addAircraftType(aircraftType.model || aircraftType.name || aircraftType.id, aircraftType);
      }
    }
  }
  for (const member of projectAircraftMembers(projectJson)) addAircraftType(member.model);
  for (const component of Array.isArray(projectJson?.components) ? projectJson.components : []) addAircraftType(component?.aircraftModel);
  for (const model of Array.isArray(equipment.wholeMachineModels) ? equipment.wholeMachineModels : []) addAircraftType(model);
  addAircraftType(equipment.model);

  const wholeMachineModels = aircraftTypes.map((aircraftType) => aircraftType.model);
  if (!wholeMachineModels.length) return null;
  return {
    model: wholeMachineModels[0],
    wholeMachineModels,
    aircraftTypes
  };
}

function projectAircraftMembers(projectJson) {
  return [
    ...(Array.isArray(projectJson?.combatUnit?.members) ? projectJson.combatUnit.members : []),
    ...(Array.isArray(projectJson?.missionProfile?.combatUnit?.members) ? projectJson.missionProfile.combatUnit.members : [])
  ].filter((member) => member && typeof member === "object" && !Array.isArray(member));
}

function aircraftTypeId(model, index) {
  const slug = String(model || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `aircraft-type-${slug}` : `aircraft-type-${index}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function stripMissionProfileNonModelFields(missionProfile) {
  if (!missionProfile || typeof missionProfile !== "object" || Array.isArray(missionProfile)) return;
  delete missionProfile.basicMission;
  delete missionProfile.basicMissions;
  delete missionProfile.equipment;
  delete missionProfile.profileType;
  delete missionProfile.endCondition;
  delete missionProfile.repeatCycleHours;
  delete missionProfile.analysisRequests;
}

const MISSION_PROFILE_TASK_ITEM_FIELDS = [
  "basicMissionId",
  "basicTaskName",
  "groupName",
  "firstWaveTime",
  "dailyRepeatCount",
  "intervalHours",
  "equipmentType"
];

const MISSION_PROFILE_PERIODIC_TASK_FIELDS = [
  "id",
  "name",
  "repeatWeeks",
  "cycleDays",
  "compositeTasks",
  "compositeTaskIds"
];

const PERIODIC_COMPOSITE_TASK_FIELDS = [
  "compositeTaskId",
  "week",
  "weekIndex",
  "weekday",
  "dayOfWeek"
];

const PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS = [
  ["mondayCompositeTaskId", "monday"],
  ["tuesdayCompositeTaskId", "tuesday"],
  ["wednesdayCompositeTaskId", "wednesday"],
  ["thursdayCompositeTaskId", "thursday"],
  ["fridayCompositeTaskId", "friday"],
  ["saturdayCompositeTaskId", "saturday"],
  ["sundayCompositeTaskId", "sunday"]
];

function normalizeMissionProfileReferenceFields(projectJson) {
  const missionProfile = projectJson?.missionProfile;
  if (!missionProfile || typeof missionProfile !== "object" || Array.isArray(missionProfile)) return;
  normalizeMissionProfileCompositeTasks(projectJson, missionProfile);
  normalizeMissionProfilePeriodicTasks(missionProfile);
  if (missionProfileHasPeriodicDuration(missionProfile)) delete missionProfile.durationHours;
}

function normalizeMissionProfileCompositeTasks(projectJson, missionProfile) {
  if (!Array.isArray(missionProfile.compositeTasks)) return;
  const basicMissionIds = new Set(basicMissionRecordsForProject(projectJson).map((task) => basicMissionId(task)).filter(Boolean));
  for (const composite of missionProfile.compositeTasks) {
    if (!composite || typeof composite !== "object" || Array.isArray(composite)) continue;
    if (!Array.isArray(composite.taskItems)) continue;
    composite.taskItems = composite.taskItems
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => normalizedMissionProfileTaskItem(item, basicMissionIds))
      .filter((item) => Object.keys(item).length > 0);
  }
}

function normalizedMissionProfileTaskItem(item, basicMissionIds) {
  const normalized = {};
  const basicMissionIdValue = cleanText(item.basicMissionId || item.missionId);
  if (basicMissionIdValue) {
    normalized.basicMissionId = basicMissionIdValue;
  } else {
    const legacyId = cleanText(item.id);
    if (legacyId && basicMissionIds.has(legacyId)) normalized.basicMissionId = legacyId;
  }
  for (const field of MISSION_PROFILE_TASK_ITEM_FIELDS) {
    if (field === "basicMissionId") continue;
    copyPresentValue(normalized, field, item[field]);
  }
  return normalized;
}

function normalizeMissionProfilePeriodicTasks(missionProfile) {
  if (!Array.isArray(missionProfile.periodicTasks)) return;
  missionProfile.periodicTasks = missionProfile.periodicTasks
    .filter((task) => task && typeof task === "object" && !Array.isArray(task))
    .map((task) => normalizedMissionProfilePeriodicTask(task))
    .filter((task) => Object.keys(task).length > 0);
}

function normalizedMissionProfilePeriodicTask(task) {
  const normalized = {};
  copyPresentValue(normalized, "id", task.id);
  copyPresentValue(normalized, "name", task.name || task.periodicTaskName || task.taskName || task.experimentName);
  const repeatWeeks = firstPositiveNumber(task.repeatWeeks, task.repeatRounds, task.repeatCount);
  if (repeatWeeks !== null) normalized.repeatWeeks = repeatWeeks;
  const cycleDays = periodicCycleDays(task) ?? (repeatWeeks !== null ? 7 : null);
  if (cycleDays !== null) normalized.cycleDays = cycleDays;
  const compositeTasks = normalizedPeriodicCompositeTasks(task, repeatWeeks);
  const compositeTaskIds = uniqueStrings([
    ...(Array.isArray(task.compositeTaskIds) ? task.compositeTaskIds : []),
    ...compositeTasks.map((item) => item.compositeTaskId)
  ]);
  if (compositeTasks.length) normalized.compositeTasks = compositeTasks;
  if (compositeTaskIds.length) normalized.compositeTaskIds = compositeTaskIds;
  for (const field of Object.keys(normalized)) {
    if (!MISSION_PROFILE_PERIODIC_TASK_FIELDS.includes(field)) delete normalized[field];
  }
  return normalized;
}

function normalizedPeriodicCompositeTasks(task, repeatWeeks) {
  const explicit = Array.isArray(task.compositeTasks)
    ? task.compositeTasks
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => normalizedPeriodicCompositeTask(item))
        .filter((item) => item.compositeTaskId)
    : [];
  if (explicit.length) return explicit;

  const assignments = [];
  const rawAssignments = task.weekdayAssignments && typeof task.weekdayAssignments === "object" && !Array.isArray(task.weekdayAssignments)
    ? task.weekdayAssignments
    : {};
  for (const [legacyField, weekday] of PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS) {
    assignments.push([weekday, rawAssignments[weekday] || rawAssignments[legacyField] || task[legacyField]]);
  }
  const weekCount = Math.max(1, Math.round(repeatWeeks || 1));
  const compositeTasks = [];
  for (let weekIndex = 1; weekIndex <= weekCount; weekIndex += 1) {
    for (const [weekday, compositeTaskId] of assignments) {
      const compositeId = cleanText(compositeTaskId);
      if (!compositeId) continue;
      compositeTasks.push({ compositeTaskId: compositeId, weekIndex, weekday });
    }
  }
  return compositeTasks;
}

function normalizedPeriodicCompositeTask(item) {
  const normalized = {};
  for (const field of PERIODIC_COMPOSITE_TASK_FIELDS) copyPresentValue(normalized, field, item[field]);
  return normalized;
}

function periodicCycleDays(task) {
  const direct = firstPositiveNumber(task.cycleDays, task.repeatCycleDays, task.periodDays, task.taskPeriodDays);
  if (direct !== null) return direct;
  const value = positiveNumber(task.repeatCycleValue);
  if (value === null) return null;
  const unit = cleanText(task.repeatCycleUnit || "day").toLowerCase();
  if (["week", "weeks", "周", "星期"].includes(unit)) return value * 7;
  if (["hour", "hours", "小时"].includes(unit)) return value / 24;
  return value;
}

function missionProfileHasPeriodicDuration(missionProfile) {
  return Array.isArray(missionProfile.periodicTasks)
    && missionProfile.periodicTasks.some((task) => task && typeof task === "object" && (
      positiveNumber(task.repeatWeeks) !== null || positiveNumber(task.cycleDays) !== null
    ));
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = positiveNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function stripSupportActivityTypoFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripSupportActivityTypoFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  delete value.requireDevices;
  for (const child of Object.values(value)) stripSupportActivityTypoFields(child);
}

function stripSupportActivityRuleUiFields(value) {
  if (!Array.isArray(value)) return;
  const fields = [
    "calendarDayFloatRatio",
    "runHourFloatRatio",
    "takeoffLandingFloatRatio",
    "useCalendarRule",
    "useFlightHourRule",
    "useTakeoffLandingRule"
  ];
  for (const activity of value) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    for (const field of fields) delete activity[field];
  }
}

function stripComponentNonModelFields(components) {
  if (!Array.isArray(components)) return;
  for (const component of components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) continue;
    delete component.connectionType;
    delete component.failureModel;
    delete component.failureRate;
    delete component.lifeLimitHours;
    delete component.mtbfHours;
    delete component.rms;
    delete component.spareType;
    const profile = component.specialRepairProfile;
    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      delete profile.repairRatio;
      delete profile.replacementRatio;
      if (Object.keys(profile).length === 0) delete component.specialRepairProfile;
    }
  }
}

function migrateRootMissionPhasesToBasicMissions(projectJson) {
  const rootPhases = Array.isArray(projectJson?.missionPhases)
    ? projectJson.missionPhases.filter((phase) => phase && typeof phase === "object" && !Array.isArray(phase))
    : [];
  if (!rootPhases.length || !Array.isArray(projectJson?.basicMissions)) return;
  for (const mission of projectJson.basicMissions) {
    if (!mission || typeof mission !== "object" || Array.isArray(mission)) continue;
    if (Array.isArray(mission.missionPhases) && mission.missionPhases.length > 0) continue;
    mission.missionPhases = cloneJson(rootPhases);
  }
}

function stripSupportActivitySpareTypeFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripSupportActivitySpareTypeFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  delete value.spareType;
}

function stripDeprecatedSupportActivityStrategyFields(projectJson) {
  if (!Array.isArray(projectJson?.supportActivities)) return;
  for (const activity of projectJson.supportActivities) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    delete activity.transportStrategies;
    delete activity.organizationStrategies;
  }
}

function normalizeSupportActivityReferenceFields(projectJson) {
  if (!Array.isArray(projectJson?.supportActivities)) return;
  for (const activity of projectJson.supportActivities) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    activity.activityName ||= activity.name || activity.id || "保障活动";
    activity.planType = canonicalSupportActivityPlanType(activity);
    delete activity.name;
    delete activity.planGroupId;
    delete activity.resourceId;
    delete activity.supportNodeId;
    delete activity.requiredDevices;
    delete activity.requiredPersonnel;
  }
}

// basicMissions[].supportActivityName is a name-based reference.  Keep the
// first existing name stable and deterministically disambiguate later copies
// so a legacy project can be saved without creating an ambiguous reference.
function ensureUniqueSupportActivityNames(projectJson) {
  const activities = Array.isArray(projectJson?.supportActivities) ? projectJson.supportActivities : [];
  const usedNames = new Set();
  for (const [index, activity] of activities.entries()) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    const baseName = normalizedText(activity.activityName || activity.name || activity.id) || `保障活动${index + 1}`;
    let activityName = baseName;
    let duplicateIndex = 2;
    while (usedNames.has(activityName)) {
      activityName = `${baseName}（${duplicateIndex}）`;
      duplicateIndex += 1;
    }
    activity.activityName = activityName;
    usedNames.add(activityName);
  }
}

function canonicalSupportActivityPlanType(activity = {}) {
  const planType = String(activity.planType || "").trim();
  const activityType = String(activity.activityType || "").trim();
  const combined = `${planType} ${activityType}`.toLowerCase();
  if (planType === "修复性维修方案" || /修复性维修|corrective/.test(combined)) return "修复性维修方案";
  if (planType === "预防性维修方案" || /预防性维修|preventive/.test(combined)) return "预防性维修方案";
  if (planType === "后勤保障方案" || planType === "后勤保障活动方案" || /后勤保障|logistics/.test(combined)) return "后勤保障方案";
  if (
    planType === "使用保障方案"
    || planType === "直接准备方案"
    || planType === "再次出动准备方案"
    || planType === "飞行后检查方案"
    || /飞行前保障|使用保障|operations|preflight|relaunch|postflight/.test(combined)
  ) {
    return "使用保障方案";
  }
  return "使用保障方案";
}

const SUPPORT_ACTIVITY_MTTR_FIELDS = [
  "maxRepairTimeMinutes",
  "meanRepairTimeMinutes",
  "mttrMinutes",
  "mttr",
  "repairDistribution",
  "repairDistributionType",
  "repairTypes"
];

function stripSupportActivityMttrFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripSupportActivityMttrFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const field of SUPPORT_ACTIVITY_MTTR_FIELDS) delete value[field];
  for (const job of Array.isArray(value.jobs) ? value.jobs : []) {
    if (!job || typeof job !== "object" || Array.isArray(job)) continue;
    for (const field of SUPPORT_ACTIVITY_MTTR_FIELDS) delete job[field];
  }
}

function syncCompositeTaskInheritedBasicFields(projectJson) {
  const basicMissions = basicMissionRecordsForProject(projectJson);
  const composites = Array.isArray(projectJson.missionProfile?.compositeTasks)
    ? projectJson.missionProfile.compositeTasks
    : [];
  if (!basicMissions.length || !composites.length) return;

  for (const composite of composites) {
    const items = Array.isArray(composite?.taskItems) ? composite.taskItems : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const basicMission = findBasicMissionForTaskItem(item, basicMissions);
      if (!basicMission) continue;
      copyPresentValue(item, "basicMissionId", basicMissionId(basicMission));
      copyPresentValue(item, "basicTaskName", basicMissionDisplayName(basicMission));
      copyPresentValue(item, "equipmentType", basicMission.equipmentType);
    }
  }
}

function basicMissionRecordsForProject(projectJson) {
  return [
    ...(Array.isArray(projectJson.basicMissions) ? projectJson.basicMissions : []),
    ...(Array.isArray(projectJson.missionProfile?.basicMissions) ? projectJson.missionProfile.basicMissions : [])
  ].filter((task) => task && typeof task === "object" && !Array.isArray(task));
}

function findBasicMissionForTaskItem(item, basicMissions) {
  const itemId = String(item.basicMissionId || "").trim();
  if (itemId) {
    const byId = basicMissions.find((task) => basicMissionId(task) === itemId);
    if (byId) return byId;
  }
  const legacyItemId = String(item.id || "").trim();
  if (legacyItemId) {
    const byId = basicMissions.find((task) => basicMissionId(task) === legacyItemId);
    if (byId) return byId;
  }
  const itemName = String(item.basicTaskName || "").trim();
  if (!itemName) return null;
  return basicMissions.find((task) => basicMissionDisplayName(task) === itemName) || null;
}

function basicMissionId(task) {
  return String(task?.id || task?.missionId || task?.taskNo || "").trim();
}

function basicMissionDisplayName(task) {
  return String(task?.name || task?.basicTaskName || task?.missionId || "").trim();
}

function copyPresentValue(target, key, value) {
  if (value === undefined || value === null || value === "") return;
  target[key] = value;
}

function ensureBasicMissionIdentity(task, index) {
  const fallbackId = `basic-mission-${index + 1}`;
  task.id = basicMissionId(task) || fallbackId;
  task.missionId ||= task.id;
  task.name ||= basicMissionDisplayName(task) || task.missionId;
  task.basicTaskName ||= task.name;
}

function stripLegacyBasicMissionFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripLegacyBasicMissionFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  delete value.basicMission;
  for (const child of Object.values(value)) stripLegacyBasicMissionFields(child);
}

function canonicalizeSupportActivityJobPredecessors(projectJson) {
  const activities = Array.isArray(projectJson.supportActivities) ? projectJson.supportActivities : [];
  for (const activity of activities) {
    const jobs = Array.isArray(activity?.jobs) ? activity.jobs.filter((job) => job && typeof job === "object") : [];
    if (!jobs.length) continue;
    const usedCodes = new Set(jobs.map((job) => normalizedText(job.activityCode)).filter(Boolean));
    jobs.forEach((job, index) => {
      if (normalizedText(job.activityCode)) return;
      const code = nextSupportActivityJobCode(usedCodes, index);
      job.activityCode = code;
      usedCodes.add(code);
    });
    const aliasCounts = new Map();
    const codeByAlias = new Map();
    jobs.forEach((job, index) => {
      const code = normalizedText(job.activityCode);
      if (!code) return;
      for (const alias of supportActivityJobAliases(job, index)) {
        aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
        codeByAlias.set(alias, code);
      }
    });
    for (const job of jobs) {
      const rawPredecessors = job.predecessors;
      if (rawPredecessors === undefined || rawPredecessors === null) continue;
      const predecessors = Array.isArray(rawPredecessors) ? rawPredecessors : [rawPredecessors];
      const seen = new Set();
      job.predecessors = predecessors
        .map((predecessor) => {
          const value = normalizedText(predecessor);
          if (!value) return "";
          return aliasCounts.get(value) === 1 ? codeByAlias.get(value) : value;
        })
        .filter((value) => {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        });
    }
  }
}

function liftSupportActivityJobsToTopLevel(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return;
  const activities = Array.isArray(projectJson.supportActivities) ? projectJson.supportActivities : [];
  const jobsByCode = new Map();
  for (const job of Array.isArray(projectJson.supportActivityJobs) ? projectJson.supportActivityJobs : []) {
    if (!job || typeof job !== "object" || Array.isArray(job)) continue;
    const code = normalizedText(job.activityCode);
    if (!code || jobsByCode.has(code)) continue;
    jobsByCode.set(code, supportActivityJobDefinition(job));
  }
  for (const activity of activities) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    if (!Array.isArray(activity.jobs)) continue;
    const jobs = activity.jobs.filter((job) => job && typeof job === "object" && !Array.isArray(job));
    if (!jobs.length) {
      activity.activityCodes ||= [];
      activity.predecessors ||= {};
      delete activity.jobs;
      continue;
    }
    const activityCodes = [];
    const codeAssignments = [];
    const localCodeMap = new Map();
    for (const job of jobs) {
      const requestedCode = normalizedText(job.activityCode);
      if (!requestedCode) continue;
      const definition = supportActivityJobDefinition(job);
      const code = supportActivityJobCodeForDefinition(requestedCode, definition, jobsByCode);
      definition.activityCode = code;
      activityCodes.push(code);
      codeAssignments.push({ job, requestedCode, code });
      if (!localCodeMap.has(requestedCode)) localCodeMap.set(requestedCode, code);
      if (!jobsByCode.has(code)) jobsByCode.set(code, definition);
    }
    const activityCodeSet = new Set(activityCodes);
    const predecessorsByCode = {};
    for (const assignment of codeAssignments) {
      predecessorsByCode[assignment.code] = Array.isArray(assignment.job.predecessors)
        ? assignment.job.predecessors
          .map((value) => localCodeMap.get(normalizedText(value)) || normalizedText(value))
          .filter((value) => value && activityCodeSet.has(value))
        : [];
    }
    activity.activityCodes = activityCodes;
    activity.predecessors = predecessorsByCode;
    delete activity.jobs;
  }
  projectJson.supportActivityJobs = Array.from(jobsByCode.values());
}

function materializeSupportActivityJobApplicability(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return;
  const jobs = Array.isArray(projectJson.supportActivityJobs) ? projectJson.supportActivityJobs : [];
  const activities = Array.isArray(projectJson.supportActivities) ? projectJson.supportActivities : [];
  const componentsById = new Map(
    (Array.isArray(projectJson.components) ? projectJson.components : [])
      .filter((component) => component && typeof component === "object" && !Array.isArray(component))
      .map((component) => [normalizedText(component.id), component])
      .filter(([id]) => id)
  );
  const jobsByCode = new Map(
    jobs
      .filter((job) => job && typeof job === "object" && !Array.isArray(job))
      .map((job) => [normalizedText(job.activityCode), job])
      .filter(([code]) => code)
  );
  for (const activity of activities) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) continue;
    const component = componentsById.get(normalizedText(activity.equipmentId));
    const aircraftModel = normalizedText(activity.aircraftModel)
      || normalizedText(activity.equipmentType)
      || normalizedText(component?.aircraftModel);
    if (!aircraftModel || !Array.isArray(activity.activityCodes)) continue;
    for (const rawCode of activity.activityCodes) {
      const job = jobsByCode.get(normalizedText(rawCode));
      if (!job || Object.hasOwn(job, "applicableAircraft")) continue;
      job.applicableAircraft = aircraftModel;
    }
  }
}

function supportActivityJobCodeForDefinition(requestedCode, definition, jobsByCode) {
  const existing = jobsByCode.get(requestedCode);
  if (!existing || supportActivityJobDefinitionsEqual(existing, definition)) return requestedCode;
  return uniqueSupportActivityJobCode(requestedCode, new Set(jobsByCode.keys()));
}

function supportActivityJobDefinitionsEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function uniqueSupportActivityJobCode(requestedCode, usedCodes) {
  if (!usedCodes.has(requestedCode)) return requestedCode;
  const match = requestedCode.match(/^(.*?)(?:-(\d+))?$/);
  const prefix = (match?.[1] || requestedCode || "BA").replace(/-$/, "");
  let index = Number(match?.[2] || 2);
  let code = `${prefix}-${String(index).padStart(3, "0")}`;
  while (usedCodes.has(code)) {
    index += 1;
    code = `${prefix}-${String(index).padStart(3, "0")}`;
  }
  return code;
}

function supportActivityJobDefinition(job) {
  const definition = cloneJson(job);
  delete definition.predecessors;
  for (const field of SUPPORT_ACTIVITY_MTTR_FIELDS) delete definition[field];
  return definition;
}

function supportActivityJobAliases(job, index) {
  return [
    job.activityCode,
    job.workName,
    `BA-${index + 1}`
  ].map((value) => normalizedText(value)).filter(Boolean);
}

function nextSupportActivityJobCode(usedCodes, index) {
  let candidateIndex = index + 1;
  let candidate = "";
  do {
    candidate = `BA-${String(candidateIndex).padStart(3, "0")}`;
    candidateIndex += 1;
  } while (usedCodes.has(candidate));
  return candidate;
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedSeedPolicy(projectJson, experiment) {
  const source = projectJson.seedPolicy && typeof projectJson.seedPolicy === "object" && !Array.isArray(projectJson.seedPolicy)
    ? projectJson.seedPolicy
    : {};
  const mode = source.mode === "random" ? "random" : "fixed";
  const baseSeed = positiveInteger(source.baseSeed ?? experiment.seed ?? 0, 0);
  return { mode, baseSeed };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function normalizedScenarioComposition(projectJson) {
  const source = projectJson.scenarioComposition && typeof projectJson.scenarioComposition === "object" && !Array.isArray(projectJson.scenarioComposition)
    ? projectJson.scenarioComposition
    : {};
  const overrides = Array.isArray(source.overrides)
    ? source.overrides.map(normalizedScenarioOverride).filter(Boolean)
    : [];
  return {
    schemaVersion: source.schemaVersion || "scenario-composition-v0",
    ...(source.sourceProjectId ? { sourceProjectId: String(source.sourceProjectId) } : {}),
    ...(source.baseProjectVersion ? { baseProjectVersion: String(source.baseProjectVersion) } : {}),
    overrides
  };
}

function normalizedStopPolicy(projectJson, experiment) {
  const { source, defaulted } = stopPolicySource(projectJson, experiment);
  const mode = source.mode === "and" ? "and" : "or";
  const conditions = Array.isArray(source.conditions)
    ? source.conditions.map(normalizedStopCondition).filter(Boolean)
    : [];
  const policy = {
    schemaVersion: source.schemaVersion || "stop-policy-v0",
    mode,
    conditions: conditions.length ? conditions : [{ type: "duration" }]
  };
  if (defaulted || truthyFlag(source.defaulted)) policy.defaulted = true;
  return policy;
}

function stopPolicySource(projectJson, experiment) {
  if (projectJson.stopPolicy && typeof projectJson.stopPolicy === "object" && !Array.isArray(projectJson.stopPolicy)) {
    return { source: projectJson.stopPolicy, defaulted: false };
  }
  if (experiment.stopPolicy && typeof experiment.stopPolicy === "object" && !Array.isArray(experiment.stopPolicy)) {
    return { source: experiment.stopPolicy, defaulted: false };
  }
  return { source: {}, defaulted: true };
}

function normalizedStopCondition(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
  const type = normalizedStopConditionType(condition.type);
  if (type === "duration") {
    const durationMinutes = positiveInteger(
      condition.durationMinutes ?? condition.duration_minutes ?? condition.minute ?? condition.minutes,
      0
    );
    return durationMinutes > 0 ? { type, durationMinutes } : { type };
  }
  if (type === "specifiedTime") {
    const minute = positiveInteger(condition.minute ?? condition.timeMinute ?? condition.specifiedMinute, 0);
    return minute > 0 ? { type, minute } : null;
  }
  return type ? { type } : null;
}

function normalizedStopConditionType(value) {
  const text = String(value || "").trim();
  if (["duration", "taskDuration", "task_duration"].includes(text)) return "duration";
  if (["failure", "taskFailure", "task_failure"].includes(text)) return "failure";
  if (["specifiedTime", "specified_time", "time", "targetTime", "target_time"].includes(text)) return "specifiedTime";
  return "";
}

function truthyFlag(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizedScenarioOverride(override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return null;
  const path = String(override.path || "").trim();
  if (!path) return null;
  const valueType = ["string", "number", "boolean", "json"].includes(override.valueType) ? override.valueType : "string";
  return {
    path,
    valueType,
    value: parsedScenarioOverrideValue(override.value, valueType),
    ...(override.label ? { label: String(override.label) } : {})
  };
}

function parsedScenarioOverrideValue(value, valueType) {
  if (valueType === "number") return Number(value);
  if (valueType === "boolean") return value === true || value === "true";
  if (valueType === "json") return typeof value === "string" ? JSON.parse(value) : cloneJson(value ?? null);
  return String(value ?? "");
}

function applyScenarioCompositionOverrides(projectJson, composition) {
  for (const override of composition.overrides) {
    setObjectPath(projectJson, override.path, cloneJson(override.value));
  }
}

function setObjectPath(obj, path, value) {
  const parts = String(path).split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Scenario override path is required");
  let current = obj;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    const nextContainer = isArrayIndex(nextPart) ? [] : {};
    if (Array.isArray(current)) {
      const itemIndex = arrayIndex(part);
      if (itemIndex === null) throw new Error(`Scenario override path segment must be an array index: ${part}`);
      if (!isObjectContainer(current[itemIndex])) current[itemIndex] = nextContainer;
      current = current[itemIndex];
    } else {
      if (!isObjectContainer(current[part])) current[part] = nextContainer;
      current = current[part];
    }
  }
  const lastPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const itemIndex = arrayIndex(lastPart);
    if (itemIndex === null) throw new Error(`Scenario override path segment must be an array index: ${lastPart}`);
    current[itemIndex] = value;
    return;
  }
  current[lastPart] = value;
}

function isObjectContainer(value) {
  return value && typeof value === "object";
}

function isArrayIndex(value) {
  return arrayIndex(value) !== null;
}

function arrayIndex(value) {
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  return Number(text);
}

export function buildExperimentPlanConfig(projectJson) {
  const experiment = projectJson.experiment && typeof projectJson.experiment === "object" && !Array.isArray(projectJson.experiment)
    ? projectJson.experiment
    : {};
  const seedPolicy = normalizedSeedPolicy(projectJson, experiment);
  const scenarioComposition = normalizedScenarioComposition(projectJson);
  const stopPolicy = normalizedStopPolicy(projectJson, experiment);
  const branchProjectJson = cloneJson(projectJson);
  applyScenarioCompositionOverrides(branchProjectJson, scenarioComposition);
  const config = {
    name: experiment.name || "frontend experiment",
    steps: Number(experiment.steps ?? 3),
    samples: Number(experiment.samples ?? 1),
    seed: seedPolicy.baseSeed,
    seedPolicy,
    scenarioComposition,
    stopPolicy,
    projectJson: buildBackendProjectJson(branchProjectJson),
    monteCarlo: cloneJson(projectJson.monteCarlo || {}),
    analysisRequests: cloneJson(projectJson.analysisRequests || {})
  };
  return config;
}

export function buildPreviewResultState(projectJson) {
  return {
    previewSingleResult: runSimulation(projectJson),
    previewMonteCarloResult: runMonteCarlo(projectJson)
  };
}

export function buildDemoResultState(projectJson) {
  const previewState = buildPreviewResultState(projectJson);
  return {
    singleResult: previewState.previewSingleResult,
    monteCarloResult: previewState.previewMonteCarloResult
  };
}

export function buildFrontendResultState(projectJson, resultSummary = null) {
  const previewState = buildPreviewResultState(projectJson);
  const state = {
    singleResult: previewState.previewSingleResult,
    monteCarloResult: previewState.previewMonteCarloResult
  };
  const metrics = resultSummary?.metrics || {};
  state.singleResult.final = {
    ...state.singleResult.final,
    ...metrics
  };
  state.singleResult.backendResultSummary = resultSummary;
  return state;
}

function wrapAuthTransport(transport, getAuthToken) {
  return (request) => {
    const token = request.auth === false ? "" : getAuthToken?.();
    if (!token) return transport(request);
    return transport({
      ...request,
      headers: {
        ...(request.headers || {}),
        authorization: `Bearer ${token}`
      }
    });
  };
}

function createFetchTransport(baseUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async ({ method, path, body, headers = {}, responseType = "json", timeoutMs: requestTimeoutMs } = {}) => {
    if (typeof fetch !== "function") {
      throw new Error("Backend API fetch transport is unavailable");
    }
    const effectiveTimeoutMs = Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
      ? Number(requestTimeoutMs)
      : timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const requestHeaders = Object.assign(
      {},
      headers,
      body === undefined ? {} : { "content-type": "application/json" }
    );
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: Object.keys(requestHeaders).length === 0 ? undefined : requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      const error = new Error(
        timedOut
          ? `Backend API request timed out after ${effectiveTimeoutMs}ms`
          : `Backend API network request failed: ${err && err.message ? err.message : "unknown error"}`
      );
      error.code = timedOut ? "backend_request_timeout" : "backend_network_error";
      error.details = { method, path, timeoutMs: effectiveTimeoutMs };
      error.cause = err;
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (responseType === "blob" && response.ok) {
      return response.blob();
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || `Backend API HTTP ${response.status}`);
      error.code = payload?.code;
      error.details = payload?.details || {};
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
