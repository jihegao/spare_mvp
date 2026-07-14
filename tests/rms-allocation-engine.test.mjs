import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  createRmsAllocationFailureResult,
  createRmsEquipmentImportFixture,
  normalizeRmsEquipmentImportRows,
  rmsEquipmentRoots,
  rmsEquipmentSubtree,
  selectRmsAllocationEquipmentRoot
} from "../front/rms-allocation-engine.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

test("equal allocation returns a normalized forward allocation contract", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  assert.equal(plan.schemaVersion, "rms-allocation-plan-v2");
  assert.equal(result.method, "equal");
  assert.equal(result.status, "calculated");
  assert.equal(result.nodeResults.length, 4);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
  assert.ok(result.nodeResults.every((row) => row.allocationShare === 0.25));
  for (const removedField of ["targetMetrics", "verification", "exposure"]) {
    assert.equal(removedField in result, false);
  }
  for (const row of result.nodeResults) {
    assert.deepEqual(Object.keys(row), [
      "nodeId", "nodeName", "level", "model", "installationCount", "runningRatio", "allocationShare", "status"
    ]);
  }
});

test("proportional allocation uses imported installation count and running ratio", () => {
  const imported = normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1 },
    { id: "engine", parentId: "root", name: "发动机", model: "E-1", level: "系统", 安装数: 2, 运行比: 1 },
    { id: "radar", parentId: "root", name: "雷达", model: "R-1", level: "系统", 安装数: 1, 运行比: 0.5 }
  ]);
  const plan = createDefaultRmsAllocationPlan(imported);
  plan.methods.allocation = "proportional";
  const result = calculateRmsAllocation(plan, imported);
  const engine = result.nodeResults.find((row) => row.nodeId === "engine");
  const radar = result.nodeResults.find((row) => row.nodeId === "radar");

  assert.equal(engine.model, "E-1");
  assert.equal(engine.installationCount, 2);
  assert.equal(radar.runningRatio, 0.5);
  assert.ok(engine.allocationShare > radar.allocationShare);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
});

test("similar product allocation uses matching baseline installation exposure", () => {
  const imported = normalizeRmsEquipmentImportRows([
    { id: "f15-root", name: "F15", level: "装备", quantity: 1 },
    { id: "f15-engine", name: "F15 发动机", parentId: "f15-root", level: "系统", quantity: 2, runningRatio: 1 },
    { id: "f15-radar", name: "F15 雷达", parentId: "f15-root", level: "系统", quantity: 1, runningRatio: 0.5 },
    { id: "f16-root", name: "F16", level: "装备", quantity: 1 },
    { id: "f16-engine", name: "F16 发动机", parentId: "f16-root", level: "系统", quantity: 1, runningRatio: 1 },
    { id: "f16-radar", name: "F16 雷达", parentId: "f16-root", level: "系统", quantity: 1, runningRatio: 1 }
  ]);
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");
  const plan = createDefaultRmsAllocationPlan(selected);
  plan.methods.allocation = "similar";
  plan.methods.similarProduct = { sourceModel: "F15", targetModel: "F16" };
  const result = calculateRmsAllocation(plan, selected);

  assert.equal(result.similarProduct.sourceModel, "F15");
  assert.ok(
    result.nodeResults.find((row) => row.nodeId === "f16-engine").allocationShare
      > result.nodeResults.find((row) => row.nodeId === "f16-radar").allocationShare
  );
});

test("demo and fixture imports remain independent and selectable by equipment root", () => {
  const sourceProject = createDemoRmsAllocationProject();
  const imported = normalizeRmsEquipmentImportRows(createRmsEquipmentImportFixture(), { baseProject: sourceProject });
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");

  assert.notEqual(imported, sourceProject);
  assert.equal(sourceProject.rootId, "aircraft-root");
  assert.deepEqual(rmsEquipmentRoots(imported).map((node) => node.name), ["F16", "F15", "F18"]);
  assert.deepEqual(rmsEquipmentSubtree(selected).map((node) => node.id), [
    "f16-root", "f16-propulsion", "f16-avionics", "f16-hydraulic", "f16-mission-computer"
  ]);
  assert.deepEqual(calculateRmsAllocation(createDefaultRmsAllocationPlan(selected), selected).nodeResults.map((row) => row.nodeId), [
    "f16-propulsion", "f16-avionics", "f16-hydraulic", "f16-mission-computer"
  ]);
});

