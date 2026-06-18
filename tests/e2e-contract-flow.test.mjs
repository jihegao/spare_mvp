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
  assert.equal(flow.run.run_id, "run-scenario-smoke-contract-demo");
  assert.equal(flow.storedRun.experiment_plan_id, flow.plan.experiment_plan_id);
  assert.equal(flow.result.result_id, flow.run.result_summary_id);
  assert.equal(flow.result.run_id, flow.run.run_id);
  assert.equal(flow.artifactManifest.artifact_manifest_id, flow.run.artifact_manifest_id);
  assert.equal(flow.artifactManifest.run_id, flow.run.run_id);
  assert.equal(flow.chain.project_id, flow.saved.project_id);
  assert.equal(flow.chain.scenario_id, flow.run.scenario_id);
  assert.equal(flow.chain.run_id, flow.run.run_id);
  assert.equal(flow.chain.result_summary_id, flow.run.result_summary_id);
  assert.equal(flow.chain.artifact_manifest_id, flow.run.artifact_manifest_id);
  assert.equal(typeof flow.result.metrics.mission_success_rate, "number");
  assert.equal(Number.isFinite(flow.result.metrics.mission_success_rate), true);
  assert.ok(flow.result.metrics.mission_success_rate >= 0);
  assert.ok(flow.result.metrics.mission_success_rate <= 1);

  const artifactKinds = new Set(flow.artifactManifest.artifacts.map((artifact) => artifact.kind));
  assert.equal(flow.artifactManifest.artifacts.length, 4);
  assert.deepEqual(artifactKinds, new Set(["input_project", "compiled_scenario", "snapshot", "result_summary"]));
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
  assert.match(report, new RegExp(flow.run.run_id));
  assert.match(report, new RegExp(flow.run.result_summary_id));
  assert.match(report, new RegExp(flow.run.artifact_manifest_id));
  assert.match(report, /已知限制/);
  assert.match(report, /不代表 calibration quality/);
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
