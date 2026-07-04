# RunIntent, MonteCarloRunConfig, And Imported Sample Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛前端到仿真的完整数据流：正式运行只走 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`，Monte Carlo 输入只由一个 canonical config 解释，同时把页面内置静态项目从正式路径中移出，功能测试和正式 single/Monte Carlo run 先通过“建模导入包生成的示例项目”创建 imported sample Project。

**Architecture:** 后端新增 `MonteCarloRunConfig` 作为 `ExperimentPlan.config.analysisRequests.largeSample` 的唯一正式解释层；`RunService` 只编排 config、compiler 和 executor，不再从 request、Project draft 或 Adapter fallback 中猜测 MC 输入。前端新增 `RunIntent` helper 统一保存 Project、创建 Snapshot/Plan 和提交 run；本地 demo 结果保留为明确标注的 preview。示例项目由后端读取已发布 modeling import package，经 `modeling_import_to_project()` 生成并保存为 Project draft；当前项目数据管理入口只负责项目列表、模板标记、概览和 JSON 查看，早期项目列表自动发布示例包只作为历史 fallback 记录。静态 `defaultScenario` 只保留为本地预览/fixture。正式 single/Monte Carlo run 如果收到页面内置 preview fixture 项目，或只伪造 `sourceImportId` 而没有后端 `modeling_import.create_project` allowed 审计证据，应 fail closed 并提示先生成 imported sample Project，不得把静态 seed 当正式输入。

**Tech Stack:** Python stdlib + `unittest` backend contract tests, Node.js `node:test` frontend contract tests, existing SQLite repository, existing browser frontend, existing M4 bearer-token HTTP facade.

---

## Scope And File Structure

- Create: `src/spare_mvp_backend/errors.py`
  - Owns shared backend error classes used by RunService and config normalization.
- Create: `src/spare_mvp_backend/monte_carlo_config.py`
  - Owns `MonteCarloRunConfig` validation and normalization.
  - Reads only `ExperimentPlan.config.analysisRequests.largeSample` for official sample count and sweep.
  - Accepts `mc_experiment_id` from the run request because it is run identity, not numeric MC configuration.
- Modify: `src/spare_mvp_backend/run_service.py`
  - Replace `_monte_carlo_sample_count()` and `_monte_carlo_sweep()` with `normalize_monte_carlo_run_config()`.
  - Pass a normalized config to the adapter.
- Modify: `src/spare_mvp_contract/adapter.py`
  - Execute already-normalized MC config.
  - Stop reading `project_snapshot.monteCarlo` as a second sweep source for formal `run_type: "monte_carlo"` runs.
- Modify: `src/spare_mvp_backend/api.py`
  - Add `create_project_from_modeling_import()` to save a Project draft from a published import package.
- Modify: `src/spare_mvp_backend/http_server.py`
  - Add a protected HTTP route for creating a sample Project from a modeling import.
- Modify: `front/api-client.mjs`
  - Add `createProjectFromModelingImport()`.
  - Preserve `analysisRequests` when building ExperimentPlan config for formal runs.
  - Keep `submitRun()` as the wire-level `/runs` method.
- Create: `front/run-intent.mjs`
  - Owns frontend `RunIntent` construction for `single` and `monte_carlo`.
  - Keeps page-level wrappers thin.
- Modify: `front/app.js`
  - Route formal run starts through `RunIntent`.
  - Rename local demo result usage to preview semantics.
  - Add an explicit action to generate/select the imported sample Project.
- Modify: `tests/test_backend_api_contract.py`
  - Cover canonical MC config, request-level config rejection, adapter handoff, and imported sample Project creation.
- Modify: `tests/test_backend_http_api.py`
  - Cover the protected modeling-import-to-project route.
- Modify: `tests/test_simulation_adapter.py`
  - Cover adapter execution from an already-normalized MC config.
- Modify: `tests/frontend-api-client.test.mjs`
  - Cover `createProjectFromModelingImport()` and `submitRun()` request shape.
- Create: `tests/run-intent.test.mjs`
  - Cover frontend `RunIntent` construction without reading page globals.
