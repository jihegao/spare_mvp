import { writeFile } from "node:fs/promises";
import { chromium } from "file:///Users/gaojihe/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs";
import { defaultScenario } from "../../front/sim-engine.mjs";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:4173/front/";
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR || "output/playwright";
const captureScreenshots = process.env.SMOKE_CAPTURE_SCREENSHOTS === "1";
const chromePath =
  process.env.SMOKE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const manualProjectsStorageKey = "spare-mvp:manualProjects:v1";
const manualProjectJsonStorageKey = "spare-mvp:manualProjectJson:v1";
const smokeProject = {
  id: "system-smoke-project",
  name: "系统 smoke 项目",
  baseCode: "SMK-01",
  updatedAt: "2026-06-30",
  summary: "浏览器 smoke 使用的本地完整 Project draft。",
  sourceKind: "manual_draft"
};
const smokeProjectJson = {
  ...structuredClone(defaultScenario),
  project_id: "project-system-smoke",
  scenarioId: "system-smoke-scenario",
  activeModule: "sparePlanning",
  experiment: { name: "系统 smoke 实验", steps: 24, samples: 2, seed: 20260630 },
  missionProfile: { name: "系统 smoke 任务剖面", durationHours: 8, compositeTasks: [], periodicTasks: [] },
  basicMission: { name: "系统 smoke 基本任务", equipmentType: "J-15", taskDurationMinutes: 90, minRequiredSorties: 1 },
  equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
  supportNodes: [{
    id: "carrier-deck",
    name: "航母飞行甲板",
    personnelModel: "机务",
    personnelCapacity: 10,
    supportEquipmentName: "检测仪",
    supportEquipmentModel: "JY-01",
    equipmentCapacity: 8,
    inventory: { 航电模块: 3 },
    spareModels: { 航电模块: "HD-01" }
  }],
  supportActivities: [{
    id: "ops-smoke-1",
    activityType: "使用保障",
    planType: "直接准备方案",
    planGroupId: "ops-smoke",
    activityName: "J-15 直接准备方案",
    aircraftModel: "J-15",
    durationHours: 1,
    jobs: [{
      activityCode: "BA-001",
      workName: "初始工作项目",
      predecessors: [],
      durationMinutes: 20,
      personnel: "机务人员,1",
      equipment: "检测仪,1",
      spare: "航电模块"
    }]
  }]
};

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox"]
});

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(({ projectsKey, jsonKey, project, projectJson }) => {
  localStorage.clear();
  localStorage.setItem(projectsKey, JSON.stringify([project]));
  localStorage.setItem(jsonKey, JSON.stringify({ [project.id]: projectJson }));
}, {
  projectsKey: manualProjectsStorageKey,
  jsonKey: manualProjectJsonStorageKey,
  project: smokeProject,
  projectJson: smokeProjectJson
});
const evidence = [];
const fallbacks = [];

async function capture(name, expectedHeading) {
  if (expectedHeading) await expectHeading(page, expectedHeading);
  const headings = await page.locator("h2, h3, h4, h5, .nav-tertiary-link.active, .compact-fourth-tabs .active").allInnerTexts().catch(() => []);
  const heading = headings.find((item) => item === expectedHeading) || headings[0] || "";
  const breadcrumb = await page.locator(".breadcrumb").innerText().catch(() => "");
  const path = captureScreenshots ? `${screenshotDir}/${name}.png` : `${screenshotDir}/${name}.txt`;
  if (captureScreenshots) {
    await page.screenshot({ path, fullPage: false, timeout: 15000 });
  } else {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    await writeFile(path, `${bodyText.slice(0, 12000)}\n`);
  }
  evidence.push({ name, heading, breadcrumb, expectedHeading, artifact: path });
  if (expectedHeading && !headings.includes(expectedHeading)) {
    throw new Error(`${name}: expected heading "${expectedHeading}", got "${headings.join(" / ")}"`);
  }
  console.log(JSON.stringify({ smokeStep: name, heading, artifact: path }));
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

async function openMonteCarloExperimentForRun() {
  const experimentNameInput = page.locator('input[data-mc-experiment-field="name"]').first();
  if (await experimentNameInput.isVisible().catch(() => false)) return;

  const editButton = page.locator('button[data-mc-experiment-action="edit"]').first();
  const addButton = page.locator('button[data-mc-experiment-action="add"]').first();
  if (await editButton.isVisible().catch(() => false)) {
    await editButton.click();
  } else if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
  } else {
    throw new Error("Cannot find Monte Carlo experiment add/edit action before opening editor");
  }

  await experimentNameInput.waitFor({ state: "visible", timeout: 5000 });
}

