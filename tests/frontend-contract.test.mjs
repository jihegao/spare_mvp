import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "../front/feature-catalog.mjs";
import { buildOntologyContext, buildProjectOntology, PROJECT_ONTOLOGY, PROJECT_ONTOLOGY_PLAYGROUND } from "../front/ontology-context.mjs";

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 52);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 52);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 22);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 24);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "系统管理").length, 6);
  for (const label of ["装备可靠性框图建模", "蒙特卡洛实验结果", "飞机转场携行清单分析", "任务可靠度评估", "停机因素分析"]) {
    assert.ok(FEATURE_PAGES.some((page) => page.name === label), label);
  }
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
  assert.deepEqual(Object.keys(grouped), ["系统管理", "备件规划评估模块", "任务可靠度评估模块"]);
  assert.deepEqual(Object.keys(grouped["系统管理"]), ["项目管理", "装备RMS指标分配", "系统基础配置"]);
  assert.deepEqual(grouped["系统管理"]["项目管理"]["数据管理"].map((page) => page.name), ["数据管理"]);
  assert.deepEqual(grouped["系统管理"]["项目管理"]["建模颗粒度管理"].map((page) => page.name), ["建模颗粒度管理"]);
  assert.deepEqual(grouped["系统管理"]["系统基础配置"]["用户管理"].map((page) => page.name), ["用户管理"]);
  assert.deepEqual(grouped["系统管理"]["系统基础配置"]["系统功能权限管理"].map((page) => page.name), ["系统功能权限管理"]);
  assert.deepEqual(grouped["系统管理"]["系统基础配置"]["建模表单管理"].map((page) => page.name), ["建模表单管理"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["仿真建模"]).slice(0, 2), ["装备系统建模", "装备任务建模"]);
  assert.deepEqual(Object.keys(grouped["任务可靠度评估模块"]["仿真建模"]).slice(0, 2), ["装备系统建模", "装备任务建模"]);
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
  assert.deepEqual(grouped["系统管理"]["装备RMS指标分配"]["装备RMS指标分配"].map((page) => page.name), ["装备RMS指标分配"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["可视化实验启动与停止"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["可视化实验启动与停止"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["结果分析"]), ["蒙特卡洛实验结果", "备件短板分析", "飞机转场携行清单分析"]);
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
  assert.equal(getFeaturePageById("spare-planning-experiment-create").name, "方案编辑");
  assert.equal(getFeaturePageById("spare-planning-experiment-edit").name, "方案编辑");
  assert.equal(getFeaturePageById("spare-planning-scenario-switch").component, "visual-simulation");
  assert.equal(getFeaturePageById("spare-planning-visual-results").component, "visual-simulation");
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
  assert.equal(getFeaturePageById("system-management-project-data-management").component, "system-project-management");
  assert.equal(getFeaturePageById("system-management-modeling-granularity-management").component, "system-project-management");
  assert.equal(getFeaturePageById("system-management-user-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-function-permission-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-modeling-form-management").component, "system-basic-config");
  assert.equal(getFeaturePageById("system-management-equipment-rms-allocation").component, "rms-allocation");
  assert.equal(getFeaturePageById("mission-reliability-rms-allocation").id, "system-management-equipment-rms-allocation");
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

test("equipment composition modeling is the post-project landing page and plan name links back to plan list", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const DEFAULT_FEATURE_ID = "spare-planning-equipment-composition"/);
  assert.equal(getFeaturePageById("spare-planning-equipment-composition").module, "备件规划评估模块");
  assert.equal(getFeaturePageById("spare-planning-equipment-composition").secondary, "仿真建模");
  assert.equal(getFeaturePageById("spare-planning-equipment-composition").tertiary, "装备系统建模");
  assert.equal(getFeaturePageById("spare-planning-equipment-composition").name, "装备组成建模");
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
  assert.match(appSource, /htmlEscape\(currentProject\.name\)/);
  assert.match(appSource, /返回项目列表/);
  assert.match(appSource, /data-project-list/);
  assert.doesNotMatch(appSource, /<button type="button" data-project-list>项目列表<\/button>/);
  assert.match(styleSource, /\.project-menu/);
  assert.match(styleSource, /\.project-menu-panel/);
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
  assert.match(appSource, /基地级/);
  assert.match(appSource, /基层级1/);
  assert.match(appSource, /机务保障中队1/);
  assert.match(appSource, /基层级2/);
  assert.match(appSource, /机务保障中队2/);
  assert.match(appSource, /备件建模/);
  assert.match(appSource, /保障人员建模/);
  assert.match(appSource, /保障设备建模/);
  assert.match(appSource, /基本保障活动建模/);
  assert.match(appSource, /使用保障活动建模/);
  assert.match(appSource, /预防性维修活动建模/);
  assert.match(appSource, /修复性维修活动建模/);
  assert.match(appSource, /后勤保障活动建模/);
  assert.doesNotMatch(appSource, /修复型维修活动建模/);
  assert.match(appSource, /飞行前准备/);
  assert.match(appSource, /再次出动准备/);
  assert.match(appSource, /飞行后检查/);
  assert.match(appSource, /制动伞检查/);
  assert.match(appSource, /日检/);
  assert.match(appSource, /周检/);
  assert.match(appSource, /发动机备件故障/);
  assert.match(appSource, /航电模块故障/);
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
  assert.match(supportOrgSource, /const supportOrgNodes = flattenSupportOrgTreeNodes\(\)/);
  assert.match(supportOrgSource, /scope: orgNode\.name/);
  assert.doesNotMatch(supportOrgSource, /scope: node\.name/);
  assert.match(supportOrgSource, /<thead><tr><th>序号<\/th><th>组织节点<\/th><th>名称<\/th><th>型号\/专业<\/th><th>数量<\/th><th>适用机型<\/th><th>操作<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(supportOrgSource, /<th>资源类型<\/th>/);
  assert.doesNotMatch(supportOrgSource, /<td>\$\{row\.type\}<\/td>/);
  const orgStructureDetailSource = supportOrgSource.slice(
    supportOrgSource.indexOf('activeTab === "保障组织结构建模" ? `'),
    supportOrgSource.indexOf('` : `', supportOrgSource.indexOf('activeTab === "保障组织结构建模" ? `'))
  );
  assert.match(orgStructureDetailSource, /selectedSupportOrgNode/);
  assert.match(orgStructureDetailSource, /selectedSupportOrgParentName/);
  assert.doesNotMatch(orgStructureDetailSource, /适用机型/);
  const operationsSource = appSource.slice(
    appSource.indexOf("function renderOperationsSupportActivity"),
    appSource.indexOf("function renderPreventiveMaintenanceActivity")
  );
  assert.doesNotMatch(operationsSource, /\u4eff\u771f\u8fd0\u884c\u89c4\u5219/);
  assert.doesNotMatch(operationsSource, /\u52a0\u6cb9\u65b9\u6848/);
  assert.doesNotMatch(operationsSource, /\u6302\u8f7d\u65b9\u6848/);

  const logisticsSource = appSource.slice(
    appSource.indexOf("function renderLogisticsSupportActivity"),
    appSource.indexOf("function findLogisticsSupportActivity")
  );
  assert.match(logisticsSource, /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/);
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
  assert.doesNotMatch(logisticsSource, /\u4fdd\u969c\u7ec4\u7ec7\u7b56\u7565\u8868/);
  assert.doesNotMatch(logisticsSource, /\u65b9\u6848\u7c7b\u578b/);
  assert.doesNotMatch(logisticsSource, /renderSupportActivityJobTable/);
  assert.doesNotMatch(logisticsSource, /\u5de5\u4f5c\u9879\u76ee\u6e05\u5355/);
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
  assert.match(supportOrgSource, /const visibleResourceRows = activeResourceType/);
  assert.match(supportOrgSource, /page\.name\.includes\("人员"\) \? "保障人员"/);
  assert.match(supportOrgSource, /page\.name\.includes\("设备"\) \? "保障设备"/);
  assert.match(supportOrgSource, /page\.name\.includes\("备件"\) \? "备件"/);
  assert.match(supportOrgSource, /resourceRows\.filter\(\(row\) => row\.type === activeResourceType\)/);
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

test("support activity pages align to ship_front_0515 comprehensive activity fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const supportActivitySource = appSource.slice(
    appSource.indexOf("function findSupportActivityForPage"),
    appSource.indexOf("function renderExperimentPlanList")
  );
  for (const pattern of [
    /\u57fa\u672c\u4fdd\u969c\u6d3b\u52a8\u5217\u8868\u5e93/,
    /\u4f7f\u7528\u4fdd\u969c\u6d3b\u52a8\u540d\u79f0/,
    /\u6700\u5927\u5de5\u4f5c\u65f6\u95f4\u53c2\u8003\(min\)/,
    /\u5de5\u671f\u5206\u5e03\u6458\u8981/,
    /\u65b9\u6848\u540d\u79f0/,
    /\u8ba1\u5212\u505c\u673a\u5c0f\u65f6/,
    /\u542f\u52a8\u65e5\u5386\u65f6\u95f4/,
    /\u88c5\u5907\u6784\u578b\u6811/,
    /\u5e73\u5747\u4fee\u590d\u65f6\u95f4\(min\)/,
    /\u7ef4\u4fee\u65f6\u95f4\u5206\u5e03\u7c7b\u578b/,
    /\u7279\u6b8a\u4ea7\u54c1\u7ef4\u4fee\u65f6\u95f4\(min\)/,
    /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/,
    /\\u65b0\\u589e\\u8fd0\\u8f93\\u7b56\\u7565/,
    /\\u5907\\u4ef6\\u79cd\\u7c7b/,
    /\\u89e6\\u53d1\\u65b9\\u5f0f/
  ]) {
    assert.match(supportActivitySource, pattern);
  }
  assert.match(supportActivitySource, /renderBasicActivityLibrary/);
  assert.match(supportActivitySource, /renderOperationsSupportActivity/);
  assert.match(supportActivitySource, /renderPreventiveMaintenanceActivity/);
  assert.match(supportActivitySource, /renderCorrectiveMaintenanceActivity/);
  assert.match(supportActivitySource, /renderLogisticsSupportActivity/);
  const supportActivityJobSource = supportActivitySource.slice(
    supportActivitySource.indexOf("function renderSupportActivityJobRows"),
    supportActivitySource.indexOf("function renderBasicActivityLibrary")
  );
  assert.match(supportActivityJobSource, /data-support-activity-job-select/);
  assert.match(supportActivityJobSource, /data-support-activity-job-select-all/);
  assert.match(supportActivityJobSource, /data-support-activity-job-batch-delete/);
  assert.match(supportActivityJobSource, /data-support-activity-job-delete/);
  assert.match(supportActivityJobSource, /selectedSupportActivityJobKeys/);
  assert.match(supportActivitySource, /function toggleSupportActivityJobSelection/);
  assert.match(supportActivitySource, /function deleteSelectedSupportActivityJobs/);
  assert.match(supportActivitySource, /function deleteSupportActivityJob/);
  const basicActivityLibrarySource = supportActivitySource.slice(
    supportActivitySource.indexOf("function renderBasicActivityLibrary"),
    supportActivitySource.indexOf("function renderOperationsSupportActivity")
  );
  assert.match(basicActivityLibrarySource, /保障人员要求/);
  assert.match(basicActivityLibrarySource, /保障设备要求/);
  assert.doesNotMatch(basicActivityLibrarySource, /机务\/维修人员/);
  assert.doesNotMatch(basicActivityLibrarySource, /勤务人员/);
  assert.doesNotMatch(basicActivityLibrarySource, /保障\/维修设施/);
  assert.doesNotMatch(basicActivityLibrarySource, /保障\/维修设备/);
  assert.doesNotMatch(basicActivityLibrarySource, /row\.servicePersonnel/);
  assert.doesNotMatch(basicActivityLibrarySource, /row\.facility/);
  assert.match(supportActivitySource, /function spareModelingNames\(\)/);
  assert.match(supportActivitySource, /Object\.keys\(node\.inventory \|\| \{\}\)/);
  assert.doesNotMatch(supportActivitySource, /\u4eff\u771f\u8fd0\u884c\u89c4\u5219/);
  assert.doesNotMatch(supportActivitySource, /\u52a0\u6cb9\u65b9\u6848/);
  assert.doesNotMatch(supportActivitySource, /\u6302\u8f7d\u65b9\u6848/);
  assert.doesNotMatch(supportActivitySource, /\u4fdd\u969c\u6d3b\u52a8\u8282\u70b9\u7f51\u7edc\u56fe/);
});

test("equipment modeling pages use ship front tree attributes with quantity and n-out-of-k", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderEquipmentModeling\(page\)/);
  assert.match(appSource, /装备组成树/);
  assert.match(appSource, /function wholeMachineModels\(\)/);
  assert.match(appSource, /scenario\.equipment\.wholeMachineModels/);
  assert.match(appSource, /组成属性/);
  assert.match(appSource, /数量 n/);
  assert.match(appSource, /成功数 k/);
  assert.match(appSource, /启用 n 中取 k/);
  assert.match(appSource, /故障属性/);
  assert.match(appSource, /data-path="components\.\$\{selectedIndex\}\.quantity"/);
  assert.match(appSource, /data-path="components\.\$\{selectedIndex\}\.kOutOfN\.k"/);
  assert.doesNotMatch(appSource, /<thead><tr><th>组件<\/th><th>备件类型<\/th><th>故障模型<\/th><th>失效率<\/th><th>MTBF<\/th><th>连接类型<\/th><\/tr><\/thead>/);
});

