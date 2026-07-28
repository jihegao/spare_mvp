# Repository Agent Guide

## Project Contract Ownership

- Treat `contracts/`, `src/spare_mvp_backend/project_payload.py` (`ProjectJsonExporter`), and `src/spare_mvp_contract/adapter.py` (`SimulationAdapter`) as the sources of truth for Project JSON and Project-to-model compilation semantics.
- Do not add a second Project-to-`aircraft-support-v1` input compiler in scripts, skills, tests, frontend code, or backend handlers. Project operations must use the repository/exporter boundary, and model input must be produced by `SimulationAdapter`.
- Keep modeling changes synchronized across the Project and input schemas, `ProjectJsonExporter`, `SimulationAdapter`, canonical fixtures, contract tests, and relevant documentation.
- Treat SQLite databases as local runtime state. Reproducible baseline data belongs in reviewed fixtures or deterministic fixture generators, not in a checked-in database.

## Modeling Vocabulary

Explain Project modeling data in this order: task, equipment, support organization, support activity. The maintained field ownership and compatibility rules are in [`docs/modeling/project-json-four-domain-map.md`](docs/modeling/project-json-four-domain-map.md); the executable contracts remain authoritative when documentation and code disagree.

## Verification

For Project structure or compilation changes, run the focused exporter, Project contract, Simulation Adapter, and affected frontend contract tests. Validate canonical compiled `simulation_inputs` against `contracts/aircraft_support_v1_input.schema.json`, then run `git diff --check`.
