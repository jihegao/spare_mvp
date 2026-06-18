import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBackendApiClient } from "../front/api-client.mjs";

test("frontend API client exposes stable PR-F save run and result methods", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/projects/validate") return { ok: true, project_id: "project-ui" };
      if (request.path === "/projects") return { project_id: "project-ui", status: "saved" };
      if (request.path === "/projects/project-ui/modeling-snapshots") return { snapshot_id: "snapshot-ui" };
      if (request.path === "/projects/project-ui/experiment-plans") return { experiment_plan_id: "plan-ui" };
      if (request.path === "/simulation-runs") {
        return {
          run_id: "run-ui",
          project_id: "project-ui",
          scenario_id: "scenario-ui",
          result_summary_id: "result-ui",
          artifact_manifest_id: "artifact-ui",
          status: "succeeded"
        };
      }
      if (request.path === "/simulation-runs/run-ui/result") return { result_id: "result-ui", metrics: { mission_success_rate: 0.9 } };
      if (request.path === "/simulation-runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", artifacts: [] };
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const project = { project_id: "project-ui", experiment: { steps: 2 } };
  const saved = await client.saveProject(project);
  const snapshot = await client.createModelingSnapshot(saved.project_id);
  const plan = await client.createExperimentPlan(saved.project_id, { steps: 2 });
  const run = await client.startSimulationRun(saved.project_id, plan.experiment_plan_id);
  const result = await client.getRunResult(run.run_id);
  const artifacts = await client.getRunArtifacts(run.run_id);

  assert.equal(snapshot.snapshot_id, "snapshot-ui");
  assert.equal(run.status, "succeeded");
  assert.equal(result.result_id, "result-ui");
  assert.equal(artifacts.artifact_manifest_id, "artifact-ui");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /projects/validate",
    "POST /projects",
    "POST /projects/project-ui/modeling-snapshots",
    "POST /projects/project-ui/experiment-plans",
    "POST /simulation-runs",
    "GET /simulation-runs/run-ui/result",
    "GET /simulation-runs/run-ui/artifacts"
  ]);
  assert.equal(calls[4].body.model_family, "smoke");
});

test("frontend app routes project save run and result reads through API client", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /from "\.\/api-client\.mjs"/);
  assert.match(appSource, /const backendApi = createBackendApiClient/);
  assert.match(appSource, /async function saveCurrentProjectThroughApi/);
  assert.match(appSource, /async function startExperimentRunThroughApi/);
  assert.match(appSource, /async function refreshRunResultThroughApi/);
  assert.match(appSource, /backendApi\.saveProject/);
  assert.match(appSource, /backendApi\.createModelingSnapshot/);
  assert.match(appSource, /backendApi\.createExperimentPlan/);
  assert.match(appSource, /backendApi\.startSimulationRun/);
  assert.match(appSource, /backendApi\.getRunResult/);
  assert.match(appSource, /backendApi\.getRunArtifacts/);
  assert.doesNotMatch(appSource, /runSimulation\(scenario/);
  assert.doesNotMatch(appSource, /runMonteCarlo\(scenario/);
});
