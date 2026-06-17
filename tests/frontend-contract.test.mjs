import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("frontend exposes required prototype views", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  for (const id of ["modeling", "reliability", "gantt", "simulation", "monte-carlo", "analysis"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const label of ["前端建模", "装备可靠性框图", "保障活动甘特图", "可视化仿真模型", "蒙特卡洛实验", "结果分析"]) {
    assert.ok(html.includes(label), label);
  }
});

test("modeling form includes design-aligned fields", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  for (const field of [
    "missionProfile.profileType",
    "missionProfile.repeatCycleHours",
    "basicMission.successPoint",
    "basicMission.minRequiredSorties",
    "equipment.model",
    "equipment.quantity",
    "supportNodes.0.personnelCapacity",
    "supportNodes.0.equipmentCapacity",
    "supportNodes.0.inventory.发动机备件",
    "failureRate"
  ]) {
    assert.ok(html.includes(`name="${field}"`), field);
  }
});

test("result analysis sections cover both modules", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  for (const label of ["备件短板分析", "飞机转场携行清单", "飞机任务可靠性分析", "停机因素分析"]) {
    assert.ok(html.includes(label), label);
  }
});
