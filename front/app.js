const APP_CONFIG = {
	systemName: "备件规划及任务可靠度验证评估平台",
	version: "V1.0",
	project: "601 备件评估演示项目"
};

const MODELING_CONTRACT = globalThis.MODELING_CONTRACT;

if (!MODELING_CONTRACT) {
	throw new Error("Missing MODELING_CONTRACT. Load modeling-contract.js before app.js.");
}

const PROJECT_JSON_CONTRACT = globalThis.PROJECT_JSON_CONTRACT;

if (!PROJECT_JSON_CONTRACT) {
	throw new Error("Missing PROJECT_JSON_CONTRACT. Load project-json-contract.js before app.js.");
}

const {
	MODELING_CONTEXT_ITEMS,
	MODELING_FUTURE_FIELDS,
	MODELING_SCOPE
} = MODELING_CONTRACT;

const {
	MODELING_OBJECT_METADATA,
	PROJECT_JSON_SCHEMA_VERSION,
	STANDARD_MODELING_OBJECTS,
	applyProjectRecordDelete,
	createProjectJsonState,
	exportProjectJson,
	normalizeProjectJson,
	upsertProjectRecord
} = PROJECT_JSON_CONTRACT;

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

const DEMO_PROJECT_JSON = {
	projectId: "demo-601",
	projectName: "601 备件评估演示项目",
	schemaVersion: PROJECT_JSON_SCHEMA_VERSION,
	tables: {
		missionProfiles: [
			{
				id: "mission-1",
				taskNo: "BT-001",
				taskName: "对海突击任务A",
				aircraftModel: "J35",
				equipmentAmount: 1,
				durationMinutes: 120,
				prepTimeMinutes: 30,
				memberNos: ["J35-132"],
				usageGuarantee: "歼-35快速出动保障方案2"
			}
		],
		equipmentAssets: [
			{
				id: "asset-1",
				aircraftType: "J35",
				aircraftCode: "J35-132",
				supportOrg: "航空联队机务组",
				currentStatus: "在册完好",
				totalServiceYears: 3,
				totalServiceTakeoffLanding: 420
			}
		],
		equipmentTree: [
			{
				id: "equipment-1",
				nodeLevel: 1,
				nodeName: "J35",
				model: "J35",
				quantity: 1,
				isLru: false
			},
			{
				id: "equipment-2",
				nodeLevel: 3,
				nodeName: "任务计算机模块",
				model: "LRU-RW-01",
				quantity: 2,
				isLru: true,
				lruFailureRate: 0.033,
				mtbcf: 30,
				mttr: 20,
				detectionTime: 12,
				isDetectable: true
			}
		],
		supportResources: [
			{
				id: "support-1",
				orgName: "航空联队机务组",
				major: "机加",
				majorLevel: "L2",
				serviceAircraft: ["J35"],
				staffCount: 4
			},
			{
				id: "support-2",
				equipmentName: "技术综合检测仪",
				equipmentCount: 2,
				stationCode: "ST-01",
				stationName: "保障站位1"
			}
		],
		inventoryResources: [
			{
				id: "spare-1",
				resourceType: "sparePart",
				name: "飞行检查包",
				model: "FX-06",
				count: 12,
				relatedComponentId: "equipment-2"
			},
			{
				id: "ammo-1",
				resourceType: "ammunition",
				name: "放飞流程训练弹",
				model: "FF-TR",
				count: 4
			}
		],
		supportActivities: [
			{
				id: "activity-1",
				activityCode: "OPS-007",
				activityName: "机务检查",
				activityType: "basic",
				aircraftName: "J35",
				workDurationHours: 2,
				spareList: [{ spareName: "飞行检查包", spareModel: "FX-06", requiredCount: 1 }]
			},
			{
				id: "activity-2",
				activityName: "歼-35快速出动保障方案2",
				activityType: "usage",
				basicActivityCode: "OPS-007",
				precedingWork: "机务检查"
			}
		],
		metricPlans: [
			{
				id: "metric-1",
				indexName: "任务可靠度",
				targetType: "任务可靠度",
				symbol: "≥",
				targetValue: 0.95,
				simulationType: "单波次",
				taskSuccessRate: 0.95
			}
		]
	},
	sourceTrace: { origin: "demo-fixture", importedSheets: [] }
};