- Modify: `tests/frontend-contract.test.mjs`
  - Guard against formal runs consuming local preview outputs.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`
  - Document the new plan, stage boundary, and static-data exit schedule.

Do not implement worker queues, cancellation, retry, object storage, new auth scope, `aviation_support` formal execution, projection payload rendering for all KPI cards, or real-time visualization streaming in this plan. M7, M8, and M9 remain separate stages.

---

## Current Status And Boundary

As of the 2026-06-21 documentation sync, this plan is the active record for a small convergence slice rather than evidence that all static data has been deleted.

- Formal single and Monte Carlo runs should start from a real Project created from a selected published project template, backed by a published modeling import package. The original project-list action `从导入数据生成示例项目` remains historical implementation context; the current product-facing selection entry is project data management's published template list.
- Canonical `/api/runs` requests are marked `formal_run` server-side. RunService requires `missionProfile.sourceImportId`, a published import whose `projectId` matches the run Project, and a `modeling_import.create_project` allowed audit event for the same import/project pair. A manually saved Project that spoofs `sourceImportId` must be rejected.
- Superseded by the 2026-06-21 legacy run API retirement: the retired legacy run API now returns `410 legacy_run_api_retired`; canonical `/api/runs` is the only supported run entrypoint.
- The page-bundled static Project/default scenario remains only for local preview, offline fixture use, and UI smoke tests.
- A formal run request against that bundled preview fixture must fail closed. It must not silently promote `defaultScenario` into official `Project -> Snapshot -> ExperimentPlan -> Scenario` input.
- Static analysis cards that still do not read projection payloads remain scheduled for M8 artifact payload consumption.
- Static Mesa visualization frames remain scheduled for M9 state replay/streaming.

---

## Static Data Exit Schedule

The project should not delete all static data in one PR. Remove each kind only after the replacement data source exists and has tests.

| Static source | Remove from formal path when | Replacement source | Keep as |
| --- | --- | --- | --- |
| `front/sim-engine.mjs:defaultScenario` as current project seed | After imported sample Project can be generated from a published modeling import, selected from the project list, and used by formal run tests | `modeling_import_to_project(publishedPackage)` saved through BackendApi | Local preview, `tests/fixtures`, and UI smoke fallback only |
| `buildDemoResultState()` / `runSimulation()` / `runMonteCarlo()` as analysis values | After `RunIntent` formal runs and `ArtifactManifest` source checks are in place, with preview fixture runs blocked from formal execution | `ResultSummary`, `monte_carlo_base`, `analysis_projection_*` | Explicit `PreviewProjection` with “本地预览，不是正式后端仿真结果” label |
| Static analysis cards that do not read artifact payload | During M8 artifact payload consumption | Projection artifact payloads | Empty/configuration states |
| Static Mesa visualization frame | During M9 state replay/streaming | `run_id` state series or event stream | Fixture for UI smoke tests |

This slice implements the first two rows as boundary work: imported sample Project creation becomes the functional-test and formal-run path, while the bundled preview fixture is kept but blocked from official single/Monte Carlo runs. It does not claim that every static source is gone. Final removal of static analysis cards belongs to M8 and final removal of static visualization frames belongs to M9.

---

## Task 1: Add Canonical Backend MonteCarloRunConfig

**Files:**
- Create: `src/spare_mvp_backend/errors.py`
- Create: `src/spare_mvp_backend/monte_carlo_config.py`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `src/spare_mvp_backend/run_service.py`

- [ ] **Step 1: Write a failing test for plan-owned MC config**

Add this test to `BackendApiContractTest` in `tests/test_backend_api_contract.py`:

```python
def test_monte_carlo_run_uses_plan_large_sample_config(self) -> None:
    project = self._fixture("smoke_project.json")
    branch_project = copy.deepcopy(project)
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(
        saved["project_id"],
        {
            "name": "canonical MC config",
            "steps": 4,
            "projectJson": branch_project,
            "analysisRequests": {
                "largeSample": {
                    "enabled": True,
                    "samples": 5,
                    "sweep": {
                        "failureRates": [0.06, 0.08],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [2, 3],
                    },
                }
            },
        },
    )

    status = self.api.submit_run(
        {
            "project_id": saved["project_id"],
            "experiment_plan_id": plan["experiment_plan_id"],
            "model_family": "smoke",
            "run_type": "monte_carlo",
            "mc_experiment_id": "mc-canonical-config",
        }
    )
    manifest = self.api.get_run_artifacts(status["run_id"])
    base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
    payload = json.loads((Path(self.tempdir.name) / base_artifact["path"]).read_text(encoding="utf-8"))

    self.assertEqual(payload["sample_count"], 5)
    self.assertEqual(payload["mc_experiment_id"], "mc-canonical-config")
    self.assertEqual(payload["sweep"]["failureRates"], [0.06, 0.08])
    self.assertEqual(payload["sweep"]["supportCapacities"], [2, 3])
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_monte_carlo_run_uses_plan_large_sample_config -v
```

Expected before implementation: FAIL because the current path still allows multiple MC config sources and the artifact path may not expose the normalized plan-owned config consistently.

- [ ] **Step 2: Write a failing test that rejects request-level MC numeric config**

Add this test to the same class:

```python
def test_monte_carlo_run_rejects_request_level_samples_and_sweep(self) -> None:
    project = self._fixture("smoke_project.json")
    branch_project = copy.deepcopy(project)
    saved = self.api.save_project(project)
    self.api.create_modeling_snapshot(saved["project_id"])
    plan = self.api.create_experiment_plan(
        saved["project_id"],
        {
            "name": "reject request MC config",
            "steps": 4,
            "projectJson": branch_project,
            "analysisRequests": {
                "largeSample": {
                    "enabled": True,
                    "samples": 4,
                    "sweep": {
                        "failureRates": [0.07],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [3],
                    },
                }
            },
        },
    )

    with self.assertRaises(BackendApiError) as ctx:
        self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "monte_carlo",
                "sample_count": 99,
                "sweep": {"supportCapacities": [9]},
            }
        )

    self.assertEqual(ctx.exception.code, "bad_run_request")
    self.assertIn("ExperimentPlan.config.analysisRequests.largeSample", str(ctx.exception))
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_monte_carlo_run_rejects_request_level_samples_and_sweep -v
```

Expected before implementation: FAIL because request-level `sample_count` and `sweep` are currently accepted as candidates.

- [ ] **Step 3: Write failing tests for fractional integer MC inputs**

Add this parameterized backend test to `BackendApiContractTest`:

```python
def test_monte_carlo_config_rejects_fractional_integer_fields(self) -> None:
    cases = [
        ("fractional samples", {"samples": 2.5}, "analysisRequests.largeSample.samples"),
        (
            "fractional support capacity",
            {"sweep": {"failureRates": [0.07], "spareMultipliers": [1.0], "supportCapacities": [2.5]}},
            "analysisRequests.largeSample.sweep.supportCapacities",
        ),
    ]
    for _label, override, expected_field in cases:
        with self.subTest(_label):
            project = self._fixture("smoke_project.json")
            branch_project = copy.deepcopy(project)
            large_sample = {
                "enabled": True,
                "samples": 4,
                "sweep": {
                    "failureRates": [0.07],
                    "spareMultipliers": [1.0],
                    "supportCapacities": [3],
                },
            }
            if "samples" in override:
                large_sample["samples"] = override["samples"]
            if "sweep" in override:
                large_sample["sweep"] = override["sweep"]
            saved = self.api.save_project(project)
            self.api.create_modeling_snapshot(saved["project_id"])
            plan = self.api.create_experiment_plan(
                saved["project_id"],
                {
                    "name": f"reject {_label}",
                    "steps": 4,
                    "projectJson": branch_project,
                    "analysisRequests": {"largeSample": large_sample},
                },
            )

            with self.assertRaises(BackendApiError) as ctx:
                self.api.submit_run(
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "monte_carlo",
                    }
                )

            self.assertEqual(ctx.exception.code, "bad_run_request")
            self.assertEqual(ctx.exception.details["field"], expected_field)
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_monte_carlo_config_rejects_fractional_integer_fields -v
```

Expected before implementation: FAIL because `int(2.5)` currently truncates to `2` instead of fail-closing.

- [ ] **Step 4: Move shared RunService error to a small errors module**

Create `src/spare_mvp_backend/errors.py`:

```python
"""Shared structured backend service errors."""

