import assert from "node:assert/strict";
import test from "node:test";

import { AVIATION_SUPPORT_DEMO_STATE, normalizeAviationSupportState } from "../front/aviation-support-state.mjs";

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
