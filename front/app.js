import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "./feature-catalog.mjs";
import { AVIATION_SUPPORT_DEMO_STATE, normalizeAviationSupportState } from "./aviation-support-state.mjs";
import { ONTOLOGY_GROUPS, PROJECT_ONTOLOGY } from "./ontology-context.mjs";
import {
  cloneScenario,
  defaultScenario,
  runMonteCarlo,
  runSimulation
} from "./sim-engine.mjs";

const app = document.querySelector("#app");
const groups = groupFeaturePages(FEATURE_PAGES);
const DEFAULT_ROUTE = "login";
const DEFAULT_FEATURE_ID = "spare-planning-experiment-plan-list";
const DEMO_USERS = [
  { username: "admin", role: "系统管理员" },
  { username: "data", role: "数据管理员" },
  { username: "user", role: "普通用户" }
];
const DEMO_PROJECTS = [
  { id: "carrier-day-night", name: "航母编队昼夜保障验证", shipType: "01", updatedAt: "2026-04-26", summary: "验证昼夜连续出动下的甲板保障流程与资源配置。" },
  { id: "high-tempo-support", name: "高强度出动保障压力测试", shipType: "03", updatedAt: "2026-04-28", summary: "评估多波次出动下备件、人员和保障设备的瓶颈。" },
  { id: "maintenance-rebalance", name: "维修资源动态重配评估", shipType: "02", updatedAt: "2026-05-02", summary: "分析维修资源重配对任务可靠度和停机贡献的影响。" }
];
const CARRY_OBJECTIVES = [
  { id: "availability", label: "使用可用度", metricLabel: "预计使用可用度", metricValue: "0.91" },
  { id: "sortie-rate", label: "出动架次率", metricLabel: "预计出动架次率", metricValue: "86%" },
  { id: "turnaround-time", label: "再次出动准备时间", metricLabel: "预计准备时间", metricValue: "42 min" }
];
const SUPPORT_ORG_TREE = [
  { id: "wing", name: "舰载机保障大队", children: [
    { id: "service", name: "机务保障中队", children: [{ id: "fuel", name: "油料组" }, { id: "avionics", name: "航电组" }, { id: "ordnance", name: "军械组" }] },
    { id: "repair", name: "维修保障中队", children: [{ id: "line", name: "外场维修组" }, { id: "spare", name: "备件保障组" }] }
  ] }
];
const SUPPORT_ACTIVITY_PLANS = [
  { type: "使用保障活动建模", name: "歼-35快速出动保障方案1", jobs: ["机务检查", "燃油加注", "挂弹作业", "通电检查"] },
  { type: "预防性维修活动建模", name: "8小时周期检查方案", jobs: ["定检准备", "航电检查", "液压系统检查", "记录归档"] },
  { type: "修复性维修活动建模", name: "航电故障换件维修方案", jobs: ["故障定位", "备件领用", "换件维修", "功能复测"] }
];

let scenario = cloneScenario(defaultScenario);
let singleResult = runSimulation(scenario);
let monteCarloResult = runMonteCarlo(scenario);
let isLoggedIn = false;
let currentUser = DEMO_USERS[2];
let currentProject = DEMO_PROJECTS[0];
let selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
let selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
let selectedMesaView = "aircraft";
let carryObjective = CARRY_OBJECTIVES[0].id;
let experimentRunStatus = "当前";
let isProjectMenuOpen = false;

render();
bindEvents();

