import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSuiteRows, ANALYSIS_SUITE_TYPES } from '../front/analysis-suite.mjs';

test('suite requires five individually complete batches, never substitutes MC results', () => {
  const response = { analyses: Object.fromEntries(ANALYSIS_SUITE_TYPES.map(([type]) => [type, {status:'session_complete', sample_count:50, failed_sample_count:0}])) };
  assert.equal(analysisSuiteRows(response).every(row => row.complete), true);
  delete response.analyses.carry_list;
  response.analyses.mission_reliability.failed_sample_count = 1;
  response.analyses.downtime_factors.sample_count = 49;
  assert.deepEqual(analysisSuiteRows(response).filter(row => !row.complete).map(row => row.type), ['carry_list', 'mission_reliability', 'downtime_factors']);
});

test('each result is judged independently at 60 seconds inclusive, never by total time', () => {
  const response = { elapsed_seconds: 280, analyses: Object.fromEntries(ANALYSIS_SUITE_TYPES.map(([type]) => [type, {status:'session_complete', sample_count:50, display_elapsed_seconds:56}])) };
  assert.equal(analysisSuiteRows(response).every(row => row.withinTarget), true);
  response.analyses.carry_list.display_elapsed_seconds = 60;
  assert.equal(analysisSuiteRows(response)[2].withinTarget, true);
  response.analyses.carry_list.display_elapsed_seconds = 60.01;
  assert.equal(analysisSuiteRows(response)[2].withinTarget, false);
  delete response.analyses.downtime_factors.display_elapsed_seconds;
  assert.equal(analysisSuiteRows(response)[4].withinTarget, false);
  for (const value of [null, undefined, '', false, -1, Number.NaN]) {
    response.analyses.downtime_factors.display_elapsed_seconds = value;
    assert.equal(analysisSuiteRows(response)[4].elapsed, null);
    assert.equal(analysisSuiteRows(response)[4].withinTarget, false);
  }
});

test('UI runs five separate requests sequentially and paints each before the next request', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../front/app.js', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function runLiteMesaAnalysisSuite() {'), source.indexOf('\nasync function runLiteMesaMonteCarloAnalysis() {'));
  const events = [];
  let now = 0;
  const run = new Function('ANALYSIS_SUITE_TYPES', 'analysisSuiteRows', 'backendApi', 'events', 'performance', 'requestAnimationFrame', `
    let liteMesaAnalysisSuiteState = null, liteMesaMonteCarloRequestEpoch = 0, liteMesaAnalysisRequestEpoch = 0;
    let liteMesaMonteCarloSettings, liteMesaMonteCarloResult, liteMesaMonteCarloStatus, analysisXlsxExportState;
    const liteMesaAnalysisSettings = {}, liteMesaAnalysisResults = {};
    const LITE_MESA_ANALYSIS_DEFINITIONS = Object.fromEntries(ANALYSIS_SUITE_TYPES.slice(1).map(([type])=>[type, {}]));
    const selectedExperimentPlanContextKey = () => 'current';
    const selectedRunContextRequestFingerprint = () => 'unchanged';
    const selectedExperimentPlanContext = () => ({kind:'current-project'});
    const captureAnalysisSourceIdentity = () => ({});
    const selectedExperimentPlanRunSettings = () => ({samples:4,seed:100,parallelCores:8});
    const runContextRequestStillCurrent = () => true;
    const canRunLiteMesaAnalysisSuite = () => true;
    const normalizeMonteCarloParallelCores = value => value;
    const buildBackendRunContext = value => value;
    const normalizeLiteMesaMonteCarloResult = value => ({...value,sampleCount:value.sample_count});
    const liteMesaMonteCarloCompletionStatus = () => 'complete';
    const normalizeLiteMesaAnalysisResult = (_, value) => value;
    const render = () => events.push('render');
    ${implementation}
    return async () => { await runLiteMesaAnalysisSuite(); return {state:liteMesaAnalysisSuiteState, results:liteMesaAnalysisResults}; };
  `)(ANALYSIS_SUITE_TYPES, analysisSuiteRows, {runLiteMesaAnalysis: async (_, type, settings) => {
    events.push({type,settings}); now += 55000;
    return {status:'session_complete',sample_count:50,failed_sample_count:0};
  }}, events, {now:()=>now}, callback => { events.push('frame'); now += 10; callback(); });
  const {state, results} = await run();
  const requests = events.filter(value => typeof value === 'object');
  assert.deepEqual(requests.map(value => value.type), ['mission_reliability','spare_shortfall','carry_list','mission_reliability','downtime_factors']);
  assert.deepEqual(requests.map(value => value.settings.seed), [100,150,200,250,300]);
  assert.equal(requests.every(value => value.settings.samples === 50), true);
  for (let index=1; index<requests.length; index++) {
    const between = events.slice(events.indexOf(requests[index-1])+1, events.indexOf(requests[index]));
    assert.equal(between.filter(value => value === 'frame').length, 2);
    assert.ok(between.includes('render'));
  }
  assert.equal(analysisSuiteRows(state.response).every(row => row.withinTarget), true);
  assert.match(state.message, /5\/5/);
  assert.match(state.message, /275/);
  assert.equal(Object.keys(results).length, 4);
});
