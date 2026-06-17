# Local Aviation And Ship Front Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy the aviation support Mesa asset and the ship_front prototype into this repository, then adapt the spare_mvp frontend into a four-level feature-page workbench with ontology context and aviation support visualization state.

**Architecture:** Keep source copies local and traceable, but run the product UI from focused spare_mvp modules. `src/spare_mvp_abm/aviation_support/` owns the local Mesa model copy and frame exporter; `vendor/ship_front/` preserves the referenced prototype; `front/feature-catalog.mjs`, `front/aviation-support-state.mjs`, `front/app.js`, and `front/styles.css` provide the static workbench.

**Tech Stack:** Static HTML/CSS/ES modules, Node test runner, Python 3.12, Mesa 3 through the existing Mesa runner.

---

### Task 1: Local Source Copies And Provenance

**Files:**
- Create: `src/spare_mvp_abm/aviation_support/model.py`
- Create: `src/spare_mvp_abm/aviation_support/ontology.json`
- Create: `src/spare_mvp_abm/aviation_support/ontology.normalized.json`
- Create: `src/spare_mvp_abm/aviation_support/ontology.report.json`
- Create: `src/spare_mvp_abm/aviation_support/smoke.json`
- Create: `src/spare_mvp_abm/aviation_support/experiment.json`
- Create: `src/spare_mvp_abm/aviation_support/visualization.html`
- Create: `src/spare_mvp_abm/aviation_support/README.md`
- Create: `src/spare_mvp_abm/aviation_support/SOURCE.md`
- Create: `vendor/ship_front/index.html`
- Create: `vendor/ship_front/app.js`
- Create: `vendor/ship_front/styles.css`
- Create: `vendor/ship_front/image/网络图示例.png`
- Create: `vendor/ship_front/SOURCE.md`
- Test: `tests/local-assets.test.mjs`

- [ ] **Step 1: Write the failing local asset test**

```js
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("local aviation support copy is project-owned and provenance-tagged", async () => {
  const base = new URL("../src/spare_mvp_abm/aviation_support/", import.meta.url);
  for (const file of ["model.py", "ontology.json", "ontology.normalized.json", "ontology.report.json", "smoke.json", "experiment.json", "visualization.html", "README.md", "SOURCE.md"]) {
    await access(new URL(file, base));
  }
  const smoke = JSON.parse(await readFile(new URL("smoke.json", base), "utf8"));
  assert.equal(smoke.parameters.ontology_path, "src/spare_mvp_abm/aviation_support/ontology.json");
  const source = await readFile(new URL("SOURCE.md", base), "utf8");
  assert.match(source, /mesa-abm-skill\/mesa-abm-skill\/assets\/aviation_support/);
});

test("ship_front prototype is copied locally without runtime dependency on home path", async () => {
  const base = new URL("../vendor/ship_front/", import.meta.url);
  for (const file of ["index.html", "app.js", "styles.css", "SOURCE.md"]) {
    await access(new URL(file, base));
  }
  const source = await readFile(new URL("SOURCE.md", base), "utf8");
  assert.match(source, /\/Users\/gaojihe\/Models\/ship_front/);
  const entries = await readdir(new URL("../vendor/", import.meta.url), { recursive: true });
  assert.ok(!entries.some((entry) => String(entry).includes("__pycache__")));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/local-assets.test.mjs`

Expected: FAIL because the local copy directories do not exist yet.

- [ ] **Step 3: Copy only required files**

Copy the aviation support files from `/Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/assets/aviation_support/` into `src/spare_mvp_abm/aviation_support/`, excluding `__pycache__`. Copy `ship_front` HTML/CSS/JS/image into `vendor/ship_front/`.

- [ ] **Step 4: Patch local smoke provenance**

