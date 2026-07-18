export const EQUIPMENT_STRUCTURE_HEADERS = Object.freeze([
  "节点ID",
  "父节点ID",
  "产品ID",
  "系统名称",
  "型号",
  "层级",
  "安装数",
  "运行比",
  "MTBF",
  "MTTR",
  "维修分布类型"
]);

const PRODUCT_ID_KEYS = Object.freeze(["productId", "product_id", "产品ID", "产品Id", "产品id"]);
const NODE_ID_KEYS = Object.freeze(["id", "componentId", "component_id", "组件ID", "节点ID", "object_id"]);
const SOURCE_LOCATIONS = new WeakMap();
const JSON_OBJECT_ROWS = new WeakSet();

export function parseEquipmentStructureImportText(text, filename = "") {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const trimmed = source.trim();
  if (!trimmed) throw new Error("文件为空");
  const looksLikeJson = filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksLikeJson) {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      SOURCE_LOCATIONS.set(parsed, "第1项（JSON 对象）");
    }
    markJsonArrayLocations(parsed);
    return parsed;
  }
  return parseDelimitedTable(source);
}

export function equipmentStructureProductId(row) {
  return pickText(row, PRODUCT_ID_KEYS);
}

export function equipmentStructureNodeId(row) {
  return pickText(row, NODE_ID_KEYS);
}

export function equipmentStructureImportRowIsExplicitJson(row) {
  return Boolean(row && typeof row === "object" && JSON_OBJECT_ROWS.has(row));
}

export function validateEquipmentStructureProductReferences(rows, products, { firstRowNumber = 2 } = {}) {
  const productIds = new Set(
    (Array.isArray(products) ? products : [])
      .map((product) => String(product?.id || "").trim())
      .filter(Boolean)
  );
  const invalid = [];
  const conflicts = [];
  const productReferenceByNodeId = new Map();
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const productId = equipmentStructureProductId(row);
    const nodeId = equipmentStructureNodeId(row);
    const location = SOURCE_LOCATIONS.get(row) || `第${firstRowNumber + index}行`;
    if (productId && !productIds.has(productId)) {
      invalid.push({
        location,
        productId
      });
    }
    if (nodeId && productId) {
      const existing = productReferenceByNodeId.get(nodeId);
      if (existing && existing.productId !== productId) {
        conflicts.push({ nodeId, existing, location, productId });
      } else if (!existing) {
        productReferenceByNodeId.set(nodeId, { location, productId });
      }
    }
  }
  if (invalid.length) {
    const locations = invalid.map(({ location, productId }) => `${location}产品ID“${productId}”`).join("、");
    throw new Error(`产品ID引用无效：${locations}在当前 Project 的产品目录中不存在`);
  }
  if (conflicts.length) {
    const locations = conflicts.map(({ nodeId, existing, location, productId }) => (
      `节点ID“${nodeId}”在${existing.location}引用“${existing.productId}”、${location}引用“${productId}”`
    )).join("；");
    throw new Error(`产品ID引用冲突：${locations}`);
  }
  return true;
}

export function equipmentStructureTemplateCsv() {
  return rowsToCsv([
    templateRow({ "节点ID": "aircraft-root", "系统名称": "示例整机", "型号": "MODEL-A", "层级": "整机" }),
    templateRow({
      "节点ID": "system-1",
      "父节点ID": "aircraft-root",
      "系统名称": "动力系统",
      "型号": "SYS-001",
      "层级": "系统",
      "安装数": 2,
      MTBF: 1200,
      MTTR: 2,
      "维修分布类型": "正态分布"
    })
  ]);
}

