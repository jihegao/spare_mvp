import assert from "node:assert/strict";
import test from "node:test";

import {
  EQUIPMENT_STRUCTURE_HEADERS,
  equipmentStructureExportCsv,
  equipmentStructureProductId,
  equipmentStructureTemplateCsv,
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
