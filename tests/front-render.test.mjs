import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";

const contractSource = readFileSync(new URL("../front/modeling-contract.js", import.meta.url), "utf8");
const projectContractSource = readFileSync(new URL("../front/project-json-contract.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../front/app.js", import.meta.url), "utf8");

const routes = [
	["#/spare-planning/modeling", "备件规划仿真建模", "任务建模"],
	["#/spare-planning/experiment", "备件规划仿真实验", "蒙特卡洛实验"],
	["#/spare-planning/shortfall", "备件短板分析", "短板分析结论"],
	["#/spare-planning/carry-list", "转场携行清单分析", "优化条件"],
	["#/mission-reliability/modeling", "任务可靠度仿真建模", "装备可靠性框图"],
	["#/mission-reliability/experiment", "任务可靠度仿真实验", "可视化推演"],
	["#/mission-reliability/completion", "任务完成度评估", "波次任务成功概率趋势"],
	["#/mission-reliability/downtime", "停机因素分析", "观察指标"],
	["#/system-support/run-management", "运行管理和产物检查", "长周期大样本运行优化"]
];

function createHarness(hash) {
	const elements = {
		app: { innerHTML: "" },
		toast: {
			textContent: "",
			classList: { add() {}, remove() {} }
		}
	};
	const listeners = {};
	const context = createContext({
		window: {
			location: { hash },
			addEventListener(type, handler) {
				listeners[type] = handler;
			},
			clearTimeout() {},
			setTimeout() {
				return 0;
			}
		},
		document: {
			getElementById(id) {
				return elements[id];
			},
			addEventListener(type, handler) {
				listeners[type] = handler;
			}
		},
		console
	});
	context.globalThis = context;
	new Script(contractSource).runInContext(context);
	new Script(projectContractSource).runInContext(context);
	new Script(appSource).runInContext(context);
	return {
		context,
		elements,
		listeners,
		html() {
			return elements.app.innerHTML;
		},
		inputWithClosest(selector, node) {
			listeners.input({
				target: {
					closest(requestedSelector) {
						return requestedSelector === selector ? node : null;
					}
				}
			});
		},
		clickWithClosest(selector, node) {
			listeners.click({
				preventDefault() {},
				target: {
					closest(requestedSelector) {
						return requestedSelector === selector ? node : null;
					}
				}
			});
		}
	};
}

function renderAt(hash) {
	return createHarness(hash).html();
}

test("app script reports a clear error when the modeling contract is missing", () => {
	const context = createContext({
		window: {
			location: { hash: "" },
			addEventListener() {},
			clearTimeout() {},
			setTimeout() {
				return 0;
			}
		},
		document: {
			getElementById() {
				return { innerHTML: "" };
			},
			addEventListener() {}
		},
		console
	});
	context.globalThis = context;
	assert.throws(
		() => new Script(appSource).runInContext(context),
		/Missing MODELING_CONTRACT\. Load modeling-contract\.js before app\.js\./
	);
});

test("home renders the three CSCI modules and nine function entries", () => {
	const html = renderAt("");
	assert.match(html, /备件规划评估模块/);
	assert.match(html, /任务可靠度评估模块/);
	assert.match(html, /系统运行支持模块/);
	for (const [, title] of routes) {
		assert.match(html, new RegExp(title));
	}
});

test("each CSCI function route renders its expected page content", () => {
	for (const [route, title, marker] of routes) {
		const html = renderAt(route);
		assert.match(html, new RegExp(title), `${route} missing title`);
		assert.match(html, new RegExp(marker), `${route} missing marker`);
		assert.match(html, /返回导航/, `${route} missing back navigation`);
	}
});

test("modeling pages expose editable authoring controls for the shared project JSON", () => {
	const harness = createHarness("#/spare-planning/modeling");
	const spareHtml = harness.html();

	assert.match(spareHtml, /项目 JSON 作者界面/);
	assert.match(spareHtml, /对象列表/);
	assert.match(spareHtml, /详情编辑/);
	assert.match(spareHtml, /JSON 预览/);
	assert.match(spareHtml, /导入 JSON/);
	assert.match(spareHtml, /导出 JSON/);
	for (const label of ["任务建模", "装备资产", "装备组成", "保障组织与资源", "备件与弹药", "保障活动", "指标方案"]) {
		assert.match(spareHtml, new RegExp(label), `missing authoring object ${label}`);
	}
	assert.match(spareHtml, /data-model-field="taskName"/);

	harness.clickWithClosest("[data-action='set-modeling-table']", {
		dataset: {
			moduleId: "spare-planning",
			tableName: "equipmentAssets"
		}
	});
	assert.match(harness.html(), /data-model-field="aircraftCode"/);

	const missionHarness = createHarness("#/mission-reliability/modeling");
	const missionHtml = missionHarness.html();
	assert.match(missionHtml, /任务可靠度建模视图/);
	assert.match(missionHtml, /故障模型/);
	assert.match(missionHtml, /装备可靠性框图/);
	missionHarness.clickWithClosest("[data-action='set-modeling-table']", {
		dataset: {
			moduleId: "mission-reliability",
			tableName: "equipmentTree"
		}
	});
	assert.match(missionHarness.html(), /data-model-field="lruFailureRate"/);
	assert.match(missionHtml, /parentId/);
	assert.match(missionHtml, /relationType/);
});