export function equipmentStructureExportCsv(project, { aircraftModel = "" } = {}) {
  const equipment = project?.equipment || {};
  const selectedModel = String(
    aircraftModel
      || (Array.isArray(equipment.wholeMachineModels) ? equipment.wholeMachineModels[0] : "")
      || equipment.model
      || ""
  ).trim();
  if (!selectedModel) throw new Error("当前 Project 没有可导出的整机型号");

  const projectComponents = Array.isArray(project?.components) ? project.components : [];
  const rootComponent = projectComponents.find((component) => String(component?.id || "") === "aircraft-root");
  const components = projectComponents
    .filter((component) => !component?.aircraftModel || String(component.aircraftModel) === selectedModel)
    .filter((component) => String(component?.id || "") !== "aircraft-root");
  const rows = [
    templateRow({
      "节点ID": "aircraft-root",
      "产品ID": rootComponent?.productId,
      "系统名称": selectedModel,
      "型号": selectedModel,
      "层级": "整机",
      "安装数": positiveInteger(equipment.quantity, 1)
    }),
    ...components.map((component) => templateRow({
      "节点ID": component.id,
      "父节点ID": component.parentId || (componentIsWholeMachine(component) ? "" : "aircraft-root"),
      "产品ID": component.productId,
      "系统名称": component.name,
      "型号": component.model,
      "层级": component.level || component.productType || "系统",
      "安装数": positiveInteger(component.quantity, 1),
      "运行比": finiteNumber(component.runningRatio ?? component.missionUse?.runningRatio, 1),
      MTBF: finiteNumber(component.mtbfHours, ""),
      MTTR: finiteNumber(component.meanRepairTimeMinutes, ""),
      "维修分布类型": component.repairDistribution?.distributionType || ""
    }))
  ];
  return rowsToCsv(rows);
}

function templateRow(values = {}) {
  return Object.fromEntries(EQUIPMENT_STRUCTURE_HEADERS.map((header) => {
    const fallback = header === "安装数" || header === "运行比" ? 1 : "";
    return [header, values[header] ?? fallback];
  }));
}

function rowsToCsv(rows) {
  const lines = [
    EQUIPMENT_STRUCTURE_HEADERS.map(csvCell).join(","),
    ...rows.map((row) => EQUIPMENT_STRUCTURE_HEADERS.map((header) => csvCell(row?.[header])).join(","))
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

function parseDelimitedTable(text) {
  const delimiter = detectDelimiter(text);
  const records = parseDelimitedRecords(text, delimiter)
    .filter(({ values }) => values.some((value) => String(value).trim()));
  if (records.length < 2) throw new Error("CSV/TSV 表格至少需要表头和一行数据");
  const headers = records[0].values.map((header) => String(header).trim());
  return records.slice(1).map(({ values, startLine }) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    SOURCE_LOCATIONS.set(row, `第${startLine}行`);
    return row;
  });
}

function detectDelimiter(text) {
  let quoted = false;
  let commas = 0;
  let tabs = 0;
  let recordText = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"' && quoted && nextChar === '"') {
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (recordText.trim()) break;
      commas = 0;
      tabs = 0;
      recordText = "";
      if (char === "\r" && nextChar === "\n") index += 1;
    } else if (!quoted && char === ",") {
      commas += 1;
      recordText += char;
    } else if (!quoted && char === "\t") {
      tabs += 1;
      recordText += char;
    } else {
      recordText += char;
    }
  }
  return tabs > commas ? "\t" : ",";
}

function parseDelimitedRecords(text, delimiter) {
  const records = [];
  let values = [];
  let current = "";
  let quoted = false;
  let lineNumber = 1;
  let recordStartLine = 1;
  const finishRecord = () => {
    values.push(current);
    records.push({ values, startLine: recordStartLine });
    values = [];
    current = "";
    recordStartLine = lineNumber + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"' && quoted && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && nextChar === "\n") index += 1;
      finishRecord();
      lineNumber += 1;
    } else {
      current += char;
      if (char === "\r") {
        if (nextChar === "\n") {
          current += nextChar;
          index += 1;
        }
        lineNumber += 1;
      } else if (char === "\n") {
        lineNumber += 1;
      }
    }
  }
  if (quoted) throw new Error(`CSV/TSV 第${recordStartLine}行存在未闭合的引号字段`);
  if (current || values.length) finishRecord();
  return records;
}

function markJsonArrayLocations(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item && typeof item === "object") SOURCE_LOCATIONS.set(item, `第${index + 1}项`);
      markJsonArrayLocations(item, seen);
    });
    return;
  }
  JSON_OBJECT_ROWS.add(value);
  Object.values(value).forEach((item) => markJsonArrayLocations(item, seen));
}

function componentIsWholeMachine(component) {
  const productType = String(component?.productType ?? component?.level ?? component?.type ?? "").trim();
  return /整机|whole|aircraft/i.test(productType);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function pickText(row, keys) {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const lowerValues = new Map(Object.entries(source).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = Object.prototype.hasOwnProperty.call(source, key)
      ? source[key]
      : lowerValues.get(String(key).trim().toLowerCase());
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
