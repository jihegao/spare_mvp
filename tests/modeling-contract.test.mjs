import { test } from "node:test";
import assert from "node:assert/strict";

import modelingContract from "../front/modeling-contract.js";

const {
	MODELING_CONTEXT_ITEMS,
	MODELING_FUTURE_FIELDS,
	MODELING_SCOPE
} = modelingContract;

test("modeling contract exposes support resource sheets without current-code sheets", () => {
	const spareSupport = MODELING_SCOPE["spare-planning"].find((row) => row.name === "保障组织与资源");
	const missionSupport = MODELING_SCOPE["mission-reliability"].find((row) => row.name === "保障组织与资源");

	assert.ok(spareSupport);
	assert.ok(missionSupport);
	assert.ok(spareSupport.sheets.includes("nonSupportStations"));
	assert.ok(missionSupport.sheets.includes("nonSupportStations"));
	assert.ok(!spareSupport.sheets.includes("supportStationCodes"));
	assert.ok(!missionSupport.sheets.includes("nonSupportStationCodes"));
	assert.deepEqual(MODELING_CONTEXT_ITEMS, ["shipTypes", "initialLayouts", "supportStationCodes", "nonSupportStationCodes"]);
});

test("RBD parent and relation semantics are future fields, not current equipmentTree fields", () => {
	const rbd = MODELING_SCOPE["mission-reliability"].find((row) => row.name === "装备可靠性框图");

	assert.ok(rbd);
	assert.equal(rbd.status, "待补父子关系");
	assert.ok(!rbd.fields.includes("parentId"));
	assert.deepEqual(rbd.futureFieldGroup, "rbdStructure");
	assert.deepEqual(MODELING_FUTURE_FIELDS.rbdStructure, ["parentId", "relationType", "successThreshold"]);
});
