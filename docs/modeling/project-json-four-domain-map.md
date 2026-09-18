# Project JSON Four-Domain Map

Use this map when explaining `aircraft_support_v1` Project JSON from modeling data. The schemas in `contracts/`, `ProjectJsonExporter`, and `SimulationAdapter` are authoritative; this document summarizes field ownership and compatibility behavior without defining another schema or compiler.

## 任务

Sources:

- `missionProfile`
- `basicMissions[]`
- `basicMissions[].missionPhases[]`
- `missionProfile.compositeTasks[]`
- `missionProfile.periodicTasks[]`
- `missionProfile.periodicProfileLists`
- `airports[]`
- legacy fallback only: root `missionPhases[]`, root `missionAreas[]`

Interpretation:

- Basic missions describe sortie/task units and default durations.
- Composite tasks group basic mission items into waves or task packages.
- Periodic tasks describe calendar or repeat rules that create mission instances.
- Periodic tasks are the reusable week-profile definitions. `periodicProfileLists` is behavior-driving composition input: the formal compiler selects the highest configured level (`year`, then `month`, then `week`) and expands referenced periodic and composite tasks into the compiled schedule with their week offsets. Empty reference slots mean “not configured” and must not be replaced with another profile ID.
- Mission phases now belong to each basic mission. Airports provide context for timing/location. Root mission phases and mission areas are legacy fallback fields only.

## 装备

Sources:

- `combatUnit.members[]`
- `products[]`
- `components[]`
- `equipment.aircraftTypes[]`
- legacy fallback only: `reliabilityBlockDiagram.nodes[]`, `reliabilityBlockDiagram.edges[]`

Interpretation:

- Combat-unit members are aircraft assets and initial states. Their canonical `preLifeCalendarDays`, `preLifeFlightHours`, and `preLifeTakeoffLandingCount` values are cumulative consumption since the last preventive action and compile to `aircraft.assets[].initial_life_state`; missing values default to zero. Legacy total-cycle, required-life, and remaining-life fields are retained only as source data and never converted into these counters.
- Products are shared identities maintained independently from their use in an equipment hierarchy or spare inventory. Product reliability parameters are shared data: editing one component updates its exact, case-sensitive product and every component that references the same `productId`.
- Components are the primary equipment hierarchy; `components[].productId` binds each row to the product that owns its reliability parameters. Component distributions are synchronized compatibility projections for compilation, not independent copies.
- `components[].parentId` is a strict component-ID reference. When child rows use `aircraft-root`, the Project must contain one real parentless `components[]` row with that ID and a whole-aircraft product; hiding it in the authoring table does not make it virtual. Non-empty `supportActivities[].equipmentId` values follow the same component-ID contract.
- Clean Project JSON uses `failureDistribution`, `repairDistribution`, `kOutOfN`, and `productType`; legacy scalar failure, life-limit, RMS, spare type, and RBD fields should not be reintroduced to make clean data run.
- Exponential failure behavior is persisted only as the direct hourly failure rate `failureDistribution.rate`. The editor labels and edits the reciprocal MTBF in hours; for example rate `0.002` is 500 hours, and entering 200 hours persists rate `0.005`. Historical `lambda`, `λ`, `failure_rate`, `parameters`, `params`, and exponential-owner `mtbfHours` are migration inputs only and are removed after consistency checks. Zero, negative, non-finite, unknown, or conflicting values fail closed; values below one are valid rates and are never reinterpreted by a magnitude heuristic.
- Non-exponential failure distributions retain their own fields: normal `mean` (plus optional variance), uniform `min`/`max`, and fixed `value`/`mean`. If a historical distribution label conflicts with an unambiguous parameter family, migrate the label instead of discarding the values.
- The formal compiler keys component repair requirements by `productId` and uses `products[].name` only as a display label; it does not derive or restore `spareType`.

## 保障组织

Sources:

- `supportNodes[]`
- `supportResources[]`
- `supportOrganization`
- `transportPolicies[]`
- `supportNodes[].transportPolicies[]`

Interpretation:

- Support nodes are resource scopes where work is performed. `supportOrganization.tree[].id` is also the corresponding `supportNodes[].id`; canonical Project JSON has no second runtime-node ID and does not retain `supportNodes[].organizationNodeId`.
- Support resources add personnel, equipment, and spares to nodes; spare rows reference catalog entries with `productId`.
- `supportOrganization.tree` is one canonical root. Parent edges derive from `children[]`; `relations[]` contains only lateral DAG edges. Each node has a complete `serviceScope`, where an empty dimension means unrestricted.
- Support resources declare `organizationNodeId`; support activities use the same ID in `resourceId`; top-level transport policies use organization-node endpoints. Names are display-only. An optional `productId` limits a policy to one product; omission means the policy can carry any product.
- Legacy runtime IDs and names migrate only when they resolve uniquely to a tree ID. Duplicate runtime rows for one organization, missing rows for operational references, ambiguous names, unknown references, and conflicting legacy/canonical mappings fail closed with field paths.
- Organization fields form a validated allocation graph. `supportOrganization.runtimeMode` persists as `legacy`, `vertical`, or `vertical_lateral` and compiles to `organization_graph.runtime_mode`. Vertical mode uses local then parent-chain candidates; vertical-lateral inserts enabled direct incoming sibling edges ordered by relation priority, ID, and source before the parent chain. Each direct lateral or vertical hop requires a matching product-specific or wildcard transport policy; capacity is the per-batch bound and times accumulate only along the selected path. Personnel/equipment requests reserve atomically and may split into batches; a task's complete multi-product spare plan commits atomically, and arrivals remain job/task/product-specific until start. Node-scoped policies and name aliases are migration-only.

