import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function discoverNodeTestFiles(directory = join(repositoryRoot, "tests")) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return discoverNodeTestFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".test.mjs") ? [path] : [];
  }));

  return nestedFiles
    .flat()
    .map((path) => relative(repositoryRoot, path).split(sep).join("/"))
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testFiles = await discoverNodeTestFiles();
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...testFiles],
    { cwd: repositoryRoot, stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}
