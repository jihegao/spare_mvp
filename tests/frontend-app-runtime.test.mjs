import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { MODELING_IMPORT_DEMO_FIXTURE } from "../front/modeling-import-demo-fixture.mjs";
import {
  calculateRmsAllocation,
  createDefaultRmsAllocationPlan,
  createRmsAllocationProjectForScenario
} from "../front/rms-allocation-engine.mjs";
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

test("legacy support activity references hydrate into the basic mission page and autosave canonically", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-basic-mission",
    projectJson: createRuntimeProjectJson({
      basicMissions: [{
        id: "basic-runtime-legacy-support",
        name: "运行时基本任务",
        equipmentType: "J-15",
        taskDurationMinutes: 90,
        minRequiredSorties: 1,
        supportActivityName: "飞行前保障"
      }],
      supportActivities: [{
        id: "ops-runtime-legacy-support",
        name: "飞行前保障",
        activityName: "J-15直接准备方案",
        activityType: "使用保障活动",
        planType: "使用保障方案",
        aircraftModel: "J-15",
        durationHours: 1,
        activityCodes: []
      }]
    })
  });

  try {
    await waitForRuntimeHtml(
      runtime,
      /<option value="J-15直接准备方案" selected>/,
      "legacy Project should hydrate with the canonical support activity selected"
    );

    await runtime.change(
      "[data-path]",
      { path: "basicMissions.0.taskArea" },
      { value: "甲板训练区", type: "text" }
    );
    await new Promise((resolve) => setTimeout(resolve, 850));
    await runtime.flush();

    const validateRequest = runtime.requests.findLast((request) => request.url === "/api/projects/validate");
    const saveRequest = runtime.requests.findLast((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(validateRequest, "800ms autosave should validate the hydrated Project");
    assert.ok(saveRequest, "800ms autosave should persist the hydrated Project");
    for (const request of [validateRequest, saveRequest]) {
      const body = JSON.parse(request.options.body || "{}");
      assert.equal(body.basicMissions[0].supportActivityName, "J-15直接准备方案");
      assert.equal(body.basicMissions[0].taskArea, "甲板训练区");
      assert.equal(body.supportActivities[0].activityName, "J-15直接准备方案");
      assert.equal("name" in body.supportActivities[0], false);
    }
    assert.doesNotMatch(runtime.appNode.innerHTML, /自动保存未成功/);
  } finally {
    runtime.restore();
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

test("project data management omits raw JSON while keeping overview and replacement controls", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    basicMissions: [
      { id: "mission-runtime-1", name: "巡逻任务", minRequiredSorties: 3, supportActivityName: "J-15直接准备方案" },
      { id: "mission-runtime-2", name: "警戒任务", minRequiredSorties: 4, supportActivityName: "J-15直接准备方案" }
    ],
    combatUnit: {
      members: [
        { aircraftNo: "J15-101", model: "J-15", airport: "甲板" },
        { aircraftNo: "J15-102", model: "J-15", airport: "甲板" },
        { aircraftNo: "J35-201", model: "J-35", airport: "基地" }
      ]
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

    assert.match(runtime.appNode.innerHTML, /data-project-template-management/);
    assert.match(runtime.appNode.innerHTML, /<label class="btn-primary project-replacement-file-button">数据管理<input type="file" hidden data-project-replacement-file/);
    assert.match(runtime.appNode.innerHTML, /data-project-replacement-file/);
    assert.match(runtime.appNode.innerHTML, /data-project-data-overview/);
    assert.match(runtime.appNode.innerHTML, /项目数据概览/);
    assert.match(runtime.appNode.innerHTML, /总出动架次/);
    assert.match(runtime.appNode.innerHTML, /作战单元飞机/);
    assert.match(runtime.appNode.innerHTML, /<span>总出动架次<\/span>\s*<strong>7<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<span>作战单元飞机<\/span>\s*<strong>3<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /data-project-data-relationship-map/);
    assert.match(runtime.appNode.innerHTML, /对象关系/);
    assert.match(runtime.appNode.innerHTML, /任务关联/);
    await runtime.click("[data-project-data-relation-focus]", { projectDataRelationFocus: "activity" });
    assert.match(runtime.appNode.innerHTML, /保障活动对象/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-project-json-viewer/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Project JSON 原始数据/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-project-json-node/);
  } finally {
    runtime.restore();
  }
});

test("project data replacement preserves the opaque backend version token", async () => {
  const replacement = createRuntimeProjectJson({
    project_id: "project-imported-replacement",
    projectInfo: { name: "覆盖后的项目", isTemplate: true },
    basicMissions: [{ id: "replacement-mission", name: "覆盖任务", minRequiredSorties: 5 }]
  });
  const file = {
    name: "replacement.json",
    async text() {
      return JSON.stringify(replacement);
    }
  };
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-project-data-management",
    projectJson: createRuntimeProjectJson({ project_id: "project-runtime" }),
    backendProjects: [{
      project_id: "project-runtime",
      experiment_name: "Runtime 项目",
      base_code: "RT",
      summary: "runtime test",
      source_import_id: "",
      updated_at: "2026-06-26 00:00:00.123-opaque"
    }]
  });

  try {
    await runtime.change("[data-project-replacement-file]", {}, { files: [file], value: file.name });
    assert.match(runtime.appNode.innerHTML, /项目数据校验通过，请确认覆盖/);
    await runtime.click("[data-project-replacement-confirm]");

    const request = runtime.requests.find((item) => (
      item.url === "/api/projects/project-runtime/replace"
      && (item.options.method || "GET") === "PUT"
    ));
    assert.ok(request, "expected project replacement request");
    const body = JSON.parse(request.options.body || "{}");
    assert.equal(body.expected_updated_at, "2026-06-26 00:00:00.123-opaque");
    assert.equal(body.project_json.projectInfo.name, "覆盖后的项目");
    assert.match(runtime.appNode.innerHTML, /覆盖完成，审计记录 audit-runtime-replace/);
  } finally {
    runtime.restore();
  }
});

test("periodic task editor uses named week month and year profiles without total task name", async () => {
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
  let savedProject;

  try {
    await runtime.flush();

    assert.doesNotMatch(runtime.appNode.innerHTML, /总任务名称/);
    assert.match(runtime.appNode.innerHTML, /周剖面/);
    assert.match(runtime.appNode.innerHTML, /月剖面/);
    assert.match(runtime.appNode.innerHTML, /年剖面/);
    assert.match(runtime.appNode.innerHTML, /旧周期性任务名/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /上级任务名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /周期性任务名称/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /每周天数/);
    assert.match(runtime.appNode.innerHTML, /class="periodic-profile-name"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-periodic-profile-name=/);

    await runtime.click("[data-periodic-profile-tab]", { periodicProfileTab: "month" });
    assert.match(runtime.appNode.innerHTML, /月剖面配置/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /重复周数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-periodic-composition-field="repeatWeeks"/);
    assert.equal((runtime.appNode.innerHTML.match(/data-periodic-month-slot=/g) || []).length, 4);
    assert.match(runtime.appNode.innerHTML, /第 4 周/);
    assert.match(runtime.appNode.innerHTML, /0 \/ 4 周已配置/);
    assert.equal((runtime.appNode.innerHTML.match(/<option value="" selected>未配置周剖面<\/option>/g) || []).length, 4);
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "weekProfileId",
      periodicCompositionType: "month",
      periodicCompositionProfile: "month-default",
      periodicCompositionIndex: "0"
    }, { value: "periodic-runtime" });
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "weekProfileId",
      periodicCompositionType: "month",
      periodicCompositionProfile: "month-default",
      periodicCompositionIndex: "1"
    }, { value: "periodic-runtime" });
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "weekProfileId",
      periodicCompositionType: "month",
      periodicCompositionProfile: "month-default",
      periodicCompositionIndex: "1"
    }, { value: "" });
    assert.match(runtime.appNode.innerHTML, /1 \/ 4 周已配置/);
    await runtime.click("[data-periodic-composition-action]", {
      periodicCompositionAction: "add",
      periodicCompositionType: "month",
      periodicCompositionProfile: "month-default"
    });
    assert.equal((runtime.appNode.innerHTML.match(/data-periodic-month-slot=/g) || []).length, 5);
    assert.match(runtime.appNode.innerHTML, /第 5 周（可选）/);
    assert.match(runtime.appNode.innerHTML, /1 \/ 5 周已配置/);
    await runtime.click("[data-periodic-composition-action]", {
      periodicCompositionAction: "remove",
      periodicCompositionType: "month",
      periodicCompositionProfile: "month-default",
      periodicCompositionIndex: "4"
    });
    assert.equal((runtime.appNode.innerHTML.match(/data-periodic-month-slot=/g) || []).length, 4);
    await runtime.click("[data-periodic-profile-tab]", { periodicProfileTab: "year" });
    assert.match(runtime.appNode.innerHTML, /0 \/ 12 月 · 0 \/ 52 周/);
    assert.equal((runtime.appNode.innerHTML.match(/<option value="" selected>未配置月剖面<\/option>/g) || []).length, 12);
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "monthProfileId",
      periodicCompositionType: "year",
      periodicCompositionProfile: "year-default",
      periodicCompositionIndex: "0"
    }, { value: "month-default" });
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "monthProfileId",
      periodicCompositionType: "year",
      periodicCompositionProfile: "year-default",
      periodicCompositionIndex: "1"
    }, { value: "month-default" });
    await runtime.change("[data-periodic-composition-field]", {
      periodicCompositionField: "monthProfileId",
      periodicCompositionType: "year",
      periodicCompositionProfile: "year-default",
      periodicCompositionIndex: "1"
    }, { value: "" });
    assert.match(runtime.appNode.innerHTML, /1 \/ 12 月 · 1 \/ 52 周/);
    await runtime.click("[data-periodic-profile-tab]", { periodicProfileTab: "week" });

    await runtime.click("[data-periodic-profile-add]", { periodicProfileAdd: "week" });
    await runtime.click("[data-periodic-profile-select]", {
      periodicProfileSelect: "periodic-runtime",
      periodicProfileType: "week"
    });
    assert.match(runtime.appNode.innerHTML, /periodic-profile-item is-selected[^>]*data-periodic-profile-select="periodic-runtime"/);
    await runtime.click("[data-periodic-profile-rename-start]", {
      periodicProfileRenameStart: "periodic-runtime",
      periodicProfileType: "week"
    });
    assert.match(runtime.appNode.innerHTML, /data-periodic-profile-name="periodic-runtime"/);
    await runtime.input("[data-periodic-profile-name]", {
      periodicProfileName: "periodic-runtime",
      periodicProfileType: "week"
    }, { value: "周剖面2" });
    await runtime.click("[data-periodic-profile-rename-save]", {
      periodicProfileRenameSave: "periodic-runtime",
      periodicProfileType: "week"
    });
    assert.match(runtime.appNode.innerHTML, /名称已存在，请换一个名称/);
    await runtime.input("[data-periodic-profile-name]", {
      periodicProfileName: "periodic-runtime",
      periodicProfileType: "week"
    }, { value: "更新后的周剖面" });
    await runtime.click("[data-periodic-profile-rename-save]", {
      periodicProfileRenameSave: "periodic-runtime",
      periodicProfileType: "week"
    });
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-periodic-profile-name=/);
    assert.match(runtime.appNode.innerHTML, /更新后的周剖面/);
    await runtime.click("[data-periodic-profile-rename-start]", {
      periodicProfileRenameStart: "periodic-runtime",
      periodicProfileType: "week"
    });
    await runtime.input("[data-periodic-profile-name]", {
      periodicProfileName: "periodic-runtime",
      periodicProfileType: "week"
    }, { value: "不应保存的名称" });
    await runtime.click("[data-periodic-profile-rename-cancel]", {
      periodicProfileRenameCancel: "periodic-runtime",
      periodicProfileType: "week"
    });
    assert.doesNotMatch(runtime.appNode.innerHTML, /不应保存的名称/);
    assert.match(runtime.appNode.innerHTML, /更新后的周剖面/);
    await runtime.input("[data-periodic-field]", { periodicField: "weekComposite:0" }, { value: "composite-night" });
    await runtime.click("[data-project-draft-save]");

    savedProject = await waitForProjectSave(runtime, (body) => {
      const periodicTask = body.missionProfile?.periodicTasks?.[0];
      return periodicTask
        && !("parentTaskName" in periodicTask)
        && periodicTask.repeatWeeks === 2
        && periodicTask.cycleDays === 7
        && !("durationHours" in body.missionProfile)
        && periodicTask.compositeTasks.some((row) => (
          row.weekIndex === 1
            && row.weekday === "mondayCompositeTaskId"
            && row.compositeTaskId === "composite-night"
        ));
    }, "expected periodic task edits to save canonical Project draft fields");

    assert.equal(savedProject.missionProfile.periodicTasks[0].name, "更新后的周剖面");
    const savedMonthProfile = savedProject.missionProfile.periodicProfileLists.month[0];
    assert.deepEqual(savedMonthProfile.weekProfileIds, ["periodic-runtime", "", "", ""]);
    assert.deepEqual(
      savedProject.missionProfile.periodicProfileLists.year[0].monthProfileIds,
      ["month-default", ...Array(11).fill("")]
    );
    assert.equal("weekSegments" in savedMonthProfile, false);
  } finally {
    runtime.restore();
  }

  const reopenedRuntime = await setupRuntimeApp({
    hash: "feature=spare-planning-periodic-task",
    projectJson: savedProject
  });
  try {
    await reopenedRuntime.click("[data-periodic-profile-tab]", { periodicProfileTab: "month" });
    assert.match(reopenedRuntime.appNode.innerHTML, /1 \/ 4 周已配置/);
    assert.equal((reopenedRuntime.appNode.innerHTML.match(/<option value="" selected>未配置周剖面<\/option>/g) || []).length, 3);
    await reopenedRuntime.click("[data-periodic-profile-tab]", { periodicProfileTab: "year" });
    assert.match(reopenedRuntime.appNode.innerHTML, /1 \/ 12 月 · 1 \/ 52 周/);
    assert.equal((reopenedRuntime.appNode.innerHTML.match(/<option value="" selected>未配置月剖面<\/option>/g) || []).length, 11);
  } finally {
    reopenedRuntime.restore();
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
    assert.match(runtime.appNode.innerHTML, /aria-pressed="true"[^>]*>[\s\S]*?<span class="granularity-check" aria-hidden="true">✓<\/span>/);
    assert.match(runtime.appNode.innerHTML, /全要素/);
    assert.match(runtime.appNode.innerHTML, /装备RMS/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /颗粒度 A|颗粒度 B/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /导入包维护/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-modeling-import-action/);
    assert.match(runtime.appNode.innerHTML, /class="granularity-field-checkbox" type="checkbox" data-modeling-field-select="equipment-system:mtbfHours" checked disabled/);
    assert.match(runtime.appNode.innerHTML, /class="granularity-field-checkbox" type="checkbox" data-modeling-field-select="basic-support-activity:resourceIds" checked disabled/);

    await runtime.click("[data-granularity-profile-select]", { granularityProfileSelect: "equipment-rms" });

    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="full-elements" aria-pressed="false"/);
    assert.match(runtime.appNode.innerHTML, /data-granularity-profile-select="equipment-rms" aria-pressed="true"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-field-sheet-select="equipment-system" checked disabled/);
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

test("modeling form management renders the dictionary, product catalog, and adjacent time unit fields", async () => {
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

    assert.doesNotMatch(runtime.appNode.innerHTML, /仅保留保障人员专业字典与 12 个带时间单位的表单字段配置。/);
    assert.match(runtime.appNode.innerHTML, /保障人员专业字典/);
    assert.match(runtime.appNode.innerHTML, /data-personnel-specialty-dictionary/);
    assert.match(runtime.appNode.innerHTML, /带时间单位的表单字段/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-management/);
    assert.match(runtime.appNode.innerHTML, /class="modeling-field-config modeling-form-config-grid" data-modeling-form-management/);
    assert.match(runtime.appNode.innerHTML, /<section class="modeling-config-card" data-personnel-specialty-dictionary>/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-management data-product-catalog-state="expanded"/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-collapse-toggle[\s\S]*?aria-expanded="true"[\s\S]*?aria-controls="product-catalog-content"/);
    assert.match(runtime.appNode.innerHTML, /aria-label="折叠产品列表"/);
    assert.match(runtime.appNode.innerHTML, /<span>收起列表<\/span>/);
    assert.match(runtime.appNode.innerHTML, /id="product-catalog-content" class="product-catalog-content" data-product-catalog-content >/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-time-unit-fields/);
    assert.ok(
      runtime.appNode.innerHTML.indexOf("data-product-catalog-management")
        < runtime.appNode.innerHTML.indexOf("data-modeling-form-time-unit-fields"),
      "time unit fields should immediately follow the product catalog in DOM order"
    );
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

test("product catalog collapse preserves query and unsaved editor state across rerenders", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-modeling-form-management",
    sessionUser: { username: "admin", role: "系统管理员" },
    projectJson: createRuntimeProjectJson({
      products: [{ id: "product-one", name: "单一产品", model: "M-1", kind: "LRU" }],
      components: [],
      supportResources: [],
      supportNodes: [],
      supportActivities: [],
      supportActivityJobs: [],
      transportPolicies: []
    })
  });

  try {
    await runtime.input("[data-product-catalog-query]", {}, { value: "单一" });
    await runtime.click("[data-product-catalog-edit]", { productCatalogEdit: "product-one" });
    await runtime.input(
      "[data-product-catalog-field]",
      { productCatalogField: "name" },
      { value: "未保存编辑名称" }
    );
    await runtime.click("[data-product-catalog-collapse-toggle]");

    assert.match(runtime.appNode.innerHTML, /data-product-catalog-state="collapsed"/);
    assert.match(runtime.appNode.innerHTML, /aria-expanded="false"/);
    assert.match(runtime.appNode.innerHTML, /aria-label="展开产品列表"/);
    assert.match(runtime.appNode.innerHTML, /<span>展开列表<\/span>/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-content hidden/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-field="name" value="未保存编辑名称"/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-form-time-unit-fields/);

    await runtime.change(
      "[data-modeling-form-unit]",
      { modelingFormUnit: "equipment-system:mtbfHours" },
      { value: "分钟" }
    );
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-state="collapsed"/);

    await runtime.setHash("feature=system-management-user-management");
    await runtime.setHash("feature=system-management-modeling-form-management");
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-state="collapsed"/);

    await runtime.click("[data-product-catalog-collapse-toggle]");
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-state="expanded"/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-query value="单一"|value="单一" placeholder="搜索产品 ID、名称或型号" data-product-catalog-query/);
    assert.match(runtime.appNode.innerHTML, /data-product-catalog-field="name" value="未保存编辑名称"/);
    assert.match(runtime.appNode.innerHTML, /product-one/);
  } finally {
    runtime.restore();
  }
});

