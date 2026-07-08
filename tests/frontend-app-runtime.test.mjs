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
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1"
      }],
      modelingDictionaries: {
        personnelSpecialties: ["航电", "机械"]
      },
      supportResources: [{
        id: "support-resource-base-1-personnel",
        supportNodeName: "基层1",
        type: "personnel",
        name: "基层1人员",
        model: "机械",
        quantity: 1
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

    await runtime.click("[data-project-draft-save]");
    const savedProject = await waitForProjectSave(runtime, (body) => (
      (body.supportResources || []).some((resource) => (
        resource.type === "personnel"
        && resource.supportNodeName === "基层1"
        && resource.model === "航电"
      ))
    ), "expected added support personnel specialty to be persisted");
    const savedPersonnelModels = savedProject.supportResources
      .filter((resource) => resource.type === "personnel" && resource.supportNodeName === "基层1")
      .map((resource) => resource.model);
    assert.deepEqual(savedPersonnelModels.sort(), ["机械", "航电"].sort());
    assert.ok(savedPersonnelModels.every(Boolean));
  } finally {
    runtime.restore();
  }
});

test("support equipment resource name and model stay editable on the equipment page", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      supportOrganization: {
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1"
      }],
      supportResources: [{
        id: "support-resource-base-1-equipment",
        supportNodeName: "基层1",
        type: "equipment",
        name: "旧检测仪",
        model: "OLD-01",
        quantity: 1
      }]
    })
  });
  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-support-equipment");
    await runtime.click("[data-select-support-org-node]", { selectSupportOrgNode: "base-1" });

    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-resource-field="name"[^>]*disabled/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-support-resource-field="model"[^>]*disabled/);

    await runtime.change(
      "[data-support-resource-field]",
      { supportResourceKey: "support-resource-base-1-equipment", supportResourceField: "name" },
      { value: "新检测仪" }
    );
    await runtime.change(
      "[data-support-resource-field]",
      { supportResourceKey: "support-resource-base-1-equipment", supportResourceField: "model" },
      { value: "NEW-02" }
    );

    assert.match(runtime.appNode.innerHTML, /value="新检测仪"/);
    assert.match(runtime.appNode.innerHTML, /value="NEW-02"/);
  } finally {
    runtime.restore();
  }
});

test("support spare resource page derives default rows from equipment hardware tree", async () => {
  const projectId = "support-spares-from-hardware-runtime";
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      project_id: projectId,
      supportOrganization: {
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1"
      }],
      components: [
        { id: "engine-control", name: "发动机控制模块", model: "ECU-1", aircraftModel: "J-15", parentId: "engine", productType: "LRU", spareType: "发动机备件" },
        { id: "radar-lru", name: "雷达 LRU", model: "RAD-1", aircraftModel: "J-15", parentId: "avionics", productType: "LRU", spareType: "航电模块" },
        { id: "hydraulic-sru", name: "液压执行器", model: "HYD-SRU", aircraftModel: "J-15", parentId: "hydraulic", productType: "SRU" }
      ],
      supportResources: [
        { id: "old-engine-spare", supportNodeName: "基层1", type: "spare", name: "发动机备件", model: "发动机备件", quantity: 4 },
        { id: "old-hydraulic-spare", supportNodeName: "基层1", type: "spare", name: "液压备件", model: "液压备件", quantity: 6 },
        { id: "old-avionics-spare", supportNodeName: "基层1", type: "spare", name: "航电模块", model: "航电模块", quantity: 8 }
      ]
    }),
    backendProjects: [{
      project_id: projectId,
      experiment_name: "硬件树备件项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "runtime-import-template",
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId });
    await runtime.setHash("feature=spare-planning-spare-part");

    assert.match(runtime.appNode.innerHTML, /发动机控制模块/);
    assert.match(runtime.appNode.innerHTML, /雷达 LRU/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /发动机备件|液压备件|航电模块/);
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

test("periodic task editor keeps total task fields on left and saves weekly details", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    missionProfile: {
      name: "运行时任务剖面",
      durationHours: 8,
      compositeTasks: [
        { id: "composite-day", name: "昼间出动", taskItems: [] },
        { id: "composite-night", name: "夜间警戒", taskItems: [] }
      ],
      periodicTasks: [{
        id: "periodic-runtime",
        parentTaskName: "旧总任务",
        name: "旧周期性任务名",
        repeatWeeks: 2,
        compositeTasks: [
          { weekIndex: 1, weekday: "mondayCompositeTaskId", compositeTaskId: "composite-day" },
          { weekIndex: 2, weekday: "tuesdayCompositeTaskId", compositeTaskId: "composite-night" }
        ]
      }]
    }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-periodic-task",
    projectJson
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /总任务名称/);
    assert.match(runtime.appNode.innerHTML, /总周数/);
    assert.match(runtime.appNode.innerHTML, /value="旧总任务"/);
    assert.match(runtime.appNode.innerHTML, /第1周/);
    assert.match(runtime.appNode.innerHTML, /第2周/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /上级任务名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /周期性任务名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /每周天数/);

    await runtime.input("[data-periodic-field]", { periodicField: "parentTaskName" }, { value: "舰载机总任务" });
    await runtime.input("[data-periodic-field]", { periodicField: "repeatWeeks" }, { value: "3" });
    await runtime.click("[data-periodic-select-week]", { periodicSelectWeek: "3" });
    assert.match(runtime.appNode.innerHTML, /第3周/);

    await runtime.input("[data-periodic-field]", { periodicField: "weekComposite:14" }, { value: "composite-night" });
    await runtime.click("[data-project-draft-save]");

    const savedProject = await waitForProjectSave(runtime, (body) => {
      const periodicTask = body.missionProfile?.periodicTasks?.[0];
      return periodicTask
        && !("parentTaskName" in periodicTask)
        && periodicTask.repeatWeeks === 3
        && periodicTask.cycleDays === 7
        && !("durationHours" in body.missionProfile)
        && periodicTask.compositeTasks.some((row) => (
          row.weekIndex === 3
            && row.weekday === "mondayCompositeTaskId"
            && row.compositeTaskId === "composite-night"
        ));
    }, "expected periodic task edits to save canonical Project draft fields");

    assert.equal(savedProject.missionProfile.periodicTasks[0].name, "旧周期性任务名");
  } finally {
    runtime.restore();
  }
});

test("modeling granularity page switches locked field presets", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-modeling-granularity-management"
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /建模颗粒度配置/);
    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="full-elements" aria-pressed="true"/);
    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="equipment-rms" aria-pressed="false"/);
    assert.match(runtime.appNode.innerHTML, /全要素/);
    assert.match(runtime.appNode.innerHTML, /装备RMS/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /颗粒度 A|颗粒度 B/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /导入包维护/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-import-action/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-field-select="equipment-system:mtbfHours" checked disabled/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-field-select="basic-support-activity:resourceIds" checked disabled/);

    await runtime.click("[data-granularity-profile-select]", { granularityProfileSelect: "equipment-rms" });

    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="full-elements" aria-pressed="false"/);
    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="equipment-rms" aria-pressed="true"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-field-select="equipment-system:mtbfHours" checked disabled/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-field-select="reliability-block-diagram:reliabilityParameter" checked disabled/);
    const excludedEquipmentRmsFields = [
      "support-organization-structure:nodeId",
      "support-organization-structure:nodeName",
      "support-organization-structure:nodeType",
      "support-organization-structure:airport",
      "support-organization-structure:organizationStrategy",
      "spares:spareId",
      "spares:spareName",
      "spares:equipmentId",
      "spares:stockQty",
      "spares:supportNodeName",
      "support-personnel:personnelType",
      "support-personnel:specialty",
      "support-personnel:nodeId",
      "support-personnel:capacity",
      "support-personnel:resourceName",
      "support-equipment:resourceId",
      "support-equipment:resourceName",
      "support-equipment:nodeId",
      "support-equipment:quantity",
      "support-equipment:availability",
      "basic-support-activity:activityId",
      "basic-support-activity:activityName",
      "basic-support-activity:aircraftModel",
      "basic-support-activity:durationHours",
      "basic-support-activity:resourceIds",
      "operations-support-activity:planType",
      "operations-support-activity:waveId",
      "operations-support-activity:preparationMinutes",
      "operations-support-activity:resourcePackage",
      "operations-support-activity:predecessors",
      "preventive-maintenance-activity:cycle",
      "preventive-maintenance-activity:maintenanceItem",
      "preventive-maintenance-activity:intervalHours",
      "preventive-maintenance-activity:personnelDemand",
      "preventive-maintenance-activity:spareDemand",
      "corrective-maintenance-activity:failureItem",
      "corrective-maintenance-activity:repairHours",
      "corrective-maintenance-activity:repairResources",
      "corrective-maintenance-activity:replacementParts",
      "corrective-maintenance-activity:restoreCondition",
      "logistics-support-activity:logisticsTaskId",
      "logistics-support-activity:sourceNodeId",
      "logistics-support-activity:targetNodeId",
      "logistics-support-activity:transportHours",
      "logistics-support-activity:supplyQuantity"
    ];
    for (const fieldKey of excludedEquipmentRmsFields) {
      assert.ok(
        runtime.appNode.innerHTML.includes(`data-modeling-field-select="${fieldKey}" disabled`),
        `${fieldKey} should stay visible but unchecked in equipment RMS granularity`
      );
      assert.equal(
        runtime.appNode.innerHTML.includes(`data-modeling-field-select="${fieldKey}" checked`),
        false,
        `${fieldKey} should not be selected in equipment RMS granularity`
      );
    }

    await runtime.click("[data-modeling-field-select]", { modelingFieldSelect: "basic-support-activity:resourceIds" }, { checked: true });

    assert.match(runtime.appNode.innerHTML, /字段勾选由当前建模颗粒度自动维护/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-field-select="basic-support-activity:resourceIds" checked/);
  } finally {
    runtime.restore();
  }
});

