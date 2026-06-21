# Imported JSON Single Source And Static Business Data Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前台静态业务数据退场，建立 `tests/fixtures/modeling_import_project.json` -> published modeling import -> Project draft ->页面/RunIntent 的单一示例数据源。

**Architecture:** `tests/fixtures/modeling_import_project.json` 是唯一完整业务示例源；前端 demo import fixture 从该 JSON 派生或同步校验，不再维护第二份业务样例。`defaultScenario` 只保留最小 schema 空壳和本地预览边界；建模页必须在缺少 imported JSON 数据时显示空态，不能用 `SUPPORT_*`、`MISSION_*`、项目 seed 或模拟器默认值自动补业务样例。正式 run 继续只接受 imported sample Project，M8 projection payload 和 M9 state stream 不在本切片内实现。

**Tech Stack:** Node.js `node:test`, Python `unittest`, existing browser frontend modules under `front/`, existing backend import conversion in `src/spare_mvp_backend/modeling_import.py`, existing docs in `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`.

---

## Main-Control Execution Model

主控 agent 负责进度管理，不直接跳过门禁：

1. 每个任务由一个 fresh worker subagent 执行。实现 agent 必须在自己的响应里列出改动文件、验证命令和提交 SHA。
2. 每个任务完成后，主控先派 spec reviewer subagent 检查该任务是否满足本计划；有缺项就退回修复。
3. 规格通过后，主控再派 code-quality reviewer subagent 检查实现质量、回归风险和文档一致性。
4. 有 Critical 或 Important 问题时，主控把问题派回同一任务的 worker 修复，再重新评审。
5. 每个任务通过双评审后单独提交；最终再做一次全局评审和全量验证。

Subagent 分阶段安排：

| Phase | Worker ownership | Reviewer focus | Commit |
| --- | --- | --- | --- |
| 1 | `tests/`, fixture loading contracts | 缺数据空态和完整 JSON 显示契约是否覆盖真实风险 | `test: lock imported json data-source boundary` |
| 2 | `front/modeling-import-demo-fixture.mjs`, `tests/fixtures/modeling_import_project.json`, import fixture tests | 是否消除双业务样例源，不引入运行时文件读取 | `refactor: derive demo import fixture from canonical json` |
| 3 | `front/app.js`, focused frontend helpers/tests | 页面是否停止静态业务 fallback，正式 run gate 是否保持不变 | `feat: demote static frontend business data to empty states` |
| 4 | `src/spare_mvp_backend/modeling_import.py`, backend tests | JSON 字段是否完整进入 Project draft，缺字段是否显式为空 | `feat: map imported json into complete project draft` |
| 5 | `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md` | 文档是否说清 M6.2.x 边界，未声称 M8/M9 已完成 | `docs: document imported json single-source boundary` |

Do not implement worker queues, cancellation/retry, object storage, M8 projection payload rendering, M9 state replay/streaming, full Excel parser, new auth scope, or `aviation_support` formal execution in this plan.

---

## File Structure

- Modify: `tests/fixtures/modeling_import_project.json`
  - Canonical complete business example for modeling import.
  - Must include project basics, equipment tree, RMS/failure/repair fields, basic/composite/periodic tasks, combat unit, support organization/resource/activity fields, RBD nodes/edges, Monte Carlo sweep, and `analysisRequests`.
- Modify: `front/modeling-import-demo-fixture.mjs`
  - Keep as a JS module wrapper for the canonical JSON payload. It must not drift into a separate business source.
- Modify: `front/sim-engine.mjs`
  - Reduce `defaultScenario` to a minimal schema-valid empty shell for local preview.
  - Simulation helpers may keep explicit preview defaults only inside preview/test execution, not page data hydration.
- Modify: `front/app.js`
  - Remove automatic business sample fallback from project, mission, equipment, support organization, support resource, support activity, experiment and MC page state.
  - Empty imported data renders empty states with import/create guidance.
  - Existing preview labels remain explicit.
- Modify: `src/spare_mvp_backend/modeling_import.py`
  - Extend `validate_modeling_import_package()` and `modeling_import_to_project()` to preserve the canonical JSON fields needed by pages.
