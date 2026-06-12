# Modeling Tables and Reliability Block Diagram Design

| Item | Value |
| --- | --- |
| Status | Draft for review |
| Date | 2026-06-12 |
| Scope | Frontend modeling pages, table-to-JSON contract, equipment reliability block diagram design |
| Applies to | `#/spare-planning/modeling`, `#/mission-reliability/modeling` |
| Source baseline | `front/app.js`, `docs/modeling-detailed-requirements.md`, `core/dataset/data_new.json` |

## 1. Purpose

The current frontend already exposes the spare-planning and mission-reliability modeling routes and groups their fields by JSON sheet. It is still a static review prototype: the user can inspect modeling domains and field examples, but cannot edit records, validate references, import or export project data, or build a reliability block diagram.

This design turns the modeling pages into a table-first modeling workspace. Data tables are the authoritative editable source. JSON mapping and validation explain how each table maps to the project data contract. The reliability block diagram is a structured view derived from equipment rows, not a standalone drawing that can drift away from data.

## 2. Current Frontend Progress

The current frontend has these completed foundations:

1. Home navigation covers the spare-planning module, mission-reliability module, and system-support module.
2. Both modeling routes render and expose JSON-aligned modeling domains.
3. The modeling pages already separate spare-planning emphasis from mission-reliability emphasis.
4. `equipmentTree` is already recognized as the source for equipment composition, failure-model fields, and the reliability block diagram seed.
5. Tests cover route rendering and verify that old scene example fields are not shown.

The current gaps are:

1. Modeling domains are cards and summary tables, not editable tables.
2. Field metadata exists as display arrays only; there is no typed schema, required rule, unit, source path, normalized path, or validation rule.
3. JSON export/import is described but not represented in the UI.
4. `equipmentTree` lacks a stable parent-child contract; it currently relies on `nodeLevel` and row order.
5. The reliability block diagram is only a named domain. It does not yet support graph structure, serial/parallel logic, k-out-of-n logic, or validation.

## 3. Product Approach

Use a table-first modeling workspace with a derived diagram preview.

The user edits records in tables. Each table has columns, validation, references, and JSON paths. The right side of the page shows the selected table's JSON mapping, validation messages, and downstream impact. For mission reliability, the equipment table and failure-model table feed the reliability block diagram.

This is preferred over a diagram-first editor because the current dataset is a workbook-style JSON. The table-first model keeps data import/export testable, lets backend and frontend share field contracts, and prevents a visual diagram from becoming a separate source of truth.

## 4. Page Layout

Each modeling route uses the same base layout:

1. Left navigation: modeling domains and table counts.
2. Center workspace: active table, toolbar, filters, editable cells, row-level errors.
3. Right inspector: selected row detail, JSON mapping, validation, references, and impact summary.
4. Bottom or secondary tab: JSON preview and import/export results.

Spare-planning modeling emphasizes inventory and support resources. Mission-reliability modeling emphasizes failure models and reliability block diagrams.

## 5. Shared Table Model

Every editable table should be described by table metadata rather than hard-coded markup.

```json
{
  "id": "failureModels",
  "title": "故障模型",
  "sourceSheets": ["equipmentTree"],
  "primaryKey": "id",
  "columns": [
    {
      "field": "mttr",
      "label": "平均修复时间",
      "type": "number",
      "unit": "minute",
      "required": false,
      "sourcePath": "equipmentTree[].mttr",
      "normalizedPath": "failureModels[].mttr",
      "validation": "value > 0"
    }
  ]
}
```

Minimum table-level capabilities:

1. Add, edit, duplicate, and delete rows.
2. Validate required fields, duplicate IDs, numeric ranges, enum values, and references.
3. Show source sheet and normalized JSON path for each column.
4. Export the current model to a normalized project JSON object.
5. Import workbook-style JSON and normalize it into frontend table records.
6. Preserve a raw-source reference for fields that still map directly to `data_new.json`.

## 6. Standard Project JSON Shape

The frontend should export a stable project object even if the imported source remains workbook-style.

```json
{
  "projectId": "demo-601",
  "projectName": "601 备件评估演示项目",
  "tables": {
    "missionProfiles": [],
    "equipmentAssets": [],
    "equipmentTree": [],
    "failureModels": [],
    "inventoryResources": [],
    "supportResources": [],
    "supportActivities": [],
    "metricPlans": []
  },
  "rbd": {
    "nodes": [],
    "groups": [],
    "edges": []
  },
  "validation": {
    "status": "draft",
    "errors": [],
    "warnings": []
  }
}
```

The JSON object is not a backend API promise yet. It is the frontend contract draft used to stabilize fields, UI behavior, tests, and later backend adaptation.

