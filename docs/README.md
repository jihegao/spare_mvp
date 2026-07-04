# 项目文档入口

本目录是 `spare_mvp` 项目的活跃文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 文档边界

当前活跃文档只保留两类：

1. 总路线图：描述产品阶段、主干运行路径、阶段边界和验收口径。
2. 当前开发面：描述仍在影响当前实现、测试和后续修改的页面、算法或契约。

历史计划、阶段规格、原始概要设计转换稿、一次性审计和已经替换的方案已归档到 `archive/deprecated/`。归档文档只作背景证据，不再作为当前实现入口或默认修改依据。

## 当前开发面

截至 2026-07-05，当前实现的主干边界如下：

1. 项目数据管理页已收敛为 Project 数据层入口：左侧显示项目列表，`projectInfo.isTemplate` 为真的项目显示【模板】；右侧只保留模板管理、数据概览和可折叠 Project JSON 原始数据。
   后端 Project JSON 原始数据边界会剥离当前 `aircraft_support_v1` 不消费的草稿/预览字段和运行配置：根 `experiment`、根 `analysisRequests`、`monteCarlo`、`seedPolicy`、`scenarioComposition`、`missionProfile.profileType`、`missionProfile.endCondition`、`missionProfile.repeatCycleHours`、`missionProfile.analysisRequests`、`deletedSupportResourceKeys` 和拼写错误的 `supportActivities[].requireDevices`。正式运行的 steps / samples / seed、固定/随机 base seed 策略、Project JSON path 覆盖记录和 Monte Carlo 数值配置归 `ExperimentPlan.config`、`RunIntent` 和 `MonteCarloRunConfig`；`requiredDevices` 是实际消费字段，不属于删除项。
2. 项目列表页从已标记的 Project 模板复制创建项目；旧的内置建模导入模板注册表、模板层级分类和模板下拉入口已退役。
3. M5 建模导入 API 仍作为后台维护、导入转换和 `compile-scenario` 能力保留；普通项目数据管理页不展示已发布模板列表、模板预览、字段映射、v1/v2 分类或旧校验级别分类。
4. 装备 RMS 指标分配是系统运行支持模块下的本地计算工作台。页面按顶部参数输入、左侧独立装备树导入、右侧方法选择和底部节点分配结果组织；输入为任务可靠度、任务时长、关键故障占比和 MTTR。
5. RMS 方法保留等分配法、比例分配法和相似产品分配法。装备树导入只更新 RMS 工作台独立数据，不污染项目建模数据；当前 UI 只保留计算动作，不提供保存草稿或发布到装备模型入口，也未接入后端持久化或真实仿真消费。
6. 可靠性框图只在任务可靠度评估模块下作为正式建模页展示。完整绘图契约仍由 `reliability-block-diagram-contract.md` 维护。
7. 正式运行主线为 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`。`src/spare_mvp_abm/contract_server.py :8521` 只是显式启用的 legacy/dev sidecar，不属于默认产品运行路径。
8. `aircraft_support_v1` 是当前正式模型族；历史 `smoke` 仅保留为非正式低层测试模型，`aviation_support` 只保留为 schema/fixture/sidecar 归档证据且 adapter 编译运行入口返回 `retired_model_family`。
9. 四个结果分析页通过 current result 面板和正式 projection payload 解锁结果；缺少 compiler provenance、`monte_carlo_base`、对应 projection artifact、payload 或 payload 类型不匹配时 fail closed。
10. 阶段 6P 仿真分析验收数据包保留在 `tests/fixtures/simulation_analysis_cases/`，用于验证最小单机和平台标准两类建模导入案例可以进入 `aircraft_support_v1` formal Monte Carlo。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`product-roadmap.md`](product-roadmap.md) | 总路线图：产品里程碑、阶段依赖、主干运行路径和验收口径。 |
| [`spare_mvp_rms_allocation_design.md`](spare_mvp_rms_allocation_design.md) | 当前 RMS 指标分配工作台的实现说明、算法口径、UI 边界和非目标。 |
| [`reliability-block-diagram-contract.md`](reliability-block-diagram-contract.md) | 当前可靠性框图绘图契约。 |
| [`archive/deprecated/README.md`](archive/deprecated/README.md) | 过期文档归档入口，包含历史计划、阶段规格、原始概要设计和运行边界审计。 |
| [`../contracts/README.md`](../contracts/README.md) | Project / Scenario / Run / Result / ArtifactManifest schema bundle 与运行契约说明。 |
| [`../front/rms-allocation-engine.mjs`](../front/rms-allocation-engine.mjs) | RMS 分配本地计算入口，覆盖风险预算分配、MTTR/MLDT 加权、自底向上校核和引擎级 target 写入 helper。 |
| [`../front/rms-allocation-workbench.mjs`](../front/rms-allocation-workbench.mjs) | RMS 分配页面渲染模块。 |
| [`../src/spare_mvp_backend/http_server.py`](../src/spare_mvp_backend/http_server.py) | 本地标准库 HTTP facade，同源服务 `/api` 与 `front/` 静态文件。 |
| [`../src/spare_mvp_backend/simulation_analysis_cases.py`](../src/spare_mvp_backend/simulation_analysis_cases.py) | 阶段 6P 仿真分析验收数据包生成器。 |
| [`../agent.md`](../agent.md) | 后续 agent 协作、验证和 subagent 使用约定。 |

## 运行与验证入口

```bash
npm test
npm run start:system
npm run start:system:with-contract-provider  # 仅在需要 legacy/dev contract provider sidecar 时使用
```

浏览器访问：

```text
http://127.0.0.1:4173/front/
```

`npm run start:system` 等价于 `bash scripts/start-system.sh start`，默认只启动同源 app/backend、使用 `runs/system-start/spare_mvp.sqlite3` 持久化，并通过正式主线 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts` 运行。`npm run start:system:with-contract-provider` 等价于 `bash scripts/start-system.sh start --with-contract-provider`，只在需要历史 contract provider 或旧 Mesa contract 调试面时额外启动 `src/spare_mvp_abm/contract_server.py :8521` legacy/dev sidecar。

## 文档维护规则

1. 新增功能或修改页面流转时，同步更新本入口、总路线图和相关当前开发面文档。
2. 阶段计划、一次性审计、历史规格或已被替换的方案不得继续放在活跃文档层；需要保留证据时移动到 `archive/deprecated/` 并在归档入口登记。
3. 对外说明使用中文；保留代码标识、命令、路径、文件名和外部项目名的原文。
4. 文档不得把静态原型、本地计算工作台或小样本仿真描述成后端持久化能力、正式仿真消费能力或工程级校准平台。
5. 删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧文案和新文案搜索 `README.md`、`docs/`、`agent.md`，同步更新当前状态文档；归档文档保留原始语境时必须位于 `archive/deprecated/`。
