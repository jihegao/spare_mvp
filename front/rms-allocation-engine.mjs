import { compileMissionExposure } from "./mission-exposure-compiler.mjs";
import { evaluateBottomUpReliability, seriesReliability } from "./rbd-evaluator.mjs";

export const RMS_ALLOCATION_ALGORITHM_VERSION = "rms-engine-1.1.0";

export function createDemoRmsAllocationProject() {
  return {
    projectId: "landbase-day-night",
    rootId: "aircraft-root",
    name: "陆基机群昼夜保障验证",
    missionProfile: {
      profileId: "MP-01",
      name: "近海巡逻任务剖面",
      missionHours: 3
    },
    missionPhases: [
      { id: "phase-standby", name: "待命", state: "idle", durationHours: 0.5 },
      { id: "phase-prep", name: "飞行前准备", state: "preparing", durationHours: 0.5 },
      { id: "phase-sortie", name: "出动执行", state: "active", durationHours: 3 },
      { id: "phase-recovery", name: "回收检查", state: "ready", durationHours: 0.5 }
    ],
    reliabilityGroups: [
      {
        id: "aircraft-series-group",
        parentNodeId: "aircraft-root",
        type: "series",
        children: ["propulsion-system", "avionics-system", "hydraulic-system", "mission-computer"]
      }
    ],
    equipmentNodes: [
      {
        id: "aircraft-root",
        name: "A-Prototype整机",
        level: "装备",
        parentId: null,
        quantity: 1,
        structure: "series",
        rms: { target: {}, prediction: { mtbfHours: 900 }, actual: { mtbfHours: 840, source: "field-data" } }
      },
      {
        id: "propulsion-system",
        name: "动力系统",
        level: "系统",
        parentId: "aircraft-root",
        quantity: 2,
        structure: "series",
        moduleCount: 8,
        importance: 0.95,
        complexity: 4,
        maturityRisk: 3,
        repairDifficulty: 1.35,
        supportDifficulty: 1.25,
        criticality: 1.2,
        missionUse: { dutyCycle: 1, environmentFactor: 1.2, loadFactor: 1.15 },
        rms: {
          target: {},
          prediction: { mtbfHours: 780, mttrHours: 2.2 },
          similar: { sourceModel: "15 机型", targetModel: "16 机型", mtbfHours: 760, adjustmentFactor: 0.92 },
          actual: { mtbfHours: 720, source: "field-data" }
        }
      },
      {
        id: "avionics-system",
        name: "航电系统",
        level: "系统",
        parentId: "aircraft-root",
        quantity: 2,
        structure: "series",
        moduleCount: 6,
        importance: 1.2,
        complexity: 3,
        maturityRisk: 2,
        repairDifficulty: 1.05,
        supportDifficulty: 1.1,
        criticality: 1.3,
        missionUse: { dutyCycle: 1, environmentFactor: 1.05, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1100, mttrHours: 1.8 },
          similar: { sourceModel: "15 机型", targetModel: "16 机型", mtbfHours: 1080, adjustmentFactor: 0.95 },
          actual: { mtbfHours: 980, source: "bench-test" }
        }
      },
      {
        id: "hydraulic-system",
        name: "液压系统",
        level: "分系统",
        parentId: "aircraft-root",
        quantity: 1,
        structure: "series",
        moduleCount: 4,
        importance: 0.9,
        complexity: 2,
        maturityRisk: 2,
        repairDifficulty: 1.15,
        supportDifficulty: 1.2,
        criticality: 1,
        missionUse: { dutyCycle: 0.85, environmentFactor: 1.1, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 940, mttrHours: 2 },
          similar: { sourceModel: "15 机型", targetModel: "16 机型", mtbfHours: 900, adjustmentFactor: 0.9 },
          actual: { mtbfHours: 900, source: "field-data" }
        }
      },
      {
        id: "mission-computer",
        name: "任务计算机LRU",
        level: "LRU",
        parentId: "aircraft-root",
        quantity: 1,
        structure: "series",
        moduleCount: 3,
        importance: 1.35,
        complexity: 3,
        maturityRisk: 1,
        repairDifficulty: 0.8,
        supportDifficulty: 0.7,
        criticality: 1.4,
        missionUse: { dutyCycle: 0.65, environmentFactor: 1, loadFactor: 0.9 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1450, mttrHours: 1.2 },
          similar: { sourceModel: "15 机型", targetModel: "16 机型", mtbfHours: 1320, adjustmentFactor: 0.96 },
          actual: { mtbfHours: 1300, source: "supplier" }
        }
      }
    ]
  };
}

