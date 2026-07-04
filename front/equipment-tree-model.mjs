export function wholeMachineModelsForScenario(scenario) {
  const equipment = scenario?.equipment || {};
  const models = [
    ...aircraftTypeModels(equipment.aircraftTypes),
    ...(Array.isArray(equipment.wholeMachineModels) ? equipment.wholeMachineModels : []),
    equipment.model
  ];
  return Array.from(new Set(models.map((model) => String(model || "").trim()).filter(Boolean)));
}

function aircraftTypeModels(aircraftTypes) {
  if (!Array.isArray(aircraftTypes)) return [];
  return aircraftTypes.map((aircraftType) => {
    if (typeof aircraftType === "string") return aircraftType;
    if (!aircraftType || typeof aircraftType !== "object" || Array.isArray(aircraftType)) return "";
    return aircraftType.model || aircraftType.name || aircraftType.id || "";
  });
}

export function componentBelongsToAircraftModel(component, aircraftModel) {
  return !component?.aircraftModel || String(component.aircraftModel) === String(aircraftModel);
}

export function buildEquipmentComponentTreeModel({ scenario, aircraftModel, parentId }) {
  const components = Array.isArray(scenario?.components) ? scenario.components : [];
  const buildChildren = (currentParentId, visited = new Set()) => {
    const visitedIds = new Set(visited);
    return components
      .filter((component) => {
        const componentId = String(component?.id || "");
        return componentId
          && componentId !== String(currentParentId)
          && !visitedIds.has(componentId)
          && componentBelongsToAircraftModel(component, aircraftModel)
          && String(component.parentId || "aircraft-root") === String(currentParentId);
      })
      .map((component) => {
        const componentId = String(component.id || "");
        const nextVisited = new Set(visitedIds);
        nextVisited.add(componentId);
        return {
          component,
          children: buildChildren(componentId, nextVisited)
        };
      });
  };
  return buildChildren(parentId);
}

export function equipmentComponentsForSelectionModel({ scenario, selection }) {
  const components = Array.isArray(scenario?.components) ? scenario.components : [];
  const selectedState = selection || resolveEquipmentSelectionModel({ scenario });
  if (selectedState.kind === "aircraft-list") {
    return components.filter((component) => !isSyntheticAircraftRoot(component));
  }
  if (selectedState.kind === "aircraft") {
    return flattenEquipmentComponentTree(
      buildEquipmentComponentTreeModel({
        scenario,
        aircraftModel: selectedState.aircraftModel,
        parentId: "aircraft-root"
      })
    );
  }
  if (selectedState.kind === "component" && selectedState.component) {
    const rootComponent = selectedState.component;
    return [
      rootComponent,
      ...flattenEquipmentComponentTree(
        buildEquipmentComponentTreeModel({
          scenario,
          aircraftModel: selectedState.aircraftModel || rootComponent.aircraftModel || wholeMachineModelsForScenario(scenario)[0] || "",
          parentId: rootComponent.id
        })
      )
    ].filter((component) => !isSyntheticAircraftRoot(component));
  }
  return components.filter((component) => !isSyntheticAircraftRoot(component));
}

function flattenEquipmentComponentTree(nodes) {
  return nodes.flatMap(({ component, children }) => [
    component,
    ...flattenEquipmentComponentTree(children || [])
  ]);
}

function isSyntheticAircraftRoot(component) {
  return String(component?.id || "") === "aircraft-root";
}

export function resolveEquipmentSelectionModel({
  scenario,
  selectedEquipmentNodeKey = "",
  selectedEquipmentComponentIndex = 0
}) {
  const components = Array.isArray(scenario?.components) ? scenario.components : [];
  const models = wholeMachineModelsForScenario(scenario);
  if (!models.length) return { kind: "aircraft-list" };
  if (selectedEquipmentNodeKey === "aircraft-list") {
    return { kind: "aircraft-list" };
  }
  if (selectedEquipmentNodeKey.startsWith("aircraft:")) {
    const aircraftModel = selectedEquipmentNodeKey.slice("aircraft:".length);
    if (models.includes(aircraftModel)) return { kind: "aircraft", aircraftModel };
  }
  if (selectedEquipmentNodeKey.startsWith("component:")) {
    const componentId = selectedEquipmentNodeKey.slice("component:".length);
    const componentIndex = findEquipmentComponentIndexById(components, componentId);
    const component = components[componentIndex];
    if (component) {
      return {
        kind: "component",
        component,
        componentIndex,
        aircraftModel: component.aircraftModel || models[0] || ""
      };
    }
  }
  const componentIndex = clampIndex(selectedEquipmentComponentIndex, components.length);
  const component = components[componentIndex];
  if (component) {
    return {
      kind: "component",
      component,
      componentIndex,
      aircraftModel: component.aircraftModel || models[0] || "",
      selectedEquipmentNodeKey: `component:${component.id}`
    };
  }
  return { kind: "aircraft", aircraftModel: models[0] || "" };
}

