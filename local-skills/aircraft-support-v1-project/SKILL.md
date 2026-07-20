---
name: aircraft-support-v1-project
description: Use when Codex needs to choose a local spare_mvp backend Project, read or remember its Project JSON modeling table structure, explain the data by 任务、装备、保障组织、保障活动, run aircraft_support_v1 Mesa simulation directly from Project JSON without using the formal backend/API/SimulationAdapter path, or keep this skill synchronized after the Project schema, compiler mapping, or aircraft_support_v1 model input structure changes.
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
   - For clean Project JSON, expect the top-level product catalog under `products[]`, equipment references under `components[].productId`, spare references under `supportResources[].productId`, task phases under `basicMissions[].missionPhases`, persisted month/year planning composition under `missionProfile.periodicProfileLists`, support job definitions under top-level `supportActivityJobs`, activity references under `supportActivities[].activityCodes`, and canonical logistics links under top-level `transportPolicies[]`.
   - Treat `supportOrganization.tree` as one canonical root object and persist `supportOrganization.runtimeMode` as `legacy` or `vertical`. Nodes own complete four-dimensional `serviceScope`; `supportOrganization.relations[]` contains only lateral DAG edges. `supportNodes[]` and every `supportResources[]` row use `organizationNodeId`, while transport endpoints use `fromOrganizationNodeId` / `toOrganizationNodeId`. Vertical runtime uses the local organization first and then only its parent chain; lateral support remains deferred. A one-element legacy root array and unique name aliases are migration inputs only.
   - Treat `combatUnit.members[].preLifeCalendarDays`, `preLifeFlightHours`, and `preLifeTakeoffLandingCount` as cumulative consumption since the last preventive action. Missing values default to zero. Do not convert legacy `takeoffLandingCount`, `preLifeRequirementHours`, or `remainingLifeHours` into these canonical counters.
   - For corrective and preventive activities, treat `maintenanceMethods` plus `replacementRatio` as one canonical pair. Persisted ratios are 0..1 with at most four decimal places. Missing historical fields mean `['non_replacement']` and `0`; legacy scalar `repairType` migrates only on corrective activities for the exact values `原位维修` and `换件维修`, and preventive/unknown/conflicting legacy values must fail closed.
3. Explain the data in this exact order: `任务`, `装备`, `保障组织`, `保障活动`.
   - Run `explain --project-json <project.json> --memory <memory.json>`.
   - Use the four domains to separate mission/task intent, aircraft/equipment structure, organization/resources, and support work definitions.
4. Save edited Project JSON back as a new Project template when the user wants to reuse it.
   - Prefer `save-template --db <sqlite> --project-json <project.json> --template-id <new-id> --template-name <name>`.
   - Use a new `template-id`; the command fails by default if that id already exists.
   - Do not overwrite the source Project unless the user explicitly requests an overwrite and you use `--replace` for an existing template id.
5. Run the independent Mesa path only after the Project JSON can be explained.
   - Run `run --project-json <project.json> --repo-root <repo-with-src-package> --duration-minutes <n> --sample-every-minutes <n> --seed <n>`.
   - This compiles Project JSON to `aircraft-support-v1-input-v0` inside the skill script and imports only the `AircraftSupportV1Model` package from the provided repo/package path.
   - The independent compiler must prefer the clean format from issues `#160`-`#168`: no root `missionAreas`, no root `reliabilityBlockDiagram`, no required root `missionPhases`, no nested durable `supportActivities[].jobs`, and no nested `supportActivities[].transportStrategies`.
6. Synchronize this skill in the same change set whenever the modeling data structure changes.
   - Treat changes to Project schema fields, clean export/pruning rules, migrations, compiler mappings, `aircraft-support-v1-input-v0`, or model-consumed fields as skill-maintenance triggers.
   - Review and update every affected skill surface before declaring the model change complete: this `SKILL.md`, `references/project-json-four-domain-map.md`, and `scripts/aircraft_support_v1_project.py`.
   - Update `agents/openai.yaml` when the skill trigger, supported workflow, or default usage changes.
   - Preserve the independent-path boundary. Do not copy the formal backend/API/`SimulationAdapter` workflow into the skill; synchronize only the Project semantics and the independent compiler/model contract.
   - Run the validation gates in `Model-Structure Synchronization Contract` after synchronization.

## Model-Structure Synchronization Contract

Use the live `spare_mvp` repository as the source of truth. Inspect at least the relevant schema, clean Project exporter, formal compiler mapping, model consumed-field declaration, and representative fixtures/tests to identify semantic drift.

For every modeling-structure change:

1. Update the four-domain field map when a field is added, removed, moved, renamed, or changes ownership or meaning.
2. Update the skill compiler, structure memory, explanation output, and save-template handling when the changed field affects those operations.
3. Update clean-vs-legacy guidance and compatibility fallbacks explicitly; do not silently retain a retired field or invent a fallback that the repository does not support.
4. Add or update a representative skill fixture/test when compilation or runtime behavior changes.
5. Do not mark the repository model change complete until the skill review is finished. If no skill file requires a content change, record which surfaces were checked and why the skill remains compatible.

