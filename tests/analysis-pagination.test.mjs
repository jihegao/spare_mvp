import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeTaskReliabilityWaveRows } from '../front/task-reliability-contract.mjs';
import { createPaginationState, renderPagination } from '../front/pagination.mjs';

// Exercise the retained formal-result renderer with its presentation dependencies.
// No Project compilation or result generation is duplicated here.
const source = fs.readFileSync(new URL('../front/app.js', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function renderFormalProjectionBody('), source.indexOf('\nfunction visibleDowntimeAnomalySnapshots'));
function formalView() {
  const pages = createPaginationState();
  const render = new Function('tablePagination', 'renderPagination', 'normalizeTaskReliabilityWaveRows', `
    const htmlEscape = value => String(value ?? '');
    const fixed = value => String(value ?? 0), pct = fixed;
    const analysisPaginationContext = () => 'formal-test';
    const spareAircraftFilter = '', spareShortfallSort = {}, carryHideZeroDemand = false;
    const analysisProductsById = () => new Map();
    const sortSpareShortfallRows = rows => rows;
    const analysisProductDisplayName = row => row.productId;
    const renderSpareShortfallSortHeading = label => label;
    const renderBar = () => '';
    const carryUtilizationDisplay = fixed, formatReliabilityPercent = fixed;
    const carryProjectedSatisfactionDisplay = row => fixed(row.projectedSatisfactionRate);
    const carryActualSatisfactionDisplay = row => row.demand === null ? '数据不可用' : fixed(row.satisfactionRate);
    const visibleDowntimeAnomalySnapshots = result => result.snapshots || [];
    const renderLiteMesaMissionReliabilityWaveChart = rows => '<chart data-count="' + rows.length + '"></chart>';
    ${source.slice(source.indexOf('function taskReliabilityDetailCells('), source.indexOf('function renderLiteMesaMissionReliabilityWaveChart('))}
    ${renderer}
    return renderFormalProjectionBody;
  `)(pages, renderPagination, normalizeTaskReliabilityWaveRows);
  return { pages, render };
}

test('formal projection tables paginate without changing chart totals or anomaly numbering', () => {
  for (const [type, key] of [
    ['spare_shortfall', 'formal-spare-shortfall'],
    ['carry_list', 'formal-carry-list'],
    ['mission_reliability', 'formal-mission-waves'],
    ['downtime_factors', 'formal-anomaly-snapshots']
  ]) {
    const { pages, render } = formalView();
    const rows = Array.from({ length: 41 }, (_, index) => ({
      productId: `formal-row-${index}`, name: `formal-row-${index}`, waveLabel: `formal-row-${index}`,
      id: `formal-row-${index}`, timeLabel: `formal-row-${index}`
    }));
    const input = { analysisType: type, rows: type === 'downtime_factors' ? [] : rows, snapshots: rows };
    assert.match(render(input), /第 1 \/ 3 页 · 共 41 条/);
    pages.move(key, 1);
    let html = render(input);
    assert.match(html, /formal-row-20/);
    assert.doesNotMatch(html, /formal-row-0(?:<|")/);
    if (type === 'mission_reliability') assert.match(html, /data-count="41"/);
    if (type === 'downtime_factors') assert.match(html, /<td>21<\/td>/);
    pages.move(key, 1);
    html = render(input);
    assert.match(html, /formal-row-40/);
    assert.match(html, new RegExp(`data-pagination-key="${key}" data-pagination-delta="1" disabled`));
    assert.equal(input.snapshots.length, 41);
  }
});

test('not applicable formal results remain renderable without pagination state', () => {
  assert.match(formalView().render({ formal: false }), /不适用/);
});
