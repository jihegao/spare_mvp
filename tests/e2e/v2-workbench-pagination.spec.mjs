import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Seed editor state at the browser boundary; all rendering, delegated events,
// paging, selection, dirty tracking and export handlers are the real app code.
const hooks = `
window.workbenchReview = {
  seed(feature, role = "普通用户") {
    isLoggedIn = true;
    currentUser = { username: "review", role };
    currentProject = { id: "review-project", projectBackendId: "project-review", name: "分页验收" };
    scenario = cloneScenario(defaultScenario);
    selectedRoute = "feature";
    selectedFeatureId = feature;
    projectDraftSaveStatus = "已保存";
    projectDraftHydrateStatus = "";
    savedProject = { project_id: "project-review", project_version: "review-v1" };
    render();
  },
  phases(count) {
    const task = editableBasicMissionRecords()[0].task;
    task.missionPhases = Array.from({ length: count }, (_, i) => ({ name: "验收阶段" + (i + 1), phaseRatio: 1 / count }));
    render();
  },
  selection() { return [...selectedBasicMissionPhaseIndexes]; },
  switchProject() { currentProject = { ...currentProject, id: "review-project-next" }; render(); },
  reliability(count) {
    const rows = Array.from({ length: count }, (_, i) => ({ sampleIndex: Math.floor(i / 26), dayIndex: Math.floor(i % 26 / 2) + 1, waveIndex: i % 2 + 1, plannedWaves: 1, successfulWaves: 1 }));
    liteMesaAnalysisResults.mission_reliability = {
      status: "session_complete", rows, waveRows: rows, sampleCount: 4,
      resultFields: normalizeTaskReliabilityResultFields({ sortie_rate: 1, wave_success_rate: 1, period_completion_probability: 1, period_duration_days: 13 }),
      periodTotalSamples: 4, periodSuccessfulSamples: 4,
      analysisSource: { kind: "current-project", projectName: "分页验收" }
    };
    render();
  }
};`;

test.beforeEach(async ({ page }) => {
  await page.route("**/front/app.js?*", async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(new URL("../../front/app.js", import.meta.url), "utf8") + hooks });
  });
  await page.route("**/api/**", async (route) => {
    await route.fulfill({ json: { valid: true, project_id: "project-review", project_version: "review-v1", projects: [], experiment_plans: [] } });
  });
  await page.goto("/front/index.html");
  await page.waitForFunction(() => window.workbenchReview);
});

test("unified navigation preserves the RBD tab and role-specific administration", async ({ page }) => {
  await page.evaluate(() => window.workbenchReview.seed("spare-planning-equipment-system"));
  await expect(page.locator('[data-feature-id="mission-reliability-reliability-block-diagram"]')).toBeVisible();
  await expect(page.locator(".feature-nav")).not.toContainText("系统运行支持模块");
  await page.evaluate(() => window.workbenchReview.seed("spare-planning-equipment-system", "系统管理员"));
  await expect(page.locator(".feature-nav")).toContainText("系统运行支持模块");
  await expect(page.locator('[data-feature-id="system-management-user-management"]')).toHaveCount(1);
  await page.evaluate(() => window.workbenchReview.seed("spare-planning-equipment-system", "数据管理员"));
  await expect(page.locator('[data-feature-id="system-management-project-data-management"]')).toHaveCount(1);
  await expect(page.locator('[data-feature-id="system-management-user-management"]')).toHaveCount(0);
});

test("mission phases select and delete only the current page and reset on project switch", async ({ page }) => {
  await page.evaluate(() => { window.workbenchReview.seed("spare-planning-basic-mission"); window.workbenchReview.phases(45); });
  const table = page.locator('[data-paginate="mission-phases"]');
  await expect(table.locator("tbody tr:visible")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.locator("tbody tr:visible").first().locator("td").nth(1)).toHaveText("21");
  await page.locator("[data-basic-mission-phase-select-all]").check();
  expect(await page.evaluate(() => window.workbenchReview.selection())).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 20)));
  await page.locator("[data-basic-mission-phase-batch-delete]").click();
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(table.locator("tbody tr:visible")).toHaveCount(5);
  await expect(table.locator("tbody tr:visible").first().locator('input[data-path$=".name"]')).toHaveValue("验收阶段41");
  await page.evaluate(() => window.workbenchReview.switchProject());
  await expect(table.locator("tbody tr:visible")).toHaveCount(20);
  await expect(table.locator("tbody tr:visible").first().locator('input[data-path$=".name"]')).toHaveValue("验收阶段1");
});

test("104 reliability detail rows paginate while Excel exports all 104", async ({ page }) => {
  let exported;
  await page.route("**/api/analysis-results/export-xlsx", async (route) => {
    exported = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "content-disposition": 'attachment; filename="review.xlsx"' }, body: "test download" });
  });
  await page.evaluate(() => { window.workbenchReview.seed("mission-reliability-task-reliability"); window.workbenchReview.reliability(104); });
  const rows = page.locator(".task-reliability-result-table tbody tr");
  await expect(rows).toHaveCount(104);
  await expect(page.locator(".task-reliability-result-table tbody tr:visible")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.locator("[data-analysis-xlsx-export]").click();
  await expect.poll(() => exported?.detail_sections?.[0]?.rows?.length).toBe(104);
  expect(exported.detail_sections[0].rows[0][0]).toBe("样本 1");
  expect(exported.detail_sections[0].rows[103][0]).toBe("样本 4");
});

test("autosave validation failure remains visible and retry saves the same edited value", async ({ page }) => {
  let attempts = 0;
  let saved;
  await page.route("**/api/projects", async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 409, json: { code: "project_version_conflict", message: "项目版本冲突，请重试", details: {} } });
    else { saved = route.request().postDataJSON(); await route.fulfill({ json: { project_id: "project-review", project_version: "review-v2" } }); }
  });
  await page.evaluate(() => { window.workbenchReview.seed("spare-planning-basic-mission"); window.workbenchReview.phases(1); });
  const name = page.locator('[data-path="basicMissions.0.missionPhases.0.name"]');
  await name.fill("等待重试的修改");
  await name.blur();
  await expect(page.getByRole("alert")).toContainText("版本冲突");
  await expect(name).toHaveValue("等待重试的修改");
  await expect(page.locator("[data-project-draft-save]")).toHaveCount(0);
  await page.locator("[data-project-draft-retry]").click();
  await expect.poll(() => saved?.basicMissions?.[0]?.missionPhases?.[0]?.name).toBe("等待重试的修改");
  await expect(page.locator(".project-save-notice")).toHaveCount(0);
});
