const APP_CONFIG = {
	systemName: "备件规划及任务可靠度验证评估平台",
	version: "V1.0",
	project: "601 备件评估演示项目"
};

const {
	MODELING_CONTEXT_ITEMS,
	MODELING_FUTURE_FIELDS,
	MODELING_SCOPE
} = globalThis.MODELING_CONTRACT;

const MODULES = [
	{
		id: "spare-planning",
		code: "BJ",
		title: "备件规划评估模块",
		desc: "围绕任务、装备、保障资源和备件约束，完成建模、实验、短板识别和携行建议。",
		pages: [
			{ id: "modeling", code: "JM", title: "备件规划仿真建模", desc: "维护任务、装备、保障组织、备件和保障活动的最小建模数据。", route: "#/spare-planning/modeling" },
			{ id: "experiment", code: "SY", title: "备件规划仿真实验", desc: "创建备件规划实验方案，启动可视化推演和小样本蒙特卡洛实验。", route: "#/spare-planning/experiment" },
			{ id: "shortfall", code: "DB", title: "备件短板分析", desc: "分析备件满足率、延误时间与不满足次数，定位影响任务保障的关键短板。", route: "#/spare-planning/shortfall" },
			{ id: "carry-list", code: "ZX", title: "转场携行清单分析", desc: "按优化条件和备件约束生成转场携行数量与保障优先级建议。", route: "#/spare-planning/carry-list" }
		]
	},
	{
		id: "mission-reliability",
		code: "RW",
		title: "任务可靠度评估模块",
		desc: "面向多波次任务执行，完成可靠度建模、实验运行、任务完成概率评估和停机归因。",
		pages: [
			{ id: "modeling", code: "JM", title: "任务可靠度仿真建模", desc: "维护任务剖面、装备故障、可靠性框图和指标分配的最小建模数据。", route: "#/mission-reliability/modeling" },
			{ id: "experiment", code: "SY", title: "任务可靠度仿真实验", desc: "创建任务可靠度实验方案，启动可视化推演和小样本蒙特卡洛实验。", route: "#/mission-reliability/experiment" },
			{ id: "completion", code: "WC", title: "任务完成度评估", desc: "跟踪多波次任务成功概率变化，评估当前保障方案对任务完成度的支撑能力。", route: "#/mission-reliability/completion" },
			{ id: "downtime", code: "TJ", title: "停机因素分析", desc: "从不可用飞机、维修状态、备件与保障设备满足率等维度定位停机主因。", route: "#/mission-reliability/downtime" }
		]
	},
	{
		id: "system-support",
		code: "XT",
		title: "系统运行支持模块",
		desc: "面向长周期大样本运行优化，提供运行状态、日志、样本统计和结果产物检查入口。",
		pages: [
			{ id: "run-management", code: "YX", title: "运行管理和产物检查", desc: "检查运行目录、固定种子、错误记录、样本统计和结果 JSON 产物。", route: "#/system-support/run-management" }
		]
	}
];

const EXPERIMENT_SCOPE = [
	{ name: "仿真实验方案管理", detail: "创建、编辑实验方案，保存固定种子和样本参数", status: "可评审" },
	{ name: "可视化推演", detail: "可视化实验启动与停止、场景切换、关键事件时间线", status: "可评审" },
	{ name: "蒙特卡洛实验", detail: "小样本批量运行配置、样本状态记录、失败样本日志", status: "可评审" },
	{ name: "结果分析", detail: "蒙特卡洛实验结果展示入口与结果产物链接", status: "待接后端" }
];

const SYSTEM_SUPPORT_ITEMS = [
	{ name: "长周期大样本运行优化", value: "最小批量约束 20 样本", detail: "当前页面只展示运行约束和样本统计，不承诺真实大规模调度。" },
	{ name: "运行目录", value: "runs/demo-601/latest", detail: "保留输入规格、运行配置、日志、结果 JSON 和指标汇总位置。" },
	{ name: "固定种子", value: "20260612", detail: "用于后续联调时复现实验产物。" },
	{ name: "错误记录", value: "0 条阻断", detail: "展示运行异常、失败样本和产物缺失的检查入口。" }
];

const SPARE_SHORTFALL_ROWS = [
	{ name: "P1", satisfy: 0.5, delay: 24, baseCount: 1, stock: 1, shortage: 1, level: "关注" },
	{ name: "P2", satisfy: 0.33, delay: 4, baseCount: 1, stock: 1, shortage: 2, level: "短缺" },
	{ name: "P3", satisfy: 0, delay: 96, baseCount: 0, stock: 0, shortage: 1, level: "严重" }
];

