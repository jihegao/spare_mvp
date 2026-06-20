# M6.1.1 Single Simulation Input Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make visual simulation and single-run simulation use the same formal input boundary as later Monte Carlo runs: `ExperimentPlan + ModelingSnapshot -> Scenario compiler -> compiled Scenario -> executor`. Frontend `singleResult` and static Mesa frames remain local preview/fallback only, not formal run results.

**Architecture:** Keep the M6.1 compiler gate and RunService contract. Add a narrow pre-M6.2 slice that proves single-run launches are plan-bound, snapshot-bound, compiler-gated, and provenance-visible before any Monte Carlo fan-out or analysis artifact projection is implemented.

**Tech Stack:** Python stdlib + unittest backend tests, Node.js `node:test` frontend contract tests, existing SQLite repository and local browser frontend.

---

## Scope And File Structure

- Modify: `front/app.js`
  - Make `startExperimentRunThroughApi()` treat backend run status/result/artifact as the only formal single-run result.
  - Keep local demo projection behind explicit preview/fallback wording.
  - Surface compiler diagnostics and provenance from the run chain.
- Modify: `src/spare_mvp_backend/run_service.py`
  - Preserve the single-run compiler gate from `ExperimentPlan + ModelingSnapshot`.
  - Ensure failed compile status includes the plan/snapshot identity and field-level diagnostics.
- Modify: `src/spare_mvp_backend/api.py`
  - Preserve the status/result/artifact/chain envelope used by frontend single-run refresh.
- Modify: `src/spare_mvp_contract/adapter.py`
  - Only if tests reveal provenance gaps for single-run identity; do not broaden the compiler mapping in this slice.
- Modify: `tests/test_backend_api_contract.py`
  - Add regression coverage that single runs are compiled from the selected experiment plan and snapshot.
- Modify: `tests/test_simulation_adapter.py`
  - Add focused provenance assertions only if adapter identity fields need tightening.
- Modify: `tests/frontend-api-client.test.mjs`
  - Assert run status/result/artifact chain details remain inspectable by the frontend.
- Modify: `tests/frontend-contract.test.mjs`
  - Assert the frontend no longer promotes `singleResult` as a formal run output before backend success/provenance.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`, and `AGENT.md`
  - Keep M6.1.1 documented as a required predecessor to M6.2.

Do not implement Monte Carlo fan-out, sample scheduling, analysis task projection, official analysis artifacts, worker queues, cancellation, retry, object storage, or real-time Mesa state streaming. M9 remains the target for full state stream and visualization frame synchronization.

---

## Task 1: Lock The Backend Single-Run Identity Chain

**Files:**
- Modify: `tests/test_backend_api_contract.py`
- Modify only if needed: `src/spare_mvp_backend/run_service.py`
- Modify only if needed: `src/spare_mvp_backend/api.py`

- [ ] **Step 1: Write a failing plan/snapshot source test**

Add a backend contract test that:

1. Saves a project.
2. Creates a modeling snapshot.
3. Creates an experiment plan from that snapshot.
4. Mutates the original project draft after the snapshot is created.
5. Submits a single run for the experiment plan.
6. Asserts the submitted run chain and result came from the experiment plan's snapshot, not the later project draft.

Suggested assertion shape:

```python
self.assertEqual(status["experiment_plan_id"], experiment_plan["experiment_plan_id"])
self.assertEqual(status["modeling_snapshot_id"], snapshot["modeling_snapshot_id"])
self.assertEqual(chain["experiment_plan"]["experiment_plan_id"], experiment_plan["experiment_plan_id"])
self.assertEqual(chain["modeling_snapshot"]["modeling_snapshot_id"], snapshot["modeling_snapshot_id"])
self.assertEqual(result["run_id"], status["run_id"])
```

Run:

```bash
python3 -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_single_run_uses_experiment_plan_snapshot_not_mutated_project_draft -v
```

Expected before implementation: fail if the status/chain does not expose enough identity or if the run can drift to current project draft.

- [ ] **Step 2: Preserve identity in RunService status**

If the test fails because identity is missing, make the smallest change in `RunService` so single-run status includes:

- `run_id`
- `run_type: "single"`
- `experiment_plan_id`
- `modeling_snapshot_id`
- `scenario_id`
- `artifact_manifest_id`
- `result_summary_id`
- compiler provenance under the existing result/artifact/chain boundary

Run the same test again.

Expected: PASS.

- [ ] **Step 3: Verify compile failure keeps the same identity boundary**

Extend the existing blocked compile test so failed single runs still return `experiment_plan_id`, `modeling_snapshot_id`, and `error.details.issues`.

Run:

```bash
python3 -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_fail_closed_when_compiler_gate_blocks_model_family -v
```

Expected: PASS, with no result summary for blocked compile output.

---

## Task 2: Stop Treating Frontend Local Projection As Formal Single-Run Output

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Add a frontend source-contract regression**

Add assertions that `startExperimentRunThroughApi()` does not publish formal results by calling local demo projection before backend run success. The test should allow local preview only when explicitly labeled as preview/fallback.

Suggested contract checks:

```js
assert(!startExperimentRunBody.includes("lastRunResult = singleResult"));
assert(startExperimentRunBody.includes("本地预览，不是正式后端仿真结果"));
assert(startExperimentRunBody.includes("compiler provenance"));
```

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "single run formal result boundary"
```