from __future__ import annotations

from typing import Any


class RunServiceError(ValueError):
    """Structured error raised by the run service and run config normalizers."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details
```

In `src/spare_mvp_backend/run_service.py`, replace the local `RunServiceError` class with:

```python
from src.spare_mvp_backend.errors import RunServiceError
```

Run:

```bash
python3 -m py_compile src/spare_mvp_backend/errors.py src/spare_mvp_backend/run_service.py
```

Expected: PASS.

- [ ] **Step 5: Implement the canonical config module**

Create `src/spare_mvp_backend/monte_carlo_config.py`:

```python
"""Canonical Monte Carlo run config normalization for ExperimentPlan-backed runs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.spare_mvp_backend.errors import RunServiceError


MAX_MONTE_CARLO_SAMPLES = 1000


@dataclass(frozen=True)
class MonteCarloRunConfig:
    sample_count: int
    sweep: dict[str, list[float | int]]
    mc_experiment_id: str | None = None

    def to_adapter_payload(self) -> dict[str, Any]:
        return {
            "sample_count": self.sample_count,
            "sweep": {
                "failureRates": list(self.sweep["failureRates"]),
                "spareMultipliers": list(self.sweep["spareMultipliers"]),
                "supportCapacities": list(self.sweep["supportCapacities"]),
            },
            **({"mc_experiment_id": self.mc_experiment_id} if self.mc_experiment_id else {}),
        }


def reject_request_level_monte_carlo_config(request: dict[str, Any]) -> None:
    forbidden = [field for field in ("sample_count", "samples", "sweep", "monte_carlo") if field in request]
    if forbidden:
        raise RunServiceError(
            "bad_run_request",
            "Monte Carlo numeric config must be stored under ExperimentPlan.config.analysisRequests.largeSample",
            fields=forbidden,
        )


