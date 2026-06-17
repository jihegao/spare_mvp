const APP_CONFIG = {
	systemName: "备件规划及任务可靠度验证评估平台",
	version: "V1.0",
	project: "601 备件评估演示项目"
};

const MODULES = [
	{
		id: "spare-planning",
		code: "BJ",
		title: "备件规划评估模块",
		desc: "围绕备件满足率、延误时间和库存约束，识别短板并形成转场携行建议。",
		pages: [
			{ id: "shortfall", code: "DB", title: "备件短板分析", desc: "分析备件满足率、延误时间与不满足次数，定位影响任务保障的关键短板。", route: "#/spare-planning/shortfall" },
			{ id: "carry-list", code: "ZX", title: "转场携行清单分析", desc: "按优化条件和备件约束生成转场携行数量与保障优先级建议。", route: "#/spare-planning/carry-list" }
		]
	},
	{
		id: "mission-reliability",
		code: "RW",
		title: "任务可靠度评估模块",
		desc: "面向多波次任务执行，评估任务完成概率，并拆解造成停机的关键因素。",
		pages: [
			{ id: "completion", code: "WC", title: "任务完成度评估", desc: "跟踪多波次任务成功概率变化，评估当前保障方案对任务完成度的支撑能力。", route: "#/mission-reliability/completion" },
			{ id: "downtime", code: "TJ", title: "停机因素分析", desc: "从不可用飞机、维修状态、备件与保障设备满足率等维度定位停机主因。", route: "#/mission-reliability/downtime" }
		]
	}
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
					<p class="muted">参照保障方案分析模块的布局方式，将备件规划评估与任务可靠度评估拆分为两个模块、四个子页面。页面按业务需要保留启动计算、参数配置、结果展示、表格与图形化结果区。</p>
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
	const lastRun = state.lastRun[page.id];
	const hasConfig = page.id === "carry-list";
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
							<button class="btn-primary analysis-start-btn" data-action="start-analysis" data-page="${htmlEscape(page.id)}">启动</button>
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
	return "";
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
	if (page.id === "shortfall") return renderShortfallResults();
	if (page.id === "carry-list") return renderCarryListResults();
	if (page.id === "completion") return renderCompletionResults();
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
