import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  publishRmsAllocation
} from "../front/rms-allocation-engine.mjs";

test("equal allocation back-solves to the equipment reliability target", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "equal";
  plan.targets.reliability.value = 0.95;
  plan.targets.reliability.atHours = 3;

  const result = calculateRmsAllocation(plan, project);

  assert.equal(result.status, "validated");
  assert.equal(result.nodeResults.length, project.equipmentNodes.filter((node) => node.parentId === "aircraft-root").length);
  assert.ok(Math.abs(result.verification.calculated.reliability - 0.95) < 1e-9);
  assert.ok(result.nodeResults.every((row) => row.reliability > 0.98));
});

test("different mission exposure produces different MTBF requirements", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "equal";

  const result = calculateRmsAllocation(plan, project);
  const longerExposure = result.nodeResults.find((row) => row.nodeId === "propulsion-system");
  const shorterExposure = result.nodeResults.find((row) => row.nodeId === "mission-computer");

  assert.ok(longerExposure.equivalentHours > shorterExposure.equivalentHours);
  assert.ok(longerExposure.mtbfHours > shorterExposure.mtbfHours);
});

test("proportional allocation gives more risk budget to weaker predicted nodes", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "proportional";

  const result = calculateRmsAllocation(plan, project);
  const propulsion = result.nodeResults.find((row) => row.nodeId === "propulsion-system");
  const avionics = result.nodeResults.find((row) => row.nodeId === "avionics-system");

  assert.ok(propulsion.riskBudget > avionics.riskBudget);
  assert.ok(propulsion.reliability < avionics.reliability);
});

test("AGREE rejects redundant or non-series structures with an explicit diagnostic", () => {
  const project = createDemoRmsAllocationProject();
  project.reliabilityGroups[0].type = "k_of_n";
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "agree";

  assert.throws(
    () => calculateRmsAllocation(plan, project),
    /AGREE_REDUNDANCY_NOT_SUPPORTED/
  );
});

test("publishing allocation writes only target RMS values", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  const published = publishRmsAllocation(project, result);
  const sourceNode = project.equipmentNodes.find((node) => node.id === "propulsion-system");
  const publishedNode = published.equipmentNodes.find((node) => node.id === "propulsion-system");

  assert.ok(publishedNode.rms.target.mtbfHours > 0);
  assert.equal(publishedNode.rms.target.allocationPlanId, plan.planId);
  assert.deepEqual(publishedNode.rms.prediction, sourceNode.rms.prediction);
  assert.deepEqual(publishedNode.rms.actual, sourceNode.rms.actual);
});
