import {
  runMonteCarlo,
  runSimulation
} from "./sim-engine.mjs";

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
    archiveRun(runId) {
      return request({ method: "POST", path: `/runs/${encodeURIComponent(runId)}/archive` });
    },
    deleteRun(runId) {
      return request({ method: "DELETE", path: `/runs/${encodeURIComponent(runId)}` });
    }
  };
}

export function buildBackendProjectJson(scenario, project = {}) {
  const projectJson = cloneJson(scenario);
  normalizeProjectJsonBasicMissions(projectJson);
  syncCompositeTaskInheritedBasicFields(projectJson);
  canonicalizeSupportActivityJobPredecessors(projectJson);
  stripProjectRuntimeConfig(projectJson);
  stripProjectNonModelFields(projectJson);
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
  for (const child of Object.values(value)) stripProjectRuntimeConfig(child);
}

function stripProjectNonModelFields(projectJson) {
  if (!projectJson || typeof projectJson !== "object") return;
  const equipmentCatalog = projectEquipmentCatalog(projectJson);
  delete projectJson.deletedSupportResourceKeys;
  if (equipmentCatalog) {
    projectJson.equipment = equipmentCatalog;
  } else {
    delete projectJson.equipment;
  }
  delete projectJson.basicMission;
  stripLegacyBasicMissionFields(projectJson);
  stripMissionProfileNonModelFields(projectJson.missionProfile);
  stripSupportActivityTypoFields(projectJson);
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

function stripSupportActivityTypoFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripSupportActivityTypoFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  delete value.requireDevices;
  for (const child of Object.values(value)) stripSupportActivityTypoFields(child);
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
      copyPresentValue(item, "taskDurationMinutes", basicMission.taskDurationMinutes);
      copyPresentValue(item, "equipmentQuantity", basicMission.equipmentQuantity);
      copyPresentValue(item, "preparationMinutes", basicMission.preparationMinutes);
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
  const branchProjectJson = cloneJson(projectJson);
  applyScenarioCompositionOverrides(branchProjectJson, scenarioComposition);
  const config = {
    name: experiment.name || "frontend experiment",
    steps: Number(experiment.steps ?? 3),
    samples: Number(experiment.samples ?? 1),
    seed: seedPolicy.baseSeed,
    seedPolicy,
    scenarioComposition,
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
