import test from "node:test";
import assert from "node:assert/strict";

import {
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
  const completed = await controller.start("analysis::fingerprint", { analysis_type: "carry_list" }, {
    onStatus: (status) => updates.push(status)
  });

  assert.equal(posts, 1);
  assert.equal(controller.taskId("analysis::fingerprint"), "task-1");
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
  const result = await controller.resume("page::context");
  assert.equal(posts, 0);
  assert.equal(result.taskId, "task-restored");
  assert.equal(result.result.status, "session_complete");
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

test("normalization, nullable ETA, and scope are stable", () => {
  const status = normalizeTaskStatus({
    taskId: "camel", status: "running", progress: { processed: 2, total: 4, succeeded: 2, failed: 0 }, etaSeconds: ""
  });
  assert.equal(status.taskId, "camel");
  assert.equal(status.etaSeconds, null);
  assert.match(simulationTaskProgressText(status), /已处理 2\/4，成功 2，失败 0/);
  assert.equal(simulationTaskScope("page", "fingerprint"), "page::fingerprint");
});
