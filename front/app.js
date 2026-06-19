import { FEATURE_PAGES, getFeaturePageById, groupFeaturePages } from "./feature-catalog.mjs";
import { AVIATION_SUPPORT_DEMO_STATE, normalizeAviationSupportState } from "./aviation-support-state.mjs";
import { buildProjectOntology, ONTOLOGY_GROUPS } from "./ontology-context.mjs?v=20260618-no-feature-nodes";
import {
  buildBackendProjectJson,
  buildDemoResultState,
  buildExperimentPlanConfig,
  buildFrontendResultState,
  createBackendApiClient
} from "./api-client.mjs";
import {
  cloneScenario,
  defaultScenario
} from "./sim-engine.mjs";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createDemoRmsAllocationProject,
  publishRmsAllocation
} from "./rms-allocation-engine.mjs";
import { renderRmsAllocationWorkbench } from "./rms-allocation-workbench.mjs";

const app = document.querySelector("#app");
const groups = groupFeaturePages(FEATURE_PAGES);
const CONTRACT_BASE = "http://127.0.0.1:8521"; // Mesa 契约服务（见 agent.md「Mesa 后台契约服务」）
const backendApi = createBackendApiClient({ baseUrl: "/api" });
const LAST_BACKEND_RUN_STORAGE_KEY = "spare-mvp:lastBackendRun";
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
const DEFAULT_ONTOLOGY_BANDS = [
  { group: "modeling-object", label: ONTOLOGY_GROUPS["modeling-object"].label, x: 28, width: 1372, height: 390 },
  { group: "simulation-experiment", label: ONTOLOGY_GROUPS["simulation-experiment"].label, x: 28, width: 1372, height: 145 },
  { group: "model-instance", label: ONTOLOGY_GROUPS["model-instance"].label, x: 28, width: 1372, height: 235 },
  { group: "computation-artifact", label: ONTOLOGY_GROUPS["computation-artifact"].label, x: 28, width: 1372, height: 145 }
];
const ONTOLOGY_NODE_RADIUS = 30;
const SUPPORT_ORG_TREE = [
  { id: "wing", name: "舰载机保障大队", children: [
    { id: "service", name: "机务保障中队", children: [{ id: "fuel", name: "油料组" }, { id: "avionics", name: "航电组" }, { id: "ordnance", name: "军械组" }] },
    { id: "repair", name: "维修保障中队", children: [{ id: "line", name: "外场维修组" }, { id: "spare", name: "备件保障组" }] }
  ] }
];
const SUPPORT_ACTIVITY_PLANS = [
  {
    type: "基本保障活动建模",
    name: "基本保障活动分类",
    treeTitle: "基本保障活动分类树",
    path: ["保障活动", "基本保障活动", "机务保障"],
    jobs: ["机务检查", "燃油加注", "挂弹作业", "通电检查"],
    tree: {
      id: "basic-root",
      name: "基本保障活动",
      children: [
        { id: "basic-flightline", name: "飞行线保障", children: [{ id: "basic-inspection", name: "机务检查" }, { id: "basic-fuel", name: "燃油加注" }, { id: "basic-power", name: "通电检查" }] },
        { id: "basic-ordnance", name: "军械保障", children: [{ id: "basic-load", name: "挂弹作业" }, { id: "basic-safety", name: "安全检查" }] },
        { id: "basic-repair", name: "维修保障", children: [{ id: "basic-fault", name: "故障定位" }, { id: "basic-replace", name: "换件维修" }, { id: "basic-test", name: "功能复测" }] }
      ]
    }
  },
  {
    type: "使用保障活动建模",
    name: "歼-35近海巡逻飞行前准备方案",
    treeTitle: "使用保障活动树",
    path: ["J-35", "近海巡逻任务", "飞行前准备"],
    jobs: ["机务检查", "燃油加注", "挂弹作业", "通电检查"],
    tree: {
      id: "ops-root",
      name: "使用保障活动",
      children: [
        { id: "ops-j35", name: "J-35", children: [
          { id: "ops-j35-patrol", name: "近海巡逻任务", children: [{ id: "ops-j35-patrol-pre", name: "飞行前准备" }, { id: "ops-j35-patrol-turn", name: "再次出动准备" }, { id: "ops-j35-patrol-post", name: "飞行后检查" }] },
          { id: "ops-j35-alert", name: "远海警戒任务", children: [{ id: "ops-j35-alert-pre", name: "飞行前准备" }, { id: "ops-j35-alert-turn", name: "再次出动准备" }, { id: "ops-j35-alert-post", name: "飞行后检查" }] }
        ] },
        { id: "ops-j15", name: "J-15", children: [
          { id: "ops-j15-strike", name: "对海突击任务", children: [{ id: "ops-j15-strike-pre", name: "飞行前准备" }, { id: "ops-j15-strike-turn", name: "再次出动准备" }, { id: "ops-j15-strike-post", name: "飞行后检查" }] }
        ] }
      ]
    }
  },
  {
    type: "预防性维修活动建模",
    name: "J-35日检预防性维修方案",
    treeTitle: "预防性维修活动树",
    path: ["J-35", "日检"],
    jobs: ["定检准备", "航电检查", "液压系统检查", "记录归档"],
    tree: {
      id: "preventive-root",
      name: "预防性维修活动",
      children: [
        { id: "preventive-j35", name: "J-35", children: [{ id: "preventive-j35-daily", name: "日检" }, { id: "preventive-j35-weekly", name: "周检" }, { id: "preventive-j35-phase", name: "阶段检" }] },
        { id: "preventive-j15", name: "J-15", children: [{ id: "preventive-j15-daily", name: "日检" }, { id: "preventive-j15-weekly", name: "周检" }] }
      ]
    }
  },
  {
    type: "修复性维修活动建模",
    name: "J-35航电模块故障修复方案",
    treeTitle: "修复性维修活动树",
    path: ["J-35", "航电模块故障"],
    jobs: ["故障定位", "备件领用", "换件维修", "功能复测"],
    tree: {
      id: "corrective-root",
      name: "修复性维修活动",
      children: [
        { id: "corrective-j35", name: "J-35", children: [{ id: "corrective-j35-engine", name: "发动机备件故障" }, { id: "corrective-j35-avionics", name: "航电模块故障" }, { id: "corrective-j35-hydraulic", name: "液压备件故障" }] },
        { id: "corrective-j15", name: "J-15", children: [{ id: "corrective-j15-engine", name: "发动机备件故障" }, { id: "corrective-j15-parachute", name: "制动伞检查" }] }
      ]
    }
  }
];

let scenario = cloneScenario(defaultScenario);
let { singleResult, monteCarloResult } = buildDemoResultState(scenario);
let rmsAllocationProject = createDemoRmsAllocationProject();
let rmsAllocationPlan = createDefaultRmsAllocationPlan(rmsAllocationProject);
let rmsAllocationResult = calculateRmsAllocation(rmsAllocationPlan, rmsAllocationProject);
let rmsPublishedProject = null;
let savedProject = null;
let modelingSnapshot = null;
let experimentPlan = null;
let backendRun = null;
let backendRunResult = null;
let backendArtifactManifest = null;
let backendRunChain = null;
let backendApiStatus = "离线演示";
let isLoggedIn = false;
let currentUser = DEMO_USERS[2];
let currentProject = DEMO_PROJECTS[0];
let selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
let selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
let selectedMesaView = "aircraft";
let liveAviationState = null; // 来自契约服务的活仿真状态；为 null 时回退演示快照
let aviationSource = "demo"; // "live"（契约服务）或 "demo"（静态快照）
let aviationSteps = 12; // 向契约服务请求的仿真步数
let aviationLoadInFlight = false; // 防止重复并发拉取
let isOntologyFullscreen = false;
let selectedOntologyItem = null;
let isOntologyDetailCollapsed = true;
let ontologyBandLayout = {};
let ontologyNodePositionOverrides = {};
let collapsedOntologyGroups = new Set();
let activeOntologyDrag = null;
let suppressOntologyClick = false;
let carryObjective = CARRY_OBJECTIVES[0].id;
let experimentRunStatus = "当前";
let isProjectMenuOpen = false;
let selectedBuiltInScenarioItem = { type: "missionArea", index: 0 };
let selectedCombatUnitSection = "group";
let selectedEquipmentComponentIndex = 0;

render();
bindEvents();
hydrateLastBackendRunFromApi();

