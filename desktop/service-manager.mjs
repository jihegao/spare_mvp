import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function runtimePaths(packageRoot) {
  const dataRoot = path.join(packageRoot, "data");
  return {
    packageRoot,
    python: path.join(packageRoot, "runtime", "python.exe"),
    applicationRoot: path.join(packageRoot, "app"),
    manifestFile: path.join(packageRoot, "manifest.json"),
    startScript: path.join(packageRoot, "scripts", "start-portable.ps1"),
    stopScript: path.join(packageRoot, "scripts", "stop-portable.ps1"),
    verifier: path.join(packageRoot, "scripts", "portable-package.py"),
    dataRoot,
    stateFile: path.join(dataRoot, "active-ports.json"),
    logsDir: path.join(dataRoot, "logs"),
    diagnosticsDir: path.join(dataRoot, "diagnostics"),
  };
}

export function requiredRuntimeFiles(paths) {
  return [paths.python, paths.applicationRoot, paths.manifestFile, paths.startScript, paths.stopScript, paths.verifier];
}

export function portableResourcesReady(paths) {
  return requiredRuntimeFiles(paths).every((filePath) => existsSync(filePath));
}

export async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0, onStdout = () => {}, ...spawnOptions } = options;
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
    child.stdout.on("data", (chunk) => { stdout += chunk; onStdout(String(chunk)); });
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

export async function assertPortableIntegrity(paths, onProgress = () => {}, run = runCommand) {
  if (!portableResourcesReady(paths)) {
    const missing = requiredRuntimeFiles(paths).filter((filePath) => !existsSync(filePath));
    throw new Error(`绿色版文件不完整：${missing.join("；")}`);
  }
  let buffered = "";
  await run(paths.python, ["-I", "-B", paths.verifier, "verify", "--root", paths.packageRoot, "--progress"], {
    cwd: paths.packageRoot,
    timeoutMs: 600_000,
    env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" },
    onStdout(chunk) {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^VERIFY_PROGRESS (\d+) (\d+)$/);
        if (!match) continue;
        const checked = Number(match[1]);
        const total = Number(match[2]);
        const percent = 15 + Math.floor(30 * checked / total);
        onProgress(`正在校验内置运行环境（${checked} / ${total}）`, percent);
      }
    },
  });
}

export async function readActiveState(paths) {
  const raw = await readFile(paths.stateFile, "utf8");
  const state = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (!Number.isInteger(state.backend_port) || !Number.isInteger(state.solara_port)) {
    throw new Error("本机运行状态文件无效");
  }
  return {
    backendPort: state.backend_port,
    solaraPort: state.solara_port,
    backendPid: state.backend_pid,
    solaraPid: state.solara_pid,
    frontendUrl: state.frontend_url,
    solaraUrl: state.solara_url,
  };
}

export async function runningState(paths) {
  if (!existsSync(paths.stateFile)) return null;
  try {
    const state = await readActiveState(paths);
    const response = await fetch(`http://127.0.0.1:${state.backendPort}/_spare_mvp/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return response.ok ? state : null;
  } catch {
    return null;
  }
}

export async function startServices(paths, onProgress = () => {}, run = runCommand) {
  const existing = await runningState(paths);
  if (existing) {
    onProgress("正在加载已运行的工作区", 100);
    return { state: existing, startedHere: false };
  }
  onProgress("正在启动内置 Python 服务", 55);
  await run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.startScript,
    "-AutoSelectPorts", "-NoBrowser",
  ], { cwd: paths.packageRoot, timeoutMs: 180_000 });
  const state = await readActiveState(paths);
  await waitForHttp(`http://127.0.0.1:${state.backendPort}/_spare_mvp/health`, 15_000);
  await waitForHttp(`${state.solaraUrl}/`, 15_000);
  onProgress("正在加载工作区", 100);
  return { state, startedHere: true };
}

export async function stopServices(paths, run = runCommand) {
  await run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.stopScript,
  ], { cwd: paths.packageRoot, timeoutMs: 60_000 });
}