test("product catalog collapse handles zero, one, and multiple products", async () => {
  const cases = [
    { products: [], expectedCount: 0, expectedContent: /暂无匹配产品/ },
    { products: [{ id: "product-one", name: "单一产品", model: "M-1", kind: "LRU" }], expectedCount: 1, expectedContent: /单一产品/ },
    {
      products: [
        { id: "product-one", name: "产品一", model: "M-1", kind: "LRU" },
        { id: "product-two", name: "产品二", model: "M-2", kind: "SRU" },
        { id: "product-three", name: "产品三", model: "M-3", kind: "非LRU" }
      ],
      expectedCount: 3,
      expectedContent: /产品三/
    }
  ];

  for (const testCase of cases) {
    const runtime = await setupRuntimeApp({
      hash: "feature=system-management-modeling-form-management",
      sessionUser: { username: "admin", role: "系统管理员" },
      projectJson: createRuntimeProjectJson({
        products: testCase.products,
        components: [],
        supportResources: [],
        supportNodes: [],
        supportActivities: [],
        supportActivityJobs: [],
        transportPolicies: []
      })
    });

    try {
      assert.match(runtime.appNode.innerHTML, new RegExp(`${testCase.expectedCount} 项`));
      assert.match(runtime.appNode.innerHTML, testCase.expectedContent);
      await runtime.click("[data-product-catalog-collapse-toggle]");
      assert.match(runtime.appNode.innerHTML, /data-product-catalog-content hidden/);
      assert.match(runtime.appNode.innerHTML, /data-modeling-form-time-unit-fields/);
      await runtime.click("[data-product-catalog-collapse-toggle]");
      assert.match(runtime.appNode.innerHTML, testCase.expectedContent);
    } finally {
      runtime.restore();
    }
  }
});

test("visual Mesa page renders Solara iframe shell", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-visual-shell",
      config: {
        name: "可视化壳层方案",
        steps: 5,
        samples: 1,
        seed: 11,
        projectJson: createRuntimeProjectJson({ project_id: "project-visual-shell" })
      }
    }]
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-visual-shell" }
    );

    assert.match(runtime.appNode.innerHTML, /data-mesa-control="reload-solara"/);
    const visualHero = htmlSectionByClass(runtime.appNode.innerHTML, "mesa-visual-toolbar");
    assert.match(visualHero, /<strong>可视化推演<\/strong>/);
    assert.match(visualHero, /data-current-experiment-plan/);
    assert.match(runtime.appNode.innerHTML, /data-solara-visualization-frame/);
    assert.match(runtime.appNode.innerHTML, /class="solara-visualization-frame"/);
    assert.match(runtime.appNode.innerHTML, /title="Solara 可视化推演"/);
    assert.match(runtime.appNode.innerHTML, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Solara 可视化内嵌页/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /mesa-control-deck|mesa-control-status|仿真状态/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /飞机保障独立 Mesa 仿真/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /点击可视化推演后直接读取当前 Project/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<div class="mesa-clock"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /独立 Mesa/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-mesa-control="play"|data-mesa-view|data-mesa-timeline/);
  } finally {
    runtime.restore();
  }
});

test("visual iframe hides legacy support selector from the host page", async () => {
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
    assert.match(runtime.appNode.innerHTML, /data-solara-visualization-frame/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Solara 可视化内嵌页/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Solara Mesa iframe|iframe:/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-mesa-support-airport/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /当前保障点资源/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="甲机场"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /甲机场 \/ 保障点/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /航母飞行甲板 \/ 保障点 航母飞行甲板、前出海上保障点/);
  } finally {
    runtime.restore();
  }
});

test("visual iframe host page does not expose support organization selector rows", async () => {
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
    assert.match(runtime.appNode.innerHTML, /data-solara-visualization-frame/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-mesa-support-airport/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="基地" selected>基地<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="mechanic-team"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="test-equipment"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="航母飞行甲板" selected>航母飞行甲板<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<option value="support-resource-1"/);
  } finally {
    runtime.restore();
  }
});

test("configurable result analysis pages omit Mesa from visible copy", async () => {
  const featureIds = [
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
      const isDowntime = featureId === "mission-reliability-downtime-factor-analysis";
      assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>/);
      assert.match(runtime.appNode.innerHTML, /尚未运行分析/);
      assert.doesNotMatch(runtime.appNode.innerHTML, /lite-mesa-source-grid/);
      assert.doesNotMatch(runtime.appNode.innerHTML, /输出边界|持久化/);
      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      assert.doesNotMatch(settingsPanel, /样本量 \/ 随机种子只读/);
      const expectedSamples = isDowntime ? "1" : "27";
      assert.match(settingsPanel, new RegExp(`样本量[\\s\\S]*<strong>${expectedSamples}<\\/strong>`));
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>20260621<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
      for (const hiddenLabel of ["项目", "当前项目", "分析对象", "结果内容"]) {
        assert.doesNotMatch(settingsPanel, new RegExp(`<span>${hiddenLabel}<\\/span>`), `${featureId} should hide ${hiddenLabel} from its analysis settings`);
      }
      const contextPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
      assert.match(contextPanel, /运行上下文/);
      assert.match(contextPanel, /data-current-experiment-plan/);
      assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-hero">/);
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

test("aircraft mission reliability page runs explicitly and exports retained summaries as XLSX without node details", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-aircraft-mission-reliability",
    projectJson: createRuntimeProjectJson({
      basicMissions: [{
        id: "mission-5h",
        name: "五小时任务剖面",
        equipmentType: "J-15",
        taskDurationMinutes: 300
      }],
      components: [
        { id: "a1", name: "产品 A1", aircraftModel: "J-15", quantity: 1, failureRate: 0.01 },
        { id: "a2", name: "产品 A2", aircraftModel: "J-15", quantity: 1, failureRate: 0.02 }
      ]
    }),
    experimentPlans: [{
      experiment_plan_id: "plan-reliability-j16",
      status: "draft",
      config: {
        name: "J-16 可靠性方案",
        projectJson: createRuntimeProjectJson({
          project_id: "project-runtime-j16",
          equipment: { model: "J-16", wholeMachineModels: ["J-16"] },
          basicMissions: [{
            id: "mission-j16-2h",
            name: "J-16 两小时任务",
            equipmentType: "J-16",
            taskDurationMinutes: 120
          }],
          components: [{ id: "j16-root", name: "J-16 整机", aircraftModel: "J-16", failureRate: 0.05 }]
        })
      }
    }]
  });

  try {
    assert.match(runtime.appNode.innerHTML, /飞机任务可靠性评估/);
    assert.match(runtime.appNode.innerHTML, /aria-label="飞机型号"/);
    assert.match(runtime.appNode.innerHTML, /五小时任务剖面/);
    assert.match(runtime.appNode.innerHTML, /value="5"/);
    assert.match(runtime.appNode.innerHTML, /class="page-head-current-context experiment-plan-context-select"/);
    assert.match(runtime.appNode.innerHTML, /飞机任务可靠性评估[\s\S]*运行上下文/);
    assert.match(runtime.appNode.innerHTML, /data-aircraft-reliability-action="run">运行分析<\/button>/);
    assert.match(runtime.appNode.innerHTML, /请选择飞机型号和任务剖面后运行分析/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /整机任务可靠度/);
    await runtime.click("[data-aircraft-reliability-action]", { aircraftReliabilityAction: "run" });
    assert.match(runtime.appNode.innerHTML, /整机任务可靠度/);
    assert.match(runtime.appNode.innerHTML, /<strong>0\.861<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<em>86\.071%<\/em>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /0\.86070798|86\.0708%/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /依据任务时长和装备可靠性框图|可靠性框图与产品参数自动读取/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /可靠性框图<\/span>[\s\S]*个节点|保存分析结果|导出计算明细 CSV/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /节点名称|节点类型|串并联关系|产品可靠性参数|节点失效概率/);
    assert.match(runtime.appNode.innerHTML, /data-aircraft-reliability-action="export">导出<\/button>/);
    assert.equal(runtime.requests.some((request) => request.url === "/api/mesa-analysis-runs"), false);

    await runtime.change("[data-aircraft-reliability-field]", { aircraftReliabilityField: "durationHours" }, {
      value: "10",
      type: "number"
    });
    assert.match(runtime.appNode.innerHTML, /value="10"/);
    assert.match(runtime.appNode.innerHTML, /分析输入已更新，请重新运行/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<strong>0\.741<\/strong>/);
    await runtime.click("[data-aircraft-reliability-action]", { aircraftReliabilityAction: "run" });
    assert.match(runtime.appNode.innerHTML, /<strong>0\.741<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /<em>74\.082%<\/em>/);

    const saveRequest = runtime.requests.find((request) => (
      request.url === "/api/projects/project-runtime/aircraft-mission-reliability-analyses"
      && (request.options.method || "GET") === "POST"
    ));
    assert.equal(saveRequest, undefined);

    await runtime.click("[data-aircraft-reliability-action]", { aircraftReliabilityAction: "export" });
    assert.equal(runtime.downloads.length, 1);
    assert.match(runtime.downloads[0].download, /^aircraft-mission-reliability-J-15\.xlsx$/);
    assert.equal(runtime.downloads[0].blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const workbookEntries = storedZipEntries(new Uint8Array(await runtime.downloads[0].blob.arrayBuffer()));
    const worksheet = workbookEntries.get("xl/worksheets/sheet1.xml");
    assert.match(worksheet, /任务时长（小时）[\s\S]*<v>10<\/v>/);
    assert.match(worksheet, /整机任务可靠度[\s\S]*<v>0\.7408182206817178<\/v>/);
    assert.doesNotMatch(worksheet, /产品 A1|节点名称|串并联关系/);

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-reliability-j16" }
    );
    assert.match(runtime.appNode.innerHTML, /J-16 可靠性方案/);
    assert.match(runtime.appNode.innerHTML, /<option value="J-16" selected>J-16<\/option>/);
    assert.match(runtime.appNode.innerHTML, /J-16 两小时任务/);
    assert.match(runtime.appNode.innerHTML, /value="2"/);
    assert.match(runtime.appNode.innerHTML, /运行上下文已更新，请重新运行/);
    await runtime.click("[data-aircraft-reliability-action]", { aircraftReliabilityAction: "run" });
    assert.match(runtime.appNode.innerHTML, /<strong>0\.905<\/strong>/);
  } finally {
    runtime.restore();
  }
});

test("spare shortfall analysis restores context and settings while preserving result sorting", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-spare-shortfall-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-hero">[\s\S]*<h3>备件短板分析<\/h3>[\s\S]*运行上下文/);
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-settings lite-mesa-analysis-settings">/);
    assert.match(runtime.appNode.innerHTML, /<h3>分析设定<\/h3>[\s\S]*运行状态[\s\S]*样本量[\s\S]*随机种子/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /样本量 \/ 随机种子只读/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>[\s\S]*等待运行/);
    assert.match(runtime.appNode.innerHTML, /class="lite-mesa-stat-section lite-mesa-analysis-detail"/);
    assert.match(runtime.appNode.innerHTML, /分析结果明细/);

    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisRun.analysis_type, "spare_shortfall");
    assert.equal(analysisRun.settings.samples, 27);
    assert.equal(analysisRun.settings.seed, 20260621);
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-settings lite-mesa-analysis-settings">[\s\S]*分析结果已生成/);
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

test("spare shortfall result filters products and stably sorts demand quantity or fill rate", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-spare-shortfall-analysis",
    projectJson: createRuntimeProjectJson({
      products: [
        { id: "product-engine", name: "发动机控制模块", model: "EC-15", kind: "LRU" },
        { id: "product-radar", name: "雷达组件", model: "RD-35", kind: "LRU" },
        { id: "product-hydraulic", name: "液压组件", model: "HY-15", kind: "LRU" },
        { id: "product-backup", name: "备用组件", model: "BK-15", kind: "LRU" },
        { id: "product-generic", name: "泛化组件", model: "ALL", kind: "LRU" }
      ]
    }),
    liteMesaAnalysisResponseOverrides: {
      metrics: [
        ["发生缺件备件", "4"],
        ["平均备件延误时间(h)", "1.50"],
        ["最高缺件备件", "发动机控制模块、雷达组件"],
        ["因维修延误导致的任务取消次数", "2"]
      ],
      rows: [
        { aircraftModel: "J-15", productId: "product-engine", spareType: "不得显示的旧发动机备件", demand: 8, filled: 3, meanTransportDelayHours: 1.5, fillRate: 0.38, riskLevel: "高" },
        { aircraftModel: "J-35", productId: "product-radar", spareType: "不得显示的旧雷达备件", demand: 2, filled: 1, meanTransportDelayHours: 1.5, fillRate: 0.6, riskLevel: "中" },
        { aircraftModel: "J-15", productId: "product-hydraulic", spareType: "不得显示的旧液压备件", demand: 5, filled: 4, meanTransportDelayHours: 0, fillRate: 0.8, riskLevel: "低" },
        { aircraftModel: "J-15", productId: "product-backup", spareType: "不得显示的旧备用备件", demand: 5, filled: 4, meanTransportDelayHours: 0, fillRate: 0.8, riskLevel: "低" },
        { aircraftModel: "全部机型", productId: "product-generic", spareType: "不得显示的旧泛化备件", demand: 99, filled: 0, meanTransportDelayHours: 0, fillRate: 0, riskLevel: "高" }
      ]
    }
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    assert.match(runtime.appNode.innerHTML, /<th>机型<\/th><th>产品<\/th>/);
    assert.match(runtime.appNode.innerHTML, /发动机控制模块 \/ EC-15/);
    assert.match(runtime.appNode.innerHTML, /雷达组件 \/ RD-35/);
    assert.match(runtime.appNode.innerHTML, /data-spare-shortfall-sort="demand" data-sort-direction="asc"/);
    assert.match(runtime.appNode.innerHTML, /data-spare-shortfall-sort="fillRate" data-sort-direction="desc"/);
    assert.match(runtime.appNode.innerHTML, /data-spare-aircraft-filter/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /不得显示的旧|泛化组件|<td>全部机型<\/td>|<span>需求数量排序<\/span>|恢复默认/);

    await runtime.change("[data-spare-aircraft-filter]", {}, { value: "J-15" });
    await runtime.click("[data-spare-shortfall-sort]", { spareShortfallSort: "demand", sortDirection: "asc" });
    let tableRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(tableRows.indexOf("液压组件 / HY-15") < tableRows.indexOf("备用组件 / BK-15"), "equal demand rows preserve source order");
    assert.ok(tableRows.indexOf("备用组件 / BK-15") < tableRows.indexOf("发动机控制模块 / EC-15"));
    assert.doesNotMatch(tableRows, /J-35|雷达组件/);
    assert.match(runtime.appNode.innerHTML, /data-spare-shortfall-sort="demand" data-sort-direction="asc"[^>]*aria-pressed="true"/);

    await runtime.click("[data-spare-shortfall-sort]", { spareShortfallSort: "demand", sortDirection: "desc" });
    tableRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(tableRows.indexOf("发动机控制模块 / EC-15") < tableRows.indexOf("液压组件 / HY-15"));
    assert.ok(tableRows.indexOf("液压组件 / HY-15") < tableRows.indexOf("备用组件 / BK-15"), "equal demand rows remain stable descending");

    await runtime.click("[data-spare-shortfall-sort]", { spareShortfallSort: "fillRate", sortDirection: "asc" });
    tableRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(tableRows.indexOf("发动机控制模块 / EC-15") < tableRows.indexOf("液压组件 / HY-15"));

    await runtime.click("[data-spare-shortfall-sort]", { spareShortfallSort: "fillRate", sortDirection: "desc" });
    tableRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(tableRows.indexOf("液压组件 / HY-15") < tableRows.indexOf("备用组件 / BK-15"), "equal fill-rate rows preserve source order");
    assert.ok(tableRows.indexOf("备用组件 / BK-15") < tableRows.indexOf("发动机控制模块 / EC-15"));
    assert.match(runtime.appNode.innerHTML, /data-spare-shortfall-sort="fillRate" data-sort-direction="desc"[^>]*aria-pressed="true"/);
  } finally {
    runtime.restore();
  }
});

