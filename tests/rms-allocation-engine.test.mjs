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
  rmsBasicMissionOptions,
  rmsEquipmentRoots,
  rmsEquipmentSubtree,
  selectRmsAllocationEquipmentRoot
} from "../front/rms-allocation-engine.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

function assertRmsFormulaInvariants(result) {
  const activeRows = result.nodeResults.filter((row) => row.failureRate > 0);
  assert.ok(activeRows.length > 0);
  const rootRiskBudget = -Math.log(result.inputSnapshot.missionReliability);
  assert.ok(Math.abs(result.totals.riskBudget - rootRiskBudget) < 1e-9);
  assert.ok(Math.abs(result.totals.missionReliability - result.inputSnapshot.missionReliability) < 1e-9);
  const rowsByParent = result.nodeResults.reduce((groups, row) => {
    if (!groups.has(row.parentNodeId)) groups.set(row.parentNodeId, []);
    groups.get(row.parentNodeId).push(row);
    return groups;
  }, new Map());
  const rowsById = new Map(result.nodeResults.map((row) => [row.nodeId, row]));
  for (const [parentNodeId, children] of rowsByParent) {
    const activeChildren = children.filter((row) => row.status === "已分配");
    const expectedRisk = rowsById.get(parentNodeId)?.riskBudget ?? rootRiskBudget;
    assert.ok(Math.abs(children.reduce((sum, row) => sum + row.riskBudget, 0) - expectedRisk) < 1e-9);
    if (expectedRisk === 0) {
      assert.equal(activeChildren.length, 0);
      continue;
    }
    assert.ok(Math.abs(activeChildren.reduce((sum, row) => sum + row.localAllocationShare, 0) - 1) < 1e-9);
    const expectedMttr = rowsById.get(parentNodeId)?.mttrHours ?? result.inputSnapshot.mttrHours;
    const failureRateSum = activeChildren.reduce(
      (sum, row) => sum + row.installationCount * row.failureRate,
      0
    );
    const weightedMttr = activeChildren.reduce(
      (sum, row) => sum + row.installationCount * row.failureRate * row.mttrHours,
      0
    ) / failureRateSum;
    assert.ok(Math.abs(weightedMttr - expectedMttr) < 1e-9);
  }
  for (const row of activeRows) {
    const allocatedRisk = row.cumulativeInstallationCount
      * result.inputSnapshot.missionHours
      * row.runningRatio
      * row.failureRate;
    assert.ok(Math.abs(allocatedRisk - row.riskBudget) < 1e-9);
  }
}

function withBasicMission(project, overrides = {}) {
  project.basicMissions = [{
    id: "basic-test",
    name: "测试基本任务",
    equipmentType: "",
    taskDurationMinutes: 180,
    ...overrides
  }];
  return project;
}

test("equal allocation derives recursive risk from the selected basic mission and R(T)", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const result = calculateRmsAllocation(plan, project);

  assert.equal(plan.schemaVersion, "rms-allocation-plan-v6");
  assert.equal(plan.algorithmVersion, "rms-engine-7.0.0");
  assert.equal(plan.inputs.basicMissionId, "basic-mission-patrol");
  assert.equal("missionHours" in plan.inputs, false);
  assert.equal("mtbfHours" in plan.inputs, false);
  assert.equal(result.method, "equal");
  assert.equal(result.status, "calculated");
  assert.equal(result.source, "calculated");
  assert.equal(result.aircraftModel, "F16");
  assert.deepEqual(result.inputSnapshot, {
    basicMissionId: "basic-mission-patrol",
    basicMissionName: "近海巡逻基本任务",
    missionHours: 3,
    missionReliability: 0.95,
    mttrHours: 2
  });
  assert.equal(result.nodeResults.length, 4);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
  assert.ok(result.nodeResults.every((row) => row.localAllocationShare === 0.25));
  assertRmsFormulaInvariants(result);
  assert.ok(new Set(result.nodeResults.map((row) => row.mttrHours)).size > 1);
  for (const removedField of ["missionProfile", "missionExposure", "exposure"]) {
    assert.equal(removedField in result, false);
  }
  for (const row of result.nodeResults) {
    assert.deepEqual(Object.keys(row), [
      "nodeId", "nodeName", "parentNodeId", "level", "model", "installationCount", "cumulativeInstallationCount", "runningRatio", "failureRate", "mtbfHours", "localAllocationShare", "cumulativeAllocationShare", "riskBudget", "mttrHours", "verificationStatus", "status"
    ]);
  }
});

