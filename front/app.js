import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo,
  runSimulation,
  validateScenario
} from "./sim-engine.mjs";

let scenario = cloneScenario(defaultScenario);
let singleResult = runSimulation(scenario);
let monteCarloResult = runMonteCarlo(scenario, { samples: 4 });
let selectedStep = singleResult.timeline.length - 1;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const fixed = (value, digits = 2) => Number(value || 0).toFixed(digits);

init();

function init() {
  bindNavigation();
  bindForm();
  bindActions();
  renderAll();
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.target));
    });
  });
}

function bindForm() {
  fillForm();
  $("#scenario-form").addEventListener("input", () => {
    readForm();
    singleResult = runSimulation(scenario);
    selectedStep = singleResult.timeline.length - 1;
    renderAll();
  });
  $("#module-select").addEventListener("change", (event) => {
    scenario.activeModule = event.target.value;
    renderAll();
  });
}

function bindActions() {
  $("#run-single").addEventListener("click", () => {
    readForm();
    singleResult = runSimulation(scenario);
    selectedStep = singleResult.timeline.length - 1;
    renderAll();
  });
  $("#run-mc").addEventListener("click", () => {
    readForm();
    monteCarloResult = runMonteCarlo(scenario, { samples: Number($("#mc-samples").value || 4), sweep: readSweep() });
    renderAll();
  });
  $("#export-json").addEventListener("click", () => downloadJson("scenario.json", scenario));
  $("#step-back").addEventListener("click", () => {
    selectedStep = 0;
    renderSimulationView();
  });
  $("#step-forward").addEventListener("click", () => {
    selectedStep = Math.min(selectedStep + 1, singleResult.timeline.length - 1);
    renderSimulationView();
  });
  $("#step-slider").addEventListener("input", (event) => {
    selectedStep = Number(event.target.value);
    renderSimulationView();
  });
}

function renderAll() {
  renderModeling();
  renderReliability();
  renderGantt();
  renderSimulationView();
  renderMonteCarloView();
  renderAnalysis();
}

function fillForm() {
  for (const input of $$("[name]")) {
    if (input.name === "failureRate") {
      input.value = fixed(avg(scenario.components.map((item) => item.failureRate)), 2);
    } else {
      input.value = getPath(scenario, input.name) ?? "";
    }
  }
  $("#module-select").value = scenario.activeModule;
  $("#mc-samples").value = scenario.experiment.samples;
}

function readForm() {
  for (const input of $$("[name]")) {
    if (input.name === "failureRate") {
      const value = Number(input.value || 0);
      scenario.components.forEach((component) => {
        component.failureRate = value;
      });
      scenario.reliabilityBlockDiagram.nodes.forEach((node) => {
        if (node.type === "component") node.failureRate = value;
      });
    } else {
      setPath(scenario, input.name, parseInput(input));
    }
  }
  scenario.equipment.initialReady = Math.min(scenario.equipment.quantity, scenario.equipment.initialReady || scenario.equipment.quantity);
}

function renderModeling() {
  $("#model-tree").innerHTML = `
    <ul>
      <li><strong>${scenario.missionProfile.profileType}</strong><div class="node-meta">任务剖面 ${scenario.missionProfile.repeatCycleHours}h 周期</div>
        <ul>
          <li>${scenario.basicMission.missionId}<div class="node-meta">最低出动 ${scenario.basicMission.minRequiredSorties} 架 优先级 ${scenario.basicMission.priority}</div>
            <ul>${scenario.missionPhases.map((phase) => `<li>${phase.name}<div class="node-meta">${phase.state} / ${phase.transitionCondition}</div></li>`).join("")}</ul>
          </li>
          <li>${scenario.combatUnit.unitId}<div class="node-meta">${scenario.combatUnit.equipmentType} ${scenario.equipment.quantity} 架 / ${scenario.equipment.deploymentLocation}</div>
            <ul>${scenario.components.map((component) => `<li>${component.name}<div class="node-meta">${component.failureModel} / ${component.spareType} / 故障率 ${component.failureRate}</div></li>`).join("")}</ul>
          </li>
          <li>保障节点<div class="node-meta">${scenario.supportNodes.map((node) => node.name).join("、")}</div>
            <ul>${scenario.supportActivities.map((activity) => `<li>${activity.activityType}<div class="node-meta">${activity.durationHours}h / 人员 ${activity.requiredPersonnel} / 设备 ${activity.requiredDevices}</div></li>`).join("")}</ul>
          </li>
        </ul>
      </li>
    </ul>
  `;
  const issues = validateScenario(scenario);
  $("#validation-panel").innerHTML = issues.length
    ? issues.map((issue) => `<div class="issue">${issue}</div>`).join("")
    : `<div class="ok">方案字段、关系端点和核心对象校验通过</div>`;
  $("#json-preview").textContent = JSON.stringify(scenario, null, 2);
}

