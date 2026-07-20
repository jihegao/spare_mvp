import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedSupportActivityDurationDistributions,
  assertBasicSupportActivityCsvFileSize,
  BASIC_SUPPORT_ACTIVITY_CSV_HEADERS,
  BasicSupportActivityCsvError,
  basicSupportActivityCsvTemplate,
  MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES,
  parseBasicSupportActivityCsv,
  supportActivityJobFromBasicActivity,
} from "../front/support-activity-jobs.mjs";

test("support activity duration distributions are limited to the four shared equipment distributions", () => {
  assert.deepEqual(allowedSupportActivityDurationDistributions(), [
    "固定值",
    "指数分布",
    "正态分布",
    "均匀分布"
  ]);
});

test("support activity jobs can be populated from a basic activity library row", () => {
  const basicActivity = {
    activityCode: "BA-220",
    workName: "航电通电检查",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
    durationMinutes: 25,
    personnel: [{ professional: "航电", quantity: 2 }],
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 1 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 1 }],
    predecessors: ["BA-100"]
  };

  assert.deepEqual(supportActivityJobFromBasicActivity(basicActivity), {
    activityCode: "BA-220",
    workName: "航电通电检查",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
    durationMinutes: 25,
    personnel: [{ professional: "航电", quantity: 2 }],
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 1 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 1 }],
    predecessors: ["BA-100"]
  });
});

test("support activity jobs preserve structured resource requirements from basic activity rows", () => {
  const basicActivity = {
    activityCode: "BA-330",
    workName: "资源配置活动",
    personnelProfessional: "航电",
    personnel: [
      { professional: "航电", quantity: 1 },
      { professional: "机务人员", quantity: 2 }
    ],
    equipmentModel: "TEST-1",
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 2 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 3 }]
  };

  const job = supportActivityJobFromBasicActivity(basicActivity);

  assert.equal(job.personnelProfessional, "航电");
  assert.equal(Object.hasOwn(job, "personnelRequirements"), false);
  assert.equal(job.equipmentModel, "TEST-1");
  assert.equal(Object.hasOwn(job, "equipmentRequirements"), false);
  assert.equal(Object.hasOwn(job, "spareRequirements"), false);
  assert.deepEqual(job.personnel, [
    { professional: "航电", quantity: 1 },
    { professional: "机务人员", quantity: 2 }
  ]);
  assert.deepEqual(job.equipment, [{ model: "TEST-1", name: "检测仪", quantity: 2 }]);
  assert.deepEqual(job.spare, [{ model: "LRU", name: "航电模块", quantity: 3 }]);
});

test("basic support activity CSV template is BOM-prefixed and mixes row-level activity types", () => {
  const csv = basicSupportActivityCsvTemplate();

  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.deepEqual(csv.replace(/^\uFEFF/, "").split("\n")[0].split(","), BASIC_SUPPORT_ACTIVITY_CSV_HEADERS);
  assert.equal(BASIC_SUPPORT_ACTIVITY_CSV_HEADERS.includes("维修方式"), false);
  assert.equal(BASIC_SUPPORT_ACTIVITY_CSV_HEADERS.includes("换件比例"), false);
  assert.match(csv, /使用保障活动,BA-101/);
  assert.match(csv, /预防性维修,PM-201/);
  assert.match(csv, /修复性维修,CM-301/);
});

test("basic support activity CSV parses BOM, CRLF, quoted commas and quoted newlines", () => {
  const csv = `\uFEFF${BASIC_SUPPORT_ACTIVITY_CSV_HEADERS.join(",")}\r\n`
    + '使用保障活动,BA-101,"飞行前,检查",J-15,固定值,30,,,,,\r\n'
    + '使用保障,BA-102,"通电\r\n检查",J-15,指数分布,,15,,,,BA-101\r\n';

  const rows = parseBasicSupportActivityCsv(csv, {
    filename: "basic-activities.csv",
    aircraftModels: ["J-15"]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].workName, "飞行前,检查");
  assert.equal(rows[1].workName, "通电\r\n检查");
  assert.equal(rows[1].type, "使用保障活动");
  assert.equal(rows[1].sourceLine, 3);
  assert.deepEqual(rows[1].durationProfile, { distributionType: "指数分布", mean: 15 });
  assert.deepEqual(rows[1].predecessors, ["BA-101"]);
});