## 保障活动

Sources:

- `supportActivities[]`
- `supportActivities[].planType`
- `supportActivities[].planGroupId`
- `supportActivities[].activityCodes[]`
- `supportActivities[].predecessors`
- `supportActivityJobs[]`
- legacy fallback only: `supportActivities[].jobs[]`

Interpretation:

- Support activities are plan-reference rows such as use support, repair, preventive maintenance, or logistics support.
- One use-support plan is three phase rows sharing `planGroupId`: direct preparation, relaunch preparation, and postflight inspection. Each phase owns its own `activityCodes` and `predecessors`; the referenced `supportActivityJobs[]` definitions remain reusable and may be shared across phases.
- A legacy single `使用保障方案` row migrates deterministically to direct preparation. Missing relaunch and postflight rows are created with empty references, so migration never invents phase membership by copying the legacy list.
- A regressed legacy three-row save with recognizable relaunch/postflight suffixes but collapsed `planType`/`planGroupId` is regrouped before ordinary migration, preventing accidental expansion into nine rows.
- `SimulationAdapter` emits `operations_support_policy: daily-v1`, activity `plan_group_id`/`operations_phase`, and the task's resolved `operations_plan_group_id`. The task's `supportActivityName` selects its group; an omitted reference can resolve only one compatible group. All phases must apply to the task's aircraft type. Runtime selection uses these identities, not display-name guesses.
- The first actual takeoff per aircraft per simulation day uses preflight work; later takeoffs use relaunch work. Cancellation never increments that counter. Each preparation uses its task's selected group; final inspection uses the last actually flown task's group. A returned aircraft keeps turnaround eligibility while a same-day, compatible, unexpired task still needs it; after the last such task, day boundary, or cutoff its final inspection becomes due. No whole-day aircraft assignment is precomputed.
- A cross-day flight is inspected only after return, and repairs finish before its pending inspection. The next departure cycle cannot bypass an outstanding final inspection. Preparation whose intended departure day has expired is invalidated with reservations released, then rebuilt for the new day after inspection.
- Empty phase work lists pass immediately with no time or resources, including phases materialized from legacy single-row plans. No default 30-minute task or copied phase list is substituted. With no operations plan configured, all operations stages have no work. Historical compiled inputs without `operations_support_policy` retain their legacy scheduling compatibility path; new Project compilations always use daily phases.
- Work DAGs are consumed in stable topological serial order. Stage creation/completion and each work-step start/completion emit phase, group, activity, task, aircraft and resource identities. At cutoff, unfinished/airborne inspections remain pending; no completion is fabricated. Normal completed-sortie counting occurs at return, independently of the daily inspection count.
- Preventive activities are the only threshold source for aircraft pre-life: `calendarDayInterval`, `runHourInterval`, and `takeoffLandingInterval` map to days, flight hours, and takeoff/landing cycles. Zero/null disables that dimension; model/equipment scope must resolve exactly. Each applicable preventive activity owns an independent cycle, so different positive intervals in the same dimension are allowed and completing one activity resets only its own counters.
- Top-level `supportActivityJobs[]` contains reusable work steps keyed by `activityCode`; each activity selects steps via `activityCodes`, and each structured spare requirement references `products[]` through `spare[].productId`.
- `supportActivities[].predecessors` encodes DAG ordering and must be preserved when compiling or explaining.
- Corrective and preventive activities own the canonical pair `maintenanceMethods` (`non_replacement`, `replacement`) and `replacementRatio` (0-1, at most four decimal places). Corrective `non_replacement` is `原位维修`; preventive `non_replacement` is `检查/保养`. A historical activity missing both fields means non-replacement only with ratio 0; legacy `repairType` is accepted only on corrective activities for exact `原位维修` / `换件维修` migration and must not coexist with conflicting canonical values.
- `repairTypes` remains non-model UI residue and `components[].specialRepairProfile` ratios are not a fallback for this decision. Runtime compilation preserves `aircraftModel` and `equipmentId` scope, emits snake_case maintenance fields, and uses the selected activity's full structured spare requirements only when replacement is chosen.

## Excel 交换边界

[Project Excel 标准模板](../project-excel-template.md) 沿用本页的任务、装备、保障组织、保障活动顺序。子表字段由 clean Project schema 生成，嵌套集合通过父记录 ID 与顺序关联，开放字典逐字段展开；Excel 只编解码 Project，不编译模型输入。导入预览依次使用 Project 合同、`ProjectJsonExporter` 和公开 `SimulationAdapter.compile_scenario_with_gate`；既有字段归属和兼容镜像规则不变。
