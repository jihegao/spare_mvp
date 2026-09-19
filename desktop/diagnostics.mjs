import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { composeArguments, composeEnvironment, runCommand } from "./service-manager.mjs";

function safeText(value) {
  return String(value)
    .replace(/(token|password|secret|authorization)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
export async function exportDiagnostics(paths, manifest, state) {
  await mkdir(paths.diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(paths.diagnosticsDir, `spare-mvp-diagnostics-${stamp}.zip`);
  const env = composeEnvironment({ image: manifest.image.tag, backendPort: state.backendPort, solaraPort: state.solaraPort, exportDir: paths.exportDir });
  const [ps, logs, version] = await Promise.all([
    runCommand("docker.exe", composeArguments(paths.composeFile, "ps"), { env }).catch((error) => ({ stdout: error.message })),
    runCommand("docker.exe", composeArguments(paths.composeFile, "logs", "--no-color", "--tail", "500"), { env }).catch((error) => ({ stdout: error.message })),
    runCommand("docker.exe", ["version"]).catch((error) => ({ stdout: error.message })),
  ]);
  const releaseManifest = await readFile(paths.manifestFile, "utf8");
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.append(safeText(ps.stdout), { name: "compose-ps.txt" });
    archive.append(safeText(logs.stdout), { name: "compose-logs.txt" });
    archive.append(safeText(version.stdout), { name: "docker-version.txt" });
    archive.append(releaseManifest, { name: "release-manifest.json" });
    archive.append(`${JSON.stringify(state, null, 2)}\n`, { name: "active-state.json" });
    archive.finalize();
  });
  return destination;
}
