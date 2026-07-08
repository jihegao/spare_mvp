---
name: aircraft-support-v1-project
description: Use when Codex needs to choose a local spare_mvp backend Project, read or remember its Project JSON modeling table structure, explain the data by 任务、装备、保障组织、保障活动, or run aircraft_support_v1 Mesa simulation directly from Project JSON without using the formal backend/API/SimulationAdapter path.
---

# Aircraft Support V1 Project

## Overview

Use this skill for local aircraft_support_v1 analysis from Project JSON. Keep it independent from the product formal path: do not call `/api/runs`, `RunService`, or `SimulationAdapter` unless the user explicitly asks to compare against the formal runtime.

## Workflow

1. Choose the Project source.
   - From backend SQLite: run `scripts/aircraft_support_v1_project.py list-projects --db <sqlite>`, then `get-project --db <sqlite> --project-id <id> --output <project.json>`.
   - From a file: use the provided Project JSON directly.
2. Remember the modeling table structure.
   - Run `remember-structure --project-json <project.json> --memory <memory.json>`.
   - Treat the memory as a reusable schema note for this Project shape, not as runtime output.
3. Explain the data in this exact order: `任务`, `装备`, `保障组织`, `保障活动`.
   - Run `explain --project-json <project.json> --memory <memory.json>`.
   - Use the four domains to separate mission/task intent, aircraft/equipment structure, organization/resources, and support work definitions.
4. Run the independent Mesa path only after the Project JSON can be explained.
   - Run `run --project-json <project.json> --repo-root <repo-with-src-package> --duration-minutes <n> --sample-every-minutes <n> --seed <n>`.
   - This compiles Project JSON to `aircraft-support-v1-input-v0` inside the skill script and imports only the `AircraftSupportV1Model` package from the provided repo/package path.

## Script Contract

Use `scripts/aircraft_support_v1_project.py` for deterministic operations:

```bash
python3 scripts/aircraft_support_v1_project.py list-projects --db runs/system-start/spare_mvp.sqlite3
python3 scripts/aircraft_support_v1_project.py get-project --db runs/system-start/spare_mvp.sqlite3 --project-id PROJECT_ID --output /tmp/project.json
python3 scripts/aircraft_support_v1_project.py remember-structure --project-json /tmp/project.json --memory /tmp/schema-memory.json
python3 scripts/aircraft_support_v1_project.py explain --project-json /tmp/project.json --memory /tmp/schema-memory.json
python3 scripts/aircraft_support_v1_project.py run --project-json /tmp/project.json --repo-root /path/to/spare_mvp --duration-minutes 120 --seed 7
```

The script exposes importable Python helpers with the same semantics:

- `list_backend_projects(db_path)`
- `load_backend_project(db_path, project_id)`
- `remember_project_structure(project, memory_path=..., project_source=...)`
- `explain_project(project, memory=...)`
- `compile_project_json_to_aircraft_support_inputs(project, runtime_config=...)`
- `run_aircraft_support_v1_project(project, repo_root=..., runtime_config=...)`

## Data Interpretation

Read `references/project-json-four-domain-map.md` when you need field-level mapping guidance or need to explain why a field belongs to one of the four domains.

Guardrails:

- Keep Project modeling data, runtime config, experiment plans, and simulation outputs separate.
- Treat `supportActivities[].jobs[]` as ordered work definitions; preserve `activityCode`/`id` and `predecessors`.
- Treat `supportNodes`, `supportResources`, and `supportOrganization` as allocation/governance scope, not display-only metadata.
- Treat `components`, `combatUnit.members`, and `reliabilityBlockDiagram` as equipment structure and behavior inputs.
- If the user asks whether the formal product path accepts the same Project, switch to repo inspection and adapter tests; do not infer formal acceptance from this independent script.