const MODELING_AUTHORING_SECTIONS = {
	"spare-planning": [
		{ label: "任务建模", tableName: "missionProfiles", detail: "任务编号、任务名称、机型、数量、时长和保障方案引用" },
		{ label: "装备资产", tableName: "equipmentAssets", detail: "飞机池、飞机状态、寿命和保障组织引用" },
		{ label: "装备组成", tableName: "equipmentTree", detail: "装备层级、部件/LRU、数量和当前故障参数" },
		{ label: "备件与弹药", tableName: "inventoryResources", detail: "备件、弹药、型号、库存和关联部件" },
		{ label: "保障组织与资源", tableName: "supportResources", detail: "保障组织、人员、设备、站位和设施" },
		{ label: "保障活动", tableName: "supportActivities", detail: "活动库、使用保障、预防维修和修复维修方案" },
		{ label: "指标方案", tableName: "metricPlans", detail: "优化目标、约束阈值和指标目标值" }
	],
	"mission-reliability": [
		{ label: "任务剖面", tableName: "missionProfiles", detail: "波次、周期任务、首次出动时间和重复规则" },
		{ label: "飞机与装备组成", tableName: "equipmentAssets", detail: "飞机状态、寿命和可用性输入" },
		{ label: "故障模型", tableName: "equipmentTree", detail: "LRU 故障率、维修分布、MTBCF、MTTR 和检测时间" },
		{ label: "装备可靠性框图", tableName: "equipmentTree", detail: "基于装备层级预览结构；parentId、relationType 和 successThreshold 为待补字段" },
		{ label: "保障组织与资源", tableName: "supportResources", detail: "保障人员、设备、备件、弹药、站位和设施" },
		{ label: "保障活动", tableName: "supportActivities", detail: "故障维修、预防维修、任务间保障和使用保障" },
		{ label: "指标分配", tableName: "metricPlans", detail: "任务可靠度、可用度、利用率等指标方案" }
	]
};

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
	modeling: createProjectJsonState({ projectJson: DEMO_PROJECT_JSON }),
	activeModelingTable: {
		"spare-planning": "missionProfiles",
		"mission-reliability": "missionProfiles"
	},
	selectedModelingRecords: {},
	modelingImportDraft: "",
	modelingImportMessage: "",
	modelingExport: null,
	modelingSequence: 1,
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

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function getModelingSections(moduleId) {
	return MODELING_AUTHORING_SECTIONS[moduleId] || MODELING_AUTHORING_SECTIONS["spare-planning"];
}

function getActiveModelingTable(moduleId) {
	const sections = getModelingSections(moduleId);
	const activeTable = state.activeModelingTable[moduleId];
	return sections.some((section) => section.tableName === activeTable) ? activeTable : sections[0].tableName;
}

function getSelectedModelingRecord(tableName) {
	const records = state.modeling.project.tables[tableName] || [];
	const selectedId = state.selectedModelingRecords[tableName];
	return records.find((record) => record.id === selectedId) || records[0] || null;
}

function getRecordTitle(record, metadata) {
	if (!record) return "无记录";
	const preferredFields = [
		"taskName",
		"aircraftCode",
		"nodeName",
		"name",
		"orgName",
		"equipmentName",
		"activityName",
		"indexName",
		"targetType",
		"id"
	];
	const fieldName = preferredFields.find((field) => record[field]);
	const value = fieldName ? record[fieldName] : record.id;
	return `${metadata.label} / ${value}`;
}

function getStatusText(status) {
	const labels = {
		clean: "无未保存修改",
		dirty: "有未保存修改",
		saving: "正在保存",
		saved: "已保存到浏览器内存",
		save_failed: "保存失败"
	};
	return labels[status] || status;
}

function validationTone(status) {
	if (status === "valid") return "success";
	if (status === "warning") return "warn";
	if (status === "invalid") return "danger";
	return "";
}

function getValidationSummary() {
	const validation = state.modeling.project.validation || { status: "draft", errors: [], warnings: [] };
	return {
		status: validation.status,
		errors: validation.errors || [],
		warnings: validation.warnings || []
	};
}

