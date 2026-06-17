export const ONTOLOGY_GROUPS = {
  "modeling-object": {
    label: "项目建模对象",
    summary: "任务、装备、保障和指标分配等可编辑对象"
  },
  "simulation-experiment": {
    label: "仿真实验",
    summary: "实验方案、想定、运行控制和 Monte Carlo 配置"
  },
  "computation-artifact": {
    label: "计算产物",
    summary: "运行数据、指标序列、分析结论和方案清单"
  }
};

const NODE_DEFINITIONS = [
    node("built-in-scenario", "内置场景", "modeling-object", "装备出发机场、任务区和初始业务环境。", layout(70, 118, "场景")),
    node("airport", "机场", "modeling-object", "内置场景中的出发机场、保障机场或库存位置。", layout(70, 178, "场景")),
    node("mission-area", "任务区", "modeling-object", "内置场景中的任务区域描述。", layout(285, 178, "场景")),

    node("task", "任务", "modeling-object", "任务建模的上层对象，组织基本任务、日剖面和长周期剖面。", layout(70, 278, "任务")),
    node("mission-profile", "任务剖面", "modeling-object", "任务剖面的统称，向下展开为日剖面和长周期剖面。", layout(285, 278, "任务")),
    node("basic-mission", "基本任务", "modeling-object", "基本任务名称、出动时间、时长、成功时点、机型和数量约束。", layout(70, 338, "任务")),
    node("daily-profile", "日剖面", "modeling-object", "包含基本任务的重复次数和重复间隔。", layout(285, 338, "任务")),
    node("long-cycle-profile", "长周期剖面", "modeling-object", "由 N 个日剖面组成周期，并配置周期重复次数。", layout(500, 338, "任务")),
    node("aircraft-model", "机型", "modeling-object", "基本任务和基本作战单元引用的飞机型号。", layout(70, 398, "任务")),
    node("aircraft-quantity", "飞机数量", "modeling-object", "基本任务要求数量、基本作战单元飞机数量。", layout(285, 398, "任务")),
    node("min-sortie-quantity", "最小出动数量", "modeling-object", "基本任务成功判定所需最小出动数量。", layout(500, 398, "任务")),
    node("sortie-time", "出动时间", "modeling-object", "基本任务出动或任务下达时刻。", layout(70, 458, "任务")),
    node("mission-duration", "任务时长", "modeling-object", "基本任务执行持续时间。", layout(285, 458, "任务")),
    node("success-time", "成功时点", "modeling-object", "任务是否完成的判定时点。", layout(500, 458, "任务")),
    node("task-name", "任务名称", "modeling-object", "基本任务名称，项目内唯一。", layout(70, 518, "任务")),

    node("combat-unit", "基本作战单元", "modeling-object", "按编队组织飞机型号、飞机数量和飞机编号。", layout(70, 610, "作战单元")),
    node("equipment", "装备", "modeling-object", "可出动、故障、维修并回到可用状态的装备实例。", layout(285, 610, "装备")),
    node("equipment-system", "系统", "modeling-object", "装备构型中的系统级节点，可继续挂接子节点。", layout(70, 670, "装备")),
    node("analysis-diagram", "分析图", "modeling-object", "装备分析图或可靠性连接图。", layout(285, 670, "装备")),
    node("component", "组件", "modeling-object", "装备组成节点，可配置型号、数量、LRU 和可靠性参数。", layout(500, 670, "装备")),
    node("component-quantity", "组件数量", "modeling-object", "装备构型节点数量 n。", layout(70, 730, "装备")),
    node("component-parent", "上级节点", "modeling-object", "组件、系统或分析图在装备树中的父节点。", layout(285, 730, "装备")),
    node("lru-flag", "是否LRU", "modeling-object", "系统、分析图或组件是否启用 LRU 参数编辑。", layout(500, 730, "装备")),
    node("reliability-block-diagram", "可靠性框图", "modeling-object", "组件之间串联、并联、备用和 k/n 关系。", layout(285, 790, "装备")),

    node("support-node", "保障组织结构", "modeling-object", "机场、保障点、库存点和调运策略。", layout(70, 890, "保障")),
    node("spare-part", "备件", "modeling-object", "库存、消耗、短缺和携行清单的基础对象。", layout(285, 890, "保障")),
    node("support-resource", "保障资源", "modeling-object", "人员、设备和活动所需资源组合。", layout(500, 890, "保障")),
    node("support-activity", "保障活动", "modeling-object", "飞行前保障、修复性维修、预防性维修和再次出动准备。", layout(285, 950, "保障")),
    node("metric-plan", "指标分配方案", "modeling-object", "RMS 分配结果和导入到模型的指标约束。", layout(500, 950, "保障")),

    node("experiment-plan", "仿真实验方案", "simulation-experiment", "用户创建和编辑的实验方案入口。"),
    node("scenario", "实验想定", "simulation-experiment", "由建模对象组装出的单次或批量实验输入。"),
    node("visual-run-control", "可视化运行控制", "simulation-experiment", "启动、停止和切换运行视图。"),
    node("scenario-view", "场景视图", "simulation-experiment", "宏观任务、陆基/舰基和指标统计视图。"),
    node("monte-carlo-config", "蒙特卡洛配置", "simulation-experiment", "样本数、seed、故障率、备件倍数和保障容量扫参。"),
    node("simulation-run", "仿真运行", "simulation-experiment", "单次运行或批量样本的执行实例。"),

    node("run-dataset", "实验结果数据集", "computation-artifact", "单次运行与批量运行保存的原始结果。"),
    node("metric-time-series", "指标时间序列", "computation-artifact", "随时间推演计算的可靠度、完好率、短缺等指标。"),
    node("summary-dataset", "Summary", "computation-artifact", "运行结束后的聚合指标和参数组摘要。"),
    node("spare-shortfall-analysis", "备件短板分析", "computation-artifact", "按需求量、短缺量和满足率识别短板备件。"),
    node("carry-list-analysis", "转场携行清单", "computation-artifact", "基于短缺风险和利用率形成备件携行建议。"),
    node("task-reliability-analysis", "任务可靠度分析", "computation-artifact", "任务成功率、出动架次率和战备完好率分析。"),
    node("downtime-factor-analysis", "停机因素分析", "computation-artifact", "故障、备件短缺和资源延误等停机贡献。")
];

