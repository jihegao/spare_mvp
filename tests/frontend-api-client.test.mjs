import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildBackendProjectJson, buildExperimentPlanConfig, createBackendApiClient } from "../front/api-client.mjs";

test("frontend API client exposes stable PR-F save run and result methods", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/projects/validate") return { ok: true, project_id: "project-ui" };
      if (request.path === "/projects" && request.method === "GET") return { projects: [{ project_id: "project-ui" }] };
      if (request.path === "/projects" && request.method === "POST") return { project_id: "project-ui", status: "saved" };
      if (request.path === "/projects/project-ui" && request.method === "DELETE") return { project_id: "project-ui", deleted: true };
      if (request.path === "/projects/project-ui") return { project_id: "project-ui", project_version: "project-v0.1" };
      if (request.path === "/projects/project-ui/modeling-snapshots") return { snapshot_id: "snapshot-ui" };
      if (request.path === "/projects/project-ui/experiment-plans") return { experiment_plan_id: "plan-ui" };
      if (request.path === "/runs") {
        return {
          run_id: "run-ui",
          project_id: "project-ui",
          scenario_id: "scenario-ui",
          result_summary_id: "result-ui",
          artifact_manifest_id: "artifact-ui",
          status: "succeeded",
          phase: "completed",
          progress: 1
        };
      }
      if (request.path === "/runs/run-ui") return { run_id: "run-ui", status: "succeeded", phase: "completed", progress: 1 };
      if (request.path === "/runs/run-ui/result") return { result_id: "result-ui", metrics: { mission_success_rate: 0.9 } };
      if (request.path === "/runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", artifacts: [] };
      if (request.path === "/runs/run-ui/chain") {
        return {
          project_id: "project-ui",
          modeling_snapshot_id: "snapshot-ui",
          experiment_plan_id: "plan-ui",
          scenario_id: "scenario-ui",
          run_id: "run-ui",
          result_summary_id: "result-ui",
          artifact_manifest_id: "artifact-ui"
        };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const project = { project_id: "project-ui", experiment: { steps: 2 } };
  const saved = await client.saveProject(project);
  const projectCatalog = await client.listProjects();
  const storedProject = await client.getProject(saved.project_id);
  const deletedProject = await client.deleteProject(saved.project_id);
  const snapshot = await client.createModelingSnapshot(saved.project_id);
  const plan = await client.createExperimentPlan(saved.project_id, { steps: 2 });
  const run = await client.submitRun({
    project_id: saved.project_id,
    experiment_plan_id: plan.experiment_plan_id,
    model_family: "aircraft_support_v1",
    run_type: "single"
  });
  const storedRun = await client.getRunStatus(run.run_id);
  const result = await client.getRunResult(run.run_id);
  const artifacts = await client.getRunArtifacts(run.run_id);
  const chain = await client.getRunChain(run.run_id);

  assert.equal(storedProject.project_id, "project-ui");
  assert.equal(deletedProject.deleted, true);
  assert.equal(projectCatalog.projects[0].project_id, "project-ui");
  assert.equal(snapshot.snapshot_id, "snapshot-ui");
  assert.equal(run.status, "succeeded");
  assert.equal(run.phase, "completed");
  assert.equal(storedRun.run_id, "run-ui");
  assert.equal(result.result_id, "result-ui");
  assert.equal(artifacts.artifact_manifest_id, "artifact-ui");
  assert.equal(chain.artifact_manifest_id, "artifact-ui");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /projects/validate",
    "POST /projects",
    "GET /projects",
    "GET /projects/project-ui",
    "DELETE /projects/project-ui",
    "POST /projects/project-ui/modeling-snapshots",
    "POST /projects/project-ui/experiment-plans",
    "POST /runs",
    "GET /runs/run-ui",
    "GET /runs/run-ui/result",
    "GET /runs/run-ui/artifacts",
    "GET /runs/run-ui/chain"
  ]);
  assert.equal(calls[7].body.model_family, "aircraft_support_v1");
  assert.equal(calls[7].body.run_type, "single");
});

test("frontend API client exposes only canonical run read routes", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs") return { run_id: "run-canonical", status: "succeeded", phase: "completed" };
      if (request.path === "/runs/run-canonical") return { run_id: "run-canonical", phase: "completed" };
      if (request.path === "/runs/run-canonical/result") return { run_id: "run-canonical", summary: {} };
      if (request.path === "/runs/run-canonical/artifacts") return { run_id: "run-canonical", artifacts: [] };
      if (request.path === "/runs/run-canonical/chain") return { run_id: "run-canonical", project_id: "project-ui" };
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const submitted = await client.startSimulationRun("project-ui", "plan-ui");
  const status = await client.getRunStatus(submitted.run_id);
  const result = await client.getRunResult(submitted.run_id);
  const artifacts = await client.getRunArtifacts(submitted.run_id);
  const chain = await client.getRunChain(submitted.run_id);

  assert.equal(status.phase, "completed");
  assert.equal(result.run_id, "run-canonical");
  assert.deepEqual(artifacts.artifacts, []);
  assert.equal(chain.project_id, "project-ui");
  assert.equal(typeof client.getRun, "undefined");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /runs",
    "GET /runs/run-canonical",
    "GET /runs/run-canonical/result",
    "GET /runs/run-canonical/artifacts",
    "GET /runs/run-canonical/chain"
  ]);
  assert.equal(calls[0].body.model_family, "aircraft_support_v1");
  assert.equal(calls[0].body.run_type, "single");
});

