import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildBackendProjectJson,
  buildExperimentPlanConfig,
  createBackendApiClient,
  liteMesaAnalysisRequestTimeoutMs,
  normalizeProjectJsonForClientDraft
} from "../front/api-client.mjs";

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
      if (request.path === "/projects/project-ui/experiment-plans/plan-ui") return { experiment_plan_id: "plan-ui", status: "draft" };
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
  const updatedPlan = await client.updateExperimentPlan(saved.project_id, plan.experiment_plan_id, { steps: 3 });
  const run = await client.submitRun({
    project_id: saved.project_id,
    experiment_plan_id: updatedPlan.experiment_plan_id,
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
    "PUT /projects/project-ui/experiment-plans/plan-ui",
    "POST /runs",
    "GET /runs/run-ui",
    "GET /runs/run-ui/result",
    "GET /runs/run-ui/artifacts",
    "GET /runs/run-ui/chain"
  ]);
  assert.equal(calls[8].body.model_family, "aircraft_support_v1");
  assert.equal(calls[8].body.run_type, "single");
});

test("frontend API client requests RMS allocation export as a downloadable XLSX file", async () => {
  const requests = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      requests.push(request);
      return { blob: new Blob(["xlsx"]), filename: "RMS指标分配结果.xlsx" };
    }
  });

  const download = await client.exportRmsAllocationXlsx({ project_id: "project-rms" });

  assert.equal(download.filename, "RMS指标分配结果.xlsx");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].path, "/rms-allocation/export-xlsx");
  assert.equal(requests[0].responseType, "download");
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

test("frontend API client sends current and frozen run contexts without frozen setting overrides", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/visualization-sessions") {
        return {
          visualization_session_id: "visual-api-session",
          session_access_token: "visual-api-token",
          playback_speed: 1.5
        };
      }
      if (request.path === "/visualization-sessions/visual-api-session") {
        return {
          visualization_session_id: "visual-api-session",
          deleted: true
        };
      }
      if (request.path === "/mesa-analysis-runs") {
        return { status: "session_complete", source: "lite_mesa_aircraft_support_v1" };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    }
  });

  assert.equal("runIndependentMesaVisualization" in client, false);
  assert.equal(typeof client.runLiteMesaAnalysis, "function");

  const result = await client.runLiteMesaAnalysis(
      { kind: "current_project", project: { project_id: "project-ui" } },
      "mission_reliability",
      { samples: 4, seed: 20260705, parallelCores: 4 }
  );
  await client.runLiteMesaAnalysis(
    { kind: "frozen_plan", projectId: "project-ui", experimentPlanId: "plan-frozen" },
    "mission_reliability",
    { samples: 99, seed: 1, parallelCores: 31 },
    undefined,
    { samples: 24, seed: 20260621, parallelCores: 1 }
  );
  const visualizationSession = await client.createVisualizationSession({
    context: { kind: "current_project", project: { project_id: "project-ui" } },
    seed: 20260705,
    frameSampleEverySteps: 2,
    playbackSpeed: 1.5
  });
  const deletedVisualizationSession = await client.deleteVisualizationSession(
    visualizationSession.visualization_session_id,
    { keepalive: true }
  );

  assert.equal(result.source, "lite_mesa_aircraft_support_v1");
  assert.equal(visualizationSession.visualization_session_id, "visual-api-session");
  assert.equal(visualizationSession.session_access_token, "visual-api-token");
  assert.equal(deletedVisualizationSession.deleted, true);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /mesa-analysis-runs",
    "POST /mesa-analysis-runs",
    "POST /visualization-sessions",
    "DELETE /visualization-sessions/visual-api-session"
  ]);
  assert.equal(calls.at(-1).keepalive, true);
  assert.deepEqual(calls[0].body, {
      context: { kind: "current_project", project: { project_id: "project-ui" } },
      analysis_type: "mission_reliability",
      settings: { samples: 4, seed: 20260705, parallelCores: 4 },
      model_family: "aircraft_support_v1"
  });
  assert.deepEqual(calls[1].body, {
    context: { kind: "frozen_plan", projectId: "project-ui", experimentPlanId: "plan-frozen" },
    analysis_type: "mission_reliability",
    model_family: "aircraft_support_v1"
  });
  assert.equal("settings" in calls[1].body, false);
  assert.equal(calls[1].timeoutMs, 930000);
  assert.equal(calls[0].timeoutMs, 210000);
});

test("lite Mesa request timeout follows sample waves and stays above the backend session deadline", () => {
  assert.equal(liteMesaAnalysisRequestTimeoutMs({ samples: 4, parallelCores: 1 }), 480000);
  assert.equal(liteMesaAnalysisRequestTimeoutMs({ samples: 24, parallelCores: 4 }), 660000);
  assert.equal(liteMesaAnalysisRequestTimeoutMs({ samples: 24, parallelCores: 1 }), 930000);
  assert.equal(liteMesaAnalysisRequestTimeoutMs({ samples: 1000, parallelCores: 1 }), 930000);
  assert.equal(
    liteMesaAnalysisRequestTimeoutMs({
      samples: 1,
      parallelCores: 1,
      sampleTimeoutSeconds: 1,
      sessionTimeoutSeconds: 10
    }),
    40000
  );
  assert.equal(liteMesaAnalysisRequestTimeoutMs({ samples: 24, parallelCores: 4, sampleTimeoutSeconds: 120 }), 870000);
});

test("frontend API client saves and lists aircraft mission reliability snapshots", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.method === "POST") return { analysis_id: "analysis-202", snapshot: request.body.snapshot };
      return { project_id: "project-ui", analyses: [{ analysis_id: "analysis-202" }] };
    }
  });
  const snapshot = { aircraftModel: "J-15", aircraftReliability: 0.98, rows: [] };

  const saved = await client.saveAircraftMissionReliabilityAnalysis("project-ui", {
    aircraftModel: "J-15",
    missionProfileId: "mission-1",
    missionProfileName: "任务一",
    durationHours: 5,
    aircraftReliability: 0.98,
    snapshot
  });
  const history = await client.listAircraftMissionReliabilityAnalyses("project-ui");

  assert.equal(saved.analysis_id, "analysis-202");
  assert.equal(history.analyses.length, 1);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /projects/project-ui/aircraft-mission-reliability-analyses",
    "GET /projects/project-ui/aircraft-mission-reliability-analyses"
  ]);
  assert.deepEqual(calls[0].body.snapshot, snapshot);
});

test("frontend API client lists, freezes, and deletes experiment plans through project routes", async () => {
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
      if (request.path === "/projects/project-ui/experiment-plans/plan-ui/freeze" && request.method === "POST") {
        return { experiment_plan_id: "plan-ui", status: "frozen", plan_fingerprint: "sha256:plan" };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const plans = await client.listExperimentPlans("project-ui");
  const frozen = await client.freezeExperimentPlan("project-ui", "plan-ui");
  const deleted = await client.deleteExperimentPlan("project-ui", "plan-ui");

  assert.equal(plans.experiment_plans[0].experiment_plan_id, "plan-ui");
  assert.equal(frozen.status, "frozen");
  assert.deepEqual(deleted.soft_deleted_run_ids, ["run-ui"]);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /projects/project-ui/experiment-plans",
    "POST /projects/project-ui/experiment-plans/plan-ui/freeze",
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

test("frontend API client creates imported XLSX projects through the create-only route", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      return { project_id: request.body.project_json.project_id, status: "created" };
    }
  });
  const project = { project_id: "project-xlsx-create-only" };

  const created = await client.createImportedProject(project);

  assert.equal(created.status, "created");
  assert.deepEqual(calls, [{
    method: "POST",
    path: "/projects/import-xlsx/create",
    body: { project_json: project }
  }]);
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

test("buildBackendProjectJson saves composite task items as mission references", () => {
  const scenario = {
    scenarioId: "sync-basic-fields",
    basicMissions: [{
      id: "basic-alpha",
      name: "Basic Alpha",
      equipmentType: "J-35",
      taskDurationMinutes: 95,
      equipmentQuantity: 4,
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
          priority: 2,
          preparationMinutes: 5,
          groupName: "Editable group",
          firstWaveTime: "08:30"
        }]
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "sync" });
  const composite = projectJson.missionProfile.compositeTasks[0];
  const syncedItem = projectJson.missionProfile.compositeTasks[0].taskItems[0];

  assert.equal(syncedItem.basicMissionId, "basic-alpha");
  assert.equal(syncedItem.basicTaskName, "Basic Alpha");
  assert.equal(syncedItem.equipmentType, "J-35");
  assert.equal("taskDurationMinutes" in syncedItem, false);
  assert.equal("equipmentQuantity" in syncedItem, false);
  assert.equal("minRequiredSystems" in syncedItem, false);
  assert.equal("priority" in syncedItem, false);
  assert.equal(composite.priority, 2);
  assert.equal(projectJson.basicMissions[0].minRequiredSorties, 1);
  assert.equal("preparationMinutes" in syncedItem, false);
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
  assert.equal("taskDurationMinutes" in syncedItem, false);
  assert.equal("equipmentQuantity" in syncedItem, false);
  assert.equal("preparationMinutes" in syncedItem, false);
  assert.ok("basicMission" in scenario);
  assert.ok("basicMission" in scenario.missionProfile);
});

test("normalizeProjectJsonForClientDraft repairs duplicate basic mission identities", () => {
  const normalized = normalizeProjectJsonForClientDraft({
    basicMissions: [
      { id: "mission-j16", missionId: "shared-mission", name: "J16任务" },
      { id: "mission-j16d", missionId: "shared-mission", name: "J16D任务" }
    ],
    missionProfile: { compositeTasks: [] },
    supportActivities: []
  });

  assert.equal(normalized.basicMissions[0].missionId, "shared-mission");
  assert.equal(normalized.basicMissions[1].missionId, "mission-j16d");
});

