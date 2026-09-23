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
  let expectedDisplayValue = null;
  if (key === "sortie_rate") {
    expectedDisplayValue = formatSortieRate(value);
  } else if (key === "wave_success_rate" || key === "period_completion_probability") {
    expectedDisplayValue = formatReliabilityPercent(value);
  } else if (key === "period_duration_days") {
    expectedDisplayValue = formatTaskPeriodDays(value);
  }
  return displayValue === expectedDisplayValue ? displayValue : null;
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

// Detail is never grouped: a sample and a business wave identify one observation.
export function normalizeTaskReliabilityWaveRows(rows = []) {
  const count = (value) => optionalNonNegativeInteger(value);
  return rows.map((row, index) => {
    const sampleIndex = count(firstDefinedValue(row, ["sampleIndex", "sample_index"]));
    const dayIndex = count(firstDefinedValue(row, ["dayIndex", "day_index"]));
    const waveIndex = count(firstDefinedValue(row, ["waveIndex", "wave_index"]));
    const plannedWaves = count(firstDefinedValue(row, ["plannedWaves", "planned_waves"]));
    const successfulWaves = count(firstDefinedValue(row, ["successfulWaves", "successful_waves"]));
    const plannedSorties = count(firstDefinedValue(row, ["plannedSorties", "planned_sorties"]));
    const launchedSorties = count(firstDefinedValue(row, ["launchedSorties", "launched_sorties"]));
    const probability = optionalFiniteRate(firstDefinedValue(row, [
      "meanMissionSuccessRate",
      "mean_mission_success_rate",
      "missionSuccessRate",
      "mission_success_probability",
      "probability"
    ]));
    const sortieRate = optionalFiniteRate(firstDefinedValue(row, ["meanSortieRate", "mean_sortie_rate", "sortieRate", "sortie_rate"]));
    const waveLabel = dayIndex && waveIndex ? `第${dayIndex}天第${waveIndex}波次` : row.waveLabel ?? row.wave_label ?? row.timeLabel ?? "-";
    return {
      ...row, sequence: index + 1, sampleIndex,
      sampleLabel: sampleIndex === null ? "不可用" : `样本 ${sampleIndex + 1}`,
      dayIndex, waveIndex, waveLabel, timeLabel: waveLabel,
      waveKey: dayIndex && waveIndex ? `d${dayIndex}-w${waveIndex}` : row.waveKey ?? row.wave_key ?? `wave-${index + 1}`,
      plannedWaves, successfulWaves, plannedSorties, launchedSorties,
      successfulSorties: count(firstDefinedValue(row, ["successfulSorties", "successful_sorties"])),
      probability, meanMissionSuccessRate: probability, missionSuccessRate: probability,
      sortieRate, meanSortieRate: sortieRate
    };
  });
}

export function aggregateTaskReliabilityWaves(rows = [], { totalSampleCount = null } = {}) {
  const analysisSampleCount = optionalNonNegativeInteger(totalSampleCount);
  const groups = new Map();
  for (const row of normalizeTaskReliabilityWaveRows(rows)) {
    const businessKey = row.dayIndex !== null && row.waveIndex !== null
      ? `d${row.dayIndex}-w${row.waveIndex}`
      : row.waveKey;
    const group = groups.get(businessKey) || [];
    group.push(row);
    groups.set(businessKey, group);
  }
  return [...groups.values()]
    .sort(compareBusinessWaveGroups)
    .map((group, index) => {
      const total = (key) => group.every((row) => row[key] !== null) ? group.reduce((sum, row) => sum + row[key], 0) : null;
      const plannedWaves = total("plannedWaves");
      const successfulWaves = total("successfulWaves");
      const plannedSorties = total("plannedSorties");
      const launchedSorties = total("launchedSorties");
      const validProbabilityRows = group.filter((row) => row.probability !== null);
      const validSortieRows = group.filter((row) => row.sortieRate !== null);
      const probability = arithmeticMean(validProbabilityRows.map((row) => row.probability));
      const sortieRate = arithmeticMean(validSortieRows.map((row) => row.sortieRate));
      const groupTotalSampleCount = Math.max(group.length, analysisSampleCount ?? 0);
      return {
        ...group[0], sequence: index + 1, sampleIndex: null,
        sampleCount: validProbabilityRows.length,
        totalSampleCount: groupTotalSampleCount,
        validSampleCount: validProbabilityRows.length,
        invalidSampleCount: groupTotalSampleCount - validProbabilityRows.length,
        plannedWaves, successfulWaves, plannedSorties, launchedSorties,
        probability, meanMissionSuccessRate: probability, sortieRate,
        sorties: sortieRate === null ? null : Math.round(sortieRate * 100),
        available: probability === null ? null : Math.round(probability * 100)
      };
    });
}

export function taskReliabilitySampleIndexes(rows = []) {
  return [...new Set(normalizeTaskReliabilityWaveRows(rows)
    .map((row) => row.sampleIndex)
    .filter((sampleIndex) => sampleIndex !== null))]
    .sort((left, right) => left - right);
}

export function filterTaskReliabilityRowsBySample(rows = [], selectedSampleIndex = null) {
  const normalized = normalizeTaskReliabilityWaveRows(rows);
  if (selectedSampleIndex === null || selectedSampleIndex === undefined || selectedSampleIndex === "") return normalized;
  const sampleIndex = optionalNonNegativeInteger(selectedSampleIndex);
  if (sampleIndex === null) return [];
  return normalized.filter((row) => row.sampleIndex === sampleIndex);
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function optionalFiniteRate(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function firstDefinedValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return null;
}

function arithmeticMean(values) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toPrecision(15));
}

function compareBusinessWaveGroups(left, right) {
  const leftRow = left[0];
  const rightRow = right[0];
  const leftHasBusinessOrder = leftRow.dayIndex !== null && leftRow.waveIndex !== null;
  const rightHasBusinessOrder = rightRow.dayIndex !== null && rightRow.waveIndex !== null;
  if (leftHasBusinessOrder !== rightHasBusinessOrder) return leftHasBusinessOrder ? -1 : 1;
  if (leftHasBusinessOrder) {
    return leftRow.dayIndex - rightRow.dayIndex || leftRow.waveIndex - rightRow.waveIndex;
  }
  return String(leftRow.waveKey).localeCompare(String(rightRow.waveKey), "zh-CN", { numeric: true });
}
