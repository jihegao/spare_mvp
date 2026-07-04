import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_JSON_CONTRACT } from "../front/project-json-contract.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

const contractFiles = [
  "project.schema.json",
  "scenario.schema.json",
  "aircraft_support_v1_input.schema.json",
  "run.schema.json",
  "result.schema.json",
  "artifact_manifest.schema.json",
  "visualization_state_series.schema.json",
];

const M6_2_SIMULATION_EXPERIMENT_BASE_FIELDS = [
  "experiment_id",
  "experiment_type",
  "module",
  "experiment_plan_id",
  "scenario_id",
  "seed",
  "status",
  "progress",
  "run_id",
  "artifact_manifest_id"
];

const M6_2_MONTE_CARLO_ARTIFACT_KINDS = [
  "monte_carlo_base",
  "analysis_projection_spare_shortfall",
  "analysis_projection_carry_list",
  "analysis_projection_mission_reliability",
  "analysis_projection_downtime_factors"
];

const RUN_SERVICE_STATUS_FIELDS = [
  "modeling_snapshot_id",
  "project_version",
  "project_schema_version",
  "scenario_schema_version",
  "phase",
  "queued_at"
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("simulation service governance is archived as deprecated historical context", async () => {
  const doc = await readFile(new URL("../docs/archive/deprecated/simulation-service-governance.md", import.meta.url), "utf8");

  assert.match(doc, /状态：已过期/);
  assert.match(doc, /Simulation-Contract-First Development/);
  assert.match(doc, /仅作历史参考|历史模式/);
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
  assert.ok(mapping.model_families.aircraft_support_v1);
  assert.equal(mapping.model_families.aircraft_support_v1.model_class, "AircraftSupportV1Model");
  assert.ok(mapping.model_families.aircraft_support_v1.simulation_inputs.equipment_tree);
  assert.ok(mapping.model_families.aircraft_support_v1.simulation_inputs.support_activities);
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
  assert.ok(schema.required.includes("basicMissions"));
  assert.equal(schema.required.includes("basicMission"), false);
  assert.equal(Object.hasOwn(schema.properties, "basicMission"), false);
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
    "simulation_model",
    "compiled_from",
    "simulation_inputs",
  ]);
  assert.ok(scenarioSchema.properties.simulation_model.properties.family);
  assert.equal(scenarioSchema.oneOf.length, 3);
  assert.match(JSON.stringify(scenarioSchema), /aircraft_support_v1_input\.schema\.json/);
  assert.ok(scenarioSchema.properties.simulation_model.properties.family.enum.includes("aircraft_support_v1"));
  assert.ok(scenarioSchema.properties.simulation_model.properties.model_id.enum.includes("AircraftSupportV1Model"));
  assert.ok(runSchema.required.includes("model_family"));
  assert.ok(runSchema.required.includes("model_id"));
  assert.ok(runSchema.properties.model_family);
  assert.ok(runSchema.properties.model_id);
  assert.ok(runSchema.properties.model_family.enum.includes("aircraft_support_v1"));
  assert.ok(runSchema.properties.model_id.enum.includes("AircraftSupportV1Model"));
  const inputSchema = await readJson("contracts/aircraft_support_v1_input.schema.json");
  assert.ok(inputSchema.properties.support_activities);
  assert.ok(inputSchema.properties.time);
  assert.ok(inputSchema.properties.monte_carlo);
  assert.ok(scenarioSchema.properties.compiled_from.properties.project_schema_version);
  assert.ok(resultSchema.properties.model_family);
  assert.ok(resultSchema.properties.metrics.properties.mission_success_rate);
  assert.ok(resultSchema.properties.metrics.properties.sortie_completion_rate);
  assert.ok(runSchema.properties.artifact_manifest_id);
  assert.ok(artifactSchema.properties.artifacts.items.properties.sha256);
});

