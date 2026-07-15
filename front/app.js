import {
  FEATURE_PAGES,
  getAccessibleFeaturePageById,
  getDefaultFeaturePageIdForRole,
  getFeaturePageById,
  getVisibleFeaturePagesForRole,
  groupFeaturePages
} from "./feature-catalog.mjs";
import { normalizeAviationSupportState } from "./aviation-support-state.mjs";
import {
  buildBackendProjectJson,
  buildPreviewResultState,
  buildFrontendResultState,
  createBackendApiClient,
  normalizeProjectJsonBasicMissions,
  normalizeProjectJsonForClientDraft
} from "./api-client.mjs";
import {
  normalizeAnalysisProjectionPayload,
  projectionArtifactKindForAnalysisType
} from "./analysis-projection-adapters.mjs";
import {
  createDefaultCurrentAnalysisProfiles,
  createEmptyCurrentAnalysisResult,
  createEmptyCurrentAnalysisResults,
  currentAnalysisProfileForType as getCurrentAnalysisProfileForType,
  formalProjectionFromCurrentResult,
  normalizeBackendCurrentAnalysisResult,
  transitionCurrentAnalysisResult
} from "./current-analysis-results.mjs";
import {
  findVisualizationStateSeriesArtifact,
  buildVisualizationEventStream,
  mergeVisualizationStateStreamFrame,
  nextReplayIndex,
  normalizeVisualizationStateSeriesPayload
} from "./state-series-replay.mjs";
import { buildRunIntent, submitRunIntent } from "./run-intent.mjs";
import {
  buildSolaraVisualizationUrl,
  resolveSolaraVisualizationBaseUrl
} from "./solara-visualization.mjs";
import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo
} from "./sim-engine.mjs";
import {
  allowedSupportActivityDurationDistributions,
  normalizeSupportActivityDurationProfile,
  supportActivityJobFromBasicActivity
} from "./support-activity-jobs.mjs";
import {
  buildReliabilityBlockDiagramLayout,
  reliabilityDiagramProjectForSelection
} from "./rbd-evaluator.mjs?v=20260628-rbd-child-selection-view";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  createRmsAllocationFailureResult,
  normalizeRmsEquipmentImportRows,
  rmsEquipmentRoots,
  selectRmsAllocationEquipmentRoot
} from "./rms-allocation-engine.mjs";
import { renderRmsAllocationWorkbench } from "./rms-allocation-workbench.mjs";
import {
  projectToModelingImportPackage,
  validateModelingImportPackage
} from "./modeling-import-contract.mjs";
import {
  buildModelingImportPreview,
  cloneModelingImportPackage,
  normalizeModelingImportRecord
} from "./modeling-import-workbench.mjs";
import { MODELING_IMPORT_DEMO_FIXTURE } from "./modeling-import-demo-fixture.mjs";
import {
  ensurePublishedModelingImportForSampleProject,
  publishModelingImportWithReferencedVersionFallback,
  sampleImportPackageIsComplete
} from "./modeling-import-project-flow.mjs";
import {
  addEquipmentNodeForSelectionModel,
  buildEquipmentComponentTreeModel,
  componentBelongsToAircraftModel,
  deleteEquipmentNodeForSelectionModel,
  equipmentComponentsForSelectionModel,
  equipmentKOutOfNQuantity,
  normalizeEquipmentComponentKOutOfN,
  validateEquipmentComponentKOutOfN,
  resolveEquipmentSelectionModel,
  wholeMachineModelsForScenario
} from "./equipment-tree-model.mjs";

const app = document.querySelector("#app");
const FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY = "aircraft_support_v1";
const LAST_BACKEND_RUN_STORAGE_KEY = "spare-mvp:lastBackendRun";
const AUTH_SESSION_STORAGE_KEY = "spare-mvp:m4Session";
const LAST_PUBLISHED_MODELING_IMPORT_STORAGE_KEY = "spare-mvp:lastPublishedModelingImportId";
const SYSTEM_RUNTIME_CONFIG_KEY = "system-runtime-support";
const PROJECT_DRAFT_AUTOSAVE_DELAY_MS = 800;
let backendAuthToken = readStoredBackendAuthToken();
const backendApi = createBackendApiClient({ baseUrl: "/api", getAuthToken: () => backendAuthToken });
const DEFAULT_ROUTE = "login";
const DEFAULT_FEATURE_ID = "spare-planning-equipment-system";
const DEMO_USERS = [
  { username: "admin", role: "系统管理员" },
  { username: "data", role: "数据管理员" },
  { username: "user", role: "普通用户" }
];
const PROJECT_SOURCE = Object.freeze({
  imported_sample: "imported_sample"
});
const DEFAULT_MONTE_CARLO_SWEEP = Object.freeze({
  failureRates: [0.06],
  spareMultipliers: [1],
  supportCapacities: [1]
});
const LITE_MESA_MONTE_CARLO_METRICS = Object.freeze([
  { key: "mission_success_rate", label: "任务成功率", format: "ratio" },
  { key: "ready_rate", label: "战备完好率", format: "ratio" },
  { key: "sortie_rate", label: "出动架次率", format: "ratio" },
  { key: "spare_fill_rate", label: "备件满足率", format: "ratio" },
  { key: "mean_transport_delay", label: "平均备件延误时间", format: "number" },
  { key: "repair_backlog", label: "维修积压", format: "number" }
]);
const LITE_MESA_ANALYSIS_DEFINITIONS = Object.freeze({
  spare_shortfall: {
    experimentId: "project_baseline_at_current_granularity",
    title: "备件短板分析",
    subtitle: "基于当前项目建模数据的短缺事件统计",
    settingSubject: "当前项目建模数据",
    settingMethod: "短缺事件统计",
    metricLabels: ["发生缺件备件", "平均备件延误时间(h)", "最高缺件备件", "因维修延误导致的任务取消次数"]
  },
  carry_list: {
    experimentId: "minimum_carry_list_search",
    title: "飞机转场携行清单分析",
    subtitle: "按备件类别独立变化的最小携行清单搜索",
    settingSubject: "备件类别独立变化",
    settingMethod: "最小携行清单搜索",
    metricLabels: ["建议携行总数", "高优先级备件"]
  },
  mission_reliability: {
    experimentId: "project_baseline_at_current_granularity",
    title: "任务可靠度评估",
    subtitle: "任务成功概率、出动架次率和目标达成统计",
    settingSubject: "任务维度与时间维度",
    settingMethod: "目标达成统计",
    metricLabels: ["任务成功率", "出动架次率", "战备完好率", "任务失败次数"]
  },
  downtime_factors: {
    experimentId: "project_baseline_at_current_granularity",
    title: "停机因素分析",
    subtitle: "停机贡献因素排序和保障延误定位",
    settingSubject: "停机与保障延误事件",
    settingMethod: "贡献因素排序",
    metricLabels: ["停机因素项", "首要因素", "最高贡献度"]
  }
});
let demoProjects = [];
let deletedDowntimeSnapshotIds = new Set();
const ANALYSIS_PROJECTION_TYPES = [
  { analysisType: "spare_shortfall", artifactKind: "analysis_projection_spare_shortfall", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "carry_list", artifactKind: "analysis_projection_carry_list", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "mission_reliability", artifactKind: "analysis_projection_mission_reliability", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "downtime_factors", artifactKind: "analysis_projection_downtime_factors", source_artifact_id: "monte_carlo_base_artifact" }
];
const backendControlActions = {
  "backend-cancel": "cancel",
  "backend-retry": "retry",
  "backend-pause": "pause",
  "backend-resume": "resume",
  "backend-step": "step",
  "backend-reset": "reset"
};
const backendControlLabels = {
  cancel: "取消运行",
  retry: "重试运行",
  pause: "后端暂停",
  resume: "后端恢复",
  step: "后端单步",
  reset: "后端重置"
};
const AIRCRAFT_TREND_SERIES = [
  { key: "available", label: "可用飞机", description: "不处于维修状态", stateClass: "available" },
  { key: "mission", label: "任务中", description: "正在执行任务", stateClass: "flying" },
  { key: "maintenance", label: "维修中", description: "修复或预防性维修", stateClass: "maintenance" },
  { key: "support", label: "使用保障中", description: "飞行前或航后保障", stateClass: "support" }
];
const PERSONNEL_SPECIALTY_FALLBACK = ["机务", "航电", "液压", "动力", "军械", "保障调度"];
const SYSTEM_SUPPORT_MODULE_NAME = "系统运行支持模块";
const MODELING_GRANULARITY_FULL = "full-elements";
const MODELING_GRANULARITY_EQUIPMENT_RMS = "equipment-rms";
const DEFAULT_MODELING_GRANULARITY = MODELING_GRANULARITY_FULL;
const MODELING_PAGE_LOCK_MESSAGE = "当前建模颗粒度未启用该表，建模内容只读。";
const EQUIPMENT_RMS_EXCLUDED_SHEET_KEYS = new Set([
  "support-organization-structure",
  "spares",
  "support-personnel",
  "support-equipment",
  "basic-support-activity",
  "operations-support-activity",
  "preventive-maintenance-activity",
  "corrective-maintenance-activity",
  "logistics-support-activity"
]);
const MODELING_PAGE_SHEET_KEY_BY_NAME = {
  保障组织结构建模: "support-organization-structure",
  备件建模: "spares",
  保障人员建模: "support-personnel",
  保障设备建模: "support-equipment",
  基本保障活动建模: "basic-support-activity",
  使用保障活动建模: "operations-support-activity",
  预防性维修活动建模: "preventive-maintenance-activity",
  修复性维修活动建模: "corrective-maintenance-activity",
  后勤保障活动建模: "logistics-support-activity",
  装备系统建模: "equipment-system",
  装备可靠性框图建模: "reliability-block-diagram"
};
const LOCKED_MODELING_CLICK_SELECTORS = [
  "[data-support-org-add-node]",
  "[data-support-org-delete-node]",
  "[data-support-resource-add]",
  "[data-support-resource-batch-delete]",
  "[data-logistics-transport-add]",
  "[data-logistics-transport-delete]",
  "[data-support-activity-plan-add]",
  "[data-support-activity-plan-delete]",
  "[data-preventive-activity-plan-add]",
  "[data-preventive-activity-plan-delete]",
  "[data-support-activity-job-add]",
  "[data-support-activity-job-batch-delete]",
  "[data-support-activity-job-template]",
  "[data-support-activity-job-template-select]",
  "[data-support-activity-job]",
  "[data-support-activity-predecessor-edit]",
  "[data-support-activity-job-delete]",
  "[data-basic-activity-add]",
  "[data-basic-activity-batch-delete]",
  "[data-basic-activity-edit]",
  "[data-basic-activity-dialog-save]",
  "[data-basic-activity-resource-dialog-open]",
  "[data-basic-activity-resource-dialog-add]",
  "[data-basic-activity-resource-dialog-delete]",
  "[data-basic-activity-import-type]",
  "[data-basic-activity-delete]"
];
const LOCKED_MODELING_CHANGE_SELECTORS = [
  "[data-support-resource-import-file]",
  "[data-basic-activity-select-all]",
  "[data-basic-activity-select]",
  "[data-basic-activity-resource-field]",
  "[data-basic-activity-resource-dialog-field]",
  "[data-basic-activity-field]",
  "[data-support-resource-select-all]",
  "[data-support-resource-select]",
  "[data-support-resource-field]",
  "[data-support-activity-job-select-all]",
  "[data-support-activity-job-select]",
  "[data-logistics-transport-select]",
  "[data-support-activity-predecessor-toggle]",
  "[data-support-activity-job-field]",
  "[data-support-org-field]",
  "[data-path]"
];
const MODELING_DATA_MODULES = [
  {
    key: "equipment-system",
    label: "装备系统",
    description: "覆盖装备组成、故障和可靠性框图的建模输入。",
    sheets: [
      {
        key: "equipment-system",
        label: "装备系统表",
        sourcePage: "装备系统建模",
        fields: [
          fieldDef("equipmentId", "装备ID", "components[].id"),
          fieldDef("componentName", "组件名称", "components[].name"),
          fieldDef("parentId", "父节点", "components[].parentId"),
          fieldDef("quantity", "数量n", "components[].quantity"),
          fieldDef("componentAttribute", "组件属性", "components[].productType"),
          fieldDef("kOutOfN", "可用数量要求k（n中取k）", "components[].kOutOfN.k"),
          fieldDef("mtbfHours", "MTBF", "components[].mtbfHours"),
          fieldDef("mtbfDistributionType", "MTBF-分布类型", "components[].failureDistribution.distributionType"),
          fieldDef("mttrMinutes", "MTTR（min）", "components[].meanRepairTimeMinutes"),
          fieldDef("mttrDistributionType", "MTTR-分布类型", "components[].repairDistribution.distributionType")
        ]
      },
      {
        key: "reliability-block-diagram",
        label: "装备可靠性框图表",
        sourcePage: "装备可靠性框图建模",
        fields: [
          fieldDef("nodeId", "节点ID", "reliabilityBlockDiagram.nodes[].id"),
          fieldDef("upstreamNode", "上游节点", "reliabilityBlockDiagram.edges[].source"),
          fieldDef("downstreamNode", "下游节点", "reliabilityBlockDiagram.edges[].target"),
          fieldDef("logicType", "逻辑关系", "reliabilityBlockDiagram.nodes[].logic"),
          fieldDef("reliabilityParameter", "可靠度参数", "reliabilityBlockDiagram.nodes[].reliability")
        ]
      }
    ]
  },
  {
    key: "equipment-task",
    label: "装备任务",
    description: "覆盖作战单元、基本任务、复合任务和周期任务。",
    sheets: [
      {
        key: "combat-unit",
        label: "基本作战单元表",
        sourcePage: "基本作战单元建模",
        fields: [
          fieldDef("unitId", "单元ID", "combatUnit.unitId"),
          fieldDef("unitName", "单元名称", "combatUnit.name"),
          fieldDef("equipmentType", "装备型号", "combatUnit.equipmentType"),
          fieldDef("equipmentQuantity", "装备数量", "combatUnit.quantity"),
          fieldDef("supportNodeId", "保障节点", "combatUnit.supportNodeId")
        ]
      },
      {
        key: "basic-mission",
        label: "基本任务表",
        sourcePage: "基本任务建模",
        fields: [
          fieldDef("missionId", "任务ID", "basicMissions[].missionId"),
          fieldDef("missionName", "任务名称", "basicMissions[].name"),
          fieldDef("equipmentType", "装备型号", "basicMissions[].equipmentType"),
          fieldDef("durationMinutes", "任务时长", "basicMissions[].taskDurationMinutes"),
          fieldDef("successPoint", "成功判据", "basicMissions[].successPoint")
        ]
      },
      {
        key: "composite-task",
        label: "复合任务表",
        sourcePage: "复合任务建模",
        fields: [
          fieldDef("priority", "任务优先级（1最高）", "compositeTasks[].priority"),
          fieldDef("basicTaskName", "基本任务名称", "compositeTasks[].taskItems[].basicTaskName"),
          fieldDef("groupName", "编队名称", "compositeTasks[].taskItems[].groupName"),
          fieldDef("firstWaveTime", "出发时间（HH：MM）", "compositeTasks[].taskItems[].firstWaveTime"),
          fieldDef("dailyRepeatCount", "单日重复次数", "compositeTasks[].taskItems[].dailyRepeatCount"),
          fieldDef("intervalHours", "间隔小时数", "compositeTasks[].taskItems[].intervalHours"),
          fieldDef("equipmentType", "装备类型", "compositeTasks[].taskItems[].equipmentType"),
          fieldDef("taskDurationMinutes", "任务时长", "compositeTasks[].taskItems[].taskDurationMinutes"),
          fieldDef("equipmentQuantity", "要求装备数量", "compositeTasks[].taskItems[].equipmentQuantity"),
          fieldDef("minRequiredSorties", "最小装备数量（继承）", "basicMissions[].minRequiredSorties")
        ]
      },
      {
        key: "periodic-task",
        label: "周期性任务表",
        sourcePage: "周期性任务建模",
        fields: [
          fieldDef("periodicTaskId", "周期任务ID", "periodicTasks[].id"),
          fieldDef("repeatCycle", "重复周期", "periodicTasks[].repeatCycleHours"),
          fieldDef("weekdayPlan", "星期计划", "periodicTasks[].weekdayPlan"),
          fieldDef("intervalHours", "间隔小时", "periodicTasks[].intervalHours"),
          fieldDef("dailyRepeatCount", "每日次数", "periodicTasks[].dailyRepeatCount")
        ]
      }
    ]
  },
  {
    key: "support-organization",
    label: "保障组织",
    description: "覆盖保障组织结构、备件、人员和保障设备。",
    sheets: [
      {
        key: "support-organization-structure",
        label: "保障组织结构表",
        sourcePage: "保障组织结构建模",
        fields: [
          fieldDef("nodeId", "节点ID", "supportNodes[].id"),
          fieldDef("nodeName", "节点名称", "supportNodes[].name"),
          fieldDef("nodeType", "节点类型", "supportNodes[].nodeType"),
          fieldDef("airport", "所属机场", "supportNodes[].airport"),
          fieldDef("organizationStrategy", "组织策略", "supportNodes[].organizationStrategy")
        ]
      },
      {
        key: "spares",
        label: "备件表",
        sourcePage: "备件建模",
        fields: [
          fieldDef("spareId", "备件ID", "supportResources[].id"),
          fieldDef("spareName", "备件名称", "supportResources[].name"),
          fieldDef("equipmentId", "适用装备", "supportResources[].equipment"),
          fieldDef("stockQty", "库存量", "supportResources[].quantity"),
          fieldDef("supportNodeName", "所属保障点", "supportResources[].supportNodeName")
        ]
      },
      {
        key: "support-personnel",
        label: "保障人员表",
        sourcePage: "保障人员建模",
        fields: [
          fieldDef("personnelType", "人员类型", "supportResources[].type"),
          fieldDef("specialty", "专业", "supportResources[].model"),
          fieldDef("nodeId", "所属节点", "supportResources[].supportNodeName"),
          fieldDef("capacity", "能力人数", "supportResources[].quantity"),
          fieldDef("resourceName", "资源名称", "supportResources[].name")
        ]
      },
      {
        key: "support-equipment",
        label: "保障设备表",
        sourcePage: "保障设备建模",
        fields: [
          fieldDef("resourceId", "保障设备ID", "supportNodes[].equipmentCapacity[].id"),
          fieldDef("resourceName", "设备名称", "supportNodes[].equipmentCapacity[].name"),
          fieldDef("nodeId", "所属节点", "supportNodes[].equipmentCapacity[].nodeId"),
          fieldDef("quantity", "数量", "supportNodes[].equipmentCapacity[].quantity"),
          fieldDef("availability", "可用率", "supportNodes[].equipmentCapacity[].availability")
        ]
      }
    ]
  },
  {
    key: "support-activity",
    label: "保障活动",
    description: "覆盖基础、使用、维修和后勤保障活动。",
    sheets: [
      {
        key: "basic-support-activity",
        label: "基本保障活动表",
        sourcePage: "基本保障活动建模",
        fields: [
          fieldDef("activityId", "活动ID", "supportActivities[].id"),
          fieldDef("activityName", "活动名称", "supportActivities[].activityName"),
          fieldDef("aircraftModel", "装备型号", "supportActivities[].aircraftModel"),
          fieldDef("durationHours", "持续时间", "supportActivities[].durationHours"),
          fieldDef("resourceIds", "所需资源", "supportActivities[].resourceIds")
        ]
      },
      {
        key: "operations-support-activity",
        label: "使用保障活动表",
        sourcePage: "使用保障活动建模",
        fields: [
          fieldDef("planType", "方案类型", "supportActivities[].operations.planType"),
          fieldDef("waveId", "保障批次", "supportActivities[].operations.waveId"),
          fieldDef("preparationMinutes", "准备时间", "supportActivities[].operations.preparationMinutes"),
          fieldDef("resourcePackage", "资源组合", "supportActivities[].operations.resourcePackage"),
          fieldDef("predecessors", "前置活动", "supportActivities[].predecessors")
        ]
      },
      {
        key: "preventive-maintenance-activity",
        label: "预防性维修活动表",
        sourcePage: "预防性维修活动建模",
        fields: [
          fieldDef("cycle", "周期", "supportActivities[].preventive.cycle"),
          fieldDef("maintenanceItem", "维修项", "supportActivities[].preventive.item"),
          fieldDef("intervalHours", "间隔小时", "supportActivities[].preventive.intervalHours"),
          fieldDef("personnelDemand", "人员需求", "supportActivities[].preventive.personnelDemand"),
          fieldDef("spareDemand", "备件需求", "supportActivities[].preventive.spareDemand")
        ]
      },
      {
        key: "corrective-maintenance-activity",
        label: "修复性维修活动表",
        sourcePage: "修复性维修活动建模",
        fields: [
          fieldDef("failureItem", "故障项", "supportActivities[].corrective.failureItem"),
          fieldDef("repairHours", "修复时长", "supportActivities[].corrective.repairHours"),
          fieldDef("repairResources", "维修资源", "supportActivities[].corrective.resources"),
          fieldDef("replacementParts", "替换件", "supportActivities[].corrective.replacementParts"),
          fieldDef("restoreCondition", "恢复条件", "supportActivities[].corrective.restoreCondition")
        ]
      },
      {
        key: "logistics-support-activity",
        label: "后勤保障活动表",
        sourcePage: "后勤保障活动建模",
        fields: [
          fieldDef("logisticsTaskId", "补给任务", "supportActivities[].logistics.taskId"),
          fieldDef("sourceNodeId", "来源节点", "supportActivities[].logistics.sourceNodeId"),
          fieldDef("targetNodeId", "目标节点", "supportActivities[].logistics.targetNodeId"),
          fieldDef("transportHours", "运输时长", "supportActivities[].logistics.transportHours"),
          fieldDef("supplyQuantity", "补给数量", "supportActivities[].logistics.supplyQuantity")
        ]
      }
    ]
  }
];

let systemUsers = [
  { username: "admin", name: "系统管理员", role: "系统管理员", status: "启用" },
  { username: "data", name: "数据管理员", role: "数据管理员", status: "启用" },
  { username: "user", name: "普通用户", role: "项目用户", status: "启用" }
];

let selectedSystemUsernames = new Set();
let permissionConfigFeature = "";
let permissionConfigStatus = "请选择权限项配置角色权限";
let selectedSystemDataKeys = new Set(modelingSheetRows().map((row) => row.key));
let selectedModelingGranularityKey = DEFAULT_MODELING_GRANULARITY;
let selectedModelingFieldKeys = new Set(modelingGranularityFieldKeys(DEFAULT_MODELING_GRANULARITY));
let systemDataStatus = "已按仿真建模模块加载默认 sheet 勾选，可在局部表格触发导入和校验。";
let modelingFieldStatus = "默认使用全要素建模颗粒度，字段勾选由颗粒度自动维护。";
let systemDataExportPreview = null;
let systemRuntimeConfigLoaded = false;
let systemRuntimeConfigStatus = "系统配置尚未同步";
let systemUserSearchText = "";
let modelingFormFieldUnits = createDefaultModelingFormFieldUnits();
let personnelSpecialtyDraft = "";

const SYSTEM_PERMISSION_ROWS = [
  { feature: "项目管理", admin: "编辑", data: "编辑", user: "只读" },
  { feature: "装备RMS指标分配", admin: "编辑", data: "编辑", user: "只读" },
  { feature: "系统基础配置", admin: "编辑", data: "只读", user: "只读" },
  { feature: "仿真建模", admin: "编辑", data: "编辑", user: "编辑" },
  { feature: "结果分析", admin: "只读", data: "只读", user: "只读" }
];

function mergeProjectsById(projects) {
  const byId = new Map();
  for (const project of projects) {
    if (!project || !project.id) continue;
    const normalized = {
      id: String(project.id),
      name: project.name || "未命名项目",
      baseCode: project.baseCode || "NB",
      updatedAt: normalizeProjectUpdatedAt(project.updatedAt),
      summary: project.summary || "未设置项目说明。",
      sourceKind: Object.values(PROJECT_SOURCE).includes(project.sourceKind) ? project.sourceKind : PROJECT_SOURCE.imported_sample,
      sourceImportId: project.sourceImportId || "",
      isTemplate: isProjectDataTemplate(project),
      projectBackendId: project.projectBackendId
        || project.project_id
        || (String(project.id).startsWith("project-") ? String(project.id) : `project-${project.id}`)
    };
    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }
  return Array.from(byId.values());
}

function toProjectFromBackendApiEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const projectId = String(entry.project_id || "").trim();
  if (!projectId) return null;
  return {
    id: projectId.replace(/^project-/, ""),
    name: entry.experiment_name || "未命名项目",
    baseCode: entry.base_code || "NB",
    summary: entry.summary || "后端持久化项目",
    updatedAt: normalizeProjectUpdatedAt(entry.updated_at),
    sourceKind: PROJECT_SOURCE.imported_sample,
    sourceImportId: entry.source_import_id || entry.sourceImportId || "",
    isTemplate: Boolean(entry.is_template || entry.isTemplate),
    scenarioId: entry.scenario_id || "",
    projectBackendId: projectId
  };
}

function normalizeProjectUpdatedAt(updatedAt) {
  if (typeof updatedAt === "string" && updatedAt.trim()) {
    return updatedAt.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function readLastPublishedModelingImportId() {
  try {
    return String(localStorage.getItem(LAST_PUBLISHED_MODELING_IMPORT_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function persistLastPublishedModelingImportId(importId) {
  const normalized = String(importId || "").trim();
  if (!normalized) return;
  localStorage.setItem(LAST_PUBLISHED_MODELING_IMPORT_STORAGE_KEY, normalized);
}


let scenario = cloneScenario(defaultScenario);
let experimentPlanDraft = cloneScenario(scenario);
let experimentPlanBranchActive = false;
let selectedScenarioCompositionPath = "";
let lastRunExperimentPlanProjectJson = null;
let selectedMonteCarloExperimentId = "";
let monteCarloExperiments = createDefaultMonteCarloExperiments();
let analysisProjectionPayloads = {};
let analysisProjectionPayloadErrors = {};
let currentAnalysisProfiles = createDefaultCurrentAnalysisProfiles();
let currentAnalysisResults = createEmptyCurrentAnalysisResults(currentAnalysisProfiles);
let currentAnalysisResultLoaded = {};
let currentAnalysisResultLoadInFlight = {};
let { previewSingleResult: singleResult, previewMonteCarloResult: monteCarloResult } = buildPreviewResultState(scenario);
let liteMesaMonteCarloSettings = {
  samples: Number(scenario.experiment?.samples || 4),
  seed: Number(scenario.experiment?.seed || 20260621)
};
let liteMesaMonteCarloResult = null;
let liteMesaMonteCarloStatus = "设置样本量和随机种子后运行分析。";
let liteMesaAnalysisSettings = createDefaultLiteMesaAnalysisSettings();
let liteMesaAnalysisResults = {};
let rmsAllocationProject = createDemoRmsAllocationProject();
let rmsAllocationPlan = createDefaultRmsAllocationPlan(rmsAllocationProject);
let rmsAllocationResult = calculateRmsAllocation(rmsAllocationPlan, rmsAllocationProject);
let rmsEquipmentImportStatus = "当前装备树为 RMS 分配工作台独立数据，未写入项目建模。";
let modelingImportPackage = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
let modelingImportPublishedPackage = null;

function scenarioEquipmentModel() {
  return scenario.equipment?.model || "";
}
let modelingImportValidation = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE.validation);
let modelingImportCompileResult = null;
let modelingImportStatus = "样例导入包已加载";
let modelingImportSaved = false;
let publishedModelingImportPackages = [];
let publishedModelingImportPackagesLoaded = false;
let publishedModelingImportPackagesLoading = false;
let selectedPublishedModelingImportId = readLastPublishedModelingImportId();
let publishedImportStatus = "已发布导入包尚未加载";
let savedProject = null;
let modelingSnapshot = null;
let experimentPlan = null;
let backendExperimentPlans = [];
let backendExperimentPlansProjectId = "";
let backendExperimentPlansLoaded = false;
let backendExperimentPlansLoadInFlight = false;
let experimentPlanListStatus = "仿真实验方案列表尚未加载";
let experimentPlanManagementMode = "list";
let projectDraftSaveStatus = "未保存";
let projectDraftHydrateStatus = "";
let projectDraftAutosaveTimer = null;
let projectDraftLastSavedAt = "";
let backendRun = null;
let backendRunResult = null;
let backendArtifactManifest = null;
let backendRunChain = null;
let m7RunList = [];
let m7RunDetail = null;
let m7SelectedRunId = "";
let m7RunArtifactStatus = "M7 运行产物账本尚未加载";
let visualizationRunList = [];
let visualizationRunListLoaded = false;
let visualizationRunListLoadInFlight = false;
let visualizationSelectedRunId = "";
let visualizationStateSeries = null;
let visualizationReplayIndex = 0;
let visualizationReplayPlaying = false;
let visualizationReplayTimer = null;
let visualizationReplayStatus = "M9 离线状态序列尚未加载";
let independentMesaVisualizationInFlight = false;
let visualizationStreamSource = null;
let visualizationStreamState = {
  runId: "",
  status: "idle",
  message: "M9.2 在线状态流尚未订阅",
  eventCount: 0,
  lastEventAt: "",
  artifactId: ""
};
let visualizationBackendControlStatus = "M9.3 后端运行控制尚未触发";
let visualSupportAirportId = "";
let solaraVisualizationReloadNonce = 0;
let solaraVisualizationProjectIdOverride = "";
let backendApiStatus = "离线演示";
let formalRunSubmitInFlight = false;
let systemUserEditor = null;
let systemUsersLoadStatus = "未加载";
let systemUsersLoaded = false;
let isLoggedIn = false;
let currentUser = DEMO_USERS[2];
let currentProject = demoProjects[0] || null;
let projectListStatus = "请选择项目模板创建项目。";
let selectedProjectTemplateProjectId = "";
let selectedProjectDataProjectId = "";
let selectedProjectDataProjectJson = null;
let selectedProjectDataProjectJsonId = "";
let projectDataProjectJsonLoading = false;
let projectDataManagementStatus = "选择项目查看 Project JSON。";
let projectReplacementPreview = null;
let projectEditorDraft = null;
let selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
let selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
let selectedMesaView = "aircraft";
let selectedVisualAircraftId = "";
let collapsedTreeNodes = new Set();
let experimentRunStatus = "当前";
let selectedExperimentPlanKeys = new Set();
let selectedRunContextKey = "";
let isProjectMenuOpen = false;
let selectedPeriodicTaskId = "";
let selectedPeriodicWeekIndex = 1;
let periodicActiveProfile = "week";
let selectedPeriodicProfileIds = { week: "", month: "", year: "" };
let periodicProfileRenameState = null;
let selectedEquipmentComponentIndex = 0;
let selectedEquipmentNodeKey = "";
let equipmentSearchQuery = "";
let spareDemandSort = "default";
let carryHideZeroDemand = true;
let selectedBasicMissionKey = "primary";
let selectedBasicMissionTreeLevel = "mission";
let selectedBasicMissionEquipmentType = primaryBasicMissionRecord().equipmentType || scenarioEquipmentModel() || "";
let selectedBasicMissionPhaseIndexes = new Set();
let selectedCompositeTaskId = "";
let selectedCombatUnitMemberIndex = 0;
let selectedSupportOrgNodeId = "";
let selectedSupportActivityJobKeys = new Set();
let selectedLogisticsTransportStrategyIndexes = new Set();
let supportActivityJobDialogKey = "";
let supportActivityPredecessorDialogKey = "";
let selectedOperationsSupportActivityKey = "";
let selectedOperationsSupportAircraftModel = "";
let selectedOperationsSupportPlanType = "直接准备方案";
let selectedPreventiveMaintenanceActivityKey = "";
let selectedPreventiveMaintenanceAircraftModel = "";
let selectedSupportResourceKeys = new Set();
let supportResourceImportStatus = "可在当前资源清单导入 CSV / TSV / JSON 表格。";
let equipmentImportStatus = "可导入 CSV / TSV / JSON 装备结构表。";
let selectedBasicActivityKeys = new Set();
let basicActivityDialogKey = "";
let basicActivityResourceDialog = null;
const BASIC_ACTIVITY_DRAFT_KEY = "__new_basic_activity__";
let basicActivityDraft = null;
let basicActivityQuery = "";
let supportActivityTemplateQuery = "";
let supportActivityTemplatePickerTabKey = "";
let supportActivityPredecessorQuery = "";
let selectedBasicActivityImportType = "使用保障活动";
let selectedCorrectiveComponentId = "";

const PERIODIC_WEEKDAY_FIELDS = [
  { key: "mondayCompositeTaskId", legacyKey: "monday", label: "周一" },
  { key: "tuesdayCompositeTaskId", legacyKey: "tuesday", label: "周二" },
  { key: "wednesdayCompositeTaskId", legacyKey: "wednesday", label: "周三" },
  { key: "thursdayCompositeTaskId", legacyKey: "thursday", label: "周四" },
  { key: "fridayCompositeTaskId", legacyKey: "friday", label: "周五" },
  { key: "saturdayCompositeTaskId", legacyKey: "saturday", label: "周六" },
  { key: "sundayCompositeTaskId", legacyKey: "sunday", label: "周日" }
];

const PERIODIC_DAY_FIELDS = Array.from({ length: 30 }, (_, index) => ({
  value: String(index + 1),
  label: `第${index + 1}天`
}));

function importedDataEmptyState(label) {
  return `
    <div class="empty-state">
      <strong>暂无${htmlEscape(label)}数据</strong>
      <p>请先导入并发布建模 JSON，或在当前页面创建数据。</p>
    </div>
  `;
}

function supportOrganizationTree() {
  const tree = scenario.supportOrganization?.tree;
  if (tree && typeof tree === "object" && !Array.isArray(tree)) return [tree];
  if (Array.isArray(tree) && tree.length) {
    scenario.supportOrganization.tree = tree[0];
    return [scenario.supportOrganization.tree];
  }
  return buildSupportOrganizationTreeFromNodes();
}

function buildSupportOrganizationTreeFromNodes() {
  const supportNodes = Array.isArray(scenario.supportNodes) ? scenario.supportNodes : [];
  if (!supportNodes.length) return buildEmptySupportOrganizationTree();
  const root = {
    id: "support-org-root",
    name: "保障组织",
    description: "由导入项目保障节点生成的初始组织树",
    children: supportNodes.map((node) => ({
      id: node.organizationNodeId || node.id || `support-node-${node.name}`,
      name: node.name || node.nodeType || "保障节点",
      description: node.organizationStrategy || node.policy || node.nodeType || "",
      supportNodeId: node.id,
      children: []
    }))
  };
  if (!scenario.supportOrganization || typeof scenario.supportOrganization !== "object") {
    scenario.supportOrganization = {};
  }
  scenario.supportOrganization.tree = root;
  return [scenario.supportOrganization.tree];
}

function buildEmptySupportOrganizationTree() {
  const root = {
    id: "support-org-root",
    name: "保障组织",
    description: "空白项目默认保障组织，可在此维护组织、人员、设备和备件资源。",
    children: []
  };
  if (!scenario.supportOrganization || typeof scenario.supportOrganization !== "object") {
    scenario.supportOrganization = {};
  }
  scenario.supportOrganization.tree = root;
  return [scenario.supportOrganization.tree];
}

function supportActivityPlanForPage(page, activity) {
  const type = page.name;
  const aircraftModels = wholeMachineModels();
  const activityName = activity?.activityName || type;
  const activityModel = supportActivityAircraftModel(activity) || scenarioEquipmentModel() || "";
  if (type.includes("使用")) {
    const planNodesByModel = new Map();
    for (const model of aircraftModels.length ? aircraftModels : [activityModel].filter(Boolean)) {
      planNodesByModel.set(model, []);
    }
    for (const option of operationsSupportActivityOptions()) {
      const model = option.aircraftModel || activityModel || aircraftModels[0] || "未指定机型";
      if (!planNodesByModel.has(model)) planNodesByModel.set(model, []);
      planNodesByModel.get(model).push({
        id: `operations-plan:${model}:${option.value}`,
        name: option.label,
        editablePlanKey: option.key,
        children: []
      });
    }
    if (!Array.from(planNodesByModel.values()).some((nodes) => nodes.length)) {
      const model = activityModel || aircraftModels[0] || "未指定机型";
      planNodesByModel.set(model, [{
        id: `operations-plan:${model}:${activityName}`,
        name: activityName,
        editablePlanKey: selectedOperationsSupportActivityKey,
        children: []
      }]);
    }
    return {
      type,
      treeTitle: `${type}树`,
      path: [type, activityName],
      tree: {
        id: "support-activity-aircraft-list",
        name: "飞机列表",
        children: Array.from(planNodesByModel.entries()).map(([model, plans]) => ({
        id: `support-activity-aircraft:${model}`,
        name: model,
        selectableAircraftModel: model,
        children: plans
      }))
      }
    };
  }
  if (type.includes("预防性")) {
    const planNodesByModel = new Map();
    for (const model of aircraftModels.length ? aircraftModels : [activityModel].filter(Boolean)) {
      planNodesByModel.set(model, []);
    }
    for (const option of preventiveMaintenanceActivityEntries()) {
      const model = option.aircraftModel || activityModel || aircraftModels[0] || "未指定机型";
      if (!planNodesByModel.has(model)) planNodesByModel.set(model, []);
      planNodesByModel.get(model).push({
        id: `preventive-plan:${model}:${option.value}`,
        name: option.label,
        editablePreventivePlanKey: option.key,
        children: []
      });
    }
    return {
      type,
      treeTitle: `${type}树`,
      path: [type, activityName],
      tree: {
        id: "support-activity-aircraft-list",
        name: "飞机列表",
        children: Array.from(planNodesByModel.entries()).map(([model, plans]) => ({
          id: `support-activity-aircraft:${model}`,
          name: model,
          selectablePreventiveAircraftModel: model,
          children: plans
        }))
      }
    };
  }
  const activityNode = (model = "") => ({
    id: activity?.id || `support-activity:${type}${model ? `:${model}` : ""}`,
    name: activityName,
    children: supportActivityJobs(activity || {}).map((job, index) => ({
      id: `${activity?.id || "activity"}:job:${index}`,
      name: job.workName || job.activityCode || `工作项目${index + 1}`
    }))
  });
  return {
    type,
    treeTitle: page.name.includes("基本") ? "基本保障活动清单" : `${type}树`,
    path: [type, activityName],
    tree: {
      id: "support-activity-aircraft-list",
      name: "飞机列表",
      children: aircraftModels.length ? aircraftModels.map((model) => ({
        id: `support-activity-aircraft:${model}`,
        name: model,
        children: [activityNode(model)]
      })) : [activityNode()]
    }
  };
}

render();
bindEvents();
restoreStoredBackendSessionOnBoot().finally(() => hydrateLastBackendRunFromApi());

function bindEvents() {
  window.addEventListener("hashchange", () => {
    selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
    selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
    createExperimentPlanBranchFromCurrentProject();
    render();
  });

  app.addEventListener("click", (event) => {
    const clickedTreeToggleIcon = event.target.closest(".tree-node-toggle");
    if (lockedModelingEventTarget(event.target, LOCKED_MODELING_CLICK_SELECTORS)) {
      event.preventDefault?.();
      return;
    }

    const equipmentAddNodeButton = event.target.closest("[data-equipment-add-node]");
    if (equipmentAddNodeButton) {
      addEquipmentNodeForSelection();
      markProjectDraftChanged();
      render();
      return;
    }

    const equipmentDeleteNodeButton = event.target.closest("[data-equipment-delete-node]");
    if (equipmentDeleteNodeButton) {
      deleteSelectedEquipmentNode();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionAddButton = event.target.closest("[data-basic-mission-add]");
    if (basicMissionAddButton) {
      addBasicMission();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionDeleteButton = event.target.closest("[data-basic-mission-delete]");
    if (basicMissionDeleteButton) {
      deleteSelectedBasicMission();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionPhaseAddButton = event.target.closest("[data-basic-mission-phase-add]");
    if (basicMissionPhaseAddButton) {
      addMissionPhase();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionPhaseBatchDeleteButton = event.target.closest("[data-basic-mission-phase-batch-delete]");
    if (basicMissionPhaseBatchDeleteButton) {
      deleteSelectedMissionPhases();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionPhaseDeleteButton = event.target.closest("[data-basic-mission-phase-delete]");
    if (basicMissionPhaseDeleteButton) {
      deleteMissionPhase(Number(basicMissionPhaseDeleteButton.dataset.basicMissionPhaseDelete));
      markProjectDraftChanged();
      render();
      return;
    }

    const basicMissionNode = event.target.closest("[data-select-basic-mission]");
    if (basicMissionNode && !clickedTreeToggleIcon) {
      const candidateBasicMissionKey = basicMissionNode.dataset.selectBasicMission;
      const selectedMission = editableBasicMissionRecords().find((record) => record.key === candidateBasicMissionKey);
      if (selectedMission) {
        selectedBasicMissionKey = candidateBasicMissionKey;
        selectedBasicMissionTreeLevel = "mission";
        selectedBasicMissionEquipmentType = selectedMission?.task?.equipmentType || selectedBasicMissionEquipmentType;
        render();
      }
      return;
    }

    const basicMissionEquipmentNode = event.target.closest("[data-select-basic-mission-equipment]");
    if (basicMissionEquipmentNode) {
      selectedBasicMissionEquipmentType = basicMissionEquipmentNode.dataset.selectBasicMissionEquipment;
      const selectedEquipmentMission = editableBasicMissionRecords().find((record) => record.task.equipmentType === selectedBasicMissionEquipmentType);
      selectedBasicMissionKey = selectedEquipmentMission?.key || "primary";
      selectedBasicMissionTreeLevel = "equipment";
      toggleTreeNodeFromElement(clickedTreeToggleIcon);
      render();
      return;
    }

    const compositeTaskAddButton = event.target.closest("[data-composite-task-add]");
    if (compositeTaskAddButton) {
      addCompositeTask();
      markProjectDraftChanged();
      render();
      return;
    }

    const compositeTaskDeleteButton = event.target.closest("[data-composite-task-delete]");
    if (compositeTaskDeleteButton) {
      deleteSelectedCompositeTask();
      markProjectDraftChanged();
      render();
      return;
    }

    const compositeTaskItemAddButton = event.target.closest("[data-composite-task-item-add]");
    if (compositeTaskItemAddButton) {
      addCompositeTaskItem();
      markProjectDraftChanged();
      render();
      return;
    }

    const compositeTaskItemDeleteButton = event.target.closest("[data-composite-task-item-delete]");
    if (compositeTaskItemDeleteButton) {
      deleteCompositeTaskItem(Number(compositeTaskItemDeleteButton.dataset.compositeTaskItemDelete));
      markProjectDraftChanged();
      render();
      return;
    }

    const compositeTaskRow = event.target.closest("[data-select-composite-task]");
    if (compositeTaskRow) {
      selectCompositeTaskRow(compositeTaskRow);
      return;
    }

    const supportOrgNode = event.target.closest("[data-select-support-org-node]");
    if (supportOrgNode && !clickedTreeToggleIcon) {
      selectedSupportOrgNodeId = supportOrgNode.dataset.selectSupportOrgNode;
      render();
      return;
    }

    const supportOrgAddButton = event.target.closest("[data-support-org-add-node]");
    if (supportOrgAddButton) {
      addSupportOrgNode();
      markProjectDraftChanged();
      render();
      return;
    }

    const supportOrgDeleteButton = event.target.closest("[data-support-org-delete-node]");
    if (supportOrgDeleteButton) {
      deleteSelectedSupportOrgNode();
      markProjectDraftChanged();
      render();
      return;
    }

    const supportResourceBatchDeleteButton = event.target.closest("[data-support-resource-batch-delete]");
    if (supportResourceBatchDeleteButton) {
      deleteSelectedSupportResources();
      markProjectDraftChanged();
      render();
      return;
    }

    const combatUnitAddButton = event.target.closest("[data-combat-unit-add]");
    if (combatUnitAddButton) {
      addCombatUnitMember();
      markProjectDraftChanged();
      render();
      return;
    }

    const combatUnitDeleteButton = event.target.closest("[data-combat-unit-delete]");
    if (combatUnitDeleteButton) {
      deleteSelectedCombatUnitMember();
      markProjectDraftChanged();
      render();
      return;
    }

    const combatUnitMemberSelect = event.target.closest("[data-select-combat-unit-member]");
    if (combatUnitMemberSelect) {
      selectedCombatUnitMemberIndex = Number(combatUnitMemberSelect.dataset.selectCombatUnitMember);
      render();
      return;
    }

    const equipmentRootNode = event.target.closest("[data-select-equipment-root]");
    if (equipmentRootNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = "aircraft-list";
      render();
      return;
    }

    const equipmentAircraftNode = event.target.closest("[data-select-equipment-aircraft]");
    if (equipmentAircraftNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = `aircraft:${equipmentAircraftNode.dataset.selectEquipmentAircraft}`;
      render();
      return;
    }

    const equipmentComponentNode = event.target.closest("[data-select-equipment-component]");
    if (equipmentComponentNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = `component:${equipmentComponentNode.dataset.selectEquipmentComponent}`;
      selectedEquipmentComponentIndex = clampEquipmentComponentIndex(findEquipmentComponentIndexById(equipmentComponentNode.dataset.selectEquipmentComponent));
      render();
      return;
    }

    const rbdEquipmentRootNode = event.target.closest("[data-select-rbd-equipment-root]");
    if (rbdEquipmentRootNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = "aircraft-list";
      render();
      return;
    }

    const rbdEquipmentAircraftNode = event.target.closest("[data-select-rbd-equipment-aircraft]");
    if (rbdEquipmentAircraftNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = `aircraft:${rbdEquipmentAircraftNode.dataset.selectRbdEquipmentAircraft}`;
      render();
      return;
    }

    const rbdEquipmentComponentNode = event.target.closest("[data-select-rbd-equipment-component]");
    if (rbdEquipmentComponentNode && !clickedTreeToggleIcon) {
      selectedEquipmentNodeKey = `component:${rbdEquipmentComponentNode.dataset.selectRbdEquipmentComponent}`;
      selectedEquipmentComponentIndex = clampEquipmentComponentIndex(findEquipmentComponentIndexById(rbdEquipmentComponentNode.dataset.selectRbdEquipmentComponent));
      render();
      return;
    }

    const correctiveComponentNode = event.target.closest("[data-select-corrective-component]");
    if (correctiveComponentNode && !clickedTreeToggleIcon) {
      selectedCorrectiveComponentId = correctiveComponentNode.dataset.selectCorrectiveComponent;
      selectedSupportActivityJobKeys = new Set();
      render();
      return;
    }

    const treeToggle = event.target.closest("[data-tree-toggle]");
    if (treeToggle) {
      toggleTreeNodeFromElement(treeToggle);
      render();
      return;
    }

    const logisticsAddButton = event.target.closest("[data-logistics-transport-add]");
    if (logisticsAddButton) {
      ensureLogisticsSupportActivityDraft();
      const transportPolicies = ensureTransportPolicies();
      const transportIndex = transportPolicies.length;
      transportPolicies.push(defaultLogisticsTransportPolicy(transportIndex));
      selectedLogisticsTransportStrategyIndexes = new Set([transportIndex]);
      markProjectDraftChanged();
      render();
      return;
    }

    const logisticsDeleteButton = event.target.closest("[data-logistics-transport-delete]");
    if (logisticsDeleteButton) {
      scenario.transportPolicies = ensureTransportPolicies()
        .filter((_, rowIndex) => !selectedLogisticsTransportStrategyIndexes.has(rowIndex));
      selectedLogisticsTransportStrategyIndexes = new Set();
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityPlanDeleteButton = event.target.closest("[data-support-activity-plan-delete]");
    if (supportActivityPlanDeleteButton) {
      deleteOperationsSupportActivityPlan(supportActivityPlanDeleteButton.dataset.supportActivityPlanDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const preventiveActivityPlanDeleteButton = event.target.closest("[data-preventive-activity-plan-delete]");
    if (preventiveActivityPlanDeleteButton) {
      deletePreventiveMaintenanceActivityPlan(preventiveActivityPlanDeleteButton.dataset.preventiveActivityPlanDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityPlanAddButton = event.target.closest("[data-support-activity-plan-add]");
    if (supportActivityPlanAddButton) {
      addOperationsSupportActivityPlan();
      markProjectDraftChanged();
      render();
      return;
    }

    const preventiveActivityPlanAddButton = event.target.closest("[data-preventive-activity-plan-add]");
    if (preventiveActivityPlanAddButton) {
      addPreventiveMaintenanceActivityPlan();
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityPlanSelectButton = event.target.closest("[data-select-support-activity-plan]");
    if (supportActivityPlanSelectButton) {
      selectOperationsSupportActivityPlan(supportActivityPlanSelectButton.dataset.selectSupportActivityPlan);
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const preventiveActivityPlanSelectButton = event.target.closest("[data-select-preventive-activity-plan]");
    if (preventiveActivityPlanSelectButton) {
      selectPreventiveMaintenanceActivityPlan(preventiveActivityPlanSelectButton.dataset.selectPreventiveActivityPlan);
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const operationsSupportAircraftSelectButton = event.target.closest("[data-select-operations-support-aircraft-model]");
    if (operationsSupportAircraftSelectButton) {
      selectOperationsSupportAircraftModel(operationsSupportAircraftSelectButton.dataset.selectOperationsSupportAircraftModel);
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const preventiveAircraftSelectButton = event.target.closest("[data-select-preventive-aircraft-model]");
    if (preventiveAircraftSelectButton) {
      selectPreventiveMaintenanceAircraftModel(preventiveAircraftSelectButton.dataset.selectPreventiveAircraftModel);
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const supportActivityPhaseTabButton = event.target.closest("[data-ops-support-plan-type]");
    if (supportActivityPhaseTabButton) {
      selectedOperationsSupportPlanType = supportActivityPhaseTabButton.dataset.opsSupportPlanType || "直接准备方案";
      selectedSupportActivityJobKeys = new Set();
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const supportActivityJobDialogCloseButton = event.target.closest("[data-support-activity-job-dialog-close]");
    if (supportActivityJobDialogCloseButton) {
      supportActivityJobDialogKey = "";
      render();
      return;
    }

    const supportActivityPredecessorDialogCloseButton = event.target.closest("[data-support-activity-predecessor-dialog-close]");
    if (supportActivityPredecessorDialogCloseButton) {
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const supportActivityJobDeleteButton = event.target.closest("[data-support-activity-job-delete]");
    if (supportActivityJobDeleteButton) {
      if (supportActivityJobDialogKey === supportActivityJobDeleteButton.dataset.supportActivityJobDelete) {
        supportActivityJobDialogKey = "";
      }
      if (supportActivityPredecessorDialogKey === supportActivityJobDeleteButton.dataset.supportActivityJobDelete) {
        supportActivityPredecessorDialogKey = "";
      }
      deleteSupportActivityJob(supportActivityJobDeleteButton.dataset.supportActivityJobDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobAddButton = event.target.closest("[data-support-activity-job-add]");
    if (supportActivityJobAddButton) {
      supportActivityTemplatePickerTabKey = supportActivityJobAddButton.dataset.supportActivityJobAdd || "";
      supportActivityTemplateQuery = "";
      render();
      return;
    }

    const supportActivityBatchDeleteButton = event.target.closest("[data-support-activity-job-batch-delete]");
    if (supportActivityBatchDeleteButton) {
      deleteSelectedSupportActivityJobs(supportActivityBatchDeleteButton.dataset.supportActivityJobBatchDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobTemplateButton = event.target.closest("[data-support-activity-job-template]");
    if (supportActivityJobTemplateButton) {
      applyBasicActivityToSupportActivityJob(
        supportActivityJobTemplateButton.dataset.supportActivityJobTemplate,
        supportActivityJobTemplateButton.dataset.basicActivityKey
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobTemplateSelect = event.target.closest("[data-support-activity-job-template-select]");
    if (supportActivityJobTemplateSelect) {
      applyBasicActivityToSupportActivityJob(
        supportActivityJobTemplateSelect.dataset.supportActivityJobTemplateSelect,
        supportActivityJobTemplateSelect.value
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobEditButton = event.target.closest("[data-support-activity-job]");
    if (supportActivityJobEditButton) {
      supportActivityJobDialogKey = selectSupportActivityJobForEdit(supportActivityJobEditButton.dataset.supportActivityJob) || "";
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }

    const supportActivityPredecessorEditButton = event.target.closest("[data-support-activity-predecessor-edit]");
    if (supportActivityPredecessorEditButton) {
      supportActivityJobDialogKey = "";
      supportActivityPredecessorDialogKey = selectSupportActivityJobForEdit(supportActivityPredecessorEditButton.dataset.supportActivityPredecessorEdit) || "";
      render();
      return;
    }

    const basicActivityAddButton = event.target.closest("[data-basic-activity-add]");
    if (basicActivityAddButton) {
      openBasicActivityDraftDialog();
      render();
      return;
    }

    const basicActivityBatchDeleteButton = event.target.closest("[data-basic-activity-batch-delete]");
    if (basicActivityBatchDeleteButton) {
      deleteSelectedBasicActivityJobs();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityEditButton = event.target.closest("[data-basic-activity-edit]");
    if (basicActivityEditButton) {
      selectedBasicActivityKeys = new Set([basicActivityEditButton.dataset.basicActivityEdit]);
      basicActivityDialogKey = basicActivityEditButton.dataset.basicActivityEdit || "";
      render();
      return;
    }

    const basicActivityDialogCloseButton = event.target.closest("[data-basic-activity-dialog-close]");
    if (basicActivityDialogCloseButton) {
      basicActivityDialogKey = "";
      basicActivityDraft = null;
      basicActivityResourceDialog = null;
      render();
      return;
    }

    const basicActivityDialogSaveButton = event.target.closest("[data-basic-activity-dialog-save]");
    if (basicActivityDialogSaveButton) {
      saveBasicActivityDraft();
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityResourceDialogOpenButton = event.target.closest("[data-basic-activity-resource-dialog-open]");
    if (basicActivityResourceDialogOpenButton) {
      basicActivityResourceDialog = {
        key: basicActivityResourceDialogOpenButton.dataset.basicActivityKey || basicActivityDialogKey,
        kind: basicActivityResourceDialogOpenButton.dataset.basicActivityResourceDialogOpen
      };
      render();
      return;
    }

    const basicActivityResourceDialogCloseButton = event.target.closest("[data-basic-activity-resource-dialog-close]");
    if (basicActivityResourceDialogCloseButton) {
      basicActivityResourceDialog = null;
      render();
      return;
    }

    const basicActivityResourceDialogAddButton = event.target.closest("[data-basic-activity-resource-dialog-add]");
    if (basicActivityResourceDialogAddButton) {
      addBasicActivityResourceRequirement(
        basicActivityResourceDialogAddButton.dataset.basicActivityKey,
        basicActivityResourceDialogAddButton.dataset.basicActivityResourceDialogAdd
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityResourceDialogDeleteButton = event.target.closest("[data-basic-activity-resource-dialog-delete]");
    if (basicActivityResourceDialogDeleteButton) {
      deleteBasicActivityResourceRequirement(
        basicActivityResourceDialogDeleteButton.dataset.basicActivityKey,
        basicActivityResourceDialogDeleteButton.dataset.basicActivityResourceKind,
        Number(basicActivityResourceDialogDeleteButton.dataset.basicActivityResourceIndex)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const supportResourceAddButton = event.target.closest("[data-support-resource-add]");
    if (supportResourceAddButton) {
      addSupportResource(supportResourceAddButton.dataset.supportResourceAdd);
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityImportButton = event.target.closest("[data-basic-activity-import-type]");
    if (basicActivityImportButton) {
      importBasicActivityByType(basicActivityImportButton.dataset.basicActivityImportType || selectedBasicActivityImportType);
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityDeleteButton = event.target.closest("[data-basic-activity-delete]");
    if (basicActivityDeleteButton) {
      deleteBasicActivityJob(basicActivityDeleteButton.dataset.basicActivityDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const loginButton = event.target.closest("[data-login-submit]");
    if (loginButton) {
      handleLogin().finally(() => render());
      return;
    }

    const logoutButton = event.target.closest("[data-logout]");
    if (logoutButton) {
      isLoggedIn = false;
      backendAuthToken = "";
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      selectedRoute = DEFAULT_ROUTE;
      location.hash = "route=login";
      render();
      return;
    }

    const createFromTemplateButton = event.target.closest("[data-project-create-from-template]");
    if (createFromTemplateButton) {
      createProjectFromSelectedProjectTemplate().finally(() => render());
      return;
    }

    const projectDataProjectButton = event.target.closest("[data-project-data-project-option]");
    if (projectDataProjectButton) {
      selectProjectDataProject(projectDataProjectButton.dataset.projectDataProjectOption);
      render();
      return;
    }

    const projectTemplateAction = event.target.closest("[data-project-template-action]");
    if (projectTemplateAction) {
      handleProjectTemplateAction(
        projectTemplateAction.dataset.projectTemplateAction,
        projectTemplateAction.dataset.projectId
      ).finally(() => render());
      return;
    }

    const projectReplacementConfirm = event.target.closest("[data-project-replacement-confirm]");
    if (projectReplacementConfirm) {
      confirmProjectReplacement().finally(() => render());
      return;
    }

    const projectReplacementCancel = event.target.closest("[data-project-replacement-cancel]");
    if (projectReplacementCancel) {
      projectReplacementPreview = null;
      projectDataManagementStatus = "已取消覆盖";
      render();
      return;
    }

    const exportProjectButton = event.target.closest("[data-project-export]");
    if (exportProjectButton) {
      exportProjectJson(exportProjectButton.dataset.projectExport).finally(() => render());
      return;
    }

    const editProjectButton = event.target.closest("[data-project-edit]");
    if (editProjectButton) {
      editDemoProject(editProjectButton.dataset.projectEdit);
      render();
      return;
    }

    const saveProjectEditButton = event.target.closest("[data-project-edit-save]");
    if (saveProjectEditButton) {
      saveProjectEditorDraft().finally(() => render());
      return;
    }

    const cancelProjectEditButton = event.target.closest("[data-project-edit-cancel]");
    if (cancelProjectEditButton) {
      projectEditorDraft = null;
      projectListStatus = "已取消项目编辑";
      render();
      return;
    }

    const deleteProjectButton = event.target.closest("[data-project-delete]");
    if (deleteProjectButton) {
      deleteDemoProject(deleteProjectButton.dataset.projectDelete).finally(() => render());
      return;
    }

    const systemManagementButton = event.target.closest("[data-system-management-entry]");
    if (systemManagementButton) {
      selectedRoute = "workbench";
      selectedFeatureId = accessibleFeaturePageId("system-management-project-data-management");
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const enterWorkbenchButton = event.target.closest("[data-enter-workbench]");
    if (enterWorkbenchButton) {
      return handleEnterWorkbench(enterWorkbenchButton.dataset.projectId).finally(() => render());
    }

    const projectMenuButton = event.target.closest("[data-project-menu-toggle]");
    if (projectMenuButton) {
      isProjectMenuOpen = !isProjectMenuOpen;
      render();
      return;
    }

    const projectListButton = event.target.closest("[data-project-list]");
    if (projectListButton) {
      selectedRoute = "projects";
      isProjectMenuOpen = false;
      location.hash = "route=projects";
      render();
      return;
    }

    const planListLink = event.target.closest("[data-plan-list-link]");
    if (planListLink) {
      const page = getFeaturePageById(selectedFeatureId);
      selectedRoute = "workbench";
      experimentPlanManagementMode = "list";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${getPlanListFeatureId(page.module)}`;
      render();
      return;
    }

    const liteMesaMonteCarloButton = event.target.closest("[data-lite-mesa-action='run']");
    if (liteMesaMonteCarloButton) {
      runLiteMesaMonteCarloAnalysis().finally(() => render());
      render();
      return;
    }

    const liteMesaAnalysisButton = event.target.closest("[data-lite-mesa-analysis-action='run']");
    if (liteMesaAnalysisButton) {
      runLiteMesaAnalysisPage(getFeaturePageById(selectedFeatureId)).finally(() => render());
      render();
      return;
    }

    const mesaViewButton = event.target.closest("[data-mesa-view]");
    if (mesaViewButton) {
      selectedMesaView = mesaViewButton.dataset.mesaView;
      render();
      return;
    }

    const visualAircraftButton = event.target.closest("[data-select-visual-aircraft]");
    if (visualAircraftButton) {
      selectedVisualAircraftId = visualAircraftButton.dataset.selectVisualAircraft;
      render();
      return;
    }

    const mesaControlButton = event.target.closest("[data-mesa-control]");
    if (mesaControlButton) {
      handleMesaControl(mesaControlButton.dataset.mesaControl).finally(() => render());
      return;
    }

    const mesaEventJumpButton = event.target.closest("[data-mesa-event-jump]");
    if (mesaEventJumpButton) {
      visualizationReplayIndex = Number(mesaEventJumpButton.dataset.mesaEventJump);
      visualizationReplayIndex = nextReplayIndex(visualizationStateSeries, visualizationReplayIndex, 0);
      stopVisualizationReplay();
      render();
      return;
    }

    const modelingImportActionButton = event.target.closest("[data-modeling-import-action]");
    if (modelingImportActionButton) {
      handleModelingImportAction(modelingImportActionButton.dataset.modelingImportAction, {
        importId: modelingImportActionButton.dataset.modelingImportId
      }).finally(() => render());
      return;
    }

    const projectDraftSaveButton = event.target.closest("[data-project-draft-save]");
    if (projectDraftSaveButton) {
      saveCurrentProjectDraftThroughApi().finally(() => render());
      return;
    }

    const systemUserActionButton = event.target.closest("[data-system-user-action]");
    if (systemUserActionButton) {
      handleSystemUserAction(systemUserActionButton.dataset.systemUserAction).finally(() => render());
      return;
    }

    const systemUserDeleteButton = event.target.closest("[data-system-user-delete]");
    if (systemUserDeleteButton) {
      deleteSystemUsers([systemUserDeleteButton.dataset.systemUserDelete]).finally(() => render());
      return;
    }

    const systemConfigSaveButton = event.target.closest("[data-system-config-save]");
    if (systemConfigSaveButton) {
      saveSystemRuntimeConfig(systemConfigSaveButton.dataset.systemConfigSave).finally(() => render());
      return;
    }

    const personnelSpecialtyAddButton = event.target.closest("[data-personnel-specialty-add]");
    if (personnelSpecialtyAddButton) {
      addPersonnelSpecialtyDraft();
      render();
      return;
    }

    const personnelSpecialtyDeleteButton = event.target.closest("[data-personnel-specialty-delete]");
    if (personnelSpecialtyDeleteButton) {
      deletePersonnelSpecialty(personnelSpecialtyDeleteButton.dataset.personnelSpecialtyDelete);
      render();
      return;
    }

    const systemDataExportButton = event.target.closest("[data-system-data-export]");
    if (systemDataExportButton) {
      exportSystemDataRows();
      render();
      return;
    }

    const permissionConfigureButton = event.target.closest("[data-permission-configure]");
    if (permissionConfigureButton) {
      permissionConfigFeature = permissionConfigureButton.dataset.permissionConfigure;
      permissionConfigStatus = `正在配置权限：${permissionConfigFeature}`;
      render();
      return;
    }

    const systemUserEditButton = event.target.closest("[data-system-user-edit]");
    if (systemUserEditButton) {
      openSystemUserEditor(systemUserEditButton.dataset.systemUserEdit);
      render();
      return;
    }

    const savePlanButton = event.target.closest("[data-save-plan]");
    if (savePlanButton) {
      saveCurrentExperimentPlanThroughApi().finally(() => render());
      return;
    }

    const scenarioOverrideAddButton = event.target.closest("[data-scenario-override-add]");
    if (scenarioOverrideAddButton) {
      scenarioCompositionDraft().overrides.push({ path: "", valueType: "string", value: "", label: "" });
      experimentPlanBranchActive = true;
      render();
      return;
    }

    const scenarioOverrideRemoveButton = event.target.closest("[data-scenario-override-remove]");
    if (scenarioOverrideRemoveButton) {
      const index = Number(scenarioOverrideRemoveButton.dataset.scenarioOverrideRemove);
      if (Number.isInteger(index) && index >= 0) {
        scenarioCompositionDraft().overrides.splice(index, 1);
        experimentPlanBranchActive = true;
      }
      render();
      return;
    }

    const scenarioModelingPathButton = event.target.closest("[data-scenario-modeling-path]");
    if (scenarioModelingPathButton) {
      selectedScenarioCompositionPath = scenarioModelingPathButton.dataset.scenarioModelingPath || "";
      render();
      return;
    }

    const m7RunArtifactButton = event.target.closest("[data-action^='m7-']");
    if (m7RunArtifactButton) {
      handleM7RunArtifactAction(m7RunArtifactButton).finally(() => render());
      return;
    }

    const singleRunButton = event.target.closest("[data-run-intent-single]");
    if (singleRunButton) {
      startLiteMesaVisualizationThroughApi().finally(() => render());
      return;
    }

    const periodicAddButton = event.target.closest("[data-periodic-add]");
    if (periodicAddButton) {
      const task = createPeriodicTaskDraft();
      scenario.missionProfile.periodicTasks = [...periodicTaskList(), task];
      selectedPeriodicTaskId = task.id;
      updatePreviewResultsThroughApiClient();
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicProfileTab = event.target.closest("[data-periodic-profile-tab]");
    if (periodicProfileTab) {
      periodicProfileRenameState = null;
      periodicActiveProfile = periodicProfileTab.dataset.periodicProfileTab || "week";
      render();
      return;
    }

    const periodicProfileAddButton = event.target.closest("[data-periodic-profile-add]");
    if (periodicProfileAddButton) {
      addPeriodicProfile(periodicProfileAddButton.dataset.periodicProfileAdd || periodicActiveProfile);
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicProfileRenameStartButton = event.target.closest("[data-periodic-profile-rename-start]");
    if (periodicProfileRenameStartButton) {
      beginPeriodicProfileRename(
        periodicProfileRenameStartButton.dataset.periodicProfileRenameStart,
        periodicProfileRenameStartButton.dataset.periodicProfileType || periodicActiveProfile
      );
      return;
    }

    const periodicProfileRenameSaveButton = event.target.closest("[data-periodic-profile-rename-save]");
    if (periodicProfileRenameSaveButton) {
      commitPeriodicProfileRename(app.querySelector?.("[data-periodic-profile-name]"));
      return;
    }

    const periodicProfileRenameCancelButton = event.target.closest("[data-periodic-profile-rename-cancel]");
    if (periodicProfileRenameCancelButton) {
      cancelPeriodicProfileRename();
      return;
    }

    const periodicProfileDeleteButton = event.target.closest("[data-periodic-profile-delete]");
    if (periodicProfileDeleteButton) {
      periodicProfileRenameState = null;
      deletePeriodicProfile(
        periodicProfileDeleteButton.dataset.periodicProfileDelete,
        periodicProfileDeleteButton.dataset.periodicProfileType || periodicActiveProfile
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicProfileSelectButton = event.target.closest("[data-periodic-profile-select]");
    if (periodicProfileSelectButton) {
      if (event.target.closest("[data-periodic-profile-name]")) return;
      const type = periodicProfileSelectButton.dataset.periodicProfileType || periodicActiveProfile;
      if (
        periodicProfileRenameState
        && (
          periodicProfileRenameState.type !== type
          || periodicProfileRenameState.id !== periodicProfileSelectButton.dataset.periodicProfileSelect
        )
      ) periodicProfileRenameState = null;
      selectedPeriodicProfileIds[type] = periodicProfileSelectButton.dataset.periodicProfileSelect || "";
      if (type === "week") selectedPeriodicTaskId = selectedPeriodicProfileIds.week;
      render();
      return;
    }

    const periodicCompositionAction = event.target.closest("[data-periodic-composition-action]");
    if (periodicCompositionAction) {
      updatePeriodicComposition(
        periodicCompositionAction.dataset.periodicCompositionType,
        periodicCompositionAction.dataset.periodicCompositionProfile,
        periodicCompositionAction.dataset.periodicCompositionAction,
        Number(periodicCompositionAction.dataset.periodicCompositionIndex || 0)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicYearAction = event.target.closest("[data-periodic-year-action]");
    if (periodicYearAction) {
      updatePeriodicYearList(
        periodicYearAction.dataset.periodicYearAction,
        periodicYearAction.dataset.periodicYearProfile
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicDeleteButton = event.target.closest("[data-periodic-delete-selected]");
    if (periodicDeleteButton) {
      const taskId = selectedPeriodicTaskId;
      scenario.missionProfile.periodicTasks = periodicTaskList().filter((task) => String(task.id) !== taskId);
      selectedPeriodicTaskId = String(periodicTaskList()[0]?.id || "");
      updatePreviewResultsThroughApiClient();
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicSelectButton = event.target.closest("[data-periodic-select]");
    if (periodicSelectButton) {
      selectedPeriodicTaskId = periodicSelectButton.dataset.periodicSelect;
      render();
      return;
    }

    const periodicWeekRow = event.target.closest("[data-periodic-select-week]");
    if (periodicWeekRow) {
      selectedPeriodicWeekIndex = Math.max(1, Math.floor(Number(periodicWeekRow.dataset.periodicSelectWeek || 1)));
      render();
      return;
    }

    const periodicRepeatButton = event.target.closest("[data-periodic-repeat]");
    if (periodicRepeatButton) {
      repeatSelectedPeriodicWeek(periodicRepeatButton.dataset.periodicRepeat);
      markProjectDraftChanged();
      render();
      return;
    }

    const rmsActionButton = event.target.closest("[data-rms-action]");
    if (rmsActionButton) {
      const action = rmsActionButton.dataset.rmsAction;
      if (action === "download-template") downloadRmsEquipmentTemplate();
      else if (action === "export-excel") exportRmsAllocationExcel().finally(() => render());
      else recalculateRmsAllocation();
      render();
      return;
    }

    const equipmentTemplateButton = event.target.closest("[data-equipment-download-template]");
    if (equipmentTemplateButton) {
      downloadEquipmentStructureTemplate();
      return;
    }

    const supportJobsTemplateButton = event.target.closest("[data-support-jobs-download-template]");
    if (supportJobsTemplateButton) {
      downloadSupportActivityJobsTemplate();
      return;
    }

    const analysisActionButton = event.target.closest("[data-analysis-action]");
    if (analysisActionButton) {
      const page = getFeaturePageById(selectedFeatureId);
      const action = analysisActionButton.dataset.analysisAction;
      if (action === "run-current") {
        runLiteMesaAnalysisPage(page).finally(() => render());
      }
      render();
      return;
    }

    const spareSortButton = event.target.closest("[data-spare-demand-sort]");
    if (spareSortButton) {
      spareDemandSort = spareSortButton.dataset.spareDemandSort || "default";
      render();
      return;
    }

    const downtimeSnapshotExportButton = event.target.closest("[data-downtime-snapshot-export]");
    if (downtimeSnapshotExportButton) {
      exportDowntimeAnomalySnapshots();
      render();
      return;
    }

    const downtimeSnapshotDeleteButton = event.target.closest("[data-downtime-snapshot-delete]");
    if (downtimeSnapshotDeleteButton) {
      deleteDowntimeAnomalySnapshot(downtimeSnapshotDeleteButton.dataset.downtimeSnapshotDelete || "");
      render();
      return;
    }

    const experimentPlanRefreshButton = event.target.closest("[data-experiment-plan-refresh]");
    if (experimentPlanRefreshButton) {
      refreshExperimentPlanList(currentBackendProjectId(), { force: true }).finally(() => render());
      return;
    }

    const experimentPlanAddButton = event.target.closest("[data-experiment-plan-add]");
    if (experimentPlanAddButton) {
      const page = getFeaturePageById(selectedFeatureId);
      openNewExperimentPlanEditor();
      selectedRoute = "workbench";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const experimentPlanEditButton = event.target.closest("[data-experiment-plan-edit]");
    if (experimentPlanEditButton) {
      const page = getFeaturePageById(selectedFeatureId);
      openExperimentPlanEditorFromList(
        experimentPlanEditButton.dataset.experimentPlanEdit || "",
        experimentPlanEditButton.dataset.experimentPlanName || ""
      );
      selectedRoute = "workbench";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const experimentPlanDeleteButton = event.target.closest("[data-experiment-plan-delete]");
    if (experimentPlanDeleteButton) {
      deleteExperimentPlanFromList(experimentPlanDeleteButton.dataset.experimentPlanDelete || "").finally(() => render());
      return;
    }

    const granularityProfileButton = event.target.closest("[data-granularity-profile-select]");
    if (granularityProfileButton) {
      applyModelingGranularityProfile(granularityProfileButton.dataset.granularityProfileSelect);
      render();
      return;
    }

    const featureButton = event.target.closest("[data-feature-id]");
    if (featureButton) {
      selectedRoute = "workbench";
      const selectedPage = accessibleFeaturePage(featureButton.dataset.featureId);
      selectedFeatureId = selectedPage.id;
      if (selectedPage.component === "experiment-plan-management") {
        experimentPlanManagementMode = "list";
      }
      if (selectedPage.component === "lite-mesa-monte-carlo-analysis" && selectedPage.tertiary === "蒙特卡洛实验") {
        syncLiteMesaSettingsFromMonteCarloExperiment(currentMonteCarloExperiment(selectedPage.module));
      }
      createExperimentPlanBranchFromCurrentProject();
      location.hash = `feature=${selectedFeatureId}`;
      render();
    }
  });

  app.addEventListener("keydown", (event) => {
    const periodicProfileNameInput = event.target.closest("[data-periodic-profile-name]");
    if (periodicProfileNameInput && event.key === "Enter") {
      event.preventDefault();
      commitPeriodicProfileRename(periodicProfileNameInput);
      return;
    }
    if (periodicProfileNameInput && event.key === "Escape") {
      event.preventDefault();
      cancelPeriodicProfileRename();
      return;
    }
    const periodicProfileItem = event.target.closest("[data-periodic-profile-select]");
    if (periodicProfileItem && event.key === "F2") {
      event.preventDefault();
      beginPeriodicProfileRename(
        periodicProfileItem.dataset.periodicProfileSelect,
        periodicProfileItem.dataset.periodicProfileType || periodicActiveProfile
      );
      return;
    }
    if (event.key === "Escape" && supportActivityPredecessorDialogKey) {
      supportActivityPredecessorDialogKey = "";
      render();
      return;
    }
    if (event.key === "Escape" && supportActivityJobDialogKey) {
      supportActivityJobDialogKey = "";
      render();
      return;
    }
    if (event.key === "Escape" && basicActivityDialogKey) {
      basicActivityDialogKey = "";
      basicActivityDraft = null;
      basicActivityResourceDialog = null;
      render();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const compositeTaskRow = event.target.closest("[data-select-composite-task]");
    if (compositeTaskRow) {
      event.preventDefault();
      selectCompositeTaskRow(compositeTaskRow);
    }
  });

  app.addEventListener("change", async (event) => {
    const projectReplacementFile = event.target.closest("[data-project-replacement-file]");
    if (projectReplacementFile) {
      await previewProjectReplacement(projectReplacementFile.files?.[0]);
      projectReplacementFile.value = "";
      render();
      return;
    }
    const carryZeroFilter = event.target.closest("[data-carry-hide-zero]");
    if (carryZeroFilter) {
      carryHideZeroDemand = carryZeroFilter.checked;
      render();
      return;
    }
    if (lockedModelingEventTarget(event.target, LOCKED_MODELING_CHANGE_SELECTORS)) {
      event.preventDefault?.();
      return;
    }

    const mesaSupportAirportSelect = event.target.closest("[data-mesa-support-airport]");
    if (mesaSupportAirportSelect) {
      visualSupportAirportId = mesaSupportAirportSelect.value;
      render();
      return;
    }

    const rmsEquipmentRootSelect = event.target.closest("[data-rms-equipment-root]");
    if (rmsEquipmentRootSelect) {
      setRmsEquipmentRoot(rmsEquipmentRootSelect.value);
      render();
      return;
    }

    const rmsEquipmentImportFile = event.target.closest("[data-rms-equipment-import-file]");
    if (rmsEquipmentImportFile) {
      await importRmsEquipmentTableFile(rmsEquipmentImportFile.files?.[0]);
      rmsEquipmentImportFile.value = "";
      render();
      return;
    }

    const equipmentImportFile = event.target.closest("[data-equipment-import-file]");
    if (equipmentImportFile) {
      const imported = await importEquipmentStructureTableFile(equipmentImportFile.files?.[0]);
      equipmentImportFile.value = "";
      if (imported) markProjectDraftChanged();
      render();
      return;
    }

    const supportJobsImportFile = event.target.closest("[data-support-jobs-import-file]");
    if (supportJobsImportFile) {
      await importSupportActivityJobsFile(supportJobsImportFile.dataset.supportJobsImportFile, supportJobsImportFile.files?.[0]);
      supportJobsImportFile.value = "";
      markProjectDraftChanged();
      render();
      return;
    }

    const supportResourceImportFile = event.target.closest("[data-support-resource-import-file]");
    if (supportResourceImportFile) {
      const imported = await importSupportResourceTableFile(
        supportResourceImportFile.files?.[0],
        supportResourceImportFile.dataset.supportResourceImportFile
      );
      supportResourceImportFile.value = "";
      if (imported) markProjectDraftChanged();
      render();
      return;
    }

    const projectTemplateSelect = event.target.closest("[data-project-template-select]");
    if (projectTemplateSelect) {
      updateSelectedProjectTemplateProject(projectTemplateSelect.value);
      render();
      return;
    }

    const modelingImportFile = event.target.closest("[data-modeling-import-file]");
    if (modelingImportFile) {
      await importModelingImportJsonFile(modelingImportFile.files?.[0]);
      modelingImportFile.value = "";
      render();
      return;
    }

    const liteMesaMonteCarloInput = event.target.closest("[data-lite-mesa-field]");
    if (liteMesaMonteCarloInput) {
      updateLiteMesaMonteCarloSetting(liteMesaMonteCarloInput.dataset.liteMesaField, parseInput(liteMesaMonteCarloInput));
      return;
    }

    const liteMesaAnalysisInput = event.target.closest("[data-lite-mesa-analysis-field]");
    if (liteMesaAnalysisInput) {
      updateLiteMesaAnalysisSetting(
        getFeaturePageById(selectedFeatureId),
        liteMesaAnalysisInput.dataset.liteMesaAnalysisField,
        parseInput(liteMesaAnalysisInput)
      );
      render();
      return;
    }

    const mesaTimeline = event.target.closest("[data-mesa-timeline]");
    if (mesaTimeline) {
      visualizationReplayIndex = nextReplayIndex(visualizationStateSeries, Number(mesaTimeline.value), 0);
      stopVisualizationReplay();
      render();
      return;
    }

    const basicMissionPhaseSelectAll = event.target.closest("[data-basic-mission-phase-select-all]");
    if (basicMissionPhaseSelectAll) {
      const phases = selectedBasicMissionPhases();
      selectedBasicMissionPhaseIndexes = basicMissionPhaseSelectAll.checked
        ? new Set(phases.map((_, index) => String(index)))
        : new Set();
      render();
      return;
    }

    const basicMissionPhaseSelect = event.target.closest("[data-basic-mission-phase-select]");
    if (basicMissionPhaseSelect) {
      const key = basicMissionPhaseSelect.dataset.basicMissionPhaseSelect;
      const next = new Set(selectedBasicMissionPhaseIndexes);
      if (basicMissionPhaseSelect.checked) next.add(key);
      else next.delete(key);
      selectedBasicMissionPhaseIndexes = next;
      render();
      return;
    }

    const basicActivitySelectAll = event.target.closest("[data-basic-activity-select-all]");
    if (basicActivitySelectAll) {
      toggleAllBasicActivitySelection(basicActivitySelectAll.checked);
      render();
      return;
    }

    const basicActivitySelect = event.target.closest("[data-basic-activity-select]");
    if (basicActivitySelect) {
      selectedBasicActivityKeys = toggleSetValue(selectedBasicActivityKeys, basicActivitySelect.dataset.basicActivitySelect);
      render();
      return;
    }

    const basicActivityResourceField = event.target.closest("[data-basic-activity-resource-field]");
    if (basicActivityResourceField) {
      const value = basicActivityResourceField.multiple
        ? Array.from(basicActivityResourceField.selectedOptions || []).map((option) => option.value)
        : parseInput(basicActivityResourceField);
      updateBasicActivityResourceField(
        basicActivityResourceField.dataset.basicActivityKey,
        basicActivityResourceField.dataset.basicActivityResourceField,
        value
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityResourceDialogField = event.target.closest("[data-basic-activity-resource-dialog-field]");
    if (basicActivityResourceDialogField) {
      updateBasicActivityResourceDialogField(
        basicActivityResourceDialogField.dataset.basicActivityKey,
        basicActivityResourceDialogField.dataset.basicActivityResourceKind,
        Number(basicActivityResourceDialogField.dataset.basicActivityResourceIndex),
        basicActivityResourceDialogField.dataset.basicActivityResourceDialogField,
        parseInput(basicActivityResourceDialogField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityField = event.target.closest("[data-basic-activity-field]");
    if (basicActivityField) {
      updateBasicActivityJobField(
        basicActivityField.dataset.basicActivityKey,
        basicActivityField.dataset.basicActivityField,
        parseInput(basicActivityField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const basicActivityImportTypeSelect = event.target.closest("[data-basic-activity-import-type-select]");
    if (basicActivityImportTypeSelect) {
      selectedBasicActivityImportType = basicActivityImportTypeSelect.value || selectedBasicActivityImportType;
      render();
      return;
    }

    const supportResourceSelectAll = event.target.closest("[data-support-resource-select-all]");
    if (supportResourceSelectAll) {
      toggleAllSupportResourceSelection(supportResourceSelectAll.dataset.supportResourceSelectAll, supportResourceSelectAll.checked);
      render();
      return;
    }

    const supportResourceSelect = event.target.closest("[data-support-resource-select]");
    if (supportResourceSelect) {
      selectedSupportResourceKeys = toggleSetValue(selectedSupportResourceKeys, supportResourceSelect.dataset.supportResourceSelect);
      render();
      return;
    }

    const supportResourceField = event.target.closest("[data-support-resource-field]");
    if (supportResourceField) {
      updateSupportResourceOverride(
        supportResourceField.dataset.supportResourceKey,
        supportResourceField.dataset.supportResourceField,
        parseInput(supportResourceField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const combatUnitFieldSelect = event.target.closest("[data-combat-unit-field]");
    if (combatUnitFieldSelect) {
      updateCombatUnitMemberField(
        Number(combatUnitFieldSelect.dataset.combatUnitIndex),
        combatUnitFieldSelect.dataset.combatUnitField,
        parseInput(combatUnitFieldSelect)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const systemUserSelectAll = event.target.closest("[data-system-user-select-all]");
    if (systemUserSelectAll) {
      const visibleUsers = filteredSystemUsers();
      selectedSystemUsernames = systemUserSelectAll.checked
        ? new Set(visibleUsers.map((user) => user.username))
        : new Set();
      render();
      return;
    }

    const systemUserSelect = event.target.closest("[data-system-user-select]");
    if (systemUserSelect) {
      selectedSystemUsernames = toggleSetValue(selectedSystemUsernames, systemUserSelect.dataset.systemUserSelect);
      render();
      return;
    }

    const systemDataSelectAll = event.target.closest("[data-system-data-select-all]");
    if (systemDataSelectAll) {
      const rows = currentSystemDataRows();
      selectedSystemDataKeys = systemDataSelectAll.checked
        ? new Set(rows.map((row) => row.key))
        : new Set();
      systemDataStatus = systemDataSelectAll.checked ? "已全选所有建模 sheet" : "已取消全部建模 sheet 勾选";
      render();
      return;
    }

    const systemDataModuleSelect = event.target.closest("[data-system-data-module-select]");
    if (systemDataModuleSelect) {
      const sheetKeys = moduleSheetKeys(systemDataModuleSelect.dataset.systemDataModuleSelect);
      const next = new Set(selectedSystemDataKeys);
      for (const key of sheetKeys) {
        if (systemDataModuleSelect.checked) next.add(key);
        else next.delete(key);
      }
      selectedSystemDataKeys = next;
      systemDataStatus = systemDataModuleSelect.checked ? "已勾选该建模模块全部 sheet" : "已取消该建模模块全部 sheet";
      render();
      return;
    }

    const systemDataSelect = event.target.closest("[data-system-data-select]");
    if (systemDataSelect) {
      selectedSystemDataKeys = toggleSetValue(selectedSystemDataKeys, systemDataSelect.dataset.systemDataSelect);
      const sheet = modelingSheetRows().find((row) => row.key === systemDataSelect.dataset.systemDataSelect);
      systemDataStatus = `${selectedSystemDataKeys.has(systemDataSelect.dataset.systemDataSelect) ? "已勾选" : "已取消"} ${sheet?.label || "建模 sheet"}`;
      render();
      return;
    }

    const modelingFieldSheetSelect = event.target.closest("[data-modeling-field-sheet-select]");
    if (modelingFieldSheetSelect) {
      modelingFieldStatus = "字段勾选由当前建模颗粒度自动维护，不能手工编辑。";
      render();
      return;
    }

    const modelingFieldSelect = event.target.closest("[data-modeling-field-select]");
    if (modelingFieldSelect) {
      modelingFieldStatus = "字段勾选由当前建模颗粒度自动维护，不能手工编辑。";
      render();
      return;
    }

    const permissionRoleSelect = event.target.closest("[data-permission-role]");
    if (permissionRoleSelect) {
      updatePermissionRole(permissionRoleSelect.dataset.permissionRole, permissionRoleSelect.value);
      render();
      return;
    }

    const modelingFormUnitSelect = event.target.closest("[data-modeling-form-unit]");
    if (modelingFormUnitSelect) {
      const key = modelingFormUnitSelect.dataset.modelingFormUnit;
      if (!modelingFormTimeUnitFieldKeys().has(key)) return;
      modelingFormFieldUnits = {
        ...normalizeModelingFormFieldUnits(modelingFormFieldUnits),
        [key]: modelingFormUnitSelect.value
      };
      systemRuntimeConfigStatus = "字段单位配置已更新，待保存";
      render();
      return;
    }

    const experimentPlanSelect = event.target.closest("[data-experiment-plan-select]");
    if (experimentPlanSelect) {
      toggleExperimentPlanSelection(experimentPlanSelect.dataset.experimentPlanSelect, experimentPlanSelect.checked);
      render();
      return;
    }

    const currentExperimentPlanSelect = event.target.closest("[data-current-experiment-plan]");
    if (currentExperimentPlanSelect) {
      selectCurrentExperimentPlan(currentExperimentPlanSelect.value);
      render();
      return;
    }

    const supportActivitySelectAll = event.target.closest("[data-support-activity-job-select-all]");
    if (supportActivitySelectAll) {
      toggleAllSupportActivityJobSelection(supportActivitySelectAll.dataset.supportActivityJobSelectAll, supportActivitySelectAll.checked);
      render();
      return;
    }

    const supportActivityJobSelect = event.target.closest("[data-support-activity-job-select]");
    if (supportActivityJobSelect) {
      toggleSupportActivityJobSelection(supportActivityJobSelect.dataset.supportActivityJobSelect, supportActivityJobSelect.checked);
      render();
      return;
    }

    const logisticsTransportSelect = event.target.closest("[data-logistics-transport-select]");
    if (logisticsTransportSelect) {
      toggleLogisticsTransportStrategySelection(Number(logisticsTransportSelect.dataset.logisticsTransportSelect), logisticsTransportSelect.checked);
      render();
      return;
    }

    const supportActivityPredecessorToggle = event.target.closest("[data-support-activity-predecessor-toggle]");
    if (supportActivityPredecessorToggle) {
      updateSupportActivityJobPredecessorSelection(
        supportActivityPredecessorToggle.dataset.supportActivityPredecessorKey,
        supportActivityPredecessorToggle.dataset.supportActivityPredecessorToggle,
        supportActivityPredecessorToggle.checked
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobField = event.target.closest("[data-support-activity-job-field]");
    if (supportActivityJobField) {
      updateSupportActivityJobField(
        supportActivityJobField.dataset.supportActivityJobKey,
        supportActivityJobField.dataset.supportActivityJobField,
        parseInput(supportActivityJobField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const supportOrgField = event.target.closest("[data-support-org-field]");
    if (supportOrgField) {
      updateSupportOrgField(
        supportOrgField.dataset.supportOrgNode,
        supportOrgField.dataset.supportOrgField,
        parseInput(supportOrgField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const equipmentAircraftModelInput = event.target.closest("[data-equipment-aircraft-model]");
    if (equipmentAircraftModelInput) {
      commitEquipmentAircraftModelInput(equipmentAircraftModelInput);
      return;
    }

    const periodicCompositionField = event.target.closest("[data-periodic-composition-field]");
    if (periodicCompositionField) {
      updatePeriodicCompositionField(
        periodicCompositionField.dataset.periodicCompositionType,
        periodicCompositionField.dataset.periodicCompositionProfile,
        Number(periodicCompositionField.dataset.periodicCompositionIndex || 0),
        periodicCompositionField.dataset.periodicCompositionField,
        parseInput(periodicCompositionField)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const periodicInput = event.target.closest("[data-periodic-field]");
    if (periodicInput) {
      markProjectDraftChanged();
      updateSelectedPeriodicTask(periodicInput.dataset.periodicField, parseInput(periodicInput));
      return;
    }

    const experimentPlanInput = event.target.closest("[data-experiment-plan-path]");
    if (experimentPlanInput) {
      experimentPlanBranchActive = true;
      setPath(experimentPlanDraft, experimentPlanInput.dataset.experimentPlanPath, parseInput(experimentPlanInput));
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const experimentSeedPolicySelect = event.target.closest("[data-experiment-seed-policy]");
    if (experimentSeedPolicySelect) {
      const policy = experimentPlanSeedPolicy();
      policy.mode = experimentSeedPolicySelect.value === "random" ? "random" : "fixed";
      if (policy.mode === "random") {
        policy.baseSeed = positiveExperimentSeed(policy.baseSeed || generatedExperimentSeed());
      }
      experimentPlanDraft.seedPolicy = policy;
      experimentPlanDraft.experiment = {
        ...(experimentPlanDraft.experiment || {}),
        seed: policy.baseSeed
      };
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const experimentSeedBaseInput = event.target.closest("[data-experiment-seed-base]");
    if (experimentSeedBaseInput) {
      const policy = experimentPlanSeedPolicy();
      policy.baseSeed = positiveExperimentSeed(parseInput(experimentSeedBaseInput));
      experimentPlanDraft.seedPolicy = policy;
      experimentPlanDraft.experiment = {
        ...(experimentPlanDraft.experiment || {}),
        seed: policy.baseSeed
      };
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const experimentStopModeSelect = event.target.closest("[data-experiment-stop-mode]");
    if (experimentStopModeSelect) {
      const policy = experimentPlanStopPolicy();
      policy.mode = experimentStopModeSelect.value === "and" ? "and" : "or";
      delete policy.defaulted;
      experimentPlanDraft.stopPolicy = policy;
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const experimentStopConditionInput = event.target.closest("[data-experiment-stop-condition]");
    if (experimentStopConditionInput) {
      const policy = experimentPlanStopPolicy();
      const type = normalizedExperimentStopConditionType(experimentStopConditionInput.dataset.experimentStopCondition);
      const existingMinute = policy.conditions.find((condition) => normalizedExperimentStopConditionType(condition.type) === "specifiedTime")?.minute;
      let conditions = policy.conditions.filter((condition) => normalizedExperimentStopConditionType(condition.type) !== type);
      if (experimentStopConditionInput.checked && type) {
        conditions.push(type === "specifiedTime" ? { type, minute: positiveExperimentStopMinute(existingMinute ?? 1440) } : { type });
      }
      policy.conditions = normalizedExperimentStopConditions(conditions);
      delete policy.defaulted;
      experimentPlanDraft.stopPolicy = policy;
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const experimentStopTimeInput = event.target.closest("[data-experiment-stop-time-minute]");
    if (experimentStopTimeInput) {
      const policy = experimentPlanStopPolicy();
      const hasSpecifiedTime = policy.conditions.some(
        (condition) => normalizedExperimentStopConditionType(condition.type) === "specifiedTime"
      );
      if (!hasSpecifiedTime) return;
      policy.conditions = policy.conditions.filter(
        (condition) => normalizedExperimentStopConditionType(condition.type) !== "specifiedTime"
      );
      policy.conditions.push({ type: "specifiedTime", minute: positiveExperimentStopMinute(parseInput(experimentStopTimeInput)) });
      delete policy.defaulted;
      experimentPlanDraft.stopPolicy = policy;
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const scenarioOverrideInput = event.target.closest("[data-scenario-override-path]")
      || event.target.closest("[data-scenario-override-value-type]")
      || event.target.closest("[data-scenario-override-value]")
      || event.target.closest("[data-scenario-override-label]");
    if (scenarioOverrideInput) {
      updateScenarioOverrideInput(scenarioOverrideInput);
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const selectedScenarioOverrideInput = event.target.closest("[data-scenario-selected-override-value]")
      || event.target.closest("[data-scenario-selected-override-value-type]");
    if (selectedScenarioOverrideInput) {
      updateSelectedScenarioOverrideInput(selectedScenarioOverrideInput);
      experimentPlanBranchActive = true;
      updatePreviewResultsThroughApiClient(experimentPlanDraft);
      render();
      return;
    }

    const rmsInput = event.target.closest("[data-rms-path]");
    if (rmsInput) {
      setPath(rmsAllocationPlan, rmsInput.dataset.rmsPath, parseInput(rmsInput));
      recalculateRmsAllocation();
      render();
      return;
    }

    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) {
      updateMonteCarloArrayInput(mcArrayInput);
      render();
      return;
    }

    const equipmentKOutOfNInput = event.target.closest("[data-equipment-k-out-of-n-index]");
    if (equipmentKOutOfNInput) {
      updateEquipmentKOutOfNInput(equipmentKOutOfNInput);
      render();
      return;
    }

    const input = event.target.closest("[data-path]");
    if (!input) return;
    setPath(scenario, input.dataset.path, parseInput(input));
    normalizeEquipmentKOutOfNForPath(input.dataset.path);
    updatePreviewResultsThroughApiClient();
    if (isCurrentModelingPage()) markProjectDraftChanged();
    render();
  });

  app.addEventListener("focusout", (event) => {
    const periodicProfileNameInput = event.target.closest("[data-periodic-profile-name]");
    if (periodicProfileNameInput) {
      const nextTarget = event.relatedTarget;
      if (nextTarget?.closest?.("[data-periodic-profile-rename-save], [data-periodic-profile-rename-cancel]")) return;
      commitPeriodicProfileRename(periodicProfileNameInput);
      return;
    }
    const equipmentAircraftModelInput = event.target.closest("[data-equipment-aircraft-model]");
    if (equipmentAircraftModelInput) {
      commitEquipmentAircraftModelInput(equipmentAircraftModelInput);
    }
  });

  app.addEventListener("input", (event) => {
    if (currentModelingPageLocked() && event.target.closest("[data-path]")) {
      event.preventDefault?.();
      return;
    }

    const projectEditInput = event.target.closest("[data-project-edit-field]");
    if (projectEditInput) {
      updateProjectEditorDraft(projectEditInput.dataset.projectEditField, projectEditInput.value);
      return;
    }

    const equipmentSearchInput = event.target.closest("[data-equipment-search]");
    if (equipmentSearchInput) {
      equipmentSearchQuery = equipmentSearchInput.value;
      const selectionStart = equipmentSearchInput.selectionStart;
      const selectionEnd = equipmentSearchInput.selectionEnd;
      const query = equipmentSearchQuery.trim().toLowerCase();
      if (query) {
        const component = (scenario.components || []).find((item) => String(item.name || item.componentName || "").toLowerCase().includes(query));
        const aircraft = wholeMachineModels().find((model) => String(model).toLowerCase().includes(query));
        if (component) selectedEquipmentNodeKey = `component:${component.id}`;
        else if (aircraft) selectedEquipmentNodeKey = `aircraft:${aircraft}`;
        collapsedTreeNodes.clear();
      }
      render();
      queueMicrotask(() => {
        const restoredInput = app.querySelector?.("[data-equipment-search]");
        restoredInput?.focus();
        if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
          restoredInput?.setSelectionRange(selectionStart, selectionEnd);
        }
      });
      return;
    }

    const liveEquipmentKOutOfNInput = event.target.closest("[data-equipment-k-out-of-n-index]");
    if (liveEquipmentKOutOfNInput) {
      updateEquipmentKOutOfNInput(liveEquipmentKOutOfNInput);
      render();
      return;
    }

    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) updateMonteCarloArrayInput(mcArrayInput);

    const livePeriodicInput = event.target.closest("[data-periodic-field]");
    if (livePeriodicInput) {
      markProjectDraftChanged();
      updateSelectedPeriodicTask(livePeriodicInput.dataset.periodicField, parseInput(livePeriodicInput), { renderAfter: false });
      return;
    }

    const livePeriodicProfileName = event.target.closest("[data-periodic-profile-name]");
    if (livePeriodicProfileName) {
      if (periodicProfileRenameState) {
        periodicProfileRenameState.draft = livePeriodicProfileName.value;
        periodicProfileRenameState.error = "";
      }
      return;
    }

    const basicActivityQueryInput = event.target.closest("[data-basic-activity-query]");
    if (basicActivityQueryInput) {
      basicActivityQuery = basicActivityQueryInput.value;
      render();
      return;
    }

    const supportActivityTemplateQueryInput = event.target.closest("[data-support-activity-template-query]");
    if (supportActivityTemplateQueryInput) {
      supportActivityTemplateQuery = supportActivityTemplateQueryInput.value;
      render();
      return;
    }

    const supportActivityPredecessorQueryInput = event.target.closest("[data-support-activity-predecessor-query]");
    if (supportActivityPredecessorQueryInput) {
      supportActivityPredecessorQuery = supportActivityPredecessorQueryInput.value;
      render();
      return;
    }

    const systemUserSearchInput = event.target.closest("[data-system-user-search]");
    if (systemUserSearchInput) {
      systemUserSearchText = systemUserSearchInput.value;
      render();
      return;
    }

    const personnelSpecialtyDraftInput = event.target.closest("[data-personnel-specialty-draft]");
    if (personnelSpecialtyDraftInput) {
      personnelSpecialtyDraft = personnelSpecialtyDraftInput.value;
      return;
    }

    const combatUnitFieldInput = event.target.closest("[data-combat-unit-field]");
    if (combatUnitFieldInput) {
      updateCombatUnitMemberField(
        Number(combatUnitFieldInput.dataset.combatUnitIndex),
        combatUnitFieldInput.dataset.combatUnitField,
        parseInput(combatUnitFieldInput)
      );
      markProjectDraftChanged();
      return;
    }

    const livePathInput = event.target.closest("[data-path]");
    if (livePathInput && isLiveProjectDraftInput(livePathInput)) {
      return;
    }

    const systemUserInput = event.target.closest("[data-system-user-field]");
    if (systemUserInput && systemUserEditor) {
      systemUserEditor = {
        ...systemUserEditor,
        user: {
          ...systemUserEditor.user,
          [systemUserInput.dataset.systemUserField]: systemUserInput.value
        }
      };
    }
  });

}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toggleSetValue(sourceSet, value) {
  const next = new Set(sourceSet);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function toggleTreeNodeFromElement(treeToggleElement) {
  const nodeId = treeToggleElement?.dataset?.treeToggle;
  if (!nodeId) return;
  if (collapsedTreeNodes.has(nodeId)) {
    collapsedTreeNodes.delete(nodeId);
  } else {
    collapsedTreeNodes.add(nodeId);
  }
}

function selectCompositeTaskRow(compositeTaskRow) {
  selectedCompositeTaskId = compositeTaskRow.dataset.selectCompositeTask;
  render();
}

function render() {
  if (!isLoggedIn) {
    app.innerHTML = renderLoginPage();
    return;
  }
  if (selectedRoute === "projects") {
    app.innerHTML = renderProjectListPage();
    return;
  }
  if (!currentProject) {
    selectedRoute = "projects";
    location.hash = "route=projects";
    projectListStatus = "请选择项目模板创建项目";
    app.innerHTML = renderProjectListPage();
    return;
  }
  const page = accessibleFeaturePage(selectedFeatureId);
  selectedFeatureId = page.id;
  normalizeSelectedFeatureHash(selectedFeatureId);
  app.innerHTML = `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
        <div>
          <h1>备件规划及任务可靠度验证评估平台</h1>
          <p>${htmlEscape(currentProject?.name || "未选择项目")}</p>
        </div>
      </div>
      <div class="right">
        ${renderProjectMenu()}
        <button type="button" data-logout>退出</button>
      </div>
    </header>
    <main class="workspace-shell">
      ${renderNavigation(page)}
      ${renderFeaturePage(page)}
    </main>
  `;
}

function renderLoginPage() {
  return `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="brand-mark">BJGH</div>
        <h1>备件规划及任务可靠度验证评估平台</h1>
        <p>登录后进入项目列表，再选择项目进入功能导航页。</p>
        <div class="auth-form">
          <label>用户名<input value="${currentUser.username}" aria-label="用户名" data-login-username></label>
          <label>密码<input value="${currentUser.username}" type="password" aria-label="密码" data-login-password></label>
          <button type="button" class="btn-primary" data-login-submit>登录</button>
        </div>
        <div class="auth-users">
          ${DEMO_USERS.map((user) => `<span>${user.username} / ${user.role}</span>`).join("")}
        </div>
      </section>
    </main>
  `;
}

function renderProjectMenu() {
  return `
    <div class="project-menu">
      <button type="button" class="project-menu-toggle" data-project-menu-toggle aria-expanded="${isProjectMenuOpen}">
        <span>${htmlEscape(currentProject?.name || "未选择项目")}</span>
        <span aria-hidden="true">▾</span>
      </button>
      ${isProjectMenuOpen ? `
        <div class="project-menu-panel" role="menu">
          <button type="button" data-project-list role="menuitem">返回项目列表</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderProjectListPage() {
  const templateProjects = projectTemplateOptions();
  const selectedTemplateProject = selectedProjectTemplateProject();
  const hasTemplateProjects = templateProjects.length > 0;
  return `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
      <div>
          <h1>项目列表</h1>
          <p>${currentUser.role} / 选择项目后进入功能导航页</p>
        </div>
      </div>
      <div class="right">
        ${canAccessSystemManagementModule() ? `<button type="button" data-system-management-entry>${SYSTEM_SUPPORT_MODULE_NAME}</button>` : ""}
        <button type="button" data-logout>退出</button>
      </div>
    </header>
    <main class="project-page">
      <section class="project-toolbar">
        <div>
          <h2>项目列表</h2>
          <p>${htmlEscape(projectListStatus)}</p>
          <p class="inline-status">请选择项目模板创建项目。${selectedTemplateProject ? `当前模板：${htmlEscape(selectedTemplateProject.name)}。` : "暂无项目模板，请先在项目数据管理设为模板。"}</p>
        </div>
        <div class="toolbar-row compact-actions">
          <select data-project-template-select aria-label="选择项目模板" ${hasTemplateProjects ? "" : "disabled"}>
            ${hasTemplateProjects
              ? templateProjects.map((template) => `
              <option value="${htmlEscape(projectDataProjectId(template))}"${projectDataProjectId(template) === selectedProjectTemplateProjectId ? " selected" : ""}>${htmlEscape(projectTemplateOptionLabel(template))}</option>
            `).join("")
              : `<option value="">暂无项目模板</option>`}
          </select>
          <button type="button" class="btn-secondary" data-project-create-from-template ${hasTemplateProjects ? "" : "disabled"}>从选中项目模板创建项目</button>
        </div>
      </section>
      <section class="project-grid">
        ${demoProjects.length ? demoProjects.map((project) => `
          <article class="project-card ${project.id === currentProject?.id ? "active" : ""}">
            <div>
              <span>基地 ${project.baseCode}</span>
              ${projectSourceBadge(project)}
              <h3>${htmlEscape(project.name)}</h3>
              <p>${htmlEscape(project.summary)}</p>
              <p class="inline-status">${projectSourceHelpText(project)}</p>
            </div>
            ${projectEditorDraft?.id === project.id ? `
              <form class="project-edit-form" data-project-edit-form="${htmlEscape(project.id)}">
                <label>项目名称<input data-project-edit-field="name" value="${htmlEscape(projectEditorDraft.name)}"></label>
                <label>基地编码<input data-project-edit-field="baseCode" value="${htmlEscape(projectEditorDraft.baseCode)}"></label>
                <label>项目说明<input data-project-edit-field="summary" value="${htmlEscape(projectEditorDraft.summary)}"></label>
                <div class="toolbar-row compact-actions">
                  <button type="button" class="btn-primary" data-project-edit-save>保存</button>
                  <button type="button" data-project-edit-cancel>取消</button>
                </div>
              </form>
            ` : ""}
            <div class="project-card-foot">
              <small>更新 ${project.updatedAt}</small>
              <span class="toolbar-row compact-actions">
                <button type="button" data-enter-workbench data-project-id="${project.id}">进入</button>
                <button type="button" data-project-edit="${project.id}">编辑</button>
                <button type="button" class="btn-danger" data-project-delete="${project.id}">删除</button>
                <button type="button" data-project-export="${htmlEscape(project.id)}">导出</button>
              </span>
            </div>
          </article>
        `).join("") : `
          <div class="empty-state">
            <strong>暂无项目</strong>
            <p>请选择项目模板创建项目。</p>
          </div>
        `}
      </section>
    </main>
  `;
}

function projectSourceBadge(project) {
  const labels = {
    [PROJECT_SOURCE.imported_sample]: "模板项目"
  };
  return `<span class="status-badge success">${htmlEscape(labels[project.sourceKind] || labels[PROJECT_SOURCE.imported_sample])}</span>`;
}

function projectSourceHelpText(project) {
  if (project.sourceKind === PROJECT_SOURCE.imported_sample) {
    return "来自后端 Project 数据，可用于正式后端测试。";
  }
  return "项目来源待确认。";
}

function currentFeatureGroups() {
  return groupFeaturePages(getVisibleFeaturePagesForRole(FEATURE_PAGES, currentUser?.role));
}

function accessibleFeaturePage(featureId) {
  return getAccessibleFeaturePageById(featureId || defaultFeaturePageIdForCurrentUser(), currentUser?.role);
}

function accessibleFeaturePageId(featureId) {
  return accessibleFeaturePage(featureId).id;
}

function defaultFeaturePageIdForCurrentUser() {
  return getDefaultFeaturePageIdForRole(currentUser?.role);
}

function canAccessSystemManagementModule() {
  return getVisibleFeaturePagesForRole(FEATURE_PAGES, currentUser?.role)
    .some((page) => page.module === SYSTEM_SUPPORT_MODULE_NAME);
}

function renderNavigation(activePage) {
  const groups = currentFeatureGroups();
  return `
    <aside class="feature-nav" aria-label="功能导航">
      ${Object.entries(groups).map(([moduleName, secondaryGroups]) => `
        <details class="nav-module" ${moduleName === activePage.module ? "open" : ""}>
          <summary>${moduleName}</summary>
          ${moduleName === SYSTEM_SUPPORT_MODULE_NAME
            ? renderSystemManagementNavigation(activePage, secondaryGroups)
            : Object.entries(secondaryGroups).map(([secondaryName, tertiaryGroups]) => `
              <details class="nav-secondary" ${secondaryName === activePage.secondary ? "open" : ""}>
                <summary>${secondaryName}</summary>
                ${Object.entries(tertiaryGroups).map(([tertiaryName, pages]) => `
                  <button type="button" class="nav-tertiary-link ${isActiveTertiary(activePage, pages) ? "active" : ""}" data-feature-id="${pages[0].id}">
                    ${tertiaryName}
                  </button>
                `).join("")}
              </details>
            `).join("")}
        </details>
      `).join("")}
    </aside>
  `;
}

function renderSystemManagementNavigation(activePage, secondaryGroups) {
  return Object.entries(secondaryGroups).map(([secondaryName, tertiaryGroups]) => `
    <details class="nav-secondary" ${secondaryName === activePage.secondary ? "open" : ""}>
      <summary>${secondaryName}</summary>
      ${Object.values(tertiaryGroups).map((pages) => `
        <button type="button" class="nav-tertiary-link ${pages.some((page) => page.id === activePage.id) ? "active" : ""}" data-feature-id="${pages[0].id}">
          ${pages[0].name}
        </button>
      `).join("")}
    </details>
  `).join("");
}

function renderFeaturePage(page) {
  const siblingPages = currentFeatureGroups()[page.module]?.[page.secondary]?.[page.tertiary] || [page];
  const currentContext = shouldEmbedExperimentPlanContextInComponent(page) ? "" : renderCurrentContext(page);
  return `
    <section class="deck-modeling-content feature-page">
      ${currentContext ? `<div class="page-head">${currentContext}</div>` : ""}
      ${renderFourthLevelTabs(page, siblingPages)}
      <div class="page-grid">
        <section class="panel main-panel">
          ${renderProjectDraftToolbar(page)}
          ${renderMainComponent(page)}
        </section>
      </div>
    </section>
  `;
}

function renderProjectDraftToolbar(page) {
  if (page.secondary !== "仿真建模") return "";
  const savedAtText = projectDraftLastSavedAt ? ` / ${htmlEscape(projectDraftLastSavedAt)}` : "";
  const hydrateText = projectDraftHydrateStatus ? `<span>${htmlEscape(projectDraftHydrateStatus)}</span>` : "";
  return `
    <div class="toolbar-row project-draft-toolbar">
      <button type="button" class="btn-primary" data-project-draft-save>保存 Project draft</button>
      <span class="badge">${htmlEscape(projectDraftSaveStatus)}${savedAtText}</span>
      ${hydrateText}
    </div>
  `;
}

function renderCurrentContext(page) {
  if (!shouldShowCurrentContext(page)) return "";
  if (shouldUseExperimentPlanContextDropdown(page)) {
    return renderExperimentPlanContextDropdown(page);
  }
  const context = currentContextSummary();
  return `
    <button class="page-head-current-context" type="button" data-plan-list-link>
      <span>${htmlEscape(context.label)}</span>
      <strong>${htmlEscape(context.name)}</strong>
    </button>
  `;
}

function shouldShowCurrentContext(page) {
  return page.component !== "experiment-plan-management"
    && page.module !== SYSTEM_SUPPORT_MODULE_NAME
    && page.secondary !== "仿真建模";
}

function shouldUseExperimentPlanContextDropdown(page) {
  return isVisualSimulationPage(page)
    || page.component === "lite-mesa-monte-carlo-analysis"
    || page.component === "lite-mesa-analysis"
    || page.component === "analysis";
}

function shouldEmbedExperimentPlanContextInComponent(page) {
  return isVisualSimulationPage(page)
    || page.component === "lite-mesa-monte-carlo-analysis"
    || page.component === "lite-mesa-analysis"
    || page.component === "analysis";
}

function renderExperimentPlanContextDropdown(page) {
  ensureExperimentPlanListLoaded();
  const options = experimentPlanContextOptions(page);
  const selectedKey = selectedExperimentPlanContextKey(options);
  const currentProjectOption = options.find((option) => option.kind === "current-project");
  const savedPlanOptions = options.filter((option) => option.kind === "experiment-plan");
  const status = backendExperimentPlansLoaded
    ? `${savedPlanOptions.length} 个已保存方案`
    : "方案列表加载中";
  return `
    <label class="page-head-current-context experiment-plan-context-select">
      <span>运行上下文</span>
      <select data-current-experiment-plan>
        ${currentProjectOption ? `<option value="${htmlEscape(currentProjectOption.key)}" ${currentProjectOption.key === selectedKey ? "selected" : ""}>${htmlEscape(currentProjectOption.name)}</option>` : ""}
        ${savedPlanOptions.length ? `<optgroup label="已保存实验方案">${savedPlanOptions.map((option) => `<option value="${htmlEscape(option.key)}" ${option.key === selectedKey ? "selected" : ""}>${htmlEscape(option.name)}</option>`).join("")}</optgroup>` : ""}
      </select>
      <small>${htmlEscape(status)}</small>
    </label>
  `;
}

function currentContextSummary() {
  const experimentName = String(scenario.experiment?.name || experimentPlanDraft?.experiment?.name || "").trim();
  if (experimentName) {
    return { label: "当前方案", name: experimentName };
  }
  const projectName = String(currentProject?.name || scenario.projectInfo?.name || scenario.scenarioId || "").trim();
  return { label: "当前项目", name: projectName || "未选择项目" };
}

function renderFourthLevelTabs(page, siblingPages) {
  if (!shouldShowFourthTabs(page, siblingPages)) return "";
  return `
    <div class="compact-fourth-tabs" aria-label="四级功能">
      ${siblingPages.map((item) => `
        <button class="${item.id === page.id ? "active" : ""}" type="button" data-feature-id="${item.id}">
          ${item.name}
        </button>
      `).join("")}
    </div>
  `;
}

function shouldShowFourthTabs(page, siblingPages) {
  return siblingPages.length > 1 && ["仿真建模", "仿真实验"].includes(page.secondary) && !isVisualSimulationPage(page);
}

function isVisualSimulationPage(page) {
  return page.component === "visual-simulation";
}

function renderMainComponent(page) {
  if (page.component === "visual-simulation") return renderVisualSimulation(page);
  if (page.component === "reliability-block-diagram") return renderReliabilityBlockDiagram();
  if (page.component === "activity-gantt") return renderSupportActivityWorkbench(page);
  if (page.component === "resource-table") return renderSupportOrganizationWorkbench(page);
  if (page.component === "equipment-table") return renderEquipmentModeling(page);
  if (page.component === "experiment-plan-management") return renderExperimentPlanManagement(page);
  if (page.component === "experiment-plan-list") return renderExperimentPlanList(page);
  if (page.component === "experiment-plan-editor") return renderExperimentPlanEditor(page);
  if (page.component === "experiment-form") return renderExperimentPlanEditor(page);
  if (page.component === "system-project-management") return renderSystemProjectManagement(page);
  if (page.component === "system-basic-config") return renderSystemBasicConfig(page);
  if (page.component === "rms-allocation") return renderRmsAllocationWorkbench({
    project: rmsAllocationProject,
    plan: rmsAllocationPlan,
    result: rmsAllocationResult,
    importStatus: rmsEquipmentImportStatus,
    htmlEscape,
    fixed,
    pct
  });
  if (page.component === "lite-mesa-monte-carlo-analysis") return renderLiteMesaMonteCarloAnalysis(page);
  if (page.component === "lite-mesa-analysis") return renderLiteMesaAnalysisPage(page);
  if (page.component === "analysis") return renderLiteMesaAnalysisPage(page);
  if (page.name === "内置场景") return renderBuiltInScenario(page);
  if (page.name === "基本作战单元建模") return renderCombatUnitModeling(page);
  if (page.name === "基本任务建模") return renderBasicMissionModeling(page);
  if (page.name === "任务剖面参数") return renderMissionProfileParameters(page);
  if (page.name === "复合任务建模") return renderCompositeTaskModeling(page);
  if (page.name === "周期性任务建模") return renderPeriodicTaskModeling(page);
  return renderTaskModel(page);
}

function createExperimentPlanBranchFromCurrentProject() {
  const page = getFeaturePageById(selectedFeatureId);
  const isExperimentPlanManagementEditor = page.component === "experiment-plan-management" && experimentPlanManagementMode === "editor";
  if (!isExperimentPlanManagementEditor && !["experiment-plan-editor", "experiment-form"].includes(page.component)) return;
  if (experimentPlanBranchActive) return;
  experimentPlanDraft = cloneScenario(scenario);
  ensureMonteCarloSweepDefaults(experimentPlanDraft);
  ensureExperimentPlanDraftDefaults(experimentPlanDraft);
  experimentPlanBranchActive = true;
  updatePreviewResultsThroughApiClient(experimentPlanDraft);
}

function renderCollapsibleTree(nodes, options = {}) {
  const className = options.className || "object-tree";
  return `
    <div class="${className}">
      ${nodes.map((node) => renderCollapsibleTreeNode(node, options)).join("")}
    </div>
  `;
}

function renderCollapsibleTreeNode(node, options = {}) {
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const nodeId = node.id || stableTreeNodeId(node.label, node.meta);
  const isCollapsed = hasChildren && collapsedTreeNodes.has(nodeId);
  const labelClass = [
    "tree-node-label",
    node.root ? "root" : "",
    node.selected ? "selected" : ""
  ].filter(Boolean).join(" ");
  const actionAttrs = node.actionAttrs ? ` ${node.actionAttrs}` : "";
  const buttonToggleAttrs = hasChildren && !node.actionAttrs ? `data-tree-toggle="${htmlEscape(nodeId)}"` : "";
  const iconToggleAttrs = hasChildren && node.actionAttrs ? ` data-tree-toggle="${htmlEscape(nodeId)}"` : "";
  const actions = Array.isArray(node.actions) ? node.actions : [];
  return `
    <div class="tree-node-item ${isCollapsed ? "collapsed" : ""}" data-tree-node="${htmlEscape(nodeId)}">
      <div class="tree-node-row">
        <button type="button" class="${labelClass}" ${buttonToggleAttrs}${actionAttrs} aria-expanded="${hasChildren ? String(!isCollapsed) : "false"}">
          <span class="tree-node-toggle"${iconToggleAttrs}>${hasChildren ? (isCollapsed ? "▶" : "▼") : "•"}</span>
          <span class="tree-node-text">${htmlEscape(node.label)}</span>
          ${node.meta ? `<span class="tree-node-meta">${htmlEscape(node.meta)}</span>` : ""}
        </button>
        ${actions.length ? `<span class="tree-node-actions">${actions.map((action) => `
          <button type="button" class="${htmlEscape(action.className || "inline-action")}" ${action.attrs || ""}>${htmlEscape(action.label)}</button>
        `).join("")}</span>` : ""}
      </div>
      ${hasChildren ? `<div class="tree-node-children">${children.map((child) => renderCollapsibleTreeNode(child, options)).join("")}</div>` : ""}
    </div>
  `;
}

function stableTreeNodeId(label, meta = "") {
  return `tree:${String(label)}:${String(meta)}`.replace(/\s+/g, "-");
}

function basicMissionTreeNodes() {
  const tasks = editableBasicMissionRecords();
  const grouped = new Map();
  const primary = primaryBasicMissionRecord();
  for (const record of tasks) {
    const task = record.task;
    const equipmentType = task.equipmentType || primary.equipmentType || scenarioEquipmentModel() || "未指定飞机类型";
    const taskName = task.name || task.basicTaskName || task.taskName || primary.name || "未命名基本任务";
    const taskNo = task.taskNo || task.basicTaskId || task.id || "";
    const existing = grouped.get(equipmentType) || [];
    if (!existing.some((item) => item.label === taskName && item.meta === taskNo)) {
      existing.push({
        id: `basic-task:${equipmentType}:${taskNo || taskName}`,
        label: taskName,
        meta: taskNo || task.taskArea || "",
        selected: selectedBasicMissionTreeLevel === "mission" && record.key === selectedBasicMissionKey,
        actionAttrs: record.path ? `data-select-basic-mission="${htmlEscape(record.key)}"` : ""
      });
    }
    grouped.set(equipmentType, existing);
  }
  const aircraftModels = Array.from(new Set([...wholeMachineModels(), ...grouped.keys()]));
  return [{
    id: "basic-task-aircraft-list",
    label: "飞机列表",
    meta: `${aircraftModels.length} 类飞机`,
    root: true,
    children: aircraftModels.map((equipmentType) => {
      const children = grouped.get(equipmentType) || [];
      return {
        id: `basic-task-equipment:${equipmentType}`,
        label: equipmentType,
        meta: `${children.length} 项基本任务`,
        selected: selectedBasicMissionTreeLevel === "equipment" && equipmentType === selectedBasicMissionEquipmentType,
        actionAttrs: `data-select-basic-mission-equipment="${htmlEscape(equipmentType)}"`,
        children
      };
    })
  }];
}

function editableBasicMissionRecords() {
  const tasks = basicMissionExtras();
  if (!tasks.length) tasks.push(createEmptyBasicMission());
  return tasks.map((task, index) => ({
    key: index === 0 ? "primary" : `extra:${task.id || index}`,
    path: `basicMissions.${index}`,
    task,
    index
  })).filter((record) => record.task);
}

function basicMissionExtras() {
  if (!Array.isArray(scenario.basicMissions)) scenario.basicMissions = [];
  return scenario.basicMissions;
}

function primaryBasicMissionRecord() {
  return editableBasicMissionRecords()[0]?.task || {};
}

function resolveSelectedBasicMission() {
  const records = editableBasicMissionRecords();
  return records.find((record) => record.key === selectedBasicMissionKey) || records[0];
}

function selectedBasicMissionPhases() {
  return ensureBasicMissionPhases(resolveSelectedBasicMission()?.task);
}

function ensureBasicMissionPhases(mission) {
  if (!mission || typeof mission !== "object") return [];
  if (!Array.isArray(mission.missionPhases)) {
    const legacyPhases = Array.isArray(scenario.missionPhases) ? scenario.missionPhases : [];
    mission.missionPhases = legacyPhases.map((phase) => JSON.parse(JSON.stringify(phase)));
  }
  return mission.missionPhases;
}

function addBasicMission() {
  const extras = basicMissionExtras();
  const index = editableBasicMissionRecords().length + 1;
  const selected = resolveSelectedBasicMission();
  const sourceTask = selected?.task || primaryBasicMissionRecord();
  const equipmentType = selectedBasicMissionEquipmentType || sourceTask.equipmentType || scenarioEquipmentModel() || "";
  const task = {
    ...JSON.parse(JSON.stringify(sourceTask || createEmptyBasicMission())),
    id: `basic-mission-${index}`,
    name: `新增基本任务${index}`,
    taskNo: `BM-${String(index).padStart(2, "0")}`,
    equipmentType,
    taskArea: "未指定任务区域"
  };
  extras.push(task);
  selectedBasicMissionKey = `extra:${task.id}`;
  selectedBasicMissionTreeLevel = "mission";
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedBasicMission() {
  if (!selectedBasicMissionKey) return;
  const selected = resolveSelectedBasicMission();
  const extras = basicMissionExtras();
  if (!selected) return;
  if (extras.length <= 1) {
    extras.splice(0, extras.length, createEmptyBasicMission());
  } else {
    extras.splice(selected.index, 1);
  }
  selectedBasicMissionKey = "primary";
  selectedBasicMissionTreeLevel = "mission";
  updatePreviewResultsThroughApiClient();
}

function createEmptyBasicMission() {
  return {
    id: "basic-mission-empty",
    name: "未命名基本任务",
    taskNo: "BM-01",
    equipmentType: scenarioEquipmentModel() || "",
    equipmentQuantity: 1,
    successPoint: 0.9,
    returnRatio: 0.3,
    minRequiredSorties: 1,
    taskDurationMinutes: 60,
    preparationMinutes: 30,
    cancelMinutes: 10,
    supportActivityName: "",
    taskArea: ""
  };
}

function compositeTaskList() {
  if (!Array.isArray(scenario.missionProfile.compositeTasks)) {
    scenario.missionProfile.compositeTasks = [];
  }
  return scenario.missionProfile.compositeTasks;
}

function resolveSelectedCompositeTask() {
  const tasks = compositeTaskList();
  const index = tasks.findIndex((task) => String(task.id) === String(selectedCompositeTaskId));
  const selectedIndex = index >= 0 ? index : 0;
  const task = tasks[selectedIndex] || null;
  if (task) selectedCompositeTaskId = String(task.id || selectedIndex);
  return {
    task,
    index: task ? selectedIndex : -1,
    path: task ? `missionProfile.compositeTasks.${selectedIndex}` : ""
  };
}

function addCompositeTask() {
  const tasks = compositeTaskList();
  const index = tasks.length + 1;
  const task = {
    id: `composite-task-${Date.now()}-${index}`,
    name: `新增复合任务${index}`,
    priority: 1,
    taskItems: [createCompositeTaskItem(0)]
  };
  tasks.push(task);
  selectedCompositeTaskId = task.id;
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedCompositeTask() {
  const selected = resolveSelectedCompositeTask();
  if (selected.index < 0) return;
  const tasks = compositeTaskList();
  tasks.splice(selected.index, 1);
  selectedCompositeTaskId = String(tasks[Math.min(selected.index, tasks.length - 1)]?.id || "");
  updatePreviewResultsThroughApiClient();
}

function addCompositeTaskItem() {
  const selected = resolveSelectedCompositeTask();
  if (!selected.task) return;
  if (!Array.isArray(selected.task.taskItems)) selected.task.taskItems = [];
  selected.task.taskItems.push(createCompositeTaskItem(selected.task.taskItems.length));
  updatePreviewResultsThroughApiClient();
}

function deleteCompositeTaskItem(index) {
  const selected = resolveSelectedCompositeTask();
  if (!selected.task || !Array.isArray(selected.task.taskItems)) return;
  if (!Number.isInteger(index) || index < 0) return;
  selected.task.taskItems.splice(index, 1);
  updatePreviewResultsThroughApiClient();
}

function createCompositeTaskItem(index) {
  const selected = resolveSelectedBasicMission();
  const basic = selected?.task || primaryBasicMissionRecord() || {};
  const equipmentType = basic.equipmentType || scenarioEquipmentModel() || "";
  const taskName = basic.name || basic.basicTaskName || basic.missionId || `基本任务${index + 1}`;
  return {
    id: `composite-task-item-${Date.now()}-${index + 1}`,
    basicMissionId: basic.id || selected?.key || "",
    basicTaskName: taskName,
    equipmentType,
    taskDurationMinutes: Number(basic.taskDurationMinutes || 180),
    groupName: `新增编队${index + 1}`,
    firstWaveTime: "08:45",
    recoveryTime: "11:45",
    dailyRepeatCount: 1,
    intervalHours: 6,
    preparationMinutes: 45
  };
}

function basicMissionOptions() {
  return editableBasicMissionRecords().map((record) => {
    const task = record.task || {};
    const name = task.name || task.basicTaskName || task.missionId || record.key;
    return { value: task.id || record.key, label: name };
  });
}

function findBasicMissionForTaskItem(item = {}) {
  const itemId = String(item.basicMissionId || "").trim();
  if (itemId) {
    const byId = editableBasicMissionRecords().map((record) => record.task).find((task) => String(task?.id || "") === itemId);
    if (byId) return byId;
  }
  const name = item.basicTaskName;
  return editableBasicMissionRecords().map((record) => record.task).find((task) => {
    const taskName = task?.name || task?.basicTaskName || task?.missionId || "";
    return String(taskName) === String(name);
  });
}

function compositeTaskInheritedBasicFields(item = {}, basicTask = null) {
  return {
    equipmentType: firstPresentValue(basicTask?.equipmentType, item.equipmentType),
    taskDurationMinutes: firstPresentValue(basicTask?.taskDurationMinutes, item.taskDurationMinutes),
    equipmentQuantity: firstPresentValue(basicTask?.equipmentQuantity),
    minRequiredSorties: firstPresentValue(basicTask?.minRequiredSorties)
  };
}

function firstPresentValue(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  return value === undefined ? "" : value;
}

function basicMissionSelect(path, selectedValue) {
  return valueSelect(path, basicMissionOptions());
}

function renderSystemProjectManagement(page) {
  ensureSystemRuntimeConfigLoaded();
  const isGranularityPage = page.name === "建模颗粒度管理";
  const body = isGranularityPage
    ? `
      <section class="system-config-section">
        ${renderModelingGranularityTable()}
      </section>
    `
    : `
      <section class="system-config-section">
        ${renderProjectDataTable()}
      </section>
    `;
  if (!isGranularityPage) {
    return `
      <div class="system-config-workbench">
        ${body}
      </div>
    `;
  }
  return `
    <div class="system-config-workbench">
      <div class="section-head">
        <h3>建模颗粒度配置</h3>
        <span>${page.dataObjects.join(" / ")}</span>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-system-config-save="${isGranularityPage ? "granularity" : "project-data"}">保存系统配置</button>
        <span class="inline-status" data-system-config-status>${htmlEscape(systemRuntimeConfigStatus)}</span>
      </div>
      ${body}
    </div>
  `;
}

function renderProjectDataTable() {
  ensureProjectDataSelection();
  ensureSelectedProjectDataJsonLoaded();
  const selectedProject = selectedProjectDataProject();
  const projectJson = projectDataJsonForSelectedProject(selectedProject);
  return `
    <div class="project-template-layout" data-project-data-config-module="project-data-layer">
      <section class="system-config-section project-template-sidebar" data-project-data-project-list>
        <div class="section-head">
          <div>
            <h4>项目列表</h4>
            <p>设为模板的项目显示【模板】标签。</p>
          </div>
          <span class="status-badge">${demoProjects.length}</span>
        </div>
        <p class="inline-status">${htmlEscape(projectListStatus)}</p>
        ${renderProjectDataProjectList(selectedProject)}
      </section>
      <div class="project-data-detail">
        ${renderProjectTemplateManagement(selectedProject)}
        ${renderProjectDataOverview(projectJson)}
      </div>
    </div>
  `;
}

function ensureProjectDataSelection() {
  const selectedExists = selectedProjectDataProjectId
    && demoProjects.some((project) => projectDataProjectId(project) === selectedProjectDataProjectId);
  if (selectedExists) return;
  selectedProjectDataProjectId = projectDataProjectId(currentProject) || projectDataProjectId(demoProjects[0]) || "";
}

function selectedProjectDataProject() {
  ensureProjectDataSelection();
  return demoProjects.find((project) => projectDataProjectId(project) === selectedProjectDataProjectId)
    || currentProject
    || demoProjects[0]
    || null;
}

function selectProjectDataProject(projectId) {
  selectedProjectDataProjectId = String(projectId || "").trim();
  selectedProjectDataProjectJson = null;
  selectedProjectDataProjectJsonId = "";
  projectDataManagementStatus = "正在读取 Project JSON";
}

function renderProjectDataProjectList(selectedProject) {
  if (!demoProjects.length) {
    return `<div class="project-template-list"><p class="modeling-import-empty">暂无项目，请先从项目列表创建项目。</p></div>`;
  }
  return `
    <div class="project-template-list">
      ${demoProjects.map((project) => {
        const projectId = projectDataProjectId(project);
        const selected = projectId === projectDataProjectId(selectedProject);
        const templateBadge = isProjectDataTemplate(project)
          ? `<span class="status-badge success project-template-tag">【模板】</span>`
          : "";
        return `
          <button type="button" class="project-template-item ${selected ? "selected" : ""}" data-project-data-project-option="${htmlEscape(projectId)}">
            <span>
              <strong>${htmlEscape(project.name || "未命名项目")} ${templateBadge}</strong>
              <small>${htmlEscape(project.summary || project.baseCode || "项目数据")}</small>
            </span>
            <span class="project-template-meta">
              <small>${htmlEscape(project.baseCode || "-")}</small>
              <small>${htmlEscape(project.updatedAt || "-")}</small>
            </span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderProjectTemplateManagement(project) {
  const projectId = projectDataProjectId(project);
  const isTemplate = isProjectDataTemplate(project);
  return `
    <section class="system-config-section" data-project-template-management>
      <div class="section-head">
        <div>
          <h4>模板管理</h4>
          <p>${htmlEscape(project ? `${project.name || "未命名项目"} / ${isTemplate ? "已设为模板" : "普通项目"}` : "尚未选择项目")}</p>
        </div>
        <span class="status-badge ${isTemplate ? "success" : ""}">${isTemplate ? "模板" : "项目"}</span>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-project-template-action="set" data-project-id="${htmlEscape(projectId)}" ${project && !isTemplate ? "" : "disabled"}>设为模板</button>
        <button type="button" data-project-template-action="unset" data-project-id="${htmlEscape(projectId)}" ${project && isTemplate ? "" : "disabled"}>取消设为模板</button>
        <label class="btn-secondary">数据管理<input type="file" hidden data-project-replacement-file accept=".json,application/json" ${project ? "" : "disabled"}></label>
      </div>
      ${renderProjectReplacementPreview()}
      <p class="inline-status">${htmlEscape(projectDataManagementStatus)}</p>
    </section>
  `;
}

function renderProjectDataOverview(projectJson) {
  const rows = projectDataOverviewRows(projectJson);
  return `
    <section class="system-config-section" data-project-data-overview>
      <div class="section-head">
        <h4>数据概览</h4>
        <span>${projectJson ? "Project JSON" : "等待数据"}</span>
      </div>
      <div class="project-data-overview-grid">
        ${rows.map((row) => `
          <div class="modeling-config-card">
            <span>${htmlEscape(row.label)}</span>
            <strong>${htmlEscape(row.value)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderProjectReplacementPreview() {
  if (!projectReplacementPreview) return "";
  const { fileName, projectJson, validation, error } = projectReplacementPreview;
  if (error) return `<div class="alert warn"><strong>${htmlEscape(fileName)}</strong><p>${htmlEscape(error)}</p></div>`;
  const overview = projectDataOverviewRows(projectJson);
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  return `
    <div class="project-replacement-preview">
      <div class="section-head"><h4>覆盖预览</h4><span>${validation?.ok ? "校验通过" : `发现 ${errors.length} 个错误`}</span></div>
      <p><strong>${htmlEscape(projectJson?.projectInfo?.name || projectJson?.name || fileName)}</strong></p>
      <div class="project-data-overview-grid">${overview.map((row) => `<div class="modeling-config-card"><span>${htmlEscape(row.label)}</span><strong>${row.value}</strong></div>`).join("")}</div>
      ${errors.length ? `<div class="alert warn">${errors.map((item) => `<p>${htmlEscape(item.message || item.code || String(item))}</p>`).join("")}</div>` : ""}
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-project-replacement-confirm ${validation?.ok ? "" : "disabled"}>确认覆盖当前项目</button>
        <button type="button" data-project-replacement-cancel>取消</button>
      </div>
    </div>`;
}

async function previewProjectReplacement(file) {
  if (!file) return;
  projectDataManagementStatus = `正在校验 ${file.name}`;
  try {
    const projectJson = JSON.parse(await file.text());
    const validation = await backendApi.validateProject(projectJson);
    projectReplacementPreview = { fileName: file.name, projectJson, validation };
    projectDataManagementStatus = validation.ok ? "Project JSON 校验通过，请确认覆盖" : "Project JSON 校验失败，不允许覆盖";
  } catch (err) {
    projectReplacementPreview = { fileName: file.name, error: err?.message || "JSON 文件无法解析" };
    projectDataManagementStatus = "Project JSON 文件无效";
  }
}

async function confirmProjectReplacement() {
  const selectedProject = selectedProjectDataProject();
  if (!selectedProject || !projectReplacementPreview?.validation?.ok) return;
  const projectId = projectDataProjectBackendId(selectedProject);
  const loaded = selectedProjectDataProjectJsonId === projectDataProjectId(selectedProject)
    ? selectedProjectDataProjectJson
    : await backendApi.getProject(projectId);
  projectDataManagementStatus = "正在覆盖当前项目";
  try {
    const result = await backendApi.replaceProject(projectId, projectReplacementPreview.projectJson, loaded?.updated_at || selectedProject.updatedAt || "");
    projectReplacementPreview = null;
    selectedProjectDataProjectJson = null;
    selectedProjectDataProjectJsonId = "";
    projectDataManagementStatus = `覆盖完成，审计记录 ${result.audit_event_id || "已生成"}`;
    await refreshBackendProjects();
    ensureSelectedProjectDataJsonLoaded({ force: true });
  } catch (err) {
    projectDataManagementStatus = err?.code === "project_version_conflict" ? "覆盖失败：项目已被其他用户更新，请重新加载" : `覆盖失败：${formatBackendError(err)}`;
  }
}

function projectDataOverviewRows(projectJson) {
  return [
    {
      label: "任务",
      value: sumProjectCollectionCounts(projectJson, [
        "basicMissions",
        "missionProfile.basicMissions",
        "missionProfile.compositeTasks",
        "missionProfile.periodicTasks"
      ])
    },
    {
      label: "装备",
      value: sumProjectCollectionCounts(projectJson, [
        "equipmentAssets",
        "objects.equipmentAssets",
        "equipment.components",
        "equipment.nodes",
        "components"
      ])
    },
    {
      label: "保障系统",
      value: sumProjectCollectionCounts(projectJson, [
        "supportNodes",
        "supportResources",
        "objects.supportResources",
        "supportOrganization"
      ])
    },
    {
      label: "保障活动",
      value: sumProjectCollectionCounts(projectJson, [
        "supportActivities",
        "objects.supportActivities",
        "basicSupportActivities"
      ])
    }
  ];
}

function sumProjectCollectionCounts(projectJson, paths) {
  if (!projectJson) return 0;
  return paths.reduce((sum, path) => sum + projectCollectionCount(projectPathValue(projectJson, path)), 0);
}

function projectCollectionCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length ? 1 : 0;
  return 0;
}

function projectPathValue(obj, path) {
  return String(path || "").split(".").reduce((current, part) => {
    if (current == null || typeof current !== "object") return undefined;
    return current[part];
  }, obj);
}

function projectDataJsonForSelectedProject(project) {
  const projectId = projectDataProjectId(project);
  if (!project) return null;
  if (selectedProjectDataProjectJson && selectedProjectDataProjectJsonId === projectId) {
    return selectedProjectDataProjectJson;
  }
  if (currentProject && projectDataProjectId(currentProject) === projectId) {
    return buildBackendProjectJson(scenario, currentProject);
  }
  return null;
}

function ensureSelectedProjectDataJsonLoaded({ force = false } = {}) {
  const project = selectedProjectDataProject();
  const projectId = projectDataProjectId(project);
  if (!project || !projectId || projectDataProjectJsonLoading) return;
  if (!force && selectedProjectDataProjectJsonId === projectId) return;
  projectDataProjectJsonLoading = true;
  projectDataManagementStatus = "正在读取 Project JSON";
  backendApi.getProject(projectDataProjectBackendId(project))
    .then((projectJson) => {
      selectedProjectDataProjectJson = buildBackendProjectJson(projectJson, { id: projectId });
      selectedProjectDataProjectJsonId = projectId;
      mergeProjectTemplateFlagFromJson(projectId, projectJson);
      projectDataManagementStatus = "已读取 Project JSON";
    })
    .catch((err) => {
      selectedProjectDataProjectJson = null;
      selectedProjectDataProjectJsonId = projectId;
      projectDataManagementStatus = `Project JSON 读取失败：${err && err.message ? err.message : "Backend API 不可用"}`;
    })
    .finally(() => {
      projectDataProjectJsonLoading = false;
      render();
    });
}

function projectDataProjectId(project) {
  return project?.id ? String(project.id) : "";
}

function projectDataProjectBackendId(project) {
  if (!project) return "";
  if (project.projectBackendId) return String(project.projectBackendId);
  if (project.project_id) return String(project.project_id);
  const projectId = projectDataProjectId(project);
  return projectId.startsWith("project-") ? projectId : `project-${projectId}`;
}

function isProjectDataTemplate(project = {}) {
  return Boolean(
    project.isTemplate
    || project.is_template
    || project.projectTemplate
    || project.projectInfo?.isTemplate
    || project.projectInfo?.is_template
    || project.template === true
    || project.template?.enabled
    || project.metadata?.isTemplate
  );
}

function isProjectJsonTemplate(projectJson = {}) {
  return isProjectDataTemplate(projectJson) || isProjectDataTemplate(projectJson.projectInfo || {});
}

function mergeProjectTemplateFlagFromJson(projectId, projectJson) {
  if (!projectId || !projectJson) return;
  const isTemplate = isProjectJsonTemplate(projectJson);
  setProjectDataTemplateFlag(projectId, isTemplate);
}

function setProjectDataTemplateFlag(projectId, isTemplate) {
  demoProjects = demoProjects.map((project) => (
    projectDataProjectId(project) === projectId ? { ...project, isTemplate } : project
  ));
  if (currentProject && projectDataProjectId(currentProject) === projectId) {
    currentProject = { ...currentProject, isTemplate };
  }
  if (selectedProjectDataProjectJson && selectedProjectDataProjectJsonId === projectId) {
    selectedProjectDataProjectJson = {
      ...selectedProjectDataProjectJson,
      projectInfo: {
        ...(selectedProjectDataProjectJson.projectInfo || {}),
        isTemplate
      }
    };
  }
  if (isTemplate) {
    selectedProjectTemplateProjectId = projectId;
  } else if (selectedProjectTemplateProjectId === projectId) {
    selectedProjectTemplateProjectId = "";
  }
}

async function handleProjectTemplateAction(action, projectId) {
  const project = demoProjects.find((item) => projectDataProjectId(item) === String(projectId || selectedProjectDataProjectId));
  if (!project) {
    projectDataManagementStatus = "请先选择项目";
    return;
  }
  const isTemplate = action === "set";
  if (!["set", "unset"].includes(action)) return;
  try {
    const projectJson = await backendApi.getProject(projectDataProjectBackendId(project));
    const nextProjectJson = {
      ...normalizeProjectJsonBasicMissions(cloneScenario(projectJson)),
      projectInfo: {
        ...(projectJson.projectInfo || {}),
        isTemplate
      }
    };
    nextProjectJson.projectInfo.isTemplate = isTemplate;
    const backendProjectJson = buildBackendProjectJson(nextProjectJson, { id: projectDataProjectId(project), isTemplate });
    await backendApi.saveProject(backendProjectJson);
    selectedProjectDataProjectJson = cloneScenario(backendProjectJson);
    selectedProjectDataProjectJsonId = projectDataProjectId(project);
    setProjectDataTemplateFlag(projectDataProjectId(project), isTemplate);
    if (currentProject && projectDataProjectId(currentProject) === projectDataProjectId(project)) {
      scenario = cloneScenario(backendProjectJson);
      if (!experimentPlanBranchActive) {
        experimentPlanDraft = cloneScenario(backendProjectJson);
      }
    }
    projectDataManagementStatus = isTemplate ? "已设为模板" : "已取消设为模板";
    projectListStatus = `${project.name || "项目"}：${projectDataManagementStatus}`;
  } catch (err) {
    projectDataManagementStatus = `模板管理保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function projectDataTemplateSourceImportId(template = {}) {
  return template.source_import_id
    || template.sourceImportId
    || template.import_id
    || template.importId
    || template.template_id
    || template.templateId
    || "";
}

function projectTemplateOptions() {
  return demoProjects.filter((project) => isProjectDataTemplate(project));
}

function ensureSelectedProjectTemplateProjectId() {
  const templates = projectTemplateOptions();
  if (!templates.length) {
    selectedProjectTemplateProjectId = "";
    return "";
  }
  const selectedExists = templates.some((project) => projectDataProjectId(project) === selectedProjectTemplateProjectId);
  if (!selectedProjectTemplateProjectId || !selectedExists) {
    selectedProjectTemplateProjectId = projectDataProjectId(templates[0]);
  }
  return selectedProjectTemplateProjectId;
}

function selectedProjectTemplateProject() {
  const selectedId = ensureSelectedProjectTemplateProjectId();
  if (!selectedId) return null;
  return projectTemplateOptions().find((project) => projectDataProjectId(project) === selectedId) || null;
}

function projectTemplateOptionLabel(project) {
  return `${project.name || "未命名项目"}【模板】`;
}

function updateSelectedProjectTemplateProject(projectId) {
  selectedProjectTemplateProjectId = String(projectId || "");
  const project = selectedProjectTemplateProject();
  projectListStatus = project
    ? `已选择项目模板：${project.name}`
    : "暂无项目模板，请先在项目数据管理设为模板";
}

function selectedPublishedModelingImportPackage() {
  const importId = modelingImportPublishedPackage?.importId || modelingImportPublishedPackage?.import_id || "";
  return importId && importId === selectedPublishedModelingImportId ? modelingImportPublishedPackage : null;
}

function renderModelingGranularityTable() {
  const sheetCount = modelingSheetRows().length;
  const fieldCount = modelingSheetRows().reduce((sum, row) => sum + row.fields.length, 0);
  const selectedFieldCount = modelingSheetRows().reduce(
    (sum, row) => sum + row.fields.filter((field) => selectedModelingFieldKeys.has(modelingFieldKey(row.key, field.key))).length,
    0
  );
  const selectedProfile = modelingGranularityProfiles().find((profile) => profile.key === selectedModelingGranularityKey);
  return `
    <p class="inline-status">${htmlEscape(selectedProfile?.label || "建模颗粒度")}：${selectedFieldCount}/${fieldCount} 个字段已启用，覆盖 ${sheetCount} 个 sheet；字段勾选由当前建模颗粒度自动维护。</p>
    ${renderGranularityProfiles()}
    <p class="inline-status">${htmlEscape(modelingFieldStatus)}</p>
    <div class="modeling-field-config">
      ${MODELING_DATA_MODULES.map((module) => renderModelingFieldModule(module)).join("")}
    </div>
  `;
}

function renderGranularityProfiles() {
  const profiles = modelingGranularityProfiles();
  return `
    <div class="modeling-config-grid">
      ${profiles.map((profile) => `
        <button type="button" class="modeling-config-card granularity-profile-card ${profile.key === selectedModelingGranularityKey ? "selected" : ""}" data-granularity-profile-select="${htmlEscape(profile.key)}" aria-pressed="${profile.key === selectedModelingGranularityKey ? "true" : "false"}">
          <div class="section-head">
            <div>
              <h4>${htmlEscape(profile.label)}</h4>
              <p>${htmlEscape(profile.description)}</p>
            </div>
            <span class="granularity-check" aria-hidden="true">${profile.key === selectedModelingGranularityKey ? "✓" : ""}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderModelingSheetModule(module) {
  const moduleSelected = module.sheets.length > 0 && module.sheets.every((sheet) => selectedSystemDataKeys.has(sheet.key));
  return `
    <section class="modeling-config-card">
      <div class="section-head">
        <div>
          <h4>${htmlEscape(module.label)}</h4>
          <p>${htmlEscape(module.description)}</p>
        </div>
        <label class="check-inline">
          <input type="checkbox" data-system-data-module-select="${htmlEscape(module.key)}" ${moduleSelected ? "checked" : ""}>
          全选
        </label>
      </div>
      <div class="sheet-selector-list">
        ${module.sheets.map((sheet) => `
          <label class="check-row">
            <input type="checkbox" data-system-data-select="${htmlEscape(sheet.key)}" ${selectedSystemDataKeys.has(sheet.key) ? "checked" : ""}>
            <span>
              <strong>${htmlEscape(sheet.label)}</strong>
              <small>${htmlEscape(sheet.sourcePage)} / ${sheet.fields.length} 个字段</small>
            </span>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function renderModelingFieldModule(module) {
  return `
    <section class="modeling-config-card">
      <div class="section-head">
        <div>
          <h4>${htmlEscape(module.label)}</h4>
          <p>${htmlEscape(module.description)}</p>
        </div>
      </div>
      <div class="modeling-sheet-stack">
        ${module.sheets.map((sheet) => renderModelingFieldSheet(sheet)).join("")}
      </div>
    </section>
  `;
}

function renderModelingFieldSheet(sheet) {
  const enabled = selectedSystemDataKeys.has(sheet.key);
  const allFieldsSelected = sheet.fields.length > 0 && sheet.fields.every((field) => selectedModelingFieldKeys.has(modelingFieldKey(sheet.key, field.key)));
  return `
    <article class="modeling-sheet-card ${enabled ? "" : "disabled"}">
      <div class="section-head">
        <div>
          <h4>${htmlEscape(sheet.label)}</h4>
          <p>${htmlEscape(sheet.sourcePage)} / ${enabled ? "sheet 已勾选" : "sheet 未勾选"}</p>
        </div>
        <label class="check-inline">
          <input class="granularity-field-checkbox" type="checkbox" data-modeling-field-sheet-select="${htmlEscape(sheet.key)}" ${allFieldsSelected ? "checked " : ""}disabled>
          全选字段
        </label>
      </div>
      <div class="field-checkbox-grid">
        ${sheet.fields.map((field) => {
          const key = modelingFieldKey(sheet.key, field.key);
          const selected = selectedModelingFieldKeys.has(key);
          return `
            <label class="field-check">
              <input class="granularity-field-checkbox" type="checkbox" data-modeling-field-select="${htmlEscape(key)}" ${selected ? "checked " : ""}disabled>
              <span>
                <strong>${htmlEscape(field.label)}</strong>
                <small>${htmlEscape(field.path)}</small>
              </span>
            </label>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function renderLocalModelingImportActions(contextLabel) {
  const validationStatus = modelingImportValidation?.status || (modelingImportValidation?.ok === false ? "invalid" : "not_validated");
  const modelingImportIssues = modelingImportDisplayIssues();
  const issueCount = modelingImportIssues.length;
  const publishedLabel = modelingImportPublishedPackage ? "已发布导入包" : "未发布";
  const scenarioLabel = modelingImportScenarioLabel();
  return `
    <div class="local-import-panel">
      <div class="section-head">
        <div>
          <h4>导入包维护</h4>
          <p>${htmlEscape(contextLabel)}内维护项目数据导入包草稿、校验和发布状态。</p>
        </div>
        <span class="status-badge">${htmlEscape(validationStatus)}</span>
      </div>
      <div class="modeling-import-summary local">
        <div><strong>来源导入包</strong><span>${htmlEscape(modelingImportPackage.objects?.projectInfo?.name || "未加载")}</span></div>
        <div><strong>模板状态</strong><span>${htmlEscape(publishedLabel)}</span></div>
        <div><strong>字段问题</strong><span>${issueCount}</span></div>
        <div><strong>Scenario</strong><span>${htmlEscape(scenarioLabel)}</span></div>
      </div>
      <div class="modeling-import-actions">
        <label class="rms-file-button">
          <span>选择项目数据导入包 JSON</span>
          <input type="file" accept="application/json,.json" data-modeling-import-file>
        </label>
        <button type="button" data-modeling-import-action="load-fixture">恢复内嵌样例导入包</button>
        <button type="button" data-modeling-import-action="backfill-current-project">从当前项目回灌</button>
        <button type="button" data-modeling-import-action="load-invalid-fixture">导入错误样例</button>
        <button type="button" data-modeling-import-action="validate">校验导入数据</button>
        <button type="button" data-modeling-import-action="save-draft">保存导入草稿</button>
        <button type="button" data-modeling-import-action="publish" ${modelingImportSaved ? "" : "disabled"}>发布导入包</button>
        <button type="button" class="btn-primary" data-modeling-import-action="compile-scenario" ${modelingImportPublishedPackage ? "" : "disabled"}>生成 Scenario</button>
      </div>
      <p class="modeling-import-action-status">${htmlEscape(modelingImportStatus)}</p>
      ${renderModelingImportIssueDisplay(modelingImportIssues)}
    </div>
  `;
}

function modelingImportScenarioLabel() {
  if (!modelingImportCompileResult) return "未生成";
  if (modelingImportCompileResult.status && modelingImportCompileResult.status !== "compiled") {
    return modelingImportCompileResult.status;
  }
  return modelingImportCompileResult?.scenario?.scenario_id
    || modelingImportCompileResult?.scenario?.scenarioId
    || (modelingImportCompileResult.status === "compiled" ? "compiled" : "未生成");
}

function modelingImportDisplayIssues() {
  return Array.isArray(modelingImportValidation?.issues)
    ? modelingImportValidation.issues.map((issue) => normalizeModelingImportDisplayIssue(issue, "error"))
    : [];
}

function renderModelingImportIssueDisplay(issues) {
  if (!issues.length) return "";
  return `
    <div class="table-wrap compact">
      <table>
        <thead><tr><th>代码</th><th>级别</th><th>字段路径</th><th>消息</th></tr></thead>
        <tbody>${issues.map((issue) => `
          <tr>
            <td>${htmlEscape(issue.code || "-")}</td>
            <td><span class="status-badge ${issue.severity === "warning" ? "warn" : "danger"}">${htmlEscape(issue.severity || "error")}</span></td>
            <td>${htmlEscape(issue.field_path || "-")}</td>
            <td>${htmlEscape(issue.message || "-")}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function fieldDef(key, label, path) {
  return { key, label, path };
}

function modelingSheetRows() {
  return MODELING_DATA_MODULES.flatMap((module) => module.sheets.map((sheet) => ({
    ...sheet,
    moduleKey: module.key,
    moduleLabel: module.label
  })));
}

function modelingFieldKey(sheetKey, fieldKey) {
  return `${sheetKey}:${fieldKey}`;
}

function fieldsForSheet(sheetKey) {
  return modelingSheetRows().find((sheet) => sheet.key === sheetKey)?.fields || [];
}

function moduleSheetKeys(moduleKey) {
  return MODELING_DATA_MODULES.find((module) => module.key === moduleKey)?.sheets.map((sheet) => sheet.key) || [];
}

function allModelingFieldKeys() {
  return modelingSheetRows().flatMap((row) => row.fields.map((field) => modelingFieldKey(row.key, field.key)));
}

function normalizeModelingGranularityKey(key) {
  if (key === "granularity-a") return MODELING_GRANULARITY_FULL;
  if (key === "granularity-b") return MODELING_GRANULARITY_EQUIPMENT_RMS;
  return [MODELING_GRANULARITY_FULL, MODELING_GRANULARITY_EQUIPMENT_RMS].includes(key)
    ? key
    : DEFAULT_MODELING_GRANULARITY;
}

function modelingGranularityFieldKeys(key) {
  const normalizedKey = normalizeModelingGranularityKey(key);
  const allKeys = allModelingFieldKeys();
  if (normalizedKey === MODELING_GRANULARITY_EQUIPMENT_RMS) {
    return allKeys.filter((fieldKey) => !EQUIPMENT_RMS_EXCLUDED_SHEET_KEYS.has(fieldKey.split(":")[0]));
  }
  return allKeys;
}

function modelingSheetKeyForFeaturePage(page = getFeaturePageById(selectedFeatureId)) {
  if (!page || page.secondary !== "仿真建模") return "";
  return MODELING_PAGE_SHEET_KEY_BY_NAME[page.name] || "";
}

function modelingSheetSelected(sheetKey) {
  const sheet = modelingSheetRows().find((row) => row.key === sheetKey);
  if (!sheet) return true;
  return sheet.fields.some((field) => selectedModelingFieldKeys.has(modelingFieldKey(sheet.key, field.key)));
}

function modelingSheetLocked(sheetKey) {
  return Boolean(sheetKey) && !modelingSheetSelected(sheetKey);
}

function currentModelingPageLocked(page = getFeaturePageById(selectedFeatureId)) {
  return modelingSheetLocked(modelingSheetKeyForFeaturePage(page));
}

function modelingLockDisabledAttr(locked = currentModelingPageLocked()) {
  return locked ? ` disabled title="${htmlEscape(MODELING_PAGE_LOCK_MESSAGE)}"` : "";
}

function modelingLockNotice(page = getFeaturePageById(selectedFeatureId)) {
  if (!currentModelingPageLocked(page)) return "";
  return `<div class="modeling-page-lock-notice" role="status">${htmlEscape(MODELING_PAGE_LOCK_MESSAGE)}</div>`;
}

function withModelingLockAttrs(attrs = {}, locked = currentModelingPageLocked()) {
  return locked ? { ...attrs, disabled: "disabled", title: MODELING_PAGE_LOCK_MESSAGE } : attrs;
}

function lockedModelingEventTarget(target, selectors) {
  return currentModelingPageLocked() && selectors.some((selector) => target.closest(selector));
}

function modelingGranularityProfiles() {
  return [
    {
      key: MODELING_GRANULARITY_FULL,
      label: "保障仿真（含保障资源）",
      description: "启用保障资源及其对保障活动的约束。",
      fieldKeys: allModelingFieldKeys()
    },
    {
      key: MODELING_GRANULARITY_EQUIPMENT_RMS,
      label: "保障仿真（不含保障资源）",
      description: "保留任务与装备建模，不启用保障资源约束。",
      fieldKeys: modelingGranularityFieldKeys(MODELING_GRANULARITY_EQUIPMENT_RMS)
    }
  ];
}

function applyModelingGranularityProfile(key) {
  selectedModelingGranularityKey = normalizeModelingGranularityKey(key);
  selectedModelingFieldKeys = new Set(modelingGranularityFieldKeys(selectedModelingGranularityKey));
  const profile = modelingGranularityProfiles().find((item) => item.key === selectedModelingGranularityKey);
  modelingFieldStatus = `已切换为${profile?.label || "建模颗粒度"}，表单字段勾选已自动更新。`;
}

function createDefaultModelingFormFieldUnits() {
  const units = {};
  for (const row of modelingSheetRows()) {
    for (const field of row.fields) {
      const key = modelingFieldKey(row.key, field.key);
      const unit = defaultModelingFormTimeUnit(field);
      if (unit) units[key] = unit;
    }
  }
  return units;
}

function defaultModelingFormTimeUnit(field) {
  const hint = `${field?.key || ""} ${field?.path || ""} ${field?.label || ""}`.toLowerCase();
  if (hint.includes("minutes") || hint.includes("minute")) return "分钟";
  if (hint.includes("hours") || hint.includes("hour")) return "小时";
  return "";
}

function modelingFormTimeUnitSheetRows() {
  return modelingSheetRows()
    .map((sheet) => ({
      ...sheet,
      fields: sheet.fields.filter((field) => defaultModelingFormTimeUnit(field))
    }))
    .filter((sheet) => sheet.fields.length);
}

function modelingFormTimeUnitFieldKeys() {
  return new Set(modelingFormTimeUnitSheetRows().flatMap((sheet) =>
    sheet.fields.map((field) => modelingFieldKey(sheet.key, field.key))
  ));
}

function normalizeModelingFormFieldUnits(units = {}) {
  const defaults = createDefaultModelingFormFieldUnits();
  const allowedKeys = new Set(Object.keys(defaults));
  return Object.entries({ ...defaults, ...(units || {}) }).reduce((acc, [key, value]) => {
    if (!allowedKeys.has(key)) return acc;
    acc[key] = ["小时", "分钟"].includes(value) ? value : "";
    return acc;
  }, {});
}

function createDefaultSystemRuntimeConfig() {
  return {
    projectDataModules: [
      {
        key: "modeling-data-source",
        label: "项目数据层配置",
        sheetKeys: modelingSheetRows().map((row) => row.key)
      },
      {
        key: "modeling-import-publish",
        label: "导入发布配置",
        actions: ["load-fixture", "backfill-current-project", "validate", "save-draft", "publish", "compile-scenario"]
      }
    ],
    activeGranularityProfile: DEFAULT_MODELING_GRANULARITY,
    granularityProfiles: modelingGranularityProfiles(),
    permissions: SYSTEM_PERMISSION_ROWS.map((row) => ({ ...row })),
    modelingForms: {
      fieldUnits: createDefaultModelingFormFieldUnits(),
      personnelSpecialties: [...PERSONNEL_SPECIALTY_FALLBACK]
    }
  };
}

function currentSystemRuntimeConfigPayload() {
  return {
    ...createDefaultSystemRuntimeConfig(),
    projectDataModules: [
      {
        key: "modeling-data-source",
        label: "项目数据层配置",
        sheetKeys: Array.from(selectedSystemDataKeys)
      },
      {
        key: "modeling-import-publish",
        label: "导入发布配置",
        actions: ["load-fixture", "backfill-current-project", "validate", "save-draft", "publish", "compile-scenario"]
      }
    ],
    activeGranularityProfile: selectedModelingGranularityKey,
    granularityProfiles: modelingGranularityProfiles(),
    permissions: SYSTEM_PERMISSION_ROWS.map((row) => ({ ...row })),
    modelingForms: {
      fieldUnits: normalizeModelingFormFieldUnits(modelingFormFieldUnits),
      personnelSpecialties: configuredPersonnelSpecialties()
    }
  };
}

function applySystemRuntimeConfig(payload = {}) {
  const projectDataModule = Array.isArray(payload.projectDataModules)
    ? payload.projectDataModules.find((item) => item?.key === "modeling-data-source")
    : null;
  if (Array.isArray(projectDataModule?.sheetKeys)) {
    selectedSystemDataKeys = new Set(projectDataModule.sheetKeys);
  }

  const savedGranularityKey = payload.activeGranularityProfile
    || payload.selectedGranularityProfile
    || (Array.isArray(payload.granularityProfiles)
      ? payload.granularityProfiles.find((item) => item?.selected)?.key
      : "");
  applyModelingGranularityProfile(savedGranularityKey);

  if (Array.isArray(payload.permissions)) {
    for (const saved of payload.permissions) {
      const row = SYSTEM_PERMISSION_ROWS.find((item) => item.feature === saved?.feature);
      if (!row) continue;
      row.admin = normalizePermissionLevel(saved.admin);
      row.data = normalizePermissionLevel(saved.data);
      row.user = normalizePermissionLevel(saved.user);
    }
  }

  if (payload.modelingForms && typeof payload.modelingForms === "object") {
    if (payload.modelingForms.fieldUnits && typeof payload.modelingForms.fieldUnits === "object") {
      modelingFormFieldUnits = normalizeModelingFormFieldUnits(payload.modelingForms.fieldUnits);
    }
    if (Array.isArray(payload.modelingForms.personnelSpecialties)) {
      setConfiguredPersonnelSpecialties(payload.modelingForms.personnelSpecialties);
    }
  }
}

function ensureSystemRuntimeConfigLoaded() {
  if (systemRuntimeConfigLoaded) return;
  systemRuntimeConfigLoaded = true;
  backendApi.getSystemConfig(SYSTEM_RUNTIME_CONFIG_KEY)
    .then((saved) => {
      if (saved?.payload && Object.keys(saved.payload).length) {
        applySystemRuntimeConfig(saved.payload);
        systemRuntimeConfigStatus = "已从后端加载系统配置";
      } else {
        systemRuntimeConfigStatus = "已使用默认系统配置";
      }
      render();
    })
    .catch((err) => {
      systemRuntimeConfigStatus = `系统配置后端不可用：${err && err.message ? err.message : "Backend API 不可用"}`;
      render();
    });
}

async function saveSystemRuntimeConfig(contextLabel = "系统配置") {
  const payload = currentSystemRuntimeConfigPayload();
  try {
    await backendApi.saveSystemConfig(SYSTEM_RUNTIME_CONFIG_KEY, payload);
    systemRuntimeConfigStatus = `${contextLabel}已保存到后端`;
  } catch (err) {
    systemRuntimeConfigStatus = `${contextLabel}保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function normalizePermissionLevel(value) {
  return ["编辑", "管理"].includes(value) ? "编辑" : "只读";
}

function configuredPersonnelSpecialties() {
  const rows = Array.isArray(scenario.modelingDictionaries?.personnelSpecialties)
    ? scenario.modelingDictionaries.personnelSpecialties
    : PERSONNEL_SPECIALTY_FALLBACK;
  return normalizePersonnelSpecialties(rows);
}

function normalizePersonnelSpecialties(rows) {
  return uniqueSelectOptions(rows.map((item) => {
    const value = typeof item === "string" ? item : item?.name || item?.value || item?.label;
    return { value, label: value };
  }).filter((option) => option.value)).map((option) => option.value);
}

function setConfiguredPersonnelSpecialties(rows) {
  scenario.modelingDictionaries = {
    ...(scenario.modelingDictionaries || {}),
    personnelSpecialties: normalizePersonnelSpecialties(rows)
  };
}

function activeSystemDataDefinition() {
  return {
    key: "modeling-sheets",
    label: "仿真建模数据表 sheet",
    rows: currentSystemDataRows()
  };
}

function currentSystemDataRows() {
  return modelingSheetRows();
}

function exportSystemDataRows() {
  const tab = activeSystemDataDefinition();
  const rows = currentSystemDataRows().filter((row) => selectedSystemDataKeys.has(row.key));
  systemDataExportPreview = {
    label: tab.label,
    rowCount: rows.length,
    filename: systemDataExportFilename(tab)
  };
  downloadSystemDataExport(systemDataExportPreview.filename, buildSystemDataExportPayload(tab, rows));
  systemDataStatus = `已下载${tab.label}配置：${systemDataExportPreview.filename}（${rows.length} 个 sheet）`;
}

function systemDataExportFilename(tab) {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  return `spare-mvp-${tab.key}-data-${date}.json`;
}

function buildSystemDataExportPayload(tab, rows) {
  const project = currentProject || { id: "", name: "", baseCode: "" };
  return {
    schemaVersion: "spare-mvp-system-data-export-v1",
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      baseCode: project.baseCode
    },
    dataGroup: {
      key: tab.key,
      label: tab.label
    },
    rows: rows.map((row) => ({
      moduleKey: row.moduleKey,
      moduleLabel: row.moduleLabel,
      key: row.key,
      label: row.label,
      sourcePage: row.sourcePage,
      selected: selectedSystemDataKeys.has(row.key),
      fields: row.fields.map((field) => ({
        ...field,
        selected: selectedModelingFieldKeys.has(modelingFieldKey(row.key, field.key))
      }))
    }))
  };
}

function downloadSystemDataExport(filename, payload) {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderSystemBasicConfig(page) {
  ensureSystemRuntimeConfigLoaded();
  const configTitle = page.name;
  return `
    <div class="system-config-workbench">
      <div class="section-head">
        <h3>${htmlEscape(configTitle)}</h3>
        <span>${page.dataObjects.join(" / ")}</span>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-system-config-save="basic-config">保存系统配置</button>
        <span class="inline-status" data-system-config-status>${htmlEscape(systemRuntimeConfigStatus)}</span>
      </div>
      ${page.name === "用户管理" ? renderUserManagementConfig() : ""}
      ${page.name === "系统功能权限管理" ? renderPermissionManagementConfig() : ""}
      ${page.name === "建模表单管理" ? renderModelingFormManagementConfig() : ""}
    </div>
  `;
}

function renderUserManagementConfig() {
  ensureSystemUsersLoaded();
  const users = filteredSystemUsers();
  const allSelected = users.length > 0 && users.every((user) => selectedSystemUsernames.has(user.username));
  return `
    <div class="toolbar-row">
      <button type="button" class="btn-primary" data-system-user-action="add">新增用户</button>
      <button type="button" class="btn-danger" data-system-user-action="delete-selected">删除用户</button>
      <input value="${htmlEscape(systemUserSearchText)}" placeholder="按用户名、角色搜索" data-system-user-search>
    </div>
    <p class="inline-status" data-system-user-status>${htmlEscape(systemUsersLoadStatus)}</p>
    ${systemUserEditor ? renderSystemUserEditor() : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th><input type="checkbox" data-system-user-select-all ${allSelected ? "checked" : ""}></th><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th>编辑/删除</th></tr></thead>
        <tbody>${users.map((user) => `
          <tr><td><input type="checkbox" data-system-user-select="${htmlEscape(user.username)}" ${selectedSystemUsernames.has(user.username) ? "checked" : ""}></td><td>${htmlEscape(user.username)}</td><td>${htmlEscape(user.name)}</td><td>${htmlEscape(user.role)}</td><td><span class="status-badge ${user.status === "停用" ? "warning" : "success"}">${htmlEscape(user.status)}</span></td><td><button type="button" class="inline-action" data-system-user-edit="${htmlEscape(user.username)}">编辑</button><button type="button" class="btn-danger" data-system-user-delete="${htmlEscape(user.username)}">删除</button></td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderSystemUserEditor() {
  const user = systemUserEditor.user;
  const title = systemUserEditor.mode === "add" ? "新增用户" : `编辑用户：${user.username}`;
  return `
    <div class="detail-card activity-editor-card system-user-editor">
      <div class="section-head">
        <h4>${htmlEscape(title)}</h4>
        <span>本地原型配置，保存后更新当前表格</span>
      </div>
      <div class="form-grid">
        <label>用户名<input value="${htmlEscape(user.username)}" ${systemUserEditor.mode === "edit" ? "disabled" : ""} data-system-user-field="username"></label>
        <label>姓名<input value="${htmlEscape(user.name)}" data-system-user-field="name"></label>
        <label>角色<input value="${htmlEscape(user.role)}" data-system-user-field="role"></label>
        <label>状态<input value="${htmlEscape(user.status)}" data-system-user-field="status"></label>
        ${systemUserEditor.mode === "add" ? `<label>初始密码<input value="${htmlEscape(user.password || "")}" type="password" data-system-user-field="password"></label>` : ""}
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-system-user-action="save">保存</button>
        <button type="button" data-system-user-action="cancel">取消</button>
      </div>
    </div>
  `;
}

function renderPermissionManagementConfig() {
  return `
    <p class="inline-status">${htmlEscape(permissionConfigStatus)}</p>
    ${permissionConfigFeature ? renderPermissionConfigEditor() : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th>功能层级</th><th>系统管理员</th><th>数据管理员</th><th>项目用户</th><th>配置权限</th></tr></thead>
        <tbody>${SYSTEM_PERMISSION_ROWS.map((row) => `
          <tr><td>${row.feature}</td><td>${row.admin}</td><td>${row.data}</td><td>${row.user}</td><td><button type="button" class="inline-action" data-permission-configure="${htmlEscape(row.feature)}">配置权限</button></td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderPermissionConfigEditor() {
  const row = SYSTEM_PERMISSION_ROWS.find((item) => item.feature === permissionConfigFeature) || SYSTEM_PERMISSION_ROWS[0];
  const options = ["编辑", "只读"];
  return `
    <div class="detail-card">
      <div class="section-head"><h4>配置权限：${htmlEscape(row.feature)}</h4><span>三类用户权限仅配置只读 / 编辑</span></div>
      <div class="form-grid">
        ${["admin", "data", "user"].map((roleKey) => `
          <label>${permissionRoleLabel(roleKey)}
            <select data-permission-role="${htmlEscape(row.feature)}" data-role-key="${roleKey}">
              ${options.map((option) => `<option value="${roleKey}:${option}" ${row[roleKey] === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function renderModelingFormManagementConfig() {
  const timeUnitSheets = modelingFormTimeUnitSheetRows();
  const timeUnitFieldCount = timeUnitSheets.reduce((sum, sheet) => sum + sheet.fields.length, 0);
  const specialties = configuredPersonnelSpecialties();
  return `
    <p class="inline-status">仅保留保障人员专业字典与 ${timeUnitFieldCount} 个带时间单位的表单字段配置。</p>
    <div class="modeling-field-config modeling-form-config-grid" data-modeling-form-management>
      <section class="modeling-config-card" data-personnel-specialty-dictionary>
        <div class="section-head">
          <div>
            <h4>保障人员专业字典</h4>
            <p>该字典会接入保障人员建模的专业下拉选项。</p>
          </div>
          <span class="status-badge">${specialties.length} 项</span>
        </div>
        <div class="toolbar-row">
          <input value="${htmlEscape(personnelSpecialtyDraft)}" placeholder="新增专业" data-personnel-specialty-draft>
          <button type="button" data-personnel-specialty-add>新增专业</button>
        </div>
        <div class="tag-list">
          ${specialties.map((item) => `
            <span class="status-badge" data-personnel-specialty-item="${htmlEscape(item)}">
              ${htmlEscape(item)}
              <button type="button" class="inline-action" data-personnel-specialty-delete="${htmlEscape(item)}">删除</button>
            </span>
          `).join("")}
        </div>
      </section>
      <section class="modeling-config-card">
        <div class="section-head">
          <div>
            <h4>带时间单位的表单字段</h4>
            <p>仅列出可配置小时或分钟单位的建模字段。</p>
          </div>
          <span class="status-badge">${timeUnitFieldCount} 字段</span>
        </div>
        <div class="modeling-sheet-stack">
          ${timeUnitSheets.map((sheet) => `
            <article class="modeling-sheet-card">
              <div class="section-head">
                <div>
                  <h4>${htmlEscape(sheet.sourcePage)}</h4>
                  <p>${htmlEscape(sheet.moduleLabel)} / ${htmlEscape(sheet.label)} / ${sheet.fields.length} 个时间字段</p>
                </div>
                <span class="status-badge ${selectedSystemDataKeys.has(sheet.key) ? "success" : "warning"}">${selectedSystemDataKeys.has(sheet.key) ? "启用" : "停用"}</span>
              </div>
              <div class="field-checkbox-grid">
                ${sheet.fields.map((field) => {
                  const key = modelingFieldKey(sheet.key, field.key);
                  const unit = modelingFormFieldUnits[key] ?? defaultModelingFormTimeUnit(field);
                  return `
                    <label class="field-check">
                      <span>
                        <strong>${htmlEscape(field.label)}</strong>
                        <small>${htmlEscape(field.path)}</small>
                      </span>
                      <select data-modeling-form-unit="${htmlEscape(key)}">
                        ${["", "小时", "分钟"].map((option) => `<option value="${htmlEscape(option)}" ${unit === option ? "selected" : ""}>${option || "无单位"}</option>`).join("")}
                      </select>
                    </label>
                  `;
                }).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderTaskModel(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="form-table-grid">
      ${field("任务类型", "missionProfile.profileType")}
      ${field("重复周期", "missionProfile.repeatCycleHours", "number")}
      ${field("结束条件", "missionProfile.endCondition")}
      ${field("基本任务", "basicMissions.0.missionId")}
      ${field("成功点", "basicMissions.0.successPoint", "number", { min: "0", max: "1", step: "0.01" })}
      ${field("最低出动数量", "basicMissions.0.minRequiredSorties", "number")}
      ${field("装备型号", "equipment.model")}
      ${field("装备数量", "equipment.quantity", "number")}
    </div>
    ${renderCollapsibleTree([{
      id: `task-model:${scenario.missionProfile.profileType}`,
      label: scenario.missionProfile.profileType,
      root: true,
      children: [
        ...scenario.missionPhases.map((phase) => ({
          id: `task-model-phase:${phase.id || phase.name}`,
          label: phase.name,
          meta: phase.state
        })),
        {
          id: `task-model-combat-unit:${scenario.combatUnit.unitId}`,
          label: scenario.combatUnit.unitId,
          meta: `${scenario.equipment?.quantity ?? 0} 架`
        }
      ]
    }])}
  `;
}

function renderMissionProfileParameters(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>任务剖面参数</h4>
        ${renderCollapsibleTree([{
          id: `mission-profile:${scenario.missionProfile.profileType}`,
          label: scenario.missionProfile.profileType,
          meta: "任务类型",
          root: true,
          children: [
            { id: "mission-profile:repeat-cycle", label: `${scenario.missionProfile.repeatCycleHours} h`, meta: "重复周期" },
            { id: "mission-profile:end-condition", label: scenario.missionProfile.endCondition, meta: "结束条件" }
          ]
        }])}
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>任务剖面参数编辑</h4>
          <div class="form-table-grid">
            ${field("任务类型", "missionProfile.profileType")}
            ${field("重复周期", "missionProfile.repeatCycleHours", "number")}
            ${field("结束条件", "missionProfile.endCondition")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBuiltInScenario(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="form-table-grid">
      ${field("场景编号", "scenarioId")}
      ${field("机场", "airports.0")}
    </div>
    ${renderCollapsibleTree([{
      id: `scenario-tree:${scenario.scenarioId}`,
      label: scenario.scenarioId,
      meta: "内置场景",
      root: true,
      children: [
        {
          id: "scenario-tree:airports",
          label: "机场",
          children: scenario.airports.map((airport, index) => {
            const name = typeof airport === "string"
              ? airport
              : (airport?.name || airport?.id || `机场 ${index + 1}`);
            const meta = typeof airport === "string"
              ? "字符串输入"
              : `${airport?.location || "-"} / 航程距离 ${airport?.distanceToMissionKm ?? "-"} km`;
            return {
              id: `scenario-airport:${name || index}`,
              label: name || `机场 ${index + 1}`,
              meta
            };
          })
        }
      ]
    }])}
  `;
}

function renderCombatUnitModeling(page) {
  const members = scenario.combatUnit.members || [];
  const boundedSelectedIndex = clamp(selectedCombatUnitMemberIndex, 0, Math.max(members.length - 1, 0));
  selectedCombatUnitMemberIndex = boundedSelectedIndex;
  return `
    <div class="table-section">
      <div class="tree-toolbar">
          <h4>飞机列表</h4>
        <div class="toolbar-row" style="margin-bottom:0;">
          <button type="button" class="btn-primary" data-combat-unit-add>新增</button>
          <button type="button" class="btn-danger" data-combat-unit-delete>删除</button>
        </div>
      </div>
      <div class="table-wrap unframed-table">
        <table class="combat-unit-table">
          <thead>
            <tr><th rowspan="2" class="combat-unit-select-col"></th><th rowspan="2">飞机编号</th><th rowspan="2">飞机类型</th><th rowspan="2">所属机场</th><th colspan="3" class="combat-unit-prelife-heading">寿命初始状态</th></tr>
            <tr><th class="combat-unit-prelife-column">日历寿命（天）</th><th class="combat-unit-prelife-column">剩余飞行小时</th><th class="combat-unit-prelife-column">剩余起落次数</th></tr>
          </thead>
          <tbody>
            ${members.map((member, index) => `
              <tr class="${index === boundedSelectedIndex ? "selected-table-row" : ""}">
                <td class="combat-unit-select-col"><input type="checkbox" data-select-combat-unit-member="${index}" ${index === boundedSelectedIndex ? "checked" : ""} aria-label="选择${htmlEscape(member.aircraftNo || `第${index + 1}架飞机`)}"></td>
                <td>${combatUnitMemberInput(index, "aircraftNo", member.aircraftNo)}</td>
                <td>${combatUnitMemberModelSelect(index, member.model)}</td>
                <td>${combatUnitMemberInput(index, "airport", combatUnitMemberAirport(member))}</td>
                <td class="combat-unit-prelife-cell">${combatUnitMemberInput(index, "preLifeCalendarDays", combatUnitMemberCalendarTime(member), "number", { min: "0", step: "1" })}</td>
                <td class="combat-unit-prelife-cell">${combatUnitMemberInput(index, "preLifeFlightHours", combatUnitMemberFlightHours(member), "number", { min: "0", step: "1" })}</td>
                <td class="combat-unit-prelife-cell">${combatUnitMemberInput(index, "preLifeTakeoffLandingCount", combatUnitMemberTakeoffLandingCount(member), "number", { min: "0", step: "1" })}</td>
              </tr>
            `).join("") || "<tr><td colspan='7'>暂无飞机</td></tr>"}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function combatUnitMemberInput(index, fieldName, value, type = "text", attrs = {}) {
  const attrText = Object.entries(attrs)
    .map(([key, attrValue]) => ` ${key}="${htmlEscape(attrValue)}"`)
    .join("");
  return `<input data-combat-unit-index="${index}" data-combat-unit-field="${htmlEscape(fieldName)}" type="${type}" value="${htmlEscape(value ?? "")}"${attrText}>`;
}

function combatUnitMemberModelSelect(index, value) {
  const currentValue = String(value || "");
  const aircraftModels = wholeMachineModels();
  const options = aircraftModels.includes(currentValue) || !currentValue
    ? aircraftModels
    : [currentValue, ...aircraftModels];
  return `
    <select data-combat-unit-index="${index}" data-combat-unit-field="model" ${options.length ? "" : "disabled"}>
      ${options.map((model) => `<option value="${htmlEscape(model)}" ${String(model) === currentValue ? "selected" : ""}>${htmlEscape(model)}</option>`).join("") || "<option value=\"\">暂无装备构型飞机级别</option>"}
    </select>
  `;
}

function combatUnitMemberAirport(member) {
  return member.airport
    ?? member.airportId
    ?? member.homeAirport
    ?? member.homeAirportId
    ?? member.baseAirport
    ?? "";
}

function combatUnitMemberCalendarTime(member) {
  return member.preLifeCalendarDays
    ?? member.calendarDays
    ?? member.overhaulCalendarDays
    ?? member.overhaulDays
    ?? member.overhaul_days
    ?? "";
}

function combatUnitMemberFlightHours(member) {
  return member.preLifeFlightHours
    ?? member.flightHours
    ?? member.flight_hours
    ?? member.preLifeRequirementHours
    ?? scenario.equipment?.preLifeRequirementHours
    ?? member.remainingLifeHours
    ?? "";
}

function combatUnitMemberTakeoffLandingCount(member) {
  return member.preLifeTakeoffLandingCount
    ?? member.takeoffLandingCount
    ?? member.landings
    ?? member.landingCount
    ?? 0;
}

function updateCombatUnitMemberField(index, fieldName, value) {
  const member = scenario.combatUnit?.members?.[index];
  if (!member) return;
  member[fieldName] = value;
  if (fieldName === "preLifeFlightHours") {
    member.preLifeRequirementHours = value;
  } else if (fieldName === "preLifeTakeoffLandingCount") {
    member.takeoffLandingCount = value;
  }
  updatePreviewResultsThroughApiClient();
}

function addCombatUnitMember() {
  if (!Array.isArray(scenario.combatUnit.members)) scenario.combatUnit.members = [];
  const members = scenario.combatUnit.members;
  const index = members.length + 1;
  const model = scenario.equipment?.wholeMachineModels?.[0] || scenarioEquipmentModel() || "";
  const aircraftNo = `${model || "AIRCRAFT"}-${String(index).padStart(2, "0")}`;
  members.push({
    aircraftNo,
    model,
    role: "新增",
    status: "执行",
    preLifeCalendarDays: 0,
    remainingLifeHours: Number(scenario.equipment?.preLifeRequirementHours || 120),
    preLifeRequirementHours: Number(scenario.equipment?.preLifeRequirementHours || 120),
    takeoffLandingCount: 0,
    airport: ""
  });
  scenario.combatUnit.quantity = members.length;
  selectedCombatUnitMemberIndex = members.length - 1;
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedCombatUnitMember() {
  const members = scenario.combatUnit.members || [];
  if (members.length === 0) return;
  const index = clamp(selectedCombatUnitMemberIndex, 0, members.length - 1);
  members.splice(index, 1);
  scenario.combatUnit.quantity = members.length;
  selectedCombatUnitMemberIndex = clamp(index, 0, Math.max(members.length - 1, 0));
  updatePreviewResultsThroughApiClient();
}

function renderBasicMissionModeling(page) {
  const selectedMission = resolveSelectedBasicMission();
  const missionPath = selectedMission.path || "basicMissions.0";
  const phases = selectedBasicMissionPhases();
  selectedBasicMissionPhaseIndexes = validMissionPhaseSelection(phases);
  const allPhasesSelected = phases.length > 0 && phases.every((_, index) => selectedBasicMissionPhaseIndexes.has(String(index)));
  const phaseRatioTotal = missionPhaseRatioTotal(phases);
  const phaseRatioValid = phases.length === 0 || Math.abs(phaseRatioTotal - 1) < 0.001;
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <div class="tree-toolbar">
          <h4>基本任务结构树</h4>
          <div class="equipment-toolbar">
            <button type="button" class="btn-primary" data-basic-mission-add>新增</button>
            <button type="button" class="btn-danger" data-basic-mission-delete>删除</button>
          </div>
        </div>
        <p class="muted">按飞机类型组织：飞机类型 → 多种基本任务</p>
        ${renderCollapsibleTree(basicMissionTreeNodes())}
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>基本任务信息编辑</h4>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr><th>基本任务名称</th><td>${valueInput(`${missionPath}.name`)}</td></tr>
                <tr><th>任务编号</th><td>${valueInput(`${missionPath}.taskNo`)}</td></tr>
                <tr><th>装备名称</th><td><input value="${htmlEscape(selectedMission.task?.equipmentType || scenarioEquipmentModel() || "")}" readonly aria-readonly="true" title="装备名称由装备系统建模回填"></td></tr>
                <tr><th>装备数量</th><td>${valueInput(`${missionPath}.equipmentQuantity`, "number")}</td></tr>
                <tr><th>最小装备数量</th><td>${valueInput(`${missionPath}.minRequiredSorties`, "number")}</td></tr>
                <tr><th>任务成功点</th><td>${valueInput(`${missionPath}.successPoint`, "number", { min: "0", max: "1", step: "0.01" })}</td></tr>
                <tr><th>任务时长（分钟）</th><td>${valueInput(`${missionPath}.taskDurationMinutes`, "number")}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="tree-toolbar">
            <h5>任务阶段</h5>
            <div class="toolbar-row" style="margin-bottom:0;">
              <button type="button" class="btn-primary" data-basic-mission-phase-add>新增</button>
              <button type="button" class="btn-danger" data-basic-mission-phase-batch-delete ${selectedBasicMissionPhaseIndexes.size ? "" : "disabled"}>删除</button>
            </div>
          </div>
          <div class="inline-status ${phaseRatioValid ? "success" : "warn"}">阶段占比合计 ${fixed(phaseRatioTotal, 2)}；${phaseRatioValid ? "满足合计为 1" : "必须调整为 1 后才能作为正式编译输入"}</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th><input type="checkbox" data-basic-mission-phase-select-all aria-label="全选任务阶段" ${allPhasesSelected ? "checked" : ""}></th><th>序号</th><th>阶段名称</th><th>阶段占比</th><th>删除</th></tr></thead>
              <tbody>
                ${phases.map((phase, index) => `
                  <tr class="${selectedBasicMissionPhaseIndexes.has(String(index)) ? "selected-table-row" : ""}">
                    <td><input type="checkbox" data-basic-mission-phase-select="${index}" aria-label="选择任务阶段${index + 1}" ${selectedBasicMissionPhaseIndexes.has(String(index)) ? "checked" : ""}></td>
                    <td>${index + 1}</td>
                    <td>${valueInput(`${missionPath}.missionPhases.${index}.name`)}</td>
                    <td>${valueInput(`${missionPath}.missionPhases.${index}.phaseRatio`, "number", { min: "0", max: "1", step: "0.01" })}</td>
                    <td><button type="button" class="btn-danger" data-basic-mission-phase-delete="${index}">删除</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr><th>提前通知时间（min）</th><td>${valueInput(`${missionPath}.advanceNoticeMinutes`, "number", { min: "0", step: "1" })}</td></tr>
                <tr><th>取消时间（min）</th><td>${valueInput(`${missionPath}.cancelMinutes`, "number")}</td></tr>
                <tr><th>使用保障活动</th><td>${supportActivityPlanSelect(`${missionPath}.supportActivityName`, selectedMission.task?.equipmentType)}</td></tr>
                <tr><th>任务区域描述</th><td>${valueInput(`${missionPath}.taskArea`)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function missionPhaseRatioTotal(phases = selectedBasicMissionPhases()) {
  return phases.reduce((sum, phase) => sum + Number(phase.phaseRatio || 0), 0);
}

function validMissionPhaseSelection(phases = selectedBasicMissionPhases()) {
  const phaseCount = Array.isArray(phases) ? phases.length : 0;
  return new Set(
    Array.from(selectedBasicMissionPhaseIndexes)
      .map((key) => Number(key))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < phaseCount)
      .map((index) => String(index))
  );
}

function supportActivityPlanSelect(path, aircraftModel) {
  const options = operationsSupportActivityOptions(aircraftModel);
  return valueSelect(path, options.length ? options : [{ value: "", label: "暂无同机型使用保障方案" }]);
}

function addMissionPhase() {
  const phases = selectedBasicMissionPhases();
  const remainingRatio = Math.max(0, 1 - missionPhaseRatioTotal(phases));
  phases.push({ name: `阶段${phases.length + 1}`, phaseRatio: Number(remainingRatio.toFixed(2)) });
}

function deleteMissionPhase(index) {
  const phases = selectedBasicMissionPhases();
  phases.splice(0, phases.length, ...phases.filter((_, rowIndex) => rowIndex !== index));
  selectedBasicMissionPhaseIndexes = new Set(
    Array.from(selectedBasicMissionPhaseIndexes)
      .map((key) => Number(key))
      .filter((selectedIndex) => Number.isInteger(selectedIndex) && selectedIndex !== index)
      .map((selectedIndex) => String(selectedIndex > index ? selectedIndex - 1 : selectedIndex))
  );
  selectedBasicMissionPhaseIndexes = validMissionPhaseSelection(phases);
}

function deleteSelectedMissionPhases() {
  const selectedIndexes = new Set(
    Array.from(selectedBasicMissionPhaseIndexes)
      .map((key) => Number(key))
      .filter(Number.isInteger)
  );
  if (!selectedIndexes.size) return;
  const phases = selectedBasicMissionPhases();
  phases.splice(0, phases.length, ...phases.filter((_, index) => !selectedIndexes.has(index)));
  selectedBasicMissionPhaseIndexes = new Set();
}

function renderCompositeTaskModeling(page) {
  const compositeTasks = compositeTaskList();
  const selected = resolveSelectedCompositeTask();
  const composite = selected.task || { name: "", taskItems: [] };
  const compositePath = selected.path;
  const timelineRows = buildCompositeTimelineRows(composite);
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <div class="tree-toolbar">
          <h4>复合任务列表</h4>
            <div class="toolbar-row" style="margin-bottom:0;">
              <button type="button" class="btn-primary" data-composite-task-add>新增</button>
              <button type="button" class="btn-danger" data-composite-task-delete>删除</button>
            </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>复合任务名称</th></tr></thead>
            <tbody>
              ${compositeTasks.map((task, index) => `
                <tr class="clickable-table-row ${index === selected.index ? "selected-table-row" : ""}" data-select-composite-task="${htmlEscape(task.id || index)}" tabindex="0" aria-selected="${index === selected.index ? "true" : "false"}">
                  <td>${htmlEscape(task.name)}</td>
                </tr>
              `).join("") || `<tr><td>暂无复合任务</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <div class="tree-toolbar">
            <h4>当前复合任务包含的基本任务</h4>
            <div class="toolbar-row" style="margin-bottom:0;">
              <button type="button" class="btn-primary" data-composite-task-item-add>新增</button>
            </div>
          </div>
          ${selected.task ? `
            <div class="form-table-grid" style="grid-template-columns:1fr;margin-bottom:12px;">
              ${field("复合任务名称", `${compositePath}.name`)}
              ${field("任务优先级（1最高）", `${compositePath}.priority`, "number", { min: "1", step: "1" })}
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>基本任务名称</th><th>编队名称</th><th>出发时间（HH：MM）</th><th>单日重复次数</th><th>间隔小时数</th><th>装备类型</th><th>任务时长</th><th>要求装备数量</th><th>最小装备数量（继承）</th><th>删除</th></tr></thead>
                <tbody>
                  ${(composite.taskItems || []).map((item, index) => {
                    const basicTask = findBasicMissionForTaskItem(item);
                    const inherited = compositeTaskInheritedBasicFields(item, basicTask);
                    return `
                    <tr>
                      <td>${basicMissionSelect(`${compositePath}.taskItems.${index}.basicMissionId`, item.basicMissionId)}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.groupName`)}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.firstWaveTime`, "time")}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.dailyRepeatCount`, "number", { min: "1", step: "1" })}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.intervalHours`, "number", { min: "0.1", step: "0.1" })}</td>
                      <td>${readOnlyTableValue(inherited.equipmentType)}</td>
                      <td>${readOnlyTableValue(inherited.taskDurationMinutes)}</td>
                      <td>${readOnlyTableValue(inherited.equipmentQuantity)}</td>
                      <td>${readOnlyTableValue(inherited.minRequiredSorties)}</td>
                      <td class="table-actions"><button type="button" class="btn-danger" data-composite-task-item-delete="${index}">删除</button></td>
                    </tr>
                  `; }).join("") || `<tr><td colspan="10">暂无基本任务</td></tr>`}
                </tbody>
              </table>
            </div>
          ` : `<div class="alert warn">请先新增复合任务。</div>`}
        </div>
        <div class="detail-card network-card">
          <h4>典型组合任务时序表</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>波次序号</th><th>基本任务名称</th><th>编队名称</th><th>出动时刻</th></tr></thead>
              <tbody>
                ${timelineRows.map((row) => `
                  <tr>
                    <td>${row.sequence}</td>
                    <td>${htmlEscape(row.basicTaskName)}</td>
                    <td>${htmlEscape(row.groupName)}</td>
                    <td>${htmlEscape(row.departureTime)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <h4>典型组合任务时序图</h4>
          ${renderCompositeTimelineChart(timelineRows)}
        </div>
      </div>
    </div>
  `;
}

function renderPeriodicTaskModeling(page) {
  const compositeTasks = scenario.missionProfile.compositeTasks || [];
  const periodicTasks = periodicTaskList();
  const selectedTask = selectedPeriodicTask(periodicTasks);
  const selectedDraft = selectedTask ? normalizePeriodicTask(selectedTask) : null;
  const selectedWeekRows = selectedDraft
    ? selectedDraft.compositeTasks.filter((row) => Number(row.weekIndex) === 1)
    : [];
  const profiles = periodicProfileLists(periodicTasks);
  if (!selectedPeriodicProfileIds.week || !profiles.week.some((item) => item.id === selectedPeriodicProfileIds.week)) {
    selectedPeriodicProfileIds.week = String(selectedTask?.id || profiles.week[0]?.id || "");
  }
  if (!selectedPeriodicProfileIds.month || !profiles.month.some((item) => item.id === selectedPeriodicProfileIds.month)) {
    selectedPeriodicProfileIds.month = String(profiles.month[0]?.id || "");
  }
  if (!selectedPeriodicProfileIds.year || !profiles.year.some((item) => item.id === selectedPeriodicProfileIds.year)) {
    selectedPeriodicProfileIds.year = String(profiles.year[0]?.id || "");
  }
  const compositeOptions = [
    { value: "", label: "请选择复合任务" },
    ...compositeTasks.map((task) => ({ value: task.id, label: task.name }))
  ];
  const activeProfiles = profiles[periodicActiveProfile];
  const selectedProfileId = selectedPeriodicProfileIds[periodicActiveProfile];
  const selectedProfile = activeProfiles.find((item) => item.id === selectedProfileId) || activeProfiles[0];
  const profileLabels = { week: "周", month: "月", year: "年" };
  const activeLabel = profileLabels[periodicActiveProfile];
  const activeProfileList = `
    <div class="periodic-profile-list" aria-label="${activeLabel}剖面列表">
      <div class="periodic-list-head"><strong>${activeLabel}剖面列表</strong><button type="button" data-periodic-profile-add="${periodicActiveProfile}" title="新增${activeLabel}剖面">＋ 新增</button></div>
      ${activeProfiles.length ? activeProfiles.map((item, itemIndex) => {
        const isSelected = item.id === selectedProfile?.id;
        const isRenaming = periodicProfileRenameState?.id === String(item.id) && periodicProfileRenameState?.type === periodicActiveProfile;
        const renameErrorId = `periodic-profile-rename-error-${periodicActiveProfile}-${itemIndex}`;
        return `
          <div class="periodic-profile-item ${isSelected ? "is-selected" : ""} ${isRenaming ? "is-renaming" : ""}" data-periodic-profile-select="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}">
            <div class="periodic-profile-main">
              ${periodicActiveProfile === "year" ? `<span class="periodic-profile-order">第 ${itemIndex + 1} 年</span>` : ""}
              ${isRenaming ? `
                <input class="periodic-profile-rename" data-periodic-profile-name="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" value="${htmlEscape(periodicProfileRenameState.draft)}" aria-label="重命名${activeLabel}剖面" aria-invalid="${periodicProfileRenameState.error ? "true" : "false"}" ${periodicProfileRenameState.error ? `aria-describedby="${renameErrorId}"` : ""} />
                ${periodicProfileRenameState.error ? `<span class="periodic-profile-rename-error" id="${renameErrorId}">${htmlEscape(periodicProfileRenameState.error)}</span>` : ""}
              ` : `
                <button type="button" class="periodic-profile-name" data-periodic-profile-select="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" aria-current="${isSelected ? "true" : "false"}" title="选择${activeLabel}剖面；按 F2 可重命名">${htmlEscape(item.name)}</button>
              `}
            </div>
            <div class="periodic-profile-actions">
              ${isRenaming ? `
                <button type="button" class="periodic-profile-icon is-confirm" data-periodic-profile-rename-save="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" aria-label="保存${activeLabel}剖面名称" title="保存名称（Enter）">✓</button>
                <button type="button" class="periodic-profile-icon" data-periodic-profile-rename-cancel="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" aria-label="取消重命名${activeLabel}剖面" title="取消（Esc）">×</button>
              ` : `
                <button type="button" class="periodic-profile-icon periodic-profile-edit" data-periodic-profile-rename-start="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" aria-label="重命名${activeLabel}剖面" title="重命名${activeLabel}剖面（F2）">✎</button>
                <button type="button" class="periodic-profile-icon periodic-profile-delete" data-periodic-profile-delete="${htmlEscape(item.id)}" data-periodic-profile-type="${periodicActiveProfile}" aria-label="删除${activeLabel}剖面" title="删除${activeLabel}剖面">×</button>
              `}
            </div>
          </div>
        `;
      }).join("") : `<div class="muted periodic-list-empty">暂无${activeLabel}剖面，请新增。</div>`}
    </div>
  `;
  const profileTabs = ["week", "month", "year"].map((type) => {
    const label = profileLabels[type];
    return `<button type="button" class="periodic-profile-tab ${periodicActiveProfile === type ? "is-active" : ""}" data-periodic-profile-tab="${type}">${label}剖面 <span>${profiles[type].length}</span></button>`;
  }).join("");
  const weekEditor = `
    <div class="periodic-panel-head">
      <div><h4>周剖面内容</h4><p class="muted">一个周剖面固定表示周一至周日七天，可在月剖面的各周次中选用。</p></div>
      ${selectedDraft ? `<span class="status-badge">当前：${htmlEscape(selectedProfile?.name || selectedDraft.name)}</span>` : ""}
    </div>
    ${selectedDraft ? `
      ${compositeTasks.length === 0 ? `<div class="alert warn">请先在复合任务建模中维护复合任务。</div>` : ""}
      <div class="table-wrap"><table><thead><tr><th style="width:96px;">周内日</th><th>复合任务名称</th></tr></thead><tbody>${selectedWeekRows.map((row) => {
        const rowIndex = selectedDraft.compositeTasks.findIndex((candidate) => candidate.weekIndex === row.weekIndex && candidate.weekday === row.weekday);
        return `<tr><td>${htmlEscape(periodicWeekdayLabel(row.weekday))}</td><td>${periodicValueSelect(`weekComposite:${rowIndex}`, row.compositeTaskId, compositeOptions)}</td></tr>`;
      }).join("")}</tbody></table></div>
    ` : `<div class="alert warn">暂无周剖面，请先新增。</div>`}
  `;
  const monthWeekProfileIds = selectedProfile?.weekProfileIds || [];
  const monthWeekCount = monthWeekProfileIds.length;
  const monthCanAddFifthWeek = monthWeekCount === 4;
  const monthEditor = `
    <div class="periodic-panel-head"><div><h4>月剖面配置</h4><p class="muted">按周次依次选择周剖面。前 4 周为固定坑位；需要覆盖第 5 周时再添加。</p></div>${selectedProfile ? `<span class="status-badge">${monthWeekCount} 个周剖面</span>` : ""}</div>
    ${selectedProfile ? `<div class="periodic-month-slot-grid" aria-label="${htmlEscape(selectedProfile.name)}的周剖面坑位">${monthWeekProfileIds.map((weekProfileId, index) => `<label class="periodic-month-slot ${index === 4 ? "is-optional" : ""}" data-periodic-month-slot="${index + 1}"><span>第 ${index + 1} 周${index === 4 ? "（可选）" : ""}</span><select data-periodic-composition-field="weekProfileId" data-periodic-composition-type="month" data-periodic-composition-profile="${htmlEscape(selectedProfile.id)}" data-periodic-composition-index="${index}" aria-label="第 ${index + 1} 周周剖面">${profiles.week.map((profile) => `<option value="${htmlEscape(profile.id)}" ${profile.id === weekProfileId ? "selected" : ""}>${htmlEscape(profile.name)}</option>`).join("")}</select>${index === 4 ? `<button type="button" class="periodic-slot-remove" data-periodic-composition-action="remove" data-periodic-composition-type="month" data-periodic-composition-profile="${htmlEscape(selectedProfile.id)}" data-periodic-composition-index="${index}">移除第 5 周</button>` : ""}</label>`).join("")}</div><div class="toolbar-row periodic-month-slot-actions">${monthCanAddFifthWeek ? `<button type="button" data-periodic-composition-action="add" data-periodic-composition-type="month" data-periodic-composition-profile="${htmlEscape(selectedProfile.id)}">＋ 添加第 5 周</button>` : ""}<span class="muted">每个月配置 4 个周剖面；少数跨 5 周的月份可增加第 5 个坑位。</span></div>` : `<div class="alert warn">暂无月剖面，请先新增。</div>`}
  `;
  const yearMonths = selectedProfile?.monthProfileIds || [];
  const selectedYearIndex = Math.max(0, profiles.year.findIndex((item) => item.id === selectedProfile?.id));
  const yearTotalWeeks = yearMonths.reduce((sum, monthProfileId) => {
    const monthProfile = profiles.month.find((item) => item.id === monthProfileId);
    return sum + (monthProfile?.weekProfileIds?.length || 0);
  }, 0);
  const yearEditor = `
    <div class="periodic-panel-head"><div><h4>年剖面组合</h4><p class="muted">年剖面列表按顺序组成多年任务；每个规划年度的 12 个月合计应为 52 周。</p></div>${selectedProfile ? `<span class="status-badge ${yearTotalWeeks === 52 ? "" : "warn"}">第 ${selectedYearIndex + 1} 年 · ${yearTotalWeeks} / 52 周</span>` : ""}</div>
    ${selectedProfile ? `<div class="toolbar-row periodic-year-actions"><button type="button" data-periodic-year-action="duplicate" data-periodic-year-profile="${htmlEscape(selectedProfile.id)}">复制为下一年</button><button type="button" data-periodic-year-action="up" data-periodic-year-profile="${htmlEscape(selectedProfile.id)}">上移一年</button><button type="button" data-periodic-year-action="down" data-periodic-year-profile="${htmlEscape(selectedProfile.id)}">下移一年</button></div>` : ""}
    ${selectedProfile ? `<div class="periodic-year-grid">${Array.from({ length: 12 }, (_, index) => `<label><span>${index + 1} 月</span><select data-periodic-composition-field="monthProfileId" data-periodic-composition-type="year" data-periodic-composition-profile="${htmlEscape(selectedProfile.id)}" data-periodic-composition-index="${index}">${profiles.month.map((profile) => `<option value="${htmlEscape(profile.id)}" ${profile.id === yearMonths[index] ? "selected" : ""}>${htmlEscape(profile.name)}</option>`).join("")}</select></label>`).join("")}</div>` : `<div class="alert warn">暂无年剖面，请先新增。</div>`}
  `;
  const profileEditor = periodicActiveProfile === "week" ? weekEditor : periodicActiveProfile === "month" ? monthEditor : yearEditor;
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="periodic-profile-tabs">${profileTabs}</div>
    <div class="organization-layout task-modeling-periodic-layout">
      <div class="tree-container periodic-profile-sidebar">
        ${activeProfileList}
      </div>
      <div class="detail-panel"><div class="detail-card">${profileEditor}</div></div>
    </div>
  `;
}

function periodicProfileLists(periodicTasks = periodicTaskList()) {
  if (!scenario.missionProfile.periodicProfileLists || typeof scenario.missionProfile.periodicProfileLists !== "object") {
    scenario.missionProfile.periodicProfileLists = { week: [], month: [], year: [] };
  }
  const lists = scenario.missionProfile.periodicProfileLists;
  const weekIds = periodicTasks.map((task) => String(task.id));
  lists.week = periodicTasks.map((task) => {
    const existing = Array.isArray(lists.week) ? lists.week.find((item) => String(item.id) === String(task.id)) : null;
    return { id: String(task.id), name: String(existing?.name || task.name || "周剖面") };
  });
  lists.month = (Array.isArray(lists.month) ? lists.month : []).filter((item) => item && item.id).map((item) => {
    const legacyWeekIds = Array.isArray(item.weekProfileIds) ? item.weekProfileIds : [];
    const legacySegments = Array.isArray(item.weekSegments) ? item.weekSegments : [];
    const expandedLegacySlots = legacySegments.flatMap((segment) => Array.from(
      { length: clamp(Math.floor(Number(segment.repeatWeeks || 1)), 1, 5) },
      () => segment.weekProfileId
    ));
    const sourceSlots = legacyWeekIds.length ? legacyWeekIds : expandedLegacySlots;
    const fallbackWeekId = String(weekIds[0] || "");
    const weekProfileIds = sourceSlots
      .map((weekProfileId) => weekIds.includes(String(weekProfileId)) ? String(weekProfileId) : fallbackWeekId)
      .filter(Boolean)
      .slice(0, 5);
    while (weekProfileIds.length < 4 && fallbackWeekId) weekProfileIds.push(fallbackWeekId);
    const { weekSegments: _legacyWeekSegments, ...monthProfile } = item;
    return { ...monthProfile, name: String(item.name || "未命名月剖面"), weekProfileIds };
  });
  if (!lists.month.length) lists.month.push({ id: "month-default", name: "常规月", weekProfileIds: Array(4).fill(String(weekIds[0] || "")) });
  const monthIds = lists.month.map((item) => String(item.id));
  lists.year = (Array.isArray(lists.year) ? lists.year : []).filter((item) => item && item.id).map((item) => {
    const sourceMonths = Array.isArray(item.monthProfileIds) ? item.monthProfileIds : [];
    const monthProfileIds = Array.from({ length: 12 }, (_, index) => monthIds.includes(String(sourceMonths[index])) ? String(sourceMonths[index]) : String(monthIds[0] || ""));
    return { ...item, name: String(item.name || "未命名年剖面"), monthProfileIds };
  });
  if (!lists.year.length) lists.year.push({ id: "year-default", name: "基准年度", monthProfileIds: Array(12).fill(String(monthIds[0] || "")) });
  return lists;
}

function addPeriodicProfile(type) {
  const lists = periodicProfileLists();
  const order = lists[type].length + 1;
  if (type === "week") {
    const task = createPeriodicTaskDraft({ name: `周剖面${order}` });
    scenario.missionProfile.periodicTasks = [...periodicTaskList(), task];
    selectedPeriodicTaskId = task.id;
    selectedPeriodicProfileIds.week = task.id;
  } else {
    const prefix = type === "month" ? "月剖面" : "年剖面";
    const item = { id: `${type}-${Date.now()}`, name: `${prefix}${order}` };
    if (type === "month") item.weekProfileIds = Array(4).fill(String(lists.week[0]?.id || ""));
    if (type === "year") item.monthProfileIds = Array(12).fill(String(lists.month[0]?.id || ""));
    lists[type].push(item);
    selectedPeriodicProfileIds[type] = item.id;
  }
  updatePreviewResultsThroughApiClient();
}

function deletePeriodicProfile(id, type) {
  const lists = periodicProfileLists();
  if (!id || !Array.isArray(lists[type]) || lists[type].length <= 1) return;
  if (type === "week") {
    scenario.missionProfile.periodicTasks = periodicTaskList().filter((task) => String(task.id) !== String(id));
    selectedPeriodicTaskId = String(periodicTaskList()[0]?.id || "");
    const fallbackWeekId = String(periodicTaskList()[0]?.id || "");
    lists.month.forEach((month) => {
      month.weekProfileIds = (month.weekProfileIds || []).map((weekProfileId) => (
        String(weekProfileId) === String(id) ? fallbackWeekId : String(weekProfileId)
      ));
    });
  } else {
    lists[type] = lists[type].filter((item) => String(item.id) !== String(id));
    selectedPeriodicProfileIds[type] = String(lists[type][0]?.id || "");
    if (type === "month") {
      const fallbackMonthId = String(lists.month[0]?.id || "");
      lists.year.forEach((year) => {
        year.monthProfileIds = (year.monthProfileIds || []).map((monthId) => String(monthId) === String(id) ? fallbackMonthId : monthId);
      });
    }
  }
  updatePreviewResultsThroughApiClient();
}

function updatePeriodicComposition(type, profileId, action, index) {
  if (type !== "month") return;
  const lists = periodicProfileLists();
  const profile = lists.month.find((item) => String(item.id) === String(profileId));
  if (!profile) return;
  const weekProfileIds = Array.isArray(profile.weekProfileIds) ? profile.weekProfileIds : [];
  if (action === "add" && weekProfileIds.length === 4) {
    weekProfileIds.push(String(lists.week[0]?.id || ""));
  } else if (action === "remove" && weekProfileIds.length === 5 && index === 4) {
    weekProfileIds.pop();
  }
  profile.weekProfileIds = weekProfileIds;
  updatePreviewResultsThroughApiClient();
}

function updatePeriodicCompositionField(type, profileId, index, field, value) {
  const lists = periodicProfileLists();
  if (type === "month") {
    const profile = lists.month.find((item) => String(item.id) === String(profileId));
    if (!profile?.weekProfileIds?.[index]) return;
    if (field === "weekProfileId" && lists.week.some((item) => item.id === String(value))) profile.weekProfileIds[index] = String(value);
  }
  if (type === "year") {
    const profile = lists.year.find((item) => String(item.id) === String(profileId));
    if (!profile || field !== "monthProfileId" || !lists.month.some((item) => item.id === String(value))) return;
    profile.monthProfileIds[index] = String(value);
  }
  updatePreviewResultsThroughApiClient();
}

function updatePeriodicYearList(action, profileId) {
  const lists = periodicProfileLists();
  const index = lists.year.findIndex((item) => String(item.id) === String(profileId));
  if (index < 0) return;
  if (action === "duplicate") {
    const copy = {
      ...structuredClone(lists.year[index]),
      id: `year-${Date.now()}`,
      name: `第${lists.year.length + 1}年`
    };
    lists.year.splice(index + 1, 0, copy);
    selectedPeriodicProfileIds.year = copy.id;
  } else if (action === "up" && index > 0) {
    [lists.year[index - 1], lists.year[index]] = [lists.year[index], lists.year[index - 1]];
  } else if (action === "down" && index < lists.year.length - 1) {
    [lists.year[index + 1], lists.year[index]] = [lists.year[index], lists.year[index + 1]];
  }
  updatePreviewResultsThroughApiClient();
}

function focusPeriodicProfileRenameInput() {
  queueMicrotask(() => {
    const input = app.querySelector?.("[data-periodic-profile-name]");
    input?.focus();
    input?.select?.();
  });
}

function beginPeriodicProfileRename(id, type) {
  const lists = periodicProfileLists();
  const item = lists[type]?.find((profile) => String(profile.id) === String(id));
  if (!item) return;
  selectedPeriodicProfileIds[type] = String(id);
  if (type === "week") selectedPeriodicTaskId = String(id);
  periodicProfileRenameState = {
    id: String(id),
    type,
    draft: String(item.name || ""),
    error: ""
  };
  render();
  focusPeriodicProfileRenameInput();
}

function periodicProfileRenameError(id, type, value) {
  const name = String(value || "").trim();
  if (!name) return "名称不能为空。";
  const lists = periodicProfileLists();
  if (lists[type]?.some((profile) => String(profile.id) !== String(id) && String(profile.name || "").trim() === name)) {
    return "名称已存在，请换一个名称。";
  }
  return "";
}

function commitPeriodicProfileRename(input) {
  if (!periodicProfileRenameState) return false;
  const state = periodicProfileRenameState;
  const draft = String(input?.value ?? state.draft ?? "");
  const error = periodicProfileRenameError(state.id, state.type, draft);
  if (error) {
    periodicProfileRenameState = { ...state, draft, error };
    render();
    focusPeriodicProfileRenameInput();
    return false;
  }
  const renamed = renamePeriodicProfile(state.id, state.type, draft);
  if (!renamed) return false;
  periodicProfileRenameState = null;
  markProjectDraftChanged();
  render();
  return true;
}

function cancelPeriodicProfileRename() {
  if (!periodicProfileRenameState) return;
  periodicProfileRenameState = null;
  render();
}

function renamePeriodicProfile(id, type, value, options = {}) {
  const name = String(value || "").trim();
  if (!name) return false;
  const lists = periodicProfileLists();
  const item = lists[type]?.find((profile) => String(profile.id) === String(id));
  if (!item) return false;
  if (lists[type].some((profile) => String(profile.id) !== String(id) && profile.name === name)) return false;
  item.name = name;
  if (type === "week") {
    const task = periodicTaskList().find((candidate) => String(candidate.id) === String(id));
    if (task) {
      task.name = name;
      task.taskName = name;
      task.periodicTaskName = name;
      task.experimentName = name;
    }
  }
  if (options.updatePreview !== false) updatePreviewResultsThroughApiClient();
  return true;
}

function periodicTaskList() {
  if (!Array.isArray(scenario.missionProfile.periodicTasks)) {
    scenario.missionProfile.periodicTasks = [];
  }
  scenario.missionProfile.periodicTasks = scenario.missionProfile.periodicTasks.map((task) => normalizePeriodicTask(task));
  return scenario.missionProfile.periodicTasks;
}

function repeatSelectedPeriodicWeek(mode) {
  const task = selectedPeriodicTask();
  if (!task) return;
  const sourceRows = (task.compositeTasks || []).filter((row) => Number(row.weekIndex) === selectedPeriodicWeekIndex);
  const countInput = app.querySelector?.("[data-periodic-repeat-count]");
  const requested = Math.max(1, Math.floor(Number(countInput?.value || 1)));
  const lastWeek = mode === "remaining" ? 52 : Math.min(52, selectedPeriodicWeekIndex + requested);
  const existing = new Map((task.compositeTasks || []).map((row) => [`${row.weekIndex}:${row.weekday}`, row]));
  for (let week = selectedPeriodicWeekIndex + 1; week <= lastWeek; week += 1) {
    for (const source of sourceRows) {
      const copy = { ...structuredClone(source), weekIndex: week };
      if ("id" in copy) copy.id = `${source.id || "periodic-task"}-week-${week}-${source.weekday || "day"}`;
      existing.set(`${week}:${source.weekday}`, copy);
    }
  }
  task.repeatWeeks = Math.max(Number(task.repeatWeeks || 1), lastWeek);
  task.compositeTasks = [...existing.values()].sort((a, b) => a.weekIndex - b.weekIndex || String(a.weekday).localeCompare(String(b.weekday)));
  updatePreviewResultsThroughApiClient();
}

function selectedPeriodicTask(periodicTasks = periodicTaskList()) {
  if (!periodicTasks.length) {
    const task = createPeriodicTaskDraft();
    scenario.missionProfile.periodicTasks = [task];
    selectedPeriodicTaskId = String(task.id);
    selectedPeriodicWeekIndex = 1;
    return task;
  }
  const selected = periodicTasks.find((task) => String(task.id) === String(selectedPeriodicTaskId)) || periodicTasks[0];
  selectedPeriodicTaskId = String(selected.id);
  return selected;
}

function createPeriodicTaskDraft(source = {}) {
  const order = periodicTaskList().length + 1;
  return normalizePeriodicTask({
    id: source.id || `periodic-${Date.now()}`,
    parentTaskName: source.parentTaskName || source.parentTask || "默认任务",
    name: source.name || `周期性任务${order}`,
    cycleDays: 7,
    repeatWeeks: source.repeatWeeks || source.repeatRounds || 1
  });
}

function normalizePeriodicTaskCycleDays(source = {}) {
  return 7;
}

function clampPeriodicCycleDays(value) {
  return 7;
}

function parsePeriodicCompositeTasks(source, repeatWeeks, weekdayAssignments, validCompositeIds) {
  const rawRows = Array.isArray(source.compositeTasks)
    ? source.compositeTasks
    : typeof source.compositeTasks === "string"
      ? safeJsonParse(source.compositeTasks, [])
      : [];
  const byWeekday = new Map();
  rawRows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const weekIndex = Math.max(1, Math.floor(Number(row.weekIndex || row.week || Math.floor(index / 7) + 1)));
    const weekday = String(row.weekday || PERIODIC_WEEKDAY_FIELDS[index % 7]?.key || "mondayCompositeTaskId");
    const compositeTaskId = String(row.compositeTaskId || row.compositeTask || row.taskId || "");
    byWeekday.set(`${weekIndex}:${weekday}`, validCompositeIds.has(compositeTaskId) ? compositeTaskId : "");
  });
  return Array.from({ length: repeatWeeks }).flatMap((_, weekIndex) => PERIODIC_WEEKDAY_FIELDS.map((field) => {
    const key = `${weekIndex + 1}:${field.key}`;
    const legacyCompositeId = String(weekdayAssignments[field.key] || "");
    return {
      weekIndex: weekIndex + 1,
      weekday: field.key,
      compositeTaskId: byWeekday.has(key) ? byWeekday.get(key) : legacyCompositeId
    };
  }));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function periodicWeekdayLabel(value) {
  return PERIODIC_WEEKDAY_FIELDS.find((field) => field.key === String(value) || field.legacyKey === String(value))?.label || String(value || "");
}

function normalizePeriodicTask(source = {}) {
  const validCompositeIds = new Set((scenario.missionProfile.compositeTasks || []).map((task) => String(task.id)));
  const rawAssignments = source.weekdayAssignments && typeof source.weekdayAssignments === "object" ? source.weekdayAssignments : {};
  const weekdayAssignments = {};
  PERIODIC_WEEKDAY_FIELDS.forEach((field) => {
    const candidate = String(rawAssignments[field.key] || rawAssignments[field.legacyKey] || source[field.key] || "");
    weekdayAssignments[field.key] = validCompositeIds.has(candidate) ? candidate : "";
    weekdayAssignments[field.legacyKey] = weekdayAssignments[field.key];
  });
  const cycleDays = normalizePeriodicTaskCycleDays(source);
  const repeatWeeks = clamp(Math.floor(Number(source.repeatWeeks ?? source.repeatRounds ?? source.rounds ?? source.repeatCount ?? source.dailyRepeatCount ?? 1)), 1, 52);
  const compositeTasks = parsePeriodicCompositeTasks(source, repeatWeeks, weekdayAssignments, validCompositeIds);
  const legacyLinkedCompositeIds = PERIODIC_WEEKDAY_FIELDS
    .map((field) => weekdayAssignments[field.key])
    .filter(Boolean);
  const linkedCompositeIds = Array.isArray(source.compositeTaskIds)
    ? source.compositeTaskIds.map((id) => String(id)).filter((id) => validCompositeIds.has(id))
    : [...compositeTasks.map((row) => row.compositeTaskId).filter(Boolean), ...legacyLinkedCompositeIds];
  return {
    ...source,
    id: String(source.id || `periodic-${Date.now()}`),
    parentTaskName: String(source.parentTaskName || source.parentTask || source.taskGroupName || "默认任务"),
    parentTask: String(source.parentTask || source.parentTaskName || source.taskGroupName || "默认任务"),
    taskGroupName: String(source.taskGroupName || source.parentTaskName || source.parentTask || "默认任务"),
    name: String(source.name || source.periodicTaskName || source.experimentName || "未命名周期性任务"),
    taskName: String(source.taskName || source.name || source.periodicTaskName || source.experimentName || "未命名周期性任务"),
    periodicTaskName: String(source.periodicTaskName || source.name || source.experimentName || "未命名周期性任务"),
    experimentName: String(source.experimentName || source.name || source.periodicTaskName || "未命名周期性任务"),
    taskCategory: "periodic",
    cycleDays,
    taskPeriodDays: cycleDays,
    periodDays: cycleDays,
    repeatCycleDays: cycleDays,
    repeatCycleValue: cycleDays,
    repeatCycleUnit: "day",
    repeatRounds: repeatWeeks,
    repeatWeeks,
    repeatCount: repeatWeeks,
    dailyRepeatCount: repeatWeeks,
    weekdayAssignments,
    compositeTasks,
    compositeTaskIds: Array.from(new Set(linkedCompositeIds)),
    ...Object.fromEntries(PERIODIC_WEEKDAY_FIELDS.map((field) => [field.key, weekdayAssignments[field.key]]))
  };
}

function updateSelectedPeriodicTask(field, value, options = {}) {
  const tasks = periodicTaskList();
  const selectedTask = selectedPeriodicTask(tasks);
  if (!selectedTask) return;
  const draft = normalizePeriodicTask(selectedTask);
  if (field === "name") {
    draft.name = String(value || "").trim() || "未命名周期性任务";
    draft.taskName = draft.name;
    draft.periodicTaskName = draft.name;
    draft.experimentName = draft.name;
  } else if (field === "parentTaskName") {
    draft.parentTaskName = String(value || "").trim() || "默认任务";
    draft.parentTask = draft.parentTaskName;
    draft.taskGroupName = draft.parentTaskName;
  } else if (field === "cycleDays") {
    draft.cycleDays = 7;
    draft.taskPeriodDays = draft.cycleDays;
    draft.periodDays = draft.cycleDays;
    draft.repeatCycleDays = draft.cycleDays;
    draft.repeatCycleValue = draft.cycleDays;
    draft.repeatCycleUnit = "day";
  } else if (field === "repeatWeeks") {
    draft.repeatWeeks = clamp(Math.floor(Number(value || 1)), 1, 52);
    draft.repeatRounds = draft.repeatWeeks;
    draft.repeatCount = draft.repeatWeeks;
    draft.dailyRepeatCount = draft.repeatWeeks;
    selectedPeriodicWeekIndex = clamp(selectedPeriodicWeekIndex, 1, draft.repeatWeeks);
  } else if (field.startsWith("dayComposite:") || field.startsWith("weekComposite:")) {
    const index = Number(field.split(":")[1]);
    if (Number.isInteger(index) && draft.compositeTasks[index]) {
      draft.compositeTasks[index] = { ...draft.compositeTasks[index], compositeTaskId: String(value || "") };
    }
  }
  const nextTask = normalizePeriodicTask(draft);
  scenario.missionProfile.periodicTasks = tasks.map((task) => (String(task.id) === String(nextTask.id) ? nextTask : task));
  updatePreviewResultsThroughApiClient();
  if (options.renderAfter !== false) render();
}

function periodicValueSelect(field, selectedValue, options) {
  return `
    <select data-periodic-field="${htmlEscape(field)}">
      ${options.map((option) => {
        const value = String(option.value);
        return `<option value="${htmlEscape(value)}" ${value === String(selectedValue) ? "selected" : ""}>${htmlEscape(option.label)}</option>`;
      }).join("")}
    </select>
  `;
}

function buildCompositeTimelineRows(composite) {
  return (composite.taskItems || []).flatMap((item) => {
    const repeatCount = Math.max(1, Math.trunc(Number(item.dailyRepeatCount || 1)));
    const intervalHours = Math.max(0.1, Number(item.intervalHours || 1));
    const basicTask = findBasicMissionForTaskItem(item);
    const durationMinutes = Number(basicTask?.taskDurationMinutes || item.taskDurationMinutes || primaryBasicMissionRecord().taskDurationMinutes || 180);
    return Array.from({ length: repeatCount }, (_, index) => {
      const departureTime = addHoursToTime(item.firstWaveTime, index * intervalHours);
      const totalStartMinutes = timeToDayMinutes(item.firstWaveTime) + index * intervalHours * 60;
      const totalEndMinutes = totalStartMinutes + durationMinutes;
      return {
        sequence: index + 1,
        basicTaskName: item.basicTaskName,
        groupName: item.groupName,
        departureTime,
        totalStartMinutes,
        totalEndMinutes
      };
    });
  })
    .sort((left, right) => left.totalStartMinutes - right.totalStartMinutes)
    .map((row, index) => ({ ...row, sequence: index + 1 }));
}

function renderCompositeTimelineChart(rows) {
  if (!rows.length) {
    return `<div class="alert warn">暂无时序数据</div>`;
  }
  const tooLong = rows.some((row) => row.totalEndMinutes > 30 * 60);
  const groupedRows = Array.from(rows.reduce((acc, row) => {
    const taskName = row.basicTaskName || "未命名任务";
    const groupName = row.groupName || "未指定编队";
    const key = `${taskName} / ${groupName}`;
    acc.set(key, [...(acc.get(key) || []), row]);
    return acc;
  }, new Map()).entries());
  return `
    ${tooLong ? `<div class="alert warn">任务时长过长，应新建复合任务，在周期性任务中组合</div>` : ""}
    <div class="composite-timeline-chart" style="display:grid;gap:10px;margin-top:10px;">
      ${groupedRows.map(([taskName, taskRows]) => {
        return `
          <div class="timeline-chart-row" style="display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;">
            <div style="font-size:12px;color:#475569;">${htmlEscape(taskName)}</div>
            <div style="position:relative;height:28px;background:#f1f5f9;border:1px solid #dbe3ef;border-radius:6px;overflow:hidden;">
              ${taskRows.map((row) => {
                const durationMinutes = Math.max(15, row.totalEndMinutes - row.totalStartMinutes);
                const startPercent = Math.min(96, Math.max(0, (row.totalStartMinutes / (30 * 60)) * 100));
                const widthPercent = Math.min(100 - startPercent, Math.max(4, (durationMinutes / (30 * 60)) * 100));
                return `<div title="${htmlEscape(formatTimelineHour(row.totalStartMinutes))} - ${htmlEscape(formatTimelineHour(row.totalEndMinutes))}" style="position:absolute;left:${startPercent}%;width:${widthPercent}%;top:5px;height:16px;border-radius:4px;background:#2563eb;"><span class="timeline-time-label">${htmlEscape(formatTimelineHour(row.totalStartMinutes))}</span></div>`;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatTimelineHour(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToDayMinutes(value) {
  const [hour, minute] = String(value || "00:00").split(":").map((part) => Number(part));
  return (((Number(hour) || 0) * 60 + (Number(minute) || 0)) % 1440 + 1440) % 1440;
}

function addHoursToTime(value, hours) {
  return addMinutesToTime(value, Number(hours || 0) * 60);
}

function addMinutesToTime(value, minutes) {
  const [hour, minute] = String(value || "00:00").split(":").map((part) => Number(part));
  const total = (((Number(hour) || 0) * 60 + (Number(minute) || 0) + Number(minutes || 0)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function diffTimeMinutes(start, end) {
  const [startHour, startMinute] = String(start || "").split(":").map((part) => Number(part));
  const [endHour, endMinute] = String(end || "").split(":").map((part) => Number(part));
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  return endTotal >= startTotal ? endTotal - startTotal : endTotal + 1440 - startTotal;
}

function renderEquipmentModeling(page) {
  const selectedState = resolveSelectedEquipmentNode();
  const components = equipmentComponentsForSelectionModel({ scenario, selection: selectedState });
  const aircraftModels = wholeMachineModels();
  const aircraftRowCount = selectedState.kind === "aircraft-list" ? aircraftModels.length : (selectedState.kind === "aircraft" ? 1 : 0);
  const showEquipmentSystemTable = components.length || aircraftRowCount > 0;
  const visibleRowCount = components.length + aircraftRowCount;
  return `
    <div class="section-head section-context">
      <span>装备结构树 / 装备系统建模表</span>
    </div>
    <div class="organization-layout equipment-layout">
      <aside class="tree-container">
        <div class="tree-toolbar equipment-tree-toolbar">
          <h4>装备结构树</h4>
          <div class="equipment-tree-actions">
            <button type="button" class="btn-primary" data-equipment-add-node>新增节点</button>
            <button type="button" class="btn-danger" data-equipment-delete-node ${selectedState.kind === "aircraft-list" ? "disabled" : ""}>删除</button>
          </div>
        </div>
        <label class="equipment-tree-search">搜索名称<input data-equipment-search value="${htmlEscape(equipmentSearchQuery)}" placeholder="输入系统或组件名称"></label>
        ${renderCollapsibleTree(buildEquipmentTreeNodes())}
      </aside>
      <section class="detail-panel equipment-system-table-panel">
        <div class="detail-card">
          <div class="section-head">
            <h3>装备系统建模</h3>
            <span>${htmlEscape(equipmentSelectionSummary(selectedState, visibleRowCount))}</span>
          </div>
          <div class="equipment-import-row">
            <button type="button" data-equipment-download-template>下载模板</button>
            <label class="rms-file-button">上传文件<input data-equipment-import-file type="file" accept=".csv,.tsv,.json,application/json,text/csv,text/tab-separated-values"></label>
            <p class="rms-import-status">${htmlEscape(equipmentImportStatus)}</p>
          </div>
          ${showEquipmentSystemTable ? renderEquipmentSystemTable(selectedState) : importedDataEmptyState(page.name || "装备系统建模")}
        </div>
      </section>
    </div>
  `;
}

function buildEquipmentTreeNodes() {
  const selectedState = resolveSelectedEquipmentNode();
  return [{
    id: "equipment-tree:aircraft-list",
    label: "飞机列表",
    meta: `${wholeMachineModels().length} 类飞机`,
    root: true,
    selected: selectedState.kind === "aircraft-list",
    actionAttrs: "data-select-equipment-root",
    children: wholeMachineModels().map((model) => ({
      id: `equipment-tree:${model}`,
      label: model,
      meta: "整机级",
      selected: selectedState.kind === "aircraft" && selectedState.aircraftModel === model,
      actionAttrs: `data-select-equipment-aircraft="${htmlEscape(model)}"`,
      children: buildEquipmentComponentTreeNodes(model, "aircraft-root")
    }))
  }];
}

function buildEquipmentComponentTreeNodes(aircraftModel, parentId) {
  const toTreeNode = ({ component, children }) => ({
    id: `equipment-component:${aircraftModel}:${component.id || component.name}`,
    label: component.name,
    meta: `${component.quantity} 件`,
    selected: selectedEquipmentNodeKey === `component:${component.id}`,
    actionAttrs: `data-select-equipment-component="${htmlEscape(component.id)}"`,
    children: children.map(toTreeNode)
  });
  return buildEquipmentComponentTreeModel({ scenario, aircraftModel, parentId }).map(toTreeNode);
}

function wholeMachineModels() {
  return wholeMachineModelsForScenario(scenario);
}

function componentBelongsToAircraft(component, aircraftModel) {
  return componentBelongsToAircraftModel(component, aircraftModel);
}

function findEquipmentComponentIndexById(componentId) {
  return (scenario.components || []).findIndex((component) => String(component.id || "") === String(componentId || ""));
}

function resolveSelectedEquipmentNode() {
  const selection = resolveEquipmentSelectionModel({
    scenario,
    selectedEquipmentNodeKey,
    selectedEquipmentComponentIndex
  });
  if (selection.selectedEquipmentNodeKey) {
    selectedEquipmentNodeKey = selection.selectedEquipmentNodeKey;
  }
  return selection;
}

function clampEquipmentComponentIndex(index) {
  return clamp(Number.isFinite(index) ? index : 0, 0, Math.max((scenario.components || []).length - 1, 0));
}

function addEquipmentNodeForSelection() {
  const selectedState = resolveSelectedEquipmentNode();
  const mutation = addEquipmentNodeForSelectionModel({ scenario, selection: selectedState });
  if (mutation.kind === "aircraft") {
    ensureOperationsSupportActivityForAircraftModel(mutation.aircraftModel);
  }
  if (Number.isFinite(mutation.selectedEquipmentComponentIndex)) {
    selectedEquipmentComponentIndex = mutation.selectedEquipmentComponentIndex;
  }
  selectedEquipmentNodeKey = mutation.selectedEquipmentNodeKey || selectedEquipmentNodeKey;
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedEquipmentNode() {
  const selectedState = resolveSelectedEquipmentNode();
  const mutation = deleteEquipmentNodeForSelectionModel({ scenario, selection: selectedState });
  if (mutation.kind === "none") return;
  if (mutation.kind === "aircraft") {
    const aircraftModel = mutation.aircraftModel;
    removeOperationsSupportActivitiesForAircraftModel(aircraftModel);
    removePreventiveMaintenanceActivitiesForAircraftModel(aircraftModel);
    const fallbackModel = wholeMachineModels()[0] || "";
    cleanupDeletedEquipmentAircraftReferences(aircraftModel, fallbackModel);
  } else {
    cleanupDeletedEquipmentComponentReferences(mutation.deletedComponentIds, mutation.selectedEquipmentNodeKey);
  }
  selectedEquipmentNodeKey = mutation.selectedEquipmentNodeKey || selectedEquipmentNodeKey;
  selectedEquipmentComponentIndex = Number.isFinite(mutation.selectedEquipmentComponentIndex)
    ? mutation.selectedEquipmentComponentIndex
    : 0;
  updatePreviewResultsThroughApiClient();
}

function cleanupDeletedEquipmentComponentReferences(deletedComponentIds, fallbackSelectionKey = "") {
  const deletedIds = new Set((deletedComponentIds || []).map((componentId) => String(componentId || "")).filter(Boolean));
  if (!deletedIds.size) return;
  for (const activity of scenario.supportActivities || []) {
    if (deletedIds.has(String(activity.equipmentId || ""))) {
      delete activity.equipmentId;
    }
  }
  if (selectedCorrectiveComponentId && deletedIds.has(String(selectedCorrectiveComponentId || ""))) {
    selectedCorrectiveComponentId = fallbackSelectionKey?.startsWith("component:")
      ? fallbackSelectionKey.slice("component:".length)
      : "";
  }
}

function cleanupDeletedEquipmentAircraftReferences(deletedModel, fallbackModel = "") {
  const oldModel = String(deletedModel || "");
  const nextModel = String(fallbackModel || "");
  if (!oldModel) return;
  for (const record of editableBasicMissionRecords()) {
    if (String(record.task?.equipmentType || "") === oldModel) record.task.equipmentType = nextModel;
  }
  for (const member of scenario.combatUnit?.members || []) {
    if (String(member.model || "") === oldModel) member.model = nextModel;
  }
  for (const resource of scenario.supportResources || []) {
    if (Array.isArray(resource.aircraft)) {
      resource.aircraft = resource.aircraft.filter((model) => String(model) !== oldModel);
      if (nextModel && !resource.aircraft.length) resource.aircraft = [nextModel];
    }
  }
  if (selectedBasicMissionEquipmentType === oldModel) {
    selectedBasicMissionEquipmentType = nextModel;
  }
  if (selectedOperationsSupportAircraftModel === oldModel) {
    selectedOperationsSupportAircraftModel = nextModel;
  }
  if (selectedPreventiveMaintenanceAircraftModel === oldModel) {
    selectedPreventiveMaintenanceAircraftModel = nextModel;
  }
}

function updateEquipmentAircraftModel(previousModel, nextModelRaw) {
  const nextModel = String(nextModelRaw || "").trim();
  const oldModel = String(previousModel || "").trim();
  if (!oldModel || !nextModel || nextModel === oldModel) return false;
  if (!scenario.equipment || typeof scenario.equipment !== "object") {
    scenario.equipment = { model: "", wholeMachineModels: [] };
  }
  if (!Array.isArray(scenario.equipment.wholeMachineModels)) {
    scenario.equipment.wholeMachineModels = wholeMachineModels();
  }
  scenario.equipment.wholeMachineModels = scenario.equipment.wholeMachineModels.map((model) => (
    String(model) === oldModel ? nextModel : model
  ));
  scenario.equipment.wholeMachineModels = Array.from(new Set(scenario.equipment.wholeMachineModels));
  if (Array.isArray(scenario.equipment.aircraftTypes)) {
    scenario.equipment.aircraftTypes = scenario.equipment.aircraftTypes.map((aircraftType) => {
      if (typeof aircraftType === "string") {
        return String(aircraftType) === oldModel ? nextModel : aircraftType;
      }
      if (!aircraftType || typeof aircraftType !== "object" || Array.isArray(aircraftType)) return aircraftType;
      const aircraftTypeModel = String(aircraftType.model || aircraftType.name || aircraftType.id || "");
      if (aircraftTypeModel !== oldModel) return aircraftType;
      return {
        ...aircraftType,
        model: nextModel,
        name: nextModel
      };
    });
  }
  if (scenario.equipment && String(scenarioEquipmentModel()) === oldModel) {
    scenario.equipment.model = nextModel;
  }
  for (const component of scenario.components || []) {
    if (String(component.aircraftModel || "") === oldModel) component.aircraftModel = nextModel;
  }
  updateOperationsSupportActivityAircraftModel(oldModel, nextModel);
  updatePreventiveMaintenanceActivityAircraftModel(oldModel, nextModel);
  for (const record of editableBasicMissionRecords()) {
    if (String(record.task?.equipmentType || "") === oldModel) record.task.equipmentType = nextModel;
  }
  for (const member of scenario.combatUnit?.members || []) {
    if (String(member.model || "") === oldModel) member.model = nextModel;
  }
  for (const resource of scenario.supportResources || []) {
    if (Array.isArray(resource.aircraft)) {
      resource.aircraft = resource.aircraft.map((model) => String(model) === oldModel ? nextModel : model);
    }
  }
  if (selectedEquipmentNodeKey === `aircraft:${oldModel}`) {
    selectedEquipmentNodeKey = `aircraft:${nextModel}`;
  }
  if (selectedBasicMissionEquipmentType === oldModel) {
    selectedBasicMissionEquipmentType = nextModel;
  }
  updatePreviewResultsThroughApiClient();
  return true;
}

function commitEquipmentAircraftModelInput(input) {
  if (!input) return false;
  const changed = updateEquipmentAircraftModel(
    input.dataset.equipmentAircraftModel,
    input.value
  );
  if (!changed) return false;
  markProjectDraftChanged();
  render();
  return true;
}

function ensureOperationsSupportActivityForAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim();
  if (!model) return null;
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  const existingDirect = operationsSupportPhaseActivity({ aircraftModel: model }, "直接准备方案");
  const planGroupId = existingDirect
    ? ensureOperationsSupportPlanGroupId(existingDirect, model)
    : nextOperationsSupportPlanGroupId(model);
  const activities = operationsSupportPlanTypeConfigs().map((config) => {
    const existing = operationsSupportPhaseActivity({ aircraftModel: model, planGroupId }, config.planType);
    if (existing) return existing;
    const activity = createOperationsSupportActivityForAircraftModel(model, { ...config, planGroupId });
    scenario.supportActivities.push(activity);
    return activity;
  });
  const directIndex = scenario.supportActivities.indexOf(activities[0]);
  selectedOperationsSupportActivityKey = directIndex >= 0 ? `supportActivity:${directIndex}` : selectedOperationsSupportActivityKey;
  selectedOperationsSupportAircraftModel = model;
  return activities[0] || null;
}

function createOperationsSupportActivityForAircraftModel(aircraftModel, config = operationsSupportPlanTypeConfigs()[0]) {
  const model = String(aircraftModel || "").trim() || "未指定机型";
  const planGroupId = config.planGroupId || nextOperationsSupportPlanGroupId(model);
  const existingCount = (scenario.supportActivities || []).filter((activity) => (
    isOperationsSupportActivity(activity) && String(supportActivityAircraftModel(activity) || "") === model
  )).length;
  const suffix = existingCount + 1;
  const activity = {
    id: nextOperationsSupportActivityId(model, config.planType),
    activityType: "使用保障",
    planType: config.planType,
    planGroupId,
    activityName: `${model}${config.activitySuffix || `保障活动${suffix}`}`,
    aircraftModel: model,
    maxWorkTimeRefMinutes: config.maxWorkTimeRefMinutes ?? 30
  };
  return setSupportActivityJobs(activity, [{
      activityCode: "BA-001",
      workName: `${config.label || "新增"}基本保障活动1`,
      predecessors: [],
      durationMinutes: config.maxWorkTimeRefMinutes ?? 30,
      personnel: defaultPersonnelRequirement("机务人员", 1),
      equipment: defaultMaterialRequirement("检测仪", "检测仪", 1),
      spare: []
  }]);
}

function nextOperationsSupportActivityId(aircraftModel, planType = "") {
  const prefix = `ops-support-${String(aircraftModel || "aircraft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(planType || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const usedIds = new Set((scenario.supportActivities || []).map((activity) => String(activity.id || "")));
  let index = usedIds.size + 1;
  while (usedIds.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function nextOperationsSupportPlanGroupId(aircraftModel) {
  const prefix = `ops-plan-${String(aircraftModel || "aircraft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const usedIds = new Set((scenario.supportActivities || []).map((activity) => operationsSupportPlanGroupId(activity)).filter(Boolean));
  let index = usedIds.size + 1;
  while (usedIds.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function removeOperationsSupportActivitiesForAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim();
  if (!model) return;
  scenario.supportActivities = (scenario.supportActivities || []).filter((activity) => {
    if (!isOperationsSupportActivity(activity)) return true;
    return String(supportActivityAircraftModel(activity) || "") !== model;
  });
  selectedOperationsSupportActivityKey = "";
  if (selectedOperationsSupportAircraftModel === model) selectedOperationsSupportAircraftModel = wholeMachineModels()[0] || "";
  selectedSupportActivityJobKeys = new Set();
}

function updateOperationsSupportActivityAircraftModel(oldModel, nextModel) {
  for (const activity of scenario.supportActivities || []) {
    if (!isOperationsSupportActivity(activity)) continue;
    if (String(supportActivityAircraftModel(activity) || "") !== String(oldModel || "")) continue;
    activity.aircraftModel = nextModel;
    if (activity.equipmentType) activity.equipmentType = nextModel;
  }
  if (selectedOperationsSupportAircraftModel === oldModel) selectedOperationsSupportAircraftModel = nextModel;
}

function isOperationsSupportActivity(activity) {
  const planType = String(activity?.planType || "").trim();
  return operationsSupportPlanTypeConfigs().some((config) => config.planType === planType)
    || activity?.activityType === "飞行前保障"
    || activity?.activityType === "使用保障"
    || activity?.activityType === "使用保障活动";
}

function isPreventiveMaintenanceActivity(activity) {
  return activity?.activityType === "预防性维修" || activity?.planType === "预防性维修方案";
}

function preventiveMaintenanceActivityEntries(aircraftModel = "") {
  const targetModel = String(aircraftModel || "").trim();
  return (scenario.supportActivities || [])
    .map((activity, index) => ({ activity, index, key: `supportActivity:${index}` }))
    .filter(({ activity }) => isPreventiveMaintenanceActivity(activity))
    .filter(({ activity }) => !targetModel || supportActivityAircraftModel(activity) === targetModel)
    .map(({ activity, index, key }) => ({
      activity,
      index,
      key,
      value: activity.activityName || activity.name || activity.id || "未命名预防性维修方案",
      label: activity.activityName || activity.name || activity.id || "未命名预防性维修方案",
      aircraftModel: supportActivityAircraftModel(activity)
    }));
}

function selectedPreventiveMaintenanceActivity() {
  return preventiveMaintenanceActivityEntries().find((entry) => entry.key === selectedPreventiveMaintenanceActivityKey)?.activity || null;
}

function selectPreventiveMaintenanceActivityPlan(key) {
  const entry = preventiveMaintenanceActivityEntries().find((item) => item.key === key);
  if (!entry) return;
  selectedPreventiveMaintenanceActivityKey = key;
  selectedPreventiveMaintenanceAircraftModel = supportActivityAircraftModel(entry.activity) || entry.aircraftModel || selectedPreventiveMaintenanceAircraftModel;
  selectedSupportActivityJobKeys = new Set();
}

function selectPreventiveMaintenanceAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim();
  if (!model) return;
  selectedPreventiveMaintenanceAircraftModel = model;
  selectedPreventiveMaintenanceActivityKey = "";
  selectedSupportActivityJobKeys = new Set();
}

function addPreventiveMaintenanceActivityPlan() {
  const entries = preventiveMaintenanceActivityEntries();
  const selected = selectedPreventiveMaintenanceActivity() || entries[0]?.activity || {};
  const model = selectedPreventiveMaintenanceAircraftModel || supportActivityAircraftModel(selected) || wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  const activity = createPreventiveMaintenanceActivityForAircraftModel(model, entries.length + 1);
  scenario.supportActivities.push(activity);
  selectedPreventiveMaintenanceActivityKey = `supportActivity:${scenario.supportActivities.indexOf(activity)}`;
  selectedPreventiveMaintenanceAircraftModel = model;
  selectedSupportActivityJobKeys = new Set();
  updatePreviewResultsThroughApiClient();
}

function deletePreventiveMaintenanceActivityPlan(key = "") {
  const entries = preventiveMaintenanceActivityEntries();
  const targetKey = key || selectedPreventiveMaintenanceActivityKey || "";
  const entry = entries.find((item) => item.key === targetKey);
  if (!entry) return;
  const targetModel = entry.aircraftModel || supportActivityAircraftModel(entry.activity) || selectedPreventiveMaintenanceAircraftModel;
  scenario.supportActivities = (scenario.supportActivities || []).filter((_, index) => index !== entry.index);
  const nextEntries = preventiveMaintenanceActivityEntries();
  const sameAircraftEntries = nextEntries.filter((item) => item.aircraftModel === targetModel);
  const sameAircraftIndex = sameAircraftEntries.findIndex((item) => item.index > entry.index);
  const nextEntry = sameAircraftEntries[sameAircraftIndex >= 0 ? sameAircraftIndex : Math.max(0, sameAircraftEntries.length - 1)] || null;
  selectedPreventiveMaintenanceActivityKey = nextEntry?.key || "";
  selectedPreventiveMaintenanceAircraftModel = nextEntry?.aircraftModel || targetModel || selectedPreventiveMaintenanceAircraftModel;
  selectedSupportActivityJobKeys = new Set();
  updatePreviewResultsThroughApiClient();
}

function createPreventiveMaintenanceActivityForAircraftModel(aircraftModel, sequence = 1) {
  const model = String(aircraftModel || "").trim() || "未指定机型";
  const activity = {
    id: nextPreventiveMaintenanceActivityId(model),
    activityType: "预防性维修",
    planType: "预防性维修方案",
    activityName: `${model}新增预防性维修活动${sequence}`,
    aircraftModel: model,
    durationHours: 2,
    plannedDowntimeHours: 2,
    useCalendarRule: true,
    calendarDayInterval: 1,
    calendarDayFloatRatio: 0.1,
    useFlightHourRule: true,
    runHourInterval: 8,
    runHourFloatRatio: 0.15,
    useTakeoffLandingRule: true,
    takeoffLandingInterval: 6,
    takeoffLandingFloatRatio: 0.1
  };
  return setSupportActivityJobs(activity, [{
      activityCode: "PM-001",
      workName: "新增预防性维修工作项目1",
      predecessors: [],
      durationMinutes: 30,
      personnel: defaultPersonnelRequirement("维修人员", 1),
      equipment: defaultMaterialRequirement("通用工具箱", "通用工具箱", 1),
      spare: []
  }]);
}

function nextPreventiveMaintenanceActivityId(aircraftModel) {
  const prefix = `preventive-${String(aircraftModel || "aircraft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const usedIds = new Set((scenario.supportActivities || []).map((activity) => String(activity.id || "")));
  let index = usedIds.size + 1;
  while (usedIds.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function removePreventiveMaintenanceActivitiesForAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim();
  if (!model) return;
  scenario.supportActivities = (scenario.supportActivities || []).filter((activity) => {
    if (!isPreventiveMaintenanceActivity(activity)) return true;
    return String(supportActivityAircraftModel(activity) || "") !== model;
  });
  selectedPreventiveMaintenanceActivityKey = "";
  if (selectedPreventiveMaintenanceAircraftModel === model) selectedPreventiveMaintenanceAircraftModel = wholeMachineModels()[0] || "";
  selectedSupportActivityJobKeys = new Set();
}

function updatePreventiveMaintenanceActivityAircraftModel(oldModel, nextModel) {
  for (const activity of scenario.supportActivities || []) {
    if (!isPreventiveMaintenanceActivity(activity)) continue;
    if (String(supportActivityAircraftModel(activity) || "") !== String(oldModel || "")) continue;
    activity.aircraftModel = nextModel;
    if (activity.equipmentType) activity.equipmentType = nextModel;
  }
  if (selectedPreventiveMaintenanceAircraftModel === oldModel) selectedPreventiveMaintenanceAircraftModel = nextModel;
}

function equipmentSelectionSummary(selectedState, componentCount) {
  if (selectedState.kind === "aircraft-list") return `${wholeMachineModels().length} 类飞机 / ${componentCount} 行节点`;
  if (selectedState.kind === "aircraft") return `${selectedState.aircraftModel} / 整机与 ${Math.max(componentCount - 1, 0)} 个组件`;
  return `${selectedState.component?.name || "组件"} / ${componentCount} 个组件`;
}

function renderEquipmentSystemTable(selectedState) {
  const rows = equipmentComponentsForSelectionModel({ scenario, selection: selectedState });
  const aircraftRows = selectedState.kind === "aircraft-list"
    ? wholeMachineModels().map((model) => renderEquipmentAircraftTableRow(model, { editable: false }))
    : (selectedState.kind === "aircraft" ? [renderEquipmentAircraftTableRow(selectedState.aircraftModel)] : []);
  return `
    <div class="table-wrap equipment-system-table-wrap">
      <table class="equipment-system-table">
        <thead>
          <tr>
            <th>组件名称</th>
            <th>父节点</th>
            <th>数量n</th>
            <th>组件属性</th>
            <th>可用数量要求k（n中取k） <button type="button" class="inline-help" title="表示当前节点在数量 n 个同类部件中，至少需要 k 个可用，才认为该节点可用。默认取全部，即 k = n。例如 n=1,k=1 单件必须可用；n=2,k=1 二取一冗余；n=3,k=2 三取二。k 必须为整数，且满足 1 ≤ k ≤ n。" aria-label="可用数量要求k说明">?</button></th>
            <th>MTBF-分布类型</th>
            <th>MTBF参数</th>
            <th>MTTR-分布类型</th>
            <th>MTTR参数</th>
          </tr>
        </thead>
        <tbody>
          ${aircraftRows.join("")}
          ${rows.map((component) => renderEquipmentSystemTableRow(component, (scenario.components || []).indexOf(component), selectedState)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderEquipmentAircraftTableRow(aircraftModel, { editable = true } = {}) {
  const aircraftNameCell = editable
    ? `<input aria-label="整机名称" data-equipment-aircraft-model="${htmlEscape(aircraftModel)}" value="${htmlEscape(aircraftModel)}">`
    : readOnlyTableValue(aircraftModel);
  const aircraftQuantityCell = editable
    ? valueInput("equipment.quantity", "number", { min: "1", step: "1", "aria-label": "整机数量" })
    : readOnlyTableValue(scenario.equipment?.quantity ?? "");
  return `
    <tr class="${editable ? "selected-table-row " : ""}equipment-aircraft-row">
      <td>${aircraftNameCell}</td>
      <td><span class="muted">整机级</span></td>
      <td>${aircraftQuantityCell}</td>
      <td><span class="status-badge">整机</span></td>
      <td><span class="muted">-</span></td>
      <td><span class="muted">-</span></td>
      <td><span class="muted">-</span></td>
      <td><span class="muted">-</span></td>
      <td><span class="muted">-</span></td>
    </tr>
  `;
}

function renderEquipmentSystemTableRow(component, index, selectedState) {
  const selected = selectedState.kind === "component" && String(selectedState.component?.id || "") === String(component.id || "");
  const mtbfDistributionType = equipmentDistributionType(component.failureDistribution?.distributionType, "mtbf");
  const mttrDistributionType = equipmentDistributionType(component.repairDistribution?.distributionType, "mttr");
  return `
    <tr class="${selected ? "selected-table-row" : ""}">
      <td>${equipmentTableInput("组件名称", `components.${index}.name`)}</td>
      <td>${equipmentTableInput("父节点", `components.${index}.parentId`)}</td>
      <td>${equipmentTableInput("数量n", `components.${index}.quantity`, "number", { min: "1", step: "1" })}</td>
      <td>${equipmentComponentAttributeSelect(index)}</td>
      <td>${equipmentKOutOfNInput(index)}</td>
      <td>${equipmentDistributionSelect(`components.${index}.failureDistribution.distributionType`, mtbfDistributionType, "MTBF-分布类型")}</td>
      <td>${renderEquipmentDistributionParameters(index, "mtbf", mtbfDistributionType)}</td>
      <td>${equipmentDistributionSelect(`components.${index}.repairDistribution.distributionType`, mttrDistributionType, "MTTR-分布类型")}</td>
      <td>${renderEquipmentDistributionParameters(index, "mttr", mttrDistributionType)}</td>
    </tr>
  `;
}

function equipmentTableInput(label, path, type = "text", attrs = {}) {
  return valueInput(path, type, { ...attrs, "aria-label": label });
}

function equipmentComponentAttributeSelect(index) {
  return equipmentSelect(`components.${index}.productType`, [
    { value: "", label: "空值" },
    { value: "LRU", label: "LRU" },
    { value: "SRU", label: "SRU" }
  ], "组件属性");
}

function equipmentKOutOfNInput(selectedIndex) {
  const component = scenario.components[selectedIndex] || {};
  normalizeEquipmentComponentKOutOfN(component);
  const quantity = equipmentKOutOfNQuantity(component.quantity);
  const value = component.kOutOfN?.k || quantity;
  return `<input aria-label="可用数量要求k（n中取k）" title="至少需要 k 个可用，范围 1~n。" placeholder="默认全部" data-equipment-k-out-of-n-index="${selectedIndex}" type="number" min="1" max="${htmlEscape(quantity)}" step="1" value="${htmlEscape(value)}">`;
}

function equipmentDistributionSelect(path, selectedValue, label) {
  return equipmentSelect(path, equipmentDistributionOptions(), label, selectedValue);
}

function equipmentSelect(path, options, label, selectedOverride = undefined) {
  const selectedValue = String(selectedOverride ?? getPath(scenario, path));
  return `
    <select data-path="${path}" aria-label="${htmlEscape(label)}">
      ${options.map((option) => {
        const value = String(option.value);
        return `<option value="${htmlEscape(value)}" ${value === selectedValue ? "selected" : ""}>${htmlEscape(option.label)}</option>`;
      }).join("")}
    </select>
  `;
}

function equipmentDistributionOptions() {
  return [
    { value: "固定值", label: "固定值" },
    { value: "指数分布", label: "指数分布" },
    { value: "正态分布", label: "正态分布" },
    { value: "均匀分布", label: "均匀分布" }
  ];
}

function equipmentDistributionType(value, metric = "mtbf") {
  const normalized = String(value || "");
  if (equipmentDistributionOptions().some((option) => option.value === normalized)) return normalized;
  return metric === "mtbf" ? "指数分布" : "固定值";
}

function renderEquipmentDistributionParameters(index, metric, distributionType) {
  const basePath = metric === "mtbf" ? `components.${index}.failureDistribution` : `components.${index}.repairDistribution`;
  const fixedLabel = metric === "mtbf" ? "MTBF" : "MTTR（min）";
  const fixedPath = metric === "mtbf" ? `components.${index}.mtbfHours` : `components.${index}.meanRepairTimeMinutes`;
  const fieldsByDistribution = {
    指数分布: [{ key: "rate", label: "速率参数", step: "0.0001" }],
    正态分布: [
      { key: "mean", label: "均值", step: "0.1" },
      { key: "variance", label: "方差", step: "0.1" }
    ],
    均匀分布: [
      { key: "min", label: "最小值", step: "0.1" },
      { key: "max", label: "最大值", step: "0.1" }
    ]
  };
  const fields = fieldsByDistribution[distributionType] || [];
  if (!fields.length) {
    return `
      <div class="equipment-param-fields">
        <label>${fixedLabel}
          <input data-path="${fixedPath}" type="number" min="0" step="0.1" value="${htmlEscape(getPath(scenario, fixedPath))}" aria-label="${htmlEscape(fixedLabel)}">
        </label>
      </div>
    `;
  }
  return `
    <div class="equipment-param-fields">
      ${fields.map((fieldDef) => `
        <label>${fieldDef.label}
          <input data-path="${basePath}.${fieldDef.key}" type="number" min="0" step="${fieldDef.step}" value="${htmlEscape(getPath(scenario, `${basePath}.${fieldDef.key}`))}" aria-label="${htmlEscape(fieldDef.label)}">
        </label>
      `).join("")}
    </div>
  `;
}

function renderReliabilityBlockDiagram() {
  const selectedState = resolveSelectedEquipmentNode();
  const rbdProject = reliabilityDiagramProjectForSelection({
    reliabilityBlockDiagram: scenario.reliabilityBlockDiagram,
    components: scenario.components,
    equipment: scenario.equipment
  }, selectedState);
  const layout = buildReliabilityBlockDiagramLayout(rbdProject);
  const nodes = layout.nodes;
  const tableNodes = Array.isArray(layout.logicalNodes) ? layout.logicalNodes : nodes;
  const diagramEdges = Array.isArray(rbdProject.reliabilityBlockDiagram?.edges) ? rbdProject.reliabilityBlockDiagram.edges : [];
  const detailContent = nodes.length ? `
          <div class="section-head">
            <h3>装备可靠性框图</h3>
            <span>串联/并联/备用/k-out-of-n，门逻辑节点单独展示</span>
          </div>
          ${renderReliabilityBlockDiagramSvg(layout)}
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>节点</th><th>节点类型</th><th>连接关系</th><th>节点可靠度</th><th>失效率</th><th>MTBF</th><th>n中取k / k-out-of-n</th></tr></thead>
              <tbody>${tableNodes.map((node) => `<tr><td>${htmlEscape(node.name)}</td><td>${htmlEscape(reliabilityNodeTypeLabel(node))}</td><td>${htmlEscape(node.connectionLabel)}</td><td>${htmlEscape(node.reliability || "-")}</td><td>${htmlEscape(node.failureRate || "-")}</td><td>${htmlEscape(node.mtbfHours || "-")}h</td><td>${htmlEscape(node.kOutOfNLabel || "-")}</td></tr>`).join("")}</tbody>
            </table>
          </div>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>起点</th><th>终点</th><th>串联/并联/备用/k-out-of-n</th><th>权重</th></tr></thead>
              <tbody>${diagramEdges.map((edge) => `<tr><td>${htmlEscape(edge.from)}</td><td>${htmlEscape(edge.to)}</td><td>${htmlEscape(edge.type)}</td><td>${htmlEscape(edge.weight ?? "-")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">已按装备组成关系生成框图主线</td></tr>`}</tbody>
            </table>
          </div>
  ` : importedDataEmptyState("装备可靠性框图");
  return `
    <div class="organization-layout equipment-layout rbd-layout">
      <aside class="tree-container">
        <div class="tree-toolbar">
          <h4>装备结构树</h4>
        </div>
        ${renderCollapsibleTree(buildRbdEquipmentTreeNodes())}
      </aside>
      <section class="detail-panel">
        <div class="detail-card">
          ${detailContent}
        </div>
      </section>
    </div>
  `;
}

function buildRbdEquipmentTreeNodes() {
  const selectedState = resolveSelectedEquipmentNode();
  return [{
    id: "rbd-equipment-tree:aircraft-list",
    label: "飞机列表",
    meta: `${wholeMachineModels().length} 类飞机`,
    root: true,
    selected: selectedState.kind === "aircraft-list",
    actionAttrs: "data-select-rbd-equipment-root",
    children: wholeMachineModels().map((model) => ({
      id: `rbd-equipment-tree:${model}`,
      label: model,
      meta: "整机级",
      selected: selectedState.kind === "aircraft" && selectedState.aircraftModel === model,
      actionAttrs: `data-select-rbd-equipment-aircraft="${htmlEscape(model)}"`,
      children: buildRbdEquipmentComponentTreeNodes(model, "aircraft-root")
    }))
  }];
}

function buildRbdEquipmentComponentTreeNodes(aircraftModel, parentId) {
  const toTreeNode = ({ component, children }) => ({
    id: `rbd-equipment-component:${aircraftModel}:${component.id || component.name}`,
    label: component.name,
    meta: `${component.quantity} 件`,
    selected: selectedEquipmentNodeKey === `component:${component.id}`,
    actionAttrs: `data-select-rbd-equipment-component="${htmlEscape(component.id)}"`,
    children: children.map(toTreeNode)
  });
  return buildEquipmentComponentTreeModel({ scenario, aircraftModel, parentId }).map(toTreeNode);
}

function reliabilityNodeTypeLabel(node) {
  return String(node?.type || "").toLowerCase().includes("gate") ? "门逻辑" : (node?.type || "component");
}

function renderReliabilityBlockDiagramSvg(layout) {
  return `
    <div class="rbd-canvas">
      <svg class="rbd-diagram" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="装备可靠性框图">
        ${layout.groups.map((group) => `
          <rect class="rbd-group ${htmlEscape(group.relation)}" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="8"></rect>
          <text class="rbd-group-label" x="${group.x + 8}" y="${group.y + 14}">${htmlEscape(group.label)}</text>
        `).join("")}
        ${layout.connectors.map((connector) => `<path class="rbd-connector ${htmlEscape(connector.relation)}" d="${connector.path}"></path>`).join("")}
        <circle class="rbd-terminal" cx="${layout.terminalStart.x}" cy="${layout.terminalStart.y}" r="5"></circle>
        <circle class="rbd-terminal" cx="${layout.terminalEnd.x}" cy="${layout.terminalEnd.y}" r="5"></circle>
        ${layout.nodes.map((node) => `
          <g class="rbd-node ${htmlEscape(node.type)} ${htmlEscape(node.logic)}" transform="translate(${node.x} ${node.y})">
            <title>${htmlEscape(node.name)} / ${htmlEscape(rbdNodeMetaText(node))}</title>
            <rect width="${node.width}" height="${node.height}" rx="8"></rect>
            <text class="rbd-node-title" x="12" y="21">${htmlEscape(truncateRbdText(node.name, 12))}</text>
            <text class="rbd-node-meta" x="12" y="40">${htmlEscape(rbdNodeMetaText(node))}</text>
            <text class="rbd-node-meta" x="12" y="56">失效率 ${htmlEscape(node.failureRate || "-")} / MTBF ${htmlEscape(node.mtbfHours || "-")}h</text>
          </g>
        `).join("")}
      </svg>
    </div>
  `;
}

function rbdNodeMetaText(node) {
  if (node?.isReplica) return `分支 ${node.replicaIndex}/${node.replicaCount}`;
  return `${node.connectionLabel}${node.kOutOfNLabel ? ` / ${node.kOutOfNLabel}` : ""}`;
}

function truncateRbdText(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function renderResourceTable(page) {
  const rows = (scenario.supportNodes || []).flatMap((node) => Object.entries(node.inventory || {}).map(([spareType, quantity]) => ({
    node: node.name,
    spareType,
    quantity,
    personnel: node.personnelCapacity,
    equipment: node.equipmentCapacity
  })));
  if (!rows.length) {
    return importedDataEmptyState(page.name || "保障资源");
  }
  return `
    <div class="section-head section-context">
      <span>组织 / 人员 / 设备 / 备件</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>保障节点</th><th>备件</th><th>库存</th><th>人员容量</th><th>设备容量</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${row.node}</td><td>${row.spareType}</td><td>${row.quantity}</td><td>${row.personnel}</td><td>${row.equipment}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderActivityGantt(page) {
  const activities = scenario.supportActivities || [];
  if (!activities.length) {
    return importedDataEmptyState("保障活动");
  }
  return `
    <div class="section-head section-context">
      <span>保障活动流程</span>
    </div>
    <div class="gantt-chart">
      ${activities.map((activity, index) => `
        <div class="gantt-row">
          <strong>${activity.activityType}</strong>
          <div class="gantt-lane">
            <span style="left:${8 + index * 12}%;width:${Math.min(32, activity.durationHours * 9)}%">${activity.durationHours}h</span>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>活动</th><th>人员</th><th>设备</th><th>备件</th><th>优先级</th></tr></thead>
        <tbody>${activities.map((activity) => `<tr><td>${activity.activityType}</td><td>${activity.requiredPersonnel}</td><td>${activity.requiredDevices}</td><td>${activity.spareType || "-"}</td><td>${activity.priority}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderSupportOrganizationWorkbench(page) {
  const activeTab = page.name.includes("人员") ? "保障人员建模" : page.name.includes("设备") ? "保障设备建模" : page.name.includes("备件") ? "备件建模" : "保障组织结构建模";
  const activeResourceType = page.name.includes("人员") ? "保障人员" : page.name.includes("设备") ? "保障设备" : page.name.includes("备件") ? "备件" : "";
  const locked = currentModelingPageLocked(page);
  const lockedAttr = modelingLockDisabledAttr(locked);
  const orgTree = supportOrganizationTree();
  const selectedSupportOrgNode = findSupportOrgTreeNode(selectedSupportOrgNodeId, orgTree) || orgTree[0];
  const selectedIsLeaf = !(selectedSupportOrgNode?.children || []).length;
  const visibleResourceRows = buildSupportResourceRows(activeResourceType, selectedSupportOrgNode).filter((row) => !supportResourceDeletedKeySet().has(row.key));
  const allResourceRowsSelected = visibleResourceRows.length > 0 && visibleResourceRows.every((row) => selectedSupportResourceKeys.has(row.key));
  const selectedSupportOrgParentName = findSupportOrgParentName(selectedSupportOrgNode?.id, orgTree) || "无";
  const resourceColumns = supportResourceDataColumns(activeResourceType);
  return `
    <div class="ship-front-workbench">
      ${modelingLockNotice(page)}
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>保障组织结构树</h4>
            ${activeTab === "保障组织结构建模" ? `<div class="equipment-toolbar"><button type="button" class="btn-primary" data-support-org-add-node${lockedAttr}>新增节点</button><button type="button" class="btn-danger" data-support-org-delete-node ${selectedSupportOrgNode === orgTree[0] || locked ? "disabled" : ""}>删除</button></div>` : `<span class="muted">只读组织树</span>`}
          </div>
          ${orgTree.map((node) => renderOrgTreeNode(node, 0)).join("")}
        </aside>
        <section class="detail-panel">
          <div class="detail-card">
            <div class="section-head">
              <h3>${activeTab === "保障组织结构建模" ? "组织详情" : "资源清单"}</h3>
              <span>${activeResourceType ? `${activeResourceType}资源清单` : "对齐 ship_front 树 + 表格编辑结构"}</span>
            </div>
            ${activeTab === "保障组织结构建模" ? `
              <div class="form-table-grid">
                <label>组织名称<input data-support-org-node="${htmlEscape(selectedSupportOrgNode?.id || "")}" data-support-org-field="name" value="${htmlEscape(selectedSupportOrgNode?.name || "")}"${lockedAttr}></label>
                <div class="readonly-meta-row" data-support-org-parent-display><span>上级组织</span><strong>${htmlEscape(selectedSupportOrgParentName)}</strong></div>
                <label>关联机场${supportOrgAirportSelect(selectedSupportOrgNode)}</label>
                <label>组织描述<input data-support-org-node="${htmlEscape(selectedSupportOrgNode?.id || "")}" data-support-org-field="description" value="${htmlEscape(selectedSupportOrgNode?.description || "承担机务、维修、备件和设备保障资源调配")}"${lockedAttr}></label>
              </div>
            ` : `
              <div class="toolbar-row">
                <button type="button" class="btn-primary" data-support-resource-add="${htmlEscape(activeResourceType)}" ${selectedIsLeaf && !locked ? "" : "disabled"}>新增</button>
                <label class="rms-file-button">导入表格<input data-support-resource-import-file="${htmlEscape(activeResourceType)}" type="file" accept=".csv,.tsv,.json,application/json,text/csv,text/tab-separated-values"${lockedAttr}></label>
                <button type="button" class="btn-danger" data-support-resource-batch-delete${lockedAttr}>批量删除</button>
                <input value="" placeholder="请输入关键词进行搜索"${lockedAttr}>
                <span class="badge">${locked ? "当前颗粒度只读" : selectedIsLeaf ? "叶子节点可编辑" : "根节点汇总显示"}</span>
              </div>
              <p class="rms-import-status">${htmlEscape(supportResourceImportStatus)}</p>
              <div class="table-wrap">
                <table>
                  <thead><tr><th><input type="checkbox" data-support-resource-select-all="${htmlEscape(activeResourceType)}" ${allResourceRowsSelected ? "checked" : ""}${lockedAttr}></th><th>序号</th><th>组织节点</th>${resourceColumns.map((column) => `<th>${htmlEscape(column.label)}</th>`).join("")}</tr></thead>
                  <tbody>${visibleResourceRows.map((row, index) => `
                    <tr class="${selectedSupportResourceKeys.has(row.key) ? "selected-table-row" : ""}"><td><input type="checkbox" data-support-resource-select="${htmlEscape(row.key)}" ${selectedSupportResourceKeys.has(row.key) ? "checked" : ""}${lockedAttr}></td><td>${index + 1}</td><td>${supportOrganizationSelect(row.key, row.organizationNodeId, true)}</td>${resourceColumns.map((column) => `<td>${supportResourceDataCell(row, column, !selectedIsLeaf || locked)}</td>`).join("")}</tr>
                  `).join("") || `<tr><td colspan="${resourceColumns.length + 3}">暂无资源</td></tr>`}</tbody>
                </table>
              </div>
            `}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderOrgTreeNode(node, depth = 0) {
  return renderCollapsibleTreeNode(orgTreeNode(node, depth));
}

function orgTreeNode(node, depth = 0) {
  return {
    id: `support-org:${node.id || node.name}`,
    label: node.name,
    selected: selectedSupportOrgNodeId === node.id,
    actionAttrs: `data-select-support-org-node="${htmlEscape(node.id || node.name)}"`,
    children: (node.children || []).map((child) => orgTreeNode(child, depth + 1))
  };
}

function buildSupportResourceRows(activeResourceType, selectedOrgNode) {
  const orgTree = supportOrganizationTree();
  const leafNodes = flattenSupportOrgTreeNodes(selectedOrgNode ? [selectedOrgNode] : orgTree).filter((node) => !(node.children || []).length);
  const orgNodes = (selectedOrgNode?.children || []).length ? leafNodes : [selectedOrgNode].filter(Boolean);
  if (activeResourceType === "备件") {
    syncSupportSpareResourcesFromHardwareTree(orgNodes);
  }
  const supportResources = Array.isArray(scenario.supportResources) ? scenario.supportResources : [];
  if (!supportResources.length && Array.isArray(scenario.supportNodes)) {
    return supportResourceRowsFromSupportNodes(scenario.supportNodes, activeResourceType);
  }
  return orgNodes.flatMap((orgNode, orgIndex) => {
    const rows = supportResources
      .filter((resource) => supportResourceBelongsToOrg(resource, orgNode))
      .map((resource, resourceIndex) => supportResourceRow(resource, orgNode, orgIndex, resourceIndex));
    return activeResourceType ? rows.filter((row) => row.type === activeResourceType) : rows;
  });
}

function supportResourceBelongsToOrg(resource, orgNode) {
  if (!resource || !orgNode) return false;
  const nodeName = String(resource.supportNodeName || "").trim();
  return nodeName === String(orgNode.name || "").trim()
    || nodeName === String(orgNode.id || "").trim()
    || String(resource.organizationNodeId || "").trim() === String(orgNode.id || "").trim();
}

function supportResourceRow(resource, orgNode, orgIndex, resourceIndex) {
  const type = supportResourceTypeLabel(resource.type);
  return {
    key: resource.id || `support-resource-${orgIndex}-${resourceIndex}`,
    supportResourceId: resource.id,
    scope: orgNode.name,
    organizationNodeId: orgNode.id,
    type,
    name: resource.name || (type === "保障人员" ? "保障人员" : ""),
    model: type === "保障人员" ? normalizePersonnelSpecialtyName(resource.model) : (resource.model || ""),
    quantity: Number(resource.quantity || 0),
    equipment: resource.equipment || resource.equipmentId || "",
    lockIdentity: true
  };
}

function supportResourceTypeLabel(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "personnel") return "保障人员";
  if (normalized === "equipment") return "保障设备";
  if (normalized === "spare") return "备件";
  return String(type || "");
}

function supportResourceTypeValue(label) {
  if (label === "保障人员") return "personnel";
  if (label === "保障设备") return "equipment";
  if (label === "备件") return "spare";
  return String(label || "");
}

function lruSpareRows() {
  const seen = new Set();
  return (scenario.components || [])
    .filter((component) => component && typeof component === "object" && !Array.isArray(component))
    .filter((component) => component.productType === "LRU" || component.spareType === "LRU"
      || String(component.productType || "").trim().toUpperCase() === "LRU"
      || String(component.spareType || "").trim().toUpperCase() === "LRU")
    .map((component, index) => ({
      name: String(component.name || component.id || `未命名LRU${index + 1}`).trim(),
      model: String(component.model || component.partNo || component.id || component.name || "LRU").trim(),
      aircraft: String(component.aircraftModel || component.equipment || component.equipmentType || "").trim()
    }))
    .filter((spare) => {
      const key = supportSpareResourceIdentityKey("", spare.name, spare.model, spare.aircraft);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function syncSupportSpareResourcesFromHardwareTree(orgNodes) {
  if (!Array.isArray(scenario.supportResources)) scenario.supportResources = [];
  const hardwareSpares = lruSpareRows();
  const targetOrgNodes = (Array.isArray(orgNodes) ? orgNodes : []).filter(Boolean);
  if (!hardwareSpares.length || !targetOrgNodes.length) return;

  const targetOrgNames = new Set(targetOrgNodes.map((node) => String(node.name || node.id || "").trim()).filter(Boolean));
  const targetOrgIds = new Set(targetOrgNodes.map((node) => String(node.id || "").trim()).filter(Boolean));
  const existingSpareByKey = new Map();
  for (const resource of scenario.supportResources) {
    if (!isSpareSupportResource(resource)) continue;
    const key = supportSpareResourceIdentityKey(
      resource.supportNodeName,
      resource.name,
      resource.model,
      resource.equipment || resource.equipmentId
    );
    if (!existingSpareByKey.has(key)) existingSpareByKey.set(key, resource);
  }

  const nextTargetSpares = targetOrgNodes.flatMap((orgNode, orgIndex) => {
    const nodeName = String(orgNode.name || orgNode.id || "保障节点").trim();
    return hardwareSpares.map((spare, spareIndex) => {
      const key = supportSpareResourceIdentityKey(nodeName, spare.name, spare.model, spare.aircraft);
      const existing = existingSpareByKey.get(key);
      return {
        id: String(existing?.id || `support-resource-${orgIndex + 1}-spare-${spareIndex + 1}`),
        supportNodeName: nodeName,
        type: "spare",
        name: spare.name,
        model: spare.model,
        equipment: spare.aircraft || "",
        quantity: Math.max(0, Number(existing?.quantity ?? 0) || 0)
      };
    });
  });

  scenario.supportResources = [
    ...scenario.supportResources.filter((resource) => {
      if (!isSpareSupportResource(resource)) return true;
      const nodeName = String(resource.supportNodeName || "").trim();
      const nodeId = String(resource.organizationNodeId || "").trim();
      return !targetOrgNames.has(nodeName) && !targetOrgIds.has(nodeId);
    }),
    ...nextTargetSpares
  ];
}

function isSpareSupportResource(resource) {
  const type = String(resource?.type || "").trim().toLowerCase();
  return resource && typeof resource === "object" && !Array.isArray(resource)
    && (type === "spare" || type === "备件");
}

function supportSpareResourceIdentityKey(nodeName, name, model, equipment) {
  return [nodeName, name, model, equipment].map((value) => String(value || "").trim()).join("\u0001");
}

function selectedSupportOrgTreeNode() {
  const orgTree = supportOrganizationTree();
  return findSupportOrgTreeNode(selectedSupportOrgNodeId, orgTree) || orgTree[0] || null;
}

function supportOrgAirportSelect(orgNode) {
  const supportNode = supportNodeForOrgNode(orgNode, false);
  const selectedValue = String(supportOrgNodeAirport(supportNode) || supportOrgNodeAirport(orgNode) || "");
  return `
    <select data-support-org-node="${htmlEscape(orgNode?.id || "")}" data-support-org-field="airport"${modelingLockDisabledAttr()}>
      ${selectOptionsWithCurrent(supportOrgAirportOptions(), selectedValue)}
    </select>
  `;
}

function supportOrgNodeAirport(node) {
  if (!node) return "";
  return node.airport
    ?? node.airportName
    ?? node.baseAirport
    ?? node.linkedAirport
    ?? node.airportId
    ?? "";
}

function supportOrgAirportOptions() {
  const authoredAirports = (scenario.combatUnit?.members || [])
    .map((member) => combatUnitMemberAirport(member))
    .filter(Boolean)
    .map((airport) => ({ value: airport, label: airport }));
  return uniqueSelectOptions([
    { value: "", label: "未关联机场" },
    ...authoredAirports
  ]);
}

function supportNodeForOrgNode(orgNode, createIfMissing = false) {
  if (!orgNode) return null;
  if (!Array.isArray(scenario.supportNodes)) scenario.supportNodes = [];
  let node = scenario.supportNodes.find((item) => item.organizationNodeId === orgNode.id || item.id === orgNode.supportNodeId || item.id === orgNode.id || item.name === orgNode.name);
  if (!node && createIfMissing) {
    node = {
      id: `support-node-${Date.now()}`,
      name: orgNode.name || "新增保障节点"
    };
    scenario.supportNodes.push(node);
  }
  return node;
}

function addSupportResource(activeResourceType) {
  const orgNode = selectedSupportOrgTreeNode();
  if (!orgNode || (orgNode.children || []).length) return;
  supportNodeForOrgNode(orgNode, true);
  const resource = createSupportResourceImportNode(orgNode, activeResourceType, supportResourceRowsForOrg(activeResourceType, orgNode).length);
  if (activeResourceType === "保障人员") {
    resource.quantity = 1;
    resource.name = resource.name || `${orgNode.name || "保障节点"}人员`;
    resource.model = defaultSupportPersonnelSpecialtyForOrg(orgNode);
  } else if (activeResourceType === "保障设备") {
    resource.quantity = 1;
    resource.name = "新增保障设备";
    resource.model = "保障设备";
  } else if (activeResourceType === "备件") {
    resource.quantity = 1;
    resource.name = `新增备件${supportResourceRowsForOrg(activeResourceType, orgNode).length + 1}`;
    resource.model = resource.name;
    resource.equipment = "";
  }
  selectedSupportResourceKeys = new Set([resource.id]);
  updatePreviewResultsThroughApiClient();
}

function defaultSupportPersonnelSpecialtyForOrg(orgNode) {
  const specialties = configuredPersonnelSpecialties();
  const used = new Set(
    supportResourceRowsForOrg("保障人员", orgNode)
      .map((row) => normalizePersonnelSpecialtyName(row.model))
      .filter(Boolean)
  );
  return specialties.find((item) => !used.has(normalizePersonnelSpecialtyName(item))) || specialties[0] || "";
}

function supportResourceRowsForOrg(activeResourceType, orgNode) {
  return buildSupportResourceRows(activeResourceType, orgNode);
}

function supportResourceDeletedKeySet() {
  return new Set();
}

function supportResourceInput(row, fieldName, type = "text", disabled = false) {
  return `<input data-support-resource-key="${htmlEscape(row.key)}" data-support-resource-field="${htmlEscape(fieldName)}" type="${type}" value="${htmlEscape(row[fieldName] ?? "")}" ${disabled ? "disabled" : ""}>`;
}

function supportResourceDataColumns(activeResourceType) {
  if (activeResourceType === "保障人员") {
    return [
      { label: "专业", field: "model", type: "select", options: supportPersonnelSpecialtyOptions },
      { label: "数量", field: "quantity", type: "number" }
    ];
  }
  if (activeResourceType === "备件") {
    return [
      { label: "名称", field: "name", type: "text", lockIdentity: true },
      { label: "型号", field: "model", type: "text", lockIdentity: true },
      { label: "所属装备", field: "equipment", type: "select", options: supportEquipmentOwnerOptions },
      { label: "数量", field: "quantity", type: "number" }
    ];
  }
  return [
    { label: "名称", field: "name", type: "text" },
    { label: "型号", field: "model", type: "text" },
    { label: "数量", field: "quantity", type: "number" }
  ];
}

function supportResourceDataCell(row, column, disabled = false) {
  if (column.type === "select") {
    return supportResourceSelect(row, column, disabled);
  }
  return supportResourceInput(
    row,
    column.field,
    column.type || "text",
    disabled || (column.lockIdentity && row.lockIdentity)
  );
}

function supportResourceSelect(row, column, disabled = false) {
  const options = typeof column.options === "function" ? column.options(row[column.field]) : [];
  return `
    <select data-support-resource-key="${htmlEscape(row.key)}" data-support-resource-field="${htmlEscape(column.field)}" ${disabled ? "disabled" : ""}>
      ${selectOptionsWithCurrent(options, String(row[column.field] ?? ""))}
    </select>
  `;
}

function supportPersonnelSpecialtyOptions(currentValue = "") {
  const dictionaryOptions = configuredPersonnelSpecialties().map((value) => ({ value, label: value }));
  return uniqueSelectOptions([
    ...dictionaryOptions,
    ...(currentValue ? [{ value: currentValue, label: currentValue }] : [])
  ]);
}

function supportEquipmentOwnerOptions(currentValue = "") {
  return uniqueSelectOptions([
    { value: "", label: "未指定所属装备" },
    ...wholeMachineModels().map((model) => ({ value: model, label: model })),
    ...(currentValue ? [{ value: currentValue, label: currentValue }] : [])
  ]);
}

function supportOrganizationSelect(key, selectedNodeId, disabled = false) {
  const leafNodes = flattenSupportOrgTreeNodes().filter((node) => !(node.children || []).length);
  const selectableNodes = leafNodes.length ? leafNodes : flattenSupportOrgTreeNodes();
  const selectedNode = findSupportOrgTreeNode(selectedNodeId);
  const options = selectedNode && !selectableNodes.some((node) => node.id === selectedNode.id)
    ? [selectedNode, ...selectableNodes]
    : selectableNodes;
  return `
    <select data-support-resource-key="${htmlEscape(key)}" data-support-resource-field="organizationNodeId" ${disabled ? "disabled" : ""}>
      ${options.map((node) => `<option value="${htmlEscape(node.id || node.name)}" ${(node.id || node.name) === selectedNodeId ? "selected" : ""}>${htmlEscape(node.name)}</option>`).join("")}
    </select>
  `;
}

function updateSupportResourceOverride(key, fieldName, value) {
  if (!key || !fieldName) return;
  if (!Array.isArray(scenario.supportResources)) scenario.supportResources = [];
  const resource = scenario.supportResources.find((item) => item && item.id === key);
  if (!resource) return;
  const nextValue = fieldName === "quantity" ? Math.max(0, Number(value || 0)) : value;
  if (fieldName === "organizationNodeId") {
    const orgNode = findSupportOrgTreeNode(nextValue);
    if (orgNode) resource.supportNodeName = orgNode.name;
  } else if (fieldName === "equipment") {
    resource.equipment = nextValue;
  } else {
    resource[fieldName] = nextValue;
  }
  if (resource.type === "spare" && fieldName === "model") {
    const autofill = supportSpareAutofillByModel(nextValue);
    if (autofill.name) resource.name = autofill.name;
  }
  updatePreviewResultsThroughApiClient();
}

function supportSpareAutofillByModel(model) {
  const normalizedModel = String(model || "").trim();
  if (!normalizedModel) return {};
  const root = supportOrganizationTree()[0] || null;
  const source = buildSupportResourceRows("备件", root)
    .find((row) => String(row.model || "").trim() === normalizedModel);
  return source ? { name: source.name || source.model || "" } : {};
}

function activateSupportResourceEdit(key) {
  if (!key) return;
  selectedSupportResourceKeys = new Set([key]);
}

function toggleAllSupportResourceSelection(activeResourceType, checked) {
  const orgTree = supportOrganizationTree();
  const selectedOrgNode = findSupportOrgTreeNode(selectedSupportOrgNodeId, orgTree) || orgTree[0];
  const keys = buildSupportResourceRows(activeResourceType, selectedOrgNode)
    .filter((row) => !supportResourceDeletedKeySet().has(row.key))
    .map((row) => row.key);
  const next = new Set(selectedSupportResourceKeys);
  for (const key of keys) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  selectedSupportResourceKeys = next;
}

function deleteSelectedSupportResources() {
  if (Array.isArray(scenario.supportResources)) {
    scenario.supportResources = scenario.supportResources.filter((resource) => !selectedSupportResourceKeys.has(resource.id));
  }
  selectedSupportResourceKeys = new Set();
  updatePreviewResultsThroughApiClient();
}

function findSupportOrgTreeNode(id, nodes = supportOrganizationTree()) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findSupportOrgTreeNode(id, node.children || []);
    if (child) return child;
  }
  return null;
}

function flattenSupportOrgTreeNodes(nodes = supportOrganizationTree()) {
  return nodes.flatMap((node) => [
    node,
    ...flattenSupportOrgTreeNodes(node.children || [])
  ]);
}

function findSupportOrgParentName(id, nodes = supportOrganizationTree(), parent = null) {
  for (const node of nodes) {
    if (node.id === id) return parent?.name || "";
    const childParent = findSupportOrgParentName(id, node.children || [], node);
    if (childParent) return childParent;
  }
  return "";
}

function supportOrgNodeDepth(id, nodes = supportOrganizationTree(), depth = 1) {
  for (const node of nodes) {
    if (node.id === id) return depth;
    const childDepth = supportOrgNodeDepth(id, node.children || [], depth + 1);
    if (childDepth) return childDepth;
  }
  return 0;
}

function addSupportOrgNode() {
  const orgTree = supportOrganizationTree();
  const parent = selectedSupportOrgTreeNode() || orgTree[0];
  if (!parent) return;
  if (!Array.isArray(parent.children)) parent.children = [];
  const child = {
    id: `support-org-${Date.now()}`,
    name: `新增保障组织${flattenSupportOrgTreeNodes(orgTree).length + 1}`,
    description: "",
    children: []
  };
  parent.children.push(child);
  selectedSupportOrgNodeId = child.id;
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedSupportOrgNode() {
  const orgTree = supportOrganizationTree();
  const selectedId = selectedSupportOrgNodeId || orgTree[0]?.id;
  if (!selectedId || selectedId === orgTree[0]?.id) return;
  const parent = findSupportOrgParentNode(selectedId, orgTree);
  if (!parent || !Array.isArray(parent.children)) return;
  parent.children = parent.children.filter((child) => child.id !== selectedId);
  selectedSupportOrgNodeId = parent.id;
  updatePreviewResultsThroughApiClient();
}

function findSupportOrgParentNode(id, nodes = supportOrganizationTree(), parent = null) {
  for (const node of nodes) {
    if (node.id === id) return parent;
    const match = findSupportOrgParentNode(id, node.children || [], node);
    if (match) return match;
  }
  return null;
}

function updateSupportOrgField(id, fieldName, value) {
  const node = findSupportOrgTreeNode(id);
  if (!node || !fieldName) return;
  node[fieldName] = value;
  const supportNode = supportNodeForOrgNode(node, fieldName === "airport");
  if (supportNode && fieldName === "name") supportNode.name = value;
  if (supportNode && fieldName === "description") supportNode.organizationStrategy = value;
  if (supportNode && fieldName === "airport") {
    supportNode.airport = value;
    delete supportNode.airportId;
    delete node.airportId;
  }
  updatePreviewResultsThroughApiClient();
}

function findSupportActivityForPage(page) {
  const activities = scenario.supportActivities || [];
  if (page.name.includes("后勤")) return findLogisticsSupportActivity();
  if (page.name.includes("预防性")) {
    return selectedPreventiveMaintenanceActivity()
      || preventiveMaintenanceActivityEntries()[0]?.activity
      || null;
  }
  if (page.name.includes("修复性")) {
    return activities.find((activity) => activity.activityType === "修复性维修") || null;
  }
  if (page.name.includes("使用")) {
    return selectedOperationsSupportActivity()
      || operationsSupportActivityEntries()[0]?.activity
      || null;
  }
  return activities[0] || null;
}

function ensureSupportActivityForPage(page) {
  if (page.name.includes("基本保障活动")) {
    return basicSupportActivityHostActivity()
      || ensureOperationsSupportActivityForAircraftModel(defaultSupportActivityAircraftModel());
  }
  const activity = findSupportActivityForPage(page);
  if (activity) return activity;
  if (page.name.includes("使用")) {
    return ensureOperationsSupportActivityForAircraftModel(defaultSupportActivityAircraftModel());
  }
  if (page.name.includes("预防性")) {
    return ensurePreventiveMaintenanceActivityForAircraftModel(defaultSupportActivityAircraftModel());
  }
  if (page.name.includes("修复性")) {
    return ensureCorrectiveMaintenanceActivityDraft();
  }
  if (page.name.includes("后勤")) {
    return ensureLogisticsSupportActivityDraft();
  }
  return null;
}

function basicSupportActivityHostActivity() {
  const activities = scenario.supportActivities || [];
  return activities.find((activity) => isOperationsSupportActivity(activity))
    || activities.find((activity) => isPreventiveMaintenanceActivity(activity))
    || activities.find((activity) => isCorrectiveMaintenanceActivity(activity))
    || activities.find((activity) => isLogisticsSupportActivity(activity))
    || null;
}

function ensureSupportActivities() {
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  return scenario.supportActivities;
}

function defaultSupportActivityAircraftModel() {
  return selectedOperationsSupportAircraftModel
    || selectedPreventiveMaintenanceAircraftModel
    || wholeMachineModels()[0]
    || scenario.equipment?.model
    || "未指定机型";
}

function ensurePreventiveMaintenanceActivityForAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim() || "未指定机型";
  const existing = preventiveMaintenanceActivityEntries(model)[0]?.activity;
  if (existing) return existing;
  const activities = ensureSupportActivities();
  const activity = createPreventiveMaintenanceActivityForAircraftModel(model, preventiveMaintenanceActivityEntries().length + 1);
  activities.push(activity);
  selectedPreventiveMaintenanceActivityKey = `supportActivity:${activities.indexOf(activity)}`;
  selectedPreventiveMaintenanceAircraftModel = model;
  return activity;
}

function ensureCorrectiveMaintenanceActivityDraft() {
  const componentActivity = ensureCorrectiveMaintenanceActivityForComponent(selectedCorrectiveComponent());
  if (componentActivity) return componentActivity;
  const activities = ensureSupportActivities();
  const existing = activities.find((activity) => isCorrectiveMaintenanceActivity(activity));
  if (existing) return existing;
  const activity = createDefaultCorrectiveMaintenanceActivity();
  activities.push(activity);
  return activity;
}

function isCorrectiveMaintenanceActivity(activity) {
  return activity?.activityType === "修复性维修" || activity?.planType === "修复性维修方案";
}

function createDefaultCorrectiveMaintenanceActivity() {
  const activity = {
    id: nextSupportActivityId("corrective-unassigned"),
    activityType: "修复性维修",
    planType: "修复性维修方案",
    activityName: "默认修复性维修方案",
    equipmentId: "",
    maxRepairTimeMinutes: 60,
    repairType: "原位维修"
  };
  return setSupportActivityJobs(activity, [{
      activityCode: "CM-001",
      workName: "新增修复性维修工作项目1",
      predecessors: [],
      durationMinutes: 60,
      personnel: defaultPersonnelRequirement("维修人员", 1),
      equipment: defaultMaterialRequirement("通用工具箱", "通用工具箱", 1),
      spare: []
  }]);
}

function ensureLogisticsSupportActivityDraft() {
  const existing = findLogisticsSupportActivity();
  if (existing) return existing;
  const activities = ensureSupportActivities();
  const activity = {
    id: nextSupportActivityId("logistics"),
    activityType: "后勤保障",
    planType: "后勤保障方案",
    activityName: "后勤保障活动方案"
  };
  activities.push(activity);
  return activity;
}

function isLogisticsSupportActivity(activity) {
  return activity?.activityType === "后勤保障" || activity?.planType === "后勤保障方案" || activity?.planType === "后勤保障活动方案";
}

function nextSupportActivityId(prefix) {
  const normalizedPrefix = String(prefix || "support-activity").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const usedIds = new Set((scenario.supportActivities || []).map((activity) => String(activity.id || "")));
  let index = usedIds.size + 1;
  while (usedIds.has(`${normalizedPrefix}-${index}`)) index += 1;
  return `${normalizedPrefix}-${index}`;
}

function supportActivityAircraftModel(activity) {
  if (!activity) return "";
  if (activity.aircraftModel) return activity.aircraftModel;
  if (activity.equipmentType) return activity.equipmentType;
  const component = (scenario.components || []).find((item) => String(item.id || "") === String(activity.equipmentId || ""));
  return component?.aircraftModel || scenarioEquipmentModel() || "";
}

function operationsSupportPlanTypeConfigs() {
  return [
    { planType: "直接准备方案", label: "飞行前准备", tabKey: "ops_preflight", activitySuffix: "飞行前准备活动", maxWorkTimeRefMinutes: 30 },
    { planType: "再次出动准备方案", label: "再次出动准备", tabKey: "ops_relaunch", activitySuffix: "再次出动准备活动", maxWorkTimeRefMinutes: 45 },
    { planType: "飞行后检查方案", label: "飞行后检查", tabKey: "ops_postflight", activitySuffix: "飞行后检查活动", maxWorkTimeRefMinutes: 60 }
  ];
}

function operationsSupportPlanTypeTabKey(planType) {
  return operationsSupportPlanTypeConfigs().find((item) => item.planType === planType)?.tabKey || "ops_preflight";
}

function operationsSupportPlanTypeFromTabKey(tabKey) {
  return operationsSupportPlanTypeConfigs().find((item) => item.tabKey === tabKey)?.planType || "";
}

function normalizeOperationsSupportPlanType(planType) {
  const normalized = String(planType || "").trim();
  return operationsSupportPlanTypeConfigs().some((item) => item.planType === normalized) ? normalized : "直接准备方案";
}

function operationsSupportPlanGroupId(activity) {
  return String(activity?.planGroupId || activity?.supportPlanId || "").trim();
}

function ensureOperationsSupportPlanGroupId(activity, aircraftModel = "") {
  if (!activity) return nextOperationsSupportPlanGroupId(aircraftModel);
  const existing = operationsSupportPlanGroupId(activity);
  if (existing) return existing;
  const planGroupId = String(activity.id || activity.activityName || activity.name || "").trim()
    || nextOperationsSupportPlanGroupId(aircraftModel || supportActivityAircraftModel(activity));
  activity.planGroupId = planGroupId;
  return planGroupId;
}

function operationsSupportActivityEntries(aircraftModel = "") {
  const targetModel = String(aircraftModel || "").trim();
  return (scenario.supportActivities || [])
    .map((activity, index) => ({ activity, index, key: `supportActivity:${index}` }))
    .filter(({ activity }) => (
      activity.planType === "直接准备方案"
      || (!activity.planType && (activity.activityType === "飞行前保障" || activity.activityType === "使用保障" || activity.activityType === "使用保障活动"))
    ))
    .filter(({ activity }) => !targetModel || supportActivityAircraftModel(activity) === targetModel)
    .map(({ activity, index, key }) => {
      const activityName = String(activity.activityName || "").trim();
      return {
        activity,
        index,
        key,
        value: activityName,
        label: activityName,
        aircraftModel: supportActivityAircraftModel(activity)
      };
    })
    .filter((entry) => entry.value);
}

function operationsSupportActivityOptions(aircraftModel = "") {
  return operationsSupportActivityEntries(aircraftModel);
}

function selectedOperationsSupportActivity() {
  return operationsSupportActivityEntries().find((entry) => entry.key === selectedOperationsSupportActivityKey)?.activity || null;
}

function operationsSupportPhaseActivity(baseActivity, planType = selectedOperationsSupportPlanType, options = {}) {
  const normalizedPlanType = normalizeOperationsSupportPlanType(planType);
  const model = supportActivityAircraftModel(baseActivity) || wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  const planGroupId = operationsSupportPlanGroupId(baseActivity);
  const matchedByGroup = planGroupId ? (scenario.supportActivities || []).find((activity) => (
    isOperationsSupportActivity(activity)
    && operationsSupportPlanGroupId(activity) === planGroupId
    && String(activity.planType || "直接准备方案") === normalizedPlanType
  )) : null;
  if (matchedByGroup) return matchedByGroup;
  const legacyMatch = (scenario.supportActivities || []).find((activity) => (
    isOperationsSupportActivity(activity)
    && String(supportActivityAircraftModel(activity) || "") === String(model || "")
    && !operationsSupportPlanGroupId(activity)
    && String(activity.planType || "直接准备方案") === normalizedPlanType
  ));
  if (legacyMatch && planGroupId && options.assignLegacyPlanGroup) legacyMatch.planGroupId = planGroupId;
  return legacyMatch || null;
}

function ensureOperationsSupportPhaseActivities(baseActivity) {
  const model = supportActivityAircraftModel(baseActivity) || wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  if (!model) return [];
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  const planGroupId = ensureOperationsSupportPlanGroupId(baseActivity, model);
  return operationsSupportPlanTypeConfigs().map((config) => {
    const existing = operationsSupportPhaseActivity(
      { ...(baseActivity || {}), aircraftModel: model, planGroupId },
      config.planType,
      { assignLegacyPlanGroup: true }
    );
    if (existing) return existing;
    const activity = createOperationsSupportActivityForAircraftModel(model, { ...config, planGroupId });
    scenario.supportActivities.push(activity);
    return activity;
  });
}

function findOperationsSupportPhaseActivities(baseActivity) {
  const model = supportActivityAircraftModel(baseActivity) || wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  if (!model) return [];
  const planGroupId = operationsSupportPlanGroupId(baseActivity);
  return operationsSupportPlanTypeConfigs()
    .map((config) => operationsSupportPhaseActivity({ ...(baseActivity || {}), aircraftModel: model, planGroupId }, config.planType))
    .filter(Boolean);
}

function operationsSupportPlanNameActivity(baseActivity, phaseActivities = []) {
  if (baseActivity && (scenario.supportActivities || []).includes(baseActivity)) return baseActivity;
  return phaseActivities.find((activity) => String(activity.planType || "") === "直接准备方案")
    || phaseActivities[0]
    || baseActivity
    || null;
}

function selectOperationsSupportActivityPlan(key) {
  const entry = operationsSupportActivityEntries().find((item) => item.key === key);
  if (!entry) return;
  selectedOperationsSupportActivityKey = key;
  selectedOperationsSupportAircraftModel = supportActivityAircraftModel(entry.activity) || entry.aircraftModel || selectedOperationsSupportAircraftModel;
  selectedOperationsSupportPlanType = "直接准备方案";
  selectedSupportActivityJobKeys = new Set();
}

function selectOperationsSupportAircraftModel(aircraftModel) {
  const model = String(aircraftModel || "").trim();
  if (!model) return;
  selectedOperationsSupportAircraftModel = model;
  selectedOperationsSupportActivityKey = "";
  selectedOperationsSupportPlanType = "直接准备方案";
  selectedSupportActivityJobKeys = new Set();
}

function addOperationsSupportActivityPlan() {
  const entries = operationsSupportActivityEntries();
  const selected = selectedOperationsSupportActivity() || entries[0]?.activity || {};
  const model = selectedOperationsSupportAircraftModel || supportActivityAircraftModel(selected) || wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  const nextIndex = entries.length + 1;
  const planGroupId = nextOperationsSupportPlanGroupId(model);
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  const created = operationsSupportPlanTypeConfigs().map((config) => {
    const activity = createOperationsSupportActivityForAircraftModel(model, {
      ...config,
      planGroupId,
      activitySuffix: `新增保障活动${nextIndex}-${config.label}`
    });
    scenario.supportActivities.push(activity);
    return activity;
  });
  selectedOperationsSupportActivityKey = `supportActivity:${scenario.supportActivities.indexOf(created[0])}`;
  selectedOperationsSupportAircraftModel = model;
  selectedOperationsSupportPlanType = "直接准备方案";
  selectedSupportActivityJobKeys = new Set();
  updatePreviewResultsThroughApiClient();
}

function deleteOperationsSupportActivityPlan(key = "") {
  const entries = operationsSupportActivityEntries();
  const targetKey = key || selectedOperationsSupportActivityKey || entries[0]?.key || "";
  const entry = entries.find((item) => item.key === targetKey);
  if (!entry) return;
  ensureOperationsSupportPhaseActivities(entry.activity);
  const planGroupId = ensureOperationsSupportPlanGroupId(entry.activity, entry.aircraftModel);
  scenario.supportActivities = (scenario.supportActivities || []).filter((activity, index) => {
    if (index === entry.index) return false;
    if (!isOperationsSupportActivity(activity)) return true;
    return operationsSupportPlanGroupId(activity) !== planGroupId;
  });
  const nextEntries = operationsSupportActivityEntries();
  selectedOperationsSupportActivityKey = nextEntries[Math.min(entry.index, Math.max(0, nextEntries.length - 1))]?.key || "";
  selectedSupportActivityJobKeys = new Set();
  updatePreviewResultsThroughApiClient();
}

function supportActivityJobKey(tabKey, index) {
  return `${tabKey}:${index}`;
}

function findSupportActivityByJobTabKey(tabKey) {
  const operationsPlanType = operationsSupportPlanTypeFromTabKey(tabKey);
  if (operationsPlanType) {
    const baseActivity = selectedOperationsSupportActivity()
      || operationsSupportActivityEntries()[0]?.activity
      || null;
    const phaseActivities = findOperationsSupportPhaseActivities(baseActivity);
    return operationsSupportPhaseActivity(baseActivity, operationsPlanType)
      || phaseActivities.find((activity) => String(activity.planType || "") === operationsPlanType)
      || null;
  }
  if (tabKey === "prev_repair") {
    return selectedPreventiveMaintenanceActivity()
      || preventiveMaintenanceActivityEntries()[0]?.activity
      || scenario.supportActivities?.[0]
      || null;
  }
  if (tabKey === "corr_repair") {
    return selectedCorrectiveMaintenanceActivity()
      || (scenario.supportActivities || []).find((activity) => activity.activityType === "修复性维修")
      || scenario.supportActivities?.[0]
      || null;
  }
  if (tabKey === "logistics") {
    return findLogisticsSupportActivity()
      || scenario.supportActivities?.[0]
      || null;
  }
  return null;
}

function toggleSupportActivityJobSelection(key, checked) {
  const next = new Set(selectedSupportActivityJobKeys);
  if (checked) next.add(key);
  else next.delete(key);
  selectedSupportActivityJobKeys = next;
}

function ensureSupportActivityJobTable() {
  if (!Array.isArray(scenario.supportActivityJobs)) scenario.supportActivityJobs = [];
  return scenario.supportActivityJobs;
}

function supportActivityJobCode(value) {
  return String(value || "").trim();
}

function supportActivityJobDefinitionsByCode() {
  const definitions = new Map();
  for (const job of Array.isArray(scenario.supportActivityJobs) ? scenario.supportActivityJobs : []) {
    if (!job || typeof job !== "object" || Array.isArray(job)) continue;
    const code = supportActivityJobCode(job.activityCode);
    if (!code || definitions.has(code)) continue;
    definitions.set(code, job);
  }
  return definitions;
}

function supportActivityJobDefinition(job) {
  const definition = { ...(job || {}) };
  delete definition.predecessors;
  return definition;
}

function supportActivityJobDefinitionsEqual(left, right) {
  return stableSupportActivityJobStringify(left) === stableSupportActivityJobStringify(right);
}

function stableSupportActivityJobStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableSupportActivityJobStringify(item)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSupportActivityJobStringify(value[key])}`).join(",")}}`;
}

function supportActivityJobCodeForDefinition(requestedCode, definition, tableByCode, currentActivityCodes, nextActivityCodes) {
  const existing = tableByCode.get(requestedCode);
  if (!existing && !nextActivityCodes.includes(requestedCode)) return requestedCode;
  if (!nextActivityCodes.includes(requestedCode) && (currentActivityCodes.has(requestedCode) || supportActivityJobDefinitionsEqual(existing, definition))) {
    return requestedCode;
  }
  return uniqueSupportActivityJobCode(requestedCode, new Set([...tableByCode.keys(), ...nextActivityCodes]));
}

function uniqueSupportActivityJobCode(requestedCode, usedCodes) {
  if (!usedCodes.has(requestedCode)) return requestedCode;
  const match = requestedCode.match(/^(.*?)(?:-(\d+))?$/);
  const prefix = (match?.[1] || requestedCode || "BA").replace(/-$/, "");
  let index = Number(match?.[2] || 2);
  let code = `${prefix}-${String(index).padStart(3, "0")}`;
  while (usedCodes.has(code)) {
    index += 1;
    code = `${prefix}-${String(index).padStart(3, "0")}`;
  }
  return code;
}

function supportActivityJobs(activity) {
  if (!activity || typeof activity !== "object") return [];
  if (!Array.isArray(activity.activityCodes)) return [];
  const definitions = supportActivityJobDefinitionsByCode();
  return activity.activityCodes.map((rawCode, index) => {
    const code = supportActivityJobCode(rawCode);
    const definition = definitions.get(code) || {};
    return {
      ...definition,
      activityCode: code || definition.activityCode || `BA-${String(index + 1).padStart(3, "0")}`,
      predecessors: Array.isArray(activity.predecessors?.[code])
        ? [...activity.predecessors[code]]
        : []
    };
  }).filter((job) => supportActivityJobCode(job.activityCode));
}

function setSupportActivityJobs(activity, jobs) {
  if (!activity || typeof activity !== "object") return;
  const table = ensureSupportActivityJobTable();
  const tableByCode = new Map(table.map((job) => [supportActivityJobCode(job?.activityCode), job]).filter(([code]) => code));
  const currentActivityCodes = new Set(Array.isArray(activity.activityCodes) ? activity.activityCodes.map((code) => supportActivityJobCode(code)).filter(Boolean) : []);
  const activityCodes = [];
  const codeAssignments = [];
  const localCodeMap = new Map();
  const predecessors = {};
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object" || Array.isArray(job)) continue;
    const requestedCode = supportActivityJobCode(job.activityCode);
    if (!requestedCode) continue;
    const definition = supportActivityJobDefinition({ ...job, activityCode: requestedCode });
    const code = supportActivityJobCodeForDefinition(requestedCode, definition, tableByCode, currentActivityCodes, activityCodes);
    definition.activityCode = code;
    activityCodes.push(code);
    codeAssignments.push({ job, requestedCode, code });
    if (!localCodeMap.has(requestedCode)) localCodeMap.set(requestedCode, code);
    if (tableByCode.has(code)) Object.assign(tableByCode.get(code), definition);
    else {
      table.push(definition);
      tableByCode.set(code, definition);
    }
  }
  const activityCodeSet = new Set(activityCodes);
  for (const assignment of codeAssignments) {
    predecessors[assignment.code] = Array.isArray(assignment.job.predecessors)
      ? assignment.job.predecessors
        .map((value) => localCodeMap.get(supportActivityJobCode(value)) || supportActivityJobCode(value))
        .filter((value) => value && activityCodeSet.has(value))
      : [];
  }
  activity.activityCodes = activityCodes;
  activity.predecessors = predecessors;
  delete activity.jobs;
  pruneUnreferencedSupportActivityJobs(activity);
  return activity;
}

function pruneUnreferencedSupportActivityJobs(extraActivity = null) {
  if (!Array.isArray(scenario.supportActivityJobs)) return;
  const referenced = new Set();
  const activities = [
    ...(Array.isArray(scenario.supportActivities) ? scenario.supportActivities : []),
    ...(extraActivity ? [extraActivity] : [])
  ];
  for (const activity of activities) {
    for (const code of Array.isArray(activity?.activityCodes) ? activity.activityCodes : []) {
      const normalized = supportActivityJobCode(code);
      if (normalized) referenced.add(normalized);
    }
  }
  scenario.supportActivityJobs = scenario.supportActivityJobs.filter((job) => referenced.has(supportActivityJobCode(job?.activityCode)));
}

function deleteSupportActivityJobAt(activity, index) {
  const jobs = supportActivityJobs(activity);
  if (!activity || !Number.isInteger(index) || index < 0 || index >= jobs.length) return false;
  jobs.splice(index, 1);
  setSupportActivityJobs(activity, jobs);
  return true;
}

function deleteSupportActivityJobsAtIndexes(activity, indexes) {
  const selectedIndexes = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0));
  if (!activity || selectedIndexes.size === 0) return false;
  const jobs = supportActivityJobs(activity);
  const nextJobs = jobs.filter((_, index) => !selectedIndexes.has(index));
  if (nextJobs.length === jobs.length) return false;
  setSupportActivityJobs(activity, nextJobs);
  return true;
}

function remapSupportActivityJobPredecessors(jobs, oldCode, newCode) {
  const from = supportActivityJobCode(oldCode);
  const to = supportActivityJobCode(newCode);
  if (!from || !to || from === to) return jobs;
  return jobs.map((job) => {
    if (!Array.isArray(job.predecessors)) return job;
    const seen = new Set();
    return {
      ...job,
      predecessors: job.predecessors
        .map((value) => (supportActivityJobCode(value) === from ? to : supportActivityJobCode(value)))
        .filter((value) => {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        })
    };
  });
}

function toggleAllSupportActivityJobSelection(tabKey, checked) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  const keys = supportActivityJobs(activity || {}).map((_, index) => supportActivityJobKey(tabKey, index));
  const next = new Set(selectedSupportActivityJobKeys);
  for (const key of keys) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  selectedSupportActivityJobKeys = next;
}

function deleteSupportActivityJob(key) {
  const [tabKey, rawIndex] = String(key || "").split(":");
  const index = Number(rawIndex);
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!deleteSupportActivityJobAt(activity, index)) return;
  selectedSupportActivityJobKeys.delete(key);
  renumberSupportActivityJobSelections(tabKey);
  updatePreviewResultsThroughApiClient();
}

function deleteSelectedSupportActivityJobs(tabKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity) return;
  const selectedIndexes = Array.from(selectedSupportActivityJobKeys)
    .map((key) => {
      const [keyTab, rawIndex] = String(key).split(":");
      return keyTab === tabKey ? Number(rawIndex) : NaN;
    })
    .filter(Number.isInteger);
  if (!deleteSupportActivityJobsAtIndexes(activity, selectedIndexes)) return;
  if (supportActivityJobDialogKey && selectedIndexes.some((index) => supportActivityJobDialogKey === supportActivityJobKey(tabKey, index))) {
    supportActivityJobDialogKey = "";
  }
  if (supportActivityPredecessorDialogKey && selectedIndexes.some((index) => supportActivityPredecessorDialogKey === supportActivityJobKey(tabKey, index))) {
    supportActivityPredecessorDialogKey = "";
  }
  selectedSupportActivityJobKeys = new Set(Array.from(selectedSupportActivityJobKeys).filter((key) => !String(key).startsWith(`${tabKey}:`)));
  updatePreviewResultsThroughApiClient();
}

function addSupportActivityJob(tabKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity) return "";
  const jobs = supportActivityJobs(activity).slice();
  const nextIndex = jobs.length;
  jobs.push({
    activityCode: `${supportActivityJobCodePrefix(tabKey)}-${String(nextIndex + 1).padStart(3, "0")}`,
    workName: supportActivityJobDefaultName(tabKey, nextIndex),
    predecessors: [],
    durationMinutes: 30,
    personnel: defaultPersonnelRequirement("机务人员", 1),
    equipment: defaultMaterialRequirement("检测仪", "检测仪", 1),
    spare: []
  });
  setSupportActivityJobs(activity, jobs);
  const key = supportActivityJobKey(tabKey, nextIndex);
  selectedSupportActivityJobKeys = new Set([key]);
  updatePreviewResultsThroughApiClient();
  return key;
}

function supportActivityJobCodePrefix(tabKey) {
  if (tabKey === "prev_repair") return "PM";
  if (tabKey === "corr_repair") return "CM";
  if (tabKey === "logistics") return "LG";
  return "BA";
}

function supportActivityJobDefaultName(tabKey, index) {
  if (tabKey === "prev_repair") return `新增预防性维修工作项目${index + 1}`;
  if (tabKey === "corr_repair") return `新增修复性维修工作项目${index + 1}`;
  if (tabKey === "logistics") return `新增后勤保障工作项目${index + 1}`;
  return `新增使用保障工作项目${index + 1}`;
}

function selectSupportActivityJobForEdit(encodedJob) {
  const [tabKey, rawIndex] = String(encodedJob || "").split("-");
  const index = Number(rawIndex);
  if (!tabKey || !Number.isInteger(index)) return "";
  const key = supportActivityJobKey(tabKey, index);
  selectedSupportActivityJobKeys = new Set([key]);
  return key;
}

function selectedSupportActivityJob(tabKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity) return null;
  const selectedKey = Array.from(selectedSupportActivityJobKeys).find((key) => String(key).startsWith(`${tabKey}:`));
  const index = Number(String(selectedKey || "").split(":")[1]);
  const job = supportActivityJobs(activity)[index];
  if (!job || !Number.isInteger(index)) return null;
  return { activity, index, key: supportActivityJobKey(tabKey, index), job };
}

function updateSupportActivityJobField(key, fieldName, value) {
  const [tabKey, rawIndex] = String(key || "").split(":");
  const index = Number(rawIndex);
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity || !Number.isInteger(index) || !fieldName) return;
  const jobs = supportActivityJobs(activity).slice();
  if (!jobs[index]) return;
  const activityIndex = (scenario.supportActivities || []).indexOf(activity);
  const basicActivityKey = activityIndex >= 0 ? `${activityIndex}:${index}` : "";
  const oldCode = jobs[index].activityCode;
  const nextValue = fieldName === "durationMinutes"
    ? Math.max(0, Number(value || 0))
    : fieldName === "activityCode"
      ? uniqueBasicActivityCode(value, basicActivityKey)
      : value;
  jobs[index] = {
    ...jobs[index],
    [fieldName]: nextValue
  };
  setSupportActivityJobs(
    activity,
    fieldName === "activityCode" ? remapSupportActivityJobPredecessors(jobs, oldCode, nextValue) : jobs
  );
  updatePreviewResultsThroughApiClient();
}

function updateSupportActivityJobPredecessors(encodedJob, predecessors) {
  const [tabKey, rawIndex] = String(encodedJob || "").split(":");
  const index = Number(rawIndex);
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity || !Number.isInteger(index)) return;
  const jobs = supportActivityJobs(activity).slice();
  if (!jobs[index]) return;
  jobs[index] = { ...jobs[index], predecessors };
  setSupportActivityJobs(activity, jobs);
  updatePreviewResultsThroughApiClient();
}

function updateSupportActivityJobPredecessorSelection(encodedJob, predecessorValue, checked) {
  const [tabKey, rawIndex] = String(encodedJob || "").split(":");
  const index = Number(rawIndex);
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity || !Number.isInteger(index)) return;
  const jobs = supportActivityJobs(activity).slice();
  if (!jobs[index]) return;
  const next = new Set(Array.isArray(jobs[index].predecessors) ? jobs[index].predecessors : []);
  const value = String(predecessorValue || "").trim();
  if (!value) return;
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  jobs[index] = { ...jobs[index], predecessors: Array.from(next) };
  setSupportActivityJobs(activity, jobs);
  updatePreviewResultsThroughApiClient();
}

function renumberSupportActivityJobSelections(tabKey) {
  selectedSupportActivityJobKeys = new Set(Array.from(selectedSupportActivityJobKeys).filter((key) => !String(key).startsWith(`${tabKey}:`)));
}

function describeDurationProfile(profile, fallbackMinutes) {
  if (!profile || typeof profile !== "object") return `${Number(fallbackMinutes || 0)}min 固定值`;
  if (profile.distributionType === "正态分布") return `正态分布 mean=${profile.mean ?? fallbackMinutes}, std=${profile.stdDev ?? "-"}`;
  if (profile.distributionType === "均匀分布") return `均匀分布 ${profile.min ?? "-"}-${profile.max ?? "-"}min`;
  if (profile.distributionType === "指数分布") return `指数分布 mean=${profile.mean ?? fallbackMinutes}min`;
  return `${profile.distributionType || "固定值"} ${profile.value ?? fallbackMinutes ?? ""}min`.trim();
}

function renderSupportActivityJobRows(activity, tabKey) {
  const jobs = supportActivityJobs(activity);
  const lockedAttr = modelingLockDisabledAttr();
  return jobs.map((job, index) => {
    const key = supportActivityJobKey(tabKey, index);
    return `
      <tr class="${selectedSupportActivityJobKeys.has(key) ? "selected-table-row" : ""}">
        <td><input type="checkbox" data-support-activity-job-select="${htmlEscape(key)}" ${selectedSupportActivityJobKeys.has(key) ? "checked" : ""} aria-label="选择${htmlEscape(job.workName || `工作项目${index + 1}`)}"${lockedAttr}></td>
        <td>${index + 1}</td>
        <td>${supportActivityJobInput(key, job, "activityCode", "text", { "aria-label": "基本保障活动编号" })}</td>
        <td>${supportActivityJobInput(key, job, "workName", "text", { "aria-label": "作业项" })}</td>
        <td>${renderSupportActivityPredecessorCell(jobs, job, index, tabKey)}</td>
        <td>${supportActivityJobInput(key, job, "durationMinutes", "number", { min: "0", step: "1", "aria-label": "工期分钟" })}</td>
        <td class="table-actions"><button type="button" class="inline-action" data-support-activity-job="${htmlEscape(tabKey)}-${index}"${lockedAttr}>编辑</button></td>
      </tr>
    `;
  }).join("");
}

function renderSupportActivityPredecessorCell(jobs, job, index, tabKey) {
  const labels = supportActivityPredecessorLabels(jobs, job, index);
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <div class="predecessor-cell">
      <span>${labels.length ? htmlEscape(labels.join("、")) : "无"}</span>
      <button type="button" class="inline-action" data-support-activity-predecessor-edit="${htmlEscape(tabKey)}-${index}"${lockedAttr}>编辑紧前作业</button>
    </div>
  `;
}

function supportActivityPredecessorLabels(jobs, job, index) {
  const valueToLabel = new Map();
  jobs.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    const value = supportActivityPredecessorValue(candidate, candidateIndex);
    valueToLabel.set(value, candidate.workName || value);
  });
  return (Array.isArray(job.predecessors) ? job.predecessors : [])
    .map((value) => valueToLabel.get(String(value || "").trim()) || String(value || "").trim())
    .filter(Boolean);
}

function supportActivityPredecessorValue(job, index) {
  return String(job.activityCode || job.workName || `BA-${index + 1}`).trim();
}

function renderSupportActivityJobTable(activity, tabKey) {
  const jobs = supportActivityJobs(activity);
  const selectedCount = jobs.filter((_, index) => selectedSupportActivityJobKeys.has(supportActivityJobKey(tabKey, index))).length;
  const allSelected = jobs.length > 0 && selectedCount === jobs.length;
  const dialogJob = supportActivityJobByKey(supportActivityJobDialogKey);
  const predecessorDialogJob = supportActivityJobByKey(supportActivityPredecessorDialogKey);
  const lockedAttr = modelingLockDisabledAttr();
  const body = jobs.length
    ? renderSupportActivityJobRows(activity, tabKey)
    : `<tr><td colspan="7" class="muted">暂无工作项目</td></tr>`;
  return `
    <h4>工作项目清单</h4>
    <div class="toolbar-row"><button type="button" class="btn-primary" data-support-activity-job-add="${htmlEscape(tabKey)}"${lockedAttr}>新增工作项目</button><button type="button" class="rms-file-button rms-import-button" data-support-jobs-download-template>下载模板</button><label class="rms-file-button rms-import-button">上传数据<input type="file" data-support-jobs-import-file="${htmlEscape(tabKey)}" accept=".csv,.json,application/json,text/csv"${lockedAttr}></label><button type="button" class="btn-danger" data-support-activity-job-batch-delete="${htmlEscape(tabKey)}"${lockedAttr}>批量删除</button></div>
    ${renderBasicActivityTemplatePicker(tabKey)}
    <div class="table-wrap">
      <table>
        <thead><tr><th><input type="checkbox" data-support-activity-job-select-all="${htmlEscape(tabKey)}" ${allSelected ? "checked" : ""} aria-label="全选工作项目"${lockedAttr}></th><th>序号</th><th>基本保障活动编号</th><th>作业项</th><th>紧前作业</th><th>工期(min)</th><th>编辑</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${dialogJob?.tabKey === tabKey ? renderSupportActivityJobDialog(dialogJob) : ""}
    ${predecessorDialogJob?.tabKey === tabKey ? renderSupportActivityPredecessorDialog(predecessorDialogJob) : ""}
    ${renderSupportActivityGanttChart(activity, tabKey)}
  `;
}

function renderBasicActivityTemplatePicker(tabKey) {
  if (supportActivityTemplatePickerTabKey !== tabKey) return "";
  const lockedAttr = modelingLockDisabledAttr();
  const query = String(supportActivityTemplateQuery || "").trim().toLowerCase();
  const options = basicActivityLibraryOptions(tabKey).filter((option) => {
    if (!query) return true;
    return [option.label, option.searchText].some((value) => String(value || "").toLowerCase().includes(query));
  });
  return `
    <div class="basic-activity-template-picker">
      <div class="toolbar-row">
        <span class="muted">选择基本保障活动</span>
        <input data-support-activity-template-query value="${htmlEscape(supportActivityTemplateQuery)}" placeholder="搜索编号、名称、类型、资源"${lockedAttr}>
      </div>
      <div class="toolbar-row">
        ${options.length ? options.map((option) => `
          <button type="button" class="inline-action" data-support-activity-job-template="${htmlEscape(tabKey)}" data-basic-activity-key="${htmlEscape(option.value)}"${lockedAttr}>${htmlEscape(option.label)}</button>
        `).join("") : `<span class="muted">基础库暂无可回填活动</span>`}
      </div>
    </div>
  `;
}

function supportActivityJobByKey(key) {
  const [tabKey, rawIndex] = String(key || "").split(":");
  const index = Number(rawIndex);
  if (!tabKey || !Number.isInteger(index)) return null;
  const activity = findSupportActivityByJobTabKey(tabKey);
  const job = supportActivityJobs(activity || {})[index];
  if (!activity || !job) return null;
  return { activity, tabKey, index, key: supportActivityJobKey(tabKey, index), job };
}

function supportActivityJobInput(key, row, fieldName, type = "text", attrs = {}) {
  const attrText = Object.entries(withModelingLockAttrs(attrs))
    .map(([attrName, attrValue]) => ` ${attrName}="${htmlEscape(attrValue)}"`)
    .join("");
  return `<input class="table-edit-input" data-support-activity-job-key="${htmlEscape(key)}" data-support-activity-job-field="${htmlEscape(fieldName)}" type="${type}" value="${htmlEscape(row[fieldName] ?? "")}"${attrText}>`;
}

function supportActivityJobSelect(key, row, fieldName, options, label) {
  const selectedValue = String(row[fieldName] ?? "");
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <select class="table-edit-select" data-support-activity-job-key="${htmlEscape(key)}" data-support-activity-job-field="${htmlEscape(fieldName)}" aria-label="${htmlEscape(label)}"${lockedAttr}>
      ${selectOptionsWithCurrent(options, selectedValue)}
    </select>
  `;
}

function supportPersonnelOptions(currentValue = "") {
  return supportActivityResourceOptions("保障人员", currentValue, (row) => ({
    value: row.model ? `${row.model},${Math.max(1, Number(row.quantity) || 1)}` : "",
    label: `${row.model || "保障人员"} / ${row.scope || "保障组织"}`
  }), "未指定保障人员");
}

function supportEquipmentOptions(currentValue = "") {
  return supportActivityResourceOptions("保障设备", currentValue, (row) => ({
    value: [row.name || row.model || "保障设备", row.model, Math.max(1, Number(row.quantity) || 1)].filter(Boolean).join(","),
    label: `${row.name || row.model || "保障设备"} / ${row.scope || "保障组织"}`
  }), "未指定保障设备");
}

function supportSpareOptions(currentValue = "") {
  const componentSpares = lruSpareRows().map((row) => ({
    value: [row.name, row.model, 1].filter(Boolean).join(","),
    label: `${row.name}${row.model && row.model !== row.name ? ` / ${row.model}` : ""}`
  }));
  const inventorySpares = supportActivityResourceOptions("备件", currentValue, (row) => ({
    value: [row.name || row.model || "备件", row.model, Math.max(1, Number(row.quantity) || 1)].filter(Boolean).join(","),
    label: `${row.name || row.model || "备件"} / ${row.scope || "保障组织"}`
  }), "无备件", { includeEmpty: false });
  return uniqueSelectOptions([
    { value: "", label: "无" },
    ...componentSpares,
    ...inventorySpares
  ]);
}

function supportActivityResourceOptions(resourceType, currentValue, mapRow, emptyLabel, { includeEmpty = true } = {}) {
  const root = supportOrganizationTree()[0] || null;
  const rows = buildSupportResourceRows(resourceType, root)
    .filter((row) => !supportResourceDeletedKeySet().has(row.key));
  const options = rows.map(mapRow).filter((option) => option.value || option.label);
  return uniqueSelectOptions([
    ...(includeEmpty ? [{ value: "", label: emptyLabel }] : []),
    ...options,
    ...(currentValue ? [{ value: currentValue, label: currentValue }] : [])
  ]);
}

function uniqueSelectOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const value = String(option.value ?? "");
    const key = `${value}::${option.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectOptionsWithCurrent(options, currentValue) {
  const normalizedCurrent = String(currentValue ?? "");
  const normalizedOptions = uniqueSelectOptions([
    ...options,
    ...(normalizedCurrent && !options.some((option) => String(option.value ?? "") === normalizedCurrent)
      ? [{ value: normalizedCurrent, label: normalizedCurrent }]
      : [])
  ]);
  return normalizedOptions.map((option) => {
    const value = String(option.value ?? "");
    return `<option value="${htmlEscape(value)}" ${value === normalizedCurrent ? "selected" : ""}>${htmlEscape(option.label ?? value)}</option>`;
  }).join("");
}

function buildSupportActivityGanttRows(activity) {
  const jobs = supportActivityJobs(activity);
  const codeToIndex = new Map();
  jobs.forEach((job, index) => {
    const keys = [
      job.activityCode,
      job.workName,
      `BA-${String(index + 1).padStart(3, "0")}`
    ].map((value) => String(value || "").trim()).filter(Boolean);
    for (const key of keys) {
      if (!codeToIndex.has(key)) codeToIndex.set(key, index);
    }
  });
  const cache = new Map();
  const visiting = new Set();
  const durationAt = (index) => Math.max(0, Number(jobs[index]?.durationMinutes || 0));
  const ganttPredecessorIndexes = (job, index) => (Array.isArray(job.predecessors) ? job.predecessors : [])
    .map((value) => codeToIndex.get(String(value || "").trim()))
    .filter((candidateIndex) => Number.isInteger(candidateIndex) && candidateIndex !== index);
  const startAt = (index) => {
    if (cache.has(index)) return cache.get(index);
    if (visiting.has(index)) return 0;
    visiting.add(index);
    const predecessors = ganttPredecessorIndexes(jobs[index], index);
    const start = predecessors.length
      ? Math.max(...predecessors.map((predecessorIndex) => startAt(predecessorIndex) + durationAt(predecessorIndex)))
      : 0;
    visiting.delete(index);
    cache.set(index, start);
    return start;
  };
  return jobs.map((job, index) => {
    const start = startAt(index);
    const duration = durationAt(index);
    return {
      index,
      code: job.activityCode || `BA-${String(index + 1).padStart(3, "0")}`,
      name: job.workName || job.activityCode || `工作项目${index + 1}`,
      predecessors: ganttPredecessorIndexes(job, index).map((predecessorIndex) => jobs[predecessorIndex]?.activityCode || jobs[predecessorIndex]?.workName || `BA-${predecessorIndex + 1}`),
      start,
      duration,
      end: start + duration
    };
  });
}

function renderSupportActivityGanttChart(activity, tabKey) {
  const rows = buildSupportActivityGanttRows(activity);
  if (!rows.length) {
    return `
      <div class="support-activity-gantt" data-support-activity-gantt="${htmlEscape(tabKey)}">
        <h4>保障活动图</h4>
        <div class="muted">暂无工作项目</div>
      </div>
    `;
  }
  const totalMinutes = Math.max(1, ...rows.map((row) => row.end));
  const axisTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(totalMinutes * ratio));
  return `
    <div class="support-activity-gantt" data-support-activity-gantt="${htmlEscape(tabKey)}">
      <h4>保障活动图</h4>
      <div class="support-gantt-axis">${axisTicks.map((tick) => `<span>${tick}min</span>`).join("")}</div>
      <div class="support-gantt-chart">
        ${rows.map((row) => {
          const left = Math.max(0, Math.min(100, (row.start / totalMinutes) * 100));
          const width = Math.max(3, Math.min(100 - left, (Math.max(1, row.duration) / totalMinutes) * 100));
          const predecessorText = row.predecessors.length ? `紧前：${row.predecessors.join(", ")}` : "无紧前";
          return `
            <div class="support-gantt-row">
              <div class="support-gantt-label">
                <strong>${htmlEscape(row.code)}</strong>
                <span>${htmlEscape(row.name)}</span>
              </div>
              <div class="support-gantt-lane" title="${htmlEscape(`${row.name} / ${predecessorText}`)}">
                <span class="support-gantt-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%">
                  ${htmlEscape(`${row.duration}min`)}
                </span>
              </div>
              <div class="support-gantt-meta">${htmlEscape(predecessorText)}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderSupportActivityJobDialog(selectedJob) {
  const row = selectedJob.job;
  return `
    <div class="activity-job-dialog-backdrop">
      <section class="activity-job-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-job-dialog-title">
        <div class="section-head">
          <div>
            <h3 id="activity-job-dialog-title">工作项目编辑</h3>
            <span>${htmlEscape(row.activityCode || row.workName || "未命名工作项目")}</span>
          </div>
          <button type="button" class="inline-action" data-support-activity-job-dialog-close aria-label="关闭工作项目编辑">关闭</button>
        </div>
        <div class="form-table-grid">
          <label>作业项${supportActivityJobBasicActivitySelect(selectedJob)}</label>
          <label>基本保障活动编号${supportActivityJobInput(selectedJob.key, row, "activityCode", "text")}</label>
          <label>工期(min)${supportActivityJobInput(selectedJob.key, row, "durationMinutes", "number", { min: "0", step: "1" })}</label>
        </div>
        <div class="plan-editor-actions">
          <button type="button" class="btn-primary" data-support-activity-job-dialog-close>完成</button>
        </div>
      </section>
    </div>
  `;
}

function renderSupportActivityPredecessorDialog(selectedJob) {
  const row = selectedJob.job;
  const jobs = supportActivityJobs(selectedJob.activity);
  const selected = new Set(Array.isArray(row.predecessors) ? row.predecessors : []);
  const lockedAttr = modelingLockDisabledAttr();
  const existingOptions = jobs.map((candidate, candidateIndex) => {
    if (candidateIndex === selectedJob.index) return "";
    const value = supportActivityPredecessorValue(candidate, candidateIndex);
    return `
      <label class="check-row">
        <input type="checkbox" data-support-activity-predecessor-key="${htmlEscape(selectedJob.key)}" data-support-activity-predecessor-toggle="${htmlEscape(value)}" ${selected.has(value) ? "checked" : ""}${lockedAttr}>
        <span>
          <strong>${htmlEscape(candidate.workName || value)}</strong>
          <small>${htmlEscape(value)}</small>
        </span>
      </label>
    `;
  }).join("");
  return `
    <div class="activity-job-dialog-backdrop">
      <section class="activity-job-dialog predecessor-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-predecessor-dialog-title">
        <div class="section-head">
          <div>
            <h3 id="activity-predecessor-dialog-title">编辑紧前作业</h3>
            <span>${htmlEscape(row.activityCode || row.workName || "未命名工作项目")}</span>
          </div>
          <button type="button" class="inline-action" data-support-activity-predecessor-dialog-close aria-label="关闭编辑紧前作业">关闭</button>
        </div>
        <div class="predecessor-dialog-grid">
          <section>
            <h4>当前紧前作业清单</h4>
            <div class="predecessor-option-list">
              ${existingOptions || `<span class="muted">暂无可选紧前作业</span>`}
            </div>
          </section>
        </div>
        <div class="plan-editor-actions">
          <button type="button" class="btn-primary" data-support-activity-predecessor-dialog-close>完成</button>
        </div>
      </section>
    </div>
  `;
}

function supportActivityJobBasicActivitySelect(selectedJob) {
  const currentKey = basicActivityLibraryRows().find((row) => (
    row.activityCode === selectedJob.job.activityCode
    && row.workName === selectedJob.job.workName
  ))?.key || "";
  const options = basicActivityLibraryOptions(selectedJob.tabKey);
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <select class="table-edit-select" data-support-activity-job-template-select="${htmlEscape(selectedJob.tabKey)}" aria-label="从基本保障活动建模表搜索作业项"${lockedAttr}>
      <option value="">搜索并选择基本保障活动</option>
      ${selectOptionsWithCurrent(options, currentKey)}
    </select>
  `;
}

function supportActivityJobEditorInput(key, row, fieldName, label, type = "text") {
  const control = fieldName === "personnel"
    ? supportActivityJobSelect(key, row, fieldName, supportPersonnelOptions(row[fieldName]), label)
    : fieldName === "equipment"
      ? supportActivityJobSelect(key, row, fieldName, supportEquipmentOptions(row[fieldName]), label)
      : fieldName === "spare"
        ? supportActivityJobSelect(key, row, fieldName, supportSpareOptions(row[fieldName]), label)
        : supportActivityJobInput(key, row, fieldName, type);
  return `<label>${label}${control}</label>`;
}

function renderBasicActivityLibrary() {
  const rows = filteredBasicActivityLibraryRows();
  const allSelected = rows.length > 0 && rows.every((row) => selectedBasicActivityKeys.has(row.key));
  const dialogRow = basicActivityDialogKey === BASIC_ACTIVITY_DRAFT_KEY
    ? basicActivityDraft
    : basicActivityLibraryRows().find((row) => row.key === basicActivityDialogKey);
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <div class="detail-card activity-editor-card">
      ${modelingLockNotice()}
      <div class="section-head">
        <h3>基本保障活动基础库</h3>
        <span>展示基本保障活动清单，编辑后通过 Project draft 保存</span>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-basic-activity-add${lockedAttr}>新增</button>
        <button type="button" class="btn-danger" data-basic-activity-batch-delete${lockedAttr}>批量删除</button>
        <input data-basic-activity-query value="${htmlEscape(basicActivityQuery)}" placeholder="搜索活动编号、工作名称、适用飞机">
        <select data-basic-activity-import-type-select aria-label="按活动类型筛选基本保障活动">
          ${basicActivityTypeOptions().map((option) => `<option value="${htmlEscape(option.value)}" ${option.value === selectedBasicActivityImportType ? "selected" : ""}>${htmlEscape(option.label)}</option>`).join("")}
        </select>
        <button type="button" class="inline-action" data-basic-activity-import-type="${htmlEscape(selectedBasicActivityImportType)}"${lockedAttr}>按活动类型导入</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" data-basic-activity-select-all ${allSelected ? "checked" : ""}${lockedAttr}></th>
              <th>序号</th><th>类型</th><th>基本保障活动名称</th><th>基本保障活动编号</th><th>适用对象</th><th>工期(min)</th>
              <th>编辑</th>
            </tr>
          </thead>
          <tbody>${rows.map((row, index) => `
            <tr>
              <td><input type="checkbox" data-basic-activity-select="${htmlEscape(row.key)}" ${selectedBasicActivityKeys.has(row.key) ? "checked" : ""} aria-label="选择${htmlEscape(row.workName || `基本保障活动${index + 1}`)}"${lockedAttr}></td>
              <td>${index + 1}</td>
              <td>${htmlEscape(row.type)}</td>
              <td>${htmlEscape(row.workName || "")}</td>
              <td>${htmlEscape(row.activityCode || "")}</td>
              <td>${htmlEscape(row.scope ?? "")}</td>
              <td>${htmlEscape(describeDurationProfile(row.durationProfile, row.durationMinutes))}</td>
              <td class="table-actions"><button type="button" class="inline-action" data-basic-activity-edit="${htmlEscape(row.key)}"${lockedAttr}>编辑</button></td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
      ${dialogRow ? renderBasicActivityEditor(dialogRow, basicActivityDialogKey === BASIC_ACTIVITY_DRAFT_KEY) : ""}
    </div>
  `;
}

function renderBasicActivityEditor(row, isDraft = false) {
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <div class="activity-job-dialog-backdrop">
      <section class="activity-job-dialog basic-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="basic-activity-dialog-title">
        <div class="section-head">
          <div>
            <h3 id="basic-activity-dialog-title">${isDraft ? "新增基本保障活动" : "基本保障活动编辑"}</h3>
            <span>${htmlEscape(row.activityCode || row.workName || "未命名活动")}</span>
          </div>
          <button type="button" class="inline-action" data-basic-activity-dialog-close aria-label="关闭基本保障活动编辑">关闭</button>
        </div>
        <div class="form-table-grid">
          ${basicActivityEditorInput(row, "type", "类型")}
          ${basicActivityEditorInput(row, "workName", "基本保障活动名称")}
          ${basicActivityEditorInput(row, "activityCode", "基本保障活动编号")}
          ${basicActivityEditorInput(row, "scope", "适用对象")}
          ${basicActivityDurationProfileEditor(row)}
        </div>
        ${renderBasicActivityResourceEditor(row)}
        <div class="plan-editor-actions">
          ${isDraft ? `<button type="button" data-basic-activity-dialog-close>取消</button><button type="button" class="btn-primary" data-basic-activity-dialog-save${lockedAttr}>完成</button>` : `<button type="button" class="btn-primary" data-basic-activity-dialog-close>完成</button>`}
        </div>
      </section>
    </div>
  `;
}

function renderBasicActivityEditorInlineLegacy(row) {
  return `
    <div class="detail-card">
      <div class="section-head">
        <h3>基本保障活动编辑</h3>
        <span>${htmlEscape(row.activityCode || row.workName || "未命名活动")}</span>
      </div>
      <div class="form-table-grid">
        ${basicActivityEditorInput(row, "type", "类型")}
        ${basicActivityEditorInput(row, "workName", "基本保障活动名称")}
        ${basicActivityEditorInput(row, "activityCode", "基本保障活动编号")}
        ${basicActivityEditorInput(row, "scope", "适用对象")}
        ${basicActivityDurationProfileEditor(row)}
        ${basicActivityEditorInput(row, "personnel", "保障人员")}
        ${basicActivityEditorInput(row, "equipment", "保障设备")}
        ${basicActivityEditorInput(row, "spare", "备件")}
      </div>
    </div>
  `;
}

function renderBasicActivityResourceEditor(row) {
  const dialogHtml = basicActivityResourceDialog?.key === row.key
    ? renderBasicActivityResourceConfigDialog(row, basicActivityResourceDialog.kind)
    : "";
  return `
    <div class="basic-activity-resource-editor">
      <h4>资源配置</h4>
      <div class="basic-activity-resource-grid">
        ${renderBasicActivityPersonnelEditor(row)}
        ${renderBasicActivityEquipmentEditor(row)}
        ${renderBasicActivitySpareEditor(row)}
      </div>
    </div>
    ${dialogHtml}
  `;
}

function renderBasicActivityPersonnelEditor(row) {
  const requirements = normalizeBasicActivityResourceRequirements(row, "personnel");
  return `
    <section class="basic-activity-resource-section">
      ${renderBasicActivityResourceSectionHead(row, "personnel", "保障人员")}
      ${renderBasicActivityResourceSummaryTable(requirements, "personnel")}
    </section>
  `;
}

function renderBasicActivityEquipmentEditor(row) {
  const requirements = normalizeBasicActivityResourceRequirements(row, "equipment");
  return `
    <section class="basic-activity-resource-section">
      ${renderBasicActivityResourceSectionHead(row, "equipment", "保障设备")}
      ${renderBasicActivityResourceSummaryTable(requirements, "equipment")}
    </section>
  `;
}

function renderBasicActivitySpareEditor(row) {
  const requirements = normalizeBasicActivityResourceRequirements(row, "spare");
  return `
    <section class="basic-activity-resource-section">
      ${renderBasicActivityResourceSectionHead(row, "spare", "备件")}
      ${renderBasicActivityResourceSummaryTable(requirements, "spare")}
    </section>
  `;
}

function renderBasicActivityResourceSectionHead(row, resourceKind, label) {
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <div class="basic-activity-resource-section-head">
      <h5>${htmlEscape(label)}</h5>
      <button type="button" class="inline-action" data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-resource-dialog-open="${htmlEscape(resourceKind)}"${lockedAttr}>新增</button>
    </div>
  `;
}

function renderBasicActivityResourceSummaryTable(requirements, resourceKind) {
  if (!requirements.length) return `<div class="muted">暂无配置，点击新增配置多条${basicActivityResourceKindLabel(resourceKind)}需求</div>`;
  return `
    <div class="basic-activity-resource-summary">
      <table>
        <thead><tr><th>${resourceKind === "personnel" ? "专业" : "名称"}</th><th>数量</th></tr></thead>
        <tbody>${requirements.map((item) => `
          <tr>
            <td>${htmlEscape(basicActivityRequirementDisplayName(item, resourceKind))}</td>
            <td>${htmlEscape(item.quantity ?? 1)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function basicActivityRequirementDisplayName(item, resourceKind) {
  if (resourceKind === "personnel") return item.professional || item.model || item.name || "";
  return [
    item.name || item.model || "",
    item.model && item.model !== item.name ? item.model : ""
  ].filter(Boolean).join(" / ");
}

function renderBasicActivityResourceConfigDialog(row, resourceKind) {
  const kind = ["personnel", "equipment", "spare"].includes(resourceKind) ? resourceKind : "personnel";
  const label = basicActivityResourceKindLabel(kind);
  const requirements = normalizeBasicActivityResourceRequirements(row, kind);
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <div class="activity-job-dialog-backdrop nested-dialog-backdrop">
      <section class="activity-job-dialog basic-activity-resource-dialog" role="dialog" aria-modal="true" aria-labelledby="basic-activity-resource-dialog-title">
        <div class="section-head">
          <div>
            <h3 id="basic-activity-resource-dialog-title">${htmlEscape(label)}需求配置</h3>
            <span>${htmlEscape(row.activityCode || row.workName || "未命名活动")}</span>
          </div>
          <button type="button" class="inline-action" data-basic-activity-resource-dialog-close aria-label="关闭${htmlEscape(label)}需求配置">关闭</button>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn-primary" data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-resource-dialog-add="${htmlEscape(kind)}"${lockedAttr}>新增</button>
          <span class="muted">可一次配置多条${htmlEscape(label)}参数</span>
        </div>
        <div class="table-wrap">
          <table class="basic-activity-resource-config-table">
            <thead>${renderBasicActivityResourceDialogHeader(kind)}</thead>
            <tbody>
              ${requirements.map((item, index) => renderBasicActivityResourceDialogRow(row, kind, item, index)).join("") || `<tr><td colspan="3">暂无配置</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="plan-editor-actions">
          <button type="button" class="btn-primary" data-basic-activity-resource-dialog-close>完成</button>
        </div>
      </section>
    </div>
  `;
}

function renderBasicActivityResourceDialogHeader(resourceKind) {
  return `<tr><th>${htmlEscape(basicActivityResourceKindLabel(resourceKind))}</th><th>数量</th><th>删除</th></tr>`;
}

function renderBasicActivityResourceDialogRow(row, resourceKind, item, index) {
  const commonAttrs = `data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-resource-kind="${htmlEscape(resourceKind)}" data-basic-activity-resource-index="${htmlEscape(index)}"`;
  const lockedAttr = modelingLockDisabledAttr();
  const quantityCell = `<td><input type="number" min="1" step="1" ${commonAttrs} data-basic-activity-resource-dialog-field="quantity" value="${htmlEscape(item.quantity ?? 1)}"${lockedAttr}></td>`;
  const deleteCell = `<td><button type="button" class="inline-action" ${commonAttrs} data-basic-activity-resource-dialog-delete${lockedAttr}>删除</button></td>`;
  return `
    <tr>
      <td>${basicActivityResourceDialogResourceSelect(row, resourceKind, index, item)}</td>
      ${quantityCell}
      ${deleteCell}
    </tr>
  `;
}

function basicActivityResourceDialogResourceSelect(row, resourceKind, index, item) {
  const label = basicActivityResourceKindLabel(resourceKind);
  const rows = basicActivityCatalogRows(resourceKind);
  return basicActivityResourceDialogSelect(
    row,
    resourceKind,
    index,
    "resourceKey",
    basicActivitySupportResourceSelectOptions(label, rows),
    basicActivitySelectedSupportResourceKey(resourceKind, item, rows),
    label
  );
}

function basicActivityResourceDialogSelect(row, resourceKind, index, fieldName, options, selectedValue, label) {
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <select ${basicActivityResourceDialogFieldAttrs(row, resourceKind, index, fieldName)} aria-label="${htmlEscape(label)}"${lockedAttr}>
      ${selectOptionsWithCurrent(options, selectedValue)}
    </select>
  `;
}

function basicActivitySupportResourceSelectOptions(label, rows) {
  return uniqueSelectOptions([
    { value: "", label: rows.length ? `请选择${label}` : `暂无${label}目录` },
    ...rows.map((row) => ({
      value: String(row.key || ""),
      label: basicActivitySupportResourceOptionLabel(row, label)
    }))
  ]);
}

function basicActivitySupportResourceOptionLabel(row, fallbackLabel) {
  if (row.resourceKind === "personnel" || fallbackLabel === "保障人员") return row.name || row.model || fallbackLabel;
  return [
    row.name || row.model || fallbackLabel,
    row.model && row.model !== row.name ? row.model : ""
  ].filter(Boolean).join(" / ");
}

function basicActivitySelectedSupportResourceKey(resourceKind, item, rows) {
  if (!item) return "";
  const explicitKey = String(item.key || item.resourceKey || "").trim();
  if (explicitKey && rows.some((row) => String(row.key || "") === explicitKey)) return explicitKey;
  if (resourceKind === "personnel") {
    const professional = normalizePersonnelSpecialtyName(item.professional || item.model || item.name);
    if (!professional) return "";
    return rows.find((row) => (
      normalizePersonnelSpecialtyName(row.model) === professional
      || normalizePersonnelSpecialtyName(row.name) === professional
    ))?.key || "";
  }
  const name = String(item.name || "").trim();
  const model = String(item.model || "").trim();
  const exactMatch = rows.find((row) => (
    name && model
    && String(row.name || "").trim() === name
    && String(row.model || "").trim() === model
  ));
  if (exactMatch) return exactMatch.key;
  return rows.find((row) => (
    (name && String(row.name || "").trim() === name)
    || (model && String(row.model || "").trim() === model)
  ))?.key || "";
}

function basicActivityResourceDialogFieldAttrs(row, resourceKind, index, fieldName) {
  return `data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-resource-kind="${htmlEscape(resourceKind)}" data-basic-activity-resource-index="${htmlEscape(index)}" data-basic-activity-resource-dialog-field="${htmlEscape(fieldName)}"`;
}

function basicActivityResourceKindLabel(resourceKind) {
  return resourceKind === "personnel" ? "保障人员" : resourceKind === "equipment" ? "保障设备" : "备件";
}

function normalizePersonnelSpecialtyName(value) {
  const text = String(value || "").split(/[\/／]/).pop().trim();
  return text && !["人员容量", "新增保障人员"].includes(text) ? text : "";
}

function basicActivityCatalogRows(resourceKind) {
  if (resourceKind === "personnel") return basicActivityPersonnelCatalogRows();
  if (resourceKind === "equipment") return basicActivityEquipmentCatalogRows();
  if (resourceKind === "spare") return basicActivitySpareCatalogRows();
  return [];
}

function basicActivityPersonnelCatalogRows() {
  const professionals = [
    ...(scenario.supportResources || [])
      .filter((resource) => resource?.type === "personnel" || resource?.type === "保障人员")
      .map((resource) => normalizePersonnelSpecialtyName(resource.model || resource.name || "")),
    ...configuredPersonnelSpecialties()
  ].filter(Boolean);
  const rows = professionals.map((professional) => ({
    key: `personnel:${professional}`,
    resourceKind: "personnel",
    type: "保障人员",
    name: professional,
    model: professional
  }));
  return uniqueBasicActivitySupportResourceRows([
    ...rows,
    ...basicActivityLegacyResourceRows("保障人员").map((row) => ({
      ...row,
      key: `personnel:${row.model || row.name}`,
      resourceKind: "personnel",
      scope: ""
    }))
  ]);
}

function basicActivityEquipmentCatalogRows() {
  return basicActivityMaterialCatalogRows("equipment", "保障设备");
}

function basicActivitySpareCatalogRows() {
  return basicActivityMaterialCatalogRows("spare", "备件");
}

function basicActivityMaterialCatalogRows(resourceKind, resourceType) {
  const deletedKeys = supportResourceDeletedKeySet();
  const catalogRows = (scenario.supportResources || [])
    .filter((resource) => resource?.type === resourceKind || resource?.type === resourceType)
    .map((resource, index) => ({
      key: String(resource.id || resource.key || `${resourceKind}:${index}:${resource.name || resource.model || ""}`),
      resourceKind,
      type: resourceType,
      name: resource.name || resource.model || "",
      model: resource.model || resource.name || "",
      quantity: Math.max(1, Number(resource.quantity) || 1)
    }))
    .filter((row) => row.name || row.model)
    .filter((row) => !deletedKeys.has(row.key));
  return uniqueBasicActivitySupportResourceRows([
    ...catalogRows,
    ...basicActivityLegacyResourceRows(resourceType).map((row) => ({
      ...row,
      resourceKind,
      scope: ""
    }))
  ]);
}

function uniqueBasicActivitySupportResourceRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [
      row.type || "",
      row.name || "",
      row.model || ""
    ].map((value) => String(value || "").trim()).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function basicActivityLegacyResourceRows(resourceType) {
  const resourceKind = resourceType === "保障人员" ? "personnel" : resourceType === "保障设备" ? "equipment" : resourceType === "备件" ? "spare" : "";
  if (!resourceKind) return [];
  return (scenario.supportActivities || []).flatMap((activity, activityIndex) =>
    supportActivityJobs(activity).flatMap((job, jobIndex) =>
      normalizeBasicActivityResourceRequirements(job, resourceKind)
        .filter((item) => basicActivityLegacyResourceItemIsUsable(resourceKind, item))
        .map((item, itemIndex) => ({
          key: `activity:${activityIndex}:${jobIndex}:${resourceKind}:${itemIndex}`,
          type: resourceType,
          scope: basicActivityScopeLabel(activity),
          name: resourceKind === "personnel" ? (item.professional || item.model || "") : (item.name || item.model || ""),
          model: resourceKind === "personnel" ? (item.professional || item.model || "") : (item.model || item.name || ""),
          quantity: Math.max(1, Number(item.quantity) || 1)
        }))
    )
  );
}

function basicActivityLegacyResourceItemIsUsable(resourceKind, item) {
  const model = String(resourceKind === "personnel" ? (item.professional || item.model || "") : (item.model || item.name || "")).trim();
  if (!model || model === "无") return false;
  return true;
}

function normalizeBasicActivityResourceRequirements(row, resourceKind) {
  const structured = row[resourceKind];
  if (Array.isArray(structured) && structured.length) {
    return structured.map((item, index) => normalizeBasicActivityResourceDialogRequirement(resourceKind, item, index));
  }
  const source = row[`${resourceKind}Requirements`];
  if (Array.isArray(source) && source.length) return source.map((item) => ({ ...item }));
  const legacy = String(row[resourceKind] || "").trim();
  if (!legacy) return [];
  const parts = legacy.split(/[;；]/).map((part) => part.trim()).filter(Boolean);
  return parts.map((part, index) => {
    const [name, modelOrQuantity, maybeQuantity] = part.split(",").map((value) => value.trim());
    return {
      key: `${resourceKind}:legacy:${index}:${name}`,
      name,
      model: resourceKind === "personnel" ? name : modelOrQuantity,
      professional: resourceKind === "personnel" ? name : "",
      quantity: Math.max(1, Number(maybeQuantity ?? modelOrQuantity ?? 1) || 1)
    };
  });
}

function defaultPersonnelRequirement(professional, quantity = 1) {
  return [normalizeBasicActivityResourceDialogRequirement("personnel", {
    professional,
    quantity
  }, 0)];
}

function defaultMaterialRequirement(model, name = model, quantity = 1) {
  return [normalizeBasicActivityResourceDialogRequirement("equipment", {
    model,
    name,
    quantity
  }, 0)];
}

function basicActivityDurationProfileEditor(row) {
  const profile = normalizeSupportActivityDurationProfile(row.durationProfile, row.durationMinutes);
  const fields = [`<label>作业时长分布${basicActivitySelect(row, "durationProfile.distributionType", allowedSupportActivityDurationDistributions().map((value) => ({ value, label: value })), "作业时长分布")}</label>`];
  if (profile.distributionType === "正态分布") {
    fields.push(basicActivityEditorInput(row, "durationProfile.mean", "均值(min)", "number"));
    fields.push(basicActivityEditorInput(row, "durationProfile.stdDev", "标准差(min)", "number"));
  } else if (profile.distributionType === "均匀分布") {
    fields.push(basicActivityEditorInput(row, "durationProfile.min", "最小值(min)", "number"));
    fields.push(basicActivityEditorInput(row, "durationProfile.max", "最大值(min)", "number"));
  } else if (profile.distributionType === "指数分布") {
    fields.push(basicActivityEditorInput(row, "durationProfile.mean", "均值(min)", "number"));
  } else {
    fields.push(basicActivityEditorInput(row, "durationProfile.value", "固定工期(min)", "number"));
  }
  return fields.join("");
}

function basicActivityEditorInput(row, fieldName, label, type = "text") {
  const control = fieldName === "type"
    ? basicActivityTypeSelect(row)
    : fieldName === "scope"
    ? basicActivityScopeSelect(row)
    : fieldName === "personnel"
      ? basicActivitySelect(row, fieldName, supportPersonnelOptions(row[fieldName]), label)
      : fieldName === "equipment"
        ? basicActivitySelect(row, fieldName, supportEquipmentOptions(row[fieldName]), label)
        : fieldName === "spare"
          ? basicActivitySelect(row, fieldName, supportSpareOptions(row[fieldName]), label)
          : basicActivityInput(row, fieldName, type);
  return `<label>${label}${control}</label>`;
}

function basicActivityInput(row, fieldName, type = "text", attrs = {}) {
  const attrText = Object.entries(withModelingLockAttrs(attrs))
    .map(([attrName, attrValue]) => ` ${attrName}="${htmlEscape(attrValue)}"`)
    .join("");
  return `<input class="table-edit-input" data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-field="${htmlEscape(fieldName)}" type="${type}" value="${htmlEscape(basicActivityFieldValue(row, fieldName) ?? "")}"${attrText}>`;
}

function basicActivitySelect(row, fieldName, options, label) {
  const selectedValue = String(basicActivityFieldValue(row, fieldName) ?? "");
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <select class="table-edit-select" data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-field="${htmlEscape(fieldName)}" aria-label="${htmlEscape(label)}"${lockedAttr}>
      ${selectOptionsWithCurrent(options, selectedValue)}
    </select>
  `;
}

function basicActivityFieldValue(row, fieldName) {
  if (!String(fieldName || "").includes(".")) return row[fieldName];
  return String(fieldName).split(".").reduce((value, key) => value?.[key], row);
}

function basicActivityTypeSelect(row) {
  return basicActivitySelect(row, "type", basicActivityTypeOptions(), "类型");
}

function basicActivityTypeOptions() {
  return [
    { value: "使用保障活动", label: "使用保障活动" },
    { value: "预防性维修", label: "预防性维修" },
    { value: "修复性维修", label: "修复性维修" }
  ];
}

function basicActivityScopeSelect(row) {
  const selectedValue = basicActivityScopeValue(row);
  const lockedAttr = modelingLockDisabledAttr();
  return `
    <select class="table-edit-select" data-basic-activity-key="${htmlEscape(row.key)}" data-basic-activity-field="scope" aria-label="适用对象"${lockedAttr}>
      ${selectOptionsWithCurrent(basicActivityScopeOptions(row), selectedValue)}
    </select>
  `;
}

function basicActivityScopeValue(row) {
  if (row.scopeValue) return row.scopeValue;
  const model = basicActivityApplicableAircraft(row);
  return model ? `aircraft:${model}` : "";
}

function basicActivityScopeOptions(row) {
  return uniqueSelectOptions([
    { value: "", label: "未指定适用对象" },
    ...basicActivityWholeMachineScopeOptions()
  ]);
}

function basicActivityWholeMachineScopeOptions() {
  return wholeMachineModels().map((model) => ({ value: `aircraft:${model}`, label: model }));
}

function basicActivityApplicableAircraft(row) {
  return String(row?.applicableAircraft || "").trim();
}

function basicActivityLibraryRows() {
  return (scenario.supportActivities || []).flatMap((activity, activityIndex) =>
    supportActivityJobs(activity).map((job, jobIndex) => ({
      key: `${activityIndex}:${jobIndex}`,
      activity,
      activityIndex,
      jobIndex,
      type: basicActivityTypeValue(activity),
      activityCode: job.activityCode,
      workName: job.workName,
      scope: basicActivityApplicableAircraft(job) || "未指定",
      applicableAircraft: basicActivityApplicableAircraft(job),
      durationProfile: normalizeSupportActivityDurationProfile(job.durationProfile || job.durationDistribution, job.durationMinutes),
      durationMinutes: job.durationMinutes,
      personnelProfessional: job.personnelProfessional || "",
      equipmentModel: job.equipmentModel || "",
      personnel: normalizeBasicActivityResourceRequirements(job, "personnel"),
      equipment: normalizeBasicActivityResourceRequirements(job, "equipment"),
      spare: normalizeBasicActivityResourceRequirements(job, "spare"),
      predecessors: Array.isArray(job.predecessors) ? [...job.predecessors] : []
    }))
  );
}

function filteredBasicActivityLibraryRows() {
  const typeFilter = basicActivityTypeOptions().some((option) => option.value === selectedBasicActivityImportType)
    ? selectedBasicActivityImportType
    : "";
  const query = String(basicActivityQuery || "").trim().toLowerCase();
  return basicActivityLibraryRows().filter((row) => {
    if (typeFilter && row.type !== typeFilter) return false;
    if (!query) return true;
    return [
      row.type,
      row.activityCode,
      row.workName,
      row.scope,
      row.applicableAircraft
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function basicActivityLibraryOptions(tabKey = "") {
  const expectedType = basicActivityTypeForJobTab(tabKey);
  return basicActivityLibraryRows().filter((row) => !expectedType || row.type === expectedType).map((row) => ({
    value: row.key,
    label: [row.activityCode, row.workName, row.type].filter(Boolean).join(" / "),
    searchText: [
      row.type,
      row.activityCode,
      row.workName,
      row.scope,
      row.applicableAircraft
    ].filter(Boolean).join(" ")
  }));
}

function basicActivityTypeForJobTab(tabKey = "") {
  const key = String(tabKey || "");
  if (key.startsWith("prev_repair")) return "预防性维修";
  if (key.startsWith("corr_repair")) return "修复性维修";
  if (key.startsWith("ops_")) return "使用保障活动";
  return "";
}

function basicActivityTypeValue(activity) {
  if (isLogisticsSupportActivity(activity)) return "后勤保障";
  if (isCorrectiveMaintenanceActivity(activity)) return "修复性维修";
  if (isPreventiveMaintenanceActivity(activity)) return "预防性维修";
  return "使用保障活动";
}

function basicActivityScopeLabel(activity) {
  if (isLogisticsSupportActivity(activity)) return "后勤保障";
  if (activity?.equipmentId) {
    const component = (scenario.components || []).find((item) => String(item.id || "") === String(activity.equipmentId || ""));
    return component?.name || activity.equipmentId;
  }
  return supportActivityAircraftModel(activity) || scenarioEquipmentModel() || "未指定";
}

function addBasicActivityLibraryJob() {
  const activity = ensureSupportActivityForPage({ name: "基本保障活动建模" });
  if (!activity) return;
  const jobs = supportActivityJobs(activity).slice();
  const index = jobs.length;
  jobs.push({
    activityCode: nextBasicActivityCode("BA"),
    workName: `新增保障活动${index + 1}`,
    predecessors: [],
    durationProfile: { distributionType: "固定值", value: 30 },
    durationMinutes: 30,
    personnel: defaultPersonnelRequirement("机务", 1),
    equipment: defaultMaterialRequirement("检测仪", "检测仪", 1),
    spare: []
  });
  setSupportActivityJobs(activity, jobs);
  const activityIndex = (scenario.supportActivities || []).indexOf(activity);
  selectedBasicActivityKeys = activityIndex >= 0 ? new Set([`${activityIndex}:${index}`]) : selectedBasicActivityKeys;
}

function openBasicActivityDraftDialog() {
  basicActivityDraft = createBasicActivityDraft();
  basicActivityDialogKey = BASIC_ACTIVITY_DRAFT_KEY;
  basicActivityResourceDialog = null;
}

function createBasicActivityDraft() {
  const type = basicActivityTypeOptions().some((option) => option.value === selectedBasicActivityImportType)
    ? selectedBasicActivityImportType
    : "使用保障活动";
  return {
    key: BASIC_ACTIVITY_DRAFT_KEY,
    type,
    activityCode: nextBasicActivityCode(type === "预防性维修" ? "PM" : type === "修复性维修" ? "CM" : "BA"),
    workName: "",
    scope: defaultSupportActivityAircraftModel(),
    applicableAircraft: defaultSupportActivityAircraftModel(),
    durationProfile: { distributionType: "固定值", value: 30 },
    durationMinutes: 30,
    personnel: [],
    equipment: [],
    spare: [],
    predecessors: []
  };
}

function saveBasicActivityDraft() {
  if (!basicActivityDraft) return;
  const activity = ensureBasicActivityDraftHostActivity(basicActivityDraft.type);
  if (!activity) return;
  const jobs = supportActivityJobs(activity).slice();
  const job = supportActivityJobFromBasicActivityDraft(basicActivityDraft);
  jobs.push(job);
  setSupportActivityJobs(activity, jobs);
  const activityIndex = (scenario.supportActivities || []).indexOf(activity);
  const key = activityIndex >= 0 ? `${activityIndex}:${jobs.length - 1}` : "";
  selectedBasicActivityKeys = key ? new Set([key]) : selectedBasicActivityKeys;
  basicActivityDialogKey = "";
  basicActivityDraft = null;
  basicActivityResourceDialog = null;
  updatePreviewResultsThroughApiClient();
}

function supportActivityJobFromBasicActivityDraft(row) {
  const profile = normalizeSupportActivityDurationProfile(row.durationProfile, row.durationMinutes);
  const job = {
    activityCode: uniqueBasicActivityCode(row.activityCode || nextBasicActivityCode("BA")),
    workName: row.workName || "未命名基本保障活动",
    applicableAircraft: basicActivityApplicableAircraft(row),
    predecessors: Array.isArray(row.predecessors) ? [...row.predecessors] : [],
    durationProfile: profile,
    durationMinutes: durationMinutesForSupportActivityProfile(profile, row.durationMinutes),
    personnel: normalizeBasicActivityResourceRequirements(row, "personnel"),
    equipment: normalizeBasicActivityResourceRequirements(row, "equipment"),
    spare: normalizeBasicActivityResourceRequirements(row, "spare")
  };
  syncBasicActivityResourceSummaries(job);
  return job;
}

function ensureBasicActivityDraftHostActivity(type) {
  const activityType = basicActivityTypeOptions().some((option) => option.value === type) ? type : "使用保障活动";
  const activities = ensureSupportActivities();
  if (activityType === "预防性维修") {
    const model = defaultSupportActivityAircraftModel();
    const existing = preventiveMaintenanceActivityEntries(model)[0]?.activity;
    if (existing) return existing;
    const activity = createPreventiveMaintenanceActivityForAircraftModel(model, preventiveMaintenanceActivityEntries().length + 1);
    setSupportActivityJobs(activity, []);
    activities.push(activity);
    selectedPreventiveMaintenanceActivityKey = `supportActivity:${activities.indexOf(activity)}`;
    selectedPreventiveMaintenanceAircraftModel = model;
    return activity;
  }
  if (activityType === "修复性维修") {
    const activity = ensureCorrectiveMaintenanceActivityForBasicActivityDraft(basicActivityDraft);
    if (activity) return activity;
    const fallback = createDefaultCorrectiveMaintenanceActivity();
    setSupportActivityJobs(fallback, []);
    activities.push(fallback);
    return fallback;
  }
  const model = defaultSupportActivityAircraftModel();
  const existing = operationsSupportPhaseActivity({ aircraftModel: model }, "直接准备方案");
  if (existing) {
    selectedOperationsSupportAircraftModel = model;
    selectedOperationsSupportActivityKey = `supportActivity:${activities.indexOf(existing)}`;
    return existing;
  }
  const activity = createOperationsSupportActivityForAircraftModel(model, operationsSupportPlanTypeConfigs()[0]);
  setSupportActivityJobs(activity, []);
  activities.push(activity);
  selectedOperationsSupportAircraftModel = model;
  selectedOperationsSupportActivityKey = `supportActivity:${activities.indexOf(activity)}`;
  return activity;
}

function ensureCorrectiveMaintenanceActivityForBasicActivityDraft(draft) {
  const scopeValue = basicActivityScopeValue(draft || {});
  const component = correctiveComponentForBasicActivityScope(scopeValue) || selectedCorrectiveComponent();
  const existing = correctiveMaintenanceActivityForComponent(component);
  if (existing) return existing;
  const created = ensureCorrectiveMaintenanceActivityForComponent(component);
  if (created) setSupportActivityJobs(created, []);
  return created;
}

function correctiveComponentForBasicActivityScope(scopeValue) {
  const text = String(scopeValue || "");
  if (!text.startsWith("component:")) return null;
  const componentId = text.replace(/^component:/, "");
  return (scenario.components || []).find((component) => (
    String(component.id || "") === componentId
    || String(component.name || "") === componentId
  )) || null;
}

function updateBasicActivityJobField(key, fieldName, value) {
  if (key === BASIC_ACTIVITY_DRAFT_KEY) {
    updateBasicActivityDraftField(fieldName, value);
    updatePreviewResultsThroughApiClient();
    return;
  }
  const [activityIndex, jobIndex] = String(key || "").split(":").map(Number);
  const activity = (scenario.supportActivities || [])[activityIndex];
  const jobs = supportActivityJobs(activity).slice();
  if (!activity || !jobs[jobIndex] || !fieldName) return;
  if (fieldName === "scope") {
    jobs[jobIndex] = {
      ...jobs[jobIndex],
      applicableAircraft: basicActivityApplicableAircraftFromScope(value)
    };
    setSupportActivityJobs(activity, jobs);
    updatePreviewResultsThroughApiClient();
    return;
  }
  if (fieldName === "type") {
    updateBasicActivityType(activity, value);
    updatePreviewResultsThroughApiClient();
    return;
  }
  if (fieldName.startsWith("durationProfile.")) {
    const profileField = fieldName.replace(/^durationProfile\./, "");
    const currentProfile = normalizeSupportActivityDurationProfile(jobs[jobIndex].durationProfile, jobs[jobIndex].durationMinutes);
    const nextProfile = normalizeSupportActivityDurationProfile({
      ...currentProfile,
      [profileField]: profileField === "distributionType" ? value : Number(value || 0)
    }, jobs[jobIndex].durationMinutes);
    jobs[jobIndex] = {
      ...jobs[jobIndex],
      durationProfile: nextProfile,
      durationMinutes: durationMinutesForSupportActivityProfile(nextProfile, jobs[jobIndex].durationMinutes)
    };
    setSupportActivityJobs(activity, jobs);
    updatePreviewResultsThroughApiClient();
    return;
  }
  const oldCode = jobs[jobIndex].activityCode;
  const nextValue = fieldName === "durationMinutes"
    ? Math.max(0, Number(value || 0))
    : fieldName === "activityCode"
      ? uniqueBasicActivityCode(value, key)
      : value;
  jobs[jobIndex] = {
    ...jobs[jobIndex],
    [fieldName]: nextValue
  };
  setSupportActivityJobs(
    activity,
    fieldName === "activityCode" ? remapSupportActivityJobPredecessors(jobs, oldCode, nextValue) : jobs
  );
  updatePreviewResultsThroughApiClient();
}

function updateBasicActivityDraftField(fieldName, value) {
  if (!basicActivityDraft || !fieldName) return;
  if (fieldName === "scope") {
    basicActivityDraft.applicableAircraft = basicActivityApplicableAircraftFromScope(value);
    return;
  }
  if (fieldName === "type") {
    basicActivityDraft.type = basicActivityTypeOptions().some((option) => option.value === value) ? value : "使用保障活动";
    basicActivityDraft.activityCode = nextBasicActivityCode(basicActivityDraft.type === "预防性维修" ? "PM" : basicActivityDraft.type === "修复性维修" ? "CM" : "BA");
    return;
  }
  if (fieldName.startsWith("durationProfile.")) {
    const profileField = fieldName.replace(/^durationProfile\./, "");
    const currentProfile = normalizeSupportActivityDurationProfile(basicActivityDraft.durationProfile, basicActivityDraft.durationMinutes);
    const nextProfile = normalizeSupportActivityDurationProfile({
      ...currentProfile,
      [profileField]: profileField === "distributionType" ? value : Number(value || 0)
    }, basicActivityDraft.durationMinutes);
    basicActivityDraft.durationProfile = nextProfile;
    basicActivityDraft.durationMinutes = durationMinutesForSupportActivityProfile(nextProfile, basicActivityDraft.durationMinutes);
    return;
  }
  basicActivityDraft[fieldName] = fieldName === "durationMinutes"
    ? Math.max(0, Number(value || 0))
    : fieldName === "activityCode"
      ? uniqueBasicActivityCode(value)
      : value;
}

function updateBasicActivityResourceField(key, fieldName, value) {
  const target = basicActivityJobTarget(key);
  if (!target || !fieldName) return;
  const { activity, jobs, jobIndex } = target;
  const job = { ...(jobs[jobIndex] || {}) };
  if (fieldName === "personnelProfessional") {
    job.personnelProfessional = String(value || "");
    job.personnel = normalizeBasicActivityResourceRequirements(job, "personnel").map((item) => ({
      ...item,
      professional: job.personnelProfessional || item.professional || ""
    }));
  } else if (fieldName === "personnelKeys") {
    job.personnel = basicActivityResourceRequirementsFromKeys("personnel", Array.isArray(value) ? value : []);
  } else if (fieldName === "equipmentModel") {
    job.equipmentModel = String(value || "");
  } else if (fieldName === "equipmentKeys") {
    job.equipment = mergeBasicActivityResourceQuantities(
      normalizeBasicActivityResourceRequirements(job, "equipment"),
      basicActivityResourceRequirementsFromKeys("equipment", Array.isArray(value) ? value : [])
    );
  } else if (fieldName === "spareKeys") {
    job.spare = mergeBasicActivityResourceQuantities(
      normalizeBasicActivityResourceRequirements(job, "spare"),
      basicActivityResourceRequirementsFromKeys("spare", Array.isArray(value) ? value : [])
    );
  } else if (fieldName.startsWith("equipmentQuantity:")) {
    job.equipment = updateBasicActivityRequirementQuantity(job, "equipment", fieldName.replace(/^equipmentQuantity:/, ""), value);
  } else if (fieldName.startsWith("spareQuantity:")) {
    job.spare = updateBasicActivityRequirementQuantity(job, "spare", fieldName.replace(/^spareQuantity:/, ""), value);
  }
  syncBasicActivityResourceSummaries(job);
  setBasicActivityTargetJob(target, job);
  updatePreviewResultsThroughApiClient();
}

function updateBasicActivityResourceDialogField(key, resourceKind, index, fieldName, value) {
  const target = basicActivityJobTarget(key);
  if (!target || !["personnel", "equipment", "spare"].includes(resourceKind) || !Number.isInteger(index) || !fieldName) return;
  const { activity, jobs, jobIndex } = target;
  const job = { ...(jobs[jobIndex] || {}) };
  const requirements = normalizeBasicActivityResourceRequirements(job, resourceKind);
  const current = requirements[index];
  if (!current) return;
  if (fieldName === "resourceKey") {
    requirements[index] = createBasicActivityResourceRequirementFromKey(
      resourceKind,
      String(value || ""),
      Math.max(1, Number(current.quantity ?? 1) || 1),
      index
    );
  } else {
    const nextValue = fieldName === "quantity" ? Math.max(1, Number(value || 1) || 1) : String(value || "");
    requirements[index] = normalizeBasicActivityResourceDialogRequirement(resourceKind, {
      ...current,
      [fieldName]: nextValue
    }, index);
  }
  setBasicActivityResourceRequirements(job, resourceKind, requirements);
  syncBasicActivityResourceSummaries(job);
  setBasicActivityTargetJob(target, job);
  updatePreviewResultsThroughApiClient();
}

function addBasicActivityResourceRequirement(key, resourceKind) {
  const target = basicActivityJobTarget(key);
  if (!target || !["personnel", "equipment", "spare"].includes(resourceKind)) return;
  const { activity, jobs, jobIndex } = target;
  const job = { ...(jobs[jobIndex] || {}) };
  const requirements = normalizeBasicActivityResourceRequirements(job, resourceKind);
  requirements.push(createBasicActivityResourceRequirement(resourceKind, requirements.length));
  setBasicActivityResourceRequirements(job, resourceKind, requirements);
  syncBasicActivityResourceSummaries(job);
  setBasicActivityTargetJob(target, job);
  basicActivityResourceDialog = { key, kind: resourceKind };
  updatePreviewResultsThroughApiClient();
}

function deleteBasicActivityResourceRequirement(key, resourceKind, index) {
  const target = basicActivityJobTarget(key);
  if (!target || !["personnel", "equipment", "spare"].includes(resourceKind) || !Number.isInteger(index)) return;
  const { activity, jobs, jobIndex } = target;
  const job = { ...(jobs[jobIndex] || {}) };
  const requirements = normalizeBasicActivityResourceRequirements(job, resourceKind)
    .filter((_, itemIndex) => itemIndex !== index);
  setBasicActivityResourceRequirements(job, resourceKind, requirements);
  syncBasicActivityResourceSummaries(job);
  setBasicActivityTargetJob(target, job);
  basicActivityResourceDialog = { key, kind: resourceKind };
  updatePreviewResultsThroughApiClient();
}

function createBasicActivityResourceRequirement(resourceKind, index) {
  const source = basicActivityCatalogRows(resourceKind)[0] || null;
  return createBasicActivityResourceRequirementFromRow(resourceKind, source, 1, index);
}

function createBasicActivityResourceRequirementFromKey(resourceKind, resourceKey, quantity = 1, index = 0) {
  const source = basicActivityCatalogRows(resourceKind)
    .find((row) => String(row.key || "") === String(resourceKey || ""));
  return createBasicActivityResourceRequirementFromRow(resourceKind, source || null, quantity, index);
}

function createBasicActivityResourceRequirementFromRow(resourceKind, source, quantity = 1, index = 0) {
  if (resourceKind === "personnel") {
    return normalizeBasicActivityResourceDialogRequirement(resourceKind, {
      professional: normalizePersonnelSpecialtyName(source?.model || source?.name || ""),
      quantity
    }, index);
  }
  return normalizeBasicActivityResourceDialogRequirement(resourceKind, {
    key: source?.key || "",
    name: source?.name || source?.model || "",
    model: source?.model || source?.name || "",
    quantity
  }, index);
}

function normalizeBasicActivityResourceDialogRequirement(resourceKind, item, index) {
  if (resourceKind === "personnel") {
    const professional = normalizePersonnelSpecialtyName(item.professional || item.model || item.name || "");
    return {
      professional,
      quantity: Math.max(1, Number(item.quantity ?? 1) || 1)
    };
  }
  return {
    key: item.key || item.resourceKey || "",
    name: item.name || "",
    model: item.model || "",
    quantity: Math.max(1, Number(item.quantity ?? 1) || 1)
  };
}

function setBasicActivityResourceRequirements(job, resourceKind, requirements) {
  if (resourceKind === "personnel") {
    job.personnel = requirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement(resourceKind, item, index));
    delete job.personnelRequirements;
    job.personnelProfessional = job.personnel[0]?.professional || "";
  } else if (resourceKind === "equipment") {
    job.equipment = requirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement(resourceKind, item, index));
    delete job.equipmentRequirements;
    job.equipmentModel = job.equipment[0]?.model || "";
  } else if (resourceKind === "spare") {
    job.spare = requirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement(resourceKind, item, index));
    delete job.spareRequirements;
  }
}

function basicActivityJobTarget(key) {
  if (key === BASIC_ACTIVITY_DRAFT_KEY && basicActivityDraft) {
    return { activity: null, jobs: [basicActivityDraft], jobIndex: 0, isDraft: true };
  }
  const [activityIndex, jobIndex] = String(key || "").split(":").map(Number);
  const activity = (scenario.supportActivities || [])[activityIndex];
  const jobs = supportActivityJobs(activity).slice();
  if (!activity || !jobs[jobIndex]) return null;
  return { activity, jobs, jobIndex, isDraft: false };
}

function setBasicActivityTargetJob(target, job) {
  target.jobs[target.jobIndex] = job;
  if (target.isDraft) {
    basicActivityDraft = { ...basicActivityDraft, ...job, key: BASIC_ACTIVITY_DRAFT_KEY };
    return;
  }
  setSupportActivityJobs(target.activity, target.jobs);
}

function basicActivityResourceRequirementsFromKeys(resourceKind, keys) {
  const resourceType = resourceKind === "personnel" ? "保障人员" : resourceKind === "equipment" ? "保障设备" : "备件";
  const rowsByKey = new Map(basicActivityCatalogRows(resourceKind).map((row) => [String(row.key), row]));
  return keys.map((key) => {
    const row = rowsByKey.get(String(key));
    if (!row) return null;
    if (resourceKind === "personnel") {
      return {
        professional: row.model || "",
        quantity: Math.max(1, Number(row.quantity) || 1)
      };
    }
    return {
      key: String(key),
      name: row.name || row.model || resourceType,
      model: row.model || "",
      quantity: 1
    };
  }).filter(Boolean);
}

function mergeBasicActivityResourceQuantities(previousRequirements, nextRequirements) {
  const quantityByKey = new Map((previousRequirements || []).map((item) => [String(item.key || ""), item.quantity]));
  return nextRequirements.map((item) => ({
    ...item,
    quantity: Math.max(1, Number(quantityByKey.get(String(item.key || "")) ?? item.quantity ?? 1) || 1)
  }));
}

function updateBasicActivityRequirementQuantity(job, resourceKind, key, value) {
  return normalizeBasicActivityResourceRequirements(job, resourceKind).map((item) => (
    String(item.key || "") === String(key)
      ? { ...item, quantity: Math.max(1, Number(value || 1) || 1) }
      : item
  ));
}

function syncBasicActivityResourceSummaries(job) {
  const personnelRequirements = normalizeBasicActivityResourceRequirements(job, "personnel");
  const equipmentRequirements = normalizeBasicActivityResourceRequirements(job, "equipment");
  const spareRequirements = normalizeBasicActivityResourceRequirements(job, "spare");
  job.personnel = personnelRequirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement("personnel", item, index));
  delete job.personnelRequirements;
  job.equipment = equipmentRequirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement("equipment", item, index));
  delete job.equipmentRequirements;
  job.spare = spareRequirements.map((item, index) => normalizeBasicActivityResourceDialogRequirement("spare", item, index));
  delete job.spareRequirements;
}

function durationMinutesForSupportActivityProfile(profile, fallbackMinutes = 30) {
  if (profile?.distributionType === "指数分布") return Math.max(1, Number(profile.mean || fallbackMinutes));
  if (profile?.distributionType === "正态分布") return Math.max(1, Number(profile.mean || fallbackMinutes));
  if (profile?.distributionType === "均匀分布") return Math.max(1, Math.round((Number(profile.min || fallbackMinutes) + Number(profile.max || fallbackMinutes)) / 2));
  return Math.max(1, Number(profile?.value || fallbackMinutes));
}

function updateBasicActivityType(activity, value) {
  const nextType = String(value || "");
  if (nextType === "预防性维修") {
    activity.activityType = "预防性维修";
    activity.planType = "预防性维修方案";
    return;
  }
  if (nextType === "修复性维修") {
    activity.activityType = "修复性维修";
    activity.planType = "修复性维修方案";
    return;
  }
  activity.activityType = "使用保障活动";
  activity.planType = normalizeOperationsSupportPlanType(activity.planType);
  if (!supportActivityAircraftModel(activity)) {
    activity.aircraftModel = wholeMachineModels()[0] || scenarioEquipmentModel() || "";
  }
}

function basicActivityApplicableAircraftFromScope(value) {
  const text = String(value || "");
  return text.startsWith("aircraft:") ? text.replace(/^aircraft:/, "").trim() : "";
}

function deleteBasicActivityJob(key) {
  const [activityIndex, jobIndex] = String(key || "").split(":").map(Number);
  const activity = (scenario.supportActivities || [])[activityIndex];
  if (!activity) return;
  deleteSupportActivityJobAt(activity, jobIndex);
  selectedBasicActivityKeys.delete(key);
}

function deleteSelectedBasicActivityJobs() {
  const byActivity = new Map();
  for (const key of selectedBasicActivityKeys) {
    const [activityIndex, jobIndex] = String(key).split(":").map(Number);
    if (!Number.isInteger(activityIndex) || !Number.isInteger(jobIndex)) continue;
    byActivity.set(activityIndex, [...(byActivity.get(activityIndex) || []), jobIndex]);
  }
  for (const [activityIndex, indexes] of byActivity.entries()) {
    deleteSupportActivityJobsAtIndexes((scenario.supportActivities || [])[activityIndex], indexes);
  }
  selectedBasicActivityKeys = new Set();
}

function toggleAllBasicActivitySelection(checked) {
  selectedBasicActivityKeys = checked ? new Set(filteredBasicActivityLibraryRows().map((row) => row.key)) : new Set();
}

function importBasicActivityByType(type) {
  const activityType = basicActivityTypeOptions().some((option) => option.value === type) ? type : "使用保障活动";
  const activity = ensureBasicActivityDraftHostActivity(activityType);
  if (!activity) return;
  const jobs = supportActivityJobs(activity).slice();
  const index = jobs.length;
  const prefix = activityType === "预防性维修" ? "PM" : activityType === "修复性维修" ? "CM" : "BA";
  jobs.push({
    activityCode: nextBasicActivityCode(prefix),
    workName: `${activityType}导入作业${index + 1}`,
    predecessors: [],
    durationProfile: { distributionType: "固定值", value: 30 },
    durationMinutes: 30,
    personnel: defaultPersonnelRequirement("机务", 1),
    equipment: defaultMaterialRequirement("通用工具", "通用工具", 1),
    spare: []
  });
  setSupportActivityJobs(activity, jobs);
  const activityIndex = (scenario.supportActivities || []).indexOf(activity);
  selectedBasicActivityKeys = new Set([`${activityIndex}:${index}`]);
}

function nextBasicActivityCode(prefix) {
  const used = new Set(basicActivityLibraryRows().map((row) => String(row.activityCode || "").trim()).filter(Boolean));
  let index = used.size + 1;
  let code = `${prefix}-${String(index).padStart(3, "0")}`;
  while (used.has(code)) {
    index += 1;
    code = `${prefix}-${String(index).padStart(3, "0")}`;
  }
  return code;
}

function uniqueBasicActivityCode(value, currentKey = "") {
  const requested = String(value || "").trim();
  if (!requested) return requested;
  const used = new Set(
    basicActivityLibraryRows()
      .filter((row) => row.key !== currentKey)
      .map((row) => String(row.activityCode || "").trim())
      .filter(Boolean)
  );
  if (!used.has(requested)) return requested;
  const match = requested.match(/^(.*?)(?:-(\d+))?$/);
  const prefix = (match?.[1] || requested || "BA").replace(/-$/, "");
  let index = Number(match?.[2] || 2);
  let code = `${prefix}-${String(index).padStart(3, "0")}`;
  while (used.has(code)) {
    index += 1;
    code = `${prefix}-${String(index).padStart(3, "0")}`;
  }
  return code;
}

function ensureSupportActivityForBasicType(type) {
  if (type === "预防性维修") return ensurePreventiveMaintenanceActivityForAircraftModel(defaultSupportActivityAircraftModel());
  if (type === "修复性维修") return ensureCorrectiveMaintenanceActivityDraft();
  return ensureOperationsSupportActivityForAircraftModel(defaultSupportActivityAircraftModel());
}

function applyBasicActivityToSupportActivityJob(tabKey, basicActivityKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity) return;
  const allowedKeys = new Set(basicActivityLibraryOptions(tabKey).map((option) => option.value));
  if (!allowedKeys.has(String(basicActivityKey || ""))) return;
  const template = basicActivityLibraryRows().find((row) => row.key === basicActivityKey);
  if (!template) return;
  const jobs = supportActivityJobs(activity).slice();
  const addMode = supportActivityTemplatePickerTabKey === tabKey;
  const targetIndex = addMode ? jobs.length : selectedSupportActivityJobIndexForTab(tabKey, jobs);
  const current = jobs[targetIndex] || {};
  const activityIndex = (scenario.supportActivities || []).indexOf(activity);
  const targetKey = activityIndex >= 0 ? `${activityIndex}:${targetIndex}` : "";
  const templateJob = supportActivityJobFromBasicActivity(template);
  templateJob.activityCode = uniqueBasicActivityCode(
    templateJob.activityCode || nextSupportActivityJobCode(tabKey, jobs),
    addMode ? "" : targetKey
  );
  jobs[targetIndex] = {
    ...current,
    ...templateJob
  };
  setSupportActivityJobs(activity, jobs);
  selectedSupportActivityJobKeys = new Set([supportActivityJobKey(tabKey, targetIndex)]);
  supportActivityTemplatePickerTabKey = "";
  supportActivityTemplateQuery = "";
}

function addBasicActivityAsSupportActivityPredecessor(tabKey, basicActivityKey, targetKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  const template = basicActivityLibraryRows().find((row) => row.key === basicActivityKey);
  const target = supportActivityJobByKey(targetKey);
  if (!activity || !template || !target || target.tabKey !== tabKey) return;
  const jobs = supportActivityJobs(activity).slice();
  const templateJob = supportActivityJobFromBasicActivity(template);
  let predecessorIndex = jobs.findIndex((job, index) => (
    index !== target.index
    && (
      (templateJob.activityCode && job.activityCode === templateJob.activityCode)
      || (templateJob.workName && job.workName === templateJob.workName)
    )
  ));
  if (predecessorIndex < 0) {
    predecessorIndex = jobs.length;
    templateJob.activityCode = uniqueBasicActivityCode(templateJob.activityCode || nextSupportActivityJobCode(tabKey, jobs));
    jobs.push({
      ...templateJob,
      predecessors: Array.isArray(templateJob.predecessors) ? [...templateJob.predecessors] : []
    });
  }
  const predecessorValue = supportActivityPredecessorValue(jobs[predecessorIndex], predecessorIndex);
  const targetJob = { ...(jobs[target.index] || {}) };
  const predecessors = new Set(Array.isArray(targetJob.predecessors) ? targetJob.predecessors : []);
  predecessors.add(predecessorValue);
  jobs[target.index] = { ...targetJob, predecessors: Array.from(predecessors) };
  setSupportActivityJobs(activity, jobs);
  selectedSupportActivityJobKeys = new Set([supportActivityJobKey(tabKey, target.index)]);
  updatePreviewResultsThroughApiClient();
}

function nextSupportActivityJobCode(tabKey, jobs) {
  const prefix = supportActivityJobCodePrefix(tabKey);
  const used = new Set(jobs.map((job) => String(job.activityCode || "").trim()).filter(Boolean));
  let index = jobs.length + 1;
  let code = `${prefix}-${String(index).padStart(3, "0")}`;
  while (used.has(code)) {
    index += 1;
    code = `${prefix}-${String(index).padStart(3, "0")}`;
  }
  return code;
}

function selectedSupportActivityJobIndexForTab(tabKey, jobs) {
  const selectedKey = Array.from(selectedSupportActivityJobKeys).find((key) => String(key).startsWith(`${tabKey}:`));
  const selectedIndex = Number(String(selectedKey || "").split(":")[1]);
  if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < jobs.length) return selectedIndex;
  if (jobs.length) return 0;
  jobs.push({
    activityCode: `${supportActivityJobCodePrefix(tabKey)}-001`,
    workName: supportActivityJobDefaultName(tabKey, 0),
    predecessors: [],
    durationProfile: { distributionType: "固定值", value: 30 },
    durationMinutes: 30
  });
  return 0;
}

function renderOperationsSupportActivity(activePlan, activity) {
  const phaseActivities = findOperationsSupportPhaseActivities(activity);
  const activePlanType = normalizeOperationsSupportPlanType(selectedOperationsSupportPlanType);
  const activePhaseActivity = phaseActivities.find((item) => String(item.planType || "") === activePlanType) || phaseActivities[0] || activity;
  const planNameActivity = operationsSupportPlanNameActivity(activity, phaseActivities);
  const planNameActivityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(planNameActivity));
  const tabs = operationsSupportPlanTypeConfigs().map((config) => `
    <button type="button" class="tab-btn ${activePlanType === config.planType ? "active" : ""}" data-ops-support-plan-type="${htmlEscape(config.planType)}">${htmlEscape(config.label)}</button>
  `).join("");
  return `
    <div class="detail-card activity-editor-card">
      ${modelingLockNotice()}
      <div class="form-table-grid">
        ${field("方案名称", `supportActivities.${planNameActivityIndex}.activityName`)}
      </div>
      <div class="section-head">
        <h3>使用保障活动编辑</h3>
        <span>${activePlan.path.map((item) => htmlEscape(item)).join(" / ")} / ${htmlEscape(operationsSupportPlanTypeConfigs().find((item) => item.planType === activePlanType)?.label || activePlanType)}</span>
      </div>
      <div class="ops-plan-type-tabs">${tabs}</div>
      ${renderSupportActivityJobTable(activePhaseActivity, operationsSupportPlanTypeTabKey(activePlanType))}
    </div>
  `;
}

function renderPreventiveMaintenanceActivity(activePlan, activity) {
  const activityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(activity));
  const ruleNumberAttrs = (enabled, attrs) => (enabled ? attrs : { ...attrs, disabled: "disabled" });
  const lockedAttr = modelingLockDisabledAttr();
  const renderRuleRow = ({ toggleLabel, togglePath, enabled, intervalLabel, intervalPath, intervalAttrs, floatLabel, floatPath, floatAttrs }) => `
    <div class="preventive-rule-row">
      <label class="preventive-rule-toggle">${toggleLabel}<input type="checkbox" data-path="${togglePath}" ${enabled ? "checked" : ""}${lockedAttr}></label>
      ${field(intervalLabel, intervalPath, "number", ruleNumberAttrs(enabled, intervalAttrs))}
      ${field(floatLabel, floatPath, "number", ruleNumberAttrs(enabled, floatAttrs))}
    </div>
  `;
  return `
    <div class="detail-card activity-editor-card">
      ${modelingLockNotice()}
      <div class="section-head">
        <h3>预防性维修活动编辑</h3>
        <span>${activePlan.path.map((item) => htmlEscape(item)).join(" / ")}</span>
      </div>
      <div class="form-table-grid">
        ${field("方案名称", `supportActivities.${activityIndex}.activityName`)}
        ${field("计划停机小时", `supportActivities.${activityIndex}.plannedDowntimeHours`, "number", { min: "0", step: "0.1" })}
        ${renderRuleRow({
          toggleLabel: "启动日历时间",
          togglePath: `supportActivities.${activityIndex}.useCalendarRule`,
          enabled: activity.useCalendarRule,
          intervalLabel: "日历日间隔规则",
          intervalPath: `supportActivities.${activityIndex}.calendarDayInterval`,
          intervalAttrs: { min: "0", step: "1" },
          floatLabel: "日历日间隔上下浮动比例",
          floatPath: `supportActivities.${activityIndex}.calendarDayFloatRatio`,
          floatAttrs: { min: "0", max: "1", step: "0.01" }
        })}
        ${renderRuleRow({
          toggleLabel: "飞行小时",
          togglePath: `supportActivities.${activityIndex}.useFlightHourRule`,
          enabled: activity.useFlightHourRule,
          intervalLabel: "飞行小时间隔",
          intervalPath: `supportActivities.${activityIndex}.runHourInterval`,
          intervalAttrs: { min: "0", step: "1" },
          floatLabel: "飞行小时上下浮动比例",
          floatPath: `supportActivities.${activityIndex}.runHourFloatRatio`,
          floatAttrs: { min: "0", max: "1", step: "0.01" }
        })}
        ${renderRuleRow({
          toggleLabel: "起落次数",
          togglePath: `supportActivities.${activityIndex}.useTakeoffLandingRule`,
          enabled: activity.useTakeoffLandingRule,
          intervalLabel: "起落次数间隔",
          intervalPath: `supportActivities.${activityIndex}.takeoffLandingInterval`,
          intervalAttrs: { min: "0", step: "1" },
          floatLabel: "起落次数间隔上下浮动比例",
          floatPath: `supportActivities.${activityIndex}.takeoffLandingFloatRatio`,
          floatAttrs: { min: "0", max: "1", step: "0.01" }
        })}
      </div>
      ${renderSupportActivityJobTable(activity, "prev_repair")}
    </div>
  `;
}

function renderEquipmentConfigTree() {
  const equipmentModels = wholeMachineModels();
  const selectedComponent = selectedCorrectiveComponent();
  return `
    <aside class="tree-container">
      <div class="tree-toolbar"><h4>装备构型树</h4><span class="muted">${selectedComponent ? `当前：${htmlEscape(selectedComponent.name || selectedComponent.id)}` : "可点选组件"}</span></div>
      ${renderCollapsibleTree(equipmentModels.map((model, index) => ({
        id: `equipment-config:${model}`,
        label: model,
        selected: !selectedCorrectiveComponentId && index === 0,
        actionAttrs: `data-select-corrective-component="aircraft:${htmlEscape(model)}"`,
        children: buildReadonlyEquipmentConfigComponentTreeNodes(model, "aircraft-root")
      })), { className: "tree-node-list" })}
    </aside>
  `;
}

function buildReadonlyEquipmentConfigComponentTreeNodes(aircraftModel, parentId) {
  const buildChildren = (parentId, visited = new Set()) => {
    const visitedIds = new Set(visited);
    return (scenario.components || [])
      .filter((component) => {
        const componentId = String(component.id || "");
        return componentId
          && componentId !== String(parentId)
          && !visitedIds.has(componentId)
          && componentBelongsToAircraft(component, aircraftModel)
          && String(component.parentId || "aircraft-root") === parentId;
      })
      .map((component) => {
        const componentId = String(component.id || "");
        const nextVisited = new Set(visitedIds);
        nextVisited.add(componentId);
        return {
          id: `equipment-config-component:${aircraftModel}:${component.id || component.name}`,
          label: component.name,
          meta: `${component.quantity} 件`,
          selected: selectedCorrectiveComponentId === componentId,
          actionAttrs: `data-select-corrective-component="${htmlEscape(componentId)}"`,
          children: buildChildren(component.id, nextVisited)
        };
      });
  };
  return buildChildren(parentId);
}

function correctiveReferenceComponent() {
  return (scenario.components || []).find((component) => component.specialRepairProfile) || (scenario.components || [])[0] || {};
}

function selectedCorrectiveComponent() {
  if (selectedCorrectiveComponentId.startsWith("aircraft:")) {
    return { id: selectedCorrectiveComponentId, name: selectedCorrectiveComponentId.replace(/^aircraft:/, ""), aircraftLevel: true };
  }
  return (scenario.components || []).find((component) => String(component.id || "") === String(selectedCorrectiveComponentId || "")) || correctiveReferenceComponent();
}

function correctiveComponentActivityEquipmentId(component) {
  return String(component?.id || "").trim();
}

function correctiveMaintenanceActivityForComponent(component) {
  const equipmentId = correctiveComponentActivityEquipmentId(component);
  if (!equipmentId) return null;
  return (scenario.supportActivities || []).find((activity) => (
    activity.activityType === "修复性维修"
    && String(activity.equipmentId || "") === equipmentId
  )) || null;
}

function selectedCorrectiveMaintenanceActivity() {
  return correctiveMaintenanceActivityForComponent(selectedCorrectiveComponent())
    || (scenario.supportActivities || []).find((activity) => isCorrectiveMaintenanceActivity(activity))
    || null;
}

function ensureCorrectiveMaintenanceActivityForComponent(component, { copyTemplateJobs = true } = {}) {
  const existing = correctiveMaintenanceActivityForComponent(component);
  if (existing) return existing;
  const equipmentId = correctiveComponentActivityEquipmentId(component);
  if (!equipmentId) return null;
  if (!Array.isArray(scenario.supportActivities)) scenario.supportActivities = [];
  const template = (scenario.supportActivities || []).find((activity) => activity.activityType === "修复性维修") || {};
  const activity = JSON.parse(JSON.stringify(template));
  const componentName = component?.name || equipmentId;
  activity.id = nextCorrectiveMaintenanceActivityId(equipmentId);
  activity.name = `${componentName}故障修复`;
  activity.activityType = "修复性维修";
  activity.activityName = `${componentName}修复性维修方案`;
  activity.planType = "修复性维修方案";
  activity.equipmentId = equipmentId;
  setSupportActivityJobs(activity, copyTemplateJobs ? supportActivityJobs(template).map((job) => ({ ...job })) : []);
  scenario.supportActivities.push(activity);
  return activity;
}

function nextCorrectiveMaintenanceActivityId(equipmentId) {
  const prefix = `corrective-${String(equipmentId || "equipment").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const usedIds = new Set((scenario.supportActivities || []).map((activity) => String(activity.id || "")));
  let index = usedIds.size + 1;
  while (usedIds.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function renderCorrectiveMaintenanceActivity(activity) {
  const component = selectedCorrectiveComponent();
  const componentActivity = correctiveMaintenanceActivityForComponent(selectedCorrectiveComponent()) || (isCorrectiveMaintenanceActivity(activity) ? activity : null);
  const lockedAttr = modelingLockDisabledAttr();
  if (!componentActivity) {
    return `
    <div class="organization-layout">
      ${renderEquipmentConfigTree()}
      <section class="detail-panel">
        <div class="detail-card activity-editor-card">
          ${modelingLockNotice()}
          <div class="section-head">
            <h3>修复性维修活动编辑</h3>
            <span>${htmlEscape(component?.name || component?.id || "未选择组件")}</span>
          </div>
          ${importedDataEmptyState("修复性维修活动")}
        </div>
      </section>
    </div>
  `;
  }
  const activityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(componentActivity));
  const repairType = componentActivity.repairType || "原位维修";
  const mttrText = correctiveComponentMttrText(component);
  return `
    <div class="organization-layout">
      ${renderEquipmentConfigTree()}
      <section class="detail-panel">
        <div class="detail-card activity-editor-card">
          ${modelingLockNotice()}
          <div class="section-head">
            <h3>修复性维修活动编辑</h3>
            <span>${htmlEscape(componentActivity.activityName || "修复性维修方案")} / ${htmlEscape(component?.name || component?.id || "未选择组件")}</span>
          </div>
          <div class="form-table-grid">
            <label>MTTR<input readonly value="${htmlEscape(mttrText)}"></label>
            <label>维修类型
              <span class="inline-radio-group">
                <label><input data-path="supportActivities.${activityIndex}.repairType" type="radio" name="corrective-repair-type" value="原位维修" ${repairType === "原位维修" ? "checked" : ""}${lockedAttr}>原位维修</label>
                <label><input data-path="supportActivities.${activityIndex}.repairType" type="radio" name="corrective-repair-type" value="换件维修" ${repairType === "换件维修" ? "checked" : ""}${lockedAttr}>换件维修</label>
              </span>
            </label>
          </div>
          ${renderSupportActivityJobTable(componentActivity, "corr_repair")}
            </div>
      </section>
    </div>
  `;
}

function correctiveComponentMttrText(component) {
  if (!component) return "未选择组件";
  const distribution = component.repairDistribution || {};
  const distributionType = distribution.distributionType || "固定值";
  const minutes = mttrMinutesForRepairDistribution(component, distributionType);
  const detail = repairDistributionDetailText(distribution, distributionType);
  return minutes > 0 ? `${distributionType} ${minutes} min${detail ? ` (${detail})` : ""}` : "装备系统建模未配置 MTTR";
}

function mttrMinutesForRepairDistribution(component, distributionType) {
  const distribution = component?.repairDistribution || {};
  if (distributionType === "指数分布") {
    const mean = positiveFiniteNumber(distribution.mean ?? distribution.value, 0);
    const rate = positiveFiniteNumber(distribution.rate, 0);
    return mean || (rate > 0 ? roundOneDecimal(1 / rate) : 0);
  }
  if (distributionType === "正态分布") {
    return positiveFiniteNumber(distribution.mean ?? distribution.value, 0);
  }
  if (distributionType === "均匀分布") {
    const min = positiveFiniteNumber(distribution.min, 0);
    const max = positiveFiniteNumber(distribution.max, 0);
    return min > 0 && max > 0 ? roundOneDecimal((min + max) / 2) : 0;
  }
  return positiveFiniteNumber(
    component?.meanRepairTimeMinutes ?? component?.mttrMinutes ?? distribution.value ?? distribution.mean,
    0
  );
}

function repairDistributionDetailText(distribution, distributionType) {
  if (distributionType === "指数分布" && positiveFiniteNumber(distribution.rate, 0) > 0) {
    return `rate=${distribution.rate}`;
  }
  if (distributionType === "正态分布" && positiveFiniteNumber(distribution.variance, 0) > 0) {
    return `variance=${distribution.variance}`;
  }
  if (distributionType === "均匀分布") {
    const min = positiveFiniteNumber(distribution.min, 0);
    const max = positiveFiniteNumber(distribution.max, 0);
    return min > 0 && max > 0 ? `min=${min}, max=${max}` : "";
  }
  return "";
}

function positiveFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function roundOneDecimal(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function toggleLogisticsTransportStrategySelection(index, checked) {
  if (!Number.isInteger(index) || index < 0) return;
  const next = new Set(selectedLogisticsTransportStrategyIndexes);
  if (checked) next.add(index);
  else next.delete(index);
  selectedLogisticsTransportStrategyIndexes = next;
}

function ensureTransportPolicies() {
  if (!Array.isArray(scenario.transportPolicies)) scenario.transportPolicies = [];
  if (scenario.transportPolicies.length) {
    scenario.transportPolicies = coalesceTransportPolicies(scenario.transportPolicies);
    return scenario.transportPolicies;
  }
  const migrated = legacyTransportPoliciesFromSupportActivities();
  if (migrated.length) scenario.transportPolicies = coalesceTransportPolicies(migrated);
  return scenario.transportPolicies;
}

function coalesceTransportPolicies(policies) {
  const byRoute = new Map();
  for (const source of policies || []) {
    const policy = { ...source };
    delete policy.spareName;
    delete policy.spareType;
    delete policy.spare_type;
    const key = [policy.fromSupportNodeName || policy.from, policy.toSupportNodeName || policy.to, policy.transportMode || policy.direction].join("|");
    if (!byRoute.has(key)) byRoute.set(key, policy);
    else if (Number(byRoute.get(key).transportTimeHours) !== Number(policy.transportTimeHours)) {
      projectDraftStatus = `运输策略 ${key} 存在多个旧运输时间，已采用第一条；请确认后保存。`;
    }
  }
  return [...byRoute.values()];
}

function legacyTransportPoliciesFromSupportActivities() {
  return (Array.isArray(scenario.supportActivities) ? scenario.supportActivities : []).flatMap((activity, activityIndex) => {
    if (!Array.isArray(activity?.transportStrategies)) return [];
    return activity.transportStrategies
      .filter((policy) => policy && typeof policy === "object" && !Array.isArray(policy))
      .map((policy, policyIndex) => normalizedLogisticsTransportPolicy(policy, activity, activityIndex, policyIndex));
  });
}

function normalizedLogisticsTransportPolicy(policy, activity, activityIndex, policyIndex) {
  const fromRef = policy.fromSupportNodeName || policy.from || "";
  const toRef = policy.toSupportNodeName || policy.to || "";
  return {
    ...policy,
    id: policy.id || `${activity?.id || `logistics-${activityIndex + 1}`}-transport-${policyIndex + 1}`,
    name: policy.name || `运输策略${policyIndex + 1}`,
    fromSupportNodeName: supportNodeDisplayNameForRef(fromRef),
    toSupportNodeName: supportNodeDisplayNameForRef(toRef),
    transportMode: policy.transportMode || policy.direction || ""
  };
}

function supportNodeDisplayNameForRef(ref) {
  const value = String(ref || "");
  if (!value) return "";
  const matched = (scenario.supportNodes || []).find((node) => (
    String(node?.name || "") === value
    || String(node?.supportNodeName || "") === value
    || String(node?.id || "") === value
  ));
  return String(matched?.name || matched?.supportNodeName || matched?.id || value);
}

function defaultSupportNodeName(index) {
  const node = (scenario.supportNodes || [])[index];
  return String(node?.name || node?.supportNodeName || node?.id || "");
}

function defaultLogisticsTransportPolicy(index) {
  const fromSupportNodeName = defaultSupportNodeName(0);
  const toSupportNodeName = defaultSupportNodeName(1) || fromSupportNodeName;
  const direction = "\u6a2a\u5411\u8fd0\u8f93";
  return {
    id: nextTransportPolicyId(),
    name: `\u65b0\u589e\u8fd0\u8f93\u7b56\u7565${index + 1}`,
    direction,
    transportMode: direction,
    triggerMode: "\u4e34\u754c\u5e93\u5b58",
    criticalInventory: 1,
    fromSupportNodeName,
    toSupportNodeName,
    transportTimeHours: 1
  };
}

function nextTransportPolicyId() {
  const usedIds = new Set((Array.isArray(scenario.transportPolicies) ? scenario.transportPolicies : []).map((policy) => String(policy?.id || "")));
  let index = usedIds.size + 1;
  while (usedIds.has(`transport-policy-${index}`)) index += 1;
  return `transport-policy-${index}`;
}

function renderLogisticsSupportActivity(activePlan, activity) {
  const transportPolicies = ensureTransportPolicies();
  selectedLogisticsTransportStrategyIndexes = new Set(
    Array.from(selectedLogisticsTransportStrategyIndexes).filter((index) => index >= 0 && index < transportPolicies.length)
  );
  const lockedAttr = modelingLockDisabledAttr();
  const supportNodeOptions = uniqueSelectOptions((scenario.supportNodes || [])
    .map((node) => {
      const name = String(node?.name || node?.supportNodeName || node?.id || "");
      return { value: name, label: name };
    })
    .filter((option) => option.value));
  const directionOptions = [
    { value: "\u6a2a\u5411\u8fd0\u8f93", label: "\u6a2a\u5411\u8fd0\u8f93" },
    { value: "\u7eb5\u5411\u8fd0\u8f93", label: "\u7eb5\u5411\u8fd0\u8f93" }
  ];
  const triggerModeOptions = [
    { value: "\u4e34\u754c\u5e93\u5b58", label: "\u4e34\u754c\u5e93\u5b58" },
    { value: "\u5468\u671f\u6027\u8c03\u8fd0", label: "\u5468\u671f\u6027\u8c03\u8fd0" }
  ];
  return `
    <div class="detail-card activity-editor-card">
      ${modelingLockNotice()}
      <div class="section-head">
        <h3>\u540e\u52e4\u4fdd\u969c\u8fd0\u8f93\u7b56\u7565\u914d\u7f6e</h3>
        <div class="toolbar-row">
          <button type="button" class="btn-primary"${lockedAttr} data-logistics-transport-add>\u65b0\u589e</button>
          <button type="button" class="btn-danger" data-logistics-transport-delete ${selectedLogisticsTransportStrategyIndexes.size && !currentModelingPageLocked() ? "" : "disabled"}>\u5220\u9664</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u9009\u62e9</th><th>\u7b56\u7565\u540d\u79f0</th><th>\u7b56\u7565\u65b9\u5411</th><th>\u89e6\u53d1\u65b9\u5f0f</th><th>\u89e6\u53d1\u53c2\u6570</th><th>\u8fd0\u8f93\u8d77\u70b9</th><th>\u8fd0\u8f93\u7ec8\u70b9</th><th>\u8fd0\u8f93\u65f6\u95f4(h)</th></tr></thead>
          <tbody>${transportPolicies.map((row, index) => {
            const basePath = `transportPolicies.${index}`;
            const triggerControl = row.triggerMode === "\u5468\u671f\u6027\u8c03\u8fd0"
              ? `<label class="inline-field">\u8c03\u8fd0\u5468\u671f(h)${valueInput(`${basePath}.transferCycleHours`, "number", { min: "1", step: "1" })}</label>`
              : `<label class="inline-field">\u4e34\u754c\u5e93\u5b58\u6570${valueInput(`${basePath}.criticalInventory`, "number", { min: "0", step: "1" })}</label>`;
            return `
              <tr class="${selectedLogisticsTransportStrategyIndexes.has(index) ? "selected-table-row" : ""}">
                <td><input type="checkbox" data-logistics-transport-select="${index}" ${selectedLogisticsTransportStrategyIndexes.has(index) ? "checked" : ""} aria-label="\u9009\u62e9\u8fd0\u8f93\u7b56\u7565${index + 1}"${lockedAttr}></td>
                <td>${valueInput(`${basePath}.name`, "text")}</td>
                <td>${valueSelect(`${basePath}.direction`, directionOptions)}</td>
                <td>${valueSelect(`${basePath}.triggerMode`, triggerModeOptions)}</td>
                <td>${triggerControl}</td>
                <td>${valueSelect(`${basePath}.fromSupportNodeName`, supportNodeOptions)}</td>
                <td>${valueSelect(`${basePath}.toSupportNodeName`, supportNodeOptions)}</td>
                <td>${valueInput(`${basePath}.transportTimeHours`, "number", { min: "0", step: "0.1" })}</td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="8" class="muted">\u6682\u65e0\u8fd0\u8f93\u7b56\u7565</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function findLogisticsSupportActivity() {
  const activities = scenario.supportActivities || [];
  return activities.find((item) => item.activityType === "后勤保障")
    || activities.find((item) => item.planType === "后勤保障方案")
    || activities.find((item) => item.planType === "后勤保障活动方案");
}

function supportNodeName(id) {
  return scenario.supportNodes.find((node) => node.id === id)?.name || id || "-";
}

function spareModelingNames() {
  return Array.from(new Set(
    [
      ...(scenario.supportNodes || []).flatMap((node) => Object.keys(node.inventory || {})),
      ...(scenario.supportResources || [])
        .filter((resource) => String(resource?.type || "").toLowerCase() === "spare")
        .map((resource) => resource.name || resource.spareName || resource.spareType || resource.model || "")
    ].filter(Boolean)
  ));
}

function renderSupportActivityWorkbench(page) {
  const activity = ensureSupportActivityForPage(page);
  const activePlan = supportActivityPlanForPage(page, activity);
  const locked = currentModelingPageLocked(page);
  const lockedAttr = modelingLockDisabledAttr(locked);
  if (page.name.includes("基本保障活动")) {
    return `<div class="ship-front-workbench">${renderBasicActivityLibrary()}</div>`;
  }
  if (page.name.includes("修复性")) {
    return `<div class="ship-front-workbench">${renderCorrectiveMaintenanceActivity(activity)}</div>`;
  }
  if (page.name.includes("后勤")) {
    return `
      <div class="ship-front-workbench">
        <section class="detail-panel">
          ${renderLogisticsSupportActivity(activePlan, activity)}
        </section>
      </div>
    `;
  }
  const editor = page.name.includes("预防性")
    ? renderPreventiveMaintenanceActivity(activePlan, activity)
    : renderOperationsSupportActivity(activePlan, activity);
  const operationsEntries = operationsSupportActivityEntries();
  const selectedOperationsKey = selectedOperationsSupportActivityKey || "";
  const preventiveEntries = preventiveMaintenanceActivityEntries();
  const selectedPreventiveKey = selectedPreventiveMaintenanceActivityKey || "";
  return `
    <div class="ship-front-workbench">
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>${htmlEscape(activePlan.treeTitle)}</h4>
            <div class="equipment-toolbar">
              ${page.name.includes("使用") ? `<button type="button" class="btn-primary" data-support-activity-plan-add${lockedAttr}>新增节点</button><button type="button" class="btn-danger" data-support-activity-plan-delete="${htmlEscape(selectedOperationsKey)}" ${selectedOperationsKey && operationsEntries.length && !locked ? "" : "disabled"}>删除</button>` : ""}
              ${page.name.includes("预防性") ? `<button type="button" class="btn-primary" data-preventive-activity-plan-add${lockedAttr}>新增节点</button><button type="button" class="btn-danger" data-preventive-activity-plan-delete="${htmlEscape(selectedPreventiveKey)}" ${selectedPreventiveKey && preventiveEntries.length && !locked ? "" : "disabled"}>删除</button>` : ""}
            </div>
          </div>
          ${renderSupportActivityTreeNode(activePlan.tree, activePlan.path.at(-1))}
        </aside>
        <section class="detail-panel">
          ${editor}
        </section>
      </div>
    </div>
  `;
}

function renderSupportActivityTreeNode(node, selectedName) {
  return renderCollapsibleTreeNode(supportActivityTreeNode(node, selectedName));
}

function supportActivityTreeNode(node, selectedName) {
  const isEditablePlan = Boolean(node.editablePlanKey);
  const isSelectableAircraft = Boolean(node.selectableAircraftModel);
  const isEditablePreventivePlan = Boolean(node.editablePreventivePlanKey);
  const isSelectablePreventiveAircraft = Boolean(node.selectablePreventiveAircraftModel);
  return {
    id: `support-activity:${node.id || node.name}`,
    label: node.name,
    selected: isEditablePlan
      ? (node.editablePlanKey === selectedOperationsSupportActivityKey || (!selectedOperationsSupportActivityKey && node.name === selectedName))
      : isEditablePreventivePlan
        ? (node.editablePreventivePlanKey === selectedPreventiveMaintenanceActivityKey || (!selectedPreventiveMaintenanceActivityKey && node.name === selectedName))
      : isSelectableAircraft
        ? selectedOperationsSupportAircraftModel === node.selectableAircraftModel
        : isSelectablePreventiveAircraft
          ? selectedPreventiveMaintenanceAircraftModel === node.selectablePreventiveAircraftModel
        : node.name === selectedName,
    actionAttrs: isEditablePlan
      ? `data-select-support-activity-plan="${htmlEscape(node.editablePlanKey)}"`
      : isEditablePreventivePlan
        ? `data-select-preventive-activity-plan="${htmlEscape(node.editablePreventivePlanKey)}"`
      : isSelectableAircraft
        ? `data-select-operations-support-aircraft-model="${htmlEscape(node.selectableAircraftModel)}"`
        : isSelectablePreventiveAircraft
          ? `data-select-preventive-aircraft-model="${htmlEscape(node.selectablePreventiveAircraftModel)}"`
        : "",
    children: (node.children || []).map((child) => supportActivityTreeNode(child, selectedName))
  };
}

function renderExperimentPlanManagement(page) {
  return experimentPlanManagementMode === "editor"
    ? renderExperimentPlanEditor(page)
    : renderExperimentPlanList(page);
}

function renderExperimentPlanList(page) {
  ensureExperimentPlanListLoaded();
  const backendRows = backendExperimentPlans.map((plan) => experimentPlanRowFromBackend(plan, page));
  const fallbackRows = scenario.experiment?.name ? [{
    experiment_plan_id: "",
    selectionKey: experimentPlanSelectionKey({ name: scenario.experiment.name }),
    name: scenario.experiment.name,
    module: page.module,
    steps: scenario.experiment.steps,
    samples: scenario.experiment.samples,
    status: experimentRunStatus,
    run_count: 0
  }] : [];
  const plans = backendRows.length ? backendRows : fallbackRows;
  return `
    <div class="section-head">
      <h3>方案列表</h3>
      <span>${htmlEscape(experimentPlanListStatus)}</span>
    </div>
    <div class="toolbar-row">
      <button type="button" class="btn-primary" data-experiment-plan-add>新增</button>
      <button type="button" data-experiment-plan-refresh>刷新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>选择</th><th>方案名称</th><th>所属模块</th><th>步数</th><th>样本</th><th>关联运行</th><th>状态</th><th>方案动作</th></tr></thead>
        <tbody>
          ${plans.length ? plans.map((plan) => `
            <tr class="${selectedExperimentPlanKeys.has(plan.selectionKey) ? "selected-table-row" : ""}">
              <td><input type="checkbox" data-experiment-plan-select="${htmlEscape(plan.selectionKey)}" ${selectedExperimentPlanKeys.has(plan.selectionKey) ? "checked" : ""} aria-label="选择方案 ${htmlEscape(plan.name)}"></td>
              <td>${htmlEscape(plan.name)}</td>
              <td>${htmlEscape(plan.module)}</td>
              <td>${htmlEscape(plan.steps)}</td>
              <td>${htmlEscape(plan.samples)}</td>
              <td>${htmlEscape(plan.run_count ?? 0)}</td>
              <td><span class="badge">${htmlEscape(plan.status)}</span></td>
              <td class="table-action-cell">
                <button type="button" class="inline-action" data-experiment-plan-edit="${htmlEscape(plan.experiment_plan_id)}" data-experiment-plan-name="${htmlEscape(plan.name)}">编辑</button>
                <button type="button" class="btn-danger" data-experiment-plan-delete="${htmlEscape(plan.experiment_plan_id)}">删除</button>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="8">${importedDataEmptyState("仿真实验方案")}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function experimentPlanRowFromBackend(plan, page) {
  const config = plan?.config || {};
  const projectJson = config.projectJson || {};
  const latestRun = Array.isArray(plan.runs) && plan.runs.length ? plan.runs[0] : null;
  return {
    experiment_plan_id: plan.experiment_plan_id || "",
    selectionKey: experimentPlanSelectionKey(plan),
    name: config.name || projectJson.experiment?.name || plan.experiment_plan_id || "未命名方案",
    module: page.module,
    steps: config.steps ?? projectJson.experiment?.steps ?? "-",
    samples: config.samples ?? projectJson.experiment?.samples ?? "-",
    run_count: plan.run_count ?? (Array.isArray(plan.runs) ? plan.runs.length : 0),
    status: latestRun?.lifecycle_status === "deleted"
      ? "已清理"
      : (latestRun?.status || plan.status || "draft")
  };
}

function experimentPlanSelectionKey(plan) {
  const id = String(plan?.experiment_plan_id || "").trim();
  if (id) return id;
  return `local:${String(plan?.name || plan?.config?.name || plan?.config?.projectJson?.experiment?.name || "未命名方案").trim()}`;
}

function projectJsonHasExecutableModelingData(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return false;
  return Boolean(
    (Array.isArray(projectJson.basicMissions) && projectJson.basicMissions.length)
    || (Array.isArray(projectJson.components) && projectJson.components.length)
    || (Array.isArray(projectJson.supportNodes) && projectJson.supportNodes.length)
    || (Array.isArray(projectJson.supportResources) && projectJson.supportResources.length)
    || (Array.isArray(projectJson.supportActivities) && projectJson.supportActivities.length)
    || (Array.isArray(projectJson.combatUnit?.members) && projectJson.combatUnit.members.length)
    || Number(projectJson.missionProfile?.durationHours) > 0
  );
}

function projectDataJsonMatchesCurrentProject(projectJson) {
  if (!projectJson || typeof projectJson !== "object" || Array.isArray(projectJson)) return false;
  const backendProjectId = String(currentBackendProjectId() || "").trim();
  const projectJsonId = String(projectJson.project_id || "").trim();
  return Boolean(
    (selectedProjectDataProjectJsonId && selectedProjectDataProjectJsonId === projectDataProjectId(currentProject))
    || (backendProjectId && projectJsonId && projectJsonId === backendProjectId)
  );
}

function currentProjectJsonForExperimentContext() {
  if (projectJsonHasExecutableModelingData(scenario)) return scenario;
  if (
    selectedProjectDataProjectJson
    && projectDataJsonMatchesCurrentProject(selectedProjectDataProjectJson)
    && projectJsonHasExecutableModelingData(selectedProjectDataProjectJson)
  ) {
    return selectedProjectDataProjectJson;
  }
  return scenario;
}

function experimentPlanContextOptions(page = getFeaturePageById(selectedFeatureId)) {
  const currentProjectJson = currentProjectJsonForExperimentContext();
  const projectName = String(currentProjectJson.projectInfo?.name || currentProject?.name || currentProjectJson.experiment?.name || "未选择项目").trim();
  const currentProjectOption = {
    key: `current-project:${String(currentBackendProjectId() || currentProject?.id || "none").trim()}`,
    name: `当前项目：${projectName || "未选择项目"}`,
    kind: "current-project",
    plan: null,
    projectJson: buildBackendProjectJson(currentProjectJson, currentProject),
    module: page.module
  };
  const backendOptions = backendExperimentPlans.filter((plan) => String(plan?.experiment_plan_id || "").trim()).map((plan) => {
    const config = plan?.config || {};
    const projectJson = config.projectJson && typeof config.projectJson === "object" && !Array.isArray(config.projectJson)
      ? config.projectJson
      : null;
    return {
      key: experimentPlanSelectionKey(plan),
      name: config.name || projectJson?.experiment?.name || plan.experiment_plan_id || "未命名方案",
      kind: "experiment-plan",
      plan,
      projectJson,
      module: page.module
    };
  });
  return [currentProjectOption, ...backendOptions];
}

function selectedExperimentPlanContextKey(options = experimentPlanContextOptions()) {
  const validKeys = new Set(options.map((option) => option.key));
  if (validKeys.has(selectedRunContextKey)) return selectedRunContextKey;
  return options.find((option) => option.kind === "current-project")?.key || options[0]?.key || "";
}

function selectedExperimentPlanContext(options = experimentPlanContextOptions()) {
  const selectedKey = selectedExperimentPlanContextKey(options);
  return options.find((option) => option.key === selectedKey) || options[0] || null;
}

function selectedExperimentPlanName() {
  return selectedExperimentPlanContext()?.name || currentContextSummary().name;
}

function selectedRunContextLabel() {
  return selectedExperimentPlanContext()?.kind === "experiment-plan" ? "实验方案" : "当前项目";
}

function selectedExperimentPlanProjectJson() {
  const context = selectedExperimentPlanContext();
  const source = context?.projectJson && typeof context.projectJson === "object" && !Array.isArray(context.projectJson)
    ? context.projectJson
    : (context?.kind === "current-project" ? currentProjectJsonForExperimentContext() : {});
  return buildBackendProjectJson(source, currentProject);
}

async function resolveSelectedExperimentPlanProjectJsonForRun() {
  const context = selectedExperimentPlanContext();
  const projectJson = selectedExperimentPlanProjectJson();
  if (projectJsonHasExecutableModelingData(projectJson)) return projectJson;
  if (context?.kind !== "current-project") return projectJson;
  const projectId = currentBackendProjectId();
  if (!projectId) return projectJson;
  const hydratedProjectJson = normalizeProjectJsonForClientDraft(await backendApi.getProject(projectId));
  scenario = cloneScenario(hydratedProjectJson);
  if (!experimentPlanBranchActive) {
    experimentPlanDraft = cloneScenario(hydratedProjectJson);
  }
  return buildBackendProjectJson(hydratedProjectJson, currentProject);
}

async function saveSelectedProjectJsonForSolaraVisualization() {
  const projectJson = await resolveSelectedExperimentPlanProjectJsonForRun();
  const saved = await backendApi.saveProject(projectJson);
  savedProject = saved || savedProject;
  solaraVisualizationProjectIdOverride = String(saved?.project_id || projectJson.project_id || currentBackendProjectId() || "").trim();
  projectDraftSaveStatus = "已保存";
  projectDraftLastSavedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  return saved;
}

function selectedExperimentPlanRunSettings() {
  const context = selectedExperimentPlanContext();
  const config = context?.plan?.config && typeof context.plan.config === "object" && !Array.isArray(context.plan.config)
    ? context.plan.config
    : {};
  const projectJson = context?.projectJson && typeof context.projectJson === "object" && !Array.isArray(context.projectJson)
    ? context.projectJson
    : {};
  const experiment = projectJson.experiment && typeof projectJson.experiment === "object" && !Array.isArray(projectJson.experiment)
    ? projectJson.experiment
    : {};
  const samples = positiveExperimentNumber(config.samples, positiveExperimentNumber(experiment.samples, 0));
  const seed = positiveExperimentNumber(config.seed, positiveExperimentNumber(experiment.seed, 0));
  return {
    ...(samples > 0 ? { samples: Math.max(1, Math.min(1000, Math.trunc(samples))) } : {}),
    ...(seed > 0 ? { seed: Math.trunc(seed) } : {})
  };
}

function resetRunContextToCurrentProject() {
  selectedRunContextKey = "";
  const projectJson = currentProjectJsonForExperimentContext();
  const experiment = projectJson?.experiment && typeof projectJson.experiment === "object" && !Array.isArray(projectJson.experiment)
    ? projectJson.experiment
    : {};
  const samples = positiveExperimentNumber(experiment.samples, 0);
  const seed = positiveExperimentNumber(experiment.seed, 0);
  liteMesaMonteCarloSettings = {
    samples: samples > 0 ? Math.max(1, Math.min(1000, Math.trunc(samples))) : 4,
    seed: seed > 0 ? Math.trunc(seed) : 20260621
  };
  liteMesaMonteCarloResult = null;
  liteMesaAnalysisResults = {};
  liteMesaMonteCarloStatus = "已切换运行来源：当前项目";
}

function resetMissingRunContextAfterPlanRefresh() {
  if (!selectedRunContextKey || selectedRunContextKey.startsWith("current-project:")) return;
  const selectedPlanStillExists = backendExperimentPlans.some((plan) => (
    String(plan?.experiment_plan_id || "").trim() === selectedRunContextKey
  ));
  if (!selectedPlanStillExists) resetRunContextToCurrentProject();
}

function selectCurrentExperimentPlan(planKey) {
  const options = experimentPlanContextOptions();
  const selected = options.find((option) => option.key === planKey) || options[0];
  if (!selected) return;
  selectedRunContextKey = selected.key;
  liteMesaMonteCarloResult = null;
  liteMesaMonteCarloStatus = selected.kind === "experiment-plan"
    ? `已绑定实验方案：${selected.name}`
    : `已切换运行来源：${selected.name}`;
  liteMesaAnalysisResults = {};
  const planRunSettings = selectedExperimentPlanRunSettings();
  liteMesaMonteCarloSettings = {
    samples: Number(planRunSettings.samples) > 0 ? Number(planRunSettings.samples) : 4,
    seed: Number(planRunSettings.seed) > 0 ? Number(planRunSettings.seed) : 20260621
  };
}

function toggleExperimentPlanSelection(planKey, checked) {
  if (!planKey) return;
  const next = new Set(selectedExperimentPlanKeys);
  if (checked) next.add(planKey);
  else next.delete(planKey);
  selectedExperimentPlanKeys = next;
}

function openNewExperimentPlanEditor() {
  experimentPlanManagementMode = "editor";
  experimentPlan = null;
  experimentPlanBranchActive = false;
  createExperimentPlanBranchFromCurrentProject();
  selectedExperimentPlanKeys = new Set();
}

function openExperimentPlanEditorFromList(experimentPlanId, planName) {
  experimentPlanManagementMode = "editor";
  const backendPlan = backendExperimentPlans.find((plan) => plan.experiment_plan_id === experimentPlanId);
  const branchDraft = experimentPlanDraftFromBackendPlan(backendPlan);
  if (branchDraft) {
    experimentPlanDraft = branchDraft;
    experimentPlanBranchActive = true;
    experimentPlan = backendPlan;
  } else {
    createExperimentPlanBranchFromCurrentProject();
  }
  selectedExperimentPlanKeys = new Set([experimentPlanSelectionKey({ experiment_plan_id: experimentPlanId, name: planName })]);
  updatePreviewResultsThroughApiClient(experimentPlanDraft);
}

function experimentPlanDraftFromBackendPlan(backendPlan) {
  const config = backendPlan?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const branchProjectJson = config.projectJson && typeof config.projectJson === "object" && !Array.isArray(config.projectJson)
    ? config.projectJson
    : scenario;
  const draft = cloneScenario(branchProjectJson);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  if (!draft.experiment || typeof draft.experiment !== "object" || Array.isArray(draft.experiment)) {
    draft.experiment = {};
  }
  if (config.name !== undefined) draft.experiment.name = config.name;
  if (config.steps !== undefined) draft.experiment.steps = config.steps;
  if (config.samples !== undefined) draft.experiment.samples = config.samples;
  if (config.seed !== undefined) draft.experiment.seed = config.seed;
  if (config.parallelCores !== undefined) draft.experiment.parallelCores = config.parallelCores;
  if (config.stopCondition !== undefined) draft.experiment.stopCondition = config.stopCondition;
  if (config.seedPolicy && typeof config.seedPolicy === "object" && !Array.isArray(config.seedPolicy)) {
    draft.seedPolicy = cloneScenario(config.seedPolicy);
  } else if (config.seed !== undefined) {
    draft.seedPolicy = { mode: "fixed", baseSeed: config.seed };
  }
  if (config.stopPolicy && typeof config.stopPolicy === "object" && !Array.isArray(config.stopPolicy)) {
    draft.stopPolicy = cloneScenario(config.stopPolicy);
  }
  if (config.scenarioComposition && typeof config.scenarioComposition === "object" && !Array.isArray(config.scenarioComposition)) {
    draft.scenarioComposition = cloneScenario(config.scenarioComposition);
  }
  if (config.analysisRequests && typeof config.analysisRequests === "object" && !Array.isArray(config.analysisRequests)) {
    draft.analysisRequests = cloneScenario(config.analysisRequests);
  }
  if (config.monteCarlo && typeof config.monteCarlo === "object" && !Array.isArray(config.monteCarlo)) {
    draft.monteCarlo = cloneScenario(config.monteCarlo);
  }
  return ensureExperimentPlanDraftDefaults(draft);
}

function renderExperimentPlanEditor(page) {
  const seedPolicy = experimentPlanSeedPolicy();
  const stopPolicy = experimentPlanStopPolicy();
  return `
    <div class="section-head">
      <h3>方案编辑</h3>
      <span>基本信息、运行配置与分析配置</span>
    </div>
    <div class="section-head sub-section-head"><h3>基本信息</h3><span>方案标识与说明</span></div>
    <div class="form-table-grid">
      ${experimentPlanField("实验名称", "experiment.name")}
      ${experimentPlanField("样本数", "experiment.samples", "number")}
      ${experimentPlanField("并行核心数", "experiment.parallelCores", "number")}
    </div>
    <div class="section-head sub-section-head">
      <h3>运行配置</h3>
      <span>${seedPolicy.mode === "random" ? "生成方案时固化随机 base seed" : "固定 base seed 可复现"}</span>
    </div>
    <div class="form-table-grid">
      <label>种子模式
        <select data-experiment-seed-policy>
          <option value="fixed" ${seedPolicy.mode === "fixed" ? "selected" : ""}>固定</option>
          <option value="random" ${seedPolicy.mode === "random" ? "selected" : ""}>随机</option>
        </select>
      </label>
      <label>Base seed<input data-experiment-seed-base type="number" step="1" value="${htmlEscape(seedPolicy.baseSeed)}"></label>
    </div>
    ${renderExperimentStopPolicyControls(stopPolicy)}
    <div class="section-head sub-section-head">
      <h3>分析配置</h3>
      <span>分析项沿用实验方案的独立配置，不写回 Project JSON</span>
    </div>
    <div class="alert info">
      任务可靠性、备件规划、停机因素等分析项在运行后按结果页配置展示。
    </div>
    <div class="plan-editor-actions">
      <button type="button" data-plan-list-link>返回方案列表</button>
      <button type="button" class="btn-primary" data-save-plan>保存方案</button>
    </div>
  `;
}

function renderExperimentStopPolicyControls(stopPolicy) {
  const conditions = new Set(stopPolicy.conditions.map((condition) => normalizedExperimentStopConditionType(condition.type)));
  const specifiedTime = stopPolicy.conditions.find((condition) => normalizedExperimentStopConditionType(condition.type) === "specifiedTime");
  const specifiedMinute = positiveExperimentStopMinute(specifiedTime?.minute ?? 1440);
  return `
    <div class="section-head sub-section-head">
      <h3>停止策略</h3>
      <span>${stopPolicy.mode === "and" ? "全部选中条件满足后停止" : "满足任一选中条件即停止"}</span>
    </div>
    <div class="form-table-grid">
      <label>组合方式
        <select data-experiment-stop-mode>
          <option value="or" ${stopPolicy.mode === "or" ? "selected" : ""}>任一 OR</option>
          <option value="and" ${stopPolicy.mode === "and" ? "selected" : ""}>全部 AND</option>
        </select>
      </label>
      <label><input data-experiment-stop-condition="duration" type="checkbox" ${conditions.has("duration") ? "checked" : ""}> 达到任务时长</label>
      <label><input data-experiment-stop-condition="failure" type="checkbox" ${conditions.has("failure") ? "checked" : ""}> 任务失败</label>
      <label><input data-experiment-stop-condition="specifiedTime" type="checkbox" ${conditions.has("specifiedTime") ? "checked" : ""}> 达到指定时间</label>
      <label>停止分钟<input data-experiment-stop-time-minute type="number" min="1" step="1" value="${htmlEscape(specifiedMinute)}" ${conditions.has("specifiedTime") ? "" : "disabled"}></label>
    </div>
  `;
}

const SCENARIO_TOP_LEVEL_LABELS = Object.freeze({
  activeModule: "当前模块",
  aircraftTypes: "飞机类型对象",
  airports: "机场清单对象",
  analysisRequests: "分析请求对象",
  basicMissions: "基本任务清单对象",
  combatUnit: "作战单元对象",
  combatUnits: "作战单元清单对象",
  components: "装备部件清单对象",
  compositeTasks: "复合任务清单对象",
  equipment: "装备系统对象",
  experiment: "实验参数对象",
  missionPhases: "任务阶段清单对象",
  missionProfile: "任务剖面对象",
  modelingDictionaries: "建模字典对象",
  monteCarlo: "蒙特卡洛设置对象",
  objects: "对象集合",
  projectInfo: "项目信息对象",
  scenarioComposition: "方案拼接对象",
  scenarioId: "场景编号",
  seedPolicy: "随机种子策略对象",
  stopPolicy: "停止策略对象",
  supportActivities: "保障活动清单对象",
  supportNodes: "保障点清单对象",
  supportOrganization: "保障组织对象",
  supportResources: "保障资源清单对象"
});

const SCENARIO_FIELD_LABELS = Object.freeze({
  activityCode: "活动编号",
  activityName: "活动名称",
  activityType: "活动类型",
  airport: "机场",
  aircraftModel: "飞机型号",
  aircraftTypes: "飞机类型",
  baseCode: "基础代码",
  baseProjectVersion: "基础项目版本",
  basicTaskName: "基本任务名称",
  capacity: "容量",
  compositeTasks: "复合任务",
  constraints: "约束条件",
  durationHours: "持续时间(h)",
  equipmentCapacity: "设备容量",
  equipmentType: "装备类型",
  failureRate: "故障率",
  id: "编号",
  inventory: "库存",
  jobs: "作业",
  meanRepairTimeMinutes: "平均修复时间(min)",
  members: "成员",
  minRequiredSorties: "最低出动架次",
  missionId: "任务编号",
  model: "型号",
  mode: "模式",
  name: "名称",
  parallelCores: "并行核心数",
  personnelCapacity: "人员容量",
  planType: "方案类型",
  project_id: "项目编号",
  project_version: "项目版本",
  projectInfo: "项目信息",
  quantity: "数量",
  repeatCycleHours: "重复周期(h)",
  sampleCount: "样本数",
  samples: "样本数",
  scenarioId: "场景编号",
  schemaVersion: "模式版本",
  schema_version: "模式版本",
  seed: "随机种子",
  sourceImportId: "来源导入编号",
  sourceProjectId: "来源项目编号",
  specialty: "专业",
  steps: "仿真步数",
  stopCondition: "停止条件",
  summary: "摘要",
  supportNodeId: "保障点编号",
  taskDurationMinutes: "任务持续时间(min)",
  type: "类型",
  value: "值",
  wholeMachineModels: "整机型号"
});

const SCENARIO_ARRAY_ITEM_LABELS = Object.freeze({
  aircraftTypes: "飞机类型",
  airports: "机场",
  basicMissions: "基本任务",
  combatUnits: "作战单元",
  components: "装备部件",
  compositeTasks: "复合任务",
  jobs: "作业",
  members: "成员",
  missionPhases: "任务阶段",
  periodicTasks: "周期性任务",
  supportActivities: "保障活动",
  supportNodes: "保障点",
  supportResources: "保障资源",
  transportPolicies: "运输策略"
});

function normalizedSelectedScenarioCompositionPath(projectJson, composition) {
  if (isScenarioLeafPath(projectJson, selectedScenarioCompositionPath)) return selectedScenarioCompositionPath;
  const firstOverridePath = (composition.overrides || []).find((override) => isScenarioLeafPath(projectJson, override.path))?.path || "";
  selectedScenarioCompositionPath = firstOverridePath;
  return selectedScenarioCompositionPath;
}

function isScenarioLeafPath(projectJson, path) {
  if (!path) return false;
  const value = projectPathValue(projectJson, path);
  return value !== undefined && (value === null || typeof value !== "object");
}

function renderScenarioModelingDataTree(projectJson, selectedPath) {
  const nodes = Object.entries(projectJson || {})
    .filter(([key]) => !["schema_version", "project_version"].includes(key))
    .map(([key, value]) => scenarioModelingDataTreeNode(value, key, scenarioTopLevelLabel(key), key, selectedPath, 0));
  return nodes.length
    ? renderCollapsibleTree(nodes, { className: "scenario-modeling-data-tree" })
    : `<div class="empty-state"><strong>暂无建模数据</strong></div>`;
}

function scenarioModelingDataTreeNode(value, path, label, rawKey, selectedPath, depth) {
  const nodeId = `scenario-modeling:${path}`;
  if (value === null || typeof value !== "object") {
    return {
      id: nodeId,
      label,
      meta: scenarioModelingValueText(value),
      selected: path === selectedPath,
      actionAttrs: `data-scenario-modeling-path="${htmlEscape(path)}"`
    };
  }
  if (Array.isArray(value)) {
    const itemLabel = SCENARIO_ARRAY_ITEM_LABELS[rawKey] || "项目";
    return {
      id: nodeId,
      label,
      meta: `${value.length} 项`,
      root: depth === 0,
      children: value.slice(0, 80).map((item, index) => scenarioModelingDataTreeNode(
        item,
        `${path}.${index}`,
        `${itemLabel} ${index + 1}`,
        rawKey,
        selectedPath,
        depth + 1
      ))
    };
  }
  const entries = Object.entries(value).filter(([key]) => !["schema_version", "project_version"].includes(key));
  return {
    id: nodeId,
    label,
    meta: scenarioObjectMeta(value, entries.length),
    root: depth === 0,
    children: entries.map(([key, child]) => scenarioModelingDataTreeNode(
      child,
      `${path}.${key}`,
      scenarioFieldLabelForPath(`${path}.${key}`, key),
      key,
      selectedPath,
      depth + 1
    ))
  };
}

function scenarioTopLevelLabel(key) {
  return SCENARIO_TOP_LEVEL_LABELS[key] || `${scenarioFieldLabel(key)}对象`;
}

function scenarioFieldLabel(key) {
  return SCENARIO_FIELD_LABELS[key] || key;
}

function scenarioFieldLabelForPath(path, key) {
  const contextLabels = {
    "experiment.name": "实验名称",
    "missionProfile.name": "任务剖面名称",
    "projectInfo.name": "项目名称"
  };
  return contextLabels[path] || scenarioFieldLabel(key);
}

function scenarioObjectMeta(value, childCount) {
  const name = String(value?.name || value?.activityName || value?.basicTaskName || value?.id || "").trim();
  return name || `${childCount} 项`;
}

function scenarioModelingValueText(value) {
  if (value === null) return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  const text = String(value);
  return text.length > 36 ? `${text.slice(0, 36)}...` : text;
}

function scenarioOverrideEditorContext(projectJson, path) {
  if (!isScenarioLeafPath(projectJson, path)) return null;
  const composition = scenarioCompositionDraft();
  const override = (composition.overrides || []).find((item) => item.path === path) || null;
  const originalValue = projectPathValue(projectJson, path);
  return {
    path,
    label: scenarioPathDisplayLabel(projectJson, path),
    originalValue,
    override,
    valueType: override?.valueType || inferScenarioOverrideValueType(originalValue),
    value: override ? override.value : scenarioOverrideInputValue(originalValue)
  };
}

function renderSelectedScenarioOverrideEditor(context) {
  if (!context) {
    return `
      <section class="scenario-selected-override-card">
        <div class="section-head">
          <h3>选中属性</h3>
          <span>等待点选</span>
        </div>
        <div class="empty-state"><strong>请选择左侧属性叶子节点</strong></div>
      </section>
    `;
  }
  return `
    <section class="scenario-selected-override-card">
      <div class="section-head">
        <h3>选中属性</h3>
        <span>${htmlEscape(context.label)}</span>
      </div>
      <div class="form-table-grid scenario-selected-override-grid">
        <label>属性
          <input value="${htmlEscape(context.label)}" readonly>
        </label>
        <label>类型
          <select data-scenario-selected-override-value-type data-scenario-selected-override-path="${htmlEscape(context.path)}">
            ${["string", "number", "boolean", "json"].map((type) => `<option value="${type}" ${context.valueType === type ? "selected" : ""}>${scenarioValueTypeLabel(type)}</option>`).join("")}
          </select>
        </label>
        <label>当前值
          <input value="${htmlEscape(scenarioOverrideInputValue(context.originalValue))}" readonly>
        </label>
        <label>替换值
          <input data-scenario-selected-override-value data-scenario-selected-override-path="${htmlEscape(context.path)}" value="${htmlEscape(context.value ?? "")}">
        </label>
      </div>
    </section>
  `;
}

function scenarioValueTypeLabel(type) {
  return {
    string: "文本",
    number: "数值",
    boolean: "布尔",
    json: "JSON"
  }[type] || type;
}

function scenarioOverrideInputValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function inferScenarioOverrideValueType(value) {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "json";
  return "string";
}

function scenarioPathDisplayLabel(projectJson, path) {
  const segments = String(path || "").split(".").filter(Boolean);
  const labels = [];
  let current = projectJson;
  let parentKey = "";
  let currentPath = "";
  segments.forEach((segment, index) => {
    currentPath = currentPath ? `${currentPath}.${segment}` : segment;
    if (/^\d+$/.test(segment)) {
      const itemLabel = SCENARIO_ARRAY_ITEM_LABELS[parentKey] || "项目";
      labels.push(`${itemLabel} ${Number(segment) + 1}`);
    } else {
      labels.push(index === 0 ? scenarioTopLevelLabel(segment) : scenarioFieldLabelForPath(currentPath, segment));
      parentKey = segment;
    }
    current = projectPathValue(projectJson, currentPath);
  });
  return labels.join(" / ");
}

function upsertScenarioOverrideForPath(path, projectJson) {
  const composition = scenarioCompositionDraft();
  const overrides = composition.overrides;
  let override = overrides.find((item) => item.path === path);
  const originalValue = projectPathValue(projectJson, path);
  if (!override) {
    override = {
      path,
      valueType: inferScenarioOverrideValueType(originalValue),
      value: scenarioOverrideInputValue(originalValue),
      label: scenarioPathDisplayLabel(projectJson, path)
    };
    overrides.push(override);
  }
  override.label = scenarioPathDisplayLabel(projectJson, path);
  return override;
}

function renderScenarioOverrideRow(override, index) {
  const valueType = override.valueType || "string";
  return `
    <tr>
      <td><input list="scenario-override-path-options" data-scenario-override-path data-scenario-override-index="${index}" value="${htmlEscape(override.path || "")}" placeholder="supportResources.0.quantity"></td>
      <td>
        <select data-scenario-override-value-type data-scenario-override-index="${index}">
          ${["string", "number", "boolean", "json"].map((type) => `<option value="${type}" ${valueType === type ? "selected" : ""}>${type}</option>`).join("")}
        </select>
      </td>
      <td><input data-scenario-override-value data-scenario-override-index="${index}" value="${htmlEscape(override.value ?? "")}"></td>
      <td><input data-scenario-override-label data-scenario-override-index="${index}" value="${htmlEscape(override.label || "")}"></td>
      <td><button type="button" class="btn-danger" data-scenario-override-remove="${index}">删除</button></td>
    </tr>
  `;
}

function scenarioCompositionSourceProjectJson() {
  return buildBackendProjectJson(scenario, currentProject);
}

function scenarioOverrideParameterOptions(projectJson) {
  const options = [];
  collectScenarioOverrideParameterOptions(projectJson, "", options);
  const preferred = [
    "experiment.samples",
    "experiment.seed",
    "supportResources.0.quantity",
    "supportResources.0.supportNodeName",
    "transportPolicies.0.transportTimeHours",
    "components.0.failureRate",
    "components.0.meanRepairTimeMinutes",
    "basicMissions.0.minRequiredSorties"
  ];
  const seen = new Set(options.map((option) => option.path));
  for (const path of preferred) {
    if (!seen.has(path)) options.unshift({ path, label: path });
  }
  return options.slice(0, 160);
}

function collectScenarioOverrideParameterOptions(value, path, options) {
  if (options.length >= 160) return;
  if (value === null || value === undefined) return;
  if (typeof value !== "object") {
    if (path) options.push({ path, label: `${path} = ${String(value).slice(0, 32)}` });
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item, index) => {
      collectScenarioOverrideParameterOptions(item, path ? `${path}.${index}` : String(index), options);
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["schema_version", "project_version"].includes(key)) continue;
    collectScenarioOverrideParameterOptions(child, path ? `${path}.${key}` : key, options);
    if (options.length >= 160) return;
  }
}

function experimentPlanField(label, path, type = "text") {
  return `<label>${label}<input data-experiment-plan-path="${path}" type="${type}" value="${htmlEscape(getPath(experimentPlanDraft, path))}"></label>`;
}

async function handleLogin() {
  const username = app.querySelector("[data-login-username]")?.value?.trim() || "user";
  const password = app.querySelector("[data-login-password]")?.value || username;
  try {
    const session = await backendApi.login(username, password);
    backendAuthToken = session.session.token;
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    currentUser = {
      username: session.user.username,
      role: session.user.role
    };
    backendApiStatus = "M4 会话已建立";
    await hydrateProjectCatalogFromBackend();
  } catch (err) {
    if (err?.code === "invalid_credentials" || err?.code === "forbidden") {
      backendApiStatus = `登录失败：${err.message}`;
      return;
    }
    backendAuthToken = "";
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    currentUser = DEMO_USERS.find((user) => user.username === username) || DEMO_USERS[2];
    backendApiStatus = `离线演示：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
  isLoggedIn = true;
  selectedRoute = "projects";
  location.hash = "route=projects";
}

async function restoreStoredBackendSessionOnBoot() {
  if (!backendAuthToken) return;
  try {
    const session = await backendApi.getSession();
    const user = session?.user || {};
    currentUser = {
      username: user.username || currentUser.username,
      role: user.role || currentUser.role
    };
    isLoggedIn = true;
    if (selectedRoute === DEFAULT_ROUTE) {
      selectedRoute = "projects";
      location.hash = "route=projects";
    }
    backendApiStatus = "M4 会话已恢复";
    await hydrateProjectCatalogFromBackend();
    if (selectedRoute === "workbench" && currentProject) {
      await hydrateCurrentProjectDraftFromApi();
    }
  } catch (err) {
    backendAuthToken = "";
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    backendApiStatus = `会话恢复失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
  render();
}

async function saveCurrentProjectThroughApi() {
  return saveCurrentProjectDraftThroughApi();
}

async function handleEnterWorkbench(projectId) {
  await flushPendingProjectDraftAutosave();
  currentProject = demoProjects.find((project) => project.id === projectId) || demoProjects[0];
  if (!currentProject) {
    projectListStatus = "请先选择项目模板创建项目";
    selectedRoute = "projects";
    location.hash = "route=projects";
    return;
  }
  isLoggedIn = true;
  selectedRoute = "workbench";
  selectedFeatureId = defaultFeaturePageIdForCurrentUser();
  isProjectMenuOpen = false;
  backendExperimentPlans = [];
  backendExperimentPlansProjectId = "";
  backendExperimentPlansLoaded = false;
  backendExperimentPlansLoadInFlight = false;
  experimentPlanListStatus = "仿真实验方案列表尚未加载";
  selectedExperimentPlanKeys = new Set();
  selectedRunContextKey = "";
  experimentPlan = null;
  liteMesaMonteCarloResult = null;
  liteMesaAnalysisResults = {};
  liteMesaMonteCarloStatus = "项目已切换，请重新运行 Mesa 分析。";
  location.hash = `feature=${selectedFeatureId}`;
  projectDraftHydrateStatus = "正在读取 Project draft";
  await hydrateCurrentProjectDraftFromApi();
  resetRunContextToCurrentProject();
}

async function createProjectFromSelectedProjectTemplate() {
  const templateProject = selectedProjectTemplateProject();
  if (!templateProject) {
    projectListStatus = "暂无项目模板，请先在项目数据管理设为模板";
    return null;
  }
  return createProjectFromProjectTemplate(templateProject);
}

async function createProjectFromProjectTemplate(templateProject) {
  try {
    const templateProjectId = projectDataProjectBackendId(templateProject);
    projectListStatus = `正在从项目模板创建项目：${templateProject.name || templateProjectId}`;
    const templateProjectJson = await backendApi.getProject(templateProjectId);
    const { projectJson, project } = buildProjectCopyFromTemplateJson(templateProjectJson, templateProject);
    const saved = await backendApi.saveProject(projectJson);
    demoProjects = mergeProjectsById([project, ...demoProjects]);
    currentProject = project;
    scenario = cloneScenario(projectJson);
    experimentPlanDraft = cloneScenario(projectJson);
    experimentPlanBranchActive = false;
    resetRunContextToCurrentProject();
    backendExperimentPlans = [];
    backendExperimentPlansProjectId = "";
    backendExperimentPlansLoaded = false;
    backendExperimentPlansLoadInFlight = false;
    experimentPlanListStatus = "仿真实验方案列表尚未加载";
    savedProject = saved || { project_id: projectJson.project_id, project_version: projectJson.project_version || "project-v0.1" };
    modelingSnapshot = null;
    await hydrateProjectCatalogFromBackend({ forceProjectId: project.id });
    currentProject = demoProjects.find((entry) => entry.id === project.id) || project;
    projectListStatus = `已从项目模板创建项目：${project.name}`;
    projectDraftSaveStatus = "已保存";
    projectDraftHydrateStatus = "项目来自 Project 模板";
    updatePreviewResultsThroughApiClient();
    return project;
  } catch (err) {
    projectListStatus = `项目模板创建失败：${err && err.message ? err.message : "Backend API 不可用"}`;
    return null;
  }
}

function buildProjectCopyFromTemplateJson(templateProjectJson, templateProject) {
  const normalizedTemplateProjectJson = normalizeProjectJsonBasicMissions(cloneScenario(templateProjectJson));
  const copyNumber = nextProjectTemplateCopyNumber(templateProject);
  const baseProjectId = String(normalizedTemplateProjectJson.project_id || projectDataProjectBackendId(templateProject));
  const projectId = uniqueProjectTemplateCopyBackendId(baseProjectId, copyNumber);
  const resolvedCopyNumber = projectIdCopyNumber(projectId) || copyNumber;
  const baseScenarioId = String(normalizedTemplateProjectJson.scenarioId || `${baseProjectId}-scenario`);
  const projectName = `${templateProject.name || normalizedTemplateProjectJson.projectInfo?.name || normalizedTemplateProjectJson.experiment?.name || "未命名项目"} 副本 ${resolvedCopyNumber}`;
  const projectJson = {
    ...normalizedTemplateProjectJson,
    project_id: projectId,
    scenarioId: uniqueProjectTemplateCopyScenarioId(baseScenarioId, resolvedCopyNumber),
    isTemplate: false,
    is_template: false,
    projectTemplate: false,
    template: false,
    metadata: {
      ...(normalizedTemplateProjectJson.metadata || {}),
      isTemplate: false
    },
    experiment: {
      ...(normalizedTemplateProjectJson.experiment || {}),
      name: projectName
    },
    projectInfo: {
      ...(normalizedTemplateProjectJson.projectInfo || {}),
      name: projectName,
      baseCode: normalizedTemplateProjectJson.projectInfo?.baseCode || templateProject.baseCode || "NB",
      summary: `由项目模板 ${templateProject.name || baseProjectId} 创建`,
      isTemplate: false,
      is_template: false
    }
  };
  const project = {
    id: projectId.replace(/^project-/, ""),
    name: projectName,
    baseCode: projectJson.projectInfo.baseCode,
    updatedAt: new Date().toISOString().slice(0, 10),
    summary: projectJson.projectInfo.summary,
    sourceKind: PROJECT_SOURCE.imported_sample,
    sourceImportId: projectJson.missionProfile?.sourceImportId || projectDataTemplateSourceImportId(templateProject),
    isTemplate: false,
    projectBackendId: projectId
  };
  return { projectJson, project };
}

function nextProjectTemplateCopyNumber(templateProject) {
  const baseProjectId = projectDataProjectBackendId(templateProject);
  let copyNumber = 2;
  while (projectCatalogBackendIds().has(`${baseProjectId}-copy-${copyNumber}`)) {
    copyNumber += 1;
  }
  return copyNumber;
}

function uniqueProjectTemplateCopyBackendId(baseProjectId, copyNumber) {
  let candidateNumber = copyNumber;
  let projectId = `${baseProjectId}-copy-${candidateNumber}`;
  const existingIds = projectCatalogBackendIds();
  while (existingIds.has(projectId)) {
    candidateNumber += 1;
    projectId = `${baseProjectId}-copy-${candidateNumber}`;
  }
  return projectId;
}

function uniqueProjectTemplateCopyScenarioId(baseScenarioId, copyNumber) {
  return `${baseScenarioId}-copy-${copyNumber}`;
}

function projectIdCopyNumber(projectId) {
  const match = String(projectId || "").match(/-copy-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function projectCatalogBackendIds() {
  return new Set(demoProjects.map((project) => projectDataProjectBackendId(project)));
}

async function createSampleProjectFromPublishedImport(importId = currentPublishedModelingImportId()) {
  try {
    const sampleFixture = await loadSampleModelingImportFixture();
    projectListStatus = importId
      ? "正在从已发布导入数据生成示例项目"
      : "正在保存并发布示例导入包";
    const published = await ensurePublishedModelingImportForSampleProject({
      backendApi,
      fixture: sampleFixture,
      publishedImportId: importId
    });
    const resolvedImportId = published.importId;
    if (published.publishedPackage) {
      modelingImportPublishedPackage = published.publishedPackage;
    }
    projectListStatus = "正在从已发布导入数据生成示例项目";
    const created = await backendApi.createProjectFromModelingImport(resolvedImportId);
    const projectJson = created.project || {};
    const projectId = projectJson.project_id || created.savedProject?.project_id || sampleFixture.projectId;
    const project = {
      id: String(projectId || "imported-sample").replace(/^project-/, ""),
      name: projectJson.experiment?.name || "导入示例项目",
      baseCode: projectId || "imported-sample",
      updatedAt: new Date().toISOString().slice(0, 10),
      summary: `由导入包 ${created.sourceImport?.import_id || resolvedImportId} 生成`,
      sourceKind: PROJECT_SOURCE.imported_sample,
      sourceImportId: created.sourceImport?.import_id || resolvedImportId
    };
    demoProjects = mergeProjectsById([project, ...demoProjects]);
    currentProject = project;
    scenario = cloneScenario(projectJson);
    experimentPlanDraft = cloneScenario(scenario);
    experimentPlanBranchActive = false;
    resetRunContextToCurrentProject();
    savedProject = created.savedProject || null;
    modelingSnapshot = created.modelingSnapshot || null;
    projectListStatus = `已从导入数据生成示例项目：${project.name}；可用于正式后端测试`;
    await hydrateProjectCatalogFromBackend({ forceProjectId: project.id });
    currentProject = demoProjects.find((entry) => entry.id === project.id) || project;
    projectDraftSaveStatus = "已保存";
    projectDraftHydrateStatus = "示例项目来自已发布建模导入包";
    updatePreviewResultsThroughApiClient();
    return project;
  } catch (err) {
    projectListStatus = `导入示例项目生成失败：${err && err.message ? err.message : "Backend API 不可用"}`;
    return null;
  }
}

async function loadSampleModelingImportFixture() {
  return cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
}

function ensurePublishedModelingImportPackagesLoaded({ force = false } = {}) {
  if (publishedModelingImportPackagesLoading) return;
  if (publishedModelingImportPackagesLoaded && !force) return;
  publishedModelingImportPackagesLoading = true;
  publishedImportStatus = "正在读取已发布导入包";
  backendApi.listProjectDataTemplates({ state: "published" })
    .then((result) => {
      publishedModelingImportPackages = Array.isArray(result?.templates) ? result.templates : [];
      publishedModelingImportPackagesLoaded = true;
      publishedModelingImportPackagesLoading = false;
      if (!selectedPublishedModelingImportId && publishedModelingImportPackages.length) {
        selectedPublishedModelingImportId = projectDataTemplateSourceImportId(publishedModelingImportPackages[0]);
      }
      publishedImportStatus = publishedModelingImportPackages.length
        ? `已加载 ${publishedModelingImportPackages.length} 个已发布导入包`
        : "暂无已发布导入包";
      if (selectedPublishedModelingImportId && !selectedPublishedModelingImportPackage()) {
        loadPublishedModelingImportPackage(selectedPublishedModelingImportId, { renderAfter: false }).finally(() => render());
        return;
      }
      render();
    })
    .catch((err) => {
      publishedModelingImportPackagesLoaded = true;
      publishedModelingImportPackagesLoading = false;
      publishedImportStatus = `已发布导入包列表加载失败：${err && err.message ? err.message : "Backend API 不可用"}`;
      render();
    });
}

async function loadPublishedModelingImportPackage(importId, { renderAfter = true } = {}) {
  const normalizedImportId = String(importId || "").trim();
  if (!normalizedImportId) {
    publishedImportStatus = "未选择已发布导入包";
    return;
  }
  selectedPublishedModelingImportId = normalizedImportId;
  publishedImportStatus = "正在读取导入包预览";
  try {
    const stored = await backendApi.getModelingImport(normalizedImportId);
    applyModelingImportRecord(stored);
    if (!publishedModelingImportPackages.some((template) => projectDataTemplateSourceImportId(template) === normalizedImportId)) {
      publishedModelingImportPackages.unshift(templateSummaryFromModelingImportRecord(stored));
    }
    publishedImportStatus = "已选择项目数据导入包";
  } catch (err) {
    publishedImportStatus = `导入包预览加载失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  } finally {
    if (renderAfter) render();
  }
}

function templateSummaryFromModelingImportRecord(record) {
  const state = normalizeModelingImportRecord(record, MODELING_IMPORT_DEMO_FIXTURE);
  const packagePayload = state.publishedPackage || state.importPackage || {};
  const objects = packagePayload.objects || {};
  const projectInfo = objects.projectInfo || {};
  const validation = packagePayload.validation || state.validation || {};
  const importId = packagePayload.importId || record?.importId || "";
  return {
    template_id: importId,
    template_type: "project_data",
    source_import_id: importId,
    project_id: packagePayload.projectId || record?.projectId || "",
    name: projectInfo.name || packagePayload.importId || record?.importId || "未命名模板",
    summary: projectInfo.summary || "",
    validation_status: validation.status || "unknown",
    object_counts: Object.fromEntries(
      Object.entries(objects)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length])
    )
  };
}

async function hydrateProjectCatalogFromBackend({ forceProjectId = "" } = {}) {
  const focusProjectId = forceProjectId || (currentProject?.id ? String(currentProject.id) : "");
  projectListStatus = "正在从后端读取项目列表";
  try {
    const result = await backendApi.listProjects();
    const backendProjects = Array.isArray(result?.projects)
      ? result.projects
        .map((entry) => toProjectFromBackendApiEntry(entry))
        .filter(Boolean)
      : [];
    demoProjects = mergeProjectsById(backendProjects);
    currentProject = demoProjects.find((project) => project.id === focusProjectId) || demoProjects[0];
    if (backendProjects.length) {
      projectListStatus = `已加载 ${backendProjects.length} 个后端项目`;
    } else {
      projectListStatus = "后端未返回项目，请先选择项目模板创建项目";
    }
  } catch (err) {
    demoProjects = [];
    currentProject = null;
    projectListStatus = `后端项目列表加载失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function currentPublishedModelingImportId() {
  return modelingImportPublishedPackage?.importId
    || modelingImportPublishedPackage?.import_id
    || selectedPublishedModelingImportId
    || readLastPublishedModelingImportId()
    || "";
}

function editDemoProject(projectId) {
  const project = demoProjects.find((item) => item.id === projectId);
  if (!project) {
    projectListStatus = "项目不存在";
    return;
  }
  projectEditorDraft = { ...project };
  projectListStatus = "项目条目已进入本地编辑态";
}

function updateProjectEditorDraft(fieldName, value) {
  if (!projectEditorDraft || !["name", "baseCode", "summary"].includes(fieldName)) return;
  projectEditorDraft = {
    ...projectEditorDraft,
    [fieldName]: value
  };
}

async function saveProjectEditorDraft() {
  if (!projectEditorDraft) return;
  const saved = {
    ...projectEditorDraft,
    name: projectEditorDraft.name.trim() || "未命名项目",
    baseCode: projectEditorDraft.baseCode.trim() || "NB-00",
    summary: projectEditorDraft.summary.trim() || "项目说明待补充。",
    updatedAt: new Date().toISOString().slice(0, 10)
  };
  const currentEntry = demoProjects.find((project) => project.id === saved.id);
  const backendProjectId = saved.projectBackendId || currentEntry?.projectBackendId || `project-${saved.id}`;
  try {
    const projectJson = await backendApi.getProject(backendProjectId);
    const nextProjectJson = {
      ...projectJson,
      experiment: {
        ...(projectJson.experiment || {}),
        name: saved.name
      },
      projectInfo: {
        ...(projectJson.projectInfo || {}),
        name: saved.name,
        baseCode: saved.baseCode,
        summary: saved.summary
      }
    };
    await backendApi.saveProject(nextProjectJson);
    if (scenario?.project_id === backendProjectId || currentProject?.id === saved.id) {
      scenario = cloneScenario(nextProjectJson);
      experimentPlanDraft = experimentPlanBranchActive ? experimentPlanDraft : cloneScenario(nextProjectJson);
    }
    demoProjects = demoProjects.map((project) => (project.id === saved.id ? saved : project));
    if (currentProject?.id === saved.id) currentProject = saved;
    projectEditorDraft = null;
    projectListStatus = `已保存项目：${saved.name}`;
  } catch (err) {
    projectListStatus = `项目保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function deleteDemoProject(projectId) {
  const removed = demoProjects.find((project) => project.id === projectId);
  if (!removed) {
    projectListStatus = "项目不存在";
    return;
  }
  const backendProjectId = removed.projectBackendId || `project-${removed.id}`;
  try {
    await backendApi.deleteProject(backendProjectId);
    demoProjects = demoProjects.filter((project) => project.id !== projectId);
    if (currentProject?.id === projectId) currentProject = demoProjects[0] || null;
    projectListStatus = `已从后端删除项目：${removed.name}`;
  } catch (err) {
    projectListStatus = `后端删除项目失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function exportProjectJson(projectId) {
  const project = demoProjects.find((item) => item.id === projectId);
  if (!project) {
    projectListStatus = "项目不存在";
    return;
  }
  const projectJson = await resolveProjectJsonForExport(project);
  if (!projectJson) return;
  const filename = projectJsonExportFilename(project);
  downloadProjectJsonExport(filename, projectJson);
  projectListStatus = `已导出项目 JSON：${filename}`;
}

async function resolveProjectJsonForExport(project) {
  if (selectedRoute === "workbench" && currentProject?.id === project.id) {
    return buildBackendProjectJson(scenario, project);
  }
  const backendProjectId = project.projectBackendId || (project.sourceKind === PROJECT_SOURCE.imported_sample ? `project-${project.id}` : "");
  if (backendProjectId) {
    try {
      return await backendApi.getProject(backendProjectId);
    } catch (err) {
      projectListStatus = `项目 JSON 导出失败：${err && err.message ? err.message : "Backend API 不可用"}`;
      return null;
    }
  }
  return buildBackendProjectJson(defaultScenario, project);
}

function projectJsonExportFilename(project) {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  return `spare-mvp-project-${normalizeProjectFileSegment(project.id)}-${date}.json`;
}

function downloadProjectJsonExport(filename, projectJson) {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
  const blob = new Blob([JSON.stringify(projectJson, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeProjectCardId(value) {
  return normalizeProjectFileSegment(String(value || "imported-project").replace(/^project-/, "")) || `imported-project-${Date.now()}`;
}

function normalizeProjectFileSegment(value) {
  return String(value || "project")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "project";
}

async function flushPendingProjectDraftAutosave() {
  if (!projectDraftAutosaveTimer) return;
  clearTimeout(projectDraftAutosaveTimer);
  projectDraftAutosaveTimer = null;
  if (projectDraftSaveStatus === "有未保存修改") {
    await saveCurrentProjectDraftThroughApi();
  }
}

function currentBackendProjectId() {
  if (currentProject?.projectBackendId) return currentProject.projectBackendId;
  return currentProject?.id ? `project-${currentProject.id}` : `project-${scenario.scenarioId}`;
}

function ensureExperimentPlanListLoaded(projectId = currentBackendProjectId()) {
  if (backendExperimentPlansProjectId !== projectId) {
    backendExperimentPlans = [];
    backendExperimentPlansLoaded = false;
    backendExperimentPlansLoadInFlight = false;
    backendExperimentPlansProjectId = projectId;
    experimentPlanListStatus = "仿真实验方案列表尚未加载";
  }
  if (backendExperimentPlansLoaded || backendExperimentPlansLoadInFlight) return;
  backendExperimentPlansLoadInFlight = true;
  refreshExperimentPlanList(projectId)
    .finally(() => {
      render();
    });
}

async function refreshExperimentPlanList(projectId = currentBackendProjectId(), { force = false } = {}) {
  if (!projectId) {
    backendExperimentPlans = [];
    backendExperimentPlansLoaded = true;
    backendExperimentPlansLoadInFlight = false;
    experimentPlanListStatus = "尚未选择项目，无法读取后端方案列表";
    return;
  }
  if (force) {
    backendExperimentPlansLoaded = false;
  }
  backendExperimentPlansProjectId = projectId;
  backendExperimentPlansLoadInFlight = true;
  try {
    const response = await backendApi.listExperimentPlans(projectId);
    backendExperimentPlans = Array.isArray(response?.experiment_plans) ? response.experiment_plans : [];
    backendExperimentPlansLoaded = true;
    resetMissingRunContextAfterPlanRefresh();
    experimentPlanListStatus = `已加载后端方案 ${backendExperimentPlans.length} 条`;
  } catch (err) {
    backendExperimentPlans = [];
    backendExperimentPlansLoaded = true;
    resetMissingRunContextAfterPlanRefresh();
    experimentPlanListStatus = `后端方案列表读取失败：${formatBackendError(err)}`;
  } finally {
    backendExperimentPlansLoadInFlight = false;
  }
}

async function deleteExperimentPlanFromList(experimentPlanId) {
  if (!experimentPlanId) {
    experimentPlanListStatus = "当前方案尚未保存为后端 ExperimentPlan，无法清理关联回放";
    return;
  }
  if (!canManageM7Lifecycle()) {
    experimentPlanListStatus = `当前角色 ${currentUser.role || "未知"} 无权删除仿真实验方案`;
    return;
  }
  const projectId = currentBackendProjectId();
  try {
    const deleted = await backendApi.deleteExperimentPlan(projectId, experimentPlanId);
    const deletedRunIds = new Set(deleted?.soft_deleted_run_ids || []);
    if (deletedRunIds.has(visualizationSelectedRunId)) {
      visualizationSelectedRunId = "";
      clearVisualizationStateSeries("", "关联方案已删除，已清空当前回放选择");
    }
    if (deletedRunIds.has(backendRun?.run_id)) {
      backendRun = { ...(backendRun || {}), lifecycle_status: "deleted" };
    }
    if (selectedRunContextKey === experimentPlanId) {
      resetRunContextToCurrentProject();
    }
    experimentPlanListStatus = `已删除方案 ${experimentPlanId}，软删除关联 run ${deletedRunIds.size} 条`;
    await refreshExperimentPlanList(projectId, { force: true });
    await refreshVisualizationRunList("");
    await refreshM7RunArtifactPanel();
  } catch (err) {
    experimentPlanListStatus = `删除方案失败：${formatBackendError(err)}`;
  }
}

function isCurrentModelingPage() {
  return getFeaturePageById(selectedFeatureId).secondary === "仿真建模";
}

function markProjectDraftChanged() {
  if (!isCurrentModelingPage()) return;
  experimentPlanBranchActive = false;
  projectDraftSaveStatus = "有未保存修改";
  scheduleProjectDraftAutosave();
}

function scheduleProjectDraftAutosave() {
  if (projectDraftAutosaveTimer) clearTimeout(projectDraftAutosaveTimer);
  projectDraftAutosaveTimer = setTimeout(() => {
    projectDraftAutosaveTimer = null;
    saveCurrentProjectDraftThroughApi().finally(() => render());
  }, PROJECT_DRAFT_AUTOSAVE_DELAY_MS);
}

async function hydrateCurrentProjectDraftFromApi() {
  try {
    const rawProjectJson = await backendApi.getProject(currentBackendProjectId());
    const projectJson = normalizeProjectJsonForClientDraft(rawProjectJson);
    scenario = cloneScenario(projectJson);
    experimentPlanDraft = cloneScenario(projectJson);
    const sourceImportId = projectJson.missionProfile?.sourceImportId || "";
    if (sourceImportId && currentProject) {
      currentProject = {
        ...currentProject,
        sourceKind: PROJECT_SOURCE.imported_sample,
        sourceImportId
      };
      demoProjects = mergeProjectsById([currentProject, ...demoProjects]);
    }
    updatePreviewResultsThroughApiClient();
    savedProject = {
      project_id: projectJson.project_id || currentBackendProjectId(),
      project_version: projectJson.project_version || "project-v0.1",
      status: "hydrated"
    };
    projectDraftSaveStatus = "已保存";
    projectDraftHydrateStatus = "已从 Project draft 恢复";
    backendApiStatus = "Project draft 已恢复";
  } catch (err) {
    projectDraftHydrateStatus = `未读取到 Project draft：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function saveCurrentProjectDraftThroughApi() {
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  try {
    savedProject = await backendApi.saveProject(projectJson);
    projectDraftSaveStatus = "已保存";
    projectDraftLastSavedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    projectDraftHydrateStatus = "";
    backendApiStatus = "Project draft 已保存";
  } catch (err) {
    savedProject = null;
    projectDraftSaveStatus = "保存失败";
    backendApiStatus = `后端保存失败，Project draft 未保存：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function saveCurrentExperimentPlanThroughApi() {
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  const planProjectJson = cloneScenario(experimentPlanDraft);
  ensureExperimentPlanLargeSampleRequest(planProjectJson);
  const existingExperimentPlanId = String(experimentPlan?.experiment_plan_id || "").trim();
  try {
    savedProject = await backendApi.saveProject(projectJson);
    modelingSnapshot = await backendApi.createModelingSnapshot(savedProject.project_id);
    const runIntent = buildRunIntent({
      runType: "single",
      projectJson: savedProject,
      planProjectJson,
      modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY
    });
    experimentPlan = existingExperimentPlanId
      ? await backendApi.updateExperimentPlan(savedProject.project_id, existingExperimentPlanId, runIntent.experimentPlanConfig)
      : await backendApi.createExperimentPlan(savedProject.project_id, runIntent.experimentPlanConfig);
    await refreshExperimentPlanList(savedProject.project_id, { force: true });
    experimentPlanManagementMode = "list";
    selectedExperimentPlanKeys = new Set([experimentPlanSelectionKey(experimentPlan)]);
    backendApiStatus = existingExperimentPlanId ? "实验方案已更新" : "实验方案分支已保存";
  } catch (err) {
    savedProject = null;
    modelingSnapshot = null;
    experimentPlan = null;
    backendApiStatus = `实验方案保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function ensureExperimentPlanLargeSampleRequest(projectJson) {
  ensureExperimentPlanDraftDefaults(projectJson);
  ensureMonteCarloSweepDefaults(projectJson);
  const samples = Math.max(1, Math.trunc(Number(projectJson.experiment?.samples || 1)));
  projectJson.analysisRequests = {
    ...(projectJson.analysisRequests || {}),
    largeSample: {
      ...(projectJson.analysisRequests?.largeSample || {}),
      enabled: true,
      samples,
      sweep: cloneScenario(projectJson.monteCarlo || defaultMonteCarloSweepForProject(projectJson))
    }
  };
  return projectJson;
}

function currentProjectCanStartFormalRun() {
  if (!currentProject) {
    return {
      allowed: false,
      message: "请先创建或选择项目，再启动正式后端运行。"
    };
  }
  if (currentProject.sourceKind === PROJECT_SOURCE.imported_sample) {
    return { allowed: true, message: "" };
  }
  return {
    allowed: false,
    message: "请先选择项目模板创建项目，再启动正式后端运行。"
  };
}

async function ensureFormalRunImportedSampleProject() {
  if (currentProject) {
    visualizationReplayStatus = "正在对齐后端示例项目";
    await hydrateCurrentProjectDraftFromApi();
    if (scenario?.missionProfile?.sourceImportId && currentProject?.sourceKind === PROJECT_SOURCE.imported_sample) {
      return currentProjectCanStartFormalRun();
    }
  }
  visualizationReplayStatus = "正在从已发布建模导入包生成后端示例项目";
  const project = await createSampleProjectFromPublishedImport(currentProject?.sourceImportId);
  if (!project) {
    return {
      allowed: false,
      message: projectListStatus || "后端示例项目生成失败"
    };
  }
  return currentProjectCanStartFormalRun();
}

async function startSingleRunThroughApi() {
  const formalRunGate = currentProjectCanStartFormalRun();
  if (!formalRunGate.allowed) {
    backendApiStatus = formalRunGate.message;
    experimentRunStatus = "未配置";
    return null;
  }
  if (formalRunSubmitInFlight) {
    backendApiStatus = "已有正式运行正在提交，请等待当前请求返回";
    return null;
  }
  formalRunSubmitInFlight = true;
  const runType = "single";
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  const planProjectJson = selectedExperimentPlanProjectJson();
  try {
    const submitted = await submitRunIntent(backendApi, {
      runType,
      projectJson,
      planProjectJson,
      modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY
    });
    savedProject = submitted.savedProject;
    modelingSnapshot = submitted.modelingSnapshot;
    experimentPlan = submitted.experimentPlan;
    backendRun = submitted.run;
    if (backendRun.status === "failed") {
      backendRunResult = null;
      backendArtifactManifest = { artifacts: [] };
      backendRunChain = null;
      lastRunExperimentPlanProjectJson = null;
      forgetLastBackendRun();
      experimentRunStatus = "运行失败";
      backendApiStatus = compileGateStatusText(backendRun);
      return null;
    }
    lastRunExperimentPlanProjectJson = {
      run_id: backendRun.run_id,
      project_json: submitted.intent.planProjectJson
    };
    rememberLastBackendRun(backendRun.run_id, savedProject.project_id, submitted.intent.planProjectJson);
    await refreshExperimentPlanList(savedProject.project_id, { force: true });
    await refreshRunResultThroughApi(backendRun.run_id);
    experimentRunStatus = backendRun.status === "succeeded" ? "完成" : backendRun.status;
    backendApiStatus = isRunComplete(backendRun)
      ? "单次正式运行完成"
      : `单次正式运行已提交：${backendRun.run_id || "等待 run_id"} / ${runStatusLabel(backendRun)}`;
    return backendRun;
  } catch (err) {
    savedProject = null;
    backendRun = null;
    backendRunResult = null;
    backendArtifactManifest = null;
    backendRunChain = null;
    forgetLastBackendRun();
    experimentRunStatus = "后端不可用";
    backendApiStatus = `后端不可用，未创建 run_id：${err && err.message ? err.message : "Backend API 不可用"}`;
    return null;
  } finally {
    formalRunSubmitInFlight = false;
  }
}

async function startMonteCarloRunThroughApi({
  monteCarloExperimentId = selectedMonteCarloExperimentId,
  analysisType = "",
  analysisProfile = null,
  planProjectJsonOverride = null
} = {}) {
  const existingExperiment = monteCarloExperimentByBusinessId(monteCarloExperimentId);
  const formalRunGate = currentProjectCanStartFormalRun();
  if (!formalRunGate.allowed) {
    backendApiStatus = formalRunGate.message;
    experimentRunStatus = "未配置";
    return;
  }
  if (formalRunSubmitInFlight) {
    backendApiStatus = "已有正式运行正在提交，请等待当前请求返回";
    return;
  }
  formalRunSubmitInFlight = true;
  const runType = "monte_carlo";
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  ensureMonteCarloSweepDefaults(experimentPlanDraft);
  const planProjectJson = planProjectJsonOverride && typeof planProjectJsonOverride === "object"
    ? buildBackendProjectJson(planProjectJsonOverride, currentProject)
    : selectedExperimentPlanProjectJson();
  try {
    const submitted = await submitRunIntent(backendApi, {
      runType,
      projectJson,
      planProjectJson,
      modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY,
      mcExperimentId: monteCarloExperimentId,
      analysisType,
      currentAnalysisProfile: analysisProfile,
      monteCarloParameterSpace: monteCarloParameterSpaceForExperiment(monteCarloExperimentId)
    });
    savedProject = submitted.savedProject;
    modelingSnapshot = submitted.modelingSnapshot;
    experimentPlan = submitted.experimentPlan;
    backendRun = submitted.run;
    if (backendRun.status === "failed") {
      backendRunResult = null;
      lastRunExperimentPlanProjectJson = null;
      forgetLastBackendRun();
      experimentRunStatus = "运行失败";
      backendApiStatus = compileGateStatusText(backendRun);
      await refreshRunFailureArtifacts(backendRun.run_id);
      syncMonteCarloExperimentRun(monteCarloExperimentId, {
        status: "运行失败",
        progress: Number(backendRun.progress ?? 0),
        runId: backendRun.run_id || "",
        runType,
        artifactId: backendArtifactManifest?.artifact_manifest_id || "",
        artifactManifestId: backendArtifactManifest?.artifact_manifest_id || "",
        projectionArtifactIds: [],
        source: "backend:run-failed"
      });
      return backendRun;
    }
    lastRunExperimentPlanProjectJson = {
      run_id: backendRun.run_id,
      project_json: submitted.intent.planProjectJson
    };
    rememberLastBackendRun(backendRun.run_id, savedProject.project_id, submitted.intent.planProjectJson);
    await refreshExperimentPlanList(savedProject.project_id, { force: true });
    if (backendRun.status === "queued" || backendRun.status === "running") {
      backendRunResult = null;
      backendArtifactManifest = { artifacts: [] };
      backendRunChain = null;
      experimentRunStatus = backendRun.status;
      backendApiStatus = `正式 Monte Carlo run 已提交：${backendRun.run_id || "等待 run_id"} / ${runStatusLabel(backendRun)}`;
      syncMonteCarloExperimentRun(monteCarloExperimentId, {
        status: "运行中",
        progress: backendRun.progress ?? 0,
        runId: backendRun.run_id,
        runType,
        artifactId: "",
        artifactManifestId: "",
        projectionArtifactIds: [],
        source: "backend:run-service"
      });
      return backendRun;
    }
    await refreshRunResultThroughApi(backendRun.run_id);
    experimentRunStatus = backendRun.status === "succeeded" ? "完成" : backendRun.status;
    backendApiStatus = isRunComplete(backendRun)
      ? "运行完成"
      : `正式 Monte Carlo run 已提交：${backendRun.run_id || "等待 run_id"} / ${runStatusLabel(backendRun)}`;
    syncMonteCarloExperimentRun(monteCarloExperimentId, {
      status: isRunComplete(backendRun) ? experimentRunStatus : "运行中",
      progress: backendRun.progress ?? (isRunComplete(backendRun) ? 1 : 0),
      runId: backendRun.run_id,
      runType,
      artifactId: backendArtifactManifest?.artifact_manifest_id || "",
      artifactManifestId: backendArtifactManifest?.artifact_manifest_id || "",
      projectionArtifactIds: allAnalysisProjectionArtifacts().map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind).filter(Boolean),
      source: "backend:run-service"
    });
    return backendRun;
  } catch (err) {
    savedProject = null;
    backendRun = null;
    backendRunResult = null;
    backendArtifactManifest = null;
    backendRunChain = null;
    forgetLastBackendRun();
    experimentRunStatus = "后端不可用";
    backendApiStatus = `后端不可用，未创建 run_id：${err && err.message ? err.message : "Backend API 不可用"}`;
    if (!existingExperiment?.runId) {
      syncMonteCarloExperimentRun(monteCarloExperimentId, {
        status: "运行失败",
        progress: 0,
        runType,
        source: "backend:submit-error"
      });
    }
    return null;
  } finally {
    formalRunSubmitInFlight = false;
    render();
  }
}

async function refreshRunFailureArtifacts(runId) {
  if (!runId) {
    backendArtifactManifest = { artifacts: [] };
    backendRunChain = null;
    return;
  }
  try {
    await refreshM7RunArtifactPanel(runId);
    const detailMatchesRun = m7RunDetail?.run?.run_id === runId;
    backendArtifactManifest = detailMatchesRun ? (m7RunDetail?.artifact_manifest || { artifacts: [] }) : { artifacts: [] };
    backendRunChain = detailMatchesRun ? (m7RunDetail?.chain || null) : null;
  } catch (err) {
    backendArtifactManifest = { artifacts: [] };
    backendRunChain = null;
    m7RunArtifactStatus = `M7 failed-run artifact 读取失败：${formatBackendError(err)}`;
  }
}

async function refreshRunResultThroughApi(runId = backendRun?.run_id) {
  if (!runId) return;
  backendRun = await backendApi.getRunStatus(runId);
  await refreshM7RunArtifactPanel(runId);
  if (!isRunComplete(backendRun)) {
    backendRunResult = null;
    backendArtifactManifest = { artifacts: [] };
    backendRunChain = null;
    clearAnalysisProjectionPayloads(runId);
    clearVisualizationStateSeries(runId, "运行尚未完成，M9 离线状态序列未解锁");
    if (backendRun.project_id) {
      try {
        savedProject = await backendApi.getProject(backendRun.project_id);
      } catch {
        savedProject = savedProject || { project_id: backendRun.project_id };
      }
    }
    return backendRun;
  }
  backendRunResult = await backendApi.getRunResult(runId);
  backendArtifactManifest = await backendApi.getRunArtifacts(runId);
  backendRunChain = await backendApi.getRunChain(runId);
  await refreshAnalysisProjectionPayloads(runId);
  await refreshVisualizationStateSeries(runId);
  if (backendRun.project_id) {
    savedProject = await backendApi.getProject(backendRun.project_id);
  }
  const planProjectJson = currentRunExperimentPlanProjectJson(runId);
  if (!planProjectJson) {
    throw new Error(`缺少 run ${runId} 的 ExperimentPlan 分支快照，已阻止用当前 Project draft 重建结果`);
  }
  const state = buildFrontendResultState(planProjectJson, backendRunResult);
  singleResult = state.singleResult;
  monteCarloResult = state.monteCarloResult;
  return backendRun;
}

async function refreshAnalysisProjectionPayloads(runId) {
  if (!runId) return;
  const nextPayloads = {};
  const nextErrors = {};
  for (const analysisType of ANALYSIS_PROJECTION_TYPES.map((item) => item.analysisType)) {
    const artifactKind = projectionArtifactKindForAnalysisType(analysisType);
    const projectionArtifacts = analysisProjectionArtifacts(analysisType);
    const artifact = projectionArtifacts.find((item) => item.kind === artifactKind) || projectionArtifacts[0];
    const artifactId = artifact?.artifact_id || artifact?.id || "";
    if (!artifactId) continue;
    try {
      const payload = await backendApi.getRunArtifactPayload(runId, artifactId);
      nextPayloads[analysisType] = normalizeAnalysisProjectionPayload(analysisType, payload, {
        runId,
        modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY
      });
    } catch (err) {
      nextErrors[analysisType] = formatBackendError(err);
    }
  }
  analysisProjectionPayloads = {
    ...analysisProjectionPayloads,
    [runId]: nextPayloads
  };
  analysisProjectionPayloadErrors = {
    ...analysisProjectionPayloadErrors,
    [runId]: nextErrors
  };
}

async function refreshVisualizationStateSeries(runId) {
  if (!runId) return;
  const artifact = findVisualizationStateSeriesArtifact(backendArtifactManifest);
  if (!artifact?.artifact_id) {
    clearVisualizationStateSeries(runId, `run ${runId} 缺少 visualization_state_series artifact，M9 正式回放保持阻断`);
    return;
  }
  try {
    const payload = await backendApi.getRunArtifactPayload(runId, artifact.artifact_id);
    visualizationStateSeries = normalizeVisualizationStateSeriesPayload(payload, {
      runId,
      artifactId: artifact.artifact_id
    });
    visualizationSelectedRunId = runId;
    visualizationReplayIndex = 0;
    visualizationReplayPlaying = false;
    stopVisualizationReplay();
    visualizationReplayStatus = `M9 state_series 已加载：run_id ${runId} / artifact_id ${artifact.artifact_id} / ${visualizationStateSeries.frame_count} 帧 / ${visualizationStateSeries.event_count} 事件`;
  } catch (err) {
    clearVisualizationStateSeries(runId, `M9 state_series 解析失败：${formatBackendError(err)}`);
  }
}

function clearVisualizationStateSeries(runId = "", message = "M9 离线状态序列尚未加载") {
  stopVisualizationReplay();
  visualizationStateSeries = null;
  visualizationReplayIndex = 0;
  visualizationReplayStatus = message;
}

function subscribeVisualizationRunStream(runId = visualizationSelectedRunId || backendRun?.run_id) {
  if (!runId) {
    setVisualizationStreamState({
      runId: "",
      status: "failed",
      message: "订阅失败：尚未选择 run_id"
    });
    return;
  }
  if (!backendAuthToken) {
    setVisualizationStreamState({
      runId,
      status: "unauthorized",
      message: "订阅未授权：请先登录后端会话"
    });
    return;
  }
  if (typeof EventSource !== "function") {
    setVisualizationStreamState({
      runId,
      status: "failed",
      message: "订阅失败：当前浏览器不支持 EventSource"
    });
    return;
  }
  stopVisualizationRunStream("");
  visualizationSelectedRunId = runId;
  setVisualizationStreamState({
    runId,
    status: "connecting",
    message: `正在订阅 run ${runId} 的 M9.2 在线状态流`,
    eventCount: 0,
    artifactId: ""
  });
  const source = new EventSource(runStateStreamUrl(runId));
  visualizationStreamSource = source;
  source.addEventListener("open", () => {
    setVisualizationStreamState({
      runId,
      status: "connected",
      message: `订阅已连接：run ${runId}`,
      lastEventAt: new Date().toISOString()
    });
    render();
  });
  source.addEventListener("run_status", (event) => {
    const payload = parseStreamEventData(event);
    backendRun = payload.status || payload;
    setVisualizationStreamState({
      runId,
      status: "connected",
      message: `订阅已连接：${runStatusLabel(backendRun)} / progress ${backendRun.progress ?? "-"}`,
      eventCount: visualizationStreamState.eventCount + 1,
      lastEventAt: new Date().toISOString()
    });
    render();
  });
  source.addEventListener("state_frame", (event) => {
    try {
      const payload = parseStreamEventData(event);
      visualizationStateSeries = mergeVisualizationStateStreamFrame(visualizationStateSeries, payload);
      visualizationReplayIndex = visualizationStateSeries.frames.length - 1;
      visualizationReplayPlaying = false;
      visualizationReplayStatus = `M9.2 在线状态流已更新：run_id ${runId} / ${visualizationStateSeries.frame_count}-${visualizationStateSeries.expected_frame_count} 帧 / 事件 ${visualizationStateSeries.event_count}`;
      setVisualizationStreamState({
        runId,
        status: "connected",
        message: `订阅已连接：已接收 state_frame ${payload.frame_index + 1}/${payload.frame_count}`,
        eventCount: visualizationStreamState.eventCount + 1,
        lastEventAt: new Date().toISOString(),
        artifactId: payload.artifact_id || visualizationStreamState.artifactId
      });
    } catch (err) {
      setVisualizationStreamState({
        runId,
        status: "failed",
        message: `订阅失败：${formatBackendError(err)}`
      });
    }
    render();
  });
  source.addEventListener("artifact_ready", (event) => {
    const payload = parseStreamEventData(event);
    setVisualizationStreamState({
      runId,
      status: "artifact-ready",
      message: "最终 artifact 已生成，正在切换到离线回放",
      eventCount: visualizationStreamState.eventCount + 1,
      lastEventAt: new Date().toISOString(),
      artifactId: payload.artifact_id || payload.visualization_state_series_artifact_id || ""
    });
    stopVisualizationRunStream(visualizationStreamState.message, { keepState: true });
    loadVisualizationReplayForRun(runId).finally(() => render());
  });
  source.addEventListener("error", () => {
    setVisualizationStreamState({
      runId,
      status: "disconnected",
      message: "订阅断开，浏览器将尝试重连；若会话失效请重新登录",
      lastEventAt: new Date().toISOString()
    });
    render();
  });
}

function stopVisualizationRunStream(message = "M9.2 在线状态流订阅已停止", { keepState = false } = {}) {
  if (visualizationStreamSource) {
    visualizationStreamSource.close();
    visualizationStreamSource = null;
  }
  if (!keepState && message) {
    setVisualizationStreamState({
      status: "idle",
      message
    });
  }
}

function setVisualizationStreamState(next) {
  visualizationStreamState = {
    ...visualizationStreamState,
    ...next
  };
}

function parseStreamEventData(event) {
  return JSON.parse(event?.data || "{}");
}

function runStateStreamUrl(runId) {
  const token = backendAuthToken ? `?access_token=${encodeURIComponent(backendAuthToken)}` : "";
  return `/api/runs/${encodeURIComponent(runId)}/state-stream${token}`;
}

async function refreshVisualizationRunList(selectedRunId = backendRun?.run_id || visualizationSelectedRunId) {
  try {
    const response = await backendApi.listRuns({ include_deleted: 0 });
    visualizationRunList = Array.isArray(response?.runs)
      ? response.runs.filter((run) => run && run.lifecycle_status !== "deleted")
      : [];
    if (selectedRunId) {
      visualizationSelectedRunId = selectedRunId;
    } else if (!visualizationSelectedRunId && visualizationRunList[0]?.run_id) {
      visualizationSelectedRunId = visualizationRunList[0].run_id;
    }
    const activeRunId = visualizationSelectedRunId || backendRun?.run_id || visualizationStateSeries?.run_id || "";
    visualizationReplayStatus = activeRunId
      ? `M9 当前回放已同步：run_id ${activeRunId}`
      : "M9 暂无可回放 run";
  } catch (err) {
    visualizationRunList = [];
    visualizationReplayStatus = `M9 run 列表读取失败：${formatBackendError(err)}`;
  }
}

function ensureVisualizationRunListLoaded() {
  if (visualizationRunListLoaded || visualizationRunListLoadInFlight) return;
  visualizationRunListLoadInFlight = true;
  refreshVisualizationRunList()
    .finally(() => {
      visualizationRunListLoaded = true;
      visualizationRunListLoadInFlight = false;
      render();
    });
}

async function startLiteMesaVisualizationThroughApi() {
  if (!currentProject) {
    visualizationReplayStatus = "启动仿真失败：请先创建或选择项目。";
    return null;
  }
  if (independentMesaVisualizationInFlight) {
    visualizationReplayStatus = "仿真正在启动，请等待当前请求返回";
    return null;
  }
  independentMesaVisualizationInFlight = true;
  stopVisualizationRunStream("正在启动仿真，M9.2 在线订阅已停止");
  stopVisualizationReplay();
  visualizationReplayStatus = "正在通过 Lite Mesa 启动可视化仿真";
  try {
    const settings = selectedExperimentPlanRunSettings();
    const seed = Math.trunc(Number(settings.seed) || 20260621);
    const response = await backendApi.runLiteMesaAnalysis(
      selectedExperimentPlanProjectJson(),
      "mission_reliability",
      { ...settings, samples: 1, seed }
    );
    const responseSeries = response?.visualization_state_series;
    const runId = response?.run_id || responseSeries?.run_id || response?.experiment_id || "";
    visualizationSelectedRunId = runId;
    visualizationStateSeries = responseSeries
      ? normalizeVisualizationStateSeriesPayload(responseSeries, {
        runId,
        artifactId: responseSeries.artifact_manifest_id || (runId ? `lite-mesa-analysis-manifest-${runId}` : "lite-mesa-analysis-manifest")
      })
      : null;
    visualizationReplayIndex = 0;
    visualizationReplayPlaying = false;
    backendApiStatus = runId ? `Lite Mesa 仿真已完成：${runId}` : "Lite Mesa 仿真已完成";
    visualizationReplayStatus = responseSeries
      ? `${backendApiStatus}，已加载静态状态`
      : `${backendApiStatus}，未返回 state_series`;
    render();
    return { run_id: runId, status: response.status || "session_complete" };
  } catch (err) {
    visualizationStateSeries = null;
    visualizationReplayIndex = 0;
    visualizationReplayPlaying = false;
    backendApiStatus = `仿真失败：${formatBackendError(err)}`;
    visualizationReplayStatus = backendApiStatus;
    render();
    return null;
  } finally {
    independentMesaVisualizationInFlight = false;
  }
}

async function loadVisualizationReplayForRun(runId = visualizationSelectedRunId || backendRun?.run_id) {
  if (!runId) {
    clearVisualizationStateSeries("", "尚未选择 run_id，无法加载 M9 离线状态序列");
    return;
  }
  if (visualizationStateSeries && visualizationStateSeries.run_id !== runId) {
    clearVisualizationStateSeries("", `正在加载 run ${runId} 的 M9 state_series artifact`);
  }
  try {
    const detail = await backendApi.getRunDetail(runId);
    const run = detail?.run || {};
    if (!isRunComplete(run)) {
      clearVisualizationStateSeries("", `run ${runId} 尚未完成，M9 离线状态序列未解锁`);
      return;
    }
    const artifact = findVisualizationStateSeriesArtifact(detail?.artifact_manifest);
    if (!artifact?.artifact_id) {
      clearVisualizationStateSeries("", `run ${runId} 缺少 visualization_state_series artifact，M9 正式回放保持阻断`);
      return;
    }
    const payload = await backendApi.getRunArtifactPayload(runId, artifact.artifact_id);
    visualizationStateSeries = normalizeVisualizationStateSeriesPayload(payload, {
      runId,
      artifactId: artifact.artifact_id
    });
    visualizationSelectedRunId = runId;
    visualizationReplayIndex = 0;
    visualizationReplayPlaying = false;
    stopVisualizationReplay();
    visualizationReplayStatus = `M9 state_series 已加载：run_id ${runId} / artifact_id ${artifact.artifact_id} / ${visualizationStateSeries.frame_count} 帧 / ${visualizationStateSeries.event_count} 事件`;
  } catch (err) {
    clearVisualizationStateSeries("", `M9 回放加载失败：${formatBackendError(err)}`);
  }
}

function clearAnalysisProjectionPayloads(runId = backendRun?.run_id) {
  if (!runId) return;
  const { [runId]: _payloads, ...remainingPayloads } = analysisProjectionPayloads;
  const { [runId]: _errors, ...remainingErrors } = analysisProjectionPayloadErrors;
  analysisProjectionPayloads = remainingPayloads;
  analysisProjectionPayloadErrors = remainingErrors;
}

async function refreshM7RunArtifactPanel(runId = backendRun?.run_id || m7SelectedRunId) {
  const selectedRunId = runId || m7SelectedRunId;
  try {
    const listResponse = await backendApi.listRuns({ run_type: "monte_carlo", include_deleted: 1 });
    m7RunList = Array.isArray(listResponse?.runs) ? listResponse.runs : [];
  } catch (err) {
    m7RunList = [];
    m7RunArtifactStatus = `M7 run list 读取失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
  if (!selectedRunId) return;
  try {
    m7RunDetail = await backendApi.getRunDetail(selectedRunId);
    m7SelectedRunId = selectedRunId;
    const run = m7RunDetail?.run || {};
    const artifacts = m7RunArtifactRows();
    m7RunArtifactStatus = `M7 运行产物账本已加载：${run.run_id || selectedRunId} / ${run.lifecycle_status || "active"} / ${artifacts.length} artifacts`;
  } catch (err) {
    m7RunDetail = null;
    m7RunArtifactStatus = `M7 run detail 读取失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function handleM7RunArtifactAction(button) {
  const action = button.dataset.action;
  const runId = button.dataset.runId || backendRun?.run_id || m7SelectedRunId;
  const artifactId = button.dataset.artifactId || "";
  try {
    if (action === "m7-refresh-runs") {
      await refreshM7RunArtifactPanel(runId);
      return;
    }
    if (!runId) {
      m7RunArtifactStatus = "尚未创建 run_id，无法执行 M7 run artifact 操作";
      return;
    }
    if (action === "m7-detail-run" || action === "m7-open-run-detail") {
      await refreshM7RunArtifactPanel(runId);
      return;
    }
    if (action === "m7-download-artifact") {
      if (!artifactId) {
        m7RunArtifactStatus = "缺少 artifact_id，无法下载";
        return;
      }
      if ((m7RunDetail?.run?.lifecycle_status || backendRun?.lifecycle_status) === "deleted") {
        m7RunArtifactStatus = `run 已软删除，禁止下载 artifact：${runId}`;
        return;
      }
      const blob = await backendApi.downloadRunArtifact(runId, artifactId);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifactDownloadName(artifactId);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      m7RunArtifactStatus = `artifact 已触发下载：${artifactId}`;
      await refreshM7RunArtifactPanel(runId);
      return;
    }
    if (action === "m7-archive-run") {
      if (!canManageM7Lifecycle()) {
        m7RunArtifactStatus = `当前角色 ${currentUser.role || "未知"} 无权归档运行`;
        return;
      }
      const archived = await backendApi.archiveRun(runId);
      backendRun = { ...(backendRun || {}), ...archived };
      m7RunArtifactStatus = `run 已归档：${runId}`;
      await refreshM7RunArtifactPanel(runId);
      return;
    }
    if (action === "m7-delete-run") {
      if (!canManageM7Lifecycle()) {
        m7RunArtifactStatus = `当前角色 ${currentUser.role || "未知"} 无权软删除运行`;
        return;
      }
      const deleted = await backendApi.deleteRun(runId);
      backendRun = { ...(backendRun || {}), ...deleted };
      m7RunArtifactStatus = `run 已软删除为 tombstone：${runId}；本地 artifact 文件不会被物理删除。`;
      await refreshM7RunArtifactPanel(runId);
    }
  } catch (err) {
    m7RunArtifactStatus = `M7 ${m7ActionLabel(action)}失败：${formatBackendError(err)}`;
  }
}

function m7ActionLabel(action) {
  return {
    "m7-refresh-runs": "刷新",
    "m7-detail-run": "详情",
    "m7-open-run-detail": "详情",
    "m7-download-artifact": "下载",
    "m7-archive-run": "归档",
    "m7-delete-run": "软删除"
  }[action] || "操作";
}

function formatBackendError(err) {
  if (!err) return "Backend API 不可用";
  const parts = [];
  if (err.status) parts.push(`HTTP ${err.status}`);
  if (err.code) parts.push(String(err.code));
  if (err.message) parts.push(String(err.message));
  return parts.join(" / ") || "Backend API 不可用";
}

function canManageM7Lifecycle() {
  return ["系统管理员", "数据管理员"].includes(currentUser?.role);
}

function artifactDownloadName(artifactId) {
  return String(artifactId || "run-artifact")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "run-artifact";
}

function isRunComplete(run) {
  const status = String(run?.status || run?.phase || "").toLowerCase();
  return ["succeeded", "success", "completed", "complete"].includes(status);
}

function runStatusLabel(run) {
  const status = String(run?.status || run?.phase || "queued");
  const progress = normalizeProgress(run?.progress ?? 0);
  if (["succeeded", "success", "completed", "complete"].includes(status.toLowerCase())) return "完成";
  if (["queued", "pending"].includes(status.toLowerCase())) return `排队中 ${progress}%`;
  if (["running", "in_progress"].includes(status.toLowerCase())) return `运行中 ${progress}%`;
  return `${status} ${progress}%`;
}

async function hydrateLastBackendRunFromApi() {
  const stored = readLastBackendRun();
  if (!stored?.run_id) return;
  try {
    await refreshRunResultThroughApi(stored.run_id);
    backendApiStatus = "已从后端恢复";
    experimentRunStatus = backendRun?.status === "succeeded" ? "完成" : backendRun?.status || "已恢复";
    isLoggedIn = true;
    if (selectedRoute === DEFAULT_ROUTE) selectedRoute = "workbench";
    render();
  } catch (err) {
    forgetLastBackendRun();
    backendApiStatus = `后端不可用，刷新恢复已阻断：${err && err.message ? err.message : "Backend API 不可用"}`;
    render();
  }
}

function rememberLastBackendRun(runId, projectId, experimentPlanProjectJson = null) {
  if (!runId) return;
  try {
    localStorage.setItem(LAST_BACKEND_RUN_STORAGE_KEY, JSON.stringify({
      run_id: runId,
      project_id: projectId || "",
      experiment_plan_project_json: experimentPlanProjectJson,
      saved_at: new Date().toISOString()
    }));
  } catch (err) {
    return;
  }
}

function readLastBackendRun() {
  try {
    return JSON.parse(localStorage.getItem(LAST_BACKEND_RUN_STORAGE_KEY) || "null");
  } catch (err) {
    return null;
  }
}

function forgetLastBackendRun() {
  try {
    lastRunExperimentPlanProjectJson = null;
    localStorage.removeItem(LAST_BACKEND_RUN_STORAGE_KEY);
  } catch (err) {
    return;
  }
}

function currentRunExperimentPlanProjectJson(runId) {
  if (lastRunExperimentPlanProjectJson?.run_id === runId) return lastRunExperimentPlanProjectJson.project_json;
  const stored = readLastBackendRun();
  if (stored?.run_id === runId && stored.experiment_plan_project_json) {
    lastRunExperimentPlanProjectJson = {
      run_id: stored.run_id,
      project_json: stored.experiment_plan_project_json
    };
    return lastRunExperimentPlanProjectJson.project_json;
  }
  return null;
}

function updatePreviewResultsThroughApiClient(projectJsonSource = scenario) {
  const state = buildPreviewResultState(buildBackendProjectJson(projectJsonSource, currentProject));
  singleResult = state.previewSingleResult;
  monteCarloResult = state.previewMonteCarloResult;
}

function compileGateStatusText(run) {
  const error = run?.error || {};
  if (error.code === "unsupported_model_family" || error.details?.issues?.length) {
    const firstIssue = error.details?.issues?.[0];
    const location = firstIssue?.field_path || firstIssue?.page || "Scenario compiler";
    return `输入未通过 Scenario compiler：${location}`;
  }
  return `运行失败：${error.message || run?.status || "Backend run failed"}`;
}

function recalculateRmsAllocation() {
  try {
    rmsAllocationResult = calculateRmsAllocation(rmsAllocationPlan, rmsAllocationProject);
  } catch (err) {
    rmsAllocationResult = createRmsAllocationFailureResult(rmsAllocationPlan, err);
  }
}

function applyRmsEquipmentImport(rowsOrProject, statusText) {
  rmsAllocationProject = normalizeRmsEquipmentImportRows(rowsOrProject, {
    baseProject: rmsAllocationProject
  });
  rmsAllocationProject = selectRmsAllocationEquipmentRoot(rmsAllocationProject, rmsEquipmentRoots(rmsAllocationProject)[0]?.id || rmsAllocationProject.rootId);
  const rootNames = rmsEquipmentRoots(rmsAllocationProject).map((node) => node.name);
  const selectedRoot = rmsEquipmentRoots(rmsAllocationProject).find((node) => node.id === rmsAllocationProject.rootId);
  const importedSimilarProduct = rmsAllocationProject.equipmentNodes.find((node) => node.rms?.similar)?.rms?.similar;
  const sourceModelCandidates = rootNames.filter((name) => name !== selectedRoot?.name);
  const sourceModel = sourceModelCandidates.includes(importedSimilarProduct?.sourceModel)
    ? importedSimilarProduct.sourceModel
    : (sourceModelCandidates[0] || rootNames[0] || importedSimilarProduct?.sourceModel || "");
  rmsAllocationPlan = {
    ...rmsAllocationPlan,
    projectId: rmsAllocationProject.projectId,
    algorithmVersion: rmsAllocationPlan.algorithmVersion || rmsAllocationResult.algorithmVersion,
    methods: {
      ...rmsAllocationPlan.methods,
      similarProduct: {
        ...(rmsAllocationPlan.methods?.similarProduct || {}),
        sourceModel,
        targetModel: selectedRoot?.name || importedSimilarProduct?.targetModel || rmsAllocationPlan.methods?.similarProduct?.targetModel || ""
      }
    }
  };
  rmsEquipmentImportStatus = `${statusText}，仅更新 RMS 指标分配装备树。`;
  recalculateRmsAllocation();
}

function setRmsEquipmentRoot(rootId) {
  rmsAllocationProject = selectRmsAllocationEquipmentRoot(rmsAllocationProject, rootId);
  const roots = rmsEquipmentRoots(rmsAllocationProject);
  const selectedRoot = roots.find((node) => node.id === rmsAllocationProject.rootId);
  const currentSource = rmsAllocationPlan.methods?.similarProduct?.sourceModel || "";
  const sourceModel = currentSource && currentSource !== selectedRoot?.name
    ? currentSource
    : (roots.find((node) => node.id !== selectedRoot?.id)?.name || currentSource);
  rmsAllocationPlan = {
    ...rmsAllocationPlan,
    projectId: rmsAllocationProject.projectId,
    methods: {
      ...rmsAllocationPlan.methods,
      similarProduct: {
        ...(rmsAllocationPlan.methods?.similarProduct || {}),
        sourceModel,
        targetModel: selectedRoot?.name || rmsAllocationPlan.methods?.similarProduct?.targetModel || ""
      }
    }
  };
  recalculateRmsAllocation();
}

async function importRmsEquipmentTableFile(file) {
  if (!file) {
    rmsEquipmentImportStatus = "未选择 RMS 装备树导入文件。";
    return;
  }
  try {
    const parsed = parseRmsEquipmentImportText(await file.text(), file.name);
    applyRmsEquipmentImport(parsed, `已导入 ${file.name}`);
  } catch (err) {
    rmsEquipmentImportStatus = `RMS 装备树导入失败：${err && err.message ? err.message : "文件无法解析"}`;
  }
}

function downloadRmsEquipmentTemplate() {
  const header = "节点ID,父节点ID,系统名称,型号,层级,安装数,运行比\n";
  const sample = "aircraft-root,,示例整机,MODEL-A,装备,1,1\nsystem-1,aircraft-root,动力系统,SYS-001,系统,2,1\n";
  downloadTextFile("RMS安装数导入模板.csv", `\uFEFF${header}${sample}`, "text/csv;charset=utf-8");
}

async function exportRmsAllocationExcel() {
  const rows = rmsAllocationResult.nodeResults || [];
  rmsEquipmentImportStatus = "正在生成 XLSX 结果";
  try {
    const blob = await backendApi.exportRmsAllocationXlsx({
      project_name: rmsAllocationProject.name,
      method: rmsAllocationResult.method,
      generated_at: new Date().toISOString(),
      rows
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "RMS指标分配结果.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
    rmsEquipmentImportStatus = "已导出 RMS指标分配结果.xlsx";
  } catch (err) {
    rmsEquipmentImportStatus = `XLSX 导出失败：${formatBackendError(err)}`;
  }
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importEquipmentStructureTableFile(file) {
  if (!file) {
    equipmentImportStatus = "未选择装备结构树导入文件。";
    return false;
  }
  try {
    const parsed = parseRmsEquipmentImportText(await file.text(), file.name);
    const imported = normalizeEquipmentStructureImport(parsed);
    if (!imported.components.length && !imported.wholeMachineModels.length) {
      throw new Error("导入表格未包含有效装备节点");
    }
    scenario.equipment = {
      ...(scenario.equipment || {}),
      model: imported.wholeMachineModels[0] || scenario.equipment?.model || "",
      wholeMachineModels: imported.wholeMachineModels,
      quantity: imported.quantity || scenario.equipment?.quantity || 1
    };
    scenario.components = imported.components;
    selectedEquipmentNodeKey = imported.wholeMachineModels[0] ? `aircraft:${imported.wholeMachineModels[0]}` : "aircraft-list";
    selectedEquipmentComponentIndex = 0;
    equipmentImportStatus = `已导入 ${file.name}：${imported.wholeMachineModels.length} 个整机，${imported.components.length} 个组件。`;
    updatePreviewResultsThroughApiClient();
    return true;
  } catch (err) {
    equipmentImportStatus = `装备结构树导入失败：${err && err.message ? err.message : "文件无法解析"}`;
    return false;
  }
}

function downloadEquipmentStructureTemplate() {
  const content = "\uFEFF节点ID,父节点ID,系统名称,型号,层级,安装数,运行比,MTBF,MTTR,维修分布类型\naircraft-root,,示例整机,MODEL-A,装备,1,1,1000,1.5,固定\nsystem-1,aircraft-root,动力系统,SYS-001,系统,2,1,1200,2,正态分布\n";
  downloadTextFile("装备系统建模导入模板.csv", content, "text/csv;charset=utf-8");
}

function downloadSupportActivityJobsTemplate() {
  const content = "\uFEFF活动编号,工作项目名称,工期分钟,紧前作业\nBA-001,飞行前检查,30,\nBA-002,通电检查,15,BA-001\n";
  downloadTextFile("工作项目清单导入模板.csv", content, "text/csv;charset=utf-8");
}

async function importSupportActivityJobsFile(tabKey, file) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity || !file) return;
  try {
    const parsed = parseRmsEquipmentImportText(await file.text(), file.name);
    const rows = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.supportActivityJobs || []);
    if (!Array.isArray(rows) || !rows.length) throw new Error("导入文件没有工作项目");
    const codes = new Set();
    const jobs = rows.map((row, index) => {
      const activityCode = String(row.activityCode || row["活动编号"] || row.code || `BA-${index + 1}`).trim();
      if (!activityCode || codes.has(activityCode)) throw new Error(`活动编号为空或重复：${activityCode || `第${index + 1}行`}`);
      codes.add(activityCode);
      const predecessorText = row.predecessors ?? row["紧前作业"] ?? "";
      const workName = String(row.workName || row["工作项目名称"] || row.name || "").trim();
      const durationMinutes = Number(row.durationMinutes ?? row["工期分钟"] ?? 0);
      if (!workName) throw new Error(`工作项目名称为空：第${index + 1}行`);
      if (!Number.isFinite(durationMinutes) || durationMinutes < 0) throw new Error(`工期分钟必须为非负数：第${index + 1}行`);
      return {
        activityCode,
        workName,
        durationMinutes,
        predecessors: Array.isArray(predecessorText) ? predecessorText : String(predecessorText).split(/[、,;；]/).map((item) => item.trim()).filter(Boolean)
      };
    });
    const invalidPredecessor = jobs.flatMap((job) => job.predecessors).find((code) => !codes.has(code));
    if (invalidPredecessor) throw new Error(`紧前作业不存在：${invalidPredecessor}`);
    setSupportActivityJobs(activity, jobs);
    projectDraftStatus = `已导入 ${file.name}：${jobs.length} 个工作项目`;
    updatePreviewResultsThroughApiClient();
  } catch (err) {
    projectDraftStatus = `工作项目导入失败：${err?.message || "文件无法解析"}`;
  }
}

function normalizeEquipmentStructureImport(input) {
  const projectJson = input?.projectJson || input?.project_json || input?.scenario || input;
  if (projectJson && typeof projectJson === "object" && !Array.isArray(projectJson)) {
    const components = firstImportArray(projectJson, ["components", "equipmentComponents", "equipmentAssets"])
      || firstImportArray(projectJson.objects, ["components", "equipmentComponents", "equipmentAssets"]);
    if (components) {
      const equipment = projectJson.equipment || projectJson.objects?.equipment || {};
      return normalizeEquipmentStructureRows(components, {
        defaultModel: equipment.model || equipment.aircraftModel || "",
        wholeMachineModels: equipment.wholeMachineModels || [],
        quantity: equipment.quantity
      });
    }
  }
  return normalizeEquipmentStructureRows(Array.isArray(input) ? input : [input]);
}

function normalizeEquipmentStructureRows(rawRows, options = {}) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).filter((row) => row && typeof row === "object");
  const wholeMachineModels = new Set((Array.isArray(options.wholeMachineModels) ? options.wholeMachineModels : []).map(String).filter(Boolean));
  const components = [];
  rows.forEach((row, index) => {
    const explicitModel = pickImportText(row, ["aircraftModel", "aircraft_model", "整机", "整机名称", "飞机名称", "飞机型号", "装备型号", "targetProductModel"], "");
    const productType = pickImportText(row, ["productType", "product_type", "组件属性", "产品类型", "节点类型", "type"], "");
    const parentId = pickImportText(row, ["parentId", "parent_id", "父节点", "父节点ID", "上级节点", "parent"], "");
    const name = pickImportText(row, ["name", "组件名称", "节点名称", "装备名称", "componentName"], "");
    const id = pickImportText(row, ["id", "componentId", "组件ID", "节点ID", "object_id"], "");
    const isWholeMachine = /整机|whole|aircraft/i.test(productType) || (!parentId && explicitModel && (!id || explicitModel === id || explicitModel === name));
    const aircraftModel = explicitModel || options.defaultModel || pickImportText(row, ["model", "型号"], "");
    if (isWholeMachine) {
      wholeMachineModels.add(aircraftModel || name || id || `导入整机${wholeMachineModels.size + 1}`);
      return;
    }
    const componentAircraftModel = aircraftModel || Array.from(wholeMachineModels)[0] || options.defaultModel || "导入整机";
    wholeMachineModels.add(componentAircraftModel);
    const componentId = id || `${componentAircraftModel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-import-${index + 1}`;
    const quantity = Math.max(1, Math.floor(pickImportNumber(row, ["quantity", "数量", "装机数量", "n"], row.quantity ?? 1)));
    const importedKRaw = row.kOutOfN && typeof row.kOutOfN === "object" && !Array.isArray(row.kOutOfN)
      ? String(row.kOutOfN.k ?? "").trim()
      : pickImportText(row, ["kOutOfN", "k", "K值", "K值（n中取k）", "可用数量要求k", "n中取k"], "");
    const importedK = importedKRaw === "" ? quantity : Number(importedKRaw);
    const nextComponent = {
      ...row,
      id: componentId,
      name: name || componentId,
      aircraftModel: componentAircraftModel,
      parentId: parentId || "aircraft-root",
      productType: /^(LRU|SRU)$/i.test(productType) ? productType.toUpperCase() : (productType && !/整机|whole|aircraft/i.test(productType) ? productType : ""),
      quantity,
      kOutOfN: { enabled: quantity > 1, n: quantity, k: importedK },
      connectionType: pickImportText(row, ["connectionType", "连接方式", "结构类型"], row.connectionType || "串联"),
      mtbfHours: pickImportNumber(row, ["mtbfHours", "MTBF", "mtbf", "平均故障间隔"], row.mtbfHours ?? 120),
      meanRepairTimeMinutes: pickImportNumber(row, ["meanRepairTimeMinutes", "MTTR", "mttr", "平均修复时间"], row.meanRepairTimeMinutes ?? 120)
    };
    const kMessage = validateEquipmentComponentKOutOfN(nextComponent);
    if (kMessage) {
      throw new Error(`${name || componentId}：${kMessage}`);
    }
    components.push(normalizeEquipmentComponentKOutOfN(nextComponent));
  });
  const models = Array.from(wholeMachineModels).filter(Boolean);
  return {
    wholeMachineModels: models,
    components,
    quantity: Math.max(1, Math.floor(Number(options.quantity || 1)))
  };
}

async function importSupportResourceTableFile(file, activeResourceType) {
  const resourceType = normalizeSupportResourceImportType(activeResourceType);
  if (!resourceType) {
    supportResourceImportStatus = "请在备件、保障人员或保障设备页面导入资源表格。";
    return false;
  }
  if (!file) {
    supportResourceImportStatus = `未选择${resourceType}导入文件。`;
    return false;
  }
  try {
    const parsed = parseRmsEquipmentImportText(await file.text(), file.name);
    const rows = extractSupportResourceImportRows(parsed, resourceType);
    const importedCount = applySupportResourceImportRows(resourceType, rows);
    supportResourceImportStatus = `已导入 ${file.name}：${resourceType} ${importedCount} 行。`;
    updatePreviewResultsThroughApiClient();
    return true;
  } catch (err) {
    supportResourceImportStatus = `${resourceType}导入失败：${err && err.message ? err.message : "文件无法解析"}`;
    return false;
  }
}

function normalizeSupportResourceImportType(value) {
  const text = String(value || "").trim();
  if (["备件", "保障人员", "保障设备"].includes(text)) return text;
  return "";
}

function extractSupportResourceImportRows(input, resourceType) {
  if (Array.isArray(input)) {
    const supportNodeRows = supportResourceRowsFromSupportNodes(input, resourceType);
    return supportNodeRows.length ? supportNodeRows : input;
  }
  const directRows = supportResourceDirectRows(input, resourceType);
  if (directRows) return directRows;
  const supportNodes = supportNodesFromImportPayload(input);
  if (supportNodes.length) {
    const rows = supportResourceRowsFromSupportNodes(supportNodes, resourceType);
    if (rows.length) return rows;
  }
  if (input && typeof input === "object") return [input];
  throw new Error("导入表格未包含资源行");
}

function supportResourceDirectRows(input, resourceType) {
  if (!input || typeof input !== "object") return null;
  const keysByType = {
    "备件": ["rows", "data", "items", "resources", "spares", "spareRows", "备件"],
    "保障人员": ["rows", "data", "items", "resources", "personnel", "personnelRows", "保障人员"],
    "保障设备": ["rows", "data", "items", "resources", "equipment", "equipmentRows", "supportEquipment", "保障设备"]
  };
  return firstImportArray(input, keysByType[resourceType])
    || firstImportArray(input.objects, keysByType[resourceType]);
}

function supportNodesFromImportPayload(input) {
  const candidates = [
    input?.supportNodes,
    input?.scenario?.supportNodes,
    input?.projectJson?.supportNodes,
    input?.project_json?.supportNodes,
    input?.objects?.supportNodes,
    input?.objects?.support_nodes
  ];
  return candidates.find(Array.isArray) || [];
}

function firstImportArray(input, keys = []) {
  if (!input || typeof input !== "object") return null;
  for (const key of keys) {
    if (Array.isArray(input[key])) return input[key];
  }
  return null;
}

function supportResourceRowsFromSupportNodes(nodes, resourceType) {
  return (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
    const organizationNode = node.organizationNodeId || node.id || node.name || "";
    if (resourceType === "备件") {
      return Object.entries(node.inventory || {}).map(([spareName, quantity]) => ({
        organizationNode,
        name: spareName,
        model: node.spareModels?.[spareName] || spareName,
        equipment: node.spareEquipment?.[spareName] || "",
        quantity
      }));
    }
    if (resourceType === "保障人员" && Number.isFinite(Number(node.personnelCapacity))) {
      return [{
        organizationNode,
        model: normalizePersonnelSpecialtyName(node.personnelModel || node.personnelType),
        quantity: node.personnelCapacity
      }];
    }
    if (resourceType === "保障设备" && Number.isFinite(Number(node.equipmentCapacity))) {
      return [{
        organizationNode,
        name: node.supportEquipmentName || node.equipmentName || node.name || "保障设备",
        model: node.supportEquipmentModel || node.nodeType || "保障设备",
        quantity: node.equipmentCapacity
      }];
    }
    return [];
  });
}

function applySupportResourceImportRows(resourceType, rawRows) {
  const targetOrgNodes = selectedSupportImportOrgNodes();
  if (!targetOrgNodes.length) throw new Error("未找到可导入的保障组织节点");
  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map((row, index) => normalizeSupportResourceImportRow(resourceType, row, targetOrgNodes, index))
    .filter(Boolean);
  if (!rows.length) throw new Error("导入表格未包含有效资源行");

  const importedOrgIds = new Set(rows.map((row) => row.organizationNode.id || row.organizationNode.name).filter(Boolean));
  clearSupportResourcesForImport(resourceType, importedOrgIds);
  clearDeletedSupportResourceKeysForOrgs(importedOrgIds);

  const rowCountsByOrg = new Map();
  rows.forEach((row, index) => {
    const orgId = row.organizationNode.id || row.organizationNode.name;
    const rowIndex = rowCountsByOrg.get(orgId) || 0;
    rowCountsByOrg.set(orgId, rowIndex + 1);
    supportNodeForOrgNode(row.organizationNode, true);
    if (resourceType === "备件") {
      const resource = createSupportResourceImportNode(row.organizationNode, resourceType, index);
      resource.name = row.name;
      resource.model = row.model || row.name;
      resource.equipment = row.equipment || "";
      resource.quantity = row.quantity;
      return;
    }
    const resource = createSupportResourceImportNode(row.organizationNode, resourceType, index);
    if (resourceType === "保障人员") {
      resource.quantity = row.quantity;
      resource.model = normalizePersonnelSpecialtyName(row.model);
    } else if (resourceType === "保障设备") {
      resource.quantity = row.quantity;
      resource.name = row.name || "保障设备";
      resource.model = row.model || "保障设备";
    }
  });
  selectedSupportResourceKeys = new Set();
  return rows.length;
}

function normalizeSupportResourceImportRow(resourceType, row, targetOrgNodes, index) {
  if (!row || typeof row !== "object") return null;
  const organizationNode = resolveSupportResourceImportOrgNode(row, targetOrgNodes, index);
  if (!organizationNode) return null;
  if (resourceType === "备件") {
    const name = pickImportText(row, ["备件名称", "备件", "spareName", "spareType", "name", "名称", "spareId"], `导入备件${index + 1}`);
    return {
      organizationNode,
      name,
      model: pickImportText(row, ["型号", "备件型号", "model", "partNo", "规格型号"], name),
      equipment: pickImportText(row, ["所属装备", "适用飞机", "适用装备", "equipment", "equipmentId", "aircraftModel"], ""),
      quantity: pickImportNumber(row, ["数量", "库存量", "stockQty", "quantity", "spareQuantity", "capacity"], 0)
    };
  }
  if (resourceType === "保障人员") {
    return {
      organizationNode,
      model: normalizePersonnelSpecialtyName(pickImportText(row, ["专业", "人员类型", "personnelType", "skills", "技能标签", "model", "type"], "")),
      quantity: pickImportNumber(row, ["数量", "能力人数", "capacity", "personnelCapacity", "人员容量"], 0)
    };
  }
  return {
    organizationNode,
    name: pickImportText(row, ["设备名称", "保障设备", "resourceName", "name", "名称", "resourceId"], `导入保障设备${index + 1}`),
    model: pickImportText(row, ["型号", "设备型号", "resourceModel", "model", "nodeType", "规格型号"], "保障设备"),
    quantity: pickImportNumber(row, ["数量", "设备数量", "quantity", "equipmentCapacity", "capacity"], 0)
  };
}

function selectedSupportImportOrgNodes() {
  const selected = selectedSupportOrgTreeNode();
  const scopeNodes = selected ? [selected] : supportOrganizationTree();
  const leafNodes = flattenSupportOrgTreeNodes(scopeNodes).filter((node) => !(node.children || []).length);
  return leafNodes.length ? leafNodes : [selected].filter(Boolean);
}

function resolveSupportResourceImportOrgNode(row, targetOrgNodes, index) {
  const orgValue = pickImportText(row, [
    "organizationNodeId",
    "组织节点ID",
    "组织节点",
    "所属节点",
    "所属保障节点",
    "保障节点",
    "nodeId",
    "节点ID",
    "节点名称",
    "organizationNode"
  ], "");
  const allOrgNodes = flattenSupportOrgTreeNodes();
  if (orgValue) {
    const matched = allOrgNodes.find((node) => [node.id, node.name, node.supportNodeId].includes(orgValue));
    if (matched) return matched;
  }
  return targetOrgNodes[Math.min(index, targetOrgNodes.length - 1)] || targetOrgNodes[0] || null;
}

function clearSupportResourcesForImport(resourceType, orgIds) {
  if (!Array.isArray(scenario.supportResources)) scenario.supportResources = [];
  const orgNames = new Set(Array.from(orgIds).map((id) => findSupportOrgTreeNode(id)?.name).filter(Boolean));
  const typeValue = supportResourceTypeValue(resourceType);
  scenario.supportResources = scenario.supportResources.filter((resource) => {
    return !(resource.type === typeValue && supportResourceMatchesOrgSet(resource, orgIds, orgNames));
  });
}

function supportResourceMatchesOrgSet(resource, orgIds, orgNames) {
  return orgIds.has(resource.organizationNodeId || "")
    || orgIds.has(resource.supportNodeName || "")
    || orgNames.has(resource.supportNodeName || "");
}

function clearDeletedSupportResourceKeysForOrgs(orgIds) {
  void orgIds;
}

function createSupportResourceImportNode(orgNode, resourceType, index) {
  if (!Array.isArray(scenario.supportResources)) scenario.supportResources = [];
  const typeKey = supportResourceTypeValue(resourceType) || "resource";
  const resource = {
    id: `${orgNode.id || "support-org"}-${typeKey}-${Date.now()}-${index}`,
    supportNodeName: orgNode.name || orgNode.id || "保障节点",
    type: typeKey,
    name: resourceType,
    model: "",
    quantity: 0
  };
  scenario.supportResources.push(resource);
  return resource;
}

function pickImportText(row, keys, fallback = "") {
  const source = row || {};
  const entries = Object.entries(source);
  const lowerValueByKey = new Map(entries.map(([key, value]) => [String(key).trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = Object.prototype.hasOwnProperty.call(source, key)
      ? source[key]
      : lowerValueByKey.get(String(key).trim().toLowerCase());
    if (value == null) continue;
    const text = Array.isArray(value) ? value.filter(Boolean).join("、") : String(value).trim();
    if (text) return text;
  }
  return fallback;
}

function pickImportNumber(row, keys, fallback = 0) {
  const text = pickImportText(row, keys, "");
  if (!text) return fallback;
  const matched = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const value = matched ? Number(matched[0]) : Number(text);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function parseRmsEquipmentImportText(text, filename = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("文件为空");
  const looksLikeJson = filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksLikeJson) return JSON.parse(trimmed);
  return parseDelimitedTable(trimmed);
}

function parseDelimitedTable(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV 表格至少需要表头和一行数据");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"' && quoted && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

async function handleSystemUserAction(action) {
  if (action === "add") {
    openSystemUserEditor();
    return;
  }
  if (action === "save") {
    await saveSystemUserEditor();
    return;
  }
  if (action === "cancel") {
    systemUserEditor = null;
  }
  if (action === "delete-selected") {
    await deleteSystemUsers(Array.from(selectedSystemUsernames));
  }
}

function filteredSystemUsers() {
  const query = systemUserSearchText.trim().toLowerCase();
  if (!query) return systemUsers;
  return systemUsers.filter((user) => [
    user.username,
    user.name,
    user.role,
    user.status
  ].some((value) => String(value || "").toLowerCase().includes(query)));
}

function openSystemUserEditor(username = "") {
  const existingUser = systemUsers.find((user) => user.username === username);
  systemUserEditor = {
    mode: existingUser ? "edit" : "add",
    originalUserId: existingUser?.user_id || "",
    originalUsername: existingUser?.username || "",
    user: existingUser
      ? { ...existingUser }
      : { username: "", name: "", role: "普通用户", status: "启用", password: "" }
  };
}

async function deleteSystemUsers(usernames) {
  const targets = new Set(usernames.filter(Boolean));
  if (!targets.size) {
    systemUsersLoadStatus = "请先选择要删除的用户";
    return;
  }
  if (targets.has("admin")) {
    systemUsersLoadStatus = "系统管理员 admin 不允许删除";
    selectedSystemUsernames = new Set(Array.from(selectedSystemUsernames).filter((username) => username !== "admin"));
    return;
  }
  const usersToDelete = systemUsers.filter((user) => targets.has(user.username));
  try {
    for (const user of usersToDelete) {
      if (user.user_id) await backendApi.deleteUser(user.user_id);
    }
    systemUsers = systemUsers.filter((user) => !targets.has(user.username));
    selectedSystemUsernames = new Set(Array.from(selectedSystemUsernames).filter((username) => !targets.has(username)));
    systemUsersLoaded = true;
    systemUsersLoadStatus = `已删除 ${usersToDelete.length} 个用户`;
  } catch (err) {
    systemUsersLoadStatus = `用户删除失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function updatePermissionRole(feature, encodedRole) {
  const row = SYSTEM_PERMISSION_ROWS.find((item) => item.feature === feature);
  if (!row) return;
  const [roleKey, value] = String(encodedRole || "").split(":");
  if (["admin", "data", "user"].includes(roleKey)) {
    row[roleKey] = normalizePermissionLevel(value);
    permissionConfigStatus = `已更新 ${feature} / ${permissionRoleLabel(roleKey)}：${row[roleKey]}`;
  }
}

function addPersonnelSpecialtyDraft() {
  const value = personnelSpecialtyDraft.trim();
  if (!value) {
    systemRuntimeConfigStatus = "请输入保障人员专业";
    return;
  }
  setConfiguredPersonnelSpecialties([...configuredPersonnelSpecialties(), value]);
  personnelSpecialtyDraft = "";
  systemRuntimeConfigStatus = "保障人员专业字典已更新，待保存";
}

function deletePersonnelSpecialty(value) {
  const target = String(value || "").trim();
  setConfiguredPersonnelSpecialties(configuredPersonnelSpecialties().filter((item) => item !== target));
  systemRuntimeConfigStatus = "保障人员专业字典已更新，待保存";
}

function permissionRoleLabel(roleKey) {
  return { admin: "系统管理员", data: "数据管理员", user: "项目用户" }[roleKey] || roleKey;
}

async function saveSystemUserEditor() {
  if (!systemUserEditor) return;
  const user = normalizeSystemUser(systemUserEditor.user);
  if (!user.username) {
    systemUsersLoadStatus = "用户名不能为空";
    return;
  }
  try {
    if (systemUserEditor.mode === "edit") {
      const userId = systemUserEditor.originalUserId || systemUsers.find((item) => item.username === systemUserEditor.originalUsername)?.user_id;
      const updated = await backendApi.updateUser(userId, toBackendUserPayload(user));
      systemUsers = systemUsers.map((item) => item.username === systemUserEditor.originalUsername ? fromBackendUser(updated) : item);
      systemUsersLoadStatus = `用户已更新：${updated.username}`;
    } else {
      const created = await backendApi.createUser(toBackendUserPayload(user));
      systemUsers = [...systemUsers.filter((item) => item.username !== created.username), fromBackendUser(created)];
      systemUsersLoadStatus = `用户已创建：${created.username}`;
    }
    systemUsersLoaded = true;
    systemUserEditor = null;
  } catch (err) {
    systemUsersLoadStatus = `用户保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function normalizeSystemUser(user) {
  const username = String(user.username || "").trim();
  const name = String(user.name || "").trim() || username || "未命名用户";
  const role = String(user.role || "").trim() || "普通用户";
  const status = String(user.status || "").trim() || "启用";
  const password = String(user.password || "").trim();
  return { ...user, username, name, role, status, password };
}

function ensureSystemUsersLoaded() {
  if (systemUsersLoaded || systemUsersLoadStatus === "加载中") return;
  systemUsersLoadStatus = "加载中";
  backendApi.listUsers()
    .then((payload) => {
      systemUsers = (payload.users || []).map(fromBackendUser);
      systemUsersLoaded = true;
      systemUsersLoadStatus = "已从后端加载用户";
      render();
    })
    .catch((err) => {
      systemUsersLoaded = true;
      systemUsersLoadStatus = `用户后端不可用：${err && err.message ? err.message : "Backend API 不可用"}`;
      render();
    });
}

function fromBackendUser(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    name: user.display_name || user.name || user.username,
    role: user.role || "普通用户",
    status: displayUserStatus(user.status)
  };
}

function toBackendUserPayload(user) {
  return {
    username: user.username,
    password: user.password || undefined,
    role: user.role,
    display_name: user.name,
    status: backendUserStatus(user.status)
  };
}

function displayUserStatus(status) {
  if (status === "active" || status === "enabled") return "启用";
  if (status === "disabled" || status === "inactive") return "停用";
  return status || "启用";
}

function backendUserStatus(status) {
  if (status === "启用") return "active";
  if (status === "停用" || status === "禁用") return "disabled";
  return status || "active";
}

async function importModelingImportJsonFile(file) {
  if (!file) {
    modelingImportStatus = "未选择导入包 JSON 文件";
    return;
  }
  let importPackage;
  try {
    importPackage = JSON.parse(await file.text());
  } catch (err) {
    modelingImportStatus = `导入包 JSON 读取失败：${err && err.message ? err.message : "文件不是合法 JSON"}`;
    return;
  }
  const issues = validateModelingImportPackage(importPackage);
  modelingImportPackage = cloneModelingImportPackage(importPackage);
  modelingImportValidation = {
    ok: issues.length === 0,
    status: issues.length ? "invalid" : "valid",
    issues
  };
  modelingImportPackage.validation = cloneModelingImportPackage(modelingImportValidation);
  modelingImportPublishedPackage = null;
  modelingImportCompileResult = null;
  modelingImportSaved = false;
  modelingImportStatus = issues.length
    ? `导入包 JSON 已加载，发现 ${issues.length} 个字段问题`
    : `导入包 JSON 已加载：${importPackage.importId || file.name}`;
}

async function handleModelingImportAction(action, options = {}) {
  if (action === "load-fixture") {
    const templatePackage = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
    try {
      const stored = await backendApi.getModelingImport(templatePackage.importId);
      if (sampleImportPackageIsComplete(stored?.publishedPackage || stored?.draftPackage, templatePackage)) {
        applyModelingImportRecord(stored);
        modelingImportStatus = "已从后端恢复导入草稿和发布快照";
      } else {
        modelingImportPackage = cloneModelingImportPackage(templatePackage);
        modelingImportPublishedPackage = null;
        modelingImportValidation = cloneModelingImportPackage(modelingImportPackage.validation || {});
        modelingImportSaved = false;
        modelingImportStatus = "内嵌样例导入包已加载";
      }
      modelingImportCompileResult = null;
    } catch {
      modelingImportPackage = templatePackage;
      modelingImportStatus = "内嵌样例导入包已加载";
      modelingImportPublishedPackage = null;
      modelingImportValidation = cloneModelingImportPackage(
        modelingImportPackage.validation || MODELING_IMPORT_DEMO_FIXTURE.validation
      );
      modelingImportCompileResult = null;
      modelingImportSaved = false;
    }
    return;
  }

  if (action === "load-invalid-fixture") {
    modelingImportPackage = createInvalidModelingImportFixture();
    modelingImportPublishedPackage = null;
    modelingImportValidation = {
      ok: false,
      status: "invalid",
      issues: validateModelingImportPackage(modelingImportPackage)
    };
    modelingImportPackage.validation = cloneModelingImportPackage(modelingImportValidation);
    modelingImportCompileResult = null;
    modelingImportStatus = "错误样例已加载，字段级问题已定位";
    modelingImportSaved = false;
    return;
  }

  if (action === "backfill-current-project") {
    try {
      await flushPendingProjectDraftAutosave();
      const projectJson = buildBackendProjectJson(scenario, currentProject || {});
      modelingImportPackage = projectToModelingImportPackage(projectJson, modelingImportPackage);
      modelingImportValidation = cloneModelingImportPackage(modelingImportPackage.validation);
      modelingImportCompileResult = null;
      modelingImportSaved = false;
      const issueCount = modelingImportValidation.issues?.length || 0;
      modelingImportStatus = issueCount
        ? `已按当前项目回灌导入 JSON 草稿，发现 ${issueCount} 个字段问题`
        : `已按当前项目回灌导入 JSON 草稿：${modelingImportPackage.importId}`;
    } catch (err) {
      setModelingImportActionError("当前项目回灌失败", "projectToModelingImportPackage", err);
    }
    return;
  }

  if (action === "validate") {
    try {
      modelingImportValidation = await backendApi.validateModelingImport(modelingImportPackage);
      modelingImportPackage = {
        ...modelingImportPackage,
        validation: cloneModelingImportPackage(modelingImportValidation)
      };
      modelingImportStatus = modelingImportValidation.ok === false ? "校验未通过" : "校验通过";
    } catch (err) {
      setModelingImportActionError("校验失败", "backendApi.validateModelingImport", err);
    }
    return;
  }

  if (action === "save-draft") {
    try {
      modelingImportPackage = {
        ...cloneModelingImportPackage(modelingImportPackage),
        lifecycle: {
          ...(modelingImportPackage.lifecycle || {}),
          state: "draft"
        }
      };
      const saved = await backendApi.saveModelingImport(modelingImportPackage);
      const stored = await backendApi.getModelingImport(modelingImportPackage.importId);
      applyModelingImportRecord(stored);
      if (saved.validation_status) {
        modelingImportValidation = {
          ...modelingImportValidation,
          status: saved.validation_status,
          issues: saved.validation_status === "valid" ? [] : (modelingImportValidation.issues || [])
        };
      }
      modelingImportSaved = true;
      modelingImportStatus = `草稿已保存：${saved.import_id || modelingImportPackage.importId}`;
    } catch (err) {
      setModelingImportActionError("草稿保存失败", "backendApi.saveModelingImport", err);
    }
    return;
  }

  if (action === "publish") {
    if (!modelingImportSaved) {
      modelingImportStatus = "请先保存草稿，再发布导入包";
      return;
    }
    try {
      const publishResult = await publishModelingImportWithReferencedVersionFallback({
        backendApi,
        importPackage: modelingImportPackage
      });
      applyModelingImportRecord(publishResult.published);
      persistLastPublishedModelingImportId(modelingImportPackage.importId);
      selectedPublishedModelingImportId = modelingImportPackage.importId;
      publishedModelingImportPackagesLoaded = false;
      ensurePublishedModelingImportPackagesLoaded({ force: true });
      modelingImportSaved = true;
      modelingImportStatus = publishResult.versioned
        ? `原发布快照已被运行引用，已发布新版本：${modelingImportPackage.importId}`
        : `已发布：${modelingImportPackage.importId}`;
    } catch (err) {
      setModelingImportActionError("发布失败", "backendApi.publishModelingImport", err);
    }
    return;
  }

  if (action === "compile-scenario") {
    if (!modelingImportPublishedPackage) {
      modelingImportStatus = "请先发布导入包，再生成 Scenario";
      return;
    }
    try {
      modelingImportCompileResult = await backendApi.compileModelingImportScenario(modelingImportPackage.importId, FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY);
      if (isBlockedModelingImportCompileResult(modelingImportCompileResult)) {
        applyModelingImportCompileGateResult(modelingImportCompileResult);
        return;
      }
      applyModelingImportCompileWarnings(modelingImportCompileResult);
      const scenarioId = modelingImportCompileResult?.scenario?.scenario_id || modelingImportCompileResult?.scenario?.scenarioId || "Scenario";
      modelingImportStatus = `已生成 ${scenarioId}`;
    } catch (err) {
      setModelingImportActionError("Scenario 生成失败", "backendApi.compileModelingImportScenario", err);
    }
    return;
  }

  if (action === "create-project") {
    if (!modelingImportPublishedPackage) {
      modelingImportStatus = "请先发布导入包，再生成示例 Project";
      return;
    }
    const importId = options.importId || currentPublishedModelingImportId();
    if (!importId) {
      modelingImportStatus = "未找到当前发布导入包 importId";
      return;
    }
    await createSampleProjectFromPublishedImport(importId);
    modelingImportStatus = projectListStatus;
  }
}

function applyModelingImportRecord(record) {
  const state = normalizeModelingImportRecord(record, MODELING_IMPORT_DEMO_FIXTURE);
  modelingImportPackage = state.importPackage;
  modelingImportPublishedPackage = state.publishedPackage;
  modelingImportValidation = state.validation;
  modelingImportSaved = state.saved;
}

function createInvalidModelingImportFixture() {
  const draft = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
  draft.importId = "import-carrier-day-night-invalid";
  draft.objects.equipmentAssets[1].quantity = 0;
  draft.objects.supportActivities[0].resourceId = "missing-resource";
  draft.validation = { status: "invalid", issues: [] };
  return draft;
}

function isBlockedModelingImportCompileResult(compileResult) {
  return Boolean(compileResult?.status && compileResult.status !== "compiled");
}

function applyModelingImportCompileGateResult(compileResult) {
  const issues = modelingImportIssuesFromEnvelope(compileResult);
  const status = compileResult?.status || "blocked";
  const displayIssues = issues.length ? issues : [
    {
      code: "compile_gate_blocked",
      severity: "error",
      page: "建模数据入口",
      object_id: modelingImportPackage.importId || "modeling-import-package",
      field_path: "compile-scenario",
      message: compileResult?.message || `Scenario compiler returned ${status}.`
    }
  ];
  modelingImportValidation = {
    ok: false,
    status,
    usedTables: cloneModelingImportPackage(compileResult?.usedTables || {}),
    issues: displayIssues
  };
  modelingImportPackage = {
    ...modelingImportPackage,
    validation: cloneModelingImportPackage(modelingImportValidation)
  };
  const errorCount = displayIssues.filter((issue) => issue.severity !== "warning").length;
  const warningCount = displayIssues.filter((issue) => issue.severity === "warning").length;
  modelingImportStatus = `Scenario 生成未完成：${status}（错误 ${errorCount}，警告 ${warningCount}）`;
}

function applyModelingImportCompileWarnings(compileResult) {
  const issues = modelingImportIssuesFromEnvelope(compileResult);
  if (!issues.length) return;
  modelingImportValidation = {
    ...(modelingImportValidation || {}),
    ok: !issues.some((issue) => issue.severity !== "warning"),
    status: issueStatusForDisplayIssues(issues),
    usedTables: cloneModelingImportPackage(compileResult?.usedTables || {}),
    issues
  };
  modelingImportPackage = {
    ...modelingImportPackage,
    validation: cloneModelingImportPackage(modelingImportValidation)
  };
}

function setModelingImportActionError(label, fieldPath, err) {
  const message = `${label}：${err && err.message ? err.message : "Backend API 不可用"}`;
  const backendIssues = modelingImportIssuesFromEnvelope(err?.details);
  modelingImportStatus = message;
  modelingImportValidation = {
    status: backendIssues.length ? issueStatusForDisplayIssues(backendIssues) : "blocked",
    issues: backendIssues.length ? backendIssues : [
      {
        code: err?.code || "modeling_import_action_failed",
        severity: "error",
        page: "建模数据入口",
        object_id: modelingImportPackage.importId || "modeling-import-package",
        field_path: fieldPath,
        message
      }
    ]
  };
}

function modelingImportIssuesFromEnvelope(envelope) {
  const errors = Array.isArray(envelope?.errors) ? envelope.errors : [];
  const issues = Array.isArray(envelope?.issues) ? envelope.issues : [];
  const warnings = Array.isArray(envelope?.warnings) ? envelope.warnings : [];
  return dedupeModelingImportIssues([
    ...errors.map((issue) => normalizeModelingImportDisplayIssue(issue, "error")),
    ...issues.map((issue) => normalizeModelingImportDisplayIssue(issue, "error")),
    ...warnings.map((issue) => normalizeModelingImportDisplayIssue(issue, "warning"))
  ]);
}

function normalizeModelingImportDisplayIssue(issue, fallbackSeverity) {
  return {
    code: issue?.code || "-",
    severity: issue?.severity || fallbackSeverity,
    page: issue?.page || "建模数据入口",
    object_id: issue?.object_id || issue?.objectId || modelingImportPackage.importId || "modeling-import-package",
    field_path: issue?.field_path || issue?.fieldPath || issue?.path || "-",
    message: issue?.message || "-"
  };
}

function dedupeModelingImportIssues(issues) {
  const seen = new Set();
  const deduped = [];
  for (const issue of issues) {
    const key = [issue.severity, issue.code, issue.field_path, issue.message].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }
  return deduped;
}

function issueStatusForDisplayIssues(issues) {
  return issues.some((issue) => issue.severity !== "warning") ? "invalid" : "valid";
}

async function handleMesaControl(action) {
  if (action === "reload-solara") {
    visualizationReplayStatus = "Solara 正在保存当前建模数据并刷新内嵌页";
    try {
      await saveSelectedProjectJsonForSolaraVisualization();
      solaraVisualizationReloadNonce += 1;
      visualizationReplayStatus = "Solara 已保存当前建模数据，将从后端项目重新编译推演输入";
    } catch (err) {
      visualizationReplayStatus = `Solara 刷新失败：当前建模数据未保存（${err && err.message ? err.message : "后端接口不可用"}）`;
    }
    return;
  }
  if (action === "refresh-runs") {
    await refreshVisualizationRunList();
    return;
  }
  if (action === "subscribe-run") {
    subscribeVisualizationRunStream();
    return;
  }
  if (action === "stop-subscription") {
    stopVisualizationRunStream("M9.2 在线状态流订阅已停止");
    return;
  }
  if (action === "load-replay") {
    stopVisualizationRunStream("正在加载离线 artifact，M9.2 在线订阅已停止");
    await loadVisualizationReplayForRun();
    return;
  }
  if (action === "play") {
    stopVisualizationRunStream("正在启动离线回放，M9.2 在线订阅已停止");
    if (
      !visualizationStateSeries
      || isVisualizationStateSeriesFromStream()
      || (visualizationSelectedRunId && visualizationStateSeries.run_id !== visualizationSelectedRunId)
    ) {
      await loadVisualizationReplayForRun();
    }
    if (visualizationStateSeries && !isVisualizationStateSeriesFromStream()) {
      visualizationReplayPlaying = !visualizationReplayPlaying;
      if (visualizationReplayPlaying) startVisualizationReplay();
      else stopVisualizationReplay();
    } else {
      stopVisualizationReplay();
    }
    return;
  }
  const controlAction = backendControlActions[action];
  if (controlAction) {
    const runId = visualizationSelectedRunId || backendRun?.run_id;
    const label = backendControlLabels[controlAction] || controlAction;
    if (!runId) {
      visualizationBackendControlStatus = `${label}失败：尚未选择 run_id`;
      return;
    }
    visualizationBackendControlStatus = `正在请求后端${label}：run ${runId}`;
    try {
      const confirmed = await backendApi.controlRun(runId, controlAction);
      const confirmedRunId = confirmed?.run_id || runId;
      backendRun = { ...(backendRun || {}), ...confirmed, run_id: confirmedRunId };
      visualizationSelectedRunId = confirmedRunId;
      visualizationBackendControlStatus = `后端已确认${label}：run ${confirmedRunId} / ${runStatusLabel(backendRun)}`;
      if (controlAction === "cancel") {
        stopVisualizationRunStream(`run ${confirmedRunId} 已取消，M9.2 在线订阅已停止`);
      }
      await refreshVisualizationRunList(confirmedRunId);
      await refreshRunResultThroughApi(confirmedRunId);
      visualizationBackendControlStatus = `后端已确认${label}：run ${confirmedRunId} / ${runStatusLabel(backendRun)}`;
    } catch (err) {
      visualizationBackendControlStatus = `${label}失败：${formatBackendError(err)}`;
    }
    return;
  }
  if (visualizationStateSeries && !isVisualizationStateSeriesFromStream()) {
    if (action === "step") {
      visualizationReplayIndex = nextReplayIndex(visualizationStateSeries, visualizationReplayIndex, 1);
      stopVisualizationReplay();
      return;
    }
    if (action === "reset") {
      visualizationReplayIndex = 0;
      stopVisualizationReplay();
      return;
    }
  }
  if (["step", "reset"].includes(action)) {
    stopVisualizationReplay();
    visualizationReplayStatus = "尚未加载 Lite Mesa state_series 时不会在前端伪造运行控制";
  }
}

function startVisualizationReplay() {
  if (visualizationReplayTimer || !visualizationStateSeries || isVisualizationStateSeriesFromStream()) return;
  visualizationReplayTimer = setInterval(() => {
    const nextIndex = nextReplayIndex(visualizationStateSeries, visualizationReplayIndex, 1);
    visualizationReplayIndex = nextIndex;
    if (nextIndex >= visualizationStateSeries.frames.length - 1) {
      stopVisualizationReplay();
    }
    render();
  }, 900);
}

function isVisualizationStateSeriesFromStream(series = visualizationStateSeries) {
  return Boolean(series && series.stream_id && series.expected_frame_count);
}

function stopVisualizationReplay() {
  visualizationReplayPlaying = false;
  if (!visualizationReplayTimer) return;
  clearInterval(visualizationReplayTimer);
  visualizationReplayTimer = null;
}

function visualizationBlockedState() {
  return {
    snapshot: {
      elapsed_hours: 0,
      aircraft_count: 0,
      planned_sorties: 0,
      completed_sorties: 0,
      active_jobs: 0,
      spare_stock_total: 0,
      sortie_completion_rate: 0
    },
    aircraft: [],
    missions: [],
    resources: [],
    spares: [],
    jobs: [],
    events: [],
    mission_templates: {},
    failure_tree_templates: {}
  };
}

function renderVisualSimulation(page) {
  const projectName = currentProject?.name || "当前项目";
  const context = selectedExperimentPlanContext();
  const experimentPlanName = selectedExperimentPlanName();
  const planConfig = context?.kind === "experiment-plan" && context.plan?.config && typeof context.plan.config === "object" && !Array.isArray(context.plan.config)
    ? context.plan.config
    : {};
  const planRuntimeContext = context?.kind === "experiment-plan"
    ? {
        experimentPlanId: context.plan.experiment_plan_id,
        planSteps: planConfig.steps,
        planSamples: planConfig.samples,
        planSeed: planConfig.seed
      }
    : {};
  const solaraUrl = buildSolaraVisualizationUrl(resolveSolaraVisualizationBaseUrl(), {
    projectId: solaraVisualizationProjectIdOverride || currentProject?.project_id || scenario.project_id || scenario.scenarioId || "",
    projectName,
    featureId: page.id,
    ...(context?.kind === "experiment-plan" ? { experimentPlanName } : {}),
    ...planRuntimeContext,
    reload: solaraVisualizationReloadNonce
  });
  return `
    <div class="mesa-visual-shell">
      <section class="mesa-visual-toolbar">
        <div><strong>可视化推演</strong><span>${htmlEscape(projectName)}</span></div>
        <div class="lite-mesa-hero-actions">
          ${renderExperimentPlanContextDropdown(page)}
        </div>
      </section>
      <div class="solara-visualization-frame-wrap" data-solara-visualization-frame>
        <div class="visual-frame-toolbar">
          <button type="button" class="btn-primary" data-mesa-control="reload-solara">刷新推演</button>
        </div>
        <iframe
          class="solara-visualization-frame"
          title="Solara 可视化推演"
          src="${htmlEscape(solaraUrl)}"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="eager"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>
    </div>
  `;
}

function visualizationStreamEventClass() {
  if (["connected", "artifact-ready"].includes(visualizationStreamState.status)) return "success";
  if (["unauthorized", "failed"].includes(visualizationStreamState.status)) return "warning";
  if (visualizationStreamState.status === "disconnected") return "warning";
  return "info";
}

function renderVisualizationEventStream(events, activeFrameIndex) {
  return `
    <div class="backend-run-chain mesa-event-window" data-mesa-event-stream>
      <div class="section-head">
        <h3>仿真日志</h3>
        <span>${events.length ? `${events.length} 条日志` : "等待仿真日志"}</span>
      </div>
      ${events.length ? `
        <details class="simulation-log-collapse">
          <summary><strong>全部保障事件</strong><span>${events.length} 条，点击展开</span></summary>
          <div class="stack-list">
            ${events.map((event) => `
              <button type="button" class="event simulation-log-event ${event.frame_index === activeFrameIndex ? "success" : htmlEscape(event.severity || "info")}" data-mesa-event-jump="${htmlEscape(event.frame_index)}">
                <span class="simulation-log-head">
                  <strong>${htmlEscape(simulationDayMinuteLabel(event.simulation_time))}</strong>
                  <em>${htmlEscape(event.log_type || simulationLogTypeLabel(event.event_type || event.event))}</em>
                </span>
                <span>${htmlEscape(event.message)}</span>
                <small>frame ${htmlEscape(Number(event.frame_index) + 1)} / step ${htmlEscape(event.step)} / run ${htmlEscape(event.run_id || "-")}</small>
              </button>
            `).join("")}
          </div>
        </details>
      ` : `<div class="event warning">暂无任务分配、保障作业、任务启动/结束、故障或维修日志。</div>`}
    </div>
  `;
}

function mesaTab(id, label, activeView) {
  return `<button type="button" class="mesa-tab ${activeView === id ? "active" : ""}" data-mesa-view="${id}">${label}</button>`;
}

function visualSimulationKpis(state) {
  const aircraftCount = state.aircraft.length || 1;
  const usableAircraft = state.aircraft.filter((aircraft) => ["available", "mission_ready"].includes(aircraft.state)).length;
  const requiredSorties = state.missions.reduce((sum, mission) => sum + Number(mission.requiredAircraft || 0), 0);
  const assignedSorties = state.missions.reduce((sum, mission) => sum + Number(mission.assignedCount || 0), 0);
  const aircraftTrendCounts = countAircraftTrendStates(state.aircraft);
  const stockedSpares = state.spares.filter((spare) => Number(spare.quantity || 0) > 0).length;
  return [
    { label: "使用可用度", value: ratioFixed(usableAircraft / aircraftCount) },
    { label: "出动架次率", value: ratioFixed(assignedSorties / Math.max(1, requiredSorties)) },
    { label: "维修中飞机", value: `${aircraftTrendCounts.maintenance} 架` },
    { label: "保障中飞机", value: `${aircraftTrendCounts.support} 架` },
    { label: "备件满足率", value: ratioFixed(stockedSpares / Math.max(1, state.spares.length)) }
  ];
}

function buildAvailabilityTrend(state, series, currentFrameIndex = null) {
  const frames = Array.isArray(series?.frames) ? series.frames : [];
  const currentIndex = Number.isFinite(Number(currentFrameIndex))
    ? Math.max(0, Math.min(frames.length - 1, Number(currentFrameIndex)))
    : frames.length - 1;
  const replayedFrames = frames.slice(0, currentIndex + 1);
  const trend = replayedFrames.map((frame, index) => {
    const aircraft = Array.isArray(frame.aircraft) ? frame.aircraft : [];
    const counts = aircraft.length
      ? countAircraftTrendStates(aircraft)
      : countAircraftTrendSnapshot(frame);
    const total = Number(frame.snapshot?.aircraft_count ?? aircraft.length ?? state.aircraft.length);
    return {
      label: `T+${Number(frame.simulation_time ?? frame.step ?? index).toFixed(0)}`,
      total,
      ...counts
    };
  });
  if (trend.length > 0) return trend;
  const total = state.aircraft.length || 1;
  const counts = countAircraftTrendStates(state.aircraft);
  return [{
    label: "当前",
    total,
    ...counts
  }];
}

function countAircraftTrendStates(aircraftList = []) {
  return aircraftList.reduce((counts, aircraft) => {
    const state = String(aircraft?.state || "available").toLowerCase();
    if (!isMaintenanceAircraftState(state)) counts.available += 1;
    if (isMissionAircraftState(state)) counts.mission += 1;
    if (isMaintenanceAircraftState(state)) counts.maintenance += 1;
    if (isSupportAircraftState(state)) counts.support += 1;
    return counts;
  }, { available: 0, mission: 0, maintenance: 0, support: 0 });
}

function countAircraftTrendSnapshot(frame = {}) {
  const aircraftState = frame.aircraft_state && typeof frame.aircraft_state === "object" ? frame.aircraft_state : {};
  const resourceState = frame.resource_state && typeof frame.resource_state === "object" ? frame.resource_state : {};
  const snapshot = frame.snapshot && typeof frame.snapshot === "object" ? frame.snapshot : {};
  return {
    available: Number(snapshot.available_aircraft ?? aircraftState.available_aircraft ?? 0),
    mission: Number(aircraftState.flying_count ?? aircraftState.sortie_count ?? aircraftState.flying_aircraft ?? 0),
    maintenance: Number(aircraftState.repairing_count ?? aircraftState.maintenance_aircraft ?? 0),
    support: Number(aircraftState.postflight_count ?? aircraftState.pre_support_aircraft ?? 0)
      + Number(resourceState.postflight_backlog ?? 0)
  };
}

function isMaintenanceAircraftState(state) {
  return ["maintenance", "repair", "repairing", "preventive_maintenance", "corrective_maintenance"].includes(state)
    || state.includes("maintenance")
    || state.includes("repair");
}

function isMissionAircraftState(state) {
  return ["flying", "mission", "mission_active", "launched", "executing"].includes(state);
}

function isSupportAircraftState(state) {
  return ["pre_support", "post_support", "support", "operations_support", "using_support", "flightline_support"].includes(state)
    || (state.includes("support") && !isMaintenanceAircraftState(state));
}

function renderAvailabilityCurve(trend) {
  const points = trend.slice(-12);
  const maxTotal = Math.max(
    1,
    ...points.map((point) => Number(point.total || 0)),
    ...points.flatMap((point) => AIRCRAFT_TREND_SERIES.map((series) => Number(point[series.key] || 0)))
  );
  const width = 960;
  const height = 120;
  const margin = { left: 44, right: 12, top: 12, bottom: 24 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const chartPoints = points.map((point, index) => {
    const x = points.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + (index / (points.length - 1)) * plotWidth;
    return {
      ...point,
      x,
      seriesY: Object.fromEntries(AIRCRAFT_TREND_SERIES.map((series) => [
        series.key,
        margin.top + (1 - Number(point[series.key] || 0) / maxTotal) * plotHeight
      ]))
    };
  });
  return `
    <div class="availability-chart">
      <div class="section-head">
        <h3>飞机状态一览</h3>
        <span>${points.length} 个采样点</span>
      </div>
      <svg class="availability-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="飞机状态一览：可用飞机、任务中、维修中、使用保障中飞机数量随时间变化曲线">
        ${renderAvailabilityYAxis(maxTotal, { width, height, margin, plotWidth, plotHeight })}
        ${AIRCRAFT_TREND_SERIES.map((series) => renderAvailabilityTrendLine(chartPoints, series)).join("")}
      </svg>
      <div class="availability-trend-legend">
        ${AIRCRAFT_TREND_SERIES.map((series) => `<span><i class="${htmlEscape(series.stateClass)}"></i>${htmlEscape(series.label)}<small>${htmlEscape(series.description)}</small></span>`).join("")}
      </div>
      <div class="availability-axis"><span>${htmlEscape(points[0]?.label || "-")}</span><strong>${AIRCRAFT_TREND_SERIES.map((series) => `${series.label} ${points.at(-1)?.[series.key] ?? 0}`).join(" / ")} / 峰值 ${maxTotal} 架</strong><span>${htmlEscape(points.at(-1)?.label || "-")}</span></div>
    </div>
  `;
}

function renderAvailabilityYAxis(maxTotal, dimensions) {
  const { width, margin, plotWidth, plotHeight } = dimensions;
  const ticks = [maxTotal, Math.round(maxTotal / 2), 0];
  return `
    <g class="availability-y-axis" aria-label="y坐标轴">
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}"></line>
      ${ticks.map((tick) => {
        const y = margin.top + (1 - tick / Math.max(1, maxTotal)) * plotHeight;
        return `
          <line class="grid-line" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(margin.left + plotWidth).toFixed(1)}" y2="${y.toFixed(1)}"></line>
          <text x="${margin.left - 8}" y="${(y + 4).toFixed(1)}">${htmlEscape(tick)}</text>
        `;
      }).join("")}
      <text class="axis-title" x="12" y="${Math.round(margin.top + plotHeight / 2)}" transform="rotate(-90 12 ${Math.round(margin.top + plotHeight / 2)})">飞机数量</text>
      <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}"></line>
    </g>
  `;
}

function renderAvailabilityTrendLine(chartPoints, series) {
  const polyline = chartPoints
    .map((point) => `${point.x.toFixed(1)},${Number(point.seriesY?.[series.key] || 0).toFixed(1)}`)
    .join(" ");
  return `
    <polyline class="trend-line ${htmlEscape(series.key)}" points="${polyline}"></polyline>
    ${chartPoints.map((point, index) => `
      <circle class="${htmlEscape(series.key)} ${index === chartPoints.length - 1 ? "current-point" : ""}" cx="${point.x.toFixed(1)}" cy="${Number(point.seriesY?.[series.key] || 0).toFixed(1)}" r="${index === chartPoints.length - 1 ? "4" : "3"}">
        <title>${htmlEscape(point.label)} / ${htmlEscape(series.label)} ${htmlEscape(point[series.key] ?? 0)} 架</title>
      </circle>
    `).join("")}
  `;
}

function buildSimulationLogStream(series = {}) {
  const frames = Array.isArray(series?.frames) ? series.frames : [];
  const directLogs = buildVisualizationEventStream(series)
    .filter((event) => !isStateFrameEvent(event))
    .map((event) => ({
      ...event,
      log_type: simulationLogTypeLabel(event.event_type || event.event),
      severity: simulationLogSeverity(event.event_type || event.event)
    }));
  const derivedLogs = deriveSimulationLogEvents(frames, series?.run_id || "");
  return dedupeSimulationLogs([...directLogs, ...derivedLogs])
    .sort((a, b) => Number(a.simulation_time || 0) - Number(b.simulation_time || 0) || Number(a.frame_index || 0) - Number(b.frame_index || 0))
    .slice(-240);
}

function isStateFrameEvent(event = {}) {
  const type = String(event.event_type || event.event || "").toLowerCase();
  return type === "state_frame";
}

function deriveSimulationLogEvents(frames, runId) {
  const logs = [];
  let previousState = null;
  frames.forEach((frame, frameIndex) => {
    const state = normalizeAviationSupportState(frame);
    deriveMissionLogs(logs, previousState, state, frame, frameIndex, runId);
    deriveSupportJobLogs(logs, previousState, state, frame, frameIndex, runId);
    deriveAircraftStatusLogs(logs, previousState, state, frame, frameIndex, runId);
    previousState = state;
  });
  return logs;
}

function deriveMissionLogs(logs, previousState, state, frame, frameIndex, runId) {
  const previousMissions = new Map((previousState?.missions || []).map((mission) => [String(mission.id), mission]));
  for (const mission of state.missions || []) {
    const missionId = String(mission.id || "");
    const previous = previousMissions.get(missionId) || {};
    const assigned = Array.isArray(mission.assignedTailNumbers) ? mission.assignedTailNumbers : [];
    const previousAssigned = Array.isArray(previous.assignedTailNumbers) ? previous.assignedTailNumbers : [];
    if (assigned.length && assigned.join("|") !== previousAssigned.join("|")) {
      pushSimulationLog(logs, frame, frameIndex, runId, "mission_assigned", "任务成员分配", `任务 ${missionId} 分配 ${assigned.join(" / ")}`, "info", missionId);
    }
    if (["launched", "flying"].includes(String(mission.status)) && !["launched", "flying"].includes(String(previous.status))) {
      pushSimulationLog(logs, frame, frameIndex, runId, "mission_started", "任务启动", `任务 ${missionId} 启动，执行飞机 ${assigned.join(" / ") || "-"}`, "success", missionId);
    }
    if (["completed", "succeeded", "failed", "cancelled"].includes(String(mission.status)) && String(mission.status) !== String(previous.status)) {
      pushSimulationLog(logs, frame, frameIndex, runId, "mission_finished", "任务结束", `任务 ${missionId} ${missionStatusLabel(mission.status)}，执行飞机 ${assigned.join(" / ") || "-"}`, mission.status === "completed" || mission.status === "succeeded" ? "success" : "warning", missionId);
    }
  }
}

function deriveSupportJobLogs(logs, previousState, state, frame, frameIndex, runId) {
  const previousJobs = new Map((previousState?.jobs || []).map((job) => [String(job.id), job]));
  for (const job of state.jobs || []) {
    const jobId = String(job.id || `${job.tailNumber}-${job.kind}-${job.task}`);
    const previous = previousJobs.get(jobId) || {};
    if (!previousState || (String(job.state) === String(previous.state) && String(job.remaining) === String(previous.remaining))) {
      continue;
    }
    const label = job.kind === "repair" ? "维修" : "飞机保障作业";
    const message = `${job.tailNumber || "-"} ${job.task || supportJobKindLabel(job.kind)} / ${supportJobStateLabel(job.state)} / 剩余 ${Number(job.remaining || 0)}min`;
    pushSimulationLog(logs, frame, frameIndex, runId, `support_job_${job.kind || "job"}`, label, message, job.kind === "repair" ? "warning" : "info", jobId);
  }
}

function deriveAircraftStatusLogs(logs, previousState, state, frame, frameIndex, runId) {
  const previousAircraft = new Map((previousState?.aircraft || []).map((aircraft) => [String(aircraft.id), aircraft]));
  for (const aircraft of state.aircraft || []) {
    const previous = previousAircraft.get(String(aircraft.id)) || {};
    if (aircraft.failedLru && aircraft.failedLru !== previous.failedLru) {
      pushSimulationLog(logs, frame, frameIndex, runId, "aircraft_failure", "飞机故障", `${aircraft.label} 故障 LRU ${aircraft.failedLru}`, "warning", aircraft.id);
    }
    if (previousState && isMaintenanceAircraftState(previous.state) && !isMaintenanceAircraftState(aircraft.state) && !aircraft.failedLru) {
      pushSimulationLog(logs, frame, frameIndex, runId, "repair_finished", "维修", `${aircraft.label} 维修结束，状态 ${visualAircraftStateLabel(aircraft.state)}`, "success", aircraft.id);
    }
    if (previousState && !isSupportAircraftState(previous.state) && isSupportAircraftState(aircraft.state)) {
      pushSimulationLog(logs, frame, frameIndex, runId, "support_started", "飞机保障作业", `${aircraft.label} 进入${visualAircraftStateLabel(aircraft.state)}`, "info", aircraft.id);
    }
  }
}

function pushSimulationLog(logs, frame, frameIndex, runId, eventType, logType, message, severity, identity) {
  logs.push({
    event_id: `${runId || "run"}-${eventType}-${identity || logs.length}-${frameIndex}`,
    run_id: runId || frame.run_id || "",
    step: frame.step,
    frame_index: frameIndex,
    simulation_time: frame.simulation_time,
    event: eventType,
    event_type: eventType,
    log_type: logType,
    message,
    severity,
    metric_refs: []
  });
}

function dedupeSimulationLogs(logs) {
  const seen = new Set();
  const deduped = [];
  for (const log of logs) {
    const key = [log.event || log.event_type, log.simulation_time, log.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(log);
  }
  return deduped;
}

function simulationLogTypeLabel(eventType) {
  const type = String(eventType || "").toLowerCase();
  if (type.includes("launch") || type.includes("started")) return "任务启动";
  if (type.includes("assigned")) return "任务成员分配";
  if (type.includes("mission_return") || type.includes("mission_failed") || type.includes("mission_cancel") || type.includes("mission_finished") || type.includes("completed")) return "任务结束";
  if (type.includes("preflight") || type.includes("postflight") || type.includes("job") || type.includes("support")) return "飞机保障作业";
  if (type.includes("repair")) return "维修";
  if (type.includes("fail")) return "飞机故障";
  if (type.includes("transport") || type.includes("spare")) return "备件转运";
  return "仿真日志";
}

function simulationLogSeverity(eventType) {
  const type = String(eventType || "").toLowerCase();
  if (type.includes("cancel") || type.includes("fail") || type.includes("shortage")) return "warning";
  if (type.includes("completed") || type.includes("return") || type.includes("launch") || type.includes("arrived")) return "success";
  return "info";
}

function supportJobKindLabel(kind) {
  const labels = {
    preflight: "飞行前保障",
    postflight: "航后保障",
    repair: "修复性维修",
    preventive: "预防性维修"
  };
  return labels[kind] || kind || "保障作业";
}

function supportJobStateLabel(state) {
  const labels = {
    waiting: "等待",
    running: "执行中",
    completed: "已完成",
    blocked: "受阻"
  };
  return labels[state] || state || "-";
}

function renderMesaStage(activeView, state) {
  if (activeView === "mission") return renderMesaMissionStage(state);
  if (activeView === "support") return renderMesaSupportStage(state);
  return renderMesaAircraftStage(state);
}

function renderMesaAircraftStage(state) {
  const lanes = aircraftStateLanes(state.aircraft);
  const selectedAircraft = selectedVisualAircraftForState(state);
  return `
    <div class="mesa-stage">
      <div class="aircraft-state-board" aria-label="飞机状态块">
        ${lanes.map((lane) => `
          <section class="aircraft-state-lane ${htmlEscape(lane.key)}">
            <div class="aircraft-state-lane-title">
              <strong>${htmlEscape(lane.title)}</strong>
              <span>${htmlEscape(lane.aircraft.length)} 架</span>
            </div>
            <div class="aircraft-state-lane-body">
              ${lane.aircraft.length ? lane.aircraft.map((aircraft) => renderAircraftStateNode(aircraft, selectedAircraft?.id)).join("") : `<span class="empty-state">暂无飞机</span>`}
            </div>
          </section>
        `).join("")}
      </div>
      <div class="legend">
        <span class="legend-item"><i class="dot available"></i>停放</span>
        <span class="legend-item"><i class="dot support"></i>使用保障</span>
        <span class="legend-item"><i class="dot flying"></i>任务</span>
        <span class="legend-item"><i class="dot repair_unavailable"></i>维修/不可用</span>
      </div>
    </div>
  `;
}

function aircraftStateLanes(aircraftList) {
  const actualStates = ["available", "pre_support", "flying", "repair_unavailable"];
  const lanes = actualStates.map((state) => ({
    key: state,
    title: visualAircraftStateLabel(state),
    aircraft: []
  }));
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));
  for (const aircraft of aircraftList) {
    const state = visualAircraftLaneKey(aircraft.state);
    if (!laneByKey.has(state)) {
      const lane = { key: state, title: visualAircraftStateLabel(state), aircraft: [] };
      laneByKey.set(state, lane);
      lanes.push(lane);
    }
    laneByKey.get(state).aircraft.push(aircraft);
  }
  return lanes;
}

function renderAircraftStateNode(aircraft, selectedAircraftId = "") {
  const meta = [
    aircraft.currentMissionId ? `任务 ${aircraft.currentMissionId}` : "",
    aircraft.failedLru ? `故障 ${aircraft.failedLru}` : "",
    aircraft.postflightRequired ? "需航后检查" : "",
  ].filter(Boolean).join(" / ");
  return `
    <button type="button" class="aircraft-state-node ${mesaStateClass(aircraft.state)} ${aircraft.id === selectedAircraftId ? "active" : ""}" data-select-visual-aircraft="${htmlEscape(aircraft.id)}">
      <strong>${htmlEscape(aircraft.label)}</strong>
      <span>${htmlEscape(aircraft.type)} / ${htmlEscape(visualAircraftStateLabel(aircraft.state))}</span>
      <small>${htmlEscape(meta || `飞行 ${fixed(aircraft.flightHours, 1)}h / 起降 ${aircraft.takeoffCount}/${aircraft.landingCount}`)}</small>
    </button>
  `;
}

function renderMesaMissionStage(state) {
  const rows = buildMissionScheduleRows(state.missions);
  if (state.missions.length && rows.length !== state.missions.length) {
    return `
      <div class="mesa-stage mission-schedule-stage">
        <div class="section-head">
          <h3>任务计划甘特图</h3>
          <span>缺少正式任务计划字段</span>
        </div>
        <div class="event warning">当前 state_series 未携带 day_index、wave_index、duration_minutes、周期任务、复合任务、基本任务、要求型号或要求数量字段。请重新运行 aircraft_support_v1 正式仿真生成新的任务计划状态序列；前端不再根据旧 artifact 的 id/name/aircraft_type 兜底推断。</div>
      </div>
    `;
  }
  const groups = groupMissionScheduleRows(rows);
  return `
    <div class="mesa-stage mission-schedule-stage">
      <div class="section-head">
        <h3>任务计划甘特图</h3>
        <span>按周期性任务 / 复合任务 / 每天基本任务</span>
      </div>
      <div class="mission-schedule-table" role="table" aria-label="每天基本任务计划甘特图">
        <div class="mission-schedule-header" role="row">
          <span>计划属性</span>
          <span>基本任务</span>
          <span>要求型号 / 数量</span>
          <span>实际执行飞机</span>
          <span>状态</span>
          <span>每日甘特图</span>
        </div>
        ${groups.map((group) => `
          <div class="mission-plan-group" role="rowgroup">
            <div class="mission-plan-group-title">${htmlEscape(group.title)}</div>
            ${group.rows.map((row) => renderMissionScheduleRow(row)).join("")}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function buildMissionScheduleRows(missions) {
  return missions.filter(hasFormalMissionScheduleFields).map((mission) => {
    const plannedStart = Number(mission.plannedStart || 0);
    const duration = Number(mission.durationMinutes || 0);
    const endMinute = Number(mission.returnTime ?? (plannedStart + duration));
    const dayIndex = Number(mission.dayIndex);
    const dayStart = ((plannedStart % 1440) + 1440) % 1440;
    const dayEnd = Math.max(dayStart + 15, Math.min(1440, endMinute - (dayIndex - 1) * 1440));
    const startPct = boundedPercent(dayStart / 1440);
    const widthPct = Math.max(2, boundedPercent((dayEnd - dayStart) / 1440));
    return {
      id: mission.id,
      type: mission.taskCategory,
      periodicName: mission.periodicTaskName,
      compositeName: mission.compositeTaskName,
      basicTaskName: mission.basicTaskName,
      groupName: mission.groupName || "",
      waveIndex: mission.waveIndex,
      requiredAircraftType: mission.requiredAircraftType,
      requiredAircraft: Number(mission.requiredAircraft || 0),
      assignedTailNumbers: mission.assignedTailNumbers || [],
      status: mission.status,
      statusLabel: missionStatusLabel(mission.status),
      dayIndex,
      plannedStart,
      actualStart: mission.actualStart,
      returnTime: mission.returnTime,
      startPct,
      widthPct,
      startLabel: minuteOfDayLabel(dayStart),
      endLabel: minuteOfDayLabel(dayEnd),
    };
  }).sort((a, b) => a.plannedStart - b.plannedStart || String(a.id).localeCompare(String(b.id)));
}

function hasFormalMissionScheduleFields(mission) {
  const textFieldsPresent = [
    mission.taskCategory,
    mission.basicTaskName,
    mission.requiredAircraftType,
  ].every((value) => value !== null && value !== undefined && String(value).trim() !== "");
  const type = String(mission.taskCategory || "").trim();
  const periodicFieldsPresent = type !== "periodic" || String(mission.periodicTaskName || "").trim() !== "";
  const compositeFieldsPresent = type === "basic" || String(mission.compositeTaskName || "").trim() !== "";
  const numbers = {
    requiredAircraft: Number(mission.requiredAircraft),
    dayIndex: Number(mission.dayIndex),
    waveIndex: Number(mission.waveIndex),
    plannedStart: Number(mission.plannedStart),
    durationMinutes: Number(mission.durationMinutes),
  };
  return textFieldsPresent
    && periodicFieldsPresent
    && compositeFieldsPresent
    && Number.isFinite(numbers.plannedStart)
    && numbers.plannedStart >= 0
    && Number.isFinite(numbers.requiredAircraft)
    && numbers.requiredAircraft > 0
    && Number.isFinite(numbers.dayIndex)
    && numbers.dayIndex > 0
    && Number.isFinite(numbers.waveIndex)
    && numbers.waveIndex > 0
    && Number.isFinite(numbers.durationMinutes)
    && numbers.durationMinutes > 0;
}

function groupMissionScheduleRows(rows) {
  const groups = [];
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.type}:${row.periodicName}:${row.compositeName}`;
    if (!byKey.has(key)) {
      const typeLabel = row.type === "periodic" ? "周期性任务" : row.type === "basic" ? "基本任务" : "复合任务";
      const parts = row.type === "periodic" && row.periodicName
        ? [`周期性任务：${row.periodicName}`, `复合任务：${row.compositeName}`]
        : [`${typeLabel}：${row.compositeName || row.basicTaskName}`];
      const group = { key, title: parts.join(" / "), rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).rows.push(row);
  }
  return groups;
}

function renderMissionScheduleRow(row) {
  const assigned = row.assignedTailNumbers.length
    ? row.assignedTailNumbers.map((tailNumber) => htmlEscape(tailNumber)).join(" / ")
    : "未编组";
  const requirement = `${row.requiredAircraftType} / ${row.requiredAircraft} 架`;
  const attrs = [
    `第 ${row.dayIndex} 天`,
    row.groupName ? `编队 ${row.groupName}` : "",
    row.waveIndex ? `波次 ${row.waveIndex}` : "",
  ].filter(Boolean).join(" / ");
  return `
    <div class="mission-schedule-row" role="row">
      <div><strong>${htmlEscape(attrs)}</strong><small>${htmlEscape(row.id)}</small></div>
      <div><strong>${htmlEscape(row.basicTaskName)}</strong><small>${htmlEscape(row.compositeName || "基本任务")}</small></div>
      <div>${htmlEscape(requirement)}</div>
      <div>${assigned}</div>
      <div><span class="status-badge ${missionStatusClass(row.status)}">${htmlEscape(row.statusLabel)}</span></div>
      <div class="mission-day-gantt" aria-label="第 ${htmlEscape(row.dayIndex)} 天 ${htmlEscape(row.basicTaskName)} 甘特图">
        <div class="mission-day-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        <div class="mission-day-track">
          <i style="left:${htmlEscape(row.startPct)}%;width:${htmlEscape(row.widthPct)}%"><b>${htmlEscape(row.startLabel)}-${htmlEscape(row.endLabel)}</b></i>
        </div>
      </div>
    </div>
  `;
}

function renderMesaSupportStage(state) {
  const scope = visualSupportAirportScope(state);
  const supportAirportOptions = scope.airports.map((airport) => `
    <option value="${htmlEscape(airport.id)}" ${airport.id === scope.selectedAirport.id ? "selected" : ""}>${htmlEscape(airport.name)}</option>
  `).join("");
  const rows = supportRowsForAirportScope(state, scope);
  return `
    <div class="mesa-support-dashboard">
      <div class="support-airport-switcher">
        <div>
          <strong>当前保障点资源</strong>
          <span>${htmlEscape(scope.selectedAirport.name)} / 建模保障点 ${htmlEscape(scope.selectedAirport.name || scope.supportNodes.map((node) => node.name || node.id).join("、") || "-")}</span>
        </div>
        ${scope.airports.length > 1 ? `<select data-mesa-support-airport aria-label="切换保障点查看资源">${supportAirportOptions}</select>` : `<span>${htmlEscape(scope.selectedAirport.name)}</span>`}
      </div>
      ${renderSupportMetricSection("保障人员（按专业）", "当前保障点 / 人员专业", rows.personnel)}
      ${renderSupportMetricSection("保障设备（按类型）", "当前保障点 / 设备类型", rows.equipment)}
      ${renderSupportMetricSection("备件（按类型）", "当前保障点 / 备件类型", rows.spares)}
    </div>
  `;
}

function visualSupportAirportScope(state) {
  const projectJson = buildBackendProjectJson(scenario, currentProject || {});
  const airports = supportAirportOptions(projectJson);
  const defaultAirportId = currentTaskAirportId(state, airports);
  const selectedAirport = airports.find((airport) => airport.id === visualSupportAirportId)
    || airports.find((airport) => airport.id === defaultAirportId)
    || airports[0]
    || { id: "default-airport", name: "当前机场", supportNodeId: "" };
  const supportNodes = supportNodesForAirport(projectJson, selectedAirport);
  return { projectJson, airports: airports.length ? airports : [selectedAirport], selectedAirport, supportNodes };
}

function supportAirportOptions(projectJson) {
  const supportNodes = modeledSupportNodes(projectJson);
  const seen = new Set();
  return supportNodes
    .map((node, index) => {
      const legacyId = supportNodeScopeId(node);
      const id = supportNodeIdentity(node, index);
      return {
        id,
        name: supportNodeDisplayName(node, id, index),
        supportNodeId: id,
        supportNodeIds: [id, legacyId, node?.id, node?.supportNodeId, node?.name].map((value) => String(value || "")).filter(Boolean),
        airportId: supportOrgNodeAirport(node)
      };
    })
    .filter((scope) => {
      if (!scope.id || seen.has(scope.id)) return false;
      seen.add(scope.id);
      return true;
    });
}

function modeledSupportNodes(projectJson) {
  const orgLeafNodes = flattenProjectSupportOrgNodes(projectJson?.supportOrganization?.tree)
    .filter((node) => !(node.children || []).length && (node.supportNodeId || node.id || node.name));
  if (orgLeafNodes.length) return orgLeafNodes;
  return projectSupportResourceNodes(projectJson);
}

function projectSupportResourceNodes(projectJson) {
  return Array.isArray(projectJson?.supportNodes) ? projectJson.supportNodes : [];
}

function flattenProjectSupportOrgNodes(nodes = []) {
  const nodeList = Array.isArray(nodes) ? nodes : (nodes && typeof nodes === "object" ? [nodes] : []);
  return nodeList.flatMap((node) => [
    node,
    ...flattenProjectSupportOrgNodes(node?.children || [])
  ]);
}

function supportNodeIdentity(node, index = 0) {
  return String(node?.name || supportNodeScopeId(node) || node?.resourceId || `support-node-${index}`);
}

function supportNodeDisplayName(node, id, index = 0) {
  return String(node?.name || node?.displayName || node?.nodeType || id || `保障点 ${index + 1}`);
}

function supportNodeMatchesScope(node, scope) {
  const scopeIds = new Set([
    scope?.id,
    scope?.supportNodeId,
    scope?.name,
    ...(Array.isArray(scope?.supportNodeIds) ? scope.supportNodeIds : [])
  ].map((value) => String(value || "")).filter(Boolean));
  const nodeIds = [
    node?.id,
    node?.supportNodeId,
    node?.resourceId,
    node?.organizationNodeId,
    node?.name
  ].map((value) => String(value || "")).filter(Boolean);
  return nodeIds.some((value) => scopeIds.has(value));
}

function supportNodeScopeId(node) {
  return String(node?.supportNodeId || node?.id || "");
}

function supportScopeForSupportNodeId(scopes, supportNodeId) {
  const normalized = String(supportNodeId || "").trim();
  if (!normalized) return null;
  return scopes.find((scope) => (
    scope.id === normalized
    || scope.supportNodeId === normalized
    || (Array.isArray(scope.supportNodeIds) && scope.supportNodeIds.includes(normalized))
  )) || null;
}

function supportScopeForAirportId(scopes, airportId) {
  const normalized = String(airportId || "").trim();
  if (!normalized) return null;
  return scopes.find((scope) => (
    scope.airportId === normalized
    || scope.name === normalized
  )) || null;
}

function supportScopeForStateResource(scopes, state) {
  const resource = (state.resources || []).find((item) => String(item.supportNodeId || "").trim());
  return supportScopeForSupportNodeId(scopes, resource?.supportNodeId);
}

function currentTaskAirportId(state, airports) {
  const activeMission = (state.missions || []).find((mission) => {
    const status = String(mission.status || "").toLowerCase();
    return ["preparing", "ready", "launched", "flying", "running"].includes(status);
  }) || (state.missions || []).find((mission) => String(mission.status || "").toLowerCase() !== "completed");
  const activeSupportScope = supportScopeForSupportNodeId(airports, activeMission?.supportNodeId);
  if (activeSupportScope) return activeSupportScope.id;
  const activeAirportScope = supportScopeForAirportId(airports, activeMission?.airportId);
  if (activeAirportScope) return activeAirportScope.id;
  const resourceScope = supportScopeForStateResource(airports, state);
  if (resourceScope) return resourceScope.id;
  return airports[0]?.id || "";
}

function supportNodesForAirport(projectJson, airport) {
  const resourceNodes = projectSupportResourceNodes(projectJson);
  const resourceMatches = resourceNodes
    .filter((node) => supportNodeMatchesScope(node, airport))
    .map((node) => applyVisualSupportResourceOverrides(node, airport, projectJson));
  if (resourceMatches.length) return resourceMatches;
  return modeledSupportNodes(projectJson).filter((node) => supportNodeMatchesScope(node, airport));
}

function applyVisualSupportResourceOverrides(node, scope, projectJson) {
  const nodeId = supportNodeScopeId(node);
  const scopeId = String(scope?.id || scope?.supportNodeId || node?.organizationNodeId || nodeId || "");
  const resources = Array.isArray(projectJson?.supportResources) ? projectJson.supportResources : [];
  const nodeName = String(node?.name || nodeId || scopeId || "");
  const scopedResources = resources.filter((resource) => {
    const supportNodeName = String(resource.supportNodeName || resource.organizationNodeId || "");
    return supportNodeName === nodeName || supportNodeName === scopeId || supportNodeName === nodeId;
  });
  const personnelResources = scopedResources.filter((resource) => resource.type === "personnel");
  const equipmentResources = scopedResources.filter((resource) => resource.type === "equipment");
  const firstPersonnel = personnelResources[0] || {};
  const firstEquipment = equipmentResources[0] || {};
  return {
    ...node,
    organizationNodeId: node?.organizationNodeId || scopeId,
    personnelCapacity: personnelResources.reduce((total, resource) => total + Number(resource.quantity || 0), 0) || node?.personnelCapacity,
    personnelName: firstPersonnel.name ?? node?.personnelName,
    personnelModel: firstPersonnel.model ?? node?.personnelModel,
    personnelType: firstPersonnel.type ?? node?.personnelType,
    equipmentCapacity: equipmentResources.reduce((total, resource) => total + Number(resource.quantity || 0), 0) || node?.equipmentCapacity,
    supportEquipmentName: firstEquipment.name ?? node?.supportEquipmentName,
    supportEquipmentModel: firstEquipment.model ?? node?.supportEquipmentModel
  };
}

function supportRowsForAirportScope(state, scope) {
  const supportNodeIds = new Set([
    scope.selectedAirport?.id,
    scope.selectedAirport?.supportNodeId,
    scope.selectedAirport?.name,
    ...scope.supportNodes.flatMap((node) => [supportNodeScopeId(node), node.organizationNodeId]),
    ...scope.supportNodes.map((node) => node.name)
  ].map((value) => String(value || "")).filter(Boolean));
  const scopedResources = state.resources.filter((resource) => supportRowBelongsToScope(resource, supportNodeIds, scope.selectedAirport));
  const scopedSpares = state.spares.filter((spare) => supportRowBelongsToScope(spare, supportNodeIds, scope.selectedAirport));
  return {
    personnel: personnelRowsForAirportScope(scope, scopedResources),
    equipment: equipmentRowsForAirportScope(scope, scopedResources),
    spares: spareRowsForAirportScope(scope, scopedSpares)
  };
}

function supportRowBelongsToScope(row, supportNodeIds, airport) {
  if (!supportNodeIds.size) return true;
  const supportNodeId = String(row.supportNodeId || row.id || "").split(":")[0];
  if (supportNodeIds.has(supportNodeId)) return true;
  const airportIds = new Set([airport?.id, airport?.name].map((value) => String(value || "")).filter(Boolean));
  return airportIds.has(String(row.airportId || ""));
}

function personnelRowsForAirportScope(scope, resources) {
  const runtimeRows = resources.filter(isPersonnelResource);
  if (runtimeRows.length) {
    return supportMetricRows(runtimeRows, scope.selectedAirport.name, "人员专业");
  }
  const rows = [];
  const resourceStats = resourceStatsBySupportNode(resources);
  for (const node of scope.supportNodes) {
    const nodeId = supportNodeScopeId(node);
    const organization = node.name || nodeId || scope.selectedAirport.name;
    const resourceRows = resourcesForSupportNode(resources, nodeId, isPersonnelResource).map((resource) => {
      const professional = resource.professional || resource.resourceType || resource.model || "";
      return supportMetricRowFromConfig({
        organization,
        type: professional || "人员专业",
        name: resource.label || professional || "保障人员",
        capacity: resource.capacity,
        inUse: resource.inUse,
        workCount: resource.workCount,
        delayCount: resource.delayCount,
        primaryLabel: "工作次数",
        secondaryLabel: "延误次数",
        metadata: supportResourceMetadata("personnel", {
          professional,
          type: resource.resourceType,
          model: resource.model
        })
      });
    });
    if (resourceRows.length) {
      rows.push(...resourceRows);
      continue;
    }
    const stats = resourceStats.get(nodeId) || {};
    const capacity = node.personnelCapacity;
    if (Array.isArray(capacity) && capacity.length) {
      for (const item of capacity) {
        const professional = item.professional || item.specialty || item.type || item.model || "";
        rows.push(supportMetricRowFromConfig({
          organization,
          type: professional || "人员专业",
          name: item.name || professional || "保障人员",
          capacity: item.capacity,
          inUse: stats.inUse,
          workCount: stats.workCount,
          delayCount: stats.delayCount,
          primaryLabel: "工作次数",
          secondaryLabel: "延误次数",
          metadata: supportResourceMetadata("personnel", {
            professional,
            type: item.personnelType || item.type
          })
        }));
      }
    } else {
      const professional = node.personnelModel || node.personnelType || "";
      rows.push(supportMetricRowFromConfig({
        organization,
        type: professional || "人员专业",
        name: node.personnelName || "保障人员",
        capacity,
        inUse: stats.inUse,
        workCount: stats.workCount,
        delayCount: stats.delayCount,
        primaryLabel: "工作次数",
        secondaryLabel: "延误次数",
        metadata: supportResourceMetadata("personnel", {
          professional,
          type: node.personnelType
        })
      }));
    }
  }
  return rows.length ? rows : supportMetricRows(resources.filter((item) => item.category === "personnel"), scope.selectedAirport.name, "人员专业");
}

function equipmentRowsForAirportScope(scope, resources) {
  const runtimeRows = resources.filter(isEquipmentResource);
  if (runtimeRows.length) {
    return supportMetricRows(runtimeRows, scope.selectedAirport.name, "设备类型");
  }
  const rows = [];
  const resourceStats = resourceStatsBySupportNode(resources);
  for (const node of scope.supportNodes) {
    const nodeId = supportNodeScopeId(node);
    const organization = node.name || nodeId || scope.selectedAirport.name;
    const resourceRows = resourcesForSupportNode(resources, nodeId, isEquipmentResource).map((resource) => {
      const resourceTypeValue = resource.resourceType || resource.model || resource.category || "";
      return supportMetricRowFromConfig({
        organization,
        type: resourceTypeValue || "设备类型",
        name: resource.label || resource.model || resourceTypeValue || "保障设备",
        capacity: resource.capacity,
        inUse: resource.inUse,
        workCount: resource.workCount,
        delayCount: resource.delayCount,
        primaryLabel: "工作次数",
        secondaryLabel: "延误次数",
        metadata: supportResourceMetadata("equipment", {
          type: resourceTypeValue,
          model: resource.model
        })
      });
    });
    if (resourceRows.length) {
      rows.push(...resourceRows);
      continue;
    }
    const stats = resourceStats.get(nodeId) || {};
    const capacity = node.equipmentCapacity;
    if (Array.isArray(capacity) && capacity.length) {
      for (const item of capacity) {
        const resourceTypeValue = item.type || item.model || item.nodeType || "";
        rows.push(supportMetricRowFromConfig({
          organization,
          type: resourceTypeValue || "设备类型",
          name: item.name || item.id || resourceTypeValue || "保障设备",
          capacity: item.quantity || item.capacity,
          inUse: stats.inUse,
          workCount: stats.workCount,
          delayCount: stats.delayCount,
          primaryLabel: "工作次数",
          secondaryLabel: "延误次数",
          metadata: supportResourceMetadata("equipment", {
            type: resourceTypeValue,
            model: item.model
          })
        }));
      }
    } else {
      const resourceTypeValue = node.nodeType || node.supportEquipmentModel || "";
      rows.push(supportMetricRowFromConfig({
        organization,
        type: resourceTypeValue || "设备类型",
        name: node.supportEquipmentName || node.equipmentName || "保障设备",
        capacity,
        inUse: stats.inUse,
        workCount: stats.workCount,
        delayCount: stats.delayCount,
        primaryLabel: "工作次数",
        secondaryLabel: "延误次数",
        metadata: supportResourceMetadata("equipment", {
          type: resourceTypeValue,
          model: node.supportEquipmentModel
        })
      }));
    }
  }
  return rows.length ? rows : supportMetricRows(resources.filter((item) => ["equipment", "facility", "support_node"].includes(item.category)), scope.selectedAirport.name, "设备类型");
}

function resourcesForSupportNode(resources, nodeId, predicate) {
  const normalizedNodeId = String(nodeId || "");
  return resources.filter((resource) => {
    if (!predicate(resource)) return false;
    if (!normalizedNodeId) return true;
    return String(resource.supportNodeId || resource.id || "").split(":")[0] === normalizedNodeId;
  });
}

function isPersonnelResource(resource) {
  return String(resource.category || "").toLowerCase() === "personnel";
}

function isEquipmentResource(resource) {
  return ["equipment", "facility", "support_node"].includes(String(resource.category || "").toLowerCase());
}

function spareRowsForAirportScope(scope, spares) {
  const rows = [];
  const spareStats = spareStatsBySupportNode(spares);
  for (const node of scope.supportNodes) {
    const nodeId = supportNodeScopeId(node);
    const inventory = node.inventory || {};
    const entries = Array.isArray(inventory)
      ? inventory.map((item) => [item.name || item.spareType || item.id, item.quantity])
      : Object.entries(inventory);
    for (const [name, quantity] of entries) {
      const stats = spareStats.get(`${nodeId}:${name}`) || spareStats.get(String(name)) || {};
      rows.push(supportMetricRowFromConfig({
        organization: node.name || nodeId || scope.selectedAirport.name,
        type: "备件类型",
        name,
        capacity: quantity,
        inUse: stats.consumed,
        workCount: stats.consumed,
        delayCount: stats.delayCount,
        primaryLabel: "消耗量",
        secondaryLabel: "延误次数"
      }));
    }
  }
  return rows.length ? rows : spareMetricRows(spares);
}

function resourceStatsBySupportNode(resources) {
  const stats = new Map();
  for (const resource of resources) {
    const key = String(resource.supportNodeId || resource.id || "").split(":")[0];
    if (!key) continue;
    const current = stats.get(key) || { inUse: 0, workCount: 0, delayCount: 0 };
    current.inUse += Number(resource.inUse || 0);
    current.workCount += Number(resource.workCount || 0);
    current.delayCount += Number(resource.delayCount || 0);
    stats.set(key, current);
  }
  return stats;
}

function spareStatsBySupportNode(spares) {
  const stats = new Map();
  for (const spare of spares) {
    const keys = [spare.id, spare.label].map((value) => String(value || "")).filter(Boolean);
    for (const key of keys) {
      stats.set(key, {
        consumed: Number(spare.consumed || 0),
        pending: Number(spare.pending || 0),
        delayCount: Number(spare.delayCount || 0)
      });
    }
  }
  return stats;
}

function supportMetricRowFromConfig(config) {
  const capacity = Math.max(0, Number(config.capacity || 0));
  const inUse = Math.max(0, Number(config.inUse || 0));
  const utilization = capacity > 0 ? Math.min(1, inUse / capacity) : 0;
  const satisfaction = capacity > 0 ? Math.max(0, Math.min(1, 1 - inUse / Math.max(1, capacity))) : 0;
  return {
    organization: config.organization || "保障组织",
    type: config.type || "资源类型",
    name: config.name || "资源",
    capacity,
    inUse,
    utilization: pct(utilization),
    utilizationWidth: Math.round(utilization * 100),
    satisfaction: pct(satisfaction),
    satisfactionWidth: Math.round(satisfaction * 100),
    primaryLabel: config.primaryLabel || "工作次数",
    primaryValue: Number(config.workCount || 0),
    secondaryLabel: config.secondaryLabel || "延误次数",
    secondaryValue: Number(config.delayCount || 0),
    metadata: Array.isArray(config.metadata) ? config.metadata.filter((item) => item.value) : []
  };
}

function supportResourceMetadata(kind, values = {}) {
  const professional = String(values.professional || "").trim();
  const resourceTypeValue = String(values.type || "").trim();
  const model = String(values.model || "").trim();
  if (kind === "personnel") {
    return [
      { label: "专业", value: professional || "未标注" },
      resourceTypeValue && resourceTypeValue !== professional ? { label: "类型", value: resourceTypeValue } : null
    ].filter(Boolean);
  }
  if (kind === "equipment") {
    return [
      { label: "类型", value: resourceTypeValue || model || "未标注" },
      model && model !== resourceTypeValue ? { label: "型号", value: model } : null
    ].filter(Boolean);
  }
  return [];
}

function renderSupportMetricSection(title, subtitle, rows) {
  return `
    <details class="support-metric-panel support-collapsible-panel" open>
      <summary class="section-head">
        <h3>${htmlEscape(title)}</h3>
        <span>${htmlEscape(subtitle)}</span>
      </summary>
      <div class="support-metric-list">
        ${rows.map((row) => `<div class="support-metric-row">
          <div>
            <strong>${htmlEscape(row.name)}</strong>
            <span>${htmlEscape(row.organization)} / ${htmlEscape(row.type)}</span>
            ${row.metadata?.length ? `<div class="support-resource-meta">${row.metadata.map((item) => `<small>${htmlEscape(item.label)}：${htmlEscape(item.value)}</small>`).join("")}</div>` : ""}
          </div>
          <div class="support-count"><small>${htmlEscape(row.primaryLabel)}</small><strong>${htmlEscape(row.primaryValue)}</strong></div>
          <div class="support-count delay"><small>${htmlEscape(row.secondaryLabel)}</small><strong>${htmlEscape(row.secondaryValue)}</strong></div>
        </div>`).join("")}
      </div>
    </details>
  `;
}

function supportMetricRows(resources, organization, typeLabel) {
  return (resources.length ? resources : [{ label: "暂无资源", capacity: 0, inUse: 0, utilization: 0, workCount: 0, delayCount: 0 }]).map((resource) => {
    const utilization = Math.max(0, Math.min(1, Number(resource.utilization || 0)));
    const satisfaction = Number(resource.capacity || 0) > 0 ? Math.max(0, Math.min(1, 1 - Number(resource.inUse || 0) / Math.max(1, Number(resource.capacity || 0)))) : 0;
    return {
      organization,
      type: resource.category === "personnel" ? typeLabel : resourceCategoryLabel(resource.category || typeLabel),
      name: resource.label || resource.id || "资源",
      capacity: Number(resource.capacity || 0),
      inUse: Number(resource.inUse || 0),
      utilization: pct(utilization),
      utilizationWidth: Math.round(utilization * 100),
      satisfaction: pct(satisfaction),
      satisfactionWidth: Math.round(satisfaction * 100),
      primaryLabel: "工作次数",
      primaryValue: Number(resource.workCount || 0),
      secondaryLabel: "延误次数",
      secondaryValue: Number(resource.delayCount || 0),
      metadata: resource.category === "personnel"
        ? supportResourceMetadata("personnel", { professional: resource.professional, type: resource.resourceType, model: resource.model })
        : supportResourceMetadata("equipment", { type: resource.resourceType || resource.model, model: resource.model })
    };
  });
}

function resourceCategoryLabel(category) {
  const labels = {
    equipment: "保障设备",
    facility: "保障设施",
    personnel: "人员专业"
  };
  return labels[category] || category || "资源类型";
}

function spareMetricRows(spares) {
  return (spares.length ? spares : [{ label: "暂无备件", quantity: 0, consumed: 0, pending: 0, delayCount: 0 }]).map((spare) => {
    const total = Number(spare.quantity || 0) + Number(spare.consumed || 0) + Number(spare.pending || 0);
    const satisfaction = total > 0 ? Number(spare.quantity || 0) / total : 0;
    const utilization = total > 0 ? Number(spare.consumed || 0) / total : 0;
    return {
      organization: "保障组织 A",
      type: "备件类型",
      name: spare.label || spare.id || "备件",
      capacity: Number(spare.quantity || 0),
      inUse: Number(spare.consumed || 0),
      utilization: pct(utilization),
      utilizationWidth: Math.round(utilization * 100),
      satisfaction: pct(satisfaction),
      satisfactionWidth: Math.round(satisfaction * 100),
      primaryLabel: "消耗量",
      primaryValue: Number(spare.consumed || 0),
      secondaryLabel: "延误次数",
      secondaryValue: Number(spare.delayCount || 0)
    };
  });
}

function renderMesaSidePanel(activeView, state) {
  if (activeView === "support") return renderMesaSupportPanel(state);
  return renderMesaAircraftPanel(state);
}

function renderMesaAircraftPanel(state) {
  const selectedAircraft = selectedVisualAircraftForState(state);
  if (!selectedAircraft) {
    return `
      <div class="section-head">
        <h3>单机状态</h3>
        <span>0 架</span>
      </div>
      <div class="event warning">当前状态帧没有飞机对象。</div>
    `;
  }
  const aircraft = selectedAircraft;
  return `
    <div class="section-head">
      <h3>单机状态</h3>
      <span>${htmlEscape(selectedAircraft.label)} / ${htmlEscape(aircraft.type)} / ${state.aircraft.length} 架</span>
    </div>
    <h4>装备状态</h4>
    ${renderAircraftStatusSummary(selectedAircraft, state)}
  `;
}

function selectedVisualAircraftForState(state) {
  if (!state.aircraft.length) return null;
  return state.aircraft.find((aircraft) => aircraft.id === selectedVisualAircraftId) || state.aircraft[0];
}

function renderAircraftStatusSummary(aircraft, state) {
  const supportJobs = currentSupportJobsForAircraft(aircraft, state.jobs);
  const failedComponents = failedComponentsForAircraft(aircraft);
  return `
    <div class="aircraft-status-summary ${failedComponents.length ? "has-failure" : ""}">
      <div class="aircraft-status-row">
        <span>当前状态</span>
        <div>
          <strong>${htmlEscape(visualAircraftStateLabel(aircraft.state))}</strong>
          <small>${htmlEscape(aircraft.state || "-")}</small>
        </div>
      </div>
      <div class="aircraft-status-row">
        <span>累计任务时间</span>
        <div>
          <strong>${htmlEscape(fixed(aircraft.flightHours, 1))}h</strong>
          <small>起降 ${htmlEscape(aircraft.takeoffCount)}/${htmlEscape(aircraft.landingCount)}</small>
        </div>
      </div>
      <div class="aircraft-status-row">
        <span>当前保障作业</span>
        <div class="aircraft-status-list">
          ${supportJobs.length ? supportJobs.map((job) => renderAircraftSupportJobStatus(job)).join("") : `<div class="aircraft-status-empty"><strong>无</strong><small>当前帧没有等待或执行中的保障作业</small></div>`}
        </div>
      </div>
      <div class="aircraft-status-row ${failedComponents.length ? "has-failure" : ""}">
        <span>故障件</span>
        <div class="aircraft-status-list">
          ${failedComponents.length ? failedComponents.map((item) => renderAircraftFailureStatus(item)).join("") : `<div class="aircraft-status-empty"><strong>无</strong><small>当前帧未报告故障 LRU</small></div>`}
        </div>
      </div>
    </div>
  `;
}

function currentSupportJobsForAircraft(aircraft, jobs) {
  const aircraftIds = new Set([aircraft.id, aircraft.label].map((value) => String(value || "")).filter(Boolean));
  return (jobs || []).filter((job) => (
    aircraftIds.has(String(job.tailNumber || ""))
    && String(job.state || "").toLowerCase() !== "completed"
  ));
}

function failedComponentsForAircraft(aircraft) {
  const nodes = Array.isArray(aircraft.failureTree?.nodes) ? aircraft.failureTree.nodes : [];
  const failures = [];
  const addFailure = (node, fallbackName, reason) => {
    const id = String(node?.id || fallbackName || "").trim();
    const name = String(node?.name || fallbackName || id || "").trim();
    if (!name || failures.some((item) => item.id === id || item.name === name)) return;
    failures.push({
      id,
      name,
      productType: String(node?.productType || "LRU"),
      failureTime: node?.failureTime ?? null,
      reason
    });
  };
  if (aircraft.failedLru) {
    const primaryNode = nodes.find((node) => String(node.id) === String(aircraft.failedLru));
    addFailure(primaryNode, aircraft.failedLru, "当前故障件");
  }
  nodes
    .filter((node) => node.failed && (node.directFailed || String(node.productType || "").toUpperCase().includes("LRU")))
    .forEach((node) => addFailure(node, node.name || node.id, node.directFailed ? "直接故障" : "受影响"));
  return failures;
}

function renderAircraftSupportJobStatus(job) {
  const detail = supportJobStatusLine(job);
  const meta = [
    job.id ? `作业 ${job.id}` : "",
    job.remaining == null ? "" : `剩余 ${Number(job.remaining || 0)}min`
  ].filter(Boolean).join(" / ");
  return `
    <div class="aircraft-status-item">
      <strong>${htmlEscape(detail)}</strong>
      ${meta ? `<small>${htmlEscape(meta)}</small>` : ""}
    </div>
  `;
}

function supportJobStatusLine(job) {
  return [
    supportJobKindLabel(job.kind),
    job.task || "",
    supportJobStateLabel(job.state)
  ].filter(Boolean).join(" / ") || "保障作业";
}

function renderAircraftFailureStatus(item) {
  const meta = [
    item.productType || "LRU",
    item.reason || "",
    item.failureTime == null ? "" : `T+${item.failureTime}min`
  ].filter(Boolean).join(" / ");
  return `
    <div class="aircraft-status-item fault">
      <strong>${htmlEscape(item.name)}</strong>
      ${meta ? `<small>${htmlEscape(meta)}</small>` : ""}
    </div>
  `;
}

function renderMesaSupportPanel(state) {
  const rows = supportPanelLogRows(state);
  return `
    <div class="section-head">
      <h3>保障作业日志</h3>
      <span>${rows.length ? `${rows.length} 条` : "暂无日志"}</span>
    </div>
    <div class="stack-list support-log-list">
      ${rows.length ? rows.map((row) => renderSupportPanelLogRow(row)).join("") : `<div class="event warning">当前帧没有保障作业日志。</div>`}
    </div>
  `;
}

function supportPanelLogRows(state) {
  const jobRows = (state.jobs || []).map((job) => ({
    severity: String(job.state || "").toLowerCase() === "waiting" ? "warning" : "info",
    title: job.tailNumber || "保障作业",
    message: [supportJobKindLabel(job.kind), job.task, supportJobStateLabel(job.state)].filter(Boolean).join(" / "),
    meta: `剩余 ${Number(job.remaining || 0)}min`
  }));
  const eventRows = (state.events || [])
    .filter((event) => isSupportPanelEvent(event))
    .map((event) => ({
      severity: "success",
      title: `T+${event.time}`,
      message: event.message || simulationLogTypeLabel(event.event),
      meta: simulationLogTypeLabel(event.event)
    }));
  return [...jobRows, ...eventRows].slice(-16);
}

function isSupportPanelEvent(event) {
  const text = `${event?.event || ""} ${event?.message || ""}`.toLowerCase();
  return text.includes("support") || text.includes("job") || text.includes("preflight") || text.includes("postflight") || text.includes("保障");
}

function renderSupportPanelLogRow(row) {
  return `
    <div class="event ${htmlEscape(row.severity || "info")}">
      <strong>${htmlEscape(row.title)}</strong>
      <span>${htmlEscape(row.message || "保障作业")}</span>
      <small>${htmlEscape(row.meta || "")}</small>
    </div>
  `;
}

function missionProgressWidth(mission) {
  if (mission.status === "completed") return 100;
  if (mission.status === "launched" || mission.status === "flying") return 72;
  if (mission.status === "delayed") return 36;
  return 18;
}

function minuteOfDayLabel(minutes) {
  const value = Math.max(0, Math.min(1440, Math.round(Number(minutes || 0))));
  if (value >= 1440) return "24:00";
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function simulationDayMinuteLabel(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0)));
  const day = Math.floor(value / 1440) + 1;
  return `第${day}天 ${minuteOfDayLabel(value % 1440)}`;
}

function missionStatusClass(status) {
  if (["completed", "succeeded"].includes(String(status))) return "success";
  if (["cancelled", "failed"].includes(String(status))) return "danger";
  if (["delayed"].includes(String(status))) return "warn";
  return "info";
}

function missionStatusLabel(status) {
  const labels = {
    completed: "已完成",
    succeeded: "成功",
    launched: "执行中",
    flying: "执行中",
    scheduled: "计划中",
    delayed: "延误",
    cancelled: "已取消",
    failed: "失败"
  };
  return labels[status] || status || "-";
}

function visualAircraftStateLabel(state) {
  const labels = {
    available: "停放",
    maintenance: "维修/不可用",
    flying: "任务",
    repair_unavailable: "维修/不可用",
    mission_ready: "停放",
    pre_support: "使用保障",
    post_support: "使用保障",
    support: "使用保障",
    operations_support: "使用保障",
    using_support: "使用保障",
    flightline_support: "使用保障",
    repair: "维修/不可用",
    repairing: "维修/不可用",
    preventive_maintenance: "维修/不可用",
    corrective_maintenance: "维修/不可用",
    unavailable: "维修/不可用",
    failed: "维修/不可用",
    grounded: "维修/不可用"
  };
  return labels[state] || state || "-";
}

function visualAircraftLaneKey(state) {
  const value = String(state || "available").toLowerCase();
  if (["available", "mission_ready", "standby", "parked", "idle"].includes(value)) return "available";
  if (["flying", "mission", "launched", "sortie", "task"].includes(value)) return "flying";
  if (["pre_support", "post_support", "support", "operations_support", "using_support", "flightline_support"].includes(value)) {
    return "pre_support";
  }
  if (
    ["maintenance", "repair", "repairing", "preventive_maintenance", "corrective_maintenance", "unavailable", "failed", "grounded", "down", "not_available"].includes(value)
    || value.includes("repair")
    || value.includes("maintenance")
    || value.includes("unavailable")
  ) {
    return "repair_unavailable";
  }
  return "repair_unavailable";
}

function boundedPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100)));
}

function createDefaultMonteCarloExperiments() {
  return [];
}

function createMonteCarloExperiment(moduleName, overrides = {}) {
  const sequence = overrides.id ? Number(overrides.sequence ?? 1) : monteCarloExperiments.length + 1;
  const id = overrides.id || `mc-exp-${moduleName === "任务可靠度评估模块" ? "mission" : "spare"}-${String(sequence).padStart(3, "0")}`;
  const scenarioId = overrides.scenario_id || overrides.scenarioId || experimentPlanDraft.scenarioId;
  return {
    id,
    experiment_id: overrides.experiment_id || id,
    experiment_type: "monte_carlo",
    mc_experiment_id: id,
    name: overrides.name || `${experimentPlanDraft.experiment.name} MC-${sequence}`,
    module: moduleName,
    experimentPlanName: overrides.experimentPlanName || experimentPlanDraft.experiment.name,
    experiment_plan_id: overrides.experiment_plan_id || "",
    scenario_id: scenarioId,
    scenarioId: scenarioId,
    scenario_version: overrides.scenario_version || experimentPlanDraft.schema_version || "project-v0",
    project_id: overrides.project_id || "",
    mapping_version: overrides.mapping_version || "",
    samples: Number(overrides.samples ?? experimentPlanDraft.experiment.samples),
    seed: Number(overrides.seed ?? experimentPlanDraft.experiment.seed),
    status: overrides.status || "草稿",
    progress: Number(overrides.progress ?? 0),
    runType: overrides.runType || "monte_carlo",
    runId: overrides.runId || "",
    artifactId: overrides.artifactId || "",
    artifactManifestId: overrides.artifactManifestId || overrides.artifactId || "",
    projectionArtifactIds: overrides.projectionArtifactIds || [],
    source: overrides.source || "manual"
  };
}

function syncMonteCarloExperimentRun(mcExperimentId, updates = {}) {
  if (!mcExperimentId) return;
  monteCarloExperiments = monteCarloExperiments.map((experiment) => {
    if (experiment.mc_experiment_id !== mcExperimentId && experiment.id !== mcExperimentId) return experiment;
    return {
      ...experiment,
      ...updates,
      progress: normalizeProgress(updates.progress ?? experiment.progress),
      artifactManifestId: updates.artifactManifestId ?? updates.artifactId ?? experiment.artifactManifestId,
      artifactId: updates.artifactId ?? updates.artifactManifestId ?? experiment.artifactId
    };
  });
}

function normalizeProgress(progress) {
  const value = Number(progress ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value <= 1 ? Math.round(value * 100) : Math.round(value)));
}

function monteCarloExperimentListForModule(moduleName) {
  return monteCarloExperiments.filter((experiment) => experiment.module === moduleName);
}

function currentMonteCarloExperiment(moduleName) {
  const items = monteCarloExperimentListForModule(moduleName);
  return items.find((experiment) => experiment.id === selectedMonteCarloExperimentId) || items[0] || null;
}

function monteCarloExperimentByBusinessId(mcExperimentId) {
  return monteCarloExperiments.find((experiment) => experiment.mc_experiment_id === mcExperimentId || experiment.id === mcExperimentId) || null;
}

function monteCarloBoundRun(experiment) {
  const runId = experiment?.runId || "";
  if (runId && m7RunDetail?.run?.run_id === runId) return m7RunDetail.run;
  if (runId && backendRun?.run_id === runId) return backendRun;
  if (!runId && backendRun?.run_type === "monte_carlo") return backendRun;
  return null;
}

function monteCarloBoundArtifactManifest(experiment) {
  const runId = experiment?.runId || "";
  if (runId && m7RunDetail?.run?.run_id === runId) return m7RunDetail.artifact_manifest || null;
  if (runId && backendRun?.run_id === runId) return backendArtifactManifest || null;
  if (!runId && backendRun?.run_type === "monte_carlo") return backendArtifactManifest || null;
  return null;
}

function monteCarloDisplayStatus(experiment) {
  const boundRun = monteCarloBoundRun(experiment);
  if (!boundRun) return experiment?.status || "草稿";
  if (isRunComplete(boundRun)) return "完成";
  const status = String(boundRun.status || boundRun.phase || "").toLowerCase();
  if (["queued", "pending", "running", "in_progress"].includes(status)) return "运行中";
  if (["failed", "cancelled", "canceled"].includes(status)) return "运行失败";
  return runStatusLabel(boundRun);
}

function monteCarloArtifactRowsForExperiment(experiment) {
  const boundArtifactManifest = monteCarloBoundArtifactManifest(experiment);
  if (Array.isArray(boundArtifactManifest?.artifacts)) return boundArtifactManifest.artifacts;
  return currentArtifactRows();
}

function monteCarloBaseArtifactsForExperiment(experiment) {
  return monteCarloArtifactRowsForExperiment(experiment).filter((artifact) => artifactHasKind(artifact, "monte_carlo_base"));
}

function analysisProjectionArtifactsForExperiment(experiment, analysisType = "") {
  const projectionKind = projectionArtifactKindForAnalysisType(analysisType);
  return monteCarloArtifactRowsForExperiment(experiment).filter((artifact) => {
    return artifact?.kind === projectionKind
      || artifact?.artifact_type === projectionKind
      || artifact?.analysis_type === analysisType
      || artifact?.projection_type === analysisType;
  });
}

function monteCarloParameterSpaceForExperiment(monteCarloExperimentId) {
  return "baseline";
}

function monteCarloExperimentSourceRows(experiment) {
  const boundRun = monteCarloBoundRun(experiment);
  const boundArtifactManifest = monteCarloBoundArtifactManifest(experiment);
  const projectionIds = (experiment.projectionArtifactIds || []).join(" / ") || ANALYSIS_PROJECTION_TYPES
    .flatMap((item) => analysisProjectionArtifactsForExperiment(experiment, item.analysisType))
    .map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind)
    .filter(Boolean)
    .join(" / ");
  return [
    ["run source", boundRun?.run_id || experiment.runId || "待运行"],
    ["artifact source", boundArtifactManifest?.artifact_manifest_id || experiment.artifactManifestId || experiment.artifactId || "等待正式 MC artifact"],
    ["projection source", projectionIds || "等待 analysis projection artifact"],
    ["mapping/provenance", experiment.mapping_version || mappingProvenanceVersion() || "等待 compiler provenance"]
  ];
}

function buildMonteCarloEvaluationRows() {
  const missionMean = averageGroupMetric("mission_success_rate");
  const readyMean = averageGroupMetric("ready_rate");
  const shortageMean = averageGroupMetric("shortage_events");
  return [
    { name: "任务可靠度", value: pct(missionMean), target: "90%" },
    { name: "战备完好率", value: pct(readyMean), target: "85%" },
    { name: "短缺事件", value: fixed(shortageMean, 1), target: "≤ 1.0" }
  ];
}

function averageGroupMetric(metric) {
  const values = (monteCarloResult.groups || [])
    .map((group) => Number(group[metric]?.mean))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function renderMonteCarloResults(experiment = null) {
  const boundary = monteCarloFormalResultBoundary(experiment);
  const backendChainRows = backendRunChain
    ? [
        ["Project", backendRunChain.project_id],
        ["Snapshot", backendRunChain.modeling_snapshot_id],
        ["ExperimentPlan", backendRunChain.experiment_plan_id],
        ["Scenario", backendRunChain.scenario_id],
        ["Run", backendRunChain.run_id],
        ["Result", backendRunChain.result_summary_id],
        ["ArtifactManifest", backendRunChain.artifact_manifest_id]
      ]
    : [];
  const artifactRows = backendArtifactManifest && backendArtifactManifest.artifacts
    ? backendArtifactManifest.artifacts
    : [];
  return `
    <div class="mc-result-panel">
      <div class="section-head">
        <h3>蒙特卡洛实验结果</h3>
        <span>${htmlEscape(boundary.statusLabel)}</span>
      </div>
      <div class="backend-run-chain">
        <span>后端状态：${htmlEscape(backendApiStatus)}</span>
        <div class="result-source-note">
          <strong>正式来源</strong>
          <span>结果区只使用 canonical /api/runs、monte_carlo_base artifact、analysis projection artifacts 和已解析 projection payload。</span>
          <strong>当前判定</strong>
          <span>${htmlEscape(boundary.reason)}</span>
        </div>
        ${backendChainRows.length
          ? `<table><tbody>${backendChainRows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`
          : `<p>${htmlEscape(backendRun?.run_id || "尚未读取 run_id 身份链")}</p>`}
        ${artifactRows.length
          ? `<table><tbody>${artifactRows.map((artifact) => `<tr><th>${htmlEscape(artifact.kind)}</th><td>${htmlEscape(artifact.path)}</td></tr>`).join("")}</tbody></table>`
          : ""}
      </div>
      ${renderM7RunArtifactPanel()}
      ${renderMonteCarloFormalSourceTable(boundary)}
      ${boundary.formalUnlocked ? renderMonteCarloAnalysisResultLocations(boundary) : renderMonteCarloFormalBlockedState(boundary)}
    </div>
  `;
}

function monteCarloFormalResultBoundary(experiment = null) {
  const boundRun = monteCarloBoundRun(experiment);
  const boundArtifactManifest = monteCarloBoundArtifactManifest(experiment);
  const runId = boundRun?.run_id || experiment?.runId || "";
  const runStatus = String(boundRun?.status || experiment?.status || "");
  const runType = boundRun?.run_type || experiment?.runType || "";
  const manifestId = boundArtifactManifest?.artifact_manifest_id || experiment?.artifactManifestId || experiment?.artifactId || "";
  const manifestStatus = String(boundArtifactManifest?.status || "");
  const retryPending = manifestStatus === "pending"
    || manifestId.includes("retry-pending")
    || boundRun?.control?.action === "retry";
  const running = ["queued", "running", "pending", "in_progress", "运行中"].includes(runStatus.toLowerCase());
  const failed = ["failed", "cancelled", "canceled", "运行失败"].includes(runStatus.toLowerCase());
  const runTypeIsMonteCarlo = runType === "monte_carlo";
  const baseArtifacts = monteCarloBaseArtifactsForExperiment(experiment);
  const projectionSpecs = [
    { analysisType: "spare_shortfall", artifactKind: "analysis_projection_spare_shortfall", label: "备件短板" },
    { analysisType: "carry_list", artifactKind: "analysis_projection_carry_list", label: "转场携行" },
    { analysisType: "mission_reliability", artifactKind: "analysis_projection_mission_reliability", label: "任务可靠度" },
    { analysisType: "downtime_factors", artifactKind: "analysis_projection_downtime_factors", label: "停机因素" }
  ];
  const payloads = analysisProjectionPayloads[runId] || {};
  const payloadErrors = analysisProjectionPayloadErrors[runId] || {};
  const projectionViews = projectionSpecs.map((spec) => {
    const artifacts = analysisProjectionArtifactsForExperiment(experiment, spec.analysisType);
    return {
      ...spec,
      artifacts,
      payload: payloads[spec.analysisType] || null,
      error: payloadErrors[spec.analysisType] || ""
    };
  });
  const missingProjectionArtifacts = projectionViews.filter((view) => view.artifacts.length === 0);
  const payloadParseFailures = projectionViews.filter((view) => view.error);
  const missingProjectionPayloads = projectionViews.filter((view) => view.artifacts.length > 0 && !view.payload && !view.error);
  const formalUnlocked = Boolean(
    runId
    && isRunComplete(boundRun)
    && runTypeIsMonteCarlo
    && !retryPending
    && baseArtifacts.length > 0
    && missingProjectionArtifacts.length === 0
    && payloadParseFailures.length === 0
    && missingProjectionPayloads.length === 0
  );
  const state = !runId
    ? "unconfigured"
    : retryPending
      ? "retry-pending"
      : failed
        ? "failed"
        : running || !isRunComplete(boundRun)
          ? "running"
          : !runTypeIsMonteCarlo
            ? "wrong-run-type"
            : baseArtifacts.length === 0
              ? "missing-monte-carlo-base"
              : missingProjectionArtifacts.length
                ? "missing-projection-artifact"
                : payloadParseFailures.length
                  ? "projection-parse-failed"
                  : missingProjectionPayloads.length
                    ? "missing-projection-payload"
                    : formalUnlocked
                      ? "formal"
                      : "blocked";
  return {
    runId,
    runType,
    manifestId,
    manifestStatus,
    state,
    statusLabel: monteCarloFormalStatusLabel(state),
    reason: monteCarloFormalResultReason({
      state,
      experiment,
      runStatus,
      baseArtifacts,
      missingProjectionArtifacts,
      payloadParseFailures,
      missingProjectionPayloads
    }),
    formalUnlocked,
    baseArtifacts,
    projectionViews
  };
}

function monteCarloFormalStatusLabel(state) {
  const labels = {
    unconfigured: "待运行",
    "retry-pending": "retry-pending",
    failed: "运行失败",
    running: "运行中",
    "wrong-run-type": "run_type 不匹配",
    "missing-monte-carlo-base": "缺 monte_carlo_base",
    "missing-projection-artifact": "缺 projection artifact",
    "projection-parse-failed": "projection payload 解析失败",
    "missing-projection-payload": "缺 projection payload",
    formal: "正式结果",
    blocked: "正式结果阻断"
  };
  return labels[state] || state;
}

function monteCarloFormalResultReason({ state, experiment, runStatus, baseArtifacts, missingProjectionArtifacts, payloadParseFailures, missingProjectionPayloads }) {
  if (state === "unconfigured") return "尚未创建 run_id，无法展示正式 Monte Carlo 结果。";
  if (state === "retry-pending") return "retry-pending：后端重试已阻断旧 result/artifact，等待新的正式产物生成。";
  if (state === "failed") return backendRun?.error?.message || "绑定的 Monte Carlo 实验运行失败。";
  if (state === "running") return `绑定的 Monte Carlo 实验正在运行：${runStatusLabel(backendRun || experiment)}。`;
  if (state === "wrong-run-type") return "当前 run 不是 run_type=monte_carlo。";
  if (state === "missing-monte-carlo-base") return "缺少正式 Monte Carlo artifact：monte_carlo_base。";
  if (state === "missing-projection-artifact") return `缺少 analysis projection artifact：${missingProjectionArtifacts.map((view) => view.artifactKind).join(" / ")}。`;
  if (state === "projection-parse-failed") return `projection payload 解析失败：${payloadParseFailures.map((view) => `${view.analysisType}: ${view.error}`).join(" / ")}。`;
  if (state === "missing-projection-payload") return `缺少已解析 projection payload：${missingProjectionPayloads.map((view) => view.analysisType).join(" / ")}。`;
  if (state === "formal") return `已读取 ${baseArtifacts.length} 个 monte_carlo_base 和四类 projection payload。`;
  return "正式 Monte Carlo 结果尚未解锁。";
}

function renderMonteCarloFormalSourceTable(boundary) {
  const rows = [
    ["run_id", boundary.runId || "未运行"],
    ["run_type", boundary.runType || "未知"],
    ["artifact_manifest_id", boundary.manifestId || "等待生成"],
    ["manifest_status", boundary.manifestStatus || "unknown"],
    ["monte_carlo_base", boundary.baseArtifacts.map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind).join(" / ") || "缺 artifact"],
    ["projection artifacts", boundary.projectionViews.flatMap((view) => view.artifacts).map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind).filter(Boolean).join(" / ") || "缺 artifact"],
    ["projection payload", boundary.projectionViews.map((view) => `${view.analysisType}:${view.payload ? "parsed" : view.error ? "error" : "missing"}`).join(" / ")]
  ];
  return `<div class="backend-run-chain mc-formal-source"><span>正式结果来源</span><table><tbody>${rows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderMonteCarloAnalysisResultLocations(boundary) {
  return `
    <div class="backend-run-chain mc-analysis-result-locations">
      <span>分析结果页面</span>
      <div class="result-source-note">
        <strong>已迁移</strong>
        <span>四类 analysis projection 结果面板已移到对应分析页面；蒙特卡洛详情页只保留 run、artifact 与 projection 来源校验。</span>
      </div>
      <div class="toolbar-row">
        ${boundary.projectionViews.map((view) => `
          <button type="button" data-feature-id="${htmlEscape(analysisPageFeatureIdForType(view.analysisType))}">
            ${htmlEscape(view.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMonteCarloFormalBlockedState(boundary) {
  return `
    <div class="empty-state mc-formal-blocked">
      <strong>${htmlEscape(boundary.statusLabel)}</strong>
      <p>${htmlEscape(boundary.reason)}</p>
    </div>
  `;
}

function renderM7RunArtifactPanel() {
  const run = m7RunDetail?.run || backendRun || {};
  const artifactManifestId = m7RunDetail?.artifact_manifest?.artifact_manifest_id
    || backendArtifactManifest?.artifact_manifest_id
    || run.artifact_manifest_id
    || "";
  const selectedRunId = run.run_id || m7SelectedRunId || backendRun?.run_id || "";
  const rows = m7RunArtifactRows();
  const lifecycleStatus = run.lifecycle_status || "active";
  const isDeletedRun = lifecycleStatus === "deleted";
  const canManageLifecycle = canManageM7Lifecycle();
  const lifecycleDisabledReason = canManageLifecycle ? "" : ` title="当前角色 ${htmlEscape(currentUser.role || "未知")} 无权执行"`;
  const runRows = [
    ["run_id", selectedRunId || "尚未创建"],
    ["status", run.status || run.phase || "unknown"],
    ["lifecycle_status", lifecycleStatus],
    ["run_type", run.run_type || "monte_carlo"],
    ["artifact_manifest_id", artifactManifestId || "等待生成"]
  ];
  return `
    <div class="backend-run-chain m7-run-artifact-panel m7-run-artifact-management" data-m7-run-artifact-panel>
      <span>M7 运行与产物管理：${htmlEscape(m7RunArtifactStatus)}</span>
      <div class="result-source-note">
        <strong>metadata / download / lifecycle only</strong>
        <span>通过 canonical /api/runs 读取 run 与 artifact 元数据；M8 分析页会另行读取 projection payload 并驱动正式 KPI 卡片。</span>
        <strong>软删除边界</strong>
        <span>软删除只把 run 标记为 tombstone，保留审计和账本语义，不表示本地 artifact 文件被物理删除。</span>
      </div>
      <div class="mc-action-row">
        <button type="button" data-action="m7-refresh-runs" data-run-id="${htmlEscape(selectedRunId)}">刷新</button>
        <button type="button" data-action="m7-open-run-detail" data-run-id="${htmlEscape(selectedRunId)}" ${selectedRunId ? "" : "disabled"}>详情</button>
        <button type="button" data-action="m7-archive-run" data-run-id="${htmlEscape(selectedRunId)}" ${selectedRunId && canManageLifecycle ? "" : "disabled"}${lifecycleDisabledReason}>归档</button>
        <button type="button" class="btn-danger" data-action="m7-delete-run" data-run-id="${htmlEscape(selectedRunId)}" ${selectedRunId && canManageLifecycle ? "" : "disabled"}${lifecycleDisabledReason}>软删除 tombstone</button>
      </div>
      <table>
        <tbody>${runRows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody>
      </table>
      ${m7RunList.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>run_id</th><th>status</th><th>lifecycle_status</th><th>run_type</th><th>artifact_manifest_id</th><th>详情</th></tr></thead>
            <tbody>${m7RunList.map((item) => `<tr>
              <td>${htmlEscape(item.run_id)}</td>
              <td>${htmlEscape(item.status || item.phase || "")}</td>
              <td>${htmlEscape(item.lifecycle_status || "active")}</td>
              <td>${htmlEscape(item.run_type || "")}</td>
              <td>${htmlEscape(item.artifact_manifest_id || "")}</td>
              <td><button type="button" data-action="m7-open-run-detail" data-run-id="${htmlEscape(item.run_id)}">详情</button></td>
            </tr>`).join("")}</tbody>
          </table></div>`
        : ""}
      ${rows.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>artifact_id</th><th>kind</th><th>path</th><th>sha256</th><th>size_bytes</th><th>下载</th></tr></thead>
            <tbody>${rows.map((artifact) => `<tr>
              <td>${htmlEscape(artifact.artifact_id || artifact.id || "")}</td>
              <td>${htmlEscape(artifact.kind || "")}</td>
              <td>${htmlEscape(artifact.path || "")}</td>
              <td>${htmlEscape(artifact.sha256 || "")}</td>
              <td>${htmlEscape(artifact.size_bytes ?? "")}</td>
              <td><button type="button" data-action="m7-download-artifact" data-run-id="${htmlEscape(selectedRunId)}" data-artifact-id="${htmlEscape(artifact.artifact_id || artifact.id || "")}" ${selectedRunId && !isDeletedRun && (artifact.artifact_id || artifact.id) ? "" : "disabled"} ${isDeletedRun ? 'title="deleted run 禁止下载 artifact"' : ""}>下载</button></td>
            </tr>`).join("")}</tbody>
          </table></div>`
        : `<p>暂无 artifact 元数据；运行完成后通过详情刷新。</p>`}
    </div>
  `;
}

function m7RunArtifactRows() {
  const detailArtifacts = m7RunDetail?.artifact_manifest?.artifacts;
  if (Array.isArray(detailArtifacts)) return detailArtifacts;
  if (Array.isArray(backendArtifactManifest?.artifacts)) return backendArtifactManifest.artifacts;
  return [];
}

function renderLiteMesaMonteCarloAnalysis(page) {
  const result = liteMesaMonteCarloResult;
  const runCount = result?.sampleCount || result?.runs?.length || 0;
  const groupCount = result?.groups?.length || 0;
  const metricRows = liteMesaMetricStatisticRows(result);
  const topMetrics = metricRows.slice(0, 4);
  const projectName = currentProject?.name || "当前项目";
  const experimentPlanName = selectedExperimentPlanName();
  return `
    <div class="lite-mesa-workbench">
      <section class="lite-mesa-hero">
        <div>
          <h3>蒙特卡洛分析</h3>
          <p>${htmlEscape(projectName)} / ${htmlEscape(page.module)} / ${htmlEscape(experimentPlanName)}</p>
        </div>
        <div class="lite-mesa-hero-actions">
          ${renderExperimentPlanContextDropdown(page)}
        </div>
      </section>
      <div class="lite-mesa-layout">
        <section class="lite-mesa-settings">
          <div class="section-head">
            <h3>实验设置</h3>
            <span>样本量 / 随机种子</span>
          </div>
          <div class="lite-mesa-setting-grid">
            <label>样本量
              <input data-lite-mesa-field="samples" type="number" min="1" max="1000" step="1" value="${htmlEscape(liteMesaMonteCarloSettings.samples)}">
            </label>
            <label>随机种子
              <input data-lite-mesa-field="seed" type="number" step="1" value="${htmlEscape(liteMesaMonteCarloSettings.seed)}">
            </label>
          </div>
          <button type="button" class="btn-primary" data-lite-mesa-action="run">运行分析</button>
          <p class="inline-status">${htmlEscape(liteMesaMonteCarloStatus)}</p>
        </section>
        <section class="lite-mesa-results">
          <div class="section-head">
            <h3>实验运行结果</h3>
            <span>${runCount ? `${runCount} 样本 / ${groupCount} 参数组` : "等待运行"}</span>
          </div>
          ${runCount ? `
            <div class="lite-mesa-metric-cards">
              ${topMetrics.map((row) => `
                <div class="metric-card">
                  <span>${htmlEscape(row.label)}</span>
                  <strong>${htmlEscape(row.meanLabel)}</strong>
                  <em>均值 / n=${row.count}</em>
                </div>
              `).join("")}
            </div>
          ` : `
            <div class="empty-state">
              <strong>尚未运行分析</strong>
              <p>设置样本量和随机种子后运行。</p>
            </div>
          `}
        </section>
      </div>
      <section class="lite-mesa-stat-section">
        <div class="section-head">
          <h3>主要输出指标统计值</h3>
          <span>均值 / 最小值 / 最大值 / 标准差</span>
        </div>
        <div class="table-wrap">
          <table class="lite-mesa-stat-table">
            <thead><tr><th>指标</th><th>metric</th><th>样本数</th><th>均值</th><th>最小值</th><th>最大值</th><th>标准差</th></tr></thead>
            <tbody>${runCount ? metricRows.map((row) => `
              <tr>
                <td>${htmlEscape(row.label)}</td>
                <td>${htmlEscape(row.key)}</td>
                <td>${row.count}</td>
                <td>${htmlEscape(row.meanLabel)}</td>
                <td>${htmlEscape(row.minLabel)}</td>
                <td>${htmlEscape(row.maxLabel)}</td>
                <td>${htmlEscape(row.stdDevLabel)}</td>
              </tr>
            `).join("") : `<tr><td colspan="7">当前没有可展示的统计值。</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function syncLiteMesaSettingsFromMonteCarloExperiment(experiment) {
  if (!experiment) return;
  const samples = Math.max(1, Math.min(1000, Math.trunc(Number(experiment.samples) || liteMesaMonteCarloSettings.samples || 1)));
  const seed = Math.trunc(Number(experiment.seed) || liteMesaMonteCarloSettings.seed || 1);
  liteMesaMonteCarloSettings = { samples, seed };
  liteMesaMonteCarloResult = null;
  liteMesaMonteCarloStatus = "已载入蒙特卡洛实验设置，等待运行 Mesa 分析。";
}

function updateLiteMesaMonteCarloSetting(field, value) {
  if (field === "samples") {
    liteMesaMonteCarloSettings = {
      ...liteMesaMonteCarloSettings,
      samples: Math.max(1, Math.min(1000, Math.trunc(Number(value) || 1)))
    };
  }
  if (field === "seed") {
    liteMesaMonteCarloSettings = {
      ...liteMesaMonteCarloSettings,
      seed: Math.trunc(Number(value) || 1)
    };
  }
  liteMesaMonteCarloResult = null;
  liteMesaMonteCarloStatus = "设置已更新，等待重新运行 Mesa 分析。";
}

async function runLiteMesaMonteCarloAnalysis() {
  const samples = Math.max(1, Math.min(1000, Math.trunc(Number(liteMesaMonteCarloSettings.samples) || 1)));
  const seed = Math.trunc(Number(liteMesaMonteCarloSettings.seed) || 1);
  liteMesaMonteCarloSettings = { samples, seed };
  liteMesaMonteCarloStatus = "正在运行 Mesa 分析";
  try {
    const selectedProjectJson = await resolveSelectedExperimentPlanProjectJsonForRun();
    const projectJson = {
      ...selectedProjectJson,
      experiment: {
        ...(selectedProjectJson.experiment || {}),
        samples,
        seed
      }
    };
    const response = await backendApi.runLiteMesaAnalysis(projectJson, "mission_reliability", {
      samples,
      seed
    });
    liteMesaMonteCarloResult = normalizeLiteMesaMonteCarloResult(response);
    const runCount = liteMesaMonteCarloResult.sampleCount || liteMesaMonteCarloResult.runs?.length || 0;
    liteMesaMonteCarloStatus = runCount
      ? `Mesa 分析完成：${runCount} 个样本，seed ${seed}。`
      : "当前建模数据不足：请补充装备数量、任务要求、任务周期、部件和保障节点。";
  } catch (err) {
    liteMesaMonteCarloResult = null;
    liteMesaMonteCarloStatus = `Mesa 分析失败：${err && err.message ? err.message : "运行错误"}`;
  }
}

function normalizeLiteMesaMonteCarloResult(payload) {
  if (!payload || payload.status === "blocked") {
    return {
      status: "blocked",
      sampleCount: 0,
      groups: [],
      runs: [],
      metrics: Array.isArray(payload?.metrics) ? payload.metrics : [],
      aggregateMetrics: payload?.aggregate_metrics || {},
      message: payload?.message || "建模粒度不足：请补充装备数量、任务要求、任务周期、部件和保障节点。"
    };
  }
  return {
    status: payload.status === "session_complete" ? "session_complete" : "blocked",
    sampleCount: Number(payload.sample_count || payload.sampleCount || 0),
    groups: [],
    runs: Array.isArray(payload.samples) ? payload.samples : [],
    metrics: Array.isArray(payload.metrics) ? payload.metrics : [],
    aggregateMetrics: payload.aggregate_metrics || {},
    seedList: Array.isArray(payload.seed_list) ? payload.seed_list : [],
    message: payload.message || ""
  };
}

function liteMesaMetricStatisticRows(result) {
  const runs = Array.isArray(result?.runs) ? result.runs : [];
  return LITE_MESA_MONTE_CARLO_METRICS.map((metric) => {
    const values = runs
      .map((run) => Number(run.final?.[metric.key]))
      .filter((value) => Number.isFinite(value));
    const aggregateValue = Number(result?.aggregateMetrics?.[metric.key]);
    const stats = values.length
      ? summarizeLiteMesaValues(values)
      : Number.isFinite(aggregateValue)
        ? { mean: aggregateValue, min: aggregateValue, max: aggregateValue, stdDev: 0 }
        : summarizeLiteMesaValues([]);
    return {
      ...metric,
      count: values.length || Number(result?.sampleCount || 0),
      meanLabel: formatLiteMesaMetric(stats.mean, metric.format),
      minLabel: formatLiteMesaMetric(stats.min, metric.format),
      maxLabel: formatLiteMesaMetric(stats.max, metric.format),
      stdDevLabel: formatLiteMesaMetric(stats.stdDev, metric.format)
    };
  });
}

function summarizeLiteMesaValues(values) {
  if (!values.length) {
    return { mean: 0, min: 0, max: 0, stdDev: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    stdDev: Math.sqrt(variance)
  };
}

function formatLiteMesaMetric(value, format) {
  if (format === "ratio") return ratioFixed(value);
  if (format === "pct") return ratioFixed(value);
  return fixed(value, 2);
}

function renderAnalysis(page) {
  if (page.name.includes("备件短板")) return renderSpareShortfallAnalysis();
  if (page.name.includes("携行")) return renderCarryListAnalysis();
  if (page.name.includes("停机")) return renderDowntimeFactorAnalysis();
  if (page.name.includes("任务可靠度") || page.name.includes("飞机任务可靠性")) return renderTaskReliabilityAnalysis();
  const final = singleResult.final;
  const rows = page.name.includes("备件短板")
    ? singleResult.spareShortfalls.map((row) => [row.spareType, `需求 ${row.demand}`, `短缺 ${row.shortage}`, `${pct(row.fillRate)} 满足`])
    : page.name.includes("携行")
      ? singleResult.carryList.map((row) => [row.spareType, `建议 ${row.recommended}`, `短缺 ${row.shortage}`, `${row.riskLevel}风险`])
      : page.name.includes("停机")
        ? singleResult.downtimeFactors.map((row) => [row.label, `${row.count} 次`, pct(row.contribution), row.reason])
        : [["任务可靠度", pct(final.mission_success_rate), "单次仿真", "由任务波次判定"], ["出动架次率", pct(final.sortie_rate), "单次仿真", "由出动成功数判定"], ["战备完好率", pct(final.ready_rate), "单次仿真", "由 ready 状态判定"]];
  return `
    <div class="section-head section-context">
      <span>结果分析</span>
    </div>
    <div class="rank-list">
      ${rows.map((row) => `<div class="rank-row"><strong>${row[0]}</strong><span>${row[1]}</span><span>${row[2]}</span><span>${row[3]}</span></div>`).join("")}
    </div>
  `;
}

function hasPreviewAnalysisData() {
  return Boolean(
    (singleResult?.timeline || []).length
    || (singleResult?.spareShortfalls || []).length
    || (singleResult?.carryList || []).length
    || (singleResult?.downtimeFactors || []).length
    || (monteCarloResult?.runs || []).length
  );
}

function renderAnalysisEmptyState(title, mode, subtitle, message = "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。") {
  return renderAnalysisDashboard({
    title,
    mode,
    subtitle,
    metrics: [
      ["分析数据", "暂无"],
      ["配置状态", "待导入或运行"],
      ["正式结果", "等待 analysis artifact"]
    ],
    body: `<div class="empty-state"><strong>${message}</strong><p>未选择模板项目时不会生成短板、携行、可靠度或停机因素结论。</p></div>`
  });
}

function renderSpareShortfallAnalysis() {
  return renderAnalysisDashboard({
    title: "备件短板分析",
    mode: "运行当前分析",
    subtitle: "备件需求量降序",
    metrics: [
      ["当前结果", "等待运行"],
      ["结果状态", currentAnalysisStatusLabel(currentAnalysisResultForPage(getFeaturePageById(selectedFeatureId)).status)],
      ["正式校验", "等待通过"]
    ],
    body: `<div class="empty-state"><strong>等待当前分析结果</strong><p>点击运行当前分析后，本页只展示通过后端校验的当前备件短板结果。</p></div>`
  });
}

function renderCarryListAnalysis() {
  const profile = currentAnalysisProfileForPage(getFeaturePageById(selectedFeatureId));
  const confidenceTarget = profile.carryListConfig?.missionConfidenceTarget;
  const missionDuration = profile.scenarioOverrides?.missionDurationMinutes;
  return renderAnalysisDashboard({
    title: "飞机转场携行清单分析",
    mode: "运行当前分析",
    subtitle: "携行清单迭代建议",
    config: `
      <div class="readonly-field"><span>默认目标</span><strong>携行备件越少越好</strong></div>
      <div class="readonly-field"><span>置信度目标</span><strong>${htmlEscape(confidenceTarget ?? "默认")}</strong></div>
      <div class="readonly-field"><span>任务时长覆盖</span><strong>${htmlEscape(missionDuration ?? "默认基础方案")}</strong></div>
    `,
    metrics: [
      ["当前结果", "等待运行"],
      ["结果状态", currentAnalysisStatusLabel(currentAnalysisResultForPage(getFeaturePageById(selectedFeatureId)).status)],
      ["正式校验", "等待通过"]
    ],
    body: `<div class="empty-state"><strong>等待当前分析结果</strong><p>点击运行当前分析后，本页只展示通过后端校验的当前转场携行清单。</p></div>`
  });
}

function carryPriority(riskLevel) {
  switch (riskLevel) {
    case "高":
    case "high":
      return "高";
    case "中":
    case "medium":
      return "中";
    case "低":
    case "low":
      return "低";
    default:
      return "低";
  }
}

function renderTaskReliabilityAnalysis() {
  return renderAnalysisDashboard({
    title: "任务可靠度评估",
    mode: "运行当前分析",
    subtitle: "任务可靠度指标分解",
    metrics: [
      ["当前结果", "等待运行"],
      ["结果状态", currentAnalysisStatusLabel(currentAnalysisResultForPage(getFeaturePageById(selectedFeatureId)).status)],
      ["正式校验", "等待通过"]
    ],
    body: `<div class="empty-state"><strong>等待当前分析结果</strong><p>点击运行当前分析后，本页只展示通过后端校验的当前任务可靠度结果。</p></div>`
  });
}

function renderDowntimeFactorAnalysis() {
  return renderAnalysisDashboard({
    title: "停机因素分析",
    mode: "运行当前分析",
    subtitle: "停机贡献因素排序",
    metrics: [
      ["当前结果", "等待运行"],
      ["结果状态", currentAnalysisStatusLabel(currentAnalysisResultForPage(getFeaturePageById(selectedFeatureId)).status)],
      ["正式校验", "等待通过"]
    ],
    body: `<div class="empty-state"><strong>等待当前分析结果</strong><p>点击运行当前分析后，本页只展示通过后端校验的当前停机因素结果。</p></div>`
  });
}

function analysisTypeForPage(page) {
  if (page.name.includes("备件短板")) return "spare_shortfall";
  if (page.name.includes("携行")) return "carry_list";
  if (page.name.includes("停机")) return "downtime_factors";
  if (page.name.includes("任务可靠度") || page.name.includes("飞机任务可靠性")) return "mission_reliability";
  return "large_sample_summary";
}

function analysisLabelForType(analysisType) {
  const labels = {
    spare_shortfall: "备件短板",
    carry_list: "转场携行",
    mission_reliability: "任务可靠度",
    downtime_factors: "停机因素"
  };
  return labels[analysisType] || analysisType;
}

function analysisPageFeatureIdForType(analysisType) {
  const featureIds = {
    spare_shortfall: "spare-planning-spare-shortfall-analysis",
    carry_list: "spare-planning-carry-list-analysis",
    mission_reliability: "mission-reliability-task-reliability",
    downtime_factors: "mission-reliability-downtime-factor-analysis"
  };
  return featureIds[analysisType] || selectedFeatureId;
}

function currentAnalysisResultForPage(page) {
  const analysisType = analysisTypeForPage(page);
  return currentAnalysisResults[analysisType] || createEmptyCurrentAnalysisResult(analysisType, currentAnalysisProfileForPage(page));
}

function currentAnalysisProfileForPage(page) {
  return getCurrentAnalysisProfileForType(currentAnalysisProfiles, analysisTypeForPage(page));
}

function ensureCurrentAnalysisResultLoaded(page) {
  const analysisType = analysisTypeForPage(page);
  if (!ANALYSIS_PROJECTION_TYPES.some((item) => item.analysisType === analysisType)) return;
  if (!savedProject?.project_id || !backendAuthToken) return;
  if (currentAnalysisResultLoaded[analysisType] || currentAnalysisResultLoadInFlight[analysisType]) return;
  currentAnalysisResultLoadInFlight = { ...currentAnalysisResultLoadInFlight, [analysisType]: true };
  backendApi.getCurrentAnalysisResult(savedProject.project_id, analysisType)
    .then((current) => {
      currentAnalysisResults = { ...currentAnalysisResults, [analysisType]: normalizeCurrentAnalysisResultForUi(analysisType, current) };
      currentAnalysisResultLoaded = { ...currentAnalysisResultLoaded, [analysisType]: true };
    })
    .catch((err) => {
      currentAnalysisResults = transitionCurrentAnalysisResult(currentAnalysisResults, analysisType, {
        type: "block",
        failure: { message: formatBackendError(err) }
      });
      currentAnalysisResultLoaded = { ...currentAnalysisResultLoaded, [analysisType]: true };
    })
    .finally(() => {
      currentAnalysisResultLoadInFlight = { ...currentAnalysisResultLoadInFlight, [analysisType]: false };
      render();
    });
}

function normalizeCurrentAnalysisResultForUi(analysisType, current) {
  const normalized = normalizeBackendCurrentAnalysisResult(analysisType, current);
  const success = normalized.last_success_result;
  if (!success?.payload) return normalized;
  try {
    return {
      ...normalized,
      last_success_result: {
        ...success,
        payload: normalizeAnalysisProjectionPayload(analysisType, success.payload, {
          runId: success.run_id,
          modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY
        })
      }
    };
  } catch (err) {
    return transitionCurrentAnalysisResult({ [analysisType]: normalized }, analysisType, {
      type: "block",
      runId: success.run_id,
      failure: { code: err?.code || "projection_payload_invalid", message: formatBackendError(err) }
    })[analysisType];
  }
}

function hiddenCurrentAnalysisExperimentId(analysisType) {
  return `current-analysis-${analysisType}`;
}

function renderCurrentAnalysisResultPanel(page, title) {
  const result = currentAnalysisResultForPage(page);
  const profile = currentAnalysisProfileForPage(page);
  const status = result.status || "empty";
  const statusLabel = currentAnalysisStatusLabel(status);
  const failureMessage = currentAnalysisShouldShowFailure(result) ? (result.last_failure?.message || "") : "";
  const sourceLabel = currentAnalysisSourceLabel(result);
  return `
    <section class="analysis-task-panel">
      <div class="section-head">
        <h3>当前分析结果</h3>
        <span>${htmlEscape(title)}</span>
      </div>
      <div class="result-source-note">
        <strong>${htmlEscape(sourceLabel)}</strong>
        <span>${htmlEscape(currentAnalysisStatusMessage(result))}</span>
      </div>
      <div class="kpi-strip">
        <div class="kpi-card"><span>状态</span><strong><span class="status-badge ${status === "completed" ? "success" : status === "failed" || status === "blocked" ? "danger" : status === "running" ? "warn" : ""}">${htmlEscape(statusLabel)}</span></strong></div>
        <div class="kpi-card"><span>参数空间</span><strong>${htmlEscape(result.profile_version || profile.profile_version || "default-v0")}</strong></div>
        <div class="kpi-card"><span>基础方案</span><strong>${htmlEscape(result.base_plan_version || profile.base_plan_version || "默认基础方案")}</strong></div>
        <div class="kpi-card"><span>过期状态</span><strong>${result.is_stale ? "需重跑" : "当前"}</strong></div>
      </div>
      ${failureMessage ? `<div class="empty-state"><strong>最近失败</strong><p>${htmlEscape(failureMessage)}</p></div>` : ""}
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-analysis-action="run-current">运行当前分析</button>
      </div>
    </section>
  `;
}

function currentAnalysisSourceLabel(result) {
  const status = result.status || "empty";
  if (status === "empty") return "等待正式结果";
  if (status === "running") return "正式后端运行中";
  if (["failed", "blocked"].includes(status)) {
    return result.last_success_result ? "正式后端结果（需复核）" : "等待正式结果";
  }
  if (result.source === "formal_backend") return result.is_stale ? "正式后端结果（已过期）" : "正式后端结果";
  return "等待正式结果";
}

function currentAnalysisShouldShowFailure(result) {
  return ["failed", "blocked"].includes(result.status || "") && Boolean(result.last_failure?.message);
}

function currentAnalysisStatusLabel(status) {
  const labels = {
    empty: "未运行",
    configured: "待运行",
    running: "运行中",
    completed: "已完成",
    stale: "已过期",
    failed: "运行失败",
    blocked: "阻断",
    preview: "预览"
  };
  return labels[status] || status || "未运行";
}

function currentAnalysisStatusMessage(result) {
  if (result.status === "completed") return "当前结果来自正式后端链路和精确 projection 校验。";
  if (result.status === "running") return "正在使用默认基础方案和当前页参数空间生成正式结果。";
  if (result.status === "failed") return result.last_failure?.message || "最近一次运行失败，上一条成功结果会继续保留。";
  if (result.status === "blocked") return result.last_failure?.message || "缺少正式输入、provenance、base artifact 或 projection payload。";
  return "尚无当前正式结果，可直接运行当前分析页。";
}

async function runCurrentAnalysisPage(page) {
  const analysisType = analysisTypeForPage(page);
  const hiddenExperimentId = hiddenCurrentAnalysisExperimentId(analysisType);
  const analysisProfile = currentAnalysisProfileForPage(page);
  const previousResult = currentAnalysisResultForPage(page);
  currentAnalysisResults = transitionCurrentAnalysisResult(currentAnalysisResults, analysisType, {
    type: "start"
  });
  backendApiStatus = `${page.name} 正在生成当前分析结果`;
  try {
    const run = await startMonteCarloRunThroughApi({
      monteCarloExperimentId: hiddenExperimentId,
      analysisType,
      analysisProfile
    });
    if (!run?.run_id || !savedProject?.project_id) {
      restoreCurrentAnalysisResult(analysisType, previousResult, backendApiStatus || "未创建 run_id");
      return;
    }
    currentAnalysisResults = transitionCurrentAnalysisResult(currentAnalysisResults, analysisType, {
      type: "start",
      runId: run.run_id
    });
    try {
      const current = await backendApi.getCurrentAnalysisResult(savedProject.project_id, analysisType);
      currentAnalysisResults = { ...currentAnalysisResults, [analysisType]: normalizeCurrentAnalysisResultForUi(analysisType, current) };
      currentAnalysisResultLoaded = { ...currentAnalysisResultLoaded, [analysisType]: true };
    } catch (err) {
      currentAnalysisResults = transitionCurrentAnalysisResult({ ...currentAnalysisResults, [analysisType]: previousResult }, analysisType, {
        type: "block",
        runId: run.run_id,
        failure: { message: formatBackendError(err) }
      });
    }
  } finally {
    render();
  }
}

function restoreCurrentAnalysisResult(analysisType, previousResult, message) {
  currentAnalysisResults = transitionCurrentAnalysisResult({ ...currentAnalysisResults, [analysisType]: previousResult }, analysisType, {
    type: "block",
    failure: { message }
  });
}

function artifactHasKind(artifact, kind) {
  return artifact?.kind === kind
    || artifact?.artifact_type === kind
    || artifact?.type === kind;
}

function currentArtifactRows() {
  return Array.isArray(backendArtifactManifest?.artifacts) ? backendArtifactManifest.artifacts : [];
}

function monteCarloBaseArtifacts() {
  return currentArtifactRows().filter((artifact) => artifactHasKind(artifact, "monte_carlo_base"));
}

function analysisProjectionArtifacts(analysisType = "") {
  const projectionKind = projectionArtifactKindForAnalysisType(analysisType);
  return currentArtifactRows().filter((artifact) => {
    return artifact?.kind === projectionKind
      || artifact?.artifact_type === projectionKind
      || artifact?.analysis_type === analysisType
      || artifact?.projection_type === analysisType;
  });
}

function allAnalysisProjectionArtifacts() {
  return [
    "spare_shortfall",
    "carry_list",
    "mission_reliability",
    "downtime_factors"
  ].flatMap((analysisType) => analysisProjectionArtifacts(analysisType));
}

function analysisProjectionTypeForAnalysisType(analysisType) {
  return ANALYSIS_PROJECTION_TYPES.find((item) => item.analysisType === analysisType)?.analysisType || "large_sample_summary";
}

function analysisProjectionForBoundary(boundary) {
  const analysisType = boundary?.analysisType || analysisTypeForPage(getFeaturePageById(selectedFeatureId));
  return formalProjectionFromCurrentResult(currentAnalysisResults[analysisType]);
}

function analysisProjectionErrorForBoundary(boundary) {
  const analysisType = boundary?.analysisType || analysisTypeForPage(getFeaturePageById(selectedFeatureId));
  return currentAnalysisResults[analysisType]?.last_failure?.message || "";
}

function mappingProvenanceVersion() {
  const provenance = backendRun?.compiler_provenance
    || backendRun?.compiled_from?.mapping_provenance
    || backendRun?.simulation_experiment_base?.mapping_provenance
    || backendRunResult?.compiler_provenance
    || backendRunResult?.compiled_from?.mapping_provenance
    || backendRunChain?.compiler_provenance
    || null;
  return provenance?.mapping_version || provenance?.version || provenance?.model_family || "";
}

function formalAnalysisBoundaryReason({ state, provenance, runTypeIsMonteCarlo, projectionArtifacts, projectionPayload, projectionPayloadError, failedCompiler }) {
  if (state === "blocked") return projectionPayloadError || "Current analysis result is blocked until a validated formal projection is available.";
  if (state === "preview") return "Preview/demo/singleResult data is not a completed current analysis result.";
  if (state === "formal") return "Current result passed formal backend projection validation.";
  if (state === "unconfigured") return "当前页尚无正式分析结果。";
  if (state === "pending") return "当前页参数空间已配置，等待运行。";
  if (state === "running") return `当前页正式分析正在运行，进度 ${normalizeProgress(backendRun?.progress)}%。`;
  if (state === "failed") return failedCompiler ? compileGateStatusText(backendRun) : "当前页正式分析运行失败。";
  if (!runTypeIsMonteCarlo) return "当前 run 不是 run_type=monte_carlo。";
  if (!provenance) return "缺少 compiler provenance。";
  if (monteCarloBaseArtifacts().length === 0) return "缺少正式 Monte Carlo artifact。";
  if (projectionArtifacts.length === 0) return "缺少当前分析类型的 analysis projection artifact。";
  if (!projectionPayload) return `缺少或无法解析当前分析类型的 projection payload${projectionPayloadError ? `：${projectionPayloadError}` : "。"}`;
  if (state === "not_applicable") return notApplicableProjectionReason(projectionPayload);
  return "本地预览，不是正式后端仿真结果；preview/demo/singleResult 不会渲染为 completed。";
}

function renderFormalAnalysisSourceTable(boundary) {
  {
    const result = currentAnalysisResults[boundary.analysisType] || {};
    const rows = [
      ["结果类型", boundary.formalUnlocked ? "正式后端结果" : "等待当前结果"],
      ["当前页面", analysisLabelForType(boundary.analysisType)],
      ["结果状态", currentAnalysisStatusLabel(result.status || boundary.state)],
      ["来源校验", boundary.formalUnlocked ? "已通过" : "等待校验"]
    ];
    return `<table><tbody>${rows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`;
  }
  const rows = [
    ["运行类型", backendRun?.run_type === "monte_carlo" ? "正式蒙特卡洛" : "等待运行"],
    ["基础产物", boundary.monteCarloArtifacts.length ? "已就绪" : "缺失"],
    ["分析产物", boundary.analysisArtifacts.length ? "已就绪" : "缺失"],
    ["来源校验", mappingProvenanceVersion() ? "已通过" : "等待 compiler provenance"]
  ];
  return `<table><tbody>${rows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`;
}

function formalAnalysisBoundary(page) {
  const analysisType = analysisTypeForPage(page);
  {
    const currentResult = currentAnalysisResultForPage(page);
    const projectionPayload = formalProjectionFromCurrentResult(currentResult);
    const projectionPayloadError = currentResult.last_failure?.message || "";
    const projectionNotApplicable = Boolean(projectionPayload && projectionPayload.formal === false);
    const formalUnlocked = Boolean(projectionPayload);
    const state = currentResult.status === "empty"
      ? "unconfigured"
      : currentResult.status === "configured"
        ? "pending"
        : currentResult.status === "failed"
          ? "failed"
          : currentResult.status === "running"
            ? "running"
            : formalUnlocked && projectionNotApplicable
              ? "not_applicable"
              : formalUnlocked
                ? "formal"
                : currentResult.status === "blocked"
                  ? "blocked"
                  : currentResult.status === "preview"
                    ? "preview"
                    : "local_preview";
    return {
      formalUnlocked,
      state,
      analysisType,
      linkedExperiment: null,
      monteCarloArtifacts: [],
      analysisArtifacts: [],
      projectionPayload,
      projectionPayloadError,
      reason: formalAnalysisBoundaryReason({
        state,
        provenance: null,
        runTypeIsMonteCarlo: true,
        projectionArtifacts: [],
        projectionPayload,
        projectionPayloadError,
        failedCompiler: false
      })
    };
  }
  const provenance = backendRun?.compiler_provenance
    || backendRun?.compiled_from?.mapping_provenance
    || backendRunResult?.compiler_provenance
    || backendRunResult?.compiled_from?.mapping_provenance
    || backendRunChain?.compiler_provenance
    || backendRun?.error?.details?.provenance
    || null;
  const currentResult = currentAnalysisResultForPage(page);
  const runStatus = backendRun?.status || currentResult.status || "";
  const failedCompiler = backendRun?.status === "failed" && backendRun?.error?.details?.issues?.length;
  const runFailed = backendRun?.status === "failed" || currentResult.status === "failed";
  const running = ["queued", "running", "pending", "运行中"].includes(String(runStatus).toLowerCase()) || currentResult.status === "running";
  const runTypeIsMonteCarlo = backendRun?.run_type === "monte_carlo";
  const projectionArtifacts = analysisProjectionArtifacts(analysisType);
  const analysisArtifacts = projectionArtifacts;
  const projectionPayload = currentResult.last_success_result?.payload
    || analysisProjectionPayloads[backendRun?.run_id || ""]?.[analysisType]
    || null;
  const projectionPayloadError = currentResult.last_failure?.message
    || analysisProjectionPayloadErrors[backendRun?.run_id || ""]?.[analysisType]
    || "";
  const projectionNotApplicable = Boolean(projectionPayload && projectionPayload.formal === false);
  const formalUnlocked = Boolean(
    runTypeIsMonteCarlo
    && !runFailed
    && !running
    && provenance
    && monteCarloBaseArtifacts().length > 0
    && analysisArtifacts.length > 0
    && projectionPayload
  );
  const state = currentResult.status === "empty"
    ? "unconfigured"
    : currentResult.status === "configured"
      ? "pending"
      : runFailed
        ? "failed"
        : running
          ? "running"
          : formalUnlocked && projectionNotApplicable
            ? "not_applicable"
            : formalUnlocked
              ? "formal"
              : "local_preview";
  return {
    formalUnlocked,
    state,
    analysisType,
    provenance,
    projectionPayload,
    projectionPayloadError,
    analysisArtifacts,
    monteCarloArtifacts: monteCarloBaseArtifacts(),
    reason: formalAnalysisBoundaryReason({ state, provenance, runTypeIsMonteCarlo, projectionArtifacts, projectionPayload, projectionPayloadError, failedCompiler })
  };
}

function renderFormalAnalysisBoundaryNote(boundary) {
  if (boundary.formalUnlocked && boundary.state !== "not_applicable") {
    return `
      <div class="result-source-note">
        <strong>正式后端结果</strong>
        <span>当前结果已通过正式后端 projection 校验，当前页面按 current result 展示。</span>
        ${renderFormalAnalysisSourceTable(boundary)}
      </div>
    `;
  }
  const failedCompiler = boundary.state === "failed" && backendRun?.error?.details?.issues?.length;
  const titleByState = {
    unconfigured: "未配置",
    pending: "待运行",
    running: "运行中",
    failed: failedCompiler ? "输入未通过 Scenario compiler" : "运行失败",
    blocked: "正式结果阻断",
    preview: "预览不可完成",
    not_applicable: "不适用 / 未建模",
    local_preview: "等待当前正式结果"
  };
  return `
    <div class="result-source-note">
      <strong>${titleByState[boundary.state] || "等待当前正式结果"}</strong>
      <span>${failedCompiler ? compileGateStatusText(backendRun) : boundary.reason}</span>
      <span>只有当前页正式运行完成并通过后端产物校验后，才显示正式结果。</span>
      ${renderFormalAnalysisSourceTable(boundary)}
    </div>
  `;
}

function notApplicableProjectionReason(formalProjection) {
  const applicability = formalProjection?.applicability || {};
  const requiredDomains = (applicability.required_domains || []).join(" / ") || "保障资源 / 保障活动";
  const disabledDomains = (applicability.disabled_domains || []).join(" / ") || "未建模域";
  return `该分析所需保障域未建模；required_domains=${requiredDomains}，disabled_domains=${disabledDomains}。`;
}

function renderFormalProjectionBody(formalProjection) {
  if (!formalProjection) return "";
  if (formalProjection.formal === false) {
    const applicability = formalProjection.applicability || {};
    const required_domains = (applicability.required_domains || []).join(" / ") || "-";
    const disabled_domains = (applicability.disabled_domains || []).join(" / ") || "-";
    return `
      <div class="empty-state analysis-not-applicable">
        <strong>不适用 / 未建模</strong>
        <p>${htmlEscape(`该分析所需保障域未建模；required_domains=${required_domains}; disabled_domains=${disabled_domains}。`)}</p>
      </div>
    `;
  }
  if (formalProjection.analysisType === "spare_shortfall") {
    const sourceRows = formalProjection.rows || [];
    const rows = spareDemandSort === "asc" ? [...sourceRows].sort((a, b) => a.demand - b.demand) : spareDemandSort === "desc" ? [...sourceRows].sort((a, b) => b.demand - a.demand) : sourceRows;
    const maxShortage = rows.reduce((maxValue, row) => Math.max(maxValue, row.shortage || row.shortageProbability || 0), 1);
    return `
      <div class="toolbar-row"><span>需求数量排序</span><button type="button" data-spare-demand-sort="asc">升序</button><button type="button" data-spare-demand-sort="desc">降序</button><button type="button" data-spare-demand-sort="default">恢复默认</button></div><div class="table-wrap">
        <table>
          <thead><tr><th>机型</th><th>备件</th><th>需求数量</th><th>备件满足率</th><th>备件利用率</th><th>满足率约束</th><th>利用率约束</th><th>短缺概率</th><th>平均延误时间(h)</th><th>基层级数量</th><th>初始基层级库存</th><th>短板等级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${htmlEscape(row.aircraftModel)}</td><td>${htmlEscape(row.name)}</td><td>${row.demand}</td><td>${fixed(row.satisfy, 2)}</td><td>${fixed(row.utilization, 2)}</td><td>${htmlEscape(row.fillRateConstraint)}</td><td>${htmlEscape(row.utilizationConstraint)}</td><td>${pct(row.shortageProbability)}</td><td>${row.delay}</td><td>${row.baseCount}</td><td>${row.stock}</td>
              <td><span class="status-badge ${row.level === "严重" ? "danger" : row.level === "短缺" ? "warn" : ""}">${htmlEscape(row.level)}</span></td>
              <td class="bar-cell">${renderBar(row.shortage || row.shortageProbability, maxShortage, "red")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    `;
  }
  if (formalProjection.analysisType === "carry_list") {
    const rows = (formalProjection.rows || []).filter((row) => !carryHideZeroDemand || row.demand > 0);
    const maxCarryQuantity = rows.reduce((maxValue, row) => Math.max(maxValue, row.qty || 0), 1);
    return `
      <div class="toolbar-row"><label class="check-inline"><input type="checkbox" data-carry-hide-zero ${carryHideZeroDemand ? "checked" : ""}>隐藏需求量为 0</label><span>满足率下限：${fixed(rows[0]?.minimumSatisfactionRate || 0.9, 2)}；满足约束后利用率越高越优</span></div><div class="table-wrap">
        <table>
          <thead><tr><th>机型</th><th>备件</th><th>需求</th><th>推荐携行倍率</th><th>备件满足率</th><th>数量</th><th>有寿件约束</th><th>携行优先级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${htmlEscape(row.aircraftModel)}</td><td>${htmlEscape(row.name)}</td><td>${row.demand}</td><td>${fixed(row.multiplier, 2)}</td><td>${fixed(row.satisfy, 2)}</td><td>${row.qty}</td><td>${row.lifeLimited ? `${row.lifeLandings} 起落 / ${row.lifeCalendarDays} 天（先到）` : "无"}</td>
              <td><span class="status-badge ${row.priority === "高" ? "danger" : row.priority === "中" ? "warn" : "success"}">${htmlEscape(row.priority)}</span></td>
              <td class="bar-cell">${renderBar(row.qty, maxCarryQuantity, "blue")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
      <div class="decision-support-card"><strong>携行清单说明</strong><span>正式来源为 projection payload，默认目标为携行备件越少越好，按推荐携行倍率和风险等级形成转场前装箱评审清单。</span></div>
    `;
  }
  if (formalProjection.analysisType === "mission_reliability") {
    const rows = formalProjection.rows || [];
    const drop = formalProjection.steepestDrop;
    return `
      <div class="kpi-strip"><div class="kpi-card"><span>任务剖面可靠性</span><strong>${pct(formalProjection.profileReliability)}</strong></div><div class="kpi-card"><span>连续7天完成可靠性</span><strong>${pct(formalProjection.periodCompletionProbability)}</strong></div><div class="kpi-card"><span>成功/有效样本</span><strong>${formalProjection.successfulSamples}/${formalProjection.validSamples}</strong></div></div><div class="analysis-chart-panel"><div class="chart-title">projection payload 任务波次平均成功率</div>${renderLineChart(rows.map((row) => ({ x: row.sequence, y: row.probability })))}</div>
      <div class="decision-support-card"><strong>最大下降波次</strong><span>${drop ? `T${drop.fromIndex} 到 T${drop.toIndex}，${htmlEscape(drop.fromTime)} 到 ${htmlEscape(drop.toTime)}，下降 ${fixed(drop.drop, 3)}` : "未发现下降波次"}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>任务波次</th><th>样本数</th><th>平均任务成功率</th><th>平均出动架次率</th><th>状态</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.waveLabel || row.timeLabel)}</td><td>${htmlEscape(row.sampleCount ?? "-")}</td><td>${fixed(row.probability, 3)}</td><td>${fixed(row.sortieRate, 3)}</td><td><span class="status-badge ${row.state === "未达标" ? "warn" : "success"}">${htmlEscape(row.state)}</span></td></tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }
  if (formalProjection.analysisType === "downtime_factors") {
    const rows = formalProjection.rows || [];
    const primaryFactors = rows.slice(0, 2);
    const maxFactorCount = rows.reduce((maxValue, row) => Math.max(maxValue, row.count || 0), 1);
    const snapshots = visibleDowntimeAnomalySnapshots(formalProjection);
    return `
      <div class="factor-grid">
        <div class="factor-column"><h4>停机因素</h4><div class="factor-list">${primaryFactors.map((row) => `<div class="factor-item"><span>${htmlEscape(row.label)}</span><span>${row.contributionLabel}</span></div>`).join("")}</div></div>
        <div class="factor-column"><h4>二级因素</h4><div class="factor-list">${rows.map((row) => `<div class="factor-item"><span>${htmlEscape(row.label)}</span><span>${row.count}</span></div>`).join("")}</div></div>
        <div class="factor-column"><h4>正式来源</h4><div class="factor-list"><div class="factor-item"><span>projection payload</span><span>downtime_factors</span></div></div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>停机因素</th><th>事件次数</th><th>累计停机时长(h)</th><th>时长贡献度</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.label)}</td><td>${row.count}</td><td>${fixed(row.downtimeHours, 2)}</td><td>${pct(row.durationContribution)}</td><td class="bar-cell">${renderBar(row.downtimeHours, Math.max(1, ...rows.map((item) => item.downtimeHours)), row.durationContribution >= 0.35 ? "red" : "blue")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="toolbar-row">
        <button type="button" data-downtime-snapshot-export ${snapshots.length ? "" : "disabled"}>导出异常快照</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>异常停机事件快照</th><th>时间</th><th>事件</th><th>结果</th><th>support_activity_state</th><th>作业节点</th><th>状态</th><th>定位</th><th>快照动作</th></tr></thead>
          <tbody>${snapshots.map((snapshot) => `
            <tr>
              <td>${htmlEscape(snapshot.id)}</td>
              <td>${htmlEscape(snapshot.timeLabel)}</td>
              <td>${htmlEscape(snapshot.eventLabel)}</td>
              <td>${htmlEscape(snapshot.result)}</td>
              <td>${htmlEscape(`active=${snapshot.activeJobs}; repair=${snapshot.repairBacklog}; spare=${fixed(snapshot.spareFillRate, 2)}`)}</td>
              <td>${htmlEscape(snapshot.jobNodeLabel)}</td>
              <td>${htmlEscape(snapshot.jobState)}</td>
              <td>${htmlEscape(`${snapshot.jobNodeId}; ${snapshot.frameRef}`)}</td>
              <td><button type="button" class="btn-danger" data-downtime-snapshot-delete="${htmlEscape(snapshot.id)}">删除</button></td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    `;
  }
  return "";
}

function visibleDowntimeAnomalySnapshots(formalProjection) {
  return (formalProjection.snapshots || []).filter((snapshot) => !deletedDowntimeSnapshotIds.has(snapshot.id));
}

function exportDowntimeAnomalySnapshots() {
  const page = getFeaturePageById(selectedFeatureId);
  const boundary = formalAnalysisBoundary(page);
  const formalProjection = analysisProjectionForBoundary(boundary);
  const snapshots = visibleDowntimeAnomalySnapshots(formalProjection || {});
  const payload = {
    schemaVersion: "downtime-anomaly-snapshots-v1",
    exportedAt: new Date().toISOString(),
    runId: boundary?.linkedExperiment?.runId || backendRun?.run_id || "",
    snapshots
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `downtime-anomaly-snapshots-${payload.runId || "local"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  backendApiStatus = `已导出 ${snapshots.length} 条异常停机快照`;
}

function deleteDowntimeAnomalySnapshot(snapshotId) {
  if (!snapshotId) return;
  deletedDowntimeSnapshotIds = new Set([...deletedDowntimeSnapshotIds, snapshotId]);
  backendApiStatus = `已删除异常停机快照 ${snapshotId}`;
}

function renderAnalysisDashboard({ title, mode, subtitle, config = "", metrics, body }) {
  const page = getFeaturePageById(selectedFeatureId);
  const boundary = formalAnalysisBoundary(page);
  const formalProjection = analysisProjectionForBoundary(boundary);
  const displayedMetrics = formalProjection?.metrics || metrics;
  const displayedBody = formalProjection ? renderAnalysisProjectionResultPanel(formalProjection) : body;
  const metricSuffix = formalProjection?.formal === false ? "<em>不适用</em>" : formalProjection ? "<em>projection payload</em>" : "<em>等待当前结果</em>";
  return `
    <div class="analysis-dashboard">
      ${renderCurrentAnalysisResultPanel(page, title)}
      <section class="analysis-filter-bar">
        <div><h3>${title}</h3><span>${subtitle}</span></div>
        <button type="button" class="btn-primary" data-analysis-action="run-current">启动</button>
      </section>
      ${renderFormalAnalysisBoundaryNote(boundary)}
      ${config ? `<section class="analysis-config-grid">${config}</section>` : ""}
      <section class="kpi-strip">${displayedMetrics.map(([label, value]) => `<div class="kpi-card"><span>${label}</span><strong>${value}</strong>${metricSuffix}</div>`).join("")}</section>
      <section class="analysis-chart-panel">${displayedBody}</section>
      <div class="decision-support-card"><strong>${mode}</strong><span>${formalProjection ? "结果已按后端 analysis projection payload 展示，供当前项目评审。" : "等待当前正式结果；非正式预览数据不会渲染为 completed。"}</span></div>
    </div>
  `;
}

function renderAnalysisProjectionResultPanel(formalProjection) {
  const label = analysisLabelForType(formalProjection.analysisType);
  const artifactKind = projectionArtifactKindForAnalysisType(formalProjection.analysisType);
  return `
    <section class="analysis-projection-result-panel">
      <div class="section-head">
        <h3>${htmlEscape(label)}</h3>
        <span>projection payload / ${htmlEscape(artifactKind)}</span>
      </div>
      <div class="mc-formal-metrics">
        ${(formalProjection.metrics || []).map(([name, value]) => `
          <div class="metric-card">
            <span>${htmlEscape(name)}</span>
            <strong>${htmlEscape(value)}</strong>
            ${formalProjection.formal === false ? "<em>不适用</em>" : "<em>projection payload</em>"}
          </div>
        `).join("")}
      </div>
      ${renderFormalProjectionBody(formalProjection)}
    </section>
  `;
}

function renderBar(value, max, color) {
  const width = Math.max(8, Math.round((Number(value) / Math.max(Number(max), 1)) * 100));
  return `<div class="bar-track"><span class="bar-fill ${color}" style="width:${width}%"></span></div>`;
}

function renderLineChart(points) {
  const width = 640;
  const height = 180;
  const plotLeft = 52;
  const plotRight = 596;
  const plotTop = 18;
  const plotBottom = 146;
  const minY = 0;
  const maxY = 1;
  if (!points.length) {
    return `<div class="empty-state"><strong>暂无曲线数据</strong></div>`;
  }
  const minX = Math.min(...points.map((point) => Number(point.x) || 0));
  const maxX = Math.max(...points.map((point) => Number(point.x) || 0));
  const xSpan = Math.max(1, maxX - minX);
  const xScale = (x) => plotLeft + ((x - minX) / xSpan) * (plotRight - plotLeft);
  const yScale = (y) => {
    const bounded = Math.max(minY, Math.min(maxY, Number(y) || 0));
    return plotTop + (1 - (bounded - minY) / (maxY - minY)) * (plotBottom - plotTop);
  };
  const line = points.map((point) => `${xScale(point.x).toFixed(1)},${yScale(point.y).toFixed(1)}`).join(" ");
  const yTicks = [0, 0.5, 1];
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="任务可靠度趋势">
      <line class="line-chart-axis line-chart-y-axis" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
      <line class="line-chart-axis line-chart-x-axis" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line>
      ${yTicks.map((tick) => `<line class="line-chart-tick" x1="${plotLeft - 4}" y1="${yScale(tick).toFixed(1)}" x2="${plotRight}" y2="${yScale(tick).toFixed(1)}"></line><text class="line-chart-y-label" x="${plotLeft - 10}" y="${(yScale(tick) + 4).toFixed(1)}">${tick.toFixed(1)}</text>`).join("")}
      <polyline points="${line}"></polyline>
      ${points.map((point) => `<circle cx="${xScale(point.x).toFixed(1)}" cy="${yScale(point.y).toFixed(1)}" r="4"></circle><text class="line-chart-x-label" x="${xScale(point.x).toFixed(1)}" y="168">${point.x}</text>`).join("")}
    </svg>
  `;
}

function renderLiteMesaAnalysisPage(page) {
  const definition = liteMesaAnalysisDefinitionForPage(page);
  const settings = liteMesaAnalysisEffectiveSettings(definition);
  const result = liteMesaAnalysisResults[definition.analysisType] || null;
  const runCount = result?.sampleCount || 0;
  const statusText = result?.status === "session_complete"
    ? `分析结果已生成：${runCount} 个样本`
    : result?.status === "blocked"
      ? result.message
    : result?.status === "running"
        ? "分析运行中"
        : "等待运行";
  return `
    <div class="lite-mesa-workbench lite-mesa-analysis-page">
      <section class="lite-mesa-hero">
        <div>
          <h3>${htmlEscape(definition.title)}</h3>
        </div>
        <div class="lite-mesa-hero-actions">
          ${renderExperimentPlanContextDropdown(page)}
        </div>
      </section>
      <section class="lite-mesa-settings lite-mesa-analysis-settings">
        <div class="section-head">
          <h3>分析设定</h3>
          <span>样本量 / 随机种子只读</span>
        </div>
        ${renderLiteMesaAnalysisSettings(definition, settings, result)}
        <div class="lite-mesa-analysis-action-line">
          <button type="button" class="btn-primary" data-lite-mesa-analysis-action="run">运行分析</button>
          <p class="inline-status">${htmlEscape(statusText)}</p>
        </div>
      </section>
      <section class="lite-mesa-stat-section lite-mesa-analysis-detail">
        <div class="section-head">
          <h3>${liteMesaAnalysisDetailTitle(definition)}</h3>
          <span>${htmlEscape(definition.subtitle)} / ${liteMesaAnalysisResultHeader(definition, result)}</span>
        </div>
        ${renderLiteMesaAnalysisMetricCards(definition, result)}
        ${renderLiteMesaAnalysisSessionBody(definition, result)}
      </section>
    </div>
  `;
}

function liteMesaAnalysisResultHeader(_definition, result) {
  if (result?.status === "session_complete") return "分析完成";
  if (result?.status === "running") return "运行中";
  return "等待运行";
}

function liteMesaAnalysisDetailTitle(_definition) {
  return "分析结果明细";
}

function liteMesaAnalysisDefinitionForPage(page) {
  const analysisType = analysisTypeForPage(page);
  return {
    analysisType,
    ...(LITE_MESA_ANALYSIS_DEFINITIONS[analysisType] || LITE_MESA_ANALYSIS_DEFINITIONS.mission_reliability)
  };
}

function createDefaultLiteMesaAnalysisSettings() {
  return {
    spare_shortfall: { samples: 27, seed: 20260621 },
    carry_list: { samples: 27, seed: 20260621, missionConfidenceTarget: 0.9 },
    mission_reliability: { samples: 27, seed: 20260621, maxTimeWindow: "" },
    downtime_factors: { samples: 1, seed: 20260621, topN: 4 }
  };
}

function liteMesaAnalysisEffectiveSettings(definition) {
  return {
    ...(liteMesaAnalysisSettings[definition.analysisType] || {}),
    ...selectedExperimentPlanRunSettings()
  };
}

function renderLiteMesaAnalysisSettings(definition, settings, result = null) {
  const items = liteMesaAnalysisSettingItems(definition, settings, result);
  const controls = renderLiteMesaAnalysisEditableSettings(definition, settings);
  return `
    <div class="lite-mesa-analysis-setting-line" aria-label="分析设定">
      ${items.map(([label, value]) => `
        <span class="lite-mesa-setting-chip">
          <span>${htmlEscape(label)}</span>
          <strong>${htmlEscape(value)}</strong>
        </span>
      `).join("")}
      ${controls}
    </div>
  `;
}

function liteMesaAnalysisSettingItems(definition, settings, result = null) {
  const resultStatus = liteMesaAnalysisResultHeader(definition, result);
  const items = [
    ["项目", currentProject?.name || selectedExperimentPlanProjectJson().projectInfo?.name || "当前项目"],
    [selectedRunContextLabel(), selectedExperimentPlanName()],
    ["分析对象", definition.settingSubject || "当前项目"],
    ["结果内容", definition.subtitle],
    ["运行状态", resultStatus],
    ["样本量", settings.samples ?? 27],
    ["随机种子", settings.seed ?? 20260621]
  ];
  if (definition.analysisType === "carry_list") {
    items.push(["目标函数", "携行备件总量最小"]);
  }
  return items;
}

function renderLiteMesaAnalysisEditableSettings(definition, settings) {
  if (definition.analysisType === "carry_list") {
    return `
      <label class="lite-mesa-setting-chip editable">
        <span>置信度目标</span>
        <input data-lite-mesa-analysis-field="missionConfidenceTarget" type="number" min="0" max="1" step="0.01" value="${htmlEscape(settings.missionConfidenceTarget ?? 0.9)}">
      </label>
    `;
  }
  if (definition.analysisType === "mission_reliability") {
    return `
      <label class="lite-mesa-setting-chip editable">
        <span>时间窗口</span>
        <input data-lite-mesa-analysis-field="maxTimeWindow" type="number" min="1" step="1" value="${htmlEscape(settings.maxTimeWindow ?? "")}" placeholder="全任务窗口">
      </label>
    `;
  }
  if (definition.analysisType === "downtime_factors") {
    return `
      <label class="lite-mesa-setting-chip editable">
        <span>排序范围</span>
        <input data-lite-mesa-analysis-field="topN" type="number" min="1" max="20" step="1" value="${htmlEscape(settings.topN ?? 4)}">
      </label>
    `;
  }
  return "";
}

function updateLiteMesaAnalysisSetting(page, field, value) {
  const definition = liteMesaAnalysisDefinitionForPage(page);
  const current = liteMesaAnalysisSettings[definition.analysisType] || {};
  const next = { ...current };
  if (field === "missionConfidenceTarget") {
    next.missionConfidenceTarget = Math.max(0, Math.min(1, Number(value) || 0));
  } else if (field === "maxTimeWindow") {
    next.maxTimeWindow = Number(value) > 0 ? Math.trunc(Number(value)) : "";
  } else if (field === "topN") {
    next.topN = Math.max(1, Math.min(20, Math.trunc(Number(value) || 1)));
  } else {
    return;
  }
  liteMesaAnalysisSettings = {
    ...liteMesaAnalysisSettings,
    [definition.analysisType]: next
  };
  liteMesaAnalysisResults = {
    ...liteMesaAnalysisResults,
    [definition.analysisType]: null
  };
}

async function runLiteMesaAnalysisPage(page) {
  const definition = liteMesaAnalysisDefinitionForPage(page);
  const settings = liteMesaAnalysisEffectiveSettings(definition);
  const samples = Math.max(1, Math.min(1000, Math.trunc(Number(settings.samples) || 1)));
  const seed = Math.trunc(Number(settings.seed) || 1);
  const normalizedSettings = {
    ...settings,
    samples,
    seed,
    ...(definition.analysisType === "downtime_factors" ? { write_event_snapshots: true } : {})
  };
  liteMesaAnalysisResults = {
    ...liteMesaAnalysisResults,
    [definition.analysisType]: {
      status: "running",
      message: "分析运行中",
      sampleCount: 0,
      metrics: definition.metricLabels.map((label) => [label, "运行中"]),
      rows: [],
      limitations: []
    }
  };
  try {
    const projectJson = await resolveSelectedExperimentPlanProjectJsonForRun();
    const response = await backendApi.runLiteMesaAnalysis(projectJson, definition.analysisType, normalizedSettings);
    liteMesaAnalysisResults = {
      ...liteMesaAnalysisResults,
      [definition.analysisType]: normalizeLiteMesaAnalysisResult(definition, response)
    };
  } catch (err) {
    liteMesaAnalysisResults = {
      ...liteMesaAnalysisResults,
      [definition.analysisType]: {
        status: "blocked",
        sampleCount: 0,
        metrics: [],
        rows: [],
        limitations: [],
        message: `分析失败：${err && err.message ? err.message : "运行错误"}`
      }
    };
  }
}

function normalizeLiteMesaAnalysisResult(definition, payload) {
  if (!payload || payload.status === "blocked") {
    return {
      status: "blocked",
      source: payload?.source || "lite_mesa_aircraft_support_v1",
      analysisType: payload?.analysis_type || definition.analysisType,
      experimentId: definition.experimentId,
      sampleCount: 0,
      seedList: [],
      metrics: [],
      rows: [],
      waveRows: [],
      dailyRows: [],
      eventSnapshots: Array.isArray(payload?.event_snapshots) ? payload.event_snapshots : [],
      limitations: Array.isArray(payload?.limitations) ? payload.limitations : [],
      message: payload?.message || "建模粒度不足：请补充装备数量、任务要求、任务周期、部件和保障节点。"
    };
  }
  const waveRows = Array.isArray(payload.wave_rows)
    ? payload.wave_rows
    : Array.isArray(payload.mission_wave_rows)
      ? payload.mission_wave_rows
      : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : waveRows;
  return {
    status: payload.status === "session_complete" ? "session_complete" : "blocked",
    source: payload.source || "lite_mesa_aircraft_support_v1",
    analysisType: payload.analysis_type || definition.analysisType,
    experimentId: payload.experiment_id || definition.experimentId,
    sampleCount: Number(payload.sample_count || payload.sampleCount || 0),
    seedList: Array.isArray(payload.seed_list) ? payload.seed_list : [],
    metrics: Array.isArray(payload.metrics) ? payload.metrics : definition.metricLabels.map((label) => [label, "无"]),
    rows,
    waveRows: waveRows.length ? waveRows : rows,
    dailyRows: Array.isArray(payload.daily_rows) ? payload.daily_rows : [],
    eventSnapshots: Array.isArray(payload.event_snapshots) ? payload.event_snapshots : [],
    limitations: Array.isArray(payload.limitations) ? payload.limitations : [],
    message: payload.message || ""
  };
}

function renderLiteMesaAnalysisMetricCards(definition, result) {
  if (result?.status === "blocked") {
    return `<div class="empty-state"><strong>建模粒度不足</strong><p>${htmlEscape(result.message)}</p></div>`;
  }
  const metrics = liteMesaAnalysisVisibleMetrics(definition, result?.metrics || definition.metricLabels.map((label) => [label, "待运行"]));
  return `
    <div class="lite-mesa-metric-cards">
      ${metrics.map(([label, value]) => `
        <div class="metric-card">
          <span>${htmlEscape(label)}</span>
          <strong>${htmlEscape(value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function liteMesaAnalysisVisibleMetrics(definition, metrics) {
  const hiddenLabels = {
    carry_list: new Set(["置信度目标", "样本数"]),
    downtime_factors: new Set(["样本数"])
  }[definition.analysisType] || new Set();
  return (metrics || []).filter(([label]) => !hiddenLabels.has(String(label)));
}

function renderLiteMesaAnalysisSessionBody(definition, result) {
  if (!result) {
    return `<div class="empty-state"><strong>尚未运行分析</strong><p>当前页会读取项目建模数据并在后端内存运行中生成分析摘要。</p></div>`;
  }
  if (result.status === "running") {
    return `<div class="empty-state"><strong>分析运行中</strong><p>当前项目正在后端内存运行中生成分析摘要。</p></div>`;
  }
  if (result.status === "blocked") {
    return `<div class="empty-state"><strong>建模粒度不足</strong><p>${htmlEscape(result.message)}</p></div>`;
  }
  const rows = definition.analysisType === "mission_reliability"
    ? (result.waveRows || result.rows || [])
    : (result.rows || []);
  if (definition.analysisType === "spare_shortfall") {
    return `<div class="table-wrap"><table class="lite-mesa-stat-table">
      <thead><tr><th>备件类别</th><th>需求次数</th><th>满足次数</th><th>平均备件延误时间(h)</th><th>满足率</th><th>风险</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.spareType)}</td><td>${row.demand}</td><td>${row.filled}</td><td>${fixed(row.meanTransportDelayHours, 2)}</td><td>${pct(row.fillRate)}</td><td>${htmlEscape(row.riskLevel)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }
  if (definition.analysisType === "carry_list") {
    return `<div class="table-wrap"><table class="lite-mesa-stat-table">
      <thead><tr><th>备件类别</th><th>建议携行数量</th><th>需求次数</th><th>短缺次数</th><th>优先级</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.spareType)}</td><td>${row.recommended}</td><td>${row.demand}</td><td>${row.shortage}</td><td>${htmlEscape(row.riskLevel)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }
  if (definition.analysisType === "mission_reliability") {
    return `
      ${renderLiteMesaMissionReliabilityWaveChart(rows)}
      <details class="lite-mesa-collapsible-table">
        <summary>样本明细（${rows.length}）</summary>
        <div class="table-wrap"><table class="lite-mesa-stat-table">
        <thead><tr><th>任务波次</th><th>样本数</th><th>平均任务成功率</th><th>平均出动架次率</th><th>平均应执行波次</th><th>平均成功波次</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.waveLabel || row.waveKey || `波次${row.sequence ?? "-"}`)}</td><td>${htmlEscape(row.sampleCount ?? "-")}</td><td>${fixed(row.meanMissionSuccessRate ?? row.missionSuccessRate, 3)}</td><td>${formatLiteMesaAnalysisMetricValue("出动架次率", row.meanSortieRate ?? row.sortieRate)}</td><td>${fixed(row.plannedWaves ?? row.planned_waves, 1)}</td><td>${fixed(row.successfulWaves ?? row.successful_waves, 1)}</td></tr>`).join("")}</tbody>
        </table></div>
      </details>
    `;
  }
  return `
    <div class="table-wrap"><table class="lite-mesa-stat-table">
      <thead><tr><th>因素</th><th>类型</th><th>次数</th><th>贡献度</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${htmlEscape(row.label)}</td><td>${htmlEscape(row.reason)}</td><td>${row.count}</td><td>${pct(row.contribution)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${renderLiteMesaDowntimeEventSnapshots(result.eventSnapshots || [])}
  `;
}

function formatLiteMesaAnalysisMetricValue(label, value) {
  if (String(label || "").includes("出动架次率")) return fixed(value, 3);
  return pct(value);
}

function renderLiteMesaMissionReliabilityWaveChart(rows) {
  if (!rows.length) {
    return `<div class="empty-state"><strong>任务波次平均成功率</strong><p>当前会话未返回按任务波次聚合的任务成功率。</p></div>`;
  }
  const points = rows.map((row, index) => ({
    x: Number(row.sequence || index + 1),
    y: Number(row.meanMissionSuccessRate ?? row.missionSuccessRate ?? 0)
  }));
  return `
    <div class="analysis-chart-panel">
      <div class="chart-title">任务波次平均成功率</div>
      ${renderLineChart(points)}
    </div>
  `;
}

function renderLiteMesaDowntimeEventSnapshots(snapshots) {
  if (!snapshots.length) {
    return `<div class="empty-state"><strong>停机事件一览</strong><p>当前停机因素运行未捕获到停机事件日志。</p></div>`;
  }
  return `
    <div class="lite-mesa-event-snapshots">
      <div class="section-head">
        <h3>停机事件一览</h3>
        <span>${snapshots.length} 条停机事件</span>
      </div>
      ${snapshots.map((snapshot, index) => renderLiteMesaDowntimeEventSnapshot(snapshot, index)).join("")}
    </div>
  `;
}

function renderLiteMesaDowntimeEventSnapshot(snapshot, index) {
  const aircraft = Array.isArray(snapshot.aircraft_state?.aircraft) ? snapshot.aircraft_state.aircraft : [];
  const aircraftSummary = snapshot.aircraft_state?.summary || snapshot.aircraft_state || {};
  const resources = Array.isArray(snapshot.support_resources) ? snapshot.support_resources : [];
  const shortages = Array.isArray(snapshot.spare_shortages) ? snapshot.spare_shortages : [];
  return `
    <details class="lite-mesa-event-snapshot" ${index === 0 ? "open" : ""}>
      <summary>
        <strong>${htmlEscape(snapshot.event_label || snapshot.event_type || "停机事件")}</strong>
        <span>seed ${htmlEscape(snapshot.seed ?? "-")} / t=${htmlEscape(snapshot.simulation_time ?? "-")} / ${htmlEscape(snapshot.result || "downtime_anomaly_recorded")}</span>
      </summary>
      <div class="downtime-snapshot-grid">
        <section>
          <h4>飞机状态</h4>
          <table><tbody>
            <tr><th>可用飞机</th><td>${htmlEscape(aircraftSummary.available_aircraft ?? "-")}</td></tr>
            <tr><th>故障飞机</th><td>${htmlEscape(aircraftSummary.failed_count ?? "-")}</td></tr>
            <tr><th>维修中</th><td>${htmlEscape(aircraftSummary.repairing_count ?? "-")}</td></tr>
          </tbody></table>
          <div class="snapshot-chip-row">${aircraft.slice(0, 8).map((item) => `<span>${htmlEscape(item.tail_number || item.name || "aircraft")}：${htmlEscape(item.state || "-")}</span>`).join("") || "<span>无飞机明细</span>"}</div>
        </section>
        <section>
          <h4>保障资源占用</h4>
          <table><thead><tr><th>资源</th><th>人员</th><th>设备</th><th>库存</th></tr></thead><tbody>
            ${resources.map((resource) => `<tr>
              <td>${htmlEscape(resource.name || resource.resource_id || "-")}</td>
              <td>${htmlEscape(resource.personnel_in_use ?? resource.in_use ?? 0)} / ${htmlEscape(resource.personnel_capacity ?? resource.capacity ?? "-")}</td>
              <td>${htmlEscape(resource.equipment_in_use ?? 0)} / ${htmlEscape(resource.equipment_capacity ?? "-")}</td>
              <td>${htmlEscape(formatSnapshotInventory(resource.inventory))}</td>
            </tr>`).join("") || `<tr><td colspan="4">无资源明细</td></tr>`}
          </tbody></table>
        </section>
        <section>
          <h4>备件短缺</h4>
          <table><thead><tr><th>备件</th><th>需求</th><th>可用</th><th>作业</th></tr></thead><tbody>
            ${shortages.map((item) => `<tr>
              <td>${htmlEscape(item.spare_type || "-")}</td>
              <td>${htmlEscape(item.required_quantity ?? "-")}</td>
              <td>${htmlEscape(item.available_quantity ?? "-")}</td>
              <td>${htmlEscape(item.job_id || item.reason || "-")}</td>
            </tr>`).join("") || `<tr><td colspan="4">无备件短缺</td></tr>`}
          </tbody></table>
        </section>
      </div>
    </details>
  `;
}

function formatSnapshotInventory(inventory) {
  if (!inventory || typeof inventory !== "object") return "-";
  const entries = Object.entries(inventory).slice(0, 4);
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(" / ") : "-";
}

function field(label, path, type = "text", attrs = {}) {
  return `<label>${label}${valueInput(path, type, attrs)}</label>`;
}

function valueInput(path, type = "text", attrs = {}) {
  const attrText = Object.entries(withModelingLockAttrs(attrs))
    .map(([key, value]) => ` ${key}="${htmlEscape(value)}"`)
    .join("");
  return `<input data-path="${path}" type="${type}" value="${htmlEscape(getPath(scenario, path))}"${attrText}>`;
}

function valueSelect(path, options, attrs = {}) {
  const selectedValue = String(getPath(scenario, path));
  const attrText = Object.entries(withModelingLockAttrs(attrs))
    .map(([key, value]) => ` ${key}="${htmlEscape(value)}"`)
    .join("");
  return `
    <select data-path="${path}"${attrText}>
      ${options.map((option) => {
        const value = String(option.value);
        return `<option value="${htmlEscape(value)}" ${value === selectedValue ? "selected" : ""}>${htmlEscape(option.label)}</option>`;
      }).join("")}
    </select>
  `;
}

function readOnlyTableValue(value) {
  return `<span class="readonly-table-value" aria-readonly="true">${htmlEscape(value ?? "")}</span>`;
}

function isActiveTertiary(activePage, pages) {
  return pages.some((page) => page.id === activePage.id);
}

function readFeatureIdFromHash() {
  const featureId = readRawFeatureIdFromHash();
  return featureId ? getFeaturePageById(featureId).id : "";
}

function readRawFeatureIdFromHash() {
  if (typeof location === "undefined") return "";
  const match = location.hash.match(/feature=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function normalizeSelectedFeatureHash(featureId) {
  if (typeof location === "undefined" || typeof window === "undefined") return;
  const rawFeatureId = readRawFeatureIdFromHash();
  if (!rawFeatureId || rawFeatureId === featureId) return;
  const normalizedHash = `feature=${encodeURIComponent(featureId)}`;
  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `${location.pathname}${location.search}#${normalizedHash}`);
    return;
  }
  location.hash = normalizedHash;
}

function readRouteFromHash() {
  if (typeof location === "undefined") return "";
  const match = location.hash.match(/route=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (location.hash.includes("feature=")) return "workbench";
  return "";
}

function readStoredBackendAuthToken() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_STORAGE_KEY) || "null")?.session?.token || "";
  } catch {
    return "";
  }
}

function getPlanListFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-experiment-plan-management";
  return "spare-planning-experiment-plan-management";
}

function getVisualSimulationFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-visual-mesa-page";
  return "spare-planning-visual-mesa-page";
}

function getMonteCarloExperimentDetailFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-monte-carlo-experiment-detail";
  return "spare-planning-monte-carlo-experiment-detail";
}

function getPath(obj, path) {
  return path.split(".").reduce((current, part) => current?.[part], obj) ?? "";
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    if (current[part] == null || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function parseInput(input) {
  if (input.type === "checkbox") return input.checked;
  return input.type === "number" ? Number(input.value) : input.value;
}

function isLiveProjectDraftInput(input) {
  const tagName = String(input.tagName || "").toUpperCase();
  const type = String(input.type || "").toLowerCase();
  return tagName === "TEXTAREA" || (tagName === "INPUT" && !["checkbox", "radio", "file", "button", "submit"].includes(type));
}

function updateEquipmentKOutOfNInput(input) {
  const component = scenario.components[Number(input.dataset.equipmentKOutOfNIndex)];
  if (!component) return;
  const quantity = equipmentKOutOfNQuantity(component.quantity);
  const nextK = input.value === "" ? quantity : Number(input.value);
  component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1, n: quantity, k: nextK };
  const message = validateEquipmentComponentKOutOfN(component);
  input.setCustomValidity(message);
  if (!message) {
    normalizeEquipmentComponentKOutOfN(component);
    input.value = String(component.kOutOfN.k);
  }
  updatePreviewResultsThroughApiClient();
}

function normalizeEquipmentKOutOfNForPath(path) {
  const match = String(path || "").match(/^components\.(\d+)\.quantity$/);
  if (!match) return;
  const component = scenario.components[Number(match[1])];
  if (!component) return;
  const previousK = component.kOutOfN?.k;
  const quantity = equipmentKOutOfNQuantity(component.quantity);
  component.quantity = quantity;
  if (previousK === undefined || previousK === null || previousK === "" || Number(previousK) < 1) {
    component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1, n: quantity, k: quantity };
    return;
  }
  component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1, n: quantity, k: Number(previousK) };
}

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
}

function ensureMonteCarloSweepDefaults(projectJson) {
  if (!projectJson || typeof projectJson !== "object") return projectJson;
  if (!projectJson.monteCarlo || typeof projectJson.monteCarlo !== "object" || Array.isArray(projectJson.monteCarlo)) {
    projectJson.monteCarlo = {};
  }
  const defaultSweep = defaultMonteCarloSweepForProject(projectJson);
  for (const key of ["failureRates", "spareMultipliers", "supportCapacities"]) {
    const values = key === "supportCapacities"
      ? positiveIntegerList(projectJson.monteCarlo[key])
      : positiveNumberList(projectJson.monteCarlo[key]);
    projectJson.monteCarlo[key] = values.length ? [values[0]] : [...defaultSweep[key]];
  }
  const sweepPointCount = projectJson.monteCarlo.failureRates.length
    * projectJson.monteCarlo.spareMultipliers.length
    * projectJson.monteCarlo.supportCapacities.length;
  projectJson.experiment = {
    ...(projectJson.experiment || {}),
    samples: Math.max(Number(projectJson.experiment?.samples || 0), sweepPointCount)
  };
  return projectJson;
}

function ensureExperimentPlanDraftDefaults(projectJson) {
  if (!projectJson || typeof projectJson !== "object") return projectJson;
  if (!projectJson.experiment || typeof projectJson.experiment !== "object" || Array.isArray(projectJson.experiment)) {
    projectJson.experiment = {};
  }
  const defaults = defaultScenario.experiment || {};
  const projectName = String(currentProject?.name || projectJson.projectInfo?.name || projectJson.scenarioId || "当前项目").trim();
  projectJson.experiment.name ||= `${projectName} 仿真实验方案`;
  projectJson.experiment.steps = positiveExperimentNumber(projectJson.experiment.steps, defaults.steps || 24);
  projectJson.experiment.samples = positiveExperimentNumber(projectJson.experiment.samples, defaults.samples || 4);
  const seed = Number(projectJson.experiment.seed);
  projectJson.experiment.seed = Number.isFinite(seed) ? seed : Number(defaults.seed || 20260621);
  if (!projectJson.seedPolicy || typeof projectJson.seedPolicy !== "object" || Array.isArray(projectJson.seedPolicy)) {
    projectJson.seedPolicy = { mode: "fixed", baseSeed: projectJson.experiment.seed };
  }
  projectJson.seedPolicy.mode = projectJson.seedPolicy.mode === "random" ? "random" : "fixed";
  projectJson.seedPolicy.baseSeed = positiveExperimentSeed(projectJson.seedPolicy.baseSeed ?? projectJson.experiment.seed);
  projectJson.experiment.seed = projectJson.seedPolicy.baseSeed;
  if (!projectJson.stopPolicy || typeof projectJson.stopPolicy !== "object" || Array.isArray(projectJson.stopPolicy)) {
    projectJson.stopPolicy = { schemaVersion: "stop-policy-v0", mode: "or", conditions: [{ type: "duration" }], defaulted: true };
  }
  projectJson.stopPolicy.schemaVersion ||= "stop-policy-v0";
  projectJson.stopPolicy.mode = projectJson.stopPolicy.mode === "and" ? "and" : "or";
  projectJson.stopPolicy.conditions = normalizedExperimentStopConditions(projectJson.stopPolicy.conditions);
  if (!projectJson.scenarioComposition || typeof projectJson.scenarioComposition !== "object" || Array.isArray(projectJson.scenarioComposition)) {
    projectJson.scenarioComposition = { schemaVersion: "scenario-composition-v0", overrides: [] };
  }
  if (!Array.isArray(projectJson.scenarioComposition.overrides)) {
    projectJson.scenarioComposition.overrides = [];
  }
  return projectJson;
}

function positiveExperimentNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveExperimentSeed(value) {
  return Math.max(1, Math.trunc(positiveExperimentNumber(value, defaultScenario.experiment?.seed || 20260621)));
}

function generatedExperimentSeed() {
  return Math.max(1, Math.trunc(Date.now() % 2147483647));
}

function experimentPlanSeedPolicy() {
  ensureExperimentPlanDraftDefaults(experimentPlanDraft);
  const policy = experimentPlanDraft.seedPolicy;
  policy.baseSeed = positiveExperimentSeed(policy.baseSeed ?? experimentPlanDraft.experiment?.seed);
  experimentPlanDraft.experiment.seed = policy.baseSeed;
  return policy;
}

function experimentPlanStopPolicy() {
  ensureExperimentPlanDraftDefaults(experimentPlanDraft);
  experimentPlanDraft.stopPolicy.conditions = normalizedExperimentStopConditions(experimentPlanDraft.stopPolicy.conditions);
  return experimentPlanDraft.stopPolicy;
}

function normalizedExperimentStopConditions(conditions) {
  const sourceConditions = Array.isArray(conditions) ? conditions : [];
  const normalized = sourceConditions.map(normalizedExperimentStopCondition).filter(Boolean);
  return normalized.length ? normalized : [{ type: "duration" }];
}

function normalizedExperimentStopCondition(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
  const type = normalizedExperimentStopConditionType(condition.type);
  if (!type) return null;
  if (type === "specifiedTime") {
    return { type, minute: positiveExperimentStopMinute(condition.minute ?? condition.timeMinute ?? 1440) };
  }
  if (type === "duration") {
    const durationMinutes = positiveExperimentNumber(
      condition.durationMinutes ?? condition.duration_minutes ?? condition.minute ?? condition.minutes,
      0
    );
    return durationMinutes > 0 ? { type, durationMinutes: Math.trunc(durationMinutes) } : { type };
  }
  return { type };
}

function normalizedExperimentStopConditionType(value) {
  const text = String(value || "").trim();
  if (["duration", "taskDuration", "task_duration"].includes(text)) return "duration";
  if (["failure", "taskFailure", "task_failure"].includes(text)) return "failure";
  if (["specifiedTime", "specified_time", "time", "targetTime", "target_time"].includes(text)) return "specifiedTime";
  return "";
}

function positiveExperimentStopMinute(value) {
  return Math.max(1, Math.trunc(positiveExperimentNumber(value, 1440)));
}

function scenarioCompositionDraft() {
  ensureExperimentPlanDraftDefaults(experimentPlanDraft);
  const composition = experimentPlanDraft.scenarioComposition;
  composition.schemaVersion ||= "scenario-composition-v0";
  composition.sourceProjectId = currentBackendProjectId();
  composition.baseProjectVersion = savedProject?.project_version || scenario.project_version || "project-v0.1";
  return composition;
}

function updateScenarioOverrideInput(input) {
  const index = Number(input.dataset.scenarioOverrideIndex);
  if (!Number.isInteger(index) || index < 0) return;
  const composition = scenarioCompositionDraft();
  if (!composition.overrides[index]) {
    composition.overrides[index] = { path: "", valueType: "string", value: "", label: "" };
  }
  const override = composition.overrides[index];
  if (input.closest("[data-scenario-override-path]")) {
    override.path = input.value;
  } else if (input.closest("[data-scenario-override-value-type]")) {
    override.valueType = input.value;
  } else if (input.closest("[data-scenario-override-value]")) {
    override.value = input.value;
  } else if (input.closest("[data-scenario-override-label]")) {
    override.label = input.value;
  }
}

function updateSelectedScenarioOverrideInput(input) {
  const path = input.dataset.scenarioSelectedOverridePath || selectedScenarioCompositionPath;
  if (!path) return;
  selectedScenarioCompositionPath = path;
  const sourceProjectJson = scenarioCompositionSourceProjectJson();
  const override = upsertScenarioOverrideForPath(path, sourceProjectJson);
  if (input.closest("[data-scenario-selected-override-value-type]")) {
    override.valueType = input.value;
  } else if (input.closest("[data-scenario-selected-override-value]")) {
    override.value = input.value;
  }
}

function defaultMonteCarloSweepForProject(projectJson) {
  return {
    failureRates: [...DEFAULT_MONTE_CARLO_SWEEP.failureRates],
    spareMultipliers: [...DEFAULT_MONTE_CARLO_SWEEP.spareMultipliers],
    supportCapacities: supportCapacitySweepForProject(projectJson)
  };
}

function supportCapacitySweepForProject(projectJson) {
  const supportNodes = Array.isArray(projectJson?.supportNodes) ? projectJson.supportNodes : [];
  for (const node of supportNodes) {
    const capacity = firstPositiveInteger([
      node?.equipmentCapacity,
      node?.personnelCapacity,
      node?.capacity
    ]);
    if (capacity !== null) return [capacity];
  }
  return [...DEFAULT_MONTE_CARLO_SWEEP.supportCapacities];
}

function positiveNumberList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((number) => Number.isFinite(number) && number > 0);
}

function positiveIntegerList(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "boolean") continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    const integer = Math.max(1, Math.round(number));
    if (seen.has(integer)) continue;
    seen.add(integer);
    normalized.push(integer);
  }
  return normalized;
}

function firstPositiveInteger(values) {
  return positiveIntegerList(values)[0] ?? null;
}

function updateMonteCarloArrayInput(mcArrayInput) {
  experimentPlanBranchActive = true;
  setPath(experimentPlanDraft, mcArrayInput.dataset.mcArrayPath, parseNumberList(mcArrayInput.value));
  updatePreviewResultsThroughApiClient(experimentPlanDraft);
}

function stateLabel(state) {
  const labels = {
    available: "可用",
    pre_support: "保障中",
    mission_ready: "待出动",
    flying: "飞行",
    post_support: "回收",
    maintenance: "维修"
  };
  return labels[state] || state;
}

function mesaStateClass(state) {
  return String(state || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function ratioFixed(value) {
  return Number(value || 0).toFixed(2);
}

function fixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
