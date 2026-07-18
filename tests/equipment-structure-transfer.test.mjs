import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  EQUIPMENT_STRUCTURE_HEADERS,
  equipmentStructureExportCsv,
  equipmentStructureProductId,
  equipmentStructureTemplateCsv,
  parseEquipmentStructureImportText,
  validateEquipmentStructureProductReferences
} from "../front/equipment-structure-transfer.mjs";

test("equipment structure template keeps product ID distinct from node and parent IDs", () => {
  const csv = equipmentStructureTemplateCsv();

  assert.equal(csv.startsWith("\uFEFF"), true, "template should keep the UTF-8 BOM used by Excel-compatible CSV files");
  assert.equal(
    csv.replace(/^\uFEFF/, "").split("\n")[0],
    EQUIPMENT_STRUCTURE_HEADERS.join(",")
  );
  assert.match(csv, /aircraft-root,,,示例整机,MODEL-A,整机/);
  assert.match(csv, /system-1,aircraft-root,,动力系统,SYS-001,系统/);
});

test("equipment structure export preserves shared product IDs and Chinese CSV values", () => {
  const csv = equipmentStructureExportCsv({
    equipment: { model: "J-15", wholeMachineModels: ["J-15"], quantity: 2 },
    components: [
      {
        id: "engine-1",
        parentId: "aircraft-root",
        aircraftModel: "J-15",
        productId: "product-发动机",
        name: "发动机,左侧",
        model: "WS-10",
        level: "系统",
        quantity: 2,
        runningRatio: 0.8,
        mtbfHours: 1200,
        meanRepairTimeMinutes: 90,
        repairDistribution: { distributionType: "正态分布" }
      },
      {
        id: "engine-2",
        parentId: "aircraft-root",
        aircraftModel: "J-15",
        productId: "product-发动机",
        name: "发动机右侧",
        model: "WS-10",
        quantity: 1
      }
    ]
  }, { aircraftModel: "J-15" });

  assert.equal((csv.match(/product-发动机/g) || []).length, 2);
  assert.match(csv, /"发动机,左侧"/);
  assert.match(csv, /engine-1,aircraft-root,product-发动机/);
  assert.match(csv, /,0\.8,1200,90,正态分布/);
});

test("equipment structure product validation accepts blank and shared exact IDs", () => {
  const rows = [
    { 节点ID: "a", 产品ID: "product-shared" },
    { 节点ID: "b", product_id: "product-shared" },
    { 节点ID: "c", productId: "" }
  ];

  assert.equal(equipmentStructureProductId(rows[0]), "product-shared");
  assert.equal(validateEquipmentStructureProductReferences(rows, [{ id: "product-shared" }]), true);
});

test("equipment structure product validation rejects every unknown exact ID with source rows", () => {
  const rows = [
    { 节点ID: "a", 产品ID: "product-known" },
    { 节点ID: "b", 产品ID: "PRODUCT-KNOWN" },
    { 节点ID: "c", productId: "product-missing" }
  ];

  assert.throws(
    () => validateEquipmentStructureProductReferences(rows, [{ id: "product-known" }]),
    /第3行产品ID“PRODUCT-KNOWN”.*第4行产品ID“product-missing”.*当前 Project/
  );
});

test("real fixture export preserves the shared root product and isolates the selected aircraft model", () => {
  const project = JSON.parse(fs.readFileSync(
    new URL("./fixtures/clean_projects/full_platform_case_clean_project.json", import.meta.url),
    "utf8"
  ));

  const csv = equipmentStructureExportCsv(project, { aircraftModel: "J-15" });
  const rows = parseEquipmentStructureImportText(csv, "J-15.csv");

  assert.equal(rows[0]["节点ID"], "aircraft-root");
  assert.equal(rows[0]["产品ID"], "product-aircraft-root");
  assert.ok(rows.some((row) => row["节点ID"] === "j15-engine"));
  assert.equal(rows.some((row) => row["节点ID"] === "j35-engine"), false);
});

test("CSV parser round-trips BOM, commas, quotes, LF and CRLF inside quoted fields", () => {
  const csv = equipmentStructureExportCsv({
    equipment: { wholeMachineModels: ["MODEL-A"], quantity: 1 },
    products: [{ id: "product-root" }, { id: "product-system" }],
    components: [
      { id: "aircraft-root", productId: "product-root", name: "整机", quantity: 1 },
      {
        id: "system-1",
        parentId: "aircraft-root",
        aircraftModel: "MODEL-A",
        productId: "product-system",
        name: "动力,\n系统\"左\"",
        model: "SYS\r\n001",
        quantity: 1
      }
    ]
  }, { aircraftModel: "MODEL-A" });

  const rows = parseEquipmentStructureImportText(csv, "round-trip.csv");

  assert.equal(rows.length, 2);
  assert.equal(rows[1]["系统名称"], "动力,\n系统\"左\"");
  assert.equal(rows[1]["型号"], "SYS\r\n001");
  assert.equal(validateEquipmentStructureProductReferences(rows, [
    { id: "product-root" },
    { id: "product-system" }
  ]), true);
});

test("TSV parser handles quoted tabs and multiline fields and reports their physical start line", () => {
  const tsv = [
    "\uFEFF节点ID\t父节点ID\t产品ID\t系统名称\t型号\t层级",
    "aircraft-root\t\t\tMODEL-A\tMODEL-A\t整机",
    "system-1\taircraft-root\tproduct-missing\t\"航电\t系统\r\n第二行\"\tAV-1\t系统"
  ].join("\r\n");

  const rows = parseEquipmentStructureImportText(tsv, "equipment.tsv");

  assert.equal(rows.length, 2);
  assert.equal(rows[1]["系统名称"], "航电\t系统\r\n第二行");
  assert.throws(
    () => validateEquipmentStructureProductReferences(rows, []),
    /第3行产品ID“product-missing”/
  );
});

test("JSON product aliases use one-based array item locations instead of CSV line numbers", () => {
  const rows = parseEquipmentStructureImportText(JSON.stringify([
    { id: "system-1", product_id: "product-missing" }
  ]), "equipment.json");

  assert.throws(
    () => validateEquipmentStructureProductReferences(rows, []),
    /第1项产品ID“product-missing”/
  );
});
