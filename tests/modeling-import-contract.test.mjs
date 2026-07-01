import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MODELING_IMPORT_PAGE_MAP,
  projectToModelingImportPackage,
  validateModelingImportPackage
} from "../front/modeling-import-contract.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

function canonicalImportFixture() {
  return JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
}

function readRepoJsonSync(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("canonical modeling import fixture covers all project authoring surfaces", () => {
  const fixture = canonicalImportFixture();
  const objects = fixture.objects;
  const mission = objects.missionProfiles[0];

  assert.equal(fixture.schemaVersion, "modeling-import-v1");
  assert.ok(fixture.importId);
  assert.ok(fixture.projectId);
  assert.ok(objects.projectInfo || mission.experiment);
  assert.ok(Array.isArray(objects.equipmentAssets) && objects.equipmentAssets.length >= 1);
  assert.ok(objects.equipmentAssets.some((asset) => asset.rms && asset.failureDistribution && asset.specialRepairProfile));
  assert.ok(mission.basicMission);
  assert.ok(Array.isArray(mission.compositeTasks));
  assert.ok(Array.isArray(mission.periodicTasks));
  assert.ok(mission.combatUnit);
  assert.ok(Array.isArray(objects.supportResources));
  assert.ok(objects.supportResources.some((resource) => resource.inventory && resource.transportPolicies));
  assert.ok(Array.isArray(objects.supportActivities));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "修复性维修"));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "预防性维修"));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "后勤保障"));
  assert.ok(mission.reliabilityBlockDiagram?.nodes?.length >= 1);
  assert.ok(mission.reliabilityBlockDiagram?.edges?.length >= 1);
  assert.ok(mission.monteCarlo?.failureRates?.length >= 1);
  assert.ok(mission.analysisRequests?.largeSample || objects.analysisRequests?.largeSample);
});

test("modeling import schema and fixture define the M5 first-slice package", async () => {
  const manifest = await readJson("contracts/README.md.json");
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");

  assert.deepEqual(manifest.m5_schema_files, ["modeling_import.schema.json"]);
  assert.deepEqual(manifest.m5_fixture_files, ["tests/fixtures/modeling_import_project.json"]);
  assert.equal(schema.$id, "https://spare-mvp.local/contracts/modeling_import.schema.json");
  assert.equal(schema.properties.schemaVersion.const, "modeling-import-v1");
  assert.deepEqual(schema.properties.validationLevel.enum, ["level0", "level1"]);
  assert.equal(schema.properties.usedTables.type, "object");
  assert.deepEqual(validateSchema(schema, fixture), []);
  assert.deepEqual(validateModelingImportPackage(fixture), []);
});

test("modeling import validation supports Level 0 packages without support-domain stubs", async () => {
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const level0Package = {
    ...fixture,
    importId: "import-level0-no-support-domain",
    projectId: "project-level0-no-support-domain",
    validationLevel: "level0",
    usedTables: {
      missionProfiles: true,
      equipmentAssets: true,
      reliabilityBlockDiagram: true,
      supportResources: false,
      supportActivities: false,
      supportOrganization: false,
      transportPolicies: false
    },
    objects: { ...fixture.objects }
  };
  delete level0Package.objects.supportResources;
  delete level0Package.objects.supportActivities;
  delete level0Package.objects.supportOrganization;

  assert.deepEqual(validateSchema(schema, level0Package), []);
  assert.deepEqual(validateModelingImportPackage(level0Package), []);
});

