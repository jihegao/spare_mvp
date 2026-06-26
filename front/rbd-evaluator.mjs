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
  const root = sourceNodes.find((node) => node.isRoot) || sourceNodes[0] || null;
  if (!root) return emptyReliabilityBlockDiagramLayout();

  const flowNodes = sourceNodes.filter((node) => node.id !== root.id);
  const stages = buildReliabilityStages(flowNodes);
  const maxStageSize = Math.max(1, ...stages.map((stage) => stage.nodes.length));
  const nodeWidth = 156;
  const nodeHeight = 64;
  const stageGap = 86;
  const laneGap = 26;
  const terminalPadding = 32;
  const centerY = terminalPadding + Math.max(nodeHeight, maxStageSize * nodeHeight + (maxStageSize - 1) * laneGap) / 2;
  const height = Math.ceil(centerY * 2);
  const allStages = [{ relation: "series", label: "系统", nodes: [root] }, ...stages];
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
    groups
  };
}

function emptyReliabilityBlockDiagramLayout() {
  return {
    width: 720,
    height: 180,
    terminalStart: { x: 24, y: 90 },
    terminalEnd: { x: 696, y: 90 },
    nodes: [],
    connectors: [],
    groups: []
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
    const kOutOfNLabel = kOutOfNText(component?.kOutOfN, component?.quantity);
    const connectionType = component?.connectionType || node.connectionType || "串联";
    const logic = normalizeReliabilityConnectionType(connectionType);
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
      isRoot: index === 0 || parentId === "" || !nodeIds.has(parentId),
      parentId
    };
  });
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

function buildReliabilityConnectors(nodes, width, centerY) {
  if (!nodes.length) return [];
  const byStage = new Map();
  for (const node of nodes) {
    if (!byStage.has(node.stageIndex)) byStage.set(node.stageIndex, []);
    byStage.get(node.stageIndex).push(node);
  }
  const stages = Array.from(byStage.keys()).sort((a, b) => a - b).map((stageIndex) => byStage.get(stageIndex));
  const connectors = [{ relation: "series", path: `M 24 ${centerY} H ${nodes[0].x}` }];
  for (let index = 0; index < stages.length - 1; index += 1) {
    const current = stages[index];
    const next = stages[index + 1];
    const fromX = Math.max(...current.map((node) => node.x + node.width));
    const toX = Math.min(...next.map((node) => node.x));
    const midX = (fromX + toX) / 2;
    const currentYs = current.map((node) => node.y + node.height / 2);
    const nextYs = next.map((node) => node.y + node.height / 2);
    const fromY = averageNumber(currentYs);
    const relation = next.length > 1 ? "parallel" : next[0].logic;
    for (const toY of nextYs) {
      connectors.push({
        relation,
        path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`
      });
    }
  }
  const lastStage = stages.at(-1);
  const lastX = Math.max(...lastStage.map((node) => node.x + node.width));
  const lastY = averageNumber(lastStage.map((node) => node.y + node.height / 2));
  connectors.push({ relation: lastStage.length > 1 ? "parallel" : "series", path: `M ${lastX} ${lastY} H ${width - 24}` });
  return connectors;
}

function averageNumber(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}
