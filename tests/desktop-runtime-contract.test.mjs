import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPortableIntegrity,
  managedRuntimeUrls,
  portableResourcesReady,
  readActiveState,
  runningState,
  runtimePaths,
  startServices,
} from "../desktop/service-manager.mjs";

function pathContract(packageRoot, root = packageRoot) {
  return {
    package_root: packageRoot,
    installation_id: "a".repeat(24),
    data_root: path.join(root, "persistent"),
    database: path.join(root, "persistent", "spare_mvp.sqlite3"),
    instance_root: path.join(root, "instance"),
    state_file: path.join(root, "instance", "active-ports.json"),
    pid_root: path.join(root, "instance", "pids"),
    logs_dir: path.join(root, "instance", "logs"),
    diagnostics_dir: path.join(root, "instance", "diagnostics"),
    integrity_cache: path.join(root, "instance", "integrity-cache.json"),
    binding_inventory_mutex: "Global\\SpareMvpBindingInventory_v1",
  };
}

async function writeActiveState(paths, overrides = {}) {
  await mkdir(path.dirname(paths.stateFile), { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify({
    format_version: 2,
    installation_id: paths.installationId,
    package_root: paths.packageRoot,
    data_root: paths.dataRoot,
    backend_port: 4173,
    solara_port: 8765,
    backend_pid: 1001,
    solara_pid: 1002,
    frontend_url: "http://127.0.0.1:4173/front/?solaraUrl=http%3A%2F%2F127.0.0.1%3A8765",
    solara_url: "http://127.0.0.1:8765",
    ...overrides,
  }));
}

test("desktop runtime paths use the extracted green package", () => {
  const packageRoot = path.resolve("portable-contract-fixture");
  const paths = runtimePaths(packageRoot, { pathContract: pathContract(packageRoot) });
  assert.match(paths.python, /runtime[\\/]python\.exe$/);
  assert.match(paths.applicationRoot, /[\\/]app$/);
  assert.match(paths.startScript, /scripts[\\/]start-portable\.ps1$/);
  assert.match(paths.stopScript, /scripts[\\/]stop-portable\.ps1$/);
  assert.match(paths.stateFile, /instance[\\/]active-ports\.json$/);
  assert.match(paths.integrityCache, /instance[\\/]integrity-cache\.json$/);
});

test("green package readiness is entirely package-local", () => {
  const paths = runtimePaths("Z:\\missing-green-package");
  assert.equal(portableResourcesReady(paths), false);
});

test("portable integrity invokes only the bundled Python verifier", async () => {
  const paths = runtimePaths(process.cwd());
  const calls = [];
  await assert.rejects(assertPortableIntegrity(paths, () => {}, async (...args) => calls.push(args)), /绿色版文件不完整/);
  assert.deepEqual(calls, []);
});

test("portable integrity passes the isolated instance cache path explicitly", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-desktop-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "runtime"), { recursive: true });
  await mkdir(path.join(root, "app"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  for (const relative of [
    "runtime/python.exe", "manifest.json", "scripts/start-portable.ps1", "scripts/stop-portable.ps1",
    "scripts/portable-package.py", "scripts/portable-paths.py", "scripts/portable-data.py",
    "scripts/portable-data-guard.py",
  ]) {
    await writeFile(path.join(root, relative), "fixture");
  }
  const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
  const calls = [];
  await assertPortableIntegrity(paths, () => {}, async (...args) => calls.push(args));
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("--cache-path"));
  assert.equal(calls[0][1][calls[0][1].indexOf("--cache-path") + 1], paths.integrityCache);
});

test("running state requires backend and Solara health for the same installation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-state-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contract = pathContract(root, root);
  const paths = runtimePaths(root, { pathContract: contract });
  await mkdir(path.dirname(paths.stateFile), { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify({
    format_version: 2,
    installation_id: paths.installationId,
    package_root: root,
    data_root: paths.dataRoot,
    backend_port: 4173,
    solara_port: 8765,
    backend_pid: 1001,
    solara_pid: 1002,
    frontend_url: "http://127.0.0.1:4173/front/?solaraUrl=http%3A%2F%2F127.0.0.1%3A8765",
    solara_url: "http://127.0.0.1:8765",
  }));
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: !String(url).includes("8765") }; };
  t.after(() => { globalThis.fetch = originalFetch; });
  const ownershipCalls = [];
  assert.equal(await runningState(paths, async (...args) => ownershipCalls.push(args)), null);
  assert.equal(ownershipCalls.length, 1);
  assert.ok(ownershipCalls[0][1].includes("-CheckOwnershipOnly"));
  assert.deepEqual(urls, [
    "http://127.0.0.1:4173/_spare_mvp/health",
    "http://127.0.0.1:8765/",
  ]);
});

