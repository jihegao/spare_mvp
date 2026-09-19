import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPortableIntegrity, portableResourcesReady, runtimePaths } from "../desktop/service-manager.mjs";

test("desktop runtime paths use the extracted green package", () => {
  const paths = runtimePaths("C:\\Models\\spare-mvp-2.0-green");
  assert.match(paths.python, /runtime[\\/]python\.exe$/);
  assert.match(paths.applicationRoot, /[\\/]app$/);
  assert.match(paths.startScript, /scripts[\\/]start-portable\.ps1$/);
  assert.match(paths.stopScript, /scripts[\\/]stop-portable\.ps1$/);
  assert.match(paths.stateFile, /data[\\/]active-ports\.json$/);
});

test("green package readiness is entirely package-local", () => {
  const paths = runtimePaths("Z:\\missing-green-package");
  assert.equal(portableResourcesReady(paths), false);
});

test("portable integrity invokes only the bundled Python verifier", async () => {
  const paths = runtimePaths(process.cwd());
  const calls = [];
  await assert.rejects(assertPortableIntegrity(paths, async (...args) => calls.push(args)), /绿色版文件不完整/);
  assert.deepEqual(calls, []);
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
});
