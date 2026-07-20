const ALLOWED_DURATION_DISTRIBUTIONS = Object.freeze([
  "固定值",
  "指数分布",
  "正态分布",
  "均匀分布"
]);

export const MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES = 1024 * 1024;
const MAX_BASIC_SUPPORT_ACTIVITY_CSV_ERROR_DETAILS = 20;
const MAX_BASIC_SUPPORT_ACTIVITY_CSV_ERROR_DETAIL_CHARS = 240;

export const BASIC_SUPPORT_ACTIVITY_CSV_HEADERS = Object.freeze([
  "活动类型",
  "基本保障活动编号",
  "基本保障活动名称",
  "适用飞机",
  "作业时长分布",
  "固定工期(min)",
  "均值(min)",
  "标准差(min)",
  "最小值(min)",
  "最大值(min)",
  "紧前作业"
]);

const BASIC_ACTIVITY_HEADER_ALIASES = Object.freeze({
  "活动类型": ["活动类型", "保障类型", "activityType", "type"],
  "基本保障活动编号": ["基本保障活动编号", "活动编号", "activityCode", "code"],
  "基本保障活动名称": ["基本保障活动名称", "工作项目名称", "workName", "name"],
  "适用飞机": ["适用飞机", "适用对象", "适用机型", "applicableAircraft", "aircraftModel"],
  "作业时长分布": ["作业时长分布", "工期分布", "durationDistribution", "distributionType"],
  "固定工期(min)": ["固定工期(min)", "工期分钟", "工期(min)", "durationMinutes", "value"],
  "均值(min)": ["均值(min)", "均值分钟", "mean"],
  "标准差(min)": ["标准差(min)", "标准差分钟", "stdDev"],
  "最小值(min)": ["最小值(min)", "最小值分钟", "min"],
  "最大值(min)": ["最大值(min)", "最大值分钟", "max"],
  "紧前作业": ["紧前作业", "紧前作业编号", "predecessors"]
});

const REQUIRED_BASIC_ACTIVITY_HEADERS = Object.freeze([
  "活动类型",
  "基本保障活动编号",
  "基本保障活动名称",
  "作业时长分布"
]);

const BASIC_ACTIVITY_TYPE_ALIASES = Object.freeze(new Map([
  ["使用保障", "使用保障活动"],
  ["使用保障活动", "使用保障活动"],
  ["预防性维修", "预防性维修"],
  ["预防性维修活动", "预防性维修"],
  ["修复性维修", "修复性维修"],
  ["修复性维修活动", "修复性维修"]
]));

const BASIC_ACTIVITY_HEADER_LOOKUP = new Map(
  Object.entries(BASIC_ACTIVITY_HEADER_ALIASES).flatMap(([canonical, aliases]) => (
    aliases.map((alias) => [normalizeHeaderName(alias), canonical])
  ))
);

export class BasicSupportActivityCsvError extends Error {
  constructor(issues) {
    const normalizedIssues = Array.isArray(issues) ? issues : [];
    const displayedIssues = normalizedIssues.slice(0, MAX_BASIC_SUPPORT_ACTIVITY_CSV_ERROR_DETAILS);
    const omittedCount = normalizedIssues.length - displayedIssues.length;
    super(`CSV 导入校验失败：${displayedIssues.map(formatBasicSupportActivityCsvIssue).join("；")}${omittedCount > 0 ? `；另有 ${omittedCount} 项错误未显示` : ""}`);
    this.name = "BasicSupportActivityCsvError";
    this.issues = normalizedIssues;
  }
}

export function assertBasicSupportActivityCsvFileSize(file) {
  const size = file?.size;
  if (typeof size === "number" && Number.isFinite(size) && size > MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES) {
    throw new BasicSupportActivityCsvError([issue(1, "文件", "文件大小不能超过 1 MiB")]);
  }
}

export function allowedSupportActivityDurationDistributions() {
  return [...ALLOWED_DURATION_DISTRIBUTIONS];
}

