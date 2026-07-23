import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAnalysisProjectionPayload,
  projectionArtifactKindForAnalysisType
} from "../front/analysis-projection-adapters.mjs";

test("normalizes spare shortfall projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("spare_shortfall", {
    projection_type: "spare_shortfall",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    base_artifact_id: "monte_carlo_base-run-ui",
    constraints: {
      fill_rate: [0.85, 0.9, 0.95],
      utilization: [0.85, 0.9, 0.95]
    },
    truncation: {
      mode: "clamp_0_1",
      fields: ["fill_rate", "utilization", "shortage_probability"]
    },
    data: [
      { product_id: "product-engine", spare_type: "engine", fill_rate: 0.81, utilization: 0.72, shortage_probability: 0.25, risk_level: "high" },
      { product_id: "product-radar", spare_type: "radar", fill_rate: 0.96, utilization: 0.88, shortage_probability: 0, risk_level: "low" }
    ]
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.equal(view.analysisType, "spare_shortfall");
  assert.equal(view.formal, true);
  assert.deepEqual(view.constraints.fillRate, [0.85, 0.9, 0.95]);
  assert.deepEqual(view.constraints.utilization, [0.85, 0.9, 0.95]);
  assert.equal(view.truncation.mode, "clamp_0_1");
  assert.deepEqual(view.metrics, [
    ["短板备件", "1 项"],
    ["最高缺件备件", "engine"],
    ["最低备件满足率", "0.81"],
    ["最低备件利用率", "0.72"],
    ["约束档位", "0.85 / 0.90 / 0.95"]
  ]);
  assert.deepEqual(view.highestShortfallNames, ["engine"]);
  assert.equal(view.rows[0].name, "engine");
  assert.equal(view.rows[0].productId, "product-engine");
  assert.equal(view.rows[0].level, "严重");
  assert.equal(view.rows[0].fillRateConstraint, "未达 0.85");
  assert.equal(view.rows[0].utilizationConstraint, "未达 0.85");
  assert.equal(view.rows[1].fillRateConstraint, "达标 0.95");
  assert.equal(view.rows[1].utilizationConstraint, "达标 0.85");
});

test("lists every exactly tied highest spare shortfall using the reported shortage count", () => {
  const view = normalizeAnalysisProjectionPayload("spare_shortfall", {
    projection_type: "spare_shortfall",
    run_id: "run-ties",
    model_family: "aircraft_support_v1",
    constraints: {
      fill_rate: [0.85, 0.9, 0.95],
      utilization: [0.85, 0.9, 0.95]
    },
    truncation: {
      mode: "clamp_0_1",
      fields: ["fill_rate", "utilization", "shortage_probability"]
    },
    data: [
      { aircraft_model: "J-15", spare_type: "engine", demand_count: 8, filled_count: 3, shortage_count: 5, fill_rate: 0.38, utilization: 0.7, shortage_probability: 0.25, risk_level: "high" },
      { aircraft_model: "J-35", spare_type: "radar", demand_count: 7, filled_count: 2, shortage_count: 5, fill_rate: 0.29, utilization: 0.7, shortage_probability: 0.24, risk_level: "high" },
      { aircraft_model: "J-15", spare_type: "hydraulic", demand_count: 10, filled_count: 6, shortage_count: 4, fill_rate: 0.6, utilization: 0.7, shortage_probability: 0.25, risk_level: "high" }
    ]
  }, { runId: "run-ties", modelFamily: "aircraft_support_v1" });

  assert.deepEqual(view.highestShortfallNames, ["engine", "radar"]);
  assert.equal(view.metrics[1][1], "engine、radar");
  assert.deepEqual(view.rows.map((row) => [row.aircraftModel, row.name, row.shortage]), [
    ["J-15", "engine", 5],
    ["J-15", "hydraulic", 4],
    ["J-35", "radar", 5]
  ]);
});

