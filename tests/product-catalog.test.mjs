import test from "node:test";
import assert from "node:assert/strict";

import {
  componentsSharingProduct,
  createProjectProduct,
  findProjectProductConflicts,
  searchProjectProducts,
  normalizeProjectProducts,
  projectHasExponentialFailureConflicts,
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

test("exponential reliability synchronizes exact product IDs without retaining the MTBF compatibility scalar", () => {
  const project = {
    products: [
      {
        id: "product-engine",
        name: "共享发动机",
        mtbfHours: 500,
        failureDistribution: { distributionType: "指数分布", rate: 0.002 }
      },
      {
        id: "PRODUCT-ENGINE",
        name: "大小写不同发动机",
        mtbfHours: 30,
        failureDistribution: { distributionType: "指数分布", rate: 0.0333333333333333 }
      }
    ],
    components: [
      {
        id: "j15-engine",
        aircraftModel: "J-15",
        productId: "product-engine",
        mtbfHours: 500,
        failureDistribution: { distributionType: "指数分布", rate: 0.002 }
      },
      { id: "j35-engine", aircraftModel: "J-35", productId: "product-engine" },
      { id: "case-sensitive-engine", aircraftModel: "J-35", productId: "PRODUCT-ENGINE" }
    ]
  };

  normalizeProjectProducts(project);

  assert.deepEqual(
    componentsSharingProduct(project, "product-engine").map((component) => component.id),
    ["j15-engine", "j35-engine"]
  );
  assert.equal(project.products[0].failureDistribution.rate, 0.002);
  assert.equal(project.components[0].failureDistribution.rate, 0.002);
  assert.equal(project.components[1].failureDistribution.rate, 0.002);
  assert.equal(project.products[1].failureDistribution.rate, 0.0333333333333333);
  assert.equal(project.components[2].failureDistribution.rate, 0.0333333333333333);

  assert.equal(updateSharedProductParameter(
    project,
    "product-engine",
    "failureDistribution",
    { distributionType: "指数分布", rate: 0.005 }
  ), true);

  for (const item of [project.products[0], project.components[0], project.components[1]]) {
    assert.deepEqual(item.failureDistribution, { distributionType: "指数分布", rate: 0.005 });
    assert.equal(Object.hasOwn(item, "mtbfHours"), false);
  }
  assert.equal(project.products[1].failureDistribution.rate, 0.0333333333333333);
  assert.equal(project.components[2].failureDistribution.rate, 0.0333333333333333);
  assert.equal(Object.hasOwn(project.products[1], "mtbfHours"), false);
  assert.equal(Object.hasOwn(project.components[2], "mtbfHours"), false);
});

test("conflicting exponential reliability survives hydrate unchanged and is not silently synchronized", () => {
  const project = {
    products: [{
      id: "product-shared",
      name: "共享产品",
      failureDistribution: {
        distributionType: "指数分布",
        rate: 0.002,
        lambda: 0.003
      }
    }],
    components: [{
      id: "component-a",
      productId: "product-shared",
      failureDistribution: { distributionType: "指数分布", rate: 0.004 }
    }]
  };
  const before = structuredClone(project);

  assert.equal(projectHasExponentialFailureConflicts(project), true);
  normalizeProjectProducts(project);

  assert.deepEqual(project.products[0].failureDistribution, before.products[0].failureDistribution);
  assert.deepEqual(project.components[0].failureDistribution, before.components[0].failureDistribution);
});

test("empty product exponential distribution backfills from one consistent component rate", () => {
  const project = {
    products: [{
      id: "product-shared",
      name: "共享产品",
      failureDistribution: { distributionType: "指数分布" }
    }],
    components: [{
      id: "component-a",
      productId: "product-shared",
      failureDistribution: { distributionType: "exponential", rate: 0.004 }
    }, {
      id: "component-b",
      productId: "product-shared",
      failureDistribution: { distributionType: "指数分布", rate: 0.004 }
    }]
  };

  assert.equal(projectHasExponentialFailureConflicts(project), false);
  normalizeProjectProducts(project);

  assert.deepEqual(project.products[0].failureDistribution, {
    distributionType: "指数分布",
    rate: 0.004
  });
  for (const component of project.components) {
    assert.deepEqual(component.failureDistribution, {
      distributionType: "指数分布",
      rate: 0.004
    });
  }
});

test("fixed product parameters outrank the MTBF compatibility projection and legacy values backfill only when missing", () => {
  const project = {
    products: [
      { id: "legacy", name: "Legacy", mtbfHours: 1200, failureDistribution: { distributionType: "固定值" } },
      { id: "explicit-value", name: "Value", mtbfHours: 300, failureDistribution: { distributionType: "fixed", value: 450 } },
      { id: "explicit-mean", name: "Mean", mtbfHours: 300, failureDistribution: { distributionType: "固定值", mean: 600 } },
      { id: "value-first", name: "Both", mtbfHours: 300, failureDistribution: { distributionType: "fixed", value: 450, mean: 600 } },
      { id: "value-negative", name: "Negative value", mtbfHours: 301, failureDistribution: { distributionType: "fixed", value: -1 } },
      { id: "value-zero", name: "Zero value", mtbfHours: 302, failureDistribution: { distributionType: "fixed", value: 0 } },
      { id: "value-null", name: "Null value", mtbfHours: 303, failureDistribution: { distributionType: "fixed", value: null, mean: 603 } },
      { id: "mean-negative", name: "Negative mean", mtbfHours: 304, failureDistribution: { distributionType: "fixed", mean: -1 } },
      { id: "mean-zero", name: "Zero mean", mtbfHours: 305, failureDistribution: { distributionType: "fixed", mean: 0 } },
      { id: "mean-null", name: "Null mean", mtbfHours: 306, failureDistribution: { distributionType: "fixed", mean: null } },
      { id: "non-fixed", name: "Exponential", mtbfHours: 50, failureDistribution: { distributionType: "指数分布", rate: 0.02 } }
    ],
    components: [
      "legacy", "explicit-value", "explicit-mean", "value-first", "value-negative", "value-zero", "value-null",
      "mean-negative", "mean-zero", "mean-null", "non-fixed"
    ]
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
  assert.equal(products["value-negative"].mtbfHours, 301);
  assert.equal(products["value-negative"].failureDistribution.value, -1);
  assert.equal(products["value-zero"].mtbfHours, 302);
  assert.equal(products["value-zero"].failureDistribution.value, 0);
  assert.equal(products["value-null"].mtbfHours, 303);
  assert.equal(products["value-null"].failureDistribution.value, null);
  assert.equal(products["value-null"].failureDistribution.mean, 603);
  assert.equal(products["mean-negative"].mtbfHours, 304);
  assert.equal(products["mean-negative"].failureDistribution.mean, -1);
  assert.equal(products["mean-zero"].mtbfHours, 305);
  assert.equal(products["mean-zero"].failureDistribution.mean, 0);
  assert.equal(products["mean-null"].mtbfHours, 306);
  assert.equal(products["mean-null"].failureDistribution.mean, null);
  assert.equal(Object.hasOwn(products["non-fixed"], "mtbfHours"), false);
  assert.equal(Object.hasOwn(components["non-fixed"], "mtbfHours"), false);
  assert.deepEqual(products["non-fixed"].failureDistribution, { distributionType: "指数分布", rate: 0.02 });
  const once = JSON.stringify(project);
  normalizeProjectProducts(project);
  assert.equal(JSON.stringify(project), once);
});

test("fixed failure distributions synchronize the shared MTBF compatibility scalar", () => {
  const project = {
    products: [{ id: "product-engine", mtbfHours: 1200, failureDistribution: { distributionType: "固定值" } }],
    components: [{ id: "j15-engine", productId: "product-engine" }, { id: "j35-engine", productId: "product-engine" }]
  };

  normalizeProjectProducts(project);
  assert.equal(updateSharedProductParameter(project, "product-engine", "failureDistribution.value", 1500), true);
  assert.equal(project.products[0].mtbfHours, 1500);
  assert.equal(project.components[0].mtbfHours, 1500);
  assert.equal(project.components[1].failureDistribution.value, 1500);
});

test("matching legacy component parameters seed a product once", () => {
  const project = {
    products: [{ id: "product-shared", name: "共享产品" }],
    components: [
      { id: "first", productId: "product-shared", failureDistribution: { distributionType: "指数分布", rate: 0.01 } },
      { id: "second", productId: "product-shared", failureDistribution: { distributionType: "指数分布", rate: 0.01 } }
    ]
  };
  normalizeProjectProducts(project);
  assert.equal(project.products[0].failureDistribution.rate, 0.01);
  assert.equal(project.components[1].failureDistribution.rate, 0.01);
});
