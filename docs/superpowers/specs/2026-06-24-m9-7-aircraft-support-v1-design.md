# M9.7 aircraft_support_v1 正式模型族设计规格

日期：2026-06-24

状态：正式设计规格。本文定义 M9.7 `aircraft_support_v1` 正式模型族的架构、契约边界、仿真推进规则、artifact 策略和分期验收口径。

## 目标

M9.7 新增正式飞机保障仿真模型族 `aircraft_support_v1`。该模型族必须通过 `SimulationAdapter.compile_scenario()`、`SimulationAdapter.run_scenario()` 和 `SimulationAdapter.run_monte_carlo_scenario()` 进入平台正式运行链路，并使用 canonical `/api/runs` 产出 result、artifact manifest、run chain、`visualization_state_series`、`monte_carlo_base` 和四类 `analysis_projection_*` artifact。

M9.7 不把 `independent-mesa`、`8765` 或静态 HTML 输出作为正式产品入口。`independent-mesa/GLM` 和 `independent-mesa/GPT` 只作为机制、模块划分和验收要素参考。M9.8 已将平台入口切到 `aircraft_support_v1` 并完成 `independent-mesa` 退役；这些旁路目录只保留为历史参考、开发对照和离线复现实验。

## 已确认设计决策

### 模型族命名

采用新正式模型族：

```text
model_family = "aircraft_support_v1"
```

`aviation_support` 保持 M9.4/M9.5 的已验证回归基线，不在 M9.7 中直接改造成新动力学模型。

### 字段消费策略

M9.7 采用分层消费，而不是伪造“所有字段都直接影响仿真行为”：

1. 动力学字段必须进入仿真规则、状态推进、事件调度、资源约束或指标计算。
2. 治理、身份、生命周期和校验类字段进入 provenance、run chain、report 或 log，不改变仿真行为。
3. 暂不合理消费的字段必须显式标记为 unsupported，不能静默忽略。
4. M9.6 field coverage 从“当前 M9.5 状态”升级为 “M9.7 目标状态 + 当前实现状态”的验收依据。

M9.7 可以分 PR 暂时保留 explicit unsupported，但最终 M9.7 完成时，M9.6 已冻结业务字段不得仍是 unsupported。最终 coverage 允许的状态为：

- `consumed`：字段进入仿真行为、状态推进、资源约束或指标计算。
- `derived`：字段用于派生模型输入、身份、调度结构或指标口径。
- `defaulted`：字段缺省规则明确，且默认值进入 Scenario provenance。
- `governance_only`：字段只进入 provenance、report、log 或 run chain，不改变仿真行为。

`unsupported` 只能用于未来新增字段或明确超出 M9.6 案例范围的扩展能力，不能留在 M9.6 已冻结业务字段中。

### 时间推进策略

M9.7 采用“分钟级内部事件精度 + 可配置帧采样 + Monte Carlo 轻量输出”。

1. 内部时钟允许 `tick_minutes=1`，用于表达维修完成、运输到达、任务起飞/返航、库存补给和定检触发等分钟级事件。
2. 默认不每分钟输出完整 `visualization_state_series` 帧。输出帧由 `sample_every_minutes` 控制。
3. 单次 run 可以按 10 或 30 分钟采样输出完整回放帧，同时在事件日志中保留关键分钟级事件。
4. Monte Carlo 默认不保留每个样本的完整分钟级 state-series，只保留 `monte_carlo_base`、样本指标、失败样本、关键事件摘要、聚合结果和四类 projection 所需数据。
5. 故障概率按 `dt` 换算，例如指数模型使用 `P(fail)=1-exp(-lambda*dt)`，避免 tick 粒度变化导致概率语义漂移。

1 分钟 tick 的主要代价：

- M9.6 24 小时案例从 48 步变为 1440 步，单样本步数放大 30 倍。
- 27 个 sweep 组合 x 24 样本 = 648 个样本；1 分钟 tick 会产生 933120 个内部 tick。
- 若每分钟输出完整 state-series，会显著增加 artifact 写入、下载、前端解析、SSE 和测试耗时。
- 同一分钟内多事件排序仍需要事件队列，1 分钟 tick 不能替代事件队列。

### Scenario schema 边界

M9.7 采用统一 Scenario envelope + 独立 `aircraft_support_v1` input schema。

统一 Scenario envelope 继续承载平台身份链和运行契约：

