import { AVIATION_SUPPORT_OBJECT_GRAPH } from "./aviation-support-state.mjs";
import { FEATURE_PAGES } from "./feature-catalog.mjs";
import { PROJECT_JSON_CONTRACT, contractObjectPath } from "./project-json-contract.mjs";

export const ONTOLOGY_GROUPS = {
  "modeling-object": {
    label: "建模对象",
    summary: "由四级功能页与 project JSON contract 生成的可维护对象"
  },
  "simulation-experiment": {
    label: "仿真实验",
    summary: "实验方案、想定、运行控制和 Monte Carlo 配置"
  },
  "model-instance": {
    label: "模型实例",
    summary: "来自 AviationSupportModel.visualization_state() 的运行时对象"
  },
  "computation-artifact": {
    label: "计算产物",
    summary: "运行数据、指标序列、分析结论和方案清单"
  }
};

const SIMULATION_EXPERIMENT_NODES = [
  node("experiment-plan", "仿真实验方案", "simulation-experiment", "用户创建和编辑的实验方案入口。"),
  node("scenario", "实验想定", "simulation-experiment", "由建模对象组装出的单次或批量实验输入。"),
  node("visual-run-control", "可视化运行控制", "simulation-experiment", "启动、停止和切换运行视图。"),
  node("scenario-view", "场景视图", "simulation-experiment", "宏观任务、陆基保障和指标统计视图。"),
  node("monte-carlo-config", "蒙特卡洛配置", "simulation-experiment", "样本数、seed、故障率、备件倍数和保障容量扫参。"),
  node("simulation-run", "仿真运行", "simulation-experiment", "单次运行或批量样本的执行实例。")
];

const COMPUTATION_ARTIFACT_NODES = [
  node("run-dataset", "实验结果数据集", "computation-artifact", "单次运行与批量运行保存的原始结果。"),
  node("metric-time-series", "指标时间序列", "computation-artifact", "随时间推演计算的可靠度、完好率、短缺等指标。"),
  node("summary-dataset", "Summary", "computation-artifact", "运行结束后的聚合指标和参数组摘要。"),
  node("spare-shortfall-analysis", "备件短板分析", "computation-artifact", "按需求量、短缺量和满足率识别短板备件。"),
  node("carry-list-analysis", "转场携行清单", "computation-artifact", "基于短缺风险和利用率形成备件携行建议。"),
  node("task-reliability-analysis", "任务可靠度分析", "computation-artifact", "任务成功率、出动架次率和战备完好率分析。"),
  node("downtime-factor-analysis", "停机因素分析", "computation-artifact", "故障、备件短缺和资源延误等停机贡献。")
];

const SIMULATION_EXPERIMENT_EDGES = [
  edge("project:experiment", "experiment-plan", "定义"),
  edge("project:missionProfile", "scenario", "组装输入"),
  edge("project:basicMission", "scenario", "组装输入"),
  edge("project:equipment", "scenario", "组装输入"),
  edge("project:supportActivities", "scenario", "组装输入"),
  edge("project:monteCarlo", "monte-carlo-config", "配置扫参"),
  edge("experiment-plan", "scenario", "引用"),
  edge("scenario", "simulation-run", "驱动"),
  edge("visual-run-control", "simulation-run", "启动停止"),
  edge("scenario-view", "simulation-run", "观察"),
  edge("monte-carlo-config", "simulation-run", "批量生成")
];

const COMPUTATION_ARTIFACT_EDGES = [
  edge("simulation-run", "run-dataset", "保存"),
  edge("simulation-run", "metric-time-series", "逐步计算"),
  edge("run-dataset", "summary-dataset", "聚合"),
  edge("summary-dataset", "spare-shortfall-analysis", "支撑"),
  edge("summary-dataset", "carry-list-analysis", "支撑"),
  edge("summary-dataset", "task-reliability-analysis", "支撑"),
  edge("summary-dataset", "downtime-factor-analysis", "支撑")
];

const MODEL_INSTANCE_BRIDGE_EDGES = [
  ...AVIATION_SUPPORT_OBJECT_GRAPH.nodes
    .filter((item) => item.source?.runtimeType !== "metric")
    .map((item) => edge("simulation-run", item.id, "实例化/运行")),
  ...AVIATION_SUPPORT_OBJECT_GRAPH.nodes
    .filter((item) => item.source?.runtimeType === "metric")
    .map((item) => edge(item.id, "metric-time-series", "写入"))
];

