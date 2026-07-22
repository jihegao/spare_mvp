import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FEATURE_PAGES,
  getAccessibleFeaturePageById,
  getFeaturePageById,
  getVisibleFeaturePagesForRole,
  groupFeaturePages
} from "../front/feature-catalog.mjs";
import { buildPermissionMenuTree, PERMISSION_MENU_ROLES } from "../front/permission-menu-tree.mjs";
import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject
} from "../front/rms-allocation-engine.mjs";
import { renderRmsAllocationWorkbench } from "../front/rms-allocation-workbench.mjs";

const PAGE_REVISION_REPORT_URL = new URL("../reports/2026-06-19-page-revision-suggestions/README.md", import.meta.url);
const RBD_RENDERING_CONTRACT_URL = new URL("../docs/reliability-block-diagram-contract.md", import.meta.url);
const DOCS_README_URL = new URL("../docs/README.md", import.meta.url);
const FRONTEND_STYLES_URL = new URL("../front/styles.css", import.meta.url);

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 46);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 46);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 19);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 21);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "系统运行支持模块").length, 6);
  for (const label of ["装备系统建模", "装备可靠性框图建模", "飞机转场携行清单分析", "飞机任务可靠性评估", "任务可靠度评估", "停机因素分析", "建模表单管理"]) {
    assert.ok(FEATURE_PAGES.some((page) => page.name === label), label);
  }
  assert.equal(FEATURE_PAGES.some((page) => page.name === "Mesa蒙特卡洛分析"), false);
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

test("active docs record lite Mesa analysis metric formulas", async () => {
  const docs = await readFile(DOCS_README_URL, "utf8");

  assert.match(docs, /\/api\/mesa-analysis-runs/);
  assert.match(docs, /出动架次率 = 起飞总架次 \/ 飞机总数 \/ 仿真总天数/);
  assert.match(docs, /战备完好率 = 每天 14:00 的可用飞机数量 \/ 总飞机数量/);
  assert.match(docs, /平均备件延误时间\(h\) = 总调运延误时间\(分钟\) \/ 60 \/ 备件调运次数/);
  assert.doesNotMatch(docs, /四个结果分析页通过 current result 面板和正式 projection payload 解锁结果/);
});

test("basic support activity CSV computes preview before committing the staged Scenario", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const importSource = appSource.slice(
    appSource.indexOf("async function importBasicSupportActivityCsvFile"),
    appSource.indexOf("function stageBasicSupportActivityImport")
  );

  const previewIndex = importSource.indexOf("updatePreviewResultsThroughApiClient(staged.scenario)");
  const commitIndex = importSource.indexOf("scenario = staged.scenario");
  assert.ok(previewIndex >= 0, "staged preview validation is missing");
  assert.ok(commitIndex > previewIndex, "Scenario must not be replaced before staged preview validation succeeds");
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
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["Mesa页面"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["可视化推演"].map((page) => page.name), ["Mesa页面"]);
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["蒙特卡洛实验"].map((page) => page.name), ["实验详情"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["蒙特卡洛实验"].map((page) => page.name), ["实验详情"]);
  assert.equal("Mesa分析" in grouped["备件规划评估模块"]["仿真实验"], false);
  assert.equal("Mesa分析" in grouped["任务可靠度评估模块"]["仿真实验"], false);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["结果分析"]), ["备件短板分析", "飞机转场携行清单分析"]);
  assert.deepEqual(grouped["备件规划评估模块"]["结果分析"]["备件短板分析"].map((page) => page.name), ["备件短板分析"]);
  assert.deepEqual(Object.keys(grouped["任务可靠度评估模块"]["结果分析"]), ["飞机任务可靠性评估", "任务可靠度评估", "停机因素分析"]);
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
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-config").id, "spare-planning-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-config").id, "mission-reliability-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-experiment-list").id, "spare-planning-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-experiment-list").id, "mission-reliability-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-experiment-edit").id, "spare-planning-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-experiment-edit").id, "mission-reliability-monte-carlo-experiment-detail");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-experiment-detail").component, "lite-mesa-monte-carlo-analysis");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-experiment-detail").component, "lite-mesa-monte-carlo-analysis");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-results").id, "system-management-project-data-management");
  assert.equal(getFeaturePageById("spare-planning-monte-carlo-results-display").id, "system-management-project-data-management");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-results").id, "system-management-project-data-management");
  assert.equal(getFeaturePageById("mission-reliability-monte-carlo-results-display").id, "system-management-project-data-management");
  assert.equal(getFeaturePageById("spare-planning-visual-mesa-page").component, "visual-simulation");
  assert.equal(getFeaturePageById("mission-reliability-visual-mesa-page").component, "visual-simulation");
  assert.equal(getFeaturePageById("spare-planning-visual-start-stop").id, "spare-planning-visual-mesa-page");
  assert.equal(getFeaturePageById("mission-reliability-visual-start-stop").id, "mission-reliability-visual-mesa-page");
  assert.equal(getFeaturePageById("spare-planning-scenario-switch").id, "spare-planning-visual-mesa-page");
  assert.equal(getFeaturePageById("spare-planning-visual-results").id, "spare-planning-visual-mesa-page");
  assert.equal(getFeaturePageById("mission-reliability-scenario-switch").id, "mission-reliability-visual-mesa-page");
  assert.equal(getFeaturePageById("mission-reliability-visual-results").id, "mission-reliability-visual-mesa-page");
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
  assert.equal(getFeaturePageById("mission-reliability-aircraft-mission-reliability").name, "飞机任务可靠性评估");
  assert.equal(getFeaturePageById("mission-reliability-aircraft-mission-reliability").component, "aircraft-mission-reliability-analysis");
  assert.equal(getFeaturePageById("mission-reliability-aircraft-task-reliability").id, "mission-reliability-aircraft-mission-reliability");
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

test("demo role permissions expose fixed module visibility without config rows", () => {
  const modulesForRole = (role) => [...new Set(getVisibleFeaturePagesForRole(FEATURE_PAGES, role).map((page) => page.module))];
  const adminPages = getVisibleFeaturePagesForRole(FEATURE_PAGES, "系统管理员");
  const dataPages = getVisibleFeaturePagesForRole(FEATURE_PAGES, "数据管理员");
  const userPages = getVisibleFeaturePagesForRole(FEATURE_PAGES, "普通用户");

  assert.deepEqual(modulesForRole("系统管理员"), ["系统运行支持模块", "备件规划评估模块", "任务可靠度评估模块"]);
  assert.ok(adminPages.some((page) => page.secondary === "系统基础配置"));
  assert.deepEqual(modulesForRole("数据管理员"), ["系统运行支持模块", "备件规划评估模块", "任务可靠度评估模块"]);
  assert.equal(dataPages.some((page) => page.secondary === "系统基础配置"), false);
  assert.deepEqual(modulesForRole("普通用户"), ["备件规划评估模块", "任务可靠度评估模块"]);
  assert.equal(userPages.some((page) => page.module === "系统运行支持模块"), false);
});

test("permission management mirrors the left-navigation leaf tree and fixed role visibility", () => {
  const menuTree = buildPermissionMenuTree();
  const leaves = menuTree.flatMap(({ module, secondaryGroups }) => secondaryGroups.flatMap(({ secondary, leaves }) => (
    leaves.map((leaf) => ({ module, secondary, ...leaf }))
  )));
  const navigationLeaves = Object.entries(groupFeaturePages(FEATURE_PAGES)).flatMap(([module, secondaryGroups]) => (
    Object.entries(secondaryGroups).flatMap(([secondary, tertiaryGroups]) => (
      Object.keys(tertiaryGroups).map((tertiary) => ({ module, secondary, tertiary }))
    ))
  ));

  assert.deepEqual(PERMISSION_MENU_ROLES.map(({ label }) => label), ["系统管理员", "数据管理员", "项目用户"]);
  assert.equal(leaves.length, 25);
  assert.deepEqual(
    leaves.map(({ module, secondary, tertiary }) => ({ module, secondary, tertiary })),
    navigationLeaves
  );
  assert.deepEqual(
    leaves.find((leaf) => leaf.module === "系统运行支持模块" && leaf.tertiary === "项目数据管理").visibility,
    { admin: true, data: true, user: false }
  );
  assert.deepEqual(
    leaves.find((leaf) => leaf.module === "系统运行支持模块" && leaf.tertiary === "用户管理").visibility,
    { admin: true, data: false, user: false }
  );
  assert.deepEqual(
    leaves.find((leaf) => leaf.module === "备件规划评估模块" && leaf.tertiary === "装备任务建模").visibility,
    { admin: true, data: true, user: true }
  );
});

test("demo role permissions clamp direct feature routes to first accessible page", () => {
  assert.equal(
    getAccessibleFeaturePageById("spare-planning-equipment-system", "系统管理员").id,
    "spare-planning-equipment-system"
  );
  assert.equal(
    getAccessibleFeaturePageById("system-management-user-management", "数据管理员").id,
    "system-management-project-data-management"
  );
  assert.equal(
    getAccessibleFeaturePageById("system-management-project-data-management", "普通用户").id,
    "spare-planning-equipment-system"
  );
  assert.equal(
    getAccessibleFeaturePageById("mission-reliability-equipment-system", "数据管理员").id,
    "mission-reliability-equipment-system"
  );
});

test("modeling form management describes composite task item fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const compositeSheetSource = appSource.slice(
    appSource.indexOf('key: "composite-task"'),
    appSource.indexOf('key: "periodic-task"')
  );

  for (const label of [
    "基本任务名称",
    "编队名称",
    "出发时间（HH：MM）",
    "任务优先级（1最高）",
    "单日重复次数",
    "间隔小时数",
    "装备类型",
    "任务时长",
    "要求装备数量",
    "最小装备数量（继承）"
  ]) {
    assert.ok(compositeSheetSource.includes(`"${label}"`), label);
  }
  assert.doesNotMatch(compositeSheetSource, /回收时间/);
  assert.doesNotMatch(compositeSheetSource, /任务项/);
  assert.doesNotMatch(compositeSheetSource, /首波时间/);
});

test("system support project management removes standalone modeling import route but keeps local import actions", async () => {
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const granularityRenderSource = appSource.slice(
    appSource.indexOf("function renderModelingGranularityTable"),
    appSource.indexOf("function renderLocalModelingImportActions")
  );

  assert.doesNotMatch(catalogSource, /建模数据导入/);
  assert.doesNotMatch(catalogSource, /modeling-import-workbench/);
  assert.match(appSource, /function renderMainComponent/);
  assert.match(appSource, /function renderLocalModelingImportActions/);
  assert.match(appSource, /data-modeling-import-action="load-fixture"/);
  assert.match(appSource, /data-modeling-import-action="validate"/);
  assert.match(appSource, /data-modeling-import-action="save-draft"/);
  assert.doesNotMatch(granularityRenderSource, /renderLocalModelingImportActions/);
  assert.doesNotMatch(granularityRenderSource, /data-modeling-import-action/);
  assert.doesNotMatch(granularityRenderSource, /导入包维护/);
  assert.doesNotMatch(appSource, /renderModelingImportWorkbench/);
  assert.equal(FEATURE_PAGES.some((page) => page.id === "system-management-modeling-import-workbench"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.id === "system-management-modeling-form-management"), true);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "建模表单管理"), true);
  assert.match(appSource, /function renderModelingFormManagementConfig/);
  assert.match(appSource, /data-modeling-form-management/);
  assert.match(appSource, /data-product-catalog-management/);
  assert.match(appSource, /products\[\]\.id/);
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
  const currentContextSource = appSource.slice(
    appSource.indexOf("function shouldShowCurrentContext"),
    appSource.indexOf("function shouldUseExperimentPlanContextDropdown")
  );
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
  assert.match(currentContextSource, /page\.component !== "experiment-plan-management"/);
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
    sourceSlice("function renderLiteMesaMonteCarloAnalysis", "function syncLiteMesaSettingsFromMonteCarloExperiment")
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

test("built-in scenario airport fields stay string-only in Project JSON", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const builtInScenarioSource = appSource.slice(
    appSource.indexOf("function renderBuiltInScenario"),
    appSource.indexOf("function renderCombatUnitModeling")
  );

  assert.match(builtInScenarioSource, /field\("机场", "airports\.0"\)/);
  assert.doesNotMatch(builtInScenarioSource, /airports\.0\.name/);
  assert.doesNotMatch(builtInScenarioSource, /airports\.1\.name/);
  assert.doesNotMatch(builtInScenarioSource, /airports\.0\.supportNodeId/);
  assert.doesNotMatch(builtInScenarioSource, /airports\.1\.distanceToMissionKm/);
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
  const indexSource = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const PLATFORM_DISPLAY_NAME = "备件规划及任务可靠度验证评估平台 V1\.0"/);
  assert.match(appSource, /<h1>\$\{PLATFORM_DISPLAY_NAME\}<\/h1>/);
  assert.match(indexSource, /<h1>备件规划及任务可靠度验证评估平台 V1\.0<\/h1>/);
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
  assert.match(appSource, /location\.hash = workbenchHash\(getPlanListFeatureId\(page\.module\)\)/);
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
    appSource.indexOf("function renderLocalModelingImportActions")
  );
  const eventSource = appSource.slice(
    appSource.indexOf("function bindEvents"),
    appSource.indexOf("async function handleLogin")
  );

  assert.doesNotMatch(projectListSource, /data-project-add/);
  assert.match(projectListSource, /data-project-template-select/);
  assert.match(projectListSource, /data-project-create-from-template/);
  assert.doesNotMatch(projectListSource, /data-modeling-import-template/);
  assert.doesNotMatch(projectListSource, /data-project-create-from-import/);
  assert.doesNotMatch(projectListSource, /Level 0|Level 1|选择内置导入模板/);
  assert.match(projectListSource, /data-project-edit/);
  assert.match(projectListSource, /data-project-delete/);
  assert.doesNotMatch(projectListSource, /data-project-import/);
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
  assert.match(systemProjectSource, /data-project-data-config-module="project-data-layer"/);
  assert.match(systemProjectSource, /data-project-data-project-list/);
  assert.match(systemProjectSource, /data-project-template-management/);
  assert.match(systemProjectSource, /data-project-data-overview/);
  assert.doesNotMatch(systemProjectSource, /data-project-json-viewer/);
  assert.doesNotMatch(projectDataSource, /data-system-data-export/);
  assert.doesNotMatch(projectDataSource, /data-system-data-select-all/);
  assert.doesNotMatch(projectDataSource, /data-system-data-status/);
  assert.doesNotMatch(projectDataSource, /data-system-data-export-preview/);
  assert.match(systemProjectSource, /data-modeling-import-action="load-fixture"/);
  assert.match(systemProjectSource, /data-modeling-import-action="validate"/);
  assert.match(granularitySource, /function renderModelingGranularityTable/);
  assert.match(appSource, /全要素/);
  assert.match(appSource, /装备RMS/);
  assert.match(granularitySource, /data-granularity-profile-select/);
  assert.match(granularitySource, /aria-pressed/);
  assert.match(granularitySource, /disabled/);
  assert.match(appSource, /EQUIPMENT_RMS_EXCLUDED_SHEET_KEYS/);
  assert.match(appSource, /support-organization-structure/);
  assert.match(appSource, /logistics-support-activity/);
  assert.doesNotMatch(granularitySource, /颗粒度 A/);
  assert.doesNotMatch(granularitySource, /颗粒度 B/);
  assert.doesNotMatch(granularitySource, /可逐 sheet 调整字段粒度/);
  assert.doesNotMatch(granularitySource, /renderLocalModelingImportActions/);
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
  assert.match(eventSource, /const projectDataProjectButton = event\.target\.closest\("\[data-project-data-project-option\]"\)/);
  assert.match(eventSource, /const projectTemplateAction = event\.target\.closest\("\[data-project-template-action\]"\)/);
  assert.match(eventSource, /const granularityProfileButton = event\.target\.closest\("\[data-granularity-profile-select\]"\)/);
  assert.match(eventSource, /const modelingFieldSheetSelect = event\.target\.closest\("\[data-modeling-field-sheet-select\]"\)/);
  assert.match(eventSource, /const modelingFieldSelect = event\.target\.closest\("\[data-modeling-field-select\]"\)/);
  assert.doesNotMatch(eventSource, /data-project-import/);
  assert.match(eventSource, /const exportProjectButton = event\.target\.closest\("\[data-project-export\]"\)/);

  assert.match(userSource, /data-system-user-select-all/);
  assert.match(userSource, /data-system-user-select/);
  assert.match(userSource, /data-system-user-delete/);
  assert.doesNotMatch(userSource, /User is not allowed to perform this action/);

  assert.match(permissionSource, /buildPermissionMenuTree/);
  assert.match(permissionSource, /PERMISSION_MENU_ROLES/);
  assert.match(permissionSource, /data-permission-menu-leaf/);
  assert.match(permissionSource, /data-permission-menu-visibility/);
  assert.match(permissionSource, /data-role-key/);
  assert.match(permissionSource, /aria-pressed/);
  assert.match(permissionSource, /可见/);
  assert.match(permissionSource, /不可见/);
  assert.doesNotMatch(permissionSource, /按左侧菜单的最小叶子项展示当前角色可见性/);
  assert.doesNotMatch(permissionSource, /新增权限项/);
  assert.doesNotMatch(permissionSource, /批量删除/);
  assert.match(appSource, /permissionMenuVisibility: permissionMenuVisibilityRows\.map/);
  assert.match(appSource, /Array\.isArray\(payload\.permissionMenuVisibility\)/);
  assert.match(eventSource, /const systemManagementButton = event\.target\.closest\("\[data-system-management-entry\]"\)/);
  assert.match(eventSource, /const permissionConfigureButton = event\.target\.closest\("\[data-permission-configure\]"\)/);
  assert.match(eventSource, /const permissionMenuVisibilityButton = event\.target\.closest\("\[data-permission-menu-visibility\]"\)/);
  assert.match(eventSource, /togglePermissionMenuVisibility/);
});

