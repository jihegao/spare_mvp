import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "../front/feature-catalog.mjs";

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 49);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 49);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 24);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 25);
  for (const label of ["装备可靠性框图建模", "可视化结果展示", "飞机转场携行清单分析", "任务可靠度评估", "停机因素分析"]) {
    assert.ok(FEATURE_PAGES.some((page) => page.name === label), label);
  }
});

test("each feature page has page template metadata and ontology context", () => {
  for (const page of FEATURE_PAGES) {
    assert.ok(page.id);
    assert.ok(page.module);
    assert.ok(page.secondary);
    assert.ok(page.tertiary);
    assert.ok(page.name);
    assert.ok(page.component);
    assert.ok(page.dataObjects.length > 0, page.id);
    assert.ok(page.ontology.nodes.length >= 4, page.id);
    assert.ok(page.ontology.edges.length >= 3, page.id);
  }
});

test("feature grouping preserves four-level navigation hierarchy", () => {
  const grouped = groupFeaturePages(FEATURE_PAGES);
  assert.ok(grouped["备件规划评估模块"]["仿真建模"]["任务建模"].length >= 4);
  assert.ok(grouped["任务可靠度评估模块"]["仿真建模"]["装备建模"].some((page) => page.name === "装备可靠性框图建模"));
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
});

test("frontend shell mounts a feature workbench rather than six static summary views", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  assert.match(html, /id="app"/);
  assert.match(html, /feature-workbench/);
});