test("buildBackendProjectJson migrates periodic aliases to durationDays and canonical weekday rows", () => {
  const scenario = {
    scenarioId: "periodic-canonical-save",
    basicMissions: [{
      id: "basic-alpha",
      name: "Basic Alpha",
      equipmentType: "J-35"
    }],
    missionProfile: {
      name: "周期任务",
      durationHours: 24,
      compositeTasks: [{
        id: "composite-alpha",
        taskItems: [{
          id: "task-item-alpha",
          basicMissionId: "basic-alpha",
          basicTaskName: "Basic Alpha",
          dailyRepeatCount: 2,
          equipmentQuantity: 2,
          equipmentType: "stale",
          firstWaveTime: "08:00",
          groupName: "A",
          intervalHours: 6,
          minRequiredSystems: 2,
          preparationMinutes: 30,
          priority: 1,
          recoveryTime: "11:00",
          taskDurationMinutes: 180
        }]
      }],
      periodicProfileLists: {
        week: [{ id: "periodic-alpha", name: "常规周" }],
        month: [{ id: "month-1", name: "常规月", weekProfileIds: Array(4).fill("periodic-alpha") }],
        year: [{ id: "year-1", name: "第1年", monthProfileIds: Array(12).fill("month-1") }]
      },
      periodicTasks: [{
        id: "periodic-alpha",
        dailyRepeatCount: 2,
        experimentName: "旧实验",
        mondayCompositeTaskId: "composite-alpha",
        name: "周期任务 A",
        parentTask: "旧总任务",
        parentTaskName: "旧总任务",
        periodDays: 7,
        periodicTaskName: "旧周期任务",
        repeatCount: 2,
        repeatCycleDays: 7,
        repeatCycleUnit: "day",
        repeatCycleValue: 7,
        repeatRounds: 2,
        taskCategory: "periodic",
        taskGroupName: "旧分组",
        taskName: "旧任务名",
        taskPeriodDays: 7,
        weekdayAssignments: {
          monday: "composite-alpha",
          tuesday: "composite-alpha"
        }
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "periodic-canonical-save" });
  const taskItem = projectJson.missionProfile.compositeTasks[0].taskItems[0];
  const periodicTask = projectJson.missionProfile.periodicTasks[0];

  assert.equal("durationHours" in projectJson.missionProfile, false);
  assert.equal(projectJson.missionProfile.durationDays, 14);
  assert.deepEqual(taskItem, {
    basicMissionId: "basic-alpha",
    basicTaskName: "Basic Alpha",
    groupName: "A",
    firstWaveTime: "08:00",
    dailyRepeatCount: 2,
    intervalHours: 6,
    equipmentType: "J-35"
  });
  assert.equal(periodicTask.id, "periodic-alpha");
  assert.deepEqual(projectJson.missionProfile.periodicProfileLists, scenario.missionProfile.periodicProfileLists);
  assert.equal(periodicTask.name, "周期任务 A");
  assert.deepEqual(periodicTask.compositeTaskIds, ["composite-alpha"]);
  assert.deepEqual(periodicTask.compositeTasks, [
    { compositeTaskId: "composite-alpha", weekday: "monday" },
    { compositeTaskId: "composite-alpha", weekday: "tuesday" }
  ]);
  for (const field of [
    "cycleDays",
    "dailyRepeatCount",
    "experimentName",
    "parentTask",
    "parentTaskName",
    "periodDays",
    "periodicTaskName",
    "repeatCount",
    "repeatCycleDays",
    "repeatCycleUnit",
    "repeatCycleValue",
    "repeatRounds",
    "repeatWeeks",
    "taskCategory",
    "taskGroupName",
    "taskName",
    "taskPeriodDays",
    "weekdayAssignments"
  ]) {
    assert.equal(field in periodicTask, false, `${field} should not be saved`);
  }
});

test("buildBackendProjectJson splits indexed legacy weeks without changing their calendar mapping", () => {
  const scenario = {
    scenarioId: "indexed-periodic-migration",
    basicMissions: [],
    missionProfile: {
      name: "indexed legacy profile",
      durationHours: 24,
      compositeTasks: [
        { id: "composite-day", name: "day", taskItems: [] },
        { id: "composite-night", name: "night", taskItems: [] }
      ],
      periodicTasks: [{
        id: "legacy-periodic",
        name: "legacy",
        repeatWeeks: 2,
        cycleDays: 7,
        compositeTasks: [
          { weekIndex: 1, weekday: "mondayCompositeTaskId", compositeTaskId: "composite-day" },
          { weekIndex: 2, weekday: "tuesdayCompositeTaskId", compositeTaskId: "composite-night" }
        ]
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: scenario.scenarioId });
  const profile = projectJson.missionProfile;

  assert.equal(profile.durationDays, 14);
  assert.deepEqual(profile.periodicTasks, [
    {
      id: "migrated-week-profile-1",
      name: "迁移周剖面 1",
      compositeTasks: [{ compositeTaskId: "composite-day", weekday: "monday" }],
      compositeTaskIds: ["composite-day"]
    },
    {
      id: "migrated-week-profile-2",
      name: "迁移周剖面 2",
      compositeTasks: [{ compositeTaskId: "composite-night", weekday: "tuesday" }],
      compositeTaskIds: ["composite-night"]
    }
  ]);
  assert.deepEqual(
    profile.periodicProfileLists.month[0].weekProfileIds,
    ["migrated-week-profile-1", "migrated-week-profile-2", "", "", ""]
  );
  assert.equal(profile.periodicProfileLists.year[0].monthProfileIds[0], "migrated-month-profile-1-1");
  assert.equal(profile.periodicProfileLists.year[0].monthProfileIds.length, 12);
});

test("buildBackendProjectJson gives explicit durationDays precedence over stale legacy repeats", () => {
  const scenario = {
    scenarioId: "canonical-duration-precedence",
    basicMissions: [],
    missionProfile: {
      name: "canonical duration",
      durationDays: 43,
      durationHours: 24,
      compositeTasks: [{ id: "composite-day", name: "day", taskItems: [] }],
      periodicTasks: [{
        id: "legacy-periodic",
        name: "legacy",
        repeatWeeks: 43,
        cycleDays: 3,
        weekdayAssignments: { monday: "composite-day" }
      }]
    }
  };

  const projectJson = buildBackendProjectJson(scenario, { id: scenario.scenarioId });

  assert.equal(projectJson.missionProfile.durationDays, 43);
  assert.equal("durationHours" in projectJson.missionProfile, false);
  assert.equal("repeatWeeks" in projectJson.missionProfile.periodicTasks[0], false);
});

test("normalizeProjectJsonForClientDraft fails closed for indexed legacy calendar conflicts", () => {
  const base = {
    scenarioId: "indexed-periodic-conflict",
    basicMissions: [],
    missionProfile: {
      name: "conflicting legacy profile",
      durationDays: 14,
      compositeTasks: [
        { id: "composite-a", name: "A", taskItems: [] },
        { id: "composite-b", name: "B", taskItems: [] }
      ],
      periodicTasks: [
        {
          id: "legacy-a",
          compositeTasks: [{ weekIndex: 1, weekday: "monday", compositeTaskId: "composite-a" }]
        },
        {
          id: "legacy-b",
          compositeTasks: [{ weekIndex: 1, weekday: "monday", compositeTaskId: "composite-b" }]
        }
      ]
    }
  };

  assert.throws(
    () => normalizeProjectJsonForClientDraft(base),
    /duplicate week 1 monday assignment/
  );
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      ...base,
      missionProfile: {
        ...base.missionProfile,
        periodicTasks: [
          {
            id: "legacy-a",
            compositeTasks: [{ weekIndex: 1, weekday: "monday", compositeTaskId: "composite-a" }]
          },
          {
            id: "legacy-b",
            compositeTasks: [{ weekIndex: 1, weekday: "monday", compositeTaskId: "composite-a" }]
          }
        ]
      }
    }),
    /duplicate week 1 monday assignment/
  );
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      ...base,
      missionProfile: {
        ...base.missionProfile,
        periodicProfileLists: {
          week: [{ id: "legacy-a", name: "legacy" }],
          month: [{ id: "month-a", name: "month", weekProfileIds: ["", "", "", "legacy-a"] }],
          year: []
        },
        periodicTasks: [{
          id: "legacy-a",
          compositeTasks: [{ weekIndex: 1, weekday: "monday", compositeTaskId: "composite-a" }]
        }]
      }
    }),
    /indexed legacy rows with configured month\/year references cannot be migrated safely/
  );
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      ...base,
      missionProfile: {
        ...base.missionProfile,
        periodicTasks: [{
          id: "legacy-outside-duration",
          compositeTasks: [{ weekIndex: 3, weekday: "monday", compositeTaskId: "composite-a" }]
        }]
      }
    }),
    /indexed task day 15 exceeds explicit durationDays 14/
  );
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      ...base,
      missionProfile: {
        ...base.missionProfile,
        periodicTasks: [{
          id: "legacy-invalid-weekday",
          compositeTasks: [{ weekIndex: 1, weekday: "funday", compositeTaskId: "composite-a" }]
        }]
      }
    }),
    /unsupported weekday funday/
  );
});

test("buildBackendProjectJson preserves legacy whole-week rows as seven weekday assignments", () => {
  const projectJson = buildBackendProjectJson({
    scenarioId: "whole-week-periodic-migration",
    basicMissions: [],
    missionProfile: {
      name: "whole week legacy profile",
      compositeTasks: [
        { id: "composite-day", name: "day", taskItems: [] },
        { id: "composite-night", name: "night", taskItems: [] }
      ],
      periodicTasks: [{
        id: "legacy-whole-weeks",
        repeatWeeks: 2,
        cycleDays: 7,
        compositeTasks: [
          { week: 1, compositeTaskId: "composite-day" },
          { week: 2, compositeTaskId: "composite-night" }
        ]
      }]
    }
  }, { id: "whole-week-periodic-migration" });

  assert.equal(projectJson.missionProfile.periodicTasks.length, 2);
  assert.deepEqual(
    projectJson.missionProfile.periodicTasks.map((task) => (
      task.compositeTasks.map((row) => row.weekday)
    )),
    [
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    ]
  );
  assert.deepEqual(
    projectJson.missionProfile.periodicTasks.map((task) => task.compositeTaskIds),
    [["composite-day"], ["composite-night"]]
  );
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
  const activity = projectJson.supportActivities[5];
  const jobs = projectJson.supportActivityJobs;

  assert.equal(jobs[1].activityCode, "BA-002");
  assert.equal("predecessors" in jobs[0], false);
  assert.deepEqual(activity.activityCodes, ["BA-001", "BA-002"]);
  assert.deepEqual(activity.predecessors, { "BA-001": ["BA-002"], "BA-002": [] });
  assert.equal("jobs" in activity, false);
  assert.deepEqual(scenario.supportActivities[5].jobs[0].predecessors, ["电源车准备"]);
  assert.equal("activityCode" in scenario.supportActivities[5].jobs[1], false);
});

