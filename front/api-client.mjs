import {
  runMonteCarlo,
  runSimulation
} from "./sim-engine.mjs";

const DEFAULT_API_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 10000;

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
    validateProject(projectJson) {
      return request({ method: "POST", path: "/projects/validate", body: projectJson });
    },
    validateModelingImport(importPackage) {
      return request({ method: "POST", path: "/modeling-imports/validate", body: importPackage });
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
    compileModelingImportScenario(importId, modelFamily = "smoke") {
      return request({
        method: "POST",
        path: `/modeling-imports/${encodeURIComponent(importId)}/compile-scenario`,
        body: { model_family: modelFamily }
      });
    },
    async saveProject(projectJson) {
      await request({ method: "POST", path: "/projects/validate", body: projectJson });
      return request({ method: "POST", path: "/projects", body: projectJson });
    },
    getProject(projectId) {
      return request({ method: "GET", path: `/projects/${encodeURIComponent(projectId)}` });
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
    submitRun(runRequest) {
      return request({
        method: "POST",
        path: "/runs",
        body: runRequest
      });
    },
    startSimulationRun(projectId, experimentPlanId, modelFamily = "smoke") {
      return request({
        method: "POST",
        path: "/runs",
        body: {
          project_id: projectId,
          experiment_plan_id: experimentPlanId,
          model_family: modelFamily,
          run_type: "single"
        }
      });
    },
    getRunStatus(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}` });
    },
    getRun(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}` });
    },
    getRunResult(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/result` });
    },
    getRunArtifacts(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/artifacts` });
    },
    getRunChain(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/chain` });
    }
  };
}

export function buildBackendProjectJson(scenario, project = {}) {
  const projectJson = cloneJson(scenario);
  projectJson.schema_version ||= "project-v0";
  projectJson.project_id ||= project.id ? `project-${project.id}` : `project-${projectJson.scenarioId}`;
  projectJson.project_version ||= "project-v0.1";
  return projectJson;
}

export function buildExperimentPlanConfig(projectJson) {
  return {
    name: projectJson.experiment?.name || "frontend experiment",
    steps: Number(projectJson.experiment?.steps ?? 3),
    samples: Number(projectJson.experiment?.samples ?? 1),
    seed: Number(projectJson.experiment?.seed ?? 0),
    projectJson: cloneJson(projectJson),
    monteCarlo: cloneJson(projectJson.monteCarlo || {})
  };
}

export function buildDemoResultState(projectJson) {
  return {
    singleResult: runSimulation(projectJson),
    monteCarloResult: runMonteCarlo(projectJson)
  };
}

export function buildFrontendResultState(projectJson, resultSummary = null) {
  const state = buildDemoResultState(projectJson);
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
  return async ({ method, path, body, headers = {} }) => {
    if (typeof fetch !== "function") {
      throw new Error("Backend API fetch transport is unavailable");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestHeaders = {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    };
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
          ? `Backend API request timed out after ${timeoutMs}ms`
          : `Backend API network request failed: ${err && err.message ? err.message : "unknown error"}`
      );
      error.code = timedOut ? "backend_request_timeout" : "backend_network_error";
      error.details = { method, path, timeoutMs };
      error.cause = err;
      throw error;
    } finally {
      clearTimeout(timeoutId);
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
