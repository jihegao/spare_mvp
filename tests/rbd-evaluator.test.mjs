import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReliabilityBlockDiagramLayout,
  kOfNReliability,
  parallelReliability,
  seriesReliability
} from "../front/rbd-evaluator.mjs";

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

  const engine = layout.nodes.find((node) => node.id === "engine");
  const avionics = layout.nodes.find((node) => node.id === "avionics");

  assert.equal(engine.logic, "series");
  assert.equal(engine.kOutOfNLabel, "2中取1");
  assert.equal(avionics.logic, "parallel");
  assert.equal(avionics.kOutOfNLabel, "2中取1");
  assert.ok(layout.groups.some((group) => group.relation === "parallel" && group.nodeIds.includes("avionics")));
  assert.ok(layout.connectors.some((connector) => connector.relation === "parallel"));
});

test("reliability block diagram layout falls back to equipment components", () => {
  const layout = buildReliabilityBlockDiagramLayout({
    equipment: { model: "J-15" },
    components: [
      { id: "engine", name: "发动机", parentId: "aircraft-root", connectionType: "串联", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } },
      { id: "radar", name: "雷达", parentId: "engine", connectionType: "并联", quantity: 1, kOutOfN: { enabled: false, n: 1, k: 1 } }
    ]
  });

  assert.equal(layout.nodes[0].id, "aircraft-root");
  assert.equal(layout.nodes[0].name, "J-15");
  assert.equal(layout.nodes.find((node) => node.id === "engine").kOutOfNLabel, "2中取1");
  assert.equal(layout.nodes.find((node) => node.id === "radar").logic, "parallel");
});