test("equipment RMS granularity locks excluded modeling pages while keeping equipment editable", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-modeling-granularity-management",
    projectJson: createRuntimeProjectJson({
      supportOrganization: {
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "base-1", name: "基层1", children: [] }
          ]
        }
      },
      supportNodes: [{
        id: "support-node-base-1",
        name: "基层1"
      }],
      supportResources: [{
        id: "runtime-personnel-1",
        supportNodeName: "基层1",
        type: "personnel",
        name: "机务人员",
        model: "机务",
        quantity: 10
      }]
    })
  });

  try {
    await runtime.click("[data-granularity-profile-select]", { granularityProfileSelect: "equipment-rms" });
    await runtime.setHash("feature=spare-planning-support-personnel");
    await runtime.click("[data-select-support-org-node]", { selectSupportOrgNode: "base-1" });

    assert.match(runtime.appNode.innerHTML, /当前建模颗粒度未启用该表，建模内容只读。/);
    assert.match(runtime.appNode.innerHTML, /data-support-resource-add="保障人员"[^>]*disabled/);
    assert.match(runtime.appNode.innerHTML, /data-support-resource-field="model"[^>]*disabled/);

    const personnelRowsBefore = (runtime.appNode.innerHTML.match(/data-support-resource-field="model"/g) || []).length;
    await runtime.click("[data-support-resource-add]", { supportResourceAdd: "保障人员" });
    assert.equal((runtime.appNode.innerHTML.match(/data-support-resource-field="model"/g) || []).length, personnelRowsBefore);

    await runtime.change(
      "[data-support-resource-field]",
      { supportResourceKey: "runtime-personnel-1", supportResourceField: "model" },
      { value: "航电" }
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="航电" selected>航电<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="机务" selected>机务<\/option>/);

    await runtime.setHash("feature=spare-planning-basic-support-activity");

    assert.match(runtime.appNode.innerHTML, /当前建模颗粒度未启用该表，建模内容只读。/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-add[^>]*disabled/);
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-edit="0:0"[^>]*disabled/);

    const basicActivityEditorsBefore = (runtime.appNode.innerHTML.match(/data-basic-activity-key=/g) || []).length;
    await runtime.click("[data-basic-activity-add]");
    assert.equal((runtime.appNode.innerHTML.match(/data-basic-activity-key=/g) || []).length, basicActivityEditorsBefore);

    await runtime.setHash("feature=spare-planning-equipment-system");

    assert.doesNotMatch(runtime.appNode.innerHTML, /当前建模颗粒度未启用该表，建模内容只读。/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-path="equipment.quantity"[^>]*disabled/);
  } finally {
    runtime.restore();
  }
});

test("modeling form management only renders personnel dictionary and time unit fields", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-modeling-form-management",
    sessionUser: { username: "admin", role: "系统管理员" },
    projectJson: createRuntimeProjectJson({
      modelingDictionaries: {
        personnelSpecialties: ["机务", "航电"]
      }
    })
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /保障人员专业字典/);
    assert.match(runtime.appNode.innerHTML, /data-personnel-specialty-dictionary/);
    assert.match(runtime.appNode.innerHTML, /带时间单位的表单字段/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-management/);
    assert.match(runtime.appNode.innerHTML, /class="modeling-field-config modeling-form-config-grid" data-modeling-form-management/);
    assert.match(runtime.appNode.innerHTML, /<section class="modeling-config-card" data-personnel-specialty-dictionary>/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-unit="equipment-system:mtbfHours"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-unit="equipment-system:mttrMinutes"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-unit="basic-mission:durationMinutes"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-unit="logistics-support-activity:transportHours"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-form-unit="equipment-system:componentName"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-form-unit="support-personnel:resourceName"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-form-unit="spares:spareName"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-form-unit="composite-task:minRequiredSystems"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /组件名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /资源名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /备件名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /最小装备数量/);
  } finally {
    runtime.restore();
  }
});

test("visual Mesa page renders restored title frame with decimal KPI values", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.flush();

    assert.match(runtime.appNode.innerHTML, /data-mesa-control="play"/);
    const visualHero = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(visualHero, /<h3>可视化推演<\/h3>/);
    assert.match(visualHero, /data-current-experiment-plan/);
    await runtime.click("[data-mesa-control]", { mesaControl: "start-new-run" });
    assert.match(runtime.appNode.innerHTML, /飞机状态一览/);
    assert.match(runtime.appNode.innerHTML, /<svg class="availability-trend-svg" viewBox="0 0 960 120"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<svg viewBox="0 0 360 120"/);
    assert.match(runtime.appNode.innerHTML, /<span>使用可用度<\/span><strong>0\.50<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<span>出动架次率<\/span><strong>0\.50<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<span>备件满足率<\/span><strong>0\.50<\/strong>/);
    await runtime.click("[data-mesa-view]", { mesaView: "support" });
    assert.match(runtime.appNode.innerHTML, /保障人员（按专业）/);
    assert.match(runtime.appNode.innerHTML, /机务人员/);
    assert.match(runtime.appNode.innerHTML, /专业：机务/);
    assert.match(runtime.appNode.innerHTML, /保障设备（按类型）/);
    assert.match(runtime.appNode.innerHTML, /检测仪/);
    assert.match(runtime.appNode.innerHTML, /类型：JY-01/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /飞机保障独立 Mesa 仿真/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /点击可视化推演后直接读取当前 Project/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<div class="mesa-clock"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /独立 Mesa/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<strong>0%<\/strong>|<strong>100%<\/strong>/);
  } finally {
    runtime.restore();
  }
});

test("visual support selector follows modeled support nodes instead of combat unit airport labels", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson({
      combatUnit: {
        members: [
          { aircraftNo: "J15-101", model: "J-15", airport: "甲机场" },
          { aircraftNo: "J15-102", model: "J-15", airport: "甲机场" }
        ]
      },
      supportNodes: [
        {
          id: "carrier-deck",
          name: "航母飞行甲板",
          personnelModel: "机务",
          personnelCapacity: 10,
          supportEquipmentName: "检测仪",
          supportEquipmentModel: "JY-01",
          equipmentCapacity: 8,
          inventory: { 航电模块: 3 }
        },
        {
          id: "forward-sea-base",
          name: "前出海上保障点",
          personnelModel: "航电",
          personnelCapacity: 4,
          supportEquipmentName: "电源车",
          supportEquipmentModel: "DY-01",
          equipmentCapacity: 2,
          inventory: { 航电模块: 1 }
        }
      ]
    })
  });

  try {
    await runtime.click("[data-mesa-control]", { mesaControl: "start-new-run" });
    await runtime.click("[data-mesa-view]", { mesaView: "support" });

    assert.match(runtime.appNode.innerHTML, /当前保障点资源/);
    assert.match(runtime.appNode.innerHTML, /<option value="航母飞行甲板" selected>航母飞行甲板<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="前出海上保障点" >前出海上保障点<\/option>/);
    assert.match(runtime.appNode.innerHTML, /航母飞行甲板 \/ 建模保障点 航母飞行甲板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="甲机场"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /甲机场 \/ 保障点/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板 \/ 保障点 航母飞行甲板、前出海上保障点/);
  } finally {
    runtime.restore();
  }
});

test("visual support selector prefers support organization leaves over resource rows", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-visual-mesa-page",
    projectJson: createRuntimeProjectJson({
      supportOrganization: {
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "org-base", name: "基地", supportNodeId: "carrier-deck", children: [] },
            { id: "org-relay", name: "中继", supportNodeId: "forward-sea-base", children: [] },
            { id: "carrier-stock", name: "基层", supportNodeId: "carrier-stock", children: [] }
          ]
        }
      },
      supportNodes: [
        { id: "carrier-deck", name: "基地" },
        { id: "forward-sea-base", name: "中继" },
        { id: "carrier-stock", name: "基层" }
      ],
      supportResources: [
        { id: "support-resource-1", supportNodeName: "基层", type: "personnel", name: "机务组", model: "机械", quantity: 2 },
        { id: "support-resource-2", supportNodeName: "基层", type: "personnel", name: "航电保障人员", model: "航电", quantity: 3 },
        { id: "support-resource-3", supportNodeName: "基层", type: "equipment", name: "电源车", model: "通用", quantity: 2 },
        { id: "support-resource-4", supportNodeName: "基地", type: "equipment", name: "检测仪", model: "通用", quantity: 1 }
      ]
    })
  });

  try {
    await runtime.click("[data-mesa-control]", { mesaControl: "start-new-run" });
    await runtime.click("[data-mesa-view]", { mesaView: "support" });

    assert.match(runtime.appNode.innerHTML, /<option value="基地" selected>基地<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="中继" >中继<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="基层" >基层<\/option>/);
    assert.match(runtime.appNode.innerHTML, /基地 \/ 建模保障点 基地/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="mechanic-team"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="test-equipment"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="航母飞行甲板" selected>航母飞行甲板<\/option>/);

    await runtime.change("[data-mesa-support-airport]", {}, { value: "基层" });

    assert.match(runtime.appNode.innerHTML, /<option value="基层" selected>基层<\/option>/);
    assert.match(runtime.appNode.innerHTML, /基层 \/ 建模保障点 基层/);
    assert.match(runtime.appNode.innerHTML, /专业：机械/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="support-resource-1"/);
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
      assert.match(runtime.appNode.innerHTML, /分析设定/);
      assert.match(runtime.appNode.innerHTML, /分析结果明细/);
      assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>/);
      assert.match(runtime.appNode.innerHTML, /尚未运行分析/);
      assert.doesNotMatch(runtime.appNode.innerHTML, /lite-mesa-source-grid/);
      assert.doesNotMatch(runtime.appNode.innerHTML, /输出边界|持久化/);
      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      assert.match(settingsPanel, /样本量 \/ 随机种子只读/);
      assert.match(settingsPanel, /样本量[\s\S]*<strong>27<\/strong>/);
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>20260621<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
      assert.doesNotMatch(settingsPanel, /实验类型|统计口径/);
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

