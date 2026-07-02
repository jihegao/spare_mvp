import assert from "node:assert/strict";
import test from "node:test";

import { buildExperimentPlanConfig, buildBackendProjectJson } from "../front/api-client.mjs";
import { buildRunIntent, bindExperimentPlanId } from "../front/run-intent.mjs";
import { cloneScenario, defaultScenario } from "../front/sim-engine.mjs";

test("buildRunIntent creates single run intent from explicit inputs without page globals", () => {
  globalThis.currentProject = { project_id: "project-global" };
  globalThis.scenario = { project_id: "project-global-scenario" };
  const projectJson = {
    project_id: "project-explicit",
    experiment: { name: "single explicit", steps: 3, seed: 42 }
  };
  const planProjectJson = {
    ...projectJson,
    experiment: { ...projectJson.experiment, steps: 5 }
  };

  const intent = buildRunIntent({
    runType: "single",
    projectJson,
    planProjectJson,
    experimentId: "experiment-single-explicit"
  });
  const bound = bindExperimentPlanId(intent, "plan-explicit");

  assert.equal(intent.runType, "single");
  assert.equal(intent.runRequest.project_id, "project-explicit");
  assert.equal(intent.runRequest.model_family, "aircraft_support_v1");
  assert.equal(intent.runRequest.experiment_id, "experiment-single-explicit");
  assert.equal(bound.runRequest.experiment_plan_id, "plan-explicit");
  assert.equal(bound.runRequest.run_type, "single");
  assert.equal("mc_experiment_id" in bound.runRequest, false);
  assert.deepEqual(intent.experimentPlanConfig, buildExperimentPlanConfig(planProjectJson));
});

test("buildRunIntent defaults platform formal runs to aircraft_support_v1", () => {
  const projectJson = {
    project_id: "project-m9-8-default",
    experiment: { name: "m9.8 default model family", steps: 3, seed: 42 }
  };
  const planProjectJson = {
    ...projectJson,
    experiment: { ...projectJson.experiment, steps: 5 }
  };

  const singleIntent = buildRunIntent({
    runType: "single",
    projectJson,
    planProjectJson
  });
  const monteCarloIntent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson,
    mcExperimentId: "mc-m9-8-default"
  });

  assert.equal(singleIntent.runRequest.model_family, "aircraft_support_v1");
  assert.equal(monteCarloIntent.runRequest.model_family, "aircraft_support_v1");
});

test("buildRunIntent creates canonical monte carlo request shape", async () => {
  const project = { id: "sample-project", name: "导入示例项目" };
  const projectJson = buildBackendProjectJson(cloneScenario(defaultScenario), project);
  const planProjectJson = {
    ...projectJson,
    experiment: { ...projectJson.experiment, steps: 8 },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 5,
        sweep: {
          failureRates: [0.06],
          spareMultipliers: [1.0],
          supportCapacities: [2]
        }
      }
    }
  };

  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson,
    mcExperimentId: "mc-front-intent"
  });
  const submittedRequests = [];
  const fakeClient = {
    submitRun: async (request) => {
      submittedRequests.push(request);
      return { run_id: "run-front-intent", ...request };
    }
  };
  const bound = bindExperimentPlanId(intent, "plan-front-intent");

  await fakeClient.submitRun(bound.runRequest);

  assert.equal(intent.runRequest.run_type, "monte_carlo");
  assert.equal(intent.runRequest.mc_experiment_id, "mc-front-intent");
  assert.equal("sample_count" in intent.runRequest, false);
  assert.equal("samples" in intent.runRequest, false);
  assert.equal("sweep" in intent.runRequest, false);
  assert.equal("monte_carlo" in intent.runRequest, false);
  assert.equal(intent.experimentPlanConfig.analysisRequests.largeSample.samples, 5);
  assert.deepEqual(intent.experimentPlanConfig.analysisRequests.largeSample.sweep, {
    failureRates: [1.0],
    spareMultipliers: [1.0],
    supportCapacities: [1]
  });
  assert.deepEqual(submittedRequests, [bound.runRequest]);
});

