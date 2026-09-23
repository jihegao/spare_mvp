import test from "node:test";
import assert from "node:assert/strict";
import { analysisErrorPresentation, analysisExportErrorMessage } from "../front/analysis-errors.mjs";

test("task and transport failures are never presented as modeling defects", () => {
  for (const code of ["simulation_task_busy", "analysis_samples_timeout", "analysis_samples_failed", "backend_network_error", "simulation_task_not_found"]) {
    assert.notEqual(analysisErrorPresentation({ errorCode: code }).title, "建模粒度不足");
  }
  assert.equal(analysisErrorPresentation({ code: "backend_network_error" }).title, "网络请求失败");
  assert.equal(analysisErrorPresentation({ code: "backend_request_timeout" }).title, "分析运行超时");
  assert.equal(analysisErrorPresentation({ error_code: "modeling_validation_failed", message: "缺少保障节点" }).message, "缺少保障节点");
  assert.equal(analysisErrorPresentation({ error_code: "modeling_validation_failed" }).title, "建模粒度不足");
  assert.equal(analysisErrorPresentation({ code: "simulation_task_busy", message: "private-task-id" }).message.includes("private-task-id"), false);
});

test("export body limits and expired task results give actionable reasons", () => {
  assert.match(analysisExportErrorMessage({ code: "request_too_large" }), /超过允许大小/);
  assert.doesNotMatch(analysisExportErrorMessage({ status: 413 }), /后端可用/);
  assert.match(analysisExportErrorMessage({ code: "simulation_task_not_found" }), /重新运行分析/);
});
