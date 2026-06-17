import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "./feature-catalog.mjs";
import { AVIATION_SUPPORT_DEMO_STATE, normalizeAviationSupportState } from "./aviation-support-state.mjs";
import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo,
  runSimulation,
  validateScenario
} from "./sim-engine.mjs";

const app = document.querySelector("#app");
const groups = groupFeaturePages(FEATURE_PAGES);

let scenario = cloneScenario(defaultScenario);
let singleResult = runSimulation(scenario);
let monteCarloResult = runMonteCarlo(scenario, { samples: 4 });
let selectedFeatureId = readFeatureIdFromHash() || FEATURE_PAGES[0].id;

render();
bindEvents();

function bindEvents() {
  window.addEventListener("hashchange", () => {
    selectedFeatureId = readFeatureIdFromHash() || FEATURE_PAGES[0].id;
    render();
  });

  app.addEventListener("click", (event) => {
    const featureButton = event.target.closest("[data-feature-id]");
    if (featureButton) {
      selectedFeatureId = featureButton.dataset.featureId;
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "run-single") {
      singleResult = runSimulation(scenario);
      render();
    }
    if (action === "run-mc") {
      monteCarloResult = runMonteCarlo(scenario, { samples: Number(document.querySelector("#mc-samples")?.value || 4) });
      render();
    }
    if (action === "export-json") {
      downloadJson("spare-mvp-scenario.json", scenario);
    }
  });

  app.addEventListener("change", (event) => {
    const input = event.target.closest("[data-path]");
    if (!input) return;
    setPath(scenario, input.dataset.path, parseInput(input));
    singleResult = runSimulation(scenario);
    render();
  });
}

function render() {
  const page = getFeaturePageById(selectedFeatureId);
  app.innerHTML = `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
        <div>
          <h1>备件规划及任务可靠度验证评估平台</h1>
          <p>${page.module} / ${page.secondary} / ${page.tertiary}</p>
        </div>
      </div>
      <div class="right">
        <button class="btn-primary" type="button" data-action="run-single">运行单次仿真</button>
        <button type="button" data-action="run-mc">运行 Monte Carlo</button>
        <button type="button" data-action="export-json">导出方案 JSON</button>
      </div>
    </header>
    <main class="workspace-shell">
      ${renderNavigation(page)}
      ${renderFeaturePage(page)}
      ${renderOntologyPanel(page)}
    </main>
  `;
}

function renderNavigation(activePage) {
  return `
    <aside class="feature-nav" aria-label="四级功能导航">
      <div class="nav-summary">
        <strong>四级功能页</strong>
        <span>${FEATURE_PAGES.length} 个页面</span>
      </div>
      ${Object.entries(groups).map(([moduleName, secondaryGroups]) => `
        <section class="nav-module">
          <h2>${moduleName}</h2>
          ${Object.entries(secondaryGroups).map(([secondaryName, tertiaryGroups]) => `
            <div class="nav-secondary">
              <h3>${secondaryName}</h3>
              ${Object.entries(tertiaryGroups).map(([tertiaryName, pages]) => `
                <div class="deck-modeling-nav">
                  <div class="nav-tertiary">${tertiaryName}</div>
                  ${pages.map((page) => `
                    <button type="button" class="feature-nav-item ${page.id === activePage.id ? "active" : ""}" data-feature-id="${page.id}">
                      ${page.name}
                    </button>
                  `).join("")}
                </div>
              `).join("")}
            </div>
          `).join("")}
        </section>
      `).join("")}
    </aside>
  `;
}

function renderFeaturePage(page) {
  const siblingPages = groups[page.module][page.secondary][page.tertiary];
  return `
    <section class="deck-modeling-content feature-page">
      <div class="page-head">
        <div>
          <div class="breadcrumb">${page.module} / ${page.secondary} / ${page.tertiary}</div>
          <h2>${page.name}</h2>
          <p>${page.summary}</p>
        </div>
        <div class="page-head-current-context">
          <span>当前方案</span>
          <strong>${scenario.experiment.name}</strong>
        </div>
      </div>
      <nav class="experiment-main-tabs experiment-subtabs" aria-label="同组四级功能">
        ${siblingPages.map((item) => `
          <button class="tab-btn ${item.id === page.id ? "active" : ""}" type="button" data-feature-id="${item.id}">
            ${item.name}
          </button>
        `).join("")}
      </nav>
      <div class="page-grid">
        <section class="panel main-panel">
          ${renderMainComponent(page)}
        </section>
        <section class="panel side-panel">
          ${renderValidationAndOutputs(page)}
        </section>
      </div>
    </section>
  `;
}

