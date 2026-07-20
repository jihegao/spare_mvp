# Project JSON Four-Domain Map

Use this map when explaining aircraft_support_v1 Project JSON from modeling data.

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
- Periodic profile lists persist the month-to-week and year-to-month planning composition. Empty strings in their reference arrays mean “not configured” and must not be replaced with another profile ID; these lists support authoring and summaries, while runtime task generation still uses `missionProfile.periodicTasks[]`.
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
- Products are shared identities maintained independently from their use in an equipment hierarchy or spare inventory.
- Components are the primary equipment hierarchy and reliability semantics; `components[].productId` binds each row to a product.
- Clean Project JSON uses `failureDistribution`, `repairDistribution`, `kOutOfN`, and `productType`; legacy scalar failure, life-limit, RMS, spare type, and RBD fields should not be reintroduced to make clean data run.
- The independent compiler keys component repair requirements by `productId` and uses `products[].name` only as a display label; it does not derive or restore `spareType`.

## 保障组织

Sources:

- `supportNodes[]`
- `supportResources[]`
- `supportOrganization`
- `transportPolicies[]`
- `supportNodes[].transportPolicies[]`

Interpretation:

- Support nodes are resource scopes where work is performed.
- Support resources add personnel, equipment, and spares to nodes; spare rows reference catalog entries with `productId`.
- `supportOrganization.tree` is one canonical root. Parent edges derive from `children[]`; `relations[]` contains only lateral DAG edges. Each node has a complete `serviceScope`, where an empty dimension means unrestricted.
- Support nodes and all resources declare `organizationNodeId`; top-level transport policies use organization-node endpoints. An optional `productId` limits a policy to one product; omission means the policy can carry any product.
- Organization fields form a validated allocation graph. `supportOrganization.runtimeMode` persists as `legacy` or `vertical` and compiles to `organization_graph.runtime_mode`; only vertical mode uses each runtime node's exact `organization_node_id`, satisfies locally first, then walks only the parent chain. Every vertical hop requires a matching product-specific or wildcard transport policy; capacity is the per-batch bound and hop times accumulate. Personnel/equipment requests reserve atomically, may split into path-capacity batches, and return to suppliers after work. A task's complete multi-product spare plan commits atomically, and arrivals remain job/task/product-specific until start. Lateral edges remain deferred to #316; node-scoped policies and name aliases are migration-only.

## 保障活动

Sources:

- `supportActivities[]`
- `supportActivities[].activityCodes[]`
- `supportActivities[].predecessors`
- `supportActivityJobs[]`
- legacy fallback only: `supportActivities[].jobs[]`

Interpretation:

- Support activities are plan-reference rows such as use support, repair, preventive maintenance, or logistics support.
- Preventive activities are the only threshold source for aircraft pre-life: `calendarDayInterval`, `runHourInterval`, and `takeoffLandingInterval` map to days, flight hours, and takeoff/landing cycles. Zero/null disables that dimension; model/equipment scope must resolve exactly and conflicting applicable thresholds fail closed.
- Top-level `supportActivityJobs[]` contains reusable work steps keyed by `activityCode`; each activity selects steps via `activityCodes`, and each structured spare requirement references `products[]` through `spare[].productId`.
- `supportActivities[].predecessors` encodes DAG ordering and must be preserved when compiling or explaining.
- Corrective and preventive activities own the canonical pair `maintenanceMethods` (`non_replacement`, `replacement`) and `replacementRatio` (0-1, at most four decimal places). Corrective `non_replacement` is `原位维修`; preventive `non_replacement` is `检查/保养`. A historical activity missing both fields means non-replacement only with ratio 0; legacy `repairType` is accepted only on corrective activities for exact `原位维修` / `换件维修` migration and must not coexist with conflicting canonical values.
- `repairTypes` remains non-model UI residue and `components[].specialRepairProfile` ratios are not a fallback for this decision. Runtime compilation preserves `aircraftModel` and `equipmentId` scope, emits snake_case maintenance fields, and uses the selected activity's full structured spare requirements only when replacement is chosen.
