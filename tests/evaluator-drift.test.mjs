import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_JSON_CONTRACT } from "../front/project-json-contract.mjs";
import { defaultScenario } from "../front/sim-engine.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

async function readText(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function frontendRequiredProjectRoots() {
  return PROJECT_JSON_CONTRACT.objects
    .filter((object) => object.required && !object.path.includes("."))
    .map((object) => object.path)
    .sort();
}

function oneOfBranch(schema, modelFamily) {
  return schema.oneOf.find((branch) => branch.properties?.model_family?.const === modelFamily);
}

function requiredMetricSet(resultSchema, modelFamily) {
  return new Set(oneOfBranch(resultSchema, modelFamily).properties.metrics.required);
}

test("project schema required roots stay aligned with frontend Project JSON contract", async () => {
  const schema = await readJson("contracts/project.schema.json");
  const frontendRoots = frontendRequiredProjectRoots();
  const schemaRequiredRoots = [...schema.required].sort();

  assert.deepEqual(schemaRequiredRoots, frontendRoots);
  assert.equal("schema_version" in defaultScenario, false);
  assert.equal("project_id" in defaultScenario, false);
  assert.deepEqual(validateSchema(schema, defaultScenario), []);
});

test("schema manifest lists every checked fixture and each fixture validates", async () => {
  const manifest = await readJson("contracts/README.md.json");
  const expectedFixtures = [
    "tests/fixtures/minimal_project.json",
    "tests/fixtures/minimal_scenario.json",
    "tests/fixtures/minimal_run.json",
    "tests/fixtures/minimal_result_smoke.json",
    "tests/fixtures/minimal_result_aviation_support.json",
    "tests/fixtures/minimal_artifact_manifest.json",
  ];

  assert.deepEqual(manifest.fixture_files, expectedFixtures);

  const fixtureSchemas = {
    "tests/fixtures/minimal_project.json": "contracts/project.schema.json",
    "tests/fixtures/minimal_scenario.json": "contracts/scenario.schema.json",
    "tests/fixtures/minimal_run.json": "contracts/run.schema.json",
    "tests/fixtures/minimal_result_smoke.json": "contracts/result.schema.json",
    "tests/fixtures/minimal_result_aviation_support.json": "contracts/result.schema.json",
    "tests/fixtures/minimal_artifact_manifest.json": "contracts/artifact_manifest.schema.json",
  };

  for (const fixturePath of manifest.fixture_files) {
    const schema = await readJson(fixtureSchemas[fixturePath]);
    const fixture = await readJson(fixturePath);
    assert.deepEqual(validateSchema(schema, fixture), [], `${fixturePath} drifted from ${fixtureSchemas[fixturePath]}`);
  }
});

test("scenario adapter mapping covers every compiled simulation input for each model family", async () => {
  const scenarioSchema = await readJson("contracts/scenario.schema.json");
  const mapping = await readJson("contracts/scenario_adapter_mapping.json");
  const scenarioInputs = Object.keys(scenarioSchema.properties.simulation_inputs.properties).sort();

  for (const [family, familyMapping] of Object.entries(mapping.model_families)) {
    const mappedInputs = Object.keys(familyMapping.simulation_inputs).sort();
    assert.deepEqual(mappedInputs, scenarioInputs, `${family} mapping does not cover every Scenario simulation input`);

    for (const [field, entry] of Object.entries(familyMapping.simulation_inputs)) {
      assert.equal(typeof entry.source, "string", `${family}.${field} is missing source`);
      assert.equal(typeof entry.constructor_param, "string", `${family}.${field} is missing constructor_param`);
    }
  }

  assert.equal(mapping.model_families.smoke.simulation_inputs.failure_rate.constructor_param, "failureRate");
  assert.equal(mapping.model_families.smoke.simulation_inputs.spare_multiplier.constructor_param, "spareMultiplier");
  assert.equal(mapping.model_families.smoke.simulation_inputs.support_capacity.constructor_param, "supportCapacity");
  assert.equal(mapping.model_families.aviation_support.simulation_inputs.aircraft_count.constructor_param, "aircraft_count");
  assert.equal(mapping.model_families.aviation_support.simulation_inputs.mission_count.constructor_param, "mission_count");
});

test("scenario schema rejects values the smoke model would silently coerce", async () => {
  const schema = await readJson("contracts/scenario.schema.json");
  const inputs = schema.properties.simulation_inputs.properties;

  assert.equal(inputs.aircraft_count.minimum, 1);
  assert.equal(inputs.mission_count.minimum, 1);
  assert.equal(inputs.support_capacity.minimum, 1);
  assert.equal(inputs.initial_spare_stock.minimum, 0);
});

test("result schema keeps smoke and aviation support metrics separated", async () => {
  const schema = await readJson("contracts/result.schema.json");
  const smokeRequired = requiredMetricSet(schema, "smoke");
  const aviationRequired = requiredMetricSet(schema, "aviation_support");

  assert.deepEqual(smokeRequired, new Set(["mission_success_rate", "spare_fill_rate"]));
  assert.deepEqual(
    aviationRequired,
    new Set([
      "sortie_completion_rate",
      "available_aircraft",
      "active_jobs",
      "spare_stock_total",
      "avg_departure_delay",
    ])
  );
  assert.equal(smokeRequired.has("sortie_completion_rate"), false);
  assert.equal(aviationRequired.has("mission_success_rate"), false);
});

test("aviation support result metrics stay aligned with visualization_state metric specs", async () => {
  const modelSource = await readText("src/spare_mvp_abm/aviation_support/model.py");
  const metricSpecMatch = modelSource.match(/metric_specs = \[([\s\S]*?)\n        \]/);
  assert.ok(metricSpecMatch, "could not find AviationSupportModel metric_specs");

  const sourceMetricIds = new Set(
    [...metricSpecMatch[1].matchAll(/\("([^"]+)"/g)].map((match) => match[1])
  );
  const schema = await readJson("contracts/result.schema.json");
  const aviationRequired = requiredMetricSet(schema, "aviation_support");

  for (const metricId of aviationRequired) {
    assert.ok(sourceMetricIds.has(metricId), `${metricId} is required by schema but absent from visualization_state metrics`);
  }
});

test("artifact manifest preserves run and scenario identity chain", async () => {
  const run = await readJson("tests/fixtures/minimal_run.json");
  const scenario = await readJson("tests/fixtures/minimal_scenario.json");
  const smokeResult = await readJson("tests/fixtures/minimal_result_smoke.json");
  const aviationResult = await readJson("tests/fixtures/minimal_result_aviation_support.json");
  const manifest = await readJson("tests/fixtures/minimal_artifact_manifest.json");
  const schema = await readJson("contracts/artifact_manifest.schema.json");

  assert.equal(run.scenario_id, scenario.scenario_id);
  assert.equal(run.scenario_version, scenario.scenario_version);
  assert.equal(manifest.run_id, run.run_id);
  assert.equal(manifest.scenario_id, scenario.scenario_id);
  assert.equal(manifest.scenario_version, scenario.scenario_version);
  assert.equal(run.artifact_manifest_id, manifest.artifact_manifest_id);
  for (const result of [smokeResult, aviationResult]) {
    assert.equal(result.run_id, run.run_id);
    assert.equal(result.scenario_id, scenario.scenario_id);
    assert.equal(result.scenario_version, scenario.scenario_version);
  }
  for (const artifact of manifest.artifacts) {
    assert.equal(artifact.path.startsWith("/"), false);
    assert.equal(artifact.path.includes(".."), false);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(schema.properties.artifacts.items.required.includes("sha256"));
});

test("governance keeps PR-B scoped to evaluator drift tests before adapter work", async () => {
  const governance = await readText("docs/simulation-service-governance.md");
  const plan = await readText("docs/superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md");

  assert.ok(governance.includes("| PR-B | Evaluator / Test Agent | 扩展 JSON Schema validation、Mesa contract smoke 和前后端字段漂移测试"));
  assert.match(plan, /### Task 2: Evaluator Drift Tests/);
  assert.match(plan, /任一字段名在前端、API、DB、Scenario 或结果页漂移时测试失败|drift/);
});
