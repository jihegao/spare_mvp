import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "./feature-catalog.mjs";
import { AVIATION_SUPPORT_DEMO_STATE, normalizeAviationSupportState } from "./aviation-support-state.mjs";
import {
  buildBackendProjectJson,
  buildPreviewResultState,
  buildFrontendResultState,
  createBackendApiClient
} from "./api-client.mjs";
import { buildRunIntent, submitRunIntent } from "./run-intent.mjs";
import {
  cloneScenario,
  defaultScenario
} from "./sim-engine.mjs?v=20260619-task-modeling";
import {
  deleteSupportActivityJobAt,
  deleteSupportActivityJobsAtIndexes,
  supportActivityJobs
} from "./support-activity-jobs.mjs";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  publishRmsAllocation
} from "./rms-allocation-engine.mjs";
import { renderRmsAllocationWorkbench } from "./rms-allocation-workbench.mjs";
import { validateModelingImportPackage } from "./modeling-import-contract.mjs";
import {
  cloneModelingImportPackage,
  diffModelingImports,
  normalizeModelingImportRecord,
  renderModelingImportWorkbench
} from "./modeling-import-workbench.mjs";
import { MODELING_IMPORT_DEMO_FIXTURE } from "./modeling-import-demo-fixture.mjs";
import { ensurePublishedModelingImportForSampleProject } from "./modeling-import-project-flow.mjs";
import {
  addEquipmentNodeForSelectionModel,
  buildEquipmentComponentTreeModel,
  componentBelongsToAircraftModel,
  resolveEquipmentSelectionModel,
  wholeMachineModelsForScenario
} from "./equipment-tree-model.mjs";

const app = document.querySelector("#app");
const groups = groupFeaturePages(FEATURE_PAGES);
const CONTRACT_BASE = "http://127.0.0.1:8521"; // Mesa 契约服务（见 agent.md「Mesa 后台契约服务」）
const LAST_BACKEND_RUN_STORAGE_KEY = "spare-mvp:lastBackendRun";
const AUTH_SESSION_STORAGE_KEY = "spare-mvp:m4Session";
const MANUAL_PROJECT_DRAFTS_STORAGE_KEY = "spare-mvp:manualProjects:v1";
const PROJECT_DRAFT_AUTOSAVE_DELAY_MS = 800;
let backendAuthToken = readStoredBackendAuthToken();
const backendApi = createBackendApiClient({ baseUrl: "/api", getAuthToken: () => backendAuthToken });
const DEFAULT_ROUTE = "login";
const DEFAULT_FEATURE_ID = "spare-planning-equipment-composition";
const DEMO_USERS = [
  { username: "admin", role: "系统管理员" },
  { username: "data", role: "数据管理员" },
  { username: "user", role: "普通用户" }
];
const PROJECT_SOURCE = Object.freeze({
  manual_draft: "manual_draft",
  imported_sample: "imported_sample"
});
let demoProjects = mergeProjectsById(readManualDraftProjectsFromStorage());
const ANALYSIS_PROJECTION_TYPES = [
  { analysisType: "spare_shortfall", artifactKind: "analysis_projection_spare_shortfall", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "carry_list", artifactKind: "analysis_projection_carry_list", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "mission_reliability", artifactKind: "analysis_projection_mission_reliability", source_artifact_id: "monte_carlo_base_artifact" },
  { analysisType: "downtime_factors", artifactKind: "analysis_projection_downtime_factors", source_artifact_id: "monte_carlo_base_artifact" }
];
const SYSTEM_PROJECT_DATA_ROWS = [
  { key: "projectId", label: "项目标识", value: "landbase-day-night", owner: "项目主数据" },
  { key: "baseProfile", label: "机场保障资源", value: "主基地 / 前进保障点 / 后方保障点", owner: "项目独有数据" },
  { key: "missionPackage", label: "任务包数据", value: "昼间巡逻、夜间警戒、周期波次", owner: "项目独有数据" },
  { key: "spareBaseline", label: "备件基线", value: "发动机备件、航电模块、液压备件", owner: "项目独有数据" }
];

const SYSTEM_DATA_MANAGEMENT_TABS = [
  {
    key: "modeling",
    label: "建模数据",
    rows: SYSTEM_PROJECT_DATA_ROWS
  },
  {
    key: "experiment",
    label: "实验配置",
    rows: [
      { key: "experimentPlans", label: "仿真实验方案", value: "方案列表 / 方案编辑 / Monte Carlo 实验", owner: "实验配置" },
      { key: "runConfig", label: "运行配置", value: "steps / seed / 样本数 / sweep", owner: "实验配置" }
    ]
  },
  {
    key: "results",
    label: "实验结果",
    rows: [
      { key: "runStatus", label: "运行状态", value: "run status / result summary / artifact manifest", owner: "实验结果" },
      { key: "analysisTasks", label: "分析任务", value: "备件短板 / 携行清单 / 可靠度 / 停机因素", owner: "实验结果" }
    ]
  }
];

const SYSTEM_MODELING_GRANULARITY_ROWS = [
  { level: "项目层", object: "项目", relation: "包含任务剖面、装备、保障节点" },
  { level: "任务层", object: "任务剖面 / 基本任务 / 复合任务", relation: "复合任务编排基本任务，周期任务引用复合任务" },
  { level: "装备层", object: "整机 / 系统 / LRU", relation: "装备组成树与可靠性框图共用节点标识" },
  { level: "保障层", object: "保障组织 / 人员 / 设备 / 备件 / 活动", relation: "保障活动消耗资源并作用于装备节点" }
];

let systemUsers = [
  { username: "admin", name: "系统管理员", role: "系统管理员", status: "启用" },
  { username: "data", name: "数据管理员", role: "数据管理员", status: "启用" },
  { username: "user", name: "普通用户", role: "项目用户", status: "启用" }
];

let selectedSystemUsernames = new Set();
let permissionConfigFeature = "";
let permissionConfigStatus = "请选择权限项配置角色权限";
let activeSystemDataTab = "modeling";
let selectedSystemDataKeys = new Set();
let systemDataStatus = "可新增、选择、批量删除或导出当前项目数据列表。";
let systemDataExportPreview = null;

const SYSTEM_PERMISSION_ROWS = [
  { feature: "项目管理", admin: "管理", data: "编辑", user: "查看" },
  { feature: "装备RMS指标分配", admin: "管理", data: "编辑", user: "查看" },
  { feature: "系统基础配置", admin: "管理", data: "查看", user: "无权限" },
  { feature: "仿真建模", admin: "管理", data: "编辑", user: "编辑" },
  { feature: "结果分析", admin: "查看", data: "查看", user: "查看" }
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
      sourceKind: Object.values(PROJECT_SOURCE).includes(project.sourceKind) ? project.sourceKind : PROJECT_SOURCE.manual_draft,
      sourceImportId: project.sourceImportId || "",
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

function readManualDraftProjectsFromStorage() {
  try {
    const raw = localStorage.getItem(MANUAL_PROJECT_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeProjectsById(
      parsed
        .map((project) => ({
          ...project,
          sourceKind: PROJECT_SOURCE.manual_draft
        }))
        .filter((project) => project.id)
    );
  } catch {
    return [];
  }
}

function persistManualDraftProjects() {
  const manualDrafts = demoProjects
    .filter((project) => project.sourceKind === PROJECT_SOURCE.manual_draft)
    .map((project) => ({
      id: project.id,
      name: project.name,
      baseCode: project.baseCode,
      summary: project.summary,
      updatedAt: project.updatedAt,
      sourceKind: PROJECT_SOURCE.manual_draft
    }));
  localStorage.setItem(MANUAL_PROJECT_DRAFTS_STORAGE_KEY, JSON.stringify(manualDrafts));
}


let scenario = cloneScenario(defaultScenario);
let experimentPlanDraft = cloneScenario(scenario);
let experimentPlanBranchActive = false;
let lastRunExperimentPlanProjectJson = null;
let selectedMonteCarloExperimentId = "";
let monteCarloExperiments = createDefaultMonteCarloExperiments();
let analysisTasks = [];
let selectedAnalysisTaskId = "";
let analysisTaskForms = {};
let { previewSingleResult: singleResult, previewMonteCarloResult: monteCarloResult } = buildPreviewResultState(scenario);
let rmsAllocationProject = createDemoRmsAllocationProject();
let rmsAllocationPlan = createDefaultRmsAllocationPlan(rmsAllocationProject);
let rmsAllocationResult = calculateRmsAllocation(rmsAllocationPlan, rmsAllocationProject);
let rmsPublishedProject = null;
let modelingImportPackage = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
let modelingImportPublishedPackage = null;
let modelingImportValidation = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE.validation);
let modelingImportCompileResult = null;
let modelingImportStatus = "样例导入包已加载";
let modelingImportSaved = false;
let savedProject = null;
let modelingSnapshot = null;
let experimentPlan = null;
let projectDraftSaveStatus = "未保存";
let projectDraftHydrateStatus = "";
let projectDraftAutosaveTimer = null;
let projectDraftLastSavedAt = "";
let backendRun = null;
let backendRunResult = null;
let backendArtifactManifest = null;
let backendRunChain = null;
let backendApiStatus = "离线演示";
let formalRunSubmitInFlight = false;
let systemUserEditor = null;
let systemUsersLoadStatus = "未加载";
let systemUsersLoaded = false;
let isLoggedIn = false;
let currentUser = DEMO_USERS[2];
let currentProject = demoProjects[0] || null;
let projectListStatus = "可添加本地草稿，也可从已发布导入包生成示例项目。";
let projectEditorDraft = null;
let selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
let selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
let selectedMesaView = "aircraft";
let liveAviationState = null; // 来自契约服务的活仿真状态；为 null 时回退演示快照
let aviationSource = "demo"; // "live"（契约服务）或 "demo"（静态快照）
let aviationSteps = 12; // 向契约服务请求的仿真步数
let aviationLoadInFlight = false; // 防止重复并发拉取
let collapsedTreeNodes = new Set();
let carryObjective = "availability";
let experimentRunStatus = "当前";
let isProjectMenuOpen = false;
let selectedPeriodicTaskId = "";
let selectedEquipmentComponentIndex = 0;
let selectedEquipmentNodeKey = "";
let selectedBasicMissionKey = "primary";
let selectedBasicMissionTreeLevel = "mission";
let selectedBasicMissionEquipmentType = scenario.basicMission.equipmentType || scenario.equipment.model || "";
let selectedCompositeTaskId = "";
let selectedCombatUnitMemberIndex = 0;
let selectedSupportOrgNodeId = "";
let selectedSupportActivityJobKeys = new Set();
let selectedSupportResourceKeys = new Set();
let deletedSupportResourceKeys = new Set();
let selectedBasicActivityKeys = new Set();

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
  return Array.isArray(tree) ? tree : [];
}

function supportActivityPlanForPage(page, activity) {
  const type = page.name;
  const jobs = supportActivityJobs(activity || {});
  const treeChildren = jobs.map((job, index) => ({
    id: `${activity?.id || "activity"}:job:${index}`,
    name: job.workName || job.activityCode || `工作项目${index + 1}`
  }));
  return {
    type,
    treeTitle: page.name.includes("基本") ? "基本保障活动清单" : `${type}树`,
    path: [type, activity?.activityName || type],
    tree: {
      id: activity?.id || `support-activity:${type}`,
      name: activity?.activityName || type,
      children: treeChildren
    }
  };
}

function carryObjectiveOption(id) {
  const final = singleResult?.final || {};
  const options = {
    availability: { label: "使用可用度", metricLabel: "当前使用可用度", metricValue: fixed(final.ready_rate || 0, 2) },
    "sortie-rate": { label: "出动架次率", metricLabel: "当前出动架次率", metricValue: fixed(final.sortie_rate || 0, 2) },
    "turnaround-time": { label: "再次出动准备时间", metricLabel: "当前准备时间", metricValue: `${fixed(final.mean_turnaround_time || 0, 1)} h` }
  };
  return options[id] || options.availability;
}
render();
bindEvents();
hydrateLastBackendRunFromApi();

