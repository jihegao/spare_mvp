import assert from "node:assert/strict";
import test from "node:test";

import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import { defaultScenario } from "../front/sim-engine.mjs";

test("frontend app module initializes without Monte Carlo TDZ errors", async () => {
  const appNode = {
    innerHTML: "",
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;

  globalThis.document = {
    querySelector(selector) {
      return selector === "#app" ? appNode : null;
    }
  };
  globalThis.location = { hash: "" };
  globalThis.window = {
    addEventListener() {},
    location: globalThis.location
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {}
  };

  try {
    await import(`../front/app.js?runtime-smoke=${Date.now()}`);
    assert.match(appNode.innerHTML, /登录/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
  }
});

test("frontend app restores stored backend session and hydrates project catalog on cold boot", async () => {
  const appNode = {
    innerHTML: "",
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  const requests = [];
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;

  globalThis.document = {
    querySelector(selector) {
      return selector === "#app" ? appNode : null;
    }
  };
  globalThis.location = { hash: "" };
  globalThis.window = {
    addEventListener() {},
    location: globalThis.location
  };
  globalThis.localStorage = {
    getItem(key) {
      if (key === "spare-mvp:m4Session") {
        return JSON.stringify({ session: { token: "m4-stored-token" } });
      }
      return null;
    },
    setItem() {},
    removeItem() {}
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/auth/session") {
      return jsonResponse({
        user: { username: "data", role: "数据管理员" }
      });
    }
    if (url === "/api/projects") {
      return jsonResponse({
        projects: [{
          project_id: "project-carrier-day-night",
          experiment_name: "导入示例项目",
          base_code: "IMPORTED-001",
          summary: "由建模导入 JSON 生成的完整页面测试项目",
          source_import_id: "import-carrier-day-night-001",
          updated_at: "2026-06-26 04:26:05"
        }]
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    await import(`../front/app.js?runtime-session-restore=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(requests.map((request) => request.url), ["/api/auth/session", "/api/projects"]);
    assert.equal(requests[0].options.headers.authorization, "Bearer m4-stored-token");
    assert.match(appNode.innerHTML, /项目列表/);
    assert.match(appNode.innerHTML, /导入示例项目/);
    assert.match(appNode.innerHTML, /已加载 1 个后端项目/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
    globalThis.fetch = previousFetch;
  }
});

test("support resource page imports a local personnel table", async () => {
  let changeHandler = null;
  const appNode = {
    innerHTML: "",
    addEventListener(type, listener) {
      if (type === "change") changeHandler = listener;
    },
    querySelector() {
      return null;
    }
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;

  globalThis.document = {
    querySelector(selector) {
      return selector === "#app" ? appNode : null;
    }
  };
  globalThis.location = { hash: "feature=spare-planning-support-personnel" };
  globalThis.window = {
    addEventListener() {},
    location: globalThis.location
  };
  globalThis.localStorage = {
    getItem(key) {
      if (key === "spare-mvp:m4Session") {
        return JSON.stringify({ session: { token: "m4-runtime-token" } });
      }
      return null;
    },
    setItem() {},
    removeItem() {}
  };
  globalThis.fetch = async (url) => {
    if (url === "/api/auth/session") {
      return jsonResponse({ user: { username: "data", role: "数据管理员" } });
    }
    if (url === "/api/projects") {
      return jsonResponse({
        projects: [{
          project_id: "project-runtime",
          experiment_name: "Runtime 项目",
          base_code: "RT",
          summary: "runtime test",
          updated_at: "2026-06-26 00:00:00"
        }]
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    await import(`../front/app.js?support-resource-import=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(typeof changeHandler, "function");
    assert.match(appNode.innerHTML, /data-support-resource-import-file="保障人员"/);
    assert.doesNotMatch(appNode.innerHTML, /所属型号/);
    assert.match(appNode.innerHTML, /专业/);
    assert.doesNotMatch(appNode.innerHTML, /适用机型/);

    const fileInput = {
      dataset: { supportResourceImportFile: "保障人员" },
      files: [{
        name: "personnel.csv",
        async text() {
          return "组织节点,专业,数量\n航母飞行甲板,机务,7";
        }
      }],
      value: "personnel.csv",
      closest(selector) {
        return selector === "[data-support-resource-import-file]" ? this : null;
      }
    };

    await changeHandler({ target: fileInput });

    assert.equal(fileInput.value, "");
    assert.match(appNode.innerHTML, /已导入 personnel\.csv：保障人员 1 行/);
    assert.match(appNode.innerHTML, /data-support-resource-field="organizationNodeId" disabled/);
    assert.match(appNode.innerHTML, /data-support-resource-field="model"/);
    assert.match(appNode.innerHTML, /<option value="机务" selected>机务<\/option>/);
    assert.match(appNode.innerHTML, /value="7"/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
    globalThis.fetch = previousFetch;
  }
});

test("support resource add creates a new editable row for the selected leaf organization", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      supportOrganization: {
        tree: [{
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }]
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1",
        organizationNodeId: "base-1",
        personnelModel: "航电",
        personnelCapacity: 1,
        inventory: {}
      }]
    })
  });
  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-support-personnel");
    await runtime.click("[data-select-support-org-node]", { selectSupportOrgNode: "base-1" });
    const before = (runtime.appNode.innerHTML.match(/data-support-resource-field="model"/g) || []).length;

    await runtime.click("[data-support-resource-add]", { supportResourceAdd: "保障人员" });

    const after = (runtime.appNode.innerHTML.match(/data-support-resource-field="model"/g) || []).length;
    assert.equal(before, 1);
    assert.equal(after, 2);
    assert.doesNotMatch(runtime.appNode.innerHTML, /新增保障人员/);
  } finally {
    runtime.restore();
  }
});

test("support organization airport selector syncs from combat unit aircraft airports", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      airports: [],
      combatUnit: {
        members: [
          { aircraftNo: "J15-01", model: "J-15", airport: "甲机场" },
          { aircraftNo: "J15-02", model: "J-15", airport: "乙机场" }
        ]
      },
      supportOrganization: {
        tree: [{
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }]
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1",
        organizationNodeId: "base-1",
        inventory: {}
      }]
    })
  });
  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-support-organization");
    await runtime.click("[data-select-support-org-node]", { selectSupportOrgNode: "base-1" });

    assert.match(runtime.appNode.innerHTML, /关联机场/);
    assert.match(runtime.appNode.innerHTML, /<option value="甲机场"/);
    assert.match(runtime.appNode.innerHTML, /<option value="乙机场"/);

    await runtime.change("[data-support-org-field]", { supportOrgNode: "base-1", supportOrgField: "airport" }, { value: "甲机场" });

    assert.match(runtime.appNode.innerHTML, /<option value="甲机场" selected>/);
  } finally {
    runtime.restore();
  }
});