test("frontend API client exposes M7 run artifact management routes", async () => {
  const calls = [];
  const requests = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      requests.push(request);
      calls.push(`${request.method} ${request.path}`);
      if (request.path === "/runs") return { runs: [{ run_id: "run-ui" }] };
      if (request.path === "/runs/run-ui/detail") return { run: { run_id: "run-ui" }, artifact_manifest: { artifacts: [] } };
      if (request.path === "/runs/run-ui/artifacts/artifact-ui") return { ok: true, artifact_id: "artifact-ui" };
      if (request.path === "/runs/run-ui/archive") return { run_id: "run-ui", lifecycle_status: "archived" };
      if (request.path === "/runs/run-ui") return { run_id: "run-ui", lifecycle_status: "deleted" };
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  await client.listRuns();
  await client.getRunDetail("run-ui");
  await client.downloadRunArtifact("run-ui", "artifact-ui");
  await client.archiveRun("run-ui");
  await client.deleteRun("run-ui");

  assert.deepEqual(calls, [
    "GET /runs",
    "GET /runs/run-ui/detail",
    "GET /runs/run-ui/artifacts/artifact-ui",
    "POST /runs/run-ui/archive",
    "DELETE /runs/run-ui"
  ]);
  const downloadRequest = requests.find((request) => request.path === "/runs/run-ui/artifacts/artifact-ui");
  assert.equal(downloadRequest.responseType, "blob");
});

test("frontend API client posts current Project JSON to independent Mesa visualization route", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/mesa-visualization-runs") {
        return {
          status: "succeeded",
          source: "independent_mesa_project",
          run_id: "independent-mesa-project-ui-1234",
          model_family: "aircraft_support_v1",
          state_series: { schema_version: "visualization-state-series-v0", run_id: "independent-mesa-project-ui-1234", frames: [] }
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const projectJson = { project_id: "project-ui", scenarioId: "current-project", experiment: { seed: 7 } };
  const response = await client.runIndependentMesaVisualization(projectJson);

  assert.equal(response.source, "independent_mesa_project");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /mesa-visualization-runs"
  ]);
  assert.deepEqual(calls[0].body.project, projectJson);
  assert.equal(calls[0].body.model_family, "aircraft_support_v1");
});

test("frontend API client posts current Project JSON to independent Mesa analysis route", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/mesa-analysis-runs") {
        return {
          status: "session_complete",
          source: "lite_mesa_aircraft_support_v1",
          run_id: "lite-mesa-analysis-project-ui-1234",
          model_family: "aircraft_support_v1",
          analysis_type: "spare_shortfall",
          sample_count: 12,
          metrics: [["短缺类别", "1"]],
          rows: []
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const projectJson = { project_id: "project-ui", scenarioId: "current-project", experiment: { seed: 7 } };
  const settings = { samples: 12, seed: 20260621 };
  const response = await client.runLiteMesaAnalysis(projectJson, "spare_shortfall", settings);

  assert.equal(response.source, "lite_mesa_aircraft_support_v1");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /mesa-analysis-runs"
  ]);
  assert.deepEqual(calls[0].body.project, projectJson);
  assert.equal(calls[0].body.analysis_type, "spare_shortfall");
  assert.deepEqual(calls[0].body.settings, settings);
  assert.equal(calls[0].body.model_family, "aircraft_support_v1");
});

test("frontend API client lists and deletes experiment plans through project routes", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/projects/project-ui/experiment-plans" && request.method === "GET") {
        return { experiment_plans: [{ experiment_plan_id: "plan-ui", run_count: 1 }] };
      }
      if (request.path === "/projects/project-ui/experiment-plans/plan-ui" && request.method === "DELETE") {
        return { experiment_plan_id: "plan-ui", deleted: true, soft_deleted_run_ids: ["run-ui"] };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const plans = await client.listExperimentPlans("project-ui");
  const deleted = await client.deleteExperimentPlan("project-ui", "plan-ui");

  assert.equal(plans.experiment_plans[0].experiment_plan_id, "plan-ui");
  assert.deepEqual(deleted.soft_deleted_run_ids, ["run-ui"]);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /projects/project-ui/experiment-plans",
    "DELETE /projects/project-ui/experiment-plans/plan-ui"
  ]);
});

test("frontend API client posts M9.3 run control actions to canonical route", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs/run-ui/control") {
        return { run_id: "run-ui", status: "cancelled", phase: "cancelled", control: { action: "cancel" } };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const controlled = await client.controlRun("run-ui", "cancel");

  assert.equal(controlled.status, "cancelled");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /runs/run-ui/control"
  ]);
  assert.deepEqual(calls[0].body, { action: "cancel" });
});

test("frontend API client reads run artifact JSON payloads for M8 analysis projections", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs/run-ui/artifacts/artifact-spare") {
        return {
          projection_type: "spare_shortfall",
          data: [{ spare_type: "engine", fill_rate: 0.82, shortage_probability: 0.24 }]
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const payload = await client.getRunArtifactPayload("run-ui", "artifact-spare");

  assert.equal(payload.projection_type, "spare_shortfall");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /runs/run-ui/artifacts/artifact-spare"
  ]);
  assert.equal(calls[0].responseType, "json");
});

test("frontend API client reads current analysis result records", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/projects/project-ui/analysis-results/spare_shortfall") {
        return {
          analysis_type: "spare_shortfall",
          status: "completed",
          source: "formal_backend",
          last_success_result: { projection_type: "spare_shortfall" }
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  const current = await client.getCurrentAnalysisResult("project-ui", "spare_shortfall");

  assert.equal(current.status, "completed");
  assert.equal(current.last_success_result.projection_type, "spare_shortfall");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /projects/project-ui/analysis-results/spare_shortfall"
  ]);
  assert.equal(calls[0].responseType, "json");
});

