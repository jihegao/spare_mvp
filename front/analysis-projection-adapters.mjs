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

const SPARE_SHORTFALL_CONSTRAINTS = Object.freeze([0.85, 0.9, 0.95]);

export function projectionArtifactKindForAnalysisType(analysisType) {
  return PROJECTION_KINDS[analysisType] || "";
}

export function normalizeAnalysisProjectionPayload(analysisType, payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("analysis projection payload must be an object");
  }
  if (payload.projection_type !== analysisType) {
    throw new Error(`projection_type mismatch: expected ${analysisType}, got ${payload.projection_type || "missing"}`);
  }
  validateProjectionTraceability(payload, options);
  if (analysisType === "spare_shortfall") return normalizeSpareShortfall(payload);
  if (analysisType === "carry_list") return normalizeCarryList(payload);
  if (analysisType === "mission_reliability") return normalizeMissionReliability(payload);
  if (analysisType === "downtime_factors") return normalizeDowntimeFactors(payload);
  throw new Error(`unsupported analysis projection type: ${analysisType}`);
}

function validateProjectionTraceability(payload, { runId = "", modelFamily = "" } = {}) {
  if (runId) {
    if (!payload.run_id) throw new Error("projection run_id is required");
    if (String(payload.run_id) !== String(runId)) {
      throw new Error(`projection run_id mismatch: expected ${runId}, got ${payload.run_id}`);
    }
  }
  if (modelFamily) {
    if (!payload.model_family) throw new Error("projection model_family is required");
    if (String(payload.model_family) !== String(modelFamily)) {
      throw new Error(`projection model_family mismatch: expected ${modelFamily}, got ${payload.model_family}`);
    }
  }
}

function normalizeSpareShortfall(payload) {
  const constraints = normalizeSpareShortfallConstraints(payload.constraints);
  const truncation = normalizeSpareShortfallTruncation(payload.truncation);
  const rows = requireArray(payload.data, "spare_shortfall data must be an array")
    .map((row) => {
      const fillRate = clamp01(requireFiniteNumber(row.fill_rate, "fill_rate"));
      const utilization = clamp01(requireFiniteNumber(row.utilization, "utilization"));
      const shortageProbability = clamp01(requireFiniteNumber(row.shortage_probability, "shortage_probability"));
      return {
        name: stringValue(row.spare_type, "unknown_spare"),
        satisfy: fillRate,
        utilization,
        shortageProbability,
        delay: Math.round(shortageProbability * 100),
        baseCount: Math.max(0, Math.round(fillRate * 10)),
        stock: Math.max(1, Math.round((1 + shortageProbability) * 10)),
        shortage: Math.round(shortageProbability * 10),
        level: riskLevelLabel(row.risk_level, shortageProbability),
        fillRateConstraint: thresholdLabel(fillRate, constraints.fillRate),
        utilizationConstraint: thresholdLabel(utilization, constraints.utilization)
      };
    })
    .sort((left, right) => right.shortageProbability - left.shortageProbability);
  const shortageRows = rows.filter((row) => row.shortageProbability > 0);
  return {
    analysisType: "spare_shortfall",
    formal: true,
    source: "projection payload",
    constraints,
    truncation,
    rows,
    metrics: [
      ["短板备件", `${shortageRows.length} 项`],
      ["最低备件满足率", fixed(min(rows.map((row) => row.satisfy), 1), 2)],
      ["最低备件利用率", fixed(min(rows.map((row) => row.utilization), 1), 2)],
      ["约束档位", constraints.fillRate.map((value) => fixed(value, 2)).join(" / ")]
    ]
  };
}

function normalizeSpareShortfallConstraints(constraints) {
  const fillRate = requireConstraintValues(constraints?.fill_rate, "fill_rate");
  const utilization = requireConstraintValues(constraints?.utilization, "utilization");
  return { fillRate, utilization };
}

function requireConstraintValues(values, label) {
  if (!Array.isArray(values) || values.length !== SPARE_SHORTFALL_CONSTRAINTS.length) {
    throw new Error(`${label} constraints must be exactly 0.85, 0.9, 0.95`);
  }
  const normalized = values.map((value) => requireFiniteNumber(value, `${label} constraint`));
  const matches = normalized.every((value, index) => Math.abs(value - SPARE_SHORTFALL_CONSTRAINTS[index]) < 1e-9);
  if (!matches) throw new Error(`${label} constraints must be exactly 0.85, 0.9, 0.95`);
  return normalized;
}

function normalizeSpareShortfallTruncation(truncation) {
  const mode = stringValue(truncation?.mode, "");
  const fields = requireArray(truncation?.fields, "truncation fields must be an array").map((field) => stringValue(field, ""));
  if (mode !== "clamp_0_1") throw new Error("truncation mode must be clamp_0_1");
  for (const field of ["fill_rate", "utilization", "shortage_probability"]) {
    if (!fields.includes(field)) throw new Error(`truncation fields must include ${field}`);
  }
  return { mode, fields };
}

