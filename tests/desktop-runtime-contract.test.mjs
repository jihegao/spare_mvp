import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPortableIntegrity, portableResourcesReady, runningState, runtimePaths } from "../desktop/service-manager.mjs";

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
  };
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
    frontend_url: "http://127.0.0.1:4173/front/",
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
  assert.equal(urls.length, 2);
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
  assert.match(renderer, /桌面启动桥接加载失败/);
  assert.match(renderer, /if \(window\.spareDesktop\)/);
  assert.match(renderer, /无需 Docker、WSL 或管理员权限/);
  assert.doesNotMatch(renderer, /installRuntime|restartComputer|重新启动 Windows/);
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
  assert.match(portablePackager, /integrity-cache\.json/);
  assert.match(main, /assertPortableIntegrity\(runtimePathsValue, sendProgress\)/);
  const serviceManager = await readFile(new URL("../desktop/service-manager.mjs", import.meta.url), "utf8");
  assert.match(serviceManager, /child\.once\("exit"/);
  assert.doesNotMatch(serviceManager, /child\.once\("close"/);
});
