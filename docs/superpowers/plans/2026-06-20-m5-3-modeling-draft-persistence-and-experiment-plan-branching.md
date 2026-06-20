# M5.3 Modeling Draft Persistence and Experiment Plan Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable Project draft persistence on modeling pages while preserving user-facing `仿真实验方案管理` as the experiment-branch workflow required by `docs/3概要设计方案.md`.

**Architecture:** Project data and experiment plans are distinct product objects. Modeling pages edit the current Project draft and save it through the Project API. `仿真实验方案管理 / 方案列表 / 方案编辑` remains visible under both evaluation modules, and creating an experiment plan copies the current Project data into an editable ExperimentPlan branch. Editing an experiment plan must not mutate the source Project draft. Monte Carlo and visual simulation runs consume a selected ExperimentPlan, then persist run/result/artifact identity through the existing backend chain.

**Tech Stack:** Vanilla JS frontend in `front/app.js`, feature registry in `front/feature-catalog.mjs`, backend API client in `front/api-client.mjs`, Node `node:test`, Python `unittest`, local stdlib HTTP facade with SQLite persistence.

---

## Scope Boundaries

This plan is not part of M4. M4 remains limited to users, sessions, authorization, and audit events. M5.3 may use authenticated backend paths added by M4, but it must not expand M4's PR scope.

This plan must not delete visible `仿真实验方案管理` navigation, `方案列表`, or `方案编辑`. Those pages are in the source概要设计 and remain part of the product contract. Backend `experiment_plans`, `createExperimentPlan()`, and run identity-chain persistence also remain required.

M5.3 may improve the project save path, remove misleading wording, and replace temporary in-memory-only behavior. It must preserve the product distinction from `docs/3概要设计方案.md`: Project data is the reusable base; ExperimentPlan is a copied branch that users may edit before a simulation without changing Project data.

The 2026-06-19 page review is handled by `docs/superpowers/plans/2026-06-20-page-suggestion-alignment.md`. It may change project-list and system-management entry points, but it must not collapse Project draft, ModelingSnapshot, and ExperimentPlan branch boundaries. In particular, the retained `建模数据导入` workbench remains an M5.2/M5 data-entry surface, while M5.3 continues to own Project draft persistence and ExperimentPlan branching.

---

## Source Contract

- `docs/3概要设计方案.md` lists `仿真实验 / 仿真实验方案管理 / 仿真实验方案创建` and `仿真实验方案编辑` for both 备件规划评估模块 and 任务可靠度评估模块.
- The design text says users can create experiment assumptions and edit entity attributes, initial conditions, and mission goals.
- The data-permission section defines `实验方案`: when a user runs a simulation, the system copies all selected Project data into an experiment plan; users can modify that plan before running; changes do not affect Project data; one Project can produce multiple plan branches; one ExperimentPlan can be saved as another plan.

---

## File Structure

- Modify: `front/app.js`
  - Add Project draft hydrate/save status on modeling pages.
  - Keep `renderExperimentPlanList()` and `renderExperimentPlanEditor()` visible.
  - Ensure experiment-plan edit state is isolated from the Project draft.
  - Ensure Monte Carlo/visual simulation launch uses the selected ExperimentPlan.
- Modify: `front/feature-catalog.mjs`
  - Preserve `仿真实验方案管理` rows for both modules.
  - Preserve legacy experiment-plan route aliases to the plan editor/list, not Monte Carlo config.
- Modify: `front/api-client.mjs`
  - Keep existing Project and ExperimentPlan methods.
  - Add helpers only if `front/app.js` needs clearer Project-draft or ExperimentPlan-branch calls.
- Modify: `front/ontology-context.mjs`
  - Keep `experiment-plan-list` and `experiment-plan-editor` mapped as visible experiment concepts.
- Modify: `tests/frontend-contract.test.mjs`
  - Keep assertions that require `仿真实验方案管理 -> 方案列表 / 方案编辑`.
  - Add assertions for Project draft controls and plan-branch isolation.
- Modify: `tests/frontend-api-client.test.mjs`
  - Cover Project draft save/hydrate through `saveProject()` and `getProject()`.
  - Preserve API boundary coverage for `createExperimentPlan()`.
- Modify: `tests/test_backend_api_contract.py`
  - Cover ExperimentPlan creation from Project snapshots and no source-Project mutation.
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
  - Save from a modeling page and verify restart hydration from persisted Project draft.
  - Visit `仿真实验方案管理` and verify plan creation/edit remains available.
- Modify: `reports/m3-1-browser-backend-smoke/README.md`
  - Record both Project draft persistence and experiment-plan branch verification.
- Modify: `docs/README.md`
  - Describe Project draft persistence plus preserved experiment-plan management.
- Modify: `docs/product-roadmap.md`
  - Add M5.3 as Project draft persistence and ExperimentPlan branching.
- Modify: `docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`
  - Add a note that M5.3 keeps `仿真实验方案管理` visible because it is source-design scope.

