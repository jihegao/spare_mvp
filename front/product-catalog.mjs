export function normalizeProjectProducts(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return project;
  const components = Array.isArray(project.components) ? project.components : [];
  const products = Array.isArray(project.products)
    ? project.products.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({ ...item }))
    : [];
  const byId = new Map();
  for (const [index, product] of products.entries()) {
    const id = cleanText(product.id) || uniqueProductId(byId, `product-${index + 1}`);
    product.id = id;
    product.name = cleanText(product.name) || id;
    if (byId.has(id)) continue;
    byId.set(id, product);
  }

  const componentById = new Map();
  for (const [index, component] of components.entries()) {
    if (!component || typeof component !== "object" || Array.isArray(component)) continue;
    const componentId = cleanText(component.id) || `component-${index + 1}`;
    componentById.set(componentId, component);
    const requestedProductId = cleanText(component.productId);
    const productId = requestedProductId || uniqueProductId(byId, `product-${componentId}`);
    component.productId = productId;
    delete component.spareType;
    if (!byId.has(productId)) {
      byId.set(productId, productFromComponent(component, productId));
    }
  }

  const productsByIdentity = productIdentityIndex(byId.values());
  for (const resource of Array.isArray(project.supportResources) ? project.supportResources : []) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) continue;
    if (!isSpareResource(resource)) continue;
    let productId = cleanText(resource.productId);
    if (!productId || !byId.has(productId)) {
      const component = componentById.get(cleanText(resource.model))
        || componentById.get(cleanText(resource.equipmentId))
        || componentById.get(cleanText(resource.equipment));
      productId = component?.productId
        || productsByIdentity.get(productIdentity(resource.name, resource.model))
        || productsByIdentity.get(productIdentity(resource.name, ""));
    }
    if (!productId) {
      productId = uniqueProductId(byId, `product-${cleanText(resource.id) || cleanText(resource.model) || cleanText(resource.name) || "spare"}`);
    }
    if (!byId.has(productId)) {
      const product = {
        id: productId,
        name: cleanText(resource.name) || cleanText(resource.model) || productId,
        model: cleanText(resource.model),
        kind: "LRU"
      };
      byId.set(productId, product);
      productsByIdentity.set(productIdentity(product.name, product.model), productId);
      productsByIdentity.set(productIdentity(product.name, ""), productId);
    }
    resource.productId = productId;
    delete resource.spareName;
    delete resource.spareType;
    delete resource.spare_type;
  }

  const policies = [
    ...(Array.isArray(project.transportPolicies) ? project.transportPolicies : []),
    ...(Array.isArray(project.supportNodes)
      ? project.supportNodes.flatMap((node) => Array.isArray(node?.transportPolicies) ? node.transportPolicies : [])
      : []),
    ...(Array.isArray(project.supportActivities)
      ? project.supportActivities.flatMap((activity) => Array.isArray(activity?.transportStrategies) ? activity.transportStrategies : [])
      : [])
  ];
  for (const policy of policies) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) continue;
    const legacyLabel = cleanText(policy.spareName || policy.spareType || policy.spare_type);
    if (!cleanText(policy.productId) && legacyLabel) {
      let productId = productsByIdentity.get(productIdentity(legacyLabel, ""));
      if (!productId) {
        productId = uniqueProductId(byId, `product-${legacyLabel}`);
        const product = { id: productId, name: legacyLabel, model: legacyLabel, kind: "LRU" };
        byId.set(productId, product);
        productsByIdentity.set(productIdentity(product.name, product.model), productId);
        productsByIdentity.set(productIdentity(product.name, ""), productId);
      }
      policy.productId = productId;
    }
    delete policy.spareName;
    delete policy.spareType;
    delete policy.spare_type;
  }

  for (const job of Array.isArray(project.supportActivityJobs) ? project.supportActivityJobs : []) {
    for (const requirement of Array.isArray(job?.spare) ? job.spare : []) {
      if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
      let productId = cleanText(requirement.productId)
        || productsByIdentity.get(productIdentity(requirement.name, requirement.model))
        || productsByIdentity.get(productIdentity(requirement.name, ""));
      if (!productId) {
        productId = uniqueProductId(byId, `product-${cleanText(requirement.name) || cleanText(requirement.model) || "spare"}`);
        const product = {
          id: productId,
          name: cleanText(requirement.name) || cleanText(requirement.model) || productId,
          model: cleanText(requirement.model),
          kind: "LRU"
        };
        byId.set(productId, product);
        productsByIdentity.set(productIdentity(product.name, product.model), productId);
        productsByIdentity.set(productIdentity(product.name, ""), productId);
      }
      requirement.productId = productId;
      delete requirement.spareName;
      delete requirement.spareType;
      delete requirement.spare_type;
    }
  }

  project.products = [...byId.values()];
  synchronizeProjectProductParameters(project);
  return project;
}