test("RMS inputs fail closed for missing basic mission, invalid R(T), and invalid MTTR", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  for (const [field, value, label] of [
    ["basicMissionId", "", "基本任务不能为空"],
    ["missionReliability", 0, "整机任务可靠度 R(T)必须大于 0"],
    ["missionReliability", 1, "整机任务可靠度 R(T)必须小于 1"],
    ["mttrHours", -0.01, "MTTR必须大于等于 0 h"]
  ]) {
    plan.inputs = { ...plan.inputs, [field]: value };
    assert.ok(rmsAllocationInputErrors(plan.inputs, project).includes(label));
    assert.throws(() => calculateRmsAllocation(plan, project), /RMS_INPUT_INVALID/);
    plan.inputs = { ...createDefaultRmsAllocationPlan(project).inputs };
  }
});

test("legacy RMS drafts migrate to the v6 selected-mission R(T) contract", () => {
  const migrated = normalizeRmsAllocationInputs({
    basicMissionId: "basic-mission-patrol",
    missionHours: 3,
    mtbfHours: 1000,
    mttrHours: 2
  }, createDemoRmsAllocationProject());

  assert.deepEqual(Object.keys(migrated), ["basicMissionId", "missionReliability", "mttrHours"]);
  assert.equal(migrated.basicMissionId, "basic-mission-patrol");
  assert.ok(Math.abs(migrated.missionReliability - Math.exp(-3 / 1000)) < 1e-12);
  assert.equal("missionHours" in migrated, false);
  assert.equal("mtbfHours" in migrated, false);
});

test("project equipment modeling is projected into isolated aircraft RMS roots", () => {
  const scenario = {
    project_id: "project-rms-aircraft",
    projectInfo: { name: "双机型项目" },
    equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-20"] },
    basicMissions: [
      { id: "j15-patrol", name: "J-15 巡逻", equipmentType: "J-15", taskDurationMinutes: 120 },
      { id: "j20-patrol", name: "J-20 巡逻", equipmentType: "J-20", taskDurationMinutes: 90 }
    ],
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
  assert.deepEqual(rmsBasicMissionOptions(j15, "J-15").map((mission) => mission.id), ["j15-patrol"]);
  assert.deepEqual(rmsBasicMissionOptions(j20, "J-20").map((mission) => mission.id), ["j20-patrol"]);
  assert.equal(calculateRmsAllocation(createDefaultRmsAllocationPlan(j15), j15).aircraftModel, "J-15");
});

test("RMS duration comes only from basicMissions and ignores large-cycle mission profiles", () => {
  const scenario = {
    project_id: "project-basic-task-only",
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    basicMissions: [{
      id: "basic-sortie",
      name: "单次出动",
      equipmentType: "J-15",
      taskDurationMinutes: 90
    }],
    missionProfile: {
      durationHours: 999,
      compositeTasks: [{ id: "composite-ignored", taskDurationMinutes: 600 }],
      periodicTasks: [{ id: "periodic-ignored", cycleDays: 30 }]
    },
    components: [{ id: "engine", aircraftModel: "J-15", name: "发动机", quantity: 1, runningRatio: 1 }]
  };
  const project = createRmsAllocationProjectForScenario(scenario, "J-15");
  const plan = createDefaultRmsAllocationPlan(project);
  const first = calculateRmsAllocation(plan, project);
  project.missionProfile.durationHours = 1;
  project.missionProfile.compositeTasks[0].taskDurationMinutes = 1;
  project.missionProfile.periodicTasks[0].cycleDays = 1;
  const second = calculateRmsAllocation(plan, project);

  assert.equal(first.inputSnapshot.basicMissionId, "basic-sortie");
  assert.equal(first.inputSnapshot.missionHours, 1.5);
  assert.deepEqual(second, first);
  assert.equal("exposure" in first, false);
});

test("basic mission duration materially scales node MTBF while R(T) stays fixed", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const baseline = calculateRmsAllocation(plan, project);
  project.basicMissions[0].taskDurationMinutes = 360;
  const doubled = calculateRmsAllocation(plan, project);

  assert.equal(baseline.inputSnapshot.missionHours, 3);
  assert.equal(doubled.inputSnapshot.missionHours, 6);
  for (const baselineRow of baseline.nodeResults) {
    const doubledRow = doubled.nodeResults.find((row) => row.nodeId === baselineRow.nodeId);
    assert.ok(Math.abs(doubledRow.mtbfHours - 2 * baselineRow.mtbfHours) < 1e-9);
    assert.ok(Math.abs(doubledRow.riskBudget - baselineRow.riskBudget) < 1e-12);
  }
});

