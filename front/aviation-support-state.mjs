export const AVIATION_SUPPORT_DEMO_STATE = {
  snapshot: {
    elapsed_hours: 6,
    aircraft_count: 8,
    available_aircraft: 3,
    pre_support_aircraft: 1,
    mission_ready_aircraft: 1,
    flying_aircraft: 2,
    post_support_aircraft: 1,
    maintenance_aircraft: 0,
    planned_sorties: 7,
    launched_sorties: 7,
    completed_sorties: 5,
    sortie_completion_rate: 0.71,
    avg_departure_delay: 12,
    active_jobs: 2,
    waiting_jobs: 1,
    maintenance_backlog: 1,
    spare_stock_total: 8,
    spare_consumed_total: 3,
    resource_work_count: 28
  },
  aircraft: [
    { tail_number: "AC-01", type: "J-15", state: "available", x: 0, y: 0, flight_hours: 120, landings: 34, failed_lru: "", systems: [] },
    { tail_number: "AC-02", type: "J-15", state: "pre_support", x: 1, y: 0, flight_hours: 132, landings: 36, failed_lru: "", systems: [] },
    { tail_number: "AC-03", type: "J-35", state: "mission_ready", x: 2, y: 0, flight_hours: 104, landings: 28, failed_lru: "", systems: [] },
    { tail_number: "AC-04", type: "J-35", state: "flying", x: 3, y: 0, flight_hours: 98, landings: 22, failed_lru: "", systems: [] },
    {
      tail_number: "AC-05",
      type: "J-15",
      state: "flying",
      x: 0,
      y: 1,
      flight_hours: 140,
      landings: 40,
      failed_lru: "j15-radar",
      systems: [],
      failure_tree: {
        tail_number: "AC-05",
        aircraft_type: "J-15",
        root_id: "aircraft-root",
        nodes: [
          { id: "aircraft-root", name: "AC-05 整机", parent_id: "", product_type: "整机", quantity: 1, k_out_of_n: {}, failure_threshold: 1, failed_children: 1, failed: true, direct_failed: false, propagated_failed: true, failure_time: 252 },
          { id: "j15-avionics", name: "航电系统", parent_id: "aircraft-root", product_type: "SRU", quantity: 2, k_out_of_n: { enabled: true, n: 2, k: 1 }, failure_threshold: 1, failed_children: 1, failed: true, direct_failed: false, propagated_failed: true, failure_time: 252 },
          { id: "j15-radar", name: "雷达 LRU", parent_id: "j15-avionics", product_type: "LRU", quantity: 1, k_out_of_n: { enabled: false, n: 1, k: 1 }, failure_threshold: 1, failed_children: 0, failed: true, direct_failed: true, propagated_failed: false, failure_time: 252 }
        ],
        edges: [
          { from: "aircraft-root", to: "j15-avionics", active: true },
          { from: "j15-avionics", to: "j15-radar", active: true }
        ]
      }
    },
    { tail_number: "AC-06", type: "J-15", state: "post_support", x: 1, y: 1, flight_hours: 150, landings: 42, failed_lru: "", systems: [] },
    { tail_number: "AC-07", type: "J-35", state: "available", x: 2, y: 1, flight_hours: 88, landings: 20, failed_lru: "", systems: [] },
    { tail_number: "AC-08", type: "J-15", state: "available", x: 3, y: 1, flight_hours: 160, landings: 45, failed_lru: "", systems: [] }
  ],
  resources: [
    { name: "mechanic_team", display_name: "机务组", category: "personnel", capacity: 3, in_use: 2, utilization: 0.62, work_count: 12 },
    { name: "fuel_truck", display_name: "加油车", category: "equipment", capacity: 2, in_use: 1, utilization: 0.48, work_count: 7 },
    { name: "power_cart", display_name: "电源车", category: "equipment", capacity: 2, in_use: 1, utilization: 0.41, work_count: 6 },
    { name: "maintenance_bay", display_name: "维修位", category: "facility", capacity: 1, in_use: 0, utilization: 0.2, work_count: 3 }
  ],
  spares: [
    { part_id: "engine_lru", name: "发动机 LRU", quantity: 2, consumed: 1, replenished: 0, pending_quantity: 1, reorder_point: 1 },
    { part_id: "avionics_lru", name: "航电 LRU", quantity: 3, consumed: 1, replenished: 1, pending_quantity: 0, reorder_point: 1 },
    { part_id: "hydraulic_lru", name: "液压 LRU", quantity: 3, consumed: 1, replenished: 0, pending_quantity: 0, reorder_point: 1 }
  ],
  missions: [
    { mission_id: 1, planned_start: 60, actual_start: 66, return_time: 180, required_aircraft: 2, status: "completed", assigned_tail_numbers: ["AC-04", "AC-05"] },
    { mission_id: 2, planned_start: 240, actual_start: 252, return_time: null, required_aircraft: 2, status: "launched", assigned_tail_numbers: ["AC-03"] }
  ],
  jobs: [
    { job_id: 12, tail_number: "AC-02", kind: "pre_support", state: "active", task: "通电检查", remaining: 8 },
    { job_id: 13, tail_number: "AC-06", kind: "post_support", state: "waiting", task: "回收检查", remaining: 25 }
  ],
  support_tasks: [
    {
      task_id: "support-task-12",
      job_id: 12,
      tail_number: "AC-02",
      kind: "pre_support",
      state: "active",
      current_task: "通电检查",
      remaining: 8,
      required_resources: { mechanic_team: 1, power_cart: 1 },
      required_spares: {}
    },
    {
      task_id: "support-task-13",
      job_id: 13,
      tail_number: "AC-06",
      kind: "post_support",
      state: "waiting",
      current_task: "回收检查",
      remaining: 25,
      required_resources: { mechanic_team: 1 },
      required_spares: {}
    }
  ],
  metrics: [
    { metric_id: "sortie_completion_rate", name: "出动完成率", value: 0.71, unit: "ratio" },
    { metric_id: "available_aircraft", name: "可用飞机", value: 3, unit: "count" },
    { metric_id: "active_jobs", name: "活动作业", value: 2, unit: "count" },
    { metric_id: "spare_stock_total", name: "备件库存", value: 8, unit: "count" }
  ],
  object_relationships: [
    { from: "aircraft:AC-04", to: "mission:1", type: "assigned_to", label: "执行任务" },
    { from: "aircraft:AC-05", to: "mission:1", type: "assigned_to", label: "执行任务" },
    { from: "aircraft:AC-03", to: "mission:2", type: "assigned_to", label: "执行任务" },
    { from: "aircraft:AC-02", to: "support_task:support-task-12", type: "has_support_task", label: "生成保障作业" },
    { from: "aircraft:AC-06", to: "support_task:support-task-13", type: "has_support_task", label: "生成保障作业" },
    { from: "support_task:support-task-12", to: "resource:mechanic_team", type: "uses_resource", label: "占用资源" },
    { from: "support_task:support-task-12", to: "resource:power_cart", type: "uses_resource", label: "占用资源" },
    { from: "support_task:support-task-13", to: "resource:mechanic_team", type: "uses_resource", label: "占用资源" },
    { from: "mission:1", to: "metric:sortie_completion_rate", type: "observed_as", label: "采样指标" },
    { from: "resource:mechanic_team", to: "metric:active_jobs", type: "observed_as", label: "采样指标" },
    { from: "spare:engine_lru", to: "metric:spare_stock_total", type: "observed_as", label: "采样指标" }
  ],
  events: [
    { time: 252, event: "launch", message: "AC-03 延迟 12 分钟后出动" },
    { time: 226, event: "support_start", message: "AC-02 开始飞行前保障" },
    { time: 180, event: "mission_return", message: "AC-04 / AC-05 返场" }
  ]
};

