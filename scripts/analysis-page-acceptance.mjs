// Acceptance-tool metadata only; never imported by the product frontend.
export const ANALYSIS_PAGES = Object.freeze([
  {type:'monte_carlo', apiType:'mission_reliability', route:'spare-planning-monte-carlo-experiment-detail', button:'[data-lite-mesa-action="run"]', table:'.lite-mesa-stat-section .lite-mesa-stat-table tbody tr', status:'Mesa 分析完成：50/50 个样本'},
  {type:'spare_shortfall', apiType:'spare_shortfall', route:'spare-planning-spare-shortfall-analysis', table:'.lite-mesa-analysis-detail .lite-mesa-stat-table tbody tr'},
  {type:'carry_list', apiType:'carry_list', route:'spare-planning-carry-list-analysis', table:'.lite-mesa-analysis-detail .lite-mesa-stat-table tbody tr'},
  {type:'mission_reliability', apiType:'mission_reliability', route:'mission-reliability-task-reliability', table:'.task-reliability-result-table tbody tr'},
  {type:'downtime_factors', apiType:'downtime_factors', route:'mission-reliability-downtime-factor-analysis', table:'.downtime-event-detail-table tbody tr'},
].map(page => Object.freeze({button:'[data-lite-mesa-analysis-action="run"]', status:'分析结果已生成：50 个样本', ...page})));
export function acceptanceAssert(condition, code) {
  if (!condition) { const error = new Error(code); error.safeCode = code; throw error; }
}
// CDP capture can finish before the product renders an error. Stop waiting for
// a success-only DOM predicate once the response is definitively unsuccessful.
export function validateAvailableResponse(entry, expectedApiType) {
  if (!entry) return;
  acceptanceAssert(!entry.capture_error, 'ANALYSIS_RESPONSE_CAPTURE_FAILED');
  if (!entry.capture_finished) return;
  acceptanceAssert(entry.http_status === 200 && entry.status === 'session_complete', 'ANALYSIS_RESPONSE_FAILED');
  acceptanceAssert(entry.analysis_type === expectedApiType && entry.response_analysis_type === expectedApiType, 'ANALYSIS_TYPE_MISMATCH');
  acceptanceAssert(entry.completed === 50 && entry.failed === 0, 'SAMPLE_COUNT_MISMATCH');
}
export function validatePageEvidence(entry, page, expected) {
  const check = acceptanceAssert;
  check(!entry.capture_error && entry.http_status === 200 && entry.status === 'session_complete', 'ANALYSIS_RESPONSE_FAILED');
  check(entry.analysis_type === expected.apiType && entry.response_analysis_type === expected.apiType, 'ANALYSIS_TYPE_MISMATCH');
  check(entry.completed === 50 && entry.failed === 0, 'SAMPLE_COUNT_MISMATCH');
  check(entry.response_workers === 8 && page.configured_samples === 50 && page.configured_workers === 8, 'WORKER_OR_CONFIGURATION_MISMATCH');
  check(entry.kind === 'frozen_plan' && entry.response_context_type === 'frozen_plan' && !entry.request_settings_present, 'FROZEN_CONTEXT_REQUIRED');
  check(entry.project_hash === expected.project_hash && entry.response_project_hash === expected.project_hash, 'PROJECT_IDENTITY_MISMATCH');
  check(entry.plan_hash === expected.plan_hash && entry.response_plan_hash === expected.plan_hash, 'PLAN_IDENTITY_MISMATCH');
  check(entry.plan_fingerprint_hash && entry.plan_fingerprint_hash === entry.response_plan_fingerprint_hash, 'PLAN_FINGERPRINT_MISMATCH');
  check(/^analysis-session-[a-f0-9]+$/.test(entry.session_id || ''), 'SESSION_ID_MISSING');
  if (expected.type === 'monte_carlo') check(page.ui_sample_counts?.total === 50 && page.ui_sample_counts?.successful === 50 && page.ui_sample_counts?.failed === 0, 'MONTE_CARLO_SAMPLE_CARDS_MISMATCH');
  check(page.context_matches && page.data_rows > 0, 'RESULT_PAGE_INVALID');
  check(typeof page.display_seconds === 'number' && Number.isFinite(page.display_seconds) && page.display_seconds >= 0 && page.display_seconds <= 60, 'PER_ANALYSIS_60_SECOND_TARGET_FAILED');
}
export function validateIndependentRunSet(api, pages) {
  acceptanceAssert(api.length === 5 && pages.length === 5, 'FIVE_INDEPENDENT_RESULTS_REQUIRED');
  acceptanceAssert(new Set(api.map(item => item.session_id)).size === 5, 'ANALYSIS_SESSIONS_NOT_DISTINCT');
  acceptanceAssert(new Set(api.map(item => item.plan_fingerprint_hash)).size === 1, 'FROZEN_INPUT_CHANGED');
  acceptanceAssert(api.every(item => item.scenario_hash && item.scenario_version_hash) && new Set(api.map(item => item.scenario_hash + ':' + item.scenario_version_hash)).size === 1, 'COMPILED_SCENARIO_CHANGED');
}
