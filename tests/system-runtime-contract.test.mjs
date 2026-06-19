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

test("browser backend smoke covers persisted run restoration and offline blocking", async () => {
  const smoke = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /clickMonteCarloStart/);
  assert.match(smoke, /beforeRefresh/);
  assert.match(smoke, /afterRefresh/);
  assert.match(smoke, /offline-demo-run/);
  assert.match(smoke, /apiEvents/);
});

test("system browser smoke verifies project flow modeling edits and visual results", async () => {
  const smoke = await readFile(new URL("../reports/system-smoke/browser-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /openSecondary/);
  assert.match(smoke, /clickFeature/);
  assert.match(smoke, /spare-planning-built-in-scenario/);
  assert.match(smoke, /距任务区\(km\)/);
  assert.match(smoke, /spare-planning-monte-carlo-config/);
  assert.match(smoke, /spare-planning-visual-start-stop/);
});
