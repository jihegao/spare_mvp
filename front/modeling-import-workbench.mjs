import { MODELING_IMPORT_PAGE_MAP } from "./modeling-import-contract.mjs";

const COLLECTIONS = [
  "missionProfiles",
  "equipmentAssets",
  "supportResources",
  "supportActivities"
];

const TARGET_PROJECT_PATHS = {
  missionProfiles: "missionProfile",
  equipmentAssets: "components",
  supportResources: "supportNodes",
  supportActivities: "supportActivities"
};

const CHANGE_LABELS = {
  added: "新增",
  removed: "删除",
  changed: "修改"
};

export function cloneModelingImportPackage(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function normalizeModelingImportRecord(record, fallbackPackage = {}) {
  const draftPackage = record?.draftPackage || null;
  const publishedPackage = record?.publishedPackage || null;
  const barePackage = record?.schemaVersion && record?.objects ? record : null;
  const importPackage = draftPackage || publishedPackage || barePackage || fallbackPackage || {};
  const validation = record?.validation || importPackage?.validation || fallbackPackage?.validation || { status: "not_validated", issues: [] };

  return {
    importPackage: cloneModelingImportPackage(importPackage),
    publishedPackage: publishedPackage ? cloneModelingImportPackage(publishedPackage) : null,
    validation: cloneModelingImportPackage(validation),
    saved: Boolean(draftPackage || publishedPackage)
  };
}

export function buildModelingImportPreview(importPackage) {
  const objects = importPackage?.objects || {};
  const rows = [];
  const summary = [];

  for (const collection of COLLECTIONS) {
    const page = MODELING_IMPORT_PAGE_MAP[collection] || "建模数据入口";
    const collectionRows = Array.isArray(objects[collection]) ? objects[collection] : [];
    summary.push({
      collection,
      page,
      count: collectionRows.filter((row) => row && typeof row === "object").length
    });

    collectionRows.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      for (const field of Object.keys(row)) {
        rows.push({
          collection,
          page,
          object_id: String(row.id || `${collection}[${index}]`),
          object_name: String(row.name || row.id || `${collection}[${index}]`),
          field,
          field_path: `objects.${collection}[${index}].${field}`,
          target_path: targetProjectPath(collection, index, field),
          value: row[field]
        });
      }
    });
  }

  return { rows, summary };
}

export function diffModelingImports(publishedPackage, draftPackage) {
  const before = flattenImportPackage(publishedPackage);
  const after = flattenImportPackage(draftPackage);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const rows = [];

  for (const path of paths) {
    const hasBefore = before.has(path);
    const hasAfter = after.has(path);
    const beforeValue = before.get(path);
    const afterValue = after.get(path);
    if (hasBefore && hasAfter && stableValue(beforeValue) === stableValue(afterValue)) continue;

    const change = hasBefore && hasAfter ? "changed" : hasAfter ? "added" : "removed";
    rows.push({
      change,
      change_label: CHANGE_LABELS[change],
      page: pageForFieldPath(path),
      object_id: objectIdForFieldPath(draftPackage, path) || objectIdForFieldPath(publishedPackage, path) || "modeling-import-package",
      field_path: path,
      before: hasBefore ? beforeValue : null,
      after: hasAfter ? afterValue : null
    });
  }

  return { rows };
}

