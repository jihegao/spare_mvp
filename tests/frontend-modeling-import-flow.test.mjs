import assert from "node:assert/strict";
import test from "node:test";

import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import { ensurePublishedModelingImportForSampleProject } from "../front/modeling-import-project-flow.mjs";

test("sample project flow publishes demo fixture before create when no published package exists", async () => {
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
