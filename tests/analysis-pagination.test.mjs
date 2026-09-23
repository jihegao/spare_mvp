import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { aggregateTaskReliabilityWaves, normalizeTaskReliabilityWaveRows } from '../front/task-reliability-contract.mjs';
import { normalizeAnalysisProjectionPayload } from '../front/analysis-projection-adapters.mjs';
import { createPaginationState, renderPagination } from '../front/pagination.mjs';

// Exercise the retained formal-result renderer with its presentation dependencies.
// No Project compilation or result generation is duplicated here.
const source = fs.readFileSync(new URL('../front/app.js', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function renderFormalProjectionBody('), source.indexOf('\nfunction visibleDowntimeAnomalySnapshots'));
function formalView() {
  const pages = createPaginationState();
  const render = new Function('tablePagination', 'renderPagination', 'normalizeTaskReliabilityWaveRows', 'aggregateTaskReliabilityWaves', `
    const htmlEscape = value => String(value ?? '');
    const fixed = value => String(value ?? 0), pct = fixed;
    const analysisPaginationContext = () => 'formal-test';
    const spareAircraftFilter = '', spareShortfallSort = {}, carryAircraftFilter = '', carryHideZeroDemand = false, carryRecommendedSort = 'default';
    const analysisProductsById = () => new Map();
    const sortSpareShortfallRows = rows => rows;
    const analysisProductDisplayName = row => row.productId;
    const renderSpareShortfallSortHeading = label => label;
    const renderBar = () => '';
    const carryUtilizationDisplay = fixed, formatReliabilityPercent = fixed;
    const carryProjectedSatisfactionDisplay = row => fixed(row.projectedSatisfactionRate);
    const carryActualSatisfactionDisplay = row => row.demand === null ? '数据不可用' : fixed(row.satisfactionRate);
    const visibleCarryListRows = result => result.rows || [];
    let missionSampleFilter = '', missionSampleFilterContext = '';
    const filterTaskReliabilityRowsBySample = rows => rows;
    const taskReliabilitySampleIndexes = rows => [...new Set(rows.map(row => row.sampleIndex).filter(Number.isInteger))];
    const visibleDowntimeAnomalySnapshots = result => result.snapshots || [];
    ${source.slice(source.indexOf('function renderLineChart('), source.indexOf('function createAircraftMissionReliabilityState('))}
    ${source.slice(source.indexOf('function taskReliabilityDetailCells('), source.indexOf('function renderLiteMesaDowntimeEventSnapshots('))}
    ${renderer}
    return renderFormalProjectionBody;
  `)(pages, renderPagination, normalizeTaskReliabilityWaveRows, aggregateTaskReliabilityWaves);
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
    assert.doesNotMatch(html, /<td>formal-row-0<\/td>/);
    if (type === 'mission_reliability') assert.equal((html.match(/class="line-chart-x-label"/g) || []).length, 41);
    if (type === 'downtime_factors') assert.match(html, /<td>21<\/td>/);
    pages.move(key, 1);
    html = render(input);
    assert.match(html, /formal-row-40/);
    assert.match(html, new RegExp(`data-pagination-key="${key}" data-pagination-delta="1" disabled`));
    assert.equal(input.snapshots.length, 41);
  }
});

test('formal mission trend counts missing and invalid samples against the projection total', () => {
  for (const invalidRows of [[], [
    { sample_index: 2, day_index: 1, wave_index: 1, mean_mission_success_rate: 'invalid' }
  ]]) {
    const projection = normalizeAnalysisProjectionPayload('mission_reliability', {
      projection_type: 'mission_reliability',
      data: {
        mission_success_probability: 0.5,
        sortie_rate: 1,
        total_samples: 100,
        mission_wave_rows: [
          { sample_index: 0, day_index: 1, wave_index: 1, mean_mission_success_rate: 1 },
          { sample_index: 1, day_index: 1, wave_index: 1, mean_mission_success_rate: 0 },
          ...invalidRows
        ]
      }
    });

    const tooltips = [...formalView().render(projection).matchAll(/<title>(.*?)<\/title>/g)].map((match) => match[1]);
    assert.deepEqual(tooltips, ['第1天第1波次：平均波次成功率 50.00%；有效样本 2 / 总样本 100；排除无效样本 98']);
  }
});

test('not applicable formal results remain renderable without pagination state', () => {
  assert.match(formalView().render({ formal: false }), /不适用/);
});