test("equipment tree selection drives the selected component edit path", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /let selectedEquipmentNodeKey = ""/);
  assert.match(appSource, /data-select-equipment-aircraft="\$\{htmlEscape\(model\)\}"/);
  assert.match(appSource, /data-select-equipment-component="\$\{htmlEscape\(component\.id\)\}"/);
  assert.match(appSource, /selectedEquipmentNodeKey = `aircraft:\$\{equipmentAircraftNode\.dataset\.selectEquipmentAircraft\}`/);
  assert.match(appSource, /selectedEquipmentNodeKey = `component:\$\{equipmentComponentNode\.dataset\.selectEquipmentComponent\}`/);
  assert.match(appSource, /function clampEquipmentComponentIndex\(index\)/);
  assert.match(appSource, /const selectedState = resolveSelectedEquipmentNode\(\)/);
  assert.match(appSource, /renderEquipmentCompositionFields\(selectedIndex\)/);
  assert.match(appSource, /renderEquipmentFailureFields\(selectedIndex\)/);
  assert.match(appSource, /renderEquipmentFailureRmsFields\(selected, selectedIndex\)/);
  assert.match(appSource, /field\("组件名称", `components\.\$\{selectedIndex\}\.name`\)/);
});

test("equipment tree add node follows ship front selected aircraft and subsystem behavior", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderEquipmentFailureRmsFields")
  );
  assert.match(equipmentSource, /data-equipment-add-node/);
  assert.match(equipmentSource, /function buildEquipmentTreeNodes\(\)/);
  assert.match(equipmentSource, /function buildEquipmentComponentTreeNodes\(aircraftModel, parentId\)/);
  assert.match(appSource, /function addEquipmentNodeForSelection\(\)/);
  assert.match(appSource, /parentId: selectedState\.kind === "aircraft" \? "aircraft-root" : selectedState\.component\.id/);
  assert.match(appSource, /productType: selectedState\.kind === "aircraft" \? "非LRU" : "LRU"/);
  assert.match(appSource, /selectedEquipmentNodeKey = `component:\$\{newComponent\.id\}`/);
});

