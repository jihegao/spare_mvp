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

test("default scenario includes airport and mission area attributes", () => {
  assert.deepEqual(defaultScenario.airports.map((airport) => airport.name), ["主基地机场", "前进保障机场"]);
  assert.equal(defaultScenario.airports[0].distanceToMissionKm, 320);
  assert.deepEqual(defaultScenario.missionAreas.map((area) => area.name), ["近海巡逻区", "远海警戒区"]);
  assert.equal(defaultScenario.missionAreas[0].distanceFromDepartureKm, 320);
});

test("default scenario includes combat unit member aircraft", () => {
  assert.equal(defaultScenario.combatUnit.groupName, "第一出动编队");
  assert.equal(defaultScenario.combatUnit.requiredCount, 5);
  assert.equal(defaultScenario.combatUnit.members.length, 8);
  assert.deepEqual(defaultScenario.combatUnit.members.slice(0, 2).map((member) => member.aircraftNo), ["A-01", "A-02"]);
});

test("default scenario includes basic mission modeling attributes", () => {
  assert.equal(defaultScenario.basicMission.name, "近海巡逻任务");
  assert.equal(defaultScenario.basicMission.taskNo, "BM-01");
  assert.equal(defaultScenario.basicMission.taskArea, "近海巡逻区");
  assert.equal(defaultScenario.basicMission.equipmentQuantity, 5);
  assert.equal(defaultScenario.basicMission.taskDurationMinutes, 180);
  assert.equal(defaultScenario.basicMission.supportActivityName, "飞行前保障");
});

test("default scenario includes mission profile composite and periodic tasks", () => {
  assert.equal(defaultScenario.missionProfile.compositeTasks[0].name, "昼间巡逻复合任务");
  assert.equal(defaultScenario.missionProfile.compositeTasks[0].taskItems[0].basicTaskName, "近海巡逻任务");
  assert.equal(defaultScenario.missionProfile.compositeTasks[0].taskItems[0].dailyRepeatCount, 2);
  assert.equal(defaultScenario.missionProfile.periodicTasks[0].name, "昼夜保障周期任务");
  assert.equal(defaultScenario.missionProfile.periodicTasks[0].repeatWeeks, 2);
  assert.equal(defaultScenario.missionProfile.periodicTasks[0].weekdayAssignments.monday, "composite-day-patrol");
});

test("default scenario includes equipment tree quantity and n-out-of-k attributes", () => {
  assert.equal(defaultScenario.components[0].quantity, 2);
  assert.equal(defaultScenario.components[0].kOutOfN.enabled, true);
  assert.equal(defaultScenario.components[0].kOutOfN.n, 2);
  assert.equal(defaultScenario.components[0].kOutOfN.k, 1);
  assert.equal(defaultScenario.components[1].parentId, "aircraft-root");
});

test("default scenario includes component RMS attributes", () => {
  for (const component of defaultScenario.components) {
    assert.equal(typeof component.rms.reliability, "number", `${component.id} reliability`);
    assert.equal(typeof component.rms.maintainability, "number", `${component.id} maintainability`);
    assert.equal(typeof component.rms.supportability, "number", `${component.id} supportability`);
    assert.equal(typeof component.rms.mttrHours, "number", `${component.id} mttr`);
    assert.equal(typeof component.rms.mldtHours, "number", `${component.id} mldt`);
    assert.equal(typeof component.rms.availability, "number", `${component.id} availability`);
  }
});

test("default scenario includes ship-front comprehensive support activity fields", () => {
  const activities = defaultScenario.supportActivities;
  assert.ok(activities.some((activity) => activity.planType === "直接准备方案"));
  assert.ok(activities.some((activity) => activity.planType === "预防性维修方案"));
  assert.ok(activities.some((activity) => activity.planType === "修复性维修方案"));

  const operations = activities.find((activity) => activity.planType === "直接准备方案");
  assert.equal(typeof operations.activityName, "string");
  assert.equal(typeof operations.maxWorkTimeRefMinutes, "number");
  assert.equal(typeof operations.simulationRunRule, "string");

  const preventive = activities.find((activity) => activity.planType === "预防性维修方案");
  assert.deepEqual(preventive.triggerModes, ["日历时间", "飞行小时", "起落次数"]);
  assert.equal(typeof preventive.plannedDowntimeHours, "number");

  const corrective = activities.find((activity) => activity.planType === "修复性维修方案");
  assert.equal(typeof corrective.meanRepairTimeMinutes, "number");
  assert.equal(typeof corrective.repairDistribution.distributionType, "string");
  assert.ok(Array.isArray(corrective.repairTypes));

  for (const activity of activities) {
    assert.ok(Array.isArray(activity.jobs), `${activity.id} jobs`);
    assert.ok(activity.jobs.length > 0, `${activity.id} job count`);
    for (const job of activity.jobs) {
      assert.equal(typeof job.activityCode, "string", `${activity.id} activityCode`);
      assert.equal(typeof job.workName, "string", `${activity.id} workName`);
      assert.ok(Array.isArray(job.predecessors), `${activity.id} predecessors`);
      assert.equal(typeof job.durationMinutes, "number", `${activity.id} durationMinutes`);
      assert.equal(typeof job.durationProfile.distributionType, "string", `${activity.id} durationProfile`);
      assert.equal(typeof job.personnel, "string", `${activity.id} personnel`);
      assert.equal(typeof job.servicePersonnel, "string", `${activity.id} servicePersonnel`);
      assert.equal(typeof job.facility, "string", `${activity.id} facility`);
      assert.equal(typeof job.equipment, "string", `${activity.id} equipment`);
      assert.equal(typeof job.ammunition, "string", `${activity.id} ammunition`);
      assert.equal(typeof job.spare, "string", `${activity.id} spare`);
    }
  }
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
