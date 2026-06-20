# M6.0 Run Service Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the M6.0 run service boundary so frontend run launch goes through canonical run submission/status APIs while the current smoke runner remains the synchronous local executor.

**Architecture:** Create a focused `RunService` that owns run request validation, ExperimentPlan snapshot resolution, Scenario compilation, local synchronous execution, persistence, and status envelope formatting. `BackendApi` delegates run orchestration to the service, HTTP exposes `/api/runs` as the canonical status-envelope path while preserving `/api/simulation-runs` path compatibility, and the frontend polls run status before loading result/artifacts/chain. M6.0 compiles from the ExperimentPlan-bound ModelingSnapshot plus supported plan config fields (`steps` only); it deliberately stops before full ExperimentPlan payload compilation, worker queues, cancellation, retries, true Monte Carlo fan-out, long-term artifact storage, or `aviation_support` compilation.

**Tech Stack:** Python `unittest`, standard-library HTTP server, SQLite repository, `SimulationAdapter`, browser-native ES modules, Node `node:test`, Playwright browser smoke.

---

## File Structure

- Create: `src/spare_mvp_backend/run_service.py`
  - Owns `RunService`, request normalization, status envelope formatting, and the synchronous local execution path.
- Modify: `src/spare_mvp_backend/api.py`
  - Instantiates `RunService`, delegates `start_simulation_run()`, and exposes `submit_run()` / `get_run_status()` helpers.
- Modify: `src/spare_mvp_backend/http_server.py`
  - Adds canonical `/api/runs` routes and keeps `/api/simulation-runs` aliases.
- Modify: `front/api-client.mjs`
  - Adds `submitRun()` and `getRunStatus()`, keeps `startSimulationRun()` as a compatibility alias.
- Modify: `front/app.js`
  - Uses run status polling before loading result/artifacts/chain and keeps ExperimentPlan as the launch source.
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
  - Waits for canonical `/api/runs` and status refresh.
- Modify: `reports/m3-1-browser-backend-smoke/README.md`
  - Records M6.0 run-status evidence.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`
  - Links M6.0 docs and states the first-slice boundary.
- Test: `tests/test_backend_api_contract.py`
- Test: `tests/test_backend_http_api.py`
- Test: `tests/frontend-api-client.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

### Task 1: Backend RunService Boundary

**Files:**
- Create: `src/spare_mvp_backend/run_service.py`
- Modify: `src/spare_mvp_backend/api.py`
- Test: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Add failing RunService API tests**

Add these imports to `tests/test_backend_api_contract.py`:

```python
from src.spare_mvp_backend.run_service import RunService, RunServiceError
```

Add the tests inside `BackendApiContractTest`:

