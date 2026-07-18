export const RMS_ALLOCATION_ALGORITHM_VERSION = "rms-engine-4.1.0";

export const DEFAULT_RMS_ALLOCATION_INPUTS = Object.freeze({
  missionReliability: 0.95,
  missionHours: 3,
  mtbfHours: 1000,
  mttrHours: 2
});

export function normalizeRmsAllocationInputs(inputs = {}) {
  const normalized = {
    missionReliability: Object.hasOwn(inputs, "missionReliability")
      ? inputs.missionReliability
      : DEFAULT_RMS_ALLOCATION_INPUTS.missionReliability,
    missionHours: Object.hasOwn(inputs, "missionHours")
      ? inputs.missionHours
      : DEFAULT_RMS_ALLOCATION_INPUTS.missionHours,
    mtbfHours: Object.hasOwn(inputs, "mtbfHours")
      ? inputs.mtbfHours
      : legacyMtbfHours(inputs),
    mttrHours: Object.hasOwn(inputs, "mttrHours")
      ? inputs.mttrHours
      : DEFAULT_RMS_ALLOCATION_INPUTS.mttrHours
  };
  return normalized;
}

export function createRmsAllocationProjectForScenario(scenario, selectedAircraftModel = "") {
  const aircraftModels = scenarioAircraftModels(scenario);
  const selectedModel = aircraftModels.includes(String(selectedAircraftModel || ""))
    ? String(selectedAircraftModel)
    : "";
  const equipmentNodes = [];
  const reliabilityGroups = [];

  for (const aircraftModel of aircraftModels) {
    const rootId = rmsScenarioNodeId(aircraftModel, "aircraft-root");
    const components = (scenario?.components || []).filter((component) => (
      !isSyntheticAircraftRoot(component)
      && (!component?.aircraftModel || String(component.aircraftModel) === aircraftModel)
    ));
    const componentIds = new Set(components.map((component) => String(component?.id || "")).filter(Boolean));
    equipmentNodes.push({
      id: rootId,
      sourceNodeId: "aircraft-root",
      aircraftModel,
      name: aircraftModel,
      level: "装备",
      parentId: null,
      quantity: 1,
      structure: "series",
      rms: { target: {}, prediction: {}, actual: {} }
    });
    for (const [index, component] of components.entries()) {
      const sourceNodeId = String(component?.id || `component-${index + 1}`);
      const sourceParentId = String(component?.parentId || "aircraft-root");
      const parentId = sourceParentId !== "aircraft-root" && componentIds.has(sourceParentId)
        ? rmsScenarioNodeId(aircraftModel, sourceParentId)
        : rootId;
      equipmentNodes.push({
        ...structuredClone(component),
        id: rmsScenarioNodeId(aircraftModel, sourceNodeId),
        sourceNodeId,
        aircraftModel,
        parentId,
        name: component?.name || sourceNodeId,
        level: component?.level || component?.systemLevel || "系统",
        quantity: Number(component?.quantity || 1),
        structure: component?.structure || component?.connectionType || "series",
        missionUse: {
          ...(component?.missionUse || {}),
          runningRatio: component?.missionUse?.runningRatio
            ?? component?.missionUse?.dutyCycle
            ?? component?.runningRatio
            ?? 1
        }
      });
    }
    reliabilityGroups.push({
      id: `${rootId}-series-group`,
      parentNodeId: rootId,
      type: "series",
      children: equipmentNodes.filter((node) => node.parentId === rootId).map((node) => node.id)
    });
  }

  return {
    projectId: scenario?.project_id || scenario?.scenarioId || "rms-project",
    rootId: selectedModel ? rmsScenarioNodeId(selectedModel, "aircraft-root") : "",
    name: scenario?.projectInfo?.name || scenario?.experiment?.name || "装备 RMS 指标分配",
    missionProfile: structuredClone(scenario?.missionProfile || {}),
    missionPhases: structuredClone(scenario?.missionPhases || []),
    reliabilityGroups,
    equipmentNodes
  };
}

