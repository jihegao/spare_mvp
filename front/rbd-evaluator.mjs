export function seriesReliability(values) {
  return values.reduce((product, value) => product * Number(value), 1);
}

export function parallelReliability(values) {
  const failureProduct = values.reduce((product, value) => product * (1 - Number(value)), 1);
  return 1 - failureProduct;
}

export function kOfNReliability(k, values) {
  const probabilities = values.map(Number);
  let probability = 0;
  for (let mask = 0; mask < 2 ** probabilities.length; mask += 1) {
    let successes = 0;
    let term = 1;
    for (let index = 0; index < probabilities.length; index += 1) {
      const success = Boolean(mask & (1 << index));
      successes += success ? 1 : 0;
      term *= success ? probabilities[index] : 1 - probabilities[index];
    }
    if (successes >= k) probability += term;
  }
  return probability;
}

export function evaluateReliabilityGroup(group, nodeReliabilityById) {
  const values = group.children.map((id) => nodeReliabilityById[id]);
  if (group.type === "parallel") return parallelReliability(values);
  if (group.type === "k_of_n") return kOfNReliability(group.k || 1, values);
  return seriesReliability(values);
}

export function evaluateBottomUpReliability(project, nodeResults) {
  const reliabilityById = Object.fromEntries(nodeResults.map((row) => [row.nodeId, row.reliability]));
  const rootGroup = project.reliabilityGroups?.find((group) => group.parentNodeId === project.rootId);
  if (!rootGroup) return seriesReliability(nodeResults.map((row) => row.reliability));
  return evaluateReliabilityGroup(rootGroup, reliabilityById);
}

export function normalizeReliabilityConnectionType(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("并") || text.includes("parallel")) return "parallel";
  if (text.includes("备用") || text.includes("standby")) return "standby";
  return "series";
}

export function reliabilityConnectionLabel(logic) {
  if (logic === "gate") return "门逻辑";
  if (logic === "parallel") return "并联";
  if (logic === "standby") return "备用";
  return "串联";
}

export function kOutOfNText(kOutOfN, quantity) {
  const n = Math.trunc(Number(kOutOfN?.n ?? quantity) || 0);
  const k = Math.trunc(Number(kOutOfN?.k) || 0);
  if (!kOutOfN?.enabled || n <= 1 || k < 1) return "";
  return `${n}中取${Math.min(k, n)}`;
}

export function buildReliabilityBlockDiagramLayout(project = {}) {
  const sourceNodes = normalizeReliabilityNodes(project);
  if (!sourceNodes.length) return emptyReliabilityBlockDiagramLayout();

  const rootNodes = sourceNodes.filter((node) => node.isRoot);
  const root = rootNodes.length === 1 && sourceNodes.length > 1 ? rootNodes[0] : null;
  const flowNodes = root ? sourceNodes.filter((node) => node.id !== root.id) : sourceNodes;
  const stages = buildReliabilityStages(flowNodes);
  const maxStageSize = Math.max(1, ...stages.map((stage) => stage.nodes.length));
  const nodeWidth = 156;
  const nodeHeight = 64;
  const stageGap = 86;
  const laneGap = 26;
  const terminalPadding = 32;
  const centerY = terminalPadding + Math.max(nodeHeight, maxStageSize * nodeHeight + (maxStageSize - 1) * laneGap) / 2;
  const height = Math.ceil(centerY * 2);
  const allStages = root ? [{ relation: "series", label: "系统", nodes: [root] }, ...stages] : stages;
  const layoutNodes = [];
  const groups = [];

  allStages.forEach((stage, stageIndex) => {
    const x = terminalPadding + stageIndex * (nodeWidth + stageGap) + 42;
    const totalHeight = stage.nodes.length * nodeHeight + (stage.nodes.length - 1) * laneGap;
    const startY = centerY - totalHeight / 2;
    stage.nodes.forEach((node, nodeIndex) => {
      layoutNodes.push({
        ...node,
        x,
        y: startY + nodeIndex * (nodeHeight + laneGap),
        width: nodeWidth,
        height: nodeHeight,
        stageIndex
      });
    });
    if (stage.nodes.length > 1 || stage.relation !== "series") {
      groups.push({
        id: `stage-${stageIndex}`,
        relation: stage.relation,
        label: stage.label,
        sourceNodeId: stage.sourceNodeId || "",
        stageIndex,
        isKOutOfN: Boolean(stage.isKOutOfN),
        x: x - 18,
        y: startY - 18,
        width: nodeWidth + 36,
        height: totalHeight + 36,
        nodeIds: stage.nodes.map((node) => node.id)
      });
    }
  });

  const width = terminalPadding * 2 + allStages.length * nodeWidth + Math.max(0, allStages.length - 1) * stageGap + 84;
  return {
    width,
    height,
    terminalStart: { x: 24, y: centerY },
    terminalEnd: { x: width - 24, y: centerY },
    nodes: layoutNodes,
    connectors: buildReliabilityConnectors(layoutNodes, width, centerY),
    groups,
    logicalNodes: sourceNodes
  };
}

