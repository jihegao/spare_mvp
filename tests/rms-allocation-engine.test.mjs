import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  createRmsEquipmentImportFixture,
  normalizeRmsEquipmentImportRows,
  publishRmsAllocation,
  rmsEquipmentRoots,
  selectRmsAllocationEquipmentRoot
} from "../front/rms-allocation-engine.mjs";

test("equal allocation derives MTBCF and MTBF from task reliability duration and critical failure ratio", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "equal";
  plan.targets.reliability.value = 0.95;
  plan.targets.taskDurationHours = 3;
  plan.targets.criticalFailureRatio = 0.8;

  const result = calculateRmsAllocation(plan, project);
  const expectedMtbcf = -3 / Math.log(0.95);

  assert.equal(result.status, "validated");
  assert.equal(result.nodeResults.length, project.equipmentNodes.filter((node) => node.parentId === "aircraft-root").length);
  assert.ok(Math.abs(result.verification.calculated.reliability - 0.95) < 1e-9);
  assert.ok(Math.abs(result.targetMetrics.mtbcfHours - expectedMtbcf) < 1e-9);
  assert.ok(Math.abs(result.targetMetrics.mtbfHours - expectedMtbcf * 0.8) < 1e-9);
  assert.equal("equivalentHours" in result.nodeResults[0], false);
  assert.equal("reliability" in result.nodeResults[0], false);
  assert.ok(result.nodeResults.every((row) => row.mtbcfHours > row.mtbfHours));
});

test("different running ratio produces different product intensity and MTBF requirements", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "equal";
  plan.targets.taskDurationHours = 3;

  const result = calculateRmsAllocation(plan, project);
  const longerExposure = result.nodeResults.find((row) => row.nodeId === "propulsion-system");
  const shorterExposure = result.nodeResults.find((row) => row.nodeId === "mission-computer");

  assert.equal(longerExposure.runningRatio, 1);
  assert.equal(shorterExposure.runningRatio, 0.65);
  assert.equal(shorterExposure.productIntensityHours, 1.95);
  assert.ok(longerExposure.productIntensityHours > shorterExposure.productIntensityHours);
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
  assert.ok(propulsion.mtbfHours < avionics.mtbfHours);
});

test("similar product allocation supports baselining a 16 model from 15 model data", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "similar";
  plan.methods.similarProduct = {
    sourceModel: "15 机型",
    targetModel: "16 机型",
    adjustmentFactor: 0.92
  };

  const result = calculateRmsAllocation(plan, project);
  const propulsion = result.nodeResults.find((row) => row.nodeId === "propulsion-system");
  const missionComputer = result.nodeResults.find((row) => row.nodeId === "mission-computer");

  assert.equal(result.method, "similar");
  assert.equal(result.similarProduct.sourceModel, "15 机型");
  assert.equal(result.similarProduct.targetModel, "16 机型");
  assert.ok(propulsion.riskBudget > missionComputer.riskBudget);
  assert.ok(propulsion.mtbfHours < missionComputer.mtbfHours);
});

test("RMS equipment table import creates an independent allocation project", () => {
  const sourceProject = createDemoRmsAllocationProject();
  const imported = normalizeRmsEquipmentImportRows(createRmsEquipmentImportFixture(), {
    baseProject: sourceProject
  });

  assert.notEqual(imported, sourceProject);
  assert.equal(sourceProject.rootId, "aircraft-root");
  assert.equal(sourceProject.equipmentNodes.some((node) => node.id === "j16-propulsion"), false);
  assert.equal(imported.rootId, "j16-root");
  assert.ok(imported.equipmentNodes.some((node) => node.id === "j16-propulsion"));
  assert.deepEqual(imported.reliabilityGroups[0].children, [
    "j16-propulsion",
    "j16-avionics",
    "j16-hydraulic",
    "j16-mission-computer"
  ]);
});

test("RMS allocation can select one equipment root from an imported equipment list", () => {
  const sourceProject = createDemoRmsAllocationProject();
  const imported = normalizeRmsEquipmentImportRows([
    { id: "j15-root", name: "15 机型", parentId: "", level: "装备", quantity: 1 },
    { id: "j15-engine", name: "15 发动机", parentId: "j15-root", level: "系统", mtbfHours: 760 },
    { id: "j16-root", name: "16 机型", parentId: "", level: "装备", quantity: 1 },
    { id: "j16-engine", name: "16 发动机", parentId: "j16-root", level: "系统", mtbfHours: 700 }
  ], {
    baseProject: sourceProject
  });
  const selected = selectRmsAllocationEquipmentRoot(imported, "j16-root");
  const plan = createDefaultRmsAllocationPlan(selected);

  const result = calculateRmsAllocation(plan, selected);

  assert.deepEqual(rmsEquipmentRoots(selected).map((node) => node.name), ["15 机型", "16 机型"]);
  assert.equal(selected.rootId, "j16-root");
  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), ["j16-engine"]);
});

test("publishing allocation writes only target RMS values", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  const published = publishRmsAllocation(project, result);
  const sourceNode = project.equipmentNodes.find((node) => node.id === "propulsion-system");
  const publishedNode = published.equipmentNodes.find((node) => node.id === "propulsion-system");

  assert.ok(publishedNode.rms.target.mtbfHours > 0);
  assert.ok(publishedNode.rms.target.mtbcfHours > 0);
  assert.equal("reliability" in publishedNode.rms.target, false);
  assert.equal(publishedNode.rms.target.allocationPlanId, plan.planId);
  assert.deepEqual(publishedNode.rms.prediction, sourceNode.rms.prediction);
  assert.deepEqual(publishedNode.rms.actual, sourceNode.rms.actual);
});