export function normalizeAviationSupportState(state = AVIATION_SUPPORT_DEMO_STATE) {
  const snapshot = state.snapshot || {};
  const missionTemplates = state.mission_templates || {};
  const failureTreeTemplates = state.failure_tree_templates || {};
  return {
    kpis: [
      kpi("sortie_completion_rate", "出动完成率", percent(snapshot.sortie_completion_rate)),
      kpi("completed_sorties", "完成/计划架次", `${number(snapshot.completed_sorties)}/${number(snapshot.planned_sorties)}`),
      kpi("available_aircraft", "可用飞机", `${number(snapshot.available_aircraft)}/${number(snapshot.aircraft_count)}`),
      kpi("active_jobs", "活动作业", number(snapshot.active_jobs)),
      kpi("spare_stock_total", "备件库存", number(snapshot.spare_stock_total)),
      kpi("avg_departure_delay", "平均延误", `${fixed(snapshot.avg_departure_delay, 1)} min`)
    ],
    aircraft: (state.aircraft || []).map((item) => ({
      id: item.tail_number,
      label: item.tail_number,
      type: item.type,
      state: item.state,
      position: [Number(item.x || 0), Number(item.y || 0)],
      currentMissionId: item.current_mission_id || item.mission_id || "",
      failedLru: item.failed_lru || "",
      flightHours: number(item.flight_hours || 0),
      takeoffCount: number(item.takeoff_count || 0),
      landingCount: number(item.landing_count || 0),
      postflightRequired: Boolean(item.postflight_required),
      preventiveDue: Boolean(item.preventive_due),
      systemCount: Array.isArray(item.systems) ? item.systems.length : 0,
      failureTree: normalizeFailureTree(resolveFailureTree(item, failureTreeTemplates))
    })),
    resources: (state.resources || []).map((item) => ({
      id: item.name,
      label: item.display_name || item.name,
      category: item.category || "resource",
      supportNodeId: item.support_node_id || item.supportNodeId || item.node_id || item.name || "",
      airportId: item.airport_id || item.airportId || item.airport || "",
      capacity: number(item.capacity),
      inUse: number(item.in_use),
      utilization: Number(item.utilization || 0),
      workCount: number(item.work_count),
      delayCount: number(item.delay_count)
    })),
    spares: (state.spares || []).map((item) => ({
      id: item.part_id,
      label: item.name || item.part_id,
      supportNodeId: item.support_node_id || item.supportNodeId || item.node_id || String(item.part_id || "").split(":")[0] || "",
      airportId: item.airport_id || item.airportId || item.airport || "",
      quantity: number(item.quantity),
      consumed: number(item.consumed),
      pending: number(item.pending_quantity),
      reorderPoint: number(item.reorder_point),
      delayCount: number(item.delay_count || item.shortage_count)
    })),
    missions: (state.missions || []).map((item) => normalizeMission(resolveMission(item, missionTemplates))),
    jobs: (state.jobs || []).map((item) => ({
      id: item.job_id,
      tailNumber: item.tail_number,
      kind: item.kind,
      state: item.state,
      task: item.task || "",
      remaining: Number(item.remaining || 0)
    })),
    events: (state.events || []).map((item) => ({
      time: item.time,
      event: item.event,
      message: item.message
    }))
  };
}