## 7. Table-to-JSON Mapping

| Frontend table | Source sheet | Normalized path | Purpose |
| --- | --- | --- | --- |
| Mission profiles | `basicTasks`, `compositeTasks`, `periodicTasks`, `basicUsageUnits` | `tables.missionProfiles` | Task profile, waves, duration, repeat rules, formation demand |
| Equipment assets | `aircraftPools` | `tables.equipmentAssets` | Aircraft inventory, status, service life, remaining life |
| Equipment tree | `equipmentTree` | `tables.equipmentTree` | System, subsystem, part, LRU hierarchy |
| Failure models | `equipmentTree` | `tables.failureModels` | Failure rate, MTBCF, MTTR, detection and distribution fields |
| Inventory resources | `spareParts`, `ammunition` | `tables.inventoryResources` | Spare parts, ammunition, stock counts |
| Support resources | `supportOrganizationTree`, `supportStaff`, `supportEquipment`, `supportStations`, `supportFacilities`, `stationFacilityMatrix` | `tables.supportResources` | Organizations, staff, equipment, stations, facilities |
| Support activities | `basicActivityLibrary`, `usageSupportActivities`, `preventiveMaintenance`, `correctiveMaintenance` | `tables.supportActivities` | Activity library, usage support, preventive maintenance, corrective maintenance |
| Metric plans | `experimentConfig.indexList`, `constraints`, `optimizationTargets` | `tables.metricPlans` | Objective metrics, thresholds, optimization targets |
| Reliability block diagram | `equipmentTree` plus user-authored logic | `rbd.nodes`, `rbd.groups`, `rbd.edges` | Mission reliability structure and success logic |

Excluded source sheets remain outside the main modeling table flow:

| Source sheet | Treatment |
| --- | --- |
| `shipTypes` | Environment or experiment configuration |
| `initialLayouts` | Environment or experiment configuration |
| `supportStationCodes` | Environment or experiment configuration |
| `nonSupportStationCodes` | Environment or experiment configuration |

## 8. Reliability Block Diagram Concept

The equipment reliability block diagram models how equipment elements combine to satisfy mission success. The diagram must be data-backed:

1. Equipment nodes come from `equipmentTree` or normalized equipment rows.
2. Failure parameters come from the failure-model table.
3. Logic groups describe serial, parallel, or k-out-of-n success rules.
4. Diagram changes update structured JSON, not just canvas coordinates.
5. Validation checks whether graph nodes, references, and logic groups are usable by future reliability calculation.

The first release should support hierarchy and logic authoring. It should not claim to calculate final reliability unless the backend calculation path is implemented and tested.

## 9. RBD Data Model

```json
{
  "rbd": {
    "nodes": [
      {
        "id": "node-avionics",
        "equipmentTreeRowId": "eq-0004",
        "parentId": "node-j35",
        "nodeName": "航电系统",
        "model": "SYS-AV-01",
        "quantity": 2,
        "isLru": false,
        "failureModelId": "fail-avionics"
      }
    ],
    "groups": [
      {
        "id": "group-avionics",
        "parentNodeId": "node-avionics",
        "logicType": "parallel",
        "k": null,
        "n": 2,
        "description": "任一通道可用即可满足"
      }
    ],
    "edges": [
      {
        "id": "edge-001",
        "fromNodeId": "node-avionics",
        "toNodeId": "node-mission-computer",
        "groupId": "group-avionics"
      }
    ]
  }
}
```

Required logic types:

| Logic type | Meaning | Minimum fields |
| --- | --- | --- |
| `series` | All child nodes must be available | `groupId`, `parentNodeId`, child node references |
| `parallel` | At least one child node must be available | `groupId`, `parentNodeId`, child node references |
| `kOfN` | At least `k` of `n` child nodes must be available | `groupId`, `parentNodeId`, `k`, `n`, child node references |

## 10. RBD Interaction Design

The mission-reliability modeling page adds an "装备可靠性框图" workspace with these areas:

1. Equipment selector: choose aircraft type or root equipment system.
2. Diagram canvas: node-link view generated from equipment hierarchy and logic groups.
3. Node inspector: edit name, model, quantity, LRU flag, failure-model reference, parent node.
4. Logic inspector: edit serial, parallel, or k-out-of-n group settings.
5. Validation panel: show missing parents, duplicate IDs, invalid `k/n`, missing failure models, and orphan edges.
6. JSON preview: show `rbd.nodes`, `rbd.groups`, and `rbd.edges`.

The diagram should support:

