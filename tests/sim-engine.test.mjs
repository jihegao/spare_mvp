import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo,
  runSimulation,
  validateScenario
} from "../front/sim-engine.mjs";

function previewScenarioFixture() {
  const scenario = cloneScenario(defaultScenario);
  scenario.scenarioId = "preview-test";
  scenario.experiment = {
    name: "测试预览实验",
    steps: 48,
    samples: 24,
    seed: 20260621,
    parallelCores: 1,
    stopCondition: "测试结束"
  };
  scenario.missionProfile = {
    profileId: "MP-PREVIEW",
    profileType: "测试任务",
    repeatCycleHours: 6,
    endCondition: "完成测试波次",
    compositeTasks: [],
    periodicTasks: []
  };
  scenario.basicMissions = [{
    id: "bm-preview",
    missionId: "BM-PREVIEW",
    name: "测试任务",
    minRequiredSorties: 1
  }];
  scenario.combatUnit = {
    groupName: "测试编队",
    requiredCount: 1,
    members: []
  };
  scenario.airports = [{ id: "base", name: "测试机场", distanceToMissionKm: 100 }];
  scenario.equipment = {
    model: "TEST-AIRCRAFT",
    wholeMachineModels: ["TEST-AIRCRAFT"],
    quantity: 1,
    initialReady: 1,
    minRequiredSorties: 1
  };
  scenario.components = [{ id: "engine", name: "发动机", quantity: 1, failureRate: 0.02, mtbfHours: 50, spareType: "发动机" }];
  scenario.supportNodes = [{ id: "node", name: "保障点", capacity: 1, equipmentCapacity: 1, inventory: { "发动机": 1 } }];
  scenario.supportActivities = [{ id: "repair", name: "维修", equipmentId: "engine", resourceId: "node", durationHours: 1, spareType: "发动机", spareQuantity: 1 }];
  scenario.reliabilityBlockDiagram = {
    nodes: [{ id: "engine", name: "发动机", type: "component", connectionType: "串联", failureRate: 0.02, mtbfHours: 50 }],
    edges: []
  };
  scenario.monteCarlo = {
    failureRates: [0.01, 0.02],
    spareMultipliers: [2],
    supportCapacities: [4, 5]
  };
  return scenario;
}

test("default scenario is a schema-valid empty preview shell", () => {
  assert.deepEqual(validateScenario(defaultScenario), []);
  assert.equal(defaultScenario.schema_version, undefined);
  assert.deepEqual(defaultScenario.airports, []);
  assert.equal("missionAreas" in defaultScenario, false);
  assert.deepEqual(defaultScenario.components, []);
  assert.deepEqual(defaultScenario.supportNodes, []);
  assert.deepEqual(defaultScenario.supportActivities, []);
  assert.deepEqual(defaultScenario.equipment.aircraftTypes, []);
  assert.deepEqual(defaultScenario.equipment.wholeMachineModels, []);
  assert.deepEqual(defaultScenario.missionProfile.compositeTasks, []);
  assert.deepEqual(defaultScenario.missionProfile.periodicTasks, []);
  assert.equal("analysisRequests" in defaultScenario, false);
  assert.equal(defaultScenario.experiment.samples, 4);
});

test("single simulation is reproducible for the same seed", () => {
  const scenario = previewScenarioFixture();
  const first = runSimulation(scenario, { seed: 77, steps: 36 });
  const second = runSimulation(scenario, { seed: 77, steps: 36 });
  assert.deepEqual(first.final, second.final);
  assert.deepEqual(first.spareShortfalls, second.spareShortfalls);
  assert.ok(first.timeline.length >= 36);
});

test("single simulation exposes required prototype metrics and analysis outputs", () => {
  const result = runSimulation(previewScenarioFixture(), { seed: 88, steps: 48, failureRate: 0.12, spareMultiplier: 0.5 });
  for (const metric of [
    "ready_rate",
    "mission_success_rate",
    "sortie_rate",
    "spare_fill_rate",
    "spare_utilization",
    "shortage_events",
    "repair_backlog",
    "mean_launch_time",
    "mean_recovery_time",
    "mean_turnaround_time"
  ]) {
    assert.equal(typeof result.final[metric], "number", metric);
  }
  assert.ok(result.spareShortfalls.length > 0, "spare shortfall analysis should be present");
  assert.ok(result.carryList.length > 0, "carry list analysis should be present");
  assert.ok(result.downtimeFactors.length >= 4, "downtime factor analysis should be present");
  assert.equal(typeof result.reliability.missionReliability, "number");
});

test("preview simulation falls back to mission duration after repeat cycle migration", () => {
  const scenario = previewScenarioFixture();
  scenario.missionProfile.durationHours = 6;
  delete scenario.missionProfile.repeatCycleHours;

  const result = runSimulation(scenario, { seed: 88, steps: 12 });

  assert.equal(result.timeline.length, 12);
  assert.ok(result.final.mission_success_rate >= 0);
});

test("monte carlo summarizes scenario groups and preserves decision outputs", () => {
  const result = runMonteCarlo(previewScenarioFixture(), {
    samples: 3,
    sweep: [
      { name: "baseline", failureRate: 0.06, spareMultiplier: 1, supportCapacity: 3, minRequiredSorties: 5 },
      { name: "stress", failureRate: 0.14, spareMultiplier: 0.5, supportCapacity: 2, minRequiredSorties: 6 }
    ]
  });
  assert.equal(result.runs.length, 6);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => typeof group.mission_success_rate.mean === "number"));
  assert.ok(result.spareShortfalls.length > 0);
  assert.ok(result.carryList.length > 0);
  assert.ok(result.downtimeFactors.length >= 4);
});

test("monte carlo default sweep is driven by scenario sweep arrays", () => {
  const scenario = previewScenarioFixture();
  scenario.experiment.samples = 1;
  scenario.monteCarlo = {
    failureRates: [0.01, 0.02],
    spareMultipliers: [2],
    supportCapacities: [4, 5]
  };
  const result = runMonteCarlo(scenario);
  assert.equal(result.runs.length, 4);
  assert.deepEqual(result.groups.map((group) => group.group), [
    "F0.01-S2-C4",
    "F0.01-S2-C5",
    "F0.02-S2-C4",
    "F0.02-S2-C5"
  ]);
});
