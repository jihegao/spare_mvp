import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  createRmsAllocationProjectForScenario,
  createRmsAllocationFailureResult,
  createRmsEquipmentImportFixture,
  normalizeRmsEquipmentImportRows,
  normalizeRmsAllocationInputs,
  rmsAllocationInputErrors,
  rmsEquipmentRoots,
  rmsEquipmentSubtree,
  selectRmsAllocationEquipmentRoot
} from "../front/rms-allocation-engine.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

function assertRmsFormulaInvariants(result) {
  const activeRows = result.nodeResults.filter((row) => row.failureRate > 0);
  assert.ok(activeRows.length > 0);
  const allocatedEquipmentFailureRate = result.nodeResults.reduce(
    (sum, row) => sum + row.runningRatio * row.failureRate,
    0
  );
  assert.ok(Math.abs(allocatedEquipmentFailureRate - (1 / result.inputSnapshot.mtbfHours)) < 1e-9);
  const failureRateSum = activeRows.reduce((sum, row) => sum + row.failureRate, 0);
  const weightedMttr = activeRows.reduce(
    (sum, row) => sum + row.failureRate * row.mttrHours,
    0
  ) / failureRateSum;
  assert.ok(Math.abs(weightedMttr - result.inputSnapshot.mttrHours) < 1e-9);
}

test("equal allocation returns a normalized forward allocation contract", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  assert.equal(plan.schemaVersion, "rms-allocation-plan-v5");
  assert.equal(plan.algorithmVersion, "rms-engine-5.0.0");
  assert.equal("missionReliability" in plan.inputs, false);
  assert.equal(result.method, "equal");
  assert.equal(result.status, "calculated");
  assert.equal(result.aircraftModel, "F16");
  assert.deepEqual(result.inputSnapshot, plan.inputs);
  assert.equal(result.nodeResults.length, 4);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
  assert.ok(result.nodeResults.every((row) => row.allocationShare === 0.25));
  assertRmsFormulaInvariants(result);
  assert.notEqual(result.nodeResults[0].mtbfHours, plan.inputs.mtbfHours);
  assert.ok(new Set(result.nodeResults.map((row) => row.mttrHours)).size > 1);
  for (const removedField of ["targetMetrics", "verification", "exposure"]) {
    assert.equal(removedField in result, false);
  }
  for (const row of result.nodeResults) {
    assert.deepEqual(Object.keys(row), [
      "nodeId", "nodeName", "level", "model", "installationCount", "runningRatio", "failureRate", "mtbfHours", "allocationShare", "status", "mttrHours"
    ]);
  }
});

test("RMS inputs fail closed for required and range violations", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  for (const [field, value, label] of [
    ["missionHours", 0, "任务时长必须大于 0 h"],
    ["mtbfHours", "", "MTBF不能为空"],
    ["mtbfHours", 0, "MTBF必须大于 0 h"],
    ["mttrHours", -0.01, "MTTR必须大于等于 0 h"]
  ]) {
    plan.inputs = { ...plan.inputs, [field]: value };
    assert.ok(rmsAllocationInputErrors(plan.inputs).includes(label));
    assert.throws(() => calculateRmsAllocation(plan, project), /RMS_INPUT_INVALID/);
    plan.inputs = { ...createDefaultRmsAllocationPlan(project).inputs };
  }
});

test("legacy RMS drafts migrate to the v5 three-input contract", () => {
  const migrated = normalizeRmsAllocationInputs({
    missionReliability: 0.95,
    missionHours: 3,
    criticalFailureRatio: 0.2,
    mttrHours: 2
  });

  assert.deepEqual(Object.keys(migrated), ["missionHours", "mtbfHours", "mttrHours"]);
  assert.ok(Math.abs(migrated.mtbfHours - 11.697435) < 1e-6);
  assert.equal("missionReliability" in migrated, false);
  assert.equal("criticalFailureRatio" in migrated, false);
});

test("project equipment modeling is projected into isolated aircraft RMS roots", () => {
  const scenario = {
    project_id: "project-rms-aircraft",
    projectInfo: { name: "双机型项目" },
    equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-20"] },
    missionProfile: { name: "任务", durationHours: 2 },
    components: [
      { id: "engine-j15", aircraftModel: "J-15", name: "J-15 发动机", quantity: 2, runningRatio: 0.8 },
      { id: "radar-j20", aircraftModel: "J-20", name: "J-20 雷达", quantity: 1, runningRatio: 1 },
      { id: "shared-radio", name: "通用电台", quantity: 1, runningRatio: 0.5 }
    ]
  };
  const j15 = createRmsAllocationProjectForScenario(scenario, "J-15");
  const j20 = createRmsAllocationProjectForScenario(scenario, "J-20");

  assert.equal(j15.equipmentNodes.find((node) => node.id === j15.rootId)?.name, "J-15");
  assert.deepEqual(
    j15.equipmentNodes.filter((node) => node.parentId === j15.rootId).map((node) => node.name),
    ["J-15 发动机", "通用电台"]
  );
  assert.deepEqual(
    j20.equipmentNodes.filter((node) => node.parentId === j20.rootId).map((node) => node.name),
    ["J-20 雷达", "通用电台"]
  );
  assert.notEqual(j15.rootId, j20.rootId);
  assert.equal(calculateRmsAllocation(createDefaultRmsAllocationPlan(j15), j15).aircraftModel, "J-15");
});