test("equipment tree root aircraft list can add aircraft before subsystem nodes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderEquipmentFailureRmsFields")
  );
  assert.match(equipmentSource, /label: "飞机列表"/);
  assert.match(equipmentSource, /data-select-equipment-root/);
  assert.match(appSource, /selectedEquipmentNodeKey = "aircraft-list"/);
  assert.match(appSource, /kind: "aircraft-list"/);
  assert.match(appSource, /function addEquipmentAircraftForSelection\(\)/);
  assert.match(appSource, /scenario\.equipment\.wholeMachineModels\.push\(aircraftModel\)/);
  assert.match(appSource, /selectedEquipmentNodeKey = `aircraft:\$\{aircraftModel\}`/);
  assert.match(appSource, /选中飞机列表新增飞机，选中飞机新增分系统，选中分系统新增子系统/);
  assert.match(appSource, /<label>数量<input readonly value=/);
  assert.doesNotMatch(appSource, /整机数量<input readonly value=/);
});

test("equipment composition page only renders tree and basic composition fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderEquipmentFailureRmsFields")
  );
  assert.match(equipmentSource, /function renderEquipmentCompositionFields/);
  assert.match(equipmentSource, /isFailurePage \? renderEquipmentFailureFields\(selectedIndex\) : renderEquipmentCompositionFields\(selectedIndex\)/);
  assert.match(equipmentSource, /field\("组件名称", `components\.\$\{selectedIndex\}\.name`\)/);
  assert.match(equipmentSource, /field\("父节点", `components\.\$\{selectedIndex\}\.parentId`\)/);
  assert.match(equipmentSource, /equipmentLruRadioGroup\(selectedIndex\)/);
  assert.match(equipmentSource, /是否为LRU/);
  assert.match(equipmentSource, /field\("备件类型", `components\.\$\{selectedIndex\}\.spareType`\)/);
  assert.match(equipmentSource, /equipmentKOutOfNInput\(selectedIndex\)/);
  assert.match(equipmentSource, /N中取K/);
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
  assert.match(appSource, /Math\.trunc\(Number\(input\.value\) \|\| 0\)/);
  assert.match(appSource, /clamp\(.*0, quantity\)/);
  assert.match(appSource, /component\.kOutOfN = \{ \.\.\.\(component\.kOutOfN \|\| \{\}\), enabled: bounded > 0, n: quantity, k: bounded \}/);
  assert.match(appSource, /min="0"/);
  assert.match(appSource, /step="1"/);
  assert.match(appSource, /max="\$\{htmlEscape\(quantity\)\}"/);
});

