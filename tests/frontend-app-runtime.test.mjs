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
    assert.match(runtime.appNode.innerHTML, /data-modeling-import-template/);
    assert.match(runtime.appNode.innerHTML, /data-project-create-from-import/);
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

test("feature routes without a template-created project return to project list", async () => {
  const runtime = await setupRuntimeApp({
    hash: "feature=spare-planning-experiment-plan-list",
    backendProjects: []
  });

  try {
    assert.match(runtime.appNode.innerHTML, /项目列表/);
    assert.match(runtime.appNode.innerHTML, /请选择模板数据创建项目/);
    assert.match(runtime.appNode.innerHTML, /data-modeling-import-template/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /data-experiment-plan-select="local:本地空白预览"/);
    assert.doesNotMatch(runtime.appNode.innerHTML, /本地空白预览/);
  } finally {
    runtime.restore();
  }
});

test("project list keeps multiple projects created from the current published snapshot", async () => {
  const runtime = await setupRuntimeApp({
    backendProjects: []
  });

  try {
    assert.match(runtime.appNode.innerHTML, /请选择模板数据创建项目/);

    await runtime.click("[data-project-create-from-import]");
    await runtime.click("[data-project-create-from-import]");

    assert.match(runtime.appNode.innerHTML, /已加载 2 个后端项目/);
    assert.match(runtime.appNode.innerHTML, /运行时模板项目 1/);
    assert.match(runtime.appNode.innerHTML, /运行时模板项目 2/);
    assert.match(runtime.appNode.innerHTML, /data-enter-workbench data-project-id="runtime-imported"/);
    assert.match(runtime.appNode.innerHTML, /data-enter-workbench data-project-id="runtime-imported-copy-2"/);
    const createRequests = runtime.requests.filter((request) => (
      request.url.endsWith("/create-project")
      && (request.options.method || "GET") === "POST"
    ));
    assert.equal(createRequests.length, 2);
  } finally {
    runtime.restore();
  }
});

test("project list rename persists and survives creating another project from the published snapshot", async () => {
  const projectJson = createRuntimeProjectJson({
    project_id: "project-runtime",
    projectInfo: { name: "Runtime 项目", baseCode: "RT", summary: "runtime test" }
  });
  const runtime = await setupRuntimeApp({ projectJson });

  try {
    await runtime.click("[data-project-edit]", { projectEdit: "runtime" });
    await runtime.input("[data-project-edit-field]", { projectEditField: "name" }, { value: "原 Project 改名" });
    await runtime.click("[data-project-edit-save]");
    await runtime.click("[data-project-create-from-import]");

    assert.match(runtime.appNode.innerHTML, /原 Project 改名/);
    assert.match(runtime.appNode.innerHTML, /运行时模板项目 1/);
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
    assert.match(runtime.appNode.innerHTML, /Mesa蒙特卡洛分析/);
    assert.match(runtime.appNode.innerHTML, /data-lite-mesa-field="samples"/);

    await runtime.change("[data-lite-mesa-field]", { liteMesaField: "samples" }, { value: "3", type: "number" });

    assert.doesNotMatch(runtime.appNode.innerHTML, /设置已更新，等待重新运行 Mesa 分析/);

    await runtime.click("[data-lite-mesa-action='run']");

    assert.match(runtime.appNode.innerHTML, /Mesa 分析完成：3 个样本/);
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
        updated_at: "2026-06-26 00:00:00"
      };
      const existingIndex = backendProjectCatalog.findIndex((entry) => entry.project_id === projectId);
      if (existingIndex >= 0) backendProjectCatalog[existingIndex] = { ...backendProjectCatalog[existingIndex], ...catalogEntry };
      else backendProjectCatalog.unshift(catalogEntry);
      return jsonResponse({ project_id: body.project_id || "project-runtime", project_version: "project-v0.1" });
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
    basicMission: { name: "运行时基本任务", equipmentType: "J-15", taskDurationMinutes: 90, minRequiredSorties: 1 },
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
    basicMission: { ...project.basicMission, ...(overrides.basicMission || {}) },
    equipment: { ...project.equipment, ...(overrides.equipment || {}) }
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
