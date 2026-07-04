export const MODULES = {
  sparePlanning: "备件规划",
  missionReliability: "任务可靠度"
};

export const defaultScenario = {
  scenarioId: "preview-empty-shell",
  activeModule: "sparePlanning",
  airports: [],
  missionAreas: [],
  experiment: { name: "本地空白预览", steps: 24, samples: 27, seed: 20260621 },
  missionProfile: {
    name: "",
    durationHours: 0,
    compositeTasks: [],
    periodicTasks: []
  },
  basicMissions: [],
  missionPhases: [],
  combatUnit: { members: [] },
  equipment: {
    model: "",
    wholeMachineModels: [],
    quantity: 0,
    initialReady: 0,
    minRequiredSorties: 0
  },
  components: [],
  supportNodes: [],
  supportActivities: [],
  reliabilityBlockDiagram: { nodes: [], edges: [] },
  monteCarlo: {
    failureRates: [0.06, 0.08, 0.1],
    spareMultipliers: [0.75, 1, 1.25],
    supportCapacities: [1, 2, 3]
  }
};

export function cloneScenario(scenario = defaultScenario) {
  return JSON.parse(JSON.stringify(scenario));
}

export function createRng(seed = 1) {
  let state = Number(seed) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function validateScenario(scenario) {
  const issues = [];
  if (!scenario || typeof scenario !== "object") return ["scenario 未配置"];
  if (!scenario.scenarioId) issues.push("scenarioId 未配置");
  const nodeIds = new Set((scenario.reliabilityBlockDiagram?.nodes || []).map((node) => node.id));
  for (const edge of scenario.reliabilityBlockDiagram?.edges || []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(`可靠性框图边 ${edge.from}->${edge.to} 缺少端点`);
    }
  }
  return issues;
}