1. Select node.
2. Add child node.
3. Assign parent.
4. Change logic type for a sibling group.
5. Link node to failure model.
6. Convert imported `nodeLevel` rows into a draft tree.
7. Flag inferred parent relationships until the user confirms them.

The first implementation can use a lightweight HTML/SVG layout. It does not require advanced graph dragging if the table and inspector provide the same edits.

## 11. Import and Normalization Rules

When importing `data_new.json`, the frontend should normalize workbook-style source data:

1. Convert numeric strings to numbers where the column type is numeric.
2. Convert `"null"`, empty strings, and missing array fields into explicit nulls or empty arrays according to the column contract.
3. Generate stable row IDs if source rows do not provide IDs.
4. For `equipmentTree`, infer parent-child relationships from `nodeLevel` and row order, but mark them as inferred.
5. Preserve original source row index and source sheet for traceability.
6. Do not import `shipTypes`, `initialLayouts`, `supportStationCodes`, or `nonSupportStationCodes` into modeling tables.

## 12. Validation Rules

Shared validation:

1. Required IDs and names cannot be empty.
2. IDs must be unique within their table.
3. Numeric quantities, durations, MTBCF, MTTR, and stock counts cannot be negative.
4. Ratio and probability fields must declare whether they use 0-1 or 0-100 percent units.
5. Activity references must point to existing resources.
6. Metric references must point to existing tasks, equipment, or result targets.

RBD validation:

1. Every RBD node must have a unique `id`.
2. Every non-root RBD node must have an existing `parentId`.
3. Every edge must reference existing nodes.
4. Every group must have `series`, `parallel`, or `kOfN` logic.
5. `kOfN` groups must satisfy `1 <= k <= n`.
6. LRU nodes used in reliability logic should have a linked failure model or an explicit "not modeled" reason.
7. Imported parent relationships inferred only from `nodeLevel` should show a warning until confirmed.

## 13. UI States

| State | Meaning | UI behavior |
| --- | --- | --- |
| Draft | Data may be incomplete | Allow edits, show warnings and errors |
| Saved | Required fields and type checks pass | Allow export and experiment-precheck |
| Ready for experiment | References and experiment-precheck pass | Allow experiment page to select this project |
| Invalid import | Import failed type or structure validation | Show import errors, preserve previous valid data |

## 14. Accessibility and Responsive Behavior

Tables must remain usable on small screens through horizontal scrolling and row inspectors. The diagram must have a table/tree fallback so the structure is not hover-only or canvas-only. Essential node information should be visible in text form. Color cannot be the only way to represent errors, warnings, selected nodes, or logic types.

## 15. Implementation Plan Direction

After this design is approved, implementation should proceed in test-first slices:

1. Add table metadata and tests for modeling table labels, source sheets, normalized paths, and validation text.
2. Render table-based modeling pages without introducing backend claims.
3. Add JSON preview and import/export draft shape.
4. Add RBD metadata, fixture data, and tests for `nodes`, `groups`, `edges`, and logic labels.
5. Render the RBD workspace and validation panel.
6. Add responsive checks and route-level render tests.

## 16. Acceptance Criteria

| ID | Criterion |
| --- | --- |
| MD-01 | Spare-planning and mission-reliability modeling pages show editable-table-ready domains instead of only summary cards |
| MD-02 | Each modeling table exposes source sheet, column label, type, and normalized JSON path |
| MD-03 | JSON preview shows a stable project object with `tables` and `validation` |
| MD-04 | Mission-reliability modeling shows an equipment reliability block diagram workspace |
| RBD-01 | RBD workspace shows `nodes`, `groups`, and `edges` as explicit data concepts |
| RBD-02 | RBD logic supports serial, parallel, and k-out-of-n definitions |
| RBD-03 | RBD import can start from `equipmentTree` and mark parent relationships inferred from `nodeLevel` |
| RBD-04 | RBD validation reports missing parent, orphan edge, invalid k/n, duplicate node ID, and missing failure-model reference |
| RBD-05 | The UI does not claim final reliability calculation until a tested backend calculation path exists |
| QA-01 | Existing frontend route tests remain green |
| QA-02 | New render tests cover table metadata, JSON mapping, and RBD workspace markers |

## 17. Open Questions

1. Should the first editable version persist only in browser memory, in local storage, or through a draft JSON file import/export flow?
2. Should `equipmentTree` gain stable IDs in the normalized frontend contract immediately, or should IDs be generated only inside the frontend for now?
3. Does the MVP need manual diagram layout coordinates, or is automatic tree layout sufficient for the first reviewable version?
4. Which unit should be canonical for MTTR and detection time: minutes or hours?
5. Should reliability logic be authored at every subsystem level, or only below selected mission-critical systems in the MVP?
