import { buildExperimentPlanConfig } from "./api-client.mjs";

const SUPPORTED_RUN_TYPES = new Set(["single", "monte_carlo"]);

export function buildRunIntent({
  runType,
  projectJson,
  planProjectJson,
  mcExperimentId = "",
  experimentId = "",
  modelFamily = "aircraft_support_v1",
  monteCarloParameterSpace = "baseline",
  analysisType = "",
  analysisProfile = null
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
    ? withCanonicalMonteCarloAnalysisRequest(planProjectJson, { parameterSpace: monteCarloParameterSpace })
    : cloneJson(planProjectJson);
  const experimentPlanConfig = withAnalysisProfileConfig(
    buildExperimentPlanConfig(normalizedPlanProjectJson),
    {
      analysisType,
      analysisProfile
    }
  );
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

function withAnalysisProfileConfig(config, { analysisType = "", analysisProfile = null } = {}) {
  const normalizedAnalysisType = String(analysisType || analysisProfile?.analysisType || analysisProfile?.analysis_type || "").trim();
  if (!normalizedAnalysisType) return config;
  const profile = cloneJson(analysisProfile || {});
  const nextConfig = {
    ...config,
    analysisType: normalizedAnalysisType,
    scenarioOverrides: cloneJson(profile.scenarioOverrides || profile.scenario_overrides || {}),
    analysisProfile: {
      analysisType: normalizedAnalysisType,
      scenarioOverrides: cloneJson(profile.scenarioOverrides || profile.scenario_overrides || {})
    }
  };
  if (normalizedAnalysisType === "carry_list" && (profile.carryListConfig || profile.carry_list_config)) {
    nextConfig.carryListConfig = cloneJson(profile.carryListConfig || profile.carry_list_config || {});
    nextConfig.analysisProfile.carryListConfig = cloneJson(nextConfig.carryListConfig);
  }
  return nextConfig;
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
  const experimentPlan = await apiClient.createExperimentPlan(savedProject.project_id, {
    ...intent.experimentPlanConfig,
    modeling_snapshot_id: modelingSnapshot.snapshot_id
  });
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

function withCanonicalMonteCarloAnalysisRequest(planProjectJson, { parameterSpace = "baseline" } = {}) {
  const nextProjectJson = cloneJson(planProjectJson);
  const existingLargeSample = nextProjectJson.analysisRequests?.largeSample;
  const sweep = parameterSpace === "sweep"
    ? cloneJson(existingLargeSample?.sweep || nextProjectJson.monteCarlo || {})
    : baselineMonteCarloSweep(nextProjectJson);
  const configuredSamples = Number(existingLargeSample?.samples ?? nextProjectJson.experiment?.samples ?? 1);
  const samples = Math.max(configuredSamples, monteCarloSweepPointCount(sweep));
  nextProjectJson.experiment = {
    ...(nextProjectJson.experiment || {}),
    samples
  };
  nextProjectJson.analysisRequests = {
    ...(nextProjectJson.analysisRequests || {}),
    largeSample: {
      enabled: true,
      samples,
      sweep
    }
  };
  return nextProjectJson;
}

function baselineMonteCarloSweep(projectJson) {
  return {
    failureRates: [1.0],
    spareMultipliers: [1.0],
    supportCapacities: [baselineSupportCapacity(projectJson)]
  };
}

function baselineSupportCapacity(projectJson) {
  const supportNodes = Array.isArray(projectJson?.supportNodes) ? projectJson.supportNodes : [];
  for (const node of supportNodes) {
    const capacity = firstPositiveInteger([
      node?.equipmentCapacity,
      node?.personnelCapacity,
      node?.capacity
    ]);
    if (capacity !== null) return capacity;
  }
  return 1;
}

function firstPositiveInteger(values) {
  for (const value of values) {
    if (typeof value === "boolean") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.max(1, Math.round(number));
  }
  return null;
}

function monteCarloSweepPointCount(sweep) {
  if (!sweep || typeof sweep !== "object") return 1;
  return ["failureRates", "spareMultipliers", "supportCapacities"].reduce((product, key) => {
    const values = Array.isArray(sweep[key]) ? sweep[key].filter((value) => value !== undefined && value !== null && value !== "") : [];
    return product * Math.max(1, values.length);
  }, 1);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
