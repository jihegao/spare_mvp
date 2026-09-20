import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function resolvedPath(value) {
  const result = path.resolve(value);
  return process.platform === "win32" ? result.toLowerCase() : result;
}

export function runtimePaths(packageRoot, options = {}) {
  const base = {
    packageRoot,
    python: path.join(packageRoot, "runtime", "python.exe"),
    applicationRoot: path.join(packageRoot, "app"),
    manifestFile: path.join(packageRoot, "manifest.json"),
    startScript: path.join(packageRoot, "scripts", "start-portable.ps1"),
    stopScript: path.join(packageRoot, "scripts", "stop-portable.ps1"),
    verifier: path.join(packageRoot, "scripts", "portable-package.py"),
    pathResolver: path.join(packageRoot, "scripts", "portable-paths.py"),
    dataManager: path.join(packageRoot, "scripts", "portable-data.py"),
    dataGuard: path.join(packageRoot, "scripts", "portable-data-guard.py"),
  };
  let contract = options.pathContract;
  if (!contract && existsSync(base.python) && existsSync(base.pathResolver)) {
    const execute = options.spawnSync || spawnSync;
    const result = execute(base.python, ["-I", "-B", base.pathResolver, "--package-root", packageRoot], {
      cwd: packageRoot,
      env: options.env || process.env,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`无法解析绿色版数据目录：${String(result.stderr || result.stdout || "unknown error").trim()}`);
    }
    try {
      contract = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(`绿色版路径解析结果无效：${error.message}`);
    }
  }
  if (!contract) return base;
  const required = [
    "package_root", "installation_id", "data_root", "database", "instance_root", "state_file",
    "pid_root", "logs_dir", "diagnostics_dir", "integrity_cache",
  ];
  const missing = required.filter((name) => typeof contract[name] !== "string" || !contract[name]);
  if (missing.length) throw new Error(`绿色版路径契约缺少字段：${missing.join("、")}`);
  if (resolvedPath(contract.package_root) !== resolvedPath(packageRoot)) {
    throw new Error("绿色版路径契约与当前安装目录不一致");
  }
  return {
    ...base,
    installationId: contract.installation_id,
    dataRoot: contract.data_root,
    database: contract.database,
    instanceRoot: contract.instance_root,
    stateFile: contract.state_file,
    pidsDir: contract.pid_root,
    logsDir: contract.logs_dir,
    diagnosticsDir: contract.diagnostics_dir,
    integrityCache: contract.integrity_cache,
  };
}

