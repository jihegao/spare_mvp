import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  ORIGINAL_SNIPPET,
  PATCHED_SNIPPET,
  applyCollectorPatch,
  patchCollectorSource,
  sha256,
} from "../desktop/scripts/patch-electron-builder-collector.mjs";

function collectorFixture() {
  return `"use strict";
const path = require("path");
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const builder_util_1 = require("builder-util");
class NodeModulesCollector {
  async streamCollectorCommandToJsonFile(command, args, cwd, tempOutputFile) {
    const execName = path.basename(command, path.extname(command));
${ORIGINAL_SNIPPET}
  }
}
exports.NodeModulesCollector = NodeModulesCollector;
`;
}

function controlledCollector(source) {
  const child = new EventEmitter();
  child.stdout = { pipe() {} };
  child.stderr = new EventEmitter();
  const outStream = new EventEmitter();
  outStream.close = () => {};
  outStream.end = () => {};
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === "path") return path;
      if (specifier === "fs") return { createWriteStream: () => outStream };
      if (specifier === "child_process") return { spawn: () => child };
      if (specifier === "builder-util") return { log: { debug() {} } };
      throw new Error(`unexpected require: ${specifier}`);
    },
  });
  vm.runInContext(source, context);
  return { collector: new module.exports.NodeModulesCollector(), child, outStream };
}

async function nextTurn() {
  await new Promise(resolve => setImmediate(resolve));
}

test("patched collector does not resolve on child close before output finish", async () => {
  const original = collectorFixture();
  const unpatched = controlledCollector(original);
  let unpatchedSettled = false;
  const unpatchedPromise = unpatched.collector
    .streamCollectorCommandToJsonFile("npm", ["list"], process.cwd(), "fixture.json")
    .then(() => { unpatchedSettled = true; });
  unpatched.child.emit("close", 0);
  await nextTurn();
  assert.equal(unpatchedSettled, true, "fixture must reproduce the original close/read race");
  await unpatchedPromise;

  const patchedSource = patchCollectorSource(original, { expectedSourceSha256: sha256(original) }).source;
  const patched = controlledCollector(patchedSource);
  let patchedSettled = false;
  const patchedPromise = patched.collector
    .streamCollectorCommandToJsonFile("npm", ["list"], process.cwd(), "fixture.json")
    .then(() => { patchedSettled = true; });
  patched.child.emit("close", 0);
  await nextTurn();
  assert.equal(patchedSettled, false, "collector must wait for the output write stream");
  patched.outStream.emit("finish");
  await patchedPromise;
  assert.equal(patchedSettled, true);
});

test("collector patch is bound to the exact trusted source and idempotent", () => {
  const original = collectorFixture();
  const expectedSourceSha256 = sha256(original);
  const first = patchCollectorSource(original, { expectedSourceSha256 });
  assert.equal(first.changed, true);
  assert.equal(first.source.replace(PATCHED_SNIPPET, ORIGINAL_SNIPPET), original, "patch must not alter collector code outside the bound snippet");
  const second = patchCollectorSource(first.source, { expectedSourceSha256 });
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});

test("collector patch fails closed on source hash or expected snippet drift", () => {
  const original = collectorFixture();
  assert.throws(
    () => patchCollectorSource(`${original}\n// drift`, { expectedSourceSha256: sha256(original) }),
    /SHA-256|drift/i,
  );
  const snippetDrift = original.replace("outStream.close();", "outStream.destroy();");
  assert.throws(
    () => patchCollectorSource(snippetDrift, { expectedSourceSha256: sha256(snippetDrift) }),
    /snippet|片段|drift/i,
  );
});

test("filesystem patch is idempotent and rejects the wrong app-builder-lib version", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "spare-builder-patch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "node_modules/app-builder-lib");
  const collectorFile = path.join(packageRoot, "out/node-module-collector/nodeModulesCollector.js");
  await mkdir(path.dirname(collectorFile), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: "26.0.20" }));
  const original = collectorFixture();
  await writeFile(collectorFile, original);
  const expectedSourceSha256 = sha256(original);

  assert.equal((await applyCollectorPatch({ desktopRoot: root, expectedSourceSha256 })).changed, true);
  assert.equal((await applyCollectorPatch({ desktopRoot: root, expectedSourceSha256 })).changed, false);

  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: "26.0.21" }));
  await assert.rejects(
    applyCollectorPatch({ desktopRoot: root, expectedSourceSha256 }),
    /Unsupported app-builder-lib version/,
  );
});

test("desktop build entry keeps dependency and ASAR contracts unchanged", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.dependencies, { archiver: "7.0.1" });
  assert.deepEqual(packageJson.devDependencies, { electron: "38.1.2", "electron-builder": "26.0.20" });
  assert.equal(packageJson.build.asar, undefined);
  assert.deepEqual(packageJson.build.files, [
    "main.mjs", "preload.cjs", "service-manager.mjs", "diagnostics.mjs", "renderer/**/*", "package.json",
  ]);
  assert.equal(
    packageJson.scripts["dist:win"],
    "node scripts/patch-electron-builder-collector.mjs && electron-builder --win dir --x64 && node scripts/write-build-provenance.mjs ../dist/desktop-installer/win-unpacked",
  );
  const sourceFiles = (await readFile(new URL("../packaging/green/source-files.txt", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(sourceFiles.filter(file => file === "desktop/scripts/patch-electron-builder-collector.mjs").length, 1);
  assert.equal(sourceFiles.filter(file => file === "desktop/scripts/write-build-provenance.mjs").length, 1);
  const greenBuilder = await readFile(new URL("../packaging/green/Build-GreenPackage.ps1", import.meta.url), "utf8");
  assert.match(greenBuilder, /desktop-build-provenance\.json/);
  assert.match(greenBuilder, /verify-green-inputs\.py/);
  assert.match(greenBuilder, /python\.exe'\) -X utf8 -I -B \(Join-Path \$repo 'packaging\\green\\verify-green-inputs\.py'\)/);
  assert.match(greenBuilder, /--portable \$staging --desktop \$staging --green-manifest \$validatedGreenManifest/);
  assert.ok(greenBuilder.indexOf("verify-green-inputs.py") < greenBuilder.indexOf("Move-Item -LiteralPath $desktopExecutable.FullName"));
});
