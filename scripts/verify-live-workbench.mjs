/** Exercise a real backend in a dedicated browser; never persist session tokens. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';

const redact = (value) => {
  let text = String(value);
  // Decode nested URL query encodings before masking; malformed escapes stay inert.
  for (let pass = 0; pass < 3; pass++) {
    const decoded = text.replace(/(?:%[a-f0-9]{2})+/gi, (part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (decoded === text) break;
    text = decoded;
  }
  return text
    .replace(/([?&#][^=&#\s"'<>]*(?:token|key|secret|password)[^=&#\s"'<>]*=)[^&#\s"'<>]*/gi, '$1[redacted]')
    .replace(/(["']?[\w.-]*(?:token|key|secret|password)[\w.-]*["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[\s\S])*?\2/gi, '$1$2[redacted]$2')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
};
const safeUrl = (value) => {
  try { const url = new URL(value); return redact(`${url.origin}${url.pathname}`); }
  catch { return '[invalid URL]'; }
};
const isLoopback = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const isExternal = (url) => ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !isLoopback(url);
const base = process.env.SPARE_ACCEPTANCE_URL;
if (!base) throw new Error('SPARE_ACCEPTANCE_URL must name the isolated test backend');
const native = Boolean(process.env.SPARE_ACCEPTANCE_CDP);
if (native && (!process.env.SPARE_ACCEPTANCE_REMOTE_DOWNLOADS || !process.env.SPARE_ACCEPTANCE_SSH)) {
  throw new Error('Remote CDP acceptance requires an isolated download directory and explicit SSH host');
}
if (native && process.env.SPARE_ACCEPTANCE_NATIVE_PROXY !== '1') {
  throw new Error('Native browser must use the isolated blocking proxy');
}
const output = resolve(process.env.SPARE_ACCEPTANCE_OUTPUT || 'runs/live-acceptance');
await mkdir(output, { recursive: true });
const browser = await (native
  ? chromium.connectOverCDP(process.env.SPARE_ACCEPTANCE_CDP)
  : chromium.launch({ headless: true })).catch((error) => { throw new Error(redact(error.message)); });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const evidence = { base: safeUrl(base), browser: await browser.version(), checks: [], downloads: [],
  externalRequests: [], localResourceFailures: [], consoleErrors: [] };
