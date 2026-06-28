import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildReliabilityBlockDiagramLayout,
  kOfNReliability,
  parallelReliability,
  seriesReliability
} from "../front/rbd-evaluator.mjs";
import * as rbdEvaluator from "../front/rbd-evaluator.mjs";

test("series reliability multiplies child probabilities", () => {
  assert.equal(seriesReliability([0.99, 0.98, 0.97]).toFixed(6), "0.941094");
});

test("parallel reliability computes complement of joint failure", () => {
  assert.equal(parallelReliability([0.9, 0.8]).toFixed(3), "0.980");
});

test("k-of-n reliability sums successful state probabilities", () => {
  assert.equal(kOfNReliability(2, [0.9, 0.8, 0.7]).toFixed(3), "0.902");
});

test("reliability block diagram layout labels k-of-n nodes and parallel branches", () => {
  const layout = buildReliabilityBlockDiagramLayout({
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", connectionType: "串联", parentId: null },
        { id: "engine", name: "发动机", type: "component", connectionType: "串联", parentId: "aircraft" },
        { id: "avionics", name: "航电系统", type: "component", connectionType: "并联", parentId: "aircraft" },
        { id: "hydraulic", name: "液压系统", type: "component", connectionType: "并联", parentId: "aircraft" }
      ],
      edges: [
        { from: "aircraft", to: "engine", type: "串联" },
        { from: "aircraft", to: "avionics", type: "并联" },
        { from: "aircraft", to: "hydraulic", type: "并联" }
      ]
    },
    components: [
      { id: "engine", name: "发动机", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "avionics", name: "航电系统", connectionType: "并联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "hydraulic", name: "液压系统", connectionType: "并联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 } }
    ]
  });

  const engine = layout.logicalNodes.find((node) => node.id === "engine");
  const avionics = layout.logicalNodes.find((node) => node.id === "avionics");
  const avionicsReplicas = layout.nodes.filter((node) => node.sourceNodeId === "avionics");

  assert.equal(engine.logic, "series");
  assert.equal(engine.kOutOfNLabel, "2中取1");
  assert.equal(avionics.logic, "parallel");
  assert.equal(avionics.kOutOfNLabel, "2中取1");
  assert.equal(avionicsReplicas.length, 2);
  assert.ok(layout.groups.some((group) => group.relation === "parallel" && group.sourceNodeId === "avionics"));
  assert.ok(layout.connectors.some((connector) => connector.relation === "parallel"));
});

test("reliability block diagram layout expands k-out-of-n nodes into framed parallel replicas", () => {
  const layout = buildReliabilityBlockDiagramLayout({
    reliabilityBlockDiagram: {
      nodes: [
        { id: "engine", name: "发动机", type: "component", connectionType: "并联", parentId: null },
        { id: "avionics", name: "航电系统", type: "component", connectionType: "并联", parentId: null },
        { id: "hydraulic", name: "液压系统", type: "component", connectionType: "串联", parentId: null }
      ],
      edges: []
    },
    components: [
      { id: "engine", name: "发动机", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "avionics", name: "航电系统", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "hydraulic", name: "液压系统", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 } }
    ]
  });

  const avionicsReplicas = layout.nodes.filter((node) => node.sourceNodeId === "avionics");
  const avionicsGroup = layout.groups.find((group) => group.sourceNodeId === "avionics");
  assert.ok(Array.isArray(layout.logicalNodes));
  const tableAvionics = layout.logicalNodes.find((node) => node.id === "avionics");

  assert.equal(avionicsReplicas.length, 2);
  assert.deepEqual(avionicsReplicas.map((node) => node.name), ["航电系统", "航电系统"]);
  assert.ok(avionicsReplicas.every((node) => node.isReplica));
  assert.equal(avionicsGroup.relation, "parallel");
  assert.equal(avionicsGroup.label, "并联 / 2中取1");
  assert.deepEqual(avionicsGroup.nodeIds, avionicsReplicas.map((node) => node.id));
  assert.ok(layout.connectors.some((connector) => connector.relation === "parallel" && connector.toStageIndex === avionicsGroup.stageIndex));
  assert.equal(tableAvionics.kOutOfNLabel, "2中取1");
  assert.equal(layout.logicalNodes.filter((node) => node.id === "avionics").length, 1);
});

test("reliability block diagram layout falls back to equipment components", () => {
  const layout = buildReliabilityBlockDiagramLayout({
    equipment: { model: "J-15" },
    components: [
      { id: "engine", name: "发动机", parentId: "aircraft-root", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "radar", name: "雷达", parentId: "engine", connectionType: "并联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 } }
    ]
  });

  assert.equal(layout.logicalNodes[0].id, "aircraft-root");
  assert.equal(layout.logicalNodes[0].name, "J-15");
  assert.equal(layout.logicalNodes.find((node) => node.id === "engine").kOutOfNLabel, "2中取1");
  assert.equal(layout.logicalNodes.find((node) => node.id === "radar").logic, "parallel");
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "engine").length, 2);
});