function fieldValueToText(value, fieldMeta) {
	if (value === undefined || value === null) return "";
	if (fieldMeta.kind === "list" || fieldMeta.kind === "referenceList") return Array.isArray(value) ? value.join(", ") : String(value);
	if (fieldMeta.kind === "object") return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
	return String(value);
}

function parseModelingFieldValue(rawValue, fieldMeta) {
	const value = String(rawValue ?? "").trim();
	if (!value) {
		if (fieldMeta.kind === "list" || fieldMeta.kind === "referenceList") return [];
		if (fieldMeta.kind === "object") return {};
		return fieldMeta.required ? "" : null;
	}
	if (fieldMeta.kind === "nonNegativeInteger") {
		const numberValue = Number(value);
		return Number.isFinite(numberValue) ? Math.trunc(numberValue) : rawValue;
	}
	if (["nonNegativeNumber", "probability", "probabilityOrNumber"].includes(fieldMeta.kind)) {
		const numberValue = Number(value);
		return Number.isFinite(numberValue) ? numberValue : rawValue;
	}
	if (fieldMeta.kind === "boolean") return value === "true";
	if (fieldMeta.kind === "list" || fieldMeta.kind === "referenceList") {
		return value.split(/[,、\n]/).map((item) => item.trim()).filter(Boolean);
	}
	if (fieldMeta.kind === "object") {
		try {
			return JSON.parse(value);
		} catch {
			return rawValue;
		}
	}
	return rawValue;
}

function getDefaultRecord(tableName) {
	const sequence = state.modelingSequence++;
	const draftId = `${tableName}:draft-${sequence}`;
	const defaults = {
		missionProfiles: {
			id: draftId,
			taskNo: `TASK-${String(sequence).padStart(3, "0")}`,
			taskName: `新任务 ${sequence}`,
			aircraftModel: "J35",
			equipmentAmount: 1,
			durationMinutes: 60
		},
		equipmentAssets: {
			id: draftId,
			aircraftType: "J35",
			aircraftCode: `J35-NEW-${sequence}`,
			currentStatus: "在册完好"
		},
		equipmentTree: {
			id: draftId,
			nodeLevel: 2,
			nodeName: `新增装备节点 ${sequence}`,
			model: `LRU-${sequence}`,
			quantity: 1,
			isLru: false
		},
		supportResources: {
			id: draftId,
			orgName: `新增保障资源 ${sequence}`,
			major: "机加",
			majorLevel: "L1",
			staffCount: 1
		},
		inventoryResources: {
			id: draftId,
			resourceType: "sparePart",
			name: `新增备件 ${sequence}`,
			model: `SP-${sequence}`,
			count: 1
		},
		supportActivities: {
			id: draftId,
			activityCode: `ACT-${String(sequence).padStart(3, "0")}`,
			activityName: `新增保障活动 ${sequence}`,
			activityType: "basic"
		},
		metricPlans: {
			id: draftId,
			indexName: "任务可靠度",
			targetType: "任务可靠度",
			symbol: "≥",
			targetValue: 0.9
		}
	};
	return defaults[tableName] || { id: draftId };
}

