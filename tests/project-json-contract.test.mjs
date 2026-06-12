import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import projectJsonContract from "../front/project-json-contract.js";

const {
	MODELING_OBJECT_METADATA,
	PROJECT_JSON_SCHEMA_VERSION,
	STANDARD_MODELING_OBJECTS,
	applyProjectRecordDelete,
	createProjectJsonState,
	exportProjectJson,
	normalizeProjectJson,
	upsertProjectRecord,
	validateProjectJson
} = projectJsonContract;

const standardObjects = [
	"missionProfiles",
	"equipmentAssets",
	"equipmentTree",
	"supportResources",
	"inventoryResources",
	"supportActivities",
	"metricPlans"
];

function validProjectJson() {
	return normalizeProjectJson({
		projectId: "demo-601",
		projectName: "601 备件评估演示项目",
		tables: {
			missionProfiles: [
				{
					id: "mission-1",
					taskNo: "BT-001",
					taskName: "对海突击任务A",
					aircraftModel: "J35",
					equipmentAmount: 1,
					durationMinutes: 120,
					memberNos: ["J35-132"],
					usageGuarantee: "歼-35快速出动保障方案2"
				}
			],
			equipmentAssets: [
				{
					id: "asset-1",
					aircraftType: "J35",
					aircraftCode: "J35-132",
					currentStatus: "在册完好"
				}
			],
			equipmentTree: [
				{
					id: "equipmentTree:任务计算机模块",
					nodeLevel: 3,
					nodeName: "任务计算机模块",
					quantity: 2,
					isLru: true,
					mttr: 20
				}
			],
			supportResources: [
				{
					id: "staff-1",
					major: "机加",
					majorLevel: "L2",
					staffCount: 4,
					serviceAircraft: ["J35"]
				}
			],
			inventoryResources: [
				{
					id: "spare-1",
					resourceType: "sparePart",
					name: "飞行检查包",
					model: "FX-06",
					count: 12
				}
			],
			supportActivities: [
				{
					id: "activity-1",
					activityCode: "OPS-007",
					activityName: "机务检查",
					activityType: "basic",
					aircraftName: "J35",
					workDurationHours: 2,
					spareList: [{ spareName: "飞行检查包", spareModel: "FX-06", requiredCount: 1 }]
				},
				{
					id: "activity-2",
					activityName: "歼-35快速出动保障方案2",
					activityType: "usage",
					basicActivityCode: "OPS-007"
				}
			],
			metricPlans: [
				{
					id: "metric-1",
					indexName: "任务可靠度",
					targetType: "任务可靠度",
					symbol: "≥",
					targetValue: 0.95
				}
			]
		}
	});
}

test("project JSON state initializes the seven standard tables and tracks edits", () => {
	const state = createProjectJsonState({ projectId: "project-a", projectName: "测试项目" });

	assert.equal(state.project.schemaVersion, PROJECT_JSON_SCHEMA_VERSION);
	assert.equal(state.project.projectId, "project-a");
	assert.equal(state.project.projectName, "测试项目");
	assert.deepEqual(Object.keys(state.project.tables), standardObjects);
	for (const objectName of standardObjects) {
		assert.deepEqual(state.project.tables[objectName], []);
	}
	assert.equal(state.dirtyStatus, "clean");
	assert.equal(state.project.validation.status, "draft");
	assert.equal(state.project.sourceTrace.origin, "user-authored");

	const nextState = upsertProjectRecord(state, "missionProfiles", {
		id: "mission-1",
		taskNo: "BT-001",
		taskName: "任务A",
		aircraftModel: "J35",
		equipmentAmount: 1,
		durationMinutes: 60
	});

	assert.notEqual(nextState, state);
	assert.equal(nextState.dirtyStatus, "dirty");
	assert.equal(nextState.project.tables.missionProfiles.length, 1);
	assert.equal(nextState.project.tables.missionProfiles[0].taskName, "任务A");
});

test("metadata exposes the seven standard objects with field-level validation rules", () => {
	assert.deepEqual(STANDARD_MODELING_OBJECTS, standardObjects);

	for (const objectName of standardObjects) {
		assert.ok(MODELING_OBJECT_METADATA[objectName], `missing ${objectName} metadata`);
		assert.equal(MODELING_OBJECT_METADATA[objectName].tableName, objectName);
		assert.ok(MODELING_OBJECT_METADATA[objectName].rawSources.length > 0);
		assert.ok(MODELING_OBJECT_METADATA[objectName].fields.id.required);
	}

	assert.equal(MODELING_OBJECT_METADATA.missionProfiles.fields.taskName.required, true);
	assert.equal(MODELING_OBJECT_METADATA.missionProfiles.fields.equipmentAmount.kind, "nonNegativeInteger");
	assert.equal(MODELING_OBJECT_METADATA.missionProfiles.fields.durationMinutes.unit, "minute");
	assert.equal(MODELING_OBJECT_METADATA.metricPlans.fields.targetValue.kind, "probabilityOrNumber");
	assert.deepEqual(MODELING_OBJECT_METADATA.equipmentTree.futureFields.rbdStructure, ["parentId", "relationType", "successThreshold"]);
});

