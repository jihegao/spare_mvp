import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const schemaPath = new URL("../docs/modeling-json-schema.md", import.meta.url);

function schemaDoc() {
	assert.ok(existsSync(schemaPath), "docs/modeling-json-schema.md should exist");
	return readFileSync(schemaPath, "utf8");
}

test("modeling schema document covers the standard MVP modeling objects", () => {
	const doc = schemaDoc();
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
		assert.match(doc, new RegExp(`### \\\`${objectName}\\\``), `missing ${objectName}`);
	}
});

test("modeling schema document preserves current JSON sheet and historical environment boundaries", () => {
	const doc = schemaDoc();

	assert.match(doc, /`nonSupportStations`/);
	assert.match(doc, /当前 `data_new\.json` 的真实 key 是 `nonSupportStations`/);
	assert.match(doc, /`supportStationCodes`、`nonSupportStationCodes` 是历史工作簿或后续环境配置项/);
	assert.doesNotMatch(doc, /\| `nonSupportStationCodes` \| 当前 JSON sheet \|/);
	assert.doesNotMatch(doc, /\| `supportStationCodes` \| 当前 JSON sheet \|/);
});

test("modeling schema document marks RBD relationship fields as future fields", () => {
	const doc = schemaDoc();

	assert.match(doc, /当前 `equipmentTree` 字段：`nodeLevel`、`nodeName`、`model`、`quantity`、`isLru`/);
	assert.match(doc, /待补字段：`parentId`、`relationType`、`successThreshold`/);
	assert.match(doc, /不得把 `parentId` 写成当前 `equipmentTree` 已有字段/);
});

test("modeling schema document includes field-level validation rules", () => {
	const doc = schemaDoc();
	const requiredRules = [
		"编号唯一",
		"名称必填",
		"数量非负",
		"概率范围 0~1 或 0%~100%",
		"引用对象必须存在",
		"被引用对象不可直接删除",
		"时间字段必须声明单位",
		"数字字符串导入时转数字"
	];

	for (const rule of requiredRules) {
		assert.match(doc, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing rule: ${rule}`);
	}
	assert.match(doc, /\| `"null"` 字符串\/空字符串按语义转空值 \|/);
});

test("modeling schema document keeps validation table markdown intact", () => {
	const doc = schemaDoc();

	assert.match(doc, /\| `"null"` 字符串\/空字符串按语义转空值 \|/);
});

test("modeling schema document specifies raw-to-normalized conversions for split strings and numeric booleans", () => {
	const doc = schemaDoc();

	assert.match(doc, /`basicUsageUnits\.memberNos` raw 为 `、` 分隔字符串，normalized 为 `string\[\]`/);
	assert.match(doc, /`supportStaff\.serviceAircraft` raw 为 `,` 分隔字符串，normalized 为 `string\[\]`/);
	assert.match(doc, /`equipmentTree\.isLru`、`equipmentTree\.isDetectable` raw 为 `0\/1`，normalized 为 `boolean`/);
});

test("modeling schema document allows service aircraft references through asset types, top equipment nodes, or aliases", () => {
	const doc = schemaDoc();

	assert.match(doc, /逐项引用 `equipmentAssets\.aircraftType`、`equipmentTree` 顶层 `nodeName` 或后续装备类型\/别名字典/);
	assert.match(doc, /引用 `equipmentAssets\.aircraftType`、`equipmentTree` 顶层 `nodeName` 或后续装备类型\/别名字典/);
	assert.doesNotMatch(doc, /逐项引用 `equipmentAssets\.aircraftType`。/);
});

test("modeling schema document states generated ids for current sheets without raw ids", () => {
	const doc = schemaDoc();

	assert.match(doc, /normalized `id` 应使用 `sourceSheet:rawId`/);
	assert.match(doc, /`basicUsageUnits` 没有 raw `id`，adapter 生成 `missionProfiles\.id`/);
	assert.match(doc, /`stationFacilityMatrix` 没有 raw `id`，adapter 生成 `supportResources\.id`/);
	assert.match(doc, /`constraints` 没有 raw `id`，adapter 生成 `metricPlans\.id`/);
});

test("modeling schema document fixes raw time units and normalized target fields", () => {
	const doc = schemaDoc();

	assert.match(doc, /`basicTasks\.duration` raw 单位为分钟，normalized 为 `durationMinutes`/);
	assert.match(doc, /`basicTasks\.prepTime` raw 单位为分钟，normalized 为 `prepTimeMinutes`/);
	assert.match(doc, /`basicTasks\.cancelTime` raw 单位为分钟，normalized 为 `cancelTimeMinutes`/);
	assert.doesNotMatch(doc, /若来源为分钟需在 adapter 中声明/);
});
