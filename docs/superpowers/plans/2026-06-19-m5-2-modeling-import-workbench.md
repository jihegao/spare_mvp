# M5.2 Modeling Import Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M5.2 import workbench entry, mapping/error/version preview, and backend Scenario preview through `SimulationAdapter`.

**Architecture:** Backend stays orchestration-only: `BackendApi` maps a valid persisted published modeling import to a minimal `project-v0` and delegates Scenario generation to `SimulationAdapter.compile_scenario()`. `modeling_imports` keeps separate draft and published payloads so version diff survives refresh/restart. Frontend adds a dedicated import workbench module and pure preview/diff helpers, then `front/app.js` wires the feature entry and explicit button handlers. Docs name M5.2 as an import workbench and Scenario preview slice.

**Tech Stack:** Python `unittest`, standard-library HTTP server, SQLite repository, Node `node:test`, browser-native ES modules.

---

### Task 1: Backend Import-To-Scenario Boundary

**Files:**
- Modify: `src/spare_mvp_backend/modeling_import.py`
- Modify: `src/spare_mvp_backend/api.py`
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_api_contract.py`
- Test: `tests/test_backend_http_api.py`

- [ ] **Step 1: Write failing API tests**

Add tests to `tests/test_backend_api_contract.py`:

```python
def test_compile_modeling_import_scenario_requires_published_valid_import(self) -> None:
    import_package = self._fixture("modeling_import_project.json")
    self.api.save_modeling_import(import_package)

    with self.assertRaises(BackendApiError) as ctx:
        self.api.compile_modeling_import_scenario(import_package["importId"])

    self.assertEqual(ctx.exception.code, "unpublished_modeling_import")

def test_compile_modeling_import_scenario_uses_simulation_adapter(self) -> None:
    import_package = self._fixture("modeling_import_project.json")
    self.api.save_modeling_import(import_package)
    self.api.publish_modeling_import(import_package["importId"])

    compiled = self.api.compile_modeling_import_scenario(import_package["importId"])

    self.assertEqual(compiled["compiled_from_import"]["import_id"], import_package["importId"])
    self.assertEqual(compiled["project"]["project_id"], import_package["projectId"])
    self.assertEqual(compiled["scenario"]["project_id"], import_package["projectId"])
    self.assertEqual(compiled["scenario"]["compiled_by"], "Simulation Adapter Agent")
    self.assertEqual(len(self.adapter.compile_calls), 1)
    self.assertEqual(self.adapter.compile_calls[0][1], "smoke")
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: FAIL because `compile_modeling_import_scenario` does not exist.

- [ ] **Step 2: Write failing HTTP test**

Add a test to `tests/test_backend_http_api.py` that saves and publishes the fixture, then calls:

```text
POST /api/modeling-imports/{import_id}/compile-scenario
```

Expected response includes `scenario.compiled_by == "Simulation Adapter Agent"` and `compiled_from_import.import_id`.

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: FAIL because the HTTP route does not exist.

- [ ] **Step 3: Implement mapping and API method**

In `src/spare_mvp_backend/modeling_import.py`, add:

```python
def modeling_import_to_project(import_package: dict[str, Any]) -> dict[str, Any]:
    objects = import_package.get("objects", {})
    mission = _first_dict(objects.get("missionProfiles")) or {}
    equipment_assets = [row for row in objects.get("equipmentAssets", []) if isinstance(row, dict)]
    resources = [row for row in objects.get("supportResources", []) if isinstance(row, dict)]
    activities = [row for row in objects.get("supportActivities", []) if isinstance(row, dict)]
    return {
        "schema_version": "project-v0",
        "project_id": str(import_package["projectId"]),
        "project_version": f"import-v{int(import_package.get('lifecycle', {}).get('version') or 1)}",
        "scenarioId": str(import_package["importId"]).replace("_", "-"),
        "activeModule": "sparePlanning",
        "airports": [],
        "missionAreas": [],
        "experiment": {"seed": 20260619, "steps": max(1, int(float(mission.get("durationHours") or 1)))},
        "missionProfile": {"sourceImportId": import_package["importId"], "durationHours": mission.get("durationHours")},
        "basicMission": {"minRequiredSorties": max(1, len(activities))},
        "missionPhases": [],
        "combatUnit": {},
        "equipment": {"minRequiredSorties": max(1, len(equipment_assets))},
        "components": [_equipment_asset_to_component(row) for row in equipment_assets],
        "supportNodes": [_support_resource_to_node(row) for row in resources],
        "supportActivities": activities,
        "reliabilityBlockDiagram": {},
        "monteCarlo": {"spareMultipliers": [1]},
    }
```

Add private helpers for `_first_dict`, `_equipment_asset_to_component`, `_support_resource_to_node`, and safe numeric conversion.

In `BackendApi`, add:

```python
def compile_modeling_import_scenario(self, import_id: str, model_family: str = "smoke") -> dict[str, Any]:
    import_package = self.repository.get_modeling_import(import_id)
    validation = self.validate_modeling_import(import_package)
    if not validation["ok"]:
        raise BackendApiError("invalid_modeling_import", "Modeling import package failed validation", issues=validation["issues"])
    if import_package.get("lifecycle", {}).get("state") != "published":
        raise BackendApiError("unpublished_modeling_import", "Modeling import must be published before Scenario compilation", import_id=import_id)
    project = modeling_import_to_project(import_package)
    try:
        scenario = self.adapter.compile_scenario(project, model_family=model_family)
    except AdapterError as exc:
        raise self._to_backend_error(exc, model_family) from exc
    return {
        "compiled_from_import": {
            "import_id": import_id,
            "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
            "project_id": project["project_id"],
            "model_family": model_family,
        },
        "project": project,
        "scenario": scenario,
    }
```