export const SHARED_PRODUCT_PARAMETER_FIELDS = Object.freeze([
  "mtbfHours", "meanRepairTimeMinutes", "failureDistribution", "repairDistribution"
]);

const EXPONENTIAL_RATE_PARAMETER_PATTERN = /(?:^|[,，;；\s])(?:lambda|λ|rate|failure_rate)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i;
const EXPONENTIAL_MEAN_PARAMETER_PATTERN = /(?:^|[,，;；\s])(?:mean|mu)\s*=/i;
const EXPONENTIAL_RATE_KEYS = Object.freeze(["rate", "lambda", "λ", "failure_rate"]);

export function synchronizeProjectProductParameters(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return project;
  if (projectHasExponentialFailureConflicts(project)) return project;
  const products = Array.isArray(project.products) ? project.products : [];
  const components = Array.isArray(project.components) ? project.components : [];
  const componentsByProductId = new Map();
  for (const component of components) {
    const productId = exactProductId(component?.productId);
    if (!productId) continue;
    if (!componentsByProductId.has(productId)) componentsByProductId.set(productId, []);
    componentsByProductId.get(productId).push(component);
  }
  for (const product of products) {
    const distribution = product?.failureDistribution;
    if (!isExponentialDistribution(distribution)) continue;
    const productAnalysis = exponentialFailureSourceAnalysis(product, distribution);
    if (productAnalysis.rate !== null) continue;
    const source = (componentsByProductId.get(exactProductId(product.id)) || [])
      .map((component) => {
        const componentDistribution = component?.failureDistribution;
        return isExponentialDistribution(componentDistribution)
          ? exponentialFailureSourceAnalysis(component, componentDistribution)
          : null;
      })
      .find((analysis) => analysis?.rate !== null);
    if (!source) continue;
    product.failureDistribution = {
      distributionType: cleanText(distribution.distributionType || distribution.distribution_type) || "指数分布",
      rate: source.rate
    };
  }
  for (const product of products) normalizeProductFailureParameters(product);
  const productsById = new Map(products.map((product) => [exactProductId(product?.id), product]));
  for (const component of components) {
    const product = productsById.get(exactProductId(component?.productId));
    if (!product) continue;
    for (const field of SHARED_PRODUCT_PARAMETER_FIELDS) {
      if (!Object.hasOwn(product, field) && Object.hasOwn(component, field)) product[field] = cloneValue(component[field]);
    }
  }
  for (const product of products) normalizeProductFailureParameters(product);
  for (const component of components) {
    const product = productsById.get(exactProductId(component?.productId));
    if (product) copySharedProductParameters(product, component);
  }
  return project;
}

