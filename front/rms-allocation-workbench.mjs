const RELIABILITY_METHODS = [
  ["equal", "等分配法"],
  ["proportional", "比例分配法"],
  ["similar", "相似产品分配法"]
];

export function renderRmsAllocationWorkbench({
  project,
  plan,
  result,
  importStatus,
  aircraftModels = [],
  selectedAircraftModel = "",
  selectedEquipmentNodeId = project.rootId,
  validationMessage = "",
  calculationStatus = "",
  htmlEscape,
  fixed,
  pct
}) {
  const equipmentRoots = project.equipmentNodes.filter((node) => !node.parentId);
  const hasAircraftModels = aircraftModels.length > 0;
  const hasSelectedAircraft = aircraftModels.includes(selectedAircraftModel);
  const selectedRoot = equipmentRoots.find((node) => node.id === project.rootId);
  const hasEquipmentTree = Boolean(selectedRoot && project.equipmentNodes.some((node) => node.parentId === selectedRoot.id));
  const hasCompletedResult = result?.status === "calculated" && result.nodeResults?.length > 0;
  const normalizedCalculationStatus = calculationStatus === "calculating"
    ? "calculating"
    : ((calculationStatus === "completed" || !calculationStatus) && hasCompletedResult ? "completed" : "not-calculated");
  const isCalculating = normalizedCalculationStatus === "calculating";
  const visibleResult = normalizedCalculationStatus === "completed" ? result : null;
  const canExport = Boolean(hasSelectedAircraft && normalizedCalculationStatus === "completed" && hasCompletedResult);
  const calculateDisabled = isCalculating || !hasSelectedAircraft;
  return `
    <div class="rms-allocation-workbench" aria-busy="${isCalculating ? "true" : "false"}">
      <div class="section-head section-context">
        <span>装备 RMS 指标分配 / 导入安装数</span>
        <span>${htmlEscape(project.name)}${result?.algorithmVersion ? ` / ${htmlEscape(result.algorithmVersion)}` : ""}</span>
      </div>

      <section class="rms-aircraft-input-panel">
        <div class="section-head"><h3>飞机型号与 RMS 输入</h3><span>按当前项目机型分别保存</span></div>
        <div class="rms-aircraft-input-grid">
          <label>飞机型号
            <select data-rms-aircraft-model ${hasAircraftModels ? "" : "disabled"}>
              <option value="">请选择飞机型号</option>
              ${aircraftModels.map((model) => `<option value="${htmlEscape(model)}" ${model === selectedAircraftModel ? "selected" : ""}>${htmlEscape(model)}</option>`).join("")}
            </select>
          </label>
          ${input("任务可靠度", "inputs.missionReliability", plan.inputs?.missionReliability ?? "", "number", "0.01", htmlEscape, "0", "1", "", !hasSelectedAircraft)}
          ${input("任务时长", "inputs.missionHours", plan.inputs?.missionHours ?? "", "number", "0.1", htmlEscape, "0", "", "h", !hasSelectedAircraft)}
          ${input("MTBF", "inputs.mtbfHours", plan.inputs?.mtbfHours ?? "", "number", "0.1", htmlEscape, "0", "", "h", !hasSelectedAircraft)}
          ${input("MTTR", "inputs.mttrHours", plan.inputs?.mttrHours ?? "", "number", "0.1", htmlEscape, "0", "", "h", !hasSelectedAircraft)}
        </div>
        <div class="rms-input-message" role="status" aria-live="polite">
          ${validationMessage
            ? htmlEscape(validationMessage)
            : (!hasAircraftModels
              ? "当前项目暂无飞机型号，请先完成装备系统建模。"
              : (!hasSelectedAircraft ? "请先选择飞机型号。" : (!hasEquipmentTree ? "当前机型暂无装备结构，请先完成装备系统建模。" : "")))}
        </div>
      </section>

      ${hasSelectedAircraft ? `<section class="organization-layout equipment-layout rms-layout">
        <aside class="tree-container rms-equipment-tree">
          <div class="tree-toolbar equipment-tree-toolbar">
            <h4>装备结构树</h4>
            <span>当前项目 / ${htmlEscape(selectedAircraftModel)}</span>
          </div>
          ${renderEquipmentTree(project, visibleResult, selectedEquipmentNodeId, htmlEscape)}
        </aside>
        <section class="detail-panel equipment-system-table-panel rms-installation-panel">
          <div class="detail-card">
            <div class="section-head"><h3>导入安装数</h3><span>${calculationStatusLabel(normalizedCalculationStatus)}</span></div>
          <div class="equipment-import-row rms-installation-import-row">
            <button type="button" class="rms-import-button" data-rms-action="download-template">下载模板</button>
            <label class="rms-file-button rms-import-button">上传文件<input data-rms-equipment-import-file type="file" accept=".csv,.json,application/json,text/csv"></label>
            <p class="rms-import-status">${htmlEscape(importStatus || "当前安装数为 RMS 分配工作台独立数据。")}</p>
          </div>
          ${renderInstallationTable(project, selectedEquipmentNodeId, htmlEscape)}
          </div>
        </section>
      </section>` : ""}

      <section class="rms-method-panel">
          <div class="section-head"><h3>计算方法</h3><span class="rms-calculation-status ${normalizedCalculationStatus}" data-rms-calculation-status="${normalizedCalculationStatus}" role="status" aria-live="polite">${calculationStatusLabel(normalizedCalculationStatus)}</span></div>
          <div class="rms-method-grid">
            <label>指标分配方法
              <select data-rms-path="methods.allocation">
                ${RELIABILITY_METHODS.map(([value, label]) => `<option value="${value}" ${plan.methods.allocation === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            ${renderMethodParameters(plan, equipmentRoots, project.rootId, htmlEscape)}
          </div>
          <div class="rms-method-actions">
            <button type="button" class="btn-primary" data-rms-action="calculate"${calculateDisabled ? " disabled" : ""}>${isCalculating ? "计算进行中" : "计算"}</button>
          </div>
          <div class="rms-warning-list">
            ${isCalculating
              ? "<span>计算进行中，请勿重复提交。</span>"
              : (result?.warnings?.length
              ? result.warnings.map((warning) => `<span>${result.status === "calculated" ? "" : "计算失败："}${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
              : (normalizedCalculationStatus === "completed" ? "<span>计算完成。</span>" : "<span>尚未执行计算，输入、方法或装备节点变化后需重新计算。</span>"))}
          </div>
      </section>

      <section class="analysis-chart-panel rms-result-panel">
        <div class="section-head"><h3>节点分配结果</h3><button type="button" data-rms-action="export-excel"${canExport ? "" : " disabled"}>导出 Excel</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>层级</th><th>节点</th><th>型号</th><th>安装数</th><th>运行比</th><th>分配份额</th><th>状态</th></tr></thead>
            <tbody>${visibleResult?.nodeResults?.length ? visibleResult.nodeResults.map((row) => `
              <tr>
                <td>${htmlEscape(row.level)}</td>
                <td>${htmlEscape(row.nodeName)}</td>
                <td>${htmlEscape(row.model || "-")}</td>
                <td>${row.installationCount}</td>
                <td>${compactNumber(row.runningRatio)}</td>
                <td>${pct(row.allocationShare)}</td>
                <td>${htmlEscape(row.status)}</td>
              </tr>
            `).join("") : '<tr><td colspan="7">当前飞机型号暂无计算结果。</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      ${isCalculating ? '<div class="rms-calculation-overlay" role="status" aria-live="assertive"><span>计算进行中</span></div>' : ""}
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
  const rootNodes = project.equipmentNodes.filter((node) => !node.parentId && node.id === project.rootId);
  const childNodesByParent = project.equipmentNodes.reduce((acc, node) => {
    if (node.parentId) {
      acc[node.parentId] ||= [];
      acc[node.parentId].push(node);
    }
    return acc;
  }, {});
  const renderChildren = (parentId) => (childNodesByParent[parentId] || []).map((node) => {
    const row = result?.nodeResults?.find((item) => item.nodeId === node.id);
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

function input(label, path, value, type, step, htmlEscape, min = "", max = "", unit = "", disabled = false) {
  const stepAttribute = type === "number" && step ? ` step="${htmlEscape(step)}"` : "";
  const minAttribute = min !== "" ? ` min="${htmlEscape(min)}"` : "";
  const maxAttribute = max !== "" ? ` max="${htmlEscape(max)}"` : "";
  return `<label>${label}${unit ? ` (${unit})` : ""}<input data-rms-path="${path}" type="${type}"${stepAttribute}${minAttribute}${maxAttribute} required value="${htmlEscape(value)}"${disabled ? " disabled" : ""}></label>`;
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

function calculationStatusLabel(status) {
  if (status === "calculating") return "计算进行中";
  if (status === "completed") return "计算完成";
  return "未计算";
}

function compactNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}
