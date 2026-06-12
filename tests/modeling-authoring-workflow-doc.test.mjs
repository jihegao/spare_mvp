import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflowPath = new URL("../docs/modeling-json-authoring-workflow.md", import.meta.url);

function workflowDoc() {
	assert.ok(existsSync(workflowPath), "docs/modeling-json-authoring-workflow.md should exist");
	return readFileSync(workflowPath, "utf8");
}

test("modeling authoring workflow defines full project JSON authoring capabilities", () => {
	const doc = workflowDoc();
	const capabilities = [
		"创建",
		"编辑",
		"删除",
		"校验",
		"JSON 预览",
		"导入",
		"导出",
		"脏状态",
		"保存状态",
		"错误状态"
	];

	for (const capability of capabilities) {
		assert.match(doc, new RegExp(capability), `missing capability: ${capability}`);
	}
});

test("modeling authoring workflow maps both modeling pages to one shared project JSON", () => {
	const doc = workflowDoc();

	assert.match(doc, /备件规划仿真建模页和任务可靠度仿真建模页共享同一个项目 JSON/);
	assert.match(doc, /不是两个互不相通的项目数据/);
	assert.match(doc, /备件规划页/);
	assert.match(doc, /任务可靠度页/);
});

test("modeling authoring workflow covers the seven standard MVP modeling objects", () => {
	const doc = workflowDoc();
	const objects = [
		"missionProfiles",
		"equipmentAssets",
		"equipmentTree",
		"supportResources",
		"inventoryResources",
		"supportActivities",
		"metricPlans"
	];

	for (const objectName of objects) {
		assert.match(doc, new RegExp(`\\\`${objectName}\\\``), `missing ${objectName}`);
	}
});

test("modeling authoring workflow keeps implementation scope out of PR 14", () => {
	const doc = workflowDoc();

	assert.match(doc, /PR #14 不实现前端状态模型/);
	assert.match(doc, /PR #14 不实现可编辑 UI/);
	assert.match(doc, /PR #14 不实现后端 API/);
	assert.doesNotMatch(doc, /只读展示/);
	assert.doesNotMatch(doc, /局部最小表单/);
});
