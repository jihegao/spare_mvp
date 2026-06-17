import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo,
  runSimulation,
  validateScenario
} from "../front/sim-engine.mjs";

test("default scenario passes structural validation", () => {
  assert.deepEqual(validateScenario(defaultScenario), []);
});

test("single simulation is reproducible for the same seed", () => {
  const scenario = cloneScenario(defaultScenario);
  const first = runSimulation(scenario, { seed: 77, steps: 36 });
  const second = runSimulation(scenario, { seed: 77, steps: 36 });
  assert.deepEqual(first.final, second.final);
  assert.deepEqual(first.spareShortfalls, second.spareShortfalls);
  assert.ok(first.timeline.length >= 36);
});

test("single simulation exposes required prototype metrics and analysis outputs", () => {
  const result = runSimulation(defaultScenario, { seed: 88, steps: 48, failureRate: 0.12, spareMultiplier: 0.5 });
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

test("monte carlo summarizes scenario groups and preserves decision outputs", () => {
  const result = runMonteCarlo(defaultScenario, {
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
  const scenario = cloneScenario(defaultScenario);
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