function refreshExportPreview() {
	state.modelingExport = exportProjectJson(state.modeling.project);
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
	const isModelingPage = page.id === "modeling";
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
						<div class="card analysis-config-panel ${hasConfig ? "" : "analysis-config-panel-compact"} ${isModelingPage ? "modeling-authoring-config-panel" : ""}">
						<div class="analysis-section-head ${hasConfig ? "" : "analysis-section-head-only"}">
							${hasConfig ? "<h3>参数配置</h3>" : ""}
							<button class="btn-primary analysis-start-btn" data-action="start-analysis" data-page="${htmlEscape(pageKey)}">启动</button>
						</div>
						${hasConfig ? `<div class="analysis-config-scroll">${renderConfig(page)}</div>` : ""}
					</div>
						<div class="card analysis-result-panel ${isModelingPage ? "modeling-authoring-result-panel" : ""}">
							<h3>${isModelingPage ? "项目 JSON 作者界面" : "结果展示"}</h3>
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
	const validation = getValidationSummary();
	const recordTotal = STANDARD_MODELING_OBJECTS.reduce((sum, tableName) => sum + state.modeling.project.tables[tableName].length, 0);
	return `
		<div class="modeling-contract-summary">
			<div class="modeling-summary-item">
				<span>当前项目</span>
				<strong>${htmlEscape(state.modeling.project.projectName)}</strong>
			</div>
			<div class="modeling-summary-item">
				<span>共享项目 JSON</span>
				<strong>${recordTotal} 条 / ${STANDARD_MODELING_OBJECTS.length} 类对象</strong>
			</div>
			<div class="modeling-summary-item">
				<span>保存状态</span>
				<strong>${htmlEscape(getStatusText(state.modeling.dirtyStatus))}</strong>
			</div>
			<div class="modeling-summary-item">
				<span>校验状态</span>
				<strong>${htmlEscape(validation.status)} / ${validation.errors.length} 错误</strong>
			</div>
		</div>
		<div class="modeling-boundary-panel">
			<div>
				<h4>${isMission ? "任务可靠度建模视图" : "备件规划建模视图"}</h4>
				<p class="muted">本页从 core/dataset/data_new.json 对齐的字段契约出发，直接编辑 normalized project JSON。当前保存为浏览器内存/导出草稿，尚未接入后端持久化。</p>
			</div>
			<div class="sheet-chip-row">
				<span class="sheet-chip">建模域 ${rows.length} 类</span>
				<span class="sheet-chip">对齐 sheet ${uniqueSheets.size} 个</span>
				<span class="sheet-chip">场景/舰船/布列不进入建模表单</span>
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
		${renderModelingAuthoringWorkbench(page)}
		<div class="modeling-reference-block">
			${renderMetricGrid([
				{ label: "建模域", value: `${rows.length} 类` },
				{ label: "对齐 sheet", value: `${uniqueSheets.size} 个` },
				{ label: "关键对象", value: isMission ? "可靠性框图" : "备件与弹药" },
				{ label: "后端状态", value: "待适配", tone: "danger" }
			])}
			${renderModelingDomainCards(rows)}
			<div class="chart-panel">
				<div class="chart-title">导入清洗规则</div>
				<div class="modeling-rule-list">
					<span>数字字符串转数字</span>
					<span>"null" 字符串转空值</span>
					<span>名称引用先保留，后续收敛 ID</span>
					<span>equipmentTree 先按 nodeLevel 展示层级，待补 parentId/串并联关系</span>
				</div>
			</div>
		</div>
	`;
}

function renderModelingAuthoringWorkbench(page) {
	const moduleId = page.moduleId;
	const sections = getModelingSections(moduleId);
	const activeTableName = getActiveModelingTable(moduleId);
	const metadata = MODELING_OBJECT_METADATA[activeTableName];
	const records = state.modeling.project.tables[activeTableName] || [];
	const selectedRecord = getSelectedModelingRecord(activeTableName);
	const validation = getValidationSummary();
	const preview = state.modelingExport || exportProjectJson(state.modeling.project);
	const viewTitle = moduleId === "mission-reliability" ? "任务可靠度建模视图" : "备件规划建模视图";
	return `
		<section class="modeling-authoring-workbench">
			<div class="authoring-topline">
				<div>
					<h4>${htmlEscape(viewTitle)}</h4>
					<p class="muted">两个建模页共用同一份共享项目 JSON；页面仅切换业务重点，不复制项目数据。</p>
				</div>
				<div class="authoring-action-row">
					<button type="button" data-action="save-modeling-draft">保存草稿</button>
					<button type="button" class="btn-primary" data-action="export-modeling-json">导出 JSON</button>
				</div>
			</div>
			<div class="authoring-status-row">
				<span class="status-badge ${state.modeling.dirtyStatus === "dirty" ? "warn" : "success"}">${htmlEscape(getStatusText(state.modeling.dirtyStatus))}</span>
				<span class="status-badge ${validationTone(validation.status)}">validation: ${htmlEscape(validation.status)}</span>
				<span class="status-badge ${validation.errors.length ? "danger" : "success"}">${validation.errors.length} errors</span>
				<span class="status-badge ${validation.warnings.length ? "warn" : "success"}">${validation.warnings.length} warnings</span>
			</div>
			<div class="modeling-authoring-grid">
				<div class="authoring-object-panel">
					<div class="authoring-panel-title">对象列表</div>
					${sections.map((section) => renderModelingObjectButton(moduleId, section, activeTableName)).join("")}
				</div>
				<div class="authoring-record-panel">
					<div class="authoring-panel-title">
						<span>${htmlEscape(metadata.label)}</span>
						<button type="button" data-action="add-modeling-record" data-table-name="${htmlEscape(activeTableName)}">新增记录</button>
					</div>
					${renderModelingRecordTable(activeTableName, records, selectedRecord)}
				</div>
				<div class="authoring-detail-panel">
					<div class="authoring-panel-title">详情编辑</div>
					${renderModelingDetailEditor(activeTableName, selectedRecord)}
				</div>
			</div>
			<div class="modeling-json-panel">
				<div class="modeling-import-panel">
					<div class="authoring-panel-title">导入 JSON</div>
					<textarea rows="7" data-modeling-import placeholder="粘贴 normalized project JSON 或工作簿式 JSON">${htmlEscape(state.modelingImportDraft)}</textarea>
					<div class="authoring-action-row">
						<button type="button" data-action="import-modeling-json">导入 JSON</button>
						<span class="muted">${htmlEscape(state.modelingImportMessage || "支持 normalized project JSON 和 workbook-style JSON。")}</span>
					</div>
				</div>
				<div class="modeling-preview-panel">
					<div class="authoring-panel-title">
						<span>JSON 预览</span>
						<span class="status-badge ${preview.runnable ? "success" : "warn"}">${preview.runnable ? "可运行 JSON" : "草稿 JSON"}</span>
					</div>
					<div class="export-summary">
						<span>${htmlEscape(preview.fileName)}</span>
						<a download="${htmlEscape(preview.fileName)}" href="data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(preview.projectJson, null, 2))}">下载 normalized project JSON</a>
					</div>
					<pre class="json-preview">${htmlEscape(JSON.stringify(preview.projectJson, null, 2))}</pre>
				</div>
			</div>
			${renderValidationMessages(validation)}
		</section>
	`;
}

