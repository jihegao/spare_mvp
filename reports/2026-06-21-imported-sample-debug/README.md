# 2026-06-21 Imported Sample Project Debug Report

## Scope

This report records issues found while testing the real functional path that starts from `从导入数据生成示例项目`.

Only confirmed issues should be added here. A reported symptom is not recorded as an issue until it has been reproduced or otherwise verified from the current checkout/runtime.

## Confirmation Flow

1. Capture the exact user-visible symptom, page, action, and expected behavior.
2. Reproduce in the current local runtime or confirm from source/test evidence.
3. Record the verified issue with evidence, affected files or pages, and current status.
4. Keep preview/fixture behavior separate from formal imported-sample Project behavior.

## Confirmed Issues

### 1. Equipment composition tree add-node did not create an aircraft when the imported sample had zero aircraft models

- **Status:** Fixed locally.
- **Page:** `备件规划评估模块 / 仿真建模 / 装备系统建模 / 装备组成建模`
- **Project path:** Generated from `从导入数据生成示例项目` as admin using `import-carrier-day-night-001`.
- **User symptom:** In `装备组成树`, clicking `新增节点` does not make a new aircraft appear in the tree.
- **Expected behavior:** When the visible tree only has `飞机列表 0 类飞机`, clicking `新增节点` should create a new aircraft node under `飞机列表`.
- **Observed behavior:** Before the click, the tree shows `飞机列表 0 类飞机`. After clicking `新增节点`, the tree still shows `飞机列表 0 类飞机`, while the detail panel switches to a component named `新增子系统3` with `父节点=aircraft-root` and `所属飞机=装备`.
- **Evidence:** `equipment-add-node-no-aircraft.png`
- **Root cause evidence:** `front/app.js` routes `data-equipment-add-node` to `addEquipmentNodeForSelection()`. That function only calls `addEquipmentAircraftForSelection()` when `resolveSelectedEquipmentNode()` returns `kind === "aircraft-list"`. In this imported sample state, `wholeMachineModels()` is empty and `resolveSelectedEquipmentNode()` fell through to an existing component selection, so the add action created a component/subsystem instead of adding to `scenario.equipment.wholeMachineModels`.
- **Second blocker found during fix verification:** After forcing the zero-aircraft state to resolve as `aircraft-list`, clicking `新增节点` created `新增飞机1`, but rendering the tree hit `RangeError: Maximum call stack size exceeded`. The imported sample has a component row with `id=aircraft-root` and no `parentId`; `buildEquipmentComponentTreeNodes()` treated missing parent as `aircraft-root`, included that same row as a child of itself, and recursed indefinitely.
- **Fix:** `resolveSelectedEquipmentNode()` now returns `aircraft-list` when there are no whole-machine models. Both `buildEquipmentComponentTreeNodes()` and `buildReadonlyEquipmentConfigComponentTreeNodes()` now skip the current parent component id and carry a visited-id set through recursion so self-referential or cyclic component data cannot overflow the editable equipment composition tree or the read-only equipment config tree.
- **Regression tests:** `tests/frontend-contract.test.mjs` covers the zero-aircraft add target plus self-reference guards for the editable equipment composition tree and read-only equipment config tree.
- **Verification:** `node --test tests/frontend-contract.test.mjs --test-name-pattern "equipment tree add node follows|equipment tree root aircraft list can add"` passed with 73 tests before the read-only-tree review fix. After the review fix, `node --test tests/frontend-contract.test.mjs --test-name-pattern "support activity controls|equipment tree add node follows|equipment tree root aircraft list can add"` passed with 73 tests, and final `node --test` passed with 175 tests. Browser verification on `http://127.0.0.1:4173/front/` using admin import flow showed `飞机列表 1 类飞机`, `新增飞机1`, and no new `RangeError`. Browser verification on `修复性维修活动建模` showed the read-only `装备构型树` rendering `新增飞机1` and `雷达 LRU` without a `RangeError`.
- **Fixed evidence:** `equipment-add-node-aircraft-fixed.png`, `equipment-config-tree-readonly-fixed.png`

## Follow-up Data Completion

### 2. Imported sample Project now includes complete equipment, mission, and support data