function bindEvents() {
  window.addEventListener("hashchange", () => {
    selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
    selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
    render();
  });

  app.addEventListener("click", (event) => {
    const loginButton = event.target.closest("[data-login-submit]");
    if (loginButton) {
      isLoggedIn = true;
      currentUser = DEMO_USERS.find((user) => user.username === "user") || DEMO_USERS[0];
      selectedRoute = "projects";
      location.hash = "route=projects";
      render();
      return;
    }

    const logoutButton = event.target.closest("[data-logout]");
    if (logoutButton) {
      isLoggedIn = false;
      selectedRoute = DEFAULT_ROUTE;
      location.hash = "route=login";
      render();
      return;
    }

    const enterWorkbenchButton = event.target.closest("[data-enter-workbench]");
    if (enterWorkbenchButton) {
      currentProject = DEMO_PROJECTS.find((project) => project.id === enterWorkbenchButton.dataset.projectId) || DEMO_PROJECTS[0];
      isLoggedIn = true;
      selectedRoute = "workbench";
      selectedFeatureId = DEFAULT_FEATURE_ID;
      isProjectMenuOpen = false;
      location.hash = `feature=${DEFAULT_FEATURE_ID}`;
      render();
      return;
    }

    const projectMenuButton = event.target.closest("[data-project-menu-toggle]");
    if (projectMenuButton) {
      isProjectMenuOpen = !isProjectMenuOpen;
      render();
      return;
    }

    const projectListButton = event.target.closest("[data-project-list]");
    if (projectListButton) {
      selectedRoute = "projects";
      isProjectMenuOpen = false;
      location.hash = "route=projects";
      render();
      return;
    }

    const planListLink = event.target.closest("[data-plan-list-link]");
    if (planListLink) {
      const page = getFeaturePageById(selectedFeatureId);
      selectedRoute = "workbench";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${getPlanListFeatureId(page.module)}`;
      render();
      return;
    }

    const mesaViewButton = event.target.closest("[data-mesa-view]");
    if (mesaViewButton) {
      selectedMesaView = mesaViewButton.dataset.mesaView;
      render();
      return;
    }

    const monteCarloStartButton = event.target.closest("[data-mc-action='start']");
    if (monteCarloStartButton) {
      const page = getFeaturePageById(selectedFeatureId);
      experimentRunStatus = "运行中";
      selectedRoute = "workbench";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const featureButton = event.target.closest("[data-feature-id]");
    if (featureButton) {
      selectedRoute = "workbench";
      selectedFeatureId = featureButton.dataset.featureId;
      location.hash = `feature=${selectedFeatureId}`;
      render();
    }
  });

  app.addEventListener("change", (event) => {
    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) {
      updateMonteCarloArrayInput(mcArrayInput);
      render();
      return;
    }

    const input = event.target.closest("[data-path]");
    if (!input) return;
    setPath(scenario, input.dataset.path, parseInput(input));
    singleResult = runSimulation(scenario);
    monteCarloResult = runMonteCarlo(scenario);
    render();
  });

  app.addEventListener("input", (event) => {
    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) updateMonteCarloArrayInput(mcArrayInput);
  });
}

function render() {
  if (!isLoggedIn) {
    app.innerHTML = renderLoginPage();
    return;
  }
  if (selectedRoute === "projects") {
    app.innerHTML = renderProjectListPage();
    return;
  }
  const page = getFeaturePageById(selectedFeatureId);
  selectedFeatureId = page.id;
  app.innerHTML = `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
        <div>
          <h1>备件规划及任务可靠度验证评估平台</h1>
          <p>${htmlEscape(currentProject.name)} / ${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}</p>
        </div>
      </div>
      <div class="right">
        ${renderProjectMenu()}
        <button type="button" data-logout>退出</button>
      </div>
    </header>
    <main class="workspace-shell">
      ${renderNavigation(page)}
      ${renderFeaturePage(page)}
    </main>
  `;
}

function renderLoginPage() {
  return `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="brand-mark">BJGH</div>
        <h1>备件规划及任务可靠度验证评估平台</h1>
        <p>登录后进入项目列表，再选择项目进入功能导航页。</p>
        <div class="auth-form">
          <label>用户名<input value="${currentUser.username}" aria-label="用户名"></label>
          <label>密码<input value="123456" type="password" aria-label="密码"></label>
          <button type="button" class="btn-primary" data-login-submit>登录</button>
        </div>
        <div class="auth-users">
          ${DEMO_USERS.map((user) => `<span>${user.username} / ${user.role}</span>`).join("")}
        </div>
      </section>
    </main>
  `;
}

function renderProjectMenu() {
  return `
    <div class="project-menu">
      <button type="button" class="project-menu-toggle" data-project-menu-toggle aria-expanded="${isProjectMenuOpen}">
        <span>${htmlEscape(currentProject.name)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      ${isProjectMenuOpen ? `
        <div class="project-menu-panel" role="menu">
          <button type="button" data-project-list role="menuitem">返回项目列表</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderProjectListPage() {
  return `
    <header class="topbar">
      <div class="left">
        <div class="brand-mark">BJGH</div>
        <div>
          <h1>项目列表</h1>
          <p>${currentUser.role} / 选择项目后进入功能导航页</p>
        </div>
      </div>
      <div class="right"><button type="button" data-logout>退出</button></div>
    </header>
    <main class="project-page">
      <section class="project-toolbar">
        <div>
          <h2>项目列表</h2>
          <p>当前保留静态原型数据，项目选择会切换顶部上下文。</p>
        </div>
        <button type="button" class="btn-primary" data-enter-workbench data-project-id="${currentProject.id}">进入当前项目</button>
      </section>
      <section class="project-grid">
        ${DEMO_PROJECTS.map((project) => `
          <article class="project-card ${project.id === currentProject.id ? "active" : ""}">
            <div>
              <span>舰型 ${project.shipType}</span>
              <h3>${htmlEscape(project.name)}</h3>
              <p>${htmlEscape(project.summary)}</p>
            </div>
            <div class="project-card-foot">
              <small>更新 ${project.updatedAt}</small>
              <button type="button" data-enter-workbench data-project-id="${project.id}">进入</button>
            </div>
          </article>
        `).join("")}
      </section>
    </main>
  `;
}

function renderNavigation(activePage) {
  return `
    <aside class="feature-nav" aria-label="功能导航">
      ${Object.entries(groups).map(([moduleName, secondaryGroups]) => `
        <details class="nav-module" ${moduleName === activePage.module ? "open" : ""}>
          <summary>${moduleName}</summary>
          ${Object.entries(secondaryGroups).map(([secondaryName, tertiaryGroups]) => `
            <details class="nav-secondary" ${secondaryName === activePage.secondary ? "open" : ""}>
              <summary>${secondaryName}</summary>
              ${Object.entries(tertiaryGroups).map(([tertiaryName, pages]) => `
                <button type="button" class="nav-tertiary-link ${isActiveTertiary(activePage, pages) ? "active" : ""}" data-feature-id="${pages[0].id}">
                  ${tertiaryName}
                </button>
              `).join("")}
            </details>
          `).join("")}
        </details>
      `).join("")}
    </aside>
  `;
}

function renderFeaturePage(page) {
  const siblingPages = groups[page.module][page.secondary][page.tertiary];
  return `
    <section class="deck-modeling-content feature-page">
      <div class="page-head">
        ${renderPageHeading(page)}
        <button class="page-head-current-context" type="button" data-plan-list-link>
          <span>当前方案</span>
          <strong>${htmlEscape(scenario.experiment.name)}</strong>
        </button>
      </div>
      ${renderFourthLevelTabs(page, siblingPages)}
      <div class="page-grid">
        <section class="panel main-panel">
          ${renderMainComponent(page)}
        </section>
      </div>
    </section>
  `;
}

function renderPageHeading(page) {
  const breadcrumb = `<div class="breadcrumb">${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}</div>`;
  if (isVisualSimulationPage(page)) {
    return `<div>${breadcrumb}</div>`;
  }
  return `
    <div>
      ${breadcrumb}
      <h2>${htmlEscape(page.tertiary)}</h2>
      <p>${htmlEscape(page.summary)}</p>
    </div>
  `;
}

function renderFourthLevelTabs(page, siblingPages) {
  if (!shouldShowFourthTabs(page, siblingPages)) return "";
  return `
    <div class="compact-fourth-tabs" aria-label="四级功能">
      ${siblingPages.map((item) => `
        <button class="${item.id === page.id ? "active" : ""}" type="button" data-feature-id="${item.id}">
          ${item.name}
        </button>
      `).join("")}
    </div>
  `;
}

function shouldShowFourthTabs(page, siblingPages) {
  return siblingPages.length > 1 && ["仿真建模", "仿真实验"].includes(page.secondary) && !isVisualSimulationPage(page);
}

function isVisualSimulationPage(page) {
  return page.component === "visual-simulation";
}

function renderMainComponent(page) {
  if (page.component === "visual-simulation") return renderVisualSimulation(page);
  if (page.component === "reliability-block-diagram") return renderReliabilityBlockDiagram();
  if (page.component === "activity-gantt") return renderSupportActivityWorkbench(page);
  if (page.component === "resource-table") return renderSupportOrganizationWorkbench(page);
  if (page.component === "equipment-table") return renderEquipmentTable(page);
  if (page.component === "experiment-plan-list") return renderExperimentPlanList(page);
  if (page.component === "experiment-plan-editor") return renderExperimentPlanEditor(page);
  if (page.component === "experiment-form") return renderExperimentPlanEditor(page);
  if (page.component === "monte-carlo-config") return renderMonteCarloConfig();
  if (page.component === "monte-carlo-results") return renderMonteCarloResults();
  if (page.component === "analysis") return renderAnalysis(page);
  if (page.component === "import-table") return renderImportTable();
  if (page.component === "scenario-switch") return renderScenarioSwitch();
  return renderTaskModel(page);
}

function renderOntologySvg(ontology, focusSet) {
  const positions = buildOntologyPositions(ontology.nodes);
  const bands = ontologyBands();
  const clusters = buildOntologyClusters(ontology.nodes);
  return `
    <svg class="ontology-svg" viewBox="0 0 1430 1040" role="img" aria-label="项目级 ontology 关系图">
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      ${bands.map((band) => `
        <g class="ontology-band band-${band.group}">
          <rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" rx="8"></rect>
          <text x="${band.x + 16}" y="${band.y + 30}">${band.label}</text>
        </g>
      `).join("")}
      ${clusters.map((cluster) => `
        <g class="ontology-cluster">
          <rect x="${cluster.x}" y="${cluster.y}" width="${cluster.width}" height="${cluster.height}" rx="7"></rect>
          <text x="${cluster.x + 12}" y="${cluster.y + 24}">${cluster.label}</text>
        </g>
      `).join("")}
      <g class="ontology-edges">
        ${ontology.edges.map((edgeItem) => {
          const from = positions[edgeItem.from];
          const to = positions[edgeItem.to];
          const isFocused = focusSet.has(edgeItem.from) || focusSet.has(edgeItem.to);
          const path = edgePath(from, to);
          return `
            <path class="${isFocused ? "focused" : ""}" d="${path}"></path>
            <text class="edge-label ${isFocused ? "focused" : ""}" x="${(from.x + to.x) / 2 + 42}" y="${(from.y + to.y) / 2 - 5}">${edgeItem.label}</text>
          `;
        }).join("")}
      </g>
      <g class="ontology-nodes">
        ${ontology.nodes.map((node) => {
          const position = positions[node.id];
          return `
            <g class="ontology-node ${node.group} ${focusSet.has(node.id) ? "focused" : ""}" transform="translate(${position.x}, ${position.y - 22})">
              <rect width="208" height="44" rx="7"></rect>
              <text x="12" y="27">${node.label}</text>
            </g>
          `;
        }).join("")}
      </g>
    </svg>
  `;
}

function buildOntologyPositions(nodes) {
  const columns = {
    "modeling-object": { x: 70, y: 92, step: 42 },
    "simulation-experiment": { x: 770, y: 160, step: 72 },
    "computation-artifact": { x: 1115, y: 172, step: 72 }
  };
  const counters = {};
  return nodes.reduce((acc, item) => {
    if (item.layout) {
      acc[item.id] = { x: item.layout.x, y: item.layout.y };
      return acc;
    }
    counters[item.group] = counters[item.group] || 0;
    const column = columns[item.group];
    acc[item.id] = {
      x: column.x,
      y: column.y + counters[item.group] * column.step
    };
    counters[item.group] += 1;
    return acc;
  }, {});
}

function ontologyBands() {
  return [
    { group: "modeling-object", label: ONTOLOGY_GROUPS["modeling-object"].label, x: 28, y: 22, width: 650, height: 995 },
    { group: "simulation-experiment", label: ONTOLOGY_GROUPS["simulation-experiment"].label, x: 720, y: 22, width: 300, height: 995 },
    { group: "computation-artifact", label: ONTOLOGY_GROUPS["computation-artifact"].label, x: 1070, y: 22, width: 330, height: 995 }
  ];
}

function buildOntologyClusters(nodes) {
  const grouped = nodes
    .filter((node) => node.group === "modeling-object" && node.layout?.cluster)
    .reduce((acc, node) => {
      acc[node.layout.cluster] ||= [];
      acc[node.layout.cluster].push(node.layout);
      return acc;
    }, {});
  return Object.entries(grouped).map(([label, layouts]) => {
    const minX = Math.min(...layouts.map((item) => item.x)) - 18;
    const minY = Math.min(...layouts.map((item) => item.y)) - 50;
    const maxX = Math.max(...layouts.map((item) => item.x)) + 226;
    const maxY = Math.max(...layouts.map((item) => item.y)) + 34;
    return {
      label,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  });
}

function edgePath(from, to) {
  const startX = from.x + 104;
  const startY = from.y;
  const endX = to.x - 10;
  const endY = to.y;
  const deltaX = Math.abs(endX - startX);
  const controlOffset = Math.max(80, Math.min(190, deltaX * 0.55));
  if (to.x >= from.x) {
    return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
  }
  return `M ${startX} ${startY} C ${startX + 50} ${startY + 26}, ${endX - 50} ${endY - 26}, ${endX} ${endY}`;
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

function renderSupportOrganizationWorkbench(page) {
  const resourceRows = scenario.supportNodes.flatMap((node) => [
    { scope: node.name, type: "保障人员", name: "机务人员", model: "专业/L2", quantity: node.personnelCapacity, aircraft: scenario.equipment.model },
    { scope: node.name, type: "保障设备", name: "检测仪", model: "DT-01", quantity: Math.max(1, node.equipmentCapacity), aircraft: scenario.equipment.model },
    ...Object.entries(node.inventory || {}).map(([spareType, quantity]) => ({
      scope: node.name,
      type: "备件",
      name: spareType,
      model: "LRU",
      quantity,
      aircraft: scenario.equipment.model
    }))
  ]);
  const activeTab = page.name.includes("人员") ? "保障人员建模" : page.name.includes("设备") ? "保障设备建模" : page.name.includes("备件") ? "备件建模" : "保障组织结构建模";
  return `
    <div class="ship-front-workbench">
      <div class="ship-front-tabs">
        ${["保障组织结构建模", "保障资源建模", "保障人员建模", "保障设备建模", "备件建模"].map((tab) => `
          <button type="button" class="${tab === activeTab ? "active" : ""}">${tab}</button>
        `).join("")}
      </div>
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>保障组织结构树</h4>
            <div><button type="button" class="btn-primary">新增节点</button><button type="button">导入</button></div>
          </div>
          ${SUPPORT_ORG_TREE.map((node) => renderOrgTreeNode(node)).join("")}
        </aside>
        <section class="detail-panel">
          <div class="detail-card">
            <div class="section-head">
              <h3>${activeTab === "保障组织结构建模" ? "组织详情" : "保障资源建模"}</h3>
              <span>对齐 ship_front 树 + 表格编辑结构</span>
            </div>
            ${activeTab === "保障组织结构建模" ? `
              <div class="form-table-grid">
                <label>组织名称<input value="舰载机保障大队"></label>
                <label>上级组织<input value="当前项目"></label>
                <label>组织描述<input value="承担机务、维修、备件和设备保障资源调配"></label>
                <label>适用机型<input value="${scenario.equipment.model}"></label>
              </div>
            ` : `
              <div class="toolbar-row">
                <button type="button" class="btn-primary">新增</button>
                <button type="button">批量删除</button>
                <input value="" placeholder="请输入关键词进行搜索">
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>序号</th><th>组织节点</th><th>资源类型</th><th>名称</th><th>型号/专业</th><th>数量</th><th>适用机型</th><th>操作</th></tr></thead>
                  <tbody>${resourceRows.map((row, index) => `
                    <tr><td>${index + 1}</td><td>${row.scope}</td><td>${row.type}</td><td>${row.name}</td><td>${row.model}</td><td>${row.quantity}</td><td>${row.aircraft}</td><td><button type="button" class="inline-action">编辑</button></td></tr>
                  `).join("")}</tbody>
                </table>
              </div>
            `}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderOrgTreeNode(node) {
  return `
    <div class="tree-node-item">
      <div class="tree-node-label"><span class="tree-node-toggle">${node.children?.length ? "▼" : "•"}</span><span class="tree-node-text">${node.name}</span></div>
      ${node.children?.length ? `<div class="tree-node-children">${node.children.map((child) => renderOrgTreeNode(child)).join("")}</div>` : ""}
    </div>
  `;
}

function renderSupportActivityWorkbench(page) {
  const activePlan = page.name.includes("预防") ? SUPPORT_ACTIVITY_PLANS[1] : page.name.includes("修复") ? SUPPORT_ACTIVITY_PLANS[2] : SUPPORT_ACTIVITY_PLANS[0];
  const activityTabs = SUPPORT_ACTIVITY_PLANS.map((plan) => plan.type);
  return `
    <div class="ship-front-workbench">
      <div class="ship-front-tabs">
        ${activityTabs.concat(["基本保障活动列表库"]).map((tab) => `
          <button type="button" class="${tab === activePlan.type ? "active" : ""}">${tab}</button>
        `).join("")}
      </div>
      <div class="comprehensive-layout">
        <aside class="card plan-tree-card">
          <h3>${activePlan.type.replace("建模", "列表")}</h3>
          <div class="toolbar-row"><button type="button" class="btn-primary">新增方案</button><button type="button">删除方案</button></div>
          ${SUPPORT_ACTIVITY_PLANS.map((plan) => `
            <button type="button" class="plan-list-item ${plan.type === activePlan.type ? "active" : ""}">
              <strong>${htmlEscape(plan.name)}</strong>
              <span>${htmlEscape(plan.type)}</span>
            </button>
          `).join("")}
        </aside>
        <section class="detail-panel">
          <div class="card activity-editor-card">
            <div class="section-head">
              <h3>${activePlan.type.replace("建模", "编辑")}</h3>
              <span>${htmlEscape(activePlan.name)}</span>
            </div>
            <div class="form-table-grid">
              <label>活动名称<input value="${htmlEscape(activePlan.name)}"></label>
              <label>仿真运行规则<input value="按流道组并行排队"></label>
              <label>最大工作时间参考(min)<input type="number" value="${Math.max(...scenario.supportActivities.map((activity) => activity.durationHours * 60))}"></label>
              <label>适用对象<input value="${htmlEscape(scenario.equipment.model)} / ${htmlEscape(currentProject.name)}"></label>
            </div>
            <h4>工作项目清单</h4>
            <div class="toolbar-row"><button type="button" class="btn-primary">新增基本保障活动</button><button type="button">批量删除</button></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>序号</th><th>基本保障活动编号</th><th>作业项</th><th>紧前作业</th><th>工期(min)</th><th>操作</th></tr></thead>
                <tbody>${activePlan.jobs.map((job, index) => `
                  <tr><td>${index + 1}</td><td>BA-${String(index + 1).padStart(3, "0")}</td><td>${job}</td><td>${index === 0 ? "-" : activePlan.jobs[index - 1]}</td><td>${(scenario.supportActivities[index % scenario.supportActivities.length]?.durationHours || 1) * 60}</td><td><button type="button" class="inline-action">编辑</button></td></tr>
                `).join("")}</tbody>
              </table>
            </div>
            <div class="network-card">
              <div class="section-head"><h4>保障活动节点网络图</h4><button type="button" class="btn-primary">生成</button></div>
              <div class="activity-network">
                ${activePlan.jobs.map((job, index) => `<span>${String.fromCharCode(65 + index)} ${job}</span>${index < activePlan.jobs.length - 1 ? "<i></i>" : ""}`).join("")}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderExperimentPlanList(page) {
  const editFeatureId = page.module === "任务可靠度评估模块"
    ? "mission-reliability-experiment-plan-edit"
    : "spare-planning-experiment-plan-edit";
  const plans = [
    {
      name: scenario.experiment.name,
      module: page.module,
      scenarioId: scenario.scenarioId,
      steps: scenario.experiment.steps,
      samples: scenario.experiment.samples,
      status: experimentRunStatus
    },
    {
      name: "高强度出动保障验证",
      module: page.module,
      scenarioId: "high-tempo-support",
      steps: 96,
      samples: 64,
      status: "草稿"
    },
    {
      name: "低库存敏感性实验",
      module: page.module,
      scenarioId: "low-stock-sensitivity",
      steps: 72,
      samples: 48,
      status: "待校验"
    }
  ];
  return `
    <div class="section-head">
      <h3>方案列表</h3>
      <span>仿真实验方案管理</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>方案名称</th><th>所属模块</th><th>场景</th><th>步数</th><th>样本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${plans.map((plan) => `
            <tr>
              <td>${htmlEscape(plan.name)}</td>
              <td>${htmlEscape(plan.module)}</td>
              <td>${htmlEscape(plan.scenarioId)}</td>
              <td>${plan.steps}</td>
              <td>${plan.samples}</td>
              <td><span class="badge">${htmlEscape(plan.status)}</span></td>
              <td><button type="button" class="inline-action" data-feature-id="${editFeatureId}">编辑</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderExperimentPlanEditor(page) {
  return `
    <div class="section-head">
      <h3>方案编辑</h3>
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
    <div class="plan-editor-actions">
      <button type="button" data-plan-list-link>返回方案列表</button>
      <button type="button" class="btn-primary" data-feature-id="${page.id}">保存方案</button>
    </div>
  `;
}

function renderVisualSimulation(page) {
  const state = normalizeAviationSupportState(AVIATION_SUPPORT_DEMO_STATE);
  const activeView = ["aircraft", "mission", "support", "ontology"].includes(selectedMesaView) ? selectedMesaView : "aircraft";
  return `
    <div class="mesa-visual-shell">
      <div class="mesa-visual-header">
        <div>
          <div class="breadcrumb">Mesa ABM / aviation_support</div>
          <h3>航空保障 Mesa ABM</h3>
          <p>从 mesa-abm-skill 的可视化仿真迁移而来，基于本地状态帧展示飞机、任务、保障资源和 ontology 结构。</p>
        </div>
        <div class="mesa-clock">T+${Number(AVIATION_SUPPORT_DEMO_STATE.snapshot.elapsed_hours || 0).toFixed(1)}h</div>
      </div>
      <div class="mesa-toolbar">
        <div class="mesa-tabs" role="tablist" aria-label="Mesa 可视化视图">
          ${mesaTab("aircraft", "飞机视图", activeView)}
          ${mesaTab("mission", "任务视图", activeView)}
          ${mesaTab("support", "保障视图", activeView)}
          ${mesaTab("ontology", "Ontology视图", activeView)}
        </div>
        <div class="mesa-actions" aria-label="运行控制">
          <button type="button" class="btn-primary" data-mesa-control="play">运行</button>
          <button type="button" data-mesa-control="step">单步</button>
          <button type="button" data-mesa-control="reset">重置</button>
        </div>
      </div>
      <div class="kpi-strip">
        ${state.kpis.map((item) => `<div class="kpi-card"><span>${item.label}</span><strong>${item.value}</strong></div>`).join("")}
      </div>
      <div class="mesa-visual-grid">
        <section class="mesa-stage-panel">
          ${activeView === "ontology" ? renderMesaOntologyPanel() : renderMesaStage(state)}
        </section>
        <aside class="mesa-side-panel">
          ${renderMesaSidePanel(activeView, state)}
        </aside>
      </div>
    </div>
  `;
}

function mesaTab(id, label, activeView) {
  return `<button type="button" class="mesa-tab ${activeView === id ? "active" : ""}" data-mesa-view="${id}">${label}</button>`;
}

function renderMesaStage(state) {
  return `
    <div class="mesa-stage">
      <div class="mesa-flight-deck">
        ${state.aircraft.map((aircraft) => {
          const [x, y] = aircraft.position;
          return `<div class="mesa-aircraft-node ${aircraft.state}" style="left:${12 + x * 21}%;top:${16 + y * 34}%">
            <strong>${aircraft.label}</strong>
            <span>${aircraft.type}</span>
            <em>${stateLabel(aircraft.state)}</em>
          </div>`;
        }).join("")}
      </div>
      <div class="legend">
        <span class="legend-item"><i class="dot available"></i>可用</span>
        <span class="legend-item"><i class="dot support"></i>保障</span>
        <span class="legend-item"><i class="dot ready"></i>待出动</span>
        <span class="legend-item"><i class="dot flying"></i>任务中</span>
        <span class="legend-item"><i class="dot maintenance"></i>维修</span>
      </div>
      <div class="mesa-mission-strip">
        ${state.missions.map((mission) => `<div class="mission"><span>任务 ${mission.id} / 需求 ${mission.requiredAircraft} 架</span><strong>${mission.status}</strong><div class="bar"><i style="width:${missionProgressWidth(mission)}%"></i></div></div>`).join("")}
      </div>
    </div>
  `;
}

function renderMesaSidePanel(activeView, state) {
  if (activeView === "mission") return renderMesaMissionPanel(state);
  if (activeView === "support") return renderMesaSupportPanel(state);
  if (activeView === "ontology") return renderMesaOntologySidePanel();
  return renderMesaAircraftPanel(state);
}

function renderMesaAircraftPanel(state) {
  const selectedAircraft = state.aircraft[0];
  return `
    <div class="section-head">
      <h3>单机状态</h3>
      <span>${state.aircraft.length} 架</span>
    </div>
    <div class="mesa-aircraft-list">
      ${state.aircraft.map((aircraft) => `<div class="list-row"><strong>${aircraft.label}</strong><span>${aircraft.type}</span><span>${stateLabel(aircraft.state)}</span></div>`).join("")}
    </div>
    <h4>飞机内部装备</h4>
    <div class="event info"><strong>${selectedAircraft.label}</strong> 系统数量 ${selectedAircraft.systemCount} / 失效 LRU ${selectedAircraft.failedLru || "-"}</div>
  `;
}

function renderMesaMissionPanel(state) {
  return `
    <div class="section-head">
      <h3>任务计划表</h3>
      <span>${state.missions.length} 个任务</span>
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>任务</th><th>计划</th><th>实际</th><th>状态</th><th>编组</th></tr></thead>
        <tbody>${state.missions.map((mission) => `<tr><td>M-${mission.id}</td><td>T+${mission.plannedStart}</td><td>${mission.actualStart ? `T+${mission.actualStart}` : "-"}</td><td>${mission.status}</td><td>${mission.assignedCount}/${mission.requiredAircraft}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <h4>执飞飞机编组</h4>
    <div class="stack-list">
      ${state.missions.map((mission) => `<div class="job"><span>任务 ${mission.id}</span><strong>${mission.assignedTailNumbers.length ? mission.assignedTailNumbers.join(" / ") : "未编组"}</strong></div>`).join("")}
    </div>
  `;
}

function renderMesaSupportPanel(state) {
  return `
    <div class="section-head">
      <h3>保障资源</h3>
      <span>资源 / 备件 / 作业</span>
    </div>
    <div class="stack-list">
      ${state.resources.map((resource) => `<div class="metric-line"><strong>${resource.label}</strong><div class="bar"><span style="width:${Math.round(resource.utilization * 100)}%"></span></div><span>${resource.inUse}/${resource.capacity}</span></div>`).join("")}
    </div>
    <h4>备件库存量 / 已消耗 / 在途</h4>
    <div class="stack-list">
      ${state.spares.map((spare) => `<div class="list-row"><strong>${spare.label}</strong><span>库存 ${spare.quantity}</span><span>消耗 ${spare.consumed} / 在途 ${spare.pending}</span></div>`).join("")}
    </div>
    <h4>保障作业与事件</h4>
    ${state.jobs.map((job) => `<div class="event info"><strong>${job.tailNumber}</strong> ${job.task} / ${job.state} / ${job.remaining}min</div>`).join("")}
    ${state.events.map((event) => `<div class="event success"><strong>T+${event.time}</strong> ${event.message}</div>`).join("")}
  `;
}

function renderMesaOntologyPanel() {
  return `
    <div class="mesa-ontology-stage">
      ${renderOntologySvg(PROJECT_ONTOLOGY, new Set(["task", "equipment", "support-activity", "experiment-plan", "simulation-run", "metric-time-series"]))}
    </div>
  `;
}

function renderMesaOntologySidePanel() {
  const groups = Object.entries(ONTOLOGY_GROUPS);
  return `
    <div class="section-head">
      <h3>Ontology关系图</h3>
      <span>${PROJECT_ONTOLOGY.nodes.length} 节点 / ${PROJECT_ONTOLOGY.edges.length} 关系</span>
    </div>
    <div class="event info"><strong>Mesa ABM 映射</strong>该视图展示结构依赖，不代表 OWL 推理结果。</div>
    ${groups.map(([groupId, meta]) => {
      const count = PROJECT_ONTOLOGY.nodes.filter((node) => node.group === groupId).length;
      return `<details class="ontology-group" ${groupId === "modeling-object" ? "open" : ""}><summary class="ontology-group-head"><strong>${meta.label}</strong><span>${count}</span></summary><p>${meta.summary}</p></details>`;
    }).join("")}
  `;
}

function missionProgressWidth(mission) {
  if (mission.status === "completed") return 100;
  if (mission.status === "launched" || mission.status === "flying") return 72;
  if (mission.status === "delayed") return 36;
  return 18;
}

function renderMonteCarloConfig() {
  return `
    <div class="mc-workbench">
      <section class="mc-config-panel mc-config-panel-single">
        <div class="section-head">
          <h3>蒙特卡洛实验参数配置</h3>
          <span>样本 / seed / 扫参</span>
        </div>
        <div class="mc-form">
          <label>选择仿真实验
            <select>
              <option selected>${htmlEscape(scenario.experiment.name)}</option>
              <option>高强度出动保障验证</option>
              <option>低库存敏感性实验</option>
            </select>
          </label>
          <div class="mc-inline-fields">
            <label>仿真次数<input id="mc-samples" data-path="experiment.samples" type="number" min="1" value="${scenario.experiment.samples}"></label>
            <label>随机种子<input data-path="experiment.seed" type="number" value="${scenario.experiment.seed}"></label>
          </div>
          <label>故障率扫描<input data-mc-array-path="monteCarlo.failureRates" value="${scenario.monteCarlo.failureRates.join(",")}"></label>
          <label>备件倍数<input data-mc-array-path="monteCarlo.spareMultipliers" value="${scenario.monteCarlo.spareMultipliers.join(",")}"></label>
          <label>保障容量<input data-mc-array-path="monteCarlo.supportCapacities" value="${scenario.monteCarlo.supportCapacities.join(",")}"></label>
          <div class="mc-action-row">
            <button type="button" class="btn-primary" data-mc-action="start">启动</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function buildMonteCarloEvaluationRows() {
  const missionMean = averageGroupMetric("mission_success_rate");
  const readyMean = averageGroupMetric("ready_rate");
  const shortageMean = averageGroupMetric("shortage_events");
  return [
    { name: "任务可靠度", value: pct(missionMean), target: "90%" },
    { name: "战备完好率", value: pct(readyMean), target: "85%" },
    { name: "短缺事件", value: fixed(shortageMean, 1), target: "≤ 1.0" }
  ];
}

function averageGroupMetric(metric) {
  const values = (monteCarloResult.groups || [])
    .map((group) => Number(group[metric]?.mean))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function renderMonteCarloResults() {
  const groups = monteCarloResult.groups || [];
  const resultRows = buildMonteCarloEvaluationRows();
  return `
    <div class="mc-result-panel">
      <div class="section-head">
        <h3>蒙特卡洛评估结果</h3>
        <span>${monteCarloResult.runs.length} 个样本</span>
      </div>
      <div class="mc-result-cards">
        ${resultRows.map((row) => `
          <div class="metric-card">
            <span>${row.name}</span>
            <strong>${row.value}</strong>
            <em>目标值 ${row.target}</em>
          </div>
        `).join("")}
      </div>
      <div class="table-wrap mc-evaluation-table">
        <table>
          <thead><tr><th>序号</th><th>指标名称</th><th>蒙特卡洛评估值</th><th>目标值</th></tr></thead>
          <tbody>${resultRows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.name}</td><td>${row.value}</td><td>${row.target}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="table-wrap mc-group-table">
        <table>
          <thead><tr><th>参数组</th><th>样本数</th><th>任务可靠度</th><th>战备完好率</th><th>短缺事件</th></tr></thead>
          <tbody>${groups.map((group) => `<tr><td>${group.group}</td><td>${group.count}</td><td>${pct(group.mission_success_rate.mean)}</td><td>${pct(group.ready_rate.mean)}</td><td>${fixed(group.shortage_events.mean, 1)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAnalysis(page) {
  if (page.name.includes("备件短板")) return renderSpareShortfallAnalysis();
  if (page.name.includes("携行")) return renderCarryListAnalysis();
  if (page.name.includes("停机")) return renderDowntimeFactorAnalysis();
  if (page.name.includes("任务可靠度") || page.name.includes("飞机任务可靠性")) return renderTaskReliabilityAnalysis();
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

function renderSpareShortfallAnalysis() {
  const rows = singleResult.spareShortfalls.map((row) => ({
    name: row.spareType,
    satisfy: row.fillRate,
    delay: row.shortage * 24,
    baseCount: Math.max(0, row.demand - row.shortage),
    stock: row.demand,
    shortage: row.shortage,
    level: row.shortage >= 2 ? "严重" : row.shortage === 1 ? "短缺" : "关注"
  }));
  return renderAnalysisDashboard({
    title: "备件短板分析",
    mode: "启动分析",
    subtitle: "备件需求量降序",
    metrics: [
      ["短板备件", `${rows.filter((row) => row.shortage > 0).length} 项`],
      ["最低备件满足率", fixed(Math.min(...rows.map((row) => row.satisfy)), 2)],
      ["最大平均延误", `${Math.max(...rows.map((row) => row.delay))} h`],
      ["建议优先补充", rows.filter((row) => row.shortage > 0).map((row) => row.name).slice(0, 2).join(" / ") || "-"]
    ],
    body: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>备件</th><th>备件满足率</th><th>平均延误时间(h)</th><th>基层级数量</th><th>初始基层级库存</th><th>不满足次数</th><th>短板等级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${row.name}</td><td>${fixed(row.satisfy, 2)}</td><td>${row.delay}</td><td>${row.baseCount}</td><td>${row.stock}</td><td>${row.shortage}</td>
              <td><span class="status-badge ${row.level === "严重" ? "danger" : row.level === "短缺" ? "warn" : ""}">${row.level}</span></td>
              <td class="bar-cell">${renderBar(row.shortage, Math.max(...rows.map((item) => item.shortage), 1), "red")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
      <div class="decision-support-card"><strong>短板分析结论</strong><span>P2/P3 类备件的满足率与延误指标最敏感，建议优先补齐基层库存并复核补给提前量。</span></div>
    `
  });
}

function renderCarryListAnalysis() {
  const objective = CARRY_OBJECTIVES.find((item) => item.id === carryObjective) || CARRY_OBJECTIVES[0];
  const rows = singleResult.carryList.map((row, index) => ({
    name: row.spareType,
    satisfy: Math.max(0, 1 - row.shortage / Math.max(row.recommended, 1)),
    delay: row.shortage * 18 + index * 2,
    qty: row.recommended,
    priority: row.riskLevel === "high" ? "高" : row.riskLevel === "medium" ? "中" : "低"
  }));
  return renderAnalysisDashboard({
    title: "飞机转场携行清单分析",
    mode: "参数配置",
    subtitle: "携行清单迭代建议",
    config: `
      <label>优化条件<select><option>${objective.label}</option><option>出动架次率</option><option>再次出动准备时间</option></select></label>
      <label>备件满足率不低于<input value="0.90"></label>
      <label>备件利用率不低于<input value="0.70"></label>
    `,
    metrics: [
      ["优化条件", objective.label],
      ["携行备件数量", `${rows.reduce((sum, row) => sum + row.qty, 0)} 件`],
      ["备件满足率不低于", "0.90"],
      [objective.metricLabel, objective.metricValue]
    ],
    body: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>备件</th><th>备件满足率</th><th>平均延误时间(h)</th><th>数量</th><th>携行优先级</th><th>图示</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td>${row.name}</td><td>${fixed(row.satisfy, 2)}</td><td>${row.delay}</td><td>${row.qty}</td>
              <td><span class="status-badge ${row.priority === "高" ? "danger" : row.priority === "中" ? "warn" : "success"}">${row.priority}</span></td>
              <td class="bar-cell">${renderBar(row.qty, Math.max(...rows.map((item) => item.qty), 1), "blue")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
      <div class="decision-support-card"><strong>携行清单说明</strong><span>以${objective.label}为优化目标，优先补足低满足率且短缺次数高的备件，形成转场前装箱评审清单。</span></div>
    `
  });
}

function renderTaskReliabilityAnalysis() {
  const waves = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((wave, index) => ({
    wave,
    probability: Math.max(0.86, singleResult.final.mission_success_rate - index * 0.015),
    sorties: wave * 12,
    available: Math.max(6, scenario.equipment.quantity - Math.floor(index / 2)),
    state: index >= 6 ? "风险" : index >= 3 ? "关注" : "满足"
  }));
  return renderAnalysisDashboard({
    title: "任务可靠度评估",
    mode: "启动分析",
    subtitle: "任务可靠度指标分解",
    metrics: [
      ["首波任务成功概率", fixed(waves[0].probability, 2)],
      ["末波任务成功概率", fixed(waves.at(-1).probability, 2)],
      ["风险拐点", "第 7 波"],
      ["累计出动架次", `${waves.at(-1).sorties}`]
    ],
    body: `
      <div class="analysis-chart-panel"><div class="chart-title">波次任务成功概率趋势</div>${renderLineChart(waves.map((row) => ({ x: row.wave, y: row.probability })))}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>波次任务</th><th>波次任务成功概率</th><th>累计出动架次</th><th>可用飞机数</th><th>状态</th></tr></thead>
          <tbody>${waves.map((row) => `<tr><td>${row.wave}</td><td>${fixed(row.probability, 3)}</td><td>${row.sorties}</td><td>${row.available}</td><td><span class="status-badge ${row.state === "风险" ? "danger" : row.state === "关注" ? "warn" : "success"}">${row.state}</span></td></tr>`).join("")}</tbody>
        </table>
      </div>
    `
  });
}

function renderDowntimeFactorAnalysis() {
  const factors = singleResult.downtimeFactors;
  return renderAnalysisDashboard({
    title: "停机因素分析",
    mode: "启动分析",
    subtitle: "停机贡献因素排序",
    metrics: [
      ["停机因素总次数", `${factors.reduce((sum, row) => sum + row.count, 0)}`],
      ["无可用飞机", "4"],
      ["飞机故障", "5"],
      ["备件满足率", fixed(singleResult.final.spare_fill_rate, 2)]
    ],
    body: `
      <div class="factor-grid">
        <div class="factor-column"><h4>停机因素</h4><div class="factor-list"><div class="factor-item"><span>无可用飞机</span><span>4</span></div><div class="factor-item"><span>飞机故障</span><span>5</span></div></div></div>
        <div class="factor-column"><h4>二级因素</h4><div class="factor-list">${factors.map((row) => `<div class="factor-item"><span>${row.label}</span><span>${row.count}</span></div>`).join("")}</div></div>
        <div class="factor-column"><h4>观察指标</h4><div class="factor-list"><div class="factor-item"><span>保障设备满足率</span><span>0.90</span></div><div class="factor-item"><span>备件满足率</span><span>${fixed(singleResult.final.spare_fill_rate, 2)}</span></div><div class="factor-item"><span>平均故障维修时间</span><span>1.5</span></div></div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>二级因素</th><th>贡献次数</th><th>贡献度</th><th>图示</th></tr></thead>
          <tbody>${factors.map((row) => `<tr><td>${row.label}</td><td>${row.count}</td><td>${pct(row.contribution)}</td><td class="bar-cell">${renderBar(row.count, Math.max(...factors.map((item) => item.count), 1), row.count >= 2 ? "red" : "blue")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `
  });
}

function renderAnalysisDashboard({ title, mode, subtitle, config = "", metrics, body }) {
  return `
    <div class="analysis-dashboard">
      <section class="analysis-filter-bar">
        <div><h3>${title}</h3><span>${subtitle}</span></div>
        <button type="button" class="btn-primary">启动</button>
      </section>
      ${config ? `<section class="analysis-config-grid">${config}</section>` : ""}
      <section class="kpi-strip">${metrics.map(([label, value]) => `<div class="kpi-card"><span>${label}</span><strong>${value}</strong></div>`).join("")}</section>
      <section class="analysis-chart-panel">${body}</section>
      <div class="decision-support-card"><strong>${mode}</strong><span>结果已按 @备件_front 页面结构展示，供当前项目快速评审。</span></div>
    </div>
  `;
}

function renderBar(value, max, color) {
  const width = Math.max(8, Math.round((Number(value) / Math.max(Number(max), 1)) * 100));
  return `<div class="bar-track"><span class="bar-fill ${color}" style="width:${width}%"></span></div>`;
}

function renderLineChart(points) {
  const width = 640;
  const height = 180;
  const minY = 0.84;
  const maxY = 1;
  const xScale = (x) => 36 + ((x - 1) / 8) * 560;
  const yScale = (y) => 18 + (1 - (y - minY) / (maxY - minY)) * 128;
  const line = points.map((point) => `${xScale(point.x).toFixed(1)},${yScale(point.y).toFixed(1)}`).join(" ");
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="任务可靠度趋势">
      <polyline points="${line}"></polyline>
      ${points.map((point) => `<circle cx="${xScale(point.x).toFixed(1)}" cy="${yScale(point.y).toFixed(1)}" r="4"></circle><text x="${xScale(point.x).toFixed(1)}" y="168">${point.x}</text>`).join("")}
    </svg>
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

function field(label, path, type = "text") {
  return `<label>${label}<input data-path="${path}" type="${type}" value="${htmlEscape(getPath(scenario, path))}"></label>`;
}

function isActiveTertiary(activePage, pages) {
  return pages.some((page) => page.id === activePage.id);
}

function readFeatureIdFromHash() {
  const match = location.hash.match(/feature=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function readRouteFromHash() {
  const match = location.hash.match(/route=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (location.hash.includes("feature=")) return "workbench";
  return "";
}

function getPlanListFeatureId(moduleName) {
  return moduleName === "任务可靠度评估模块"
    ? "mission-reliability-experiment-plan-list"
    : DEFAULT_FEATURE_ID;
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

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
}

function updateMonteCarloArrayInput(mcArrayInput) {
  setPath(scenario, mcArrayInput.dataset.mcArrayPath, parseNumberList(mcArrayInput.value));
  singleResult = runSimulation(scenario);
  monteCarloResult = runMonteCarlo(scenario);
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

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function fixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