function bindEvents() {
  window.addEventListener("hashchange", () => {
    selectedRoute = readRouteFromHash() || DEFAULT_ROUTE;
    selectedFeatureId = readFeatureIdFromHash() || DEFAULT_FEATURE_ID;
    render();
  });

  app.addEventListener("click", (event) => {
    if (suppressOntologyClick) {
      suppressOntologyClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

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

    const mesaControlButton = event.target.closest("[data-mesa-control]");
    if (mesaControlButton) {
      const action = mesaControlButton.dataset.mesaControl;
      if (action === "step") aviationSteps += 1;
      else if (action === "play") aviationSteps += 12;
      else if (action === "reset") aviationSteps = 0;
      loadAviationSupportState();
      return;
    }

    const ontologyFullscreenButton = event.target.closest("[data-ontology-fullscreen]");
    if (ontologyFullscreenButton) {
      isOntologyFullscreen = !isOntologyFullscreen;
      isOntologyDetailCollapsed = isOntologyFullscreen;
      selectedMesaView = "ontology";
      render();
      return;
    }

    const ontologyDetailToggle = event.target.closest("[data-ontology-detail-toggle]");
    if (ontologyDetailToggle) {
      isOntologyDetailCollapsed = !isOntologyDetailCollapsed;
      selectedMesaView = "ontology";
      render();
      return;
    }

    const ontologyBandToggle = event.target.closest("[data-ontology-band-toggle]");
    if (ontologyBandToggle) {
      const group = ontologyBandToggle.dataset.ontologyBandToggle;
      collapsedOntologyGroups = toggleSetValue(collapsedOntologyGroups, group);
      selectedMesaView = "ontology";
      render();
      return;
    }

    const ontologyNode = event.target.closest("[data-ontology-node-id]");
    if (ontologyNode) {
      selectedOntologyItem = { type: "node", id: ontologyNode.dataset.ontologyNodeId };
      selectedMesaView = "ontology";
      render();
      return;
    }

    const ontologyEdge = event.target.closest("[data-ontology-edge-id]");
    if (ontologyEdge) {
      selectedOntologyItem = { type: "edge", id: ontologyEdge.dataset.ontologyEdgeId };
      selectedMesaView = "ontology";
      render();
      return;
    }

    const savePlanButton = event.target.closest("[data-save-plan]");
    if (savePlanButton) {
      saveCurrentProjectThroughApi().finally(() => render());
      return;
    }

    const rmsActionButton = event.target.closest("[data-rms-action]");
    if (rmsActionButton) {
      if (rmsActionButton.dataset.rmsAction === "publish") {
        rmsPublishedProject = publishRmsAllocation(rmsAllocationProject, rmsAllocationResult);
      } else {
        recalculateRmsAllocation();
      }
      render();
      return;
    }

    const monteCarloStartButton = event.target.closest("[data-mc-action='start']");
    if (monteCarloStartButton) {
      const page = getFeaturePageById(selectedFeatureId);
      experimentRunStatus = "运行中";
      startExperimentRunThroughApi();
      selectedRoute = "workbench";
      selectedFeatureId = getPlanListFeatureId(page.module);
      location.hash = `feature=${selectedFeatureId}`;
      render();
      return;
    }

    const builtInScenarioNode = event.target.closest("[data-select-built-in-type]");
    if (builtInScenarioNode) {
      selectedBuiltInScenarioItem = { type: builtInScenarioNode.dataset.selectBuiltInType, index: Number(builtInScenarioNode.dataset.selectBuiltInIndex || 0) };
      render();
      return;
    }

    const combatUnitNode = event.target.closest("[data-select-combat-unit]");
    if (combatUnitNode) {
      selectedCombatUnitSection = combatUnitNode.dataset.selectCombatUnit;
      render();
      return;
    }

    const equipmentComponentNode = event.target.closest("[data-select-equipment-component]");
    if (equipmentComponentNode) {
      selectedEquipmentComponentIndex = clampEquipmentComponentIndex(Number(equipmentComponentNode.dataset.selectEquipmentComponent));
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
    const rmsInput = event.target.closest("[data-rms-path]");
    if (rmsInput) {
      setPath(rmsAllocationPlan, rmsInput.dataset.rmsPath, parseInput(rmsInput));
      recalculateRmsAllocation();
      render();
      return;
    }

    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) {
      updateMonteCarloArrayInput(mcArrayInput);
      render();
      return;
    }

    const input = event.target.closest("[data-path]");
    if (!input) return;
    setPath(scenario, input.dataset.path, parseInput(input));
    updateDemoResultsThroughApiClient();
    render();
  });

  app.addEventListener("input", (event) => {
    const mcArrayInput = event.target.closest("[data-mc-array-path]");
    if (mcArrayInput) updateMonteCarloArrayInput(mcArrayInput);
  });

  app.addEventListener("pointerdown", (event) => {
    const resizeHandle = event.target.closest("[data-ontology-band-resize]");
    if (resizeHandle) {
      const point = getOntologySvgPoint(event);
      const band = ontologyBands().find((item) => item.group === resizeHandle.dataset.ontologyBandResize);
      if (!point || !band) return;
      activeOntologyDrag = {
        kind: "band",
        group: band.group,
        startX: point.x,
        startY: point.y,
        originWidth: band.width,
        originHeight: band.height,
        originX: band.x,
        originY: band.y,
        moved: false
      };
      event.preventDefault();
      return;
    }

    const nodeElement = event.target.closest("[data-ontology-node-id]");
    if (nodeElement && event.target.closest(".ontology-svg")) {
      const ontology = currentMesaOntology();
      const nodeItem = ontology.nodes.find((node) => node.id === nodeElement.dataset.ontologyNodeId);
      const point = getOntologySvgPoint(event);
      if (!nodeItem || !point) return;
      const positions = buildOntologyPositions(ontology.nodes, ontology.edges);
      const position = positions[nodeItem.id];
      selectedOntologyItem = { type: "node", id: nodeItem.id };
      selectedMesaView = "ontology";
      activeOntologyDrag = {
        kind: "node",
        id: nodeItem.id,
        startX: point.x,
        startY: point.y,
        originX: position.x,
        originY: position.y,
        moved: false
      };
      event.preventDefault();
    }
  });

  window.addEventListener("pointermove", handleOntologyPointerMove);
  window.addEventListener("pointerup", finishOntologyPointerDrag);
}

function handleOntologyPointerMove(event) {
  if (!activeOntologyDrag) return;
  const point = getOntologySvgPoint(event);
  if (!point) return;
  const dx = point.x - activeOntologyDrag.startX;
  const dy = point.y - activeOntologyDrag.startY;
  activeOntologyDrag.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;

  if (activeOntologyDrag.kind === "band") {
    ontologyBandLayout[activeOntologyDrag.group] = {
      width: clamp(activeOntologyDrag.originWidth + dx, 240, 1430 - activeOntologyDrag.originX - 12),
      height: clamp(activeOntologyDrag.originHeight + dy, 260, 1040 - activeOntologyDrag.originY - 12)
    };
    render();
    return;
  }

  if (activeOntologyDrag.kind === "node") {
    ontologyNodePositionOverrides[activeOntologyDrag.id] = {
      x: clamp(activeOntologyDrag.originX + dx, ONTOLOGY_NODE_RADIUS + 10, 1430 - ONTOLOGY_NODE_RADIUS - 10),
      y: clamp(activeOntologyDrag.originY + dy, ONTOLOGY_NODE_RADIUS + 10, 1040 - ONTOLOGY_NODE_RADIUS - 10)
    };
    render();
  }
}

function finishOntologyPointerDrag() {
  if (!activeOntologyDrag) return;
  suppressOntologyClick = activeOntologyDrag.moved;
  activeOntologyDrag = null;
  render();
}

function getOntologySvgPoint(event) {
  const svg = event.target?.closest?.(".ontology-svg") || document.querySelector(".mesa-ontology-stage .ontology-svg");
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toggleSetValue(sourceSet, value) {
  const next = new Set(sourceSet);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
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
          <p>${htmlEscape(currentProject.name)} / ${renderTopbarContext(page)}</p>
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

function renderTopbarContext(page) {
  if (page.module === "系统管理") return "系统管理 / 装备RMS指标分配";
  return `${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}`;
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
          ${moduleName === "系统管理"
            ? renderSystemManagementNavigation(activePage, secondaryGroups)
            : Object.entries(secondaryGroups).map(([secondaryName, tertiaryGroups]) => `
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

function renderSystemManagementNavigation(activePage, secondaryGroups) {
  return Object.values(secondaryGroups).flatMap((tertiaryGroups) => (
    Object.values(tertiaryGroups).map((pages) => `
      <button type="button" class="nav-tertiary-link ${pages.some((page) => page.id === activePage.id) ? "active" : ""}" data-feature-id="${pages[0].id}">
        ${pages[0].name}
      </button>
    `)
  )).join("");
}

function renderFeaturePage(page) {
  const siblingPages = groups[page.module][page.secondary][page.tertiary];
  return `
    <section class="deck-modeling-content feature-page">
      <div class="page-head">
        ${renderPageHeading(page)}
        ${renderCurrentContext(page)}
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

function renderCurrentContext(page) {
  if (!shouldShowCurrentContext(page)) return "";
  return `
    <button class="page-head-current-context" type="button" data-plan-list-link>
      <span>当前方案</span>
      <strong>${htmlEscape(scenario.experiment.name)}</strong>
    </button>
  `;
}

function shouldShowCurrentContext(page) {
  return page.secondary !== "仿真建模";
}

function renderPageHeading(page) {
  const breadcrumb = page.module === "系统管理"
    ? `<div class="breadcrumb">系统管理 / 装备RMS指标分配</div>`
    : `<div class="breadcrumb">${htmlEscape(page.module)} / ${htmlEscape(page.secondary)} / ${htmlEscape(page.tertiary)}</div>`;
  return `
    <div>
      ${breadcrumb}
      <h2>${htmlEscape(page.tertiary)}</h2>
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
  if (page.component === "equipment-table") return renderEquipmentModeling(page);
  if (page.component === "experiment-plan-list") return renderExperimentPlanList(page);
  if (page.component === "experiment-plan-editor") return renderExperimentPlanEditor(page);
  if (page.component === "experiment-form") return renderExperimentPlanEditor(page);
  if (page.component === "rms-allocation") return renderRmsAllocationWorkbench({
    project: rmsAllocationProject,
    plan: rmsAllocationPlan,
    result: rmsAllocationResult,
    publishedProject: rmsPublishedProject,
    htmlEscape,
    fixed,
    pct
  });
  if (page.component === "monte-carlo-config") return renderMonteCarloConfig();
  if (page.component === "monte-carlo-results") return renderMonteCarloResults();
  if (page.component === "analysis") return renderAnalysis(page);
  if (page.component === "import-table") return renderImportTable();
  if (page.component === "scenario-switch") return renderScenarioSwitch();
  if (page.name === "内置场景") return renderBuiltInScenario(page);
  if (page.name === "基本作战单元建模") return renderCombatUnitModeling(page);
  if (page.name === "基本任务建模") return renderBasicMissionModeling(page);
  if (page.name === "任务剖面参数") return renderMissionProfileParameters(page);
  if (page.name === "复合任务建模") return renderCompositeTaskModeling(page);
  if (page.name === "周期性任务建模") return renderPeriodicTaskModeling(page);
  return renderTaskModel(page);
}

function renderOntologySvg(ontology, focusSet, selectedItem = null) {
  const bands = ontologyBands();
  const visibleNodes = ontology.nodes.filter((node) => !collapsedOntologyGroups.has(node.group));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = ontology.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const positions = buildOntologyPositions(visibleNodes, visibleEdges);
  const clusters = buildOntologyClusters(visibleNodes, positions);
  return `
    <svg class="ontology-svg" viewBox="0 0 1430 1040" role="img" aria-label="项目级 ontology 关系图">
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      ${bands.map((band) => `
        <g class="ontology-band band-${band.group} ${band.collapsed ? "collapsed" : ""}">
          <rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" rx="8"></rect>
          <text x="${band.x + 16}" y="${band.y + 30}">${band.label}</text>
          <text class="ontology-band-count" x="${band.x + 128}" y="${band.y + 30}">${ontology.nodes.filter((node) => node.group === band.group).length} 节点</text>
          <rect class="ontology-band-toggle" x="${band.x + band.width - 66}" y="${band.y + 10}" width="28" height="28" rx="6" data-ontology-band-toggle="${htmlEscape(band.group)}" role="button" tabindex="0" aria-label="${band.collapsed ? "展开" : "折叠"}${htmlEscape(band.label)}层"></rect>
          <text class="ontology-band-toggle-glyph" x="${band.x + band.width - 52}" y="${band.y + 30}">${band.collapsed ? "+" : "-"}</text>
          <path class="ontology-band-resize-glyph" d="M ${band.x + band.width - 24} ${band.y + 35} L ${band.x + band.width - 8} ${band.y + 19} M ${band.x + band.width - 16} ${band.y + 35} L ${band.x + band.width - 8} ${band.y + 27}"></path>
          <rect class="ontology-band-resize-handle" x="${band.x + band.width - 30}" y="${band.y + 10}" width="28" height="28" rx="6" data-ontology-band-resize="${htmlEscape(band.group)}" role="button" tabindex="0" aria-label="调整${htmlEscape(band.label)}层大小"></rect>
        </g>
      `).join("")}
      ${clusters.map((cluster) => `
        <g class="ontology-cluster">
          <rect x="${cluster.x}" y="${cluster.y}" width="${cluster.width}" height="${cluster.height}" rx="7"></rect>
          <text x="${cluster.x + 12}" y="${cluster.y + 24}">${cluster.label}</text>
        </g>
      `).join("")}
      <g class="ontology-edges">
        ${visibleEdges.map((edgeItem) => {
          const from = positions[edgeItem.from];
          const to = positions[edgeItem.to];
          const isFocused = focusSet.has(edgeItem.from) || focusSet.has(edgeItem.to);
          const isSelected = selectedItem?.type === "edge" && selectedItem.id === edgeItem.id;
          const path = edgePath(from, to, ONTOLOGY_NODE_RADIUS);
          return `
            <g class="ontology-edge ${isSelected ? "selected" : ""}" data-ontology-edge-id="${htmlEscape(edgeItem.id)}" role="button" tabindex="0" aria-label="${htmlEscape(`${nodeLabel(edgeItem.from, ontology)} ${edgeItem.label} ${nodeLabel(edgeItem.to, ontology)}`)}">
              <path class="${isFocused ? "focused" : ""}" d="${path}"></path>
              <text class="edge-label ${isFocused ? "focused" : ""}" x="${(from.x + to.x) / 2 + 42}" y="${(from.y + to.y) / 2 - 5}">${edgeItem.label}</text>
            </g>
          `;
        }).join("")}
      </g>
      <g class="ontology-nodes">
        ${sortOntologyNodesForRender(visibleNodes, selectedItem).map((node) => {
          const position = positions[node.id];
          const isSelected = selectedItem?.type === "node" && selectedItem.id === node.id;
          const isDragging = activeOntologyDrag?.kind === "node" && activeOntologyDrag.id === node.id;
          return `
            <g class="ontology-node ${node.group} ${focusSet.has(node.id) ? "focused" : ""} ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}" data-ontology-node-id="${htmlEscape(node.id)}" role="button" tabindex="0" aria-label="${htmlEscape(node.label)}" transform="translate(${position.x}, ${position.y})">
              <title>${htmlEscape(node.label)}</title>
              <circle r="${ONTOLOGY_NODE_RADIUS}"></circle>
              <text x="0" y="4">${htmlEscape(compactNodeLabel(node.label))}</text>
            </g>
          `;
        }).join("")}
      </g>
    </svg>
  `;
}

function sortOntologyNodesForRender(nodes, selectedItem) {
  return [...nodes].sort((left, right) => {
    const leftActive = (selectedItem?.type === "node" && selectedItem.id === left.id) || (activeOntologyDrag?.kind === "node" && activeOntologyDrag.id === left.id);
    const rightActive = (selectedItem?.type === "node" && selectedItem.id === right.id) || (activeOntologyDrag?.kind === "node" && activeOntologyDrag.id === right.id);
    return Number(leftActive) - Number(rightActive);
  });
}

function buildOntologyPositions(nodes, edges = []) {
  const springPositions = calculateOntologySpringLayout(nodes, edges, ontologyBands());
  return nodes.reduce((acc, item) => {
    if (ontologyNodePositionOverrides[item.id]) {
      acc[item.id] = ontologyNodePositionOverrides[item.id];
      return acc;
    }
    acc[item.id] = springPositions[item.id];
    return acc;
  }, {});
}

function calculateOntologySpringLayout(nodes, edges, bands) {
  const nodeRadius = ONTOLOGY_NODE_RADIUS;
  const springIterations = 120;
  const positions = {};
  const velocities = {};
  const bandsByGroup = Object.fromEntries(bands.map((band) => [band.group, band]));
  const groupCounts = nodes.reduce((acc, node) => {
    acc[node.group] = (acc[node.group] || 0) + 1;
    return acc;
  }, {});
  const groupIndexes = {};

  for (const node of nodes) {
    const band = bandsByGroup[node.group] || bands[0];
    groupIndexes[node.group] = groupIndexes[node.group] || 0;
    const index = groupIndexes[node.group]++;
    const count = groupCounts[node.group] || 1;
    const columns = Math.max(1, Math.ceil(Math.sqrt(count * (band.width / Math.max(band.height, 1)))));
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rows = Math.max(1, Math.ceil(count / columns));
    positions[node.id] = {
      x: band.x + nodeRadius + 18 + ((column + 0.5) * Math.max(1, band.width - nodeRadius * 2 - 36)) / columns,
      y: band.y + 70 + ((row + 0.5) * Math.max(1, band.height - nodeRadius * 2 - 90)) / rows
    };
    velocities[node.id] = { x: 0, y: 0 };
  }

  for (let iteration = 0; iteration < springIterations; iteration += 1) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = positions[nodes[leftIndex].id];
        const right = positions[nodes[rightIndex].id];
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distanceSquared = dx * dx + dy * dy;
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(2.6, 9500 / Math.max(distanceSquared, 1600));
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        velocities[nodes[leftIndex].id].x -= fx;
        velocities[nodes[leftIndex].id].y -= fy;
        velocities[nodes[rightIndex].id].x += fx;
        velocities[nodes[rightIndex].id].y += fy;
      }
    }

    for (const edgeItem of edges) {
      const from = positions[edgeItem.from];
      const to = positions[edgeItem.to];
      if (!from || !to) continue;
      const dx = to.x - from.x || 0.01;
      const dy = to.y - from.y || 0.01;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const targetDistance = edgeItem.from === edgeItem.to ? 80 : 145;
      const force = (distance - targetDistance) * 0.018;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      velocities[edgeItem.from].x += fx;
      velocities[edgeItem.from].y += fy;
      velocities[edgeItem.to].x -= fx;
      velocities[edgeItem.to].y -= fy;
    }

    for (const node of nodes) {
      const band = bandsByGroup[node.group] || bands[0];
      const position = positions[node.id];
      const velocity = velocities[node.id];
      const anchorX = band.x + band.width / 2;
      const anchorY = band.y + band.height / 2;
      velocity.x += (anchorX - position.x) * 0.012;
      velocity.y += (anchorY - position.y) * 0.012;
      velocity.x *= 0.74;
      velocity.y *= 0.74;
      position.x = clamp(position.x + velocity.x, band.x + nodeRadius + 10, band.x + band.width - nodeRadius - 10);
      position.y = clamp(position.y + velocity.y, band.y + nodeRadius + 44, band.y + band.height - nodeRadius - 10);
    }
  }

  return positions;
}

function ontologyBands() {
  let y = 22;
  return DEFAULT_ONTOLOGY_BANDS.map((baseBand) => {
    const overrides = ontologyBandLayout[baseBand.group] || {};
    const collapsed = collapsedOntologyGroups.has(baseBand.group);
    const band = {
      ...baseBand,
      ...overrides,
      y,
      height: collapsed ? 54 : overrides.height || baseBand.height,
      collapsed
    };
    y += band.height + 24;
    return band;
  });
}

function buildOntologyClusters(nodes, positions = buildOntologyPositions(nodes)) {
  const grouped = nodes
    .filter((node) => node.group === "modeling-object" && node.layout?.cluster)
    .reduce((acc, node) => {
      const position = positions[node.id];
      acc[node.layout.cluster] ||= [];
      acc[node.layout.cluster].push(position);
      return acc;
    }, {});
  return Object.entries(grouped).map(([label, layouts]) => {
    const minX = Math.min(...layouts.map((item) => item.x)) - ONTOLOGY_NODE_RADIUS - 12;
    const minY = Math.min(...layouts.map((item) => item.y)) - ONTOLOGY_NODE_RADIUS - 34;
    const maxX = Math.max(...layouts.map((item) => item.x)) + ONTOLOGY_NODE_RADIUS + 12;
    const maxY = Math.max(...layouts.map((item) => item.y)) + ONTOLOGY_NODE_RADIUS + 12;
    return {
      label,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  });
}

function edgePath(from, to, nodeRadius = ONTOLOGY_NODE_RADIUS) {
  const dx = to.x - from.x || 0.01;
  const dy = to.y - from.y || 0.01;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / distance;
  const uy = dy / distance;
  const startX = from.x + ux * nodeRadius;
  const startY = from.y + uy * nodeRadius;
  const endX = to.x - ux * nodeRadius;
  const endY = to.y - uy * nodeRadius;
  const curve = Math.min(70, distance * 0.14);
  const normalX = -uy * curve;
  const normalY = ux * curve;
  const controlX = (startX + endX) / 2 + normalX;
  const controlY = (startY + endY) / 2 + normalY;
  return `M ${startX} ${startY} Q ${controlX} ${controlY}, ${endX} ${endY}`;
}

function compactNodeLabel(label) {
  return label.length > 5 ? `${label.slice(0, 4)}…` : label;
}

function renderTaskModel(page) {
  return `
    <div class="section-head section-context">
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

function renderMissionProfileParameters(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>任务剖面参数</h4>
        <div class="object-tree">
          <div class="tree-node root">${htmlEscape(scenario.missionProfile.profileType)}<span>任务类型</span></div>
          <div class="tree-node">${htmlEscape(scenario.missionProfile.repeatCycleHours)} h<span>重复周期</span></div>
          <div class="tree-node">${htmlEscape(scenario.missionProfile.endCondition)}<span>结束条件</span></div>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>任务剖面参数编辑</h4>
          <div class="form-table-grid">
            ${field("任务类型", "missionProfile.profileType")}
            ${field("重复周期", "missionProfile.repeatCycleHours", "number")}
            ${field("结束条件", "missionProfile.endCondition")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBuiltInScenario(page) {
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>内置场景对象</h4>
        <div class="form-table-grid" style="grid-template-columns:1fr;margin-top:12px;">
          ${field("场景编号", "scenarioId")}
        </div>
        <div class="object-tree">
          ${scenario.airports.map((airport, index) => `
            <button type="button" class="tree-node ${selectedBuiltInScenarioItem.type === "airport" && selectedBuiltInScenarioItem.index === index ? "active" : ""}" data-select-built-in-type="airport" data-select-built-in-index="${index}">
              ${htmlEscape(airport.name)}
              <span>${htmlEscape(airport.location)} / 距任务区 ${htmlEscape(airport.distanceToMissionKm)} km</span>
            </button>
          `).join("")}
          ${scenario.missionAreas.map((area, index) => `
            <button type="button" class="tree-node root ${selectedBuiltInScenarioItem.type === "missionArea" && selectedBuiltInScenarioItem.index === index ? "active" : ""}" data-select-built-in-type="missionArea" data-select-built-in-index="${index}">
              ${htmlEscape(area.name)}
              <span>${htmlEscape(area.areaType)} / 距出发机场 ${htmlEscape(area.distanceFromDepartureKm)} km</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="detail-panel">
        ${renderBuiltInScenarioEditor(selectedBuiltInScenarioItem)}
      </div>
    </div>
  `;
}

function renderBuiltInScenarioEditor(selectedBuiltInScenarioItem) {
  if (selectedBuiltInScenarioItem.type === "airport") {
    return `
      <div class="detail-card">
        <div class="section-head">
          <h3>机场属性</h3>
          <span>${htmlEscape(getPath(scenario, `airports.${selectedBuiltInScenarioItem.index}.name`) || "")}</span>
        </div>
        <div class="form-table-grid">
          ${field("机场名称", `airports.${selectedBuiltInScenarioItem.index}.name`)}
          ${field("机场位置", `airports.${selectedBuiltInScenarioItem.index}.location`)}
          ${field("跑道类型", `airports.${selectedBuiltInScenarioItem.index}.runwayType`)}
          ${field("距任务区(km)", `airports.${selectedBuiltInScenarioItem.index}.distanceToMissionKm`, "number")}
          ${field("关联保障节点", `airports.${selectedBuiltInScenarioItem.index}.supportNodeId`)}
        </div>
      </div>
    `;
  }
  return `
    <div class="detail-card">
      <div class="section-head">
        <h3>任务区属性</h3>
        <span>${htmlEscape(getPath(scenario, `missionAreas.${selectedBuiltInScenarioItem.index}.name`) || "")}</span>
      </div>
      <div class="form-table-grid">
        ${field("任务区名称", `missionAreas.${selectedBuiltInScenarioItem.index}.name`)}
        ${field("任务区类型", `missionAreas.${selectedBuiltInScenarioItem.index}.areaType`)}
        ${field("距出发机场(km)", `missionAreas.${selectedBuiltInScenarioItem.index}.distanceFromDepartureKm`, "number")}
        ${field("任务区半径(km)", `missionAreas.${selectedBuiltInScenarioItem.index}.patrolRadiusKm`, "number")}
        ${field("威胁等级", `missionAreas.${selectedBuiltInScenarioItem.index}.threatLevel`)}
      </div>
    </div>
  `;
}

function renderCombatUnitModeling(page) {
  const members = scenario.combatUnit.members || [];
  const executionMembers = members.filter((member) => member.status !== "备用").slice(0, scenario.combatUnit.requiredCount);
  const standbyMembers = members.filter((member) => member.status === "备用");
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>编队需求</h4>
        <div class="object-tree">
          <button type="button" class="tree-node root ${selectedCombatUnitSection === "group" ? "active" : ""}" data-select-combat-unit="group">${htmlEscape(scenario.combatUnit.groupName)}<span>${htmlEscape(scenario.combatUnit.requiredCount)} / ${htmlEscape(scenario.combatUnit.quantity)} 架</span></button>
          <button type="button" class="tree-node ${selectedCombatUnitSection === "basicTask" ? "active" : ""}" data-select-combat-unit="basicTask">${htmlEscape(scenario.combatUnit.basicTaskName)}<span>${htmlEscape(scenario.combatUnit.equipmentType)}</span></button>
          <button type="button" class="tree-node ${selectedCombatUnitSection === "deployment" ? "active" : ""}" data-select-combat-unit="deployment">${htmlEscape(scenario.combatUnit.deploymentLocation)}<span>部署位置</span></button>
        </div>
      </div>
      <div class="detail-panel">
        ${renderCombatUnitEditor(selectedCombatUnitSection)}
        <div class="detail-card">
          <h4>基本使用单元</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>序号</th><th>编队</th><th>基本任务名称</th><th>飞机类型</th><th>飞机编号</th><th>角色</th><th>剩余寿命</th><th>部署位置</th></tr></thead>
              <tbody>
                ${executionMembers.map((member, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${htmlEscape(scenario.combatUnit.groupName)}</td>
                    <td>${htmlEscape(scenario.combatUnit.basicTaskName)}</td>
                    <td>${htmlEscape(member.model)}</td>
                    <td>${htmlEscape(member.aircraftNo)}</td>
                    <td>${htmlEscape(member.role)}</td>
                    <td>${htmlEscape(member.remainingLifeHours)} h</td>
                    <td>${htmlEscape(member.deploymentLocation)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="detail-card network-card">
          <h4>备用机清单</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>序号</th><th>飞机类型</th><th>飞机编号</th><th>剩余寿命</th><th>部署位置</th></tr></thead>
              <tbody>
                ${standbyMembers.map((member, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${htmlEscape(member.model)}</td>
                    <td>${htmlEscape(member.aircraftNo)}</td>
                    <td>${htmlEscape(member.remainingLifeHours)} h</td>
                    <td>${htmlEscape(member.deploymentLocation)}</td>
                  </tr>
                `).join("") || "<tr><td colspan='5'>当前无备用机</td></tr>"}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCombatUnitEditor(selectedCombatUnitSection) {
  if (selectedCombatUnitSection === "basicTask") {
    return `
      <div class="detail-card">
        <h4>基本任务编辑</h4>
        <div class="form-table-grid" style="grid-template-columns:1fr;">
          ${field("基本任务名称", "combatUnit.basicTaskName")}
          ${field("装备类型", "combatUnit.equipmentType")}
          ${field("需求数量", "combatUnit.requiredCount", "number")}
        </div>
      </div>
    `;
  }
  if (selectedCombatUnitSection === "deployment") {
    return `
      <div class="detail-card">
        <h4>部署位置编辑</h4>
        <div class="form-table-grid" style="grid-template-columns:1fr;">
          ${field("部署位置", "combatUnit.deploymentLocation")}
        </div>
      </div>
    `;
  }
  return `
    <div class="detail-card">
      <h4>编队需求编辑</h4>
      <div class="form-table-grid" style="grid-template-columns:1fr;">
        ${field("编队名称", "combatUnit.groupName")}
        ${field("装备数量", "combatUnit.quantity", "number")}
        ${field("需求数量", "combatUnit.requiredCount", "number")}
      </div>
    </div>
  `;
}

function renderBasicMissionModeling(page) {
  const mission = scenario.basicMission;
  const phases = scenario.missionPhases || [];
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>基本任务结构树</h4>
        <p class="muted">按装备构型飞机节点组织：飞机类型 → 基本任务名称</p>
        <div class="object-tree">
          <div class="tree-node root">${htmlEscape(mission.equipmentType)}<span>${htmlEscape(mission.equipmentQuantity)} 架</span></div>
          <div class="tree-node">${htmlEscape(mission.name)}<span>${htmlEscape(mission.taskNo)}</span></div>
          <div class="tree-node">${htmlEscape(mission.taskArea)}<span>任务区域描述</span></div>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>基本任务信息编辑</h4>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr><th>基本任务名称</th><td>${valueInput("basicMission.name")}</td></tr>
                <tr><th>任务编号</th><td>${valueInput("basicMission.taskNo")}</td></tr>
                <tr><th>装备类型</th><td>${valueInput("basicMission.equipmentType")}</td></tr>
                <tr><th>装备数量</th><td>${valueInput("basicMission.equipmentQuantity", "number")}</td></tr>
                <tr><th>任务时长（分钟）</th><td>${valueInput("basicMission.taskDurationMinutes", "number")}</td></tr>
                <tr><th>准备时间（min）</th><td>${valueInput("basicMission.preparationMinutes", "number")}</td></tr>
                <tr><th>取消时间（min）</th><td>${valueInput("basicMission.cancelMinutes", "number")}</td></tr>
                <tr><th>使用保障活动</th><td>${valueInput("basicMission.supportActivityName")}</td></tr>
                <tr><th>任务区域描述</th><td>${valueInput("basicMission.taskArea")}</td></tr>
                <tr><th>更新时间</th><td>${valueInput("basicMission.updatedAt")}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="detail-card network-card">
          <h4>任务阶段</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>序号</th><th>阶段名称</th><th>状态</th><th>转移条件</th><th>阶段时限(h)</th></tr></thead>
              <tbody>
                ${phases.map((phase, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${htmlEscape(phase.name)}</td>
                    <td>${htmlEscape(phase.state)}</td>
                    <td>${htmlEscape(phase.transitionCondition)}</td>
                    <td>${htmlEscape(phase.limitHours)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCompositeTaskModeling(page) {
  const compositeTasks = scenario.missionProfile.compositeTasks || [];
  const composite = compositeTasks[0] || { name: "", taskItems: [] };
  const timelineRows = buildCompositeTimelineRows(composite);
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>复合任务列表</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>序号</th><th>复合任务名称</th><th>基本任务</th></tr></thead>
            <tbody>
              ${compositeTasks.map((task, index) => `
                <tr class="${index === 0 ? "active" : ""}">
                  <td>${index + 1}</td>
                  <td>${htmlEscape(task.name)}</td>
                  <td>${htmlEscape((task.taskItems || []).map((item) => item.basicTaskName).join("、") || "未关联基本任务")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>当前复合任务包含的基本任务</h4>
          <div class="form-table-grid" style="grid-template-columns:1fr;margin-bottom:12px;">
            ${field("复合任务名称", "missionProfile.compositeTasks.0.name")}
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>序号</th><th>基本任务名称</th><th>装备类型</th><th>装备数量</th><th>编队名称</th><th>任务下达时间</th><th>首波次出动时刻</th><th>单日重复次数</th><th>间隔小时数</th></tr></thead>
              <tbody>
                ${(composite.taskItems || []).map((item, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.basicTaskName`)}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.equipmentType`)}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.equipmentQuantity`, "number")}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.groupName`)}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.taskDispatchTime`, "time")}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.firstWaveTime`, "time")}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.dailyRepeatCount`, "number")}</td>
                    <td>${valueInput(`missionProfile.compositeTasks.0.taskItems.${index}.intervalHours`, "number")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="detail-card network-card">
          <h4>典型组合任务时序表</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>波次序号</th><th>基本任务名称</th><th>编队名称</th><th>任务下达时刻</th><th>准备时间(min)</th><th>出动时刻</th><th>回收时刻</th></tr></thead>
              <tbody>
                ${timelineRows.map((row) => `
                  <tr>
                    <td>${row.sequence}</td>
                    <td>${htmlEscape(row.basicTaskName)}</td>
                    <td>${htmlEscape(row.groupName)}</td>
                    <td>${htmlEscape(row.taskDispatchTime)}</td>
                    <td>${htmlEscape(row.preparationMinutes)}</td>
                    <td>${htmlEscape(row.departureTime)}</td>
                    <td>${htmlEscape(row.recoveryTime)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPeriodicTaskModeling(page) {
  const compositeTasks = scenario.missionProfile.compositeTasks || [];
  const periodicTasks = scenario.missionProfile.periodicTasks || [];
  const compositeOptions = compositeTasks.map((task) => ({ value: task.id, label: task.name }));
  const weekdayFields = [
    ["monday", "星期一"],
    ["tuesday", "星期二"],
    ["wednesday", "星期三"],
    ["thursday", "星期四"],
    ["friday", "星期五"],
    ["saturday", "星期六"],
    ["sunday", "星期日"]
  ];
  return `
    <div class="section-head section-context">
      <span>${page.dataObjects.join(" / ")}</span>
    </div>
    <div class="organization-layout">
      <div class="tree-container">
        <h4>周期性任务列表</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>序号</th><th>周期性任务名称</th><th>重复周数</th></tr></thead>
            <tbody>
              ${periodicTasks.map((task, index) => `
                <tr class="${index === 0 ? "active" : ""}">
                  <td>${index + 1}</td>
                  <td>${htmlEscape(task.name)}</td>
                  <td>${htmlEscape(task.repeatWeeks)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-card">
          <h4>周期性任务建模</h4>
          <div class="form-table-grid">
            ${field("周期性任务名称", "missionProfile.periodicTasks.0.name")}
            ${field("重复周数", "missionProfile.periodicTasks.0.repeatWeeks", "number")}
          </div>
          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead><tr><th>星期</th><th>复合任务名称</th></tr></thead>
              <tbody>
                ${weekdayFields.map(([key, label]) => `
                  <tr>
                    <td>${label}</td>
                    <td>${valueSelect(`missionProfile.periodicTasks.0.weekdayAssignments.${key}`, compositeOptions)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildCompositeTimelineRows(composite) {
  return (composite.taskItems || []).flatMap((item) => {
    const repeatCount = Math.max(1, Number(item.dailyRepeatCount || 1));
    const intervalHours = Math.max(1, Number(item.intervalHours || 1));
    const durationMinutes = diffTimeMinutes(item.firstWaveTime, item.recoveryTime) || Number(item.taskDurationMinutes || scenario.basicMission.taskDurationMinutes || 180);
    return Array.from({ length: repeatCount }, (_, index) => {
      const departureTime = addHoursToTime(item.firstWaveTime, index * intervalHours);
      return {
        sequence: index + 1,
        basicTaskName: item.basicTaskName,
        groupName: item.groupName,
        taskDispatchTime: item.taskDispatchTime,
        preparationMinutes: item.preparationMinutes,
        departureTime,
        recoveryTime: addMinutesToTime(departureTime, durationMinutes)
      };
    });
  });
}

function addHoursToTime(value, hours) {
  return addMinutesToTime(value, Number(hours || 0) * 60);
}

function addMinutesToTime(value, minutes) {
  const [hour, minute] = String(value || "00:00").split(":").map((part) => Number(part));
  const total = (((Number(hour) || 0) * 60 + (Number(minute) || 0) + Number(minutes || 0)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function diffTimeMinutes(start, end) {
  const [startHour, startMinute] = String(start || "").split(":").map((part) => Number(part));
  const [endHour, endMinute] = String(end || "").split(":").map((part) => Number(part));
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  return endTotal >= startTotal ? endTotal - startTotal : endTotal + 1440 - startTotal;
}

function renderEquipmentModeling(page) {
  const selectedIndex = clampEquipmentComponentIndex(selectedEquipmentComponentIndex);
  const selected = scenario.components[selectedIndex] || {};
  const isFailurePage = page.name.includes("故障");
  return `
    <div class="section-head section-context">
      <span>${isFailurePage ? "故障属性 / 数量 / N中取K参数 / RMS指标" : "组成树 / 组成属性"}</span>
    </div>
    <div class="organization-layout">
      <aside class="tree-container">
        <div class="tree-toolbar">
          <h4>装备组成树</h4>
          <div><button type="button" class="btn-primary">新增节点</button><button type="button">导入</button></div>
        </div>
        <div class="object-tree">
          <div class="tree-node root">${htmlEscape(scenario.equipment.model)}<span>${htmlEscape(scenario.equipment.quantity)} 架</span></div>
          ${scenario.components.map((component, index) => `
            <button type="button" class="tree-node ${index === selectedIndex ? "active" : ""}" data-select-equipment-component="${index}">
              ${htmlEscape(component.name)}
              <span>${htmlEscape(component.quantity)} 件 / ${htmlEscape(component.connectionType)}</span>
            </button>
          `).join("")}
        </div>
      </aside>
      <section class="detail-panel">
        <div class="detail-card">
          <div class="section-head">
            <h3>${isFailurePage ? "故障属性" : "组成属性"}</h3>
            <span>${htmlEscape(selected.name || "")}</span>
          </div>
          <div class="form-table-grid">
            ${isFailurePage ? renderEquipmentFailureFields(selectedIndex) : renderEquipmentCompositionFields(selectedIndex)}
          </div>
        </div>
        ${isFailurePage ? renderEquipmentFailureRmsFields(selected, selectedIndex) : ""}
        ${isFailurePage ? renderEquipmentComponentTable() : ""}
      </section>
    </div>
  `;
}

function clampEquipmentComponentIndex(index) {
  return clamp(Number.isFinite(index) ? index : 0, 0, Math.max((scenario.components || []).length - 1, 0));
}

function renderEquipmentCompositionFields(selectedIndex) {
  return `
    ${field("组件名称", `components.${selectedIndex}.name`)}
    ${field("父节点", `components.${selectedIndex}.parentId`)}
    ${field("备件类型", `components.${selectedIndex}.spareType`)}
    ${field("连接类型", `components.${selectedIndex}.connectionType`)}
  `;
}

function renderEquipmentFailureFields(selectedIndex) {
  return `
    ${renderEquipmentCompositionFields(selectedIndex)}
    <label>数量 n<input data-path="components.${selectedIndex}.quantity" type="number" value="${htmlEscape(getPath(scenario, `components.${selectedIndex}.quantity`))}"></label>
    <label>成功数 k<input data-path="components.${selectedIndex}.kOutOfN.k" type="number" value="${htmlEscape(getPath(scenario, `components.${selectedIndex}.kOutOfN.k`))}"></label>
    ${field("N中取K总数", `components.${selectedIndex}.kOutOfN.n`, "number")}
    ${field("启用 n 中取 k", `components.${selectedIndex}.kOutOfN.enabled`)}
    ${field("故障模型", `components.${selectedIndex}.failureModel`)}
    ${field("失效率", `components.${selectedIndex}.failureRate`, "number")}
    ${field("MTBF(h)", `components.${selectedIndex}.mtbfHours`, "number")}
    ${field("寿命限制(h)", `components.${selectedIndex}.lifeLimitHours`, "number")}
  `;
}

function renderEquipmentComponentTable() {
  return `
    <div class="detail-card network-card">
      <h4>组件属性表</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>组件</th><th>父节点</th><th>数量</th><th>启用 n 中取 k</th><th>n</th><th>k</th><th>故障模型</th><th>失效率</th><th>MTBF</th></tr></thead>
          <tbody>
            ${scenario.components.map((component) => `
              <tr>
                <td>${htmlEscape(component.name)}</td>
                <td>${htmlEscape(component.parentId)}</td>
                <td>${htmlEscape(component.quantity)}</td>
                <td>${component.kOutOfN?.enabled ? "是" : "否"}</td>
                <td>${htmlEscape(component.kOutOfN?.n ?? component.quantity)}</td>
                <td>${htmlEscape(component.kOutOfN?.k ?? component.quantity)}</td>
                <td>${htmlEscape(component.failureModel)}</td>
                <td>${htmlEscape(component.failureRate)}</td>
                <td>${htmlEscape(component.mtbfHours)}h</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderEquipmentFailureRmsFields(selected, selectedIndex) {
  return `
    <div class="detail-card">
      <div class="section-head">
        <h3>RMS指标</h3>
        <span>${htmlEscape(selected.name || "")}</span>
      </div>
      <div class="form-table-grid">
        ${field("可靠度 R(t)", `components.${selectedIndex}.rms.reliability`, "number")}
        ${field("维修度 M(t)", `components.${selectedIndex}.rms.maintainability`, "number")}
        ${field("保障性 S(t)", `components.${selectedIndex}.rms.supportability`, "number")}
        ${field("平均修复时间 MTTR(h)", `components.${selectedIndex}.rms.mttrHours`, "number")}
        ${field("平均保障延迟 MLDT(h)", `components.${selectedIndex}.rms.mldtHours`, "number")}
        ${field("固有可用度 Ai", `components.${selectedIndex}.rms.availability`, "number")}
      </div>
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
    <div class="section-head section-context">
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
    <div class="section-head section-context">
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
  const activeResourceType = page.name.includes("人员") ? "保障人员" : page.name.includes("设备") ? "保障设备" : page.name.includes("备件") ? "备件" : "";
  const visibleResourceRows = activeResourceType ? resourceRows.filter((row) => row.type === activeResourceType) : resourceRows;
  return `
    <div class="ship-front-workbench">
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
              <h3>${activeTab === "保障组织结构建模" ? "组织详情" : "资源清单"}</h3>
              <span>${activeResourceType ? `${activeResourceType}资源清单` : "对齐 ship_front 树 + 表格编辑结构"}</span>
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
                  <tbody>${visibleResourceRows.map((row, index) => `
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
  const activePlan = SUPPORT_ACTIVITY_PLANS.find((plan) => plan.type === page.name) || SUPPORT_ACTIVITY_PLANS[0];
  return `
    <div class="ship-front-workbench">
      <div class="organization-layout">
        <aside class="tree-container">
          <div class="tree-toolbar">
            <h4>${htmlEscape(activePlan.treeTitle)}</h4>
            <div><button type="button" class="btn-primary">新增分类</button><button type="button">导入</button></div>
          </div>
          ${renderSupportActivityTreeNode(activePlan.tree, activePlan.path.at(-1))}
        </aside>
        <section class="detail-panel">
          <div class="detail-card activity-editor-card">
            <div class="section-head">
              <h3>${activePlan.type.replace("建模", "编辑")}</h3>
              <span>${activePlan.path.map((item) => htmlEscape(item)).join(" / ")}</span>
            </div>
            <div class="form-table-grid">
              <label>活动名称<input value="${htmlEscape(activePlan.name)}"></label>
              <label>活动类别<input value="${htmlEscape(activePlan.type.replace("建模", ""))}"></label>
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

function renderSupportActivityTreeNode(node, selectedName) {
  const isSelected = node.name === selectedName;
  return `
    <div class="tree-node-item">
      <div class="tree-node-label ${isSelected ? "selected" : ""}">
        <span class="tree-node-toggle">${node.children?.length ? "▼" : "•"}</span>
        <span class="tree-node-text">${htmlEscape(node.name)}</span>
      </div>
      ${node.children?.length ? `<div class="tree-node-children">${node.children.map((child) => renderSupportActivityTreeNode(child, selectedName)).join("")}</div>` : ""}
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
      <button type="button" class="btn-primary" data-save-plan>保存方案</button>
    </div>
  `;
}

async function saveCurrentProjectThroughApi() {
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  try {
    savedProject = await backendApi.saveProject(projectJson);
    modelingSnapshot = await backendApi.createModelingSnapshot(savedProject.project_id);
    backendApiStatus = "已保存";
  } catch (err) {
    savedProject = null;
    modelingSnapshot = null;
    backendApiStatus = `后端不可用，保存未进入闭环：${err && err.message ? err.message : "Backend API 不可用"}`;
  }
}

async function startExperimentRunThroughApi() {
  const projectJson = buildBackendProjectJson(scenario, currentProject);
  updateDemoResultsThroughApiClient();
  try {
    savedProject = await backendApi.saveProject(projectJson);
    modelingSnapshot = await backendApi.createModelingSnapshot(savedProject.project_id);
    experimentPlan = await backendApi.createExperimentPlan(
      savedProject.project_id,
      buildExperimentPlanConfig(projectJson)
    );
    backendRun = await backendApi.startSimulationRun(savedProject.project_id, experimentPlan.experiment_plan_id, "smoke");
    await refreshRunResultThroughApi(backendRun.run_id);
    rememberLastBackendRun(backendRun.run_id, savedProject.project_id);
    experimentRunStatus = backendRun.status === "succeeded" ? "完成" : backendRun.status;
    backendApiStatus = "运行完成";
  } catch (err) {
    backendRun = null;
    backendRunResult = null;
    backendArtifactManifest = null;
    backendRunChain = null;
    forgetLastBackendRun();
    experimentRunStatus = "后端不可用";
    backendApiStatus = `后端不可用，未创建 run_id：${err && err.message ? err.message : "Backend API 不可用"}`;
  } finally {
    render();
  }
}

async function refreshRunResultThroughApi(runId = backendRun?.run_id) {
  if (!runId) return;
  backendRun = await backendApi.getRun(runId);
  backendRunResult = await backendApi.getRunResult(runId);
  backendArtifactManifest = await backendApi.getRunArtifacts(runId);
  backendRunChain = await backendApi.getRunChain(runId);
  if (backendRun.project_id) {
    savedProject = await backendApi.getProject(backendRun.project_id);
  }
  const state = buildFrontendResultState(buildBackendProjectJson(scenario, currentProject), backendRunResult);
  singleResult = state.singleResult;
  monteCarloResult = state.monteCarloResult;
}

async function hydrateLastBackendRunFromApi() {
  const stored = readLastBackendRun();
  if (!stored?.run_id) return;
  try {
    await refreshRunResultThroughApi(stored.run_id);
    backendApiStatus = "已从后端恢复";
    experimentRunStatus = backendRun?.status === "succeeded" ? "完成" : backendRun?.status || "已恢复";
    isLoggedIn = true;
    if (selectedRoute === DEFAULT_ROUTE) selectedRoute = "workbench";
    render();
  } catch (err) {
    forgetLastBackendRun();
    backendApiStatus = `后端不可用，刷新恢复已阻断：${err && err.message ? err.message : "Backend API 不可用"}`;
    render();
  }
}

function rememberLastBackendRun(runId, projectId) {
  if (!runId) return;
  try {
    localStorage.setItem("spare-mvp:lastBackendRun", JSON.stringify({ run_id: runId, project_id: projectId || "", saved_at: new Date().toISOString() }));
  } catch (err) {
    return;
  }
}

function readLastBackendRun() {
  try {
    return JSON.parse(localStorage.getItem("spare-mvp:lastBackendRun") || "null");
  } catch (err) {
    return null;
  }
}

function forgetLastBackendRun() {
  try {
    localStorage.removeItem(LAST_BACKEND_RUN_STORAGE_KEY);
  } catch (err) {
    return;
  }
}

function updateDemoResultsThroughApiClient() {
  const state = buildDemoResultState(buildBackendProjectJson(scenario, currentProject));
  singleResult = state.singleResult;
  monteCarloResult = state.monteCarloResult;
}

function recalculateRmsAllocation() {
  try {
    rmsAllocationResult = calculateRmsAllocation(rmsAllocationPlan, rmsAllocationProject);
  } catch (err) {
    rmsAllocationResult = {
      ok: false,
      planId: rmsAllocationPlan.planId,
      planVersion: rmsAllocationPlan.planVersion,
      status: "method_not_applicable",
      algorithmVersion: rmsAllocationPlan.algorithmVersion || "rms-engine-1.0.0",
      exposure: { rows: [], warnings: [] },
      nodeResults: [],
      verification: {
        equipmentTarget: {
          reliability: Number(rmsAllocationPlan.targets.reliability.value),
          mttrHours: Number(rmsAllocationPlan.targets.mttrHours),
          mldtHours: Number(rmsAllocationPlan.targets.mldtHours)
        },
        calculated: { reliability: 0, mttrHours: 0, mldtHours: 0 },
        margin: { reliability: 0, mttrHours: 0, mldtHours: 0 },
        status: "method_not_applicable"
      },
      warnings: [{ code: "RMS_METHOD_NOT_APPLICABLE", message: err && err.message ? err.message : "当前分配方法不适用" }],
      assumptions: rmsAllocationPlan.assumptions || []
    };
  }
}

async function loadAviationSupportState(steps = aviationSteps) {
  if (typeof fetch === "undefined") {
    liveAviationState = null;
    aviationSource = "demo";
    return;
  }
  aviationLoadInFlight = true;
  try {
    const params = new URLSearchParams({ model: "aviation", steps: String(steps), seed: "17" });
    const resp = await fetch(`${CONTRACT_BASE}/visualization?${params.toString()}`);
    if (!resp.ok) throw new Error(`contract provider HTTP ${resp.status}`);
    const envelope = await resp.json();
    if (!envelope || envelope.ok !== true || !envelope.data) throw new Error("bad contract envelope");
    liveAviationState = envelope.data;
    aviationSource = "live";
  } catch (err) {
    liveAviationState = null;
    aviationSource = "demo";
    console.warn("[aviation] 契约服务不可用，回退演示快照：", err && err.message ? err.message : err);
  } finally {
    aviationLoadInFlight = false;
    render();
  }
}

function renderVisualSimulation(page) {
  const source = liveAviationState || AVIATION_SUPPORT_DEMO_STATE;
  const state = normalizeAviationSupportState(source);
  const activeView = ["aircraft", "mission", "support", "ontology"].includes(selectedMesaView) ? selectedMesaView : "aircraft";
  const shellClass = activeView === "ontology" && isOntologyFullscreen ? "mesa-visual-shell ontology-fullscreen" : "mesa-visual-shell";
  const sidePanelClass = activeView === "ontology" && isOntologyFullscreen && isOntologyDetailCollapsed ? "mesa-side-panel collapsed" : "mesa-side-panel";
  if (!liveAviationState && !aviationLoadInFlight) {
    loadAviationSupportState();
  }
  return `
    <div class="${shellClass}">
      <div class="mesa-visual-header">
        <div>
          <div class="breadcrumb">Mesa ABM / aviation_support</div>
          <h3>航空保障 Mesa ABM</h3>
          <p>从 mesa-abm-skill 的可视化仿真迁移而来，基于本地状态帧展示飞机、任务、保障资源和 ontology 结构。</p>
        </div>
        <div class="mesa-clock">T+${Number((source.snapshot && source.snapshot.elapsed_hours) || 0).toFixed(1)}h <span class="mesa-source mesa-source-${aviationSource}" title="数据来源：${aviationSource === "live" ? "契约服务 127.0.0.1:8521" : "演示快照（契约服务未启动）"}">${aviationSource === "live" ? "契约服务" : "演示快照"}</span></div>
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
          ${activeView === "ontology" ? `<button type="button" data-ontology-fullscreen>${isOntologyFullscreen ? "退出全屏" : "全屏查看"}</button>` : ""}
        </div>
      </div>
      <div class="kpi-strip">
        ${state.kpis.map((item) => `<div class="kpi-card"><span>${item.label}</span><strong>${item.value}</strong></div>`).join("")}
      </div>
      <div class="mesa-visual-grid">
        <section class="mesa-stage-panel">
          ${activeView === "ontology" ? renderMesaOntologyPanel() : renderMesaStage(state)}
        </section>
        <aside class="${sidePanelClass}">
          ${activeView === "ontology" && isOntologyFullscreen && isOntologyDetailCollapsed ? renderMesaOntologyCollapsedPanel(currentMesaOntology()) : renderMesaSidePanel(activeView, state)}
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
  if (activeView === "ontology") return renderMesaOntologySidePanel(currentMesaOntology());
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
  const ontology = currentMesaOntology();
  return `
    <div class="mesa-ontology-stage">
      ${renderOntologySvg(ontology, buildMesaOntologyFocusSet(ontology), selectedOntologyItem)}
    </div>
  `;
}

function currentMesaOntology() {
  const page = getFeaturePageById(selectedFeatureId);
  return buildProjectOntology({ module: page.module });
}

function buildMesaOntologyFocusSet(ontology = currentMesaOntology()) {
  const page = getFeaturePageById(selectedFeatureId);
  const context = page.component === "visual-simulation"
    ? { focusNodeIds: ["visual-run-control", "simulation-run", "scenario-view", "metric-time-series"] }
    : { focusNodeIds: [] };
  const modelInstanceIds = ontology.nodes
    .filter((node) => node.group === "model-instance")
    .slice(0, 10)
    .map((node) => node.id);
  return new Set([
    ...page.dataObjects.map((path) => `project:${path.split(".")[0]}`),
    ...context.focusNodeIds,
    ...modelInstanceIds
  ]);
}

function renderMesaOntologySidePanel(ontology = currentMesaOntology()) {
  const toggleButton = isOntologyFullscreen
    ? `<button type="button" class="ontology-detail-toggle" data-ontology-detail-toggle>折叠</button>`
    : "";
  if (selectedOntologyItem) return renderMesaOntologyDetailPanel(selectedOntologyItem, ontology);
  const groups = Object.entries(ONTOLOGY_GROUPS);
  return `
    <div class="section-head">
      <h3>Ontology关系图</h3>
      <span>${ontology.nodes.length} 节点 / ${ontology.edges.length} 关系</span>
      ${toggleButton}
    </div>
    <div class="event info"><strong>Mesa ABM 映射</strong>该视图展示结构依赖，不代表 OWL 推理结果。</div>
    ${groups.map(([groupId, meta]) => {
      const count = ontology.nodes.filter((node) => node.group === groupId).length;
      return `<details class="ontology-group" ${groupId === "modeling-object" ? "open" : ""}><summary class="ontology-group-head"><strong>${meta.label}</strong><span>${count}</span></summary><p>${meta.summary}</p></details>`;
    }).join("")}
  `;
}

function renderMesaOntologyCollapsedPanel(ontology = currentMesaOntology()) {
  const selectedLabel = selectedOntologyItem
    ? selectedOntologyItem.type === "node"
      ? nodeLabel(selectedOntologyItem.id, ontology)
      : "已选关系"
    : "属性";
  return `
    <button type="button" class="ontology-detail-toggle collapsed" data-ontology-detail-toggle aria-label="展开属性面板">
      <span>属性面板</span>
      <strong>${htmlEscape(selectedLabel)}</strong>
    </button>
  `;
}

function renderMesaOntologyDetailPanel(item, ontology = currentMesaOntology()) {
  const nodeItem = item.type === "node" ? ontology.nodes.find((node) => node.id === item.id) : null;
  const edgeItem = item.type === "edge" ? ontology.edges.find((edge) => edge.id === item.id) : null;
  if (nodeItem) return renderOntologyNodeDetail(nodeItem, ontology);
  if (edgeItem) return renderOntologyEdgeDetail(edgeItem, ontology);
  selectedOntologyItem = null;
  return renderMesaOntologySidePanel(ontology);
}

function renderOntologyNodeDetail(nodeItem, ontology = currentMesaOntology()) {
  const group = ONTOLOGY_GROUPS[nodeItem.group] || {};
  const relatedEdges = ontology.edges.filter((edge) => edge.from === nodeItem.id || edge.to === nodeItem.id);
  const positions = buildOntologyPositions(ontology.nodes, ontology.edges);
  const position = positions[nodeItem.id];
  const fields = [
    ["id", nodeItem.id],
    ["label", nodeItem.label],
    ["group", group.label || nodeItem.group],
    ["description", nodeItem.description],
    ["source.kind", nodeItem.source?.kind || "-"],
    ["source.path", nodeItem.source?.path || "-"],
    ["字段数量", nodeItem.source?.fieldPaths?.length ?? "-"],
    ["来源表单", renderSourceFormNames(nodeItem)],
    ["layout.x", nodeItem.layout?.x ?? "-"],
    ["layout.y", nodeItem.layout?.y ?? "-"],
    ["layout.cluster", nodeItem.layout?.cluster || "-"],
    ["view.x", Math.round(position.x)],
    ["view.y", Math.round(position.y)],
    ["relations", `${relatedEdges.length} 条`]
  ];
  return `
    <div class="section-head">
      <h3>属性详情</h3>
      <span>对象</span>
      ${isOntologyFullscreen ? `<button type="button" class="ontology-detail-toggle" data-ontology-detail-toggle>折叠</button>` : ""}
    </div>
    <div class="event info"><strong>${htmlEscape(nodeItem.label)}</strong>${htmlEscape(nodeItem.description)}</div>
    <h4>字段</h4>
    ${renderOntologyFieldRows(fields)}
    <h4>关联关系</h4>
    ${renderOntologyRelationList(nodeItem, ontology)}
  `;
}

function renderSourceFormNames(nodeItem) {
  const featurePages = nodeItem.source?.featurePages || [];
  if (featurePages.length === 0) return "-";
  return featurePages.map((page) => `${page.name} (${page.featureId})`).join(" / ");
}

function renderOntologyEdgeDetail(edgeItem, ontology = currentMesaOntology()) {
  const fields = [
    ["id", edgeItem.id],
    ["label", edgeItem.label],
    ["from", edgeItem.from],
    ["fromLabel", nodeLabel(edgeItem.from, ontology)],
    ["to", edgeItem.to],
    ["toLabel", nodeLabel(edgeItem.to, ontology)],
    ["semantic", `${nodeLabel(edgeItem.from, ontology)} ${edgeItem.label} ${nodeLabel(edgeItem.to, ontology)}`]
  ];
  return `
    <div class="section-head">
      <h3>属性详情</h3>
      <span>关系</span>
      ${isOntologyFullscreen ? `<button type="button" class="ontology-detail-toggle" data-ontology-detail-toggle>折叠</button>` : ""}
    </div>
    <div class="event info"><strong>${htmlEscape(edgeItem.label)}</strong>${htmlEscape(nodeLabel(edgeItem.from, ontology))} -> ${htmlEscape(nodeLabel(edgeItem.to, ontology))}</div>
    <h4>字段</h4>
    ${renderOntologyFieldRows(fields)}
    <h4>关联关系</h4>
    <div class="ontology-relation-list">
      <div>
        <strong>端点对象</strong>
        <button type="button" class="ontology-related-row" data-ontology-node-id="${htmlEscape(edgeItem.from)}">${htmlEscape(nodeLabel(edgeItem.from, ontology))}</button>
        <button type="button" class="ontology-related-row" data-ontology-node-id="${htmlEscape(edgeItem.to)}">${htmlEscape(nodeLabel(edgeItem.to, ontology))}</button>
      </div>
    </div>
  `;
}

function renderOntologyFieldRows(fields) {
  return `
    <table class="ontology-field-table">
      <tbody>
        ${fields.map(([name, value]) => `<tr><th>${htmlEscape(name)}</th><td>${htmlEscape(String(value))}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderOntologyRelationList(nodeItem, ontology = currentMesaOntology()) {
  const outgoingEdges = ontology.edges.filter((edge) => edge.from === nodeItem.id);
  const incomingEdges = ontology.edges.filter((edge) => edge.to === nodeItem.id);
  const renderEdges = (edges, emptyText) => edges.length
    ? edges.map((edge) => `<button type="button" class="ontology-related-row" data-ontology-edge-id="${htmlEscape(edge.id)}">${htmlEscape(nodeLabel(edge.from, ontology))} ${htmlEscape(edge.label)} ${htmlEscape(nodeLabel(edge.to, ontology))}</button>`).join("")
    : `<div class="ontology-empty-note">${htmlEscape(emptyText)}</div>`;
  return `
    <div class="ontology-relation-list">
      <div>
        <strong>出向关系</strong>
        ${renderEdges(outgoingEdges, "无出向关系")}
      </div>
      <div>
        <strong>入向关系</strong>
        ${renderEdges(incomingEdges, "无入向关系")}
      </div>
    </div>
  `;
}

function nodeLabel(id, ontology = currentMesaOntology()) {
  return ontology.nodes.find((item) => item.id === id)?.label || id;
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
          <div class="readonly-field">
            <span>当前仿真实验</span>
            <strong>${htmlEscape(scenario.experiment.name)}</strong>
          </div>
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
  const backendChainRows = backendRunChain
    ? [
        ["Project", backendRunChain.project_id],
        ["Snapshot", backendRunChain.modeling_snapshot_id],
        ["ExperimentPlan", backendRunChain.experiment_plan_id],
        ["Scenario", backendRunChain.scenario_id],
        ["Run", backendRunChain.run_id],
        ["Result", backendRunChain.result_summary_id],
        ["ArtifactManifest", backendRunChain.artifact_manifest_id]
      ]
    : [];
  const artifactRows = backendArtifactManifest && backendArtifactManifest.artifacts
    ? backendArtifactManifest.artifacts
    : [];
  return `
    <div class="mc-result-panel">
      <div class="section-head">
        <h3>蒙特卡洛评估结果</h3>
        <span>${monteCarloResult.runs.length} 个样本</span>
      </div>
      <div class="backend-run-chain">
        <span>后端状态：${htmlEscape(backendApiStatus)}</span>
        ${backendChainRows.length
          ? `<table><tbody>${backendChainRows.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("")}</tbody></table>`
          : `<p>${htmlEscape(backendRun?.run_id || "尚未读取 run_id 身份链")}</p>`}
        ${artifactRows.length
          ? `<table><tbody>${artifactRows.map((artifact) => `<tr><th>${htmlEscape(artifact.kind)}</th><td>${htmlEscape(artifact.path)}</td></tr>`).join("")}</tbody></table>`
          : ""}
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
    <div class="section-head section-context">
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
    priority: carryPriority(row.riskLevel)
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

function carryPriority(riskLevel) {
  switch (riskLevel) {
    case "高":
    case "high":
      return "高";
    case "中":
    case "medium":
      return "中";
    case "低":
    case "low":
      return "低";
    default:
      return "低";
  }
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
  return `<label>${label}${valueInput(path, type)}</label>`;
}

function valueInput(path, type = "text") {
  return `<input data-path="${path}" type="${type}" value="${htmlEscape(getPath(scenario, path))}">`;
}

function valueSelect(path, options) {
  const selectedValue = String(getPath(scenario, path));
  return `
    <select data-path="${path}">
      ${options.map((option) => {
        const value = String(option.value);
        return `<option value="${htmlEscape(value)}" ${value === selectedValue ? "selected" : ""}>${htmlEscape(option.label)}</option>`;
      }).join("")}
    </select>
  `;
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
  updateDemoResultsThroughApiClient();
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