test("project list exports project JSON without direct Project JSON import at runtime", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-json-runtime",
    scenarioId: "json-runtime-scenario",
    experiment: { name: "运行时项目", steps: 12, samples: 3, seed: 260626 }
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    assert.match(runtime.appNode.innerHTML, /项目列表/);
    assert.match(runtime.appNode.innerHTML, /data-project-template-select/);
    assert.match(runtime.appNode.innerHTML, /data-project-create-from-template/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-import-template/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-project-create-from-import/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-project-add/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-project-import/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /添加本地 Project draft|本地草稿|本地空白预览/);
    assert.match(runtime.appNode.innerHTML, /data-project-export="runtime"/);

    await runtime.click("[data-project-export]", { projectExport: "runtime" });
    assert.equal(runtime.downloads.length, 1);
    assert.match(runtime.downloads[0].download, /^spare-mvp-project-runtime-/);
    const exported = JSON.parse(await runtime.downloads[0].blob.text());
    assert.equal(exported.scenarioId, "json-runtime-scenario");
    assert.equal(exported.experiment.name, "运行时项目");
    assert.equal(exported.project_id, "project-json-runtime");
  } finally {
    runtime.restore();
  }
});

test("project data raw JSON normalizes legacy basicMission fields", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    basicMissions: [],
    basicMission: {
      missionId: "legacy-runtime-basic",
      name: "旧运行时基本任务",
      equipmentType: "J-15",
      taskDurationMinutes: 80
    },
    missionProfile: {
      name: "运行时任务剖面",
      durationHours: 8,
      basicMission: {
        missionId: "legacy-profile-basic",
        name: "旧剖面基本任务",
        equipmentType: "J-35"
      },
      compositeTasks: [{
        id: "composite-runtime",
        taskItems: [{
          basicMissionId: "legacy-runtime-basic",
          basicTaskName: "旧运行时基本任务",
          equipmentType: "stale",
          taskDurationMinutes: 1
        }]
      }],
      periodicTasks: []
    }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-project-data-management",
    projectJson
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /project json 原始数据/);
    assert.match(runtime.appNode.innerHTML, /<code>basicMissions<\/code><span>\[2\]<\/span>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<code>basicMission<\/code>/);
  } finally {
    runtime.restore();
  }
});

test("visual Mesa page renders compact headerless status view with decimal KPI values", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /data-mesa-control="play"/);
    assert.match(runtime.appNode.innerHTML, /飞机状态一览/);
    assert.match(runtime.appNode.innerHTML, /<span>使用可用度<\/span><strong>0\.50<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<span>出动架次率<\/span><strong>0\.50<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<span>备件满足率<\/span><strong>0\.50<\/strong>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /飞机保障独立 Mesa 仿真/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /点击可视化推演后直接读取当前 Project/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<div class="mesa-clock"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /独立 Mesa/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<strong>0%<\/strong>|<strong>100%<\/strong>/);
  } finally {
    runtime.restore();
  }
});

test("four result analysis pages omit Mesa from visible copy", async () => {
  const featureIds = [
    "spare-planning-spare-shortfall-analysis",
    "spare-planning-carry-list-analysis",
    "mission-reliability-task-reliability",
    "mission-reliability-downtime-factor-analysis"
  ];

  for (const featureId of featureIds) {
    const runtime = await setupRuntimeApp({
      hash: `feature=${featureId}`,
      projectJson: createRuntimeProjectJson()
    });
    try {
      assert.match(runtime.appNode.innerHTML, /分析设置/);
      assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>/);
      assert.match(runtime.appNode.innerHTML, /尚未运行分析/);
      for (const removedCopy of [
        "前端建模 + Mesa 分析",
        "运行 Mesa 分析",
        "尚未运行 Mesa 分析",
        "独立 Mesa 设置",
        "后端 Mesa",
        "会话内 Mesa",
        "Mesa 样本"
      ]) {
        assert.doesNotMatch(runtime.appNode.innerHTML, new RegExp(removedCopy), `${featureId} should not show ${removedCopy}`);
      }
    } finally {
      runtime.restore();
    }
  }
});

test("carry list analysis result omits boundary explanation card", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    assert.match(runtime.appNode.innerHTML, /建议携行数量/);
    assert.match(runtime.appNode.innerHTML, /aircraft_support_v1_spares/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /边界说明/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /会话内 Mesa 分析结果/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /不写入正式结果账本/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /未创建 run、result 或 artifact/);
  } finally {
    runtime.restore();
  }
});

test("experiment and analysis pages render when Project draft has no root experiment config", async () => {
  const featureExpectations = [
    ["spare-planning-experiment-plan-management", /方案列表/],
    ["spare-planning-monte-carlo-experiment-detail", /蒙特卡洛分析/],
    ["spare-planning-spare-shortfall-analysis", /分析设置/]
  ];

  for (const [featureId, expectedCopy] of featureExpectations) {
    const projectJson = createRuntimeProjectJson();
    delete projectJson.experiment;
    const runtime = await setupRuntimeApp({
      hash: `feature=${featureId}`,
      projectJson
    });

    try {
      assert.match(runtime.appNode.innerHTML, expectedCopy);
      assert.doesNotMatch(runtime.appNode.innerHTML, /保障组织结构树/);
    } finally {
      runtime.restore();
    }
  }
});

test("feature routes without a template-created project return to project list", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-list",
    backendProjects: []
  });

  try {
    assert.match(runtime.appNode.innerHTML, /项目列表/);
    assert.match(runtime.appNode.innerHTML, /请选择项目模板创建项目/);
    assert.match(runtime.appNode.innerHTML, /data-project-template-select/);
    assert.match(runtime.appNode.innerHTML, /暂无项目模板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-import-template|Level 0|Level 1/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-plan-select="local:本地空白预览"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /本地空白预览/);
  } finally {
    runtime.restore();
  }
});

