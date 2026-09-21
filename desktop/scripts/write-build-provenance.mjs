#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const desktopDirectory = path.resolve(process.argv[2] || path.join(repoRoot, "dist", "desktop-installer", "win-unpacked"));

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

const sourceNames = (await readFile(path.join(repoRoot, "packaging", "green", "source-files.txt"), "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("desktop/"));
const sourceCommit = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceFiles = Object.fromEntries(await Promise.all(sourceNames.map(async (name) => [
  name,
  await sha256(path.join(repoRoot, name)),
])));
const executables = (await readdir(desktopDirectory)).filter((name) => name.toLowerCase().endsWith(".exe"));
if (executables.length !== 1) {
  throw new Error(`Expected exactly one Electron executable, found: ${executables.join(", ") || "none"}`);
}
const appAsar = path.join(desktopDirectory, "resources", "app.asar");
const executable = path.join(desktopDirectory, executables[0]);
const provenance = {
  format_version: 1,
  source_commit: sourceCommit,
  source_files: sourceFiles,
  app_asar_sha256: await sha256(appAsar),
  executable: executables[0],
  executable_sha256: await sha256(executable),
};
await writeFile(
  path.join(desktopDirectory, "desktop-build-provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(provenance));
