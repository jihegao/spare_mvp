#!/usr/bin/env node
// Run against an already-running, isolated service. No server startup or DB edits.
// Response bodies and credentials stay in memory; reports contain only allowlisted metadata.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITE = ['monte_carlo', 'spare_shortfall', 'carry_list', 'mission_reliability', 'downtime_factors'];
const API_TYPES = ['mission_reliability', 'spare_shortfall', 'carry_list', 'mission_reliability', 'downtime_factors'];
const RESULT_PAGES = [
  ['spare_shortfall', 'spare-planning-spare-shortfall-analysis', '.lite-mesa-analysis-detail .lite-mesa-stat-table tbody tr'],
  ['carry_list', 'spare-planning-carry-list-analysis', '.lite-mesa-analysis-detail .lite-mesa-stat-table tbody tr'],
  ['mission_reliability', 'mission-reliability-task-reliability', '.task-reliability-result-table tbody tr'],
  ['downtime_factors', 'mission-reliability-downtime-factor-analysis', '.downtime-event-detail-table tbody tr'],
];
const digest = value => createHash('sha256').update(String(value ?? '')).digest('hex');
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const assert = (condition, code) => { if (!condition) { const error = new Error(code); error.safeCode = code; throw error; } };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { schema: 'issue-366-browser-acceptance-v1', started_at: new Date().toISOString(), samples_per_analysis: 50, requested_workers: 8, api: [], suite: [], pages: [], passed: false };
let browser, resultDir, stage = 'configuration';
const pending = new Set();
const responseRecords = new Map();
let captureEnabled = false;

// Resolve symlinks after mkdir so optional screenshots cannot land inside the checkout.
async function externalDirectory(directory) {
  assert(path.isAbsolute(directory), 'RESULT_DIRECTORY_MUST_BE_ABSOLUTE');
  await mkdir(directory, { recursive: true });
  const target = await realpath(directory);
  const checkout = await realpath(repoRoot);
  assert(target !== checkout && !target.startsWith(checkout + path.sep), 'RESULT_DIRECTORY_MUST_BE_OUTSIDE_CHECKOUT');
  return target;
}
function contextIdentity(context) {
  const frozen = context?.kind === 'frozen_plan';
  return {
    kind: frozen ? 'frozen_plan' : 'current_project',
    project_hash: digest(frozen ? context.projectId : context?.project?.project_id),
    plan_hash: frozen ? digest(context.experimentPlanId) : null,
    plan_fingerprint_hash: frozen ? digest(context.planFingerprint) : null,
    // Hash the complete submitted modeling snapshot without retaining it.
    input_hash: frozen ? null : digest(JSON.stringify(context?.project || {})),
  };
}