test("carry list result exposes satisfaction, zero-demand, life-limit, and aircraft UI", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson: createRuntimeProjectJson({
      products: [
        { id: "product-engine", name: "发动机控制模块", model: "EC-15", kind: "LRU" },
        { id: "product-radar", name: "雷达组件", model: "RD-35", kind: "LRU" },
        { id: "product-zero", name: "零需求产品", model: "ZERO", kind: "LRU" }
      ]
    }),
    liteMesaAnalysisResponseOverrides: {
      metrics: [
        ["建议携行总数", "7"],
        ["高优先级备件", "1"]
      ],
      rows: [
        { aircraftModel: "J-15", productId: "product-engine", spareType: "不得显示的旧发动机备件", recommended: 5, demand: 6, shortage: 1, riskLevel: "高", lifeLimited: true, lifeLandings: 120, lifeHours: 240 },
        { aircraftModel: "J-35", productId: "product-radar", spareType: "不得显示的旧雷达备件", recommended: 2, demand: 2, shortage: 0, riskLevel: "低", lifeLimited: false, lifeLandings: 0, lifeHours: 0 },
        { aircraftModel: "J-15", productId: "product-zero", spareType: "不得显示的旧零需求备件", recommended: 0, demand: 0, shortage: 0, riskLevel: "低", lifeLimited: false, lifeLandings: 0, lifeHours: 0 }
      ]
    }
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const detailPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-analysis-detail");
    assert.match(detailPanel, /<th>机型<\/th><th>产品<\/th>/);
    assert.match(detailPanel, /隐藏需求数值为 0 的备件/);
    assert.match(detailPanel, /data-carry-hide-zero checked/);
    assert.match(detailPanel, /data-carry-aircraft-filter/);
    assert.match(detailPanel, /data-carry-recommended-sort="asc"[\s\S]*data-carry-recommended-sort="desc"/);
    assert.match(detailPanel, /aria-label="有寿件说明" aria-describedby="carry-life-limited-tooltip"/);
    assert.match(detailPanel, /id="carry-life-limited-tooltip" class="carry-life-tooltip" role="tooltip">有寿件寿命在预防性维修中配置；起落次数或使用时间任一达到阈值即计入需求。/);
    assert.doesNotMatch(detailPanel, /<span>有寿件寿命在预防性维修中配置/);
    assert.match(detailPanel, /J-15[\s\S]*发动机控制模块 \/ EC-15/);
    assert.match(detailPanel, /J-35[\s\S]*雷达组件 \/ RD-35/);
    assert.match(detailPanel, /发动机控制模块 \/ EC-15[\s\S]*<td>是<\/td><td>120<\/td><td>240<\/td>/);
    assert.doesNotMatch(detailPanel, /不得显示的旧|零需求产品/);

    await runtime.click("[data-carry-recommended-sort]", { carryRecommendedSort: "asc" });
    const ascendingRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(ascendingRows.indexOf("雷达组件 / RD-35") < ascendingRows.indexOf("发动机控制模块 / EC-15"));
    assert.match(runtime.appNode.innerHTML, /data-carry-recommended-sort="asc"[^>]*aria-label="按建议携行数量升序排列" aria-pressed="true"/);

    await runtime.click("[data-carry-recommended-sort]", { carryRecommendedSort: "desc" });
    const descendingRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.ok(descendingRows.indexOf("发动机控制模块 / EC-15") < descendingRows.indexOf("雷达组件 / RD-35"));
    assert.match(runtime.appNode.innerHTML, /data-carry-recommended-sort="desc"[^>]*aria-label="按建议携行数量降序排列" aria-pressed="true"/);

    await runtime.change("[data-carry-aircraft-filter]", {}, { value: "J-15" });
    const j15Rows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.match(j15Rows, /J-15[\s\S]*发动机控制模块/);
    assert.doesNotMatch(j15Rows, /J-35|雷达组件/);

    await runtime.change("[data-carry-hide-zero]", {}, { checked: false });
    const filteredAndSortedRows = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<table class="lite-mesa-stat-table">'));
    assert.match(filteredAndSortedRows, /零需求产品 \/ ZERO/);
    assert.ok(filteredAndSortedRows.indexOf("发动机控制模块 / EC-15") < filteredAndSortedRows.indexOf("零需求产品 / ZERO"));
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

test("carry list analysis restores context and complete settings while preserving result loading", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-hero">[\s\S]*<h3>飞机转场携行清单分析<\/h3>[\s\S]*运行上下文/);
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-settings lite-mesa-analysis-settings">/);
    assert.match(runtime.appNode.innerHTML, /运行状态[\s\S]*样本量[\s\S]*随机种子[\s\S]*优化方向[\s\S]*备件满足率下限/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /样本量 \/ 随机种子只读/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>[\s\S]*等待运行/);
    assert.match(runtime.appNode.innerHTML, /分析结果明细/);

    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisRun.analysis_type, "carry_list");
    assert.equal(analysisRun.settings.missionConfidenceTarget, 0.9);
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-settings lite-mesa-analysis-settings">[\s\S]*分析结果已生成/);
  } finally {
    runtime.restore();
  }
});

test("task reliability analysis restores its title and project context", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-hero">[\s\S]*<h3>任务可靠度评估<\/h3>[\s\S]*运行上下文/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan|运行上下文|当前项目：Runtime 项目/);
    assert.match(runtime.appNode.innerHTML, /lite-mesa-hero[\s\S]*lite-mesa-settings lite-mesa-analysis-settings/);
    assert.match(runtime.appNode.innerHTML, /<h3>分析设定<\/h3>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /样本量 \/ 随机种子只读/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /时间窗口|maxTimeWindow/);
    assert.match(runtime.appNode.innerHTML, /<h3>分析结果明细<\/h3>/);
    assert.match(runtime.appNode.innerHTML, /data-lite-mesa-analysis-action="run">运行分析<\/button>/);
  } finally {
    runtime.restore();
  }
});

test("task reliability analysis renders the ordered four-field contract and ignores legacy time-window state", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-task-reliability",
    projectJson: createRuntimeProjectJson(),
    liteMesaAnalysisResponseOverrides: {
      result_fields: [
        { key: "period_duration_days", value: 2.125, display_value: "2.13 天" },
        { key: "period_completion_probability", value: 0.9225, display_value: "92.3%" },
        { key: "wave_success_rate", value: 0.8, display_value: "80%" },
        { key: "sortie_rate", value: 0.8125, display_value: "0.813" }
      ]
    }
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "mission_reliability");
    assert.ok(analysisRun);
    assert.equal("maxTimeWindow" in analysisRun.settings, false);

    const detailPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-analysis-detail");
    assert.match(detailPanel, /<thead><tr><th>出动架次率<\/th><th>波次成功率<\/th><th>整周期任务可靠度<\/th><th>任务周期<\/th><\/tr><\/thead>/);
    assert.match(detailPanel, /<tbody><tr><td>0\.812<\/td><td>80%<\/td><td>92\.2%<\/td><td>2\.12 天<\/td><\/tr><\/tbody>/);
    assert.match(detailPanel, /波次成功率趋势/);
    assert.match(runtime.appNode.innerHTML, /class="line-chart"/);
    assert.match(runtime.appNode.innerHTML, /line-chart-y-axis/);
    assert.match(detailPanel, /<title>第1天 第1波：75%<\/title>/);
    assert.match(runtime.appNode.innerHTML, />1\.0<\/text>/);
    assert.match(runtime.appNode.innerHTML, />0\.5<\/text>/);
    assert.match(runtime.appNode.innerHTML, />0\.0<\/text>/);
    assert.doesNotMatch(detailPanel, /任务剖面可靠性|仿真实验总次数|整周期任务成功次数|整周期任务失败次数|任务可靠度百分比|样本明细|平均任务成功率/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /<span>时间窗口<\/span>|data-lite-mesa-analysis-field="maxTimeWindow"/);
  } finally {
    runtime.restore();
  }
});

test("downtime factors analysis restores title, context, settings, and explicit run controls", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-downtime-factor-analysis",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.match(settingsPanel, /排序范围[\s\S]*data-lite-mesa-analysis-field="topN"[\s\S]*value="4"/);
    assert.match(settingsPanel, /后端按累计停机时长生成排行[\s\S]*限制返回的停机事件快照明细数量/);
    assert.doesNotMatch(settingsPanel, /实验类型|统计口径/);
    assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
    assert.doesNotMatch(settingsPanel, /快照能力|会话内只读解释/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /样本量 \/ 随机种子只读/);
    const heroPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(heroPanel, /停机因素分析[\s\S]*运行上下文[\s\S]*data-current-experiment-plan/);
    assert.match(settingsPanel, /data-lite-mesa-analysis-action="run">运行分析<\/button>[\s\S]*等待运行/);
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
    projectJson: createRuntimeProjectJson({
      products: [{ id: "hyd-pump", name: "液压泵", model: "HP-01", kind: "LRU" }]
    })
  });

  try {
    await runtime.change(
      "[data-lite-mesa-analysis-field]",
      { liteMesaAnalysisField: "topN" },
      { value: "7", type: "number" }
    );
    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "downtime_factors");
    assert.ok(analysisRequest, "downtime analysis should submit a lightweight Mesa analysis request");
    assert.equal(analysisRequest.model_family, "aircraft_support_v1");
    assert.equal(analysisRequest.settings.samples, 1);
    assert.equal(analysisRequest.settings.topN, 7);
    assert.match(runtime.appNode.innerHTML, /分析结果已生成|分析完成/);
    const detailPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-analysis-detail");
    assert.doesNotMatch(detailPanel, /样本数/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /正式 current-analysis/);
    assert.match(runtime.appNode.innerHTML, /停机事件一览/);
    assert.match(runtime.appNode.innerHTML, /备件短缺/);
    assert.match(runtime.appNode.innerHTML, /保障作业/);
    assert.match(runtime.appNode.innerHTML, /任务因备件短缺延误/);
    assert.match(runtime.appNode.innerHTML, /航母飞行甲板/);
    assert.match(runtime.appNode.innerHTML, /未记录保障资源名称/);
    assert.match(runtime.appNode.innerHTML, /未记录备件名称/);
    assert.match(runtime.appNode.innerHTML, /液压泵/);
    assert.match(runtime.appNode.innerHTML, /DAY_1 00:42/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /carrier-deck|unknown-resource-id|unknown-product-id|hyd-pump|repair-J15-101|mission_delayed_by_spare_shortage|seed |t=/);
    assert.match(runtime.appNode.innerHTML, /<details class="lite-mesa-event-snapshot" open>/);
  } finally {
    runtime.restore();
  }
});

test("downtime factor filters keep localized summaries, ranking, and complete event details without rerunning", async () => {
  const event = (factor, durationHours, description, details = {}, phase = "", missionName = "") => ({
    event_id: `event-${factor}`,
    factor,
    tail_number: `AC-${factor}`,
    aircraft_type: "J-15",
    mission_id: missionName ? `mission-${factor}` : null,
    mission_name: missionName || null,
    mission_phase: phase,
    support_node_name: "前线保障点",
    start_minute: 60,
    end_minute: 60 + durationHours * 60,
    duration_minutes: durationHours * 60,
    duration_hours: durationHours,
    description,
    details
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-downtime-factor-analysis",
    projectJson: createRuntimeProjectJson(),
    liteMesaAnalysisResponseOverrides: {
      rows: [
        { label: "备件短缺", reason: "spare_shortage", count: 1, event_count: 1, downtime_hours: 2, duration_contribution: 0.2 },
        { label: "装备故障", reason: "failure", count: 1, event_count: 1, downtime_hours: 4, duration_contribution: 0.4 },
        { label: "保障设备短缺", reason: "equipment_shortage", count: 1, event_count: 1, downtime_hours: 1, duration_contribution: 0.1 },
        { label: "预防性维修", reason: "preventive", count: 1, event_count: 1, downtime_hours: 3, duration_contribution: 0.3 }
      ],
      event_details: [
        event("spare_shortage", 2, "液压泵等待到货", { spare_name: "液压泵", required_quantity: 2, available_quantity: 0, shortage_quantity: 2, arrival_minute: 180 }, "备件补给", "昼间制空任务"),
        event("failure", 4, "发动机控制器故障", { component_name: "发动机控制器", failure_mode: "随机故障", failure_minute: 60, repair_completed_minute: 300 }, "repair", "昼间制空任务"),
        event("equipment_shortage", 1, "检测仪被占用", { equipment_name: "综合检测仪", required_quantity: 1, available_quantity: 0, shortage_quantity: 1, wait_minutes: 60 }, "保障准备", "夜间巡逻任务"),
        event("preventive", 3, "定寿维修", { maintenance_item: "发动机定寿检查", trigger_condition: "使用寿命达到 240 小时", planned_start_minute: 60, completed_minute: null }, "preventive")
      ]
    }
  });

  try {
    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const initialRequestCount = runtime.requests.filter((request) => request.url === "/api/mesa-analysis-runs").length;
    const initial = runtime.appNode.innerHTML;
    assert.equal((initial.match(/data-downtime-factor-filter checked/g) || []).length, 4);
    assert.match(initial, /停机事件次数[\s\S]*<strong>4<\/strong>/);
    assert.match(initial, /累计停机时长[\s\S]*<strong>10\.00 小时<\/strong>/);
    assert.match(initial, /累计停机时长（小时）/);
    assert.match(initial, /持续时长（小时）/);
    assert.match(initial, /DAY_1 01:00[\s\S]*DAY_1 05:00/);
    assert.match(initial, /昼间制空任务；阶段：备件补给/);
    assert.match(initial, /夜间巡逻任务；阶段：保障准备/);
    assert.match(initial, /任务外事件；阶段：预防性维修/);
    assert.match(initial, /阶段：修复性维修/);
    assert.match(initial, /阶段：预防性维修/);
    assert.doesNotMatch(initial, /<td>repair<\/td>|<td>preventive<\/td>|>\d+(?:\.\d+)? min<|持续时长\(h\)|累计停机时长\(h\)/);
    assert.ok(initial.indexOf("装备故障</td>") < initial.indexOf("预防性维修</td>"));
    assert.ok(initial.indexOf("预防性维修</td>") < initial.indexOf("备件短缺</td>"));
    assert.match(initial, /所需备件短缺，当前作业正在等待补给/);
    assert.match(initial, /装备发生故障，当前不可用并等待修复/);
    assert.match(initial, /综合检测仪/);
    assert.match(initial, /发动机定寿检查/);
    assert.match(initial, /实际完成[\s\S]*暂无时间/);
    assert.doesNotMatch(initial, /液压泵等待到货|发动机控制器故障|检测仪被占用|定寿维修|未配置任务|任务名称未解析/);

    await runtime.change("[data-downtime-factor-filter]", {}, { value: "spare_shortage", checked: false });
    await runtime.change("[data-downtime-factor-filter]", {}, { value: "equipment_shortage", checked: false });
    await runtime.change("[data-downtime-factor-filter]", {}, { value: "preventive", checked: false });
    const failureOnly = runtime.appNode.innerHTML;
    assert.match(failureOnly, /停机事件次数[\s\S]*<strong>1<\/strong>/);
    assert.match(failureOnly, /累计停机时长[\s\S]*<strong>4\.00 小时<\/strong>/);
    assert.match(failureOnly, /装备发生故障，当前不可用并等待修复/);
    assert.doesNotMatch(failureOnly, /所需备件短缺，当前作业正在等待补给|保障设备不足，当前作业正在等待资源|装备正在执行预防性维修/);

    await runtime.change("[data-downtime-factor-filter]", {}, { value: "spare_shortage", checked: true });
    const combined = runtime.appNode.innerHTML;
    assert.match(combined, /停机事件次数[\s\S]*<strong>2<\/strong>/);
    assert.match(combined, /累计停机时长[\s\S]*<strong>6\.00 小时<\/strong>/);
    assert.match(combined, /所需备件短缺，当前作业正在等待补给/);
    assert.match(combined, /装备发生故障，当前不可用并等待修复/);

    await runtime.change("[data-downtime-factor-filter]", {}, { value: "failure", checked: false });
    await runtime.change("[data-downtime-factor-filter]", {}, { value: "spare_shortage", checked: false });
    assert.match(runtime.appNode.innerHTML, /请选择至少一种停机因素/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /downtime-factor-summary-table|所需备件短缺，当前作业正在等待补给|装备发生故障，当前不可用并等待修复/);
    assert.equal(runtime.requests.filter((request) => request.url === "/api/mesa-analysis-runs").length, initialRequestCount);
  } finally {
    runtime.restore();
  }
});