test("project list keeps multiple projects created from the selected project template", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime-template",
    projectInfo: {
      name: "运行时模板项目",
      baseCode: "RT",
      summary: "runtime template",
      isTemplate: true
    },
    experiment: { name: "运行时模板项目", steps: 24, samples: 2, seed: 20260626 }
  });
  const runtime = await setupRuntimeApp({
    projectJson,
    backendProjects: [{
      project_id: "project-runtime-template",
      experiment_name: "运行时模板项目",
      base_code: "RT",
      summary: "runtime template",
      source_import_id: "runtime-import-template",
      is_template: true,
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    assert.match(runtime.appNode.innerHTML, /请选择项目模板创建项目/);
    assert.match(runtime.appNode.innerHTML, /运行时模板项目【模板】/);

    await runtime.click("[data-project-create-from-template]");
    await runtime.click("[data-project-create-from-template]");

    assert.match(runtime.appNode.innerHTML, /运行时模板项目 副本 2/);
    assert.match(runtime.appNode.innerHTML, /运行时模板项目 副本 3/);
    assert.match(runtime.appNode.innerHTML, /data-enter-workbench data-project-id="runtime-template-copy-2"/);
    assert.match(runtime.appNode.innerHTML, /data-enter-workbench data-project-id="runtime-template-copy-3"/);
    const createRequests = runtime.requests.filter((request) => (
      request.url.endsWith("/create-project")
      && (request.options.method || "GET") === "POST"
    ));
    assert.equal(createRequests.length, 0);
    const projectSaveRequests = runtime.requests.filter((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    assert.equal(projectSaveRequests.length, 2);
    assert.ok(projectSaveRequests.every((request) => {
      const body = JSON.parse(request.options.body || "{}");
      return body.projectInfo?.isTemplate === false
        && body.projectInfo?.is_template === false
        && body.isTemplate === false
        && body.is_template === false;
    }));
  } finally {
    runtime.restore();
  }
});

test("project list rename persists and survives creating another project from the selected template", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    projectInfo: { name: "Runtime 项目", baseCode: "RT", summary: "runtime test", isTemplate: true }
  });
  const runtime = await setupRuntimeApp({
    projectJson,
    backendProjects: [{
      project_id: "project-runtime",
      experiment_name: "Runtime 项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "runtime-import-template",
      is_template: true,
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    await runtime.click("[data-project-edit]", { projectEdit: "runtime" });
    await runtime.input("[data-project-edit-field]", { projectEditField: "name" }, { value: "原 Project 改名" });
    await runtime.click("[data-project-edit-save]");
    await runtime.click("[data-project-create-from-template]");

    assert.match(runtime.appNode.innerHTML, /原 Project 改名/);
    assert.match(runtime.appNode.innerHTML, /原 Project 改名 副本 2/);
    const projectSaveRequests = runtime.requests.filter((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(projectSaveRequests.some((request) => {
      const body = JSON.parse(request.options.body || "{}");
      return body.project_id === "project-runtime"
        && body.experiment?.name === "原 Project 改名"
        && body.projectInfo?.name === "原 Project 改名";
    }));
    assert.ok(projectSaveRequests.some((request) => {
      const body = JSON.parse(request.options.body || "{}");
      return body.project_id === "project-runtime-copy-2"
        && body.experiment?.name === "原 Project 改名 副本 2"
        && body.projectInfo?.isTemplate === false
        && body.projectInfo?.is_template === false;
    }));
  } finally {
    runtime.restore();
  }
});

test("equipment aircraft-list selection renders whole aircraft rows and descendants", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-35"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      components: [
        { id: "j15-engine", name: "J-15发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 2 },
        { id: "j15-control", name: "J-15控制模块", aircraftModel: "J-15", parentId: "j15-engine", productType: "SRU", quantity: 1 },
        { id: "j35-radar", name: "J-35雷达", aircraftModel: "J-35", parentId: "aircraft-root", productType: "LRU", quantity: 1 }
      ]
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.click("[data-select-equipment-root]");

    const rightPanel = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("equipment-system-table-panel"));
    assert.match(rightPanel, /2 类飞机 \/ 5 行节点/);
    assert.match(rightPanel, /J-15/);
    assert.match(rightPanel, /J-35/);
    assert.match(rightPanel, /J-15发动机/);
    assert.match(rightPanel, /J-15控制模块/);
    assert.match(rightPanel, /J-35雷达/);
    assert.match(rightPanel, /整机级/);
  } finally {
    runtime.restore();
  }
});

test("equipment aircraft rename keeps aircraftTypes catalog in saved Project draft", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: {
        model: "J-15",
        wholeMachineModels: ["J-15"],
        aircraftTypes: [{ id: "aircraft-type-j15", model: "J-15", name: "歼-15" }],
        quantity: 2,
        initialReady: 2,
        minRequiredSorties: 1
      },
      components: [
        { id: "j15-engine", name: "J-15发动机", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 2 }
      ]
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.click("[data-select-equipment-aircraft]", { selectEquipmentAircraft: "J-15" });
    await runtime.change("[data-equipment-aircraft-model]", { equipmentAircraftModel: "J-15" }, { value: "J-20" });
    await runtime.click("[data-project-draft-save]");

    const projectSaveRequests = runtime.requests.filter((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    const savedProject = JSON.parse(projectSaveRequests.at(-1).options.body || "{}");
    assert.deepEqual(savedProject.equipment, {
      model: "J-20",
      wholeMachineModels: ["J-20"],
      aircraftTypes: [{ id: "aircraft-type-j15", model: "J-20", name: "J-20" }]
    });
    assert.equal(savedProject.components[0].aircraftModel, "J-20");
  } finally {
    runtime.restore();
  }
});

test("RMS method selection updates method-specific parameters at runtime", async () => {
  const runtime = await setupRuntimeApp({ hash: "feature=system-management-equipment-rms-allocation" });

  try {
    assert.match(runtime.appNode.innerHTML, /装备 RMS 指标分配/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /基准机型/);

    await runtime.change("[data-rms-path]", { rmsPath: "methods.reliability" }, { value: "similar" });

    assert.match(runtime.appNode.innerHTML, /基准机型/);
    assert.match(runtime.appNode.innerHTML, /相似修正系数/);
    assert.match(runtime.appNode.innerHTML, /data-rms-path="methods\.similarProduct\.sourceModel"/);
  } finally {
    runtime.restore();
  }
});

test("RMS imported aircraft models filter the tree and remain available as similar references", async () => {
  const runtime = await setupRuntimeApp({ hash: "feature=system-management-equipment-rms-allocation" });

  try {
    const file = {
      name: "rms-models.csv",
      async text() {
        return [
          "id,name,parentId,level,mtbfHours,similarProductModel",
          "f15-root,F15,,装备,,",
          "f15-engine,F15 发动机,f15-root,系统,2000,",
          "f16-root,F16,,装备,,",
          "f16-engine,F16 发动机,f16-root,系统,400,F15",
          "f18-root,F18,,装备,,",
          "f18-engine,F18 发动机,f18-root,系统,820,"
        ].join("\n");
      }
    };

    await runtime.change("[data-rms-equipment-import-file]", {}, { files: [file], value: "rms-models.csv" });
    assert.match(runtime.appNode.innerHTML, /已导入 rms-models\.csv/);
    assert.match(runtime.appNode.innerHTML, /F15 发动机/);

    await runtime.change("[data-rms-equipment-root]", {}, { value: "f16-root" });
    assert.match(runtime.appNode.innerHTML, /F16 发动机/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /F15 发动机/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /F18 发动机/);

    await runtime.change("[data-rms-path]", { rmsPath: "methods.reliability" }, { value: "similar" });
    assert.match(runtime.appNode.innerHTML, /基准机型/);
    assert.match(runtime.appNode.innerHTML, /<option value="F15" selected>F15<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="F16"\s*>F16<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="F18"\s*>F18<\/option>/);
  } finally {
    runtime.restore();
  }
});

test("support activity add work item opens the editing dialog at runtime", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-operations-support-activity");

    assert.match(runtime.appNode.innerHTML, /data-support-activity-job-add="ops_preflight"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-activity-job-template="ops_preflight"/);
    await runtime.click("[data-support-activity-job-add]", { supportActivityJobAdd: "ops_preflight" });
    assert.match(runtime.appNode.innerHTML, /data-support-activity-job-template="ops_preflight"/);
    await runtime.click("[data-support-activity-job-template]", {
      supportActivityJobTemplate: "ops_preflight",
      basicActivityKey: "0:0"
    });

    assert.match(runtime.appNode.innerHTML, /value="初始工作项目"/);
    assert.match(runtime.appNode.innerHTML, /value="BA-001"/);
    assert.match(runtime.appNode.innerHTML, /value="BA-002"/);
    assert.match(runtime.appNode.innerHTML, /data-support-activity-job="ops_preflight-1"/);

    await runtime.click("[data-support-activity-job]", { supportActivityJob: "ops_preflight-1" });
    assert.match(runtime.appNode.innerHTML, /工作项目编辑/);
    assert.match(runtime.appNode.innerHTML, /data-support-activity-job-template-select="ops_preflight"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<th>保障人员<\/th><th>保障设备<\/th><th>备件<\/th>/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity add uses a draft dialog before creating a row", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    const before = (runtime.appNode.innerHTML.match(/data-basic-activity-edit=/g) || []).length;
    await runtime.click("[data-basic-activity-add]");

    assert.match(runtime.appNode.innerHTML, /新增基本保障活动/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-key="__new_basic_activity__"/);
    assert.equal((runtime.appNode.innerHTML.match(/data-basic-activity-edit=/g) || []).length, before);

    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "workName" },
      { value: "新增弹窗活动" }
    );
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "activityCode" },
      { value: "BA-001" }
    );
    await runtime.click("[data-basic-activity-dialog-save]");

    assert.equal((runtime.appNode.innerHTML.match(/data-basic-activity-edit=/g) || []).length, before + 1);
    assert.match(runtime.appNode.innerHTML, /新增弹窗活动/);
    assert.equal((runtime.appNode.innerHTML.match(/<td>BA-001<\/td>/g) || []).length, 1);
    assert.match(runtime.appNode.innerHTML, /<td>BA-002<\/td>/);
  } finally {
    runtime.restore();
  }
});

