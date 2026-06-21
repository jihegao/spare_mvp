# Legacy Run API Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the legacy `/api/simulation-runs` HTTP API so canonical `/api/runs` is the only supported run API for frontend, tests, browser smoke, and active docs.

**Architecture:** Use a test-first retirement path instead of deleting routes blindly. Frontend and smoke tests move to canonical `/api/runs`; the backend returns an explicit `410 Gone` retirement envelope for any `/api/simulation-runs*` request during the retirement window, so accidental callers fail loudly with a replacement path. The plan does not change `RunService`, formal run gating, Monte Carlo config ownership, worker queue scope, object storage, cancellation/retry, M8 projection payload rendering, M9 state stream, or `aviation_support` formal execution.

**Tech Stack:** Python standard-library HTTP server and `unittest`, Node.js `node:test`, existing frontend API client in `front/api-client.mjs`, browser smoke script in `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`, active docs in `README.md`, `docs/README.md`, `docs/product-roadmap.md`, and `agent.md`.

---

## File Structure

- Modify: `src/spare_mvp_backend/http_server.py`
  - Remove successful `/api/simulation-runs` route behavior.
  - Add explicit `410 Gone` JSON for any legacy run path.
- Modify: `front/api-client.mjs`
  - Remove `getRun()` legacy raw-run alias.
  - Keep `submitRun()`, `startSimulationRun()`, `startMonteCarloRun()`, `getRunStatus()`, `getRunResult()`, `getRunArtifacts()`, and `getRunChain()` on canonical `/runs`.
- Modify: `tests/test_backend_http_api.py`
  - Migrate HTTP smoke tests to `/runs`.
  - Add retirement tests for `/simulation-runs`, `/simulation-runs/{run_id}`, `/simulation-runs/{run_id}/result`, `/simulation-runs/{run_id}/artifacts`, and `/simulation-runs/{run_id}/chain`.
- Modify: `tests/frontend-api-client.test.mjs`
  - Remove the legacy alias expectation.
  - Add canonical-only route assertions.
- Modify: `tests/frontend-contract.test.mjs`
  - Add a source-level guard that `front/` no longer contains `/simulation-runs`.
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
  - Wait only for canonical `/api/runs` run submission.
