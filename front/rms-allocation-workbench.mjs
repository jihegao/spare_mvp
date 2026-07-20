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
  saveStatus = "",
  htmlEscape,
  fixed,
  pct
}) {
  const equipmentRoots = project.equipmentNodes.filter((node) => !node.parentId);
  const hasAircraftModels = aircraftModels.length > 0;
  const hasSelectedAircraft = aircraftModels.includes(selectedAircraftModel);
  const basicMissions = rmsBasicMissions(project, selectedAircraftModel);
  const selectedBasicMission = basicMissions.find((mission) => mission.id === plan.inputs?.basicMissionId);
  const selectedRoot = equipmentRoots.find((node) => node.id === project.rootId);
  const hasEquipmentTree = Boolean(selectedRoot && project.equipmentNodes.some((node) => node.parentId === selectedRoot.id));
  const hasCompletedResult = result?.status === "calculated" && result.nodeResults?.length > 0;
  const normalizedCalculationStatus = calculationStatus === "calculating"
    ? "calculating"
    : ((calculationStatus === "completed" || !calculationStatus) && hasCompletedResult ? "completed" : "not-calculated");
  const isCalculating = normalizedCalculationStatus === "calculating";
  const visibleResult = normalizedCalculationStatus === "completed" ? result : null;
  const canExport = Boolean(hasSelectedAircraft && normalizedCalculationStatus === "completed" && hasCompletedResult);
  const calculateDisabled = isCalculating || !hasSelectedAircraft || !selectedBasicMission;
  return `
    <div class="rms-allocation-workbench" aria-busy="${isCalculating ? "true" : "false"}">
      <div class="section-head section-context">
        <span>装备 RMS 指标分配 / 基本任务</span>
        <span>${htmlEscape(project.name)}${result?.algorithmVersion ? ` / ${htmlEscape(result.algorithmVersion)}` : ""}</span>
      </div>

      <section class="rms-aircraft-input-panel rms-data-preparation-panel" aria-labelledby="rms-data-preparation-title">
        <div class="section-head"><h3 id="rms-data-preparation-title">机型选择与数据准备</h3><span>按当前项目机型分别保存</span></div>
        <div class="rms-data-preparation-grid">
          <label class="rms-aircraft-selector">飞机型号
            <select data-rms-aircraft-model ${hasAircraftModels ? "" : "disabled"}>
              <option value="">请选择飞机型号</option>
              ${aircraftModels.map((model) => `<option value="${htmlEscape(model)}" ${model === selectedAircraftModel ? "selected" : ""}>${htmlEscape(model)}</option>`).join("")}
            </select>
          </label>
          <div class="rms-data-preparation-actions" role="group" aria-label="RMS 安装数数据操作">
            <span class="rms-data-action-label">装备组成/安装数</span>
            <button type="button" class="rms-import-button" data-rms-action="download-template">下载模板</button>
            <label class="rms-file-button rms-import-button${hasSelectedAircraft ? "" : " disabled"}" ${hasSelectedAircraft ? "" : 'aria-disabled="true"'}>上传文件<input data-rms-equipment-import-file type="file" accept=".csv,.json,application/json,text/csv" ${hasSelectedAircraft ? "" : "disabled"}></label>
          </div>
        </div>
        <div class="rms-input-message" role="status" aria-live="polite">${!hasAircraftModels
          ? "当前项目暂无飞机型号，请先完成装备系统建模。"
          : (!hasSelectedAircraft ? "请先选择飞机型号。" : (!hasEquipmentTree ? "当前机型暂无装备结构，请先完成装备系统建模。" : ""))}</div>
        ${importStatus ? `<p class="rms-import-status" role="status" aria-live="polite">${htmlEscape(importStatus)}</p>` : ""}
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
            ${renderInstallationTable(project, selectedEquipmentNodeId, htmlEscape)}
          </div>
        </section>
      </section>` : ""}

      <section class="rms-method-panel rms-calculation-panel" aria-labelledby="rms-calculation-panel-title">
          <div class="section-head"><h3 id="rms-calculation-panel-title">RMS 输入与指标分配计算</h3><span class="rms-calculation-status ${normalizedCalculationStatus}" data-rms-calculation-status="${normalizedCalculationStatus}" role="status" aria-live="polite">${calculationStatusLabel(normalizedCalculationStatus)}</span></div>
          <div class="rms-calculation-flow">
            <div class="rms-calculation-step rms-input-step" role="group" aria-labelledby="rms-input-step-title">
              <h4 id="rms-input-step-title"><span aria-hidden="true">1</span>RMS 输入参数</h4>
              <div class="rms-calculation-input-grid">
                <label>基本任务
                  <select data-rms-basic-mission ${hasSelectedAircraft ? "" : "disabled"}>
                    <option value="">请选择基本任务</option>
                    ${basicMissions.map((mission) => `<option value="${htmlEscape(mission.id)}" ${mission.id === plan.inputs?.basicMissionId ? "selected" : ""}>${htmlEscape(mission.name)}（${htmlEscape(mission.id)}）</option>`).join("")}
                  </select>
                </label>
                ${input("任务时长", "basicMission.missionHours", selectedBasicMission?.missionHours ?? "", "number", "0.01", htmlEscape, "0", "", "h", true)}
                ${input("整机任务可靠度 R(T)", "inputs.missionReliability", plan.inputs?.missionReliability ?? "", "number", "0.0001", htmlEscape, "0", "1", "", !hasSelectedAircraft)}
                ${input("MTTR", "inputs.mttrHours", plan.inputs?.mttrHours ?? "", "number", "0.1", htmlEscape, "0", "", "h", !hasSelectedAircraft)}
              </div>
              <div class="rms-input-message" role="status">${selectedBasicMission
                ? `任务编号：${htmlEscape(selectedBasicMission.id)}；适用装备：${htmlEscape(selectedBasicMission.equipmentType || "通用")}；任务时长由基本任务只读取得。`
                : (hasSelectedAircraft ? "请选择适用于当前机型的基本任务。" : "")}</div>
              ${validationMessage ? `<div class="rms-input-message" role="alert">${htmlEscape(validationMessage)}</div>` : ""}
            </div>
            <div class="rms-calculation-step rms-method-step" role="group" aria-labelledby="rms-method-step-title">
              <h4 id="rms-method-step-title"><span aria-hidden="true">2</span>指标分配方法</h4>
              <div class="rms-method-grid">
                <label>指标分配方法
                  <select data-rms-path="methods.allocation">
                    ${RELIABILITY_METHODS.map(([value, label]) => `<option value="${value}" ${plan.methods.allocation === value ? "selected" : ""}>${label}</option>`).join("")}
                  </select>
                </label>
                ${renderMethodParameters(plan, equipmentRoots, project.rootId, htmlEscape)}
              </div>
            </div>
            <div class="rms-calculation-step rms-execution-step" role="group" aria-labelledby="rms-execution-step-title">
              <h4 id="rms-execution-step-title"><span aria-hidden="true">3</span>执行计算</h4>
              <div class="rms-method-actions">
                <button type="button" class="btn-primary" data-rms-action="calculate"${calculateDisabled ? " disabled" : ""}>${isCalculating ? "计算进行中" : "计算"}</button>
              </div>
              <div class="rms-warning-list" role="status" aria-live="polite">
                ${isCalculating
                  ? "<span>计算进行中，请勿重复提交。</span>"
                  : (result?.warnings?.length
                  ? result.warnings.map((warning) => `<span>${result.status === "calculated" ? "" : "计算失败："}${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
                  : (normalizedCalculationStatus === "completed" ? "<span>计算完成。</span>" : "<span>尚未执行计算，输入、方法或装备节点变化后需重新计算。</span>"))}
              </div>
            </div>
          </div>
      </section>

      <section class="analysis-chart-panel rms-result-panel">
        <div class="section-head"><h3>节点分配结果</h3><div class="rms-method-actions">
          <label class="rms-file-button${hasSelectedAircraft && selectedBasicMission ? "" : " disabled"}" ${hasSelectedAircraft && selectedBasicMission ? "" : 'aria-disabled="true"'}>导入分解结果<input data-rms-result-import-file type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ${hasSelectedAircraft && selectedBasicMission ? "" : "disabled"}></label>
          <button type="button" data-rms-action="save-result"${canExport ? "" : " disabled"}>保存分解结果</button>
          <button type="button" data-rms-action="export-excel"${canExport ? "" : " disabled"}>导出 Excel</button>
        </div></div>
        ${saveStatus ? `<p class="rms-import-status" role="status" aria-live="polite">${htmlEscape(saveStatus)}</p>` : ""}
        <div class="table-wrap">
          <table>
            <thead><tr><th>层级</th><th>节点</th><th>运行比</th><th>本层份额</th><th>失效率</th><th>MTBF(h)</th><th>MTTR(h)</th><th>校核</th></tr></thead>
            <tbody>${visibleResult?.nodeResults?.length ? visibleResult.nodeResults.map((row) => `
              <tr>
                <td>${htmlEscape(row.level)}</td>
                <td>${htmlEscape(row.nodeName)}</td>
                <td>${compactNumber(row.runningRatio)}</td>
                <td>${compactNumber(row.localAllocationShare ?? row.allocationShare, 6)}</td>
                <td>${compactNumber(row.failureRate, 8)}</td>
                <td>${row.mtbfHours == null ? "-" : `<input aria-label="${htmlEscape(row.nodeName)} MTBF" data-rms-result-field="mtbfHours" data-rms-result-node-id="${htmlEscape(row.nodeId)}" type="number" min="0" step="0.01" value="${htmlEscape(compactNumber(row.mtbfHours, 6))}">`}</td>
                <td>${row.mttrHours == null ? "-" : `<input aria-label="${htmlEscape(row.nodeName)} MTTR" data-rms-result-field="mttrHours" data-rms-result-node-id="${htmlEscape(row.nodeId)}" type="number" min="0" step="0.01" value="${htmlEscape(compactNumber(row.mttrHours, 6))}">`}</td>
                <td>${htmlEscape(row.verificationStatus || row.status || "-")}</td>
              </tr>
            `).join("") : '<tr><td colspan="8">当前飞机型号暂无计算结果。</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      ${isCalculating ? '<div class="rms-calculation-overlay" role="status" aria-live="assertive"><span>计算进行中</span></div>' : ""}
    </div>
  `;
}

function rmsBasicMissions(project, aircraftModel) {
  return (Array.isArray(project?.basicMissions) ? project.basicMissions : [])
    .map((mission, index) => {
      const id = String(mission?.id || mission?.missionId || "").trim();
      const equipmentType = String(mission?.aircraftModel || mission?.equipmentType || "").trim();
      const minutes = Number(mission?.taskDurationMinutes);
      return {
        id,
        name: String(mission?.name || mission?.missionName || id || `基本任务${index + 1}`).trim(),
        equipmentType,
        missionHours: Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : null
      };
    })
    .filter((mission) => mission.id && mission.missionHours && (!mission.equipmentType || mission.equipmentType === aircraftModel));
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
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}
