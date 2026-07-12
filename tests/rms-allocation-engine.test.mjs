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
  rmsEquipmentSubtree,
  selectRmsAllocationEquipmentRoot
} from "../front/rms-allocation-engine.mjs";

test("equal allocation derives reliability allocation from direct equipment MTBF", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "equal";
  plan.targets.taskDurationHours = 3;
  plan.targets.mtbfHours = 1000;

  const result = calculateRmsAllocation(plan, project);
  const expectedReliability = Math.exp(-3 / 1000);

  assert.equal(result.status, "validated");
  assert.equal(result.nodeResults.length, project.equipmentNodes.filter((node) => node.parentId === "aircraft-root").length);
  assert.ok(Math.abs(result.verification.calculated.reliability - expectedReliability) < 1e-9);
  assert.equal(result.targetMetrics.mtbcfHours, 1000);
  assert.equal(result.targetMetrics.mtbfHours, 1000);
  assert.equal("equivalentHours" in result.nodeResults[0], false);
  assert.equal("reliability" in result.nodeResults[0], false);
  assert.ok(result.nodeResults.every((row) => row.mtbcfHours === row.mtbfHours));
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

test("similar product allocation supports baselining F16 from F15 data", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "similar";
  plan.methods.similarProduct = {
    sourceModel: "F15",
    targetModel: "F16",
    adjustmentFactor: 0.92
  };

  const result = calculateRmsAllocation(plan, project);
  const propulsion = result.nodeResults.find((row) => row.nodeId === "propulsion-system");
  const missionComputer = result.nodeResults.find((row) => row.nodeId === "mission-computer");

  assert.equal(result.method, "similar");
  assert.equal(result.similarProduct.sourceModel, "F15");
  assert.equal(result.similarProduct.targetModel, "F16");
  assert.ok(propulsion.riskBudget > missionComputer.riskBudget);
  assert.ok(propulsion.mtbfHours < missionComputer.mtbfHours);
});

test("demo RMS project includes F15 F16 and F18 aircraft models for manual workbench testing", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.reliability = "similar";

  const result = calculateRmsAllocation(plan, project);

  assert.deepEqual(rmsEquipmentRoots(project).map((node) => node.name), ["F16", "F15", "F18"]);
  assert.equal(project.rootId, "aircraft-root");
  assert.equal(plan.methods.similarProduct.sourceModel, "F15");
  assert.equal(plan.methods.similarProduct.targetModel, "F16");
  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), [
    "propulsion-system",
    "avionics-system",
    "hydraulic-system",
    "mission-computer"
  ]);
});

test("RMS equipment table import creates an independent allocation project", () => {
  const sourceProject = createDemoRmsAllocationProject();
  const imported = normalizeRmsEquipmentImportRows(createRmsEquipmentImportFixture(), {
    baseProject: sourceProject
  });

  assert.notEqual(imported, sourceProject);
  assert.equal(sourceProject.rootId, "aircraft-root");
  assert.equal(sourceProject.equipmentNodes.some((node) => node.id === "f16-propulsion"), false);
  assert.equal(imported.rootId, "f16-root");
  assert.ok(imported.equipmentNodes.some((node) => node.id === "f16-propulsion"));
  assert.deepEqual(imported.reliabilityGroups[0].children, [
    "f16-propulsion",
    "f16-avionics",
    "f16-hydraulic",
    "f16-mission-computer"
  ]);
  assert.deepEqual(rmsEquipmentRoots(imported).map((node) => node.name), ["F16", "F15", "F18"]);
});

test("RMS allocation can select one equipment root from an imported equipment list", () => {
  const sourceProject = createDemoRmsAllocationProject();
  const imported = normalizeRmsEquipmentImportRows([
    { id: "f15-root", name: "F15", parentId: "", level: "装备", quantity: 1 },
    { id: "f15-engine", name: "F15 发动机", parentId: "f15-root", level: "系统", mtbfHours: 760 },
    { id: "f16-root", name: "F16", parentId: "", level: "装备", quantity: 1 },
    { id: "f16-engine", name: "F16 发动机", parentId: "f16-root", level: "系统", mtbfHours: 700 },
    { id: "f18-root", name: "F18", parentId: "", level: "装备", quantity: 1 },
    { id: "f18-engine", name: "F18 发动机", parentId: "f18-root", level: "系统", mtbfHours: 820 }
  ], {
    baseProject: sourceProject
  });
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");
  const plan = createDefaultRmsAllocationPlan(selected);

  const result = calculateRmsAllocation(plan, selected);

  assert.deepEqual(rmsEquipmentRoots(selected).map((node) => node.name), ["F15", "F16", "F18"]);
  assert.equal(selected.rootId, "f16-root");
  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), ["f16-engine"]);
});