test("corrective basic activity draft uses the selected component scope", async () => {
  const projectJson = createRuntimeProjectJson({
    components: [
      { id: "component-a", name: "部件A", aircraftModel: "J-15", quantity: 1 },
      { id: "component-b", name: "部件B", aircraftModel: "J-15", quantity: 1 }
    ]
  });
  projectJson.supportActivities.push({
    id: "corrective-component-a",
    activityType: "修复性维修",
    planType: "修复性维修方案",
    activityName: "部件A修复性维修方案",
    equipmentId: "component-a",
    jobs: [{
      activityCode: "CM-A",
      workName: "部件A既有修复作业",
      predecessors: [],
      durationMinutes: 45
    }]
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-add]");
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "type" },
      { value: "修复性维修" }
    );
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "scope" },
      { value: "component:component-b" }
    );
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "activityCode" },
      { value: "CM-B" }
    );
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "__new_basic_activity__", basicActivityField: "workName" },
      { value: "部件B新增修复作业" }
    );
    await runtime.click("[data-basic-activity-dialog-save]");

    await runtime.setHash("feature=spare-planning-corrective-maintenance-activity");
    await runtime.click("[data-select-corrective-component]", { selectCorrectiveComponent: "component-a" });
    assert.match(runtime.appNode.innerHTML, /部件A既有修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件B新增修复作业/);

    await runtime.click("[data-select-corrective-component]", { selectCorrectiveComponent: "component-b" });
    assert.match(runtime.appNode.innerHTML, /部件B新增修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件A既有修复作业/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity codes stay unique when edited at runtime", async () => {
  const projectJson = createRuntimeProjectJson();
  projectJson.supportActivities[0].jobs.push({
    activityCode: "BA-002",
    workName: "第二工作项目",
    predecessors: [],
    durationMinutes: 15
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:1" });
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "0:1", basicActivityField: "activityCode" },
      { value: "BA-001" }
    );

    assert.equal((runtime.appNode.innerHTML.match(/<td>BA-001<\/td>/g) || []).length, 1);
    assert.match(runtime.appNode.innerHTML, /value="BA-002"/);
  } finally {
    runtime.restore();
  }
});