test("buildRunIntent defaults Monte Carlo to single-point baseline parameter space", () => {
  const projectJson = {
    project_id: "project-baseline-mc",
    experiment: { name: "baseline mc", steps: 4, samples: 9, seed: 101 },
    supportNodes: [
      { id: "carrier-deck", equipmentCapacity: 4, personnelCapacity: 8 },
      { id: "carrier-stock", equipmentCapacity: 2, personnelCapacity: 5 }
    ],
    monteCarlo: {
      failureRates: [0.035, 0.055, 0.075],
      spareMultipliers: [0.75, 1, 1.25],
      supportCapacities: [2, 3, 4]
    },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 24,
        sweep: {
          failureRates: [0.035, 0.055, 0.075],
          spareMultipliers: [0.75, 1, 1.25],
          supportCapacities: [2, 3, 4]
        }
      }
    }
  };

  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson: projectJson,
    mcExperimentId: "mc-baseline"
  });

  assert.equal(intent.experimentPlanConfig.analysisRequests.largeSample.samples, 24);
  assert.deepEqual(intent.experimentPlanConfig.analysisRequests.largeSample.sweep, {
    failureRates: [1.0],
    spareMultipliers: [1.0],
    supportCapacities: [4]
  });
  assert.deepEqual(intent.planProjectJson.analysisRequests.largeSample.sweep, {
    failureRates: [1.0],
    spareMultipliers: [1.0],
    supportCapacities: [4]
  });
});

test("buildRunIntent stores current analysis profile in ExperimentPlan config only", () => {
  const projectJson = {
    project_id: "project-current-profile",
    experiment: { name: "current profile", steps: 4, samples: 3, seed: 101 },
    supportNodes: [{ id: "carrier-deck", equipmentCapacity: 4, inventory: { "发动机备件": 4 } }]
  };
  const analysisProfile = {
    analysisType: "carry_list",
    scenarioOverrides: {
      sparesBySupportPoint: [
        { supportPointId: "carrier-deck", spareTypeId: "发动机备件", quantity: 12 }
      ],
      missionDurationMinutes: 720
    },
    carryListConfig: { missionConfidenceTarget: 0.95 }
  };

  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson: projectJson,
    mcExperimentId: "current-carry-list",
    analysisType: "carry_list",
    analysisProfile
  });

  assert.equal(intent.experimentPlanConfig.analysisType, "carry_list");
  assert.deepEqual(intent.experimentPlanConfig.scenarioOverrides, analysisProfile.scenarioOverrides);
  assert.deepEqual(intent.experimentPlanConfig.carryListConfig, analysisProfile.carryListConfig);
  assert.deepEqual(intent.experimentPlanConfig.analysisProfile, analysisProfile);
  assert.equal("analysisType" in intent.runRequest, false);
  assert.equal("scenarioOverrides" in intent.runRequest, false);
  assert.equal("carryListConfig" in intent.runRequest, false);
});

test("buildRunIntent preserves explicit analysis sweep mode and raises samples to cover every sweep point", () => {
  const projectJson = {
    project_id: "project-sweep-coverage",
    experiment: { name: "sweep coverage", steps: 4, samples: 24, seed: 101 },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 24,
        sweep: {
          failureRates: [0.035, 0.055, 0.075],
          spareMultipliers: [0.75, 1, 1.25],
          supportCapacities: [2, 3, 4]
        }
      }
    }
  };

  const intent = buildRunIntent({
    runType: "monte_carlo",
    projectJson,
    planProjectJson: projectJson,
    mcExperimentId: "mc-sweep-coverage",
    monteCarloParameterSpace: "sweep"
  });

  assert.equal(intent.experimentPlanConfig.samples, 27);
  assert.equal(intent.experimentPlanConfig.analysisRequests.largeSample.samples, 27);
  assert.deepEqual(intent.experimentPlanConfig.analysisRequests.largeSample.sweep, {
    failureRates: [0.035, 0.055, 0.075],
    spareMultipliers: [0.75, 1, 1.25],
    supportCapacities: [2, 3, 4]
  });
  assert.equal(intent.experimentPlanConfig.projectJson.experiment.samples, 27);
  assert.equal(intent.experimentPlanConfig.projectJson.analysisRequests.largeSample.samples, 27);
  assert.equal(intent.planProjectJson.experiment.samples, 27);
  assert.equal(intent.planProjectJson.analysisRequests.largeSample.samples, 27);
});