test("reliability block diagram selection shows only next-level nodes for whole aircraft", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "engine-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "engine", productType: "SRU", connectionType: "并联" },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "备用" }
    ]
  };

  assert.equal(typeof rbdEvaluator.reliabilityDiagramProjectForSelection, "function");
  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft",
    aircraftModel: "J-15"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => node.id), ["engine", "radar"]);
  assert.deepEqual(layout.logicalNodes.map((node) => [node.id, node.logic, node.kOutOfNLabel]), [
    ["engine", "parallel", "2中取1"],
    ["radar", "series", ""]
  ]);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "engine").length, 2);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
  assert.equal(layout.nodes.some((node) => node.id === "aircraft-root"), false);
  assert.equal(layout.nodes.some((node) => node.id === "engine-control"), false);
});

test("reliability block diagram selection leaves aircraft-list root empty", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "串联" },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "备用" }
    ]
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft-list"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("explicit whole-aircraft RBD omits root and displays k-out-of-n children as parallel", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", parentId: "aircraft-root", productType: "LRU", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "avionics", name: "航电系统", parentId: "aircraft-root", productType: "LRU", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "hydraulic", name: "液压系统", parentId: "aircraft-root", productType: "LRU", connectionType: "串联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 } }
    ],
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", connectionType: "串联", parentId: null },
        { id: "engine", name: "发动机", type: "component", connectionType: "串联", parentId: "aircraft" },
        { id: "avionics", name: "航电系统", type: "component", connectionType: "串联", parentId: "aircraft" },
        { id: "hydraulic", name: "液压系统", type: "component", connectionType: "串联", parentId: "aircraft" }
      ],
      edges: [
        { from: "aircraft", to: "engine", type: "串联" },
        { from: "aircraft", to: "avionics", type: "串联" },
        { from: "aircraft", to: "hydraulic", type: "串联" }
      ]
    }
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft",
    aircraftModel: "J-15"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => node.name), ["发动机", "航电系统", "液压系统"]);
  assert.deepEqual(layout.logicalNodes.map((node) => [node.name, node.logic, node.connectionLabel, node.kOutOfNLabel]), [
    ["发动机", "parallel", "并联", "2中取1"],
    ["航电系统", "parallel", "并联", "2中取1"],
    ["液压系统", "series", "串联", ""]
  ]);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "发动机" || node.name === "发动机").length, 2);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "avionics").length, 2);
  assert.equal(layout.nodes.some((node) => node.name === "整机"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("explicit aircraft-list RBD leaves the root selection empty", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", parentId: "aircraft-root", productType: "LRU", connectionType: "串联" }
    ],
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", connectionType: "串联", parentId: null },
        { id: "engine", name: "发动机", type: "component", connectionType: "串联", parentId: "aircraft" }
      ],
      edges: [
        { from: "aircraft", to: "engine", type: "串联" }
      ]
    }
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft-list"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("component fallback whole-aircraft RBD omits root and displays k-out-of-n children as parallel", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", connectionType: "备用" }
    ]
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft",
    aircraftModel: "J-15"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => [node.id, node.logic, node.kOutOfNLabel]), [
    ["engine", "parallel", "2中取1"],
    ["radar", "series", ""]
  ]);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "engine").length, 2);
  assert.equal(layout.nodes.some((node) => node.id === "aircraft-root"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("reliability block diagram selection keeps gate logic nodes separate from component nodes", () => {
  const project = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", parentId: null },
        { id: "gate-avionics", name: "航电并联门", type: "logic_gate", logic: "parallel", parentId: "aircraft" },
        { id: "radar-a", name: "雷达A", type: "component", parentId: "gate-avionics", connectionType: "并联" },
        { id: "radar-b", name: "雷达B", type: "component", parentId: "gate-avionics", connectionType: "并联" }
      ],
      edges: []
    },
    components: [
      { id: "radar-a", name: "雷达A", productType: "LRU", connectionType: "并联" },
      { id: "radar-b", name: "雷达B", productType: "LRU", connectionType: "并联" }
    ]
  };

  assert.equal(typeof rbdEvaluator.reliabilityDiagramProjectForSelection, "function");
  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "component",
    component: { id: "gate-avionics" }
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.equal(layout.nodes[0].id, "gate-avionics");
  assert.equal(layout.nodes[0].type, "logic_gate");
  assert.equal(layout.nodes[0].logic, "parallel");
  assert.deepEqual(layout.nodes.slice(1).map((node) => node.id), ["radar-a", "radar-b"]);
});