function renderMainComponent(page) {
  if (page.component === "visual-simulation") return renderVisualSimulation(page);
  if (page.component === "reliability-block-diagram") return renderReliabilityBlockDiagram();
  if (page.component === "activity-gantt") return renderActivityGantt(page);
  if (page.component === "resource-table") return renderResourceTable(page);
  if (page.component === "equipment-table") return renderEquipmentTable(page);
  if (page.component === "experiment-form") return renderExperimentForm(page);
  if (page.component === "monte-carlo-config") return renderMonteCarloConfig();
  if (page.component === "monte-carlo-results") return renderMonteCarloResults();
  if (page.component === "analysis") return renderAnalysis(page);
  if (page.component === "import-table") return renderImportTable();
  if (page.component === "scenario-switch") return renderScenarioSwitch();
  return renderTaskModel(page);
}

function renderTaskModel(page) {
  return `
    <div class="section-head">
      <h3>${page.name}字段</h3>
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="form-table-grid">
      ${field("任务类型", "missionProfile.profileType")}
      ${field("重复周期", "missionProfile.repeatCycleHours", "number")}
      ${field("结束条件", "missionProfile.endCondition")}
      ${field("基本任务", "basicMission.missionId")}
      ${field("成功点", "basicMission.successPoint")}
      ${field("最低出动数量", "basicMission.minRequiredSorties", "number")}
      ${field("装备型号", "equipment.model")}
      ${field("装备数量", "equipment.quantity", "number")}
    </div>
    <div class="object-tree">
      <div class="tree-node root">${scenario.missionProfile.profileType}</div>
      ${scenario.missionPhases.map((phase) => `<div class="tree-node">${phase.name}<span>${phase.state}</span></div>`).join("")}
      <div class="tree-node">${scenario.combatUnit.unitId}<span>${scenario.equipment.quantity} 架</span></div>
    </div>
  `;
}

