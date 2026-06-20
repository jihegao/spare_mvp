# M6.1 Input Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an auditable Project / ExperimentPlan -> Scenario compiler gate so runs fail closed when inputs cannot be compiled, while clearly preventing frontend-local analysis projections from looking like formal backend artifacts.

**Architecture:** Keep M6.1 on existing adapter, RunService, Scenario, Run, and ArtifactManifest payloads. Smoke remains the only executable model family but gains mapping provenance; aviation_support gains a compiler skeleton that returns field-level blocked/unsupported diagnostics without unlocking execution.

**Tech Stack:** Python stdlib + unittest backend tests, SQLite repository payload persistence, browser frontend ES modules with node:test contract tests.

---

## Scope And File Structure

- Modify: `src/spare_mvp_contract/adapter.py`
  - Add compile-gate result helpers and smoke mapping provenance.
  - Keep `compile_scenario()` backward-compatible for existing callers by returning a Scenario on compiled smoke and raising `AdapterError` on blocked/unsupported paths.
  - Add a new explicit gate method such as `compile_scenario_with_gate(project, model_family)` returning `status`, `scenario`, `provenance`, and `issues`.
- Modify: `src/spare_mvp_backend/run_service.py`
  - Call the compile gate before persisting scenarios.
  - For blocked/unsupported compiler output, persist or return a failed status envelope with field-level issues and no result summary.
- Modify: `src/spare_mvp_backend/api.py`
  - Preserve `BackendApiError` mapping for compiler gate diagnostics.
  - Let modeling-import compile preview surface diagnostics without creating a run.
- Modify: `tests/test_simulation_adapter.py`
  - Add tests for smoke provenance, observable input changes, and aviation_support field diagnostics.
- Modify: `tests/test_backend_api_contract.py`
  - Add tests that compiler-gate blocked runs do not call `run_scenario()` and expose field-level errors.
- Modify: `tests/test_backend_http_api.py`
  - Add a canonical `/api/runs` blocked compiler response check if the backend contract returns HTTP error details.
- Modify: `front/app.js`
  - Label/block formal analysis dashboards unless the current backend status has compiler provenance.
- Modify: `front/api-client.mjs`
  - Preserve compile gate error payload details for UI handling.
- Modify: `tests/frontend-api-client.test.mjs` and `tests/frontend-contract.test.mjs`
  - Assert compile-gate error propagation and formal-result blocking/labeling strings.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, and `agent.md`
  - Sync M6.1 implementation wording and keep M6.2 non-goals explicit.

Do not add Monte Carlo fan-out, worker queues, cancellation, retries, production object storage, official analysis artifacts, or new authorization scope.

### Task 1: Backend Compiler Gate And Provenance

**Files:**
- Modify: `src/spare_mvp_contract/adapter.py`
- Test: `tests/test_simulation_adapter.py`

- [x] **Step 1: Write failing smoke provenance test**

Add a test that compiles `smoke_project.json` and asserts:

```python
provenance = scenario["compiled_from"]["mapping_provenance"]
self.assertEqual(provenance["model_family"], "smoke")
self.assertEqual(provenance["mapping_version"], "smoke-input-v0")
self.assertIn("components[].failureRate", provenance["consumed_fields"])
self.assertIn("monteCarlo.failureRates", provenance["ignored_fields"])
```

Run: `python3 -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_compile_smoke_scenario_includes_mapping_provenance -v`
Expected: FAIL because `mapping_provenance` is missing.

- [x] **Step 2: Implement minimal smoke provenance**

In `adapter.py`, attach `compiled_from["mapping_provenance"]` to smoke scenarios. Include at least:

```python
{
    "project_id": project_id,
    "modeling_snapshot_id": None,
    "experiment_plan_id": None,
    "model_family": "smoke",
    "mapping_version": "smoke-input-v0",
    "consumed_fields": [
        "activeModule",
        "monteCarlo.spareMultipliers",
        "components[].failureRate",
        "supportNodes[].equipmentCapacity",
        "equipment.minRequiredSorties",
        "basicMission.minRequiredSorties",
        "experiment.seed",
    ],
    "defaults_applied": [],
    "derived_fields": ["simulation_inputs.failure_rate"],
    "ignored_fields": ["monteCarlo.failureRates", "monteCarlo.supportCapacities"],
    "unsupported_fields": [],
}
```

Run the same test. Expected: PASS.

- [x] **Step 3: Write failing observable-input-change test**

Add a test that changes `components[0].failureRate`, `supportNodes[0].equipmentCapacity`, and `experiment.seed` in separate copies and asserts the compiled `simulation_inputs` values change accordingly.

Run: `python3 -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_smoke_compile_inputs_change_when_consumed_project_fields_change -v`
Expected: FAIL only until implementation preserves the current behavior and test names the exact contract.

- [x] **Step 4: Add compile gate method and aviation_support diagnostics test**

Add a test for `compile_scenario_with_gate(project, model_family="aviation_support")` asserting:

```python
self.assertEqual(result["status"], "unsupported")
self.assertIsNone(result["scenario"])
self.assertEqual(result["provenance"]["model_family"], "aviation_support")
self.assertTrue(result["issues"])
self.assertEqual(
    {"code", "message", "field_path", "page", "severity", "suggestion"},
    set(result["issues"][0]),
)
```

Run: `python3 -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_aviation_support_compile_gate_returns_field_level_diagnostics -v`
Expected: FAIL because the gate method does not exist.

- [x] **Step 5: Implement compile gate**

