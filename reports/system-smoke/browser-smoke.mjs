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
  if ((await button.count()) === 1 && await button.isVisible()) {
    await button.click();
    return;
  }
  const clicked = await page.evaluate((id) => {
    const button = document.querySelector(`button[data-feature-id="${id}"]`);
    if (!button) {
      location.hash = `feature=${id}`;
      return true;
    }
    for (let node = button.parentElement; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    button.click();
    return true;
  }, featureId);
  if (!clicked) throw new Error(`Cannot click feature fallback: ${featureId}`);
  fallbacks.push({ action: "dom-click-feature", featureId });
}

async function expectHeading(page, expected) {
  await page.waitForFunction((heading) => document.querySelector("h2")?.textContent === heading, expected, {
    timeout: 5000
  });
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await page.evaluate(() => localStorage.clear());
await page.getByRole("button", { name: "登录" }).click();
await capture("01-project-list", "项目列表");

await page.getByRole("button", { name: "进入当前项目" }).click();
await capture("02-project-workbench", "装备系统建模");

await openSecondary("仿真建模");
await clickFeature("spare-planning-basic-mission");
await capture("03-modeling-before-edit", "装备任务建模");

const missionDurationInput = page.locator('input[data-path="basicMission.taskDurationMinutes"]');
if ((await missionDurationInput.count()) !== 1) throw new Error("Modeling mission duration input is not unique");
await missionDurationInput.fill("333");
const editedValue = await missionDurationInput.inputValue();
if (editedValue !== "333") throw new Error(`Modeling edit did not stick: ${editedValue}`);
await capture("04-modeling-after-edit", "装备任务建模");

await verifyModelingButtonsReact();

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

const result = await page.evaluate(() => ({
  title: document.title,
  heading: document.querySelector("h2")?.textContent,
  breadcrumb: document.querySelector(".breadcrumb")?.textContent,
  visualTabs: [...document.querySelectorAll("[data-mesa-view]")].map((item) => item.textContent),
  hasMesaFallback: document.body.innerText.includes("演示快照"),
  monteCarloSampleText: document.body.innerText.match(/\d+\s*个样本/)?.[0] || null
}));

await writeFile(
  `${screenshotDir}/system-smoke-result.json`,
  `${JSON.stringify({ baseUrl, evidence, fallbacks, result }, null, 2)}\n`
);

console.log(JSON.stringify({ ok: true, baseUrl, evidence, fallbacks, result }, null, 2));
await browser.close();

async function verifyModelingButtonsReact() {
  await clickFeature("spare-planning-basic-mission");
  await expectHeading(page, "装备任务建模");
  await clickAndExpectChange(
    'button[data-basic-mission-add]',
    () => page.locator("[data-select-basic-mission]").count(),
    "basic mission add button did not add a selectable task"
  );

  await clickFeature("spare-planning-composite-task");
  await expectHeading(page, "装备任务建模");
  await clickAndExpectChange(
    'button[data-composite-task-add]',
    () => page.locator("[data-select-composite-task]").count(),
    "composite task add button did not add a task row"
  );
  await clickAndExpectChange(
    'button[data-composite-task-item-add]',
    () => page.locator("button[data-composite-task-item-delete]").count(),
    "composite task item add button did not add a task item"
  );

  await clickFeature("spare-planning-equipment-composition");
  await expectHeading(page, "装备系统建模");
  await clickAndExpectChange(
    'button[data-equipment-add-node]',
    () => page.locator("[data-select-equipment-component]").count(),
    "equipment add node button did not add a component"
  );

  await clickFeature("spare-planning-basic-support-activity");
  await expectHeading(page, "保障活动建模");
  const firstJob = page.locator("[data-support-activity-job-select]").first();
  if ((await firstJob.count()) > 0) {
    await firstJob.check();
    await clickAndExpectChange(
      'button[data-support-activity-job-batch-delete]',
      () => page.locator("button[data-support-activity-job-delete]").count(),
      "support activity batch delete button did not remove selected jobs"
    );
  }
  await capture("04b-modeling-buttons-react", "保障活动建模");
}

async function clickAndExpectChange(selector, readState, message) {
  const before = await readState();
  await page.locator(selector).click();
  await page.waitForTimeout(100);
  const after = await readState();
  if (after === before) throw new Error(`${message}: ${before}`);
}
