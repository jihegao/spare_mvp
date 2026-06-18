# Agent Swarm Contract-First Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend migration path through contract-first agent slices without letting any worker bypass Mesa governance.

**Architecture:** Start with `contracts/` as the stable schema bundle, then add evaluator tests, Simulation Adapter service boundaries, database persistence, backend API orchestration, frontend API integration, and final end-to-end verification. Mesa model behavior, Scenario compilation semantics, metrics, and artifact structures remain Claude-governed.

**Tech Stack:** Node `node:test` for contract drift checks, JSON Schema draft 2020-12 for versioned contracts, Python/Mesa for simulation behavior, and future backend/database layers that consume these contracts.

---

### Task 1: Contract Curator Schema Bundle

**Files:**
- Create: `contracts/README.md`
- Create: `contracts/README.md.json`
- Create: `contracts/project.schema.json`
- Create: `contracts/scenario.schema.json`
- Create: `contracts/run.schema.json`
- Create: `contracts/result.schema.json`
- Create: `contracts/artifact_manifest.schema.json`
- Create: `tests/fixtures/minimal_project.json`
- Create: `tests/fixtures/minimal_scenario.json`
- Create: `tests/fixtures/minimal_run.json`
- Create: `tests/fixtures/minimal_result_smoke.json`
- Create: `tests/fixtures/minimal_result_aviation_support.json`
- Create: `tests/fixtures/minimal_artifact_manifest.json`
- Test: `tests/contract-curator.test.mjs`
- Modify: `docs/simulation-service-governance.md`

- [x] **Step 1: Write the failing test**

Run: `node --test tests/contract-curator.test.mjs`

Expected: FAIL because `contracts/` does not exist and governance does not yet list PR-A through PR-G.

- [x] **Step 2: Publish the minimal schema bundle**

Create the five schema files with root-object coverage for current frontend Project JSON, explicit Scenario / Run / Result / ArtifactManifest boundaries, model-family-specific result metrics, and minimum values that do not conflict with Mesa coercion behavior.

- [x] **Step 3: Add minimal fixtures and schema instance checks**

Add minimal Project, Scenario, Run, smoke Result, aviation support Result, and ArtifactManifest fixtures. Validate those fixtures against the draft schemas in `tests/contract-curator.test.mjs`.

- [x] **Step 4: Run focused verification**

Run: `node --test tests/contract-curator.test.mjs`

Expected: PASS.

### Task 2: Evaluator Drift Tests

**Files:**
- Modify: `tests/contract-curator.test.mjs`
- Create: `tests/contract-drift.test.mjs`

- [ ] **Step 1: Add drift checks**

Check that frontend project roots, schema properties, result metrics, and artifact manifest identifiers remain aligned.

- [ ] **Step 2: Run evaluator tests**

Run: `npm test`

Expected: PASS.

### Task 3: Simulation Adapter Boundary

**Files:**
- Create: `src/spare_mvp_contract/adapter.py`
- Create: `tests/test_simulation_adapter.py`

- [ ] **Step 1: Write validate / compile / run tests**

The adapter must validate a Project JSON fixture, compile a Scenario JSON with `compiled_from`, run Mesa through the governed service boundary, and return an artifact manifest.

- [ ] **Step 2: Implement minimal adapter**

Do not modify `src/spare_mvp_abm/` behavior without Claude alignment.

### Task 4: Database Persistence Slice

**Files:**
- Create: `src/spare_mvp_backend/schema.sql`
- Create: `tests/test_database_contract.py`

- [ ] **Step 1: Add migration contract tests**

Check tables for `projects`, `users`, `experiment_plans`, `modeling_snapshots`, `scenarios`, `simulation_runs`, `result_summaries`, and `artifact_manifests`.

- [ ] **Step 2: Add schema and repository helpers**

Persist schema versions and artifact manifest identifiers without interpreting Mesa semantics.

### Task 5: Backend API Slice

**Files:**
- Create: `src/spare_mvp_backend/api.py`
- Create: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Add API contract tests**

Cover Project, modeling snapshot, experiment plan, simulation run, and artifact manifest endpoints.

- [ ] **Step 2: Implement API orchestration**

Call the Simulation Adapter for Scenario compilation and runs; do not build Scenario JSON inside CRUD handlers.

### Task 6: Frontend Integration Slice

**Files:**
- Modify: `front/app.js`
- Create: `front/api-client.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Add frontend API contract tests**

Assert that save/run/result flows call API client functions instead of directly compiling final Scenario JSON.

- [ ] **Step 2: Preserve UX while replacing in-memory persistence**

Project editing remains local until save; run and result views consume backend records and artifacts.

### Task 7: End-to-End Evaluation

**Files:**
- Create: `tests/e2e-contract-flow.test.mjs`
- Create: `reports/contract-first-smoke/README.md`

- [ ] **Step 1: Add end-to-end smoke**

Run modeling snapshot -> save -> compile scenario -> start run -> fetch result summary -> fetch artifact manifest.

- [ ] **Step 2: Publish smoke evidence**

Record commands, versions, run IDs, and known limitations without overclaiming calibration quality.