test("equipment failure page exposes RMS attributes separately from composition fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function renderReliabilityBlockDiagram")
  );
  assert.match(equipmentSource, /renderEquipmentFailureRmsFields\(selected, selectedIndex\)/);
  assert.match(equipmentSource, /function renderEquipmentFailureRmsFields/);
  assert.match(equipmentSource, /RMS指标/);
  assert.match(equipmentSource, /可靠度 R\(t\)/);
  assert.match(equipmentSource, /维修度 M\(t\)/);
  assert.match(equipmentSource, /保障性 S\(t\)/);
  assert.match(equipmentSource, /平均修复时间 MTTR\(h\)/);
  assert.match(equipmentSource, /固有可用度 Ai/);
  assert.match(equipmentSource, /失效分布类型/);
  assert.match(equipmentSource, /失效分布参数/);
  assert.match(equipmentSource, /前置寿命要求\(h\)/);
  assert.doesNotMatch(equipmentSource, /组件属性表/);
  assert.doesNotMatch(equipmentSource, /飞机状态数据表/);
  assert.doesNotMatch(equipmentSource, /可出动标识/);
  assert.match(equipmentSource, /field\("可靠度 R\(t\)", `components\.\$\{selectedIndex\}\.rms\.reliability`, "number"\)/);
  assert.match(equipmentSource, /field\("维修度 M\(t\)", `components\.\$\{selectedIndex\}\.rms\.maintainability`, "number"\)/);
  assert.match(equipmentSource, /field\("保障性 S\(t\)", `components\.\$\{selectedIndex\}\.rms\.supportability`, "number"\)/);
  assert.match(equipmentSource, /field\("平均修复时间 MTTR\(h\)", `components\.\$\{selectedIndex\}\.rms\.mttrHours`, "number"\)/);
  assert.match(equipmentSource, /field\("固有可用度 Ai", `components\.\$\{selectedIndex\}\.rms\.availability`, "number"\)/);
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
  assert.match(appSource, /<h2>\$\{htmlEscape\(page\.tertiary\)\}<\/h2>/);
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
  assert.match(combatUnitSource, /<thead><tr><th>飞机编号<\/th><th>飞机类型<\/th><th>前置寿命<\/th><th>起降次数<\/th><\/tr><\/thead>/);
  assert.match(appSource, /飞机编号/);
  assert.match(combatUnitSource, /member\.aircraftNo/);
  assert.match(combatUnitSource, /member\.model/);
  assert.match(combatUnitSource, /member\.preLifeRequirementHours/);
  assert.match(combatUnitSource, /member\.takeoffLandingCount/);
  assert.match(appSource, /function addCombatUnitMember\(\)/);
  assert.match(appSource, /function deleteSelectedCombatUnitMember\(\)/);
  assert.match(appSource, /let selectedCombatUnitMemberIndex = 0/);
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
  assert.match(appSource, /返回时间比/);
  assert.match(appSource, /任务优先级/);
  assert.match(appSource, /最小系统数量/);
  assert.match(appSource, /任务时长（分钟）/);
  assert.match(appSource, /使用保障活动/);
  assert.match(appSource, /任务区域描述/);
  assert.doesNotMatch(appSource, /<tr><th>更新时间<\/th>/);
  assert.doesNotMatch(appSource, /基本任务建模字段[\s\S]*任务类型/);
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
  assert.match(compositeSource, /<thead><tr><th>序号<\/th><th>复合任务名称<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(compositeSource, /<th>基本任务<\/th>/);
  assert.match(compositeSource, /当前复合任务包含的基本任务/);
  assert.match(compositeSource, /data-composite-task-item-add/);
  assert.match(compositeSource, /data-composite-task-item-delete/);
  assert.match(compositeSource, /典型组合任务时序表/);
  assert.match(compositeSource, /典型组合任务时序图/);
  assert.match(compositeSource, /renderCompositeTimelineChart/);
  assert.match(compositeSource, /任务优先级/);
  assert.match(compositeSource, /最小系统数量/);
  assert.match(compositeSource, /回收时刻/);
  assert.doesNotMatch(compositeSource, /周期性任务列表/);
  assert.doesNotMatch(compositeSource, /周期性任务建模/);

  const periodicSource = appSource.slice(
    appSource.indexOf("function renderPeriodicTaskModeling"),
    appSource.indexOf("function buildCompositeTimelineRows")
  );
  assert.match(periodicSource, /周期性任务列表/);
  assert.match(periodicSource, /周期性任务建模/);
  assert.match(periodicSource, /任务周期天数/);
  assert.match(periodicSource, /重复轮次/);
  assert.match(periodicSource, /任务周期/);
  assert.match(periodicSource, /复合任务名称/);
  assert.match(periodicSource, /periodicDayLabel/);
  assert.match(appSource, /第一天/);
  assert.match(appSource, /let selectedCompositeTaskId = ""/);
  assert.match(appSource, /function addCompositeTask\(\)/);
  assert.match(appSource, /function deleteSelectedCompositeTask\(\)/);
  assert.match(appSource, /function addCompositeTaskItem\(\)/);
  assert.match(appSource, /function deleteCompositeTaskItem\(index\)/);
  assert.doesNotMatch(periodicSource, /星期/);
  assert.doesNotMatch(periodicSource, /当前复合任务包含的基本任务/);
  assert.doesNotMatch(periodicSource, /典型组合任务时序表/);
});

test("editable modeling lists expose add edit and delete action entries", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function buildEquipmentTreeNodes")
  );
  assert.match(equipmentSource, /data-equipment-add-node/);
  assert.match(equipmentSource, /data-equipment-edit-node disabled/);
  assert.match(equipmentSource, /data-equipment-delete-node disabled/);

  const basicMissionSource = appSource.slice(
    appSource.indexOf("function renderBasicMissionModeling"),
    appSource.indexOf("function renderCompositeTaskModeling")
  );
  assert.match(basicMissionSource, /data-basic-mission-add/);
  assert.match(basicMissionSource, /data-basic-mission-edit disabled/);
  assert.match(basicMissionSource, /data-basic-mission-delete/);

  const compositeSource = appSource.slice(
    appSource.indexOf("function renderCompositeTaskModeling"),
    appSource.indexOf("function renderPeriodicTaskModeling")
  );
  assert.match(compositeSource, /data-composite-task-add/);
  assert.match(compositeSource, /data-composite-task-edit disabled/);
  assert.match(compositeSource, /data-composite-task-delete/);
  assert.match(compositeSource, /data-composite-task-item-add/);
  assert.match(compositeSource, /data-composite-task-item-edit disabled/);
  assert.match(compositeSource, /data-composite-task-item-edit="\$\{index\}" disabled/);
  assert.match(compositeSource, /data-composite-task-item-delete/);

  const combatUnitSource = appSource.slice(
    appSource.indexOf("function renderCombatUnitModeling"),
    appSource.indexOf("function addCombatUnitMember")
  );
  assert.match(combatUnitSource, /data-combat-unit-add/);
  assert.match(combatUnitSource, /data-combat-unit-edit disabled/);
  assert.match(combatUnitSource, /data-combat-unit-delete/);

  const supportOrgSource = appSource.slice(
    appSource.indexOf("function renderSupportOrganizationWorkbench"),
    appSource.indexOf("function renderOrgTreeNode")
  );
  assert.match(supportOrgSource, /data-support-org-add-node disabled/);
  assert.match(supportOrgSource, /data-support-org-edit-node disabled/);
  assert.match(supportOrgSource, /data-support-org-delete-node disabled/);
  assert.match(supportOrgSource, /组织名称<input value="\$\{htmlEscape\(selectedSupportOrgNode\?\.name \|\| ""\)\}" readonly>/);

  const basicActivitySource = appSource.slice(
    appSource.indexOf("function renderBasicActivityLibrary"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );
  assert.match(basicActivitySource, /data-basic-activity-add disabled/);
  assert.match(basicActivitySource, /data-basic-activity-edit="\$\{index\}" disabled/);
  assert.match(basicActivitySource, /data-basic-activity-delete disabled/);
  assert.match(basicActivitySource, /data-basic-activity-delete="\$\{index\}" disabled/);

  const logisticsSource = appSource.slice(
    appSource.indexOf("function renderLogisticsSupportActivity"),
    appSource.indexOf("function findLogisticsSupportActivity")
  );
  assert.match(logisticsSource, /data-logistics-transport-add/);
  assert.match(logisticsSource, /data-logistics-transport-edit="\$\{index\}" disabled/);
  assert.match(logisticsSource, /data-logistics-transport-delete/);

  const experimentPlanSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanList"),
    appSource.indexOf("function renderExperimentPlanEditor")
  );
  assert.match(experimentPlanSource, /data-experiment-plan-add disabled/);
  assert.match(experimentPlanSource, /data-experiment-plan-edit/);
  assert.match(experimentPlanSource, /data-experiment-plan-delete disabled/);
  assert.match(appSource, /return "spare-planning-experiment-plan-list"/);
});

