import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_RELIABILITY_RESULT_COLUMNS,
  formatReliabilityPercent,
  normalizeTaskReliabilityResultFields,
  taskReliabilityMetricPairs
} from "../front/task-reliability-contract.mjs";

test("normalizes the task reliability result into the final ordered four-field contract", () => {
  const fields = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "period_duration_days", value: 21 },
      { key: "period_completion_probability", value: 0.923 },
      { key: "wave_success_rate", value: 0.875 },
      { key: "sortie_rate", value: 0.81234 }
    ]
  });

  assert.deepEqual(fields.map(({ key, label, displayValue }) => [key, label, displayValue]), [
    ["sortie_rate", "出动架次率", "0.812"],
    ["wave_success_rate", "波次成功率", "87.5%"],
    ["period_completion_probability", "整周期任务可靠度", "92.3%"],
    ["period_duration_days", "任务周期", "21 天"]
  ]);
  assert.deepEqual(taskReliabilityMetricPairs(fields).map(([label]) => label), TASK_RELIABILITY_RESULT_COLUMNS.map(({ label }) => label));
});

test("accepts legacy labels without double-converting percentages or inventing a period", () => {
  const fields = normalizeTaskReliabilityResultFields({
    metrics: [
      ["出动架次率", "0.750"],
      ["任务剖面可靠性", "87.5%"],
      ["任务可靠度百分比", "92.3%"]
    ]
  });

  assert.deepEqual(fields.map(({ displayValue }) => displayValue), ["0.750", "87.5%", "92.3%", "--"]);
  assert.equal(formatReliabilityPercent("92.3%"), "92.3%");
  assert.equal(formatReliabilityPercent(92.3), "92.3%");
});

test("preserves validated canonical backend display values at cross-language half-step boundaries", () => {
  const fields = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "sortie_rate", value: 0.8125, display_value: "0.812" },
      { key: "wave_success_rate", value: 0.8, display_value: "80%" },
      { key: "period_completion_probability", value: 0.9225, display_value: "92.2%" },
      { key: "period_duration_days", value: 2.125, display_value: "2.12 天" }
    ]
  });

  assert.deepEqual(fields.map(({ displayValue }) => displayValue), ["0.812", "80%", "92.2%", "2.12 天"]);
  assert.deepEqual(taskReliabilityMetricPairs(fields).map(([_label, value]) => value), ["0.812", "80%", "92.2%", "2.12 天"]);
});

test("uses half-even local fallback when canonical display values are absent or invalid", () => {
  const missingCanonical = normalizeTaskReliabilityResultFields({
    sortie_rate: 0.8125,
    wave_success_rate: 0.9225,
    period_completion_probability: 0.9225,
    period_duration_days: 2.125
  });
  const invalidCanonical = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "sortie_rate", value: 0.8125, display_value: "<script>" },
      { key: "wave_success_rate", value: 0.9225, display_value: "192.2%" },
      { key: "period_completion_probability", value: 0.9225, display_value: "92.25%" },
      { key: "period_duration_days", value: 2.125, display_value: "2.125 天" }
    ]
  });

  assert.deepEqual(missingCanonical.map(({ displayValue }) => displayValue), ["0.812", "92.2%", "92.2%", "2.12 天"]);
  assert.deepEqual(invalidCanonical.map(({ displayValue }) => displayValue), ["0.812", "92.2%", "92.2%", "2.12 天"]);
});
