export const SIMULATION_TASK_STORAGE_KEY = "spare-mvp:simulation-tasks:v1";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function createSimulationTaskController({
  api,
  storage = globalThis.sessionStorage,
  storageKey = SIMULATION_TASK_STORAGE_KEY,
  pollIntervalMs = 750,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  if (!api || typeof api.createSimulationTask !== "function") {
    throw new TypeError("simulation task api is required");
  }

  const activeMonitors = new Map();

  return {
    taskId(scope) {
      return readTaskMap(storage, storageKey)[scope] || "";
    },

    clear(scope) {
      updateTaskMap(storage, storageKey, (tasks) => {
        delete tasks[scope];
      });
    },

    async start(scope, payload, options = {}) {
      const storedTaskId = this.taskId(scope);
      if (storedTaskId) {
        const restored = await inspectTask(api, storedTaskId);
        if (restored.status === "running") {
          options.onStatus?.(restored);
          return monitor(scope, storedTaskId, options);
        }
        this.clear(scope);
      }

      let submitted;
      try {
        submitted = normalizeTaskStatus(await api.createSimulationTask(payload));
      } catch (error) {
        throw normalizeTaskRequestError(error);
      }
      if (!submitted.taskId) throw new Error("后端未返回 task_id");
      persistTaskId(storage, storageKey, scope, submitted.taskId);
      options.onStatus?.(submitted);
      return monitor(scope, submitted.taskId, options);
    },

    async resume(scope, options = {}) {
      const taskId = this.taskId(scope);
      if (!taskId) return null;
      return monitor(scope, taskId, options);
    },

    async runInline(scope, execute, options = {}) {
      const startedAt = Date.now();
      options.onStatus?.(normalizeTaskStatus({
        task_id: `inline:${scope}`,
        status: "running",
        stage: "running",
        processed: 0,
        total: 1,
        succeeded: 0,
        failed: 0,
        elapsed_seconds: 0
      }));
      try {
        const result = await execute();
        const completed = normalizeTaskStatus({
          task_id: `inline:${scope}`,
          status: "completed",
          stage: "completed",
          processed: 1,
          total: 1,
          succeeded: 1,
          failed: 0,
          elapsed_seconds: (Date.now() - startedAt) / 1000
        });
        options.onStatus?.(completed);
        return { ...completed, result };
      } catch (error) {
        const failed = normalizeTaskStatus({
          task_id: `inline:${scope}`,
          status: "failed",
          stage: "failed",
          processed: 1,
          total: 1,
          succeeded: 0,
          failed: 1,
          elapsed_seconds: (Date.now() - startedAt) / 1000,
          error: { message: error?.message || "运行错误" }
        });
        options.onStatus?.(failed);
        return { ...failed, error };
      }
    }
  };

  async function monitor(scope, taskId, options) {
    if (activeMonitors.has(taskId)) return activeMonitors.get(taskId);
    const promise = pollTask(scope, taskId, options).finally(() => activeMonitors.delete(taskId));
    activeMonitors.set(taskId, promise);
    return promise;
  }

  async function pollTask(scope, taskId, options) {
    while (true) {
      let status;
      try {
        status = normalizeTaskStatus(await api.getSimulationTask(taskId));
      } catch (error) {
        const normalized = normalizeTaskRequestError(error);
        if (normalized.code === "simulation_task_not_found") {
          updateTaskMap(storage, storageKey, (tasks) => { delete tasks[scope]; });
          const unavailable = unavailableTaskStatus(taskId);
          options.onStatus?.(unavailable);
          return unavailable;
        }
        throw normalized;
      }
      options.onStatus?.(status);
      if (status.status === "completed") {
        try {
          const response = await api.getSimulationTaskResult(taskId);
          return { ...status, result: response?.result ?? response };
        } catch (error) {
          throw normalizeTaskRequestError(error);
        }
      }
      if (status.status === "failed") return status;
      await delay(pollIntervalMs);
    }
  }
}

export function normalizeTaskStatus(payload = {}) {
  const progress = payload.progress && typeof payload.progress === "object" ? payload.progress : {};
  const status = String(payload.status || "running").toLowerCase();
  const error = payload.result_error || payload.error || null;
  return {
    taskId: String(payload.task_id || payload.taskId || ""),
    status: TERMINAL_STATUSES.has(status) ? status : "running",
    stage: String(payload.stage || status || "running"),
    processed: count(payload.processed ?? progress.processed),
    total: count(payload.total ?? progress.total),
    succeeded: count(payload.succeeded ?? progress.succeeded),
    failed: count(payload.failed ?? progress.failed),
    elapsedSeconds: finiteOrNull(payload.elapsed_seconds ?? payload.elapsedSeconds) ?? 0,
    etaSeconds: finiteOrNull(payload.eta_seconds ?? payload.etaSeconds),
    inputFingerprint: String(payload.input_fingerprint || payload.inputFingerprint || ""),
    createdAt: payload.created_at || payload.createdAt || null,
    startedAt: payload.started_at || payload.startedAt || null,
    completedAt: payload.completed_at || payload.completedAt || null,
    expiresAt: payload.expires_at || payload.expiresAt || null,
    error,
    message: String(payload.message || error?.message || "")
  };
}

export function simulationTaskProgressText(task) {
  if (!task) return "";
  if (task.code === "simulation_task_not_found") return "任务已中断，请重新运行。";
  if (task.status === "failed") return `运行失败：${task.message || "后端未返回错误详情"}`;
  const counts = task.total > 0
    ? `已处理 ${task.processed}/${task.total}，成功 ${task.succeeded}，失败 ${task.failed}`
    : "运行中";
  const elapsed = `已运行 ${formatDuration(task.elapsedSeconds)}`;
  const eta = task.etaSeconds === null ? "" : `，预计剩余 ${formatDuration(task.etaSeconds)}`;
  if (task.status === "completed") return `运行完成：${counts}，${elapsed}`;
  return `${counts}，${elapsed}${eta}`;
}

export function simulationTaskScope(pageId, contextFingerprint) {
  return `${String(pageId || "unknown")}::${String(contextFingerprint || "current")}`;
}

function unavailableTaskStatus(taskId) {
  return {
    ...normalizeTaskStatus({ task_id: taskId, status: "failed", stage: "failed" }),
    code: "simulation_task_not_found",
    message: "任务已中断，请重新运行。"
  };
}

function normalizeTaskRequestError(error) {
  if (error?.code === "simulation_task_busy") {
    error.message = "已有仿真任务正在运行，请等待当前任务完成后重试。";
  }
  return error;
}

function readTaskMap(storage, storageKey) {
  try {
    const value = JSON.parse(storage?.getItem(storageKey) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function persistTaskId(storage, storageKey, scope, taskId) {
  updateTaskMap(storage, storageKey, (tasks) => { tasks[scope] = taskId; });
}

function updateTaskMap(storage, storageKey, update) {
  if (!storage) return;
  const tasks = readTaskMap(storage, storageKey);
  update(tasks);
  storage.setItem(storageKey, JSON.stringify(tasks));
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : 0;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

async function inspectTask(api, taskId) {
  try {
    return normalizeTaskStatus(await api.getSimulationTask(taskId));
  } catch (error) {
    if (error?.code === "simulation_task_not_found") return unavailableTaskStatus(taskId);
    throw normalizeTaskRequestError(error);
  }
}
