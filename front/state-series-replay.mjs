import { localizeVisualizationEvent } from "./solara-visualization.mjs";

const STATE_SERIES_SCHEMA_VERSION = "visualization-state-series-v0";
const STATE_STREAM_FRAME_SCHEMA_VERSION = "visualization-state-frame-v0";
const MODEL_FAMILY = "aircraft_support_v1";

export function findVisualizationStateSeriesArtifact(manifest = {}) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  return artifacts.find((artifact) => artifact?.kind === "visualization_state_series") || null;
}

export function normalizeVisualizationStateSeriesPayload(payload, { runId = "", artifactId = "" } = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("state series payload must be an object");
  }
  if (payload.schema_version !== STATE_SERIES_SCHEMA_VERSION) {
    throw new Error(`state series schema_version must be ${STATE_SERIES_SCHEMA_VERSION}`);
  }
  const payloadRunId = requiredString(payload.run_id, "run_id");
  if (runId && payloadRunId !== runId) {
    throw new Error(`state series run_id mismatch: expected ${runId}, got ${payloadRunId}`);
  }
  const traceability = normalizePayloadTraceability(payload, payloadRunId);
  const missionTemplates = objectOrDefault(payload.mission_templates);
  const failureTreeTemplates = objectOrDefault(payload.failure_tree_templates);
  const frames = normalizeFrames(payload.frames, payloadRunId)
    .map((frame) => (Object.keys(failureTreeTemplates).length || Object.keys(missionTemplates).length)
      ? { ...frame, mission_templates: missionTemplates, failure_tree_templates: failureTreeTemplates }
      : frame);
  const eventStream = buildVisualizationEventStream({ frames });
  return {
    schema_version: String(payload.schema_version || STATE_SERIES_SCHEMA_VERSION),
    run_id: payloadRunId,
    artifact_id: artifactId,
    scenario_id: requiredString(payload.scenario_id, "scenario_id"),
    scenario_version: requiredString(payload.scenario_version, "scenario_version"),
    model_family: requireModelFamily(payload.model_family),
    ...traceability,
    mission_templates: missionTemplates,
    failure_tree_templates: failureTreeTemplates,
    frames,
    frame_count: frames.length,
    event_stream: eventStream,
    event_count: eventStream.length,
    first_step: frames[0].step,
    last_step: frames[frames.length - 1].step
  };
}

export function mergeVisualizationStateStreamFrame(series, eventPayload) {
  if (!eventPayload || typeof eventPayload !== "object") {
    throw new Error("state stream frame payload must be an object");
  }
  if (eventPayload.schema_version !== STATE_STREAM_FRAME_SCHEMA_VERSION) {
    throw new Error(`state stream frame schema_version must be ${STATE_STREAM_FRAME_SCHEMA_VERSION}`);
  }
  const runId = requiredString(eventPayload.run_id, "stream.run_id");
  if (series?.run_id && series.run_id !== runId) {
    throw new Error(`state stream run_id mismatch: expected ${series.run_id}, got ${runId}`);
  }
  const artifactId = requiredString(eventPayload.artifact_id, "stream.artifact_id");
  const frameIndex = numberField(eventPayload.frame_index, "stream.frame_index");
  const frameCount = numberField(eventPayload.frame_count, "stream.frame_count");
  const nextFrames = Array.isArray(series?.frames) ? [...series.frames] : [];
  nextFrames[frameIndex] = eventPayload.frame;
  const compactFrames = nextFrames.filter(Boolean);
  const normalized = normalizeVisualizationStateSeriesPayload(
    {
      schema_version: STATE_SERIES_SCHEMA_VERSION,
      run_id: runId,
      scenario_id: requiredString(eventPayload.scenario_id, "stream.scenario_id"),
      scenario_version: requiredString(eventPayload.scenario_version, "stream.scenario_version"),
      model_family: requireModelFamily(eventPayload.model_family),
      artifact_manifest_id: requiredString(eventPayload.artifact_manifest_id, "stream.artifact_manifest_id"),
      result_summary_id: requiredString(eventPayload.result_summary_id, "stream.result_summary_id"),
      run_config_artifact_id: requiredString(eventPayload.run_config_artifact_id, "stream.run_config_artifact_id"),
      input_project_artifact_id: requiredString(eventPayload.input_project_artifact_id, "stream.input_project_artifact_id"),
      compiled_scenario_artifact_id: requiredString(eventPayload.compiled_scenario_artifact_id, "stream.compiled_scenario_artifact_id"),
      frames: compactFrames
    },
    { runId, artifactId }
  );
  return {
    ...normalized,
    stream_id: eventPayload.stream_id ? String(eventPayload.stream_id) : "",
    expected_frame_count: frameCount,
    last_stream_frame_index: frameIndex
  };
}