function renderReliability() {
  const nodes = scenario.reliabilityBlockDiagram.nodes;
  const childrenByParent = nodes.reduce((acc, node) => {
    const key = node.parentId || "root";
    acc[key] ||= [];
    acc[key].push(node);
    return acc;
  }, {});
  const renderNode = (node) => {
    const className = node.connectionType === "串联" ? "series" : node.connectionType === "并联" ? "parallel" : "standby";
    const children = childrenByParent[node.id] || [];
    return `<div class="reliability-node">
      <strong>${node.name}</strong>
      <div class="node-meta"><span class="badge ${className}">${node.connectionType}</span><span>失效率 ${node.failureRate}</span><span>MTBF ${node.mtbfHours}h</span></div>
      ${children.length ? `<ul>${children.map((child) => `<li>${renderNode(child)}</li>`).join("")}</ul>` : ""}
    </div>`;
  };
  $("#reliability-tree").innerHTML = (childrenByParent.root || []).map(renderNode).join("");
  const checks = validateScenario(scenario);
  $("#rbd-checks").innerHTML = checks.length
    ? checks.map((issue) => `<div class="issue">${issue}</div>`).join("")
    : `<div class="ok">无环路、端点完整，组件故障参数已赋值</div>`;
  const critical = [...nodes].filter((node) => node.type === "component").sort((a, b) => b.failureRate - a.failureRate);
  $("#critical-components").innerHTML = critical.map((node) => rankRow(node.name, `失效率 ${node.failureRate}`, `MTBF ${node.mtbfHours}`, node.connectionType)).join("");
}

function renderGantt() {
  const activities = scenario.supportActivities;
  const lanes = scenario.supportNodes.map((node, nodeIndex) => {
    const bars = activities.map((activity, index) => {
      const start = 6 + index * 17 + nodeIndex * 4;
      const width = Math.max(12, activity.durationHours * 9);
      const klass = activity.activityType.includes("维修") ? "maintenance" : activity.activityType.includes("预防") ? "preventive" : "";
      return `<div class="gantt-bar ${klass}" style="left:${start}%;width:${Math.min(width, 32)}%">${activity.activityType}</div>`;
    }).join("");
    return `<div class="gantt-row"><strong>${node.name}</strong><div class="gantt-lane">${bars}</div></div>`;
  });
  $("#gantt-chart").innerHTML = lanes.join("");
}

