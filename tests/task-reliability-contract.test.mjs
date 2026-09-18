import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_RELIABILITY_RESULT_COLUMNS,
  aggregateTaskReliabilityWaves,
  normalizeTaskReliabilityWaveRows,
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

test("uses exact half-even fallback when canonical display values are absent, malformed, or adjacent rounded values", () => {
  const missingCanonical = normalizeTaskReliabilityResultFields({
    sortie_rate: 0.8125,
    wave_success_rate: 0.9225,
    period_completion_probability: 0.9225,
    period_duration_days: 2.125
  });
  const invalidCanonical = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "sortie_rate", value: 0.8125, display_value: "0.813" },
      { key: "wave_success_rate", value: 0.9225, display_value: "92.3%" },
      { key: "period_completion_probability", value: 0.9225, display_value: "92.3%" },
      { key: "period_duration_days", value: 2.125, display_value: "2.13 天" }
    ]
  });
  const malformedCanonical = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "sortie_rate", value: 0.8125, display_value: "<script>" },
      { key: "wave_success_rate", value: 0.9225, display_value: "192.2%" },
      { key: "period_completion_probability", value: 0.9225, display_value: "92.25%" },
      { key: "period_duration_days", value: 2.125, display_value: "2.125 天" }
    ]
  });

  assert.deepEqual(missingCanonical.map(({ displayValue }) => displayValue), ["0.812", "92.2%", "92.2%", "2.12 天"]);
  assert.deepEqual(invalidCanonical.map(({ displayValue }) => displayValue), ["0.812", "92.2%", "92.2%", "2.12 天"]);
  assert.deepEqual(malformedCanonical.map(({ displayValue }) => displayValue), ["0.812", "92.2%", "92.2%", "2.12 天"]);
});

test("formats decimal half-even values consistently at binary, negative, zero, and upper boundaries", () => {
  const fields = normalizeTaskReliabilityResultFields({
    result_fields: [
      { key: "sortie_rate", value: -0.8125, display_value: "-0.812" },
      { key: "wave_success_rate", value: 0, display_value: "0%" },
      { key: "period_completion_probability", value: 1, display_value: "100%" },
      { key: "period_duration_days", value: 2.675, display_value: "2.68 天" }
    ]
  });

  assert.deepEqual(fields.map(({ value, displayValue, unit }) => [value, displayValue, unit]), [
    [-0.8125, "-0.812", ""],
    [0, "0%", "%"],
    [1, "100%", "%"],
    [2.675, "2.68 天", "天"]
  ]);
});


test("wave detail retains 104 observations while chart uses count-weighted business keys", () => {
  const source = Array.from({ length: 4 }, (_, sampleIndex) =>
    Array.from({ length: 26 }, (_, index) => ({
      sample_index: sampleIndex, day_index: Math.floor(index / 2) + 1, wave_index: index % 2 + 1,
      planned_waves: sampleIndex === 0 ? 1 : 3, successful_waves: sampleIndex === 0 ? 1 : 0,
      planned_sorties: sampleIndex === 0 ? 2 : 4, launched_sorties: 2
    }))
  ).flat().reverse();
  const detail = normalizeTaskReliabilityWaveRows(source);
  const chart = aggregateTaskReliabilityWaves(detail);
  assert.equal(detail.length, 104);
  assert.equal(chart.length, 26);
  assert.equal(chart[0].waveLabel, "第1天第1波次");
  assert.equal(chart[0].plannedWaves, 10);
  assert.equal(chart[0].successfulWaves, 1);
  assert.equal(chart[0].probability, 0.1);
  assert.equal(chart[0].sortieRate, 8 / 14);
  assert.equal(chart[0].sampleCount, 4);
  assert.equal(detail.filter((row) => row.sampleIndex === 0).length, 26);
  // Missing a business wave never shifts another sample's following observation.
  const missing = source.filter((row) => row.sample_index !== 0 || row.day_index !== 1 || row.wave_index !== 1);
  const incomplete = aggregateTaskReliabilityWaves(missing);
  assert.equal(incomplete[0].sampleCount, 3);
  assert.equal(incomplete[0].probability, 0);
  assert.equal(incomplete[1].probability, 0.1);
  assert.equal(source.length, 104);
});


test("missing sample counts do not silently become unweighted chart averages", () => {
  const rows = [
    { sample_index: 0, day_index: 1, wave_index: 1, mean_mission_success_rate: 1 },
    { sample_index: 1, day_index: 1, wave_index: 1, mean_mission_success_rate: 0 }
  ];
  assert.equal(normalizeTaskReliabilityWaveRows(rows).length, 2);
  assert.deepEqual(aggregateTaskReliabilityWaves(rows), []);
  assert.equal(aggregateTaskReliabilityWaves([{ waveKey: "d1-w1", sampleCount: 2, meanMissionSuccessRate: 0.5 }])[0].probability, 0.5);
});