test("support activity predecessors are edited from the predecessor dialog at runtime", async () => {
  const projectJson = createRuntimeProjectJson();
  projectJson.supportActivities[0].jobs.push({
    activityCode: "BA-002",
    workName: "已有紧前作业",
    predecessors: [],
    durationMinutes: 15
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-operations-support-activity");

    assert.match(runtime.appNode.innerHTML, /data-support-activity-predecessor-edit="ops_preflight-0"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-activity-predecessors/);

    await runtime.click("[data-support-activity-predecessor-edit]", { supportActivityPredecessorEdit: "ops_preflight-0" });
    assert.match(runtime.appNode.innerHTML, /编辑紧前作业/);
    assert.match(runtime.appNode.innerHTML, /当前紧前作业清单/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-activity-predecessor-query/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-activity-predecessor-add-template="ops_preflight"/);

    await runtime.click("[data-support-activity-predecessor-toggle]", {
      supportActivityPredecessorKey: "ops_preflight:0",
      supportActivityPredecessorToggle: "BA-002"
    });
    assert.match(runtime.appNode.innerHTML, /checked/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity edit opens a dialog at runtime", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    assert.match(runtime.appNode.innerHTML, /data-basic-activity-edit=/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<th>保障人员<\/th><th>保障设备<\/th><th>备件<\/th>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="后勤保障"/);
    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:0" });

    assert.match(runtime.appNode.innerHTML, /basic-activity-dialog/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-dialog-close/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-open="personnel"/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-open="equipment"/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-open="spare"/);

    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "personnel" }
    );
    assert.match(runtime.appNode.innerHTML, /保障人员需求配置/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-add="personnel"/);

    await runtime.click(
      "[data-basic-activity-resource-dialog-add]",
      { basicActivityKey: "0:0", basicActivityResourceDialogAdd: "personnel" }
    );
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-index="1"/);

    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "personnel",
        basicActivityResourceIndex: "1",
        basicActivityResourceDialogField: "professional"
      },
      { value: "航电" }
    );
    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "personnel",
        basicActivityResourceIndex: "1",
        basicActivityResourceDialogField: "quantity"
      },
      { value: "4", type: "number" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="航电" selected>航电<\/option>/);
    assert.match(runtime.appNode.innerHTML, /value="4"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /新增保障人员/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "spare" }
    );
    await runtime.click(
      "[data-basic-activity-resource-dialog-add]",
      { basicActivityKey: "0:0", basicActivityResourceDialogAdd: "spare" }
    );
    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "spare",
        basicActivityResourceIndex: "1",
        basicActivityResourceDialogField: "model"
      },
      { value: "HD-01" }
    );
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name" value="航电模块"/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity resource dialog uses modeling dictionaries and imported job resources", async () => {
  const projectJson = createRuntimeProjectJson();
  projectJson.modelingDictionaries = { personnelSpecialties: ["航电", "液压"] };
  projectJson.supportNodes = [{
    id: "carrier-deck",
    name: "航母飞行甲板",
    personnelCapacity: 10,
    equipmentCapacity: 8,
    inventory: { 航电模块: 3 }
  }];
  projectJson.supportActivities[0].jobs[0] = {
    activityCode: "BA-001",
    workName: "导入工作项目",
    predecessors: [],
    durationMinutes: 20,
    personnel: "维修/航电,2",
    equipment: "检测仪,DT-01,1",
    spare: "航电模块,LRU,1"
  };
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:0" });

    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "personnel" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="航电"/);
    assert.match(runtime.appNode.innerHTML, /<option value="液压"/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "equipment" }
    );
    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "equipment",
        basicActivityResourceIndex: "0",
        basicActivityResourceDialogField: "model"
      },
      { value: "DT-01" }
    );
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name" value="检测仪"/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "spare" }
    );
    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "spare",
        basicActivityResourceIndex: "0",
        basicActivityResourceDialogField: "model"
      },
      { value: "LRU" }
    );
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name" value="航电模块"/);
  } finally {
    runtime.restore();
  }
});

test("logistics support activity page only renders transport strategy list", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "runtime" });
    await runtime.setHash("feature=spare-planning-logistics-support-activity");

    assert.match(runtime.appNode.innerHTML, /后勤保障运输策略配置/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /工作项目清单/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /保障活动图/);
  } finally {
    runtime.restore();
  }
});

test("experiment plan row selection is interactive for template-created projects at runtime", async () => {
  const runtime = await setupRuntimeApp({ hash: "feature=spare-planning-experiment-plan-list" });

  try {
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-select="local:运行时项目"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /selected-table-row/);

    await runtime.change(
      "[data-experiment-plan-select]",
      { experimentPlanSelect: "local:运行时项目" },
      { checked: true, type: "checkbox" }
    );

    assert.match(runtime.appNode.innerHTML, /selected-table-row/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-select="local:运行时项目" checked/);
  } finally {
    runtime.restore();
  }
});

test("experiment plan add opens an editable plan branch", async () => {
  const runtime = await setupRuntimeApp({ hash: "feature=spare-planning-experiment-plan-management" });

  try {
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-add/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-plan-add disabled/);

    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });

    assert.match(runtime.appNode.innerHTML, /方案编辑/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-path="experiment\.name"/);
    assert.match(runtime.appNode.innerHTML, /data-save-plan/);

    await runtime.change(
      "[data-experiment-plan-path]",
      { experimentPlanPath: "experiment.name" },
      { value: "新增仿真实验方案" }
    );
    await runtime.click("[data-save-plan]");

    const createPlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(createPlanRequest, "new experiment plan should be posted to backend");
    const body = JSON.parse(createPlanRequest.options.body || "{}");
    assert.equal(body.config.name, "新增仿真实验方案");
    assert.equal("experiment" in body.config.projectJson, false);
    assert.match(runtime.appNode.innerHTML, /方案列表/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-add/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-save-plan/);
  } finally {
    runtime.restore();
  }
});

test("experiment plan save posts composed projectJson without mutating source project", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson({
      supportNodes: [{
        id: "base-a",
        name: "基层保障点A",
        personnelCapacity: 2,
        equipmentCapacity: 2,
        inventory: { "LRU-A": 2 }
      }]
    })
  });

  try {
    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });
    await runtime.change(
      "[data-experiment-plan-path]",
      { experimentPlanPath: "experiment.samples" },
      { value: "5", type: "number" }
    );
    await runtime.change("[data-experiment-seed-policy]", {}, { value: "fixed" });
    await runtime.change("[data-experiment-seed-base]", {}, { value: "909", type: "number" });
    await runtime.click("[data-scenario-override-add]");
    await runtime.change(
      "[data-scenario-override-path]",
      { scenarioOverrideIndex: "0" },
      { value: "supportNodes.0.inventory.LRU-A" }
    );
    await runtime.change(
      "[data-scenario-override-value-type]",
      { scenarioOverrideIndex: "0" },
      { value: "number" }
    );
    await runtime.change(
      "[data-scenario-override-value]",
      { scenarioOverrideIndex: "0" },
      { value: "12" }
    );
    await runtime.click("[data-save-plan]");

    const createPlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(createPlanRequest, "composed experiment plan should be posted to backend");
    const body = JSON.parse(createPlanRequest.options.body || "{}");
    assert.equal(body.config.samples, 5);
    assert.equal(body.config.seed, 909);
    assert.deepEqual(body.config.seedPolicy, { mode: "fixed", baseSeed: 909 });
    assert.equal(body.config.projectJson.supportNodes[0].inventory["LRU-A"], 12);
    assert.equal(body.config.analysisRequests.largeSample.samples, 5);
    assert.equal("scenarioComposition" in body.config.projectJson, false);

    const projectSaveRequests = runtime.requests.filter((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(projectSaveRequests.length, "source Project should still be saved separately");
    const savedProjects = projectSaveRequests.map((request) => JSON.parse(request.options.body || "{}"));
    assert.ok(savedProjects.every((savedProject) => savedProject.supportNodes?.[0]?.inventory?.["LRU-A"] !== 12));
    assert.ok(savedProjects.every((savedProject) => !("scenarioComposition" in savedProject)));
    assert.ok(savedProjects.every((savedProject) => !("seedPolicy" in savedProject)));
  } finally {
    runtime.restore();
  }
});