function renderSimulationView() {
  const slider = $("#step-slider");
  slider.max = Math.max(0, singleResult.timeline.length - 1);
  slider.value = selectedStep;
  const row = singleResult.timeline[selectedStep] || singleResult.final;
  $("#kpi-strip").innerHTML = [
    ["战备完好率", pct(row.ready_rate)],
    ["任务可靠度", pct(row.mission_success_rate)],
    ["出动架次率", pct(row.sortie_rate)],
    ["备件满足率", pct(row.spare_fill_rate)],
    ["短缺事件", fixed(row.shortage_events, 0)],
    ["维修积压", fixed(row.repair_backlog, 0)]
  ].map(([label, value]) => `<div class="kpi-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#mission-state").innerHTML = [
    ["ready", "待命/可用", row.ready_count],
    ["preparing", "准备", row.preparing_count],
    ["sortie", "出动", row.sortie_count],
    ["failed", "故障", row.failed_count],
    ["repairing", "维修", row.repairing_count]
  ].map(([key, label, value]) => stateLine(label, Number(value || 0), scenario.equipment.quantity, key)).join("");
  $("#airport-board").innerHTML = makePlaneTiles(row).join("");
  $("#event-feed").innerHTML = singleResult.events
    .filter((event) => event.step <= row.step)
    .slice(-18)
    .reverse()
    .map((event) => `<div class="event ${event.severity}"><strong>T+${event.step}</strong> ${event.message}</div>`)
    .join("");
}

function renderMonteCarloView() {
  const groups = monteCarloResult.groups || [];
  $("#mc-summary").innerHTML = [
    ["参数组", groups.length],
    ["样本数", monteCarloResult.runs.length],
    ["短缺类型", monteCarloResult.spareShortfalls.length],
    ["最高任务可靠度", pct(Math.max(...groups.map((group) => group.mission_success_rate.mean), 0))]
  ].map(([label, value]) => `<div class="kpi-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#mc-table").innerHTML = `<table>
    <thead><tr><th>参数组</th><th>样本数</th><th>任务可靠度</th><th>战备完好率</th><th>出动架次率</th><th>备件满足率</th><th>短缺事件</th><th>平均出动时间</th></tr></thead>
    <tbody>
      ${groups.map((group) => `<tr>
        <td>${group.group}</td>
        <td>${group.count}</td>
        <td>${pct(group.mission_success_rate.mean)}</td>
        <td>${pct(group.ready_rate.mean)}</td>
        <td>${pct(group.sortie_rate.mean)}</td>
        <td>${pct(group.spare_fill_rate.mean)}</td>
        <td>${fixed(group.shortage_events.mean, 1)}</td>
        <td>${fixed(group.mean_launch_time.mean, 1)}h</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderAnalysis() {
  const source = monteCarloResult.runs.length ? monteCarloResult : singleResult;
  $("#shortfall-analysis").innerHTML = source.spareShortfalls.map((row) => rankRow(row.spareType, `需求 ${row.demand}`, `短缺 ${row.shortage}`, `${pct(row.fillRate)} 满足`)).join("");
  $("#carry-list").innerHTML = source.carryList.map((row) => rankRow(row.spareType, `建议 ${row.recommended}`, `短缺 ${row.shortage}`, `${row.riskLevel}风险`)).join("");
  const final = singleResult.final;
  $("#task-reliability").innerHTML = [
    ["任务可靠度", final.mission_success_rate],
    ["战备完好率", final.ready_rate],
    ["出动架次率", final.sortie_rate],
    ["备件满足率", final.spare_fill_rate]
  ].map(([label, value]) => metricLine(label, value)).join("");
  $("#downtime-analysis").innerHTML = source.downtimeFactors.map((row) => metricLine(row.label, row.contribution, `${row.count} 次`)).join("");
}

function stateLine(label, value, total, key) {
  return `<div class="state-row"><strong>${label}</strong><div class="bar"><span style="width:${Math.min(100, (value / Math.max(1, total)) * 100)}%"></span></div><span>${value}</span></div>`;
}

function makePlaneTiles(row) {
  const entries = [];
  const states = [
    ["ready", row.ready_count],
    ["preparing", row.preparing_count],
    ["sortie", row.sortie_count],
    ["failed", row.failed_count],
    ["repairing", row.repairing_count]
  ];
  let index = 1;
  for (const [state, count] of states) {
    for (let i = 0; i < Number(count || 0); i += 1) {
      entries.push(`<div class="plane ${state}">EQ-${String(index).padStart(2, "0")}<br>${state}</div>`);
      index += 1;
    }
  }
  return entries;
}

function metricLine(label, value, note = pct(value)) {
  const numeric = Number(value || 0);
  return `<div class="metric-line"><strong>${label}</strong><div class="bar"><span style="width:${Math.min(100, numeric * 100)}%"></span></div><span>${note}</span></div>`;
}

function rankRow(name, a, b, c) {
  return `<div class="rank-row"><strong>${name}</strong><span>${a}</span><span>${b}</span><span>${c}</span></div>`;
}

function readSweep() {
  const rates = readNumberList($("#mc-failure").value);
  const spares = readNumberList($("#mc-spares").value);
  const capacities = readNumberList($("#mc-capacity").value);
  return rates.flatMap((failureRate) => spares.flatMap((spareMultiplier) => capacities.map((supportCapacity) => ({
    name: `故障${failureRate}/备件${spareMultiplier}/容量${supportCapacity}`,
    failureRate,
    spareMultiplier,
    supportCapacity,
    minRequiredSorties: scenario.basicMission.minRequiredSorties
  }))));
}

function readNumberList(text) {
  return String(text).split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseInput(input) {
  if (input.type === "number") return Number(input.value);
  return input.value;
}

function getPath(obj, path) {
  return path.split(".").reduce((current, part) => current?.[part], obj);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function avg(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, values.length);
}
