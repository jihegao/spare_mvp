import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisualizationEventStream,
  findVisualizationStateSeriesArtifact,
  frameAt,
  mergeVisualizationStateStreamFrame,
  normalizeVisualizationStateSeriesPayload,
  nextReplayIndex
} from "../front/state-series-replay.mjs";

const runId = "run-m9-state-series";
const artifact = {
  artifact_id: `visualization_state_series-${runId}`,
  kind: "visualization_state_series",
  schema_version: "visualization-state-series-v0"
};

function validPayload(overrides = {}) {
  return {
    schema_version: "visualization-state-series-v0",
    run_id: runId,
    scenario_id: "scenario-m9",
    scenario_version: "scenario-v0",
    model_family: "aircraft_support_v1",
    artifact_manifest_id: `artifact-manifest-${runId}`,
    result_summary_id: `result-${runId}`,
    run_config_artifact_id: `run_config-${runId}`,
    input_project_artifact_id: `input_project-${runId}`,
    compiled_scenario_artifact_id: `compiled_scenario-${runId}`,
    frames: [
      {
        run_id: runId,
        step: 0,
        simulation_time: 0,
        trace: {
          run_id: runId,
          scenario_id: "scenario-m9",
          scenario_version: "scenario-v0",
          result_summary_id: `result-${runId}`,
          artifact_manifest_id: `artifact-manifest-${runId}`,
          run_config_artifact_id: `run_config-${runId}`,
          input_project_artifact_id: `input_project-${runId}`,
          compiled_scenario_artifact_id: `compiled_scenario-${runId}`
        },
        aircraft_state: { ready_rate: 1 },
        mission_state: { mission_success_rate: 0 },
        resource_state: { spare_fill_rate: 1 },
        event_summary: { shortage_events: 0 },
        aircraft: [{ tail_number: "AC-01", type: "Smoke", state: "available", x: 0, y: 0 }],
        missions: [{ mission_id: 1, status: "planned", required_aircraft: 1, assigned_tail_numbers: [] }],
        resources: [{ name: "mechanic_team", display_name: "机务组", capacity: 2, in_use: 0 }],
        spares: [],
        jobs: [],
        events: [{ event_id: `${runId}-step-0-run_started`, run_id: runId, step: 0, time: 0, event: "run_started", event_type: "run_started", message: "run started", metric_refs: ["ready_rate"] }]
      },
      {
        run_id: runId,
        step: 1,
        simulation_time: 1,
        trace: {
          run_id: runId,
          scenario_id: "scenario-m9",
          scenario_version: "scenario-v0",
          result_summary_id: `result-${runId}`,
          artifact_manifest_id: `artifact-manifest-${runId}`,
          run_config_artifact_id: `run_config-${runId}`,
          input_project_artifact_id: `input_project-${runId}`,
          compiled_scenario_artifact_id: `compiled_scenario-${runId}`
        },
        aircraft_state: { ready_rate: 0 },
        mission_state: { mission_success_rate: 1 },
        resource_state: { spare_fill_rate: 1 },
        event_summary: { shortage_events: 0 },
        aircraft: [{ tail_number: "AC-01", type: "Smoke", state: "flying", x: 1, y: 0 }],
        missions: [{ mission_id: 1, status: "launched", required_aircraft: 1, assigned_tail_numbers: ["AC-01"] }],
        resources: [{ name: "mechanic_team", display_name: "机务组", capacity: 2, in_use: 1 }],
        spares: [],
        jobs: [],
        events: [{ event_id: `${runId}-step-1-mission_launch`, run_id: runId, step: 1, time: 1, event: "mission_launch", event_type: "mission_launch", message: "AC-01 launched", metric_refs: ["mission_success_rate"] }]
      }
    ],
    ...overrides
  };
}

