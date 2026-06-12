# MVP 建模 JSON Schema 文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | V0.1 |
| 更新日期 | 2026-06-12 |
| 文档性质 | 人可读、可评审、供下一步实现使用的 MVP 建模 JSON Schema |
| 输入依据 | `front/modeling-contract.js`、`docs/modeling-detailed-requirements.md`、`core/dataset/data_new.json` |
| 不做事项 | 不提供机器校验器、不实现前端可编辑表格、不实现后端 API、不实现 `core/` adapter、不做真实导入导出、不做数据库设计 |

## 1. 范围和命名

本文把当前 `front/modeling-contract.js` 中的展示契约升级为可供前端表单、后端 API、`core/` adapter 和导入导出设计共用的字段契约输入。本文仍是人可读 schema 文档，不是 JSON Schema 机器校验器。

标准对象覆盖：

| 标准对象 | 来源 sheet | 覆盖业务域 |
| --- | --- | --- |
| `missionProfiles` | `basicTasks`、`compositeTasks`、`periodicTasks`、`basicUsageUnits` | 任务建模 |
| `equipmentAssets` | `aircraftPools` | 装备资产 |
| `equipmentTree` | `equipmentTree` | 装备组成、部件/LRU、故障参数、当前层级展示 |
| `supportResources` | `supportOrganizationTree`、`supportStaff`、`supportEquipment`、`supportStations`、`nonSupportStations`、`supportFacilities`、`stationFacilityMatrix` | 保障组织、人员、设备、站位、设施 |
| `inventoryResources` | `spareParts`、`ammunition` | 备件、弹药 |
| `supportActivities` | `basicActivityLibrary`、`usageSupportActivities`、`preventiveMaintenance`、`correctiveMaintenance` | 基本活动、使用保障、预防维修、修复维修 |
| `metricPlans` | `experimentConfig.indexList`、`constraints`、`optimizationTargets` | 指标、约束、优化目标 |

业务域映射必须完整保留当前需求文档中的输入：

| 业务域 | 当前 JSON 来源 |
| --- | --- |
| 任务建模 | `basicTasks`、`compositeTasks`、`periodicTasks`、`basicUsageUnits` |
| 装备建模 | `aircraftPools`、`equipmentTree` |
| 保障组织与资源 | `supportOrganizationTree`、`supportStaff`、`supportEquipment`、`spareParts`、`ammunition`、`supportStations`、`nonSupportStations`、`supportFacilities`、`stationFacilityMatrix` |
| 保障活动 | `basicActivityLibrary`、`usageSupportActivities`、`preventiveMaintenance`、`correctiveMaintenance` |
| 指标与约束 | `experimentConfig.indexList`、`constraints`、`optimizationTargets` |

## 2. 当前 JSON 和历史配置边界

当前 `data_new.json` 的真实 key 是 `nonSupportStations`，不是 `nonSupportStationCodes`。

`supportStationCodes`、`nonSupportStationCodes` 是历史工作簿或后续环境配置项，不是当前 data_new.json 的真实 key。它们可在后续环境配置或站位编码映射中出现，但不得写入本阶段当前 JSON sheet 列表，也不得作为前端建模页主表单对象。

| 名称 | 边界 |
| --- | --- |
| `supportStations` | 当前 JSON sheet，进入 `supportResources` |
| `nonSupportStations` | 当前 JSON sheet，进入 `supportResources` |
| `supportStationCodes` | 历史工作簿或后续环境配置项，不是当前 JSON sheet |
| `nonSupportStationCodes` | 历史工作簿或后续环境配置项，不是当前 JSON sheet |
| `shipTypes` | 后续环境配置项，不是当前 JSON sheet |
| `initialLayouts` | 后续环境配置项，不是当前 JSON sheet |

## 3. 通用导入清洗和字段级校验

这些规则来自建模细化需求的导入清洗和标准化规则，后续前端表单、后端 API、adapter 和导入导出应共用同一口径。