test("experiment plan edit preserves saved seed policy scenario composition and samples", async () => {
  const planProjectJson = createRuntimeProjectJson({
    supportNodes: [{
      id: "base-a",
      name: "基层保障点A",
      personnelCapacity: 2,
      equipmentCapacity: 2,
      inventory: { "LRU-A": 14 }
    }]
  });
  delete planProjectJson.experiment;
  delete planProjectJson.analysisRequests;
  delete planProjectJson.monteCarlo;
  delete planProjectJson.seedPolicy;
  delete planProjectJson.scenarioComposition;

  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson({
      supportNodes: [{
        id: "base-a",
        name: "基层保障点A",
        personnelCapacity: 2,
        equipmentCapacity: 2,
        inventory: { "LRU-A": 2 }
      }]
    }),
    experimentPlans: [{
      experiment_plan_id: "plan-saved-composition",
      status: "draft",
      config: {
        name: "已保存拼接方案",
        steps: 36,
        samples: 7,
        seed: 777,
        seedPolicy: { mode: "random", baseSeed: 777 },
        scenarioComposition: {
          schemaVersion: "scenario-composition-v0",
          sourceProjectId: "project-runtime",
          baseProjectVersion: "project-v0.1",
          overrides: [{
            path: "supportNodes.0.inventory.LRU-A",
            valueType: "number",
            value: "14",
            label: "LRU-A 加库存"
          }]
        },
        analysisRequests: {
          largeSample: {
            enabled: true,
            samples: 7,
            sweep: { sampleCount: 7, seedBase: 777 }
          }
        },
        projectJson: planProjectJson
      }
    }]
  });

  try {
    await runtime.click(
      "[data-experiment-plan-edit]",
      { experimentPlanEdit: "plan-saved-composition", experimentPlanName: "已保存拼接方案" }
    );
    await runtime.click("[data-save-plan]");

    const updatePlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(updatePlanRequest, "saved experiment plan edit should be posted to backend");
    const body = JSON.parse(updatePlanRequest.options.body || "{}");
    assert.equal(body.config.name, "已保存拼接方案");
    assert.equal(body.config.steps, 36);
    assert.equal(body.config.samples, 7);
    assert.equal(body.config.seed, 777);
    assert.deepEqual(body.config.seedPolicy, { mode: "random", baseSeed: 777 });
    assert.equal(body.config.scenarioComposition.overrides[0].path, "supportNodes.0.inventory.LRU-A");
    assert.equal(body.config.scenarioComposition.overrides[0].value, 14);
    assert.equal(body.config.projectJson.supportNodes[0].inventory["LRU-A"], 14);
    assert.equal(body.config.analysisRequests.largeSample.samples, 7);
    assert.equal("scenarioComposition" in body.config.projectJson, false);
    assert.equal("seedPolicy" in body.config.projectJson, false);
  } finally {
    runtime.restore();
  }
});

test("experiment plan selection uses experiment_plan_id for duplicate names", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-list",
    experimentPlans: [
      {
        experiment_plan_id: "plan-a",
        status: "draft",
        config: { name: "同名方案", steps: 1, samples: 1 }
      },
      {
        experiment_plan_id: "plan-b",
        status: "draft",
        config: { name: "同名方案", steps: 2, samples: 1 }
      }
    ]
  });

  try {
    await runtime.flush();
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-select="plan-a"/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-select="plan-b"/);

    await runtime.change(
      "[data-experiment-plan-select]",
      { experimentPlanSelect: "plan-a" },
      { checked: true, type: "checkbox" }
    );

    const selectedRows = runtime.appNode.innerHTML.match(/selected-table-row/g) || [];
    assert.equal(selectedRows.length, 1);
    assert.match(runtime.appNode.innerHTML, /data-experiment-plan-select="plan-a" checked/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-plan-select="plan-b" checked/);
  } finally {
    runtime.restore();
  }
});

test("Mesa Monte Carlo setting changes do not rerender before the run click", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: createRuntimeProjectJson({
      missionProfile: { repeatCycleHours: 6 },
      components: [
        { id: "avionics", name: "航电模块", quantity: 1, failureRate: 0.03, spareType: "航电模块" }
      ],
      reliabilityBlockDiagram: {
        nodes: [{ id: "avionics", name: "航电模块", type: "component", failureRate: 0.03 }],
        edges: []
      }
    })
  });

  try {
    assert.match(runtime.appNode.innerHTML, /蒙特卡洛分析/);
    assert.match(runtime.appNode.innerHTML, /data-lite-mesa-field="samples"/);

    await runtime.change("[data-lite-mesa-field]", { liteMesaField: "samples" }, { value: "3", type: "number" });

    assert.doesNotMatch(runtime.appNode.innerHTML, /设置已更新，等待重新运行 Mesa 分析/);

    await runtime.click("[data-lite-mesa-action='run']");

    assert.match(runtime.appNode.innerHTML, /分析完成：3 个样本/);
    assert.match(runtime.appNode.innerHTML, /<td>mission_success_rate<\/td>/);
    assert.match(runtime.appNode.innerHTML, /<td>3<\/td>/);
  } finally {
    runtime.restore();
  }
});

let runtimeImportCounter = 0;