export function runSimulation(inputScenario = defaultScenario, overrides = {}) {
  const scenario = mergeScenario(inputScenario, overrides);
  if (!hasRuntimeScenarioData(scenario)) {
    return emptySimulationResult(scenario);
  }
  const rng = createRng(overrides.seed ?? scenario.experiment.seed);
  const steps = Number(overrides.steps ?? scenario.experiment.steps);
  const missionCycleHours = scenarioMissionCycleHours(scenario);
  const quantity = Number(scenario.equipment.quantity);
  const minRequired = Number(overrides.minRequiredSorties ?? primaryBasicMission(scenario).minRequiredSorties);
  const supportCapacity = Number(overrides.supportCapacity ?? scenario.supportNodes[0].equipmentCapacity);
  const baseFailureRate = Number(overrides.failureRate ?? average(scenario.components.map((item) => item.failureRate)));
  const spareMultiplier = Number(overrides.spareMultiplier ?? 1);
  const inventory = scaleInventory(scenario.supportNodes[0].inventory, spareMultiplier);
  const equipment = Array.from({ length: quantity }, (_, index) => ({
    id: `EQ-${String(index + 1).padStart(2, "0")}`,
    status: index < scenario.equipment.initialReady ? "ready" : "idle",
    component: weightedComponent(scenario.components, rng()),
    remaining: 0,
    sorties: 0,
    failures: 0,
    blockedReason: ""
  }));

  const timeline = [];
  const events = [];
  const repairQueue = [];
  const spareDemand = {};
  const spareFilled = {};
  const spareShortage = {};
  const downtime = { failure: 0, spare_shortage: 0, resource_delay: 0, schedule_delay: 0 };
  const launchTimes = [];
  const recoveryTimes = [];
  const turnaroundTimes = [];
  let sortieAttempts = 0;
  let successfulSorties = 0;
  let missionChecks = 0;
  let missionSuccesses = 0;
  let currentWave = 0;

  const addEvent = (step, type, message, severity = "info") => {
    events.push({ step, type, message, severity });
  };

  for (let step = 1; step <= steps; step += 1) {
    if ((step - 1) % missionCycleHours === 0) {
      currentWave += 1;
      const ready = equipment.filter((item) => item.status === "ready");
      const demand = Math.min(ready.length, minRequired);
      sortieAttempts += minRequired;
      launchTimes.push(1 + Math.max(0, minRequired - demand));
      for (const item of ready.slice(0, demand)) {
        item.status = "preparing";
        item.remaining = 1;
        addEvent(step, "wave", `${item.id} 进入飞行前准备`, "info");
      }
      if (demand < minRequired) {
        downtime.schedule_delay += minRequired - demand;
        addEvent(step, "mission-risk", `第 ${currentWave} 波次可用装备不足，需求 ${minRequired}，可用 ${demand}`, "warning");
      }
    }

    for (const item of equipment) {
      if (item.status === "preparing") {
        item.remaining -= 1;
        if (item.remaining <= 0) {
          item.status = "sortie";
          item.remaining = 3;
          item.sorties += 1;
          successfulSorties += 1;
          addEvent(step, "sortie", `${item.id} 完成准备并出动`, "success");
        }
      } else if (item.status === "sortie") {
        const componentRisk = item.component.failureRate || baseFailureRate;
        if (rng() < componentRisk) {
          item.status = "failed";
          item.failures += 1;
          item.blockedReason = "failure";
          repairQueue.push(item.id);
          downtime.failure += 1;
          addEvent(step, "failure", `${item.id} 的 ${item.component.name} 故障，创建修复性维修活动`, "danger");
        } else {
          item.remaining -= 1;
          if (item.remaining <= 0) {
            item.status = "ready";
            item.blockedReason = "";
            recoveryTimes.push(3);
            turnaroundTimes.push(5);
            addEvent(step, "recover", `${item.id} 回收检查完成，恢复 ready`, "success");
          }
        }
      } else if (item.status === "repairing") {
        item.remaining -= 1;
        if (item.remaining <= 0) {
          item.status = "ready";
          item.blockedReason = "";
          addEvent(step, "repair-complete", `${item.id} 修复完成`, "success");
        }
      }
    }

    let openCapacity = Math.max(0, supportCapacity - equipment.filter((item) => item.status === "repairing").length);
    const queueSnapshot = repairQueue.splice(0, repairQueue.length);
    for (const equipmentId of queueSnapshot) {
      const item = equipment.find((entry) => entry.id === equipmentId);
      if (!item || item.status !== "failed") continue;
      if (openCapacity <= 0) {
        downtime.resource_delay += 1;
        item.blockedReason = "resource_delay";
        repairQueue.push(equipmentId);
        continue;
      }
      const spareType = item.component.spareType;
      spareDemand[spareType] = (spareDemand[spareType] || 0) + 1;
      if ((inventory[spareType] || 0) > 0) {
        inventory[spareType] -= 1;
        spareFilled[spareType] = (spareFilled[spareType] || 0) + 1;
        item.status = "repairing";
        item.remaining = 3;
        item.blockedReason = "";
        openCapacity -= 1;
        addEvent(step, "repair-start", `${item.id} 消耗 ${spareType} 开始维修`, "info");
      } else {
        spareShortage[spareType] = (spareShortage[spareType] || 0) + 1;
        downtime.spare_shortage += 1;
        item.blockedReason = "spare_shortage";
        repairQueue.push(equipmentId);
        addEvent(step, "shortage", `${spareType} 库存不足，${item.id} 等待调运`, "danger");
      }
    }

    if (step % missionCycleHours === 0) {
      missionChecks += 1;
      const waveTarget = missionChecks * minRequired;
      if (successfulSorties >= waveTarget) {
        missionSuccesses += 1;
        addEvent(step, "mission-success", `第 ${missionChecks} 个任务波次满足最低出动数量`, "success");
      } else {
        addEvent(step, "mission-failure", `第 ${missionChecks} 个任务波次未满足最低出动数量`, "danger");
      }
    }

    timeline.push(snapshot(step, equipment, inventory, {
      missionCycleHours,
      minRequired,
      sortieAttempts,
      successfulSorties,
      missionChecks,
      missionSuccesses,
      spareDemand,
      spareFilled,
      spareShortage,
      repairQueue,
      launchTimes,
      recoveryTimes,
      turnaroundTimes,
      downtime
    }));
  }

  const final = timeline.at(-1) || {};
  return {
    scenario,
    timeline,
    final,
    events,
    spareShortfalls: buildSpareShortfalls(spareDemand, spareFilled, spareShortage),
    carryList: buildCarryList(spareDemand, spareShortage, scenario.components),
    downtimeFactors: buildDowntimeFactors(downtime),
    reliability: buildReliabilityAnalysis(timeline, missionChecks, missionSuccesses)
  };
}