| 规则 | 字段级口径 |
| --- | --- |
| 编号唯一 | 所有带 `id`、`taskNo`、`aircraftCode`、`activityCode`、`stationCode`、`facilityCode` 的对象，在各自对象集合内编号唯一；跨 sheet 名称引用暂保留时，也要能解析到唯一对象。 |
| 名称必填 | 用户可见对象的 `taskName`、`compositeTaskName`、`formationName`、`nodeName`、`orgName`、`name`、`activityName`、`schemeName`、`stationName`、`facilityName`、`indexName` 必填。 |
| 数量非负 | `equipmentAmount`、`demandAmount`、`setupAmount`、`quantity`、`count`、`requiredCount`、`crewWorkTime`、`crewRestTime`、`handoverTime`、`safetyRadius` 等数量、时长、人员数、设备数、库存数不能为负。 |
| 概率范围 0~1 或 0%~100% | `taskSuccessRate`、可靠度、可用度、满足率、完好率和利用率可用 0~1 存储，或用 0%~100% 显示；导入时必须明确转换口径。 |
| 引用对象必须存在 | `basicTaskName` 引用 `basicTasks.taskName`；`formationName` 引用 `basicUsageUnits.formationName`；活动资源引用 `supportStaff`、`supportEquipment`、`supportFacilities`、`spareParts`、`ammunition`；维修对象引用 `equipmentTree.nodeName` 或后续稳定 ID。 |
| 被引用对象不可直接删除 | 被任务、活动、维修方案、指标方案或实验方案引用的对象，不能直接删除；需要先解除引用或生成迁移提示。 |
| 时间字段必须声明单位 | `duration`、`prepTime`、`cancelTime`、`intervalHours`、`workDuration`、`planStopTime`、`crewWorkTime`、`crewRestTime`、`handoverTime` 等必须声明小时、分钟、时刻或 `HH:MM` 工时格式。 |
| 数字字符串导入时转数字 | `duration`、`prepTime`、`cancelTime`、`equipmentAmount`、`repeatWeeks`、`workDuration`、`requiredCount`、`planStopTime` 等当前可能为字符串的数字字段，导入后按字段语义转为 number 或 integer。 |
| `"null"` 字符串/空字符串按语义转空值 | 字符串 `"null"`、空字符串和缺失字段不得原样进入表单；按字段语义转为 `null`、空数组或默认值。 |

### 3.1 raw 到 normalized 转换规则

本文字段表中的“类型”是标准对象 normalized 类型，不等同于当前 `data_new.json` raw 类型。adapter 后续实现时必须记录 raw 字段、raw 类型、转换规则和 normalized 字段。

| raw 字段 | raw 类型/口径 | normalized 字段 | normalized 类型/口径 | 规则 |
| --- | --- | --- | --- | --- |
| `basicUsageUnits.memberNos` | `、` 分隔字符串 | `missionProfiles.memberNos` | `string[]` | `basicUsageUnits.memberNos` raw 为 `、` 分隔字符串，normalized 为 `string[]`；去除空项和首尾空格，逐项引用 `equipmentAssets.aircraftCode`。 |
| `supportStaff.serviceAircraft` | `,` 分隔字符串 | `supportResources.serviceAircraft` | `string[]` | `supportStaff.serviceAircraft` raw 为 `,` 分隔字符串，normalized 为 `string[]`；去除空项和首尾空格，逐项引用 `equipmentAssets.aircraftType`、`equipmentTree` 顶层 `nodeName` 或后续装备类型/别名字典。 |
| `equipmentTree.isLru`、`equipmentTree.isDetectable` | `0/1` 数字 | `equipmentTree.isLru`、`equipmentTree.isDetectable` | `boolean` | `equipmentTree.isLru`、`equipmentTree.isDetectable` raw 为 `0/1`，normalized 为 `boolean`；`1` 为 true，`0` 为 false。 |
| `basicTasks.duration` | 数字字符串，分钟 | `missionProfiles.durationMinutes` | number，分钟 | `basicTasks.duration` raw 单位为分钟，normalized 为 `durationMinutes`；导入时转 number，不换算为小时。 |
| `basicTasks.prepTime` | 数字字符串，分钟 | `missionProfiles.prepTimeMinutes` | number，分钟 | `basicTasks.prepTime` raw 单位为分钟，normalized 为 `prepTimeMinutes`；导入时转 number。 |
| `basicTasks.cancelTime` | 数字字符串，分钟 | `missionProfiles.cancelTimeMinutes` | number，分钟 | `basicTasks.cancelTime` raw 单位为分钟，normalized 为 `cancelTimeMinutes`；导入时转 number。 |

