import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("..", import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);

test("canonical aircraft support flow saves modeling state and fetches run outputs", async () => {
  const flow = runPythonContractFlow();

  assert.equal(flow.validation.ok, true);
  assert.equal(flow.saved.status, "saved");
  assert.equal(flow.saved.project_id, "project-carrier-day-night");
  assert.equal(flow.snapshot.project_id, flow.saved.project_id);
  assert.equal(flow.snapshot.project_version, "import-v1");
  assert.equal(flow.plan.project_id, flow.saved.project_id);
  assert.equal(flow.plan.config.steps, 4);
  assert.equal(flow.run.status, "succeeded");
  assert.match(flow.run.run_id, /^run-scenario-import-carrier-day-night-001-[0-9a-f]{12}-\d{4}$/);
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
  assert.equal(typeof flow.result.metrics.sortie_completion_rate, "number");
  assert.equal(Number.isFinite(flow.result.metrics.sortie_completion_rate), true);
  assert.ok(flow.result.metrics.sortie_completion_rate >= 0);
  assert.ok(flow.result.metrics.sortie_completion_rate <= 1);

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

});

test("M3-0 backend loop closeout remains documented while docs index stays current-only", async () => {
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
  assert.match(docsReadme, /当前活跃文档只保留两类/);
  assert.match(docsReadme, /历史计划、阶段规格、原始概要设计转换稿、一次性审计/);
  assert.match(docsReadme, /archive\/deprecated/);

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
export = json.loads((repo_root / "tests" / "fixtures" / "m9_6_platform_case_export.json").read_text(encoding="utf-8"))
project = export["project"]
plan_config = dict(export["experiment_plan"]["config"])
plan_config.update({"name": "contract-first e2e current", "steps": 4, "projectJson": project})

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
        plan = api.create_experiment_plan(saved["project_id"], plan_config)
        run = api.submit_run({
            "project_id": saved["project_id"],
            "experiment_plan_id": plan["experiment_plan_id"],
            "model_family": "aircraft_support_v1",
            "run_type": "single",
        })
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

  const result = spawnSync(resolvePythonExecutable(), ["-c", script], {
    cwd: repoRootPath,
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

function resolvePythonExecutable() {
  if (process.env.PYTHON) {
    return process.env.PYTHON;
  }
  const candidates = process.platform === "win32"
    ? [
        path.join(repoRootPath, ".abm-mesa-test-env", "Scripts", "python.exe"),
        path.join(repoRootPath, ".abm-mesa-test-env", "bin", "python.exe")
      ]
    : [
        path.join(repoRootPath, ".abm-mesa-test-env", "bin", "python")
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
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
