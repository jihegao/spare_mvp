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

function resolveLocalRef(schema, ref) {
  assert.ok(ref.startsWith("#/"), `unexpected non-local ref ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((current, segment) => current?.[segment], schema);
}

async function scenarioInputProperties(scenarioSchema, family) {
  if (family === "aircraft_support_v1") {
    const inputSchema = await readJson("contracts/aircraft_support_v1_input.schema.json");
    return inputSchema.properties;
  }
  const selectorConst = "AviationSupportModelSelector";
  const branch = scenarioSchema.oneOf.find((candidate) => {
    const ref = candidate.properties?.simulation_model?.$ref;
    return ref && ref.endsWith(`/${selectorConst}`);
  });
  const inputRef = branch?.properties?.simulation_inputs?.$ref;
  assert.ok(inputRef, `missing scenario input branch for ${family}`);
  return resolveLocalRef(scenarioSchema, inputRef).properties;
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

test("project schema keeps airports as string inputs", async () => {
  const schema = await readJson("contracts/project.schema.json");
  const stringAirportProject = structuredClone(defaultScenario);
  stringAirportProject.airports = ["A", "B"];
  const objectAirportProject = structuredClone(defaultScenario);
  objectAirportProject.airports = [{ id: "airport-a", name: "A" }];

  assert.deepEqual(validateSchema(schema, stringAirportProject), []);
  assert.notDeepEqual(validateSchema(schema, objectAirportProject), []);
});

test("schema manifest lists every checked fixture and each fixture validates", async () => {
  const manifest = await readJson("contracts/README.md.json");
  const expectedFixtures = [
    "tests/fixtures/aviation_support_project.json",
    "tests/fixtures/aviation_support_scenario.json",
    "tests/fixtures/aviation_support_run.json",
    "tests/fixtures/aviation_support_result.json",
    "tests/fixtures/aviation_support_artifact_manifest.json",
  ];

  assert.deepEqual(manifest.fixture_files, expectedFixtures);

  const fixtureSchemas = {
    "tests/fixtures/aviation_support_project.json": "contracts/project.schema.json",
    "tests/fixtures/aviation_support_scenario.json": "contracts/scenario.schema.json",
    "tests/fixtures/aviation_support_run.json": "contracts/run.schema.json",
    "tests/fixtures/aviation_support_result.json": "contracts/result.schema.json",
    "tests/fixtures/aviation_support_artifact_manifest.json": "contracts/artifact_manifest.schema.json",
  };

  for (const fixturePath of manifest.fixture_files) {
    const schema = await readJson(fixtureSchemas[fixturePath]);
    const fixture = await readJson(fixturePath);
    assert.deepEqual(validateSchema(schema, fixture), [], `${fixturePath} drifted from ${fixtureSchemas[fixturePath]}`);
  }
});

test("schema manifest traces Result contracts to normalized model snapshots", async () => {
  const manifest = await readJson("contracts/README.md.json");
  assert.deepEqual(manifest.source_inputs, [
    "src/spare_mvp_abm/aviation_support/model.py snapshot()",
    "Simulation Adapter Result normalization",
  ]);
  assert.equal(manifest.source_inputs.some((source) => source.includes("visualization_state()")), false);
  assert.equal(manifest.source_inputs.some((source) => source.includes("ontology_mapping()")), false);
});

test("schema validator rejects null for object-typed values", () => {
  const schema = {
    type: "object",
    required: ["payload"],
    properties: {
      payload: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };

  const errors = validateSchema(schema, { payload: null });
  assert.ok(errors.some((error) => error.includes("$.payload expected type \"object\"")));
});

test("scenario adapter mapping covers every compiled simulation input for each model family", async () => {
  const scenarioSchema = await readJson("contracts/scenario.schema.json");
  const mapping = await readJson("contracts/scenario_adapter_mapping.json");

  for (const [family, familyMapping] of Object.entries(mapping.model_families)) {
    const scenarioInputs = Object.keys(await scenarioInputProperties(scenarioSchema, family)).sort();
    const mappedInputs = Object.keys(familyMapping.simulation_inputs).sort();
    assert.deepEqual(mappedInputs, scenarioInputs, `${family} mapping does not cover every Scenario simulation input`);

    for (const [field, entry] of Object.entries(familyMapping.simulation_inputs)) {
      assert.equal(typeof entry.source, "string", `${family}.${field} is missing source`);
      if (entry.status === "unsupported") {
        assert.equal(entry.constructor_param, undefined, `${family}.${field} must not expose an executable constructor_param before alignment`);
        assert.equal(typeof entry.reason, "string", `${family}.${field} is missing unsupported reason`);
      } else if (entry.status === "metadata_only" || entry.status === "governance_only") {
        assert.equal(entry.constructor_param, undefined, `${family}.${field} must not expose an executable constructor_param`);
        assert.equal(typeof entry.reason, "string", `${family}.${field} is missing non-executable reason`);
      } else {
        assert.equal(typeof entry.constructor_param, "string", `${family}.${field} is missing constructor_param`);
      }
    }
  }

  assert.equal(mapping.model_families.aviation_support.simulation_inputs.aircraft_count.constructor_param, "aircraft_count");
  assert.equal(
    mapping.model_families.aviation_support.simulation_inputs.lru_failure_multiplier.constructor_param,
    "lru_failure_multiplier"
  );
  assert.equal(mapping.model_families.aviation_support.simulation_inputs.maintenance_bays.constructor_param, "maintenance_bays");
  assert.equal(mapping.model_families.aviation_support.simulation_inputs.mission_count.constructor_param, "mission_count");
});

test("aviation mapping exposes approved formal execution constructor rules", async () => {
  const mapping = await readJson("contracts/scenario_adapter_mapping.json");
  const aviationInputs = mapping.model_families.aviation_support.simulation_inputs;

  for (const field of ["mechanic_teams", "fuel_trucks", "maintenance_bays", "lru_failure_multiplier"]) {
    assert.equal(aviationInputs[field].status, undefined, `${field} should be executable after M9.4 alignment`);
    assert.equal(aviationInputs[field].constructor_param, field, `${field} should publish its constructor mapping`);
    assert.equal(typeof aviationInputs[field].source, "string");
  }
});

test("aircraft support mapping keeps identity metadata separate from formal Monte Carlo config", async () => {
  const mapping = await readJson("contracts/scenario_adapter_mapping.json");
  const inputs = mapping.model_families.aircraft_support_v1.simulation_inputs;

  assert.equal(inputs.schema_version.status, "metadata_only");
  assert.equal(inputs.schema_version.constructor_param, undefined);
  assert.equal(inputs.project_identity.status, "governance_only");
  assert.equal(inputs.project_identity.constructor_param, undefined);
  assert.match(inputs.project_identity.reason, /do not change simulation dynamics/);
  assert.match(inputs.monte_carlo.source, /ExperimentPlan\.config\.analysisRequests\.largeSample/);
  assert.doesNotMatch(inputs.monte_carlo.source, /project\.monteCarlo/);
});

test("scenario schema no longer includes the retired smoke branch", async () => {
  const schema = await readJson("contracts/scenario.schema.json");

  assert.equal(schema.$defs.SmokeModelSelector, undefined);
  assert.equal(schema.$defs.SmokeInputs, undefined);
  assert.deepEqual(schema.properties.simulation_model.properties.family.enum, ["aviation_support", "aircraft_support_v1"]);
  assert.deepEqual(schema.properties.simulation_model.properties.model_id.enum, ["AviationSupportModel", "AircraftSupportV1Model"]);
});

test("schema selectors label aviation_support as legacy contract evidence", async () => {
  const scenarioSchema = await readJson("contracts/scenario.schema.json");
  const runSchema = await readJson("contracts/run.schema.json");
  const legacyText = [
    scenarioSchema.$defs.AviationSupportModelSelector.description,
    scenarioSchema.$defs.AviationSupportInputs.description,
    scenarioSchema.properties.simulation_model.properties.family.description,
    scenarioSchema.properties.simulation_model.properties.model_id.description,
    runSchema.properties.model_family.description,
    runSchema.properties.model_id.description,
  ].join("\n");

  assert.match(legacyText, /aviation_support/);
  assert.match(legacyText, /legacy contract evidence/);
  assert.match(legacyText, /retired formal runtime/);
  assert.match(legacyText, /aircraft_support_v1/);
});

test("result schema keeps aviation support metrics scoped to historical fixtures", async () => {
  const schema = await readJson("contracts/result.schema.json");
  const aviationRequired = requiredMetricSet(schema, "aviation_support");

  assert.equal(oneOfBranch(schema, "smoke"), undefined);
  assert.deepEqual(schema.properties.model_family.enum, ["aviation_support", "aircraft_support_v1"]);
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
  assert.equal(aviationRequired.has("mission_success_rate"), false);
});

test("aviation support result metrics stay aligned with snapshot fields", async () => {
  const modelSource = await readText("src/spare_mvp_abm/aviation_support/model.py");
  const snapshotMatch = modelSource.match(/def snapshot\(self\) -> dict:[\s\S]*?return \{([\s\S]*?)\n        \}/);
  assert.ok(snapshotMatch, "could not find AviationSupportModel snapshot return fields");

  const sourceMetricIds = new Set(
    [...snapshotMatch[1].matchAll(/"([^"]+)":/g)].map((match) => match[1])
  );
  const schema = await readJson("contracts/result.schema.json");
  const aviationRequired = requiredMetricSet(schema, "aviation_support");

  for (const metricId of aviationRequired) {
    assert.ok(sourceMetricIds.has(metricId), `${metricId} is required by schema but absent from snapshot()`);
  }
});

test("artifact manifest preserves run and scenario identity chain", async () => {
  const schema = await readJson("contracts/artifact_manifest.schema.json");

  for (const family of ["aviation_support"]) {
    const run = await readJson(`tests/fixtures/${family}_run.json`);
    const scenario = await readJson(`tests/fixtures/${family}_scenario.json`);
    const result = await readJson(`tests/fixtures/${family}_result.json`);
    const manifest = await readJson(`tests/fixtures/${family}_artifact_manifest.json`);

    assert.equal(run.scenario_id, scenario.scenario_id);
    assert.equal(run.scenario_version, scenario.scenario_version);
    assert.equal(manifest.run_id, run.run_id);
    assert.equal(manifest.scenario_id, scenario.scenario_id);
    assert.equal(manifest.scenario_version, scenario.scenario_version);
    assert.equal(run.artifact_manifest_id, manifest.artifact_manifest_id);
    assert.equal(result.run_id, run.run_id);
    assert.equal(result.result_id, run.result_summary_id);
    assert.equal(result.scenario_id, scenario.scenario_id);
    assert.equal(result.scenario_version, scenario.scenario_version);
    assert.equal(run.model_family, scenario.simulation_model.family);
    assert.equal(run.model_id, scenario.simulation_model.model_id);
    assert.equal(run.model_family, result.model_family);
    for (const artifact of manifest.artifacts) {
      assert.equal(artifact.path.startsWith("/"), false);
      assert.equal(artifact.path.includes(".."), false);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    }
  }
  assert.ok(schema.properties.artifacts.items.required.includes("sha256"));
});

test("archived governance keeps historical PR-B scope available for reference", async () => {
  const governance = await readText("docs/archive/deprecated/simulation-service-governance.md");
  const plan = await readText("docs/archive/deprecated/superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md");

  assert.match(governance, /状态：已过期/);
  assert.ok(governance.includes("| PR-B | Evaluator / Test Agent | 扩展 JSON Schema validation、Mesa contract smoke 和前后端字段漂移测试"));
  assert.match(plan, /### Task 2: Evaluator Drift Tests/);
  assert.match(plan, /任一字段名在前端、API、DB、Scenario 或结果页漂移时测试失败|drift/);
});