export function basicSupportActivityCsvTemplate() {
  const rows = [
    ["使用保障活动", "BA-101", "飞行前检查", "J-15", "固定值", "30", "", "", "", "", ""],
    ["使用保障", "BA-102", "通电检查", "J-15", "指数分布", "", "15", "", "", "", "BA-101"],
    ["预防性维修", "PM-201", "定检准备", "J-15", "正态分布", "", "45", "5", "", "", ""],
    ["修复性维修", "CM-301", "故障隔离", "J-15", "均匀分布", "", "", "", "20", "40", ""]
  ];
  return `\uFEFF${[
    BASIC_SUPPORT_ACTIVITY_CSV_HEADERS.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(","))
  ].join("\n")}\n`;
}

export function parseBasicSupportActivityCsv(text, options = {}) {
  const filename = String(options.filename || "").trim();
  if (filename && !filename.toLowerCase().endsWith(".csv")) {
    throw new BasicSupportActivityCsvError([issue(1, "文件", "仅支持 .csv 文件")]);
  }
  const rawSource = String(text ?? "");
  if (new TextEncoder().encode(rawSource).byteLength > MAX_BASIC_SUPPORT_ACTIVITY_CSV_BYTES) {
    throw new BasicSupportActivityCsvError([issue(1, "文件", "文件大小不能超过 1 MiB")]);
  }
  const source = rawSource.replace(/^\uFEFF/, "");
  if (!source.trim()) throw new BasicSupportActivityCsvError([issue(1, "文件", "文件为空")]);

  let records;
  try {
    records = parseCsvRecords(source).filter(({ values }) => values.some((value) => String(value).trim()));
  } catch (error) {
    if (error instanceof BasicSupportActivityCsvError) throw error;
    throw new BasicSupportActivityCsvError([issue(1, "文件", error?.message || "CSV 无法解析")]);
  }
  if (records.length < 2) {
    throw new BasicSupportActivityCsvError([issue(1, "文件", "至少需要表头和一行数据")]);
  }
  if (records.length > 1001) {
    throw new BasicSupportActivityCsvError([issue(1, "文件", "单次最多导入 1000 条基本保障活动")]);
  }

  const headerIssues = [];
  const canonicalHeaders = [];
  const seenHeaders = new Set();
  for (const rawHeader of records[0].values) {
    const header = String(rawHeader || "").trim();
    const canonical = BASIC_ACTIVITY_HEADER_LOOKUP.get(normalizeHeaderName(header));
    if (!header) {
      headerIssues.push(issue(1, "表头", "存在空列表头"));
      canonicalHeaders.push("");
    } else if (!canonical) {
      headerIssues.push(issue(1, header, "不支持的表头"));
      canonicalHeaders.push("");
    } else if (seenHeaders.has(canonical)) {
      headerIssues.push(issue(1, header, `与“${canonical}”重复`));
      canonicalHeaders.push("");
    } else {
      seenHeaders.add(canonical);
      canonicalHeaders.push(canonical);
    }
  }
  for (const required of REQUIRED_BASIC_ACTIVITY_HEADERS) {
    if (!seenHeaders.has(required)) headerIssues.push(issue(1, required, "缺少必填表头"));
  }
  if (headerIssues.length) throw new BasicSupportActivityCsvError(headerIssues);

  const aircraftModels = new Set(
    (Array.isArray(options.aircraftModels) ? options.aircraftModels : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const existingCodes = new Set(
    (Array.isArray(options.existingActivityCodes) ? options.existingActivityCodes : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const existingActivities = (Array.isArray(options.existingActivities) ? options.existingActivities : [])
    .map((row) => ({
      activityCode: String(row?.activityCode || "").trim(),
      type: BASIC_ACTIVITY_TYPE_ALIASES.get(String(row?.type || "").trim()) || String(row?.type || "").trim(),
      allowedAsPredecessor: Boolean(row?.allowedAsPredecessor)
    }))
    .filter((row) => row.activityCode);
  const issues = [];
  const rows = records.slice(1).map((record) => {
    if (record.values.length > canonicalHeaders.length) {
      issues.push(issue(record.startLine, "行", `字段数量 ${record.values.length} 超过表头列数 ${canonicalHeaders.length}`));
    }
    const values = Object.fromEntries(canonicalHeaders.map((header, index) => [header, String(record.values[index] ?? "").trim()]));
    for (const [field, value] of Object.entries(values)) {
      if (/^[=+\-@]/.test(value)) {
        issues.push(issue(record.startLine, field, "不允许以 =、+、- 或 @ 开头，避免电子表格公式注入"));
      }
    }
    return normalizeBasicActivityCsvRow(values, record.startLine, aircraftModels, issues);
  });

  const importedByCode = new Map();
  for (const row of rows) {
    if (!row.activityCode) continue;
    if (existingCodes.has(row.activityCode)) {
      issues.push(issue(row.sourceLine, "基本保障活动编号", `“${row.activityCode}”已存在于当前 Project`));
    }
    const firstLine = importedByCode.get(row.activityCode)?.sourceLine;
    if (firstLine) {
      issues.push(issue(row.sourceLine, "基本保障活动编号", `“${row.activityCode}”与第${firstLine}行重复`));
    } else {
      importedByCode.set(row.activityCode, row);
    }
  }
  validateBasicActivityPredecessors(rows, importedByCode, existingActivities, issues);
  if (issues.length) throw new BasicSupportActivityCsvError(issues);
  return rows;
}

function normalizeBasicActivityCsvRow(values, line, aircraftModels, issues) {
  const rawType = values["活动类型"];
  const activityType = BASIC_ACTIVITY_TYPE_ALIASES.get(rawType) || "";
  if (!rawType) issues.push(issue(line, "活动类型", "必填"));
  else if (!activityType) issues.push(issue(line, "活动类型", `“${rawType}”不受支持`));

  const activityCode = values["基本保障活动编号"];
  if (!activityCode) issues.push(issue(line, "基本保障活动编号", "必填"));
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(activityCode)) {
    issues.push(issue(line, "基本保障活动编号", "只能使用 1-64 位字母、数字、点、下划线或连字符"));
  }

  const workName = values["基本保障活动名称"];
  if (!workName) issues.push(issue(line, "基本保障活动名称", "必填"));
  else if (workName.length > 120) issues.push(issue(line, "基本保障活动名称", "长度不能超过 120 个字符"));

  const applicableAircraft = values["适用飞机"];
  if (applicableAircraft && !aircraftModels.has(applicableAircraft)) {
    issues.push(issue(line, "适用飞机", `“${applicableAircraft}”不在当前 Project 整机型号中`));
  }

  const distributionType = values["作业时长分布"];
  if (!distributionType) issues.push(issue(line, "作业时长分布", "必填"));
  else if (!ALLOWED_DURATION_DISTRIBUTIONS.includes(distributionType)) {
    issues.push(issue(line, "作业时长分布", `“${distributionType}”不受支持`));
  }
  const duration = durationProfileFromCsv(values, distributionType, line, issues);
  const predecessors = String(values["紧前作业"] || "")
    .split(/[;；、|]/)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const predecessor of predecessors) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(predecessor)) {
      issues.push(issue(line, "紧前作业", `“${predecessor}”只能使用 1-64 位字母、数字、点、下划线或连字符`));
    }
  }
  if (new Set(predecessors).size !== predecessors.length) {
    issues.push(issue(line, "紧前作业", "存在重复编号"));
  }

  return {
    type: activityType,
    activityCode,
    workName,
    applicableAircraft,
    durationProfile: duration.profile,
    durationMinutes: duration.minutes,
    predecessors,
    sourceLine: line
  };
}