Expected before implementation: fail if local `singleResult` is still promoted as the formal result path.

- [ ] **Step 2: Split preview state from formal backend state**

In `front/app.js`, keep any immediate local projection in a clearly named preview variable or helper, and only update formal run/result UI from:

- `submitRun()` returned status
- `getRunStatus(run_id)`
- `getResultSummary(result_summary_id)`
- `getArtifactManifest(artifact_manifest_id)`
- run chain compiler provenance

The UI may show local preview while waiting, but the label must be explicit:

```text
本地预览，不是正式后端仿真结果
```

Run the contract test again.

Expected: PASS.

- [ ] **Step 3: Surface compiler diagnostics for visual/single-run launch**

When compile gate status is failed or missing required provenance, show the field-level diagnostics rather than fabricating a local result.

Required user-facing states:

- input not compiled: `输入未通过 Scenario compiler`
- missing provenance: `缺少 compiler provenance`
- local fallback: `本地预览，不是正式后端仿真结果`

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "M6.1"
```

Expected: PASS.

---

## Task 3: Make Visual Simulation Select And Run A Plan-Bound Scenario

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`
- Modify if needed: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Add a contract test for plan selection before visual launch**

Assert that the visual simulation launch path uses the selected experiment plan draft or saved experiment plan identity rather than current modeling page state directly.

The test should inspect the visual launch handler and require these source markers:

- selected scenario/plan lookup
- experiment plan creation or selection
- `createModelingSnapshot()`
- `createExperimentPlan()`
- `submitRun({ run_type: "single" ... })`
- no formal visualization frame without backend run status/provenance

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "visual simulation plan-bound launch"
```

Expected before implementation: fail if visual launch still reads from mutable page state as formal input.

- [ ] **Step 2: Route visual launch through the same single-run helper**

Refactor the visual simulation launch so it reuses the same plan-bound single-run path as `startExperimentRunThroughApi()`:

1. Resolve selected plan.
2. Save project draft only when needed to create a snapshot.
3. Create or load the modeling snapshot.
4. Create or load the experiment plan.
5. Submit a `single` run.
6. Render status/result from backend status/result/artifact only.

Do not add a separate visual-only compiler path.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "visual simulation plan-bound launch"
```

Expected: PASS.

- [ ] **Step 3: Keep static Mesa frame as fallback**

Make the static Mesa aviation support frame visible only as fallback/preview when no backend state stream exists. The UI must not claim it is the formal single-run state stream.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "static Mesa frame fallback"
```

Expected: PASS.

---

## Task 4: Preserve API Client Error And Provenance Details

**Files:**
- Modify if needed: `front/api-client.mjs`
- Modify: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Add client coverage for failed compile status**

Add a Node test that submits a single run through a fake transport returning failed compile status and asserts the caller can inspect:

- `run_id`
- `status: "failed"`
- `experiment_plan_id`
- `modeling_snapshot_id`
- `error.code`
- `error.details.issues`
- `error.details.provenance`

Run:

```bash
node --test tests/frontend-api-client.test.mjs --test-name-pattern "single run compile diagnostics"
```

Expected before implementation: fail only if the client drops or reshapes these fields.

- [ ] **Step 2: Preserve returned status envelopes verbatim**

If the client test fails, adjust `front/api-client.mjs` so `submitRun()` and `getRunStatus()` preserve run status envelopes and error diagnostics without flattening away `details`.

Run the same test again.

Expected: PASS.

---

## Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Modify: `AGENT.md`

- [ ] **Step 1: Sync docs to the implemented boundary**

After implementation, confirm the docs state:

- M6.1.1 is required before M6.2.
- Single simulation and visual simulation consume compiled Scenario input.
- `singleResult` and static Mesa frames are preview/fallback only.
- Monte Carlo fan-out and analysis projection remain M6.2.
- Real state stream remains M9.

Run:

```bash
rg -n "M6\\.1\\.1|singleResult|静态 Mesa|Scenario compiler|M6\\.2|M9" README.md docs/README.md docs/product-roadmap.md agent.md AGENT.md
```

Expected: every hit matches the above boundary.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_backend_api_contract tests.test_simulation_adapter -v
node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full verification gate**

Run:

```bash
npm test
git diff --check
git status --short --branch
```

Expected:

- `npm test`: PASS.
- `git diff --check`: no output.
- `git status --short --branch`: only intended M6.1.1 files are modified.

- [ ] **Step 4: Commit the M6.1.1 slice**

Commit only after all checks pass and the diff contains no M6.2 fan-out or M9 state-stream implementation.

Suggested commit message:

```text
Align single simulation input boundary
```