export function createRmsEquipmentImportFixture() {
  return [
    { id: "j16-root", name: "16 机型整机", parentId: "", level: "装备", quantity: 1, structure: "series" },
    {
      id: "j16-propulsion",
      name: "16 机型动力系统",
      parentId: "j16-root",
      level: "系统",
      quantity: 2,
      structure: "series",
      mtbfHours: 700,
      mttrHours: 2.4,
      similarProductModel: "15 机型",
      targetProductModel: "16 机型",
      similarMtbfHours: 760,
      adjustmentFactor: 0.92,
      dutyCycle: 1,
      environmentFactor: 1.18,
      loadFactor: 1.12,
      repairDifficulty: 1.35,
      supportDifficulty: 1.25,
      criticality: 1.25
    },
    {
      id: "j16-avionics",
      name: "16 机型航电系统",
      parentId: "j16-root",
      level: "系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 1020,
      mttrHours: 1.9,
      similarProductModel: "15 机型",
      targetProductModel: "16 机型",
      similarMtbfHours: 1080,
      adjustmentFactor: 0.95,
      dutyCycle: 1,
      environmentFactor: 1.05,
      loadFactor: 1,
      repairDifficulty: 1.05,
      supportDifficulty: 1.1,
      criticality: 1.3
    },
    {
      id: "j16-hydraulic",
      name: "16 机型液压系统",
      parentId: "j16-root",
      level: "分系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 820,
      mttrHours: 2.1,
      similarProductModel: "15 机型",
      targetProductModel: "16 机型",
      similarMtbfHours: 900,
      adjustmentFactor: 0.9,
      dutyCycle: 0.86,
      environmentFactor: 1.1,
      loadFactor: 1,
      repairDifficulty: 1.15,
      supportDifficulty: 1.2,
      criticality: 1
    },
    {
      id: "j16-mission-computer",
      name: "16 机型任务计算机 LRU",
      parentId: "j16-root",
      level: "LRU",
      quantity: 1,
      structure: "series",
      mtbfHours: 1260,
      mttrHours: 1.4,
      similarProductModel: "15 机型",
      targetProductModel: "16 机型",
      similarMtbfHours: 1320,
      adjustmentFactor: 0.96,
      dutyCycle: 0.65,
      environmentFactor: 1,
      loadFactor: 0.9,
      repairDifficulty: 0.8,
      supportDifficulty: 0.7,
      criticality: 1.4
    }
  ];
}

