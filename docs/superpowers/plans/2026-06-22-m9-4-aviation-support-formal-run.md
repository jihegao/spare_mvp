# M9.4 Aviation Support Formal Run Completion

> Completed on 2026-06-22. This file records the implementation boundary and verification evidence for the M9.4 slice.

## Goal

Unlock `aviation_support` single-run formal execution through the canonical backend path:

`/api/runs -> RunService -> SimulationAdapter -> AviationSupportModel -> artifacts`

The slice aligns backend output identity across result summary, projection payloads, `visualization_state_series`, artifact manifest, and run chain.

## Implemented Scope

- `SimulationAdapter.compile_scenario(..., model_family="aviation_support")` now emits a schema-valid `AviationSupportModel` Scenario.
- Compiler provenance records consumed/defaulted/derived/ignored/unsupported field classes for the aviation mapping.
- `SimulationAdapter.run_scenario()` executes `AviationSupportModel` for single runs and writes:
  - `run_config`
  - `input_project`
  - `compiled_scenario`
  - `snapshot`
  - `result_summary`
  - `metrics`
  - `report`
  - `log`
  - `visualization_state_series`
  - four `analysis_projection_*` payloads
- `RunService`, `BackendApi`, and HTTP `/api/runs` expose aviation single-run status/result/artifacts/chain with matching `run_id`, Scenario identity, result summary id, artifact manifest id, and state-series traceability.
- Formal-run imported sample gates remain in force.

## Non-Goals

- No production worker queue.
- No object storage.
- No checkpoint restart.
- No true in-flight incremental streaming beyond the existing M9.2 state-stream over persisted state series.
- No `aviation_support` Monte Carlo. It remains unsupported until a governed aviation sampling contract exists.
- No new run lifecycle/control semantics beyond M9.3.

## Verification

Focused and regression commands used:

```bash
PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api -v
```

Result: 114 tests passed.
