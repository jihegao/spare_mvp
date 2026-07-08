# Project JSON Four-Domain Map

Use this map when explaining aircraft_support_v1 Project JSON from modeling data.

## 任务

Sources:

- `missionProfile`
- `basicMissions[]`
- `basicMissions[].missionPhases[]`
- `missionProfile.compositeTasks[]`
- `missionProfile.periodicTasks[]`
- `airports[]`
- legacy fallback only: root `missionPhases[]`, root `missionAreas[]`

Interpretation:

- Basic missions describe sortie/task units and default durations.
- Composite tasks group basic mission items into waves or task packages.
- Periodic tasks describe calendar or repeat rules that create mission instances.
- Mission phases now belong to each basic mission. Airports provide context for timing/location. Root mission phases and mission areas are legacy fallback fields only.

## 装备

Sources:

- `combatUnit.members[]`
- `components[]`
- `equipment.aircraftTypes[]`
- legacy fallback only: `reliabilityBlockDiagram.nodes[]`, `reliabilityBlockDiagram.edges[]`

Interpretation:

- Combat-unit members are aircraft assets and initial states.
- Components are the primary equipment hierarchy and reliability semantics.
- Clean Project JSON uses `failureDistribution`, `repairDistribution`, `kOutOfN`, and `productType`; legacy scalar failure, life-limit, RMS, spare type, and RBD fields should not be reintroduced to make clean data run.
- When `spareType` is absent, LRU component names can be used as repair spare names in the independent Mesa compiler.

## 保障组织

Sources:

- `supportNodes[]`
- `supportResources[]`
- `supportOrganization`
- `transportPolicies[]`
- `supportNodes[].transportPolicies[]`

Interpretation:

- Support nodes are resource scopes where work is performed.
- Support resources add personnel, equipment, and spares to nodes.
- Top-level and node-scoped transport policies describe replenishment links and delays.
- Organization fields should be explained as allocation/governance context.

## 保障活动

Sources:

- `supportActivities[]`
- `supportActivities[].activityCodes[]`
- `supportActivities[].predecessors`
- `supportActivityJobs[]`
- legacy fallback only: `supportActivities[].jobs[]`

Interpretation:

- Support activities are plan-reference rows such as use support, repair, preventive maintenance, or logistics support.
- Top-level `supportActivityJobs[]` contains reusable work steps keyed by `activityCode`; each activity selects steps via `activityCodes`.
- `supportActivities[].predecessors` encodes DAG ordering and must be preserved when compiling or explaining.
