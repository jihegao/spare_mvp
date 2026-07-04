# py_maintenance 与 spare_mvp 建模输入数据结构对比

日期：2026-07-03
状态：结构分析，作为轻量 Mesa 实验层和后续建模输入收敛依据
范围：只读对比 `/Users/gaojihe/Models/py_maintenance` 当前数据消费链路与 `spare_mvp` 当前 `modeling-import-v1 -> project-v0 -> aircraft-support-v1-input-v0` 链路；不改变代码、schema、fixture 或正式运行入口。

## 结论

`py_maintenance` 的运行内核不直接消费前端导出的 `data_new.json` 外观结构。它先由 `data_adapter.load_config_from_file()` 识别前端契约 JSON 或 survey JSON/Excel，再统一折叠成 `TaskSimulation` 消费的 `s_* + time_dist + organization` 配置。

`spare_mvp` 当前不是 `s_*` 风格。它已经形成三层输入契约：

```text
modeling-import-v1
-> project-v0
-> aircraft-support-v1-input-v0 / scenario["simulation_inputs"]
```

因此后续不应把 `py_maintenance` 的 `s_*` 直接移植进 `spare_mvp`。可复用的是它的分层思想：业务数据保持可读、可编辑；adapter 负责折叠为模型内核输入；模型内核只消费规范化后的结构。

最小携行清单实验应继续沿用这个分层边界：Project 保留机场、保障点、库存、调运关系和作业需求；compiler 折叠出 `aircraft-support-v1-input-v0`；搜索层只在编译后的 `support_network.nodes[].inventory` 中修改机场绑定基层保障点的库存数量。上级库、侧向保障点和其他保障点库存仍按 Project 原值参与调运仿真，不作为优化变量。

## 当前实际链路

### py_maintenance

当前默认数据入口：

```text
/Users/gaojihe/Models/py_maintenance/core/dataset/data_new.json
```

它的外层是前端契约 JSON，顶层业务域包括：

```text
constraints
optimizationTargets
experimentConfig
shipTypes
supportStations
nonSupportStations
supportFacilities
stationFacilityMatrix
equipmentTree
initialLayouts
supportStationCodes
nonSupportStationCodes
supportOrganizationTree
aircraftPools
supportStaff
supportEquipment
spareParts
ammunition
usageSupportActivities
preventiveMaintenance
correctiveMaintenance
basicActivityLibrary
basicTasks
compositeTasks
periodicTasks
basicUsageUnits
```

实际消费链路：

```text
frontend_contract_json / survey_json / survey_excel
-> data_adapter.load_config_from_file()
-> data_adapter.load_config_from_survey_json()
-> data_adapter._frontend_contract_to_survey_json()
-> data_adapter.load_config_from_xlsx()
-> TaskSimulation(config)
```

`TaskSimulation` 直接读取的关键结构是：

- `time_dist`
- `s_units`
- `s_tasks`
- `s_operation`
- `s_jobs`
- `s_aircraft_models`
- `s_parts`
- `s_facilities`
- `s_equipments`
- `s_staff`
- `s_supplies`
- `s_aircraft_services`
- `s_prev_maintain`
- `s_failure_repair`
- `s_parts_transportation`
- `single_flight`
- `organization`

用 `uv run --with openpyxl --python 3.12` 读取当前 `data_new.json` 后，内核配置规模如下：

| 配置项 | 数量 |
| --- | ---: |
| `s_units` | 4 |
| `s_aircraft_models` | 2 |
| `s_tasks` | 4 |
| `s_operation` | 1 |
| `s_jobs` | 6 |
| `s_aircraft_services` | 2 |
| `s_parts` | 45 |
| `s_facilities` | 22 |
| `s_equipments` | 2 |
| `s_staff` | 6 |
| `s_supplies` | 4 |
| `s_prev_maintain` | 2 |
| `s_failure_repair` | 1 |
| `time_dist` | 16 |
| `organization` | 35 |

### spare_mvp

当前推荐输入链路：

```text
public/import-templates/*.json 或 tests/fixtures/simulation_analysis_cases/*.json
-> validate_modeling_import_package()
-> modeling_import_to_project()
-> SimulationAdapter.compile_scenario_with_gate(..., model_family="aircraft_support_v1")
-> scenario["simulation_inputs"]
-> AircraftSupportV1Model(inputs)
```

以 `public/import-templates/canonical_platform_case.json` 做只读探针，当前可成功编译到 `aircraft_support_v1`。编译后的核心输入规模如下：

| 输入域 | 数量 |
| --- | ---: |
| `aircraft.assets` | 6 |
| `equipment_tree.components` | 10 |
| `support_network.nodes` | 3 |
| `support_activities.activities` | 6 |
| `mission_profile.composite_tasks` | 2 |
| `mission_profile.periodic_tasks` | 1 |
| `reliability_block_diagram.nodes` | 4 |
| `reliability_block_diagram.edges` | 3 |

