const RELIABILITY_METHODS = [
  ["equal", "等分配法"],
  ["proportional", "比例分配法"],
  ["similar", "相似产品分配法"]
];

export function renderRmsAllocationWorkbench({ project, plan, result, importStatus, htmlEscape, fixed, pct }) {
  const equipmentRoots = project.equipmentNodes.filter((node) => !node.parentId);
  const targetMetrics = result.targetMetrics || {};
  return `
    <div class="rms-allocation-workbench">
      <section class="rms-parameter-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow">装备 RMS 指标分配</span>
          </div>
          <span>${htmlEscape(project.name)} / ${htmlEscape(result.algorithmVersion)}</span>
        </div>
        <div class="rms-parameter-grid">
          ${input("任务可靠度", "targets.reliability.value", plan.targets.reliability.value, "number", "0.001", htmlEscape)}
          ${input("任务时长(h)", "targets.taskDurationHours", plan.targets.taskDurationHours ?? plan.targets.reliability.atHours, "number", "0.1", htmlEscape)}
          ${input("关键故障占比", "targets.criticalFailureRatio", plan.targets.criticalFailureRatio ?? 1, "number", "0.01", htmlEscape)}
          ${input("MTTR(h)", "targets.mttrHours", plan.targets.mttrHours, "number", "0.1", htmlEscape)}
        </div>
      </section>

      <section class="rms-layout">
        <div class="rms-equipment-tree">
          <div class="section-head"><h3>装备树</h3><span>独立导入数据</span></div>
          <div class="rms-import-actions">
            <label class="rms-file-button">导入表格<input data-rms-equipment-import-file type="file" accept=".csv,.json,application/json,text/csv"></label>
          </div>
          ${equipmentRootSelect(project.rootId, equipmentRoots, htmlEscape)}
          <p class="rms-import-status">${htmlEscape(importStatus || "当前装备树为 RMS 分配工作台独立数据。")}</p>
          ${renderEquipmentTree(project, result, htmlEscape)}
        </div>
        <div class="rms-method-panel">
          <div class="section-head"><h3>方法选择</h3><span>${statusLabel(result.status)}</span></div>
          <div class="rms-method-grid">
            <label>可靠性分配方法
              <select data-rms-path="methods.reliability">
                ${RELIABILITY_METHODS.map(([value, label]) => `<option value="${value}" ${plan.methods.reliability === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            ${renderMethodParameters(plan, equipmentRoots, htmlEscape)}
          </div>
          <div class="rms-method-actions">
            <button type="button" class="btn-primary" data-rms-action="calculate">计算</button>
          </div>
          <div class="rms-verification-metrics">
            ${metric("目标 R", fixed(result.verification.equipmentTarget.reliability, 3))}
            ${metric("校核可靠度", fixed(result.verification.calculated.reliability, 3))}
            ${metric("MTBCF", `${fixed(targetMetrics.mtbcfHours, 1)} h`)}
            ${metric("MTBF", `${fixed(targetMetrics.mtbfHours, 1)} h`)}
            ${metric("MTTR 裕度", `${fixed(result.verification.margin.mttrHours, 2)} h`)}
          </div>
          <div class="rms-warning-list">
            ${result.warnings.length
              ? result.warnings.map((warning) => `<span>${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
              : "<span>校核通过，未发现不可行原因。</span>"}
          </div>
        </div>
      </section>

      <section class="analysis-chart-panel rms-result-panel">
        <div class="section-head"><h3>节点分配结果</h3><span>系统级 / LRU 级 RMS target</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>层级</th><th>节点</th><th>结构</th><th>运行比</th><th>产品强度</th><th>失效率</th><th>MTBCF</th><th>MTBF</th><th>MTTR</th><th>Ai</th><th>Ao</th><th>状态</th></tr></thead>
            <tbody>${result.nodeResults.map((row) => `
              <tr>
                <td>${htmlEscape(row.level)}</td>
                <td>${htmlEscape(row.nodeName)}</td>
                <td>${htmlEscape(row.structure)}</td>
                <td>${compactNumber(row.runningRatio)}</td>
                <td>${fixed(row.productIntensityHours, 2)} h</td>
                <td>${fixed(row.failureRate, 5)}</td>
                <td>${fixed(row.mtbcfHours, 1)} h</td>
                <td>${fixed(row.mtbfHours, 1)} h</td>
                <td>${fixed(row.mttrHours, 2)} h</td>
                <td>${pct(row.inherentAvailability)}</td>
                <td>${pct(row.operationalAvailability)}</td>
                <td><span class="status-badge ${row.status === "风险" ? "warn" : "success"}">${row.status}</span></td>
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

function renderMethodParameters(plan, equipmentRoots, htmlEscape) {
  if (plan.methods.reliability === "proportional") {
    return input("比例修正系数", "methods.proportional.adjustmentFactor", plan.methods?.proportional?.adjustmentFactor ?? 1, "number", "0.01", htmlEscape);
  }
  if (plan.methods.reliability === "similar") {
    const similarProduct = plan.methods?.similarProduct || {};
    return `
      ${select("基准机型", "methods.similarProduct.sourceModel", similarProduct.sourceModel || equipmentRoots[0]?.name || "", equipmentRoots.map((node) => [node.name, node.name]), htmlEscape)}
      ${input("相似修正系数", "methods.similarProduct.adjustmentFactor", similarProduct.adjustmentFactor ?? 0.92, "number", "0.01", htmlEscape)}
    `;
  }
  return "";
}

function metric(label, value) {
  return `<div class="kpi-card"><span>${label}</span><strong>${value}</strong></div>`;
}

function statusLabel(status) {
  if (status === "method_not_applicable") return "方法不适用";
  return status === "validated" ? "已校核" : "已计算";
}

function compactNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}