test("buildBackendProjectJson preserves distinct legacy support jobs with duplicate codes", () => {
  const scenario = {
    scenarioId: "support-duplicate-code-canonical",
    supportActivities: [
      {
        id: "ops-activity",
        activityType: "使用保障",
        jobs: [{
          activityCode: "BA-001",
          workName: "使用保障准备",
          durationMinutes: 20,
          predecessors: []
        }]
      },
      {
        id: "preventive-activity",
        activityType: "预防性维修",
        jobs: [{
          activityCode: "BA-001",
          workName: "定检准备",
          durationMinutes: 45,
          predecessors: []
        }, {
          activityCode: "BA-003",
          workName: "定检执行",
          durationMinutes: 60,
          predecessors: ["BA-001"]
        }]
      }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-duplicate-code-canonical" });

  assert.deepEqual(projectJson.supportActivities[0].activityCodes, ["BA-001"]);
  assert.deepEqual(projectJson.supportActivities[1].activityCodes, ["BA-002", "BA-003"]);
  assert.deepEqual(projectJson.supportActivities[1].predecessors, { "BA-002": [], "BA-003": ["BA-002"] });
  assert.deepEqual(
    projectJson.supportActivityJobs.map((job) => [job.activityCode, job.workName, job.durationMinutes]),
    [
      ["BA-001", "使用保障准备", 20],
      ["BA-002", "定检准备", 45],
      ["BA-003", "定检执行", 60]
    ]
  );
});

test("buildBackendProjectJson materializes legacy support applicability on top-level jobs", () => {
  const scenario = {
    scenarioId: "support-job-applicability",
    components: [{ id: "component-a", aircraftModel: "J-15" }],
    supportActivities: [{
      id: "ops-activity",
      activityType: "使用保障",
      aircraftModel: "J-15",
      activityCodes: ["BA-001", "BA-002"],
      predecessors: { "BA-001": [], "BA-002": [] }
    }],
    supportActivityJobs: [
      { activityCode: "BA-001", workName: "检查", durationMinutes: 20 },
      { activityCode: "BA-002", workName: "挂载", durationMinutes: 30, applicableAircraft: "J-35" }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-job-applicability" });
  const jobsByCode = new Map(projectJson.supportActivityJobs.map((job) => [job.activityCode, job]));

  assert.equal(jobsByCode.get("BA-001").applicableAircraft, "J-15");
  assert.equal(jobsByCode.get("BA-002").applicableAircraft, "J-35");
  assert.equal(projectJson.supportActivities[0].aircraftModel, "J-15");
  assert.deepEqual(projectJson.supportActivities[0].activityCodes, ["BA-001", "BA-002"]);
});

test("mixed-type basic activity CSV results survive Project save and reload without silent code changes", () => {
  const scenario = {
    scenarioId: "basic-activity-csv-persistence",
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    supportActivityJobs: [
      {
        activityCode: "BA-002",
        workName: "通电检查",
        applicableAircraft: "J-15",
        durationProfile: { distributionType: "固定值", value: 15 },
        durationMinutes: 15
      },
      {
        activityCode: "PM-101",
        workName: "定检准备",
        applicableAircraft: "J-15",
        durationProfile: { distributionType: "正态分布", mean: 45, stdDev: 5 },
        durationMinutes: 45
      }
    ],
    supportActivities: [
      {
        id: "ops-import-host",
        activityType: "使用保障",
        planType: "直接准备方案",
        activityName: "J-15直接准备方案",
        aircraftModel: "J-15",
        activityCodes: ["BA-002"],
        predecessors: { "BA-002": [] }
      },
      {
        id: "preventive-import-host",
        activityType: "预防性维修",
        planType: "预防性维修方案",
        activityName: "J-15定检方案",
        aircraftModel: "J-15",
        activityCodes: ["PM-101"],
        predecessors: { "PM-101": [] }
      }
    ]
  };

  const saved = buildBackendProjectJson(scenario, { id: scenario.scenarioId });
  const reloaded = normalizeProjectJsonForClientDraft(saved);
  const savedAgain = buildBackendProjectJson(reloaded, { id: scenario.scenarioId });

  assert.deepEqual(savedAgain.supportActivityJobs.map((job) => job.activityCode), ["BA-002", "PM-101"]);
  assert.deepEqual(savedAgain.supportActivityJobs[1].durationProfile, {
    distributionType: "正态分布",
    mean: 45,
    stdDev: 5
  });
  const activitiesByPlanType = new Map(
    savedAgain.supportActivities.map((activity) => [activity.planType, activity])
  );
  assert.deepEqual(activitiesByPlanType.get("直接准备方案").activityCodes, ["BA-002"]);
  assert.deepEqual(activitiesByPlanType.get("再次出动准备方案").activityCodes, []);
  assert.deepEqual(activitiesByPlanType.get("飞行后检查方案").activityCodes, []);
  assert.deepEqual(activitiesByPlanType.get("预防性维修方案").activityCodes, ["PM-101"]);
});

test("buildBackendProjectJson strips corrective MTTR fields from support activity jobs", () => {
  const scenario = {
    scenarioId: "support-job-mttr-boundary",
    supportActivities: [{
      id: "corrective-activity",
      activityType: "修复性维修",
      equipmentId: "component-a",
      maxRepairTimeMinutes: 999,
      meanRepairTimeMinutes: 888,
      repairDistribution: { distributionType: "固定值", value: 999 },
      jobs: [{
        activityCode: "CM-001",
        workName: "修复工作",
        durationMinutes: 30,
        predecessors: [],
        maxRepairTimeMinutes: 999,
        meanRepairTimeMinutes: 888,
        mttrMinutes: 777,
        repairDistribution: { distributionType: "固定值", value: 999 }
      }]
    }]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-job-mttr-boundary" });

  assert.equal("maxRepairTimeMinutes" in projectJson.supportActivities[0], false);
  assert.equal("meanRepairTimeMinutes" in projectJson.supportActivities[0], false);
  assert.equal("repairDistribution" in projectJson.supportActivities[0], false);
  assert.equal("maxRepairTimeMinutes" in projectJson.supportActivityJobs[0], false);
  assert.equal("meanRepairTimeMinutes" in projectJson.supportActivityJobs[0], false);
  assert.equal("mttrMinutes" in projectJson.supportActivityJobs[0], false);
  assert.equal("repairDistribution" in projectJson.supportActivityJobs[0], false);
});

test("maintenance method fields default and round-trip only on corrective and preventive plans", () => {
  const scenario = {
    scenarioId: "maintenance-method-defaults",
    supportActivities: [
      { id: "ops", activityType: "使用保障", activityName: "使用保障" },
      { id: "corrective", activityType: "修复性维修", activityName: "修复" },
      { id: "preventive", activityType: "预防性维修", activityName: "预防" }
    ]
  };

  const saved = buildBackendProjectJson(scenario, { id: scenario.scenarioId });
  assert.equal(Object.hasOwn(saved.supportActivities[0], "maintenanceMethods"), false);
  assert.equal(Object.hasOwn(saved.supportActivities[0], "replacementRatio"), false);
  assert.deepEqual(saved.supportActivities[1].maintenanceMethods, ["non_replacement"]);
  assert.equal(saved.supportActivities[1].replacementRatio, 0);
  assert.deepEqual(saved.supportActivities[2].maintenanceMethods, ["non_replacement"]);
  assert.equal(saved.supportActivities[2].replacementRatio, 0);

  const savedAgain = buildBackendProjectJson(normalizeProjectJsonForClientDraft(saved), { id: scenario.scenarioId });
  assert.deepEqual(savedAgain.supportActivities, saved.supportActivities);
});

test("legacy scalar repairType migrates only on corrective maintenance and unknown values fail closed", () => {
  const migrated = normalizeProjectJsonForClientDraft({
    scenarioId: "legacy-maintenance-methods",
    supportActivities: [
      { id: "corrective", activityType: "修复性维修", repairType: "原位维修" }
    ]
  });

  assert.deepEqual(migrated.supportActivities[0].maintenanceMethods, ["non_replacement"]);
  assert.equal(migrated.supportActivities[0].replacementRatio, 0);
  assert.equal(Object.hasOwn(migrated.supportActivities[0], "repairType"), false);

  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      scenarioId: "preventive-legacy-maintenance-method",
      supportActivities: [{ id: "preventive", activityType: "预防性维修", repairType: "换件维修" }]
    }),
    /legacy migration is only supported for corrective maintenance/
  );

  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      scenarioId: "unknown-legacy-maintenance-method",
      supportActivities: [{ id: "corrective", activityType: "修复性维修", repairType: "返厂维修" }]
    }),
    /repairType: unsupported legacy value/
  );
});

test("maintenance method canonical fields reject partial, invalid, and inconsistent values", () => {
  const normalizeActivity = (activity) => normalizeProjectJsonForClientDraft({
    scenarioId: "invalid-maintenance-methods",
    supportActivities: [{ id: "corrective", activityType: "修复性维修", ...activity }]
  });

  assert.throws(() => normalizeActivity({ maintenanceMethods: ["replacement"] }), /must appear together/);
  assert.throws(() => normalizeActivity({ replacementRatio: 0.5 }), /must appear together/);
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["repair"], replacementRatio: 0.5 }),
    /canonical maintenance methods/
  );
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["replacement", "replacement"], replacementRatio: 1 }),
    /canonical maintenance methods/
  );
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["non_replacement"], replacementRatio: 0.5 }),
    /non_replacement-only plans require 0/
  );
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["replacement"], replacementRatio: 0 }),
    /replacement-only plans require 1/
  );
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["non_replacement", "replacement"], replacementRatio: 1.1 }),
    /finite number between 0 and 1/
  );
  assert.doesNotThrow(
    () => normalizeActivity({ maintenanceMethods: ["non_replacement", "replacement"], replacementRatio: 0.1234 })
  );
  assert.throws(
    () => normalizeActivity({ maintenanceMethods: ["non_replacement", "replacement"], replacementRatio: 0.12345 }),
    /at most four decimal places/
  );
});

test("buildBackendProjectJson persists shared reliability parameters on products and keeps component projections compatible", () => {
  const projectJson = buildBackendProjectJson({
    schema_version: "project-v0",
    scenarioId: "shared-product-parameters",
    products: [{
      id: "product-shared",
      name: "共享产品",
      mtbfHours: 1200,
      meanRepairTimeMinutes: 90,
      failureDistribution: { distributionType: "固定值" },
      repairDistribution: { distributionType: "固定值" }
    }],
    components: [
      { id: "component-a", name: "组件A", productId: "product-shared", quantity: 1 },
      { id: "component-b", name: "组件B", productId: "product-shared", quantity: 1 }
    ]
  });

  assert.equal(projectJson.products[0].mtbfHours, 1200);
  assert.equal(projectJson.products[0].meanRepairTimeMinutes, 90);
  assert.deepEqual(projectJson.products[0].failureDistribution, { distributionType: "固定值", value: 1200 });
  assert.equal(projectJson.components[0].mtbfHours, 1200);
  assert.equal(projectJson.components[0].meanRepairTimeMinutes, 90);
  assert.deepEqual(projectJson.components[0].failureDistribution, { distributionType: "固定值", value: 1200 });
  assert.deepEqual(projectJson.components[1].repairDistribution, { distributionType: "固定值" });
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
  assert.equal("requiredDevices" in projectJson.supportActivities[0], false);
  assert.ok("monteCarlo" in scenario);
  assert.ok("analysisRequests" in scenario);
  assert.ok("experiment" in scenario);
  assert.ok("monteCarlo" in scenario.missionProfile);
  assert.ok("requireDevices" in scenario.supportActivities[0]);
});