test("modeling import validation rejects Level 1 packages with declared missing support domains", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const level1Package = {
    ...fixture,
    validationLevel: "level1",
    usedTables: {
      missionProfiles: true,
      equipmentAssets: true,
      reliabilityBlockDiagram: true,
      supportResources: true,
      supportActivities: true,
      supportOrganization: true,
      transportPolicies: true
    },
    objects: { ...fixture.objects }
  };
  delete level1Package.objects.supportResources;
  delete level1Package.objects.supportActivities;

  const issues = validateModelingImportPackage(level1Package);
  const issuesByPath = Object.fromEntries(issues.map((issue) => [issue.field_path, issue]));

  assert.equal(issuesByPath["objects.supportResources"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.supportActivities"].code, "invalid_declared_table");
});

test("modeling import schema and frontend validator reject declared Level 0 support gaps", async () => {
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const declaredSupportPackage = {
    ...fixture,
    validationLevel: "level0",
    usedTables: {
      missionProfiles: true,
      equipmentAssets: true,
      reliabilityBlockDiagram: true,
      supportResources: true,
      supportActivities: true,
      supportOrganization: true,
      transportPolicies: true
    },
    objects: { ...fixture.objects }
  };
  delete declaredSupportPackage.objects.supportResources;
  delete declaredSupportPackage.objects.supportActivities;
  delete declaredSupportPackage.objects.supportOrganization;

  const schemaErrors = validateSchema(schema, declaredSupportPackage);
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportResources is required")));
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportActivities is required")));
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportOrganization is required")));

  const issuesByPath = Object.fromEntries(validateModelingImportPackage(declaredSupportPackage).map((issue) => [issue.field_path, issue]));
  assert.equal(issuesByPath["objects.supportResources"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.supportActivities"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.supportOrganization"].code, "invalid_declared_table");
});

test("modeling import validation rejects malformed usedTables flags", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const malformed = {
    ...fixture,
    validationLevel: "level0",
    usedTables: {
      ...fixture.usedTables,
      supportResources: "false"
    },
    objects: { ...fixture.objects }
  };
  delete malformed.objects.supportResources;

  const issuesByPath = Object.fromEntries(validateModelingImportPackage(malformed).map((issue) => [issue.field_path, issue]));
  assert.equal(issuesByPath["usedTables.supportResources"].code, "invalid_used_table_flag");
  assert.equal(issuesByPath["objects.supportResources"].code, "invalid_declared_table");
});

test("modeling import validation rejects declared used tables with empty modeled content", async () => {
  const schema = await readJson("contracts/modeling_import.schema.json");
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const emptyDeclaredTables = {
    ...fixture,
    validationLevel: "level1",
    usedTables: {
      missionProfiles: true,
      equipmentAssets: true,
      reliabilityBlockDiagram: true,
      supportResources: true,
      supportActivities: true,
      supportOrganization: true,
      transportPolicies: true
    },
    objects: {
      ...fixture.objects,
      supportResources: [],
      supportActivities: [],
      reliabilityBlockDiagram: {},
      supportOrganization: { tree: [] }
    }
  };

  const schemaErrors = validateSchema(schema, emptyDeclaredTables);
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportResources expected minItems")));
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportActivities expected minItems")));
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.reliabilityBlockDiagram expected minProperties")));
  assert.ok(schemaErrors.some((error) => error.includes("$.objects.supportOrganization.tree expected minItems")));

  const issuesByPath = Object.fromEntries(validateModelingImportPackage(emptyDeclaredTables).map((issue) => [issue.field_path, issue]));
  assert.equal(issuesByPath["objects.supportResources"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.supportActivities"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.reliabilityBlockDiagram"].code, "invalid_declared_table");
  assert.equal(issuesByPath["objects.supportOrganization.tree"].code, "invalid_declared_table");
});