export function buildProjectOntology({ module } = {}) {
  const modelingLayer = buildModelingObjectLayer(FEATURE_PAGES, PROJECT_JSON_CONTRACT, { module });
  return {
    nodes: dedupeNodes([
      ...modelingLayer.nodes,
      ...SIMULATION_EXPERIMENT_NODES,
      ...AVIATION_SUPPORT_OBJECT_GRAPH.nodes,
      ...COMPUTATION_ARTIFACT_NODES
    ]),
    edges: dedupeEdges([
      ...modelingLayer.edges,
      ...SIMULATION_EXPERIMENT_EDGES,
      ...AVIATION_SUPPORT_OBJECT_GRAPH.edges,
      ...MODEL_INSTANCE_BRIDGE_EDGES,
      ...COMPUTATION_ARTIFACT_EDGES
    ])
  };
}

export const PROJECT_ONTOLOGY = buildProjectOntology();

const NODE_DEFINITIONS = PROJECT_ONTOLOGY.nodes;
const EDGE_DEFINITIONS = PROJECT_ONTOLOGY.edges;

export const PROJECT_ONTOLOGY_PLAYGROUND = {
  name: "备件规划与任务可靠度项目Ontology",
  description: "面向备件规划、任务可靠度、仿真实验、模型实例和计算产物追踪的项目级 ontology。",
  entityTypes: NODE_DEFINITIONS.map(toPlaygroundEntityType),
  relationships: EDGE_DEFINITIONS.map(toPlaygroundRelationship)
};

const FOCUS_BY_COMPONENT = {
  "experiment-plan-list": ["experiment-plan", "scenario"],
  "experiment-plan-editor": ["experiment-plan", "scenario"],
  "visual-simulation": ["visual-run-control", "scenario-view", "simulation-run", "metric-time-series"],
  "scenario-switch": ["scenario-view", "simulation-run", "metric-time-series"],
  "monte-carlo-config": ["monte-carlo-config", "simulation-run", "run-dataset", "summary-dataset"],
  "monte-carlo-results": ["run-dataset", "summary-dataset", "metric-time-series"],
  analysis: ["summary-dataset", "spare-shortfall-analysis", "carry-list-analysis", "task-reliability-analysis", "downtime-factor-analysis"],
};

export function buildOntologyContext(page) {
  const ontology = buildProjectOntology({ module: page.module });
  const focusNodeIds = new Set();
  if (isModelingFeaturePage(page)) {
    for (const dataObject of page.dataObjects || []) {
      focusNodeIds.add(`project:${contractObjectPath(dataObject)}`);
    }
  }
  for (const id of FOCUS_BY_COMPONENT[page.component] || []) {
    focusNodeIds.add(id);
  }
  if (page.component === "visual-simulation") {
    focusNodeIds.add("simulation-run");
    for (const nodeItem of ontology.nodes.filter((item) => item.group === "model-instance").slice(0, 8)) {
      focusNodeIds.add(nodeItem.id);
    }
  }

  const expandedNodeIds = new Set(focusNodeIds);
  for (const edgeItem of ontology.edges) {
    if (focusNodeIds.has(edgeItem.from) || focusNodeIds.has(edgeItem.to)) {
      expandedNodeIds.add(edgeItem.from);
      expandedNodeIds.add(edgeItem.to);
    }
  }
  return {
    focusNodeIds: [...focusNodeIds],
    nodes: ontology.nodes.filter((item) => expandedNodeIds.has(item.id)),
    edges: ontology.edges.filter((item) => expandedNodeIds.has(item.from) && expandedNodeIds.has(item.to))
  };
}

export function groupOntologyNodes(nodes = PROJECT_ONTOLOGY.nodes) {
  return nodes.reduce((acc, item) => {
    acc[item.group] ||= [];
    acc[item.group].push(item);
    return acc;
  }, {});
}