function renderModelingObjectButton(moduleId, section, activeTableName) {
	const count = state.modeling.project.tables[section.tableName]?.length || 0;
	return `
		<button type="button" class="authoring-object-button ${section.tableName === activeTableName ? "active" : ""}" data-action="set-modeling-table" data-module-id="${htmlEscape(moduleId)}" data-table-name="${htmlEscape(section.tableName)}">
			<span>${htmlEscape(section.label)}</span>
			<strong>${count}</strong>
			<em>${htmlEscape(section.detail)}</em>
		</button>
	`;
}

function renderModelingRecordTable(tableName, records, selectedRecord) {
	const metadata = MODELING_OBJECT_METADATA[tableName];
	const fieldNames = Object.keys(metadata.fields).filter((fieldName) => fieldName !== "id").slice(0, 4);
	if (records.length === 0) {
		return `<div class="empty-authoring-state">当前对象暂无记录，可新增记录或从 JSON 导入。</div>`;
	}
	return `
		<div class="authoring-table-wrap">
			<table>
				<thead>
					<tr>
						<th>记录</th>
						${fieldNames.map((fieldName) => `<th>${htmlEscape(fieldName)}</th>`).join("")}
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					${records.map((record) => `
						<tr class="${selectedRecord?.id === record.id ? "selected-row" : ""}">
							<td>
								<button type="button" class="record-select-button" data-action="select-modeling-record" data-table-name="${htmlEscape(tableName)}" data-record-id="${htmlEscape(record.id)}">
									${htmlEscape(getRecordTitle(record, metadata))}
								</button>
							</td>
							${fieldNames.map((fieldName) => `<td>${htmlEscape(fieldValueToText(record[fieldName], metadata.fields[fieldName]))}</td>`).join("")}
							<td>
								<button type="button" class="btn-link danger-link" data-action="delete-modeling-record" data-table-name="${htmlEscape(tableName)}" data-record-id="${htmlEscape(record.id)}">删除</button>
							</td>
						</tr>
					`).join("")}
				</tbody>
			</table>
		</div>
	`;
}

function renderModelingDetailEditor(tableName, record) {
	const metadata = MODELING_OBJECT_METADATA[tableName];
	if (!record) {
		return `<div class="empty-authoring-state">选择或新增一条 ${htmlEscape(metadata.label)} 记录后开始编辑。</div>`;
	}
	return `
		<div class="authoring-field-grid">
			${Object.entries(metadata.fields).map(([fieldName, fieldMeta]) => renderModelingField(tableName, record, fieldName, fieldMeta)).join("")}
		</div>
	`;
}

