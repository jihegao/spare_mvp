import { writeFile } from "node:fs/promises";
import { chromium } from "file:///Users/gaojihe/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:4173/front/";
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR || "output/playwright";
const chromePath =
  process.env.SMOKE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox"]
});

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const evidence = [];
const fallbacks = [];

async function capture(name, expectedHeading) {
  const heading = await page.locator("h2").innerText().catch(() => "");
  const breadcrumb = await page.locator(".breadcrumb").innerText().catch(() => "");
  const path = `${screenshotDir}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  evidence.push({ name, heading, breadcrumb, expectedHeading, screenshot: path });
  if (expectedHeading && heading !== expectedHeading) {
    throw new Error(`${name}: expected heading "${expectedHeading}", got "${heading}"`);
  }
}

async function openSecondary(name) {
  const summary = page.locator(
    `xpath=//details[contains(@class,"nav-module")][./summary[normalize-space(.)="备件规划评估模块"]]//details[contains(@class,"nav-secondary")][./summary[normalize-space(.)="${name}"]]/summary`
  );
  if ((await summary.count()) !== 1) throw new Error(`Cannot find secondary nav: ${name}`);
  const open = await summary.evaluate((el) => el.parentElement.open);
  if (!open) await summary.click();
}

async function clickFeature(featureId) {
  const button = page.locator(`button[data-feature-id="${featureId}"]`);
  if ((await button.count()) !== 1) throw new Error(`Cannot find feature: ${featureId}`);
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  const clicked = await page.evaluate((id) => {
    const button = document.querySelector(`button[data-feature-id="${id}"]`);
    if (!button) return false;
    for (let node = button.parentElement; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    button.click();
    return true;
  }, featureId);
  if (!clicked) throw new Error(`Cannot click feature fallback: ${featureId}`);
  fallbacks.push({ action: "dom-click-feature", featureId });
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await page.getByRole("button", { name: "登录" }).click();
await capture("01-project-list", "项目列表");

await page.getByRole("button", { name: "进入当前项目" }).click();
await capture("02-project-workbench", "仿真实验方案管理");

await openSecondary("仿真建模");
await clickFeature("spare-planning-built-in-scenario");
await capture("03-modeling-before-edit", "任务建模");

const distanceInput = page.getByLabel("距任务区(km)", { exact: true });
if ((await distanceInput.count()) !== 1) throw new Error("Modeling distance input is not unique");
await distanceInput.fill("333");
const editedValue = await distanceInput.inputValue();
if (editedValue !== "333") throw new Error(`Modeling edit did not stick: ${editedValue}`);
await capture("04-modeling-after-edit", "任务建模");

await openSecondary("仿真实验");
await clickFeature("spare-planning-monte-carlo-config");
await capture("05-monte-carlo-config", "蒙特卡洛实验");

const failureRates = page.locator('input[data-mc-array-path="monteCarlo.failureRates"]');
if ((await failureRates.count()) !== 1) throw new Error("Monte Carlo failure rate input is not unique");
await failureRates.fill("0.06,0.08,0.1");
await page.locator('button[data-mc-action="start"]').click();
await page.waitForTimeout(100);
if ((await page.locator("h2").innerText()) !== "仿真实验方案管理") {
  await page.evaluate(() => document.querySelector('button[data-mc-action="start"]')?.click());
  fallbacks.push({ action: "dom-click-monte-carlo-start" });
}
await page.waitForFunction(() => document.querySelector("h2")?.textContent === "仿真实验方案管理", null, {
  timeout: 5000
});
await capture("06-monte-carlo-started", "仿真实验方案管理");

await openSecondary("结果分析");
await clickFeature("spare-planning-monte-carlo-results");
await capture("07-result-analysis", "蒙特卡洛实验结果");

await openSecondary("仿真实验");
await clickFeature("spare-planning-visual-start-stop");
await capture("08-visual-simulation", "可视化推演");

const ontologyTab = page.locator('button[data-mesa-view="ontology"]');
if ((await ontologyTab.count()) !== 1) throw new Error("Mesa ontology tab is not unique");
await ontologyTab.click();
await capture("09-mesa-ontology", "可视化推演");

const result = await page.evaluate(() => ({
  title: document.title,
  heading: document.querySelector("h2")?.textContent,
  breadcrumb: document.querySelector(".breadcrumb")?.textContent,
  hasOntologySvg: Boolean(document.querySelector(".ontology-svg")),
  hasOntologySidePanel: document.body.innerText.includes("Ontology关系图"),
  hasMesaFallback: document.body.innerText.includes("演示快照"),
  monteCarloSampleText: document.body.innerText.match(/\d+\s*个样本/)?.[0] || null
}));

await writeFile(
  `${screenshotDir}/system-smoke-result.json`,
  `${JSON.stringify({ baseUrl, evidence, fallbacks, result }, null, 2)}\n`
);

console.log(JSON.stringify({ ok: true, baseUrl, evidence, fallbacks, result }, null, 2));
await browser.close();