test("basic support activity CSV accepts documented English header aliases", () => {
  const rows = parseBasicSupportActivityCsv([
    "activityType,activityCode,workName,applicableAircraft,distributionType,durationMinutes,predecessors",
    "预防性维修,PM-001,定检准备,J-15,固定值,40,"
  ].join("\n"), {
    filename: "aliases.csv",
    aircraftModels: ["J-15"]
  });

  assert.deepEqual(rows[0], {
    type: "预防性维修",
    activityCode: "PM-001",
    workName: "定检准备",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "固定值", value: 40 },
    durationMinutes: 40,
    predecessors: [],
    sourceLine: 2
  });
});

test("basic support activity CSV aggregates header, required-field and duration errors with exact locations", () => {
  assert.throws(
    () => parseBasicSupportActivityCsv("", { filename: "empty.csv" }),
    (error) => error instanceof BasicSupportActivityCsvError && /第1行 \[文件\] 文件为空/.test(error.message)
  );
  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,activityType,基本保障活动编号,基本保障活动名称,未知列",
      "使用保障活动,使用保障活动,BA-001,检查,值"
    ].join("\n"), { filename: "bad-header.csv" }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && /第1行 \[activityType\] 与“活动类型”重复/.test(error.message)
      && /第1行 \[未知列\] 不支持的表头/.test(error.message)
      && /第1行 \[作业时长分布\] 缺少必填表头/.test(error.message)
    )
  );
  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,均值(min),标准差(min)",
      "修复性维修,CM-001,,正态分布,0,"
    ].join("\n"), { filename: "bad-row.csv" }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && /第2行 \[基本保障活动名称\] 必填/.test(error.message)
      && /第2行 \[均值\(min\)\] 必须为大于 0 的有限数/.test(error.message)
      && /第2行 \[标准差\(min\)\] 当前作业时长分布要求填写此字段/.test(error.message)
    )
  );
});

test("basic support activity CSV rejects invalid aircraft, duplicate codes and cross-type or ambiguous references", () => {
  const csv = [
    "活动类型,基本保障活动编号,基本保障活动名称,适用飞机,作业时长分布,固定工期(min),紧前作业",
    "使用保障活动,BA-001,重复编号,J-99,固定值,30,PM-OLD",
    "预防性维修,PM-001,歧义引用,J-15,固定值,20,DUP-001"
  ].join("\n");

  assert.throws(
    () => parseBasicSupportActivityCsv(csv, {
      filename: "invalid-references.csv",
      aircraftModels: ["J-15"],
      existingActivityCodes: ["BA-001", "PM-OLD", "DUP-001"],
      existingActivities: [
        { activityCode: "PM-OLD", type: "预防性维修", allowedAsPredecessor: true },
        { activityCode: "DUP-001", type: "预防性维修", allowedAsPredecessor: true },
        { activityCode: "DUP-001", type: "预防性维修", allowedAsPredecessor: true }
      ]
    }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && /第2行 \[适用飞机\] “J-99”不在当前 Project 整机型号中/.test(error.message)
      && /第2行 \[基本保障活动编号\] “BA-001”已存在于当前 Project/.test(error.message)
      && /第2行 \[紧前作业\] “PM-OLD”属于预防性维修类型，不能跨类型引用/.test(error.message)
      && /第3行 \[紧前作业\] “DUP-001”在当前 Project 中存在歧义/.test(error.message)
    )
  );
});

