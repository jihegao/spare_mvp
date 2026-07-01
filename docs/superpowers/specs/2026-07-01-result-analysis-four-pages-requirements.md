# 结果分析模块需求说明

日期：2026-07-01

状态：开发实现版 PRD。本文以用户主流程为核心，明确四个结果分析页的产品语义、后台自动动作、正式结果校验规则和验收标准。历史设计中的 `AnalysisTask`、`MonteCarloExperiment`、`artifact`、`run` 等概念保留为内部实现语义，不作为普通用户主界面的选择项、任务列表或结果列表。

## 1. 背景与目标

结果分析模块包含四个页面：

1. 备件短板分析
2. 飞机转场携行清单分析
3. 任务可靠度评估
4. 停机因素分析

本阶段目标是在只开放一个默认基础方案的前提下，让用户从任一分析页直接完成“配置参数 -> 运行 -> 查看当前结果”的闭环。用户不需要创建、选择或绑定 Monte Carlo 实验，不需要选择 artifact，不需要选择历史 run，也不需要在多个历史结果中挑选一个结果。

每个分析页内部对应一个固定的 current analysis profile / current result record。四个分析页共享同一个默认基础方案，但各自拥有独立参数空间、独立运行、独立过期、独立替换当前结果。

## 2. 产品边界

- 当前只开放一个默认基础方案，不开放多个用户可编辑实验方案。
- 默认基础方案由 Project 建模数据快照生成并保存。
- 四个结果分析页都消费同一个默认基础方案。
- 每个分析页内部对应一个固定的 current analysis profile / current result record。
- `AnalysisTask` 不作为用户可见任务列表存在。
- 用户不需要创建、选择或绑定 Monte Carlo 实验。
- 用户不需要选择 artifact。
- 用户不需要选择历史 run。
- 四个分析页不共享同一次 Monte Carlo 运行。
- 每个分析页独立运行、独立过期、独立替换当前结果。
- 默认基础方案变化后，四个分析页结果全部过期。
- 某个分析页参数变化后，仅该页结果过期。
- 本阶段不做用户可见历史结果列表。
- 失败运行不生成新的正式结果；如果该页已有上一条成功结果，默认继续展示上一条成功结果，并标注最近运行失败。
- 内部可以保留 run、artifact、projection、provenance、AnalysisTask 或 current result record、审计和调试信息，但这些内部概念不能成为普通用户主界面的选择项。

## 3. 用户可见结果数量

在只有一个默认基础方案时，产品层最多展示 6 个当前结果：

| 页面 | 用户可见结果 |
| --- | --- |
| 可视化推演 | 1 个当前推演结果 |
| 蒙特卡洛实验 | 1 个蒙特卡洛实验页当前评估结果 |
| 备件短板分析 | 1 个当前分析结果 |
| 飞机转场携行清单分析 | 1 个当前分析结果 |
| 任务可靠度评估 | 1 个当前分析结果 |
| 停机因素分析 | 1 个当前分析结果 |

这 6 个结果是产品层用户可见当前状态，不是历史结果列表。内部可以保留多次运行记录、artifact 和审计信息；用户界面只显示每个页面的当前结果。任意页面重跑后，只替换该页面当前结果。如果运行失败，默认不覆盖上一条成功结果，只记录最近失败状态。

## 4. 用户操作与后台自动动作映射

| 用户操作 | 后台动作 | 用户是否感知内部对象 |
| --- | --- | --- |
| 进入分析页 | 自动加载默认基础方案、当前页参数空间、当前结果状态 | 否 |
| 点击运行 | 自动创建当前页对应 Monte Carlo run，并生成 projection artifact | 否 |
| 参数变化 | 标记当前页结果为 `stale` | 否 |
| 默认基础方案刷新 | 标记四个分析页结果为 `stale` | 否 |
| 运行完成 | 校验 projection payload，校验通过后替换当前页当前结果 | 否 |
| 运行失败 | 记录失败原因，不生成新的正式结果；如存在上一条成功结果则继续保留 | 否 |
| 查看结果 | 展示当前页 KPI、表格和图形；必要时展示过期、失败或阻断提示 | 否 |

普通用户主界面不得出现“绑定 MC 实验”“选择 artifact”“选择 run”“选择历史结果”“保存全部历史结果”等内部语义。

## 5. 统一状态机