function resolveMission(item = {}, templates = {}) {
  const missionId = String(item.mission_id || "");
  const template = missionId ? templates[missionId] : null;
  if (!template || typeof template !== "object") {
    return item;
  }
  return { ...template, ...item };
}

function normalizeMission(item = {}) {
  return {
    id: item.mission_id,
    name: item.name || "",
    taskCategory: item.task_category || "",
    periodicTaskName: item.periodic_task_name || "",
    compositeTaskName: item.composite_task_name || "",
    basicTaskName: item.basic_task_name || "",
    airportId: item.airport_id || item.airportId || item.airport || "",
    supportNodeId: item.support_node_id || item.supportNodeId || "",
    requiredAircraftType: item.required_aircraft_type || "",
    groupName: item.group_name || "",
    waveIndex: item.wave_index == null ? null : number(item.wave_index),
    dayIndex: item.day_index == null ? null : number(item.day_index),
    durationMinutes: number(item.duration_minutes || 0),
    preparationStart: item.preparation_start,
    delayMinutes: number(item.delay_minutes || 0),
    status: item.status,
    requiredAircraft: number(item.required_aircraft),
    assignedCount: (item.assigned_tail_numbers || []).length,
    assignedTailNumbers: item.assigned_tail_numbers || [],
    plannedStart: item.planned_start,
    actualStart: item.actual_start,
    returnTime: item.return_time
  };
}

