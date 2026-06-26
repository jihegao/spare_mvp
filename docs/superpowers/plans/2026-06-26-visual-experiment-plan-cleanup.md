# Visual Experiment Plan Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make visual simulation runs manageable from `仿真实验方案管理` by listing backend ExperimentPlan records and deleting a plan through associated run tombstones.

**Architecture:** Keep `ExperimentPlan` as the persisted branch identity already created by `RunIntent`. Add backend list/delete plan APIs; deleting a plan soft-deletes associated runs and removes the plan record, but does not physically delete local artifact files. Update the frontend plan list to read backend plans, show run linkage, and call the new delete route.

**Tech Stack:** Python stdlib backend API/SQLite repository, browser-side ES modules, Node `node:test`, Python `unittest`.

---

### Task 1: Backend ExperimentPlan List And Delete

**Files:**
- Modify: `src/spare_mvp_backend/repository.py`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_api_contract.py`
- Test: `tests/test_backend_http_api.py`

- [x] **Step 1: Write failing backend tests**

Add tests proving a project can list ExperimentPlan rows with associated run metadata, and deleting a plan as an admin/data-manager soft-deletes associated runs while removing the plan record.

- [x] **Step 2: Verify backend tests fail**

Run: `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_experiment_plan_list_and_delete_soft_deletes_runs -v`

- [x] **Step 3: Implement repository and API methods**

Add `list_experiment_plans(project_id)`, `delete_experiment_plan_with_runs(project_id, experiment_plan_id, actor_user_id)` and API wrappers with role checks matching M7 lifecycle management.

- [x] **Step 4: Expose HTTP routes**

Add `GET /api/projects/{project_id}/experiment-plans` and `DELETE /api/projects/{project_id}/experiment-plans/{experiment_plan_id}`.

- [x] **Step 5: Verify backend tests pass**

Run targeted backend contract and HTTP tests.

### Task 2: Frontend Plan Management Wiring

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Test: `tests/frontend-api-client.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Write failing frontend tests**

Add API-client coverage for list/delete plan routes and contract assertions that `renderExperimentPlanList` uses backend plan rows, enables delete, and refreshes plans.

- [x] **Step 2: Verify frontend tests fail**

Run: `node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs`

- [x] **Step 3: Implement API client methods**

Add `listExperimentPlans(projectId)` and `deleteExperimentPlan(projectId, experimentPlanId)`.

- [x] **Step 4: Update `front/app.js` state and actions**

Load backend plans for the current project, render them in `方案列表`, and on delete call the backend route; keep local scenario fallback only when backend data is unavailable.

- [x] **Step 5: Verify frontend tests pass**

Run targeted Node tests.

### Task 3: Final Verification And Review

**Files:**
- Review all changed files.

- [x] **Step 1: Run combined targeted verification**

Run backend and frontend targeted tests.

- [x] **Step 2: Run final implementation review**

Review the final diff for contract gaps, permissions, and stale UI behavior. In environments where subagent spawning is not explicitly requested, use the main-agent review plus targeted backend/frontend verification.

- [x] **Step 3: Fix any review findings and re-run targeted tests**

No open findings should remain before completion.
