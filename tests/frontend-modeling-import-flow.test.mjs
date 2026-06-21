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