### 3.2 稳定 ID 生成规则

标准对象必须有稳定 `id`，但不同来源 sheet 的 raw `id` 可能在同一个标准对象集合内碰撞。导入清洗后的 normalized `id` 应使用 `sourceSheet:rawId`；对没有 raw `id` 的来源，adapter 必须生成可重复、可追溯的稳定 ID，推荐格式为 `<sourceSheet>:<stable-field-or-row-index>`，并在导出时保留来源信息。

| 来源 | 规则 |
| --- | --- |
| `basicTasks`、`compositeTasks`、`periodicTasks` | 使用 `sourceSheet:rawId` 作为 `missionProfiles.id`，避免多个任务 sheet 合并后 raw `id` 碰撞。 |
| `basicUsageUnits` | `basicUsageUnits` 没有 raw `id`，adapter 生成 `missionProfiles.id`，推荐使用 `basicUsageUnits:<formationName>`。 |
| `supportOrganizationTree`、`supportStaff`、`supportEquipment`、`supportStations`、`nonSupportStations`、`supportFacilities` | 使用 `sourceSheet:rawId` 作为 `supportResources.id`，避免组织、人员、站位和设施合并后 raw `id` 碰撞。 |
| `stationFacilityMatrix` | `stationFacilityMatrix` 没有 raw `id`，adapter 生成 `supportResources.id`，推荐使用 `stationFacilityMatrix:<stationName>`。 |
| `experimentConfig.indexList`、`optimizationTargets` | 使用 `sourceSheet:rawId` 作为 `metricPlans.id`。 |
| `constraints` | `constraints` 没有 raw `id`，adapter 生成 `metricPlans.id`，推荐使用 `constraints:<targetType>:<symbol>:<targetValue>`。 |

## 4. 标准对象字段

### `missionProfiles`

来源 sheet：`basicTasks`、`compositeTasks`、`periodicTasks`、`basicUsageUnits`。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | normalized 稳定记录编号 | 无 | 编号唯一；无 raw `id` 时按 3.2 生成 | 被 composite/periodic 引用时不可直接删除 | `basicTasks.id`、`compositeTasks.id`、`periodicTasks.id`；`basicUsageUnits` 由 adapter 生成 | 否 |
| `taskNo` | string | 是 | 基本任务编号 | 无 | 编号唯一 | 可被实验方案引用 | `basicTasks.taskNo` | 否 |
| `taskName` | string | 是 | 用户可见任务名 | 无 | 名称必填 | `compositeTasks.basicTaskName` 引用 | `basicTasks.taskName`、`periodicTasks.taskName` | 否 |
| `aircraftModel` | string | 是 | 装备型号 | 无 | 名称必填 | 引用 `aircraftPools.aircraftType` 或后续装备类型字典 | `basicTasks.aircraftModel`、`compositeTasks.equipmentType`、`basicUsageUnits.equipmentType` | 否 |
| `equipmentAmount` | integer | 是 | 架次或装备数量 | 0 | 数量非负；数字字符串导入时转数字 | 与任务需求、编队需求关联 | `basicTasks.equipmentAmount`、`compositeTasks.equipmentAmount` | 否 |
| `durationMinutes` | number | 是 | 分钟 | 0 | `basicTasks.duration` raw 单位为分钟，normalized 为 `durationMinutes`；数量非负 | 实验运行时长输入 | `basicTasks.duration` | 否 |
| `prepTimeMinutes` | number | 否 | 分钟 | `null` | 时间字段必须声明单位；数字字符串导入时转数字 | 与活动准备时间关联 | `basicTasks.prepTime` | 否 |
| `cancelTimeMinutes` | number | 否 | 分钟 | `null` | 时间字段必须声明单位；数字字符串导入时转数字 | 与取消阈值或调度规则关联 | `basicTasks.cancelTime` | 否 |
| `usageGuarantee` | string | 否 | 保障方案名称 | `null` | 引用对象必须存在 | 引用 `usageSupportActivities.activityName` | `basicTasks.usageGuarantee` | 否 |
| `formationName` | string | 否 | 编队名称 | `null` | 引用对象必须存在 | 引用 `basicUsageUnits.formationName` | `compositeTasks.formationName`、`basicUsageUnits.formationName` | 否 |
| `issueTime` | string | 否 | 时刻，`HH:MM` | `null` | 时间字段必须声明单位 | 调度开始时间 | `compositeTasks.issueTime` | 否 |
| `firstDispatchTime` | string | 否 | 时刻，`HH:MM` | `null` | 时间字段必须声明单位 | 首次出动时间 | `compositeTasks.firstDispatchTime` | 否 |
| `dayRepeatTimes` | integer | 否 | 次/日 | 0 | 数量非负 | 周期任务展开 | `compositeTasks.dayRepeatTimes` | 否 |
| `intervalHours` | number | 否 | 小时 | `null` | 时间字段必须声明单位；数量非负 | 周期任务展开 | `compositeTasks.intervalHours` | 否 |
| `repeatWeeks` | integer | 否 | 周 | `null` | 数字字符串导入时转数字；数量非负 | 周期任务展开 | `periodicTasks.repeatWeeks` | 否 |
| `subTasks` | array | 否 | 周次到复合任务映射 | `[]` | 引用对象必须存在 | `subTasks[].compositeTask` 引用 `compositeTasks.compositeTaskName` | `periodicTasks.subTasks` | 否 |
| `memberNos` | string[] | 否 | 飞机编号列表 | `[]` | raw `、` 分隔字符串导入时转数组；引用对象必须存在 | 引用 `equipmentAssets.aircraftCode` | `basicUsageUnits.memberNos` | 否 |

