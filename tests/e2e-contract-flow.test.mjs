import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url);

test("contract-first smoke flow saves modeling state and fetches run outputs", async () => {
  const flow = runPythonContractFlow();

  assert.equal(flow.validation.ok, true);
  assert.equal(flow.saved.status, "saved");
  assert.equal(flow.saved.project_id, "project-smoke-contract-001");
  assert.equal(flow.snapshot.project_id, flow.saved.project_id);
  assert.equal(flow.snapshot.project_version, "project-v0.1");
  assert.equal(flow.plan.project_id, flow.saved.project_id);
  assert.equal(flow.plan.config.steps, 4);
  assert.equal(flow.run.status, "succeeded");
  assert.match(flow.run.run_id, /^run-scenario-smoke-contract-demo-[0-9a-f]{12}-\d{4}$/);
  assert.equal(flow.storedRun.experiment_plan_id, flow.plan.experiment_plan_id);
  assert.equal(flow.result.result_id, flow.run.result_summary_id);
  assert.equal(flow.result.run_id, flow.run.run_id);
  assert.equal(flow.artifactManifest.artifact_manifest_id, flow.run.artifact_manifest_id);
  assert.equal(flow.artifactManifest.run_id, flow.run.run_id);
  assert.equal(flow.chain.project_id, flow.saved.project_id);
  assert.equal(flow.chain.modeling_snapshot_id, flow.snapshot.snapshot_id);
  assert.equal(flow.chain.experiment_plan_id, flow.plan.experiment_plan_id);
  assert.equal(flow.chain.scenario_id, flow.run.scenario_id);
  assert.equal(flow.chain.run_id, flow.run.run_id);
  assert.equal(flow.chain.result_summary_id, flow.run.result_summary_id);
  assert.equal(flow.chain.artifact_manifest_id, flow.run.artifact_manifest_id);
  assert.equal(typeof flow.result.metrics.mission_success_rate, "number");
  assert.equal(Number.isFinite(flow.result.metrics.mission_success_rate), true);
  assert.ok(flow.result.metrics.mission_success_rate >= 0);
  assert.ok(flow.result.metrics.mission_success_rate <= 1);

  const artifactKinds = new Set(flow.artifactManifest.artifacts.map((artifact) => artifact.kind));
  assertSetIncludes(artifactKinds, [
    "input_project",
    "compiled_scenario",
    "snapshot",
    "result_summary",
    "run_config",
    "metrics",
    "report",
    "log"
  ]);
  for (const artifact of flow.artifactManifest.artifacts) {
    assert.equal(typeof artifact.path, "string");
    assert.equal(path.isAbsolute(artifact.path), false);
    assert.equal(artifact.path.split("/").includes(".."), false);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.ok(artifact.size_bytes > 0);
  }

  const reportPath = new URL("../reports/contract-first-smoke/README.md", import.meta.url);
  assert.equal(existsSync(reportPath), true, "smoke evidence report must exist");
  const report = await readFile(reportPath, "utf8");
  assert.match(report, /# Contract-first smoke 证据/);
  assert.match(report, /node --test tests\/e2e-contract-flow\.test\.mjs/);
  assert.match(report, /python3 --version/);
  assert.match(report, /node --version/);
  assert.match(report, /run-scenario-smoke-contract-demo-<plan-hash>-0001/);
  assert.match(report, /result-run-scenario-smoke-contract-demo-<plan-hash>-0001/);
  assert.match(report, /artifact-manifest-run-scenario-smoke-contract-demo-<plan-hash>-0001/);
  assert.match(report, /已知限制/);
  assert.match(report, /不代表 calibration quality/);
});

test("M3-0 backend loop closeout remains documented and roadmap points to M3-1 current boundary", async () => {
  const closeoutPath = new URL("../reports/m3-0-real-backend-loop/README.md", import.meta.url);
  assert.equal(existsSync(closeoutPath), true, "M3-0 closeout report must exist");
  const closeout = await readFile(closeoutPath, "utf8");
  assert.match(closeout, /# M3-0 真实后端闭环收束/);
  assert.match(closeout, /Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest/);
  assert.match(closeout, /npm test/);
  assert.match(closeout, /\.abm-mesa-test-env\/bin\/python -m unittest/);
  assert.match(closeout, /不改变 Mesa 行为/);

  const repoReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(repoReadme, /M3-0 真实后端闭环/);
  assert.match(repoReadme, /reports\/m3-0-real-backend-loop\/README\.md/);

  const docsReadme = await readFile(new URL("../docs/README.md", import.meta.url), "utf8");
  assert.match(docsReadme, /M3-0 真实后端闭环/);

  const roadmap = await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8");
  assert.match(roadmap, /截至 2026-06-19，M3-1/);
  assert.match(roadmap, /M3-0 函数\/API smoke/);
  assert.match(roadmap, /真实后端闭环 smoke/);
  assert.doesNotMatch(roadmap, /前端状态主要保存在浏览器内存中，没有后端持久化。/);
});

test("M3-1 browser backend smoke closeout documents the real browser acceptance boundary", async () => {
  const closeoutPath = new URL("../reports/m3-1-browser-backend-smoke/README.md", import.meta.url);
  assert.equal(existsSync(closeoutPath), true, "M3-1 browser backend smoke report must exist");
  const closeout = await readFile(closeoutPath, "utf8");
  assert.match(closeout, /# M3-1 同源后端浏览器闭环验收/);
  assert.match(closeout, /\.abm-mesa-test-env\/bin\/python -m src\.spare_mvp_backend\.http_server --port 4173/);
  assert.match(closeout, /reports\/m3-1-browser-backend-smoke\/browser-backend-smoke\.mjs/);
  assert.match(closeout, /Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest/);
  assert.match(closeout, /持久 SQLite/);
  assert.match(closeout, /刷新后/);
  assert.match(closeout, /离线演示/);
  assert.match(closeout, /未创建 run_id/);
  assert.match(closeout, /不做生产账号\/权限/);
  assert.match(closeout, /不做 worker 队列/);
  assert.match(closeout, /不解锁 aviation_support Scenario 编译/);
  assert.match(closeout, /不扩展 Mesa 行为/);

  const roadmap = await readFile(new URL("../docs/product-roadmap.md", import.meta.url), "utf8");
  assert.match(roadmap, /M3-1 当前收束/);
  assert.match(roadmap, /offline-demo-run/);
});

function runPythonContractFlow() {
  const script = String.raw`
import json
import sqlite3
import tempfile
from pathlib import Path

from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter

repo_root = Path.cwd()
project = json.loads((repo_root / "tests" / "fixtures" / "smoke_project.json").read_text(encoding="utf-8"))

connection = sqlite3.connect(":memory:")
initialize_database(connection)
try:
    with tempfile.TemporaryDirectory() as tmp:
        api = BackendApi(
            ContractRepository(connection),
            SimulationAdapter(repo_root),
            output_dir=Path(tmp),
        )
        validation = api.validate_project(project)
        saved = api.save_project(project)
        snapshot = api.create_modeling_snapshot(saved["project_id"])
        plan = api.create_experiment_plan(saved["project_id"], {"name": "contract-first e2e smoke", "steps": 4})
        run = api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")
        payload = {
            "validation": validation,
            "saved": saved,
            "snapshot": snapshot,
            "plan": plan,
            "run": run,
            "storedRun": api.get_run(run["run_id"]),
            "result": api.get_run_result(run["run_id"]),
            "artifactManifest": api.get_run_artifacts(run["run_id"]),
            "chain": api.get_run_chain(run["run_id"]),
        }
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
finally:
    connection.close()
`;

  const result = spawnSync("python3", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, processFailureMessage(result));
  assert.equal(result.stderr.trim(), "", processFailureMessage(result));
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`Python flow did not emit parseable JSON: ${error.message}\n${processFailureMessage(result)}`);
  }
}

function processFailureMessage(result) {
  return [
    `status=${result.status}`,
    `signal=${result.signal}`,
    `stdout=${result.stdout}`,
    `stderr=${result.stderr}`
  ].join("\n");
}

function assertSetIncludes(actual, expectedValues) {
  const missing = expectedValues.filter((value) => !actual.has(value));
  assert.deepEqual(missing, []);
}
