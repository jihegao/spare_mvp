import assert from "node:assert/strict";
import test from "node:test";

import {
  downtimeEventDescription,
  downtimeEventDisplayRow,
  downtimeFactorLabel,
  downtimeOperationalEventLabel,
  downtimeTaskLabel,
  formatDowntimeSimulationTime
} from "../front/downtime-analysis.mjs";

test("formats every downtime time with DAY_n HH:MM including boundaries and missing values", () => {
  assert.equal(formatDowntimeSimulationTime(0), "DAY_1 00:00");
  assert.equal(formatDowntimeSimulationTime(65), "DAY_1 01:05");
  assert.equal(formatDowntimeSimulationTime(1439), "DAY_1 23:59");
  assert.equal(formatDowntimeSimulationTime(1440), "DAY_2 00:00");
  assert.equal(formatDowntimeSimulationTime(3905), "DAY_3 17:05");
  for (const missing of [null, undefined, "", "invalid", Number.NaN]) {
    assert.equal(formatDowntimeSimulationTime(missing), "暂无时间");
  }
});

test("normalizes task and phase aliases without exposing internal identifiers", () => {
  const event = {
    taskId: "composite-day-cap-d1-w1",
    taskLabel: "昼间制空任务",
    phaseId: "repair_internal",
    phaseName: "修复性维修"
  };
  assert.equal(downtimeTaskLabel(event), "昼间制空任务；阶段：修复性维修");
  assert.equal(downtimeTaskLabel({ mission_id: "mission-internal", mission_phase: "repair" }), "任务名称未解析；阶段：修复性维修");
  assert.equal(downtimeTaskLabel({ mission_phase: "transport" }), "任务外事件；阶段：备件运输");
  assert.equal(downtimeTaskLabel({}), "不在任务阶段");
  assert.doesNotMatch(downtimeTaskLabel(event), /composite-day-cap|repair_internal/);
});

test("builds one Chinese display row shared by filtered details and export consumers", () => {
  const event = {
    factor: "failure",
    tail_number: "J15-101",
    aircraft_type: "J-15",
    mission_name: "昼间制空任务",
    mission_phase_name: "修复性维修",
    support_node_name: "甲板保障组",
    start_minute: 1470,
    end_minute: 1535,
    duration_minutes: 65,
    description: "unavailable_after_failure",
    details: {
      component_name: "液压泵",
      failure_mode: "random_failure",
      failure_minute: 1465,
      repair_completed_minute: 1535
    }
  };

  const row = downtimeEventDisplayRow(event);
  assert.equal(row.factorLabel, "装备故障");
  assert.equal(row.taskPhaseLabel, "昼间制空任务；阶段：修复性维修");
  assert.equal(row.startTimeLabel, "DAY_2 00:30");
  assert.equal(row.endTimeLabel, "DAY_2 01:35");
  assert.equal(row.description, "飞机J15-101发生装备故障并形成停机维修时段");
  assert.deepEqual(row.specificDetails, [
    ["故障部件", "液压泵"],
    ["故障发生", "DAY_2 00:25"],
    ["维修方式", "维修方式未记录"],
    ["修复完成", "DAY_2 01:35"]
  ]);
  assert.doesNotMatch(JSON.stringify(row), /unavailable_after_failure|random_failure|failure_mode|故障模式/);
});

test("uses stable Chinese fallbacks for unknown event codes", () => {
  assert.equal(downtimeFactorLabel("private_factor_code"), "其他停机因素");
  assert.equal(downtimeEventDescription({ event_type: "private_event", tail_number: "A-1" }), "飞机A-1记录到未识别的停机事件");
  assert.equal(downtimeOperationalEventLabel("aircraft_failed"), "整机故障发生");
  assert.equal(downtimeOperationalEventLabel("repair_started"), "维修开始");
  assert.equal(downtimeOperationalEventLabel("resource_waiting"), "等待保障资源");
  assert.equal(downtimeOperationalEventLabel("transport_dispatched"), "备件运输开始");
  assert.equal(downtimeOperationalEventLabel("repair_completed"), "修复完成");
  assert.equal(downtimeOperationalEventLabel("mission_resumed"), "任务恢复");
  assert.equal(downtimeOperationalEventLabel("private_event"), "未识别的停机事件");
});

test("displays canonical sample identity and segment-end state without inventing completion", () => {
  const row = downtimeEventDisplayRow({
    sample_index: 2,
    seed: 1203,
    tail_number: "J15-203",
    factor: "spare_shortage",
    status: "unresolved",
    status_label: "未修复·仍等待备件",
    end_reason: "simulation_cutoff",
    end_minute: 61920,
    details: {
      spare_name: "动力装置",
      shortage_reason_code: "organization_no_available_supplier",
      shortage_reason_label: "供应组织无可用库存",
      repair_completed_minute: null,
      wait_end_minute: null,
      arrival_minute: null
    }
  });
  assert.equal(row.sampleIndex, 2);
  assert.equal(row.sampleLabel, "样本 3");
  assert.equal(row.seed, 1203);
  assert.equal(row.tailNumber, "J15-203");
  assert.equal(row.status, "unresolved");
  assert.equal(row.statusLabel, "未修复·仍等待备件");
  assert.equal(row.endTimeLabel, "仿真截止：DAY_44 00:00");
  assert.deepEqual(row.specificDetails.slice(4), [
    ["短缺原因", "供应组织无可用库存"],
    ["到货/等待结束", "暂无时间"]
  ]);
});

test("uses the executed maintenance method instead of assuming an LRU replacement", () => {
  const row = downtimeEventDisplayRow({
    factor: "failure",
    mission_name: "昼间制空任务",
    mission_phase_name: "LRU 自动换件",
    details: {
      component_name: "动力装置",
      maintenance_method: "non_replacement",
      maintenance_method_label: "原位维修"
    }
  });
  assert.equal(row.taskPhaseLabel, "昼间制空任务；阶段：原位维修");
  assert.deepEqual(row.specificDetails[2], ["维修方式", "原位维修"]);
});

test("does not synthesize sample one from absent or boolean sample identifiers", () => {
  for (const value of [null, undefined, "", "  ", false, true]) {
    assert.equal(downtimeEventDisplayRow({ sample_index: value }).sampleLabel, "样本未记录");
  }
  assert.equal(downtimeEventDisplayRow({ sample_index: "0" }).sampleLabel, "样本 1");
});
