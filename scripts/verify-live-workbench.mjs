/** Exercise a real backend in a dedicated browser; never persist session tokens. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.SPARE_ACCEPTANCE_URL;
if (!base) throw new Error('SPARE_ACCEPTANCE_URL must name the isolated test backend');
const output = resolve(process.env.SPARE_ACCEPTANCE_OUTPUT || 'runs/live-acceptance');
await mkdir(output, { recursive: true });
const browser = process.env.SPARE_ACCEPTANCE_CDP
  ? await chromium.connectOverCDP(process.env.SPARE_ACCEPTANCE_CDP)
  : await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const evidence = { base, browser: await browser.version(), checks: [], externalRequests: [], consoleErrors: [] };
const redact = (text) => String(text).replace(/([?&](?:[^=&]*token|[^=&]*key)[^=&]*=)[^&\s]+/gi, '$1[redacted]');
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    evidence.externalRequests.push(`${url.origin}${url.pathname}`);
    await route.abort();
  } else await route.continue();
});
page.on('pageerror', (error) => evidence.consoleErrors.push(redact(error.message)));
const check = (name, condition, details = {}) => {
  evidence.checks.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error(`Acceptance failed: ${name}`);
};
const shot = async (name) => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
const feature = async (id) => {
  const project = new URLSearchParams(page.url().split('#')[1]).get('project');
  await page.goto(`${base}#feature=${id}&project=${encodeURIComponent(project || 'project-template-minimum-001')}`);
  await page.reload();
  await page.locator('.feature-nav').waitFor();
  console.log(JSON.stringify({ stage: id, hash: new URL(page.url()).hash }));
};
try {
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
  await download.saveAs(`${output}/task-reliability.xlsx`);
  check('XLSX downloaded', (await download.failure()) === null);
  await shot('06-reliability');
  await feature('system-management-project-data-management');
  const templateDownloadEvent = page.waitForEvent('download');
  await page.locator('[data-project-xlsx-template]').click();
  const templateDownload = await templateDownloadEvent;
  const templatePath = `${output}/project-standard-template.xlsx`;
  await templateDownload.saveAs(templatePath);
  check('Project template downloaded', (await templateDownload.failure()) === null);
  const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/projects/import-xlsx/preview');
  await page.locator('input[data-project-replacement-file]').setInputFiles(templatePath);
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
  const before = await minute();
  await frame.getByRole('button', { name: '单步推进', exact: true }).click();
  let after = before;
  for (let attempt = 0; attempt < 15 && !(after > before); attempt++) {
    await page.waitForTimeout(1000);
    after = await minute();
  }
  check('visualization model advanced', after > before, { before, after });
  await shot('08-visualization');
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
