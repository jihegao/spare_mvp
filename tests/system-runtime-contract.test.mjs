import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("system npm scripts expose persistent start and stop commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.scripts["start:system"], "bash scripts/start-system.sh start");
  assert.equal(packageJson.scripts["stop:system"], "bash scripts/start-system.sh stop");
});

test("start-system defaults app backend to file SQLite and supports stop mode", async () => {
  const script = await readFile(new URL("../scripts/start-system.sh", import.meta.url), "utf8");

  assert.match(script, /MODE="\$\{1:-start\}"/);
  assert.match(script, /DATABASE_PATH="\$\{DATABASE_PATH:-\$RUN_DIR\/spare_mvp\.sqlite3\}"/);
  assert.match(script, /--database "\$DATABASE_PATH"/);
  assert.match(script, /case "\$MODE" in/);
  assert.match(script, /stop\)/);
  assert.match(script, /stop_system/);
  assert.match(script, /start\)/);
});

test("browser smoke covers M5 import and run restoration after backend restart", async () => {
  const smoke = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /system-management-modeling-import-workbench/);
  assert.match(smoke, /data-modeling-import-action="save-draft"/);
  assert.match(smoke, /data-modeling-import-action="publish"/);
  assert.match(smoke, /restartBackendServer/);
  assert.match(smoke, /已从后端恢复导入草稿和发布快照/);
  assert.match(smoke, /afterRestartImport/);
  assert.match(smoke, /afterRestartRun/);
});

test("system browser smoke verifies modeling page buttons provide observable reactions", async () => {
  const smoke = await readFile(new URL("../reports/system-smoke/browser-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /verifyModelingButtonsReact/);
  assert.match(smoke, /data-basic-mission-add/);
  assert.match(smoke, /data-composite-task-add/);
  assert.match(smoke, /data-composite-task-item-add/);
  assert.match(smoke, /data-equipment-add-node/);
  assert.match(smoke, /data-support-activity-job-batch-delete/);
});
