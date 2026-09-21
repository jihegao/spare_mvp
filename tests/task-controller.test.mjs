import test from "node:test";
import assert from "node:assert/strict";

import {
  compactTaskScopeHash,
  createSimulationTaskController,
  normalizeTaskStatus,
  simulationTaskProgressText,
  simulationTaskScope
} from "../front/task-controller.mjs";

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values)
  };
}

test("remote task persists task_id and reports real progress through completion", async () => {
  const storage = memoryStorage();
  const statuses = [
    { task_id: "task-1", status: "running", processed: 1, total: 3, succeeded: 1, failed: 0, elapsed_seconds: 2, eta_seconds: null },
    { task_id: "task-1", status: "running", processed: 2, total: 3, succeeded: 1, failed: 1, elapsed_seconds: 4, eta_seconds: 2 },
    { task_id: "task-1", status: "completed", processed: 3, total: 3, succeeded: 2, failed: 1, elapsed_seconds: 6, eta_seconds: null }
  ];
  let posts = 0;
  const api = {
    async createSimulationTask() { posts += 1; return statuses[0]; },
    async getSimulationTask() { return statuses.shift(); },
    async getSimulationTaskResult() { return { task_id: "task-1", status: "completed", result: { sample_count: 2 } }; }
  };
  const updates = [];
  const controller = createSimulationTaskController({ api, storage, pollIntervalMs: 0, delay: async () => {} });
  const completed = await controller.start("analysis::fingerprint", {
    analysis_type: "carry_list",
    settings: { samples: 3, seed: 42, parallelCores: 2, missionConfidenceTarget: 0.82, secret: "do-not-store" },
    context: { projectJson: { secret: "never-persist" } }
  }, {
    onStatus: (status) => updates.push(status)
  });

  assert.equal(posts, 1);
  assert.equal(controller.taskId("analysis::fingerprint"), "task-1");
  assert.deepEqual(controller.taskRecord("analysis::fingerprint"), {
    taskId: "task-1",
    analysisType: "carry_list",
    settings: { samples: 3, seed: 42, parallelCores: 2, missionConfidenceTarget: 0.82 }
  });
  assert.deepEqual(JSON.parse(storage.snapshot()["spare-mvp:simulation-tasks:v1"])["analysis::fingerprint"], {
    task_id: "task-1",
    analysis_type: "carry_list",
    settings: { samples: 3, seed: 42, parallelCores: 2, missionConfidenceTarget: 0.82 }
  });
  assert.doesNotMatch(storage.snapshot()["spare-mvp:simulation-tasks:v1"], /secret|projectJson|never-persist/);
  assert.deepEqual(updates.slice(-3).map((status) => status.processed), [1, 2, 3]);
  assert.equal(completed.result.sample_count, 2);
  assert.equal(updates[2].processed, updates[2].succeeded + updates[2].failed);
});

test("resume after refresh polls stored task without a duplicate POST", async () => {
  const storage = memoryStorage({
    "spare-mvp:simulation-tasks:v1": JSON.stringify({ "page::context": "task-restored" })
  });
  let posts = 0;
  const api = {
    async createSimulationTask() { posts += 1; throw new Error("must not submit"); },
    async getSimulationTask() {
      return { task_id: "task-restored", status: "completed", processed: 5, total: 5, succeeded: 5, failed: 0 };
    },
    async getSimulationTaskResult() { return { result: { status: "session_complete" } }; }
  };
  const controller = createSimulationTaskController({ api, storage, delay: async () => {} });
  assert.deepEqual(controller.taskRecord("page::context"), {
    taskId: "task-restored",
    analysisType: "",
    settings: {}
  });
  const result = await controller.resume("page::context");
  assert.equal(posts, 0);
  assert.equal(result.taskId, "task-restored");
  assert.equal(result.result.status, "session_complete");
});

test("failed task still reads the result endpoint and merges its error", async () => {
  let resultReads = 0;
  const api = {
    async createSimulationTask() { return { task_id: "task-failed", status: "running" }; },
    async getSimulationTask() {
      return { task_id: "task-failed", status: "failed", processed: 2, total: 3, succeeded: 1, failed: 1 };
    },
    async getSimulationTaskResult() {
      resultReads += 1;
      return { task_id: "task-failed", status: "failed", result: null, error: { code: "sample_failed", message: "样本执行失败" } };
    }
  };
  const updates = [];
  const controller = createSimulationTaskController({ api, storage: memoryStorage() });
  const result = await controller.start("failed-scope", {}, { onStatus: (status) => updates.push(status) });
  assert.equal(resultReads, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.message, "样本执行失败");
  assert.equal(result.error.code, "sample_failed");
  assert.equal(updates.at(-1).stage, "fetching_result");
});