function durationProfileFromCsv(values, distributionType, line, issues) {
  if (distributionType === "指数分布") {
    const mean = positiveCsvNumber(values["均值(min)"], line, "均值(min)", issues);
    return { profile: { distributionType, mean }, minutes: mean };
  }
  if (distributionType === "正态分布") {
    const mean = positiveCsvNumber(values["均值(min)"], line, "均值(min)", issues);
    const stdDev = positiveCsvNumber(values["标准差(min)"], line, "标准差(min)", issues);
    return { profile: { distributionType, mean, stdDev }, minutes: mean };
  }
  if (distributionType === "均匀分布") {
    const min = positiveCsvNumber(values["最小值(min)"], line, "最小值(min)", issues);
    const max = positiveCsvNumber(values["最大值(min)"], line, "最大值(min)", issues);
    if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
      issues.push(issue(line, "最大值(min)", "必须大于等于最小值(min)"));
    }
    return { profile: { distributionType, min, max }, minutes: Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : 0 };
  }
  if (distributionType === "固定值") {
    const value = positiveCsvNumber(values["固定工期(min)"], line, "固定工期(min)", issues);
    return { profile: { distributionType, value }, minutes: value };
  }
  return { profile: { distributionType: "固定值", value: 0 }, minutes: 0 };
}