function thresholdLabel(value, thresholds) {
  const achieved = thresholds.filter((threshold) => value >= threshold);
  if (!achieved.length) return `未达 ${fixed(thresholds[0], 2)}`;
  return `达标 ${fixed(achieved[achieved.length - 1], 2)}`;
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
    objective: "minimize_carry_spares",
    rows,
    metrics: [
      ["默认目标", "携行备件越少越好"],
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
  const state = data.target_met ? "满足" : "未达标";
  const seriesRows = normalizeMissionReliabilitySeries(data, { probability, sortieRate, state });
  const steepestDrop = missionReliabilitySteepestDrop(seriesRows);
  return {
    analysisType: "mission_reliability",
    formal: true,
    source: "projection payload",
    rows: seriesRows,
    steepestDrop,
    metrics: [
      ["任务成功概率", fixed(probability, 2)],
      ["出动架次率", fixed(sortieRate, 2)],
      ["目标达成", state],
      ["最大下降区间", missionReliabilityDropLabel(steepestDrop)]
    ]
  };
}

function normalizeMissionReliabilitySeries(data, fallback) {
  const rawRows = Array.isArray(data.series) && data.series.length ? data.series : [{
    simulation_time: "projection",
    mission_success_probability: fallback.probability,
    sortie_rate: fallback.sortieRate
  }];
  return rawRows.map((row, index) => {
    const probability = clamp01(requireFiniteNumber(row.mission_success_probability, "series mission_success_probability"));
    const sortieRate = clamp01(requireFiniteNumber(row.sortie_rate ?? data.sortie_rate, "series sortie_rate"));
    return {
      sequence: index + 1,
      timeLabel: stringValue(row.simulation_time, `${index + 1}`),
      probability,
      sorties: Math.round(sortieRate * 100),
      available: Math.round(probability * 100),
      state: fallback.state
    };
  });
}

function missionReliabilitySteepestDrop(rows) {
  if (rows.length < 2) return null;
  let best = null;
  for (let index = 1; index < rows.length; index += 1) {
    const from = rows[index - 1];
    const to = rows[index];
    const drop = from.probability - to.probability;
    if (!best || drop > best.drop) {
      best = {
        fromIndex: from.sequence,
        toIndex: to.sequence,
        fromTime: Number(from.timeLabel),
        toTime: Number(to.timeLabel),
        drop
      };
    }
  }
  return best && best.drop > 0 ? best : null;
}

function missionReliabilityDropLabel(drop) {
  if (!drop) return "无下降区间";
  return `T${drop.fromIndex} → T${drop.toIndex} (-${fixed(drop.drop, 2)})`;
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
  const snapshots = normalizeDowntimeAnomalySnapshots(payload.anomaly_snapshots || []);
  return {
    analysisType: "downtime_factors",
    formal: true,
    source: "projection payload",
    rows,
    snapshots,
    metrics: [
      ["停机因素总次数", `${rows.length} 项`],
      ["首要因素", rows[0]?.label || "-"],
      ["次要因素", rows[1]?.label || "-"],
      ["异常停机快照", `${snapshots.length} 条`]
    ]
  };
}

function normalizeDowntimeAnomalySnapshots(value) {
  return requireArray(value, "anomaly_snapshots must be an array")
    .map((row) => {
      const time = requireFiniteNumber(row.simulation_time, "anomaly snapshot simulation_time");
      const state = requireObject(row.support_activity_state, "support_activity_state must be an object");
      const job = requireObject(row.job_node, "job_node must be an object");
      const frameRef = requireObject(row.frame_ref, "frame_ref must be an object");
      return {
        id: stringValue(row.snapshot_id, `downtime-${time}`),
        timeLabel: stringValue(time, "0"),
        eventType: stringValue(row.event_type, "downtime_event"),
        eventLabel: stringValue(row.event_label, DOWNTIME_FACTOR_LABELS[row.event_type] || row.event_type || "停机事件"),
        result: stringValue(row.result, "recorded"),
        activeJobs: Math.max(0, Math.round(numberOrZero(state.active_jobs))),
        repairBacklog: Math.max(0, Math.round(numberOrZero(state.repair_backlog))),
        spareFillRate: clamp01(numberOrZero(state.spare_fill_rate)),
        jobNodeId: stringValue(job.job_id || job.node_id, "unknown_job"),
        jobNodeLabel: stringValue(job.task || job.label || job.kind, "未定位作业"),
        jobState: stringValue(job.state, "unknown"),
        frameRef: `sample=${stringValue(frameRef.sample_index, "0")}; sample_step=${stringValue(frameRef.sample_step, "0")}; step=${stringValue(frameRef.step, "0")}`
      };
    })
    .sort((left, right) => Number(left.timeLabel) - Number(right.timeLabel));
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

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
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