export function rmsAllocationInputErrors(inputs = {}) {
  const errors = [];
  validateRequiredRange(errors, inputs.missionReliability, "任务可靠度", { min: 0, max: 1, minExclusive: true });
  validateRequiredRange(errors, inputs.missionHours, "任务时长", { min: 0, minExclusive: true, unit: "h" });
  validateRequiredRange(errors, inputs.mtbfHours, "MTBF", { min: 0, minExclusive: true, unit: "h" });
  validateRequiredRange(errors, inputs.mttrHours, "MTTR", { min: 0, unit: "h" });
  return errors;
}

export function validateRmsAllocationInputs(inputs = {}) {
  const errors = rmsAllocationInputErrors(inputs);
  if (errors.length) throw new Error(`RMS_INPUT_INVALID: ${errors.join("；")}`);
  return {
    missionReliability: Number(inputs.missionReliability),
    missionHours: Number(inputs.missionHours),
    mtbfHours: Number(inputs.mtbfHours),
    mttrHours: Number(inputs.mttrHours)
  };
}

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
        name: "F16",
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
          similar: { sourceModel: "F15", targetModel: "F16", mtbfHours: 760 },
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
          similar: { sourceModel: "F15", targetModel: "F16", mtbfHours: 1080 },
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
          similar: { sourceModel: "F15", targetModel: "F16", mtbfHours: 900 },
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
          similar: { sourceModel: "F15", targetModel: "F16", mtbfHours: 1320 },
          actual: { mtbfHours: 1300, source: "supplier" }
        }
      },
      {
        id: "f15-root",
        name: "F15",
        level: "装备",
        parentId: null,
        quantity: 1,
        structure: "series",
        rms: { target: {}, prediction: { mtbfHours: 980 }, actual: { mtbfHours: 930, source: "field-data" } }
      },
      {
        id: "f15-propulsion-system",
        name: "F15 动力系统",
        level: "系统",
        parentId: "f15-root",
        quantity: 2,
        structure: "series",
        moduleCount: 8,
        importance: 0.9,
        complexity: 3,
        maturityRisk: 2,
        repairDifficulty: 1.25,
        supportDifficulty: 1.15,
        criticality: 1.15,
        missionUse: { dutyCycle: 1, environmentFactor: 1.12, loadFactor: 1.08 },
        rms: {
          target: {},
          prediction: { mtbfHours: 760, mttrHours: 2.1 },
          actual: { mtbfHours: 740, source: "field-data" }
        }
      },
      {
        id: "f15-avionics-system",
        name: "F15 航电系统",
        level: "系统",
        parentId: "f15-root",
        quantity: 2,
        structure: "series",
        moduleCount: 6,
        importance: 1.1,
        complexity: 3,
        maturityRisk: 2,
        repairDifficulty: 1,
        supportDifficulty: 1.05,
        criticality: 1.2,
        missionUse: { dutyCycle: 1, environmentFactor: 1.02, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1080, mttrHours: 1.7 },
          actual: { mtbfHours: 1010, source: "bench-test" }
        }
      },
      {
        id: "f15-hydraulic-system",
        name: "F15 液压系统",
        level: "分系统",
        parentId: "f15-root",
        quantity: 1,
        structure: "series",
        moduleCount: 4,
        importance: 0.85,
        complexity: 2,
        maturityRisk: 2,
        repairDifficulty: 1.1,
        supportDifficulty: 1.15,
        criticality: 0.95,
        missionUse: { dutyCycle: 0.85, environmentFactor: 1.05, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 900, mttrHours: 1.9 },
          actual: { mtbfHours: 880, source: "field-data" }
        }
      },
      {
        id: "f15-mission-computer",
        name: "F15 任务计算机 LRU",
        level: "LRU",
        parentId: "f15-root",
        quantity: 1,
        structure: "series",
        moduleCount: 3,
        importance: 1.25,
        complexity: 3,
        maturityRisk: 1,
        repairDifficulty: 0.75,
        supportDifficulty: 0.65,
        criticality: 1.3,
        missionUse: { dutyCycle: 0.65, environmentFactor: 1, loadFactor: 0.9 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1320, mttrHours: 1.1 },
          actual: { mtbfHours: 1280, source: "supplier" }
        }
      },
      {
        id: "f18-root",
        name: "F18",
        level: "装备",
        parentId: null,
        quantity: 1,
        structure: "series",
        rms: { target: {}, prediction: { mtbfHours: 1040 }, actual: { mtbfHours: 990, source: "field-data" } }
      },
      {
        id: "f18-propulsion-system",
        name: "F18 动力系统",
        level: "系统",
        parentId: "f18-root",
        quantity: 2,
        structure: "series",
        moduleCount: 8,
        importance: 0.92,
        complexity: 4,
        maturityRisk: 2,
        repairDifficulty: 1.28,
        supportDifficulty: 1.18,
        criticality: 1.18,
        missionUse: { dutyCycle: 1, environmentFactor: 1.16, loadFactor: 1.1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 820, mttrHours: 2.0 },
          actual: { mtbfHours: 790, source: "field-data" }
        }
      },
      {
        id: "f18-avionics-system",
        name: "F18 航电系统",
        level: "系统",
        parentId: "f18-root",
        quantity: 2,
        structure: "series",
        moduleCount: 7,
        importance: 1.15,
        complexity: 3,
        maturityRisk: 2,
        repairDifficulty: 0.98,
        supportDifficulty: 1.02,
        criticality: 1.25,
        missionUse: { dutyCycle: 1, environmentFactor: 1.04, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1180, mttrHours: 1.6 },
          actual: { mtbfHours: 1110, source: "bench-test" }
        }
      },
      {
        id: "f18-hydraulic-system",
        name: "F18 液压系统",
        level: "分系统",
        parentId: "f18-root",
        quantity: 1,
        structure: "series",
        moduleCount: 4,
        importance: 0.88,
        complexity: 2,
        maturityRisk: 2,
        repairDifficulty: 1.08,
        supportDifficulty: 1.12,
        criticality: 0.98,
        missionUse: { dutyCycle: 0.88, environmentFactor: 1.06, loadFactor: 1 },
        rms: {
          target: {},
          prediction: { mtbfHours: 960, mttrHours: 1.8 },
          actual: { mtbfHours: 910, source: "field-data" }
        }
      },
      {
        id: "f18-mission-computer",
        name: "F18 任务计算机 LRU",
        level: "LRU",
        parentId: "f18-root",
        quantity: 1,
        structure: "series",
        moduleCount: 3,
        importance: 1.3,
        complexity: 3,
        maturityRisk: 1,
        repairDifficulty: 0.72,
        supportDifficulty: 0.62,
        criticality: 1.35,
        missionUse: { dutyCycle: 0.7, environmentFactor: 1, loadFactor: 0.92 },
        rms: {
          target: {},
          prediction: { mtbfHours: 1500, mttrHours: 1.0 },
          actual: { mtbfHours: 1420, source: "supplier" }
        }
      }
    ]
  };
}