---

### Task 1: Lock the Product Contract in Frontend Tests

**Files:**
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Preserve registry assertions**

Keep or add assertions that both modules expose:

```js
assert.deepEqual(grouped["备件规划评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
assert.deepEqual(grouped["任务可靠度评估模块"]["仿真实验"]["仿真实验方案管理"].map((page) => page.name), ["方案列表", "方案编辑"]);
```

- [ ] **Step 2: Preserve route alias assertions**

Legacy create/edit routes should still resolve to plan-management pages:

```js
assert.equal(getFeaturePageById("spare-planning-experiment-create").name, "方案编辑");
assert.equal(getFeaturePageById("spare-planning-experiment-edit").name, "方案编辑");
assert.equal(getFeaturePageById("mission-reliability-experiment-create").name, "方案编辑");
assert.equal(getFeaturePageById("mission-reliability-experiment-edit").name, "方案编辑");
```

- [ ] **Step 3: Add anti-regression source assertions**

Add a test that prevents accidental removal:

```js
test("experiment plan management remains visible because it is source design scope", async () => {
  const catalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(catalogSource, /仿真实验方案管理/);
  assert.match(catalogSource, /experiment-plan-list/);
  assert.match(catalogSource, /experiment-plan-editor/);
  assert.match(appSource, /function renderExperimentPlanList/);
  assert.match(appSource, /function renderExperimentPlanEditor/);
});
```

- [ ] **Step 4: Add Project draft control assertions**

Add a separate test for the new modeling draft controls:

```js
test("modeling pages expose project draft persistence without replacing experiment plans", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /data-project-draft-save/);
  assert.match(appSource, /function saveCurrentProjectDraftThroughApi/);
  assert.match(appSource, /function hydrateCurrentProjectDraftFromApi/);
  assert.match(appSource, /projectDraftSaveStatus/);
  assert.match(appSource, /data-save-plan/);
});
```

- [ ] **Step 5: Run test to verify it fails only for new Project draft controls**

Run:

```bash
node --test tests/frontend-contract.test.mjs
```

Expected: existing experiment-plan-management assertions pass; new Project draft assertions fail until the draft controls are implemented.

---

### Task 2: Add Project Draft Persistence to Modeling Pages

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Add failing API-client source test**

In `tests/frontend-api-client.test.mjs`, add:

```js
test("app hydrates and saves current project draft through project API", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /const PROJECT_DRAFT_AUTOSAVE_DELAY_MS = 800/);
  assert.match(appSource, /function currentBackendProjectId/);
  assert.match(appSource, /async function hydrateCurrentProjectDraftFromApi/);
  assert.match(appSource, /async function saveCurrentProjectDraftThroughApi/);
  assert.match(appSource, /backendApi\.getProject\(currentBackendProjectId\(\)\)/);
  assert.match(appSource, /backendApi\.saveProject\(projectJson\)/);
});
```

- [ ] **Step 2: Add Project draft state and helpers**

Add Project draft state near existing backend state variables:

```js
const PROJECT_DRAFT_AUTOSAVE_DELAY_MS = 800;
let projectDraftSaveStatus = "未保存";
let projectDraftHydrateStatus = "";
let projectDraftAutosaveTimer = null;
let projectDraftLastSavedAt = "";
```

Add:

```js
function currentBackendProjectId() {
  return currentProject.id ? `project-${currentProject.id}` : `project-${scenario.scenarioId}`;
}
```

- [ ] **Step 3: Hydrate and save Project draft**

Add `hydrateCurrentProjectDraftFromApi()` and `saveCurrentProjectDraftThroughApi()`. These functions read/write Project JSON only. They must not create or overwrite ExperimentPlan branches.

- [ ] **Step 4: Add modeling draft toolbar**

Render a compact Project draft toolbar on modeling pages with a manual `data-project-draft-save` button and save/hydration status.

- [ ] **Step 5: Route modeling field edits to Project draft status**

When a modeling page field changes, mark Project draft status as changed and schedule Project draft save if autosave is enabled. Do not call experiment-plan save handlers for generic modeling edits.

- [ ] **Step 6: Run frontend API tests**

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: PASS.

---

### Task 3: Preserve ExperimentPlan Branch Semantics

**Files:**
- Modify: `front/app.js`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Add backend branch-isolation test**

Add a test that:
1. Saves a Project.
2. Creates an ExperimentPlan from that Project or its modeling snapshot.
3. Mutates the ExperimentPlan payload.
4. Reads the source Project again.
5. Verifies the Project payload is unchanged.

- [ ] **Step 2: Add frontend source tests for branch behavior**

Assert that:
- `renderExperimentPlanList()` remains available.
- `renderExperimentPlanEditor()` remains available.
- `data-save-plan` remains the explicit ExperimentPlan save action.
- generic Project modeling edits use Project draft save, not `data-save-plan`.

- [ ] **Step 3: Ensure create/edit copy semantics**