| 状态 | 含义 | 展示要求 |
| --- | --- | --- |
| `empty` | 当前页尚无结果 | 展示空态和运行入口 |
| `configured` | 参数空间已配置但尚未运行 | 展示待运行提示 |
| `running` | 当前页正在生成结果 | 展示运行中提示、进度或样本完成数 |
| `completed` | 当前页已有正式后端仿真结果 | 展示正式 KPI、表格和图形 |
| `stale` | 基础方案或当前页参数空间已变化 | 允许查看旧结果，但必须明显标注已过期，并提供重新运行入口 |
| `failed` | 最近一次运行失败 | 展示失败原因和重试入口；如果存在上一条成功结果，应保留展示并标注“最近运行失败” |
| `blocked` | 缺少正式输入、provenance、artifact 或 payload | 展示阻断原因，不展示正式结果 |
| `preview` | 仅有本地预览或演示数据 | 必须明确标注“预览，不作为正式分析结论”，不得渲染为正式结果 |

`completed` 只能代表正式后端结果。本地 preview、fixture、`singleResult` 不能进入 `completed`，只能进入 `preview`。缺少正式结果校验条件时必须 fail closed。

## 6. 正式结果来源与校验规则

正式结果来自平台 canonical run 链路：

```text
RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts
```

该链路是后台实现语义，不作为普通用户可见流程。用户只感知当前页运行状态、当前结果、失败、过期和阻断提示。

后台正式结果校验规则：

1. run 类型必须是 `monte_carlo`。
2. model family 必须是 `aircraft_support_v1`。
3. 必须存在 compiler provenance。
4. 必须存在 `monte_carlo_base`。
5. 必须存在当前页面对应的 projection artifact。
6. payload 必须能成功解析。
7. payload 的 `projection_type` 必须与当前页面匹配。
8. payload 的 `run_id`、`model_family`、traceability 必须校验通过。
9. 缺任一条件时必须 fail closed。

前端不能根据 path 或 id 模糊匹配 artifact，必须按 `kind` / `analysis_type` / `projection_type` 精确匹配。本地 demo 数据、页面内置 preview fixture、`runSimulation()`、`runMonteCarlo()` 或 `singleResult` 不得冒充正式结果。

## 7. Projection 映射

| 页面 | analysis type | artifact kind | payload `projection_type` |
| --- | --- | --- | --- |
| 备件短板分析 | `spare_shortfall` | `analysis_projection_spare_shortfall` | `spare_shortfall` |
| 飞机转场携行清单分析 | `carry_list` | `analysis_projection_carry_list` | `carry_list` |
| 任务可靠度评估 | `mission_reliability` | `analysis_projection_mission_reliability` | `mission_reliability` |
| 停机因素分析 | `downtime_factors` | `analysis_projection_downtime_factors` | `downtime_factors` |

## 8. 当前结果数据模型

每个分析页维护一个当前结果记录。推荐字段如下：

| 字段 | 说明 |
| --- | --- |
| `analysis_type` | 分析类型：`spare_shortfall` / `carry_list` / `mission_reliability` / `downtime_factors` |
| `profile_version` | 当前页参数空间版本 |
| `base_plan_version` | 默认基础方案版本 |
| `status` | 当前状态，取值见统一状态机 |
| `last_success_result` | 最近一次成功正式结果摘要 |
| `last_failure` | 最近一次失败原因、时间和可读错误 |
| `is_stale` | 当前结果是否因参数或基础方案变化而过期 |
| `source` | `formal_backend` / `preview` / `blocked` |
| `internal_run_ref` | 内部 run 引用，仅用于调试、审计和测试 |
| `internal_artifact_ref` | 内部 artifact 引用，仅用于调试、审计和测试 |
| `updated_at` | 当前记录更新时间 |

用户界面只展示与业务相关的状态、参数、KPI、表格、图形和可读错误。内部引用不得成为普通用户的选择器。

## 9. 四个页面通用需求

每个分析页都应包含：

- 当前页名称和分析目标。
- 当前参数空间。
- 当前结果状态。
- 运行入口。
- 运行中提示、进度或样本完成数。
- 当前结果是否过期的提示。
- 失败原因和重试入口。
- 阻断原因提示。
- 当前结果的 KPI、表格和图形。
- 必要的来源说明：正式结果、过期结果、本地预览或缺少正式产物。

后台应自动保证：

- 默认基础方案存在。
- 四个分析页的参数空间存在。
- 点击运行时自动使用当前基础方案和当前页参数空间。
- 当前页运行完成后只替换当前页结果。
- 当前页参数变化后只让当前页结果过期。
- 默认基础方案变化后让四个分析页结果全部过期。

