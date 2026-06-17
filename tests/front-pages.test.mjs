import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const appSource = readFileSync(new URL("../front/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../front/index.html", import.meta.url), "utf8");

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

test("front index loads modeling contracts before the app script", () => {
	assert.match(
		indexSource,
		/<script src="modeling-contract\.js"[^>]*><\/script>\s*<script src="project-json-contract\.js"[^>]*><\/script>\s*<script src="app\.js"[^>]*><\/script>/
	);
});

test("front index reports critical script load failures instead of staying on loading", () => {
	assert.match(indexSource, /window\.FRONT_BOOTSTRAP/);
	assert.match(indexSource, /data-critical-script="modeling-contract"/);
	assert.match(indexSource, /data-critical-script="project-json-contract"/);
	assert.match(indexSource, /data-critical-script="app"/);
	assert.match(indexSource, /前端资源加载失败/);
});

test("front app marks the bootstrap as ready after rendering", () => {
	assert.match(appSource, /window\.FRONT_BOOTSTRAP\.markReady\(\)/);
});

test("modeling detail input updates state without rerendering the full app on each keystroke", () => {
	const inputListener = appSource.slice(
		appSource.indexOf('document.addEventListener("input"'),
		appSource.indexOf('document.addEventListener("wheel"')
	);
	assert.match(inputListener, /updateModelingField\(modelingField\)/);
	assert.doesNotMatch(inputListener, /render\(\)/);
});

test("modeling list fields preserve structured JSON arrays instead of flattening objects", () => {
	assert.match(appSource, /function fieldValueToText/);
	assert.match(appSource, /function parseModelingFieldValue/);
	assert.match(appSource, /JSON\.stringify\(value, null, 2\)/);
	assert.match(appSource, /JSON\.parse\(value\)/);
	assert.doesNotMatch(appSource, /fieldMeta\.kind === "list" \|\| fieldMeta\.kind === "referenceList"\) return Array\.isArray\(value\) \? value\.join/);
});