```python
def test_run_service_submits_smoke_run_and_returns_status_envelope(self) -> None:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    snapshot = self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m6 status", "steps": 2})

    service = RunService(self.repository, self.adapter, self.api.output_dir)
    submitted = service.submit_run(
        {
            "project_id": saved["project_id"],
            "experiment_plan_id": plan["experiment_plan_id"],
            "model_family": "smoke",
            "run_type": "single",
        }
    )
    status = service.get_run_status(submitted["run_id"])

    self.assertEqual(submitted["status"], "succeeded")
    self.assertEqual(submitted["phase"], "completed")
    self.assertEqual(submitted["progress"], 1)
    self.assertEqual(submitted["run_type"], "single")
    self.assertEqual(submitted["model_family"], "smoke")
    self.assertEqual(status["run_id"], submitted["run_id"])
    self.assertEqual(status["experiment_plan_id"], plan["experiment_plan_id"])
    self.assertEqual(status["modeling_snapshot_id"], snapshot["snapshot_id"])
    self.assertEqual(status["result_summary_id"], submitted["result_summary_id"])
    self.assertEqual(status["artifact_manifest_id"], submitted["artifact_manifest_id"])
    self.assertEqual(self.adapter.run_calls[0][1], 2)

def test_run_service_rejects_missing_model_family_on_canonical_submit(self) -> None:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "missing family", "steps": 2})
    service = RunService(self.repository, self.adapter, self.api.output_dir)

    with self.assertRaises(RunServiceError) as ctx:
        service.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "run_type": "single",
            }
        )

    self.assertEqual(ctx.exception.code, "bad_run_request")

def test_backend_api_start_simulation_run_delegates_to_m6_run_service(self) -> None:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "compat", "steps": 1})

    run = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")
    status = self.api.get_run_status(run["run_id"])

    self.assertEqual(run["status"], "succeeded")
    self.assertEqual(status["phase"], "completed")
    self.assertEqual(status["run_id"], run["run_id"])
    self.assertEqual(status["experiment_plan_id"], plan["experiment_plan_id"])
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: FAIL because `src.spare_mvp_backend.run_service` and `BackendApi.get_run_status()` do not exist.

- [ ] **Step 2: Create RunService with synchronous local execution**

Create `src/spare_mvp_backend/run_service.py`:

```python
"""M6.0 run service boundary over the local synchronous smoke executor."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


class RunServiceError(ValueError):
    """Structured error raised by the M6.0 run service."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class RunService:
    """Submit and query simulation runs without exposing executor details."""

    def __init__(
        self,
        repository: ContractRepository,
        adapter: SimulationAdapter,
        output_dir: Path | str,
    ) -> None:
        self.repository = repository
        self.adapter = adapter
        self.output_dir = Path(output_dir)

    def submit_run(self, request: dict[str, Any]) -> dict[str, Any]:
        project_id = str(request.get("project_id") or "")
        experiment_plan_id = str(request.get("experiment_plan_id") or "")
        raw_model_family = request.get("model_family")
        run_type = str(request.get("run_type") or "single")
        if not project_id or not experiment_plan_id or raw_model_family in (None, ""):
            raise RunServiceError("bad_run_request", "project_id, experiment_plan_id, and model_family are required")
        model_family = str(raw_model_family)
        if run_type != "single":
            raise RunServiceError("unsupported_run_type", "M6.0 only supports run_type=single", run_type=run_type)

        project = self.repository.get_project(project_id)
        plan = self.repository.get_experiment_plan(experiment_plan_id)
        if plan["project_id"] != project_id:
            raise RunServiceError(
                "project_plan_mismatch",
                "experiment plan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )

        snapshot = (
            self.repository.get_modeling_snapshot(plan["modeling_snapshot_id"])
            if plan.get("modeling_snapshot_id")
            else None
        )
        project_for_run = copy.deepcopy(snapshot["project"]) if snapshot else project
        # M6.0 intentionally compiles the persisted ModelingSnapshot. Full ExperimentPlan
        # branch Project payload compilation is a later slice; only steps is consumed here.
        scenario = self.adapter.compile_scenario(project_for_run, model_family=model_family)
        scenario = copy.deepcopy(scenario)
        scenario_base_id = f"{scenario['scenario_id']}-{_stable_hash({'experiment_plan_id': experiment_plan_id})}"
        run_id = self.repository.next_run_id(scenario_base_id)
        scenario["scenario_id"] = run_id.removeprefix("run-")

        self.repository.upsert_scenario(scenario)
        bundle = self.adapter.run_scenario(
            scenario,
            output_dir=self.output_dir,
            steps=_steps_from_plan(plan),
            run_id=run_id,
        )
        run = copy.deepcopy(bundle["run"])
        run["experiment_plan_id"] = experiment_plan_id
        run["modeling_snapshot_id"] = plan.get("modeling_snapshot_id")
        run["project_version"] = project_for_run.get("project_version")
        run["project_schema_version"] = project_for_run.get("schema_version")
        run["scenario_schema_version"] = scenario["schema_version"]
        run["phase"] = "completed" if run.get("status") == "succeeded" else "failed"
        run["queued_at"] = run.get("started_at")

        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(bundle["result"])
        self.repository.upsert_artifact_manifest(bundle["artifact_manifest"])
        return self._status_from_run(run)

    def get_run_status(self, run_id: str) -> dict[str, Any]:
        return self._status_from_run(self.repository.get_run(run_id))

    def _status_from_run(self, run: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": run["run_id"],
            "project_id": run["project_id"],
            "experiment_plan_id": run.get("experiment_plan_id"),
            "modeling_snapshot_id": run.get("modeling_snapshot_id"),
            "scenario_id": run["scenario_id"],
            "status": run["status"],
            "phase": run.get("phase") or _phase_from_status(run["status"]),
            "progress": run.get("progress", 0),
            "run_type": run.get("run_type") or "single",
            "model_family": run["model_family"],
            "seed": run.get("seed"),
            "queued_at": run.get("queued_at") or run.get("started_at"),
            "started_at": run.get("started_at"),
            "completed_at": run.get("completed_at"),
            "error": run.get("error"),
            "result_summary_id": run.get("result_summary_id"),
            "artifact_manifest_id": run.get("artifact_manifest_id"),
        }


def _phase_from_status(status: str) -> str:
    if status == "succeeded":
        return "completed"
    if status == "failed":
        return "failed"
    if status == "running":
        return "running"
    return "queued"


def _steps_from_plan(plan: dict[str, Any]) -> int:
    config = plan.get("config") or {}
    steps = config.get("steps", 3)
    if isinstance(steps, bool):
        return 3
    try:
        return max(0, int(steps))
    except (TypeError, ValueError):
        return 3


def _stable_hash(payload: dict[str, Any]) -> str:
    import hashlib
    import json

    data = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:12]
