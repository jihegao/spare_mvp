# spare_mvp Runtime Boundary Architecture Audit

Date: 2026-07-01

## 1. Background

The product runtime path has converged on `aircraft_support_v1` and canonical `/api/runs`:

```text
RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts
```

The repository still contains historical and developer-facing paths from earlier stages, including `smoke`, `aviation_support`, `contract_server.py :8521`, local preview flows, legacy `/api/simulation-runs` migration responses, and compatibility migrations in SQLite initialization.

This document records the current boundary decisions and splits the cleanup into small, independently reviewable GitHub issues.

Tracking issue: https://github.com/jihegao/spare_mvp/issues/93

## 2. Current Canonical Runtime

The current formal runtime boundary is:

```text
Frontend RunIntent
  -> POST /api/runs
  -> BackendApi.submit_run()
  -> RunService.submit_run()
  -> SimulationAdapter.compile_scenario_with_gate()
  -> aircraft_support_v1 executor
  -> run/result/artifact persistence
  -> state/projection artifact readers
```

Current verified facts:

- `POST /api/runs` sets `formal_run = True`.
- `POST /api/runs` defaults `model_family` to `aircraft_support_v1`.
- `RunService` rejects formal runs using retired model families.
- `smoke` and `aviation_support` are still present for low-level regression, historical fixtures, archived evidence, and developer compatibility.
- Legacy `/api/simulation-runs*` routes return `410 legacy_run_api_retired`.

## 3. Legacy / Dev / Test Paths

These paths should not be described or wired as the product-mainline runtime:

- `smoke` model family.
- `aviation_support` model family.
- `src/spare_mvp_abm/contract_server.py :8521`.
- Browser-local preview and demo fallback data.
- Historical M3/M6/M9 documents that describe earlier smoke or aviation support slices.
- SQLite compatibility migration helpers embedded in `initialize_database()`.

Historical references may remain when they are clearly archived, retrospective, or regression-test evidence. The cleanup target is active runtime ownership, not deleting all historical text.

## 4. Boundary Decisions

- Formal product runs only use `aircraft_support_v1`.
- `RunService` owns formal run lifecycle semantics and status envelopes.
- `contract_server.py :8521` is a legacy/dev sidecar, not the canonical app runtime.
- Modeling import compile preview and formal run compile should expose consistent gate status, provenance, and issues.
- Each `ExperimentPlan` should bind one explicit modeling snapshot.
- Snapshot creation should be intentional; `RunIntent` should not create redundant snapshots as an unconditional side effect.
- SQLite current schema and historical compatibility migrations should be separated once runtime boundary cleanup is stable.

## 5. Issue Split

### P0 - Clarify canonical runtime path and legacy/dev simulation boundaries

GitHub issue: https://github.com/jihegao/spare_mvp/issues/85

Goal: make active docs and diagrams state the canonical path and classify legacy paths unambiguously.

Acceptance criteria:

- README or active architecture docs state the canonical runtime path.
- Legacy/dev sidecars are documented as non-mainline.
- Architecture diagrams do not show `contract_server.py :8521` as the product runtime.

### P1 - Move Mesa contract provider to legacy/dev sidecar

GitHub issue: https://github.com/jihegao/spare_mvp/issues/86

Goal: stop default system startup from presenting the legacy contract provider as part of the normal product runtime.

Acceptance criteria:

- `scripts/start-system.sh start` starts the app server by default.
- A deliberate option starts the contract provider when needed for legacy/dev testing.
- Docs explain when `contract_server.py :8521` is appropriate.

### P1 - Use compile_scenario_with_gate for modeling import scenario preview

GitHub issue: https://github.com/jihegao/spare_mvp/issues/87

Goal: align modeling import preview with formal run compile-gate semantics.

Acceptance criteria:

- `compile_modeling_import_scenario` returns status, scenario, provenance, and issues.
- Blocked or unsupported preview failures match the formal run compile-gate shape.
- Frontend preview surfaces can use the same issue display model as formal compile failures.

### P1 - Consolidate modeling snapshot creation in RunIntent and ExperimentPlan flow

GitHub issue: https://github.com/jihegao/spare_mvp/issues/88

Goal: make snapshot ownership explicit and remove unconditional duplicate snapshot creation.

Acceptance criteria:

- `createExperimentPlan` can bind an explicit `modeling_snapshot_id` or intentionally reuse the latest snapshot.
- `submitRunIntent` does not unconditionally create an unused snapshot.
- Tests prove a run chain points to the intended snapshot.

### P1 - Make RunService the single owner of run lifecycle locking

GitHub issue: https://github.com/jihegao/spare_mvp/issues/89

Goal: ensure run submit and lifecycle operations share the same lock boundary.

Acceptance criteria:

- A shared run lifecycle lock is injected into `RunService`.
- `BackendApi` does not wrap `RunService.submit_run()` in a second unrelated lock.
- Submit, archive, delete, and control-plane operations use a coherent lifecycle lock.

### P2 - Split retired model families from the formal SimulationAdapter path

GitHub issue: https://github.com/jihegao/spare_mvp/issues/90

Goal: make retired family support explicit and prevent formal code paths from depending on `smoke` or `aviation_support`.

Acceptance criteria:

- Formal adapter surface exposes `aircraft_support_v1`.
- `smoke` and `aviation_support` move to legacy adapter or test-helper ownership.
- Product-mainline tests do not use retired families as the formal path.

### P2 - Rename stale M3/smoke comments and runtime output defaults

GitHub issue: https://github.com/jihegao/spare_mvp/issues/91

Goal: remove active-code wording that still describes the runtime as a smoke-era executor.

Acceptance criteria:

- `run_service.py` header describes the canonical `/api/runs` local sync executor.
- `adapter.py` header no longer says smoke is the governed mainline model.
- Default HTTP artifact output path is `runs/canonical-api`.

### P2/P3 - Separate current SQLite schema from compatibility migrations

GitHub issue: https://github.com/jihegao/spare_mvp/issues/92

Goal: keep current schema declaration and historical migration repair code in separate surfaces.

Acceptance criteria:

- Current schema remains in `schema.sql`.
- Compatibility migrations move to an explicit migration module or versioned migration path.
- `initialize_database()` no longer accumulates implicit `_ensure_column` calls without version ownership.

## 6. Recommended Execution Order

```text
1. Audit document + tracking issue
2. Documentation boundary and startup sidecar split
3. Modeling import compile-gate alignment
4. Snapshot ownership and lifecycle locking
5. Legacy adapter split
6. SQLite schema/migration separation
```

## 7. Non-Goals

- Do not introduce a production worker queue in this cleanup.
- Do not replace SQLite.
- Do not implement a full permission system beyond existing M4 boundaries.
- Do not delete archived historical docs solely because they mention retired paths.
- Do not change simulation semantics while separating legacy runtime ownership.
