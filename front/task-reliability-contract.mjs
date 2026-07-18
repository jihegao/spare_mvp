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
    resultField("sortie_rate", sortieRate, formatSortieRate(sortieRate)),
    resultField("wave_success_rate", waveSuccessRate, formatReliabilityPercent(waveSuccessRate)),
    resultField("period_completion_probability", periodReliability, formatReliabilityPercent(periodReliability)),
    resultField("period_duration_days", periodDays, formatTaskPeriodDays(periodDays))
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
  return numeric === null ? "--" : numeric.toFixed(3);
}

function trimmedDecimal(value, digits) {
  return Number(value).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