test("validation covers required fields, uniqueness, references, quantities, probabilities, and time fields", () => {
	const invalidProject = validProjectJson();
	invalidProject.tables.missionProfiles.push({
		id: "mission-1",
		taskNo: "BT-001",
		taskName: "",
		aircraftModel: "J35",
		equipmentAmount: -1,
		durationMinutes: "two hours",
		memberNos: ["MISSING-001"],
		usageGuarantee: "missing activity"
	});
	invalidProject.tables.metricPlans[0].targetValue = 1.2;
	invalidProject.tables.supportActivities[1].basicActivityCode = "OPS-MISSING";
	invalidProject.tables.supportActivities[0].spareList[0].requiredCount = -2;

	const result = validateProjectJson(invalidProject);

	assert.equal(result.status, "invalid");
	assert.match(result.errors.map((error) => error.rule).join(","), /required/);
	assert.match(result.errors.map((error) => error.rule).join(","), /unique/);
	assert.match(result.errors.map((error) => error.rule).join(","), /reference/);
	assert.match(result.errors.map((error) => error.rule).join(","), /nonNegative/);
	assert.match(result.errors.map((error) => error.rule).join(","), /probability/);
	assert.match(result.errors.map((error) => error.rule).join(","), /timeUnit/);
});

test("validation rejects invalid metadata kinds and integer decimals", () => {
	const invalidProject = validProjectJson();
	invalidProject.tables.missionProfiles[0].equipmentAmount = 1.5;
	invalidProject.tables.equipmentTree[0].isLru = "maybe";
	invalidProject.tables.supportResources[0].serviceAircraft = "J35";
	invalidProject.tables.supportResources[0].facilityMap = "not an object";
	invalidProject.tables.inventoryResources[0].resourceType = "foo";
	invalidProject.tables.supportActivities[0].crewList = { specialty: "机加" };
	invalidProject.tables.metricPlans[0].symbol = ">";

	const result = validateProjectJson(invalidProject);
	const rulesByField = result.errors.map((error) => `${error.rule}:${error.field}`);

	assert.equal(result.status, "invalid");
	assert.ok(rulesByField.includes("integer:equipmentAmount"));
	assert.ok(rulesByField.includes("boolean:isLru"));
	assert.ok(rulesByField.includes("referenceList:serviceAircraft"));
	assert.ok(rulesByField.includes("object:facilityMap"));
	assert.ok(rulesByField.includes("enum:resourceType"));
	assert.ok(rulesByField.includes("list:crewList"));
	assert.ok(rulesByField.includes("enum:symbol"));
});

test("referenced records cannot be deleted from the shared project state", () => {
	const state = createProjectJsonState({ projectJson: validProjectJson() });
	const blocked = applyProjectRecordDelete(state, "equipmentAssets", "asset-1");

	assert.equal(blocked.deleted, false);
	assert.equal(blocked.state.project.tables.equipmentAssets.length, 1);
	assert.equal(blocked.state.project.validation.status, "invalid");
	assert.equal(blocked.state.project.validation.errors[0].rule, "deleteBlockedByReference");
	assert.match(blocked.state.project.validation.errors[0].message, /J35-132/);

	const deleted = applyProjectRecordDelete(state, "metricPlans", "metric-1");
	assert.equal(deleted.deleted, true);
	assert.equal(deleted.state.project.tables.metricPlans.length, 0);
	assert.equal(deleted.state.dirtyStatus, "dirty");
});

test("equipment tree nodes referenced by corrective repair objects cannot be deleted", () => {
	const project = validProjectJson();
	project.tables.supportActivities.push({
		id: "repair-1",
		activityName: "任务计算机模块修复",
		activityType: "correctiveMaintenance",
		repairObject: "任务计算机模块"
	});
	const state = createProjectJsonState({ projectJson: project });
	const blocked = applyProjectRecordDelete(state, "equipmentTree", "equipmentTree:任务计算机模块");

	assert.equal(blocked.deleted, false);
	assert.equal(blocked.state.project.tables.equipmentTree.length, 1);
	assert.equal(blocked.state.project.validation.status, "invalid");
	assert.equal(blocked.state.project.validation.errors[0].rule, "deleteBlockedByReference");
	assert.match(blocked.state.project.validation.errors[0].message, /repairObject/);
});

