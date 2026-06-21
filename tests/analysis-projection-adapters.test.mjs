import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAnalysisProjectionPayload,
  projectionArtifactKindForAnalysisType
} from "../front/analysis-projection-adapters.mjs";

test("normalizes spare shortfall projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("spare_shortfall", {
    projection_type: "spare_shortfall",
    base_artifact_id: "monte_carlo_base-run-ui",
    data: [
      { spare_type: "engine", fill_rate: 0.81, shortage_probability: 0.25, risk_level: "high" },
      { spare_type: "radar", fill_rate: 0.96, shortage_probability: 0, risk_level: "low" }
    ]
  });

  assert.equal(view.analysisType, "spare_shortfall");
  assert.equal(view.formal, true);
  assert.deepEqual(view.metrics, [
    ["短板备件", "1 项"],
    ["最低备件满足率", "0.81"],
    ["最高短缺概率", "25%"],
    ["建议优先补充", "engine"]
  ]);
  assert.equal(view.rows[0].name, "engine");
  assert.equal(view.rows[0].level, "严重");
});

test("normalizes carry list projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("carry_list", {
    projection_type: "carry_list",
    data: [
      { spare_type: "engine", recommended_multiplier: 1.4, risk_level: "high" },
      { spare_type: "hydraulic", recommended_multiplier: 1.1, risk_level: "medium" }
    ]
  });

  assert.deepEqual(view.metrics.slice(1), [
    ["携行备件数量", "3 件"],
    ["最高携行倍率", "1.40"],
    ["高优先级备件", "engine"]
  ]);
  assert.equal(view.rows[0].priority, "高");
  assert.equal(view.rows[0].qty, 2);
});

test("normalizes mission reliability projection payload for formal KPI and trend rendering", () => {
  const view = normalizeAnalysisProjectionPayload("mission_reliability", {
    projection_type: "mission_reliability",
    data: {
      mission_success_probability: 0.91,
      sortie_rate: 0.88,
      target_met: true
    }
  });

  assert.deepEqual(view.metrics, [
    ["任务成功概率", "0.91"],
    ["出动架次率", "0.88"],
    ["目标达成", "满足"],
    ["projection payload", "mission_reliability"]
  ]);
  assert.equal(view.rows[0].state, "满足");
});

test("normalizes downtime factor projection payload for formal KPI and table rendering", () => {
  const view = normalizeAnalysisProjectionPayload("downtime_factors", {
    projection_type: "downtime_factors",
    data: [
      { factor: "failure", contribution: 0.4 },
      { factor: "spare_shortage", contribution: 0.35 },
      { factor: "resource_delay", contribution: 0.25 }
    ]
  });

  assert.equal(view.metrics[0][1], "3 项");
  assert.equal(view.metrics[1][1], "装备故障");
  assert.equal(view.rows[0].label, "装备故障");
  assert.equal(view.rows[0].contributionLabel, "40%");
});

test("rejects mismatched or malformed projection payloads fail closed", () => {
  assert.throws(
    () => normalizeAnalysisProjectionPayload("carry_list", { projection_type: "spare_shortfall", data: [] }),
    /projection_type mismatch/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", { projection_type: "spare_shortfall", data: {} }),
    /data must be an array/
  );
  assert.throws(
    () => normalizeAnalysisProjectionPayload("spare_shortfall", {
      projection_type: "spare_shortfall",
      data: [{ spare_type: "engine", fill_rate: "bad", shortage_probability: 0.2 }]
    }),
    /fill_rate must be a finite number/
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
  assert.equal(projectionArtifactKindForAnalysisType("mission_reliability"), "analysis_projection_mission_reliability");
});
