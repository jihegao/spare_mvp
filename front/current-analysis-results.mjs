export const FORMAL_MODEL_FAMILY = "aircraft_support_v1";

export const CURRENT_ANALYSIS_TYPES = Object.freeze([
  "spare_shortfall",
  "carry_list",
  "mission_reliability",
  "downtime_factors"
]);

export function createDefaultCurrentAnalysisProfiles({ basePlanVersion = "default-base-v0" } = {}) {
  return Object.freeze({
    spare_shortfall: freezeProfile({
      analysis_type: "spare_shortfall",
      profile_version: "spare-shortfall-current-v1",
      base_plan_version: basePlanVersion
    }),
    carry_list: freezeProfile({
      analysis_type: "carry_list",
      profile_version: "carry-list-current-v1",
      base_plan_version: basePlanVersion,
      scenarioOverrides: {},
      carryListConfig: {
        missionConfidenceTarget: 0.9
      }
    }),
    mission_reliability: freezeProfile({
      analysis_type: "mission_reliability",
      profile_version: "mission-reliability-current-v1",
      base_plan_version: basePlanVersion
    }),
    downtime_factors: freezeProfile({
      analysis_type: "downtime_factors",
      profile_version: "downtime-factors-current-v1",
      base_plan_version: basePlanVersion
    })
  });
}

export function createEmptyCurrentAnalysisResults(profiles = createDefaultCurrentAnalysisProfiles()) {
  return Object.fromEntries(
    CURRENT_ANALYSIS_TYPES.map((analysisType) => [
      analysisType,
      createEmptyCurrentAnalysisResult(analysisType, currentAnalysisProfileForType(profiles, analysisType))
    ])
  );
}

export function createEmptyCurrentAnalysisResult(analysisType, profile = {}) {
  return {
    project_id: "",
    analysis_type: analysisType,
    profile_version: profile.profile_version || "default-v0",
    base_plan_version: profile.base_plan_version || "default-base-v0",
    status: "empty",
    source: "empty",
    last_success_result: null,
    last_failure: null,
    is_stale: false,
    internal_run_ref: null,
    internal_artifact_ref: null
  };
}

export function currentAnalysisProfileForType(profiles, analysisType) {
  return cloneJson(profiles?.[analysisType] || {
    analysis_type: analysisType,
    profile_version: "default-v0",
    base_plan_version: "default-base-v0"
  });
}

export function transitionCurrentAnalysisResult(results, analysisType, event = {}) {
  const current = results?.[analysisType] || createEmptyCurrentAnalysisResult(analysisType);
  const nextResults = { ...(results || {}) };
  const previousSuccess = current.last_success_result || null;
  const profile = event.profile || current;

  if (event.type === "configure") {
    nextResults[analysisType] = {
      ...createEmptyCurrentAnalysisResult(analysisType, profile),
      status: "configured",
      source: "configured"
    };
    return nextResults;
  }

  if (event.type === "start") {
    nextResults[analysisType] = {
      ...current,
      status: "running",
      source: "formal_backend",
      last_failure: null,
      is_stale: Boolean(previousSuccess && event.runId),
      internal_run_ref: event.runId
        ? { ...(current.internal_run_ref || {}), run_id: event.runId }
        : current.internal_run_ref
    };
    return nextResults;
  }

  if (event.type === "complete") {
    if (event.source !== "formal_backend") {
      nextResults[analysisType] = {
        ...current,
        status: "preview",
        source: "preview",
        last_failure: null,
        is_stale: Boolean(previousSuccess)
      };
      return nextResults;
    }
    const validation = validateFormalProjection(analysisType, event.runId, event.source, event.projection);
    if (!validation.ok) {
      nextResults[analysisType] = blockedResult(current, analysisType, event, validation);
      return nextResults;
    }
    nextResults[analysisType] = {
      ...current,
      analysis_type: analysisType,
      status: "completed",
      source: "formal_backend",
      last_success_result: {
        run_id: event.runId,
        projection_type: event.projection.projection_type,
        payload: cloneJson(event.projection)
      },
      last_failure: null,
      is_stale: false,
      internal_run_ref: {
        ...(current.internal_run_ref || {}),
        run_id: event.runId,
        run_type: "monte_carlo",
        model_family: FORMAL_MODEL_FAMILY
      }
    };
    return nextResults;
  }

  if (event.type === "stale") {
    nextResults[analysisType] = {
      ...current,
      status: "stale",
      is_stale: true,
      last_failure: failureWithRun(event.failure, event.runId)
    };
    return nextResults;
  }

  if (event.type === "fail") {
    nextResults[analysisType] = {
      ...current,
      status: "failed",
      last_success_result: previousSuccess,
      last_failure: failureWithRun(event.failure, event.runId),
      is_stale: Boolean(previousSuccess),
      internal_run_ref: event.runId
        ? { ...(current.internal_run_ref || {}), latest_run_id: event.runId }
        : current.internal_run_ref
    };
    return nextResults;
  }

  if (event.type === "block") {
    nextResults[analysisType] = blockedResult(current, analysisType, event, {
      code: event.failure?.code || "blocked",
      message: event.failure?.message || "Current analysis result is blocked"
    });
    return nextResults;
  }

  if (event.type === "preview") {
    nextResults[analysisType] = {
      ...current,
      status: "preview",
      source: "preview",
      last_failure: null,
      is_stale: Boolean(previousSuccess)
    };
    return nextResults;
  }

  return nextResults;
}

