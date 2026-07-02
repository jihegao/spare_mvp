# py_maintenance core 与 aircraft_support_v1 仿真逻辑差距分析

日期：2026-07-03
状态：差距分析，作为后续模型补齐依据
范围：只读对比 `/Users/gaojihe/Models/py_maintenance/core` 与当前 `aircraft_support_v1`，不改变代码、schema、运行入口或测试 fixture。

## 结论

当前 `aircraft_support_v1` 不是 `py_maintenance/core` 的等价迁移版本。

`aircraft_support_v1` 更强的是平台化边界：Project/Scenario/Run/Result/ArtifactManifest 链路、fail-closed compiler、formal Monte Carlo、projection artifact、状态序列追溯，以及组件级 `failureDistribution`、寿命、RMS、`k-out-of-n` 和 RBD 可靠性输入。

`py_maintenance/core` 更强的是作业现场语义：资源实例级调度、保障作业计划、人员/设备/场地匹配、任务编队与备份机、完整飞机状态机、补给消耗、预防维修多规则，以及与这些机制对应的传统保障指标。

因此后续补齐不应把旧模型整体回灌进 v1，而应把旧模型中已经有业务价值的行为机制拆成可验证切片，接到当前正式 `RunIntent -> /api/runs -> SimulationAdapter -> aircraft_support_v1 -> artifacts` 主线。

## 对比对象

旧核心：

- `/Users/gaojihe/Models/py_maintenance/core/simulation.py`：`TaskSimulation` 主循环、任务/维修调度、资源请求、指标统计。
- `/Users/gaojihe/Models/py_maintenance/core/aircraft.py`：飞机状态机、任务执行、故障和维修触发。
- `/Users/gaojihe/Models/py_maintenance/core/task.py`：任务阶段、最小架数、编队选择、备份机和任务取消。
- `/Users/gaojihe/Models/py_maintenance/core/resource_manager.py`：场地、设备、人员、航材、补给、请求队列和资源占用。
- `/Users/gaojihe/Models/py_maintenance/core/maintenance.py`：预防性维修规则。
- `/Users/gaojihe/Models/py_maintenance/data_adapter.py`：前端/Excel/JSON 到旧 `s_*` 配置的转换。

当前 v1：

- `src/spare_mvp_abm/aircraft_support_v1/model.py`：`AircraftSupportV1Model` 单次运行核心。
- `src/spare_mvp_contract/adapter.py`：Project 到 `aircraft_support_v1` Scenario 的编译、运行、Monte Carlo 和 artifact 生成。
- `contracts/aircraft_support_v1_input.schema.json`：正式模型族输入 contract。
- `contracts/README.md`：M9.7.1-M9.7.4 当前覆盖口径。

## 旧案例规模

用旧 `data_adapter.load_config_from_file()` 读取 `/Users/gaojihe/Models/py_maintenance/core/dataset/data_new.json` 后，旧配置的主要规模如下：

| 配置项 | 数量 |
| --- | ---: |
| `s_units` | 4 |
| `s_aircraft_models` | 2 |
| `s_parts` | 45 |
| `s_tasks` | 4 |
| `s_operation` | 1 |
| `s_jobs` | 6 |
| `s_aircraft_services` | 2 |
| `s_facilities` | 22 |
| `s_equipments` | 2 |
| `s_staff` | 6 |
| `s_supplies` | 4 |
| `s_prev_maintain` | 2 |

这个案例说明旧核心不是只有飞机数量和任务波次，它还携带了场地、设备、人员、补给、维修活动和任务编队等现场调度输入。v1 当前 compiler 能接住其中一部分业务字段，但不是按旧 `s_*` 语义逐项执行。

## 差距清单