```

- [ ] **Step 3: Delegate BackendApi run orchestration**

In `src/spare_mvp_backend/api.py`, add the import:

```python
from src.spare_mvp_backend.run_service import RunService, RunServiceError
```

In `BackendApi.__init__`, add:

```python
self.run_service = RunService(repository, adapter, self.output_dir)
```

Replace `_start_simulation_run()` with:

```python
def _start_simulation_run(
    self,
    project_id: str,
    experiment_plan_id: str,
    model_family: str = "smoke",
) -> dict[str, Any]:
    try:
        status = self.run_service.submit_run(
            {
                "project_id": project_id,
                "experiment_plan_id": experiment_plan_id,
                "model_family": model_family,
                "run_type": "single",
            }
        )
    except RunServiceError as exc:
        raise BackendApiError(exc.code, str(exc), **exc.details) from exc
    except AdapterError as exc:
        raise self._to_backend_error(exc, model_family) from exc
    return {
        "run_id": status["run_id"],
        "project_id": status["project_id"],
        "scenario_id": status["scenario_id"],
        "result_summary_id": status["result_summary_id"],
        "artifact_manifest_id": status["artifact_manifest_id"],
        "status": status["status"],
        "phase": status["phase"],
        "progress": status["progress"],
    }
```

Add:

```python
def submit_run(self, request: dict[str, Any]) -> dict[str, Any]:
    model_family = str(request.get("model_family") or "")
    # Keep canonical /api/runs under the same single-flight guard as the legacy route.
    with self._run_lock:
        try:
            return self.run_service.submit_run(request)
        except RunServiceError as exc:
            raise BackendApiError(exc.code, str(exc), **exc.details) from exc
        except AdapterError as exc:
            raise self._to_backend_error(exc, model_family) from exc

def get_run_status(self, run_id: str) -> dict[str, Any]:
    return self.run_service.get_run_status(run_id)
```

- [ ] **Step 4: Verify backend API tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: PASS.

- [ ] **Step 5: Commit backend service boundary**

```bash
git add src/spare_mvp_backend/run_service.py src/spare_mvp_backend/api.py tests/test_backend_api_contract.py
git commit -m "feat: add m6 run service boundary"
```

### Task 2: Canonical HTTP Run Routes

**Files:**
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_http_api.py`

- [ ] **Step 1: Add failing HTTP tests for `/api/runs`**

Add to `tests/test_backend_http_api.py`:

```python
def test_http_runs_route_submits_and_queries_status(self) -> None:
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
            project = self._fixture("smoke_project.json")
            saved = self._json(base_url, "POST", "/projects", project)
            self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
            plan = self._json(
                base_url,
                "POST",
                f"/projects/{saved['project_id']}/experiment-plans",
                {"config": {"name": "m6 http", "steps": 2}},
            )

            submitted = self._json(
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
            status = self._json(base_url, "GET", f"/runs/{submitted['run_id']}")
            result = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/result")
            artifacts = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/artifacts")
            chain = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/chain")

            self.assertEqual(submitted["status"], "succeeded")
            self.assertEqual(status["phase"], "completed")
            self.assertEqual(status["run_id"], submitted["run_id"])
            self.assertEqual(result["run_id"], submitted["run_id"])
            self.assertEqual(artifacts["run_id"], submitted["run_id"])
            self.assertEqual(chain["run_id"], submitted["run_id"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: FAIL because `/api/runs` is not routed.

- [ ] **Step 2: Add `/api/runs` routes**

In `src/spare_mvp_backend/http_server.py`, before the existing `/simulation-runs` branch, add:

```python
if self.command == "POST" and route == "/runs":
    return api.submit_run(body)
