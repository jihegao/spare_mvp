# Aircraft Support V1 Only Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire `smoke` and `aviation_support` from active formal and test entrypoints so platform simulation runs use `aircraft_support_v1` only.

**Architecture:** Keep historical source files, archived fixtures, and older plan records available as evidence, but remove their positive runtime role from canonical `/api/runs`, function-level `BackendApi` shortcuts, and active regression tests. Non-`aircraft_support_v1` model families fail closed with a machine-readable retirement error that points callers to `aircraft_support_v1`.

**Tech Stack:** Python standard-library backend, SQLite repository, `unittest`, Node `node:test` frontend contract tests, Markdown docs.

---

### Task 1: Lock the Retirement Contract

**Files:**
- Modify: `tests/test_backend_api_contract.py`
- Modify: `tests/test_backend_http_api.py`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Replace positive `aviation_support` canonical run tests with negative retirement tests**

The active backend API contract must assert that `model_family="aviation_support"` returns `retired_model_family`, persists no run/result/artifact rows, and does not call adapter compile/run methods.

- [x] **Step 2: Replace HTTP positive `aviation_support` run tests with negative retirement tests**

The HTTP layer must return an error envelope with `code: "retired_model_family"`, `replacement_model_family: "aircraft_support_v1"`, and no `run_id`.

- [x] **Step 3: Ensure frontend contract tests continue to require `aircraft_support_v1` as the only formal launch family**

Existing M9.8 frontend tests already assert formal visual/single/Monte Carlo launches use `aircraft_support_v1`; preserve those as the browser-facing guard.

### Task 2: Enforce `aircraft_support_v1` at Formal Runtime Entrypoints

**Files:**
- Modify: `src/spare_mvp_backend/run_service.py`
- Modify: `src/spare_mvp_backend/api.py`

- [x] **Step 1: Add an active model family constant**

Define `ACTIVE_FORMAL_MODEL_FAMILY = "aircraft_support_v1"` in `run_service.py`.

- [x] **Step 2: Reject retired model families before project lookup and compilation**

In `RunService._submit_run_unlocked()`, after parsing `model_family`, raise `RunServiceError("retired_model_family", ...)` for any value other than `aircraft_support_v1`. Include `model_family`, `replacement_model_family`, and `retired_model_families`.

- [x] **Step 3: Default `BackendApi` shortcuts to `aircraft_support_v1`**

Change `compile_modeling_import_scenario()` and `start_simulation_run()` defaults from `smoke` to `aircraft_support_v1`.

### Task 3: Clean Active Docs and Agent Rules

**Files:**
- Modify: `README.md`
- Modify: `agent.md`
- Modify: `docs/product-roadmap.md`

- [x] **Step 1: Reword active product docs**

Replace claims that `aviation_support` remains an unlocked formal path with retired/archived wording. Keep historical M9.4/M9.5 records only as chronology.

- [x] **Step 2: Reword agent runtime rules**

State that canonical run submissions must use `aircraft_support_v1`; `smoke` and `aviation_support` are archived baselines and must not be used for new formal/test entrypoints.

### Task 4: Verify the Retired Entrypoints and Remaining Active Path

**Files:**
- Test-only.

- [x] **Step 1: Run targeted backend API contract tests**

Command: `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract -v`

- [x] **Step 2: Run targeted HTTP tests**

Command: `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api -v`

- [x] **Step 3: Run frontend contract tests that guard formal model family defaults**

Command: `npm test -- tests/frontend-contract.test.mjs`

- [x] **Step 4: Run a stale-positive scan**

Command: `rg -n "model_family[\"': ]+aviation_support|formal aviation|AviationSupportModel.*formal|unlocks? .*aviation_support" README.md agent.md docs tests src`

Remaining matches must either be archived chronology, direct legacy source, or negative retirement tests.