test("project data management exposes project list, template controls, and overview without raw json", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stylesSource = await readFile(FRONTEND_STYLES_URL, "utf8");
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

  for (const label of ["装备系统", "装备任务", "保障组织", "保障活动"]) {
    assert.match(appSource, new RegExp(label));
  }

  assert.doesNotMatch(systemProjectSource, /项目独有数据/);
  assert.doesNotMatch(systemProjectSource, /新增项目数据/);
  assert.doesNotMatch(systemProjectSource, /仿真建模数据表 sheet 选择器/);
  assert.doesNotMatch(systemProjectSource, /项目数据管理配置/);
  assert.match(projectDataSource, /data-project-data-config-module="project-data-layer"/);
  assert.match(projectDataSource, /data-project-data-project-list/);
  assert.match(projectDataSource, /data-project-data-project-option/);
  assert.match(projectDataSource, /【模板】/);
  assert.match(projectDataSource, /data-project-template-management/);
  assert.match(projectDataSource, /data-project-template-action="set"/);
  assert.match(projectDataSource, /data-project-template-action="unset"/);
  assert.match(projectDataSource, /class="btn-primary project-replacement-file-button">导入项目数据/);
  assert.match(projectDataSource, /accept="\.json,\.xlsx,/);
  assert.match(stylesSource, /\.project-replacement-file-button\s*\{[\s\S]*border:\s*1px solid var\(--primary\);[\s\S]*border-radius:\s*8px;/);
  assert.match(projectDataSource, /data-project-data-overview/);
  assert.match(projectDataSource, /data-project-data-relationship-map/);
  assert.match(projectDataSource, /项目数据概览/);
  assert.match(projectDataSource, /对象关系/);
  assert.match(projectDataSource, /总出动架次/);
  assert.match(projectDataSource, /作战单元飞机/);
  assert.match(projectDataSource, /projectDataTotalSorties/);
  assert.match(projectDataSource, /projectDataCombatUnitMembers/);
  assert.match(projectDataSource, /projectDataRelationshipOverview/);
  assert.match(stylesSource, /\.project-data-relationship-map\s*\{/);
  assert.match(projectDataSource, /任务/);
  assert.match(projectDataSource, /装备/);
  assert.match(projectDataSource, /保障系统/);
  assert.match(projectDataSource, /保障活动/);
  assert.doesNotMatch(projectDataSource, /data-project-json-viewer/);
  assert.doesNotMatch(projectDataSource, /data-project-json-node/);
  assert.doesNotMatch(projectDataSource, /Project JSON 原始数据/);
  assert.match(projectDataSource, /project\.projectInfo\?\.isTemplate/);
  assert.match(projectDataSource, /project\.projectInfo\?\.is_template/);
  assert.match(projectDataSource, /is_template: isTemplate/);
  assert.match(projectDataSource, /backendApi\.getProject/);
  assert.match(projectDataSource, /backendApi\.saveProject/);
  assert.doesNotMatch(projectDataSource, /data-project-data-config-module="modeling-data-source"/);
  assert.doesNotMatch(projectDataSource, /建模数据源配置/);
  assert.doesNotMatch(projectDataSource, /data-project-data-config-module="published-template-library"/);
  assert.doesNotMatch(projectDataSource, /data-published-template-list/);
  assert.doesNotMatch(projectDataSource, /data-published-template-preview/);
  assert.doesNotMatch(projectDataSource, /data-modeling-import-action/);
  assert.doesNotMatch(projectDataSource, /字段路径/);
  assert.doesNotMatch(projectDataSource, /目标路径/);
  assert.doesNotMatch(projectDataSource, /data-system-data-export/);
  assert.doesNotMatch(projectDataSource, /data-system-data-select-all/);
  assert.doesNotMatch(projectDataSource, /data-system-data-module-select/);
  assert.doesNotMatch(projectDataSource, /data-system-data-select="\$\{htmlEscape\(sheet\.key\)\}"/);
  assert.doesNotMatch(projectDataSource, /data-system-data-status/);
  assert.doesNotMatch(projectDataSource, /data-system-data-export-preview/);
  assert.doesNotMatch(projectDataSource, /<th>操作<\/th>/);
  assert.doesNotMatch(projectDataSource, />配置<\/button>/);

  assert.match(eventSource, /const projectDataProjectButton = event\.target\.closest\("\[data-project-data-project-option\]"\)/);
  assert.match(eventSource, /const projectDataRelationButton = event\.target\.closest\("\[data-project-data-relation-focus\]"\)/);
  assert.match(eventSource, /const projectTemplateAction = event\.target\.closest\("\[data-project-template-action\]"\)/);
});

test("active docs explain Project JSON non-model field cleanup boundary", async () => {
  const rootReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const docsReadme = await readFile(new URL("../docs/README.md", import.meta.url), "utf8");
  const roadmap = await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8");
  const contractsReadme = await readFile(new URL("../contracts/README.md", import.meta.url), "utf8");
  const agentGuide = await readFile(new URL("../agent.md", import.meta.url), "utf8");
  const combinedDocs = [rootReadme, docsReadme, roadmap, contractsReadme, agentGuide].join("\n");

  assert.match(combinedDocs, /missionProfile\.profileType/);
  assert.match(combinedDocs, /missionProfile\.analysisRequests/);
  assert.match(combinedDocs, /deletedSupportResourceKeys/);
  assert.match(combinedDocs, /supportActivities\[\]\.requireDevices/);
  assert.match(combinedDocs, /supportActivities\[\]\.requiredDevices/);
  assert.match(combinedDocs, /supportActivityJobs\[\]/);
  assert.match(combinedDocs, /ExperimentPlan\.config\.analysisRequests\.largeSample/);
  assert.doesNotMatch(combinedDocs, /RunService 编译单次 smoke run/);
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

test("project list lays out each project as a single full-width row", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const projectListSource = appSource.slice(
    appSource.indexOf("function renderProjectListPage"),
    appSource.indexOf("function renderNavigation")
  );
  const projectGridStyle = styleSource.slice(
    styleSource.indexOf(".project-grid"),
    styleSource.indexOf(".project-card")
  );
  const projectCardStyle = styleSource.slice(
    styleSource.indexOf(".project-card {"),
    styleSource.indexOf(".project-card.active")
  );
  const projectCardFootStyle = styleSource.slice(
    styleSource.indexOf(".project-card-foot {"),
    styleSource.indexOf(".project-card-foot .compact-actions")
  );

  assert.match(projectListSource, /<section class="project-grid">/);
  assert.match(projectGridStyle, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(projectGridStyle, /auto-fit|auto-fill|minmax\(/);
  assert.match(projectCardStyle, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(projectCardStyle, /align-items:\s*center/);
  assert.doesNotMatch(projectCardStyle, /flex-direction:\s*column/);
  assert.match(projectCardFootStyle, /justify-content:\s*flex-end/);
});

test("project list exports project JSON without keeping a direct Project JSON import path", async () => {
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
    appSource.indexOf("async function exportProjectJson"),
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
    "data-project-export"
  ]) {
    assert.match(projectListSource, new RegExp(selector));
  }
  assert.doesNotMatch(projectListSource, /data-project-import/);
  assert.doesNotMatch(clickSource, /openProjectJsonImportPicker|data-project-import/);
  assert.match(clickSource, /exportProjectJson\(exportProjectButton\.dataset\.projectExport\)/);
  assert.match(ioSource, /resolveProjectJsonForExport\(project\)/);
  assert.match(ioSource, /downloadProjectJsonExport\(filename, projectJson\)/);
  assert.match(ioSource, /new Blob\(\[JSON\.stringify\(projectJson, null, 2\)\]/);
  assert.doesNotMatch(appSource, /function openProjectJsonImportPicker|function importProjectJsonFile|function validateImportedProjectJson|function projectCardFromProjectJson/);
  assert.doesNotMatch(appSource, /persistManualProjectJsonDraft|readManualProjectJsonDraft/);
  assert.doesNotMatch(hydrateSource, /Project JSON 草稿|本地项目 JSON/);
  assert.match(styleSource, /\.project-card-foot \.compact-actions[\s\S]*flex-wrap: wrap/);
});

test("results analysis pages route to independent Mesa session wrappers", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const wrapperSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function liteMesaAnalysisDefinitionForPage")
  );
  const pages = [
    ["spare-planning-spare-shortfall-analysis", "spare_shortfall"],
    ["spare-planning-carry-list-analysis", "carry_list"],
    ["mission-reliability-task-reliability", "mission_reliability"],
    ["mission-reliability-downtime-factor-analysis", "downtime_factors"]
  ];
  for (const [featureId, analysisType] of pages) {
    const page = getFeaturePageById(featureId);
    assert.equal(page.component, "lite-mesa-analysis", featureId);
    assert.ok(page.dataObjects.includes("projectDraft"), featureId);
    assert.ok(page.dataObjects.includes("mesaSessionResult"), featureId);
    assert.match(appSource, new RegExp(`${analysisType}:\\s*\\{[\\s\\S]*experimentId`));
  }
  assert.match(appSource, /function renderLiteMesaAnalysisPage/);
  assert.match(appSource, /function runLiteMesaAnalysisPage/);
  assert.match(appSource, /let liteMesaAnalysisResults =/);
  assert.match(appSource, /data-lite-mesa-analysis-action="run">运行分析/);
  assert.match(appSource, /backendApi\.runLiteMesaAnalysis/);
  assert.match(appSource, /session_complete/);
  assert.doesNotMatch(wrapperSource, /full-settings/);
  assert.match(appSource, /分析设定/);
  assert.match(appSource, /分析结果明细/);
  assert.match(appSource, /lite-mesa-analysis-setting-line/);
  assert.match(appSource, /备件满足率下限/);
  assert.match(appSource, /data-lite-mesa-analysis-field="missionConfidenceTarget"/);
  assert.doesNotMatch(appSource, /data-lite-mesa-analysis-field="maxTimeWindow"|<span>时间窗口<\/span>/);
  assert.match(appSource, /data-lite-mesa-analysis-field="topN"/);
  assert.match(appSource, /function updateLiteMesaAnalysisSetting/);
  assert.doesNotMatch(appSource, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
  assert.doesNotMatch(appSource, /fixedConfig|实验类型|统计口径|能满足任务要求置信度/);
  assert.doesNotMatch(appSource, /\["用户参数"/);
  assert.doesNotMatch(wrapperSource, /创建正式 run、result 与 artifact|正式 current-analysis|runFormalAnalysisPage/);
  assert.doesNotMatch(appSource, /await runCurrentAnalysisPage\(page\)/);
});

test("independent Mesa wrapper pages keep formal projection UI isolated", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const mesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function liteMesaAnalysisDefinitionForPage")
  );
  assert.notEqual(mesaSource.length, 0, "renderLiteMesaAnalysisPage source exists");
  assert.match(mesaSource, /data-lite-mesa-analysis-action="run"/);
  assert.match(mesaSource, /liteMesaAnalysisDetailTitle/);
  assert.match(mesaSource, /liteMesaAnalysisResultHeader/);
  assert.doesNotMatch(mesaSource, /lite-mesa-hero-meter/);
  assert.doesNotMatch(mesaSource, /definition\.experimentId/);
  assert.doesNotMatch(mesaSource, /会话内结果明细|建模粒度不足时不会伪造结论/);
  assert.doesNotMatch(mesaSource, /definition\.pageGoal|<p>\$\{htmlEscape\(definition\.pageGoal\)\}<\/p>/);
  assert.doesNotMatch(mesaSource, /lite-mesa-source-grid|selectedExperimentPlanName\(\)/);
  assert.doesNotMatch(mesaSource, /renderCurrentAnalysisResultPanel|renderAnalysisDashboard|renderFormalAnalysisBoundaryNote/);
  assert.doesNotMatch(mesaSource, /currentAnalysisResultForPage|formalProjectionFromCurrentResult|backendApi\.getCurrentAnalysisResult/);
  assert.doesNotMatch(mesaSource, /data-analysis-action="run-current"/);
  assert.doesNotMatch(mesaSource, /\bsingleResult\b|\bmonteCarloResult\b|hasPreviewAnalysisData|renderAnalysisEmptyState/);
});

test("spare shortfall page restores context and settings and sorts product rows from column headers", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const pageSource = appSource.slice(
    appSource.indexOf("function renderSpareShortfallAnalysisPage"),
    appSource.indexOf("function renderCarryListAnalysisPage")
  );
  const sessionSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisSessionBody"),
    appSource.indexOf('if (definition.analysisType === "carry_list")', appSource.indexOf("function renderLiteMesaAnalysisSessionBody"))
  );

  assert.match(pageSource, /lite-mesa-hero/);
  assert.match(pageSource, /<h3>\$\{htmlEscape\(definition\.title\)\}<\/h3>/);
  assert.match(pageSource, /renderExperimentPlanContextDropdown\(page\)/);
  assert.match(pageSource, /data-lite-mesa-analysis-action="run">运行分析<\/button>/);
  assert.match(pageSource, /lite-mesa-analysis-settings|renderLiteMesaAnalysisSettings/);
  assert.match(sessionSource, /data-spare-aircraft-filter/);
  assert.match(sessionSource, /renderSpareShortfallSortHeading\("需求数量", "demand"\)/);
  assert.match(sessionSource, /renderSpareShortfallSortHeading\("满足率", "fillRate"\)/);
  assert.match(sessionSource, /analysisProductDisplayName\(row, productsById\)/);
  assert.doesNotMatch(sessionSource, /row\.spareType/);
  assert.doesNotMatch(appSource, /data-spare-demand-sort|需求数量排序|恢复默认/);
  assert.match(styleSource, /\.analysis-sort-controls button\[aria-pressed="true"\]/);
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
  assert.doesNotMatch(stageSource, /htmlEscape\(row\.id\)/);
  assert.match(stageSource, /htmlEscape\(row\.statusLabel\)/);
  assert.match(stageSource, /assignedTailNumbers\.map\(\(tailNumber\) => htmlEscape\(tailNumber\)\)/);
  assert.doesNotMatch(stageSource, /\$\{aircraft\.state\}/);
  assert.doesNotMatch(stageSource, /\$\{aircraft\.label\}/);
  assert.doesNotMatch(stageSource, /\$\{mission\.status\}/);

  assert.match(aircraftSource, /htmlEscape\(aircraft\.type\)/);
  assert.match(aircraftSource, /htmlEscape\(selectedAircraft\.label\)/);
  assert.match(aircraftSource, /htmlEscape\(visualAircraftStateLabel\(aircraft\.state\)\)/);
  assert.match(aircraftSource, /htmlEscape\(aircraft\.state \|\| "-"\)/);
  assert.match(aircraftSource, /htmlEscape\(detail\)/);
  assert.match(aircraftSource, /htmlEscape\(meta\)/);
  assert.match(aircraftSource, /htmlEscape\(item\.name\)/);
  assert.doesNotMatch(aircraftSource, /\$\{selectedAircraft\.label\}/);
  assert.doesNotMatch(aircraftSource, /\$\{detail\}/);
  assert.doesNotMatch(aircraftSource, /\$\{item\.name\}/);

  assert.match(missionSource, /htmlEscape\(row\.basicTaskName\)/);
  assert.doesNotMatch(missionSource, /htmlEscape\(row\.id\)/);
  assert.match(missionSource, /htmlEscape\(row\.dayIndex\)/);
  assert.match(missionSource, /assignedTailNumbers\.map/);
  assert.match(missionSource, /htmlEscape\(tailNumber\)/);
  assert.doesNotMatch(missionSource, /assignedTailNumbers\.join\(" \/ "\)/);

  assert.match(stageSource, /htmlEscape\(row\.name\)/);
  assert.match(stageSource, /htmlEscape\(row\.primaryLabel\)/);
  assert.match(stageSource, /htmlEscape\(row\.secondaryLabel\)/);
  assert.match(supportSource, /htmlEscape\(row\.title\)/);
  assert.match(supportSource, /htmlEscape\(row\.message \|\| "保障作业"\)/);
  assert.match(supportSource, /htmlEscape\(row\.meta \|\| ""\)/);
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
  assert.match(supportOrgSource, /const visibleResourceRows = buildSupportResourceRows\(/);
  assert.match(supportOrgSource, /resourceSelection \? \{ orgNodes: resourceSelection\.resourceOrgNodes \} : undefined/);
  assert.match(supportOrgSource, /function resolveSupportResourceOrganizationSelection/);
  assert.match(supportOrgSource, /selectedIsEditableNode \? "当前保障点可编辑" : "汇总视图只读"/);
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
  assert.match(appSource, /function resetSupportResourceSelectionForFeatureChange/);
  assert.match(appSource, /function selectedEditableSpareSupportOrgNode/);
  assert.match(appSource, /const SUPPORT_SPARE_TOMBSTONE_ID_PREFIX = "support-spare-tombstone:"/);
  assert.match(appSource, /function supportResourceDeletedKeySet/);
  assert.match(appSource, /filter\(\(resource\) => isDeletedSupportSpareResource\(resource\)\)/);
  assert.match(appSource, /scenario\.supportResources/);
  assert.doesNotMatch(appSource, /scenario\.supportResourceOverrides/);
  assert.doesNotMatch(appSource, /scenario\.deletedSupportResourceKeys/);
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
  assert.match(supportOrgSource, /关联机场/);
  assert.match(supportOrgSource, /supportOrgAirportSelect\(selectedSupportOrgNode\)/);

  const spareDeleteSource = appSource.slice(
    appSource.indexOf("function deleteSelectedSupportResources"),
    appSource.indexOf("function findSupportOrgTreeNode")
  );
  assert.match(spareDeleteSource, /supportResourceTypeLabel\(resource\.type\) === activeResourceType/);
  assert.match(spareDeleteSource, /supportResourceBelongsToOrg\(resource, selectedResourceOrgNode\)/);
  assert.match(spareDeleteSource, /createDeletedSupportSpareResource\(resource, selectedResourceOrgNode\)/);
  assert.match(spareDeleteSource, /currentModelingPageLocked\(page\)/);

  const spareImportSource = appSource.slice(
    appSource.indexOf("async function importSupportResourceTableFile"),
    appSource.indexOf("function normalizeSupportResourceImportType")
  );
  assert.match(spareImportSource, /selectedEditableSupportResourceOrgNode\(resourceType\)/);
  assert.match(spareImportSource, /targetOrgNodes: \[selectedResourceOrgNode\]/);
  assert.match(appSource, /const matched = targetOrgNodes\.find/);
  assert.match(supportOrgSource, /data-support-org-field="airport"/);
  assert.doesNotMatch(supportOrgSource, /data-support-org-field="airportId"/);
  assert.match(supportOrgSource, /function supportOrgAirportSelect\(orgNode\)/);
  assert.match(supportOrgSource, /function supportOrgAirportOptions\(\)/);
  assert.match(supportOrgSource, /scenario\.combatUnit\?\.members/);
  assert.match(supportOrgSource, /combatUnitMemberAirport\(member\)/);
  assert.doesNotMatch(supportOrgSource, /scenarioAirports/);
  assert.doesNotMatch(supportOrgSource, /scenario\.airports/);
  assert.match(supportOrgSource, /supportNode\.airport = value/);
  assert.match(supportOrgSource, /delete supportNode\.airportId/);
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
  assert.match(appSource, /function supportActivityRuntimeNodeOptions\(activity\)/);
  assert.match(appSource, /function supportActivityRuntimeNodeField\(activity, activityIndex\)/);
  assert.match(appSource, /supportActivities\.\$\{activityIndex\}\.resourceId/);
  assert.match(appSource, /请选择运行保障点/);
  assert.match(operationsSource, /supportActivityRuntimeNodeField\(activePhaseActivity, activePhaseActivityIndex\)/);

  const logisticsSource = appSource.slice(
    appSource.indexOf("function renderLogisticsSupportActivity"),
    appSource.indexOf("function findLogisticsSupportActivity")
  );
  assert.match(logisticsSource, /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/);
  assert.match(logisticsSource, /\\u7b56\\u7565\\u540d\\u79f0/);
  assert.match(logisticsSource, /\\u7b56\\u7565\\u65b9\\u5411/);
  assert.match(logisticsSource, /\\u6a2a\\u5411\\u8fd0\\u8f93/);
  assert.match(logisticsSource, /\\u7eb5\\u5411\\u8fd0\\u8f93/);
  assert.doesNotMatch(logisticsSource, /\\u5907\\u4ef6\\u79cd\\u7c7b/);
  assert.match(logisticsSource, /\\u89e6\\u53d1\\u65b9\\u5f0f/);
  assert.match(logisticsSource, /\\u4e34\\u754c\\u5e93\\u5b58/);
  assert.match(logisticsSource, /\\u5468\\u671f\\u6027\\u8c03\\u8fd0/);
  assert.match(logisticsSource, /\\u89e6\\u53d1\\u53c2\\u6570/);
  assert.match(logisticsSource, /\\u4e34\\u754c\\u5e93\\u5b58\\u6570/);
  assert.match(logisticsSource, /\\u8c03\\u8fd0\\u5468\\u671f\(h\)/);
  assert.match(logisticsSource, /supportActivityRuntimeNodeField\(activity, activityIndex\)/);
  assert.match(logisticsSource, /criticalInventory/);
  assert.match(logisticsSource, /transferCycleHours/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u8d77\\u70b9/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u7ec8\\u70b9/);
  assert.match(logisticsSource, /\\u8fd0\\u8f93\\u65f6\\u95f4\(h\)/);
  assert.doesNotMatch(logisticsSource, /spareModelingNames\(\)\.map/);
  assert.match(logisticsSource, /valueSelect/);
  assert.match(logisticsSource, /valueInput/);
  assert.match(logisticsSource, /const basePath = `transportPolicies\.\$\{index\}`/);
  assert.match(logisticsSource, /valueInput\(`\$\{basePath\}\.name`, "text"\)/);
  assert.doesNotMatch(logisticsSource, /valueSelect\(`\$\{basePath\}\.spareName`/);
  assert.match(logisticsSource, /valueSelect\(`\$\{basePath\}\.fromOrganizationNodeId`/);
  assert.match(logisticsSource, /valueSelect\(`\$\{basePath\}\.toOrganizationNodeId`/);
  assert.match(logisticsSource, /data-logistics-transport-select/);
  assert.match(logisticsSource, /data-logistics-transport-delete/);
  assert.doesNotMatch(logisticsSource, /supportActivities\.\$\{activityIndex\}\.transportStrategies/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-delete="\$\{index\}"/);
  assert.doesNotMatch(logisticsSource, /\\u64cd\\u4f5c/);
  assert.doesNotMatch(logisticsSource, /data-logistics-transport-edit/);
  assert.doesNotMatch(logisticsSource, /\u4fdd\u969c\u7ec4\u7ec7\u7b56\u7565\u8868/);
  assert.doesNotMatch(logisticsSource, /\u65b9\u6848\u7c7b\u578b/);
  assert.doesNotMatch(logisticsSource, /renderSupportActivityJobTable\(activity, "logistics"\)/);
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
  assert.match(supportOrgSource, /const visibleResourceRows = buildSupportResourceRows\(/);
  assert.match(supportOrgSource, /resourceSelection \? \{ orgNodes: resourceSelection\.resourceOrgNodes \} : undefined/);
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
    /\u7ef4\u4fee\u65b9\u5f0f/,
    /\u539f\u4f4d\u7ef4\u4fee/,
    /\u6362\u4ef6\u7ef4\u4fee/,
    /\\u540e\\u52e4\\u4fdd\\u969c\\u8fd0\\u8f93\\u7b56\\u7565\\u914d\\u7f6e/,
    /data-logistics-transport-add>\\u65b0\\u589e/,
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
  assert.doesNotMatch(supportActivitySource, /renderSupportActivityJobTable\(activity, "logistics"\)/);
  assert.match(supportActivitySource, /const supportNodeOptions = logisticsSupportNodeOptions\(\)/);
  assert.match(supportActivitySource, /valueSelect\(`\$\{basePath\}\.fromOrganizationNodeId`, fromSupportNodeOptions\)/);
  assert.match(supportActivitySource, /valueSelect\(`\$\{basePath\}\.toOrganizationNodeId`, toSupportNodeOptions\)/);
  const supportActivityJobSource = supportActivitySource.slice(
    supportActivitySource.indexOf("function renderSupportActivityJobRows"),
    supportActivitySource.indexOf("function renderBasicActivityLibrary")
  );
  assert.match(supportActivityJobSource, /renderSupportActivityPredecessorCell/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-edit/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-dialog-close/);
  assert.doesNotMatch(supportActivityJobSource, /data-support-activity-predecessor-add-template/);
  assert.match(supportActivityJobSource, /data-support-activity-predecessor-toggle/);
  assert.match(supportActivityJobSource, /编辑紧前作业/);
  assert.match(supportActivityJobSource, /当前紧前作业清单/);
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
  const supportActivityJobLookupSource = supportActivitySource.slice(
    supportActivitySource.indexOf("function findSupportActivityByJobTabKey"),
    supportActivitySource.indexOf("function toggleSupportActivityJobSelection")
  );
  assert.match(supportActivityJobLookupSource, /\|\| baseActivity/);
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
  assert.match(basicActivityLibrarySource, /basicActivityResourceDialogResourceSelect/);
  assert.match(basicActivityLibrarySource, /basicActivitySupportResourceSelectOptions/);
  assert.match(basicActivityLibrarySource, /basicActivityPersonnelCatalogRows/);
  assert.match(basicActivityLibrarySource, /basicActivityEquipmentCatalogRows/);
  assert.match(basicActivityLibrarySource, /basicActivitySpareCatalogRows/);
  assert.match(basicActivityLibrarySource, /basicActivityWholeMachineScopeOptions/);
  assert.match(basicActivityLibrarySource, /"resourceKey"/);
  assert.doesNotMatch(basicActivityLibrarySource, /basicActivityResourceDialogTextInput/);
  assert.doesNotMatch(basicActivityLibrarySource, /\`\$\{resourceKind\}-models\`/);
  assert.doesNotMatch(basicActivityLibrarySource, /\`\$\{resourceKind\}-names\`/);
  assert.doesNotMatch(basicActivityLibrarySource, /buildSupportResourceRows\(resourceType, root\)/);
  assert.doesNotMatch(basicActivityLibrarySource, /supportOrganizationTree\(\)/);
  assert.doesNotMatch(basicActivityLibrarySource, /请先在保障组织配置/);
  assert.doesNotMatch(basicActivityLibrarySource, /row\.scope \|\| ""/);
  assert.match(basicActivityLibrarySource, /min="1"/);
  assert.match(basicActivityLibrarySource, /job\.personnel =/);
  assert.doesNotMatch(basicActivityLibrarySource, /job\.personnelRequirements =/);
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
  assert.match(appSource, /function renderEquipmentSystemTable\(selectedState, productsById\)/);
  assert.match(appSource, /selectedState\.kind === "aircraft-list"/);
  assert.match(appSource, /wholeMachineModels\(\)\.map\(\(model\) => renderEquipmentAircraftTableRow\(model, \{ editable: false \}\)\)/);
  assert.match(appSource, /class="equipment-system-table"/);
  assert.match(appSource, /<th>组件名称<\/th>/);
  assert.match(appSource, /<th>父节点<\/th>/);
  assert.match(appSource, /<th>数量n<\/th>/);
  assert.match(appSource, /组件属性/);
  assert.match(appSource, /可用数量要求k（n中取k）/);
  assert.match(appSource, /aria-label="可用数量要求k说明"/);
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
  assert.match(appSource, /renderEquipmentSystemTable\(selectedState, productsById\)/);
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
    equipmentSource.indexOf("装备结构数据") < equipmentSource.indexOf("data-equipment-import-file")
      && equipmentSource.indexOf("data-equipment-import-file") < equipmentSource.indexOf("data-equipment-search"),
    "equipment import button should live inside the left equipment structure tree panel"
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
  assert.match(appSource, /function normalizeEquipmentStructureImport\(input, products = \[\]\)/);
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
  assert.match(cleanupSource, /for \(const resource of scenario\.supportResources \|\| \[\]\)/);
  assert.match(cleanupSource, /resource\.aircraft\.filter\(\(model\) => String\(model\) !== oldModel\)/);
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
  assert.match(equipmentSource, /equipmentParentNodeSelect\(component, index\)/);
  assert.match(equipmentSource, /function equipmentParentNodeSelect\(component, index\)/);
  assert.match(equipmentSource, /const excludedParentIds = new Set\(equipmentComponentSubtreeIds\(scenario/);
  assert.match(equipmentSource, /!excludedParentIds\.has\(String\(candidate\.id\)\)/);
  assert.match(equipmentSource, /String\(candidate\.id\) !== "aircraft-root"/);
  assert.match(equipmentSource, /\{ value: "aircraft-root", label: `\$\{aircraftModel \|\| "整机"\}（整机级）` \}/);
  assert.match(equipmentSource, /label: String\(candidate\.name \|\| "未命名组件"\)/);
  assert.match(equipmentSource, /label: "未找到父节点"/);
  assert.match(equipmentSource, /function equipmentComponentAttributeSelect/);
  assert.match(equipmentSource, /组件属性/);
  assert.match(equipmentSource, /\{ value: "LRU", label: "LRU" \}/);
  assert.match(equipmentSource, /\{ value: "SRU", label: "SRU" \}/);
  assert.doesNotMatch(equipmentSource, /是否为LRU/);
  assert.doesNotMatch(equipmentSource, /field\("备件类型", `components\.\$\{selectedIndex\}\.spareType`\)/);
  assert.match(equipmentSource, /data-equipment-product-combobox/);
  assert.match(equipmentSource, /role="combobox"/);
  assert.match(equipmentSource, /equipmentKOutOfNInput\(selectedIndex\)/);
  assert.match(equipmentSource, /可用数量要求k（n中取k）/);
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

test("equipment product field is an exact-ID accessible combobox with explicit duplicate-safe creation", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const productSource = await readFile(new URL("../front/product-catalog.mjs", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const renderSource = appSource.slice(
    appSource.indexOf("function equipmentProductCell"),
    appSource.indexOf("function equipmentTableInput")
  );
  const behaviorSource = appSource.slice(
    appSource.indexOf("function bindEquipmentComponentProduct"),
    appSource.indexOf("function deleteSelectedEquipmentNode")
  );
  const querySource = behaviorSource.slice(
    behaviorSource.indexOf("function updateEquipmentProductComboboxQuery"),
    behaviorSource.indexOf("function handleEquipmentProductComboboxKeydown")
  );
  const equipmentRenderSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function buildEquipmentTreeNodes")
  );
  const productCellSource = renderSource.slice(
    renderSource.indexOf("function equipmentProductCell"),
    renderSource.indexOf("function renderEquipmentProductEditor")
  );

  assert.match(renderSource, /role="combobox"/);
  assert.match(renderSource, /aria-autocomplete="list"/);
  assert.match(renderSource, /aria-haspopup="listbox"/);
  assert.match(renderSource, /aria-expanded="\$\{String\(expanded\)\}"/);
  assert.match(renderSource, /aria-controls="\$\{listboxId\}"/);
  assert.match(renderSource, /aria-describedby="\$\{listboxId\}-current"/);
  assert.match(renderSource, /aria-activedescendant/);
  assert.match(renderSource, /role="listbox" aria-label="产品候选项"/);
  assert.match(renderSource, /role="option"/);
  assert.match(renderSource, /data-equipment-product-options>[\s\S]*<\/div>\s*<p class="muted equipment-product-empty"/);
  assert.match(renderSource, /型号：.*ID：/s);
  assert.match(renderSource, /role="status" aria-live="polite"/);
  assert.match(renderSource, /data-equipment-product-create-open/);
  assert.match(renderSource, /data-equipment-product-create-cancel/);
  assert.match(renderSource, /产品名称/);
  assert.match(renderSource, /产品型号/);
  assert.match(renderSource, /产品类型/);

  assert.match(productSource, /function searchProjectProducts\(project, query = ""\)/);
  assert.match(productSource, /\[product\?\.id, product\?\.name, product\?\.model\]/);
  assert.match(appSource, /\["ArrowDown", "ArrowUp", "Enter", "Escape"\]/);
  assert.match(appSource, /app\.addEventListener\("compositionstart"/);
  assert.match(appSource, /app\.addEventListener\("compositionend"/);
  assert.match(appSource, /event\.isComposing \|\| equipmentProductCompositionActive/);
  assert.match(behaviorSource, /const product = projectProductById\(scenario, productId\)/);
  assert.match(behaviorSource, /component\.productId = product\.id/);
  assert.doesNotMatch(querySource, /component\.productId|createProjectProduct/);
  assert.doesNotMatch(querySource, /render\(\)/);
  assert.match(behaviorSource, /const normalizedDraft = normalizedEquipmentProductCreationDraft\(component\)/);
  assert.match(behaviorSource, /findProjectProductConflicts\(scenario, normalizedDraft\)/);
  assert.match(behaviorSource, /createProjectProduct\(scenario, normalizedDraft\)/);
  assert.match(behaviorSource, /const normalizedModel = String\(draft\?\.model \|\| ""\)\.trim\(\)/);
  assert.match(behaviorSource, /model: normalizedModel \|\| String\(component\?\.id \|\| ""\)\.trim\(\)/);
  assert.match(behaviorSource, /conflicts\.nameMatches/);
  assert.match(behaviorSource, /conflicts\.modelMatches/);
  assert.match(behaviorSource, /请选择已有产品，未创建重复项/);
  assert.match(behaviorSource, /createProjectProduct\(scenario/);
  assert.match(productSource, /while \(byId\.has\(id\)\)/);
  assert.match(productSource, /id = `\$\{base\}-\$\{suffix\}`/);

  assert.equal((equipmentRenderSource.match(/normalizeProjectProducts\(scenario\)/g) || []).length, 1);
  assert.match(equipmentRenderSource, /const productsById = new Map/);
  assert.match(appSource, /renderEquipmentSystemTable\(selectedState, productsById\)/);
  assert.match(appSource, /equipmentProductCell\(component, productsById\)/);
  assert.doesNotMatch(productCellSource, /normalizeProjectProducts|projectProductById|ensureProductForComponent/);

  assert.match(styleSource, /\.equipment-product-combobox-cell/);
  assert.match(styleSource, /\.equipment-product-options\s*\{[^}]*max-height:\s*280px[^}]*overflow:\s*auto/s);
  assert.match(styleSource, /\.equipment-product-option\.is-active/);
  assert.match(styleSource, /\.equipment-product-option:focus-visible/);
});

test("equipment composition constrains k-out-of-n to an integer within quantity", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /data-equipment-k-out-of-n-index/);
  assert.match(appSource, /function updateEquipmentKOutOfNInput\(input\)/);
  assert.match(appSource, /const liveEquipmentKOutOfNInput = event\.target\.closest\("\[data-equipment-k-out-of-n-index\]"\)/);
  assert.match(appSource, /normalizeEquipmentComponentKOutOfN\(component\)/);
  assert.match(appSource, /validateEquipmentComponentKOutOfN\(component\)/);
  assert.match(appSource, /input\.setCustomValidity\(message\)/);
  assert.match(appSource, /enabled: quantity > 1, n: quantity, k: nextK/);
  assert.match(appSource, /min="1"/);
  assert.match(appSource, /step="1"/);
  assert.match(appSource, /max="\$\{htmlEscape\(quantity\)\}"/);
  assert.match(appSource, /placeholder="默认全部"/);
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

test("left feature navigation summaries show explicit collapsed and expanded indicators", async () => {
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const navSource = styleSource.slice(
    styleSource.indexOf(".nav-module summary,"),
    styleSource.indexOf(".nav-tertiary-link")
  );

  assert.match(navSource, /\.nav-module > summary::before,\s*\.nav-secondary > summary::before/);
  assert.match(navSource, /content:\s*">"/);
  assert.match(navSource, /\.nav-module\[open\] > summary::before,\s*\.nav-secondary\[open\] > summary::before/);
  assert.match(navSource, /content:\s*"v"/);
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

test("built-in scenario page configures only managed airport attributes", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  assert.match(appSource, /if \(page\.name === "内置场景"\) return renderBuiltInScenario\(page\)/);
  assert.match(appSource, /function renderBuiltInScenario\(page\)/);
  const builtInScenarioSource = appSource.slice(
    appSource.indexOf("function renderBuiltInScenario"),
    appSource.indexOf("function renderCombatUnitModeling")
  );
  assert.match(builtInScenarioSource, /field\("机场", "airports\.0"\)/);
  assert.match(builtInScenarioSource, /distanceToMissionKm/);
  assert.doesNotMatch(builtInScenarioSource, /missionAreas|任务区|distanceFromDepartureKm|patrolRadiusKm/);
  assert.match(catalogSource, /return \["scenarioId", "airports", "supportNodes"\]/);
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
  assert.match(combatUnitSource, /<th rowspan="2">所属机场<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-heading">寿命初始状态<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">已用日历天数<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">累计飞行小时<\/th>/);
  assert.match(combatUnitSource, /class="combat-unit-prelife-column">累计起落次数<\/th>/);
  assert.match(appSource, /飞机编号/);
  assert.match(combatUnitSource, /combatUnitMemberInput\(index, "aircraftNo", member\.aircraftNo\)/);
  assert.match(combatUnitSource, /combatUnitMemberInput\(index, "airport", combatUnitMemberAirport\(member\)\)/);
  assert.match(combatUnitSource, /function combatUnitMemberAirport\(member\)/);
  assert.doesNotMatch(combatUnitSource, /airport: scenario\.airports/);
  assert.match(combatUnitSource, /combatUnitMemberModelSelect\(index, member\.model\)/);
  assert.match(combatUnitSource, /function combatUnitMemberModelSelect\(index, value\)/);
  assert.match(combatUnitSource, /const aircraftModels = wholeMachineModels\(\)/);
  assert.match(combatUnitSource, /<select data-combat-unit-index="\$\{index\}" data-combat-unit-field="model"/);
  assert.doesNotMatch(combatUnitSource, /combatUnitMemberInput\(index, "model", member\.model\)/);
  assert.match(combatUnitSource, /data-combat-unit-field/);
  assert.match(combatUnitSource, /combatUnitMemberCalendarTime\(member\)/);
  assert.match(combatUnitSource, /combatUnitMemberFlightHours\(member\)/);
  assert.match(combatUnitSource, /combatUnitMemberTakeoffLandingCount\(member\)/);
  assert.match(combatUnitSource, /step: "any"/);
  assert.match(combatUnitSource, /function updateCombatUnitMemberField\(index, fieldName, value, input = null\)/);
  assert.match(combatUnitSource, /Number\.isFinite\(numericValue\)/);
  assert.match(combatUnitSource, /Number\.isInteger\(numericValue\)/);
  assert.match(combatUnitSource, /return false/);
  assert.doesNotMatch(combatUnitSource, /member\.preLifeRequirementHours\s*=/);
  assert.doesNotMatch(combatUnitSource, /member\.remainingLifeHours\s*=/);
  assert.doesNotMatch(combatUnitSource, /member\.takeoffLandingCount\s*=/);
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
  assert.match(appSource, /const equipmentType = selectedBasicMissionEquipmentType \|\| sourceTask\.equipmentType \|\| scenarioEquipmentModel\(\)/);
  assert.match(appSource, /function deleteSelectedBasicMission\(\)/);
  assert.match(appSource, /let selectedBasicMissionKey = "primary"/);
  assert.match(stylesSource, /\.tree-node-label\.selected/);
  assert.match(appSource, /基本任务信息编辑/);
  assert.match(appSource, /任务编号/);
  assert.match(basicMissionSource, /class="basic-mission-equipment-name"[^>]*readonly[^>]*aria-readonly="true"/);
  assert.match(stylesSource, /\.basic-mission-equipment-name\s*\{\s*background:\s*#f1f3f5;/);
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

  assert.match(combatUnitSource, /寿命初始状态/);
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

  assert.doesNotMatch(periodicSource, /总任务名称/);
  assert.match(periodicSource, /周剖面内容/);
  assert.match(periodicSource, /月剖面配置/);
  assert.match(periodicSource, /前 4 周为固定坑位/);
  assert.match(periodicSource, /data-periodic-month-slot/);
  assert.doesNotMatch(periodicSource, /重复周数/);
  assert.match(periodicSource, /年剖面组合/);
  assert.match(periodicSource, /复制为下一年/);
  assert.doesNotMatch(periodicSource, /<th>选择\/删除<\/th>/);
  assert.doesNotMatch(periodicSource, /data-periodic-delete="\$\{htmlEscape\(task\.id\)\}"/);
  assert.doesNotMatch(periodicSource, /data-periodic-select="\$\{htmlEscape\(task\.id\)\}">选择<\/button>/);
  assert.doesNotMatch(periodicSource, /任务周期天数/);
  assert.doesNotMatch(periodicSource, /每周天数/);
  assert.doesNotMatch(periodicSource, /周期性任务名称/);
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
  assert.match(compositeSource, /findBasicMissionForTaskItem/);
  assert.match(compositeSource, /compositeTaskInheritedBasicFields/);
  assert.match(compositeSource, /readOnlyTableValue/);
  assert.match(compositeSource, /典型组合任务时序表/);
  assert.match(compositeSource, /典型组合任务时序图/);
  assert.match(compositeSource, /renderCompositeTimelineChart/);
  assert.ok(
    compositeSource.includes("<thead><tr><th>基本任务名称</th><th>编队名称</th><th>出发时间（HH：MM）</th><th>单日重复次数</th><th>间隔小时数</th><th>装备类型</th><th>任务时长</th><th>要求装备数量</th><th>最小装备数量（继承）</th><th>删除</th></tr></thead>"),
    "composite task item table must follow the requested basic-task field order"
  );
  assert.match(compositeSource, /任务优先级（1最高）/);
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
  assert.match(periodicSource, /profileLabels = \{ week: "周", month: "月", year: "年" \}/);
  assert.match(periodicSource, /aria-label="\$\{activeLabel\}剖面列表"/);
  assert.match(periodicSource, /月剖面配置/);
  assert.match(periodicSource, /data-periodic-month-slot/);
  assert.match(periodicSource, /添加第 5 周/);
  assert.doesNotMatch(periodicSource, /重复周数/);
  assert.match(periodicSource, /年剖面组合/);
  assert.match(periodicSource, /class="periodic-profile-name"/);
  assert.match(periodicSource, /data-periodic-profile-name/);
  assert.match(periodicSource, /data-periodic-profile-rename-start/);
  assert.match(periodicSource, /data-periodic-profile-rename-save/);
  assert.match(periodicSource, /data-periodic-profile-rename-cancel/);
  assert.match(appSource, /if \(event\.target\.closest\("\[data-periodic-profile-name\]"\)\) return;/);
  assert.match(periodicSource, /data-periodic-composition-field/);
  assert.match(periodicSource, /复制为下一年/);
  assert.doesNotMatch(periodicSource, /总任务名称/);
  assert.doesNotMatch(periodicSource, /任务周期天数/);
  assert.doesNotMatch(periodicSource, /max="30"/);
  assert.doesNotMatch(periodicSource, /重复轮次/);
  assert.doesNotMatch(periodicSource, /每周天数/);
  assert.doesNotMatch(periodicSource, /周期性任务名称/);
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
  assert.match(equipmentSource, /normalizeEquipmentComponentKOutOfN\(component\)/);
  assert.match(equipmentSource, /equipmentKOutOfNQuantity\(component\.quantity\)/);
  assert.doesNotMatch(equipmentSource, /quantity > 1 \? "" : "disabled"/);
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
  assert.match(compositeItemSource, /findBasicMissionForTaskItem/);
  assert.match(compositeItemSource, /const inherited = compositeTaskInheritedBasicFields\(item, basicTask\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.equipmentType\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.taskDurationMinutes\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.equipmentQuantity\)/);
  assert.match(compositeItemSource, /readOnlyTableValue\(inherited\.minRequiredSorties\)/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.equipmentType/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.taskDurationMinutes/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.equipmentQuantity/);
  assert.doesNotMatch(compositeItemSource, /requiredEquipmentQuantity/);
  assert.doesNotMatch(compositeItemSource, /minRequiredSystems/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.groupName/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.firstWaveTime/);
  assert.match(compositeItemSource, /\$\{compositePath\}\.priority/);
  assert.doesNotMatch(compositeItemSource, /taskItems\.\$\{index\}\.priority/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.dailyRepeatCount/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.dailyRepeatCount`, "number", \{ min: "1", step: "1" \}/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.intervalHours/);
  assert.match(compositeItemSource, /taskItems\.\$\{index\}\.intervalHours`, "number", \{ min: "0.1", step: "0.1" \}/);
  assert.doesNotMatch(compositeItemSource, /valueInput\(`\$\{compositePath\}\.taskItems\.\$\{index\}\.minRequiredSystems`, "number"/);
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
  assert.match(basicActivitySource, /data-basic-activity-download-template/);
  assert.match(basicActivitySource, /data-basic-activity-import-file/);
  assert.match(basicActivitySource, /accept="\.csv,text\/csv"/);
  assert.match(basicActivitySource, /data-basic-activity-import-status/);
  assert.doesNotMatch(basicActivitySource, /data-basic-activity-import-type=/);
  assert.doesNotMatch(basicActivitySource, /按活动类型导入/);
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
  assert.match(logisticsSource, /const basePath = `transportPolicies\.\$\{index\}`/);
  assert.doesNotMatch(logisticsSource, /supportActivities\.\$\{activityIndex\}\.transportStrategies/);
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
  const experimentPlanEditorSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanEditor"),
    appSource.indexOf("function renderScenarioOverrideRow")
  );
  assert.match(experimentPlanEditorSource, /基本信息/);
  assert.match(experimentPlanEditorSource, /运行配置/);
  assert.doesNotMatch(experimentPlanEditorSource, /分析配置/);
  assert.match(experimentPlanEditorSource, /停止分钟（min）/);
  assert.match(experimentPlanEditorSource, /data-plan-list-link>返回</);
  assert.match(experimentPlanEditorSource, /data-save-plan[^>]*>保存</);
  assert.doesNotMatch(experimentPlanEditorSource, /scenario-composition-workspace/);
  assert.match(appSource, /data-scenario-modeling-path/);
  assert.match(appSource, /data-scenario-selected-override-value/);
  assert.doesNotMatch(experimentPlanEditorSource, /scenario-composition-editor-panel/);
  assert.match(appSource, /return "spare-planning-experiment-plan-management"/);
});

test("equipment import and export actions stay inside the equipment tree panel", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const equipmentSource = appSource.slice(
    appSource.indexOf("function renderEquipmentModeling"),
    appSource.indexOf("function buildEquipmentTreeNodes")
  );
  const treePanelSource = equipmentSource.slice(
    equipmentSource.indexOf('<aside class="tree-container">'),
    equipmentSource.indexOf('<section class="detail-panel equipment-system-table-panel">')
  );
  const detailPanelSource = equipmentSource.slice(
    equipmentSource.indexOf('<section class="detail-panel equipment-system-table-panel">')
  );

  assert.match(styleSource, /\.equipment-tree-data-panel/);
  assert.match(treePanelSource, /aria-labelledby="equipment-tree-data-title"/);
  assert.match(treePanelSource, /role="group" aria-label="装备结构数据导入与导出"/);
  assert.match(treePanelSource, /data-equipment-download-template/);
  assert.match(treePanelSource, /data-equipment-export-data/);
  assert.match(treePanelSource, /data-equipment-import-file/);
  assert.ok(treePanelSource.indexOf("装备结构树") < treePanelSource.indexOf("装备结构数据"));
  assert.ok(treePanelSource.indexOf("装备结构数据") < treePanelSource.indexOf("搜索名称"));
  assert.doesNotMatch(detailPanelSource, /data-equipment-download-template|data-equipment-export-data|data-equipment-import-file/);

  const equipmentActionClickSource = appSource.slice(
    appSource.indexOf('const equipmentTemplateButton = event.target.closest("[data-equipment-download-template]")'),
    appSource.indexOf('const supportJobsTemplateButton = event.target.closest("[data-support-jobs-download-template]")')
  );
  assert.match(equipmentActionClickSource, /downloadEquipmentStructureTemplate\(\)/);
  assert.match(equipmentActionClickSource, /downloadEquipmentStructureData\(\)/);
  const equipmentImportChangeSource = appSource.slice(
    appSource.indexOf('const equipmentImportFile = event.target.closest("[data-equipment-import-file]")'),
    appSource.indexOf('const supportJobsImportFile = event.target.closest("[data-support-jobs-import-file]")')
  );
  assert.match(equipmentImportChangeSource, /importEquipmentStructureTableFile\(equipmentImportFile\.files\?\.\[0\]\)/);
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
  assert.match(basicActivitySource, /data-basic-activity-import-file/);
  assert.match(basicActivitySource, /data-basic-activity-download-template/);
  assert.match(basicActivitySource, /data-basic-activity-field/);
  assert.match(basicActivitySource, /data-basic-activity-resource-dialog-open/);
  assert.match(basicActivitySource, /data-basic-activity-resource-dialog-field/);
  assert.match(basicActivitySource, /updateBasicActivityResourceDialogField/);
  assert.match(basicActivitySource, /syncBasicActivityResourceSummaries/);
  assert.match(basicActivitySource, /basicActivityCatalogRows/);
  assert.match(basicActivitySource, /basicActivityPersonnelCatalogRows/);
  assert.match(basicActivitySource, /basicActivityEquipmentCatalogRows/);
  assert.match(basicActivitySource, /basicActivitySpareCatalogRows/);
  assert.match(basicActivitySource, /data-basic-activity-dialog-close/);
  assert.match(basicActivitySource, /basicActivityScopeSelect/);
  assert.match(basicActivitySource, /basicActivityResourceDialogResourceSelect/);
  assert.doesNotMatch(basicActivitySource, /basicActivityPersonnelProfessionalOptions/);
  assert.doesNotMatch(basicActivitySource, /basicActivityResourceDialogTextInput/);
  assert.doesNotMatch(basicActivitySource, /弹药|ammunition/);

  const jobTableSource = appSource.slice(
    appSource.indexOf("function renderSupportActivityJobTable"),
    appSource.indexOf("function renderBasicActivityLibrary")
  );
  const stylesSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(jobTableSource, /data-support-activity-job-add="\$\{htmlEscape\(tabKey\)\}"/);
  assert.match(jobTableSource, /data-support-activity-job-batch-delete="\$\{htmlEscape\(tabKey\)\}"/);
  assert.match(jobTableSource, /class="rms-file-button rms-import-button" data-support-jobs-download-template>下载模板/);
  assert.match(jobTableSource, /<label class="rms-file-button rms-import-button">上传数据<input type="file" data-support-jobs-import-file=/);
  assert.match(stylesSource, /\.rms-file-button:hover,\s*\.rms-file-button:focus-visible,\s*\.rms-file-button:focus-within/);
  assert.match(jobTableSource, /data-support-activity-job-template/);
  assert.match(jobTableSource, /basicActivityLibraryOptions/);
  assert.match(appSource, /function applyBasicActivityToSupportActivityJob/);
  assert.doesNotMatch(jobTableSource, /data-support-activity-predecessor-add-template/);
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
  const operationsActivityEntriesSource = appSource.slice(
    appSource.indexOf("function operationsSupportActivityEntries"),
    appSource.indexOf("function operationsSupportActivityOptions")
  );
  assert.match(operationsActivityEntriesSource, /const activityName = String\(activity\.activityName \|\| ""\)\.trim\(\)/);
  assert.match(operationsActivityEntriesSource, /value: activityName/);
  assert.match(operationsActivityEntriesSource, /\.filter\(\(\{ activity \}\) => isOperationsSupportActivity\(activity\)\)/);
  assert.doesNotMatch(operationsActivityEntriesSource, /activity\.planType === "直接准备方案"/);
  assert.doesNotMatch(operationsActivityEntriesSource, /value: activity\.activityName \|\| activity\.name \|\| activity\.id/);
  assert.match(appSource, /function projectDraftSaveFailureText\(err\)/);
  assert.match(appSource, /自动保存未成功：\$\{failureText\}/);

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
  const createOperationsActivitySource = appSource.slice(
    appSource.indexOf("function createOperationsSupportActivityForAircraftModel"),
    appSource.indexOf("function nextOperationsSupportActivityId")
  );
  assert.match(createOperationsActivitySource, /setSupportActivityJobs\(activity, \[\]\)/);
  assert.doesNotMatch(createOperationsActivitySource, /基本保障活动1/);
  assert.doesNotMatch(createOperationsActivitySource, /nextSupportActivityJobCode/);
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
  assert.doesNotMatch(operationsSource, /<input(?![^>]*(data-path|data-maintenance|readonly|disabled))/);

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
  assert.doesNotMatch(preventiveSource, /<input(?![^>]*(data-path|data-maintenance|readonly|disabled))/);

  const correctiveSource = appSource.slice(
    appSource.indexOf("function renderCorrectiveMaintenanceActivity"),
    appSource.indexOf("function renderLogisticsSupportActivity")
  );
  const readonlyEquipmentConfigSource = appSource.slice(
    appSource.indexOf("function buildReadonlyEquipmentConfigComponentTreeNodes"),
    appSource.indexOf("function correctiveReferenceComponent")
  );
  assert.doesNotMatch(correctiveSource, /<input(?![^>]*(data-path|data-maintenance|readonly|disabled))/);
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
  assert.match(appSource, /function renderMaintenanceMethodControls/);
  assert.match(appSource, /preventive \? "检查\/保养" : "原位维修"/);
  assert.match(appSource, /methodOption\("replacement", "换件维修"\)/);
  assert.match(appSource, /data-maintenance-replacement-ratio="\$\{activityIndex\}"/);
  assert.match(appSource, /<span>维修比例<\/span>/);
  assert.match(appSource, /const ratioInputs = bothSelected/);
  assert.match(appSource, /min="0" max="100" step="0\.01" required/);
  assert.match(preventiveSource, /renderMaintenanceMethodControls\(activity, activityIndex\)/);
  assert.match(correctiveSource, /renderMaintenanceMethodControls\(componentActivity, activityIndex\)/);
  assert.doesNotMatch(correctiveSource, /\.repairType/);
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

test("basic support activity scope edits write the selected top-level job", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const updateSource = appSource.slice(
    appSource.indexOf("function updateBasicActivityJobField"),
    appSource.indexOf("function updateBasicActivityResourceField")
  );
  const ensureSource = appSource.slice(
    appSource.indexOf("function ensureCorrectiveMaintenanceActivityForComponent"),
    appSource.indexOf("function nextCorrectiveMaintenanceActivityId")
  );

  assert.match(updateSource, /applicableAircraft: basicActivityApplicableAircraftFromScope\(value\)/);
  assert.match(updateSource, /setSupportActivityJobs\(activity, jobs\)/);
  assert.doesNotMatch(updateSource, /moveBasicActivityJobToScope/);
  assert.doesNotMatch(appSource, /function basicActivityScopeHostActivity/);
  assert.doesNotMatch(appSource, /function ensureBasicActivityOperationsScopeHostActivity/);
  assert.doesNotMatch(appSource, /function ensureBasicActivityPreventiveScopeHostActivity/);
  assert.match(ensureSource, /copyTemplateJobs = true/);
  assert.match(ensureSource, /setSupportActivityJobs\(activity, copyTemplateJobs \? supportActivityJobs\(template\)\.map/);
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

test("monte carlo settings submit lightweight Mesa analysis instead of formal run", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const renderSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function syncLiteMesaSettingsFromMonteCarloExperiment")
  );
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario, \{ samples: 4 \}\)/);
  assert.match(appSource, /let \{ previewSingleResult: singleResult, previewMonteCarloResult: monteCarloResult \} = buildPreviewResultState\(scenario\)/);
  assert.doesNotMatch(renderSource, /data-lite-mesa-field="samples"|data-lite-mesa-field="seed"/);
  const runSource = appSource.slice(
    appSource.indexOf("async function runLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function normalizeLiteMesaMonteCarloResult")
  );
  assert.match(runSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*"mission_reliability"/);
  assert.doesNotMatch(runSource, /startMonteCarloRunThroughApi/);
  assert.match(appSource, /function normalizeLiteMesaMonteCarloResult/);
  assert.match(appSource, /function updatePreviewResultsThroughApiClient/);
  assert.match(appSource, /data-save-plan/);
});

test("direct Monte Carlo Mesa page hides sweep inputs and keeps formal runs explicit", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const mesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function updateLiteMesaMonteCarloSetting")
  );

  assert.doesNotMatch(mesaSource, /故障率扫描/);
  assert.doesNotMatch(mesaSource, /备件倍数/);
  assert.doesNotMatch(mesaSource, /保障容量/);
  assert.doesNotMatch(mesaSource, /data-mc-array-path/);
  assert.doesNotMatch(mesaSource, /monteCarlo\.failureRates\.join/);
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentEditor/);
  assert.match(appSource, /const savePlanButton = event\.target\.closest\("\[data-save-plan\]"\)/);
});

test("monte carlo experiment detail labels backend Mesa execution without formal run copy", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const renderSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function liteMesaBusinessMetricRows")
  );

  assert.match(renderSource, /蒙特卡洛分析/);
  assert.match(renderSource, /运行分析/);
  assert.match(renderSource, /尚未运行分析/);
  assert.match(renderSource, /正在运行 Mesa 分析/);
  assert.doesNotMatch(renderSource, /正式 Monte Carlo run/);
  assert.doesNotMatch(renderSource, /正在提交正式 Monte Carlo run/);
  assert.doesNotMatch(renderSource, /后端 Mesa 仿真分析/);
  assert.doesNotMatch(renderSource, /class="status-badge success"/);
  assert.doesNotMatch(renderSource, /前端建模 \+ Mesa 分析/);
  assert.doesNotMatch(renderSource, /Mesa蒙特卡洛分析/);
  assert.doesNotMatch(renderSource, /尚未运行 Mesa 分析/);
  assert.match(renderSource, /等待运行 Mesa 分析/);
  assert.match(renderSource, /Mesa 分析完成|Mesa 分析失败/);
});

test("modeling import publish falls back to a new version when the current snapshot is referenced", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const flowSource = await readFile(new URL("../front/modeling-import-project-flow.mjs", import.meta.url), "utf8");
  const publishSource = appSource.slice(
    appSource.indexOf('if (action === "publish")'),
    appSource.indexOf('if (action === "compile-scenario")')
  );

  assert.match(appSource, /publishModelingImportWithReferencedVersionFallback/);
  assert.match(publishSource, /publishModelingImportWithReferencedVersionFallback\(\{\s*backendApi,\s*importPackage: modelingImportPackage\s*\}\)/s);
  assert.match(publishSource, /persistLastPublishedModelingImportId\(modelingImportPackage\.importId\)/);
  assert.match(publishSource, /原发布快照已被运行引用，已发布新版本/);
  assert.match(flowSource, /export async function publishModelingImportWithReferencedVersionFallback/);
  assert.match(flowSource, /err\?\.code === "published_import_referenced"/);
  assert.match(flowSource, /createReferencedModelingImportVersion\(importPackage, versionSuffix\)/);
});

test("monte carlo experiment navigation goes directly to embedded Mesa detail", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const liteMesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function updateLiteMesaMonteCarloSetting")
  );
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentList/);
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentEditor/);
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentDetail/);
  assert.doesNotMatch(appSource, /蒙特卡洛实验列表/);
  assert.doesNotMatch(appSource, /保存全部实验运行历史/);
  assert.doesNotMatch(appSource, /添加\/编辑蒙特卡洛实验/);
  assert.doesNotMatch(appSource, /data-mc-experiment-action="add"/);
  assert.doesNotMatch(appSource, /data-mc-experiment-action="edit"/);
  assert.doesNotMatch(appSource, /data-mc-experiment-action="list"/);
  assert.match(appSource, /function normalizeSelectedFeatureHash/);
  assert.match(appSource, /const normalizedHash = workbenchHash\(featureId, projectId\)/);
  assert.match(appSource, /parts\.push\(`project=\$\{encodeURIComponent\(normalizedProjectId\)\}`\)/);
  assert.match(appSource, /window\.history\.replaceState\(null, "", `\$\{location\.pathname\}\$\{location\.search\}#\$\{normalizedHash\}`\)/);
  assert.match(appSource, /location\.hash = normalizedHash/);
  assert.match(liteMesaSource, /蒙特卡洛分析/);
  assert.doesNotMatch(liteMesaSource, /正式 Monte Carlo run/);
  assert.doesNotMatch(liteMesaSource, /后端 Mesa 仿真分析/);
  assert.doesNotMatch(liteMesaSource, /lite-mesa-hero-meter/);
  assert.doesNotMatch(liteMesaSource, /lite-mesa-source-grid/);
  assert.doesNotMatch(liteMesaSource, /Mesa蒙特卡洛分析|尚未运行 Mesa 分析/);
  assert.match(liteMesaSource, /主要输出指标统计值/);
  assert.doesNotMatch(appSource, /class="mc-main-tabs"/);
  assert.doesNotMatch(appSource, /class="mc-subtabs"/);
  assert.doesNotMatch(appSource, /正交实验配置与分析/);
  assert.doesNotMatch(appSource, /正交因素/);
  assert.doesNotMatch(appSource, /预检查/);
  assert.match(styleSource, /\.lite-mesa-workbench/);
  assert.match(styleSource, /\.lite-mesa-settings/);
});

test("monte carlo detail embeds the Mesa Monte Carlo page", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const momentSource = await readFile(new URL("../front/monte-carlo-moments.mjs", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const page = getFeaturePageById("spare-planning-monte-carlo-experiment-detail");
  const missionPage = getFeaturePageById("mission-reliability-monte-carlo-experiment-detail");
  const grouped = groupFeaturePages(FEATURE_PAGES);
  const renderSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function renderAnalysis")
  );
  const changeSource = appSource.slice(
    appSource.indexOf("app.addEventListener(\"change\""),
    appSource.indexOf("app.addEventListener(\"focusout\"")
  );

  assert.equal(FEATURE_PAGES.length, 46);
  assert.equal(page.name, "实验详情");
  assert.equal(page.secondary, "仿真实验");
  assert.equal(page.tertiary, "蒙特卡洛实验");
  assert.equal(page.component, "lite-mesa-monte-carlo-analysis");
  assert.equal(missionPage.component, "lite-mesa-monte-carlo-analysis");
  assert.equal(getFeaturePageById("spare-planning-mesa-monte-carlo-analysis").id, "system-management-project-data-management");
  assert.equal(getFeaturePageById("mission-reliability-mesa-monte-carlo-analysis").id, "system-management-project-data-management");
  assert.equal("Mesa分析" in grouped["备件规划评估模块"]["仿真实验"], false);
  assert.equal("Mesa分析" in grouped["任务可靠度评估模块"]["仿真实验"], false);
  assert.match(appSource, /runMonteCarlo/);
  assert.match(appSource, /function runLiteMesaMonteCarloAnalysis/);
  assert.match(appSource, /data-current-experiment-plan/);
  assert.match(renderSource, /selectedExperimentPlanName\(\)/);
  assert.doesNotMatch(renderSource, /后端 Mesa 仿真分析/);
  assert.doesNotMatch(renderSource, /class="status-badge success"/);
  assert.doesNotMatch(renderSource, /lite-mesa-hero-meter/);
  assert.doesNotMatch(renderSource, /lite-mesa-source-grid/);
  assert.match(appSource, /let liteMesaMonteCarloSettings =/);
  assert.match(appSource, /let liteMesaMonteCarloResult =/);
  assert.doesNotMatch(renderSource, /前端建模 \+ 仿真分析/);
  assert.match(renderSource, /正在运行 Mesa 分析/);
  assert.doesNotMatch(renderSource, /data-lite-mesa-field="samples"|data-lite-mesa-field="seed"/);
  assert.match(renderSource, /主要输出指标统计值/);
  assert.match(renderSource, /<th>业务指标<\/th><th>均值<\/th><th>样本方差（n-1）<\/th><th>单位<\/th><th>有效样本数<\/th>/);
  assert.match(renderSource, /总样本|成功样本|失败样本/);
  assert.doesNotMatch(renderSource, /样本量|随机种子|最小值|最大值|标准差|参数组/);
  assert.match(momentSource, /metricId: "mission_success_rate", label: "任务可靠度"/);
  assert.match(momentSource, /metricId: "spare_fill_rate", label: "备件满足率"/);
  assert.match(momentSource, /metricId: "spare_utilization", label: "备件利用率"/);
  assert.match(momentSource, /metricId: "ready_rate"/);
  assert.match(momentSource, /metricId: "mean_transport_delay", label: "平均备件延误时间"/);
  assert.doesNotMatch(momentSource, /shortage_events|短缺事件|sample_id|debug/);
  assert.match(changeSource, /const liteMesaMonteCarloInput = event\.target\.closest\("\[data-lite-mesa-field\]"\)/);
  assert.doesNotMatch(renderSource, /非正式|预览|本地预览|正式后端结果/);
  const runSource = appSource.slice(
    appSource.indexOf("async function runLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function liteMesaBusinessMetricRows")
  );
  assert.match(runSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*"mission_reliability"/);
  assert.doesNotMatch(runSource, /startMonteCarloRunThroughApi/);
  assert.doesNotMatch(runSource, /monteCarloExperimentId: selectedMonteCarloExperimentId/);
  assert.doesNotMatch(runSource, /runMonteCarlo\(projectJson/);
  assert.match(styleSource, /\.lite-mesa-workbench/);
  assert.match(styleSource, /\.lite-mesa-settings/);
  assert.match(styleSource, /\.lite-mesa-stat-table/);
});

test("browser smoke enters monte carlo embedded Mesa detail", async () => {
  const smokeSource = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");
  const smokeStart = smokeSource.indexOf('await clickFeature(page, "spare-planning-monte-carlo-experiment-detail")');
  const smokeEnd = smokeSource.indexOf('await page.screenshot({ path: `${screenshotDir}/01-lite-mesa-detail.png`, fullPage: true })');
  const smokeMonteCarloSource = smokeSource.slice(
    smokeStart,
    smokeEnd
  );

  assert.notEqual(smokeStart, -1, "smoke Monte Carlo flow start marker exists");
  assert.doesNotMatch(smokeSource, /spare-planning-monte-carlo-experiment-list/);
  assert.doesNotMatch(smokeSource, /openMonteCarloExperimentForRun/);
  assert.doesNotMatch(smokeSource, /data-mc-experiment-action/);
  assert.doesNotMatch(smokeMonteCarloSource, /spare-planning-monte-carlo-config/);
  assert.notEqual(smokeEnd, -1, "smoke Monte Carlo flow end marker exists");
  assert.ok(smokeEnd > smokeStart, "smoke Monte Carlo smoke opens embedded Mesa detail directly");
  assert.doesNotMatch(smokeMonteCarloSource, /data-mc-array-path="monteCarlo\.failureRates"/);
});

test("result analysis pages route visible runs through Lite Mesa instead of current-result formal runs", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const renderMainSource = appSource.slice(
    appSource.indexOf("function renderMainComponent"),
    appSource.indexOf("function createExperimentPlanBranchFromCurrentProject")
  );
  const liteMesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function normalizeLiteMesaAnalysisResult")
  );
  const analysisActionSource = appSource.slice(
    appSource.indexOf('const analysisActionButton = event.target.closest("[data-analysis-action]"'),
    appSource.indexOf('const downtimeSnapshotExportButton = event.target.closest("[data-downtime-snapshot-export]"')
  );
  const pages = [
    "spare-planning-spare-shortfall-analysis",
    "spare-planning-carry-list-analysis",
    "mission-reliability-task-reliability",
    "mission-reliability-downtime-factor-analysis"
  ].map((featureId) => getFeaturePageById(featureId));

  assert.match(appSource, /function renderCurrentAnalysisResultPanel/);
  assert.match(appSource, /function renderExperimentPlanContextDropdown/);
  assert.match(appSource, /function selectedExperimentPlanProjectJson/);
  assert.match(renderMainSource, /page\.component === "lite-mesa-analysis"/);
  assert.match(renderMainSource, /renderLiteMesaAnalysisPage\(page\)/);
  assert.match(renderMainSource, /page\.component === "analysis"/);
  assert.match(renderMainSource, /if \(page\.component === "analysis"\) return renderLiteMesaAnalysisPage\(page\)/);
  for (const page of pages) {
    assert.equal(page.component, "lite-mesa-analysis", page.id);
    assert.notEqual(page.component, "analysis", page.id);
  }
  assert.match(liteMesaSource, /data-lite-mesa-analysis-action="run"/);
  assert.match(liteMesaSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*definition\.analysisType/);
  assert.match(analysisActionSource, /runLiteMesaAnalysisPage\(page\)/);
  assert.match(appSource, /const analysisType = analysisTypeForPage\(page\)/);
  assert.doesNotMatch(liteMesaSource, /分析任务列表|创建\/编辑\/删除|选择方案 \+ 参数/);
  assert.doesNotMatch(liteMesaSource, /linkedMonteCarloExperimentId|mc_experiment_id|artifact_manifest_id/);
  assert.doesNotMatch(analysisActionSource, /runCurrentAnalysisPage|startMonteCarloRunThroughApi|submitRunIntent/);
  assert.doesNotMatch(appSource, /data-analysis-task-field/);
  assert.doesNotMatch(appSource, /data-analysis-action="create-with-mc"|data-analysis-action="edit"|data-analysis-action="save"|data-analysis-action="delete"/);
  assert.doesNotMatch(appSource, /source: "analysis:auto-created"/);
});

test("independent Mesa result analysis pages consume only session settings and session results", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const mesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function field(label")
  );

  assert.match(appSource, /let liteMesaAnalysisSettings = createDefaultLiteMesaAnalysisSettings\(\)/);
  assert.match(appSource, /let liteMesaAnalysisResults = \{\}/);
  assert.match(appSource, /data-current-experiment-plan/);
  assert.match(mesaSource, /async function runLiteMesaAnalysisPage/);
  assert.match(mesaSource, /backendApi\.runLiteMesaAnalysis/);
  assert.match(mesaSource, /resolveSelectedExperimentPlanProjectJsonForRun\(\)/);
  assert.match(mesaSource, /payload\.status === "session_complete"/);
  for (const hiddenSetting of ["项目", "当前项目", "分析对象", "结果内容"]) {
    assert.doesNotMatch(mesaSource, new RegExp(`\\["${hiddenSetting}"`));
  }
  assert.doesNotMatch(mesaSource, /async function runFormalAnalysisPage/);
  assert.doesNotMatch(mesaSource, /await runCurrentAnalysisPage\(page\)/);
  assert.doesNotMatch(mesaSource, /创建正式 run、result 与 artifact/);
  assert.doesNotMatch(mesaSource, /runMonteCarlo\(projectJson/);
  assert.doesNotMatch(mesaSource, /buildLiteMesaAnalysisSessionResult/);
  for (const analysisType of ["spare_shortfall", "carry_list", "mission_reliability", "downtime_factors"]) {
    assert.match(appSource, new RegExp(`${analysisType}:\\s*\\{[\\s\\S]*experimentId`));
  }
  assert.doesNotMatch(mesaSource, /currentAnalysisResultForPage|renderCurrentAnalysisResultPanel|formalProjectionFromCurrentResult/);
  assert.doesNotMatch(mesaSource, /backendApi\.getCurrentAnalysisResult|startMonteCarloRunThroughApi|submitRunIntent/);
  assert.doesNotMatch(mesaSource, /analysisTasks|monteCarloExperiments|selectedMonteCarloExperimentId/);
  assert.doesNotMatch(mesaSource, /artifact_manifest_id|mc_experiment_id|historical|history/);
  assert.doesNotMatch(mesaSource, /status: "completed"/);
});

test("downtime formal analysis relies on model log event snapshot contract", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const apiSource = await readFile(new URL("../src/spare_mvp_backend/api.py", import.meta.url), "utf8");
  const adapterSource = await readFile(new URL("../src/spare_mvp_contract/adapter.py", import.meta.url), "utf8");
  const modelSource = await readFile(new URL("../src/spare_mvp_abm/aircraft_support_v1/model.py", import.meta.url), "utf8");
  const mesaSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function field(label")
  );

  assert.match(mesaSource, /eventSnapshots/);
  assert.match(mesaSource, /停机事件一览/);
  assert.match(mesaSource, /飞机状态/);
  assert.match(mesaSource, /保障资源占用/);
  assert.match(mesaSource, /备件短缺/);
  assert.match(adapterSource, /anomaly_snapshots/);
  assert.match(modelSource, /write_event_snapshots/);
  assert.match(modelSource, /event_snapshot/);
  assert.match(apiSource, /run_lite_mesa_analysis/);
  assert.match(apiSource, /write_event_snapshots/);
});

test("formal projection renderers remain isolated from independent Mesa routing", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const mcResultSource = appSource.slice(
    appSource.indexOf("function renderMonteCarloResults"),
    appSource.indexOf("function monteCarloFormalResultBoundary")
  );
  const locationSource = appSource.slice(
    appSource.indexOf("function renderMonteCarloAnalysisResultLocations"),
    appSource.indexOf("function renderMonteCarloFormalBlockedState")
  );
  const dashboardSource = appSource.slice(
    appSource.indexOf("function renderAnalysisDashboard"),
    appSource.indexOf("function renderBar")
  );
  const formalProjectionSource = appSource.slice(
    appSource.indexOf("function renderFormalProjectionBody"),
    appSource.indexOf("function visibleDowntimeAnomalySnapshots")
  );
  const renderMainSource = appSource.slice(
    appSource.indexOf("function renderMainComponent"),
    appSource.indexOf("function createExperimentPlanBranchFromCurrentProject")
  );

  assert.match(mcResultSource, /renderMonteCarloFormalBlockedState\(boundary\)/);
  assert.match(mcResultSource, /renderMonteCarloAnalysisResultLocations\(boundary\)/);
  assert.doesNotMatch(mcResultSource, /renderMonteCarloFormalProjectionResults\(boundary\)/);
  assert.match(locationSource, /analysisPageFeatureIdForType\(view\.analysisType\)/);
  assert.doesNotMatch(appSource, /function renderMonteCarloFormalProjectionResults|mc-formal-results|mc-formal-projection/);
  assert.match(dashboardSource, /renderAnalysisProjectionResultPanel\(formalProjection\)/);
  assert.match(renderMainSource, /page\.component === "lite-mesa-analysis"/);
  assert.match(renderMainSource, /page\.component === "analysis"/);
  for (const analysisType of ["spare_shortfall", "carry_list", "mission_reliability", "downtime_factors"]) {
    assert.match(formalProjectionSource, new RegExp(`formalProjection\\.analysisType === "${analysisType}"`));
  }
});

test("formal current result hydration is kept away from lightweight Mesa result pages", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const featurePageSource = appSource.slice(
    appSource.indexOf("function renderFeaturePage"),
    appSource.indexOf("function renderProjectDraftToolbar")
  );
  const hydrateSource = appSource.slice(
    appSource.indexOf("function ensureCurrentAnalysisResultLoaded"),
    appSource.indexOf("function hiddenCurrentAnalysisExperimentId")
  );
  const panelSource = appSource.slice(
    appSource.indexOf("function renderCurrentAnalysisResultPanel"),
    appSource.indexOf("function currentAnalysisStatusLabel")
  );
  const analysisActionSource = appSource.slice(
    appSource.indexOf('const analysisActionButton = event.target.closest("[data-analysis-action]"'),
    appSource.indexOf('const downtimeSnapshotExportButton = event.target.closest("[data-downtime-snapshot-export]"')
  );

  for (const featureId of [
    "spare-planning-spare-shortfall-analysis",
    "spare-planning-carry-list-analysis",
    "mission-reliability-task-reliability",
    "mission-reliability-downtime-factor-analysis"
  ]) {
    assert.equal(getFeaturePageById(featureId).component, "lite-mesa-analysis");
  }
  assert.doesNotMatch(featurePageSource, /ensureCurrentAnalysisResultLoaded\(page\)/);
  assert.match(hydrateSource, /backendApi\.getCurrentAnalysisResult\(savedProject\.project_id,\s*analysisType\)/);
  assert.match(hydrateSource, /currentAnalysisResultLoadInFlight/);
  assert.match(hydrateSource, /ANALYSIS_PROJECTION_TYPES\.some/);
  assert.match(panelSource, /currentAnalysisSourceLabel\(result\)/);
  assert.match(panelSource, /currentAnalysisShouldShowFailure\(result\)/);
  assert.match(appSource, /function currentAnalysisSourceLabel/);
  assert.match(appSource, /if \(status === "empty"\) return "等待正式结果"/);
  assert.match(appSource, /function currentAnalysisShouldShowFailure/);
  assert.match(appSource, /return \["failed", "blocked"\]\.includes/);
  assert.match(analysisActionSource, /runLiteMesaAnalysisPage\(page\)/);
  assert.doesNotMatch(analysisActionSource, /runCurrentAnalysisPage|backendApi\.getCurrentAnalysisResult|startMonteCarloRunThroughApi/);
});

test("backend empty current analysis result is not treated as formal failure", async () => {
  const apiSource = await readFile(new URL("../src/spare_mvp_backend/api.py", import.meta.url), "utf8");
  const emptySource = apiSource.slice(
    apiSource.indexOf("def _empty_current_analysis_result"),
    apiSource.indexOf("def _compiler_provenance_for_run")
  );

  assert.match(emptySource, /if status != "empty":/);
  assert.match(emptySource, /"source": "empty" if status == "empty" else "blocked"/);
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
  assert.doesNotMatch(editorSource, /data-run-intent-single/);
  assert.doesNotMatch(editorSource, /启动单次正式运行/);
  assert.match(appSource, /function createExperimentPlanBranchFromCurrentProject/);
  assert.match(appSource, /createExperimentPlanBranchFromCurrentProject\(\)/);
  assert.match(createBranchSource, /if \(experimentPlanBranchActive\) return/);
  assert.match(experimentPlanChangeSource, /setPath\(experimentPlanDraft, experimentPlanInput\.dataset\.experimentPlanPath/);
  assert.doesNotMatch(experimentPlanChangeSource, /setPath\(scenario/);
  assert.match(saveButtonSource, /saveCurrentExperimentPlanThroughApi\(\)/);
  assert.doesNotMatch(saveButtonSource, /saveCurrentProjectThroughApi\(\)/);
});

test("experiment plan editor exposes one runtime configuration and removes Scenario controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const editorSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanEditor"),
    appSource.indexOf("function experimentPlanField")
  );
  const experimentPlanChangeSource = appSource.slice(
    appSource.indexOf('const experimentPlanInput = event.target.closest("[data-experiment-plan-path]"'),
    appSource.indexOf('const rmsInput = event.target.closest("[data-rms-path]"')
  );

  assert.match(editorSource, /data-experiment-seed-policy/);
  assert.match(editorSource, /data-experiment-seed-base/);
  assert.match(editorSource, /data-experiment-stop-mode/);
  assert.match(editorSource, /data-experiment-stop-condition/);
  assert.match(editorSource, /data-experiment-stop-time-minute/);
  assert.match(editorSource, /experiment-stop-condition-row/);
  assert.match(editorSource, /experiment-stop-condition-checkbox/);
  assert.match(editorSource, /experiment-stop-minute-field/);
  assert.match(editorSource, /data-experiment-stop-condition="specifiedTime"[\s\S]*data-experiment-stop-time-minute/);
  assert.match(editorSource, /基本信息/);
  assert.match(editorSource, /运行配置/);
  assert.doesNotMatch(editorSource, /分析配置/);
  assert.match(editorSource, /停止分钟（min）/);
  assert.match(editorSource, /MAX_MONTE_CARLO_PARALLEL_CORES/);
  assert.doesNotMatch(editorSource, /data-scenario-override-add/);
  assert.match(experimentPlanChangeSource, /experimentPlanStopPolicy/);
  assert.match(experimentPlanChangeSource, /experimentPlanDraft/);
  assert.doesNotMatch(experimentPlanChangeSource, /setPath\(scenario/);
});

test("monte carlo launch uses Lite Mesa from the selected experiment plan", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const handlerSource = appSource.slice(
    appSource.indexOf('const liteMesaMonteCarloButton = event.target.closest("[data-lite-mesa-action=\'run\']"'),
    appSource.indexOf('const liteMesaAnalysisButton = event.target.closest("[data-lite-mesa-analysis-action=\'run\']"')
  );
  const launchSource = appSource.slice(
    appSource.indexOf("async function runLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function normalizeLiteMesaMonteCarloResult")
  );

  assert.match(handlerSource, /runLiteMesaMonteCarloAnalysis\(\)/);
  assert.match(launchSource, /resolveSelectedExperimentPlanProjectJsonForRun\(\)/);
  assert.match(launchSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*"mission_reliability"/);
  assert.match(launchSource, /samples,\s*seed,\s*parallelCores/s);
  assert.doesNotMatch(handlerSource + launchSource, /startMonteCarloRunThroughApi|submitRunIntent|\/api\/runs/);
  assert.doesNotMatch(launchSource, /run_type: "single"|runType|modelFamily: FORMAL_AIRCRAFT_SUPPORT_MODEL_FAMILY/);
  assert.doesNotMatch(launchSource, /backendApi\.startSimulationRun|backendApi\.startMonteCarloRun/);
});

test("lite Mesa run context separates the current Project from persisted ExperimentPlans", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const contextSource = appSource.slice(
    appSource.indexOf("function projectJsonHasExecutableModelingData"),
    appSource.indexOf("function selectedExperimentPlanName")
  );
  const contextRenderSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanContextDropdown"),
    appSource.indexOf("function currentContextSummary")
  );

  assert.match(contextSource, /function currentProjectJsonForExperimentContext/);
  assert.match(contextSource, /projectJsonHasExecutableModelingData\(scenario\)/);
  assert.match(contextSource, /function projectDataJsonMatchesCurrentProject/);
  assert.match(contextSource, /projectJsonId === backendProjectId/);
  assert.match(contextSource, /projectDataJsonMatchesCurrentProject\(selectedProjectDataProjectJson\)/);
  assert.match(contextSource, /buildBackendProjectJson\(currentProjectJson,\s*currentProject\)/);
  assert.doesNotMatch(contextSource, /currentProjectJsonForExperimentContext\(\)[\s\S]*experimentPlanDraft/);
  assert.match(contextSource, /kind:\s*"current-project"/);
  assert.match(contextSource, /kind:\s*"experiment-plan"/);
  assert.match(contextSource, /backendExperimentPlans\.filter\(\(plan\) => String\(plan\?\.experiment_plan_id/);
  assert.match(appSource, /let selectedRunContextKey = ""/);
  assert.match(appSource, /RUN_CONTEXT_STORAGE_KEY/);
  assert.match(appSource, /function readStoredRunContextKey/);
  assert.match(appSource, /function persistSelectedRunContextKey/);
  assert.match(contextSource, /validKeys\.has\(selectedRunContextKey\)/);
  assert.doesNotMatch(contextSource, /for \(const key of selectedExperimentPlanKeys\)/);
  assert.doesNotMatch(contextSource, /currentPlanKey/);
  assert.match(contextSource, /options\.find\(\(option\) => option\.kind === "current-project"\)/);
  assert.doesNotMatch(contextSource, /backendOptions\.length === 1/);
  assert.match(contextRenderSource, /运行上下文/);
  assert.match(contextRenderSource, /已保存实验方案/);
  assert.doesNotMatch(contextRenderSource, /当前草稿/);
  const runContextSelectionSource = appSource.slice(
    appSource.indexOf("function selectCurrentExperimentPlan"),
    appSource.indexOf("function toggleExperimentPlanSelection")
  );
  assert.match(runContextSelectionSource, /replaceSelectedRunContextKey\(selected\.key, \{ persist: true \}\)/);
  assert.match(appSource, /function replaceSelectedRunContextKey/);
  assert.match(appSource, /solaraVisualizationProjectIdOverrideContextKey = ""/);
  assert.doesNotMatch(runContextSelectionSource, /selectedExperimentPlanKeys|experimentPlan =/);
});

test("formal Monte Carlo helpers keep bound run ledger status outside embedded detail", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const boundarySource = appSource.slice(
    appSource.indexOf("function monteCarloFormalResultBoundary"),
    appSource.indexOf("function monteCarloFormalStatusLabel")
  );

  assert.match(appSource, /function monteCarloBoundRun/);
  assert.match(appSource, /function monteCarloBoundArtifactManifest/);
  assert.match(appSource, /function monteCarloDisplayStatus/);
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentDetail/);
  assert.match(boundarySource, /const boundRun = monteCarloBoundRun\(experiment\)/);
  assert.match(boundarySource, /const runStatus = String\(boundRun\?\.status \|\| experiment\?\.status \|\| ""\)/);
  assert.match(boundarySource, /isRunComplete\(boundRun\)/);
  assert.match(launchSource, /const existingExperiment = monteCarloExperimentByBusinessId\(monteCarloExperimentId\)/);
  assert.match(launchSource, /if \(!existingExperiment\?\.runId\)/);
  assert.match(launchSource, /source: "backend:submit-error"/);
});

