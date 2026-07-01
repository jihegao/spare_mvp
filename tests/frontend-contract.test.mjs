import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "../front/feature-catalog.mjs";
import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject
} from "../front/rms-allocation-engine.mjs";
import { renderRmsAllocationWorkbench } from "../front/rms-allocation-workbench.mjs";

const PAGE_REVISION_REPORT_URL = new URL("../reports/2026-06-19-page-revision-suggestions/README.md", import.meta.url);
const RBD_RENDERING_CONTRACT_URL = new URL("../docs/reliability-block-diagram-contract.md", import.meta.url);

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 49);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 49);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 21);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 22);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "系统运行支持模块").length, 6);
  for (const label of ["装备系统建模", "装备可靠性框图建模", "飞机转场携行清单分析", "任务可靠度评估", "停机因素分析", "建模表单管理"]) {
    assert.ok(FEATURE_PAGES.some((page) => page.name === label), label);
  }
  assert.equal(FEATURE_PAGES.some((page) => page.name === "蒙特卡洛实验结果"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "装备组成建模"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "装备故障建模"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.module === "系统管理"), false);
  assert.deepEqual(
    FEATURE_PAGES.filter((page) => page.name === "装备可靠性框图建模").map((page) => page.module),
    ["任务可靠度评估模块"]
  );
});

test("each feature page has page template metadata for grouped entry pages", () => {
  for (const page of FEATURE_PAGES) {
    assert.ok(page.id);
    assert.ok(page.module);
    assert.ok(page.secondary);
    assert.ok(page.tertiary);
    assert.ok(page.name);
    assert.ok(page.component);
    assert.ok(page.dataObjects.length > 0, page.id);
    assert.equal("ontology" in page, false, page.id);
    assert.equal("outputs" in page, false, page.id);
  }
});

test("feature grouping preserves three-level navigation and internal fourth-level entries", () => {
  const grouped = groupFeaturePages(FEATURE_PAGES);
  assert.deepEqual(Object.keys(grouped), ["系统运行支持模块", "备件规划评估模块", "任务可靠度评估模块"]);
  assert.deepEqual(Object.keys(grouped["系统运行支持模块"]), ["项目管理", "装备RMS指标分配", "系统基础配置"]);
  assert.deepEqual(grouped["系统运行支持模块"]["项目管理"]["项目数据管理"].map((page) => page.name), ["项目数据管理"]);
  assert.deepEqual(grouped["系统运行支持模块"]["项目管理"]["建模颗粒度管理"].map((page) => page.name), ["建模颗粒度管理"]);
  assert.equal("建模数据导入" in grouped["系统运行支持模块"]["项目管理"], false);
  assert.deepEqual(grouped["系统运行支持模块"]["系统基础配置"]["用户管理"].map((page) => page.name), ["用户管理"]);
  assert.deepEqual(grouped["系统运行支持模块"]["系统基础配置"]["系统功能权限管理"].map((page) => page.name), ["系统功能权限管理"]);
  assert.deepEqual(grouped["系统运行支持模块"]["系统基础配置"]["建模表单管理"].map((page) => page.name), ["建模表单管理"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["仿真建模"]).slice(0, 2), ["装备系统建模", "装备任务建模"]);
  assert.deepEqual(Object.keys(grouped["任务可靠度评估模块"]["仿真建模"]).slice(0, 2), ["装备系统建模", "装备任务建模"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真建模"]["装备系统建模"].map((page) => page.name), ["装备系统建模"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真建模"]["装备系统建模"].map((page) => page.name), ["装备系统建模", "装备可靠性框图建模"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真建模"]["装备任务建模"].map((page) => page.name), [
    "基本任务建模",
    "复合任务建模",
    "周期性任务建模",
    "基本作战单元建模"
  ]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真建模"]["装备任务建模"].map((page) => page.name), [
    "基本任务建模",
    "复合任务建模",
    "周期性任务建模",
    "基本作战单元建模"
  ]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真建模"]["保障活动建模"].map((page) => page.name), [
    "基本保障活动建模",
    "使用保障活动建模",
    "预防性维修活动建模",
    "修复性维修活动建模",
    "后勤保障活动建模"
  ]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真建模"]["保障活动建模"].map((page) => page.name), [
    "基本保障活动建模",
    "使用保障活动建模",
    "预防性维修活动建模",
    "修复性维修活动建模",
    "后勤保障活动建模"
  ]);
  assert.equal("指标分配方案管理" in grouped["备件规划评估模块"]["仿真建模"], false);
  assert.equal(FEATURE_PAGES.some((page) => page.secondary === "仿真建模" && page.tertiary === "指标分配方案管理"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.id === "spare-planning-result-import"), false);
  assert.ok(grouped["任务可靠度评估模块"]["仿真建模"]["装备系统建模"].some((page) => page.name === "装备可靠性框图建模"));
  assert.deepEqual(grouped["系统运行支持模块"]["装备RMS指标分配"]["装备RMS指标分配"].map((page) => page.name), ["装备RMS指标分配"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["仿真实验方案管理"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["仿真实验方案管理"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["可视化实验启动与停止"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["可视化实验启动与停止"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["蒙特卡洛实验"].map((page) => page.name), ["实验列表", "添加/编辑实验", "实验详情"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["蒙特卡洛实验"].map((page) => page.name), ["实验列表", "添加/编辑实验", "实验详情"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["结果分析"]), ["备件短板分析", "飞机转场携行清单分析"]);
  assert.deepEqual(grouped["备件规划评估模块"]["结果分析"]["备件短板分析"].map((page) => page.name), ["备件短板分析"]);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案创建"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案编辑"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "场景切换"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "可视化结果展示"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "任务剖面建模"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "保障资源需求组"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "装备使用保障方案"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "装备预防性维修方案"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "装备修复性维修方案"), false);
  assert.equal(getFeaturePageById("spare-planning-experiment-create").name, "仿真实验方案管理");
  assert.equal(getFeaturePageById("spare-planning-experiment-edit").name, "仿真实验方案管理");
  assert.equal(getFeaturePageById("mission-reliability-experiment-create").name, "仿真实验方案管理");
  assert.equal(getFeaturePageById("mission-reliability-experiment-edit").name, "仿真实验方案管理");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-config").name, "添加/编辑实验");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-config").name, "添加/编辑实验");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-results").id, "spare-planning-monte-carlo-experiment-list");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-results-display").id, "spare-planning-monte-carlo-experiment-list");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-results").id, "mission-reliability-monte-carlo-experiment-list");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-results-display").id, "mission-reliability-monte-carlo-experiment-list");
  assert.equal(getFeaturePageById("spare-planning-scenario-switch").component, "visual-simulation");
  assert.equal(getFeaturePageById("spare-planning-visual-results").component, "visual-simulation");
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
  assert.equal(getFeaturePageById("system-management-project-data-management").component, "system-project-management");
  assert.equal(getFeaturePageById("system-management-modeling-granularity-management").component, "system-project-management");
  assert.equal(getFeaturePageById("system-management-user-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-function-permission-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-modeling-form-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-equipment-rms-allocation").component, "rms-allocation");
  assert.equal(getFeaturePageById("spare-planning-equipment-composition").id, "spare-planning-equipment-system");
  assert.equal(getFeaturePageById("spare-planning-equipment-failure").id, "spare-planning-equipment-system");
  assert.equal(getFeaturePageById("mission-reliability-equipment-composition").id, "mission-reliability-equipment-system");
  assert.equal(getFeaturePageById("mission-reliability-equipment-failure").id, "mission-reliability-equipment-system");
  assert.equal(getFeaturePageById("mission-reliability-rms-allocation").id, "system-management-equipment-rms-allocation");
});

test("system support project management removes standalone modeling import route but keeps local import actions", async () => {
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.doesNotMatch(catalogSource, /建模数据导入/);
  assert.doesNotMatch(catalogSource, /modeling-import-workbench/);
  assert.match(appSource, /function renderMainComponent/);
  assert.match(appSource, /function renderLocalModelingImportActions/);
  assert.match(appSource, /data-modeling-import-action="load-fixture"/);
  assert.match(appSource, /data-modeling-import-action="validate"/);
  assert.match(appSource, /data-modeling-import-action="save-draft"/);
  assert.doesNotMatch(appSource, /renderModelingImportWorkbench/);
  assert.equal(FEATURE_PAGES.some((page) => page.id === "system-management-modeling-import-workbench"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.id === "system-management-modeling-form-management"), true);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "建模表单管理"), true);
  assert.match(appSource, /function renderModelingFormManagementConfig/);
  assert.match(appSource, /data-modeling-form-management/);
});

test("page revision report is archived under reports with its screenshot evidence", async () => {
  const reviewSource = await readFile(PAGE_REVISION_REPORT_URL, "utf8");

  assert.match(reviewSource, /2026-06-20 决策/);
  assert.match(reviewSource, /image\/页面修改建议260619\/1781929442367\.png/);
  assert.match(reviewSource, /image\/页面修改建议260619\/1781931686346\.png/);
  assert.match(reviewSource, /项目列表页/);
  assert.match(reviewSource, /系统管理 \/ 项目管理 \/ 数据管理/);
  assert.match(reviewSource, /仿真建模 \/ 装备系统建模/);
  assert.match(reviewSource, /仿真建模 \/ 保障组织建模 \/ 备件建模/);
});

test("experiment plan management remains visible because it is source design scope", async () => {
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const sourceRows = catalogSource.slice(
    catalogSource.indexOf("const SOURCE_ROWS"),
    catalogSource.indexOf("export const FEATURE_PAGES")
  );

  assert.match(catalogSource, /仿真实验方案管理/);
  assert.match(catalogSource, /experiment-plan-management/);
  assert.doesNotMatch(sourceRows, /experiment-plan-list/);
  assert.doesNotMatch(sourceRows, /experiment-plan-editor/);
  assert.match(appSource, /function renderExperimentPlanList/);
  assert.match(appSource, /function renderExperimentPlanEditor/);
});

test("experiment plan list keeps selection with backend row actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const listSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanList"),
    appSource.indexOf("function renderExperimentPlanEditor")
  );

  assert.match(listSource, /data-experiment-plan-select/);
  assert.match(listSource, /selected-table-row/);
  assert.match(listSource, /data-experiment-plan-edit/);
  assert.match(listSource, /<th>所属模块<\/th>/);
  assert.match(listSource, /<th>关联运行<\/th>/);
  assert.match(listSource, /experimentPlanRowFromBackend/);
  assert.match(listSource, /run_count/);
  assert.match(listSource, /data-experiment-plan-delete="\$\{htmlEscape\(plan\.experiment_plan_id\)\}"/);
});

test("modeling pages expose project draft persistence without replacing experiment plans", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /data-project-draft-save/);
  assert.match(appSource, /function saveCurrentProjectDraftThroughApi/);
  assert.match(appSource, /function hydrateCurrentProjectDraftFromApi/);
  assert.match(appSource, /projectDraftSaveStatus/);
  assert.match(appSource, /data-save-plan/);
});

test("frontend business authoring pages do not hydrate missing imported data from static constants", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const sourceSlice = (startMarker, endMarker) => {
    const start = appSource.indexOf(startMarker);
    const end = appSource.indexOf(endMarker);
    assert.notEqual(start, -1, `${startMarker} marker exists`);
    assert.notEqual(end, -1, `${endMarker} marker exists`);
    assert.ok(end > start, `${startMarker} appears before ${endMarker}`);
    return appSource.slice(start, end);
  };
  const staticSeedSource = sourceSlice("const PROJECT_SOURCE", "let scenario =");
  const renderSlices = [
    sourceSlice("function renderEquipmentModeling", "function renderReliabilityBlockDiagram"),
    sourceSlice("function renderBasicMissionModeling", "function missionPhaseRatioTotal"),
    sourceSlice("function renderSupportOrganizationWorkbench", "function renderOrgTreeNode"),
    sourceSlice("function renderSupportActivityWorkbench", "function renderSupportActivityTreeNode"),
    sourceSlice("function renderExperimentPlanList", "function renderExperimentPlanEditor"),
    sourceSlice("function renderMonteCarloExperimentList", "function renderMonteCarloExperimentEditor")
  ].join("\n");

  assert.doesNotMatch(staticSeedSource, /const SUPPORT_ORG_TREE|const SUPPORT_ACTIVITY_PLANS|const MISSION_|const SUPPORT_/);
  assert.match(renderSlices, /导入|创建|暂无|空/);
  assert.doesNotMatch(renderSlices, /SUPPORT_ORG_TREE|SUPPORT_ACTIVITY_PLANS|CARRY_OBJECTIVES/);
});

test("equipment task modeling omits built-in scenario and task profile parameter pages", async () => {
  assert.equal(FEATURE_PAGES.some((page) => page.secondary === "仿真建模" && page.name === "内置场景"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.secondary === "仿真建模" && page.name === "任务剖面参数"), false);

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /if \(page\.name === "任务剖面参数"\) return renderMissionProfileParameters\(page\)/);
  assert.match(appSource, /function renderMissionProfileParameters\(page\)/);
  assert.match(appSource, /field\("任务类型", "missionProfile\.profileType"\)/);
  assert.match(appSource, /field\("重复周期", "missionProfile\.repeatCycleHours", "number"\)/);
  assert.match(appSource, /field\("结束条件", "missionProfile\.endCondition"\)/);
});

test("support organization fourth-level tab ids resolve to distinct resource pages", () => {
  const expectedPages = [
    ["spare-planning-support-organization", "保障组织结构建模"],
    ["spare-planning-spare-part", "备件建模"],
    ["spare-planning-support-personnel", "保障人员建模"],
    ["spare-planning-support-equipment", "保障设备建模"],
    ["mission-reliability-support-organization", "保障组织结构建模"],
    ["mission-reliability-spare-part", "备件建模"],
    ["mission-reliability-support-personnel", "保障人员建模"],
    ["mission-reliability-support-equipment", "保障设备建模"]
  ];

  for (const [id, name] of expectedPages) {
    const page = getFeaturePageById(id);
    assert.equal(page.id, id);
    assert.equal(page.name, name);
    assert.equal(page.tertiary, "保障组织建模");
    assert.equal(page.component, "resource-table");
  }
});

test("equipment system modeling is the post-project landing page and plan name links back to plan list", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const DEFAULT_FEATURE_ID = "spare-planning-equipment-system"/);
  assert.equal(getFeaturePageById("spare-planning-equipment-system").module, "备件规划评估模块");
  assert.equal(getFeaturePageById("spare-planning-equipment-system").secondary, "仿真建模");
  assert.equal(getFeaturePageById("spare-planning-equipment-system").tertiary, "装备系统建模");
  assert.equal(getFeaturePageById("spare-planning-equipment-system").name, "装备系统建模");
  assert.match(appSource, /const DEFAULT_ROUTE = "login"/);
  assert.match(appSource, /function renderLoginPage/);
  assert.match(appSource, /function renderProjectListPage/);
  assert.match(appSource, /selectedRoute = readRouteFromHash\(\) \|\| DEFAULT_ROUTE/);
  assert.match(appSource, /selectedRoute = "projects"/);
  assert.match(appSource, /data-enter-workbench/);
  assert.match(appSource, /selectedFeatureId = readFeatureIdFromHash\(\) \|\| DEFAULT_FEATURE_ID/);
  assert.match(appSource, /data-plan-list-link/);
  assert.match(appSource, /location\.hash = `feature=\$\{getPlanListFeatureId\(page\.module\)\}`/);
  assert.match(appSource, /function renderExperimentPlanList/);
  assert.match(appSource, /function renderExperimentPlanEditor/);
  assert.match(appSource, /data-project-menu-toggle/);
  assert.match(appSource, /htmlEscape\(currentProject\?\.name \|\| "未选择项目"\)/);
  assert.match(appSource, /返回项目列表/);
  assert.match(appSource, /data-project-list/);
  assert.doesNotMatch(appSource, /<button type="button" data-project-list>项目列表<\/button>/);
  assert.match(styleSource, /\.project-menu/);
  assert.match(styleSource, /\.project-menu-panel/);
});

test("page revision project and system management controls stay wired", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const projectListSource = appSource.slice(
    appSource.indexOf("function renderProjectListPage"),
    appSource.indexOf("function renderNavigation")
  );
  const systemProjectSource = appSource.slice(
    appSource.indexOf("function renderSystemProjectManagement"),
    appSource.indexOf("function renderSystemBasicConfig")
  );
  const projectDataSource = appSource.slice(
    appSource.indexOf("function renderProjectDataTable"),
    appSource.indexOf("function renderModelingGranularityTable")
  );
  const userSource = appSource.slice(
    appSource.indexOf("function renderUserManagementConfig"),
    appSource.indexOf("function renderPermissionManagementConfig")
  );
  const permissionSource = appSource.slice(
    appSource.indexOf("function renderPermissionManagementConfig"),
    appSource.indexOf("function renderTaskModel")
  );
  const granularitySource = appSource.slice(
    appSource.indexOf("function renderModelingGranularityTable"),
    appSource.indexOf("function activeSystemDataDefinition")
  );
  const eventSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("async function handleLogin")
  );

  assert.match(projectListSource, /data-project-add/);
  assert.match(projectListSource, /data-project-edit/);
  assert.match(projectListSource, /data-project-delete/);
  assert.match(projectListSource, /data-project-import/);
  assert.match(projectListSource, /data-project-export/);
  assert.match(projectListSource, /data-system-management-entry/);
  assert.doesNotMatch(projectListSource, /进入当前项目/);

  assert.match(systemProjectSource, /MODELING_DATA_MODULES/);
  assert.match(appSource, /装备系统/);
  assert.match(appSource, /装备任务/);
  assert.match(appSource, /保障组织/);
  assert.match(appSource, /保障活动/);
  assert.match(systemProjectSource, /renderLocalModelingImportActions/);
  assert.doesNotMatch(systemProjectSource, /项目独有数据/);
  assert.doesNotMatch(systemProjectSource, /新增项目数据/);
  assert.doesNotMatch(projectDataSource, /<aside class="tree-container">/);
  assert.match(systemProjectSource, /data-system-data-export/);
  assert.match(systemProjectSource, /data-system-data-select-all/);
  assert.match(systemProjectSource, /data-system-data-module-select/);
  assert.match(systemProjectSource, /data-system-data-select/);
  assert.match(systemProjectSource, /data-system-data-status/);
  assert.match(systemProjectSource, /data-system-data-export-preview/);
  assert.match(systemProjectSource, /data-modeling-import-action="load-fixture"/);
  assert.match(systemProjectSource, /data-modeling-import-action="validate"/);
  assert.match(granularitySource, /function renderModelingGranularityTable/);
  assert.doesNotMatch(granularitySource, /tree-container/);
  assert.doesNotMatch(granularitySource, /class=\"tree-container\"/);
  assert.doesNotMatch(granularitySource, /<button type=\"button\" class=\"btn-primary\">新增<\/button>/);
  assert.doesNotMatch(granularitySource, /<button type=\"button\" class=\"btn-danger\">批量删除<\/button>/);
  assert.match(granularitySource, /data-modeling-field-sheet-select/);
  assert.match(granularitySource, /data-modeling-field-select/);
  assert.match(granularitySource, /field-checkbox-grid/);
  assert.doesNotMatch(granularitySource, /<th>建模层级<\/th>/);
  assert.doesNotMatch(granularitySource, /<th>建模对象<\/th>/);
  assert.doesNotMatch(granularitySource, /<th>对象关系<\/th>/);
  assert.doesNotMatch(granularitySource, /<th>操作<\/th>/);
  assert.doesNotMatch(projectDataSource, /<th>操作<\/th>/);
  assert.doesNotMatch(projectDataSource, />配置<\/button>/);
  assert.match(eventSource, /const systemDataSelectAll = event\.target\.closest\("\[data-system-data-select-all\]"\)/);
  assert.match(eventSource, /const systemDataModuleSelect = event\.target\.closest\("\[data-system-data-module-select\]"\)/);
  assert.match(eventSource, /const systemDataSelect = event\.target\.closest\("\[data-system-data-select\]"\)/);
  assert.match(eventSource, /const modelingFieldSheetSelect = event\.target\.closest\("\[data-modeling-field-sheet-select\]"\)/);
  assert.match(eventSource, /const modelingFieldSelect = event\.target\.closest\("\[data-modeling-field-select\]"\)/);
  assert.match(eventSource, /const importProjectButton = event\.target\.closest\("\[data-project-import\]"\)/);
  assert.match(eventSource, /const exportProjectButton = event\.target\.closest\("\[data-project-export\]"\)/);

  assert.match(userSource, /data-system-user-select-all/);
  assert.match(userSource, /data-system-user-select/);
  assert.match(userSource, /data-system-user-delete/);
  assert.doesNotMatch(userSource, /User is not allowed to perform this action/);

  assert.match(permissionSource, /data-permission-configure/);
  assert.match(permissionSource, /renderPermissionConfigEditor/);
  assert.match(permissionSource, /data-permission-role/);
  assert.match(eventSource, /const systemManagementButton = event\.target\.closest\("\[data-system-management-entry\]"\)/);
  assert.match(eventSource, /const permissionConfigureButton = event\.target\.closest\("\[data-permission-configure\]"\)/);
});

test("project data management exposes modeling sheet selection and local import actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const systemProjectSource = appSource.slice(
    appSource.indexOf("function renderSystemProjectManagement"),
    appSource.indexOf("function renderSystemBasicConfig")
  );
  const projectDataSource = appSource.slice(
    appSource.indexOf("function renderProjectDataTable"),
    appSource.indexOf("function renderModelingGranularityTable")
  );
  const eventSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("async function handleLogin")
  );
  const dataActionSource = appSource.slice(
    appSource.indexOf("function activeSystemDataDefinition"),
    appSource.indexOf("function renderSystemBasicConfig")
  );

  for (const label of ["装备系统", "装备任务", "保障组织", "保障活动"]) {
    assert.match(appSource, new RegExp(label));
  }

  assert.doesNotMatch(systemProjectSource, /项目独有数据/);
  assert.doesNotMatch(systemProjectSource, /新增项目数据/);
  assert.doesNotMatch(systemProjectSource, /仿真建模数据表 sheet 选择器/);
  assert.match(systemProjectSource, /项目数据管理配置/);
  assert.match(projectDataSource, /data-project-data-config-module="modeling-data-source"/);
  assert.match(projectDataSource, /data-project-data-config-module="modeling-import-publish"/);
  assert.match(systemProjectSource, /data-system-config-save/);
  assert.match(systemProjectSource, /data-modeling-import-action="load-fixture"/);
  assert.match(systemProjectSource, /data-modeling-import-action="backfill-current-project"/);
  assert.match(systemProjectSource, /data-modeling-import-action="validate"/);
  assert.match(systemProjectSource, /data-modeling-import-action="save-draft"/);
  assert.match(projectDataSource, /data-system-data-export/);
  assert.match(projectDataSource, /data-system-data-select-all/);
  assert.match(systemProjectSource, /data-system-data-module-select/);
  assert.match(systemProjectSource, /data-system-data-select="\$\{htmlEscape\(sheet\.key\)\}"/);
  assert.match(projectDataSource, /data-system-data-status/);
  assert.match(projectDataSource, /data-system-data-export-preview/);
  assert.doesNotMatch(projectDataSource, /<th>操作<\/th>/);
  assert.doesNotMatch(projectDataSource, />配置<\/button>/);

  assert.match(eventSource, /const systemDataExportButton = event\.target\.closest\("\[data-system-data-export\]"\)/);
  assert.match(eventSource, /const systemDataSelectAll = event\.target\.closest\("\[data-system-data-select-all\]"\)/);
  assert.match(eventSource, /const systemDataModuleSelect = event\.target\.closest\("\[data-system-data-module-select\]"\)/);
  assert.match(eventSource, /const systemDataSelect = event\.target\.closest\("\[data-system-data-select\]"\)/);
  assert.match(dataActionSource, /systemDataExportPreview = \{/);
  assert.match(dataActionSource, /rowCount: rows\.length/);
  assert.match(dataActionSource, /filename: systemDataExportFilename\(tab\)/);
  assert.match(dataActionSource, /downloadSystemDataExport\(systemDataExportPreview\.filename,/);
  assert.match(dataActionSource, /selectedSystemDataKeys\.has\(row\.key\)/);
  assert.match(dataActionSource, /function systemDataExportFilename\(tab\)/);
  assert.match(dataActionSource, /function buildSystemDataExportPayload\(tab, rows\)/);
  assert.match(dataActionSource, /function downloadSystemDataExport\(filename, payload\)/);
  assert.match(dataActionSource, /new Blob\(\[JSON\.stringify\(payload, null, 2\)\]/);
  assert.match(dataActionSource, /URL\.createObjectURL\(blob\)/);
  assert.match(dataActionSource, /anchor\.download = filename/);
  assert.match(dataActionSource, /anchor\.click\(\)/);
  assert.match(dataActionSource, /URL\.revokeObjectURL\(url\)/);
  assert.match(projectDataSource, /data-system-data-export-filename/);
});

test("project list edit action opens a usable inline editor", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const projectListSource = appSource.slice(
    appSource.indexOf("function renderProjectListPage"),
    appSource.indexOf("function renderNavigation")
  );
  const clickSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("app.addEventListener(\"change\"")
  );
  const inputSource = appSource.slice(
    appSource.indexOf("app.addEventListener(\"input\""),
    appSource.indexOf("async function saveCurrentProjectThroughApi")
  );
  const editSource = appSource.slice(
    appSource.indexOf("function editDemoProject"),
    appSource.indexOf("function deleteDemoProject")
  );

  assert.match(projectListSource, /projectEditorDraft/);
  assert.match(projectListSource, /data-project-edit-form/);
  assert.match(projectListSource, /data-project-edit-field="name"/);
  assert.match(projectListSource, /data-project-edit-field="baseCode"/);
  assert.match(projectListSource, /data-project-edit-field="summary"/);
  assert.match(projectListSource, /data-project-edit-save/);
  assert.match(projectListSource, /data-project-edit-cancel/);
  assert.match(clickSource, /const saveProjectEditButton = event\.target\.closest\("\[data-project-edit-save\]"\)/);
  assert.match(clickSource, /const cancelProjectEditButton = event\.target\.closest\("\[data-project-edit-cancel\]"\)/);
  assert.match(inputSource, /const projectEditInput = event\.target\.closest\("\[data-project-edit-field\]"\)/);
  assert.match(editSource, /projectEditorDraft\s*=/);
  assert.doesNotMatch(editSource, /name: project\.name\.endsWith\("（编辑）"\)/);
});