test("findVisualizationStateSeriesArtifact prefers the M9 visualization state-series artifact", () => {
  const manifest = {
    artifacts: [
      { artifact_id: "metrics-run", kind: "metrics" },
      artifact,
      { artifact_id: "state_series-legacy", kind: "state_series" }
    ]
  };

  assert.deepEqual(findVisualizationStateSeriesArtifact(manifest), artifact);
  assert.equal(findVisualizationStateSeriesArtifact({ artifacts: [{ artifact_id: "state_series-legacy", kind: "state_series" }] }), null);
});

test("normalizeVisualizationStateSeriesPayload requires run identity and frame state fields", () => {
  const normalized = normalizeVisualizationStateSeriesPayload(validPayload(), { runId, artifactId: artifact.artifact_id });

  assert.equal(normalized.run_id, runId);
  assert.equal(normalized.artifact_id, artifact.artifact_id);
  assert.equal(normalized.frames.length, 2);
  assert.equal(normalized.frames[1].aircraft[0].state, "flying");
  assert.equal(normalized.frames[1].missions[0].status, "launched");
  assert.equal(normalized.frames[1].resources[0].in_use, 1);
  assert.equal(normalized.frame_count, 2);
  assert.equal(normalized.event_count, 2);
  assert.equal(normalized.event_stream.length, 2);
  assert.deepEqual(normalized.event_stream[1], {
    event_id: `${runId}-step-1-mission_launch`,
    run_id: runId,
    step: 1,
    frame_index: 1,
    simulation_time: 1,
    event: "mission_launch",
    event_type: "mission_launch",
    message: "AC-01 launched",
    metric_refs: ["mission_success_rate"],
    details: {},
    event_label: "任务启动",
    localized_message: "任务已启动。 飞机编号：AC-01",
    internal_id: `${runId}-step-1-mission_launch`,
    summary: { shortage_events: 0 }
  });
});

test("normalizeVisualizationStateSeriesPayload fails closed for wrong run or missing frame fields", () => {
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(validPayload({ schema_version: "state-series-v0" }), { runId, artifactId: artifact.artifact_id }),
    /schema_version/
  );

  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(validPayload({ run_id: "other-run" }), { runId, artifactId: artifact.artifact_id }),
    /run_id mismatch/
  );

  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(validPayload({ model_family: "aviation_support" }), { runId, artifactId: artifact.artifact_id }),
    /model_family must be aircraft_support_v1/
  );

  const missingResources = validPayload();
  delete missingResources.frames[0].resources;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingResources, { runId, artifactId: artifact.artifact_id }),
    /resources/
  );

  const missingSummary = validPayload();
  delete missingSummary.frames[0].event_summary;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingSummary, { runId, artifactId: artifact.artifact_id }),
    /event_summary/
  );

  const missingJobs = validPayload();
  delete missingJobs.frames[0].jobs;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingJobs, { runId, artifactId: artifact.artifact_id }),
    /jobs/
  );

  const missingTrace = validPayload();
  delete missingTrace.artifact_manifest_id;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingTrace, { runId, artifactId: artifact.artifact_id }),
    /artifact_manifest_id/
  );

  const missingFrameTrace = validPayload();
  delete missingFrameTrace.frames[0].trace;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingFrameTrace, { runId, artifactId: artifact.artifact_id }),
    /trace/
  );

  const missingEventId = validPayload();
  delete missingEventId.frames[0].events[0].event_id;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(missingEventId, { runId, artifactId: artifact.artifact_id }),
    /event_id/
  );

  const wrongEventRun = validPayload();
  wrongEventRun.frames[0].events[0].run_id = "other-run";
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(wrongEventRun, { runId, artifactId: artifact.artifact_id }),
    /event run_id mismatch/
  );

  const wrongEventStep = validPayload();
  wrongEventStep.frames[0].events[0].step = 99;
  assert.throws(
    () => normalizeVisualizationStateSeriesPayload(wrongEventStep, { runId, artifactId: artifact.artifact_id }),
    /event step mismatch/
  );
});

