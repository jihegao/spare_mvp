export const MONTE_CARLO_METRIC_DEFINITIONS = Object.freeze([
  { metricId: "mission_success_rate", label: "任务可靠度", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "spare_fill_rate", label: "备件满足率", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "spare_utilization", label: "备件利用率", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "ready_rate", label: "战备完好率", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "sortie_rate", label: "出动架次率", unit: "架次/机/天", varianceUnit: "(架次/机/天)²", valueFormat: "number" },
  { metricId: "mean_transport_delay", label: "平均备件延误时间", unit: "小时", varianceUnit: "小时²", valueFormat: "number" },
  { metricId: "repair_backlog", label: "维修积压", unit: "项", varianceUnit: "项²", valueFormat: "number" }
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function count(value, fallback = 0) {
  return isFiniteNumber(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

export function buildMonteCarloMetricMoments(samples, counts = {}) {
  const safeSamples = Array.isArray(samples) ? samples : [];
  const metrics = MONTE_CARLO_METRIC_DEFINITIONS.map((definition) => {
    const values = safeSamples
      .map((sample) => sample?.metrics?.[definition.metricId] ?? sample?.final?.[definition.metricId])
      .filter(isFiniteNumber);
    const validSampleCount = values.length;
    const mean = validSampleCount
      ? values.reduce((sum, value) => sum + value, 0) / validSampleCount
      : null;
    const sampleVariance = validSampleCount >= 2
      ? values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (validSampleCount - 1)
      : null;
    return { ...definition, mean, sampleVariance, validSampleCount };
  });
  const successfulSampleCount = count(counts.successfulSampleCount, safeSamples.length);
  const failedSampleCount = count(counts.failedSampleCount);
  return {
    schemaVersion: "monte-carlo-metric-moments-v0",
    varianceMethod: "unbiased_sample_variance",
    varianceDenominator: "n-1",
    totalSampleCount: count(counts.totalSampleCount, successfulSampleCount + failedSampleCount),
    successfulSampleCount,
    failedSampleCount,
    metrics
  };
}

export function normalizeMonteCarloMetricMoments(payload, samples = [], counts = {}) {
  if (!payload || !Array.isArray(payload.metrics)) {
    return buildMonteCarloMetricMoments(samples, counts);
  }
  const byId = new Map(payload.metrics
    .filter((metric) => metric && typeof metric.metric_id === "string")
    .map((metric) => [metric.metric_id, metric]));
  const metrics = MONTE_CARLO_METRIC_DEFINITIONS.map((definition) => {
    const source = byId.get(definition.metricId) || {};
    const validSampleCount = count(source.valid_sample_count);
    return {
      ...definition,
      mean: validSampleCount > 0 && isFiniteNumber(source.mean) ? source.mean : null,
      sampleVariance: validSampleCount >= 2 && isFiniteNumber(source.sample_variance)
        ? source.sample_variance
        : null,
      validSampleCount
    };
  });
  const successfulSampleCount = count(
    payload.successful_sample_count,
    count(counts.successfulSampleCount, Array.isArray(samples) ? samples.length : 0)
  );
  const failedSampleCount = count(payload.failed_sample_count, count(counts.failedSampleCount));
  return {
    schemaVersion: payload.schema_version || "monte-carlo-metric-moments-v0",
    varianceMethod: "unbiased_sample_variance",
    varianceDenominator: "n-1",
    totalSampleCount: count(
      payload.total_sample_count,
      count(counts.totalSampleCount, successfulSampleCount + failedSampleCount)
    ),
    successfulSampleCount,
    failedSampleCount,
    metrics
  };
}

export function formatMonteCarloMoment(value, _valueFormat, { variance = false } = {}) {
  if (!isFiniteNumber(value)) return variance ? "不可计算" : "无有效样本";
  if (variance) return value.toFixed(4);
  return value.toFixed(2);
}
