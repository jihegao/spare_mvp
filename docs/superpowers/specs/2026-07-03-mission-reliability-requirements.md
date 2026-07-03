# 任务可靠度评估需求说明

日期：2026-07-03

状态：开发实现版 PRD。本文参考 `2026-07-01-result-analysis-four-pages-requirements.md` 的编写思路，只保留“任务可靠度评估”相关内容，用于明确任务可靠度评估页的产品语义、后台自动动作、正式结果校验规则和验收标准。历史设计中的 `AnalysisTask`、`MonteCarloExperiment`、`artifact`、`run` 等概念保留为内部实现语义，不作为普通用户主界面的选择项、任务列表或结果列表。

## 1. 背景与目标

任务可靠度评估页用于评估当前默认基础方案下任务可靠度 / 任务完成率，帮助用户判断给定任务口径下任务是否能够完成、完成概率是多少，以及该结果由哪些架次、单机可靠性数据、可靠性框图或失效率数据支撑。

本阶段按会议纪要明确的“单天任务”口径收口：一天内要求的所有架次均成功，才算当天任务完成。页面同时需要保留单机指定时长任务和三小时任务的结果表达能力，用于展示“给定任务时长下单机完成任务的概率”。

目标：

1. 明确任务可靠度不能仅按单个架次或单次任务成功概率展示，应按整个任务口径计算。
2. 支持按单天、多架次全部成功口径展示任务完成概率。
3. 支持展示单机指定时长任务可靠度，尤其是三小时任务场景。
4. 保持结果分析页现有 current profile / current result 的实现思路：用户只看到当前任务可靠度评估结果，不直接操作内部 run、artifact 或历史结果。
5. 只展示正式后端 projection 结果；本地 preview、静态演示值或前端临时推导不得冒充正式评估结论。

## 2. 产品边界

- 当前只开放一个默认基础方案，不开放多个用户可编辑实验方案。
- 任务可靠度评估页内部对应一个固定的 current analysis profile / current result record。
- 用户不需要创建、选择或绑定 Monte Carlo 实验。
- 用户不需要选择 artifact。
- 用户不需要选择历史 run。
- 用户主界面不得出现“绑定 MC 实验”“选择 artifact”“选择 run”“选择历史结果”“保存全部历史结果”等内部语义。
- 任务可靠度评估页独立运行、独立过期、独立替换当前结果。
- 默认基础方案变化后，任务可靠度评估结果过期。
- 任务可靠度评估页可调配置变化后，仅该页结果过期。
- 失败运行不生成新的正式结果；如果该页已有上一条成功结果，默认继续展示上一条成功结果，并标注最近运行失败。
- 内部可以保留 run、artifact、projection、provenance、AnalysisTask 或 current result record、审计和调试信息，但这些内部概念不能成为普通用户主界面的选择项。
- 第一版不做跨多天连续任务排程可靠度。
- 第一版不做维修、备份资源调度、任务中止后重试等动态任务过程建模。
- 第一版不要求用户手工维护可靠性框图或失效率；这些数据由默认基础方案、任务计划或后端可靠性数据源提供。

## 3. 用户可见结果数量

在只有一个默认基础方案时，任务可靠度评估页最多展示 1 个当前分析结果。

该结果是产品层用户可见当前状态，不是历史结果列表。内部可以保留多次运行记录、artifact 和审计信息；用户界面只显示任务可靠度评估页的当前结果。任意重跑后，只替换该页面当前结果。如果运行失败，默认不覆盖上一条成功结果，只记录最近失败状态。

## 4. 用户操作与后台自动动作映射