test("expired task clears mapping and gives an explicit rerun message", async () => {
  const storage = memoryStorage({
    "spare-mvp:simulation-tasks:v1": JSON.stringify({ "page::old": "task-expired" })
  });
  const missing = Object.assign(new Error("missing"), { code: "simulation_task_not_found", status: 404 });
  const api = {
    async createSimulationTask() { throw new Error("must not submit"); },
    async getSimulationTask() { throw missing; },
    async getSimulationTaskResult() { throw new Error("must not fetch result"); }
  };
  const updates = [];
  const controller = createSimulationTaskController({ api, storage });
  const result = await controller.resume("page::old", { onStatus: (status) => updates.push(status) });
  assert.equal(result.code, "simulation_task_not_found");
  assert.equal(controller.taskId("page::old"), "");
  assert.equal(simulationTaskProgressText(updates[0]), "任务已中断，请重新运行。");
});

test("one user's expired task does not clear another user's stored mapping", async () => {
  const scopeA = simulationTaskScope({ userId: "user-a", pageId: "page", contextId: "project-1", contextFingerprint: "a" });
  const scopeB = simulationTaskScope({ userId: "user-b", pageId: "page", contextId: "project-1", contextFingerprint: "b" });
  const storage = memoryStorage({
    "spare-mvp:simulation-tasks:v1": JSON.stringify({ [scopeA]: "task-a", [scopeB]: "task-b" })
  });
  const missing = Object.assign(new Error("missing"), { code: "simulation_task_not_found", status: 404 });
  const api = {
    async createSimulationTask() { throw new Error("unused"); },
    async getSimulationTask(taskId) {
      if (taskId === "task-b") throw missing;
      return { task_id: taskId, status: "running" };
    },
    async getSimulationTaskResult() { throw new Error("unused"); }
  };
  const controller = createSimulationTaskController({ api, storage });
  await controller.resume(scopeB);
  assert.equal(controller.taskId(scopeB), "");
  assert.equal(controller.taskId(scopeA), "task-a");
});

test("busy response is localized without inventing a task id", async () => {
  const busy = Object.assign(new Error("busy"), { code: "simulation_task_busy", status: 409 });
  const api = {
    async createSimulationTask() { throw busy; },
    async getSimulationTask() { throw new Error("unused"); },
    async getSimulationTaskResult() { throw new Error("unused"); }
  };
  const controller = createSimulationTaskController({ api, storage: memoryStorage() });
  await assert.rejects(
    controller.start("page::context", {}),
    /已有仿真任务正在运行，请等待当前任务完成后重试/
  );
  assert.equal(controller.taskId("page::context"), "");
});

test("inline adapter uses the same status shape and leaves session storage untouched", async () => {
  const storage = memoryStorage();
  const updates = [];
  const api = { createSimulationTask() {}, getSimulationTask() {}, getSimulationTaskResult() {} };
  const controller = createSimulationTaskController({ api, storage });
  const result = await controller.runInline("aircraft", () => ({ reliability: 0.99 }), {
    onStatus: (status) => updates.push(status)
  });
  assert.deepEqual(updates.map((status) => status.status), ["running", "completed"]);
  assert.equal(result.result.reliability, 0.99);
  assert.deepEqual(storage.snapshot(), {});
});

test("storage write failures do not interrupt an already submitted task", async () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota exceeded"); },
    removeItem() { throw new Error("blocked"); }
  };
  let statusReads = 0;
  const api = {
    async createSimulationTask() { return { task_id: "task-storage", status: "running" }; },
    async getSimulationTask() {
      statusReads += 1;
      return { task_id: "task-storage", status: "completed", processed: 1, total: 1, succeeded: 1, failed: 0 };
    },
    async getSimulationTaskResult() { return { result: { status: "session_complete" } }; }
  };
  const controller = createSimulationTaskController({ api, storage });
  const result = await controller.start("storage-scope", {});
  assert.equal(statusReads, 1);
  assert.equal(result.result.status, "session_complete");
  assert.equal(controller.taskId("storage-scope"), "task-storage");
});

test("normalization, nullable ETA, and scope are stable", () => {
  const status = normalizeTaskStatus({
    taskId: "camel", status: "running", progress: { processed: 2, total: 4, succeeded: 2, failed: 0 }, etaSeconds: ""
  });
  assert.equal(status.taskId, "camel");
  assert.equal(status.etaSeconds, null);
  assert.match(simulationTaskProgressText(status), /已处理 2\/4，成功 2，失败 0/);
  const scope = simulationTaskScope({
    userId: "user-a",
    pageId: "page",
    contextKind: "frozen_plan",
    contextId: "plan-1",
    contextFingerprint: JSON.stringify({ large: "project-json-must-not-appear" })
  });
  assert.match(scope, /^user:user-a:page:page:context:frozen_plan:plan-1:hash:[0-9a-f]{8}$/);
  assert.doesNotMatch(scope, /project-json-must-not-appear/);
  assert.notEqual(
    simulationTaskScope({ userId: "user-a", pageId: "page", contextId: "project-1", contextFingerprint: "same" }),
    simulationTaskScope({ userId: "user-b", pageId: "page", contextId: "project-1", contextFingerprint: "same" })
  );
  assert.equal(compactTaskScopeHash("fingerprint"), compactTaskScopeHash("fingerprint"));
});
