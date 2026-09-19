import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

export const COMPOSE_PROJECT_NAME = "spare-mvp-desktop-rc1";

export function runtimePaths(resourcesPath, appDataPath) {
  const resourceRoot = path.join(resourcesPath, "desktop-resources");
  const stateRoot = path.join(appDataPath, "spare-mvp-desktop");
  return {
    resourceRoot,
    composeFile: path.join(resourceRoot, "runtime", "compose.yaml"),
    imageTar: path.join(resourceRoot, "runtime", "spare-mvp-image.tar"),
    manifestFile: path.join(resourceRoot, "release-manifest.json"),
    runtimeInstaller: path.join(resourceRoot, "prerequisites", "install-runtime.ps1"),
    dockerInstaller: path.join(resourceRoot, "prerequisites", "Docker Desktop Installer.exe"),
    wslInstaller: path.join(resourceRoot, "prerequisites", "wsl.msi"),
    stateRoot,
    stateFile: path.join(stateRoot, "active-state.json"),
    exportDir: path.join(stateRoot, "exports"),
    diagnosticsDir: path.join(stateRoot, "diagnostics"),
  };
}

export function composeEnvironment({ image, backendPort, solaraPort, exportDir }) {
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME,
    SPARE_IMAGE: image,
    SPARE_BACKEND_PORT: String(backendPort),
    SPARE_SOLARA_PORT: String(solaraPort),
    SPARE_EXPORT_DIR: exportDir,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  };
}

export function composeArguments(composeFile, ...args) {
  return ["compose", "--project-name", COMPOSE_PROJECT_NAME, "--file", composeFile, ...args];
}

export async function findFreePort(preferred, excluded = new Set(), probe = canListen) {
  for (let candidate = preferred; candidate <= Math.min(65535, preferred + 200); candidate += 1) {
    if (excluded.has(candidate)) continue;
    if (await probe(candidate)) return candidate;
  }
  throw new Error(`无法在 ${preferred} 附近找到可用端口`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function loadManifest(paths) {
  const manifest = JSON.parse(await readFile(paths.manifestFile, "utf8"));
  if (manifest.format_version !== 1 || !manifest.image?.tag || !manifest.image?.tar_sha256) {
    throw new Error("发布清单无效");
  }
  return manifest;
}

export async function assertReleaseIntegrity(paths, manifest) {
  for (const required of [paths.composeFile, paths.imageTar, paths.runtimeInstaller, paths.dockerInstaller, paths.wslInstaller]) {
    if (!existsSync(required)) throw new Error(`安装资源缺失：${required}`);
  }
  const checks = [
    [paths.imageTar, manifest.image.tar_sha256, "容器镜像"],
    [paths.dockerInstaller, manifest.prerequisites?.docker_desktop?.sha256, "Docker Desktop 安装器"],
    [paths.wslInstaller, manifest.prerequisites?.wsl?.sha256, "WSL 安装器"],
  ];
  for (const [filePath, expected, label] of checks) {
    if (!expected || await sha256File(filePath) !== expected) throw new Error(`${label}校验失败`);
  }
}

export async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0, ...spawnOptions } = options;
    const child = spawn(command, args, {
      windowsHide: true,
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`${command} 执行失败（${code}）：${stderr.trim() || stdout.trim()}`));
    });
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`${command} 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
    }
  });
}

export async function dockerAvailable(run = runCommand) {
  try {
    await run("docker.exe", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function imageAvailable(tag, run = runCommand) {
  try {
    await run("docker.exe", ["image", "inspect", tag]);
    return true;
  } catch {
    return false;
  }
}

export async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`服务健康检查超时：${lastError?.message || "unknown"}`);
}

export async function startServices(paths, manifest, onProgress = () => {}, run = runCommand) {
  await mkdir(paths.stateRoot, { recursive: true });
  await mkdir(paths.exportDir, { recursive: true });
  const backendPort = await findFreePort(4173);
  const solaraPort = await findFreePort(8765, new Set([backendPort]));
  const env = composeEnvironment({ image: manifest.image.tag, backendPort, solaraPort, exportDir: paths.exportDir });

  if (!(await imageAvailable(manifest.image.tag, run))) {
    onProgress("正在导入离线容器镜像", 45);
    await run("docker.exe", ["load", "--input", paths.imageTar], { env });
  }
  onProgress("正在启动仿真服务", 70);
  await run("docker.exe", composeArguments(paths.composeFile, "up", "-d", "--wait", "--no-build"), { env });
  const solaraUrl = `http://127.0.0.1:${solaraPort}`;
  const frontendUrl = `http://127.0.0.1:${backendPort}/front/?solaraUrl=${encodeURIComponent(solaraUrl)}`;
  await waitForHttp(`http://127.0.0.1:${backendPort}/_spare_mvp/health`);
  await waitForHttp(`${solaraUrl}/`);
  const state = { backendPort, solaraPort, frontendUrl, solaraUrl, image: manifest.image.tag, updatedAt: new Date().toISOString() };
  await writeFile(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  onProgress("正在加载工作区", 100);
  return { state, env };
}

export async function stopServices(paths, manifest, state, run = runCommand) {
  const env = composeEnvironment({
    image: manifest.image.tag,
    backendPort: state.backendPort,
    solaraPort: state.solaraPort,
    exportDir: paths.exportDir,
  });
  await run("docker.exe", composeArguments(paths.composeFile, "down"), { env });
}