if self.command == "GET" and len(parts) == 2 and parts[0] == "runs":
    return api.get_run_status(parts[1])
if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "result":
    return api.get_run_result(parts[1])
if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "artifacts":
    return api.get_run_artifacts(parts[1])
if self.command == "GET" and len(parts) == 3 and parts[0] == "runs" and parts[2] == "chain":
    return api.get_run_chain(parts[1])
```

Keep the existing `GET /simulation-runs/{run_id}` route returning the raw stored run payload for compatibility:

```python
if self.command == "GET" and len(parts) == 2 and parts[0] == "simulation-runs":
    return api.get_run(parts[1])
```

Keep `POST /simulation-runs` as a compatibility alias:

```python
if self.command == "POST" and route == "/simulation-runs":
    if "project_id" not in body or "experiment_plan_id" not in body:
        raise ValueError("project_id and experiment_plan_id are required")
    return api.start_simulation_run(
        body["project_id"],
        body["experiment_plan_id"],
        body.get("model_family", "smoke"),
    )
```

- [ ] **Step 3: Verify HTTP tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: PASS.

- [ ] **Step 4: Commit HTTP run routes**

```bash
git add src/spare_mvp_backend/http_server.py tests/test_backend_http_api.py
git commit -m "feat: expose canonical run routes"
```

### Task 3: Frontend API Client Run Status Contract

**Files:**
- Modify: `front/api-client.mjs`
- Test: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Add failing API client tests**

In `tests/frontend-api-client.test.mjs`, update the test transport near the existing `/simulation-runs` handling to also support:

```javascript
if (request.path === "/runs") {
  return {
    run_id: "run-ui",
    project_id: request.body.project_id,
    experiment_plan_id: request.body.experiment_plan_id,
    status: "succeeded",
    phase: "completed",
    progress: 1,
    result_summary_id: "result-ui",
    artifact_manifest_id: "artifact-ui"
  };
}
if (request.path === "/runs/run-ui") return { run_id: "run-ui", status: "succeeded", phase: "completed", progress: 1 };
if (request.path === "/runs/run-ui/result") return { result_id: "result-ui", run_id: "run-ui", metrics: { mission_success_rate: 0.9 } };
if (request.path === "/runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", run_id: "run-ui", artifacts: [] };
if (request.path === "/runs/run-ui/chain") return { run_id: "run-ui", artifact_manifest_id: "artifact-ui" };
```

Add the canonical route test below the existing stable PR-F client test:

```javascript
test("backend api client uses canonical M6 run routes", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(`${request.method} ${request.path}`);
      if (request.path === "/runs") {
        return { run_id: "run-ui", status: "succeeded", phase: "completed", progress: 1 };
      }
      if (request.path === "/runs/run-ui") return { run_id: "run-ui", status: "succeeded", phase: "completed", progress: 1 };
      if (request.path === "/runs/run-ui/result") return { result_id: "result-ui", run_id: "run-ui", metrics: {} };
      if (request.path === "/runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", run_id: "run-ui", artifacts: [] };
      if (request.path === "/runs/run-ui/chain") return { run_id: "run-ui", artifact_manifest_id: "artifact-ui" };
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const submitted = await client.submitRun({
    project_id: "project-ui",
    experiment_plan_id: "plan-ui",
    model_family: "smoke",
    run_type: "single"
  });
  const status = await client.getRunStatus(submitted.run_id);
  const result = await client.getRunResult(submitted.run_id);
  const artifacts = await client.getRunArtifacts(submitted.run_id);
  const chain = await client.getRunChain(submitted.run_id);

  assert.equal(status.phase, "completed");
  assert.equal(result.run_id, "run-ui");
  assert.equal(artifacts.run_id, "run-ui");
  assert.equal(chain.artifact_manifest_id, "artifact-ui");
  assert.deepEqual(calls, [
    "POST /runs",
    "GET /runs/run-ui",
    "GET /runs/run-ui/result",
    "GET /runs/run-ui/artifacts",
    "GET /runs/run-ui/chain"
  ]);
});
```

Update the existing `frontend API client exposes stable PR-F save run and result methods` test in the same file so its transport handles canonical run paths used by the compatibility aliases:

```javascript
if (request.path === "/runs") {
  return {
    run_id: "run-ui",
    project_id: "project-ui",
    scenario_id: "scenario-ui",
    result_summary_id: "result-ui",
    artifact_manifest_id: "artifact-ui",
    status: "succeeded",
    phase: "completed",
    progress: 1
  };
}
if (request.path === "/runs/run-ui") return { run_id: "run-ui", status: "succeeded", phase: "completed", progress: 1 };
if (request.path === "/runs/run-ui/result") return { result_id: "result-ui", run_id: "run-ui", metrics: { mission_success_rate: 0.9 } };
if (request.path === "/runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", run_id: "run-ui", artifacts: [] };
if (request.path === "/runs/run-ui/chain") {
  return {
    project_id: "project-ui",
    modeling_snapshot_id: "snapshot-ui",
    experiment_plan_id: "plan-ui",
    scenario_id: "scenario-ui",
    run_id: "run-ui",
    result_summary_id: "result-ui",
    artifact_manifest_id: "artifact-ui"
  };
}
```

Replace that test's expected call list with:

```javascript
assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
  "POST /projects/validate",
  "POST /projects",
  "GET /projects/project-ui",
  "POST /projects/project-ui/modeling-snapshots",
  "POST /projects/project-ui/experiment-plans",
  "POST /runs",
  "GET /runs/run-ui",
  "GET /runs/run-ui/result",
  "GET /runs/run-ui/artifacts",
  "GET /runs/run-ui/chain"
]);
```

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: FAIL because `submitRun()` and `getRunStatus()` do not exist.

- [ ] **Step 2: Refactor the client object to support aliases**

In `front/api-client.mjs`, change `createBackendApiClient()` from returning the object literal directly to assigning it to `client` first:

```javascript
const client = {
  login(username, password) {
    return request({ method: "POST", path: "/auth/login", body: { username, password }, auth: false });
  },
  // Keep the existing methods in their current order, then replace only the run methods as shown below.
};
```

Inside that `client` object, replace the existing run methods with canonical M6 routes:

```javascript
submitRun(runRequest) {
  return request({
    method: "POST",
    path: "/runs",
    body: {
      ...runRequest
    }
  });
},
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