- Modify: `reports/m3-1-browser-backend-smoke/README.md`
  - Update smoke evidence text from compatibility to canonical-only.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`
  - Align active documentation with retirement completion once implemented.

Do not edit archived deprecated docs under `docs/archive/deprecated/` unless a test specifically treats them as active current-state documentation.

---

## Task 1: Lock The Retirement Contract

**Files:**
- Modify: `tests/test_backend_http_api.py`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add an HTTP helper that returns error status and payload**

In `tests/test_backend_http_api.py`, add this helper directly after `_json_error()` or replace `_json_error()` call sites only where status matters:

```python
    def _json_error_with_status(
        self,
        base_url: str,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        auth_token: str | None = None,
    ) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"content-type": "application/json"} if payload is not None else {}
        if auth_token is not None:
            headers["authorization"] = f"Bearer {auth_token}"
        req = request.Request(
            f"{base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        opener = request.build_opener(request.ProxyHandler({}))
        try:
            opener.open(req, timeout=10)
        except Exception as exc:
            response = exc
            if not hasattr(response, "read") or not hasattr(response, "code"):
                raise
            return response.code, json.loads(response.read().decode("utf-8"))
        self.fail("request unexpectedly succeeded")
```

- [x] **Step 2: Add failing HTTP retirement tests**

Add this test near the run API tests in `tests/test_backend_http_api.py`:

```python
    def test_http_legacy_simulation_run_routes_are_retired(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                cases = [
                    ("POST", "/simulation-runs", {"project_id": "project", "experiment_plan_id": "plan"}),
                    ("GET", "/simulation-runs/run-retired", None),
                    ("GET", "/simulation-runs/run-retired/result", None),
                    ("GET", "/simulation-runs/run-retired/artifacts", None),
                    ("GET", "/simulation-runs/run-retired/chain", None),
                ]

                for method, path, payload in cases:
                    with self.subTest(method=method, path=path):
                        status, body = self._json_error_with_status(base_url, method, path, payload)
                        self.assertEqual(status, 410)
                        self.assertEqual(body["code"], "legacy_run_api_retired")
                        self.assertIn("/api/runs", body["message"])
                        self.assertEqual(body["details"]["replacement"], "/api/runs")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
```

- [x] **Step 3: Replace the frontend legacy alias test with canonical-only coverage**

In `tests/frontend-api-client.test.mjs`, replace `frontend API client keeps legacy run aliases on canonical run routes` with:

```js
test("frontend API client exposes only canonical run read routes", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs") return { run_id: "run-canonical", status: "succeeded", phase: "completed" };
      if (request.path === "/runs/run-canonical") return { run_id: "run-canonical", phase: "completed" };
      if (request.path === "/runs/run-canonical/result") return { run_id: "run-canonical", summary: {} };
      if (request.path === "/runs/run-canonical/artifacts") return { run_id: "run-canonical", artifacts: [] };
      if (request.path === "/runs/run-canonical/chain") return { run_id: "run-canonical", project_id: "project-ui" };
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const submitted = await client.startSimulationRun("project-ui", "plan-ui");
  const status = await client.getRunStatus(submitted.run_id);
  const result = await client.getRunResult(submitted.run_id);
  const artifacts = await client.getRunArtifacts(submitted.run_id);
  const chain = await client.getRunChain(submitted.run_id);

  assert.equal(status.phase, "completed");
  assert.equal(result.run_id, "run-canonical");
  assert.deepEqual(artifacts.artifacts, []);
  assert.equal(chain.project_id, "project-ui");
  assert.equal(typeof client.getRun, "undefined");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /runs",
    "GET /runs/run-canonical",
    "GET /runs/run-canonical/result",
    "GET /runs/run-canonical/artifacts",
    "GET /runs/run-canonical/chain"
  ]);
});
```

- [x] **Step 4: Add a frontend source-contract guard**

Add this test to `tests/frontend-contract.test.mjs` near the formal run boundary tests:

```js
test("frontend code no longer references legacy simulation run routes", async () => {
  const files = [
    "../front/api-client.mjs",
    "../front/app.js",
    "../front/run-intent.mjs"
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/simulation-runs/);
  }
});
```

- [x] **Step 5: Run tests and verify they fail for the intended reasons**

Run:

```bash
npm test -- tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api.BackendHttpApiTest.test_http_legacy_simulation_run_routes_are_retired -v
```

Expected before implementation:
- Node tests fail because `front/api-client.mjs` still exposes `getRun()` and references `/simulation-runs`.
- Python test fails because `/simulation-runs` still succeeds or returns `404 not_found`, not `410 legacy_run_api_retired`.

- [x] **Step 6: Commit the failing tests**

```bash
git add tests/test_backend_http_api.py tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
git commit -m "test: lock legacy run api retirement contract"
```

---

## Task 2: Remove Frontend Legacy Run API Usage

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Remove `getRun()` from the frontend API client**

In `front/api-client.mjs`, delete this method:

```js
    getRun(runId) {
      return request({ method: "GET", path: `/simulation-runs/${encodeURIComponent(runId)}` });
    },
```

Keep these canonical read methods unchanged:

```js
    getRunStatus(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}` });
    },
    getRunResult(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/result` });
    },
    getRunArtifacts(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/artifacts` });
    },
    getRunChain(runId) {
      return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/chain` });
    }
```

- [x] **Step 2: Verify no frontend source references the retired path**

Run:

```bash
rg -n "/simulation-runs|getRun\\(" front tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected after Step 1:
- No matches under `front/`.
- The only `tests/` matches are in tests that assert the retired route is absent or backend-retired.

- [x] **Step 3: Run frontend route tests**

Run:

```bash
npm test -- tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected after implementation: PASS.

- [x] **Step 4: Commit**

```bash
git add front/api-client.mjs tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
git commit -m "refactor: remove frontend legacy run api alias"
```

---

## Task 3: Retire Backend Legacy Run Routes

**Files:**
- Modify: `src/spare_mvp_backend/http_server.py`
- Modify: `tests/test_backend_http_api.py`

- [x] **Step 1: Add an explicit retired-route exception**

In `src/spare_mvp_backend/http_server.py`, add this small exception class near `MAX_JSON_BODY_BYTES`:

```python
class RetiredRouteError(Exception):
    def __init__(self, route: str, replacement: str) -> None:
        super().__init__(f"{route} is retired; use {replacement}")
        self.route = route
        self.replacement = replacement
