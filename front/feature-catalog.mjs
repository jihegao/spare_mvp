const MODULE_PREFIX = {
  "备件规划评估模块": "spare-planning",
  "任务可靠度评估模块": "mission-reliability"
};

const FEATURE_SLUGS = {
  内置场景: "built-in-scenario",
  基本作战单元建模: "combat-unit",
  基本任务建模: "basic-mission",
  任务剖面建模: "mission-profile",
  装备组成建模: "equipment-composition",
  装备故障建模: "equipment-failure",
  装备可靠性框图建模: "reliability-block-diagram",
  保障组织结构建模: "support-organization",
  备件建模: "spare-part",
  保障人员建模: "support-personnel",
  保障设备建模: "support-equipment",
  保障资源需求组: "support-resource-demand",
  装备修复性维修方案: "corrective-maintenance-plan",
  装备预防性维修方案: "preventive-maintenance-plan",
  装备使用保障方案: "operations-support-plan",
  结果导入: "result-import",
  仿真实验方案管理: "experiment-plan-management",
  方案列表: "experiment-plan-list",
  方案编辑: "experiment-plan-edit",
  可视化实验启动与停止: "visual-start-stop",
  场景切换: "scenario-switch",
  可视化结果展示: "visual-results",
  蒙特卡洛实验配置: "monte-carlo-config",
  蒙特卡洛实验结果: "monte-carlo-results",
  备件短板分析: "spare-shortfall-analysis",
  飞机转场携行清单分析: "carry-list-analysis",
  飞机任务可靠性分析: "aircraft-task-reliability",
  任务可靠度评估: "task-reliability",
  停机因素分析: "downtime-factor-analysis"
};

const SOURCE_ROWS = [
  ["备件规划评估模块", "仿真建模", "任务建模", "内置场景"],
  ["备件规划评估模块", "仿真建模", "任务建模", "基本作战单元建模"],
  ["备件规划评估模块", "仿真建模", "任务建模", "基本任务建模"],
  ["备件规划评估模块", "仿真建模", "任务建模", "任务剖面建模"],
  ["备件规划评估模块", "仿真建模", "装备建模", "装备组成建模"],
  ["备件规划评估模块", "仿真建模", "装备建模", "装备故障建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障组织结构建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "备件建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障人员建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障设备建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "保障资源需求组"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "装备修复性维修方案"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "装备预防性维修方案"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "装备使用保障方案"],
  ["备件规划评估模块", "仿真建模", "指标分配方案管理", "结果导入"],
  ["备件规划评估模块", "仿真实验", "仿真实验方案管理", "方案列表"],
  ["备件规划评估模块", "仿真实验", "仿真实验方案管理", "方案编辑"],
  ["备件规划评估模块", "仿真实验", "可视化推演", "可视化实验启动与停止"],
  ["备件规划评估模块", "仿真实验", "蒙特卡洛实验", "蒙特卡洛实验配置"],
  ["备件规划评估模块", "结果分析", "蒙特卡洛实验结果", "蒙特卡洛实验结果"],
  ["备件规划评估模块", "结果分析", "备件短板分析", "备件短板分析"],
  ["备件规划评估模块", "结果分析", "飞机转场携行清单分析", "飞机转场携行清单分析"],
  ["任务可靠度评估模块", "仿真建模", "任务建模", "内置场景"],
  ["任务可靠度评估模块", "仿真建模", "任务建模", "基本作战单元建模"],
  ["任务可靠度评估模块", "仿真建模", "任务建模", "基本任务建模"],
  ["任务可靠度评估模块", "仿真建模", "任务建模", "任务剖面建模"],
  ["任务可靠度评估模块", "仿真建模", "装备建模", "装备组成建模"],
  ["任务可靠度评估模块", "仿真建模", "装备建模", "装备故障建模"],
  ["任务可靠度评估模块", "仿真建模", "装备建模", "装备可靠性框图建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障组织结构建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "备件建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障人员建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障设备建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "保障资源需求组"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "装备修复性维修方案"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "装备预防性维修方案"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "装备使用保障方案"],
  ["任务可靠度评估模块", "仿真实验", "仿真实验方案管理", "方案列表"],
  ["任务可靠度评估模块", "仿真实验", "仿真实验方案管理", "方案编辑"],
  ["任务可靠度评估模块", "仿真实验", "可视化推演", "可视化实验启动与停止"],
  ["任务可靠度评估模块", "仿真实验", "蒙特卡洛实验", "蒙特卡洛实验配置"],
  ["任务可靠度评估模块", "结果分析", "蒙特卡洛实验结果", "蒙特卡洛实验结果"],
  ["任务可靠度评估模块", "结果分析", "飞机任务可靠性分析", "飞机任务可靠性分析"],
  ["任务可靠度评估模块", "结果分析", "任务可靠度评估", "任务可靠度评估"],
  ["任务可靠度评估模块", "结果分析", "停机因素分析", "停机因素分析"]
];

