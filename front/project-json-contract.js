(function () {
const PROJECT_JSON_SCHEMA_VERSION = "mvp-modeling-v0.1";

const STANDARD_MODELING_OBJECTS = [
	"missionProfiles",
	"equipmentAssets",
	"equipmentTree",
	"supportResources",
	"inventoryResources",
	"supportActivities",
	"metricPlans"
];

const MODELING_OBJECT_METADATA = {
	missionProfiles: {
		tableName: "missionProfiles",
		label: "任务建模",
		rawSources: ["basicTasks", "compositeTasks", "periodicTasks", "basicUsageUnits"],
		uniqueFields: ["id", "taskNo"],
		fields: {
			id: { required: true, kind: "id" },
			taskNo: { required: true, kind: "code" },
			taskName: { required: true, kind: "name" },
			aircraftModel: { required: true, kind: "reference" },
			equipmentAmount: { required: true, kind: "nonNegativeInteger" },
			durationMinutes: { required: true, kind: "nonNegativeNumber", unit: "minute" },
			prepTimeMinutes: { required: false, kind: "nonNegativeNumber", unit: "minute" },
			cancelTimeMinutes: { required: false, kind: "nonNegativeNumber", unit: "minute" },
			memberNos: { required: false, kind: "referenceList" },
			usageGuarantee: { required: false, kind: "reference" }
		}
	},
	equipmentAssets: {
		tableName: "equipmentAssets",
		label: "装备资产",
		rawSources: ["aircraftPools"],
		uniqueFields: ["id", "aircraftCode"],
		fields: {
			id: { required: true, kind: "id" },
			aircraftType: { required: true, kind: "name" },
			aircraftCode: { required: true, kind: "code" },
			supportOrg: { required: false, kind: "reference" },
			currentStatus: { required: true, kind: "name" },
			totalServiceYears: { required: false, kind: "nonNegativeNumber" },
			totalServiceTakeoffLanding: { required: false, kind: "nonNegativeInteger" }
		}
	},
	equipmentTree: {
		tableName: "equipmentTree",
		label: "装备组成",
		rawSources: ["equipmentTree"],
		uniqueFields: ["id"],
		futureFields: {
			rbdStructure: ["parentId", "relationType", "successThreshold"]
		},
		fields: {
			id: { required: true, kind: "id" },
			nodeLevel: { required: true, kind: "nonNegativeInteger" },
			nodeName: { required: true, kind: "name" },
			model: { required: false, kind: "string" },
			quantity: { required: false, kind: "nonNegativeInteger" },
			isLru: { required: false, kind: "boolean" },
			lruFailureRate: { required: false, kind: "nonNegativeNumber" },
			mtbcf: { required: false, kind: "nonNegativeNumber", unit: "hour" },
			mttr: { required: false, kind: "nonNegativeNumber", unit: "hour" },
			detectionTime: { required: false, kind: "nonNegativeNumber", unit: "minute" },
			isDetectable: { required: false, kind: "boolean" }
		}
	},
	supportResources: {
		tableName: "supportResources",
		label: "保障组织与资源",
		rawSources: [
			"supportOrganizationTree",
			"supportStaff",
			"supportEquipment",
			"supportStations",
			"nonSupportStations",
			"supportFacilities",
			"stationFacilityMatrix"
		],
		uniqueFields: ["id", "stationCode", "facilityCode"],
		fields: {
			id: { required: true, kind: "id" },
			orgName: { required: false, kind: "name" },
			major: { required: false, kind: "name" },
			majorLevel: { required: false, kind: "name" },
			serviceAircraft: { required: false, kind: "referenceList" },
			staffCount: { required: false, kind: "nonNegativeInteger" },
			equipmentName: { required: false, kind: "name" },
			equipmentCount: { required: false, kind: "nonNegativeInteger" },
			stationCode: { required: false, kind: "code" },
			stationName: { required: false, kind: "name" },
			facilityCode: { required: false, kind: "code" },
			facilityName: { required: false, kind: "name" },
			facilityMap: { required: false, kind: "object" }
		}
	},
	inventoryResources: {
		tableName: "inventoryResources",
		label: "备件与弹药",
		rawSources: ["spareParts", "ammunition"],
		uniqueFields: ["id"],
		fields: {
			id: { required: true, kind: "id" },
			resourceType: { required: true, kind: "enum", values: ["sparePart", "ammunition"] },
			name: { required: true, kind: "name" },
			model: { required: true, kind: "name" },
			count: { required: true, kind: "nonNegativeInteger" },
			relatedComponentId: { required: false, kind: "reference" }
		}
	},
	supportActivities: {
		tableName: "supportActivities",
		label: "保障活动",
		rawSources: ["basicActivityLibrary", "usageSupportActivities", "preventiveMaintenance", "correctiveMaintenance"],
		uniqueFields: ["id", "activityCode"],
		fields: {
			id: { required: true, kind: "id" },
			activityCode: { required: false, kind: "code" },
			activityName: { required: true, kind: "name" },
			activityType: { required: true, kind: "name" },
			aircraftName: { required: false, kind: "reference" },
			workDurationHours: { required: false, kind: "nonNegativeNumber", unit: "hour" },
			crewList: { required: false, kind: "list" },
			equipmentList: { required: false, kind: "list" },
			spareList: { required: false, kind: "list" },
			basicActivityCode: { required: false, kind: "reference" },
			schemeName: { required: false, kind: "name" },
			planStopTimeMinutes: { required: false, kind: "nonNegativeNumber", unit: "minute" },
			repairObject: { required: false, kind: "reference" },
			precedingWork: { required: false, kind: "string" }
		}
	},
	metricPlans: {
		tableName: "metricPlans",
		label: "指标方案",
		rawSources: ["experimentConfig.indexList", "constraints", "optimizationTargets"],
		uniqueFields: ["id"],
		fields: {
			id: { required: true, kind: "id" },
			indexName: { required: false, kind: "name" },
			targetType: { required: true, kind: "name" },
			symbol: { required: false, kind: "enum", values: ["≥", "≤", "="] },
			targetValue: { required: true, kind: "probabilityOrNumber" },
			simulationType: { required: false, kind: "name" },
			taskSuccessRate: { required: false, kind: "probability" },
			randomControl: { required: false, kind: "name" },
			crewWorkTimeHours: { required: false, kind: "nonNegativeNumber", unit: "hour" },
			crewRestTimeHours: { required: false, kind: "nonNegativeNumber", unit: "hour" },
			handoverTimeMinutes: { required: false, kind: "nonNegativeNumber", unit: "minute" }
		}
	}
};

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function emptyTables() {
	return Object.fromEntries(STANDARD_MODELING_OBJECTS.map((objectName) => [objectName, []]));
}

function isBlank(value) {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function cleanNullable(value) {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed || trimmed.toLowerCase() === "null") return null;
	return trimmed;
}

function toStringOrNull(value) {
	const cleaned = cleanNullable(value);
	return cleaned === null ? null : String(cleaned);
}

function toNumberOrNull(value) {
	const cleaned = cleanNullable(value);
	if (cleaned === null) return null;
	if (typeof cleaned === "number") return Number.isFinite(cleaned) ? cleaned : null;
	if (typeof cleaned === "string" && cleaned.endsWith("%")) {
		const numberValue = Number(cleaned.slice(0, -1));
		return Number.isFinite(numberValue) ? numberValue / 100 : null;
	}
	const numberValue = Number(cleaned);
	return Number.isFinite(numberValue) ? numberValue : null;
}

function toIntegerOrNull(value) {
	const numberValue = toNumberOrNull(value);
	return numberValue === null ? null : Math.trunc(numberValue);
}

function isProbabilityLabel(value) {
	return /可靠度|可用度|完好率|利用率|满足率|成功率/.test(String(value || ""));
}

function toProbabilityOrNumber(value, label) {
	const numberValue = toNumberOrNull(value);
	if (numberValue === null) return null;
	if (isProbabilityLabel(label) && numberValue > 1 && numberValue <= 100) return numberValue / 100;
	return numberValue;
}

function toBooleanOrNull(value) {
	const cleaned = cleanNullable(value);
	if (cleaned === null) return null;
	if (typeof cleaned === "boolean") return cleaned;
	if (cleaned === 1 || cleaned === "1" || cleaned === "是" || cleaned === "true") return true;
	if (cleaned === 0 || cleaned === "0" || cleaned === "否" || cleaned === "false") return false;
	return Boolean(cleaned);
}

function splitList(value, separator = /[,、]/) {
	const cleaned = cleanNullable(value);
	if (cleaned === null) return [];
	if (Array.isArray(cleaned)) {
		return cleaned
			.map((item) => cleanNullable(item))
			.filter((item) => item !== null)
			.map((item) => String(item).trim())
			.filter((item) => item && item.toLowerCase() !== "null");
	}
	return String(cleaned)
		.split(separator)
		.map((item) => item.trim())
		.filter((item) => item && item.toLowerCase() !== "null");
}

function listFrom(value) {
	return Array.isArray(value) ? value : [];
}

function cleanCountList(items) {
	return listFrom(items).map((item) => {
		const cleaned = { ...item };
		if ("requiredCount" in cleaned) cleaned.requiredCount = toIntegerOrNull(cleaned.requiredCount) ?? 0;
		return cleaned;
	});
}

function stableId(prefix, value, index) {
	const cleaned = cleanNullable(value);
	return `${prefix}:${cleaned === null ? index + 1 : cleaned}`;
}

function sourceRecordId(sourceName, rawId, fallbackValue, index) {
	const cleanedRawId = cleanNullable(rawId);
	if (cleanedRawId !== null) return `${sourceName}:${cleanedRawId}`;
	return stableId(sourceName, fallbackValue, index);
}

function hasNormalizedTables(input) {
	return Boolean(input && typeof input === "object" && input.tables && typeof input.tables === "object");
}

function normalizeProjectJson(input = {}) {
	const project = hasNormalizedTables(input) ? normalizeExistingProjectJson(input) : normalizeWorkbookJson(input);
	project.validation = validateNormalizedProjectJson(project);
	return project;
}

function normalizeExistingProjectJson(input) {
	const project = clone(input);
	const tables = emptyTables();
	for (const objectName of STANDARD_MODELING_OBJECTS) {
		tables[objectName] = listFrom(project.tables?.[objectName]).map((record) => clone(record));
	}
	return {
		projectId: project.projectId || "project-draft",
		projectName: project.projectName || "未命名项目",
		schemaVersion: project.schemaVersion || PROJECT_JSON_SCHEMA_VERSION,
		tables,
		validation: project.validation || { status: "draft", errors: [], warnings: [] },
		sourceTrace: project.sourceTrace || { origin: "user-authored", importedSheets: [] }
	};
}

function normalizeWorkbookJson(input) {
	const workbook = input || {};
	const tables = emptyTables();
	const importedSheets = [];
	const pushSheet = (sheetName) => {
		if (Object.prototype.hasOwnProperty.call(workbook, sheetName)) importedSheets.push(sheetName);
	};

	pushSheet("basicTasks");
	tables.missionProfiles.push(...listFrom(workbook.basicTasks).map((row, index) => ({
		id: sourceRecordId("basicTasks", row.id, row.taskName, index),
		taskNo: toStringOrNull(row.taskNo),
		taskName: toStringOrNull(row.taskName),
		aircraftModel: toStringOrNull(row.aircraftModel),
		equipmentAmount: toIntegerOrNull(row.equipmentAmount) ?? 0,
		durationMinutes: toNumberOrNull(row.duration) ?? 0,
		prepTimeMinutes: toNumberOrNull(row.prepTime),
		cancelTimeMinutes: toNumberOrNull(row.cancelTime),
		usageGuarantee: toStringOrNull(row.usageGuarantee)
	})));

	pushSheet("compositeTasks");
	tables.missionProfiles.push(...listFrom(workbook.compositeTasks).map((row, index) => ({
		id: sourceRecordId("compositeTasks", row.id, row.compositeTaskName, index),
		taskNo: toStringOrNull(row.taskNo) || sourceRecordId("compositeTasks", row.id, `${row.compositeTaskName || "task"}:${index + 1}`, index),
		taskName: toStringOrNull(row.compositeTaskName),
		aircraftModel: toStringOrNull(row.equipmentType),
		equipmentAmount: toIntegerOrNull(row.equipmentAmount) ?? 0,
		durationMinutes: 0,
		formationName: toStringOrNull(row.formationName),
		issueTime: toStringOrNull(row.issueTime),
		firstDispatchTime: toStringOrNull(row.firstDispatchTime),
		dayRepeatTimes: toIntegerOrNull(row.dayRepeatTimes) ?? 0,
		intervalHours: toNumberOrNull(row.intervalHours)
	})));

	pushSheet("periodicTasks");
	tables.missionProfiles.push(...listFrom(workbook.periodicTasks).map((row, index) => ({
		id: sourceRecordId("periodicTasks", row.id, row.taskName, index),
		taskNo: toStringOrNull(row.taskNo) || sourceRecordId("periodicTasks", row.id, `${row.taskName || "task"}:${index + 1}`, index),
		taskName: toStringOrNull(row.taskName),
		aircraftModel: toStringOrNull(row.aircraftModel) || "未指定",
		equipmentAmount: toIntegerOrNull(row.equipmentAmount) ?? 0,
		durationMinutes: 0,
		repeatWeeks: toIntegerOrNull(row.repeatWeeks),
		subTasks: listFrom(row.subTasks).map((subTask) => ({
			...subTask,
			week: toIntegerOrNull(subTask.week) ?? subTask.week
		}))
	})));

	pushSheet("basicUsageUnits");
	tables.missionProfiles.push(...listFrom(workbook.basicUsageUnits).map((row, index) => ({
		id: stableId("basicUsageUnits", row.formationName, index),
		taskNo: stableId("basicUsageUnits", row.formationName, index),
		taskName: toStringOrNull(row.formationName),
		aircraftModel: toStringOrNull(row.equipmentType),
		equipmentAmount: toIntegerOrNull(row.demandAmount) ?? 0,
		durationMinutes: 0,
		formationName: toStringOrNull(row.formationName),
		demandAmount: toIntegerOrNull(row.demandAmount) ?? 0,
		setupAmount: toIntegerOrNull(row.setupAmount) ?? 0,
		memberNos: splitList(row.memberNos, /[、,]/)
	})));

	pushSheet("aircraftPools");
	tables.equipmentAssets.push(...listFrom(workbook.aircraftPools).map((row, index) => ({
		id: sourceRecordId("aircraftPools", row.id, row.aircraftCode, index),
		aircraftType: toStringOrNull(row.aircraftType),
		aircraftCode: toStringOrNull(row.aircraftCode),
		supportOrg: toStringOrNull(row.supportOrg),
		currentStatus: toStringOrNull(row.currentStatus) || "在册完好",
		factoryDate: toStringOrNull(row.factoryDate),
		totalServiceYears: toNumberOrNull(row.totalServiceYears),
		totalServiceLife: toStringOrNull(row.totalServiceLife),
		totalServiceTakeoffLanding: toIntegerOrNull(row.totalServiceTakeoffLanding),
		remainingLife: toStringOrNull(row.remainingLife),
		flightTime: toStringOrNull(row.flightTime)
	})));

	pushSheet("equipmentTree");
	tables.equipmentTree.push(...listFrom(workbook.equipmentTree).map((row, index) => ({
		id: sourceRecordId("equipmentTree", row.id, `${row.nodeName || "node"}:${index + 1}`, index),
		nodeLevel: toIntegerOrNull(row.nodeLevel) ?? 0,
		nodeName: toStringOrNull(row.nodeName),
		model: toStringOrNull(row.model),
		quantity: toIntegerOrNull(row.quantity) ?? 1,
		isLru: toBooleanOrNull(row.isLru) ?? false,
		lruFailureRate: toNumberOrNull(row.lruFailureRate),
		kValue: toNumberOrNull(row.kValue),
		faultDistribution: toStringOrNull(row.faultDistribution),
		repairDistribution: toStringOrNull(row.repairDistribution),
		mtbcf: toNumberOrNull(row.mtbcf),
		mttr: toNumberOrNull(row.mttr),
		detectionTime: toNumberOrNull(row.detectionTime),
		isDetectable: toBooleanOrNull(row.isDetectable)
	})));

	pushSheet("supportOrganizationTree");
	tables.supportResources.push(...listFrom(workbook.supportOrganizationTree).map((row, index) => ({
		id: sourceRecordId("supportOrganizationTree", row.id, row.orgName, index),
		orgName: toStringOrNull(row.orgName),
		parentId: toStringOrNull(row.parentId),
		orgDescription: toStringOrNull(row.orgDescription)
	})));

	pushSheet("supportStaff");
	tables.supportResources.push(...listFrom(workbook.supportStaff).map((row, index) => ({
		id: sourceRecordId("supportStaff", row.id, `${row.major || "staff"}:${index + 1}`, index),
		organization: toStringOrNull(row.organization),
		major: toStringOrNull(row.major),
		majorLevel: toStringOrNull(row.majorLevel),
		serviceAircraft: splitList(row.serviceAircraft),
		staffCount: toIntegerOrNull(row.count) ?? 0
	})));

	pushSheet("supportEquipment");
	tables.supportResources.push(...listFrom(workbook.supportEquipment).map((row, index) => ({
		id: sourceRecordId("supportEquipment", row.id, row.name, index),
		equipmentName: toStringOrNull(row.name),
		equipmentModel: toStringOrNull(row.model),
		equipmentCount: toIntegerOrNull(row.count) ?? 0,
		unit: toStringOrNull(row.unit) || "台",
		organizeName: toStringOrNull(row.organizeName)
	})));

	pushSheet("supportStations");
	tables.supportResources.push(...listFrom(workbook.supportStations).map((row, index) => ({
		id: sourceRecordId("supportStations", row.id, row.stationCode, index),
		stationCode: toStringOrNull(row.stationCode),
		stationName: toStringOrNull(row.stationName),
		stationType: "support"
	})));

	pushSheet("nonSupportStations");
	tables.supportResources.push(...listFrom(workbook.nonSupportStations).map((row, index) => ({
		id: sourceRecordId("nonSupportStations", row.id, row.stationCode, index),
		stationCode: toStringOrNull(row.stationCode),
		stationName: toStringOrNull(row.stationName),
		stationType: "nonSupport"
	})));

	pushSheet("supportFacilities");
	tables.supportResources.push(...listFrom(workbook.supportFacilities).map((row, index) => ({
		id: sourceRecordId("supportFacilities", row.id, row.facilityCode, index),
		facilityCode: toStringOrNull(row.facilityCode),
		facilityName: toStringOrNull(row.facilityName),
		functionType: toStringOrNull(row.functionType)
	})));

	pushSheet("stationFacilityMatrix");
	tables.supportResources.push(...listFrom(workbook.stationFacilityMatrix).map((row, index) => ({
		id: stableId("stationFacilityMatrix", row.stationName, index),
		stationName: toStringOrNull(row.stationName),
		facilityMap: clone(row.facilityMap || {})
	})));

	pushSheet("spareParts");
	tables.inventoryResources.push(...listFrom(workbook.spareParts).map((row, index) => ({
		id: sourceRecordId("spareParts", row.id, `${row.name || "spare"}:${row.model || index + 1}`, index),
		resourceType: "sparePart",
		name: toStringOrNull(row.name),
		model: toStringOrNull(row.model),
		count: toIntegerOrNull(row.count) ?? 0
	})));

	pushSheet("ammunition");
	tables.inventoryResources.push(...listFrom(workbook.ammunition).map((row, index) => ({
		id: sourceRecordId("ammunition", row.id, `${row.name || "ammo"}:${row.model || index + 1}`, index),
		resourceType: "ammunition",
		name: toStringOrNull(row.name),
		model: toStringOrNull(row.model),
		count: toIntegerOrNull(row.count) ?? 0
	})));

	pushSheet("basicActivityLibrary");
	tables.supportActivities.push(...listFrom(workbook.basicActivityLibrary).map((row, index) => ({
		id: sourceRecordId("basicActivityLibrary", row.id, row.activityCode, index),
		activityCode: toStringOrNull(row.activityCode),
		activityName: toStringOrNull(row.activityName),
		activityType: toStringOrNull(row.activityType) || "basic",
		aircraftName: toStringOrNull(row.aircraftName),
		workDurationHours: toNumberOrNull(row.workDuration),
		crewList: cleanCountList(row.crewList),
		serviceList: cleanCountList(row.serviceList),
		facilityList: splitList(row.facilityList),
		equipmentList: cleanCountList(row.equipmentList),
		ammoList: cleanCountList(row.ammoList),
		spareList: cleanCountList(row.spareList)
	})));

	pushSheet("usageSupportActivities");
	tables.supportActivities.push(...listFrom(workbook.usageSupportActivities).map((row, index) => ({
		id: sourceRecordId("usageSupportActivities", row.id, `${row.activityName || "usage"}:${index + 1}`, index),
		activityName: toStringOrNull(row.activityName),
		activityType: "usage",
		planType: toStringOrNull(row.planType),
		basicActivityCode: toStringOrNull(row.basicActivityCode),
		planWorkItem: toStringOrNull(row.planWorkItem),
		precedingWork: toStringOrNull(row.precedingWork)
	})));

	pushSheet("preventiveMaintenance");
	tables.supportActivities.push(...listFrom(workbook.preventiveMaintenance).map((row, index) => ({
		id: sourceRecordId("preventiveMaintenance", row.id, row.schemeName, index),
		activityName: toStringOrNull(row.schemeName),
		activityType: "preventiveMaintenance",
		schemeName: toStringOrNull(row.schemeName),
		planStopTimeMinutes: toNumberOrNull(row.planStopTime),
		precedingWork: toStringOrNull(row.precedingWork)
	})));

	pushSheet("correctiveMaintenance");
	tables.supportActivities.push(...listFrom(workbook.correctiveMaintenance).map((row, index) => ({
		id: sourceRecordId("correctiveMaintenance", row.id, row.repairObject, index),
		activityName: toStringOrNull(row.repairObject),
		activityType: "correctiveMaintenance",
		repairObject: toStringOrNull(row.repairObject),
		repairType: splitList(row.repairType),
		precedingWork: toStringOrNull(row.precedingWork)
	})));

	if (workbook.experimentConfig?.indexList) {
		importedSheets.push("experimentConfig.indexList");
		tables.metricPlans.push(...listFrom(workbook.experimentConfig.indexList).map((row, index) => ({
			id: sourceRecordId("experimentConfig.indexList", row.id, row.indexName, index),
			indexName: toStringOrNull(row.indexName),
			targetType: toStringOrNull(row.indexName),
			targetValue: toProbabilityOrNumber(row.targetValue, row.indexName),
			simulationType: toStringOrNull(workbook.experimentConfig.simulationType),
			taskSuccessRate: toProbabilityOrNumber(workbook.experimentConfig.taskSuccessRate, "任务成功率"),
			randomControl: toStringOrNull(workbook.experimentConfig.randomControl),
			crewWorkTimeHours: toNumberOrNull(workbook.experimentConfig.crewWorkTime),
			crewRestTimeHours: toNumberOrNull(workbook.experimentConfig.crewRestTime),
			handoverTimeMinutes: toNumberOrNull(workbook.experimentConfig.handoverTime)
		})));
	}

	pushSheet("constraints");
	tables.metricPlans.push(...listFrom(workbook.constraints).map((row, index) => ({
		id: stableId("constraints", `${row.targetType || "target"}:${row.symbol || "symbol"}:${row.targetValue ?? index + 1}`, index),
		targetType: toStringOrNull(row.targetType),
		symbol: toStringOrNull(row.symbol) || "≥",
		targetValue: toProbabilityOrNumber(row.targetValue, row.targetType)
	})));

	pushSheet("optimizationTargets");
	tables.metricPlans.push(...listFrom(workbook.optimizationTargets).map((row, index) => ({
		id: sourceRecordId("optimizationTargets", row.id, row.targetType, index),
		targetType: toStringOrNull(row.targetType),
		symbol: toStringOrNull(row.symbol) || "≥",
		targetValue: toProbabilityOrNumber(row.targetValue, row.targetType)
	})));

	return {
		projectId: workbook.projectId || "project-draft",
		projectName: workbook.projectName || "未命名项目",
		schemaVersion: PROJECT_JSON_SCHEMA_VERSION,
		tables,
		validation: { status: "draft", errors: [], warnings: [] },
		sourceTrace: {
			origin: "workbook-json",
			importedSheets
		}
	};
}

function createProjectJsonState({ projectId = "project-draft", projectName = "未命名项目", projectJson } = {}) {
	const project = projectJson
		? normalizeProjectJson(projectJson)
		: {
			projectId,
			projectName,
			schemaVersion: PROJECT_JSON_SCHEMA_VERSION,
			tables: emptyTables(),
			validation: { status: "draft", errors: [], warnings: [] },
			sourceTrace: { origin: "user-authored", importedSheets: [] }
		};
	return {
		project,
		dirtyStatus: "clean",
		lastSavedProjectJson: clone(project)
	};
}

function withValidation(project) {
	const nextProject = clone(project);
	nextProject.validation = validateProjectJson(nextProject);
	return nextProject;
}

function upsertProjectRecord(state, tableName, record) {
	if (!STANDARD_MODELING_OBJECTS.includes(tableName)) {
		throw new Error(`Unknown modeling table: ${tableName}`);
	}
	const nextState = clone(state);
	const table = nextState.project.tables[tableName];
	const recordId = record.id;
	const index = table.findIndex((item) => item.id === recordId);
	if (index >= 0) table[index] = { ...table[index], ...clone(record) };
	else table.push(clone(record));
	nextState.project = withValidation(nextState.project);
	nextState.dirtyStatus = "dirty";
	return nextState;
}

function applyProjectRecordDelete(state, tableName, recordId) {
	if (!STANDARD_MODELING_OBJECTS.includes(tableName)) {
		throw new Error(`Unknown modeling table: ${tableName}`);
	}
	const references = findRecordReferences(state.project, tableName, recordId);
	if (references.length > 0) {
		const nextState = clone(state);
		nextState.project.validation = {
			status: "invalid",
			errors: references.map((reference) => ({
				rule: "deleteBlockedByReference",
				tableName,
				recordId,
				message: `Cannot delete ${recordId}; referenced by ${reference.tableName}.${reference.field}: ${reference.value}`
			})),
			warnings: []
		};
		return { deleted: false, state: nextState, references };
	}
	const nextState = clone(state);
	nextState.project.tables[tableName] = nextState.project.tables[tableName].filter((record) => record.id !== recordId);
	nextState.project = withValidation(nextState.project);
	nextState.dirtyStatus = "dirty";
	return { deleted: true, state: nextState, references: [] };
}

function addError(errors, rule, tableName, recordId, field, message) {
	errors.push({ rule, tableName, recordId, field, message });
}

function validateProjectJson(projectJson) {
	const project = hasNormalizedTables(projectJson) ? normalizeExistingProjectJson(projectJson) : normalizeWorkbookJson(projectJson);
	return validateNormalizedProjectJson(project);
}

function validateNormalizedProjectJson(project) {
	const errors = [];
	const warnings = [];

	for (const tableName of STANDARD_MODELING_OBJECTS) {
		const metadata = MODELING_OBJECT_METADATA[tableName];
		const records = project.tables[tableName];
		validateRequiredFields(records, metadata, errors);
		validateUniqueFields(records, metadata, errors);
		validateFieldKinds(records, metadata, errors);
	}

	validateReferences(project, errors);

	return {
		status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
		errors,
		warnings
	};
}

function validateRequiredFields(records, metadata, errors) {
	for (const record of records) {
		for (const [fieldName, fieldMeta] of Object.entries(metadata.fields)) {
			if (fieldMeta.required && isBlank(record[fieldName])) {
				addError(errors, "required", metadata.tableName, record.id, fieldName, `${fieldName} is required`);
			}
		}
	}
}

function validateUniqueFields(records, metadata, errors) {
	for (const fieldName of metadata.uniqueFields || []) {
		const seen = new Map();
		for (const record of records) {
			const value = record[fieldName];
			if (isBlank(value)) continue;
			if (seen.has(value)) {
				addError(errors, "unique", metadata.tableName, record.id, fieldName, `${fieldName} must be unique: ${value}`);
				continue;
			}
			seen.set(value, record.id);
		}
	}
}

function validateFieldKinds(records, metadata, errors) {
	for (const record of records) {
		for (const [fieldName, fieldMeta] of Object.entries(metadata.fields)) {
			const value = record[fieldName];
			if (isBlank(value)) continue;
			if (fieldMeta.unit && typeof value !== "number") {
				addError(errors, "timeUnit", metadata.tableName, record.id, fieldName, `${fieldName} must be a number with ${fieldMeta.unit} unit`);
				continue;
			}
			if (fieldMeta.kind === "nonNegativeInteger") {
				if (!isNonNegativeNumber(value)) {
					addError(errors, "nonNegative", metadata.tableName, record.id, fieldName, `${fieldName} must be non-negative`);
				} else if (!Number.isInteger(value)) {
					addError(errors, "integer", metadata.tableName, record.id, fieldName, `${fieldName} must be an integer`);
				}
			}
			if (fieldMeta.kind === "nonNegativeNumber" && !isNonNegativeNumber(value)) {
				addError(errors, "nonNegative", metadata.tableName, record.id, fieldName, `${fieldName} must be non-negative`);
			}
			if (fieldMeta.kind === "probability" && !isProbability(value)) {
				addError(errors, "probability", metadata.tableName, record.id, fieldName, `${fieldName} must be between 0 and 1`);
			}
			if (fieldMeta.kind === "probabilityOrNumber" && looksLikeProbabilityField(record) && !isProbability(value)) {
				addError(errors, "probability", metadata.tableName, record.id, fieldName, `${fieldName} must be normalized to 0..1`);
			}
			if (fieldMeta.kind === "enum" && !fieldMeta.values.includes(value)) {
				addError(errors, "enum", metadata.tableName, record.id, fieldName, `${fieldName} must be one of ${fieldMeta.values.join(", ")}`);
			}
			if (fieldMeta.kind === "boolean" && typeof value !== "boolean") {
				addError(errors, "boolean", metadata.tableName, record.id, fieldName, `${fieldName} must be boolean`);
			}
			if (fieldMeta.kind === "list" && !Array.isArray(value)) {
				addError(errors, "list", metadata.tableName, record.id, fieldName, `${fieldName} must be an array`);
			}
			if (fieldMeta.kind === "referenceList" && !Array.isArray(value)) {
				addError(errors, "referenceList", metadata.tableName, record.id, fieldName, `${fieldName} must be an array of references`);
			}
			if (fieldMeta.kind === "object" && (typeof value !== "object" || Array.isArray(value))) {
				addError(errors, "object", metadata.tableName, record.id, fieldName, `${fieldName} must be an object`);
			}
		}
		validateNestedNonNegative(metadata.tableName, record, errors);
	}
}

function validateNestedNonNegative(tableName, record, errors) {
	for (const [fieldName, value] of Object.entries(record)) {
		if (!Array.isArray(value)) continue;
		for (const [index, item] of value.entries()) {
			if (item && typeof item === "object" && "requiredCount" in item && !isNonNegativeNumber(item.requiredCount)) {
				addError(errors, "nonNegative", tableName, record.id, `${fieldName}.${index}.requiredCount`, "requiredCount must be non-negative");
			}
		}
	}
}

function isNonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function looksLikeProbabilityField(record) {
	const text = `${record.indexName || ""} ${record.targetType || ""}`;
	return /可靠度|可用度|完好率|利用率|满足率|成功率/.test(text);
}

function isProbability(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateReferences(project, errors) {
	const aircraftCodes = new Set(project.tables.equipmentAssets.map((record) => record.aircraftCode).filter(Boolean));
	const aircraftTypes = new Set(project.tables.equipmentAssets.map((record) => record.aircraftType).filter(Boolean));
	const equipmentNodeNames = new Set(project.tables.equipmentTree.map((record) => record.nodeName).filter(Boolean));
	const activityNames = new Set(project.tables.supportActivities.map((record) => record.activityName).filter(Boolean));
	const activityCodes = new Set(project.tables.supportActivities.map((record) => record.activityCode).filter(Boolean));
	const inventoryKeys = new Set(project.tables.inventoryResources.map((record) => `${record.name}::${record.model}`));

	for (const mission of project.tables.missionProfiles) {
		for (const aircraftCode of listFrom(mission.memberNos)) {
			if (!aircraftCodes.has(aircraftCode)) {
				addError(errors, "reference", "missionProfiles", mission.id, "memberNos", `Unknown equipment asset ${aircraftCode}`);
			}
		}
		if (mission.aircraftModel && !aircraftTypes.has(mission.aircraftModel) && !hasTopEquipmentNode(project, mission.aircraftModel)) {
			addError(errors, "reference", "missionProfiles", mission.id, "aircraftModel", `Unknown aircraft model ${mission.aircraftModel}`);
		}
		if (mission.usageGuarantee && !activityNames.has(mission.usageGuarantee)) {
			addError(errors, "reference", "missionProfiles", mission.id, "usageGuarantee", `Unknown support activity ${mission.usageGuarantee}`);
		}
	}

	for (const activity of project.tables.supportActivities) {
		if (activity.aircraftName && !aircraftTypes.has(activity.aircraftName) && !hasTopEquipmentNode(project, activity.aircraftName)) {
			addError(errors, "reference", "supportActivities", activity.id, "aircraftName", `Unknown aircraft ${activity.aircraftName}`);
		}
		if (activity.basicActivityCode && !activityCodes.has(activity.basicActivityCode)) {
			addError(errors, "reference", "supportActivities", activity.id, "basicActivityCode", `Unknown basic activity ${activity.basicActivityCode}`);
		}
		if (activity.repairObject && !equipmentNodeNames.has(activity.repairObject)) {
			addError(errors, "reference", "supportActivities", activity.id, "repairObject", `Unknown equipment node ${activity.repairObject}`);
		}
		for (const item of listFrom(activity.spareList)) {
			const key = `${item.spareName}::${item.spareModel}`;
			if (item.spareName && item.spareModel && !inventoryKeys.has(key)) {
				addError(errors, "reference", "supportActivities", activity.id, "spareList", `Unknown spare ${key}`);
			}
		}
	}
}

function hasTopEquipmentNode(project, nodeName) {
	return project.tables.equipmentTree.some((record) => record.nodeLevel === 1 && record.nodeName === nodeName);
}

function findRecordReferences(projectJson, tableName, recordId) {
	const project = normalizeExistingProjectJson(normalizeProjectJson(projectJson));
	const record = project.tables[tableName].find((item) => item.id === recordId);
	if (!record) return [];
	const references = [];

	if (tableName === "equipmentAssets") {
		for (const mission of project.tables.missionProfiles) {
			if (record.aircraftCode && listFrom(mission.memberNos).includes(record.aircraftCode)) {
				references.push({ tableName: "missionProfiles", recordId: mission.id, field: "memberNos", value: record.aircraftCode });
			}
			if (record.aircraftType && mission.aircraftModel === record.aircraftType) {
				references.push({ tableName: "missionProfiles", recordId: mission.id, field: "aircraftModel", value: record.aircraftType });
			}
		}
	}

	if (tableName === "inventoryResources") {
		const key = `${record.name}::${record.model}`;
		for (const activity of project.tables.supportActivities) {
			for (const item of listFrom(activity.spareList)) {
				if (`${item.spareName}::${item.spareModel}` === key) {
					references.push({ tableName: "supportActivities", recordId: activity.id, field: "spareList", value: key });
				}
			}
		}
	}

	if (tableName === "supportActivities") {
		for (const mission of project.tables.missionProfiles) {
			if (record.activityName && mission.usageGuarantee === record.activityName) {
				references.push({ tableName: "missionProfiles", recordId: mission.id, field: "usageGuarantee", value: record.activityName });
			}
		}
		for (const activity of project.tables.supportActivities) {
			if (record.activityCode && activity.basicActivityCode === record.activityCode) {
				references.push({ tableName: "supportActivities", recordId: activity.id, field: "basicActivityCode", value: record.activityCode });
			}
		}
	}

	if (tableName === "equipmentTree") {
		for (const activity of project.tables.supportActivities) {
			if (record.nodeName && activity.repairObject === record.nodeName) {
				references.push({ tableName: "supportActivities", recordId: activity.id, field: "repairObject", value: record.nodeName });
			}
		}
	}

	return references;
}

function exportProjectJson(projectJson) {
	const project = normalizeProjectJson(projectJson);
	const validation = validateProjectJson(project);
	const exported = {
		...project,
		validation
	};
	return {
		fileName: `${exported.projectId}-${exported.schemaVersion}.json`,
		runnable: validation.status === "valid",
		projectJson: exported
	};
}

const PROJECT_JSON_CONTRACT = {
	MODELING_OBJECT_METADATA,
	PROJECT_JSON_SCHEMA_VERSION,
	STANDARD_MODELING_OBJECTS,
	applyProjectRecordDelete,
	createProjectJsonState,
	exportProjectJson,
	normalizeProjectJson,
	upsertProjectRecord,
	validateProjectJson
};

if (typeof globalThis !== "undefined") {
	globalThis.PROJECT_JSON_CONTRACT = PROJECT_JSON_CONTRACT;
}

if (typeof module !== "undefined") {
	module.exports = PROJECT_JSON_CONTRACT;
}
}());
