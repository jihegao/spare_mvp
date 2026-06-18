# Contract Bundle

This directory is the first Contract Curator Agent deliverable for the contract-first backend migration.

The files here are draft JSON Schema contracts for the application-facing boundary:

- `project.schema.json`: editable Project JSON owned by the frontend modeling workflow.
- `scenario.schema.json`: compiled Scenario JSON owned by the Simulation Adapter.
- `run.schema.json`: persisted run lifecycle record.
- `result.schema.json`: metrics and summary returned from a Mesa-backed run.
- `artifact_manifest.schema.json`: versioned index of run artifacts.
- `scenario_adapter_mapping.json`: evaluator-visible mapping from compiled Scenario JSON input fields to Mesa constructor inputs.

These schemas are not a replacement for the Mesa model, ontology, or Claude-governed simulation semantics. They define the application data boundary that backend, database, frontend integration, and evaluator agents can consume.

The current frontend Project JSON is the raw `defaultScenario` shape from `front/sim-engine.mjs`; `schema_version` and `project_id` may be supplied later by an application envelope but are not required inside that raw payload.

`result.schema.json` distinguishes `smoke` and `aviation_support` through `model_family`. It does not normalize aviation metrics into smoke metrics, because that would change metric semantics and must go through the Mesa governance process.
