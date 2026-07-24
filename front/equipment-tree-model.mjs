import { ensureProductForComponent, normalizeProjectProducts } from "./product-catalog.mjs";

const AIRCRAFT_ROOT_ID = "aircraft-root";

export function exponentialMtbfHours(distribution) {
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return "";
  const directRate = Number(distribution.rate ?? distribution.lambda);
  if (Number.isFinite(directRate) && directRate > 0) return 1 / directRate;
  const parameters = cleanEquipmentText(distribution.parameters || distribution.params);
  const match = parameters.match(/(?:^|[,，;；\s])(?:lambda|λ|rate|failure_rate)\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
  const parameterRate = Number(match?.[1]);
  return Number.isFinite(parameterRate) && parameterRate > 0 ? 1 / parameterRate : "";
}

export function exponentialFailureDistributionForMtbfHours(distribution, mtbfHours) {
  const mtbf = Number(mtbfHours);
  if (!Number.isFinite(mtbf) || mtbf <= 0) return null;
  const next = {
    ...(distribution && typeof distribution === "object" && !Array.isArray(distribution) ? distribution : {})
  };
  delete next.parameters;
  delete next.params;
  delete next.lambda;
  next.rate = 1 / mtbf;
  return next;
}

export function normalizeEquipmentTreeIntegrityForScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return scenario;
  if (!Array.isArray(scenario.components)) scenario.components = [];

  const componentIds = new Set(scenario.components.map((component) => cleanEquipmentText(component?.id)).filter(Boolean));
  const needsAircraftRoot = scenario.components.some((component) => (
    cleanEquipmentText(component?.parentId) === AIRCRAFT_ROOT_ID
  ));
  if (needsAircraftRoot && !componentIds.has(AIRCRAFT_ROOT_ID)) {
    const aircraftModel = wholeMachineModelsForScenario(scenario)[0] || cleanEquipmentText(scenario.equipment?.model);
    const quantity = equipmentRootQuantity(scenario);
    scenario.components.push({
      id: AIRCRAFT_ROOT_ID,
      name: aircraftModel ? `${aircraftModel}（整机）` : "整机",
      productId: "product-aircraft-root",
      aircraftModel,
      productType: "whole",
      quantity,
      kOutOfN: { enabled: quantity > 1, n: quantity, k: quantity }
    });
    componentIds.add(AIRCRAFT_ROOT_ID);
  }

  for (const product of Array.isArray(scenario.products) ? scenario.products : []) {
    normalizeLegacyFailureDistributionType(product?.failureDistribution);
  }
  normalizeProjectProducts(scenario);
  for (const component of scenario.components) {
    normalizeLegacyFailureDistributionType(component?.failureDistribution);
  }

  const resolvedIds = new Set(scenario.components.map((component) => cleanEquipmentText(component?.id)).filter(Boolean));
  if (resolvedIds.has(AIRCRAFT_ROOT_ID)) {
    for (const activity of Array.isArray(scenario.supportActivities) ? scenario.supportActivities : []) {
      const equipmentId = cleanEquipmentText(activity?.equipmentId);
      const activityName = cleanEquipmentText(activity?.activityName || activity?.name);
      if (equipmentId && !resolvedIds.has(equipmentId) && /整机|舰载机/.test(activityName)) {
        activity.equipmentId = AIRCRAFT_ROOT_ID;
      }
    }
  }
  return scenario;
}

function equipmentRootQuantity(scenario) {
  const explicitQuantity = Number(scenario?.equipment?.quantity);
  if (Number.isInteger(explicitQuantity) && explicitQuantity > 0) return explicitQuantity;
  const memberCount = Array.isArray(scenario?.combatUnit?.members) ? scenario.combatUnit.members.length : 0;
  return Math.max(1, memberCount);
}

