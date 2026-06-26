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
  assert.ok(propulsion.reliability < missionComputer.reliability);
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
  assert.equal(publishedNode.rms.target.allocationPlanId, plan.planId);
  assert.deepEqual(publishedNode.rms.prediction, sourceNode.rms.prediction);
  assert.deepEqual(publishedNode.rms.actual, sourceNode.rms.actual);
});
