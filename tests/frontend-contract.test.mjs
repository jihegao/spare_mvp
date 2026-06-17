import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "../front/feature-catalog.mjs";

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 47);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 47);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 23);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 24);
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
  assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["仿真实验方案管理"]);
  assert.deepEqual(Object.keys(grouped["备件规划评估模块"]["结果分析"]), ["蒙特卡洛实验结果", "备件短板分析", "飞机转场携行清单分析"]);
  assert.deepEqual(grouped["备件规划评估模块"]["结果分析"]["备件短板分析"].map((page) => page.name), ["备件短板分析"]);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案创建"), false);
  assert.equal(FEATURE_PAGES.some((page) => page.name === "仿真实验方案编辑"), false);
  assert.equal(getFeaturePageById("spare-planning-experiment-create").name, "仿真实验方案管理");
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
});

test("frontend shell mounts a feature workbench rather than six static summary views", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  assert.match(html, /id="app"/);
  assert.match(html, /feature-workbench/);
});

test("frontend source omits removed page-side context panels", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /Ontology 上下文/);
  assert.doesNotMatch(appSource, /校验与输出/);
  assert.doesNotMatch(appSource, /写入对象/);
  assert.doesNotMatch(appSource, /输出联动/);
  assert.match(appSource, /aria-label="功能导航"/);
  assert.match(appSource, /aria-label="四级功能入口"/);
});

test("tertiary sidebar entries navigate directly and fourth-level navigation is not duplicated", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /class="nav-tertiary-link/);
  assert.doesNotMatch(appSource, /进入\$\{tertiaryName\}/);
  assert.doesNotMatch(appSource, /compact-tabs/);
  assert.doesNotMatch(appSource, /aria-label="同组四级功能"/);
});

test("topbar omits run and export actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /运行单次仿真/);
  assert.doesNotMatch(appSource, /运行 Monte Carlo/);
  assert.doesNotMatch(appSource, /导出方案 JSON/);
  assert.doesNotMatch(appSource, /data-action/);
  assert.doesNotMatch(appSource, /downloadJson/);
});

test("monte carlo configuration drives the displayed result sample count", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario, \{ samples: 4 \}\)/);
  assert.match(appSource, /let monteCarloResult = runMonteCarlo\(scenario\)/);
  assert.match(appSource, /id="mc-samples"[^>]*data-path="experiment\.samples"/);
  assert.match(appSource, /monteCarloResult = runMonteCarlo\(scenario\)/);
});
