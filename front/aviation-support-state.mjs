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
    { tail_number: "AC-05", type: "J-15", state: "flying", x: 0, y: 1, flight_hours: 140, landings: 40, failed_lru: "", systems: [] },
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
  events: [
    { time: 252, event: "launch", message: "AC-03 延迟 12 分钟后出动" },
    { time: 226, event: "support_start", message: "AC-02 开始飞行前保障" },
    { time: 180, event: "mission_return", message: "AC-04 / AC-05 返场" }
  ]
};

export function normalizeAviationSupportState(state = AVIATION_SUPPORT_DEMO_STATE) {
  const snapshot = state.snapshot || {};
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
      failedLru: item.failed_lru || "",
      systemCount: Array.isArray(item.systems) ? item.systems.length : 0
    })),
    resources: (state.resources || []).map((item) => ({
      id: item.name,
      label: item.display_name || item.name,
      category: item.category || "resource",
      capacity: number(item.capacity),
      inUse: number(item.in_use),
      utilization: Number(item.utilization || 0),
      workCount: number(item.work_count)
    })),
    spares: (state.spares || []).map((item) => ({
      id: item.part_id,
      label: item.name || item.part_id,
      quantity: number(item.quantity),
      consumed: number(item.consumed),
      pending: number(item.pending_quantity),
      reorderPoint: number(item.reorder_point)
    })),
    missions: (state.missions || []).map((item) => ({
      id: item.mission_id,
      status: item.status,
      requiredAircraft: number(item.required_aircraft),
      assignedCount: (item.assigned_tail_numbers || []).length,
      assignedTailNumbers: item.assigned_tail_numbers || [],
      plannedStart: item.planned_start,
      actualStart: item.actual_start,
      returnTime: item.return_time
    })),
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

function kpi(key, label, value) {
  return { key, label, value };
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