test("project list imports and exports project JSON while keeping existing card actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const projectListSource = appSource.slice(
    appSource.indexOf("function renderProjectListPage"),
    appSource.indexOf("function renderNavigation")
  );
  const clickSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("app.addEventListener(\"change\"")
  );
  const ioSource = appSource.slice(
    appSource.indexOf("function openProjectJsonImportPicker"),
    appSource.indexOf("async function flushPendingProjectDraftAutosave")
  );
  const hydrateSource = appSource.slice(
    appSource.indexOf("async function hydrateCurrentProjectDraftFromApi"),
    appSource.indexOf("async function saveCurrentProjectDraftThroughApi")
  );

  for (const selector of [
    "data-enter-workbench",
    "data-project-edit",
    "data-project-delete",
    "data-project-import",
    "data-project-export"
  ]) {
    assert.match(projectListSource, new RegExp(selector));
  }
  assert.match(clickSource, /openProjectJsonImportPicker\(importProjectButton\.dataset\.projectImport\)/);
  assert.match(clickSource, /exportProjectJson\(exportProjectButton\.dataset\.projectExport\)/);
  assert.match(ioSource, /input\.accept = "application\/json,\.json"/);
  assert.match(ioSource, /input\.dataset\.projectImportFile/);
  assert.match(ioSource, /JSON\.parse\(await file\.text\(\)\)/);
  assert.match(ioSource, /validateImportedProjectJson\(projectJson\)/);
  assert.match(ioSource, /persistManualProjectJsonDraft\(project\.id, normalizedProjectJson\)/);
  assert.match(ioSource, /resolveProjectJsonForExport\(project\)/);
  assert.match(ioSource, /downloadProjectJsonExport\(filename, projectJson\)/);
  assert.match(ioSource, /new Blob\(\[JSON\.stringify\(projectJson, null, 2\)\]/);
  assert.match(ioSource, /buildBackendProjectJson\(projectJson, project\)/);
  assert.match(hydrateSource, /readManualProjectJsonDraft\(currentProject\?\.id\)/);
  assert.match(styleSource, /\.project-card-foot \.compact-actions[\s\S]*flex-wrap: wrap/);
});

test("results analysis pages are rendered as four dedicated ship-front aligned dashboards", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderSpareShortfallAnalysis/);
  assert.match(appSource, /function renderCarryListAnalysis/);
  assert.match(appSource, /function renderTaskReliabilityAnalysis/);
  assert.match(appSource, /function renderDowntimeFactorAnalysis/);
  assert.match(appSource, /class="analysis-dashboard"/);
  assert.match(appSource, /class="analysis-filter-bar"/);
  assert.match(appSource, /class="analysis-chart-panel"/);
  assert.match(appSource, /class="decision-support-card"/);
  assert.match(appSource, /备件需求量降序/);
  assert.match(appSource, /携行清单迭代建议/);
  assert.match(appSource, /任务可靠度指标分解/);
  assert.match(appSource, /停机贡献因素排序/);
});