export function runMonteCarlo(inputScenario = defaultScenario, options = {}) {
  const scenario = mergeScenario(inputScenario, options);
  if (!hasRuntimeScenarioData(scenario)) {
    return summarizeMonteCarlo([]);
  }
  const samples = Number(options.samples ?? scenario.experiment.samples);
  const sweep = options.sweep ?? buildMonteCarloSweep(scenario);
  const runs = [];
  for (const group of sweep) {
    for (let index = 0; index < samples; index += 1) {
      const seed = Number(scenario.experiment.seed) + index + Math.floor((group.failureRate || 0) * 10000);
      const result = runSimulation(scenario, { ...group, seed, steps: scenario.experiment.steps });
      runs.push({
        sampleId: `${group.name}-${index + 1}`,
        group: group.name,
        seed,
        parameters: group,
        final: result.final,
        spareShortfalls: result.spareShortfalls,
        downtimeFactors: result.downtimeFactors
      });
    }
  }
  return summarizeMonteCarlo(runs);
}

function buildMonteCarloSweep(scenario) {
  const monteCarlo = scenario.monteCarlo || {};
  const failureRates = normalizeSweepValues(monteCarlo.failureRates, [0.08]);
  const spareMultipliers = normalizeSweepValues(monteCarlo.spareMultipliers, [1]);
  const supportCapacities = normalizeSweepValues(monteCarlo.supportCapacities, [3]);
  const minRequiredSorties = Number(primaryBasicMission(scenario)?.minRequiredSorties ?? 5);
  const sweep = [];
  for (const failureRate of failureRates) {
    for (const spareMultiplier of spareMultipliers) {
      for (const supportCapacity of supportCapacities) {
        sweep.push({
          name: `F${failureRate}-S${spareMultiplier}-C${supportCapacity}`,
          failureRate,
          spareMultiplier,
          supportCapacity,
          minRequiredSorties
        });
      }
    }
  }
  return sweep;
}

function normalizeSweepValues(values, fallback) {
  const parsed = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return parsed.length ? parsed : fallback;
}

export function summarizeMonteCarlo(runs) {
  const groups = [...new Set(runs.map((run) => run.group))].map((group) => {
    const subset = runs.filter((run) => run.group === group);
    return {
      group,
      count: subset.length,
      mission_success_rate: summarizeMetric(subset, "mission_success_rate"),
      ready_rate: summarizeMetric(subset, "ready_rate"),
      sortie_rate: summarizeMetric(subset, "sortie_rate"),
      spare_fill_rate: summarizeMetric(subset, "spare_fill_rate"),
      spare_utilization: summarizeMetric(subset, "spare_utilization"),
      shortage_events: summarizeMetric(subset, "shortage_events"),
      repair_backlog: summarizeMetric(subset, "repair_backlog"),
      mean_launch_time: summarizeMetric(subset, "mean_launch_time"),
      mean_recovery_time: summarizeMetric(subset, "mean_recovery_time"),
      mean_turnaround_time: summarizeMetric(subset, "mean_turnaround_time")
    };
  });
  const aggregateShortfalls = {};
  const aggregateDowntime = {};
  for (const run of runs) {
    for (const row of run.spareShortfalls) {
      aggregateShortfalls[row.spareType] ||= { demand: 0, filled: 0, shortage: 0 };
      aggregateShortfalls[row.spareType].demand += row.demand;
      aggregateShortfalls[row.spareType].filled += row.filled;
      aggregateShortfalls[row.spareType].shortage += row.shortage;
    }
    for (const row of run.downtimeFactors) {
      aggregateDowntime[row.reason] = (aggregateDowntime[row.reason] || 0) + row.count;
    }
  }
  return {
    runs,
    groups,
    spareShortfalls: buildSpareShortfallsFromAggregate(aggregateShortfalls),
    carryList: buildCarryListFromAggregate(aggregateShortfalls),
    downtimeFactors: buildDowntimeFactors(aggregateDowntime)
  };
}

