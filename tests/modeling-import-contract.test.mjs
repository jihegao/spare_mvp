import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MODELING_IMPORT_PAGE_MAP,
  validateModelingImportPackage
} from "../front/modeling-import-contract.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("modeling import schema and fixture define the M5 first-slice package", async () => {
  const manifest = await readJson("contracts/README.md.json");
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");

  assert.deepEqual(manifest.m5_schema_files, ["modeling_import.schema.json"]);
  assert.deepEqual(manifest.m5_fixture_files, ["tests/fixtures/modeling_import_project.json"]);
  assert.equal(schema.$id, "https://spare-mvp.local/contracts/modeling_import.schema.json");
  assert.equal(schema.properties.schemaVersion.const, "modeling-import-v1");
  assert.deepEqual(validateSchema(schema, fixture), []);
  assert.deepEqual(validateModelingImportPackage(fixture), []);
});

test("modeling import schema validation resolves nested local refs", async () => {
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const malformed = {
    ...fixture,
    objects: {
      ...fixture.objects,
      missionProfiles: [
        {
          id: "mission-profile-malformed",
          durationHours: "3"
        }
      ]
    },
    validation: {
      status: "invalid",
      issues: [
        {
          code: "bad"
        }
      ]
    }
  };

  const errors = validateSchema(schema, malformed);

  assert.ok(errors.some((error) => error.includes("$.objects.missionProfiles[0].name is required")));
  assert.ok(errors.some((error) => error.includes("$.objects.missionProfiles[0].durationHours expected type")));
  assert.ok(errors.some((error) => error.includes("$.validation.issues[0].severity is required")));
});

test("modeling import validator rejects malformed package roots", () => {
  const issues = validateModelingImportPackage({
    schemaVersion: "modeling-import-v0",
    objects: {}
  });

  assert.deepEqual(issues.map((issue) => issue.code), [
    "invalid_schema_version",
    "missing_required_root",
    "missing_required_root",
    "missing_required_root",
    "missing_required_root",
    "missing_required_root",
    "missing_required_root",
    "missing_required_root"
  ]);
  assert.ok(issues.every((issue) => issue.page === "建模数据入口"));
});

test("modeling import validation reports duplicate IDs, references, numeric fields, and version protection", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const invalidPackage = {
    ...fixture,
    lifecycle: {
      state: "published",
      version: 2,
      referencedRunIds: ["run-smoke-001"]
    },
    objects: {
      ...fixture.objects,
      equipmentAssets: [
        ...fixture.objects.equipmentAssets,
        {
          id: "radar-lru",
          name: "重复雷达 LRU",
          parentId: "missing-system",
          quantity: 0,
          mtbfHours: -1
        }
      ],
      supportActivities: [
        {
          id: "replace-radar",
          name: "更换雷达 LRU",
          equipmentId: "radar-lru",
          resourceId: "missing-resource",
          durationHours: 0
        }
      ]
    },
    changes: [
      {
        operation: "update",
        objectType: "equipmentAssets",
        objectId: "radar-lru",
        fieldPath: "objects.equipmentAssets[0].name"
      }
    ]
  };

  const issues = validateModelingImportPackage(invalidPackage);
  const codes = issues.map((issue) => issue.code).sort();

  assert.deepEqual(codes, [
    "duplicate_id",
    "invalid_number",
    "invalid_number",
    "invalid_number",
    "missing_reference",
    "missing_reference",
    "published_reference_protection"
  ]);
  assert.ok(issues.every((issue) => issue.severity === "error"));
  assert.ok(issues.every((issue) => issue.object_id));
  assert.ok(issues.every((issue) => issue.field_path));
  assert.ok(issues.every((issue) => issue.page));
  assert.ok(issues.every((issue) => issue.message));
});

test("modeling import validation reports missing required fields with field paths", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const invalidPackage = {
    ...fixture,
    objects: {
      ...fixture.objects,
      missionProfiles: [
        {
          id: "mission-profile-incomplete"
        }
      ]
    }
  };

  const issues = validateModelingImportPackage(invalidPackage);

  assert.deepEqual(issues.map((issue) => issue.code), [
    "missing_required_field",
    "missing_required_field"
  ]);
  assert.deepEqual(issues.map((issue) => issue.field_path), [
    "objects.missionProfiles[0].name",
    "objects.missionProfiles[0].durationHours"
  ]);
  assert.ok(issues.every((issue) => issue.page === "任务剖面参数"));
});

test("modeling import validation rejects malformed lifecycle state and version", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const invalidPackage = {
    ...fixture,
    lifecycle: {
      state: "published",
      version: 0,
      referencedRunIds: "run-smoke-001"
    }
  };

  const issues = validateModelingImportPackage(invalidPackage);

  assert.deepEqual(issues.map((issue) => issue.code), [
    "invalid_lifecycle_version",
    "invalid_lifecycle_references"
  ]);
  assert.deepEqual(issues.map((issue) => issue.field_path), [
    "lifecycle.version",
    "lifecycle.referencedRunIds"
  ]);
});

test("modeling import page map routes validation issues to four-level modeling pages", () => {
  assert.equal(MODELING_IMPORT_PAGE_MAP.missionProfiles, "任务剖面参数");
  assert.equal(MODELING_IMPORT_PAGE_MAP.equipmentAssets, "装备组成建模");
  assert.equal(MODELING_IMPORT_PAGE_MAP.supportResources, "保障资源建模");
  assert.equal(MODELING_IMPORT_PAGE_MAP.supportActivities, "保障活动建模");
});