test("experiment and analysis pages render when Project draft has no root experiment config", async () => {
  const featureExpectations = [
    ["spare-planning-experiment-plan-management", /方案列表/],
    ["spare-planning-monte-carlo-experiment-detail", /蒙特卡洛分析/],
    ["spare-planning-spare-shortfall-analysis", /分析结果明细/]
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
    await waitForRuntimeHtml(
      runtime,
      /data-select-equipment-aircraft="J-15"/,
      "equipment project data should hydrate before rendering the aircraft list"
    );
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

test("equipment parent node selector uses Chinese names while retaining parent IDs", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      components: [
        { id: "engine-system", name: "发动机系统", aircraftModel: "J-15", parentId: "aircraft-root", productType: "LRU", quantity: 1 },
        { id: "control-unit", name: "控制单元", aircraftModel: "J-15", parentId: "engine-system", productType: "SRU", quantity: 1 }
      ]
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await waitForRuntimeHtml(
      runtime,
      /data-select-equipment-aircraft="J-15"/,
      "equipment project data should hydrate before selecting the aircraft"
    );
    await runtime.click("[data-select-equipment-aircraft]", { selectEquipmentAircraft: "J-15" });

    const rightPanel = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("equipment-system-table-panel"));
    assert.match(rightPanel, /<option value="aircraft-root" selected>整机级<\/option>/);
    assert.match(rightPanel, /<option value="engine-system" selected>发动机系统<\/option>/);
    assert.doesNotMatch(rightPanel, /value="engine-system"[^>]*>engine-system<\/option>/);
    assert.match(rightPanel, /class="equipment-template-action" data-equipment-download-template/);
    assert.match(rightPanel, /<label class="equipment-template-action">上传文件/);

    await runtime.change("[data-path]", { path: "components.1.parentId" }, { value: "aircraft-root" });
    assert.match(runtime.appNode.innerHTML, /<option value="aircraft-root" selected>整机级<\/option>/);
  } finally {
    runtime.restore();
  }
});

test("equipment template and current-model export keep product IDs in Chinese CSV round trips", async () => {
  let savedProject;
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      products: [
        { id: "product-aircraft-root", name: "整机产品", model: "J-15", kind: "整机" },
        { id: "product-whole-j15", name: "J-15 整机产品", model: "J-15", kind: "整机" },
        { id: "product-engine", name: "发动机产品", model: "WS-10", kind: "LRU" }
      ],
      components: [
        { id: "aircraft-root", name: "舰载机", productId: "product-aircraft-root", quantity: 2 },
        { id: "whole-aircraft", name: "J-15 整机", aircraftModel: "J-15", productId: "product-whole-j15", productType: "whole", quantity: 2 },
        { id: "engine-left", name: "左,发动机\n\"主机\"", model: "WS-10", aircraftModel: "J-15", parentId: "aircraft-root", productId: "product-engine", productType: "LRU", quantity: 1 },
        { id: "engine-right", name: "右发动机", model: "WS-10", aircraftModel: "J-15", parentId: "aircraft-root", productId: "product-engine", productType: "LRU", quantity: 1 }
      ]
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await waitForRuntimeHtml(runtime, /data-equipment-export-data/, "equipment export action should render");

    await runtime.click("[data-equipment-download-template]");
    assert.equal(runtime.downloads[0].download, "装备系统建模导入模板.csv");
    const template = await runtime.downloads[0].blob.text();
    assert.match(template, /^节点ID,父节点ID,产品ID,系统名称,型号,层级,安装数,运行比,MTBF,MTTR,维修分布类型/m);

    await runtime.click("[data-equipment-export-data]");
    assert.equal(runtime.downloads[1].download, "装备系统建模-J-15.csv");
    const exported = await runtime.downloads[1].blob.text();
    assert.equal((exported.match(/product-engine/g) || []).length, 2);
    assert.equal((exported.match(/product-aircraft-root/g) || []).length, 1);
    assert.equal((exported.match(/product-whole-j15/g) || []).length, 1);
    assert.match(exported, /whole-aircraft,,product-whole-j15,J-15 整机,,whole/);
    assert.match(exported, /engine-left,aircraft-root,product-engine,"左,发动机\n""主机""",WS-10/);
    assert.match(runtime.appNode.innerHTML, /已导出 J-15 装备结构/);

    const roundTripFile = { name: "装备系统建模-J-15.csv", async text() { return exported; } };
    await runtime.change("[data-equipment-import-file]", {}, { files: [roundTripFile], value: roundTripFile.name });
    assert.match(runtime.appNode.innerHTML, /已导入 装备系统建模-J-15\.csv：1 个整机，4 个组件/);
    await runtime.click("[data-project-draft-save]");
    savedProject = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "aircraft-root" && component.productId === "product-aircraft-root")
        && body.components?.some((component) => component.id === "whole-aircraft" && component.productId === "product-whole-j15")
        && body.components?.filter((component) => component.productId === "product-engine").length === 2,
      "exported product IDs should survive import and Project save"
    );
    assert.deepEqual(savedProject.components.map((component) => component.id), ["aircraft-root", "whole-aircraft", "engine-left", "engine-right"]);
    assert.equal(savedProject.components.find((component) => component.id === "whole-aircraft").parentId, undefined);
    assert.equal(savedProject.components.find((component) => component.id === "engine-left").name, "左,发动机\n\"主机\"");
    assert.equal(savedProject.products.filter((product) => product.id === "product-engine").length, 1);
  } finally {
    runtime.restore();
  }

  const reopenedRuntime = await setupRuntimeApp({
    hash: "feature=spare-planning-equipment-system",
    projectJson: savedProject
  });
  try {
    await waitForRuntimeHtml(reopenedRuntime, /data-equipment-export-data/, "saved equipment should hydrate after re-entering the page");
    await reopenedRuntime.click("[data-equipment-export-data]");
    const reexported = await reopenedRuntime.downloads[0].blob.text();
    assert.equal((reexported.match(/product-aircraft-root/g) || []).length, 1);
    assert.equal((reexported.match(/product-whole-j15/g) || []).length, 1);
    assert.equal((reexported.match(/product-engine/g) || []).length, 2);
    assert.match(reexported, /"左,发动机\n""主机"""/);
  } finally {
    reopenedRuntime.restore();
  }
});

test("minimal clean Project whole-aircraft root survives export import save rehydrate and reexport", async () => {
  const minimalProject = JSON.parse(fs.readFileSync(
    new URL("./fixtures/clean_projects/minimal_clean_project.json", import.meta.url),
    "utf8"
  ));
  let savedProject;
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 1 },
      components: minimalProject.components,
      products: minimalProject.products
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.click("[data-equipment-export-data]");
    const exported = await runtime.downloads[0].blob.text();
    assert.match(exported, /whole-aircraft,,product-whole-aircraft,whole aircraft,,whole/);

    const importFile = { name: "minimal-J-15.csv", async text() { return exported; } };
    await runtime.change("[data-equipment-import-file]", {}, { files: [importFile], value: importFile.name });
    assert.match(runtime.appNode.innerHTML, /已导入 minimal-J-15\.csv：1 个整机，1 个组件/);
    await runtime.click("[data-project-draft-save]");
    savedProject = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "whole-aircraft"),
      "minimal whole-aircraft root should survive Project save"
    );
    const savedRoot = savedProject.components.find((component) => component.id === "whole-aircraft");
    assert.equal(savedRoot.productId, "product-whole-aircraft");
    assert.equal(savedRoot.parentId, undefined);
    assert.equal(savedRoot.aircraftModel, "J-15");
  } finally {
    runtime.restore();
  }

  const reopenedRuntime = await setupRuntimeApp({
    hash: "feature=spare-planning-equipment-system",
    projectJson: savedProject
  });
  try {
    await waitForRuntimeHtml(reopenedRuntime, /data-equipment-export-data/, "minimal whole-aircraft root should rehydrate");
    await reopenedRuntime.click("[data-equipment-export-data]");
    const reexported = await reopenedRuntime.downloads[0].blob.text();
    assert.equal((reexported.match(/product-whole-aircraft/g) || []).length, 1);
    assert.match(reexported, /whole-aircraft,,product-whole-aircraft/);
  } finally {
    reopenedRuntime.restore();
  }
});

test("equipment import preserves shared existing product IDs and auto-fills only blank IDs on save", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      products: [{ id: "product-shared", name: "共享航电产品", model: "AV-1", kind: "LRU" }],
      components: [{ id: "old-node", name: "旧节点", aircraftModel: "J-15", parentId: "aircraft-root", productId: "product-shared", quantity: 1 }]
    })
  });
  const importFile = {
    name: "共享产品装备.csv",
    async text() {
      return [
        "节点ID,父节点ID,产品ID,系统名称,型号,层级,安装数,运行比,MTBF,MTTR,维修分布类型",
        "aircraft-root,,,J-15,J-15,整机,2,1,,,",
        "avionics-left,aircraft-root,product-shared,左航电,AV-1,LRU,1,0.8,1200,60,固定值",
        "avionics-right,aircraft-root,product-shared,右航电,AV-1,LRU,1,0.9,1300,70,正态分布",
        "sensor,avionics-left,,中文传感器,S-1,SRU,2,1,800,30,固定值"
      ].join("\n");
    }
  };

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.change("[data-equipment-import-file]", {}, { files: [importFile], value: importFile.name });

    assert.match(runtime.appNode.innerHTML, /已导入 共享产品装备\.csv：1 个整机，3 个组件/);
    assert.match(runtime.appNode.innerHTML, /左航电/);
    await runtime.click("[data-project-draft-save]");
    const saved = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "sensor"),
      "equipment product associations should persist in Project JSON"
    );
    const sharedComponents = saved.components.filter((component) => component.productId === "product-shared");
    const sensor = saved.components.find((component) => component.id === "sensor");
    assert.equal(sharedComponents.length, 2);
    assert.ok(sensor.productId);
    assert.notEqual(sensor.productId, "product-shared");
    assert.ok(saved.products.some((product) => product.id === sensor.productId));
    assert.equal(saved.products.filter((product) => product.id === "product-shared").length, 1);
    assert.equal(saved.components.find((component) => component.id === "avionics-left").parentId, "aircraft-root");
    assert.equal(saved.components.find((component) => component.id === "avionics-left").name, "左航电");
  } finally {
    runtime.restore();
  }
});

test("equipment import rejects unknown product IDs atomically with row and ID", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      products: [{ id: "product-known", name: "已知产品", model: "KNOWN", kind: "LRU" }],
      components: [{ id: "original-node", name: "原始节点", aircraftModel: "J-15", parentId: "aircraft-root", productId: "product-known", quantity: 1 }]
    })
  });
  const invalidFile = {
    name: "非法产品引用.csv",
    async text() {
      return [
        "节点ID,父节点ID,产品ID,系统名称,型号,层级,安装数,运行比,MTBF,MTTR,维修分布类型",
        "aircraft-root,,,J-15,J-15,整机,2,1,,,",
        "valid-new,aircraft-root,product-known,有效节点,V-1,LRU,1,1,1000,60,固定值",
        "invalid-new,aircraft-root,product-missing,非法节点,X-1,LRU,1,1,1000,60,固定值"
      ].join("\n");
    }
  };

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.change("[data-equipment-import-file]", {}, { files: [invalidFile], value: invalidFile.name });

    assert.match(runtime.appNode.innerHTML, /装备结构树导入失败：产品ID引用无效/);
    assert.match(runtime.appNode.innerHTML, /第4行产品ID“product-missing”/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /有效节点|非法节点/);
    await runtime.click("[data-project-draft-save]");
    const saved = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "original-node"),
      "failed equipment import should leave the original Project draft intact"
    );
    assert.deepEqual(saved.components.map((component) => component.id), ["original-node"]);
    assert.equal(saved.products.some((product) => product.id === "product-missing"), false);
  } finally {
    runtime.restore();
  }
});

test("nonstandard whole-root imports reject unknown and conflicting product IDs atomically", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 1 },
      products: [
        { id: "product-original", name: "原整机", model: "J-15" },
        { id: "product-a", name: "整机 A", model: "J-15A" },
        { id: "product-b", name: "整机 B", model: "J-15B" }
      ],
      components: [{ id: "whole-original", name: "原始整机", aircraftModel: "J-15", productType: "whole", productId: "product-original", quantity: 1 }]
    })
  });
  const unknownFile = {
    name: "unknown-whole.csv",
    async text() {
      return [
        "节点ID,父节点ID,产品ID,系统名称,型号,层级",
        "aircraft-root,,,J-15,J-15,整机",
        "whole-aircraft,,product-missing,J-15,J-15,whole"
      ].join("\n");
    }
  };
  const conflictFile = {
    name: "conflicting-whole.csv",
    async text() {
      return [
        "节点ID,父节点ID,产品ID,系统名称,型号,层级",
        "aircraft-root,,,J-15,J-15,整机",
        "whole-aircraft,,product-a,J-15,J-15,whole",
        "whole-aircraft,,product-b,J-15,J-15,whole"
      ].join("\n");
    }
  };

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");

    await runtime.change("[data-equipment-import-file]", {}, { files: [unknownFile], value: unknownFile.name });
    assert.match(runtime.appNode.innerHTML, /第3行产品ID“product-missing”/);
    await runtime.click("[data-project-draft-save]");
    let saved = projectSaveBodies(runtime).at(-1);
    assert.deepEqual(saved.components.map((component) => component.id), ["whole-original"]);

    await runtime.change("[data-equipment-import-file]", {}, { files: [conflictFile], value: conflictFile.name });
    assert.match(runtime.appNode.innerHTML, /产品ID引用冲突/);
    assert.match(runtime.appNode.innerHTML, /节点ID“whole-aircraft”/);
    await runtime.click("[data-project-draft-save]");
    saved = projectSaveBodies(runtime).at(-1);
    assert.deepEqual(saved.components.map((component) => component.id), ["whole-original"]);
  } finally {
    runtime.restore();
  }
});

test("equipment TSV and JSON imports preserve aliases, multiline values, root products and location semantics", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2 },
      products: [
        { id: "product-root", name: "整机产品", model: "J-15" },
        { id: "product-tsv", name: "TSV 产品", model: "TSV-1" },
        { id: "product-json", name: "JSON 产品", model: "JSON-1" }
      ],
      components: []
    })
  });
  const tsvFile = {
    name: "equipment.tsv",
    async text() {
      return [
        "\uFEFFid\tparent_id\tproduct_id\tname\tmodel\tlevel\tquantity\trunning_ratio\taircraftModel",
        "aircraft-root\t\tproduct-root\tJ-15\tJ-15\t整机\t2\t1\tJ-15",
        "tsv-node\taircraft-root\tproduct-tsv\t\"航电\t系统\r\n第二行\"\tTSV-1\tLRU\t1\t0.75\tJ-15"
      ].join("\r\n");
    }
  };
  const jsonFile = {
    name: "equipment.json",
    async text() {
      return JSON.stringify([
        { id: "aircraft-root", product_id: "product-root", name: "J-15", model: "J-15", level: "整机", quantity: 2 },
        { id: "json-node", parent_id: "aircraft-root", product_id: "product-json", name: "JSON 航电", model: "JSON-1", level: "LRU", quantity: 1, aircraftModel: "J-15" }
      ]);
    }
  };

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await runtime.change("[data-equipment-import-file]", {}, { files: [tsvFile], value: tsvFile.name });
    assert.match(runtime.appNode.innerHTML, /已导入 equipment\.tsv：1 个整机，2 个组件/);
    await runtime.click("[data-project-draft-save]");
    const savedTsv = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "tsv-node"),
      "TSV equipment import should save"
    );
    assert.equal(savedTsv.components.find((component) => component.id === "aircraft-root").productId, "product-root");
    assert.equal(savedTsv.components.find((component) => component.id === "tsv-node").name, "航电\t系统\r\n第二行");
    assert.equal(savedTsv.components.find((component) => component.id === "tsv-node").productId, "product-tsv");

    await runtime.change("[data-equipment-import-file]", {}, { files: [jsonFile], value: jsonFile.name });
    assert.match(runtime.appNode.innerHTML, /已导入 equipment\.json：1 个整机，2 个组件/);
    await runtime.click("[data-project-draft-save]");
    const savedJson = await waitForProjectSave(
      runtime,
      (body) => body.components?.some((component) => component.id === "json-node"),
      "JSON equipment import should save"
    );
    assert.equal(savedJson.components.find((component) => component.id === "aircraft-root").productId, "product-root");
    assert.equal(savedJson.components.find((component) => component.id === "json-node").productId, "product-json");
  } finally {
    runtime.restore();
  }
});