test("monte carlo config backfills empty draft to a single baseline value before display and launch", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const branchSource = appSource.slice(
    appSource.indexOf("function createExperimentPlanBranchFromCurrentProject"),
    appSource.indexOf("function renderCollapsibleTree")
  );
  const launchSource = appSource.slice(
    appSource.indexOf("async function startMonteCarloRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );

  assert.match(appSource, /const DEFAULT_MONTE_CARLO_SWEEP = Object\.freeze/);
  assert.match(appSource, /function ensureMonteCarloSweepDefaults\(projectJson\)/);
  assert.match(appSource, /failureRates: \[0\.06\]/);
  assert.match(appSource, /spareMultipliers: \[1\]/);
  assert.match(appSource, /supportCapacities: \[1\]/);
  assert.match(branchSource, /ensureMonteCarloSweepDefaults\(experimentPlanDraft\)/);
  assert.match(launchSource, /ensureMonteCarloSweepDefaults\(experimentPlanDraft\)/);
  assert.doesNotMatch(appSource, /function renderMonteCarloExperimentEditor/);
});

test("visible simulation embeds Solara while Monte Carlo and analysis launches use Lite Mesa", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const apiClientSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");
  const solaraSource = await readFile(new URL("../front/solara-visualization.mjs", import.meta.url), "utf8");
  const monteCarloLaunchSource = appSource.slice(
    appSource.indexOf("async function runLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function normalizeLiteMesaMonteCarloResult")
  );
  const analysisLaunchSource = appSource.slice(
    appSource.indexOf("async function runLiteMesaAnalysisPage"),
    appSource.indexOf("function normalizeLiteMesaAnalysisResult")
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
  );
  const visualSaveSource = appSource.slice(
    appSource.indexOf("async function syncSelectedProjectJsonForSolaraVisualization"),
    appSource.indexOf("function selectedExperimentPlanRunSettings")
  );

  assert.match(apiClientSource, /path: "\/mesa-analysis-runs"/);
  assert.doesNotMatch(apiClientSource, /runIndependentMesaVisualization\(projectJson/);
  assert.doesNotMatch(apiClientSource, /path: "\/mesa-visualization-runs"/);
  assert.match(monteCarloLaunchSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*"mission_reliability"/);
  assert.match(analysisLaunchSource, /backendApi\.runLiteMesaAnalysis\(projectJson,\s*definition\.analysisType/);
  assert.doesNotMatch(monteCarloLaunchSource + analysisLaunchSource, /startSingleRunThroughApi|startMonteCarloRunThroughApi|submitRunIntent|\/api\/runs/);
  assert.match(solaraSource, /DEFAULT_SOLARA_VISUALIZATION_URL = "http:\/\/127\.0\.0\.1:8765"/);
  assert.match(solaraSource, /managedSolaraVisualizationUrl\(locationRef\)/);
  assert.match(solaraSource, /`\$\{protocol\}\/{2}\$\{host\}:8765`/);
  assert.match(visualSource, /data-solara-visualization-frame/);
  assert.match(visualSource, /title="Solara 可视化推演"/);
  assert.match(visualSource, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/);
  assert.match(visualSource, /buildSolaraVisualizationUrl\(resolveSolaraVisualizationBaseUrl\(\)/);
  assert.match(visualSource, /solaraVisualizationProjectIdOverride/);
  assert.match(visualSource, /ensureSelectedVisualSimulationProjectSynced\(page\)/);
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar|reload:/);
  assert.doesNotMatch(visualSource, /data-mesa-control="start-new-run"/);
  assert.doesNotMatch(visualSource, /data-mesa-control="play"/);
  assert.doesNotMatch(visualSource, /data-mesa-timeline/);
  assert.doesNotMatch(visualSource, /backendApi\.runLiteMesaAnalysis/);
  assert.match(visualSaveSource, /resolveSelectedExperimentPlanProjectJsonForRun\(\)/);
  assert.match(visualSaveSource, /backendApi\.saveProject\(projectJson\)/);
  assert.doesNotMatch(visualSaveSource, /planRunOverrides|experiment:\s*\{/);
  assert.match(visualSource, /experimentPlanId:\s*context\.plan\.experiment_plan_id/);
  assert.match(visualSource, /planSteps:\s*planConfig\.steps/);
  assert.match(visualSource, /planSamples:\s*planConfig\.samples/);
  assert.match(visualSource, /planSeed:\s*planConfig\.seed/);
  assert.doesNotMatch(visualSource, /127\.0\.0\.1:8521|independent-mesa|mesa-visualization-runs/);
  assert.doesNotMatch(appSource, /ensureIndependentMesaVisualizationStarted\(page\)/);
  assert.match(appSource, /function renderExperimentPlanContextDropdown/);
  assert.match(appSource, /data-current-experiment-plan/);
  assert.doesNotMatch(visualSource, /Solara 可视化内嵌页/);
  assert.doesNotMatch(visualSource, /mesa-control-deck|mesa-control-status|仿真状态|推演由 Solara/);
  assert.doesNotMatch(visualSource, /当前 Project 回放/);
  assert.doesNotMatch(visualSource, /mesa-abm-skill/);
  assert.doesNotMatch(visualSource, /Mesa ABM \/ aviation_support/);
});

test("visual simulation uses only persisted ExperimentPlan IDs and fails closed without a selection", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualDropdownSource = appSource.slice(
    appSource.indexOf("function visualSimulationExperimentPlanOptions"),
    appSource.indexOf("function currentContextSummary")
  );
  const visualSelectionSource = appSource.slice(
    appSource.indexOf("function selectedVisualSimulationExperimentPlanContext"),
    appSource.indexOf("function renderVisualSimulationExperimentPlanDropdown")
  );
  const syncSource = appSource.slice(
    appSource.indexOf("function visualSimulationProjectSyncKey"),
    appSource.indexOf("function visualizationStreamEventClass")
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
  );

  assert.match(visualDropdownSource, /filter\(\(option\) => option\.kind === "experiment-plan"\)/);
  assert.match(visualSelectionSource, /option\.key === selectedRunContextKey/);
  assert.match(visualDropdownSource, /<span>实验方案<\/span>/);
  assert.match(visualDropdownSource, /aria-label="实验方案"/);
  assert.match(visualDropdownSource, /<option value="\$\{htmlEscape\(option\.key\)\}"/);
  assert.doesNotMatch(visualDropdownSource, /<optgroup|已保存实验方案|current-project:/);
  assert.match(visualDropdownSource, /暂无实验方案/);
  assert.match(syncSource, /if \(!context\) return/);
  assert.match(syncSource, /syncSelectedProjectJsonForSolaraVisualization\(\{/);
  assert.match(syncSource, /visualSimulationPlanFingerprint\(context\)/);
  assert.match(syncSource, /visualSimulationSyncRequestMatches/);
  assert.match(visualSource, /solaraVisualizationProjectIdOverrideContextKey === context\?\.key/);
  assert.match(visualSource, /data-visual-simulation-plan-empty/);
  assert.match(visualSource, /data-plan-list-link>前往实验方案管理<\/button>/);
  assert.match(visualSource, /solaraUrl \? `<iframe/);
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.match(visualSource, /experimentPlanId: context\.plan\.experiment_plan_id/);
});

test("ExperimentPlan list refresh rejects stale responses from another Project or request epoch", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const refreshSource = appSource.slice(
    appSource.indexOf("function resetExperimentPlanListLoadState"),
    appSource.indexOf("async function deleteExperimentPlanFromList")
  );

  assert.match(refreshSource, /backendExperimentPlansRequestEpoch \+= 1/);
  assert.match(refreshSource, /const requestEpoch = \+\+backendExperimentPlansRequestEpoch/);
  assert.match(refreshSource, /requestEpoch === backendExperimentPlansRequestEpoch/);
  assert.match(refreshSource, /backendExperimentPlansProjectId === normalizedProjectId/);
  assert.match(refreshSource, /currentBackendProjectId\(\) === normalizedProjectId/);
  assert.match(refreshSource, /if \(!requestIsCurrent\(\)\) return/);
  assert.match(refreshSource, /if \(requestIsCurrent\(\)\) backendExperimentPlansLoadInFlight = false/);
});

test("M9.8 docs mark platform embedding complete without making independent-mesa a runtime entry", async () => {
  const docs = {
    readme: await readFile(new URL("../README.md", import.meta.url), "utf8"),
    docsReadme: await readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    agent: await readFile(new URL("../agent.md", import.meta.url), "utf8"),
    liteMesaRuntime: await readFile(new URL("../docs/lite-mesa-formal-runtime.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /\/api\/mesa-analysis-runs/);
  assert.match(combined, /lite Mesa 会话/);
  assert.match(combined, /aircraft_support_v1/);
  assert.match(combined, /\/api\/runs[\s\S]{0,120}(历史实现|内部治理能力|后续持久化运行治理候选)/);
  assert.match(combined, /independent-mesa[^。]*(源码树已移除|源码树已从当前仓库移除|当前源码树移除)/);
  assert.doesNotMatch(combined, /四个结果分析页是用户可见的 current result flow/);
  assert.doesNotMatch(combined, /正式结果必须来自 `RunIntent -> \/api\/runs/);
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
    appSource.indexOf("async function refreshAnalysisProjectionPayloads")
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
    appSource.indexOf("async function refreshAnalysisProjectionPayloads")
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

test("not-applicable analysis projections render as scoped not modeled instead of formal KPI rows", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const boundarySource = appSource.slice(
    appSource.indexOf("function formalAnalysisBoundary"),
    appSource.indexOf("function renderFormalAnalysisBoundaryNote")
  );
  const noteSource = appSource.slice(
    appSource.indexOf("function renderFormalAnalysisBoundaryNote"),
    appSource.indexOf("function renderFormalProjectionBody")
  );
  const projectionBodySource = appSource.slice(
    appSource.indexOf("function renderFormalProjectionBody"),
    appSource.indexOf("function visibleDowntimeAnomalySnapshots")
  );
  const dashboardSource = appSource.slice(
    appSource.indexOf("function renderAnalysisDashboard"),
    appSource.indexOf("function renderBar")
  );
  const analysisPanelSource = appSource.slice(
    appSource.indexOf("function renderAnalysisProjectionResultPanel"),
    appSource.indexOf("function renderBar")
  );

  assert.match(boundarySource, /const projectionNotApplicable = .*projectionPayload/);
  assert.match(boundarySource, /projectionNotApplicable\s*\?\s*"not_applicable"/);
  assert.match(noteSource, /not_applicable: "不适用 \/ 未建模"/);
  assert.match(projectionBodySource, /formalProjection\.formal === false/);
  assert.match(projectionBodySource, /required_domains/);
  assert.match(projectionBodySource, /disabled_domains/);
  assert.match(projectionBodySource, /该分析所需保障域未建模/);
  assert.doesNotMatch(projectionBodySource, /validationLevel|validation_level/);
  assert.doesNotMatch(projectionBodySource, /Level 0|Level 1/);
  assert.match(dashboardSource, /formalProjection\?\.formal === false \? "<em>不适用<\/em>"/);
  assert.match(analysisPanelSource, /formalProjection\.formal === false \? "<em>不适用<\/em>"/);
  assert.doesNotMatch(projectionBodySource, /misleading-zero/);
});

test("frontend retires built-in modeling import template registry and selector", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const importTemplateModuleExists = await readFile(new URL("../front/modeling-import-templates.mjs", import.meta.url), "utf8")
    .then(() => true)
    .catch(() => false);
  const localImportSource = appSource.slice(
    appSource.indexOf("function renderLocalModelingImportActions"),
    appSource.indexOf("function renderModelingImportIssueDisplay")
  );

  assert.equal(importTemplateModuleExists, false);
  assert.doesNotMatch(appSource, /MODELING_IMPORT_TEMPLATES/);
  assert.doesNotMatch(appSource, /data-modeling-import-template/);
  assert.doesNotMatch(appSource, /selectedModelingImportTemplateId/);
  assert.doesNotMatch(appSource, /modelingImportTemplateLabel/);
  assert.doesNotMatch(appSource, /loadModelingImportTemplate/);
  assert.doesNotMatch(appSource, /Level 0|Level 1|选择内置导入模板|使用内置导入模板/);
  assert.match(localImportSource, /data-modeling-import-action="load-fixture"/);
  assert.match(localImportSource, /恢复内嵌样例导入包/);
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
  const createSource = appSource.slice(
    appSource.indexOf("async function createSampleProjectFromPublishedImport"),
    appSource.indexOf("async function loadSampleModelingImportFixture")
  );

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
  assert.ok(objects.supportResources.some((resource) => resource.type === "spare" && resource.name === "航电模块" && resource.quantity > 0));
  assert.ok(objects.transportPolicies.length >= 1);
  assert.ok(objects.transportPolicies.some((policy) => policy.name && policy.direction && policy.triggerMode));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "修复性维修" && activity.jobs.length >= 2));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "后勤保障"));
  assert.ok(objects.supportActivities.every((activity) => !("transportStrategies" in activity) && !("organizationStrategies" in activity)));
});

