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

test("preserves mission-ready reservation identity for visualization", () => {
  const normalized = normalizeAviationSupportState({
    ...rawState,
    aircraft: [{
      tail_number: "AC-01",
      type: "J-15",
      state: "mission_ready",
      current_mission_id: "wave-0600",
      x: 0,
      y: 0,
      systems: []
    }]
  });

  assert.equal(normalized.aircraft[0].state, "mission_ready");
  assert.equal(normalized.aircraft[0].currentMissionId, "wave-0600");
});

test("hydrates compact failure tree templates into aircraft failure trees", () => {
  const normalized = normalizeAviationSupportState({
    ...rawState,
    failure_tree_templates: {
      "failure-tree-template-001": {
        tail_number: "AC-02",
        aircraft_type: "J-15",
        root_id: "whole-aircraft-root",
        nodes: [
          { id: "whole-aircraft-root", name: "AC-02 整机", parent_id: "", product_type: "整机", quantity: 1, k_out_of_n: {}, failure_threshold: 1 },
          { id: "engine", name: "发动机", parent_id: "whole-aircraft-root", product_type: "SRU", quantity: 2, k_out_of_n: { enabled: true, n: 2, k: 1 }, failure_threshold: 1 }
        ],
        edges: [{ from: "whole-aircraft-root", to: "engine" }]
      }
    },
    aircraft: [
      {
        tail_number: "AC-02",
        type: "J-15",
        state: "flying",
        failure_tree_ref: "failure-tree-template-001",
        failure_tree_state: {
          nodes: [{ id: "engine", failed: true, direct_failed: true, failed_children: 0, failure_time: 90 }],
          active_edges: ["engine"]
        }
      }
    ]
  });

  const tree = normalized.aircraft[0].failureTree;
  assert.equal(tree.rootId, "whole-aircraft-root");
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.nodes[1].name, "发动机");
  assert.equal(tree.nodes[1].failed, true);
  assert.equal(tree.nodes[1].directFailed, true);
  assert.equal(tree.nodes[1].failureTime, 90);
  assert.equal(tree.edges[0].active, true);
});

test("hydrates compact mission templates into frontend mission rows", () => {
  const normalized = normalizeAviationSupportState({
    ...rawState,
    mission_templates: {
      "mission-a": {
        mission_id: "mission-a",
        name: "昼间巡逻",
        planned_start: 60,
        required_aircraft: 2,
        required_aircraft_type: "J-15",
        task_category: "periodic",
        periodic_task_name: "昼夜周期",
        composite_task_name: "昼间复合",
        basic_task_name: "近海制空",
        group_name: "一中队",
        wave_index: 2,
        day_index: 3,
        duration_minutes: 120,
        preparation_start: 40
      }
    },
    missions: [
      {
        mission_id: "mission-a",
        actual_start: 66,
        return_time: 190,
        status: "completed",
        assigned_tail_numbers: ["AC-01", "AC-02"],
        delay_minutes: 6
      }
    ]
  });

  const mission = normalized.missions[0];
  assert.equal(mission.id, "mission-a");
  assert.equal(mission.dayIndex, 3);
  assert.equal(mission.waveIndex, 2);
  assert.equal(mission.basicTaskName, "近海制空");
  assert.equal(mission.requiredAircraftType, "J-15");
  assert.equal(mission.assignedCount, 2);
  assert.equal(mission.actualStart, 66);
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