export function normalizeRmsEquipmentImportRows(input, { baseProject = createDemoRmsAllocationProject() } = {}) {
  if (input?.equipmentNodes) {
    return normalizeRmsImportedProject(structuredClone(input), baseProject);
  }
  const rows = Array.isArray(input)
    ? input
    : input?.rows || input?.equipmentRows || input?.objects?.equipmentAssets || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("RMS_EQUIPMENT_IMPORT_EMPTY: 导入表格未包含装备节点");
  }

  const indexedRows = rows.map((row, index) => ({
    row,
    index,
    id: stableNodeId(pickText(row, ["id", "equipmentId", "nodeId", "节点ID", "装备ID"], `rms-node-${index + 1}`)),
    parentId: pickText(row, ["parentId", "parent_id", "父节点", "上级节点"], ""),
    level: pickText(row, ["level", "层级", "节点层级"], "")
  }));
  const explicitRoot = indexedRows.find((item) => !item.parentId && /装备|整机|root/i.test(item.level))
    || indexedRows.find((item) => !item.parentId);
  const rootId = explicitRoot?.id || "rms-import-root";
  const rootNode = explicitRoot
    ? importedNodeFromRow(explicitRoot.row, { id: rootId, parentId: null, fallbackLevel: "装备", index: explicitRoot.index })
    : {
        id: rootId,
        name: pickText(rows[0], ["targetProductModel", "目标机型"], "导入装备整机"),
        level: "装备",
        parentId: null,
        quantity: 1,
        structure: "series",
        rms: { target: {}, prediction: {} }
      };
  rootNode.parentId = null;

  const nodes = [rootNode];
  for (const item of indexedRows) {
    if (explicitRoot && item.index === explicitRoot.index) continue;
    const parentId = item.parentId ? stableNodeId(item.parentId) : null;
    nodes.push(importedNodeFromRow(item.row, {
      id: item.id,
      parentId,
      fallbackLevel: "系统",
      index: item.index
    }));
  }

  return normalizeRmsImportedProject({
    projectId: "rms-imported-equipment-tree",
    rootId,
    name: `${rootNode.name} RMS 指标分配`,
    missionProfile: structuredClone(baseProject.missionProfile),
    missionPhases: structuredClone(baseProject.missionPhases),
    equipmentNodes: nodes
  }, baseProject);
}

export function createDefaultRmsAllocationPlan(project = createDemoRmsAllocationProject()) {
  return {
    schemaVersion: "rms-allocation-plan-v1",
    planId: "RMS-PLAN-001",
    planVersion: 1,
    name: "近海巡逻任务RMS分配方案",
    status: "draft",
    projectId: project.projectId,
    algorithmVersion: RMS_ALLOCATION_ALGORITHM_VERSION,
    targets: {
      reliability: { value: 0.95, atHours: 3 },
      maintainability: { value: 0.9, withinHours: 2 },
      supportability: { value: 0.9, withinHours: 4 },
      mtbfHours: 900,
      mttrHours: 1.5,
      mldtHours: 2,
      inherentAvailability: 0.98,
      operationalAvailability: 0.96
    },
    methods: {
      reliability: "equal",
      proportional: {
        adjustmentFactor: 1
      },
      similarProduct: {
        sourceModel: project.equipmentNodes.find((node) => node.id === project.rootId)?.name || "15 机型",
        targetModel: "16 机型",
        adjustmentFactor: 0.92
      },
      maintainability: "repair_difficulty_weighted",
      supportability: "demand_weighted"
    },
    assumptions: [
      "当前 MVP 按整机根节点下的串联系统进行分配",
      "保障性目标作为 MLDT 设计目标，后续需要蒙特卡洛保障仿真验证"
    ]
  };
}