test("similar product allocation can reference another imported aircraft model", () => {
  const imported = normalizeRmsEquipmentImportRows([
    { id: "f15-root", name: "F15", parentId: "", level: "装备", quantity: 1 },
    { id: "f15-engine", name: "F15 发动机", parentId: "f15-root", level: "系统", mtbfHours: 2000 },
    { id: "f15-avionics", name: "F15 航电", parentId: "f15-root", level: "系统", mtbfHours: 800 },
    { id: "f16-root", name: "F16", parentId: "", level: "装备", quantity: 1 },
    {
      id: "f16-engine",
      name: "F16 发动机",
      parentId: "f16-root",
      level: "系统",
      mtbfHours: 400,
      similarProductModel: "F15",
      adjustmentFactor: 1
    },
    {
      id: "f16-avionics",
      name: "F16 航电",
      parentId: "f16-root",
      level: "系统",
      mtbfHours: 400,
      similarProductModel: "F15",
      adjustmentFactor: 1
    },
    { id: "f18-root", name: "F18", parentId: "", level: "装备", quantity: 1 },
    { id: "f18-engine", name: "F18 发动机", parentId: "f18-root", level: "系统", mtbfHours: 820 }
  ]);
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");
  const plan = createDefaultRmsAllocationPlan(selected);
  plan.methods.reliability = "similar";
  plan.methods.similarProduct = { sourceModel: "F15", targetModel: "F16", adjustmentFactor: 1 };

  const result = calculateRmsAllocation(plan, selected);

  assert.deepEqual(rmsEquipmentRoots(selected).map((node) => node.name), ["F15", "F16", "F18"]);
  assert.deepEqual(rmsEquipmentSubtree(selected).map((node) => node.id), ["f16-root", "f16-engine", "f16-avionics"]);
  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), ["f16-engine", "f16-avionics"]);
  assert.ok(
    result.nodeResults.find((row) => row.nodeId === "f16-avionics").riskBudget
      > result.nodeResults.find((row) => row.nodeId === "f16-engine").riskBudget
  );
});

test("similar product allocation can switch F16 baseline from F15 to F18", () => {
  const imported = normalizeRmsEquipmentImportRows([
    { id: "f15-root", name: "F15", parentId: "", level: "装备", quantity: 1 },
    { id: "f15-engine", name: "F15 发动机", parentId: "f15-root", level: "系统", mtbfHours: 2000 },
    { id: "f15-avionics", name: "F15 航电", parentId: "f15-root", level: "系统", mtbfHours: 800 },
    { id: "f16-root", name: "F16", parentId: "", level: "装备", quantity: 1 },
    { id: "f16-engine", name: "F16 发动机", parentId: "f16-root", level: "系统", mtbfHours: 400, adjustmentFactor: 1 },
    { id: "f16-avionics", name: "F16 航电", parentId: "f16-root", level: "系统", mtbfHours: 400, adjustmentFactor: 1 },
    { id: "f18-root", name: "F18", parentId: "", level: "装备", quantity: 1 },
    { id: "f18-engine", name: "F18 发动机", parentId: "f18-root", level: "系统", mtbfHours: 820 },
    { id: "f18-avionics", name: "F18 航电", parentId: "f18-root", level: "系统", mtbfHours: 1180 }
  ]);
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");
  const plan = createDefaultRmsAllocationPlan(selected);
  plan.methods.reliability = "similar";
  plan.methods.similarProduct = { sourceModel: "F18", targetModel: "F16", adjustmentFactor: 1 };

  const result = calculateRmsAllocation(plan, selected);

  assert.equal(result.similarProduct.sourceModel, "F18");
  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), ["f16-engine", "f16-avionics"]);
  assert.ok(
    result.nodeResults.find((row) => row.nodeId === "f16-engine").riskBudget
      > result.nodeResults.find((row) => row.nodeId === "f16-avionics").riskBudget
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
  assert.ok(publishedNode.rms.target.mtbcfHours > 0);
  assert.equal("reliability" in publishedNode.rms.target, false);
  assert.equal(publishedNode.rms.target.allocationPlanId, plan.planId);
  assert.deepEqual(publishedNode.rms.prediction, sourceNode.rms.prediction);
  assert.deepEqual(publishedNode.rms.actual, sourceNode.rms.actual);
});