test("equipment product search waits for Enter or focusout before filtering", async () => {
  const runtime = await setupRuntimeApp({
    projectJson: createRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2, initialReady: 2, minRequiredSorties: 1 },
      products: [
        { id: "product-engine", name: "发动机产品", model: "ENGINE", kind: "LRU" },
        { id: "product-radar", name: "雷达产品", model: "RADAR", kind: "LRU" }
      ],
      components: [
        { id: "engine-system", name: "发动机系统", aircraftModel: "J-15", parentId: "aircraft-root", productId: "product-engine", productType: "LRU", quantity: 1 }
      ]
    })
  });

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-equipment-system");
    await waitForRuntimeHtml(runtime, /data-equipment-product-edit="engine-system"/, "equipment product editor should be available");
    await runtime.click("[data-equipment-product-edit]", { equipmentProductEdit: "engine-system" });

    let editorHtml = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("data-equipment-product-editor"));
    assert.match(editorHtml, /发动机产品/);
    assert.match(editorHtml, /雷达产品/);

    await runtime.input("[data-equipment-product-query]", {}, { value: "雷达" });
    editorHtml = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("data-equipment-product-editor"));
    assert.match(editorHtml, /发动机产品/);
    assert.match(editorHtml, /雷达产品/);

    let enterPrevented = false;
    await runtime.keydown("[data-equipment-product-query]", {}, {
      key: "Enter",
      value: "雷达",
      preventDefault() { enterPrevented = true; }
    });
    assert.equal(enterPrevented, true);
    editorHtml = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("data-equipment-product-editor"));
    assert.doesNotMatch(editorHtml, /发动机产品/);
    assert.match(editorHtml, /雷达产品/);
    assert.match(editorHtml, /value="雷达"[^>]*data-equipment-product-query/);

    await runtime.input("[data-equipment-product-query]", {}, { value: "发动机" });
    editorHtml = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("data-equipment-product-editor"));
    assert.match(editorHtml, /雷达产品/);
    await runtime.focusout("[data-equipment-product-query]", {}, { value: "发动机" });
    editorHtml = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf("data-equipment-product-editor"));
    assert.match(editorHtml, /发动机产品/);
    assert.doesNotMatch(editorHtml, /雷达产品/);
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
    await waitForRuntimeHtml(
      runtime,
      /data-select-equipment-aircraft="J-15"/,
      "equipment project data should hydrate before renaming the aircraft"
    );
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
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /装备 RMS 指标分配/);
    assert.match(runtime.appNode.innerHTML, /请先选择飞机型号/);
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    assert.doesNotMatch(runtime.appNode.innerHTML, /基准机型/);

    await runtime.change("[data-rms-path]", { rmsPath: "methods.allocation" }, { value: "similar" });

    assert.match(runtime.appNode.innerHTML, /基准机型/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /相似修正系数|比例修正系数/);
    assert.match(runtime.appNode.innerHTML, /data-rms-path="methods\.similarProduct\.sourceModel"/);
  } finally {
    runtime.restore();
  }
});

test("RMS method changes invalidate the current aircraft result until recalculation completes", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    await new Promise((resolve) => setTimeout(resolve, 2050));
    const initialResultPanel = htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel");
    assert.match(initialResultPanel, /25%/);

    await runtime.change("[data-rms-path]", { rmsPath: "methods.allocation" }, { value: "proportional" });

    assert.match(runtime.appNode.innerHTML, /<option value="proportional" selected>比例分配法<\/option>/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /data-rms-action="export-excel" disabled/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /rms-calculation-overlay/);

    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.match(runtime.appNode.innerHTML, /rms-calculation-overlay/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="calculating"[^>]*>计算进行中/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);

    await new Promise((resolve) => setTimeout(resolve, 2050));

    assert.doesNotMatch(runtime.appNode.innerHTML, /rms-calculation-overlay/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /40%/);
  } finally {
    runtime.restore();
  }
});

test("RMS calculation shows a blocking two-second progress state before completing", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /data-rms-action="export-excel" disabled/);
    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.match(runtime.appNode.innerHTML, /rms-calculation-overlay/);
    assert.match(runtime.appNode.innerHTML, /data-rms-action="calculate" disabled>计算进行中/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="calculating"[^>]*>计算进行中/);

    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.match(runtime.appNode.innerHTML, /data-rms-action="calculate" disabled>计算进行中/);

    await new Promise((resolve) => setTimeout(resolve, 2050));

    assert.doesNotMatch(runtime.appNode.innerHTML, /rms-calculation-overlay/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="completed"[^>]*>计算完成/);
    assert.match(runtime.appNode.innerHTML, /计算完成。/);
  } finally {
    runtime.restore();
  }
});

test("RMS aircraft selector filters the project equipment tree and similar references", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });

  try {
    assert.match(runtime.appNode.innerHTML, /<option value="J-15" >J-15<\/option>/);
    assert.match(runtime.appNode.innerHTML, /<option value="J-20" >J-20<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /J-15 发动机|J-20 雷达/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    assert.match(runtime.appNode.innerHTML, /J-15 发动机/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /J-20 雷达/);

    await runtime.change("[data-rms-path]", { rmsPath: "methods.allocation" }, { value: "similar" });
    const methodPanel = htmlSectionByClass(runtime.appNode.innerHTML, "rms-method-panel");
    assert.match(methodPanel, /基准机型/);
    assert.match(methodPanel, /<option value="J-20" selected>J-20<\/option>/);
    assert.doesNotMatch(methodPanel, /<option value="J-15"[^>]*>J-15<\/option>/);
  } finally {
    runtime.restore();
  }
});

test("案例1 RMS aircraft selection renders the legacy project equipment tree without a root cycle", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createCase1RmsRuntimeProjectJson()
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    const tree = runtime.appNode.innerHTML;
    assert.match(tree, /data-rms-equipment-root="rms:J-15:aircraft-root"/);
    assert.match(tree, /发动机/);
    assert.match(tree, /发动机控制模块/);
    assert.doesNotMatch(tree, /J-35 雷达/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /当前机型暂无装备结构/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-35" });
    const j35Tree = runtime.appNode.innerHTML;
    assert.match(j35Tree, /J-35 雷达/);
    assert.doesNotMatch(j35Tree, /发动机控制模块/);
  } finally {
    runtime.restore();
  }
});

test("案例-大 RMS aircraft selection preserves rootless component hierarchy across models", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createCaseLargeRmsRuntimeProjectJson()
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J16" });
    const j16Tree = runtime.appNode.innerHTML;
    assert.match(j16Tree, /结构/);
    assert.match(j16Tree, /液压系统/);
    assert.doesNotMatch(j16Tree, /J16D 航电系统/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J16D" });
    const j16dTree = runtime.appNode.innerHTML;
    assert.match(j16dTree, /J16D 航电系统/);
    assert.doesNotMatch(j16dTree, /液压系统/);
  } finally {
    runtime.restore();
  }
});

test("RMS selected aircraft without modeled components shows the explicit equipment empty state", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createCase1RmsRuntimeProjectJson({
      equipment: { model: "J-15", wholeMachineModels: ["J-15", "J-35", "J-99"] }
    })
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-99" });
    assert.match(runtime.appNode.innerHTML, /当前机型暂无装备结构，请先完成装备系统建模。/);
  } finally {
    runtime.restore();
  }
});

test("RMS calculation is blocked without an aircraft or with invalid required inputs", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });
  try {
    assert.match(runtime.appNode.innerHTML, /请先选择飞机型号。/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /organization-layout equipment-layout rms-layout/);
    assert.match(runtime.appNode.innerHTML, /data-rms-action="calculate" disabled>计算/);
    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.doesNotMatch(runtime.appNode.innerHTML, /rms-calculation-overlay/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    await runtime.change("[data-rms-path]", { rmsPath: "inputs.missionReliability" }, { value: "", type: "number" });
    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.match(runtime.appNode.innerHTML, /任务可靠度不能为空/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /rms-calculation-overlay/);
  } finally {
    runtime.restore();
  }
});

test("RMS per-aircraft inputs, tree selection and saved results hydrate without cross-model reuse", async () => {
  const projectJson = createPersistedRmsRuntimeProjectJson();
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson
  });
  try {
    assert.match(runtime.appNode.innerHTML, /<option value="J-15" selected>J-15<\/option>/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="completed"[^>]*>计算完成/);
    assert.match(runtime.appNode.innerHTML, /data-rms-path="inputs\.missionReliability"[^>]*value="0\.91"/);
    assert.match(runtime.appNode.innerHTML, /tree-node-label selected" data-rms-equipment-node="rms:J-15:j15-engine"/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /40%/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-20" });
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(runtime.appNode.innerHTML, /data-rms-path="inputs\.missionReliability"[^>]*value="0\.88"/);
    assert.match(runtime.appNode.innerHTML, /J-20 雷达/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /J-15 发动机/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);

    await runtime.change("[data-rms-path]", { rmsPath: "inputs.mtbfHours" }, { value: "1250", type: "number" });
    await new Promise((resolve) => setTimeout(resolve, 850));
    const saved = projectSaveBodies(runtime).at(-1);
    assert.equal(saved.rmsAllocationPlan.selectedAircraftModel, "J-20");
    assert.equal(saved.rmsAllocationPlan.aircraftStates["J-15"].plan.inputs.missionReliability, 0.91);
    assert.equal(saved.rmsAllocationPlan.aircraftStates["J-20"].plan.inputs.mtbfHours, 1250);
    assert.equal("criticalFailureRatio" in saved.rmsAllocationPlan.aircraftStates["J-20"].plan.inputs, false);
    assert.equal(saved.rmsAllocationPlan.aircraftStates["J-20"].plan.schemaVersion, "rms-allocation-plan-v4");
    assert.equal(saved.rmsAllocationPlan.aircraftStates["J-20"].plan.algorithmVersion, "rms-engine-4.0.0");
    assert.equal(saved.rmsAllocationResult.byAircraftModel["J-15"].aircraftModel, "J-15");
    assert.equal(saved.rmsAllocationResult.byAircraftModel["J-20"], undefined);
  } finally {
    runtime.restore();
  }
});

test("RMS input changes clear only the current aircraft result and block empty export", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createPersistedRmsRuntimeProjectJson()
  });
  try {
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /40%/);
    await runtime.change("[data-rms-path]", { rmsPath: "inputs.mtbfHours" }, { value: "1325", type: "number" });

    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /data-rms-action="export-excel" disabled/);

    const exportRequestsBefore = runtime.requests.filter((request) => request.url === "/api/rms-allocation/export-xlsx").length;
    await runtime.click("[data-rms-action]", { rmsAction: "export-excel" });
    assert.equal(runtime.requests.filter((request) => request.url === "/api/rms-allocation/export-xlsx").length, exportRequestsBefore);
    assert.match(runtime.appNode.innerHTML, /当前飞机型号暂无可导出的计算结果，请先完成计算/);

    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-20" });
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
  } finally {
    runtime.restore();
  }
});

test("RMS equipment node edits invalidate the current aircraft result", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createPersistedRmsRuntimeProjectJson()
  });
  try {
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /40%/);
    await runtime.change("[data-rms-equipment-field]", {
      rmsEquipmentNodeId: "rms:J-15:j15-engine",
      rmsEquipmentField: "quantity"
    }, { value: "3" });

    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /data-rms-action="export-excel" disabled/);
  } finally {
    runtime.restore();
  }
});

test("RMS installation table filters to a selected subtree and persists editable node fields", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });

  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    const file = {
      name: "rms-nested-tree.csv",
      async text() {
        return [
          "id,parentId,name,model,level,quantity,runningRatio",
          "root,,测试整机,PLATFORM,装备,1,1",
          "power,root,动力系统,POWER-1,系统,2,1",
          "engine,power,发动机,ENGINE-1,分系统,4,0.8",
          "radar,root,雷达系统,RADAR-1,系统,1,0.5"
        ].join("\n");
      }
    };

    await runtime.change("[data-rms-equipment-import-file]", {}, { files: [file], value: file.name });
    await runtime.click("[data-rms-equipment-node]", { rmsEquipmentNode: "power" });

    const installationTable = runtime.appNode.innerHTML.slice(
      runtime.appNode.innerHTML.indexOf('class="rms-table-context"'),
      runtime.appNode.innerHTML.indexOf("</section>", runtime.appNode.innerHTML.indexOf('class="rms-table-context"'))
    );
    assert.match(installationTable, /动力系统及以下节点（2）/);
    assert.match(installationTable, /动力系统/);
    assert.match(installationTable, /发动机/);
    assert.doesNotMatch(installationTable, /雷达系统/);

    await runtime.change("[data-rms-equipment-field]", {
      rmsEquipmentNodeId: "engine",
      rmsEquipmentField: "name"
    }, { value: "改进发动机" });
    await runtime.change("[data-rms-equipment-field]", {
      rmsEquipmentNodeId: "engine",
      rmsEquipmentField: "model"
    }, { value: "ENGINE-2" });
    await runtime.change("[data-rms-equipment-field]", {
      rmsEquipmentNodeId: "engine",
      rmsEquipmentField: "quantity"
    }, { value: "5" });
    await runtime.change("[data-rms-equipment-field]", {
      rmsEquipmentNodeId: "engine",
      rmsEquipmentField: "runningRatio"
    }, { value: "0.6" });

    assert.match(runtime.appNode.innerHTML, /改进发动机/);
    assert.match(runtime.appNode.innerHTML, /value="ENGINE-2"/);
    assert.match(runtime.appNode.innerHTML, /value="5"/);
    assert.match(runtime.appNode.innerHTML, /value="0\.6"/);
    assert.match(runtime.appNode.innerHTML, /已更新 RMS 指标分配装备树独立数据。/);
  } finally {
    runtime.restore();
  }
});

test("RMS runtime shows an explicit failure when proportional weights sum to zero", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-equipment-rms-allocation",
    projectJson: createRmsRuntimeProjectJson()
  });
  try {
    await runtime.change("[data-rms-aircraft-model]", {}, { value: "J-15" });
    const file = {
      name: "zero-running-ratio.csv",
      async text() {
        return [
          "id,name,parentId,level,quantity,runningRatio",
          "root,测试整机,,装备,1,1",
          "system-a,系统A,root,系统,1,0",
          "system-b,系统B,root,系统,2,0"
        ].join("\n");
      }
    };
    await runtime.change("[data-rms-equipment-import-file]", {}, { files: [file], value: file.name });
    await runtime.change("[data-rms-path]", { rmsPath: "methods.allocation" }, { value: "proportional" });

    assert.doesNotMatch(runtime.appNode.innerHTML, /方法不适用|RMS_ALLOCATION_ZERO_WEIGHT/);
    await runtime.click("[data-rms-action]", { rmsAction: "calculate" });
    assert.match(runtime.appNode.innerHTML, /rms-calculation-overlay/);
    await new Promise((resolve) => setTimeout(resolve, 2050));

    assert.match(runtime.appNode.innerHTML, /计算失败/);
    assert.match(runtime.appNode.innerHTML, /RMS_ALLOCATION_ZERO_WEIGHT/);
    assert.match(runtime.appNode.innerHTML, /data-rms-calculation-status="not-calculated"[^>]*>未计算/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-rms-calculation-status="completed"/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /当前飞机型号暂无计算结果/);
    assert.match(htmlSectionByClass(runtime.appNode.innerHTML, "rms-result-panel"), /data-rms-action="export-excel" disabled/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /节点份额合计为 100%/);
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

test("basic support activity scope edits persist on the selected top-level job", async () => {
  const projectJson = createRuntimeProjectJson({
    equipment: { wholeMachineModels: ["J-15", "J-35"] }
  });
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
    await waitForRuntimeHtml(runtime, /第二工作项目/, "expected second basic support activity row to load");

    await runtime.click("[data-basic-activity-edit]", { basicActivityEdit: "0:1" });
    await runtime.change(
      "[data-basic-activity-field]",
      { basicActivityKey: "0:1", basicActivityField: "scope" },
      { value: "aircraft:J-35" }
    );
    await runtime.click("[data-project-draft-save]");

    const savedProject = await waitForProjectSave(runtime, (body) => (
      body.supportActivities?.length === 1
      && body.supportActivities[0]?.activityCodes?.join(",") === "BA-001,BA-002"
      && body.supportActivityJobs?.some((job) => job.activityCode === "BA-001" && job.applicableAircraft === "J-15")
      && body.supportActivityJobs?.some((job) => job.activityCode === "BA-002" && job.applicableAircraft === "J-35")
    ), "expected scope edit to update only the selected top-level job");
    assert.equal(savedProject.supportActivities[0].aircraftModel, "J-15");
    assert.deepEqual(savedProject.supportActivities[0].activityCodes, ["BA-001", "BA-002"]);
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
  const operationsWorkNamePattern = /初始工作项目/;

  try {
    await runtime.click("[data-enter-workbench]", { projectId: "project-runtime" });
    await runtime.setHash("feature=spare-planning-basic-support-activity");

    await waitForRuntimeHtml(runtime, operationsWorkNamePattern, "expected runtime project support activity rows to load");
    assert.match(runtime.appNode.innerHTML, operationsWorkNamePattern);
    assert.doesNotMatch(runtime.appNode.innerHTML, /定检基本保障活动/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /部件修复作业/);

    await runtime.change("[data-basic-activity-import-type-select]", {}, { value: "修复性维修" });
    await waitForRuntimeHtml(runtime, /部件修复作业/, "expected corrective activity rows after filtering");
    assert.match(runtime.appNode.innerHTML, /部件修复作业/);
    assert.doesNotMatch(runtime.appNode.innerHTML, operationsWorkNamePattern);
    assert.doesNotMatch(runtime.appNode.innerHTML, /定检基本保障活动/);

    await runtime.change("[data-basic-activity-import-type-select]", {}, { value: "预防性维修" });
    await waitForRuntimeHtml(runtime, /定检基本保障活动/, "expected preventive activity rows after filtering");
    assert.match(runtime.appNode.innerHTML, /定检基本保障活动/);
    assert.doesNotMatch(runtime.appNode.innerHTML, operationsWorkNamePattern);
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
    assert.equal("spareName" in saved.transportPolicies[0], false);
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
    assert.match(runtime.appNode.innerHTML, /data-experiment-stop-condition="duration"[^>]*checked/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-stop-condition="failure"[^>]*checked/);
    assert.match(runtime.appNode.innerHTML, /data-experiment-stop-condition="specifiedTime"[^>]*checked/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-stop-time-minute[^>]*disabled/);
    await runtime.change(
      "[data-experiment-stop-condition]",
      { experimentStopCondition: "specifiedTime" },
      { checked: false, type: "checkbox" }
    );
    assert.match(runtime.appNode.innerHTML, /data-experiment-stop-time-minute[^>]*disabled/);
    await runtime.change(
      "[data-experiment-stop-condition]",
      { experimentStopCondition: "specifiedTime" },
      { checked: true, type: "checkbox" }
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-stop-time-minute[^>]*disabled/);
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
      conditions: [{ type: "duration" }, { type: "failure" }, { type: "specifiedTime", minute: 1440 }]
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

test("experiment plan editor keeps runtime configuration and removes analysis configuration", async () => {
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

    assert.match(runtime.appNode.innerHTML, /基本信息/);
    assert.match(runtime.appNode.innerHTML, /运行配置/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /分析配置/);
    assert.match(runtime.appNode.innerHTML, /停止分钟（min）/);
    assert.match(runtime.appNode.innerHTML, /data-plan-list-link>返回</);
    assert.match(runtime.appNode.innerHTML, /data-save-plan[^>]*>保存</);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Scenario 拼接/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /scenario-composition-workspace/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-scenario-selected-override-value/);
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
        parallelCores: 6,
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
      request.url === "/api/projects/project-runtime/experiment-plans/plan-saved-composition"
      && (request.options.method || "GET") === "PUT"
    ));
    assert.ok(updatePlanRequest, "saved experiment plan edit should update the original backend plan");
    assert.equal(
      runtime.requests.some((request) => (
        request.url === "/api/projects/project-runtime/experiment-plans"
        && (request.options.method || "GET") === "POST"
      )),
      false,
      "editing a saved experiment plan must not create a new plan"
    );
    const body = JSON.parse(updatePlanRequest.options.body || "{}");
    assert.equal(body.config.name, "已保存拼接方案");
    assert.equal(body.config.steps, 36);
    assert.equal(body.config.samples, 7);
    assert.equal(body.config.seed, 777);
    assert.equal(body.config.parallelCores, 6);
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

test("experiment plan editor blocks invalid parallel cores before save", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson()
  });

  try {
    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });
    await runtime.change(
      "[data-experiment-plan-path]",
      { experimentPlanPath: "experiment.parallelCores" },
      { value: "0", type: "number" }
    );
    assert.match(runtime.appNode.innerHTML, /并行核心数必须是 1-32 之间的正整数/);
    assert.match(runtime.appNode.innerHTML, /data-save-plan disabled/);
    await runtime.click("[data-save-plan]");
    assert.equal(
      runtime.requests.some((request) => request.url.includes("/experiment-plans") && (request.options.method || "GET") !== "GET"),
      false
    );
  } finally {
    runtime.restore();
  }
});

