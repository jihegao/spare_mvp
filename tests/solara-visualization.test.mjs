import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSolaraVisualizationUrl,
  DEFAULT_SOLARA_VISUALIZATION_URL,
  resolveSolaraVisualizationBaseUrl,
  SOLARA_VISUALIZATION_URL_STORAGE_KEY
} from "../front/solara-visualization.mjs";

test("Solara visualization URL defaults to the managed sidecar", () => {
  assert.equal(resolveSolaraVisualizationBaseUrl({ locationRef: {}, storage: null }), DEFAULT_SOLARA_VISUALIZATION_URL);
});

test("Solara visualization URL can be overridden from query or local storage", () => {
  const storage = new Map([[SOLARA_VISUALIZATION_URL_STORAGE_KEY, "http://127.0.0.1:9900/"]]);
  assert.equal(
    resolveSolaraVisualizationBaseUrl({
      locationRef: { search: "", hash: "" },
      storage: { getItem: (key) => storage.get(key) }
    }),
    "http://127.0.0.1:9900"
  );
  assert.equal(
    resolveSolaraVisualizationBaseUrl({
      locationRef: { search: "?solaraUrl=http%3A%2F%2F127.0.0.1%3A8800", hash: "" },
      storage: null
    }),
    "http://127.0.0.1:8800"
  );
});

test("Solara iframe URL carries visual simulation context without using legacy sidecar names", () => {
  const url = buildSolaraVisualizationUrl("http://127.0.0.1:8765/", {
    projectId: "project-ui",
    featureId: "spare-planning-visual-mesa-page",
    experimentPlanName: "方案A",
    reload: 2
  });

  assert.match(url, /^http:\/\/127\.0\.0\.1:8765\/\?/);
  assert.match(url, /embedded=1/);
  assert.match(url, /project_id=project-ui/);
  assert.match(url, /feature_id=spare-planning-visual-mesa-page/);
  assert.match(url, /experiment_plan_name=/);
  assert.match(url, /reload=2/);
  assert.doesNotMatch(url, /8521|independent-mesa|mesa-visualization-runs/);
});
