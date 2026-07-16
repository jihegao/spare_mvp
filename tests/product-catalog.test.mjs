import test from "node:test";
import assert from "node:assert/strict";

import {
  createProjectProduct,
  normalizeProjectProducts
} from "../front/product-catalog.mjs";

test("legacy projects receive deterministic products and product references without spareType", () => {
  const project = {
    components: [
      { id: "j15-engine", name: "发动机", aircraftModel: "J-15", productType: "LRU", spareType: "旧备件类型" }
    ],
    supportResources: [
      { id: "base-engine", type: "spare", name: "发动机", model: "j15-engine", quantity: 2 }
    ],
    transportPolicies: [{ id: "engine-route", spareType: "发动机" }],
    supportActivityJobs: [{ activityCode: "repair-engine", spare: [{ name: "发动机", model: "j15-engine", quantity: 1 }] }]
  };

  normalizeProjectProducts(project);

  assert.deepEqual(project.products, [{
    id: "product-j15-engine",
    name: "发动机",
    model: "j15-engine",
    kind: "LRU"
  }]);
  assert.equal(project.components[0].productId, "product-j15-engine");
  assert.equal("spareType" in project.components[0], false);
  assert.equal(project.supportResources[0].productId, "product-j15-engine");
  assert.equal(project.transportPolicies[0].productId, "product-j15-engine");
  assert.equal("spareType" in project.transportPolicies[0], false);
  assert.equal(project.supportActivityJobs[0].spare[0].productId, "product-j15-engine");

  const once = JSON.stringify(project);
  normalizeProjectProducts(project);
  assert.equal(JSON.stringify(project), once);
});

test("new products can be created and shared by multiple component or resource references", () => {
  const project = { products: [], components: [], supportResources: [] };
  const product = createProjectProduct(project, { name: "雷达组件", model: "RAD-1", kind: "LRU" });
  assert.equal(product.id, "product-雷达组件");
  assert.equal(project.products[0].name, "雷达组件");
});
