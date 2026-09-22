// Keep transport/task failures separate from model validation failures.
export function analysisErrorPresentation(result = {}) {
  const code = result.errorCode || result.error_code || result.code || "";
  if (code === "simulation_task_busy") return { title: "任务占用中", message: "已有仿真任务正在运行，请等待当前任务完成后重试。" };
  if (["modeling_validation_failed", "lite_mesa_analysis_compile_unavailable", "project_validation_failed"].includes(code)) {
    return { title: "建模粒度不足", message: result.message || "请检查并补齐建模校验中列出的条件。" };
  }
  if (["analysis_samples_timeout", "sample_timeout", "session_timeout", "request_timeout", "backend_request_timeout"].includes(code)) return { title: "分析运行超时", message: result.message || "请调整运行设置后重试。" };
  if (["simulation_task_not_found", "analysis_result_unavailable"].includes(code)) return { title: "任务结果不可用", message: "结果已过期或不可访问，请重新运行分析。" };
  if (["task_cancelled", "simulation_task_cancelled"].includes(code)) return { title: "任务已中断", message: result.message || "请重新运行分析。" };
  if (["network_error", "fetch_failed", "backend_network_error"].includes(code)) return { title: "网络请求失败", message: "无法连接后端，请检查连接后重试。" };
  return { title: "分析运行失败", message: result.message || "分析未能完成，请检查错误信息后重试。" };
}

export function analysisExportErrorMessage(error = {}) {
  if (error.code === "analysis_export_too_large") return error.message || "筛选结果超过导出容量限制，请缩小筛选范围后重试。";
  if (error.code === "request_too_large" || error.status === 413) return "导出请求超过允许大小，请缩小筛选范围或重新运行后使用服务端结果导出。";
  if (["simulation_task_not_found", "analysis_result_unavailable"].includes(error.code)) return "结果已过期或不可访问，请重新运行分析后导出。";
  return error.message || "Excel 导出失败，请重试。";
}