test("buildBackendProjectJson preserves support activity runtime resource references", () => {
  const scenario = {
    scenarioId: "support-activity-reference-boundary",
    supportActivities: [
      {
        id: "ops-plan",
        name: "Legacy display name",
        activityType: "飞行前保障",
        planType: "直接准备方案",
        planGroupId: "ops-plan-group",
        resourceId: "carrier-deck",
        requiredDevices: 2,
        requiredPersonnel: 3,
        maxWorkTimeRefMinutes: 30,
        jobs: [
          {
            activityCode: "OPS-001",
            workName: "飞前检查",
            durationMinutes: 20,
            predecessors: []
          }
        ]
      }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-activity-reference-boundary" });

  assert.equal(projectJson.supportActivities[0].activityName, "Legacy display name");
  assert.equal(projectJson.supportActivities[0].planType, "直接准备方案");
  assert.equal(projectJson.supportActivities[0].planGroupId, "ops-plan-group");
  assert.equal(projectJson.supportActivities[0].maxWorkTimeRefMinutes, 30);
  assert.equal("name" in projectJson.supportActivities[0], false);
  assert.equal(projectJson.supportActivities[0].resourceId, "carrier-deck");
  assert.equal("requiredDevices" in projectJson.supportActivities[0], false);
  assert.equal("requiredPersonnel" in projectJson.supportActivities[0], false);
  assert.equal("jobs" in projectJson.supportActivities[0], false);
  assert.deepEqual(projectJson.supportActivities[0].activityCodes, ["OPS-001"]);
  assert.deepEqual(projectJson.supportActivities[0].predecessors, { "OPS-001": [] });
  assert.equal(projectJson.supportActivityJobs[0].activityCode, "OPS-001");
  assert.deepEqual(
    projectJson.supportActivities.map((activity) => activity.planType),
    ["直接准备方案", "再次出动准备方案", "飞行后检查方案"]
  );
  assert.equal(new Set(projectJson.supportActivities.map((activity) => activity.planGroupId)).size, 1);
  assert.deepEqual(projectJson.supportActivities[1].activityCodes, []);
  assert.deepEqual(projectJson.supportActivities[2].activityCodes, []);
});

test("legacy single-row operations support materializes three phase-local reference containers", () => {
  const legacy = {
    scenarioId: "legacy-operations-phases",
    supportActivityJobs: [
      { activityCode: "OPS-001", workName: "机务检查", durationMinutes: 5 },
      { activityCode: "OPS-002", workName: "燃油加注", durationMinutes: 6 }
    ],
    supportActivities: [
      {
        id: "preflight",
        activityName: "典型保障方案",
        activityType: "飞行前保障",
        planType: "使用保障方案",
        aircraftModel: "J-15",
        activityCodes: ["OPS-001", "OPS-002"],
        predecessors: { "OPS-001": [], "OPS-002": ["OPS-001"] }
      }
    ]
  };

  const normalized = normalizeProjectJsonForClientDraft(legacy);
  const normalizedAgain = normalizeProjectJsonForClientDraft(normalized);
  const phases = normalized.supportActivities;

  assert.equal(phases.length, 3);
  assert.deepEqual(
    phases.map((activity) => activity.planType),
    ["直接准备方案", "再次出动准备方案", "飞行后检查方案"]
  );
  assert.equal(new Set(phases.map((activity) => activity.planGroupId)).size, 1);
  assert.deepEqual(phases[0].activityCodes, ["OPS-001", "OPS-002"]);
  assert.deepEqual(phases[0].predecessors, { "OPS-001": [], "OPS-002": ["OPS-001"] });
  assert.deepEqual(phases[1].activityCodes, []);
  assert.deepEqual(phases[1].predecessors, {});
  assert.deepEqual(phases[2].activityCodes, []);
  assert.deepEqual(phases[2].predecessors, {});
  assert.deepEqual(normalizedAgain.supportActivities, phases);
  assert.equal(legacy.supportActivities.length, 1);
});

test("regressed three-row operations data restores one phase group without expanding to nine rows", () => {
  const regressed = {
    scenarioId: "regressed-operations-phases",
    supportActivities: [
      {
        id: "preflight",
        activityName: "典型保障方案",
        activityType: "飞行前保障",
        planType: "使用保障方案",
        aircraftModel: "J-15",
        activityCodes: ["OPS-001", "OPS-002"],
        predecessors: { "OPS-001": [], "OPS-002": ["OPS-001"] }
      },
      {
        id: "preflight-relaunch",
        activityName: "典型保障方案（再次出动准备）",
        activityType: "使用保障",
        planType: "使用保障方案",
        aircraftModel: "J-15",
        activityCodes: [],
        predecessors: {}
      },
      {
        id: "preflight-postflight",
        activityName: "典型保障方案（飞行后检查）",
        activityType: "使用保障",
        planType: "使用保障方案",
        aircraftModel: "J-15",
        activityCodes: [],
        predecessors: {}
      }
    ]
  };

  const normalized = normalizeProjectJsonForClientDraft(regressed);

  assert.equal(normalized.supportActivities.length, 3);
  assert.deepEqual(
    normalized.supportActivities.map((activity) => activity.planType),
    ["直接准备方案", "再次出动准备方案", "飞行后检查方案"]
  );
  assert.deepEqual(
    normalized.supportActivities.map((activity) => activity.planGroupId),
    ["preflight", "preflight", "preflight"]
  );
});

test("real legacy operations phase names recover one group independent of input order", () => {
  const rows = [
    {
      id: "ops-support-j-15---4",
      activityName: "J-15飞行前准备活动",
      activityType: "使用保障",
      planType: "使用保障方案",
      aircraftModel: "J-15",
      activityCodes: ["BA-001"],
      predecessors: { "BA-001": [] }
    },
    {
      id: "ops-support-j-15---5",
      activityName: "J-15再次出动准备活动",
      activityType: "使用保障",
      planType: "使用保障方案",
      aircraftModel: "J-15",
      activityCodes: ["BA-002"],
      predecessors: { "BA-002": [] }
    },
    {
      id: "ops-support-j-15---6",
      activityName: "J-15飞行后检查活动",
      activityType: "使用保障",
      planType: "使用保障方案",
      aircraftModel: "J-15",
      activityCodes: ["BA-003"],
      predecessors: { "BA-003": [] }
    }
  ];
  const normalizeRows = (supportActivities) => normalizeProjectJsonForClientDraft({
    scenarioId: "real-legacy-operations-phase-names",
    supportActivityJobs: ["BA-001", "BA-002", "BA-003"].map((activityCode) => ({
      activityCode,
      workName: activityCode,
      durationMinutes: 5
    })),
    supportActivities
  }).supportActivities;

  const forward = normalizeRows(rows);
  const shuffled = normalizeRows([rows[2], rows[0], rows[1]]);
  const semanticRows = (activities) => activities
    .map((activity) => ({
      activityName: activity.activityName,
      planType: activity.planType,
      planGroupId: activity.planGroupId,
      activityCodes: activity.activityCodes,
      predecessors: activity.predecessors
    }))
    .sort((left, right) => left.planType.localeCompare(right.planType, "zh-CN"));

  assert.equal(forward.length, 3);
  assert.equal(new Set(forward.map((activity) => activity.planGroupId)).size, 1);
  assert.deepEqual(semanticRows(shuffled), semanticRows(forward));
  assert.deepEqual(
    new Map(forward.map((activity) => [activity.planType, activity.activityCodes])),
    new Map([
      ["直接准备方案", ["BA-001"]],
      ["再次出动准备方案", ["BA-002"]],
      ["飞行后检查方案", ["BA-003"]]
    ])
  );
});

test("explicit non-operations plan type wins over misleading activity type text", () => {
  const normalized = normalizeProjectJsonForClientDraft({
    scenarioId: "explicit-non-operations-plan-type",
    supportActivities: [{
      id: "corrective-plan",
      activityName: "修复方案",
      activityType: "使用保障",
      planType: "修复性维修方案"
    }]
  });

  assert.equal(normalized.supportActivities.length, 1);
  assert.equal(normalized.supportActivities[0].planType, "修复性维修方案");
  assert.equal("planGroupId" in normalized.supportActivities[0], false);
});

test("legacy operations grouping fails closed on ambiguous or duplicate phases", () => {
  const direct = {
    activityType: "使用保障",
    planType: "使用保障方案",
    aircraftModel: "J-15"
  };
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      scenarioId: "ambiguous-legacy-operations-group",
      supportActivities: [
        { ...direct, id: "direct-a", activityName: "J-15飞行前准备活动" },
        { ...direct, id: "direct-b", activityName: "J-15飞行前准备活动" },
        { ...direct, id: "relaunch", activityName: "J-15再次出动准备活动" }
      ]
    }),
    /duplicate 直接准备方案/
  );
  assert.throws(
    () => normalizeProjectJsonForClientDraft({
      scenarioId: "duplicate-explicit-operations-phase",
      supportActivities: [
        {
          id: "direct-a",
          activityType: "使用保障",
          planType: "直接准备方案",
          planGroupId: "ops-group"
        },
        {
          id: "direct-b",
          activityType: "使用保障",
          planType: "直接准备方案",
          planGroupId: "ops-group"
        }
      ]
    }),
    /duplicate 直接准备方案/
  );
});

test("operations phase references reject malformed duplicate unknown and cross-phase values", () => {
  const normalizeReferences = (overrides) => normalizeProjectJsonForClientDraft({
    scenarioId: "invalid-operations-phase-references",
    supportActivityJobs: [
      { activityCode: "BA-001", workName: "检查", durationMinutes: 5 },
      { activityCode: "BA-002", workName: "加油", durationMinutes: 5 },
      { activityCode: "BA-999", workName: "其他阶段", durationMinutes: 5 }
    ],
    supportActivities: [{
      id: "direct",
      activityType: "使用保障",
      planType: "直接准备方案",
      planGroupId: "ops-group",
      activityCodes: ["BA-001", "BA-002"],
      predecessors: { "BA-001": [], "BA-002": ["BA-001"] },
      ...overrides
    }]
  });

  for (const [overrides, pattern] of [
    [{ activityCodes: "BA-001" }, /activityCodes: expected an array/],
    [{ activityCodes: ["BA-001", "BA-001"] }, /duplicate activity code BA-001/],
    [{ activityCodes: ["BA-404"] }, /unknown support activity job code BA-404/],
    [{ predecessors: [] }, /predecessors: expected an object/],
    [{ predecessors: { "BA-404": [] } }, /unknown activity code BA-404/],
    [{ predecessors: { "BA-001": ["BA-999"], "BA-002": [] } }, /unknown activity code BA-999/],
    [{ predecessors: { "BA-001": ["BA-002", "BA-002"], "BA-002": [] } }, /duplicate predecessor BA-002/]
  ]) {
    assert.throws(() => normalizeReferences(overrides), pattern);
  }

  const missingFields = normalizeReferences({
    activityCodes: undefined,
    predecessors: undefined
  }).supportActivities[0];
  assert.deepEqual(missingFields.activityCodes, []);
  assert.deepEqual(missingFields.predecessors, {});
});

