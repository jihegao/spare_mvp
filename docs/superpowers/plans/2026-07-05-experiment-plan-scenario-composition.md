# Experiment Plan Scenario Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ExperimentPlan scenario composition so users can save a simulation plan branch with Project JSON path overrides, fixed/random seed policy, and sample count without mutating the source Project.

**Architecture:** Keep Project and ExperimentPlan as separate lifecycles. The editor mutates `experimentPlanDraft` plus a `scenarioComposition` override list, `buildExperimentPlanConfig()` serializes runtime config and provenance into ExperimentPlan config, and the backend preserves that config while continuing to strip runtime-only fields from `config.projectJson`.

**Tech Stack:** Vanilla browser JS in `front/app.js`, API/config helpers in `front/api-client.mjs`, Node test runner tests, Python `unittest` backend contract tests, Markdown docs.

---

## Files And Ownership

- Modify `front/api-client.mjs`: parse/apply scenario composition overrides; normalize seed policy; serialize `seedPolicy` and `scenarioComposition` through `buildExperimentPlanConfig()`.
- Modify `front/app.js`: render seed policy and scenario composition controls in `renderExperimentPlanEditor()`; handle input/change/click events; keep writes isolated to `experimentPlanDraft`.
- Modify `tests/frontend-api-client.test.mjs`: config helper contract tests.
- Modify `tests/frontend-contract.test.mjs`: source-level UI/handler contract checks.
- Modify `tests/frontend-app-runtime.test.mjs`: browserless runtime save-flow checks.
- Modify `tests/test_backend_api_contract.py`: backend preservation and projectJson stripping checks.
- Modify `docs/product-roadmap.md` and `docs/README.md`: current-state documentation sync.

## Subagent Split

- Worker A owns `front/api-client.mjs` and `tests/frontend-api-client.test.mjs`.
- Worker B owns `tests/test_backend_api_contract.py` and reports whether backend code is already sufficient.
- Main thread owns `front/app.js`, runtime/contract tests, docs, final integration, and verification.
- Reviewer subagents review spec compliance and code quality after the implementation is integrated.

### Task 1: Config Serialization Helpers

**Files:**
- Modify: `front/api-client.mjs`
- Modify: `tests/frontend-api-client.test.mjs`

- [x] **Step 1: Write failing tests for scenario composition config**

Append focused tests to `tests/frontend-api-client.test.mjs` near the existing `buildExperimentPlanConfig` tests:

