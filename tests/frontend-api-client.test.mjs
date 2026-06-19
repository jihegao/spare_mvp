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
      if (request.path === "/projects/project-ui") return { project_id: "project-ui", project_version: "project-v0.1" };
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
      if (request.path === "/simulation-runs/run-ui") return { run_id: "run-ui", status: "succeeded" };
      if (request.path === "/simulation-runs/run-ui/result") return { result_id: "result-ui", metrics: { mission_success_rate: 0.9 } };
      if (request.path === "/simulation-runs/run-ui/artifacts") return { artifact_manifest_id: "artifact-ui", artifacts: [] };
      if (request.path === "/simulation-runs/run-ui/chain") {
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
  const storedProject = await client.getProject(saved.project_id);
  const snapshot = await client.createModelingSnapshot(saved.project_id);
  const plan = await client.createExperimentPlan(saved.project_id, { steps: 2 });
  const run = await client.startSimulationRun(saved.project_id, plan.experiment_plan_id);
  const storedRun = await client.getRun(run.run_id);
  const result = await client.getRunResult(run.run_id);
  const artifacts = await client.getRunArtifacts(run.run_id);
  const chain = await client.getRunChain(run.run_id);

  assert.equal(storedProject.project_id, "project-ui");
  assert.equal(snapshot.snapshot_id, "snapshot-ui");
  assert.equal(run.status, "succeeded");
  assert.equal(storedRun.run_id, "run-ui");
  assert.equal(result.result_id, "result-ui");
  assert.equal(artifacts.artifact_manifest_id, "artifact-ui");
  assert.equal(chain.artifact_manifest_id, "artifact-ui");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /projects/validate",
    "POST /projects",
    "GET /projects/project-ui",
    "POST /projects/project-ui/modeling-snapshots",
    "POST /projects/project-ui/experiment-plans",
    "POST /simulation-runs",
    "GET /simulation-runs/run-ui",
    "GET /simulation-runs/run-ui/result",
    "GET /simulation-runs/run-ui/artifacts",
    "GET /simulation-runs/run-ui/chain"
  ]);
  assert.equal(calls[5].body.model_family, "smoke");
});

test("frontend app routes project save run and result reads through API client", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /from "\.\/api-client\.mjs"/);
  assert.match(appSource, /const backendApi = createBackendApiClient/);
  assert.match(appSource, /async function saveCurrentProjectThroughApi/);
  assert.match(appSource, /async function startExperimentRunThroughApi/);
  assert.match(appSource, /async function refreshRunResultThroughApi/);
  assert.match(appSource, /backendApi\.saveProject/);
  assert.match(appSource, /backendApi\.getProject/);
  assert.match(appSource, /backendApi\.createModelingSnapshot/);
  assert.match(appSource, /backendApi\.createExperimentPlan/);
  assert.match(appSource, /backendApi\.startSimulationRun/);
  assert.match(appSource, /backendApi\.getRun\(/);
  assert.match(appSource, /backendApi\.getRunResult/);
  assert.match(appSource, /backendApi\.getRunArtifacts/);
  assert.match(appSource, /backendApi\.getRunChain/);
  assert.match(appSource, /backendRunChain/);
  assert.match(appSource, /backend-run-chain/);
  assert.match(appSource, /backendArtifactManifest\.artifacts/);
  assert.match(appSource, /ArtifactManifest/);
  assert.match(appSource, /hydrateLastBackendRunFromApi/);
  assert.match(appSource, /localStorage\.setItem\("spare-mvp:lastBackendRun"/);
  assert.match(appSource, /localStorage\.getItem\("spare-mvp:lastBackendRun"/);
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
    appSource.indexOf('const monteCarloStartButton = event.target.closest("[data-mc-action=')
  );

  assert.match(changeHandlerSource, /setPath\(scenario, input\.dataset\.path, parseInput\(input\)\)/);
  assert.match(changeHandlerSource, /updateDemoResultsThroughApiClient\(\)/);
  assert.doesNotMatch(changeHandlerSource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(monteCarloArraySource, /updateDemoResultsThroughApiClient\(\)/);
  assert.doesNotMatch(monteCarloArraySource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(appSource, /data-save-plan/);
  assert.match(saveButtonSource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(saveButtonSource, /render\(\)/);
});