test("spare shortfall analysis uses the shared read-only analysis setting line", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-spare-shortfall-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.match(runtime.appNode.innerHTML, /class="lite-mesa-settings lite-mesa-analysis-settings"/);
    assert.match(runtime.appNode.innerHTML, /class="lite-mesa-stat-section lite-mesa-analysis-detail"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /full-settings/);
    assert.match(settingsPanel, /样本量[\s\S]*<strong>27<\/strong>/);
    assert.match(settingsPanel, /随机种子[\s\S]*<strong>20260621<\/strong>/);
    assert.match(settingsPanel, /当前项目建模数据/);
    assert.match(settingsPanel, /短缺事件统计/);
    assert.doesNotMatch(settingsPanel, /<input|<select|type="number"/);
    assert.doesNotMatch(settingsPanel, /实验类型|统计口径/);
    assert.doesNotMatch(settingsPanel, /project_baseline_at_current_granularity/);
    assert.doesNotMatch(settingsPanel, /用户参数|无可调参数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /lite-mesa-source-grid|<span>输出边界<\/span>|<span>持久化<\/span>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /lite-mesa-hero-meter/);
  } finally {
    runtime.restore();
  }
});

test("spare shortfall analysis renders average delay hours and hides session chrome", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-spare-shortfall-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    assert.match(runtime.appNode.innerHTML, /分析结果明细/);
    assert.match(runtime.appNode.innerHTML, /基于当前项目建模数据的短缺事件统计/);
    assert.match(runtime.appNode.innerHTML, /平均备件延误时间\(h\)/);
    assert.match(runtime.appNode.innerHTML, /因维修延误导致的任务取消次数/);
    assert.match(runtime.appNode.innerHTML, />1\.50</);
    assert.match(runtime.appNode.innerHTML, /航电模块/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /会话内 Mesa|会话内结果明细|建模粒度不足时不会伪造结论|总缺件次数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<th>缺件次数<\/th>|<td>6222<\/td>/);
  } finally {
    runtime.restore();
  }
});

test("experiment plan management hides page-level current project context", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /方案列表/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /page-head-current-context/);
  } finally {
    runtime.restore();
  }
});

test("carry list analysis renames the mission confidence field", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const hero = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.doesNotMatch(hero, /在给定置信度约束下探索建议携行数量、优先级和风险项。/);
    assert.match(settingsPanel, /置信度目标[\s\S]*data-lite-mesa-analysis-field="missionConfidenceTarget"[\s\S]*value="0\.9"/);
    assert.match(settingsPanel, /目标函数[\s\S]*携行备件总量最小/);
    assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
    assert.doesNotMatch(settingsPanel, /任务置信目标/);

    await runtime.change(
      "[data-lite-mesa-analysis-field]",
      { liteMesaAnalysisField: "missionConfidenceTarget" },
      { value: "0.82" }
    );
    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisRun.settings.missionConfidenceTarget, 0.82);
  } finally {
    runtime.restore();
  }
});

test("task reliability analysis embeds experiment plan selector in its title frame", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const hero = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(hero, /<h3>任务可靠度评估<\/h3>/);
    assert.match(hero, /data-current-experiment-plan/);
    assert.match(hero, /实验方案/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<div class="page-head">[\s\S]*data-current-experiment-plan/);
  } finally {
    runtime.restore();
  }
});

test("task reliability analysis renders mission wave average mission success line chart", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    assert.match(runtime.appNode.innerHTML, /任务波次平均成功率/);
    assert.match(runtime.appNode.innerHTML, /class="line-chart"/);
    assert.match(runtime.appNode.innerHTML, /line-chart-y-axis/);
    assert.match(runtime.appNode.innerHTML, /任务失败次数/);
    assert.match(runtime.appNode.innerHTML, /任务失败次数[\s\S]*<strong>3<\/strong>/);
    assert.match(runtime.appNode.innerHTML, />1\.0<\/text>/);
    assert.match(runtime.appNode.innerHTML, />0\.5<\/text>/);
    assert.match(runtime.appNode.innerHTML, />0\.0<\/text>/);
    assert.match(runtime.appNode.innerHTML, /第1天/);
    assert.match(runtime.appNode.innerHTML, /0\.750/);
    assert.match(runtime.appNode.innerHTML, /0\.500/);
    assert.match(runtime.appNode.innerHTML, /<details class="lite-mesa-collapsible-table">/);
    assert.match(runtime.appNode.innerHTML, /<summary>样本明细/);
    assert.match(runtime.appNode.innerHTML, /任务波次/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<th>seed<\/th>|row\.seed/);
  } finally {
    runtime.restore();
  }
});

test("downtime factors analysis omits snapshot capability setting", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-downtime-factor-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.match(settingsPanel, /排序范围[\s\S]*data-lite-mesa-analysis-field="topN"[\s\S]*value="4"/);
    assert.doesNotMatch(settingsPanel, /实验类型|统计口径/);
    assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
    assert.doesNotMatch(settingsPanel, /快照能力|会话内只读解释/);
  } finally {
    runtime.restore();
  }
});

test("carry list analysis result omits boundary explanation card", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "carry_list");
    assert.ok(analysisRun, "carry list analysis should submit a lightweight Mesa analysis request");
    assert.equal(analysisRun.model_family, "aircraft_support_v1");
    assert.equal(analysisRun.settings.missionConfidenceTarget, 0.9);
    assert.match(runtime.appNode.innerHTML, /分析结果已生成|分析完成/);
    const detailPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-analysis-detail");
    assert.doesNotMatch(detailPanel, /置信度目标|样本数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /边界说明/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /正式 current-analysis|正式 run artifact/);
  } finally {
    runtime.restore();
  }
});

test("downtime factors analysis enables log snapshots and renders event snapshots", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-downtime-factor-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "downtime_factors");
    assert.ok(analysisRequest, "downtime analysis should submit a lightweight Mesa analysis request");
    assert.equal(analysisRequest.model_family, "aircraft_support_v1");
    assert.equal(analysisRequest.settings.topN, 4);
    assert.match(runtime.appNode.innerHTML, /分析结果已生成|分析完成/);
    const detailPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-analysis-detail");
    assert.doesNotMatch(detailPanel, /样本数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /正式 current-analysis/);
    assert.match(runtime.appNode.innerHTML, /停机事件一览/);
    assert.match(runtime.appNode.innerHTML, /备件短缺/);
    assert.match(runtime.appNode.innerHTML, /repair-J15-101/);
    assert.match(runtime.appNode.innerHTML, /mission_delayed_by_spare_shortage/);
    assert.match(runtime.appNode.innerHTML, /<details class="lite-mesa-event-snapshot" open>/);
  } finally {
    runtime.restore();
  }
});