export function reliabilityDiagramProjectForSelection(project = {}, selection = {}) {
  const selectedState = selection || {};
  const diagram = project.reliabilityBlockDiagram;
  if (diagram && Array.isArray(diagram.nodes) && diagram.nodes.length) {
    return reliabilityDiagramFromExplicitNodes(project, selectedState);
  }
  return reliabilityDiagramFromComponents(project, selectedState);
}

function emptyReliabilityBlockDiagramLayout() {
  return {
    width: 720,
    height: 180,
    terminalStart: { x: 24, y: 90 },
    terminalEnd: { x: 696, y: 90 },
    nodes: [],
    connectors: [],
    groups: [],
    logicalNodes: []
  };
}

function normalizeReliabilityNodes(project) {
  const rawDiagramNodes = Array.isArray(project.reliabilityBlockDiagram?.nodes)
    ? project.reliabilityBlockDiagram.nodes
    : [];
  const components = Array.isArray(project.components) ? project.components : [];
  const sourceNodes = rawDiagramNodes.length ? rawDiagramNodes : synthesizeReliabilityNodesFromComponents(project, components);
  const nodeIds = new Set(sourceNodes.map((node) => String(node.id)));
  return sourceNodes.map((node, index) => {
    const component = findReliabilityComponent(node, components);
    const kOutOfN = normalizeKOutOfN(component?.kOutOfN, component?.quantity);
    const kOutOfNLabel = kOutOfN ? `${kOutOfN.n}中取${kOutOfN.k}` : "";
    const connectionType = node.connectionType || component?.connectionType || "串联";
    const logic = normalizeReliabilityLogic(node, connectionType);
    const parentId = node.parentId == null ? "" : String(node.parentId);
    return {
      id: String(node.id || component?.id || `rbd-node-${index + 1}`),
      name: node.name || component?.name || `节点${index + 1}`,
      type: node.type || component?.productType || "component",
      connectionType,
      logic,
      connectionLabel: reliabilityConnectionLabel(logic),
      failureRate: node.failureRate ?? component?.failureRate ?? "",
      mtbfHours: node.mtbfHours ?? component?.mtbfHours ?? "",
      reliability: component?.rms?.reliability ?? node.reliability ?? "",
      kOutOfNLabel,
      kOutOfN,
      isRoot: index === 0 || parentId === "" || !nodeIds.has(parentId),
      parentId
    };
  });
}

function normalizeKOutOfN(kOutOfN, quantity) {
  const n = Math.trunc(Number(kOutOfN?.n ?? quantity) || 0);
  const k = Math.trunc(Number(kOutOfN?.k) || 0);
  if (!kOutOfN?.enabled || n <= 1 || k < 1) return null;
  return { enabled: true, n, k: Math.min(k, n) };
}

function normalizeReliabilityLogic(node, connectionType) {
  const explicitLogic = String(node?.logic || node?.gateType || "").toLowerCase();
  if (String(node?.type || "").toLowerCase().includes("gate") || explicitLogic.includes("gate")) {
    if (explicitLogic.includes("parallel") || explicitLogic.includes("并")) return "parallel";
    if (explicitLogic.includes("standby") || explicitLogic.includes("备用")) return "standby";
    if (explicitLogic.includes("series") || explicitLogic.includes("串")) return "series";
    return "gate";
  }
  return normalizeReliabilityConnectionType(connectionType);
}

