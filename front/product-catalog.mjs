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
  return project;
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

export function projectProductById(project, productId) {
  normalizeProjectProducts(project);
  return project.products.find((item) => item.id === productId) || null;
}

export function productDisplayName(product) {
  if (!product) return "未关联产品";
  return [cleanText(product.name) || product.id, cleanText(product.model)].filter(Boolean).join(" / ");
}

function productFromComponent(component, id) {
  return {
    id,
    name: cleanText(component.name) || id,
    model: cleanText(component.model) || cleanText(component.id),
    kind: cleanText(component.productType) || "非LRU"
  };
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