test("empty-shell result analysis renders configuration guidance instead of synthetic preview rows", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const spareSource = appSource.slice(
    appSource.indexOf("function renderSpareShortfallAnalysis"),
    appSource.indexOf("function renderCarryListAnalysis")
  );
  const carrySource = appSource.slice(
    appSource.indexOf("function renderCarryListAnalysis"),
    appSource.indexOf("function carryPriority")
  );
  const reliabilitySource = appSource.slice(
    appSource.indexOf("function renderTaskReliabilityAnalysis"),
    appSource.indexOf("function renderDowntimeFactorAnalysis")
  );
  const downtimeSource = appSource.slice(
    appSource.indexOf("function renderDowntimeFactorAnalysis"),
    appSource.indexOf("function analysisTypeForPage")
  );

  for (const source of [spareSource, carrySource]) {
    assert.match(source, /hasPreviewAnalysisData\(\)/);
    assert.match(source, /renderAnalysisEmptyState/);
    assert.match(source, /暂无分析数据，请先导入并发布建模 JSON，或创建并运行 Monte Carlo 分析任务。/);
    assert.doesNotMatch(source, /Math\.min\(\.\.\.rows|Math\.max\(\.\.\.rows|Math\.max\(\.\.\.factors/);
    assert.doesNotMatch(source, /Infinity|-Infinity/);
  }
  assert.match(reliabilitySource, /任务可靠度页只显示正式 projection/);
  assert.match(reliabilitySource, /analysis_projection_mission_reliability/);
  assert.doesNotMatch(reliabilitySource, /singleResult\.timeline|Math\.min\(\.\.\.rows|Math\.max\(\.\.\.rows|Infinity|-Infinity/);
  assert.match(downtimeSource, /停机因素页只显示正式 projection/);
  assert.match(downtimeSource, /analysis_projection_downtime_factors/);
  assert.doesNotMatch(downtimeSource, /singleResult\.downtimeFactors|Math\.min\(\.\.\.rows|Math\.max\(\.\.\.rows|Math\.max\(\.\.\.factors|Infinity|-Infinity/);

  const carryEmptyBranch = carrySource.slice(
    carrySource.indexOf("if (!hasPreviewAnalysisData())"),
    carrySource.indexOf("const rows")
  );
  assert.ok(carryEmptyBranch.length > 0, "carry list analysis should guard empty preview data before building preview rows");
  assert.match(carryEmptyBranch, /renderAnalysisEmptyState\("飞机转场携行清单分析", "参数配置", "携行清单迭代建议"/);
  assert.doesNotMatch(carryEmptyBranch, /<table|<thead|携行清单说明|carryObjectiveOption|singleResult\.carryList/);
  assert.doesNotMatch(spareSource, /P2\/P3 类备件/);
  assert.doesNotMatch(reliabilitySource, /第 7 波|wave \* 12/);
  assert.doesNotMatch(downtimeSource, /无可用飞机", "4"|飞机故障", "5"|平均故障维修时间/);
});

test("M6.2 formal result boundary unlocks only compiler-provenanced analysis artifacts", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const formalBoundarySource = appSource.slice(
    appSource.indexOf("function formalAnalysisBoundary"),
    appSource.indexOf("function renderAnalysisDashboard")
  );
  const runTypeSource = formalBoundarySource.slice(
    formalBoundarySource.indexOf("const runTypeIsMonteCarlo"),
    formalBoundarySource.indexOf("const projectionArtifacts")
  );
  const baseArtifactSource = appSource.slice(
    appSource.indexOf("function monteCarloBaseArtifacts"),
    appSource.indexOf("function analysisProjectionArtifacts")
  );

  assert.match(appSource, /输入未通过 Scenario compiler/);
  assert.match(appSource, /本地预览，不是正式后端仿真结果/);
  assert.match(appSource, /缺少 compiler provenance/);
  assert.doesNotMatch(appSource, /const formalUnlocked = false/);
  assert.match(appSource, /backendRun\?\.simulation_experiment_base\?\.mapping_provenance/);
  assert.match(appSource, /analysisArtifacts\.length\s*>\s*0/);
  assert.match(appSource, /analysisArtifacts,/);
  assert.match(appSource, /function analysisProjectionArtifacts/);
  assert.match(appSource, /monteCarloBaseArtifacts\(\)\.length > 0/);
  assert.match(runTypeSource, /backendRun\?\.run_type === "monte_carlo"/);
  assert.doesNotMatch(runTypeSource, /linkedExperiment\?\.runType/);
  assert.doesNotMatch(runTypeSource, /monteCarloBaseArtifacts\(\)/);
  assert.match(baseArtifactSource, /artifactHasKind\(artifact,\s*"monte_carlo_base"\)/);
  assert.doesNotMatch(baseArtifactSource, /artifactText|artifactMatchesAny|includes\(/);
  assert.match(appSource, /spare_shortfall/);
  assert.match(appSource, /carry_list/);
  assert.match(appSource, /mission_reliability/);
  assert.match(appSource, /downtime_factors/);
});

test("project draft save failure does not mint offline savedProject identity", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const saveSource = appSource.slice(
    appSource.indexOf("async function saveCurrentProjectDraftThroughApi"),
    appSource.indexOf("async function saveCurrentExperimentPlanThroughApi")
  );
  const catchSource = saveSource.slice(saveSource.indexOf("} catch"));

  assert.match(saveSource, /backendApi\.saveProject\(projectJson\)/);
  assert.match(catchSource, /savedProject\s*=\s*null/);
  assert.match(catchSource, /保存失败/);
  assert.doesNotMatch(catchSource, /savedProject\s*=\s*\{/);
  assert.doesNotMatch(catchSource, /offline-demo/);
  assert.doesNotMatch(catchSource, /离线演示/);
});

test("mesa visualization escapes contract-provider fields before innerHTML insertion", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stageSource = appSource.slice(
    appSource.indexOf("function renderMesaStage"),
    appSource.indexOf("function renderMesaSidePanel")
  );
  const aircraftSource = appSource.slice(
    appSource.indexOf("function renderMesaAircraftPanel"),
    appSource.indexOf("function renderMesaSupportPanel")
  );
  const missionSource = appSource.slice(
    appSource.indexOf("function renderMissionScheduleRow"),
    appSource.indexOf("function renderMesaSupportPanel")
  );
  const supportSource = appSource.slice(
    appSource.indexOf("function renderMesaSupportPanel"),
    appSource.indexOf("function missionProgressWidth")
  );

  assert.match(stageSource, /mesaStateClass\(aircraft\.state\)/);
  assert.match(stageSource, /htmlEscape\(aircraft\.label\)/);
  assert.match(stageSource, /htmlEscape\(aircraft\.type\)/);
  assert.match(stageSource, /htmlEscape\(visualAircraftStateLabel\(aircraft\.state\)\)/);
  assert.match(stageSource, /htmlEscape\(row\.id\)/);
  assert.match(stageSource, /htmlEscape\(row\.statusLabel\)/);
  assert.match(stageSource, /assignedTailNumbers\.map\(\(tailNumber\) => htmlEscape\(tailNumber\)\)/);
  assert.doesNotMatch(stageSource, /\$\{aircraft\.state\}/);
  assert.doesNotMatch(stageSource, /\$\{aircraft\.label\}/);
  assert.doesNotMatch(stageSource, /\$\{mission\.status\}/);

  assert.match(aircraftSource, /htmlEscape\(aircraft\.label\)/);
  assert.match(aircraftSource, /htmlEscape\(aircraft\.type\)/);
  assert.match(aircraftSource, /htmlEscape\(selectedAircraft\.label\)/);
  assert.match(aircraftSource, /htmlEscape\(selectedAircraft\.failedLru/);
  assert.doesNotMatch(aircraftSource, /\$\{selectedAircraft\.label\}/);

  assert.match(missionSource, /htmlEscape\(row\.basicTaskName\)/);
  assert.match(missionSource, /htmlEscape\(row\.id\)/);
  assert.match(missionSource, /htmlEscape\(row\.dayIndex\)/);
  assert.match(missionSource, /assignedTailNumbers\.map/);
  assert.match(missionSource, /htmlEscape\(tailNumber\)/);
  assert.doesNotMatch(missionSource, /assignedTailNumbers\.join\(" \/ "\)/);

  assert.match(supportSource, /htmlEscape\(resource\.label\)/);
  assert.match(supportSource, /htmlEscape\(spare\.label\)/);
  assert.match(supportSource, /htmlEscape\(job\.tailNumber\)/);
  assert.match(supportSource, /htmlEscape\(job\.task\)/);
  assert.match(supportSource, /htmlEscape\(job\.state\)/);
  assert.match(supportSource, /htmlEscape\(event\.message\)/);
});

test("support organization and activity pages follow ship_front tree table editor structure", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderSupportOrganizationWorkbench/);
  assert.match(appSource, /function renderSupportActivityWorkbench/);
  assert.match(appSource, /class="organization-layout"/);
  assert.match(appSource, /class="tree-container"/);
  assert.match(appSource, /class="detail-panel"/);
  assert.match(appSource, /保障组织结构树/);
  assert.match(appSource, /data-select-support-org-node/);
  assert.match(appSource, /selectedSupportOrgNodeId/);
  assert.match(appSource, /function findSupportOrgTreeNode/);
  assert.match(appSource, /function flattenSupportOrgTreeNodes/);
  assert.match(appSource, /function supportOrganizationTree/);
  assert.match(appSource, /scenario\.supportOrganization\?\.tree/);
  assert.match(appSource, /function buildEmptySupportOrganizationTree/);
  assert.doesNotMatch(appSource, /基地级|基层级1|机务保障中队1|基层级2|机务保障中队2/);
  assert.match(appSource, /备件建模/);
  assert.match(appSource, /保障人员建模/);
  assert.match(appSource, /保障设备建模/);
  assert.doesNotMatch(appSource, /const SUPPORT_ACTIVITY_PLANS/);
  assert.doesNotMatch(appSource, /修复型维修活动建模/);
  assert.match(appSource, /function supportActivityPlanForPage/);
  assert.match(appSource, /importedDataEmptyState\("保障活动"\)/);
  assert.match(appSource, /renderSupportActivityTreeNode/);
  assert.doesNotMatch(appSource, /\u4fdd\u969c\u6d3b\u52a8\u8282\u70b9\u7f51\u7edc\u56fe/);

  const supportOrgSource = appSource.slice(
    appSource.indexOf("function renderSupportOrganizationWorkbench"),
    appSource.indexOf("function findSupportActivityForPage")
  );
  assert.doesNotMatch(supportOrgSource, /运输起点/);
  assert.doesNotMatch(supportOrgSource, /运输终点/);
  assert.doesNotMatch(supportOrgSource, /运输时间\(h\)/);
  assert.doesNotMatch(supportOrgSource, /保障层级/);
  assert.doesNotMatch(supportOrgSource, /保障策略/);
  assert.doesNotMatch(supportOrgSource, /横向保障组织/);
  assert.match(supportOrgSource, /const visibleResourceRows = buildSupportResourceRows\(activeResourceType, selectedSupportOrgNode\)/);
  assert.doesNotMatch(supportOrgSource, /if \(!orgTree\.length\)/);
  assert.match(supportOrgSource, /function buildSupportResourceRows/);
  assert.match(supportOrgSource, /scope: orgNode\.name/);
  assert.doesNotMatch(supportOrgSource, /scope: node\.name/);
  assert.match(supportOrgSource, /data-support-resource-select-all/);
  assert.match(supportOrgSource, /data-support-resource-select/);
  assert.match(supportOrgSource, /supportOrganizationSelect\(row\.key, row\.organizationNodeId, true\)/);
  assert.match(supportOrgSource, /data-support-resource-import-file/);
  assert.match(supportOrgSource, /function supportResourceDataCell/);
  assert.match(supportOrgSource, /children:\s*\(node\.children \|\| \[\]\)\.map\(\(child\) => orgTreeNode\(child, depth \+ 1\)\)/);
  assert.doesNotMatch(supportOrgSource, /children:\s*depth\s*>=\s*1\s*\?\s*\[\]/);
  assert.match(appSource, /function updateSupportResourceOverride/);
  assert.match(appSource, /scenario\.supportResourceOverrides/);
  assert.match(appSource, /scenario\.deletedSupportResourceKeys/);
  assert.doesNotMatch(supportOrgSource, /label: "所属型号"/);
  assert.doesNotMatch(appSource, /fieldDef\("ownerModel", "所属型号"/);
  assert.match(supportOrgSource, /所属装备/);
  assert.match(supportOrgSource, /function supportPersonnelSpecialtyOptions/);
  assert.doesNotMatch(appSource, /data-support-resource-aircraft/);
  assert.doesNotMatch(appSource, /data-support-resource-edit/);
  assert.doesNotMatch(supportOrgSource, /<th>资源类型<\/th>/);
  assert.doesNotMatch(supportOrgSource, /<td>\$\{row\.type\}<\/td>/);
  assert.match(supportOrgSource, /data-support-org-field="name"/);
  assert.match(supportOrgSource, /data-support-org-field="description"/);
  assert.match(supportOrgSource, /function supportOrgNodeDepth/);
  assert.match(supportOrgSource, /data-support-org-parent-display/);
  assert.doesNotMatch(supportOrgSource, /上级组织<input/);
  const operationsSource = appSource.slice(
    appSource.indexOf("function renderOperationsSupportActivity"),
    appSource.indexOf("function renderPreventiveMaintenanceActivity")
  );
  const supportActivitySource = appSource.slice(
    appSource.indexOf("function renderSupportActivityWorkbench"),
    appSource.indexOf("function renderSupportActivityTreeNode")
  );
  assert.match(appSource, /function ensureSupportActivityForPage\(page\)/);
  assert.match(supportActivitySource, /const activity = ensureSupportActivityForPage\(page\)/);
  assert.doesNotMatch(supportActivitySource, /if \(!activity && !page\.name\.includes\("基本保障活动"\)\)/);
  assert.doesNotMatch(supportActivitySource, /if \(!\(scenario\.supportActivities \|\| \[\]\)\.length\)/);
  assert.doesNotMatch(supportActivitySource, /飞行前准备|再次出动准备|飞行后检查|制动伞检查|日检|周检|发动机备件故障|航电模块故障/);
  assert.doesNotMatch(operationsSource, /\u4eff\u771f\u8fd0\u884c\u89c4\u5219/);
  assert.doesNotMatch(operationsSource, /\u52a0\u6cb9\u65b9\u6848/);
  assert.doesNotMatch(operationsSource, /\u6302\u8f7d\u65b9\u6848/);

  const logisticsSource = appSource.slice(
    appSource.indexOf("function renderLogisticsSupportActivity"),
    appSource.indexOf("function findLogisticsSupportActivity")
  );
  assert.match(logisticsSource, /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/);
  assert.match(logisticsSource, /\\u7b56\\u7565\\u540d\\u79f0/);
  assert.match(logisticsSource, /\\u7b56\\u7565\\u65b9\\u5411/);
  assert.match(logisticsSource, /\\u6a2a\\u5411\\u8fd0\\u8f93/);
  assert.match(logisticsSource, /\\u7eb5\\u5411\\u8fd0\\u8f93/);
  assert.match(logisticsSource, /\\u5907\\u4ef6\\u79cd\\u7c7b/);
  assert.match(logisticsSource, /\\u89e6\\u53d1\\u65b9\\u5f0f/);
  assert.match(logisticsSource, /\\u4e34\\u754c\\u5e93\\u5b58/);
  assert.match(logisticsSource, /\\u5468\\u671f\\u6027\\u8c03\\u8fd0/);
  assert.match(logisticsSource, /\\u89e6\\u53d1\\u53c2\\u6570/);
  assert.match(logisticsSource, /\\u4e34\\u754c\\u5e93\\u5b58\\u6570/);
  assert.match(logisticsSource, /\\u8c03\\u8fd0\\u5468\\u671f\(h\)/);
  assert.match(logisticsSource, /criticalInventory/);
  assert.match(logisticsSource, /transferCycleHours/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u8d77\\u70b9/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u7ec8\\u70b9/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u65f6\\u95f4\(h\)/);
  assert.match(logisticsSource, /spareModelingNames\(\)\.map/);
  assert.match(logisticsSource, /valueSelect/);
  assert.match(logisticsSource, /valueInput/);
  assert.match(logisticsSource, /valueInput\(`\$\{basePath\}\.name`, "text"\)/);
  assert.match(logisticsSource, /data-logistics-transport-select/);
  assert.match(logisticsSource, /data-logistics-transport-delete/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-delete="\$\{index\}"/);
  assert.doesNotMatch(logisticsSource, /\\u64cd\\u4f5c/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-edit/);
  assert.doesNotMatch(logisticsSource, /\u4fdd\u969c\u7ec4\u7ec7\u7b56\u7565\u8868/);
  assert.doesNotMatch(logisticsSource, /\u65b9\u6848\u7c7b\u578b/);
  assert.match(logisticsSource, /renderSupportActivityJobTable\(activity, "logistics"\)/);
});

test("modeling page headers omit generic scenario helper summaries", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /<p>\$\{htmlEscape\(page\.summary\)\}<\/p>/);
  assert.doesNotMatch(appSource, /围绕共享 scenario 数据提供编辑和实验查看能力/);
});

test("fourth-level pages do not repeat their own title inside the main panel", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /<h3>\$\{(?:htmlEscape\()?page\.name/);
  assert.doesNotMatch(appSource, /\$\{page\.name\}字段/);
  assert.doesNotMatch(appSource, /\$\{page\.name\}配置/);
});

test("support organization workbench does not render duplicate inner tabs", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const supportOrgSource = appSource.slice(
    appSource.indexOf("function renderSupportOrganizationWorkbench"),
    appSource.indexOf("function renderOrgTreeNode")
  );
  assert.doesNotMatch(supportOrgSource, /ship-front-tabs/);
  assert.doesNotMatch(supportOrgSource, /\["保障组织结构建模", "保障资源建模", "保障人员建模", "保障设备建模", "备件建模"\]/);
});

test("support organization fourth-level pages render matching resource panels", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const supportOrgSource = appSource.slice(
    appSource.indexOf("function renderSupportOrganizationWorkbench"),
    appSource.indexOf("function renderOrgTreeNode")
  );
  assert.match(supportOrgSource, /const activeResourceType =/);
  assert.match(supportOrgSource, /const visibleResourceRows = buildSupportResourceRows\(activeResourceType, selectedSupportOrgNode\)/);
  assert.match(supportOrgSource, /page\.name\.includes\("人员"\) \? "保障人员"/);
  assert.match(supportOrgSource, /page\.name\.includes\("设备"\) \? "保障设备"/);
  assert.match(supportOrgSource, /page\.name\.includes\("备件"\) \? "备件"/);
  assert.match(supportOrgSource, /data-support-resource-batch-delete/);
  assert.match(supportOrgSource, /data-support-resource-select-all/);
  assert.doesNotMatch(supportOrgSource, /data-support-resource-edit/);
  assert.match(supportOrgSource, /<h3>\$\{activeTab === "保障组织结构建模" \? "组织详情" : "资源清单"\}<\/h3>/);
});

test("support activity workbench does not render duplicate inner tabs", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const supportActivitySource = appSource.slice(
    appSource.indexOf("function renderSupportActivityWorkbench"),
    appSource.indexOf("function renderExperimentPlanList")
  );
  assert.doesNotMatch(supportActivitySource, /ship-front-tabs/);
});

test("support activity pages align to page suggestion activity fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const basicActivityResourceStyle = styleSource.slice(
    styleSource.indexOf(".basic-activity-resource-grid"),
    styleSource.indexOf(".basic-activity-resource-section")
  );
  const supportActivitySource = appSource.slice(
    appSource.indexOf("function findSupportActivityForPage"),
    appSource.indexOf("function renderExperimentPlanList")
  );
  for (const pattern of [
    /\u57fa\u672c\u4fdd\u969c\u6d3b\u52a8\u57fa\u7840\u5e93/,
    /\u65b9\u6848\u540d\u79f0/,
    /\u8ba1\u5212\u505c\u673a\u5c0f\u65f6/,
    /\u542f\u52a8\u65e5\u5386\u65f6\u95f4/,
    /\u88c5\u5907\u6784\u578b\u6811/,
    /MTTR/,
    /\u7ef4\u4fee\u7c7b\u578b/,
    /\u539f\u4f4d\u7ef4\u4fee/,
    /\u6362\u4ef6\u7ef4\u4fee/,
    /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/,
    /data-logistics-transport-add>\\u65b0\\u589e/,
    /\\u5907\\u4ef6\\u79cd\\u7c7b/,
    /\\u89e6\\u53d1\\u65b9\\u5f0f/
  ]) {
    assert.match(supportActivitySource, pattern);
  }
  assert.doesNotMatch(supportActivitySource, /\u6700\u5927\u5de5\u4f5c\u65f6\u95f4\u53c2\u8003\(min\)/);
  assert.doesNotMatch(supportActivitySource, /\u6700\u5927\u4fee\u590d\u65f6\u95f4\(min\)/);
  assert.match(supportActivitySource, /renderBasicActivityTemplatePicker/);
  assert.match(supportActivitySource, /applyBasicActivityToSupportActivityJob/);
  assert.match(supportActivitySource, /data-support-activity-template-query/);
  assert.doesNotMatch(supportActivitySource, /options\.slice\(0, 8\)/);
  assert.match(supportActivitySource, /renderBasicActivityLibrary/);
  assert.match(supportActivitySource, /renderOperationsSupportActivity/);
  assert.match(supportActivitySource, /renderPreventiveMaintenanceActivity/);
  assert.match(supportActivitySource, /renderCorrectiveMaintenanceActivity/);
  assert.match(supportActivitySource, /renderLogisticsSupportActivity/);
  assert.match(supportActivitySource, /renderSupportActivityJobTable\(activity, "logistics"\)/);
  assert.match(supportActivitySource, /const supportNodeOptions = \(scenario\.supportNodes \|\| \[\]\)\.map/);
  assert.match(supportActivitySource, /valueSelect\(`\$\{basePath\}\.from`, supportNodeOptions\)/);
  assert.match(supportActivitySource, /valueSelect\(`\$\{basePath\}\.to`, supportNodeOptions\)/);
  const supportActivityJobSource = supportActivitySource.slice(
    supportActivitySource.indexOf("function renderSupportActivityJobRows"),
    supportActivitySource.indexOf("function renderBasicActivityLibrary")
  );
  assert.match(supportActivityJobSource, /renderSupportActivityPredecessorCell/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-edit/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-dialog-close/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-add-template/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-toggle/);
  assert.match(supportActivityJobSource, /编辑紧前作业/);
  assert.doesNotMatch(supportActivityJobSource, /data-support-activity-predecessors/);
  assert.match(supportActivityJobSource, /data-support-activity-job-select/);
  assert.match(supportActivityJobSource, /data-support-activity-job-select-all/);
  assert.match(supportActivityJobSource, /data-support-activity-job-batch-delete/);
  assert.match(supportActivityJobSource, />编辑<\/button>/);
  assert.doesNotMatch(supportActivityJobSource, /data-support-activity-job-delete/);
  assert.doesNotMatch(supportActivityJobSource, /弹窗编辑|弹窗\/删除/);
  assert.match(supportActivityJobSource, /data-support-activity-job-field/);
  assert.match(supportActivityJobSource, /supportActivityJobDialogKey/);
  assert.match(supportActivityJobSource, /supportActivityPredecessorDialogKey/);
  assert.match(supportActivityJobSource, /renderSupportActivityJobDialog/);
  assert.match(supportActivityJobSource, /renderSupportActivityPredecessorDialog/);
  assert.match(supportActivityJobSource, /data-support-activity-job-dialog-close/);
  assert.match(supportActivityJobSource, /supportActivityJobBasicActivitySelect/);
  assert.match(supportActivityJobSource, /data-support-activity-job-template-select/);
  assert.match(supportActivityJobSource, /新增工作项目/);
  assert.doesNotMatch(supportActivityJobSource, /<th>保障人员<\/th><th>保障设备<\/th><th>备件<\/th>/);
  assert.doesNotMatch(supportActivityJobSource, /<label>保障人员/);
  assert.doesNotMatch(supportActivityJobSource, /<label>保障设备/);
  assert.doesNotMatch(supportActivityJobSource, /<label>备件/);
  assert.doesNotMatch(supportActivityJobSource, /\u5de5\u671f\u5206\u5e03\u6458\u8981/);
  assert.doesNotMatch(supportActivityJobSource, /\u5b50\u4f5c\u4e1a/);
  assert.doesNotMatch(supportActivityJobSource, /弹药|ammunition/);
  assert.match(supportActivityJobSource, /selectedSupportActivityJobKeys/);
  assert.match(supportActivitySource, /function toggleSupportActivityJobSelection/);
  assert.match(supportActivitySource, /function updateSupportActivityJobPredecessors/);
  assert.match(supportActivitySource, /function selectSupportActivityJobForEdit/);
  assert.match(supportActivitySource, /function deleteSelectedSupportActivityJobs/);
  assert.match(supportActivitySource, /function deleteSupportActivityJob/);
  assert.match(supportActivitySource, /data-support-activity-plan-add/);
  assert.match(supportActivitySource, /data-support-activity-plan-delete/);
  assert.match(supportActivitySource, /data-select-support-activity-plan/);
  assert.match(supportActivitySource, /新增节点/);
  assert.doesNotMatch(supportActivitySource, /operationSupportActivityTreeActions/);
  assert.doesNotMatch(supportActivitySource, /data-support-activity-plan-edit/);
  assert.doesNotMatch(supportActivitySource, /const phaseNames = \["飞行前准备", "再次出动准备", "飞行后检查"\]/);
  const basicActivityLibrarySource = supportActivitySource.slice(
    supportActivitySource.indexOf("function renderBasicActivityLibrary"),
    supportActivitySource.indexOf("function renderOperationsSupportActivity")
  );
  assert.match(basicActivityLibrarySource, /data-basic-activity-field/);
  assert.match(basicActivityLibrarySource, /basicActivityDialogKey/);
  assert.match(basicActivityLibrarySource, /data-basic-activity-dialog-close/);
  assert.match(basicActivityLibrarySource, /basic-activity-dialog/);
  assert.match(basicActivityLibrarySource, /renderBasicActivityResourceEditor/);
  assert.match(basicActivityLibrarySource, /renderBasicActivityPersonnelEditor/);
  assert.match(basicActivityLibrarySource, /renderBasicActivityEquipmentEditor/);
  assert.match(basicActivityLibrarySource, /renderBasicActivitySpareEditor/);
  assert.match(basicActivityLibrarySource, /renderBasicActivityResourceConfigDialog/);
  assert.match(basicActivityLibrarySource, /data-basic-activity-resource-dialog-open="\$\{htmlEscape\(resourceKind\)\}"/);
  assert.match(basicActivityLibrarySource, /data-basic-activity-resource-dialog-add/);
  assert.match(basicActivityLibrarySource, /data-basic-activity-resource-dialog-field/);
  assert.match(basicActivityLibrarySource, /updateBasicActivityResourceDialogField/);
  assert.match(basicActivityLibrarySource, /basicActivityResourceDialogTextInput/);
  assert.match(basicActivityLibrarySource, /\`\$\{resourceKind\}-models\`/);
  assert.match(basicActivityLibrarySource, /\`\$\{resourceKind\}-names\`/);
  assert.match(basicActivityLibrarySource, /buildSupportResourceRows\(resourceType, root\)/);
  assert.match(basicActivityLibrarySource, /personnelRequirements/);
  assert.match(basicActivityLibrarySource, /equipmentRequirements/);
  assert.match(basicActivityLibrarySource, /spareRequirements/);
  assert.match(basicActivityLibrarySource, /basicActivityInput/);
  assert.match(basicActivityLibrarySource, /basicActivitySelect/);
  assert.match(basicActivityLibrarySource, /basicActivityScopeSelect/);
  assert.match(basicActivityLibrarySource, /保障人员/);
  assert.match(basicActivityLibrarySource, /保障设备/);
  assert.match(basicActivityLibrarySource, /备件/);
  assert.match(basicActivityResourceStyle, /grid-template-columns: 1fr/);
  assert.doesNotMatch(basicActivityResourceStyle, /repeat\(3/);
  assert.doesNotMatch(basicActivityLibrarySource, /弹药|ammunition/);
  assert.doesNotMatch(basicActivityLibrarySource, /机务\/维修人员/);
  assert.doesNotMatch(basicActivityLibrarySource, /勤务人员/);
  assert.doesNotMatch(basicActivityLibrarySource, /保障\/维修设施/);
  assert.doesNotMatch(basicActivityLibrarySource, /保障\/维修设备/);
  assert.doesNotMatch(basicActivityLibrarySource, /row\.servicePersonnel/);
  assert.doesNotMatch(basicActivityLibrarySource, /row\.facility/);
  assert.match(supportActivitySource, /function spareModelingNames\(\)/);
  assert.match(supportActivitySource, /Object\.keys\(node\.inventory \|\| \{\}\)/);
  assert.doesNotMatch(supportActivitySource, /\u4f7f\u7528\u4fdd\u969c\u6d3b\u52a8\u540d\u79f0/);
  assert.doesNotMatch(supportActivitySource, /\u5e73\u5747\u4fee\u590d\u65f6\u95f4\(min\)/);
  assert.doesNotMatch(supportActivitySource, /\u7279\u6b8a\u4ea7\u54c1\u7ef4\u4fee\u65f6\u95f4\(min\)/);
  assert.doesNotMatch(supportActivitySource, /\u4eff\u771f\u8fd0\u884c\u89c4\u5219/);
  assert.doesNotMatch(supportActivitySource, /\u52a0\u6cb9\u65b9\u6848/);
  assert.doesNotMatch(supportActivitySource, /\u6302\u8f7d\u65b9\u6848/);
  assert.doesNotMatch(supportActivitySource, /\u4fdd\u969c\u6d3b\u52a8\u8282\u70b9\u7f51\u7edc\u56fe/);
});

test("equipment system modeling renders one tree plus flattened editable table", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  assert.match(appSource, /function renderEquipmentModeling\(page\)/);
  assert.doesNotMatch(appSource, /装备组成树/);
  assert.match(appSource, /装备结构树/);
  assert.match(appSource, /function wholeMachineModels\(\)/);
  assert.match(appSource, /scenario\.equipment\.wholeMachineModels/);
  assert.match(appSource, /装备系统建模表/);
  assert.match(appSource, /function renderEquipmentSystemTable\(selectedState\)/);
  assert.match(appSource, /selectedState\.kind === "aircraft-list"/);
  assert.match(appSource, /wholeMachineModels\(\)\.map\(\(model\) => renderEquipmentAircraftTableRow\(model, \{ editable: false \}\)\)/);
  assert.match(appSource, /class="equipment-system-table"/);
  assert.match(appSource, /<th>组件名称<\/th>/);
  assert.match(appSource, /<th>父节点<\/th>/);
  assert.match(appSource, /<th>数量n<\/th>/);
  assert.match(appSource, /组件属性/);
  assert.match(appSource, /k值（n中取k）/);
  assert.match(appSource, /MTBF-分布类型/);
  assert.match(appSource, /MTTR-分布类型/);
  assert.match(equipmentSource, /<th>MTBF-分布类型<\/th>\s*<th>MTBF参数<\/th>\s*<th>MTTR-分布类型<\/th>\s*<th>MTTR参数<\/th>/);
  assert.doesNotMatch(equipmentSource, /<th>MTBF<\/th>/);
  assert.doesNotMatch(equipmentSource, /<th>MTTR（min）<\/th>/);
  assert.match(appSource, /equipmentTableInput\("数量n", `components\.\$\{index\}\.quantity`, "number"/);
  assert.match(appSource, /data-equipment-k-out-of-n-index="\$\{selectedIndex\}"/);
  assert.doesNotMatch(appSource, /isFailurePage/);
  assert.doesNotMatch(appSource, /装备组成建模/);
  assert.doesNotMatch(appSource, /装备故障建模/);
  assert.doesNotMatch(appSource, /<thead><tr><th>组件<\/th><th>备件类型<\/th><th>故障模型<\/th><th>失效率<\/th><th>MTBF<\/th><th>连接类型<\/th><\/tr><\/thead>/);
});

test("equipment tree selection highlights the selected component row", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /let selectedEquipmentNodeKey = ""/);
  assert.match(appSource, /data-select-equipment-aircraft="\$\{htmlEscape\(model\)\}"/);
  assert.match(appSource, /data-select-equipment-component="\$\{htmlEscape\(component\.id\)\}"/);
  assert.match(appSource, /selectedEquipmentNodeKey = `aircraft:\$\{equipmentAircraftNode\.dataset\.selectEquipmentAircraft\}`/);
  assert.match(appSource, /selectedEquipmentNodeKey = `component:\$\{equipmentComponentNode\.dataset\.selectEquipmentComponent\}`/);
  assert.match(appSource, /function clampEquipmentComponentIndex\(index\)/);
  assert.match(appSource, /const selectedState = resolveSelectedEquipmentNode\(\)/);
  assert.match(appSource, /renderEquipmentSystemTable\(selectedState\)/);
  assert.match(appSource, /selectedState\.kind === "component"/);
  assert.match(appSource, /equipmentComponentsForSelectionModel\(\{ scenario, selection: selectedState \}\)/);
  assert.match(appSource, /selected \? "selected-table-row" : ""/);
  assert.match(appSource, /equipmentTableInput\("组件名称", `components\.\$\{index\}\.name`\)/);
});

test("equipment tree add node follows ship front selected aircraft and subsystem behavior", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentModelSource = await readFile(new URL("../front/equipment-tree-model.mjs", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  assert.match(equipmentSource, /data-equipment-add-node/);
  assert.match(equipmentSource, /function buildEquipmentTreeNodes\(\)/);
  assert.match(equipmentSource, /function buildEquipmentComponentTreeNodes\(aircraftModel, parentId\)/);
  assert.match(equipmentSource, /buildEquipmentComponentTreeModel\(\{ scenario, aircraftModel, parentId \}\)/);
  assert.match(equipmentModelSource, /const visitedIds = new Set\(visited\)/);
  assert.match(equipmentModelSource, /componentId !== String\(currentParentId\)/);
  assert.match(equipmentModelSource, /!visitedIds\.has\(componentId\)/);
  assert.match(appSource, /function addEquipmentNodeForSelection\(\)/);
  assert.match(appSource, /addEquipmentNodeForSelectionModel\(\{ scenario, selection: selectedState \}\)/);
  assert.match(equipmentModelSource, /parentId = selectedState\.kind === "aircraft" \? "aircraft-root" : selectedState\.component\.id/);
  assert.match(equipmentModelSource, /productType: selectedState\.kind === "aircraft" \? "非LRU" : "LRU"/);
  assert.match(equipmentModelSource, /selectedEquipmentNodeKey: `component:\$\{newComponent\.id\}`/);
});

test("equipment tree root aircraft list can add aircraft before subsystem nodes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentModelSource = await readFile(new URL("../front/equipment-tree-model.mjs", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  const resolveSource = equipmentModelSource.slice(
    equipmentModelSource.indexOf("export function resolveEquipmentSelectionModel"),
    equipmentModelSource.indexOf("export function addEquipmentNodeForSelectionModel")
  );
  const zeroAircraftIndex = resolveSource.indexOf("if (!models.length) return { kind: \"aircraft-list\" };");
  const componentFallbackIndex = resolveSource.indexOf("const componentIndex = clampIndex");

  assert.match(equipmentSource, /label: "飞机列表"/);
  assert.match(equipmentSource, /data-select-equipment-root/);
  assert.match(appSource, /selectedEquipmentNodeKey = "aircraft-list"/);
  assert.match(equipmentModelSource, /kind: "aircraft-list"/);
  assert.ok(zeroAircraftIndex >= 0, "zero-aircraft imported samples must resolve to the aircraft-list target");
  assert.ok(zeroAircraftIndex < componentFallbackIndex, "zero-aircraft guard must run before component fallback");
  assert.match(equipmentModelSource, /function addEquipmentAircraftForSelectionModel\(scenario\)/);
  assert.match(equipmentModelSource, /scenario\.equipment\.wholeMachineModels\.push\(aircraftModel\)/);
  assert.match(equipmentModelSource, /selectedEquipmentNodeKey: `aircraft:\$\{aircraftModel\}`/);
  assert.match(appSource, /ensureOperationsSupportActivityForAircraftModel\(mutation\.aircraftModel\)/);
  assert.match(appSource, /equipmentSelectionSummary\(selectedState, visibleRowCount\)/);
  assert.doesNotMatch(appSource, /整机数量<input readonly value=/);
});

test("equipment aircraft selection keeps an editable aircraft name row", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  const tableSource = equipmentSource.slice(
    equipmentSource.indexOf("function renderEquipmentSystemTable"),
    equipmentSource.indexOf("function renderEquipmentSystemTableRow")
  );
  const mutationSource = equipmentSource.slice(
    equipmentSource.indexOf("function updateEquipmentAircraftModel"),
    equipmentSource.indexOf("function ensureOperationsSupportActivityForAircraftModel")
  );

  assert.match(tableSource, /<th>组件名称<\/th>/);
  assert.match(tableSource, /<th>MTBF参数<\/th>/);
  assert.match(equipmentSource, /data-equipment-import-file/);
  assert.ok(
    equipmentSource.indexOf("data-equipment-import-file") > equipmentSource.indexOf("<h3>装备系统建模</h3>"),
    "equipment import button should live under the right-side equipment system title"
  );
  assert.ok(
    equipmentSource.indexOf("data-equipment-add-node") < equipmentSource.indexOf("renderCollapsibleTree(buildEquipmentTreeNodes())"),
    "add node button should stay inside the left equipment structure tree area"
  );
  assert.ok(
    equipmentSource.indexOf("data-equipment-delete-node") < equipmentSource.indexOf("renderCollapsibleTree(buildEquipmentTreeNodes())"),
    "delete button should stay inside the left equipment structure tree area"
  );
  assert.match(equipmentSource, /equipmentImportStatus/);
  assert.match(tableSource, /renderEquipmentAircraftTableRow\(selectedState\.aircraftModel\)/);
  assert.match(tableSource, /renderEquipmentAircraftTableRow\(model, \{ editable: false \}\)/);
  assert.match(tableSource, /renderEquipmentSystemTableRow/);
  assert.match(equipmentSource, /function renderEquipmentAircraftTableRow\(aircraftModel, \{ editable = true \} = \{\}\)/);
  assert.match(equipmentSource, /aria-label="整机名称"/);
  assert.match(appSource, /function importEquipmentStructureTableFile\(file\)/);
  assert.match(appSource, /function normalizeEquipmentStructureImport\(input\)/);
  assert.match(mutationSource, /function updateEquipmentAircraftModel\(previousModel, nextModelRaw\)/);
  assert.match(appSource, /function commitEquipmentAircraftModelInput\(input\)/);
  assert.match(appSource, /app\.addEventListener\("focusout"/);
  assert.match(mutationSource, /selectedEquipmentNodeKey = `aircraft:\$\{nextModel\}`/);
  assert.doesNotMatch(equipmentSource, /整机级节点仅维护飞机名称/);
  assert.doesNotMatch(equipmentSource, /可靠性框图从下级系统开始绘制/);
});

test("equipment aircraft list mutations synchronize operations support activity aircraft groups", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const supportActivityPlanSource = appSource.slice(
    appSource.indexOf("function supportActivityPlanForPage"),
    appSource.indexOf("render();")
  );
  const equipmentMutationSource = appSource.slice(
    appSource.indexOf("function addEquipmentNodeForSelection"),
    appSource.indexOf("function equipmentSelectionSummary")
  );

  assert.match(supportActivityPlanSource, /const aircraftModels = wholeMachineModels\(\)/);
  assert.match(supportActivityPlanSource, /Array\.from\(planNodesByModel\.entries\(\)\)\s*\.map/);
  assert.doesNotMatch(supportActivityPlanSource, /\.filter\(\(\[, plans\]\) => plans\.length\)/);
  assert.match(appSource, /data-select-operations-support-aircraft-model/);
  assert.match(appSource, /const operationsSupportAircraftSelectButton = event\.target\.closest\("\[data-select-operations-support-aircraft-model\]"\)/);
  assert.match(appSource, /function selectOperationsSupportAircraftModel\(aircraftModel\)/);
  assert.match(appSource, /selectedOperationsSupportAircraftModel/);
  assert.match(equipmentMutationSource, /function ensureOperationsSupportActivityForAircraftModel\(aircraftModel\)/);
  assert.match(equipmentMutationSource, /function removeOperationsSupportActivitiesForAircraftModel\(aircraftModel\)/);
  assert.match(equipmentMutationSource, /function deleteSelectedEquipmentNode\(\)/);
  assert.match(equipmentMutationSource, /removeOperationsSupportActivitiesForAircraftModel\(aircraftModel\)/);
  assert.match(equipmentMutationSource, /function updateOperationsSupportActivityAircraftModel\(oldModel, nextModel\)/);
  assert.match(equipmentMutationSource, /updateOperationsSupportActivityAircraftModel\(oldModel, nextModel\)/);
});

test("equipment aircraft deletion cleans downstream aircraft-model references", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentMutationSource = appSource.slice(
    appSource.indexOf("function deleteSelectedEquipmentNode"),
    appSource.indexOf("function ensureOperationsSupportActivityForAircraftModel")
  );
  const cleanupSource = appSource.slice(
    appSource.indexOf("function cleanupDeletedEquipmentAircraftReferences"),
    appSource.indexOf("function updateEquipmentAircraftModel")
  );

  assert.match(equipmentMutationSource, /const fallbackModel = wholeMachineModels\(\)\[0\] \|\| ""/);
  assert.match(equipmentMutationSource, /cleanupDeletedEquipmentAircraftReferences\(aircraftModel, fallbackModel\)/);
  assert.match(cleanupSource, /function cleanupDeletedEquipmentAircraftReferences\(deletedModel, fallbackModel = ""\)/);
  assert.match(cleanupSource, /for \(const record of editableBasicMissionRecords\(\)\)/);
  assert.match(cleanupSource, /record\.task\.equipmentType = nextModel/);
  assert.match(cleanupSource, /for \(const member of scenario\.combatUnit\?\.members \|\| \[\]\)/);
  assert.match(cleanupSource, /member\.model = nextModel/);
  assert.match(cleanupSource, /for \(const override of Object\.values\(scenario\.supportResourceOverrides \|\| \{\}\)\)/);
  assert.match(cleanupSource, /override\.aircraft\.filter\(\(model\) => String\(model\) !== oldModel\)/);
  assert.match(cleanupSource, /selectedBasicMissionEquipmentType = nextModel/);
});

test("equipment component deletion cleans descendant component references", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentMutationSource = appSource.slice(
    appSource.indexOf("function deleteSelectedEquipmentNode"),
    appSource.indexOf("function ensureOperationsSupportActivityForAircraftModel")
  );
  const cleanupSource = appSource.slice(
    appSource.indexOf("function cleanupDeletedEquipmentComponentReferences"),
    appSource.indexOf("function cleanupDeletedEquipmentAircraftReferences")
  );

  assert.match(equipmentMutationSource, /deleteEquipmentNodeForSelectionModel\(\{ scenario, selection: selectedState \}\)/);
  assert.match(equipmentMutationSource, /cleanupDeletedEquipmentComponentReferences\(mutation\.deletedComponentIds/);
  assert.match(cleanupSource, /function cleanupDeletedEquipmentComponentReferences\(deletedComponentIds/);
  assert.match(cleanupSource, /activity\.equipmentId/);
  assert.match(cleanupSource, /delete activity\.equipmentId/);
  assert.match(cleanupSource, /selectedCorrectiveComponentId/);
});

test("equipment system table exposes composition, MTBF and MTTR distribution fields together", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  assert.match(equipmentSource, /function renderEquipmentSystemTable/);
  assert.match(equipmentSource, /equipmentTableInput\("组件名称", `components\.\$\{index\}\.name`\)/);
  assert.match(equipmentSource, /equipmentTableInput\("父节点", `components\.\$\{index\}\.parentId`\)/);
  assert.match(equipmentSource, /function equipmentComponentAttributeSelect/);
  assert.match(equipmentSource, /组件属性/);
  assert.match(equipmentSource, /\{ value: "LRU", label: "LRU" \}/);
  assert.match(equipmentSource, /\{ value: "SRU", label: "SRU" \}/);
  assert.doesNotMatch(equipmentSource, /是否为LRU/);
  assert.doesNotMatch(equipmentSource, /field\("备件类型", `components\.\$\{selectedIndex\}\.spareType`\)/);
  assert.match(equipmentSource, /equipmentKOutOfNInput\(selectedIndex\)/);
  assert.match(equipmentSource, /k值（n中取k）/);
  assert.match(equipmentSource, /components\.\$\{index\}\.mtbfHours/);
  assert.match(equipmentSource, /components\.\$\{index\}\.failureDistribution\.distributionType/);
  assert.match(equipmentSource, /components\.\$\{index\}\.meanRepairTimeMinutes/);
  assert.match(equipmentSource, /components\.\$\{index\}\.repairDistribution\.distributionType/);
  assert.doesNotMatch(equipmentSource, /equipmentTableInput\("MTBF", `components\.\$\{index\}\.mtbfHours`/);
  assert.doesNotMatch(equipmentSource, /equipmentTableInput\("MTTR（min）", `components\.\$\{index\}\.meanRepairTimeMinutes`/);
  assert.doesNotMatch(equipmentSource, /field\("连接类型", `components\.\$\{selectedIndex\}\.connectionType`\)/);
  assert.doesNotMatch(equipmentSource, /PRODUCT_TYPE_OPTIONS/);
  assert.doesNotMatch(equipmentSource, /isFailurePage \? renderEquipmentComponentTable\(\) : ""/);
  assert.doesNotMatch(equipmentSource, /isFailurePage \? renderAircraftStateDataTable\(\) : ""/);
});

test("equipment composition constrains k-out-of-n to an integer within quantity", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /data-equipment-k-out-of-n-index/);
  assert.match(appSource, /function updateEquipmentKOutOfNInput\(input\)/);
  assert.match(appSource, /const liveEquipmentKOutOfNInput = event\.target\.closest\("\[data-equipment-k-out-of-n-index\]"\)/);
  assert.match(appSource, /Math\.trunc\(Number\(input\.value\) \|\| 1\)/);
  assert.match(appSource, /clamp\(.*1, quantity\)/);
  assert.match(appSource, /component\.kOutOfN = \{ \.\.\.\(component\.kOutOfN \|\| \{\}\), enabled: quantity > 1 && bounded > 0, n: quantity, k: bounded \}/);
  assert.match(appSource, /min="1"/);
  assert.match(appSource, /step="1"/);
  assert.match(appSource, /max="\$\{htmlEscape\(quantity\)\}"/);
  assert.match(appSource, /\$\{quantity > 1 \? "" : "disabled"\}/);
});

test("equipment system table exposes MTBF and MTTR distribution parameter rules", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  for (const label of ["固定值", "指数分布", "正态分布", "均匀分布"]) {
    assert.match(equipmentSource, new RegExp(label));
  }
  for (const label of ["速率参数", "均值", "方差", "最小值", "最大值"]) {
    assert.match(equipmentSource, new RegExp(label));
  }
  assert.doesNotMatch(equipmentSource, /三角分布/);
  assert.doesNotMatch(equipmentSource, /威布尔分布/);
  assert.doesNotMatch(equipmentSource, /模数/);
  assert.doesNotMatch(equipmentSource, /形状参数/);
  assert.doesNotMatch(equipmentSource, /尺度参数/);
  assert.match(equipmentSource, /equipmentDistributionType\(component\.failureDistribution\?\.distributionType, "mtbf"\)/);
  assert.match(equipmentSource, /equipmentDistributionType\(component\.repairDistribution\?\.distributionType, "mttr"\)/);
  assert.match(equipmentSource, /metric === "mtbf" \? "指数分布" : "固定值"/);
  assert.match(equipmentSource, /fixedPath = metric === "mtbf" \? `components\.\$\{index\}\.mtbfHours` : `components\.\$\{index\}\.meanRepairTimeMinutes`/);
  assert.match(equipmentSource, /aria-label="\$\{htmlEscape\(fixedLabel\)\}"/);
  assert.doesNotMatch(equipmentSource, /固定值使用 \$\{fixedLabel\}/);
  assert.match(equipmentSource, /components\.\$\{index\}\.failureDistribution/);
  assert.match(equipmentSource, /components\.\$\{index\}\.repairDistribution/);
  assert.match(equipmentSource, /type="number" min="0" step="\$\{fieldDef\.step\}"/);
  assert.doesNotMatch(equipmentSource, /组件属性表/);
  assert.doesNotMatch(equipmentSource, /飞机状态数据表/);
  assert.doesNotMatch(equipmentSource, /可出动标识/);
});

test("frontend shell mounts a feature workbench rather than six static summary views", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  assert.match(html, /id="app"/);
  assert.match(html, /feature-workbench/);
});

test("frontend source omits removed page-side context panels", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /Ontology 上下文/);
  assert.doesNotMatch(appSource, /校验与输出/);
  assert.doesNotMatch(appSource, /写入对象/);
  assert.doesNotMatch(appSource, /输出联动/);
  assert.match(appSource, /aria-label="功能导航"/);
  assert.doesNotMatch(appSource, /nav-summary/);
  assert.doesNotMatch(appSource, /三级折叠菜单/);
  assert.doesNotMatch(styleSource, /\.nav-summary/);
  assert.doesNotMatch(appSource, /aria-label="四级功能入口"/);
  assert.doesNotMatch(appSource, /\$\{page\.tertiary\}入口/);
  assert.doesNotMatch(appSource, /feature-entry-card/);
  assert.doesNotMatch(appSource, /\$\{item\.component\}/);
});

test("modeling and experiment pages use compact Chinese fourth-level tabs when needed", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /<h2>\$\{htmlEscape\(page\.tertiary\)\}<\/h2>/);
  assert.doesNotMatch(appSource, /function renderPageHeading/);
  assert.doesNotMatch(appSource, /class="breadcrumb"/);
  assert.doesNotMatch(appSource, /<h2>\$\{page\.name\}<\/h2>/);
  assert.match(appSource, /function shouldShowCurrentContext\(page\)/);
  assert.match(appSource, /page\.secondary !== "仿真建模"/);
  assert.match(appSource, /class="nav-tertiary-link/);
  assert.doesNotMatch(appSource, /进入\$\{tertiaryName\}/);
  assert.match(appSource, /class="compact-fourth-tabs"/);
  assert.match(appSource, /shouldShowFourthTabs/);
  assert.doesNotMatch(appSource, /aria-label="同组四级功能"/);
});

test("built-in scenario page configures airport and mission area attributes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  assert.match(appSource, /if \(page\.name === "内置场景"\) return renderBuiltInScenario\(page\)/);
  assert.match(appSource, /function renderBuiltInScenario\(page\)/);
  assert.match(appSource, /出发机场/);
  assert.match(appSource, /任务区/);
  assert.match(appSource, /距任务区/);
  assert.match(appSource, /distanceToMissionKm/);
  assert.match(appSource, /distanceFromDepartureKm/);
  assert.match(catalogSource, /return \["scenarioId", "airports", "missionAreas", "supportNodes"\]/);
});

test("combat unit page follows ship front basic unit modeling structure", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /if \(page\.name === "基本作战单元建模"\) return renderCombatUnitModeling\(page\)/);
  assert.match(appSource, /function renderCombatUnitModeling\(page\)/);
  const combatUnitSource = appSource.slice(
    appSource.indexOf("function renderCombatUnitModeling"),
    appSource.indexOf("function renderBasicMissionModeling")
  );
  assert.match(combatUnitSource, /飞机列表/);
  assert.match(combatUnitSource, /data-combat-unit-add/);
  assert.match(combatUnitSource, /data-combat-unit-delete/);
  assert.match(combatUnitSource, /data-select-combat-unit-member/);
  assert.match(combatUnitSource, /combat-unit-table/);
  assert.match(combatUnitSource, /type="checkbox" data-select-combat-unit-member/);
  assert.match(combatUnitSource, /<th rowspan="2" class="combat-unit-select-col"><\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-heading">大修周期<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">大修周期（日历日）<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">飞行小时<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">起落次数<\/th>/);
  assert.match(appSource, /飞机编号/);
  assert.match(combatUnitSource, /combatUnitMemberInput\(index, "aircraftNo", member\.aircraftNo\)/);
  assert.match(combatUnitSource, /combatUnitMemberModelSelect\(index, member\.model\)/);
  assert.match(combatUnitSource, /function combatUnitMemberModelSelect\(index, value\)/);
  assert.match(combatUnitSource, /const aircraftModels = wholeMachineModels\(\)/);
  assert.match(combatUnitSource, /<select data-combat-unit-index="\$\{index\}" data-combat-unit-field="model"/);
  assert.doesNotMatch(combatUnitSource, /combatUnitMemberInput\(index, "model", member\.model\)/);
  assert.match(combatUnitSource, /data-combat-unit-field/);
  assert.match(combatUnitSource, /combatUnitMemberCalendarTime\(member\)/);
  assert.match(combatUnitSource, /combatUnitMemberFlightHours\(member\)/);
  assert.match(combatUnitSource, /combatUnitMemberTakeoffLandingCount\(member\)/);
  assert.match(appSource, /function updateCombatUnitMemberField\(index, fieldName, value\)/);
  assert.match(appSource, /const combatUnitFieldSelect = event\.target\.closest\("\[data-combat-unit-field\]"\)/);
  assert.match(appSource, /function addCombatUnitMember\(\)/);
  assert.match(appSource, /function deleteSelectedCombatUnitMember\(\)/);
  assert.match(appSource, /let selectedCombatUnitMemberIndex = 0/);
  assert.doesNotMatch(combatUnitSource, /data-combat-unit-edit/);
  assert.doesNotMatch(combatUnitSource, /section-head section-context/);
  assert.doesNotMatch(combatUnitSource, /page\.dataObjects/);
  assert.doesNotMatch(combatUnitSource, /detail-card/);
  assert.doesNotMatch(combatUnitSource, /编队需求/);
  assert.doesNotMatch(combatUnitSource, /基本使用单元/);
  assert.doesNotMatch(combatUnitSource, /备用机清单/);
  assert.doesNotMatch(combatUnitSource, /部署位置/);
});

test("basic mission page follows ship front basic task modeling structure", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const basicMissionSource = appSource.slice(
    appSource.indexOf("function renderBasicMissionModeling"),
    appSource.indexOf("function missionPhaseRatioTotal")
  );
  assert.match(appSource, /if \(page\.name === "基本任务建模"\) return renderBasicMissionModeling\(page\)/);
  assert.match(appSource, /function renderBasicMissionModeling\(page\)/);
  assert.match(appSource, /基本任务结构树/);
  assert.match(appSource, /function basicMissionTreeNodes\(\)/);
  assert.match(appSource, /按飞机类型组织：飞机类型 → 多种基本任务/);
  assert.match(appSource, /label: equipmentType/);
  assert.match(appSource, /data-select-basic-mission-equipment/);
  assert.match(appSource, /data-basic-mission-add/);
  assert.match(appSource, /data-basic-mission-delete/);
  assert.match(appSource, /data-select-basic-mission/);
  assert.match(appSource, /function addBasicMission\(\)/);
  assert.match(appSource, /selectedBasicMissionEquipmentType/);
  assert.match(appSource, /const equipmentType = selectedBasicMissionEquipmentType \|\| selected\.task\.equipmentType \|\| scenario\.basicMission\.equipmentType/);
  assert.match(appSource, /function deleteSelectedBasicMission\(\)/);
  assert.match(appSource, /let selectedBasicMissionKey = "primary"/);
  assert.match(stylesSource, /\.tree-node-label\.selected/);
  assert.match(appSource, /基本任务信息编辑/);
  assert.match(appSource, /任务编号/);
  assert.match(appSource, /任务成功点/);
  assert.match(appSource, /min: "0", max: "1", step: "0\.01"/);
  assert.doesNotMatch(appSource, /出发时间\(h\)/);
  assert.doesNotMatch(basicMissionSource, /返回时间比/);
  assert.match(appSource, /提前通知时间/);
  assert.match(appSource, /advanceNoticeMinutes/);
  assert.match(appSource, /任务优先级/);
  assert.match(appSource, /最小装备数量/);
  assert.match(appSource, /任务时长（分钟）/);
  assert.match(appSource, /使用保障活动/);
  assert.match(appSource, /任务区域描述/);
  assert.match(appSource, /阶段占比/);
  assert.match(appSource, /阶段占比合计/);
  assert.match(appSource, /missionPhaseRatioTotal/);
  assert.match(appSource, /必须调整为 1 后才能作为正式编译输入/);
  assert.doesNotMatch(appSource, /<tr><th>更新时间<\/th>/);
  assert.doesNotMatch(appSource, /基本任务建模字段[\s\S]*任务类型/);
});

test("phase 1B mission modeling convergence contract is documented in source", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const combatUnitSource = appSource.slice(
    appSource.indexOf("function renderCombatUnitModeling"),
    appSource.indexOf("function renderBasicMissionModeling")
  );
  const basicMissionSource = appSource.slice(
    appSource.indexOf("function renderBasicMissionModeling"),
    appSource.indexOf("function missionPhaseRatioTotal")
  );
  const compositeSource = appSource.slice(
    appSource.indexOf("function buildCompositeTimelineRows(composite)"),
    appSource.indexOf("function renderCompositeTimelineChart")
  );
  const periodicSource = appSource.slice(
    appSource.indexOf("function renderPeriodicTaskModeling"),
    appSource.indexOf("function periodicTaskList")
  );
  const periodicModelSource = appSource.slice(
    appSource.indexOf("function parsePeriodicCompositeTasks"),
    appSource.indexOf("function periodicValueSelect")
  );

  assert.match(combatUnitSource, /大修周期/);
  assert.doesNotMatch(combatUnitSource, /class="combat-unit-prelife-column">日历时间<\/th>/);

  assert.match(basicMissionSource, /提前通知时间/);
  assert.match(basicMissionSource, /advanceNoticeMinutes/);
  assert.doesNotMatch(basicMissionSource, /返回时间比/);
  assert.match(basicMissionSource, /<h5>任务阶段<\/h5>/);
  assert.ok(
    basicMissionSource.indexOf("任务时长（分钟）") < basicMissionSource.indexOf("<h5>任务阶段</h5>")
      && basicMissionSource.indexOf("<h5>任务阶段</h5>") < basicMissionSource.indexOf("提前通知时间"),
    "任务阶段子表单应紧跟在任务时长下方，位于提前通知时间之前"
  );
  assert.doesNotMatch(basicMissionSource, /<div class="detail-card network-card">\s*<div class="tree-toolbar">\s*<h4>任务阶段<\/h4>/);

  assert.match(compositeSource, /\.sort\(\(left, right\) => left\.totalStartMinutes - right\.totalStartMinutes\)/);
  assert.match(compositeSource, /\.map\(\(row, index\) => \(\{ \.\.\.row, sequence: index \+ 1 \}\)\)/);

  assert.match(periodicSource, /上级任务名称/);
  assert.match(periodicSource, /parentTaskName/);
  assert.match(periodicSource, /总周数/);
  assert.match(periodicSource, /data-periodic-select-week/);
  assert.doesNotMatch(periodicSource, /<th>选择\/删除<\/th>/);
  assert.doesNotMatch(periodicSource, /data-periodic-delete="\$\{htmlEscape\(task\.id\)\}"/);
  assert.doesNotMatch(periodicSource, /data-periodic-select="\$\{htmlEscape\(task\.id\)\}">选择<\/button>/);
  assert.doesNotMatch(periodicSource, /任务周期天数/);
  assert.match(periodicSource, /每周天数/);
  assert.match(periodicSource, /周次/);
  assert.match(periodicSource, /周内日/);
  assert.match(periodicModelSource, /weekIndex/);
  assert.match(periodicModelSource, /weekday/);
});

test("basic mission tree should support selecting editable mission nodes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const bindSource = appSource.slice(
    appSource.indexOf("const basicMissionNode = event.target.closest(\"[data-select-basic-mission]\")"),
    appSource.indexOf("const basicMissionEquipmentNode = event.target.closest(\"[data-select-basic-mission-equipment]\")")
  );

  assert.match(bindSource, /if \(basicMissionNode && !clickedTreeToggleIcon\) \{/);
  assert.match(bindSource, /const candidateBasicMissionKey = basicMissionNode\.dataset\.selectBasicMission;/);
  assert.match(bindSource, /const selectedMission = editableBasicMissionRecords\(\)\.find\(\(record\) => record\.key === candidateBasicMissionKey\);/);
  assert.match(bindSource, /selectedBasicMissionKey = candidateBasicMissionKey;/);
  assert.match(bindSource, /selectedBasicMissionTreeLevel = "mission";/);
  assert.match(bindSource, /if \(selectedMission\) \{/);
});

test("basic mission aircraft tree nodes should select editable equipment tasks", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentBindSource = appSource.slice(
    appSource.indexOf("const basicMissionEquipmentNode = event.target.closest(\"[data-select-basic-mission-equipment]\")"),
    appSource.indexOf("const compositeTaskAddButton = event.target.closest(\"[data-composite-task-add]\")")
  );
  const treeSource = appSource.slice(
    appSource.indexOf("function basicMissionTreeNodes()"),
    appSource.indexOf("function editableBasicMissionRecords()")
  );

  assert.match(appSource, /let selectedBasicMissionTreeLevel = "mission"/);
  assert.match(equipmentBindSource, /if \(basicMissionEquipmentNode\) \{/);
  assert.match(equipmentBindSource, /const selectedEquipmentMission = editableBasicMissionRecords\(\)\.find\(\(record\) => record\.task\.equipmentType === selectedBasicMissionEquipmentType\);/);
  assert.match(equipmentBindSource, /selectedBasicMissionKey = selectedEquipmentMission\?\.key \|\| "primary";/);
  assert.match(equipmentBindSource, /selectedBasicMissionTreeLevel = "equipment";/);
  assert.match(equipmentBindSource, /toggleTreeNodeFromElement\(clickedTreeToggleIcon\);/);
  assert.match(appSource, /function toggleTreeNodeFromElement\(treeToggleElement\)/);
  assert.match(treeSource, /const tasks = editableBasicMissionRecords\(\);/);
  assert.doesNotMatch(treeSource, /readonlyCompositeBasicMissionRecords/);
  assert.match(treeSource, /selected: selectedBasicMissionTreeLevel === "mission" && record\.key === selectedBasicMissionKey/);
  assert.match(treeSource, /selected: selectedBasicMissionTreeLevel === "equipment" && equipmentType === selectedBasicMissionEquipmentType/);
  assert.doesNotMatch(appSource, /function readonlyCompositeBasicMissionRecords/);
  assert.doesNotMatch(appSource, /function ensureEditableBasicMissionForEquipment/);
});

test("structure trees expose shared expand and collapse controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /let collapsedTreeNodes = new Set\(\)/);
  assert.match(appSource, /data-tree-toggle/);
  assert.match(appSource, /function renderCollapsibleTree\(nodes/);
  assert.doesNotMatch(appSource, /<div class="tree-node /);
  assert.doesNotMatch(appSource, /tree-node root/);
  assert.match(stylesSource, /\.tree-node-item\.collapsed > \.tree-node-children/);
});

test("mission task profile pages split composite and periodic task modeling", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  assert.match(catalogSource, /复合任务建模: "composite-task"/);
  assert.match(catalogSource, /周期性任务建模: "periodic-task"/);
  assert.doesNotMatch(catalogSource, /任务剖面建模: "mission-profile"/);
  assert.match(appSource, /if \(page\.name === "复合任务建模"\) return renderCompositeTaskModeling\(page\)/);
  assert.match(appSource, /if \(page\.name === "周期性任务建模"\) return renderPeriodicTaskModeling\(page\)/);

  const compositeSource = appSource.slice(
    appSource.indexOf("function renderCompositeTaskModeling"),
    appSource.indexOf("function renderPeriodicTaskModeling")
  );
  assert.match(compositeSource, /复合任务列表/);
  assert.match(compositeSource, /data-composite-task-add/);
  assert.match(compositeSource, /data-composite-task-delete/);
  assert.match(compositeSource, /data-select-composite-task/);
  assert.match(compositeSource, /clickable-table-row \$\{index === selected\.index \? "selected-table-row" : ""\}/);
  assert.match(compositeSource, /tabindex="0"/);
  assert.match(compositeSource, /aria-selected="\$\{index === selected\.index \? "true" : "false"\}"/);
  assert.match(appSource, /function selectCompositeTaskRow\(compositeTaskRow\)/);
  assert.match(appSource, /app\.addEventListener\("keydown"/);
  assert.match(compositeSource, /<thead><tr><th>复合任务名称<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(compositeSource, /<th>基本任务<\/th>/);
  assert.match(compositeSource, /当前复合任务包含的基本任务/);
  assert.match(compositeSource, /data-composite-task-item-add/);
  assert.match(compositeSource, /data-composite-task-item-delete/);
  assert.match(compositeSource, /basicMissionSelect/);
  assert.match(compositeSource, /findBasicMissionByName/);
  assert.match(compositeSource, /compositeTaskInheritedBasicFields/);
  assert.match(compositeSource, /readOnlyTableValue/);
  assert.match(compositeSource, /典型组合任务时序表/);
  assert.match(compositeSource, /典型组合任务时序图/);
  assert.match(compositeSource, /renderCompositeTimelineChart/);
  assert.match(compositeSource, /任务优先级/);
  assert.match(compositeSource, /要求装备数量/);
  assert.match(compositeSource, /最小装备数量/);
  assert.doesNotMatch(compositeSource, /回收时刻/);
  assert.match(appSource, /任务时长过长，应新建复合任务，在周期性任务中组合/);
  assert.match(appSource, /function formatTimelineHour/);
  assert.doesNotMatch(compositeSource, /任务派遣时长/);
  assert.doesNotMatch(compositeSource, /任务回收时长/);
  assert.doesNotMatch(compositeSource, /周期性任务列表/);
  assert.doesNotMatch(compositeSource, /周期性任务建模/);

  const periodicSource = appSource.slice(
    appSource.indexOf("function renderPeriodicTaskModeling"),
    appSource.indexOf("function buildCompositeTimelineRows")
  );
  assert.match(periodicSource, /周期性任务周列表/);
  assert.match(periodicSource, /周期性任务建模/);
  assert.match(periodicSource, /总周数/);
  assert.match(periodicSource, /data-periodic-select-week/);
  assert.match(periodicSource, /clickable-table-row \$\{weekIndex === selectedPeriodicWeekIndex \? "selected-table-row" : ""\}/);
  assert.match(periodicSource, /aria-selected="\$\{weekIndex === selectedPeriodicWeekIndex \? "true" : "false"\}"/);
  assert.match(periodicSource, /上级任务名称/);
  assert.doesNotMatch(periodicSource, /任务周期天数/);
  assert.doesNotMatch(periodicSource, /max="30"/);
  assert.doesNotMatch(periodicSource, /重复轮次/);
  assert.match(periodicSource, /每周天数/);
  assert.match(periodicSource, /value="7"/);
  assert.match(periodicSource, /周次/);
  assert.match(periodicSource, /周内日/);
  assert.match(periodicSource, /复合任务名称/);
  assert.match(periodicSource, /periodicWeekdayLabel/);
  assert.match(appSource, /let selectedPeriodicWeekIndex = 1/);
  assert.match(appSource, /const periodicWeekRow = event\.target\.closest\("\[data-periodic-select-week\]"\)/);
  assert.match(appSource, /return 7;/);
  assert.match(appSource, /let selectedCompositeTaskId = ""/);
  assert.match(appSource, /function addCompositeTask\(\)/);
  assert.match(appSource, /function deleteSelectedCompositeTask\(\)/);
  assert.match(appSource, /function addCompositeTaskItem\(\)/);
  assert.match(appSource, /function deleteCompositeTaskItem\(index\)/);
  assert.doesNotMatch(periodicSource, /<th>选择\/删除<\/th>/);
  assert.doesNotMatch(periodicSource, /当前复合任务包含的基本任务/);
  assert.doesNotMatch(periodicSource, /典型组合任务时序表/);
});

test("composite timeline table and rows should drop recovery time output", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const compositeSource = appSource.slice(
    appSource.indexOf("function renderCompositeTaskModeling"),
    appSource.indexOf("function renderPeriodicTaskModeling")
  );
  const timelineSource = appSource.slice(
    appSource.indexOf("function buildCompositeTimelineRows(composite)"),
    appSource.indexOf("function renderCompositeTimelineChart")
  );

  assert.doesNotMatch(compositeSource, /<th>回收时刻<\/th>/);
  assert.doesNotMatch(compositeSource, /\brow\.recoveryTime\b/);
  assert.doesNotMatch(timelineSource, /recoveryTime:/);
  assert.doesNotMatch(timelineSource, /addMinutesToTime\(departureTime, durationMinutes\)/);
});

test("page revision equipment and mission input constraints are guarded", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  const basicMissionSource = appSource.slice(
    appSource.indexOf("function renderBasicMissionModeling"),
    appSource.indexOf("function renderCompositeTaskModeling")
  );
  const compositeSource = appSource.slice(
    appSource.indexOf("function renderCompositeTaskModeling"),
    appSource.indexOf("function renderPeriodicTaskModeling")
  );
  const compositeItemSource = compositeSource.slice(
    compositeSource.indexOf("<h4>当前复合任务包含的基本任务</h4>"),
    compositeSource.indexOf("<h4>典型组合任务时序表</h4>")
  );
  const missionInfoStart = basicMissionSource.indexOf("<h4>基本任务信息编辑</h4>");
  const equipmentQuantityIndex = basicMissionSource.indexOf("装备数量", missionInfoStart);
  const minimumEquipmentIndex = basicMissionSource.indexOf("最小装备数量", missionInfoStart);

  assert.match(equipmentSource, /function equipmentComponentAttributeSelect/);
  assert.match(equipmentSource, /\{ value: "LRU", label: "LRU" \}/);
  assert.match(equipmentSource, /\{ value: "SRU", label: "SRU" \}/);
  assert.match(equipmentSource, /\{ value: "", label: "空值" \}/);
  assert.match(equipmentSource, /function equipmentKOutOfNInput/);
  assert.match(equipmentSource, /const quantity = Math\.max\(0, Math\.trunc\(Number\(component\.quantity\) \|\| 0\)\)/);
  assert.match(equipmentSource, /clamp\(Math\.trunc\(Number\(component\.kOutOfN\?\.k\) \|\| 1\), 1, quantity\)/);
  assert.match(equipmentSource, /quantity > 1 \? "" : "disabled"/);
  assert.match(equipmentSource, /min="1" max="\$\{htmlEscape\(quantity\)\}" step="1"/);
  assert.match(equipmentSource, /function equipmentDistributionOptions/);
  assert.match(equipmentSource, /function renderEquipmentDistributionParameters/);

  assert.ok(equipmentQuantityIndex > -1, "basic mission equipment quantity field missing");
  assert.ok(minimumEquipmentIndex > equipmentQuantityIndex, "minimum equipment quantity must follow equipment quantity");
  assert.match(basicMissionSource, /data-basic-mission-add/);
  assert.match(basicMissionSource, /data-basic-mission-delete/);
  assert.match(basicMissionSource, /data-basic-mission-phase-add/);
  assert.match(basicMissionSource, /data-basic-mission-phase-add>新增/);
  assert.match(basicMissionSource, /data-basic-mission-phase-batch-delete/);
  assert.match(basicMissionSource, /function deleteSelectedMissionPhases\(\)/);
  assert.doesNotMatch(basicMissionSource, /data-basic-mission-phase-add>添加/);
  assert.match(basicMissionSource, /data-basic-mission-phase-select-all/);
  assert.match(basicMissionSource, /data-basic-mission-phase-select="\$\{index\}"/);
  assert.match(basicMissionSource, /data-basic-mission-phase-delete/);
  assert.match(basicMissionSource, /missionPhaseRatioTotal/);
  assert.match(basicMissionSource, /Math\.abs\(phaseRatioTotal - 1\) < 0\.001/);
  assert.doesNotMatch(basicMissionSource, /<button[^>]*>编辑<\/button>/);
  assert.doesNotMatch(basicMissionSource, /<th>状态<\/th>/);
  assert.doesNotMatch(basicMissionSource, /转移条件/);

  assert.match(compositeItemSource, /basicMissionSelect/);
  assert.match(compositeItemSource, /findBasicMissionByName/);
  assert.match(compositeItemSource, /const inherited = compositeTaskInheritedBasicFields\(item, basicTask\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.equipmentType\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.taskDurationMinutes\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.equipmentQuantity\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.minRequiredSystems\)/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.equipmentType/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.taskDurationMinutes/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.equipmentQuantity/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.minRequiredSystems/);
  assert.doesNotMatch(compositeItemSource, /requiredEquipmentQuantity/);
  assert.match(compositeItemSource, /minRequiredSystems/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.groupName/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.firstWaveTime/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.priority/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.dailyRepeatCount/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.intervalHours/);
  assert.doesNotMatch(compositeItemSource, /任务下达时间/);
  assert.doesNotMatch(compositeItemSource, /回收时刻/);
});

test("editable modeling lists expose page suggestion action entries", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function buildEquipmentTreeNodes")
  );
  assert.match(equipmentSource, /data-equipment-add-node/);
  assert.match(equipmentSource, /data-equipment-delete-node \$\{selectedState\.kind === "aircraft-list" \? "disabled" : ""\}/);

  const basicMissionSource = appSource.slice(
    appSource.indexOf("function renderBasicMissionModeling"),
    appSource.indexOf("function renderCompositeTaskModeling")
  );
  assert.match(basicMissionSource, /data-basic-mission-add/);
  assert.match(basicMissionSource, /data-basic-mission-delete/);
  assert.match(basicMissionSource, /data-basic-mission-phase-add/);
  assert.match(basicMissionSource, /data-basic-mission-phase-batch-delete/);
  assert.match(basicMissionSource, /data-basic-mission-phase-select-all/);
  assert.match(basicMissionSource, /data-basic-mission-phase-select="\$\{index\}"/);
  assert.match(basicMissionSource, /data-basic-mission-phase-delete/);

  const compositeSource = appSource.slice(
    appSource.indexOf("function renderCompositeTaskModeling"),
    appSource.indexOf("function renderPeriodicTaskModeling")
  );
  assert.match(compositeSource, /data-composite-task-add/);
  assert.match(compositeSource, /data-composite-task-delete/);
  assert.match(compositeSource, /data-composite-task-item-add/);
  assert.match(compositeSource, /data-composite-task-item-delete/);

  const combatUnitSource = appSource.slice(
    appSource.indexOf("function renderCombatUnitModeling"),
    appSource.indexOf("function addCombatUnitMember")
  );
  assert.match(combatUnitSource, /data-combat-unit-add/);
  assert.match(combatUnitSource, /data-combat-unit-delete/);
  assert.match(combatUnitSource, /data-combat-unit-field/);
  assert.doesNotMatch(combatUnitSource, /data-combat-unit-edit/);

  const supportOrgSource = appSource.slice(
    appSource.indexOf("function renderSupportOrganizationWorkbench"),
    appSource.indexOf("function renderOrgTreeNode")
  );
  assert.match(supportOrgSource, /data-support-org-add-node/);
  assert.doesNotMatch(supportOrgSource, /selectedOrgDepth >= 3 \? "disabled" : ""/);
  assert.doesNotMatch(appSource, /supportOrgNodeDepth\(parent\.id, orgTree\) >= 3/);
  assert.match(supportOrgSource, /data-support-org-delete-node/);
  assert.match(supportOrgSource, /data-support-org-field="name"/);
  assert.match(supportOrgSource, /data-support-resource-batch-delete/);
  assert.match(supportOrgSource, /data-support-resource-select-all/);
  assert.match(appSource, /function supportOrganizationSelect\(key, selectedNodeId, disabled = false\)/);
  assert.match(appSource, /data-support-resource-field/);
  assert.match(supportOrgSource, /data-support-resource-import-file/);
  assert.match(appSource, /function importSupportResourceTableFile/);
  assert.doesNotMatch(appSource, /data-support-resource-aircraft/);
  assert.doesNotMatch(supportOrgSource, /data-support-resource-edit/);
  assert.doesNotMatch(supportOrgSource, /<th>编辑<\/th>/);
  assert.match(appSource, /function supportPersonnelSpecialtyOptions/);
  assert.match(appSource, /supportResourceSelect\(row, column/);
  assert.match(appSource, /所属装备/);
  assert.doesNotMatch(appSource, /label: "所属型号"/);

  const basicActivitySource = appSource.slice(
    appSource.indexOf("function renderBasicActivityLibrary"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );
  assert.match(basicActivitySource, /data-basic-activity-add/);
  assert.match(basicActivitySource, /data-basic-activity-batch-delete/);
  assert.match(basicActivitySource, /data-basic-activity-query/);
  assert.match(basicActivitySource, /data-basic-activity-import-type/);
  assert.match(basicActivitySource, /durationProfile/);
  assert.match(basicActivitySource, /作业时长分布/);
  assert.match(basicActivitySource, /data-basic-activity-edit="\$\{htmlEscape\(row\.key\)\}"/);
  assert.match(basicActivitySource, /basicActivityTypeSelect\(row\)/);
  assert.match(basicActivitySource, /使用保障活动/);
  assert.match(basicActivitySource, /预防性维修/);
  assert.match(basicActivitySource, /修复性维修/);
  assert.match(basicActivitySource, /activity\.activityType = "使用保障活动"/);
  assert.match(basicActivitySource, /isLogisticsSupportActivity\(activity\)/);
  const basicActivityTypeOptionsSource = appSource.slice(
    appSource.indexOf("function basicActivityTypeOptions"),
    appSource.indexOf("function basicActivityScopeSelect")
  );
  assert.doesNotMatch(basicActivityTypeOptionsSource, /后勤保障/);
  assert.doesNotMatch(basicActivitySource, /activity\.activityType = "后勤保障"/);
  assert.doesNotMatch(basicActivitySource, /type === "后勤保障"/);
  assert.doesNotMatch(basicActivitySource, /ensureLogisticsSupportActivityDraft\(\)/);
  assert.doesNotMatch(basicActivitySource, /activityType === "后勤保障" \? "LG"/);
  assert.doesNotMatch(basicActivitySource, /<th>保障人员<\/th><th>保障设备<\/th><th>备件<\/th>/);
  assert.doesNotMatch(basicActivitySource, /data-basic-activity-delete="\$\{htmlEscape\(row\.key\)\}"/);
  assert.doesNotMatch(basicActivitySource, /编辑\/删除/);

  const logisticsSource = appSource.slice(
    appSource.indexOf("function renderLogisticsSupportActivity"),
    appSource.indexOf("function findLogisticsSupportActivity")
  );
  assert.match(logisticsSource, /data-logistics-transport-add/);
  assert.match(logisticsSource, /data-logistics-transport-delete/);
  assert.match(logisticsSource, /data-logistics-transport-select/);
  assert.match(logisticsSource, /\\u7b56\\u7565\\u540d\\u79f0/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-edit/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-delete="\$\{index\}"/);
  assert.doesNotMatch(logisticsSource, /\\u64cd\\u4f5c/);

  const experimentPlanSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanList"),
    appSource.indexOf("function renderExperimentPlanEditor")
  );
  assert.match(appSource, /async function refreshExperimentPlanList/);
  assert.match(appSource, /backendApi\.listExperimentPlans/);
  assert.match(appSource, /backendApi\.deleteExperimentPlan/);
  assert.match(experimentPlanSource, /backendExperimentPlans/);
  assert.match(experimentPlanSource, /data-experiment-plan-add/);
  assert.match(experimentPlanSource, /data-experiment-plan-select/);
  assert.match(experimentPlanSource, /data-experiment-plan-edit/);
  assert.match(experimentPlanSource, /data-experiment-plan-delete="\$\{htmlEscape\(plan\.experiment_plan_id\)\}"/);
  assert.match(experimentPlanSource, /<td>\$\{htmlEscape\(plan\.steps\)\}<\/td>/);
  assert.match(experimentPlanSource, /<td>\$\{htmlEscape\(plan\.samples\)\}<\/td>/);
  assert.doesNotMatch(experimentPlanSource, /data-experiment-plan-delete disabled/);
  assert.match(appSource, /return "spare-planning-experiment-plan-management"/);
});

test("support activity controls are wired through local draft fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  const basicActivitySource = appSource.slice(
    appSource.indexOf("function renderBasicActivityLibrary"),
    appSource.indexOf("function renderOperationsSupportActivity")
  );
  assert.doesNotMatch(basicActivitySource, /<button type="button" disabled>导入<\/button>/);
  assert.match(basicActivitySource, /data-basic-activity-add/);
  assert.match(basicActivitySource, /data-basic-activity-batch-delete/);
  assert.match(basicActivitySource, /data-basic-activity-field/);
  assert.match(basicActivitySource, /data-basic-activity-resource-dialog-open/);
  assert.match(basicActivitySource, /data-basic-activity-resource-dialog-field/);
  assert.match(basicActivitySource, /updateBasicActivityResourceDialogField/);
  assert.match(basicActivitySource, /syncBasicActivityResourceSummaries/);
  assert.match(basicActivitySource, /basicActivitySupportResourceRows/);
  assert.match(basicActivitySource, /data-basic-activity-dialog-close/);
  assert.match(basicActivitySource, /basicActivityScopeSelect/);
  assert.match(basicActivitySource, /basicActivityPersonnelProfessionalOptions/);
  assert.match(basicActivitySource, /basicActivityResourceDialogTextInput/);
  assert.doesNotMatch(basicActivitySource, /弹药|ammunition/);

  const jobTableSource = appSource.slice(
    appSource.indexOf("function renderSupportActivityJobTable"),
    appSource.indexOf("function renderBasicActivityLibrary")
  );
  assert.match(jobTableSource, /data-support-activity-job-add="\$\{htmlEscape\(tabKey\)\}"/);
  assert.match(jobTableSource, /data-support-activity-job-batch-delete="\$\{htmlEscape\(tabKey\)\}"/);
  assert.match(jobTableSource, /data-support-activity-job-template/);
  assert.match(jobTableSource, /basicActivityLibraryOptions/);
  assert.match(appSource, /function applyBasicActivityToSupportActivityJob/);
  assert.match(appSource, /function addBasicActivityAsSupportActivityPredecessor/);
  assert.match(jobTableSource, /data-support-activity-job-field/);
  assert.match(jobTableSource, /renderSupportActivityJobDialog/);
  assert.match(jobTableSource, /renderSupportActivityPredecessorDialog/);
  assert.match(jobTableSource, /data-support-activity-job-dialog-close/);
  assert.match(jobTableSource, /table-edit-select/);
  assert.match(jobTableSource, /supportActivityJobBasicActivitySelect/);
  assert.match(jobTableSource, /data-support-activity-job-template-select/);
  assert.doesNotMatch(jobTableSource, /<th>保障人员<\/th><th>保障设备<\/th><th>备件<\/th>/);
  assert.doesNotMatch(jobTableSource, /<label>保障人员/);
  assert.doesNotMatch(jobTableSource, /<label>保障设备/);
  assert.doesNotMatch(jobTableSource, /<label>备件/);
  assert.doesNotMatch(jobTableSource, /弹药|ammunition/);
  assert.match(jobTableSource, /function buildSupportActivityGanttRows/);
  assert.match(jobTableSource, /function renderSupportActivityGanttChart/);
  assert.match(jobTableSource, /保障活动图/);
  assert.match(jobTableSource, /data-support-activity-gantt/);
  assert.match(jobTableSource, /ganttPredecessorIndexes/);
  assert.match(appSource, /data-support-activity-predecessor-toggle/);
  assert.match(appSource, /const supportActivityPlanAddButton = event\.target\.closest\("\[data-support-activity-plan-add\]"\)/);
  assert.match(appSource, /const supportActivityPlanSelectButton = event\.target\.closest\("\[data-select-support-activity-plan\]"\)/);
  assert.match(appSource, /const supportActivityPlanDeleteButton = event\.target\.closest\("\[data-support-activity-plan-delete\]"\)/);
  assert.match(appSource, /const preventiveActivityPlanAddButton = event\.target\.closest\("\[data-preventive-activity-plan-add\]"\)/);
  assert.match(appSource, /const preventiveActivityPlanDeleteButton = event\.target\.closest\("\[data-preventive-activity-plan-delete\]"\)/);
  assert.match(appSource, /const preventiveActivityPlanSelectButton = event\.target\.closest\("\[data-select-preventive-activity-plan\]"\)/);
  assert.match(appSource, /const preventiveAircraftSelectButton = event\.target\.closest\("\[data-select-preventive-aircraft-model\]"\)/);
  assert.match(appSource, /function selectOperationsSupportActivityPlan/);
  assert.match(appSource, /function addOperationsSupportActivityPlan/);
  assert.match(appSource, /function deleteOperationsSupportActivityPlan/);
  assert.match(appSource, /function selectPreventiveMaintenanceAircraftModel/);
  assert.match(appSource, /function selectPreventiveMaintenanceActivityPlan/);
  assert.match(appSource, /function addPreventiveMaintenanceActivityPlan/);
  assert.match(appSource, /function deletePreventiveMaintenanceActivityPlan/);

  const operationsSource = appSource.slice(
    appSource.indexOf("function renderOperationsSupportActivity"),
    appSource.indexOf("function renderPreventiveMaintenanceActivity")
  );
  const operationsPlanTypeSource = appSource.slice(
    appSource.indexOf("function operationsSupportPlanTypeConfigs"),
    appSource.indexOf("function operationsSupportPlanTypeTabKey")
  );
  assert.match(appSource, /const supportActivityPhaseTabButton = event\.target\.closest\("\[data-ops-support-plan-type\]"\)/);
  assert.match(appSource, /function operationsSupportPlanTypeConfigs\(\)/);
  assert.match(appSource, /function ensureOperationsSupportPhaseActivities/);
  assert.match(appSource, /function findOperationsSupportPhaseActivities/);
  assert.match(appSource, /function operationsSupportPlanGroupId/);
  assert.match(appSource, /function nextOperationsSupportPlanGroupId/);
  assert.match(operationsPlanTypeSource, /飞行前准备/);
  assert.match(operationsPlanTypeSource, /再次出动准备/);
  assert.match(operationsPlanTypeSource, /飞行后检查/);
  assert.match(appSource, /planGroupId/);
  assert.match(appSource, /ensureOperationsSupportPlanGroupId\(entry\.activity, entry\.aircraftModel\)/);
  assert.match(operationsSource, /data-ops-support-plan-type/);
  assert.match(operationsSource, /operationsSupportPlanTypeTabKey\(activePlanType\)/);
  assert.match(operationsSource, /activePhaseActivity/);
  assert.match(operationsSource, /const planNameActivity = operationsSupportPlanNameActivity\(activity, phaseActivities\)/);
  assert.match(operationsSource, /field\("方案名称", `supportActivities\.\$\{planNameActivityIndex\}\.activityName`\)/);
  assert.doesNotMatch(operationsSource, /field\("方案名称", `supportActivities\.\$\{activityIndex\}\.activityName`\)/);
  assert.ok(
    operationsSource.indexOf('field("方案名称", `supportActivities.${planNameActivityIndex}.activityName`)')
      < operationsSource.indexOf("<h3>使用保障活动编辑</h3>"),
    "方案名称应渲染在使用保障活动编辑标题上方"
  );
  assert.doesNotMatch(operationsSource, /maxWorkTimeRefMinutes/);
  assert.doesNotMatch(operationsSource, /<input(?![^>]*(data-path|readonly|disabled))/);

  const preventiveSource = appSource.slice(
    appSource.indexOf("function renderPreventiveMaintenanceActivity"),
    appSource.indexOf("function renderEquipmentConfigTree")
  );
  assert.match(appSource, /function preventiveMaintenanceActivityEntries/);
  assert.match(appSource, /selectedPreventiveMaintenanceAircraftModel/);
  assert.match(appSource, /data-select-preventive-aircraft-model/);
  assert.match(appSource, /data-select-preventive-activity-plan/);
  assert.match(appSource, /data-preventive-activity-plan-add/);
  assert.match(appSource, /data-preventive-activity-plan-delete/);
  assert.doesNotMatch(preventiveSource, /<input(?![^>]*(data-path|readonly|disabled))/);

  const correctiveSource = appSource.slice(
    appSource.indexOf("function renderCorrectiveMaintenanceActivity"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );
  const readonlyEquipmentConfigSource = appSource.slice(
    appSource.indexOf("function buildReadonlyEquipmentConfigComponentTreeNodes"),
    appSource.indexOf("function correctiveReferenceComponent")
  );
  assert.doesNotMatch(correctiveSource, /<input(?![^>]*(data-path|readonly|disabled))/);
  assert.doesNotMatch(correctiveSource, /scenario\.components\[0\]/);
  assert.doesNotMatch(correctiveSource, /renderSupportActivityJobTable\(activity, "corr_repair"\)/);
  assert.match(appSource, /function correctiveMaintenanceActivityForComponent/);
  assert.match(appSource, /function ensureCorrectiveMaintenanceActivityForComponent/);
  assert.match(appSource, /function selectedCorrectiveMaintenanceActivity/);
  assert.match(appSource, /correctiveMaintenanceActivityForComponent\(selectedCorrectiveComponent\(\)\)/);
  assert.doesNotMatch(correctiveSource, /维修对象/);
  assert.doesNotMatch(correctiveSource, /maxRepairTimeMinutes/);
  assert.match(correctiveSource, /MTTR/);
  assert.match(correctiveSource, /readonly/);
  assert.match(correctiveSource, /distribution\.rate/);
  assert.match(correctiveSource, /distribution\.min/);
  assert.match(correctiveSource, /distribution\.max/);
  assert.match(correctiveSource, /distribution\.variance/);
  assert.match(correctiveSource, /data-path="supportActivities\.\$\{activityIndex\}\.repairType"/);
  assert.match(readonlyEquipmentConfigSource, /const visitedIds = new Set\(visited\)/);
  assert.match(readonlyEquipmentConfigSource, /componentId !== String\(parentId\)/);
  assert.match(readonlyEquipmentConfigSource, /!visitedIds\.has\(componentId\)/);
});

test("support activity render paths do not mutate supportActivities implicitly", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const operationsSource = appSource.slice(
    appSource.indexOf("function renderOperationsSupportActivity"),
    appSource.indexOf("function renderPreventiveMaintenanceActivity")
  );
  const jobLookupSource = appSource.slice(
    appSource.indexOf("function findSupportActivityByJobTabKey"),
    appSource.indexOf("function selectedSupportActivityJobIndexForTab")
  );
  const selectedCorrectiveSource = appSource.slice(
    appSource.indexOf("function selectedCorrectiveMaintenanceActivity"),
    appSource.indexOf("function ensureCorrectiveMaintenanceActivityForComponent")
  );
  const correctiveSource = appSource.slice(
    appSource.indexOf("function renderCorrectiveMaintenanceActivity"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );

  assert.match(operationsSource, /findOperationsSupportPhaseActivities\(activity\)/);
  assert.doesNotMatch(operationsSource, /ensureOperationsSupportPhaseActivities/);
  assert.match(jobLookupSource, /findOperationsSupportPhaseActivities\(baseActivity\)/);
  assert.doesNotMatch(jobLookupSource, /ensureOperationsSupportPhaseActivities/);
  assert.match(selectedCorrectiveSource, /correctiveMaintenanceActivityForComponent\(selectedCorrectiveComponent\(\)\)/);
  assert.doesNotMatch(selectedCorrectiveSource, /ensureCorrectiveMaintenanceActivityForComponent/);
  assert.match(correctiveSource, /correctiveMaintenanceActivityForComponent\(selectedCorrectiveComponent\(\)\)/);
  assert.doesNotMatch(correctiveSource, /ensureCorrectiveMaintenanceActivityForComponent/);
  assert.doesNotMatch(correctiveSource, /scenario\.supportActivities\.push/);
});

test("basic corrective activity scope edits move only the edited job to the target component", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const updateSource = appSource.slice(
    appSource.indexOf("function updateBasicActivityJobField"),
    appSource.indexOf("function updateBasicActivityResourceField")
  );
  const moveSource = appSource.slice(
    appSource.indexOf("function moveCorrectiveBasicActivityJobToScope"),
    appSource.indexOf("function updateBasicActivityResourceField")
  );
  const ensureSource = appSource.slice(
    appSource.indexOf("function ensureCorrectiveMaintenanceActivityForComponent"),
    appSource.indexOf("function nextCorrectiveMaintenanceActivityId")
  );

  assert.match(updateSource, /moveCorrectiveBasicActivityJobToScope\(activity, jobIndex, value\)/);
  assert.match(moveSource, /isCorrectiveMaintenanceActivity\(activity\)/);
  assert.match(moveSource, /componentForBasicActivityScope\(value\)/);
  assert.match(moveSource, /ensureCorrectiveMaintenanceActivityForComponent\(component, \{ copyTemplateJobs: false \}\)/);
  assert.match(moveSource, /sourceJobs\.splice\(jobIndex, 1\)/);
  assert.match(moveSource, /targetJobs\.push\(job\)/);
  assert.match(ensureSource, /copyTemplateJobs = true/);
  assert.match(ensureSource, /activity\.jobs = copyTemplateJobs \? supportActivityJobs\(template\)\.map/);
});

test("modeling data-path inputs commit on change instead of rerendering on each keystroke", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const inputListenerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("input"'),
    appSource.indexOf("const systemUserInput")
  );
  const changeListenerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("change"'),
    appSource.indexOf('app.addEventListener("input"')
  );

  const livePathInputSource = inputListenerSource.slice(
    inputListenerSource.indexOf("const livePathInput"),
    inputListenerSource.indexOf("const systemUserInput")
  );
  assert.match(livePathInputSource, /const livePathInput = event\.target\.closest\("\[data-path\]"\)/);
  assert.match(livePathInputSource, /return;/);
  assert.doesNotMatch(livePathInputSource, /setPath\(scenario, livePathInput\.dataset\.path/);
  assert.doesNotMatch(livePathInputSource, /markProjectDraftChanged\(\)/);
  assert.match(changeListenerSource, /setPath\(scenario, input\.dataset\.path, parseInput\(input\)\)/);
  assert.match(changeListenerSource, /markProjectDraftChanged\(\)/);
  assert.match(changeListenerSource, /render\(\)/);
});

test("reliability block diagram prototype exposes node edge and k-out-of-n fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const rbdSource = appSource.slice(
    appSource.indexOf("function renderReliabilityBlockDiagram"),
    appSource.indexOf("function renderResourceTable")
  );
  assert.match(rbdSource, /装备可靠性框图/);
  assert.match(rbdSource, /organization-layout equipment-layout rbd-layout/);
  assert.match(rbdSource, /装备结构树/);
  assert.match(rbdSource, /buildRbdEquipmentTreeNodes/);
  assert.match(rbdSource, /reliabilityDiagramProjectForSelection/);
  assert.match(rbdSource, /buildReliabilityBlockDiagramLayout/);
  assert.match(rbdSource, /renderReliabilityBlockDiagramSvg/);
  assert.match(rbdSource, /const tableNodes = Array\.isArray\(layout\.logicalNodes\)/);
  assert.match(rbdSource, /rbdNodeMetaText/);
  assert.doesNotMatch(rbdSource, /if \(!nodes\.length\)\s*{\s*return importedDataEmptyState/);
  assert.match(rbdSource, /data-select-rbd-equipment-root/);
  assert.match(rbdSource, /data-select-rbd-equipment-aircraft/);
  assert.match(rbdSource, /data-select-rbd-equipment-component/);
  assert.match(rbdSource, /n中取k/);
  assert.match(rbdSource, /节点类型/);
  assert.match(rbdSource, /连接关系/);
  assert.match(rbdSource, /节点可靠度/);
  assert.match(rbdSource, /失效率/);
  assert.match(rbdSource, /MTBF/);
  assert.match(rbdSource, /k-out-of-n/);
  assert.match(rbdSource, /串联\/并联\/备用\/k-out-of-n/);
  assert.match(rbdSource, /门逻辑/);
});

test("reliability block diagram rendering contract documents selection and k-out-of-n rules", async () => {
  const contract = await readFile(RBD_RENDERING_CONTRACT_URL, "utf8");

  for (const requiredText of [
    "装备可靠性框图绘图契约",
    "飞机列表",
    "不显示任何框图内容",
    "选中整机或组件时，只显示当前选中节点的直接下一级节点",
    "不显示当前选中节点自身",
    "显式 reliabilityBlockDiagram 只有顶层节点时",
    "回退/融合 components",
    "n中取k",
    "外层并联框",
    "展开 N 个同名分支节点",
    "逻辑表格只保留一行",
    "J-15 > 发动机",
    "发动机控制模块",
    "J-35 > 航电系统",
    "任务计算机模块",
    "并联 / 2中取1"
  ]) {
    assert.ok(contract.includes(requiredText), requiredText);
  }
});

test("simulation modeling omits result import allocation-management page", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /renderImportTable/);
  assert.doesNotMatch(appSource, /page\.component === "import-table"/);
  assert.doesNotMatch(catalogSource, /指标分配方案管理/);
  assert.doesNotMatch(catalogSource, /结果导入/);
  assert.doesNotMatch(catalogSource, /import-table/);
});

test("topbar omits run and export actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const topbarSource = appSource.slice(
    appSource.indexOf("<header class=\"topbar\">"),
    appSource.indexOf("function renderLoginPage")
  );
  assert.doesNotMatch(topbarSource, /运行单次仿真/);
  assert.doesNotMatch(topbarSource, /运行 Monte Carlo/);
  assert.doesNotMatch(topbarSource, /导出方案 JSON/);
  assert.doesNotMatch(topbarSource, /downloadJson/);
  assert.match(topbarSource, /<p>\$\{htmlEscape\(currentProject\?\.name \|\| "未选择项目"\)\}<\/p>/);
  assert.doesNotMatch(appSource, /function renderTopbarContext/);
  assert.doesNotMatch(appSource, /renderTopbarContext\(page\)/);
});

test("frontend tables do not use generic operation column headers", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /<th(?:\s[^>]*)?>\s*操作\s*<\/th>/);
});

test("monte carlo configuration drives the displayed result sample count", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario, \{ samples: 4 \}\)/);
  assert.match(appSource, /let \{ previewSingleResult: singleResult, previewMonteCarloResult: monteCarloResult \} = buildPreviewResultState\(scenario\)/);
  assert.match(appSource, /id="mc-samples"[^>]*data-experiment-plan-path="experiment\.samples"/);
  assert.match(appSource, /function updatePreviewResultsThroughApiClient/);
  assert.match(appSource, /data-save-plan/);
});

test("monte carlo sweep inputs update scenario arrays and rerun grouped results", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /data-mc-array-path="monteCarlo\.failureRates"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.spareMultipliers"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.supportCapacities"/);
  assert.match(appSource, /const mcArrayInput = event\.target\.closest\("\[data-mc-array-path\]"\)/);
  assert.match(appSource, /setPath\(experimentPlanDraft, mcArrayInput\.dataset\.mcArrayPath, parseNumberList\(mcArrayInput\.value\)\)/);
  assert.match(appSource, /function parseNumberList/);
  assert.match(appSource, /updatePreviewResultsThroughApiClient\(experimentPlanDraft\)/);
  assert.match(appSource, /const savePlanButton = event\.target\.closest\("\[data-save-plan\]"\)/);
});

test("monte carlo experiment management has list, editor, and detail pages", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const createExperimentSource = appSource.slice(
    appSource.indexOf("function createMonteCarloExperiment"),
    appSource.indexOf("function monteCarloExperimentListForModule")
  );
  assert.match(appSource, /class="mc-workbench"/);
  assert.match(appSource, /function renderMonteCarloExperimentList/);
  assert.match(appSource, /function renderMonteCarloExperimentEditor/);
  assert.match(appSource, /function renderMonteCarloExperimentDetail/);
  for (const sharedField of [
    "experiment_id",
    "experiment_type",
    "experimentPlanName",
    "scenarioId",
    "seed",
    "status",
    "progress",
    "runId",
    "artifactId"
  ]) {
    assert.match(createExperimentSource, new RegExp(`${sharedField}(\\s*:|,)`), `MonteCarloExperiment must carry ${sharedField}`);
  }
  assert.match(appSource, /蒙特卡洛实验列表/);
  assert.match(appSource, /保存全部实验运行历史/);
  assert.match(appSource, /添加\/编辑蒙特卡洛实验/);
  assert.match(appSource, /蒙特卡洛实验详情/);
  assert.match(appSource, /选择方案/);
  assert.match(appSource, /class="readonly-field"/);
  assert.match(appSource, /仿真次数/);
  assert.match(appSource, /data-mc-action="start"/);
  assert.match(appSource, /experimentRunStatus = "运行中"/);
  assert.match(appSource, /htmlEscape\(experiment\.status\)/);
  assert.match(appSource, /selectedFeatureId = getMonteCarloExperimentDetailFeatureId\(page\.module\)/);
  assert.doesNotMatch(appSource, /class="mc-main-tabs"/);
  assert.doesNotMatch(appSource, /class="mc-subtabs"/);
  assert.doesNotMatch(appSource, /正交实验配置与分析/);
  assert.doesNotMatch(appSource, /正交因素/);
  assert.doesNotMatch(appSource, /预检查/);
  assert.match(styleSource, /\.mc-workbench/);
  assert.match(styleSource, /\.mc-config-panel/);
});

test("browser smoke enters monte carlo editor or detail before using sweep inputs", async () => {
  const smokeSource = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");
  const smokeStart = smokeSource.indexOf('await clickFeature(page, "spare-planning-monte-carlo-experiment-list")');
  const smokeEnd = smokeSource.indexOf('await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem("spare-mvp:lastBackendRun")');
  const smokeMonteCarloSource = smokeSource.slice(
    smokeStart,
    smokeEnd
  );
  const helperStart = smokeSource.indexOf("async function openMonteCarloExperimentForRun");
  const helperEnd = smokeSource.indexOf("async function openMonteCarloExperimentDetailForRun");
  const openExperimentSource = smokeSource.slice(
    helperStart,
    helperEnd
  );

  assert.notEqual(smokeStart, -1, "smoke Monte Carlo flow start marker exists");
  assert.doesNotMatch(smokeMonteCarloSource, /spare-planning-monte-carlo-config/);
  assert.notEqual(smokeEnd, -1, "smoke Monte Carlo flow end marker exists");
  assert.ok(smokeEnd > smokeStart, "smoke Monte Carlo result navigation follows config flow");
  assert.notEqual(helperStart, -1, "smoke open experiment helper exists");
  assert.notEqual(helperEnd, -1, "smoke detail helper follows open experiment helper");
  assert.ok(helperEnd > helperStart, "smoke helper source slice is ordered");
  assert.match(openExperimentSource, /data-mc-experiment-action="edit"/);
  assert.match(openExperimentSource, /data-mc-experiment-action="add"/);
  assert.ok(
    smokeMonteCarloSource.indexOf("openMonteCarloExperimentForRun") <
      smokeMonteCarloSource.indexOf('data-mc-array-path="monteCarlo.failureRates"'),
    "smoke must leave the Monte Carlo experiment list before filling sweep inputs"
  );
  assert.ok(
    smokeMonteCarloSource.indexOf("document.activeElement?.blur()") >
      smokeMonteCarloSource.indexOf('data-mc-array-path="monteCarlo.failureRates"') &&
      smokeMonteCarloSource.indexOf("document.activeElement?.blur()") <
        smokeMonteCarloSource.indexOf("openMonteCarloExperimentDetailForRun"),
    "smoke must apply the sweep input change before clicking through to detail"
  );
  assert.match(smokeSource, /data-mc-action="start"/);
  assert.match(smokeSource, /function openMonteCarloExperimentForRun/);
});

test("analysis pages manage analysis tasks and can auto-create a bound monte carlo experiment", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const analysisSource = appSource.slice(
    appSource.indexOf("function renderAnalysisTaskList"),
    appSource.indexOf("function renderBar")
  );
  const bindingSource = appSource.slice(
    appSource.indexOf("function ensureAnalysisTaskMonteCarloExperiment"),
    appSource.indexOf("function renderAnalysisTaskList")
  );

  assert.match(appSource, /function ensureAnalysisTaskMonteCarloExperiment/);
  assert.match(appSource, /function createAnalysisTaskForPage/);
  assert.match(appSource, /function updateAnalysisTaskFormField/);
  assert.match(appSource, /function updateSelectedAnalysisTaskFromForm/);
  assert.match(appSource, /analysisTaskInput\.tagName === "SELECT"/);
  assert.match(analysisSource, /分析任务列表/);
  assert.match(analysisSource, /创建\/编辑\/删除/);
  assert.match(analysisSource, /data-analysis-action="create-with-mc"/);
  assert.match(analysisSource, /data-analysis-action="edit"/);
  assert.match(analysisSource, /data-analysis-action="save"/);
  assert.match(analysisSource, /data-analysis-action="delete"/);
  assert.match(analysisSource, /data-analysis-task-field="experimentPlanName"/);
  assert.match(analysisSource, /data-analysis-task-field="samples"/);
  assert.match(analysisSource, /选择方案 \+ 参数后自动创建一个新的蒙特卡洛实验并绑定分析任务/);
  assert.match(analysisSource, /linkedMonteCarloExperimentId/);
  assert.match(analysisSource, /mc_experiment_id/);
  assert.match(bindingSource, /experiment\.mc_experiment_id === task\.linkedMonteCarloExperimentId/);
  assert.match(bindingSource, /if \(existing && !options\.forceNew\) return existing/);
  assert.match(bindingSource, /source: "analysis:auto-created"/);
  assert.match(bindingSource, /linkedMonteCarloExperimentId: experiment\.mc_experiment_id/);
});

test("experiment plan editor edits an isolated branch rather than the project draft", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const editorSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanEditor"),
    appSource.indexOf("async function handleLogin")
  );
  const experimentPlanChangeSource = appSource.slice(
    appSource.indexOf('const experimentPlanInput = event.target.closest("[data-experiment-plan-path]"'),
    appSource.indexOf('const rmsInput = event.target.closest("[data-rms-path]"')
  );
  const saveButtonSource = appSource.slice(
    appSource.indexOf('const savePlanButton = event.target.closest("[data-save-plan]"'),
    appSource.indexOf('const periodicAddButton = event.target.closest("[data-periodic-add]"')
  );
  const createBranchSource = appSource.slice(
    appSource.indexOf("function createExperimentPlanBranchFromCurrentProject"),
    appSource.indexOf("function renderCollapsibleTree")
  );

  assert.match(editorSource, /data-experiment-plan-path/);
  assert.match(appSource, /function createExperimentPlanBranchFromCurrentProject/);
  assert.match(appSource, /createExperimentPlanBranchFromCurrentProject\(\)/);
  assert.match(createBranchSource, /if \(experimentPlanBranchActive\) return/);
  assert.match(experimentPlanChangeSource, /setPath\(experimentPlanDraft, experimentPlanInput\.dataset\.experimentPlanPath/);
  assert.doesNotMatch(experimentPlanChangeSource, /setPath\(scenario/);
  assert.match(saveButtonSource, /saveCurrentExperimentPlanThroughApi\(\)/);
  assert.doesNotMatch(saveButtonSource, /saveCurrentProjectThroughApi\(\)/);
});

test("monte carlo launch creates a run from the current experiment plan branch", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );

  assert.match(launchSource, /const planProjectJson = buildBackendProjectJson\(experimentPlanDraft, currentProject\)/);
  assert.match(appSource, /import \{[^}]*buildRunIntent[^}]*submitRunIntent[^}]*\} from "\.\/run-intent\.mjs"/s);
  assert.match(launchSource, /submitRunIntent\(backendApi,\s*\{/);
  assert.match(launchSource, /const runType = "monte_carlo"/);
  assert.match(launchSource, /runType,/);
  assert.match(launchSource, /modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY/);
  assert.match(launchSource, /mcExperimentId: monteCarloExperimentId/);
  assert.match(appSource, /startMonteCarloRunThroughApi\(\{ monteCarloExperimentId: experiment\.mc_experiment_id/);
  assert.doesNotMatch(launchSource, /sample_count\s*:/);
  assert.doesNotMatch(launchSource, /samples\s*:/);
  assert.doesNotMatch(launchSource, /sweep\s*:/);
  assert.doesNotMatch(launchSource, /run_type: "single"/);
  assert.doesNotMatch(launchSource, /backendApi\.startSimulationRun/);
  assert.doesNotMatch(launchSource, /backendApi\.startMonteCarloRun/);
});

test("M9.8 visual and formal run launches use aircraft_support_v1 through canonical runs", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const runIntentSource = await readFile(new URL("../front/run-intent.mjs", import.meta.url), "utf8");
  const singleLaunchSource = appSource.slice(
    appSource.indexOf("async function startSingleRunThroughApi"),
    appSource.indexOf("async function startMonteCarloRunThroughApi")
  );
  const monteCarloLaunchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function mesaTab")
  );
  const visualNewRunSource = appSource.slice(
    appSource.indexOf('if (action === "start-new-run")'),
    appSource.indexOf("function startVisualizationReplay")
  );

  assert.match(appSource, /const FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY = "aircraft_support_v1"/);
  assert.match(runIntentSource, /modelFamily = "aircraft_support_v1"/);
  assert.match(singleLaunchSource, /submitRunIntent\(backendApi,\s*\{/);
  assert.match(singleLaunchSource, /modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY/);
  assert.match(monteCarloLaunchSource, /submitRunIntent\(backendApi,\s*\{/);
  assert.match(monteCarloLaunchSource, /modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY/);
  assert.match(visualNewRunSource, /await startSingleRunThroughApi\(\)/);
  assert.doesNotMatch(visualSource, /formal run \/ aircraft_support_v1/);
  assert.match(visualSource, /canonical \/api\/runs/);
  assert.doesNotMatch(visualSource, /mesa-abm-skill/);
  assert.doesNotMatch(visualSource, /Mesa ABM \/ aviation_support/);
});

test("M9.8 docs mark platform embedding complete without making independent-mesa a runtime entry", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    roadmap: await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /M9\.8[^。]*(平台嵌入|嵌入平台)[^。]*(完成|收束|已)/);
  assert.match(combined, /aircraft_support_v1[^。]*canonical `?\/api\/runs`?/);
  assert.match(combined, /independent-mesa[^。]*(源码树已移除|源码树已从当前仓库移除|当前源码树移除)/);
  assert.doesNotMatch(combined, /M9\.8[^。]*(8765|independent-mesa\/server\.py)[^。]*(正式产品入口|平台运行必需|启动平台所需)/);
});

test("frontend code no longer references legacy simulation run routes", async () => {
  const files = [
    "../front/api-client.mjs",
    "../front/app.js",
    "../front/run-intent.mjs"
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/simulation-runs/);
  }
});

test("M7 run artifact panel renders artifact identity and lifecycle controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /listRuns\(/);
  assert.match(appSource, /getRunDetail\(/);
  assert.match(appSource, /downloadRunArtifact\(/);
  assert.match(appSource, /archiveRun\(/);
  assert.match(appSource, /deleteRun\(/);
  assert.match(appSource, /artifact_id/);
  assert.match(appSource, /sha256/);
  assert.match(appSource, /size_bytes/);
  assert.match(appSource, /data-action="m7-archive-run"/);
  assert.match(appSource, /data-action="m7-delete-run"/);
  assert.match(appSource, /lifecycle_status/);
  assert.match(appSource, /canManageM7Lifecycle\(\)/);
  assert.match(appSource, /currentUser\.role/);
  assert.match(appSource, /deleted run 禁止下载 artifact/);
  assert.match(appSource, /URL\.createObjectURL/);
  assert.match(appSource, /anchor\.download/);
  assert.doesNotMatch(appSource, /不解析 projection artifact payload，也不把下载内容用于 KPI 卡片/);
  assert.match(appSource, /M8 分析页会另行读取 projection payload/);
  assert.doesNotMatch(appSource, /\/api\/simulation-runs/);
});

test("M7 run artifact actions surface backend errors and preserve failed-run log artifacts", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const actionSource = appSource.slice(
    appSource.indexOf("async function handleM7RunArtifactAction"),
    appSource.indexOf("function artifactDownloadName")
  );
  const failedRunSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );

  assert.match(actionSource, /try \{/);
  assert.match(actionSource, /catch \(err\)/);
  assert.match(actionSource, /formatBackendError\(err\)/);
  assert.match(actionSource, /m7ActionLabel\(action\)/);
  assert.match(actionSource, /canManageM7Lifecycle\(\)/);
  assert.match(actionSource, /无权归档运行|无权软删除运行/);
  assert.match(appSource, /function formatBackendError\(err\)/);
  assert.match(appSource, /err\.status/);
  assert.match(appSource, /err\.code/);
  assert.match(failedRunSource, /await refreshRunFailureArtifacts\(backendRun\.run_id\)/);
  assert.doesNotMatch(failedRunSource, /backendArtifactManifest = \{ artifacts: \[\] \};\s*backendRunChain = null;\s*lastRunExperimentPlanProjectJson = null;/);
  assert.match(appSource, /async function refreshRunFailureArtifacts/);
  assert.match(appSource, /m7RunDetail\?\.artifact_manifest/);
});

test("M7 run refresh is allowed before any selected run guard", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const refreshPanelSource = appSource.slice(
    appSource.indexOf("async function refreshM7RunArtifactPanel"),
    appSource.indexOf("async function handleM7RunArtifactAction")
  );
  const actionSource = appSource.slice(
    appSource.indexOf("async function handleM7RunArtifactAction"),
    appSource.indexOf("function artifactDownloadName")
  );
  const refreshBranchIndex = actionSource.indexOf('action === "m7-refresh-runs"');
  const missingRunGuardIndex = actionSource.indexOf("if (!runId)");
  const detailBranchIndex = actionSource.indexOf('action === "m7-detail-run"');
  const downloadBranchIndex = actionSource.indexOf('action === "m7-download-artifact"');
  const archiveBranchIndex = actionSource.indexOf('action === "m7-archive-run"');
  const deleteBranchIndex = actionSource.indexOf('action === "m7-delete-run"');

  assert.notEqual(refreshBranchIndex, -1, "refresh action branch exists");
  assert.notEqual(missingRunGuardIndex, -1, "missing run guard exists");
  assert.ok(refreshBranchIndex < missingRunGuardIndex, "refresh must run before the missing run_id guard");
  assert.match(refreshPanelSource, /backendApi\.listRuns\(\{\s*run_type: "monte_carlo",\s*include_deleted: 1\s*\}\)/);
  assert.ok(refreshPanelSource.indexOf("backendApi.listRuns") < refreshPanelSource.indexOf("if (!selectedRunId) return"));
  for (const [label, branchIndex] of [
    ["detail", detailBranchIndex],
    ["download", downloadBranchIndex],
    ["archive", archiveBranchIndex],
    ["delete", deleteBranchIndex]
  ]) {
    assert.ok(branchIndex > missingRunGuardIndex, `${label} remains guarded by run_id`);
  }
});

test("M7 browser smoke helper verifies archive and tombstone evidence", async () => {
  const smokeSource = await readFile(
    new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url),
    "utf8"
  );
  const loginSource = smokeSource.slice(
    smokeSource.indexOf("async function loginAndEnterProject"),
    smokeSource.indexOf("async function clickFeature")
  );
  const m7Source = smokeSource.slice(
    smokeSource.indexOf("async function verifyM7RunArtifactManagement"),
    smokeSource.indexOf("function assertHasIdentityChain")
  );
  const readEvidenceSource = smokeSource.slice(
    smokeSource.indexOf("async function readBackendEvidence"),
    smokeSource.indexOf("async function verifyM7RunArtifactManagement")
  );
  const offlineSource = smokeSource.slice(
    smokeSource.indexOf("const offlineContext = await browser.newContext"),
    smokeSource.indexOf("const result = {")
  );

  assert.match(loginSource, /button\[data-enter-workbench\]\[data-project-id\]/);
  assert.doesNotMatch(loginSource, /进入当前项目/);
  assert.match(readEvidenceSource, /function waitForBackendIdentityChain/);
  assert.match(readEvidenceSource, /requiredKeys = \["Project", "Snapshot", "ExperimentPlan", "Scenario", "Run", "Result", "ArtifactManifest"\]/);
  assert.match(readEvidenceSource, /requiredKeys\.every\(\(key\) => labels\.includes\(key\)\)/);
  assert.match(offlineSource, /const offlineContext = await browser\.newContext/);
  assert.match(offlineSource, /offlineContext\.addInitScript/);
  assert.match(offlineSource, /localStorage\.clear\(\)/);
  assert.match(offlineSource, /sessionStorage\.clear\(\)/);
  assert.match(offlineSource, /loginRouteUrl\(baseUrl\)/);
  assert.ok(
    offlineSource.indexOf("await loginAndEnterProject(offlinePage)") < offlineSource.indexOf('offlinePage.route("**/api/**"'),
    "offline smoke should block /api after login and project entry"
  );
  assert.ok(
    offlineSource.indexOf("offlineContext.addInitScript") < offlineSource.indexOf("await offlinePage.goto"),
    "offline smoke should clear storage before app boot"
  );
  for (const token of [
    "runListVisibleIncludesRunId",
    "detailVisible",
    "artifactColumnsVisible",
    "artifactSha25664",
    "downloadObserved",
    "filenameIncludesArtifactId",
    "archiveStateVisible",
    "tombstoneVisible",
    "softDeleteBoundaryVisible",
    "physicalDeletionImplied"
  ]) {
    assert.match(m7Source, new RegExp(token));
  }
  assert.match(m7Source, /data-action="m7-archive-run"/);
  assert.match(m7Source, /data-action="m7-delete-run"/);
  assert.match(m7Source, /不会被物理删除|不表示本地 artifact 文件被物理删除/);
});

test("M7 cold refresh lists runs while missing-run actions stay guarded", async () => {
  const calls = [];
  const listeners = {};
  const appNode = {
    innerHTML: "",
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    querySelector() {
      return null;
    }
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;

  globalThis.document = {
    querySelector(selector) {
      return selector === "#app" ? appNode : null;
    },
    createElement() {
      throw new Error("download anchor should not be created without a run_id");
    },
    body: {
      appendChild() {
        throw new Error("download anchor should not be appended without a run_id");
      }
    }
  };
  globalThis.location = { hash: "" };
  globalThis.window = {
    addEventListener(type, listener) {
      listeners[`window:${type}`] = listener;
    },
    location: globalThis.location
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {}
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    return {
      ok: true,
      json: async () => ({ runs: [] })
    };
  };

  const clickM7Action = async (dataset) => {
    const button = {
      dataset,
      closest(selector) {
        return selector === "[data-action^='m7-']" ? button : null;
      }
    };
    listeners.click({ target: button });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  try {
    await import(`../front/app.js?m7-cold-refresh=${Date.now()}`);
    assert.equal(typeof listeners.click, "function", "app click handler is bound");

    await clickM7Action({ action: "m7-refresh-runs", runId: "" });
    assert.deepEqual(calls, [
      { url: "/api/runs?run_type=monte_carlo&include_deleted=1", method: "GET" }
    ]);

    calls.length = 0;
    await clickM7Action({ action: "m7-open-run-detail", runId: "" });
    await clickM7Action({ action: "m7-download-artifact", runId: "", artifactId: "artifact-cold" });
    await clickM7Action({ action: "m7-archive-run", runId: "" });
    await clickM7Action({ action: "m7-delete-run", runId: "" });
    assert.deepEqual(calls, [], "detail, download, archive, and delete stay behind the missing run_id guard");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
    globalThis.fetch = previousFetch;
  }
});

test("formal runs do not consume local preview outputs", async () => {
  const apiClientSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");
  const runIntentSource = await readFile(new URL("../front/run-intent.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );
  const formalBoundarySource = appSource.slice(
    appSource.indexOf("function formalAnalysisBoundary"),
    appSource.indexOf("function renderAnalysisDashboard")
  );
  const previewSource = apiClientSource.slice(
    apiClientSource.indexOf("export function buildPreviewResultState"),
    apiClientSource.indexOf("export function buildFrontendResultState")
  );
  const formalUnlockSource = formalBoundarySource.slice(
    formalBoundarySource.indexOf("const formalUnlocked"),
    formalBoundarySource.indexOf("const state")
  );

  assert.match(apiClientSource, /export function buildPreviewResultState/);
  assert.match(previewSource, /runSimulation\(projectJson\)/);
  assert.match(previewSource, /runMonteCarlo\(projectJson\)/);
  assert.match(runIntentSource, /apiClient\.submitRun/);
  assert.doesNotMatch(launchSource, /updateDemoResultsThroughApiClient|updatePreviewResultsThroughApiClient/);
  assert.doesNotMatch(launchSource, /buildDemoResultState|buildPreviewResultState|runSimulation|runMonteCarlo|defaultScenario/);
  assert.doesNotMatch(refreshSource, /buildDemoResultState|runSimulation|runMonteCarlo|defaultScenario/);
  assert.doesNotMatch(formalUnlockSource, /\bsingleResult\b|\bmonteCarloResult\b|previewSingleResult|previewMonteCarloResult/);
  assert.match(appSource, /本地预览，不是正式后端仿真结果/);
});

test("M8 formal analysis pages load and render matching projection payloads", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const apiClientSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );
  const payloadSource = appSource.slice(
    appSource.indexOf("async function refreshAnalysisProjectionPayloads"),
    appSource.indexOf("function renderAnalysis")
  );
  const renderDashboardSource = appSource.slice(
    appSource.indexOf("function renderAnalysisDashboard"),
    appSource.indexOf("function renderBar")
  );

  assert.match(apiClientSource, /getRunArtifactPayload\(runId, artifactId\)/);
  assert.match(refreshSource, /await refreshAnalysisProjectionPayloads\(runId\)/);
  assert.match(payloadSource, /backendApi\.getRunArtifactPayload\(runId,\s*artifactId\)/);
  assert.match(payloadSource, /normalizeAnalysisProjectionPayload\(analysisType,\s*payload,\s*\{/);
  assert.match(payloadSource, /modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY/);
  assert.match(payloadSource, /projectionArtifactKindForAnalysisType\(analysisType\)/);
  assert.match(payloadSource, /analysisProjectionPayloads = \{\s*\.\.\.analysisProjectionPayloads/);
  assert.match(renderDashboardSource, /const formalProjection = analysisProjectionForBoundary\(boundary\)/);
  assert.match(renderDashboardSource, /formalProjection\?\.metrics \|\| metrics/);
  assert.doesNotMatch(renderDashboardSource, /boundary\.formalUnlocked \? "" : "<em>本地预览<\/em>"/);
  assert.match(renderDashboardSource, /projection payload/);
});

test("phase 6A spare shortfall formal table renders constraints and utilization", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const formalProjectionSource = appSource.slice(
    appSource.indexOf("function renderFormalProjectionBody"),
    appSource.indexOf("function renderAnalysisDashboard")
  );
  const spareProjectionSource = formalProjectionSource.slice(
    formalProjectionSource.indexOf('formalProjection.analysisType === "spare_shortfall"'),
    formalProjectionSource.indexOf('formalProjection.analysisType === "carry_list"')
  );

  assert.match(spareProjectionSource, /备件利用率/);
  assert.match(spareProjectionSource, /满足率约束/);
  assert.match(spareProjectionSource, /利用率约束/);
  assert.match(spareProjectionSource, /row\.utilization/);
  assert.match(spareProjectionSource, /row\.fillRateConstraint/);
  assert.match(spareProjectionSource, /row\.utilizationConstraint/);
});

test("formal run launch preserves queued or running backend status without treating it as unavailable", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const refreshIndex = launchSource.indexOf("await refreshRunResultThroughApi");
  const queuedIndex = Math.max(
    launchSource.indexOf('backendRun.status === "queued"'),
    launchSource.indexOf('backendRun.status === "running"'),
    launchSource.indexOf("queued"),
    launchSource.indexOf("running")
  );
  const queuedBranch = queuedIndex >= 0 && refreshIndex >= 0
    ? launchSource.slice(queuedIndex, refreshIndex)
    : "";

  assert.ok(queuedIndex >= 0, "launch path must branch on queued/running backend status");
  assert.ok(queuedIndex < refreshIndex, "queued/running branch must run before fetching final result/artifacts");
  assert.match(queuedBranch, /backendRun\s*=\s*submitted\.run|backendRun/);
  assert.match(queuedBranch, /experimentRunStatus\s*=/);
  assert.doesNotMatch(queuedBranch, /backendRun\s*=\s*null/);
  assert.doesNotMatch(queuedBranch, /后端不可用/);
});

test("project creation from modeling import uses the current or passed import id", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const clickSource = appSource.slice(
    appSource.indexOf('const createFromImportButton = event.target.closest("[data-project-create-from-import]"'),
    appSource.indexOf('const editProjectButton = event.target.closest("[data-project-edit]"')
  );
  const createSource = appSource.slice(
    appSource.indexOf("async function createSampleProjectFromPublishedImport"),
    appSource.indexOf("async function enterProject")
  );

  assert.match(clickSource, /createSampleProjectFromPublishedImport\(currentPublishedModelingImportId\(\)\)/);
  assert.match(createSource, /async function createSampleProjectFromPublishedImport\(importId/);
  assert.match(createSource, /ensurePublishedModelingImportForSampleProject/);
  assert.match(createSource, /backendApi\.createProjectFromModelingImport\(resolvedImportId\)/);
  assert.doesNotMatch(createSource, /createProjectFromModelingImport\(MODELING_IMPORT_DEMO_FIXTURE\.importId\)/);
});

test("frontend modeling import demo fixture stays aligned with complete imported sample data", () => {
  const objects = MODELING_IMPORT_DEMO_FIXTURE.objects;

  assert.deepEqual(objects.equipment.wholeMachineModels, ["J-15", "J-35"]);
  assert.ok(objects.equipmentAssets.length >= 10);
  assert.ok(objects.equipmentAssets.some((component) => component.id === "j15-avionics" && component.aircraftModel === "J-15" && component.rms));
  assert.ok(objects.missionProfiles[0].compositeTasks.length >= 2);
  assert.ok(objects.missionProfiles[0].periodicTasks.length >= 1);
  assert.ok(objects.missionProfiles[0].combatUnit.members.length >= 4);
  assert.ok(objects.supportResources.length >= 3);
  assert.ok(objects.supportResources[0].inventory["航电模块"] > 0);
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "修复性维修" && activity.jobs.length >= 2));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "后勤保障" && activity.transportStrategies.length >= 2));
});

test("frontend modeling import demo fixture is synchronized with canonical JSON fixture", async () => {
  const canonical = JSON.parse(await readFile(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  assert.deepEqual(MODELING_IMPORT_DEMO_FIXTURE, canonical);
});

test("project list separates imported sample projects from local manual drafts", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const projectSeedSource = appSource.slice(
    appSource.indexOf("const PROJECT_SOURCE"),
    appSource.indexOf("const ANALYSIS_PROJECTION_TYPES")
  );
  const projectListSource = appSource.slice(
    appSource.indexOf("function renderProjectListPage"),
    appSource.indexOf("function renderNavigation")
  );
  const createSource = appSource.slice(
    appSource.indexOf("async function createSampleProjectFromPublishedImport"),
    appSource.indexOf("function currentPublishedModelingImportId")
  );

  assert.match(projectSeedSource, /manual_draft: "manual_draft"/);
  assert.match(projectSeedSource, /imported_sample: "imported_sample"/);
  assert.doesNotMatch(projectSeedSource, /preview_fixture/);
  assert.match(projectSeedSource, /readManualDraftProjectsFromStorage\(\)/);
  assert.match(projectListSource, /可从已发布建模导入包生成示例项目，或添加本地 Project draft/);
  assert.match(projectListSource, /暂无项目/);
  assert.match(projectListSource, /projectSourceBadge\(project\)/);
  assert.match(projectListSource, /projectSourceHelpText\(project\)/);
  assert.match(createSource, /sourceKind: PROJECT_SOURCE\.imported_sample/);
  assert.match(createSource, /sourceImportId: created\.sourceImport\?\.import_id \|\| resolvedImportId/);
  assert.match(createSource, /name: projectJson\.experiment\?\.name \|\| "导入示例项目"/);
  assert.doesNotMatch(createSource, /name: projectJson\.missionProfile\?\.sourceImportId \|\| projectJson\.experiment\?\.name/);
  assert.match(createSource, /projectListStatus = `已从导入数据生成示例项目：\$\{project\.name\}；可用于正式后端测试`;/);
});

test("formal run starts only allow imported sample projects", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const guardSource = appSource.slice(
    appSource.indexOf("function currentProjectCanStartFormalRun"),
    appSource.indexOf("async function startSingleRunThroughApi")
  );
  const singleRunSource = appSource.slice(
    appSource.indexOf("async function startSingleRunThroughApi"),
    appSource.indexOf("async function startMonteCarloRunThroughApi")
  );
  const mcRunSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );

  assert.match(guardSource, /if \(!currentProject\) \{/);
  assert.match(guardSource, /currentProject\.sourceKind === PROJECT_SOURCE\.imported_sample/);
  assert.doesNotMatch(guardSource, /currentProject\.sourceKind !== PROJECT_SOURCE\.preview_fixture/);
  assert.match(guardSource, /请先创建或选择项目/);
  assert.match(guardSource, /本地草稿需要先通过建模导入发布链路生成示例项目/);
  assert.match(singleRunSource, /const formalRunGate = currentProjectCanStartFormalRun\(\);/);
  assert.match(singleRunSource, /if \(!formalRunGate\.allowed\) \{/);
  assert.match(singleRunSource, /backendApiStatus = formalRunGate\.message;/);
  assert.match(singleRunSource, /experimentRunStatus = "未配置";/);
  assert.match(mcRunSource, /const formalRunGate = currentProjectCanStartFormalRun\(\);/);
  assert.match(mcRunSource, /if \(!formalRunGate\.allowed\) \{/);
  assert.match(mcRunSource, /backendApiStatus = formalRunGate\.message;/);
  assert.match(mcRunSource, /experimentRunStatus = "未配置";/);
  assert.ok(singleRunSource.indexOf("currentProjectCanStartFormalRun()") < singleRunSource.indexOf("formalRunSubmitInFlight = true"));
  assert.ok(mcRunSource.indexOf("currentProjectCanStartFormalRun()") < mcRunSource.indexOf("formalRunSubmitInFlight = true"));
});

test("visual simulation new run ensures a backend-created imported sample before formal submit", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const ensureSource = appSource.slice(
    appSource.indexOf("async function ensureFormalRunImportedSampleProject"),
    appSource.indexOf("async function startSingleRunThroughApi")
  );
  const hydrateSource = appSource.slice(
    appSource.indexOf("async function hydrateCurrentProjectDraftFromApi"),
    appSource.indexOf("async function saveCurrentProjectDraftThroughApi")
  );
  const startNewRunSource = appSource.slice(
    appSource.indexOf('if (action === "start-new-run")'),
    appSource.indexOf("const controlAction = backendControlActions")
  );

  assert.match(ensureSource, /await hydrateCurrentProjectDraftFromApi\(\)/);
  assert.match(ensureSource, /scenario\?\.missionProfile\?\.sourceImportId/);
  assert.match(hydrateSource, /sourceKind: PROJECT_SOURCE\.imported_sample/);
  assert.match(hydrateSource, /sourceImportId/);
  assert.match(ensureSource, /createSampleProjectFromPublishedImport\(currentProject\?\.sourceImportId\)/);
  assert.match(ensureSource, /currentProjectCanStartFormalRun\(\)/);
  assert.match(ensureSource, /return currentProjectCanStartFormalRun\(\)/);
  assert.ok(
    ensureSource.indexOf("await hydrateCurrentProjectDraftFromApi()") <
      ensureSource.indexOf("createSampleProjectFromPublishedImport(currentProject?.sourceImportId)"),
    "visual launch should reuse a hydrated backend imported sample before asking the backend to create one"
  );
  assert.ok(
    startNewRunSource.indexOf("await ensureFormalRunImportedSampleProject()") <
      startNewRunSource.indexOf("await startSingleRunThroughApi()"),
    "visual launch should repair the frontend/backend imported-sample boundary before formal submit"
  );
});

test("click-based modeling mutations mark project draft dirty before rendering", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const requiredActions = [
    ["equipment add node", 'const equipmentAddNodeButton = event.target.closest("[data-equipment-add-node]"'],
    ["equipment delete node", 'const equipmentDeleteNodeButton = event.target.closest("[data-equipment-delete-node]"'],
    ["basic mission add", 'const basicMissionAddButton = event.target.closest("[data-basic-mission-add]"'],
    ["basic mission delete", 'const basicMissionDeleteButton = event.target.closest("[data-basic-mission-delete]"'],
    ["composite task add", 'const compositeTaskAddButton = event.target.closest("[data-composite-task-add]"'],
    ["composite task delete", 'const compositeTaskDeleteButton = event.target.closest("[data-composite-task-delete]"'],
    ["composite task item add", 'const compositeTaskItemAddButton = event.target.closest("[data-composite-task-item-add]"'],
    ["composite task item delete", 'const compositeTaskItemDeleteButton = event.target.closest("[data-composite-task-item-delete]"'],
    ["combat unit add", 'const combatUnitAddButton = event.target.closest("[data-combat-unit-add]"'],
    ["combat unit delete", 'const combatUnitDeleteButton = event.target.closest("[data-combat-unit-delete]"'],
    ["logistics transport add", 'const logisticsAddButton = event.target.closest("[data-logistics-transport-add]"'],
    ["logistics transport delete", 'const logisticsDeleteButton = event.target.closest("[data-logistics-transport-delete]"'],
    ["support activity plan add", 'const supportActivityPlanAddButton = event.target.closest("[data-support-activity-plan-add]"'],
    ["support activity plan delete", 'const supportActivityPlanDeleteButton = event.target.closest("[data-support-activity-plan-delete]"'],
    ["support activity job delete", 'const supportActivityJobDeleteButton = event.target.closest("[data-support-activity-job-delete]"'],
    ["support activity job batch delete", 'const supportActivityBatchDeleteButton = event.target.closest("[data-support-activity-job-batch-delete]"'],
    ["periodic task add", 'const periodicAddButton = event.target.closest("[data-periodic-add]"'],
    ["periodic task delete", 'const periodicDeleteButton = event.target.closest("[data-periodic-delete-selected]"']
  ];

  for (const [label, marker] of requiredActions) {
    const start = appSource.indexOf(marker);
    assert.notEqual(start, -1, label);
    const returnIndex = label.startsWith("logistics transport")
      ? appSource.indexOf("const supportActivityJobDeleteButton", start)
      : appSource.indexOf("return;", start);
    const actionSource = appSource.slice(start, returnIndex);
    assert.match(actionSource, /markProjectDraftChanged\(\)/, label);
    assert.ok(actionSource.lastIndexOf("markProjectDraftChanged()") < actionSource.lastIndexOf("render()"), label);
  }
});

test("run result refresh rebuilds frontend state from the experiment plan branch", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );
  const runPlanSource = appSource.slice(
    appSource.indexOf("function currentRunExperimentPlanProjectJson"),
    appSource.indexOf("function updateDemoResultsThroughApiClient")
  );

  assert.match(launchSource, /lastRunExperimentPlanProjectJson = \{\s*run_id: backendRun\.run_id,\s*project_json: submitted\.intent\.planProjectJson\s*\}/);
  assert.match(refreshSource, /backendApi\.getRunStatus\(runId\)/);
  assert.doesNotMatch(refreshSource, /backendApi\.getRun\(runId\)/);
  assert.match(refreshSource, /const planProjectJson = currentRunExperimentPlanProjectJson\(runId\)/);
  assert.match(refreshSource, /if \(!planProjectJson\)/);
  assert.match(runPlanSource, /lastRunExperimentPlanProjectJson\?\.run_id === runId/);
  assert.match(runPlanSource, /lastRunExperimentPlanProjectJson\.project_json/);
  assert.doesNotMatch(refreshSource, /buildBackendProjectJson\(scenario, currentProject\)/);
  assert.doesNotMatch(refreshSource, /buildBackendProjectJson\(experimentPlanDraft, currentProject\)/);
});

test("carry list analysis maps Chinese risk levels to visible priority badges", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const carrySource = appSource.slice(
    appSource.indexOf("function renderCarryListAnalysis"),
    appSource.indexOf("function renderTaskReliabilityAnalysis")
  );
  assert.match(carrySource, /priority: carryPriority\(row\.riskLevel\)/);
  assert.match(appSource, /function carryPriority\(riskLevel\)/);
  assert.match(appSource, /case "高":/);
  assert.match(appSource, /case "中":/);
  assert.match(appSource, /case "低":/);
});

test("phase 6B carry list analysis fixes objective to minimum carried spares", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const carrySource = appSource.slice(
    appSource.indexOf("function renderCarryListAnalysis"),
    appSource.indexOf("function carryPriority")
  );
  const formalProjectionSource = appSource.slice(
    appSource.indexOf("function renderFormalProjectionBody"),
    appSource.indexOf("function renderAnalysisDashboard")
  );
  const formalCarrySource = formalProjectionSource.slice(
    formalProjectionSource.indexOf('formalProjection.analysisType === "carry_list"'),
    formalProjectionSource.indexOf('formalProjection.analysisType === "mission_reliability"')
  );

  assert.doesNotMatch(appSource, /function carryObjectiveOption/);
  assert.doesNotMatch(appSource, /let carryObjective/);
  assert.doesNotMatch(carrySource, /<select>|优化条件|出动架次率|再次出动准备时间|carryObjectiveOption/);
  assert.match(carrySource, /携行备件越少越好/);
  assert.match(formalCarrySource, /携行备件越少越好/);
  assert.match(formalCarrySource, /projection payload/);
});

test("phase 6C mission reliability chart uses formal projection time sequence only", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const lineChartSource = appSource.slice(
    appSource.indexOf("function renderLineChart"),
    appSource.indexOf("function renderScenarioSwitch")
  );
  const reliabilitySource = appSource.slice(
    appSource.indexOf("function renderTaskReliabilityAnalysis"),
    appSource.indexOf("function renderDowntimeFactorAnalysis")
  );
  const formalProjectionSource = appSource.slice(
    appSource.indexOf("function renderFormalProjectionBody"),
    appSource.indexOf("function renderAnalysisDashboard")
  );
  const formalReliabilitySource = formalProjectionSource.slice(
    formalProjectionSource.indexOf('formalProjection.analysisType === "mission_reliability"'),
    formalProjectionSource.indexOf('formalProjection.analysisType === "downtime_factors"')
  );

  assert.match(lineChartSource, /const minY = 0;/);
  assert.doesNotMatch(lineChartSource, /0\.84/);
  assert.match(lineChartSource, /points\.length - 1/);
  assert.match(reliabilitySource, /analysisProjectionForBoundary\(boundary\)/);
  assert.match(reliabilitySource, /renderFormalProjectionBody\(formalProjection\)/);
  assert.doesNotMatch(reliabilitySource, /singleResult\.timeline|renderLineChart/);
  assert.match(formalReliabilitySource, /renderLineChart\(rows\.map\(\(row\) => \(\{ x: row\.sequence, y: row\.probability \}\)\)\)/);
  assert.match(formalReliabilitySource, /最大下降区间/);
  assert.match(formalReliabilitySource, /仿真时间/);
  assert.doesNotMatch(formalReliabilitySource, /0\.7|0\.9|阈值|目标线|风险线/);
  assert.doesNotMatch(reliabilitySource + formalReliabilitySource, /具体需求待甲方确定/);
});

test("phase 6D downtime analysis renders formal anomaly snapshots with export and delete controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const downtimeSource = appSource.slice(
    appSource.indexOf("function renderDowntimeFactorAnalysis"),
    appSource.indexOf("function analysisTypeForPage")
  );
  const formalDowntimeSource = appSource.slice(
    appSource.indexOf('if (formalProjection.analysisType === "downtime_factors")'),
    appSource.indexOf("function visibleDowntimeAnomalySnapshots")
  );
  const handlerSource = appSource.slice(
    appSource.indexOf("const analysisActionButton"),
    appSource.indexOf("const experimentPlanRefreshButton")
  );

  assert.match(downtimeSource, /analysisProjectionForBoundary\(boundary\)/);
  assert.match(downtimeSource, /停机因素页只显示正式 projection/);
  assert.doesNotMatch(downtimeSource, /singleResult\.downtimeFactors/);
  assert.match(formalDowntimeSource, /异常停机事件快照/);
  assert.match(formalDowntimeSource, /support_activity_state/);
  assert.match(formalDowntimeSource, /jobNodeId|jobNodeLabel/);
  assert.match(formalDowntimeSource, /data-downtime-snapshot-export/);
  assert.match(formalDowntimeSource, /data-downtime-snapshot-delete/);
  assert.match(appSource, /function exportDowntimeAnomalySnapshots/);
  assert.match(appSource, /function deleteDowntimeAnomalySnapshot/);
  assert.match(handlerSource, /downtimeSnapshotExportButton/);
  assert.match(handlerSource, /downtimeSnapshotDeleteButton/);
});

test("monte carlo formal results render inside the experiment detail flow", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderMonteCarloResults/);
  assert.match(appSource, /蒙特卡洛实验结果/);
  assert.match(appSource, /mc-formal-results/);
  assert.match(appSource, /mc-formal-blocked/);
  assert.match(appSource, /renderFormalProjectionBody/);
  assert.doesNotMatch(appSource, /mc-result-cards/);
  assert.doesNotMatch(appSource, /mc-evaluation-table/);
});

test("system management exposes an independent equipment RMS allocation workbench", async () => {
  const page = getFeaturePageById("system-management-equipment-rms-allocation");
  assert.equal(page.module, "系统运行支持模块");
  assert.equal(page.secondary, "装备RMS指标分配");
  assert.equal(page.tertiary, "装备RMS指标分配");
  assert.equal(page.name, "装备RMS指标分配");
  assert.deepEqual(page.dataObjects, ["rmsAllocationPlan", "equipmentNodes", "missionExposure", "allocationResults"]);

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /renderRmsAllocationWorkbench/);
  assert.match(appSource, /data-rms-path/);
  assert.match(appSource, /data-rms-equipment-import-file/);
  assert.match(appSource, /data-rms-equipment-root/);
  assert.match(appSource, /normalizeRmsEquipmentImportRows/);
  assert.match(appSource, /selectRmsAllocationEquipmentRoot/);
  assert.match(appSource, /calculateRmsAllocation\(rmsAllocationPlan, rmsAllocationProject\)/);
  assert.doesNotMatch(appSource, /publishRmsAllocation\(rmsAllocationProject, rmsAllocationResult\)/);
  assert.doesNotMatch(appSource, /function renderTopbarContext\(page\)/);
  assert.match(appSource, /<p>\$\{htmlEscape\(currentProject\?\.name \|\| "未选择项目"\)\}<\/p>/);
  assert.doesNotMatch(appSource, /SYSTEM_SUPPORT_MODULE_NAME} \/ \$\{htmlEscape\(page\.secondary\)\} \/ \$\{htmlEscape\(page\.tertiary\)\}/);
  assert.match(styleSource, /\.rms-allocation-workbench/);
  assert.match(styleSource, /\.rms-parameter-panel/);
  assert.match(styleSource, /\.rms-equipment-tree/);
  assert.match(styleSource, /\.rms-method-panel/);

  const workbenchSource = await readFile(new URL("../front/rms-allocation-workbench.mjs", import.meta.url), "utf8");
  assert.match(workbenchSource, /装备 RMS 指标分配/);
  assert.doesNotMatch(workbenchSource, /plan\.name/);
  assert.match(workbenchSource, /导入表格/);
  assert.doesNotMatch(workbenchSource, /import-sample/);
  assert.doesNotMatch(workbenchSource, /导入 15/);
  assert.match(workbenchSource, /任务可靠度/);
  assert.match(workbenchSource, /任务时长\(h\)/);
  assert.match(workbenchSource, /关键故障占比/);
  assert.match(workbenchSource, /MTTR\(h\)/);
  assert.doesNotMatch(workbenchSource, /MTBF\(h\)/);
  assert.match(workbenchSource, /data-rms-equipment-root/);
  assert.match(workbenchSource, /可靠性分配方法/);
  assert.match(workbenchSource, /等分配法/);
  assert.match(workbenchSource, /比例分配法/);
  assert.match(workbenchSource, /相似产品分配法/);
  assert.match(workbenchSource, /比例修正系数/);
  assert.match(workbenchSource, /plan\.methods\.reliability === "similar"/);
  assert.match(workbenchSource, /基准机型/);
  assert.match(workbenchSource, /data-rms-action="calculate">计算/);
  assert.doesNotMatch(workbenchSource, /data-rms-action="save-draft"/);
  assert.doesNotMatch(workbenchSource, /data-rms-action="publish"/);
  assert.doesNotMatch(workbenchSource, /AGREE 分配法/);
  assert.doesNotMatch(workbenchSource, /评分分配法/);
  assert.doesNotMatch(workbenchSource, /任务暴露矩阵/);
  assert.doesNotMatch(workbenchSource, /暴露时间/);
  assert.doesNotMatch(workbenchSource, /R目标/);
  assert.doesNotMatch(workbenchSource, /反算 R/);
  assert.match(workbenchSource, /校核可靠度/);
  assert.match(workbenchSource, /运行比/);
  assert.match(workbenchSource, /产品强度/);
  assert.match(workbenchSource, /MTBCF/);
});

test("RMS allocation workbench renders parameters for only the selected method", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const renderWithMethod = (method) => {
    plan.methods.reliability = method;
    return renderRmsAllocationWorkbench({
      project,
      plan,
      result: calculateRmsAllocation(plan, project),
      importStatus: "",
      htmlEscape: (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;"),
      fixed: (value, digits = 2) => Number(value || 0).toFixed(digits),
      pct: (value) => `${Math.round(Number(value || 0) * 100)}%`
    });
  };

  const equalHtml = renderWithMethod("equal");
  assert.doesNotMatch(equalHtml, /基准机型/);
  assert.doesNotMatch(equalHtml, /比例修正系数/);
  assert.doesNotMatch(equalHtml, /暴露时间/);
  assert.doesNotMatch(equalHtml, /R目标/);
  assert.doesNotMatch(equalHtml, /反算 R/);
  assert.match(equalHtml, /校核可靠度/);
  assert.match(equalHtml, /运行比<\/th>/);
  assert.match(equalHtml, /产品强度/);
  assert.match(equalHtml, /MTBCF/);
  assert.match(equalHtml, /任务计算机LRU/);
  assert.match(equalHtml, /运行比 0\.65/);

  const proportionalHtml = renderWithMethod("proportional");
  assert.match(proportionalHtml, /比例修正系数/);
  assert.doesNotMatch(proportionalHtml, /基准机型/);

  const similarHtml = renderWithMethod("similar");
  assert.match(similarHtml, /基准机型/);
  assert.match(similarHtml, /相似修正系数/);
});

test("system management exposes project management and base configuration pages", async () => {
  const expectedPages = [
    ["system-management-project-data-management", "项目管理", "项目数据管理", ["modelingModules", "sheetSelections", "localImportActions"]],
    ["system-management-modeling-granularity-management", "项目管理", "建模颗粒度管理", ["modelingModules", "sheets", "fieldSelections"]],
    ["system-management-user-management", "系统基础配置", "用户管理", ["users", "roles", "organizations"]],
    ["system-management-function-permission-management", "系统基础配置", "系统功能权限管理", ["features", "roles", "permissionRules"]],
    ["system-management-modeling-form-management", "系统基础配置", "建模表单管理", ["modelingForms", "formFields", "validationRules"]]
  ];

  for (const [id, secondary, name, dataObjects] of expectedPages) {
    const page = getFeaturePageById(id);
    assert.equal(page.module, "系统运行支持模块");
    assert.equal(page.secondary, secondary);
    assert.equal(page.tertiary, name);
    assert.equal(page.name, name);
    assert.deepEqual(page.dataObjects, dataObjects);
  }
  assert.equal(FEATURE_PAGES.some((page) => page.id === "system-management-modeling-import-workbench"), false);

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function renderSystemProjectManagement\(page\)/);
  assert.match(appSource, /function renderSystemBasicConfig\(page\)/);
  assert.match(appSource, /function renderProjectDataTable/);
  assert.match(appSource, /function renderModelingGranularityTable/);
  assert.match(appSource, /function renderUserManagementConfig/);
  assert.match(appSource, /function renderPermissionManagementConfig/);
  assert.match(appSource, /function renderModelingFormManagementConfig/);
  assert.doesNotMatch(appSource, /仿真建模数据表 sheet 选择器/);
  assert.match(appSource, /项目数据管理配置/);
  assert.match(appSource, /data-project-data-config-module="modeling-data-source"/);
  assert.match(appSource, /data-project-data-config-module="modeling-import-publish"/);
  assert.match(appSource, /data-system-config-save/);
  assert.match(appSource, /MODELING_DATA_MODULES/);
  assert.match(appSource, /装备系统/);
  assert.match(appSource, /装备任务/);
  assert.match(appSource, /保障组织/);
  assert.match(appSource, /保障活动/);
  assert.match(appSource, /建模颗粒度配置/);
  assert.match(appSource, /颗粒度 A/);
  assert.match(appSource, /颗粒度 B/);
  assert.match(appSource, /data-modeling-field-select/);
  assert.doesNotMatch(appSource, /层级、对象及关系/);
  assert.doesNotMatch(appSource, /<th>建模层级<\/th>/);
  assert.match(appSource, /page\.name === "建模表单管理"/);
  assert.match(appSource, /data-modeling-form-management/);
  assert.match(appSource, /data-modeling-form-unit/);
  assert.match(appSource, /data-personnel-specialty-dictionary/);
  assert.match(styleSource, /\.system-config-workbench/);
  assert.match(styleSource, /\.modeling-config-grid/);
  assert.match(styleSource, /\.field-checkbox-grid/);
});

test("user management add and edit actions open an editable user form", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /let systemUserEditor/);
  assert.match(appSource, /let systemUsersLoadStatus/);
  assert.match(appSource, /let systemUserSearchText/);
  assert.match(appSource, /data-system-user-action="add"/);
  assert.match(appSource, /data-system-user-edit="\$\{htmlEscape\(user\.username\)\}"/);
  assert.match(appSource, /data-system-user-search/);
  assert.match(appSource, /const systemUserActionButton = event\.target\.closest\("\[data-system-user-action\]"\)/);
  assert.match(appSource, /const systemUserEditButton = event\.target\.closest\("\[data-system-user-edit\]"\)/);
  assert.match(appSource, /ensureSystemUsersLoaded\(\)/);
  assert.match(appSource, /function openSystemUserEditor/);
  assert.match(appSource, /async function saveSystemUserEditor/);
  assert.match(appSource, /backendApi\.listUsers/);
  assert.match(appSource, /backendApi\.createUser/);
  assert.match(appSource, /backendApi\.updateUser/);
  assert.match(appSource, /data-system-user-field="username"/);
  assert.match(appSource, /data-system-user-field="role"/);
  assert.match(appSource, /data-system-user-status/);
});

test("system user batch delete should require checked rows first", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const userSource = appSource.slice(
    appSource.indexOf("function renderUserManagementConfig"),
    appSource.indexOf("function renderPermissionManagementConfig")
  );
  const eventSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("async function handleLogin")
  );
  const systemUserSource = appSource.slice(
    appSource.indexOf("async function handleSystemUserAction"),
    appSource.indexOf("function openSystemUserEditor")
  );
  const deleteSource = appSource.slice(
    appSource.indexOf("function deleteSystemUsers"),
    appSource.indexOf("function updatePermissionRole")
  );

  assert.match(userSource, /data-system-user-select-all/);
  assert.match(userSource, /data-system-user-select="\$\{htmlEscape\(user\.username\)\}"/);
  assert.match(deleteSource, /const targets = new Set\(usernames\.filter\(Boolean\)\);/);
  assert.match(deleteSource, /if \(!targets\.size\) \{/);
  assert.match(deleteSource, /systemUsersLoadStatus = "请先选择要删除的用户";/);
  assert.match(deleteSource, /backendApi\.deleteUser\(user\.user_id\)/);
  assert.match(systemUserSource, /async function handleSystemUserAction\(action\)/);
  assert.match(systemUserSource, /if \(action === "delete-selected"\) \{/);
  assert.match(systemUserSource, /await deleteSystemUsers\(Array\.from\(selectedSystemUsernames\)\);/);
  assert.match(eventSource, /const systemUserActionButton = event\.target\.closest\("\[data-system-user-action\]"\);/);
  assert.match(eventSource, /handleSystemUserAction\(systemUserActionButton\.dataset\.systemUserAction\)\.finally\(\(\) => render\(\)\);/);
  assert.match(userSource, /data-system-user-delete="\$\{htmlEscape\(user\.username\)\}"/);
  assert.match(eventSource, /const systemUserDeleteButton = event\.target\.closest\("\[data-system-user-delete\]"\)/);
  assert.match(eventSource, /deleteSystemUsers\(\[systemUserDeleteButton\.dataset\.systemUserDelete\]\)\.finally\(\(\) => render\(\)\);/);
});

test("system user editor save failure should preserve backend error message", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const editSource = appSource.slice(
    appSource.indexOf("async function saveSystemUserEditor"),
    appSource.indexOf("function normalizeSystemUser")
  );
  const actionSource = appSource.slice(
    appSource.indexOf("async function handleSystemUserAction"),
    appSource.indexOf("function openSystemUserEditor")
  );

  assert.match(editSource, /const user = normalizeSystemUser\(systemUserEditor\.user\);/);
  assert.match(editSource, /if \(!user\.username\) \{/);
  assert.match(editSource, /systemUsersLoadStatus = `用户保存失败：\$\{err && err\.message \? err\.message : "Backend API 不可用"\}`;/);
  assert.match(editSource, /systemUserEditor = null;/);
  assert.match(actionSource, /if \(action === "save"\) \{\s*await saveSystemUserEditor\(\);\s*return;\s*\}/);
});

test("frontend removes the standalone ontology visualization route", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /ONTOLOGY_PAGE_ID/);
  assert.doesNotMatch(appSource, /renderOntologyVisualizationPage/);
  assert.doesNotMatch(appSource, /data-feature-id="ontology-map"/);
});

test("editable and project text values are escaped before template insertion", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /htmlEscape\(currentProject\?\.name \|\| "未选择项目"\)/);
  assert.match(appSource, /htmlEscape\(project\.name\)/);
  assert.match(appSource, /htmlEscape\(project\.summary\)/);
  assert.match(appSource, /htmlEscape\(scenario\.experiment\.name\)/);
  assert.match(appSource, /htmlEscape\(plan\.name\)/);
});

test("visual simulation page embeds aircraft mission and support Mesa views", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /mesa-visual-shell/);
  assert.match(appSource, /mesaTab\("aircraft"/);
  assert.match(appSource, /mesaTab\("mission"/);
  assert.match(appSource, /mesaTab\("support"/);
  assert.match(appSource, /飞机保障正式仿真/);
  assert.doesNotMatch(appSource, /formal run \/ aircraft_support_v1/);
  assert.match(appSource, /isVisualSimulationPage/);
  assert.doesNotMatch(appSource, /<h2>\$\{htmlEscape\(page\.tertiary\)\}<\/h2>/);
  assert.doesNotMatch(appSource, /return `<div>\$\{breadcrumb\}<\/div>`;/);
  assert.doesNotMatch(appSource, /可视化实验启动与停止<\/h2>/);
  assert.doesNotMatch(appSource, /mesaTab\("ontology"/);
  assert.doesNotMatch(appSource, /Ontology视图/);
  assert.doesNotMatch(appSource, /renderMesaOntologyPanel/);
  assert.doesNotMatch(appSource, /renderOntologySvg/);
  assert.doesNotMatch(appSource, /buildMesaOntologyFocusSet/);
  assert.doesNotMatch(appSource, /data-ontology-/);
  assert.doesNotMatch(appSource, /ontology-context/);
});

test("visual simulation layout matches operational dashboard requirements", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function renderVisualizationRunOptions")
  );
  const stageSource = appSource.slice(
    appSource.indexOf("function renderMesaStage"),
    appSource.indexOf("function renderMesaSidePanel")
  );

  for (const label of ["使用可用度", "出动架次率", "维修中飞机", "保障中飞机", "备件满足率"]) {
    assert.match(appSource, new RegExp(label));
  }
  const controlIndex = visualSource.indexOf("mesa-control-deck");
  const kpiIndex = visualSource.indexOf("mesa-kpi-strip");
  const tabsIndex = visualSource.indexOf("mesa-view-tabs");
  assert.ok(controlIndex > -1 && kpiIndex > -1 && controlIndex < kpiIndex, "run control panel should render above KPI row");
  assert.ok(kpiIndex > -1 && tabsIndex > -1 && tabsIndex > kpiIndex, "view tabs should render below KPI row");
  assert.match(visualSource, /mesa-control-status/);
  assert.doesNotMatch(visualSource, /mesa-status-grid/);
  assert.match(styleSource, /\.mesa-control-status\[open\][\s\S]*overflow: auto/);
  assert.match(appSource, /可用飞机数量趋势/);
  assert.match(appSource, /AIRCRAFT_TREND_SERIES/);
  for (const label of ["可用飞机", "任务中", "维修中", "使用保障中"]) {
    assert.match(appSource, new RegExp(label));
  }
  assert.match(appSource, /countAircraftTrendStates\(aircraft\)/);
  assert.match(appSource, /renderAvailabilityTrendLine\(chartPoints, series\)/);
  assert.match(appSource, /availability-trend-legend/);
  assert.match(appSource, /buildAvailabilityTrend\(\s*state,\s*visualizationStateSeries,\s*visualizationStateSeriesFrame \? visualizationReplayIndex : null\s*\)/);
  assert.match(appSource, /frames\.slice\(0, currentIndex \+ 1\)/);
  assert.doesNotMatch(appSource, /T-\$\{4 - index\}/);
  assert.match(styleSource, /\.availability-chart \.trend-line/);
  assert.match(styleSource, /\.availability-chart circle\.current-point/);
  assert.match(appSource, /available: "available \/ 可用"/);
  assert.match(appSource, /maintenance: "maintenance \/ 维修"/);
  assert.match(appSource, /flying: "flying \/ 飞行"/);
  assert.doesNotMatch(appSource, /function aircraftStateLaneKey/);
  assert.doesNotMatch(stageSource, /航母甲板 \/ 任务就绪/);
  assert.doesNotMatch(stageSource, /任务空域/);
  assert.doesNotMatch(stageSource, /修复性维修/);
  assert.match(stageSource, /任务计划甘特图/);
  assert.match(stageSource, /mission-schedule-table/);
  assert.match(stageSource, /按周期性任务 \/ 复合任务 \/ 每天基本任务/);
  assert.match(stageSource, /要求型号 \/ 数量/);
  assert.match(stageSource, /实际执行飞机/);
  assert.match(stageSource, /每日甘特图/);
  assert.match(stageSource, /buildMissionScheduleRows\(state\.missions\)/);
  assert.match(stageSource, /hasFormalMissionScheduleFields/);
  assert.match(stageSource, /day_index、wave_index、duration_minutes/);
  assert.match(stageSource, /mission\.periodicTaskName/);
  assert.match(stageSource, /type !== "periodic"/);
  assert.match(stageSource, /type === "basic"/);
  assert.match(stageSource, /numbers\.durationMinutes > 0/);
  assert.doesNotMatch(stageSource, /mesa-mission-cards/);
  assert.doesNotMatch(appSource, /任务状态<\/h3>/);
  assert.doesNotMatch(appSource, /任务成员飞机/);
  assert.doesNotMatch(appSource, /function renderMesaMissionPanel/);
  assert.doesNotMatch(appSource, /inferMissionAircraftType/);
  assert.doesNotMatch(appSource, /requiredAircraftType: item\.required_aircraft_type \|\| item\.aircraft_type/);
  assert.doesNotMatch(stageSource, /row\.requiredAircraftType \|\|/);
  assert.match(appSource, /mission-expanded/);
  assert.match(styleSource, /\.mission-schedule-row[\s\S]*grid-template-columns/);
  assert.match(stageSource, /aircraft-state-board/);
  assert.match(stageSource, /aircraft-state-lane/);
  assert.match(stageSource, /aircraft-state-node/);
  assert.match(stageSource, /aircraft-mission-timeline/);
  assert.match(stageSource, /buildAircraftMissionTimelineRows\(state\)/);
  assert.match(styleSource, /\.aircraft-state-board[\s\S]*grid-template-columns/);
  assert.match(styleSource, /\.aircraft-mission-timeline[\s\S]*overflow: auto/);
  assert.match(styleSource, /\.mesa-visual-grid\.mission-expanded[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(stageSource, /保障人员/);
  assert.match(stageSource, /按保障组织 \/ 人员专业/);
  assert.match(stageSource, /保障设备详情清单/);
  assert.match(stageSource, /按保障组织 \/ 备件类型/);
  assert.match(appSource, /mesa-event-window/);
  assert.match(styleSource, /\.mesa-event-window[\s\S]*overflow: auto/);
});

test("visual aircraft panel renders backend equipment failure propagation tree", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stateSource = await readFile(new URL("../front/aviation-support-state.mjs", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const aircraftPanelSource = appSource.slice(
    appSource.indexOf("function renderMesaAircraftPanel"),
    appSource.indexOf("function renderMesaSupportPanel")
  );

  assert.match(stateSource, /failureTree: normalizeFailureTree\(resolveFailureTree\(item, failureTreeTemplates\)\)/);
  assert.match(stateSource, /failure_tree_templates/);
  assert.match(appSource, /let selectedVisualAircraftId = ""/);
  assert.match(appSource, /data-select-visual-aircraft/);
  assert.match(aircraftPanelSource, /renderAircraftFailureTree\(selectedAircraft\.failureTree, selectedAircraft\)/);
  assert.match(aircraftPanelSource, /飞机内部组成与故障传递/);
  assert.match(aircraftPanelSource, /中取/);
  assert.match(aircraftPanelSource, /T\+\$\{htmlEscape\(node\.failureTime\)\}min/);
  assert.match(aircraftPanelSource, /向上传递/);
  assert.match(styleSource, /\.aircraft-failure-tree/);
  assert.match(styleSource, /\.aircraft-failure-node\.propagated/);
});

test("visual simulation consumes formal state-series without demo fallback", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function renderVisualizationEventStream")
  );

  assert.match(appSource, /const CONTRACT_BASE = "http:\/\/127\.0\.0\.1:8521"/);
  assert.doesNotMatch(appSource, /fetch\(`\$\{CONTRACT_BASE\}\/visualization/);
  assert.match(appSource, /createBackendApiClient\(\{ baseUrl: "\/api"/);
  assert.match(appSource, /normalizeVisualizationStateSeriesPayload\(payload, \{\s*runId,\s*artifactId: artifact\.artifact_id/);
  assert.match(replaySource, /const MODEL_FAMILY = "aircraft_support_v1"/);
  assert.match(replaySource, /model_family: requireModelFamily\(payload\.model_family\)/);
  assert.match(visualSource, /缺少 aircraft_support_v1 state_series artifact/);
  assert.match(visualSource, /正式可视化不会回退到旧 aviation_support 或演示快照/);
  assert.match(appSource, /clearVisualizationStateSeries\(runId, `run \$\{runId\} 缺少 visualization_state_series artifact，M9 正式回放保持阻断`\)/);
  assert.doesNotMatch(appSource, /visualizationStateSeriesFrame \|\| liveAviationState \|\| AVIATION_SUPPORT_DEMO_STATE/);
  assert.doesNotMatch(appSource, /aviationSource = "demo"/);
  assert.doesNotMatch(appSource, /loadAviationSupportState\(\)/);
  assert.match(appSource, /data-mesa-control/);
});

test("M9 visual simulation replays canonical state-series artifacts without backend control", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function mesaTab")
  );
  const controlSource = appSource.slice(
    appSource.indexOf('const mesaControlButton = event.target.closest("[data-mesa-control]")'),
    appSource.indexOf('const modelingImportActionButton = event.target.closest("[data-modeling-import-action]")')
  );
  const controlHandlerSource = appSource.slice(
    appSource.indexOf("async function handleMesaControl"),
    appSource.indexOf("async function loadAviationSupportState")
  );
  const eventHandlerSource = appSource.slice(
    appSource.indexOf('const mesaEventJumpButton = event.target.closest("[data-mesa-event-jump]")'),
    appSource.indexOf('const modelingImportActionButton = event.target.closest("[data-modeling-import-action]")')
  );

  assert.match(appSource, /findVisualizationStateSeriesArtifact/);
  assert.match(appSource, /normalizeVisualizationStateSeriesPayload/);
  assert.match(appSource, /frameAt\(visualizationStateSeries/);
  assert.match(refreshSource, /await refreshVisualizationStateSeries\(runId\)/);
  assert.match(replaySource, /visualization_state_series/);
  assert.match(replaySource, /schema_version: String\(payload\.schema_version \|\| STATE_SERIES_SCHEMA_VERSION\)/);
  assert.match(visualSource, /run_id/);
  assert.match(visualSource, /artifact_id/);
  assert.match(visualSource, /data-mesa-timeline/);
  assert.match(visualSource, /data-mesa-event-stream/);
  assert.match(visualSource, /data-mesa-event-jump/);
  assert.match(controlHandlerSource, /nextReplayIndex\(visualizationStateSeries/);
  assert.match(controlHandlerSource, /visualizationReplayPlaying = !visualizationReplayPlaying/);
  assert.match(eventHandlerSource, /stopVisualizationReplay\(\)/);
  assert.match(eventHandlerSource, /visualizationReplayIndex = Number\(mesaEventJumpButton\.dataset\.mesaEventJump\)/);
  assert.doesNotMatch(controlSource, /loadAviationSupportState\(\)/);
});

test("visual simulation places event trace at the bottom of the page", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function renderVisualizationRunOptions")
  );

  const gridIndex = visualSource.indexOf('class="mesa-visual-grid ${activeView === "mission" ? "mission-expanded" : ""}"');
  const eventTraceIndex = visualSource.indexOf("renderVisualizationEventStream(eventStream, visualizationReplayIndex)");
  assert.ok(gridIndex > -1, "visual simulation grid should render");
  assert.ok(eventTraceIndex > -1, "event trace should render");
  assert.ok(eventTraceIndex > gridIndex, "event trace should render after the main visualization content");
});

test("M9.2 visual simulation keeps state stream support behind the simplified replay flow", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function mesaTab")
  );
  const controlHandlerSource = appSource.slice(
    appSource.indexOf("async function handleMesaControl"),
    appSource.indexOf("async function loadAviationSupportState")
  );

  assert.match(replaySource, /mergeVisualizationStateStreamFrame/);
  assert.match(appSource, /new EventSource/);
  assert.match(appSource, /\/api\/runs\/\$\{encodeURIComponent\(runId\)\}\/state-stream/);
  assert.match(appSource, /state_frame/);
  assert.match(appSource, /artifact_ready/);
  assert.doesNotMatch(visualSource, /data-mesa-control="subscribe-run"/);
  assert.doesNotMatch(visualSource, /data-mesa-control="stop-subscription"/);
  assert.doesNotMatch(visualSource, /data-mesa-stream-status/);
  assert.match(appSource, /订阅已连接/);
  assert.match(appSource, /订阅断开，浏览器将尝试重连/);
  assert.match(appSource, /订阅未授权/);
  assert.match(appSource, /订阅失败/);
  assert.match(appSource, /最终 artifact 已生成，正在切换到离线回放/);
  assert.match(controlHandlerSource, /isVisualizationStateSeriesFromStream\(\)/);
  assert.doesNotMatch(controlHandlerSource, /readyState === EventSource\.CLOSED && !visualizationStreamState\.eventCount/);
});