function mergeScenario(scenario, overrides) {
  const merged = cloneScenario(scenario);
  merged.experiment ||= {};
  merged.basicMissions = normalizeBasicMissions(merged);
  merged.equipment ||= {};
  merged.supportNodes ||= [];
  merged.components ||= [];
  merged.reliabilityBlockDiagram ||= { nodes: [], edges: [] };
  if (overrides.steps !== undefined) merged.experiment.steps = Number(overrides.steps);
  if (overrides.samples !== undefined) merged.experiment.samples = Number(overrides.samples);
  if (overrides.seed !== undefined) merged.experiment.seed = Number(overrides.seed);
  if (overrides.minRequiredSorties !== undefined) primaryBasicMission(merged).minRequiredSorties = Number(overrides.minRequiredSorties);
  if (overrides.supportCapacity !== undefined && merged.supportNodes[0]) merged.supportNodes[0].equipmentCapacity = Number(overrides.supportCapacity);
  if (overrides.failureRate !== undefined) {
    for (const component of merged.components) {
      component.failureRate = Number(overrides.failureRate);
    }
    for (const node of merged.reliabilityBlockDiagram.nodes) {
      if (node.type === "component") node.failureRate = Number(overrides.failureRate);
    }
  }
  return merged;
}

function hasRuntimeScenarioData(scenario) {
  return Boolean(
    Number(scenario?.experiment?.steps) > 0
    && Number(scenario?.equipment?.quantity) > 0
    && Number(primaryBasicMission(scenario)?.minRequiredSorties) > 0
    && scenarioMissionCycleHours(scenario) > 0
    && (scenario?.components || []).length > 0
    && (scenario?.supportNodes || []).length > 0
  );
}

function primaryBasicMission(scenario) {
  const missions = normalizeBasicMissions(scenario);
  return missions[0] || {};
}

function normalizeBasicMissions(scenario) {
  if (!scenario || typeof scenario !== "object") return [];
  if (!Array.isArray(scenario.basicMissions)) scenario.basicMissions = [];
  return scenario.basicMissions.filter((mission) => mission && typeof mission === "object" && !Array.isArray(mission));
}

function scenarioMissionCycleHours(scenario) {
  const legacyRepeatCycle = Number(scenario?.missionProfile?.repeatCycleHours);
  if (Number.isFinite(legacyRepeatCycle) && legacyRepeatCycle > 0) return legacyRepeatCycle;
  const durationHours = Number(scenario?.missionProfile?.durationHours);
  if (Number.isFinite(durationHours) && durationHours > 0) return durationHours;
  return 0;
}

function emptySimulationResult(scenario) {
  const final = {
    step: 0,
    wave: 0,
    ready_count: 0,
    preparing_count: 0,
    sortie_count: 0,
    failed_count: 0,
    repairing_count: 0,
    ready_rate: 0,
    mission_success_rate: 0,
    sortie_rate: 0,
    spare_fill_rate: 0,
    spare_utilization: 0,
    shortage_events: 0,
    repair_backlog: 0,
    mean_launch_time: 0,
    mean_recovery_time: 0,
    mean_turnaround_time: 0,
    downtime_failure_events: 0,
    downtime_spare_shortage_events: 0,
    downtime_resource_delay_events: 0,
    downtime_schedule_delay_events: 0
  };
  return {
    scenario,
    timeline: [],
    final,
    events: [],
    spareShortfalls: [],
    carryList: [],
    downtimeFactors: [],
    reliability: { missionReliability: 0, checks: 0, successes: 0 }
  };
}

function snapshot(step, equipment, inventory, state) {
  const total = equipment.length || 1;
  const counts = statusCounts(equipment);
  const demandTotal = sumValues(state.spareDemand);
  const filledTotal = sumValues(state.spareFilled);
  const initialStock = demandTotal + sumValues(inventory);
  return {
    step,
    wave: Math.ceil(step / Math.max(1, Number(state.missionCycleHours) || 1)),
    ready_count: counts.ready || 0,
    preparing_count: counts.preparing || 0,
    sortie_count: counts.sortie || 0,
    failed_count: counts.failed || 0,
    repairing_count: counts.repairing || 0,
    ready_rate: (counts.ready || 0) / total,
    mission_success_rate: state.missionSuccesses / Math.max(1, state.missionChecks),
    sortie_rate: state.successfulSorties / Math.max(1, state.sortieAttempts),
    spare_fill_rate: filledTotal / Math.max(1, demandTotal),
    spare_utilization: filledTotal / Math.max(1, initialStock),
    shortage_events: sumValues(state.spareShortage),
    repair_backlog: state.repairQueue.length,
    mean_launch_time: average(state.launchTimes),
    mean_recovery_time: average(state.recoveryTimes),
    mean_turnaround_time: average(state.turnaroundTimes),
    downtime_failure_events: state.downtime.failure,
    downtime_spare_shortage_events: state.downtime.spare_shortage,
    downtime_resource_delay_events: state.downtime.resource_delay,
    downtime_schedule_delay_events: state.downtime.schedule_delay
  };
}

