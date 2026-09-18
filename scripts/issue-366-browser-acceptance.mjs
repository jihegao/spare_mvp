#!/usr/bin/env node
// Run against an already-running, isolated service. Creates a plan through the UI
// unless PLAN_NAME selects an existing frozen plan. No direct DB/API writes.
// Response bodies and credentials stay in memory; reports contain only allowlisted metadata.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_PAGES, acceptanceAssert as assert, validatePageEvidence, validateIndependentRunSet, validateAvailableResponse } from './analysis-page-acceptance.mjs';
const API_TYPES = ANALYSIS_PAGES.map(page => page.apiType);
const digest = value => createHash('sha256').update(String(value ?? '')).digest('hex');
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { schema: 'issue-376-independent-browser-acceptance-v2', acceptance_mode: 'five-original-page-buttons', code_lineage: 'V2 integration candidate', started_at: new Date().toISOString(), samples_per_analysis: 50, requested_workers: 8, api: [], pages: [], passed: false };
let browser, ownedContext, resultDir, stage = 'configuration';
const remoteBrowser = Boolean(process.env.CDP_URL);
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
  assert(!remoteBrowser || !process.env.PLAN_NAME, 'REMOTE_ACCEPTANCE_REQUIRES_FRESH_PLAN');
  browser = remoteBrowser
    ? await chromium.connectOverCDP(process.env.CDP_URL)
    : await chromium.launch({ headless: process.env.HEADED !== '1' });
  // An owned context isolates login/storage and is the only remote surface closed.
  ownedContext = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await ownedContext.newPage();
  report.browser = {connection:remoteBrowser ? 'operator-owned-edge-cdp' : 'local-chromium', version:browser.version()};
  report.timing_source = 'browser performance.now: original button click to result DOM plus two requestAnimationFrame callbacks';
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
        page_type: ANALYSIS_PAGES[entry.index]?.type || 'unexpected', request_settings_present: Object.hasOwn(body || {}, 'settings'), analysis_type: API_TYPES.includes(body?.analysis_type) ? body.analysis_type : 'unexpected',
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
    entry.capture_finished = true;
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
        entry.response_plan_fingerprint_hash = payload?.context?.planFingerprint ? digest(payload.context.planFingerprint) : null;
        entry.response_context_type = ['current_project', 'frozen_plan'].includes(payload?.context?.type) ? payload.context.type : null;
        entry.response_analysis_type = API_TYPES.includes(payload?.analysis_type) ? payload.analysis_type : 'unexpected';
        entry.response_workers = number(payload?.worker_count);
        entry.backend_seconds = number(payload?.timings?.total_seconds);
        entry.response_seconds = (performance.now() - entry.started) / 1000;
      } catch (error) {
        entry.capture_error = /evicted|buffer/i.test(error.message) ? 'BODY_BUFFER_EVICTED' : /No resource|No data/i.test(error.message) ? 'BODY_UNAVAILABLE' : 'RESPONSE_METADATA_UNREADABLE';
      } finally {
        entry.capture_finished = true;
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });

  stage = 'login';
  await page.goto(url.href);
  report.browser.user_agent = await page.evaluate(() => navigator.userAgent);
  assert(!remoteBrowser || /Edg\//.test(report.browser.user_agent), 'REMOTE_BROWSER_MUST_BE_NATIVE_EDGE');
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
  await page.locator('[data-current-experiment-plan]').waitFor();
  const currentKey = await page.locator('[data-current-experiment-plan] option').evaluateAll(options => options.find(option => option.value.startsWith('current-project:'))?.value);
  assert(currentKey && currentKey !== 'current-project:none', 'CURRENT_PROJECT_CONTEXT_MISSING');
  report.project_hash = digest(currentKey.slice('current-project:'.length));
  await page.locator('[data-current-experiment-plan]').selectOption(currentKey);
  stage = 'prepare-frozen-plan';
  const planName = process.env.PLAN_NAME || `Acceptance 50x8 ${Date.now()}`;
  if (!process.env.PLAN_NAME) {
    await page.evaluate(() => { location.hash = 'feature=spare-planning-experiment-plan-management'; });
    await page.locator('[data-experiment-plan-add]').click();
    for (const [field, value] of [['name', planName], ['samples', '50'], ['parallelCores', '8']]) {
      const input = page.locator(`[data-experiment-plan-path="experiment.${field}"]`);
      await input.fill(value);
      await input.dispatchEvent('change');
    }
    await page.locator('[data-experiment-seed-policy]').selectOption('fixed');
    await page.locator('[data-experiment-seed-base]').fill('20260621');
    await page.locator('[data-experiment-seed-base]').dispatchEvent('change');
    await page.locator('[data-save-plan]').click();
    const row = page.locator('tr').filter({has: page.getByText(planName, {exact:true})});
    await row.locator('[data-experiment-plan-freeze]').click();
    await row.locator('[data-experiment-plan-unfreeze]').waitFor();
  }
  await page.evaluate(() => { location.hash = 'feature=spare-planning-monte-carlo-experiment-detail'; });
  const select = page.locator('[data-current-experiment-plan]');
  await page.waitForFunction(name => [...document.querySelectorAll('[data-current-experiment-plan] option')].some(option => option.textContent === name && !option.value.startsWith('current-project:')), planName);
  const planOptions = await select.locator('option').evaluateAll((options, name) => options.filter(option => option.textContent === name && !option.value.startsWith('current-project:')).map(option => option.value), planName);
  assert(planOptions.length === 1, 'FROZEN_PLAN_SELECTION_AMBIGUOUS');
  const planKey = planOptions[0];
  await select.selectOption(planKey);
  report.plan_hash = digest(planKey);
  report.context_key_hash = digest(planKey);
  report.plan_created_via_ui = !process.env.PLAN_NAME;
  report.plan_source = process.env.PLAN_NAME ? 'explicit-existing-frozen-plan' : 'current-project-new-plan-via-ui';
  const configuredSamples = Number(await page.locator('[data-lite-mesa-field="samples"]').inputValue());
  const configuredWorkers = Number(await page.locator('[data-lite-mesa-field="parallelCores"]').inputValue());
  assert(configuredSamples === 50 && configuredWorkers === 8, 'FROZEN_PLAN_MUST_BE_50_SAMPLES_8_WORKERS');
  captureEnabled = true;
  const allStarted = performance.now();
  for (const [index, definition] of ANALYSIS_PAGES.entries()) {
    stage = `independent-page-${definition.type}`;
    await page.evaluate(route => { location.hash = `feature=${route}`; }, definition.route);
    await page.locator(definition.button).waitFor();
    await page.locator('[data-current-experiment-plan]').selectOption(planKey);
    assert(await page.locator('[data-analysis-suite-run], [data-analysis-suite-result]').count() === 0, 'PRODUCT_BATCH_CONTROL_MUST_BE_ABSENT');
    assert(report.api.length === index, 'NAVIGATION_TRIGGERED_ANALYSIS');
    // Only tool-owned observation state is installed. No product state or
    // requests are modified; the real click starts the clock in this page.
    await page.evaluate(definition => {
      window.__acceptanceObservation?.dispose();
      const observation = { started: null, result: null, scheduled: false };
      const dataRows = () => [...document.querySelectorAll(definition.table)].filter(row => !row.querySelector('[colspan]') && row.cells.length > 1 && [...row.cells].some(cell => cell.textContent.trim())).length;
      const ready = () => [...document.querySelectorAll('.inline-status')].some(node => node.textContent.includes(definition.status)) && dataRows() > 0;
      const observer = new MutationObserver(() => {
        if (observation.started === null || observation.scheduled || !ready()) return;
        observation.scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (ready()) observation.result = {display_seconds:(performance.now()-observation.started)/1000, data_rows:dataRows()};
          else observation.scheduled = false;
        }));
      });
      const click = event => {
        if (!event.target.closest(definition.button)) return;
        observation.started = performance.now();
        observer.observe(document.body, {childList:true, subtree:true, characterData:true});
      };
      document.addEventListener('click', click, {capture:true, once:true});
      observation.dispose = () => { observer.disconnect(); document.removeEventListener('click', click, true); };
      window.__acceptanceObservation = observation;
    }, definition);
    await page.locator(definition.button).click();
    const displayWaitStarted = performance.now();
    while (!await page.evaluate(() => Boolean(window.__acceptanceObservation?.result))) {
      validateAvailableResponse(report.api[index], definition.apiType);
      assert(performance.now() - displayWaitStarted < timeoutMs, 'RESULT_DISPLAY_TIMEOUT');
      await page.waitForTimeout(50);
    }
    const measurement = await page.evaluate(() => { const value = window.__acceptanceObservation.result; window.__acceptanceObservation.dispose(); return value; });
    const selected = await page.locator('[data-current-experiment-plan]').inputValue();
    const record = {analysis_type:definition.type, ...measurement, configured_samples:configuredSamples, configured_workers:configuredWorkers,
      context_key_hash:digest(selected), context_matches:selected === planKey,
      snapshot_cards:await page.locator('.lite-mesa-event-snapshot').count(), pagination_controls:await page.locator('.table-pagination').count()};
    if (definition.type === 'monte_carlo') {
      record.ui_sample_counts = await page.locator('.lite-mesa-metric-cards .metric-card').evaluateAll(cards => {
        const count = label => Number(cards.find(card => card.querySelector('span')?.textContent === label)?.querySelector('strong')?.textContent);
        return {total:count('总样本'), successful:count('成功样本'), failed:count('失败样本')};
      });
    }
    report.pages.push(record);
    const captureStarted = performance.now();
    while (responseRecords.size || pending.size || report.api.length < index + 1) {
      assert(performance.now() - captureStarted < 45_000, 'METADATA_CAPTURE_TIMEOUT');
      await page.waitForTimeout(50);
    }
    assert(report.api.length === index + 1, 'ONE_REQUEST_PER_PAGE_REQUIRED');
    validatePageEvidence(report.api[index], record, {...definition, project_hash:report.project_hash, plan_hash:report.plan_hash});
    if (definition.type !== 'monte_carlo') assert(await page.locator('[data-analysis-xlsx-export]').isEnabled(), 'RESULT_NOT_EXPORTABLE');
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir, `${definition.type}.png`), fullPage:true});
  }
  report.total_seconds = (performance.now() - allStarted) / 1000;
  validateIndependentRunSet(report.api, report.pages);
  report.passed = true;
} catch (error) {
  report.failure = { stage, code: error.safeCode || 'BROWSER_OR_RUNTIME_ERROR' };
  process.exitCode = 1;
} finally {
  captureEnabled = false;
  await ownedContext?.close();
  if (!remoteBrowser) await browser?.close();
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

// End the CDP client process without sending Browser.close to remote Edge.
// Owned context was closed and all evidence writes completed above.
if (remoteBrowser) process.exit(process.exitCode || 0);
