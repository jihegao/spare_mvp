import assert from "node:assert/strict";
import test from "node:test";

import {
  aircraftMissionReliabilityOptions,
  aircraftMissionReliabilityProject,
  aircraftMissionReliabilityResultToXlsx,
  evaluateAircraftMissionReliability
} from "../front/aircraft-mission-reliability.mjs";

function issueProject() {
  return {
    equipment: { model: "AC-202" },
    basicMissions: [
      {
        id: "mission-5h",
        name: "五小时任务",
        equipmentType: "AC-202",
        taskDurationMinutes: 300,
        // taskDurationMinutes is deliberately authoritative over phase sum.
        missionPhases: [{ id: "phase-1", limitHours: 2 }, { id: "phase-2", limitHours: 4 }]
      }
    ],
    components: [
      { id: "a1", name: "A1", aircraftModel: "AC-202", failureRate: 0.01 },
      { id: "a2", name: "A2", aircraftModel: "AC-202", failureRate: 0.02 },
      { id: "b1", name: "B1", aircraftModel: "AC-202", failureRate: 0.03 },
      { id: "b2", name: "B2", aircraftModel: "AC-202", failureRate: 0.04 }
    ],
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", relation: "series" },
        { id: "group-a", name: "A 组", type: "group", relation: "series", parentId: "aircraft" },
        { id: "a1", name: "A1", type: "product", parentId: "group-a" },
        { id: "a2", name: "A2", type: "product", parentId: "group-a" },
        { id: "group-b", name: "B 组", type: "group", relation: "parallel", parentId: "aircraft" },
        { id: "b1", name: "B1", type: "product", parentId: "group-b" },
        { id: "b2", name: "B2", type: "product", parentId: "group-b" }
      ],
      edges: []
    }
  };
}

const selection = { aircraftModel: "AC-202", missionProfileId: "mission-5h" };

test("options prefer basic missions and expose aircraft/mission select contracts", () => {
  const project = issueProject();
  project.missionProfile = { id: "legacy", name: "旧任务", durationHours: 9 };
  const options = aircraftMissionReliabilityOptions(project);

  assert.deepEqual(options.aircraftModels, [{ value: "AC-202", label: "AC-202" }]);
  assert.deepEqual(options.missionProfiles.map(({ id, name, durationHours, aircraftModel }) => ({ id, name, durationHours, aircraftModel })), [
    { id: "mission-5h", name: "五小时任务", durationHours: 5, aircraftModel: "AC-202" }
  ]);
});

test("issue #202 example evaluates A series, B parallel, then aircraft series for five hours", () => {
  const result = evaluateAircraftMissionReliability(issueProject(), selection);
  const aReliability = Math.exp(-0.01 * 5) * Math.exp(-0.02 * 5);
  const bReliability = 1 - (1 - Math.exp(-0.03 * 5)) * (1 - Math.exp(-0.04 * 5));
  const expected = aReliability * bReliability;

  assert.equal(result.status, "ready");
  assert.equal(result.ok, true);
  assert.equal(result.code, "READY");
  assert.equal(result.durationHours, 5);
  assert.equal(result.missionProfile.id, "mission-5h");
  assert.ok(Math.abs(result.aircraftReliability - expected) < 1e-12);
  assert.ok(Math.abs(result.failureProbability - (1 - expected)) < 1e-12);
  assert.deepEqual(result.rows.map((row) => [row.nodeId, row.depth]), [
    ["aircraft", 0],
    ["group-a", 1],
    ["a1", 2],
    ["a2", 2],
    ["group-b", 1],
    ["b1", 2],
    ["b2", 2]
  ]);
  assert.equal(result.rows.find((row) => row.nodeId === "group-b").relation, "parallel");
  assert.ok(result.rows.every((row) => row.durationHours === 5 && row.nodeType && row.parameterLabel));
  assert.equal(result.rbdSnapshot.rootId, "aircraft");
  assert.notEqual(result.rbdSnapshot.nodes, issueProject().reliabilityBlockDiagram.nodes);
});