- `schema_version`
- `scenario_id`
- `project_id`
- `scenario_version`
- `simulation_model.family = "aircraft_support_v1"`
- `simulation_model.model_id = "AircraftSupportV1Model"`
- `compiled_from`
- `simulation_inputs`

新增独立 schema 文件约束 `simulation_inputs`：

```text
contracts/aircraft_support_v1_input.schema.json
```

该 input schema 专门定义 `aircraft_support_v1` 的任务剖面、飞机 agent 初始状态、装备树、故障分布、保障资源、库存、运输策略、保障活动 DAG、可靠性框图、时间推进配置和 Monte Carlo sweep 配置。

`contracts/scenario.schema.json` 不内联完整 `aircraft_support_v1` 输入结构，只在 `simulation_model.family = "aircraft_support_v1"` 时要求 `simulation_inputs` 符合 `contracts/aircraft_support_v1_input.schema.json`。这样保留 canonical Scenario/run/artifact 链路，同时避免把复杂模型输入塞进通用 Scenario schema。

该决策要求后续实现同步更新：

- `contracts/scenario.schema.json`：允许 `aircraft_support_v1` family，并引用独立 input schema。
- `contracts/run.schema.json`：允许 `model_family = "aircraft_support_v1"` 和 `model_id = "AircraftSupportV1Model"`。
- `contracts/scenario_adapter_mapping.json`：新增 `aircraft_support_v1` 字段映射。
- `SimulationAdapter.compile_scenario_with_gate()`：新增 `aircraft_support_v1` 编译 gate。
- M9.6 coverage/golden fixtures：扩展为 M9.7 目标验收输入。

### 模块落点

正式模型代码放在：

```text
src/spare_mvp_abm/aircraft_support_v1/
```

该目录承载 `aircraft_support_v1` 的 Mesa model、agent、领域模块、状态帧构造和模型级测试。`SimulationAdapter` 只负责：

- Project/ExperimentPlan 到 Scenario envelope 的编译。
- `aircraft_support_v1` input schema validation。
- 调用 `AircraftSupportV1Model` 或 Monte Carlo runner。
- 包装 canonical result、artifact manifest、run chain、state-series 和 projection artifacts。

`src/spare_mvp_contract/` 继续作为契约和 adapter 边界，不放置仿真动力学规则。这样保持“仿真模型实现”和“平台契约转换”分离，也避免 `adapter.py` 承载领域模型复杂度。

### 事件排序规则

同一分钟内多个事件同时发生时，M9.7 使用固定阶段顺序，保证 fixed seed 下结果可复现，并避免不同实现细节改变仿真语义。

每个 tick 的全局阶段顺序：

1. 外部到达先结算：返航、运输/补给到达、已排程维修完成。
2. 状态与库存更新：释放资源、入库备件、更新飞机可用状态。
3. 可靠性/寿命/故障评估：对当前可用或执行任务中的飞机做寿命、故障和可靠性判定。
4. 维护需求生成：故障维修、预防性维修、返航后检查生成作业。
5. 保障资源分配：按优先级和 DAG 前序约束启动可执行作业。
6. 任务调度决策：根据当前可用飞机和资源决定起飞、延误或取消。
7. 快照采样：如果命中 `sample_every_minutes`，输出 `visualization_state_series` frame。

该顺序偏保守：先处理已发生的完成、返航和补给，再决定新的起飞，避免“同一分钟补给已到但任务仍因缺件取消”等不可解释结果。

### 默认 tick 和采样配置

正式 single run 默认：

```text
tick_minutes = 1
sample_every_minutes = 30
max_state_frames_single = 2000
```

`tick_minutes=1` 用于分钟级内部事件精度；`sample_every_minutes=30` 让 M9.6 24 小时案例输出约 49 帧，接近旧 48 steps 基线，便于前端回放、artifact 下载和回归测试。`max_state_frames_single=2000` 是保护上限，超过上限时 compile/run 必须 fail closed 或要求用户提高 `sample_every_minutes`，不得静默截断正式 state-series。

高频回放可以显式配置 `sample_every_minutes=10` 或 `1`，但这属于高成本模式，必须在 run config、artifact metadata 和 report/log 中标明。

Monte Carlo 不默认继承 single run 的完整 state-series 输出策略；MC state-series 作为单独设计问题处理。

### Monte Carlo state-series 策略

Monte Carlo run 默认不保存所有样本的完整 `visualization_state_series`。所有样本的完整证据进入：