test("frontend modeling import demo fixture is synchronized with public canonical platform template", async () => {
  const canonical = JSON.parse(await readFile(new URL("../public/import-templates/canonical_platform_case.json", import.meta.url), "utf8"));
  assert.deepEqual(MODELING_IMPORT_DEMO_FIXTURE, canonical);
  assert.deepEqual(MODELING_IMPORT_DEMO_FIXTURE.source, {
    type: "json_fixture",
    name: "simulation_analysis_cases/canonical_platform_case.json",
    derivedFrom: "tests/fixtures/case_new.json"
  });
});

test("project list creates projects only from marked project templates", async () => {
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
    appSource.indexOf("async function createProjectFromSelectedProjectTemplate"),
    appSource.indexOf("async function createSampleProjectFromPublishedImport")
  );
  const addProjectIndex = appSource.indexOf("function addDemoProject");
  const hydrateSource = appSource.slice(
    appSource.indexOf("async function hydrateProjectCatalogFromBackend"),
    appSource.indexOf("function currentPublishedModelingImportId")
  );

  assert.match(projectSeedSource, /imported_sample: "imported_sample"/);
  assert.doesNotMatch(projectSeedSource, /manual_draft/);
  assert.doesNotMatch(projectSeedSource, /preview_fixture/);
  assert.doesNotMatch(projectSeedSource, /readManualDraftProjectsFromStorage|MANUAL_PROJECT_DRAFTS_STORAGE_KEY/);
  assert.equal(addProjectIndex, -1);
  assert.doesNotMatch(appSource, /persistManualDraftProjects|data-project-add|本地草稿|本地空白预览/);
  assert.match(projectListSource, /请选择项目模板创建项目/);
  assert.match(projectListSource, /data-project-template-select/);
  assert.match(projectListSource, /data-project-create-from-template/);
  assert.match(projectListSource, /从选中项目模板创建项目/);
  assert.match(projectListSource, /暂无项目模板/);
  assert.doesNotMatch(projectListSource, /data-modeling-import-template|MODELING_IMPORT_TEMPLATES|Level 0|Level 1|选择内置导入模板/);
  assert.doesNotMatch(projectListSource, /当前发布快照|当前项目数据模板|从选中模板创建项目/);
  assert.match(projectListSource, /暂无项目/);
  assert.match(projectListSource, /projectSourceBadge\(project\)/);
  assert.match(projectListSource, /projectSourceHelpText\(project\)/);
  assert.doesNotMatch(hydrateSource, /readManualDraftProjectsFromStorage|fallbackProjects|localManualProjects/);
  assert.match(hydrateSource, /请先选择项目模板创建项目/);
  assert.match(createSource, /backendApi\.getProject/);
  assert.match(createSource, /backendApi\.saveProject/);
  assert.match(createSource, /projectInfo: \{/);
  assert.match(createSource, /isTemplate: false/);
  assert.match(createSource, /is_template: false/);
  assert.match(createSource, /sourceKind: PROJECT_SOURCE\.imported_sample/);
  assert.doesNotMatch(createSource, /createProjectFromModelingImport/);
  assert.match(createSource, /projectListStatus = `已从项目模板创建项目：\$\{project\.name\}`;/);
});