const CARRY_LIST_ROWS = [
	{ name: "P1", satisfy: 0.5, delay: 24, qty: { "80": 1, "85": 2, "90": 2, "100": 4 } },
	{ name: "P2", satisfy: 0.33, delay: 4, qty: { "80": 1, "85": 1, "90": 1, "100": 3 } },
	{ name: "P3", satisfy: 0, delay: 96, qty: { "80": 0, "85": 0, "90": 0, "100": 2 } },
	{ name: "P4", satisfy: 0.5, delay: 24, qty: { "80": 0, "85": 0, "90": 1, "100": 2 } },
	{ name: "P5", satisfy: 0.33, delay: 4, qty: { "80": 1, "85": 1, "90": 1, "100": 2 } },
	{ name: "P6", satisfy: 1, delay: 96, qty: { "80": 0, "85": 0, "90": 0, "100": 1 } },
	{ name: "P7", satisfy: 0.5, delay: 24, qty: { "80": 0, "85": 0, "90": 1, "100": 2 } },
	{ name: "P8", satisfy: 0.33, delay: 4, qty: { "80": 1, "85": 1, "90": 1, "100": 2 } },
	{ name: "P9", satisfy: 0, delay: 96, qty: { "80": 0, "85": 0, "90": 1, "100": 2 } }
];

const CARRY_OBJECTIVES = [
	{ id: "availability", label: "使用可用度", metricLabel: "预计使用可用度", metricValue: "0.91" },
	{ id: "sortie-rate", label: "出动架次率", metricLabel: "预计出动架次率", metricValue: "86%" },
	{ id: "turnaround-time", label: "再次出动准备时间", metricLabel: "预计准备时间", metricValue: "42 min" }
];

const CARRY_THRESHOLD_OPTIONS = ["80", "85", "90", "100"];

const COMPLETION_ROWS = [
	{ wave: 1, probability: 0.99, sorties: 12, available: 10, note: "满足" },
	{ wave: 2, probability: 0.96, sorties: 24, available: 9, note: "满足" },
	{ wave: 3, probability: 0.956, sorties: 36, available: 9, note: "满足" },
	{ wave: 4, probability: 0.94, sorties: 48, available: 8, note: "关注" },
	{ wave: 5, probability: 0.924, sorties: 60, available: 8, note: "关注" },
	{ wave: 6, probability: 0.908, sorties: 72, available: 7, note: "关注" },
	{ wave: 7, probability: 0.892, sorties: 84, available: 7, note: "风险" },
	{ wave: 8, probability: 0.876, sorties: 96, available: 6, note: "风险" },
	{ wave: 9, probability: 0.86, sorties: 108, available: 6, note: "风险" }
];

const DOWNTIME_FACTORS = {
	primary: [
		{ name: "无可用飞机", value: 4 },
		{ name: "飞机故障", value: 5 }
	],
	secondary: [
		{ name: "全部飞机处于任务状态", value: 1 },
		{ name: "飞机处于故障维修状态", value: 2 },
		{ name: "飞机处于预防性维修状态", value: 2 },
		{ name: "飞机处于使用保障状态", value: 1 },
		{ name: "P1", value: 1 },
		{ name: "P3", value: 2 },
		{ name: "P4", value: 2 }
	],
	metrics: [
		{ name: "飞机平均预防性维修间隔期", value: "14.5" },
		{ name: "飞机平均预防性维修时间", value: "8.4" },
		{ name: "飞机平均故障间隔时间", value: "7.5" },
		{ name: "飞机平均故障维修时间", value: "1.5" },
		{ name: "保障设备满足率", value: "0.90" },
		{ name: "备件满足率", value: "0.95" }
	]
};

const state = {
	carryReliability: "90",
	carrySatisfyRate: "90",
	carryUtilizationRate: "80",
	carryObjective: "availability",
	lastRun: {}
};

function getPageKey(page) {
	return `${page.moduleId}:${page.id}`;
}

function htmlEscape(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function thresholdLabel(value) {
	return `＞${value}%`;
}

function setCarryThreshold(key, value) {
	if (!["carryReliability", "carrySatisfyRate", "carryUtilizationRate"].includes(key)) return false;
	if (!CARRY_THRESHOLD_OPTIONS.includes(value)) return false;
	state[key] = value;
	return true;
}

function renderWheelPicker({ key, label, value }) {
	const selectedIndex = Math.max(0, CARRY_THRESHOLD_OPTIONS.indexOf(value));
	return `
		<div class="wheel-picker" data-wheel-key="${htmlEscape(key)}" aria-label="${htmlEscape(label)}">
			<label>${htmlEscape(label)}</label>
			<div class="wheel-window">
				<div class="wheel-options" style="--wheel-offset: ${40 - selectedIndex * 40}px">
					${CARRY_THRESHOLD_OPTIONS.map(
						(option) => `
						<button type="button" class="wheel-option ${option === value ? "active" : ""}" data-action="set-wheel-value" data-wheel-key="${htmlEscape(key)}" data-value="${htmlEscape(option)}">
							${thresholdLabel(option)}
						</button>`
					).join("")}
				</div>
			</div>
		</div>
	`;
}

function getAllPages() {
	return MODULES.flatMap((module) => module.pages.map((page) => ({ ...page, moduleId: module.id })));
}

function getRoutePage() {
	const hash = window.location.hash || "";
	const match = hash.match(/^#\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	const moduleId = match[1];
	const pageId = match[2];
	return getAllPages().find((page) => page.moduleId === moduleId && page.id === pageId) || null;
}

function getModule(moduleId) {
	return MODULES.find((module) => module.id === moduleId) || MODULES[0];
}

function formatTime(date) {
	return date.toLocaleString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	});
}

