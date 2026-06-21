# Contract Bundle

This directory is the first Contract Curator Agent deliverable for the contract-first backend migration.

The files here are draft JSON Schema contracts for the application-facing boundary:

- `project.schema.json`: editable Project JSON owned by the frontend modeling workflow.
- `scenario.schema.json`: compiled Scenario JSON owned by the Simulation Adapter.
- `run.schema.json`: persisted run lifecycle record.
- `result.schema.json`: metrics and summary returned from a Mesa-backed run.
- `artifact_manifest.schema.json`: versioned index of run artifacts.
- `visualization_state_series.schema.json`: M9.1 offline visualization replay frames, event references, and run/result/artifact traceability; M9.2 online `state_frame` SSE events reuse the same frame fields.
- `scenario_adapter_mapping.json`: evaluator-visible mapping from compiled Scenario JSON input fields to Mesa constructor inputs.
- `rms_allocation_plan.schema.json`: local RMS allocation plan boundary for top-level R/M/S targets, method selection, and algorithm versioning.
- `rms_allocation_result.schema.json`: RMS allocation result boundary for node-level targets, bottom-up verification, warnings, and assumptions.
- `mission_exposure.schema.json`: task-profile exposure matrix boundary for node/phase equivalent mission hours.
- `modeling_import.schema.json`: M5 first-slice modeling data import and validation boundary for draft/published lifecycle, object collections, field-level validation issues, and run-reference overwrite protection.

These schemas are not a replacement for the Mesa model or Claude-governed simulation semantics. They define the application data boundary that backend, database, frontend integration, and evaluator agents can consume. The earlier project ontology contract has been removed from active schema/runtime/test scope.

The current frontend Project JSON is the raw `defaultScenario` shape from `front/sim-engine.mjs`; `schema_version` and `project_id` may be supplied later by an application envelope but are not required inside that raw payload.

`modeling_import.schema.json` is an application data-entry contract, not a Scenario contract. It can describe imported Project draft data, object IDs, references, validation issues, and publication lifecycle; final Scenario JSON must still be compiled by the Simulation Adapter.

`scenario.schema.json` requires an explicit `simulation_model` with `family`, `model_id`, and `contract_version`. Its `simulation_inputs` field is split with `oneOf` branches for `smoke` and `aviation_support`, so the Simulation Adapter must compile model-specific inputs instead of coercing a mixed parameter bag.

The first implemented Simulation Adapter lives at `src/spare_mvp_contract/adapter.py`. It validates current Project JSON contract roots, compiles the approved `smoke` Scenario path, runs `SmokeSpareMvpModel`, and writes traceable run artifacts. It does not compile `aviation_support` Scenario JSON yet because that path still needs a Claude-approved field derivation rule under Mesa governance.

`run.schema.json` repeats `model_family` and `model_id` for query, audit, and Result validation.

`result.schema.json` distinguishes `smoke` and `aviation_support` through `model_family`. It does not normalize aviation metrics into smoke metrics, because that would change metric semantics and must go through the Mesa governance process.

Result fixture metrics are treated as Simulation Adapter normalized summaries derived from `src/spare_mvp_abm/smoke_model.py snapshot()` and `src/spare_mvp_abm/aviation_support/model.py snapshot()`. `visualization_state().metrics` remains a visualization surface and is not the Result schema source.

M9.1 state-series replay is a separate visualization contract. `visualization_state_series.schema.json` requires each frame to carry run identity, typed aggregate state, event summaries, trace fields back to run config/input project/compiled Scenario/result/manifest artifacts, and event entries with `event_id`, `run_id`, `step`, `event_type`, and metric references.

M9.2 online state stream is the run subscription envelope over that same frame contract. `GET /api/runs/{run_id}/state-stream` emits SSE events named `run_status`, `state_frame`, and `artifact_ready`; each `state_frame` carries the same frame shape as `visualization_state_series.frames[]` plus stream metadata such as `stream_id`, `artifact_id`, `frame_index`, and `frame_count`. `artifact_ready` hands the frontend back to canonical `/api/runs/{run_id}/artifacts/{artifact_id}` download and the normal `visualization_state_series` replay parser.

M9.3 run lifecycle/control uses canonical `POST /api/runs/{run_id}/control` rather than changing the state-frame contract. The minimal supported actions are backend-confirmed `cancel` and `retry`; unsupported `pause`, `resume`, `step`, and `reset` fail closed with audit records. Retry-pending runs must not expose stale result or artifact payloads as current official outputs.
