import assert from "node:assert/strict";
import test from "node:test";

import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import {
  createReferencedModelingImportVersion,
  ensurePublishedModelingImportForSampleProject,
  publishModelingImportWithReferencedVersionFallback
} from "../front/modeling-import-project-flow.mjs";

test("sample project flow publishes demo fixture before create when no published package exists", async () => {
  assert.deepEqual(MODELING_IMPORT_DEMO_FIXTURE.source, {
    type: "json_fixture",
    name: "simulation_analysis_cases/canonical_platform_case.json",
    derivedFrom: "tests/fixtures/case_new.json"
  });

  const calls = [];
  const backendApi = {
    async saveModelingImport(payload) {
      calls.push(["save", payload.importId]);
      assert.equal(payload.importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
      return { draftPackage: payload };
    },
    async publishModelingImport(importId) {
      calls.push(["publish", importId]);
      return {
        publishedPackage: {
          ...MODELING_IMPORT_DEMO_FIXTURE,
          importId,
          lifecycle: { state: "published", version: 1 }
        }
      };
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: MODELING_IMPORT_DEMO_FIXTURE,
    publishedImportId: ""
  });

  assert.equal(published.importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
  assert.deepEqual(calls, [
    ["save", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["publish", MODELING_IMPORT_DEMO_FIXTURE.importId]
  ]);
});

test("sample project flow reuses existing published package without saving fixture", async () => {
  const calls = [];
  const backendApi = {
    async saveModelingImport() {
      calls.push(["save"]);
      throw new Error("should not save");
    },
    async publishModelingImport() {
      calls.push(["publish"]);
      throw new Error("should not publish");
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: MODELING_IMPORT_DEMO_FIXTURE,
    publishedImportId: "import/already-published"
  });

  assert.equal(published.importId, "import/already-published");
  assert.deepEqual(calls, []);
});

test("sample project flow reuses stored published demo import before saving fixture", async () => {
  const calls = [];
  const backendApi = {
    async getModelingImport(importId) {
      calls.push(["get", importId]);
      assert.equal(importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
      return {
        publishedPackage: {
          ...MODELING_IMPORT_DEMO_FIXTURE,
          importId,
          lifecycle: {
            state: "published",
            version: 3,
            referencedRunIds: ["run-scenario-import-carrier-day-night-001-0001"]
          }
        }
      };
    },
    async saveModelingImport() {
      calls.push(["save"]);
      throw new Error("should not save");
    },
    async publishModelingImport() {
      calls.push(["publish"]);
      throw new Error("should not publish");
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: MODELING_IMPORT_DEMO_FIXTURE,
    publishedImportId: ""
  });

  assert.equal(published.importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
  assert.equal(published.reused, true);
  assert.deepEqual(calls, [["get", MODELING_IMPORT_DEMO_FIXTURE.importId]]);
});

test("sample project flow republishes demo fixture when stored demo import is incomplete", async () => {
  const calls = [];
  const backendApi = {
    async getModelingImport(importId) {
      calls.push(["get", importId]);
      return {
        publishedPackage: {
          ...MODELING_IMPORT_DEMO_FIXTURE,
          objects: {
            ...MODELING_IMPORT_DEMO_FIXTURE.objects,
            supportResources: [],
            supportActivities: []
          }
        }
      };
    },
    async saveModelingImport(payload) {
      calls.push(["save", payload.importId]);
      assert.equal(payload.objects.supportResources.length, MODELING_IMPORT_DEMO_FIXTURE.objects.supportResources.length);
      assert.equal(payload.objects.supportActivities.length, MODELING_IMPORT_DEMO_FIXTURE.objects.supportActivities.length);
      return { draftPackage: payload };
    },
    async publishModelingImport(importId) {
      calls.push(["publish", importId]);
      return { publishedPackage: { ...MODELING_IMPORT_DEMO_FIXTURE, importId } };
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: MODELING_IMPORT_DEMO_FIXTURE,
    publishedImportId: ""
  });

  assert.equal(published.importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
  assert.equal(published.reused, false);
  assert.deepEqual(calls, [
    ["get", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["save", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["publish", MODELING_IMPORT_DEMO_FIXTURE.importId]
  ]);
});

test("sample project flow republishes fixture when stored import source is stale", async () => {
  const canonicalFixture = {
    ...MODELING_IMPORT_DEMO_FIXTURE,
    source: {
      type: "json_fixture",
      name: "simulation_analysis_cases/canonical_platform_case.json",
      derivedFrom: "tests/fixtures/case_new.json"
    }
  };
  const calls = [];
  const backendApi = {
    async getModelingImport(importId) {
      calls.push(["get", importId]);
      return {
        publishedPackage: {
          ...canonicalFixture,
          source: {
            type: "json_fixture",
            name: "modeling_import_project.json"
          }
        }
      };
    },
    async saveModelingImport(payload) {
      calls.push(["save", payload.source.name]);
      return { draftPackage: payload };
    },
    async publishModelingImport(importId) {
      calls.push(["publish", importId]);
      return { publishedPackage: { ...canonicalFixture, importId } };
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: canonicalFixture,
    publishedImportId: ""
  });

  assert.equal(published.reused, false);
  assert.deepEqual(calls, [
    ["get", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["save", "simulation_analysis_cases/canonical_platform_case.json"],
    ["publish", MODELING_IMPORT_DEMO_FIXTURE.importId]
  ]);
});

test("sample project flow reuses referenced published import even when stored source is stale", async () => {
  const canonicalFixture = {
    ...MODELING_IMPORT_DEMO_FIXTURE,
    source: {
      type: "json_fixture",
      name: "simulation_analysis_cases/canonical_platform_case.json",
      derivedFrom: "tests/fixtures/case_new.json"
    }
  };
  const calls = [];
  const backendApi = {
    async getModelingImport(importId) {
      calls.push(["get", importId]);
      return {
        publishedPackage: {
          ...canonicalFixture,
          source: {
            type: "json_fixture",
            name: "modeling_import_project.json"
          },
          lifecycle: {
            state: "published",
            version: 4,
            referencedRunIds: [
              "run-scenario-import-carrier-day-night-001-caad9ecc6b73-0001"
            ]
          }
        }
      };
    },
    async saveModelingImport() {
      calls.push(["save"]);
      throw new Error("should not save referenced published import");
    },
    async publishModelingImport() {
      calls.push(["publish"]);
      throw new Error("should not publish referenced published import");
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: canonicalFixture,
    publishedImportId: ""
  });

  assert.equal(published.importId, MODELING_IMPORT_DEMO_FIXTURE.importId);
  assert.equal(published.reused, true);
  assert.deepEqual(calls, [["get", MODELING_IMPORT_DEMO_FIXTURE.importId]]);
});

test("sample project flow does not reuse draft import just because it has run references", async () => {
  const canonicalFixture = {
    ...MODELING_IMPORT_DEMO_FIXTURE,
    source: {
      type: "json_fixture",
      name: "simulation_analysis_cases/canonical_platform_case.json",
      derivedFrom: "tests/fixtures/case_new.json"
    }
  };
  const calls = [];
  const backendApi = {
    async getModelingImport(importId) {
      calls.push(["get", importId]);
      return {
        publishedPackage: {
          ...canonicalFixture,
          source: {
            type: "json_fixture",
            name: "modeling_import_project.json"
          },
          lifecycle: {
            state: "draft",
            version: 4,
            referencedRunIds: [
              "run-scenario-import-carrier-day-night-001-caad9ecc6b73-0001"
            ]
          }
        }
      };
    },
    async saveModelingImport(payload) {
      calls.push(["save", payload.source.name]);
      return { draftPackage: payload };
    },
    async publishModelingImport(importId) {
      calls.push(["publish", importId]);
      return { publishedPackage: { ...canonicalFixture, importId } };
    }
  };

  const published = await ensurePublishedModelingImportForSampleProject({
    backendApi,
    fixture: canonicalFixture,
    publishedImportId: ""
  });

  assert.equal(published.reused, false);
  assert.deepEqual(calls, [
    ["get", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["save", "simulation_analysis_cases/canonical_platform_case.json"],
    ["publish", MODELING_IMPORT_DEMO_FIXTURE.importId]
  ]);
});

test("publish flow versions the import when the published snapshot is already referenced by runs", async () => {
  const calls = [];
  const backendApi = {
    async publishModelingImport(importId) {
      calls.push(["publish", importId]);
      if (importId === MODELING_IMPORT_DEMO_FIXTURE.importId) {
        const error = new Error("published modeling import is referenced by runs: run-001");
        error.code = "published_import_referenced";
        error.details = { import_id: importId };
        throw error;
      }
      return {
        importId,
        draftPackage: {
          ...MODELING_IMPORT_DEMO_FIXTURE,
          importId,
          lifecycle: { state: "published", version: 2, referencedRunIds: [] }
        },
        publishedPackage: {
          ...MODELING_IMPORT_DEMO_FIXTURE,
          importId,
          lifecycle: { state: "published", version: 2, referencedRunIds: [] }
        }
      };
    },
    async saveModelingImport(payload) {
      calls.push(["save", payload.importId, payload.lifecycle.state, payload.lifecycle.version, payload.lifecycle.referencedRunIds.length]);
      return { import_id: payload.importId };
    }
  };

  const result = await publishModelingImportWithReferencedVersionFallback({
    backendApi,
    importPackage: MODELING_IMPORT_DEMO_FIXTURE,
    versionSuffix: "v2"
  });

  assert.equal(result.versioned, true);
  assert.equal(result.originalImportId, MODELING_IMPORT_DEMO_FIXTURE.importId);
  assert.equal(result.importPackage.importId, `${MODELING_IMPORT_DEMO_FIXTURE.importId}-v2`);
  assert.equal(result.importPackage.lifecycle.state, "draft");
  assert.equal(result.importPackage.lifecycle.version, 2);
  assert.deepEqual(result.importPackage.lifecycle.referencedRunIds, []);
  assert.deepEqual(calls, [
    ["publish", MODELING_IMPORT_DEMO_FIXTURE.importId],
    ["save", `${MODELING_IMPORT_DEMO_FIXTURE.importId}-v2`, "draft", 2, 0],
    ["publish", `${MODELING_IMPORT_DEMO_FIXTURE.importId}-v2`]
  ]);
});

test("referenced import version helper sanitizes suffixes and clears run references", () => {
  const versioned = createReferencedModelingImportVersion({
    ...MODELING_IMPORT_DEMO_FIXTURE,
    lifecycle: { state: "published", version: 5, referencedRunIds: ["run-001"] }
  }, "new version 6");

  assert.equal(versioned.importId, `${MODELING_IMPORT_DEMO_FIXTURE.importId}-new-version-6`);
  assert.deepEqual(versioned.lifecycle, {
    state: "draft",
    version: 6,
    referencedRunIds: []
  });
});
