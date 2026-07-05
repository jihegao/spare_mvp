import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const FRONTEND_ENTRYPOINTS = [
  "front/api-client.mjs",
  "front/app.js",
  "front/run-intent.mjs"
];

const LEGACY_PATTERNS = [
  { name: "legacy simulation run route", pattern: /\/simulation-runs/ },
  { name: "legacy raw run alias", pattern: /\bgetRun\s*\(/ }
];

test("frontend entrypoints do not reintroduce legacy run API calls", async () => {
  const violations = [];
  for (const filePath of FRONTEND_ENTRYPOINTS) {
    const source = await readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
    for (const { name, pattern } of LEGACY_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${filePath}: ${name}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("obsolete contract provider and smoke model files stay retired", async () => {
  const retiredPaths = [
    "src/spare_mvp_abm/contract_server.py",
    "src/spare_mvp_abm/smoke_model.py",
    "src/spare_mvp_abm/model.py",
    "scenarios/spare-planning-smoke/experiment.json",
    "scenarios/spare-planning-smoke/scenario.md",
    "scenarios/mission-reliability-smoke/experiment.json",
    "scenarios/mission-reliability-smoke/scenario.md",
    "tests/test_contract_server.py",
    "tests/test_spare_mvp_smoke_mesa.py",
    "tests/test_evaluator_mesa_contract.py",
    "tests/fixtures/smoke_project.json",
    "tests/fixtures/smoke_scenario.json",
    "tests/fixtures/smoke_run.json",
    "tests/fixtures/smoke_result.json",
    "tests/fixtures/smoke_artifact_manifest.json",
    "tests/fixtures/smoke_visualization_state_series.json"
  ];

  const stillPresent = [];
  for (const filePath of retiredPaths) {
    try {
      await access(new URL(`../${filePath}`, import.meta.url));
      stillPresent.push(filePath);
    } catch {
      // Expected: retired file is absent.
    }
  }

  assert.deepEqual(stillPresent, []);
});