test("editing one modeling page updates the shared project JSON seen by the other page", () => {
	const harness = createHarness("#/spare-planning/modeling");
	assert.match(harness.html(), /对海突击任务A/);

	harness.inputWithClosest("[data-model-field]", {
		value: "更新后的跨页面任务",
		dataset: {
			tableName: "missionProfiles",
			recordId: "mission-1",
			fieldName: "taskName"
		}
	});

	assert.match(harness.html(), /更新后的跨页面任务/);
	assert.match(harness.html(), /有未保存修改/);
	assert.match(harness.html(), /&quot;taskName&quot;: &quot;更新后的跨页面任务&quot;/);

	harness.context.window.location.hash = "#/mission-reliability/modeling";
	harness.listeners.hashchange();

	assert.match(harness.html(), /任务可靠度建模视图/);
	assert.match(harness.html(), /更新后的跨页面任务/);
	assert.match(harness.html(), /共享项目 JSON/);
});

test("modeling authoring controls create records, import drafts, and expose export state", () => {
	const harness = createHarness("#/spare-planning/modeling");

	harness.clickWithClosest("[data-action='set-modeling-table']", {
		dataset: {
			moduleId: "spare-planning",
			tableName: "inventoryResources"
		}
	});
	harness.clickWithClosest("[data-action='add-modeling-record']", {
		dataset: {
			tableName: "inventoryResources"
		}
	});
	assert.match(harness.html(), /新增备件/);
	assert.match(harness.html(), /inventoryResources:draft/);

	const imported = {
		projectId: "imported-ui",
		projectName: "页面导入项目",
		tables: {
			missionProfiles: [],
			equipmentAssets: [],
			equipmentTree: [],
			supportResources: [],
			inventoryResources: [{
				id: "spare-imported",
				resourceType: "sparePart",
				name: "导入备件",
				model: "IMP-1",
				count: 3
			}],
			supportActivities: [],
			metricPlans: []
		}
	};

	harness.inputWithClosest("[data-modeling-import]", {
		value: JSON.stringify(imported),
		dataset: {}
	});
	harness.clickWithClosest("[data-action='import-modeling-json']", {
		dataset: {}
	});
	assert.match(harness.html(), /页面导入项目/);
	assert.match(harness.html(), /导入完成/);
	assert.match(harness.html(), /导入备件/);

	harness.clickWithClosest("[data-action='export-modeling-json']", {
		dataset: {}
	});
	assert.match(harness.html(), /imported-ui-mvp-modeling-v0\.1\.json/);
	assert.match(harness.html(), /可运行 JSON/);
});

test("modeling pages render JSON-aligned field groups without the old scene placeholder", () => {
	const spareHtml = renderAt("#/spare-planning/modeling");
	assert.match(spareHtml, /data_new\.json/);
	assert.match(spareHtml, /basicTasks/);
	assert.match(spareHtml, /spareParts/);
	assert.match(spareHtml, /nonSupportStations/);
	assert.match(spareHtml, /usageSupportActivities/);
	assert.match(spareHtml, /optimizationTargets/);
	assert.match(spareHtml, /场景\/舰船\/布列不进入建模表单/);
	assert.match(spareHtml, /历史工作簿\/后续环境配置项/);
	assert.doesNotMatch(spareHtml, /<label>示例场景<\/label>/);
	assert.doesNotMatch(spareHtml, /601 舰载机连续出动场景/);

	const missionHtml = renderAt("#/mission-reliability/modeling");
	assert.match(missionHtml, /equipmentTree/);
	assert.match(missionHtml, /lruFailureRate/);
	assert.match(missionHtml, /mtbcf/);
	assert.match(missionHtml, /mttr/);
	assert.match(missionHtml, /可靠性框图/);
	assert.match(missionHtml, /待补 parentId\/串并联关系/);
	const rbdCard = missionHtml.match(/<h4>装备可靠性框图<\/h4>[\s\S]*?<\/section>/)?.[0] || "";
	assert.match(rbdCard, /<span>待补字段<\/span>/);
	assert.match(rbdCard, /parentId/);
	assert.match(rbdCard, /relationType/);
	assert.doesNotMatch(rbdCard, /<span class="field-chip">parentId<\/span>/);
	assert.doesNotMatch(missionHtml, /<label>示例场景<\/label>/);
	assert.doesNotMatch(missionHtml, /601 舰载机连续出动场景/);
});