Change `src/spare_mvp_abm/aviation_support/smoke.json` so `parameters.ontology_path` is `src/spare_mvp_abm/aviation_support/ontology.json`, and add SOURCE files with the original paths and copy date.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/local-assets.test.mjs`

Expected: PASS.

### Task 2: Four-Level Feature Catalog

**Files:**
- Create: `front/feature-catalog.mjs`
- Modify: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Write the failing feature catalog tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FEATURE_PAGES, groupFeaturePages, getFeaturePageById } from "../front/feature-catalog.mjs";

test("feature catalog exposes all table-2 four-level pages", () => {
  assert.equal(FEATURE_PAGES.length, 49);
  assert.equal(new Set(FEATURE_PAGES.map((page) => page.id)).size, 49);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "备件规划评估模块").length, 24);
  assert.equal(FEATURE_PAGES.filter((page) => page.module === "任务可靠度评估模块").length, 25);
  for (const label of ["装备可靠性框图建模", "可视化结果展示", "飞机转场携行清单分析", "任务可靠度评估", "停机因素分析"]) {
    assert.ok(FEATURE_PAGES.some((page) => page.name === label), label);
  }
});

test("each feature page has page template metadata and ontology context", () => {
  for (const page of FEATURE_PAGES) {
    assert.ok(page.id);
    assert.ok(page.module);
    assert.ok(page.secondary);
    assert.ok(page.tertiary);
    assert.ok(page.name);
    assert.ok(page.component);
    assert.ok(page.dataObjects.length > 0);
    assert.ok(page.ontology.nodes.length >= 4, page.id);
    assert.ok(page.ontology.edges.length >= 3, page.id);
  }
});

test("feature grouping preserves four-level navigation hierarchy", () => {
  const grouped = groupFeaturePages(FEATURE_PAGES);
  assert.ok(grouped["备件规划评估模块"]["仿真建模"]["任务建模"].length >= 4);
  assert.ok(grouped["任务可靠度评估模块"]["仿真建模"]["装备建模"].some((page) => page.name === "装备可靠性框图建模"));
  assert.equal(getFeaturePageById("mission-reliability-task-reliability").name, "任务可靠度评估");
});

test("frontend shell mounts a feature workbench rather than six static summary views", async () => {
  const html = await readFile(new URL("../front/index.html", import.meta.url), "utf8");
  assert.match(html, /id="app"/);
  assert.match(html, /feature-workbench/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL because `front/feature-catalog.mjs` and the new shell contract do not exist yet.

- [ ] **Step 3: Implement the catalog**

Create a data-driven `FEATURE_PAGES` array from table 2. Every entry has `id`, `module`, `secondary`, `tertiary`, `name`, `component`, `dataObjects`, `summary`, `outputs`, and generated ontology context.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS for catalog and existing simulation tests.

### Task 3: Aviation Support State Adapter

**Files:**
- Create: `front/aviation-support-state.mjs`
- Create: `src/spare_mvp_abm/aviation_support/export_frames.py`
- Create: `tests/aviation-support-state.test.mjs`
- Create: `tests/test_aviation_support_local.py`

- [ ] **Step 1: Write failing adapter and Python tests**

The Node test imports `normalizeAviationSupportState()` and verifies `aircraft`, `resources`, `spares`, `missions`, `jobs`, and `events` are preserved in frontend-friendly groups. The Python test imports the local `AviationSupportModel`, instantiates it from local `ontology.json`, steps it, and verifies `visualization_state()` exposes the same keys.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/aviation-support-state.test.mjs`

Expected: FAIL because the adapter is missing.

Run: `/Users/gaojihe/apps/mesa-abm-skill/.abm-mesa-env/bin/python -m unittest tests/test_aviation_support_local.py -v`

Expected: FAIL until the local copy and exporter are in place.

- [ ] **Step 3: Implement adapter and exporter**

`normalizeAviationSupportState()` maps the Mesa state into KPI cards, aircraft board rows, resource rows, spare rows, mission rows, active jobs, and event rows. `export_frames.py` writes sampled `visualization_state()` frames to JSON for static frontend consumption.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/aviation-support-state.test.mjs`

Run: `/Users/gaojihe/apps/mesa-abm-skill/.abm-mesa-env/bin/python -m unittest tests/test_aviation_support_local.py -v`

Expected: PASS.

### Task 4: Ship Front-Inspired Frontend Workbench

**Files:**
- Modify: `front/index.html`
- Modify: `front/app.js`
- Modify: `front/styles.css`

- [ ] **Step 1: Replace the six-view shell with the feature workbench**

`index.html` should expose `#app`, keep a visible loading fallback, and load `app.js` as an ES module. `app.js` should render a topbar, four-level navigation, a selected feature page, and a right-side ontology graph.

- [ ] **Step 2: Borrow ship_front layout patterns without copying its monolith**

Use workbench patterns equivalent to `nav-page-layout`, `home-module-row`, `deck-modeling-nav`, `deck-modeling-content`, `experiment-subtabs`, and dense tables. Do not depend on `vendor/ship_front/app.js` at runtime.

- [ ] **Step 3: Connect the visualization page to aviation support state**

For pages with `component === "visual-simulation"`, render aircraft, mission, support resource, spare, job, and event views from the normalized aviation support state.

- [ ] **Step 4: Run frontend tests**

Run: `npm test`

Expected: PASS.

### Task 5: Smoke, Browser Check, And Commit

**Files:**
- No additional files unless verification reveals issues.

- [ ] **Step 1: Run local Mesa smoke**

Run:

```bash
/opt/homebrew/bin/python3.12 /Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/aviation_support/model.py \
  --config src/spare_mvp_abm/aviation_support/smoke.json \
  --output-dir /tmp/spare-mvp-local-aviation-support-smoke \
  --install-dir /Users/gaojihe/apps/mesa-abm-skill/.abm-mesa-env
```

Expected: `summary.json` exists and reports one deterministic run.

- [ ] **Step 2: Start the static server and inspect the page**

Run: `python3 -m http.server 4173`

Open `http://localhost:4173/front/` and confirm the workbench renders, navigation has four-level pages, ontology graph is visible, and visualization state cards are populated.

- [ ] **Step 3: Commit the verified changes**

Run:

```bash
git add docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md src/spare_mvp_abm/aviation_support vendor/ship_front front tests
git commit -m "feat: integrate local aviation support frontend"
```