## 10. 备件短板分析

### 10.1 页面目标

识别在当前基础方案和当前参数空间下，哪些备件存在短缺概率高、满足率不足或利用率异常，辅助用户调整备件配置。

### 10.2 参数与结果内容

参数可包含：

- 备件满足率约束档位：`0.85 / 0.90 / 0.95`
- 备件利用率约束档位：`0.85 / 0.90 / 0.95`
- 满足率阈值 `fill_rate_threshold`
- 短缺概率阈值 `shortage_probability_threshold`
- 高利用率阈值 `high_utilization_threshold`
- 低利用率阈值 `low_utilization_threshold`
- 样本量、随机种子、sweep 参数
- 大样本运行配置：故障率、备件倍数、保障容量等 sweep 维度

KPI 可包含：

- 短板备件数量
- 满足率不足备件数量
- 短缺概率高备件数量
- 高利用率风险备件数量
- 最低备件满足率
- 当前约束档位

表格可包含：

| 字段 | 说明 |
| --- | --- |
| 备件名称/类型 | projection payload 中的 `spare_type` |
| 满足率 | `fill_rate` |
| 利用率 | `utilization` |
| 短缺概率 | `shortage_probability` |
| 风险类型 | 满足率不足 / 短缺概率高 / 高利用率风险 / 可能冗余 |
| 风险等级 | 根据风险映射规则生成 |
| 约束达标情况 | 对比 `0.85 / 0.90 / 0.95` 档位 |

图形可包含：

- 短缺概率排序图
- 满足率 / 利用率对比图
- 高风险备件列表

### 10.3 判断规则

- `fill_rate < fill_rate_threshold` 记为满足率不足。
- `shortage_probability >= shortage_probability_threshold` 记为短缺概率高。
- `utilization >= high_utilization_threshold` 记为高利用率风险。
- `utilization <= low_utilization_threshold` 可标记为可能冗余，但不作为短缺风险。
- 短板备件数量统计满足率不足、短缺概率高或高利用率风险中的去重备件数。
- 满足率不足、利用率异常、短缺概率高三类风险必须分开展示，不得混成一个不可解释的“短缺等级”。
- 风险等级映射：同时命中短缺概率高和满足率不足为高风险；只命中其中一项或命中高利用率风险为中风险；仅命中可能冗余为低风险/提示类。
- 所有概率类字段必须裁剪到 `0~1` 范围。
- 列表默认按短缺概率降序，其次按满足率升序。
- 本地空白预览不得生成正式短板结论。

## 11. 飞机转场携行清单分析

### 11.1 页面目标

在当前基础方案和当前参数空间下，生成转场前建议携行的备件清单，明确每类备件建议携行数量、优先级和风险说明，并在满足最低任务保障风险约束的前提下，最小化建议携行备件数量。

### 11.2 参数与结果内容

参数可包含：

- 任务窗口时长，例如 `missionWindowHours`
- 参与飞机数量或计划架次
- 当前可用库存
- 转场地点或保障地点
- 推荐携行倍率
- 风险等级
- 是否启用高风险件保底数量
- 样本量、随机种子
- 优化目标：在满足最低任务保障风险约束的前提下，最小化建议携行备件数量

KPI 可包含：

- 建议携行备件总数量
- 高优先级备件数量
- 最高携行倍率
- 当前风险约束是否满足

表格可包含：

| 字段 | 说明 |
| --- | --- |
| 备件名称/类型 | projection payload 中的 `spare_type` |
| 推荐携行倍率 | `recommended_multiplier` |
| 建议携行数量 | 根据倍率、库存、风险等级和保底规则生成 |
| 优先级 | 根据 `risk_level` 映射为高/中/低 |
| 可用库存 | 当前基础方案或 projection payload 提供 |
| 风险说明 | 转场前装箱评审参考 |

图形可包含：

- 推荐携行数量排序
- 高优先级备件标记
- 携行倍率对比

### 11.3 规则与边界

- 页面只聚焦转场前建议携行哪些备件、每类备件建议携行多少、优先级和风险说明。
- 高风险备件启用保底数量时，建议携行数量不得低于保底值。
- 中低风险备件可按推荐携行倍率和库存约束计算。
- 页面应明确这是转场前装箱评审清单，不是库存总量配置页。
- 第一版不做重量、体积、装载约束优化；这些能力可作为后续扩展。
- 本页面不展示异常快照管理能力。

## 12. 任务可靠度评估

### 12.1 页面目标