export function renderModelingImportWorkbench(state = {}, helpers = {}) {
  const htmlEscape = helpers.htmlEscape || escapeHtml;
  const importPackage = state.importPackage || state.draftPackage || {};
  const publishedPackage = state.publishedPackage || null;
  const validation = state.validation || importPackage.validation || { status: "not_validated", issues: [] };
  const preview = state.preview || buildModelingImportPreview(importPackage);
  const diff = state.diff || diffModelingImports(publishedPackage, importPackage);
  const lifecycle = importPackage.lifecycle || {};
  const publishedLifecycle = publishedPackage?.lifecycle || {};
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  const validationStatus = validation.status || (validation.ok === false ? "invalid" : "not_validated");
  const canPublish = Boolean(state.canPublish);
  const canCompile = Boolean(state.canCompile);

  return `
    <div class="modeling-import-workbench">
      <section class="modeling-import-bar">
        <div>
          <span class="eyebrow">M5.2 / 建模数据导入</span>
          <h3>建模数据导入</h3>
          <p>${htmlEscape(importPackage.importId || "未加载导入包")} / ${htmlEscape(importPackage.projectId || "未绑定项目")}</p>
        </div>
        <div class="modeling-import-actions">
          <button type="button" data-modeling-import-action="load-fixture">加载样例</button>
          <button type="button" data-modeling-import-action="backfill-current-project">按当前项目回灌</button>
          <button type="button" data-modeling-import-action="load-invalid-fixture">加载错误样例</button>
          <button type="button" data-modeling-import-action="validate">校验</button>
          <button type="button" data-modeling-import-action="save-draft">保存草稿</button>
          <button type="button" data-modeling-import-action="publish"${disabledAttr(!canPublish)}>发布</button>
          <button type="button" data-modeling-import-action="compile-scenario"${disabledAttr(!canCompile)} class="btn-primary">生成 Scenario</button>
          <button type="button" data-modeling-import-action="create-project" data-modeling-import-id="${htmlEscape(publishedPackage?.importId || publishedPackage?.import_id || "")}"${disabledAttr(!canCompile)} class="btn-secondary">生成示例 Project</button>
        </div>
      </section>
      ${state.actionStatus ? `<p class="modeling-import-action-status">${htmlEscape(state.actionStatus)}</p>` : ""}

      <section class="modeling-import-status-grid">
        ${metric("当前状态", `${lifecycle.state || "draft"} / v${lifecycle.version || 1}`, htmlEscape)}
        ${metric("发布快照", publishedPackage ? `${publishedLifecycle.state || "published"} / v${publishedLifecycle.version || 1}` : "未发布", htmlEscape)}
        ${metric("校验状态", validationStatus, htmlEscape)}
        ${metric("字段问题", `${issues.length}`, htmlEscape)}
      </section>

      <section class="modeling-import-layout">
        <div class="analysis-chart-panel">
          <div class="section-head"><h3>映射预览</h3><span>${preview.rows.length} 个字段</span></div>
          <div class="modeling-import-summary">
            ${preview.summary.map((row) => `
              <div><strong>${htmlEscape(row.page)}</strong><span>${htmlEscape(row.collection)} / ${row.count} 行</span></div>
            `).join("")}
          </div>
          <div class="table-wrap compact">
            <table>
              <thead><tr><th>目标页面</th><th>对象</th><th>导入字段</th><th>Project 映射</th><th>值</th></tr></thead>
              <tbody>${preview.rows.length ? preview.rows.map((row) => `
                <tr>
                  <td>${htmlEscape(row.page)}</td>
                  <td>${htmlEscape(row.object_id)}</td>
                  <td>${htmlEscape(row.field_path)}</td>
                  <td>${htmlEscape(row.target_path)}</td>
                  <td>${htmlEscape(formatValue(row.value))}</td>
                </tr>
              `).join("") : emptyRow("暂无映射字段", 5)}</tbody>
            </table>
          </div>
        </div>

        <div class="analysis-chart-panel">
          <div class="section-head"><h3>字段级问题</h3><span>${issues.length ? "需修正" : "未发现问题"}</span></div>
          <div class="table-wrap compact">
            <table>
              <thead><tr><th>页面</th><th>对象</th><th>字段路径</th><th>级别</th><th>消息</th></tr></thead>
              <tbody>${issues.length ? issues.map((issue) => `
                <tr>
                  <td>${htmlEscape(issue.page || "建模数据入口")}</td>
                  <td>${htmlEscape(issue.object_id || "-")}</td>
                  <td>${htmlEscape(issue.field_path || "-")}</td>
                  <td><span class="status-badge danger">${htmlEscape(issue.severity || "error")}</span></td>
                  <td>${htmlEscape(issue.message || "-")}</td>
                </tr>
              `).join("") : emptyRow("校验通过或尚未执行校验", 5)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="analysis-chart-panel">
        <div class="section-head"><h3>草稿 / 发布差异</h3><span>${diff.rows.length ? `${diff.rows.length} 个字段差异` : "无差异"}</span></div>
        <div class="table-wrap compact">
          <table>
            <thead><tr><th>类型</th><th>页面</th><th>对象</th><th>字段路径</th><th>发布值</th><th>草稿值</th></tr></thead>
            <tbody>${publishedPackage
              ? diff.rows.length ? diff.rows.map((row) => `
                <tr>
                  <td><span class="status-badge ${row.change === "removed" ? "warn" : row.change === "added" ? "success" : ""}">${htmlEscape(row.change_label)}</span></td>
                  <td>${htmlEscape(row.page)}</td>
                  <td>${htmlEscape(row.object_id)}</td>
                  <td>${htmlEscape(row.field_path)}</td>
                  <td>${htmlEscape(formatValue(row.before))}</td>
                  <td>${htmlEscape(formatValue(row.after))}</td>
                </tr>
              `).join("") : emptyRow("草稿与发布快照一致", 6)
              : emptyRow("暂无发布快照，发布后显示差异", 6)}</tbody>
          </table>
        </div>
      </section>

      <section class="modeling-import-compile-panel">
        <div class="section-head"><h3>Scenario 预览</h3><span>${state.compileResult ? "已生成" : "等待生成"}</span></div>
        ${renderCompileResult(state.compileResult, htmlEscape)}
      </section>
    </div>
  `;
}

