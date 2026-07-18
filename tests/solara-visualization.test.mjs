import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSolaraVisualizationUrl,
  DEFAULT_SOLARA_VISUALIZATION_URL,
  localizeVisualizationEvent,
  resolveSolaraVisualizationBaseUrl,
  SOLARA_VISUALIZATION_URL_STORAGE_KEY,
  visualizationEventTypeLabel,
  visualizationJobStateLabel,
  visualizationMissionStatusLabel,
  visualizationShortageReasonLabel
} from "../front/solara-visualization.mjs";

test("Solara visualization URL defaults to the managed sidecar", () => {
  assert.equal(resolveSolaraVisualizationBaseUrl({ locationRef: {}, storage: null }), DEFAULT_SOLARA_VISUALIZATION_URL);
});

test("Solara visualization URL can be overridden from query or local storage", () => {
  const storage = new Map([[SOLARA_VISUALIZATION_URL_STORAGE_KEY, "http://127.0.0.1:9900/"]]);
  assert.equal(
    resolveSolaraVisualizationBaseUrl({
      locationRef: { search: "", hash: "" },
      storage: { getItem: (key) => storage.get(key) }
    }),
    "http://127.0.0.1:9900"
  );
  assert.equal(
    resolveSolaraVisualizationBaseUrl({
      locationRef: { search: "?solaraUrl=http%3A%2F%2F127.0.0.1%3A8800", hash: "" },
      storage: null
    }),
    "http://127.0.0.1:8800"
  );
});

test("Solara iframe URL carries visual simulation context without using legacy sidecar names", () => {
  const url = buildSolaraVisualizationUrl("http://127.0.0.1:8765/", {
    projectId: "project-ui",
    featureId: "spare-planning-visual-mesa-page",
    experimentPlanId: "plan-a",
    experimentPlanName: "方案A",
    planSteps: 77,
    planSamples: 8,
    planSeed: 88,
    reload: 2
  });

  assert.match(url, /^http:\/\/127\.0\.0\.1:8765\/\?/);
  assert.match(url, /embedded=1/);
  assert.match(url, /project_id=project-ui/);
  assert.match(url, /feature_id=spare-planning-visual-mesa-page/);
  assert.match(url, /experiment_plan_name=/);
  assert.match(url, /experiment_plan_id=plan-a/);
  assert.match(url, /plan_steps=77/);
  assert.match(url, /plan_samples=8/);
  assert.match(url, /plan_seed=88/);
  assert.match(url, /reload=2/);
  assert.doesNotMatch(url, /8521|independent-mesa|mesa-visualization-runs/);
});

test("visualization event, mission, job, and shortage vocabulary is user-facing Chinese", () => {
  assert.equal(visualizationEventTypeLabel("spare_shortage"), "备件短缺");
  assert.equal(visualizationEventTypeLabel("mission_launched"), "任务启动");
  assert.equal(visualizationJobStateLabel("blocked"), "受阻");
  assert.equal(visualizationMissionStatusLabel("cancelled"), "已取消");
  assert.equal(visualizationShortageReasonLabel("personnel_capacity"), "保障人员数量不足");
  assert.equal(visualizationShortageReasonLabel("spare:hyd-pump"), "备件库存不足");
  assert.equal(visualizationJobStateLabel("future_state"), "未知状态");
});

test("visualization shortage messages keep internal IDs in data only", () => {
  const localized = localizeVisualizationEvent({
    event_id: "event-0006",
    event_type: "spare_shortage",
    message: "job-0006 blocked by hyd-pump shortage at carrier-deck",
    details: {
      job_id: "job-0006",
      spare_type: "航电模块",
      resource_id: "基层"
    }
  });

  assert.equal(localized.event_type, "spare_shortage", "the internal event contract remains unchanged");
  assert.equal(localized.event_label, "备件短缺");
  assert.match(localized.localized_message, /^航电模块库存不足，保障作业等待备件补给/);
  assert.match(localized.localized_message, /保障节点：基层/);
  assert.doesNotMatch(localized.localized_message, /job-0006|内部标识|作业标识/);
  assert.doesNotMatch(localized.localized_message, /blocked by|shortage at/);
  assert.equal(localized.internal_id, "job-0006");
});