When the user creates a plan from the current Project, copy the Project payload into an ExperimentPlan draft. Edits inside `方案编辑` mutate only that ExperimentPlan draft until saved as a plan.

- [ ] **Step 4: Run focused backend/frontend tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
node --test tests/frontend-contract.test.mjs
```

Expected: PASS.

---

### Task 4: Keep Monte Carlo and Visual Runs Plan-Driven

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Assert selected ExperimentPlan drives run launch**

Add source tests that Monte Carlo launch uses the current selected ExperimentPlan or creates an ExperimentPlan from the current Project only as an explicit launch-time branch. Do not route launches around `仿真实验方案管理`.

- [ ] **Step 2: Preserve launch return behavior**

After Monte Carlo launch, returning to `方案列表` and marking the relevant plan as `运行中` is acceptable and matches the current UI contract. If later product review wants a results-first route, that should be a separate decision, not a side effect of Project draft persistence.

- [ ] **Step 3: Run frontend contract tests**

Run:

```bash
node --test tests/frontend-contract.test.mjs
```

Expected: PASS.

---

### Task 5: Update Browser Smoke for Both Persistence Paths

**Files:**
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- Modify: `reports/m3-1-browser-backend-smoke/README.md`

- [ ] **Step 1: Add Project draft save/restart hydration check**

In the smoke script, visit a modeling page, change a field, save Project draft, restart the backend, and verify the field is restored from persistent SQLite.

- [ ] **Step 2: Keep ExperimentPlan management check**

The smoke must still visit `仿真实验方案管理`, open `方案列表`, open or create a `方案编辑` page, and verify plan save/launch affordances are present.

- [ ] **Step 3: Record evidence wording**

The report should state that M5.3 verifies two separate persistence surfaces:
- Project draft persistence for modeling data.
- ExperimentPlan branch persistence for simulation assumptions and run identity.

- [ ] **Step 4: Run smoke script against local system service**

Run:

```bash
npm run start:system
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: PASS.

---

### Task 6: Sync Product Docs

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`

- [ ] **Step 1: Update docs README current state**

State:

```markdown
建模页保存当前 Project draft；`仿真实验方案管理` 仍保留为概要设计要求的实验方案分支工作流。用户可从项目数据创建多个实验方案，编辑方案不回写项目数据，仿真运行和 Monte Carlo 使用选中的实验方案生成 run identity chain。
```

- [ ] **Step 2: Add roadmap M5.3 entry**

In `docs/product-roadmap.md`, add:

```markdown
### M5.3 建模草稿持久化与实验方案分支

目标：把建模页的项目数据保存为后端 Project draft，同时保留概要设计中的 `仿真实验方案管理`。ExperimentPlan 是从 Project 复制出的可编辑仿真分支，编辑方案不影响项目数据；运行仿真和 Monte Carlo 时使用选中的方案保留可复现 run identity chain。
```

- [ ] **Step 3: Add source-design guard to the four-level spec**

At the top of `docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`, add:

```markdown
> M5.3 update: `仿真实验方案管理 / 方案列表 / 方案编辑` remains visible because it is source-design scope in `docs/3概要设计方案.md`. Project draft persistence complements it; it does not replace experiment-plan branching.
```

- [ ] **Step 4: Scan for stale retirement wording**

Run:

```bash
rg -n "退场|retire|retired|remove visible|删除.*仿真实验方案管理|仿真实验方案管理.*删除" docs reports front tests
```

Expected: no active docs or implementation plans say that visible experiment-plan-management pages are removed. Historical reports may remain unchanged if clearly historical.

---

### Task 7: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected: all Node tests pass.

- [ ] **Step 2: Run backend tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
```

Expected: all selected Python tests pass.

- [ ] **Step 3: Run browser smoke**

Run:

```bash
npm run start:system
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: browser smoke passes, saved modeling field survives backend restart, and `仿真实验方案管理` remains reachable.

- [ ] **Step 4: Inspect diff for M4 scope leakage**

Run:

```bash
git diff --stat HEAD~8..HEAD
git diff HEAD~8..HEAD -- src/spare_mvp_backend docs/superpowers/plans/2026-06-20-m5-3-modeling-draft-persistence-and-experiment-plan-branching.md
```

Expected: backend auth/session/audit semantics are unchanged. M5.3 uses existing M4-protected paths but does not add M4 responsibilities.

---

## Self-Review Notes

- The plan preserves M4 scope by treating M5.3 as a separate product/navigation/persistence slice.
- The plan keeps visible `仿真实验方案管理` because it is explicitly present in the source概要设计.
- Project draft persistence and ExperimentPlan branching are complementary, not replacements.
- The browser smoke should verify both concrete surfaces: Project draft survives backend restart, and ExperimentPlan list/editor remain usable.
- The plan intentionally avoids broad Excel/import UI expansion; `modeling-import-v1` remains a separate M5.1/M5.2 concern.