function bindEvents() {
  window.addEventListener("hashchange", () => {
    selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
    selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
    createExperimentPlanBranchFromCurrentProject();
    render();
  });

  app.addEventListener("click", (event) => {
    const clickedTreeToggleIcon = event.target.closest(".tree-node-toggle");
    const equipmentAddNodeButton = event.target.closest("[data-equipment-add-node]");
    if (equipmentAddNodeButton) {
      addEquipmentNodeForSelection();
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
      selectedCompositeTaskId = compositeTaskRow.dataset.selectCompositeTask;
      render();
      return;
    }

    const supportOrgNode = event.target.closest("[data-select-support-org-node]");
    if (supportOrgNode && !clickedTreeToggleIcon) {
      selectedSupportOrgNodeId = supportOrgNode.dataset.selectSupportOrgNode;
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

    const combatUnitRow = event.target.closest("[data-select-combat-unit-member]");
    if (combatUnitRow) {
      selectedCombatUnitMemberIndex = Number(combatUnitRow.dataset.selectCombatUnitMember);
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

    const treeToggle = event.target.closest("[data-tree-toggle]");
    if (treeToggle) {
      toggleTreeNodeFromElement(treeToggle);
      render();
      return;
    }

    const logisticsAddButton = event.target.closest("[data-logistics-transport-add]");
    if (logisticsAddButton) {
      const activity = findLogisticsSupportActivity();
      if (!activity) {
        backendApiStatus = "暂无后勤保障活动数据，请先导入并发布建模 JSON，或在当前页面创建数据。";
        render();
        return;
      }
      activity.transportStrategies = [
        ...(Array.isArray(activity.transportStrategies) ? activity.transportStrategies : []),
        { direction: "\u6a2a\u5411\u8fd0\u8f93", spareType: spareModelingNames()[0] || "", triggerMode: "\u4e34\u754c\u5e93\u5b58", criticalInventory: 1, from: scenario.supportNodes[0]?.id || "", to: scenario.supportNodes[1]?.id || "", transportTimeHours: 1 }
      ];
      markProjectDraftChanged();
      render();
      return;
    }

    const logisticsDeleteButton = event.target.closest("[data-logistics-transport-delete]");
    if (logisticsDeleteButton) {
      const activity = findLogisticsSupportActivity();
      if (!activity) return;
      const index = Number(logisticsDeleteButton.dataset.logisticsTransportDelete);
      activity.transportStrategies = (Array.isArray(activity.transportStrategies) ? activity.transportStrategies : []).filter((_, rowIndex) => rowIndex !== index);
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobDeleteButton = event.target.closest("[data-support-activity-job-delete]");
    if (supportActivityJobDeleteButton) {
      deleteSupportActivityJob(supportActivityJobDeleteButton.dataset.supportActivityJobDelete);
      markProjectDraftChanged();
      render();
      return;
    }

    const supportActivityJobAddButton = event.target.closest("[data-support-activity-job-add]");
    if (supportActivityJobAddButton) {
      addSupportActivityJob(supportActivityJobAddButton.dataset.supportActivityJobAdd);
      markProjectDraftChanged();
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

    const supportActivityJobEditButton = event.target.closest("[data-support-activity-job]");
    if (supportActivityJobEditButton) {
      selectSupportActivityJobForEdit(supportActivityJobEditButton.dataset.supportActivityJob);
      render();
      return;
    }

    const basicActivityAddButton = event.target.closest("[data-basic-activity-add]");
    if (basicActivityAddButton) {
      addBasicActivityLibraryJob();
      markProjectDraftChanged();
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
      render();
      return;
    }

    const supportResourceEditButton = event.target.closest("[data-support-resource-edit]");
    if (supportResourceEditButton) {
      activateSupportResourceEdit(supportResourceEditButton.dataset.supportResourceEdit);
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

    const addProjectButton = event.target.closest("[data-project-add]");
    if (addProjectButton) {
      addDemoProject();
      render();
      return;
    }

    const createFromImportButton = event.target.closest("[data-project-create-from-import]");
    if (createFromImportButton) {
      createSampleProjectFromPublishedImport(currentPublishedModelingImportId()).finally(() => render());
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
      saveProjectEditorDraft();
      render();
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
      deleteDemoProject(deleteProjectButton.dataset.projectDelete);
      render();
      return;
    }

    const systemManagementButton = event.target.closest("[data-system-management-entry]");
    if (systemManagementButton) {
      selectedRoute = "workbench";
      selectedFeatureId = "system-management-project-data-management";
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const enterWorkbenchButton = event.target.closest("[data-enter-workbench]");
    if (enterWorkbenchButton) {
      handleEnterWorkbench(enterWorkbenchButton.dataset.projectId).finally(() => render());
      return;
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
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${getPlanListFeatureId(page.module)}`;
      render();
      return;
    }

    const mesaViewButton = event.target.closest("[data-mesa-view]");
    if (mesaViewButton) {
      selectedMesaView = mesaViewButton.dataset.mesaView;
      render();
      return;
    }

    const mesaControlButton = event.target.closest("[data-mesa-control]");
    if (mesaControlButton) {
      const action = mesaControlButton.dataset.mesaControl;
      if (action === "step") aviationSteps += 1;
      else if (action === "play") aviationSteps += 12;
      else if (action === "reset") aviationSteps = 0;
      loadAviationSupportState();
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
      deleteSystemUsers([systemUserDeleteButton.dataset.systemUserDelete]);
      render();
      return;
    }

    const systemDataTabButton = event.target.closest("[data-system-data-tab]");
    if (systemDataTabButton) {
      activeSystemDataTab = systemDataTabButton.dataset.systemDataTab;
      selectedSystemDataKeys = new Set();
      systemDataExportPreview = null;
      render();
      return;
    }

    const systemDataAddButton = event.target.closest("[data-system-data-add]");
    if (systemDataAddButton) {
      addSystemDataRow();
      render();
      return;
    }

    const systemDataDeleteButton = event.target.closest("[data-system-data-delete-selected]");
    if (systemDataDeleteButton) {
      deleteSelectedSystemDataRows();
      render();
      return;
    }

    const systemDataExportButton = event.target.closest("[data-system-data-export]");
    if (systemDataExportButton) {
      exportSystemDataRows();
      render();
      return;
    }

    const modelingGranularityDetailButton = event.target.closest("[data-modeling-granularity-detail]");
    if (modelingGranularityDetailButton) {
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

    const singleRunButton = event.target.closest("[data-run-intent-single]");
    if (singleRunButton) {
      startSingleRunThroughApi().finally(() => render());
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

    const periodicDeleteButton = event.target.closest("[data-periodic-delete]");
    if (periodicDeleteButton) {
      const taskId = periodicDeleteButton.dataset.periodicDelete;
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

    const rmsActionButton = event.target.closest("[data-rms-action]");
    if (rmsActionButton) {
      if (rmsActionButton.dataset.rmsAction === "publish") {
        rmsPublishedProject = publishRmsAllocation(rmsAllocationProject, rmsAllocationResult);
      } else {
        recalculateRmsAllocation();
      }
      render();
      return;
    }

    const monteCarloExperimentButton = event.target.closest("[data-mc-experiment-action]");
    if (monteCarloExperimentButton) {
      const page = getFeaturePageById(selectedFeatureId);
      const action = monteCarloExperimentButton.dataset.mcExperimentAction;
      if (action === "add") {
        const experiment = createMonteCarloExperiment(page.module);
        monteCarloExperiments = [...monteCarloExperiments, experiment];
        selectedMonteCarloExperimentId = experiment.id;
        selectedFeatureId = getMonteCarloExperimentEditFeatureId(page.module);
      } else if (action === "detail") {
        selectedMonteCarloExperimentId = monteCarloExperimentButton.dataset.mcExperimentId || selectedMonteCarloExperimentId;
        selectedFeatureId = getMonteCarloExperimentDetailFeatureId(page.module);
      } else if (action === "edit") {
        selectedMonteCarloExperimentId = monteCarloExperimentButton.dataset.mcExperimentId || selectedMonteCarloExperimentId;
        selectedFeatureId = getMonteCarloExperimentEditFeatureId(page.module);
      } else if (action === "list") {
        selectedFeatureId = getMonteCarloExperimentListFeatureId(page.module);
      }
      createExperimentPlanBranchFromCurrentProject();
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const monteCarloStartButton = event.target.closest("[data-mc-action='start']");
    if (monteCarloStartButton) {
      if (formalRunSubmitInFlight) {
        backendApiStatus = "已有正式运行正在提交，请等待当前请求返回";
        render();
        return;
      }
      const page = getFeaturePageById(selectedFeatureId);
      const experiment = currentMonteCarloExperiment(page.module);
      if (!experiment) {
        backendApiStatus = "暂无蒙特卡洛实验数据，请先导入并发布建模 JSON，或在当前页面创建数据。";
        render();
        return;
      }
      selectedMonteCarloExperimentId = experiment.id;
      monteCarloExperiments = monteCarloExperiments.map((item) => item.id === experiment.id
        ? { ...item, status: "运行中", progress: 35, runType: "monte_carlo", runId: backendRun?.run_id || item.runId }
        : item);
      experimentRunStatus = "运行中";
      startMonteCarloRunThroughApi({ monteCarloExperimentId: experiment.mc_experiment_id });
      selectedRoute = "workbench";
      selectedFeatureId = getMonteCarloExperimentDetailFeatureId(page.module);
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const analysisActionButton = event.target.closest("[data-analysis-action]");
    if (analysisActionButton) {
      const page = getFeaturePageById(selectedFeatureId);
      const action = analysisActionButton.dataset.analysisAction;
      if (action === "create-with-mc") {
        const task = createAnalysisTaskForPage(page, analysisTaskFormForPage(page));
        const experiment = ensureAnalysisTaskMonteCarloExperiment(task, { forceNew: true });
        selectedMonteCarloExperimentId = experiment.id;
        backendApiStatus = `已自动创建 ${experiment.id} 并绑定分析任务 ${task.id}`;
      } else if (action === "edit") {
        const task = analysisTasks.find((item) => item.id === analysisActionButton.dataset.analysisTaskId);
        if (task) {
          selectedAnalysisTaskId = task.id;
          analysisTaskForms = { ...analysisTaskForms, [analysisFormKey(page)]: analysisFormFromTask(task) };
        }
      } else if (action === "save") {
        const task = updateSelectedAnalysisTaskFromForm(page);
        if (task) {
          const experiment = ensureAnalysisTaskMonteCarloExperiment(task, { forceNew: true });
          selectedMonteCarloExperimentId = experiment.id;
          backendApiStatus = `已按新参数创建 ${experiment.id} 并重新绑定分析任务 ${task.id}`;
        }
      } else if (action === "delete") {
        const taskId = analysisActionButton.dataset.analysisTaskId || selectedAnalysisTaskId;
        analysisTasks = analysisTasks.filter((item) => item.id !== taskId);
        if (selectedAnalysisTaskId === taskId) selectedAnalysisTaskId = "";
      }
      render();
      return;
    }

    const featureButton = event.target.closest("[data-feature-id]");
    if (featureButton) {
      selectedRoute = "workbench";
      selectedFeatureId = featureButton.dataset.featureId;
      createExperimentPlanBranchFromCurrentProject();
      location.hash = `feature=${selectedFeatureId}`;
      render();
    }
  });

  app.addEventListener("change", (event) => {
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

    const supportResourceAircraft = event.target.closest("[data-support-resource-aircraft]");
    if (supportResourceAircraft) {
      updateSupportResourceOverride(
        supportResourceAircraft.dataset.supportResourceAircraft,
        "aircraft",
        Array.from(supportResourceAircraft.selectedOptions).map((option) => option.value)
      );
      markProjectDraftChanged();
      render();
      return;
    }

    const systemUserSelectAll = event.target.closest("[data-system-user-select-all]");
    if (systemUserSelectAll) {
      selectedSystemUsernames = systemUserSelectAll.checked
        ? new Set(systemUsers.map((user) => user.username))
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
      render();
      return;
    }

    const systemDataSelect = event.target.closest("[data-system-data-select]");
    if (systemDataSelect) {
      selectedSystemDataKeys = toggleSetValue(selectedSystemDataKeys, systemDataSelect.dataset.systemDataSelect);
      render();
      return;
    }

    const permissionRoleSelect = event.target.closest("[data-permission-role]");
    if (permissionRoleSelect) {
      updatePermissionRole(permissionRoleSelect.dataset.permissionRole, permissionRoleSelect.value);
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

    const supportActivityPredecessors = event.target.closest("[data-support-activity-predecessors]");
    if (supportActivityPredecessors) {
      updateSupportActivityJobPredecessors(
        supportActivityPredecessors.dataset.supportActivityPredecessors,
        Array.from(supportActivityPredecessors.selectedOptions).map((option) => option.value)
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

    const monteCarloExperimentInput = event.target.closest("[data-mc-experiment-field]");
    if (monteCarloExperimentInput) {
      const page = getFeaturePageById(selectedFeatureId);
      const experiment = currentMonteCarloExperiment(page.module);
      if (!experiment) return;
      const parsedValue = parseInput(monteCarloExperimentInput);
      selectedMonteCarloExperimentId = experiment.id;
      monteCarloExperiments = monteCarloExperiments.map((item) => item.id === experiment.id
        ? { ...item, [monteCarloExperimentInput.dataset.mcExperimentField]: parsedValue }
        : item);
      if (monteCarloExperimentInput.dataset.experimentPlanPath) {
        experimentPlanBranchActive = true;
        setPath(experimentPlanDraft, monteCarloExperimentInput.dataset.experimentPlanPath, parsedValue);
        updatePreviewResultsThroughApiClient(experimentPlanDraft);
      }
      render();
      return;
    }

    const analysisTaskInput = event.target.closest("[data-analysis-task-field]");
    if (analysisTaskInput) {
      const page = getFeaturePageById(selectedFeatureId);
      updateAnalysisTaskFormField(page, analysisTaskInput);
      if (analysisTaskInput.tagName === "SELECT") render();
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

  app.addEventListener("input", (event) => {
    const projectEditInput = event.target.closest("[data-project-edit-field]");
    if (projectEditInput) {
      updateProjectEditorDraft(projectEditInput.dataset.projectEditField, projectEditInput.value);
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

    const analysisTaskInput = event.target.closest("[data-analysis-task-field]");
    if (analysisTaskInput) {
      updateAnalysisTaskFormField(getFeaturePageById(selectedFeatureId), analysisTaskInput);
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

function render() {
  if (!isLoggedIn) {
    app.innerHTML = renderLoginPage();
    return;
  }
  if (selectedRoute === "projects") {
    app.innerHTML = renderProjectListPage();
    return;
  }
  const page = getFeaturePageById(selectedFeatureId);
  selectedFeatureId = page.id;
  app.innerHTML = `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
        <div>
          <h1>备件规划及任务可靠度验证评估平台</h1>
          <p>${htmlEscape(currentProject?.name || "未选择项目")} / ${renderTopbarContext(page)}</p>
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

function renderTopbarContext(page) {
  if (page.module === "系统管理") return `系统管理 / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}`;
  return `${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}`;
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
        <button type="button" data-system-management-entry>系统管理</button>
        <button type="button" data-logout>退出</button>
      </div>
    </header>
    <main class="project-page">
      <section class="project-toolbar">
        <div>
          <h2>项目列表</h2>
          <p>${htmlEscape(projectListStatus)}</p>
          <p class="inline-status">可从已发布建模导入包生成示例项目，或添加本地 Project draft。</p>
        </div>
        <div class="toolbar-row compact-actions">
          <button type="button" class="btn-secondary" data-project-create-from-import>从导入数据生成示例项目</button>
          <button type="button" class="btn-primary" data-project-add>添加</button>
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
              </span>
            </div>
          </article>
        `).join("") : `
          <div class="empty-state">
            <strong>暂无项目</strong>
            <p>请添加本地草稿，或从已发布建模导入包生成示例项目。</p>
          </div>
        `}
      </section>
    </main>
  `;
}

function projectSourceBadge(project) {
  const labels = {
    [PROJECT_SOURCE.imported_sample]: "导入示例",
    [PROJECT_SOURCE.manual_draft]: "本地草稿"
  };
  return `<span class="status-badge ${project.sourceKind === PROJECT_SOURCE.imported_sample ? "success" : ""}">${htmlEscape(labels[project.sourceKind] || labels[PROJECT_SOURCE.manual_draft])}</span>`;
}

function projectSourceHelpText(project) {
  if (project.sourceKind === PROJECT_SOURCE.imported_sample) {
    return `来自已发布建模导入包 ${project.sourceImportId || "未知"}，可用于正式后端测试。`;
  }
  if (project.sourceKind === PROJECT_SOURCE.manual_draft) {
    return "本地新增 Project draft；保存或运行前不会替代已发布导入示例。";
  }
  return "项目来源待确认。";
}

function renderNavigation(activePage) {
  return `
    <aside class="feature-nav" aria-label="功能导航">
      ${Object.entries(groups).map(([moduleName, secondaryGroups]) => `
        <details class="nav-module" ${moduleName === activePage.module ? "open" : ""}>
          <summary>${moduleName}</summary>
          ${moduleName === "系统管理"
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
  const siblingPages = groups[page.module][page.secondary][page.tertiary];
  return `
    <section class="deck-modeling-content feature-page">
      <div class="page-head">
        ${renderPageHeading(page)}
        ${renderCurrentContext(page)}
      </div>
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
  return `
    <button class="page-head-current-context" type="button" data-plan-list-link>
      <span>当前方案</span>
      <strong>${htmlEscape(scenario.experiment.name)}</strong>
    </button>
  `;
}

function shouldShowCurrentContext(page) {
  return page.module !== "系统管理" && page.secondary !== "仿真建模";
}

function renderPageHeading(page) {
  const breadcrumb = page.module === "系统管理"
    ? `<div class="breadcrumb">系统管理 / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}</div>`
    : `<div class="breadcrumb">${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}</div>`;
  return `
    <div>
      ${breadcrumb}
      <h2>${htmlEscape(page.tertiary)}</h2>
    </div>
  `;
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
  if (page.component === "experiment-plan-list") return renderExperimentPlanList(page);
  if (page.component === "experiment-plan-editor") return renderExperimentPlanEditor(page);
  if (page.component === "experiment-form") return renderExperimentPlanEditor(page);
  if (page.component === "system-project-management") return renderSystemProjectManagement(page);
  if (page.component === "system-basic-config") return renderSystemBasicConfig(page);
  if (page.component === "modeling-import-workbench") return renderModelingImportWorkbench({
    importPackage: modelingImportPackage,
    publishedPackage: modelingImportPublishedPackage,
    validation: modelingImportValidation,
    diff: diffModelingImports(modelingImportPublishedPackage, modelingImportPackage),
    compileResult: modelingImportCompileResult,
    actionStatus: modelingImportStatus,
    canPublish: modelingImportSaved,
    canCompile: Boolean(modelingImportPublishedPackage)
  }, {
    htmlEscape
  });
  if (page.component === "rms-allocation") return renderRmsAllocationWorkbench({
    project: rmsAllocationProject,
    plan: rmsAllocationPlan,
    result: rmsAllocationResult,
    publishedProject: rmsPublishedProject,
    htmlEscape,
    fixed,
    pct
  });
  if (page.component === "monte-carlo-experiment-list") return renderMonteCarloExperimentList(page);
  if (page.component === "monte-carlo-experiment-editor") return renderMonteCarloExperimentEditor(page);
  if (page.component === "monte-carlo-experiment-detail") return renderMonteCarloExperimentDetail(page);
  if (page.component === "monte-carlo-config") return renderMonteCarloConfig();
  if (page.component === "monte-carlo-results") return renderMonteCarloResults();
  if (page.component === "analysis") return renderAnalysis(page);
  if (page.component === "scenario-switch") return renderScenarioSwitch();
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
  if (!["experiment-plan-editor", "experiment-form", "monte-carlo-config", "monte-carlo-experiment-editor"].includes(page.component)) return;
  if (experimentPlanBranchActive) return;
  experimentPlanDraft = cloneScenario(scenario);
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
  return `
    <div class="tree-node-item ${isCollapsed ? "collapsed" : ""}" data-tree-node="${htmlEscape(nodeId)}">
      <button type="button" class="${labelClass}" ${buttonToggleAttrs}${actionAttrs} aria-expanded="${hasChildren ? String(!isCollapsed) : "false"}">
        <span class="tree-node-toggle"${iconToggleAttrs}>${hasChildren ? (isCollapsed ? "▶" : "▼") : "•"}</span>
        <span class="tree-node-text">${htmlEscape(node.label)}</span>
        ${node.meta ? `<span class="tree-node-meta">${htmlEscape(node.meta)}</span>` : ""}
      </button>
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
  for (const record of tasks) {
    const task = record.task;
    const equipmentType = task.equipmentType || scenario.basicMission.equipmentType || scenario.equipment.model || "未指定飞机类型";
    const taskName = task.name || task.basicTaskName || task.taskName || scenario.basicMission.name || "未命名基本任务";
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
  return Array.from(grouped.entries()).map(([equipmentType, children]) => ({
    id: `basic-task-equipment:${equipmentType}`,
    label: equipmentType,
    meta: `${children.length} 项基本任务`,
    root: true,
    selected: selectedBasicMissionTreeLevel === "equipment" && equipmentType === selectedBasicMissionEquipmentType,
    actionAttrs: `data-select-basic-mission-equipment="${htmlEscape(equipmentType)}"`,
    children
  }));
}

function editableBasicMissionRecords() {
  return [
    { key: "primary", path: "basicMission", task: scenario.basicMission },
    ...basicMissionExtras().map((task, index) => ({
      key: `extra:${task.id || index}`,
      path: `basicMissions.${index}`,
      task
    }))
  ].filter((record) => record.task);
}

function basicMissionExtras() {
  if (!Array.isArray(scenario.basicMissions)) scenario.basicMissions = [];
  return scenario.basicMissions;
}

function resolveSelectedBasicMission() {
  const records = editableBasicMissionRecords();
  return records.find((record) => record.key === selectedBasicMissionKey) || records[0];
}

function addBasicMission() {
  const extras = basicMissionExtras();
  const index = editableBasicMissionRecords().length + 1;
  const selected = resolveSelectedBasicMission();
  const equipmentType = selectedBasicMissionEquipmentType || selected.task.equipmentType || scenario.basicMission.equipmentType || scenario.equipment.model || "";
  const task = {
    ...JSON.parse(JSON.stringify(scenario.basicMission)),
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
  if (selected.key === "primary") {
    if (extras.length > 0) {
      scenario.basicMission = extras.shift();
    } else {
      scenario.basicMission = createEmptyBasicMission();
    }
    selectedBasicMissionKey = "primary";
    selectedBasicMissionTreeLevel = "mission";
  } else if (selected.key.startsWith("extra:")) {
    const index = extras.findIndex((task, taskIndex) => `extra:${task.id || taskIndex}` === selected.key);
    if (index >= 0) extras.splice(index, 1);
    selectedBasicMissionKey = "primary";
    selectedBasicMissionTreeLevel = "mission";
  }
  updatePreviewResultsThroughApiClient();
}

function createEmptyBasicMission() {
  return {
    id: "basic-mission-empty",
    name: "未命名基本任务",
    taskNo: "BM-01",
    equipmentType: scenario.equipment.model || "",
    equipmentQuantity: 1,
    successPoint: 0.9,
    returnRatio: 0.3,
    priority: 1,
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
  const basic = resolveSelectedBasicMission()?.task || scenario.basicMission || {};
  const equipmentType = basic.equipmentType || scenario.equipment.model || "";
  const taskName = basic.name || basic.basicTaskName || basic.missionId || `基本任务${index + 1}`;
  return {
    id: `composite-task-item-${Date.now()}-${index + 1}`,
    basicTaskName: taskName,
    equipmentType,
    taskDurationMinutes: Number(basic.taskDurationMinutes || 180),
    requiredEquipmentQuantity: Number(basic.equipmentQuantity || basic.minRequiredSorties || 1),
    groupName: `新增编队${index + 1}`,
    firstWaveTime: "08:45",
    recoveryTime: "11:45",
    priority: index + 1,
    minRequiredSystems: Number(basic.minRequiredSorties || 1),
    dailyRepeatCount: 1,
    intervalHours: 6,
    preparationMinutes: 45
  };
}

function basicMissionOptions() {
  return editableBasicMissionRecords().map((record) => {
    const task = record.task || {};
    const name = task.name || task.basicTaskName || task.missionId || record.key;
    return { value: name, label: name };
  });
}

function findBasicMissionByName(name) {
  return editableBasicMissionRecords().map((record) => record.task).find((task) => {
    const taskName = task?.name || task?.basicTaskName || task?.missionId || "";
    return String(taskName) === String(name);
  });
}

function basicMissionSelect(path, selectedValue) {
  return valueSelect(path, basicMissionOptions());
}

function renderSystemProjectManagement(page) {
  const isGranularityPage = page.name === "建模颗粒度管理";
  const body = isGranularityPage
    ? `
      <section class="detail-panel">
        <div class="detail-card">
          ${renderModelingGranularityTable()}
        </div>
      </section>
    `
    : `
      <section class="detail-panel">
        <div class="detail-card">
          ${renderProjectDataTable()}
        </div>
      </section>
    `;
  return `
    <div class="system-config-workbench">
      <div class="section-head">
        <h3>${isGranularityPage ? "建模颗粒度配置" : "项目数据管理"}</h3>
        <span>${page.dataObjects.join(" / ")}</span>
      </div>
      ${body}
    </div>
  `;
}

function renderProjectDataTable() {
  const activeTab = SYSTEM_DATA_MANAGEMENT_TABS.find((tab) => tab.key === activeSystemDataTab) || SYSTEM_DATA_MANAGEMENT_TABS[0];
  const rows = activeTab.rows;
  const allSelected = rows.length > 0 && rows.every((row) => selectedSystemDataKeys.has(row.key));
  const project = currentProject || { id: "", name: "", baseCode: "" };
  return `
    <div class="section-head">
      <h3>项目数据列表</h3>
      <span>按建模数据、实验配置、实验结果分组管理，可导出当前列表</span>
    </div>
    <div class="compact-fourth-tabs" aria-label="数据管理分类">
      ${SYSTEM_DATA_MANAGEMENT_TABS.map((tab) => `
        <button type="button" class="${tab.key === activeTab.key ? "active" : ""}" data-system-data-tab="${tab.key}">${tab.label}</button>
      `).join("")}
    </div>
    <div class="form-table-grid">
      <label>项目标识<input value="${htmlEscape(project.id)}"></label>
      <label>项目名称<input value="${htmlEscape(project.name)}"></label>
      <label>基地编码<input value="${htmlEscape(project.baseCode)}"></label>
      <label>数据隔离策略<input value="项目标识 + 数据对象命名空间"></label>
    </div>
    <div class="toolbar-row"><button type="button" class="btn-primary" data-system-data-add>新增</button><button type="button" class="btn-danger" data-system-data-delete-selected>批量删除</button><button type="button" data-system-data-export>导出</button></div>
    <p class="inline-status" data-system-data-status>${htmlEscape(systemDataStatus)}</p>
    ${systemDataExportPreview ? `
      <div class="inline-status" data-system-data-export-preview>
        导出预览：${htmlEscape(systemDataExportPreview.label)} / ${systemDataExportPreview.rowCount} 行 /
        <span data-system-data-export-filename>${htmlEscape(systemDataExportPreview.filename)}</span>
      </div>
    ` : ""}
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th><input type="checkbox" data-system-data-select-all ${allSelected ? "checked" : ""}></th><th>数据项</th><th>字段标识</th><th>当前值</th><th>归属</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr><td><input type="checkbox" data-system-data-select="${htmlEscape(row.key)}" ${selectedSystemDataKeys.has(row.key) ? "checked" : ""}></td><td>${htmlEscape(row.label)}</td><td>${htmlEscape(row.key)}</td><td>${htmlEscape(row.value)}</td><td>${htmlEscape(row.owner)}</td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderModelingGranularityTable() {
  return `
    <div class="section-head">
      <h3>层级、对象及关系</h3>
      <span>定义项目所需的建模数据层级、对象及关系</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>建模层级</th><th>建模对象</th><th>对象关系</th><th>操作</th></tr></thead>
        <tbody>${SYSTEM_MODELING_GRANULARITY_ROWS.map((row) => `
          <tr><td>${row.level}</td><td>${row.object}</td><td>${row.relation}</td><td><button type="button" class="inline-action" data-modeling-granularity-detail="${htmlEscape(row.level)}">查看详情</button></td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function activeSystemDataDefinition() {
  return SYSTEM_DATA_MANAGEMENT_TABS.find((tab) => tab.key === activeSystemDataTab) || SYSTEM_DATA_MANAGEMENT_TABS[0];
}

function currentSystemDataRows() {
  return activeSystemDataDefinition().rows;
}

function addSystemDataRow() {
  const tab = activeSystemDataDefinition();
  const nextIndex = tab.rows.length + 1;
  const row = {
    key: `${tab.key}Local${Date.now()}`,
    label: `${tab.label}新增项${nextIndex}`,
    value: "本地新增数据",
    owner: tab.label
  };
  tab.rows = [...tab.rows, row];
  selectedSystemDataKeys = new Set([row.key]);
  systemDataExportPreview = null;
  systemDataStatus = `已新增${tab.label}：${row.label}`;
}

function deleteSelectedSystemDataRows() {
  const tab = activeSystemDataDefinition();
  if (!selectedSystemDataKeys.size) {
    systemDataStatus = "请先选择要删除的数据项";
    return;
  }
  const selectedKeys = new Set(selectedSystemDataKeys);
  const beforeCount = tab.rows.length;
  tab.rows = tab.rows.filter((row) => !selectedKeys.has(row.key));
  selectedSystemDataKeys = new Set();
  systemDataExportPreview = null;
  systemDataStatus = `已删除 ${beforeCount - tab.rows.length} 条${tab.label}`;
}

function exportSystemDataRows() {
  const tab = activeSystemDataDefinition();
  const rows = currentSystemDataRows();
  systemDataExportPreview = {
    label: tab.label,
    rowCount: rows.length,
    filename: systemDataExportFilename(tab)
  };
  downloadSystemDataExport(systemDataExportPreview.filename, buildSystemDataExportPayload(tab, rows));
  systemDataStatus = `已下载${tab.label}导出文件：${systemDataExportPreview.filename}（${rows.length} 行）`;
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
    rows: rows.map((row) => ({ ...row }))
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
  const configTitle = page.name;
  return `
    <div class="system-config-workbench">
      <div class="section-head">
        <h3>${htmlEscape(configTitle)}</h3>
        <span>${page.dataObjects.join(" / ")}</span>
      </div>
      ${page.name === "用户管理" ? renderUserManagementConfig() : ""}
      ${page.name === "系统功能权限管理" ? renderPermissionManagementConfig() : ""}
    </div>
  `;
}

function renderUserManagementConfig() {
  ensureSystemUsersLoaded();
  const allSelected = systemUsers.length > 0 && systemUsers.every((user) => selectedSystemUsernames.has(user.username));
  return `
    <div class="toolbar-row">
      <button type="button" class="btn-primary" data-system-user-action="add">新增用户</button>
      <button type="button" class="btn-danger" data-system-user-action="delete-selected">删除用户</button>
      <input value="" placeholder="按用户名、角色搜索">
    </div>
    <p class="inline-status" data-system-user-status>${htmlEscape(systemUsersLoadStatus)}</p>
    ${systemUserEditor ? renderSystemUserEditor() : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th><input type="checkbox" data-system-user-select-all ${allSelected ? "checked" : ""}></th><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${systemUsers.map((user) => `
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
    <div class="toolbar-row"><button type="button" class="btn-primary">新增权限项</button><button type="button" class="btn-danger">批量删除</button></div>
    <p class="inline-status">${htmlEscape(permissionConfigStatus)}</p>
    ${permissionConfigFeature ? renderPermissionConfigEditor() : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th>功能层级</th><th>系统管理员</th><th>数据管理员</th><th>项目用户</th><th>操作</th></tr></thead>
        <tbody>${SYSTEM_PERMISSION_ROWS.map((row) => `
          <tr><td>${row.feature}</td><td>${row.admin}</td><td>${row.data}</td><td>${row.user}</td><td><button type="button" class="inline-action" data-permission-configure="${htmlEscape(row.feature)}">配置权限</button></td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderPermissionConfigEditor() {
  const row = SYSTEM_PERMISSION_ROWS.find((item) => item.feature === permissionConfigFeature) || SYSTEM_PERMISSION_ROWS[0];
  const options = ["管理", "编辑", "查看", "无权限"];
  return `
    <div class="detail-card">
      <div class="section-head"><h4>配置权限：${htmlEscape(row.feature)}</h4><span>浏览器本地原型配置</span></div>
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

function renderTaskModel(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="form-table-grid">
      ${field("任务类型", "missionProfile.profileType")}
      ${field("重复周期", "missionProfile.repeatCycleHours", "number")}
      ${field("结束条件", "missionProfile.endCondition")}
      ${field("基本任务", "basicMission.missionId")}
      ${field("成功点", "basicMission.successPoint", "number", { min: "0", max: "1", step: "0.01" })}
      ${field("最低出动数量", "basicMission.minRequiredSorties", "number")}
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
          meta: `${scenario.equipment.quantity} 架`
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
      ${field("出发机场名称", "airports.0.name")}
      ${field("出发机场位置", "airports.0.location")}
      ${field("出发机场跑道类型", "airports.0.runwayType")}
      ${field("距任务区(km)", "airports.0.distanceToMissionKm", "number")}
      ${field("关联保障节点", "airports.0.supportNodeId")}
      ${field("备用机场名称", "airports.1.name")}
      ${field("备用机场位置", "airports.1.location")}
      ${field("备用机场跑道类型", "airports.1.runwayType")}
      ${field("备用机场距任务区(km)", "airports.1.distanceToMissionKm", "number")}
      ${field("任务区名称", "missionAreas.0.name")}
      ${field("任务区类型", "missionAreas.0.areaType")}
      ${field("距出发机场(km)", "missionAreas.0.distanceFromDepartureKm", "number")}
      ${field("任务区半径(km)", "missionAreas.0.patrolRadiusKm", "number")}
      ${field("威胁等级", "missionAreas.0.threatLevel")}
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
          children: scenario.airports.map((airport) => ({
            id: `scenario-airport:${airport.id || airport.name}`,
            label: airport.name,
            meta: `${airport.location} / 距任务区 ${airport.distanceToMissionKm} km`
          }))
        },
        {
          id: "scenario-tree:mission-areas",
          label: "任务区",
          children: scenario.missionAreas.map((area) => ({
            id: `scenario-area:${area.id || area.name}`,
            label: area.name,
            meta: `${area.areaType} / 距出发机场 ${area.distanceFromDepartureKm} km`
          }))
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
          <button type="button" data-combat-unit-edit disabled>编辑</button>
          <button type="button" class="btn-danger" data-combat-unit-delete>删除</button>
        </div>
      </div>
      <div class="table-wrap unframed-table">
        <table>
          <thead><tr><th>飞机编号</th><th>飞机类型</th><th>前置寿命</th><th>起降次数</th></tr></thead>
          <tbody>
            ${members.map((member, index) => `
              <tr class="${index === boundedSelectedIndex ? "selected-table-row" : ""}" data-select-combat-unit-member="${index}">
                <td>${htmlEscape(member.aircraftNo)}</td>
                <td>${htmlEscape(member.model)}</td>
                <td>${htmlEscape(member.preLifeRequirementHours ?? scenario.equipment.preLifeRequirementHours ?? member.remainingLifeHours ?? "")}</td>
                <td>${htmlEscape(member.takeoffLandingCount ?? member.landings ?? 0)}</td>
              </tr>
            `).join("") || "<tr><td colspan='4'>暂无飞机</td></tr>"}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function addCombatUnitMember() {
  if (!Array.isArray(scenario.combatUnit.members)) scenario.combatUnit.members = [];
  const members = scenario.combatUnit.members;
  const index = members.length + 1;
  const model = scenario.equipment.wholeMachineModels?.[0] || scenario.equipment.model || "";
  const aircraftNo = `${model || "AIRCRAFT"}-${String(index).padStart(2, "0")}`;
  members.push({
    aircraftNo,
    model,
    role: "新增",
    status: "执行",
    remainingLifeHours: Number(scenario.equipment.preLifeRequirementHours || 120),
    preLifeRequirementHours: Number(scenario.equipment.preLifeRequirementHours || 120),
    takeoffLandingCount: 0,
    deploymentLocation: scenario.equipment.deploymentLocation || scenario.combatUnit.deploymentLocation || ""
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
  const missionPath = selectedMission.path || "basicMission";
  const phases = scenario.missionPhases || [];
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
                <tr><th>装备类型</th><td>${valueInput(`${missionPath}.equipmentType`)}</td></tr>
                <tr><th>装备数量</th><td>${valueInput(`${missionPath}.equipmentQuantity`, "number")}</td></tr>
                <tr><th>最小装备数量</th><td>${valueInput(`${missionPath}.minRequiredSorties`, "number")}</td></tr>
                <tr><th>任务成功点</th><td>${valueInput(`${missionPath}.successPoint`, "number", { min: "0", max: "1", step: "0.01" })}</td></tr>
                <tr><th>返回时间比</th><td>${valueInput(`${missionPath}.returnRatio`, "number")}</td></tr>
                <tr><th>任务优先级</th><td>${valueInput(`${missionPath}.priority`, "number")}</td></tr>
                <tr><th>任务时长（分钟）</th><td>${valueInput(`${missionPath}.taskDurationMinutes`, "number")}</td></tr>
                <tr><th>取消时间（min）</th><td>${valueInput(`${missionPath}.cancelMinutes`, "number")}</td></tr>
                <tr><th>使用保障活动</th><td>${valueInput(`${missionPath}.supportActivityName`)}</td></tr>
                <tr><th>任务区域描述</th><td>${valueInput(`${missionPath}.taskArea`)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="detail-card network-card">
          <div class="tree-toolbar">
            <h4>任务阶段</h4>
            <div class="toolbar-row" style="margin-bottom:0;">
              <button type="button" class="btn-primary" data-basic-mission-phase-add>添加</button>
              <button type="button" disabled>编辑</button>
            </div>
          </div>
          <div class="inline-status ${phaseRatioValid ? "success" : "warn"}">阶段占比合计 ${fixed(phaseRatioTotal, 2)}；${phaseRatioValid ? "满足合计为 1" : "必须调整为 1 后才能作为正式编译输入"}</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>序号</th><th>阶段名称</th><th>阶段占比</th><th>操作</th></tr></thead>
              <tbody>
                ${phases.map((phase, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${valueInput(`missionPhases.${index}.name`)}</td>
                    <td>${valueInput(`missionPhases.${index}.phaseRatio`, "number", { min: "0", max: "1", step: "0.01" })}</td>
                    <td><button type="button" class="btn-danger" data-basic-mission-phase-delete="${index}">删除</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function missionPhaseRatioTotal(phases = scenario.missionPhases || []) {
  return phases.reduce((sum, phase) => sum + Number(phase.phaseRatio || 0), 0);
}

function addMissionPhase() {
  const phases = Array.isArray(scenario.missionPhases) ? scenario.missionPhases : [];
  const remainingRatio = Math.max(0, 1 - missionPhaseRatioTotal(phases));
  scenario.missionPhases = [
    ...phases,
    { name: `阶段${phases.length + 1}`, phaseRatio: Number(remainingRatio.toFixed(2)) }
  ];
}

function deleteMissionPhase(index) {
  scenario.missionPhases = (Array.isArray(scenario.missionPhases) ? scenario.missionPhases : []).filter((_, rowIndex) => rowIndex !== index);
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
                <tr class="${index === selected.index ? "active" : ""}" data-select-composite-task="${htmlEscape(task.id || index)}">
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
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>基本任务名称</th><th>装备类型</th><th>任务时长</th><th>要求装备数量</th><th>编队名称</th><th>出发时间</th><th>任务优先级</th><th>最小装备数量</th><th>单日重复次数</th><th>间隔小时数</th><th>操作</th></tr></thead>
                <tbody>
                  ${(composite.taskItems || []).map((item, index) => {
                    const basicTask = findBasicMissionByName(item.basicTaskName);
                    return `
                    <tr>
                      <td>${basicMissionSelect(`${compositePath}.taskItems.${index}.basicTaskName`, item.basicTaskName)}</td>
                      <td><input readonly value="${htmlEscape(basicTask?.equipmentType || item.equipmentType || "")}"></td>
                      <td><input readonly value="${htmlEscape(basicTask?.taskDurationMinutes || item.taskDurationMinutes || "")}"></td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.requiredEquipmentQuantity`, "number", { min: "1", step: "1" })}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.groupName`)}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.firstWaveTime`, "time")}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.priority`, "number")}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.minRequiredSystems`, "number")}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.dailyRepeatCount`, "number")}</td>
                      <td>${valueInput(`${compositePath}.taskItems.${index}.intervalHours`, "number")}</td>
                      <td class="table-actions"><button type="button" class="btn-danger" data-composite-task-item-delete="${index}">删除</button></td>
                    </tr>
                  `; }).join("") || `<tr><td colspan="11">暂无基本任务</td></tr>`}
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
  const compositeOptions = [
    { value: "", label: "请选择复合任务" },
    ...compositeTasks.map((task) => ({ value: task.id, label: task.name }))
  ];
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout task-modeling-periodic-layout">
      <div class="tree-container">
        <div class="tree-toolbar">
          <h4>周期性任务列表</h4>
          <button type="button" class="btn-primary" data-periodic-add>新增</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>序号</th><th>周期性任务名称</th><th>操作</th></tr></thead>
            <tbody>
              ${periodicTasks.map((task, index) => `
                <tr class="${String(task.id) === String(selectedTask?.id) ? "active" : ""}" data-periodic-select="${htmlEscape(task.id)}">
                  <td>${index + 1}</td>
                  <td>${htmlEscape(task.name)}</td>
                  <td class="table-actions">
                    <button type="button" data-periodic-select="${htmlEscape(task.id)}">选择</button>
                    <button type="button" class="btn-danger" data-periodic-delete="${htmlEscape(task.id)}">删除</button>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="3" class="muted">暂无周期性任务数据</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <div class="periodic-panel-head">
            <div>
              <h4>周期性任务建模</h4>
              <p class="muted">左侧选择周期性任务，右侧按周期天数维护每天对应的复合任务与重复轮次。</p>
            </div>
            ${selectedDraft ? `<span class="status-badge">当前：${htmlEscape(selectedDraft.name)}</span>` : ""}
          </div>
          ${selectedDraft ? `
            ${compositeTasks.length === 0 ? `<div class="alert warn">请先在复合任务建模中维护复合任务。</div>` : ""}
            <div class="form-table-grid">
              <label>周期性任务名称 *<input data-periodic-field="name" value="${htmlEscape(selectedDraft.name)}" placeholder="例如：一周飞行训练计划A"></label>
              <label>任务周期天数 *<input data-periodic-field="cycleDays" type="number" min="1" max="30" step="1" value="${htmlEscape(selectedDraft.cycleDays)}"></label>
              <label>重复轮次 *<input data-periodic-field="repeatWeeks" type="number" min="1" step="1" value="${htmlEscape(selectedDraft.repeatWeeks)}"></label>
            </div>
            <div class="table-wrap" style="margin-top:12px;">
              <table>
                <thead><tr><th style="width:120px;">任务周期</th><th>复合任务名称</th></tr></thead>
                <tbody>
                  ${selectedDraft.compositeTasks.map((row, index) => `
                    <tr>
                      <td>${htmlEscape(periodicDayLabel(row.week))}</td>
                      <td>${periodicValueSelect(`dayComposite:${index}`, row.compositeTaskId, compositeOptions)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="alert warn">暂无周期性任务，请先在左侧列表新增。</div>`}
        </div>
      </div>
    </div>
  `;
}

function periodicTaskList() {
  if (!Array.isArray(scenario.missionProfile.periodicTasks)) {
    scenario.missionProfile.periodicTasks = [];
  }
  scenario.missionProfile.periodicTasks = scenario.missionProfile.periodicTasks.map((task) => normalizePeriodicTask(task));
  return scenario.missionProfile.periodicTasks;
}

function selectedPeriodicTask(periodicTasks = periodicTaskList()) {
  if (!periodicTasks.length) {
    selectedPeriodicTaskId = "";
    return null;
  }
  const selected = periodicTasks.find((task) => String(task.id) === String(selectedPeriodicTaskId)) || periodicTasks[0];
  selectedPeriodicTaskId = String(selected.id);
  return selected;
}

function createPeriodicTaskDraft(source = {}) {
  const order = periodicTaskList().length + 1;
  return normalizePeriodicTask({
    id: source.id || `periodic-${Date.now()}`,
    name: source.name || `周期性任务${order}`,
    cycleDays: source.cycleDays || source.taskPeriodDays || 7,
    repeatWeeks: source.repeatWeeks || source.repeatRounds || 1
  });
}

function normalizePeriodicTaskCycleDays(source = {}) {
  const explicitDays = source.cycleDays ?? source.taskPeriodDays ?? source.periodDays ?? source.repeatCycleDays;
  if (explicitDays != null) {
    return clampPeriodicCycleDays(explicitDays);
  }
  const cycleValue = Math.max(1, Math.floor(Number(source.repeatCycleValue ?? 1)));
  const cycleUnit = String(source.repeatCycleUnit || "").trim();
  if (cycleUnit === "week") return clampPeriodicCycleDays(cycleValue * 7);
  if (cycleUnit === "month") return clampPeriodicCycleDays(cycleValue * 30);
  return clampPeriodicCycleDays(cycleValue);
}

function clampPeriodicCycleDays(value) {
  return Math.min(30, Math.max(1, Math.floor(Number(value || 1))));
}

function parsePeriodicCompositeTasks(source, cycleDays, weekdayAssignments, validCompositeIds) {
  const rawRows = Array.isArray(source.compositeTasks)
    ? source.compositeTasks
    : typeof source.compositeTasks === "string"
      ? safeJsonParse(source.compositeTasks, [])
      : [];
  const byWeek = new Map();
  rawRows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const week = String(row.week || index + 1);
    const compositeTaskId = String(row.compositeTaskId || row.compositeTask || row.taskId || "");
    byWeek.set(week, validCompositeIds.has(compositeTaskId) ? compositeTaskId : "");
  });
  return PERIODIC_DAY_FIELDS.slice(0, cycleDays).map((field, index) => {
    const legacyField = PERIODIC_WEEKDAY_FIELDS[index];
    const legacyCompositeId = legacyField ? String(weekdayAssignments[legacyField.key] || "") : "";
    return {
      week: field.value,
      compositeTaskId: byWeek.has(field.value) ? byWeek.get(field.value) : legacyCompositeId
    };
  });
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function periodicDayLabel(value) {
  return PERIODIC_DAY_FIELDS.find((field) => field.value === String(value))?.label || `第${value}天`;
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
  const repeatWeeks = Math.max(1, Math.floor(Number(source.repeatWeeks ?? source.repeatRounds ?? source.rounds ?? source.repeatCount ?? source.dailyRepeatCount ?? 1)));
  const compositeTasks = parsePeriodicCompositeTasks(source, cycleDays, weekdayAssignments, validCompositeIds);
  const legacyLinkedCompositeIds = PERIODIC_WEEKDAY_FIELDS
    .map((field) => weekdayAssignments[field.key])
    .filter(Boolean);
  const linkedCompositeIds = Array.isArray(source.compositeTaskIds)
    ? source.compositeTaskIds.map((id) => String(id)).filter((id) => validCompositeIds.has(id))
    : [...compositeTasks.map((row) => row.compositeTaskId).filter(Boolean), ...legacyLinkedCompositeIds];
  return {
    ...source,
    id: String(source.id || `periodic-${Date.now()}`),
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

function updateSelectedPeriodicTask(field, value) {
  const tasks = periodicTaskList();
  const selectedTask = selectedPeriodicTask(tasks);
  if (!selectedTask) return;
  const draft = normalizePeriodicTask(selectedTask);
  if (field === "name") {
    draft.name = String(value || "").trim() || "未命名周期性任务";
    draft.taskName = draft.name;
    draft.periodicTaskName = draft.name;
    draft.experimentName = draft.name;
  } else if (field === "cycleDays") {
    draft.cycleDays = clampPeriodicCycleDays(value);
    draft.taskPeriodDays = draft.cycleDays;
    draft.periodDays = draft.cycleDays;
    draft.repeatCycleDays = draft.cycleDays;
    draft.repeatCycleValue = draft.cycleDays;
    draft.repeatCycleUnit = "day";
  } else if (field === "repeatWeeks") {
    draft.repeatWeeks = Math.max(1, Math.floor(Number(value || 1)));
    draft.repeatRounds = draft.repeatWeeks;
    draft.repeatCount = draft.repeatWeeks;
    draft.dailyRepeatCount = draft.repeatWeeks;
  } else if (field.startsWith("dayComposite:")) {
    const index = Number(field.split(":")[1]);
    if (Number.isInteger(index) && draft.compositeTasks[index]) {
      draft.compositeTasks[index] = { ...draft.compositeTasks[index], compositeTaskId: String(value || "") };
    }
  }
  const nextTask = normalizePeriodicTask(draft);
  scenario.missionProfile.periodicTasks = tasks.map((task) => (String(task.id) === String(nextTask.id) ? nextTask : task));
  updatePreviewResultsThroughApiClient();
  render();
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
    const repeatCount = Math.max(1, Number(item.dailyRepeatCount || 1));
    const intervalHours = Math.max(1, Number(item.intervalHours || 1));
    const basicTask = findBasicMissionByName(item.basicTaskName);
    const durationMinutes = Number(basicTask?.taskDurationMinutes || item.taskDurationMinutes || scenario.basicMission.taskDurationMinutes || 180);
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
  });
}

function renderCompositeTimelineChart(rows) {
  if (!rows.length) {
    return `<div class="alert warn">暂无时序数据</div>`;
  }
  const tooLong = rows.some((row) => row.totalEndMinutes > 30 * 60);
  const groupedRows = Array.from(rows.reduce((acc, row) => {
    const key = row.basicTaskName || "未命名任务";
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
  const selectedIndex = selectedState.componentIndex ?? clampEquipmentComponentIndex(selectedEquipmentComponentIndex);
  const selected = scenario.components[selectedIndex] || {};
  const isFailurePage = page.name.includes("故障");
  return `
    <div class="section-head section-context">
      <span>${isFailurePage ? "故障属性 / 数量 / N中取K参数 / RMS指标" : "组成树 / 组成属性"}</span>
    </div>
    <div class="organization-layout equipment-layout">
      <aside class="tree-container">
        <div class="tree-toolbar">
          <h4>装备组成树</h4>
          <div class="equipment-toolbar">
            <button type="button" class="btn-primary" data-equipment-add-node>新增节点</button>
            <button type="button" class="btn-danger" data-equipment-delete-node disabled>删除</button>
          </div>
        </div>
        ${renderCollapsibleTree(buildEquipmentTreeNodes())}
      </aside>
      <section class="detail-panel">
        <div class="detail-card">
          <div class="section-head">
            <h3>${selectedState.kind === "aircraft-list" ? "飞机列表属性" : selectedState.kind === "aircraft" ? "飞机属性" : isFailurePage ? "故障属性" : "组成属性"}</h3>
            <span>${htmlEscape(selectedState.kind === "aircraft-list" ? `${wholeMachineModels().length} 类飞机` : selectedState.kind === "aircraft" ? selectedState.aircraftModel : selected.name || "")}</span>
          </div>
          <div class="form-table-grid">
            ${selectedState.kind === "aircraft-list" ? renderEquipmentAircraftListFields() : selectedState.kind === "aircraft" ? renderEquipmentAircraftFields(selectedState.aircraftModel) : isFailurePage ? renderEquipmentFailureFields(selectedIndex) : renderEquipmentCompositionFields(selectedIndex)}
          </div>
        </div>
        ${isFailurePage && selectedState.kind === "component" ? renderEquipmentFailureRmsFields(selected, selectedIndex) : ""}
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
  if (Number.isFinite(mutation.selectedEquipmentComponentIndex)) {
    selectedEquipmentComponentIndex = mutation.selectedEquipmentComponentIndex;
  }
  selectedEquipmentNodeKey = mutation.selectedEquipmentNodeKey || selectedEquipmentNodeKey;
  updatePreviewResultsThroughApiClient();
}

function renderEquipmentCompositionFields(selectedIndex) {
  return `
    ${field("组件名称", `components.${selectedIndex}.name`)}
    ${field("父节点", `components.${selectedIndex}.parentId`)}
    ${field("所属飞机", `components.${selectedIndex}.aircraftModel`)}
    ${field("数量", `components.${selectedIndex}.quantity`, "number", { min: "1", step: "1" })}
    ${equipmentLruRadioGroup(selectedIndex)}
    ${equipmentKOutOfNInput(selectedIndex)}
  `;
}

function equipmentLruRadioGroup(selectedIndex) {
  const path = `components.${selectedIndex}.productType`;
  const value = ["LRU", "SRU"].includes(getPath(scenario, path)) ? getPath(scenario, path) : "";
  const name = `equipment-product-type-${selectedIndex}`;
  return `
    <label>组件属性
      <span class="inline-radio-group">
        <label><input data-path="${path}" type="radio" name="${name}" value="LRU" ${value === "LRU" ? "checked" : ""}>LRU</label>
        <label><input data-path="${path}" type="radio" name="${name}" value="SRU" ${value === "SRU" ? "checked" : ""}>SRU</label>
        <label><input data-path="${path}" type="radio" name="${name}" value="" ${value === "" ? "checked" : ""}>空值</label>
      </span>
    </label>
  `;
}

function equipmentKOutOfNInput(selectedIndex) {
  const component = scenario.components[selectedIndex] || {};
  const quantity = Math.max(0, Math.trunc(Number(component.quantity) || 0));
  const value = quantity > 1 ? clamp(Math.trunc(Number(component.kOutOfN?.k) || 1), 1, quantity) : 0;
  return `<label>N中取K<input data-equipment-k-out-of-n-index="${selectedIndex}" type="number" min="1" max="${htmlEscape(quantity)}" step="1" value="${htmlEscape(value)}" ${quantity > 1 ? "" : "disabled"}></label>`;
}

function renderEquipmentAircraftFields(aircraftModel) {
  return `
    <label>飞机型号<input readonly value="${htmlEscape(aircraftModel)}"></label>
    <label>节点类型<input readonly value="整机级"></label>
    <label>数量<input readonly value="${htmlEscape(aircraftModel === scenario.equipment.model ? scenario.equipment.quantity : "整机级")}"></label>
    <label>新增规则<input readonly value="选中飞机列表新增飞机，选中飞机新增分系统，选中分系统新增子系统"></label>
  `;
}

function renderEquipmentAircraftListFields() {
  return `
    <label>节点名称<input readonly value="飞机列表"></label>
    <label>节点类型<input readonly value="飞机集合"></label>
    <label>飞机数量<input readonly value="${htmlEscape(wholeMachineModels().length)}"></label>
    <label>新增规则<input readonly value="选中飞机列表新增飞机，选中飞机新增分系统，选中分系统新增子系统"></label>
  `;
}

function renderEquipmentFailureFields(selectedIndex) {
  const component = scenario.components[selectedIndex] || {};
  const failureDistribution = component.failureDistribution || {};
  const repairDistribution = component.repairDistribution || { distributionType: "正态分布" };
  const distributionOptions = [
    { value: "指数分布", label: "指数分布" },
    { value: "威布尔分布", label: "威布尔分布" }
  ];
  const repairDistributionOptions = [
    { value: "正态分布", label: "正态分布" },
    { value: "均匀分布", label: "均匀分布" },
    { value: "三角分布", label: "三角分布" }
  ];
  return `
    ${renderEquipmentCompositionFields(selectedIndex)}
    ${field("MTBF", `components.${selectedIndex}.mtbfHours`, "number", { min: "0", step: "0.1" })}
    <label>分布类型${valueSelect(`components.${selectedIndex}.failureDistribution.distributionType`, distributionOptions)}</label>
    ${failureDistribution.distributionType === "威布尔分布" ? `
      ${field("形状参数(k)", `components.${selectedIndex}.failureDistribution.shapeK`, "number", { min: "0", step: "0.01" })}
      ${field("尺度参数(λ)", `components.${selectedIndex}.failureDistribution.scaleLambda`, "number", { min: "0", step: "0.01" })}
    ` : ""}
    ${field("平均修复时间（min）", `components.${selectedIndex}.meanRepairTimeMinutes`, "number", { min: "0", step: "1" })}
    <label>修复时间分布${valueSelect(`components.${selectedIndex}.repairDistribution.distributionType`, repairDistributionOptions)}</label>
    ${renderRepairDistributionParameters(selectedIndex, repairDistribution.distributionType)}
  `;
}

function renderRepairDistributionParameters(selectedIndex, distributionType) {
  if (distributionType === "均匀分布") {
    return `
      ${field("最小值", `components.${selectedIndex}.repairDistribution.min`, "number", { min: "0", step: "0.1" })}
      ${field("最大值", `components.${selectedIndex}.repairDistribution.max`, "number", { min: "0", step: "0.1" })}
    `;
  }
  if (distributionType === "三角分布") {
    return `
      ${field("最小值", `components.${selectedIndex}.repairDistribution.min`, "number", { min: "0", step: "0.1" })}
      ${field("最大值", `components.${selectedIndex}.repairDistribution.max`, "number", { min: "0", step: "0.1" })}
      ${field("模数", `components.${selectedIndex}.repairDistribution.mode`, "number", { min: "0", step: "0.1" })}
    `;
  }
  return `
    ${field("均值", `components.${selectedIndex}.repairDistribution.mean`, "number", { min: "0", step: "0.1" })}
    ${field("方差", `components.${selectedIndex}.repairDistribution.variance`, "number", { min: "0", step: "0.1" })}
  `;
}

function renderEquipmentFailureRmsFields(selected, selectedIndex) {
  return `
    <div class="detail-card">
      <div class="section-head">
        <h3>RMS指标</h3>
        <span>${htmlEscape(selected.name || "")}</span>
      </div>
      <div class="form-table-grid">
        ${field("可靠度 R(t)", `components.${selectedIndex}.rms.reliability`, "number")}
        ${field("维修度 M(t)", `components.${selectedIndex}.rms.maintainability`, "number")}
        ${field("保障性 S(t)", `components.${selectedIndex}.rms.supportability`, "number")}
        ${field("平均修复时间 MTTR(h)", `components.${selectedIndex}.rms.mttrHours`, "number")}
        ${field("平均保障延迟 MLDT(h)", `components.${selectedIndex}.rms.mldtHours`, "number")}
        ${field("固有可用度 Ai", `components.${selectedIndex}.rms.availability`, "number")}
      </div>
    </div>
  `;
}

function renderReliabilityBlockDiagram() {
  const nodes = scenario.reliabilityBlockDiagram.nodes;
  return `
    <div class="section-head">
      <h3>装备可靠性框图</h3>
      <span>串联 / 并联 / 备用 / k-out-of-n</span>
    </div>
    <div class="rbd-canvas">
      ${nodes.map((node, index) => `
        <div class="rbd-node ${node.type}" style="grid-column:${index === 0 ? "1 / -1" : "auto"}">
          <strong>${node.name}</strong>
          <span>${node.connectionType}</span>
          <small>失效率 ${node.failureRate} / MTBF ${node.mtbfHours}h</small>
        </div>
      `).join("")}
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>节点</th><th>节点类型</th><th>连接关系</th><th>节点可靠度</th><th>失效率</th><th>MTBF</th><th>k-out-of-n</th></tr></thead>
        <tbody>${nodes.map((node) => {
          const component = scenario.components.find((item) => item.id === node.id);
          return `<tr><td>${node.name}</td><td>${node.type}</td><td>${node.connectionType}</td><td>${component?.rms?.reliability ?? "-"}</td><td>${node.failureRate}</td><td>${node.mtbfHours}h</td><td>${component?.kOutOfN?.enabled ? `${component.kOutOfN.k}/${component.kOutOfN.n}` : "-"}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>起点</th><th>终点</th><th>串联/并联/备用/k-out-of-n</th><th>权重</th></tr></thead>
        <tbody>${scenario.reliabilityBlockDiagram.edges.map((edge) => `<tr><td>${edge.from}</td><td>${edge.to}</td><td>${edge.type}</td><td>${edge.weight}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
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
  const orgTree = supportOrganizationTree();
  if (!orgTree.length) {
    return importedDataEmptyState("保障组织");
  }
  const selectedSupportOrgNode = findSupportOrgTreeNode(selectedSupportOrgNodeId, orgTree) || orgTree[0];
  const selectedIsLeaf = !(selectedSupportOrgNode?.children || []).length;
  const visibleResourceRows = buildSupportResourceRows(activeResourceType, selectedSupportOrgNode).filter((row) => !supportResourceDeletedKeySet().has(row.key));
  const allResourceRowsSelected = visibleResourceRows.length > 0 && visibleResourceRows.every((row) => selectedSupportResourceKeys.has(row.key));
  const selectedSupportOrgParentName = findSupportOrgParentName(selectedSupportOrgNode?.id, orgTree) || "无";
  return `
    <div class="ship-front-workbench">
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>保障组织结构树</h4>
            ${activeTab === "保障组织结构建模" ? `<button type="button" class="btn-primary" data-support-org-add-node disabled>新增节点</button>` : `<span class="muted">只读组织树</span>`}
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
                <label>组织名称<input value="${htmlEscape(selectedSupportOrgNode?.name || "")}" readonly></label>
                <label>上级组织<input value="${htmlEscape(selectedSupportOrgParentName)}" readonly></label>
                <label>组织描述<input value="${htmlEscape(selectedSupportOrgNode?.description || "承担机务、维修、备件和设备保障资源调配")}" readonly></label>
              </div>
            ` : `
              <div class="toolbar-row">
                <button type="button" class="btn-primary" ${selectedIsLeaf ? "" : "disabled"}>新增</button>
                <button type="button" class="btn-danger" data-support-resource-batch-delete>批量删除</button>
                <input value="" placeholder="请输入关键词进行搜索">
                <span class="badge">${selectedIsLeaf ? "叶子节点可编辑" : "根节点汇总显示"}</span>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th><input type="checkbox" data-support-resource-select-all="${htmlEscape(activeResourceType)}" ${allResourceRowsSelected ? "checked" : ""}></th><th>序号</th><th>组织节点</th>${activeResourceType === "保障人员" ? "" : "<th>名称</th>"}<th>${activeResourceType === "保障人员" ? "专业" : "型号"}</th><th>数量</th><th>适用机型</th><th>操作</th></tr></thead>
                  <tbody>${visibleResourceRows.map((row, index) => `
                    <tr><td><input type="checkbox" data-support-resource-select="${htmlEscape(row.key)}" ${selectedSupportResourceKeys.has(row.key) ? "checked" : ""}></td><td>${index + 1}</td><td>${row.scope}</td>${activeResourceType === "保障人员" ? "" : `<td>${supportResourceInput(row, "name", "text", !selectedIsLeaf)}</td>`}<td>${supportResourceInput(row, "model", "text", !selectedIsLeaf)}</td><td>${supportResourceInput(row, "quantity", "number", !selectedIsLeaf)}</td><td>${aircraftMultiSelect(row.key, row.aircraft, !selectedIsLeaf)}</td><td><button type="button" class="inline-action" data-support-resource-edit="${htmlEscape(row.key)}" ${selectedIsLeaf ? "" : "disabled"}>编辑</button></td></tr>
                  `).join("") || `<tr><td colspan="${activeResourceType === "保障人员" ? "7" : "8"}">暂无资源</td></tr>`}</tbody>
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
    children: depth >= 1 ? [] : (node.children || []).map((child) => orgTreeNode(child, depth + 1))
  };
}

function buildSupportResourceRows(activeResourceType, selectedOrgNode) {
  const orgTree = supportOrganizationTree();
  const leafNodes = flattenSupportOrgTreeNodes(selectedOrgNode ? [selectedOrgNode] : orgTree).filter((node) => !(node.children || []).length);
  const orgNodes = (selectedOrgNode?.children || []).length ? leafNodes : [selectedOrgNode].filter(Boolean);
  const supportNodes = scenario.supportNodes || [];
  const overrides = supportResourceOverrides();
  return orgNodes.flatMap((orgNode, orgIndex) => {
    const matchingNodes = supportNodes.filter((node) => node.organizationNodeId === orgNode.id || node.id === orgNode.id || node.name === orgNode.name);
    const scopedSupportNodes = matchingNodes.length ? matchingNodes : supportNodes;
    const rows = scopedSupportNodes.flatMap((node, nodeIndex) => {
      const baseKey = `${orgNode.id || orgIndex}:${node.id || nodeIndex}`;
      return [
        Number.isFinite(Number(node.personnelCapacity))
          ? { key: `${baseKey}:personnel`, scope: orgNode.name, type: "保障人员", model: "人员容量", quantity: Number(node.personnelCapacity || 0), aircraft: wholeMachineModels() }
          : null,
        Number.isFinite(Number(node.equipmentCapacity))
          ? { key: `${baseKey}:equipment`, scope: orgNode.name, type: "保障设备", name: node.name || "保障设备", model: node.nodeType || "保障设备", quantity: Number(node.equipmentCapacity || 0), aircraft: wholeMachineModels() }
          : null,
        ...Object.entries(node.inventory || {}).map(([spareType, quantity], index) => ({
          key: `${baseKey}:spare:${index}:${spareType}`,
          scope: orgNode.name,
          type: "备件",
          name: spareType,
          model: spareType,
          quantity,
          aircraft: wholeMachineModels()
        }))
      ].filter(Boolean);
    });
    const mergedRows = rows.map((row) => ({ ...row, ...(overrides[row.key] || {}) }));
    return activeResourceType ? mergedRows.filter((row) => row.type === activeResourceType) : mergedRows;
  });
}

function supportResourceOverrides() {
  if (!scenario.supportResourceOverrides || typeof scenario.supportResourceOverrides !== "object") {
    scenario.supportResourceOverrides = {};
  }
  return scenario.supportResourceOverrides;
}

function supportResourceDeletedKeySet() {
  if (!Array.isArray(scenario.deletedSupportResourceKeys)) {
    scenario.deletedSupportResourceKeys = Array.from(deletedSupportResourceKeys);
  }
  return new Set(scenario.deletedSupportResourceKeys);
}

function supportResourceInput(row, fieldName, type = "text", disabled = false) {
  return `<input data-support-resource-key="${htmlEscape(row.key)}" data-support-resource-field="${htmlEscape(fieldName)}" type="${type}" value="${htmlEscape(row[fieldName] ?? "")}" ${disabled ? "disabled" : ""}>`;
}

function aircraftMultiSelect(key, values, disabled = false) {
  const selected = new Set(Array.isArray(values) ? values : [values].filter(Boolean));
  return `
    <select multiple data-support-resource-aircraft="${htmlEscape(key)}" ${disabled ? "disabled" : ""}>
      ${wholeMachineModels().map((model) => `<option value="${htmlEscape(model)}" ${selected.has(model) ? "selected" : ""}>${htmlEscape(model)}</option>`).join("")}
    </select>
  `;
}

function updateSupportResourceOverride(key, fieldName, value) {
  if (!key || !fieldName) return;
  const overrides = supportResourceOverrides();
  const nextValue = fieldName === "quantity" ? Math.max(0, Number(value || 0)) : value;
  overrides[key] = { ...(overrides[key] || {}), [fieldName]: nextValue };
  deletedSupportResourceKeys = supportResourceDeletedKeySet();
  updatePreviewResultsThroughApiClient();
}

function activateSupportResourceEdit(key) {
  if (!key) return;
  selectedSupportResourceKeys = new Set([key]);
  supportResourceOverrides()[key] = { ...(supportResourceOverrides()[key] || {}) };
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
  const nextDeleted = supportResourceDeletedKeySet();
  for (const key of selectedSupportResourceKeys) nextDeleted.add(key);
  scenario.deletedSupportResourceKeys = Array.from(nextDeleted);
  deletedSupportResourceKeys = nextDeleted;
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

function findSupportActivityForPage(page) {
  const activities = scenario.supportActivities || [];
  if (page.name.includes("后勤")) return findLogisticsSupportActivity();
  if (page.name.includes("预防性")) {
    return activities.find((activity) => activity.activityType === "预防性维修") || null;
  }
  if (page.name.includes("修复性")) {
    return activities.find((activity) => activity.activityType === "修复性维修") || null;
  }
  if (page.name.includes("使用")) {
    return activities.find((activity) => activity.planType === "直接准备方案")
      || activities.find((activity) => activity.activityType === "飞行前保障")
      || null;
  }
  return activities[0] || null;
}

function supportActivityJobKey(tabKey, index) {
  return `${tabKey}:${index}`;
}

function findSupportActivityByJobTabKey(tabKey) {
  if (tabKey === "ops_plan") {
    return (scenario.supportActivities || []).find((activity) => activity.planType === "直接准备方案")
      || (scenario.supportActivities || []).find((activity) => activity.activityType === "飞行前保障")
      || scenario.supportActivities?.[0]
      || null;
  }
  if (tabKey === "prev_repair") {
    return (scenario.supportActivities || []).find((activity) => activity.activityType === "预防性维修") || scenario.supportActivities?.[0] || null;
  }
  if (tabKey === "corr_repair") {
    return (scenario.supportActivities || []).find((activity) => activity.activityType === "修复性维修") || scenario.supportActivities?.[0] || null;
  }
  return null;
}

function toggleSupportActivityJobSelection(key, checked) {
  const next = new Set(selectedSupportActivityJobKeys);
  if (checked) next.add(key);
  else next.delete(key);
  selectedSupportActivityJobKeys = next;
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
  selectedSupportActivityJobKeys = new Set(Array.from(selectedSupportActivityJobKeys).filter((key) => !String(key).startsWith(`${tabKey}:`)));
  updatePreviewResultsThroughApiClient();
}

function addSupportActivityJob(tabKey) {
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity) return;
  const jobs = supportActivityJobs(activity).slice();
  jobs.push({
    activityCode: `BA-${String(jobs.length + 1).padStart(3, "0")}`,
    workName: `新增基本保障活动${jobs.length + 1}`,
    predecessors: [],
    durationMinutes: 30,
    personnel: "机务人员,1",
    equipment: "检测仪,1",
    spare: ""
  });
  activity.jobs = jobs;
  updatePreviewResultsThroughApiClient();
}

function selectSupportActivityJobForEdit(encodedJob) {
  const [tabKey, rawIndex] = String(encodedJob || "").split("-");
  const index = Number(rawIndex);
  if (!tabKey || !Number.isInteger(index)) return;
  selectedSupportActivityJobKeys = new Set([supportActivityJobKey(tabKey, index)]);
}

function updateSupportActivityJobPredecessors(encodedJob, predecessors) {
  const [tabKey, rawIndex] = String(encodedJob || "").split(":");
  const index = Number(rawIndex);
  const activity = findSupportActivityByJobTabKey(tabKey);
  if (!activity || !Number.isInteger(index)) return;
  const jobs = supportActivityJobs(activity).slice();
  if (!jobs[index]) return;
  jobs[index] = { ...jobs[index], predecessors };
  activity.jobs = jobs;
  updatePreviewResultsThroughApiClient();
}

function renumberSupportActivityJobSelections(tabKey) {
  selectedSupportActivityJobKeys = new Set(Array.from(selectedSupportActivityJobKeys).filter((key) => !String(key).startsWith(`${tabKey}:`)));
}

function describeDurationProfile(profile, fallbackMinutes) {
  if (!profile || typeof profile !== "object") return `${Number(fallbackMinutes || 0)}min 固定值`;
  if (profile.distributionType === "正态分布") return `正态分布 mean=${profile.mean ?? fallbackMinutes}, std=${profile.stdDev ?? "-"}`;
  if (profile.distributionType === "均匀分布") return `均匀分布 ${profile.min ?? "-"}-${profile.max ?? "-"}min`;
  if (profile.distributionType === "三角分布") return `三角分布 ${profile.min ?? "-"} / ${profile.mode ?? "-"} / ${profile.max ?? "-"}min`;
  if (profile.distributionType === "对数正态分布") return `对数正态分布 ${profile.params || ""}`.trim();
  return `${profile.distributionType || "固定值"} ${profile.value ?? fallbackMinutes ?? ""}min`.trim();
}

function renderSupportActivityJobRows(activity, tabKey) {
  const jobs = supportActivityJobs(activity);
  return supportActivityJobs(activity).map((job, index) => `
    <tr class="${selectedSupportActivityJobKeys.has(supportActivityJobKey(tabKey, index)) ? "selected-table-row" : ""}">
      <td><input type="checkbox" data-support-activity-job-select="${htmlEscape(supportActivityJobKey(tabKey, index))}" ${selectedSupportActivityJobKeys.has(supportActivityJobKey(tabKey, index)) ? "checked" : ""}></td>
      <td>${index + 1}</td>
      <td>${htmlEscape(job.activityCode || `BA-${String(index + 1).padStart(3, "0")}`)}</td>
      <td>${htmlEscape(job.workName || "-")}</td>
      <td>${predecessorMultiSelect(jobs, job, index, tabKey)}</td>
      <td>${Number(job.durationMinutes || 0)}</td>
      <td><button type="button" class="inline-action" data-support-activity-job="${htmlEscape(tabKey)}-${index}">编辑</button><button type="button" class="btn-danger" data-support-activity-job-delete="${htmlEscape(supportActivityJobKey(tabKey, index))}">删除</button></td>
    </tr>
  `).join("");
}

function predecessorMultiSelect(jobs, job, index, tabKey) {
  const selected = new Set(Array.isArray(job.predecessors) ? job.predecessors : []);
  return `
    <select multiple data-support-activity-predecessors="${htmlEscape(supportActivityJobKey(tabKey, index))}">
      ${jobs.map((candidate, candidateIndex) => {
        if (candidateIndex === index) return "";
        const value = candidate.activityCode || candidate.workName || `BA-${candidateIndex + 1}`;
        const label = candidate.workName || value;
        return `<option value="${htmlEscape(value)}" ${selected.has(value) ? "selected" : ""}>${htmlEscape(label)}</option>`;
      }).join("")}
    </select>
  `;
}

function renderSupportActivityJobTable(activity, tabKey) {
  const jobs = supportActivityJobs(activity);
  const selectedCount = jobs.filter((_, index) => selectedSupportActivityJobKeys.has(supportActivityJobKey(tabKey, index))).length;
  const allSelected = jobs.length > 0 && selectedCount === jobs.length;
  const body = jobs.length
    ? renderSupportActivityJobRows(activity, tabKey)
    : `<tr><td colspan="7" class="muted">暂无工作项目</td></tr>`;
  return `
    <h4>工作项目清单</h4>
    <div class="toolbar-row"><button type="button" class="btn-primary" data-support-activity-job-add="${htmlEscape(tabKey)}">新增基本保障活动</button><button type="button" class="btn-danger" data-support-activity-job-batch-delete="${htmlEscape(tabKey)}">批量删除</button></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th><input type="checkbox" data-support-activity-job-select-all="${htmlEscape(tabKey)}" ${allSelected ? "checked" : ""}></th><th>序号</th><th>基本保障活动编号</th><th>作业项</th><th>紧前作业</th><th>工期(min)</th><th>操作</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderBasicActivityLibrary() {
  const rows = basicActivityLibraryRows();
  const allSelected = rows.length > 0 && rows.every((row) => selectedBasicActivityKeys.has(row.key));
  return `
    <div class="detail-card activity-editor-card">
      <div class="section-head">
        <h3>基本保障活动基础库</h3>
        <span>展示基本保障活动清单，编辑后通过 Project draft 保存</span>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-basic-activity-add>新增</button>
        <button type="button" class="btn-danger" data-basic-activity-batch-delete>批量删除</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" data-basic-activity-select-all ${allSelected ? "checked" : ""}></th>
              <th>序号</th><th>类型</th><th>基本保障活动名称</th><th>基本保障活动编号</th><th>适用对象</th><th>工期(min)</th>
              <th>保障人员要求</th><th>保障设备要求</th><th>弹药需求</th><th>备件需求</th><th>操作</th>
            </tr>
          </thead>
          <tbody>${rows.map((row, index) => `
            <tr>
              <td><input type="checkbox" data-basic-activity-select="${htmlEscape(row.key)}" ${selectedBasicActivityKeys.has(row.key) ? "checked" : ""}></td>
              <td>${index + 1}</td>
              <td>${htmlEscape(row.type || "-")}</td>
              <td>${htmlEscape(row.workName || "-")}</td>
              <td>${htmlEscape(row.activityCode || "-")}</td>
              <td>${htmlEscape(row.scope || "-")}</td>
              <td>${Number(row.durationMinutes || 0)}</td>
              <td>${htmlEscape(row.personnel || "-")}</td>
              <td>${htmlEscape(row.equipment || "-")}</td>
              <td>${htmlEscape(row.ammunition || "-")}</td>
              <td>${htmlEscape(row.spare || "-")}</td>
              <td><button type="button" class="inline-action" data-basic-activity-edit="${htmlEscape(row.key)}">编辑</button><button type="button" class="btn-danger" data-basic-activity-delete="${htmlEscape(row.key)}">删除</button></td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function basicActivityLibraryRows() {
  return (scenario.supportActivities || []).flatMap((activity, activityIndex) =>
    supportActivityJobs(activity).map((job, jobIndex) => ({
      key: `${activityIndex}:${jobIndex}`,
      type: activity.activityType === "修复性维修" || activity.activityType === "预防性维修" ? "维修保障" : "使用保障",
      activityCode: job.activityCode,
      workName: job.workName,
      scope: activity.activityType === "修复性维修" ? "航电系统" : scenario.equipment.model,
      durationMinutes: job.durationMinutes,
      personnel: job.personnel,
      equipment: job.equipment,
      ammunition: job.ammunition,
      spare: job.spare
    }))
  );
}

function addBasicActivityLibraryJob() {
  const activity = (scenario.supportActivities || [])[0];
  if (!activity) return;
  const jobs = supportActivityJobs(activity).slice();
  jobs.push({ activityCode: `BA-${String(jobs.length + 1).padStart(3, "0")}`, workName: `新增保障活动${jobs.length + 1}`, predecessors: [], durationMinutes: 30, personnel: "机务人员,1", equipment: "检测仪,1" });
  activity.jobs = jobs;
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
  selectedBasicActivityKeys = checked ? new Set(basicActivityLibraryRows().map((row) => row.key)) : new Set();
}

function renderOperationsSupportActivity(activePlan, activity) {
  return `
    <div class="detail-card activity-editor-card">
      <div class="section-head">
        <h3>使用保障活动编辑</h3>
        <span>${activePlan.path.map((item) => htmlEscape(item)).join(" / ")}</span>
      </div>
      <div class="form-table-grid">
        <label>最大工作时间参考(min)<input type="number" value="${Number(activity.maxWorkTimeRefMinutes || activity.durationHours * 60 || 0)}" readonly></label>
      </div>
      ${renderSupportActivityJobTable(activity, "ops_plan")}
    </div>
  `;
}

function renderPreventiveMaintenanceActivity(activePlan, activity) {
  const activityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(activity));
  return `
    <div class="detail-card activity-editor-card">
      <div class="section-head">
        <h3>预防性维修活动编辑</h3>
        <span>${activePlan.path.map((item) => htmlEscape(item)).join(" / ")}</span>
      </div>
      <div class="form-table-grid">
        ${field("方案名称", `supportActivities.${activityIndex}.activityName`)}
        ${field("计划停机小时", `supportActivities.${activityIndex}.plannedDowntimeHours`, "number", { min: "0", step: "0.1" })}
        <label>启动日历时间<input type="checkbox" data-path="supportActivities.${activityIndex}.useCalendarRule" ${activity.useCalendarRule ? "checked" : ""}></label>
        ${field("使用日历日间隔规则", `supportActivities.${activityIndex}.calendarDayInterval`, "number", { min: "0", step: "1" })}
        ${field("日历日间隔上下浮动比例", `supportActivities.${activityIndex}.calendarDayFloatRatio`, "number", { min: "0", max: "1", step: "0.01" })}
        <label>使用飞行小时规则<input type="checkbox" data-path="supportActivities.${activityIndex}.useFlightHourRule" ${activity.useFlightHourRule ? "checked" : ""}></label>
        ${field("飞行小时间隔", `supportActivities.${activityIndex}.runHourInterval`, "number", { min: "0", step: "1" })}
        ${field("飞行小时上下浮动比例", `supportActivities.${activityIndex}.runHourFloatRatio`, "number", { min: "0", max: "1", step: "0.01" })}
        <label>启动起落次数<input type="checkbox" data-path="supportActivities.${activityIndex}.useTakeoffLandingRule" ${activity.useTakeoffLandingRule ? "checked" : ""}></label>
        ${field("起落次数间隔", `supportActivities.${activityIndex}.takeoffLandingInterval`, "number", { min: "0", step: "1" })}
        ${field("起落次数间隔上下浮动比例", `supportActivities.${activityIndex}.takeoffLandingFloatRatio`, "number", { min: "0", max: "1", step: "0.01" })}
      </div>
      ${renderSupportActivityJobTable(activity, "prev_repair")}
    </div>
  `;
}

function renderEquipmentConfigTree() {
  const equipmentModels = wholeMachineModels();
  return `
    <aside class="tree-container">
      <div class="tree-toolbar"><h4>装备构型树</h4><span class="muted">只读参考</span></div>
      ${renderCollapsibleTree(equipmentModels.map((model, index) => ({
        id: `equipment-config:${model}`,
        label: model,
        selected: index === 0,
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
          children: buildChildren(component.id, nextVisited)
        };
      });
  };
  return buildChildren(parentId);
}

function correctiveReferenceComponent() {
  return (scenario.components || []).find((component) => component.specialRepairProfile) || (scenario.components || [])[0] || {};
}

function renderCorrectiveMaintenanceActivity(activity) {
  const activityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(activity));
  const repairType = activity.repairType || "原位维修";
  return `
    <div class="organization-layout">
      ${renderEquipmentConfigTree()}
      <section class="detail-panel">
        <div class="detail-card activity-editor-card">
          <div class="section-head">
            <h3>修复性维修活动编辑</h3>
            <span>${htmlEscape(activity.activityName || "修复性维修方案")}</span>
          </div>
          <div class="form-table-grid">
            ${field("最大修复时间(min)", `supportActivities.${activityIndex}.maxRepairTimeMinutes`, "number", { min: "0", step: "1" })}
            <label>维修类型
              <span class="inline-radio-group">
                <label><input data-path="supportActivities.${activityIndex}.repairType" type="radio" name="corrective-repair-type" value="原位维修" ${repairType === "原位维修" ? "checked" : ""}>原位维修</label>
                <label><input data-path="supportActivities.${activityIndex}.repairType" type="radio" name="corrective-repair-type" value="换件维修" ${repairType === "换件维修" ? "checked" : ""}>换件维修</label>
              </span>
            </label>
          </div>
          ${renderSupportActivityJobTable(activity, "corr_repair")}
            </div>
      </section>
    </div>
  `;
}

function renderLogisticsSupportActivity(activePlan, activity) {
  const activityIndex = Math.max(0, (scenario.supportActivities || []).indexOf(activity));
  const transportStrategies = Array.isArray(activity.transportStrategies) ? activity.transportStrategies : [];
  const supportNodeOptions = (scenario.supportNodes || []).map((node) => ({ value: node.id, label: node.name }));
  const spareTypeOptions = spareModelingNames().map((name) => ({ value: name, label: name }));
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
      <div class="section-head">
        <h3>\u540e\u52e4\u4fdd\u969c\u8fd0\u8f93\u7b56\u7565\u914d\u7f6e</h3>
        <button type="button" class="btn-primary" data-logistics-transport-add>\u65b0\u589e\u8fd0\u8f93\u7b56\u7565</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u7b56\u7565\u65b9\u5411</th><th>\u5907\u4ef6\u79cd\u7c7b</th><th>\u89e6\u53d1\u65b9\u5f0f</th><th>\u89e6\u53d1\u53c2\u6570</th><th>\u8fd0\u8f93\u8d77\u70b9</th><th>\u8fd0\u8f93\u7ec8\u70b9</th><th>\u8fd0\u8f93\u65f6\u95f4(h)</th><th>\u64cd\u4f5c</th></tr></thead>
          <tbody>${transportStrategies.map((row, index) => {
            const basePath = `supportActivities.${activityIndex}.transportStrategies.${index}`;
            const triggerControl = row.triggerMode === "\u5468\u671f\u6027\u8c03\u8fd0"
              ? `<label class="inline-field">\u8c03\u8fd0\u5468\u671f(h)${valueInput(`${basePath}.transferCycleHours`, "number", { min: "1", step: "1" })}</label>`
              : `<label class="inline-field">\u4e34\u754c\u5e93\u5b58\u6570${valueInput(`${basePath}.criticalInventory`, "number", { min: "0", step: "1" })}</label>`;
            return `
              <tr>
                <td>${valueSelect(`${basePath}.direction`, directionOptions)}</td>
                <td>${valueSelect(`${basePath}.spareType`, spareTypeOptions)}</td>
                <td>${valueSelect(`${basePath}.triggerMode`, triggerModeOptions)}</td>
                <td>${triggerControl}</td>
                <td>${valueSelect(`${basePath}.from`, supportNodeOptions)}</td>
                <td>${valueSelect(`${basePath}.to`, supportNodeOptions)}</td>
                <td>${valueInput(`${basePath}.transportTimeHours`, "number", { min: "0", step: "0.1" })}</td>
                <td><button type="button" class="inline-action" data-logistics-transport-edit="${index}" disabled>\u7f16\u8f91</button><button type="button" class="inline-action" data-logistics-transport-delete="${index}">\u5220\u9664</button></td>
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
    || activities.find((item) => item.planType === "后勤保障活动方案");
}

function supportNodeName(id) {
  return scenario.supportNodes.find((node) => node.id === id)?.name || id || "-";
}

function spareModelingNames() {
  return Array.from(new Set(
    (scenario.supportNodes || []).flatMap((node) => Object.keys(node.inventory || {}))
  ));
}

function renderSupportActivityWorkbench(page) {
  const activity = findSupportActivityForPage(page);
  if (!activity && !page.name.includes("基本保障活动")) {
    return importedDataEmptyState("保障活动");
  }
  const activePlan = supportActivityPlanForPage(page, activity);
  if (page.name.includes("基本保障活动")) {
    if (!(scenario.supportActivities || []).length) {
      return importedDataEmptyState("保障活动");
    }
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
  return `
    <div class="ship-front-workbench">
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>${htmlEscape(activePlan.treeTitle)}</h4>
            <div class="equipment-toolbar">
              ${page.name.includes("预防性") ? `<button type="button" class="btn-primary">新增</button>` : ""}
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
  return {
    id: `support-activity:${node.id || node.name}`,
    label: node.name,
    selected: node.name === selectedName,
    children: (node.children || []).map((child) => supportActivityTreeNode(child, selectedName))
  };
}

function renderExperimentPlanList(page) {
  const editFeatureId = page.module === "任务可靠度评估模块"
    ? "mission-reliability-experiment-plan-edit"
    : "spare-planning-experiment-plan-edit";
  const visualFeatureId = getVisualSimulationFeatureId(page.module);
  const monteCarloFeatureId = getMonteCarloExperimentEditFeatureId(page.module);
  const plans = scenario.experiment?.name ? [{
    name: scenario.experiment.name,
    module: page.module,
    scenarioId: scenario.scenarioId,
    steps: scenario.experiment.steps,
    samples: scenario.experiment.samples,
    status: experimentRunStatus
  }] : [];
  return `
    <div class="section-head">
      <h3>方案列表</h3>
      <span>仿真实验方案管理</span>
    </div>
    <div class="toolbar-row">
      <button type="button" class="btn-primary" data-experiment-plan-add disabled>新增</button>
      <button type="button" class="btn-danger" data-experiment-plan-delete disabled>批量删除</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>方案名称</th><th>所属模块</th><th>场景</th><th>步数</th><th>样本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${plans.length ? plans.map((plan) => `
            <tr>
              <td>${htmlEscape(plan.name)}</td>
              <td>${htmlEscape(plan.module)}</td>
              <td>${htmlEscape(plan.scenarioId)}</td>
              <td>${plan.steps}</td>
              <td>${plan.samples}</td>
              <td><span class="badge">${htmlEscape(plan.status)}</span></td>
              <td class="table-action-cell">
                <button type="button" class="inline-action" data-feature-id="${editFeatureId}" data-experiment-plan-edit>编辑</button>
                <button type="button" class="inline-action" data-feature-id="${visualFeatureId}">启动可视化推演</button>
                <button type="button" class="inline-action" data-feature-id="${monteCarloFeatureId}">创建蒙特卡洛实验</button>
                <button type="button" class="btn-danger" data-experiment-plan-delete disabled>删除</button>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="7">${importedDataEmptyState("仿真实验方案")}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderExperimentPlanEditor(page) {
  return `
    <div class="section-head">
      <h3>方案编辑</h3>
      <span>实验方案参数</span>
    </div>
    <div class="form-table-grid">
      ${experimentPlanField("实验名称", "experiment.name")}
      ${experimentPlanField("仿真步数", "experiment.steps", "number")}
      ${experimentPlanField("样本数", "experiment.samples", "number")}
      ${experimentPlanField("随机种子", "experiment.seed", "number")}
      ${experimentPlanField("并行核心数", "experiment.parallelCores", "number")}
      ${experimentPlanField("停止条件", "experiment.stopCondition")}
    </div>
    <div class="plan-editor-actions">
      <button type="button" data-plan-list-link>返回方案列表</button>
      <button type="button" class="btn-primary" data-save-plan>保存方案</button>
      <button type="button" class="btn-secondary" data-run-intent-single ${formalRunSubmitInFlight ? "disabled" : ""}>启动单次正式运行</button>
    </div>
  `;
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

async function saveCurrentProjectThroughApi() {
  return saveCurrentProjectDraftThroughApi();
}

async function handleEnterWorkbench(projectId) {
  await flushPendingProjectDraftAutosave();
  currentProject = demoProjects.find((project) => project.id === projectId) || demoProjects[0];
  if (!currentProject) {
    projectListStatus = "请先创建项目";
    selectedRoute = "projects";
    location.hash = "route=projects";
    return;
  }
  isLoggedIn = true;
  selectedRoute = "workbench";
  selectedFeatureId = DEFAULT_FEATURE_ID;
  isProjectMenuOpen = false;
  location.hash = `feature=${DEFAULT_FEATURE_ID}`;
  projectDraftHydrateStatus = "正在读取 Project draft";
  await hydrateCurrentProjectDraftFromApi();
}

function addDemoProject() {
  const nextIndex = demoProjects.length + 1;
  const project = {
    id: `new-project-${nextIndex}`,
    name: `新增项目${nextIndex}`,
    baseCode: `NB-${String(nextIndex).padStart(2, "0")}`,
    updatedAt: new Date().toISOString().slice(0, 10),
    summary: "新建项目草稿，进入后可维护建模数据。",
    sourceKind: PROJECT_SOURCE.manual_draft
  };
  demoProjects = mergeProjectsById([project, ...demoProjects]);
  currentProject = project;
  projectListStatus = `已添加项目：${project.name}`;
  persistManualDraftProjects();
}

async function createSampleProjectFromPublishedImport(importId = currentPublishedModelingImportId()) {
  try {
    projectListStatus = importId
      ? "正在从已发布导入数据生成示例项目"
      : "正在保存并发布示例导入包";
    const published = await ensurePublishedModelingImportForSampleProject({
      backendApi,
      fixture: MODELING_IMPORT_DEMO_FIXTURE,
      publishedImportId: importId
    });
    const resolvedImportId = published.importId;
    if (published.publishedPackage) {
      modelingImportPublishedPackage = published.publishedPackage;
    }
    projectListStatus = "正在从已发布导入数据生成示例项目";
    const created = await backendApi.createProjectFromModelingImport(resolvedImportId);
    const projectJson = created.project || {};
    const projectId = projectJson.project_id || created.savedProject?.project_id || MODELING_IMPORT_DEMO_FIXTURE.projectId;
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
    savedProject = created.savedProject || null;
    modelingSnapshot = created.modelingSnapshot || null;
    projectListStatus = `已从导入数据生成示例项目：${project.name}；可用于正式后端测试`;
    await hydrateProjectCatalogFromBackend({ forceProjectId: project.id });
    currentProject = demoProjects.find((entry) => entry.id === project.id) || project;
    projectDraftSaveStatus = "已保存";
    projectDraftHydrateStatus = "示例项目来自已发布建模导入包";
    updatePreviewResultsThroughApiClient();
  } catch (err) {
    projectListStatus = `导入示例项目生成失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function hydrateProjectCatalogFromBackend({ forceProjectId = "" } = {}) {
  const focusProjectId = forceProjectId || (currentProject?.id ? String(currentProject.id) : "");
  const localManualProjects = readManualDraftProjectsFromStorage();
  const fallbackProjects = mergeProjectsById(localManualProjects);
  projectListStatus = "正在从后端读取项目列表";
  try {
    const result = await backendApi.listProjects();
    const backendProjects = Array.isArray(result?.projects)
      ? result.projects
        .map((entry) => toProjectFromBackendApiEntry(entry))
        .filter(Boolean)
      : [];
    demoProjects = mergeProjectsById([...backendProjects, ...fallbackProjects]);
    currentProject = demoProjects.find((project) => project.id === focusProjectId) || demoProjects[0];
    if (backendProjects.length) {
      projectListStatus = `已加载 ${backendProjects.length} 个后端项目`;
    } else {
      projectListStatus = "后端未返回项目，使用本地项目清单";
    }
  } catch (err) {
    demoProjects = fallbackProjects;
    currentProject = demoProjects.find((project) => project.id === focusProjectId) || demoProjects[0];
    projectListStatus = `后端项目列表加载失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

function currentPublishedModelingImportId() {
  return modelingImportPublishedPackage?.importId
    || modelingImportPublishedPackage?.import_id
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

function saveProjectEditorDraft() {
  if (!projectEditorDraft) return;
  const saved = {
    ...projectEditorDraft,
    name: projectEditorDraft.name.trim() || "未命名项目",
    baseCode: projectEditorDraft.baseCode.trim() || "NB-00",
    summary: projectEditorDraft.summary.trim() || "项目说明待补充。",
    updatedAt: new Date().toISOString().slice(0, 10)
  };
  demoProjects = demoProjects.map((project) => (project.id === saved.id ? saved : project));
  if (currentProject?.id === saved.id) currentProject = saved;
  persistManualDraftProjects();
  projectEditorDraft = null;
  projectListStatus = `已保存项目：${saved.name}`;
}

function deleteDemoProject(projectId) {
  const removed = demoProjects.find((project) => project.id === projectId);
  demoProjects = demoProjects.filter((project) => project.id !== projectId);
  if (currentProject?.id === projectId) currentProject = demoProjects[0] || null;
  persistManualDraftProjects();
  projectListStatus = removed ? `已删除项目：${removed.name}` : "项目不存在";
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
  return currentProject?.id ? `project-${currentProject.id}` : `project-${scenario.scenarioId}`;
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
    const projectJson = await backendApi.getProject(currentBackendProjectId());
    scenario = cloneScenario(projectJson);
    experimentPlanDraft = cloneScenario(projectJson);
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
  const planProjectJson = buildBackendProjectJson(experimentPlanDraft, currentProject);
  try {
    savedProject = await backendApi.saveProject(projectJson);
    modelingSnapshot = await backendApi.createModelingSnapshot(savedProject.project_id);
    const runIntent = buildRunIntent({
      runType: "single",
      projectJson: savedProject,
      planProjectJson
    });
    experimentPlan = await backendApi.createExperimentPlan(savedProject.project_id, runIntent.experimentPlanConfig);
    backendApiStatus = "实验方案分支已保存";
  } catch (err) {
    savedProject = null;
    modelingSnapshot = null;
    experimentPlan = null;
    backendApiStatus = `实验方案保存失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
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
    message: "请先从已发布建模导入包生成示例项目，再启动正式后端运行；本地草稿需要先通过建模导入发布链路生成示例项目。"
  };
}

async function startSingleRunThroughApi() {
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
  const runType = "single";
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  const planProjectJson = buildBackendProjectJson(experimentPlanDraft, currentProject);
  try {
    const submitted = await submitRunIntent(backendApi, {
      runType,
      projectJson,
      planProjectJson
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
      return;
    }
    lastRunExperimentPlanProjectJson = {
      run_id: backendRun.run_id,
      project_json: submitted.intent.planProjectJson
    };
    rememberLastBackendRun(backendRun.run_id, savedProject.project_id, submitted.intent.planProjectJson);
    await refreshRunResultThroughApi(backendRun.run_id);
    experimentRunStatus = backendRun.status === "succeeded" ? "完成" : backendRun.status;
    backendApiStatus = isRunComplete(backendRun)
      ? "单次正式运行完成"
      : `单次正式运行已提交：${backendRun.run_id || "等待 run_id"} / ${runStatusLabel(backendRun)}`;
  } catch (err) {
    savedProject = null;
    backendRun = null;
    backendRunResult = null;
    backendArtifactManifest = null;
    backendRunChain = null;
    forgetLastBackendRun();
    experimentRunStatus = "后端不可用";
    backendApiStatus = `后端不可用，未创建 run_id：${err && err.message ? err.message : "Backend API 不可用"}`;
  } finally {
    formalRunSubmitInFlight = false;
  }
}

async function startMonteCarloRunThroughApi({ monteCarloExperimentId = selectedMonteCarloExperimentId } = {}) {
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
  const planProjectJson = buildBackendProjectJson(experimentPlanDraft, currentProject);
  try {
    const submitted = await submitRunIntent(backendApi, {
      runType,
      projectJson,
      planProjectJson,
      mcExperimentId: monteCarloExperimentId
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
      syncMonteCarloExperimentRun(monteCarloExperimentId, {
        status: "运行失败",
        progress: Number(backendRun.progress ?? 0),
        runId: backendRun.run_id || "",
        runType,
        artifactId: "",
        artifactManifestId: "",
        projectionArtifactIds: [],
      source: "backend:run-failed"
      });
      return;
    }
    lastRunExperimentPlanProjectJson = {
      run_id: backendRun.run_id,
      project_json: submitted.intent.planProjectJson
    };
    rememberLastBackendRun(backendRun.run_id, savedProject.project_id, submitted.intent.planProjectJson);
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
      return;
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
  } catch (err) {
    savedProject = null;
    backendRun = null;
    backendRunResult = null;
    backendArtifactManifest = null;
    backendRunChain = null;
    forgetLastBackendRun();
    experimentRunStatus = "后端不可用";
    backendApiStatus = `后端不可用，未创建 run_id：${err && err.message ? err.message : "Backend API 不可用"}`;
    syncMonteCarloExperimentRun(monteCarloExperimentId, {
      status: "运行失败",
      progress: 0,
      runType,
      source: "backend:submit-error"
    });
  } finally {
    formalRunSubmitInFlight = false;
    render();
  }
}

async function refreshRunResultThroughApi(runId = backendRun?.run_id) {
  if (!runId) return;
  backendRun = await backendApi.getRunStatus(runId);
  if (!isRunComplete(backendRun)) {
    backendRunResult = null;
    backendArtifactManifest = { artifacts: [] };
    backendRunChain = null;
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
    rmsAllocationResult = {
      ok: false,
      planId: rmsAllocationPlan.planId,
      planVersion: rmsAllocationPlan.planVersion,
      status: "method_not_applicable",
      algorithmVersion: rmsAllocationPlan.algorithmVersion || "rms-engine-1.0.0",
      exposure: { rows: [], warnings: [] },
      nodeResults: [],
      verification: {
        equipmentTarget: {
          reliability: Number(rmsAllocationPlan.targets.reliability.value),
          mttrHours: Number(rmsAllocationPlan.targets.mttrHours),
          mldtHours: Number(rmsAllocationPlan.targets.mldtHours)
        },
        calculated: { reliability: 0, mttrHours: 0, mldtHours: 0 },
        margin: { reliability: 0, mttrHours: 0, mldtHours: 0 },
        status: "method_not_applicable"
      },
      warnings: [{ code: "RMS_METHOD_NOT_APPLICABLE", message: err && err.message ? err.message : "当前分配方法不适用" }],
      assumptions: rmsAllocationPlan.assumptions || []
    };
  }
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
    deleteSystemUsers(Array.from(selectedSystemUsernames));
  }
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

function deleteSystemUsers(usernames) {
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
  systemUsers = systemUsers.filter((user) => !targets.has(user.username));
  selectedSystemUsernames = new Set(Array.from(selectedSystemUsernames).filter((username) => !targets.has(username)));
  systemUsersLoaded = true;
  systemUsersLoadStatus = `已删除 ${targets.size} 个用户`;
}

function updatePermissionRole(feature, encodedRole) {
  const row = SYSTEM_PERMISSION_ROWS.find((item) => item.feature === feature);
  if (!row) return;
  const [roleKey, value] = String(encodedRole || "").split(":");
  if (["admin", "data", "user"].includes(roleKey)) {
    row[roleKey] = value || "查看";
    permissionConfigStatus = `已更新 ${feature} / ${permissionRoleLabel(roleKey)}：${row[roleKey]}`;
  }
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

async function handleModelingImportAction(action, options = {}) {
  if (action === "load-fixture") {
    try {
      const stored = await backendApi.getModelingImport(MODELING_IMPORT_DEMO_FIXTURE.importId);
      applyModelingImportRecord(stored);
      modelingImportCompileResult = null;
      modelingImportStatus = "已从后端恢复导入草稿和发布快照";
    } catch {
      modelingImportPackage = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE);
      modelingImportPublishedPackage = null;
      modelingImportValidation = cloneModelingImportPackage(MODELING_IMPORT_DEMO_FIXTURE.validation);
      modelingImportCompileResult = null;
      modelingImportStatus = "样例导入包已加载";
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
      const published = await backendApi.publishModelingImport(modelingImportPackage.importId);
      applyModelingImportRecord(published);
      modelingImportSaved = true;
      modelingImportStatus = `已发布：${modelingImportPackage.importId}`;
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
      modelingImportCompileResult = await backendApi.compileModelingImportScenario(modelingImportPackage.importId, "smoke");
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

function setModelingImportActionError(label, fieldPath, err) {
  const message = `${label}：${err && err.message ? err.message : "Backend API 不可用"}`;
  const backendIssues = Array.isArray(err?.details?.issues) ? err.details.issues : null;
  modelingImportStatus = message;
  modelingImportValidation = {
    status: backendIssues ? "invalid" : "blocked",
    issues: backendIssues || [
      {
        severity: "error",
        page: "建模数据入口",
        object_id: modelingImportPackage.importId || "modeling-import-package",
        field_path: fieldPath,
        message
      }
    ]
  };
}

async function loadAviationSupportState(steps = aviationSteps) {
  if (typeof fetch === "undefined") {
    liveAviationState = null;
    aviationSource = "demo";
    return;
  }
  aviationLoadInFlight = true;
  try {
    const params = new URLSearchParams({ model: "aviation", steps: String(steps), seed: "17" });
    const resp = await fetch(`${CONTRACT_BASE}/visualization?${params.toString()}`);
    if (!resp.ok) throw new Error(`contract provider HTTP ${resp.status}`);
    const envelope = await resp.json();
    if (!envelope || envelope.ok !== true || !envelope.data) throw new Error("bad contract envelope");
    liveAviationState = envelope.data;
    aviationSource = "live";
  } catch (err) {
    liveAviationState = null;
    aviationSource = "demo";
    console.warn("[aviation] 契约服务不可用，回退演示快照：", err && err.message ? err.message : err);
  } finally {
    aviationLoadInFlight = false;
    render();
  }
}

function renderVisualSimulation(page) {
  const source = liveAviationState || AVIATION_SUPPORT_DEMO_STATE;
  const state = normalizeAviationSupportState(source);
  const activeView = ["aircraft", "mission", "support"].includes(selectedMesaView) ? selectedMesaView : "aircraft";
  if (!liveAviationState && !aviationLoadInFlight) {
    loadAviationSupportState();
  }
  return `
    <div class="mesa-visual-shell">
      <div class="mesa-visual-header">
        <div>
          <div class="breadcrumb">Mesa ABM / aviation_support</div>
          <h3>航空保障 Mesa ABM</h3>
          <p>从 mesa-abm-skill 的可视化仿真迁移而来，基于本地状态帧展示飞机、任务和保障资源。</p>
        </div>
        <div class="mesa-clock">T+${Number((source.snapshot && source.snapshot.elapsed_hours) || 0).toFixed(1)}h <span class="mesa-source mesa-source-${aviationSource}" title="数据来源：${aviationSource === "live" ? "契约服务 127.0.0.1:8521" : "演示快照（契约服务未启动）"}">${aviationSource === "live" ? "契约服务" : "演示快照"}</span></div>
      </div>
      <div class="mesa-toolbar">
        <div class="mesa-tabs" role="tablist" aria-label="Mesa 可视化视图">
          ${mesaTab("aircraft", "飞机视图", activeView)}
          ${mesaTab("mission", "任务视图", activeView)}
          ${mesaTab("support", "保障视图", activeView)}
        </div>
        <div class="mesa-actions" aria-label="运行控制">
          <button type="button" class="btn-primary" data-mesa-control="play">运行</button>
          <button type="button" data-mesa-control="step">单步</button>
          <button type="button" data-mesa-control="reset">重置</button>
        </div>
      </div>
      <div class="kpi-strip">
        ${state.kpis.map((item) => `<div class="kpi-card"><span>${item.label}</span><strong>${item.value}</strong></div>`).join("")}
      </div>
      <div class="mesa-visual-grid">
        <section class="mesa-stage-panel">
          ${renderMesaStage(state)}
        </section>
        <aside class="mesa-side-panel">
          ${renderMesaSidePanel(activeView, state)}
        </aside>
      </div>
    </div>
  `;
}

function mesaTab(id, label, activeView) {
  return `<button type="button" class="mesa-tab ${activeView === id ? "active" : ""}" data-mesa-view="${id}">${label}</button>`;
}

function renderMesaStage(state) {
  return `
    <div class="mesa-stage">
      <div class="mesa-flight-deck">
        ${state.aircraft.map((aircraft) => {
          const [x, y] = aircraft.position;
          return `<div class="mesa-aircraft-node ${mesaStateClass(aircraft.state)}" style="left:${12 + x * 21}%;top:${16 + y * 34}%">
            <strong>${htmlEscape(aircraft.label)}</strong>
            <span>${htmlEscape(aircraft.type)}</span>
            <em>${htmlEscape(stateLabel(aircraft.state))}</em>
          </div>`;
        }).join("")}
      </div>
      <div class="legend">
        <span class="legend-item"><i class="dot available"></i>可用</span>
        <span class="legend-item"><i class="dot support"></i>保障</span>
        <span class="legend-item"><i class="dot ready"></i>待出动</span>
        <span class="legend-item"><i class="dot flying"></i>任务中</span>
        <span class="legend-item"><i class="dot maintenance"></i>维修</span>
      </div>
      <div class="mesa-mission-strip">
        ${state.missions.map((mission) => `<div class="mission"><span>任务 ${htmlEscape(mission.id)} / 需求 ${htmlEscape(mission.requiredAircraft)} 架</span><strong>${htmlEscape(mission.status)}</strong><div class="bar"><i style="width:${missionProgressWidth(mission)}%"></i></div></div>`).join("")}
      </div>
    </div>
  `;
}

function renderMesaSidePanel(activeView, state) {
  if (activeView === "mission") return renderMesaMissionPanel(state);
  if (activeView === "support") return renderMesaSupportPanel(state);
  return renderMesaAircraftPanel(state);
}

function renderMesaAircraftPanel(state) {
  const selectedAircraft = state.aircraft[0];
  return `
    <div class="section-head">
      <h3>单机状态</h3>
      <span>${state.aircraft.length} 架</span>
    </div>
    <div class="mesa-aircraft-list">
      ${state.aircraft.map((aircraft) => `<div class="list-row"><strong>${htmlEscape(aircraft.label)}</strong><span>${htmlEscape(aircraft.type)}</span><span>${htmlEscape(stateLabel(aircraft.state))}</span></div>`).join("")}
    </div>
    <h4>飞机内部装备</h4>
    <div class="event info"><strong>${htmlEscape(selectedAircraft.label)}</strong> 系统数量 ${htmlEscape(selectedAircraft.systemCount)} / 失效 LRU ${htmlEscape(selectedAircraft.failedLru || "-")}</div>
  `;
}

function renderMesaMissionPanel(state) {
  return `
    <div class="section-head">
      <h3>任务计划表</h3>
      <span>${state.missions.length} 个任务</span>
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>任务</th><th>计划</th><th>实际</th><th>状态</th><th>编组</th></tr></thead>
        <tbody>${state.missions.map((mission) => `<tr><td>M-${htmlEscape(mission.id)}</td><td>T+${htmlEscape(mission.plannedStart)}</td><td>${mission.actualStart ? `T+${htmlEscape(mission.actualStart)}` : "-"}</td><td>${htmlEscape(mission.status)}</td><td>${htmlEscape(mission.assignedCount)}/${htmlEscape(mission.requiredAircraft)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <h4>执飞飞机编组</h4>
    <div class="stack-list">
      ${state.missions.map((mission) => `<div class="job"><span>任务 ${htmlEscape(mission.id)}</span><strong>${mission.assignedTailNumbers.length ? mission.assignedTailNumbers.map((tailNumber) => htmlEscape(tailNumber)).join(" / ") : "未编组"}</strong></div>`).join("")}
    </div>
  `;
}

function renderMesaSupportPanel(state) {
  return `
    <div class="section-head">
      <h3>保障资源</h3>
      <span>资源 / 备件 / 作业</span>
    </div>
    <div class="stack-list">
      ${state.resources.map((resource) => `<div class="metric-line"><strong>${htmlEscape(resource.label)}</strong><div class="bar"><span style="width:${Math.round(resource.utilization * 100)}%"></span></div><span>${htmlEscape(resource.inUse)}/${htmlEscape(resource.capacity)}</span></div>`).join("")}
    </div>
    <h4>备件库存量 / 已消耗 / 在途</h4>
    <div class="stack-list">
      ${state.spares.map((spare) => `<div class="list-row"><strong>${htmlEscape(spare.label)}</strong><span>库存 ${htmlEscape(spare.quantity)}</span><span>消耗 ${htmlEscape(spare.consumed)} / 在途 ${htmlEscape(spare.pending)}</span></div>`).join("")}
    </div>
    <h4>保障作业与事件</h4>
    ${state.jobs.map((job) => `<div class="event info"><strong>${htmlEscape(job.tailNumber)}</strong> ${htmlEscape(job.task)} / ${htmlEscape(job.state)} / ${htmlEscape(job.remaining)}min</div>`).join("")}
    ${state.events.map((event) => `<div class="event success"><strong>T+${htmlEscape(event.time)}</strong> ${htmlEscape(event.message)}</div>`).join("")}
  `;
}

function missionProgressWidth(mission) {
  if (mission.status === "completed") return 100;
  if (mission.status === "launched" || mission.status === "flying") return 72;
  if (mission.status === "delayed") return 36;
  return 18;
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

function monteCarloExperimentSourceRows(experiment) {
  const projectionIds = (experiment.projectionArtifactIds || []).join(" / ") || allAnalysisProjectionArtifacts().map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind).filter(Boolean).join(" / ");
  return [
    ["run source", experiment.runId || backendRun?.run_id || "待运行"],
    ["artifact source", experiment.artifactManifestId || experiment.artifactId || backendArtifactManifest?.artifact_manifest_id || "等待正式 MC artifact"],
    ["projection source", projectionIds || "等待 analysis projection artifact"],
    ["mapping/provenance", experiment.mapping_version || mappingProvenanceVersion() || "等待 compiler provenance"]
  ];
}

function experimentPlanOptionsForModule(moduleName) {
  return [scenario.experiment?.name].filter(Boolean);
}

function renderMonteCarloExperimentList(page) {
  const experiments = monteCarloExperimentListForModule(page.module);
  return `
    <div class="mc-workbench">
      <section class="mc-config-panel">
        <div class="section-head">
          <h3>蒙特卡洛实验列表</h3>
          <span>保存全部实验运行历史</span>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn-primary" data-mc-experiment-action="add">新增实验</button>
          <button type="button" class="btn-danger" disabled>批量删除</button>
        </div>
        <div class="table-wrap mc-history-grid">
          <table>
            <thead><tr><th>experiment_id</th><th>mc_experiment_id</th><th>实验名称</th><th>关联方案</th><th>样本量</th><th>随机种子</th><th>状态</th><th>进度</th><th>操作</th></tr></thead>
            <tbody>${experiments.length ? experiments.map((experiment) => `
              <tr>
                <td>${htmlEscape(experiment.experiment_id)}</td>
                <td>${htmlEscape(experiment.mc_experiment_id)}</td>
                <td>${htmlEscape(experiment.name)}</td>
                <td>${htmlEscape(experiment.experimentPlanName)}</td>
                <td>${experiment.samples}</td>
                <td>${experiment.seed}</td>
                <td><span class="badge">${htmlEscape(experiment.status)}</span></td>
                <td>${experiment.progress}%</td>
                <td class="table-action-cell">
                  <button type="button" class="inline-action" data-mc-experiment-action="detail" data-mc-experiment-id="${htmlEscape(experiment.id)}">详情</button>
                  <button type="button" class="inline-action" data-mc-experiment-action="edit" data-mc-experiment-id="${htmlEscape(experiment.id)}">编辑</button>
                  <button type="button" class="btn-danger" disabled>删除</button>
                </td>
              </tr>
            `).join("") : `<tr><td colspan="9">${importedDataEmptyState("蒙特卡洛实验")}</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderMonteCarloExperimentEditor(page) {
  const experiment = currentMonteCarloExperiment(page.module);
  if (!experiment) {
    return importedDataEmptyState("蒙特卡洛实验");
  }
  const detailFeatureId = getMonteCarloExperimentDetailFeatureId(page.module);
  return `
    <div class="mc-workbench">
      <section class="mc-config-panel mc-config-panel-single">
        <div class="section-head">
          <h3>添加/编辑蒙特卡洛实验</h3>
          <span>选择方案 / 样本量 / 随机种子</span>
        </div>
        <div class="mc-form">
          <div class="readonly-field">
            <span>mc_experiment_id</span>
            <strong>${htmlEscape(experiment.mc_experiment_id)}</strong>
          </div>
          <label>实验名称<input data-mc-experiment-field="name" value="${htmlEscape(experiment.name)}"></label>
          <label>选择方案<select data-mc-experiment-field="experimentPlanName">
            ${experimentPlanOptionsForModule(page.module).map((option) => `<option ${option === experiment.experimentPlanName ? "selected" : ""}>${htmlEscape(option)}</option>`).join("")}
          </select></label>
          <div class="mc-inline-fields">
            <label>仿真次数<input id="mc-samples" data-experiment-plan-path="experiment.samples" data-mc-experiment-field="samples" type="number" min="1" value="${experiment.samples}"></label>
            <label>随机种子<input data-experiment-plan-path="experiment.seed" data-mc-experiment-field="seed" type="number" value="${experiment.seed}"></label>
          </div>
          <label>故障率扫描<input data-mc-array-path="monteCarlo.failureRates" value="${experimentPlanDraft.monteCarlo.failureRates.join(",")}"></label>
          <label>备件倍数<input data-mc-array-path="monteCarlo.spareMultipliers" value="${experimentPlanDraft.monteCarlo.spareMultipliers.join(",")}"></label>
          <label>保障容量<input data-mc-array-path="monteCarlo.supportCapacities" value="${experimentPlanDraft.monteCarlo.supportCapacities.join(",")}"></label>
          <div class="mc-action-row">
            <button type="button" data-mc-experiment-action="list">返回实验列表</button>
            <button type="button" class="btn-primary" data-feature-id="${detailFeatureId}">保存并查看详情</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderMonteCarloExperimentDetail(page) {
  const experiment = currentMonteCarloExperiment(page.module);
  if (!experiment) {
    return importedDataEmptyState("蒙特卡洛实验");
  }
  const sourceRows = monteCarloExperimentSourceRows(experiment);
  return `
    <div class="mc-workbench">
      <section class="mc-config-panel">
        <div class="section-head">
          <h3>蒙特卡洛实验详情</h3>
          <span>${htmlEscape(experiment.status)}</span>
        </div>
        <div class="mc-detail-grid">
          <div class="readonly-field"><span>SimulationExperimentBase</span><strong>${htmlEscape(experiment.experiment_type)}</strong></div>
          <div class="readonly-field"><span>experiment_id</span><strong>${htmlEscape(experiment.experiment_id)}</strong></div>
          <div class="readonly-field"><span>mc_experiment_id</span><strong>${htmlEscape(experiment.mc_experiment_id)}</strong></div>
          <div class="readonly-field"><span>模块</span><strong>${htmlEscape(experiment.module)}</strong></div>
          <div class="readonly-field"><span>关联方案</span><strong>${htmlEscape(experiment.experimentPlanName)}</strong></div>
          <div class="readonly-field"><span>scenario_id</span><strong>${htmlEscape(experiment.scenario_id || experiment.scenarioId)}</strong></div>
          <div class="readonly-field"><span>scenario_version</span><strong>${htmlEscape(experiment.scenario_version)}</strong></div>
          <div class="readonly-field"><span>样本量</span><strong>${experiment.samples}</strong></div>
          <div class="readonly-field"><span>随机种子</span><strong>${experiment.seed}</strong></div>
          <div class="readonly-field"><span>run_type</span><strong>${htmlEscape(experiment.runType || "monte_carlo")}</strong></div>
          <div class="readonly-field"><span>run_id</span><strong>${htmlEscape(backendRun?.run_id || experiment.runId || "尚未启动")}</strong></div>
          <div class="readonly-field"><span>artifact_manifest_id</span><strong>${htmlEscape(backendArtifactManifest?.artifact_manifest_id || experiment.artifactManifestId || experiment.artifactId || "等待生成")}</strong></div>
        </div>
        <div class="backend-run-chain">
          <span>run / artifact / projection 来源</span>
          <table><tbody>${sourceRows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>
        </div>
        <div class="mc-progress">
          <span>实验进度</span>
          <div class="bar-track"><span class="bar-fill blue" style="width:${Math.max(8, experiment.progress)}%"></span></div>
          <strong>${experiment.progress}%</strong>
        </div>
        <div class="mc-action-row">
          <button type="button" data-mc-experiment-action="list">返回实验列表</button>
          <button type="button" class="btn-primary" data-mc-action="start" ${formalRunSubmitInFlight ? "disabled" : ""}>启动实验</button>
        </div>
        ${renderMonteCarloResults()}
      </section>
    </div>
  `;
}

function renderMonteCarloConfig() {
  return renderMonteCarloExperimentEditor(getFeaturePageById(selectedFeatureId));
}

function renderLegacyMonteCarloConfig() {
  return `
    <div class="mc-workbench">
      <section class="mc-config-panel mc-config-panel-single">
        <div class="section-head">
          <h3>蒙特卡洛实验参数配置</h3>
          <span>样本 / seed / 扫参</span>
        </div>
        <div class="mc-form">
          <div class="readonly-field">
            <span>当前仿真实验</span>
            <strong>${htmlEscape(experimentPlanDraft.experiment.name)}</strong>
          </div>
          <div class="mc-inline-fields">
            <label>仿真次数<input id="mc-samples" data-experiment-plan-path="experiment.samples" type="number" min="1" value="${experimentPlanDraft.experiment.samples}"></label>
            <label>随机种子<input data-experiment-plan-path="experiment.seed" type="number" value="${experimentPlanDraft.experiment.seed}"></label>
          </div>
          <label>故障率扫描<input data-mc-array-path="monteCarlo.failureRates" value="${experimentPlanDraft.monteCarlo.failureRates.join(",")}"></label>
          <label>备件倍数<input data-mc-array-path="monteCarlo.spareMultipliers" value="${experimentPlanDraft.monteCarlo.spareMultipliers.join(",")}"></label>
          <label>保障容量<input data-mc-array-path="monteCarlo.supportCapacities" value="${experimentPlanDraft.monteCarlo.supportCapacities.join(",")}"></label>
          <div class="mc-action-row">
            <button type="button" class="btn-primary" data-mc-action="start" ${formalRunSubmitInFlight ? "disabled" : ""}>启动</button>
          </div>
        </div>
      </section>
    </div>
  `;
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

function renderMonteCarloResults() {
  const groups = monteCarloResult.groups || [];
  const resultRows = buildMonteCarloEvaluationRows();
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
        <h3>蒙特卡洛评估结果</h3>
        <span>${monteCarloResult.runs.length} 个样本</span>
      </div>
      <div class="backend-run-chain">
        <span>后端状态：${htmlEscape(backendApiStatus)}</span>
        <div class="result-source-note">
          <strong>后端产物来源</strong>
          <span>Run status、ResultSummary、ArtifactManifest 和 identity chain 来自后端 /api/runs。</span>
          <strong>前端展示桥接</strong>
          <span>下方蒙特卡洛分组表仍由当前 ExperimentPlan 分支快照在前端重算，用于展示过渡；不作为 M6.0 真实批量 Monte Carlo artifact。</span>
        </div>
        ${backendChainRows.length
          ? `<table><tbody>${backendChainRows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`
          : `<p>${htmlEscape(backendRun?.run_id || "尚未读取 run_id 身份链")}</p>`}
        ${artifactRows.length
          ? `<table><tbody>${artifactRows.map((artifact) => `<tr><th>${htmlEscape(artifact.kind)}</th><td>${htmlEscape(artifact.path)}</td></tr>`).join("")}</tbody></table>`
          : ""}
      </div>
      <div class="mc-result-cards">
        ${resultRows.map((row) => `
          <div class="metric-card">
            <span>${row.name}</span>
            <strong>${row.value}</strong>
            <em>目标值 ${row.target}</em>
          </div>
        `).join("")}
      </div>
      <div class="table-wrap mc-evaluation-table">
        <table>
          <thead><tr><th>序号</th><th>指标名称</th><th>蒙特卡洛评估值</th><th>目标值</th></tr></thead>
          <tbody>${resultRows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.name}</td><td>${row.value}</td><td>${row.target}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="table-wrap mc-group-table">
        <table>
          <thead><tr><th>参数组</th><th>样本数</th><th>任务可靠度</th><th>战备完好率</th><th>短缺事件</th></tr></thead>
          <tbody>${groups.map((group) => `<tr><td>${group.group}</td><td>${group.count}</td><td>${pct(group.mission_success_rate.mean)}</td><td>${pct(group.ready_rate.mean)}</td><td>${fixed(group.shortage_events.mean, 1)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
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
    body: `<div class="empty-state"><strong>${message}</strong><p>本地空白预览不会生成短板、携行、可靠度或停机因素结论。</p></div>`
  });
}

function renderSpareShortfallAnalysis() {
  if (!hasPreviewAnalysisData()) {
    return renderAnalysisEmptyState("备件短板分析", "启动分析", "备件需求量降序", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const rows = singleResult.spareShortfalls.map((row) => ({
    name: row.spareType,
    satisfy: row.fillRate,
    delay: row.shortage * 24,
    baseCount: Math.max(0, row.demand - row.shortage),
    stock: row.demand,
    shortage: row.shortage,
    level: row.shortage >= 2 ? "严重" : row.shortage === 1 ? "短缺" : "关注"
  }));
  const minSatisfy = rows.reduce((min, row) => Math.min(min, row.satisfy), 1);
  const maxDelay = rows.reduce((max, row) => Math.max(max, row.delay), 0);
  const maxShortage = rows.reduce((max, row) => Math.max(max, row.shortage), 1);
  return renderAnalysisDashboard({
    title: "备件短板分析",
    mode: "启动分析",
    subtitle: "备件需求量降序",
    metrics: [
      ["短板备件", `${rows.filter((row) => row.shortage > 0).length} 项`],
      ["最低备件满足率", fixed(minSatisfy, 2)],
      ["最大平均延误", `${maxDelay} h`],
      ["建议优先补充", rows.filter((row) => row.shortage > 0).map((row) => row.name).slice(0, 2).join(" / ") || "-"]
    ],
    body: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>备件</th><th>备件满足率</th><th>平均延误时间(h)</th><th>基层级数量</th><th>初始基层级库存</th><th>不满足次数</th><th>短板等级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${row.name}</td><td>${fixed(row.satisfy, 2)}</td><td>${row.delay}</td><td>${row.baseCount}</td><td>${row.stock}</td><td>${row.shortage}</td>
              <td><span class="status-badge ${row.level === "严重" ? "danger" : row.level === "短缺" ? "warn" : ""}">${row.level}</span></td>
              <td class="bar-cell">${renderBar(row.shortage, maxShortage, "red")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    `
  });
}

function renderCarryListAnalysis() {
  if (!hasPreviewAnalysisData()) {
    return renderAnalysisEmptyState("飞机转场携行清单分析", "参数配置", "携行清单迭代建议", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const objective = carryObjectiveOption(carryObjective);
  const rows = singleResult.carryList.map((row, index) => ({
    name: row.spareType,
    satisfy: Math.max(0, 1 - row.shortage / Math.max(row.recommended, 1)),
    delay: row.shortage * 18 + index * 2,
    qty: row.recommended,
    priority: carryPriority(row.riskLevel)
  }));
  const maxCarryQuantity = rows.reduce((max, row) => Math.max(max, row.qty), 1);
  return renderAnalysisDashboard({
    title: "飞机转场携行清单分析",
    mode: "参数配置",
    subtitle: "携行清单迭代建议",
    config: `
      <label>优化条件<select><option>${objective.label}</option><option>出动架次率</option><option>再次出动准备时间</option></select></label>
      <label>备件满足率不低于<input value="0.90"></label>
      <label>备件利用率不低于<input value="0.70"></label>
    `,
    metrics: [
      ["优化条件", objective.label],
      ["携行备件数量", `${rows.reduce((sum, row) => sum + row.qty, 0)} 件`],
      ["备件满足率不低于", "0.90"],
      [objective.metricLabel, objective.metricValue]
    ],
    body: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>备件</th><th>备件满足率</th><th>平均延误时间(h)</th><th>数量</th><th>携行优先级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${row.name}</td><td>${fixed(row.satisfy, 2)}</td><td>${row.delay}</td><td>${row.qty}</td>
              <td><span class="status-badge ${row.priority === "高" ? "danger" : row.priority === "中" ? "warn" : "success"}">${row.priority}</span></td>
              <td class="bar-cell">${renderBar(row.qty, maxCarryQuantity, "blue")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
      <div class="decision-support-card"><strong>携行清单说明</strong><span>以${objective.label}为优化目标，优先补足低满足率且短缺次数高的备件，形成转场前装箱评审清单。</span></div>
    `
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
  if (!hasPreviewAnalysisData()) {
    return renderAnalysisEmptyState("任务可靠度评估", "启动分析", "任务可靠度指标分解", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const timeline = singleResult.timeline || [];
  const sampleEvery = Math.max(1, Math.ceil(timeline.length / 9));
  const waves = timeline
    .filter((_, index) => index % sampleEvery === 0)
    .slice(0, 9)
    .map((point, index) => {
      const probability = Number(point.mission_success_rate || 0);
      return {
        wave: point.wave || index + 1,
        probability,
        sorties: Number(point.sortie_count || 0),
        available: Number(point.ready_count || 0),
        state: probability < 0.7 ? "风险" : probability < 0.9 ? "关注" : "满足"
      };
    });
  if (!waves.length) {
    return renderAnalysisEmptyState("任务可靠度评估", "启动分析", "任务可靠度指标分解", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const riskWave = waves.find((row) => row.state === "风险");
  return renderAnalysisDashboard({
    title: "任务可靠度评估",
    mode: "启动分析",
    subtitle: "任务可靠度指标分解",
    metrics: [
      ["首波任务成功概率", fixed(waves[0].probability, 2)],
      ["末波任务成功概率", fixed(waves.at(-1).probability, 2)],
      ["风险拐点", riskWave ? `第 ${riskWave.wave} 波` : "未触发"],
      ["累计出动架次", `${waves.at(-1).sorties}`]
    ],
    body: `
      <div class="analysis-chart-panel"><div class="chart-title">波次任务成功概率趋势</div>${renderLineChart(waves.map((row) => ({ x: row.wave, y: row.probability })))}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>波次任务</th><th>波次任务成功概率</th><th>累计出动架次</th><th>可用飞机数</th><th>状态</th></tr></thead>
          <tbody>${waves.map((row) => `<tr><td>${row.wave}</td><td>${fixed(row.probability, 3)}</td><td>${row.sorties}</td><td>${row.available}</td><td><span class="status-badge ${row.state === "风险" ? "danger" : row.state === "关注" ? "warn" : "success"}">${row.state}</span></td></tr>`).join("")}</tbody>
        </table>
      </div>
    `
  });
}

function renderDowntimeFactorAnalysis() {
  if (!hasPreviewAnalysisData()) {
    return renderAnalysisEmptyState("停机因素分析", "启动分析", "停机贡献因素排序", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const factors = singleResult.downtimeFactors;
  if (!factors.length) {
    return renderAnalysisEmptyState("停机因素分析", "启动分析", "停机贡献因素排序", "暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。");
  }
  const total = factors.reduce((sum, row) => sum + row.count, 0);
  const maxFactorCount = factors.reduce((max, row) => Math.max(max, row.count), 1);
  const primaryFactors = factors.slice(0, 2);
  return renderAnalysisDashboard({
    title: "停机因素分析",
    mode: "启动分析",
    subtitle: "停机贡献因素排序",
    metrics: [
      ["停机因素总次数", `${total}`],
      ["首要因素", primaryFactors[0]?.label || "-"],
      ["次要因素", primaryFactors[1]?.label || "-"],
      ["备件满足率", fixed(singleResult.final.spare_fill_rate, 2)]
    ],
    body: `
      <div class="factor-grid">
        <div class="factor-column"><h4>停机因素</h4><div class="factor-list">${primaryFactors.map((row) => `<div class="factor-item"><span>${row.label}</span><span>${row.count}</span></div>`).join("")}</div></div>
        <div class="factor-column"><h4>二级因素</h4><div class="factor-list">${factors.map((row) => `<div class="factor-item"><span>${row.label}</span><span>${row.count}</span></div>`).join("")}</div></div>
        <div class="factor-column"><h4>观察指标</h4><div class="factor-list"><div class="factor-item"><span>备件满足率</span><span>${fixed(singleResult.final.spare_fill_rate, 2)}</span></div><div class="factor-item"><span>维修积压</span><span>${singleResult.final.repair_backlog || 0}</span></div></div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>二级因素</th><th>贡献次数</th><th>贡献度</th><th>图示</th></tr></thead>
          <tbody>${factors.map((row) => `<tr><td>${row.label}</td><td>${row.count}</td><td>${pct(row.contribution)}</td><td class="bar-cell">${renderBar(row.count, maxFactorCount, row.count >= 2 ? "red" : "blue")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `
  });
}

function analysisTypeForPage(page) {
  if (page.name.includes("备件短板")) return "spare_shortfall";
  if (page.name.includes("携行")) return "carry_list";
  if (page.name.includes("停机")) return "downtime_factors";
  if (page.name.includes("任务可靠度") || page.name.includes("飞机任务可靠性")) return "mission_reliability";
  return "large_sample_summary";
}

function analysisTaskListForPage(page) {
  const analysisType = analysisTypeForPage(page);
  return analysisTasks.filter((task) => task.module === page.module && task.analysisType === analysisType);
}

function analysisFormKey(page) {
  return `${page.module}:${analysisTypeForPage(page)}`;
}

function defaultAnalysisTaskForm(page) {
  return {
    name: `${page.name}任务 ${analysisTasks.length + 1}`,
    experimentPlanName: experimentPlanDraft.experiment.name,
    samples: Number(experimentPlanDraft.experiment.samples),
    seed: Number(experimentPlanDraft.experiment.seed)
  };
}

function analysisTaskFormForPage(page) {
  const key = analysisFormKey(page);
  return analysisTaskForms[key] || defaultAnalysisTaskForm(page);
}

function updateAnalysisTaskFormField(page, input) {
  const key = analysisFormKey(page);
  analysisTaskForms = {
    ...analysisTaskForms,
    [key]: {
      ...analysisTaskFormForPage(page),
      [input.dataset.analysisTaskField]: parseInput(input)
    }
  };
}

function analysisFormFromTask(task) {
  return {
    name: task.name,
    experimentPlanName: task.experimentPlanName,
    samples: Number(task.samples),
    seed: Number(task.seed)
  };
}

function createAnalysisTaskForPage(page, formOverrides = {}) {
  const analysisType = analysisTypeForPage(page);
  const form = { ...defaultAnalysisTaskForm(page), ...formOverrides };
  const task = {
    id: `analysis-${analysisType}-${String(analysisTasks.length + 1).padStart(3, "0")}`,
    module: page.module,
    analysisType,
    name: form.name,
    experimentPlanName: form.experimentPlanName,
    samples: Number(form.samples),
    seed: Number(form.seed),
    status: "已创建",
    linkedMonteCarloExperimentId: ""
  };
  analysisTasks = [...analysisTasks, task];
  selectedAnalysisTaskId = task.id;
  return task;
}

function updateSelectedAnalysisTaskFromForm(page) {
  const task = analysisTasks.find((item) => item.id === selectedAnalysisTaskId);
  if (!task) return null;
  const form = analysisTaskFormForPage(page);
  const updatedTask = {
    ...task,
    name: form.name,
    experimentPlanName: form.experimentPlanName,
    samples: Number(form.samples),
    seed: Number(form.seed),
    status: "已配置"
  };
  analysisTasks = analysisTasks.map((item) => item.id === task.id ? updatedTask : item);
  return updatedTask;
}

function ensureAnalysisTaskMonteCarloExperiment(task, options = {}) {
  const existing = monteCarloExperiments.find((experiment) => experiment.mc_experiment_id === task.linkedMonteCarloExperimentId);
  if (existing && !options.forceNew) return existing;
  const experiment = createMonteCarloExperiment(task.module, {
    name: `${task.name} 绑定MC实验`,
    experimentPlanName: task.experimentPlanName,
    samples: task.samples,
    seed: task.seed,
    status: "待运行",
    source: "analysis:auto-created"
  });
  monteCarloExperiments = [...monteCarloExperiments, experiment];
  task.linkedMonteCarloExperimentId = experiment.mc_experiment_id;
  analysisTasks = analysisTasks.map((item) => item.id === task.id ? { ...item, linkedMonteCarloExperimentId: experiment.mc_experiment_id } : item);
  return experiment;
}

function renderAnalysisTaskList(page, title) {
  const tasks = analysisTaskListForPage(page);
  const form = analysisTaskFormForPage(page);
  const selectedTask = tasks.find((task) => task.id === selectedAnalysisTaskId);
  const displayTasks = tasks.length
    ? tasks
    : [{
        id: `analysis-preview-${analysisTypeForPage(page)}`,
        name: `${title}默认任务`,
        experimentPlanName: experimentPlanDraft.experiment.name,
        samples: Number(experimentPlanDraft.experiment.samples),
        seed: Number(experimentPlanDraft.experiment.seed),
        status: "待创建",
        linkedMonteCarloExperimentId: "未绑定",
        preview: true
      }];
  const taskRows = displayTasks.map((task) => {
    const linkedExperiment = monteCarloExperimentByBusinessId(task.linkedMonteCarloExperimentId);
    const sourceRows = linkedExperiment ? monteCarloExperimentSourceRows(linkedExperiment) : [];
    return {
      task,
      linkedExperiment,
      runSource: sourceRows.find(([label]) => label === "run source")?.[1] || "未绑定",
      artifactSource: sourceRows.find(([label]) => label === "artifact source")?.[1] || "未绑定",
      projectionSource: sourceRows.find(([label]) => label === "projection source")?.[1] || "未配置"
    };
  });
  return `
    <section class="analysis-task-panel">
      <div class="section-head">
        <h3>分析任务列表</h3>
        <span>创建/编辑/删除</span>
      </div>
      <div class="result-source-note">
        <strong>自动绑定规则</strong>
        <span>选择方案 + 参数后自动创建一个新的蒙特卡洛实验并绑定分析任务；详情页展示 linkedMonteCarloExperimentId / mc_experiment_id。</span>
      </div>
      <div class="mc-form analysis-task-form">
        <label>任务名称<input data-analysis-task-field="name" value="${htmlEscape(form.name)}"></label>
        <label>选择方案<select data-analysis-task-field="experimentPlanName">
          ${experimentPlanOptionsForModule(page.module).map((option) => `<option ${option === form.experimentPlanName ? "selected" : ""}>${htmlEscape(option)}</option>`).join("")}
        </select></label>
        <div class="mc-inline-fields">
          <label>实验样本量<input data-analysis-task-field="samples" type="number" min="1" value="${form.samples}"></label>
          <label>随机种子<input data-analysis-task-field="seed" type="number" value="${form.seed}"></label>
        </div>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn-primary" data-analysis-action="create-with-mc">创建分析任务并绑定MC实验</button>
        <button type="button" data-analysis-action="save" ${selectedTask ? "" : "disabled"}>保存编辑并新建绑定MC实验</button>
        <button type="button" class="btn-danger" data-analysis-action="delete" ${selectedTask ? "" : "disabled"}>删除选中任务</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>任务</th><th>方案</th><th>样本量</th><th>随机种子</th><th>状态</th><th>linkedMonteCarloExperimentId</th><th>mc_experiment_id</th><th>experiment_id</th><th>run/artifact/projection 来源</th><th>操作</th></tr></thead>
          <tbody>${taskRows.map(({ task, linkedExperiment, runSource, artifactSource, projectionSource }) => `
            <tr>
              <td>${htmlEscape(task.name)}</td>
              <td>${htmlEscape(task.experimentPlanName)}</td>
              <td>${task.samples}</td>
              <td>${task.seed}</td>
              <td><span class="badge">${htmlEscape(task.status)}</span></td>
              <td>${htmlEscape(task.linkedMonteCarloExperimentId)}</td>
              <td>${htmlEscape(linkedExperiment?.mc_experiment_id || task.linkedMonteCarloExperimentId)}</td>
              <td>${htmlEscape(linkedExperiment?.experiment_id || "未绑定")}</td>
              <td>${htmlEscape(`run=${runSource}; artifact=${artifactSource}; projection=${projectionSource}`)}</td>
              <td class="table-action-cell">
                <button type="button" class="inline-action" data-analysis-action="edit" data-analysis-task-id="${htmlEscape(task.id)}" ${task.preview ? "disabled" : ""}>编辑</button>
                <button type="button" class="btn-danger" data-analysis-action="delete" data-analysis-task-id="${htmlEscape(task.id)}" ${task.preview ? "disabled" : ""}>删除</button>
              </td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function currentAnalysisTaskForPage(page) {
  const tasks = analysisTaskListForPage(page);
  return tasks.find((task) => task.id === selectedAnalysisTaskId) || tasks[0] || null;
}

function artifactText(artifact) {
  return [
    artifact?.kind,
    artifact?.type,
    artifact?.artifact_type,
    artifact?.name,
    artifact?.path,
    artifact?.artifact_id,
    artifact?.id
  ].filter(Boolean).join("|").toLowerCase();
}

function artifactMatchesAny(artifact, tokens) {
  const text = artifactText(artifact);
  return tokens.some((token) => text.includes(token));
}

function currentArtifactRows() {
  return Array.isArray(backendArtifactManifest?.artifacts) ? backendArtifactManifest.artifacts : [];
}

function monteCarloBaseArtifacts() {
  return currentArtifactRows().filter((artifact) => artifactMatchesAny(artifact, [
    "monte_carlo",
    "monte-carlo",
    "large_sample",
    "large-sample",
    "sample_metrics",
    "aggregate"
  ]));
}

function analysisProjectionArtifacts(analysisType = "") {
  const projectionType = analysisProjectionTypeForAnalysisType(analysisType);
  return currentArtifactRows().filter((artifact) => {
    const text = artifactText(artifact);
    return text.includes(projectionType)
      || artifact?.projection_type === projectionType
      || artifact?.analysis_type === projectionType;
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

function formalAnalysisBoundaryReason({ state, provenance, linkedExperiment, runMatchesLinkedExperiment, runTypeIsMonteCarlo, projectionArtifacts, failedCompiler }) {
  if (state === "unconfigured") return "未创建分析任务或未绑定 linkedMonteCarloExperimentId。";
  if (state === "pending") return "已配置分析任务，但绑定的 Monte Carlo 实验尚未运行。";
  if (state === "running") return `绑定的 Monte Carlo 实验正在运行，进度 ${normalizeProgress(linkedExperiment?.progress)}%。`;
  if (state === "failed") return failedCompiler ? compileGateStatusText(backendRun) : "绑定的 Monte Carlo 实验运行失败。";
  if (!runMatchesLinkedExperiment) return "当前后端 run_id 与 linkedMonteCarloExperimentId 绑定的实验不一致。";
  if (!runTypeIsMonteCarlo) return "当前 run 不是 run_type=monte_carlo。";
  if (!provenance) return "缺少 compiler provenance。";
  if (monteCarloBaseArtifacts().length === 0) return "缺少正式 Monte Carlo artifact。";
  if (projectionArtifacts.length === 0) return "缺少当前分析类型的 analysis projection artifact。";
  return "本页四类分析值来自前端 singleResult 局部推导，仅保留为本地预览。";
}

function renderFormalAnalysisSourceTable(boundary) {
  const linkedExperiment = boundary.linkedExperiment;
  const rows = [
    ["linkedMonteCarloExperimentId", boundary.task?.linkedMonteCarloExperimentId || "未绑定"],
    ["mc_experiment_id", linkedExperiment?.mc_experiment_id || "未绑定"],
    ["run_id", linkedExperiment?.runId || backendRun?.run_id || "未运行"],
    ["run_type", backendRun?.run_type || linkedExperiment?.runType || "未知"],
    ["artifact_manifest_id", backendArtifactManifest?.artifact_manifest_id || linkedExperiment?.artifactManifestId || "等待生成"],
    ["projection", boundary.analysisArtifacts.map((artifact) => artifact.artifact_id || artifact.id || artifact.path || artifact.kind).filter(Boolean).join(" / ") || "未配置"],
    ["mapping/provenance", mappingProvenanceVersion() || "等待 compiler provenance"]
  ];
  return `<table><tbody>${rows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`;
}

function formalAnalysisBoundary(page) {
  const task = currentAnalysisTaskForPage(page);
  const linkedExperiment = task?.linkedMonteCarloExperimentId ? monteCarloExperimentByBusinessId(task.linkedMonteCarloExperimentId) : null;
  const provenance = backendRun?.compiler_provenance
    || backendRun?.compiled_from?.mapping_provenance
    || backendRunResult?.compiler_provenance
    || backendRunResult?.compiled_from?.mapping_provenance
    || backendRunChain?.compiler_provenance
    || backendRun?.error?.details?.provenance
    || null;
  const runStatus = backendRun?.status || linkedExperiment?.status || "";
  const failedCompiler = backendRun?.status === "failed" && backendRun?.error?.details?.issues?.length;
  const runFailed = backendRun?.status === "failed" || linkedExperiment?.status === "运行失败";
  const running = ["queued", "running", "pending", "运行中"].includes(String(runStatus).toLowerCase()) || linkedExperiment?.status === "运行中";
  const runMatchesLinkedExperiment = Boolean(linkedExperiment?.runId && backendRun?.run_id && linkedExperiment.runId === backendRun.run_id);
  const runTypeIsMonteCarlo = backendRun?.run_type === "monte_carlo"
    || linkedExperiment?.runType === "monte_carlo"
    || monteCarloBaseArtifacts().length > 0;
  const projectionArtifacts = analysisProjectionArtifacts(analysisTypeForPage(page));
  const analysisArtifacts = projectionArtifacts;
  const formalUnlocked = Boolean(
    task
    && linkedExperiment
    && runMatchesLinkedExperiment
    && runTypeIsMonteCarlo
    && !runFailed
    && !running
    && provenance
    && monteCarloBaseArtifacts().length > 0
    && analysisArtifacts.length > 0
  );
  const state = !task || task.preview || !task.linkedMonteCarloExperimentId
    ? "unconfigured"
    : !linkedExperiment || !linkedExperiment.runId
      ? "pending"
      : runFailed
        ? "failed"
        : running
          ? "running"
          : formalUnlocked
            ? "formal"
            : "local_preview";
  return {
    formalUnlocked,
    state,
    task,
    linkedExperiment,
    provenance,
    analysisArtifacts,
    monteCarloArtifacts: monteCarloBaseArtifacts(),
    reason: formalAnalysisBoundaryReason({ state, provenance, linkedExperiment, runMatchesLinkedExperiment, runTypeIsMonteCarlo, projectionArtifacts, failedCompiler })
  };
}

function renderFormalAnalysisBoundaryNote(boundary) {
  if (boundary.formalUnlocked) {
    return `
      <div class="result-source-note">
        <strong>正式后端结果</strong>
        <span>已读取正式 Monte Carlo artifact 和 analysis projection，当前页面按绑定的 MC 产物展示。</span>
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
    local_preview: "本地预览，不是正式后端仿真结果"
  };
  return `
    <div class="result-source-note">
      <strong>${titleByState[boundary.state] || "本地预览，不是正式后端仿真结果"}</strong>
      <span>${failedCompiler ? compileGateStatusText(backendRun) : boundary.reason}</span>
      <span>只有绑定的 Monte Carlo 实验完成并产出正式 MC artifact/projection 后，才显示正式结果。</span>
      ${renderFormalAnalysisSourceTable(boundary)}
    </div>
  `;
}

function renderAnalysisDashboard({ title, mode, subtitle, config = "", metrics, body }) {
  const page = getFeaturePageById(selectedFeatureId);
  const boundary = formalAnalysisBoundary(page);
  const metricSuffix = boundary.formalUnlocked ? "" : "<em>本地预览</em>";
  return `
    <div class="analysis-dashboard">
      ${renderAnalysisTaskList(page, title)}
      <section class="analysis-filter-bar">
        <div><h3>${title}</h3><span>${subtitle}</span></div>
        <button type="button" class="btn-primary">启动</button>
      </section>
      ${renderFormalAnalysisBoundaryNote(boundary)}
      ${config ? `<section class="analysis-config-grid">${config}</section>` : ""}
      <section class="kpi-strip">${metrics.map(([label, value]) => `<div class="kpi-card"><span>${label}</span><strong>${value}</strong>${metricSuffix}</div>`).join("")}</section>
      <section class="analysis-chart-panel">${body}</section>
      <div class="decision-support-card"><strong>${mode}</strong><span>${boundary.formalUnlocked ? "结果已按后端 analysis artifact 展示，供当前项目评审。" : "本地预览，不是正式后端仿真结果；正式结果需等待 compiler provenance 与 analysis artifact 同时存在。"}</span></div>
    </div>
  `;
}

function renderBar(value, max, color) {
  const width = Math.max(8, Math.round((Number(value) / Math.max(Number(max), 1)) * 100));
  return `<div class="bar-track"><span class="bar-fill ${color}" style="width:${width}%"></span></div>`;
}

function renderLineChart(points) {
  const width = 640;
  const height = 180;
  const minY = 0.84;
  const maxY = 1;
  const xScale = (x) => 36 + ((x - 1) / 8) * 560;
  const yScale = (y) => 18 + (1 - (y - minY) / (maxY - minY)) * 128;
  const line = points.map((point) => `${xScale(point.x).toFixed(1)},${yScale(point.y).toFixed(1)}`).join(" ");
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="任务可靠度趋势">
      <polyline points="${line}"></polyline>
      ${points.map((point) => `<circle cx="${xScale(point.x).toFixed(1)}" cy="${yScale(point.y).toFixed(1)}" r="4"></circle><text x="${xScale(point.x).toFixed(1)}" y="168">${point.x}</text>`).join("")}
    </svg>
  `;
}

function renderScenarioSwitch() {
  return `
    <div class="section-head">
      <h3>场景切换</h3>
      <span>宏观任务视图 / 机场保障视图 / 指标统计视图</span>
    </div>
    <div class="scenario-grid">
      ${["宏观任务视图", "陆基保障视图", "指标统计视图"].map((name) => `<button type="button" class="scenario-card">${name}<span>${scenario.scenarioId}</span></button>`).join("")}
    </div>
  `;
}

function field(label, path, type = "text", attrs = {}) {
  return `<label>${label}${valueInput(path, type, attrs)}</label>`;
}

function valueInput(path, type = "text", attrs = {}) {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${htmlEscape(value)}"`)
    .join("");
  return `<input data-path="${path}" type="${type}" value="${htmlEscape(getPath(scenario, path))}"${attrText}>`;
}

function valueSelect(path, options) {
  const selectedValue = String(getPath(scenario, path));
  return `
    <select data-path="${path}">
      ${options.map((option) => {
        const value = String(option.value);
        return `<option value="${htmlEscape(value)}" ${value === selectedValue ? "selected" : ""}>${htmlEscape(option.label)}</option>`;
      }).join("")}
    </select>
  `;
}

function isActiveTertiary(activePage, pages) {
  return pages.some((page) => page.id === activePage.id);
}

function readFeatureIdFromHash() {
  const match = location.hash.match(/feature=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function readRouteFromHash() {
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
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-experiment-plan-list";
  return "spare-planning-experiment-plan-list";
}

function getVisualSimulationFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-visual-start-stop";
  return "spare-planning-visual-start-stop";
}

function getMonteCarloExperimentListFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-monte-carlo-experiment-list";
  return "spare-planning-monte-carlo-experiment-list";
}

function getMonteCarloExperimentEditFeatureId(moduleName) {
  if (moduleName === "任务可靠度评估模块") return "mission-reliability-monte-carlo-experiment-edit";
  return "spare-planning-monte-carlo-experiment-edit";
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

function updateEquipmentKOutOfNInput(input) {
  const component = scenario.components[Number(input.dataset.equipmentKOutOfNIndex)];
  if (!component) return;
  const quantity = Math.max(0, Math.trunc(Number(component.quantity) || 0));
  const bounded = quantity > 1 ? clamp(Math.trunc(Number(input.value) || 1), 1, quantity) : 0;
  component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1 && bounded > 0, n: quantity, k: bounded };
  input.value = String(bounded);
  updatePreviewResultsThroughApiClient();
}

function normalizeEquipmentKOutOfNForPath(path) {
  const match = String(path || "").match(/^components\.(\d+)\.quantity$/);
  if (!match) return;
  const component = scenario.components[Number(match[1])];
  if (!component) return;
  const quantity = Math.max(0, Math.trunc(Number(component.quantity) || 0));
  const bounded = quantity > 1 ? clamp(Math.trunc(Number(component.kOutOfN?.k) || 1), 1, quantity) : 0;
  component.quantity = quantity;
  component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1 && bounded > 0, n: quantity, k: bounded };
}

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
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