test("experiment and analysis pages render when Project draft has no root experiment config", async () => {
  const featureExpectations = [
    ["spare-planning-experiment-plan-management", /方案列表/],
    ["spare-planning-monte-carlo-experiment-detail", /蒙特卡洛分析/],
    ["spare-planning-spare-shortfall-analysis", /分析设定/]
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
    const templateCopySaveRequests = projectSaveRequests.filter((request) => {
      const body = JSON.parse(request.options.body || "{}");
      return /^project-runtime-template-copy-\d+$/.test(String(body.project_id || ""));
    });
    assert.equal(templateCopySaveRequests.length, 2);
    assert.ok(templateCopySaveRequests.every((request) => {
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
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
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
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.click("[data-select-equipment-aircraft]", { selectEquipmentAircraft: "J-15" });
    await runtime.change("[data-equipment-aircraft-model]", { equipmentAircraftModel: "J-15" }, { value: "J-20" });
    await runtime.click("[data-project-draft-save]");

    const savedProject = await waitForProjectSave(runtime, (body) => (
      body.equipment?.model === "J-20"
      && body.components?.[0]?.aircraftModel === "J-20"
    ), "expected a saved Project draft with renamed aircraft model");
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
  const projectId = "support-activity-add-runtime";
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({ project_id: projectId }),
    backendProjects: [runtimeBackendProjectEntry(projectId, "保障活动新增项目")]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId });
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
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
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

    assert.match(runtime.appNode.innerHTML, /新增弹窗活动/);
    assert.deepEqual(
      Array.from(runtime.appNode.innerHTML.matchAll(/<td>(BA-\d+)<\/td>/g)).map((match) => match[1]).sort(),
      ["BA-001", "BA-002"]
    );
  } finally {
    runtime.restore();
  }
});

test("basic support activity UI reads and writes top-level job table references", async () => {
  const projectId = "basic-activity-job-runtime";
  const projectJson = createRuntimeProjectJson({ project_id: projectId });
  const runtime = await setupRuntimeApp({
    projectJson,
    backendProjects: [runtimeBackendProjectEntry(projectId, "基本保障活动作业项目")]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    await waitForRuntimeHtml(runtime, /初始工作项目/, "expected runtime project support activity rows to load");
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "0:0", basicActivityField: "workName" },
      { value: "顶层作业表编辑" }
    );
    assert.match(runtime.appNode.innerHTML, /顶层作业表编辑/);

    await runtime.click("[data-project-draft-save]");
    const savedProject = await waitForProjectSave(runtime, (body) => (
      body.supportActivityJobs?.[0]?.workName === "顶层作业表编辑"
        && body.supportActivities?.[0]?.activityCodes?.[0] === "BA-001"
    ), "expected support activity UI to persist top-level job table edits");
    assert.equal(savedProject.supportActivities[0].jobs, undefined);
    assert.deepEqual(savedProject.supportActivities[0].predecessors, { "BA-001": [] });
  } finally {
    runtime.restore();
  }
});

