# M7.0 Run Artifact Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not implement this plan through an executing-plans inline session.

**Goal:** Build the M7.0 run and artifact management layer so users can list, inspect, download, archive, soft-delete, and audit canonical `/api/runs` outputs without changing simulation semantics.

**Architecture:** Keep `RunService` as the canonical run boundary and thicken the local artifact ledger around the existing SQLite repository and filesystem output directory. Add repository/API/HTTP management methods over `simulation_runs`, `result_summaries`, and `artifact_manifests`, then expose a lightweight frontend run-artifact panel that renders metadata and lifecycle actions without parsing projection payloads.

**Tech Stack:** Python `unittest`, SQLite migrations in `src/spare_mvp_backend/schema.sql` / `repository.py`, standard-library `ThreadingHTTPServer`, filesystem artifact files with SHA-256 verification, browser-native ES modules, Node `node:test`, Playwright smoke.

---

## Task 0: Controller Protocol and Worker Boundaries

**Files:**
- No code files.
- Review inputs: `docs/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md`
- Review inputs: `docs/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md`

**Non-goals:** The main controller does not directly batch-implement backend, HTTP, frontend, and docs changes in one worker context.

- [ ] **Step 1: Start subagent-driven development**

The main controller must load `superpowers:subagent-driven-development` before executing implementation work. The controller owns task dispatch, review, integration decisions, and final verification only.

Expected worker ownership:

- Backend ledger worker: Task 1 and repository portions of Task 2.
- HTTP safety worker: API/HTTP routes, audit event writes, path/hash checks, lifecycle HTTP tests.
- Frontend UI worker: API client, Monte Carlo detail run-artifact section, browser smoke updates.
- Docs/audit worker: README/docs/roadmap/agent sync and `reports/2026-06-21-m7-0-run-artifact-management-audit/README.md`.

- [ ] **Step 2: Review after each worker**

After each worker returns, the main controller runs a scoped quality review before dispatching the next dependent task:

```bash
git diff --check
```

For backend/API/HTTP workers, also run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract
```

For frontend workers, also run:

```bash
npm test
```

Expected: PASS before moving to the next worker. If a worker changes scope boundaries, the controller updates the plan/spec first and re-runs the review for that task.

## Current Boundary

M6.2/M6.2.y already provides `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`, status/result/artifacts/chain routes, SQLite `simulation_runs` / `result_summaries` / `artifact_manifests`, and front-end Monte Carlo identity-chain rendering. M7.0 must add management and ledger completeness on top of those paths.

Do not restore legacy `/api/simulation-runs`. Do not unlock `aviation_support` execution. Do not implement production worker queue, object storage, full cancel/retry lifecycle, M8 projection payload KPI rendering, or M9 state stream.

## File Structure

- Modify: `contracts/artifact_manifest.schema.json`
  - Add M7 artifact kinds: `run_config`, `sample_results`, `aggregate_result`, `metrics`.
- Modify: `contracts/run.schema.json`
  - Add run lifecycle and creator metadata fields used by list/detail.
- Modify: `src/spare_mvp_contract/adapter.py`
  - Generate complete local artifacts for single and Monte Carlo runs.
  - Include support artifacts in Monte Carlo manifests instead of writing and dropping them.
- Modify: `src/spare_mvp_backend/run_service.py`
  - Build run_config payloads, attach lifecycle defaults, and create failed-run log manifests.
- Modify: `src/spare_mvp_backend/schema.sql`
  - Add lifecycle query columns to `simulation_runs`.
- Modify: `src/spare_mvp_backend/repository.py`
  - Add schema migration/backfill, list/detail helpers, lifecycle update helpers, artifact lookup, and tombstone semantics.
- Modify: `src/spare_mvp_backend/api.py`
  - Add list/detail/download/archive/delete methods and artifact path/hash verification.
- Modify: `src/spare_mvp_backend/http_server.py`
  - Add canonical M7 routes and binary/file response support.
- Modify: `front/api-client.mjs`
  - Add `listRuns()`, `getRunDetail()`, `downloadRunArtifact()`, `archiveRun()`, `deleteRun()`.
- Modify: `front/app.js`
  - Add a `renderRunArtifactManagementSection()` section inside the existing Monte Carlo experiment detail view, below the current identity chain and artifact table.
- No change: `front/feature-catalog.mjs`
  - M7.0 uses the existing Monte Carlo experiment/detail surface and does not add a new navigation route or feature-catalog key.
- Modify: `tests/test_simulation_adapter.py`
  - Cover complete artifact manifest generation for single and Monte Carlo runs.
- Modify: `tests/test_backend_api_contract.py`
  - Cover RunService/repository list/detail/lifecycle behavior.
- Modify: `tests/test_backend_http_api.py`
  - Cover HTTP routes, path safety, hash mismatch, soft delete, archive, and legacy route non-regression.
- Modify: `tests/frontend-api-client.test.mjs`
  - Cover new client methods and download request shape.
- Modify: `tests/frontend-contract.test.mjs`
  - Cover visible artifact columns/actions and absence of projection-payload parsing.
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
  - Smoke the visible run/artifact panel and one artifact download event.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`
  - Sync M7.0 scope, non-goals, and canonical route wording.
- Create: `reports/2026-06-21-m7-0-run-artifact-management-audit/README.md`
  - Record implementation evidence, commands, browser smoke result, and boundary self-audit.

## Task 1: Backend Artifact Ledger and Manifest Thickening

**Files:**
- Modify: `contracts/artifact_manifest.schema.json`
- Modify: `src/spare_mvp_contract/adapter.py`
- Modify: `src/spare_mvp_backend/run_service.py`
- Modify: `tests/test_simulation_adapter.py`
- Modify: `tests/test_backend_api_contract.py`

**Non-goals:** Do not change smoke model behavior, Monte Carlo math, `analysis_projection_*` payload semantics, or `aviation_support` gate behavior. Do not introduce object storage.

- [ ] **Step 1: Add failing schema and adapter tests for complete artifact manifests**

In `tests/test_simulation_adapter.py`, add tests that assert exact M7 artifact kinds for single and Monte Carlo runs:

```python
def test_run_smoke_scenario_writes_m7_management_artifacts(self) -> None:
    scenario = self._smoke_scenario()
    with tempfile.TemporaryDirectory() as tmp:
        bundle = self.adapter.run_scenario(scenario, output_dir=tmp, steps=2, run_id="run-m7-single")
        manifest = bundle["artifact_manifest"]
        kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
        self.assertGreaterEqual(
            kinds,
            {"run_config", "input_project", "compiled_scenario", "snapshot", "result_summary", "metrics", "report", "log"},
        )
        for artifact in manifest["artifacts"]:
            target = Path(tmp) / artifact["path"]
            self.assertTrue(target.is_file(), artifact)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), artifact["sha256"])
            self.assertEqual(target.stat().st_size, artifact["size_bytes"])

def test_run_monte_carlo_scenario_registers_support_and_m7_artifacts(self) -> None:
    scenario = self._smoke_scenario()
    with tempfile.TemporaryDirectory() as tmp:
        bundle = self.adapter.run_monte_carlo_scenario(
            scenario,
            output_dir=tmp,
            steps=2,
            run_id="run-m7-mc",
            monte_carlo_config={
                "sample_count": 2,
                "sweep": {"failureRates": [0.05], "spareMultipliers": [1.0], "supportCapacities": [1]},
                "mc_experiment_id": "mc-m7",
            },
        )
        kinds = {artifact["kind"] for artifact in bundle["artifact_manifest"]["artifacts"]}
        self.assertGreaterEqual(
            kinds,
            {
                "run_config",
                "input_project",
                "compiled_scenario",
                "sample_results",
                "aggregate_result",
                "result_summary",
                "metrics",
                "report",
                "log",
                "monte_carlo_base",
                "analysis_projection_spare_shortfall",
                "analysis_projection_carry_list",
                "analysis_projection_mission_reliability",
                "analysis_projection_downtime_factors",
            },
        )
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter
```