`aircraft-support-v1-input-v0` 顶层输入域是：

- `schema_version`
- `project_identity`
- `mission_profile`
- `aircraft`
- `equipment_tree`
- `support_network`
- `support_activities`
- `reliability_block_diagram`
- `time`
- `monte_carlo`
- `seed`

## 结构差异

| 维度 | `py_maintenance` | `spare_mvp` |
| --- | --- | --- |
| 原始业务数据 | 前端契约 JSON 或 survey Excel/JSON。 | `modeling-import-v1` 包或 `project-v0` Project。 |
| 内核输入 | `s_* + time_dist + organization`。 | `aircraft-support-v1-input-v0` 的 `simulation_inputs`。 |
| 转换方向 | 前端契约先转中文 survey sheet，再复用 Excel adapter 生成 `s_*`。 | import package 先校验，再转 Project，再由 Adapter 编译成正式模型输入。 |
| 引用风格 | 混合中文名称、业务编号和派生 ID。 | 倾向稳定 ID、显式引用校验和 compiler provenance。 |
| 校验边界 | loader 能否解析、实验脚本能否运行是主要边界。 | schema、usedTables 范围声明、compile gate 和 fail-closed issues。 |
| 结果边界 | experiments 直接运行，结果文件/脚本形态较松。 | 正式链路写 Run/Result/ArtifactManifest；轻量层讨论稿要求只读 `simulation_inputs`，默认不落盘。 |

## 字段映射关系

| 业务概念 | `py_maintenance` 原始域 | `py_maintenance` 内核域 | `spare_mvp` 建议承载域 |
| --- | --- | --- | --- |
| 飞机/机型/单机状态 | `aircraftPools` | `s_units`, `s_aircraft_models` | `combatUnit.members`, `equipment`, `aircraft.assets` |
| 装备结构/LRU/故障参数 | `equipmentTree` | `s_parts` | `equipmentAssets`, `components`, `equipment_tree.components` |
| 任务计划 | `basicTasks`, `compositeTasks`, `periodicTasks`, `basicUsageUnits` | `s_tasks`, `s_operation` | `missionProfile.compositeTasks`, `missionProfile.periodicTasks`, `basicMission`, `missionPhases` |
| 保障活动与作业 DAG | `usageSupportActivities`, `basicActivityLibrary` | `s_jobs`, `s_aircraft_services` | `supportActivities[].jobs[]` |
| 预防性维修 | `preventiveMaintenance` | `s_prev_maintain` | `supportActivities` 中 `activityType=preventive` 及间隔字段 |
| 修复性维修 | `correctiveMaintenance` | `s_failure_repair`, `s_jobs` | `supportActivities` 中 `activityType=repair`、组件维修 profile |
| 场地/设施 | `supportStations`, `supportFacilities`, `stationFacilityMatrix` | `s_facilities` | 当前主要折到 `airports[].supportNodeId`、`supportNodes[].nodeType/supportLevel` 和 `support_network.nodes`；若要精细行为，需要新增或行为化场地功能匹配 |
| 保障人员 | `supportStaff` | `s_staff` | 当前主要折到 `supportNodes[].personnelCapacity`；若要精细行为，需要人员专业/组织资源池 |
| 保障设备 | `supportEquipment` | `s_equipments` | 当前主要折到 `supportNodes[].equipmentCapacity` 和 job 需求；若要精细行为，需要设备类型/数量/实例匹配 |
| 备件/弹药/补给 | `spareParts`, `ammunition`, 作业需求 | `s_supplies` | `supportNodes[].inventory`, `components[].spareType`, `supportActivities[].jobs[].spare[]`；最小携行清单只优化机场绑定基层保障点库存，其他库存只作为调运资源 |
| 时间分布 | 作业工期、维修工期、分布字段 | `time_dist` | 当前多为确定 `durationMinutes`；后续可把 `durationProfile` 行为化 |
| 组织树 | `supportOrganizationTree` | `organization`, 资源作用域 | 当前 `supportOrganization.tree` 为 governance-only；若要驱动资源可达性需提升为行为字段 |

## 对轻量 Mesa 实验层的影响

当前讨论稿要求轻量实验层只读取项目建模数据，编译后只消费 `scenario["simulation_inputs"]`，不得调用会写正式 artifact 的 `run_scenario()` 或 `run_monte_carlo_scenario()`。

结合本次对比，轻量层的输入结构不应复用 `py_maintenance` 的 `s_*`。建议按如下边界落地：

```text
Project 或 modeling-import
-> compiler helper
-> aircraft-support-v1-input-v0
-> AircraftSupportV1Model(inputs)
-> in-memory metrics / samples / lightweight analyses
```

如果需要吸收 `py_maintenance` 的能力，应拆成行为补齐切片，而不是引入第二套内核输入：