test("modeling import publishing keeps the latest published import id for background actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const storageSource = appSource.slice(
    appSource.indexOf("const LAST_PUBLISHED_MODELING_IMPORT_STORAGE_KEY"),
    appSource.indexOf("let scenario =")
  );
  const currentImportSource = appSource.slice(
    appSource.indexOf("function currentPublishedModelingImportId"),
    appSource.indexOf("function editDemoProject")
  );
  const publishSource = appSource.slice(
    appSource.indexOf('if (action === "publish")'),
    appSource.indexOf('if (action === "compile-scenario")')
  );

  assert.match(storageSource, /LAST_PUBLISHED_MODELING_IMPORT_STORAGE_KEY = "spare-mvp:lastPublishedModelingImportId"/);
  assert.match(storageSource, /function readLastPublishedModelingImportId/);
  assert.match(storageSource, /function persistLastPublishedModelingImportId/);
  assert.match(currentImportSource, /readLastPublishedModelingImportId\(\)/);
  assert.match(publishSource, /persistLastPublishedModelingImportId\(modelingImportPackage\.importId\)/);
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
  assert.match(guardSource, /请先选择项目模板创建项目/);
  assert.doesNotMatch(guardSource, /本地草稿/);
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

test("visual simulation automatically syncs the selected Project before mounting Solara", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
  );
  const syncSource = appSource.slice(
    appSource.indexOf("function visualSimulationProjectSyncKey"),
    appSource.indexOf("function visualizationStreamEventClass")
  );

  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar|reload:/);
  assert.match(visualSource, /src="\$\{htmlEscape\(solaraUrl\)\}"/);
  assert.match(appSource, /async function syncSelectedProjectJsonForSolaraVisualization/);
  assert.match(appSource, /resolveSelectedExperimentPlanProjectJsonForRun\(\)/);
  assert.match(appSource, /backendApi\.saveProject\(projectJson\)/);
  assert.match(syncSource, /syncSelectedProjectJsonForSolaraVisualization\(\{/);
  assert.match(syncSource, /solaraVisualizationProjectSyncInFlightKey/);
  assert.match(syncSource, /solaraVisualizationProjectIdOverrideFingerprint === fingerprint/);
  assert.match(syncSource, /render\(\)/);
  assert.doesNotMatch(appSource, /solaraVisualizationReloadNonce|saveSelectedProjectJsonForSolaraVisualization/);
  assert.doesNotMatch(visualSource + syncSource, /startLiteMesaVisualizationThroughApi\(\)|backendApi\.runLiteMesaAnalysis|startSingleRunThroughApi|submitRunIntent|\/api\/runs/);
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
    appSource.indexOf("async function refreshAnalysisProjectionPayloads")
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
  const adapterSource = await readFile(new URL("../front/analysis-projection-adapters.mjs", import.meta.url), "utf8");
  const formalProjectionSource = appSource.slice(
    appSource.indexOf('if (formalProjection.analysisType === "carry_list")'),
    appSource.indexOf('if (formalProjection.analysisType === "mission_reliability")')
  );

  assert.match(adapterSource, /const priority = priorityLabel\(row\.risk_level\)/);
  assert.match(adapterSource, /function priorityLabel\(riskLevel\)/);
  assert.match(adapterSource, /riskLevel === "高"/);
  assert.match(adapterSource, /riskLevel === "中"/);
  assert.match(formalProjectionSource, /row\.priority === "高"/);
  assert.match(formalProjectionSource, /row\.priority === "中"/);
  assert.match(formalProjectionSource, /htmlEscape\(row\.priority\)/);
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

test("phase 6C mission reliability chart uses formal per-sample wave projection without hard-coded rates", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const lineChartSource = appSource.slice(
    appSource.indexOf("function renderLineChart"),
    appSource.indexOf("function field(label")
  );
  const dashboardSource = appSource.slice(
    appSource.indexOf("function renderAnalysisDashboard"),
    appSource.indexOf("function renderAnalysisProjectionResultPanel")
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
  assert.match(lineChartSource, /line-chart-y-axis/);
  assert.match(lineChartSource, /line-chart-y-label/);
  assert.doesNotMatch(lineChartSource, /0\.84/);
  assert.match(lineChartSource, /const minX = Math\.min/);
  assert.match(lineChartSource, /const xSpan = Math\.max\(1, maxX - minX\)/);
  assert.match(dashboardSource, /analysisProjectionForBoundary\(boundary\)/);
  assert.match(dashboardSource, /renderAnalysisProjectionResultPanel\(formalProjection\)/);
  assert.doesNotMatch(dashboardSource, /singleResult\.timeline|renderLineChart/);
  assert.match(formalReliabilitySource, /renderLiteMesaMissionReliabilityWaveChart\(rows\.map/);
  assert.match(formalReliabilitySource, /meanMissionSuccessRate: row\.probability/);
  assert.match(appSource, /function renderLiteMesaMissionReliabilityWaveChart/);
  assert.match(appSource, /meanMissionSuccessRate/);
  assert.match(lineChartSource, /point\.tooltip/);
  assert.doesNotMatch(formalReliabilitySource, /最大下降波次|任务波次|样本数|状态/);
  assert.doesNotMatch(formalReliabilitySource, /0\.7|0\.9|阈值|目标线|风险线/);
  assert.doesNotMatch(dashboardSource + formalReliabilitySource, /具体需求待甲方确定/);
});

test("phase 6D downtime analysis renders formal anomaly snapshots with export and delete controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const dashboardSource = appSource.slice(
    appSource.indexOf("function renderAnalysisDashboard"),
    appSource.indexOf("function renderAnalysisProjectionResultPanel")
  );
  const formalDowntimeSource = appSource.slice(
    appSource.indexOf('if (formalProjection.analysisType === "downtime_factors")'),
    appSource.indexOf("function visibleDowntimeAnomalySnapshots")
  );
  const handlerSource = appSource.slice(
    appSource.indexOf("const analysisActionButton"),
    appSource.indexOf("const experimentPlanRefreshButton")
  );

  assert.match(dashboardSource, /analysisProjectionForBoundary\(boundary\)/);
  assert.match(dashboardSource, /renderAnalysisProjectionResultPanel\(formalProjection\)/);
  assert.doesNotMatch(dashboardSource, /singleResult\.downtimeFactors/);
  assert.match(formalDowntimeSource, /保障活动状态/);
  assert.match(formalDowntimeSource, /jobNodeLabel/);
  assert.doesNotMatch(formalDowntimeSource, /support_activity_state|jobNodeId/);
  assert.match(formalDowntimeSource, /data-downtime-snapshot-export/);
  assert.match(formalDowntimeSource, /data-downtime-snapshot-delete/);
  assert.match(appSource, /function exportDowntimeAnomalySnapshots/);
  assert.match(appSource, /function deleteDowntimeAnomalySnapshot/);
  assert.match(handlerSource, /downtimeSnapshotExportButton/);
  assert.match(handlerSource, /downtimeSnapshotDeleteButton/);
});

test("monte carlo detail keeps formal source status and links to analysis pages", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const mcResultSource = appSource.slice(
    appSource.indexOf("function renderMonteCarloResults"),
    appSource.indexOf("function monteCarloFormalResultBoundary")
  );
  assert.match(appSource, /function renderMonteCarloResults/);
  assert.match(mcResultSource, /蒙特卡洛实验结果/);
  assert.match(mcResultSource, /renderMonteCarloFormalSourceTable\(boundary\)/);
  assert.match(mcResultSource, /renderMonteCarloAnalysisResultLocations\(boundary\)/);
  assert.match(mcResultSource, /renderMonteCarloFormalBlockedState\(boundary\)/);
  assert.match(appSource, /function renderAnalysisProjectionResultPanel/);
  assert.doesNotMatch(mcResultSource, /mc-formal-results|mc-formal-projection|renderFormalProjectionBody/);
  assert.doesNotMatch(mcResultSource, /mc-result-cards|mc-evaluation-table/);
});

