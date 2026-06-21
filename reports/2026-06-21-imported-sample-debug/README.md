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

### 6. Aircraft model cannot be edited after selecting an aircraft node in composition tree

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 装备系统建模`。
- **Page:** `127.0.0.1:4173/front/#feature=spare-planning-equipment-composition`
- **User symptom:** 选择飞机列表中的整机节点（如 `J-15 整机级` 或 `J-35 整机级`）后，右侧“飞机属性”中的“飞机型号”无法修改。输入新值后，字段值会恢复/停留为原始型号（例如 `J-15`、`J-35`），不进行持久化。
- **Expected behavior:** 在“飞机属性”里编辑“飞机型号”后，值应更新为新型号并反映到当前节点属性与后续保存的数据中。
- **Observed behavior:** 编辑框显示可见且可聚焦，但输入动作无法生效，重新查看时仍为旧值。
- **Reproduction steps confirmed in-browser:**
  1. 在当前会话中打开 `127.0.0.1:4173/front/#feature=spare-planning-equipment-composition` 并确认已导入 `示例项目260621`。
  2. 在“装备组成树”中展开 `飞机列表`，点击 `J-15 整机级`。
  3. 在“飞机属性”中尝试修改 `飞机型号`（直接输入新字符串）。
  4. 切换离开字段或重新触发焦点后，查看模型名仍为原值。
- **Potential impact:** 影响整机级节点属性编辑与项目建模完整性，后续仿真输入与结果一致性都可能受损。
- **Priority:** 高（表单编辑面影响基础建模能力）。
- **Fix:** `front/app.js` 将“飞机型号”从只读字段改为可编辑字段，并新增整机型号重命名逻辑，同步更新 `equipment.wholeMachineModels`、`equipment.model`、组件 `aircraftModel`、基本任务 `equipmentType`、战斗单元机型和保障资源适用机型引用。
- **Verification:** `node --check front/app.js` passed. `node --test tests/frontend-contract.test.mjs tests/equipment-tree-model.test.mjs` passed with 80 tests.

### 7. Imported project has no support organization tree, so initial tree cannot be formed

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 保障组织建模`。
- **User symptom:** 在“保障组织建模”中，导入项目数据没有形成保障组织树，页面无法显示可编辑的初始组织树。
- **Expected behavior:** 导入项目数据后，应根据项目中的保障组织、保障节点或相关组织结构字段生成初始保障组织树，供用户继续编辑。
- **Observed behavior:** 当前导入项目数据中没有可用的保障组织树，导致初始树为空或无法形成。
- **Potential impact:** 影响保障组织、人员、设备、备件等后续保障建模入口，导入示例项目无法支撑完整建模流程。
- **Priority:** 高（基础建模数据缺失，阻断保障组织建模）。
- **Fix:** `front/app.js` 的 `supportOrganizationTree()` 在显式 `supportOrganization.tree` 为空时，会基于导入 Project 的 `supportNodes` 生成根节点“保障组织”和各保障节点子节点，形成可显示的初始组织树。
- **Verification:** `node --check front/app.js` passed. `node --test tests/frontend-contract.test.mjs tests/equipment-tree-model.test.mjs` passed with 80 tests.

### 8. Basic support activity edit button does not open an editor

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 基本保障活动建模`。
- **User symptom:** 在“基本保障活动建模”页面，点击基本保障活动行或卡片中的“编辑”按钮后，没有出现编辑窗或可编辑表单。
- **Expected behavior:** 点击“编辑”后，应打开对应基本保障活动的编辑窗、详情面板或可编辑区域，允许修改活动名称、编码、工时、资源消耗等字段。
- **Observed behavior:** 点击“编辑”按钮无可见编辑窗，用户无法进入基本保障活动编辑流程。
- **Potential impact:** 阻断基本保障活动维护，影响后续保障活动组合、资源消耗和仿真输入完整性。
- **Priority:** 高（核心建模表单入口不可用）。
- **Fix:** `front/app.js` 在基本保障活动表格下方新增“基本保障活动编辑”面板；点击“编辑”后选中单条活动并显示名称、编号、工期、人员、设备、弹药、备件等字段，字段修改会回写到 `supportActivities[].jobs[]`。
- **Verification:** `node --check front/app.js` passed. `node --test tests/frontend-contract.test.mjs tests/equipment-tree-model.test.mjs` passed with 80 tests.

