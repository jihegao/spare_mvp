import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_JSON_CONTRACT } from "../front/project-json-contract.mjs";
import { validateSchema } from "./schema-test-utils.mjs";

const contractFiles = [
  "project.schema.json",
  "aircraft_support_v1_project.schema.json",
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
  assert.equal(scenarioSchema.oneOf.length, 1);
  assert.match(JSON.stringify(scenarioSchema), /aircraft_support_v1_input\.schema\.json/);
  assert.equal(scenarioSchema.properties.simulation_model.properties.family.const, "aircraft_support_v1");
  assert.equal(scenarioSchema.properties.simulation_model.properties.model_id.const, "AircraftSupportV1Model");
  assert.ok(runSchema.required.includes("model_family"));
  assert.ok(runSchema.required.includes("model_id"));
  assert.ok(runSchema.properties.model_family);
  assert.ok(runSchema.properties.model_id);
  assert.equal(runSchema.properties.model_family.const, "aircraft_support_v1");
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
    project_id: "project-aircraft-support-contract",
    experiment_plan_id: "plan-aircraft-support-contract",
    modeling_snapshot_id: "snapshot-aircraft-support-contract",
    project_version: "project-v0.1",
    project_schema_version: "project-v0",
    scenario_id: "scenario-aircraft-support-contract-001",
    scenario_version: "scenario-v0.1",
    scenario_schema_version: "scenario-v0",
    model_family: "aircraft_support_v1",
    model_id: "AircraftSupportV1Model",
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
      project_id: "project-aircraft-support-contract",
      experiment_plan_id: "plan-aircraft-support-contract",
      modeling_snapshot_id: "snapshot-aircraft-support-contract",
      scenario_id: "scenario-aircraft-support-contract-001",
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
  const fixture = {
    schema_version: "visualization-state-series-v0",
    run_id: "run-aircraft-support-contract-001",
    scenario_id: "scenario-aircraft-support-contract-001",
    scenario_version: "scenario-v0.1",
    model_family: "aircraft_support_v1",
    artifact_manifest_id: "artifact-manifest-aircraft-support-contract-001",
    result_summary_id: "result-aircraft-support-contract-001",
    run_config_artifact_id: "run_config-run-aircraft-support-contract-001",
    input_project_artifact_id: "input_project-run-aircraft-support-contract-001",
    compiled_scenario_artifact_id: "compiled_scenario-run-aircraft-support-contract-001",
    frames: [
      {
        run_id: "run-aircraft-support-contract-001",
        step: 0,
        simulation_time: 0,
        aircraft_state: { ready_rate: 1, failed_count: 0, repairing_count: 0, sortie_count: 0 },
        mission_state: { mission_success_rate: 1, sortie_rate: 1, mean_launch_time: 0, mean_recovery_time: 0, mean_turnaround_time: 0 },
        resource_state: { spare_fill_rate: 1, spare_utilization: 0, repair_backlog: 0 },
        event_summary: { shortage_events: 0, downtime_failure_events: 0, downtime_spare_shortage_events: 0, downtime_resource_delay_events: 0 },
        aircraft: [],
        missions: [],
        resources: [],
        spares: [],
        jobs: [],
        events: [
          {
            event_id: "run-aircraft-support-contract-001-step-0-0-state_frame",
            run_id: "run-aircraft-support-contract-001",
            step: 0,
            event: "state_frame",
            event_type: "state_frame",
            time: 0,
            message: "state frame generated",
            metric_refs: ["ready_rate"]
          }
        ],
        trace: {
          run_id: "run-aircraft-support-contract-001",
          scenario_id: "scenario-aircraft-support-contract-001",
          scenario_version: "scenario-v0.1",
          result_summary_id: "result-aircraft-support-contract-001",
          artifact_manifest_id: "artifact-manifest-aircraft-support-contract-001",
          run_config_artifact_id: "run_config-run-aircraft-support-contract-001",
          input_project_artifact_id: "input_project-run-aircraft-support-contract-001",
          compiled_scenario_artifact_id: "compiled_scenario-run-aircraft-support-contract-001"
        }
      }
    ]
  };

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
    scenario_id: "scenario-aircraft-support-contract-001",
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

test("current aircraft_support_v1 contract fixtures validate against their schemas", async () => {
  const fixturePairs = [
    ["contracts/project.schema.json", "tests/fixtures/aircraft_support_v1_project.json"],
    ["contracts/scenario.schema.json", "tests/fixtures/aircraft_support_v1_scenario.json"],
    ["contracts/run.schema.json", "tests/fixtures/aircraft_support_v1_run.json"],
    ["contracts/result.schema.json", "tests/fixtures/aircraft_support_v1_result.json"],
    ["contracts/artifact_manifest.schema.json", "tests/fixtures/aircraft_support_v1_artifact_manifest.json"],
  ];

  for (const [schemaPath, fixturePath] of fixturePairs) {
    const schema = await readJson(schemaPath);
    const fixture = await readJson(fixturePath);
    const referencedSchemas = fixturePath.endsWith("_scenario.json")
      ? {
          "https://spare-mvp.local/contracts/aircraft_support_v1_input.schema.json": await readJson(
            "contracts/aircraft_support_v1_input.schema.json"
          ),
        }
      : {};
    assert.deepEqual(
      validateSchema(schema, fixture, "$", referencedSchemas),
      [],
      `${fixturePath} should validate against ${schemaPath}`
    );
  }
});

test("current aircraft_support_v1 contract fixtures form a consistent end-to-end object graph", async () => {
  for (const family of ["aircraft_support_v1"]) {
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

test("scenario schema rejects retired model families and mismatched model ids", async () => {
  const schema = await readJson("contracts/scenario.schema.json");
  const currentScenario = await readJson("tests/fixtures/aircraft_support_v1_scenario.json");
  const inputSchema = await readJson("contracts/aircraft_support_v1_input.schema.json");
  const referencedSchemas = {
    "https://spare-mvp.local/contracts/aircraft_support_v1_input.schema.json": inputSchema,
  };

  const retiredSmokeScenario = {
    ...currentScenario,
    simulation_model: {
      family: "smoke",
      model_id: "SmokeSpareMvpModel",
      contract_version: "1.0.0",
    },
  };
  const retiredAviationScenario = {
    ...currentScenario,
    simulation_model: {
      family: "aviation_support",
      model_id: "AviationSupportModel",
      contract_version: "1.0.0",
    },
  };
  const currentFamilyWithRetiredModelId = {
    ...currentScenario,
    simulation_model: {
      ...currentScenario.simulation_model,
      model_id: "AviationSupportModel",
    },
  };

  assert.notDeepEqual(validateSchema(schema, retiredSmokeScenario, "$", referencedSchemas), []);
  assert.notDeepEqual(validateSchema(schema, retiredAviationScenario, "$", referencedSchemas), []);
  assert.notDeepEqual(validateSchema(schema, currentFamilyWithRetiredModelId, "$", referencedSchemas), []);
});

test("scenario schema no longer exposes retired model-family inputs", async () => {
  const schema = await readJson("contracts/scenario.schema.json");

  assert.equal(schema.$defs.SmokeModelSelector, undefined);
  assert.equal(schema.$defs.SmokeInputs, undefined);
  assert.equal(schema.$defs.AviationSupportModelSelector, undefined);
  assert.equal(schema.$defs.AviationSupportInputs, undefined);
});