| 维度 | `py_maintenance/core` | 当前 `aircraft_support_v1` | 差距判断 |
| --- | --- | --- | --- |
| 资源粒度 | `GlobalResourceManager` 管理场地、设备实例、人员专业/组织、航材、补给和资源占用区间。 | `supportNodes` 折算为聚合 `personnel_capacity`、`equipment_capacity`、库存和运输策略。 | v1 缺少场地功能匹配、设备 ID/型号实例匹配、人员专业匹配、组织作用域、资源占用冲突校验和场地切换统计。 |
| 作业计划 | `s_aircraft_services` 生成多飞机保障计划，支持 `pre_jobs`、`conflict_jobs`、直接/重复/返场服务、随机或启发式排序。 | `supportActivities[].jobs` 只做 DAG 拓扑排序，按活动类型给单机创建等待作业。 | v1 缺少 `conflict_jobs`、调度策略、重试/瓶颈记录、服务计划级语义和作业时长分布采样。 |
| 任务/编队 | 任务含阶段、最小架数、准备/取消窗口、编队/组/机型选择、备份机替换和提前返航。 | 任务按周期/复合任务生成 sortie，使用 `required_aircraft`、preflight、launch、cancel 和 return。 | v1 缺少阶段级最小架数、按编队/组绑定机号、任务中备份替换、提前返航时长和失败上下文。 |
| 飞机状态 | 旧状态包括 `stay`、`in_preparing`、`ready`、`in_task`、`checking`、`early_returning`、`in_repairing`、`in_maintenance`。 | v1 主要是 available/maintenance/flying 与少量计数标志。 | v1 状态机更适合正式 artifact，但现场过程状态少，难以复刻旧指标。 |
| 故障/可靠性 | 零部件有 `ftime`、`cftime`，严重故障影响可用；也有飞机级 fallback 语义。 | 支持 `failureDistribution`、`k-out-of-n`、寿命、RMS、RBD 和 seeded Monte Carlo。 | v1 在组件可靠性 contract 上更强，但没有旧飞机级无组件 fallback；也没有旧 `part_fulfill_rate` 式航材满足语义。 |
| 预防性维修 | 每架机可挂多条 `PrevRepair` 规则，按飞行小时、起落次数、日历日触发。 | 从预防性维修活动中选择一组间隔天数/小时/起落次数。 | v1 缺少多预防维修计划、提前量/裕度和机级差异规则。 |
| 备件/补给/运输 | 航材和一般补给分开，支持消耗、补充、满足率和利用率。 | 节点库存与 `transportPolicies` 能驱动短缺后运输和在途到达。 | v1 的运输链路更正式，但缺少一般补给/弹药消耗和目标库存式周期补充。 |
| 指标 | 输出 `使用可用度`、`出动架次率`、`航线占有率`、`再次出动准备时间`、MTBF、MTBCF、保障设备满足/利用、备件满足/利用等。 | 输出 `sortie_completion_rate`、`ready_rate`、backlog、spare fill/utilization/shortage/delay、failure、transport 和 projection 指标。 | 指标不是一一映射；需要独立兼容层，不能直接把 v1 dashboard 数值当作旧指标复刻。 |
| 随机性 | `TimeDistribution` 支持 fixed、exponential、normal、random、triangular；调度也可随机/启发式。 | 主要随机性在故障、seed 和 Monte Carlo；作业 `durationMinutes` 基本确定。 | v1 尚未行为化 `durationProfile` 和调度策略参数。 |
| 数据边界 | 旧 adapter 直接把前端/Excel/JSON 转成 `s_*` 配置交给 `TaskSimulation`。 | 当前 adapter 走 Project/schema/compiler，未知或不一致字段 fail closed。 | v1 的治理边界更好，但旧 `data_new.json` 的语义不会自动完整迁移。 |

## v1 已经优于旧核心的部分

1. 正式输入和产物链路更强：v1 有 schema、compiler provenance、Run identity、Result summary、ArtifactManifest、projection artifact 和 `visualization_state_series`。
2. Monte Carlo 更适合产品主线：v1 通过 canonical `/api/runs` 执行 formal Monte Carlo，并输出基础样本和四类 projection。
3. 可靠性建模输入更系统：v1 已覆盖 `failureDistribution`、RMS、寿命、`k-out-of-n` 和 RBD 引用校验。
4. fail-closed 边界更清楚：输入缺失、引用错误、循环依赖和 artifact 类型不匹配时，当前主线倾向阻断，而不是静默回退。

## 补齐优先级

### P0：资源与作业调度对齐

优先行为化 `supportActivities[].jobs[]` 中已经存在但当前未充分驱动的字段，包括 `facility`、`equipment`、`personnel`、`servicePersonnel`、`ammunition`、`durationProfile` 和 job 前后置/冲突关系。

最低可行切片可以先不完全恢复旧 `GlobalResourceManager`，但需要至少建立可验证的匹配维度：

- 场地功能或场地类型。
- 设备类型/数量，后续再扩展到实例 ID。
- 人员专业/数量。
- 航材、补给、弹药三类需求的分别扣减。
- 作业等待、执行、阻塞和短缺原因。

### P1：任务编队与飞机状态机补齐

补齐任务阶段、阶段级最小架数、编队/组/指定机号绑定、任务中备份替换、提前返航和返场检查状态。这个切片会直接影响出动率、任务完成率和再次出动准备时间。

### P2：维修与供应规则补齐

支持每架机多条预防维修规则，按飞行小时、起落次数、日历日分别触发；恢复一般补给/弹药消耗；增加目标库存、周期补充和满足率口径。

### P3：旧指标兼容层

把旧中文指标作为 derived/projection layer 实现，而不是把旧模型状态直接塞进 v1 核心。建议先定义公式和输入来源，再落 artifact projection，避免污染当前正式运行主线。

### P4：随机时长与调度策略

把 `durationProfile` 接入 seeded duration sampler，支持 fixed、exponential、normal、uniform/triangular 等分布；同时把随机、关键路径、最短任务、资源均衡等策略做成显式实验参数。

## 非目标

1. 不建议直接复制旧 `TaskSimulation` 到 v1 主线。旧核心有价值的是行为语义，不是文件结构。
2. 不建议绕过 Project/schema/compiler 直接读取旧 `s_*` 配置。这样会破坏当前正式结果的可追溯链路。
3. 不建议用 dashboard 文案先冒充旧指标。旧指标必须有明确公式、事件来源和 artifact 证据。

## 后续实施建议

下一轮模型修改可以从 P0 开始，先做“资源与作业调度最小可验证切片”：选择一个包含场地、设备、人员、备件和补给的保障活动案例，让 single run 同时输出 job 级等待/执行/阻塞事件、资源利用统计和缺口原因。这个切片完成后，再推进任务编队和旧指标兼容层会更稳。
