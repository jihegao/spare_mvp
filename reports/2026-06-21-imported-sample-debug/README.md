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
