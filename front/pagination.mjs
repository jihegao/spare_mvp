export const PAGE_SIZE = 20;

export function createPaginationState() {
  const states = new Map();
  return {
    slice(key, rows, context = "") {
      const total = rows.length;
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const previous = states.get(key);
      const page = previous?.context === context ? Math.min(previous.page, pageCount - 1) : 0;
      const state = { context, page, pageCount, total, offset: page * PAGE_SIZE };
      states.set(key, state);
      return { ...state, rows: rows.slice(state.offset, state.offset + PAGE_SIZE) };
    },
    move(key, delta) {
      const state = states.get(key);
      if (state) state.page = Math.max(0, Math.min(state.pageCount - 1, state.page + delta));
    },
    reset() { states.clear(); }
  };
}

export function renderPagination(key, page) {
  if (page.total <= PAGE_SIZE) return "";
  const safeKey = String(key).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<nav class="table-pagination" aria-label="表格分页">
    <button type="button" data-pagination-key="${safeKey}" data-pagination-delta="-1" ${page.page === 0 ? "disabled" : ""}>上一页</button>
    <span>第 ${page.page + 1} / ${page.pageCount} 页 · 共 ${page.total} 条</span>
    <button type="button" data-pagination-key="${safeKey}" data-pagination-delta="1" ${page.page + 1 === page.pageCount ? "disabled" : ""}>下一页</button>
  </nav>`;
}
