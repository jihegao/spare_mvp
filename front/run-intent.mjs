import { buildExperimentPlanConfig } from "./api-client.mjs";

const SUPPORTED_RUN_TYPES = new Set(["single", "monte_carlo"]);
const DEFAULT_FAILURE_RATE_SWEEP = [0.06];
const DEFAULT_SPARE_MULTIPLIER_SWEEP = [1.0];

export function buildRunIntent({
  runType,
  projectJson,
  planProjectJson,
  mcExperimentId = "",
  experimentId = "",
  analysisType = "",
  modelFamily = "aircraft_support_v1",
  monteCarloParameterSpace = "baseline",
  currentAnalysisProfile = null,
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

  const profile = currentAnalysisProfile || analysisProfile || null;
  const normalizedPlanProjectJson = runType === "monte_carlo"
    ? withCanonicalMonteCarloAnalysisRequest(planProjectJson, { parameterSpace: monteCarloParameterSpace, analysisType, currentAnalysisProfile: profile })
    : cloneJson(planProjectJson);
  const experimentPlanConfig = withAnalysisProfileConfig(
    buildExperimentPlanConfig(normalizedPlanProjectJson),
    {
      analysisType,
      currentAnalysisProfile: profile
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

function withAnalysisProfileConfig(config, { analysisType = "", currentAnalysisProfile = null } = {}) {
  const profile = cloneJson(currentAnalysisProfile || {});
  const normalizedAnalysisType = String(
    analysisType || profile.analysisType || profile.analysis_type || ""
  ).trim();
  if (!normalizedAnalysisType) return config;
  const profileAnalysisType = String(profile.analysisType || profile.analysis_type || normalizedAnalysisType).trim();
  const profileMatchesAnalysisType = !profileAnalysisType || profileAnalysisType === normalizedAnalysisType;
  const scenarioOverrides = profileMatchesAnalysisType
    ? cloneJson(profile.scenarioOverrides || profile.scenario_overrides || {})
    : {};
  const nextConfig = {
    ...config,
    analysisType: normalizedAnalysisType,
    scenarioOverrides,
    analysisProfile: {
      ...(profileMatchesAnalysisType ? profile : {}),
      analysisType: normalizedAnalysisType,
      analysis_type: normalizedAnalysisType,
      scenarioOverrides
    }
  };
  const carryListConfig = profileMatchesAnalysisType ? (profile.carryListConfig || profile.carry_list_config) : null;
  if (normalizedAnalysisType === "carry_list" && carryListConfig && typeof carryListConfig === "object") {
    nextConfig.carryListConfig = cloneJson(carryListConfig);
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

function withCanonicalMonteCarloAnalysisRequest(planProjectJson, { parameterSpace = "sweep", analysisType = "", currentAnalysisProfile = null } = {}) {
  const nextProjectJson = cloneJson(planProjectJson);
  const existingLargeSample = nextProjectJson.analysisRequests?.largeSample;
  const sweep = parameterSpace === "sweep"
    ? configuredMonteCarloSweep(nextProjectJson, existingLargeSample)
    : baselineMonteCarloSweep(nextProjectJson, existingLargeSample);
  const configuredSamples = Number(existingLargeSample?.samples ?? nextProjectJson.experiment?.samples ?? 1);
  const samples = Math.max(configuredSamples, monteCarloSweepPointCount(sweep));
  nextProjectJson.experiment = {
    ...(nextProjectJson.experiment || {}),
    samples
  };
  nextProjectJson.monteCarlo = cloneJson(sweep);
  nextProjectJson.analysisRequests = {
    ...(nextProjectJson.analysisRequests || {}),
    largeSample: {
      enabled: true,
      samples,
      sweep
    }
  };
  applyCurrentAnalysisProfile(nextProjectJson, analysisType, currentAnalysisProfile);
  return nextProjectJson;
}

function applyCurrentAnalysisProfile(projectJson, analysisType, currentAnalysisProfile) {
  if (!analysisType || !currentAnalysisProfile || typeof currentAnalysisProfile !== "object") return;
  projectJson.analysisRequests = {
    ...(projectJson.analysisRequests || {}),
    currentAnalysisProfiles: {
      ...(projectJson.analysisRequests?.currentAnalysisProfiles || {}),
      [analysisType]: {
        analysis_type: analysisType,
        profile_version: currentAnalysisProfile.profile_version || "default-v0",
        base_plan_version: currentAnalysisProfile.base_plan_version || "default-base-v0"
      }
    }
  };
  if (analysisType !== "carry_list") return;

  const scenarioOverrides = carryListScenarioOverrides(currentAnalysisProfile);
  const carryListConfig = carryListConfigForProfile(currentAnalysisProfile);
  projectJson.analysisRequests.carryList = {
    ...(projectJson.analysisRequests.carryList || {}),
    enabled: true,
    profile_version: currentAnalysisProfile.profile_version || "default-v0",
    ...(Object.keys(scenarioOverrides).length ? { scenarioOverrides } : {}),
    ...(Object.keys(carryListConfig).length ? { carryListConfig } : {})
  };
}

function carryListScenarioOverrides(profile) {
  const source = profile.scenarioOverrides && typeof profile.scenarioOverrides === "object" ? profile.scenarioOverrides : {};
  const overrides = {};
  if (source.sparesBySupportPoint && typeof source.sparesBySupportPoint === "object") {
    overrides.sparesBySupportPoint = cloneJson(source.sparesBySupportPoint);
  }
  const missionDurationMinutes = finiteNumber(source.missionDurationMinutes);
  if (missionDurationMinutes !== null) {
    overrides.missionDurationMinutes = missionDurationMinutes;
  }
  return overrides;
}

function carryListConfigForProfile(profile) {
  const source = profile.carryListConfig && typeof profile.carryListConfig === "object" ? profile.carryListConfig : {};
  const missionConfidenceTarget = finiteNumber(source.missionConfidenceTarget);
  return missionConfidenceTarget !== null ? { missionConfidenceTarget } : {};
}

function finiteNumber(value) {
  if (typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configuredMonteCarloSweep(projectJson, existingLargeSample = {}) {
  const sources = [
    existingLargeSample?.sweep,
    projectJson?.monteCarlo
  ].filter((source) => source && typeof source === "object");
  return {
    failureRates: firstPositiveNumberList(sources, "failureRates") || DEFAULT_FAILURE_RATE_SWEEP,
    spareMultipliers: firstPositiveNumberList(sources, "spareMultipliers") || DEFAULT_SPARE_MULTIPLIER_SWEEP,
    supportCapacities: firstPositiveIntegerList(sources, "supportCapacities") || defaultSupportCapacitySweep(projectJson)
  };
}

function baselineMonteCarloSweep(projectJson, existingLargeSample = {}) {
  const sources = [
    existingLargeSample?.sweep,
    projectJson?.monteCarlo
  ].filter((source) => source && typeof source === "object");
  const failureRates = firstPositiveNumberList(sources, "failureRates");
  const spareMultipliers = firstPositiveNumberList(sources, "spareMultipliers");
  const supportCapacities = firstPositiveIntegerList(sources, "supportCapacities");
  return {
    failureRates: [failureRates?.[0] ?? 0.06],
    spareMultipliers: [spareMultipliers?.[0] ?? 1.0],
    supportCapacities: [supportCapacities?.[0] ?? baselineSupportCapacity(projectJson)]
  };
}

function defaultSupportCapacitySweep(projectJson) {
  const baseline = baselineSupportCapacity(projectJson);
  return uniquePositiveIntegers([baseline - 1, baseline, baseline + 1, baseline + 2]).slice(0, 3);
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

function firstPositiveNumberList(sources, key) {
  for (const source of sources) {
    const values = positiveNumberList(source?.[key]);
    if (values.length) return values;
  }
  return null;
}

function firstPositiveIntegerList(sources, key) {
  for (const source of sources) {
    const values = uniquePositiveIntegers(source?.[key]);
    if (values.length) return values;
  }
  return null;
}

function positiveNumberList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function uniquePositiveIntegers(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "boolean") continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    const integer = Math.max(1, Math.round(number));
    if (seen.has(integer)) continue;
    seen.add(integer);
    normalized.push(integer);
  }
  return normalized;
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