test("frontend API client preserves formal M6.2 monte carlo SimulationExperimentBase fields", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs") {
        return {
          ...request.body,
          run_id: "run-mc-ui",
          scenario_id: "scenario-ui",
          artifact_manifest_id: "artifact-manifest-run-mc-ui",
          status: "queued",
          phase: "queued",
          progress: 0
        };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });
  const runRequest = {
    experiment_id: "experiment-mc-ui",
    experiment_type: "monte_carlo",
    module: "备件规划评估模块",
    project_id: "project-ui",
    experiment_plan_id: "plan-ui",
    scenario_id: "scenario-ui",
    scenario_version: "scenario-v0.1",
    model_family: "aircraft_support_v1",
    run_type: "monte_carlo",
    seed: 20260620,
    mc_experiment_id: "mc-exp-ui-001",
    analysis_requests: {
      spare_shortfall: true,
      carry_list: true,
      mission_reliability: true,
      downtime_factors: true
    }
  };

  const submitted = await client.submitRun(runRequest);

  assert.equal(submitted.run_type, "monte_carlo");
  assert.equal(submitted.experiment_id, "experiment-mc-ui");
  assert.equal(submitted.mc_experiment_id, "mc-exp-ui-001");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /runs"]);
  assert.deepEqual(calls[0].body, runRequest);
});

test("frontend API client submitRun posts canonical run request without Monte Carlo numeric config", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs") return { ...request.body, run_id: "run-canonical-mc", status: "queued" };
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });
  const runRequest = {
    project_id: "project-ui",
    experiment_plan_id: "plan-ui",
    model_family: "aircraft_support_v1",
    run_type: "monte_carlo",
    mc_experiment_id: "mc-ui"
  };

  await client.submitRun(runRequest);

  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /runs"]);
  assert.deepEqual(calls[0].body, runRequest);
  assert.equal("sample_count" in calls[0].body, false);
  assert.equal("samples" in calls[0].body, false);
  assert.equal("sweep" in calls[0].body, false);
  assert.equal("monte_carlo" in calls[0].body, false);
});

test("frontend API client gives formal run submission enough time for synchronous Monte Carlo", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      return { run_id: "run-slow-mc", status: "succeeded", phase: "completed" };
    }
  });

  await client.submitRun({
    project_id: "project-ui",
    experiment_plan_id: "plan-ui",
    model_family: "aircraft_support_v1",
    run_type: "monte_carlo"
  });
  await client.startSimulationRun("project-ui", "plan-ui");

  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /runs", "POST /runs"]);
  assert.equal(calls[0].timeoutMs, 180000);
  assert.equal(calls[1].timeoutMs, 180000);
});

test("frontend API client exposes explicit M5 modeling import methods", async () => {
  const apiClientSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/modeling-imports/validate") return { ok: true, status: "valid", issues: [] };
      if (request.path === "/project-data-templates?state=published") {
        return {
          templates: [
            {
              template_id: "import/ui demo",
              source_import_id: "import/ui demo",
              template_type: "project_data",
              project_id: "project-ui-demo",
              name: "UI 模板",
              validation_status: "valid"
            }
          ]
        };
      }
      if (request.path === "/modeling-imports") return { import_id: "import/ui demo", validation_status: "valid" };
      if (request.path === "/modeling-imports/import%2Fui%20demo") {
        return {
          importId: "import/ui demo",
          lifecycle: { state: "draft", version: 2 },
          draftPackage: { importId: "import/ui demo", lifecycle: { state: "draft", version: 2 } },
          publishedPackage: { importId: "import/ui demo", lifecycle: { state: "published", version: 1 } }
        };
      }
      if (request.path === "/modeling-imports/import%2Fui%20demo/publish") {
        return {
          importId: "import/ui demo",
          lifecycle: { state: "published", version: 2 },
          draftPackage: { importId: "import/ui demo", lifecycle: { state: "published", version: 2 } },
          publishedPackage: { importId: "import/ui demo", lifecycle: { state: "published", version: 2 } }
        };
      }
      if (request.path === "/modeling-imports/import%2Fui%20demo/compile-scenario") {
        return {
          compiled_from_import: { import_id: "import/ui demo", model_family: request.body.model_family },
          scenario: { scenario_id: "import-ui-demo" }
        };
      }
      if (request.path === "/modeling-imports/import%2Fui%20demo/create-project") {
        return {
          sourceImport: { import_id: "import/ui demo", project_id: "project-ui-demo" },
          savedProject: { project_id: "project-ui-demo", status: "saved" },
          project: { project_id: "project-ui-demo" },
          modelingSnapshot: { snapshot_id: "snapshot-ui-demo", project: { project_id: "project-ui-demo" } }
        };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });
  const importPackage = { schemaVersion: "modeling-import-v1", importId: "import/ui demo" };

  const validation = await client.validateModelingImport(importPackage);
  const templates = await client.listProjectDataTemplates({ state: "published" });
  const saved = await client.saveModelingImport(importPackage);
  const stored = await client.getModelingImport(importPackage.importId);
  const published = await client.publishModelingImport(importPackage.importId);
  const compiled = await client.compileModelingImportScenario(importPackage.importId);
  const createdProject = await client.createProjectFromModelingImport(importPackage.importId);

  assert.equal(validation.status, "valid");
  assert.equal(templates.templates[0].template_id, "import/ui demo");
  assert.equal(templates.templates[0].source_import_id, "import/ui demo");
  assert.equal(templates.templates[0].template_type, "project_data");
  assert.equal("version" in templates.templates[0], false);
  assert.equal("schema_version" in templates.templates[0], false);
  assert.equal("lifecycle_state" in templates.templates[0], false);
  assert.equal(saved.import_id, "import/ui demo");
  assert.equal(stored.importId, "import/ui demo");
  assert.equal(stored.draftPackage.lifecycle.version, 2);
  assert.equal(stored.publishedPackage.lifecycle.version, 1);
  assert.equal(published.lifecycle.state, "published");
  assert.equal(published.publishedPackage.lifecycle.state, "published");
  assert.equal(compiled.compiled_from_import.model_family, "aircraft_support_v1");
  assert.equal(createdProject.sourceImport.import_id, "import/ui demo");
  assert.equal(createdProject.modelingSnapshot.project.project_id, "project-ui-demo");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /modeling-imports/validate",
    "GET /project-data-templates?state=published",
    "POST /modeling-imports",
    "GET /modeling-imports/import%2Fui%20demo",
    "POST /modeling-imports/import%2Fui%20demo/publish",
    "POST /modeling-imports/import%2Fui%20demo/compile-scenario",
    "POST /modeling-imports/import%2Fui%20demo/create-project"
  ]);
  assert.equal(calls[0].body, importPackage);
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[2].body, importPackage);
  assert.deepEqual(calls[5].body, { model_family: "aircraft_support_v1" });
  assert.equal(calls[6].body, undefined);
  assert.doesNotMatch(apiClientSource, /listModelingImportTemplates/);
});