test("managed runtime URLs are derived only from distinct validated localhost ports", () => {
  assert.deepEqual(managedRuntimeUrls(4173, 8765), {
    backendHealthUrl: "http://127.0.0.1:4173/_spare_mvp/health",
    frontendUrl: "http://127.0.0.1:4173/front/?solaraUrl=http%3A%2F%2F127.0.0.1%3A8765",
    solaraUrl: "http://127.0.0.1:8765",
  });
  assert.equal(managedRuntimeUrls(1024, 65535).solaraUrl, "http://127.0.0.1:65535");
  for (const ports of [[0, 8765], [4173, 65536], [4173, 4173], [4173.5, 8765], ["4173", 8765]]) {
    assert.throws(() => managedRuntimeUrls(...ports), /端口/);
  }
});

test("active state rejects non-local or port-mismatched URLs before health checks", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-state-url-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
  await mkdir(path.dirname(paths.stateFile), { recursive: true });
  const baseline = {
    format_version: 2,
    installation_id: paths.installationId,
    package_root: root,
    data_root: paths.dataRoot,
    backend_port: 4173,
    solara_port: 8765,
    backend_pid: 1001,
    solara_pid: 1002,
    frontend_url: "http://127.0.0.1:4173/front/?solaraUrl=http%3A%2F%2F127.0.0.1%3A8765",
    solara_url: "http://127.0.0.1:8765",
  };
  for (const override of [
    { frontend_url: "https://example.com/" },
    { frontend_url: "http://127.0.0.1:9999/front/" },
    { solara_url: "http://example.com:8765" },
    { solara_url: "http://localhost:8765" },
    { backend_port: 80 },
    { solara_port: 4173 },
    { backend_pid: 0 },
    { solara_pid: null },
  ]) {
    await writeFile(paths.stateFile, JSON.stringify({ ...baseline, ...override }));
    await assert.rejects(readActiveState(paths), /运行状态|端口|地址/);
  }
});

test("running state rejects a healthy backend response owned by a different PID", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-state-pid-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
  await mkdir(path.dirname(paths.stateFile), { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify({
    format_version: 2,
    installation_id: paths.installationId,
    package_root: root,
    data_root: paths.dataRoot,
    backend_port: 4173,
    solara_port: 8765,
    backend_pid: 1001,
    solara_pid: 1002,
    frontend_url: "http://127.0.0.1:4173/front/?solaraUrl=http%3A%2F%2F127.0.0.1%3A8765",
    solara_url: "http://127.0.0.1:8765",
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("_spare_mvp/health")
    ? { ok: true, json: async () => ({ service: "spare-mvp-backend", status: "ok", pid: 9999 }) }
    : { ok: true };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await runningState(paths, async () => {}), null);
  globalThis.fetch = async (url) => String(url).includes("_spare_mvp/health")
    ? { ok: true, json: async () => ({ service: "spare-mvp-backend", status: "ok", pid: 1001 }) }
    : { ok: true };
  assert.equal((await runningState(paths, async () => {}))?.backendPid, 1001);
});

test("fresh desktop startup rejects arbitrary HTTP 200 responses without backend identity", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-start-identity-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
  const calls = [];
  const run = async (...args) => {
    calls.push(args);
    if (args[1].includes("-AutoSelectPorts")) await writeActiveState(paths);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(startServices(paths, () => {}, run), /身份|health|后端|服务/);
  assert.equal(calls.filter(([, args]) => args.includes("-AutoSelectPorts")).length, 1);
});

test("fresh desktop startup rejects wrong backend service, status, or PID", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const health of [
    { service: "other-service", status: "ok", pid: 1001 },
    { service: "spare-mvp-backend", status: "starting", pid: 1001 },
    { service: "spare-mvp-backend", status: "ok", pid: 9999 },
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), "spare-start-backend-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
    const run = async (...args) => {
      if (args[1].includes("-AutoSelectPorts")) await writeActiveState(paths);
    };
    globalThis.fetch = async (url) => String(url).includes("_spare_mvp/health")
      ? { ok: true, json: async () => health }
      : { ok: true };
    await assert.rejects(startServices(paths, () => {}, run), /身份|health|后端|服务/);
  }
});