export function calculateRmsAllocation(plan, project) {
  const childNodes = project.equipmentNodes.filter((node) => node.parentId === project.rootId);
  const exposure = compileMissionExposure({ ...project, targets: plan.targets }, childNodes);
  const weights = reliabilityWeights(plan, project, childNodes, exposure);
  const equipmentRiskBudget = -Math.log(Number(plan.targets.reliability.value));
  const reliabilityRows = childNodes.map((node) => {
    const equivalentHours = exposure.totalsByNode[node.id]?.equivalentHours || Number(plan.targets.reliability.atHours);
    const riskBudget = equipmentRiskBudget * weights[node.id];
    const reliability = Math.exp(-riskBudget);
    const failureRate = riskBudget / equivalentHours;
    return {
      node,
      nodeId: node.id,
      nodeName: node.name,
      level: node.level,
      parentId: node.parentId,
      structure: node.structure || "series",
      quantity: node.quantity || 1,
      equivalentHours,
      riskWeight: weights[node.id],
      riskBudget,
      reliability,
      failureRate,
      mtbfHours: failureRate > 0 ? 1 / failureRate : Number.POSITIVE_INFINITY
    };
  });

  const nodeResults = attachMaintainabilityAndSupportability(reliabilityRows, plan);
  const calculatedReliability = evaluateBottomUpReliability(project, nodeResults);
  const calculatedMttr = weightedMean(nodeResults, "mttrHours", (row) => row.failureRate);
  const calculatedMldt = weightedMean(nodeResults, "mldtHours", (row) => row.supportDemand);
  const warnings = [
    ...exposure.warnings,
    ...methodWarnings(plan, project)
  ];
  const status = calculatedReliability + 1e-9 >= plan.targets.reliability.value
    && calculatedMttr <= plan.targets.mttrHours + 1e-9
    && calculatedMldt <= plan.targets.mldtHours + 1e-9
    ? "validated"
    : "calculated";

  return {
    ok: true,
    planId: plan.planId,
    planVersion: plan.planVersion,
    planStatus: "calculated",
    status,
    algorithmVersion: RMS_ALLOCATION_ALGORITHM_VERSION,
    method: plan.methods.reliability,
    similarProduct: plan.methods.similarProduct || null,
    exposure,
    nodeResults,
    verification: {
      equipmentTarget: {
        reliability: Number(plan.targets.reliability.value),
        mttrHours: Number(plan.targets.mttrHours),
        mldtHours: Number(plan.targets.mldtHours)
      },
      calculated: {
        reliability: calculatedReliability,
        mttrHours: calculatedMttr,
        mldtHours: calculatedMldt
      },
      margin: {
        reliability: calculatedReliability - Number(plan.targets.reliability.value),
        mttrHours: Number(plan.targets.mttrHours) - calculatedMttr,
        mldtHours: Number(plan.targets.mldtHours) - calculatedMldt
      },
      status
    },
    warnings,
    assumptions: plan.assumptions
  };
}

export function publishRmsAllocation(project, allocationResult) {
  const nextProject = structuredClone(project);
  for (const nodeResult of allocationResult.nodeResults) {
    const node = nextProject.equipmentNodes.find((item) => item.id === nodeResult.nodeId);
    if (!node) continue;
    node.rms ||= {};
    node.rms.target = {
      reliability: nodeResult.reliability,
      failureRate: nodeResult.failureRate,
      mtbfHours: nodeResult.mtbfHours,
      mttrHours: nodeResult.mttrHours,
      mldtHours: nodeResult.mldtHours,
      inherentAvailability: nodeResult.inherentAvailability,
      operationalAvailability: nodeResult.operationalAvailability,
      allocationPlanId: allocationResult.planId,
      allocationPlanVersion: allocationResult.planVersion
    };
  }
  return nextProject;
}

export function rmsEquipmentRoots(project) {
  return (project.equipmentNodes || []).filter((node) => !node.parentId);
}

export function selectRmsAllocationEquipmentRoot(project, rootId) {
  const nextProject = structuredClone(project);
  const roots = rmsEquipmentRoots(nextProject);
  const selectedRootId = roots.some((node) => node.id === rootId)
    ? rootId
    : (roots[0]?.id || nextProject.rootId);
  nextProject.rootId = selectedRootId;
  const children = nextProject.equipmentNodes
    .filter((node) => node.parentId === selectedRootId)
    .map((node) => node.id);
  const group = {
    id: `${selectedRootId}-series-group`,
    parentNodeId: selectedRootId,
    type: "series",
    children
  };
  nextProject.reliabilityGroups = [
    group,
    ...(nextProject.reliabilityGroups || []).filter((item) => item.parentNodeId !== selectedRootId)
  ];
  return nextProject;
}

function reliabilityWeights(plan, project, childNodes, exposure) {
  const raw = Object.fromEntries(childNodes.map((node) => [node.id, rawRiskFactor(plan, node, exposure)]));
  const sum = Object.values(raw).reduce((acc, value) => acc + value, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, value / sum]));
}