function renderModelingField(tableName, record, fieldName, fieldMeta) {
	const value = fieldValueToText(record[fieldName], fieldMeta);
	const commonAttrs = `data-model-field="${htmlEscape(fieldName)}" data-table-name="${htmlEscape(tableName)}" data-record-id="${htmlEscape(record.id)}" data-field-name="${htmlEscape(fieldName)}"`;
	const requiredMark = fieldMeta.required ? " *" : "";
	const unitLabel = fieldMeta.unit ? ` (${fieldMeta.unit})` : "";
	if (fieldMeta.kind === "enum") {
		return `
			<div class="form-item authoring-field">
				<label>${htmlEscape(fieldName)}${requiredMark}${unitLabel}</label>
				<select ${commonAttrs}>
					${fieldMeta.values.map((option) => `<option value="${htmlEscape(option)}" ${option === record[fieldName] ? "selected" : ""}>${htmlEscape(option)}</option>`).join("")}
				</select>
			</div>
		`;
	}
	if (fieldMeta.kind === "boolean") {
		return `
			<div class="form-item authoring-field">
				<label>${htmlEscape(fieldName)}${requiredMark}${unitLabel}</label>
				<select ${commonAttrs}>
					<option value="true" ${record[fieldName] === true ? "selected" : ""}>true</option>
					<option value="false" ${record[fieldName] === false ? "selected" : ""}>false</option>
				</select>
			</div>
		`;
	}
	if (["list", "referenceList", "object"].includes(fieldMeta.kind)) {
		return `
			<div class="form-item authoring-field wide">
				<label>${htmlEscape(fieldName)}${requiredMark}${unitLabel}</label>
				<textarea rows="3" ${commonAttrs}>${htmlEscape(value)}</textarea>
			</div>
		`;
	}
	const type = ["nonNegativeInteger", "nonNegativeNumber", "probability", "probabilityOrNumber"].includes(fieldMeta.kind) ? "number" : "text";
	const step = fieldMeta.kind === "nonNegativeInteger" ? "1" : "any";
	const readonly = fieldName === "id" ? "readonly" : "";
	return `
		<div class="form-item authoring-field">
			<label>${htmlEscape(fieldName)}${requiredMark}${unitLabel}</label>
			<input type="${type}" step="${step}" value="${htmlEscape(value)}" ${readonly} ${commonAttrs} />
		</div>
	`;
}

