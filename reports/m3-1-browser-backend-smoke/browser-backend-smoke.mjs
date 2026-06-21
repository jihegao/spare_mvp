import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "file:///Users/gaojihe/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4173/front/";
const apiBaseUrl = baseUrl.replace(/\/front\/?$/, "/api");
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR || "output/playwright/m3-1-browser-backend-smoke";
const chromePath =
  process.env.SMOKE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const canManageLocalSystem = baseUrl.startsWith("http://127.0.0.1:4173/");
const restartStopCommand = process.env.SMOKE_STOP_COMMAND || (canManageLocalSystem ? "bash scripts/start-system.sh stop" : "");
const restartStartCommand = process.env.SMOKE_START_COMMAND || (canManageLocalSystem ? "bash scripts/start-system.sh start" : "");
const execFileAsync = promisify(execFile);

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
  const projectDraftEvidence = await verifyProjectDraftPersistence(page);

  await clickFeature(page, "system-management-modeling-import-workbench");
  await expectHeading(page, "建模数据导入");
  await page.locator('button[data-modeling-import-action="save-draft"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("草稿已保存"));
  await page.locator('button[data-modeling-import-action="publish"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("已发布"));
  await page.locator('button[data-modeling-import-action="save-draft"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("草稿已保存"));
  await page.screenshot({ path: `${screenshotDir}/00-m5-import-published.png`, fullPage: true });

  await clickFeature(page, "spare-planning-experiment-plan-edit");
  await expectSectionTitle(page, "方案编辑");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/projects/") && response.url().includes("/modeling-snapshots") && response.status() === 200),
    page.locator("[data-save-plan]").click()
  ]);

  await clickFeature(page, "spare-planning-monte-carlo-config");
  await expectHeading(page, "蒙特卡洛实验");
  await openMonteCarloExperimentForRun(page);
  await page.locator('input[data-mc-array-path="monteCarlo.failureRates"]').fill("0.06,0.08,0.1");
  await openMonteCarloExperimentDetailForRun(page);
  let runResponse = await clickMonteCarloStart(page);
  if (!runResponse) runResponse = await clickMonteCarloStartWithDomFallback(page);
  if (!runResponse) {
    throw new Error(`No successful run submit response on /api/runs. Recent API events: ${JSON.stringify(apiEvents.slice(-20))}. Page text: ${await page.locator("body").innerText()}`);
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
  const m7RunArtifactEvidence = await verifyM7RunArtifactManagement(page, afterRefresh.chain.Run);
  if (afterRefresh.chain.Run !== beforeRefresh.chain.Run) {
    throw new Error(`Refresh loaded a different run: ${afterRefresh.chain.Run} != ${beforeRefresh.chain.Run}`);
  }
  await page.screenshot({ path: `${screenshotDir}/02-refresh-restored-result.png`, fullPage: true });

  const restartInfo = await restartBackendServer();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("已从后端恢复"));
  await page.waitForFunction(() => document.body.innerText.includes("ArtifactManifest"));
  const afterRestartRun = await readBackendEvidence(page);
  assertHasIdentityChain(afterRestartRun.chain, "after restart");
  if (afterRestartRun.chain.Run !== beforeRefresh.chain.Run) {
    throw new Error(`Restart loaded a different run: ${afterRestartRun.chain.Run} != ${beforeRefresh.chain.Run}`);
  }

  await clickFeature(page, "system-management-modeling-import-workbench");
  await expectHeading(page, "建模数据导入");
  await page.locator('button[data-modeling-import-action="load-fixture"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("已从后端恢复导入草稿和发布快照"));
  const afterRestartImport = await page.evaluate(() => ({
    statusText: document.querySelector(".modeling-import-action-status")?.textContent?.trim() || "",
    bodyText: document.body.innerText,
    hasDraft: document.body.innerText.includes("draft"),
    hasPublished: document.body.innerText.includes("published")
  }));
  if (!afterRestartImport.hasDraft || !afterRestartImport.hasPublished) {
    throw new Error(`Restart did not restore M5 import draft and published state: ${JSON.stringify(afterRestartImport)}`);
  }
  await page.screenshot({ path: `${screenshotDir}/02b-restart-restored-import.png`, fullPage: true });

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
  await openMonteCarloExperimentForRun(offlinePage);
  await openMonteCarloExperimentDetailForRun(offlinePage);
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
      `${screenshotDir}/00-project-draft-saved.png`,
      `${screenshotDir}/00b-project-draft-restored.png`,
      `${screenshotDir}/00-m5-import-published.png`,
      `${screenshotDir}/01-real-backend-result.png`,
      `${screenshotDir}/02-refresh-restored-result.png`,
      `${screenshotDir}/02b-restart-restored-import.png`,
      `${screenshotDir}/03-api-unavailable-blocked.png`
    ],
    beforeRefresh,
    afterRefresh,
    afterRestartRun,
    afterRestartImport,
    m7RunArtifactEvidence,
    projectDraftEvidence,
    restartInfo,
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
  await page.getByLabel("用户名").fill("data");
  await page.getByLabel("密码").fill("data");
  await page.getByRole("button", { name: "登录" }).click();
  await expectHeading(page, "项目列表");
  const entered = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button[data-enter-workbench][data-project-id]"));
    const activeButton = document.querySelector(".project-card.active button[data-enter-workbench][data-project-id]");
    const button = activeButton || buttons.find((candidate) => !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  });
  if (!entered) {
    throw new Error("Cannot find current/default project entry button: button[data-enter-workbench][data-project-id]");
  }
  await clickFeature(page, "spare-planning-experiment-plan-list");
  await expectHeading(page, "仿真实验方案管理");
}