function rawRiskFactor(plan, node, exposure) {
  const equivalentHours = exposure.totalsByNode[node.id]?.equivalentHours || Number(plan.targets.reliability.atHours);
  if (plan.methods.reliability === "proportional") {
    const predictedMtbf = Number(node.rms?.prediction?.mtbfHours || node.failureModel?.baselineMtbfHours || 1000);
    const adjustmentFactor = Number(plan.methods?.proportional?.adjustmentFactor || 1);
    return equivalentHours / Math.max(predictedMtbf * adjustmentFactor, 1e-9);
  }
  if (plan.methods.reliability === "similar") {
    const planFactor = Number(plan.methods?.similarProduct?.adjustmentFactor || 1);
    const similarFactor = Number(node.rms?.similar?.adjustmentFactor || node.similarProduct?.adjustmentFactor || planFactor || 1);
    const similarMtbf = Number(
      node.rms?.similar?.mtbfHours
      || node.similarProduct?.mtbfHours
      || node.rms?.prediction?.mtbfHours
      || node.failureModel?.baselineMtbfHours
      || 1000
    );
    return equivalentHours / Math.max(similarMtbf * similarFactor, 1e-9);
  }
  return 1;
}

function attachMaintainabilityAndSupportability(rows, plan) {
  const failureSum = rows.reduce((sum, row) => sum + row.failureRate, 0) || 1;
  const mttrDenominator = rows.reduce((sum, row) => (
    sum + (row.failureRate / failureSum) * Number(row.node.repairDifficulty || 1)
  ), 0) || 1;
  const mttrScale = Number(plan.targets.mttrHours) / mttrDenominator;

  const demandRows = rows.map((row) => ({
    ...row,
    supportDemand: row.failureRate * row.equivalentHours * Number(row.quantity || 1) * Number(row.node.criticality || 1)
  }));
  const demandSum = demandRows.reduce((sum, row) => sum + row.supportDemand, 0) || 1;
  const mldtDenominator = demandRows.reduce((sum, row) => (
    sum + (row.supportDemand / demandSum) * Number(row.node.supportDifficulty || 1)
  ), 0) || 1;
  const mldtScale = Number(plan.targets.mldtHours) / mldtDenominator;

  return demandRows.map((row) => {
    const mttrHours = mttrScale * Number(row.node.repairDifficulty || 1);
    const mldtHours = mldtScale * Number(row.node.supportDifficulty || 1);
    const inherentAvailability = row.mtbfHours / (row.mtbfHours + mttrHours);
    const operationalAvailability = row.mtbfHours / (row.mtbfHours + mttrHours + mldtHours);
    const predictionMtbf = Number(row.node.rms?.prediction?.mtbfHours || 0);
    return {
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      level: row.level,
      parentId: row.parentId,
      structure: row.structure,
      quantity: row.quantity,
      equivalentHours: row.equivalentHours,
      riskWeight: row.riskWeight,
      riskBudget: row.riskBudget,
      reliability: row.reliability,
      failureRate: row.failureRate,
      mtbfHours: row.mtbfHours,
      mttrHours,
      mldtHours,
      supportDemand: row.supportDemand,
      inherentAvailability,
      operationalAvailability,
      status: predictionMtbf && predictionMtbf < row.mtbfHours ? "风险" : "满足"
    };
  });
}

function weightedMean(rows, field, weightFn) {
  const weightSum = rows.reduce((sum, row) => sum + weightFn(row), 0) || 1;
  return rows.reduce((sum, row) => sum + Number(row[field]) * weightFn(row), 0) / weightSum;
}

function methodWarnings(plan, project) {
  const rootGroup = project.reliabilityGroups?.find((group) => group.parentNodeId === project.rootId);
  if (rootGroup?.type === "series") return [];
  return [{
    code: "MVP_SERIES_ONLY",
    message: "当前前端 MVP 仅校核串联系统，复杂结构将在数值求解阶段扩展"
  }];
}

export function aggregateSeriesReliability(nodeResults) {
  return seriesReliability(nodeResults.map((row) => row.reliability));
}