function buildModelingObjectLayer(featurePages, projectContract, { module } = {}) {
  const modelingPages = featurePages.filter((page) => isModelingFeaturePage(page, module));
  const modelingObjectRoots = new Set(
    modelingPages.flatMap((page) => (page.dataObjects || []).map(contractObjectPath))
  );
  const featurePagesByObjectRoot = modelingPages.reduce((acc, page) => {
    for (const objectPath of new Set((page.dataObjects || []).map(contractObjectPath))) {
      acc[objectPath] ||= [];
      acc[objectPath].push({
        featureId: page.id,
        name: page.name,
        module: page.module,
        secondary: page.secondary,
        tertiary: page.tertiary,
        component: page.component,
        dataObjects: [...page.dataObjects]
      });
    }
    return acc;
  }, {});

  const contractNodes = projectContract.objects
    .filter((objectItem) => modelingObjectRoots.has(objectItem.path))
    .map((objectItem) => node(
      `project:${objectItem.path}`,
      objectItem.label,
      "modeling-object",
      `${objectItem.path} / ${objectItem.type} / 字段 ${objectItem.fieldPaths.length}`,
      {
        source: {
          kind: "project-json-contract",
          path: objectItem.path,
          type: objectItem.type,
          fieldPaths: objectItem.fieldPaths,
          featurePages: featurePagesByObjectRoot[objectItem.path] || []
        },
        layout: { cluster: "Project JSON" }
      }
    ));

  return {
    nodes: contractNodes,
    edges: []
  };
}

function isModelingFeaturePage(page, module) {
  return page.secondary === "仿真建模" && (!module || page.module === module);
}

function node(id, label, group, description, extra = {}) {
  return { id, label, group, description, ...extra };
}

function edge(from, to, label) {
  return { id: `${from}__${label}__${to}`, from, to, label };
}

function toPlaygroundEntityType(item) {
  const groupMeta = ONTOLOGY_GROUPS[item.group];
  return {
    id: item.id,
    name: item.label,
    description: item.description,
    icon: iconForGroup(item.group),
    color: colorForGroup(item.group),
    properties: [
      { name: `${camelize(item.id)}Id`, type: "string", isIdentifier: true },
      { name: "label", type: "string" },
      { name: "layer", type: "enum", values: Object.values(ONTOLOGY_GROUPS).map((group) => group.label) },
      ...(item.source ? [{ name: "sourceKind", type: "string" }] : []),
      ...(item.layout?.cluster ? [{ name: "cluster", type: "string" }] : []),
      ...(groupMeta ? [{ name: "layerSummary", type: "string" }] : [])
    ]
  };
}

function toPlaygroundRelationship(item) {
  return {
    id: item.id,
    name: item.label,
    from: item.from,
    to: item.to,
    cardinality: cardinalityForLabel(item.label),
    description: `${nodeLabel(item.from)} ${item.label} ${nodeLabel(item.to)}`,
    attributes: [{ name: "source", type: "string" }]
  };
}

function nodeLabel(id) {
  return NODE_DEFINITIONS.find((item) => item.id === id)?.label || id;
}

function colorForGroup(group) {
  const colors = {
    "modeling-object": "#0078D4",
    "simulation-experiment": "#008272",
    "model-instance": "#5C2D91",
    "computation-artifact": "#D83B01"
  };
  return colors[group] || "#64748B";
}

function iconForGroup(group) {
  const icons = {
    "modeling-object": "◇",
    "simulation-experiment": "▷",
    "model-instance": "○",
    "computation-artifact": "▣"
  };
  return icons[group] || "·";
}

function cardinalityForLabel(label) {
  if (["维护字段", "组装输入", "批量生成", "实例化/运行", "写入"].includes(label)) return "one-to-many";
  if (["引用", "驱动", "启动停止", "观察", "保存", "逐步计算", "聚合", "支撑"].includes(label)) return "many-to-one";
  if (["执行任务", "生成保障作业", "占用资源", "消耗备件", "采样指标"].includes(label)) return "many-to-many";
  return "one-to-one";
}

function camelize(id) {
  return id.replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

function dedupeNodes(nodes) {
  const seen = new Set();
  return nodes.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function dedupeEdges(edges) {
  const counts = new Map();
  return edges.map((item) => {
    const count = counts.get(item.id) || 0;
    counts.set(item.id, count + 1);
    return count === 0 ? item : { ...item, id: `${item.id}__${count + 1}` };
  });
}