function renderLayout(content, page) {
	const module = page ? getModule(page.moduleId) : null;
	const context = page
		? `<span class="topbar-static">模块：${htmlEscape(module.title)}</span>`
		: `<span class="topbar-static">项目：${htmlEscape(APP_CONFIG.project)}</span>`;

	return `
		<div class="layout">
			<header class="topbar">
				<div class="left">
					<div class="brand"><span class="brand-mark">BJ</span>${htmlEscape(APP_CONFIG.systemName)} ${htmlEscape(APP_CONFIG.version)}</div>
				</div>
				<div class="right">
					${context}
					<div class="user-avatar" title="演示账号">U</div>
				</div>
			</header>
			<div class="main">
				<main class="content">${content}</main>
			</div>
		</div>
	`;
}

function renderHomePage() {
	const gallery = [
		{ src: "image/screenshots/spare-shortfall.png", alt: "备件短板分析参考图" },
		{ src: "image/screenshots/carry-list.png", alt: "转场携行清单参考图" },
		{ src: "image/screenshots/mission-completion.png", alt: "任务完成度评估参考图" },
		{ src: "image/screenshots/downtime-factor.png", alt: "停机因素分析参考图" }
	];

	return `
		<div class="nav-page-layout">
			<div class="nav-left-gallery">
				${gallery.map((item) => `<div class="nav-gallery-card"><img src="${item.src}" alt="${htmlEscape(item.alt)}" /></div>`).join("")}
			</div>
			<div class="nav-right-panel">
				<div class="page-head nav-page-head">
					<h2>${htmlEscape(APP_CONFIG.systemName)}</h2>
					<p class="muted">按 CSCI 完整部件范围组织为备件规划评估、任务可靠度评估和系统运行支持三个模块。当前为静态前端评审页，覆盖建模、实验、结果分析和运行产物检查入口。</p>
				</div>
				<div class="nav-module-list">
					${MODULES.map(renderModuleRow).join("")}
				</div>
			</div>
		</div>
	`;
}

function renderModuleRow(module) {
	return `
		<section class="home-module-row">
			<div class="home-module-title"><span class="home-module-logo">${htmlEscape(module.code)}</span><span>${htmlEscape(module.title)}</span></div>
			<div class="home-module-content">
				<div class="entry-list">
					${module.pages
						.map(
							(page) => `
							<button class="entry-btn" data-nav="${htmlEscape(page.route)}">
								<span class="entry-name-row"><span class="entry-item-logo">${htmlEscape(page.code)}</span><span class="nav-entry-name">${htmlEscape(page.title)}</span></span>
							</button>`
						)
						.join("")}
				</div>
			</div>
		</section>
	`;
}