评估当前基础方案下任务成功概率、出动架次率和目标达成情况，帮助用户判断任务可靠度是否满足目标。

### 12.2 参数与结果内容

参数可包含：

- 任务可靠度目标，例如 `target = 0.9`
- 样本量、随机种子、sweep 参数
- 时间窗口或任务阶段筛选

KPI 可包含：

- 任务成功概率
- 出动架次率
- 目标达成状态
- 最大下降区间

表格可包含：

| 字段 | 说明 |
| --- | --- |
| 序号 | 曲线点序号 |
| 时间/阶段 | `simulation_time` 或任务阶段 |
| 任务成功概率 | `mission_success_probability` |
| 出动架次率 | `sortie_rate` |
| 状态 | 满足/未达标 |

图形可包含：

- 任务可靠度趋势曲线
- 出动架次率趋势
- 最大下降区间标记

### 12.3 判断规则

- `mission_success_probability` 表示当前基础方案下任务成功概率。
- `sortie_rate` 表示计划架次完成率或出动架次率，具体以后端 projection payload 字段定义为准。
- 若 payload 提供时间序列，则展示趋势曲线。
- 若 payload 只有聚合值，则允许生成单点序列展示，但必须标注正式来源。
- 目标达成状态第一版按最终任务成功概率是否大于等于 `target` 判断。
- 最大下降区间仅在存在时间序列时计算。
- `mission_success_probability` 和 `sortie_rate` 必须在 `0~1` 范围内。
- 页面只显示正式 projection；缺少 `analysis_projection_mission_reliability` payload 时不展示正式曲线。

## 13. 停机因素分析

### 13.1 页面目标

识别导致飞机停机或保障延误的主要因素，展示停机因素贡献度和异常停机快照，辅助定位装备故障、备件短缺、资源延误或计划延误问题。

### 13.2 参数与结果内容

参数可包含：

- `topN`
- 样本量、随机种子、sweep 参数
- 事件类型筛选
- 是否展示异常停机快照

KPI 可包含：

- 停机因素总项数
- 首要因素
- 次要因素
- 异常停机快照数量

表格可包含：

| 字段 | 说明 |
| --- | --- |
| 因素类型 | `failure` / `spare_shortage` / `resource_delay` / `schedule_delay` |
| 因素名称 | 装备故障 / 备件短缺 / 资源延误 / 计划延误 |
| 贡献度 | `contribution` |
| 次数或权重 | 优先使用 payload 字段；未给出时可为空 |

异常停机快照列表可包含：

| 字段 | 说明 |
| --- | --- |
| 快照 ID | `snapshot_id` |
| 仿真时间 | `simulation_time` |
| 事件类型 | `event_type` |
| 事件标签 | `event_label` |
| 事件结果 | `result` |
| 保障活动状态 | `support_activity_state` |
| 活动作业数 | `support_activity_state.active_jobs` |
| 维修积压 | `support_activity_state.repair_backlog` |
| 备件满足率 | `support_activity_state.spare_fill_rate` |
| 作业节点引用 | `job_node` |
| frame reference | `sample_index` / `sample_step` / `step` |

图形可包含：

- 停机因素贡献度柱状图
- 主要因素排序
- 异常停机快照列表

### 13.3 判断规则

- `contribution` 必须裁剪到 `0~1` 范围。
- 如 projection payload 已给出次数、权重，则优先使用 payload 字段。
- 如未给出次数或权重，可只展示贡献度，不强行派生虚假次数。
- 贡献度排序默认降序。
- 因素类型至少支持：装备故障、备件短缺、资源延误、计划延误。
- 异常快照必须带 frame reference，便于后续与代表样本状态序列或事件流追溯。
- 页面只显示正式 projection；缺少 `analysis_projection_downtime_factors` payload 时不展示正式异常快照。

### 13.4 第一版限制

- 异常快照只读展示。
- 不支持删除异常快照。
- 不支持异常样本深度钻取。
- 不支持从快照反向跳转复杂事件回放。
- 可保留 frame reference，为后续钻取能力做准备。

## 14. 数据持久化要求

- 默认基础方案需要持久化。
- 四个分析页的参数探索空间需要持久化。
- 四个当前分析结果需要持久化或可恢复为当前状态。
- 当前结果应记录状态、参数版本、基础方案版本、正式来源、最近成功结果和最近失败信息。
- 产品层不保存多版本结果历史。
- 内部可保留多次运行记录、artifact 和审计信息，用于调试、测试和追溯。
- 基础方案刷新后，四个当前结果进入 `stale`。
- 某个分析页参数变化后，仅该页当前结果进入 `stale`。

