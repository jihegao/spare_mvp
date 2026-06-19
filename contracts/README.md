# Contract Bundle

This directory is the first Contract Curator Agent deliverable for the contract-first backend migration.

The files here are draft JSON Schema contracts for the application-facing boundary:

- `project.schema.json`: editable Project JSON owned by the frontend modeling workflow.
- `scenario.schema.json`: compiled Scenario JSON owned by the Simulation Adapter.
- `run.schema.json`: persisted run lifecycle record.
- `result.schema.json`: metrics and summary returned from a Mesa-backed run.
- `artifact_manifest.schema.json`: versioned index of run artifacts.
- `scenario_adapter_mapping.json`: evaluator-visible mapping from compiled Scenario JSON input fields to Mesa constructor inputs.
- `rms_allocation_plan.schema.json`: local RMS allocation plan boundary for top-level R/M/S targets, method selection, and algorithm versioning.
- `rms_allocation_result.schema.json`: RMS allocation result boundary for node-level targets, bottom-up verification, warnings, and assumptions.
- `mission_exposure.schema.json`: task-profile exposure matrix boundary for node/phase equivalent mission hours.
- `modeling_import.schema.json`: M5 first-slice modeling data import and validation boundary for draft/published lifecycle, object collections, field-level validation issues, and run-reference overwrite protection.

These schemas are not a replacement for the Mesa model, ontology, or Claude-governed simulation semantics. They define the application data boundary that backend, database, frontend integration, and evaluator agents can consume.

The current frontend Project JSON is the raw `defaultScenario` shape from `front/sim-engine.mjs`; `schema_version` and `project_id` may be supplied later by an application envelope but are not required inside that raw payload.

`modeling_import.schema.json` is an application data-entry contract, not a Scenario contract. It can describe imported Project draft data, object IDs, references, validation issues, and publication lifecycle; final Scenario JSON must still be compiled by the Simulation Adapter.

`scenario.schema.json` requires an explicit `simulation_model` with `family`, `model_id`, and `contract_version`. Its `simulation_inputs` field is split with `oneOf` branches for `smoke` and `aviation_support`, so the Simulation Adapter must compile model-specific inputs instead of coercing a mixed parameter bag.

The first implemented Simulation Adapter lives at `src/spare_mvp_contract/adapter.py`. It validates current Project JSON contract roots, compiles the approved `smoke` Scenario path, runs `SmokeSpareMvpModel`, and writes traceable run artifacts. It does not compile `aviation_support` Scenario JSON yet because that path still needs a Claude-approved field derivation rule under Mesa governance.

`run.schema.json` repeats `model_family` and `model_id` for query, audit, and Result validation.

`result.schema.json` distinguishes `smoke` and `aviation_support` through `model_family`. It does not normalize aviation metrics into smoke metrics, because that would change metric semantics and must go through the Mesa governance process.

Result fixture metrics are treated as Simulation Adapter normalized summaries derived from `src/spare_mvp_abm/smoke_model.py snapshot()` and `src/spare_mvp_abm/aviation_support/model.py snapshot()`. `visualization_state().metrics` remains a visualization surface and is not the Result schema source.