test("RMS rejects missing, inapplicable, and non-positive-duration basic missions", () => {
  const project = createRmsAllocationProjectForScenario({
    project_id: "project-invalid-basic-task",
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    basicMissions: [
      { id: "wrong-model", name: "其他机型任务", equipmentType: "J-20", taskDurationMinutes: 60 },
      { id: "zero-duration", name: "零时长任务", equipmentType: "J-15", taskDurationMinutes: 0 }
    ],
    components: [{ id: "engine", aircraftModel: "J-15", name: "发动机", quantity: 1, runningRatio: 1 }]
  }, "J-15");
  const plan = createDefaultRmsAllocationPlan(project);

  plan.inputs.basicMissionId = "missing";
  assert.throws(() => calculateRmsAllocation(plan, project), /不存在或不适用于/);
  plan.inputs.basicMissionId = "wrong-model";
  assert.throws(() => calculateRmsAllocation(plan, project), /不存在或不适用于/);
  plan.inputs.basicMissionId = "zero-duration";
  assert.throws(() => calculateRmsAllocation(plan, project), /任务时长必须大于 0/);
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

test("recursive allocation reaches systems, subsystems, and LRUs with per-level conservation", () => {
  const project = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "递归整机", level: "装备", quantity: 1 },
    { id: "power", parentId: "root", name: "动力系统", level: "系统", quantity: 2, runningRatio: 1 },
    { id: "avionics", parentId: "root", name: "航电系统", level: "系统", quantity: 1, runningRatio: 0.8 },
    { id: "control", parentId: "power", name: "控制分系统", level: "分系统", quantity: 2, runningRatio: 0.75 },
    { id: "controller", parentId: "control", name: "控制器", level: "LRU", quantity: 3, runningRatio: 0.5 },
    { id: "sensor", parentId: "control", name: "传感器", level: "LRU", quantity: 1, runningRatio: 1 }
  ]));
  const result = calculateRmsAllocation(createDefaultRmsAllocationPlan(project), project);

  assert.deepEqual(result.nodeResults.map((row) => row.nodeId), [
    "power", "control", "controller", "sensor", "avionics"
  ]);
  assert.equal(result.nodeResults.find((row) => row.nodeId === "control").parentNodeId, "power");
  assert.equal(result.nodeResults.find((row) => row.nodeId === "controller").parentNodeId, "control");
  assert.equal(result.nodeResults.find((row) => row.nodeId === "controller").cumulativeInstallationCount, 12);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
  assertRmsFormulaInvariants(result);
});

test("proportional allocation uses imported installation count and running ratio", () => {
  const imported = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1 },
    { id: "engine", parentId: "root", name: "发动机", model: "E-1", level: "系统", 安装数: 2, 运行比: 1 },
    { id: "radar", parentId: "root", name: "雷达", model: "R-1", level: "系统", 安装数: 1, 运行比: 0.5 }
  ]));
  const plan = createDefaultRmsAllocationPlan(imported);
  plan.methods.allocation = "proportional";
  const result = calculateRmsAllocation(plan, imported);
  const engine = result.nodeResults.find((row) => row.nodeId === "engine");
  const radar = result.nodeResults.find((row) => row.nodeId === "radar");

  assert.equal(engine.model, "E-1");
  assert.equal(engine.installationCount, 2);
  assert.equal(radar.runningRatio, 0.5);
  assert.ok(engine.localAllocationShare > radar.localAllocationShare);
  assert.ok(engine.riskBudget > radar.riskBudget);
  assert.equal(engine.cumulativeInstallationCount, 2);
  assert.equal(radar.cumulativeInstallationCount, 1);
  assertRmsFormulaInvariants(result);
  assert.ok(Math.abs(result.totals.allocationShare - 1) < 1e-12);
});