test("SGR monte carlo pages label sortie_rate as 出动架次率", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const metricSource = await readFile(new URL("../front/monte-carlo-moments.mjs", import.meta.url), "utf8");
  const reliabilitySource = appSource.slice(
    appSource.indexOf("mission_reliability:"),
    appSource.indexOf("downtime_factors:")
  );
  const reliabilityTableStart = appSource.indexOf(
    'if (definition.analysisType === "mission_reliability")',
    appSource.indexOf("function renderLiteMesaAnalysisSessionBody")
  );
  const reliabilityTableSource = appSource.slice(
    reliabilityTableStart,
    appSource.indexOf("function field(label")
  );

  assert.match(metricSource, /metricId: "sortie_rate", label: "出动架次率"/);
  assert.match(reliabilitySource, /metricLabels: \["出动架次率", "波次成功率", "整周期任务可靠度", "任务周期"\]/);
  assert.match(reliabilityTableSource, /task-reliability-result-table/);
  assert.match(reliabilityTableSource, /<th>样本<\/th><th>波次<\/th><th>成功比例<\/th>/);
  assert.doesNotMatch(reliabilityTableSource, /平均出动架次率|formatLiteMesaAnalysisMetricValue|样本明细/);
  assert.doesNotMatch(metricSource + reliabilitySource + reliabilityTableSource, /出动完成率/);
});

test("lite Mesa analysis visible copy omits Mesa session wording and preserves sample-wave rows", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const analysisSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaAnalysisPage"),
    appSource.indexOf("function renderLiteMesaDowntimeEventSnapshots")
  );
  const reliabilityTableSource = analysisSource.slice(
    analysisSource.indexOf('if (definition.analysisType === "mission_reliability")'),
    analysisSource.indexOf('return `\\n    <div class="table-wrap"', analysisSource.indexOf('if (definition.analysisType === "mission_reliability")'))
  );

  assert.match(analysisSource, /后端内存运行/);
  assert.match(reliabilityTableSource, /task-reliability-result-table/);
  assert.match(reliabilityTableSource, /<th>样本<\/th><th>波次<\/th><th>成功比例<\/th>/);
  assert.match(reliabilityTableSource, /row\.sampleLabel/);
  assert.match(reliabilityTableSource, /renderLiteMesaMissionReliabilityWaveChart/);
  assert.doesNotMatch(reliabilityTableSource, /平均任务成功率|成功 \/ 总实验|失败实验|row\.seed|readyRate/);
  assert.doesNotMatch(appSource, /任务剖面可靠性/);
  assert.doesNotMatch(analysisSource, /Mesa 分析运行中|Mesa 分析失败|会话内 Mesa|后端内存会话/);
});

test("lite Mesa spare shortfall page uses transport delay and repair cancellation labels", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const definitionSource = appSource.slice(
    appSource.indexOf("spare_shortfall:"),
    appSource.indexOf("carry_list:")
  );
  const sessionBodyStart = appSource.indexOf(
    'if (definition.analysisType === "spare_shortfall")',
    appSource.indexOf("function renderLiteMesaAnalysisSessionBody")
  );
  const sessionBodySource = appSource.slice(
    sessionBodyStart,
    appSource.indexOf('if (definition.analysisType === "carry_list")', sessionBodyStart)
  );

  assert.match(definitionSource, /metricLabels: \["发生缺件备件", "平均备件延误时间\(h\)", "最高缺件备件", "因维修延误导致的任务取消次数"\]/);
  assert.match(sessionBodySource, /平均备件延误时间\(h\)/);
  assert.match(sessionBodySource, /meanTransportDelayHours/);
  assert.doesNotMatch(sessionBodySource, /<th>缺件次数<\/th>|row\.shortage/);
});

test("lite Mesa carry and downtime result detail hides requested setting-only fields", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const carryDefinitionSource = appSource.slice(
    appSource.indexOf("carry_list:"),
    appSource.indexOf("mission_reliability:")
  );
  const downtimeDefinitionSource = appSource.slice(
    appSource.indexOf("downtime_factors:"),
    appSource.indexOf("});", appSource.indexOf("downtime_factors:"))
  );
  const metricFilterSource = appSource.slice(
    appSource.indexOf("function liteMesaAnalysisVisibleMetrics"),
    appSource.indexOf("function renderLiteMesaAnalysisSessionBody")
  );
  const carryBodyStart = appSource.indexOf(
    'if (definition.analysisType === "carry_list")',
    appSource.indexOf("function renderLiteMesaAnalysisSessionBody")
  );
  const carryBodySource = appSource.slice(
    carryBodyStart,
    appSource.indexOf('if (definition.analysisType === "mission_reliability")', carryBodyStart)
  );

  assert.match(carryDefinitionSource, /metricLabels: \["建议携行总数", "高优先级备件", "总体备件利用率"\]/);
  assert.match(downtimeDefinitionSource, /metricLabels: \["停机因素项", "首要因素", "最高贡献度"\]/);
  assert.match(metricFilterSource, /carry_list: new Set\(\["备件满足率下限", "置信度目标", "样本数"\]\)/);
  assert.match(metricFilterSource, /downtime_factors: new Set\(\["样本数"\]\)/);
  assert.doesNotMatch(carryBodySource, /<th>置信度目标<\/th>|row\.confidenceTarget/);
  assert.match(carryBodySource, /data-carry-hide-zero/);
  assert.match(carryBodySource, /隐藏需求数值为 0 的备件/);
  assert.match(carryBodySource, /data-carry-aircraft-filter/);
  assert.match(carryBodySource, /<th>机型<\/th>/);
  assert.match(carryBodySource, /data-carry-recommended-sort="asc"/);
  assert.match(carryBodySource, /data-carry-recommended-sort="desc"/);
  assert.match(carryBodySource, /aria-label="按建议携行数量升序排列"/);
  assert.match(carryBodySource, /aria-label="按建议携行数量降序排列"/);
  assert.match(carryBodySource, /aria-label="有寿件说明" aria-describedby="carry-life-limited-tooltip"/);
  assert.match(carryBodySource, /class="carry-life-tooltip" role="tooltip"/);
  assert.match(carryBodySource, /carryListProductDisplayName\(row, productsById\)/);
  assert.doesNotMatch(carryBodySource, /row\.spareType/);
  assert.doesNotMatch(carryBodySource, /<span>有寿件寿命在预防性维修中配置/);
  assert.match(styleSource, /\.carry-life-help:hover \.carry-life-tooltip/);
  assert.match(styleSource, /\.carry-life-help:focus-within \.carry-life-tooltip/);
});

test("downtime analysis exposes four-factor multi-select, linked summaries, and typed event details", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const downtimeSource = await readFile(new URL("../front/downtime-analysis.mjs", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const renderSource = appSource.slice(
    appSource.indexOf("function visibleDowntimeAnalysisSnapshot"),
    appSource.indexOf("function formatPeriodDurationDays")
  );
  const changeSource = appSource.slice(
    appSource.indexOf('const downtimeFactorFilter = event.target.closest("[data-downtime-factor-filter]")'),
    appSource.indexOf("const spareAircraftFilterSelect", appSource.indexOf('const downtimeFactorFilter'))
  );

  for (const [factor, label] of [
    ["spare_shortage", "备件短缺"],
    ["failure", "装备故障"],
    ["equipment_shortage", "保障设备短缺"],
    ["preventive", "预防性维修"]
  ]) {
    assert.match(downtimeSource, new RegExp(`value: "${factor}", label: "${label}"`));
  }
  assert.match(appSource, /selectedDowntimeFactorTypes = new Set\(DOWNTIME_FACTOR_OPTIONS/);
  assert.match(changeSource, /selectedDowntimeFactorTypes\.add/);
  assert.match(changeSource, /selectedDowntimeFactorTypes\.delete/);
  assert.match(renderSource, /请选择至少一种停机因素/);
  assert.match(renderSource, /暂无该类型停机事件/);
  assert.match(renderSource, /累计停机时长（小时）/);
  assert.match(renderSource, /持续时长（小时）/);
  assert.match(downtimeSource, /formatDowntimeSimulationTime/);
  assert.match(downtimeSource, /repair: "修复性维修"/);
  assert.match(downtimeSource, /preventive: "预防性维修"/);
  assert.match(downtimeSource, /任务名称未解析|不在任务阶段/);
  assert.doesNotMatch(renderSource + downtimeSource, /未配置任务/);
  assert.doesNotMatch(renderSource, /`\$\{fixed\(minute, 0\)\} min`|持续时长\(h\)|累计停机时长\(h\)/);
  assert.match(renderSource, /当前范围时长占比/);
  assert.match(renderSource, /\.sort\(\(left, right\) => right\.downtimeHours - left\.downtimeHours\)/);
  assert.match(renderSource, /停机事件明细/);
  assert.match(renderSource, /停机因素类型/);
  assert.match(renderSource, /保障组织节点/);
  assert.match(renderSource, /downtimeDisplayValue\(value\)/);
  assert.doesNotMatch(downtimeSource, /故障模式|localizeFailureMode/);
  assert.match(styleSource, /\.downtime-factor-option:has\(input:checked\)/);
});

test("lite Mesa Monte Carlo detail uses decimal ratios, moments, and hides internal metadata chrome", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const renderSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis"),
    appSource.indexOf("function liteMesaBusinessMetricRows")
  );
  const metricSource = await readFile(new URL("../front/monte-carlo-moments.mjs", import.meta.url), "utf8");

  assert.match(metricSource, /metricId: "mean_transport_delay", label: "平均备件延误时间"/);
  assert.doesNotMatch(metricSource, /shortage_events|短缺事件/);
  assert.doesNotMatch(renderSource, /后端 Mesa 仿真分析|lite-mesa-hero-meter|lite-mesa-source-grid/);
  assert.match(metricSource, /return value\.toFixed\(2\)/);
  assert.match(metricSource, /variance \? "不可计算" : "无有效样本"/);
});