test("M6.2 run schema exposes formal monte carlo and shared SimulationExperimentBase fields", async () => {
  const runSchema = await readJson("contracts/run.schema.json");

  assert.ok(runSchema.properties.run_type.enum.includes("monte_carlo"));
  for (const field of RUN_SERVICE_STATUS_FIELDS) {
    assert.ok(runSchema.properties[field], `run schema must define persisted RunService field ${field}`);
  }
  assert.ok(runSchema.properties.model_id.enum.includes("ScenarioCompilerGate"));
  assert.ok(runSchema.$defs?.SimulationExperimentBase, "run schema must define SimulationExperimentBase");
  for (const field of M6_2_SIMULATION_EXPERIMENT_BASE_FIELDS) {
    assert.ok(
      runSchema.$defs.SimulationExperimentBase.required.includes(field),
      `SimulationExperimentBase must require ${field}`
    );
    assert.ok(
      runSchema.$defs.SimulationExperimentBase.properties[field],
      `SimulationExperimentBase must define ${field}`
    );
  }
  assert.ok(runSchema.$defs.SimulationExperimentBase.properties.scenario_version);
  assert.ok(runSchema.$defs.SimulationExperimentBase.properties.mapping_provenance);
});

test("M6.2 run schema validates the persisted formal monte carlo status payload", async () => {
  const runSchema = await readJson("contracts/run.schema.json");
  const run = {
    schema_version: "run-v0",
    run_id: "run-mc-contract-001",
    project_id: "project-smoke-contract",
    experiment_plan_id: "plan-smoke-contract",
    modeling_snapshot_id: "snapshot-smoke-contract",
    project_version: "project-v0.1",
    project_schema_version: "project-v0",
    scenario_id: "scenario-smoke-contract-001",
    scenario_version: "scenario-v0.1",
    scenario_schema_version: "scenario-v0",
    model_family: "smoke",
    model_id: "SmokeSpareMvpModel",
    status: "succeeded",
    phase: "completed",
    run_type: "monte_carlo",
    experiment_id: "experiment-run-mc-contract-001",
    experiment_type: "monte_carlo",
    mc_experiment_id: "mc-contract-001",
    seed: 42,
    progress: 1,
    queued_at: "2026-06-20T00:00:00Z",
    started_at: "2026-06-20T00:00:00Z",
    completed_at: "2026-06-20T00:00:00Z",
    result_summary_id: "result-run-mc-contract-001",
    artifact_manifest_id: "artifact-manifest-run-mc-contract-001",
    simulation_experiment_base: {
      experiment_id: "experiment-run-mc-contract-001",
      experiment_type: "monte_carlo",
      module: "ship_front",
      project_id: "project-smoke-contract",
      experiment_plan_id: "plan-smoke-contract",
      modeling_snapshot_id: "snapshot-smoke-contract",
      scenario_id: "scenario-smoke-contract-001",
      scenario_version: "scenario-v0.1",
      scenario_schema_version: "scenario-v0",
      mapping_provenance: { mapping_version: "scenario-adapter-mapping-v0" },
      seed: 42,
      status: "succeeded",
      progress: 1,
      run_id: "run-mc-contract-001",
      artifact_manifest_id: "artifact-manifest-run-mc-contract-001",
      mc_experiment_id: "mc-contract-001",
      artifact_ids: ["artifact-mc-base-001", "artifact-spare-shortfall-001"]
    },
    error: null
  };

  assert.deepEqual(validateSchema(runSchema, run), []);
});

test("M6.2 artifact manifest schema accepts monte carlo base and four analysis projections", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const kindEnum = artifactSchema.properties.artifacts.items.properties.kind.enum;

  for (const kind of M6_2_MONTE_CARLO_ARTIFACT_KINDS) {
    assert.ok(kindEnum.includes(kind), `artifact kind enum must include ${kind}`);
  }

  const projectionProperties = artifactSchema.properties.artifacts.items.properties;
  assert.ok(projectionProperties.source_artifact_id, "projection artifact must link to the monte_carlo_base artifact");
  assert.ok(projectionProperties.analysis_type, "projection artifact must identify the analysis projection type");
  assert.ok(artifactSchema.properties.artifacts.items.allOf?.length >= 4, "projection artifacts must conditionally require provenance fields");
});

test("M9.1 visualization state-series schema validates traceable frame events", async () => {
  const schema = await readJson("contracts/visualization_state_series.schema.json");
  const fixture = await readJson("tests/fixtures/smoke_visualization_state_series.json");

  assert.deepEqual(validateSchema(schema, fixture), []);
  assert.equal(fixture.schema_version, "visualization-state-series-v0");
  assert.equal(fixture.frames[0].run_id, fixture.run_id);
  assert.ok(fixture.frames.every((frame, index) => frame.step === index), "fixture steps must be monotonic and contiguous");

  for (const frame of fixture.frames) {
    assert.equal(frame.trace.run_id, fixture.run_id);
    assert.equal(frame.trace.scenario_id, fixture.scenario_id);
    assert.equal(frame.trace.result_summary_id, fixture.result_summary_id);
    assert.equal(frame.trace.artifact_manifest_id, fixture.artifact_manifest_id);
    assert.ok(frame.events.every((event) => event.event_id && event.run_id === fixture.run_id && event.step === frame.step));
  }
});