async function setupRuntimeApp({
  hash = "",
  projectJson = createRuntimeProjectJson(),
  importFile = null,
  experimentPlans = [],
  backendProjects = [{
    project_id: "project-runtime",
    experiment_name: "Runtime 项目",
    base_code: "RT",
    summary: "runtime test",
    source_import_id: "runtime-import-template",
    updated_at: "2026-06-26 00:00:00"
  }]
} = {}) {
  const appListeners = {};
  const windowListeners = {};
  const requests = [];
  const downloads = [];
  const objectUrls = new Map();
  const backendProjectCatalog = [...backendProjects];
  const projectPayloads = new Map([[projectJson.project_id || "project-runtime", projectJson]]);
  let createProjectFromImportCount = 0;
  const storage = new Map([
    ["spare-mvp:m4Session", JSON.stringify({ session: { token: "m4-runtime-token" } })]
  ]);
  const appNode = {
    innerHTML: "",
    addEventListener(type, listener) {
      appListeners[type] = listener;
    },
    querySelector() {
      return null;
    }
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL?.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL?.revokeObjectURL;

  globalThis.location = { hash };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners[type] = listener;
    },
    location: globalThis.location
  };
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  };
  globalThis.document = {
    body: {
      append(node) {
        node.parentNode = this;
      }
    },
    querySelector(selector) {
      return selector === "#app" ? appNode : null;
    },
    createElement(tagName) {
      const tag = String(tagName).toLowerCase();
      if (tag === "input") return createRuntimeInput(importFile);
      if (tag === "a") return createRuntimeAnchor(downloads, objectUrls);
      return { style: {}, dataset: {}, remove() {} };
    }
  };
  if (globalThis.URL) {
    globalThis.URL.createObjectURL = (blob) => {
      const objectUrl = `blob:runtime-${objectUrls.size + 1}`;
      objectUrls.set(objectUrl, blob);
      return objectUrl;
    };
    globalThis.URL.revokeObjectURL = (objectUrl) => {
      objectUrls.delete(objectUrl);
    };
  }
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    const method = options.method || "GET";
    if (url === "/import-templates/canonical_platform_case.json") {
      return jsonResponse(MODELING_IMPORT_DEMO_FIXTURE);
    }
    if (url === "/api/auth/session") {
      return jsonResponse({ user: { username: "data", role: "数据管理员" } });
    }
    if (url === "/api/projects" && method === "GET") {
      return jsonResponse({
        projects: backendProjectCatalog
      });
    }
    const projectMatch = url.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && method === "GET") {
      const projectId = decodeURIComponent(projectMatch[1]);
      return jsonResponse(projectPayloads.get(projectId) || projectJson);
    }
    if (url === "/api/projects/project-runtime/experiment-plans" && method === "GET") {
      return jsonResponse({ project_id: "project-runtime", experiment_plans: experimentPlans });
    }
    if (url === "/api/projects/project-runtime/modeling-snapshots" && method === "POST") {
      return jsonResponse({ snapshot_id: "snapshot-runtime-plan" });
    }
    if (url === "/api/projects/project-runtime/experiment-plans" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse({
        experiment_plan_id: "plan-runtime-created",
        config: body.config || {}
      });
    }
    const modelingImportMatch = url.match(/^\/api\/modeling-imports\/([^/]+)$/);
    if (modelingImportMatch && method === "GET") {
      return jsonResponse({ publishedPackage: MODELING_IMPORT_DEMO_FIXTURE });
    }
    if (url === "/api/modeling-imports" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse({ import_id: body.importId || body.import_id || MODELING_IMPORT_DEMO_FIXTURE.importId, status: "saved" });
    }
    const modelingImportPublishMatch = url.match(/^\/api\/modeling-imports\/([^/]+)\/publish$/);
    if (modelingImportPublishMatch && method === "POST") {
      return jsonResponse({ publishedPackage: MODELING_IMPORT_DEMO_FIXTURE });
    }
    const modelingImportCreateProjectMatch = url.match(/^\/api\/modeling-imports\/([^/]+)\/create-project$/);
    if (modelingImportCreateProjectMatch && method === "POST") {
      createProjectFromImportCount += 1;
      const importId = decodeURIComponent(modelingImportCreateProjectMatch[1]);
      const projectId = createProjectFromImportCount === 1
        ? "project-runtime-imported"
        : `project-runtime-imported-copy-${createProjectFromImportCount}`;
      const createdProject = createRuntimeProjectJson({
        project_id: projectId,
        scenarioId: `${projectId}-scenario`,
        experiment: { name: `运行时模板项目 ${createProjectFromImportCount}`, steps: 24, samples: 2, seed: 20260626 },
        missionProfile: {
          name: "运行时任务剖面",
          durationHours: 8,
          sourceImportId: importId,
          compositeTasks: [],
          periodicTasks: []
        }
      });
      projectPayloads.set(projectId, createdProject);
      backendProjectCatalog.unshift({
        project_id: projectId,
        experiment_name: createdProject.experiment.name,
        base_code: "RT",
        summary: `由导入包 ${importId} 生成`,
        source_import_id: importId,
        updated_at: "2026-06-26 00:00:00"
      });
      return jsonResponse({
        sourceImport: { import_id: importId, project_id: projectId },
        savedProject: { project_id: projectId, project_version: "project-v0.1", status: "saved" },
        project: createdProject,
        modelingSnapshot: { snapshot_id: `modeling-snapshot-${projectId}-001`, project_id: projectId, project: createdProject }
      });
    }
    if (url === "/api/projects/validate") {
      return jsonResponse({ ok: true, status: "valid", issues: [] });
    }
    if (url === "/api/projects" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const projectId = body.project_id || "project-runtime";
      projectPayloads.set(projectId, body);
      const catalogEntry = {
        project_id: projectId,
        experiment_name: body.experiment?.name || body.projectInfo?.name || projectId,
        base_code: body.projectInfo?.baseCode || "RT",
        summary: body.projectInfo?.summary || "runtime test",
        source_import_id: body.missionProfile?.sourceImportId || "",
        is_template: Boolean(body.projectInfo?.isTemplate),
        updated_at: "2026-06-26 00:00:00"
      };
      const existingIndex = backendProjectCatalog.findIndex((entry) => entry.project_id === projectId);
      if (existingIndex >= 0) backendProjectCatalog[existingIndex] = { ...backendProjectCatalog[existingIndex], ...catalogEntry };
      else backendProjectCatalog.unshift(catalogEntry);
      return jsonResponse({ project_id: body.project_id || "project-runtime", project_version: "project-v0.1" });
    }
    if (url === "/api/mesa-visualization-runs" && method === "POST") {
      const runId = "independent-mesa-runtime";
      return jsonResponse({
        run_id: runId,
        project_id: "project-runtime",
        scenario_id: "runtime-scenario",
        model_family: "aircraft_support_v1",
        source: "independent_mesa_project",
        status: "succeeded",
        state_series_artifact_id: "runtime-state-series",
        state_series: createRuntimeVisualizationStateSeries(runId)
      });
    }
    if (url === "/api/mesa-analysis-runs" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse(createRuntimeLiteAnalysisResponse(body.analysis_type || "carry_list"));
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };

  await import(`../front/app.js?runtime-app=${Date.now()}-${++runtimeImportCounter}`);
  await flushRuntimeTasks();

  return {
    appNode,
    downloads,
    requests,
    async click(selector, dataset = {}, props = {}) {
      await appListeners.click?.({ target: eventTarget(selector, dataset, props) });
      await flushRuntimeTasks();
    },
    async change(selector, dataset = {}, props = {}) {
      await appListeners.change?.({ target: eventTarget(selector, dataset, props) });
      await flushRuntimeTasks();
    },
    async input(selector, dataset = {}, props = {}) {
      await appListeners.input?.({ target: eventTarget(selector, dataset, props) });
      await flushRuntimeTasks();
    },
    async setHash(nextHash) {
      globalThis.location.hash = nextHash;
      globalThis.window.location = globalThis.location;
      windowListeners.hashchange?.();
      await flushRuntimeTasks();
    },
    async flush() {
      await flushRuntimeTasks();
    },
    restore() {
      if (globalThis.URL) {
        if (previousCreateObjectURL === undefined) delete globalThis.URL.createObjectURL;
        else globalThis.URL.createObjectURL = previousCreateObjectURL;
        if (previousRevokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
        else globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
      }
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      globalThis.location = previousLocation;
      globalThis.localStorage = previousLocalStorage;
      globalThis.fetch = previousFetch;
    }
  };
}

