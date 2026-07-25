import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBackendRunContext,
  buildRunContextOptions,
  buildVisualizationSessionRequest,
  DEFAULT_CURRENT_MONTE_CARLO_SETTINGS,
  frozenMonteCarloSettings,
  isRunnableFrozenExperimentPlan,
  shouldInvalidateVisualizationSession
} from "../front/run-context.mjs";

const frozenPlan = {
  experiment_plan_id: "plan-frozen",
  status: "frozen",
  plan_fingerprint: "sha256:frozen",
  config: {
    name: "冻结方案",
    projectJson: { project_id: "project-ui", basicMissions: [{ id: "mission-1" }] },
    samples: 8,
    parallelCores: 3,
    seed: 20260622
  }
};

test("run context options keep current Project and only executable frozen plans", () => {
  const options = buildRunContextOptions({
    projectId: "project-ui",
    projectName: "项目 UI",
    projectJson: { project_id: "project-ui" },
    plans: [
      frozenPlan,
      { ...frozenPlan, experiment_plan_id: "draft", status: "draft" },
      { ...frozenPlan, experiment_plan_id: "missing-json", config: { ...frozenPlan.config, projectJson: null } },
      { ...frozenPlan, experiment_plan_id: "missing-fingerprint", plan_fingerprint: "" }
    ]
  });

  assert.deepEqual(options.map((option) => option.key), ["current-project:project-ui", "plan-frozen"]);
  assert.equal(isRunnableFrozenExperimentPlan(frozenPlan), true);
  assert.deepEqual(buildBackendRunContext(options[0]), {
    kind: "current_project",
    project: { project_id: "project-ui" }
  });
  assert.deepEqual(buildBackendRunContext(options[1]), {
    kind: "frozen_plan",
    projectId: "project-ui",
    experimentPlanId: "plan-frozen",
    planFingerprint: "sha256:frozen"
  });
});

test("frozen Monte Carlo settings are read only and fail closed when missing or illegal", () => {
  const context = buildRunContextOptions({
    projectId: "project-ui",
    projectJson: { project_id: "project-ui" },
    plans: [frozenPlan]
  })[1];

  assert.deepEqual(frozenMonteCarloSettings(context), {
    samples: 8,
    parallelCores: 3,
    seed: 20260622
  });
  assert.deepEqual(DEFAULT_CURRENT_MONTE_CARLO_SETTINGS, {
    samples: 4,
    parallelCores: 4,
    seed: 20260621
  });
  assert.throws(
    () => frozenMonteCarloSettings({ ...context, plan: { ...frozenPlan, config: { ...frozenPlan.config, seed: undefined } } }),
    /缺少随机种子/
  );
  assert.throws(
    () => frozenMonteCarloSettings({ ...context, plan: { ...frozenPlan, config: { ...frozenPlan.config, parallelCores: 33 } } }),
    /并行核心数必须是 1-32/
  );
});

test("visualization request uses draft or frozen identity and session invalidation excludes playback speed", () => {
  const currentContext = buildRunContextOptions({
    projectId: "project-ui",
    projectJson: { project_id: "project-ui", title: "unsaved draft" }
  })[0];
  assert.deepEqual(buildVisualizationSessionRequest(currentContext, {
    seed: 9,
    frameSampleEverySteps: 2,
    playbackSpeed: 1.25
  }), {
    context: {
      kind: "current_project",
      project: { project_id: "project-ui", title: "unsaved draft" }
    },
    seed: 9,
    frameSampleEverySteps: 2,
    playbackSpeed: 1.25
  });
  assert.equal(shouldInvalidateVisualizationSession("context"), true);
  assert.equal(shouldInvalidateVisualizationSession("seed"), true);
  assert.equal(shouldInvalidateVisualizationSession("frameSampleEverySteps"), true);
  assert.equal(shouldInvalidateVisualizationSession("playbackSpeed"), false);
});
