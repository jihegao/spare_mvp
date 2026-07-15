const RELIABILITY_METHODS = [
  ["equal", "等分配法"],
  ["proportional", "比例分配法"],
  ["similar", "相似产品分配法"]
];

export function renderRmsAllocationWorkbench({ project, plan, result, importStatus, selectedEquipmentNodeId = project.rootId, isCalculating = false, htmlEscape, fixed, pct }) {
  const equipmentRoots = project.equipmentNodes.filter((node) => !node.parentId);
  return `
    <div class="rms-allocation-workbench" aria-busy="${isCalculating ? "true" : "false"}">
      <div class="section-head section-context">
        <span>装备 RMS 指标分配 / 导入安装数</span>
        <span>${htmlEscape(project.name)} / ${htmlEscape(result.algorithmVersion)}</span>
      </div>

      <section class="organization-layout equipment-layout rms-layout">
        <aside class="tree-container rms-equipment-tree">
          <div class="tree-toolbar equipment-tree-toolbar">
            <h4>装备结构树</h4>
            <span>独立导入数据</span>
          </div>
          ${renderEquipmentTree(project, result, selectedEquipmentNodeId, htmlEscape)}
        </aside>
        <section class="detail-panel equipment-system-table-panel rms-installation-panel">
          <div class="detail-card">
            <div class="section-head"><h3>导入安装数</h3><span>${statusLabel(result.status)}</span></div>
          <div class="equipment-import-row rms-installation-import-row">
            <button type="button" class="rms-import-button" data-rms-action="download-template">下载模板</button>
            <label class="rms-file-button rms-import-button">上传文件<input data-rms-equipment-import-file type="file" accept=".csv,.json,application/json,text/csv"></label>
            <p class="rms-import-status">${htmlEscape(importStatus || "当前安装数为 RMS 分配工作台独立数据。")}</p>
          </div>
          ${renderInstallationTable(project, selectedEquipmentNodeId, htmlEscape)}
          </div>
        </section>
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
            <button type="button" class="btn-primary" data-rms-action="calculate"${isCalculating ? " disabled" : ""}>${isCalculating ? "计算中" : "计算"}</button>
          </div>
          <div class="rms-warning-list">
            ${result.warnings.length
              ? result.warnings.map((warning) => `<span>${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
              : "<span>计算完成。</span>"}
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
      ${isCalculating ? '<div class="rms-calculation-overlay" role="status" aria-live="assertive"><span>计算中</span></div>' : ""}
    </div>
  `;
}

function renderInstallationTable(project, selectedNodeId, htmlEscape) {
  const visibleNodes = rmsEquipmentSubtree(project, selectedNodeId);
  const selectedNode = project.equipmentNodes.find((node) => node.id === selectedNodeId);
  return `
    <div class="rms-table-context">${htmlEscape(selectedNode?.name || "装备结构树")}及以下节点（${visibleNodes.length}）</div>
    <div class="table-wrap"><table><thead><tr><th>系统名称</th><th>型号</th><th>安装数</th><th>运行比</th></tr></thead><tbody>
      ${visibleNodes.map((node) => {
        const runningRatio = runningRatioForNode(node);
        return `<tr data-rms-equipment-row="${htmlEscape(node.id)}">
          <td><input aria-label="${htmlEscape(node.name)} 系统名称" data-rms-equipment-field="name" data-rms-equipment-node-id="${htmlEscape(node.id)}" value="${htmlEscape(node.name)}"></td>
          <td><input aria-label="${htmlEscape(node.name)} 型号" data-rms-equipment-field="model" data-rms-equipment-node-id="${htmlEscape(node.id)}" value="${htmlEscape(node.model || node.partNumber || "")}" placeholder="未填写"></td>
          <td><input aria-label="${htmlEscape(node.name)} 安装数" data-rms-equipment-field="quantity" data-rms-equipment-node-id="${htmlEscape(node.id)}" type="number" min="1" step="1" value="${htmlEscape(node.quantity)}"></td>
          <td><input aria-label="${htmlEscape(node.name)} 运行比" data-rms-equipment-field="runningRatio" data-rms-equipment-node-id="${htmlEscape(node.id)}" type="number" min="0" max="1" step="0.01" value="${htmlEscape(compactNumber(runningRatio))}"></td>
        </tr>`;
      }).join("")}
    </tbody></table></div>
  `;
}

function renderEquipmentTree(project, result, selectedNodeId, htmlEscape) {
  const rootNodes = project.equipmentNodes.filter((node) => !node.parentId);
  const childNodesByParent = project.equipmentNodes.reduce((acc, node) => {
    if (node.parentId) {
      acc[node.parentId] ||= [];
      acc[node.parentId].push(node);
    }
    return acc;
  }, {});
  const renderChildren = (parentId) => (childNodesByParent[parentId] || []).map((node) => {
    const row = result.nodeResults.find((item) => item.nodeId === node.id);
    return `
      <div class="tree-node-item">
        <div class="tree-node-row">
          <button type="button" class="tree-node-label${node.id === selectedNodeId ? " selected" : ""}" data-rms-equipment-node="${htmlEscape(node.id)}">
            <span class="tree-node-toggle">•</span>
            <span class="tree-node-text">${htmlEscape(node.name)}</span>
            <span class="tree-node-meta">${htmlEscape(node.level)} / 运行比 ${compactNumber(row?.runningRatio ?? runningRatioForNode(node))}</span>
          </button>
        </div>
        ${childNodesByParent[node.id]?.length ? `<div class="tree-node-children">${renderChildren(node.id)}</div>` : ""}
      </div>
    `;
  }).join("");
  return `
    <div class="object-tree rms-equipment-tree-list">
      <div class="tree-node-item">
        <div class="tree-node-row">
          <span class="tree-node-label root"><span class="tree-node-toggle">▼</span><span class="tree-node-text">飞机列表</span><span class="tree-node-meta">${rootNodes.length} 类飞机</span></span>
        </div>
        <div class="tree-node-children">
          ${rootNodes.map((root) => `
            <div class="tree-node-item">
              <div class="tree-node-row">
                <button type="button" class="tree-node-label${root.id === selectedNodeId ? " selected" : ""}" data-rms-equipment-root="${htmlEscape(root.id)}" data-rms-equipment-node="${htmlEscape(root.id)}">
                  <span class="tree-node-toggle">${childNodesByParent[root.id]?.length ? "▼" : "•"}</span>
                  <span class="tree-node-text">${htmlEscape(root.name)}</span>
                  <span class="tree-node-meta">整机级</span>
                </button>
              </div>
              ${childNodesByParent[root.id]?.length ? `<div class="tree-node-children">${renderChildren(root.id)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function rmsEquipmentSubtree(project, selectedNodeId) {
  const childNodesByParent = (project.equipmentNodes || []).reduce((acc, node) => {
    if (node.parentId) {
      acc[node.parentId] ||= [];
      acc[node.parentId].push(node);
    }
    return acc;
  }, {});
  const visibleNodes = [];
  const visit = (nodeId) => {
    const node = project.equipmentNodes.find((item) => item.id === nodeId);
    if (!node) return;
    visibleNodes.push(node);
    (childNodesByParent[node.id] || []).forEach((child) => visit(child.id));
  };
  visit(selectedNodeId);
  return visibleNodes;
}

function runningRatioForNode(node) {
  return node.missionUse?.runningRatio ?? node.missionUse?.dutyCycle ?? node.runningRatio ?? 1;
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
