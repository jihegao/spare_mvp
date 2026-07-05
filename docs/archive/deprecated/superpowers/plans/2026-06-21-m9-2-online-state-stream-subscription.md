# M9.2 Online State Stream Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal online state stream and run subscription path so the Mesa visualization page can subscribe to a canonical run stream and then switch to the same offline artifact replay parser after completion.

**Architecture:** Keep the existing synchronous local `RunService` boundary. M9.2 exposes a run-scoped SSE stream derived from the already persisted `visualization_state_series` artifact, using the same frame schema as offline replay; it does not introduce a production worker queue or M9.3 run controls. The frontend owns a small subscription state machine around `EventSource`, shows connected/disconnected/unauthorized/failed states, appends streamed frames through the same normalizer path, and loads the final artifact through the existing replay loader.

**Tech Stack:** Python stdlib HTTP server, `BackendApi`, `RunService`, repo-local SQLite repository, browser `EventSource`, vanilla JS tests with `node:test`, Python `unittest`.

---

### Task 1: Backend Run Stream Contract

**Files:**
- Modify: `src/spare_mvp_backend/run_service.py`
- Modify: `src/spare_mvp_backend/api.py`
- Test: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Write the failing API test**

Add a test that submits a smoke run, calls `api.subscribe_run_state_stream(run_id)`, and asserts:
- envelope `stream_id` is `state-stream-{run_id}`
- `run_id` matches
- first event is `run_status` with the canonical status envelope
- subsequent `state_frame` events use `schema_version: visualization-state-frame-v0` and carry `run_id`, `step`, `frame_index`, `frame_count`, and `frame`
- final event is `artifact_ready` and references the `visualization_state_series` artifact id
- unknown run raises `KeyError`

- [ ] **Step 2: Verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_m9_2_subscribe_run_state_stream_reuses_visualization_state_series -v
```

Expected: fail because `subscribe_run_state_stream` is missing.

- [ ] **Step 3: Implement minimal API and service**

Add `BackendApi.subscribe_run_state_stream(run_id)` delegating to `RunService.subscribe_run_state_stream(run_id)`.

Add `RunService.subscribe_run_state_stream(run_id)` that:
- reads the stored run status
- reads the artifact manifest
- finds `kind == "visualization_state_series"`
- loads and validates the JSON file from `output_dir`
- returns an envelope with deterministic event dictionaries:
  - `run_status`
  - one `state_frame` per frame
  - `artifact_ready`
- fails closed when the run is deleted, artifact is missing, file escapes `output_dir`, or payload `run_id` mismatches.

- [ ] **Step 4: Verify GREEN**

Run the same unittest target and confirm it passes.

### Task 2: HTTP SSE Endpoint and Auth Boundaries

**Files:**
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Write failing HTTP/SSE tests**

Add tests around `create_backend_server` request handling that verify:
- `GET /api/runs/{run_id}/state-stream` returns `text/event-stream`
- emitted events include `run_status`, `state_frame`, and `artifact_ready`
- missing `Authorization` returns `401 unauthorized`
- invalid run returns `404 not_found`

- [ ] **Step 2: Verify RED**

Run the targeted tests. Expected: fail because the route is absent.

- [ ] **Step 3: Implement route**

In `http_server.py`, dispatch `GET /api/runs/{run_id}/state-stream` before the generic run detail route. Require a valid session, call `api.subscribe_run_state_stream(run_id)`, and send SSE with:
- `content-type: text/event-stream; charset=utf-8`
- `cache-control: no-cache`
- `access-control-allow-origin: *`
- one `event: <type>` and `data: <json>` block per envelope event

- [ ] **Step 4: Verify GREEN**

Run the targeted HTTP/SSE tests and confirm they pass.

### Task 3: Frontend Subscription State and UI

**Files:**
- Modify: `front/state-series-replay.mjs`
- Modify: `front/app.js`
- Test: `tests/state-series-replay.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Write failing frontend tests**

Add adapter tests for building a partial `visualization_state_series` from streamed `state_frame` events and final `artifact_ready`.

Add contract tests that assert `front/app.js` contains:
- `data-mesa-control="subscribe-run"`
- `EventSource`
- `/api/runs/${...}/state-stream`
- UI copy for connected, disconnected/reconnecting, unauthorized, failed, and artifact-ready handoff states
- play/step/reset controls still show unsupported messages when no offline artifact is loaded

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/state-series-replay.test.mjs tests/frontend-contract.test.mjs
```

Expected: new tests fail because subscription helpers and UI are absent.

- [ ] **Step 3: Implement frontend**

Add a subscription state object with `runId`, `status`, `message`, `eventCount`, and `lastEventAt`.

Add `subscribeVisualizationRunStream()` and `stopVisualizationRunStream()` using `EventSource`; consume:
- `run_status` to show run progress
- `state_frame` to update a partial state-series through the shared adapter
- `artifact_ready` to close the stream and call the existing artifact replay loader for the same run
- `error` to show disconnected/reconnecting or unauthorized/failed state

Render a `订阅运行` button, a `停止订阅` path, and a stream status panel. Keep unsupported pause/step/reset backend controls as explicit UI messages unless an offline artifact is loaded.

- [ ] **Step 4: Verify GREEN**

Run the same node tests and confirm they pass.

### Task 4: Documentation Sync

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Modify: `contracts/README.md`

- [ ] **Step 1: Write or update doc checks**

Extend the existing frontend/doc contract tests to ensure active docs no longer describe M9.2 online state stream as future scope, while still preserving non-goals: production worker queue, object storage, full cancel/retry, M9.3 backend controls, and `aviation_support` formal execution.

- [ ] **Step 2: Verify RED**

Run the relevant doc/frontend contract tests and confirm stale wording fails.

- [ ] **Step 3: Update docs**

Document M9.2 as complete with the minimum SSE contract:
- run-scoped `/api/runs/{run_id}/state-stream`
- same frame schema and parser as offline `visualization_state_series`
- final artifact handoff
- auth, disconnect, failed-run UI states
- explicit non-goals listed above

- [ ] **Step 4: Verify GREEN**

Run the doc/frontend contract tests and confirm they pass.

### Task 5: Final Verification and Review

**Files:**
- No new implementation files unless earlier tasks require them.

- [ ] **Step 1: Run focused verification**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_backend_api_contract -v
node --test tests/state-series-replay.test.mjs tests/frontend-contract.test.mjs tests/contract-curator.test.mjs
```

- [ ] **Step 2: Run subagent spec review**

Ask a reviewer subagent to compare the diff against this plan and M9.2 roadmap acceptance criteria.

- [ ] **Step 3: Run subagent code quality review**

Ask a reviewer subagent to inspect the full diff for correctness, regression risk, and missing tests.

- [ ] **Step 4: Fix review findings and rerun verification**

Do not mark M9.2 complete until focused verification passes and both review passes have no open Critical or Important findings.