export function buildVisualizationEventStream(series = {}) {
  const frames = Array.isArray(series?.frames) ? series.frames : [];
  return frames.flatMap((frame, frameIndex) => {
    const events = Array.isArray(frame.events) ? frame.events : [];
    return events.map((event) => localizeVisualizationEvent({
      event_id: event.event_id,
      run_id: event.run_id,
      step: frame.step,
      frame_index: frameIndex,
      simulation_time: frame.simulation_time,
      event: event.event,
      event_type: event.event_type || event.event,
      message: event.message,
      metric_refs: Array.isArray(event.metric_refs) ? event.metric_refs : [],
      details: event.details && typeof event.details === "object" ? { ...event.details } : {},
      summary: { ...frame.event_summary }
    }));
  });
}

export function frameAt(series, index = 0) {
  const frames = Array.isArray(series?.frames) ? series.frames : [];
  if (frames.length === 0) return null;
  const boundedIndex = Math.min(frames.length - 1, Math.max(0, Number.parseInt(index, 10) || 0));
  return frames[boundedIndex];
}

export function nextReplayIndex(series, currentIndex = 0, delta = 1) {
  const frames = Array.isArray(series?.frames) ? series.frames : [];
  if (frames.length === 0) return 0;
  const nextIndex = (Number.parseInt(currentIndex, 10) || 0) + (Number.parseInt(delta, 10) || 0);
  return Math.min(frames.length - 1, Math.max(0, nextIndex));
}

function normalizeFrames(rawFrames, runId) {
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
    throw new Error("state series frames must be a non-empty array");
  }
  let previousStep = -Infinity;
  return rawFrames.map((frame, index) => {
    if (!frame || typeof frame !== "object") {
      throw new Error(`state series frame ${index} must be an object`);
    }
    const frameRunId = requiredString(frame.run_id, `frames[${index}].run_id`);
    if (frameRunId !== runId) {
      throw new Error(`frame ${index} run_id mismatch: expected ${runId}, got ${frameRunId}`);
    }
    const step = numberField(frame.step ?? frame.time_step ?? frame.simulation_time, `frames[${index}].step`);
    if (step < previousStep) {
      throw new Error(`frames[${index}].step must be monotonic`);
    }
    previousStep = step;
    const aircraftState = objectField(frame.aircraft_state, `frames[${index}].aircraft_state`);
    const missionState = objectField(frame.mission_state, `frames[${index}].mission_state`);
    const resourceState = objectField(frame.resource_state, `frames[${index}].resource_state`);
    const eventSummary = objectField(frame.event_summary, `frames[${index}].event_summary`);
    const trace = normalizeFrameTrace(objectField(frame.trace, `frames[${index}].trace`), { runId, frameIndex: index });
    const aircraft = arrayField(frame.aircraft, `frames[${index}].aircraft`);
    const missions = arrayField(frame.missions, `frames[${index}].missions`);
    const resources = arrayField(frame.resources, `frames[${index}].resources`);
    const events = normalizeEvents(arrayField(frame.events, `frames[${index}].events`), {
      runId,
      frameIndex: index,
      step
    });
    return {
      ...frame,
      run_id: frameRunId,
      step,
      simulation_time: Number(frame.simulation_time ?? step),
      trace,
      snapshot: {
        ...(frame.snapshot && typeof frame.snapshot === "object" ? frame.snapshot : {}),
        elapsed_hours: Number(frame.snapshot?.elapsed_hours ?? frame.simulation_time ?? step),
        aircraft_count: aircraft.length,
        planned_sorties: numberOrDefault(frame.snapshot?.planned_sorties, missions.length),
        completed_sorties: numberOrDefault(
          frame.snapshot?.completed_sorties,
          missions.filter((mission) => ["completed", "succeeded"].includes(String(mission.status))).length
        ),
        active_jobs: numberOrDefault(frame.snapshot?.active_jobs, arrayLength(frame.jobs)),
        spare_stock_total: numberOrDefault(frame.snapshot?.spare_stock_total, sumBy(frame.spares, "quantity")),
        available_aircraft: numberOrDefault(
          frame.snapshot?.available_aircraft,
          aircraft.filter((item) => String(item.state) === "available").length
        ),
        sortie_completion_rate: numberOrDefault(frame.snapshot?.sortie_completion_rate, completionRate(frame.snapshot, missions))
      },
      aircraft_state: aircraftState,
      mission_state: missionState,
      resource_state: resourceState,
      event_summary: eventSummary,
      aircraft,
      missions,
      resources,
      spares: arrayField(frame.spares, `frames[${index}].spares`),
      jobs: arrayField(frame.jobs, `frames[${index}].jobs`),
      events
    };
  });
}