```

- [x] **Step 2: Return 410 for retired routes**

In `_handle()`, add this exception branch after `except BackendApiError as exc:` or before `except ValueError as exc:`:

```python
            except RetiredRouteError as exc:
                self._send_json(
                    410,
                    {
                        "code": "legacy_run_api_retired",
                        "message": str(exc),
                        "details": {
                            "route": exc.route,
                            "replacement": exc.replacement,
                        },
                    },
                )
```

- [x] **Step 3: Replace successful `/simulation-runs` dispatch branches with retirement**

In `_dispatch()`, place this branch immediately after the existing line `parts = [unquote(part) for part in route.split("/") if part]` and before canonical `/runs` handling:

```python
            if parts and parts[0] == "simulation-runs":
                raise RetiredRouteError("/api/simulation-runs", "/api/runs")
```

Delete the old successful branches:

```python
            if self.command == "POST" and route == "/simulation-runs":
                if "project_id" not in body or "experiment_plan_id" not in body:
                    raise ValueError("project_id and experiment_plan_id are required")
                return api.start_simulation_run(
                    body["project_id"],
                    body["experiment_plan_id"],
                    body.get("model_family", "smoke"),
                )
            if self.command == "GET" and len(parts) == 2 and parts[0] == "simulation-runs":
                return api.get_run(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "result":
                return api.get_run_result(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "artifacts":
                return api.get_run_artifacts(parts[1])
            if self.command == "GET" and len(parts) == 3 and parts[0] == "simulation-runs" and parts[2] == "chain":
                return api.get_run_chain(parts[1])
```

- [x] **Step 4: Migrate HTTP smoke tests to canonical `/runs`**

In `tests/test_backend_http_api.py`, update `test_http_api_serves_frontend_contract_flow` so run submission and reads use canonical routes:

```python
                run = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "single",
                    },
                )
                status = self._json(base_url, "GET", f"/runs/{run['run_id']}")
                result = self._json(base_url, "GET", f"/runs/{run['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/runs/{run['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{run['run_id']}/chain")

                self.assertTrue(validation["ok"])
                self.assertEqual(snapshot["project_id"], saved["project_id"])
                self.assertEqual(status["run_id"], run["run_id"])
                self.assertEqual(result["run_id"], run["run_id"])
                self.assertEqual(artifacts["run_id"], run["run_id"])
                self.assertEqual(chain["run_id"], run["run_id"])
```

In `test_http_api_exposes_canonical_run_status_routes_and_keeps_legacy_raw_run`, rename the test and remove the raw legacy read:

```python
    def test_http_api_exposes_canonical_run_status_routes(self) -> None:
```

Delete:

```python
                legacy_run = self._json(base_url, "GET", f"/simulation-runs/{submitted['run_id']}")
                self.assertEqual(legacy_run["run_id"], submitted["run_id"])
                self.assertEqual(legacy_run["schema_version"], "run-v0")
                self.assertIn("model_id", legacy_run)
```

- [x] **Step 5: Run backend HTTP tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api -v
```

Expected after implementation: PASS.

- [x] **Step 6: Commit**

```bash
git add src/spare_mvp_backend/http_server.py tests/test_backend_http_api.py
git commit -m "refactor: retire legacy simulation run routes"
```

---

## Task 4: Migrate Browser Smoke And Report Evidence

**Files:**
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- Modify: `reports/m3-1-browser-backend-smoke/README.md`

- [x] **Step 1: Make browser smoke wait only for `/api/runs`**

In `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`, replace the compatibility wait:

```js
(response.url().endsWith("/api/runs") || response.url().endsWith("/api/simulation-runs"))
```

with:

```js
response.url().endsWith("/api/runs")
```

Update the failure text from:

```js
No successful run submit response on /api/runs or /api/simulation-runs.
```

to:

```js
No successful run submit response on /api/runs.
```

- [x] **Step 2: Update smoke report wording**

In `reports/m3-1-browser-backend-smoke/README.md`, replace the compatibility wording with this current-state statement:

```md
M6.0/M6.2 retirement update：浏览器 smoke 只接受 canonical `/api/runs` 作为运行提交入口。旧 `/api/simulation-runs` 已退役，调用者会收到 `410 legacy_run_api_retired`，并应迁移到 `/api/runs` status/result/artifact/chain。
```

- [x] **Step 3: Run report source checks**