test("projectToModelingImportPackage backfills import draft from current Project surfaces", () => {
  const schema = readRepoJsonSync("contracts/modeling_import.schema.json");
  const basePackage = {
    schemaVersion: "modeling-import-v1",
    importId: "import-old",
    projectId: "project-old",
    source: { type: "json_fixture", name: "old.json" },
    lifecycle: { state: "published", version: 3, referencedRunIds: ["run-001"] },
    objects: {
      missionProfiles: [],
      equipmentAssets: [],
      supportResources: [],
      supportActivities: [],
      customGovernance: { owner: "data-admin" }
    }
  };
  const projectJson = {
    schema_version: "project-v0",
    project_id: "project-current",
    project_version: "project-v0.9",
    scenarioId: "scenario-current",
    projectInfo: { name: "当前项目", baseCode: "CUR-001" },
    missionProfile: {
      sourceImportId: "import-current",
      profileId: "MP-CURRENT",
      name: "当前项目任务",
      durationHours: 8,
      compositeTasks: [{ id: "wave-1", name: "第一波次" }],
      periodicTasks: [{ id: "periodic-1", name: "周期任务" }]
    },
    basicMission: { missionId: "BM-CURRENT", minRequiredSorties: 2 },
    missionPhases: [{ id: "phase-1", name: "执行" }],
    combatUnit: { quantity: 3, requiredCount: 2 },
    equipment: { model: "J-15", quantity: 3 },
    reliabilityBlockDiagram: { nodes: [{ id: "aircraft-root" }], edges: [] },
    monteCarlo: { spareMultipliers: [1] },
    analysisRequests: { largeSample: { enabled: true, samples: 5 } },
    components: [
      { id: "aircraft-root", name: "整机", quantity: 3 },
      { id: "radar", name: "雷达", parentId: "aircraft-root", quantity: 1, mtbfHours: 120 }
    ],
    supportNodes: [{ id: "deck", name: "甲板", capacity: 2 }],
    supportActivities: [{ id: "repair-radar", name: "雷达维修", equipmentId: "radar", resourceId: "deck", durationHours: 2 }]
  };

  const draft = projectToModelingImportPackage(projectJson, basePackage);

  assert.equal(draft.schemaVersion, "modeling-import-v1");
  assert.equal(draft.importId, "import-current");
  assert.equal(draft.projectId, "project-current");
  assert.equal(draft.lifecycle.state, "draft");
  assert.equal(draft.lifecycle.version, 3);
  assert.deepEqual(draft.lifecycle.referencedRunIds, ["run-001"]);
  assert.equal(draft.source.type, "current_project_backfill");
  assert.equal(draft.source.name, "current_project_backfill");
  assert.equal(draft.usedTables.transportPolicies, false);
  assert.equal(draft.objects.missionProfiles[0].sourceImportId, undefined);
  assert.equal(draft.objects.missionProfiles[0].profileId, "MP-CURRENT");
  assert.deepEqual(draft.objects.missionProfiles[0].basicMission, projectJson.basicMission);
  assert.deepEqual(draft.objects.equipmentAssets, projectJson.components);
  assert.deepEqual(draft.objects.supportResources, projectJson.supportNodes);
  assert.deepEqual(draft.objects.supportActivities, projectJson.supportActivities);
  assert.deepEqual(draft.objects.customGovernance, basePackage.objects.customGovernance);
  assert.equal("schema_version" in draft, false);
  assert.equal("project_version" in draft, false);
  assert.deepEqual(validateSchema(schema, draft), []);
  assert.deepEqual(validateModelingImportPackage(draft), []);
});

test("current project backfill normalizes support activity plan rows into importable activities", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const draft = projectToModelingImportPackage({
    project_id: "project-current",
    scenarioId: "scenario-current",
    missionProfile: {
      sourceImportId: fixture.importId,
      name: "当前项目任务",
      durationHours: 8
    },
    components: [
      { id: "aircraft-root", name: "整机", quantity: 1 },
      { id: "j15-engine", name: "发动机", parentId: "aircraft-root", aircraftModel: "J-15", quantity: 2 }
    ],
    supportNodes: [{ id: "carrier-deck", name: "基地", capacity: 4 }],
    supportActivities: [{
      id: "ops-support-j-15-after-flight",
      activityName: "J-15飞行后检查活动",
      activityType: "使用保障",
      aircraftModel: "J-15",
      jobs: [{ workName: "飞行后检查", durationMinutes: 30 }]
    }]
  }, fixture);

  assert.equal(draft.validation.ok, true);
  assert.deepEqual(validateModelingImportPackage(draft), []);
  assert.deepEqual(draft.objects.supportActivities[0], {
    id: "ops-support-j-15-after-flight",
    activityName: "J-15飞行后检查活动",
    activityType: "使用保障",
    aircraftModel: "J-15",
    jobs: [{ workName: "飞行后检查", durationMinutes: 30 }],
    name: "J-15飞行后检查活动",
    equipmentId: "j15-engine",
    resourceId: "carrier-deck",
    durationHours: 0.5
  });
});

