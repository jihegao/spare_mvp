import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildModelingImportPreview,
  cloneModelingImportPackage,
  diffModelingImports,
  normalizeModelingImportRecord,
  renderModelingImportWorkbench
} from "../front/modeling-import-workbench.mjs";

async function readFixture() {
  return JSON.parse(await readFile(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
}

test("cloneModelingImportPackage returns an isolated deep copy", async () => {
  const fixture = await readFixture();
  const cloned = cloneModelingImportPackage(fixture);
  const radarIndex = fixture.objects.equipmentAssets.findIndex((row) => row.id === "j15-radar");

  cloned.objects.equipmentAssets[radarIndex].name = "Changed Radar";

  assert.equal(fixture.objects.equipmentAssets[radarIndex].name, "雷达 LRU");
  assert.equal(cloned.objects.equipmentAssets[radarIndex].name, "Changed Radar");
});

test("buildModelingImportPreview maps four collections to page labels and field paths", async () => {
  const fixture = await readFixture();

  const preview = buildModelingImportPreview(fixture);

  assert.deepEqual(
    [...new Set(preview.rows.map((row) => row.collection))],
    ["missionProfiles", "equipmentAssets", "supportResources", "supportActivities"]
  );
  assert.ok(preview.rows.some((row) => row.page === "任务剖面参数" && row.field_path === "objects.missionProfiles[0].durationHours"));
  assert.ok(preview.rows.some((row) => row.page === "装备组成建模" && row.object_id === "j15-radar" && row.field === "mtbfHours"));
  assert.ok(preview.rows.some((row) => row.page === "装备组成建模" && row.object_id === "j15-avionics" && row.field === "aircraftModel" && row.target_path === "components[3].aircraftModel"));
  assert.ok(preview.rows.some((row) => row.page === "保障资源建模" && row.field_path === "objects.supportResources[0].capacity"));
  assert.ok(preview.rows.some((row) => row.page === "保障资源建模" && row.object_id === "carrier-deck" && row.field === "inventory"));
  assert.ok(preview.rows.some((row) => row.page === "保障活动建模" && row.field_path === "objects.supportActivities[0].resourceId"));
  assert.ok(preview.rows.some((row) => row.page === "保障活动建模" && row.object_id === "preflight" && row.field === "jobs"));
});

test("diffModelingImports reports added removed and changed field paths", async () => {
  const published = await readFixture();
  const draft = cloneModelingImportPackage(published);
  const radarIndex = draft.objects.equipmentAssets.findIndex((row) => row.id === "j15-radar");
  draft.objects.equipmentAssets[radarIndex].quantity = 2;
  delete draft.objects.supportResources[0].capacity;
  draft.objects.supportActivities.push({
    id: "refuel-aircraft",
    name: "燃油补给",
    equipmentId: "aircraft-root",
    resourceId: "carrier-deck",
    durationHours: 1
  });

  const diff = diffModelingImports(published, draft);

  assert.ok(diff.rows.some((row) => row.change === "changed" && row.field_path === "objects.equipmentAssets[id=j15-radar].quantity" && row.before === 1 && row.after === 2));
  assert.ok(diff.rows.some((row) => row.change === "removed" && row.field_path === "objects.supportResources[id=carrier-deck].capacity" && row.before === 4));
  assert.ok(diff.rows.some((row) => row.change === "added" && row.field_path === "objects.supportActivities[id=refuel-aircraft].id" && row.after === "refuel-aircraft"));
});

test("diffModelingImports keys imported object rows by stable IDs instead of array indexes", async () => {
  const published = await readFixture();
  const draft = cloneModelingImportPackage(published);
  draft.objects.equipmentAssets = [
    {
      id: "new-pod",
      name: "任务吊舱",
      quantity: 1,
      mtbfHours: 500
    },
    ...draft.objects.equipmentAssets
  ];
  const radarIndex = draft.objects.equipmentAssets.findIndex((row) => row.id === "j15-radar");
  draft.objects.equipmentAssets[radarIndex].quantity = 2;

  const diff = diffModelingImports(published, draft);

  assert.ok(diff.rows.some((row) => row.change === "added" && row.field_path === "objects.equipmentAssets[id=new-pod].id"));
  assert.ok(diff.rows.some((row) => row.change === "changed" && row.object_id === "j15-radar" && row.field_path === "objects.equipmentAssets[id=j15-radar].quantity"));
  assert.ok(!diff.rows.some((row) => row.object_id === "aircraft-root" && row.change === "changed"));
});

test("renderModelingImportWorkbench includes action controls lifecycle version issues and diff rows", async () => {
  const draft = await readFixture();
  const published = cloneModelingImportPackage(draft);
  published.lifecycle = { state: "published", version: 1, referencedRunIds: ["run-smoke-001"] };
  draft.lifecycle = { state: "draft", version: 2, referencedRunIds: ["run-smoke-001"] };
  const radarIndex = draft.objects.equipmentAssets.findIndex((row) => row.id === "j15-radar");
  draft.objects.equipmentAssets[radarIndex].quantity = 2;
  const validation = {
    status: "invalid",
    issues: [
      {
        severity: "error",
        page: "装备组成建模",
        object_id: "j15-radar",
        field_path: `objects.equipmentAssets[${radarIndex}].mtbfHours`,
        message: "mtbfHours 必须大于 0。"
      }
    ]
  };

  const html = renderModelingImportWorkbench({
    importPackage: draft,
    publishedPackage: published,
    validation,
    compileResult: { scenario: { scenario_id: "import-carrier-day-night-001" } }
  });

  for (const action of ["load-fixture", "load-invalid-fixture", "validate", "save-draft", "publish", "compile-scenario"]) {
    assert.match(html, new RegExp(`data-modeling-import-action="${action}"`));
  }
  assert.match(html, /import-carrier-day-night-001/);
  assert.match(html, /draft/);
  assert.match(html, /v2/);
  assert.match(html, new RegExp(`objects\\.equipmentAssets\\[${radarIndex}\\]\\.mtbfHours`));
  assert.match(html, /objects\.equipmentAssets\[id=j15-radar\]\.quantity/);
  assert.match(html, /任务剖面参数/);
  assert.match(html, /建模数据导入/);
});

test("renderModelingImportWorkbench disables publish before save and compile before publish", async () => {
  const draft = await readFixture();

  const html = renderModelingImportWorkbench({
    importPackage: draft,
    canPublish: false,
    canCompile: false
  });

  assert.match(html, /data-modeling-import-action="publish" disabled/);
  assert.match(html, /data-modeling-import-action="compile-scenario" disabled/);
});

test("normalizeModelingImportRecord unwraps publish envelope before preview and diff", async () => {
  const published = await readFixture();
  published.lifecycle = { state: "published", version: 1, referencedRunIds: [] };
  const draft = cloneModelingImportPackage(published);
  draft.lifecycle = { state: "draft", version: 2, referencedRunIds: [] };
  const radarIndex = draft.objects.equipmentAssets.findIndex((row) => row.id === "j15-radar");
  draft.objects.equipmentAssets[radarIndex].quantity = 2;
  const envelope = {
    importId: draft.importId,
    lifecycle: draft.lifecycle,
    validation: { status: "valid", issues: [] },
    draftPackage: draft,
    publishedPackage: published
  };

  const state = normalizeModelingImportRecord(envelope, published);
  const preview = buildModelingImportPreview(state.importPackage);
  const diff = diffModelingImports(state.publishedPackage, state.importPackage);

  assert.ok(Array.isArray(state.importPackage.objects.equipmentAssets));
  assert.ok(Array.isArray(state.publishedPackage.objects.equipmentAssets));
  assert.ok(preview.rows.length > 0);
  assert.ok(diff.rows.some((row) => row.field_path === "objects.equipmentAssets[id=j15-radar].quantity"));
  assert.equal(state.importPackage.objects.equipmentAssets[radarIndex].quantity, 2);
  assert.equal(state.publishedPackage.objects.equipmentAssets[radarIndex].quantity, 1);
});
