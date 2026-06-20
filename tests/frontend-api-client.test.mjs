import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildExperimentPlanConfig, createBackendApiClient } from "../front/api-client.mjs";

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
  const storedProject = await client.getProject(saved.project_id);
  const snapshot = await client.createModelingSnapshot(saved.project_id);
  const plan = await client.createExperimentPlan(saved.project_id, { steps: 2 });
  const run = await client.submitRun({
    project_id: saved.project_id,
    experiment_plan_id: plan.experiment_plan_id,
    model_family: "smoke",
    run_type: "single"
  });
  const storedRun = await client.getRunStatus(run.run_id);
  const result = await client.getRunResult(run.run_id);
  const artifacts = await client.getRunArtifacts(run.run_id);
  const chain = await client.getRunChain(run.run_id);

  assert.equal(storedProject.project_id, "project-ui");
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
    "GET /projects/project-ui",
    "POST /projects/project-ui/modeling-snapshots",
    "POST /projects/project-ui/experiment-plans",
    "POST /runs",
    "GET /runs/run-ui",
    "GET /runs/run-ui/result",
    "GET /runs/run-ui/artifacts",
    "GET /runs/run-ui/chain"
  ]);
  assert.equal(calls[5].body.model_family, "smoke");
  assert.equal(calls[5].body.run_type, "single");
});

test("frontend API client keeps legacy run aliases on canonical run routes", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/runs") return { run_id: "run-alias", status: "succeeded", phase: "completed" };
      if (request.path === "/simulation-runs/run-alias") {
        return { run_id: "run-alias", schema_version: "run-v0", model_id: "SmokeSpareMvpModel" };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const submitted = await client.startSimulationRun("project-ui", "plan-ui");
  const rawRun = await client.getRun(submitted.run_id);

  assert.equal(rawRun.schema_version, "run-v0");
  assert.equal(rawRun.model_id, "SmokeSpareMvpModel");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /runs",
    "GET /simulation-runs/run-alias"
  ]);
  assert.deepEqual(calls[0].body, {
    project_id: "project-ui",
    experiment_plan_id: "plan-ui",
    model_family: "smoke",
    run_type: "single"
  });
});

test("frontend API client exposes explicit M5 modeling import methods", async () => {
  const calls = [];
  const client = createBackendApiClient({
    transport: async (request) => {
      calls.push(request);
      if (request.path === "/modeling-imports/validate") return { ok: true, status: "valid", issues: [] };
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
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });
  const importPackage = { schemaVersion: "modeling-import-v1", importId: "import/ui demo" };

  const validation = await client.validateModelingImport(importPackage);
  const saved = await client.saveModelingImport(importPackage);
  const stored = await client.getModelingImport(importPackage.importId);
  const published = await client.publishModelingImport(importPackage.importId);
  const compiled = await client.compileModelingImportScenario(importPackage.importId);

  assert.equal(validation.status, "valid");
  assert.equal(saved.import_id, "import/ui demo");
  assert.equal(stored.importId, "import/ui demo");
  assert.equal(stored.draftPackage.lifecycle.version, 2);
  assert.equal(stored.publishedPackage.lifecycle.version, 1);
  assert.equal(published.lifecycle.state, "published");
  assert.equal(published.publishedPackage.lifecycle.state, "published");
  assert.equal(compiled.compiled_from_import.model_family, "smoke");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /modeling-imports/validate",
    "POST /modeling-imports",
    "GET /modeling-imports/import%2Fui%20demo",
    "POST /modeling-imports/import%2Fui%20demo/publish",
    "POST /modeling-imports/import%2Fui%20demo/compile-scenario"
  ]);
  assert.equal(calls[0].body, importPackage);
  assert.equal(calls[1].body, importPackage);
  assert.deepEqual(calls[4].body, { model_family: "smoke" });
});