function reliabilityDiagramFromExplicitNodes(project, selection) {
  const diagram = project.reliabilityBlockDiagram || {};
  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
  if (isAircraftListSelection(selection)) return emptySelectedReliabilityProject(project, diagram);
  const isAircraftSelection = isWholeAircraftSelection(selection);
  const selectedId = selectedReliabilityNodeId(nodes, selection);
  if (!selectedId) return project;
  const selectedNode = nodes.find((node) => String(node.id) === selectedId);
  if (!selectedNode) return reliabilityDiagramFromComponents(project, selection);
  const childNodes = nodes.filter((node) => String(node.parentId || "") === selectedId);
  if (!isAircraftSelection && !childNodes.length && selection?.kind === "component") {
    return reliabilityDiagramFromComponents({ ...project, reliabilityBlockDiagram: undefined }, selection);
  }
  const selectedAndChildren = isAircraftSelection || !isReliabilityGateNode(selectedNode)
    ? childNodes
    : [selectedNode, ...childNodes].filter(Boolean);
  const nodeIds = new Set(selectedAndChildren.map((node) => String(node.id)));
  if (!selectedAndChildren.length) return emptySelectedReliabilityProject(project, diagram);
  return {
    ...project,
    reliabilityBlockDiagram: {
      ...diagram,
      nodes: selectedAndChildren.map((node, index) => ({
        ...node,
        connectionType: isAircraftSelection ? topLevelReliabilityConnectionType(node, project.components) : node.connectionType,
        parentId: index === 0 || isAircraftSelection || !isReliabilityGateNode(selectedNode) ? null : selectedId
      })),
      edges: isAircraftSelection
        ? []
        : edges.filter((edge) => nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to)))
    }
  };
}

function reliabilityDiagramFromComponents(project, selection) {
  const components = Array.isArray(project.components) ? project.components : [];
  if (!components.length) return project;
  if (isAircraftListSelection(selection)) return emptySelectedReliabilityProject(project, project.reliabilityBlockDiagram || {});
  const selectedId = selection?.kind === "component" ? String(selection.component?.id || "") : "aircraft-root";
  const isAircraftSelection = isWholeAircraftSelection(selection);
  const aircraftModel = selection?.aircraftModel || project.equipment?.model || "";
  const childComponents = components.filter((component) => {
    const parentId = String(component.parentId || "aircraft-root");
    return parentId === selectedId
      && (!aircraftModel || !component.aircraftModel || String(component.aircraftModel) === String(aircraftModel));
  });
  const selectedComponent = selectedId === "aircraft-root"
    ? {
        id: "aircraft-root",
        name: aircraftModel || project.equipment?.model || "整机",
        productType: "system",
        connectionType: "串联",
        parentId: null
      }
    : components.find((component) => String(component.id || "") === selectedId);
  const selectedAndChildren = isAircraftSelection ? childComponents : childComponents;
  if (!selectedAndChildren.length) return emptySelectedReliabilityProject(project, project.reliabilityBlockDiagram || {});
  return {
    ...project,
    components: selectedAndChildren,
    reliabilityBlockDiagram: {
      nodes: selectedAndChildren.map((component, index) => ({
        id: component.id,
        name: component.name,
        type: component.productType || (index === 0 ? "system" : "component"),
        connectionType: isAircraftSelection ? topLevelReliabilityConnectionType(component, [component]) : (component.connectionType || "串联"),
        parentId: null,
        failureRate: component.failureRate,
        mtbfHours: component.mtbfHours
      })),
      edges: []
    }
  };
}

function isReliabilityGateNode(node) {
  return String(node?.type || "").toLowerCase().includes("gate")
    || String(node?.logic || "").toLowerCase().includes("gate");
}

function isWholeAircraftSelection(selection) {
  return selection?.kind !== "component";
}

function isAircraftListSelection(selection) {
  return selection?.kind === "aircraft-list";
}

function emptySelectedReliabilityProject(project, diagram) {
  return {
    ...project,
    components: [],
    reliabilityBlockDiagram: {
      ...diagram,
      nodes: [],
      edges: []
    }
  };
}

