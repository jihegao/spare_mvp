import assert from "node:assert/strict";
import test from "node:test";

import {
  addEquipmentNodeForSelectionModel,
  buildEquipmentComponentTreeModel,
  deleteEquipmentNodeForSelectionModel,
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
  assert.deepEqual(scenario.equipment.aircraftTypes, [
    { id: "aircraft-type-1", model: "新增飞机1", name: "新增飞机1" }
  ]);
  assert.equal(scenario.equipment.model, "新增飞机1");
  assert.equal(result.selectedEquipmentNodeKey, "aircraft:新增飞机1");
});

test("equipment aircraftTypes define whole-machine aircraft list", () => {
  const scenario = {
    equipment: {
      model: "",
      wholeMachineModels: [],
      aircraftTypes: [
        { id: "aircraft-type-j15", model: "J-15", name: "歼-15" },
        { id: "aircraft-type-j35", model: "J-35", name: "歼-35" }
      ]
    },
    components: [
      { id: "j15-engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root", quantity: 2 }
    ]
  };

  assert.deepEqual(equipmentTreeModel.wholeMachineModelsForScenario(scenario), ["J-15", "J-35"]);
});

test("equipment k-out-of-n defaults missing or historical zero to quantity", () => {
  assert.equal(typeof equipmentTreeModel.normalizeEquipmentComponentKOutOfN, "function");

  const missing = { id: "engine", quantity: 3 };
  equipmentTreeModel.normalizeEquipmentComponentKOutOfN(missing);
  assert.deepEqual(missing.kOutOfN, { enabled: true, n: 3, k: 3 });

  const historicalZero = { id: "radar", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 0 } };
  equipmentTreeModel.normalizeEquipmentComponentKOutOfN(historicalZero);
  assert.deepEqual(historicalZero.kOutOfN, { enabled: true, n: 2, k: 2 });

  const explicitRedundancy = { id: "avionics", quantity: 2, kOutOfN: { enabled: true, n: 2, k: 1 } };
  equipmentTreeModel.normalizeEquipmentComponentKOutOfN(explicitRedundancy);
  assert.deepEqual(explicitRedundancy.kOutOfN, { enabled: true, n: 2, k: 1 });
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

test("equipment aircraft selection refreshes rows without leaking another aircraft components", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-35"] },
    components: [
      { id: "j15-engine", name: "J-15发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 2 },
      { id: "j15-control", name: "J-15控制模块", aircraftModel: "J-15", parentId: "j15-engine", productType: "SRU", quantity: 1 },
      { id: "j35-radar", name: "J-35雷达", aircraftModel: "J-35", parentId: "aircraft-root", productType: "LRU", quantity: 1 }
    ]
  };

  const j15Rows = equipmentTreeModel.equipmentComponentsForSelectionModel({
    scenario,
    selection: { kind: "aircraft", aircraftModel: "J-15" }
  });
  const j35Rows = equipmentTreeModel.equipmentComponentsForSelectionModel({
    scenario,
    selection: { kind: "aircraft", aircraftModel: "J-35" }
  });

  assert.deepEqual(j15Rows.map((component) => component.id), ["j15-engine", "j15-control"]);
  assert.deepEqual(j35Rows.map((component) => component.id), ["j35-radar"]);
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

test("equipment tree deletion removes a selected aircraft and all of its components", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-35"] },
    components: [
      { id: "j15-engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root" },
      { id: "j15-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "j15-engine" },
      { id: "j35-radar", name: "雷达", aircraftModel: "J-35", parentId: "aircraft-root" }
    ]
  };

  const result = deleteEquipmentNodeForSelectionModel({
    scenario,
    selection: { kind: "aircraft", aircraftModel: "J-15" }
  });

  assert.equal(result.kind, "aircraft");
  assert.deepEqual(result.deletedComponentIds.sort(), ["j15-control", "j15-engine"]);
  assert.deepEqual(scenario.equipment.wholeMachineModels, ["J-35"]);
  assert.deepEqual(scenario.equipment.aircraftTypes, [
    { id: "aircraft-type-j-35", model: "J-35", name: "J-35" }
  ]);
  assert.equal(scenario.equipment.model, "J-35");
  assert.deepEqual(scenario.components.map((component) => component.id), ["j35-radar"]);
  assert.equal(result.selectedEquipmentNodeKey, "aircraft-list");
});

test("equipment tree deletion removes a selected subsystem and its descendants", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root" },
      { id: "engine-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "engine" },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root" }
    ]
  };

  const result = deleteEquipmentNodeForSelectionModel({
    scenario,
    selection: {
      kind: "component",
      aircraftModel: "J-15",
      component: scenario.components[0],
      componentIndex: 0
    }
  });

  assert.equal(result.kind, "component");
  assert.deepEqual(result.deletedComponentIds.sort(), ["engine", "engine-control"]);
  assert.deepEqual(scenario.components.map((component) => component.id), ["radar"]);
  assert.equal(result.selectedEquipmentNodeKey, "aircraft:J-15");
  assert.equal(result.selectedEquipmentComponentIndex, 0);
});

test("equipment tree deletion removes a selected leaf component only", () => {
  const scenario = {
    equipment: { model: "J-15", wholeMachineModels: ["J-15"] },
    components: [
      { id: "engine", name: "发动机", aircraftModel: "J-15", parentId: "aircraft-root" },
      { id: "engine-control", name: "发动机控制模块", aircraftModel: "J-15", parentId: "engine" },
      { id: "radar", name: "雷达", aircraftModel: "J-15", parentId: "aircraft-root" }
    ]
  };

  const result = deleteEquipmentNodeForSelectionModel({
    scenario,
    selection: {
      kind: "component",
      aircraftModel: "J-15",
      component: scenario.components[1],
      componentIndex: 1
    }
  });

  assert.equal(result.kind, "component");
  assert.deepEqual(result.deletedComponentIds, ["engine-control"]);
  assert.deepEqual(scenario.components.map((component) => component.id), ["engine", "radar"]);
  assert.equal(result.selectedEquipmentNodeKey, "component:engine");
});
