# Mesa 仿真服务治理约定

日期：2026-06-19

## 背景

`spare_mvp` 后续将采用 contract-first 的方式，把前端 Project JSON、Ontology、Scenario 编译、Mesa 运行、Run Artifact 和真实后台 API 对齐起来。Mesa 仿真服务会成为后台、前端和 agent swarm 的重要对齐边界，因此需要明确维护权和变更沟通规则。

## 维护权约定

1. Mesa 仿真服务由 Claude 负责维护。
2. 任何 agent、subagent 或人工开发者在修改 Mesa 仿真模型、仿真运行器、Scenario 编译口径、核心指标口径或仿真 artifact 结构前，必须先与 Claude 沟通。
3. 未经沟通，不应直接修改会影响仿真语义的文件或接口。
4. 后端、数据库、前端集成和测试 agent 可以消费仿真契约，但不能绕过 Claude 直接改变仿真模型行为。

## 需要沟通的变更范围

以下变更必须先与 Claude 对齐：

1. 修改 Mesa `Model`、Agent 状态机、`step()` 推进逻辑或随机过程。
2. 修改 `snapshot()` 输出字段、指标定义、统计口径或单位。
3. 修改 Project JSON 到 Scenario 的编译规则。
4. 修改 ontology 中会影响仿真实体、关系、字段约束或行为假设的内容。
5. 修改仿真输入参数、默认值、seed 规则、Monte Carlo 采样规则或 sweep 口径。
6. 修改 run artifact、summary、time series、report manifest 的结构。
7. 将静态前端 demo 数据升级为仿真 fixture 或 smoke scenario。

## 可以不沟通但需要遵守契约的变更

以下变更通常不需要先与 Claude 沟通，但必须通过现有 contract tests：

1. 后端 Project、ExperimentPlan、SimulationRun、ArtifactManifest 的 CRUD 实现。
2. 数据库表结构、迁移和 repository 层实现。
3. 前端把内存状态替换为 API 调用。
4. 鉴权、权限、审计、项目列表、运行状态查询等应用层功能。
5. 只新增不改变仿真语义的文档、测试说明或 UI 文案。

## Agent swarm 边界

在 agent swarm 中，应默认采用如下边界：

| Agent 类型 | 是否可修改 Mesa 仿真服务 | 说明 |
| --- | --- | --- |
| Contract Curator Agent | 不可直接修改 | 可提出 contract diff，由 Claude 复核仿真影响。 |
| Simulation Adapter Agent | 需先沟通 | 任何 Scenario 编译、runner、artifact 结构变更都需与 Claude 对齐。 |
| Backend API Agent | 不可直接修改 | 只能消费仿真契约和 run artifact。 |
| Database Agent | 不可直接修改 | 负责持久化仿真服务返回的版本、run_id 和 artifact metadata。 |
| Frontend Integration Agent | 不可直接修改 | 可以调用仿真契约服务，但不应自行拼最终 Scenario。 |
| Evaluator / Test Agent | 可新增黑盒测试 | 可新增 contract/smoke/e2e 测试；若测试要求改变仿真行为，需先与 Claude 沟通。 |

## Agent swarm 分工

后续开发采用 6 类 agent 分工，而不是由单个 coding agent 一次性实现完整后端。所有 agent 都以 `Project JSON -> Simulation Adapter -> Scenario JSON -> Mesa run -> artifact` 为主线，不能各自发明字段或绕过契约服务。

| Agent | 职责 | 主要产物 | 关键边界 |
| --- | --- | --- | --- |
| Contract Curator Agent | 读取前端 project-json-contract、ontology、Mesa `snapshot()` 输出，整理统一 contract；`visualization_state()` 只能作为可视化契约参考，不能作为 Result 指标来源。 | `contracts/project.schema.json`、`contracts/scenario.schema.json`、`contracts/run.schema.json`、`contracts/result.schema.json`、`contracts/artifact_manifest.schema.json`、OpenAPI 草案和 fixture。 | 不直接修改 Mesa model、runner、Scenario 编译逻辑；只能提出 contract diff。 |
| Simulation Adapter Agent | 把 Project JSON 编译成 Mesa Scenario，调用 `SpareMvpModel` / `AviationSupportModel`，保存 run artifact，返回 summary 和 metrics。 | `POST /validate/project`、`POST /compile-scenario`、`POST /runs`、`GET /runs/{run_id}`、`GET /runs/{run_id}/artifacts`。 | Scenario 编译规则、核心指标、artifact 结构必须先与 Claude 对齐。 |
| Backend API Agent | 实现 Project、ExperimentPlan、Scenario、SimulationRun、ArtifactManifest 的应用 API。 | `POST /projects`、`GET /projects/{project_id}`、`POST /projects/{project_id}/modeling-snapshot`、`POST /experiment-plans`、`POST /simulation-runs`。 | 只能引用 contract 和 Simulation Adapter；不能自己拼最终 Scenario。 |
| Database Agent | 设计数据库表、迁移和 repository，保证版本与产物可追溯。 | `projects`、`users`、`experiment_plans`、`modeling_snapshots`、`scenarios`、`simulation_runs`、`result_summaries`、`artifact_manifests`。 | 数据库不是仿真语义来源；字段必须来自 contract 或应用生命周期对象。 |
| Frontend Integration Agent | 把当前前端内存状态替换为 API 调用，保留当前 UX。 | 建模保存、方案运行、结果查看、artifact 下载的 API 接入。 | 前端可以编辑 Project JSON，但 Scenario JSON 必须由 Simulation Adapter 生成。 |
| Evaluator / Test Agent | 运行 contract tests、smoke scenario、端到端测试和字段漂移检查。 | schema validation、contract drift tests、smoke/e2e 报告。 | 黑盒测试可新增；若测试要求改变 Mesa 行为或指标口径，必须先与 Claude 对齐。 |

