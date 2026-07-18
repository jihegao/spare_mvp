import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMonteCarloMetricMoments,
  formatMonteCarloMoment,
  normalizeMonteCarloMetricMoments
} from "../front/monte-carlo-moments.mjs";

test("moments exclude strings, nonfinite values, booleans, metadata, and use n-1", () => {
  const moments = buildMonteCarloMetricMoments([
    {
      sample_id: 999,
      metrics: {
        mission_success_rate: 0.2,
        spare_fill_rate: Number.NaN,
        spare_utilization: "0.5",
        ready_rate: true,
        sortie_rate: 1,
        mean_transport_delay: 2,
        repair_backlog: 1,
        debug_counter: 100
      },
      logs: [{ duration: 200 }]
    },
    {
      metrics: {
        mission_success_rate: 0.8,
        spare_fill_rate: 0.6,
        spare_utilization: Number.POSITIVE_INFINITY,
        ready_rate: 0.4,
        mean_transport_delay: "3",
        repair_backlog: 3
      }
    },
    { metrics: { mission_success_rate: "bad" } }
  ], { totalSampleCount: 5, successfulSampleCount: 3, failedSampleCount: 2 });
  const byId = Object.fromEntries(moments.metrics.map((metric) => [metric.metricId, metric]));

  assert.equal(moments.varianceDenominator, "n-1");
  assert.deepEqual(
    [moments.totalSampleCount, moments.successfulSampleCount, moments.failedSampleCount],
    [5, 3, 2]
  );
  assert.equal(byId.mission_success_rate.mean, 0.5);
  assert.ok(Math.abs(byId.mission_success_rate.sampleVariance - 0.18) < 1e-12);
  assert.equal(byId.mission_success_rate.validSampleCount, 2);
  assert.equal(byId.spare_fill_rate.validSampleCount, 1);
  assert.equal(byId.spare_fill_rate.sampleVariance, null);
  assert.equal(byId.spare_utilization.validSampleCount, 0);
  assert.equal(byId.spare_utilization.mean, null);
  assert.equal(byId.repair_backlog.mean, 2);
  assert.equal(byId.repair_backlog.sampleVariance, 2);
  assert.equal(moments.metrics.some((metric) => metric.metricId === "debug_counter"), false);
});

test("n=0 and n=1 remain explicitly unavailable and payload strings are not normalized as numbers", () => {
  const empty = buildMonteCarloMetricMoments([], { totalSampleCount: 2, failedSampleCount: 2 });
  assert.ok(empty.metrics.every((metric) => metric.mean === null && metric.sampleVariance === null));

  const one = buildMonteCarloMetricMoments([{ final: { mission_success_rate: 0.75 } }]);
  assert.equal(one.metrics[0].mean, 0.75);
  assert.equal(one.metrics[0].sampleVariance, null);
  assert.equal(formatMonteCarloMoment(one.metrics[0].sampleVariance, "ratio", { variance: true }), "不可计算");
  assert.equal(formatMonteCarloMoment(empty.metrics[0].mean, "ratio"), "无有效样本");

  const normalized = normalizeMonteCarloMetricMoments({
    total_sample_count: 2,
    successful_sample_count: 2,
    failed_sample_count: 0,
    metrics: [{
      metric_id: "mission_success_rate",
      mean: "0.5",
      sample_variance: "0.18",
      valid_sample_count: 2
    }]
  });
  assert.equal(normalized.metrics[0].mean, null);
  assert.equal(normalized.metrics[0].sampleVariance, null);
});

test("finite extremes keep finite means and mark unrepresentable variance unavailable", () => {
  const sameSign = buildMonteCarloMetricMoments([
    { metrics: { mission_success_rate: 1e308 } },
    { metrics: { mission_success_rate: 1e308 } }
  ]).metrics[0];
  assert.equal(sameSign.mean, 1e308);
  assert.equal(sameSign.sampleVariance, 0);
  assert.equal(sameSign.invalidReason, null);

  for (const magnitude of [1e154, 1e308]) {
    const oppositeSign = buildMonteCarloMetricMoments([
      { metrics: { mission_success_rate: magnitude } },
      { metrics: { mission_success_rate: -magnitude } }
    ]).metrics[0];
    assert.equal(oppositeSign.mean, 0);
    assert.equal(oppositeSign.sampleVariance, null);
    assert.equal(oppositeSign.validSampleCount, 2);
    assert.equal(oppositeSign.invalidReason, "sample_variance_not_finite");
  }

  const normalized = normalizeMonteCarloMetricMoments({
    total_sample_count: 2,
    successful_sample_count: 2,
    failed_sample_count: 0,
    metrics: [{
      metric_id: "mission_success_rate",
      mean: 0,
      sample_variance: null,
      valid_sample_count: 2,
      invalid_reason: "sample_variance_not_finite"
    }]
  }).metrics[0];
  assert.equal(normalized.mean, 0);
  assert.equal(normalized.sampleVariance, null);
  assert.equal(normalized.invalidReason, "sample_variance_not_finite");
  assert.equal(formatMonteCarloMoment(normalized.sampleVariance, "ratio", { variance: true }), "不可计算");
});
