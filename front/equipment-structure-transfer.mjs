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

export function equipmentStructureProductId(row) {
  return pickText(row, PRODUCT_ID_KEYS);
}

export function validateEquipmentStructureProductReferences(rows, products, { firstRowNumber = 2 } = {}) {
  const productIds = new Set(
    (Array.isArray(products) ? products : [])
      .map((product) => String(product?.id || "").trim())
      .filter(Boolean)
  );
  const invalid = [];
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const productId = equipmentStructureProductId(row);
    if (productId && !productIds.has(productId)) {
      invalid.push({ rowNumber: firstRowNumber + index, productId });
    }
  }
  if (invalid.length) {
    const locations = invalid.map(({ rowNumber, productId }) => `第${rowNumber}行产品ID“${productId}”`).join("、");
    throw new Error(`产品ID引用无效：${locations}在当前 Project 的产品目录中不存在`);
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

  const components = (Array.isArray(project?.components) ? project.components : [])
    .filter((component) => !component?.aircraftModel || String(component.aircraftModel) === selectedModel)
    .filter((component) => String(component?.id || "") !== "aircraft-root");
  const rows = [
    templateRow({
      "节点ID": "aircraft-root",
      "系统名称": selectedModel,
      "型号": selectedModel,
      "层级": "整机",
      "安装数": positiveInteger(equipment.quantity, 1)
    }),
    ...components.map((component) => templateRow({
      "节点ID": component.id,
      "父节点ID": component.parentId || "aircraft-root",
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