export function normalizeBackendCurrentAnalysisResult(analysisType, raw = {}) {
  const current = {
    ...createEmptyCurrentAnalysisResult(analysisType, raw),
    ...cloneJson(raw),
    analysis_type: analysisType
  };
  const success = current.last_success_result;
  if (!success?.payload) return current;
  const validation = validateFormalProjection(analysisType, success.run_id, current.source, success.payload);
  if (validation.ok) return current;
  return transitionCurrentAnalysisResult({ [analysisType]: current }, analysisType, {
    type: "block",
    runId: success.run_id,
    failure: validation
  })[analysisType];
}

export function formalProjectionFromCurrentResult(result) {
  if (!result || result.source !== "formal_backend") return null;
  if (["empty", "configured", "running", "preview"].includes(result.status)) return null;
  const success = result.last_success_result;
  if (!success?.payload) return null;
  const validation = validateFormalProjection(result.analysis_type, success.run_id, result.source, success.payload);
  if (validation.ok) return cloneJson(success.payload);
  if (
    success.projection_type === result.analysis_type
    && success.run_id
    && result.internal_run_ref?.model_family === FORMAL_MODEL_FAMILY
    && success.payload.analysisType === result.analysis_type
  ) {
    return cloneJson(success.payload);
  }
  return null;
}

function blockedResult(current, analysisType, event, failure) {
  const previousSuccess = current.last_success_result || null;
  return {
    ...current,
    analysis_type: analysisType,
    status: "blocked",
    source: previousSuccess ? current.source || "formal_backend" : "blocked",
    last_success_result: previousSuccess,
    last_failure: failureWithRun(failure, event.runId),
    is_stale: Boolean(previousSuccess),
    internal_run_ref: event.runId
      ? { ...(current.internal_run_ref || {}), latest_run_id: event.runId }
      : current.internal_run_ref
  };
}

function validateFormalProjection(analysisType, runId, source, projection) {
  if (source !== "formal_backend") {
    return { ok: false, code: "preview_not_completed", message: "Preview/demo/singleResult is not a completed current result" };
  }
  if (!projection || typeof projection !== "object") {
    return { ok: false, code: "projection_missing", message: "projection payload is required" };
  }
  if (projection.projection_type !== analysisType) {
    return {
      ok: false,
      code: "projection_type_mismatch",
      message: `projection_type mismatch: expected ${analysisType}, got ${projection.projection_type || "missing"}`
    };
  }
  if (!projection.run_id) {
    return { ok: false, code: "projection_run_missing", message: "projection run_id is required" };
  }
  if (String(projection.run_id) !== String(runId || "")) {
    return {
      ok: false,
      code: "projection_run_mismatch",
      message: `projection run_id mismatch: expected ${runId}, got ${projection.run_id}`
    };
  }
  if (!projection.model_family) {
    return { ok: false, code: "projection_model_family_missing", message: "projection model_family is required" };
  }
  if (String(projection.model_family) !== FORMAL_MODEL_FAMILY) {
    return {
      ok: false,
      code: "projection_model_family_mismatch",
      message: `projection model_family mismatch: expected ${FORMAL_MODEL_FAMILY}, got ${projection.model_family}`
    };
  }
  return { ok: true };
}

function failureWithRun(failure = {}, runId = "") {
  return {
    code: failure.code || "blocked",
    message: failure.message || "Current analysis result is blocked",
    details: failure.details || {},
    ...(runId ? { run_id: runId } : {})
  };
}

function freezeProfile(profile) {
  return Object.freeze(cloneJson(profile));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || null));
}
