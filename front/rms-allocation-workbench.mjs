const RELIABILITY_METHODS = [
  ["equal", "等分配法"],
  ["proportional", "比例分配法"],
  ["similar", "相似产品分配法"]
];

export function renderRmsAllocationWorkbench({ project, plan, result, importStatus, htmlEscape, fixed, pct }) {
  const equipmentRoots = project.equipmentNodes.filter((node) => !node.parentId);
  return `
    <div class="rms-allocation-workbench">
      <div class="section-head section-context">
        <span>装备 RMS 指标分配 / 导入安装数</span>
        <span>${htmlEscape(project.name)} / ${htmlEscape(result.algorithmVersion)}</span>
      </div>

      <section class="rms-layout">
        <div class="rms-equipment-tree">
          <div class="tree-toolbar equipment-tree-toolbar">
            <h4>装备结构树</h4>
            <span>独立导入数据</span>
          </div>
          ${equipmentRootSelect(project.rootId, equipmentRoots, htmlEscape)}
          ${renderEquipmentTree(project, result, htmlEscape)}
        </div>
        <div class="rms-installation-panel">
          <div class="section-head"><h3>导入安装数</h3><span>${statusLabel(result.status)}</span></div>
          <div class="equipment-import-row rms-installation-import-row">
            <button type="button" class="rms-import-button" data-rms-action="download-template">下载模板</button>
            <label class="rms-file-button rms-import-button">上传文件<input data-rms-equipment-import-file type="file" accept=".csv,.json,application/json,text/csv"></label>
            <p class="rms-import-status">${htmlEscape(importStatus || "当前安装数为 RMS 分配工作台独立数据。")}</p>
          </div>
          <div class="table-wrap"><table><thead><tr><th>系统名称</th><th>型号</th><th>安装数</th><th>运行比</th></tr></thead><tbody>
            ${result.nodeResults.map((row) => `<tr><td>${htmlEscape(row.nodeName)}</td><td>${htmlEscape(row.model || "-")}</td><td>${row.installationCount}</td><td>${compactNumber(row.runningRatio)}</td></tr>`).join("")}
          </tbody></table></div>
        </div>
      </section>

      <section class="rms-method-panel">
          <div class="section-head"><h3>计算方法</h3><span>选择节点份额分配规则</span></div>
          <div class="rms-method-grid">
            <label>指标分配方法
              <select data-rms-path="methods.allocation">
                ${RELIABILITY_METHODS.map(([value, label]) => `<option value="${value}" ${plan.methods.allocation === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            ${renderMethodParameters(plan, equipmentRoots, project.rootId, htmlEscape)}
          </div>
          <div class="rms-method-actions">
            <button type="button" class="btn-primary" data-rms-action="calculate">计算</button>
          </div>
          <div class="rms-warning-list">
            ${result.warnings.length
              ? result.warnings.map((warning) => `<span>${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
              : "<span>分配完成，节点份额合计为 100%。</span>"}
          </div>
      </section>

      <section class="analysis-chart-panel rms-result-panel">
        <div class="section-head"><h3>节点分配结果</h3><button type="button" data-rms-action="export-excel">导出 Excel</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>层级</th><th>节点</th><th>型号</th><th>安装数</th><th>运行比</th><th>分配份额</th><th>状态</th></tr></thead>
            <tbody>${result.nodeResults.map((row) => `
              <tr>
                <td>${htmlEscape(row.level)}</td>
                <td>${htmlEscape(row.nodeName)}</td>
                <td>${htmlEscape(row.model || "-")}</td>
                <td>${row.installationCount}</td>
                <td>${compactNumber(row.runningRatio)}</td>
                <td>${pct(row.allocationShare)}</td>
                <td>${htmlEscape(row.status)}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderEquipmentTree(project, result, htmlEscape) {
  const childNodesByParent = project.equipmentNodes.reduce((acc, node) => {
    if (node.parentId) {
      acc[node.parentId] ||= [];
      acc[node.parentId].push(node);
    }
    return acc;
  }, {});
  const root = project.equipmentNodes.find((node) => node.id === project.rootId);
  const renderChildren = (parentId, depth = 1) => (childNodesByParent[parentId] || []).map((node) => {
    const row = result.nodeResults.find((item) => item.nodeId === node.id);
    return `
      <li style="--tree-depth:${depth}">
        <strong>${htmlEscape(node.name)}</strong>
        <span>${htmlEscape(node.level)} / 运行比 ${compactNumber(row?.runningRatio)}</span>
      </li>
      ${renderChildren(node.id, depth + 1)}
    `;
  }).join("");
  return `
    <ul>
      <li style="--tree-depth:0"><strong>${htmlEscape(root?.name || "整机")}</strong><span>装备</span></li>
      ${renderChildren(project.rootId)}
    </ul>
  `;
}

function input(label, path, value, type, step, htmlEscape) {
  const stepAttribute = type === "number" && step ? ` step="${htmlEscape(step)}"` : "";
  return `<label>${label}<input data-rms-path="${path}" type="${type}"${stepAttribute} value="${htmlEscape(value)}"></label>`;
}

function select(label, path, value, options, htmlEscape) {
  return `
    <label>${label}
      <select data-rms-path="${htmlEscape(path)}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${htmlEscape(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${htmlEscape(optionLabel)}</option>`).join("")}
      </select>
    </label>
  `;
}

function equipmentRootSelect(value, equipmentRoots, htmlEscape) {
  return `
    <label>装备
      <select data-rms-equipment-root>
        ${equipmentRoots.map((node) => `<option value="${htmlEscape(node.id)}" ${String(value) === String(node.id) ? "selected" : ""}>${htmlEscape(node.name)}</option>`).join("")}
      </select>
      <span>先选定机型后展示对应结构树</span>
    </label>
  `;
}

function renderMethodParameters(plan, equipmentRoots, currentRootId, htmlEscape) {
  if (plan.methods.allocation === "similar") {
    const similarProduct = plan.methods?.similarProduct || {};
    const sourceRoots = equipmentRoots.filter((node) => node.id !== currentRootId);
    return `
      ${select("基准机型", "methods.similarProduct.sourceModel", similarProduct.sourceModel || sourceRoots[0]?.name || "", sourceRoots.map((node) => [node.name, node.name]), htmlEscape)}
    `;
  }
  return "";
}

function statusLabel(status) {
  if (status === "method_not_applicable") return "方法不适用";
  return status === "calculated" ? "已计算" : "待计算";
}

function compactNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}