test("current project backfill preserves phase 2 support organization resources and activity library fields", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const supportOrganization = {
    tree: [{
      id: "root",
      name: "基地",
      children: [{
        id: "level-2",
        name: "保障大队",
        children: [{
          id: "level-3",
          name: "维修中队",
          children: [{ id: "level-4", name: "航电班组", children: [] }]
        }]
      }]
    }]
  };
  const draft = projectToModelingImportPackage({
    project_id: "project-phase-2",
    scenarioId: "scenario-phase-2",
    missionProfile: {
      sourceImportId: fixture.importId,
      name: "阶段2保障活动库",
      durationHours: 8
    },
    supportOrganization,
    components: [
      { id: "aircraft-root", name: "整机", quantity: 1 },
      { id: "avionics", name: "航电系统", parentId: "aircraft-root", aircraftModel: "J-15", quantity: 1 }
    ],
    supportNodes: [{
      id: "carrier-deck",
      name: "航母飞行甲板",
      capacity: 4,
      organizationNodeId: "level-4",
      personnelCapacity: 7,
      personnelModel: "航电",
      inventory: { "航电模块": 3 },
      spareModels: { "航电模块": "AV-01" },
      spareEquipment: { "航电模块": "J-15" }
    }],
    supportActivities: [{
      id: "basic-avionics-check",
      activityName: "航电通电检查",
      activityType: "使用保障活动",
      aircraftModel: "J-15",
      jobs: [{
        activityCode: "BA-220",
        workName: "航电通电检查",
        durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
        durationMinutes: 25,
        personnel: "航电,2",
        equipment: "检测仪,1",
        spare: "航电模块,1",
        predecessors: ["BA-100"]
      }]
    }]
  }, fixture);

  assert.equal(draft.validation.ok, true);
  assert.deepEqual(draft.objects.supportOrganization, supportOrganization);
  assert.equal(draft.objects.supportOrganization.tree[0].children[0].children[0].children[0].name, "航电班组");
  assert.equal(draft.objects.supportResources[0].personnelModel, "航电");
  assert.equal(draft.objects.supportResources[0].spareEquipment["航电模块"], "J-15");
  assert.deepEqual(draft.objects.supportActivities[0].jobs[0].durationProfile, {
    distributionType: "正态分布",
    mean: 25,
    stdDev: 5
  });
  assert.deepEqual(draft.objects.supportActivities[0].jobs[0].predecessors, ["BA-100"]);
  assert.deepEqual(validateModelingImportPackage(draft), []);
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

  const defaultLevel1MissingSupport = {
    ...fixture,
    objects: { ...fixture.objects }
  };
  delete defaultLevel1MissingSupport.objects.supportResources;
  delete defaultLevel1MissingSupport.objects.supportActivities;

  const defaultLevel1Errors = validateSchema(schema, defaultLevel1MissingSupport);
  assert.ok(defaultLevel1Errors.some((error) => error.includes("$.objects.supportResources is required")));
  assert.ok(defaultLevel1Errors.some((error) => error.includes("$.objects.supportActivities is required")));
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
    "invalid_declared_table",
    "invalid_declared_table",
    "invalid_declared_table",
    "invalid_declared_table",
    "invalid_declared_table",
    "invalid_declared_table",
    "invalid_declared_table"
  ]);
  assert.ok(issues.filter((issue) => issue.code === "missing_required_root").every((issue) => issue.page === "建模数据入口"));
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
          id: "j15-radar",
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
          equipmentId: "j15-radar",
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

test("modeling import validation rejects SRU rows whose parent is not an LRU", async () => {
  const fixture = await readJson("tests/fixtures/modeling_import_project.json");
  const invalidPackage = {
    ...fixture,
    objects: {
      ...fixture.objects,
      equipmentAssets: [
        { id: "aircraft-root", name: "整机", quantity: 1, productType: "" },
        null,
        { id: "hydraulic-system", name: "液压系统", parentId: "aircraft-root", quantity: 1, productType: "SRU" },
        { id: "hydraulic-valve", name: "液压阀", parentId: "hydraulic-system", quantity: 1, productType: "LRU" }
      ]
    }
  };

  const issues = validateModelingImportPackage(invalidPackage);
  const sruParentIssue = issues.find((issue) => issue.code === "invalid_sru_parent");

  assert.equal(sruParentIssue?.field_path, "objects.equipmentAssets[2].parentId");
  assert.equal(sruParentIssue?.page, "装备系统建模");
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
  assert.equal(MODELING_IMPORT_PAGE_MAP.equipmentAssets, "装备系统建模");
  assert.equal(MODELING_IMPORT_PAGE_MAP.supportResources, "保障资源建模");
  assert.equal(MODELING_IMPORT_PAGE_MAP.supportActivities, "保障活动建模");
});
