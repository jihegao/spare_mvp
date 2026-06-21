const PROJECTION_KINDS = Object.freeze({
  spare_shortfall: "analysis_projection_spare_shortfall",
  carry_list: "analysis_projection_carry_list",
  mission_reliability: "analysis_projection_mission_reliability",
  downtime_factors: "analysis_projection_downtime_factors"
});

const DOWNTIME_FACTOR_LABELS = Object.freeze({
  failure: "装备故障",
  spare_shortage: "备件短缺",
  resource_delay: "资源延误",
  schedule_delay: "计划延误"
});

export function projectionArtifactKindForAnalysisType(analysisType) {
  return PROJECTION_KINDS[analysisType] || "";
}

export function normalizeAnalysisProjectionPayload(analysisType, payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("analysis projection payload must be an object");
  }
  if (payload.projection_type !== analysisType) {
    throw new Error(`projection_type mismatch: expected ${analysisType}, got ${payload.projection_type || "missing"}`);
  }
  if (analysisType === "spare_shortfall") return normalizeSpareShortfall(payload);
  if (analysisType === "carry_list") return normalizeCarryList(payload);
  if (analysisType === "mission_reliability") return normalizeMissionReliability(payload);
  if (analysisType === "downtime_factors") return normalizeDowntimeFactors(payload);
  throw new Error(`unsupported analysis projection type: ${analysisType}`);
}

function normalizeSpareShortfall(payload) {
  const rows = requireArray(payload.data, "spare_shortfall data must be an array")
    .map((row) => {
      const fillRate = requireFiniteNumber(row.fill_rate, "fill_rate");
      const shortageProbability = requireFiniteNumber(row.shortage_probability, "shortage_probability");
      return {
        name: stringValue(row.spare_type, "unknown_spare"),
        satisfy: fillRate,
        shortageProbability,
        delay: Math.round(shortageProbability * 100),
        baseCount: Math.max(0, Math.round(fillRate * 10)),
        stock: Math.max(1, Math.round((1 + shortageProbability) * 10)),
        shortage: Math.round(shortageProbability * 10),
        level: riskLevelLabel(row.risk_level, shortageProbability)
      };
    })
    .sort((left, right) => right.shortageProbability - left.shortageProbability);
  const shortageRows = rows.filter((row) => row.shortageProbability > 0);
  return {
    analysisType: "spare_shortfall",
    formal: true,
    source: "projection payload",
    rows,
    metrics: [
      ["短板备件", `${shortageRows.length} 项`],
      ["最低备件满足率", fixed(min(rows.map((row) => row.satisfy), 1), 2)],
      ["最高短缺概率", pct(max(rows.map((row) => row.shortageProbability), 0))],
      ["建议优先补充", shortageRows.map((row) => row.name).slice(0, 2).join(" / ") || "-"]
    ]
  };
}

function normalizeCarryList(payload) {
  const rows = requireArray(payload.data, "carry_list data must be an array")
    .map((row) => {
      const multiplier = Math.max(0, requireFiniteNumber(row.recommended_multiplier, "recommended_multiplier"));
      const priority = priorityLabel(row.risk_level);
      return {
        name: stringValue(row.spare_type, "unknown_spare"),
        multiplier,
        satisfy: Math.min(1, multiplier / Math.max(multiplier, 1)),
        delay: Math.max(0, Math.round((multiplier - 1) * 24)),
        qty: Math.max(1, priority === "高" ? Math.ceil(multiplier) : Math.round(multiplier)),
        priority
      };
    })
    .sort((left, right) => right.qty - left.qty);
  const highPriority = rows.filter((row) => row.priority === "高");
  return {
    analysisType: "carry_list",
    formal: true,
    source: "projection payload",
    rows,
    metrics: [
      ["优化条件", "projection payload"],
      ["携行备件数量", `${rows.reduce((sum, row) => sum + row.qty, 0)} 件`],
      ["最高携行倍率", fixed(max(rows.map((row) => row.multiplier), 0), 2)],
      ["高优先级备件", highPriority.map((row) => row.name).slice(0, 2).join(" / ") || "-"]
    ]
  };
}

function normalizeMissionReliability(payload) {
  const data = requireObject(payload.data, "mission_reliability data must be an object");
  const probability = requireFiniteNumber(data.mission_success_probability, "mission_success_probability");
  const sortieRate = requireFiniteNumber(data.sortie_rate, "sortie_rate");
  const state = data.target_met ? "满足" : probability < 0.7 ? "风险" : "关注";
  return {
    analysisType: "mission_reliability",
    formal: true,
    source: "projection payload",
    rows: [{
      wave: "projection",
      probability,
      sorties: Math.round(sortieRate * 100),
      available: Math.round(probability * 100),
      state
    }],
    metrics: [
      ["任务成功概率", fixed(probability, 2)],
      ["出动架次率", fixed(sortieRate, 2)],
      ["目标达成", state],
      ["projection payload", "mission_reliability"]
    ]
  };
}

function normalizeDowntimeFactors(payload) {
  const rows = requireArray(payload.data, "downtime_factors data must be an array")
    .map((row) => {
      const contribution = requireFiniteNumber(row.contribution, "contribution");
      const factor = stringValue(row.factor, "unknown");
      return {
        factor,
        label: DOWNTIME_FACTOR_LABELS[factor] || factor,
        count: Math.round(contribution * 100),
        contribution,
        contributionLabel: pct(contribution)
      };
    })
    .sort((left, right) => right.contribution - left.contribution);
  return {
    analysisType: "downtime_factors",
    formal: true,
    source: "projection payload",
    rows,
    metrics: [
      ["停机因素总次数", `${rows.length} 项`],
      ["首要因素", rows[0]?.label || "-"],
      ["次要因素", rows[1]?.label || "-"],
      ["projection payload", "downtime_factors"]
    ]
  };
}

function requireArray(value, message) {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function requireObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function requireFiniteNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${fieldName} must be a finite number`);
  return value;
}

function stringValue(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function min(values, fallback) {
  return values.length ? Math.min(...values) : fallback;
}

function max(values, fallback) {
  return values.length ? Math.max(...values) : fallback;
}

function fixed(value, digits) {
  return Number(value || 0).toFixed(digits);
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function riskLevelLabel(riskLevel, probability) {
  if (riskLevel === "high" || riskLevel === "高" || probability >= 0.2) return "严重";
  if (riskLevel === "medium" || riskLevel === "中" || probability > 0) return "短缺";
  return "关注";
}

function priorityLabel(riskLevel) {
  if (riskLevel === "high" || riskLevel === "高") return "高";
  if (riskLevel === "medium" || riskLevel === "中") return "中";
  return "低";
}