function createRuntimeInput(importFile) {
  const listeners = {};
  const input = {
    type: "",
    accept: "",
    dataset: {},
    files: importFile ? [importFile] : [],
    style: {},
    value: "",
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    click() {
      listeners.change?.({ target: input });
    },
    remove() {}
  };
  return input;
}

function createRuntimeAnchor(downloads, objectUrls) {
  return {
    href: "",
    download: "",
    style: {},
    click() {
      downloads.push({
        href: this.href,
        download: this.download,
        blob: objectUrls.get(this.href)
      });
    },
    remove() {}
  };
}

function eventTarget(selector, dataset = {}, props = {}) {
  return {
    dataset,
    files: props.files || [],
    value: props.value ?? "",
    checked: Boolean(props.checked),
    type: props.type || "",
    tagName: props.tagName || "",
    selectedOptions: props.selectedOptions || [],
    closest(candidate) {
      return candidate === selector ? this : null;
    }
  };
}

async function flushRuntimeTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createRuntimeProjectJson(overrides = {}) {
  const project = JSON.parse(JSON.stringify(defaultScenario));
  Object.assign(project, {
    project_id: "project-runtime",
    scenarioId: "runtime-scenario",
    activeModule: "sparePlanning",
    experiment: { name: "运行时项目", steps: 24, samples: 2, seed: 20260626 },
    missionProfile: { name: "运行时任务剖面", durationHours: 8, compositeTasks: [], periodicTasks: [] },
    basicMissions: [{
      id: "basic-runtime",
      name: "运行时基本任务",
      equipmentType: "J-15",
      taskDurationMinutes: 90,
      minRequiredSorties: 1
    }],
    equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
    supportNodes: [{
      id: "carrier-deck",
      name: "航母飞行甲板",
      personnelModel: "机务",
      personnelCapacity: 10,
      supportEquipmentName: "检测仪",
      supportEquipmentModel: "JY-01",
      equipmentCapacity: 8,
      inventory: { 航电模块: 3 },
      spareModels: { 航电模块: "HD-01" }
    }],
    supportActivities: [{
      id: "ops-runtime-1",
      activityType: "使用保障",
      planType: "直接准备方案",
      planGroupId: "ops-runtime",
      activityName: "J-15直接准备方案",
      aircraftModel: "J-15",
      durationHours: 1,
      jobs: [{
        activityCode: "BA-001",
        workName: "初始工作项目",
        predecessors: [],
        durationMinutes: 20,
        personnel: "机务人员,1",
        equipment: "检测仪,1",
        spare: "航电模块"
      }]
    }]
  });
  return {
    ...project,
    ...overrides,
    experiment: { ...project.experiment, ...(overrides.experiment || {}) },
    missionProfile: { ...project.missionProfile, ...(overrides.missionProfile || {}) },
    basicMissions: overrides.basicMissions || project.basicMissions,
    equipment: { ...project.equipment, ...(overrides.equipment || {}) }
  };
}

function createRuntimeVisualizationStateSeries(runId = "independent-mesa-runtime") {
  const trace = {
    run_id: runId,
    scenario_id: "runtime-scenario",
    scenario_version: "project-v0.1",
    result_summary_id: "runtime-result-summary",
    artifact_manifest_id: "runtime-artifact-manifest",
    run_config_artifact_id: "runtime-run-config",
    input_project_artifact_id: "runtime-input-project",
    compiled_scenario_artifact_id: "runtime-compiled-scenario"
  };
  return {
    schema_version: "visualization-state-series-v0",
    run_id: runId,
    scenario_id: "runtime-scenario",
    scenario_version: "project-v0.1",
    model_family: "aircraft_support_v1",
    artifact_manifest_id: trace.artifact_manifest_id,
    result_summary_id: trace.result_summary_id,
    run_config_artifact_id: trace.run_config_artifact_id,
    input_project_artifact_id: trace.input_project_artifact_id,
    compiled_scenario_artifact_id: trace.compiled_scenario_artifact_id,
    frames: [{
      run_id: runId,
      step: 0,
      simulation_time: 0,
      trace,
      snapshot: {
        elapsed_hours: 0,
        aircraft_count: 2,
        available_aircraft: 1,
        planned_sorties: 2,
        completed_sorties: 1,
        active_jobs: 0,
        spare_stock_total: 1,
        sortie_completion_rate: 0.5
      },
      aircraft_state: {},
      mission_state: {},
      resource_state: {},
      event_summary: {},
      aircraft: [
        { tail_number: "J15-101", type: "J-15", state: "available", x: 0, y: 0, systems: [] },
        { tail_number: "J15-102", type: "J-15", state: "maintenance", x: 1, y: 0, systems: [] }
      ],
      missions: [{
        mission_id: "runtime-mission",
        name: "运行时任务",
        required_aircraft: 2,
        assigned_tail_numbers: ["J15-101"],
        status: "launched"
      }],
      resources: [],
      spares: [
        { part_id: "spare-ready", name: "可用备件", quantity: 1 },
        { part_id: "spare-empty", name: "缺货备件", quantity: 0 }
      ],
      jobs: [],
      events: []
    }]
  };
}

function createRuntimeLiteAnalysisResponse(analysisType = "carry_list") {
  const rowsByType = {
    carry_list: [{
      spareType: "aircraft_support_v1_spares",
      recommended: 1,
      demand: 28,
      shortage: 0,
      riskLevel: "低",
      confidenceTarget: 0.9
    }],
    spare_shortfall: [{
      spareType: "aircraft_support_v1_spares",
      demand: 28,
      filled: 28,
      shortage: 0,
      fillRate: 1,
      riskLevel: "低"
    }],
    mission_reliability: [{
      sequence: 1,
      seed: 20260621,
      missionSuccessRate: 1,
      sortieRate: 1,
      readyRate: 1
    }],
    downtime_factors: [{
      label: "无停机因素",
      reason: "none",
      count: 0,
      contribution: 0
    }]
  };
  return {
    status: "session_complete",
    source: "lite_mesa_aircraft_support_v1",
    analysis_type: analysisType,
    sample_count: 27,
    seed_list: [20260621],
    metrics: [["样本数", "27"], ["建议携行总数", "1"]],
    rows: rowsByType[analysisType] || rowsByType.carry_list,
    limitations: [
      "会话内 Mesa 分析结果，不写入正式结果账本。",
      "未创建 run、result 或 artifact。",
      "结论只代表当前项目建模粒度和样本设置。"
    ]
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}