const EDGE_DEFINITIONS = [
    edge("built-in-scenario", "airport", "包含"),
    edge("built-in-scenario", "mission-area", "包含"),
    edge("built-in-scenario", "scenario", "约束初始场景"),
    edge("task", "basic-mission", "包含"),
    edge("task", "mission-profile", "包含"),
    edge("task", "daily-profile", "包含"),
    edge("task", "long-cycle-profile", "包含"),
    edge("mission-profile", "daily-profile", "展开为"),
    edge("mission-profile", "long-cycle-profile", "展开为"),
    edge("daily-profile", "basic-mission", "包含"),
    edge("daily-profile", "basic-mission", "配置重复次数/间隔"),
    edge("long-cycle-profile", "daily-profile", "由N个日剖面组成"),
    edge("long-cycle-profile", "daily-profile", "配置周期重复次数"),
    edge("basic-mission", "aircraft-model", "要求"),
    edge("basic-mission", "aircraft-quantity", "要求"),
    edge("basic-mission", "min-sortie-quantity", "要求"),
    edge("basic-mission", "sortie-time", "具有属性"),
    edge("basic-mission", "mission-duration", "具有属性"),
    edge("basic-mission", "success-time", "具有属性"),
    edge("basic-mission", "task-name", "具有属性"),
    edge("basic-mission", "mission-area", "关联"),
    edge("combat-unit", "aircraft-model", "包含"),
    edge("combat-unit", "aircraft-quantity", "包含"),
    edge("combat-unit", "airport", "部署在"),
    edge("equipment", "combat-unit", "隶属于"),
    edge("equipment", "equipment-system", "包含"),
    edge("equipment", "analysis-diagram", "包含"),
    edge("equipment", "component", "包含"),
    edge("equipment-system", "component", "包含"),
    edge("analysis-diagram", "component", "描述连接"),
    edge("component", "component-quantity", "具有数量"),
    edge("component", "component-parent", "具有上级节点"),
    edge("component", "lru-flag", "标记"),
    edge("equipment-system", "lru-flag", "标记"),
    edge("analysis-diagram", "lru-flag", "标记"),
    edge("reliability-block-diagram", "component", "描述连接"),
    edge("mission-profile", "scenario", "组成想定"),
    edge("basic-mission", "mission-profile", "归属于"),
    edge("component", "equipment", "安装在"),
    edge("spare-part", "support-node", "存放于"),
    edge("support-resource", "support-node", "配置到"),
    edge("support-activity", "support-resource", "消耗资源"),
    edge("support-activity", "spare-part", "产生需求"),
    edge("metric-plan", "scenario", "导入约束"),
    edge("experiment-plan", "scenario", "引用"),
    edge("scenario", "simulation-run", "驱动"),
    edge("visual-run-control", "simulation-run", "启动停止"),
    edge("scenario-view", "simulation-run", "观察"),
    edge("monte-carlo-config", "simulation-run", "批量生成"),
    edge("simulation-run", "run-dataset", "保存"),
    edge("simulation-run", "metric-time-series", "逐步计算"),
    edge("run-dataset", "summary-dataset", "聚合"),
    edge("summary-dataset", "spare-shortfall-analysis", "支撑"),
    edge("summary-dataset", "carry-list-analysis", "支撑"),
    edge("summary-dataset", "task-reliability-analysis", "支撑"),
    edge("summary-dataset", "downtime-factor-analysis", "支撑")
];