test("normalizes not applicable projection payloads without formal KPI computation", () => {
  const view = normalizeAnalysisProjectionPayload("spare_shortfall", {
    projection_type: "spare_shortfall",
    run_id: "run-reduced-scope",
    model_family: "aircraft_support_v1",
    applicability: {
      status: "not_applicable",
      reason_code: "scope_not_modeled",
      required_domains: ["supportActivities", "supportResources"],
      disabled_domains: ["supportActivities", "supportResources"]
    },
    constraints: {
      fill_rate: [0.85, 0.9, 0.95],
      utilization: [0.85, 0.9, 0.95]
    },
    truncation: {
      mode: "clamp_0_1",
      fields: ["fill_rate", "utilization", "shortage_probability"]
    },
    data: [
      { spare_type: "misleading-zero", fill_rate: 0, utilization: 0, shortage_probability: 0, risk_level: "low" }
    ]
  }, { runId: "run-reduced-scope", modelFamily: "aircraft_support_v1" });

  assert.equal(view.analysisType, "spare_shortfall");
  assert.equal(view.formal, false);
  assert.equal(view.source, "projection applicability");
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.metrics, [["适用性", "不适用"]]);
  assert.deepEqual(view.applicability.disabled_domains, ["supportActivities", "supportResources"]);
});

test("normalizes carry list projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("carry_list", {
    projection_type: "carry_list",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: [
      {
        product_id: "product-engine",
        spare_type: "engine",
        recommended_quantity: 2,
        recommended_multiplier: 1.4,
        used_quantity: 1,
        carried_quantity: 1,
        satisfaction_rate: 0.9,
        minimum_satisfaction_rate: 0.9,
        satisfaction_constraint_met: true,
        satisfaction_constraint_margin: 0,
        utilization: 0,
        risk_level: "high"
      },
      {
        product_id: "product-hydraulic",
        spare_type: "hydraulic",
        recommended_quantity: 1,
        recommended_multiplier: 1.1,
        used_quantity: 1,
        carried_quantity: 9,
        satisfaction_rate: 0.95,
        minimum_satisfaction_rate: 0.9,
        satisfaction_constraint_met: true,
        satisfaction_constraint_margin: 0.05,
        utilization: 0,
        risk_level: "medium"
      }
    ]
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.deepEqual(view.metrics.slice(1), [
    ["携行备件数量", "3 件"],
    ["总体备件利用率", "20.00%"],
    ["最高携行倍率", "1.40"],
    ["高优先级备件", "engine"]
  ]);
  assert.equal(view.objective, "minimize_carry_spares");
  assert.deepEqual(view.metrics[0], ["默认目标", "携行备件越少越好"]);
  assert.equal(view.rows[0].priority, "高");
  assert.equal(view.rows[0].productId, "product-engine");
  assert.equal(view.rows[0].qty, 2);
  assert.equal(view.rows[0].utilization, 1);
  assert.equal(view.rows[0].satisfactionRate, 0.9);
  assert.equal(view.rows[0].minimumSatisfactionRate, 0.9);
  assert.equal(view.rows[0].satisfactionConstraintMet, true);
  assert.equal(view.rows[0].satisfactionConstraintMargin, 0);
  assert.equal(view.rows[1].utilization, 1 / 9);
  assert.equal(view.rows[1].satisfactionConstraintMargin, 0.05);

  const legacyView = normalizeAnalysisProjectionPayload("carry_list", {
    projection_type: "carry_list",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: [
      { product_id: "legacy", spare_type: "legacy", recommended_multiplier: 1, utilization: 0.5, risk_level: "low" }
    ]
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });
  assert.deepEqual(legacyView.metrics.find(([label]) => label === "总体备件利用率"), ["总体备件利用率", "数据不可用"]);
});