function positiveCsvNumber(value, line, field, issues) {
  const text = String(value || "").trim();
  const number = Number(text);
  if (!text) issues.push(issue(line, field, "当前作业时长分布要求填写此字段"));
  else if (!Number.isFinite(number) || number <= 0) issues.push(issue(line, field, "必须为大于 0 的有限数"));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function validateBasicActivityPredecessors(rows, importedByCode, existingActivities, issues) {
  const existingByCode = new Map();
  for (const row of existingActivities) {
    existingByCode.set(row.activityCode, [...(existingByCode.get(row.activityCode) || []), row]);
  }
  for (const row of rows) {
    for (const predecessor of row.predecessors) {
      if (predecessor === row.activityCode) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”不能引用自身`));
        continue;
      }
      const target = importedByCode.get(predecessor);
      if (target && target.type !== row.type) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”与当前行活动类型不同`));
        continue;
      }
      if (target) continue;
      const existingMatches = existingByCode.get(predecessor) || [];
      if (!existingMatches.length) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”既不在本次 CSV，也不在当前目标活动中`));
      } else if (existingMatches.length > 1) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”在当前 Project 中存在歧义`));
      } else if (existingMatches[0].type !== row.type) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”属于${existingMatches[0].type || "其他"}类型，不能跨类型引用`));
      } else if (!existingMatches[0].allowedAsPredecessor) {
        issues.push(issue(row.sourceLine, "紧前作业", `“${predecessor}”不属于当前目标活动`));
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (row, path = []) => {
    if (!row?.activityCode || visited.has(row.activityCode)) return;
    if (visiting.has(row.activityCode)) {
      const cycle = [...path, row.activityCode].join(" -> ");
      issues.push(issue(row.sourceLine, "紧前作业", `存在循环引用：${cycle}`));
      return;
    }
    visiting.add(row.activityCode);
    for (const predecessor of row.predecessors) {
      const target = importedByCode.get(predecessor);
      if (target?.type === row.type) visit(target, [...path, row.activityCode]);
    }
    visiting.delete(row.activityCode);
    visited.add(row.activityCode);
  };
  rows.forEach((row) => visit(row));
}

function parseCsvRecords(text) {
  const records = [];
  let values = [];
  let current = "";
  let quoted = false;
  let lineNumber = 1;
  let recordStartLine = 1;
  let afterQuote = false;
  const finishRecord = () => {
    values.push(current);
    records.push({ values, startLine: recordStartLine });
    values = [];
    current = "";
    afterQuote = false;
    recordStartLine = lineNumber + 1;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        current += char;
        if (char === "\r" && next === "\n") {
          current += next;
          index += 1;
          lineNumber += 1;
        } else if (char === "\r" || char === "\n") {
          lineNumber += 1;
        }
      }
    } else if (char === '"' && !current) {
      quoted = true;
    } else if (char === '"') {
      throw new BasicSupportActivityCsvError([issue(recordStartLine, "文件", "未加引号字段中存在裸双引号")]);
    } else if (char === ",") {
      values.push(current);
      current = "";
      afterQuote = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && next === "\n") index += 1;
      finishRecord();
      lineNumber += 1;
    } else if (afterQuote && !/\s/.test(char)) {
      throw new BasicSupportActivityCsvError([issue(recordStartLine, "文件", "引号字段结束后存在非法字符")]);
    } else if (!afterQuote) {
      current += char;
    }
  }
  if (quoted) throw new BasicSupportActivityCsvError([issue(recordStartLine, "文件", "存在未闭合的引号字段")]);
  if (current || values.length || afterQuote) finishRecord();
  return records;
}

function issue(line, field, reason) {
  return { line, field, reason };
}

function formatBasicSupportActivityCsvIssue(value) {
  const detail = `第${value.line}行 [${value.field}] ${value.reason}`;
  return detail.length > MAX_BASIC_SUPPORT_ACTIVITY_CSV_ERROR_DETAIL_CHARS
    ? `${detail.slice(0, MAX_BASIC_SUPPORT_ACTIVITY_CSV_ERROR_DETAIL_CHARS - 1)}…`
    : detail;
}

function normalizeHeaderName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function supportActivityJobFromBasicActivity(activity) {
  const profile = normalizeSupportActivityDurationProfile(activity?.durationProfile || activity?.durationDistribution, activity?.durationMinutes);
  const personnel = Array.isArray(activity?.personnel)
    ? activity.personnel.map((item) => ({
      professional: String(item?.professional || "").trim(),
      quantity: Math.max(1, Number(item?.quantity) || 1)
    })).filter((item) => item.professional)
    : [];
  const equipment = structuredResourceRequirements(activity?.equipment);
  const spare = structuredResourceRequirements(activity?.spare);
  return {
    activityCode: String(activity?.activityCode || activity?.id || "").trim(),
    workName: String(activity?.workName || activity?.name || activity?.activityName || "").trim(),
    applicableAircraft: String(activity?.applicableAircraft || activity?.aircraftModel || "").trim(),
    durationProfile: profile,
    durationMinutes: durationMinutesFromProfile(profile, activity?.durationMinutes),
    ...(activity?.personnelProfessional ? { personnelProfessional: String(activity.personnelProfessional).trim() } : {}),
    ...(activity?.equipmentModel ? { equipmentModel: String(activity.equipmentModel).trim() } : {}),
    personnel,
    equipment,
    spare,
    predecessors: Array.isArray(activity?.predecessors) ? [...activity.predecessors] : []
  };
}

function structuredResourceRequirements(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    model: String(item?.model || "").trim(),
    name: String(item?.name || "").trim(),
    quantity: Math.max(1, Number(item?.quantity) || 1)
  })).filter((item) => item.model || item.name);
}

export function normalizeSupportActivityDurationProfile(profile, fallbackMinutes = 30) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const distributionType = ALLOWED_DURATION_DISTRIBUTIONS.includes(source.distributionType)
    ? source.distributionType
    : "固定值";
  const fallbackValue = positiveNumber(fallbackMinutes, 30);
  if (distributionType === "指数分布") {
    return { distributionType, mean: positiveNumber(source.mean ?? source.value, fallbackValue) };
  }
  if (distributionType === "正态分布") {
    return {
      distributionType,
      mean: positiveNumber(source.mean ?? source.value, fallbackValue),
      stdDev: positiveNumber(source.stdDev, Math.max(1, Math.round(fallbackValue * 0.2)))
    };
  }
  if (distributionType === "均匀分布") {
    const min = positiveNumber(source.min, Math.max(1, Math.round(fallbackValue * 0.8)));
    const max = positiveNumber(source.max, Math.max(min, Math.round(fallbackValue * 1.2)));
    return { distributionType, min, max: Math.max(min, max) };
  }
  return { distributionType: "固定值", value: positiveNumber(source.value ?? source.mean, fallbackValue) };
}

function durationMinutesFromProfile(profile, fallbackMinutes) {
  if (profile?.distributionType === "指数分布") return positiveNumber(profile.mean, fallbackMinutes);
  if (profile?.distributionType === "正态分布") return positiveNumber(profile.mean, fallbackMinutes);
  if (profile?.distributionType === "均匀分布") return Math.round((positiveNumber(profile.min, fallbackMinutes) + positiveNumber(profile.max, fallbackMinutes)) / 2);
  return positiveNumber(profile?.value, fallbackMinutes);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Number(fallback || 0);
}
