import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/front/index.html");
  await page.evaluate(async () => {
    const { createPaginationState, renderPagination } = await import("/front/pagination.mjs");
    document.body.innerHTML = '<main id="pagination-test"></main>';
    const pages = createPaginationState();
    let current;
    window.renderList = (count, context = "project-a", second = false) => {
      current = [count, context, second];
      window.sourceRows = Array.from({ length: count }, (_, i) => i);
      const root = document.querySelector("main");
      const table = (id) => {
        const view = pages.slice(id, window.sourceRows, context);
        return `<table><thead><tr><th><input type="checkbox"></th></tr></thead><tbody>${view.rows.map((i) => `<tr><td><input type="checkbox" data-row-id="${i}"></td><td>记录 ${i + 1}</td></tr>`).join("")}</tbody></table>${renderPagination(id, view)}`;
      };
      root.innerHTML = table("first") + (second ? table("second") : "") + '<div role="tree"><div role="treeitem">树节点</div></div>';
    };
    document.querySelector("main").addEventListener("click", (event) => {
      const button = event.target.closest("[data-pagination-key]");
      if (!button) return;
      pages.move(button.dataset.paginationKey, Number(button.dataset.paginationDelta));
      window.renderList(...current);
    });
    window.selectedKeys = () => [...document.querySelectorAll("table:first-child tbody [data-row-id]")].map(node => node.dataset.rowId);
    window.selectPage = (previous, checked) => {
      const next = new Set(previous);
      for (const key of window.selectedKeys()) checked ? next.add(key) : next.delete(key);
      return [...next];
    };
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
  expect(await page.evaluate(() => window.sourceRows.length)).toBe(45);
  await page.evaluate(() => window.renderList(21));
  await expect(page.locator("tbody tr:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await page.evaluate(() => window.renderList(20));
  await expect(page.locator("[data-pagination-key]")).toHaveCount(0);
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
  });
  await page.getByRole("button", { name: "下一页" }).first().click();
  await expect(page.locator("table").first().locator("tbody tr:visible").first()).toContainText("记录 21");
  await expect(page.locator("table").nth(1).locator("tbody tr:visible").first()).toContainText("记录 1");
  await expect(page.getByRole("treeitem")).toBeVisible();
});
