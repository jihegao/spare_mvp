import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_ANALYSIS_TYPES,
  createDefaultCurrentAnalysisProfiles,
  createEmptyCurrentAnalysisResults,
  formalProjectionFromCurrentResult,
  transitionCurrentAnalysisResult
} from "../front/current-analysis-results.mjs";

const payload = (analysisType, runId = "run-current-1") => ({
  projection_type: analysisType,
  run_id: runId,
  model_family: "aircraft_support_v1",
  data: []
});

test("current analysis results move through empty configured running completed stale failed blocked and preview states", () => {
  const profiles = createDefaultCurrentAnalysisProfiles({ basePlanVersion: "base-v1" });
  let results = createEmptyCurrentAnalysisResults(profiles);

  assert.deepEqual(Object.keys(results).sort(), [...CURRENT_ANALYSIS_TYPES].sort());
  assert.equal(results.spare_shortfall.status, "empty");
  assert.equal(results.spare_shortfall.profile_version, profiles.spare_shortfall.profile_version);

  results = transitionCurrentAnalysisResult(results, "spare_shortfall", {
    type: "configure",
    profile: { ...profiles.spare_shortfall, profile_version: "spare-v2" }
  });
  assert.equal(results.spare_shortfall.status, "configured");
  assert.equal(results.spare_shortfall.profile_version, "spare-v2");

  results = transitionCurrentAnalysisResult(results, "spare_shortfall", {
    type: "start",
    runId: "run-current-1"
  });
  assert.equal(results.spare_shortfall.status, "running");
  assert.equal(results.spare_shortfall.internal_run_ref.run_id, "run-current-1");

  results = transitionCurrentAnalysisResult(results, "spare_shortfall", {
    type: "complete",
    runId: "run-current-1",
    source: "formal_backend",
    projection: payload("spare_shortfall")
  });
  assert.equal(results.spare_shortfall.status, "completed");
  assert.equal(results.spare_shortfall.source, "formal_backend");
  assert.equal(formalProjectionFromCurrentResult(results.spare_shortfall).projection_type, "spare_shortfall");

  results = transitionCurrentAnalysisResult(results, "spare_shortfall", {
    type: "stale",
    failure: { code: "inputs_changed", message: "profile changed" }
  });
  assert.equal(results.spare_shortfall.status, "stale");
  assert.equal(results.spare_shortfall.is_stale, true);
  assert.equal(results.spare_shortfall.last_success_result.run_id, "run-current-1");

  results = transitionCurrentAnalysisResult(results, "spare_shortfall", {
    type: "fail",
    runId: "run-current-2",
    failure: { code: "executor_failed", message: "later run failed" }
  });
  assert.equal(results.spare_shortfall.status, "failed");
  assert.equal(results.spare_shortfall.last_success_result.run_id, "run-current-1");
  assert.equal(results.spare_shortfall.last_failure.run_id, "run-current-2");

  results = transitionCurrentAnalysisResult(results, "carry_list", {
    type: "block",
    failure: { code: "missing_projection", message: "no projection" }
  });
  assert.equal(results.carry_list.status, "blocked");
  assert.equal(results.carry_list.last_success_result, null);

  results = transitionCurrentAnalysisResult(results, "mission_reliability", {
    type: "preview",
    projection: payload("mission_reliability", "run-preview")
  });
  assert.equal(results.mission_reliability.status, "preview");
  assert.equal(results.mission_reliability.source, "preview");
  assert.equal(formalProjectionFromCurrentResult(results.mission_reliability), null);
});

test("current analysis result completion fails closed unless projection traceability exactly matches", () => {
  let results = createEmptyCurrentAnalysisResults(createDefaultCurrentAnalysisProfiles());
  const complete = (projection, source = "formal_backend") => transitionCurrentAnalysisResult(results, "carry_list", {
    type: "complete",
    runId: "run-carry",
    source,
    projection
  }).carry_list;

  assert.equal(complete({ ...payload("carry_list", "run-carry"), projection_type: "spare_shortfall" }).status, "blocked");
  assert.equal(complete({ ...payload("carry_list", "run-other") }).status, "blocked");
  assert.equal(complete({ ...payload("carry_list", "run-carry"), model_family: "smoke" }).status, "blocked");
  assert.equal(complete({ projection_type: "carry_list", model_family: "aircraft_support_v1" }).status, "blocked");
  assert.equal(complete({ projection_type: "carry_list", run_id: "run-carry" }).status, "blocked");

  const singleResult = complete(payload("carry_list", "run-carry"), "singleResult");
  assert.equal(singleResult.status, "preview");
  assert.equal(formalProjectionFromCurrentResult(singleResult), null);

  const completed = complete(payload("carry_list", "run-carry"));
  assert.equal(completed.status, "completed");
  assert.equal(formalProjectionFromCurrentResult(completed).run_id, "run-carry");
});
