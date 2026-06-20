# Page Suggestion Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 2026-06-19 page review suggestions while preserving the M5.2 modeling-import workbench and keeping M6.1.1 input-alignment prerequisites explicit.

**Architecture:** Keep the current static frontend architecture in `front/app.js` and `front/feature-catalog.mjs`; implement page corrections as scoped renderer/event-handler updates with source-contract tests. Treat modeling data import as retained scope, and split broad page polish from M6.1.1-critical modeling input semantics.

**Tech Stack:** Browser-local JavaScript frontend, Node.js `node:test` contract tests, Python unittest backend smoke where user/session behavior is touched.

---

## Scope And File Structure

- Modify: `docs/review/页面修改建议260619.md`
  - Record that the modeling-import deletion request was canceled.
- Modify: `README.md`, `docs/README.md`, `docs/product-roadmap.md`, `agent.md`, `AGENT.md`
  - Document this page-suggestion slice and its relationship to M6.1.1.
- Modify: `front/app.js`
  - Project list actions and system-management entry.
  - System data-management tabs, user deletion, and permission configuration behavior.
  - Equipment, task, support organization, support resource, and support activity page fields/actions from the review list.
- Modify if needed: `front/feature-catalog.mjs`
  - Preserve modeling-import page; remove only pages whose deletion is still requested.
- Modify: `tests/frontend-contract.test.mjs`
  - Add/adjust source-contract tests for the review items that can be verified statically.
- Modify if needed: `tests/frontend-app-runtime.test.mjs`
  - Add runtime checks only for event handlers that are hard to prove by source tests.

Do not implement M6.1.1 in this slice. Do not delete the modeling-import workbench. Do not add Monte Carlo fan-out, worker infrastructure, object storage, M9 state streaming, or full Excel parsing.

---

## Task 1: Documentation And Scope Alignment

**Files:**
- Modify: `docs/review/页面修改建议260619.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `agent.md`
- Modify: `AGENT.md`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add a source-contract test for retained modeling-import scope**

Add a frontend contract test that asserts:

```js
assert.match(reviewSource, /已取消.*建模数据导入：删除此页面/);
assert.match(catalogSource, /建模数据导入/);
assert.match(appSource, /renderModelingImportWorkbench/);
```

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "page review keeps modeling import"
```

Expected before implementation: fail if the review doc still says to delete the page without the cancellation note.

- [x] **Step 2: Update roadmap and agent docs**

State that this slice executes `docs/review/页面修改建议260619.md` with the modeling-import page retained, and that M6.1.1 remains the next simulation-input boundary after M5/page-input usability is stable.

Run:

```bash
rg -n "页面修改建议260619|建模数据导入.*保留|M6\\.1\\.1" README.md docs/README.md docs/product-roadmap.md agent.md AGENT.md
```

Expected: every file has accurate scope language.

---

## Task 2: Project List And System Management Pages

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add contract coverage**

Assert project list uses `添加`, per-card `编辑` and `删除`, and exposes a `系统管理` entry. Assert data management renders 建模数据 / 实验配置 / 实验结果 tabs, modeling granularity only renders the 层级、对象及关系 table, user rows can be selected/deleted, and permission rows have a live configuration handler.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "page review project and system management"
```

Expected before implementation: fail on current labels and missing handlers.

- [x] **Step 2: Implement the minimal UI behavior**

Update `renderProjectListPage()`, `renderSystemProjectManagement()`, `renderUserManagementConfig()`, `renderPermissionManagementConfig()`, and click/change handlers so the controls are visible and non-dead. Local user deletion and permission configuration may remain browser-local, but must update state and show status.

Run the same test again.

Expected: PASS.

---

## Task 3: Equipment And Mission Modeling Pages

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add contract coverage**

Assert equipment composition removes the edit/import buttons and spare-type field, renames LRU to 组件属性 with LRU/SRU/empty semantics, shows 数量, and constrains N中取K to `0 < k <= 数量` only when quantity > 1. Assert equipment failure fields expose MTBF, failure distribution type, Weibull parameters, repair-time distribution, and distribution-specific repair parameters.

Assert basic mission removes tree edit and preparation time, renames 最小系统数量 to 最小装备数量 after 装备数量, and task phases use 阶段占比 plus 任务时间系数. Assert composite task removes sequence/edit fields where requested and reads basic-task name/equipment/duration from basic mission data.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "page review equipment and mission modeling"
```

- [x] **Step 2: Implement renderer and input updates**

Keep changes local to existing renderer helpers and generic `data-path` updates. Do not change backend schema in this task.

Run the same test again.

Expected: PASS.

---

## Task 4: Support Organization And Resource Pages

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`

- [x] **Step 1: Add contract coverage**

Assert support organization tree is limited to two levels and removes edit/import. Assert support resource trees are read-only, root selection summarizes child resources, leaf selection enables editing, resource tables include checkboxes/select-all/batch-delete, and labels are specialized: 备件/设备 use 型号, 人员 uses 专业 and multi-select 适用机型.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "page review support organization resources"
```

- [x] **Step 2: Implement renderer and event updates**

Use existing `selectedSupportOrgNodeId` and local resource row generation; avoid adding backend persistence in this task.

Run the same test again.

Expected: PASS.

---

## Task 5: Support Activity Pages

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`
- Modify if needed: `front/support-activity-jobs.mjs`

- [x] **Step 1: Add contract coverage**

Assert basic activity library rename, add/edit/delete controls are wired, import is removed, delete becomes batch delete, and rows are selectable. Assert operations/preventive/corrective job tables remove 子作业 and 工期分布摘要, expose multi-select 紧前作业, support add/edit/delete/batch delete, and use the requested preventive/corrective field names and editability.

Run:

```bash
node --test tests/frontend-contract.test.mjs --test-name-pattern "page review support activity controls"
```

- [x] **Step 2: Implement minimal local behavior**

Add or reuse local row add/delete/edit helpers; keep the frontend wording explicit that these are project draft edits until saved through the project draft toolbar.

Run the same test again.

Expected: PASS.

---

## Task 6: Verification, Review, And PR

**Files:**
- Review all modified files.

- [x] **Step 1: Run targeted tests**

```bash
node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs
python3 -m unittest tests.test_backend_api_contract -v
```

- [x] **Step 2: Run full gate**

```bash
npm test
git diff --check
git status --short --branch
```

- [x] **Step 3: Subagent review**

Request a final subagent code review against this plan and the diff from `origin/main` to `HEAD`. Fix Critical and Important findings before committing.

- [ ] **Step 4: Commit and publish**

Commit the page-suggestion alignment slice, push `codex/page-suggestions-alignment`, and open a PR.
