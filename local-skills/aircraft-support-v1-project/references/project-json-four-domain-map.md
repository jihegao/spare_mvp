# Project JSON Four-Domain Map

Use this map when explaining aircraft_support_v1 Project JSON from modeling data.

## 任务

Sources:

- `missionProfile`
- `basicMissions[]`
- `missionProfile.compositeTasks[]`
- `missionProfile.periodicTasks[]`
- `missionPhases[]`
- `airports[]`

Interpretation:

- Basic missions describe sortie/task units and default durations.
- Composite tasks group basic mission items into waves or task packages.
- Periodic tasks describe calendar or repeat rules that create mission instances.
- Mission phases and airports provide context for timing/location.

## 装备

Sources:

- `combatUnit.members[]`
- `components[]`
- `equipment.aircraftTypes[]`
- `reliabilityBlockDiagram.nodes[]`
- `reliabilityBlockDiagram.edges[]`

Interpretation:

- Combat-unit members are aircraft assets and initial states.
- Components and RBD nodes/edges are equipment hierarchy and reliability semantics.
- Component failure, life-limit, k-out-of-n, RMS, and spare type fields can affect Mesa behavior.

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
- Transport policies describe replenishment links and delays.
- Organization fields should be explained as allocation/governance context.

## 保障活动

Sources:

- `supportActivities[]`
- `supportActivityJobs[]`
- `supportActivities[].jobs[]`
- `supportActivities[].jobs[].predecessors[]`

Interpretation:

- Support activities are process definitions such as preflight, repair, postflight, or preventive support.
- Jobs are ordered work steps within an activity; current clean Projects may store job definitions in top-level `supportActivityJobs[]` and reference them from `supportActivities[].activityCodes[]`.
- `predecessors` encode DAG ordering and must be preserved when compiling or explaining.