test("fresh desktop startup cleans up once when the returned active state is missing or damaged", async (t) => {
  for (const stateContents of [null, "{not-json"]) {
    const root = await mkdtemp(path.join(tmpdir(), "spare-start-state-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
    const calls = [];
    const run = async (...args) => {
      calls.push(args);
      if (args[1].includes("-AutoSelectPorts") && stateContents !== null) {
        await mkdir(path.dirname(paths.stateFile), { recursive: true });
        await writeFile(paths.stateFile, stateContents);
      }
    };

    await assert.rejects(startServices(paths, () => {}, run), /状态|state|JSON|ENOENT/);
    assert.equal(calls.filter(([, args]) => args.includes("-AutoSelectPorts")).length, 1, "startup must not retry");
    assert.equal(calls.filter(([, args]) => args.includes("-File") && !args.includes("-CheckOwnershipOnly") && !args.includes("-AutoSelectPorts")).length, 1, "failed startup must clean up once");
  }
});

test("fresh desktop startup fails closed when ownership or listener verification fails", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("_spare_mvp/health")
    ? { ok: true, json: async () => ({ service: "spare-mvp-backend", status: "ok", pid: 1001 }) }
    : { ok: true };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const verificationFailure of [
    "backend service ownership could not be verified after process exit",
    "backend PID record owns PID 2001, not state PID 1001 after restart",
    "solara TCP port 8765 belongs to PID 9999",
    "service ownership belongs to an adjacent installation",
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), "spare-start-owner-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const paths = runtimePaths(root, { pathContract: pathContract(root, root) });
    const calls = [];
    const run = async (...args) => {
      calls.push(args);
      const arguments_ = args[1];
      if (arguments_.includes("-AutoSelectPorts")) {
        await writeActiveState(paths);
        return;
      }
      if (arguments_.includes("-CheckOwnershipOnly")) throw new Error(verificationFailure);
    };

    await assert.rejects(startServices(paths, () => {}, run), /ownership|listener|所有权|端口|PID|process/);
    const ownershipCall = calls.find(([, args]) => args.includes("-CheckOwnershipOnly"));
    assert.ok(ownershipCall);
    for (const expected of ["-ExpectedBackendPid", "1001", "-ExpectedBackendPort", "4173", "-ExpectedSolaraPid", "1002", "-ExpectedSolaraPort", "8765"]) {
      assert.ok(ownershipCall[1].includes(expected), `missing ownership argument ${expected}`);
    }
    assert.equal(calls.filter(([, args]) => args.includes("-File") && !args.includes("-CheckOwnershipOnly") && !args.includes("-AutoSelectPorts")).length, 1);
  }
});

test("PowerShell ownership check binds active state PIDs to listener owner PIDs", async () => {
  const stopScript = await readFile(new URL("../scripts/stop-portable.ps1", import.meta.url), "utf8");
  const processHelper = await readFile(new URL("../scripts/portable-process.ps1", import.meta.url), "utf8");
  assert.match(stopScript, /ExpectedBackendPid/);
  assert.match(stopScript, /ExpectedSolaraPid/);
  assert.match(stopScript, /ExpectedBackendPort/);
  assert.match(stopScript, /ExpectedSolaraPort/);
  assert.match(stopScript, /state_file/);
  assert.match(stopScript, /Assert-PortableTcpListenerOwnership/);
  assert.match(processHelper, /Get-NetTCPConnection/);
  assert.match(processHelper, /OwningProcess/);
  assert.match(processHelper, /PreserveRecordOnMismatch/);
});