async function openMonteCarloExperimentDetailForRun() {
  const detailHeading = page.locator("h3", { hasText: "Mesa蒙特卡洛分析" }).first();
  if (await detailHeading.isVisible().catch(() => false)) return;

  const detailTab = page.locator('button[data-feature-id="spare-planning-monte-carlo-experiment-detail"]').first();
  if (await detailTab.isVisible().catch(() => false)) {
    await detailTab.click();
  } else {
    const listDetailButton = page.locator('button[data-mc-experiment-action="detail"]').first();
    if (!await listDetailButton.isVisible().catch(() => false)) {
      throw new Error("Cannot find Monte Carlo experiment detail action before checking results");
    }
    await listDetailButton.click();
  }

  await detailHeading.waitFor({ state: "visible", timeout: 5000 });
}

async function expectHeading(page, expected) {
  await page.waitForFunction(
    (heading) => [...document.querySelectorAll("h2, h3, h4, h5, .nav-tertiary-link.active, .compact-fourth-tabs .active")]
      .some((item) => item.textContent?.trim() === heading),
    expected,
    {
    timeout: 5000
    }
  );
}

async function enterAvailableProject() {
  const entryButton = page.locator("button[data-enter-workbench][data-project-id]").first();
  if (!await entryButton.isVisible().catch(() => false)) {
    const addButton = page.locator("button[data-project-add]").first();
    if (!await addButton.isVisible().catch(() => false)) {
      throw new Error("Cannot find project entry or add action before entering workbench");
    }
    await addButton.click();
  }
  await page.locator("button[data-enter-workbench][data-project-id]").first().waitFor({
    state: "visible",
    timeout: 5000
  });
  await page.locator("button[data-enter-workbench][data-project-id]").first().click();
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await page.getByRole("button", { name: "登录" }).click();
await capture("01-project-list", "项目列表");

await enterAvailableProject();
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
await clickFeature("spare-planning-monte-carlo-experiment-list");
await capture("05-monte-carlo-list", "蒙特卡洛实验");
await openMonteCarloExperimentForRun();
await capture("05b-monte-carlo-editor", "蒙特卡洛实验");

await openMonteCarloExperimentDetailForRun();
await capture("06-monte-carlo-detail-results", "蒙特卡洛实验");

await openSecondary("仿真实验");
await clickFeature("spare-planning-visual-start-stop");
await capture("08-visual-simulation", "可视化推演");

const retiredLegacyRoutes = await verifyRetiredLegacyResultRoutes();

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
  `${JSON.stringify({ baseUrl, evidence, fallbacks, result, retiredLegacyRoutes }, null, 2)}\n`
);

console.log(JSON.stringify({ ok: true, baseUrl, evidence, fallbacks, result, retiredLegacyRoutes }, null, 2));
await browser.close();

async function verifyRetiredLegacyResultRoutes() {
  const checks = [
    {
      featureId: "spare-planning-monte-carlo-results",
      retiredReason: "spare planning MC results alias removed"
    },
    {
      featureId: "mission-reliability-monte-carlo-results",
      retiredReason: "mission reliability MC results alias removed"
    },
    {
      featureId: "mission-reliability-aircraft-task-reliability",
      retiredReason: "task reliability legacy alias still maps to active task reliability page"
    }
  ];
  const checked = [];
  for (const check of checks) {
    locationHash(check.featureId);
    await page.waitForTimeout(50);
    const activeFeatureId = await page.evaluate(() => document.querySelector("[data-feature-id].active")?.dataset.featureId || "");
    checked.push({ ...check, activeFeatureId });
    if (activeFeatureId === check.featureId) {
      throw new Error(`${check.featureId}: retired legacy route is still active`);
    }
  }
  return checked;
}

async function locationHash(featureId) {
  await page.evaluate((id) => {
    location.hash = `feature=${id}`;
  }, featureId);
}

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
