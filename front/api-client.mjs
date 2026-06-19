import {
  runMonteCarlo,
  runSimulation
} from "./sim-engine.mjs";

const DEFAULT_API_BASE = "/api";

export function createBackendApiClient({ baseUrl = DEFAULT_API_BASE, transport } = {}) {
  const request = transport || createFetchTransport(baseUrl);
  return {
    validateProject(projectJson) {
      return request({ method: "POST", path: "/projects/validate", body: projectJson });
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
    startSimulationRun(projectId, experimentPlanId, modelFamily = "smoke") {
      return request({
        method: "POST",
        path: "/simulation-runs",
        body: {
          project_id: projectId,
          experiment_plan_id: experimentPlanId,
          model_family: modelFamily
        }
      });
    },
    getRun(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}` });
    },
    getRunResult(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}/result` });
    },
    getRunArtifacts(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}/artifacts` });
    },
    getRunChain(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}/chain` });
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
    seed: Number(projectJson.experiment?.seed ?? 0)
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

function createFetchTransport(baseUrl) {
  return async ({ method, path, body }) => {
    if (typeof fetch !== "function") {
      throw new Error("Backend API fetch transport is unavailable");
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || `Backend API HTTP ${response.status}`);
    }
    return payload;
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