test("submitRunIntent sends user-edited Monte Carlo samples and seed in experiment plan config", async () => {
  const calls = [];
  const apiClient = {
    saveProject: async (projectJson) => {
      calls.push({ method: "saveProject", projectJson });
      return { project_id: "project-edited", status: "saved" };
    },
    createModelingSnapshot: async (projectId) => {
      calls.push({ method: "createModelingSnapshot", projectId });
      return { snapshot_id: "snapshot-edited" };
    },
    createExperimentPlan: async (projectId, config) => {
      calls.push({ method: "createExperimentPlan", projectId, config });
      return { experiment_plan_id: "plan-edited" };
    },
    submitRun: async (request) => {
      calls.push({ method: "submitRun", request });
      return { run_id: "run-edited", status: "queued", ...request };
    }
  };
  const { submitRunIntent } = await import("../front/run-intent.mjs");
  const projectJson = {
    project_id: "project-edited",
    experiment: { name: "runtime MC edit", steps: 4, samples: 3, seed: 101 },
    monteCarlo: {
      failureRates: [0.06],
      spareMultipliers: [1.0],
      supportCapacities: [2]
    }
  };
  const planProjectJson = JSON.parse(JSON.stringify(projectJson));
  const applyDraftChange = (path, value) => {
    const parts = path.split(".");
    let current = planProjectJson;
    for (const part of parts.slice(0, -1)) current = current[part];
    current[parts.at(-1)] = value;
  };
  applyDraftChange("experiment.samples", 17);
  applyDraftChange("experiment.seed", 909);

  await submitRunIntent(apiClient, {
    runType: "monte_carlo",
    projectJson,
    planProjectJson,
    mcExperimentId: "mc-edited"
  });

  const planCall = calls.find((call) => call.method === "createExperimentPlan");
  const runCall = calls.find((call) => call.method === "submitRun");
  const snapshotCall = calls.find((call) => call.method === "createModelingSnapshot");
  assert.equal(snapshotCall.projectId, "project-edited");
  assert.equal(planCall.config.modeling_snapshot_id, "snapshot-edited");
  assert.notEqual(projectJson.experiment.samples, planProjectJson.experiment.samples);
  assert.notEqual(projectJson.experiment.seed, planProjectJson.experiment.seed);
  assert.equal(planCall.config.analysisRequests.largeSample.samples, 17);
  assert.equal(planCall.config.seed, 909);
  assert.equal(planCall.config.projectJson.experiment.samples, 17);
  assert.equal(planCall.config.projectJson.experiment.seed, 909);
  assert.equal(runCall.request.run_type, "monte_carlo");
  assert.equal(runCall.request.mc_experiment_id, "mc-edited");
  assert.equal("sample_count" in runCall.request, false);
  assert.equal("samples" in runCall.request, false);
  assert.equal("sweep" in runCall.request, false);
});

test("submitRunIntent preserves edited composite task equipment quantity through save and plan config", async () => {
  const calls = [];
  const apiClient = {
    saveProject: async (projectJson) => {
      calls.push({ method: "saveProject", projectJson });
      return { project_id: projectJson.project_id, status: "saved" };
    },
    createModelingSnapshot: async (projectId) => {
      calls.push({ method: "createModelingSnapshot", projectId });
      return { snapshot_id: "snapshot-edited-quantity" };
    },
    createExperimentPlan: async (projectId, config) => {
      calls.push({ method: "createExperimentPlan", projectId, config });
      return { experiment_plan_id: "plan-edited-quantity" };
    },
    submitRun: async (request) => {
      calls.push({ method: "submitRun", request });
      return { run_id: "run-edited-quantity", status: "queued", ...request };
    }
  };
  const { submitRunIntent } = await import("../front/run-intent.mjs");
  const projectJson = {
    project_id: "project-edited-quantity",
    experiment: { name: "quantity edit", steps: 4, seed: 101 },
    missionProfile: {
      compositeTasks: [
        {
          id: "composite-edited",
          taskItems: [
            {
              id: "task-edited",
              equipmentType: "J-15",
              equipmentQuantity: 1
            }
          ]
        }
      ]
    }
  };
  const planProjectJson = JSON.parse(JSON.stringify(projectJson));

  await submitRunIntent(apiClient, {
    runType: "single",
    projectJson,
    planProjectJson
  });

  const saveCall = calls.find((call) => call.method === "saveProject");
  const planCall = calls.find((call) => call.method === "createExperimentPlan");
  const snapshotCall = calls.find((call) => call.method === "createModelingSnapshot");
  assert.equal(snapshotCall.projectId, "project-edited-quantity");
  assert.equal(planCall.config.modeling_snapshot_id, "snapshot-edited-quantity");
  assert.equal(saveCall.projectJson.missionProfile.compositeTasks[0].taskItems[0].equipmentQuantity, 1);
  assert.equal(planCall.config.projectJson.missionProfile.compositeTasks[0].taskItems[0].equipmentQuantity, 1);
  assert.equal(
    "requiredEquipmentQuantity" in planCall.config.projectJson.missionProfile.compositeTasks[0].taskItems[0],
    false
  );
});