export const FEATURE_PAGES = SOURCE_ROWS.map(([module, secondary, tertiary, name]) => {
  const id = `${MODULE_PREFIX[module]}-${FEATURE_SLUGS[name]}`;
  const component = resolveComponent(name, secondary, tertiary);
  const dataObjects = resolveDataObjects(name, secondary, tertiary);
  return {
    id,
    module,
    secondary,
    tertiary,
    name,
    component,
    dataObjects,
    summary: buildSummary(module, secondary, tertiary, name)
  };
});

export function groupFeaturePages(pages = FEATURE_PAGES) {
  return pages.reduce((acc, page) => {
    acc[page.module] ||= {};
    acc[page.module][page.secondary] ||= {};
    acc[page.module][page.secondary][page.tertiary] ||= [];
    acc[page.module][page.secondary][page.tertiary].push(page);
    return acc;
  }, {});
}

export function getFeaturePageById(id) {
  const normalizedId = FEATURE_ID_ALIASES[id] || id;
  return FEATURE_PAGES.find((page) => page.id === normalizedId) || FEATURE_PAGES[0];
}

const FEATURE_ID_ALIASES = {
  "spare-planning-experiment-plan-management": "spare-planning-experiment-plan-list",
  "mission-reliability-experiment-plan-management": "mission-reliability-experiment-plan-list",
  "spare-planning-experiment-create": "spare-planning-experiment-plan-edit",
  "spare-planning-experiment-edit": "spare-planning-experiment-plan-edit",
  "mission-reliability-experiment-create": "mission-reliability-experiment-plan-edit",
  "mission-reliability-experiment-edit": "mission-reliability-experiment-plan-edit",
  "spare-planning-monte-carlo-results-display": "spare-planning-monte-carlo-results",
  "mission-reliability-monte-carlo-results-display": "mission-reliability-monte-carlo-results",
  "spare-planning-scenario-switch": "spare-planning-visual-start-stop",
  "spare-planning-visual-results": "spare-planning-visual-start-stop",
  "mission-reliability-scenario-switch": "mission-reliability-visual-start-stop",
  "mission-reliability-visual-results": "mission-reliability-visual-start-stop"
};

function resolveComponent(name, secondary, tertiary) {
  if (name === "方案列表") return "experiment-plan-list";
  if (name === "方案编辑") return "experiment-plan-editor";
  if (name.includes("可靠性框图")) return "reliability-block-diagram";
  if (tertiary === "可视化推演") return "visual-simulation";
  if (name.includes("可视化")) return "visual-simulation";
  if (name.includes("场景切换")) return "scenario-switch";
  if (name.includes("蒙特卡洛实验配置")) return "monte-carlo-config";
  if (name.includes("蒙特卡洛实验结果")) return "monte-carlo-results";
  if (secondary === "结果分析") return "analysis";
  if (name.includes("仿真实验方案")) return "experiment-form";
  if (name.includes("结果导入")) return "import-table";
  if (tertiary === "保障活动建模") return "activity-gantt";
  if (tertiary === "保障组织建模") return "resource-table";
  if (tertiary === "装备建模") return "equipment-table";
  return "task-model";
}

function resolveDataObjects(name, secondary, tertiary) {
  if (name.includes("内置场景")) return ["scenarioId", "airports", "missionAreas", "supportNodes"];
  if (name.includes("作战单元")) return ["combatUnit", "equipment", "supportNodes"];
  if (name.includes("基本任务")) return ["basicMission", "missionPhases"];
  if (name.includes("任务剖面")) return ["missionProfile", "missionPhases"];
  if (name.includes("装备组成")) return ["equipment", "components"];
  if (name.includes("装备故障")) return ["components", "failureModel"];
  if (name.includes("可靠性框图")) return ["reliabilityBlockDiagram", "components"];
  if (name.includes("保障组织结构")) return ["supportNodes", "organizationTree"];
  if (name.includes("备件")) return ["supportNodes.inventory", "spares"];
  if (name.includes("保障人员")) return ["supportNodes.personnelCapacity", "resources"];
  if (name.includes("保障设备")) return ["supportNodes.equipmentCapacity", "resources"];
  if (tertiary === "保障活动建模") return ["supportActivities", "resources", "spares"];
  if (name.includes("方案") || name.includes("仿真实验方案")) return ["experiment", "scenario"];
  if (name.includes("可视化") || name.includes("场景切换")) return ["visualizationState", "experiment", "scenario"];
  if (name.includes("蒙特卡洛")) return ["monteCarlo", "runs", "summary"];
  if (secondary === "结果分析") return ["runs", "summary", "decisionOutputs"];
  return ["scenario"];
}

function buildSummary(module, secondary, tertiary, name) {
  return `${module} / ${secondary} / ${tertiary} 下的 ${name} 页面，围绕共享 scenario 数据提供编辑和实验查看能力。`;
}
