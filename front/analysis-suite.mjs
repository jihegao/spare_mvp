export const ANALYSIS_SUITE_TYPES = Object.freeze([
  ["monte_carlo", "蒙特卡洛"],
  ["spare_shortfall", "备件短板"],
  ["carry_list", "转场携行"],
  ["mission_reliability", "任务可靠度"],
  ["downtime_factors", "停机因素"]
]);

export function analysisSuiteRows(response) {
  return ANALYSIS_SUITE_TYPES.map(([type, label]) => {
    const result = response?.analyses?.[type];
    const completed = Number(result?.completed_sample_count ?? result?.sample_count ?? 0);
    const failed = Number(result?.failed_sample_count ?? result?.failed_samples?.length ?? 0);
    const rawElapsed = result?.display_elapsed_seconds;
    const elapsed = typeof rawElapsed === "number" && Number.isFinite(rawElapsed) && rawElapsed >= 0 ? rawElapsed : null;
    const complete = result?.status === "session_complete" && completed === 50 && failed === 0;
    return {
      type, label, completed, failed,
      elapsed,
      withinTarget: complete && elapsed !== null && elapsed <= 60,
      status: result?.status || "pending",
      complete: result?.status === "session_complete" && completed === 50 && failed === 0,
      metrics: Array.isArray(result?.metrics) ? result.metrics : [],
      message: result?.message || (!result ? "未返回结果，请重新运行" : "")
    };
  });
}