function statusCounts(equipment) {
  return equipment.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function weightedComponent(components, value) {
  if (!components.length) return { name: "默认部件", spareType: "通用备件", failureRate: 0.05 };
  const total = components.reduce((sum, item) => sum + Number(item.failureRate || 0.01), 0);
  let cursor = 0;
  for (const component of components) {
    cursor += Number(component.failureRate || 0.01) / total;
    if (value <= cursor) return component;
  }
  return components.at(-1);
}

function scaleInventory(inventory, multiplier) {
  return Object.fromEntries(
    Object.entries(inventory || {}).map(([key, value]) => [key, Math.max(0, Math.round(Number(value) * multiplier))])
  );
}

function buildSpareShortfalls(spareDemand, spareFilled, spareShortage) {
  const keys = [...new Set([...Object.keys(spareDemand), ...Object.keys(spareFilled), ...Object.keys(spareShortage)])];
  return keys.map((spareType) => {
    const demand = spareDemand[spareType] || 0;
    const filled = spareFilled[spareType] || 0;
    const shortage = spareShortage[spareType] || 0;
    return {
      spareType,
      demand,
      filled,
      shortage,
      fillRate: filled / Math.max(1, demand),
      riskLevel: shortage >= 3 ? "高" : shortage > 0 ? "中" : "低"
    };
  }).sort((a, b) => b.shortage - a.shortage || b.demand - a.demand);
}

function buildSpareShortfallsFromAggregate(aggregate) {
  return Object.entries(aggregate).map(([spareType, row]) => ({
    spareType,
    demand: row.demand,
    filled: row.filled,
    shortage: row.shortage,
    fillRate: row.filled / Math.max(1, row.demand),
    riskLevel: row.shortage >= 10 ? "高" : row.shortage > 0 ? "中" : "低"
  })).sort((a, b) => b.shortage - a.shortage || b.demand - a.demand);
}

function buildCarryList(spareDemand, spareShortage, components) {
  const rows = components.map((component) => {
    const demand = spareDemand[component.spareType] || 0;
    const shortage = spareShortage[component.spareType] || 0;
    const recommended = Math.max(1, Math.ceil(demand * 1.15 + shortage * 1.5));
    return {
      spareType: component.spareType,
      component: component.name,
      recommended,
      demand,
      shortage,
      riskLevel: shortage >= 3 ? "高" : shortage > 0 ? "中" : "低"
    };
  });
  return rows.sort((a, b) => b.recommended - a.recommended);
}

function buildCarryListFromAggregate(aggregate) {
  return Object.entries(aggregate).map(([spareType, row]) => ({
    spareType,
    component: spareType,
    recommended: Math.max(1, Math.ceil((row.demand / 4) * 1.15 + row.shortage * 0.5)),
    demand: row.demand,
    shortage: row.shortage,
    riskLevel: row.shortage >= 10 ? "高" : row.shortage > 0 ? "中" : "低"
  })).sort((a, b) => b.recommended - a.recommended);
}

function buildDowntimeFactors(downtime) {
  const labels = {
    failure: "装备故障",
    spare_shortage: "备件短缺",
    resource_delay: "保障资源不足",
    schedule_delay: "任务需求变化"
  };
  const total = Math.max(1, sumValues(downtime));
  return Object.entries(downtime).map(([reason, count]) => ({
    reason,
    label: labels[reason] || reason,
    count,
    contribution: count / total
  })).sort((a, b) => b.count - a.count);
}

function buildReliabilityAnalysis(timeline, missionChecks, missionSuccesses) {
  const final = timeline.at(-1) || {};
  return {
    missionChecks,
    missionSuccesses,
    missionReliability: missionSuccesses / Math.max(1, missionChecks),
    readyRate: final.ready_rate || 0,
    sortieRate: final.sortie_rate || 0,
    meanLaunchTime: final.mean_launch_time || 0,
    meanRecoveryTime: final.mean_recovery_time || 0,
    meanTurnaroundTime: final.mean_turnaround_time || 0
  };
}

function summarizeMetric(runs, metric) {
  const values = runs.map((run) => Number(run.final[metric] || 0));
  return {
    mean: average(values),
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function average(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function sumValues(record) {
  return Object.values(record || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}