async function clickFeature(page, featureId) {
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
  if (!clicked) throw new Error(`Cannot find feature button ${featureId}`);
}

async function openMonteCarloExperimentForRun(page) {
  const sweepInput = page.locator('input[data-mc-array-path="monteCarlo.failureRates"]').first();
  if (await sweepInput.isVisible().catch(() => false)) return;

  const editButton = page.locator('button[data-mc-experiment-action="edit"]').first();
  const addButton = page.locator('button[data-mc-experiment-action="add"]').first();
  if (await editButton.isVisible().catch(() => false)) {
    await editButton.click();
  } else if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
  } else {
    throw new Error("Cannot find Monte Carlo experiment add/edit action before filling sweep inputs");
  }

  await sweepInput.waitFor({ state: "visible", timeout: 5000 });
}

async function openMonteCarloExperimentDetailForRun(page) {
  const startButton = page.locator('button[data-mc-action="start"]').first();
  if (await startButton.isVisible().catch(() => false)) return;

  const detailButton = page.locator('button[data-feature-id="spare-planning-monte-carlo-experiment-detail"]').first();
  if (await detailButton.isVisible().catch(() => false)) {
    await detailButton.click();
  } else {
    const listDetailButton = page.locator('button[data-mc-experiment-action="detail"]').first();
    if (!await listDetailButton.isVisible().catch(() => false)) {
      throw new Error("Cannot find Monte Carlo experiment detail action before starting run");
    }
    await listDetailButton.click();
  }

  await startButton.waitFor({ state: "visible", timeout: 5000 });
}

async function clickMonteCarloStart(page) {
  const runResponsePromise = page.waitForResponse(isRunSubmitResponse, { timeout: 3000 }).catch(() => null);
  await page.locator('button[data-mc-action="start"]').click();
  return runResponsePromise;
}