Run:

```bash
rg -n "/api/simulation-runs|simulation-runs" reports/m3-1-browser-backend-smoke
```

Expected after implementation:
- No matches in the browser smoke script.
- Any README match must describe the retired `410 legacy_run_api_retired` state, not compatibility acceptance.

- [x] **Step 4: Commit**

```bash
git add reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs reports/m3-1-browser-backend-smoke/README.md
git commit -m "test: require canonical run route in browser smoke"
```

---

## Task 5: Align Active Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Modify: `docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md`

- [x] **Step 1: Link this plan from README and docs index**

In `README.md`, add this line next to the M6.2.x input-source record:

```md
- [`docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md`](docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md)：legacy `/api/simulation-runs` 退场、canonical `/api/runs` 唯一路径和 smoke 测试迁移计划。
```

In `docs/README.md`, add:

```md
| [`superpowers/plans/2026-06-21-legacy-run-api-retirement.md`](superpowers/plans/2026-06-21-legacy-run-api-retirement.md) | legacy `/api/simulation-runs` 退场、canonical `/api/runs` 唯一路径和 smoke 测试迁移计划。 |
```

- [x] **Step 2: Update roadmap after implementation**

After the M6.2.x paragraph in `docs/product-roadmap.md`, add:

```md
M6.2.y 运行 API 退场收束：legacy `/api/simulation-runs` 已从正式和预览测试路径退役；前端 API client、HTTP contract tests 和浏览器 smoke 只使用 canonical `/api/runs` 及其 status/result/artifacts/chain 路径。旧路径返回 `410 legacy_run_api_retired`，用于让外部调用者明确迁移到 `/api/runs`。该切片只清理 run API 兼容层，不实现生产 worker queue、object storage、取消/重试、M8 projection payload 或 M9 state stream。
```

- [x] **Step 3: Update agent operating rules**

In `agent.md`, replace the legacy compatibility rule with:

```md
22. Legacy `/api/simulation-runs` 已退役：新实现、测试、浏览器 smoke 和文档不得把它作为可用入口；运行提交和查询必须走 canonical `/api/runs`、`/api/runs/{run_id}`、`/api/runs/{run_id}/result`、`/api/runs/{run_id}/artifacts` 和 `/api/runs/{run_id}/chain`。旧路径只允许返回 `410 legacy_run_api_retired` 的负向契约。
```

- [x] **Step 4: Run stale-document scans**

Run:

```bash
rg -n "/api/simulation-runs|/simulation-runs|simulation-runs" README.md docs agent.md reports tests front src
```

Expected after implementation:
- No matches in `front/`.
- No active-doc claims that `/api/simulation-runs` is compatible or accepted.
- Matches are allowed only for retired-route tests, retired-route implementation, historical archived docs, or this implementation record.

- [x] **Step 5: Commit**

```bash
git add README.md docs/README.md docs/product-roadmap.md agent.md docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md
git commit -m "docs: document legacy run api retirement"
```

---

## Implementation Note

Completed on 2026-06-21 across commits `3da219ea`, `5b65fca9`, `6134c109`, `53be6942`, and the Task 5 documentation commit. Final behavior: frontend code, HTTP contract tests, and browser smoke use canonical `/api/runs` only; any `/api/simulation-runs*` request returns `410 legacy_run_api_retired` with `/api/runs` as the replacement. This retirement slice did not add worker queue, object storage, cancellation/retry, M8 projection payload rendering, M9 state stream, or `aviation_support` formal execution.

## Final Verification

Run these commands fresh before claiming completion:

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api -v
rg -n "/simulation-runs|getRun\\(" front tests reports README.md docs agent.md src
rg -n '兼容路''径|继续兼''容|lega''cy.*acce''pted|/api/simulation-runs.*保''留' README.md docs agent.md reports
git diff --check
git status --short
```

Completion evidence must show:

1. Frontend code has no `/simulation-runs` route references and no `getRun()` legacy alias.
2. Backend returns `410 legacy_run_api_retired` for all `/api/simulation-runs*` requests.
3. Canonical `/api/runs` status/result/artifacts/chain tests pass.
4. Browser smoke waits only for `/api/runs`.
5. Active docs do not say the legacy path remains a usable API.
6. M7 worker/artifact management, M8 projection payload, M9 state stream, and `aviation_support` formal execution remain out of scope.