- [ ] **Step 4: Implement HTTP route**

In `src/spare_mvp_backend/http_server.py`, route:

```python
if self.command == "POST" and len(parts) == 3 and parts[0] == "modeling-imports" and parts[2] == "compile-scenario":
    return api.compile_modeling_import_scenario(parts[1], body.get("model_family", "smoke"))
```

- [ ] **Step 5: Verify backend tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_simulation_adapter
```

Expected: PASS.

### Task 2: Frontend Import Workbench

**Files:**
- Create: `front/modeling-import-workbench.mjs`
- Modify: `front/api-client.mjs`
- Modify: `front/feature-catalog.mjs`
- Modify: `front/app.js`
- Modify: `front/styles.css`
- Test: `tests/modeling-import-workbench.test.mjs`
- Test: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Write failing frontend helper tests**

Create `tests/modeling-import-workbench.test.mjs` covering:

```javascript
buildModelingImportPreview(fixture).rows maps four collections to page labels and field paths
diffModelingImports(published, draft) reports added / removed / changed field paths
renderModelingImportWorkbench(...) includes data-modeling-import-action controls and field issue paths
```

Run:

```bash
node --test tests/modeling-import-workbench.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Write failing API client test**

Extend `tests/frontend-api-client.test.mjs` to expect:

```javascript
compileModelingImportScenario(importId) -> POST /modeling-imports/:id/compile-scenario
```

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: FAIL because the method does not exist.

- [ ] **Step 3: Implement frontend module**

Create `front/modeling-import-workbench.mjs` exporting:

```javascript
export function cloneModelingImportPackage(value) { return JSON.parse(JSON.stringify(value)); }
export function buildModelingImportPreview(importPackage) { ... }
export function diffModelingImports(publishedPackage, draftPackage) { ... }
export function renderModelingImportWorkbench(state, helpers) { ... }
```

The renderer must show:

- import ID, lifecycle state, version, validation status
- mapping preview rows for mission profiles, equipment assets, support resources, support activities
- issue table with `page`, `object_id`, `field_path`, `message`
- diff table with added/removed/changed rows
- explicit buttons with `data-modeling-import-action="load-fixture"`, `validate`, `save-draft`, `publish`, and `compile-scenario`

- [ ] **Step 4: Wire API client**

Add `compileModelingImportScenario(importId, modelFamily = "smoke")` to `createBackendApiClient`.

- [ ] **Step 5: Wire app entry and handlers**

In `front/feature-catalog.mjs`, add `建模数据导入` under `系统管理 / 项目管理`.

In `front/app.js`:

- import `renderModelingImportWorkbench`, `cloneModelingImportPackage`, `diffModelingImports`
- initialize M5.2 state from the backend `GET /modeling-imports/{id}` envelope when available, with an embedded demo fixture fallback
- add `modeling-import-workbench` component branch
- handle explicit `data-modeling-import-action` clicks by calling `backendApi.validateModelingImport`, `saveModelingImport`, `publishModelingImport`, and `compileModelingImportScenario`
- preserve the existing generic edit handler boundary

- [ ] **Step 6: Style workbench**

Add `.modeling-import-workbench` styles near the RMS workbench styles. Keep cards flat, compact, and operational.

- [ ] **Step 7: Verify frontend tests**

Run:

```bash
node --test tests/modeling-import-workbench.test.mjs tests/frontend-api-client.test.mjs tests/modeling-import-contract.test.mjs
```

Expected: PASS.

### Task 3: Docs Alignment

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/simulation-service-governance.md`
- Modify: `agent.md`

- [ ] **Step 1: Search current M5 wording**

Run:

```bash
rg -n "M5|modeling import|建模数据入口|建模数据导入|Scenario|SimulationAdapter|Excel|worker|aviation_support" README.md docs agent.md
```

- [ ] **Step 2: Update docs**

Docs must state:

```text
M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/后端可恢复版本预览，以及经 SimulationAdapter 编译的后端 Scenario 预览。它仍不包含完整 Excel 解析、worker 基础设施、权限/审计或 aviation_support 编译解锁。
```

- [ ] **Step 3: Verify docs wording**

Run:

```bash
rg -n "M5\\.2|建模数据导入|compile-scenario|SimulationAdapter" README.md docs agent.md
git diff --check
```

Expected: the new stage is discoverable and no whitespace errors are reported.

### Task 4: Final Verification And Review

**Files:**
- Read: `git diff`
- Read: `git status --short --branch`

- [ ] **Step 1: Focused verification**

Run:

```bash
node --test tests/modeling-import-workbench.test.mjs tests/frontend-api-client.test.mjs tests/modeling-import-contract.test.mjs
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_simulation_adapter
```

Expected: PASS.

- [ ] **Step 2: Full verification**

Run:

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Multi-agent review**

Run at least two reviewer subagents:

1. Spec compliance reviewer against `docs/superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md`.
2. Code quality reviewer focused on frontend/backend boundaries, explicit-save behavior, and `SimulationAdapter` ownership.

Fix Critical and Important findings before final response.