- Modify: `tests/frontend-contract.test.mjs`
  - Guard source boundaries by code and rendered-page contract.
- Modify: `tests/modeling-import-contract.test.mjs`
  - Validate canonical fixture shape and missing collection behavior.
- Modify: `tests/sim-engine.test.mjs`
  - Update from sample-data assertions to empty-shell assertions plus explicit preview simulation assertions.
- Modify: `tests/test_backend_api_contract.py`
  - Verify backend conversion from canonical import to full Project draft and missing optional collection empty state.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`
  - Align status and boundaries.

---

## Task 1: Lock The Imported JSON Data-Source Boundary

**Files:**
- Modify: `tests/modeling-import-contract.test.mjs`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `tests/sim-engine.test.mjs`

- [ ] **Step 1: Add fixture-shape contract for the canonical JSON**

Add this helper to `tests/modeling-import-contract.test.mjs`:

```js
import { readFileSync } from "node:fs";

function canonicalImportFixture() {
  return JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
}
```

Add this test:

```js
test("canonical modeling import fixture covers all project authoring surfaces", () => {
  const fixture = canonicalImportFixture();
  const objects = fixture.objects;
  const mission = objects.missionProfiles[0];

  assert.equal(fixture.schemaVersion, "modeling-import-v1");
  assert.ok(fixture.importId);
  assert.ok(fixture.projectId);
  assert.ok(objects.projectInfo || mission.experiment);
  assert.ok(Array.isArray(objects.equipmentAssets) && objects.equipmentAssets.length >= 1);
  assert.ok(objects.equipmentAssets.some((asset) => asset.rms && asset.failureDistribution && asset.specialRepairProfile));
  assert.ok(mission.basicMission);
  assert.ok(Array.isArray(mission.compositeTasks));
  assert.ok(Array.isArray(mission.periodicTasks));
  assert.ok(mission.combatUnit);
  assert.ok(Array.isArray(objects.supportResources));
  assert.ok(objects.supportResources.some((resource) => resource.inventory && resource.transportPolicies));
  assert.ok(Array.isArray(objects.supportActivities));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "修复性维修"));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "预防性维修"));
  assert.ok(objects.supportActivities.some((activity) => activity.activityType === "后勤保障"));
  assert.ok(mission.reliabilityBlockDiagram?.nodes?.length >= 1);
  assert.ok(mission.reliabilityBlockDiagram?.edges?.length >= 1);
  assert.ok(mission.monteCarlo?.failureRates?.length >= 1);
  assert.ok(mission.analysisRequests?.largeSample || objects.analysisRequests?.largeSample);
});
```

- [ ] **Step 2: Add source-boundary tests for frontend static fallback**

Add this test to `tests/frontend-contract.test.mjs`:

```js
test("frontend business authoring pages do not hydrate missing imported data from static constants", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const staticSeedSource = appSource.slice(
    appSource.indexOf("const PROJECT_SOURCE"),
    appSource.indexOf("let scenario =")
  );
  const renderSlices = [
    appSource.slice(appSource.indexOf("function renderEquipmentModeling"), appSource.indexOf("function renderEquipmentFailureRmsFields")),
    appSource.slice(appSource.indexOf("function renderMissionModeling"), appSource.indexOf("function renderBasicMission")),
    appSource.slice(appSource.indexOf("function renderSupportOrg"), appSource.indexOf("function renderSupportResource")),
    appSource.slice(appSource.indexOf("function renderSupportActivity"), appSource.indexOf("function renderSimulationExperiment")),
    appSource.slice(appSource.indexOf("function renderSimulationExperiment"), appSource.indexOf("function renderMonteCarloExperimentList"))
  ].join("\n");

  assert.doesNotMatch(staticSeedSource, /const SUPPORT_ORG_TREE|const SUPPORT_ACTIVITY_PLANS|const MISSION_|const SUPPORT_/);
  assert.match(renderSlices, /导入|创建|暂无|空/);
  assert.doesNotMatch(renderSlices, /SUPPORT_ORG_TREE|SUPPORT_ACTIVITY_PLANS|CARRY_OBJECTIVES/);
});
```

- [ ] **Step 3: Replace default scenario data assertions with empty-shell assertions**

In `tests/sim-engine.test.mjs`, replace assertions that require aircraft names, tasks, support nodes or activities in `defaultScenario` with:

```js
test("default scenario is a schema-valid empty preview shell", () => {
  assert.deepEqual(validateScenario(defaultScenario), []);
  assert.equal(defaultScenario.schema_version, undefined);
  assert.deepEqual(defaultScenario.airports, []);
  assert.deepEqual(defaultScenario.missionAreas, []);
  assert.deepEqual(defaultScenario.components, []);
  assert.deepEqual(defaultScenario.supportNodes, []);
  assert.deepEqual(defaultScenario.supportActivities, []);
  assert.deepEqual(defaultScenario.equipment.wholeMachineModels, []);
  assert.deepEqual(defaultScenario.missionProfile.compositeTasks, []);
  assert.deepEqual(defaultScenario.missionProfile.periodicTasks, []);
});
```

Keep separate simulation behavior tests using an explicit local fixture created in the test file:

```js
function previewScenarioFixture() {
  const scenario = cloneScenario(defaultScenario);
  scenario.airports = [{ id: "base", name: "测试机场", distanceToMissionKm: 100 }];
  scenario.missionAreas = [{ id: "area", name: "测试任务区", distanceFromDepartureKm: 100 }];
  scenario.equipment.wholeMachineModels = ["TEST-AIRCRAFT"];
  scenario.equipment.quantity = 1;
  scenario.components = [{ id: "engine", name: "发动机", quantity: 1, failureRate: 0.02, mtbfHours: 50, spareType: "发动机" }];
  scenario.supportNodes = [{ id: "node", name: "保障点", capacity: 1, inventory: { "发动机": 1 } }];
  scenario.supportActivities = [{ id: "repair", name: "维修", equipmentId: "engine", resourceId: "node", durationHours: 1, spareType: "发动机", spareQuantity: 1 }];
  return scenario;
}
```

- [ ] **Step 4: Run failing tests**

Run:

```bash
npm test -- tests/modeling-import-contract.test.mjs tests/frontend-contract.test.mjs tests/sim-engine.test.mjs
```

Expected before implementation: FAIL because `front/app.js` still has static business constants and `defaultScenario` still carries sample business data.

- [ ] **Step 5: Commit**

After implementation tasks make these tests pass, commit this task's test changes with:

```bash
git add tests/modeling-import-contract.test.mjs tests/frontend-contract.test.mjs tests/sim-engine.test.mjs
git commit -m "test: lock imported json data-source boundary"
```

---

## Task 2: Make The Modeling Import Fixture A Wrapper Around The Canonical JSON

**Files:**
- Modify: `front/modeling-import-demo-fixture.mjs`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `tests/frontend-modeling-import-flow.test.mjs`
- Modify: `tests/fixtures/modeling_import_project.json`

- [ ] **Step 1: Extend canonical fixture with missing top-level authoring fields**

If missing, add these fields to `tests/fixtures/modeling_import_project.json`:

```json
{
  "objects": {
    "projectInfo": {
      "name": "导入示例项目",
      "baseCode": "IMPORTED-001",
      "summary": "由建模导入 JSON 生成的完整页面测试项目"
    },
    "supportOrganization": {
      "tree": []
    },
    "analysisRequests": {
      "largeSample": {
        "enabled": true,
        "samples": 24,
        "sweep": {
          "failureRates": [0.035, 0.055, 0.075],
          "spareMultipliers": [0.75, 1, 1.25],
          "supportCapacities": [2, 3, 4]
        }
      }
    }
  }
}
```

Do not remove existing mission-level fields; keep compatibility while backend conversion learns the new roots.

- [ ] **Step 2: Replace hand-maintained JS object with generated JSON module**

`front/modeling-import-demo-fixture.mjs` cannot import JSON directly in this repo without changing runtime assumptions. Replace its body with a single exported JS object whose value is exactly the parsed content of `tests/fixtures/modeling_import_project.json`, and add this header above the export:

```js
// Keep this object byte-for-byte aligned with tests/fixtures/modeling_import_project.json.
// The contract test in tests/frontend-contract.test.mjs fails if this wrapper drifts.
```

The worker must verify exact synchronization with the drift test in Step 3 before committing. Do not keep extra fields, comments inside the object, or front-end-only business values in this module.

- [ ] **Step 3: Add drift test**

Add this test to `tests/frontend-contract.test.mjs`:

```js
test("frontend modeling import demo fixture is synchronized with canonical JSON fixture", async () => {
  const canonical = JSON.parse(await readFile(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  assert.deepEqual(MODELING_IMPORT_DEMO_FIXTURE, canonical);
});
```

- [ ] **Step 4: Run fixture tests**

Run:

```bash
npm test -- tests/frontend-contract.test.mjs tests/frontend-modeling-import-flow.test.mjs tests/modeling-import-contract.test.mjs
```

Expected after implementation: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/modeling-import-demo-fixture.mjs tests/fixtures/modeling_import_project.json tests/frontend-contract.test.mjs tests/frontend-modeling-import-flow.test.mjs tests/modeling-import-contract.test.mjs
git commit -m "refactor: derive demo import fixture from canonical json"
```

---

## Task 3: Demote Frontend Static Business Data To Empty States

**Files:**
- Modify: `front/sim-engine.mjs`
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `tests/sim-engine.test.mjs`
- Modify: `tests/support-activity-jobs.test.mjs`

- [ ] **Step 1: Reduce `defaultScenario` to a schema-valid empty shell**

In `front/sim-engine.mjs`, keep object keys expected by the UI but empty business arrays:

```js
export const defaultScenario = {
  scenarioId: "preview-empty-shell",
  activeModule: "sparePlanning",
  airports: [],
  missionAreas: [],
  experiment: { name: "本地空白预览", steps: 24, samples: 0, seed: 20260621 },
  missionProfile: {
    name: "",
    durationHours: 0,
    compositeTasks: [],
    periodicTasks: []
  },
  basicMission: {},
  missionPhases: [],
  combatUnit: { members: [] },
  equipment: {
    model: "",
    wholeMachineModels: [],
    quantity: 0,
    initialReady: 0,
    minRequiredSorties: 0
  },
  components: [],
  supportNodes: [],
  supportActivities: [],
  reliabilityBlockDiagram: { nodes: [], edges: [] },
  monteCarlo: { failureRates: [], spareMultipliers: [], supportCapacities: [] },
  analysisRequests: {}
};
```

If `validateScenario()` rejects empty arrays or zero values that are now intentional for preview shell, update validation to distinguish required runtime Scenario from authoring shell. Do not add sample rows to make validation pass.

- [ ] **Step 2: Remove static business constants from page hydration**

In `front/app.js`, remove static business constants used as page data:

```js
const CARRY_OBJECTIVES = [...]
const SUPPORT_ORG_TREE = [...]
const SUPPORT_ACTIVITY_PLANS = [...]
```

Replace usage with data derived from `scenario` and empty-state helpers:

```js
function importedDataEmptyState(label) {
  return `
    <div class="empty-state">
      <strong>暂无${htmlEscape(label)}数据</strong>
      <p>请先导入并发布建模 JSON，或在当前页面创建数据。</p>
    </div>
  `;
}
```

Use this helper in equipment, mission, support organization, support resource, support activity, experiment and Monte Carlo pages when their corresponding arrays/objects are empty.

- [ ] **Step 3: Keep formal run gate unchanged**

Do not loosen `currentProjectCanStartFormalRun()`. It must still require:

```js
currentProject.sourceKind === PROJECT_SOURCE.imported_sample
```

Preview fixture or manual draft projects must still show the existing message:

```text
请先从已发布建模导入包生成示例项目，再启动正式后端运行
```

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm test -- tests/frontend-contract.test.mjs tests/sim-engine.test.mjs tests/support-activity-jobs.test.mjs
```

Expected after implementation: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/sim-engine.mjs front/app.js tests/frontend-contract.test.mjs tests/sim-engine.test.mjs tests/support-activity-jobs.test.mjs
git commit -m "feat: demote static frontend business data to empty states"
```

---

## Task 4: Expand Backend Import-To-Project Mapping

**Files:**
- Modify: `src/spare_mvp_backend/modeling_import.py`
- Modify: `tests/test_backend_api_contract.py`
- Modify: `contracts/modeling_import.schema.json` if schema blocks canonical fields

- [ ] **Step 1: Add backend conversion test for full canonical fixture**

Add this test to `tests/test_backend_api_contract.py`:

```python
def test_modeling_import_to_project_preserves_full_authoring_surfaces(self) -> None:
    import_package = self._fixture("modeling_import_project.json")
    saved_import = self.api.save_modeling_import(import_package)
    self.assertEqual(saved_import["validation_status"], "valid")
    self.api.publish_modeling_import(import_package["importId"])

    created = self.api.create_project_from_modeling_import(import_package["importId"])
    project = created["project"]

    self.assertEqual(project["project_id"], import_package["projectId"])
    self.assertEqual(project["missionProfile"]["sourceImportId"], import_package["importId"])
    self.assertGreaterEqual(len(project["components"]), 1)
    self.assertTrue(any(component.get("rms") for component in project["components"]))
    self.assertTrue(project["missionProfile"].get("compositeTasks") is not None)
    self.assertTrue(project["missionProfile"].get("periodicTasks") is not None)
    self.assertIn("combatUnit", project)
    self.assertIn("supportOrganization", project)
    self.assertIsInstance(project["supportNodes"], list)
    self.assertIsInstance(project["supportActivities"], list)
    self.assertIn("reliabilityBlockDiagram", project)
    self.assertIn("monteCarlo", project)
    self.assertIn("analysisRequests", project)
    self.assertIn("largeSample", project["analysisRequests"])
```

- [ ] **Step 2: Add backend conversion test for explicit empty collections**

Add:

```python
def test_modeling_import_to_project_preserves_explicit_empty_collections(self) -> None:
    import_package = self._fixture("modeling_import_project.json")
    import_package["importId"] = "import-empty-authoring-surfaces"
    import_package["projectId"] = "project-empty-authoring-surfaces"
    import_package["objects"]["equipmentAssets"] = []
    import_package["objects"]["supportResources"] = []
    import_package["objects"]["supportActivities"] = []
    import_package["objects"]["missionProfiles"][0]["compositeTasks"] = []
    import_package["objects"]["missionProfiles"][0]["periodicTasks"] = []
    import_package["objects"]["missionProfiles"][0]["combatUnit"] = {"members": []}

    self.api.save_modeling_import(import_package)
    self.api.publish_modeling_import(import_package["importId"])
    created = self.api.create_project_from_modeling_import(import_package["importId"])
    project = created["project"]

    self.assertEqual(project["components"], [])
    self.assertEqual(project["supportNodes"], [])
    self.assertEqual(project["supportActivities"], [])
    self.assertEqual(project["missionProfile"]["compositeTasks"], [])
    self.assertEqual(project["missionProfile"]["periodicTasks"], [])
    self.assertEqual(project["combatUnit"]["members"], [])
```

- [ ] **Step 3: Update conversion to preserve fields**

In `src/spare_mvp_backend/modeling_import.py`, extend `modeling_import_to_project()`:

```python
project_info = objects.get("projectInfo") if isinstance(objects.get("projectInfo"), dict) else {}
support_org = objects.get("supportOrganization") if isinstance(objects.get("supportOrganization"), dict) else {"tree": []}
analysis_requests = objects.get("analysisRequests") if isinstance(objects.get("analysisRequests"), dict) else mission.get("analysisRequests", {})
```

Ensure returned Project contains:

```python
"projectInfo": deepcopy(project_info),
"supportOrganization": deepcopy(support_org),
"analysisRequests": deepcopy(analysis_requests),
"combatUnit": _project_object(objects, mission, "combatUnit", {"members": []}),
"missionProfile": _mission_profile_to_project(mission, import_package["importId"]),
"reliabilityBlockDiagram": _project_object(objects, mission, "reliabilityBlockDiagram", {"nodes": [], "edges": []}),
"monteCarlo": _project_object(objects, mission, "monteCarlo", {"failureRates": [], "spareMultipliers": [], "supportCapacities": []}),
```

Preserve explicit empty arrays. Do not use `or default` for arrays because `[]` is meaningful.

- [ ] **Step 4: Run backend tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_to_project_preserves_full_authoring_surfaces tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_to_project_preserves_explicit_empty_collections -v
```

Expected after implementation: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spare_mvp_backend/modeling_import.py tests/test_backend_api_contract.py contracts/modeling_import.schema.json
git commit -m "feat: map imported json into complete project draft"
```

---

## Task 5: Align Roadmap And Active Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`

- [ ] **Step 1: Add the new plan to doc indexes**

Add a link to this file in `README.md` and `docs/README.md` next to the M6.2 RunIntent/MC convergence plan:

```md
- [`docs/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md`](docs/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md)：M6.2.x 前台静态业务数据退场、可导入 Project JSON 单一示例源和空态契约实施计划。
```

- [ ] **Step 2: Update roadmap with M6.2.x boundary**

In `docs/product-roadmap.md`, add after the M6.2 follow-on paragraph:

```md
M6.2.x 当前推进：在进入 M7 运行/产物管理前，先把前台建模和正式 run 功能测试的业务样例源收敛到 `tests/fixtures/modeling_import_project.json`。页面缺少 imported JSON 数据时必须显示空态或创建入口，不能由前端静态常量偷偷补出任务、装备、保障组织、保障活动或 Monte Carlo 配置；完整 JSON 导入后页面应显示 JSON 中的数据并可创建 imported sample Project。该切片只治理建模/运行输入源，不实现 M8 projection payload 驱动 KPI，也不实现 M9 state stream。
```

- [ ] **Step 3: Update `agent.md` operating rules**

Add:

```md
14. M6.2.x 输入源治理期间，`tests/fixtures/modeling_import_project.json` 是唯一完整业务示例源。前端页面缺少 imported JSON 数据时必须显示空态或创建入口，不得从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例；preview fixture 只能用于显式本地预览和测试 fallback。
```

- [ ] **Step 4: Run stale-language scan**

Run:

```bash
rg -n "静态数据已经全部删除|defaultScenario.*正式|runSimulation.*正式|runMonteCarlo.*正式|M8.*已完成|M9.*已完成" README.md docs agent.md front tests
```

Expected: no matches that claim static analysis cards, M8, or M9 are already fully removed or complete.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/README.md docs/product-roadmap.md agent.md docs/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md
git commit -m "docs: document imported json single-source boundary"
```

---

## Final Verification

主控 agent must run these commands fresh before claiming completion:

```bash
npm test -- tests/modeling-import-contract.test.mjs tests/frontend-contract.test.mjs tests/sim-engine.test.mjs tests/frontend-modeling-import-flow.test.mjs tests/support-activity-jobs.test.mjs
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_to_project_preserves_full_authoring_surfaces tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_to_project_preserves_explicit_empty_collections -v
rg -n "const SUPPORT_ORG_TREE|const SUPPORT_ACTIVITY_PLANS|const MISSION_|const SUPPORT_" front/app.js tests
rg -n "静态数据已经全部删除|defaultScenario.*正式|runSimulation.*正式|runMonteCarlo.*正式|M8.*已完成|M9.*已完成" README.md docs agent.md front tests
git diff --check
git status --short
```

Completion evidence must show:

1. The plan file exists and is linked from active docs.
2. Every task has a commit.
3. Tests prove missing imported JSON data renders empty states instead of static business fallback.
4. Tests prove complete imported JSON appears in frontend fixture and backend-created Project draft.
5. Docs preserve stage boundaries: M7 worker/artifact management, M8 projection payload, and M9 state stream remain future work.
6. Final code review has no open Critical or Important findings.