### `equipmentAssets`

来源 sheet：`aircraftPools`。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | 稳定记录编号 | 无 | 编号唯一 | 被任务、编队、实验方案引用时不可直接删除 | `aircraftPools.id` | 否 |
| `aircraftType` | string | 是 | 飞机或装备型号 | 无 | 名称必填 | 被任务和活动适用机型引用 | `aircraftPools.aircraftType` | 否 |
| `aircraftCode` | string | 是 | 单机编号 | 无 | 编号唯一 | 被 `basicUsageUnits.memberNos` 引用 | `aircraftPools.aircraftCode` | 否 |
| `supportOrg` | string | 否 | 保障组织名称 | `null` | 引用对象必须存在 | 引用 `supportOrganizationTree.orgName` | `aircraftPools.supportOrg` | 否 |
| `currentStatus` | string | 是 | 在册、完好、维修等状态文本 | `在册完好` | 名称必填 | 影响可用飞机数 | `aircraftPools.currentStatus` | 否 |
| `factoryDate` | string | 否 | 日期 | `null` | 时间字段必须声明单位 | 寿命计算输入 | `aircraftPools.factoryDate` | 否 |
| `totalServiceYears` | number | 否 | 年 | `null` | 数量非负 | 寿命约束 | `aircraftPools.totalServiceYears` | 否 |
| `totalServiceLife` | string | 否 | `HH:MM` 或小时字符串 | `null` | 时间字段必须声明单位 | 寿命约束 | `aircraftPools.totalServiceLife` | 否 |
| `totalServiceTakeoffLanding` | integer | 否 | 起落次数 | 0 | 数量非负 | 寿命约束 | `aircraftPools.totalServiceTakeoffLanding` | 否 |
| `remainingLife` | string | 否 | `HH:MM` 或小时字符串 | `null` | 时间字段必须声明单位 | 可用性和寿命约束 | `aircraftPools.remainingLife` | 否 |
| `flightTime` | string | 否 | `HH:MM` 或小时字符串 | `null` | 时间字段必须声明单位 | 可用性统计 | `aircraftPools.flightTime` | 否 |

### `equipmentTree`

来源 sheet：`equipmentTree`。

当前 `equipmentTree` 字段：`nodeLevel`、`nodeName`、`model`、`quantity`、`isLru`。这些字段可以支撑层级展示、部件/LRU 表格和故障参数录入。