test("Monte Carlo launch blocks an invalid saved parallel core value", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-invalid-parallel",
      status: "draft",
      config: {
        name: "旧版非法并行方案",
        samples: 2,
        seed: 77,
        parallelCores: 0,
        projectJson: createRuntimeProjectJson({ project_id: "project-invalid-parallel" })
      }
    }]
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-invalid-parallel" }
    );
    await runtime.click("[data-lite-mesa-action='run']");
    assert.equal(runtime.requests.some((request) => request.url === "/api/mesa-analysis-runs"), false);
    assert.match(runtime.appNode.innerHTML, /并行核心数必须是 1-32 之间的正整数/);
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

test("visual simulation shows a plan-only empty state and blocks refresh without a saved plan", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson()
  });

  try {
    const visualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.match(visualShell, /<span>实验方案<\/span>/);
    assert.match(visualShell, /aria-label="实验方案" disabled/);
    assert.match(visualShell, /暂无实验方案，请先在实验方案管理中创建并保存方案/);
    assert.match(visualShell, /data-plan-list-link>前往实验方案管理<\/button>/);
    assert.doesNotMatch(visualShell, /运行上下文|当前项目|已保存实验方案|<optgroup/);
    assert.match(runtime.appNode.innerHTML, /data-solara-visualization-frame/);
    assert.match(visualShell, /data-mesa-control="reload-solara" disabled/);
    assert.doesNotMatch(visualShell, /title="Solara 可视化推演"|<iframe/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "visual page load should not auto-start retired formal visualization"
    );

    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });

    assert.equal(
      runtime.requests.some((request) => request.url === "/api/projects" && (request.options.method || "GET") === "POST"),
      false,
      "visual refresh without a saved plan must not save or start a Project"
    );
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "Solara refresh must not submit retired /api/runs"
    );
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/mesa-analysis-runs"),
      false,
      "Solara iframe page is driven by the sidecar, not the lite Mesa summary endpoint"
    );
    assert.equal(
      runtime.requests.some((request) => (
        request.url === "/api/projects/project-runtime/experiment-plans"
        && (request.options.method || "GET") === "POST"
      )),
      false,
      "current Project visualization must not auto-create an ExperimentPlan"
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /reload=1/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Solara Mesa iframe|iframe:/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /mesa-control-deck|mesa-control-status|仿真状态|推演由 Solara/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /启动回放|data-mesa-timeline|Lite Mesa 仿真未返回 run_id/);
  } finally {
    runtime.restore();
  }
});

test("visual simulation does not depend on lite Mesa run id", async () => {
  const planProjectJson = createRuntimeProjectJson({ project_id: "project-visual-no-run-id" });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-no-run-id",
      config: { name: "无 run id 方案", steps: 5, samples: 2, seed: 22, projectJson: planProjectJson }
    }],
    liteMesaAnalysisResponseOverrides: { run_id: "" }
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-no-run-id" }
    );
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-no-run-id/);
    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });

    assert.match(runtime.appNode.innerHTML, /reload=1/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /后端项目重新编译推演输入|后端 Project 重新编译推演输入/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /Lite Mesa 仿真未返回 run_id/);
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "visual Mesa session must not fall back to retired /api/runs"
    );
  } finally {
    runtime.restore();
  }
});

test("visual simulation applies saved plan runtime settings without changing current Project settings", async () => {
  const currentProjectJson = createRuntimeProjectJson({
    experiment: { name: "当前项目实验", steps: 11, samples: 2, seed: 22 }
  });
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-visual-plan",
    projectInfo: { name: "可视化方案 Project", baseCode: "VIS" }
  });
  delete planProjectJson.experiment;
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: currentProjectJson,
    experimentPlans: [{
      experiment_plan_id: "plan-visual",
      status: "draft",
      config: {
        name: "可视化保存方案",
        steps: 77,
        samples: 8,
        seed: 88,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    assert.match(runtime.appNode.innerHTML, /<option value="" selected>请选择实验方案<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /title="Solara 可视化推演"/);

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-visual" }
    );
    assert.match(runtime.appNode.innerHTML, /<option value="plan-visual" selected>可视化保存方案<\/option>/);
    assert.match(runtime.appNode.innerHTML, /project_id=project-visual-plan/);
    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });
    const planProjectSave = runtime.requests
      .filter((request) => request.url === "/api/projects" && (request.options.method || "GET") === "POST")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(planProjectSave.project_id, "project-visual-plan");
    assert.equal("experiment" in planProjectSave, false, "saved plan visualization must keep Project persistence clean");
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-visual/);
    assert.match(runtime.appNode.innerHTML, /plan_steps=77/);
    assert.match(runtime.appNode.innerHTML, /plan_samples=8/);
    assert.match(runtime.appNode.innerHTML, /plan_seed=88/);
    assert.equal(
      runtime.requests.some((request) => (
        request.url === "/api/projects/project-runtime/experiment-plans"
        && (request.options.method || "GET") === "POST"
      )),
      false,
      "visualization refresh must not create an ExperimentPlan"
    );
  } finally {
    runtime.restore();
  }
});

test("visual simulation distinguishes duplicate plan names by stable IDs and switches Project branches atomically", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [
      {
        experiment_plan_id: "plan-duplicate-a",
        config: {
          name: "重名方案",
          steps: 11,
          samples: 2,
          seed: 101,
          projectJson: createRuntimeProjectJson({ project_id: "project-duplicate-a" })
        }
      },
      {
        experiment_plan_id: "plan-duplicate-b",
        config: {
          name: "重名方案",
          steps: 22,
          samples: 3,
          seed: 202,
          projectJson: createRuntimeProjectJson({ project_id: "project-duplicate-b" })
        }
      }
    ]
  });

  try {
    const visualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.equal((visualShell.match(/>重名方案<\/option>/g) || []).length, 2);
    assert.match(visualShell, /<option value="plan-duplicate-a"\s*>重名方案<\/option>/);
    assert.match(visualShell, /<option value="plan-duplicate-b"\s*>重名方案<\/option>/);
    assert.doesNotMatch(visualShell, /current-project:|<optgroup|已保存实验方案/);

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-duplicate-b" }
    );
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-duplicate-b/);
    assert.match(runtime.appNode.innerHTML, /project_id=project-duplicate-b/);
    assert.match(runtime.appNode.innerHTML, /plan_steps=22/);
    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });
    let saved = runtime.requests
      .filter((request) => request.url === "/api/projects" && (request.options.method || "GET") === "POST")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(saved.project_id, "project-duplicate-b");

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-duplicate-a" }
    );
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-duplicate-a/);
    assert.match(runtime.appNode.innerHTML, /project_id=project-duplicate-a/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /experiment_plan_id=plan-duplicate-b/);
    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });
    saved = runtime.requests
      .filter((request) => request.url === "/api/projects" && (request.options.method || "GET") === "POST")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(saved.project_id, "project-duplicate-a");
  } finally {
    runtime.restore();
  }
});

test("visual simulation clears a saved Project override when shared context changes on another analysis page", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [
      {
        experiment_plan_id: "plan-cross-page-a",
        config: {
          name: "跨页方案A",
          steps: 11,
          samples: 2,
          seed: 101,
          projectJson: createRuntimeProjectJson({ project_id: "project-cross-page-a" })
        }
      },
      {
        experiment_plan_id: "plan-cross-page-b",
        config: {
          name: "跨页方案B",
          steps: 22,
          samples: 3,
          seed: 202,
          projectJson: createRuntimeProjectJson({ project_id: "project-cross-page-b" })
        }
      }
    ]
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-cross-page-a" }
    );
    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });
    assert.match(runtime.appNode.innerHTML, /project_id=project-cross-page-a/);

    await runtime.setHash("feature=spare-planning-monte-carlo-experiment-detail");
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-cross-page-b" }
    );
    await runtime.setHash("feature=spare-planning-visual-mesa-page");

    const visualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.match(visualShell, /experiment_plan_id=plan-cross-page-b/);
    assert.match(visualShell, /project_id=project-cross-page-b/);
    assert.match(visualShell, /plan_steps=22/);
    assert.match(visualShell, /plan_samples=3/);
    assert.match(visualShell, /plan_seed=202/);
    assert.doesNotMatch(visualShell, /project_id=project-cross-page-a|experiment_plan_id=plan-cross-page-a/);
  } finally {
    runtime.restore();
  }
});

test("visual experiment plan list ignores a stale response from the previous Project", async () => {
  const projectAPlans = createRuntimeDeferred();
  const projectBPlans = createRuntimeDeferred();
  const projectA = createRuntimeProjectJson({ project_id: "project-race-a" });
  const projectB = createRuntimeProjectJson({ project_id: "project-race-b" });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: projectA,
    backendProjects: [
      {
        project_id: "project-race-a",
        experiment_name: "竞态项目A",
        base_code: "RA",
        summary: "runtime race A",
        updated_at: "2026-07-18 00:00:00"
      },
      {
        project_id: "project-race-b",
        experiment_name: "竞态项目B",
        base_code: "RB",
        summary: "runtime race B",
        updated_at: "2026-07-18 00:00:00"
      }
    ],
    projectJsonById: {
      "project-race-a": projectA,
      "project-race-b": projectB
    },
    experimentPlanListsByProject: {
      "project-race-a": projectAPlans.promise,
      "project-race-b": projectBPlans.promise
    }
  });

  try {
    assert.ok(runtime.requests.some((request) => request.url === "/api/projects/project-race-a/experiment-plans"));
    await runtime.click("[data-project-list]", { projectList: "" });
    await runtime.click("[data-enter-workbench]", { projectId: "race-b" });
    await runtime.setHash("feature=spare-planning-visual-mesa-page");
    assert.ok(runtime.requests.some((request) => request.url === "/api/projects/project-race-b/experiment-plans"));

    projectBPlans.resolve([{
      experiment_plan_id: "plan-race-b",
      config: { name: "项目B方案", projectJson: projectB }
    }]);
    await runtime.flush();
    assert.match(runtime.appNode.innerHTML, /<option value="plan-race-b"\s*>项目B方案<\/option>/);

    projectAPlans.resolve([{
      experiment_plan_id: "plan-race-a-stale",
      config: { name: "项目A迟到方案", projectJson: projectA }
    }]);
    await runtime.flush();
    assert.match(runtime.appNode.innerHTML, /<option value="plan-race-b"\s*>项目B方案<\/option>/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /plan-race-a-stale|项目A迟到方案/);
  } finally {
    projectAPlans.resolve([]);
    projectBPlans.resolve([]);
    runtime.restore();
  }
});

test("visual experiment plan list keeps a stored plan through HTTP 500 and restores it after retry", async () => {
  const planProjectJson = createRuntimeProjectJson({ project_id: "project-retry-plan" });
  let listRequestCount = 0;
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlanListsByProject: {
      "project-runtime": () => {
        listRequestCount += 1;
        if (listRequestCount === 1) {
          return jsonResponse(
            { message: "方案服务暂时不可用" },
            { ok: false, status: 500 }
          );
        }
        return [{
          experiment_plan_id: "plan-retry-stored",
          config: {
            name: "重试恢复方案",
            steps: 33,
            samples: 4,
            seed: 303,
            projectJson: planProjectJson
          }
        }];
      }
    },
    storageEntries: [[
      "spare-mvp:selectedRunContextByProject",
      JSON.stringify({ "project-runtime": "plan-retry-stored" })
    ]]
  });

  try {
    await runtime.flush();
    const failedVisualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.match(failedVisualShell, /实验方案列表加载失败/);
    assert.doesNotMatch(failedVisualShell, /暂无实验方案，请先在实验方案管理中创建并保存方案/);
    assert.match(failedVisualShell, /data-mesa-control="reload-solara" disabled/);
    assert.doesNotMatch(failedVisualShell, /title="Solara 可视化推演"|<iframe/);
    assert.equal(
      JSON.parse(localStorage.getItem("spare-mvp:selectedRunContextByProject"))["project-runtime"],
      "plan-retry-stored",
      "a transient list failure must not clear the persisted stable plan ID"
    );

    await runtime.setHash("feature=spare-planning-experiment-plan-management");
    await runtime.click("[data-experiment-plan-refresh]", { experimentPlanRefresh: "" });
    await runtime.setHash("feature=spare-planning-visual-mesa-page");

    const recoveredVisualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.match(recoveredVisualShell, /<option value="plan-retry-stored" selected>重试恢复方案<\/option>/);
    assert.match(recoveredVisualShell, /experiment_plan_id=plan-retry-stored/);
    assert.match(recoveredVisualShell, /project_id=project-retry-plan/);
    assert.match(recoveredVisualShell, /plan_steps=33/);
    assert.match(recoveredVisualShell, /plan_samples=4/);
    assert.match(recoveredVisualShell, /plan_seed=303/);

    await runtime.click("[data-mesa-control]", { mesaControl: "reload-solara" });
    assert.ok(runtime.requests.some((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "POST"
      && JSON.parse(request.options.body || "{}").project_id === "project-retry-plan"
    )));
  } finally {
    runtime.restore();
  }
});

test("visual simulation restores a saved plan ID and clears it after the plan is deleted", async () => {
  const experimentPlans = [
    {
      experiment_plan_id: "plan-restored-visual",
      config: {
        name: "恢复后删除方案",
        projectJson: createRuntimeProjectJson({ project_id: "project-restored-visual" })
      }
    },
    {
      experiment_plan_id: "plan-surviving-visual",
      config: {
        name: "保留方案",
        projectJson: createRuntimeProjectJson({ project_id: "project-surviving-visual" })
      }
    }
  ];
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-visual-mesa-page",
    projectJson: createRuntimeProjectJson(),
    experimentPlans,
    storageEntries: [[
      "spare-mvp:selectedRunContextByProject",
      JSON.stringify({ "project-runtime": "plan-restored-visual" })
    ]]
  });

  try {
    await runtime.flush();
    assert.match(runtime.appNode.innerHTML, /<option value="plan-restored-visual" selected>恢复后删除方案<\/option>/);
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-restored-visual/);

    await runtime.click("[data-plan-list-link]", { planListLink: "" });
    await runtime.click(
      "[data-experiment-plan-delete]",
      { experimentPlanDelete: "plan-restored-visual" }
    );
    await runtime.setHash("feature=spare-planning-visual-mesa-page");

    const visualShell = runtime.appNode.innerHTML.slice(runtime.appNode.innerHTML.indexOf('<div class="mesa-visual-shell">'));
    assert.match(visualShell, /<option value="" selected>请选择实验方案<\/option>/);
    assert.match(visualShell, /<option value="plan-surviving-visual"\s*>保留方案<\/option>/);
    assert.doesNotMatch(visualShell, /恢复后删除方案|title="Solara 可视化推演"/);

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-surviving-visual" }
    );
    assert.match(runtime.appNode.innerHTML, /experiment_plan_id=plan-surviving-visual/);
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
        parallelCores: 3,
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
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.doesNotMatch(settingsPanel, /样本量|随机种子|data-lite-mesa-field/);
    await runtime.click("[data-lite-mesa-action='run']");

    const monteCarloRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "mission_reliability");
    assert.ok(monteCarloRequest, "Monte Carlo detail should use lightweight Mesa analysis route");
    const monteCarloBody = monteCarloRequest;
    assert.equal(monteCarloBody.analysis_type, "mission_reliability");
    assert.equal(monteCarloBody.project.project_id, "project-runtime-plan-a");
    assert.equal(monteCarloBody.settings.samples, 4);
    assert.equal(monteCarloBody.settings.seed, 404);
    assert.equal(monteCarloBody.settings.parallelCores, 3);
    assert.match(runtime.appNode.innerHTML, /出动架次率/);
    assert.match(runtime.appNode.innerHTML, />0\.84</);
    assert.doesNotMatch(runtime.appNode.innerHTML, />84%<\/strong>|>84%<\/td>|>75%<\/strong>|>75%<\/td>/);
    assert.match(runtime.appNode.innerHTML, /平均备件延误时间/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /mean_transport_delay/);
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