function renderEquipmentTable(page) {
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>装备组成 / 故障参数</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>组件</th><th>备件类型</th><th>故障模型</th><th>失效率</th><th>MTBF</th><th>连接类型</th></tr></thead>
        <tbody>
          ${scenario.components.map((component) => `
            <tr>
              <td>${component.name}</td>
              <td>${component.spareType}</td>
              <td>${component.failureModel}</td>
              <td>${component.failureRate}</td>
              <td>${component.mtbfHours}h</td>
              <td><span class="badge">${component.connectionType}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReliabilityBlockDiagram() {
  const nodes = scenario.reliabilityBlockDiagram.nodes;
  return `
    <div class="section-head">
      <h3>装备可靠性框图</h3>
      <span>串联 / 并联 / 备用</span>
    </div>
    <div class="rbd-canvas">
      ${nodes.map((node, index) => `
        <div class="rbd-node ${node.type}" style="grid-column:${index === 0 ? "1 / -1" : "auto"}">
          <strong>${node.name}</strong>
          <span>${node.connectionType}</span>
          <small>失效率 ${node.failureRate} / MTBF ${node.mtbfHours}h</small>
        </div>
      `).join("")}
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>起点</th><th>终点</th><th>关系</th><th>权重</th></tr></thead>
        <tbody>${scenario.reliabilityBlockDiagram.edges.map((edge) => `<tr><td>${edge.from}</td><td>${edge.to}</td><td>${edge.type}</td><td>${edge.weight}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderResourceTable(page) {
  const rows = scenario.supportNodes.flatMap((node) => Object.entries(node.inventory || {}).map(([spareType, quantity]) => ({
    node: node.name,
    spareType,
    quantity,
    personnel: node.personnelCapacity,
    equipment: node.equipmentCapacity
  })));
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>组织 / 人员 / 设备 / 备件</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>保障节点</th><th>备件</th><th>库存</th><th>人员容量</th><th>设备容量</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${row.node}</td><td>${row.spareType}</td><td>${row.quantity}</td><td>${row.personnel}</td><td>${row.equipment}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderActivityGantt(page) {
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>保障活动流程</span>
    </div>
    <div class="gantt-chart">
      ${scenario.supportActivities.map((activity, index) => `
        <div class="gantt-row">
          <strong>${activity.activityType}</strong>
          <div class="gantt-lane">
            <span style="left:${8 + index * 12}%;width:${Math.min(32, activity.durationHours * 9)}%">${activity.durationHours}h</span>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>活动</th><th>人员</th><th>设备</th><th>备件</th><th>优先级</th></tr></thead>
        <tbody>${scenario.supportActivities.map((activity) => `<tr><td>${activity.activityType}</td><td>${activity.requiredPersonnel}</td><td>${activity.requiredDevices}</td><td>${activity.spareType || "-"}</td><td>${activity.priority}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderExperimentForm(page) {
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>实验方案参数</span>
    </div>
    <div class="form-table-grid">
      ${field("实验名称", "experiment.name")}
      ${field("仿真步数", "experiment.steps", "number")}
      ${field("样本数", "experiment.samples", "number")}
      ${field("随机种子", "experiment.seed", "number")}
      ${field("并行核心数", "experiment.parallelCores", "number")}
      ${field("停止条件", "experiment.stopCondition")}
    </div>
  `;
}

function renderVisualSimulation(page) {
  const state = normalizeAviationSupportState(AVIATION_SUPPORT_DEMO_STATE);
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>本地 aviation_support 状态帧</span>
    </div>
    <div class="kpi-strip">
      ${state.kpis.map((item) => `<div class="kpi-card"><span>${item.label}</span><strong>${item.value}</strong></div>`).join("")}
    </div>
    <div class="simulation-layout">
      <div class="aircraft-board">
        ${state.aircraft.map((aircraft) => `<div class="aircraft-tile ${aircraft.state}"><strong>${aircraft.label}</strong><span>${aircraft.type}</span><em>${stateLabel(aircraft.state)}</em></div>`).join("")}
      </div>
      <div class="stack-list">
        <h4>任务</h4>
        ${state.missions.map((mission) => `<div class="list-row"><strong>M-${mission.id}</strong><span>${mission.status}</span><span>${mission.assignedCount}/${mission.requiredAircraft}</span></div>`).join("")}
        <h4>保障资源</h4>
        ${state.resources.map((resource) => `<div class="metric-line"><strong>${resource.label}</strong><div class="bar"><span style="width:${Math.round(resource.utilization * 100)}%"></span></div><span>${resource.inUse}/${resource.capacity}</span></div>`).join("")}
      </div>
      <div class="stack-list">
        <h4>备件与作业</h4>
        ${state.spares.map((spare) => `<div class="list-row"><strong>${spare.label}</strong><span>库存 ${spare.quantity}</span><span>消耗 ${spare.consumed}</span></div>`).join("")}
        ${state.jobs.map((job) => `<div class="event info"><strong>${job.tailNumber}</strong> ${job.task} / ${job.remaining}min</div>`).join("")}
        ${state.events.map((event) => `<div class="event success"><strong>T+${event.time}</strong> ${event.message}</div>`).join("")}
      </div>
    </div>
  `;
}

function renderMonteCarloConfig() {
  return `
    <div class="section-head">
      <h3>蒙特卡洛实验配置</h3>
      <span>扫参 / 样本 / seed</span>
    </div>
    <div class="form-table-grid">
      <label>样本数<input id="mc-samples" type="number" min="1" value="${scenario.experiment.samples}"></label>
      <label>故障率扫描<input value="${scenario.monteCarlo.failureRates.join(",")}"></label>
      <label>备件倍数<input value="${scenario.monteCarlo.spareMultipliers.join(",")}"></label>
      <label>保障容量<input value="${scenario.monteCarlo.supportCapacities.join(",")}"></label>
    </div>
  `;
}

function renderMonteCarloResults() {
  return `
    <div class="section-head">
      <h3>蒙特卡洛实验结果展示</h3>
      <span>${monteCarloResult.runs.length} 个样本</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>参数组</th><th>样本数</th><th>任务可靠度</th><th>战备完好率</th><th>短缺事件</th></tr></thead>
        <tbody>${monteCarloResult.groups.map((group) => `<tr><td>${group.group}</td><td>${group.count}</td><td>${pct(group.mission_success_rate.mean)}</td><td>${pct(group.ready_rate.mean)}</td><td>${fixed(group.shortage_events.mean, 1)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderAnalysis(page) {
  const final = singleResult.final;
  const rows = page.name.includes("备件短板")
    ? singleResult.spareShortfalls.map((row) => [row.spareType, `需求 ${row.demand}`, `短缺 ${row.shortage}`, `${pct(row.fillRate)} 满足`])
    : page.name.includes("携行")
      ? singleResult.carryList.map((row) => [row.spareType, `建议 ${row.recommended}`, `短缺 ${row.shortage}`, `${row.riskLevel}风险`])
      : page.name.includes("停机")
        ? singleResult.downtimeFactors.map((row) => [row.label, `${row.count} 次`, pct(row.contribution), row.reason])
        : [["任务可靠度", pct(final.mission_success_rate), "单次仿真", "由任务波次判定"], ["出动架次率", pct(final.sortie_rate), "单次仿真", "由出动成功数判定"], ["战备完好率", pct(final.ready_rate), "单次仿真", "由 ready 状态判定"]];
  return `
    <div class="section-head">
      <h3>${page.name}</h3>
      <span>结果分析</span>
    </div>
    <div class="rank-list">
      ${rows.map((row) => `<div class="rank-row"><strong>${row[0]}</strong><span>${row[1]}</span><span>${row[2]}</span><span>${row[3]}</span></div>`).join("")}
    </div>
  `;
}

function renderImportTable() {
  return `
    <div class="section-head">
      <h3>结果导入</h3>
      <span>指标分配方案管理</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>结果集</th><th>来源实验</th><th>主指标</th><th>状态</th></tr></thead>
        <tbody><tr><td>local-smoke-summary</td><td>aviation_support_smoke</td><td>sortie_completion_rate</td><td>待导入校验</td></tr></tbody>
      </table>
    </div>
  `;
}

function renderScenarioSwitch() {
  return `
    <div class="section-head">
      <h3>场景切换</h3>
      <span>宏观任务视图 / 机场保障视图 / 指标统计视图</span>
    </div>
    <div class="scenario-grid">
      ${["宏观任务视图", "陆基/舰基保障视图", "指标统计视图"].map((name) => `<button type="button" class="scenario-card">${name}<span>${scenario.scenarioId}</span></button>`).join("")}
    </div>
  `;
}

function renderValidationAndOutputs(page) {
  const issues = validateScenario(scenario);
  return `
    <div class="section-head">
      <h3>校验与输出</h3>
      <span>${page.component}</span>
    </div>
    <div class="check-list">
      ${issues.length ? issues.map((issue) => `<div class="issue">${issue}</div>`).join("") : `<div class="ok">共享 scenario 校验通过</div>`}
    </div>
    <h4>写入对象</h4>
    <div class="tag-list">${page.dataObjects.map((item) => `<span>${item}</span>`).join("")}</div>
    <h4>输出联动</h4>
    <div class="output-list">${page.outputs.map((item) => `<div>${item}</div>`).join("")}</div>
  `;
}

function renderOntologyPanel(page) {
  return `
    <aside class="ontology-panel">
      <div class="section-head">
        <h3>Ontology 上下文</h3>
        <span>${page.ontology.nodes.length} 节点 / ${page.ontology.edges.length} 关系</span>
      </div>
      ${renderOntologyGraph(page)}
      <div class="ontology-edge-list">
        ${page.ontology.edges.slice(-6).map((edge) => `<div><strong>${edge.label}</strong><span>${nodeLabel(page, edge.from)} -> ${nodeLabel(page, edge.to)}</span></div>`).join("")}
      </div>
    </aside>
  `;
}

function renderOntologyGraph(page) {
  const graphNodes = page.ontology.nodes.slice(0, 8);
  const positions = [
    [170, 40],
    [70, 100],
    [170, 100],
    [270, 100],
    [70, 170],
    [170, 170],
    [270, 170],
    [170, 240]
  ];
  return `
    <svg class="ontology-graph" viewBox="0 0 340 280" role="img" aria-label="${page.name} ontology graph">
      ${page.ontology.edges.slice(0, 10).map((edge) => {
        const fromIndex = Math.max(0, graphNodes.findIndex((node) => node.id === edge.from));
        const toIndex = Math.max(0, graphNodes.findIndex((node) => node.id === edge.to));
        const [x1, y1] = positions[fromIndex];
        const [x2, y2] = positions[toIndex];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
      }).join("")}
      ${graphNodes.map((node, index) => {
        const [x, y] = positions[index];
        return `<g class="ontology-node ${node.type}" transform="translate(${x} ${y})"><circle r="24"></circle><text>${truncate(node.label, 9)}</text></g>`;
      }).join("")}
    </svg>
  `;
}

function field(label, path, type = "text") {
  return `<label>${label}<input data-path="${path}" type="${type}" value="${htmlEscape(getPath(scenario, path))}"></label>`;
}

function readFeatureIdFromHash() {
  const match = location.hash.match(/feature=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function getPath(obj, path) {
  return path.split(".").reduce((current, part) => current?.[part], obj) ?? "";
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function parseInput(input) {
  return input.type === "number" ? Number(input.value) : input.value;
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

function stateLabel(state) {
  const labels = {
    available: "可用",
    pre_support: "保障中",
    mission_ready: "待出动",
    flying: "飞行",
    post_support: "回收",
    maintenance: "维修"
  };
  return labels[state] || state;
}

function nodeLabel(page, id) {
  return page.ontology.nodes.find((node) => node.id === id)?.label || id;
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function fixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
