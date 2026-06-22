# M9.5 Aviation Support Formal Monte Carlo Completion

> Completed on 2026-06-22. This file records the implementation boundary and verification evidence for the M9.5 slice.

## Goal

Define the governed aviation sampling contract and unlock `aviation_support` formal Monte Carlo through the existing canonical backend path:

`/api/runs -> RunService -> SimulationAdapter -> artifacts`

The slice extends the M9.4 aviation single-run output alignment to `run_type: "monte_carlo"` without changing the production infrastructure boundary.

## Implemented Scope

- Formal aviation Monte Carlo starts from an imported sample Project and `ExperimentPlan.config.analysisRequests.largeSample -> MonteCarloRunConfig`.
- HTTP `/api/runs` accepts `model_family: "aviation_support"` with `run_type: "monte_carlo"` after the imported-sample formal gate.
- Successful runs write:
  - `monte_carlo_base`
  - four `analysis_projection_*` payloads
  - `visualization_state_series`
  - traceable result, artifact manifest, and run chain records
- The `monte_carlo_base` payload records the governed aviation sampling contract version.
- The governed contract reuses the canonical `largeSample.sweep` field names: `failureRates` is interpreted for aviation as an LRU hazard multiplier, `spareMultipliers` scales initial spare quantities, and `supportCapacities` sets mechanic/fuel/maintenance capacities for each sample point.
- `sample_count` must cover every configured Cartesian sweep point; additional samples repeat the sweep points in deterministic order.
- Projection artifacts derive from the base Monte Carlo artifact rather than frontend demo calculations.

## Non-Goals

- No production worker queue.
- No object storage.
- No full cancel/retry infrastructure beyond the existing M9.3 local control boundary.
- No checkpoint restart.
- No true in-flight incremental streaming beyond the existing M9.2 state-stream over persisted state series.
- No new auth/audit scope.

## Verification

Focused HTTP command used:

```bash
PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api.BackendHttpApiTest.test_http_canonical_runs_execute_formal_aviation_support_monte_carlo_run -v
```

Full regression commands used:

```bash
PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api -v
node --test tests/frontend-contract.test.mjs tests/contract-curator.test.mjs tests/run-intent.test.mjs tests/frontend-api-client.test.mjs
git diff --check
```

Result: passed.