export function requiredRuntimeFiles(paths) {
  return [
    paths.python, paths.applicationRoot, paths.manifestFile, paths.startScript, paths.stopScript,
    paths.verifier, paths.pathResolver, paths.dataManager, paths.dataGuard,
  ];
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
    // PowerShell starts package-owned detached services whose inherited pipe
    // handles can outlive PowerShell. Completion is the invoked process exit,
    // not closure of every descendant-held stdio handle.
    child.once("exit", (code) => {
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
  if (!paths.integrityCache) throw new Error("绿色版实例校验缓存路径尚未解析");
  await run(paths.python, [
    "-I", "-B", paths.verifier, "verify-cached", "--root", paths.packageRoot,
    "--cache-path", paths.integrityCache, "--progress",
  ], {
    cwd: paths.packageRoot,
    timeoutMs: 600_000,
    env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" },
    onStdout(chunk) {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("Integrity cache valid")) {
          onProgress("完整性缓存有效", 45);
          continue;
        }
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

export function managedRuntimeUrls(backendPort, solaraPort) {
  for (const [name, value] of [["backend", backendPort], ["Solara", solaraPort]]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`本机运行状态包含无效的 ${name} 端口`);
    }
  }
  if (backendPort === solaraPort) throw new Error("本机运行状态中的服务端口不能相同");
  const solaraUrl = `http://127.0.0.1:${solaraPort}`;
  return {
    backendHealthUrl: `http://127.0.0.1:${backendPort}/_spare_mvp/health`,
    frontendUrl: `http://127.0.0.1:${backendPort}/front/?solaraUrl=${encodeURIComponent(solaraUrl)}`,
    solaraUrl,
  };
}

export async function readActiveState(paths) {
  const raw = await readFile(paths.stateFile, "utf8");
  const state = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (
    state.format_version !== 2 || !Number.isInteger(state.backend_pid) || state.backend_pid <= 0
    || !Number.isInteger(state.solara_pid) || state.solara_pid <= 0
  ) {
    throw new Error("本机运行状态文件无效");
  }
  if (state.installation_id !== paths.installationId || resolvedPath(state.package_root || "") !== resolvedPath(paths.packageRoot)) {
    throw new Error("本机运行状态不属于当前绿色版安装");
  }
  if (resolvedPath(state.data_root || "") !== resolvedPath(paths.dataRoot)) {
    throw new Error("本机运行状态绑定了不同的用户数据目录");
  }
  const urls = managedRuntimeUrls(state.backend_port, state.solara_port);
  if (state.frontend_url !== urls.frontendUrl || state.solara_url !== urls.solaraUrl) {
    throw new Error("本机运行状态中的服务地址与受管端口不一致");
  }
  return {
    backendPort: state.backend_port,
    solaraPort: state.solara_port,
    backendPid: state.backend_pid,
    solaraPid: state.solara_pid,
    ...urls,
  };
}

async function backendHealthMatchesState(response, state) {
  if (!response.ok) return false;
  try {
    const health = await response.json();
    return health?.service === "spare-mvp-backend" && health?.status === "ok" && health?.pid === state.backendPid;
  } catch {
    return false;
  }
}

async function assertManagedServices(paths, state, run = runCommand) {
  await run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.stopScript, "-CheckOwnershipOnly",
    "-ExpectedBackendPid", String(state.backendPid),
    "-ExpectedBackendPort", String(state.backendPort),
    "-ExpectedSolaraPid", String(state.solaraPid),
    "-ExpectedSolaraPort", String(state.solaraPort),
  ], { cwd: paths.packageRoot, timeoutMs: 30_000 });
  const [backend, solara] = await Promise.all([
    fetch(state.backendHealthUrl, { signal: AbortSignal.timeout(2500) }),
    fetch(`${state.solaraUrl}/`, { signal: AbortSignal.timeout(2500) }),
  ]);
  if (!await backendHealthMatchesState(backend, state)) {
    throw new Error("后端 health 身份与本次启动的服务不一致");
  }
  if (!solara.ok) {
    throw new Error(`Solara 服务不可用（HTTP ${solara.status}）`);
  }
}

export async function runningState(paths, run = runCommand) {
  if (!existsSync(paths.stateFile)) return null;
  try {
    const state = await readActiveState(paths);
    await assertManagedServices(paths, state, run);
    return state;
  } catch {
    return null;
  }
}

export async function startServices(paths, onProgress = () => {}, run = runCommand) {
  const existing = await runningState(paths, run);
  if (existing) {
    onProgress("正在加载已运行的工作区", 100);
    return { state: existing, startedHere: false };
  }
  // A stale/partial state belongs to this installation's isolated instance
  // root. Stop only processes that pass the PowerShell ownership checks before
  // starting the pair again.
  if (existsSync(paths.stateFile) || existsSync(paths.pidsDir)) {
    onProgress("正在恢复不完整的本机服务", 50);
    await stopServices(paths, run);
  }
  onProgress("正在启动内置 Python 服务", 55);
  await run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.startScript,
    "-AutoSelectPorts", "-NoBrowser",
  ], { cwd: paths.packageRoot, timeoutMs: 180_000 });
  let state;
  try {
    state = await readActiveState(paths);
    await assertManagedServices(paths, state, run);
  } catch (verificationError) {
    try {
      await stopServices(paths, run);
    } catch (stopError) {
      throw new Error(
        `服务启动后验证失败：${verificationError.message}；清理未完成：${stopError.message}`,
        { cause: verificationError },
      );
    }
    throw new Error(`服务启动后验证失败：${verificationError.message}`, { cause: verificationError });
  }
  onProgress("正在加载工作区", 100);
  return { state, startedHere: true };
}

export async function stopServices(paths, run = runCommand) {
  await run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.stopScript,
  ], { cwd: paths.packageRoot, timeoutMs: 60_000 });
}
