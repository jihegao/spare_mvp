const RELIABILITY_METHODS = [
  ["equal", "等分配法"],
  ["proportional", "比例分配法"],
  ["agree", "AGREE 分配法"],
  ["scoring", "评分分配法"]
];

export function renderRmsAllocationWorkbench({ project, plan, result, publishedProject, htmlEscape, fixed, pct }) {
  const publishedCount = publishedProject
    ? publishedProject.equipmentNodes.filter((node) => node.rms?.target?.allocationPlanId === result.planId).length
    : 0;
  return `
    <div class="rms-allocation-workbench">
      <section class="rms-plan-bar">
        <div>
          <span class="eyebrow">可靠性分配 / RMS 分配</span>
          <h3>${htmlEscape(plan.name)}</h3>
          <p>${htmlEscape(project.name)} / ${htmlEscape(project.missionProfile.name)} / ${result.algorithmVersion}</p>
        </div>
        <div class="rms-actions">
          <button type="button" data-rms-action="save-draft">保存草稿</button>
          <button type="button" class="btn-primary" data-rms-action="calculate">计算分配</button>
          <button type="button" data-rms-action="verify">自底向上校核</button>
          <button type="button" data-rms-action="publish">发布到装备模型</button>
        </div>
      </section>

      <section class="rms-layout">
        <div class="rms-equipment-tree">
          <div class="section-head"><h3>装备组成树</h3><span>模拟输入</span></div>
          ${renderEquipmentTree(project, result, htmlEscape)}
        </div>
        <div class="rms-input-panel">
          <div class="section-head"><h3>指标输入与方法设置</h3><span>页面可调</span></div>
          <div class="rms-input-grid">
            ${input("装备级任务可靠度 R(T)", "targets.reliability.value", plan.targets.reliability.value, "number", "0.001", htmlEscape)}
            ${input("任务时间 T(h)", "targets.reliability.atHours", plan.targets.reliability.atHours, "number", "0.1", htmlEscape)}
            ${input("装备级 MTBF(h)", "targets.mtbfHours", plan.targets.mtbfHours, "number", "1", htmlEscape)}
            ${input("维修性 M(t)", "targets.maintainability.value", plan.targets.maintainability.value, "number", "0.001", htmlEscape)}
            ${input("MTTR 目标(h)", "targets.mttrHours", plan.targets.mttrHours, "number", "0.1", htmlEscape)}
            ${input("保障性 S(t)", "targets.supportability.value", plan.targets.supportability.value, "number", "0.001", htmlEscape)}
            ${input("MLDT 目标(h)", "targets.mldtHours", plan.targets.mldtHours, "number", "0.1", htmlEscape)}
            ${input("固有可用度目标", "targets.inherentAvailability", plan.targets.inherentAvailability, "number", "0.001", htmlEscape)}
            ${input("使用可用度目标", "targets.operationalAvailability", plan.targets.operationalAvailability, "number", "0.001", htmlEscape)}
            <label>可靠性分配方法
              <select data-rms-path="methods.reliability">
                ${RELIABILITY_METHODS.map(([value, label]) => `<option value="${value}" ${plan.methods.reliability === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
        <div class="rms-verification-panel">
          <div class="section-head"><h3>校核与摘要</h3><span>${statusLabel(result.status)}</span></div>
          <div class="rms-verification-metrics">
            ${metric("目标 R", fixed(result.verification.equipmentTarget.reliability, 3))}
            ${metric("反算 R", fixed(result.verification.calculated.reliability, 3))}
            ${metric("MTTR 裕度", `${fixed(result.verification.margin.mttrHours, 2)} h`)}
            ${metric("MLDT 裕度", `${fixed(result.verification.margin.mldtHours, 2)} h`)}
          </div>
          <div class="rms-warning-list">
            ${result.warnings.length
              ? result.warnings.map((warning) => `<span>${htmlEscape(warning.code)}：${htmlEscape(warning.message)}</span>`).join("")
              : "<span>校核通过，未发现不可行原因。</span>"}
            ${publishedCount ? `<span>已发布 ${publishedCount} 个节点 target，prediction / actual 保持不变。</span>` : ""}
          </div>
        </div>
      </section>

      <section class="analysis-chart-panel">
        <div class="section-head"><h3>节点级分配结果</h3><span>系统级 / LRU 级 RMS target</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>层级</th><th>节点</th><th>结构</th><th>暴露时间</th><th>R目标</th><th>失效率</th><th>MTBF</th><th>MTTR</th><th>MLDT</th><th>Ai</th><th>Ao</th><th>状态</th></tr></thead>
            <tbody>${result.nodeResults.map((row) => `
              <tr>
                <td>${htmlEscape(row.level)}</td>
                <td>${htmlEscape(row.nodeName)}</td>
                <td>${htmlEscape(row.structure)}</td>
                <td>${fixed(row.equivalentHours, 2)} h</td>
                <td>${fixed(row.reliability, 4)}</td>
                <td>${fixed(row.failureRate, 5)}</td>
                <td>${fixed(row.mtbfHours, 1)} h</td>
                <td>${fixed(row.mttrHours, 2)} h</td>
                <td>${fixed(row.mldtHours, 2)} h</td>
                <td>${pct(row.inherentAvailability)}</td>
                <td>${pct(row.operationalAvailability)}</td>
                <td><span class="status-badge ${row.status === "风险" ? "warn" : "success"}">${row.status}</span></td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="rms-bottom-grid">
        <div class="analysis-chart-panel">
          <div class="section-head"><h3>任务暴露矩阵</h3><span>任务剖面编译</span></div>
          <div class="table-wrap compact">
            <table>
              <thead><tr><th>节点</th><th>阶段</th><th>时长</th><th>占空比</th><th>环境</th><th>载荷</th><th>等效暴露</th></tr></thead>
              <tbody>${result.exposure.rows.map((row) => `
                <tr><td>${htmlEscape(row.nodeName)}</td><td>${htmlEscape(row.missionPhaseName)}</td><td>${fixed(row.durationHours, 2)}</td><td>${fixed(row.dutyCycle, 2)}</td><td>${fixed(row.environmentFactor, 2)}</td><td>${fixed(row.loadFactor, 2)}</td><td>${fixed(row.equivalentHours, 2)} h</td></tr>
              `).join("")}</tbody>
            </table>
          </div>
        </div>
        <div class="analysis-chart-panel">
          <div class="section-head"><h3>敏感度与假设</h3><span>关键 LRU 排名</span></div>
          <div class="rank-list">
            ${[...result.nodeResults].sort((a, b) => b.riskBudget - a.riskBudget).map((row) => `
              <div class="rank-row"><strong>${htmlEscape(row.nodeName)}</strong><span>风险预算 ${fixed(row.riskBudget, 4)}</span><span>权重 ${pct(row.riskWeight)}</span><span>${row.status}</span></div>
            `).join("")}
          </div>
          <div class="rms-warning-list">
            ${result.assumptions.map((item) => `<span>${htmlEscape(item)}</span>`).join("")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderEquipmentTree(project, result, htmlEscape) {
  const children = project.equipmentNodes.filter((node) => node.parentId === project.rootId);
  return `
    <ul>
      <li><strong>${htmlEscape(project.equipmentNodes.find((node) => node.id === project.rootId)?.name || "整机")}</strong><span>装备</span></li>
      ${children.map((node) => {
        const row = result.nodeResults.find((item) => item.nodeId === node.id);
        return `<li><strong>${htmlEscape(node.name)}</strong><span>${htmlEscape(node.level)} / ${fixedOrDash(row?.equivalentHours)}h</span></li>`;
      }).join("")}
    </ul>
  `;
}

function input(label, path, value, type, step, htmlEscape) {
  return `<label>${label}<input data-rms-path="${path}" type="${type}" step="${step}" value="${htmlEscape(value)}"></label>`;
}

function metric(label, value) {
  return `<div class="kpi-card"><span>${label}</span><strong>${value}</strong></div>`;
}

function statusLabel(status) {
  return status === "validated" ? "已校核" : "已计算";
}

function fixedOrDash(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "-";
}
