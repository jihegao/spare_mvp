import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const appSource = readFileSync(new URL("../front/app.js", import.meta.url), "utf8");

const expectedPages = [
	["#/spare-planning/modeling", "备件规划仿真建模"],
	["#/spare-planning/experiment", "备件规划仿真实验"],
	["#/spare-planning/shortfall", "备件短板分析"],
	["#/spare-planning/carry-list", "转场携行清单分析"],
	["#/mission-reliability/modeling", "任务可靠度仿真建模"],
	["#/mission-reliability/experiment", "任务可靠度仿真实验"],
	["#/mission-reliability/completion", "任务完成度评估"],
	["#/mission-reliability/downtime", "停机因素分析"],
	["#/system-support/run-management", "运行管理和产物检查"]
];

test("front app exposes the MVP pages mapped from the full CSCI scope", () => {
	for (const [route, title] of expectedPages) {
		assert.match(appSource, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing route ${route}`);
		assert.match(appSource, new RegExp(title), `missing title ${title}`);
	}
});

test("front app includes the system support module from CSCI 1.4.2", () => {
	assert.match(appSource, /系统运行支持模块/);
	assert.match(appSource, /长周期大样本运行优化/);
});