test("workbook-style JSON import cleans raw values into normalized project JSON", () => {
	const project = normalizeProjectJson({
		projectId: "imported",
		projectName: "导入项目",
		basicTasks: [
			{
				id: "bt-1",
				taskNo: "BT-001",
				taskName: "任务A",
				aircraftModel: "J35",
				equipmentAmount: "2",
				duration: "120",
				prepTime: "15",
				cancelTime: "",
				usageGuarantee: "使用保障A"
			}
		],
		basicUsageUnits: [{ formationName: "编队1", equipmentType: "J35", memberNos: "J35-132、 J35-118" }],
		aircraftPools: [{ id: "ac-1", aircraftType: "J35", aircraftCode: "J35-132", currentStatus: "在册完好" }],
		equipmentTree: [{ nodeLevel: "3", nodeName: "任务计算机模块", quantity: "2", isLru: 1, isDetectable: 0, detectionTime: "12" }],
		supportStaff: [
			{ id: "staff-1", major: "机加", majorLevel: "L2", serviceAircraft: "J35, 直-20F", count: "4" },
			{ id: "staff-2", major: "飞参", majorLevel: "L1", serviceAircraft: ["J35", "null", "", "直-20F"], count: "2" }
		],
		spareParts: [{ id: "spare-1", name: "飞行检查包", model: "FX-06", count: "12" }],
		ammunition: [{ id: "ammo-1", name: "训练弹", model: "FF-TR", count: "2" }],
		basicActivityLibrary: [{
			id: "act-1",
			activityCode: "OPS-007",
			activityName: "机务检查",
			activityType: "1",
			workDuration: "2",
			spareList: [{ spareName: "飞行检查包", spareModel: "FX-06", requiredCount: "1" }]
		}],
		usageSupportActivities: [{ id: "use-1", activityName: "使用保障A", planType: "直接准备", basicActivityCode: "OPS-007", precedingWork: "null" }],
		experimentConfig: {
			simulationType: "单波次",
			taskSuccessRate: "95%",
			indexList: [{ id: "idx-1", indexName: "装备完好率", targetValue: 95 }]
		},
		constraints: [{ targetType: "任务可靠度", symbol: "≥", targetValue: "95%" }],
		optimizationTargets: [{ id: "opt-1", targetType: "保障设备利用率", symbol: "≥", targetValue: 1 }],
		supportStationCodes: ["legacy"],
		shipTypes: ["后续环境配置"]
	});

	assert.equal(project.schemaVersion, PROJECT_JSON_SCHEMA_VERSION);
	assert.equal(project.tables.missionProfiles[0].durationMinutes, 120);
	assert.equal(project.tables.missionProfiles[0].cancelTimeMinutes, null);
	assert.deepEqual(project.tables.missionProfiles.at(-1).memberNos, ["J35-132", "J35-118"]);
	assert.equal(project.tables.equipmentTree[0].nodeLevel, 3);
	assert.equal(project.tables.equipmentTree[0].isLru, true);
	assert.equal(project.tables.equipmentTree[0].isDetectable, false);
	assert.deepEqual(project.tables.supportResources[0].serviceAircraft, ["J35", "直-20F"]);
	assert.deepEqual(project.tables.supportResources[1].serviceAircraft, ["J35", "直-20F"]);
	assert.equal(project.tables.inventoryResources[0].count, 12);
	assert.equal(project.tables.supportActivities[1].precedingWork, null);
	assert.equal(project.tables.metricPlans[0].targetValue, 0.95);
	assert.equal(project.tables.metricPlans[0].taskSuccessRate, 0.95);
	assert.equal(project.tables.metricPlans[1].targetValue, 0.95);
	assert.equal(project.tables.supportStationCodes, undefined);
	assert.equal(project.tables.shipTypes, undefined);
	assert.equal(project.sourceTrace.origin, "workbook-json");
	assert.ok(project.sourceTrace.importedSheets.includes("basicTasks"));
});

test("current data_new workbook import generates unique normalized identifiers", () => {
	const raw = JSON.parse(readFileSync(new URL("../core/dataset/data_new.json", import.meta.url), "utf8"));
	const project = normalizeProjectJson(raw);
	const result = validateProjectJson(project);
	const uniqueErrors = result.errors.filter((error) => error.rule === "unique");

	assert.deepEqual(uniqueErrors, []);
	for (const objectName of standardObjects) {
		assert.ok(project.tables[objectName].length > 0, `${objectName} should import records`);
	}
});

test("normalized project JSON import recomputes stale validation", () => {
	const staleProject = validProjectJson();
	staleProject.validation = { status: "valid", errors: [], warnings: [] };
	staleProject.tables.inventoryResources[0].resourceType = "foo";

	const normalized = normalizeProjectJson(staleProject);
	const state = createProjectJsonState({ projectJson: staleProject });

	assert.equal(normalized.validation.status, "invalid");
	assert.equal(normalized.validation.errors[0].rule, "enum");
	assert.equal(state.project.validation.status, "invalid");
	assert.equal(state.project.validation.errors[0].rule, "enum");
});

test("export keeps invalid projects as drafts and valid projects as runnable normalized JSON", () => {
	const validExport = exportProjectJson(validProjectJson());
	assert.equal(validExport.runnable, true);
	assert.equal(validExport.projectJson.validation.status, "valid");
	assert.match(validExport.fileName, /^demo-601-mvp-modeling-v0\.1\.json$/);

	const invalidProject = validProjectJson();
	invalidProject.tables.metricPlans[0].targetValue = 1.5;
	const invalidExport = exportProjectJson(invalidProject);

	assert.equal(invalidExport.runnable, false);
	assert.equal(invalidExport.projectJson.validation.status, "invalid");
	assert.equal(invalidExport.projectJson.validation.errors[0].rule, "probability");
});