test("saved run context survives a cold workbench restore", async () => {
  const projectJson = createRuntimeProjectJson({ project_id: "project-runtime" });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-carry-list-analysis",
    projectJson,
    experimentPlans: [{
      experiment_plan_id: "plan-restored",
      status: "draft",
      config: {
        name: "恢复方案",
        samples: 13,
        seed: 1313,
        projectJson: createRuntimeProjectJson({ project_id: "project-runtime" })
      }
    }],
    storageEntries: [[
      "spare-mvp:selectedRunContextByProject",
      JSON.stringify({ "project-runtime": "plan-restored" })
    ]]
  });

  try {
    await runtime.flush();
    await runtime.flush();
    assert.match(runtime.appNode.innerHTML, /<option value="plan-restored" selected>恢复方案<\/option>/);
    const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
    assert.match(settingsPanel, /样本量[\s\S]*<strong>13<\/strong>/);
    assert.match(settingsPanel, /随机种子[\s\S]*<strong>1313<\/strong>/);
    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const analysisRun = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisRun.settings.samples, 13);
    assert.equal(analysisRun.settings.seed, 1313);
  } finally {
    runtime.restore();
  }
});

test("run context defaults to current Project and excludes unsaved or invalid experiment plans", async () => {
  const sourceProjectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    projectInfo: { name: "运行来源项目", baseCode: "CTX" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: sourceProjectJson,
    experimentPlans: [{
      experiment_plan_id: "",
      config: {
        name: "无持久化标识方案",
        projectJson: createRuntimeProjectJson({ project_id: "project-invalid-plan" })
      }
    }]
  });

  try {
    await runtime.click("[data-experiment-plan-add]", { experimentPlanAdd: "" });
    await runtime.change(
      "[data-experiment-plan-path]",
      { experimentPlanPath: "experiment.name" },
      { value: "尚未保存的内存分支" }
    );

    await runtime.setHash("feature=spare-planning-spare-shortfall-analysis");

    const contextBar = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(contextBar, /运行上下文/);
    assert.match(contextBar, /当前项目：运行来源项目/);
    assert.match(contextBar, /0 个已保存方案/);
    assert.doesNotMatch(contextBar, /当前草稿|尚未保存的内存分支|无持久化标识方案|已保存实验方案/);

    await runtime.click("[data-lite-mesa-analysis-action='run']");

    const analysisBody = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisBody.project.project_id, "project-runtime");
    assert.equal(analysisBody.project.projectInfo.name, "运行来源项目");
    assert.equal(
      runtime.requests.some((request) => (
        request.url === "/api/projects/project-runtime/experiment-plans"
        && (request.options.method || "GET") === "POST"
      )),
      false,
      "direct Project analysis must not auto-create an ExperimentPlan"
    );
  } finally {
    runtime.restore();
  }
});

test("experiment plan list selection editing and saving do not change the run context", async () => {
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-management-plan",
    projectInfo: { name: "管理中的方案 Project", baseCode: "MGT" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-management",
    projectJson: createRuntimeProjectJson(),
    experimentPlans: [{
      experiment_plan_id: "plan-management",
      status: "draft",
      config: {
        name: "管理中的方案",
        samples: 12,
        seed: 1212,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    await runtime.change(
      "[data-experiment-plan-select]",
      { experimentPlanSelect: "plan-management" },
      { checked: true, type: "checkbox" }
    );
    await runtime.click(
      "[data-experiment-plan-edit]",
      { experimentPlanEdit: "plan-management", experimentPlanName: "管理中的方案" }
    );
    await runtime.click("[data-save-plan]");
    await runtime.setHash("feature=spare-planning-spare-shortfall-analysis");

    const contextBar = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
    assert.match(contextBar, /当前项目：Runtime 项目/);
    assert.doesNotMatch(contextBar, /<option value="plan-management" selected/);

    await runtime.click("[data-lite-mesa-analysis-action='run']");
    const analysisBody = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisBody.project.project_id, "project-runtime");
    assert.notEqual(analysisBody.project.project_id, "project-management-plan");
  } finally {
    runtime.restore();
  }
});

test("switching from a saved plan to a Project without experiment resets Monte Carlo settings", async () => {
  const currentProjectJson = createRuntimeProjectJson();
  delete currentProjectJson.experiment;
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-settings-plan",
    projectInfo: { name: "参数方案 Project", baseCode: "SET" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: currentProjectJson,
    experimentPlans: [{
      experiment_plan_id: "plan-settings",
      status: "draft",
      config: {
        name: "参数方案",
        samples: 19,
        seed: 1919,
        projectJson: planProjectJson
      }
    }]
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-settings" }
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-lite-mesa-field|样本量|随机种子/);
    await runtime.click("[data-lite-mesa-action='run']");
    const planAnalysisBody = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(planAnalysisBody.project.project_id, "project-settings-plan");
    assert.equal(planAnalysisBody.settings.samples, 19);
    assert.equal(planAnalysisBody.settings.seed, 1919);

    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "current-project:project-runtime" }
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-lite-mesa-field|样本量|随机种子/);

    await runtime.click("[data-lite-mesa-action='run']");
    const analysisBody = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisBody.project.project_id, "project-runtime");
    assert.equal(analysisBody.settings.samples, 4);
    assert.equal(analysisBody.settings.seed, 20260621);
  } finally {
    runtime.restore();
  }
});

test("refreshing away the selected saved plan resets the run context and Monte Carlo settings", async () => {
  const currentProjectJson = createRuntimeProjectJson();
  delete currentProjectJson.experiment;
  const experimentPlans = [{
    experiment_plan_id: "plan-disappearing",
    status: "draft",
    config: {
      name: "即将失效的方案",
      samples: 23,
      seed: 2323,
      projectJson: createRuntimeProjectJson({ project_id: "project-disappearing-plan" })
    }
  }];
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: currentProjectJson,
    experimentPlans
  });

  try {
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-disappearing" }
    );
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-lite-mesa-field|样本量|随机种子/);

    experimentPlans.splice(0);
    await runtime.setHash("feature=spare-planning-experiment-plan-management");
    await runtime.click("[data-experiment-plan-refresh]", { experimentPlanRefresh: "" });
    await runtime.flush();
    await runtime.setHash("feature=spare-planning-monte-carlo-experiment-detail");

    assert.match(runtime.appNode.innerHTML, /当前项目：Runtime 项目/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-lite-mesa-field|样本量|随机种子/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /即将失效的方案/);
    assert.equal(
      JSON.parse(localStorage.getItem("spare-mvp:selectedRunContextByProject"))["project-runtime"],
      "current-project:project-runtime",
      "an authoritative empty list must clear a persisted missing plan ID"
    );

    await runtime.click("[data-lite-mesa-action='run']");
    const analysisBody = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .at(-1);
    assert.equal(analysisBody.project.project_id, "project-runtime");
    assert.equal(analysisBody.settings.samples, 4);
    assert.equal(analysisBody.settings.seed, 20260621);
  } finally {
    runtime.restore();
  }
});

test("task reliability keeps selected-plan runtime behavior without rendering its selector", async () => {
  const planProjectJson = createRuntimeProjectJson({
    project_id: "project-runtime-analysis-plan",
    projectInfo: { name: "分析方案 Project", baseCode: "APL" }
  });
  const runtime = await setupRuntimeApp({
    hash: "feature=mission-reliability-downtime-factor-analysis",
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
    await runtime.change(
      "[data-current-experiment-plan]",
      { currentExperimentPlan: "" },
      { value: "plan-analysis" }
    );
    for (const [featureId, analysisType] of [
      ["mission-reliability-task-reliability", "mission_reliability"],
      ["mission-reliability-downtime-factor-analysis", "downtime_factors"]
    ]) {
      await runtime.setHash(`feature=${featureId}`);

      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      assert.match(settingsPanel, /样本量[\s\S]*<strong>4<\/strong>/);
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>404<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);
      assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan|运行上下文/);

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

test("mission reliability and downtime analysis keep current Project as default with one saved plan", async () => {
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
    for (const [featureId, analysisType, defaultSamples] of [
      ["mission-reliability-task-reliability", "mission_reliability", 27],
      ["mission-reliability-downtime-factor-analysis", "downtime_factors", 1]
    ]) {
      await runtime.setHash(`feature=${featureId}`);
      await runtime.flush();

      const settingsPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-settings");
      const contextPanel = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-hero");
      assert.match(contextPanel, /运行上下文/);
      assert.match(contextPanel, /当前项目：Runtime 项目/);
      assert.match(contextPanel, /data-current-experiment-plan/);
      assert.match(runtime.appNode.innerHTML, /<section class="lite-mesa-hero">/);
      assert.match(settingsPanel, /运行分析/);
      assert.doesNotMatch(settingsPanel, /<span>当前项目<\/span>/);
      assert.match(settingsPanel, new RegExp(`样本量[\\s\\S]*<strong>${defaultSamples}<\\/strong>`));
      assert.match(settingsPanel, /随机种子[\s\S]*<strong>20260621<\/strong>/);
      assert.doesNotMatch(settingsPanel, /data-lite-mesa-analysis-field="samples"|data-lite-mesa-analysis-field="seed"/);

      await runtime.click("[data-lite-mesa-analysis-action='run']");
      const analysisBody = runtime.requests
        .filter((request) => request.url === "/api/mesa-analysis-runs")
        .map((request) => JSON.parse(request.options.body || "{}"))
        .at(-1);
      assert.equal(analysisBody.analysis_type, analysisType);
      assert.equal(analysisBody.project.project_id, "project-runtime");
      assert.equal(analysisBody.settings.samples, defaultSamples);
      assert.equal(analysisBody.settings.seed, 20260621);
    }
  } finally {
    runtime.restore();
  }
});

test("Monte Carlo detail renders canonical moments, units, valid n, and mixed execution counts", async () => {
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
    }),
    liteMesaAnalysisResponseOverrides: {
      sample_count: 3,
      requested_sample_count: 4,
      failed_sample_count: 1,
      failed_samples: [{ sample_index: 3, seed: 20260624, error: { code: "sample_timeout" } }],
      timings: { total_seconds: 70.9 },
      aggregate_metrics: {
        mission_success_rate: 0.73,
        spare_fill_rate: 0.64,
        spare_utilization: 0.29,
        ready_rate: 0.61,
        sortie_rate: 0.82,
        mean_transport_delay: 7.5,
        repair_backlog: 1.25
      },
      metric_moments: {
        schema_version: "monte-carlo-metric-moments-v0",
        variance_method: "unbiased_sample_variance",
        variance_denominator: "n-1",
        total_sample_count: 4,
        successful_sample_count: 3,
        failed_sample_count: 1,
        metrics: [
          { metric_id: "mission_success_rate", mean: 0.73, sample_variance: 0.0123, valid_sample_count: 3 },
          { metric_id: "spare_fill_rate", mean: 0.64, sample_variance: 0.02, valid_sample_count: 2 },
          { metric_id: "spare_utilization", mean: 0.29, sample_variance: null, valid_sample_count: 1 },
          { metric_id: "ready_rate", mean: 0, sample_variance: null, valid_sample_count: 2, invalid_reason: "sample_variance_not_finite" },
          { metric_id: "sortie_rate", mean: 0.82, sample_variance: 0.0025, valid_sample_count: 3 },
          { metric_id: "mean_transport_delay", mean: 7.5, sample_variance: 4, valid_sample_count: 3 },
          { metric_id: "repair_backlog", mean: 1.25, sample_variance: 0.5, valid_sample_count: 3 },
          { metric_id: "sample_id", mean: 999, sample_variance: 1, valid_sample_count: 3 }
        ]
      },
      samples: [{
        sample_id: "sample-render-fallback-check",
        final: {
          mission_success_rate: 0.11,
          spare_fill_rate: 0.22,
          spare_utilization: 0.33
        }
      }]
    }
  });

  try {
    assert.match(runtime.appNode.innerHTML, /蒙特卡洛分析/);
    assert.match(runtime.appNode.innerHTML, /data-current-experiment-plan/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-lite-mesa-field|样本量|随机种子/);

    await runtime.click("[data-lite-mesa-action='run']");

    const analysisRequest = runtime.requests
      .filter((request) => request.url === "/api/mesa-analysis-runs")
      .map((request) => JSON.parse(request.options.body || "{}"))
      .find((body) => body.analysis_type === "mission_reliability");
    assert.ok(analysisRequest, "Monte Carlo detail should submit a lightweight Mesa analysis request");
    const body = analysisRequest;
    assert.equal(body.analysis_type, "mission_reliability");
    assert.equal(body.settings.samples, 4);
    assert.equal(body.settings.seed, 20260621);
    assert.equal(
      runtime.requests.some((request) => request.url === "/api/runs"),
      false,
      "Monte Carlo detail should not submit a formal run"
    );
    assert.equal(
      runtime.requests.some((request) => (
        request.url === "/api/projects/project-runtime/experiment-plans"
        && (request.options.method || "GET") === "POST"
      )),
      false,
      "current Project Monte Carlo must not auto-create an ExperimentPlan"
    );
    const resultCards = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-results");
    const metricTable = htmlSectionByClass(runtime.appNode.innerHTML, "lite-mesa-stat-section");
    assert.match(resultCards, /总样本[\s\S]*<strong>4<\/strong>/);
    assert.match(resultCards, /成功样本[\s\S]*<strong>3<\/strong>/);
    assert.match(resultCards, /失败样本[\s\S]*<strong>1<\/strong>/);
    assert.match(resultCards, /任务可靠度[\s\S]*<strong>0\.73 比例<\/strong>/);
    assert.match(resultCards, /备件满足率[\s\S]*<strong>0\.64 比例<\/strong>/);
    assert.match(resultCards, /备件利用率[\s\S]*<strong>0\.29 比例<\/strong>/);
    assert.match(metricTable, /<th>均值<\/th><th>样本方差（n-1）<\/th><th>单位<\/th><th>有效样本数<\/th>/);
    assert.match(metricTable, /<td>任务可靠度<\/td>\s*<td>0\.73<\/td>\s*<td>0\.0123<\/td>\s*<td>比例 \/ 比例²<\/td>\s*<td>3<\/td>/);
    assert.match(metricTable, /<td>备件利用率<\/td>\s*<td>0\.29<\/td>\s*<td>不可计算<\/td>\s*<td>比例 \/ 比例²<\/td>\s*<td>1<\/td>/);
    assert.match(metricTable, /<td>战备完好率<\/td>\s*<td>0\.00<\/td>\s*<td>不可计算<\/td>\s*<td>比例 \/ 比例²<\/td>\s*<td>2<\/td>/);
    for (const label of ["任务可靠度", "备件满足率", "备件利用率"]) {
      assert.equal((metricTable.match(new RegExp(label, "g")) || []).length, 1, `${label} should appear once in the main metric table`);
    }
    assert.doesNotMatch(runtime.appNode.innerHTML, /sample_id|mean_transport_delay|mission_success_rate|spare_fill_rate|spare_utilization/);
    assert.match(runtime.appNode.innerHTML, new RegExp("Mesa 分析完成：3/4 个样本，失败 1 个，总耗时 70\\.9 秒。"));
  } finally {
    runtime.restore();
  }
});

test("Monte Carlo detail renders backend sample timeout as an actionable blocked state", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-monte-carlo-experiment-detail",
    projectJson: createRuntimeProjectJson(),
    liteMesaAnalysisResponseOverrides: {
      status: "blocked",
      sample_count: 0,
      requested_sample_count: 4,
      failed_sample_count: 4,
      message: "Mesa 分析样本全部超时；请减少样本数、提高并行核心数，或检查模型输入。",
      errors: Array.from({ length: 4 }, (_, sampleIndex) => ({
        sample_index: sampleIndex,
        seed: 20260621 + sampleIndex,
        error: { code: "sample_timeout", details: { timeout_seconds: 60 } }
      })),
      timings: { total_seconds: 60.1 }
    }
  });

  try {
    await runtime.click("[data-lite-mesa-action='run']");
    assert.match(
      runtime.appNode.innerHTML,
      /Mesa 分析未完成：Mesa 分析样本全部超时；请减少样本数、提高并行核心数，或检查模型输入。/
    );
    assert.match(runtime.appNode.innerHTML, /总样本[\s\S]*<strong>4<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /成功样本[\s\S]*<strong>0<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /失败样本[\s\S]*<strong>4<\/strong>/);
    assert.match(runtime.appNode.innerHTML, /无有效样本/);
    assert.match(runtime.appNode.innerHTML, /不可计算/);
  } finally {
    runtime.restore();
  }
});