test("visual simulation exposes only replay picker replay start and new simulation controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation"),
    appSource.indexOf("function mesaTab")
  );

  assert.match(visualSource, /aria-label="选择回放"/);
  assert.match(visualSource, /data-mesa-control="play"/);
  assert.match(visualSource, /启动回放/);
  assert.match(visualSource, /暂停回放/);
  assert.match(visualSource, /data-mesa-control="start-new-run"/);
  assert.match(visualSource, /启动新仿真/);
  for (const action of ["refresh-runs", "load-replay", "subscribe-run", "stop-subscription", "step", "reset"]) {
    assert.doesNotMatch(visualSource, new RegExp(`data-mesa-control="${action}"`));
  }
  for (const [action, label] of [
    ["backend-cancel", "取消运行"],
    ["backend-retry", "重试运行"],
    ["backend-pause", "后端暂停"],
    ["backend-resume", "后端恢复"],
    ["backend-step", "后端单步"],
    ["backend-reset", "后端重置"]
  ]) {
    assert.doesNotMatch(visualSource, new RegExp(`data-mesa-control="${action}"`));
    assert.doesNotMatch(visualSource, new RegExp(label));
  }
  assert.doesNotMatch(visualSource, /data-mesa-backend-control-status/);
});

test("visual simulation selection and start controls load official replays automatically", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const changeSource = appSource.slice(
    appSource.indexOf('const mesaRunSelect = event.target.closest("[data-mesa-run-select]")'),
    appSource.indexOf('const mesaTimeline = event.target.closest("[data-mesa-timeline]")')
  );
  const controlHandlerSource = appSource.slice(
    appSource.indexOf("async function handleMesaControl"),
    appSource.indexOf("async function loadAviationSupportState")
  );
  const newRunSource = controlHandlerSource.slice(
    controlHandlerSource.indexOf('if (action === "start-new-run")'),
    controlHandlerSource.indexOf("const controlAction = backendControlActions")
  );
  const playSource = controlHandlerSource.slice(
    controlHandlerSource.indexOf('if (action === "play")'),
    controlHandlerSource.indexOf('if (["play"')
  );

  assert.match(changeSource, /await loadVisualizationReplayForRun\(visualizationSelectedRunId\)/);
  assert.match(newRunSource, /await startSingleRunThroughApi\(\)/);
  assert.match(newRunSource, /await refreshVisualizationRunList\(newRunId\)/);
  assert.match(newRunSource, /await loadVisualizationReplayForRun\(newRunId\)/);
  assert.match(newRunSource, /visualizationReplayPlaying = true/);
  assert.match(newRunSource, /startVisualizationReplay\(\)/);
  assert.match(playSource, /await loadVisualizationReplayForRun\(\)/);
  assert.match(playSource, /visualizationReplayPlaying = !visualizationReplayPlaying/);
});