test("equal repair difficulty still allocates different component MTTR by failure contribution", () => {
  const project = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1 },
    { id: "a", parentId: "root", name: "组件A", level: "LRU", quantity: 1, runningRatio: 1, repairDifficulty: 1 },
    { id: "b", parentId: "root", name: "组件B", level: "LRU", quantity: 2, runningRatio: 1, repairDifficulty: 1 }
  ]));
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.allocation = "proportional";
  const result = calculateRmsAllocation(plan, project);
  const componentA = result.nodeResults.find((row) => row.nodeId === "a");
  const componentB = result.nodeResults.find((row) => row.nodeId === "b");

  assert.equal(project.equipmentNodes.find((node) => node.id === "a").repairDifficulty, 1);
  assert.equal(project.equipmentNodes.find((node) => node.id === "b").repairDifficulty, 1);
  assert.ok(Math.abs(componentA.mttrHours - 3) < 1e-9);
  assert.ok(Math.abs(componentB.mttrHours - 1.5) < 1e-9);
  assert.notEqual(componentA.mttrHours, componentB.mttrHours);
  assertRmsFormulaInvariants(result);
});

test("changing installation count changes MTTR allocation with equal repair difficulty", () => {
  const project = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1 },
    { id: "a", parentId: "root", name: "组件A", level: "LRU", quantity: 1, runningRatio: 1, repairDifficulty: 1 },
    { id: "b", parentId: "root", name: "组件B", level: "LRU", quantity: 2, runningRatio: 1, repairDifficulty: 1 }
  ]));
  const plan = createDefaultRmsAllocationPlan(project);
  plan.methods.allocation = "proportional";
  const before = calculateRmsAllocation(plan, project);
  project.equipmentNodes.find((node) => node.id === "a").quantity = 2;
  const after = calculateRmsAllocation(plan, project);
  const beforeA = before.nodeResults.find((row) => row.nodeId === "a");
  const beforeB = before.nodeResults.find((row) => row.nodeId === "b");
  const afterA = after.nodeResults.find((row) => row.nodeId === "a");
  const afterB = after.nodeResults.find((row) => row.nodeId === "b");

  assert.ok(Math.abs(beforeA.mttrHours - 3) < 1e-9);
  assert.ok(Math.abs(beforeB.mttrHours - 1.5) < 1e-9);
  assert.ok(Math.abs(afterA.mttrHours - 2) < 1e-9);
  assert.ok(Math.abs(afterB.mttrHours - 2) < 1e-9);
  assert.notEqual(afterA.mttrHours, beforeA.mttrHours);
  assert.notEqual(afterB.mttrHours, beforeB.mttrHours);
  assertRmsFormulaInvariants(before);
  assertRmsFormulaInvariants(after);
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
    result.nodeResults.find((row) => row.nodeId === "f16-engine").localAllocationShare
      > result.nodeResults.find((row) => row.nodeId === "f16-radar").localAllocationShare
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
  const shareVectors = results.map((result) => result.nodeResults.map((row) => row.localAllocationShare));
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
  const emptyProject = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "空整机", level: "装备", quantity: 1, runningRatio: 1 }
  ]));
  assert.throws(
    () => calculateRmsAllocation(createDefaultRmsAllocationPlan(emptyProject), emptyProject),
    /RMS_ALLOCATION_EMPTY/
  );

  const zeroProject = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "零权重整机", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "a", name: "系统A", parentId: "root", level: "系统", quantity: 1, runningRatio: 0 },
    { id: "b", name: "系统B", parentId: "root", level: "系统", quantity: 2, runningRatio: 0 }
  ]));
  const plan = createDefaultRmsAllocationPlan(zeroProject);
  plan.methods.allocation = "proportional";
  assert.throws(() => calculateRmsAllocation(plan, zeroProject), /RMS_ALLOCATION_ZERO_WEIGHT/);
});

test("zero-running nodes do not consume risk budget or receive synthetic RMS metrics", () => {
  const project = withBasicMission(normalizeRmsEquipmentImportRows([
    { id: "root", name: "测试整机", level: "装备", quantity: 1, runningRatio: 1 },
    { id: "active", name: "活动系统", parentId: "root", level: "系统", quantity: 1, runningRatio: 1 },
    { id: "inactive", name: "停用系统", parentId: "root", level: "系统", quantity: 1, runningRatio: 0 }
  ]));
  const result = calculateRmsAllocation(createDefaultRmsAllocationPlan(project), project);
  const inactive = result.nodeResults.find((row) => row.nodeId === "inactive");

  assert.equal(inactive.localAllocationShare, 0);
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
  assert.deepEqual(failure.totals, {
    installationCount: 0,
    allocationShare: 0,
    riskBudget: 0,
    missionReliability: 0
  });
});
