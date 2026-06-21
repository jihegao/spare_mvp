import assert from "node:assert/strict";
import test from "node:test";

import {
  addEquipmentNodeForSelectionModel,
  buildEquipmentComponentTreeModel,
  resolveEquipmentSelectionModel
} from "../front/equipment-tree-model.mjs";

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
