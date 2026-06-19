export function validateSchema(schema, value, path = "$") {
  const errors = [];
  collectSchemaErrors(schema, value, path, errors, schema);
  return errors;
}

function collectSchemaErrors(schema, value, path, errors, rootSchema) {
  if (schema.$ref) {
    const resolved = resolveLocalRef(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`${path} unresolved ref ${schema.$ref}`);
      return;
    }
    collectSchemaErrors(resolved, value, path, errors, rootSchema);
    return;
  }

  if (schema.oneOf) {
    const branchResults = schema.oneOf.map((branch) => {
      const branchErrors = [];
      collectSchemaErrors(branch, value, path, branchErrors, rootSchema);
      return branchErrors;
    });
    if (!branchResults.some((branchErrors) => branchErrors.length === 0)) {
      errors.push(`${path} did not match oneOf: ${branchResults.map((branchErrors) => branchErrors.join("; ")).join(" | ")}`);
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} expected one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}`);
  }

  if (schema.type && !matchesJsonType(schema.type, value)) {
    errors.push(`${path} expected type ${JSON.stringify(schema.type)}, got ${Array.isArray(value) ? "array" : typeof value}`);
    return;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} expected minimum ${schema.minimum}, got ${value}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path} expected exclusiveMinimum ${schema.exclusiveMinimum}, got ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} expected maximum ${schema.maximum}, got ${value}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(`${path} expected exclusiveMaximum ${schema.exclusiveMaximum}, got ${value}`);
    }
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    const properties = schema.properties || {};
    for (const [key, childValue] of Object.entries(value)) {
      if (properties[key]) {
        collectSchemaErrors(properties[key], childValue, `${path}.${key}`, errors, rootSchema);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => collectSchemaErrors(schema.items, item, `${path}[${index}]`, errors, rootSchema));
  }
}

function resolveLocalRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .reduce((current, segment) => current?.[segment], rootSchema);
}

function matchesJsonType(type, value) {
  if (Array.isArray(type)) {
    return type.some((item) => matchesJsonType(item, value));
  }
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type && !Array.isArray(value);
}