export function createRmsEquipmentImportFixture() {
  return [
    { id: "f16-root", name: "F16", parentId: "", level: "装备", quantity: 1, structure: "series" },
    {
      id: "f16-propulsion",
      name: "F16 动力系统",
      parentId: "f16-root",
      level: "系统",
      quantity: 2,
      structure: "series",
      mtbfHours: 700,
      mttrHours: 2.4,
      similarProductModel: "F15",
      targetProductModel: "F16",
      similarMtbfHours: 760,
      dutyCycle: 1,
      environmentFactor: 1.18,
      loadFactor: 1.12,
      repairDifficulty: 1.35,
      supportDifficulty: 1.25,
      criticality: 1.25
    },
    {
      id: "f16-avionics",
      name: "F16 航电系统",
      parentId: "f16-root",
      level: "系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 1020,
      mttrHours: 1.9,
      similarProductModel: "F15",
      targetProductModel: "F16",
      similarMtbfHours: 1080,
      dutyCycle: 1,
      environmentFactor: 1.05,
      loadFactor: 1,
      repairDifficulty: 1.05,
      supportDifficulty: 1.1,
      criticality: 1.3
    },
    {
      id: "f16-hydraulic",
      name: "F16 液压系统",
      parentId: "f16-root",
      level: "分系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 820,
      mttrHours: 2.1,
      similarProductModel: "F15",
      targetProductModel: "F16",
      similarMtbfHours: 900,
      dutyCycle: 0.86,
      environmentFactor: 1.1,
      loadFactor: 1,
      repairDifficulty: 1.15,
      supportDifficulty: 1.2,
      criticality: 1
    },
    {
      id: "f16-mission-computer",
      name: "F16 任务计算机 LRU",
      parentId: "f16-root",
      level: "LRU",
      quantity: 1,
      structure: "series",
      mtbfHours: 1260,
      mttrHours: 1.4,
      similarProductModel: "F15",
      targetProductModel: "F16",
      similarMtbfHours: 1320,
      dutyCycle: 0.65,
      environmentFactor: 1,
      loadFactor: 0.9,
      repairDifficulty: 0.8,
      supportDifficulty: 0.7,
      criticality: 1.4
    },
    { id: "f15-root", name: "F15", parentId: "", level: "装备", quantity: 1, structure: "series" },
    {
      id: "f15-propulsion",
      name: "F15 动力系统",
      parentId: "f15-root",
      level: "系统",
      quantity: 2,
      structure: "series",
      mtbfHours: 760,
      mttrHours: 2.1,
      dutyCycle: 1,
      environmentFactor: 1.12,
      loadFactor: 1.08,
      repairDifficulty: 1.25,
      supportDifficulty: 1.15,
      criticality: 1.15
    },
    {
      id: "f15-avionics",
      name: "F15 航电系统",
      parentId: "f15-root",
      level: "系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 1080,
      mttrHours: 1.7,
      dutyCycle: 1,
      environmentFactor: 1.02,
      loadFactor: 1,
      repairDifficulty: 1,
      supportDifficulty: 1.05,
      criticality: 1.2
    },
    {
      id: "f15-hydraulic",
      name: "F15 液压系统",
      parentId: "f15-root",
      level: "分系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 900,
      mttrHours: 1.9,
      dutyCycle: 0.85,
      environmentFactor: 1.05,
      loadFactor: 1,
      repairDifficulty: 1.1,
      supportDifficulty: 1.15,
      criticality: 0.95
    },
    {
      id: "f15-mission-computer",
      name: "F15 任务计算机 LRU",
      parentId: "f15-root",
      level: "LRU",
      quantity: 1,
      structure: "series",
      mtbfHours: 1320,
      mttrHours: 1.1,
      dutyCycle: 0.65,
      environmentFactor: 1,
      loadFactor: 0.9,
      repairDifficulty: 0.75,
      supportDifficulty: 0.65,
      criticality: 1.3
    },
    { id: "f18-root", name: "F18", parentId: "", level: "装备", quantity: 1, structure: "series" },
    {
      id: "f18-propulsion",
      name: "F18 动力系统",
      parentId: "f18-root",
      level: "系统",
      quantity: 2,
      structure: "series",
      mtbfHours: 820,
      mttrHours: 2.0,
      dutyCycle: 1,
      environmentFactor: 1.16,
      loadFactor: 1.1,
      repairDifficulty: 1.28,
      supportDifficulty: 1.18,
      criticality: 1.18
    },
    {
      id: "f18-avionics",
      name: "F18 航电系统",
      parentId: "f18-root",
      level: "系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 1180,
      mttrHours: 1.6,
      dutyCycle: 1,
      environmentFactor: 1.04,
      loadFactor: 1,
      repairDifficulty: 0.98,
      supportDifficulty: 1.02,
      criticality: 1.25
    },
    {
      id: "f18-hydraulic",
      name: "F18 液压系统",
      parentId: "f18-root",
      level: "分系统",
      quantity: 1,
      structure: "series",
      mtbfHours: 960,
      mttrHours: 1.8,
      dutyCycle: 0.88,
      environmentFactor: 1.06,
      loadFactor: 1,
      repairDifficulty: 1.08,
      supportDifficulty: 1.12,
      criticality: 0.98
    },
    {
      id: "f18-mission-computer",
      name: "F18 任务计算机 LRU",
      parentId: "f18-root",
      level: "LRU",
      quantity: 1,
      structure: "series",
      mtbfHours: 1500,
      mttrHours: 1.0,
      dutyCycle: 0.7,
      environmentFactor: 1,
      loadFactor: 0.92,
      repairDifficulty: 0.72,
      supportDifficulty: 0.62,
      criticality: 1.35
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
  const ids = indexedRows.map((item) => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`RMS_EQUIPMENT_DUPLICATE_ID: 节点ID重复 ${[...new Set(duplicateIds)].join("、")}`);
  const idSet = new Set(ids);
  const orphan = indexedRows.find((item) => item.parentId && !idSet.has(stableNodeId(item.parentId)));
  if (orphan) throw new Error(`RMS_EQUIPMENT_ORPHAN_PARENT: ${orphan.id} 的父节点 ${orphan.parentId} 不存在`);
  const explicitRoots = indexedRows.filter((item) => !item.parentId);
  const primaryRoot = explicitRoots.find((item) => /装备|整机|root/i.test(item.level)) || explicitRoots[0];
  const rootId = primaryRoot?.id || "rms-import-root";
  const rootNode = primaryRoot
    ? importedNodeFromRow(primaryRoot.row, { id: rootId, parentId: null, fallbackLevel: "装备", index: primaryRoot.index })
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
    if (primaryRoot && item.index === primaryRoot.index) continue;
    const parentId = item.parentId ? stableNodeId(item.parentId) : null;
    nodes.push(importedNodeFromRow(item.row, {
      id: item.id,
      parentId,
      fallbackLevel: parentId ? "系统" : "装备",
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
    schemaVersion: "rms-allocation-plan-v4",
    planId: "RMS-PLAN-001",
    planVersion: 1,
    name: "近海巡逻任务RMS分配方案",
    status: "draft",
    projectId: project.projectId,
    algorithmVersion: RMS_ALLOCATION_ALGORITHM_VERSION,
    inputs: { ...DEFAULT_RMS_ALLOCATION_INPUTS },
    methods: {
      allocation: "equal",
      similarProduct: {
        sourceModel: rmsEquipmentRoots(project).find((node) => node.id !== project.rootId)?.name || "F15",
        targetModel: project.equipmentNodes.find((node) => node.id === project.rootId)?.name || "F16"
      }
    },
    assumptions: [
      "当前工作台按选中装备根节点的直接子系统分配指标份额",
      "安装数与运行比来自 RMS 工作台独立导入数据，不回写项目建模数据"
    ]
  };
}

export function calculateRmsAllocation(plan, project) {
  const inputSnapshot = validateRmsAllocationInputs(plan.inputs);
  const childNodes = project.equipmentNodes.filter((node) => node.parentId === project.rootId);
  if (!childNodes.length) {
    throw new Error("RMS_ALLOCATION_EMPTY: 当前装备没有可分配的直接子系统");
  }
  for (const node of childNodes) validateAllocationNode(node);
  const weights = allocationWeights(plan, project, childNodes);
  const totalRiskBudget = inputSnapshot.missionHours / inputSnapshot.mtbfHours;
  const reliabilityRows = childNodes.map((node) => {
    const runningRatio = runningRatioForNode(node);
    const allocationShare = weights[node.id];
    const productIntensityHours = inputSnapshot.missionHours * runningRatio;
    const nodeRiskBudget = totalRiskBudget * allocationShare;
    const mtbfHours = productIntensityHours > 0 && nodeRiskBudget > 0
      ? roundRmsMetric(productIntensityHours / nodeRiskBudget)
      : null;
    return {
      node,
      nodeId: node.id,
      nodeName: node.name,
      level: node.level,
      model: node.model || node.partNumber || "",
      installationCount: normalizedInstallationCount(node.quantity),
      runningRatio,
      failureRate: mtbfHours === null ? 0 : roundRmsMetric(1 / mtbfHours),
      mtbfHours,
      allocationShare,
      status: mtbfHours === null ? "未参与" : "已分配"
    };
  });
  const failureRateSum = reliabilityRows.reduce((sum, row) => sum + row.failureRate, 0);
  const mttrDenominator = reliabilityRows.reduce((sum, row) => (
    sum + (failureRateSum > 0 ? row.failureRate / failureRateSum : 0) * repairDifficultyForNode(row.node)
  ), 0);
  const mttrScale = mttrDenominator > 0 ? inputSnapshot.mttrHours / mttrDenominator : 0;
  const nodeResults = reliabilityRows.map(({ node, ...row }) => ({
    ...row,
    mttrHours: row.failureRate > 0
      ? roundRmsMetric(mttrScale * repairDifficultyForNode(node))
      : null
  }));
  const warnings = methodWarnings(plan, project);
  const selectedRoot = project.equipmentNodes.find((node) => node.id === project.rootId);

  return {
    ok: true,
    planId: plan.planId,
    planVersion: plan.planVersion,
    planStatus: "calculated",
    status: "calculated",
    algorithmVersion: RMS_ALLOCATION_ALGORITHM_VERSION,
    aircraftModel: selectedRoot?.aircraftModel || selectedRoot?.name || "",
    inputSnapshot,
    method: plan.methods.allocation,
    similarProduct: plan.methods.similarProduct || null,
    nodeResults,
    totals: {
      installationCount: nodeResults.reduce((sum, row) => sum + row.installationCount, 0),
      allocationShare: nodeResults.reduce((sum, row) => sum + row.allocationShare, 0)
    },
    warnings,
    assumptions: plan.assumptions
  };
}

export function createRmsAllocationFailureResult(plan, error) {
  return {
    ok: false,
    planId: plan.planId,
    planVersion: plan.planVersion,
    status: "method_not_applicable",
    algorithmVersion: plan.algorithmVersion || RMS_ALLOCATION_ALGORITHM_VERSION,
    aircraftModel: plan.methods?.similarProduct?.targetModel || "",
    inputSnapshot: {
      missionReliability: Number(plan.inputs?.missionReliability) || 0,
      missionHours: Number(plan.inputs?.missionHours) || 0,
      mtbfHours: Number(plan.inputs?.mtbfHours) || 0,
      mttrHours: Number(plan.inputs?.mttrHours) || 0
    },
    method: plan.methods.allocation,
    similarProduct: plan.methods.similarProduct || null,
    nodeResults: [],
    totals: { installationCount: 0, allocationShare: 0 },
    warnings: [{
      code: "RMS_METHOD_NOT_APPLICABLE",
      message: error?.message || "当前分配方法不适用"
    }],
    assumptions: plan.assumptions || []
  };
}

function legacyMtbfHours(inputs) {
  const missionReliability = Number(inputs.missionReliability);
  const missionHours = Number(inputs.missionHours);
  const criticalFailureRatio = Number(inputs.criticalFailureRatio);
  if (
    missionReliability > 0
    && missionReliability < 1
    && missionHours > 0
    && criticalFailureRatio > 0
  ) {
    return Number((criticalFailureRatio * (-missionHours / Math.log(missionReliability))).toFixed(6));
  }
  return DEFAULT_RMS_ALLOCATION_INPUTS.mtbfHours;
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

export function rmsEquipmentSubtree(project, rootId = project.rootId) {
  const nodes = project.equipmentNodes || [];
  const childIdsByParent = nodes.reduce((acc, node) => {
    if (node.parentId) {
      acc[node.parentId] ||= [];
      acc[node.parentId].push(node.id);
    }
    return acc;
  }, {});
  const selectedIds = new Set();
  const visit = (nodeId) => {
    if (!nodeId || selectedIds.has(nodeId)) return;
    selectedIds.add(nodeId);
    for (const childId of childIdsByParent[nodeId] || []) visit(childId);
  };
  visit(rootId);
  return nodes.filter((node) => selectedIds.has(node.id));
}

function allocationWeights(plan, project, childNodes) {
  const raw = Object.fromEntries(childNodes.map((node) => [node.id, rawAllocationFactor(plan, project, node)]));
  const values = Object.values(raw);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("RMS_ALLOCATION_INVALID_WEIGHT: 分配权重必须为有限非负数");
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (!(sum > 0)) {
    throw new Error("RMS_ALLOCATION_ZERO_WEIGHT: 当前方法的节点权重合计为 0，无法分配");
  }
  return Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, value / sum]));
}

function rawAllocationFactor(plan, project, node) {
  const runningRatio = runningRatioForNode(node);
  if (runningRatio === 0) return 0;
  const installationExposure = normalizedInstallationCount(node.quantity) * runningRatio;
  if (plan.methods.allocation === "proportional") {
    const engineeringFactor = Number(node.importance || 1) * Number(node.complexity || 1);
    return installationExposure * engineeringFactor;
  }
  if (plan.methods.allocation === "similar") {
    const similarReference = requireSimilarReferenceNode(project, node, plan.methods?.similarProduct?.sourceModel);
    validateAllocationNode(similarReference);
    return normalizedInstallationCount(similarReference.quantity) * runningRatioForNode(similarReference);
  }
  if (plan.methods.allocation !== "equal") throw new Error(`RMS_ALLOCATION_UNKNOWN_METHOD: ${plan.methods.allocation || "未选择"}`);
  return 1;
}

function requireSimilarReferenceNode(project, targetNode, sourceModelName) {
  const sourceRoot = rmsEquipmentRoots(project).find((root) => root.name === sourceModelName);
  if (!sourceRoot) throw new Error(`RMS_SIMILAR_SOURCE_MISSING: 基准机型 ${sourceModelName || "未选择"} 不存在`);
  if (sourceRoot.id === project.rootId) throw new Error("RMS_SIMILAR_SOURCE_IS_TARGET: 基准机型不能与当前装备相同");
  const targetRoot = (project.equipmentNodes || []).find((node) => node.id === project.rootId);
  const targetName = stripModelPrefix(targetNode.name, targetRoot?.name);
  const matched = rmsEquipmentSubtree(project, sourceRoot.id)
    .filter((node) => node.id !== sourceRoot.id)
    .find((node) => stripModelPrefix(node.name, sourceRoot.name) === targetName);
  if (!matched) throw new Error(`RMS_SIMILAR_NODE_MISSING: 基准机型缺少与 ${targetNode.name} 对应的节点`);
  return matched;
}

function methodWarnings(plan, project) {
  const rootGroup = project.reliabilityGroups?.find((group) => group.parentNodeId === project.rootId);
  if (rootGroup?.type === "series") return [];
  return [{
    code: "MVP_SERIES_ONLY",
    message: "当前前端 MVP 仅校核串联系统，复杂结构将在数值求解阶段扩展"
  }];
}

function normalizedInstallationCount(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) return number;
  throw new Error(`RMS_INSTALLATION_COUNT_INVALID: 安装数必须为正整数，收到 ${String(value)}`);
}

function runningRatioForNode(node) {
  const value = node.missionUse?.runningRatio ?? node.missionUse?.dutyCycle ?? node.runningRatio;
  const number = Number(value);
  if (value == null || value === "" || !Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`RMS_RUNNING_RATIO_INVALID: 运行比必须是 0 到 1 的有限数，收到 ${String(value ?? "空值")}`);
  }
  return number;
}