test("mergeVisualizationStateStreamFrame builds partial series through the same frame parser", () => {
  const payload = validPayload();
  const first = mergeVisualizationStateStreamFrame(null, {
    schema_version: "visualization-state-frame-v0",
    stream_id: `state-stream-${runId}`,
    run_id: runId,
    artifact_id: artifact.artifact_id,
    artifact_manifest_id: payload.artifact_manifest_id,
    result_summary_id: payload.result_summary_id,
    run_config_artifact_id: payload.run_config_artifact_id,
    input_project_artifact_id: payload.input_project_artifact_id,
    compiled_scenario_artifact_id: payload.compiled_scenario_artifact_id,
    scenario_id: payload.scenario_id,
    scenario_version: payload.scenario_version,
    model_family: payload.model_family,
    frame_index: 0,
    frame_count: 2,
    frame: payload.frames[0]
  });

  assert.equal(first.schema_version, "visualization-state-series-v0");
  assert.equal(first.run_id, runId);
  assert.equal(first.artifact_id, artifact.artifact_id);
  assert.equal(first.frame_count, 1);
  assert.equal(first.expected_frame_count, 2);
  assert.equal(first.event_count, 1);
  assert.equal(first.frames[0].step, 0);

  const second = mergeVisualizationStateStreamFrame(first, {
    schema_version: "visualization-state-frame-v0",
    stream_id: `state-stream-${runId}`,
    run_id: runId,
    artifact_id: artifact.artifact_id,
    artifact_manifest_id: payload.artifact_manifest_id,
    result_summary_id: payload.result_summary_id,
    run_config_artifact_id: payload.run_config_artifact_id,
    input_project_artifact_id: payload.input_project_artifact_id,
    compiled_scenario_artifact_id: payload.compiled_scenario_artifact_id,
    scenario_id: payload.scenario_id,
    scenario_version: payload.scenario_version,
    model_family: payload.model_family,
    frame_index: 1,
    frame_count: 2,
    frame: payload.frames[1]
  });

  assert.equal(second.frame_count, 2);
  assert.equal(second.expected_frame_count, 2);
  assert.equal(second.frames[1].aircraft[0].state, "flying");
  assert.equal(second.event_stream[1].event_id, `${runId}-step-1-mission_launch`);

  assert.throws(
    () => mergeVisualizationStateStreamFrame(second, {
      schema_version: "visualization-state-frame-v0",
      run_id: "other-run",
      artifact_id: artifact.artifact_id,
      frame_index: 2,
      frame_count: 3,
      frame: payload.frames[1]
    }),
    /run_id mismatch/
  );
});

test("buildVisualizationEventStream returns flattened events with frame indexes", () => {
  const normalized = normalizeVisualizationStateSeriesPayload(validPayload(), { runId, artifactId: artifact.artifact_id });

  assert.deepEqual(buildVisualizationEventStream(normalized).map((event) => [event.event_id, event.frame_index, event.step]), [
    [`${runId}-step-0-run_started`, 0, 0],
    [`${runId}-step-1-mission_launch`, 1, 1]
  ]);
  assert.deepEqual(buildVisualizationEventStream(normalized).map((event) => [event.event_label, event.localized_message]), [
    ["推演开始", "推演已开始。"],
    ["任务启动", "任务已启动。 飞机编号：AC-01"]
  ]);
});

test("frameAt and nextReplayIndex clamp playback to the loaded frame range", () => {
  const normalized = normalizeVisualizationStateSeriesPayload(validPayload(), { runId, artifactId: artifact.artifact_id });

  assert.equal(frameAt(normalized, -10).step, 0);
  assert.equal(frameAt(normalized, 10).step, 1);
  assert.equal(nextReplayIndex(normalized, 0, 1), 1);
  assert.equal(nextReplayIndex(normalized, 1, 1), 1);
  assert.equal(nextReplayIndex(normalized, 0, -1), 0);
});