待补字段：`parentId`、`relationType`、`successThreshold`。这三个字段属于 RBD 后续字段，已经由 `MODELING_FUTURE_FIELDS.rbdStructure` 表达，不属于当前 `equipmentTree` 已有字段；不得把 `parentId` 写成当前 `equipmentTree` 已有字段。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `nodeLevel` | integer | 是 | 层级，1 为顶层 | 无 | 数字字符串导入时转数字；数量非负 | 用于顺序推断层级 | `equipmentTree.nodeLevel` | 否 |
| `nodeName` | string | 是 | 系统、分系统、部件或 LRU 名称 | 无 | 名称必填 | 被维修对象、备件、故障模型引用 | `equipmentTree.nodeName` | 否 |
| `model` | string | 否 | 部件型号 | `null` | 空字符串按语义转空值 | 可与备件型号匹配 | `equipmentTree.model` | 否 |
| `quantity` | integer | 否 | 当前节点数量 | 1 | 数量非负；数字字符串导入时转数字 | 影响系统组成和备件需求 | `equipmentTree.quantity` | 否 |
| `isLru` | boolean | 否 | 是否 LRU | false | raw `0/1` 导入时转 boolean | LRU 才能承载故障和维修参数 | `equipmentTree.isLru` | 否 |
| `lruFailureRate` | number | 否 | 失效率，需声明每小时或每任务 | `null` | 概率或率值必须声明口径；数量非负 | 故障模型输入 | `equipmentTree.lruFailureRate` | 否 |
| `kValue` | number | 否 | 分布参数 | `null` | 数量非负 | 故障或维修分布输入 | `equipmentTree.kValue` | 否 |
| `faultDistribution` | string | 否 | 故障分布类型 | `null` | 名称必填仅在填写故障参数时触发 | 故障抽样 | `equipmentTree.faultDistribution` | 否 |
| `repairDistribution` | string | 否 | 维修分布类型 | `null` | 名称必填仅在填写维修参数时触发 | 维修抽样 | `equipmentTree.repairDistribution` | 否 |
| `mtbcf` | number | 否 | 平均关键故障间隔，单位小时 | `null` | 时间字段必须声明单位；数量非负 | 可靠性指标 | `equipmentTree.mtbcf` | 否 |
| `mttr` | number | 否 | 平均修复时间，单位小时 | `null` | 时间字段必须声明单位；数量非负 | 维修活动时长 | `equipmentTree.mttr` | 否 |
| `detectionTime` | number | 否 | 检测时间，单位分钟或小时 | `null` | 时间字段必须声明单位；数量非负 | 故障检测流程 | `equipmentTree.detectionTime` | 否 |
| `isDetectable` | boolean | 否 | 是否可检测 | true | raw `0/1` 导入时转 boolean | 故障检测流程 | `equipmentTree.isDetectable` | 否 |
| `parentId` | string | 否 | 父节点 ID | `null` | 引用对象必须存在 | 引用同一 `equipmentTree` 节点 | 无，RBD 后续字段 | 是，待补字段 |
| `relationType` | enum | 否 | `serial`、`parallel`、`k-out-of-n` | `serial` | 名称必填；枚举值限定 | RBD 结构逻辑 | 无，RBD 后续字段 | 是，待补字段 |
| `successThreshold` | number | 否 | k-out-of-n 阈值或并联系统成功阈值 | `null` | 概率范围 0~1 或 0%~100%；数量非负 | RBD 成功判定 | 无，RBD 后续字段 | 是，待补字段 |

### `supportResources`