test("unwired support activity controls are disabled and read-only", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  const basicActivitySource = appSource.slice(
    appSource.indexOf("function renderBasicActivityLibrary"),
    appSource.indexOf("function renderOperationsSupportActivity")
  );
  assert.match(basicActivitySource, /<button type="button" disabled>导入<\/button>/);

  const jobTableSource = appSource.slice(
    appSource.indexOf("function renderSupportActivityJobTable"),
    appSource.indexOf("function renderBasicActivityLibrary")
  );
  assert.match(jobTableSource, /data-support-activity-job-add disabled/);

  const operationsSource = appSource.slice(
    appSource.indexOf("function renderOperationsSupportActivity"),
    appSource.indexOf("function renderPreventiveMaintenanceActivity")
  );
  assert.doesNotMatch(operationsSource, /<input(?![^>]*(data-path|readonly|disabled))/);

  const preventiveSource = appSource.slice(
    appSource.indexOf("function renderPreventiveMaintenanceActivity"),
    appSource.indexOf("function renderEquipmentConfigTree")
  );
  assert.doesNotMatch(preventiveSource, /<input(?![^>]*(data-path|readonly|disabled))/);

  const correctiveSource = appSource.slice(
    appSource.indexOf("function renderCorrectiveMaintenanceActivity"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );
  assert.doesNotMatch(correctiveSource, /<input(?![^>]*(data-path|readonly|disabled))/);
  assert.doesNotMatch(correctiveSource, /scenario\.components\[0\]/);
});

test("reliability block diagram prototype exposes node edge and k-out-of-n fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const rbdSource = appSource.slice(
    appSource.indexOf("function renderReliabilityBlockDiagram"),
    appSource.indexOf("function renderResourceTable")
  );
  assert.match(rbdSource, /装备可靠性框图/);
  assert.match(rbdSource, /节点类型/);
  assert.match(rbdSource, /连接关系/);
  assert.match(rbdSource, /节点可靠度/);
  assert.match(rbdSource, /失效率/);
  assert.match(rbdSource, /MTBF/);
  assert.match(rbdSource, /k-out-of-n/);
  assert.match(rbdSource, /串联\/并联\/备用\/k-out-of-n/);
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
  assert.doesNotMatch(appSource, /运行单次仿真/);
  assert.doesNotMatch(appSource, /运行 Monte Carlo/);
  assert.doesNotMatch(appSource, /导出方案 JSON/);
  assert.doesNotMatch(appSource, /downloadJson/);
});

test("monte carlo configuration drives the displayed result sample count", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario, \{ samples: 4 \}\)/);
  assert.match(appSource, /let \{ singleResult, monteCarloResult \} = buildDemoResultState\(scenario\)/);
  assert.match(appSource, /id="mc-samples"[^>]*data-path="experiment\.samples"/);
  assert.match(appSource, /function updateDemoResultsThroughApiClient/);
  assert.match(appSource, /data-save-plan/);
});

test("monte carlo sweep inputs update scenario arrays and rerun grouped results", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /data-mc-array-path="monteCarlo\.failureRates"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.spareMultipliers"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.supportCapacities"/);
  assert.match(appSource, /const mcArrayInput = event\.target\.closest\("\[data-mc-array-path\]"\)/);
  assert.match(appSource, /setPath\(scenario, mcArrayInput\.dataset\.mcArrayPath, parseNumberList\(mcArrayInput\.value\)\)/);
  assert.match(appSource, /function parseNumberList/);
  assert.match(appSource, /updateDemoResultsThroughApiClient\(\)/);
  assert.match(appSource, /const savePlanButton = event\.target\.closest\("\[data-save-plan\]"\)/);
});

test("monte carlo experiment page is a launch-only parameter form and returns to running plan list", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /class="mc-workbench"/);
  assert.match(appSource, /蒙特卡洛实验参数配置/);
  assert.match(appSource, /当前仿真实验/);
  assert.match(appSource, /class="readonly-field"/);
  assert.doesNotMatch(appSource, /<label>选择仿真实验[\s\S]*?<select>/);
  assert.match(appSource, /仿真次数/);
  assert.match(appSource, /data-mc-action="start"/);
  assert.match(appSource, /experimentRunStatus = "运行中"/);
  assert.match(appSource, /selectedFeatureId = getPlanListFeatureId\(page\.module\)/);
  assert.match(appSource, /status: experimentRunStatus/);
  assert.doesNotMatch(appSource, /class="mc-main-tabs"/);
  assert.doesNotMatch(appSource, /class="mc-subtabs"/);
  assert.doesNotMatch(appSource, /正交实验配置与分析/);
  assert.doesNotMatch(appSource, /正交因素/);
  assert.doesNotMatch(appSource, /预检查/);
  assert.match(styleSource, /\.mc-workbench/);
  assert.match(styleSource, /\.mc-config-panel/);
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