test("reliability block diagram component selection maps imported equipment ids to next-level nodes", () => {
  const importPackage = JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  const component = importPackage.objects.equipmentAssets.find((row) => row.id === "j15-avionics");
  const project = {
    equipment: importPackage.objects.equipment,
    components: importPackage.objects.equipmentAssets,
    reliabilityBlockDiagram: importPackage.objects.missionProfiles[0].reliabilityBlockDiagram
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "component",
    aircraftModel: "J-15",
    component
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => [node.id, node.name, node.logic, node.kOutOfNLabel]), [
    ["j15-radar", "雷达 LRU", "parallel", ""]
  ]);
  assert.equal(layout.nodes.some((node) => node.name === "航电系统"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("imported J-15 whole-aircraft RBD shows top-level systems without the root", () => {
  const importPackage = JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  const project = {
    equipment: importPackage.objects.equipment,
    components: importPackage.objects.equipmentAssets,
    reliabilityBlockDiagram: importPackage.objects.missionProfiles[0].reliabilityBlockDiagram
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft",
    aircraftModel: "J-15"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => [node.name, node.logic, node.connectionLabel, node.kOutOfNLabel]), [
    ["发动机", "parallel", "并联", "2中取1"],
    ["航电系统", "parallel", "并联", "2中取1"],
    ["液压系统", "series", "串联", ""]
  ]);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "engine").length, 2);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "avionics").length, 2);
  assert.equal(layout.nodes.some((node) => node.name === "整机"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("imported J-15 engine selection shows engine-control child as a series stage", () => {
  const importPackage = JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  const component = importPackage.objects.equipmentAssets.find((row) => row.id === "j15-engine");
  const project = {
    equipment: importPackage.objects.equipment,
    components: importPackage.objects.equipmentAssets,
    reliabilityBlockDiagram: importPackage.objects.missionProfiles[0].reliabilityBlockDiagram
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "component",
    aircraftModel: "J-15",
    component
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => [node.id, node.name, node.logic, node.connectionLabel, node.kOutOfNLabel]), [
    ["j15-engine-control", "发动机控制模块", "series", "串联", ""]
  ]);
  assert.deepEqual(layout.nodes.map((node) => node.name), ["发动机控制模块"]);
  assert.equal(layout.groups.length, 0);
  assert.equal(layout.nodes.some((node) => node.name === "发动机"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("imported J-35 avionics selection renders mission-computer k-out-of-n as parallel replicas", () => {
  const importPackage = JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  const component = importPackage.objects.equipmentAssets.find((row) => row.id === "j35-avionics");
  const project = {
    equipment: importPackage.objects.equipment,
    components: importPackage.objects.equipmentAssets,
    reliabilityBlockDiagram: importPackage.objects.missionProfiles[0].reliabilityBlockDiagram
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "component",
    aircraftModel: "J-35",
    component
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.logicalNodes.map((node) => [node.id, node.name, node.logic, node.connectionLabel, node.kOutOfNLabel]), [
    ["j35-mission-computer", "任务计算机模块", "parallel", "并联", "2中取1"]
  ]);
  assert.deepEqual(layout.nodes.map((node) => node.name), ["任务计算机模块", "任务计算机模块"]);
  assert.equal(layout.nodes.filter((node) => node.sourceNodeId === "j35-mission-computer").length, 2);
  assert.equal(layout.groups[0]?.label, "并联 / 2中取1");
  assert.equal(layout.groups[0]?.sourceNodeId, "j35-mission-computer");
  assert.equal(layout.nodes.some((node) => node.name === "航电系统"), false);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});

test("imported aircraft-list RBD leaves the diagram empty", () => {
  const importPackage = JSON.parse(readFileSync(new URL("./fixtures/modeling_import_project.json", import.meta.url), "utf8"));
  const project = {
    equipment: importPackage.objects.equipment,
    components: importPackage.objects.equipmentAssets,
    reliabilityBlockDiagram: {
      nodes: [
        { id: "aircraft", name: "整机", type: "system", connectionType: "串联", parentId: null },
        { id: "engine", name: "发动机", type: "component", connectionType: "串联", parentId: "aircraft" },
        { id: "avionics", name: "航电系统", type: "component", connectionType: "并联", parentId: "aircraft" },
        { id: "hydraulic", name: "液压系统", type: "component", connectionType: "备用", parentId: "aircraft" }
      ],
      edges: [
        { from: "aircraft", to: "engine", type: "串联", weight: 1 },
        { from: "aircraft", to: "avionics", type: "并联", weight: 0.6 },
        { from: "aircraft", to: "hydraulic", type: "备用", weight: 0.8 }
      ]
    }
  };

  const selectedProject = rbdEvaluator.reliabilityDiagramProjectForSelection(project, {
    kind: "aircraft-list"
  });
  const layout = buildReliabilityBlockDiagramLayout(selectedProject);

  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.nodes, []);
  assert.deepEqual(selectedProject.reliabilityBlockDiagram.edges, []);
});