来源 sheet：`supportOrganizationTree`、`supportStaff`、`supportEquipment`、`supportStations`、`nonSupportStations`、`supportFacilities`、`stationFacilityMatrix`。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | normalized 稳定记录编号 | 无 | 编号唯一；无 raw `id` 时按 3.2 生成 | 被人员、设备、活动、站位矩阵引用时不可直接删除 | 多 sheet 的 `id`；`stationFacilityMatrix` 由 adapter 生成 | 否 |
| `orgName` | string | 是 | 组织名称 | 无 | 名称必填 | 被 `supportStaff.organization`、`supportEquipment.organizeName`、`aircraftPools.supportOrg` 引用 | `supportOrganizationTree.orgName` | 否 |
| `parentId` | string | 否 | 父组织 ID | `null` | 引用对象必须存在 | 引用 `supportOrganizationTree.id` | `supportOrganizationTree.parentId` | 否 |
| `orgDescription` | string | 否 | 组织说明 | `null` | `"null"` 字符串/空字符串按语义转空值 | 无 | `supportOrganizationTree.orgDescription` | 否 |
| `major` | string | 否 | 专业 | `null` | 名称必填仅在人员记录中触发 | 被活动 `crewList.specialty` 引用 | `supportStaff.major` | 否 |
| `majorLevel` | string | 否 | 专业等级 | `null` | 名称必填仅在人员记录中触发 | 被活动资源需求引用 | `supportStaff.majorLevel` | 否 |
| `serviceAircraft` | string[] | 否 | 适用机型列表 | `[]` | raw `,` 分隔字符串导入时转数组；引用对象必须存在 | 引用 `equipmentAssets.aircraftType`、`equipmentTree` 顶层 `nodeName` 或后续装备类型/别名字典 | `supportStaff.serviceAircraft` | 否 |
| `staffCount` | integer | 否 | 人员数量 | 0 | 数量非负 | 活动资源约束 | `supportStaff.count` | 否 |
| `equipmentName` | string | 否 | 保障设备名称 | `null` | 名称必填仅在设备记录中触发 | 被活动 `equipmentList.equipmentName` 引用 | `supportEquipment.name` | 否 |
| `equipmentModel` | string | 否 | 保障设备型号 | `null` | 空字符串按语义转空值 | 被活动 `equipmentList.equipmentModel` 引用 | `supportEquipment.model` | 否 |
| `equipmentCount` | integer | 否 | 设备数量 | 0 | 数量非负 | 活动资源约束 | `supportEquipment.count` | 否 |
| `unit` | string | 否 | 计量单位 | `台` | 单位明确 | 设备数量展示 | `supportEquipment.unit` | 否 |
| `stationCode` | string | 否 | 站位编号 | `null` | 编号唯一 | 被站位设施矩阵引用 | `supportStations.stationCode`、`nonSupportStations.stationCode` | 否 |
| `stationName` | string | 否 | 站位名称 | `null` | 名称必填仅在站位记录中触发 | 引用 `stationFacilityMatrix.stationName` | `supportStations.stationName`、`nonSupportStations.stationName` | 否 |
| `stationType` | enum | 否 | `support` 或 `nonSupport` | `support` | 枚举值限定 | 区分保障站位和非保障停机位 | 由来源 sheet 推导 | 否 |
| `facilityCode` | string | 否 | 设施编号 | `null` | 编号唯一 | 被 `stationFacilityMatrix.facilityMap.code` 引用 | `supportFacilities.facilityCode` | 否 |
| `facilityName` | string | 否 | 设施名称 | `null` | 名称必填仅在设施记录中触发 | 被站位设施矩阵引用 | `supportFacilities.facilityName` | 否 |
| `functionType` | string | 否 | 加油、供电、供氧等能力类型 | `null` | 空字符串按语义转空值 | 被活动 `facilityList` 引用 | `supportFacilities.functionType`、`stationFacilityMatrix.facilityMap.functionType` | 否 |
| `facilityMap` | object | 否 | 站位到设施能力映射 | `{}` | 引用对象必须存在 | 引用 `supportStations.stationName` 和 `supportFacilities.facilityCode` | `stationFacilityMatrix.facilityMap` | 否 |

### `inventoryResources`

来源 sheet：`spareParts`、`ammunition`。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | 稳定记录编号 | 无 | 编号唯一 | 被活动资源需求引用时不可直接删除 | `spareParts.id`、`ammunition.id` | 否 |
| `resourceType` | enum | 是 | `sparePart` 或 `ammunition` | 由来源 sheet 推导 | 枚举值限定 | 决定引用到 `spareList` 或 `ammoList` | 由来源 sheet 推导 | 否 |
| `name` | string | 是 | 备件或弹药名称 | 无 | 名称必填 | 被活动 `spareName`、`ammoName` 引用 | `spareParts.name`、`ammunition.name` | 否 |
| `model` | string | 是 | 型号 | 无 | 名称必填 | 与活动资源需求中的型号匹配 | `spareParts.model`、`ammunition.model` | 否 |
| `count` | integer | 是 | 库存或可用数量 | 0 | 数量非负；数字字符串导入时转数字 | 备件规划、弹药消耗和活动资源约束 | `spareParts.count`、`ammunition.count` | 否 |
| `relatedComponentId` | string | 否 | 关联部件或 LRU ID | `null` | 引用对象必须存在 | 引用 `equipmentTree` 当前节点或后续稳定 ID | 当前 JSON 无稳定字段，后续 adapter 补映射 | 是 |

