import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/front/index.html");
  await page.evaluate(async () => {
    const { createTablePagination, currentPageKeys, updatePageSelection } = await import("/front/table-pagination.mjs");
    document.body.innerHTML = '<main id="pagination-test"></main>';
    window.renderList = (count, context = "project-a", second = false) => {
      const root = document.querySelector("main");
      const table = (id) => `<table data-paginate="${id}"><thead><tr><th><input type="checkbox"></th></tr></thead><tbody>${Array.from({ length: count }, (_, i) => `<tr><td><input type="checkbox" data-row-id="${i}"></td><td>记录 ${i + 1}</td></tr>`).join("")}</tbody></table>`;
      root.innerHTML = table("first") + (second ? table("second") : "");
      window.applyPages ||= createTablePagination();
      window.applyPages(root, context);
    };
    window.selectedKeys = () => currentPageKeys(document.querySelector("thead input"), "data-row-id");
    window.selectPage = (previous, checked) => [...updatePageSelection(previous, window.selectedKeys(), checked)];
    window.renderList(45);
  });
});

test("20 rows per page, last page clamping, full source retained", async ({ page }) => {
  await expect(page.locator("tbody tr:visible")).toHaveCount(20);
  await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator("tbody tr:visible").first()).toContainText("记录 21");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator("tbody tr:visible")).toHaveCount(5);
  await expect(page.locator("tbody tr")).toHaveCount(45);
  await page.evaluate(() => window.renderList(21));
  await expect(page.locator("tbody tr:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await page.evaluate(() => window.renderList(20));
  await expect(page.locator("[data-page-controls]")).toHaveCount(0);
  await expect(page.locator("tbody tr:visible")).toHaveCount(20);
});

test("selection affects current page only and context resets page", async ({ page }) => {
  await page.getByRole("button", { name: "下一页" }).click();
  expect(await page.evaluate(() => window.selectedKeys())).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 20)));
  expect(await page.evaluate(() => window.selectPage(["0"], true))).toHaveLength(21);
  expect(await page.evaluate(() => window.selectPage(["0", "20"], false))).toEqual(["0"]);
  await page.evaluate(() => window.renderList(45, "project-b"));
  await expect(page.locator("tbody tr:visible").first()).toContainText("记录 1");
});

test("phase lists have independent pages; unmarked trees are untouched", async ({ page }) => {
  await page.evaluate(() => {
    window.renderList(45, "phases", true);
    document.querySelector("main").insertAdjacentHTML("beforeend", '<div role="tree"><div role="treeitem">树节点</div></div>');
  });
  await page.getByRole("button", { name: "下一页" }).first().click();
  await expect(page.locator("table").first().locator("tbody tr:visible").first()).toContainText("记录 21");
  await expect(page.locator("table").nth(1).locator("tbody tr:visible").first()).toContainText("记录 1");
  await expect(page.getByRole("treeitem")).toBeVisible();
});