const remoteDownloads = new Map();
if (native) {
  const browserSession = await browser.newBrowserCDPSession();
  const pageSession = await context.newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  browserSession.on('Browser.downloadWillBegin', (event) => remoteDownloads.set(event.url, event.guid));
  await browserSession.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName', browserContextId: targetInfo.browserContextId,
    downloadPath: process.env.SPARE_ACCEPTANCE_REMOTE_DOWNLOADS, eventsEnabled: true,
  });
  await pageSession.detach();
}
const saveDownload = async (download, destination) => {
  let guid;
  if (!native) await download.saveAs(destination);
  else {
    const failure = await download.failure();
    if (failure) throw new Error(`Native download failed: ${redact(failure)}`);
    guid = remoteDownloads.get(download.url());
    if (!guid || !/^[a-f0-9-]+$/i.test(guid)) throw new Error('Native download identity was not recorded');
    const remotePath = `${process.env.SPARE_ACCEPTANCE_REMOTE_DOWNLOADS.replaceAll('\\', '/')}/${guid}`;
    const hostKeyAlias = process.env.SPARE_ACCEPTANCE_SSH_HOST_KEY_ALIAS;
    await promisify(execFile)('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UpdateHostKeys=no', ...(hostKeyAlias ? ['-o', `HostKeyAlias=${hostKeyAlias}`] : []),
      `${process.env.SPARE_ACCEPTANCE_SSH}:${remotePath}`, destination]);
  }
  const content = await readFile(destination);
  if (!content.length) throw new Error('Downloaded file is empty');
  evidence.downloads.push({ file: basename(destination), native, ...(guid ? { guid } : {}),
    sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
};
const recordExternal = (value) => {
  const url = new URL(value);
  if (isExternal(url)) {
    const safe = safeUrl(value);
    if (!evidence.externalRequests.includes(safe)) evidence.externalRequests.push(safe);
  }
};
context.on('request', (request) => recordExternal(request.url()));
if (!native) {
  await context.route('**/*', async (route) => {
    if (isExternal(new URL(route.request().url()))) await route.abort();
    else await route.continue();
  });
}
const observePage = (observedPage) => {
  observedPage.on('websocket', (socket) => recordExternal(socket.url()));
  observedPage.on('pageerror', (error) => evidence.consoleErrors.push(redact(error.message)));
};
observePage(page);
context.on('page', observePage);
const isLocalAsset = (request) => {
  const url = new URL(request.url());
  return ['http:', 'https:'].includes(url.protocol) && isLoopback(url)
    && (['script', 'stylesheet'].includes(request.resourceType()) || /\.(?:m?js|css)$/i.test(url.pathname));
};
context.on('response', (response) => {
  if (response.status() >= 400 && isLocalAsset(response.request())) {
    evidence.localResourceFailures.push({ url: safeUrl(response.url()), status: response.status(),
      resourceType: response.request().resourceType() });
  }
});
context.on('requestfailed', (request) => {
  if (isLocalAsset(request)) evidence.localResourceFailures.push({ url: safeUrl(request.url()), status: null,
    resourceType: request.resourceType(), error: redact(request.failure()?.errorText || 'Request failed') });
});
const check = (name, condition, details = {}) => {
  evidence.checks.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error(`Acceptance failed: ${name}`);
};
const verifyNativeProxy = async () => {
  // A separate context in the same native browser keeps probes out of business evidence.
  const probeContext = await browser.newContext();
  evidence.proxyProbe = { externalProxyConnectionFailed: false, loopbackBackendHealthy: false };
  try {
    const externalPage = await probeContext.newPage();
    try { await externalPage.goto('https://example.com', { timeout: 10000 }); }
    catch (error) {
      evidence.proxyProbe.externalProxyConnectionFailed = String(error.message).includes('ERR_PROXY_CONNECTION_FAILED');
    }
    check('native external proxy blocks connections', evidence.proxyProbe.externalProxyConnectionFailed);
    const localPage = await probeContext.newPage();
    const response = await localPage.goto(new URL('/_spare_mvp/health', base).href, { timeout: 15000 });
    const health = response?.ok() ? await response.json() : null;
    evidence.proxyProbe.loopbackHealthStatus = response?.status() ?? null;
    evidence.proxyProbe.loopbackBackendHealthy = response?.status() === 200
      && health?.service === 'spare-mvp-backend' && health?.status === 'ok';
    check('native proxy preserves loopback backend', evidence.proxyProbe.loopbackBackendHealthy);
  } finally { await probeContext.close(); }
};
const shot = async (name) => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
const feature = async (id) => {
  const project = new URLSearchParams(page.url().split('#')[1]).get('project');
  await page.goto(`${base}#feature=${id}&project=${encodeURIComponent(project || 'project-template-minimum-001')}`);
  await page.reload();
  await page.locator('.feature-nav').waitFor();
  console.log(JSON.stringify({ stage: id }));
};
try {
  if (native) await verifyNativeProxy();
  await page.goto(base);
  await page.locator('[data-login-submit]').waitFor();
  check('V2 brand', (await page.locator('body').innerText()).includes('V2.0'));
  await shot('01-login');
  // These are the reviewed disposable fixture accounts, never production credentials.
  await page.locator('[data-login-username]').fill('data');
  await page.locator('[data-login-password]').fill('data');
  await page.locator('[data-login-submit]').click();
  await page.locator('[data-enter-workbench]').first().waitFor();
  await shot('02-projects');
  await page.locator('[data-enter-workbench]').first().click();
  await page.waitForTimeout(1500);
  await page.locator('.feature-nav').waitFor();
  await feature('spare-planning-equipment-system');
  await page.locator('[data-feature-id="mission-reliability-reliability-block-diagram"]').waitFor();
  check('RBD reachable', await page.locator('[data-feature-id="mission-reliability-reliability-block-diagram"]').count() > 0);
  await shot('03-equipment');
  await feature('spare-planning-basic-mission');
  const name = page.locator('input[data-path$=".name"]').first();
  const original = await name.inputValue();
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/projects' && response.request().method() === 'POST');
  await name.fill(`${original} 验收`);
  await name.press('Tab');
  check('model autosave', (await saved).ok());
  await page.reload();
  await page.locator('input[data-path$=".name"]').first().waitFor();
  check('saved data rehydrated', (await page.locator('input[data-path$=".name"]').first().inputValue()).endsWith(' 验收'));
  await shot('04-saved-model');
  await feature('spare-planning-monte-carlo-experiment-detail');
  await page.locator('[data-lite-mesa-field="samples"]').fill('4');
  await page.locator('[data-lite-mesa-field="parallelCores"]').fill('2');
  await page.locator('[data-lite-mesa-field="seed"]').fill('20260621');
  await page.locator('[data-lite-mesa-field="seed"]').press('Tab');
  const mcResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/mesa-analysis-runs', { timeout: 180000 });
  await page.locator('[data-lite-mesa-action="run"]').click();
  const mc = await mcResponse;
  check('Monte Carlo HTTP', mc.ok());
  const mcBody = await mc.json();
  check('Monte Carlo samples', mcBody.status === 'session_complete' && mcBody.sample_count === 4 && !(mcBody.failed_samples || []).length,
    { status: mcBody.status, samples: mcBody.sample_count, failures: (mcBody.failed_samples || []).length });
  await page.locator('.lite-mesa-metric-cards').first().waitFor();
  await shot('05-monte-carlo');
  await feature('mission-reliability-task-reliability');
  const reliabilityResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/mesa-analysis-runs', { timeout: 180000 });
  await page.locator('[data-lite-mesa-analysis-action="run"]').click();
  const reliability = await reliabilityResponse;
  check('reliability HTTP', reliability.ok());
  await page.locator('.task-reliability-result-table').waitFor();
  check('per-sample detail', (await page.locator('.task-reliability-result-table thead').innerText()).includes('样本'));
  check('business wave axis', (await page.locator('.line-chart-x-label').first().textContent()).includes('波次'));
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-analysis-xlsx-export]').click();
  const download = await downloadEvent;
  await saveDownload(download, `${output}/task-reliability.xlsx`);
  check('XLSX downloaded', (await download.failure()) === null);
  await shot('06-reliability');
  await feature('system-management-project-data-management');
  const templateDownloadEvent = page.waitForEvent('download');
  await page.locator('[data-project-xlsx-template]').click();
  const templateDownload = await templateDownloadEvent;
  const templatePath = `${output}/project-standard-template.xlsx`;
  await saveDownload(templateDownload, templatePath);
  check('Project template downloaded', (await templateDownload.failure()) === null);
  const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/projects/import-xlsx/preview');
  await page.locator('input[data-project-replacement-file]').setInputFiles({ name: 'Project-standard-template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(templatePath) });
  const preview = await (await previewResponse).json();
  check('Project Excel public compilation', preview.ok && preview.format_version === 'project-xlsx-v1' && preview.compile_status === 'compiled',
    { format: preview.format_version, compileStatus: preview.compile_status, errors: (preview.errors || []).length });
  await shot('07-project-import-preview');
  const createResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/projects/import-xlsx/create');
  await page.locator('[data-project-xlsx-create]').click();
  check('Project Excel confirmed import', (await createResponse).ok());
  await page.waitForTimeout(1000);
  await feature('spare-planning-visual-mesa-page');
  const visResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/visualization-sessions', { timeout: 180000 });
  await page.locator('[data-visualization-session-start]').click();
  check('visualization session created', (await visResponse).ok());
  const frame = page.frameLocator('iframe[title="Solara 可视化推演"]');
  await frame.locator('body').waitFor();
  await frame.getByRole('button', { name: '单步推进', exact: true }).waitFor();
  const minute = async () => Number((await frame.locator('body').innerText()).match(/仿真分钟\s+(\d+(?:\.\d+)?)/)?.[1] ?? NaN);
  let before = await minute();
  for (let attempt = 0; attempt < 30 && !Number.isFinite(before); attempt++) {
    await page.waitForTimeout(500);
    before = await minute();
  }
  check('visualization initial frame ready', Number.isFinite(before));
  await frame.getByRole('button', { name: '单步推进', exact: true }).click();
  let after = before;
  for (let attempt = 0; attempt < 15 && !(after > before); attempt++) {
    await page.waitForTimeout(1000);
    after = await minute();
  }
  check('visualization model advanced', after > before, { before, after });
  await shot('08-visualization');
  check('no missing local scripts or styles', !evidence.localResourceFailures.some((failure) => failure.status >= 400));
  check('no uncaught browser errors', evidence.consoleErrors.length === 0);
  check('no external web assets required', evidence.externalRequests.length === 0);
} catch (error) {
  evidence.error = redact(error.message);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/browser-acceptance.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, checks: evidence.checks, error: evidence.error }));
  await context.close();
  await browser.close();
}
