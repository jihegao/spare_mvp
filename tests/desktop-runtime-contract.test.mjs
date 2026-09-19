import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composeArguments, composeEnvironment, dockerAvailable, findFreePort, runtimePaths } from "../desktop/service-manager.mjs";

test("desktop runtime paths keep immutable resources separate from user state", () => {
  const paths = runtimePaths("C:\\Program Files\\SPARE\\resources", "C:\\Users\\user\\AppData\\Roaming");
  assert.match(paths.imageTar, /desktop-resources[\\/]runtime[\\/]spare-mvp-image\.tar$/);
  assert.match(paths.dockerInstaller, /prerequisites[\\/]Docker Desktop Installer\.exe$/);
  assert.match(paths.wslInstaller, /prerequisites[\\/]wsl\.msi$/);
  assert.match(paths.stateFile, /spare-mvp-desktop[\\/]active-state\.json$/);
  assert.doesNotMatch(paths.stateFile, /desktop-resources/);
});

test("compose invocation is scoped to the product project and fixed compose file", () => {
  assert.deepEqual(composeArguments("C:\\SPARE\\compose.yaml", "down"), [
    "compose", "--project-name", "spare-mvp-desktop-rc1", "--file", "C:\\SPARE\\compose.yaml", "down",
  ]);
});

test("compose environment binds selected ports and does not use latest", () => {
  const env = composeEnvironment({ image: "spare-mvp:2.0-rc1-abc123", backendPort: 18473, solaraPort: 18475, exportDir: "C:\\SPARE Data" });
  assert.equal(env.SPARE_BACKEND_PORT, "18473");
  assert.equal(env.SPARE_SOLARA_PORT, "18475");
  assert.equal(env.SPARE_IMAGE, "spare-mvp:2.0-rc1-abc123");
  assert.doesNotMatch(env.SPARE_IMAGE, /latest/);
});

test("dynamic port selection skips occupied ports", async () => {
  const observed = [];
  const port = await findFreePort(23000, new Set([23001]), async (candidate) => {
    observed.push(candidate);
    return candidate === 23002;
  });
  assert.equal(port, 23002);
  assert.deepEqual(observed, [23000, 23002]);
});

test("Docker readiness check has a finite timeout", async () => {
  let invocation;
  const available = await dockerAvailable(async (...args) => {
    invocation = args;
    throw new Error("not ready");
  });
  assert.equal(available, false);
  assert.deepEqual(invocation, [
    "docker.exe",
    ["info", "--format", "{{.ServerVersion}}"],
    { timeoutMs: 15_000 },
  ]);
});

test("desktop compose and installer preserve security and restart boundaries", async () => {
  const compose = await readFile(new URL("../deploy/desktop/compose.yaml", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:\$\{SPARE_BACKEND_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{SPARE_SOLARA_PORT/);
  assert.match(compose, /SPARE_IMAGE:\?SPARE_IMAGE is required/);
  assert.doesNotMatch(compose, /latest/);
  assert.match(compose, /name: spare-mvp-desktop-rc1/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /--if-missing/);

  const installer = await readFile(new URL("../packaging/desktop/install-runtime.ps1", import.meta.url), "utf8");
  assert.match(installer, /Microsoft-Windows-Subsystem-Linux/);
  assert.match(installer, /VirtualMachinePlatform/);
  assert.match(installer, /RunOnce/);
  assert.match(installer, /Write-State -Status 'starting'/);
  assert.match(installer, /Write-State -Status 'failed'/);
  assert.match(installer, /ProgramFiles 'Docker\\Docker\\Docker Desktop\.exe'/);
  assert.doesNotMatch(installer, /--accept-license/);
});

test("Electron windows disable Node integration and isolate the launcher bridge", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer/app.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  const html = await readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /preload\.cjs/);
  assert.match(main, /EncodedCommand/);
  assert.match(main, /-PassThru/);
  assert.match(main, /exit \$process\.ExitCode/);
  assert.match(main, /install-state\.json/);
  assert.match(main, /startsWith\("file:\/\/"\)/);
  assert.match(preload, /require\("electron"\)/);
  assert.doesNotMatch(preload, /\bimport\s/);
  assert.ok(packageJson.build.files.includes("preload.cjs"));
  assert.ok(!packageJson.build.files.includes("preload.mjs"));
  assert.match(renderer, /桌面启动桥接加载失败/);
  assert.match(renderer, /if \(window\.spareDesktop\)/);
  assert.match(renderer, /status\.installState\?\.status === "reboot_required"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
});