### `supportActivities`

来源 sheet：`basicActivityLibrary`、`usageSupportActivities`、`preventiveMaintenance`、`correctiveMaintenance`。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | 稳定记录编号 | 无 | 编号唯一 | 被方案或实验引用时不可直接删除 | 多 sheet 的 `id` | 否 |
| `activityCode` | string | 是 | 基本活动编号 | 无 | 编号唯一 | 被 `usageSupportActivities.basicActivityCode` 引用 | `basicActivityLibrary.activityCode` | 否 |
| `activityName` | string | 是 | 活动名称 | 无 | 名称必填 | 被任务和保障方案引用 | `basicActivityLibrary.activityName`、`usageSupportActivities.activityName` | 否 |
| `activityType` | string | 是 | 活动类型编码或名称 | 无 | 名称必填 | 区分基本活动、使用保障、预防维修、修复维修 | `basicActivityLibrary.activityType`、来源 sheet 推导 | 否 |
| `aircraftName` | string | 否 | 适用飞机型号 | `null` | 引用对象必须存在 | 引用 `equipmentAssets.aircraftType` | `basicActivityLibrary.aircraftName` | 否 |
| `workDurationHours` | number | 否 | 小时 | `null` | 时间字段必须声明单位；数字字符串导入时转数字；数量非负 | 活动调度时长 | `basicActivityLibrary.workDuration` | 否 |
| `crewList` | array | 否 | 专业、等级、数量需求 | `[]` | `requiredCount` 数量非负 | 引用 `supportStaff.major` 和 `supportStaff.majorLevel` | `basicActivityLibrary.crewList` | 否 |
| `serviceList` | array | 否 | 组织、等级、数量需求 | `[]` | 引用对象必须存在；数量非负 | 引用 `supportOrganizationTree.orgName` | `basicActivityLibrary.serviceList` | 否 |
| `facilityList` | string[] | 否 | 设施能力名称列表 | `[]` | 引用对象必须存在 | 引用 `supportFacilities.functionType` | `basicActivityLibrary.facilityList` | 否 |
| `equipmentList` | array | 否 | 保障设备名称、型号、数量 | `[]` | `requiredCount` 数量非负 | 引用 `supportEquipment.name` 和 `supportEquipment.model` | `basicActivityLibrary.equipmentList` | 否 |
| `ammoList` | array | 否 | 弹药名称、型号、数量 | `[]` | `requiredCount` 数量非负 | 引用 `inventoryResources` 中 `resourceType=ammunition` | `basicActivityLibrary.ammoList` | 否 |
| `spareList` | array | 否 | 备件名称、型号、数量 | `[]` | `requiredCount` 数量非负 | 引用 `inventoryResources` 中 `resourceType=sparePart` | `basicActivityLibrary.spareList` | 否 |
| `planType` | string | 否 | 直接准备、再次出动等方案类型 | `null` | 空字符串按语义转空值 | 使用保障方案分类 | `usageSupportActivities.planType` | 否 |
| `basicActivityCode` | string | 否 | 基本活动编号引用 | `null` | 引用对象必须存在 | 引用 `basicActivityLibrary.activityCode` | `usageSupportActivities.basicActivityCode` | 否 |
| `planWorkItem` | string | 否 | 方案工作项 | `null` | 空字符串按语义转空值 | 使用保障流程 | `usageSupportActivities.planWorkItem` | 否 |
| `schemeName` | string | 否 | 预防维修方案名称 | `null` | 名称必填仅在预防维修记录中触发 | 被实验方案引用 | `preventiveMaintenance.schemeName` | 否 |
| `planStopTimeMinutes` | number | 否 | 分钟 | `null` | 时间字段必须声明单位；数字字符串导入时转数字 | 预防维修停场时长 | `preventiveMaintenance.planStopTime` | 否 |
| `repairObject` | string | 否 | 修复对象 | `null` | 引用对象必须存在 | 引用 `equipmentTree.nodeName` 或后续稳定 ID | `correctiveMaintenance.repairObject` | 否 |
| `repairType` | string[] | 否 | 原位维修、换件维修等 | `[]` | 空字符串按语义转空值 | 维修流程选择 | `correctiveMaintenance.repairType` | 否 |
| `precedingWork` | string | 否 | 前置工作 | `null` | `"null"` 字符串/空字符串按语义转空值 | 引用同对象集合的活动或方案 | 多 sheet 的 `precedingWork` | 否 |