test("allocation fails closed for an empty equipment root and zero proportional weight", () => {
  const emptyProject = normalizeRmsEquipmentImportRows([
    { id: "root", name: "空整机", level: "装备", quantity: 1, runningRatio: 1 }
  ]);
  assert.throws(
    () => calculateRmsAllocation(createDefaultRmsAllocationPlan(emptyProject), emptyProject),
    /RMS_ALLOCATION_EMPTY/
  );

  const zeroProject = normalizeRmsEquipmentImportRows([
    { id: "root", name: "零权重整机", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "a", name: "系统A", parentId: "root", level: "系统", quantity: 1, runningRatio: 0 },
    { id: "b", name: "系统B", parentId: "root", level: "系统", quantity: 2, runningRatio: 0 }
  ]);
  const plan = createDefaultRmsAllocationPlan(zeroProject);
  plan.methods.allocation = "proportional";
  assert.throws(() => calculateRmsAllocation(plan, zeroProject), /RMS_ALLOCATION_ZERO_WEIGHT/);
});

test("similar allocation rejects missing source, target-as-source and unmatched nodes", () => {
  const imported = normalizeRmsEquipmentImportRows([
    { id: "f15-root", name: "F15", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "f15-engine", name: "F15 发动机", parentId: "f15-root", level: "系统", quantity: 2, runningRatio: 1 },
    { id: "f16-root", name: "F16", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "f16-engine", name: "F16 发动机", parentId: "f16-root", level: "系统", quantity: 1, runningRatio: 1 },
    { id: "f16-radar", name: "F16 雷达", parentId: "f16-root", level: "系统", quantity: 1, runningRatio: 1 }
  ]);
  const selected = selectRmsAllocationEquipmentRoot(imported, "f16-root");
  const plan = createDefaultRmsAllocationPlan(selected);
  plan.methods.allocation = "similar";

  plan.methods.similarProduct.sourceModel = "不存在";
  assert.throws(() => calculateRmsAllocation(plan, selected), /RMS_SIMILAR_SOURCE_MISSING/);
  plan.methods.similarProduct.sourceModel = "F16";
  assert.throws(() => calculateRmsAllocation(plan, selected), /RMS_SIMILAR_SOURCE_IS_TARGET/);
  plan.methods.similarProduct.sourceModel = "F15";
  assert.throws(() => calculateRmsAllocation(plan, selected), /RMS_SIMILAR_NODE_MISSING.*F16 雷达/);
});

test("installation imports reject missing or invalid counts and running ratios", () => {
  const root = { id: "root", name: "整机", level: "装备", quantity: 1, runningRatio: 1 };
  const child = { id: "child", name: "系统", parentId: "root", level: "系统", quantity: 1, runningRatio: 0.5 };
  for (const [field, value, pattern] of [
    ["quantity", 0, /INSTALLATION_INVALID/],
    ["quantity", 1.5, /INSTALLATION_INVALID/],
    ["quantity", "", /FIELD_MISSING/],
    ["runningRatio", -0.1, /RUNNING_RATIO_INVALID/],
    ["runningRatio", 1.1, /RUNNING_RATIO_INVALID/],
    ["runningRatio", "NaN", /RUNNING_RATIO_INVALID/],
    ["runningRatio", "", /FIELD_MISSING/]
  ]) {
    assert.throws(
      () => normalizeRmsEquipmentImportRows([root, { ...child, [field]: value }]),
      pattern,
      `${field}=${String(value)} should fail`
    );
  }
  assert.equal(
    normalizeRmsEquipmentImportRows([root, { ...child, runningRatio: 0 }]).equipmentNodes.find((node) => node.id === "child").missionUse.runningRatio,
    0
  );
});

test("default plan and successful allocation validate against the active schemas", async () => {
  const [planSchema, resultSchema] = await Promise.all([
    readFile(new URL("../contracts/rms_allocation_plan.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../contracts/rms_allocation_result.schema.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  assert.deepEqual(validateSchema(planSchema, plan), []);
  assert.deepEqual(validateSchema(resultSchema, result), []);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
  const failure = createRmsAllocationFailureResult(plan, new Error("测试失败"));
  assert.deepEqual(validateSchema(resultSchema, failure), []);
  assert.equal(failure.method, plan.methods.allocation);
  assert.deepEqual(failure.totals, { installationCount: 0, allocationShare: 0 });
});