| 用户操作 | 后台动作 | 用户是否感知内部对象 |
| --- | --- | --- |
| 进入任务可靠度评估页 | 自动加载默认基础方案、任务可靠度评估配置要素、当前结果状态 | 否 |
| 点击运行 | 自动创建当前页对应 Monte Carlo run，并生成 `analysis_projection_mission_reliability` projection artifact | 否 |
| 最大时间窗口或后续开放的任务配置变化 | 标记任务可靠度评估结果为 `stale` | 否 |
| 默认基础方案刷新 | 标记任务可靠度评估结果为 `stale` | 否 |
| 运行完成 | 校验 mission reliability projection payload，校验通过后替换当前任务可靠度结果 | 否 |
| 运行失败 | 记录失败原因，不生成新的正式结果；如存在上一条成功结果则继续保留 | 否 |
| 查看结果 | 展示任务可靠度 KPI、表格、图形、计算口径、数据来源和过期 / 失败 / 阻断提示 | 否 |

## 5. 统一状态机

| 状态 | 含义 | 展示要求 |
| --- | --- | --- |
| `empty` | 当前页尚无任务可靠度结果 | 展示空态和运行入口 |
| `configured` | 当前页实验配置已就绪但尚未运行 | 展示待运行提示 |
| `running` | 当前页正在生成任务可靠度结果 | 展示运行中提示、进度或样本完成数 |
| `completed` | 当前页已有正式后端任务可靠度结果 | 展示正式 KPI、表格和图形 |
| `stale` | 基础方案或当前页可调配置已变化 | 允许查看旧结果，但必须明显标注已过期，并提供重新运行入口 |
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
5. 必须存在 `analysis_projection_mission_reliability` projection artifact。
6. payload 必须能成功解析。
7. payload 的 `projection_type` 必须是 `mission_reliability`。
8. payload 的 `run_id`、`model_family`、traceability 必须校验通过。
9. 缺任一条件时必须 fail closed。

前端不能根据 path 或 id 模糊匹配 artifact，必须按 `kind` / `analysis_type` / `projection_type` 精确匹配。本地 demo 数据、页面内置 preview fixture、`runSimulation()`、`runMonteCarlo()` 或 `singleResult` 不得冒充正式结果。

## 7. Projection 映射

| 页面 | analysis type | artifact kind | payload `projection_type` |
| --- | --- | --- | --- |
| 任务可靠度评估 | `mission_reliability` | `analysis_projection_mission_reliability` | `mission_reliability` |

## 8. 当前结果数据模型

任务可靠度评估页维护一个当前结果记录。推荐字段如下：

| 字段 | 说明 |
| --- | --- |
| `analysis_type` | 固定为 `mission_reliability` |
| `profile_id` | 当前任务可靠度评估页固定 profile |
| `status` | `empty` / `configured` / `running` / `completed` / `stale` / `failed` / `blocked` / `preview` |
| `current_run_id` | 最近一次正式运行 ID，用户不可见 |
| `current_artifact_id` | 最近一次正式 projection artifact ID，用户不可见 |
| `payload` | 通过校验后的任务可靠度 projection payload |
| `last_success_at` | 最近一次成功替换当前结果的时间 |
| `last_failure` | 最近一次失败原因 |
| `stale_reason` | 过期原因，如基础方案刷新或任务可靠度页配置变化 |
| `traceability` | run、scenario、model family、projection 的追溯信息 |

## 9. 任务可靠度评估

### 9.1 页面目标

评估当前基础方案下任务可靠度 / 任务完成率，帮助用户判断给定任务口径下任务是否能够完成、完成概率是多少，以及该结果由哪些架次、单机可靠性数据、可靠性框图或失效率数据支撑。

本页第一版按会议纪要明确的“单天任务”口径收口：一天内要求的所有架次均成功，才算当天任务完成。页面同时需要保留单机指定时长任务和三小时任务的结果表达能力，用于展示“给定任务时长下单机完成任务的概率”。

### 9.2 参数与结果内容

实验配置要素：

- 任务评估口径 `mission_reliability_mode`
  - 第一版默认值为 `single_day_all_sorties_success`。
  - 语义：按单天统计，一天内所有要求架次均成功才算任务完成。