test("system management exposes an independent equipment RMS allocation workbench", async () => {
  const page = getFeaturePageById("system-management-equipment-rms-allocation");
  assert.equal(page.module, "系统运行支持模块");
  assert.equal(page.secondary, "装备RMS指标分配");
  assert.equal(page.tertiary, "装备RMS指标分配");
  assert.equal(page.name, "装备RMS指标分配");
  assert.deepEqual(page.dataObjects, ["rmsAllocationPlan", "basicMissions", "equipmentNodes", "allocationResults"]);

  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /renderRmsAllocationWorkbench/);
  assert.match(appSource, /data-rms-path/);
  assert.match(appSource, /data-rms-equipment-import-file/);
  assert.match(appSource, /data-rms-equipment-root/);
  assert.match(appSource, /data-rms-equipment-node/);
  assert.match(appSource, /data-rms-equipment-field/);
  assert.match(appSource, /data-rms-aircraft-model/);
  assert.match(appSource, /data-rms-basic-mission/);
  assert.match(appSource, /data-rms-result-import-file/);
  assert.match(appSource, /data-rms-result-field/);
  assert.match(appSource, /function updateRmsEquipmentField/);
  assert.match(appSource, /function persistRmsAllocationDraftToScenario/);
  assert.match(appSource, /rms-allocation-workbench-v1/);
  assert.match(appSource, /rms-allocation-result-set-v1/);
  assert.match(appSource, /normalizeRmsEquipmentImportRows/);
  assert.match(appSource, /selectRmsAllocationEquipmentRoot/);
  assert.match(appSource, /calculateRmsAllocation\(planSnapshot, projectSnapshot\)/);
  assert.match(appSource, /function invalidateCurrentRmsAllocationResult\(\)/);
  assert.match(appSource, /state\.calculationStatus = "calculating"/);
  assert.match(appSource, /state\.calculationStatus = completed \? "completed" : "not-calculated"/);
  assert.match(appSource, /state\.calculationRunId !== calculationRunId/);
  assert.match(appSource, /function saveCurrentRmsAllocationResult\(\)/);
  assert.match(appSource, /function importRmsAllocationResultFile\(file\)/);
  assert.doesNotMatch(appSource, /publishRmsAllocation\(rmsAllocationProject, rmsAllocationResult\)/);
  assert.doesNotMatch(appSource, /function renderTopbarContext\(page\)/);
  assert.match(appSource, /<p>\$\{htmlEscape\(currentProject\?\.name \|\| "未选择项目"\)\}<\/p>/);
  assert.doesNotMatch(appSource, /SYSTEM_SUPPORT_MODULE_NAME} \/ \$\{htmlEscape\(page\.secondary\)\} \/ \$\{htmlEscape\(page\.tertiary\)\}/);
  assert.match(styleSource, /\.rms-allocation-workbench/);
  assert.match(styleSource, /\.rms-equipment-tree/);
  assert.match(styleSource, /\.rms-method-panel/);
  assert.match(styleSource, /\.rms-installation-panel/);
  assert.match(styleSource, /\.rms-data-preparation-grid/);
  assert.match(styleSource, /\.rms-calculation-flow/);
  assert.match(styleSource, /\.rms-calculation-step/);
  assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*\.rms-data-preparation-grid,[\s\S]*\.rms-calculation-flow,[\s\S]*grid-template-columns: 1fr;/);
  assert.doesNotMatch(styleSource, /\.rms-tree-import-block/);
  assert.match(styleSource, /\.rms-import-button\s*\{[^}]*width: 96px;[^}]*height: 34px;/s);
  assert.match(styleSource, /\.rms-calculation-status/);

  const workbenchSource = await readFile(new URL("../front/rms-allocation-workbench.mjs", import.meta.url), "utf8");
  assert.match(workbenchSource, /装备 RMS 指标分配/);
  assert.doesNotMatch(workbenchSource, /plan\.name/);
  assert.match(workbenchSource, /下载模板/);
  assert.match(workbenchSource, /上传文件/);
  assert.doesNotMatch(workbenchSource, /import-sample/);
  assert.doesNotMatch(workbenchSource, /导入 15/);
  assert.match(workbenchSource, /装备结构树/);
  assert.doesNotMatch(appSource, /当前装备树来自项目装备系统建模，RMS 编辑值按飞机型号独立保存/);
  assert.doesNotMatch(workbenchSource, /当前安装数为 RMS 分配工作台独立数据/);
  const dataPreparationPanelSource = workbenchSource.slice(
    workbenchSource.indexOf('<section class="rms-aircraft-input-panel rms-data-preparation-panel"'),
    workbenchSource.indexOf('${hasSelectedAircraft ? `<section class="organization-layout equipment-layout rms-layout">')
  );
  assert.match(dataPreparationPanelSource, /机型选择与数据准备/);
  assert.match(dataPreparationPanelSource, /aria-labelledby="rms-data-preparation-title"/);
  assert.match(dataPreparationPanelSource, /role="group" aria-label="RMS 安装数数据操作"/);
  assert.ok(dataPreparationPanelSource.indexOf("飞机型号") < dataPreparationPanelSource.indexOf("下载模板"));
  assert.ok(dataPreparationPanelSource.indexOf("下载模板") < dataPreparationPanelSource.indexOf("上传文件"));
  assert.match(dataPreparationPanelSource, /data-rms-aircraft-model/);
  assert.match(dataPreparationPanelSource, /data-rms-action="download-template"/);
  assert.match(dataPreparationPanelSource, /data-rms-equipment-import-file/);
  assert.doesNotMatch(dataPreparationPanelSource, /data-rms-basic-mission|inputs\.missionReliability|inputs\.missionHours|inputs\.mtbfHours|inputs\.mttrHours/);
  const equipmentTreePanelSource = workbenchSource.slice(
    workbenchSource.indexOf('<aside class="tree-container rms-equipment-tree">'),
    workbenchSource.indexOf('<section class="detail-panel equipment-system-table-panel rms-installation-panel">')
  );
  assert.match(equipmentTreePanelSource, /装备结构树/);
  assert.doesNotMatch(equipmentTreePanelSource, /下载模板|上传文件|data-rms-equipment-import-file/);
  const installationPanelSource = workbenchSource.slice(
    workbenchSource.indexOf('<section class="detail-panel equipment-system-table-panel rms-installation-panel">'),
    workbenchSource.indexOf('<section class="rms-method-panel rms-calculation-panel"')
  );
  assert.doesNotMatch(installationPanelSource, /导入安装数|下载模板|上传文件/);
  assert.match(installationPanelSource, /renderInstallationTable/);
  const calculationPanelSource = workbenchSource.slice(
    workbenchSource.indexOf('<section class="rms-method-panel rms-calculation-panel"'),
    workbenchSource.indexOf('<section class="analysis-chart-panel rms-result-panel">')
  );
  assert.match(calculationPanelSource, /RMS 输入与指标分配计算/);
  assert.match(calculationPanelSource, /aria-labelledby="rms-calculation-panel-title"/);
  assert.match(calculationPanelSource, /RMS 输入参数/);
  assert.match(calculationPanelSource, /指标分配方法/);
  assert.match(calculationPanelSource, /执行计算/);
  assert.match(calculationPanelSource, /data-rms-calculation-status/);
  assert.match(calculationPanelSource, /data-rms-action="calculate"/);
  assert.match(calculationPanelSource, /data-rms-basic-mission/);
  assert.match(calculationPanelSource, /任务时长由基本任务只读取得/);
  assert.doesNotMatch(calculationPanelSource, /data-rms-aircraft-model|下载模板|上传文件/);
  assert.equal((workbenchSource.match(/data-rms-aircraft-model/g) || []).length, 1);
  assert.equal((workbenchSource.match(/data-rms-action="download-template"/g) || []).length, 1);
  assert.equal((workbenchSource.match(/data-rms-equipment-import-file/g) || []).length, 1);
  assert.equal((workbenchSource.match(/data-rms-action="calculate"/g) || []).length, 1);
  assert.match(workbenchSource, /data-rms-aircraft-model/);
  assert.match(workbenchSource, /data-rms-basic-mission/);
  assert.match(workbenchSource, /inputs\.missionReliability|整机任务可靠度 R\(T\)/);
  assert.doesNotMatch(workbenchSource, /data-rms-path="inputs\.missionHours"|data-rms-path="inputs\.mtbfHours"/);
  assert.match(workbenchSource, /basicMission\.missionHours/);
  assert.doesNotMatch(workbenchSource, /inputs\.criticalFailureRatio|关键故障占比/);
  assert.match(workbenchSource, /inputs\.mttrHours/);
  assert.ok(calculationPanelSource.indexOf("data-rms-basic-mission") < calculationPanelSource.indexOf('input("任务时长"'));
  assert.ok(calculationPanelSource.indexOf('input("任务时长"') < calculationPanelSource.indexOf('input("整机任务可靠度 R(T)"'));
  assert.ok(calculationPanelSource.indexOf('input("整机任务可靠度 R(T)"') < calculationPanelSource.indexOf('input("MTTR"'));
  assert.ok(calculationPanelSource.indexOf('input("MTTR"') < calculationPanelSource.indexOf("指标分配方法"));
  assert.ok(calculationPanelSource.indexOf("指标分配方法") < calculationPanelSource.indexOf("执行计算"));
  assert.ok(calculationPanelSource.indexOf("执行计算") < calculationPanelSource.indexOf('data-rms-action="calculate"'));
  assert.match(workbenchSource, /请先选择飞机型号/);
  assert.match(workbenchSource, /当前项目暂无飞机型号，请先完成装备系统建模/);
  assert.match(workbenchSource, /organization-layout equipment-layout rms-layout/);
  assert.match(workbenchSource, /tree-node-label root/);
  assert.match(workbenchSource, /<th>系统名称<\/th><th>型号<\/th><th>安装数<\/th><th>运行比<\/th>/);
  assert.match(workbenchSource, /data-rms-equipment-root/);
  assert.match(workbenchSource, /data-rms-equipment-node/);
  assert.match(workbenchSource, /data-rms-equipment-field="name"/);
  assert.match(workbenchSource, /及以下节点/);
  assert.doesNotMatch(workbenchSource, /<select data-rms-equipment-root/);
  assert.match(workbenchSource, /指标分配方法/);
  assert.match(workbenchSource, /等分配法/);
  assert.match(workbenchSource, /比例分配法/);
  assert.match(workbenchSource, /相似产品分配法/);
  assert.doesNotMatch(workbenchSource, /比例修正系数|相似修正系数/);
  assert.match(workbenchSource, /plan\.methods\.allocation === "similar"/);
  assert.match(workbenchSource, /基准机型/);
  assert.match(workbenchSource, /data-rms-action="calculate"\$\{calculateDisabled \? " disabled" : ""\}/);
  assert.match(workbenchSource, /data-rms-result-import-file/);
  assert.match(workbenchSource, /data-rms-result-field="mtbfHours"/);
  assert.match(workbenchSource, /data-rms-result-field="mttrHours"/);
  assert.match(workbenchSource, /data-rms-action="save-result"/);
  assert.doesNotMatch(workbenchSource, /data-rms-action="save-draft"/);
  assert.doesNotMatch(workbenchSource, /data-rms-action="publish"/);
  assert.doesNotMatch(workbenchSource, /AGREE 分配法/);
  assert.doesNotMatch(workbenchSource, /评分分配法/);
  assert.doesNotMatch(workbenchSource, /任务暴露矩阵|节点暴露|暴露时间/);
  assert.doesNotMatch(workbenchSource, /missionProfile|compositeTasks|periodicTasks/);
  assert.ok(workbenchSource.indexOf("机型选择与数据准备") < workbenchSource.indexOf("装备结构树"));
  assert.ok(workbenchSource.indexOf("装备结构树") < workbenchSource.indexOf("RMS 输入与指标分配计算"));
  assert.ok(workbenchSource.indexOf("RMS 输入与指标分配计算") < workbenchSource.indexOf("<h3>节点分配结果</h3>"));
  assert.match(workbenchSource, /运行比/);
  assert.match(workbenchSource, /<th>层级<\/th><th>节点<\/th><th>运行比<\/th><th>本层份额<\/th><th>失效率<\/th><th>MTBF\(h\)<\/th><th>MTTR\(h\)<\/th><th>校核<\/th>/);
  assert.match(workbenchSource, /compactNumber\(row\.failureRate, 8\)/);
  assert.match(workbenchSource, /compactNumber\(row\.mtbfHours, 6\)/);
  assert.match(workbenchSource, /compactNumber\(row\.mttrHours, 6\)/);
  assert.doesNotMatch(workbenchSource, /<th>产品强度<\/th>/);
  assert.doesNotMatch(workbenchSource, /<th>结构<\/th>/);
  assert.match(workbenchSource, /计算完成。/);
  assert.match(workbenchSource, /data-rms-calculation-status/);
  assert.match(workbenchSource, /计算进行中/);
  assert.match(workbenchSource, /未计算/);
  assert.match(workbenchSource, /data-rms-action="export-excel"\$\{canExport \? "" : " disabled"\}/);
  assert.match(workbenchSource, /rms-calculation-overlay/);
  assert.match(appSource, /function startRmsAllocationCalculation\(\)/);
  assert.match(appSource, /globalThis\.setTimeout\([\s\S]*?\}, 2000\);/);
  const rmsInputChangeSource = appSource.slice(
    appSource.indexOf('const rmsInput = event.target.closest("[data-rms-path]")'),
    appSource.indexOf('const mcArrayInput = event.target.closest("[data-mc-array-path]")')
  );
  assert.match(rmsInputChangeSource, /setPath\(rmsAllocationPlan/);
  assert.match(rmsInputChangeSource, /invalidateCurrentRmsAllocationResult\(\)/);
  assert.doesNotMatch(rmsInputChangeSource, /recalculateRmsAllocation\(\)/);
  const rmsImportChangeSource = appSource.slice(
    appSource.indexOf('const rmsEquipmentImportFile = event.target.closest("[data-rms-equipment-import-file]")'),
    appSource.indexOf('const equipmentImportFile = event.target.closest("[data-equipment-import-file]")')
  );
  assert.match(rmsImportChangeSource, /importRmsEquipmentTableFile\(rmsEquipmentImportFile\.files\?\.\[0\]\)/);
  assert.match(rmsImportChangeSource, /importRmsAllocationResultFile\(rmsResultImportFile\.files\?\.\[0\]\)/);
  const rmsActionClickSource = appSource.slice(
    appSource.indexOf('const rmsActionButton = event.target.closest("[data-rms-action]")'),
    appSource.indexOf('const rmsEquipmentRootButton = event.target.closest("[data-rms-equipment-root]")')
  );
  assert.match(rmsActionClickSource, /downloadRmsEquipmentTemplate\(\)/);
  assert.match(rmsActionClickSource, /startRmsAllocationCalculation\(\)/);
  assert.match(rmsActionClickSource, /saveCurrentRmsAllocationResult\(\)/);
  const rmsMissionSelectionSource = appSource.slice(
    appSource.indexOf("function rmsBasicMissionForProject"),
    appSource.indexOf("function updateRmsAllocationResultField")
  );
  assert.match(rmsMissionSelectionSource, /project\?\.basicMissions/);
  assert.match(rmsMissionSelectionSource, /taskDurationMinutes/);
  assert.match(rmsMissionSelectionSource, /inputs: normalizeRmsAllocationInputs/);
  assert.doesNotMatch(rmsMissionSelectionSource, /missionProfile|compositeTasks|periodicTasks|exposure/);
  const rmsResultEditSource = appSource.slice(
    appSource.indexOf("function updateRmsAllocationResultField"),
    appSource.indexOf("async function saveCurrentRmsAllocationResult")
  );
  assert.match(rmsResultEditSource, /\["mtbfHours", "mttrHours"\]/);
  assert.match(rmsResultEditSource, /state\.result\.source = "edited"/);
  assert.match(rmsResultEditSource, /结果已编辑，尚未保存/);
  assert.match(rmsResultEditSource, /叶子节点回算风险/);
  const rmsResultSaveSource = appSource.slice(
    appSource.indexOf("async function saveCurrentRmsAllocationResult"),
    appSource.indexOf("async function importRmsAllocationResultFile")
  );
  assert.match(rmsResultSaveSource, /rmsEditableResultErrors/);
  assert.match(rmsResultSaveSource, /await saveProjectDraftNow\(\)/);
  assert.match(rmsResultSaveSource, /分解结果已保存/);
  assert.match(rmsResultSaveSource, /分解结果保存失败/);
  const rmsResultImportSource = appSource.slice(
    appSource.indexOf("async function importRmsAllocationResultFile"),
    appSource.indexOf("function selectRmsAircraftModel")
  );
  assert.match(rmsResultImportSource, /previewRmsAllocationXlsx/);
  assert.match(rmsResultImportSource, /项目 ID 与当前项目不一致/);
  assert.match(rmsResultImportSource, /基本任务与当前选择不一致/);
  assert.match(rmsResultImportSource, /算法版本与当前方案不一致/);
  assert.match(rmsResultImportSource, /source: "xlsx-import"/);
  assert.match(rmsResultImportSource, /结果尚未保存/);
});

