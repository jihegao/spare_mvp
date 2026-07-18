export const TASK_RELIABILITY_RESULT_COLUMNS = Object.freeze([
  Object.freeze({ key: "sortie_rate", label: "出动架次率" }),
  Object.freeze({ key: "wave_success_rate", label: "波次成功率" }),
  Object.freeze({ key: "period_completion_probability", label: "整周期任务可靠度" }),
  Object.freeze({ key: "period_duration_days", label: "任务周期" })
]);

export function normalizeTaskReliabilityResultFields(payload = {}) {
  const fields = indexedResultFields(payload.result_fields ?? payload.resultFields);
  const metrics = indexedMetrics(payload.metrics);
  const sortieRate = numericResultValue(
    fields.get("sortie_rate"),
    payload.sortie_rate ?? payload.sortieRate,
    metrics.get("出动架次率")
  );
  const waveSuccessRate = ratioResultValue(
    fields.get("wave_success_rate"),
    payload.wave_success_rate ?? payload.waveSuccessRate ?? payload.profile_reliability ?? payload.profileReliability,
    metrics.get("波次成功率") ?? metrics.get("任务剖面可靠性")
  );
  const periodReliability = ratioResultValue(
    fields.get("period_completion_probability"),
    payload.period_completion_probability ?? payload.periodCompletionProbability,
    metrics.get("任务可靠度百分比") ?? metrics.get("整周期任务可靠度")
  );
  const periodDays = positiveResultValue(
    fields.get("period_duration_days"),
    payload.period_duration_days ?? payload.periodDurationDays,
    metrics.get("任务周期")
  );

  return [
    resultField(
      "sortie_rate",
      sortieRate,
      canonicalDisplayValue("sortie_rate", fields.get("sortie_rate"), sortieRate) ?? formatSortieRate(sortieRate)
    ),
    resultField(
      "wave_success_rate",
      waveSuccessRate,
      canonicalDisplayValue("wave_success_rate", fields.get("wave_success_rate"), waveSuccessRate) ?? formatReliabilityPercent(waveSuccessRate)
    ),
    resultField(
      "period_completion_probability",
      periodReliability,
      canonicalDisplayValue("period_completion_probability", fields.get("period_completion_probability"), periodReliability)
        ?? formatReliabilityPercent(periodReliability)
    ),
    resultField(
      "period_duration_days",
      periodDays,
      canonicalDisplayValue("period_duration_days", fields.get("period_duration_days"), periodDays) ?? formatTaskPeriodDays(periodDays)
    )
  ];
}

export function taskReliabilityMetricPairs(resultFields = []) {
  const byKey = new Map(resultFields.map((field) => [field.key, field]));
  return TASK_RELIABILITY_RESULT_COLUMNS.map(({ key, label }) => [
    label,
    String(byKey.get(key)?.displayValue ?? "--")
  ]);
}

export function formatReliabilityPercent(value) {
  const numeric = numericValue(value);
  if (numeric === null) return "--";
  const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${trimmedDecimal(percent, 1)}%`;
}

export function formatTaskPeriodDays(value) {
  const numeric = numericValue(value);
  return numeric !== null && numeric > 0 ? `${trimmedDecimal(numeric, 2)} 天` : "--";
}

function resultField(key, value, displayValue) {
  const column = TASK_RELIABILITY_RESULT_COLUMNS.find((item) => item.key === key);
  return {
    key,
    label: column.label,
    value,
    displayValue,
    unit: key === "period_duration_days" ? (value > 0 ? "天" : "") : key === "sortie_rate" ? "" : "%"
  };
}

function indexedResultFields(value) {
  const rows = Array.isArray(value) ? value : [];
  return new Map(rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => [String(row.key || ""), row]));
}

function indexedMetrics(value) {
  const rows = Array.isArray(value) ? value : [];
  return new Map(rows
    .filter((row) => Array.isArray(row) && row.length >= 2)
    .map(([label, metricValue]) => [String(label), metricValue]));
}

function numericResultValue(field, ...fallbacks) {
  for (const value of [field?.value, field?.display_value, field?.displayValue, ...fallbacks]) {
    const numeric = numericValue(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function ratioResultValue(field, ...fallbacks) {
  const value = numericResultValue(field, ...fallbacks);
  if (value === null) return null;
  return Math.min(1, Math.max(0, value > 1 ? value / 100 : value));
}

function positiveResultValue(field, ...fallbacks) {
  const value = numericResultValue(field, ...fallbacks);
  return value !== null && value > 0 ? value : null;
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text || text === "--") return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) return null;
  return text.includes("%") ? numeric / 100 : numeric;
}

function formatSortieRate(value) {
  const numeric = numericValue(value);
  return numeric === null ? "--" : roundHalfEven(numeric, 3).toFixed(3);
}

function trimmedDecimal(value, digits) {
  return roundHalfEven(Number(value), digits).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function canonicalDisplayValue(key, field, value) {
  const displayValue = String(field?.display_value ?? field?.displayValue ?? "").trim();
  if (!displayValue) return null;
  if (key === "period_duration_days" && value === null) return displayValue === "--" ? displayValue : null;
  const parsed = numericValue(displayValue);
  if (value === null || parsed === null) return null;
  if (key === "sortie_rate") {
    return /^\d+\.\d{3}$/.test(displayValue) && nearlyEqual(parsed, value, 0.0005) ? displayValue : null;
  }
  if (key === "wave_success_rate" || key === "period_completion_probability") {
    return /^\d+(?:\.\d)?%$/.test(displayValue) && nearlyEqual(parsed, value, 0.0005) ? displayValue : null;
  }
  if (key === "period_duration_days") {
    return /^\d+(?:\.\d{1,2})? 天$/.test(displayValue) && nearlyEqual(parsed, value, 0.005) ? displayValue : null;
  }
  return null;
}

function nearlyEqual(left, right, tolerance) {
  return Math.abs(Number(left) - Number(right)) <= tolerance + Number.EPSILON * 8;
}

function roundHalfEven(value, digits) {
  const factor = 10 ** digits;
  const scaled = Number(value) * factor;
  if (!Number.isFinite(scaled)) return 0;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const tieTolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (Math.abs(fraction - 0.5) <= tieTolerance) {
    return (lower % 2 === 0 ? lower : lower + 1) / factor;
  }
  return Math.round(scaled) / factor;
}