test("experiment plan config preserves Monte Carlo branch sweep settings", () => {
  const config = buildExperimentPlanConfig({
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
  });

  assert.deepEqual(config, {
    name: "branch config",
    steps: 12,
    samples: 24,
    seed: 20260620,
    monteCarlo: {
      failureRates: [0.06, 0.08, 0.1],
      spareMultipliers: [0.75, 1, 1.25],
      supportCapacities: [2, 3],
      minRequiredSorties: [4, 5]
    }
  });
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
        return { user_id: "user-planner", username: "planner", display_name: request.body.display_name };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    }
  });

  const listed = await client.listUsers();
  const created = await client.createUser({ username: "planner", password: "planner", role: "数据管理员" });
  const updated = await client.updateUser("user-planner", { display_name: "规划员二号" });

  assert.equal(listed.users[0].username, "admin");
  assert.equal(created.username, "planner");
  assert.equal(updated.display_name, "规划员二号");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /users",
    "POST /users",
    "POST /users/user-planner"
  ]);
  assert.equal(calls[0].headers.authorization, "Bearer session-admin");
  assert.equal(calls[1].headers.authorization, "Bearer session-admin");
  assert.equal(calls[2].headers.authorization, "Bearer session-admin");
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

test("frontend API client preserves compile gate error payload for submitRun", async () => {
  const compileGateError = new Error("aviation_support input is not supported by the Scenario compiler");
  compileGateError.code = "unsupported_model_family";
  compileGateError.details = {
    issues: [
      {
        severity: "error",
        page: "保障活动建模",
        field_path: "objects.supportActivities[0].durationMinutes",
        message: "缺少可编译的保障活动工期。"
      }
    ],
    provenance: {
      model_family: "aviation_support",
      mapping_version: "aviation-support-input-v0"
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
      model_family: "aviation_support",
      run_type: "single"
    }),
    (err) => {
      assert.equal(err.code, "unsupported_model_family");
      assert.equal(err.details.issues[0].field_path, "objects.supportActivities[0].durationMinutes");
      assert.equal(err.payload.details.provenance.model_family, "aviation_support");
      return true;
    }
  );
});

test("frontend app routes project save run and result reads through API client", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");

  assert.match(appSource, /from "\.\/api-client\.mjs"/);
  assert.match(appSource, /const AUTH_SESSION_STORAGE_KEY = "spare-mvp:m4Session"/);
  assert.match(appSource, /const backendApi = createBackendApiClient\(\{ baseUrl: "\/api", getAuthToken: \(\) => backendAuthToken \}\)/);
  assert.match(appSource, /async function handleLogin/);
  assert.match(appSource, /backendApi\.login/);
  assert.match(appSource, /localStorage\.setItem\(AUTH_SESSION_STORAGE_KEY/);
  assert.match(appSource, /async function saveCurrentProjectThroughApi/);
  assert.match(appSource, /async function startExperimentRunThroughApi/);
  assert.match(appSource, /async function refreshRunResultThroughApi/);
  assert.match(appSource, /backendApi\.saveProject/);
  assert.match(appSource, /backendApi\.getProject/);
  assert.match(appSource, /backendApi\.createModelingSnapshot/);
  assert.match(appSource, /backendApi\.createExperimentPlan/);
  assert.match(appSource, /backendApi\.submitRun/);
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
  assert.match(appSource, /后端产物来源/);
  assert.match(appSource, /前端展示桥接/);
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
    appSource.indexOf('const monteCarloStartButton = event.target.closest("[data-mc-action=')
  );

  assert.match(changeHandlerSource, /setPath\(scenario, input\.dataset\.path, parseInput\(input\)\)/);
  assert.match(changeHandlerSource, /updateDemoResultsThroughApiClient\(\)/);
  assert.doesNotMatch(changeHandlerSource, /saveCurrentProjectThroughApi\(\)/);
  assert.match(changeHandlerSource, /markProjectDraftChanged\(\)/);
  assert.match(monteCarloArraySource, /updateDemoResultsThroughApiClient\(experimentPlanDraft\)/);
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

test("frontend app wires modeling import workbench through explicit backend actions", async () => {
  const appSource = await readFile(new URL("../front/app.js", import.meta.url), "utf8");
  const featureCatalogSource = await readFile(new URL("../front/feature-catalog.mjs", import.meta.url), "utf8");
  const changeHandlerSource = appSource.slice(
    appSource.indexOf('app.addEventListener("change"'),
    appSource.indexOf('app.addEventListener("input"')
  );

  assert.match(featureCatalogSource, /建模数据导入/);
  assert.match(featureCatalogSource, /modeling-import-workbench/);
  assert.match(appSource, /from "\.\/modeling-import-workbench\.mjs"/);
  assert.match(appSource, /renderModelingImportWorkbench/);
  assert.match(appSource, /data-modeling-import-action/);
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
