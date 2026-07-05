import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const FRONTEND_ENTRYPOINTS = [
  "front/api-client.mjs",
  "front/app.js",
  "front/run-intent.mjs"
];

const ACTIVE_RUNTIME_SOURCES = [
  "front/api-client.mjs",
  "front/app.js",
  "src/spare_mvp_backend/api.py",
  "src/spare_mvp_backend/http_server.py"
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

test("retired independent Mesa visualization route stays absent while lite analysis route is active", async () => {
  const retiredPatterns = [
    { name: "independent Mesa visualization route", pattern: /\/mesa-visualization-runs/ },
    { name: "independent Mesa API method", pattern: /runIndependentMesaVisualization|run_independent_mesa_visualization/ },
    { name: "independent Mesa source marker", pattern: /independent_mesa_project|independent-mesa-/ }
  ];
  const violations = [];

  for (const filePath of ACTIVE_RUNTIME_SOURCES) {
    const source = await readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
    for (const { name, pattern } of retiredPatterns) {
      if (pattern.test(source)) {
        violations.push(`${filePath}: ${name}`);
      }
    }
  }

  assert.deepEqual(violations, []);

  const activeSource = await Promise.all(
    ACTIVE_RUNTIME_SOURCES.map(async (filePath) => readFile(new URL(`../${filePath}`, import.meta.url), "utf8"))
  );
  const combined = activeSource.join("\n");
  assert.match(combined, /\/mesa-analysis-runs/);
  assert.match(combined, /runLiteMesaAnalysis|run_lite_mesa_analysis/);
  assert.match(combined, /lite_mesa_aircraft_support_v1/);
});
