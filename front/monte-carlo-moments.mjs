export const MONTE_CARLO_METRIC_DEFINITIONS = Object.freeze([
  { metricId: "mission_success_rate", label: "任务可靠度", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "operational_availability", label: "使用可用度(A)", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio" },
  { metricId: "spare_fill_rate", label: "实际即时满足率", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio", numeratorField: "spare_immediately_filled_total", denominatorField: "spare_demand_total" },
  { metricId: "spare_utilization", label: "实际备件利用率", unit: "比例", varianceUnit: "比例²", valueFormat: "ratio", numeratorField: "spare_consumed_total", denominatorField: "spare_carried_total" },
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

function finiteMean(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value / values.length, 0);
  return isFiniteNumber(mean) ? mean : null;
}

function finiteSampleVariance(values, mean) {
  if (values.length < 2 || !isFiniteNumber(mean)) return { value: null, invalidReason: null };
  const directVariance = values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0
  ) / (values.length - 1);
  if (isFiniteNumber(directVariance)) return { value: directVariance, invalidReason: null };
  const scale = Math.max(...values.map((value) => Math.abs(value)));
  if (scale === 0) return { value: 0, invalidReason: null };
  const scaledMean = mean / scale;
  const scaledVariance = values.reduce(
    (sum, value) => sum + ((value / scale - scaledMean) ** 2),
    0
  ) / (values.length - 1);
  const standardDeviation = scale * Math.sqrt(scaledVariance);
  if (!isFiniteNumber(standardDeviation) || standardDeviation > Math.sqrt(Number.MAX_VALUE)) {
    return { value: null, invalidReason: "sample_variance_not_finite" };
  }
  const variance = standardDeviation * standardDeviation;
  return isFiniteNumber(variance)
    ? { value: variance, invalidReason: null }
    : { value: null, invalidReason: "sample_variance_not_finite" };
}

export function buildMonteCarloMetricMoments(samples, counts = {}) {
  const safeSamples = Array.isArray(samples) ? samples : [];
  const metrics = MONTE_CARLO_METRIC_DEFINITIONS.map((definition) => {
    const ratioPairs = definition.numeratorField
      ? safeSamples.flatMap((sample) => {
        const metrics = sample?.metrics || sample?.final || {};
        const numerator = metrics[definition.numeratorField];
        const denominator = metrics[definition.denominatorField];
        return isFiniteNumber(numerator) && numerator >= 0 && isFiniteNumber(denominator) && denominator > 0
          ? [[numerator, denominator]]
          : [];
      })
      : [];
    const zeroDenominatorSampleCount = definition.numeratorField
      ? safeSamples.filter((sample) => {
        const metrics = sample?.metrics || sample?.final || {};
        const numerator = metrics[definition.numeratorField];
        const denominator = metrics[definition.denominatorField];
        return isFiniteNumber(numerator) && numerator >= 0 && denominator === 0;
      }).length
      : 0;
    const values = definition.numeratorField
      ? ratioPairs.map(([numerator, denominator]) => numerator / denominator)
      : safeSamples
        .map((sample) => sample?.metrics?.[definition.metricId] ?? sample?.final?.[definition.metricId])
        .filter(isFiniteNumber);
    const validSampleCount = values.length;
    const arithmeticMean = finiteMean(values);
    const numeratorTotal = ratioPairs.length ? ratioPairs.reduce((total, [numerator]) => total + numerator, 0) : null;
    const denominatorTotal = ratioPairs.length ? ratioPairs.reduce((total, [, denominator]) => total + denominator, 0) : null;
    const mean = arithmeticMean;
    const overallRatio = definition.numeratorField && denominatorTotal > 0 ? numeratorTotal / denominatorTotal : null;
    const varianceResult = finiteSampleVariance(values, arithmeticMean);
    const invalidReason = validSampleCount > 0 && mean === null
      ? "mean_not_finite"
      : varianceResult.invalidReason;
    return {
      ...definition,
      mean,
      sampleVariance: varianceResult.value,
      validSampleCount,
      invalidReason: definition.numeratorField && validSampleCount === 0
        ? zeroDenominatorSampleCount ? "zero_denominator" : "data_unavailable"
        : invalidReason,
      meanAggregationMethod: "arithmetic_mean",
      overallAggregationMethod: definition.numeratorField ? "ratio_of_totals" : null,
      overallStatus: overallRatio !== null ? "available" : zeroDenominatorSampleCount ? "zero_denominator" : "data_unavailable",
      numeratorTotal,
      denominatorTotal,
      overallRatio
    };
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
    const mean = validSampleCount > 0 && isFiniteNumber(source.mean) ? source.mean : null;
    const sampleVariance = validSampleCount >= 2
      && isFiniteNumber(source.sample_variance)
      && source.sample_variance >= 0
      ? source.sample_variance
      : null;
    const invalidReason = typeof source.invalid_reason === "string" && source.invalid_reason
      ? source.invalid_reason
      : validSampleCount > 0 && mean === null
        ? "mean_not_finite"
        : validSampleCount >= 2 && sampleVariance === null
          ? "sample_variance_not_finite"
          : null;
    return {
      ...definition,
      mean,
      sampleVariance,
      validSampleCount,
      invalidReason,
      meanAggregationMethod: source.mean_aggregation_method || "arithmetic_mean",
      overallAggregationMethod: source.overall_aggregation_method
        || (source.aggregation_method === "ratio_of_totals" ? "ratio_of_totals" : definition.numeratorField ? "ratio_of_totals" : null),
      overallStatus: source.overall_status || (isFiniteNumber(source.overall_ratio) ? "available" : "data_unavailable"),
      numeratorTotal: isFiniteNumber(source.numerator_total) ? source.numerator_total : null,
      denominatorTotal: isFiniteNumber(source.denominator_total) ? source.denominator_total : null,
      overallRatio: isFiniteNumber(source.overall_ratio) ? source.overall_ratio : null
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
  if (!isFiniteNumber(value)) return variance ? "不可计算" : "--";
  if (variance) return value.toFixed(4);
  return value.toFixed(2);
}