- **Status:** Fixed locally.
- **Scope:** `从导入数据生成示例项目` using `import-carrier-day-night-001`.
- **Problem found after the first tree fix:** The imported sample package was too thin for real functional testing. It had only one mission profile, two equipment rows, one support resource, and one support activity. The generated Project therefore missed whole-machine models, rich component fields, mission phases, combat unit members, support organization inventory, activity jobs, logistics strategy, and reliability block diagram data.
- **Fix:** Expanded `tests/fixtures/modeling_import_project.json` to include J-15/J-35 whole-machine models, a complete equipment component tree, composite and periodic mission data, mission phases, combat unit members, three support nodes with inventory and transport policies, four support activity types with jobs, logistics transport strategies, RBD nodes/edges, and Monte Carlo sweep inputs. `modeling_import_to_project()` now preserves these imported business fields when projecting the published package into Project JSON. The frontend demo fixture is generated from the same complete package in `front/modeling-import-demo-fixture.mjs`.
- **Verification:** `node --test` passed with 176 tests. `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api -v` passed with 59 tests. Focused HTTP create-project verification confirms `equipment.wholeMachineModels=["J-15","J-35"]`, 8+ components, composite mission tasks, support inventories, and repair activity jobs are present in the create-project response.
- **Limitations:** `PYTHONPATH=. PYTHONDONTWRITEBYTECODE=1 uv run pytest -q -p no:cacheprovider` could not run full pytest collection in the `uv` environment because `jsonschema` is not installed there. The repository `.abm-mesa-test-env` has `jsonschema` but not `pytest`, so backend verification used `unittest` in that environment.

## Review Follow-up

### 3. Project-list imported-sample entry could call create-project with an unsaved fixture id

- **Status:** Fixed locally.
- **Review finding confirmed:** `front/app.js` initialized `MODELING_IMPORT_DEMO_FIXTURE` only in frontend state. The project-list button used `currentPublishedModelingImportId() || MODELING_IMPORT_DEMO_FIXTURE.importId` and then called `backendApi.createProjectFromModelingImport(importId)`. Because `/modeling-imports/{id}/create-project` requires a persisted and published backend modeling import, a fresh user could hit a failing default path.
- **Fix:** Added `front/modeling-import-project-flow.mjs`. `createSampleProjectFromPublishedImport()` now calls `ensurePublishedModelingImportForSampleProject()`: if a published import id exists it reuses it; otherwise it explicitly saves the demo fixture, publishes it, then calls create-project with the resolved published import id.
- **Regression tests:** `tests/frontend-modeling-import-flow.test.mjs` covers both the no-published-package save/publish/create prerequisite and the existing-published-package reuse path. `tests/frontend-contract.test.mjs` now asserts the project-list button no longer falls back directly to the fixture id.

### 4. Canonical formal runs were gated only in frontend memory

- **Status:** Fixed locally.
- **Review finding confirmed:** The frontend checked `currentProject.sourceKind === imported_sample`, but `/api/runs` accepted direct HTTP submissions without checking a persisted imported-sample source.
- **Fix:** `/api/runs` now marks requests as `formal_run` server-side. `RunService` fail-closes formal runs unless the Project JSON used for the run has `missionProfile.sourceImportId`, that import exists as a published modeling import whose `projectId` matches the run project, and the backend audit log has an allowed `modeling_import.create_project` event for the same import/project pair. The retired legacy run API now returns `410 legacy_run_api_retired`; canonical `/api/runs` is the only supported run entrypoint.
- **Regression tests:** `tests/test_backend_http_api.py::test_http_canonical_runs_reject_non_imported_sample_project` verifies direct `/api/runs` rejects a normal static project with `formal_run_requires_imported_sample`. `tests/test_backend_http_api.py::test_http_canonical_runs_reject_forged_import_source_project` verifies a manually saved Project cannot pass the gate by spoofing `missionProfile.sourceImportId`. `tests/test_backend_http_api.py::test_http_legacy_simulation_run_routes_are_retired` verifies retired legacy run API calls return `410 legacy_run_api_retired`. Canonical success and Monte Carlo tests now generate their projects from a published modeling import first.

### 5. Key regression coverage moved from source-only checks to behavior tests

- **Status:** Fixed locally.
- **Review finding confirmed:** Earlier tests primarily inspected source snippets for the equipment tree and imported project path.
- **Fix:** Added `front/equipment-tree-model.mjs` with pure tree/selection mutation helpers and kept `front/app.js` as the rendering layer. The same helpers drive app behavior and behavior-level tests.
- **Regression tests:** `tests/equipment-tree-model.test.mjs` verifies a zero-aircraft imported sample adds `新增飞机1`, and a self/cyclic component parent chain does not recurse indefinitely. `tests/frontend-modeling-import-flow.test.mjs` verifies the default project-list action completes the save/publish prerequisite instead of silently calling create-project with an unsaved fixture id.
- **Verification:** `node --test tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs tests/frontend-modeling-import-flow.test.mjs tests/equipment-tree-model.test.mjs` passed with 99 tests. `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api -v` passed with 60 tests.