function renderAnalysisPage(page) {
	const module = getModule(page.moduleId);
	const pageKey = getPageKey(page);
	const lastRun = state.lastRun[pageKey];
	const hasConfig = ["modeling", "experiment", "carry-list", "run-management"].includes(page.id);
	return `
		<div class="page-head">
			<div class="page-head-left">
				<h2>${htmlEscape(page.title)}</h2>
				<span class="context-chip">${htmlEscape(module.title)}</span>
				<span class="context-chip">${htmlEscape(APP_CONFIG.project)}</span>
			</div>
			<div class="page-head-right-tools">
				${lastRun ? `<span class="run-note">最近启动：${htmlEscape(lastRun)}</span>` : ""}
				<button class="btn-link" data-nav="#/">返回导航</button>
			</div>
		</div>
		<div class="deck-modeling-layout analysis-layout-equal-height">
			<div class="card deck-modeling-nav">
				<div class="module-meta">
					<div class="module-meta-title"><span class="module-meta-code">${htmlEscape(module.code)}</span>${htmlEscape(module.title)}</div>
					<div class="muted">${htmlEscape(module.desc)}</div>
				</div>
				${module.pages
					.map(
						(item) => `
						<button class="deck-panel-tab ${item.id === page.id ? "active" : ""}" data-nav="${htmlEscape(item.route)}">
							${htmlEscape(item.title)}
						</button>`
					)
					.join("")}
			</div>
			<div class="deck-modeling-content">
				<div class="analysis-content-stack">
					<div class="card analysis-config-panel ${hasConfig ? "" : "analysis-config-panel-compact"}">
						<div class="analysis-section-head ${hasConfig ? "" : "analysis-section-head-only"}">
							${hasConfig ? "<h3>参数配置</h3>" : ""}
							<button class="btn-primary analysis-start-btn" data-action="start-analysis" data-page="${htmlEscape(pageKey)}">启动</button>
						</div>
						${hasConfig ? `<div class="analysis-config-scroll">${renderConfig(page)}</div>` : ""}
					</div>
					<div class="card analysis-result-panel">
						<h3>结果展示</h3>
						<div class="analysis-result-scroll">
							<div class="analysis-result-inner-scroll">
								${renderResults(page)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
}

function renderConfig(page) {
	if (page.id === "carry-list") return renderCarryListConfig();
	if (page.id === "modeling") return renderModelingConfig(page);
	if (page.id === "experiment") return renderExperimentConfig(page);
	if (page.id === "run-management") return renderSystemSupportConfig();
	return "";
}

function renderModelingConfig(page) {
	const rows = MODELING_SCOPE[page.moduleId] || [];
	const uniqueSheets = new Set(rows.flatMap((row) => row.sheets || []));
	const isMission = page.moduleId === "mission-reliability";
	return `
		<div class="modeling-contract-summary">
			<div class="modeling-summary-item">
				<span>数据源</span>
				<strong>core/dataset/data_new.json</strong>
			</div>
			<div class="modeling-summary-item">
				<span>建模域</span>
				<strong>${rows.length} 类</strong>
			</div>
			<div class="modeling-summary-item">
				<span>对齐 sheet</span>
				<strong>${uniqueSheets.size} 个</strong>
			</div>
			<div class="modeling-summary-item">
				<span>页面边界</span>
				<strong>场景/舰船/布列不进入建模表单</strong>
			</div>
		</div>
		<div class="modeling-boundary-panel">
			<div>
				<h4>${isMission ? "任务可靠度建模边界" : "备件规划建模边界"}</h4>
				<p class="muted">前端先按 JSON 工作簿 sheet 聚合任务、装备、保障资源、保障活动和实验指标字段。启动按钮仍为静态反馈，不代表已接入后端适配。</p>
			</div>
			<div class="sheet-chip-row">
				<span class="muted">历史工作簿/后续环境配置项</span>
				${MODELING_CONTEXT_ITEMS.map((sheet) => `<span class="sheet-chip muted-chip">${htmlEscape(sheet)}</span>`).join("")}
			</div>
		</div>
	`;
}

function renderExperimentConfig(page) {
	const label = page.moduleId === "mission-reliability" ? "任务可靠度实验方案" : "备件规划实验方案";
	return `
		<div class="form-grid">
			<div class="form-item">
				<label>实验方案</label>
				<input value="${label} A" readonly />
			</div>
			<div class="form-item">
				<label>样本数</label>
				<input value="20" readonly />
			</div>
			<div class="form-item">
				<label>随机种子</label>
				<input value="20260612" readonly />
			</div>
		</div>
		<div class="form-section">
			<h4>实验边界</h4>
			<p class="muted">本页覆盖实验方案创建/编辑、可视化推演、蒙特卡洛实验配置和蒙特卡洛结果展示入口。当前启动为模拟反馈，不代表真实仿真运行。</p>
		</div>
	`;
}

function renderSystemSupportConfig() {
	return `
		<div class="form-grid">
			<div class="form-item">
				<label>运行根目录</label>
				<input value="runs/demo-601/latest" readonly />
			</div>
			<div class="form-item">
				<label>运行模式</label>
				<input value="小样本批量评审" readonly />
			</div>
			<div class="form-item">
				<label>产物状态</label>
				<input value="静态示例，待后端写入" readonly />
			</div>
		</div>
	`;
}

function renderCarryListConfig() {
	const objective = CARRY_OBJECTIVES.find((item) => item.id === state.carryObjective) || CARRY_OBJECTIVES[0];
	return `
		<div class="form-grid carry-config-grid">
			<div class="form-item">
				<label>优化条件</label>
				<select data-action="set-carry-objective">
					${CARRY_OBJECTIVES.map((item) => `<option value="${htmlEscape(item.id)}" ${item.id === objective.id ? "selected" : ""}>${htmlEscape(item.label)}</option>`).join("")}
				</select>
			</div>
			${renderWheelPicker({ key: "carryReliability", label: "任务可靠度", value: state.carryReliability })}
			${renderWheelPicker({ key: "carrySatisfyRate", label: "备件满足率", value: state.carrySatisfyRate })}
			${renderWheelPicker({ key: "carryUtilizationRate", label: "备件利用率", value: state.carryUtilizationRate })}
		</div>
		<div class="form-section">
			<h4>约束条件</h4>
			<p class="muted">任务可靠度 ${thresholdLabel(state.carryReliability)}，备件满足率 ${thresholdLabel(state.carrySatisfyRate)}，备件利用率 ${thresholdLabel(state.carryUtilizationRate)}。</p>
		</div>
	`;
}

function renderResults(page) {
	if (page.id === "modeling") return renderModelingResults(page);
	if (page.id === "experiment") return renderExperimentResults(page);
	if (page.id === "shortfall") return renderShortfallResults();
	if (page.id === "carry-list") return renderCarryListResults();
	if (page.id === "completion") return renderCompletionResults();
	if (page.id === "run-management") return renderSystemSupportResults();
	return renderDowntimeResults();
}

function renderMetricGrid(items) {
	return `
		<div class="metric-grid">
			${items
				.map(
					(item) => `
					<div class="metric-card">
						<div class="metric-label">${htmlEscape(item.label)}</div>
						<div class="metric-value ${item.tone || ""}">${htmlEscape(item.value)}</div>
					</div>`
				)
				.join("")}
		</div>
	`;
}

function renderScopeCards(items) {
	return `
		<div class="scope-grid">
			${items.map((item) => `
				<div class="scope-card">
					<div class="scope-card-head">
						<h4>${htmlEscape(item.name)}</h4>
						<span class="status-badge ${item.status === "占位" ? "warn" : item.status === "待接后端" ? "warn" : "success"}">${htmlEscape(item.status)}</span>
					</div>
					<p class="muted">${htmlEscape(item.detail)}</p>
				</div>
			`).join("")}
		</div>
	`;
}

function renderSheetChips(sheets) {
	return `
		<div class="sheet-chip-row">
			${sheets.map((sheet) => `<span class="sheet-chip">${htmlEscape(sheet)}</span>`).join("")}
		</div>
	`;
}

function renderFieldChips(fields) {
	return `
		<div class="field-chip-row">
			${fields.map((field) => `<span class="field-chip">${htmlEscape(field)}</span>`).join("")}
		</div>
	`;
}

function renderFutureFieldChips(futureFields) {
	if (!futureFields?.length) return "";
	return `
		<div class="field-chip-row">
			<span>待补字段</span>
			${futureFields.map((field) => `<span class="field-chip muted-chip">${htmlEscape(field)}</span>`).join("")}
		</div>
	`;
}

function renderModelingDomainCards(rows) {
	return `
		<div class="modeling-domain-grid">
			${rows.map((row) => {
				const futureFields = row.futureFieldGroup ? MODELING_FUTURE_FIELDS[row.futureFieldGroup] : row.futureFields;
				return `
				<section class="modeling-domain-card">
					<div class="modeling-domain-head">
						<div>
							<h4>${htmlEscape(row.name)}</h4>
							<p class="muted">${htmlEscape(row.detail)}</p>
						</div>
						<span class="status-badge ${row.status === "待补父子关系" ? "warn" : "success"}">${htmlEscape(row.status)}</span>
					</div>
					${renderSheetChips(row.sheets || [])}
					${renderFieldChips(row.fields || [])}
					${renderFutureFieldChips(futureFields)}
					<div class="sample-row"><span>示例</span><strong>${htmlEscape(row.sample)}</strong></div>
				</section>
			`;
			}).join("")}
		</div>
	`;
}

function renderModelingResults(page) {
	const rows = MODELING_SCOPE[page.moduleId] || [];
	const isMission = page.moduleId === "mission-reliability";
	const uniqueSheets = new Set(rows.flatMap((row) => row.sheets || []));
	return `
		${renderMetricGrid([
			{ label: "建模域", value: `${rows.length} 类` },
			{ label: "对齐 sheet", value: `${uniqueSheets.size} 个` },
			{ label: "关键对象", value: isMission ? "可靠性框图" : "备件与弹药" },
			{ label: "后端状态", value: "待适配", tone: "danger" }
		])}
		${renderModelingDomainCards(rows)}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>建模域</th>
						<th>来源 sheet</th>
						<th>字段示例</th>
						<th>样例数据</th>
					</tr>
				</thead>
				<tbody>
					${rows.map((row) => `
						<tr>
							<td>${htmlEscape(row.name)}</td>
							<td>${htmlEscape((row.sheets || []).join(" / "))}</td>
							<td>${htmlEscape((row.fields || []).slice(0, 6).join(" / "))}</td>
							<td>${htmlEscape(row.sample)}</td>
						</tr>
					`).join("")}
				</tbody>
			</table>
		</div>
		<div class="chart-panel">
			<div class="chart-title">导入清洗规则</div>
			<div class="modeling-rule-list">
				<span>数字字符串转数字</span>
				<span>"null" 字符串转空值</span>
				<span>名称引用先保留，后续收敛 ID</span>
				<span>equipmentTree 先按 nodeLevel 展示层级，待补 parentId/串并联关系</span>
			</div>
		</div>
	`;
}

function renderExperimentResults(page) {
	const isMission = page.moduleId === "mission-reliability";
	return `
		${renderMetricGrid([
			{ label: "实验方案", value: isMission ? "任务可靠度实验 A" : "备件规划实验 A" },
			{ label: "样本数", value: "20" },
			{ label: "固定种子", value: "20260612" },
			{ label: "运行状态", value: "待启动" }
		])}
		${renderScopeCards(EXPERIMENT_SCOPE)}
		<div class="chart-panel">
			<div class="chart-title">可视化推演时间线</div>
			<div class="timeline">
				<div class="timeline-step active"><span>1</span><strong>加载场景</strong><em>内置场景和项目数据</em></div>
				<div class="timeline-step"><span>2</span><strong>启动推演</strong><em>记录开始/停止状态</em></div>
				<div class="timeline-step"><span>3</span><strong>批量样本</strong><em>生成蒙特卡洛统计</em></div>
				<div class="timeline-step"><span>4</span><strong>输出产物</strong><em>结果 JSON 与指标汇总</em></div>
			</div>
		</div>
	`;
}

function renderSystemSupportResults() {
	return `
		${renderMetricGrid([
			{ label: "运行批次", value: "RUN-20260612-001" },
			{ label: "样本统计", value: "20 / 20" },
			{ label: "结果 JSON", value: "4 类" },
			{ label: "错误记录", value: "0", tone: "success" }
		])}
		<div class="scope-grid system-support-grid">
			${SYSTEM_SUPPORT_ITEMS.map((item) => `
				<div class="scope-card">
					<div class="scope-card-head">
						<h4>${htmlEscape(item.name)}</h4>
						<span class="status-badge success">${htmlEscape(item.value)}</span>
					</div>
					<p class="muted">${htmlEscape(item.detail)}</p>
				</div>
			`).join("")}
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>产物类型</th>
						<th>示例路径</th>
						<th>检查状态</th>
					</tr>
				</thead>
				<tbody>
					<tr><td>输入规格</td><td>runs/demo-601/latest/input.json</td><td><span class="status-badge success">存在</span></td></tr>
					<tr><td>运行配置</td><td>runs/demo-601/latest/run-config.json</td><td><span class="status-badge success">存在</span></td></tr>
					<tr><td>运行日志</td><td>runs/demo-601/latest/events.log</td><td><span class="status-badge warn">示例</span></td></tr>
					<tr><td>结果汇总</td><td>runs/demo-601/latest/results/summary.json</td><td><span class="status-badge warn">待后端</span></td></tr>
				</tbody>
			</table>
		</div>
	`;
}

function renderShortfallResults() {
	const maxShortage = Math.max(...SPARE_SHORTFALL_ROWS.map((row) => row.shortage));
	return `
		${renderMetricGrid([
			{ label: "短板备件", value: "3 项", tone: "danger" },
			{ label: "最低备件满足率", value: "0.00", tone: "danger" },
			{ label: "最大平均延误", value: "96 h" },
			{ label: "建议优先补充", value: "P2 / P3" }
		])}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>备件</th>
						<th>备件满足率</th>
						<th>平均延误时间(h)</th>
						<th>基层级数量</th>
						<th>初始基层级库存</th>
						<th>不满足次数</th>
						<th>短板等级</th>
						<th>图示</th>
					</tr>
				</thead>
				<tbody>
					${SPARE_SHORTFALL_ROWS.map((row) => {
						const badge = row.level === "严重" ? "danger" : row.level === "短缺" ? "warn" : "";
						return `
							<tr>
								<td>${htmlEscape(row.name)}</td>
								<td>${row.satisfy}</td>
								<td>${row.delay}</td>
								<td>${row.baseCount}</td>
								<td>${row.stock}</td>
								<td>${row.shortage}</td>
								<td><span class="status-badge ${badge}">${htmlEscape(row.level)}</span></td>
								<td class="bar-cell">${renderBar(row.shortage, maxShortage, "red")}</td>
							</tr>`;
					}).join("")}
				</tbody>
			</table>
		</div>
		<div class="chart-panel">
			<div class="chart-title">短板分析结论</div>
			<p class="muted">P2 的不满足次数最高，P3 的满足率为 0 且平均延误时间最长。建议优先补充 P2、P3，并同步复核基层级库存配置。</p>
		</div>
	`;
}

function renderCarryListResults() {
	const objective = CARRY_OBJECTIVES.find((item) => item.id === state.carryObjective) || CARRY_OBJECTIVES[0];
	const qtyKey = state.carryReliability;
	const maxQty = Math.max(...CARRY_LIST_ROWS.map((row) => row.qty[qtyKey] ?? row.qty["90"] ?? 0));
	const totalQty = CARRY_LIST_ROWS.reduce((sum, row) => sum + (row.qty[qtyKey] ?? row.qty["90"] ?? 0), 0);
	return `
		${renderMetricGrid([
			{ label: "优化条件", value: objective.label, tone: "success" },
			{ label: "携行备件数量", value: `${totalQty} 件` },
			{ label: "任务可靠度", value: thresholdLabel(state.carryReliability) },
			{ label: "备件满足率", value: thresholdLabel(state.carrySatisfyRate) },
			{ label: "备件利用率", value: thresholdLabel(state.carryUtilizationRate) },
			{ label: objective.metricLabel, value: objective.metricValue }
		])}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>备件</th>
						<th>备件满足率</th>
						<th>平均延误时间(h)</th>
						<th>数量</th>
						<th>携行优先级</th>
						<th>图示</th>
					</tr>
				</thead>
				<tbody>
					${CARRY_LIST_ROWS.map((row, index) => {
						const qty = row.qty[qtyKey] ?? row.qty["90"] ?? 0;
						const priority = row.satisfy <= 0.33 ? "高" : row.satisfy < 1 ? "中" : "低";
						const badge = priority === "高" ? "danger" : priority === "中" ? "warn" : "success";
						return `
							<tr>
								<td>${htmlEscape(row.name)}</td>
								<td>${row.satisfy}</td>
								<td>${row.delay}</td>
								<td>${qty}</td>
								<td><span class="status-badge ${badge}">${priority}</span></td>
								<td class="bar-cell">${renderBar(qty, maxQty || 1, index % 2 === 0 ? "blue" : "green")}</td>
							</tr>`;
					}).join("")}
				</tbody>
			</table>
		</div>
		<div class="chart-panel">
			<div class="chart-title">携行清单说明</div>
			<p class="muted">当前以“${htmlEscape(objective.label)}”为优化条件，参数设置为任务可靠度 ${thresholdLabel(state.carryReliability)}、备件满足率 ${thresholdLabel(state.carrySatisfyRate)}、备件利用率 ${thresholdLabel(state.carryUtilizationRate)}。清单会优先补足 P1、P2、P3 等低满足率备件，适用于转场前的快速装箱评审。</p>
		</div>
	`;
}

function renderCompletionResults() {
	const points = COMPLETION_ROWS.map((row) => ({ x: row.wave, y: row.probability }));
	return `
		${renderMetricGrid([
			{ label: "首波任务成功概率", value: "0.99", tone: "success" },
			{ label: "末波任务成功概率", value: "0.86", tone: "danger" },
			{ label: "风险拐点", value: "第 7 波" },
			{ label: "累计出动架次", value: "108" }
		])}
		<div class="chart-panel">
			<div class="chart-title">波次任务成功概率趋势</div>
			${renderLineChart(points)}
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>波次任务</th>
						<th>波次任务成功概率</th>
						<th>累计出动架次</th>
						<th>可用飞机数</th>
						<th>状态</th>
					</tr>
				</thead>
				<tbody>
					${COMPLETION_ROWS.map((row) => {
						const badge = row.note === "风险" ? "danger" : row.note === "关注" ? "warn" : "success";
						return `
							<tr>
								<td>${row.wave}</td>
								<td>${row.probability}</td>
								<td>${row.sorties}</td>
								<td>${row.available}</td>
								<td><span class="status-badge ${badge}">${htmlEscape(row.note)}</span></td>
							</tr>`;
					}).join("")}
				</tbody>
			</table>
		</div>
	`;
}

function renderDowntimeResults() {
	const maxValue = Math.max(...DOWNTIME_FACTORS.secondary.map((item) => item.value));
	return `
		${renderMetricGrid([
			{ label: "停机因素总次数", value: "9" },
			{ label: "无可用飞机", value: "4", tone: "danger" },
			{ label: "飞机故障", value: "5", tone: "danger" },
			{ label: "备件满足率", value: "0.95", tone: "success" }
		])}
		<div class="factor-grid">
			<div class="factor-column">
				<h4>停机因素</h4>
				<div class="factor-list">
					${DOWNTIME_FACTORS.primary.map((item) => `<div class="factor-item"><span>${htmlEscape(item.name)}</span><span>${item.value}</span></div>`).join("")}
				</div>
			</div>
			<div class="factor-column">
				<h4>二级因素</h4>
				<div class="factor-list">
					${DOWNTIME_FACTORS.secondary
						.map((item) => `<div class="factor-item"><span>${htmlEscape(item.name)}</span><span>${item.value}</span></div>`)
						.join("")}
				</div>
			</div>
			<div class="factor-column">
				<h4>观察指标</h4>
				<div class="factor-list">
					${DOWNTIME_FACTORS.metrics
						.map((item) => `<div class="factor-item"><span>${htmlEscape(item.name)}</span><span>${htmlEscape(item.value)}</span></div>`)
						.join("")}
				</div>
			</div>
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>二级因素</th>
						<th>贡献次数</th>
						<th>贡献度</th>
						<th>图示</th>
					</tr>
				</thead>
				<tbody>
					${DOWNTIME_FACTORS.secondary
						.map((item) => `
							<tr>
								<td>${htmlEscape(item.name)}</td>
								<td>${item.value}</td>
								<td>${Math.round((item.value / 9) * 100)}%</td>
								<td class="bar-cell">${renderBar(item.value, maxValue, item.value >= 2 ? "red" : "blue")}</td>
							</tr>`)
						.join("")}
				</tbody>
			</table>
		</div>
	`;
}

function renderBar(value, max, color) {
	const width = Math.max(8, Math.round((Number(value) / Math.max(Number(max), 1)) * 100));
	return `<div class="bar-track" aria-label="${htmlEscape(value)}"><span class="bar-fill ${color}" style="width:${width}%"></span></div>`;
}

function renderLineChart(points) {
	const width = 860;
	const height = 280;
	const padding = { left: 48, right: 18, top: 18, bottom: 38 };
	const minX = Math.min(...points.map((point) => point.x));
	const maxX = Math.max(...points.map((point) => point.x));
	const minY = 0.86;
	const maxY = 1;
	const innerWidth = width - padding.left - padding.right;
	const innerHeight = height - padding.top - padding.bottom;
	const xScale = (x) => padding.left + ((x - minX) / (maxX - minX)) * innerWidth;
	const yScale = (y) => padding.top + (1 - (y - minY) / (maxY - minY)) * innerHeight;
	const polyline = points.map((point) => `${xScale(point.x).toFixed(1)},${yScale(point.y).toFixed(1)}`).join(" ");
	const xTicks = points.map((point) => point.x);
	const yTicks = [0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, 1];

	return `
		<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="波次任务成功概率趋势图">
			<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"></rect>
			${yTicks.map((tick) => {
				const y = yScale(tick);
				return `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="#d8dee8" stroke-dasharray="4 4"></line><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#475569">${tick}</text>`;
			}).join("")}
			${xTicks.map((tick) => {
				const x = xScale(tick);
				return `<line x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5eaf1" stroke-dasharray="4 4"></line><text x="${x}" y="${height - 12}" text-anchor="middle" font-size="12" fill="#475569">${tick}</text>`;
			}).join("")}
			<line x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" stroke="#475569"></line>
			<line x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#475569"></line>
			<polyline fill="none" stroke="#f2b300" stroke-width="3" points="${polyline}"></polyline>
			${points.map((point) => `<circle cx="${xScale(point.x).toFixed(1)}" cy="${yScale(point.y).toFixed(1)}" r="4" fill="#f2b300"></circle>`).join("")}
			<circle cx="${padding.left}" cy="${height - 16}" r="6" fill="#f2b300"></circle>
			<text x="${padding.left + 14}" y="${height - 12}" font-size="13" fill="#1f2d3d">任务波次</text>
		</svg>
	`;
}

function render() {
	const page = getRoutePage();
	const content = page ? renderAnalysisPage(page) : renderHomePage();
	document.getElementById("app").innerHTML = renderLayout(content, page);
}

function showToast(message) {
	const toast = document.getElementById("toast");
	toast.textContent = message;
	toast.classList.add("show");
	window.clearTimeout(showToast.timer);
	showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

document.addEventListener("click", (event) => {
	const navButton = event.target.closest("[data-nav]");
	if (navButton) {
		event.preventDefault();
		window.location.hash = navButton.dataset.nav.replace(/^#/, "");
		return;
	}

	const wheelButton = event.target.closest("[data-action='set-wheel-value']");
	if (wheelButton) {
		setCarryThreshold(wheelButton.dataset.wheelKey, wheelButton.dataset.value);
		render();
		return;
	}

	const startButton = event.target.closest("[data-action='start-analysis']");
	if (startButton) {
		const pageId = startButton.dataset.page;
		state.lastRun[pageId] = formatTime(new Date());
		render();
		showToast("启动分析计算（模拟）");
	}
});

document.addEventListener("wheel", (event) => {
	const picker = event.target.closest("[data-wheel-key]");
	if (!picker) return;
	const key = picker.dataset.wheelKey;
	const currentIndex = CARRY_THRESHOLD_OPTIONS.indexOf(state[key]);
	if (currentIndex < 0) return;
	event.preventDefault();
	const direction = event.deltaY > 0 ? 1 : -1;
	const nextIndex = Math.max(0, Math.min(CARRY_THRESHOLD_OPTIONS.length - 1, currentIndex + direction));
	if (nextIndex === currentIndex) return;
	setCarryThreshold(key, CARRY_THRESHOLD_OPTIONS[nextIndex]);
	render();
}, { passive: false });

document.addEventListener("change", (event) => {
	const objectiveSelect = event.target.closest("[data-action='set-carry-objective']");
	if (objectiveSelect) {
		state.carryObjective = objectiveSelect.value || "availability";
		render();
	}
});

window.addEventListener("hashchange", render);
render();