function targetProjectPath(collection, index, field) {
  const root = TARGET_PROJECT_PATHS[collection] || collection;
  if (collection === "missionProfiles") return index === 0 ? `${root}.${field}` : `${root}[${index}].${field}`;
  return `${root}[${index}].${field}`;
}

function flattenImportPackage(value) {
  const rows = new Map();
  flattenValue(value, "", rows);
  return rows;
}

function flattenValue(value, path, rows) {
  if (value === undefined) return;
  if (value === null || typeof value !== "object") {
    if (path) rows.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenValue(item, arrayItemPath(path, item, index), rows));
    if (!value.length && path) rows.set(path, []);
    return;
  }
  const keys = Object.keys(value).sort();
  if (!keys.length && path) rows.set(path, {});
  for (const key of keys) {
    flattenValue(value[key], path ? `${path}.${key}` : key, rows);
  }
}

function stableValue(value) {
  return JSON.stringify(value);
}

function pageForFieldPath(path) {
  const match = String(path).match(/^objects\.([^.[]+)/);
  return MODELING_IMPORT_PAGE_MAP[match?.[1]] || "建模数据入口";
}

function objectIdForFieldPath(importPackage, path) {
  const idMatch = String(path).match(/^objects\.([^.[]+)\[id=([^\]]+)\]/);
  if (idMatch) return decodePathToken(idMatch[2]);
  const match = String(path).match(/^objects\.([^.[]+)\[(\d+)\]/);
  if (!match) return null;
  const row = importPackage?.objects?.[match[1]]?.[Number(match[2])];
  return row?.id ? String(row.id) : `${match[1]}[${match[2]}]`;
}

function arrayItemPath(path, item, index) {
  if (String(path).match(/^objects\.(missionProfiles|equipmentAssets|supportResources|supportActivities)$/) && item && typeof item === "object" && item.id) {
    return `${path}[id=${encodePathToken(item.id)}]`;
  }
  return `${path}[${index}]`;
}

function encodePathToken(value) {
  return encodeURIComponent(String(value));
}

function decodePathToken(value) {
  return decodeURIComponent(String(value));
}

function metric(label, value, htmlEscape) {
  return `<div class="kpi-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`;
}

function disabledAttr(disabled) {
  return disabled ? " disabled" : "";
}

function emptyRow(message, colspan) {
  return `<tr><td colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
}

function renderCompileResult(compileResult, htmlEscape) {
  if (!compileResult) {
    return `<p class="modeling-import-empty">发布后可调用后端 Simulation Adapter 生成 aircraft_support_v1 Scenario 预览。</p>`;
  }
  const metadata = compileResult.compiled_from_import || {};
  const scenario = compileResult.scenario || {};
  return `
    <div class="modeling-import-compile-grid">
      ${metric("来源导入", metadata.import_id || "-", htmlEscape)}
      ${metric("模型族", metadata.model_family || "aircraft_support_v1", htmlEscape)}
      ${metric("Scenario", scenario.scenario_id || scenario.scenarioId || "-", htmlEscape)}
      ${metric("编译器", scenario.compiled_by || "-", htmlEscape)}
    </div>
  `;
}

function formatValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