test("M9.1 artifact manifest schema requires state-series artifact provenance", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const manifest = {
    schema_version: "artifact-manifest-v0",
    artifact_manifest_id: "artifact-manifest-run-state-series-contract",
    run_id: "run-state-series-contract",
    scenario_id: "scenario-state-series-contract",
    scenario_version: "scenario-v0.1",
    artifacts: [
      {
        artifact_id: "visualization_state_series-run-state-series-contract",
        kind: "visualization_state_series",
        path: "run-state-series-contract/visualization-state-series.json",
        media_type: "application/json",
        sha256: "3".repeat(64),
        size_bytes: 4096,
        schema_version: "visualization-state-series-v0",
        source_run_id: "run-state-series-contract",
        source_result_summary_id: "result-run-state-series-contract",
        source_scenario_id: "scenario-state-series-contract"
      }
    ]
  };

  assert.deepEqual(validateSchema(artifactSchema, manifest), []);

  delete manifest.artifacts[0].source_run_id;
  const errors = validateSchema(artifactSchema, manifest);
  assert.ok(errors.some((error) => error.includes("source_run_id is required")));
});

test("M6.2 formal monte carlo manifest fixture shape validates against artifact schema", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const manifest = {
    schema_version: "artifact-manifest-v0",
    artifact_manifest_id: "artifact-manifest-run-mc-contract-001",
    run_id: "run-mc-contract-001",
    scenario_id: "scenario-smoke-contract-001",
    scenario_version: "scenario-v0.1",
    artifacts: [
      {
        artifact_id: "artifact-mc-base-001",
        kind: "monte_carlo_base",
        path: "runs/run-mc-contract-001/monte-carlo-base.json",
        media_type: "application/json",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        size_bytes: 1024,
        schema_version: "monte-carlo-artifact-v0"
      },
      ...[
        ["analysis_projection_spare_shortfall", "spare_shortfall"],
        ["analysis_projection_carry_list", "carry_list"],
        ["analysis_projection_mission_reliability", "mission_reliability"],
        ["analysis_projection_downtime_factors", "downtime_factors"]
      ].map(([kind, analysisType]) => ({
        artifact_id: `artifact-${analysisType}-001`,
        kind,
        analysis_type: analysisType,
        source_artifact_id: "artifact-mc-base-001",
        path: `runs/run-mc-contract-001/${analysisType}.json`,
        media_type: "application/json",
        sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        size_bytes: 512,
        schema_version: "analysis-projection-v0"
      }))
    ]
  };

  assert.deepEqual(validateSchema(artifactSchema, manifest), []);
});

test("M6.2 artifact manifest schema rejects untraceable analysis projections", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const manifest = {
    schema_version: "artifact-manifest-v0",
    artifact_manifest_id: "artifact-manifest-run-mc-contract-002",
    run_id: "run-mc-contract-002",
    artifacts: [
      {
        artifact_id: "artifact-bad-projection-001",
        kind: "analysis_projection_spare_shortfall",
        path: "runs/run-mc-contract-002/spare-shortfall.json",
        media_type: "application/json",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222"
      }
    ]
  };

  const errors = validateSchema(artifactSchema, manifest);
  assert.notDeepEqual(errors, []);
  assert.ok(errors.some((error) => error.includes("source_artifact_id is required")));
  assert.ok(errors.some((error) => error.includes("analysis_type is required")));
});

test("artifact manifest schema rejects an artifact entry without size_bytes", async () => {
  const artifactSchema = await readJson("contracts/artifact_manifest.schema.json");
  const manifest = {
    schema_version: "artifact-manifest-v0",
    artifact_manifest_id: "artifact-manifest-missing-size",
    run_id: "run-missing-size",
    artifacts: [
      {
        artifact_id: "artifact-missing-size",
        kind: "run_config",
        path: "run-missing-size/run-config.json",
        media_type: "application/json",
        sha256: "0".repeat(64),
        schema_version: "run-config-v0"
      }
    ]
  };

  const errors = validateSchema(artifactSchema, manifest);
  assert.ok(errors.some((error) => error.includes("size_bytes")));
});

