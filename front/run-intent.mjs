import { buildExperimentPlanConfig } from "./api-client.mjs";

const SUPPORTED_RUN_TYPES = new Set(["single", "monte_carlo"]);

export function buildRunIntent({
  runType,
  projectJson,
  planProjectJson,
  mcExperimentId = "",
  experimentId = "",
  modelFamily = "aircraft_support_v1"
}) {
  if (!SUPPORTED_RUN_TYPES.has(runType)) {
    throw new Error(`Unsupported runType: ${runType}`);
  }
  if (!projectJson || typeof projectJson !== "object") {
    throw new Error("RunIntent requires projectJson");
  }
  if (!planProjectJson || typeof planProjectJson !== "object") {
    throw new Error("RunIntent requires planProjectJson");
  }

  const normalizedPlanProjectJson = runType === "monte_carlo"
    ? withCanonicalMonteCarloAnalysisRequest(planProjectJson)
    : cloneJson(planProjectJson);
  const experimentPlanConfig = buildExperimentPlanConfig(normalizedPlanProjectJson);
  const runRequest = {
    project_id: projectJson.project_id,
    experiment_plan_id: "",
    model_family: modelFamily,
    run_type: runType,
    ...(experimentId ? { experiment_id: experimentId } : {}),
    ...(runType === "monte_carlo" && mcExperimentId ? { mc_experiment_id: mcExperimentId } : {})
  };

  return {
    runType,
    projectJson: cloneJson(projectJson),
    planProjectJson: normalizedPlanProjectJson,
    experimentPlanConfig,
    runRequest
  };
}

export function bindExperimentPlanId(intent, experimentPlanId) {
  return {
    ...intent,
    runRequest: {
      ...intent.runRequest,
      experiment_plan_id: experimentPlanId
    }
  };
}

export async function submitRunIntent(apiClient, options) {
  const intent = buildRunIntent(options);
  const savedProject = await apiClient.saveProject(intent.projectJson);
  const modelingSnapshot = await apiClient.createModelingSnapshot(savedProject.project_id);
  const experimentPlan = await apiClient.createExperimentPlan(savedProject.project_id, intent.experimentPlanConfig);
  const boundIntent = bindExperimentPlanId(intent, experimentPlan.experiment_plan_id);
  const run = await apiClient.submitRun({
    ...boundIntent.runRequest,
    project_id: savedProject.project_id
  });

  return {
    intent,
    boundIntent,
    savedProject,
    modelingSnapshot,
    experimentPlan,
    run
  };
}

function withCanonicalMonteCarloAnalysisRequest(planProjectJson) {
  const nextProjectJson = cloneJson(planProjectJson);
  const existingLargeSample = nextProjectJson.analysisRequests?.largeSample;
  nextProjectJson.analysisRequests = {
    ...(nextProjectJson.analysisRequests || {}),
    largeSample: {
      enabled: true,
      samples: Number(existingLargeSample?.samples ?? nextProjectJson.experiment?.samples ?? 1),
      sweep: cloneJson(existingLargeSample?.sweep || nextProjectJson.monteCarlo || {})
    }
  };
  return nextProjectJson;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