After the object literal, add compatibility aliases and return `client`:

```javascript
client.startSimulationRun = (projectId, experimentPlanId, modelFamily = "smoke") => client.submitRun({
  project_id: projectId,
  experiment_plan_id: experimentPlanId,
  model_family: modelFamily,
  run_type: "single"
});
client.getRun = (runId) => client.getRunStatus(runId);
return client;
```

This keeps all existing call sites working while new code can use `submitRun()` and `getRunStatus()` directly.

- [ ] **Step 3: Verify frontend client tests**

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit frontend API client contract**

```bash
git add front/api-client.mjs tests/frontend-api-client.test.mjs
git commit -m "feat: add frontend run status client"
```

### Task 4: Frontend Run Status Polling

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-api-client.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Add failing frontend source contract tests**

Add to `tests/frontend-contract.test.mjs`:

```javascript
test("run launch uses M6 status polling and keeps ExperimentPlan as source", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const launchSource = appSource.slice(
    appSource.indexOf("async function startExperimentRunThroughApi"),
    appSource.indexOf("async function refreshRunResultThroughApi")
  );
  const refreshSource = appSource.slice(
    appSource.indexOf("async function refreshRunResultThroughApi"),
    appSource.indexOf("async function hydrateLastBackendRunFromApi")
  );

  assert.match(appSource, /async function pollBackendRunStatus/);
  assert.match(launchSource, /backendApi\.submitRun/);
  assert.match(launchSource, /experimentPlan\.experiment_plan_id/);
  assert.match(launchSource, /await pollBackendRunStatus\(backendRun\.run_id\)/);
  assert.match(refreshSource, /backendApi\.getRunStatus\(runId\)/);
  assert.match(refreshSource, /backendApi\.getRunResult\(runId\)/);
  assert.match(refreshSource, /backendApi\.getRunArtifacts\(runId\)/);
  assert.match(refreshSource, /backendApi\.getRunChain\(runId\)/);
  assert.doesNotMatch(launchSource, /offline-demo-run/);
});
```

