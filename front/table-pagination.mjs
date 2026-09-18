export const TABLE_PAGE_SIZE = 20;

export function pageWindow(total, requestedPage = 1) {
  const pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.trunc(requestedPage) || 1));
  return { page, pages, total, start: (page - 1) * TABLE_PAGE_SIZE, end: page * TABLE_PAGE_SIZE };
}

export function updatePageSelection(selected, keys, checked) {
  const next = new Set(selected);
  for (const key of keys) checked ? next.add(key) : next.delete(key);
  return next;
}

export function currentPageKeys(control, attribute) {
  const table = control.closest?.("table[data-paginate]");
  if (!table?.querySelectorAll) return null;
  return [...table.querySelectorAll(`tbody [${attribute}]`)]
    .filter((node) => !node.closest("tr").hidden)
    .map((node) => node.getAttribute(attribute));
}

// Only explicitly annotated flat lists participate; source arrays remain complete
// for exports, compilation and stable row indices.
export function createTablePagination() {
  let previousContext = "";
  const pages = new Map();
  return function apply(root, context) {
    if (!root.querySelectorAll) return;
    if (context !== previousContext) { pages.clear(); previousContext = context; }
    for (const old of root.querySelectorAll("[data-page-controls]")) old.remove();
    for (const [index, container] of [...root.querySelectorAll("[data-paginate]")].entries()) {
      const rows = container.tagName === "TABLE"
        ? [...(container.tBodies[0]?.rows || [])]
        : [...container.children].filter((row) => row.matches(".periodic-profile-item, .lite-mesa-event-snapshot"));
      const key = `${container.dataset.paginate}:${index}`;
      const state = pageWindow(rows.length, pages.get(key));
      pages.set(key, state.page);
      rows.forEach((row, i) => { row.hidden = i < state.start || i >= state.end; });
      const selectAll = container.querySelector("thead input[type=checkbox]");
      if (selectAll) {
        const choices = rows.slice(state.start, state.end).flatMap((row) => [...row.querySelectorAll("td:first-child input[type=checkbox]")]);
        selectAll.checked = choices.length > 0 && choices.every((node) => node.checked);
        selectAll.indeterminate = !selectAll.checked && choices.some((node) => node.checked);
        selectAll.setAttribute("aria-label", "全选当前页");
        selectAll.title = "全选当前页";
      }
      if (rows.length <= TABLE_PAGE_SIZE) continue;
      const nav = container.ownerDocument.createElement("nav");
      nav.dataset.pageControls = key;
      nav.className = "table-pagination";
      nav.setAttribute("aria-label", "列表分页");
      for (const [label, delta] of [["上一页", -1], ["下一页", 1]]) {
        const button = container.ownerDocument.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = delta < 0 ? state.page === 1 : state.page === state.pages;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          pages.set(key, state.page + delta);
          apply(root, context);
          root.querySelector(`[data-page-controls="${key}"] button:not(:disabled)`)?.focus();
        });
        nav.append(button);
        if (delta < 0) {
          const status = container.ownerDocument.createElement("span");
          status.setAttribute("aria-live", "polite");
          status.textContent = `第 ${state.page} / ${state.pages} 页 · 共 ${state.total} 条`;
          nav.append(status);
        }
      }
      container.after(nav);
    }
  };
}