test("permission menu visibility toggles every leaf role and persists through the existing system-config save", async () => {
  const leafKey = "system-management-project-data-management";
  const runtime = await setupRuntimeApp({
    hash: "feature=system-management-function-permission-management",
    sessionUser: { username: "admin", role: "系统管理员" },
    systemConfigPayload: {
      permissionMenuVisibility: [{
        leafKey,
        pageIds: [leafKey],
        admin: false,
        data: true,
        user: false
      }]
    }
  });

  try {
    const initialHtml = runtime.appNode.innerHTML;
    const leafCount = (initialHtml.match(/data-permission-menu-leaf=/g) || []).length;
    const toggleCount = (initialHtml.match(/data-permission-menu-visibility=/g) || []).length;
    assert.ok(leafCount > 0);
    assert.equal(toggleCount, leafCount * 3, "each menu leaf should expose one toggle per Admin/Data/User role");
    assert.doesNotMatch(initialHtml, /按左侧菜单的最小叶子项展示当前角色可见性/);
    assert.match(
      initialHtml,
      new RegExp(`data-permission-menu-visibility="${leafKey}" data-role-key="admin" aria-pressed="false"`)
    );

    await runtime.click("[data-permission-menu-visibility]", {
      permissionMenuVisibility: leafKey,
      roleKey: "admin"
    });

    assert.match(runtime.appNode.innerHTML, /菜单可见性已更新，待保存/);
    assert.match(
      runtime.appNode.innerHTML,
      new RegExp(`data-permission-menu-visibility="${leafKey}" data-role-key="admin" aria-pressed="true"`)
    );

    await runtime.click("[data-system-config-save]", { systemConfigSave: "basic-config" });

    const saveRequest = runtime.requests.find((request) => (
      request.url === "/api/system-configs/system-runtime-support"
      && (request.options.method || "GET") === "POST"
    ));
    assert.ok(saveRequest, "the existing system-config save should persist menu visibility");
    const savedPayload = JSON.parse(saveRequest.options.body || "{}").payload;
    const savedLeaf = savedPayload.permissionMenuVisibility.find((row) => row.leafKey === leafKey);
    assert.deepEqual(
      { admin: savedLeaf.admin, data: savedLeaf.data, user: savedLeaf.user },
      { admin: true, data: true, user: false }
    );
    assert.deepEqual(savedPayload.permissions, [
      { feature: "项目管理", admin: "编辑", data: "编辑", user: "只读" },
      { feature: "装备RMS指标分配", admin: "编辑", data: "编辑", user: "只读" },
      { feature: "系统基础配置", admin: "编辑", data: "只读", user: "只读" },
      { feature: "仿真建模", admin: "编辑", data: "编辑", user: "编辑" },
      { feature: "结果分析", admin: "只读", data: "只读", user: "只读" }
    ]);
    assert.match(runtime.appNode.innerHTML, /basic-config已保存到后端/);
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
  experimentPlanListsByProject = {},
  projectJsonById = {},
  sessionUser = { username: "data", role: "数据管理员" },
  storageEntries = [],
  systemConfigPayload = {},
  liteMesaAnalysisResponseOverrides = {},
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
  const projectPayloads = new Map([
    [projectJson.project_id || "project-runtime", projectJson],
    ...Object.entries(projectJsonById)
  ]);
  const runtimeRuns = new Map();
  const aircraftReliabilityHistory = [];
  let createProjectFromImportCount = 0;
  const storage = new Map([
    ["spare-mvp:m4Session", JSON.stringify({ session: { token: "m4-runtime-token" } })],
    ...storageEntries
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
    if (url === "/api/system-configs/system-runtime-support" && method === "GET") {
      return jsonResponse({ config_key: "system-runtime-support", payload: systemConfigPayload });
    }
    if (url === "/api/system-configs/system-runtime-support" && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      systemConfigPayload = body.payload || {};
      return jsonResponse({ config_key: "system-runtime-support", payload: systemConfigPayload });
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
    const projectReplaceMatch = url.match(/^\/api\/projects\/([^/]+)\/replace$/);
    if (projectReplaceMatch && method === "PUT") {
      const projectId = decodeURIComponent(projectReplaceMatch[1]);
      const body = JSON.parse(options.body || "{}");
      projectPayloads.set(projectId, body.project_json);
      const catalogEntry = backendProjectCatalog.find((entry) => entry.project_id === projectId);
      if (catalogEntry) catalogEntry.updated_at = "2026-06-26 00:00:01.456-replaced";
      return jsonResponse({
        project_id: projectId,
        updated_at: "2026-06-26 00:00:01.456-replaced",
        audit_event_id: "audit-runtime-replace"
      });
    }
    const experimentPlanListMatch = url.match(/^\/api\/projects\/([^/]+)\/experiment-plans$/);
    if (experimentPlanListMatch && method === "GET") {
      const projectId = decodeURIComponent(experimentPlanListMatch[1]);
      const configuredPlans = Object.hasOwn(experimentPlanListsByProject, projectId)
        ? experimentPlanListsByProject[projectId]
        : experimentPlans;
      const resolvedPlans = await (typeof configuredPlans === "function"
        ? configuredPlans({ projectId, requests })
        : configuredPlans);
      if (
        resolvedPlans
        && typeof resolvedPlans === "object"
        && typeof resolvedPlans.json === "function"
        && typeof resolvedPlans.ok === "boolean"
      ) {
        return resolvedPlans;
      }
      return jsonResponse({ project_id: projectId, experiment_plans: resolvedPlans });
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
    const experimentPlanItemMatch = url.match(/^\/api\/projects\/([^/]+)\/experiment-plans\/([^/]+)$/);
    if (experimentPlanItemMatch && method === "PUT") {
      const body = JSON.parse(options.body || "{}");
      return jsonResponse({
        project_id: decodeURIComponent(experimentPlanItemMatch[1]),
        experiment_plan_id: decodeURIComponent(experimentPlanItemMatch[2]),
        config: body.config || {}
      });
    }
    if (experimentPlanItemMatch && method === "DELETE") {
      const experimentPlanId = decodeURIComponent(experimentPlanItemMatch[2]);
      const index = experimentPlans.findIndex((plan) => plan.experiment_plan_id === experimentPlanId);
      if (index >= 0) experimentPlans.splice(index, 1);
      return jsonResponse({
        project_id: decodeURIComponent(experimentPlanItemMatch[1]),
        experiment_plan_id: experimentPlanId,
        deleted: true,
        soft_deleted_run_ids: []
      });
    }
    const currentAnalysisMatch = url.match(/^\/api\/projects\/([^/]+)\/analysis-results\/([^/]+)$/);
    if (currentAnalysisMatch && method === "GET") {
      return jsonResponse(createRuntimeCurrentAnalysisResult(
        decodeURIComponent(currentAnalysisMatch[1]),
        decodeURIComponent(currentAnalysisMatch[2])
      ));
    }
    const aircraftReliabilityHistoryMatch = url.match(/^\/api\/projects\/([^/]+)\/aircraft-mission-reliability-analyses$/);
    if (aircraftReliabilityHistoryMatch && method === "GET") {
      return jsonResponse({
        project_id: decodeURIComponent(aircraftReliabilityHistoryMatch[1]),
        analyses: aircraftReliabilityHistory
      });
    }
    if (aircraftReliabilityHistoryMatch && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const record = {
        analysis_id: `analysis-runtime-${aircraftReliabilityHistory.length + 1}`,
        project_id: decodeURIComponent(aircraftReliabilityHistoryMatch[1]),
        aircraft_model: body.aircraftModel,
        mission_profile_id: body.missionProfileId,
        mission_profile_name: body.missionProfileName,
        duration_hours: body.durationHours,
        aircraft_reliability: body.aircraftReliability,
        snapshot: body.snapshot,
        created_at: "2026-07-16T00:00:00Z"
      };
      aircraftReliabilityHistory.unshift(record);
      return jsonResponse(record);
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
		        spare_utilization: 0.35,
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
		          ["出动架次率", "0.750"],
		          ["波次成功率", "80%"],
		          ["整周期任务可靠度", samples ? `${Number((100 / samples).toFixed(1))}%` : "0%"],
		          ["任务周期", "21 天"]
		        ]
		      };
          const runId = `lite-mesa-runtime-${analysisType}`;
		      return jsonResponse({
	        status: "session_complete",
	        source: "lite_mesa_aircraft_support_v1",
	        run_id: runId,
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
	        result_fields: analysisType === "mission_reliability"
	          ? [
	              { key: "sortie_rate", label: "出动架次率", value: 0.75, display_value: "0.750", unit: "" },
	              { key: "wave_success_rate", label: "波次成功率", value: 0.8, display_value: "80%", unit: "%" },
	              { key: "period_completion_probability", label: "整周期任务可靠度", value: samples ? 1 / samples : 0, display_value: samples ? `${Number((100 / samples).toFixed(1))}%` : "0%", unit: "%" },
	              { key: "period_duration_days", label: "任务周期", value: 21, display_value: "21 天", unit: "天" }
	            ]
	          : [],
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
                    display_name: "航母飞行甲板",
                    personnel_in_use: 1,
                    personnel_capacity: 2,
                    equipment_in_use: 1,
                    equipment_capacity: 2,
                    inventory: { "hyd-pump": 0 }
                  },
                  {
                    resource_id: "unknown-resource-id",
                    inventory: { "unknown-product-id": 0 }
                  }
                ],
                spare_shortages: [{ spare_type: "hyd-pump", required_quantity: 1, available_quantity: 0, job_id: "repair-J15-101" }],
                job_node: { job_id: "repair-J15-101", kind: "repair", state: "waiting", task: "更换液压泵", tail_number: "J15-101" }
              }
	            ]
	          : [],
	        period_duration_days: analysisType === "mission_reliability" ? 21 : null,
	        period_total_samples: analysisType === "mission_reliability" ? samples : null,
	        successful_samples: analysisType === "mission_reliability" ? 1 : null,
	        period_failed_samples: analysisType === "mission_reliability" ? Math.max(0, samples - 1) : null,
	        period_completion_probability: analysisType === "mission_reliability" && samples ? 1 / samples : null,
	        visualization_state_series: createRuntimeVisualizationStateSeries(runId),
	        limitations: ["本次分析结果不写入正式结果账本。"],
	        message: "",
          ...liteMesaAnalysisResponseOverrides
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
  await waitForRuntimeAppBootstrap({
    requests,
    hash,
    projectId: backendProjects[0]?.project_id || projectJson.project_id || "project-runtime",
    expectProjectDraft: String(hash || "").includes("feature=") && backendProjects.length > 0
  });

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
    async keydown(selector, dataset = {}, props = {}) {
      await appListeners.keydown?.({
        key: props.key || "",
        preventDefault: props.preventDefault || (() => {}),
        target: eventTarget(selector, dataset, props)
      });
      await flushRuntimeTasks();
    },
    async focusout(selector, dataset = {}, props = {}) {
      await appListeners.focusout?.({
        relatedTarget: props.relatedTarget || null,
        target: eventTarget(selector, dataset, props)
      });
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

function storedZipEntries(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, "test parser expects stored ZIP entries");
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function htmlSectionByClass(html, className) {
  const match = html.match(new RegExp(`<section class="[^"]*\\b${className}\\b[^"]*">[\\s\\S]*?<\\/section>`));
  assert.ok(match, `expected section with class ${className}`);
  return match[0];
}

function createRuntimeDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushRuntimeTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForRuntimeAppBootstrap({ requests, projectId, expectProjectDraft }) {
  const encodedProjectId = encodeURIComponent(projectId);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const projectCatalogRequested = requests.some((request) => (
      request.url === "/api/projects"
      && (request.options.method || "GET") === "GET"
    ));
    const projectDraftRequested = requests.some((request) => (
      request.url === `/api/projects/${encodedProjectId}`
      && (request.options.method || "GET") === "GET"
    ));
    if (projectCatalogRequested && (!expectProjectDraft || projectDraftRequested)) {
      await flushRuntimeTasks();
      return;
    }
    await flushRuntimeTasks();
  }
  assert.fail(expectProjectDraft
    ? `runtime app did not request Project draft ${projectId} during bootstrap`
    : "runtime app did not request the project catalog during bootstrap");
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

function createRmsRuntimeProjectJson(overrides = {}) {
  return createRuntimeProjectJson({
    ...overrides,
    equipment: {
      model: "J-15",
      wholeMachineModels: ["J-15", "J-20"],
      aircraftTypes: [
        { id: "aircraft-type-j15", model: "J-15", name: "J-15" },
        { id: "aircraft-type-j20", model: "J-20", name: "J-20" }
      ],
      ...(overrides.equipment || {})
    },
    components: overrides.components || [
      { id: "j15-engine", aircraftModel: "J-15", name: "J-15 发动机", model: "WS-10", level: "系统", parentId: "aircraft-root", quantity: 2, runningRatio: 1, importance: 1, complexity: 1 },
      { id: "j15-radar", aircraftModel: "J-15", name: "J-15 雷达", model: "RADAR-15", level: "系统", parentId: "aircraft-root", quantity: 1, runningRatio: 1, importance: 1, complexity: 1 },
      { id: "j15-hydraulic", aircraftModel: "J-15", name: "J-15 液压", model: "HYD-15", level: "系统", parentId: "aircraft-root", quantity: 1, runningRatio: 1, importance: 1, complexity: 1 },
      { id: "j15-computer", aircraftModel: "J-15", name: "J-15 任务计算机", model: "MC-15", level: "系统", parentId: "aircraft-root", quantity: 1, runningRatio: 1, importance: 1, complexity: 1 },
      { id: "j20-engine", aircraftModel: "J-20", name: "J-20 发动机", model: "WS-15", level: "系统", parentId: "aircraft-root", quantity: 2, runningRatio: 0.8, importance: 1, complexity: 1 },
      { id: "j20-radar", aircraftModel: "J-20", name: "J-20 雷达", model: "RADAR-20", level: "系统", parentId: "aircraft-root", quantity: 1, runningRatio: 1, importance: 1, complexity: 1 }
    ]
  });
}

function createCase1RmsRuntimeProjectJson(overrides = {}) {
  return createRuntimeProjectJson({
    ...overrides,
    project_id: "project-case-1",
    projectInfo: { name: "案例1", ...(overrides.projectInfo || {}) },
    equipment: {
      model: "J-15",
      wholeMachineModels: ["J-15", "J-35"],
      ...(overrides.equipment || {})
    },
    components: overrides.components || [
      { id: "aircraft-root", name: "舰载机", quantity: 6 },
      { id: "j15-engine", parentId: "aircraft-root", aircraftModel: "J-15", name: "发动机", quantity: 2 },
      { id: "j15-engine-control", parentId: "j15-engine", aircraftModel: "J-15", name: "发动机控制模块", quantity: 1 },
      { id: "j35-radar", parentId: "aircraft-root", aircraftModel: "J-35", name: "J-35 雷达", quantity: 1 }
    ]
  });
}

function createCaseLargeRmsRuntimeProjectJson(overrides = {}) {
  return createRuntimeProjectJson({
    ...overrides,
    project_id: "project-case-large",
    projectInfo: { name: "案例-大", ...(overrides.projectInfo || {}) },
    equipment: {
      model: "J16",
      wholeMachineModels: ["J16", "J16D"],
      ...(overrides.equipment || {})
    },
    components: overrides.components || [
      { id: "j16-structure", aircraftModel: "J16", name: "结构", quantity: 1 },
      { id: "j16-hydraulic", parentId: "j16-structure", aircraftModel: "J16", name: "液压系统", quantity: 1 },
      { id: "j16d-avionics", aircraftModel: "J16D", name: "J16D 航电系统", quantity: 1 }
    ]
  });
}

function createPersistedRmsRuntimeProjectJson() {
  const project = createRmsRuntimeProjectJson();
  const j15Project = createRmsAllocationProjectForScenario(project, "J-15");
  const j20Project = createRmsAllocationProjectForScenario(project, "J-20");
  const j15Plan = createDefaultRmsAllocationPlan(j15Project);
  const j20Plan = createDefaultRmsAllocationPlan(j20Project);
  j15Plan.inputs.missionReliability = 0.91;
  j15Plan.methods.allocation = "proportional";
  j20Plan.inputs.missionReliability = 0.88;
  project.rmsAllocationPlan = {
    schemaVersion: "rms-allocation-workbench-v1",
    selectedAircraftModel: "J-15",
    aircraftStates: {
      "J-15": {
        plan: j15Plan,
        selectedEquipmentNodeId: "rms:J-15:j15-engine",
        equipmentNodes: j15Project.equipmentNodes
      },
      "J-20": {
        plan: j20Plan,
        selectedEquipmentNodeId: j20Project.rootId,
        equipmentNodes: j20Project.equipmentNodes
      }
    }
  };
  project.rmsAllocationResult = {
    schemaVersion: "rms-allocation-result-set-v1",
    byAircraftModel: {
      "J-15": calculateRmsAllocation(j15Plan, j15Project)
    }
  };
  return project;
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