test("formal carry utilization distinguishes unavailable raw data from a true zero denominator", () => {
  const normalize = (data) => normalizeAnalysisProjectionPayload("carry_list", {
    projection_type: "carry_list",
    run_id: "run-carry-edge",
    model_family: "aircraft_support_v1",
    data
  }, { runId: "run-carry-edge", modelFamily: "aircraft_support_v1" });
  const row = (raw = {}) => ({
    product_id: "spare-a",
    spare_type: "spare-a",
    recommended_multiplier: 1,
    utilization: null,
    risk_level: "low",
    ...raw
  });
  const overall = (view) => view.metrics.find(([label]) => label === "总体备件利用率");

  assert.deepEqual(overall(normalize([])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: 1 })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: "invalid", carried_quantity: 2 })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: "   ", carried_quantity: 2 })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: 0, carried_quantity: "\t" })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: false, carried_quantity: 2 })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: 0, carried_quantity: true })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: -1, carried_quantity: 2 })])), ["总体备件利用率", "数据不可用"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: 0, carried_quantity: 0 })])), ["总体备件利用率", "--"]);
  assert.deepEqual(overall(normalize([row({ used_quantity: 3, carried_quantity: 1 })])), ["总体备件利用率", "300.00%"]);
});

test("normalizes mission reliability projection payload as per-sample wave rows for formal KPI and trend rendering", () => {
  const view = normalizeAnalysisProjectionPayload("mission_reliability", {
    projection_type: "mission_reliability",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: {
      mission_success_probability: 0.8,
      sortie_rate: 0.8125,
      target_met: true,
      period_completion_probability: 0.9225,
      period_duration_days: 2.125,
      result_fields: [
        { key: "sortie_rate", value: 0.8125, display_value: "0.813" },
        { key: "wave_success_rate", value: 0.8, display_value: "80%" },
        { key: "period_completion_probability", value: 0.9225, display_value: "92.3%" },
        { key: "period_duration_days", value: 2.125, display_value: "2.13 天" }
      ],
      total_samples: 3,
      successful_samples: 2,
      failed_samples: 1,
      valid_samples: 3,
      mission_wave_rows: [
        { sample_index: 0, sample_label: "样本 1", day_index: 1, wave_index: 1, wave_label: "第1天 第1波", mean_mission_success_rate: 0.96, mean_sortie_rate: 0.92 },
        { sample_index: 0, sample_label: "样本 1", day_index: 1, wave_index: 2, wave_label: "第1天 第2波", mean_mission_success_rate: 0.94, mean_sortie_rate: 0.91 },
        { sample_index: 1, sample_label: "样本 2", day_index: 1, wave_index: 1, wave_label: "第1天 第1波", mean_mission_success_rate: 0.86, mean_sortie_rate: 0.84 },
        { sample_index: 1, sample_label: "样本 2", day_index: 1, wave_index: 2, wave_label: "第1天 第2波", mean_mission_success_rate: 0.85, mean_sortie_rate: 0.83 }
      ]
    }
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.deepEqual(view.metrics, [
    ["出动架次率", "0.812"],
    ["波次成功率", "80%"],
    ["整周期任务可靠度", "92.2%"],
    ["任务周期", "2.12 天"],
    ["仿真总次数", "3"],
    ["成功次数", "2"]
  ]);
  assert.deepEqual(view.resultFields.map(({ key, displayValue }) => [key, displayValue]), [
    ["sortie_rate", "0.812"],
    ["wave_success_rate", "80%"],
    ["period_completion_probability", "92.2%"],
    ["period_duration_days", "2.12 天"]
  ]);
  assert.deepEqual(view.steepestDrop, {
    fromIndex: 2,
    toIndex: 3,
    fromTime: "第1天 第2波",
    toTime: "第1天 第1波",
    drop: 0.07999999999999996
  });
  assert.equal(view.periodCompletionProbability, 0.9225);
  assert.equal(view.periodDurationDays, 2.125);
  assert.equal(view.totalSamples, 3);
  assert.equal(view.successfulSamples, 2);
  assert.equal(view.failedSamples, 1);
  assert.deepEqual(view.rows.map((row) => [row.sequence, row.sampleIndex, row.sampleLabel, row.waveLabel, row.probability, row.sortieRate, row.state]), [
    [1, 0, "样本 1", "第1天 第1波", 0.96, 0.92, "满足"],
    [2, 0, "样本 1", "第1天 第2波", 0.94, 0.91, "满足"],
    [3, 1, "样本 2", "第1天 第1波", 0.86, 0.84, "满足"],
    [4, 1, "样本 2", "第1天 第2波", 0.85, 0.83, "满足"]
  ]);
});

test("mission reliability does not invent counts or per-sample rows when source detail is missing", () => {
  const view = normalizeAnalysisProjectionPayload("mission_reliability", {
    projection_type: "mission_reliability",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: {
      mission_success_probability: 0.8,
      sortie_rate: 0.75,
      period_completion_probability: 0.5,
      period_duration_days: 1,
      result_fields: [
        { key: "sortie_rate", value: 0.75, display_value: "0.750" },
        { key: "wave_success_rate", value: 0.8, display_value: "80%" },
        { key: "period_completion_probability", value: 0.5, display_value: "50%" },
        { key: "period_duration_days", value: 1, display_value: "1 天" }
      ],
      series: [{ mission_success_probability: 0.8, sortie_rate: 0.75 }]
    }
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.equal(view.totalSamples, null);
  assert.equal(view.successfulSamples, null);
  assert.deepEqual(view.metrics.slice(-2), [["仿真总次数", "不可用"], ["成功次数", "不可用"]]);
  assert.deepEqual(view.rows, []);
});

test("normalizes downtime factor projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("downtime_factors", {
    projection_type: "downtime_factors",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: [
      { factor: "failure", contribution: 0.4 },
      { factor: "spare_shortage", contribution: 0.35 },
      { factor: "resource_delay", contribution: 0.25 }
    ],
    anomaly_snapshots: [
      {
        snapshot_id: "downtime-run-ui-0001",
        simulation_time: 60,
        event_type: "spare_shortage",
        event_label: "备件短缺",
        result: "mission_delayed",
        support_activity_state: { active_jobs: 2, repair_backlog: 1, spare_fill_rate: 0.72 },
        job_node: { job_id: "job-7", task: "更换液压泵", state: "waiting" },
        frame_ref: { sample_index: 0, sample_step: 2, step: 2 }
      }
    ]
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.equal(view.metrics[0][1], "3 项");
  assert.equal(view.metrics[1][1], "装备故障");
  assert.equal(view.rows[0].label, "装备故障");
  assert.equal(view.rows[0].contributionLabel, "40%");
  assert.equal(view.snapshots.length, 1);
  assert.deepEqual(view.snapshots[0], {
    id: "downtime-run-ui-0001",
    simulationTime: 60,
    timeLabel: "DAY_1 01:00",
    eventType: "spare_shortage",
    eventLabel: "备件短缺",
    result: "已记录停机事件",
    activeJobs: 2,
    repairBacklog: 1,
    spareFillRate: 0.72,
    jobNodeId: "job-7",
    jobNodeLabel: "更换液压泵",
    jobState: "等待中",
    frameRef: "sample=0; sample_step=2; step=2",
    frameLabel: "第1个样本；采样步 2；仿真步 2"
  });
});

test("localizes fallback downtime job enums without leaking them into display or export snapshots", () => {
  const internalJobKind = "mission_delayed_by_spare_shortage";
  const view = normalizeAnalysisProjectionPayload("downtime_factors", {
    projection_type: "downtime_factors",
    run_id: "run-fallback-job",
    model_family: "aircraft_support_v1",
    data: [{ factor: "spare_shortage", contribution: 1 }],
    anomaly_snapshots: [{
      snapshot_id: "downtime-fallback-job",
      simulation_time: 75,
      event_type: "spare_shortage",
      result: "mission_delayed_by_spare_shortage",
      support_activity_state: { active_jobs: 1, repair_backlog: 0, spare_fill_rate: 0 },
      job_node: { job_id: "job-internal-1", kind: internalJobKind, state: "waiting" },
      frame_ref: { sample_index: 0, sample_step: 1, step: 1 }
    }]
  }, { runId: "run-fallback-job", modelFamily: "aircraft_support_v1" });

  assert.equal(view.snapshots[0].jobNodeLabel, "任务因备件短缺延误");
  assert.doesNotMatch(JSON.stringify(view.snapshots[0]), new RegExp(internalJobKind));
});

test("rejects mismatched or malformed projection payloads fail closed", () => {
  assert.throws(
    () => normalizeAnalysisProjectionPayload("carry_list", { projection_type: "spare_shortfall", data: [] }),
    /projection_type mismatch/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      constraints: { fill_rate: [0.85, 0.9, 0.95], utilization: [0.85, 0.9, 0.95] },
      truncation: { mode: "clamp_0_1", fields: ["fill_rate", "utilization", "shortage_probability"] },
      data: {}
    }),
    /data must be an array/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      constraints: { fill_rate: [0.85, 0.9, 0.95], utilization: [0.85, 0.9, 0.95] },
      truncation: { mode: "clamp_0_1", fields: ["fill_rate", "utilization", "shortage_probability"] },
      data: [{ spare_type: "engine", fill_rate: "bad", utilization: 0.6, shortage_probability: 0.2 }]
    }),
    /fill_rate must be a finite number/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      constraints: { fill_rate: [0.85, 0.9, 0.95], utilization: [0.85, 0.9, 0.95] },
      truncation: { mode: "clamp_0_1", fields: ["fill_rate", "utilization", "shortage_probability"] },
      data: [{ spare_type: "engine", fill_rate: 0.8, utilization: "bad", shortage_probability: 0.2 }]
    }),
    /utilization must be a finite number/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      constraints: { fill_rate: [0.85, 0.9], utilization: [0.85, 0.9, 0.95] },
      truncation: { mode: "clamp_0_1", fields: ["fill_rate", "utilization", "shortage_probability"] },
      data: [{ spare_type: "engine", fill_rate: 0.8, utilization: 0.6, shortage_probability: 0.2 }]
    }),
    /fill_rate constraints must be exactly 0.85, 0.9, 0.95/
  );
  for (const malformed of [null, "", true, []]) {
    assert.throws(
      () => normalizeAnalysisProjectionPayload("downtime_factors", {
        projection_type: "downtime_factors",
        data: [{ factor: "failure", contribution: malformed }]
      }),
      /contribution must be a finite number/
    );
  }
  assert.throws(
    () => normalizeAnalysisProjectionPayload("carry_list", {
      projection_type: "carry_list",
      data: [{ spare_type: "engine", recommended_multiplier: "bad" }]
    }),
    /recommended_multiplier must be a finite number/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("mission_reliability", {
      projection_type: "mission_reliability",
      data: { mission_success_probability: 0.9, sortie_rate: "bad" }
    }),
    /sortie_rate must be a finite number/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("downtime_factors", {
      projection_type: "downtime_factors",
      data: [{ factor: "failure", contribution: "bad" }]
    }),
    /contribution must be a finite number/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("downtime_factors", {
      projection_type: "downtime_factors",
      data: [{ factor: "failure", contribution: 1 }],
      anomaly_snapshots: [{ snapshot_id: "bad", event_type: "failure", support_activity_state: {} }]
    }),
    /anomaly snapshot simulation_time must be a finite number/
  );
  assert.equal(projectionArtifactKindForAnalysisType("mission_reliability"), "analysis_projection_mission_reliability");
});

test("rejects projection payloads whose traceability does not match the active run", () => {
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      model_family: "aircraft_support_v1",
      data: []
    }, { runId: "run-active", modelFamily: "aircraft_support_v1" }),
    /projection run_id is required/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      run_id: "run-other",
      model_family: "aircraft_support_v1",
      data: []
    }, { runId: "run-active", modelFamily: "aircraft_support_v1" }),
    /projection run_id mismatch/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      run_id: "run-active",
      model_family: "aviation_support",
      data: []
    }, { runId: "run-active", modelFamily: "aircraft_support_v1" }),
    /projection model_family mismatch/
  );
});