function normalizeRmsImportedProject(project, baseProject) {
  const rootId = project.rootId || project.equipmentNodes?.find((node) => !node.parentId)?.id || "rms-import-root";
  const equipmentNodes = (project.equipmentNodes || []).map((node, index) => ({
    ...node,
    id: stableNodeId(node.id || `rms-node-${index + 1}`),
    parentId: node.parentId == null ? null : stableNodeId(node.parentId),
    name: node.name || `导入节点${index + 1}`,
    level: node.level || (node.parentId ? "系统" : "装备"),
    quantity: Number(node.quantity || 1),
    structure: normalizeStructure(node.structure || node.connectionType || "series"),
    rms: {
      target: {},
      ...(node.rms || {}),
      prediction: {
        ...(node.rms?.prediction || {}),
        mtbfHours: Number(node.rms?.prediction?.mtbfHours || node.mtbfHours || node.failureModel?.baselineMtbfHours || 1000),
        mttrHours: Number(node.rms?.prediction?.mttrHours || node.mttrHours || 1.5)
      }
    }
  }));
  const rootNode = equipmentNodes.find((node) => node.id === rootId) || equipmentNodes.find((node) => !node.parentId);
  if (rootNode) rootNode.parentId = null;
  const resolvedRootId = rootNode?.id || rootId;
  return selectRmsAllocationEquipmentRoot({
    ...structuredClone(baseProject),
    ...project,
    rootId: resolvedRootId,
    missionProfile: project.missionProfile || structuredClone(baseProject.missionProfile),
    missionPhases: project.missionPhases || structuredClone(baseProject.missionPhases),
    equipmentNodes
  }, resolvedRootId);
}

function importedNodeFromRow(row, { id, parentId, fallbackLevel, index }) {
  const predictionMtbf = pickNumber(row, ["mtbfHours", "MTBF", "预测MTBF"], 0);
  const similarMtbf = pickNumber(row, ["similarMtbfHours", "相似产品MTBF", "15机型MTBF", "基准MTBF"], predictionMtbf || 1000);
  const mttrHours = pickNumber(row, ["mttrHours", "MTTR", "平均修复时间"], 1.5);
  const adjustmentFactor = pickNumber(row, ["adjustmentFactor", "similarityFactor", "修正系数", "相似修正系数"], 1);
  return {
    id,
    name: pickText(row, ["name", "componentName", "nodeName", "节点名称", "组件名称"], `导入节点${index + 1}`),
    level: pickText(row, ["level", "层级", "节点层级"], fallbackLevel),
    parentId,
    quantity: pickNumber(row, ["quantity", "数量", "数量n"], 1),
    structure: normalizeStructure(pickText(row, ["structure", "connectionType", "结构", "逻辑关系"], "series")),
    moduleCount: pickNumber(row, ["moduleCount", "模块数"], 1),
    importance: pickNumber(row, ["importance", "重要度"], 1),
    repairDifficulty: pickNumber(row, ["repairDifficulty", "维修难度"], 1),
    supportDifficulty: pickNumber(row, ["supportDifficulty", "保障难度"], 1),
    criticality: pickNumber(row, ["criticality", "关键度"], 1),
    missionUse: {
      dutyCycle: pickNumber(row, ["dutyCycle", "占空比"], 1),
      environmentFactor: pickNumber(row, ["environmentFactor", "环境系数"], 1),
      loadFactor: pickNumber(row, ["loadFactor", "载荷系数"], 1)
    },
    rms: {
      target: {},
      prediction: { mtbfHours: predictionMtbf || similarMtbf, mttrHours },
      similar: {
        sourceModel: pickText(row, ["similarProductModel", "sourceModel", "基准机型", "相似机型"], "15 机型"),
        targetModel: pickText(row, ["targetProductModel", "targetModel", "目标机型"], "16 机型"),
        mtbfHours: similarMtbf,
        adjustmentFactor
      }
    }
  };
}

function pickText(row, keys, fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return fallback;
}

function pickNumber(row, keys, fallback) {
  const value = pickText(row, keys, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stableNodeId(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeStructure(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("parallel") || text.includes("并联")) return "parallel";
  if (text.includes("k_of_n") || text.includes("中取")) return "k_of_n";
  return "series";
}