export const PROJECT_ONTOLOGY_PLAYGROUND = {
  name: "备件规划与任务可靠度项目Ontology",
  description: "面向备件规划、任务可靠度、仿真实验和计算产物追踪的项目级 ontology。",
  entityTypes: NODE_DEFINITIONS.map(toPlaygroundEntityType),
  relationships: EDGE_DEFINITIONS.map(toPlaygroundRelationship)
};

export const PROJECT_ONTOLOGY = {
  nodes: NODE_DEFINITIONS,
  edges: EDGE_DEFINITIONS
};

const FOCUS_BY_COMPONENT = {
  "task-model": ["built-in-scenario", "airport", "mission-area", "task", "mission-profile", "basic-mission", "daily-profile", "long-cycle-profile", "combat-unit", "scenario"],
  "equipment-table": ["equipment", "equipment-system", "analysis-diagram", "component", "component-quantity", "component-parent", "lru-flag", "reliability-block-diagram", "scenario"],
  "reliability-block-diagram": ["reliability-block-diagram", "analysis-diagram", "component", "equipment", "lru-flag", "task-reliability-analysis"],
  "resource-table": ["support-node", "spare-part", "support-resource", "scenario"],
  "activity-gantt": ["support-activity", "support-resource", "spare-part", "simulation-run"],
  "experiment-form": ["experiment-plan", "scenario", "simulation-run"],
  "visual-simulation": ["visual-run-control", "scenario-view", "simulation-run", "metric-time-series"],
  "scenario-switch": ["scenario-view", "simulation-run", "metric-time-series"],
  "monte-carlo-config": ["monte-carlo-config", "simulation-run", "run-dataset", "summary-dataset"],
  "monte-carlo-results": ["run-dataset", "summary-dataset", "metric-time-series"],
  analysis: ["summary-dataset", "spare-shortfall-analysis", "carry-list-analysis", "task-reliability-analysis", "downtime-factor-analysis"],
  "import-table": ["metric-plan", "summary-dataset", "scenario"]
};

const FOCUS_BY_DATA_OBJECT = {
  scenarioId: "built-in-scenario",
  missionProfile: "mission-profile",
  basicMission: "basic-mission",
  missionPhases: "mission-profile",
  combatUnit: "combat-unit",
  equipment: "equipment",
  components: "component",
  reliabilityBlockDiagram: "reliability-block-diagram",
  supportNodes: "support-node",
  organizationTree: "support-node",
  spares: "spare-part",
  resources: "support-resource",
  supportActivities: "support-activity",
  experiment: "experiment-plan",
  scenario: "scenario",
  visualizationState: "scenario-view",
  monteCarlo: "monte-carlo-config",
  runs: "run-dataset",
  summary: "summary-dataset",
  decisionOutputs: "summary-dataset",
  failureModel: "component"
};

export function buildOntologyContext(page) {
  const focusNodeIds = new Set(FOCUS_BY_COMPONENT[page.component] || []);
  for (const dataObject of page.dataObjects || []) {
    const key = dataObject.split(".")[0];
    if (FOCUS_BY_DATA_OBJECT[key]) focusNodeIds.add(FOCUS_BY_DATA_OBJECT[key]);
  }
  const expandedNodeIds = new Set(focusNodeIds);
  for (const edgeItem of PROJECT_ONTOLOGY.edges) {
    if (focusNodeIds.has(edgeItem.from) || focusNodeIds.has(edgeItem.to)) {
      expandedNodeIds.add(edgeItem.from);
      expandedNodeIds.add(edgeItem.to);
    }
  }
  return {
    focusNodeIds: [...focusNodeIds],
    nodes: PROJECT_ONTOLOGY.nodes.filter((item) => expandedNodeIds.has(item.id)),
    edges: PROJECT_ONTOLOGY.edges.filter((item) => expandedNodeIds.has(item.from) && expandedNodeIds.has(item.to))
  };
}

export function groupOntologyNodes(nodes = PROJECT_ONTOLOGY.nodes) {
  return nodes.reduce((acc, item) => {
    acc[item.group] ||= [];
    acc[item.group].push(item);
    return acc;
  }, {});
}

function node(id, label, group, description, extra = {}) {
  return { id, label, group, description, ...extra };
}

function edge(from, to, label) {
  return { id: `${from}__${label}__${to}`, from, to, label };
}

function layout(x, y, cluster) {
  return { layout: { x, y, cluster } };
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
    "computation-artifact": "#D83B01"
  };
  return colors[group] || "#5C2D91";
}

function iconForGroup(group) {
  const icons = {
    "modeling-object": "◇",
    "simulation-experiment": "▷",
    "computation-artifact": "▣"
  };
  return icons[group] || "○";
}

function cardinalityForLabel(label) {
  if (["包含", "由N个日剖面组成", "批量生成"].includes(label)) return "one-to-many";
  if (["归属于", "部署在", "隶属于", "存放于", "配置到"].includes(label)) return "many-to-one";
  if (["关联", "描述连接", "支撑"].includes(label)) return "many-to-many";
  return "one-to-one";
}

function camelize(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