def normalize_monte_carlo_run_config(
    plan_config: dict[str, Any],
    *,
    mc_experiment_id: str | None = None,
) -> MonteCarloRunConfig:
    analysis_requests = _require_dict(plan_config.get("analysisRequests"), "analysisRequests")
    large_sample = _require_dict(analysis_requests.get("largeSample"), "analysisRequests.largeSample")
    if large_sample.get("enabled") is not True:
        raise RunServiceError(
            "bad_run_request",
            "analysisRequests.largeSample.enabled must be true for run_type=monte_carlo",
            field="analysisRequests.largeSample.enabled",
        )
    sample_count = _positive_int(
        large_sample.get("samples"),
        field_path="analysisRequests.largeSample.samples",
        max_value=MAX_MONTE_CARLO_SAMPLES,
    )
    sweep = _require_dict(large_sample.get("sweep"), "analysisRequests.largeSample.sweep")
    return MonteCarloRunConfig(
        sample_count=sample_count,
        sweep={
            "failureRates": _positive_numbers(sweep.get("failureRates"), "analysisRequests.largeSample.sweep.failureRates"),
            "spareMultipliers": _positive_numbers(sweep.get("spareMultipliers"), "analysisRequests.largeSample.sweep.spareMultipliers"),
            "supportCapacities": _positive_int_list(sweep.get("supportCapacities"), "analysisRequests.largeSample.sweep.supportCapacities"),
        },
        mc_experiment_id=mc_experiment_id,
    )


def _require_dict(value: Any, field_path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RunServiceError("bad_run_request", f"{field_path} must be an object", field=field_path)
    return value


def _positive_int(value: Any, *, field_path: str, max_value: int) -> int:
    if isinstance(value, bool):
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path) from exc
    if not number.is_integer():
        raise RunServiceError("bad_run_request", f"{field_path} must be a positive integer", field=field_path)
    parsed = int(number)
    if parsed < 1 or parsed > max_value:
        raise RunServiceError("bad_run_request", f"{field_path} must be between 1 and {max_value}", field=field_path)
    return parsed


def _positive_numbers(values: Any, field_path: str) -> list[float]:
    if not isinstance(values, list) or not values:
        raise RunServiceError("bad_run_request", f"{field_path} must be a non-empty number array", field=field_path)
    parsed = []
    for value in values:
        if isinstance(value, bool):
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path)
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path) from exc
        if number <= 0:
            raise RunServiceError("bad_run_request", f"{field_path} must contain positive numbers", field=field_path)
        parsed.append(number)
    return parsed


def _positive_int_list(values: Any, field_path: str) -> list[int]:
    if not isinstance(values, list) or not values:
        raise RunServiceError("bad_run_request", f"{field_path} must be a non-empty integer array", field=field_path)
    return [
        _positive_int(value, field_path=field_path, max_value=1000000)
        for value in values
    ]
```

Run:

```bash
python3 -m py_compile src/spare_mvp_backend/monte_carlo_config.py
```

Expected: PASS.

- [ ] **Step 6: Wire RunService to the canonical config**

In `src/spare_mvp_backend/run_service.py`, import the new helpers and replace the Monte Carlo branch with:

```python
if run_type == "monte_carlo":
    reject_request_level_monte_carlo_config(request)
    mc_config = normalize_monte_carlo_run_config(
        plan.get("config") or {},
        mc_experiment_id=_monte_carlo_experiment_id(request, plan, run_id),
    )
    bundle = self.adapter.run_monte_carlo_scenario(
        scenario,
        output_dir=self.output_dir,
        steps=_steps_from_plan(plan),
        run_id=run_id,
        monte_carlo_config=mc_config.to_adapter_payload(),
    )
else:
    bundle = self.adapter.run_scenario(
        scenario,
        output_dir=self.output_dir,
        steps=_steps_from_plan(plan),
        run_id=run_id,
    )
```

Remove `_monte_carlo_sample_count()` and `_monte_carlo_sweep()` from `run_service.py`. Keep `_monte_carlo_experiment_id()` because identity may still be submitted with the run request.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_monte_carlo_run_uses_plan_large_sample_config tests.test_backend_api_contract.BackendApiContractTest.test_monte_carlo_run_rejects_request_level_samples_and_sweep -v
```

Expected: both tests PASS.

---

## Task 2: Make The Adapter Consume Only Normalized MC Config

**Files:**
- Modify: `src/spare_mvp_contract/adapter.py`
- Modify: `tests/test_simulation_adapter.py`
- Modify: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Write an adapter regression for normalized config**

Add a test to `tests/test_simulation_adapter.py`:

```python
def test_monte_carlo_scenario_consumes_normalized_config(self) -> None:
    scenario = self._smoke_scenario()
    bundle = self.adapter.run_monte_carlo_scenario(
        scenario,
        output_dir=self.output_dir,
        steps=3,
        run_id="run-normalized-mc-config",
        monte_carlo_config={
            "sample_count": 4,
            "sweep": {
                "failureRates": [0.05],
                "spareMultipliers": [1.0, 1.25],
                "supportCapacities": [2],
            },
            "mc_experiment_id": "mc-normalized-config",
        },
    )
    base = next(
        artifact for artifact in bundle["artifact_manifest"]["artifacts"]
        if artifact["kind"] == "monte_carlo_base"
    )
    payload = json.loads(Path(base["path"]).read_text(encoding="utf-8"))

    self.assertEqual(payload["sample_count"], 4)
    self.assertEqual(payload["mc_experiment_id"], "mc-normalized-config")
    self.assertEqual(payload["sweep"]["spareMultipliers"], [1.0, 1.25])
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_monte_carlo_scenario_consumes_normalized_config -v
```