## 15. 内部实现对象说明

| 对象 | 内部语义 | 用户可见性 |
| --- | --- | --- |
| `ExperimentPlan` | 默认基础方案或其内部版本来源 | 对用户弱化为默认基础方案 |
| `SimulationExperimentBase` | 单次仿真实验和 MC 实验共享运行对象 | 不可见 |
| `SingleSimulationExperiment` | 服务可视化推演的单次/交互式仿真记录 | 不作为选择器展示 |
| `MonteCarloExperiment` | 批量运行主账本，扩展样本量、sweep、聚合和 projection | 不可见 |
| `AnalysisTask` | 内部分析任务或 current result record 的实现方式 | 不作为用户可见任务列表存在 |
| `artifact` / `projection` | 正式结果产物和分析 payload | 不作为选择器展示 |
| `run` | 后台运行记录、审计和追溯对象 | 不作为选择器展示 |

这些对象可用于调试、审计、测试和后端追溯，但普通用户主流程只看到默认基础方案、当前页参数空间、运行入口、状态提示、KPI、表格和图形。

## 16. 非目标

- 本阶段不开放多个用户可编辑实验方案。
- 本阶段不开放实验方案参数编辑界面。
- 本阶段不做用户可见历史结果列表。
- 本阶段不让四个分析页共享同一次变参数 MC 结果。
- 本阶段不展示 AnalysisTask、MonteCarloExperiment、artifact、run 选择器。
- 本阶段不实现生产级 worker queue。
- 本阶段不实现 object storage。
- 本阶段不实现完整 cancel 基础设施。
- 本阶段不实现完整报告导出。
- 本阶段最多支持当前表格轻量导出，完整报告导出放后续版本。
- 本阶段不实现异常样本深度钻取。
- 本阶段不支持删除异常快照。
- 本阶段不把静态 demo、小样本 Monte Carlo 或本地 preview 描述为工程级正式结果。

## 17. 验收标准

1. 新建或导入项目后，系统能自动生成或加载一个默认基础方案。
2. 进入任意结果分析页，不需要手动创建方案、选择历史 run、绑定 MC 或选择 artifact。
3. 四个分析页都能基于同一个默认基础方案运行。
4. 任意一个分析页运行完成后，只替换该页当前结果。
5. 任意一个分析页运行两次后，只展示第二次成功运行的当前结果。
6. 任意一个分析页运行失败后，不生成新的正式结果。
7. 若该页已有上一条成功结果，则失败后继续展示上一条成功结果，并提示最近运行失败。
8. 任意一个分析页重跑，不影响另外三个分析页当前结果。
9. 修改某个分析页参数空间，只让该页结果过期。
10. 刷新默认基础方案后，四个分析页结果全部过期。
11. 缺少 compiler provenance 时，不展示正式结果。
12. 缺少 `monte_carlo_base` 时，不展示正式结果。
13. 缺少当前页面对应 projection artifact 时，不展示正式结果。
14. payload 解析失败时，不展示正式结果。
15. payload `projection_type` 与页面类型不一致时 fail closed。
16. 本地 preview 不得进入 `completed` 状态。
17. 用户主界面不出现“绑定 MC 实验”“选择 artifact”“保存全部历史结果”“选择旧 run”等内部语义。
18. 测试能证明产品层不会出现多条用户可见历史结果。
19. 停机因素分析页能展示异常快照 frame reference。
20. 飞机转场携行清单分析页不展示异常快照管理能力。

## 18. 待确认问题

1. 默认基础方案刷新是否由“建模发布”触发，还是由“保存建模数据”触发？
2. 四个分析页第一版是否开放参数编辑控件，还是只展示默认参数？
3. 调试模式下是否允许展示内部 run、artifact、projection 和 provenance？
4. 四个分析页是否需要轻量导出 CSV / JSON？
5. 蒙特卡洛实验页的当前评估结果是否复用同一套 current result 状态模型？

## 19. 参考来源

- `README.md`
- `agent.md`
- `docs/product-roadmap.md`
- `docs/superpowers/specs/2026-06-20-m6-2-unified-monte-carlo-analysis-design.md`
- `docs/superpowers/specs/2026-06-21-m8-projection-payload-analysis-design.md`
- `docs/superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md`
- `docs/superpowers/plans/2026-07-01-analysis-profile-monte-carlo-results.md`
- `front/analysis-projection-adapters.mjs`
- `front/app.js`
