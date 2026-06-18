# Mesa 仿真服务治理约定

日期：2026-06-18

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
