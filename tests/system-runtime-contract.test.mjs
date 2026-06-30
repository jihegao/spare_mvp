import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("active runtime entrypoints use the single Mesa test environment", async () => {
  const files = [
    "../.gitignore",
    "../README.md",
    "../agent.md",
    "../scripts/start-system.sh",
    "../src/spare_mvp_abm/contract_server.py",
    "../src/spare_mvp_abm/aviation_support/README.md",
  ];

  for (const file of files) {
    const content = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(content, /\.abm-mesa-test-env/);
    assert.doesNotMatch(content, /\.abm-mesa-env/);
  }
});

test("system npm scripts expose persistent start and stop commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.scripts["start:system"], "bash scripts/start-system.sh start");
  assert.equal(packageJson.scripts["stop:system"], "bash scripts/stop-system.sh");
});

test("start-system defaults app backend to file SQLite and supports stop mode through stop script", async () => {
  const script = await readFile(new URL("../scripts/start-system.sh", import.meta.url), "utf8");
  const stopScript = await readFile(new URL("../scripts/stop-system.sh", import.meta.url), "utf8");

  assert.match(script, /MODE="\$\{1:-start\}"/);
  assert.match(script, /DATABASE_PATH="\$\{DATABASE_PATH:-\$RUN_DIR\/spare_mvp\.sqlite3\}"/);
  assert.match(script, /--database "\$DATABASE_PATH"/);
  assert.match(script, /case "\$MODE" in/);
  assert.match(script, /stop\)/);
  assert.match(script, /stop_system/);
  assert.match(script, /start\)/);
  assert.match(stopScript, /start-system\.sh" stop/);
});

test("direct backend CLI defaults to the same persistent system-start SQLite path", async () => {
  const source = await readFile(new URL("../src/spare_mvp_backend/http_server.py", import.meta.url), "utf8");

  assert.doesNotMatch(source, /parser\.add_argument\("--database", default=":memory:"\)/);
  assert.match(source, /default_database_path = Path\(args\.repo_root\) \/ "runs" \/ "system-start" \/ "spare_mvp\.sqlite3"/);
  assert.match(source, /database_path=args\.database or default_database_path/);
});

test("M9.8 start-system does not launch independent-mesa as a platform dependency", async () => {
  const script = await readFile(new URL("../scripts/start-system.sh", import.meta.url), "utf8");

  assert.doesNotMatch(script, /INDEPENDENT_MESA_PORT/);
  assert.doesNotMatch(script, /independent-mesa\/server\.py/);
  assert.doesNotMatch(script, /independent-mesa\.pid/);
  assert.doesNotMatch(script, /wait_for_port "\$INDEPENDENT_MESA_PORT"/);
  assert.doesNotMatch(script, /Schemes: http:\/\/\$HOST:\$INDEPENDENT_MESA_PORT\//);
});

test("retired independent-mesa source tree is removed from the active repository", async () => {
  await assert.rejects(
    stat(new URL("../independent-mesa/", import.meta.url)),
    { code: "ENOENT" }
  );
});

test("browser smoke covers M5 import and run restoration after backend restart", async () => {
  const smoke = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /system-management-project-data-management/);
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
