import assert from "node:assert/strict";
import test from "node:test";

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
    assert.match(appNode.innerHTML, /所属型号/);
    assert.doesNotMatch(appNode.innerHTML, /适用机型/);

    const fileInput = {
      dataset: { supportResourceImportFile: "保障人员" },
      files: [{
        name: "personnel.csv",
        async text() {
          return "组织节点,所属型号,专业,数量\n航母飞行甲板,J-15,机务,7";
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
    assert.match(appNode.innerHTML, /value="J-15"/);
    assert.match(appNode.innerHTML, /value="机务"/);
    assert.match(appNode.innerHTML, /value="7"/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
    globalThis.fetch = previousFetch;
  }
});

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}