### 9. Activity and basic mission modeling trees are missing the aircraft-list root node

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径包括 `备件规划评估模块 / 仿真建模 / 使用保障活动建模` 和 `备件规划评估模块 / 仿真建模 / 基本任务建模`。
- **User symptom:** “使用保障活动建模树”和“基本任务结构树”没有包含根节点“飞机列表”。
- **Expected behavior:** 两个树结构都应以根节点“飞机列表”作为顶层入口，再向下展示飞机型号、任务或保障活动关联节点，保持与装备组成建模中的飞机列表根节点一致。
- **Observed behavior:** 当前树中缺少“飞机列表”根节点，用户无法从飞机列表这一统一根入口理解或维护任务/活动与飞机型号之间的关系。
- **Potential impact:** 影响导入项目后跨页面建模结构的一致性，也会让任务、活动与装备整机的绑定关系不清晰。
- **Priority:** 中高（结构建模一致性问题，可能影响后续编辑入口和数据归属理解）。
- **Fix:** `front/app.js` 为“基本任务结构树”新增虚拟根节点“飞机列表”，下挂各飞机型号和基本任务；为“使用保障活动建模树”新增虚拟根节点“飞机列表”，下挂飞机型号和保障活动节点。无飞机型号时仍保留“飞机列表”根节点和活动节点。
- **Verification:** `node --check front/app.js` passed. `node --test tests/frontend-contract.test.mjs tests/equipment-tree-model.test.mjs` passed with 80 tests.

### 10. Composite task timeline merges same basic task across different formations

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 复合任务建模`。
- **User symptom:** 在一个复合任务中，选择了两个相同的基本任务，但编队不同时，时间轴没有按编队拆开显示。
- **Expected behavior:** 相同基本任务如果属于不同编队，应在复合任务时间轴中形成两条独立时间轴，分别展示各编队的出动/执行时间。
- **Observed behavior:** 当前时间轴按基本任务合并展示，导致不同编队的同一基本任务被合并到同一条时间轴中。
- **Potential impact:** 影响复合任务编排可读性，用户无法区分不同编队对同一基本任务的并行或错峰执行关系。
- **Priority:** 中高（任务编排展示逻辑错误，可能误导时间计划配置）。
- **Resolved note:** 需要确认时间轴分组键应为 `基本任务 + 编队`，还是应优先使用任务项唯一编号/波次编号。

### 11. Composite task basic-task rows cannot edit required and minimum equipment quantities

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 复合任务建模`。
- **User symptom:** 在一个复合任务中添加基本任务后，任务项中的“要求装备数量”和“最小装备数量”不能修改。
- **Expected behavior:** 复合任务中的每个基本任务项应允许单独编辑“要求装备数量”和“最小装备数量”，以表达不同编队、波次或任务项的装备需求差异。
- **Observed behavior:** 当前添加到复合任务中的基本任务项无法修改这两个数量字段，导致只能沿用默认值或基础任务定义值。
- **Potential impact:** 阻断复合任务编队/波次级装备需求配置，可能导致后续任务可靠度和资源需求计算输入不准确。
- **Priority:** 高（核心任务编排参数不可编辑）。
- **Resolved note:** 需要确认这两个字段应写入复合任务项自身，还是回写引用的基本任务定义；从用户操作语义看更适合写入复合任务项级覆盖值。