function topLevelReliabilityConnectionType(nodeOrComponent, components = []) {
  const component = findReliabilityComponent(nodeOrComponent, Array.isArray(components) ? components : []);
  const kOutOfN = component?.kOutOfN || nodeOrComponent?.kOutOfN;
  return hasEnabledKOutOfN(kOutOfN, component?.quantity ?? nodeOrComponent?.quantity) ? "并联" : "串联";
}

function hasEnabledKOutOfN(kOutOfN, quantity) {
  const n = Math.trunc(Number(kOutOfN?.n ?? quantity) || 0);
  const k = Math.trunc(Number(kOutOfN?.k) || 0);
  return Boolean(kOutOfN?.enabled) && n > 1 && k >= 1;
}

function selectedReliabilityNodeId(nodes, selection) {
  if (selection?.kind === "component") {
    const component = selection.component || {};
    const explicitId = String(component.id || "");
    const exact = nodes.find((node) => String(node.id || "") === explicitId || String(node.componentId || "") === explicitId);
    if (exact) return String(exact.id || "");
    const componentName = normalizeReliabilityLookupKey(component.name);
    const byName = nodes.find((node) => componentName && normalizeReliabilityLookupKey(node.name) === componentName);
    if (byName) return String(byName.id || "");
    const idSuffix = reliabilityComponentIdSuffix(explicitId);
    const bySuffix = nodes.find((node) => idSuffix && normalizeReliabilityLookupKey(node.id) === idSuffix);
    return bySuffix ? String(bySuffix.id || "") : explicitId;
  }
  if (selection?.kind === "aircraft") {
    const root = nodes.find((node) => node.parentId == null || node.parentId === "");
    return root ? String(root.id || "") : "";
  }
  return "";
}

function reliabilityComponentIdSuffix(id) {
  const parts = String(id || "").split("-").filter(Boolean);
  return normalizeReliabilityLookupKey(parts.length > 1 ? parts.slice(1).join("-") : id);
}

function normalizeReliabilityLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function synthesizeReliabilityNodesFromComponents(project, components) {
  if (!components.length) return [];
  const componentIds = new Set(components.map((component) => String(component.id)));
  const rootParentIds = new Set(
    components
      .map((component) => component.parentId == null ? "" : String(component.parentId))
      .filter((parentId) => parentId && !componentIds.has(parentId))
  );
  const rootId = rootParentIds.values().next().value || "rbd-root";
  return [
    {
      id: rootId,
      name: project.equipment?.model || "整机",
      type: "system",
      connectionType: "串联",
      parentId: null,
      failureRate: "",
      mtbfHours: ""
    },
    ...components.map((component) => ({
      id: component.id,
      name: component.name,
      type: component.productType || "component",
      connectionType: component.connectionType,
      parentId: component.parentId && componentIds.has(String(component.parentId)) ? component.parentId : rootId,
      failureRate: component.failureRate,
      mtbfHours: component.mtbfHours
    }))
  ];
}

function findReliabilityComponent(node, components) {
  return components.find((component) => String(component.id) === String(node.id))
    || components.find((component) => component.name && component.name === node.name)
    || null;
}

function buildReliabilityStages(nodes) {
  const stages = [];
  let branchStage = null;
  for (const node of nodes) {
    if (node.kOutOfN) {
      if (branchStage) {
        stages.push(branchStage);
        branchStage = null;
      }
      stages.push({
        relation: "parallel",
        label: `并联 / ${node.kOutOfNLabel}`,
        nodes: buildReliabilityReplicaNodes(node),
        sourceNodeId: node.id,
        isKOutOfN: true
      });
      continue;
    }
    if (node.logic === "series") {
      if (branchStage) {
        stages.push(branchStage);
        branchStage = null;
      }
      stages.push({ relation: "series", label: "串联", nodes: [node] });
      continue;
    }
    if (!branchStage) {
      branchStage = { relation: node.logic, label: reliabilityConnectionLabel(node.logic), nodes: [] };
    }
    branchStage.nodes.push(node);
    branchStage.relation = branchStage.relation === node.logic ? branchStage.relation : "parallel";
    branchStage.label = Array.from(new Set(branchStage.nodes.map((item) => item.connectionLabel).filter(Boolean))).join("/");
  }
  if (branchStage) stages.push(branchStage);
  return stages;
}