export function addEquipmentNodeForSelectionModel({ scenario, selection }) {
  if (!scenario.equipment) scenario.equipment = {};
  if (!Array.isArray(scenario.components)) scenario.components = [];
  const selectedState = selection || resolveEquipmentSelectionModel({
    scenario,
    selectedEquipmentNodeKey: "aircraft-list",
    selectedEquipmentComponentIndex: 0
  });
  if (selectedState.kind === "aircraft-list") {
    return addEquipmentAircraftForSelectionModel(scenario);
  }

  const aircraftModel = selectedState.aircraftModel || wholeMachineModelsForScenario(scenario)[0] || scenario.equipment.model || "装备";
  const parentId = selectedState.kind === "aircraft" ? "aircraft-root" : selectedState.component.id;
  const siblingCount = scenario.components.filter((component) => (
    componentBelongsToAircraftModel(component, aircraftModel)
    && String(component.parentId || "aircraft-root") === String(parentId)
  )).length;
  const newComponent = {
    id: nextEquipmentComponentId(scenario, aircraftModel, parentId),
    aircraftModel,
    parentId,
    name: selectedState.kind === "aircraft" ? `新增分系统${siblingCount + 1}` : `新增子系统${siblingCount + 1}`,
    productType: selectedState.kind === "aircraft" ? "非LRU" : "LRU",
    spareType: selectedState.kind === "aircraft" ? "通用备件" : (selectedState.component.spareType || "通用备件"),
    failureModel: "随机",
    failureDistribution: { distributionType: "指数分布", parameters: "lambda=0.03" },
    failureRate: 0.03,
    mtbfHours: 120,
    lifeLimitHours: 240,
    connectionType: selectedState.kind === "aircraft" ? "串联" : "并联",
    quantity: 1,
    kOutOfN: { enabled: false, n: 1, k: 1 },
    specialRepairProfile: { repairTimeMinutes: 120, repairRatio: 0.5, replacementRatio: 0.5 },
    rms: { reliability: 0.95, maintainability: 0.9, supportability: 0.9, mttrHours: 2.5, mldtHours: 1.2, availability: 0.97 }
  };
  scenario.components.push(newComponent);
  return {
    kind: "component",
    selectedEquipmentComponentIndex: scenario.components.length - 1,
    selectedEquipmentNodeKey: `component:${newComponent.id}`,
    component: newComponent
  };
}

export function deleteEquipmentNodeForSelectionModel({ scenario, selection }) {
  if (!scenario.equipment) scenario.equipment = {};
  if (!Array.isArray(scenario.components)) scenario.components = [];
  const selectedState = selection || resolveEquipmentSelectionModel({ scenario });
  if (selectedState.kind === "aircraft-list") {
    return { kind: "none", deletedComponentIds: [] };
  }
  if (selectedState.kind === "aircraft") {
    return deleteEquipmentAircraftForSelectionModel(scenario, selectedState.aircraftModel);
  }
  if (selectedState.kind === "component" && selectedState.component) {
    return deleteEquipmentComponentForSelectionModel(scenario, selectedState);
  }
  return { kind: "none", deletedComponentIds: [] };
}

function deleteEquipmentAircraftForSelectionModel(scenario, aircraftModel) {
  const model = String(aircraftModel || "");
  if (!model) return { kind: "none", deletedComponentIds: [] };
  if (!Array.isArray(scenario.equipment.wholeMachineModels)) {
    scenario.equipment.wholeMachineModels = wholeMachineModelsForScenario(scenario);
  }
  const deletedComponentIds = (scenario.components || [])
    .filter((component) => componentBelongsToAircraftModel(component, model))
    .map((component) => String(component.id || ""))
    .filter(Boolean);
  scenario.equipment.wholeMachineModels = scenario.equipment.wholeMachineModels.filter((item) => String(item) !== model);
  syncEquipmentAircraftTypesForModels(scenario);
  scenario.components = scenario.components.filter((component) => !deletedComponentIds.includes(String(component.id || "")));
  const fallbackModel = wholeMachineModelsForScenario(scenario)[0] || "";
  if (String(scenario.equipment.model || "") === model) {
    scenario.equipment.model = fallbackModel;
  }
  return {
    kind: "aircraft",
    aircraftModel: model,
    fallbackModel,
    deletedComponentIds,
    selectedEquipmentNodeKey: "aircraft-list",
    selectedEquipmentComponentIndex: 0
  };
}

