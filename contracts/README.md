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

`modeling_import.schema.json` also preserves the Phase 2 support-organization/resource and support-activity-library boundaries: recursive support organization nodes, equipment-linked spare rows, personnel specialty values with local dictionary fallback, basic support activity jobs, activity-library references, duration distributions, and predecessor job links.

`scenario.schema.json` requires an explicit `simulation_model` with `family`, `model_id`, and `contract_version`. Its `simulation_inputs` field is split with `oneOf` branches for `smoke` and `aviation_support`, so the Simulation Adapter must compile model-specific inputs instead of coercing a mixed parameter bag.

The Simulation Adapter lives at `src/spare_mvp_contract/adapter.py`. It validates current Project JSON contract roots, compiles approved `smoke`, `aviation_support`, and `aircraft_support_v1` Scenario paths, runs `SmokeSpareMvpModel`, `AviationSupportModel`, and `AircraftSupportV1Model` for formal runs, and writes traceable run artifacts. M9.5 defines the governed aviation sampling contract for `aviation_support` formal Monte Carlo, and M9.7.3 defines the `aircraft_support_v1` formal Monte Carlo/projection path through the existing `/api/runs -> RunService -> artifacts` boundary.

`run.schema.json` repeats `model_family` and `model_id` for query, audit, and Result validation.

`result.schema.json` distinguishes `smoke` and `aviation_support` through `model_family`. It does not normalize aviation metrics into smoke metrics, because that would change metric semantics and must go through the Mesa governance process.

Result fixture metrics are treated as Simulation Adapter normalized summaries derived from `src/spare_mvp_abm/smoke_model.py snapshot()` and `src/spare_mvp_abm/aviation_support/model.py snapshot()`. `visualization_state().metrics` remains a visualization surface and is not the Result schema source.

M9.1 state-series replay is a separate visualization contract. `visualization_state_series.schema.json` requires each frame to carry run identity, typed aggregate state, event summaries, trace fields back to run config/input project/compiled Scenario/result/manifest artifacts, and event entries with `event_id`, `run_id`, `step`, `event_type`, and metric references. For `aircraft_support_v1`, mission rows in each frame also carry the task-planning fields used by the platform mission view: periodic task, composite task, basic task, day index, wave index, required aircraft type/count, duration, and assigned tail numbers. Older state-series artifacts without those mission planning fields must not be inferred from id/name/aircraft_type fallback labels; the mission schedule view should block and require a new formal `aircraft_support_v1` run.

M9.2 online state stream is the run subscription envelope over that same frame contract. `GET /api/runs/{run_id}/state-stream` emits SSE events named `run_status`, `state_frame`, and `artifact_ready`; each `state_frame` carries the same frame shape as `visualization_state_series.frames[]` plus stream metadata such as `stream_id`, `artifact_id`, `frame_index`, and `frame_count`. `artifact_ready` hands the frontend back to canonical `/api/runs/{run_id}/artifacts/{artifact_id}` download and the normal `visualization_state_series` replay parser.

M9.3 run lifecycle/control uses canonical `POST /api/runs/{run_id}/control` rather than changing the state-frame contract. The minimal supported actions are backend-confirmed `cancel` and `retry`; unsupported `pause`, `resume`, `step`, and `reset` fail closed with audit records. Retry-pending runs must not expose stale result or artifact payloads as current official outputs.

M9.4 aviation_support formal execution uses the same `/api/runs` result, projection, artifact manifest, run chain, and `visualization_state_series` contracts as smoke single runs while preserving the aviation-specific metric family. Projection artifacts for aviation single runs are derived from the `aviation_support` result summary artifact and must not be replaced by frontend demo calculations.

M9.5 aviation_support formal Monte Carlo uses the same canonical run, artifact manifest, projection, run chain, and `visualization_state_series` contracts as smoke Monte Carlo runs. The `monte_carlo_base` payload carries the aviation sampling contract version, and the four `analysis_projection_*` artifacts derive from that base artifact rather than frontend demo calculations.

M9.6 freezes the platform case package, field coverage table, and golden fixtures before M9.7 formal aircraft-support model-family work. `tests/fixtures/m9_6_platform_case_export.json` records the deterministic published modeling import -> Project -> ModelingSnapshot -> ExperimentPlan -> RunIntent -> MonteCarloRunConfig -> compiled `aviation_support` Scenario chain. `tests/fixtures/m9_6_field_coverage.json` classifies every business leaf from the canonical import package as `consumed`, `derived`, `defaulted`, `governance_only`, `ignored`, or `unsupported`; after M9.7.4 the M9.6 frozen-field unsupported summary is 0. `tests/fixtures/m9_6_expected_artifact_kinds.json` freezes the expected single and Monte Carlo artifact kind surface. M9.6 does not make `independent-mesa`, port `8765`, or static HTML output a formal product entry; M9.7 completed the formal `aircraft_support_v1` model family, and M9.8 completed platform embedding plus `independent-mesa` retirement. `independent-mesa` directories are historical, development-reference, and offline-reproduction material only.

M9.7.1 adds the `aircraft_support_v1` schema/compiler contract. `contracts/aircraft_support_v1_input.schema.json` owns the model-family input payload, while `contracts/scenario.schema.json` keeps the canonical Scenario envelope and references that independent schema for `model_family = "aircraft_support_v1"` / `model_id = "AircraftSupportV1Model"`. `contracts/run.schema.json` and `contracts/scenario_adapter_mapping.json` expose the same model-family selector and mapping metadata. The compiler gate can compile the M9.6 platform case into an `aircraft_support_v1` Scenario and must fail closed for missing fields or illegal references.

M9.7.2 unlocks the `aircraft_support_v1` single-run contract without claiming final field coverage. `contracts/result.schema.json` accepts `model_family = "aircraft_support_v1"` result summaries, and `SimulationAdapter.run_scenario()` writes the same canonical result, artifact manifest, run chain, metrics/report/log, four single-run projection artifacts, and `visualization_state_series` artifact surface as other formal single runs.

M9.7.3 unlocks `aircraft_support_v1` formal Monte Carlo through `SimulationAdapter.run_monte_carlo_scenario()` and canonical `/api/runs`. The run writes `sample_results`, `aggregate_result`, `monte_carlo_base`, four `analysis_projection_*` artifacts sourced from the base artifact, and a representative-sample `visualization_state_series`; failed samples are isolated in `failed_samples` while aggregate metrics use successful samples only.

M9.7.4 closes the `aircraft_support_v1` coverage-hardening contract. Single and Monte Carlo run config/report/log payloads declare `m9_7_4_behavior_scope`; behavior-driving fields include `components[].failureDistribution`, `supportNodes[].transportPolicies`, `reliabilityBlockDiagram`, RMS/k-out-of-n, periodic tasks, mission phases, airports, mission areas, support activity job DAGs, inventory/capacity, Monte Carlo sweeps, and seed. `supportOrganization` is approved as governance-only / non-behavior-driving provenance metadata. The aircraft-support Monte Carlo sampling contract no longer carries an M9.7.4 pending field list.
