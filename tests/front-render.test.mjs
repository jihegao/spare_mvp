import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";

const contractSource = readFileSync(new URL("../front/modeling-contract.js", import.meta.url), "utf8");
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

function renderAt(hash) {
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
	new Script(appSource).runInContext(context);
	return elements.app.innerHTML;
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