Expected: FAIL because the manifest does not yet include the new M7 artifact kinds, and Monte Carlo support artifacts are currently written but not included in the manifest.

- [ ] **Step 2: Extend artifact schema enum**

In `contracts/artifact_manifest.schema.json`, add these values to `properties.artifacts.items.properties.kind.enum`:

```json
"run_config",
"sample_results",
"aggregate_result",
"metrics"
```

Also update `properties.artifacts.items.required` to require all immutable ledger fields:

```json
"required": ["artifact_id", "kind", "path", "media_type", "sha256", "size_bytes"]
```

Keep existing kinds unchanged, including `log`, `report`, `monte_carlo_base`, and every `analysis_projection_*`.

In `tests/contract-curator.test.mjs`, add a negative contract test:

```javascript
test("artifact manifest schema rejects an artifact entry without size_bytes", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const manifest = {
    schema_version: "artifact-manifest-v0",
    artifact_manifest_id: "artifact-manifest-missing-size",
    run_id: "run-missing-size",
    artifacts: [
      {
        artifact_id: "artifact-missing-size",
        kind: "run_config",
        path: "run-missing-size/run-config.json",
        media_type: "application/json",
        sha256: "0".repeat(64),
        schema_version: "run-config-v0"
      }
    ]
  };

  const errors = validateSchema(artifactSchema, manifest);
  assert.ok(errors.some((error) => error.includes("size_bytes")));
});
```

Run:

```bash
npm test -- contract-curator.test.mjs
```

Expected: PASS for existing schema tests, with no removal of M6.2 projection requirements.

- [ ] **Step 3: Generate M7 artifacts in `SimulationAdapter.run_scenario()`**

In `src/spare_mvp_contract/adapter.py`, build these payloads before `artifact_specs` in `run_scenario()`:

```python
run_config = {
    "schema_version": "run-config-v0",
    "run_id": run_id,
    "run_type": "single",
    "model_family": "smoke",
    "project_id": scenario["project_id"],
    "experiment_plan_id": None,
    "modeling_snapshot_id": None,
    "scenario_id": scenario["scenario_id"],
    "scenario_version": scenario["scenario_version"],
    "seed": inputs["seed"],
    "steps": steps,
}
metrics = {
    "schema_version": "metrics-v0",
    "run_id": run_id,
    "metrics": snapshot,
}
report = {
    "schema_version": "run-report-v0",
    "run_id": run_id,
    "title": "Smoke single run report",
    "summary": {
        "status": "succeeded",
        "steps": steps,
        "seed": inputs["seed"],
    },
}
event_log = {
    "schema_version": "run-log-v0",
    "run_id": run_id,
    "events": [
        {"event": "run_started", "at": now},
        {"event": "run_completed", "at": now, "status": "succeeded"},
    ],
}
```

Include the new files in `artifact_specs`:

```python
artifact_specs = [
    ("run_config", "run-config.json", run_config, "run-config-v0"),
    ("input_project", "input-project.json", inputs["project_snapshot"], PROJECT_SCHEMA_VERSION),
    ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
    ("snapshot", "snapshot.json", snapshot, None),
    ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
    ("metrics", "metrics.json", metrics, "metrics-v0"),
    ("report", "report.json", report, "run-report-v0"),
    ("log", "events-log.json", event_log, "run-log-v0"),
]
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_run_smoke_scenario_writes_m7_management_artifacts
```

Expected: PASS.

- [ ] **Step 4: Generate and register M7 artifacts in `SimulationAdapter.run_monte_carlo_scenario()`**

In `run_monte_carlo_scenario()`, create payloads:

```python
run_config = {
    "schema_version": "run-config-v0",
    "run_id": run_id,
    "run_type": "monte_carlo",
    "model_family": "smoke",
    "project_id": scenario["project_id"],
    "experiment_plan_id": None,
    "modeling_snapshot_id": None,
    "scenario_id": scenario["scenario_id"],
    "scenario_version": scenario["scenario_version"],
    "seed": inputs["seed"],
    "steps": steps,
    "mc_experiment_id": mc_experiment_id,
    "monte_carlo_config": copy.deepcopy(config),
}
sample_results = {
    "schema_version": "sample-results-v0",
    "run_id": run_id,
    "mc_experiment_id": mc_experiment_id,
    "samples": samples,
}
aggregate_result = {
    "schema_version": "aggregate-result-v0",
    "run_id": run_id,
    "mc_experiment_id": mc_experiment_id,
    "aggregate_metrics": aggregate,
}
metrics = {
    "schema_version": "metrics-v0",
    "run_id": run_id,
    "metrics": aggregate,
}
report = {
    "schema_version": "run-report-v0",
    "run_id": run_id,
    "title": "Monte Carlo run report",
    "summary": {
        "status": "succeeded",
        "sample_count": profile["sample_count"],
        "seed": inputs["seed"],
        "mc_experiment_id": mc_experiment_id,
    },
}
event_log = {
    "schema_version": "run-log-v0",
    "run_id": run_id,
    "events": [
        {"event": "run_started", "at": now},
        {"event": "samples_completed", "at": now, "completed_samples": profile["sample_count"]},
        {"event": "run_completed", "at": now, "status": "succeeded"},
    ],
}
```

Replace the current support artifact write loop with a single `artifact_specs` list that includes support artifacts and M7 artifacts:

```python
artifact_specs = [
    ("run_config", "run-config.json", run_config, "run-config-v0"),
    ("input_project", "input-project.json", inputs["project_snapshot"], PROJECT_SCHEMA_VERSION),
    ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
    ("sample_results", "sample-results.json", sample_results, "sample-results-v0"),
    ("aggregate_result", "aggregate-result.json", aggregate_result, "aggregate-result-v0"),
    ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
    ("metrics", "metrics.json", metrics, "metrics-v0"),
    ("report", "report.json", report, "run-report-v0"),
    ("log", "events-log.json", event_log, "run-log-v0"),
    ("monte_carlo_base", "monte-carlo-base.json", base_artifact, None),
    ("analysis_projection_spare_shortfall", "spare-shortfall.json", projections["spare_shortfall"], "analysis-projection-v0"),
    ("analysis_projection_carry_list", "carry-list.json", projections["carry_list"], "analysis-projection-v0"),
    ("analysis_projection_mission_reliability", "mission-reliability.json", projections["mission_reliability"], "analysis-projection-v0"),
    ("analysis_projection_downtime_factors", "downtime-factors.json", projections["downtime_factors"], "analysis-projection-v0"),
]
```

