import assert from "node:assert/strict";
import test from "node:test";

import {
  addEquipmentNodeForSelectionModel,
  buildEquipmentComponentTreeModel,
  resolveEquipmentSelectionModel
} from "../front/equipment-tree-model.mjs";
import * as equipmentTreeModel from "../front/equipment-tree-model.mjs";

test("zero-aircraft imported sample add node creates a whole-machine aircraft entry", () => {
  const scenario = {
    equipment: { model: "", wholeMachineModels: [] },
    components: []
  };
  const selection = resolveEquipmentSelectionModel({
    scenario,
    selectedEquipmentNodeKey: "aircraft-list",
    selectedEquipmentComponentIndex: 0
  });

  const result = addEquipmentNodeForSelectionModel({
    scenario,
    selection
  });

  assert.equal(result.kind, "aircraft");
  assert.deepEqual(scenario.equipment.wholeMachineModels, ["新增飞机1"]);
  assert.equal(scenario.equipment.model, "新增飞机1");
  assert.equal(result.selectedEquipmentNodeKey, "aircraft:新增飞机1");
});

test("component tree model skips self-references and cyclic parent chains without recursion overflow", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "self-loop", name: "Self Loop", aircraftModel: "J-15", parentId: "self-loop", quantity: 1, connectionType: "串联" },
      { id: "cycle-a", name: "Cycle A", aircraftModel: "J-15", parentId: "aircraft-root", quantity: 1, connectionType: "串联" },
      { id: "cycle-b", name: "Cycle B", aircraftModel: "J-15", parentId: "cycle-a", quantity: 1, connectionType: "串联" },
      { id: "cycle-a", name: "Cycle A Duplicate", aircraftModel: "J-15", parentId: "cycle-b", quantity: 1, connectionType: "串联" }
    ]
  };

  const nodes = buildEquipmentComponentTreeModel({
    scenario,
    aircraftModel: "J-15",
    parentId: "aircraft-root"
  });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].component.id, "cycle-a");
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].children[0].component.id, "cycle-b");
  assert.deepEqual(nodes[0].children[0].children, []);
});

test("equipment authoring rows hide the root example node and follow tree order for aircraft selection", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "aircraft-root", name: "舰载机", aircraftModel: "J-15", quantity: 1 },
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 2 },
      { id: "engine-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "engine", productType: "SRU", quantity: 1 },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 1 }
    ]
  };

  const tree = buildEquipmentComponentTreeModel({
    scenario,
    aircraftModel: "J-15",
    parentId: "aircraft-root"
  });
  assert.equal(typeof equipmentTreeModel.equipmentComponentsForSelectionModel, "function");
  const rows = equipmentTreeModel.equipmentComponentsForSelectionModel({
    scenario,
    selection: { kind: "aircraft", aircraftModel: "J-15" }
  });

  assert.deepEqual(tree.map((node) => node.component.id), ["engine", "radar"]);
  assert.deepEqual(rows.map((component) => component.id), ["engine", "engine-control", "radar"]);
  assert.equal(rows.some((component) => component.name === "舰载机"), false);
});

test("equipment authoring rows show a selected system node and its descendants", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 2 },
      { id: "engine-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "engine", productType: "SRU", quantity: 1 },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 1 }
    ]
  };

  assert.equal(typeof equipmentTreeModel.equipmentComponentsForSelectionModel, "function");
  const rows = equipmentTreeModel.equipmentComponentsForSelectionModel({
    scenario,
    selection: {
      kind: "component",
      aircraftModel: "J-15",
      component: scenario.components[0],
      componentIndex: 0
    }
  });

  assert.deepEqual(rows.map((component) => component.id), ["engine", "engine-control"]);
});
