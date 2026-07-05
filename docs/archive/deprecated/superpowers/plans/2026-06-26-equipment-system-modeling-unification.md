# Equipment System Modeling Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate equipment composition and equipment failure pages with one editable `装备系统建模` page.

**Architecture:** Keep the existing `equipment-table` component and equipment tree helpers, but change the page catalog to expose one system page and render the right side as a flattened component table. Preserve old route IDs as aliases so existing hashes and tests that navigate by legacy IDs land on the new page.

**Tech Stack:** Vanilla ES modules in `front/`, Node test runner, existing Python backend validation.

---

### Task 1: Catalog And Route Consolidation

**Files:**
- Modify: `front/feature-catalog.mjs`
- Modify: `front/app.js`
- Test: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Update feature catalog rows**

Replace `装备组成建模` and `装备故障建模` rows with a single `装备系统建模` row for both business modules. Add `装备系统建模: "equipment-system"` and map legacy IDs:

```js
"spare-planning-equipment-composition": "spare-planning-equipment-system",
"spare-planning-equipment-failure": "spare-planning-equipment-system",
"mission-reliability-equipment-composition": "mission-reliability-equipment-system",
"mission-reliability-equipment-failure": "mission-reliability-equipment-system",
```

- [x] **Step 2: Update default feature**

Change:

```js
const DEFAULT_FEATURE_ID = "spare-planning-equipment-composition";
```

to:

```js
const DEFAULT_FEATURE_ID = "spare-planning-equipment-system";
```

- [x] **Step 3: Update catalog tests**

Adjust expected page counts from 55 to 53, and assert the new page names and aliases instead of the removed page names.

### Task 2: Unified Equipment Table

**Files:**
- Modify: `front/app.js`
- Modify: `front/styles.css`
- Test: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Replace right-side selected-node form**

Render the left equipment composition tree unchanged, and replace the right detail form with a flattened table over `scenario.components`.

- [x] **Step 2: Add distribution dropdowns and parameter inputs**

Use one distribution option list for MTBF and MTTR:

```js
["固定值", "指数分布", "正态分布", "均匀分布", "三角分布", "威布尔分布"]
```

Render parameter inputs by distribution:

```js
固定值 -> MTBF or MTTR（min）
指数分布 -> 速率参数
正态分布 -> 均值, 方差
均匀分布 -> 最小值, 最大值
三角分布 -> 最小值, 最大值, 模数
威布尔分布 -> 形状参数(k), 尺度参数(λ)
```

- [x] **Step 3: Keep existing generic editing**

Use `data-path` inputs/selects for component fields and continue using `data-equipment-k-out-of-n-index` for k-out-of-n so existing change/input handlers normalize values.

### Task 3: Import And Compile Page Labels

**Files:**
- Modify: `front/modeling-import-contract.mjs`
- Modify: `src/spare_mvp_backend/modeling_import.py`
- Modify: `src/spare_mvp_contract/adapter.py`
- Test: `tests/modeling-import-contract.test.mjs`

- [x] **Step 1: Repoint equipment validation issues**

Change `equipmentAssets` page labels from `装备组成建模` to `装备系统建模` in front-end and back-end validation maps and compile issues.

- [x] **Step 2: Update tests**

Assert `MODELING_IMPORT_PAGE_MAP.equipmentAssets === "装备系统建模"`.

### Task 4: Verification

**Files:**
- Test: `tests/frontend-contract.test.mjs`
- Test: `tests/modeling-import-contract.test.mjs`
- Test: `tests/frontend-app-runtime.test.mjs`

- [x] **Step 1: Run focused tests**

Run:

```bash
node --test tests/frontend-contract.test.mjs tests/modeling-import-contract.test.mjs tests/frontend-app-runtime.test.mjs
```

Expected: all tests pass.

- [x] **Step 2: Run full JavaScript test suite if focused tests pass**

Run:

```bash
npm test
```

Expected: all Node tests pass.