async function clickMonteCarloStartWithDomFallback(page) {
  const runResponsePromise = page.waitForResponse(isRunSubmitResponse, { timeout: 10000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('button[data-mc-action="start"]')?.click());
  return runResponsePromise;
}

function isRunSubmitResponse(response) {
  return (
    response.url().endsWith("/api/runs") &&
    response.request().method() === "POST" &&
    response.status() === 200
  );
}

async function verifyProjectDraftPersistence(page) {
  const draftName = `M5.3 Project draft ${Date.now()}`;
  await clickFeature(page, "spare-planning-equipment-composition");
  await expectHeading(page, "装备系统建模");
  const nameInput = page.locator('input[data-path="components.0.name"]').first();
  await nameInput.fill(draftName);
  await nameInput.dispatchEvent("change");
  const saveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/projects") && response.request().method() === "POST" && response.status() === 200
  );
  await page.locator("[data-project-draft-save]").click();
  await saveResponsePromise;
  await page.waitForFunction(() => document.body.innerText.includes("Project draft 已保存") || document.body.innerText.includes("已保存"));
  await page.screenshot({ path: `${screenshotDir}/00-project-draft-saved.png`, fullPage: true });

  const restartInfo = await restartBackendServer();
  await page.evaluate(() => {
    location.hash = "route=login";
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await loginAndEnterProject(page);
  await clickFeature(page, "spare-planning-equipment-composition");
  await expectHeading(page, "装备系统建模");
  await page.waitForFunction((expectedName) =>
    document.querySelector('input[data-path="components.0.name"]')?.value === expectedName,
    draftName
  );
  const restoredValue = await page.locator('input[data-path="components.0.name"]').first().inputValue();
  if (restoredValue !== draftName) {
    throw new Error(`Project draft did not hydrate after backend restart: ${restoredValue} != ${draftName}`);
  }
  await page.screenshot({ path: `${screenshotDir}/00b-project-draft-restored.png`, fullPage: true });
  return {
    projectDraftName: draftName,
    restoredValue,
    restartInfo
  };
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

async function verifyM7RunArtifactManagement(page, runId) {
  const refreshRunsButton = page.locator('[data-action="m7-refresh-runs"]');
  await refreshRunsButton.click();
  await page.waitForFunction(
    (expectedRunId) => document.querySelector(".m7-run-artifact-management")?.innerText.includes(expectedRunId),
    runId,
    { timeout: 5000 }
  );
  const openRunDetailButton = page.locator(`button[data-action="m7-open-run-detail"][data-run-id="${runId}"]`).first();
  await openRunDetailButton.click();
  await page.waitForFunction(() => {
    const section = document.querySelector(".m7-run-artifact-management");
    if (!section) return false;
    const text = section.innerText;
    return text.includes("artifact_id")
      && text.includes("sha256")
      && text.includes("size_bytes")
      && /[0-9a-f]{64}/.test(text);
  }, null, { timeout: 5000 });
  const detailEvidence = await readM7RunArtifactPanelEvidence(page, runId);
  if (!detailEvidence.runListVisibleIncludesRunId || !detailEvidence.detailVisible) {
    throw new Error(`M7 run list/detail evidence is incomplete: ${JSON.stringify(detailEvidence)}`);
  }
  if (!detailEvidence.artifactColumnsVisible || !detailEvidence.artifactSha25664) {
    throw new Error(`M7 artifact metadata evidence is incomplete: ${JSON.stringify(detailEvidence)}`);
  }
  const artifactButton = page.locator('.m7-run-artifact-management button[data-action="m7-download-artifact"][data-artifact-id]').first();
  const artifactId = await artifactButton.getAttribute("data-artifact-id");
  if (!artifactId) {
    throw new Error("M7 smoke could not find a downloadable artifact_id");
  }
  const downloadEventPromise = page.waitForEvent("download");
  await artifactButton.click();
  const download = await downloadEventPromise;
  if (!download.suggestedFilename().includes(artifactId)) {
    throw new Error(`M7 artifact download filename did not include ${artifactId}: ${download.suggestedFilename()}`);
  }
  const archiveButton = page.locator(`.m7-run-artifact-management button[data-action="m7-archive-run"][data-run-id="${runId}"]`).first();
  await archiveButton.click();
  await page.waitForFunction(() => {
    const text = document.querySelector(".m7-run-artifact-management")?.innerText || "";
    return text.includes("已归档") || text.includes("archived");
  }, null, { timeout: 5000 });
  const archiveEvidence = await readM7RunArtifactPanelEvidence(page, runId);
  if (!archiveEvidence.archiveStateVisible) {
    throw new Error(`M7 archive state is not visible after archive action: ${JSON.stringify(archiveEvidence)}`);
  }

  const deleteButton = page.locator(`.m7-run-artifact-management button[data-action="m7-delete-run"][data-run-id="${runId}"]`).first();
  await deleteButton.click();
  await page.waitForFunction(() => {
    const text = document.querySelector(".m7-run-artifact-management")?.innerText || "";
    return text.includes("tombstone") || text.includes("软删除") || text.includes("deleted");
  }, null, { timeout: 5000 });
  const deleteEvidence = await readM7RunArtifactPanelEvidence(page, runId);
  if (!deleteEvidence.tombstoneVisible || !deleteEvidence.softDeleteBoundaryVisible || deleteEvidence.physicalDeletionImplied) {
    throw new Error(`M7 soft-delete tombstone boundary evidence is incomplete: ${JSON.stringify(deleteEvidence)}`);
  }

  return {
    runId,
    artifactId,
    runListVisibleIncludesRunId: detailEvidence.runListVisibleIncludesRunId,
    detailVisible: detailEvidence.detailVisible,
    artifactColumnsVisible: detailEvidence.artifactColumnsVisible,
    artifactSha25664: detailEvidence.artifactSha25664,
    artifactMetadata: detailEvidence.artifactMetadata,
    downloadObserved: true,
    suggestedFilename: download.suggestedFilename(),
    filenameIncludesArtifactId: download.suggestedFilename().includes(artifactId),
    archiveStateVisible: archiveEvidence.archiveStateVisible,
    archiveStatusText: archiveEvidence.statusText,
    tombstoneVisible: deleteEvidence.tombstoneVisible,
    softDeleteBoundaryVisible: deleteEvidence.softDeleteBoundaryVisible,
    physicalDeletionImplied: deleteEvidence.physicalDeletionImplied,
    deleteStatusText: deleteEvidence.statusText,
    panelText: deleteEvidence.panelText
  };
}

async function readM7RunArtifactPanelEvidence(page, runId) {
  return page.evaluate((expectedRunId) => {
    const panel = document.querySelector(".m7-run-artifact-management");
    const panelText = panel?.innerText || "";
    const tables = Array.from(panel?.querySelectorAll("table") || []);
    const artifactTable = tables.find((table) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => cell.textContent?.trim() || "");
      return headers.includes("artifact_id") && headers.includes("sha256") && headers.includes("size_bytes");
    });
    const artifactRows = Array.from(artifactTable?.querySelectorAll("tbody tr") || []).map((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() || "");
      return {
        artifact_id: cells[0] || "",
        kind: cells[1] || "",
        path: cells[2] || "",
        sha256: cells[3] || "",
        size_bytes: cells[4] || ""
      };
    });
    const artifactMetadata = artifactRows.find((row) => row.artifact_id && row.sha256 && row.size_bytes) || null;
    const physicalDeletionPhrases = ["已物理删除", "文件已删除", "artifact 文件已删除", "本地 artifact 文件已删除"];
    return {
      statusText: panel?.querySelector("span")?.textContent?.trim() || "",
      panelText,
      runListVisibleIncludesRunId: panelText.includes(expectedRunId),
      detailVisible: panelText.includes("artifact_manifest_id") && panelText.includes(expectedRunId),
      artifactColumnsVisible: Boolean(artifactTable),
      artifactSha25664: artifactRows.some((row) => /^[0-9a-f]{64}$/i.test(row.sha256)),
      artifactMetadata,
      archiveStateVisible: panelText.includes("已归档") || panelText.includes("archived"),
      tombstoneVisible: panelText.includes("tombstone") || panelText.includes("软删除") || panelText.includes("deleted"),
      softDeleteBoundaryVisible: panelText.includes("不会被物理删除") || panelText.includes("不表示本地 artifact 文件被物理删除"),
      physicalDeletionImplied: physicalDeletionPhrases.some((phrase) => panelText.includes(phrase))
    };
  }, runId);
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

async function restartBackendServer() {
  if (!restartStopCommand || !restartStartCommand) {
    return { managed: false, reason: "SMOKE_STOP_COMMAND and SMOKE_START_COMMAND were not set" };
  }
  await execFileAsync("/bin/zsh", ["-lc", restartStopCommand], { cwd: process.cwd() });
  await execFileAsync("/bin/zsh", ["-lc", restartStartCommand], { cwd: process.cwd() });
  await waitForApi();
  return { managed: true, stopCommand: restartStopCommand, startCommand: restartStartCommand };
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/projects/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema_version: "project-v0" })
      });
      if (response.status < 500) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not restart before timeout: ${lastError?.message || "no response"}`);
}
