# Independent Analysis Samples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four current result analysis pages own their run sample count independently from the Monte Carlo experiment plan.

**Architecture:** Keep numeric Monte Carlo config ExperimentPlan-backed, but move current analysis sample count into the current page profile and copy it into `analysisRequests.largeSample.samples` only for the transient run plan created by `RunIntent`. The backend continues to reject request-level MC numeric config and reads the current run count from the analysis plan config.

**Tech Stack:** Plain browser JavaScript modules, Node test runner, Python `unittest`, local backend contract layer.

---

### Task 1: RunIntent Sample Source

**Files:**
- Modify: `front/run-intent.mjs`
- Test: `tests/run-intent.test.mjs`

- [ ] **Step 1: Add a failing test**

```js
test("buildRunIntent uses current analysis profile samples without mutating the global MC plan", () => {
  const projectJson = {
    project_id: "project-current-analysis-samples",
    experiment: { name: "global mc", steps: 4, samples: 24, seed: 101 },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 24,
        sweep: { failureRates: [0.06], spareMultipliers: [1.0], supportCapacities: [2] }
      }
    }
  };
  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson: projectJson,
    mcExperimentId: "current-analysis-mission_reliability",
    analysisType: "mission_reliability",
    currentAnalysisProfile: { analysis_type: "mission_reliability", samples: 9 }
  });
  assert.equal(intent.experimentPlanConfig.analysisRequests.largeSample.samples, 9);
  assert.equal(projectJson.analysisRequests.largeSample.samples, 24);
  assert.equal("samples" in intent.runRequest, false);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/run-intent.test.mjs`
Expected before implementation: the new assertion sees `1` instead of `9`.

- [ ] **Step 3: Implement profile sample normalization**

In `front/run-intent.mjs`, derive `analysisSamples` from `currentAnalysisProfile.samples`, require a positive integer, and use it for current-analysis `largeSample.samples`; otherwise keep existing Monte Carlo behavior.

- [ ] **Step 4: Verify**

Run: `node --test tests/run-intent.test.mjs`
Expected: all tests pass.

### Task 2: Current Analysis UI State

**Files:**
- Modify: `front/app.js`
- Test: `tests/frontend-contract.test.mjs`

- [ ] **Step 1: Add contract checks**

Add assertions that `renderCurrentAnalysisResultPanel` renders a `data-current-analysis-samples` number input, that the change handler calls `updateCurrentAnalysisSamples`, and that `runCurrentAnalysisPage` validates samples before calling `startMonteCarloRunThroughApi`.

- [ ] **Step 2: Implement UI and validation**

Add default samples to each current analysis profile, render a required positive integer input with a clear validation message, update only the active analysis profile on input, and block the run when invalid.

- [ ] **Step 3: Verify**

Run: `node --test tests/frontend-contract.test.mjs`
Expected: all frontend contract tests pass.

### Task 3: Backend Current Analysis Sample Count

**Files:**
- Modify: `src/spare_mvp_backend/monte_carlo_config.py`
- Modify: `tests/test_backend_api_contract.py`

- [ ] **Step 1: Add contract coverage**

Add a backend test that creates two current analysis experiment plans with different `analysisRequests.largeSample.samples` values and asserts each run's `monte_carlo_base.sample_count` uses its own value.

- [ ] **Step 2: Implement backend normalization**

Keep validating `analysisRequests.largeSample.samples` for current analysis runs and use that value instead of replacing it with sweep point count, while still validating that it covers every sweep point.

- [ ] **Step 3: Verify**

Run: `python -m unittest tests.test_backend_api_contract`
Expected: backend contract tests pass.