function resolveFailureTree(item = {}, templates = {}) {
  if (item.failure_tree && typeof item.failure_tree === "object") {
    return item.failure_tree;
  }
  const ref = String(item.failure_tree_ref || "");
  const template = ref ? templates[ref] : null;
  if (!template || typeof template !== "object") {
    return {};
  }
  const state = item.failure_tree_state && typeof item.failure_tree_state === "object" ? item.failure_tree_state : {};
  const stateByNode = new Map((Array.isArray(state.nodes) ? state.nodes : []).map((node) => [String(node.id || ""), node]));
  const activeEdges = new Set(Array.isArray(state.active_edges) ? state.active_edges.map((value) => String(value)) : []);
  return {
    tail_number: template.tail_number || item.tail_number || "",
    aircraft_type: template.aircraft_type || item.type || "",
    root_id: template.root_id || "",
    equipment_root_id: template.equipment_root_id || "",
    nodes: (Array.isArray(template.nodes) ? template.nodes : []).map((node) => {
      const nodeState = stateByNode.get(String(node.id || "")) || {};
      return {
        ...node,
        failed_children: number(nodeState.failed_children || 0),
        failed: Boolean(nodeState.failed),
        direct_failed: Boolean(nodeState.direct_failed),
        propagated_failed: Boolean(nodeState.propagated_failed),
        failure_time: nodeState.failure_time == null ? null : number(nodeState.failure_time)
      };
    }),
    edges: (Array.isArray(template.edges) ? template.edges : []).map((edge) => ({
      ...edge,
      active: activeEdges.has(String(edge.to || ""))
    }))
  };
}

function normalizeFailureTree(tree = {}) {
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const edges = Array.isArray(tree.edges) ? tree.edges : [];
  return {
    tailNumber: tree.tail_number || "",
    aircraftType: tree.aircraft_type || "",
    rootId: tree.root_id || nodes[0]?.id || "",
    nodes: nodes.map((node) => ({
      id: String(node.id || ""),
      name: String(node.name || node.id || ""),
      parentId: String(node.parent_id || ""),
      productType: String(node.product_type || ""),
      quantity: number(node.quantity || 1),
      kOutOfN: node.k_out_of_n && typeof node.k_out_of_n === "object" ? node.k_out_of_n : {},
      failureThreshold: number(node.failure_threshold || 1),
      failedChildren: number(node.failed_children || 0),
      failed: Boolean(node.failed),
      directFailed: Boolean(node.direct_failed),
      propagatedFailed: Boolean(node.propagated_failed),
      failureTime: node.failure_time == null ? null : number(node.failure_time)
    })),
    edges: edges.map((edge) => ({
      from: String(edge.from || ""),
      to: String(edge.to || ""),
      active: Boolean(edge.active)
    }))
  };
}

export const AVIATION_SUPPORT_OBJECT_GRAPH = buildAviationSupportObjectGraph(AVIATION_SUPPORT_DEMO_STATE);

export function buildAviationSupportObjectGraph(state = AVIATION_SUPPORT_DEMO_STATE) {
  const nodes = [
    modelNode(
      "snapshot",
      "当前快照",
      "snapshot",
      `T+${Number(state.snapshot?.elapsed_hours || 0).toFixed(1)}h 运行状态快照`,
      "snapshot",
      "snapshot"
    ),
    ...(state.aircraft || []).map((item) => modelNode(
      `aircraft:${item.tail_number}`,
      item.tail_number,
      "aircraft",
      `飞机 ${item.tail_number} / ${item.state}`,
      "aircraft",
      item.tail_number
    )),
    ...(state.missions || []).map((item) => modelNode(
      `mission:${item.mission_id}`,
      `任务 ${item.mission_id}`,
      "mission",
      `任务状态 ${item.status}，需求 ${number(item.required_aircraft)} 架`,
      "missions",
      item.mission_id
    )),
    ...(state.resources || []).map((item) => modelNode(
      `resource:${item.name}`,
      item.display_name || item.name,
      "resource",
      `${item.category || "resource"} 容量 ${number(item.capacity)} / 占用 ${number(item.in_use)}`,
      "resources",
      item.name
    )),
    ...(state.spares || []).map((item) => modelNode(
      `spare:${item.part_id}`,
      item.name || item.part_id,
      "spare",
      `库存 ${number(item.quantity)} / 消耗 ${number(item.consumed)}`,
      "spares",
      item.part_id
    )),
    ...supportTasksForState(state).map((item) => modelNode(
      `support_task:${item.task_id}`,
      item.current_task || item.task || String(item.task_id),
      "support_task",
      `${item.kind || "support"} / ${item.state || "waiting"} / ${item.tail_number || "-"}`,
      "support_tasks",
      item.task_id
    )),
    ...metricsForState(state).map((item) => modelNode(
      `metric:${item.metric_id}`,
      item.name || item.metric_id,
      "metric",
      `${item.metric_id}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`,
      "metrics",
      item.metric_id
    ))
  ];

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = relationshipsForState(state)
    .filter((relationship) => nodeIds.has(relationship.from) && nodeIds.has(relationship.to))
    .map((relationship) => ({
      id: `${relationship.from}__${relationship.type || relationship.label}__${relationship.to}`,
      from: relationship.from,
      to: relationship.to,
      label: relationship.label || relationLabel(relationship.type),
      source: {
        kind: "visualization_state",
        relationshipType: relationship.type || "related_to"
      }
    }));

  return { nodes, edges };
}