test("monte carlo evaluation result is rendered in result analysis page", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderMonteCarloResults/);
  assert.match(appSource, /蒙特卡洛评估结果/);
  assert.match(appSource, /蒙特卡洛评估值/);
  assert.match(appSource, /目标值/);
  assert.match(appSource, /mc-result-cards/);
  assert.match(appSource, /mc-evaluation-table/);
});

test("system management exposes an independent equipment RMS allocation workbench", async () => {
  const page = getFeaturePageById("system-management-equipment-rms-allocation");
  assert.equal(page.module, "系统管理");
  assert.equal(page.secondary, "装备RMS指标分配");
  assert.equal(page.tertiary, "装备RMS指标分配");
  assert.equal(page.name, "装备RMS指标分配");
  assert.deepEqual(page.dataObjects, ["rmsAllocationPlan", "equipmentNodes", "missionExposure", "allocationResults"]);

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /renderRmsAllocationWorkbench/);
  assert.match(appSource, /data-rms-path/);
  assert.match(appSource, /calculateRmsAllocation\(rmsAllocationPlan, rmsAllocationProject\)/);
  assert.match(appSource, /publishRmsAllocation\(rmsAllocationProject, rmsAllocationResult\)/);
  assert.match(appSource, /function renderTopbarContext\(page\)/);
  assert.match(appSource, /htmlEscape\(currentProject\.name\)} \/ \$\{renderTopbarContext\(page\)\}/);
  assert.match(appSource, /系统管理 \/ \$\{htmlEscape\(page\.secondary\)\} \/ \$\{htmlEscape\(page\.tertiary\)\}/);
  assert.match(styleSource, /\.rms-allocation-workbench/);
  assert.match(styleSource, /\.rms-equipment-tree/);
  assert.match(styleSource, /\.rms-verification-panel/);

  const workbenchSource = await readFile(new URL("../front/rms-allocation-workbench.mjs", import.meta.url), "utf8");
  assert.match(workbenchSource, /可靠性分配 \/ RMS 分配/);
  assert.match(workbenchSource, /data-rms-action="publish"/);
  assert.match(workbenchSource, /装备级任务可靠度 R\(T\)/);
  assert.match(workbenchSource, /可靠性分配方法/);
  assert.match(workbenchSource, /等分配法/);
  assert.match(workbenchSource, /比例分配法/);
  assert.match(workbenchSource, /AGREE 分配法/);
  assert.match(workbenchSource, /评分分配法/);
  assert.match(workbenchSource, /任务暴露矩阵/);
  assert.match(workbenchSource, /自底向上校核/);
});

test("system management exposes project management and base configuration pages", async () => {
  const expectedPages = [
    ["system-management-project-data-management", "项目管理", "数据管理", ["projects", "projectDataSets", "dataOwnership"]],
    ["system-management-modeling-granularity-management", "项目管理", "建模颗粒度管理", ["modelingLevels", "modelingObjects", "objectRelations"]],
    ["system-management-user-management", "系统基础配置", "用户管理", ["users", "roles", "organizations"]],
    ["system-management-function-permission-management", "系统基础配置", "系统功能权限管理", ["features", "roles", "permissionRules"]],
    ["system-management-modeling-form-management", "系统基础配置", "建模表单管理", ["formLevels", "formFields", "formRelations"]]
  ];

  for (const [id, secondary, name, dataObjects] of expectedPages) {
    const page = getFeaturePageById(id);
    assert.equal(page.module, "系统管理");
    assert.equal(page.secondary, secondary);
    assert.equal(page.tertiary, name);
    assert.equal(page.name, name);
    assert.deepEqual(page.dataObjects, dataObjects);
  }

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function renderSystemProjectManagement\(page\)/);
  assert.match(appSource, /function renderSystemBasicConfig\(page\)/);
  assert.match(appSource, /function renderProjectDataTable/);
  assert.match(appSource, /function renderModelingGranularityTable/);
  assert.match(appSource, /function renderUserManagementConfig/);
  assert.match(appSource, /function renderPermissionManagementConfig/);
  assert.match(appSource, /function renderFormManagementConfig/);
  assert.match(appSource, /项目标识与数据集/);
  assert.match(appSource, /层级、对象及关系/);
  assert.match(appSource, /字段与关联关系/);
  assert.match(styleSource, /\.system-config-workbench/);
  assert.match(styleSource, /\.system-config-layout/);
});

test("project ontology covers the four rebuild-plan layers", () => {
  const groups = new Set(PROJECT_ONTOLOGY.nodes.map((node) => node.group));
  assert.ok(groups.has("modeling-object"));
  assert.ok(groups.has("simulation-experiment"));
  assert.ok(groups.has("model-instance"));
  assert.ok(groups.has("computation-artifact"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "monte-carlo-config"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id.startsWith("aircraft:")));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id.startsWith("support_task:")));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id.startsWith("metric:")));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "metric-time-series"));
  assert.ok(PROJECT_ONTOLOGY.edges.some((edge) => edge.from === "monte-carlo-config" && edge.to === "simulation-run"));
  assert.ok(PROJECT_ONTOLOGY.edges.some((edge) => edge.from === "simulation-run" && edge.to.startsWith("aircraft:")));
  assert.ok(PROJECT_ONTOLOGY.edges.some((edge) => edge.from.startsWith("metric:") && edge.to === "metric-time-series"));
});

test("project ontology is generated from an Ontology Playground compatible shape", () => {
  assert.equal(PROJECT_ONTOLOGY_PLAYGROUND.name, "备件规划与任务可靠度项目Ontology");
  assert.equal(PROJECT_ONTOLOGY_PLAYGROUND.entityTypes.length, PROJECT_ONTOLOGY.nodes.length);
  assert.equal(PROJECT_ONTOLOGY_PLAYGROUND.relationships.length, PROJECT_ONTOLOGY.edges.length);
  assert.equal(
    new Set(PROJECT_ONTOLOGY_PLAYGROUND.relationships.map((relationship) => relationship.id)).size,
    PROJECT_ONTOLOGY_PLAYGROUND.relationships.length
  );
  for (const entity of PROJECT_ONTOLOGY_PLAYGROUND.entityTypes) {
    assert.ok(entity.id);
    assert.ok(entity.name);
    assert.ok(entity.description);
    assert.ok(entity.color);
    assert.ok(entity.icon);
    assert.ok(entity.properties.some((property) => property.isIdentifier), entity.id);
  }
  for (const relationship of PROJECT_ONTOLOGY_PLAYGROUND.relationships) {
    assert.ok(relationship.id);
    assert.ok(relationship.name);
    assert.ok(relationship.from);
    assert.ok(relationship.to);
    assert.ok(["one-to-one", "one-to-many", "many-to-one", "many-to-many"].includes(relationship.cardinality));
  }
});