一句话边界：**Project JSON 可以由前端编辑，Scenario JSON 必须由 Simulation Adapter 编译，Mesa 语义由 Claude 维护。**

## 开发顺序

| PR | 主责 agent | 目标 | 验收 |
| --- | --- | --- | --- |
| PR-A | Contract Curator Agent | 发布 `contracts/` schema bundle、最小示例 fixture 和基础 contract-curator tests。 | `npm test` 能验证 schema 文件存在、版本一致、当前前端 Project JSON fixture 可校验，并保留 Mesa 输出指标边界。 |
| PR-B | Evaluator / Test Agent | 扩展 JSON Schema validation、Mesa contract smoke 和前后端字段漂移测试。 | 任一字段名在前端、API、DB、Scenario 或结果页漂移时测试失败。 |
| PR-C | Simulation Adapter Agent | 实现最小 validate / compile / run / artifacts 服务边界。 | 一个最小 Project JSON 能被校验、编译为 Scenario、启动 run 并返回 artifact manifest。 |
| PR-D | Database Agent | 增加数据库 migration 和 repository。 | `schema_version`、`project_version`、`scenario_version`、`run_id`、`artifact_manifest_id` 可追溯。 |
| PR-E | Backend API Agent | 实现 Project / ExperimentPlan / SimulationRun / ArtifactManifest CRUD 和运行编排。 | API 只消费 contract 和 adapter 返回，不直接解释仿真语义。 |
| PR-F | Frontend Integration Agent | 前端改为保存 Project JSON、提交运行、读取真实 result/artifact。 | 当前 UX 保持，页面不再直接拼最终 Scenario。 |
| PR-G / M3-0 | Evaluator / Test Agent | 跑通建模 -> 保存 -> 编译 -> 运行 -> 结果查看端到端闭环，并用本地同源 `/api` 验证前端可访问的真实后端 smoke。 | contract、smoke、HTTP API、e2e 全部通过；明确 `smoke` 已收束、`aviation_support` Scenario 编译仍受治理阻断，不扩大 calibration 或生产 Web API 声明。 |
| M3-1 | Evaluator / Test Agent | 用真实浏览器验证同源 `/front/` -> `/api` 保存项目、启动 smoke run、读取 Result/ArtifactManifest，并刷新恢复同一个 `run_id`。 | `/api` 不可用时前端阻断并且不创建 `offline-demo-run`；仍不声明生产 Web API、worker 队列或长期 artifact storage。 |
| M5 首片 | Contract Curator Agent / Evaluator Agent | 定义建模数据导入/校验 contract、JSON fixture、对象 ID/引用/数值/版本保护错误结构。 | 不做完整 Excel UI，不跳过 Simulation Adapter 拼最终 Scenario，不解锁 `aviation_support` Scenario 编译，不改变 Mesa 行为或指标口径。 |

## PR 审核规则

若 PR 触及以下路径，应在 PR 描述中显式写明“已与 Claude 对齐”或“仅消费仿真契约，不改变仿真语义”：

```text
src/spare_mvp_abm/
src/spare_mvp_contract/
ontology/
scenarios/
runs fixture / artifact schema
```

PR 描述至少应说明：

1. 变更是否影响仿真输入。
2. 变更是否影响仿真行为。
3. 变更是否影响输出指标或 artifact。
4. 是否需要 schema_version、scenario_version 或 result_version 升级。
5. 与 Claude 沟通后的结论。

## 版本化原则

1. 仿真输入、输出、指标或 artifact 结构发生兼容性变更时，必须升级相应版本号。
2. 后端和前端不得依赖未版本化的隐式字段。
3. 旧 fixture 应尽量保留，用于验证迁移和回归。
4. 任何破坏性变更都应提供 migration note 或兼容层说明。

## 一句话原则

Mesa 仿真服务是 `spare_mvp` 的可执行语义契约，由 Claude 维护；其他 agent 可以围绕它实现后台、数据库和前端，但不能绕过 Claude 改变仿真模型口径。
