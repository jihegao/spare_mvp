import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_JSON_CONTRACT } from "../front/project-json-contract.mjs";

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

function validateSchema(schema, value, path = "$") {
  const errors = [];
  collectSchemaErrors(schema, value, path, errors);
  return errors;
}

function collectSchemaErrors(schema, value, path, errors) {
  if (schema.oneOf) {
    const branchResults = schema.oneOf.map((branch) => validateSchema(branch, value, path));
    if (!branchResults.some((branchErrors) => branchErrors.length === 0)) {
      errors.push(`${path} did not match oneOf: ${branchResults.map((branchErrors) => branchErrors.join("; ")).join(" | ")}`);
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} expected one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}`);
  }

  if (schema.type && !matchesJsonType(schema.type, value)) {
    errors.push(`${path} expected type ${JSON.stringify(schema.type)}, got ${Array.isArray(value) ? "array" : typeof value}`);
    return;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} expected minimum ${schema.minimum}, got ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} expected maximum ${schema.maximum}, got ${value}`);
    }
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    const properties = schema.properties || {};
    for (const [key, childValue] of Object.entries(value)) {
      if (properties[key]) {
        collectSchemaErrors(properties[key], childValue, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => collectSchemaErrors(schema.items, item, `${path}[${index}]`, errors));
  }
}

function matchesJsonType(type, value) {
  if (Array.isArray(type)) {
    return type.some((item) => matchesJsonType(item, value));
  }
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type && !Array.isArray(value);
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