test("basic support activity CSV allows a unique predecessor in the current target activity and rejects cycles", () => {
  const allowed = parseBasicSupportActivityCsv([
    "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min),紧前作业",
    "使用保障活动,BA-002,通电检查,固定值,15,BA-001"
  ].join("\n"), {
    filename: "existing-predecessor.csv",
    existingActivityCodes: ["BA-001"],
    existingActivities: [{ activityCode: "BA-001", type: "使用保障活动", allowedAsPredecessor: true }]
  });
  assert.deepEqual(allowed[0].predecessors, ["BA-001"]);

  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min),紧前作业",
      "使用保障活动,BA-010,作业A,固定值,10,BA-011",
      "使用保障活动,BA-011,作业B,固定值,10,BA-010"
    ].join("\n"), { filename: "cycle.csv" }),
    (error) => error instanceof BasicSupportActivityCsvError && /存在循环引用/.test(error.message)
  );
});

test("basic support activity CSV rejects spreadsheet formula prefixes as plain imported data", () => {
  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min)",
      "使用保障活动,BA-900,=HYPERLINK(恶意链接),固定值,30"
    ].join("\n"), { filename: "formula.csv" }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && /第2行 \[基本保障活动名称\] 不允许以 =、\+、- 或 @ 开头/.test(error.message)
    )
  );
});

test("basic support activity CSV enforces the 1 MiB limit as UTF-8 bytes", () => {
  assert.doesNotThrow(() => assertBasicSupportActivityCsvFileSize({ size: MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES }));
  assert.throws(
    () => assertBasicSupportActivityCsvFileSize({ size: MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES + 1 }),
    (error) => error instanceof BasicSupportActivityCsvError && /文件大小不能超过 1 MiB/.test(error.message)
  );

  const validPrefix = [
    "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min)",
    "使用保障活动,BA-001,检查,固定值,30"
  ].join("\n");
  const multibyteOversize = `${validPrefix}\n${"中".repeat(Math.ceil(MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES / 3))}`;
  assert.ok(multibyteOversize.length < MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES);
  assert.ok(new TextEncoder().encode(multibyteOversize).byteLength > MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES);
  assert.throws(
    () => parseBasicSupportActivityCsv(multibyteOversize, { filename: "multibyte.csv" }),
    (error) => error instanceof BasicSupportActivityCsvError && /文件大小不能超过 1 MiB/.test(error.message)
  );
});

test("basic support activity CSV rejects bare quotes and malformed predecessor codes", () => {
  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min)",
      '使用保障活动,BA-001,飞行前"检查,固定值,30'
    ].join("\n"), { filename: "bare-quote.csv" }),
    (error) => error instanceof BasicSupportActivityCsvError && /未加引号字段中存在裸双引号/.test(error.message)
  );

  const tooLong = "P".repeat(300);
  assert.throws(
    () => parseBasicSupportActivityCsv([
      "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min),紧前作业",
      `使用保障活动,BA-002,通电检查,固定值,15,bad code；${tooLong}`
    ].join("\n"), { filename: "bad-predecessors.csv" }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && /“bad code”只能使用 1-64 位/.test(error.message)
      && error.message.includes(tooLong.slice(0, 80))
      && !error.message.includes(tooLong)
      && error.message.includes("…")
    )
  );
});

test("basic support activity CSV truncates aggregated display errors without dropping issue details", () => {
  const csv = [
    "活动类型,基本保障活动编号,基本保障活动名称,作业时长分布,固定工期(min)",
    ...Array.from({ length: 25 }, (_, index) => `使用保障活动,BA-${String(index + 1).padStart(3, "0")},,固定值,30`)
  ].join("\n");

  assert.throws(
    () => parseBasicSupportActivityCsv(csv, { filename: "many-errors.csv" }),
    (error) => (
      error instanceof BasicSupportActivityCsvError
      && error.issues.length === 25
      && /第21行 \[基本保障活动名称\] 必填/.test(error.message)
      && !/第22行 \[基本保障活动名称\] 必填/.test(error.message)
      && /另有 5 项错误未显示/.test(error.message)
    )
  );
});