test("minimal contract fixtures validate against their schemas", async () => {
  const fixturePairs = [
    ["contracts/project.schema.json", "tests/fixtures/smoke_project.json"],
    ["contracts/scenario.schema.json", "tests/fixtures/smoke_scenario.json"],
    ["contracts/run.schema.json", "tests/fixtures/smoke_run.json"],
    ["contracts/result.schema.json", "tests/fixtures/smoke_result.json"],
    ["contracts/artifact_manifest.schema.json", "tests/fixtures/smoke_artifact_manifest.json"],
    ["contracts/visualization_state_series.schema.json", "tests/fixtures/smoke_visualization_state_series.json"],
    ["contracts/project.schema.json", "tests/fixtures/aviation_support_project.json"],
    ["contracts/scenario.schema.json", "tests/fixtures/aviation_support_scenario.json"],
    ["contracts/run.schema.json", "tests/fixtures/aviation_support_run.json"],
    ["contracts/result.schema.json", "tests/fixtures/aviation_support_result.json"],
    ["contracts/artifact_manifest.schema.json", "tests/fixtures/aviation_support_artifact_manifest.json"],
  ];

  for (const [schemaPath, fixturePath] of fixturePairs) {
    const schema = await readJson(schemaPath);
    const fixture = await readJson(fixturePath);
    assert.deepEqual(validateSchema(schema, fixture), [], `${fixturePath} should validate against ${schemaPath}`);
  }
});

test("minimal contract fixtures form a consistent end-to-end object graph", async () => {
  for (const family of ["smoke", "aviation_support"]) {
    const project = await readJson(`tests/fixtures/${family}_project.json`);
    const scenario = await readJson(`tests/fixtures/${family}_scenario.json`);
    const run = await readJson(`tests/fixtures/${family}_run.json`);
    const result = await readJson(`tests/fixtures/${family}_result.json`);
    const manifest = await readJson(`tests/fixtures/${family}_artifact_manifest.json`);

    assert.equal(scenario.project_id, project.project_id);
    assert.equal(run.scenario_id, scenario.scenario_id);
    assert.equal(result.run_id, run.run_id);
    assert.equal(result.result_id, run.result_summary_id);
    assert.equal(manifest.run_id, run.run_id);
    assert.equal(result.model_family, scenario.simulation_model.family);
    assert.equal(run.model_family, scenario.simulation_model.family);
    assert.equal(run.model_id, scenario.simulation_model.model_id);
    assert.equal(run.model_family, result.model_family);
  }
});

test("scenario schema rejects mismatched model selector and simulation inputs", async () => {
  const schema = await readJson("contracts/scenario.schema.json");
  const smokeScenario = await readJson("tests/fixtures/smoke_scenario.json");
  const aviationScenario = await readJson("tests/fixtures/aviation_support_scenario.json");

  const smokeModelWithAviationInputs = {
    ...smokeScenario,
    simulation_inputs: aviationScenario.simulation_inputs,
  };
  const aviationFamilyWithSmokeModelId = {
    ...aviationScenario,
    simulation_model: {
      ...aviationScenario.simulation_model,
      model_id: "SmokeSpareMvpModel",
    },
  };

  assert.notDeepEqual(validateSchema(schema, smokeModelWithAviationInputs), []);
  assert.notDeepEqual(validateSchema(schema, aviationFamilyWithSmokeModelId), []);
});

test("scenario schema rejects inputs that SmokeSpareMvpModel would coerce upward", async () => {
  const schema = await readJson("contracts/scenario.schema.json");
  const fixture = await readJson("tests/fixtures/smoke_scenario.json");
  const invalidScenario = {
    ...fixture,
    simulation_inputs: {
      ...fixture.simulation_inputs,
      support_capacity: 0,
      min_required_sorties: 0,
    },
  };

  const errors = validateSchema(schema, invalidScenario);
  assert.ok(errors.some((error) => error.includes("$.simulation_inputs.support_capacity expected minimum 1")));
  assert.ok(errors.some((error) => error.includes("$.simulation_inputs.min_required_sorties expected minimum 1")));
});