test("legacy support activity display-name references are canonicalized when loaded and saved", () => {
  const persistedProject = {
    scenarioId: "legacy-support-activity-reference",
    basicMissions: [
      {
        id: "mission-legacy-support",
        name: "飞行训练",
        equipmentType: "J16",
        supportActivityName: "飞行前保障"
      }
    ],
    supportActivities: [
      {
        id: "support-preflight",
        name: "飞行前保障",
        activityName: "J16直接准备方案",
        activityType: "使用保障",
        planType: "使用保障方案",
        aircraftModel: "J16"
      }
    ]
  };

  const loadedDraft = normalizeProjectJsonForClientDraft(persistedProject);
  const savedProject = buildBackendProjectJson(loadedDraft, { id: "legacy-support-activity-reference" });

  assert.equal(loadedDraft.basicMissions[0].supportActivityName, "J16直接准备方案");
  assert.equal(savedProject.basicMissions[0].supportActivityName, "J16直接准备方案");
  assert.equal(savedProject.supportActivities[0].activityName, "J16直接准备方案");
  assert.equal("name" in savedProject.supportActivities[0], false);
  assert.equal(persistedProject.basicMissions[0].supportActivityName, "飞行前保障");
});

test("ambiguous legacy support activity display-name references are not silently reassigned", () => {
  const persistedProject = {
    scenarioId: "ambiguous-legacy-support-activity-reference",
    basicMissions: [
      { id: "mission-ambiguous-support", supportActivityName: "飞行前保障" }
    ],
    supportActivities: [
      { id: "support-a", name: "飞行前保障", activityName: "J16直接准备方案" },
      { id: "support-b", name: "飞行前保障", activityName: "J16再次出动准备方案" }
    ]
  };

  const loadedDraft = normalizeProjectJsonForClientDraft(persistedProject);

  assert.equal(loadedDraft.basicMissions[0].supportActivityName, "飞行前保障");
});

test("legacy support activity references stay unresolved across load and save when the canonical target was duplicated", () => {
  const persistedProject = {
    scenarioId: "duplicate-canonical-support-activity-reference",
    basicMissions: [
      { id: "mission-duplicate-canonical-support", supportActivityName: "旧飞行前保障" }
    ],
    supportActivities: [
      { id: "support-a", name: "旧飞行前保障", activityName: "J16直接准备方案" },
      { id: "support-b", name: "另一保障显示名", activityName: "J16直接准备方案" }
    ]
  };

  const loadedDraft = normalizeProjectJsonForClientDraft(persistedProject);
  const reloadedDraft = normalizeProjectJsonForClientDraft(loadedDraft);
  const savedProject = buildBackendProjectJson(loadedDraft, { id: "duplicate-canonical-support-activity-reference" });

  assert.equal(loadedDraft.basicMissions[0].supportActivityName, "旧飞行前保障");
  assert.equal(reloadedDraft.basicMissions[0].supportActivityName, "旧飞行前保障");
  assert.equal(savedProject.basicMissions[0].supportActivityName, "旧飞行前保障");
});

test("canonical support activity references are rewritten to the normalized canonical value", () => {
  const loadedDraft = normalizeProjectJsonForClientDraft({
    scenarioId: "trimmed-canonical-support-activity-reference",
    basicMissions: [
      { id: "mission-trimmed-canonical-support", supportActivityName: "  J16直接准备方案  " }
    ],
    supportActivities: [
      { id: "support-canonical", activityName: "J16直接准备方案" }
    ]
  });

  assert.equal(loadedDraft.basicMissions[0].supportActivityName, "J16直接准备方案");
});

test("buildBackendProjectJson migrates duplicate operations activity names into stable mission references", () => {
  const scenario = {
    scenarioId: "case-large-support-activity-persistence",
    basicMissions: Array.from({ length: 4 }, (_, index) => ({
      id: `j16-basic-${index + 1}`,
      name: `J16基本任务${index + 1}`,
      equipmentType: "J16",
      supportActivityName: "J16基本方案"
    })),
    supportActivities: [
      { id: "j16-primary", activityType: "使用保障", planType: "使用保障方案", aircraftModel: "J16", activityName: "J16基本方案" },
      { id: "j16-copy", activityType: "使用保障", planType: "使用保障方案", aircraftModel: "J16", activityName: "J16基本方案" },
      { id: "j16d-copy", activityType: "使用保障", planType: "使用保障方案", aircraftModel: "J16D", activityName: "J16基本方案" }
    ]
  };

  const firstSave = buildBackendProjectJson(scenario, { id: "case-large" });
  const reloadedSave = buildBackendProjectJson(firstSave, { id: "case-large" });

  assert.equal(firstSave.supportActivities.length, 9);
  assert.equal(new Set(firstSave.supportActivities.map((activity) => activity.activityName)).size, 9);
  assert.equal(new Set(firstSave.supportActivities.map((activity) => activity.planGroupId)).size, 3);
  for (const planGroupId of new Set(firstSave.supportActivities.map((activity) => activity.planGroupId))) {
    assert.deepEqual(
      new Set(
        firstSave.supportActivities
          .filter((activity) => activity.planGroupId === planGroupId)
          .map((activity) => activity.planType)
      ),
      new Set(["直接准备方案", "再次出动准备方案", "飞行后检查方案"])
    );
  }
  assert.deepEqual(firstSave.basicMissions.map((mission) => mission.supportActivityName), Array(4).fill("J16基本方案"));
  assert.deepEqual(reloadedSave.supportActivities.map((activity) => activity.activityName), firstSave.supportActivities.map((activity) => activity.activityName));
  assert.equal(
    firstSave.supportActivities.filter((activity) => activity.activityName === firstSave.basicMissions[0].supportActivityName).length,
    1
  );
});