test("clean Project components derive a single-root RBD and include internal component reliability", () => {
  const project = {
    equipment: { model: "AC-202", wholeMachineModels: ["AC-202"] },
    basicMissions: [{ id: "mission-5h", name: "五小时任务", equipmentType: "AC-202", taskDurationMinutes: 300 }],
    components: [
      { id: "aircraft-root", name: "整机", parentId: null },
      {
        id: "system-a",
        name: "A 系统",
        parentId: "aircraft-root",
        aircraftModel: "AC-202",
        failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.01" },
        kOutOfN: { enabled: true, k: 1, n: 2 }
      },
      {
        id: "product-a1",
        name: "A1 产品",
        parentId: "system-a",
        aircraftModel: "AC-202",
        productType: "LRU",
        failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.02" },
        kOutOfN: { enabled: false, k: 1, n: 1 }
      },
      {
        id: "other-model",
        name: "其他机型产品",
        parentId: "aircraft-root",
        aircraftModel: "AC-303",
        failureDistribution: { distributionType: "指数分布", parameters: "lambda=1" }
      }
    ]
  };

  const effective = aircraftMissionReliabilityProject(project, "AC-202");
  assert.equal(project.reliabilityBlockDiagram, undefined);
  assert.equal(effective.reliabilityBlockDiagram.source, "components");
  assert.deepEqual(effective.reliabilityBlockDiagram.nodes.map((node) => node.id), [
    "aircraft-root",
    "system-a",
    "product-a1"
  ]);
  assert.equal(effective.reliabilityBlockDiagram.edges.length, 2);

  const result = evaluateAircraftMissionReliability(project, selection);
  const systemBase = Math.exp(-0.01 * 5);
  const systemRedundant = 1 - (1 - systemBase) ** 2;
  const productReliability = Math.exp(-0.02 * 5);
  assert.equal(result.status, "ready");
  assert.equal(result.rbdSnapshot.rootId, "aircraft-root");
  assert.ok(Math.abs(result.aircraftReliability - systemRedundant * productReliability) < 1e-12);
  assert.match(result.rows.find((row) => row.nodeId === "system-a").parameterLabel, /自身.*2 中取 1/);
});

test("missionProfile fallback and phase-sum duration are supported", () => {
  const project = issueProject();
  delete project.basicMissions;
  project.missionProfile = {
    id: "profile-phases",
    name: "阶段任务",
    missionPhases: [{ limitHours: 1.25 }, { limitHours: 2.75 }]
  };
  const result = evaluateAircraftMissionReliability(project, {
    aircraftModel: "AC-202",
    missionProfileId: "profile-phases"
  });

  assert.equal(result.status, "ready");
  assert.equal(result.durationHours, 4);
});

test("leaf reliability supports MTBF, exponential, normal, uniform and fixed distributions", () => {
  const project = issueProject();
  project.reliabilityBlockDiagram.nodes = [
    { id: "aircraft", name: "整机", relation: "series" },
    { id: "mtbf", name: "MTBF", parentId: "aircraft", mtbfHours: 100 },
    { id: "exp", name: "指数", parentId: "aircraft", failureDistribution: { distributionType: "指数分布", rate: 0.01 } },
    { id: "normal", name: "正态", parentId: "aircraft", failureDistribution: { distributionType: "正态分布", mean: 10, variance: 4 } },
    { id: "uniform", name: "均匀", parentId: "aircraft", failureDistribution: { distributionType: "均匀分布", min: 0, max: 10 } },
    { id: "fixed", name: "固定", parentId: "aircraft", mtbfHours: 8, failureDistribution: { distributionType: "固定值" } }
  ];
  project.components = [{ aircraftModel: "AC-202", id: "marker" }];
  const result = evaluateAircraftMissionReliability(project, selection);

  assert.equal(result.status, "ready");
  assert.ok(Math.abs(result.rows.find((row) => row.nodeId === "mtbf").reliability - Math.exp(-0.05)) < 1e-12);
  assert.ok(Math.abs(result.rows.find((row) => row.nodeId === "exp").reliability - Math.exp(-0.05)) < 1e-12);
  assert.ok(Math.abs(result.rows.find((row) => row.nodeId === "normal").reliability - 0.9937903) < 1e-5);
  assert.equal(result.rows.find((row) => row.nodeId === "uniform").reliability, 0.5);
  assert.equal(result.rows.find((row) => row.nodeId === "fixed").reliability, 1);
});

test("internal and repeated-leaf k-out-of-n relations evaluate bottom-up", () => {
  const project = issueProject();
  project.reliabilityBlockDiagram.nodes = [
    { id: "aircraft", name: "整机", relation: "series" },
    { id: "voters", name: "表决组", parentId: "aircraft", relation: "k-out-of-n", kOutOfN: { enabled: true, k: 2, n: 3 } },
    { id: "v1", name: "V1", parentId: "voters", reliability: 0.9 },
    { id: "v2", name: "V2", parentId: "voters", reliability: 0.8 },
    { id: "v3", name: "V3", parentId: "voters", reliability: 0.7 },
    { id: "replica", name: "副本", parentId: "aircraft", reliability: 0.6, quantity: 2, kOutOfN: { enabled: true, k: 1, n: 2 } }
  ];
  project.components = [{ aircraftModel: "AC-202", id: "marker" }];
  const result = evaluateAircraftMissionReliability(project, selection);

  assert.equal(result.status, "ready");
  assert.ok(Math.abs(result.rows.find((row) => row.nodeId === "voters").reliability - 0.902) < 1e-12);
  assert.ok(Math.abs(result.rows.find((row) => row.nodeId === "replica").reliability - 0.84) < 1e-12);
  assert.ok(Math.abs(result.aircraftReliability - 0.902 * 0.84) < 1e-12);
});