function normalizePayloadTraceability(payload, runId) {
  return {
    artifact_manifest_id: requiredString(payload.artifact_manifest_id, "artifact_manifest_id"),
    result_summary_id: requiredString(payload.result_summary_id, "result_summary_id"),
    run_config_artifact_id: requiredString(payload.run_config_artifact_id, "run_config_artifact_id"),
    input_project_artifact_id: requiredString(payload.input_project_artifact_id, "input_project_artifact_id"),
    compiled_scenario_artifact_id: requiredString(payload.compiled_scenario_artifact_id, "compiled_scenario_artifact_id")
  };
}

function normalizeFrameTrace(trace, { runId, frameIndex }) {
  const frameRunId = requiredString(trace.run_id, `frames[${frameIndex}].trace.run_id`);
  if (frameRunId !== runId) {
    throw new Error(`state series frame trace run_id mismatch: expected ${runId}, got ${frameRunId}`);
  }
  return {
    run_id: frameRunId,
    scenario_id: requiredString(trace.scenario_id, `frames[${frameIndex}].trace.scenario_id`),
    scenario_version: requiredString(trace.scenario_version, `frames[${frameIndex}].trace.scenario_version`),
    result_summary_id: requiredString(trace.result_summary_id, `frames[${frameIndex}].trace.result_summary_id`),
    artifact_manifest_id: requiredString(trace.artifact_manifest_id, `frames[${frameIndex}].trace.artifact_manifest_id`),
    run_config_artifact_id: requiredString(trace.run_config_artifact_id, `frames[${frameIndex}].trace.run_config_artifact_id`),
    input_project_artifact_id: requiredString(trace.input_project_artifact_id, `frames[${frameIndex}].trace.input_project_artifact_id`),
    compiled_scenario_artifact_id: requiredString(trace.compiled_scenario_artifact_id, `frames[${frameIndex}].trace.compiled_scenario_artifact_id`)
  };
}

function normalizeEvents(rawEvents, { runId, frameIndex, step }) {
  return rawEvents.map((event, eventIndex) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`state series frames[${frameIndex}].events[${eventIndex}] must be an object`);
    }
    const eventId = requiredString(event.event_id, `frames[${frameIndex}].events[${eventIndex}].event_id`);
    const eventRunId = requiredString(event.run_id, `frames[${frameIndex}].events[${eventIndex}].run_id`);
    if (eventRunId !== runId) {
      throw new Error(`state series event run_id mismatch: expected ${runId}, got ${eventRunId}`);
    }
    const eventStep = numberField(event.step, `frames[${frameIndex}].events[${eventIndex}].step`);
    if (eventStep !== step) {
      throw new Error(`state series event step mismatch: expected ${step}, got ${eventStep}`);
    }
    return {
      ...event,
      event_id: eventId,
      run_id: eventRunId,
      step: eventStep,
      time: numberField(event.time ?? step, `frames[${frameIndex}].events[${eventIndex}].time`),
      event: requiredString(event.event, `frames[${frameIndex}].events[${eventIndex}].event`),
      event_type: requiredString(event.event_type || event.event, `frames[${frameIndex}].events[${eventIndex}].event_type`),
      message: requiredString(event.message, `frames[${frameIndex}].events[${eventIndex}].message`),
      metric_refs: Array.isArray(event.metric_refs) ? event.metric_refs.map((item) => String(item)) : []
    };
  });
}

function requiredString(value, field) {
  if (value === undefined || value === null || String(value) === "") {
    throw new Error(`state series ${field} is required`);
  }
  return String(value);
}

function requireModelFamily(value) {
  const modelFamily = requiredString(value, "model_family");
  if (modelFamily !== MODEL_FAMILY) {
    throw new Error(`state series model_family must be ${MODEL_FAMILY}`);
  }
  return modelFamily;
}

function arrayField(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`state series ${field} must be an array`);
  }
  return value;
}

function objectField(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`state series ${field} must be an object`);
  }
  return value;
}

function objectOrDefault(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function numberField(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`state series ${field} must be a finite number`);
  }
  return number;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback || 0);
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function sumBy(value, key) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, item) => total + numberOrDefault(item?.[key], 0), 0);
}

function completionRate(snapshot, missions) {
  const planned = numberOrDefault(snapshot?.planned_sorties, missions.length);
  if (planned <= 0) return 0;
  const completed = numberOrDefault(
    snapshot?.completed_sorties,
    missions.filter((mission) => ["completed", "succeeded"].includes(String(mission.status))).length
  );
  return completed / planned;
}