test("frontend API client createProjectFromModelingImport uses protected modeling import route", async () => {
  const calls = [];
  const client = createBackendApiClient({
    getAuthToken: () => "session-data",
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/modeling-imports/import%2Fsample/create-project") {
        return {
          sourceImport: { import_id: "import/sample" },
          project: { project_id: "project-sample" },
          savedProject: { project_id: "project-sample" },
          modelingSnapshot: { snapshot_id: "snapshot-sample" }
        };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const created = await client.createProjectFromModelingImport("import/sample");

  assert.equal(created.project.project_id, "project-sample");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /modeling-imports/import%2Fsample/create-project"
  ]);
  assert.equal(calls[0].headers.authorization, "Bearer session-data");
  assert.equal(calls[0].body, undefined);
});

test("buildBackendProjectJson syncs composite task inherited basic mission fields", () => {
  const scenario = {
    scenarioId: "sync-basic-fields",
    basicMissions: [{
      id: "basic-alpha",
      name: "Basic Alpha",
      equipmentType: "J-35",
      taskDurationMinutes: 95,
      equipmentQuantity: 4,
      minRequiredSorties: 3,
      preparationMinutes: 25
    }],
    missionProfile: {
      compositeTasks: [{
        id: "composite-alpha",
        taskItems: [{
          basicMissionId: "basic-alpha",
          basicTaskName: "Basic Alpha",
          equipmentType: "stale",
          taskDurationMinutes: 10,
          equipmentQuantity: 1,
          minRequiredSystems: 1,
          preparationMinutes: 5,
          groupName: "Editable group",
          firstWaveTime: "08:30"
        }]
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "sync" });
  const syncedItem = projectJson.missionProfile.compositeTasks[0].taskItems[0];

  assert.equal(syncedItem.equipmentType, "J-35");
  assert.equal(syncedItem.taskDurationMinutes, 95);
  assert.equal(syncedItem.equipmentQuantity, 4);
  assert.equal(syncedItem.minRequiredSystems, 1);
  assert.equal(syncedItem.preparationMinutes, 25);
  assert.equal(syncedItem.groupName, "Editable group");
  assert.equal(syncedItem.firstWaveTime, "08:30");
  assert.equal(scenario.missionProfile.compositeTasks[0].taskItems[0].equipmentType, "stale");
});

test("buildBackendProjectJson migrates legacy basicMission into basicMissions", () => {
  const scenario = {
    scenarioId: "legacy-basic-mission",
    basicMissions: [],
    basicMission: {
      missionId: "legacy-basic",
      name: "旧基本任务",
      equipmentType: "J-15",
      taskDurationMinutes: 75,
      equipmentQuantity: 2,
      preparationMinutes: 35
    },
    missionProfile: {
      basicMission: {
        missionId: "profile-legacy-basic",
        name: "剖面旧基本任务",
        equipmentType: "J-35"
      },
      basicMissions: [{
        id: "profile-array-basic",
        name: "剖面数组基本任务",
        equipmentType: "J-20"
      }],
      compositeTasks: [{
        id: "composite-alpha",
        taskItems: [{
          basicMissionId: "legacy-basic",
          basicTaskName: "旧基本任务",
          equipmentType: "stale",
          taskDurationMinutes: 1,
          equipmentQuantity: 1,
          preparationMinutes: 1
        }]
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "legacy-basic-mission" });
  const syncedItem = projectJson.missionProfile.compositeTasks[0].taskItems[0];

  assert.deepEqual(projectJson.basicMissions.map((task) => task.id), [
    "legacy-basic",
    "profile-legacy-basic",
    "profile-array-basic"
  ]);
  assert.equal("basicMission" in projectJson, false);
  assert.equal("basicMission" in projectJson.missionProfile, false);
  assert.equal("basicMissions" in projectJson.missionProfile, false);
  assert.equal(syncedItem.equipmentType, "J-15");
  assert.equal(syncedItem.taskDurationMinutes, 75);
  assert.equal(syncedItem.equipmentQuantity, 2);
  assert.equal(syncedItem.preparationMinutes, 35);
  assert.ok("basicMission" in scenario);
  assert.ok("basicMission" in scenario.missionProfile);
});

test("buildBackendProjectJson canonicalizes support activity job predecessor references", () => {
  const scenario = {
    scenarioId: "support-predecessor-canonical",
    supportActivities: Array.from({ length: 6 }, (_, index) => ({ id: `activity-${index}`, jobs: [] }))
  };
  scenario.supportActivities[5] = {
    id: "activity-with-legacy-predecessor",
    jobs: [
      {
        activityCode: "BA-001",
        workName: "目标保障作业",
        durationMinutes: 30,
        predecessors: ["电源车准备"]
      },
      {
        workName: "电源车准备",
        durationMinutes: 15,
        predecessors: []
      }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-predecessor-canonical" });
  const jobs = projectJson.supportActivities[5].jobs;

  assert.equal(jobs[1].activityCode, "BA-002");
  assert.deepEqual(jobs[0].predecessors, ["BA-002"]);
  assert.deepEqual(scenario.supportActivities[5].jobs[0].predecessors, ["电源车准备"]);
  assert.equal("activityCode" in scenario.supportActivities[5].jobs[1], false);
});

test("buildBackendProjectJson strips Monte Carlo config from Project modeling data", () => {
  const scenario = {
    scenarioId: "mc-project-boundary",
    deletedSupportResourceKeys: ["support-org:legacy"],
    missionProfile: {
      name: "Project modeling profile",
      profileType: "legacy profile label",
      repeatCycleHours: 6,
      endCondition: "legacy end condition",
      monteCarlo: {
        failureRates: [0.06],
        spareMultipliers: [1],
        supportCapacities: [2]
      },
      analysisRequests: {
        largeSample: {
          enabled: true,
          samples: 9,
          sweep: {
            failureRates: [0.09]
          }
        }
      }
    },
    supportActivities: [
      {
        id: "support-activity",
        requireDevices: 3,
        requiredDevices: 2
      }
    ],
    experiment: {
      name: "runtime branch",
      steps: 12,
      samples: 4,
      seed: 20260620
    },
    monteCarlo: {
      failureRates: [0.06, 0.08],
      spareMultipliers: [1],
      supportCapacities: [2]
    },
    analysisRequests: {
      largeSample: {
        enabled: true,
        samples: 4,
        sweep: {
          failureRates: [0.06],
          spareMultipliers: [1],
          supportCapacities: [2]
        }
      }
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "mc-project-boundary" });

  assert.equal("monteCarlo" in projectJson, false);
  assert.equal("analysisRequests" in projectJson, false);
  assert.equal("experiment" in projectJson, false);
  assert.equal("monteCarlo" in projectJson.missionProfile, false);
  assert.equal("profileType" in projectJson.missionProfile, false);
  assert.equal("repeatCycleHours" in projectJson.missionProfile, false);
  assert.equal("endCondition" in projectJson.missionProfile, false);
  assert.equal("analysisRequests" in projectJson.missionProfile, false);
  assert.equal("deletedSupportResourceKeys" in projectJson, false);
  assert.equal("requireDevices" in projectJson.supportActivities[0], false);
  assert.equal(projectJson.supportActivities[0].requiredDevices, 2);
  assert.ok("monteCarlo" in scenario);
  assert.ok("analysisRequests" in scenario);
  assert.ok("experiment" in scenario);
  assert.ok("monteCarlo" in scenario.missionProfile);
  assert.ok("requireDevices" in scenario.supportActivities[0]);
});

test("buildBackendProjectJson strips redundant equipment summaries from Project modeling data", () => {
  const scenario = {
    scenarioId: "combat-unit-is-source",
    equipment: {
      model: "legacy-summary",
      quantity: 7,
      initialReady: 6,
      wholeMachineModels: ["legacy-summary"]
    },
    combatUnit: {
      members: [
        { aircraftNo: "J15-101", model: "J-15" },
        { aircraftNo: "J35-201", model: "J-35" }
      ]
    },
    missionProfile: {
      equipment: {
        model: "legacy-profile-summary",
        quantity: 7
      },
      combatUnit: {
        members: [
          { aircraftNo: "J15-101", model: "J-15" }
        ]
      }
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "combat-unit-is-source" });

  assert.equal("equipment" in projectJson, false);
  assert.equal("equipment" in projectJson.missionProfile, false);
  assert.equal(projectJson.combatUnit.members.length, 2);
  assert.equal(projectJson.missionProfile.combatUnit.members.length, 1);
  assert.ok("equipment" in scenario);
  assert.ok("equipment" in scenario.missionProfile);
});

test("experiment plan config preserves Monte Carlo branch sweep settings", () => {
  const projectJson = {
    experiment: {
      name: "branch config",
      steps: 12,
      samples: 24,
      seed: 20260620
    },
    monteCarlo: {
      failureRates: [0.06, 0.08, 0.1],
      spareMultipliers: [0.75, 1, 1.25],
      supportCapacities: [2, 3],
      minRequiredSorties: [4, 5]
    }
  };
  const config = buildExperimentPlanConfig(projectJson);

  assert.equal(config.name, "branch config");
  assert.equal(config.steps, 12);
  assert.equal(config.samples, 24);
  assert.equal(config.seed, 20260620);
  assert.deepEqual(config.monteCarlo, {
    failureRates: [0.06, 0.08, 0.1],
    spareMultipliers: [0.75, 1, 1.25],
    supportCapacities: [2, 3],
    minRequiredSorties: [4, 5]
  });
  assert.deepEqual(config.analysisRequests, {});
  assert.equal("experiment" in config.projectJson, false);
  assert.equal("monteCarlo" in config.projectJson, false);
  assert.equal("analysisRequests" in config.projectJson, false);
});

test("experiment plan config preserves analysisRequests for formal Monte Carlo runs", () => {
  const config = buildExperimentPlanConfig({
    experiment: { name: "MC config", steps: 8, samples: 5, seed: 20260620 },
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
    },
    monteCarlo: { spareMultipliers: [1] }
  });

  assert.equal(config.analysisRequests.largeSample.samples, 5);
  assert.deepEqual(config.analysisRequests.largeSample.sweep.supportCapacities, [2]);
  assert.equal("experiment" in config.projectJson, false);
  assert.equal("analysisRequests" in config.projectJson, false);
  assert.equal("monteCarlo" in config.projectJson, false);
});

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

test("buildExperimentPlanConfig rejects invalid scenario composition JSON overrides", () => {
  assert.throws(() => buildExperimentPlanConfig({
    project_id: "project-invalid-json-override",
    experiment: { name: "invalid json", steps: 4, samples: 2, seed: 11 },
    scenarioComposition: {
      overrides: [
        { path: "missionProfile.constraints", valueType: "json", value: "{\"min\": 1" }
      ]
    }
  }), SyntaxError);
});

test("frontend API client sends experiment plan branch project JSON to backend", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/projects/project-branch/experiment-plans") {
        return { experiment_plan_id: "plan-branch", config: request.body.config };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });
  const projectJson = {
    project_id: "project-branch",
    experiment: { name: "branch run", steps: 6, seed: 42 },
    components: [{ id: "radar", failureRate: 0.12 }],
    supportNodes: [{ id: "line", equipmentCapacity: 7 }]
  };

  await client.createExperimentPlan("project-branch", buildExperimentPlanConfig(projectJson));

  assert.equal(calls[0].path, "/projects/project-branch/experiment-plans");
  assert.equal(calls[0].body.config.seed, 42);
  assert.notEqual(calls[0].body.config.projectJson, projectJson);
  assert.equal("experiment" in calls[0].body.config.projectJson, false);
  assert.equal("analysisRequests" in calls[0].body.config.projectJson, false);
  assert.equal("monteCarlo" in calls[0].body.config.projectJson, false);
});

test("frontend API client logs in and attaches M4 bearer token to protected calls", async () => {
  const calls = [];
  let token = "";
  const client = createBackendApiClient({
    getAuthToken: () => token,
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/auth/login") {
        return {
          user: { user_id: "user-data", username: "data", role: "数据管理员" },
          session: { token: "session-data" }
        };
      }
      if (request.path === "/modeling-imports") return { import_id: "import-auth", validation_status: "valid" };
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const session = await client.login("data", "data");
  token = session.session.token;
  const saved = await client.saveModelingImport({ importId: "import-auth" });

  assert.equal(saved.import_id, "import-auth");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /auth/login",
    "POST /modeling-imports"
  ]);
  assert.equal(calls[0].headers?.authorization, undefined);
  assert.equal(calls[1].headers.authorization, "Bearer session-data");
});

test("frontend API client exposes user management methods with M4 bearer token", async () => {
  const calls = [];
  const client = createBackendApiClient({
    getAuthToken: () => "session-admin",
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/users") {
        if (request.method === "GET") return { users: [{ user_id: "user-admin", username: "admin" }] };
        return { user_id: "user-planner", username: request.body.username, role: request.body.role };
      }
      if (request.path === "/users/user-planner") {
        if (request.method === "DELETE") return { deleted: true };
        return { user_id: "user-planner", username: "planner", display_name: request.body.display_name };
      }
      if (request.path === "/system-configs/system-runtime-support") {
        if (request.method === "GET") return { config_key: "system-runtime-support", payload: { modelingForms: {} } };
        return { config_key: "system-runtime-support", payload: request.body.payload };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const listed = await client.listUsers();
  const created = await client.createUser({ username: "planner", password: "planner", role: "数据管理员" });
  const updated = await client.updateUser("user-planner", { display_name: "规划员二号" });
  const deleted = await client.deleteUser("user-planner");
  const loadedConfig = await client.getSystemConfig("system-runtime-support");
  const savedConfig = await client.saveSystemConfig("system-runtime-support", {
    modelingForms: { personnelSpecialties: ["机务"] }
  });

  assert.equal(listed.users[0].username, "admin");
  assert.equal(created.username, "planner");
  assert.equal(updated.display_name, "规划员二号");
  assert.equal(deleted.deleted, true);
  assert.deepEqual(loadedConfig.payload, { modelingForms: {} });
  assert.deepEqual(savedConfig.payload.modelingForms.personnelSpecialties, ["机务"]);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /users",
    "POST /users",
    "POST /users/user-planner",
    "DELETE /users/user-planner",
    "GET /system-configs/system-runtime-support",
    "POST /system-configs/system-runtime-support"
  ]);
  assert.equal(calls[0].headers.authorization, "Bearer session-admin");
  assert.equal(calls[1].headers.authorization, "Bearer session-admin");
  assert.equal(calls[2].headers.authorization, "Bearer session-admin");
  assert.equal(calls[3].headers.authorization, "Bearer session-admin");
  assert.equal(calls[5].body.payload.modelingForms.personnelSpecialties[0], "机务");
});

test("frontend API fetch transport preserves structured backend details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      code: "invalid_modeling_import",
      message: "Modeling import package failed validation",
      details: {
        issues: [
          {
            severity: "error",
            page: "保障活动建模",
            object_id: "inspect-radar",
            field_path: "objects.supportActivities[0].resourceId",
            message: "resourceId 引用了不存在的 supportResources 对象 missing-resource。"
          }
        ]
      }
    })
  });
  try {
    const client = createBackendApiClient({ baseUrl: "/api" });

    await assert.rejects(
      () => client.saveModelingImport({ importId: "bad-import" }),
      (err) => {
        assert.equal(err.code, "invalid_modeling_import");
        assert.equal(err.status, 400);
        assert.equal(err.details.issues[0].field_path, "objects.supportActivities[0].resourceId");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("frontend API fetch transport sends an abort signal for timeout control", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (_url, init = {}) => {
    observedSignal = init.signal;
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: { user_id: "user-admin" } })
    };
  };
  try {
    const client = createBackendApiClient({ baseUrl: "/api" });

    await client.getSession();

    assert.ok(observedSignal);
    assert.equal(typeof observedSignal.aborted, "boolean");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("frontend API fetch transport classifies network failures for blocking UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const client = createBackendApiClient({ baseUrl: "/api" });

    await assert.rejects(
      () => client.getSession(),
      (err) => {
        assert.equal(err.code, "backend_network_error");
        assert.equal(err.details.path, "/auth/session");
        assert.equal(err.details.method, "GET");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("frontend API fetch transport defines an AbortController timeout path", async () => {
  const apiSource = await readFile(new URL("../front/api-client.mjs", import.meta.url), "utf8");

  assert.match(apiSource, /AbortController/);
  assert.match(apiSource, /setTimeout/);
  assert.match(apiSource, /backend_request_timeout/);
});

test("frontend API client preserves compile gate error payload for submitRun", async () => {
  const compileGateError = new Error("unknown model family is not supported by the Scenario compiler");
  compileGateError.code = "unsupported_model_family";
  compileGateError.details = {
    issues: [
      {
        severity: "error",
        page: "Simulation run",
        field_path: "model_family",
        message: "缺少可编译的模型族。"
      }
    ],
    provenance: {
      model_family: "unknown_family",
      mapping_version: "unknown-family-input-v0"
    }
  };
  compileGateError.payload = {
    code: compileGateError.code,
    message: compileGateError.message,
    details: compileGateError.details
  };

  const client = createBackendApiClient({
    transport: async (request) => {
      assert.equal(request.path, "/runs");
      throw compileGateError;
    }
  });

  await assert.rejects(
    () => client.submitRun({
      project_id: "project-aviation",
      experiment_plan_id: "plan-aviation",
      model_family: "unknown_family",
      run_type: "single"
    }),
    (err) => {
      assert.equal(err.code, "unsupported_model_family");
      assert.equal(err.details.issues[0].field_path, "model_family");
      assert.equal(err.payload.details.provenance.model_family, "unknown_family");
      return true;
    }
  );
});

test("frontend app routes project save run and result reads through API client", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const runIntentSource = await readFile(new URL("../front/run-intent.mjs", import.meta.url), "utf8");

  assert.match(appSource, /from "\.\/api-client\.mjs"/);
  assert.match(appSource, /from "\.\/run-intent\.mjs"/);
  assert.match(appSource, /const AUTH_SESSION_STORAGE_KEY = "spare-mvp:m4Session"/);
  assert.match(appSource, /const backendApi = createBackendApiClient\(\{ baseUrl: "\/api", getAuthToken: \(\) => backendAuthToken \}\)/);
  assert.match(appSource, /async function handleLogin/);
  assert.match(appSource, /backendApi\.login/);
  assert.match(appSource, /localStorage\.setItem\(AUTH_SESSION_STORAGE_KEY/);
  assert.match(appSource, /async function saveCurrentProjectThroughApi/);
  assert.match(appSource, /async function startMonteCarloRunThroughApi/);
  assert.match(appSource, /async function refreshRunResultThroughApi/);
  assert.match(appSource, /backendApi\.saveProject/);
  assert.match(appSource, /backendApi\.getProject/);
  assert.match(appSource, /submitRunIntent\(backendApi/);
  assert.match(runIntentSource, /apiClient\.createModelingSnapshot/);
  assert.match(runIntentSource, /modeling_snapshot_id: modelingSnapshot\.snapshot_id/);
  assert.match(runIntentSource, /apiClient\.createExperimentPlan/);
  assert.match(runIntentSource, /apiClient\.submitRun/);
  assert.match(appSource, /backendApi\.getRunStatus/);
  assert.doesNotMatch(appSource, /backendApi\.startSimulationRun/);
  assert.doesNotMatch(appSource, /backendApi\.getRun\(/);
  assert.match(appSource, /backendApi\.getRunResult/);
  assert.match(appSource, /backendApi\.getRunArtifacts/);
  assert.match(appSource, /backendApi\.getRunChain/);
  assert.match(appSource, /backendRunChain/);
  assert.match(appSource, /backend-run-chain/);
  assert.match(appSource, /backendArtifactManifest\.artifacts/);
  assert.match(appSource, /ArtifactManifest/);
  assert.match(appSource, /正式来源/);
  assert.match(appSource, /正式结果来源/);
  assert.match(appSource, /monteCarloFormalResultBoundary/);
  assert.match(appSource, /renderAnalysisProjectionResultPanel/);
  assert.match(appSource, /hydrateLastBackendRunFromApi/);
  assert.match(appSource, /const LAST_BACKEND_RUN_STORAGE_KEY = "spare-mvp:lastBackendRun"/);
  assert.match(appSource, /localStorage\.setItem\(LAST_BACKEND_RUN_STORAGE_KEY/);
  assert.match(appSource, /localStorage\.getItem\(LAST_BACKEND_RUN_STORAGE_KEY/);
  assert.match(appSource, /experiment_plan_project_json: experimentPlanProjectJson/);
  assert.doesNotMatch(appSource, /run_id: "offline-demo-run"/);
  assert.doesNotMatch(appSource, /runSimulation\(scenario/);
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario/);
});

test("frontend generic editing remains local until explicit save or run", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const changeHandlerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("change"'),
    appSource.indexOf('app.addEventListener("input"')
  );
  const monteCarloArraySource = appSource.slice(
    appSource.indexOf("function updateMonteCarloArrayInput"),
    appSource.indexOf("function stateLabel")
  );
  const saveButtonSource = appSource.slice(
    appSource.indexOf('const savePlanButton = event.target.closest("[data-save-plan]"'),
    appSource.indexOf('const analysisActionButton = event.target.closest("[data-analysis-action]"')
  );

  assert.match(changeHandlerSource, /setPath\(scenario, input\.dataset\.path, parseInput\(input\)\)/);
  assert.match(changeHandlerSource, /updatePreviewResultsThroughApiClient\(\)/);
  assert.doesNotMatch(changeHandlerSource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(changeHandlerSource, /markProjectDraftChanged\(\)/);
  assert.match(monteCarloArraySource, /updatePreviewResultsThroughApiClient\(experimentPlanDraft\)/);
  assert.doesNotMatch(monteCarloArraySource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(appSource, /data-save-plan/);
  assert.match(saveButtonSource, /saveCurrentExperimentPlanThroughApi\(\)/);
  assert.doesNotMatch(saveButtonSource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(saveButtonSource, /render\(\)/);
});

test("app hydrates and saves current project draft through project API", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /const PROJECT_DRAFT_AUTOSAVE_DELAY_MS = 800/);
  assert.match(appSource, /function currentBackendProjectId/);
  assert.match(appSource, /async function hydrateCurrentProjectDraftFromApi/);
  assert.match(appSource, /async function saveCurrentProjectDraftThroughApi/);
  assert.match(appSource, /backendApi\.getProject\(currentBackendProjectId\(\)\)/);
  assert.match(appSource, /backendApi\.saveProject\(projectJson\)/);
});

test("project switch flushes pending project draft autosave before changing project context", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const enterHandlerSource = appSource.slice(
    appSource.indexOf('const enterWorkbenchButton = event.target.closest("[data-enter-workbench]"'),
    appSource.indexOf('const projectMenuButton = event.target.closest("[data-project-menu-toggle]"')
  );
  const enterWorkbenchSource = appSource.slice(
    appSource.indexOf("async function handleEnterWorkbench"),
    appSource.indexOf("function currentBackendProjectId")
  );
  const flushSource = appSource.slice(
    appSource.indexOf("async function flushPendingProjectDraftAutosave"),
    appSource.indexOf("function currentBackendProjectId")
  );

  assert.match(enterHandlerSource, /handleEnterWorkbench\(enterWorkbenchButton\.dataset\.projectId\)\.finally\(\(\) => render\(\)\)/);
  assert.doesNotMatch(enterHandlerSource, /currentProject =/);
  assert.ok(
    enterWorkbenchSource.indexOf("await flushPendingProjectDraftAutosave()") < enterWorkbenchSource.indexOf("currentProject ="),
    "pending draft save must flush before currentProject changes"
  );
  assert.match(flushSource, /clearTimeout\(projectDraftAutosaveTimer\)/);
  assert.match(flushSource, /projectDraftAutosaveTimer = null/);
  assert.match(flushSource, /projectDraftSaveStatus === "有未保存修改"/);
  assert.match(flushSource, /await saveCurrentProjectDraftThroughApi\(\)/);
});

test("frontend app wires local modeling import actions through explicit backend actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const featureCatalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const changeHandlerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("change"'),
    appSource.indexOf('app.addEventListener("input"')
  );

  assert.doesNotMatch(featureCatalogSource, /建模数据导入/);
  assert.doesNotMatch(featureCatalogSource, /modeling-import-workbench/);
  assert.match(appSource, /from "\.\/modeling-import-workbench\.mjs"/);
  assert.doesNotMatch(appSource, /from "\.\/modeling-import-templates\.mjs"/);
  assert.match(appSource, /renderLocalModelingImportActions/);
  assert.match(appSource, /data-modeling-import-action/);
  assert.doesNotMatch(appSource, /data-modeling-import-template/);
  assert.match(appSource, /data-modeling-import-file/);
  assert.match(appSource, /importModelingImportJsonFile/);
  assert.doesNotMatch(appSource, /loadModelingImportTemplate/);
  assert.match(appSource, /load-invalid-fixture/);
  assert.match(appSource, /backendApi\.validateModelingImport/);
  assert.match(appSource, /backendApi\.saveModelingImport/);
  assert.match(appSource, /backendApi\.getModelingImport/);
  assert.match(appSource, /backendApi\.publishModelingImport/);
  assert.match(appSource, /backendApi\.compileModelingImportScenario/);
  assert.match(appSource, /applyModelingImportRecord/);
  assert.match(appSource, /normalizeModelingImportRecord/);
  assert.doesNotMatch(changeHandlerSource, /validateModelingImport|saveModelingImport|publishModelingImport|compileModelingImportScenario/);
});

test("modeling import backfill projects the live project draft instead of rehydrating stale backend data", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const backfillSource = appSource.slice(
    appSource.indexOf('if (action === "backfill-current-project")'),
    appSource.indexOf('if (action === "validate")')
  );
  const inputHandlerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("input"'),
    appSource.indexOf("function clamp")
  );
  const changeHandlerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("change"'),
    appSource.indexOf('app.addEventListener("input"')
  );
  const livePathInputSource = inputHandlerSource.slice(
    inputHandlerSource.indexOf("const livePathInput"),
    inputHandlerSource.indexOf("const systemUserInput")
  );

  assert.match(backfillSource, /await flushPendingProjectDraftAutosave\(\)/);
  assert.match(backfillSource, /buildBackendProjectJson\(scenario, currentProject \|\| \{\}\)/);
  assert.match(backfillSource, /projectToModelingImportPackage\(projectJson, modelingImportPackage\)/);
  assert.doesNotMatch(backfillSource, /hydrateCurrentProjectDraftFromApi/);
  assert.match(inputHandlerSource, /updateSelectedPeriodicTask\(livePeriodicInput\.dataset\.periodicField, parseInput\(livePeriodicInput\), \{ renderAfter: false \}\)/);
  assert.match(livePathInputSource, /isLiveProjectDraftInput\(livePathInput\)/);
  assert.doesNotMatch(livePathInputSource, /setPath\(scenario, livePathInput\.dataset\.path, parseInput\(livePathInput\)\)/);
  assert.match(changeHandlerSource, /setPath\(scenario, input\.dataset\.path, parseInput\(input\)\)/);
});