test("M9.3 backend Mesa controls call controlRun without local replay confirmation", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const controlHandlerSource = appSource.slice(
    appSource.indexOf("async function handleMesaControl"),
    appSource.indexOf("async function loadAviationSupportState")
  );
  const backendStart = controlHandlerSource.indexOf("const controlAction = backendControlActions[action]");
  const backendControlSource = controlHandlerSource.slice(
    backendStart,
    controlHandlerSource.indexOf("if (visualizationStateSeries && !isVisualizationStateSeriesFromStream())", backendStart)
  );
  const localReplaySource = controlHandlerSource.slice(
    controlHandlerSource.indexOf("if (visualizationStateSeries && !isVisualizationStateSeriesFromStream())"),
    controlHandlerSource.indexOf("if ([\"step\", \"reset\"].includes(action))")
  );
  const playSource = controlHandlerSource.slice(
    controlHandlerSource.indexOf('if (action === "play")'),
    backendStart
  );

  assert.match(controlHandlerSource, /backendControlActions/);
  assert.match(backendControlSource, /backendApi\.controlRun\(runId,\s*controlAction\)/);
  assert.match(backendControlSource, /await refreshRunResultThroughApi\((confirmedRunId|runId)\)/);
  assert.match(backendControlSource, /await refreshVisualizationRunList\((confirmedRunId|runId)\)/);
  assert.match(backendControlSource, /stopVisualizationRunStream/);
  assert.match(backendControlSource, /formatBackendError\(err\)/);
  assert.doesNotMatch(backendControlSource, /nextReplayIndex\(visualizationStateSeries/);
  assert.doesNotMatch(backendControlSource, /visualizationReplayIndex\s*=/);
  assert.doesNotMatch(backendControlSource, /visualizationReplayPlaying\s*=/);
  assert.match(playSource, /await loadVisualizationReplayForRun\(\)/);
  assert.match(playSource, /visualizationReplayPlaying = !visualizationReplayPlaying/);
  assert.match(localReplaySource, /nextReplayIndex\(visualizationStateSeries/);
  assert.match(localReplaySource, /visualizationReplayIndex = 0/);
});

test("M9.2 docs describe online state stream as current scope while preserving later non-goals", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    roadmap: await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8"),
    contracts: await readFile(new URL("../contracts/README.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /\/api\/runs\/\{run_id\}\/state-stream/);
  assert.match(combined, /M9\.2[^。]*在线状态流[^。]*已/);
  assert.match(combined, /M9\.3[^。]*(后端运行控制|运行控制)/);
  assert.match(combined, /production worker queue|生产 worker queue|生产级 worker/);
  assert.doesNotMatch(combined, /M9\.2\+ 在线状态流[^。]*(仍|留给|后续|未实现)/);
  assert.doesNotMatch(combined, /M9\.2 在线状态流[^。]*(仍未实现|未实现|后续范围)/);
  assert.doesNotMatch(combined, /不实现 M9\.2\+ 在线状态流/);
});

test("M9.6 docs freeze platform case fixtures before M9.7 model-family work", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    roadmap: await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8"),
    contracts: await readFile(new URL("../contracts/README.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /M9\.6[^。]*(平台案例数据包|案例数据包)[^。]*(字段覆盖表|golden fixtures)/);
  assert.match(combined, /m9_6_platform_case_export\.json/);
  assert.match(combined, /m9_6_field_coverage\.json/);
  assert.match(combined, /m9_6_expected_artifact_kinds\.json/);
  assert.match(combined, /M9\.7[^。]*正式飞机保障仿真模型族/);
  assert.match(combined, /M9\.8[^。]*(平台嵌入|嵌入平台)[^。]*(完成|收束|已)/);
  assert.match(combined, /independent-mesa[^。]*(源码树已移除|源码树已从当前仓库移除|当前源码树移除)/);
  assert.doesNotMatch(combined, /M9\.6[^。]*(正式飞机保障仿真模型族已完成|嵌入平台已完成|退役 independent-mesa 已完成)/);
  assert.doesNotMatch(combined, /M9\.6[^。]*(8765|independent-mesa\/server\.py)[^。]*(已作为|已成为|是)正式产品入口/);
});

test("M9.7 docs describe single-run, Monte Carlo, and coverage closure without claiming M9.8", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    roadmap: await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8"),
    contracts: await readFile(new URL("../contracts/README.md", import.meta.url), "utf8"),
    spec: await readFile(new URL("../docs/superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /M9\.7\.2[^。]*(真实 single-run core|single-run core)/);
  assert.match(combined, /AircraftSupportV1Model/);
  assert.match(combined, /behavior-driving|行为驱动字段/);
  assert.match(combined, /supportOrganization[^。]*(governance-only|治理型|不驱动仿真)/);
  assert.match(combined, /M9\.7\.3[^。]*(formal Monte Carlo|MC\/projection|Monte Carlo\/projection)/);
  assert.match(combined, /M9\.7\.4[^。]*(coverage hardening|覆盖)[^。]*(完成|关闭|收口)/);
  assert.doesNotMatch(combined, /M9\.7\.2[^。]*(字段全覆盖已完成|coverage hardening 已完成|formal Monte Carlo 已完成|Monte Carlo\/projection 已完成)/);
  assert.doesNotMatch(combined, /M9\.7\.4[^。]*仍[^。]*(等待|后续).*M9\.8/);
});

test("M9.7.4 docs promote formerly payload-only fields and avoid pending coverage wording", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    roadmap: await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8"),
    spec: await readFile(new URL("../docs/superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /components\[\]\.failureDistribution[^。]*(behavior-driving|行为驱动)/);
  assert.match(combined, /supportNodes\[\]\.transportPolicies[^。]*(behavior-driving|行为驱动)/);
  assert.doesNotMatch(combined, /components\[\]\.failureDistribution[^。]*(当前只编译进入 payload|只编译进入 payload|留给 M9\.7\.4)/);
  assert.doesNotMatch(combined, /supportNodes\[\]\.transportPolicies[^。]*(当前只编译进入 payload|只编译进入 payload|留给 M9\.7\.4)/);
  assert.doesNotMatch(combined, /supportOrganization[^。]*fail closed/);
});