function kpi(key, label, value) {
  return { key, label, value };
}

function modelNode(id, label, runtimeType, description, stateCollection, stateId) {
  return {
    id,
    label,
    group: "model-instance",
    description,
    source: {
      kind: "visualization_state",
      runtimeType,
      stateCollection,
      stateId
    },
    layout: { cluster: runtimeType }
  };
}

function supportTasksForState(state) {
  if (Array.isArray(state.support_tasks) && state.support_tasks.length > 0) {
    return state.support_tasks.map((item) => ({
      ...item,
      task_id: item.task_id || `support-task-${item.job_id}`
    }));
  }
  return (state.jobs || []).map((item) => ({
    task_id: `support-task-${item.job_id}`,
    job_id: item.job_id,
    tail_number: item.tail_number,
    kind: item.kind,
    state: item.state,
    current_task: item.task,
    remaining: item.remaining,
    required_resources: item.required_resources || {},
    required_spares: item.required_spares || {}
  }));
}

function metricsForState(state) {
  if (Array.isArray(state.metrics) && state.metrics.length > 0) return state.metrics;
  const snapshot = state.snapshot || {};
  return [
    { metric_id: "sortie_completion_rate", name: "出动完成率", value: snapshot.sortie_completion_rate ?? 0, unit: "ratio" },
    { metric_id: "available_aircraft", name: "可用飞机", value: snapshot.available_aircraft ?? 0, unit: "count" },
    { metric_id: "active_jobs", name: "活动作业", value: snapshot.active_jobs ?? 0, unit: "count" },
    { metric_id: "spare_stock_total", name: "备件库存", value: snapshot.spare_stock_total ?? 0, unit: "count" }
  ];
}

function relationshipsForState(state) {
  if (Array.isArray(state.object_relationships) && state.object_relationships.length > 0) {
    return state.object_relationships;
  }

  const relationships = [];
  for (const mission of state.missions || []) {
    for (const tailNumber of mission.assigned_tail_numbers || []) {
      relationships.push({
        from: `aircraft:${tailNumber}`,
        to: `mission:${mission.mission_id}`,
        type: "assigned_to",
        label: relationLabel("assigned_to")
      });
    }
  }

  for (const task of supportTasksForState(state)) {
    relationships.push({
      from: `aircraft:${task.tail_number}`,
      to: `support_task:${task.task_id}`,
      type: "has_support_task",
      label: relationLabel("has_support_task")
    });
    for (const resourceName of Object.keys(task.required_resources || {})) {
      relationships.push({
        from: `support_task:${task.task_id}`,
        to: `resource:${resourceName}`,
        type: "uses_resource",
        label: relationLabel("uses_resource")
      });
    }
    for (const spareId of Object.keys(task.required_spares || {})) {
      relationships.push({
        from: `support_task:${task.task_id}`,
        to: `spare:${spareId}`,
        type: "consumes_spare",
        label: relationLabel("consumes_spare")
      });
    }
  }

  for (const metric of metricsForState(state)) {
    relationships.push({
      from: `metric:${metric.metric_id}`,
      to: "snapshot",
      type: "sampled_from",
      label: relationLabel("sampled_from")
    });
  }

  return relationships;
}

function relationLabel(type) {
  const labels = {
    assigned_to: "执行任务",
    has_support_task: "生成保障作业",
    uses_resource: "占用资源",
    consumes_spare: "消耗备件",
    observed_as: "采样指标",
    sampled_from: "采样自"
  };
  return labels[type] || "关联";
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function fixed(value, digits = 0) {
  return Number(value || 0).toFixed(digits);
}

function number(value) {
  return Number(value || 0);
}