test("buildBackendProjectJson strips legacy support node resource fields and draft overrides", () => {
  const scenario = {
    scenarioId: "support-resource-boundary",
    supportOrganization: {
      tree: {
        id: "support-org-root",
        name: "舰载保障组织",
        children: [
          { id: "carrier-deck", name: "基地" },
          { id: "forward-sea-base", name: "中继" },
          { id: "line-team", name: "基层" }
        ]
      }
    },
    supportResourceOverrides: {
      "root:legacy-node:equipment": { quantity: 3 }
    },
    deletedSupportResourceKeys: ["root:legacy-node:equipment"],
    supportNodes: [
      {
        id: "carrier-deck",
        name: "基地",
        capacity: 4,
        equipmentCapacity: 3,
        inventory: { "航电模块": 6 },
        lateralSupportNodes: ["基层"],
        nodeType: "甲板保障点",
        organizationStrategy: "任务优先",
        personnelCapacity: 5,
        policy: "高优先级",
        supportLevel: "一线保障",
        transportPolicies: [{ from: "line-team", to: "carrier-deck" }]
      },
      { id: "forward-sea-base", name: "中继", personnelCapacity: 2, equipmentCapacity: 2 },
      { id: "line-team", name: "基层", personnelCapacity: 3, equipmentCapacity: 3 },
      {
        id: "carrier-stock-personnel-mech",
        name: "机械保障人员",
        organizationNodeId: "line-team",
        importedResourceType: "personnel",
        personnelModel: "机械",
        personnelCapacity: 3
      }
    ],
    supportResources: [
      { id: "personnel-1", supportNodeName: "基层", type: "personnel", name: "机械保障人员", model: "机械", quantity: 3 }
    ],
    supportActivities: [
      { id: "activity-1", activityName: "基层保障", resourceId: "基层" }
    ],
    transportPolicies: [
      { id: "transport-1", from: "line-team", to: "carrier-deck", fromSupportNodeName: "基层", toSupportNodeName: "基地", spareName: "航电模块", capacity: 2 }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-resource-boundary" });

  assert.equal("supportResourceOverrides" in projectJson, false);
  assert.equal("deletedSupportResourceKeys" in projectJson, false);
  assert.deepEqual(projectJson.supportNodes.map((node) => node.name), ["基地", "中继", "基层"]);
  assert.deepEqual(projectJson.supportNodes.map((node) => node.id), ["carrier-deck", "forward-sea-base", "line-team"]);
  assert.ok(projectJson.supportNodes.every((node) => !("organizationNodeId" in node)));
  assert.equal(projectJson.supportNodes.some((node) => node.id === "carrier-stock-personnel-mech" || node.name === "机械保障人员"), false);
  assert.deepEqual(projectJson.supportResources, [
    { ...scenario.supportResources[0], organizationNodeId: "line-team" }
  ]);
  assert.deepEqual(projectJson.transportPolicies, [
    { id: "transport-1", fromOrganizationNodeId: "line-team", toOrganizationNodeId: "carrier-deck", capacity: 2 }
  ]);
  assert.equal(projectJson.supportActivities[0].resourceId, "line-team");
  assert.ok(projectJson.transportPolicies.every((policy) => (
    projectJson.supportNodes.some((node) => node.id === policy.fromOrganizationNodeId)
    && projectJson.supportNodes.some((node) => node.id === policy.toOrganizationNodeId)
  )));
});

test("buildBackendProjectJson retains organization-managed airport associations", () => {
  const projectJson = buildBackendProjectJson({
    scenarioId: "support-node-airport-association",
    supportOrganization: {
      tree: {
        id: "support-org-root",
        name: "保障组织",
        children: [
          { id: "org-relay", name: "中继", supportNodeId: "relay" },
          { id: "org-line", name: "基层", supportNodeId: "line" }
        ]
      }
    },
    supportNodes: [
      { id: "relay", name: "历史中继", airport: "前出基地" },
      { id: "line", name: "历史基层", airport: "大队" }
    ]
  }, { id: "support-node-airport-association" });

  assert.deepEqual(projectJson.supportNodes, [
    { id: "org-relay", name: "中继", airport: "前出基地" },
    { id: "org-line", name: "基层", airport: "大队" }
  ]);
});

test("buildBackendProjectJson does not invent a missing runtime node from organization order", () => {
  const projectJson = buildBackendProjectJson({
    scenarioId: "missing-runtime-support-node",
    supportOrganization: {
      tree: {
        id: "org-root",
        name: "保障组织",
        children: [{ id: "org-line", name: "基层", children: [] }]
      }
    },
    supportNodes: [],
    supportResources: [
      {
        id: "personnel-line",
        organizationNodeId: "org-line",
        supportNodeName: "基层",
        type: "personnel",
        name: "基层人员",
        quantity: 1
      }
    ]
  }, { id: "missing-runtime-support-node" });

  assert.deepEqual(projectJson.supportNodes, []);
  assert.equal(projectJson.supportResources[0].organizationNodeId, "org-line");
});

test("buildBackendProjectJson rejects two runtime rows mapped to one organization", () => {
  assert.throws(
    () => buildBackendProjectJson({
      scenarioId: "duplicate-runtime-support-node",
      supportOrganization: {
        tree: {
          id: "org-root",
          name: "保障组织",
          children: [{ id: "org-line", name: "基层", children: [] }]
        }
      },
      supportNodes: [
        { id: "legacy-line-a", name: "基层 A", organizationNodeId: "org-line" },
        { id: "legacy-line-b", name: "基层 B", organizationNodeId: "org-line" }
      ]
    }, { id: "duplicate-runtime-support-node" }),
    /重复映射保障组织 org-line/
  );
});

test("buildBackendProjectJson migrates legacy activity transport strategies to top-level policies", () => {
  const scenario = {
    scenarioId: "legacy-logistics-strategy",
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    missionProfile: { name: "任务", durationHours: 4, compositeTasks: [], periodicTasks: [] },
    basicMissions: [{ id: "mission-1", name: "任务", taskDurationMinutes: 60 }],
    components: [{ id: "aircraft", name: "J-15", quantity: 1, failureRate: 0.01 }],
    supportNodes: [
      { id: "base", name: "基地" },
      { id: "deck", name: "甲板" }
    ],
    supportResources: [
      { id: "personnel-deck", supportNodeName: "甲板", type: "personnel", name: "甲板人员", quantity: 2 }
    ],
    supportActivities: [{
      id: "logistics-plan",
      activityType: "后勤保障",
      activityName: "后勤保障活动方案",
      durationHours: 1,
      transportStrategies: [{
        name: "旧调运策略",
        direction: "横向运输",
        spareType: "航电模块",
        triggerMode: "临界库存",
        criticalInventory: 2,
        from: "base",
        to: "deck",
        transportTimeHours: 1.5
      }],
      organizationStrategies: [{ supportLevel: "base" }]
    }]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "legacy-logistics-strategy" });

  assert.deepEqual(projectJson.transportPolicies, [{
    id: "logistics-plan-transport-0",
    fromSupportNodeName: "基地",
    toSupportNodeName: "甲板",
    name: "旧调运策略",
    direction: "横向运输",
    triggerMode: "临界库存",
    criticalInventory: 2,
    transportMode: "横向运输",
    transportTimeHours: 1.5
  }]);
  assert.equal("transportStrategies" in projectJson.supportActivities[0], false);
  assert.equal("organizationStrategies" in projectJson.supportActivities[0], false);
});

test("buildBackendProjectJson persists visible personnel specialties for legacy blank resource rows", () => {
  const scenario = {
    scenarioId: "support-personnel-specialty-default",
    modelingDictionaries: {
      personnelSpecialties: ["航电", "军械", "机械", "特设"]
    },
    supportOrganization: {
      tree: {
        id: "support-org-root",
        name: "保障组织",
        children: [
          { id: "line-team", name: "基层", children: [] }
        ]
      }
    },
    supportNodes: [
      { id: "line-team", name: "基层" }
    ],
    supportResources: [
      { id: "line-personnel-mech", supportNodeName: "基层", type: "personnel", name: "基层人员", model: "机械", quantity: 3 },
      { id: "line-personnel-blank", supportNodeName: "基层", type: "personnel", name: "基层人员", model: "", quantity: 3 },
      { id: "line-personnel-ordnance", supportNodeName: "基层", type: "personnel", name: "基层人员", model: "军械", quantity: 3 },
      { id: "line-personnel-special", supportNodeName: "基层", type: "personnel", name: "基层人员", model: "特设", quantity: 3 }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-personnel-specialty-default" });

  const personnelModels = projectJson.supportResources
    .filter((resource) => resource.type === "personnel" && resource.supportNodeName === "基层")
    .map((resource) => resource.model);
  assert.deepEqual(personnelModels.sort(), ["军械", "机械", "特设", "航电"].sort());
  assert.ok(projectJson.supportResources.every((resource) => resource.type !== "personnel" || resource.model));
  assert.equal("modelingDictionaries" in projectJson, false);
});

test("buildBackendProjectJson strips clean Project non-model helper fields", () => {
  const scenario = {
    scenarioId: "strip-clean-project-non-model-helper-fields",
    modelingDictionaries: {
      personnelSpecialties: ["航电"]
    },
    modelingImportValidation: {
      importId: "import-strip",
      usedTables: { supportResources: true },
      validationLevel: "level1"
    },
    reliabilityBlockDiagram: {
      selectedNodeId: "whole-aircraft",
      nodes: [{
        id: "whole-aircraft",
        name: "整机",
        connectionType: "串联",
        treeLayout: { x: 20, y: 30 }
      }],
      edges: [{
        from: "whole-aircraft",
        to: "engine",
        relation: "串联",
        selected: true
      }]
    },
    supportResources: [
      { id: "spare-1", supportNodeName: "基层", type: "spare", name: "雷达 LRU", model: "RAD-1", equipment: "J-15", equipmentId: "aircraft-type-j15", quantity: 2 }
    ],
    supportActivities: [{
      id: "preventive-plan",
      activityName: "定检方案",
      activityType: "预防性维修",
      useCalendarRule: true,
      useFlightHourRule: true,
      useTakeoffLandingRule: false,
      calendarDayFloatRatio: 0.2,
      runHourFloatRatio: 0.3,
      takeoffLandingFloatRatio: 0.4
    }]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "strip-clean-project-non-model-helper-fields" });

  assert.equal("modelingDictionaries" in projectJson, false);
  assert.deepEqual(projectJson.modelingImportValidation, {
    importId: "import-strip",
    usedTables: { supportResources: true }
  });
  assert.equal("equipment" in projectJson.supportResources[0], false);
  assert.equal("equipmentId" in projectJson.supportResources[0], false);
  assert.deepEqual(projectJson.reliabilityBlockDiagram, {
    nodes: [{ id: "whole-aircraft", name: "整机", connectionType: "串联" }],
    edges: [{ from: "whole-aircraft", to: "engine", relation: "串联" }]
  });
  for (const field of [
    "calendarDayFloatRatio",
    "runHourFloatRatio",
    "takeoffLandingFloatRatio",
    "useCalendarRule",
    "useFlightHourRule",
    "useTakeoffLandingRule"
  ]) {
    assert.equal(field in projectJson.supportActivities[0], false);
  }
});

test("buildBackendProjectJson derives spare resources from equipment hardware tree", () => {
  const scenario = {
    scenarioId: "support-spares-from-hardware-tree",
    supportOrganization: {
      tree: {
        id: "support-org-root",
        name: "保障组织",
        children: [
          { id: "line-team", name: "基层", children: [] }
        ]
      }
    },
    supportNodes: [
      { id: "line-team", name: "基层" }
    ],
    components: [
      { id: "engine-control", name: "发动机控制模块", model: "ECU-1", aircraftModel: "J-15", parentId: "engine", productType: "LRU", spareType: "发动机备件" },
      { id: "radar-lru", name: "雷达 LRU", model: "RAD-1", aircraftModel: "J-15", parentId: "avionics", productType: "LRU", spareType: "航电模块" },
      { id: "hydraulic-sru", name: "液压执行器", model: "HYD-SRU", aircraftModel: "J-15", parentId: "hydraulic", productType: "SRU" }
    ],
    supportResources: [
      { id: "personnel-1", supportNodeName: "基层", type: "personnel", name: "基层人员", model: "机械", quantity: 3 },
      { id: "old-engine-spare", supportNodeName: "基层", type: "spare", name: "发动机备件", model: "发动机备件", quantity: 4 },
      { id: "old-hydraulic-spare", supportNodeName: "基层", type: "spare", name: "液压备件", model: "液压备件", quantity: 6 },
      { id: "radar-stock", supportNodeName: "基层", type: "spare", name: "雷达 LRU", model: "RAD-1", equipment: "J-15", quantity: 5 }
    ]
  };

  const projectJson = buildBackendProjectJson(scenario, { id: "support-spares-from-hardware-tree" });

  const spares = projectJson.supportResources
    .filter((resource) => resource.type === "spare")
    .map((resource) => ({
      name: resource.name,
      model: resource.model,
      quantity: resource.quantity
    }));
  assert.deepEqual(spares, [
    { name: "发动机控制模块", model: "ECU-1", quantity: 0 },
    { name: "雷达 LRU", model: "RAD-1", quantity: 5 }
  ]);
  assert.ok(projectJson.supportResources.every((resource) => !("equipment" in resource) && !("equipmentId" in resource)));
  assert.equal(projectJson.supportResources.some((resource) => ["发动机备件", "液压备件", "航电模块"].includes(resource.name)), false);
});

test("support spare normalization preserves relay stock and rewrites job references to its stable identity", () => {
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [{
          id: "relay",
          name: "中继",
          children: [{ id: "leaf", name: "基层", children: [] }]
        }]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [{
      id: "support-resource-1-spare-1",
      organizationNodeId: "relay",
      supportNodeName: "中继",
      type: "spare",
      productId: "product-pump",
      name: "液压泵",
      model: "PUMP-1",
      quantity: 9
    }],
    supportActivityJobs: [{
      activityCode: "USE-001",
      spare: [{ key: "support-resource-1-spare-1", productId: "product-pump", quantity: 1 }]
    }]
  });

  assert.deepEqual(loaded.supportResources.map((resource) => ({
    id: resource.id,
    organization: resource.organizationNodeName,
    quantity: resource.quantity
  })), [
    { id: "support-spare:leaf:product-pump", organization: "leaf", quantity: 0 },
    { id: "support-spare:relay:product-pump", organization: "relay", quantity: 9 }
  ]);
  assert.equal(loaded.supportActivityJobs[0].spare[0].key, "support-spare:relay:product-pump");
});