Keep the existing loop that adds `source_artifact_id` and `analysis_type` to `analysis_projection_*` entries.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_run_monte_carlo_scenario_registers_support_and_m7_artifacts
```

Expected: PASS.

- [ ] **Step 5: Add RunService run_config provenance coverage**

In `tests/test_backend_api_contract.py`, add:

```python
def test_run_service_augments_run_config_artifact_with_plan_and_snapshot_identity(self) -> None:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    snapshot = self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m7 run config", "steps": 2})

    submitted = self.api.submit_run({
        "project_id": saved["project_id"],
        "experiment_plan_id": plan["experiment_plan_id"],
        "model_family": "smoke",
        "run_type": "single",
    })
    manifest = self.api.get_run_artifacts(submitted["run_id"])
    run_config_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "run_config")
    payload = json.loads((Path(self.api.output_dir) / run_config_artifact["path"]).read_text(encoding="utf-8"))

    self.assertEqual(payload["experiment_plan_id"], plan["experiment_plan_id"])
    self.assertEqual(payload["modeling_snapshot_id"], snapshot["snapshot_id"])
    self.assertEqual(payload["project_id"], saved["project_id"])
    self.assertEqual(payload["run_id"], submitted["run_id"])
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_augments_run_config_artifact_with_plan_and_snapshot_identity
```

Expected: FAIL until `RunService` rewrites the `run_config` artifact before persisting the manifest.

- [ ] **Step 6: Implement RunService run_config artifact augmentation**

In `src/spare_mvp_backend/run_service.py`, add:

```python
def _augment_run_config_artifact(
    self,
    manifest: dict[str, Any],
    *,
    run_id: str,
    experiment_plan_id: str,
    modeling_snapshot_id: str | None,
    plan: dict[str, Any],
    request: dict[str, Any],
) -> None:
    run_config = next(
        (artifact for artifact in manifest.get("artifacts", []) if artifact.get("kind") == "run_config"),
        None,
    )
    if run_config is None:
        return
    target = (self.output_dir / run_config["path"]).resolve()
    output_root = self.output_dir.resolve()
    if output_root not in target.parents and target != output_root:
        raise RunServiceError("artifact_path_escape", "run_config artifact path escapes output directory", run_id=run_id)
    payload = json.loads(target.read_text(encoding="utf-8"))
    payload["experiment_plan_id"] = experiment_plan_id
    payload["modeling_snapshot_id"] = modeling_snapshot_id
    payload["plan_config"] = copy.deepcopy(plan.get("config") or {})
    payload["request"] = {
        "run_type": request.get("run_type"),
        "model_family": request.get("model_family"),
        "mc_experiment_id": request.get("mc_experiment_id"),
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    data = target.read_bytes()
    run_config["sha256"] = hashlib.sha256(data).hexdigest()
    run_config["size_bytes"] = len(data)
```

Call it immediately after the adapter returns `bundle` and before `self.repository.upsert_artifact_manifest(bundle["artifact_manifest"])`:

```python
self._augment_run_config_artifact(
    bundle["artifact_manifest"],
    run_id=run_id,
    experiment_plan_id=experiment_plan_id,
    modeling_snapshot_id=plan.get("modeling_snapshot_id"),
    plan=plan,
    request=request,
)
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_augments_run_config_artifact_with_plan_and_snapshot_identity
```

Expected: PASS.

- [ ] **Step 7: Add failed-run log artifact coverage**

In `tests/test_backend_api_contract.py`, extend existing failed compile/executor tests or add:

```python
def test_run_service_failed_compile_run_has_downloadable_log_artifact(self) -> None:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "blocked aviation"})

    submitted = self.api.submit_run({
        "project_id": saved["project_id"],
        "experiment_plan_id": plan["experiment_plan_id"],
        "model_family": "aviation_support",
        "run_type": "single",
    })
    manifest = self.api.get_run_artifacts(submitted["run_id"])
    log_artifacts = [artifact for artifact in manifest["artifacts"] if artifact["kind"] == "log"]

    self.assertEqual(submitted["status"], "failed")
    self.assertEqual(len(log_artifacts), 1)
    self.assertRegex(log_artifacts[0]["sha256"], r"^[0-9a-f]{64}$")
    self.assertGreater(log_artifacts[0]["size_bytes"], 0)
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_failed_compile_run_has_downloadable_log_artifact
```

Expected: FAIL until `RunService` writes and registers failed-run log artifacts.

- [ ] **Step 8: Implement failed-run log artifact creation in `RunService`**

In `src/spare_mvp_backend/run_service.py`, add a helper that writes JSON under `self.output_dir / run_id` and returns a manifest entry:

```python
def _write_run_log_artifact(self, run_id: str, manifest_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    run_dir = self.output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    target = run_dir / "events-log.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    data = target.read_bytes()
    return {
        "artifact_id": f"log-{run_id}",
        "kind": "log",
        "path": target.relative_to(self.output_dir).as_posix(),
        "media_type": "application/json",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
        "schema_version": "run-log-v0",
    }
```

In `_persist_failed_run()`, replace the empty artifact list assignment with this code after both `run` and `manifest` dictionaries have been constructed:

```python
log_payload = {
    "schema_version": "run-log-v0",
    "run_id": run_id,
    "status": "failed",
    "project_id": run["project_id"],
    "experiment_plan_id": experiment_plan_id,
    "modeling_snapshot_id": modeling_snapshot_id,
    "scenario_id": scenario.get("scenario_id"),
    "scenario_version": scenario.get("scenario_version"),
    "model_family": run["model_family"],
    "run_type": run_type,
    "events": [
        {
            "event": "run_failed",
            "at": now,
            "error": run["error"],
        }
    ],
}
log_artifact = self._write_run_log_artifact(run_id, manifest_id, log_payload)
manifest["artifacts"] = [log_artifact]
```

In `_persist_failed_compile_run()`, replace the empty artifact list assignment with this code after both `run` and `manifest` dictionaries have been constructed:

```python
log_payload = {
    "schema_version": "run-log-v0",
    "run_id": run_id,
    "status": "failed",
    "project_id": project_id,
    "experiment_plan_id": experiment_plan_id,
    "modeling_snapshot_id": modeling_snapshot_id,
    "scenario_id": None,
    "scenario_version": None,
    "model_family": model_family,
    "run_type": run_type,
    "events": [
        {
            "event": "compile_gate_failed",
            "at": now,
            "error": run["error"],
            "issues": issues,
            "provenance": provenance,
        }
    ],
}
log_artifact = self._write_run_log_artifact(run_id, manifest_id, log_payload)
manifest["artifacts"] = [log_artifact]
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_run_service_failed_compile_run_has_downloadable_log_artifact
```

Expected: PASS.

- [ ] **Step 9: Run focused artifact ledger tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract
```

Expected: PASS. Any failure that changes metric values or M6.2 projection semantics means the task exceeded M7.0 scope.

## Task 2: Repository, API, and HTTP M7 Management Interfaces

**Files:**
- Modify: `contracts/run.schema.json`
- Modify: `src/spare_mvp_backend/schema.sql`
- Modify: `src/spare_mvp_backend/repository.py`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Modify: `tests/test_database_contract.py`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `tests/test_backend_http_api.py`

**Non-goals:** Do not add physical file deletion, object storage, queue status transitions beyond existing status envelope, cancel/retry execution, or new broad authorization roles.

- [ ] **Step 1: Add failing repository lifecycle tests**

In `tests/test_database_contract.py`, add:

```python
def _persist_complete_smoke_chain(self) -> None:
    project = self._fixture("smoke_project.json")
    run = self._fixture("smoke_run.json")
    result = self._fixture("smoke_result.json")
    manifest = self._fixture("smoke_artifact_manifest.json")
    scenario = self._fixture("smoke_scenario.json")
    snapshot = {
        "snapshot_id": "modeling-snapshot-project-smoke-contract-001",
        "project_id": project["project_id"],
        "schema_version": "modeling-snapshot-v0",
        "project_version": project["project_version"],
        "project": project,
    }
    plan = {
        "experiment_plan_id": "experiment-plan-project-smoke-contract-001",
        "project_id": project["project_id"],
        "modeling_snapshot_id": snapshot["snapshot_id"],
        "schema_version": "experiment-plan-v0",
        "project_version": project["project_version"],
        "status": "draft",
        "config": {"name": "contract smoke", "steps": 3},
    }
    run = {
        **run,
        "experiment_plan_id": plan["experiment_plan_id"],
        "modeling_snapshot_id": snapshot["snapshot_id"],
        "lifecycle_status": "active",
        "created_by": "system",
    }
    self.repository.upsert_project(project)
    self.repository.upsert_modeling_snapshot(snapshot)
    self.repository.upsert_experiment_plan(plan)
    self.repository.upsert_scenario(scenario)
    self.repository.upsert_run(run)
    self.repository.upsert_result_summary(result)
    self.repository.upsert_artifact_manifest(manifest)

def test_repository_lists_runs_and_hides_soft_deleted_by_default(self) -> None:
    run = self._fixture("smoke_run.json")
    manifest = self._fixture("smoke_artifact_manifest.json")
    self.repository.upsert_run({**run, "lifecycle_status": "active", "created_by": "system"})
    self.repository.upsert_artifact_manifest(manifest)

    self.assertEqual([item["run_id"] for item in self.repository.list_runs()], [run["run_id"]])
    deleted = self.repository.soft_delete_run(run["run_id"], deleted_by="system")

    self.assertEqual(deleted["lifecycle_status"], "deleted")
    self.assertEqual(self.repository.list_runs(), [])
    self.assertEqual([item["run_id"] for item in self.repository.list_runs(include_deleted=True)], [run["run_id"]])

def test_repository_get_run_detail_combines_chain_result_and_artifacts(self) -> None:
    self._persist_complete_smoke_chain()
    detail = self.repository.get_run_detail("run-smoke-contract-001")

    self.assertEqual(detail["run"]["run_id"], "run-smoke-contract-001")
    self.assertEqual(detail["chain"]["run_id"], "run-smoke-contract-001")
    self.assertEqual(detail["result_summary"]["run_id"], "run-smoke-contract-001")
    self.assertEqual(detail["artifact_manifest"]["run_id"], "run-smoke-contract-001")
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract
```

Expected: FAIL because list/detail/lifecycle repository methods do not exist.

- [ ] **Step 2: Add schema and migration support**

In `contracts/run.schema.json`, add optional properties:

```json
"created_by": { "type": "string" },
"lifecycle_status": { "type": "string", "enum": ["active", "archived", "deleted"] },
"archived_at": { "type": ["string", "null"] },
"archived_by": { "type": ["string", "null"] },
"deleted_at": { "type": ["string", "null"] },
"deleted_by": { "type": ["string", "null"] },
"run_config": { "type": "object", "additionalProperties": true }
```

In `src/spare_mvp_backend/schema.sql`, extend `simulation_runs` with query columns:

```sql
created_by TEXT,
lifecycle_status TEXT NOT NULL DEFAULT 'active',
archived_at TEXT,
deleted_at TEXT,
```

In `src/spare_mvp_backend/repository.py`, add these calls inside `initialize_database()` after `_relax_simulation_run_scenario_constraints(connection)`:

```python
_ensure_column(connection, "simulation_runs", "created_by", "TEXT")
_ensure_column(connection, "simulation_runs", "lifecycle_status", "TEXT NOT NULL DEFAULT 'active'")
_ensure_column(connection, "simulation_runs", "archived_at", "TEXT")
_ensure_column(connection, "simulation_runs", "deleted_at", "TEXT")
connection.execute(
    """
    UPDATE simulation_runs
    SET lifecycle_status = 'active'
    WHERE lifecycle_status IS NULL OR lifecycle_status = ''
    """
)
```

Update `ContractRepository.upsert_run()` so the `simulation_runs` insert, conflict update, and parameter tuple include `created_by`, `lifecycle_status`, `archived_at`, and `deleted_at` from the run payload. Use `run.get("created_by") or "system"` and `run.get("lifecycle_status") or "active"` when writing the query columns.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract.DatabaseContractTest.test_database_schema_contains_contract_tables
```

Expected: PASS with the new columns present in schema inspection.

- [ ] **Step 3: Implement repository list/detail/lifecycle helpers**

In `src/spare_mvp_backend/repository.py`, add `from datetime import datetime, timezone` at the top, then add these complete methods to `ContractRepository`:

```python
    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def list_runs(
        self,
        *,
        include_deleted: bool = False,
        project_id: str | None = None,
        experiment_plan_id: str | None = None,
        run_type: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 200))
        clauses: list[str] = []
        params: list[Any] = []
        if not include_deleted:
            clauses.append("COALESCE(lifecycle_status, 'active') != ?")
            params.append("deleted")
        if project_id:
            clauses.append("project_id = ?")
            params.append(project_id)
        if experiment_plan_id:
            clauses.append("experiment_plan_id = ?")
            params.append(experiment_plan_id)
        if run_type:
            clauses.append("run_type = ?")
            params.append(run_type)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor = self.connection.execute(
            f"""
            SELECT payload_json
            FROM simulation_runs
            {where}
            ORDER BY COALESCE(updated_at, created_at) DESC, run_id DESC
            LIMIT ?
            """,
            (*params, safe_limit),
        )
        runs: list[dict[str, Any]] = []
        for (payload_json,) in cursor.fetchall():
            run = json.loads(payload_json)
            lifecycle_status = run.get("lifecycle_status") or "active"
            artifact_count = 0
            artifact_manifest_id = run.get("artifact_manifest_id")
            if artifact_manifest_id:
                artifact_cursor = self.connection.execute(
                    """
                    SELECT payload_json
                    FROM artifact_manifests
                    WHERE artifact_manifest_id = ?
                      AND run_id = ?
                    """,
                    (artifact_manifest_id, run["run_id"]),
                )
                artifact_row = artifact_cursor.fetchone()
                if artifact_row is not None:
                    artifact_count = len(json.loads(artifact_row[0]).get("artifacts") or [])
            runs.append(
                {
                    "run_id": run["run_id"],
                    "project_id": run["project_id"],
                    "experiment_plan_id": run.get("experiment_plan_id"),
                    "run_type": run.get("run_type") or "single",
                    "model_family": run["model_family"],
                    "status": run["status"],
                    "phase": run.get("phase"),
                    "seed": run.get("seed"),
                    "created_by": run.get("created_by") or "system",
                    "queued_at": run.get("queued_at"),
                    "started_at": run.get("started_at"),
                    "completed_at": run.get("completed_at"),
                    "lifecycle_status": lifecycle_status,
                    "artifact_count": artifact_count,
                    "artifact_manifest_id": artifact_manifest_id,
                }
            )
        return runs

    def get_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        chain = self.get_run_chain(run_id)
        result_summary = None
        if run.get("result_summary_id"):
            result_summary = self.get_result_summary_for_run(run_id)
        artifact_manifest = self.get_artifact_manifest_for_run(run_id)
        return {
            "run": run,
            "chain": chain,
            "result_summary": result_summary,
            "artifact_manifest": artifact_manifest,
        }

    def archive_run(self, run_id: str, *, archived_by: str = "system") -> dict[str, Any]:
        run = self.get_run(run_id)
        now = self._utc_now()
        run["lifecycle_status"] = "archived"
        run["archived_at"] = run.get("archived_at") or now
        run["archived_by"] = archived_by
        self.upsert_run(run)
        return self.get_run(run_id)

    def soft_delete_run(self, run_id: str, *, deleted_by: str = "system") -> dict[str, Any]:
        run = self.get_run(run_id)
        now = self._utc_now()
        run["lifecycle_status"] = "deleted"
        run["deleted_at"] = run.get("deleted_at") or now
        run["deleted_by"] = deleted_by
        self.upsert_run(run)
        return self.get_run(run_id)

    def find_artifact_for_run(self, run_id: str, artifact_id: str) -> dict[str, Any]:
        manifest = self.get_artifact_manifest_for_run(run_id)
        for artifact in manifest.get("artifacts") or []:
            if artifact.get("artifact_id") == artifact_id:
                return artifact
        raise KeyError(artifact_id)
