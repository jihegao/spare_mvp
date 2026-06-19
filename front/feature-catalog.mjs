const MODULE_PREFIX = {
  "备件规划评估模块": "spare-planning",
  "任务可靠度评估模块": "mission-reliability",
  "系统管理": "system-management"
};

const FEATURE_SLUGS = {
  内置场景: "built-in-scenario",
  基本作战单元建模: "combat-unit",
  基本任务建模: "basic-mission",
  任务剖面参数: "mission-profile-parameters",
  复合任务建模: "composite-task",
  周期性任务建模: "periodic-task",
  装备组成建模: "equipment-composition",
  装备故障建模: "equipment-failure",
  装备可靠性框图建模: "reliability-block-diagram",
  保障组织结构建模: "support-organization",
  备件建模: "spare-part",
  保障人员建模: "support-personnel",
  保障设备建模: "support-equipment",
  基本保障活动建模: "basic-support-activity",
  使用保障活动建模: "operations-support-activity",
  预防性维修活动建模: "preventive-maintenance-activity",
  修复性维修活动建模: "corrective-maintenance-activity",
  后勤保障活动建模: "logistics-support-activity",
  RMS分配方案编辑: "rms-allocation",
  数据管理: "project-data-management",
  建模颗粒度管理: "modeling-granularity-management",
  装备RMS指标分配: "equipment-rms-allocation",
  用户管理: "user-management",
  系统功能权限管理: "function-permission-management",
  建模表单管理: "modeling-form-management",
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
  ["系统管理", "项目管理", "数据管理", "数据管理"],
  ["系统管理", "项目管理", "建模颗粒度管理", "建模颗粒度管理"],
  ["系统管理", "装备RMS指标分配", "装备RMS指标分配", "装备RMS指标分配"],
  ["系统管理", "系统基础配置", "用户管理", "用户管理"],
  ["系统管理", "系统基础配置", "系统功能权限管理", "系统功能权限管理"],
  ["系统管理", "系统基础配置", "建模表单管理", "建模表单管理"],
  ["备件规划评估模块", "仿真建模", "装备系统建模", "装备组成建模"],
  ["备件规划评估模块", "仿真建模", "装备系统建模", "装备故障建模"],
  ["备件规划评估模块", "仿真建模", "装备任务建模", "基本任务建模"],
  ["备件规划评估模块", "仿真建模", "装备任务建模", "复合任务建模"],
  ["备件规划评估模块", "仿真建模", "装备任务建模", "周期性任务建模"],
  ["备件规划评估模块", "仿真建模", "装备任务建模", "基本作战单元建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障组织结构建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "备件建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障人员建模"],
  ["备件规划评估模块", "仿真建模", "保障组织建模", "保障设备建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "基本保障活动建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "使用保障活动建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "预防性维修活动建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "修复性维修活动建模"],
  ["备件规划评估模块", "仿真建模", "保障活动建模", "后勤保障活动建模"],
  ["备件规划评估模块", "仿真实验", "仿真实验方案管理", "方案列表"],
  ["备件规划评估模块", "仿真实验", "仿真实验方案管理", "方案编辑"],
  ["备件规划评估模块", "仿真实验", "可视化推演", "可视化实验启动与停止"],
  ["备件规划评估模块", "仿真实验", "蒙特卡洛实验", "蒙特卡洛实验配置"],
  ["备件规划评估模块", "结果分析", "蒙特卡洛实验结果", "蒙特卡洛实验结果"],
  ["备件规划评估模块", "结果分析", "备件短板分析", "备件短板分析"],
  ["备件规划评估模块", "结果分析", "飞机转场携行清单分析", "飞机转场携行清单分析"],
  ["任务可靠度评估模块", "仿真建模", "装备系统建模", "装备组成建模"],
  ["任务可靠度评估模块", "仿真建模", "装备系统建模", "装备故障建模"],
  ["任务可靠度评估模块", "仿真建模", "装备系统建模", "装备可靠性框图建模"],
  ["任务可靠度评估模块", "仿真建模", "装备任务建模", "基本任务建模"],
  ["任务可靠度评估模块", "仿真建模", "装备任务建模", "复合任务建模"],
  ["任务可靠度评估模块", "仿真建模", "装备任务建模", "周期性任务建模"],
  ["任务可靠度评估模块", "仿真建模", "装备任务建模", "基本作战单元建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障组织结构建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "备件建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障人员建模"],
  ["任务可靠度评估模块", "仿真建模", "保障组织建模", "保障设备建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "基本保障活动建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "使用保障活动建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "预防性维修活动建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "修复性维修活动建模"],
  ["任务可靠度评估模块", "仿真建模", "保障活动建模", "后勤保障活动建模"],
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
  "spare-planning-mission-profile": "spare-planning-composite-task",
  "mission-reliability-mission-profile": "mission-reliability-composite-task",
  "spare-planning-support-resource-demand": "spare-planning-basic-support-activity",
  "mission-reliability-support-resource-demand": "mission-reliability-basic-support-activity",
  "spare-planning-operations-support-plan": "spare-planning-operations-support-activity",
  "mission-reliability-operations-support-plan": "mission-reliability-operations-support-activity",
  "spare-planning-preventive-maintenance-plan": "spare-planning-preventive-maintenance-activity",
  "mission-reliability-preventive-maintenance-plan": "mission-reliability-preventive-maintenance-activity",
  "spare-planning-corrective-maintenance-plan": "spare-planning-corrective-maintenance-activity",
  "mission-reliability-corrective-maintenance-plan": "mission-reliability-corrective-maintenance-activity",
  "spare-planning-scenario-switch": "spare-planning-visual-start-stop",
  "spare-planning-visual-results": "spare-planning-visual-start-stop",
  "mission-reliability-scenario-switch": "mission-reliability-visual-start-stop",
  "mission-reliability-visual-results": "mission-reliability-visual-start-stop",
  "system-management-project-management": "system-management-project-data-management",
  "system-management-system-basic-config": "system-management-user-management",
  "mission-reliability-rms-allocation": "system-management-equipment-rms-allocation"
};

function resolveComponent(name, secondary, tertiary) {
  if (name === "方案列表") return "experiment-plan-list";
  if (name === "方案编辑") return "experiment-plan-editor";
  if (name.includes("可靠性框图")) return "reliability-block-diagram";
  if (name.includes("RMS分配") || name.includes("RMS指标分配")) return "rms-allocation";
  if (secondary === "项目管理") return "system-project-management";
  if (secondary === "系统基础配置") return "system-basic-config";
  if (tertiary === "可视化推演") return "visual-simulation";
  if (name.includes("可视化")) return "visual-simulation";
  if (name.includes("场景切换")) return "scenario-switch";
  if (name.includes("蒙特卡洛实验配置")) return "monte-carlo-config";
  if (name.includes("蒙特卡洛实验结果")) return "monte-carlo-results";
  if (secondary === "结果分析") return "analysis";
  if (name.includes("仿真实验方案")) return "experiment-form";
  if (tertiary === "保障活动建模") return "activity-gantt";
  if (tertiary === "保障组织建模") return "resource-table";
  if (tertiary === "装备系统建模") return "equipment-table";
  return "task-model";
}

function resolveDataObjects(name, secondary, tertiary) {
  if (name.includes("内置场景")) return ["scenarioId", "airports", "missionAreas", "supportNodes"];
  if (name.includes("作战单元")) return ["combatUnit", "equipment", "supportNodes"];
  if (name.includes("基本任务")) return ["basicMission", "missionPhases"];
  if (name.includes("任务剖面参数")) return ["missionProfile"];
  if (name.includes("复合任务")) return ["missionProfile", "basicMission"];
  if (name.includes("周期性任务")) return ["missionProfile", "missionPhases"];
  if (name.includes("装备组成")) return ["equipment", "components"];
  if (name.includes("装备故障")) return ["components", "failureModel"];
  if (name.includes("可靠性框图")) return ["reliabilityBlockDiagram", "components"];
  if (name.includes("RMS分配") || name.includes("RMS指标分配")) return ["rmsAllocationPlan", "equipmentNodes", "missionExposure", "allocationResults"];
  if (name.includes("数据管理")) return ["projects", "projectDataSets", "dataOwnership"];
  if (name.includes("建模颗粒度")) return ["modelingLevels", "modelingObjects", "objectRelations"];
  if (name.includes("用户管理")) return ["users", "roles", "organizations"];
  if (name.includes("功能权限")) return ["features", "roles", "permissionRules"];
  if (name.includes("建模表单")) return ["formLevels", "formFields", "formRelations"];
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
