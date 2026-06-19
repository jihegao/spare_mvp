# M3-1 RMS 收束与 M5 数据入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the current M3-1/RMS branch as an evidence-backed PR, then prepare the first M5 data-entry contract slice without mixing in M4 or Mesa behavior changes.

**Architecture:** Phase A closes the existing branch by verifying the same-origin `/api` browser loop, RMS allocation page, backend persistence, and documentation. Phase B starts a separate M5 slice that treats imported modeling data as Project drafts, validates field/reference/version rules, and still routes Scenario compilation through `SimulationAdapter`.

**Tech Stack:** Node `node:test`, Python `unittest`, Python standard-library HTTP server, SQLite, local Playwright smoke scripts, JSON Schema and repo-local Project JSON contracts.

---

### Task 1: Phase A Worktree Inventory

**Files:**
- Read: `git status --short --branch`
- Read: `git diff --stat`
- Read: `docs/spare_mvp_rms_allocation_design.md`
- Read: `reports/m3-1-browser-backend-smoke/README.md`

- [ ] **Step 1: Inspect dirty files**

Run:

```bash
git status --short --branch
git diff --stat
```

Expected: every modified or untracked file falls into M3-1 backend browser loop, RMS allocation page, tests, docs, reports, or generated smoke evidence.

- [ ] **Step 2: Identify unrelated files**

Run:

```bash
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: no unrelated local files are staged or committed. If unrelated files exist, leave them unstaged and document them in the final status.

### Task 2: Phase A Focused Test Repair

**Files:**
- Modify as needed: `front/api-client.mjs`
- Modify as needed: `front/app.js`
- Modify as needed: `src/spare_mvp_backend/api.py`
- Modify as needed: `src/spare_mvp_backend/repository.py`
- Modify as needed: `src/spare_mvp_contract/adapter.py`
- Test: `tests/frontend-api-client.test.mjs`
- Test: `tests/e2e-contract-flow.test.mjs`
- Test: `tests/test_backend_http_api.py`
- Test: `tests/test_backend_api_contract.py`
- Test: `tests/test_database_contract.py`
- Test: `tests/test_simulation_adapter.py`

- [ ] **Step 1: Run frontend and contract tests**

Run:

```bash
npm test
```

Expected: all Node tests pass. If a failure appears, fix the smallest contract or implementation mismatch and rerun.

- [ ] **Step 2: Run backend focused tests**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
```

Expected: all listed Python tests pass under the Mesa-capable interpreter.

- [ ] **Step 3: Confirm API unavailable does not create fake runs**

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: tests confirm the frontend blocks unavailable `/api` paths instead of creating `offline-demo-run`.

### Task 3: Phase A Browser Smoke

**Files:**
- Read/Update evidence: `reports/m3-1-browser-backend-smoke/README.md`
- Run script: `reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs`
- Generated evidence: `output/playwright/m3-1-browser-backend-smoke/`

- [ ] **Step 1: Start the same-origin backend server**

Run:

```bash
.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173 --database output/playwright/m3-1-browser-backend-smoke/m3-1.sqlite3 --output-dir output/playwright/m3-1-browser-backend-smoke/runs
```

Expected: server listens on `http://127.0.0.1:4173/front/`.

- [ ] **Step 2: Run browser backend smoke**

In another shell, run:

```bash
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

Expected: smoke result JSON reports success, screenshots show real backend result, refresh restoration, and API-unavailable blocked state.

- [ ] **Step 3: Stop the server**

Run:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
kill <pid-from-lsof>
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

Expected: final `lsof` has no listener.

### Task 4: Phase A Documentation Sync

**Files:**
- Modify as needed: `README.md`
- Modify as needed: `docs/README.md`
- Modify as needed: `docs/product-roadmap.md`
- Modify as needed: `docs/simulation-service-governance.md`
- Modify as needed: `reports/contract-first-smoke/README.md`
- Modify as needed: `reports/m3-1-browser-backend-smoke/README.md`

- [ ] **Step 1: Search stale wording**

Run:

```bash
rg -n "offline-demo-run|M3-0|M3-1|RMS|可靠性分配|aviation_support|Scenario 编译|生产 Web API|worker|权限|审计" README.md docs reports agent.md
```

Expected: current-state docs distinguish M3-1 from M3-0, RMS allocation from full M5, and explicitly skip M4.

- [ ] **Step 2: Update docs only where they are current-state docs**

Edit current-state docs so they say:

```text
M3-1 已验证真实浏览器同源后端闭环；RMS 指标分配页面是当前分支新增的可验收页面；M4 用户、权限和审计被跳过；M5 下一片聚焦建模数据导入、校验、发布和错误定位。
```

Expected: historical design docs remain historical unless they claim to be current state.

### Task 5: Phase B M5 First Slice Design Stub

**Files:**
- Modify: `docs/product-roadmap.md`
- Create or Modify later: `contracts/modeling_import.schema.json`
- Create or Modify later: `tests/fixtures/modeling_import_project.json`
- Create or Modify later: `tests/modeling-import-contract.test.mjs`

- [ ] **Step 1: Add M5 first-slice acceptance wording**

In `docs/product-roadmap.md`, make the M5 first slice explicit:

```text
M5 首片不做完整 Excel UI；先定义建模数据导入/校验 contract、错误定位结构、草稿/发布版本和运行引用保护。
```

Expected: roadmap does not imply M5 starts with a full spreadsheet editor.

- [ ] **Step 2: Leave code implementation for the next branch**

Do not create `modeling_import.schema.json` in Phase A unless the user explicitly expands this branch. The next branch should begin with a failing `tests/modeling-import-contract.test.mjs` that validates duplicate IDs, missing references, invalid numeric fields, and published-version protection.

### Task 6: Final Verification and PR Readiness

**Files:**
- Read: `git diff --check`
- Read: `git diff --stat`
- Read: `git status --short --branch`

- [ ] **Step 1: Run whitespace checks**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
```

Expected: all tests pass.

- [ ] **Step 3: Report staged PR scope**

Run:

```bash
git diff --stat
git status --short --branch
```

Expected: final response lists changed files, evidence commands, and any untracked generated output that should remain unstaged or be intentionally included as smoke evidence.

## Self-Review

The plan covers the approved direction: skip M4, finish current M3-1/RMS branch, and prepare M5 data-entry as the next slice. No step asks workers to modify Mesa behavior, unlock `aviation_support` Scenario compilation, or build production worker infrastructure. The M5 code implementation is explicitly separated from Phase A unless the user expands this branch.