- 单天要求架次数 `required_sortie_count`
  - 可来自默认基础方案、任务计划、后端默认配置或 run-scoped scenario override。
  - 会议示例为“一天出五架次”，但具体数量不在本文中固化。
- 单架次成功概率 `sortie_success_probability`
  - 可来自正式 projection、单机指定时长评估结果、后端可靠性计算结果或基础方案数据。
  - 若各架次概率不同，payload 应提供逐架次概率数组。
- 任务时长 `mission_duration_hours`
  - 用于单机指定时长任务可靠度评估。
  - 三小时任务场景中默认值为 `3`。
- 可靠性数据来源
  - 可包含可靠性框图、失效率、可靠度曲线或后端已计算的单机可靠度。
- 最大时间窗口 `max_time_window`
  - 如 payload 提供趋势序列，仍用于限定趋势展示和最大下降区间统计范围。

页面用户可调参数：

- 第一版可继续只开放 `max_time_window`。
- 单天架次数、三小时任务时长、任务可靠度目标、样本量、随机种子和底层可靠性数据来源可先由默认基础方案、任务计划或后端策略提供，不作为第一版普通用户可调控件。
- 若后续开放任务口径、架次数或任务时长配置，必须只影响当前任务可靠度评估页的 current analysis profile，不得回写 Project、ModelingSnapshot 或 imported JSON。

输出：

- 单天任务完成概率。
- 单天任务失败概率。
- 单架次成功概率或逐架次成功概率。
- 要求架次数。
- 单机指定时长任务可靠度。
- 三小时任务可靠度。
- 出动架次率 / 计划架次完成率。
- 目标达成状态。
- 计算口径说明。
- 数据来源说明。
- 最大下降区间和趋势图，如 payload 提供时间序列。

后台固定语义：

- 任务可靠度第一版不按单个架次直接代表整个任务成功概率，而是按“整个单天任务”计算。
- 单天任务成功条件为：一天内所有要求架次全部成功。
- 当各架次成功概率相同，且一天内要求架次数为 `n`、单架次成功概率为 `p` 时，单天任务完成概率为 `p^n`。
- 当各架次成功概率不同，且第 `i` 个架次成功概率为 `p_i` 时，单天任务完成概率为 `p_1 * p_2 * ... * p_n`。
- 单天任务失败概率为 `1 - daily_mission_success_probability`。
- 上述组合概率默认各架次成功事件相互独立；如后端 projection 使用相关性、共因失效、资源耦合或仿真聚合结果，应在 payload 的计算口径中明确说明。
- 单机指定时长任务可靠度应基于后端正式可靠性数据计算，包括可靠性框图、失效率或后端认可的可靠度模型。
- 三小时任务是单机指定时长任务的典型场景，任务时长固定为 3 小时；结果应能回答“三小时之后任务完成概率是多少”。
- 最大时间窗口用于限定任务可靠度趋势和最大下降区间的统计范围。

KPI 可包含：

- 单天任务完成概率
- 单天任务失败概率
- 要求架次数
- 单架次成功概率
- 单机指定时长任务可靠度
- 三小时任务可靠度
- 出动架次率 / 计划架次完成率
- 目标达成状态
- 最大下降区间

表格可包含：

| 字段 | 说明 |
| --- | --- |
| 序号 | 曲线点序号 |
| 时间/阶段 | `simulation_time`、任务阶段或任务时长 |
| 评估口径 | 例如 `single_day_all_sorties_success`、`single_machine_duration`、`three_hour_mission` |
| 要求架次数 | `required_sortie_count` |
| 单架次成功概率 | `sortie_success_probability`；若各架次不同，展示摘要或明细入口 |
| 单天任务完成概率 | `daily_mission_success_probability` |
| 单天任务失败概率 | `daily_mission_failure_probability` |
| 单机任务可靠度 | `single_machine_mission_reliability` |
| 三小时任务可靠度 | `three_hour_mission_reliability` |
| 出动架次率 | `sortie_rate` |
| 状态 | 满足 / 未达标 |
| 计算口径 | 概率计算公式、独立性假设或后端 projection 口径说明 |
| 数据来源 | 可靠性框图、失效率、正式 projection 或后端模型版本 |

