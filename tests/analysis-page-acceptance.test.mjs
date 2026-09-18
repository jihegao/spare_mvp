import test from 'node:test';
import assert from 'node:assert/strict';
import {ANALYSIS_PAGES, validatePageEvidence, validateIndependentRunSet, validateAvailableResponse} from '../scripts/analysis-page-acceptance.mjs';
const expected = {...ANALYSIS_PAGES[0], project_hash:'project', plan_hash:'plan'};
const entry = () => ({http_status:200,status:'session_complete',analysis_type:'mission_reliability',response_analysis_type:'mission_reliability',completed:50,failed:0,response_workers:8,kind:'frozen_plan',response_context_type:'frozen_plan',request_settings_present:false,project_hash:'project',response_project_hash:'project',plan_hash:'plan',response_plan_hash:'plan',plan_fingerprint_hash:'fingerprint',response_plan_fingerprint_hash:'fingerprint',scenario_hash:'scenario',scenario_version_hash:'revision',session_id:'analysis-session-abcd'});
const page = () => ({configured_samples:50,configured_workers:8,context_matches:true,data_rows:20,display_seconds:60,ui_sample_counts:{total:50,successful:50,failed:0}});
test('five original pages have distinct routes and their original buttons', () => {
  assert.equal(new Set(ANALYSIS_PAGES.map(p=>p.route)).size,5);
  assert.equal(ANALYSIS_PAGES[0].button,'[data-lite-mesa-action="run"]');
  assert(ANALYSIS_PAGES.slice(1).every(p=>p.button==='[data-lite-mesa-analysis-action="run"]'));
  assert.deepEqual(ANALYSIS_PAGES.map(p=>p.apiType),['mission_reliability','spare_shortfall','carry_list','mission_reliability','downtime_factors']);
});
test('50 complete / zero failed / 8 workers and inclusive 60-second paint boundary', () => {
  assert.doesNotThrow(()=>validatePageEvidence(entry(),page(),expected));
  for(const display_seconds of [60.001,-1,NaN,Infinity,null,undefined,'60',false]) {
    assert.throws(()=>validatePageEvidence(entry(),{...page(),display_seconds},expected),{safeCode:'PER_ANALYSIS_60_SECOND_TARGET_FAILED'});
  }
  for(const change of [{completed:49},{failed:1},{response_workers:4},{capture_error:'BODY_UNAVAILABLE'},{http_status:500}]) {
    assert.throws(()=>validatePageEvidence({...entry(),...change},page(),expected));
  }
});
test('frozen identity and no request overrides are mandatory', () => {
  for(const change of [{kind:'current_project'},{request_settings_present:true},{response_project_hash:'other'},{response_plan_hash:'other'},{response_plan_fingerprint_hash:'changed'},{session_id:null},{response_analysis_type:'carry_list'}]) {
    assert.throws(()=>validatePageEvidence({...entry(),...change},page(),expected));
  }
  for(const change of [{ui_sample_counts:{total:50,successful:49,failed:1}},{data_rows:0},{context_matches:false},{configured_samples:4},{configured_workers:4}]) {
    assert.throws(()=>validatePageEvidence(entry(),{...page(),...change},expected));
  }
});
test('five real sessions required; cached response or changed frozen input rejected', () => {
  const api=ANALYSIS_PAGES.map((_,i)=>({...entry(),session_id:`analysis-session-${i}`}));
  const pages=ANALYSIS_PAGES.map(page);
  assert.doesNotThrow(()=>validateIndependentRunSet(api,pages));
  assert.throws(()=>validateIndependentRunSet(api.map((a,i)=>({...a,scenario_hash:i?'other':a.scenario_hash})),pages),{safeCode:'COMPILED_SCENARIO_CHANGED'});
  assert.throws(()=>validateIndependentRunSet(api.slice(1),pages));
  assert.throws(()=>validateIndependentRunSet(api.map(a=>({...a,session_id:api[0].session_id})),pages));
  assert.throws(()=>validateIndependentRunSet(api.map((a,i)=>({...a,plan_fingerprint_hash:i?'different':a.plan_fingerprint_hash})),pages));
});

test('failed response stops success-DOM waiting while in-flight capture remains pending', () => {
  assert.doesNotThrow(() => validateAvailableResponse(undefined, 'mission_reliability'));
  assert.doesNotThrow(() => validateAvailableResponse({http_status:200}, 'mission_reliability'));
  assert.doesNotThrow(() => validateAvailableResponse({...entry(), capture_finished:true}, 'mission_reliability'));
  for (const change of [
    {capture_error:'NETWORK_LOADING_FAILED'}, {capture_error:'BODY_UNAVAILABLE'},
    {capture_finished:true, http_status:500}, {capture_finished:true,status:'blocked'},
    {capture_finished:true,completed:49}, {capture_finished:true,failed:1},
    {capture_finished:true,response_analysis_type:'carry_list'}
  ]) assert.throws(() => validateAvailableResponse({...entry(), ...change}, 'mission_reliability'));
});
