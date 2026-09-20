#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET_VERSION = "26.0.20";
export const TARGET_SOURCE_SHA256 = "04f1f1fbb1a3c5df9b5979c63d86f2dd2fcd2dc331ae0bed8d1bceb31751d547";

export const ORIGINAL_SNIPPET = `        await new Promise((resolve, reject) => {
            const outStream = (0, fs_1.createWriteStream)(tempOutputFile);
            const child = (0, child_process_1.spawn)(command, args, {
                cwd,
                shell: false, // required to prevent console logs polution from shell profile loading when \`true\`
            });
            let stderr = "";
            child.stdout.pipe(outStream);
            child.stderr.on("data", chunk => {
                stderr += chunk.toString();
            });
            child.on("error", err => {
                reject(new Error(\`Spawn failed: \${err.message}\`));
            });
            child.on("close", code => {
                outStream.close();
                // https://github.com/npm/npm/issues/17624
                if (code === 1 && execName.toLowerCase() === "npm" && args.includes("list")) {
                    builder_util_1.log.debug({ code, stderr }, "\`npm list\` returned non-zero exit code, but it MIGHT be expected (https://github.com/npm/npm/issues/17624). Check stderr for details.");
                    // This is a known issue with npm list command, it can return code 1 even when the command is "technically" successful
                    resolve();
                    return;
                }
                if (code !== 0) {
                    return reject(new Error(\`Process exited with code \${code}:\\n\${stderr}\`));
                }
                resolve();
            });
        });`;

export const PATCHED_SNIPPET = `        await new Promise((resolve, reject) => {
            const outStream = (0, fs_1.createWriteStream)(tempOutputFile);
            const child = (0, child_process_1.spawn)(command, args, {
                cwd,
                shell: false, // required to prevent console logs polution from shell profile loading when \`true\`
            });
            let stderr = "";
            let childClosed = false;
            let childExitCode = null;
            let outputFinished = false;
            let settled = false;
            const rejectOnce = error => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(error);
            };
            const settleIfReady = () => {
                if (settled || !childClosed || !outputFinished) {
                    return;
                }
                settled = true;
                const code = childExitCode;
                // https://github.com/npm/npm/issues/17624
                if (code === 1 && execName.toLowerCase() === "npm" && args.includes("list")) {
                    builder_util_1.log.debug({ code, stderr }, "\`npm list\` returned non-zero exit code, but it MIGHT be expected (https://github.com/npm/npm/issues/17624). Check stderr for details.");
                    // This is a known issue with npm list command, it can return code 1 even when the command is "technically" successful
                    resolve();
                    return;
                }
                if (code !== 0) {
                    reject(new Error(\`Process exited with code \${code}:\\n\${stderr}\`));
                    return;
                }
                resolve();
            };
            child.stdout.pipe(outStream);
            child.stderr.on("data", chunk => {
                stderr += chunk.toString();
            });
            child.on("error", err => {
                rejectOnce(new Error(\`Spawn failed: \${err.message}\`));
            });
            outStream.on("error", err => {
                rejectOnce(new Error(\`Failed to write dependency tree output: \${err.message}\`));
            });
            outStream.on("finish", () => {
                outputFinished = true;
                settleIfReady();
            });
            child.on("close", code => {
                childClosed = true;
                childExitCode = code;
                settleIfReady();
            });
        });`;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrenceCount(source, snippet) {
  return source.split(snippet).length - 1;
}

export function patchCollectorSource(source, { expectedSourceSha256 = TARGET_SOURCE_SHA256 } = {}) {
  const sourceSha256 = sha256(source);
  const originalCount = occurrenceCount(source, ORIGINAL_SNIPPET);
  const patchedCount = occurrenceCount(source, PATCHED_SNIPPET);

  if (sourceSha256 === expectedSourceSha256) {
    if (originalCount !== 1 || patchedCount !== 0) {
      throw new Error("Trusted collector SHA-256 matched, but the expected source snippet drifted");
    }
    const patchedSource = source.replace(ORIGINAL_SNIPPET, PATCHED_SNIPPET);
    if (patchedSource === source) {
      throw new Error("Collector patch produced no source change");
    }
    return { source: patchedSource, changed: true, originalSha256: sourceSha256, patchedSha256: sha256(patchedSource) };
  }

  if (originalCount === 0 && patchedCount === 1) {
    const reconstructed = source.replace(PATCHED_SNIPPET, ORIGINAL_SNIPPET);
    const reconstructedSha256 = sha256(reconstructed);
    if (reconstructedSha256 !== expectedSourceSha256) {
      throw new Error(`Patched collector drift detected: reconstructed SHA-256 ${reconstructedSha256} does not match ${expectedSourceSha256}`);
    }
    return { source, changed: false, originalSha256: reconstructedSha256, patchedSha256: sourceSha256 };
  }

  throw new Error(`Collector source SHA-256 drift: expected ${expectedSourceSha256}, received ${sourceSha256}`);
}

export async function applyCollectorPatch({
  desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  expectedSourceSha256 = TARGET_SOURCE_SHA256,
} = {}) {
  const packageFile = path.join(desktopRoot, "node_modules", "app-builder-lib", "package.json");
  const collectorFile = path.join(
    desktopRoot,
    "node_modules",
    "app-builder-lib",
    "out",
    "node-module-collector",
    "nodeModulesCollector.js",
  );
  const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
  if (packageJson.version !== TARGET_VERSION) {
    throw new Error(`Unsupported app-builder-lib version: expected ${TARGET_VERSION}, received ${packageJson.version ?? "unknown"}`);
  }

  const source = await readFile(collectorFile, "utf8");
  const result = patchCollectorSource(source, { expectedSourceSha256 });
  if (result.changed) {
    const fileStat = await stat(collectorFile);
    const temporaryFile = `${collectorFile}.spare-mvp-patch-${process.pid}`;
    await writeFile(temporaryFile, result.source, { encoding: "utf8", mode: fileStat.mode });
    await rename(temporaryFile, collectorFile);
  }
  return { ...result, collectorFile, version: packageJson.version };
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    const result = await applyCollectorPatch();
    console.log(JSON.stringify({
      status: result.changed ? "patched" : "already-patched",
      version: result.version,
      collectorFile: result.collectorFile,
      originalSha256: result.originalSha256,
      patchedSha256: result.patchedSha256,
    }));
  } catch (error) {
    console.error(`[spare-mvp] electron-builder collector patch refused: ${error.message}`);
    process.exitCode = 1;
  }
}
