# M9.3 Run Lifecycle Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal auditable run lifecycle/control plane on canonical `/api/runs` without pretending the current synchronous executor is a production worker.

**Architecture:** Reuse the M7 run management and audit event infrastructure. M9.3 supports backend-confirmed `cancel` and `retry` actions for terminal local runs, while `pause`, `resume`, `step`, and `reset` fail closed with explicit unsupported-control errors. The Mesa visualization page calls the backend control endpoint and updates visible control state only from confirmed API responses.

**Tech Stack:** Python stdlib HTTP server + SQLite repository, `BackendApi`/`RunService`, browser ES modules, Node `node:test`, Python `unittest`/`pytest`.

---

## Scope And Boundaries

M9.3 includes:

- Canonical route: `POST /api/runs/{run_id}/control`.
- Control body: `{ "action": "cancel" | "retry" | "pause" | "resume" | "step" | "reset" }`.
- Audit events: `runs.control.cancel`, `runs.control.retry`, and denied `runs.control.<action>` records.
- Run state updates after backend confirmation only.
- Frontend Mesa controls that show backend-confirmed cancel/retry state and unsupported reasons for pause/resume/step/reset.

M9.3 does not include:

- Production worker queue.
- Object storage.
- True in-flight pause/resume/step/reset.
- Treating local replay index controls as backend controls.
- Unlocking `aviation_support` formal execution.

## Files

- Modify: `src/spare_mvp_backend/repository.py`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `tests/test_backend_http_api.py`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`, `contracts/README.md`

## Task 1: Backend Control Plane

**Files:**

- Modify: `src/spare_mvp_backend/repository.py`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_api_contract.py`
- Test: `tests/test_backend_http_api.py`

- [ ] **Step 1: Write RED backend tests**

Add tests that prove:

1. `BackendApi.control_run(run_id, "cancel", actor_user_id="user-admin")` changes a terminal succeeded run to `status == "cancelled"`, `phase == "cancelled"`, `progress == 1`, records `cancelled_at`/`cancelled_by`, and writes an allowed `runs.control.cancel` audit event.
2. `BackendApi.control_run(run_id, "pause", actor_user_id="user-admin")` raises `BackendApiError` with code `unsupported_run_control`, leaves the run unchanged, and writes a denied `runs.control.pause` audit event.
3. HTTP `POST /api/runs/{run_id}/control` requires a session, rejects a normal user with 403, accepts admin/data roles, and exposes the same audit trail through `/api/audit-events?resource_id={run_id}`.

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run pytest -q -p no:cacheprovider tests/test_backend_api_contract.py::BackendApiContractTest::test_m9_3_run_control_cancel_is_backend_confirmed_and_audited tests/test_backend_api_contract.py::BackendApiContractTest::test_m9_3_unsupported_run_control_fails_closed_and_audits_denial tests/test_backend_http_api.py::BackendHttpApiTest::test_http_m9_3_run_control_requires_admin_and_records_audit
```

Expected before implementation: tests fail because `control_run` and `/control` do not exist.

- [ ] **Step 2: Implement minimal backend**

Add repository helper `control_run_with_audit(run_id, action, actor_user_id)` with these rules:

- `cancel`: allowed from `queued`, `running`, `succeeded`, or `failed`; set `status = "cancelled"`, `phase = "cancelled"`, `progress = 1`, `cancelled_at`, `cancelled_by`, and `control = {action, outcome, actor_user_id, controlled_at}` in the run payload.
- `retry`: allowed from `failed` or `cancelled`; do not create a new run in M9.3. Mark the existing run `status = "queued"`, `phase = "queued"`, `progress = 0`, clear `completed_at`, and add `retried_at`/`retried_by`/`control`. This is a lifecycle reset for the local synchronous boundary, not a worker retry.
- `pause`, `resume`, `step`, `reset`: insert denied audit event and raise `ValueError`/domain error that the API maps to `unsupported_run_control`.
- Deleted runs: fail with `run_deleted`.

Add `BackendApi.control_run()` with M4 role checks for `系统管理员` and `数据管理员`, mapping unsupported action failures to `BackendApiError("unsupported_run_control", ...)`.

Add HTTP route:

```text
POST /api/runs/{run_id}/control
```

Use body field `action`.

- [ ] **Step 3: Run backend GREEN tests**

Run the focused command from Step 1. Expected: PASS.

## Task 2: Frontend Control UI

**Files:**

- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Test: `tests/frontend-api-client.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Write RED frontend tests**

Add tests that prove:

1. `createBackendApiClient().controlRun("run-ui", "cancel")` calls `POST /runs/run-ui/control` with `{ action: "cancel" }`.
2. `renderVisualSimulation` includes M9.3 backend control buttons for cancel/retry and unsupported backend controls for pause/resume/step/reset.
3. `handleMesaControl` calls `backendApi.controlRun` for backend controls and does not use local replay index changes as backend confirmation.

Run:

```bash
node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected before implementation: tests fail because `controlRun` and new controls do not exist.

- [ ] **Step 2: Implement frontend client and UI**

Add API client method:

```js
controlRun(runId, action) {
  return request({
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/control`,
    body: { action }
  });
}
```

In `front/app.js`, add a small M9.3 control status state. Render buttons:

- `取消运行` -> `data-mesa-control="backend-cancel"`
- `重试运行` -> `data-mesa-control="backend-retry"`
- `后端暂停` -> `data-mesa-control="backend-pause"`
- `后端恢复` -> `data-mesa-control="backend-resume"`
- `后端单步` -> `data-mesa-control="backend-step"`
- `后端重置` -> `data-mesa-control="backend-reset"`

Only call `backendApi.controlRun` for these backend-prefixed controls. Keep existing local replay `play`/`step`/`reset` behavior scoped to offline replay.

- [ ] **Step 3: Run frontend GREEN tests**

Run the focused command from Step 1. Expected: PASS.

## Task 3: Documentation Sync

**Files:**

- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Modify: `contracts/README.md`

- [ ] **Step 1: Update active docs**

Document M9.3 as complete only for minimal run lifecycle/control plane:

- `POST /api/runs/{run_id}/control`.
- Backend-confirmed cancel/retry.
- Unsupported pause/resume/step/reset fail closed.
- Audit events for allowed and denied controls.
- Frontend status reflects backend confirmation.

Keep M9.4 `aviation_support` formal execution separate.

- [ ] **Step 2: Scan stale scope language**

Run:

```bash
rg -n "M9\\.3|run lifecycle|后端运行控制|运行控制|aviation_support|worker queue|object storage|cancel|retry|暂停|恢复|单步|重置" README.md docs/README.md docs/product-roadmap.md agent.md contracts/README.md tests front src
```

Expected: M9.3 references say the minimal control plane is complete; no active doc claims production worker/object storage or `aviation_support` formal execution is complete.

## Final Verification

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run pytest -q -p no:cacheprovider tests/test_backend_api_contract.py tests/test_backend_http_api.py tests/test_database_contract.py
node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs tests/state-series-replay.test.mjs tests/contract-curator.test.mjs
```

Do not mark M9.3 complete until focused verification passes, docs are synced, and subagent review has no open Critical or Important findings.