test("basic support activity library filters rows by selected activity type", async () => {
  const projectJson = createRuntimeProjectJson();
  projectJson.supportActivities.push(
    {
      id: "preventive-runtime",
      activityType: "预防性维修",
      planType: "预防性维修方案",
      activityName: "J-15定检方案",
      aircraftModel: "J-15",
      activityCodes: [],
      predecessors: {}
    },
    {
      id: "corrective-runtime",
      activityType: "修复性维修",
      planType: "修复性维修方案",
      activityName: "部件修复方案",
      equipmentId: "component-x",
      activityCodes: [],
      predecessors: {}
    }
  );
  appendRuntimeSupportActivityJob(projectJson, 1, {
    activityCode: "PM-900",
    workName: "定检基本保障活动",
    predecessors: [],
    durationMinutes: 40
  });
  appendRuntimeSupportActivityJob(projectJson, 2, {
    activityCode: "CM-900",
    workName: "部件修复作业",
    predecessors: [],
    durationMinutes: 55
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    await waitForRuntimeHtml(runtime, /初始工作项目/, "expected runtime project support activity rows to load");
    assert.match(runtime.appNode.innerHTML, /初始工作项目/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /定检基本保障活动/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件修复作业/);

    await runtime.change("[data-basic-activity-import-type-select]", {}, { value: "修复性维修" });
    assert.match(runtime.appNode.innerHTML, /部件修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /初始工作项目/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /定检基本保障活动/);

    await runtime.change("[data-basic-activity-import-type-select]", {}, { value: "预防性维修" });
    assert.match(runtime.appNode.innerHTML, /定检基本保障活动/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /初始工作项目/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件修复作业/);
  } finally {
    runtime.restore();
  }
});

test("corrective maintenance view uses selected component activities and MTTR", async () => {
  const projectId = "project-corrective-runtime";
  const projectJson = createRuntimeProjectJson({
    project_id: projectId,
    components: [
      {
        id: "aircraft-root",
        name: "J-15",
        aircraftModel: "J-15",
        productType: "whole",
        quantity: 1
      },
      {
        id: "component-a",
        name: "部件A",
        aircraftModel: "J-15",
        parentId: "aircraft-root",
        productType: "LRU",
        quantity: 1,
        failureRate: 0.01,
        repairDistribution: { distributionType: "固定值", value: 42 }
      },
      {
        id: "component-b",
        name: "部件B",
        aircraftModel: "J-15",
        parentId: "aircraft-root",
        productType: "LRU",
        quantity: 1,
        failureRate: 0.01,
        repairDistribution: { distributionType: "固定值", value: 66 }
      }
    ]
  });
  projectJson.supportActivities.push(
    {
      id: "corrective-component-a",
      activityType: "修复性维修",
      planType: "修复性维修方案",
      activityName: "部件A修复性维修方案",
      equipmentId: "component-a",
      activityCodes: ["CM-A"],
      predecessors: { "CM-A": [] }
    },
    {
      id: "corrective-component-b",
      activityType: "修复性维修",
      planType: "修复性维修方案",
      activityName: "部件B修复性维修方案",
      equipmentId: "component-b",
      activityCodes: ["CM-B"],
      predecessors: { "CM-B": [] }
    }
  );
  projectJson.supportActivityJobs = [
    ...(projectJson.supportActivityJobs || []),
    {
      activityCode: "CM-A",
      workName: "部件A既有修复作业",
      durationMinutes: 45
    },
    {
      activityCode: "CM-B",
      workName: "部件B既有修复作业",
      durationMinutes: 55,
      meanRepairTimeMinutes: 999
    }
  ];
  const runtime = await setupRuntimeApp({
    projectJson,
    backendProjects: [{
      project_id: projectId,
      experiment_name: "修复性维修运行时项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "runtime-import-template",
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "corrective-runtime" });
    await runtime.setHash("feature=spare-planning-corrective-maintenance-activity");
    await waitForRuntimeHtml(runtime, /部件A/, "expected runtime component tree to load");
    await runtime.click("[data-select-corrective-component]", { selectCorrectiveComponent: "component-a" });
    assert.match(runtime.appNode.innerHTML, /部件A既有修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件B既有修复作业/);
    assert.match(runtime.appNode.innerHTML, /固定值 42 min/);

    await runtime.click("[data-select-corrective-component]", { selectCorrectiveComponent: "component-b" });
    assert.match(runtime.appNode.innerHTML, /部件B既有修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件A既有修复作业/);
    assert.match(runtime.appNode.innerHTML, /固定值 66 min/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /999/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity codes stay unique when edited at runtime", async () => {
  const projectJson = createRuntimeProjectJson();
  appendRuntimeSupportActivityJob(projectJson, 0, {
    activityCode: "BA-002",
    workName: "第二工作项目",
    predecessors: [],
    durationMinutes: 15
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:1" });
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "0:1", basicActivityField: "activityCode" },
      { value: "BA-001" }
    );
    await runtime.flush();

    assert.equal((runtime.appNode.innerHTML.match(/<td>BA-002<\/td>/g) || []).length, 1);
  } finally {
    runtime.restore();
  }
});

test("support activity predecessors are edited from the predecessor dialog at runtime", async () => {
  const projectJson = createRuntimeProjectJson();
  appendRuntimeSupportActivityJob(projectJson, 0, {
    activityCode: "BA-002",
    workName: "已有紧前作业",
    predecessors: [],
    durationMinutes: 15
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
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

test("support activity predecessor references follow activity code edits", async () => {
  const projectJson = createRuntimeProjectJson();
  appendRuntimeSupportActivityJob(projectJson, 0, {
    activityCode: "BA-002",
    workName: "依赖首项的作业",
    predecessors: ["BA-001"],
    durationMinutes: 15
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:0" });
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "0:0", basicActivityField: "activityCode" },
      { value: "BA-010" }
    );
    await runtime.click("[data-project-draft-save]");

    const savedProject = await waitForProjectSave(runtime, (body) => (
      body.supportActivities?.[0]?.predecessors?.["BA-002"]?.[0] === "BA-010"
    ), "expected predecessor references to follow activity code edits");
    assert.deepEqual(savedProject.supportActivities[0].activityCodes, ["BA-010", "BA-002"]);
    assert.deepEqual(savedProject.supportActivities[0].predecessors, { "BA-010": [], "BA-002": ["BA-010"] });
  } finally {
    runtime.restore();
  }
});

test("basic support activity edit opens a dialog at runtime", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
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
        basicActivityResourceDialogField: "resourceKey"
      },
      { value: "personnel:机务" }
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
    assert.match(runtime.appNode.innerHTML, /<option value="personnel:机务"[^>]*selected[^>]*>机务<\/option>/);
    assert.match(runtime.appNode.innerHTML, /value="4"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
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
    assert.match(runtime.appNode.innerHTML, /<option value="runtime-spare-1"[^>]*selected[^>]*>LRU-A<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="model"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name"/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity resource dialog uses non-organization resource catalogs", async () => {
  const projectId = "activity-resource-options-runtime";
  const projectJson = createRuntimeProjectJson({ project_id: projectId });
  projectJson.modelingDictionaries = { personnelSpecialties: ["航电", "液压"] };
  projectJson.supportOrganization = {
    tree: {
      id: "support-org-root",
      name: "保障组织",
      children: [
        { id: "carrier-deck", name: "航母飞行甲板", children: [] }
      ]
    }
  };
  projectJson.supportResources = [
    { id: "personnel-avionics", supportNodeName: "航母飞行甲板", type: "personnel", name: "航电保障组", model: "航电", quantity: 4 },
    { id: "equipment-detector", supportNodeName: "航母飞行甲板", type: "equipment", name: "检测仪", model: "DT-01", quantity: 2 },
    { id: "spare-avionics", supportNodeName: "航母飞行甲板", type: "spare", name: "航电模块", model: "LRU", quantity: 5 }
  ];
  projectJson.supportActivityJobs[0] = {
    activityCode: "BA-001",
    workName: "导入工作项目",
    durationMinutes: 20,
    personnel: "维修/航电,2",
    equipment: "检测仪,DT-01,1",
    spare: "航电模块,LRU,1"
  };
  const runtime = await setupRuntimeApp({
    projectJson,
    backendProjects: [{
      project_id: projectId,
      experiment_name: "保障活动资源选项项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "runtime-import-template",
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:0" });

    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "personnel" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="personnel:航电"[^>]*selected[^>]*>航电<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="personnel:液压"[^>]*>液压<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航电保障组/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "equipment" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="equipment-detector"[^>]*selected[^>]*>检测仪 \/ DT-01<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "spare" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="spare-avionics"[^>]*selected[^>]*>航电模块 \/ LRU<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity applicability only offers whole-machine objects", async () => {
  const projectJson = createRuntimeProjectJson();
  projectJson.equipment.wholeMachineModels = ["J-15", "J-35"];
  projectJson.components = [
    { id: "component-a", name: "部件A", aircraftModel: "J-15", parentId: "aircraft-root", quantity: 1 },
    { id: "component-b", name: "部件B", aircraftModel: "J-35", parentId: "aircraft-root", quantity: 1 }
  ];
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-add]");

    assert.match(runtime.appNode.innerHTML, /<option value="aircraft:J-15"/);
    assert.match(runtime.appNode.innerHTML, /<option value="aircraft:J-35"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /component:component-a/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /component:component-b/);
  } finally {
    runtime.restore();
  }
});

test("basic support activity resource dialog selects resource requirements without organization coupling", async () => {
  const projectId = "activity-resource-select-runtime";
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      project_id: projectId,
      supportOrganization: {
        tree: {
          id: "support-org-root",
          name: "保障组织",
          children: [
            { id: "carrier-deck", name: "航母飞行甲板", children: [] }
          ]
        }
      },
      supportResources: [
        { id: "resource-personnel-avionics", supportNodeName: "航母飞行甲板", type: "personnel", name: "航电保障组", model: "航电", quantity: 4 },
        { id: "resource-equipment-detector", supportNodeName: "航母飞行甲板", type: "equipment", name: "检测仪", model: "DT-01", quantity: 2 },
        { id: "resource-spare-module", supportNodeName: "航母飞行甲板", type: "spare", name: "航电模块", model: "LRU-A", quantity: 5 }
      ],
      supportActivities: [{
        id: "ops-runtime-1",
        activityType: "使用保障",
        planType: "直接准备方案",
        planGroupId: "ops-runtime",
        activityName: "J-15直接准备方案",
        aircraftModel: "J-15",
        durationHours: 1,
        activityCodes: ["BA-001"],
        predecessors: { "BA-001": [] }
      }],
      supportActivityJobs: [{
          activityCode: "BA-001",
          workName: "初始工作项目",
          durationMinutes: 20,
          personnel: [],
          equipment: [],
          spare: []
      }]
    }),
    backendProjects: [{
      project_id: projectId,
      experiment_name: "保障活动资源下拉项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "runtime-import-template",
      updated_at: "2026-06-26 00:00:00"
    }]
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId });
    await runtime.setHash("feature=spare-planning-basic-support-activity");
    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:0" });

    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "personnel" }
    );
    await runtime.click(
      "[data-basic-activity-resource-dialog-add]",
      { basicActivityKey: "0:0", basicActivityResourceDialogAdd: "personnel" }
    );
    assert.match(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="resourceKey"/);
    assert.match(runtime.appNode.innerHTML, /<option value="personnel:航电"[^>]*selected[^>]*>航电<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
    await runtime.change(
      "[data-basic-activity-resource-dialog-field]",
      {
        basicActivityKey: "0:0",
        basicActivityResourceKind: "personnel",
        basicActivityResourceIndex: "0",
        basicActivityResourceDialogField: "quantity"
      },
      { value: "0", type: "number" }
    );
    assert.match(runtime.appNode.innerHTML, /value="1"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="professional"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /basic-activity-personnel-models|basic-activity-personnel-names/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "equipment" }
    );
    await runtime.click(
      "[data-basic-activity-resource-dialog-add]",
      { basicActivityKey: "0:0", basicActivityResourceDialogAdd: "equipment" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="resource-equipment-detector"[^>]*selected[^>]*>检测仪 \/ DT-01<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="model"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /basic-activity-equipment-models|basic-activity-equipment-names/);

    await runtime.click("[data-basic-activity-resource-dialog-close]");
    await runtime.click(
      "[data-basic-activity-resource-dialog-open]",
      { basicActivityKey: "0:0", basicActivityResourceDialogOpen: "spare" }
    );
    await runtime.click(
      "[data-basic-activity-resource-dialog-add]",
      { basicActivityKey: "0:0", basicActivityResourceDialogAdd: "spare" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="resource-spare-module"[^>]*selected[^>]*>航电模块 \/ LRU-A<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="model"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-basic-activity-resource-dialog-field="name"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /basic-activity-spare-models|basic-activity-spare-names/);
  } finally {
    runtime.restore();
  }
});

test("logistics support activity page only renders transport strategy list", async () => {
  const runtime = await setupRuntimeApp({ projectJson: createRuntimeProjectJson() });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-logistics-support-activity");

    assert.match(runtime.appNode.innerHTML, /后勤保障运输策略配置/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /工作项目清单/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /保障活动图/);
  } finally {
    runtime.restore();
  }
});

test("logistics transport editing writes top-level transport policies", async () => {
  const projectJson = createRuntimeProjectJson({
    supportNodes: [
      { id: "base", name: "基地" },
      { id: "deck", name: "甲板" }
    ],
    transportPolicies: []
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-logistics-support-activity");
    await runtime.click("[data-logistics-transport-add]");

    assert.match(runtime.appNode.innerHTML, /data-path="transportPolicies\.0\.name"/);
    assert.match(runtime.appNode.innerHTML, /data-path="transportPolicies\.0\.fromSupportNodeName"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /supportActivities\.\d+\.transportStrategies/);

    await runtime.change("[data-path]", { path: "transportPolicies.0.name" }, { value: "加急调运", type: "text" });
    await runtime.change("[data-path]", { path: "transportPolicies.0.transportTimeHours" }, { value: "2.5", type: "number" });
    await runtime.click("[data-project-draft-save]");

    const saved = await waitForProjectSave(
      runtime,
      (body) => body.transportPolicies?.[0]?.name === "加急调运",
      "expected logistics save to persist top-level transport policy"
    );
    assert.equal(saved.transportPolicies[0].fromSupportNodeName, "基地");
    assert.equal(saved.transportPolicies[0].toSupportNodeName, "甲板");
    assert.equal(saved.transportPolicies[0].spareName, "LRU-A");
    assert.equal(saved.transportPolicies[0].transportTimeHours, 2.5);
    assert.ok(saved.supportActivities.every((activity) => !("transportStrategies" in activity) && !("organizationStrategies" in activity)));
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
    await runtime.change("[data-experiment-stop-mode]", {}, { value: "and" });
    await runtime.change(
      "[data-experiment-stop-condition]",
      { experimentStopCondition: "failure" },
      { checked: true, type: "checkbox" }
    );
    await runtime.click("[data-scenario-override-add]");
    await runtime.change(
      "[data-scenario-override-path]",
      { scenarioOverrideIndex: "0" },
      { value: "supportResources.0.quantity" }
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
    assert.deepEqual(body.config.stopPolicy, {
      schemaVersion: "stop-policy-v0",
      mode: "and",
      conditions: [{ type: "duration" }, { type: "failure" }]
    });
    assert.equal(body.config.projectJson.supportResources[0].quantity, 12);
    assert.equal(body.config.analysisRequests.largeSample.samples, 5);
    assert.equal("scenarioComposition" in body.config.projectJson, false);
    assert.equal("stopPolicy" in body.config.projectJson, false);

    const projectSaveRequests = runtime.requests.filter((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(projectSaveRequests.length, "source Project should still be saved separately");
    const savedProjects = projectSaveRequests.map((request) => JSON.parse(request.options.body || "{}"));
    assert.ok(savedProjects.every((savedProject) => savedProject.supportResources?.[0]?.quantity !== 12));
    assert.ok(savedProjects.every((savedProject) => !("scenarioComposition" in savedProject)));
    assert.ok(savedProjects.every((savedProject) => !("seedPolicy" in savedProject)));
    assert.ok(savedProjects.every((savedProject) => !("stopPolicy" in savedProject)));
  } finally {
    runtime.restore();
  }
});

test("experiment plan stop minute edit does not enable specified time unless checked", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });
    await runtime.change("[data-experiment-stop-time-minute]", {}, { value: "90", type: "number" });
    await runtime.click("[data-save-plan]");

    const createPlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(createPlanRequest, "composed experiment plan should be posted to backend");
    const body = JSON.parse(createPlanRequest.options.body || "{}");
    assert.deepEqual(body.config.stopPolicy.conditions, [{ type: "duration" }]);
  } finally {
    runtime.restore();
  }
});

test("experiment plan editor uses a Chinese modeling data tree for leaf override editing", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson({
      projectInfo: { name: "中文化覆盖源项目", baseCode: "CN-01" },
      supportNodes: [{
        id: "base-a",
        name: "基层保障点A"
      }],
      supportResources: [{
        id: "spare-a",
        supportNodeName: "基层保障点A",
        type: "spare",
        name: "LRU-A",
        model: "LRU-A",
        quantity: 2
      }]
    })
  });

  try {
    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });

    assert.match(runtime.appNode.innerHTML, /建模数据/);
    assert.match(runtime.appNode.innerHTML, /任务剖面对象/);
    assert.match(runtime.appNode.innerHTML, /任务剖面名称/);
    assert.match(runtime.appNode.innerHTML, /保障点清单对象/);
    assert.match(runtime.appNode.innerHTML, /保障资源清单对象/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Project JSON/);

    await runtime.click(
      "[data-scenario-modeling-path]",
      { scenarioModelingPath: "supportResources.0.quantity" }
    );

    assert.match(runtime.appNode.innerHTML, /选中属性/);
    assert.match(runtime.appNode.innerHTML, /保障资源清单对象 \/ 保障资源 1 \/ 数量/);
    assert.match(runtime.appNode.innerHTML, /data-scenario-selected-override-value/);
    assert.match(runtime.appNode.innerHTML, /value="2"/);

    await runtime.change(
      "[data-scenario-selected-override-value]",
      { scenarioSelectedOverridePath: "supportResources.0.quantity" },
      { value: "12" }
    );
    await runtime.click("[data-save-plan]");

    const createPlanRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/experiment-plans"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(createPlanRequest, "tree-edited experiment plan should be posted to backend");
    const body = JSON.parse(createPlanRequest.options.body || "{}");
    assert.equal(body.config.scenarioComposition.overrides[0].path, "supportResources.0.quantity");
    assert.equal(body.config.scenarioComposition.overrides[0].valueType, "number");
    assert.equal(body.config.scenarioComposition.overrides[0].value, 12);
    assert.equal(body.config.projectJson.supportResources[0].quantity, 12);
  } finally {
    runtime.restore();
  }
});

