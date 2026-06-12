(function () {
const MODELING_FUTURE_FIELDS = {
	rbdStructure: ["parentId", "relationType", "successThreshold"]
};

const MODELING_SCOPE = {
	"spare-planning": [
		{
			name: "任务建模",
			detail: "基本任务、复合任务、周期任务、基本使用单元",
			status: "JSON 对齐",
			sheets: ["basicTasks", "compositeTasks", "periodicTasks", "basicUsageUnits"],
			fields: ["taskNo", "taskName", "aircraftModel", "equipmentAmount", "duration", "prepTime", "compositeTaskName", "dayRepeatTimes", "intervalHours", "formationName"],
			sample: "对海突击任务A / 复合任务A / 编队1"
		},
		{
			name: "装备建模",
			detail: "飞机池、装备组成、部件/LRU、故障参数",
			status: "JSON 对齐",
			sheets: ["aircraftPools", "equipmentTree"],
			fields: ["aircraftType", "aircraftCode", "currentStatus", "nodeLevel", "nodeName", "model", "quantity", "isLru"],
			sample: "J35-132 / 任务计算机模块 / LRU-RW-01"
		},
		{
			name: "备件与弹药",
			detail: "备件、弹药、活动资源需求",
			status: "JSON 对齐",
			sheets: ["spareParts", "ammunition", "basicActivityLibrary.spareList", "basicActivityLibrary.ammoList"],
			fields: ["id", "name", "model", "count", "spareName", "spareModel", "ammoName", "ammoModel", "requiredCount"],
			sample: "飞行检查包 / 机体紧固件包 / 放飞流程训练弹"
		},
		{
			name: "保障组织与资源",
			detail: "组织树、人员、设备、站位、设施",
			status: "JSON 对齐",
			sheets: ["supportOrganizationTree", "supportStaff", "supportEquipment", "supportStations", "nonSupportStations", "supportFacilities", "stationFacilityMatrix"],
			fields: ["orgName", "parentId", "major", "majorLevel", "serviceAircraft", "count", "stationCode", "facilityCode", "functionType"],
			sample: "航空联队（机务） / 技术综合检测仪 / 保障站位1"
		},
		{
			name: "保障活动",
			detail: "基本活动库、使用保障、预防性维修、修复性维修",
			status: "JSON 对齐",
			sheets: ["basicActivityLibrary", "usageSupportActivities", "preventiveMaintenance", "correctiveMaintenance"],
			fields: ["activityName", "activityCode", "workDuration", "crewList", "equipmentList", "spareList", "planType", "planWorkItem", "repairObject"],
			sample: "机务检查 / 歼-35快速出动保障方案2 / 8小时定检"
		},
		{
			name: "指标方案",
			detail: "实验指标、约束条件、优化目标",
			status: "JSON 对齐",
			sheets: ["experimentConfig.indexList", "constraints", "optimizationTargets"],
			fields: ["indexName", "targetType", "symbol", "targetValue", "simulationType", "taskSuccessRate", "randomControl"],
			sample: "出动架次率 / 任务可靠度 / 保障设备利用率"
		}
	],
	"mission-reliability": [
		{
			name: "任务剖面",
			detail: "基本任务、复合任务、周期任务、基本使用单元",
			status: "JSON 对齐",
			sheets: ["basicTasks", "compositeTasks", "periodicTasks", "basicUsageUnits"],
			fields: ["taskNo", "taskName", "aircraftModel", "equipmentAmount", "duration", "prepTime", "issueTime", "firstDispatchTime", "dayRepeatTimes", "intervalHours", "repeatWeeks"],
			sample: "对海突击任务A / 06:15 首次出动 / 3 次重复"
		},
		{
			name: "飞机与装备组成",
			detail: "飞机池、装备树、部件/LRU",
			status: "JSON 对齐",
			sheets: ["aircraftPools", "equipmentTree"],
			fields: ["aircraftType", "aircraftCode", "currentStatus", "remainingLife", "nodeLevel", "nodeName", "model", "quantity", "isLru"],
			sample: "J35-132 / 航电系统 / 任务计算机模块"
		},
		{
			name: "故障模型",
			detail: "LRU 故障率、维修分布、检测时间",
			status: "JSON 对齐",
			sheets: ["equipmentTree"],
			fields: ["lruFailureRate", "kValue", "faultDistribution", "repairDistribution", "mtbcf", "mttr", "detectionTime", "isDetectable"],
			sample: "lruFailureRate 0.033 / mtbcf / mttr"
		},
		{
			name: "装备可靠性框图",
			detail: "当前按 nodeLevel 展示层级，parentId 和串并联关系作为后续字段补充项",
			status: "待补父子关系",
			sheets: ["equipmentTree"],
			fields: ["nodeLevel", "nodeName", "model", "quantity", "isLru"],
			futureFieldGroup: "rbdStructure",
			sample: "系统 -> 分系统 -> 部件/LRU"
		},
		{
			name: "保障组织与资源",
			detail: "组织树、人员、设备、备件、弹药、站位、设施",
			status: "JSON 对齐",
			sheets: ["supportOrganizationTree", "supportStaff", "supportEquipment", "spareParts", "ammunition", "supportStations", "nonSupportStations", "supportFacilities"],
			fields: ["orgName", "parentId", "major", "majorLevel", "serviceAircraft", "count", "name", "model", "unit", "stationCode", "facilityCode"],
			sample: "舰载战斗机分队 / 机加 L2 / 技术综合检测仪"
		},
		{
			name: "保障活动",
			detail: "故障维修、预防性维修、任务间保障、使用保障",
			status: "JSON 对齐",
			sheets: ["basicActivityLibrary", "usageSupportActivities", "preventiveMaintenance", "correctiveMaintenance"],
			fields: ["activityName", "activityCode", "aircraftName", "workDuration", "crewList", "equipmentList", "spareList", "planType", "schemeName", "repairType"],
			sample: "机务检查 / 再次出动准备方案 / 原位维修"
		},
		{
			name: "指标分配",
			detail: "实验指标、约束条件、优化目标",
			status: "JSON 对齐",
			sheets: ["experimentConfig.indexList", "constraints", "optimizationTargets"],
			fields: ["indexName", "targetType", "symbol", "targetValue", "taskSuccessRate", "simulationType"],
			sample: "任务可靠度 / 使用可用度 / 保障设备利用率"
		}
	]
};

const MODELING_CONTEXT_ITEMS = ["shipTypes", "initialLayouts", "supportStationCodes", "nonSupportStationCodes"];

const MODELING_CONTRACT = {
	MODELING_CONTEXT_ITEMS,
	MODELING_FUTURE_FIELDS,
	MODELING_SCOPE
};

if (typeof globalThis !== "undefined") {
	globalThis.MODELING_CONTRACT = MODELING_CONTRACT;
}

if (typeof module !== "undefined") {
	module.exports = MODELING_CONTRACT;
}
}());