test("portable startup migrates durable legacy files only when they exist", async () => {
  const startScript = await readFile(new URL("../scripts/start-portable.ps1", import.meta.url), "utf8");
  assert.match(startScript, /\$legacyEntries = @\(Get-ChildItem/);
  assert.match(startScript, /\$legacyWasUsed = \$null -ne \(\$legacyEntries/);
  assert.match(startScript, /\$legacyHasDurableFiles = \$null -ne \(\$legacyEntries/);
  assert.ok(startScript.indexOf("$legacyWasUsed") < startScript.indexOf("Remove-Item -LiteralPath (Join-Path $LegacyDataRoot 'active-ports.json')"));
  assert.match(startScript, /'active-ports\.json', 'integrity-cache\.json', 'pids', 'logs', 'matplotlib', 'diagnostics'/);
  assert.match(startScript, /--preserve-source-before-reuse/);
  assert.match(startScript, /if \(\$legacyWasUsed\) \{ \$migrationArguments \+= '--conflict-after-source-backup' \}/);
  assert.match(startScript, /if \(-not \[bool\]\$Paths\.binding_matches_selected -and \$legacyHasDurableFiles\) \{[\s\S]{0,300}migrate-files/);
  const acquire = startScript.indexOf("$bindingInventoryMutex = Acquire-SharedDataMutex");
  const lockedRescan = startScript.indexOf("$lockedPathJson = & $Python @pathArguments");
  const bindingWrite = startScript.indexOf("--write-binding");
  const release = startScript.indexOf("Release-SharedDataMutex -Mutex $bindingInventoryMutex");
  assert.ok(acquire >= 0 && acquire < lockedRescan && lockedRescan < bindingWrite && bindingWrite < release);
});

test("Electron windows disable Node integration and isolate the launcher bridge", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer/app.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  const html = await readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
  const greenBuilder = await readFile(new URL("../packaging/green/Build-GreenPackage.ps1", import.meta.url), "utf8");
  const extractor = await readFile(new URL("../packaging/green/GreenExtractor.cs", import.meta.url), "utf8");
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /preload\.cjs/);
  assert.match(main, /assertPortableIntegrity/);
  assert.match(main, /portableResourcesReady/);
  assert.doesNotMatch(main, /Docker|WSL|shutdown\.exe|runtime:install|runtime:restart/);
  assert.match(main, /startsWith\("file:\/\/"\)/);
  assert.match(preload, /require\("electron"\)/);
  assert.doesNotMatch(preload, /\bimport\s/);
  assert.ok(packageJson.build.files.includes("preload.cjs"));
  assert.ok(!packageJson.build.files.includes("preload.mjs"));
  assert.deepEqual(packageJson.build.win.target, ["dir"]);
  assert.equal(packageJson.build.extraResources, undefined);
  assert.equal(packageJson.name, "spare-mvp-desktop");
  assert.equal(packageJson.build.appId, "cn.sparemvp.desktop");
  assert.equal(packageJson.build.artifactName, "spare-mvp-2.0-green.${ext}");
  assert.equal(packageJson.build.productName, "备件规划及任务可靠度验证评估平台 V2.0");
  assert.equal(packageJson.author, "备件规划及任务可靠度验证评估平台");
  assert.doesNotMatch(packageJson.description, /spare[_-]mvp/i);
  assert.match(renderer, /桌面启动桥接加载失败/);
  assert.match(renderer, /if \(window\.spareDesktop\)/);
  assert.match(renderer, /正在启动包内服务/);
  assert.doesNotMatch(renderer, /无需 Docker、WSL 或管理员权限/);
  assert.doesNotMatch(html, /SPARE MVP 2\.0|绿色版正在启动自带的 Windows 原生运行环境|无需 Docker、WSL、管理员权限或重启 Windows/);
  assert.match(html, /<title>备件规划及任务可靠度验证评估平台 V2\.0<\/title>/);
  assert.match(html, /<h1 id="title">备件规划及任务可靠度验证评估平台 V2\.0<\/h1>/);
  assert.doesNotMatch(renderer, /installRuntime|restartComputer|重新启动 Windows/);
  assert.match(main, /runtime:diagnostics/);
  assert.match(main, /managedRuntimeUrls\(runtimeState\.backendPort, runtimeState\.solaraPort\)/);
  assert.match(main, /runtimeState\.frontendUrl !== urls\.frontendUrl \|\| runtimeState\.solaraUrl !== urls\.solaraUrl/);
  assert.match(main, /createBusinessWindow\(activeRuntime\.state\)/);
  assert.match(preload, /exportDiagnostics/);
  assert.doesNotMatch(main, /runtime:open-diagnostics|shell\.openPath/);
  assert.doesNotMatch(preload, /openDiagnostics|runtime:open-diagnostics/);
  assert.doesNotMatch(renderer, /diagnostics-action|openDiagnostics|打开诊断目录/);
  assert.doesNotMatch(html, /diagnostics-action|打开诊断目录/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(greenBuilder, /portable-package\.py'\) seal --root \$staging/);
  assert.match(greenBuilder, /Destination already exists/);
  assert.match(extractor, /FolderBrowserDialog/);
  assert.match(extractor, /VerifyPayload/);
  assert.match(extractor, /tar\.exe/);
  assert.match(extractor, /--extract-to/);
  assert.match(extractor, /--no-launch/);
  const portablePackager = await readFile(new URL("../scripts/portable-package.py", import.meta.url), "utf8");
  assert.match(portablePackager, /VERIFY_PROGRESS/);
  assert.match(portablePackager, /verify-cached/);
  assert.match(portablePackager, /--cache-path/);
  assert.match(main, /assertPortableIntegrity\(runtimePathsValue, sendProgress\)/);
  const serviceManager = await readFile(new URL("../desktop/service-manager.mjs", import.meta.url), "utf8");
  assert.match(serviceManager, /child\.once\("exit"/);
  assert.doesNotMatch(serviceManager, /child\.once\("close"/);
});