```js
test("buildExperimentPlanConfig applies scenario composition overrides to branch projectJson", () => {
  const projectJson = {
    project_id: "project-composition",
    experiment: { name: "composition", steps: 6, samples: 3, seed: 101 },
    supportNodes: [{ id: "base-a", inventory: { "LRU-A": 2 } }],
    scenarioComposition: {
      schemaVersion: "scenario-composition-v0",
      overrides: [
        { path: "supportNodes.0.inventory.LRU-A", valueType: "number", value: "12", label: "LRU-A" },
        { path: "missionProfile.durationHours", valueType: "number", value: "8" }
      ]
    },
    seedPolicy: { mode: "fixed", baseSeed: 909 }
  };

  const config = buildExperimentPlanConfig(projectJson);

  assert.equal(config.seed, 909);
  assert.deepEqual(config.seedPolicy, { mode: "fixed", baseSeed: 909 });
  assert.equal(config.projectJson.supportNodes[0].inventory["LRU-A"], 12);
  assert.equal(config.projectJson.missionProfile.durationHours, 8);
  assert.deepEqual(config.scenarioComposition.overrides.map((item) => item.path), [
    "supportNodes.0.inventory.LRU-A",
    "missionProfile.durationHours"
  ]);
  assert.equal("scenarioComposition" in config.projectJson, false);
  assert.equal("seedPolicy" in config.projectJson, false);
});

test("buildExperimentPlanConfig materializes random seed policy as a reproducible base seed", () => {
  const config = buildExperimentPlanConfig({
    project_id: "project-random-seed",
    experiment: { name: "random seed", steps: 4, samples: 2, seed: 11 },
    seedPolicy: { mode: "random", baseSeed: 123456 }
  });

  assert.equal(config.seed, 123456);
  assert.deepEqual(config.seedPolicy, { mode: "random", baseSeed: 123456 });
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `node --test tests/frontend-api-client.test.mjs --test-name-pattern "scenario composition|random seed policy"`

Expected: FAIL because `buildExperimentPlanConfig()` does not yet apply overrides or preserve seed policy.

- [x] **Step 3: Implement minimal helper support**

In `front/api-client.mjs`, add helper functions near `buildExperimentPlanConfig()`:

```js
function normalizedSeedPolicy(projectJson, experiment) {
  const source = projectJson.seedPolicy && typeof projectJson.seedPolicy === "object" && !Array.isArray(projectJson.seedPolicy)
    ? projectJson.seedPolicy
    : {};
  const mode = source.mode === "random" ? "random" : "fixed";
  const baseSeed = positiveInteger(source.baseSeed ?? experiment.seed ?? 0, 0);
  return { mode, baseSeed };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function normalizedScenarioComposition(projectJson) {
  const source = projectJson.scenarioComposition && typeof projectJson.scenarioComposition === "object" && !Array.isArray(projectJson.scenarioComposition)
    ? projectJson.scenarioComposition
    : {};
  const overrides = Array.isArray(source.overrides)
    ? source.overrides.map(normalizedScenarioOverride).filter(Boolean)
    : [];
  return {
    schemaVersion: source.schemaVersion || "scenario-composition-v0",
    ...(source.sourceProjectId ? { sourceProjectId: String(source.sourceProjectId) } : {}),
    ...(source.baseProjectVersion ? { baseProjectVersion: String(source.baseProjectVersion) } : {}),
    overrides
  };
}

function normalizedScenarioOverride(override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return null;
  const path = String(override.path || "").trim();
  if (!path) return null;
  const valueType = ["number", "boolean", "json", "string"].includes(override.valueType) ? override.valueType : "string";
  return {
    path,
    valueType,
    value: parsedScenarioOverrideValue(override.value, valueType),
    ...(override.label ? { label: String(override.label) } : {})
  };
}

function parsedScenarioOverrideValue(value, valueType) {
  if (valueType === "number") return Number(value);
  if (valueType === "boolean") return value === true || value === "true";
  if (valueType === "json") return typeof value === "string" ? JSON.parse(value) : cloneJson(value);
  return String(value ?? "");
}

function applyScenarioCompositionOverrides(projectJson, composition) {
  for (const override of composition.overrides) {
    setObjectPath(projectJson, override.path, cloneJson(override.value));
  }
}

function setObjectPath(obj, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) throw new Error("Scenario override path is required");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    if (current[part] == null || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}
```

Then update `buildExperimentPlanConfig()` so it computes `seedPolicy`, applies `scenarioComposition` to a branch clone before `buildBackendProjectJson()`, sets `config.seed = seedPolicy.baseSeed`, and includes `seedPolicy` / `scenarioComposition` at top level.

- [x] **Step 4: Run tests to verify GREEN**

Run: `node --test tests/frontend-api-client.test.mjs --test-name-pattern "scenario composition|random seed policy"`

Expected: PASS.

### Task 2: Experiment Plan Editor UI And Runtime Flow

**Files:**
- Modify: `front/app.js`
- Modify: `tests/frontend-contract.test.mjs`
- Modify: `tests/frontend-app-runtime.test.mjs`

- [x] **Step 1: Write failing source contract tests**

Add a test to `tests/frontend-contract.test.mjs` near the existing experiment-plan editor tests:

```js
test("experiment plan editor exposes seed policy and scenario composition controls", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const editorSource = appSource.slice(
    appSource.indexOf("function renderExperimentPlanEditor"),
    appSource.indexOf("function experimentPlanField")
  );
  const changeSource = appSource.slice(
    appSource.indexOf('const experimentPlanInput = event.target.closest("[data-experiment-plan-path]"'),
    appSource.indexOf("markProjectDraftChanged();")
  );

  assert.match(editorSource, /data-experiment-seed-policy/);
  assert.match(editorSource, /data-scenario-override-path/);
  assert.match(editorSource, /data-scenario-override-add/);
  assert.match(editorSource, /data-scenario-override-remove/);
  assert.match(changeSource, /experimentPlanDraft/);
  assert.doesNotMatch(changeSource, /setPath\\(scenario/);
});
```

- [x] **Step 2: Write failing runtime save-flow test**

Add a runtime test to `tests/frontend-app-runtime.test.mjs` near the existing save-plan test:

```js
test("experiment plan save posts composed projectJson without mutating source project", async () => {
  const runtime = await setupRuntimeApp({ hash: "feature=spare-planning-experiment-plan-list" });

  try {
    await runtime.click("[data-experiment-plan-add]");
    await runtime.change("[data-experiment-plan-path]", { experimentPlanPath: "experiment.samples" }, { value: "5", type: "number" });
    await runtime.change("[data-experiment-seed-policy]", { value: "fixed" });
    await runtime.change("[data-experiment-seed-base]", { value: "909", type: "number" });
    await runtime.click("[data-scenario-override-add]");
    await runtime.change("[data-scenario-override-path]", { scenarioOverrideIndex: "0" }, { value: "supportNodes.0.inventory.LRU-A" });
    await runtime.change("[data-scenario-override-value-type]", { scenarioOverrideIndex: "0" }, { value: "number" });
    await runtime.change("[data-scenario-override-value]", { scenarioOverrideIndex: "0" }, { value: "12" });
    await runtime.click("[data-save-plan]");

    const createPlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    const body = JSON.parse(createPlanRequest.options.body || "{}");

    assert.equal(body.config.samples, 5);
    assert.equal(body.config.seed, 909);
    assert.deepEqual(body.config.seedPolicy, { mode: "fixed", baseSeed: 909 });
    assert.equal(body.config.projectJson.supportNodes[0].inventory["LRU-A"], 12);
    assert.equal(body.config.analysisRequests.largeSample.samples, 5);
    assert.equal("scenarioComposition" in body.config.projectJson, false);
  } finally {
    runtime.restore();
  }
});
```

- [x] **Step 3: Run tests to verify RED**

Run: `node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs --test-name-pattern "scenario composition|composed projectJson"`

Expected: FAIL because UI controls and handlers do not exist.

- [x] **Step 4: Implement editor state helpers and controls**

In `front/app.js`, add helper functions near `ensureExperimentPlanDraftDefaults()`:

```js
function experimentPlanSeedPolicy() {
  const experiment = experimentPlanDraft.experiment || {};
  const source = experimentPlanDraft.seedPolicy && typeof experimentPlanDraft.seedPolicy === "object" ? experimentPlanDraft.seedPolicy : {};
  const mode = source.mode === "random" ? "random" : "fixed";
  const baseSeed = positiveExperimentNumber(source.baseSeed ?? experiment.seed, defaultScenario.experiment?.seed || 20260621);
  experimentPlanDraft.seedPolicy = { mode, baseSeed };
  experimentPlanDraft.experiment = { ...experiment, seed: baseSeed };
  return experimentPlanDraft.seedPolicy;
}

function scenarioCompositionDraft() {
  if (!experimentPlanDraft.scenarioComposition || typeof experimentPlanDraft.scenarioComposition !== "object" || Array.isArray(experimentPlanDraft.scenarioComposition)) {
    experimentPlanDraft.scenarioComposition = { schemaVersion: "scenario-composition-v0", overrides: [] };
  }
  if (!Array.isArray(experimentPlanDraft.scenarioComposition.overrides)) {
    experimentPlanDraft.scenarioComposition.overrides = [];
  }
  experimentPlanDraft.scenarioComposition.sourceProjectId = currentBackendProjectId();
  experimentPlanDraft.scenarioComposition.baseProjectVersion = savedProject?.project_version || scenario.project_version || "project-v0.1";
  return experimentPlanDraft.scenarioComposition;
}
```

Update `renderExperimentPlanEditor()` to render:

- a seed policy `<select data-experiment-seed-policy>`
- a seed input `<input data-experiment-seed-base type="number">`
- an overrides table with `data-scenario-override-path`, `data-scenario-override-value-type`, `data-scenario-override-value`, `data-scenario-override-label`
- add/remove buttons with `data-scenario-override-add` and `data-scenario-override-remove`

- [x] **Step 5: Implement event handlers**

In the main click handler, add handling for:

```js
const scenarioOverrideAddButton = event.target.closest("[data-scenario-override-add]");
if (scenarioOverrideAddButton) {
  scenarioCompositionDraft().overrides.push({ path: "", valueType: "string", value: "", label: "" });
  experimentPlanBranchActive = true;
  render();
  return;
}

const scenarioOverrideRemoveButton = event.target.closest("[data-scenario-override-remove]");
if (scenarioOverrideRemoveButton) {
  const index = Number(scenarioOverrideRemoveButton.dataset.scenarioOverrideRemove);
  scenarioCompositionDraft().overrides.splice(index, 1);
  experimentPlanBranchActive = true;
  render();
  return;
}
```

In the change/input handler, add handling for `data-experiment-seed-policy`, `data-experiment-seed-base`, and the scenario override inputs. All writes must target `experimentPlanDraft`, never `scenario`.

- [x] **Step 6: Run tests to verify GREEN**

Run: `node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs --test-name-pattern "scenario composition|composed projectJson"`

Expected: PASS.

### Task 3: Backend Preservation Contract

**Files:**
- Modify: `tests/test_backend_api_contract.py`
- Production code change target if the test fails: `src/spare_mvp_backend/api.py`

- [x] **Step 1: Write failing or confirming backend contract test**

Add a test near existing `create_experiment_plan` tests:

```python
def test_create_experiment_plan_preserves_seed_policy_and_scenario_composition(self) -> None:
    project = self.valid_project()
    saved = self.api.save_project(project)
    plan = self.api.create_experiment_plan(
        saved["project_id"],
        {
            "name": "composed branch",
            "steps": 4,
            "samples": 9,
            "seed": 909,
            "seedPolicy": {"mode": "fixed", "baseSeed": 909},
            "scenarioComposition": {
                "schemaVersion": "scenario-composition-v0",
                "overrides": [
                    {"path": "supportNodes.0.inventory.LRU-A", "valueType": "number", "value": 12}
                ],
            },
            "analysisRequests": {
                "largeSample": {
                    "enabled": True,
                    "samples": 9,
                    "sweep": {
                        "failureRates": [0.06],
                        "spareMultipliers": [1],
                        "supportCapacities": [2],
                    },
                }
            },
            "projectJson": {
                **copy.deepcopy(project),
                "experiment": {"seed": 909, "samples": 9},
                "analysisRequests": {"largeSample": {"enabled": True}},
                "monteCarlo": {"failureRates": [0.06]},
            },
        },
    )

    self.assertEqual(plan["config"]["seedPolicy"], {"mode": "fixed", "baseSeed": 909})
    self.assertEqual(plan["config"]["scenarioComposition"]["overrides"][0]["path"], "supportNodes.0.inventory.LRU-A")
    self.assertEqual(plan["config"]["analysisRequests"]["largeSample"]["samples"], 9)
    self.assertNotIn("experiment", plan["config"]["projectJson"])
    self.assertNotIn("analysisRequests", plan["config"]["projectJson"])
    self.assertNotIn("monteCarlo", plan["config"]["projectJson"])
```

- [x] **Step 2: Run test to verify behavior**

Run: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_create_experiment_plan_preserves_seed_policy_and_scenario_composition -v`

Expected: PASS if backend already preserves unknown config fields. If it fails, patch `_normalize_experiment_plan_config()` to retain `seedPolicy` and `scenarioComposition` as top-level ExperimentPlan config fields while stripping runtime-only fields from `projectJson`, then rerun the same command until it passes.

### Task 4: Documentation Sync

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/product-roadmap.md`

- [x] **Step 1: Update docs current-state notes**

In `docs/README.md`, update the current Project JSON / ExperimentPlan boundary bullet so it mentions `seedPolicy` and `scenarioComposition` as ExperimentPlan-owned runtime/provenance fields.

In `docs/product-roadmap.md`, update M5.3 / M6.2 current-state text to say ExperimentPlan management supports Project JSON path override composition, fixed/random base seed policy, and sample count, while Project JSON remains runtime-config-free.

- [x] **Step 2: Verify docs**

Run: `rg -n "scenarioComposition|seedPolicy|ExperimentPlan.*Project JSON|样本量" docs/README.md docs/product-roadmap.md`

Expected: output includes the new current-state notes and does not imply Project JSON stores runtime config.

### Task 5: Final Verification And Review

**Files:**
- Review all touched files.

- [x] **Step 1: Run targeted JS tests**

Run: `node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs`

Expected: PASS.

- [x] **Step 2: Run backend contract test**

Run: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 -m pytest -q -p no:cacheprovider tests/test_backend_api_contract.py`

Expected: PASS.

- [x] **Step 3: Run diff checks**

Run: `git diff --check`

Expected: no output and exit code 0.

- [x] **Step 4: Subagent reviews**

Dispatch one spec-compliance reviewer over the final diff and one code-quality reviewer over the final diff. Both must return no blocking issues before closeout.

Review follow-up resolved:
- Existing ExperimentPlan edit now hydrates top-level `config.seedPolicy`, `config.scenarioComposition`, samples, steps, seed, `analysisRequests`, and Monte Carlo config back into the isolated branch draft before save.
- Backend Project payload cleanup now strips `seedPolicy` and `scenarioComposition` from `config.projectJson` as a defensive boundary for non-frontend clients.