test("support spare normalization keeps relay quantity separate from descendant leaves", () => {
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [{
          id: "relay",
          name: "中继",
          children: [
            { id: "leaf-a", name: "基层A", children: [] },
            { id: "leaf-b", name: "基层B", children: [] }
          ]
        }]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [{
      id: "legacy-relay-stock",
      organizationNodeId: "relay",
      supportNodeName: "中继",
      type: "spare",
      productId: "product-pump",
      name: "液压泵",
      model: "PUMP-1",
      quantity: 12
    }]
  });

  const quantities = new Map(loaded.supportResources.map((resource) => [resource.organizationNodeName, resource.quantity]));
  assert.equal(loaded.supportResources.find((resource) => resource.id === "support-spare:relay:product-pump").quantity, 12);
  assert.equal(quantities.get("leaf-a"), 0);
  assert.equal(quantities.get("leaf-b"), 0);
});

test("support spare normalization preserves independent relay and leaf stock", () => {
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [{ id: "relay", name: "中继", children: [{ id: "leaf", name: "基层", children: [] }] }]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [
      { id: "ancestor-stock", organizationNodeId: "relay", supportNodeName: "中继", type: "spare", productId: "product-pump", quantity: 4 },
      { id: "leaf-stock", organizationNodeId: "leaf", supportNodeName: "基层", type: "spare", productId: "product-pump", quantity: 5 }
    ],
    supportActivityJobs: [{
      activityCode: "USE-001",
      spare: [{ key: "ancestor-stock", productId: "product-pump", quantity: 1 }]
    }]
  });

  const live = loaded.supportResources.filter((resource) => resource.type === "spare");
  assert.equal(live.length, 2);
  assert.deepEqual(live.map((resource) => resource.quantity).sort((a, b) => a - b), [4, 5]);
  assert.equal(loaded.supportActivityJobs[0].spare[0].key, "support-spare:relay:product-pump");
});

test("same-name leaf tombstone suppresses only its stable organization and product identity", () => {
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [
          { id: "leaf-a", name: "同名基层", children: [] },
          { id: "leaf-b", name: "同名基层", children: [] }
        ]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [{
      id: "support-spare-tombstone:leaf-a:product-pump",
      organizationNodeId: "leaf-a",
      supportNodeName: "同名基层",
      type: "spare",
      productId: "product-pump",
      quantity: 0
    }]
  });

  assert.deepEqual(loaded.supportResources.map((resource) => resource.id).sort(), [
    "support-spare-tombstone:leaf-a:product-pump",
    "support-spare:leaf-b:product-pump"
  ]);
});

test("deleted stable spare key never crosses organizations through product fallback", () => {
  const deletedKey = "support-spare:leaf-a:product-pump";
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [
          { id: "leaf-a", name: "基层A", children: [] },
          { id: "leaf-b", name: "基层B", children: [] }
        ]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [
      {
        id: "support-spare-tombstone:leaf-a:product-pump",
        organizationNodeId: "leaf-a",
        supportNodeName: "基层A",
        type: "spare",
        productId: "product-pump",
        quantity: 0
      },
      {
        id: "legacy-leaf-b-stock",
        organizationNodeId: "leaf-b",
        supportNodeName: "基层B",
        type: "spare",
        productId: "product-pump",
        quantity: 8
      }
    ],
    supportActivityJobs: [{
      activityCode: "USE-001",
      spare: [
        { key: deletedKey, productId: "product-pump", quantity: 1 },
        { key: "missing-legacy-key", productId: "product-pump", quantity: 1 }
      ]
    }]
  });

  assert.ok(loaded.supportResources.some((resource) => resource.id === "support-spare:leaf-b:product-pump"));
  assert.ok(loaded.supportResources.every((resource) => resource.id !== deletedKey));
  assert.deepEqual(loaded.supportActivityJobs[0].spare.map((requirement) => requirement.key), [
    deletedKey,
    "missing-legacy-key"
  ]);
});

test("same-label hardware rows remain distinct when product IDs differ", () => {
  const loaded = normalizeProjectJsonForClientDraft({
    supportOrganization: {
      tree: { id: "root", name: "保障组织", children: [{ id: "leaf", name: "基层", children: [] }] }
    },
    products: [
      { id: "product-p1", name: "同标签LRU", model: "SAME" },
      { id: "product-p2", name: "同标签LRU", model: "SAME" }
    ],
    components: [
      { id: "lru-p1", name: "同标签LRU", model: "SAME", productId: "product-p1", productType: "LRU" },
      { id: "lru-p2", name: "同标签LRU", model: "SAME", productId: "product-p2", productType: "LRU" }
    ],
    supportResources: []
  });

  assert.deepEqual(loaded.supportResources.map((resource) => resource.id).sort(), [
    "support-spare:leaf:product-p1",
    "support-spare:leaf:product-p2"
  ]);
});

test("stable spare IDs are order-independent and separate legacy collisions by organization", () => {
  const scenario = {
    supportOrganization: {
      tree: {
        id: "root",
        name: "保障组织",
        children: [
          { id: "leaf-a", name: "同名基层", children: [] },
          { id: "leaf-b", name: "同名基层", children: [] }
        ]
      }
    },
    products: [{ id: "product-pump", name: "液压泵", model: "PUMP-1" }],
    components: [{ id: "pump-lru", name: "液压泵", model: "PUMP-1", productId: "product-pump", productType: "LRU" }],
    supportResources: [
      { id: "duplicate-old-id", organizationNodeId: "leaf-a", supportNodeName: "同名基层", type: "spare", productId: "product-pump", name: "液压泵", model: "PUMP-1", quantity: 4 },
      { id: "duplicate-old-id", organizationNodeId: "leaf-b", supportNodeName: "同名基层", type: "spare", productId: "product-pump", name: "液压泵", model: "PUMP-1", quantity: 7 }
    ],
    supportActivityJobs: [{
      activityCode: "USE-001",
      spare: [{ key: "duplicate-old-id", productId: "product-pump", quantity: 1 }]
    }]
  };
  const forwardProject = normalizeProjectJsonForClientDraft(scenario);
  const reverseProject = normalizeProjectJsonForClientDraft({ ...scenario, supportResources: [...scenario.supportResources].reverse() });
  const forward = forwardProject.supportResources;
  const reverse = reverseProject.supportResources;
  const identity = (rows) => rows.map((row) => `${row.id}=${row.quantity}`).sort();

  assert.deepEqual(identity(forward), [
    "support-spare:leaf-a:product-pump=4",
    "support-spare:leaf-b:product-pump=7"
  ]);
  assert.deepEqual(identity(reverse), identity(forward));
  assert.equal(forwardProject.supportActivityJobs[0].spare[0].key, "duplicate-old-id");
  assert.equal(reverseProject.supportActivityJobs[0].spare[0].key, "duplicate-old-id");
});

test("Case-large export migrates old resource collisions without dangling activity references", async () => {
  const caseLarge = JSON.parse(await readFile(new URL("../exports/project-case-large.json", import.meta.url), "utf8"));

  const loaded = normalizeProjectJsonForClientDraft(caseLarge);
  const liveSpares = loaded.supportResources.filter((resource) => (
    resource.type === "spare" && !resource.id.startsWith("support-spare-tombstone:")
  ));
  const logicalKeys = liveSpares.map((resource) => `${resource.organizationNodeName}\u0001${resource.productId}`);
  const resourceIds = new Set(loaded.supportResources.map((resource) => resource.id));
  const keyedRequirements = loaded.supportActivityJobs
    .flatMap((job) => job.spare || [])
    .filter((requirement) => requirement.key);
  const originalKeyedRequirementCount = caseLarge.supportActivityJobs
    .flatMap((job) => job.spare || [])
    .filter((requirement) => requirement.key).length;

  assert.ok(liveSpares.length > 0);
  assert.ok(liveSpares.every((resource) => resource.id.startsWith("support-spare:")));
  assert.equal(new Set(logicalKeys).size, logicalKeys.length);
  assert.ok(keyedRequirements.every((requirement) => resourceIds.has(requirement.key)));
  assert.equal(keyedRequirements.length, originalKeyedRequirementCount);
  assert.ok(loaded.supportActivityJobs.flatMap((job) => job.spare || []).every((requirement) => requirement.productId));
});