Update the existing `frontend app routes project save run and result reads through API client` test in `tests/frontend-api-client.test.mjs`:

```javascript
assert.match(appSource, /backendApi\.submitRun/);
assert.match(appSource, /backendApi\.getRunStatus/);
assert.doesNotMatch(appSource, /backendApi\.startSimulationRun/);
assert.doesNotMatch(appSource, /backendApi\.getRun\(/);
```

Keep the existing assertions for `saveProject`, `getProject`, `createModelingSnapshot`, `createExperimentPlan`, `getRunResult`, `getRunArtifacts`, `getRunChain`, `backendRunChain`, `backendArtifactManifest.artifacts`, `hydrateLastBackendRunFromApi`, and the `offline-demo-run` block.

Run:

```bash
node --test tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs
```

Expected: FAIL because polling helpers are not wired and app source still uses the old run client methods.

- [ ] **Step 2: Add status polling helper**

In `front/app.js`, near `refreshRunResultThroughApi`, add:

```javascript
async function pollBackendRunStatus(runId, { attempts = 6, delayMs = 250 } = {}) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await backendApi.getRunStatus(runId);
    backendRun = latest;
    experimentRunStatus = latest.status === "succeeded" ? "完成" : latest.status;
    if (["succeeded", "failed"].includes(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return latest;
}
```

- [ ] **Step 3: Submit run through canonical client**

In `startExperimentRunThroughApi()`, replace:

```javascript
backendRun = await backendApi.startSimulationRun(savedProject.project_id, experimentPlan.experiment_plan_id, "smoke");
```

with:

```javascript
backendRun = await backendApi.submitRun({
  project_id: savedProject.project_id,
  experiment_plan_id: experimentPlan.experiment_plan_id,
  model_family: "smoke",
  run_type: "single"
});
await pollBackendRunStatus(backendRun.run_id);
```

Keep:

```javascript
lastRunExperimentPlanProjectJson = {
  run_id: backendRun.run_id,
  project_json: planProjectJson
};
```

before `refreshRunResultThroughApi(backendRun.run_id)` so results still use the ExperimentPlan branch snapshot.
This local `planProjectJson` is only for the current frontend display bridge; the persisted M6.0 backend artifacts are generated from the ExperimentPlan-bound ModelingSnapshot plus supported plan config fields. Do not describe this as full backend compilation of the editable plan Project payload.

- [ ] **Step 4: Read status through canonical client**

In `refreshRunResultThroughApi()`, replace:

```javascript
backendRun = await backendApi.getRun(runId);
```

with:

```javascript
backendRun = await backendApi.getRunStatus(runId);
```

Keep the existing result/artifact/chain calls.

- [ ] **Step 5: Verify frontend contract tests**

Run:

```bash
node --test tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit frontend run polling**

```bash
git add front/app.js tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs
git commit -m "feat: poll backend run status from frontend"
```

### Task 5: Browser Smoke Evidence

**Files:**
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- Modify: `reports/m3-1-browser-backend-smoke/README.md`

- [ ] **Step 1: Update smoke to wait for canonical run route**

In `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`, replace response waits that only match `/api/simulation-runs` with a helper:

```javascript
function isRunSubmissionResponse(response) {
  return (
    response.status() === 200 &&
    (response.url().endsWith("/api/runs") || response.url().endsWith("/api/simulation-runs"))
  );
}
```

Use it in both wait sites:

```javascript
const runResponsePromise = page.waitForResponse(isRunSubmissionResponse, { timeout: 10000 }).catch(() => null);
```

In the captured run summary, assert status text includes a concrete run state:

```javascript
if (!/完成|succeeded|运行中|running/.test(summary.statusText)) {
  throw new Error(`Run status did not reflect backend state: ${summary.statusText}`);
}
```

- [ ] **Step 2: Update smoke README evidence wording**

In `reports/m3-1-browser-backend-smoke/README.md`, add a M6.0 note:

```markdown
M6.0 更新：浏览器 smoke 现在接受 canonical `/api/runs` 作为运行提交入口，并继续兼容旧 `/api/simulation-runs`。验收重点是前端拿到 `run_id` 后通过 run status/result/artifact/chain 刷新页面；当前执行器仍是同步本地 smoke runner，不代表完整 worker 队列、取消、重试或真实批量 Monte Carlo 已完成。
```

- [ ] **Step 3: Run browser smoke**

Run:

```bash
npm run start:system
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit smoke evidence updates**