function buildReliabilityReplicaNodes(node) {
  const replicaCount = Math.max(2, Math.min(8, Number(node.kOutOfN?.n || 2)));
  return Array.from({ length: replicaCount }, (_, index) => ({
    ...node,
    id: `${node.id}::replica-${index + 1}`,
    sourceNodeId: node.id,
    replicaIndex: index + 1,
    replicaCount,
    isReplica: true,
    logic: "parallel",
    connectionType: "并联",
    connectionLabel: "并联分支",
    kOutOfNLabel: ""
  }));
}

function buildReliabilityConnectors(nodes, width, centerY) {
  if (!nodes.length) return [];
  const byStage = new Map();
  for (const node of nodes) {
    if (!byStage.has(node.stageIndex)) byStage.set(node.stageIndex, []);
    byStage.get(node.stageIndex).push(node);
  }
  const stages = Array.from(byStage.keys()).sort((a, b) => a - b).map((stageIndex) => byStage.get(stageIndex));
  const connectors = [];
  const firstStage = stages[0];
  const firstX = Math.min(...firstStage.map((node) => node.x));
  const firstYs = firstStage.map((node) => node.y + node.height / 2);
  connectors.push(...buildStageEntryConnectors({
    fromX: 24,
    fromY: centerY,
    toX: firstX,
    toYs: firstYs,
    relation: firstStage.length > 1 ? "parallel" : "series",
    toStageIndex: firstStage[0].stageIndex
  }));
  for (let index = 0; index < stages.length - 1; index += 1) {
    const current = stages[index];
    const next = stages[index + 1];
    const fromX = Math.max(...current.map((node) => node.x + node.width));
    const toX = Math.min(...next.map((node) => node.x));
    const midX = (fromX + toX) / 2;
    const currentYs = current.map((node) => node.y + node.height / 2);
    const nextYs = next.map((node) => node.y + node.height / 2);
    const relation = next.length > 1 ? "parallel" : next[0].logic;
    connectors.push(...buildStageTransitionConnectors({
      fromX,
      fromYs: currentYs,
      toX,
      toYs: nextYs,
      midX,
      relation: current.length > 1 ? "parallel" : relation,
      fromStageIndex: current[0].stageIndex,
      toStageIndex: next[0].stageIndex
    }));
  }
  const lastStage = stages.at(-1);
  const lastX = Math.max(...lastStage.map((node) => node.x + node.width));
  const lastYs = lastStage.map((node) => node.y + node.height / 2);
  connectors.push(...buildStageExitConnectors({
    fromX: lastX,
    fromYs: lastYs,
    toX: width - 24,
    toY: centerY,
    relation: lastStage.length > 1 ? "parallel" : "series",
    fromStageIndex: lastStage[0].stageIndex
  }));
  return connectors;
}

function buildStageEntryConnectors({ fromX, fromY, toX, toYs, relation, toStageIndex }) {
  if (toYs.length <= 1) {
    return [{ relation, toStageIndex, path: `M ${fromX} ${fromY} H ${toX}` }];
  }
  const midX = (fromX + toX) / 2;
  return toYs.map((toY) => ({
    relation,
    toStageIndex,
    path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`
  }));
}

function buildStageTransitionConnectors({ fromX, fromYs, toX, toYs, midX, relation, fromStageIndex, toStageIndex }) {
  if (toYs.length > 1) {
    const fromY = averageNumber(fromYs);
    return toYs.map((toY) => ({
      relation,
      fromStageIndex,
      toStageIndex,
      path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`
    }));
  }
  const toY = toYs[0];
  if (fromYs.length > 1) {
    return fromYs.map((fromY) => ({
      relation,
      fromStageIndex,
      toStageIndex,
      path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`
    }));
  }
  return [{
    relation,
    fromStageIndex,
    toStageIndex,
    path: `M ${fromX} ${fromYs[0]} H ${toX}`
  }];
}

function buildStageExitConnectors({ fromX, fromYs, toX, toY, relation, fromStageIndex }) {
  if (fromYs.length <= 1) {
    return [{ relation, fromStageIndex, path: `M ${fromX} ${fromYs[0]} H ${toX}` }];
  }
  const midX = (fromX + toX) / 2;
  return fromYs.map((fromY) => ({
    relation,
    fromStageIndex,
    path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`
  }));
}

function averageNumber(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}
