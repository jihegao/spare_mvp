import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "file:///Users/gaojihe/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4173/front/";
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR || "output/playwright/m3-1-browser-backend-smoke";
const chromePath =
  process.env.SMOKE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox"]
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const apiEvents = [];
  trackApiEvents(page, apiEvents);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.evaluate(() => localStorage.clear());

  await loginAndEnterProject(page);
  await clickFeature(page, "spare-planning-experiment-plan-edit");
  await expectSectionTitle(page, "方案编辑");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/projects/") && response.url().includes("/modeling-snapshots") && response.status() === 200),
    page.locator("[data-save-plan]").click()
  ]);

  await clickFeature(page, "spare-planning-monte-carlo-config");
  await expectHeading(page, "蒙特卡洛实验");
  await page.locator('input[data-mc-array-path="monteCarlo.failureRates"]').fill("0.06,0.08,0.1");
  let runResponse = await clickMonteCarloStart(page);
  if (!runResponse) runResponse = await clickMonteCarloStartWithDomFallback(page);
  if (!runResponse) {
    throw new Error(`No successful /api/simulation-runs response. Recent API events: ${JSON.stringify(apiEvents.slice(-20))}. Page text: ${await page.locator("body").innerText()}`);
  }
  await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem("spare-mvp:lastBackendRun") || "null")?.run_id));

  await clickFeature(page, "spare-planning-monte-carlo-results");
  await expectHeading(page, "蒙特卡洛实验结果");
  await page.waitForFunction(() => document.body.innerText.includes("ArtifactManifest"));
  const beforeRefresh = await readBackendEvidence(page);
  assertHasIdentityChain(beforeRefresh.chain, "before refresh");
  if (beforeRefresh.statusText.includes("离线演示") || beforeRefresh.bodyText.includes("offline-demo-run")) {
    throw new Error("Real backend flow was replaced by offline demo fallback before refresh");
  }
  await page.screenshot({ path: `${screenshotDir}/01-real-backend-result.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("已从后端恢复"));
  await page.waitForFunction(() => document.body.innerText.includes("ArtifactManifest"));
  const afterRefresh = await readBackendEvidence(page);
  assertHasIdentityChain(afterRefresh.chain, "after refresh");
  if (afterRefresh.chain.Run !== beforeRefresh.chain.Run) {
    throw new Error(`Refresh loaded a different run: ${afterRefresh.chain.Run} != ${beforeRefresh.chain.Run}`);
  }
  await page.screenshot({ path: `${screenshotDir}/02-refresh-restored-result.png`, fullPage: true });

  const offlinePage = await context.newPage();
  trackApiEvents(offlinePage, apiEvents);
  await offlinePage.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "backend_unavailable", message: "blocked by M3-1 smoke" })
    })
  );
  await offlinePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  await offlinePage.evaluate(() => localStorage.clear());
  await loginAndEnterProject(offlinePage);
  await clickFeature(offlinePage, "spare-planning-monte-carlo-config");
  await expectHeading(offlinePage, "蒙特卡洛实验");
  await offlinePage.locator('button[data-mc-action="start"]').click();
  await offlinePage.waitForTimeout(250);
  await clickFeature(offlinePage, "spare-planning-monte-carlo-results");
  await offlinePage.waitForFunction(() => document.body.innerText.includes("未创建 run_id"));
  const offlineText = await offlinePage.locator("body").innerText();
  if (offlineText.includes("offline-demo-run")) {
    throw new Error("/api unavailable path created a fake offline-demo-run");
  }
  await offlinePage.screenshot({ path: `${screenshotDir}/03-api-unavailable-blocked.png`, fullPage: true });

  const result = {
    ok: true,
    baseUrl,
    screenshots: [
      `${screenshotDir}/01-real-backend-result.png`,
      `${screenshotDir}/02-refresh-restored-result.png`,
      `${screenshotDir}/03-api-unavailable-blocked.png`
    ],
    beforeRefresh,
    afterRefresh,
    offlineBlocked: {
      hasNoFakeRun: !offlineText.includes("offline-demo-run"),
      statusText: firstMatchingLine(offlineText, "未创建 run_id")
    }
  };
  await writeFile(`${screenshotDir}/browser-backend-smoke-result.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

async function loginAndEnterProject(page) {
  await page.getByRole("button", { name: "登录" }).click();
  await expectHeading(page, "项目列表");
  await page.getByRole("button", { name: "进入当前项目" }).click();
  await expectHeading(page, "仿真实验方案管理");
}

async function clickFeature(page, featureId) {
  const clicked = await page.evaluate((id) => {
    const button = document.querySelector(`button[data-feature-id="${id}"]`);
    if (!button) return false;
    for (let node = button.parentElement; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    button.click();
    return true;
  }, featureId);
  if (!clicked) throw new Error(`Cannot find feature button ${featureId}`);
}

async function clickMonteCarloStart(page) {
  const runResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/simulation-runs") && response.status() === 200, { timeout: 3000 }).catch(() => null);
  await page.locator('button[data-mc-action="start"]').click();
  return runResponsePromise;
}

async function clickMonteCarloStartWithDomFallback(page) {
  const runResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/simulation-runs") && response.status() === 200, { timeout: 10000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('button[data-mc-action="start"]')?.click());
  return runResponsePromise;
}

async function expectHeading(page, expected) {
  await page.waitForFunction((heading) => document.querySelector("h2")?.textContent === heading, expected, {
    timeout: 5000
  });
}

async function expectSectionTitle(page, expected) {
  await page.waitForFunction((heading) => document.querySelector("h3")?.textContent === heading, expected, {
    timeout: 5000
  });
}

async function readBackendEvidence(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".backend-run-chain table:first-of-type tr"));
    const chain = Object.fromEntries(rows.map((row) => {
      const cells = row.querySelectorAll("th, td");
      return [cells[0]?.textContent?.trim() || "", cells[1]?.textContent?.trim() || ""];
    }));
    const artifacts = Array.from(document.querySelectorAll(".backend-run-chain table:nth-of-type(2) tr")).map((row) => {
      const cells = row.querySelectorAll("th, td");
      return { kind: cells[0]?.textContent?.trim() || "", path: cells[1]?.textContent?.trim() || "" };
    });
    return {
      statusText: document.querySelector(".backend-run-chain span")?.textContent?.trim() || "",
      chain,
      artifacts,
      bodyText: document.body.innerText
    };
  });
}

function assertHasIdentityChain(chain, label) {
  for (const key of ["Project", "Snapshot", "ExperimentPlan", "Scenario", "Run", "Result", "ArtifactManifest"]) {
    if (!chain[key]) throw new Error(`${label}: missing ${key} in backend identity chain`);
  }
}

function firstMatchingLine(text, needle) {
  return text.split("\n").find((line) => line.includes(needle)) || "";
}

function trackApiEvents(page, events) {
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      events.push({ type: "request", method: request.method(), url: request.url() });
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/")) {
      events.push({ type: "response", status: response.status(), url: response.url() });
    }
  });
}
