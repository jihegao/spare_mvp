# RMS Allocation Layout Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the system support equipment RMS allocation page so the current stage has a top parameter area, independent equipment-tree import, three supported allocation methods, and a bottom node allocation result table.

**Architecture:** Keep RMS allocation as its own workbench state in `front/app.js`; imported RMS tree data replaces only `rmsAllocationProject`, not the modeling `scenario`. Put method math and import normalization in `front/rms-allocation-engine.mjs`, render controls in `front/rms-allocation-workbench.mjs`, and cover the boundary with node tests.

**Tech Stack:** Vanilla ES modules, browser DOM events, Node `node:test`, CSS in `front/styles.css`.

---

### Task 1: Allocation Engine

**Files:**
- Modify: `front/rms-allocation-engine.mjs`
- Test: `tests/rms-allocation-engine.test.mjs`

- [x] Add `similar` as a reliability method using similar-product MTBF data and adjustment factors.
- [x] Add `createRmsEquipmentImportFixture()` and `normalizeRmsEquipmentImportRows()` so RMS tree imports are explicit workbench inputs.
- [x] Verify with `node --test tests/rms-allocation-engine.test.mjs`.

### Task 2: Workbench Layout

**Files:**
- Modify: `front/rms-allocation-workbench.mjs`
- Modify: `front/styles.css`
- Test: `tests/frontend-contract.test.mjs`

- [x] Move `任务可靠度`, `MTTR`, and `MTBF` into the top parameter area.
- [x] Place `装备树` and import controls on the left of the second row.
- [x] Place method selection, similar-product inputs, and the `计算` button on the right of the second row.
- [x] Keep only the bottom `节点分配结果` table as the primary lower section.

### Task 3: App Wiring

**Files:**
- Modify: `front/app.js`
- Test: `tests/frontend-contract.test.mjs`

- [x] Wire `导入表格` actions to update only `rmsAllocationProject`.
- [x] Parse JSON or CSV file imports from the hidden file input.
- [x] Keep publish behavior limited to `rms.target`.

### Task 4: Stage Note

**Files:**
- Modify: `docs/superpowers/plans/2026-06-25-ui-audit-todo.md`

- [x] Mark the RMS allocation layout and method-model slice as moved into the current stage.

### Verification

- [x] Run `node --test tests/rms-allocation-engine.test.mjs`.
- [x] Run `node --test tests/frontend-contract.test.mjs`.
- [x] Run `npm test`.

### Follow-Up: Equipment Selection And Method-Specific Parameters

**Files:**
- Modify: `front/rms-allocation-workbench.mjs`
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [x] Remove the plan-name heading from the parameter panel.
- [x] Remove the `导入 15→16 样例` button while keeping table import.
- [x] Add an equipment selector before rendering the selected equipment tree.
- [x] Show `基准机型` only for `相似产品分配法`, as a dropdown sourced from equipment roots.
- [x] Keep only the `计算` action in the method panel.
- [x] Verify with `node --test tests/frontend-contract.test.mjs` and `npm test`.