### 12. Basic mission support activity should be a single-select sourced from same-aircraft operations support plans

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 基本任务建模`。
- **User symptom:** “基本任务建模”中的“使用保障活动”字段不符合选择规则。
- **Expected behavior:** “使用保障活动”应为单选控件，选项来自“保障活动建模”中相同机型的“使用保障活动建模”的方案名称。
- **Observed behavior:** 当前“使用保障活动”不是按相同机型的使用保障活动方案名称提供单选来源，用户可能手填或选择到不匹配的保障活动。
- **Potential impact:** 基本任务与使用保障活动的绑定关系不受控，可能导致任务输入引用错误机型或错误保障方案。
- **Priority:** 高（跨页面建模引用规则错误）。
- **Resolved note:** 需要确认使用保障活动方案与机型的关联字段来源，例如 `equipmentId`、`aircraftModel`、`equipmentType`，或是否需要在使用保障活动建模中补充显式适用机型字段。

### 13. Operations support activity tree lacks imported plan-name hierarchy and auto-created phase nodes

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 使用保障活动建模`。
- **User symptom:** “使用保障活动建模树”的初始导入数据没有按期望层级展示保障方案名称，也没有自动包含飞行前/再次出动/飞行后三类保障活动节点。
- **Expected behavior:** 初始导入数据应形成树结构：`飞机列表 -> 机型 -> 保障方案名称（如：满挂载方案 / 应急出动方案） -> 飞行前准备 / 再次出动准备 / 飞行后检查`。创建“保障方案名称”节点时，应自动创建末级三类节点：`飞行前准备`、`再次出动准备`、`飞行后检查`。
- **Observed behavior:** 当前“使用保障活动建模树”没有体现“保障方案名称”层级，也未按创建方案名称节点的规则自动生成三类末级保障活动节点。
- **Potential impact:** 使用保障活动建模缺少方案级组织结构，后续基本任务无法按相同机型选择正确的使用保障活动方案名称，也无法维护三类标准使用保障活动。
- **Priority:** 高（使用保障活动建模核心树结构缺失）。
- **Resolved note:** 需要确认导入 JSON 中应如何表达保障方案名称节点，以及“飞行前准备 / 再次出动准备 / 飞行后检查”是固定模板节点还是可由业务配置扩展。

### 14. Preventive maintenance activity tree includes work-item names below the activity leaf

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 预防性维修活动建模`。
- **User symptom:** “预防性维修活动建模树”的叶子节点已经到“预防性维修活动”层级，但树中继续包含具体工作名称。
- **Expected behavior:** 预防性维修活动建模树的叶子节点应停留在预防性维修活动本身，例如 `8小时定检`；不应在树节点下继续展示该方案下的“工作项目清单”具体工作名称。
- **Observed behavior:** 当前树在 `8小时定检` 等预防性维修活动节点下继续展示具体工作项目名称。
- **Potential impact:** 树结构层级过深且职责混淆，工作项目清单应在右侧表格/详情中维护，而不是作为预防性维修活动树的子节点。
- **Priority:** 中高（树结构与编辑区域职责不一致，影响建模认知）。
- **Resolved note:** 需要确认预防性维修活动树是否应统一采用 `飞机列表 -> 机型 -> 维修活动方案名称` 的结构，工作项目仅保留在详情表格中。

### 15. Corrective maintenance equipment configuration tree cannot select equipment components

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 修复性维修活动建模`。
- **User symptom:** 在“修复性维修活动建模”页面，左侧“装备构型树”中的装备组件不能点选。
- **Expected behavior:** 用户应能点击装备构型树中的整机、分系统或 LRU 组件节点，并在右侧维护与该装备组件相关的修复性维修活动配置。
- **Observed behavior:** 当前装备构型树展示为只读参考，点击装备组件不会形成选中态或切换到对应组件的维修活动配置。
- **Potential impact:** 修复性维修活动无法绑定到具体装备组件，影响故障/维修方案与装备构型之间的建模关系。
- **Priority:** 高（修复性维修活动的装备对象选择入口不可用）。
- **Resolved note:** 需要确认选中组件后右侧应展示组件级维修活动列表，还是在现有修复性维修方案表单中写入 `equipmentId` / `componentId`。

### 16. Support resource lists cannot add or edit resources, and spare names/models are not sourced from LRU components

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径包括 `备件规划评估模块 / 仿真建模 / 备件建模`、`保障人员建模`、`保障设备建模`。
- **User symptom:** 资源清单中的“新增”和“编辑”按钮无法使用；备件资源清单中的“名称”和“型号”没有从装备构型中建立的 LRU 自动读取。
- **Expected behavior:** `备件建模`、`保障人员建模`、`保障设备建模` 的资源清单应支持新增和编辑。备件清单的名称、型号应自动来自装备构型中标记为 LRU 的组件，保证备件与装备组成一致。
- **Observed behavior:** 当前资源清单中的“新增”和“编辑”按钮不可用或无有效编辑动作；备件名称/型号不是基于装备构型 LRU 自动生成。
- **Potential impact:** 阻断保障资源维护；备件数据可能与装备构型脱节，影响备件需求、库存和维修活动输入一致性。
- **Priority:** 高（资源建模入口不可用，且跨页面数据来源规则缺失）。
- **Resolved note:** 需要确认新增资源应写入 `supportNodes[].inventory`、`supportResourceOverrides`，还是新增独立资源表；备件 LRU 来源应读取 `productType === "LRU"`、`spareType === "LRU"`，还是两者兼容。