Expected before implementation: FAIL because `run_monte_carlo_scenario()` does not accept `monte_carlo_config`.

- [ ] **Step 2: Change adapter signature and profile input**

Change `SimulationAdapter.run_monte_carlo_scenario()` to accept `monte_carlo_config`:

```python
def run_monte_carlo_scenario(
    self,
    scenario: dict[str, Any],
    output_dir: Path | str,
    steps: int = 3,
    run_id: str | None = None,
    monte_carlo_config: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    ...
    config = monte_carlo_config or {
        "sample_count": 12,
        "sweep": {
            "failureRates": [inputs["failure_rate"]],
            "spareMultipliers": [inputs["spare_multiplier"]],
            "supportCapacities": [inputs["support_capacity"]],
        },
    }
    mc_experiment_id = config.get("mc_experiment_id") or f"mc-{run_id.removeprefix('run-')}"
    profile = self._monte_carlo_profile(scenario, monte_carlo_config=config)
```

Change `_monte_carlo_profile()` so it reads only `monte_carlo_config["sample_count"]` and `monte_carlo_config["sweep"]`. Do not read `project.get("monteCarlo")` in this method.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_monte_carlo_scenario_consumes_normalized_config -v
```

Expected: PASS.

- [ ] **Step 3: Update old adapter validation tests to go through the normalizer**

For tests that currently call `run_monte_carlo_scenario(sample_count=..., sweep=...)`, move invalid sample and sweep assertions to backend config tests. Adapter tests should focus on execution of already-normalized config.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter -v
```

Expected: PASS.

---

## Task 3: Add A Frontend RunIntent Builder

**Files:**
- Create: `front/run-intent.mjs`
- Create: `tests/run-intent.test.mjs`
- Modify: `front/api-client.mjs`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Write tests for RunIntent construction**

Create `tests/run-intent.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildRunIntent } from "../front/run-intent.mjs";
import { cloneScenario, defaultScenario } from "../front/sim-engine.mjs";
import { buildBackendProjectJson } from "../front/api-client.mjs";

test("buildRunIntent creates canonical monte carlo request shape", () => {
  const project = { id: "sample-project", name: "导入示例项目" };
  const projectJson = buildBackendProjectJson(cloneScenario(defaultScenario), project);
  const planProjectJson = {
    ...projectJson,
    experiment: { ...projectJson.experiment, steps: 8 },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 5,
        sweep: {
          failureRates: [0.06],
          spareMultipliers: [1.0],
          supportCapacities: [2]
        }
      }
    }
  };

  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson,
    mcExperimentId: "mc-front-intent"
  });

  assert.equal(intent.runRequest.run_type, "monte_carlo");
  assert.equal(intent.runRequest.mc_experiment_id, "mc-front-intent");
  assert.equal("sample_count" in intent.runRequest, false);
  assert.equal("sweep" in intent.runRequest, false);
  assert.equal(intent.experimentPlanConfig.analysisRequests.largeSample.samples, 5);
});
```

Run:

```bash
node --test tests/run-intent.test.mjs
```

Expected before implementation: FAIL because `front/run-intent.mjs` does not exist; after the module exists, this test also fails until `buildExperimentPlanConfig()` preserves `analysisRequests`.

- [ ] **Step 2: Preserve `analysisRequests` in ExperimentPlan config**

Add a focused test to `tests/frontend-api-client.test.mjs`:

```js
test("experiment plan config preserves analysisRequests for formal Monte Carlo runs", () => {
  const config = buildExperimentPlanConfig({
    experiment: { name: "MC config", steps: 8, samples: 5, seed: 20260620 },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 5,
        sweep: {
          failureRates: [0.06],
          spareMultipliers: [1.0],
          supportCapacities: [2]
        }
      }
    },
    monteCarlo: { spareMultipliers: [1] }
  });

  assert.equal(config.analysisRequests.largeSample.samples, 5);
  assert.deepEqual(config.analysisRequests.largeSample.sweep.supportCapacities, [2]);
});
```

Update `front/api-client.mjs`:

```js
export function buildExperimentPlanConfig(projectJson) {
  return {
    name: projectJson.experiment?.name || "frontend experiment",
    steps: Number(projectJson.experiment?.steps ?? 3),
    samples: Number(projectJson.experiment?.samples ?? 1),
    seed: Number(projectJson.experiment?.seed ?? 0),
    projectJson: cloneJson(projectJson),
    monteCarlo: cloneJson(projectJson.monteCarlo || {}),
    analysisRequests: cloneJson(projectJson.analysisRequests || {})
  };
}
```