```bash
git add reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs reports/m3-1-browser-backend-smoke/README.md
git commit -m "test: update browser smoke for run status boundary"
```

### Task 6: Documentation Sync

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`

- [ ] **Step 1: Link M6.0 docs from README**

In `README.md`, under M5.2 docs, add:

```markdown
- [`docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md`](docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md)：M6.0 仿真运行服务边界设计。
- [`docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md`](docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md)：M6.0 canonical run API、status 轮询和同步本地执行器实施计划。
```

- [ ] **Step 2: Update docs README map**

In `docs/README.md`, add to current state:

```markdown
28. M6.0 将当前同步 smoke run 收敛到 `RunService` 和 canonical `/api/runs` 边界；前端启动运行后通过 run status/result/artifact/chain 刷新状态。该切片的后端输入是 ExperimentPlan 绑定的 ModelingSnapshot 加当前支持的 `steps` 配置，仍不是完整 ExperimentPlan payload 编译、完整 worker 队列、取消、重试、真实批量 Monte Carlo 或 `aviation_support` 编译解锁。
```

Add document map rows:

```markdown
| [`superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md`](superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md) | M6.0 仿真运行服务边界设计，限定 RunService、canonical `/api/runs`、status envelope 和非目标。 |
| [`superpowers/plans/2026-06-20-m6-0-run-service-boundary.md`](superpowers/plans/2026-06-20-m6-0-run-service-boundary.md) | M6.0 RunService、HTTP run routes、前端 status polling、浏览器 smoke 和文档同步实施计划。 |
```

- [ ] **Step 3: Add roadmap M6.0 slice**

In `docs/product-roadmap.md`, under `## M6：仿真引擎服务化`, add:

```markdown
M6.0 首片：新增 `RunService` 与 canonical `/api/runs`，把当前同步 smoke run 包装成可轮询的运行服务边界。前端启动运行后先拿 `run_id`，再查询 status/result/artifact/chain。该首片的后端输入是 ExperimentPlan 绑定的 ModelingSnapshot 加当前支持的 `steps` 配置，仍使用本地同步执行器，不包含完整 ExperimentPlan payload 编译、完整 worker 队列、取消、重试、超时、资源隔离、真实批量 Monte Carlo fan-out、长期 artifact storage 或 `aviation_support` 编译解锁。
```

- [ ] **Step 4: Update agent validation rules**

In `agent.md`, add a validation rule:

```markdown
14. M6.0 运行服务首片必须通过 canonical `/api/runs` 创建和查询 run status，同时保留 `/api/simulation-runs` 兼容路径；运行 identity 必须来自 ExperimentPlan，后端输入使用该计划绑定的 ModelingSnapshot 和当前支持的 `steps` 配置，不能绕过 M5.3 的 Project/Plan 分界。
```

- [ ] **Step 5: Run stale wording scan**

Run:

```bash
rg -n "完整 worker|真实批量 Monte Carlo|aviation_support.*解锁|/api/simulation-runs.*唯一|offline-demo-run" README.md docs agent.md front tests reports
```

Expected: matches either document explicit non-goals/compatibility or existing tests that block `offline-demo-run`; no current docs claim M6.0 already completed full worker or true batch Monte Carlo.

- [ ] **Step 6: Commit docs**

```bash
git add README.md docs/README.md docs/product-roadmap.md agent.md docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md
git commit -m "docs: plan m6 run service boundary"
```

### Task 7: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run frontend tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run backend tests**

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract tests.test_simulation_adapter
```

Expected: PASS.

- [ ] **Step 3: Run browser smoke**

```bash
npm run start:system
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: PASS.

- [ ] **Step 4: Check docs whitespace and scope**

```bash
git diff --check
rg -n "M6.0|RunService|/api/runs|worker|Monte Carlo|aviation_support" README.md docs agent.md
```

Expected: `git diff --check` has no output; wording states M6.0 scope and non-goals consistently.

- [ ] **Step 5: Inspect final diff**

```bash
git status --short
git diff --stat origin/main...HEAD
git diff -- docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md
```

Expected: committed implementation tasks align with the M6.0 design and do not expand M4 or M5 scope.