test("experiment plan edit preserves saved seed policy scenario composition and samples", async () => {
  const planProjectJson = createRuntimeProjectJson({
    supportNodes: [{
      id: "base-a",
      name: "基层保障点A"
    }],
    supportResources: [{
      id: "spare-a",
      supportNodeName: "基层保障点A",
      type: "spare",
      name: "LRU-A",
      model: "LRU-A",
      quantity: 14
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
        name: "基层保障点A"
      }],
      supportResources: [{
        id: "spare-a",
        supportNodeName: "基层保障点A",
        type: "spare",
        name: "LRU-A",
        model: "LRU-A",
        quantity: 2
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
            path: "supportResources.0.quantity",
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
    assert.equal(body.config.scenarioComposition.overrides[0].path, "supportResources.0.quantity");
    assert.equal(body.config.scenarioComposition.overrides[0].value, 14);
    assert.equal(body.config.projectJson.supportResources[0].quantity, 14);
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

test("visual simulation waits for explicit run before starting formal visualization", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /启动新仿真/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "visual page load should not auto-start formal visualization"
    );

    await runtime.click("[data-mesa-control]", { mesaControl: "start-new-run" });

    const runRequest = runtime.requests
      .filter((request) => request.url === "/api/runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.run_type === "single");
    assert.ok(runRequest, "explicit start button should submit a formal single run");
    assert.equal(runRequest.model_family, "aircraft_support_v1");
  } finally {
    runtime.restore();
  }
});

test("experiment plan dropdown drives lightweight Mesa Monte Carlo and analysis requests", async () => {
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-runtime-plan-a",
    projectInfo: { name: "方案A Project", baseCode: "PLA" }
  });
  delete planProjectJson.experiment;
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-a",
      status: "draft",
      config: {
        name: "方案A",
        samples: 4,
        seed: 404,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    const monteCarloHero = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(monteCarloHero, /<h3>蒙特卡洛分析<\/h3>/);
    assert.match(monteCarloHero, /data-current-experiment-plan/);
    assert.doesNotMatch(monteCarloHero, /后端 Mesa 仿真分析|lite-mesa-hero-meter/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /lite-mesa-source-grid/);
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-a" }
    );
    await runtime.click("[data-lite-mesa-action='run']");

    const monteCarloRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "mission_reliability");
    assert.ok(monteCarloRequest, "Monte Carlo detail should use lightweight Mesa analysis route");
    const monteCarloBody = monteCarloRequest;
    assert.equal(monteCarloBody.analysis_type, "mission_reliability");
    assert.equal(monteCarloBody.project.project_id, "project-runtime-plan-a");
    assert.match(runtime.appNode.innerHTML, /出动架次率/);
    assert.match(runtime.appNode.innerHTML, />0\.84</);
    assert.doesNotMatch(runtime.appNode.innerHTML, />84%<\/strong>|>84%<\/td>|>75%<\/strong>|>75%<\/td>/);
    assert.match(runtime.appNode.innerHTML, /平均备件延误时间/);
    assert.match(runtime.appNode.innerHTML, /mean_transport_delay/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /短缺事件/);

    await runtime.setHash("feature=spare-planning-spare-shortfall-analysis");
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-a" }
    );
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisRequests = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"));
    const analysisBody = analysisRequests.at(-1);
    assert.equal(analysisBody.analysis_type, "spare_shortfall");
    assert.equal(analysisBody.project.project_id, "project-runtime-plan-a");
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "lightweight Mesa pages must not submit formal runs"
    );
  } finally {
    runtime.restore();
  }
});

test("mission reliability and downtime analysis sample settings follow selected experiment plan", async () => {
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-runtime-analysis-plan",
    projectInfo: { name: "分析方案 Project", baseCode: "APL" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-analysis",
      status: "draft",
      config: {
        name: "分析方案",
        samples: 4,
        seed: 404,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    for (const [featureId, analysisType] of [
      ["mission-reliability-task-reliability", "mission_reliability"],
      ["mission-reliability-downtime-factor-analysis", "downtime_factors"]
    ]) {
      await runtime.setHash(`feature=${featureId}`);
      await runtime.change(
        "[data-current-experiment-plan]",
        { currentExperimentPlan: "" },
        { value: "plan-analysis" }
      );

      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      assert.match(settingsPanel, /样本量[\s\S]*<strong>4<\/strong>/);
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>404<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);

      await runtime.click("[data-lite-mesa-analysis-action='run']");
      const analysisBody = runtime.requests
        .filter((request) => request.url === "/api/mesa-analysis-runs")
        .map((request) => JSON.parse(request.options.body || "{}"))
        .at(-1);
      assert.equal(analysisBody.analysis_type, analysisType);
      assert.equal(analysisBody.project.project_id, "project-runtime-analysis-plan");
      assert.equal(analysisBody.settings.samples, 4);
      assert.equal(analysisBody.settings.seed, 404);
    }
  } finally {
    runtime.restore();
  }
});

test("mission reliability and downtime analysis default to the sole backend experiment plan settings", async () => {
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-runtime-default-analysis-plan",
    projectInfo: { name: "默认分析方案 Project", baseCode: "DAP" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-default-analysis",
      status: "draft",
      config: {
        name: "默认分析方案",
        samples: 40,
        seed: 20260621,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    for (const [featureId, analysisType] of [
      ["mission-reliability-task-reliability", "mission_reliability"],
      ["mission-reliability-downtime-factor-analysis", "downtime_factors"]
    ]) {
      await runtime.setHash(`feature=${featureId}`);
      await runtime.flush();

      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      assert.match(settingsPanel, /样本量[\s\S]*<strong>40<\/strong>/);
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>20260621<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);

      await runtime.click("[data-lite-mesa-analysis-action='run']");
      const analysisBody = runtime.requests
        .filter((request) => request.url === "/api/mesa-analysis-runs")
        .map((request) => JSON.parse(request.options.body || "{}"))
        .at(-1);
      assert.equal(analysisBody.analysis_type, analysisType);
      assert.equal(analysisBody.project.project_id, "project-runtime-default-analysis-plan");
      assert.equal(analysisBody.settings.samples, 40);
      assert.equal(analysisBody.settings.seed, 20260621);
    }
  } finally {
    runtime.restore();
  }
});

test("Monte Carlo setting changes do not rerender before lightweight Mesa run click", async () => {
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

    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /设置已更新，等待重新运行 Mesa 分析/);

    await runtime.click("[data-lite-mesa-action='run']");

    const analysisRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "mission_reliability");
    assert.ok(analysisRequest, "Monte Carlo detail should submit a lightweight Mesa analysis request");
    const body = analysisRequest;
    assert.equal(body.analysis_type, "mission_reliability");
    assert.equal(body.settings.samples, 3);
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "Monte Carlo detail should not submit a formal run"
    );
    assert.match(runtime.appNode.innerHTML, /Mesa 分析完成|分析完成/);
  } finally {
    runtime.restore();
  }
});

let runtimeImportCounter = 0;