Add `compile_scenario_with_gate()` to `SimulationAdapter`.
For smoke, return `{"status": "compiled", "scenario": scenario, "provenance": scenario["compiled_from"]["mapping_provenance"], "issues": []}`.
For aviation_support, return `status="unsupported"` with deterministic field-level issues for mission duration, component MTBF, and support activity duration.
Keep `compile_scenario()` raising `AdapterError("unsupported_model_family", ..., issues=issues, provenance=provenance)` for non-smoke callers that still use the old API.

Run: `python3 -m unittest tests.test_simulation_adapter -v`
Expected: PASS.

### Task 2: RunService Fail-Closed Gate

**Files:**
- Modify: `src/spare_mvp_backend/run_service.py`
- Modify: `src/spare_mvp_backend/api.py`
- Test: `tests/test_backend_api_contract.py`
- Optional Test: `tests/test_backend_http_api.py`

- [x] **Step 1: Write failing RunService blocked compile test**

Add a test that saves `aviation_support_project.json`, creates a plan, submits `model_family="aviation_support"`, and asserts:

```python
self.assertEqual(submitted["status"], "failed")
self.assertEqual(submitted["phase"], "failed")
self.assertEqual(submitted["progress"], 0)
self.assertEqual(submitted["error"]["code"], "unsupported_model_family")
self.assertIn("issues", submitted["error"]["details"])
self.assertEqual(failing_or_recording_adapter.run_calls, [])
```

Run: `python3 -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_fail_closed_when_compiler_gate_blocks_model_family -v`
Expected: FAIL because current compile errors raise instead of returning/persisting failed status.

- [x] **Step 2: Implement failed compile status envelope**

In `RunService._submit_run_unlocked()`, call `adapter.compile_scenario_with_gate()` when available. If status is not `compiled`, create a deterministic failed run payload with:

- `result_summary_id: None`
- `artifact_manifest_id: artifact-manifest-<run_id>`
- `error.code`
- `error.message`
- `error.details.issues`
- `error.details.provenance`

Persist a failed run and empty artifact manifest. Do not persist a scenario for blocked compiler output unless a scenario exists.

Run the failing test. Expected: PASS.

- [x] **Step 3: Tighten existing aviation_support tests**

Update old tests that expected exceptions for aviation_support run submission so the canonical run-service path expects a failed status envelope. Keep preview compile paths free to raise/return diagnostics as appropriate.

Run: `python3 -m unittest tests.test_backend_api_contract -v`
Expected: PASS.

- [x] **Step 4: Add HTTP contract for blocked compiler result**

Add or update an HTTP test for `POST /api/runs` with `model_family="aviation_support"`. Assert the response is either a failed status envelope with `error.details.issues` or a structured HTTP error with the same field-level diagnostics. Prefer the failed status envelope if Task 2 Step 2 persisted it.

Run: `python3 -m unittest tests.test_backend_http_api.BackendHttpApiTest.test_http_canonical_runs_return_compile_gate_diagnostics -v`
Expected before implementation: FAIL; after implementation: PASS.

### Task 3: Frontend Formal-Result Boundary

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Test: `tests/frontend-api-client.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Write failing API client error-detail test**

Add a node:test that uses a transport throwing an error with `code="unsupported_model_family"` and `details.issues`. Assert the caller can inspect `error.code`, `error.details.issues[0].field_path`, and `error.payload` for `submitRun()`.

Run: `node --test tests/frontend-api-client.test.mjs --test-name-pattern "compile gate error payload"`
Expected: FAIL only if current client drops details; if it already passes, keep it as regression coverage.

- [x] **Step 2: Write failing frontend source contract test**

Add assertions in `tests/frontend-contract.test.mjs` that `front/app.js` contains M6.1 boundary strings:

- `输入未通过 Scenario compiler`
- `本地预览，不是正式后端仿真结果`
- `缺少 compiler provenance`

Run: `node --test tests/frontend-contract.test.mjs --test-name-pattern "M6.1"`
Expected: FAIL because the strings are missing.

- [x] **Step 3: Implement UI boundary**

In `front/app.js`, add a helper that determines whether formal analysis is unlocked from backend status/provenance. Until M6.2 official artifacts exist, render four analysis dashboards with a visible M6.1 gate note instead of presenting local projections as formal backend results. Keep local preview values available only when explicitly labeled as local preview.

Run the frontend tests from Steps 1-2. Expected: PASS.

### Task 4: Docs Sync And Stale-Wording Guard

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`

- [x] **Step 1: Update docs**

Document that M6.1 now provides:

- smoke mapping provenance for the narrow executable path
- aviation_support compiler skeleton with fail-closed diagnostics
- failed status envelope for blocked run compilation
- frontend formal-result boundary for uncompiled/local projections

Keep explicit non-goals:

- no Monte Carlo fan-out
- no official four-analysis artifact
- no worker queue
- no object storage
- no new auth/audit scope

- [x] **Step 2: Run stale wording search**

Run:

```bash
rg -n "M6\\.1 后续|M6\\.1 建议|aviation_support 编译解锁|真实批量 Monte Carlo|正式分析 artifact|前端局部推导包装" README.md docs agent.md
```

Expected: remaining hits either describe M6.2/non-goals or are updated to the implemented M6.1 state.

### Task 5: Final Verification

**Files:**
- No new production files unless required by Tasks 1-4.

- [x] **Step 1: Run focused backend tests**

Run:

```bash
python3 -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api -v
```

Expected: PASS.

- [x] **Step 2: Run focused frontend tests**

Run:

```bash
node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected: PASS.

- [x] **Step 3: Run full existing validation if time permits**

Run:

```bash
python3 -m unittest
npm test
```

Expected: PASS or documented pre-existing unrelated failures.
