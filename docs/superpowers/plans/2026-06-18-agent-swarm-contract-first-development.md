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
- Create: `tests/fixtures/smoke_project.json`
- Create: `tests/fixtures/smoke_scenario.json`
- Create: `tests/fixtures/smoke_run.json`
- Create: `tests/fixtures/smoke_result.json`
- Create: `tests/fixtures/smoke_artifact_manifest.json`
- Create: `tests/fixtures/aviation_support_project.json`
- Create: `tests/fixtures/aviation_support_scenario.json`
- Create: `tests/fixtures/aviation_support_run.json`
- Create: `tests/fixtures/aviation_support_result.json`
- Create: `tests/fixtures/aviation_support_artifact_manifest.json`
- Test: `tests/contract-curator.test.mjs`
- Modify: `docs/simulation-service-governance.md`

- [x] **Step 1: Write the failing test**

Run: `node --test tests/contract-curator.test.mjs`

Expected: FAIL because `contracts/` does not exist and governance does not yet list PR-A through PR-G.

- [x] **Step 2: Publish the minimal schema bundle**

Create the five schema files with root-object coverage for current frontend Project JSON, explicit Scenario / Run / Result / ArtifactManifest boundaries, model-family-specific result metrics, and minimum values that do not conflict with Mesa coercion behavior.

- [x] **Step 3: Add minimal fixtures and schema instance checks**

Add separate smoke and aviation support Project -> Scenario -> Run -> Result -> ArtifactManifest fixture chains. Validate those fixtures against the draft schemas in `tests/contract-curator.test.mjs`.

- [x] **Step 4: Run focused verification**

Run: `node --test tests/contract-curator.test.mjs`

Expected: PASS.

### Task 2: Evaluator Drift Tests

**Files:**
- Modify: `tests/contract-curator.test.mjs`
- Create: `tests/contract-drift.test.mjs`

- [x] **Step 1: Add drift checks**

Check that frontend project roots, schema properties, result metrics, and artifact manifest identifiers remain aligned.

- [x] **Step 2: Run evaluator tests**

Run: `npm test`

Expected: PASS.

### Task 3: Simulation Adapter Boundary

**Files:**
- Create: `src/spare_mvp_contract/adapter.py`
- Create: `tests/test_simulation_adapter.py`

- [x] **Step 1: Write validate / compile / run tests**

The adapter must validate a Project JSON fixture, compile a Scenario JSON with `compiled_from`, run Mesa through the governed service boundary, and return an artifact manifest.

- [x] **Step 2: Implement minimal adapter**

Do not modify `src/spare_mvp_abm/` behavior without Claude alignment.

Implemented scope: the first PR-C slice validates Project JSON contract roots,
compiles the approved `smoke` Scenario path, runs `SmokeSpareMvpModel`, and
writes input project, compiled scenario, snapshot, result summary, and artifact
manifest files. `aviation_support` Scenario compilation remains explicitly
blocked until its field derivation rules are approved under Mesa governance.

### Task 4: Database Persistence Slice

**Files:**
- Create: `src/spare_mvp_backend/schema.sql`
- Create: `tests/test_database_contract.py`

- [x] **Step 1: Add migration contract tests**

Check tables for `projects`, `users`, `experiment_plans`, `modeling_snapshots`, `scenarios`, `simulation_runs`, `result_summaries`, and `artifact_manifests`.

- [x] **Step 2: Add schema and repository helpers**

Persist schema versions and artifact manifest identifiers without interpreting Mesa semantics.

Implemented scope: the PR-D slice adds a SQLite `schema.sql` plus repository
helpers that persist Project, Scenario, Run, Result summary, and ArtifactManifest
contract objects. The repository preserves schema versions and run identity
chains; it does not compile Scenario JSON, execute Mesa, or interpret simulation
metrics.

### Task 5: Backend API Slice

**Files:**
- Create: `src/spare_mvp_backend/api.py`
- Create: `tests/test_backend_api_contract.py`

- [x] **Step 1: Add API contract tests**

Cover Project, modeling snapshot, experiment plan, simulation run, and artifact manifest endpoints.

- [x] **Step 2: Implement API orchestration**

Call the Simulation Adapter for Scenario compilation and runs; do not build Scenario JSON inside CRUD handlers.

**Implemented scope:** PR-E added a function-level Backend API facade and contract tests for Project validation/save, modeling snapshots, experiment plans, smoke simulation runs, result summaries, artifact manifests, and `run_id` chain reads. The API layer delegates Scenario compilation and Mesa execution to `SimulationAdapter`, preserves the unsupported `aviation_support` path, and does not change DB schema or Mesa behavior.

### Task 6: Frontend Integration Slice

**Files:**
- Modify: `front/app.js`
- Create: `front/api-client.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add frontend API contract tests**

Assert that save/run/result flows call API client functions instead of directly compiling final Scenario JSON.

- [x] **Step 2: Preserve UX while replacing in-memory persistence**

Project editing remains local until save; run and result views consume backend records and artifacts.

**Implemented scope:** PR-F added `front/api-client.mjs` and routed explicit save, run start, result summary, and artifact reads through the API client. Generic field edits and Monte Carlo sweep edits remain local until the user explicitly saves a plan or starts a run; the frontend does not compile final Scenario JSON.

### Task 7: End-to-End Evaluation

**Files:**
- Create: `tests/e2e-contract-flow.test.mjs`
- Create: `reports/contract-first-smoke/README.md`

- [x] **Step 1: Add end-to-end smoke**

Run modeling snapshot -> save -> compile scenario -> start run -> fetch result summary -> fetch artifact manifest.

- [x] **Step 2: Publish smoke evidence**

Record commands, versions, run IDs, and known limitations without overclaiming calibration quality.

**Implemented scope:** PR-G / M3-0 added a Node `node:test` e2e smoke plus a local standard-library HTTP facade that drives the Python `BackendApi` through Project validation, save, modeling snapshot, experiment plan, smoke Scenario compilation, run start, result fetch, artifact manifest fetch, and run-chain validation. The evidence report records local commands, runtime versions, deterministic scenario-derived run IDs with repository sequence suffixes, artifact kinds, and limitations. This remains a contract-first smoke over `SmokeSpareMvpModel`; it does not claim calibration quality, unblock `aviation_support` Scenario compilation, or change Mesa behavior.
