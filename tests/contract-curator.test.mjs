import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_JSON_CONTRACT } from "../front/project-json-contract.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

const contractFiles = [
  "project.schema.json",
  "scenario.schema.json",
  "run.schema.json",
  "result.schema.json",
  "artifact_manifest.schema.json",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("simulation service governance defines the six-agent swarm execution plan", async () => {
  const doc = await readFile(new URL("../docs/simulation-service-governance.md", import.meta.url), "utf8");

  for (const agentName of [
    "Contract Curator Agent",
    "Simulation Adapter Agent",
    "Backend API Agent",
    "Database Agent",
    "Frontend Integration Agent",
    "Evaluator / Test Agent",
  ]) {
    assert.match(doc, new RegExp(agentName.replace("/", "\\/")));
  }

  assert.match(doc, /PR-A[\s\S]*Contract Curator/);
  assert.match(doc, /PR-G[\s\S]*Evaluator/);
  assert.match(doc, /Project JSON[\s\S]*Scenario JSON[\s\S]*Simulation Adapter/);
});

test("contract curator publishes the versioned schema bundle", async () => {
  const manifest = await readJson("contracts/README.md.json");
  assert.equal(manifest.schema_version, "spare-mvp-contracts-v0");
  assert.deepEqual(manifest.schema_files, contractFiles);

  for (const file of contractFiles) {
    const schema = await readJson(`contracts/${file}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, new RegExp(`/contracts/${file}$`));
    assert.equal(typeof schema.title, "string");
    assert.equal(typeof schema.type, "string");
    assert.ok(schema.properties.schema_version);
  }

  const mapping = await readJson("contracts/scenario_adapter_mapping.json");
  assert.deepEqual(manifest.mapping_files, ["scenario_adapter_mapping.json"]);
  assert.equal(mapping.schema_version, "scenario-adapter-mapping-v0");
});

test("project schema covers required frontend project JSON contract objects", async () => {
  const schema = await readJson("contracts/project.schema.json");
  const schemaFields = new Set(Object.keys(schema.properties));
  const requiredProjectRoots = PROJECT_JSON_CONTRACT.objects
    .filter((object) => object.required && !object.path.includes("."))
    .map((object) => object.path);

  for (const root of requiredProjectRoots) {
    assert.ok(schemaFields.has(root), `missing project schema property for ${root}`);
  }
});

test("scenario and result schemas preserve simulation contract boundaries", async () => {
  const scenarioSchema = await readJson("contracts/scenario.schema.json");
  const resultSchema = await readJson("contracts/result.schema.json");
  const runSchema = await readJson("contracts/run.schema.json");
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");

  assert.deepEqual(scenarioSchema.required, [
    "schema_version",
    "scenario_id",
    "project_id",
    "scenario_version",
    "compiled_from",
    "simulation_inputs",
  ]);
  assert.ok(scenarioSchema.properties.compiled_from.properties.project_schema_version);
  assert.ok(resultSchema.properties.model_family);
  assert.ok(resultSchema.properties.metrics.properties.mission_success_rate);
  assert.ok(resultSchema.properties.metrics.properties.sortie_completion_rate);
  assert.ok(runSchema.properties.artifact_manifest_id);
  assert.ok(artifactSchema.properties.artifacts.items.properties.sha256);
});

test("minimal contract fixtures validate against their schemas", async () => {
  const fixturePairs = [
    ["contracts/project.schema.json", "tests/fixtures/minimal_project.json"],
    ["contracts/scenario.schema.json", "tests/fixtures/minimal_scenario.json"],
    ["contracts/run.schema.json", "tests/fixtures/minimal_run.json"],
    ["contracts/result.schema.json", "tests/fixtures/minimal_result_smoke.json"],
    ["contracts/result.schema.json", "tests/fixtures/minimal_result_aviation_support.json"],
    ["contracts/artifact_manifest.schema.json", "tests/fixtures/minimal_artifact_manifest.json"],
  ];

  for (const [schemaPath, fixturePath] of fixturePairs) {
    const schema = await readJson(schemaPath);
    const fixture = await readJson(fixturePath);
    assert.deepEqual(validateSchema(schema, fixture), [], `${fixturePath} should validate against ${schemaPath}`);
  }
});

test("scenario schema rejects inputs that SmokeSpareMvpModel would coerce upward", async () => {
  const schema = await readJson("contracts/scenario.schema.json");
  const fixture = await readJson("tests/fixtures/minimal_scenario.json");
  const invalidScenario = {
    ...fixture,
    simulation_inputs: {
      ...fixture.simulation_inputs,
      aircraft_count: 0,
      mission_count: 0,
      support_capacity: 0,
    },
  };

  const errors = validateSchema(schema, invalidScenario);
  assert.ok(errors.some((error) => error.includes("$.simulation_inputs.aircraft_count expected minimum 1")));
  assert.ok(errors.some((error) => error.includes("$.simulation_inputs.mission_count expected minimum 1")));
  assert.ok(errors.some((error) => error.includes("$.simulation_inputs.support_capacity expected minimum 1")));
});