function deleteEquipmentComponentForSelectionModel(scenario, selectedState) {
  const component = selectedState.component;
  const componentId = String(component.id || "");
  if (!componentId) return { kind: "none", deletedComponentIds: [] };
  const aircraftModel = selectedState.aircraftModel || component.aircraftModel || wholeMachineModelsForScenario(scenario)[0] || "";
  const deletedIds = collectEquipmentComponentSubtreeIds(scenario, {
    aircraftModel,
    rootComponentId: componentId
  });
  const deletedSet = new Set(deletedIds);
  scenario.components = scenario.components.filter((item) => !deletedSet.has(String(item.id || "")));
  const parentId = String(component.parentId || "aircraft-root");
  const parentIndex = findEquipmentComponentIndexById(scenario.components, parentId);
  const selectedEquipmentNodeKey = parentIndex >= 0
    ? `component:${parentId}`
    : (aircraftModel ? `aircraft:${aircraftModel}` : "aircraft-list");
  return {
    kind: "component",
    aircraftModel,
    deletedComponentIds: deletedIds,
    selectedEquipmentNodeKey,
    selectedEquipmentComponentIndex: parentIndex >= 0 ? parentIndex : 0
  };
}

function collectEquipmentComponentSubtreeIds(scenario, { aircraftModel, rootComponentId }) {
  const components = Array.isArray(scenario?.components) ? scenario.components : [];
  const deletedIds = [];
  const visited = new Set();
  const queue = [String(rootComponentId || "")].filter(Boolean);
  while (queue.length) {
    const componentId = queue.shift();
    if (!componentId || visited.has(componentId)) continue;
    visited.add(componentId);
    deletedIds.push(componentId);
    for (const component of components) {
      const childId = String(component.id || "");
      if (!childId || visited.has(childId)) continue;
      if (!componentBelongsToAircraftModel(component, aircraftModel)) continue;
      if (String(component.parentId || "aircraft-root") === componentId) {
        queue.push(childId);
      }
    }
  }
  return deletedIds;
}

function addEquipmentAircraftForSelectionModel(scenario) {
  if (!Array.isArray(scenario.equipment.wholeMachineModels)) {
    scenario.equipment.wholeMachineModels = wholeMachineModelsForScenario(scenario);
  }
  const aircraftModel = nextEquipmentAircraftModel(scenario);
  scenario.equipment.wholeMachineModels.push(aircraftModel);
  syncEquipmentAircraftTypesForModels(scenario);
  if (!scenario.equipment.model) {
    scenario.equipment.model = aircraftModel;
  }
  return {
    kind: "aircraft",
    aircraftModel,
    selectedEquipmentNodeKey: `aircraft:${aircraftModel}`
  };
}

function syncEquipmentAircraftTypesForModels(scenario) {
  if (!scenario.equipment) scenario.equipment = {};
  const models = Array.from(new Set((Array.isArray(scenario.equipment.wholeMachineModels)
    ? scenario.equipment.wholeMachineModels
    : wholeMachineModelsForScenario(scenario)
  ).map((model) => String(model || "").trim()).filter(Boolean)));
  const existingTypes = Array.isArray(scenario.equipment.aircraftTypes)
    ? scenario.equipment.aircraftTypes
    : [];
  scenario.equipment.aircraftTypes = models.map((model, index) => {
    const existing = existingTypes.find((aircraftType) => aircraftTypeModel(aircraftType) === model);
    return {
      id: cleanText(existing?.id) || aircraftTypeId(model, index + 1),
      model,
      name: cleanText(existing?.name) || model
    };
  });
}

function aircraftTypeModel(aircraftType) {
  if (typeof aircraftType === "string") return cleanText(aircraftType);
  if (!aircraftType || typeof aircraftType !== "object" || Array.isArray(aircraftType)) return "";
  return cleanText(aircraftType.model || aircraftType.name || aircraftType.id);
}

function aircraftTypeId(model, index) {
  const slug = String(model || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `aircraft-type-${slug}` : `aircraft-type-${index}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function nextEquipmentAircraftModel(scenario) {
  const existingModels = new Set(wholeMachineModelsForScenario(scenario));
  let index = existingModels.size + 1;
  while (existingModels.has(`新增飞机${index}`)) index += 1;
  return `新增飞机${index}`;
}

function nextEquipmentComponentId(scenario, aircraftModel, parentId) {
  const prefix = `${String(aircraftModel || "equipment").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(parentId || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-node`;
  const existingIds = new Set((scenario.components || []).map((component) => String(component.id || "")));
  let index = existingIds.size + 1;
  while (existingIds.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function findEquipmentComponentIndexById(components, componentId) {
  return components.findIndex((component) => String(component.id || "") === String(componentId || ""));
}

function clampIndex(index, length) {
  if (!length) return 0;
  const numeric = Number.isFinite(index) ? index : 0;
  return Math.min(Math.max(numeric, 0), Math.max(length - 1, 0));
}