### 17. Support activity job-list edit buttons do not open editors

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径包括 `备件规划评估模块 / 仿真建模 / 使用保障活动建模`、`预防性维修活动建模`、`修复性维修活动建模`。
- **User symptom:** 三类保障活动页面中，“工作项目清单”数据项的“编辑”按钮无法使用。
- **Expected behavior:** 点击工作项目清单中的“编辑”按钮后，应打开对应工作项目的编辑窗、详情面板或行内编辑区域，允许修改工作名称、编号、紧前作业、工期、人员、设备、弹药、备件等字段。
- **Observed behavior:** 当前“编辑”按钮没有打开可见编辑界面，用户无法修改工作项目清单数据项。
- **Potential impact:** 阻断使用保障、预防性维修、修复性维修的工作项目维护，影响保障活动流程和仿真输入完整性。
- **Priority:** 高（核心工作项目编辑入口不可用）。
- **Resolved note:** 需要确认三类保障活动是否复用同一工作项目编辑器，还是每类活动有不同字段集和校验规则。

### 18. Support organization details remain read-only and tree add/delete constraints are incomplete

- **Status:** Fixed locally.
- **Scope:** 导入示例项目 `260621`，功能路径 `备件规划评估模块 / 仿真建模 / 保障组织结构建模`。
- **User symptom:** “保障组织结构建模”页面中，组织详情编辑框仍不可编辑；保障组织结构树的新增/删除能力和最多三级节点约束没有完整闭合。
- **Expected behavior:** 保障组织结构建模应保留“新增节点”和“删除”按钮，删除“编辑/导入”按钮；组织详情字段应可编辑；组织树最多只能建立三级节点。
- **Observed behavior:** 当前组织详情仍以只读字段展示，新增节点按钮处于禁用状态，删除和三级约束未形成完整可用流程。
- **Potential impact:** 阻断保障组织结构维护，影响后续保障人员、设备、备件资源归属。
- **Priority:** 高（保障组织建模基础编辑能力不完整）。
- **Resolved note:** 需要确认新增节点写入 `supportOrganization.tree` 后是否需要同步 `supportNodes`，以及删除节点时如何处理已挂载资源。

## 2026-06-21 Fix Batch for Issues 10-18

- **Status:** Fixed locally in `front/app.js`.
- **Issue 10:** 复合任务时序图按 `基本任务 / 编队` 分组，同一基本任务在不同编队下会拆成独立时间轴。
- **Issue 11:** 复合任务项的装备类型、任务时长、要求装备数量、最小装备数量均保留在任务项自身并可编辑。
- **Issue 12:** 基本任务“使用保障活动”改为单选，选项来自同机型使用保障活动方案名称。
- **Issue 13:** 使用保障活动树改为 `飞机列表 -> 机型 -> 方案名称 -> 飞行前准备 / 再次出动准备 / 飞行后检查`。
- **Issue 14:** 预防性维修活动树叶子节点停留在维修活动本身，不再展示工作项目名称。
- **Issue 15:** 修复性维修装备构型树支持点选整机/组件，并在右侧显示当前维修对象。
- **Issue 16:** 保障人员、保障设备、备件清单新增按钮接入数据写回；编辑按钮形成选中态；备件名称/型号从装备构型 LRU 自动派生。
- **Issue 17:** 使用保障、预防性维修、修复性维修的工作项目编辑按钮会打开统一编辑面板并回写字段。
- **Issue 18:** 保障组织详情字段可编辑；组织树支持新增/删除，且新增受最多三级节点约束。
- **Regression tests:** `tests/page-revision-status.test.mjs` includes contract assertions for issues 10-18.