图形可包含：

- 单天任务完成概率趋势曲线
- 出动架次率趋势
- 三小时任务可靠度趋势或单点标记
- 最大下降区间标记
- 各架次成功概率对比，如 payload 提供逐架次明细
- 可靠性框图 / 失效率数据来源说明，如后端支持

### 9.3 判断规则

- `mission_success_probability` 可继续作为页面兼容字段展示，但在本页结论中应优先解释为当前口径下的任务成功概率，不得默认等同于单架次成功概率。
- `daily_mission_success_probability` 表示单天任务完成概率，成功条件为当天要求的全部架次均成功。
- `daily_mission_failure_probability` 必须等于 `1 - daily_mission_success_probability`，允许因小数精度存在极小舍入误差。
- `sortie_success_probability` 表示单架次成功概率；若 payload 只提供一个值，则表示各架次使用同一概率；若 payload 提供数组，则按逐架次概率计算。
- `required_sortie_count` 必须为大于等于 1 的整数。
- 当使用相同单架次成功概率时，`daily_mission_success_probability = sortie_success_probability ^ required_sortie_count`。
- 当使用逐架次成功概率时，`daily_mission_success_probability = product(sortie_success_probabilities)`。
- 单天任务完成概率、单架次成功概率、单机任务可靠度、三小时任务可靠度、出动架次率都必须在 `0~1` 范围内。
- 多架次全部成功口径下，整体单天任务完成概率通常低于或等于任一单架次成功概率；页面应通过计算口径说明避免用户误以为单架次概率就是任务概率。
- `single_machine_mission_reliability` 表示指定任务时长下的单机任务完成概率；其来源必须是正式后端可靠性数据或 projection payload。
- `three_hour_mission_reliability` 表示任务时长为 3 小时时的单机任务完成概率。
- 单机 / 三小时任务计算若依赖可靠性框图或失效率，payload 应提供数据来源、版本或 traceability；缺失来源时不得展示为正式结论。
- `sortie_rate` 表示计划架次完成率或出动架次率，具体以后端 projection payload 字段定义为准；该指标不能单独替代任务可靠度。
- 最大时间窗口用于过滤或截断参与展示和计算的时间序列点；不得改变 payload 原始值。
- 若 payload 提供时间序列，则展示趋势曲线。
- 若 payload 只有聚合值，则允许生成单点序列展示，但必须标注正式来源。
- 目标达成状态第一版按后端 projection payload 给出的目标或系统默认目标判断；如同时存在任务可靠度目标和出动架次率目标，应分别展示或明确综合判定规则。
- 最大下降区间仅在存在时间序列时计算。
- 页面只显示正式 projection；缺少 `analysis_projection_mission_reliability` payload 时不展示正式曲线。
- 本地 preview、静态演示值或前端临时推导不得冒充正式任务可靠度评估结果。
- 待确认术语：会议中“架次 / 波次 / 批次”“任务可靠度 / 任务完成率”“可靠性框图”“失效率”的正式命名以后端领域模型和评审结论为准。

## 10. 结果持久化要求

- 任务可靠度评估页必须持久化当前 result record。
- 正式结果必须保留 run id、artifact id、projection type、model family、traceability、payload digest 和 generated_at。
- stale 不删除旧结果，只更新状态和 stale reason。
- failed 不覆盖上一条成功结果。
- blocked 不展示正式 KPI 和正式图形。
- preview 与 completed 必须严格区分。
- 若后续开放任务口径、架次数或任务时长配置，应将配置写入当前页 current analysis profile 或 run-scoped scenario override，不得回写默认基础方案。