test("buildBackendProjectJson preserves aircraft type catalog and strips redundant equipment runtime fields", () => {
  const scenario = {
    scenarioId: "combat-unit-is-source",
    equipment: {
      model: "legacy-summary",
      quantity: 7,
      initialReady: 6,
      minRequiredSorties: 4,
      wholeMachineModels: ["legacy-summary"],
      aircraftTypes: [
        { id: "aircraft-type-j15", model: "J-15", name: "歼-15", quantity: 8 }
      ]
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

  assert.deepEqual(projectJson.equipment, {
    model: "J-15",
    wholeMachineModels: ["J-15", "J-35", "legacy-summary"],
    aircraftTypes: [
      { id: "aircraft-type-j15", model: "J-15", name: "歼-15" },
      { id: "aircraft-type-j-35", model: "J-35", name: "J-35" },
      { id: "aircraft-type-legacy-summary", model: "legacy-summary", name: "legacy-summary" }
    ]
  });
  assert.equal("equipment" in projectJson.missionProfile, false);
  assert.equal(projectJson.combatUnit.members.length, 2);
  assert.equal(projectJson.missionProfile.combatUnit.members.length, 1);
  assert.equal("quantity" in projectJson.equipment, false);
  assert.equal("initialReady" in projectJson.equipment, false);
  assert.equal("minRequiredSorties" in projectJson.equipment, false);
  assert.equal("quantity" in projectJson.equipment.aircraftTypes[0], false);
  assert.ok("equipment" in scenario);
  assert.ok("equipment" in scenario.missionProfile);
});

test("buildBackendProjectJson saves canonical combat-unit pre-life consumption fields", () => {
  const projectJson = buildBackendProjectJson({
    scenarioId: "canonical-pre-life",
    combatUnit: {
      members: [
        {
          aircraftNo: "J15-101",
          preLifeCalendarDays: 14,
          preLifeFlightHours: 23.5,
          preLifeTakeoffLandingCount: 8,
          takeoffLandingCount: 8,
          preLifeRequirementHours: 120,
          remainingLifeHours: 96.5
        },
        {
          aircraftNo: "J15-102",
          calendarDays: 45,
          takeoffLandingCount: 3,
          landingCount: 4,
          landings: 5,
          flightHours: 77,
          flight_hours: 78,
          preLifeRequirementHours: 200,
          remainingLifeHours: 180
        },
        { aircraftNo: "J15-103" }
      ]
    }
  }, { id: "canonical-pre-life" });

  assert.deepEqual(
    projectJson.combatUnit.members.map((member) => ({
      preLifeCalendarDays: member.preLifeCalendarDays,
      preLifeFlightHours: member.preLifeFlightHours,
      preLifeTakeoffLandingCount: member.preLifeTakeoffLandingCount
    })),
    [
      { preLifeCalendarDays: 14, preLifeFlightHours: 23.5, preLifeTakeoffLandingCount: 8 },
      { preLifeCalendarDays: 0, preLifeFlightHours: 0, preLifeTakeoffLandingCount: 0 },
      { preLifeCalendarDays: 0, preLifeFlightHours: 0, preLifeTakeoffLandingCount: 0 }
    ]
  );
  assert.equal(projectJson.combatUnit.members[0].takeoffLandingCount, 8);
  assert.equal(projectJson.combatUnit.members[1].takeoffLandingCount, 3);
  assert.equal(projectJson.combatUnit.members[1].landingCount, 4);
  assert.equal(projectJson.combatUnit.members[1].landings, 5);
  assert.equal(projectJson.combatUnit.members[1].flightHours, 77);
  assert.equal(projectJson.combatUnit.members[1].flight_hours, 78);
  assert.equal(projectJson.combatUnit.members[0].preLifeRequirementHours, 120);
  assert.equal(projectJson.combatUnit.members[0].remainingLifeHours, 96.5);
  assert.equal(projectJson.combatUnit.members[1].preLifeRequirementHours, 200);
  assert.equal(projectJson.combatUnit.members[1].remainingLifeHours, 180);
  assert.equal(projectJson.combatUnit.members[1].calendarDays, 45);
});

test("combat-unit pre-life normalization ignores unrelated legacy life values and rejects invalid canonical values", () => {
  const legacyConflict = normalizeProjectJsonForClientDraft({
    combatUnit: {
      members: [{
        preLifeFlightHours: 6,
        preLifeTakeoffLandingCount: 4,
        preLifeRequirementHours: 120,
        remainingLifeHours: 90,
        takeoffLandingCount: 5
      }]
    }
  });
  assert.equal(legacyConflict.combatUnit.members[0].preLifeFlightHours, 6);
  assert.equal(legacyConflict.combatUnit.members[0].preLifeTakeoffLandingCount, 4);
  assert.equal(legacyConflict.combatUnit.members[0].preLifeRequirementHours, 120);
  assert.equal(legacyConflict.combatUnit.members[0].remainingLifeHours, 90);
  assert.equal(legacyConflict.combatUnit.members[0].takeoffLandingCount, 5);

  const invalidCases = [
    ["preLifeCalendarDays", -1],
    ["preLifeCalendarDays", 1.5],
    ["preLifeFlightHours", -0.5],
    ["preLifeFlightHours", Number.POSITIVE_INFINITY],
    ["preLifeTakeoffLandingCount", 2.5],
    ["preLifeTakeoffLandingCount", "4"]
  ];
  for (const [fieldName, value] of invalidCases) {
    assert.throws(
      () => normalizeProjectJsonForClientDraft({ combatUnit: { members: [{ [fieldName]: value }] } }),
      new RegExp(`combatUnit\\.members\\.0\\.${fieldName}`),
      `${fieldName}=${String(value)} must fail closed`
    );
  }
});

test("experiment plan config preserves Monte Carlo branch sweep settings", () => {
  const projectJson = {
    experiment: {
      name: "branch config",
      steps: 12,
      samples: 24,
      seed: 20260620,
      parallelCores: 6
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
  assert.equal(config.parallelCores, 6);
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

test("experiment plan config rejects invalid Monte Carlo parallel cores", () => {
  for (const parallelCores of [0, 1.5, 33, "abc"]) {
    assert.throws(
      () => buildExperimentPlanConfig({ experiment: { parallelCores } }),
      /并行核心数必须是 1-32 之间的正整数/
    );
  }
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
    supportNodes: [{ id: "base-a", name: "基地" }],
    supportResources: [{ id: "spare-a", supportNodeName: "基地", type: "spare", name: "LRU-A", quantity: 2 }],
    scenarioComposition: {
      schemaVersion: "scenario-composition-v0",
      overrides: [
        { path: "supportResources.0.quantity", valueType: "number", value: "12", label: "LRU-A" },
        { path: "missionProfile.durationDays", valueType: "number", value: "8" }
      ]
    },
    seedPolicy: { mode: "fixed", baseSeed: 909 }
  };

  const config = buildExperimentPlanConfig(projectJson);

  assert.equal(config.seed, 909);
  assert.deepEqual(config.seedPolicy, { mode: "fixed", baseSeed: 909 });
  assert.equal(config.projectJson.supportResources[0].quantity, 12);
  assert.equal(config.projectJson.missionProfile.durationDays, 8);
  assert.deepEqual(config.scenarioComposition.overrides.map((item) => item.path), [
    "supportResources.0.quantity",
    "missionProfile.durationDays"
  ]);
  assert.equal("scenarioComposition" in config.projectJson, false);
  assert.equal("seedPolicy" in config.projectJson, false);
});

test("buildExperimentPlanConfig preserves stop policy and strips it from branch projectJson", () => {
  const config = buildExperimentPlanConfig({
    project_id: "project-stop-policy",
    experiment: { name: "stop policy", steps: 4, samples: 2, seed: 11 },
    stopPolicy: {
      schemaVersion: "stop-policy-v0",
      mode: "and",
      conditions: [
        { type: "duration", durationMinutes: 480 },
        { type: "failure" },
        { type: "specifiedTime", minute: 90 }
      ]
    }
  });

  assert.deepEqual(config.stopPolicy, {
    schemaVersion: "stop-policy-v0",
    mode: "and",
    conditions: [
      { type: "duration", durationMinutes: 480 },
      { type: "failure" },
      { type: "specifiedTime", minute: 90 }
    ]
  });
  assert.equal("stopPolicy" in config.projectJson, false);
});

test("buildExperimentPlanConfig defaults stop policy to duration OR semantics", () => {
  const config = buildExperimentPlanConfig({
    project_id: "project-default-stop-policy",
    experiment: { name: "default stop policy", steps: 4, samples: 2, seed: 11 }
  });

  assert.deepEqual(config.stopPolicy, {
    schemaVersion: "stop-policy-v0",
    mode: "or",
    conditions: [{ type: "duration" }],
    defaulted: true
  });
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
      if (request.path === "/projects/project-branch/experiment-plans/plan-branch") {
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
  await client.updateExperimentPlan("project-branch", "plan-branch", buildExperimentPlanConfig({
    ...projectJson,
    experiment: { ...projectJson.experiment, steps: 9 }
  }));

  assert.equal(calls[0].path, "/projects/project-branch/experiment-plans");
  assert.equal(calls[0].body.config.seed, 42);
  assert.notEqual(calls[0].body.config.projectJson, projectJson);
  assert.equal("experiment" in calls[0].body.config.projectJson, false);
  assert.equal("analysisRequests" in calls[0].body.config.projectJson, false);
  assert.equal("monteCarlo" in calls[0].body.config.projectJson, false);
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].path, "/projects/project-branch/experiment-plans/plan-branch");
  assert.equal(calls[1].body.config.steps, 9);
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

test("frontend API downloads analysis XLSX with the UTF-8 server filename", async () => {
  const originalFetch = globalThis.fetch;
  let observedRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    observedRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-disposition"
            ? "attachment; filename=analysis.xlsx; filename*=UTF-8''Runtime%20%E9%A1%B9%E7%9B%AE-%E4%BB%BB%E5%8A%A1%E5%8F%AF%E9%9D%A0%E5%BA%A6%E8%AF%84%E4%BC%B0-20260718-120000.xlsx"
            : "";
        }
      },
      blob: async () => new Blob(["PK-analysis"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    };
  };
  try {
    const client = createBackendApiClient({ baseUrl: "/api", getAuthToken: () => "session-export" });
    const download = await client.exportAnalysisXlsx({ analysis_type: "mission_reliability" });

    assert.equal(observedRequest.url, "/api/analysis-results/export-xlsx");
    assert.equal(observedRequest.init.method, "POST");
    assert.equal(observedRequest.init.headers.authorization, "Bearer session-export");
    assert.equal(download.filename, "Runtime 项目-任务可靠度评估-20260718-120000.xlsx");
    assert.equal(download.blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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

test("frontend API visualization cleanup keeps the authenticated DELETE alive during page exit", async () => {
  const originalFetch = globalThis.fetch;
  let observedRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    observedRequest = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        visualization_session_id: "session/with space",
        deleted: true
      })
    };
  };
  try {
    const client = createBackendApiClient({
      baseUrl: "/api",
      getAuthToken: () => "session-cleanup"
    });

    const deleted = await client.deleteVisualizationSession("session/with space", {
      keepalive: true,
      authToken: "captured-cleanup"
    });

    assert.equal(deleted.deleted, true);
    assert.equal(observedRequest.url, "/api/visualization-sessions/session%2Fwith%20space");
    assert.equal(observedRequest.init.method, "DELETE");
    assert.equal(observedRequest.init.keepalive, true);
    assert.equal(observedRequest.init.headers.authorization, "Bearer captured-cleanup");
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
  assert.match(appSource, /backendApi\.getProject\(requestedProjectId\)/);
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
  assert.match(enterWorkbenchSource, /selectedExperimentPlanKeys = new Set\(\)/);
  assert.match(enterWorkbenchSource, /experimentPlan = null/);
  assert.match(enterWorkbenchSource, /liteMesaMonteCarloResult = null/);
  assert.match(enterWorkbenchSource, /liteMesaAnalysisResults = \{\}/);
  assert.match(flushSource, /clearTimeout\(projectDraftAutosaveTimer\)/);
  assert.match(flushSource, /projectDraftAutosaveTimer = null/);
  assert.match(flushSource, /projectDraftSaveStatus === "有未保存修改"/);
  assert.match(flushSource, /await saveCurrentProjectDraftThroughApi\(\)/);
});

test("every Project draft dirty helper shares revision tracking and the serialized save queue", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const dirtySource = appSource.slice(
    appSource.indexOf("function markProjectDraftDirty"),
    appSource.indexOf("function scheduleProjectDraftAutosave")
  );
  const rmsDirtySource = appSource.slice(
    appSource.indexOf("function markRmsAllocationDraftChanged"),
    appSource.indexOf("function startRmsAllocationCalculation")
  );
  const productDirtySource = appSource.slice(
    appSource.indexOf("function markProductCatalogChanged"),
    appSource.indexOf("function permissionRoleLabel")
  );
  const planSaveSource = appSource.slice(
    appSource.indexOf("async function saveCurrentExperimentPlanThroughApi"),
    appSource.indexOf("function ensureExperimentPlanLargeSampleRequest")
  );

  assert.match(dirtySource, /projectDraftRevision \+= 1/);
  assert.match(rmsDirtySource, /markProjectDraftDirty\(\)/);
  assert.match(productDirtySource, /markProjectDraftDirty\(\{ updatePreview: true \}\)/);
  assert.match(planSaveSource, /await saveCurrentProjectDraftThroughApi\(\)/);
  assert.doesNotMatch(planSaveSource, /backendApi\.saveProject\(/);
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