test("legacy synthetic aircraft root is not projected as a self-referencing RMS node", () => {
  const scenario = {
    project_id: "project-case-1",
    projectInfo: { name: "案例1" },
    equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-35"] },
    components: [
      { id: "aircraft-root", name: "舰载机", quantity: 6 },
      { id: "j15-engine", parentId: "aircraft-root", aircraftModel: "J-15", name: "发动机", quantity: 2 },
      { id: "j15-control", parentId: "j15-engine", aircraftModel: "J-15", name: "发动机控制模块", quantity: 1 },
      { id: "j35-radar", parentId: "aircraft-root", aircraftModel: "J-35", name: "雷达", quantity: 1 }
    ]
  };

  const project = createRmsAllocationProjectForScenario(scenario, "J-15");

  assert.equal(project.equipmentNodes.filter((node) => node.id === project.rootId).length, 1);
  assert.equal(project.equipmentNodes.some((node) => node.id === node.parentId), false);
  assert.deepEqual(
    project.equipmentNodes.filter((node) => node.parentId === project.rootId).map((node) => node.name),
    ["发动机"]
  );
  assert.equal(
    project.equipmentNodes.find((node) => node.name === "发动机控制模块")?.parentId,
    "rms:J-15:j15-engine"
  );
});

test("rootless case-large components retain their hierarchy under each aircraft RMS root", () => {
  const scenario = {
    project_id: "project-case-large",
    projectInfo: { name: "案例-大" },
    equipment: { model: "J16", wholeMachineModels: ["J16", "J16D"] },
    components: [
      { id: "j16-structure", aircraftModel: "J16", name: "结构", quantity: 1 },
      { id: "j16-hydraulic", parentId: "j16-structure", aircraftModel: "J16", name: "液压系统", quantity: 1 },
      { id: "j16d-avionics", aircraftModel: "J16D", name: "航电系统", quantity: 1 }
    ]
  };

  const project = createRmsAllocationProjectForScenario(scenario, "J16");

  assert.deepEqual(
    project.equipmentNodes.filter((node) => node.parentId === project.rootId).map((node) => node.name),
    ["结构"]
  );
  assert.equal(
    project.equipmentNodes.find((node) => node.name === "液压系统")?.parentId,
    "rms:J16:j16-structure"
  );
  assert.equal(
    project.equipmentNodes.find((node) => node.name === "航电系统")?.parentId,
    "rms:J16D:aircraft-root"
  );
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
  assert.ok(engine.failureRate > radar.failureRate);
  assert.notEqual(engine.mtbfHours, radar.mtbfHours);
  assertRmsFormulaInvariants(result);
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
  assert.notEqual(
    result.nodeResults.find((row) => row.nodeId === "f16-engine").mtbfHours,
    result.nodeResults.find((row) => row.nodeId === "f16-radar").mtbfHours
  );
  assertRmsFormulaInvariants(result);
});

test("all three allocation rules produce rule-specific RMS results through the shared formula", () => {
  const project = selectRmsAllocationEquipmentRoot(createDemoRmsAllocationProject(), "aircraft-root");
  const results = ["equal", "proportional", "similar"].map((method) => {
    const plan = createDefaultRmsAllocationPlan(project);
    plan.methods.allocation = method;
    const result = calculateRmsAllocation(plan, project);
    assertRmsFormulaInvariants(result);
    return result;
  });
  const shareVectors = results.map((result) => result.nodeResults.map((row) => row.allocationShare));
  const mtbfVectors = results.map((result) => result.nodeResults.map((row) => row.mtbfHours));

  assert.notDeepEqual(shareVectors[0], shareVectors[1]);
  assert.notDeepEqual(shareVectors[0], shareVectors[2]);
  assert.notDeepEqual(shareVectors[1], shareVectors[2]);
  assert.notDeepEqual(mtbfVectors[0], mtbfVectors[1]);
  assert.notDeepEqual(mtbfVectors[0], mtbfVectors[2]);
  assert.notDeepEqual(mtbfVectors[1], mtbfVectors[2]);
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

test("zero-running nodes do not consume risk budget or receive synthetic RMS metrics", () => {
  const project = normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "active", name: "活动系统", parentId: "root", level: "系统", quantity: 1, runningRatio: 1 },
    { id: "inactive", name: "停用系统", parentId: "root", level: "系统", quantity: 1, runningRatio: 0 }
  ]);
  const result = calculateRmsAllocation(createDefaultRmsAllocationPlan(project), project);
  const inactive = result.nodeResults.find((row) => row.nodeId === "inactive");

  assert.equal(inactive.allocationShare, 0);
  assert.equal(inactive.failureRate, 0);
  assert.equal(inactive.mtbfHours, null);
  assert.equal(inactive.mttrHours, null);
  assert.equal(inactive.status, "未参与");
  assertRmsFormulaInvariants(result);
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