- `monte_carlo_base`：样本参数、seed、终态指标、失败原因和关键事件摘要。
- 四类 `analysis_projection_*`：从 `monte_carlo_base` 聚合派生的正式分析 payload。

MC run 仍输出一个 `visualization_state_series` artifact，但该 artifact 只对应一个固定规则选择出的代表样本，供 Mesa 可视化页回放。

代表样本选择规则：

1. M9.7.3 使用第一个成功的确定性样本作为代表样本，选择理由记录为 `first successful deterministic sample`。
2. 该规则保证固定 seed 和固定 sweep 下 state-series 可复现，并避免把所有样本帧误暴露为单条正式回放。
3. 若所有样本失败，run 必须 fail closed 并输出失败摘要，不伪造可回放状态。
4. 中位数附近代表样本选择可作为后续优化，但不属于 M9.7.3 收口范围。

`visualization_state_series` artifact metadata 必须标明 `representative_sample_id`、代表样本参数组合、seed、选择理由和覆盖范围。所有样本级证据以 `monte_carlo_base` 为准，不能把代表样本回放解释成整个 Monte Carlo 分布。

### 验收分期

M9.7 拆成四个 PR 验收，最后一个 PR 才标记 M9.7 完成。

#### M9.7.1 schema/compiler

目标：建立 `aircraft_support_v1` 的正式契约和编译 gate，不要求真实模型完成运行。

范围：

- 新增 `contracts/aircraft_support_v1_input.schema.json`。
- 扩展 `contracts/scenario.schema.json`、`contracts/run.schema.json` 和 `contracts/scenario_adapter_mapping.json`。
- `SimulationAdapter.compile_scenario_with_gate()` 支持 `model_family = "aircraft_support_v1"`。
- M9.6 case package 可编译为 `aircraft_support_v1` Scenario envelope + input payload。
- 缺字段、非法引用或未批准字段语义时 fail closed。

完成标准：

- `aircraft_support_v1` Scenario 通过 schema validation。
- compile provenance 包含 consumed、derived、defaulted、governance_only 和临时 unsupported 字段列表。
- `smoke` 和 `aviation_support` 编译回归保持通过。

#### M9.7.2 single run core

目标：落地 `src/spare_mvp_abm/aircraft_support_v1/` 的 single run 核心动力学。

范围：

- 实现 Mesa 外壳、飞机 agent、任务调度、装备故障、保障活动 DAG、保障资源/库存/运输、可靠性/RMS 和状态帧构造。
- single run 使用 `tick_minutes=1`、`sample_every_minutes=30`、固定事件阶段顺序。
- single run 产出 result summary、artifact manifest、run chain、metrics、report、log 和 `visualization_state_series`。
- `visualization_state_series.frames[].missions[]` 携带任务计划属性：周期任务、复合任务、基本任务、实际天、波次、要求机型/数量、任务时长、计划/实际时间和实际执行飞机，供平台任务视图合并显示任务计划表与每日甘特图；缺少这些字段时前端 fail closed，不从 id/name/aircraft_type 兜底推断。

完成标准：

- 固定 seed single run 可复现。
- M9.6 case package 能通过 canonical `/api/runs` single run 成功执行。
- 缺 projection、缺 state-series、缺 compiler provenance 或 unsupported 字段族时 fail closed。

当前完成口径：M9.7.2 已落地可合并 single-run core；M9.7.3 已补齐 formal Monte Carlo/projection；M9.7.4 已关闭 coverage hardening。最终行为驱动字段为机队数量/初始可用、任务波次、`components[].failureDistribution`、组件故障率/寿命/RMS/k-out-of-n、`reliabilityBlockDiagram`、保障资源容量、库存、`supportNodes[].transportPolicies`、保障活动 job DAG、周期任务、任务阶段/机场/任务区、Monte Carlo sweep 与 seed；仿真时长优先按周期任务配置天数 × 重复次数推导，`durationHours` 只作为无周期任务时的回退；这些字段进入状态推进、故障判定、任务出动、维修/保障作业、资源约束、备件消耗、指标和状态帧。任务状态帧已保留周期/复合/基本任务属性、实际天、波次、要求机型/数量和实际执行飞机，供 M9.8 平台任务视图按每日甘特表消费；缺字段时不得前端兜底推断。`supportOrganization` 当前批准为 governance_only / 不驱动仿真字段，进入 provenance 而不阻断 M9.6 frozen 案例。

#### M9.7.3 Monte Carlo/projection

