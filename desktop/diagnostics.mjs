import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";

function safeText(value) {
  return String(value)
    .replace(/(token|password|secret|authorization)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export async function exportDiagnostics(paths, state) {
  await mkdir(paths.diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(paths.diagnosticsDir, `spare-mvp-diagnostics-${stamp}.zip`);
  const releaseManifest = await readFile(paths.manifestFile, "utf8");
  const logNames = existsSync(paths.logsDir) ? await readdir(paths.logsDir) : [];
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.append(releaseManifest, { name: "manifest.json" });
    archive.append(`${JSON.stringify(state, null, 2)}\n`, { name: "active-state.json" });
    for (const name of logNames.filter((entry) => entry.endsWith(".log"))) {
      archive.append(createReadStream(path.join(paths.logsDir, name)), { name: `logs/${name}` });
    }
    archive.append(safeText(`package_root=${paths.packageRoot}\npython=${paths.python}\n`), { name: "runtime-paths.txt" });
    archive.finalize();
  });
  return destination;
}
