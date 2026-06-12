import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

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
	new Script(appSource).runInContext(context);
	return elements.app.innerHTML;
}

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