test("RMS outer groups stack across the narrow two-column workspace without changing the inner mobile grid", async () => {
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const intermediateStart = styleSource.indexOf("@media (max-width: 1085px)");
  const narrowStart = styleSource.indexOf("@media (max-width: 900px)");
  assert.ok(intermediateStart >= 0);
  assert.ok(narrowStart > intermediateStart);

  const intermediateMedia = styleSource.slice(intermediateStart, narrowStart);
  assert.match(intermediateMedia, /\.rms-data-preparation-grid,\s*\.rms-calculation-flow\s*\{\s*grid-template-columns: 1fr;/);
  assert.doesNotMatch(intermediateMedia, /\.rms-calculation-input-grid/);

  const narrowMedia = styleSource.slice(narrowStart);
  assert.match(narrowMedia, /\.rms-data-preparation-grid,[\s\S]*\.rms-calculation-flow,[\s\S]*\.rms-calculation-input-grid,[\s\S]*grid-template-columns: 1fr;/);
  assert.match(styleSource, /\.rms-calculation-flow\s*\{\s*display: grid;\s*grid-template-columns: minmax\(270px, 2fr\) minmax\(210px, 1fr\) minmax\(170px, 0\.8fr\);/);

  const twoColumnWorkspaceChrome = 32 + 16 + 280 + 2 + 36 + 2 + 28;
  const stackedContentMinimum = 270;
  for (const viewportWidth of [901, 945, 1085]) {
    assert.ok(viewportWidth <= 1085, `${viewportWidth}px must use the intermediate single-column outer grids`);
    assert.ok(
      viewportWidth - twoColumnWorkspaceChrome >= stackedContentMinimum,
      `${viewportWidth}px must fit the retained two-column RMS input grid after the outer groups stack`
    );
  }

  const desktopFlowMinimum = 270 + 210 + 170 + (2 * 12);
  assert.ok(1086 - twoColumnWorkspaceChrome >= desktopFlowMinimum);
});

test("RMS allocation workbench renders parameters for only the selected method", () => {
  const project = createDemoRmsAllocationProject();
  const plan = createDefaultRmsAllocationPlan(project);
  const renderWithMethod = (method) => {
    plan.methods.allocation = method;
    return renderRmsAllocationWorkbench({
      project,
      plan,
      result: calculateRmsAllocation(plan, project),
      importStatus: "",
      aircraftModels: ["F16", "F15", "F18"],
      selectedAircraftModel: "F16",
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
  assert.doesNotMatch(equalHtml, /目标 R|校核可靠度|MTBCF|MTTR 裕度/);
  assert.match(equalHtml, /运行比<\/th>/);
  assert.match(equalHtml, /失效率/);
  assert.doesNotMatch(equalHtml, /分配份额/);
  assert.match(equalHtml, /任务计算机LRU/);
  assert.match(equalHtml, /运行比 0\.65/);
  assert.match(equalHtml, /value="0\.65"/);

  const proportionalHtml = renderWithMethod("proportional");
  assert.doesNotMatch(proportionalHtml, /比例修正系数|相似修正系数/);
  assert.doesNotMatch(proportionalHtml, /基准机型/);

  const similarHtml = renderWithMethod("similar");
  assert.match(similarHtml, /基准机型/);
  assert.doesNotMatch(similarHtml, /比例修正系数|相似修正系数/);

  const calculatingHtml = renderRmsAllocationWorkbench({
    project,
    plan,
    result: calculateRmsAllocation(plan, project),
    importStatus: "",
    aircraftModels: ["F16", "F15", "F18"],
    selectedAircraftModel: "F16",
    calculationStatus: "calculating",
    htmlEscape: (value) => String(value ?? ""),
    fixed: (value, digits = 2) => Number(value || 0).toFixed(digits),
    pct: (value) => `${Math.round(Number(value || 0) * 100)}%`
  });
  assert.match(calculatingHtml, /data-rms-action="calculate" disabled>计算进行中/);
  assert.match(calculatingHtml, /data-rms-calculation-status="calculating"[^>]*>计算进行中/);
  assert.match(calculatingHtml, /data-rms-action="export-excel" disabled/);
  assert.match(calculatingHtml, /class="rms-calculation-overlay"/);
});

test("system management exposes project management and base configuration pages", async () => {
  const expectedPages = [
    ["system-management-project-data-management", "项目管理", "项目数据管理", ["projectList", "templateManagement", "dataOverview"]],
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
  assert.doesNotMatch(appSource, /项目数据管理配置/);
  assert.match(appSource, /data-project-data-config-module="project-data-layer"/);
  assert.match(appSource, /data-project-data-project-list/);
  assert.match(appSource, /data-project-template-management/);
  assert.doesNotMatch(appSource, /data-project-json-viewer/);
  assert.doesNotMatch(appSource, /data-project-data-config-module="modeling-data-source"/);
  assert.match(appSource, /MODELING_DATA_MODULES/);
  assert.match(appSource, /装备系统/);
  assert.match(appSource, /装备任务/);
  assert.match(appSource, /保障组织/);
  assert.match(appSource, /保障活动/);
  assert.match(appSource, /建模颗粒度配置/);
  assert.match(appSource, /全要素/);
  assert.match(appSource, /装备RMS/);
  assert.doesNotMatch(appSource, /颗粒度 A/);
  assert.doesNotMatch(appSource, /颗粒度 B/);
  assert.match(appSource, /data-modeling-field-select/);
  assert.doesNotMatch(appSource, /层级、对象及关系/);
  assert.doesNotMatch(appSource, /<th>建模层级<\/th>/);
  assert.match(appSource, /page\.name === "建模表单管理"/);
  assert.match(appSource, /data-modeling-form-management/);
  assert.match(appSource, /data-modeling-form-unit/);
  assert.match(appSource, /data-personnel-specialty-dictionary/);
  assert.match(appSource, /data-product-catalog-management/);
  assert.match(appSource, /产品列表/);
  assert.equal(appSource.includes("仅保留保障人员专业字典与 ${timeUnitFieldCount} 个带时间单位的表单字段配置。"), false);
  assert.match(styleSource, /\.system-config-workbench/);
  assert.match(styleSource, /\.modeling-config-grid/);
  assert.match(styleSource, /\.modeling-form-config-grid/);
  assert.match(styleSource, /\.modeling-form-config-grid\s*\{[^}]*max-width:\s*1040px/s);
  assert.match(styleSource, /\.modeling-form-config-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styleSource, /\.field-checkbox-grid/);
  assert.match(styleSource, /\.granularity-check\s*\{[^}]*color:\s*var\(--primary\)/s);
  assert.match(styleSource, /\.granularity-field-checkbox\s*\{[^}]*appearance:\s*none[^}]*opacity:\s*1/s);
  assert.match(styleSource, /\.granularity-field-checkbox:checked::after\s*\{/);
  assert.match(styleSource, /\.granularity-field-checkbox:disabled\s*\{[^}]*opacity:\s*1/s);
});

test("modeling form product catalog collapse is accessible and does not reserve layout space", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const formSource = appSource.slice(
    appSource.indexOf("function renderModelingFormManagementConfig"),
    appSource.indexOf("function renderProductCatalogManagement")
  );
  const productSource = appSource.slice(
    appSource.indexOf("function renderProductCatalogManagement"),
    appSource.indexOf("function renderProductCatalogEditor")
  );

  assert.match(appSource, /let isProductCatalogCollapsed = false/);
  assert.match(appSource, /const productCatalogCollapseButton = event\.target\.closest\("\[data-product-catalog-collapse-toggle\]"\)/);
  assert.match(appSource, /isProductCatalogCollapsed = !isProductCatalogCollapsed;\s*render\(\);/s);
  assert.match(productSource, /<button[\s\S]*?type="button"[\s\S]*?data-product-catalog-collapse-toggle/);
  assert.match(productSource, /aria-expanded="\$\{String\(!isProductCatalogCollapsed\)\}"/);
  assert.match(productSource, /aria-controls="product-catalog-content"/);
  assert.match(productSource, /aria-label="\$\{isProductCatalogCollapsed \? "展开产品列表" : "折叠产品列表"\}"/);
  assert.match(productSource, /isProductCatalogCollapsed \? "展开列表" : "收起列表"/);
  assert.match(productSource, /id="product-catalog-content"[\s\S]*?data-product-catalog-content \$\{isProductCatalogCollapsed \? "hidden" : ""\}/);

  const productIndex = formSource.indexOf("${renderProductCatalogManagement()}");
  const timeUnitIndex = formSource.indexOf("data-modeling-form-time-unit-fields");
  assert.ok(productIndex >= 0 && productIndex < timeUnitIndex, "time unit fields must follow the product catalog in DOM order");
  assert.doesNotMatch(formSource, /class="[^"]*spacer|data-layout-spacer/i);

  assert.match(styleSource, /\.modeling-form-config-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*align-content:\s*start/s);
  assert.match(styleSource, /\.product-catalog-content\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(styleSource, /\.modeling-form-time-unit-card\s*\{[^}]*scroll-margin-block-start:\s*12px/s);
  assert.match(styleSource, /@media \(max-width:\s*760px\)[\s\S]*?\.modeling-form-config-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styleSource, /@media \(max-width:\s*760px\)[\s\S]*?\.product-catalog-section-head\s*\{[^}]*flex-direction:\s*column/s);
  assert.doesNotMatch(styleSource, /\.modeling-form-config-grid\s*\{[^}]*(?:min-)?height\s*:/s);
  assert.doesNotMatch(styleSource, /\.product-catalog-content\s*\{[^}]*min-height\s*:/s);
  assert.doesNotMatch(styleSource, /\.modeling-form-time-unit-card\s*\{[^}]*min-height\s*:/s);
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
  assert.match(appSource, /htmlEscape\(context\.name\)/);
  assert.match(appSource, /htmlEscape\(plan\.name\)/);
});

test("visual simulation page embeds the Solara visualization frame", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
  );
  assert.match(appSource, /mesa-visual-shell/);
  assert.match(appSource, /solara-visualization-frame/);
  assert.match(appSource, /data-solara-visualization-frame/);
  assert.doesNotMatch(appSource, /Solara 可视化内嵌页/);
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.doesNotMatch(appSource, /飞机保障独立 Mesa 仿真/);
  assert.doesNotMatch(appSource, /点击可视化推演后直接读取当前 Project/);
  assert.doesNotMatch(appSource, /mesa-visual-header/);
  assert.doesNotMatch(appSource, /mesa-clock/);
  assert.doesNotMatch(appSource, /formal run \/ aircraft_support_v1/);
  assert.doesNotMatch(visualSource, /data-mesa-control="start-new-run"/);
  assert.doesNotMatch(visualSource, /data-mesa-timeline/);
  assert.match(appSource, /isVisualSimulationPage/);
  assert.match(appSource, /spare-planning-visual-mesa-page/);
  assert.match(appSource, /mission-reliability-visual-mesa-page/);
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
  const solaraPageSource = await readFile(
    new URL("../src/spare_mvp_abm/aircraft_support_v1/solara_app.py", import.meta.url),
    "utf8"
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function renderVisualizationEventStream")
  );
  const stageSource = appSource.slice(
    appSource.indexOf("function renderMesaStage"),
    appSource.indexOf("function renderMesaSidePanel")
  );

  for (const label of ["使用可用度", "出动架次率", "维修中飞机", "保障中飞机", "备件满足率"]) {
    assert.match(appSource, new RegExp(label));
  }
  const frameWrapIndex = visualSource.indexOf("solara-visualization-frame-wrap");
  const iframeIndex = visualSource.indexOf('class="solara-visualization-frame"', frameWrapIndex);
  assert.ok(frameWrapIndex > -1 && iframeIndex > frameWrapIndex, "Solara iframe should render inside its frame");
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.doesNotMatch(visualSource, /mesa-control-deck|mesa-control-status|仿真状态/);
  assert.match(visualSource, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/);
  assert.match(styleSource, /\.solara-visualization-frame-wrap[\s\S]*min-height: calc\(100vh - 190px\)/);
  assert.match(styleSource, /\.solara-visualization-frame[\s\S]*height: calc\(100vh - 235px\)/);
  const pageSource = solaraPageSource.slice(solaraPageSource.indexOf("def Page()"));
  assert.doesNotMatch(pageSource, /solara\.AppBar|solara\.AppBarTitle|APP_TITLE/);
  assert.ok(
    pageSource.indexOf("ControlPanel(model_state, inputs)") < pageSource.indexOf('classes=["sim-layout"]'),
    "Solara run controls should render above the main dashboard layout"
  );
  assert.equal((pageSource.match(/ControlPanel\(model_state, inputs\)/g) || []).length, 1);
  assert.doesNotMatch(visualSource, /mesa-status-grid/);
  assert.doesNotMatch(visualSource, /mesa-kpi-strip|mesa-view-tabs|data-mesa-timeline/);
  assert.doesNotMatch(visualSource, /renderAvailabilityCurve\(availabilityTrend\)/);
  assert.match(appSource, /飞机状态一览/);
  assert.match(appSource, /ratioFixed\(usableAircraft \/ aircraftCount\)/);
  assert.match(appSource, /ratioFixed\(assignedSorties \/ Math\.max\(1, requiredSorties\)\)/);
  assert.match(appSource, /ratioFixed\(stockedSpares \/ Math\.max\(1, state\.spares\.length\)\)/);
  assert.match(appSource, /AIRCRAFT_TREND_SERIES/);
  for (const label of ["可用飞机", "任务中", "维修中", "使用保障中"]) {
    assert.match(appSource, new RegExp(label));
  }
  assert.match(appSource, /countAircraftTrendStates\(aircraft\)/);
  assert.match(appSource, /renderAvailabilityTrendLine\(chartPoints, series\)/);
  assert.match(appSource, /renderAvailabilityYAxis\(/);
  assert.match(appSource, /availability-y-axis/);
  assert.match(appSource, /飞机数量/);
  assert.match(appSource, /availability-trend-legend/);
  assert.doesNotMatch(visualSource, /buildAvailabilityTrend\(/);
  assert.match(appSource, /frames\.slice\(0, currentIndex \+ 1\)/);
  assert.doesNotMatch(appSource, /T-\$\{4 - index\}/);
  assert.match(styleSource, /\.availability-chart \.trend-line/);
  assert.match(styleSource, /\.availability-chart circle\.current-point/);
  assert.match(styleSource, /\.availability-y-axis/);
  assert.match(styleSource, /\.availability-y-axis text/);
  assert.match(appSource, /available: "停放"/);
  assert.match(appSource, /pre_support: "使用保障"/);
  assert.match(appSource, /maintenance: "维修\/不可用"/);
  assert.match(appSource, /flying: "任务"/);
  assert.match(appSource, /repair_unavailable: "维修\/不可用"/);
  assert.match(appSource, /const actualStates = \["available", "pre_support", "flying", "repair_unavailable"\]/);
  assert.match(appSource, /function visualAircraftLaneKey/);
  assert.doesNotMatch(visualSource, /renderMesaStage\(|renderMesaSidePanel\(|renderVisualizationEventStream\(/);
  assert.doesNotMatch(visualSource, /mission-expanded|aircraft-state-board|mesa-event-window/);
  assert.match(visualSource, /solara-visualization-frame-wrap/);
  assert.match(visualSource, /Solara 可视化推演/);
});

test("Solara visual panels subscribe to Mesa controller updates", async () => {
  const solaraSource = await readFile(
    new URL("../src/spare_mvp_abm/aircraft_support_v1/solara_app.py", import.meta.url),
    "utf8"
  );
  assert.match(solaraSource, /from mesa\.visualization\.solara_viz import update_counter/);
  assert.match(solaraSource, /SOLARA_BACKEND_API_BASE_ENV/);
  assert.match(solaraSource, /ProxyHandler\(\{\}\)/);
  assert.match(solaraSource, /def _load_backend_project_json/);
  assert.match(solaraSource, /solara\.use_router\(\)/);
  assert.match(solaraSource, /parse_qs\(router\.search/);
  assert.match(solaraSource, /def _query_runtime_config/);
  assert.match(solaraSource, /"plan_steps", "steps"/);
  assert.match(solaraSource, /"plan_samples", "samples"/);
  assert.match(solaraSource, /"plan_seed", "seed"/);
  assert.match(solaraSource, /def _safe_model_inputs/);
  assert.match(solaraSource, /_safe_model_inputs\(project_id, runtime_config=runtime_config\)/);
  assert.match(solaraSource, /compile_scenario_with_gate\([\s\S]*runtime_config=runtime_config/);
  assert.match(solaraSource, /运行控制/);
  assert.match(solaraSource, /VISUAL_TAB_LABELS = \["飞机视图", "任务视图", "保障视图"\]/);
  assert.match(solaraSource, /solara\.Button\(/);
  assert.match(solaraSource, /def AircraftStage/);
  assert.match(solaraSource, /def MissionStage/);
  assert.match(solaraSource, /def SupportStage/);
  assert.doesNotMatch(solaraSource, /SolaraViz\(/);
  assert.doesNotMatch(solaraSource, /except Exception as exc:\s*fallback_reason/s);
  assert.doesNotMatch(solaraSource, /try:\s*\n\s*inputs,\s*_source\s*=\s*solara\.use_memo/s);
  assert.doesNotMatch(solaraSource, /INITIAL_INPUTS,\s*INITIAL_SOURCE\s*=\s*_model_inputs\(\)/);

  for (const panelName of ["MetricsPanel", "AircraftPanel", "EventPanel"]) {
    const start = solaraSource.indexOf(`def ${panelName}`);
    const nextPanel = solaraSource.indexOf("@solara.component", start + 1);
    const panelSource = solaraSource.slice(start, nextPanel > start ? nextPanel : undefined);
    assert.match(panelSource, /update_counter\.get\(\)/);
  }
  assert.match(solaraSource, /MetricsPanel\(model_state\.value\)/);
  assert.match(solaraSource, /AircraftStage\(model, selected_tail\)/);
  assert.match(solaraSource, /EventPanel\(model\)/);
  assert.doesNotMatch(solaraSource, /\(SourcePanel,\s*[01]\)/);
});

test("visual support view separates collapsible resource statistics from support logs", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const stateSource = await readFile(new URL("../front/aviation-support-state.mjs", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  const supportStageSource = appSource.slice(
    appSource.indexOf("function renderMesaSupportStage"),
    appSource.indexOf("function renderMesaSidePanel")
  );
  const supportPanelSource = appSource.slice(
    appSource.indexOf("function renderMesaSupportPanel"),
    appSource.indexOf("function missionProgressWidth")
  );
  const eventStreamSource = appSource.slice(
    appSource.indexOf("function renderVisualizationEventStream"),
    appSource.indexOf("function mesaTab")
  );

  assert.match(supportStageSource, /support-collapsible-panel/);
  assert.match(supportStageSource, /<details class="support-metric-panel support-collapsible-panel" open>/);
  assert.match(supportStageSource, /<summary class="section-head">/);
  assert.match(supportStageSource, /保障人员（按专业）/);
  assert.match(supportStageSource, /保障设备（按类型）/);
  assert.match(supportStageSource, /备件（按类型）/);
  assert.match(supportStageSource, /visualSupportAirportScope\(state\)/);
  assert.match(supportStageSource, /data-mesa-support-airport/);
  assert.match(supportStageSource, /supportAirportOptions/);
  assert.match(supportStageSource, /当前保障点资源/);
  assert.match(supportStageSource, /建模保障点/);
  assert.match(supportStageSource, /切换保障点查看资源/);
  assert.match(supportStageSource, /supportRowsForAirportScope/);
  assert.match(supportStageSource, /工作次数/);
  assert.match(supportStageSource, /延误次数/);
  assert.match(supportStageSource, /消耗量/);
  assert.doesNotMatch(supportStageSource, /保障设备详情清单/);
  assert.match(appSource, /let visualSupportAirportId = ""/);
  assert.match(appSource, /event\.target\.closest\("\[data-mesa-support-airport\]"\)/);
  assert.match(appSource, /currentTaskAirportId\(state, airports\)/);
  assert.match(appSource, /supportNodesForAirport\(projectJson, selectedAirport\)/);
  assert.match(appSource, /modeledSupportNodes\(projectJson\)/);
  assert.match(appSource, /supportNodeMatchesScope\(node, airport\)/);
  assert.match(appSource, /supportScopeForStateResource\(airports, state\)/);
  assert.match(appSource, /if \(orgLeafNodes\.length\) return orgLeafNodes/);
  assert.doesNotMatch(appSource, /projectJson\?\.objects\?\.supportResources/);
  assert.match(stateSource, /supportNodeId: item\.support_node_id/);
  assert.match(stateSource, /airportId: item\.airport_id/);
  assert.match(stateSource, /delayCount: number\(item\.delay_count/);
  assert.match(stateSource, /delayCount: number\(item\.delay_count \|\| item\.shortage_count/);

  assert.match(supportPanelSource, /保障作业日志/);
  assert.match(supportPanelSource, /supportPanelLogRows\(state\)/);
  assert.match(supportPanelSource, /renderSupportPanelLogRow/);
  assert.doesNotMatch(supportPanelSource, /备件库存量/);
  assert.doesNotMatch(supportPanelSource, /state\.spares\.map/);
  assert.doesNotMatch(supportPanelSource, /state\.resources\.map/);

  assert.match(eventStreamSource, /<details class="simulation-log-collapse">/);
  assert.match(eventStreamSource, /全部保障事件/);
  assert.doesNotMatch(eventStreamSource, /<details class="simulation-log-collapse" open>/);
  assert.match(styleSource, /\.support-collapsible-panel/);
  assert.match(styleSource, /\.simulation-log-collapse/);
});

test("visual aircraft panel renders equipment status summary instead of configuration tree", async () => {
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
  assert.match(aircraftPanelSource, /renderAircraftStatusSummary\(selectedAircraft, state\)/);
  assert.match(aircraftPanelSource, /装备状态/);
  assert.match(aircraftPanelSource, /当前状态/);
  assert.match(aircraftPanelSource, /累计任务时间/);
  assert.match(aircraftPanelSource, /当前保障作业/);
  assert.match(aircraftPanelSource, /故障件/);
  assert.match(aircraftPanelSource, /currentSupportJobsForAircraft\(aircraft, state\.jobs\)/);
  assert.match(aircraftPanelSource, /failedComponentsForAircraft\(aircraft\)/);
  assert.doesNotMatch(aircraftPanelSource, /renderAircraftConfigurationTree\(selectedAircraft\.failureTree, selectedAircraft\)/);
  assert.doesNotMatch(aircraftPanelSource, /装备构型树/);
  assert.doesNotMatch(aircraftPanelSource, /role="tree"/);
  assert.doesNotMatch(aircraftPanelSource, /故障传递/);
  assert.match(styleSource, /\.aircraft-status-summary/);
  assert.match(styleSource, /\.aircraft-status-row/);
});

test("visual simulation embeds Solara without demo fallback", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function renderVisualizationEventStream")
  );

  assert.doesNotMatch(appSource, /CONTRACT_BASE|127\.0\.0\.1:8521|contract_server/);
  assert.match(appSource, /createBackendApiClient\(\{ baseUrl: "\/api"/);
  assert.match(appSource, /normalizeVisualizationStateSeriesPayload\(payload, \{\s*runId,\s*artifactId: artifact\.artifact_id/);
  assert.match(replaySource, /const MODEL_FAMILY = "aircraft_support_v1"/);
  assert.match(replaySource, /model_family: requireModelFamily\(payload\.model_family\)/);
  assert.doesNotMatch(visualSource, /Solara 可视化内嵌页/);
  assert.match(visualSource, /solara-visualization-frame/);
  assert.doesNotMatch(visualSource, /推演由 Solara 内嵌页中的 Mesa 控制器直接驱动/);
  assert.doesNotMatch(visualSource, /mesa-control-deck|mesa-control-status|仿真状态/);
  assert.doesNotMatch(visualSource, /AVIATION_SUPPORT_DEMO_STATE|请启动 Lite Mesa 仿真/);
  assert.doesNotMatch(appSource, /visualizationStateSeriesFrame \|\| liveAviationState \|\| AVIATION_SUPPORT_DEMO_STATE/);
  assert.doesNotMatch(appSource, /aviationSource = "demo"/);
  assert.doesNotMatch(appSource, /loadAviationSupportState\(\)/);
  assert.match(appSource, /data-mesa-control/);
});

test("M9 state-series replay remains internal while visual page embeds Solara", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
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
  assert.doesNotMatch(appSource, /frameAt\(visualizationStateSeries/);
  assert.match(refreshSource, /await refreshVisualizationStateSeries\(runId\)/);
  assert.match(replaySource, /visualization_state_series/);
  assert.match(replaySource, /schema_version: String\(payload\.schema_version \|\| STATE_SERIES_SCHEMA_VERSION\)/);
  assert.match(visualSource, /solara-visualization-frame/);
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.doesNotMatch(visualSource, /data-mesa-timeline/);
  assert.doesNotMatch(visualSource, /data-mesa-event-stream/);
  assert.doesNotMatch(visualSource, /data-mesa-event-jump/);
  assert.match(controlHandlerSource, /nextReplayIndex\(visualizationStateSeries/);
  assert.match(controlHandlerSource, /visualizationReplayPlaying = !visualizationReplayPlaying/);
  assert.match(eventHandlerSource, /stopVisualizationReplay\(\)/);
  assert.match(eventHandlerSource, /visualizationReplayIndex = Number\(mesaEventJumpButton\.dataset\.mesaEventJump\)/);
  assert.doesNotMatch(controlSource, /loadAviationSupportState\(\)/);
});

test("visual simulation mounts the Solara iframe without an outer refresh toolbar", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function renderVisualizationEventStream")
  );

  const frameWrapIndex = visualSource.indexOf("solara-visualization-frame-wrap");
  const iframeIndex = visualSource.indexOf('class="solara-visualization-frame"', frameWrapIndex);
  assert.ok(frameWrapIndex > -1, "Solara frame should render");
  assert.ok(iframeIndex > -1, "Solara iframe should render");
  assert.ok(iframeIndex > frameWrapIndex, "Solara iframe should render inside the frame wrap");
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.doesNotMatch(visualSource, /mesa-control-deck|mesa-control-status/);
});

test("visualization event rendering uses localized copy and Chinese secondary metadata", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const solaraSource = await readFile(
    new URL("../src/spare_mvp_abm/aircraft_support_v1/solara_app.py", import.meta.url),
    "utf8"
  );
  const eventSource = appSource.slice(
    appSource.indexOf("function renderVisualizationEventStream"),
    appSource.indexOf("function mesaTab")
  );
  const logSource = appSource.slice(
    appSource.indexOf("function buildSimulationLogStream"),
    appSource.indexOf("function isStateFrameEvent")
  );
  const metricsSource = solaraSource.slice(
    solaraSource.indexOf("def _metrics_rows"),
    solaraSource.indexOf("def _frame")
  );
  const parameterSource = solaraSource.slice(
    solaraSource.indexOf("def _model_parameter_rows"),
    solaraSource.indexOf("def InformationPanel")
  );

  assert.match(eventSource, /displayEvent\.log_type/);
  assert.match(eventSource, /displayEvent\.localized_message/);
  assert.match(eventSource, /第 \$\{htmlEscape\(Number\(event\.frame_index\) \+ 1\)\} 条状态记录/);
  assert.doesNotMatch(eventSource, /displayEvent\.internal_id|内部信息|标识/);
  assert.doesNotMatch(eventSource, /<span>\$\{htmlEscape\(event\.message\)\}<\/span>/);
  assert.doesNotMatch(eventSource, /<small>frame .* step .* run /);
  assert.match(logSource, /localizeVisualizationEvent\(event\)/);
  assert.match(logSource, /event\.localized_message/);
  assert.doesNotMatch(metricsSource, /数据来源|后端项目/);
  assert.doesNotMatch(parameterSource, /项目编号|数据来源|后端项目/);
});

test("visual task surfaces keep runtime IDs in data only", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const localizationSource = await readFile(new URL("../front/solara-visualization.mjs", import.meta.url), "utf8");
  const missionRowSource = appSource.slice(
    appSource.indexOf("function renderMissionScheduleRow"),
    appSource.indexOf("function renderMesaSupportStage")
  );
  const missionLogSource = appSource.slice(
    appSource.indexOf("function deriveMissionLogs"),
    appSource.indexOf("function deriveSupportJobLogs")
  );
  const supportDetailSource = appSource.slice(
    appSource.indexOf("function renderAircraftSupportJobStatus"),
    appSource.indexOf("function renderAircraftFailureStatus")
  );

  assert.match(appSource, /function visualMissionTaskName\(mission = \{\}\)/);
  assert.match(appSource, /return "未命名任务"/);
  assert.match(appSource, /function visualMissionBusinessContext/);
  assert.doesNotMatch(missionRowSource, /row\.id/);
  assert.doesNotMatch(missionLogSource, /任务标识|内部标识/);
  assert.doesNotMatch(supportDetailSource, /job\.id|内部标识/);
  assert.doesNotMatch(localizationSource, /任务标识|作业标识|内部标识/);
  assert.match(localizationSource, /internal_id: internalId/);
});

test("M9.2 visual simulation keeps state stream support behind the simplified replay flow", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const replaySource = await readFile(new URL("../front/state-series-replay.mjs", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
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

test("visual simulation enters the Solara Mesa page without a replay list", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const visualSource = appSource.slice(
    appSource.indexOf("function renderVisualSimulation(page)"),
    appSource.indexOf("function visualizationStreamEventClass")
  );

  assert.doesNotMatch(appSource, /function renderVisualizationRunOptions/);
  assert.doesNotMatch(appSource, /data-mesa-run-select/);
  assert.doesNotMatch(visualSource, /选择回放/);
  assert.match(visualSource, /renderExperimentPlanContextDropdown\(page\)/);
  assert.doesNotMatch(visualSource, /data-mesa-run-select|选择回放/);
  assert.doesNotMatch(visualSource, /data-mesa-control="reload-solara"|刷新推演|visual-frame-toolbar/);
  assert.doesNotMatch(visualSource, /启动回放|暂停回放|启动新仿真/);
  for (const action of ["play", "start-new-run", "refresh-runs", "load-replay", "subscribe-run", "stop-subscription", "step", "reset"]) {
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

test("visual simulation keeps Solara iframe without a visible run picker", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const refreshRunListSource = appSource.slice(
    appSource.indexOf("async function refreshVisualizationRunList"),
    appSource.indexOf("function ensureVisualizationRunListLoaded")
  );

  assert.doesNotMatch(appSource, /function renderVisualizationRunOptions/);
  assert.doesNotMatch(appSource, /data-mesa-run-select/);
  assert.match(appSource, /solara-visualization-frame/);
  assert.match(appSource, /正在准备实验方案数据/);
  assert.match(refreshRunListSource, /M9 当前回放已同步/);
  assert.doesNotMatch(refreshRunListSource, /run 列表已刷新/);
});

test("visual simulation syncs automatically without a reload action", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const controlHandlerSource = appSource.slice(
    appSource.indexOf("async function handleMesaControl"),
    appSource.indexOf("async function loadAviationSupportState")
  );
  const syncSource = appSource.slice(
    appSource.indexOf("function visualSimulationProjectSyncKey"),
    appSource.indexOf("function visualizationStreamEventClass")
  );
  const playSource = controlHandlerSource.slice(
    controlHandlerSource.indexOf('if (action === "play")'),
    controlHandlerSource.indexOf('if (["play"')
  );

  assert.doesNotMatch(appSource, /const mesaRunSelect = event\.target\.closest/);
  assert.doesNotMatch(controlHandlerSource, /reload-solara/);
  assert.match(syncSource, /syncSelectedProjectJsonForSolaraVisualization\(\{/);
  assert.match(syncSource, /render\(\)/);
  assert.doesNotMatch(syncSource, /visualizationReplayPlaying = true|startVisualizationReplay\(\)|startLiteMesaVisualizationThroughApi\(\)/);
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
    spec: await readFile(new URL("../docs/archive/deprecated/superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md", import.meta.url), "utf8")
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
    spec: await readFile(new URL("../docs/archive/deprecated/superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md", import.meta.url), "utf8")
  };
  const combined = Object.values(docs).join("\n");

  assert.match(combined, /components\[\]\.failureDistribution[^。]*(behavior-driving|行为驱动)/);
  assert.match(combined, /supportNodes\[\]\.transportPolicies[^。]*(behavior-driving|行为驱动)/);
  assert.doesNotMatch(combined, /components\[\]\.failureDistribution[^。]*(当前只编译进入 payload|只编译进入 payload|留给 M9\.7\.4)/);
  assert.doesNotMatch(combined, /supportNodes\[\]\.transportPolicies[^。]*(当前只编译进入 payload|只编译进入 payload|留给 M9\.7\.4)/);
  assert.doesNotMatch(combined, /supportOrganization[^。]*fail closed/);
});

test("five result analysis pages share backend XLSX export without a Monte Carlo entry", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const apiSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");
  const aircraftSource = await readFile(new URL("../front/aircraft-mission-reliability.mjs", import.meta.url), "utf8");
  const exportSource = appSource.slice(
    appSource.indexOf("function analysisXlsxState"),
    appSource.indexOf("function renderAircraftMissionReliabilityAnalysis")
  );
  const monteCarloSource = appSource.slice(
    appSource.indexOf("function renderLiteMesaMonteCarloAnalysis(page)"),
    appSource.indexOf("function normalizeLiteMesaMonteCarloResult")
  );

  assert.match(appSource, /data-analysis-xlsx-export/);
  assert.match(exportSource, /result\?\.status !== "session_complete"/);
  assert.match(exportSource, /state\.status === "exporting"/);
  assert.match(exportSource, /exportAnalysisXlsx\(payload\)/);
  assert.match(exportSource, /visibleSpareShortfallRows\(result\)/);
  assert.match(exportSource, /visibleCarryListRows\(result\)/);
  assert.match(exportSource, /visibleDowntimeAnalysisSnapshot\(result\)/);
  assert.match(exportSource, /result\.resultFields \|\| normalizeTaskReliabilityResultFields\(result\)/);
  assert.match(exportSource, /downtimeEventDisplayRow\(event\)/);
  assert.match(exportSource, /并行核心数配置异常/);
  assert.doesNotMatch(exportSource, /\[analysisSettingExportLabel\(key\), value \?\? ""\]/);
  assert.match(exportSource, /导出失败：/);
  assert.match(apiSource, /path: "\/analysis-results\/export-xlsx"[\s\S]*responseType: "download"/);
  assert.doesNotMatch(monteCarloSource, /data-analysis-xlsx-export|exportAnalysisXlsx/);
  assert.doesNotMatch(aircraftSource, /aircraftMissionReliabilityResultToXlsx|createStoredZip|xlsxRow/);
});
