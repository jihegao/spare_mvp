import assert from "node:assert/strict";
import test from "node:test";

import {
  AVIATION_SUPPORT_DEMO_STATE,
  buildAviationSupportObjectGraph,
  normalizeAviationSupportState
} from "../front/aviation-support-state.mjs";

const rawState = {
  snapshot: {
    elapsed_hours: 3,
    aircraft_count: 2,
    available_aircraft: 1,
    flying_aircraft: 1,
    completed_sorties: 1,
    planned_sorties: 2,
    sortie_completion_rate: 0.5,
    avg_departure_delay: 4,
    active_jobs: 1,
    waiting_jobs: 0,
    spare_stock_total: 8
  },
  aircraft: [
    { tail_number: "AC-01", type: "J-15", state: "available", x: 0, y: 0, systems: [] },
    { tail_number: "AC-02", type: "J-15", state: "flying", x: 1, y: 0, systems: [] }
  ],
  resources: [{ name: "mechanic_team", display_name: "机务组", capacity: 2, in_use: 1, utilization: 0.4 }],
  spares: [{ part_id: "engine", name: "发动机备件", quantity: 3, consumed: 1, pending_quantity: 0 }],
  missions: [{ mission_id: 1, status: "launched", required_aircraft: 2, assigned_tail_numbers: ["AC-02"] }],
  jobs: [{ job_id: 1, tail_number: "AC-01", kind: "pre_support", state: "active", task: "通电检查", remaining: 10 }],
  support_tasks: [
    {
      task_id: "support-task-1",
      job_id: 1,
      tail_number: "AC-01",
      kind: "pre_support",
      state: "active",
      current_task: "通电检查",
      required_resources: { mechanic_team: 1 },
      required_spares: { engine: 1 }
    }
  ],
  metrics: [
    { metric_id: "sortie_completion_rate", name: "出动完成率", value: 0.5, unit: "ratio" },
    { metric_id: "available_aircraft", name: "可用飞机", value: 1, unit: "count" }
  ],
  object_relationships: [
    { from: "aircraft:AC-02", to: "mission:1", type: "assigned_to", label: "执行任务" },
    { from: "aircraft:AC-01", to: "support_task:support-task-1", type: "has_support_task", label: "生成保障作业" },
    { from: "support_task:support-task-1", to: "resource:mechanic_team", type: "uses_resource", label: "占用资源" },
    { from: "support_task:support-task-1", to: "spare:engine", type: "consumes_spare", label: "消耗备件" },
    { from: "mission:1", to: "metric:sortie_completion_rate", type: "observed_as", label: "采样指标" }
  ],
  events: [{ time: 30, event: "launch", message: "AC-02 出动" }]
};

test("normalizes aviation support visualization state for the frontend", () => {
  const normalized = normalizeAviationSupportState(rawState);

  assert.deepEqual(
    normalized.kpis.map((item) => item.key),
    ["sortie_completion_rate", "completed_sorties", "available_aircraft", "active_jobs", "spare_stock_total", "avg_departure_delay"]
  );
  assert.equal(normalized.aircraft.length, 2);
  assert.equal(normalized.resources[0].label, "机务组");
  assert.equal(normalized.spares[0].label, "发动机备件");
  assert.equal(normalized.missions[0].assignedCount, 1);
  assert.equal(normalized.jobs[0].task, "通电检查");
  assert.equal(normalized.events[0].message, "AC-02 出动");
});

test("ships a non-empty demo state frame for static inspection", () => {
  const normalized = normalizeAviationSupportState(AVIATION_SUPPORT_DEMO_STATE);
  assert.ok(normalized.aircraft.length >= 2);
  assert.ok(normalized.resources.length >= 3);
  assert.ok(normalized.spares.length >= 3);
  assert.ok(normalized.missions.length >= 1);
});

test("builds model-instance object graph from aviation support visualization_state", () => {
  const graph = buildAviationSupportObjectGraph(rawState);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeKeys = new Set(graph.edges.map((edge) => `${edge.from}:${edge.label}:${edge.to}`));

  for (const id of [
    "aircraft:AC-01",
    "mission:1",
    "resource:mechanic_team",
    "spare:engine",
    "support_task:support-task-1",
    "metric:sortie_completion_rate"
  ]) {
    assert.ok(nodeIds.has(id), id);
  }

  assert.ok(edgeKeys.has("aircraft:AC-02:执行任务:mission:1"));
  assert.ok(edgeKeys.has("aircraft:AC-01:生成保障作业:support_task:support-task-1"));
  assert.ok(edgeKeys.has("support_task:support-task-1:占用资源:resource:mechanic_team"));
  assert.ok(edgeKeys.has("support_task:support-task-1:消耗备件:spare:engine"));
  assert.ok(edgeKeys.has("mission:1:采样指标:metric:sortie_completion_rate"));
  assert.equal(graph.nodes.every((node) => node.group === "model-instance"), true);
  assert.equal(graph.nodes.every((node) => node.source.kind === "visualization_state"), true);
});