export function projectHasExponentialFailureConflicts(project) {
  const products = Array.isArray(project?.products) ? project.products : [];
  const components = Array.isArray(project?.components) ? project.components : [];
  const groups = new Map();
  for (const product of products) {
    const productId = exactProductId(product?.id);
    if (productId) groups.set(productId, [product]);
  }
  for (const component of components) {
    const productId = exactProductId(component?.productId);
    if (!productId) continue;
    if (!groups.has(productId)) groups.set(productId, []);
    groups.get(productId).push(component);
  }
  for (const owners of groups.values()) {
    const rates = [];
    let hasExponential = false;
    for (const owner of owners) {
      const distribution = owner?.failureDistribution;
      if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) continue;
      if (!isExponentialDistribution(distribution)) {
        if (hasExponential || rates.length) return true;
        continue;
      }
      hasExponential = true;
      const analysis = exponentialFailureSourceAnalysis(owner, distribution);
      if (analysis.invalid) return true;
      if (analysis.rate !== null) rates.push(analysis.rate);
    }
    if (!hasExponential) continue;
    if (!rates.length) return true;
    if (rates.some((rate) => !ratesClose(rate, rates[0]))) return true;
    if (owners.some((owner) => {
      const distribution = owner?.failureDistribution;
      return distribution
        && typeof distribution === "object"
        && !Array.isArray(distribution)
        && !isExponentialDistribution(distribution);
    })) return true;
  }
  return false;
}

function exponentialFailureSourceAnalysis(owner, distribution) {
  const sources = [];
  const allowedFields = new Set([
    "distributionType", "distribution_type", "parameters", "params", ...EXPONENTIAL_RATE_KEYS
  ]);
  if (Object.keys(distribution).some((field) => !allowedFields.has(field))) {
    return { invalid: true, rate: null };
  }
  for (const key of EXPONENTIAL_RATE_KEYS) {
    if (!Object.hasOwn(distribution, key)) continue;
    const rate = positiveNumberOrNull(distribution[key]);
    if (rate === null) return { invalid: true, rate: null };
    sources.push(rate);
  }
  for (const field of ["parameters", "params"]) {
    if (!Object.hasOwn(distribution, field)) continue;
    const parameters = distribution[field];
    if (typeof parameters === "number") {
      const rate = positiveNumberOrNull(parameters);
      if (rate === null) return { invalid: true, rate: null };
      sources.push(rate);
      continue;
    }
    if (typeof parameters !== "string") return { invalid: true, rate: null };
    for (const item of parameters.split(/[,，;；]/)) {
      const token = item.trim();
      if (!token) continue;
      const match = token.match(/^(lambda|λ|rate|failure_rate)\s*=\s*(.+)$/i);
      const rate = positiveNumberOrNull(match?.[2]);
      if (!match || rate === null) return { invalid: true, rate: null };
      sources.push(rate);
    }
  }
  if (Object.hasOwn(owner || {}, "mtbfHours")) {
    const mtbf = positiveNumberOrNull(owner.mtbfHours);
    if (mtbf === null) return { invalid: true, rate: null };
    sources.push(1 / mtbf);
  }
  if (sources.some((rate) => !ratesClose(rate, sources[0]))) {
    return { invalid: true, rate: null };
  }
  return { invalid: false, rate: sources[0] ?? null };
}

function ratesClose(left, right) {
  return Math.abs(left - right) <= Math.max(1e-12, 1e-9 * Math.max(Math.abs(left), Math.abs(right)));
}

function normalizeProductFailureParameters(product) {
  const distribution = product?.failureDistribution;
  if (isExponentialDistribution(distribution)) {
    canonicalizeExponentialFailureDistribution(distribution);
    delete product.mtbfHours;
    return;
  }
  normalizeFixedMtbfRepresentations(product);
}