test("selection, duration, diagram and graph prerequisites return blocking status", () => {
  const project = issueProject();
  assert.equal(evaluateAircraftMissionReliability(project, {}).code, "AIRCRAFT_REQUIRED");
  assert.equal(evaluateAircraftMissionReliability(project, { aircraftModel: "AC-202" }).code, "MISSION_REQUIRED");
  assert.equal(evaluateAircraftMissionReliability(project, { ...selection, durationHours: 0 }).code, "INVALID_DURATION");
  assert.equal(evaluateAircraftMissionReliability({ ...project, components: [], reliabilityBlockDiagram: undefined }, selection).code, "NO_RBD");

  const invalid = issueProject();
  invalid.reliabilityBlockDiagram.nodes.push({ id: "a1", name: "重复节点" });
  assert.equal(evaluateAircraftMissionReliability(invalid, selection).code, "INVALID_RBD_NODE");

  const cyclic = issueProject();
  cyclic.reliabilityBlockDiagram = {
    nodes: [
      { id: "x", name: "X", parentId: "y", relation: "series" },
      { id: "y", name: "Y", parentId: "x", relation: "series" }
    ],
    edges: []
  };
  assert.equal(evaluateAircraftMissionReliability(cyclic, selection).code, "RBD_CYCLE");
});

test("missing relation and missing, illegal, or wrongly-unitized leaf parameters block calculation", () => {
  const noRelation = issueProject();
  delete noRelation.reliabilityBlockDiagram.nodes[0].relation;
  assert.equal(evaluateAircraftMissionReliability(noRelation, selection).code, "MISSING_RELATION");

  const noParameter = issueProject();
  delete noParameter.components.find((component) => component.id === "a1").failureRate;
  assert.equal(evaluateAircraftMissionReliability(noParameter, selection).code, "MISSING_LEAF_PARAMETERS");

  const badParameter = issueProject();
  badParameter.components.find((component) => component.id === "a1").failureRate = -1;
  assert.equal(evaluateAircraftMissionReliability(badParameter, selection).code, "INVALID_LEAF_PARAMETERS");

  const badUnit = issueProject();
  Object.assign(badUnit.components.find((component) => component.id === "a1"), {
    failureRate: 0.01,
    failureRateUnit: "kg"
  });
  assert.equal(evaluateAircraftMissionReliability(badUnit, selection).code, "INVALID_UNIT");
});

test("XLSX export is an openable OOXML workbook containing the retained summary results", () => {
  const result = evaluateAircraftMissionReliability(issueProject(), selection);
  const workbook = aircraftMissionReliabilityResultToXlsx(result);
  const entries = storedZipEntries(workbook);

  assert.equal(new DataView(workbook.buffer, workbook.byteOffset, workbook.byteLength).getUint32(0, true), 0x04034b50);
  assert.ok(entries.has("[Content_Types].xml"));
  assert.ok(entries.has("xl/workbook.xml"));
  assert.ok(entries.has("xl/worksheets/sheet1.xml"));
  assert.match(entries.get("xl/workbook.xml"), /sheet name="可靠性汇总"/);

  const worksheet = entries.get("xl/worksheets/sheet1.xml");
  assert.match(worksheet, /飞机任务可靠性评估/);
  assert.match(worksheet, /飞机型号[\s\S]*AC-202/);
  assert.match(worksheet, /任务剖面[\s\S]*五小时任务/);
  assert.match(worksheet, /任务时长（小时）[\s\S]*<v>5<\/v>/);
  assert.match(worksheet, new RegExp(`<v>${result.aircraftReliability}<\\/v>`));
  assert.match(worksheet, new RegExp(`<v>${result.failureProbability}<\\/v>`));
  assert.match(worksheet, /计算节点[\s\S]*<v>7<\/v>/);
  assert.doesNotMatch(worksheet, /节点ID|串并联关系|产品可靠性参数/);
});

function storedZipEntries(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, "test parser expects stored ZIP entries");
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}