test("modeling object layer is generated from feature pages and the project JSON contract", () => {
  const missionProfilePage = getFeaturePageById("spare-planning-composite-task");
  const contractNode = PROJECT_ONTOLOGY.nodes.find((node) => node.id === "project:missionProfile");

  assert.equal(PROJECT_ONTOLOGY.nodes.some((node) => node.id === `feature:${missionProfilePage.id}`), false);

  assert.ok(contractNode);
  assert.equal(contractNode.group, "modeling-object");
  assert.equal(contractNode.source.kind, "project-json-contract");
  assert.ok(contractNode.source.fieldPaths.includes("missionProfile.profileType"));
  assert.ok(contractNode.source.fieldPaths.includes("missionProfile.repeatCycleHours"));
  assert.ok(contractNode.source.featurePages.some((page) => page.featureId === missionProfilePage.id));
  assert.ok(contractNode.source.featurePages.some((page) => page.name === "复合任务建模"));
  assert.equal(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "task"), false);
});

test("modeling object layer keeps form pages as project object metadata", () => {
  const modelingPages = FEATURE_PAGES.filter((page) => page.secondary === "仿真建模");
  const experimentAndAnalysisPages = FEATURE_PAGES.filter((page) => page.secondary !== "仿真建模");

  for (const page of modelingPages) {
    assert.equal(PROJECT_ONTOLOGY.nodes.some((node) => node.id === `feature:${page.id}`), false, page.id);
    for (const objectPath of page.dataObjects) {
      const objectNode = PROJECT_ONTOLOGY.nodes.find((node) => node.id === `project:${objectPath.split(".")[0]}`);
      assert.ok(objectNode, `${page.id}:${objectPath}`);
      assert.ok(objectNode.source.featurePages.some((sourcePage) => sourcePage.featureId === page.id), page.id);
    }
  }

  for (const page of experimentAndAnalysisPages) {
    assert.equal(PROJECT_ONTOLOGY.nodes.some((node) => node.id === `feature:${page.id}`), false, page.id);
  }

  for (const id of ["project:experiment", "project:monteCarlo", "project:runs", "project:summary", "project:decisionOutputs"]) {
    assert.equal(PROJECT_ONTOLOGY.nodes.some((node) => node.id === id && node.group === "modeling-object"), false, id);
  }

  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "experiment-plan" && node.group === "simulation-experiment"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "monte-carlo-config" && node.group === "simulation-experiment"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "spare-shortfall-analysis" && node.group === "computation-artifact"));
});

test("modeling object layer does not promote object fields into standalone project nodes", () => {
  const nestedProjectNodes = PROJECT_ONTOLOGY.nodes.filter((node) => (
    node.group === "modeling-object"
    && node.id.startsWith("project:")
    && node.id.includes(".")
  ));

  assert.deepEqual(nestedProjectNodes.map((node) => node.id), []);
});

test("module-scoped ontology only loads modeling objects from the launching module", () => {
  const spareOntology = buildProjectOntology({ module: "备件规划评估模块" });
  const reliabilityOntology = buildProjectOntology({ module: "任务可靠度评估模块" });

  const spareFeatureSources = spareOntology.nodes
    .filter((node) => node.group === "modeling-object" && node.id.startsWith("project:"))
    .flatMap((node) => node.source.featurePages);
  const reliabilityFeatureSources = reliabilityOntology.nodes
    .filter((node) => node.group === "modeling-object" && node.id.startsWith("project:"))
    .flatMap((node) => node.source.featurePages);

  assert.equal(spareOntology.nodes.some((node) => node.id.startsWith("feature:")), false);
  assert.ok(spareFeatureSources.some((page) => page.featureId === "spare-planning-support-personnel"));
  assert.equal(spareFeatureSources.some((page) => page.featureId.startsWith("mission-reliability-")), false);
  assert.equal(spareOntology.nodes.some((node) => node.id === "project:reliabilityBlockDiagram"), false);

  assert.equal(reliabilityOntology.nodes.some((node) => node.id.startsWith("feature:")), false);
  assert.ok(reliabilityFeatureSources.some((page) => page.featureId === "mission-reliability-support-personnel"));
  assert.equal(reliabilityFeatureSources.some((page) => page.featureId.startsWith("spare-planning-")), false);
  assert.ok(reliabilityOntology.nodes.some((node) => node.id === "project:reliabilityBlockDiagram"));
});

test("modeling feature pages can build ontology focus contexts", () => {
  const page = getFeaturePageById("spare-planning-composite-task");
  const context = buildOntologyContext(page);
  assert.equal(context.focusNodeIds.includes(`feature:${page.id}`), false);
  assert.ok(context.focusNodeIds.includes("project:missionProfile"));
  assert.equal(context.nodes.some((node) => node.id === `feature:${page.id}`), false);
  assert.ok(context.nodes.some((node) => node.id === "project:missionProfile"));
  assert.ok(context.nodes.some((node) => node.id === "scenario"));
  assert.ok(context.edges.some((edge) => edge.from === "project:missionProfile" && edge.to === "scenario"));
});

test("experiment and analysis focus contexts do not reintroduce modeling-layer objects", () => {
  const monteCarloPage = getFeaturePageById("spare-planning-monte-carlo-config");
  const monteCarloContext = buildOntologyContext(monteCarloPage);
  assert.ok(monteCarloContext.focusNodeIds.includes("monte-carlo-config"));
  assert.equal(monteCarloContext.focusNodeIds.includes(`feature:${monteCarloPage.id}`), false);
  assert.equal(monteCarloContext.nodes.some((node) => node.id === "project:monteCarlo"), false);

  const analysisPage = getFeaturePageById("spare-planning-spare-shortfall-analysis");
  const analysisContext = buildOntologyContext(analysisPage);
  assert.ok(analysisContext.focusNodeIds.includes("spare-shortfall-analysis"));
  assert.equal(analysisContext.focusNodeIds.includes(`feature:${analysisPage.id}`), false);
});