```

Implementation requirements for the worker reviewing the snippet:

- `list_runs()` filters deleted rows in SQL with `COALESCE(lifecycle_status, 'active') != 'deleted'` before `LIMIT`, reads `simulation_runs.payload_json`, sorts newest first by `updated_at` / `created_at` / `run_id`, and adds `artifact_count` from manifest payload when available.
- `get_run_detail()` returns `{"run": run, "chain": chain, "result_summary": result_or_none, "artifact_manifest": manifest}`. A missing result summary is allowed for failed runs with `result_summary_id is None`.
- `archive_run()` sets payload fields `lifecycle_status="archived"`, `archived_at`, `archived_by`, then calls `upsert_run()`.
- `soft_delete_run()` sets payload fields `lifecycle_status="deleted"`, `deleted_at`, `deleted_by`, then calls `upsert_run()`.
- `find_artifact_for_run()` only searches the manifest for the same `run_id` and exact `artifact_id`.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract
```

Expected: PASS for repository lifecycle tests. Existing mismatch tests must still fail closed if a run references another run's manifest.

- [ ] **Step 4: Add API-level artifact download safety tests**

In `tests/test_backend_api_contract.py`, add tests:

```python
def _submit_successful_smoke_run(self) -> dict[str, Any]:
    project = self._fixture("smoke_project.json")
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m7 artifact download", "steps": 2})
    return self.api.submit_run(
        {
            "project_id": saved["project_id"],
            "experiment_plan_id": plan["experiment_plan_id"],
            "model_family": "smoke",
            "run_type": "single",
        }
    )

def test_backend_api_resolves_artifact_download_with_hash_verification(self) -> None:
    run = self._submit_successful_smoke_run()
    manifest = self.api.get_run_artifacts(run["run_id"])
    artifact = manifest["artifacts"][0]

    download = self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"])

    self.assertEqual(download["artifact"]["artifact_id"], artifact["artifact_id"])
    self.assertTrue(download["path"].is_file())
    self.assertEqual(download["content_type"], artifact["media_type"])

def test_backend_api_rejects_artifact_path_escape(self) -> None:
    run = self._submit_successful_smoke_run()
    manifest = self.api.get_run_artifacts(run["run_id"])
    manifest["artifacts"][0]["path"] = "../escape.json"
    self.repository.upsert_artifact_manifest(manifest)

    with self.assertRaises(BackendApiError) as ctx:
        self.api.get_run_artifact_download(run["run_id"], manifest["artifacts"][0]["artifact_id"])

    self.assertEqual(ctx.exception.code, "artifact_path_escape")

def test_backend_api_rejects_artifact_hash_mismatch(self) -> None:
    run = self._submit_successful_smoke_run()
    manifest = self.api.get_run_artifacts(run["run_id"])
    artifact = manifest["artifacts"][0]
    target = Path(self.api.output_dir) / artifact["path"]
    target.write_text('{"tampered": true}\n', encoding="utf-8")

    with self.assertRaises(BackendApiError) as ctx:
        self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"])

    self.assertEqual(ctx.exception.code, "artifact_hash_mismatch")
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: FAIL because API download helpers do not exist.

- [ ] **Step 5: Implement API management methods**

In `src/spare_mvp_backend/api.py`, add:

```python
def list_runs(self, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    filters = filters or {}
    return {"runs": self.repository.list_runs(
        include_deleted=_truthy_query_flag(filters.get("include_deleted")),
        project_id=filters.get("project_id"),
        experiment_plan_id=filters.get("experiment_plan_id"),
        run_type=filters.get("run_type"),
        status=filters.get("status"),
        limit=_clamped_run_limit(filters.get("limit")),
    )}

def get_run_detail(self, run_id: str) -> dict[str, Any]:
    detail = self.repository.get_run_detail(run_id)
    detail["download_base"] = f"/api/runs/{run_id}/artifacts"
    return detail

def archive_run(self, run_id: str, actor_user_id: str = "system") -> dict[str, Any]:
    archived = self.repository.archive_run(run_id, archived_by=actor_user_id)
    self.repository.insert_audit_event(
        actor_user_id=actor_user_id,
        action="runs.archive",
        resource_type="run",
        resource_id=run_id,
        outcome="allowed",
        details={"lifecycle_status": archived.get("lifecycle_status")},
    )
    return archived

def soft_delete_run(self, run_id: str, actor_user_id: str = "system") -> dict[str, Any]:
    deleted = self.repository.soft_delete_run(run_id, deleted_by=actor_user_id)
    self.repository.insert_audit_event(
        actor_user_id=actor_user_id,
        action="runs.delete",
        resource_type="run",
        resource_id=run_id,
        outcome="allowed",
        details={"lifecycle_status": deleted.get("lifecycle_status")},
    )
    return deleted
```

Add `get_run_artifact_download()`:

```python
def get_run_artifact_download(self, run_id: str, artifact_id: str) -> dict[str, Any]:
    run = self.repository.get_run(run_id)
    if run.get("lifecycle_status") == "deleted":
        raise BackendApiError("run_deleted", "run is soft-deleted", run_id=run_id)
    artifact = self.repository.find_artifact_for_run(run_id, artifact_id)
    relative_path = Path(str(artifact["path"]))
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise BackendApiError("artifact_path_escape", "artifact path escapes output directory", artifact_id=artifact_id)
    output_root = Path(self.output_dir).resolve()
    target = (output_root / relative_path).resolve()
    if output_root not in target.parents and target != output_root:
        raise BackendApiError("artifact_path_escape", "artifact path escapes output directory", artifact_id=artifact_id)
    if not target.is_file():
        raise BackendApiError("artifact_missing", "artifact file is missing", artifact_id=artifact_id)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != artifact.get("sha256"):
        raise BackendApiError("artifact_hash_mismatch", "artifact file hash does not match manifest", artifact_id=artifact_id)
    self.repository.insert_audit_event(
        actor_user_id="system",
        action="runs.artifact.download",
        resource_type="run",
        resource_id=run_id,
        outcome="allowed",
        details={"artifact_id": artifact_id, "sha256": digest, "size_bytes": artifact.get("size_bytes")},
    )
    return {
        "path": target,
        "artifact": artifact,
        "content_type": artifact.get("media_type") or "application/octet-stream",
        "filename": target.name,
    }
```

Add these helpers near the bottom of `src/spare_mvp_backend/api.py`:

```python
def _truthy_query_flag(value: Any) -> bool:
    return value is True or value in {"1", "true", "True"}

def _clamped_run_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 50
    return max(1, min(parsed, 200))
```

Runtime audit boundary: `archive_run()`, `soft_delete_run()`, and successful `get_run_artifact_download()` write `audit_events` with actor, timestamp from repository insertion, action, resource, and outcome. `list_runs()` and `get_run_detail()` do not write audit events.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: PASS for API management and existing run contract tests.

- [ ] **Step 6: Add failing HTTP route tests**

In `tests/test_backend_http_api.py`, add this helper and tests inside `BackendHttpApiTest`:

```python
def _submit_m7_http_run(self, base_url: str) -> dict:
    created = self._create_imported_sample_project(base_url)
    saved = created["savedProject"]
    plan = self._json(
        base_url,
        "POST",
        f"/projects/{saved['project_id']}/experiment-plans",
        {"config": {"name": "m7 http management", "steps": 2, "projectJson": created["project"]}},
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
    return {"created": created, "plan": plan, "run": submitted}

def test_http_m7_run_list_detail_archive_delete_and_legacy_retirement(self) -> None:
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
            submitted = self._submit_m7_http_run(base_url)
            run_id = submitted["run"]["run_id"]
            admin_token = self._login_token(base_url, "admin", "admin")

            listed = self._json(base_url, "GET", "/runs")
            self.assertIn(run_id, [item["run_id"] for item in listed["runs"]])

            detail = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/detail")
            self.assertEqual(detail["run"]["run_id"], run_id)
            self.assertEqual(detail["chain"]["run_id"], run_id)
            self.assertEqual(detail["artifact_manifest"]["run_id"], run_id)
            self.assertEqual(detail["download_base"], f"/api/runs/{run_id}/artifacts")
            audit_before_lifecycle = self._json(
                base_url,
                "GET",
                f"/audit-events?resource_id={quote(run_id, safe='')}",
                auth_token=admin_token,
            )
            self.assertEqual(audit_before_lifecycle["events"], [])

            archive = self._json(base_url, "POST", f"/runs/{quote(run_id, safe='')}/archive")
            self.assertEqual(archive["run_id"], run_id)
            self.assertEqual(archive["lifecycle_status"], "archived")

            deleted = self._json(base_url, "DELETE", f"/runs/{quote(run_id, safe='')}")
            self.assertEqual(deleted["run_id"], run_id)
            self.assertEqual(deleted["lifecycle_status"], "deleted")

            hidden = self._json(base_url, "GET", "/runs")
            self.assertNotIn(run_id, [item["run_id"] for item in hidden["runs"]])
            hidden_zero = self._json(base_url, "GET", "/runs?include_deleted=0")
            self.assertNotIn(run_id, [item["run_id"] for item in hidden_zero["runs"]])

            visible = self._json(base_url, "GET", "/runs?include_deleted=1")
            self.assertIn(run_id, [item["run_id"] for item in visible["runs"]])
            tombstone = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/detail")
            self.assertEqual(tombstone["run"]["lifecycle_status"], "deleted")

            audit_after_lifecycle = self._json(
                base_url,
                "GET",
                f"/audit-events?resource_id={quote(run_id, safe='')}",
                auth_token=admin_token,
            )
            actions = [event["action"] for event in audit_after_lifecycle["events"]]
            self.assertIn("runs.archive", actions)
            self.assertIn("runs.delete", actions)
            self.assertTrue(all(event["outcome"] == "allowed" for event in audit_after_lifecycle["events"]))
            self.assertTrue(all(event["actor_user_id"] == "system" for event in audit_after_lifecycle["events"]))
            self.assertTrue(all(event["created_at"] for event in audit_after_lifecycle["events"]))

            legacy_status, legacy_body = self._json_error_with_status(base_url, "POST", "/simulation-runs", {})
            self.assertEqual(legacy_status, 410)
            self.assertEqual(legacy_body["code"], "legacy_run_api_retired")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

def test_http_m7_artifact_download_and_deleted_run_rejection(self) -> None:
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
            submitted = self._submit_m7_http_run(base_url)
            run_id = submitted["run"]["run_id"]
            manifest = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/artifacts")
            artifact = manifest["artifacts"][0]

            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            connection.request("GET", f"/api/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}")
            response = connection.getresponse()
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertIn(artifact["media_type"], response.headers["content-type"])
            self.assertIn("attachment", response.headers["content-disposition"])
            self.assertGreater(len(body), 0)
            connection.close()
            admin_token = self._login_token(base_url, "admin", "admin")
            audit_after_download = self._json(
                base_url,
                "GET",
                f"/audit-events?resource_id={quote(run_id, safe='')}",
                auth_token=admin_token,
            )
            download_events = [
                event for event in audit_after_download["events"] if event["action"] == "runs.artifact.download"
            ]
            self.assertEqual(len(download_events), 1)
            self.assertEqual(download_events[0]["actor_user_id"], "system")
            self.assertEqual(download_events[0]["outcome"], "allowed")
            self.assertTrue(download_events[0]["created_at"])

            self._json(base_url, "DELETE", f"/runs/{quote(run_id, safe='')}")
            status, payload = self._json_error_with_status(
                base_url,
                "GET",
                f"/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}",
            )
            self.assertEqual(status, 410)
            self.assertEqual(payload["code"], "run_deleted")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: FAIL because HTTP routes and file response support do not exist.

- [ ] **Step 7: Implement HTTP routes and binary response**

In `src/spare_mvp_backend/http_server.py`:

- Add a DELETE handler beside the existing GET and POST handlers:

```python
def do_DELETE(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
    self._handle()
```

- In `_handle()`, replace the current unconditional `self._send_json(200, payload)` after `payload = self._dispatch()` with marker-aware control flow:

```python
payload = self._dispatch()
if isinstance(payload, dict) and "__file_download__" in payload:
    self._send_file_download(200, payload["__file_download__"])
else:
    self._send_json(200, payload)
```

- Add `parse_qs` to the existing urllib import:

```python
from urllib.parse import parse_qs, unquote, urlparse
```

- Parse query string for `GET /api/runs` with `urllib.parse.parse_qs`, preserving string values for `_truthy_query_flag()`:

```python
if self.command == "GET" and route == "/runs":
    query = parse_qs(urlparse(self.path).query)
    filters = {key: values[-1] for key, values in query.items() if values}
    return api.list_runs(filters)
```

- Route `GET /api/runs/{id}/detail` to `api.get_run_detail(id)`.
- Route `POST /api/runs/{id}/archive` to `api.archive_run(id, actor_user_id="system")`.
- Route `DELETE /api/runs/{id}` to `api.soft_delete_run(id, actor_user_id="system")`.

In `_dispatch()`, return a file response marker for single-artifact downloads:

```python
if self.command == "GET" and len(parts) == 4 and parts[0] == "runs" and parts[2] == "artifacts":
    return {"__file_download__": api.get_run_artifact_download(parts[1], parts[3])}
```

Add `_send_file_download()` to the request handler:

```python
def _send_file_download(self, status: int, download: dict[str, Any]) -> None:
    data = Path(download["path"]).read_bytes()
    self.send_response(status)
    self.send_header("content-type", str(download["content_type"]))
    self.send_header("content-length", str(len(data)))
    self.send_header("content-disposition", f'attachment; filename="{download["filename"]}"')
    self.send_header("access-control-allow-origin", "*")
    self.end_headers()
    self.wfile.write(data)
```

Map `BackendApiError("run_deleted")` to HTTP 410 in the existing `BackendApiError` block.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: PASS.

## Task 3: Frontend API Client and Run Artifact UI

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- No change: `front/feature-catalog.mjs`

**Non-goals:** Do not parse projection artifact payloads for KPI cards. Do not add cancel/retry controls. Do not use legacy `/api/simulation-runs`.

- [ ] **Step 1: Add failing API client tests**

In `tests/frontend-api-client.test.mjs`, add:

```javascript
test("frontend API client exposes M7 run artifact management routes", async () => {
  const calls = [];
  const requests = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      requests.push(request);
      calls.push(`${request.method} ${request.path}`);
      if (request.path === "/runs") return { runs: [{ run_id: "run-ui" }] };
      if (request.path === "/runs/run-ui/detail") return { run: { run_id: "run-ui" }, artifact_manifest: { artifacts: [] } };
      if (request.path === "/runs/run-ui/artifacts/artifact-ui") return { ok: true, artifact_id: "artifact-ui" };
      if (request.path === "/runs/run-ui/archive") return { run_id: "run-ui", lifecycle_status: "archived" };
      if (request.path === "/runs/run-ui") return { run_id: "run-ui", lifecycle_status: "deleted" };
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  await client.listRuns();
  await client.getRunDetail("run-ui");
  await client.downloadRunArtifact("run-ui", "artifact-ui");
  await client.archiveRun("run-ui");
  await client.deleteRun("run-ui");

  assert.deepEqual(calls, [
    "GET /runs",
    "GET /runs/run-ui/detail",
    "GET /runs/run-ui/artifacts/artifact-ui",
    "POST /runs/run-ui/archive",
    "DELETE /runs/run-ui"
  ]);
  const downloadRequest = requests.find((request) => request.path === "/runs/run-ui/artifacts/artifact-ui");
  assert.equal(downloadRequest.responseType, "blob");
});
```

Run:

```bash
npm test -- frontend-api-client.test.mjs
```

Expected: FAIL because the client methods do not exist.

- [ ] **Step 2: Add client methods**

In `front/api-client.mjs`, add methods beside existing run methods:

```javascript
listRuns(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request({ method: "GET", path: `/runs${suffix}` });
},
getRunDetail(runId) {
  return request({ method: "GET", path: `/runs/${encodeURIComponent(runId)}/detail` });
},
downloadRunArtifact(runId, artifactId) {
  return request({
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
    responseType: "blob"
  });
},
archiveRun(runId) {
  return request({ method: "POST", path: `/runs/${encodeURIComponent(runId)}/archive` });
},
deleteRun(runId) {
  return request({ method: "DELETE", path: `/runs/${encodeURIComponent(runId)}` });
}
```

Replace the current `createFetchTransport()` body with this complete implementation so `responseType` is accepted before the JSON parse path:

```javascript
function createFetchTransport(baseUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async ({ method, path, body, headers = {}, responseType = "json" }) => {
    if (typeof fetch !== "function") {
      throw new Error("Backend API fetch transport is unavailable");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestHeaders = Object.assign(
      {},
      headers,
      body === undefined ? {} : { "content-type": "application/json" }
    );
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: Object.keys(requestHeaders).length === 0 ? undefined : requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      const error = new Error(
        timedOut
          ? `Backend API request timed out after ${timeoutMs}ms`
          : `Backend API network request failed: ${err && err.message ? err.message : "unknown error"}`
      );
      error.code = timedOut ? "backend_request_timeout" : "backend_network_error";
      error.details = { method, path, timeoutMs };
      error.cause = err;
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (responseType === "blob" && response.ok) {
      return response.blob();
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || `Backend API HTTP ${response.status}`);
      error.code = payload?.code;
      error.details = payload?.details || {};
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  };
}
```

Keep the test transport shape above valid: the unit test transport returns a plain object for the same method call, and the production fetch transport returns a `Blob`.

Run:

```bash
npm test -- frontend-api-client.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Add frontend contract tests for visible M7 controls**

In `tests/frontend-contract.test.mjs`, add source-level assertions:

```javascript
test("M7 run artifact panel renders artifact identity and lifecycle controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  assert.match(appSource, /listRuns\(/);
  assert.match(appSource, /getRunDetail\(/);
  assert.match(appSource, /downloadRunArtifact\(/);
  assert.match(appSource, /archiveRun\(/);
  assert.match(appSource, /deleteRun\(/);
  assert.match(appSource, /artifact_id/);
  assert.match(appSource, /sha256/);
  assert.match(appSource, /size_bytes/);
  assert.match(appSource, /data-action="m7-archive-run"/);
  assert.match(appSource, /data-action="m7-delete-run"/);
  assert.match(appSource, /lifecycle_status/);
  assert.match(appSource, /URL\.createObjectURL/);
  assert.match(appSource, /anchor\.download/);
  assert.doesNotMatch(appSource, /\/api\/simulation-runs/);
});
```

Run:

```bash
npm test -- frontend-contract.test.mjs
```

Expected: FAIL until `front/app.js` renders the M7 surface.

- [ ] **Step 4: Implement the Monte Carlo detail run-artifact section**

In `front/app.js`, extend the existing Monte Carlo experiment detail view. Add `renderRunArtifactManagementSection()` immediately below the current `.backend-run-chain` identity chain and artifact table in the Monte Carlo detail render path. Do not add a new navigation key, and do not modify `front/feature-catalog.mjs`.

The render output must include columns:

```text
run_id
status
lifecycle_status
artifact_id
kind
path
sha256
size_bytes
```

Add state:

```javascript
let runArtifactList = [];
let selectedRunDetail = null;
let runArtifactStatus = "";
```

Add actions:

```javascript
async function refreshRunArtifactList() {
  const payload = await backendApi.listRuns();
  runArtifactList = payload.runs || [];
}

async function openRunDetail(runId) {
  selectedRunDetail = await backendApi.getRunDetail(runId);
}

async function downloadSelectedArtifact(runId, artifactId) {
  const blob = await backendApi.downloadRunArtifact(runId, artifactId);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${artifactId}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
  runArtifactStatus = `artifact downloaded: ${artifactId}`;
}

async function archiveSelectedRun(runId) {
  await backendApi.archiveRun(runId);
  await refreshRunArtifactList();
  selectedRunDetail = await backendApi.getRunDetail(runId);
}

async function deleteSelectedRun(runId) {
  await backendApi.deleteRun(runId);
  await refreshRunArtifactList();
  selectedRunDetail = await backendApi.getRunDetail(runId);
}
```

Add this render function in `front/app.js` near the existing Monte Carlo detail render helpers:

```javascript
function renderRunArtifactManagementSection() {
  const runs = runArtifactList || [];
  const detail = selectedRunDetail || {};
  const selectedRun = detail.run || {};
  const manifest = detail.artifact_manifest || backendArtifactManifest || { artifacts: [] };
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const runRows = runs.map((run) => `
    <tr>
      <td>${htmlEscape(run.run_id || "")}</td>
      <td>${htmlEscape(run.status || "")}</td>
      <td>${htmlEscape(run.lifecycle_status || "active")}</td>
      <td>${htmlEscape(run.run_type || "")}</td>
      <td>${htmlEscape(run.artifact_manifest_id || "")}</td>
      <td>
        <button type="button" data-action="m7-open-run-detail" data-run-id="${htmlEscape(run.run_id || "")}">详情</button>
        <button type="button" data-action="m7-archive-run" data-run-id="${htmlEscape(run.run_id || "")}">归档</button>
        <button type="button" data-action="m7-delete-run" data-run-id="${htmlEscape(run.run_id || "")}">软删除</button>
      </td>
    </tr>
  `).join("");
  const artifactRows = artifacts.map((artifact) => `
    <tr>
      <td>${htmlEscape(artifact.artifact_id || "")}</td>
      <td>${htmlEscape(artifact.kind || "")}</td>
      <td>${htmlEscape(artifact.path || "")}</td>
      <td>${htmlEscape(artifact.sha256 || "")}</td>
      <td>${htmlEscape(String(artifact.size_bytes ?? ""))}</td>
      <td>
        <button
          type="button"
          data-action="m7-download-artifact"
          data-run-id="${htmlEscape(selectedRun.run_id || backendRun?.run_id || "")}"
          data-artifact-id="${htmlEscape(artifact.artifact_id || "")}"
        >下载</button>
      </td>
    </tr>
  `).join("");
  return `
    <section class="m7-run-artifact-management">
      <div class="section-heading">
        <h3>运行与产物</h3>
        <button type="button" data-action="m7-refresh-runs">刷新运行</button>
      </div>
      <p>${htmlEscape(runArtifactStatus || "运行产物按 artifact_id 下载；软删除只更新 tombstone，不物理删除文件。")}</p>
      <table>
        <thead>
          <tr><th>run_id</th><th>status</th><th>lifecycle_status</th><th>run_type</th><th>artifact_manifest_id</th><th>操作</th></tr>
        </thead>
        <tbody>${runRows || `<tr><td colspan="6">暂无运行记录</td></tr>`}</tbody>
      </table>
      <table>
        <thead>
          <tr><th>artifact_id</th><th>kind</th><th>path</th><th>sha256</th><th>size_bytes</th><th>操作</th></tr>
        </thead>
        <tbody>${artifactRows || `<tr><td colspan="6">等待选择 run detail</td></tr>`}</tbody>
      </table>
    </section>
  `;
}
```

Call it from the existing Monte Carlo detail render path immediately after the `.backend-run-chain` section:

```javascript
${renderRunArtifactManagementSection()}
```

In `front/app.js`, first change the click listener in `bindEvents()` to an async handler:

```javascript
app.addEventListener("click", async (event) => {
```

Then add this block near the top of that click handler, before the domain-specific button handlers:

```javascript
const m7ActionButton = event.target.closest("[data-action^='m7-']");
if (m7ActionButton) {
  const action = m7ActionButton.dataset.action;
  const runId = m7ActionButton.dataset.runId || "";
  const artifactId = m7ActionButton.dataset.artifactId || "";
  if (action === "m7-refresh-runs") {
    await refreshRunArtifactList();
    render();
    return;
  }
  if (action === "m7-open-run-detail") {
    await openRunDetail(runId);
    render();
    return;
  }
  if (action === "m7-download-artifact") {
    await downloadSelectedArtifact(runId, artifactId);
    render();
    return;
  }
  if (action === "m7-archive-run") {
    await archiveSelectedRun(runId);
    render();
    return;
  }
  if (action === "m7-delete-run") {
    await deleteSelectedRun(runId);
    render();
    return;
  }
}
```

Run:

```bash
npm test -- frontend-contract.test.mjs
```

Expected: PASS for source contract tests.

- [ ] **Step 5: Update browser smoke**

In `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`, call the M7 smoke check after `const afterRefresh = await readBackendEvidence(page);` and after `assertHasIdentityChain(afterRefresh.chain, "after refresh");`:

```javascript
await verifyM7RunArtifactManagement(page, afterRefresh.chain.Run);
```

Add this helper near `readBackendEvidence(page)`:

```javascript
async function verifyM7RunArtifactManagement(page, runId) {
  const refreshRunsButton = page.locator('[data-action="m7-refresh-runs"]');
  await refreshRunsButton.click();
  await page.waitForFunction(
    (expectedRunId) => document.querySelector(".m7-run-artifact-management")?.innerText.includes(expectedRunId),
    runId,
    { timeout: 5000 }
  );
  const openRunDetailButton = page.locator(`button[data-action="m7-open-run-detail"][data-run-id="${runId}"]`);
  await openRunDetailButton.click();
  await page.waitForFunction(() => {
    const section = document.querySelector(".m7-run-artifact-management");
    if (!section) return false;
    const text = section.innerText;
    return text.includes("artifact_id")
      && text.includes("sha256")
      && text.includes("size_bytes")
      && /[0-9a-f]{64}/.test(text);
  }, null, { timeout: 5000 });
  const artifactButton = page.locator('.m7-run-artifact-management button[data-action="m7-download-artifact"][data-artifact-id]').first();
  const artifactId = await artifactButton.getAttribute("data-artifact-id");
  if (!artifactId) {
    throw new Error("M7 smoke could not find a downloadable artifact_id");
  }
  const downloadEventPromise = page.waitForEvent("download");
  await artifactButton.click();
  const download = await downloadEventPromise;
  if (!download.suggestedFilename().includes(artifactId)) {
    throw new Error(`M7 artifact download filename did not include ${artifactId}: ${download.suggestedFilename()}`);
  }
  const archiveRunButton = page.locator(`button[data-action="m7-archive-run"][data-run-id="${runId}"]`);
  await archiveRunButton.click();
  await page.waitForFunction(() => {
    const section = document.querySelector(".m7-run-artifact-management");
    return section?.innerText.includes("archived");
  }, null, { timeout: 5000 });
  const deleteRunButton = page.locator(`button[data-action="m7-delete-run"][data-run-id="${runId}"]`);
  await deleteRunButton.click();
  await page.waitForFunction(() => {
    const section = document.querySelector(".m7-run-artifact-management");
    return section?.innerText.includes("deleted");
  }, null, { timeout: 5000 });
}
```

Run:

```bash
npm test
```

Expected: PASS for frontend tests. Browser smoke execution is verified in Task 5.

## Task 4: Documentation Sync and Audit Report

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Create: `reports/2026-06-21-m7-0-run-artifact-management-audit/README.md`

**Non-goals:** Do not rewrite older M6 design docs except for links if required by docs index conventions. Do not claim production queue/object storage/cancel-retry/M8/M9/aviation_support work is complete.

- [ ] **Step 1: Update top-level docs**

Add M7.0 wording:

- `README.md`: add current status bullet for run/artifact management and link to this plan/spec.
- `docs/README.md`: add plan/spec links under active planning docs.
- `docs/product-roadmap.md`: add M7.0 after M6.2.y, stating active capability and explicit non-goals.
- `agent.md`: add a numbered rule that all new run management work must use canonical `/api/runs` and artifact ids, and must not restore `/api/simulation-runs`.

Required wording to preserve:

```text
M7.0 运行与产物管理只管理 canonical /api/runs 的运行账本、产物账本、下载、归档和软删除；不实现生产 worker queue/object storage/取消重试完整体系，不实现 M8 projection payload KPI 展示，不实现 M9 state stream，不解锁 aviation_support 正式执行，不恢复 legacy /api/simulation-runs。
```

Run:

```bash
rg -n "M7\\.0|运行与产物管理|legacy /api/simulation-runs|worker queue|object storage|M8 projection|M9 state stream|aviation_support" README.md docs/README.md docs/product-roadmap.md agent.md
```

Expected: Output shows M7.0 in all four files and still describes legacy `/api/simulation-runs` as retired.

- [ ] **Step 2: Create audit report**

Create `reports/2026-06-21-m7-0-run-artifact-management-audit/README.md` with sections:

```markdown
# M7.0 Run Artifact Management Audit

## Status

Implemented.

## Scope

- Canonical run list/detail/download/archive/soft-delete over `/api/runs`.
- Complete local artifact manifests for new single and Monte Carlo runs.
- Failed-run log artifact or detail download path.

## Non-Goals Preserved

- No production worker queue.
- No object storage.
- No full cancel/retry lifecycle.
- No M8 projection payload KPI rendering.
- No M9 state stream.
- No aviation_support formal execution.
- No legacy /api/simulation-runs restoration.

## Verification

| Command | Result |
| --- | --- |
| `.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract` | PASS |
| `npm test` | PASS |
| `SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs` | PASS |
| `rg -n "/api/simulation-runs|legacy_run_api_retired" front tests src README.md docs agent.md` | legacy route only appears as retired negative contract |
| `git diff --check` | PASS |
```

The audit report must record the command names, PASS/FAIL result, and the concrete evidence checked: run list visible, run detail visible, artifact row contains `artifact_id` / `sha256` / `size_bytes`, one artifact download request observed, archive state visible, soft-delete tombstone visible, and legacy `/api/simulation-runs` still retired.

Run:

```bash
test -f reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
```

Expected: PASS.

## Task 5: Verification and Review Gates

**Files:**
- No implementation files beyond fixes required by failing verification.

**Non-goals:** Do not loosen tests to make verification pass. Do not update snapshots or docs to hide a real mismatch.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract
```

Expected: PASS. If `test_backend_http_api` fails on legacy `/api/simulation-runs`, fix the route so it continues returning `410 legacy_run_api_retired`.

- [ ] **Step 2: Run frontend and contract tests**

Run:

```bash
npm test
```

Expected: PASS. Failures about projection payload parsing should be fixed by keeping M7 UI metadata-only.

- [ ] **Step 3: Run browser smoke**

Start the durable local stack using this repo's scripts:

```bash
scripts/start-system.sh
```

Run:

```bash
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: PASS. The smoke must verify canonical `/api/runs`, M7 run/artifact visibility, and an artifact download request.

Stop the stack:

```bash
scripts/stop-system.sh
```

Expected: PASS, and no visible UI text should imply a deleted run was physically removed.

- [ ] **Step 4: Run stale wording scan**

Run:

```bash
rg -n "/api/simulation-runs|legacy_run_api_retired|production worker queue|object storage|取消|重试|M8|M9|aviation_support" front src tests README.md docs agent.md reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
```

Expected: Any `/api/simulation-runs` hits are negative-contract migration text or tests for `410 legacy_run_api_retired`. Any worker/object-storage/cancel/retry/M8/M9/aviation_support hits preserve non-goal language.

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Self-review before handoff**

Review the final diff and confirm:

- Every new run artifact has `artifact_id`, `kind`, `path`, `media_type`, `sha256`, and `size_bytes`.
- `GET /api/runs/{id}/artifacts/{artifact_id}` never trusts a request path.
- Deleted runs are hidden from default list but still have tombstone detail.
- Archive does not delete files.
- Frontend displays artifact metadata and lifecycle actions but does not parse projection payloads for KPI.
- Docs and audit report preserve all M7.0 non-goals.

Run:

```bash
git diff -- README.md docs/README.md docs/product-roadmap.md agent.md docs/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md docs/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md
```

Expected: Diff wording matches this plan and does not broaden M7.0.