1. 场地、设备、人员、补给的资源匹配。
2. 作业 DAG 的前序、冲突、等待、执行和阻塞原因。
3. 多条预防性维修规则和修复性维修对象。
4. 任务编队、指定飞机、阶段最小架数和取消/备份规则。
5. seeded 作业时长分布。

最小携行清单搜索属于轻量层的变量实验，不属于 Project 持久化模型的新 schema。搜索输入应从当前 Project 编译结果派生：

- 机场绑定基层保障点：优先由 `airports[].supportNodeId` 指向的 `supportNodes[]` 识别，并结合 `supportLevel`、`nodeType` 或用户显式选择确认基层级范围。
- 备件类别：来自 `components[].spareType`、`supportNodes[].inventory` key 和 `supportActivities[].jobs[].spare[].name`。
- Project 基准库存：记为 `q0[base_support_node_id][spare_type]`，用于判断每类备件应补充、削减或保持。
- 非优化库存：上级库、侧向保障点、其他机场保障点和运输策略保持 Project 原值，只通过调运规则影响候选解表现。

如果 Project 无法明确机场绑定基层保障点，轻量实验应 fail closed，要求补齐保障节点建模或由用户显式选择基层保障点，而不是退回全局 `spareMultipliers`。

## 建模输入收敛建议

### P0：明确 canonical input 层

`spare_mvp` 应继续把 `aircraft-support-v1-input-v0` 作为模型内核输入层。任何轻量实验、正式 run、Notebook 或 agent 调用都应复用同一编译结果，避免出现 `s_*` 与 `simulation_inputs` 两套并行事实。

### P1：建立字段覆盖账本

针对 `py_maintenance` 当前能表达但 `spare_mvp` 尚未行为化的字段，建立覆盖账本：

- `consumed`：已经驱动模型行为。
- `derived`：由其他字段推导。
- `governance_only`：只用于来源、审计或展示。
- `missing_behavior`：已有建模字段但尚未驱动模型。
- `unsupported`：当前不支持，且必须 fail closed 或明确忽略。

### P2：把资源粒度从容量聚合推进到资源池

当前 `supportNodes[].personnelCapacity` 和 `equipmentCapacity` 足够支持粗粒度实验，但不足以复刻 `py_maintenance` 的人员专业、设备型号、设施功能和实例占用。建议新增中粒度资源池，不直接跳到完整旧 `GlobalResourceManager`。

### P3：把最小携行清单建模为独立决策变量

最小携行清单搜索不应只使用全局 `spareMultipliers`，也不应把所有保障点库存都纳入优化。第一版变量边界固定为“机场绑定基层保障点 × 备件类别”：

```text
q[base_support_node_id][spare_type]
```

`base_support_node_id` 来自 `airports[].supportNodeId` 指向的基层保障点，必要时结合 `supportNodes[].supportLevel`、`supportNodes[].nodeType` 或用户显式选择确认。`spare_type` 来自：

- `components[].spareType`
- `supportNodes[].inventory` 的备件 key
- `supportActivities[].jobs[].spare[].name`
- 后续显式维护的携行类别字典

生成的 `spareQuantities` 候选向量必须围绕 Project 当前配置库存 `q0` 搜索：`q0` 不满足任务成功率置信度时补充基层库存，`q0` 已满足时削减基层库存，目标函数为基层级携行总量最小。上级库、侧向保障点和其他保障点库存保持 Project 原值，只作为可调运资源参与仿真。

这意味着最小携行清单是轻量实验配置和结果解释，不是 Project 持久化字段替代；正式 Project 仍保存用户配置库存，实验结果报告相对 Project 基准的补充/削减量。

### P4：保留正式运行与轻量实验的落盘边界

正式产品运行继续走：

```text
RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts
```

轻量实验只读当前 Project 或 modeling-import，默认不写 SQLite、`runs/`、`outputs/` 或 artifact manifest。两者可以共用 compiler，但不能共用结果持久化路径。

## 非目标

1. 不把 `py_maintenance` 的 `s_*` schema 作为 `spare_mvp` 新输入 contract。
2. 不绕过 `modeling-import-v1`、Project schema 和 compiler gate 直接喂模型。
3. 不把前端业务 JSON 直接交给 Mesa 内核。
4. 不把轻量实验输出接入 current result、正式 `analysis_projection_*` artifact 或 `/api/runs` 结果链路；若结果分析页使用轻量 Mesa 输出，也只能作为会话内页面结果。
5. 不把小样本轻量实验解释为工程级校准结论。
6. 不把上级库、侧向保障点或其他保障点库存纳入最小携行清单优化变量。

## 后续文档关系

- `2026-07-03-py-maintenance-v1-simulation-gap-analysis.md`：关注仿真行为差距。
- 本文：关注建模输入数据结构与转换边界。
- `2026-07-03-lightweight-mesa-experiments-design.md`：关注轻量实验层边界；后续实现时应引用本文的输入结构结论。
