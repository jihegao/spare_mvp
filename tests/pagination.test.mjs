import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaginationState, renderPagination } from '../front/pagination.mjs';

test('pagination respects 0/20/21/41 rows and clamps both boundaries', () => {
  for (const count of [0, 20, 21, 41]) {
    const state = createPaginationState();
    const rows = Array.from({ length: count }, (_, i) => i);
    let page = state.slice('rows', rows);
    assert.equal(page.rows.length, Math.min(count, 20));
    assert.equal(Boolean(renderPagination('rows', page)), count > 20);
    state.move('rows', -1);
    assert.equal(state.slice('rows', rows).page, 0);
    state.move('rows', 99);
    page = state.slice('rows', rows);
    assert.equal(page.page, Math.max(0, Math.ceil(count / 20) - 1));
    assert.deepEqual(page.rows, rows.slice(page.offset, page.offset + 20));
    assert.equal(rows.length, count);
  }
});

test('context changes reset pages, deletion clamps and table states stay independent', () => {
  const state = createPaginationState();
  const rows = Array.from({ length: 41 }, (_, i) => i);
  state.slice('a', rows, 'project-a:filter-a');
  state.move('a', 2);
  assert.equal(state.slice('a', rows, 'project-a:filter-a').offset, 40);
  assert.equal(state.slice('b', rows).offset, 0);
  assert.equal(state.slice('a', rows.slice(0, 21), 'project-a:filter-a').page, 1);
  assert.equal(state.slice('a', rows, 'project-b:filter-a').page, 0);
  state.move('a', 1);
  assert.equal(state.slice('a', rows, 'project-b:filter-b').page, 0);
  state.reset();
  assert.equal(state.slice('a', rows, 'project-b:filter-b').page, 0);
});
