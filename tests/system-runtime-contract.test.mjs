import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  assert.equal(packageJson.scripts["start:system:with-contract-provider"], "bash scripts/start-system.sh start --with-contract-provider");
  assert.equal(packageJson.scripts["stop:system"], "bash scripts/stop-system.sh");
});

test("start-system defaults app backend to file SQLite and supports stop mode through stop script", async () => {
  const script = await readFile(new URL("../scripts/start-system.sh", import.meta.url), "utf8");
  const stopScript = await readFile(new URL("../scripts/stop-system.sh", import.meta.url), "utf8");
  const startSystemSource = script.slice(
    script.indexOf("start_system()"),
    script.indexOf("case \"$MODE\" in")
  );

  assert.match(script, /MODE="\$\{1:-start\}"/);
  assert.match(script, /DATABASE_PATH="\$\{DATABASE_PATH:-\$RUN_DIR\/spare_mvp\.sqlite3\}"/);
  assert.match(script, /--database "\$DATABASE_PATH"/);
  assert.match(script, /case "\$MODE" in/);
  assert.match(script, /stop\)/);
  assert.match(script, /stop_system/);
  assert.match(script, /start\)/);
  assert.match(script, /restart\)\s+stop_start_targets\s+SKIP_INITIAL_STOP=1\s+start_system/s);
  assert.match(startSystemSource, /stop_start_targets/);
  assert.doesNotMatch(startSystemSource, /stop_system/);
  assert.match(stopScript, /start-system\.sh" stop/);
});

test("database backup and restore scripts preserve the system SQLite database", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "spare-mvp-db-backup-"));
  const databasePath = join(tempRoot, "spare_mvp.sqlite3");
  const backupDir = join(tempRoot, "backups");
  const scriptEnv = {
    ...process.env,
    DATABASE_PATH: databasePath,
    BACKUP_DIR: backupDir
  };

  await execFileAsync("python3", [
    "-c",
    [
      "import sqlite3, sys",
      "conn = sqlite3.connect(sys.argv[1])",
      "conn.execute('create table marker(value text)')",
      "conn.execute('insert into marker values (?)', ('before-backup',))",
      "conn.commit()",
      "conn.close()",
    ].join("; "),
    databasePath,
  ]);

  const backupResult = await execFileAsync("bash", ["scripts/backup-database.sh", "--label", "runtime-smoke"], {
    env: scriptEnv
  });
  assert.match(backupResult.stdout, /Backup written:/);

  const backupFiles = (await readdir(backupDir)).filter((name) => name.endsWith(".sqlite3"));
  assert.equal(backupFiles.length, 1);
  const backupPath = join(backupDir, backupFiles[0]);

  await execFileAsync("python3", [
    "-c",
    [
      "import sqlite3, sys",
      "conn = sqlite3.connect(sys.argv[1])",
      "conn.execute('delete from marker')",
      "conn.execute('insert into marker values (?)', ('after-backup',))",
      "conn.commit()",
      "conn.close()",
    ].join("; "),
    databasePath,
  ]);

  await assert.rejects(
    execFileAsync("bash", ["scripts/restore-database.sh", backupPath], { env: scriptEnv }),
    /Refusing to overwrite/
  );

  const restoreResult = await execFileAsync("bash", ["scripts/restore-database.sh", "--force", backupPath], {
    env: scriptEnv
  });
  assert.match(restoreResult.stdout, /Database restored:/);

  const restored = await execFileAsync("python3", [
    "-c",
    "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute('select value from marker').fetchone()[0])",
    databasePath,
  ]);
  assert.equal(restored.stdout.trim(), "before-backup");
});