function runtimeBackendProjectEntry(projectId, experimentName = "Runtime 项目") {
  return {
    project_id: projectId,
    experiment_name: experimentName,
    base_code: "RT",
    summary: "runtime test",
    source_import_id: "runtime-import-template",
    updated_at: "2026-06-26 00:00:00"
  };
}

async function setupRuntimeApp({
  hash = "",
  projectJson = createRuntimeProjectJson(),
  importFile = null,
  experimentPlans = [],
  sessionUser = { username: "data", role: "数据管理员" },
  backendProjects = [{
    project_id: "project-runtime",
    experiment_name: "Runtime 项目",
    base_code: "RT",
    summary: "runtime test",
    source_import_id: "",
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
  const runtimeRuns = new Map();
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
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const previousCreateObjectURL = globalThis.URL?.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL?.revokeObjectURL;
  const runtimeTimeouts = new Set();

  globalThis.setTimeout = (callback, delay, ...args) => {
    let timeoutId;
    timeoutId = previousSetTimeout((...callbackArgs) => {
      runtimeTimeouts.delete(timeoutId);
      callback(...callbackArgs);
    }, delay, ...args);
    runtimeTimeouts.add(timeoutId);
    return timeoutId;
  };
  globalThis.clearTimeout = (timeoutId) => {
    runtimeTimeouts.delete(timeoutId);
    return previousClearTimeout(timeoutId);
  };

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
      return jsonResponse({ user: sessionUser });
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
    const experimentPlanListMatch = url.match(/^\/api\/projects\/([^/]+)\/experiment-plans$/);
    if (experimentPlanListMatch && method === "GET") {
      return jsonResponse({ project_id: decodeURIComponent(experimentPlanListMatch[1]), experiment_plans: experimentPlans });
    }
    const modelingSnapshotMatch = url.match(/^\/api\/projects\/([^/]+)\/modeling-snapshots$/);
    if (modelingSnapshotMatch && method === "POST") {
      return jsonResponse({ snapshot_id: `snapshot-${decodeURIComponent(modelingSnapshotMatch[1])}-plan` });
    }
    if (experimentPlanListMatch && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse({
        experiment_plan_id: "plan-runtime-created",
        config: body.config || {}
      });
    }
    const currentAnalysisMatch = url.match(/^\/api\/projects\/([^/]+)\/analysis-results\/([^/]+)$/);
    if (currentAnalysisMatch && method === "GET") {
      return jsonResponse(createRuntimeCurrentAnalysisResult(
        decodeURIComponent(currentAnalysisMatch[1]),
        decodeURIComponent(currentAnalysisMatch[2])
      ));
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
	    if (url === "/api/mesa-analysis-runs" && method === "POST") {
	      const body = JSON.parse(options.body || "{}");
	      const analysisType = body.analysis_type || "mission_reliability";
	      const samples = Number(body.settings?.samples || 2);
		      const aggregateMetrics = {
		        mission_success_rate: 0.5,
		        ready_rate: 0.46,
		        sortie_rate: 0.84,
		        spare_fill_rate: 0.55,
		        mean_transport_delay: 18.25,
		        repair_backlog: 2.15
		      };
		      const metricsByAnalysis = {
		        spare_shortfall: [
		          ["发生缺件备件", "1"],
		          ["平均备件延误时间(h)", "1.50"],
		          ["最高缺件备件", "航电模块"],
		          ["因维修延误导致的任务取消次数", "2"]
		        ],
		        mission_reliability: [
		          ["任务成功率", "0.800"],
		          ["出动架次率", "0.750"],
		          ["战备完好率", "0.460"],
		          ["任务失败次数", "3"]
		        ]
		      };
		      return jsonResponse({
	        status: "session_complete",
	        source: "lite_mesa_aircraft_support_v1",
	        run_id: `lite-mesa-runtime-${analysisType}`,
	        project_id: body.project?.project_id || "project-runtime",
	        scenario_id: body.project?.scenarioId || "scenario-runtime",
	        scenario_version: "scenario-v0.1",
	        model_family: body.model_family || "aircraft_support_v1",
	        model_id: "AircraftSupportV1Model",
	        analysis_type: analysisType,
	        experiment_id: analysisType === "carry_list" ? "minimum_carry_list_search" : "project_baseline_at_current_granularity",
	        sample_count: samples,
	        seed_list: Array.from({ length: samples }, (_, index) => Number(body.settings?.seed || 20260704) + index),
	        aggregate_metrics: aggregateMetrics,
	        samples: Array.from({ length: samples }, (_, index) => ({
	          sample_id: `sample-${index + 1}`,
	          final: aggregateMetrics
	        })),
		        metrics: metricsByAnalysis[analysisType] || [
		          ["任务成功率", "0.800"],
		          ["出动架次率", "0.750"],
		          ["样本数", String(samples)]
		        ],
		        rows: analysisType === "mission_reliability"
		          ? [
		              { sequence: 1, dayIndex: 1, waveIndex: 1, waveLabel: "第1天 第1波", sampleCount: samples, plannedSorties: 4, meanMissionSuccessRate: 0.75, meanSortieRate: 0.9 },
		              { sequence: 2, dayIndex: 1, waveIndex: 2, waveLabel: "第1天 第2波", sampleCount: samples - 1, plannedSorties: 4, meanMissionSuccessRate: 0.5, meanSortieRate: 0.75 }
		            ]
		          : analysisType === "downtime_factors"
		            ? [{ label: "故障停机", reason: "failure", count: 1, contribution: 0.4 }]
		            : analysisType === "spare_shortfall"
		              ? [{ spareType: "航电模块", demand: 2, filled: 1, meanTransportDelayHours: 1.5, fillRate: 0.55, riskLevel: "高" }]
		              : [{ spareType: "航电模块", demand: 2, shortage: 0, fillRate: 1, riskLevel: "低" }],
	        wave_rows: analysisType === "mission_reliability"
	          ? [
	              { sequence: 1, dayIndex: 1, waveIndex: 1, waveLabel: "第1天 第1波", sampleCount: samples, plannedSorties: 4, meanMissionSuccessRate: 0.75, meanSortieRate: 0.9 },
	              { sequence: 2, dayIndex: 1, waveIndex: 2, waveLabel: "第1天 第2波", sampleCount: samples - 1, plannedSorties: 4, meanMissionSuccessRate: 0.5, meanSortieRate: 0.75 }
	            ]
	          : [],
	        daily_rows: [],
        event_snapshots: analysisType === "downtime_factors"
          ? [
              {
                snapshot_id: "downtime-runtime-0001",
                source: "model_event_log",
                seed: Number(body.settings?.seed || 20260704),
                simulation_time: 42,
                event_type: "spare_shortage",
                event_label: "备件短缺",
                event: { message: "repair blocked by hyd-pump shortage" },
                result: "mission_delayed_by_spare_shortage",
                aircraft_state: {
                  summary: { available_aircraft: 1, failed_count: 1, repairing_count: 1 },
                  aircraft: [{ tail_number: "J15-101", state: "maintenance" }]
                },
                support_resources: [
                  {
                    resource_id: "carrier-deck",
                    name: "航母飞行甲板",
                    personnel_in_use: 1,
                    personnel_capacity: 2,
                    equipment_in_use: 1,
                    equipment_capacity: 2,
                    inventory: { "hyd-pump": 0 }
                  }
                ],
                spare_shortages: [{ spare_type: "hyd-pump", required_quantity: 1, available_quantity: 0, job_id: "repair-J15-101" }],
                job_node: { job_id: "repair-J15-101", kind: "repair", state: "waiting", task: "更换液压泵", tail_number: "J15-101" }
              }
            ]
          : [],
	        limitations: ["本次分析结果不写入正式结果账本。"],
	        message: ""
	      });
	    }
	    if (url === "/api/runs" && method === "POST") {
	      const body = JSON.parse(options.body || "{}");
      const runId = `formal-runtime-${body.run_type || "single"}-${runtimeRuns.size + 1}`;
      const run = createRuntimeFormalRun(runId, body);
      runtimeRuns.set(runId, run);
      return jsonResponse(run);
    }
    if (url.startsWith("/api/runs?") && method === "GET") {
      const runs = runtimeRuns.size ? [...runtimeRuns.values()] : [createRuntimeFormalRun("formal-runtime-seeded", {})];
      return jsonResponse({ runs });
    }
    const runArtifactPayloadMatch = url.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
    if (runArtifactPayloadMatch && method === "GET") {
      const runId = decodeURIComponent(runArtifactPayloadMatch[1]);
      const artifactId = decodeURIComponent(runArtifactPayloadMatch[2]);
      if (artifactId === "runtime-state-series") {
        return jsonResponse(createRuntimeVisualizationStateSeries(runId));
      }
      return jsonResponse(createRuntimeAnalysisProjectionPayload(runId, artifactId));
    }
    const runDetailMatch = url.match(/^\/api\/runs\/([^/]+)\/detail$/);
    if (runDetailMatch && method === "GET") {
      const runId = decodeURIComponent(runDetailMatch[1]);
      const run = runtimeRuns.get(runId) || createRuntimeFormalRun(runId, {});
      return jsonResponse({ run, artifact_manifest: createRuntimeArtifactManifest(runId) });
    }
    const runResultMatch = url.match(/^\/api\/runs\/([^/]+)\/result$/);
    if (runResultMatch && method === "GET") {
      const runId = decodeURIComponent(runResultMatch[1]);
      return jsonResponse({
        run_id: runId,
        model_family: "aircraft_support_v1",
        metrics: {
          mission_success_rate: 0.5,
          sortie_completion_rate: 0.5,
          spare_fill_rate: 0.5
        }
      });
    }
    const runArtifactsMatch = url.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
    if (runArtifactsMatch && method === "GET") {
      return jsonResponse(createRuntimeArtifactManifest(decodeURIComponent(runArtifactsMatch[1])));
    }
    const runChainMatch = url.match(/^\/api\/runs\/([^/]+)\/chain$/);
    if (runChainMatch && method === "GET") {
      const runId = decodeURIComponent(runChainMatch[1]);
      return jsonResponse({ run_id: runId, chain: [] });
    }
    const runStatusMatch = url.match(/^\/api\/runs\/([^/]+)$/);
    if (runStatusMatch && method === "GET") {
      const runId = decodeURIComponent(runStatusMatch[1]);
      return jsonResponse(runtimeRuns.get(runId) || createRuntimeFormalRun(runId, {}));
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
      for (const timeoutId of runtimeTimeouts) {
        previousClearTimeout(timeoutId);
      }
      runtimeTimeouts.clear();
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
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

function htmlSectionByClass(html, className) {
  const match = html.match(new RegExp(`<section class="[^"]*\\b${className}\\b[^"]*">[\\s\\S]*?<\\/section>`));
  assert.ok(match, `expected section with class ${className}`);
  return match[0];
}

async function flushRuntimeTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForProjectSave(runtime, predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const match = projectSaveBodies(runtime).find(predicate);
    if (match) return match;
    await runtime.flush();
  }
  const observed = projectSaveBodies(runtime).map((body) => ({
    project_id: body.project_id,
    hasEquipment: Boolean(body.equipment),
    equipmentModel: body.equipment?.model,
    componentAircraftModel: body.components?.[0]?.aircraftModel
  }));
  assert.fail(`${message}. Observed project saves: ${JSON.stringify(observed)}`);
}

async function waitForRuntimeHtml(runtime, pattern, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pattern.test(runtime.appNode.innerHTML)) return;
    await runtime.flush();
  }
  assert.match(runtime.appNode.innerHTML, pattern, message);
}

function projectSaveBodies(runtime) {
  return runtime.requests
    .filter((request) => request.url === "/api/projects" && (request.options.method || "GET") === "POST")
    .map((request) => {
      try {
        return JSON.parse(request.options.body || "{}");
      } catch {
        return {};
      }
    });
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
      name: "航母飞行甲板"
    }],
    supportResources: [
      { id: "runtime-spare-1", supportNodeName: "航母飞行甲板", type: "spare", name: "LRU-A", model: "LRU-A", quantity: 3 },
      { id: "runtime-personnel-1", supportNodeName: "航母飞行甲板", type: "personnel", name: "机务人员", model: "机务", quantity: 10 },
      { id: "runtime-equipment-1", supportNodeName: "航母飞行甲板", type: "equipment", name: "检测仪", model: "JY-01", quantity: 8 }
    ],
    supportActivities: [{
      id: "ops-runtime-1",
      activityType: "使用保障活动",
      planType: "直接准备方案",
      planGroupId: "ops-runtime",
      activityName: "J-15直接准备方案",
      aircraftModel: "J-15",
      durationHours: 1,
      activityCodes: ["BA-001"],
      predecessors: { "BA-001": [] }
    }]
  });
  project.supportActivityJobs = [{
    activityCode: "BA-001",
    workName: "初始工作项目",
    durationMinutes: 20,
    personnel: "机务人员,1",
    equipment: "检测仪,1",
    spare: "航电模块"
  }];
  return {
    ...project,
    ...overrides,
    experiment: { ...project.experiment, ...(overrides.experiment || {}) },
    missionProfile: { ...project.missionProfile, ...(overrides.missionProfile || {}) },
    basicMissions: overrides.basicMissions || project.basicMissions,
    equipment: { ...project.equipment, ...(overrides.equipment || {}) }
  };
}