Run:

```bash
node --test tests/frontend-api-client.test.mjs --test-name-pattern "analysisRequests"
```

Expected before implementation: FAIL because `buildExperimentPlanConfig()` currently returns only `name`, `steps`, `samples`, `seed`, `projectJson`, and `monteCarlo`.

- [ ] **Step 3: Implement `front/run-intent.mjs`**

Create:

```js
import { buildExperimentPlanConfig } from "./api-client.mjs";

export function buildRunIntent({
  runType,
  projectJson,
  planProjectJson,
  mcExperimentId = "",
  experimentId = ""
}) {
  if (!["single", "monte_carlo"].includes(runType)) {
    throw new Error(`Unsupported runType: ${runType}`);
  }
  const experimentPlanConfig = buildExperimentPlanConfig(planProjectJson);
  const runRequest = {
    project_id: projectJson.project_id,
    experiment_plan_id: "",
    model_family: "smoke",
    run_type: runType,
    ...(experimentId ? { experiment_id: experimentId } : {}),
    ...(runType === "monte_carlo" && mcExperimentId ? { mc_experiment_id: mcExperimentId } : {})
  };
  return {
    runType,
    projectJson,
    experimentPlanConfig,
    runRequest
  };
}

export function bindExperimentPlanId(intent, experimentPlanId) {
  return {
    ...intent,
    runRequest: {
      ...intent.runRequest,
      experiment_plan_id: experimentPlanId
    }
  };
}
```

Run:

```bash
node --test tests/run-intent.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Route MC launch through RunIntent**

In `front/app.js`, import the helper:

```js
import { bindExperimentPlanId, buildRunIntent } from "./run-intent.mjs";
```

Inside `startMonteCarloRunThroughApi()`, replace local request construction with:

```js
const runIntent = buildRunIntent({
  runType: "monte_carlo",
  projectJson,
  planProjectJson,
  mcExperimentId: monteCarloExperimentId
});
savedProject = await backendApi.saveProject(runIntent.projectJson);
modelingSnapshot = await backendApi.createModelingSnapshot(savedProject.project_id);
experimentPlan = await backendApi.createExperimentPlan(savedProject.project_id, runIntent.experimentPlanConfig);
const boundIntent = bindExperimentPlanId(runIntent, experimentPlan.experiment_plan_id);
backendRun = await backendApi.submitRun({
  ...boundIntent.runRequest,
  project_id: savedProject.project_id
});
```

Add a frontend contract assertion that `startMonteCarloRunThroughApi()` calls `buildRunIntent()` and does not include `sample_count` or `sweep` in the submitted run request.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "Monte Carlo"
```

Expected: PASS.

---

## Task 4: Split Local Preview From Formal Results

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `front/app.js`
- Modify: `tests/frontend-api-client.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Rename demo result helper at the API-client boundary**

In `front/api-client.mjs`, replace:

```js
export function buildDemoResultState(projectJson) {
  return {
    singleResult: runSimulation(projectJson),
    monteCarloResult: runMonteCarlo(projectJson)
  };
}
```

with:

```js
export function buildPreviewResultState(projectJson) {
  return {
    previewSingleResult: runSimulation(projectJson),
    previewMonteCarloResult: runMonteCarlo(projectJson)
  };
}
```

Update `buildFrontendResultState()` to use `buildPreviewResultState()` and only merge backend metrics into explicitly named backend result state.

Run:

```bash
node --test tests/frontend-api-client.test.mjs --test-name-pattern "preview"
```

Expected before test updates: FAIL on old helper names.

- [ ] **Step 2: Update frontend state names**

In `front/app.js`, replace formal-looking names:

```js
let { singleResult, monteCarloResult } = buildDemoResultState(scenario);
```

with:

```js
let { previewSingleResult, previewMonteCarloResult } = buildPreviewResultState(scenario);
```

Update render helpers so preview data is always accompanied by:

```text
本地预览，不是正式后端仿真结果
```

Do not use preview variables to satisfy checks for `ResultSummary`, `ArtifactManifest`, `monte_carlo_base`, or `analysis_projection_*`.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "formal result boundary"
```

Expected: PASS after contract assertions are updated to the new preview names.

- [ ] **Step 3: Keep preview available while removing it from formal gating**

Ensure all formal result unlock checks depend on:

- `backendRun?.run_type`
- compiler provenance
- `backendArtifactManifest.artifacts`
- required artifact kinds
- linked `mc_experiment_id`

Run:

```bash
node --test tests/frontend-contract.test.mjs
```

Expected: PASS.

---

## Task 5: Create A Project From A Published Modeling Import

**Files:**
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Modify: `front/api-client.mjs`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `tests/test_backend_http_api.py`
- Modify: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Add backend API test for imported sample Project creation**

Add to `BackendApiContractTest`:

```python
def test_create_project_from_modeling_import_saves_project_and_snapshot(self) -> None:
    import_package = self._fixture("modeling_import_project.json")
    self.api.save_modeling_import_as_system(import_package)
    self.api.publish_modeling_import_as_system(import_package["importId"])

    created = self.api.create_project_from_modeling_import_as_system(import_package["importId"])

    self.assertEqual(created["sourceImport"]["import_id"], import_package["importId"])
    self.assertEqual(created["project"]["project_id"], import_package["projectId"])
    self.assertEqual(created["project"]["missionProfile"]["sourceImportId"], import_package["importId"])
    self.assertEqual(created["savedProject"]["project_id"], import_package["projectId"])
    self.assertEqual(created["modelingSnapshot"]["project"]["project_id"], import_package["projectId"])
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_create_project_from_modeling_import_saves_project_and_snapshot -v
```

Expected before implementation: FAIL because the API method does not exist.

- [ ] **Step 2: Implement BackendApi method**

Add to `BackendApi`:

```python
def create_project_from_modeling_import(self, import_id: str, *, actor_user_id: str | None = None) -> dict[str, Any]:
    return self._create_project_from_modeling_import_trusted(
        import_id,
        actor_user_id=actor_user_id,
        allow_system=False,
    )

def create_project_from_modeling_import_as_system(self, import_id: str) -> dict[str, Any]:
    return self._create_project_from_modeling_import_trusted(
        import_id,
        actor_user_id=None,
        allow_system=True,
    )

def _create_project_from_modeling_import_trusted(
    self,
    import_id: str,
    *,
    actor_user_id: str | None,
    allow_system: bool,
) -> dict[str, Any]:
    self._require_role(
        actor_user_id,
        {"系统管理员", "数据管理员"},
        action="modeling_import.create_project",
        resource_type="modeling_import",
        resource_id=import_id,
        allow_system=allow_system,
    )
    stored = self.repository.get_modeling_import(import_id)
    import_package = stored.get("publishedPackage")
    if import_package is None:
        raise BackendApiError(
            "unpublished_modeling_import",
            "Modeling import must be published before creating a sample Project",
            import_id=import_id,
        )
    validation = self.validate_modeling_import(import_package)
    if not validation["ok"]:
        raise BackendApiError(
            "invalid_modeling_import",
            "Modeling import package failed validation",
            issues=validation["issues"],
        )
    project_json = modeling_import_to_project(import_package)
    saved = self.save_project(project_json)
    project = self.repository.get_project(saved["project_id"])
    snapshot = self.create_modeling_snapshot(saved["project_id"])
    return {
        "sourceImport": {
            "import_id": import_id,
            "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
            "project_id": saved["project_id"],
        },
        "savedProject": saved,
        "project": project,
        "modelingSnapshot": snapshot,
    }
```

Run the backend API test again.

Expected: PASS.

- [ ] **Step 3: Add protected HTTP route**

In `src/spare_mvp_backend/http_server.py`, add:

```python
if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "create-project":
    actor = self._require_user()
    return api.create_project_from_modeling_import(parts[1], actor_user_id=actor["user_id"])
```

Add an HTTP test that logs in as a data/admin user, publishes `modeling_import_project.json`, posts to:

```text
POST /api/modeling-imports/import-carrier-day-night-001/create-project
```

and asserts `project.project_id == "project-carrier-day-night"` and `modelingSnapshot.snapshot_id` is present.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api.BackendHttpApiTest.test_http_modeling_import_create_project_requires_session -v
```

Expected: PASS.

- [ ] **Step 4: Add frontend API client method**

In `front/api-client.mjs`, add:

```js
createProjectFromModelingImport(importId) {
  return request({
    method: "POST",
    path: `/modeling-imports/${encodeURIComponent(importId)}/create-project`
  });
}
```

Add a client test that verifies method, path, and bearer-token behavior.

Run:

```bash
node --test tests/frontend-api-client.test.mjs --test-name-pattern "createProjectFromModelingImport"
```

Expected: PASS.

---

## Task 6: Use Imported Sample Project In The Frontend Without Deleting Offline Fixtures

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`

- [ ] **Step 1: Add a project-list action for imported sample Project generation**

In the project list toolbar, add a button:

```html
<button type="button" class="btn-secondary" data-project-create-from-import>从导入数据生成示例项目</button>
```

In the click handler, add:

```js
const createFromImportButton = event.target.closest("[data-project-create-from-import]");
if (createFromImportButton) {
  createSampleProjectFromPublishedImport(currentPublishedModelingImportId()).finally(() => render());
  return;
}
```

Add:

```js
async function createSampleProjectFromPublishedImport() {
  try {
    const published = await ensurePublishedModelingImportForSampleProject({
      backendApi,
      fixture: MODELING_IMPORT_DEMO_FIXTURE,
      publishedImportId: currentPublishedModelingImportId()
    });
    const resolvedImportId = published.importId;
    const created = await backendApi.createProjectFromModelingImport(resolvedImportId);
    const projectJson = created.project || {};
    const projectId = projectJson.project_id || created.savedProject?.project_id || MODELING_IMPORT_DEMO_FIXTURE.projectId;
    const project = {
      id: String(projectId || "imported-sample").replace(/^project-/, ""),
      name: projectJson.experiment?.name || "导入示例项目",
      baseCode: projectId || "imported-sample",
      sourceKind: PROJECT_SOURCE.imported_sample,
      sourceImportId: created.sourceImport?.import_id || resolvedImportId
    };
    demoProjects = [project, ...demoProjects.filter((item) => item.id !== project.id)];
    currentProject = project;
    scenario = cloneScenario(projectJson);
    experimentPlanDraft = cloneScenario(scenario);
    projectListStatus = `已从导入数据生成示例项目：${project.name}`;
    projectDraftHydrateStatus = "示例项目来自已发布建模导入包";
  } catch (err) {
    projectListStatus = `导入示例项目生成失败：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}
```

The function uses backend-generated Project JSON when available. It does not delete `defaultScenario`; it only stops treating `defaultScenario` as the preferred formal sample.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "project list"
```

Expected: PASS after adding assertions for the new action and status wording.

- [ ] **Step 2: Update browser smoke to exercise imported sample creation**

In `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`, after login and before starting a run:

1. Open project list.
2. Click `data-project-create-from-import`.
3. Assert page text includes `已从导入数据生成示例项目`.
4. Continue the existing save/run/status/artifact flow.

Run:

```bash
bash /Users/gaojihe/.codex/skills/playwright/scripts/playwright_cli.sh reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: PASS with the same `/api/runs` evidence plus imported-project source text.

- [ ] **Step 3: Document the static data exit state**

Update docs with these exact boundaries:

```text
M6.2.x/M6.3 收敛：正式 run 入口使用 RunIntent，正式 Monte Carlo 数值配置只从 ExperimentPlan.config.analysisRequests.largeSample 生成 MonteCarloRunConfig；页面静态 Project seed 开始让位于已发布建模导入包生成的示例项目。defaultScenario、runSimulation 和 runMonteCarlo 只保留为离线 fixture、本地预览或测试 fallback，不作为正式结果来源。
```

Run:

```bash
rg -n "defaultScenario.*正式|runMonteCarlo.*正式|静态.*正式结果|offline-demo-run" README.md docs agent.md front tests reports
```

Expected: matches either describe forbidden behavior, explicit preview/fallback boundaries, or tests that prevent `offline-demo-run`.

---

## Task 7: Final Verification

**Files:**
- All files touched in Tasks 1-6.

- [ ] **Step 1: Run backend focused tests**

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_simulation_adapter -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused tests**

```bash
node --test tests/run-intent.test.mjs tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run static wording checks**

```bash
rg -n "sample_count|samples|sweep|monte_carlo" src/spare_mvp_backend/run_service.py src/spare_mvp_contract/adapter.py
```

Expected:

- `run_service.py` references `monte_carlo_config` and `mc_experiment_id`, not `_monte_carlo_sample_count()` or `_monte_carlo_sweep()`.
- `adapter.py` reads `monte_carlo_config`, not `project_snapshot.monteCarlo`, for formal MC execution.

```bash
rg -n "本地预览，不是正式后端仿真结果|PreviewProjection|buildPreviewResultState|buildDemoResultState" front tests README.md docs agent.md
```

Expected:

- Preview wording exists.
- `buildPreviewResultState` exists.
- `buildDemoResultState` does not remain as a formal path.

- [ ] **Step 4: Run broad checks**

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest discover tests -v
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spare_mvp_backend/errors.py src/spare_mvp_backend/monte_carlo_config.py src/spare_mvp_backend/run_service.py src/spare_mvp_contract/adapter.py src/spare_mvp_backend/api.py src/spare_mvp_backend/http_server.py front/api-client.mjs front/run-intent.mjs front/app.js tests/test_backend_api_contract.py tests/test_backend_http_api.py tests/test_simulation_adapter.py tests/frontend-api-client.test.mjs tests/run-intent.test.mjs tests/frontend-contract.test.mjs reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs README.md docs/README.md docs/product-roadmap.md agent.md
git commit -m "feat: unify run intent and imported sample project flow"
```

Expected: commit succeeds with only the planned files staged.

---

## Plan Self-Review

- Spec coverage: the plan covers the agreed reductions: canonical `/api/runs` remains, frontend run wrappers collapse behind `RunIntent`, MC input interpretation collapses behind `MonteCarloRunConfig`, preview remains labeled, and the sample Project starts from published modeling import data.
- Placeholder scan: there are no placeholder markers or open-ended “add tests” steps. Each task names files, commands, and expected outcomes.
- Type consistency: backend config uses `supportCapacities` as the canonical field. The earlier M6.2 spec example using `capacities` must be updated during documentation sync so the project has one public name for the support capacity sweep dimension.