function normalizeFixedMtbfRepresentations(product) {
  const distribution = product?.failureDistribution;
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return;
  const distributionType = cleanText(distribution.distributionType || distribution.distribution_type).toLocaleLowerCase();
  if (!distributionType.includes("fixed") && !distributionType.includes("固定")) return;
  if (Object.hasOwn(distribution, "value")) {
    const value = positiveNumberOrNull(distribution.value);
    if (value !== null) product.mtbfHours = value;
    return;
  }
  if (Object.hasOwn(distribution, "mean")) {
    const mean = positiveNumberOrNull(distribution.mean);
    if (mean !== null) product.mtbfHours = mean;
    return;
  }
  const legacyMtbfHours = positiveNumberOrNull(product.mtbfHours);
  if (legacyMtbfHours !== null) distribution.value = legacyMtbfHours;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function updateSharedProductParameter(project, productId, parameterPath, value) {
  const product = projectProductById(project, productId);
  const path = String(parameterPath || "").split(".").filter(Boolean);
  if (!product || !path.length || !SHARED_PRODUCT_PARAMETER_FIELDS.includes(path[0])) return false;
  setNestedValue(product, path, cloneValue(value));
  if (path[0] === "mtbfHours" && isFixedDistribution(product.failureDistribution)) {
    product.failureDistribution.value = cloneValue(value);
  }
  normalizeProductFailureParameters(product);
  for (const component of project.components || []) {
    if (exactProductId(component?.productId) === exactProductId(product.id)) copySharedProductParameters(product, component);
  }
  return true;
}

export function exponentialMtbfHoursForDistribution(distribution) {
  const rate = exponentialFailureRate(distribution);
  return rate !== null && rate > 0 ? 1 / rate : "";
}

export function exponentialFailureDistributionForMtbf(distribution, mtbfHours) {
  const mtbf = Number(mtbfHours);
  if (!Number.isFinite(mtbf) || mtbf <= 0) return null;
  return {
    distributionType: cleanText(distribution?.distributionType || distribution?.distribution_type) || "指数分布",
    rate: 1 / mtbf
  };
}

export function canonicalizeExponentialFailureDistribution(distribution) {
  if (!isExponentialDistribution(distribution)) return distribution;
  const rate = exponentialFailureRate(distribution);
  const parameters = cleanText(distribution.parameters || distribution.params);
  const hasEncodedRate = Object.hasOwn(distribution, "rate")
    || EXPONENTIAL_RATE_KEYS.slice(1).some((key) => Object.hasOwn(distribution, key))
    || EXPONENTIAL_RATE_PARAMETER_PATTERN.test(parameters);
  if (rate !== null) distribution.rate = rate;
  delete distribution.lambda;
  delete distribution["λ"];
  delete distribution.failure_rate;
  if (hasEncodedRate || !EXPONENTIAL_MEAN_PARAMETER_PATTERN.test(parameters)) {
    delete distribution.parameters;
    delete distribution.params;
  }
  return distribution;
}

function exponentialFailureRate(distribution) {
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return null;
  for (const key of EXPONENTIAL_RATE_KEYS) {
    if (!Object.hasOwn(distribution, key)) continue;
    const rate = Number(distribution[key]);
    if (Number.isFinite(rate)) return rate;
  }
  const parameters = cleanText(distribution.parameters || distribution.params);
  const rate = Number(parameters.match(EXPONENTIAL_RATE_PARAMETER_PATTERN)?.[1]);
  return Number.isFinite(rate) ? rate : null;
}

function deleteExponentialFailureRateAliases(distribution) {
  delete distribution.parameters;
  delete distribution.params;
  delete distribution.lambda;
  delete distribution["λ"];
  delete distribution.failure_rate;
}

function isExponentialDistribution(distribution) {
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return false;
  const type = cleanText(distribution.distributionType || distribution.distribution_type).toLocaleLowerCase();
  return type.includes("exponential") || type.includes("指数");
}

function isFixedDistribution(distribution) {
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return false;
  const type = cleanText(distribution.distributionType || distribution.distribution_type).toLocaleLowerCase();
  return type.includes("fixed") || type.includes("固定");
}

export function componentsSharingProduct(project, productId) {
  const exactId = exactProductId(productId);
  return (Array.isArray(project?.components) ? project.components : [])
    .filter((component) => exactProductId(component?.productId) === exactId);
}

export function ensureProductForComponent(project, component) {
  normalizeProjectProducts(project);
  if (!component || typeof component !== "object") return null;
  const product = project.products.find((item) => item.id === component.productId);
  if (product) return product;
  const productId = uniqueProductId(new Map(project.products.map((item) => [item.id, item])), `product-${component.id || "component"}`);
  component.productId = productId;
  const created = productFromComponent(component, productId);
  project.products.push(created);
  return created;
}

export function createProjectProduct(project, draft = {}) {
  normalizeProjectProducts(project);
  const byId = new Map(project.products.map((item) => [item.id, item]));
  const id = uniqueProductId(byId, cleanText(draft.id) || `product-${slug(cleanText(draft.name) || "new")}`);
  const product = {
    id,
    name: cleanText(draft.name) || "新产品",
    model: cleanText(draft.model),
    kind: cleanText(draft.kind || draft.productType) || "LRU"
  };
  project.products.push(product);
  return product;
}

export function searchProjectProducts(project, query = "") {
  const normalizedQuery = cleanText(query).toLocaleLowerCase();
  const products = Array.isArray(project?.products) ? project.products : [];
  if (!normalizedQuery) return [...products];
  return products.filter((product) => [product?.id, product?.name, product?.model]
    .some((value) => cleanText(value).toLocaleLowerCase().includes(normalizedQuery)));
}

export function findProjectProductConflicts(project, draft = {}) {
  const name = cleanText(draft.name).toLocaleLowerCase();
  const model = cleanText(draft.model).toLocaleLowerCase();
  const products = Array.isArray(project?.products) ? project.products : [];
  return {
    nameMatches: name
      ? products.filter((product) => cleanText(product?.name).toLocaleLowerCase() === name)
      : [],
    modelMatches: model
      ? products.filter((product) => cleanText(product?.model).toLocaleLowerCase() === model)
      : []
  };
}

export function projectProductById(project, productId) {
  normalizeProjectProducts(project);
  return project.products.find((item) => item.id === productId) || null;
}

export function productDisplayName(product) {
  if (!product) return "未关联产品";
  return [cleanText(product.name) || product.id, cleanText(product.model)].filter(Boolean).join(" / ");
}

function productFromComponent(component, id) {
  const product = {
    id,
    name: cleanText(component.name) || id,
    model: cleanText(component.model) || cleanText(component.id),
    kind: cleanText(component.productType) || "非LRU"
  };
  for (const field of SHARED_PRODUCT_PARAMETER_FIELDS) {
    if (Object.hasOwn(component, field)) product[field] = cloneValue(component[field]);
  }
  return product;
}

function copySharedProductParameters(product, component) {
  for (const field of SHARED_PRODUCT_PARAMETER_FIELDS) {
    if (Object.hasOwn(product, field)) component[field] = cloneValue(product[field]);
    else delete component[field];
  }
}

function setNestedValue(target, path, value) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[path.at(-1)] = value;
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function productIdentityIndex(products) {
  const index = new Map();
  for (const product of products) {
    const exact = productIdentity(product.name, product.model);
    const nameOnly = productIdentity(product.name, "");
    if (exact && !index.has(exact)) index.set(exact, product.id);
    if (nameOnly && !index.has(nameOnly)) index.set(nameOnly, product.id);
  }
  return index;
}

function productIdentity(name, model) {
  return `${cleanText(name).toLocaleLowerCase()}|${cleanText(model).toLocaleLowerCase()}`;
}

function isSpareResource(resource) {
  const type = cleanText(resource.type).toLocaleLowerCase();
  return type === "spare" || type === "备件";
}

function uniqueProductId(byId, candidate) {
  const base = slug(candidate) || "product";
  let id = base;
  let suffix = 2;
  while (byId.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function slug(value) {
  return cleanText(value)
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function exactProductId(value) {
  return String(value ?? "");
}
