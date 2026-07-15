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
      { spare_type: "engine", fill_rate: 0.81, utilization: 0.72, shortage_probability: 0.25, risk_level: "high" },
      { spare_type: "radar", fill_rate: 0.96, utilization: 0.88, shortage_probability: 0, risk_level: "low" }
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
      { spare_type: "engine", recommended_multiplier: 1.4, risk_level: "high" },
      { spare_type: "hydraulic", recommended_multiplier: 1.1, risk_level: "medium" }
    ]
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.deepEqual(view.metrics.slice(1), [
    ["携行备件数量", "3 件"],
    ["最高携行倍率", "1.40"],
    ["高优先级备件", "engine"]
  ]);
  assert.equal(view.objective, "minimize_carry_spares");
  assert.deepEqual(view.metrics[0], ["默认目标", "携行备件越少越好"]);
  assert.equal(view.rows[0].priority, "高");
  assert.equal(view.rows[0].qty, 2);
});

test("normalizes mission reliability projection payload as mission wave aggregates for formal KPI and trend rendering", () => {
  const view = normalizeAnalysisProjectionPayload("mission_reliability", {
    projection_type: "mission_reliability",
    run_id: "run-ui",
    model_family: "aircraft_support_v1",
    data: {
      mission_success_probability: 0.91,
      sortie_rate: 0.88,
      target_met: true,
      period_completion_probability: 2 / 3,
      period_duration_days: 21,
      total_samples: 3,
      successful_samples: 2,
      failed_samples: 1,
      valid_samples: 3,
      mission_wave_rows: [
        { day_index: 1, wave_index: 1, wave_label: "第1天 第1波", sample_count: 3, mean_mission_success_rate: 0.96, mean_sortie_rate: 0.92 },
        { day_index: 1, wave_index: 2, wave_label: "第1天 第2波", sample_count: 3, mean_mission_success_rate: 0.94, mean_sortie_rate: 0.91 },
        { day_index: 2, wave_index: 1, wave_label: "第2天 第1波", sample_count: 2, mean_mission_success_rate: 0.86, mean_sortie_rate: 0.84 },
        { day_index: 2, wave_index: 2, wave_label: "第2天 第2波", sample_count: 1, mean_mission_success_rate: 0.85, mean_sortie_rate: 0.83 }
      ]
    }
  }, { runId: "run-ui", modelFamily: "aircraft_support_v1" });

  assert.deepEqual(view.metrics, [
    ["任务成功概率", "0.91"],
    ["出动架次率", "0.88"],
    ["目标达成", "满足"],
    ["最大下降波次", "T2 → T3 (-0.08)"]
  ]);
  assert.deepEqual(view.steepestDrop, {
    fromIndex: 2,
    toIndex: 3,
    fromTime: "第1天 第2波",
    toTime: "第2天 第1波",
    drop: 0.07999999999999996
  });
  assert.equal(view.periodCompletionProbability, 2 / 3);
  assert.equal(view.periodDurationDays, 21);
  assert.equal(view.totalSamples, 3);
  assert.equal(view.successfulSamples, 2);
  assert.equal(view.failedSamples, 1);
  assert.deepEqual(view.rows.map((row) => [row.sequence, row.waveLabel, row.sampleCount, row.probability, row.sortieRate, row.state]), [
    [1, "第1天 第1波", 3, 0.96, 0.92, "满足"],
    [2, "第1天 第2波", 3, 0.94, 0.91, "满足"],
    [3, "第2天 第1波", 2, 0.86, 0.84, "满足"],
    [4, "第2天 第2波", 1, 0.85, 0.83, "满足"]
  ]);
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
    timeLabel: "60",
    eventType: "spare_shortage",
    eventLabel: "备件短缺",
    result: "mission_delayed",
    activeJobs: 2,
    repairBacklog: 1,
    spareFillRate: 0.72,
    jobNodeId: "job-7",
    jobNodeLabel: "更换液压泵",
    jobState: "waiting",
    frameRef: "sample=0; sample_step=2; step=2"
  });
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