function renderValidationMessages(validation) {
	if (!validation.errors.length && !validation.warnings.length) {
		return `<div class="validation-panel success">当前项目 JSON 通过最小校验，可作为后续实验契约输入。</div>`;
	}
	const messages = [...validation.errors, ...validation.warnings].slice(0, 8);
	return `
		<div class="validation-panel ${validation.errors.length ? "danger" : "warn"}">
			<strong>错误状态</strong>
			${messages.map((item) => `<span>${htmlEscape(item.tableName || "project")}.${htmlEscape(item.field || item.rule)}: ${htmlEscape(item.message || item.rule)}</span>`).join("")}
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

function setActiveModelingTable(moduleId, tableName) {
	if (!STANDARD_MODELING_OBJECTS.includes(tableName)) return false;
	state.activeModelingTable[moduleId] = tableName;
	const selected = getSelectedModelingRecord(tableName);
	if (selected) state.selectedModelingRecords[tableName] = selected.id;
	return true;
}

function selectModelingRecord(tableName, recordId) {
	const records = state.modeling.project.tables[tableName] || [];
	if (!records.some((record) => record.id === recordId)) return false;
	state.selectedModelingRecords[tableName] = recordId;
	return true;
}

function addModelingRecord(tableName) {
	const record = getDefaultRecord(tableName);
	state.modeling = upsertProjectRecord(state.modeling, tableName, record);
	state.selectedModelingRecords[tableName] = record.id;
	state.modelingExport = null;
	state.modelingImportMessage = "";
	showToast("已新增建模记录");
}

function deleteModelingRecord(tableName, recordId) {
	const result = applyProjectRecordDelete(state.modeling, tableName, recordId);
	state.modeling = result.state;
	state.modelingExport = null;
	if (!result.deleted) {
		showToast("记录被引用，无法删除");
		return;
	}
	const selected = getSelectedModelingRecord(tableName);
	if (selected) state.selectedModelingRecords[tableName] = selected.id;
	else delete state.selectedModelingRecords[tableName];
	showToast("已删除建模记录");
}

function updateModelingField(input) {
	const { tableName, recordId, fieldName } = input.dataset;
	const metadata = MODELING_OBJECT_METADATA[tableName];
	const fieldMeta = metadata?.fields?.[fieldName];
	if (!metadata || !fieldMeta) return;
	const record = state.modeling.project.tables[tableName]?.find((item) => item.id === recordId);
	if (!record) return;
	const nextRecord = {
		...record,
		[fieldName]: parseModelingFieldValue(input.value, fieldMeta)
	};
	state.modeling = upsertProjectRecord(state.modeling, tableName, nextRecord);
	state.selectedModelingRecords[tableName] = record.id;
	state.modelingExport = null;
}

function saveModelingDraft() {
	state.modeling = {
		...state.modeling,
		dirtyStatus: "saved",
		lastSavedProjectJson: cloneJson(state.modeling.project)
	};
	showToast("已保存到浏览器内存");
}

function importModelingJson() {
	try {
		const parsed = JSON.parse(state.modelingImportDraft || "{}");
		const normalized = normalizeProjectJson(parsed);
		state.modeling = createProjectJsonState({ projectJson: normalized });
		state.modeling.dirtyStatus = "dirty";
		state.selectedModelingRecords = {};
		state.modelingExport = null;
		state.modelingImportMessage = `导入完成：${normalized.projectName}`;
		showToast("导入 JSON 完成");
	} catch (error) {
		state.modelingImportMessage = `导入失败：${error.message}`;
		showToast("导入 JSON 失败");
	}
}

function exportModelingJson() {
	refreshExportPreview();
	showToast(state.modelingExport.runnable ? "已生成可运行 JSON" : "已生成草稿 JSON");
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

	const modelingTableButton = event.target.closest("[data-action='set-modeling-table']");
	if (modelingTableButton) {
		setActiveModelingTable(modelingTableButton.dataset.moduleId, modelingTableButton.dataset.tableName);
		render();
		return;
	}

	const modelingRecordButton = event.target.closest("[data-action='select-modeling-record']");
	if (modelingRecordButton) {
		selectModelingRecord(modelingRecordButton.dataset.tableName, modelingRecordButton.dataset.recordId);
		render();
		return;
	}

	const addModelingButton = event.target.closest("[data-action='add-modeling-record']");
	if (addModelingButton) {
		addModelingRecord(addModelingButton.dataset.tableName);
		render();
		return;
	}

	const deleteModelingButton = event.target.closest("[data-action='delete-modeling-record']");
	if (deleteModelingButton) {
		deleteModelingRecord(deleteModelingButton.dataset.tableName, deleteModelingButton.dataset.recordId);
		render();
		return;
	}

	const saveModelingButton = event.target.closest("[data-action='save-modeling-draft']");
	if (saveModelingButton) {
		saveModelingDraft();
		render();
		return;
	}

	const importModelingButton = event.target.closest("[data-action='import-modeling-json']");
	if (importModelingButton) {
		importModelingJson();
		render();
		return;
	}

	const exportModelingButton = event.target.closest("[data-action='export-modeling-json']");
	if (exportModelingButton) {
		exportModelingJson();
		render();
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

document.addEventListener("input", (event) => {
	const modelingField = event.target.closest("[data-model-field]");
	if (modelingField) {
		updateModelingField(modelingField);
		render();
		return;
	}

	const importDraft = event.target.closest("[data-modeling-import]");
	if (importDraft) {
		state.modelingImportDraft = importDraft.value;
		state.modelingImportMessage = "";
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
	const modelingField = event.target.closest("[data-model-field]");
	if (modelingField) {
		updateModelingField(modelingField);
		render();
		return;
	}

	const objectiveSelect = event.target.closest("[data-action='set-carry-objective']");
	if (objectiveSelect) {
		state.carryObjective = objectiveSelect.value || "availability";
		render();
	}
});

window.addEventListener("hashchange", render);
render();