function roundRmsMetric(value, digits = 12) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return Number(number.toFixed(digits));
}

function validateAllocationNode(node) {
  normalizedInstallationCount(node.quantity);
  runningRatioForNode(node);
  repairDifficultyForNode(node);
}

function repairDifficultyForNode(node) {
  const value = node.repairDifficulty ?? 1;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`RMS_REPAIR_DIFFICULTY_INVALID: 维修难度必须为有限正数，收到 ${String(value)}`);
  }
  return number;
}

function scenarioAircraftModels(scenario) {
  const equipment = scenario?.equipment || {};
  const aircraftTypes = Array.isArray(equipment.aircraftTypes)
    ? equipment.aircraftTypes.map((item) => typeof item === "string" ? item : (item?.model || item?.name || item?.id || ""))
    : [];
  return Array.from(new Set([
    ...aircraftTypes,
    ...(Array.isArray(equipment.wholeMachineModels) ? equipment.wholeMachineModels : []),
    equipment.model
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function rmsScenarioNodeId(aircraftModel, sourceNodeId) {
  return `rms:${encodeURIComponent(aircraftModel)}:${encodeURIComponent(sourceNodeId)}`;
}

function isSyntheticAircraftRoot(component) {
  return String(component?.id || "") === "aircraft-root";
}

function validateRequiredRange(errors, value, label, { min, max, minExclusive = false, unit = "" } = {}) {
  if (value === "" || value === null || value === undefined) {
    errors.push(`${label}不能为空`);
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(`${label}必须为有限数值`);
    return;
  }
  if (min !== undefined && (minExclusive ? number <= min : number < min)) {
    errors.push(`${label}必须${minExclusive ? "大于" : "大于等于"} ${min}${unit ? ` ${unit}` : ""}`);
  }
  if (max !== undefined && number > max) {
    errors.push(`${label}必须小于等于 ${max}${unit ? ` ${unit}` : ""}`);
  }
}

function normalizeRmsImportedProject(project, baseProject) {
  const rootId = project.rootId || project.equipmentNodes?.find((node) => !node.parentId)?.id || "rms-import-root";
  const equipmentNodes = (project.equipmentNodes || []).map((node, index) => {
    const parentId = node.parentId == null ? null : stableNodeId(node.parentId);
    const normalized = {
      ...node,
      id: stableNodeId(node.id || `rms-node-${index + 1}`),
      parentId,
      name: node.name || `导入节点${index + 1}`,
      level: node.level || (parentId ? "系统" : "装备"),
      quantity: parentId ? requirePositiveInteger(node.quantity, `第 ${index + 1} 行安装数`) : Number(node.quantity || 1),
      structure: normalizeStructure(node.structure || node.connectionType || "series")
    };
    if (parentId) requireRunningRatio(normalized, `第 ${index + 1} 行运行比`);
    return normalized;
  });
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

function stripModelPrefix(nodeName, modelName = "") {
  const normalizedNode = String(nodeName || "").replace(/\s+/g, "");
  const normalizedModel = String(modelName || "")
    .replace(/整机$/, "")
    .replace(/\s+/g, "");
  if (normalizedModel && normalizedNode.startsWith(normalizedModel)) {
    return normalizedNode.slice(normalizedModel.length) || normalizedNode;
  }
  return normalizedNode;
}

function importedNodeFromRow(row, { id, parentId, fallbackLevel, index }) {
  const quantity = parentId
    ? requirePositiveInteger(pickRequiredValue(row, ["quantity", "安装数", "数量", "数量n"], `第 ${index + 1} 行安装数`), `第 ${index + 1} 行安装数`)
    : pickNumber(row, ["quantity", "安装数", "数量", "数量n"], 1);
  const runningRatio = parentId
    ? requireRatio(pickRequiredValue(row, ["runningRatio", "运行比", "dutyCycle", "占空比"], `第 ${index + 1} 行运行比`), `第 ${index + 1} 行运行比`)
    : pickNumber(row, ["runningRatio", "运行比", "dutyCycle", "占空比"], 1);
  return {
    id,
    name: pickText(row, ["name", "componentName", "nodeName", "节点名称", "组件名称"], `导入节点${index + 1}`),
    model: pickText(row, ["model", "partNumber", "型号", "系统型号"], ""),
    level: pickText(row, ["level", "层级", "节点层级"], fallbackLevel),
    parentId,
    quantity,
    structure: normalizeStructure(pickText(row, ["structure", "connectionType", "结构", "逻辑关系"], "series")),
    moduleCount: pickNumber(row, ["moduleCount", "模块数"], 1),
    importance: pickNumber(row, ["importance", "重要度"], 1),
    repairDifficulty: pickNumber(row, ["repairDifficulty", "维修难度"], 1),
    supportDifficulty: pickNumber(row, ["supportDifficulty", "保障难度"], 1),
    criticality: pickNumber(row, ["criticality", "关键度"], 1),
    missionUse: {
      runningRatio,
      dutyCycle: runningRatio,
      environmentFactor: pickNumber(row, ["environmentFactor", "环境系数"], 1),
      loadFactor: pickNumber(row, ["loadFactor", "载荷系数"], 1)
    },
    rms: {
      similar: {
        sourceModel: pickText(row, ["similarProductModel", "sourceModel", "基准机型", "相似机型"], "F15"),
        targetModel: pickText(row, ["targetProductModel", "targetModel", "目标机型"], "F16")
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
  if (value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickRequiredValue(row, keys, label) {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  throw new Error(`RMS_IMPORT_FIELD_MISSING: ${label}不能为空`);
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`RMS_IMPORT_INSTALLATION_INVALID: ${label}必须为正整数`);
  return number;
}

function requireRatio(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`RMS_IMPORT_RUNNING_RATIO_INVALID: ${label}必须是 0 到 1 的有限数`);
  return number;
}

function requireRunningRatio(node, label) {
  const value = node.missionUse?.runningRatio ?? node.missionUse?.dutyCycle ?? node.runningRatio;
  return requireRatio(pickRequiredValue({ value }, ["value"], label), label);
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
