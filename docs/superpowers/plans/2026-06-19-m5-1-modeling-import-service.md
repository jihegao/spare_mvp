# M5.1 Modeling Import Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Service the M5 modeling import contract through the local backend API, SQLite persistence, and frontend API client without expanding into Excel UI, worker infrastructure, or Scenario generation.

**Architecture:** A Python `modeling_import` validator mirrors the existing frontend contract semantics and feeds `BackendApi`. `ContractRepository` persists import packages and publish state in a new `modeling_imports` table. The HTTP facade exposes `/api/modeling-imports/*`, while `front/api-client.mjs` only adds explicit client methods.

**Tech Stack:** Python `unittest`, SQLite, standard-library `http.server`, Node `node:test`, repo-local `modeling-import-v1` JSON contract.

---

### Task 1: Repository Persistence

**Files:**
- Modify: `src/spare_mvp_backend/schema.sql`
- Modify: `src/spare_mvp_backend/repository.py`
- Test: `tests/test_database_contract.py`

- [ ] **Step 1: Write failing repository tests**

Add tests that expect:

```python
tables includes "modeling_imports"
repository.upsert_modeling_import(package, validation) persists payload
repository.get_modeling_import(import_id) returns the stored package
repository.publish_modeling_import(import_id) marks status "published"
repository.assert_modeling_import_can_publish(import_id) raises when published package has referencedRunIds
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract
```

Expected: FAIL because the table and repository methods do not exist.

- [ ] **Step 2: Implement persistence**

Add `modeling_imports` table and repository methods:

```python
upsert_modeling_import(import_package, validation)
get_modeling_import(import_id)
publish_modeling_import(import_id)
assert_modeling_import_can_publish(import_id)
```

- [ ] **Step 3: Verify repository tests pass**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract
```

Expected: PASS.

### Task 2: Backend API Validation and Publish Boundary

**Files:**
- Create: `src/spare_mvp_backend/modeling_import.py`
- Modify: `src/spare_mvp_backend/api.py`
- Test: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Write failing API tests**

Add tests for:

```python
api.validate_modeling_import(valid_fixture)["ok"] is True
api.validate_modeling_import(invalid_fixture)["issues"] includes field paths
api.save_modeling_import(valid_fixture) stores validation summary
api.publish_modeling_import(import_id) returns status "published"
api.publish_modeling_import(import_id) raises BackendApiError("published_import_referenced") when referenced runs exist
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: FAIL because API methods and Python validator do not exist.

- [ ] **Step 2: Implement Python validator and API methods**

Implement a pure Python validator in `src/spare_mvp_backend/modeling_import.py` using the same issue shape as `front/modeling-import-contract.mjs`.

Add BackendApi methods:

```python
validate_modeling_import(import_package)
save_modeling_import(import_package)
get_modeling_import(import_id)
publish_modeling_import(import_id)
```

- [ ] **Step 3: Verify API tests pass**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract
```

Expected: PASS.

### Task 3: HTTP Facade Routes

**Files:**
- Modify: `src/spare_mvp_backend/http_server.py`
- Test: `tests/test_backend_http_api.py`

- [ ] **Step 1: Write failing HTTP tests**

Add tests for:

```python
POST /api/modeling-imports/validate
POST /api/modeling-imports
GET /api/modeling-imports/{import_id}
POST /api/modeling-imports/{import_id}/publish
invalid package returns HTTP 400 with details.issues
```

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 2: Implement HTTP routes**

Route `/api/modeling-imports/*` to BackendApi methods. Keep errors as `BackendApiError` JSON with `code`, `message`, and `details`.

- [ ] **Step 3: Verify HTTP tests pass**

Run:

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api
```

Expected: PASS.

### Task 4: Frontend API Client Contract

**Files:**
- Modify: `front/api-client.mjs`
- Test: `tests/frontend-api-client.test.mjs`

- [ ] **Step 1: Write failing client test**

Expect client methods and paths:

```javascript
validateModelingImport(packageJson) -> POST /modeling-imports/validate
saveModelingImport(packageJson) -> POST /modeling-imports
getModelingImport(importId) -> GET /modeling-imports/:id
publishModelingImport(importId) -> POST /modeling-imports/:id/publish
```

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: FAIL because methods do not exist.

- [ ] **Step 2: Implement client methods**

Add methods to `createBackendApiClient`. Do not call them from generic field edit handlers.

- [ ] **Step 3: Verify client tests pass**

Run:

```bash
node --test tests/frontend-api-client.test.mjs
```

Expected: PASS.

### Task 5: Documentation Sync

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/simulation-service-governance.md`
- Modify: `agent.md`

- [ ] **Step 1: Search stale M5 wording**

Run:

```bash
rg -n "M5|modeling import|建模数据入口|Excel|Scenario|worker|aviation_support" README.md docs agent.md
```

Expected: current-state docs distinguish M5.1 service slice from complete M5.

- [ ] **Step 2: Update current-state docs**

Docs must state:

```text
M5.1 exposes modeling-import-v1 validation/save/publish through the local backend API and SQLite repository; it does not include Excel UI, direct Scenario generation, production workers, or aviation_support compile unlock.
```

### Task 6: Final Verification

**Files:**
- Read: `git diff --check`
- Read: `git status --short --branch`

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/frontend-api-client.test.mjs tests/modeling-import-contract.test.mjs
.abm-mesa-test-env/bin/python -m unittest tests.test_database_contract tests.test_backend_api_contract tests.test_backend_http_api
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
git diff --check
```

Expected: PASS.

## Self-Review

This plan keeps M5.1 focused on service-level validation, persistence, publish status, and API/client boundaries. It does not build Excel UI, permission/audit, production workers, Scenario generation, Mesa behavior changes, or `aviation_support` compile support.
