import test from "node:test";
import assert from "node:assert/strict";

import {
  componentsSharingProduct,
  createProjectProduct,
  findProjectProductConflicts,
  searchProjectProducts,
  normalizeProjectProducts,
  updateSharedProductParameter
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

test("product search matches exact catalog fields without mutating product definitions", () => {
  const project = {
    products: [
      { id: "product-engine", name: "发动机产品", model: "WS-10", kind: "LRU" },
      { id: "product-radar", name: "雷达产品", model: "RADAR-15", kind: "SRU" }
    ]
  };
  const before = JSON.stringify(project.products);

  assert.deepEqual(searchProjectProducts(project, "product-engine").map((product) => product.id), ["product-engine"]);
  assert.deepEqual(searchProjectProducts(project, "雷达").map((product) => product.id), ["product-radar"]);
  assert.deepEqual(searchProjectProducts(project, "ws-10").map((product) => product.id), ["product-engine"]);
  assert.equal(JSON.stringify(project.products), before);
});

test("product conflict checks block equal names or models and generated IDs stay collision-safe", () => {
  const project = {
    products: [
      { id: "product-新雷达", name: "占位目录项", model: "OLD-1", kind: "LRU" },
      { id: "product-existing", name: "已有雷达", model: "RAD-1", kind: "LRU" }
    ],
    components: []
  };

  const nameConflict = findProjectProductConflicts(project, { name: " 已有雷达 ", model: "RAD-2" });
  assert.deepEqual(nameConflict.nameMatches.map((product) => product.id), ["product-existing"]);
  const modelConflict = findProjectProductConflicts(project, { name: "新名称", model: "rad-1" });
  assert.deepEqual(modelConflict.modelMatches.map((product) => product.id), ["product-existing"]);

  const created = createProjectProduct(project, { name: "新雷达", model: "RAD-2", kind: "SRU" });
  assert.equal(created.id, "product-新雷达-2");
  assert.equal(project.products.find((product) => product.id === "product-新雷达").name, "占位目录项");
});

test("product search keeps a 442-item catalog pure and returns only matching candidates", () => {
  const products = Array.from({ length: 442 }, (_, index) => ({
    id: `product-${index + 1}`,
    name: `产品 ${index + 1}`,
    model: `MODEL-${String(index + 1).padStart(3, "0")}`,
    kind: index % 2 ? "LRU" : "SRU"
  }));
  const project = { products };
  const before = JSON.stringify(products);

  assert.deepEqual(
    searchProjectProducts(project, "MODEL-442").map((product) => product.id),
    ["product-442"]
  );
  assert.equal(JSON.stringify(project.products), before);
});

test("shared reliability parameters hydrate from the canonical exact product ID and update every exact reference", () => {
  const project = {
    products: [
      { id: "product-engine", name: "发动机", mtbfHours: 1200, repairDistribution: { distributionType: "固定值" } },
      { id: "PRODUCT-ENGINE", name: "大小写不同产品", mtbfHours: 300 }
    ],
    components: [
      { id: "j15-engine", productId: "product-engine", mtbfHours: 1 },
      { id: "j35-engine", productId: "product-engine" },
      { id: "case-sensitive-engine", productId: "PRODUCT-ENGINE" }
    ]
  };
  normalizeProjectProducts(project);
  assert.deepEqual(componentsSharingProduct(project, "product-engine").map((item) => item.id), ["j15-engine", "j35-engine"]);
  assert.equal(project.components[0].mtbfHours, 1200);
  assert.equal(project.components[1].mtbfHours, 1200);
  assert.equal(project.components[2].mtbfHours, 300);
  assert.equal(updateSharedProductParameter(project, "product-engine", "repairDistribution.value", 90), true);
  assert.equal(project.products[0].repairDistribution.value, 90);
  assert.equal(project.components[0].repairDistribution.value, 90);
  assert.equal(project.components[1].repairDistribution.value, 90);
  assert.equal(project.components[2].repairDistribution, undefined);
});

test("fixed product parameters outrank the MTBF compatibility projection and legacy values backfill only when missing", () => {
  const project = {
    products: [
      { id: "legacy", name: "Legacy", mtbfHours: 1200, failureDistribution: { distributionType: "固定值" } },
      { id: "explicit-value", name: "Value", mtbfHours: 300, failureDistribution: { distributionType: "fixed", value: 450 } },
      { id: "explicit-mean", name: "Mean", mtbfHours: 300, failureDistribution: { distributionType: "固定值", mean: 600 } },
      { id: "value-first", name: "Both", mtbfHours: 300, failureDistribution: { distributionType: "fixed", value: 450, mean: 600 } },
      { id: "invalid-explicit", name: "Invalid", mtbfHours: 300, failureDistribution: { distributionType: "fixed", value: -1 } },
      { id: "non-fixed", name: "Exponential", mtbfHours: 300, failureDistribution: { distributionType: "指数分布", rate: 0.02 } }
    ],
    components: ["legacy", "explicit-value", "explicit-mean", "value-first", "invalid-explicit", "non-fixed"]
      .map((productId) => ({ id: `${productId}-component`, productId }))
  };

  normalizeProjectProducts(project);

  const products = Object.fromEntries(project.products.map((product) => [product.id, product]));
  const components = Object.fromEntries(project.components.map((component) => [component.productId, component]));
  assert.equal(products.legacy.failureDistribution.value, 1200);
  assert.equal(components.legacy.failureDistribution.value, 1200);
  assert.equal(products["explicit-value"].mtbfHours, 450);
  assert.equal(components["explicit-value"].mtbfHours, 450);
  assert.equal(products["explicit-mean"].mtbfHours, 600);
  assert.equal(products["explicit-mean"].failureDistribution.value, undefined);
  assert.equal(components["explicit-mean"].mtbfHours, 600);
  assert.equal(products["value-first"].mtbfHours, 450);
  assert.equal(products["invalid-explicit"].mtbfHours, 300);
  assert.equal(products["invalid-explicit"].failureDistribution.value, -1);
  assert.equal(products["non-fixed"].mtbfHours, 300);
  assert.deepEqual(products["non-fixed"].failureDistribution, { distributionType: "指数分布", rate: 0.02 });
  const once = JSON.stringify(project);
  normalizeProjectProducts(project);
  assert.equal(JSON.stringify(project), once);
});

test("legacy component parameters seed a product once and canonical product values win conflicts", () => {
  const project = {
    products: [{ id: "product-shared", name: "共享产品" }],
    components: [
      { id: "first", productId: "product-shared", failureDistribution: { distributionType: "指数分布", rate: 0.01 } },
      { id: "second", productId: "product-shared", failureDistribution: { distributionType: "指数分布", rate: 0.02 } }
    ]
  };
  normalizeProjectProducts(project);
  assert.equal(project.products[0].failureDistribution.rate, 0.01);
  assert.equal(project.components[1].failureDistribution.rate, 0.01);
});