try {
  resultDir = await externalDirectory(process.env.RESULT_DIR || await mkdtemp(path.join(tmpdir(), 'issue-366-acceptance-')));
  const screenshotDir = process.env.SCREENSHOT_DIR ? await externalDirectory(process.env.SCREENSHOT_DIR) : null;
  const username = process.env.ACCEPTANCE_USER;
  const password = process.env.ACCEPTANCE_PASSWORD;
  assert(username && password, 'CREDENTIAL_ENV_REQUIRED');
  const url = new URL(process.env.BASE_URL || 'http://127.0.0.1:4173/front/');
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'INVALID_BASE_URL');
  report.target_hash = digest(url.origin + url.pathname);
  report.tested_revision = /^[a-f0-9]{7,40}$/i.test(process.env.TESTED_SHA || '') ? process.env.TESTED_SHA : null;
  report.revision_source = 'operator-provided TESTED_SHA; verify the running service separately';
  assert(report.tested_revision, 'TESTED_SHA_REQUIRED');
  const timeoutMs = Number(process.env.ACCEPTANCE_TIMEOUT_MS || 1_200_000);
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'INVALID_TIMEOUT');
  browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(45_000);
  // Large downtime responses may exceed Chromium's default DevTools body buffer.
  // Reserve bounded capture space before requests; keep all payloads in memory.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable', { maxPostDataSize: 8 * 1024 * 1024, maxTotalBufferSize: 256 * 1024 * 1024, maxResourceBufferSize: 128 * 1024 * 1024 });
  // Passive listeners do not replace, replay or persist requests/responses.
  cdp.on('Network.requestWillBeSent', event => {
    const request = event.request;
    if (!captureEnabled || request.method !== 'POST' || new URL(request.url).pathname !== '/api/mesa-analysis-runs') return;
    const entry = { index: report.api.length, started: performance.now(), http_status: null };
    try {
      const body = JSON.parse(request.postData);
      Object.assign(entry, {
        suite_type: SUITE[entry.index] || 'unexpected', analysis_type: API_TYPES.includes(body?.analysis_type) ? body.analysis_type : 'unexpected',
        requested_samples: number(body?.settings?.samples), requested_workers: number(body?.settings?.parallelCores),
        ...contextIdentity(body?.context),
      });
    } catch { entry.capture_error = 'REQUEST_METADATA_UNREADABLE'; }
    report.api.push(entry);
    responseRecords.set(event.requestId, entry);
  });
  cdp.on('Network.responseReceived', event => {
    const entry = responseRecords.get(event.requestId);
    if (!entry) return;
    entry.http_status = event.response.status;
  });
  cdp.on('Network.loadingFailed', event => {
    const entry = responseRecords.get(event.requestId);
    if (!entry) return;
    entry.capture_error = 'NETWORK_LOADING_FAILED';
    responseRecords.delete(event.requestId);
  });
  cdp.on('Network.loadingFinished', event => {
    const entry = responseRecords.get(event.requestId);
    if (!entry) return;
    responseRecords.delete(event.requestId);
    entry.encoded_bytes = event.encodedDataLength;
    const task = (async () => {
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
        const payload = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
        entry.status = ['session_complete', 'blocked'].includes(payload?.status) ? payload.status : 'unexpected';
        entry.issue_codes = [...(payload?.issues || []), ...(payload?.errors || [])].map(item => item?.code).filter(code => /^[a-z0-9_]+$/.test(code || ''));
        entry.completed = number(payload?.completed_sample_count ?? payload?.sample_count);
        entry.failed = number(payload?.failed_sample_count ?? payload?.failed_samples?.length ?? 0);
        entry.session_id = /^analysis-session-[a-f0-9]+$/.test(payload?.analysis_session_id || '') ? payload.analysis_session_id : null;
        entry.response_project_hash = digest(payload?.project_id);
        entry.response_plan_hash = payload?.context?.experiment_plan_id ? digest(payload.context.experiment_plan_id) : null;
        entry.response_context_type = ['current_project', 'frozen_plan'].includes(payload?.context?.type) ? payload.context.type : null;
        entry.response_analysis_type = API_TYPES.includes(payload?.analysis_type) ? payload.analysis_type : 'unexpected';
        entry.response_workers = number(payload?.worker_count);
        entry.backend_seconds = number(payload?.timings?.total_seconds);
        entry.response_seconds = (performance.now() - entry.started) / 1000;
      } catch (error) {
        entry.capture_error = /evicted|buffer/i.test(error.message) ? 'BODY_BUFFER_EVICTED' : /No resource|No data/i.test(error.message) ? 'BODY_UNAVAILABLE' : 'RESPONSE_METADATA_UNREADABLE';
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });

  stage = 'login';
  await page.goto(url.href);
  await page.locator('[data-login-username]').fill(username);
  await page.locator('[data-login-password]').fill(password);
  await page.locator('[data-login-submit]').click();
  await page.locator('[data-enter-workbench]').first().waitFor();
  const projects = await page.locator('.project-card').evaluateAll(cards => cards.map((card, index) => ({ index, name: card.querySelector('h3')?.textContent || '' })));
  const candidates = process.env.PROJECT_NAME
    ? projects.filter(item => item.name === process.env.PROJECT_NAME)
    : projects.filter(item => /F[\s_-]?35/i.test(item.name));
  assert(candidates.length === 1, 'PROJECT_SELECTION_AMBIGUOUS');
  stage = 'select-current-project';
  await page.locator('.project-card').nth(candidates[0].index).locator('[data-enter-workbench]').click();
  await page.waitForFunction(() => document.querySelector('.workspace-shell'));
  await page.getByText('已从 Project draft 恢复', { exact: true }).waitFor();
  await page.evaluate(() => { location.hash = 'feature=spare-planning-monte-carlo-experiment-detail'; });
  await page.locator('[data-analysis-suite-run]').waitFor();
  const contextSelect = page.locator('[data-current-experiment-plan]');
  const currentKey = await contextSelect.locator('option').evaluateAll(options => options.find(option => option.value.startsWith('current-project:'))?.value);
  assert(currentKey && currentKey !== 'current-project:none', 'CURRENT_PROJECT_CONTEXT_MISSING');
  await contextSelect.selectOption(currentKey);
  report.context_key_hash = digest(currentKey);
  report.project_hash = digest(currentKey.slice('current-project:'.length));
  await page.locator('[data-lite-mesa-field="samples"]').fill('50');
  await page.locator('[data-lite-mesa-field="samples"]').dispatchEvent('change');
  await page.locator('[data-lite-mesa-field="parallelCores"]').fill('8');
  await page.locator('[data-lite-mesa-field="parallelCores"]').dispatchEvent('change');

  stage = 'five-analysis-suite';
  captureEnabled = true;
  const suiteStarted = performance.now();
  await page.locator('[data-analysis-suite-run]').click();
  await page.locator('[data-analysis-suite-result]').waitFor();
  while (performance.now() - suiteStarted < timeoutMs) {
    const idle = await page.locator('[data-analysis-suite-run]').isEnabled();
    // The result section exists only after this click started the suite. Once
    // the UI returns to idle, fewer than five requests is a terminal failure.
    if (idle && pending.size === 0 && responseRecords.size === 0) {
      assert(report.api.length === 5, 'SUITE_STOPPED_BEFORE_FIVE_RESULTS');
      break;
    }
    assert(report.api.length <= 5, 'UNEXPECTED_ANALYSIS_REQUEST_COUNT');
    await page.waitForTimeout(250);
  }
  await Promise.all([...pending]);
  assert(performance.now() - suiteStarted < timeoutMs, 'SUITE_TIMEOUT');
  report.total_seconds = (performance.now() - suiteStarted) / 1000;
  report.suite = await page.locator('[data-analysis-suite-result] tbody tr').evaluateAll(rows => rows.map((row, index) => {
    const cells = [...row.cells].map(cell => cell.textContent.trim());
    return { index, completed: Number(cells[1]?.split('/')[0]), failed: Number(cells[2]), display_seconds: Number.parseFloat(cells[4]), within_target: cells[5]?.includes('完成，≤60秒') || false };
  }));
  assert(report.api.length === 5 && report.suite.length === 5, 'FIVE_RESULTS_REQUIRED');
  for (const [index, entry] of report.api.entries()) {
    assert(!entry.capture_error && entry.http_status === 200 && entry.status === 'session_complete', 'ANALYSIS_RESPONSE_FAILED');
    assert(entry.analysis_type === API_TYPES[index] && entry.response_analysis_type === API_TYPES[index], 'ANALYSIS_TYPE_MISMATCH');
    assert(entry.completed === 50 && entry.failed === 0 && entry.requested_samples === 50, 'SAMPLE_COUNT_MISMATCH');
    assert(entry.requested_workers === 8 && entry.response_workers === 8, 'WORKER_COUNT_MISMATCH');
    assert(entry.session_id, 'SESSION_ID_MISSING');
    assert(entry.kind === 'current_project' && entry.response_context_type === 'current_project', 'CONTEXT_KIND_MISMATCH');
    assert(entry.project_hash === report.project_hash && entry.response_project_hash === report.project_hash, 'PROJECT_IDENTITY_MISMATCH');
    assert(entry.input_hash === report.api[0].input_hash && entry.plan_hash === report.api[0].plan_hash, 'INPUT_IDENTITY_CHANGED');
  }
  assert(new Set(report.api.map(item => item.session_id)).size === 5, 'ANALYSIS_SESSIONS_NOT_DISTINCT');
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'suite.png'), fullPage: true });

  stage = 'result-pages';
  for (const [type, route, tableSelector] of RESULT_PAGES) {
    await page.evaluate(route => { location.hash = `feature=${route}`; }, route);
    await page.locator('[data-lite-mesa-analysis-action="run"]').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.inline-status')].some(node => /分析结果已生成：50 个样本/.test(node.textContent)));
    const selected = await page.locator('[data-current-experiment-plan]').inputValue();
    const rows = await page.locator(tableSelector).evaluateAll(nodes => nodes.filter(row => !row.querySelector('[colspan]') && row.cells.length > 1 && [...row.cells].some(cell => cell.textContent.trim())).length);
    const counts = { analysis_type: type, sample_count: 50, data_rows: rows, context_key_hash: digest(selected), context_matches: selected === currentKey,
      snapshot_cards: await page.locator('.lite-mesa-event-snapshot').count(), pagination_controls: await page.locator('.table-pagination').count() };
    report.pages.push(counts);
    assert(counts.context_matches, 'RESULT_PAGE_CONTEXT_CHANGED');
    assert(rows > 0, 'RESULT_PAGE_HAS_NO_DATA_ROWS');
    assert(await page.locator('[data-analysis-xlsx-export]').isEnabled(), 'RESULT_NOT_EXPORTABLE');
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${type}.png`), fullPage: true });
  }
  assert(report.api.length === 5, 'RESULT_NAVIGATION_TRIGGERED_EXTRA_RUN');
  assert(report.suite.every(row => row.completed === 50 && row.failed === 0 && row.within_target && Number.isFinite(row.display_seconds) && row.display_seconds <= 60), 'PER_ANALYSIS_60_SECOND_TARGET_FAILED');
  report.passed = true;
} catch (error) {
  report.failure = { stage, code: error.safeCode || 'BROWSER_OR_RUNTIME_ERROR' };
  process.exitCode = 1;
} finally {
  captureEnabled = false;
  await browser?.close();
  await Promise.all([...pending]);
  report.finished_at = new Date().toISOString();
  for (const entry of report.api) delete entry.started;
  if (resultDir) {
    const file = path.join(resultDir, 'browser-acceptance.json');
    await writeFile(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ passed: report.passed, report: file, failure: report.failure || null }));
  } else {
    console.error('Acceptance configuration failed before report directory creation.');
  }
}
