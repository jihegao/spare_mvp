import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "../front/feature-catalog.mjs";
import { buildOntologyContext, PROJECT_ONTOLOGY, PROJECT_ONTOLOGY_PLAYGROUND } from "../front/ontology-context.mjs";

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 49);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 49);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 24);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 25);
  for (const label of ["装备可靠性框图建模", "可视化结果展示", "蒙特卡洛实验结果", "飞机转场携行清单分析", "任务可靠度评估", "停机因素分析"]) {
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
  assert.ok(grouped["备件规划评估模块"]["仿真建模"]["任务建模"].length >= 4);
  assert.ok(grouped["任务可靠度评估模块"]["仿真建模"]["装备建模"].some((page) => page.name === "装备可靠性框图建模"));
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
  assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["结果分析"]), ["蒙特卡洛实验结果", "备件短板分析", "飞机转场携行清单分析"]);
  assert.deepEqual(grouped["备件规划评估模块"]["结果分析"]["备件短板分析"].map((page) => page.name), ["备件短板分析"]);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案创建"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案编辑"), false);
  assert.equal(getFeaturePageById("spare-planning-experiment-create").name, "方案编辑");
  assert.equal(getFeaturePageById("spare-planning-experiment-edit").name, "方案编辑");
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
});

test("scheme list is the post-login landing page and plan name links back to it", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const DEFAULT_FEATURE_ID = "spare-planning-experiment-plan-list"/);
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
  assert.match(appSource, /保障资源建模/);
  assert.match(appSource, /使用保障活动建模/);
  assert.match(appSource, /预防性维修活动建模/);
  assert.match(appSource, /修复性维修活动建模/);
  assert.match(appSource, /保障活动节点网络图/);
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
  assert.match(appSource, /let monteCarloResult = runMonteCarlo\(scenario\)/);
  assert.match(appSource, /id="mc-samples"[^>]*data-path="experiment\.samples"/);
  assert.match(appSource, /monteCarloResult = runMonteCarlo\(scenario\)/);
});

test("monte carlo sweep inputs update scenario arrays and rerun grouped results", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /data-mc-array-path="monteCarlo\.failureRates"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.spareMultipliers"/);
  assert.match(appSource, /data-mc-array-path="monteCarlo\.supportCapacities"/);
  assert.match(appSource, /const mcArrayInput = event\.target\.closest\("\[data-mc-array-path\]"\)/);
  assert.match(appSource, /setPath\(scenario, mcArrayInput\.dataset\.mcArrayPath, parseNumberList\(mcArrayInput\.value\)\)/);
  assert.match(appSource, /function parseNumberList/);
  assert.match(appSource, /monteCarloResult = runMonteCarlo\(scenario\)/);
});

test("monte carlo experiment page is a launch-only parameter form and returns to running plan list", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../front/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /class="mc-workbench"/);
  assert.match(appSource, /蒙特卡洛实验参数配置/);
  assert.match(appSource, /选择仿真实验/);
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

test("monte carlo evaluation result is rendered in result analysis page", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function renderMonteCarloResults/);
  assert.match(appSource, /蒙特卡洛评估结果/);
  assert.match(appSource, /蒙特卡洛评估值/);
  assert.match(appSource, /目标值/);
  assert.match(appSource, /mc-result-cards/);
  assert.match(appSource, /mc-evaluation-table/);
});

test("project ontology covers modeling objects experiments and computation artifacts", () => {
  const groups = new Set(PROJECT_ONTOLOGY.nodes.map((node) => node.group));
  assert.ok(groups.has("modeling-object"));
  assert.ok(groups.has("simulation-experiment"));
  assert.ok(groups.has("computation-artifact"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "monte-carlo-config"));
  assert.ok(PROJECT_ONTOLOGY.nodes.some((node) => node.id === "metric-time-series"));
  assert.ok(PROJECT_ONTOLOGY.edges.some((edge) => edge.from === "monte-carlo-config" && edge.to === "simulation-run"));
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

test("modeling object layer expands internal scenario task unit and equipment relations", () => {
  const nodeIds = new Set(PROJECT_ONTOLOGY.nodes.map((node) => node.id));
  for (const id of [
    "airport",
    "mission-area",
    "task",
    "daily-profile",
    "long-cycle-profile",
    "aircraft-model",
    "aircraft-quantity",
    "equipment-system",
    "analysis-diagram",
    "component-parent",
    "lru-flag"
  ]) {
    assert.ok(nodeIds.has(id), id);
  }

  const edgeKeys = new Set(PROJECT_ONTOLOGY.edges.map((edge) => `${edge.from}:${edge.label}:${edge.to}`));
  for (const key of [
    "built-in-scenario:包含:airport",
    "built-in-scenario:包含:mission-area",
    "task:包含:basic-mission",
    "task:包含:daily-profile",
    "task:包含:long-cycle-profile",
    "daily-profile:包含:basic-mission",
    "long-cycle-profile:由N个日剖面组成:daily-profile",
    "basic-mission:要求:aircraft-model",
    "basic-mission:要求:aircraft-quantity",
    "combat-unit:包含:aircraft-model",
    "combat-unit:包含:aircraft-quantity",
    "equipment:包含:equipment-system",
    "equipment-system:包含:component",
    "component:具有上级节点:component-parent",
    "component:标记:lru-flag"
  ]) {
    assert.ok(edgeKeys.has(key), key);
  }
});

test("modeling object nodes are laid out as a two-dimensional layer", () => {
  const modelingPositions = PROJECT_ONTOLOGY.nodes
    .filter((node) => node.group === "modeling-object")
    .map((node) => node.layout)
    .filter(Boolean);
  assert.ok(new Set(modelingPositions.map((position) => position.x)).size >= 3);
  assert.ok(new Set(modelingPositions.map((position) => position.y)).size >= 3);
});

test("feature pages can build ontology focus contexts", () => {
  const page = getFeaturePageById("spare-planning-monte-carlo-config");
  const context = buildOntologyContext(page);
  assert.ok(context.focusNodeIds.includes("monte-carlo-config"));
  assert.ok(context.nodes.length >= 4);
  assert.ok(context.edges.length >= 3);
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
  assert.match(appSource, /renderOntologySvg\(PROJECT_ONTOLOGY/);
  assert.match(appSource, /isVisualSimulationPage/);
  assert.match(appSource, /if \(isVisualSimulationPage\(page\)\) \{\n    return `<div>\$\{breadcrumb\}<\/div>`;\n  \}/);
  assert.doesNotMatch(appSource, /可视化实验启动与停止<\/h2>/);
});