## 11. 内部实现对象说明

这些对象只作为内部实现语义：

- `AnalysisTask`
- `MonteCarloExperiment`
- `RunIntent`
- `Run`
- `artifact`
- `projection`
- `current analysis profile`
- `current result record`
- `provenance`
- `traceability`

普通用户主界面不出现这些对象的选择、绑定或管理入口。调试模式如需展示，必须有明确调试标识。

## 12. 非目标

- 本阶段不实现用户可见历史任务可靠度结果列表。
- 本阶段不允许用户手工选择 run 或 artifact。
- 本阶段不把本地 preview 渲染为正式任务可靠度结果。
- 本阶段不实现跨多天复杂任务排程可靠度。
- 本阶段不实现维修、备份资源调度、任务中止后重试等动态过程。
- 本阶段不要求前端自行计算正式可靠性框图或失效率结果；正式结论以后端 projection 为准。
- 本阶段最多支持当前表格轻量导出，完整报告导出放后续版本。

## 13. 验收标准

1. 进入任务可靠度评估页，不需要手动创建方案、选择历史 run、绑定 MC 或选择 artifact。
2. 任务可靠度评估页能基于默认基础方案运行。
3. 运行完成后，只替换任务可靠度评估页当前结果。
4. 运行两次后，只展示第二次成功运行的当前结果。
5. 运行失败后，不生成新的正式结果。
6. 若已有上一条成功结果，则失败后继续展示上一条成功结果，并提示最近运行失败。
7. 修改任务可靠度评估页可调配置后，只让该页结果过期。
8. 刷新默认基础方案后，任务可靠度评估结果过期。
9. 缺少 compiler provenance 时，不展示正式结果。
10. 缺少 `monte_carlo_base` 时，不展示正式结果。
11. 缺少 `analysis_projection_mission_reliability` artifact 时，不展示正式结果。
12. payload 解析失败时，不展示正式结果。
13. payload `projection_type` 不是 `mission_reliability` 时 fail closed。
14. 本地 preview 不得进入 `completed` 状态。
15. 用户主界面不出现“绑定 MC 实验”“选择 artifact”“保存全部历史结果”“选择旧 run”等内部语义。
16. 若 payload 提供 `required_sortie_count=5`、`sortie_success_probability=0.9`，页面展示的单天任务完成概率应为 `0.9^5=0.59049`。
17. 若 payload 提供逐架次概率 `0.9, 0.8, 0.95`，页面展示的单天任务完成概率应为 `0.684`。
18. 当任务成功概率、单架次成功概率、三小时任务可靠度或出动架次率超出 `0~1` 范围时，页面不得展示为正式结果。
19. 页面必须展示“全部架次成功才算任务完成”的计算口径说明。
20. 单机 / 三小时任务结果缺少可靠性框图、失效率或后端数据来源 traceability 时，不展示为正式结论。

## 14. 待确认问题

1. “架次 / 波次 / 批次”的正式术语是什么，是否均指一次出动 / 一次任务？
2. “任务可靠度”和“任务完成率”在系统中是否作为同一指标处理，还是需要分别定义？
3. 单天任务中多个架次是否默认相互独立；若不独立，相关性如何建模？
4. 单机任务的对象是飞机、设备、系统还是其他实体，系统字段命名需统一。
5. 可靠性框图、失效率数据的来源模块、接口方式和数据结构是什么？
6. 三小时任务是否只是一个快捷场景，还是需要独立业务规则？
7. 任务可靠度达标阈值是否存在，若存在，阈值由谁配置？
8. 第一版是否继续只开放 `max_time_window`，还是需要开放架次数、任务时长或任务口径配置？

## 15. 参考来源

- `docs/superpowers/specs/2026-07-01-result-analysis-four-pages-requirements.md`
- 2026-07-03 会议录音转写纪要