test("start-system treats the Mesa contract provider as an opt-in legacy dev sidecar", async () => {
  const script = await readFile(new URL("../scripts/start-system.sh", import.meta.url), "utf8");
  const stopStartTargetsSource = script.slice(
    script.indexOf("stop_start_targets()"),
    script.indexOf("stop_system()")
  );
  const stopSystemSource = script.slice(
    script.indexOf("stop_system()"),
    script.indexOf("start_system()")
  );
  const startSystemSource = script.slice(
    script.indexOf("start_system()"),
    script.indexOf("case \"$MODE\" in")
  );

  assert.match(script, /WITH_CONTRACT_PROVIDER=0/);
  assert.match(script, /--with-contract-provider/);
  assert.match(script, /legacy\/dev Mesa contract provider/);
  assert.match(stopStartTargetsSource, /stop_app/);
  assert.match(stopStartTargetsSource, /if \[\[ "\$WITH_CONTRACT_PROVIDER" == "1" \]\]/);
  assert.match(stopStartTargetsSource, /stop_contract_provider/);
  assert.match(stopSystemSource, /stop_app/);
  assert.match(stopSystemSource, /stop_contract_provider/);
  assert.match(startSystemSource, /Starting spare_mvp app/);
  assert.match(startSystemSource, /if \[\[ "\$WITH_CONTRACT_PROVIDER" == "1" \]\]/);
  assert.match(startSystemSource, /Starting legacy\/dev Mesa contract provider/);
  assert.match(startSystemSource, /wait_for_port "\$APP_PORT" "spare_mvp app"/);
  assert.doesNotMatch(startSystemSource, /wait_for_port "\$CONTRACT_PORT" "Mesa contract provider"\n\s*\n\s*echo "App PID/s);
});

test("direct backend CLI defaults to the same persistent system-start SQLite path", async () => {
  const source = await readFile(new URL("../src/spare_mvp_backend/http_server.py", import.meta.url), "utf8");

  assert.doesNotMatch(source, /parser\.add_argument\("--database", default=":memory:"\)/);
  assert.match(source, /default_database_path = Path\(args\.repo_root\) \/ "runs" \/ "system-start" \/ "spare_mvp\.sqlite3"/);
  assert.match(source, /database_path=args\.database or default_database_path/);
});

test("canonical runtime wording and default artifact output avoid stale M3 smoke labels", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const docsReadme = await readFile(new URL("../docs/README.md", import.meta.url), "utf8");
  const productRoadmap = await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8");
  const agentDoc = await readFile(new URL("../agent.md", import.meta.url), "utf8");
  const contractsReadme = await readFile(new URL("../contracts/README.md", import.meta.url), "utf8");
  const runtimeAudit = await readFile(new URL("../docs/archive/deprecated/architecture-audit/2026-07-spare-mvp-runtime-boundary-audit.md", import.meta.url), "utf8");
  const m7Design = await readFile(new URL("../docs/archive/deprecated/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md", import.meta.url), "utf8");
  const runIntentPlan = await readFile(new URL("../docs/archive/deprecated/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md", import.meta.url), "utf8");
  const m7Plan = await readFile(new URL("../docs/archive/deprecated/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md", import.meta.url), "utf8");
  const httpServer = await readFile(new URL("../src/spare_mvp_backend/http_server.py", import.meta.url), "utf8");
  const runService = await readFile(new URL("../src/spare_mvp_backend/run_service.py", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../src/spare_mvp_contract/adapter.py", import.meta.url), "utf8");

  const canonicalPath = /RunIntent -> \/api\/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite \+ artifacts/;
  for (const content of [readme, docsReadme, productRoadmap, agentDoc, contractsReadme, m7Design, runIntentPlan, m7Plan]) {
    assert.match(content, canonicalPath);
    assert.doesNotMatch(content, /RunService -> artifacts/);
  }
  assert.match(readme, /contract_server\.py :8521.*legacy\/dev sidecar/);
  assert.match(docsReadme, /contract_server\.py :8521.*legacy\/dev sidecar/);
  assert.match(productRoadmap, /--with-contract-provider/);
  assert.match(agentDoc, /--with-contract-provider/);
  assert.doesNotMatch(agentDoc, /启动 smoke run/);
  assert.doesNotMatch(agentDoc, /M3-1 同源后端路径用 .*http_server/);
  assert.doesNotMatch(productRoadmap, /start-system\.sh` 只启动平台同源 app 和 Mesa contract provider/);
  assert.match(httpServer, /root \/ "runs" \/ "canonical-api"/);
  assert.match(httpServer, /parser\.add_argument\("--output-dir", default="runs\/canonical-api"\)/);
  assert.doesNotMatch(runtimeAudit, /runs\/m3-0-http/);
  assert.doesNotMatch(httpServer, /runs\/m3-0-http|m3-0-http|M3 backend API/);
  assert.match(runService, /canonical \/api\/runs local synchronous executor/);
  assert.doesNotMatch(runService, /smoke executor/);
  assert.match(adapter, /aircraft_support_v1 product runtime/);
  assert.doesNotMatch(adapter, /governed Mesa smoke model|Choose smoke/);
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

test("browser smoke covers M5 import restoration and embedded Lite Mesa detail after restart", async () => {
  const smoke = await readFile(new URL("../reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /system-management-project-data-management/);
  assert.match(smoke, /data-modeling-import-action="save-draft"/);
  assert.match(smoke, /data-modeling-import-action="publish"/);
  assert.match(smoke, /restartBackendServer/);
  assert.match(smoke, /已从后端恢复导入草稿和发布快照/);
  assert.match(smoke, /afterRestartImport/);
  assert.match(smoke, /01-lite-mesa-detail/);
  assert.match(smoke, /afterRefreshLiteMesa/);
  assert.match(smoke, /Embedded Lite Mesa detail created a formal backend run after refresh/);
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