function appendRuntimeSupportActivityJob(projectJson, activityIndex, job) {
  const activity = projectJson.supportActivities[activityIndex];
  assert.ok(activity, `missing support activity ${activityIndex}`);
  if (!Array.isArray(projectJson.supportActivityJobs)) projectJson.supportActivityJobs = [];
  const activityCode = String(job.activityCode || `BA-${projectJson.supportActivityJobs.length + 1}`).trim();
  projectJson.supportActivityJobs.push({
    ...job,
    activityCode,
    predecessors: undefined
  });
  delete projectJson.supportActivityJobs[projectJson.supportActivityJobs.length - 1].predecessors;
  activity.activityCodes = [...(Array.isArray(activity.activityCodes) ? activity.activityCodes : []), activityCode];
  activity.predecessors = {
    ...(activity.predecessors && typeof activity.predecessors === "object" ? activity.predecessors : {}),
    [activityCode]: Array.isArray(job.predecessors) ? [...job.predecessors] : []
  };
  delete activity.jobs;
}

function createRuntimeFormalRun(runId = "formal-runtime-run", request = {}) {
  return {
    run_id: runId,
    project_id: request.project_id || "project-runtime",
    experiment_plan_id: request.experiment_plan_id || "plan-runtime-created",
    model_family: request.model_family || "aircraft_support_v1",
    run_type: request.run_type || "single",
    analysis_type: request.analysis_type || "",
    status: "succeeded",
    phase: "completed",
    progress: 1,
    lifecycle_status: "active"
  };
}

function createRuntimeArtifactManifest(runId = "formal-runtime-run") {
  return {
    run_id: runId,
    artifact_manifest_id: `runtime-artifact-manifest-${runId}`,
    artifacts: [{
      artifact_id: "runtime-state-series",
      kind: "visualization_state_series",
      path: `artifacts/${runId}/state-series.json`,
      source_artifact_id: `runtime-result-summary-${runId}`
    }]
  };
}

function createRuntimeVisualizationStateSeries(runId = "formal-runtime-run") {
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
      resources: [
        {
          name: "mechanic-team-runtime",
          display_name: "机务组",
          category: "personnel",
          support_node_id: "carrier-deck",
          professional: "机务",
          type: "保障人员",
          capacity: 10,
          in_use: 1,
          utilization: 0.1,
          work_count: 2
        },
        {
          name: "test-equipment-runtime",
          display_name: "检测仪",
          category: "equipment",
          support_node_id: "carrier-deck",
          model: "JY-01",
          type: "检测设备",
          capacity: 8,
          in_use: 1,
          utilization: 0.125,
          work_count: 2
        }
      ],
      spares: [
        { part_id: "spare-ready", name: "可用备件", quantity: 1 },
        { part_id: "spare-empty", name: "缺货备件", quantity: 0 }
      ],
      jobs: [],
      events: []
    }]
  };
}

function createRuntimeCurrentAnalysisResult(projectId = "project-runtime", analysisType = "carry_list") {
  return {
    project_id: projectId,
    analysis_type: analysisType,
    profile_version: `${analysisType}-current-v1`,
    base_plan_version: "default-base-v0",
    status: "completed",
    source: "formal_backend",
    is_stale: false,
    last_failure: null,
    internal_run_ref: {
      run_id: "formal-runtime-analysis",
      run_type: "monte_carlo",
      model_family: "aircraft_support_v1"
    },
    internal_artifact_ref: {
      artifact_id: `runtime-${analysisType}-projection`,
      artifact_kind: `analysis_projection_${analysisType}`
    },
    last_success_result: {
      run_id: "formal-runtime-analysis",
      projection_type: analysisType,
      payload: createRuntimeAnalysisProjectionPayload("formal-runtime-analysis", `runtime-${analysisType}-projection`, analysisType)
    }
  };
}

function createRuntimeAnalysisProjectionPayload(runId = "formal-runtime-analysis", artifactId = "", fallbackAnalysisType = "carry_list") {
  const analysisType = artifactId.includes("spare") ? "spare_shortfall"
    : artifactId.includes("mission") ? "mission_reliability"
      : artifactId.includes("downtime") ? "downtime_factors"
        : fallbackAnalysisType;
  return {
    schema_version: "analysis-projection-v0",
    projection_type: analysisType,
    analysis_type: analysisType,
    analysisType,
    run_id: runId,
    model_family: "aircraft_support_v1",
    base_artifact_id: "runtime-monte-carlo-base",
    data: analysisType === "downtime_factors"
      ? [{
          factor: "spare_shortage",
          contribution: 1,
          eventSnapshots: [{
            snapshot_id: "downtime-runtime-0001",
            event_type: "spare_shortage",
            event_label: "备件短缺",
            aircraft_state: { summary: { available_aircraft: 1 }, aircraft: [{ tail_number: "J15-001", state: "available" }] },
            support_resources: [{ resource_id: "deck-node", name: "甲板保障点", inventory: { "hyd-pump": 0 } }],
            spare_shortages: [{ spare_type: "hyd-pump", required_quantity: 1, available_quantity: 0 }]
          }]
        }]
      : [{ spare_type: "aircraft_support_v1_spares", recommended_quantity: 1, fill_rate: 1, risk_level: "低" }]
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