### `metricPlans`

来源 sheet：`experimentConfig.indexList`、`constraints`、`optimizationTargets`，同时保留 `experimentConfig` 中与指标解释相关的全局配置。

| 字段名 | 类型 | 必填 | 单位/口径 | 默认值 | 校验规则 | 引用关系 | 当前 JSON 来源字段 | 是否为未来字段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | normalized 指标或目标编号 | 无 | 编号唯一；无 raw `id` 时按 3.2 生成 | 被实验方案引用时不可直接删除 | `experimentConfig.indexList[].id`、`optimizationTargets.id`；`constraints` 由 adapter 生成 | 否 |
| `indexName` | string | 是 | 指标名称 | 无 | 名称必填 | 被结果页和实验方案引用 | `experimentConfig.indexList[].indexName` | 否 |
| `targetType` | string | 是 | 约束或优化目标类型 | 无 | 名称必填 | 指向可用度、可靠度、利用率等指标 | `constraints.targetType`、`optimizationTargets.targetType` | 否 |
| `symbol` | enum | 否 | `≥`、`≤`、`=` | `≥` | 枚举值限定 | 约束表达式 | `constraints.symbol`、`optimizationTargets.symbol` | 否 |
| `targetValue` | number | 是 | 指标目标值；概率类需声明 0~1 或 0%~100% | 无 | 概率范围 0~1 或 0%~100%；数字字符串导入时转数字 | 实验验收和优化目标 | `experimentConfig.indexList[].targetValue`、`constraints.targetValue`、`optimizationTargets.targetValue` | 否 |
| `simulationType` | string | 否 | 单波次、蒙特卡洛等 | `单波次` | 名称必填仅在实验配置中触发 | 实验运行配置 | `experimentConfig.simulationType` | 否 |
| `taskSuccessRate` | number | 否 | 任务成功率，0~1 存储 | `null` | 概率范围 0~1 或 0%~100% | 任务可靠度判定 | `experimentConfig.taskSuccessRate` | 否 |
| `randomControl` | string | 否 | 随机控制策略 | `random` | 名称必填仅在实验配置中触发 | 仿真实验随机种子策略 | `experimentConfig.randomControl` | 否 |
| `crewWorkTimeHours` | number | 否 | 小时 | `null` | 时间字段必须声明单位；数量非负 | 保障人员班次约束 | `experimentConfig.crewWorkTime` | 否 |
| `crewRestTimeHours` | number | 否 | 小时 | `null` | 时间字段必须声明单位；数量非负 | 保障人员班次约束 | `experimentConfig.crewRestTime` | 否 |
| `handoverTimeMinutes` | number | 否 | 分钟 | `null` | 时间字段必须声明单位；数量非负 | 交接时间约束 | `experimentConfig.handoverTime` | 否 |
| `resourceConflictStrategy` | string | 否 | 资源冲突策略 | `null` | 空字符串按语义转空值 | 实验调度规则 | `experimentConfig.resourceConflictStrategy` | 否 |

## 5. 后续实现提示

1. 前端表单应以本文字段表为输入，而不是继续只堆静态页面字段。
2. 后端 API 和 `core/` adapter 应保留“当前 JSON 来源字段”和“标准对象字段”的双向映射，避免直接把工作簿式 key 泄漏到所有层。
3. `equipmentTree` 在 RBD 前只承诺 `nodeLevel` 顺序层级展示；加入 `parentId`、`relationType`、`successThreshold` 前，不能把可靠性框图说成已经具备完整父子关系和串并联逻辑。
4. `supportStationCodes`、`nonSupportStationCodes` 只能作为环境配置或历史工作簿编码表讨论，不得混入当前 JSON sheet。
5. 本文不改变前端加载方式；`front/index.html` 仍应保持 `<script src="modeling-contract.js"></script>` 先于 `<script src="app.js"></script>`。
