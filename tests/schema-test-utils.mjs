export function validateSchema(schema, value, path = "$") {
  const errors = [];
  collectSchemaErrors(schema, value, path, errors);
  return errors;
}

function collectSchemaErrors(schema, value, path, errors) {
  if (schema.oneOf) {
    const branchResults = schema.oneOf.map((branch) => validateSchema(branch, value, path));
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
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} expected maximum ${schema.maximum}, got ${value}`);
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
        collectSchemaErrors(properties[key], childValue, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => collectSchemaErrors(schema.items, item, `${path}[${index}]`, errors));
  }
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