function normalizeLegacyFailureDistributionType(distribution) {
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return;
  const parameters = cleanEquipmentText(distribution.parameters || distribution.params).toLocaleLowerCase();
  const distributionType = cleanEquipmentText(distribution.distributionType || distribution.distribution_type).toLocaleLowerCase();
  if (!parameters || !distributionType) return;
  const hasRate = /(?:^|[,，;；\s])(lambda|λ|rate|failure_rate)\s*=/.test(parameters);
  const hasMean = /(?:^|[,，;；\s])(mean|mu)\s*=/.test(parameters);
  if ((distributionType.includes("exponential") || distributionType.includes("指数")) && hasMean && !hasRate) {
    distribution.distributionType = distributionType.includes("指数") ? "正态分布" : "normal";
  } else if ((distributionType.includes("normal") || distributionType.includes("正态")) && hasRate) {
    distribution.distributionType = distributionType.includes("正态") ? "指数分布" : "exponential";
  }
}

function cleanEquipmentText(value) {
  return String(value ?? "").trim();
}

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

export function equipmentKOutOfNQuantity(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

export function normalizeEquipmentComponentKOutOfN(component) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return component;
  const quantity = equipmentKOutOfNQuantity(component.quantity);
  component.quantity = quantity;
  const rawK = component.kOutOfN && typeof component.kOutOfN === "object" && !Array.isArray(component.kOutOfN)
    ? component.kOutOfN.k
    : undefined;
  const rawNumber = Number(rawK);
  const k = Number.isInteger(rawNumber) && rawNumber >= 1 && rawNumber <= quantity ? rawNumber : quantity;
  component.kOutOfN = { ...(component.kOutOfN || {}), enabled: quantity > 1, n: quantity, k };
  return component;
}

export function validateEquipmentComponentKOutOfN(component) {
  const quantity = equipmentKOutOfNQuantity(component?.quantity);
  const rawK = component?.kOutOfN && typeof component.kOutOfN === "object" && !Array.isArray(component.kOutOfN)
    ? component.kOutOfN.k
    : undefined;
  if (rawK === undefined || rawK === null || rawK === "") {
    return "K 值不能为空；默认应等于数量 n。";
  }
  const number = Number(rawK);
  if (!Number.isInteger(number) || number < 1) {
    return "K 值必须为正整数，且满足 1 ≤ k ≤ n。";
  }
  if (number > quantity) {
    return "K 值不能大于数量 n；K 值必须满足 1 ≤ k ≤ n。";
  }
  return "";
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
  normalizeProjectProducts(scenario);
  const selectedState = selection || resolveEquipmentSelectionModel({
    scenario,
    selectedEquipmentNodeKey: "aircraft-list",
    selectedEquipmentComponentIndex: 0
  });
  if (selectedState.kind === "aircraft-list") {
    return addEquipmentAircraftForSelectionModel(scenario);
  }

  const aircraftModel = selectedState.aircraftModel || wholeMachineModelsForScenario(scenario)[0] || scenario.equipment.model || "装备";
  const parentStorageId = selectedState.kind === "aircraft" ? "" : selectedState.component.id;
  const parentDisplayId = selectedState.kind === "aircraft" ? "aircraft-root" : parentStorageId;
  const siblingCount = scenario.components.filter((component) => (
    componentBelongsToAircraftModel(component, aircraftModel)
    && String(component.parentId || "aircraft-root") === String(parentDisplayId)
  )).length;
  const newComponent = {
    id: nextEquipmentComponentId(scenario, aircraftModel, parentDisplayId),
    aircraftModel,
    parentId: parentStorageId,
    name: selectedState.kind === "aircraft" ? `新增分系统${siblingCount + 1}` : `新增子系统${siblingCount + 1}`,
    productType: selectedState.kind === "aircraft" ? "非LRU" : "LRU",
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
  normalizeEquipmentComponentKOutOfN(newComponent);
  scenario.components.push(newComponent);
  ensureProductForComponent(scenario, newComponent);
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
  const deletedIds = equipmentComponentSubtreeIds(scenario, {
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

export function equipmentComponentSubtreeIds(scenario, { aircraftModel, rootComponentId }) {
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