Validate the synchronized skill with:

```bash
python3 -m py_compile scripts/aircraft_support_v1_project.py
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" .
```

Also run the affected `remember-structure`, `explain`, compile, or independent `run` path against a representative current Project whenever its semantics changed.

## Script Contract

Use `scripts/aircraft_support_v1_project.py` for deterministic operations:

```bash
python3 scripts/aircraft_support_v1_project.py list-projects --db runs/system-start/spare_mvp.sqlite3
python3 scripts/aircraft_support_v1_project.py get-project --db runs/system-start/spare_mvp.sqlite3 --project-id PROJECT_ID --output /tmp/project.json
python3 scripts/aircraft_support_v1_project.py remember-structure --project-json /tmp/project.json --memory /tmp/schema-memory.json
python3 scripts/aircraft_support_v1_project.py explain --project-json /tmp/project.json --memory /tmp/schema-memory.json
python3 scripts/aircraft_support_v1_project.py save-template --db runs/system-start/spare_mvp.sqlite3 --project-json /tmp/project.json --template-id project-edited-template --template-name "编辑后案例模板"
python3 scripts/aircraft_support_v1_project.py run --project-json /tmp/project.json --repo-root /path/to/spare_mvp --duration-minutes 120 --seed 7
```

The script exposes importable Python helpers with the same semantics:

- `list_backend_projects(db_path)`
- `load_backend_project(db_path, project_id)`
- `remember_project_structure(project, memory_path=..., project_source=...)`
- `explain_project(project, memory=...)`
- `save_project_template(db_path, project, template_id=..., template_name=..., replace=False)`
- `compile_project_json_to_aircraft_support_inputs(project, runtime_config=...)`
- `run_aircraft_support_v1_project(project, repo_root=..., runtime_config=...)`

## Data Interpretation

Read `references/project-json-four-domain-map.md` when you need field-level mapping guidance or need to explain why a field belongs to one of the four domains.

Guardrails:

- Keep Project modeling data, runtime config, experiment plans, and simulation outputs separate.
- Save edited files as new Project templates by setting a new `project_id` plus `projectInfo.isTemplate` / `projectInfo.is_template`; preserve `sourceProjectId` for traceability.
- Treat top-level `supportActivityJobs[]` as reusable work definitions; `supportActivities[].activityCodes[]` selects the jobs, and `supportActivities[].predecessors` carries the DAG order. Use legacy `supportActivities[].jobs[]` only as a fallback.
- Treat `supportActivities[].maintenanceMethods` and `supportActivities[].replacementRatio` as activity-plan semantics for corrective and preventive maintenance. `non_replacement` means corrective `原位维修` or preventive `检查/保养`; the UI percentage is not the persisted decimal. Do not reuse legacy `repairTypes` or `components[].specialRepairProfile` ratios. The independent compiler emits snake_case fields and preserves the activity's `aircraftModel` / `equipmentId` scope and source identity for exact runtime selection.
- Treat `supportNodes`, `supportResources`, and `supportOrganization` as a validated allocation graph, not display-only metadata. The independent compiler emits both `support_network.nodes[].organization_node_id` and the canonical `organization_graph.runtime_mode`. Only `vertical` drives local-first and parent-chain personnel, equipment and spare supply; `legacy` remains stable across save/reload even when its tree was migration-derived. Never use lateral edges, sibling nodes, name guessing or a global pool as fallback. In vertical mode retain explicit `supportActivities[].resourceId`; default it only when the root organization uniquely maps one runtime node, otherwise fail closed. Missing personnel/equipment resources mean zero capacity.
- Treat `products[]` as the shared product catalog; `components[].productId` identifies the product represented by equipment structure, spare `supportResources[].productId` identifies inventory, and `supportActivityJobs[].spare[].productId` identifies activity demand for that same product. Compile inventory and repair requirements by product id, retaining product names only for display. Do not restore or infer `spareType`.
- Treat `components` and `combatUnit.members` as equipment structure and behavior inputs, and use `failureDistribution` / `repairDistribution` instead of restored legacy rate or repair-ratio fields.
- Map aircraft pre-life into `aircraft.assets[].initial_life_state`. Its only thresholds are the applicable preventive activity's `calendarDayInterval`, `runHourInterval`, and `takeoffLandingInterval`; zero/null disables a dimension. Positive consumption without a same-dimension threshold, conflicting scoped thresholds, invalid units, and unknown `aircraftModel`/`equipmentId` references fail closed. Do not restore `components[].lifeLimitHours` for this purpose.
- Treat root `reliabilityBlockDiagram`, root `missionAreas`, and root `missionPhases` as legacy fallbacks, not required clean Project tables.
- Treat empty strings in `missionProfile.periodicProfileLists.month[].weekProfileIds` and `year[].monthProfileIds` as explicit unconfigured slots. Preserve them during read, explain, and template save; do not infer the first available profile. The independent runtime compiler continues to derive tasks from `missionProfile.periodicTasks[]`.
- If the user asks whether the formal product path accepts the same Project, switch to repo inspection and adapter tests; do not infer formal acceptance from this independent script.