test("frontend removes the standalone ontology visualization route", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /ONTOLOGY_PAGE_ID/);
  assert.doesNotMatch(appSource, /renderOntologyVisualizationPage/);
  assert.doesNotMatch(appSource, /data-feature-id="ontology-map"/);
});

test("editable and project text values are escaped before template insertion", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /htmlEscape\(currentProject\.name\)/);
  assert.match(appSource, /htmlEscape\(project\.name\)/);
  assert.match(appSource, /htmlEscape\(project\.summary\)/);
  assert.match(appSource, /htmlEscape\(scenario\.experiment\.name\)/);
  assert.match(appSource, /htmlEscape\(plan\.name\)/);
});

test("visual simulation page embeds Mesa visualization and ontology views", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /mesa-visual-shell/);
  assert.match(appSource, /mesaTab\("aircraft"/);
  assert.match(appSource, /mesaTab\("mission"/);
  assert.match(appSource, /mesaTab\("support"/);
  assert.match(appSource, /mesaTab\("ontology"/);
  assert.match(appSource, /Mesa ABM/);
  assert.match(appSource, /renderMesaOntologyPanel/);
  assert.match(appSource, /renderOntologySvg\(ontology/);
  assert.match(appSource, /buildMesaOntologyFocusSet/);
  assert.match(appSource, /isVisualSimulationPage/);
  assert.match(appSource, /<h2>\$\{htmlEscape\(page\.tertiary\)\}<\/h2>/);
  assert.doesNotMatch(appSource, /return `<div>\$\{breadcrumb\}<\/div>`;/);
  assert.doesNotMatch(appSource, /可视化实验启动与停止<\/h2>/);
});

test("visual simulation consumes the Mesa contract provider with demo fallback", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  // 数据源指向契约服务 8521，服务不可用时回退演示快照
  assert.match(appSource, /const CONTRACT_BASE = "http:\/\/127\.0\.0\.1:8521"/);
  assert.match(appSource, /fetch\(`\$\{CONTRACT_BASE\}\/visualization/);
  assert.match(appSource, /liveAviationState \|\| AVIATION_SUPPORT_DEMO_STATE/);
  assert.match(appSource, /aviationSource = "live"/);
  assert.match(appSource, /aviationSource = "demo"/);
  // 运行 / 单步 / 重置 驱动契约请求
  assert.match(appSource, /data-mesa-control/);
  assert.match(appSource, /loadAviationSupportState\(\)/);
});

test("mesa ontology graph is scoped to the selected feature module", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /buildProjectOntology/);
  assert.match(appSource, /function currentMesaOntology/);
  assert.match(appSource, /buildProjectOntology\(\{ module: page\.module \}\)/);
  assert.doesNotMatch(appSource, /renderOntologySvg\(PROJECT_ONTOLOGY/);
});

test("mesa ontology canvas uses four vertical collapsible layers", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /group: "modeling-object"/);
  assert.match(appSource, /group: "simulation-experiment"/);
  assert.match(appSource, /group: "model-instance"/);
  assert.match(appSource, /group: "computation-artifact"/);
  assert.match(appSource, /data-ontology-band-toggle/);
  assert.match(appSource, /collapsedOntologyGroups/);
});

test("mesa ontology view supports fullscreen toggle and selectable graph details", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /data-ontology-fullscreen/);
  assert.match(appSource, /ontology-fullscreen/);
  assert.match(appSource, /selectedOntologyItem/);
  assert.match(appSource, /data-ontology-node-id/);
  assert.match(appSource, /data-ontology-edge-id/);
  assert.match(appSource, /renderMesaOntologyDetailPanel/);
  assert.match(appSource, /renderOntologyNodeDetail/);
  assert.match(appSource, /renderOntologyEdgeDetail/);
  assert.match(appSource, /属性详情/);
  assert.match(styleSource, /\.mesa-visual-shell\.ontology-fullscreen/);
  assert.match(styleSource, /\.ontology-detail-list/);
  assert.match(styleSource, /\.ontology-node\.selected circle/);
  assert.match(styleSource, /\.ontology-edge\.selected path/);
});

test("mesa ontology graph supports resizable layers draggable nodes and field panels", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /ontologyBandLayout/);
  assert.match(appSource, /ontologyNodePositionOverrides/);
  assert.match(appSource, /activeOntologyDrag/);
  assert.match(appSource, /data-ontology-band-resize/);
  assert.match(appSource, /getOntologySvgPoint/);
  assert.match(appSource, /sortOntologyNodesForRender/);
  assert.match(appSource, /renderOntologyFieldRows/);
  assert.match(appSource, /renderOntologyRelationList/);
  assert.match(appSource, /字段/);
  assert.match(appSource, /关联关系/);
  assert.match(styleSource, /\.ontology-band-resize-handle/);
  assert.match(styleSource, /\.ontology-node\.dragging circle/);
  assert.match(styleSource, /\.ontology-field-table/);
  assert.match(styleSource, /\.ontology-relation-list/);
});

test("mesa ontology svg does not render a separate framed canvas", async () => {
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const mesaSvgRule = styleSource.match(/\.mesa-ontology-stage \.ontology-svg\s*\{[^}]+\}/)?.[0] || "";

  assert.match(mesaSvgRule, /border:\s*0/);
  assert.match(mesaSvgRule, /border-radius:\s*0/);
  assert.match(mesaSvgRule, /background:\s*transparent/);
});

test("mesa ontology fullscreen uses canvas-first spring layout with compact circular nodes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /isOntologyDetailCollapsed/);
  assert.match(appSource, /data-ontology-detail-toggle/);
  assert.match(appSource, /renderMesaOntologyCollapsedPanel/);
  assert.match(appSource, /calculateOntologySpringLayout/);
  assert.match(appSource, /springIterations/);
  assert.match(appSource, /nodeRadius/);
  assert.match(appSource, /edgePath\(from, to, ONTOLOGY_NODE_RADIUS\)/);
  assert.match(appSource, /<circle r="\$\{ONTOLOGY_NODE_RADIUS\}"/);
  assert.match(styleSource, /\.ontology-fullscreen \.mesa-visual-grid/);
  assert.match(styleSource, /\.ontology-fullscreen \.mesa-side-panel\.collapsed/);
  assert.match(styleSource, /\.ontology-detail-toggle/);
  assert.match(styleSource, /\.ontology-node circle/);
});