目标：落地 `aircraft_support_v1` formal Monte Carlo 和四类 projection。

范围：

- 实现 Monte Carlo sweep、样本失败隔离、聚合指标和 `monte_carlo_base`。
- 生成四类 `analysis_projection_*` payload。
- 按固定代表样本规则输出一个 MC `visualization_state_series`。

完成标准：

- M9.6 case package 的 MC run 通过 canonical `/api/runs` 成功执行。
- 所有样本证据进入 `monte_carlo_base`，projection 来源指向 base artifact。
- 代表样本 metadata 可解释 sample id、参数组合、seed 和选择理由。

当前完成口径：M9.7.3 已落地 `aircraft_support_v1` formal Monte Carlo/projection。`SimulationAdapter.run_monte_carlo_scenario()` 识别 `model_family = "aircraft_support_v1"`，使用 `analysisRequests.largeSample -> MonteCarloRunConfig` 的样本数和 sweep 生成确定性样本点，按 `sample_seed = compiled Scenario seed + sample_index` 固定 seed。`monte_carlo_base` 记录 sampling contract、全部成功样本、失败样本账本、聚合指标和日志摘要；四类 `analysis_projection_*` artifact 的 `source_artifact_id` 指向 base artifact；`visualization_state_series` 由代表样本帧组成并保留 `sample_index`、`sample_step`、seed、sweep 和 run traceability。样本失败会隔离到 `failed_samples`，聚合只使用成功样本；全部样本失败时 fail closed，不写伪聚合结果。

#### M9.7.4 coverage hardening

目标：关闭 M9.7 完成口径，确保 M9.6 已冻结业务字段不再保留 unsupported。

范围：

- 更新 M9.6/M9.7 coverage 和 golden fixtures。
- 所有 M9.6 业务字段进入 consumed、derived、defaulted 或 governance_only。
- 文档同步标记 M9.7 完成，并保留 M9.8 已完成的平台嵌入和 `independent-mesa` 退役边界。

完成标准：

- coverage 中 M9.6 已冻结业务字段无 unsupported。
- `smoke`、`aviation_support`、`aircraft_support_v1` 编译和运行回归通过。
- README、docs README、roadmap、contracts README、agent 约束同步。

当前完成口径：M9.7.4 不能把“编译进入 payload”误写成行为消费；已按以下口径关闭：

- `components[].failureDistribution`、`components[].kOutOfN`、RBD 拓扑和故障参数进入 behavior-driven；RMS 中 `mttrHours`/`mldtHours` 在缺少更细 repair/logistics 输入时作为 repair duration default source，其他 RMS 显示/目标字段按 derived/governance 处理。
- `supportNodes[].transportPolicies` 进入 behavior-driving，用于短缺时补给转运、容量和优先级；`supportActivities[].transportStrategies`/`organizationStrategies` 当前批准为 governance_only，不伪消费。
- `missionProfile.periodicTasks` 的重复规则和 composite task references 进入 behavior-driving；`id`/`name` 等展示字段进入 derived 或 governance_only。
- `missionPhases`、`airports`、`missionAreas` 中影响任务时长/任务区距离/阶段限制的字段进入 behavior-driving；纯展示、标识和标签字段进入 derived/governance_only。
- 非空 `supportOrganization` 在 M9.7.4 明确批准为 governance_only / 不驱动仿真字段，写入 provenance，不再阻断正式 run。

## 初始架构方向

M9.7 模型采用 Mesa 外壳 + 领域模块 + 平台 adapter：

- `AircraftSupportV1Model`：Mesa 模型外壳，管理时钟、事件队列、agent 调度、快照和指标聚合。
- `AircraftAgent`：飞机状态、任务占用、寿命、起降次数、装备健康快照。
- `MissionScheduler`：复合任务、周期任务、波次、准备/出动/回收阶段。
- `EquipmentSystem`：装备树、LRU/SRU、故障分布、k-out-of-n、寿命停飞。
- `SupportActivityPlanner`：保障活动 DAG、工时分布、前序约束、维修策略。
- `SupportNetwork`：保障点、库存、资源池、运输策略、补给在途。
- `ReliabilityModel`：串联、并联、备用可靠性框图。
- `MetricsProjector`：生成 result summary、metrics、report、log、state-series 和四类 analysis projection payload。
- `MonteCarloRunner`：固定 seed、参数组合、样本失败隔离、聚合口径和 base artifact。
