# 项目文档入口

本目录是 `spare_mvp` 项目的活跃文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 文档边界

当前活跃文档只保留两类：

1. 总路线图：描述产品阶段、主干运行路径、阶段边界和验收口径。
2. 当前开发面：描述仍在影响当前实现、测试和后续修改的页面、算法或契约。

历史计划、阶段规格、原始概要设计转换稿、一次性审计和已经替换的方案已归档到 `archive/deprecated/`。归档文档只作背景证据，不再作为当前实现入口或默认修改依据。

## 当前开发面

截至 2026-07-08，当前实现的主干边界如下：

1. 项目数据管理页已收敛为 Project 数据层入口：左侧显示项目列表，`projectInfo.isTemplate` 为真的项目显示【模板】；右侧只保留模板管理和数据概览，不展示 Project JSON 原始数据。经校验的 JSON 文件选择、覆盖预览、确认覆盖、并发版本冲突和审计能力继续保留。
   后端 Project 持久化边界会剥离当前 `aircraft_support_v1` 不消费的草稿/预览字段和运行配置：根 `experiment`、根 `analysisRequests`、`monteCarlo`、`seedPolicy`、`scenarioComposition`、`missionProfile.profileType`、`missionProfile.endCondition`、`missionProfile.repeatCycleHours`、`missionProfile.analysisRequests`、`supportResourceOverrides`、`deletedSupportResourceKeys`、拼写错误的 `supportActivities[].requireDevices` 以及保障活动/作业项内的 MTTR 草稿字段。基本保障活动定义持久化在顶层 `supportActivityJobs[]`，`supportActivities[]` 只保存 `activityCodes[]` 引用和方案内 `predecessors` DAG；修复性维修 MTTR 以装备系统建模 `components[].repairDistribution` 为来源。lite Mesa 会话的 samples / seed、固定/随机 base seed 策略、Project JSON path 覆盖记录和 Monte Carlo 数值配置归 `ExperimentPlan.config` 与页面设置；`requiredDevices` 是实际消费字段，不属于删除项。
2. 项目列表页从已标记的 Project 模板复制创建项目；旧的内置建模导入模板注册表、模板层级分类和模板下拉入口已退役。
3. M5 建模导入 API 仍作为后台维护、导入转换和 `compile-scenario` 能力保留；普通项目数据管理页不展示已发布模板列表、模板预览、字段映射、v1/v2 分类或旧校验级别分类。
4. 装备 RMS 指标分配是系统运行支持模块下的本地份额分配工作台。页面先在“机型选择与数据准备”区块集中展示飞机型号选择、下载模板和上传文件；当前机型的装备结构树与选中子树表格仅承载结构浏览和安装数编辑，不混放数据准备按钮。
5. RMS 页面在同一“RMS 输入与指标分配计算”面板内维护任务可靠度、任务时长、整机 MTBF 和 MTTR；等分配法、比例分配法和相似产品分配法先确定节点权重，再统一换算失效率、MTBF 和 MTTR。节点结果与真实 XLSX 均展示层级、节点、运行比、失效率、MTBF、MTTR 六列。导入只更新 RMS 工作台独立数据，不污染项目建模数据；当前契约不包含目标 R、可靠度校核、MTBCF 或 MTTR 裕度，也不提供保存草稿或发布入口。装备系统建模页的模板下载、当前机型导出和文件上传集中在左侧装备结构树面板，右侧只展示建模详情。
6. 可靠性框图只在任务可靠度评估模块下作为正式建模页展示，并作为 `reliabilityBlockDiagram` 建模输入保留在 clean Project。完整绘图与分析契约由 `reliability-block-diagram-contract.md` 维护。
7. 当前用户可见分析主线为 `当前 Project 或已保存 ExperimentPlan -> POST /api/mesa-analysis-runs -> aircraft_support_v1 simulation inputs -> in-memory AircraftSupportV1Model -> lite Mesa 会话摘要`；Monte Carlo 和结果分析页继续保留该 Project/plan 数据边界。方案编辑器中的 `experimentPlanDraft` 只是内存分支，保存后才创建或更新 ExperimentPlan。可视化推演页单独收敛为“实验方案”选择：下拉只列当前 Project 已保存且具有稳定 `experiment_plan_id` 的 ExperimentPlan，不提供“当前项目”或未保存草稿回退；没有方案、尚未选择或已选方案失效时不加载 Solara iframe，也不发出 Project 保存请求，并提供实验方案管理入口。旧 `/api/runs`、RunService、SimulationRun、ResultSummary 和 ArtifactManifest 运行账本路径保留为历史实现、内部治理能力或后续持久化运行治理候选；旧 contract provider、`independent-mesa` sidecar、smoke model、smoke scenarios 和 smoke JSON fixtures 已退役删除。
   选择保存方案进行可视化时，页面自动同步该 ExperimentPlan 的分支 Project JSON，成功后将 `experiment_plan_id` 与经边界校验的 `steps/samples/seed` 通过 iframe 方案上下文传给 Solara sidecar，并以 `runtime_config` 进入 Scenario 编译；父页不再提供“刷新推演”，运行控制位于 Solara 内容区顶部，Solara 也不再重复渲染默认页面标题。任务时间线、提示、详情、状态与日志仅显示任务名称和天/波次/机型等业务上下文，缺名显示“未命名任务”，内部任务/波次实例/保障作业 ID 只用于数据关联和调试。同步过程不把运行配置写回 clean Project。重名方案始终以 `experiment_plan_id` 区分，页面刷新可恢复仍有效的选择，删除或失效后必须清空选择。
8. `aircraft_support_v1` 是当前正式模型族；历史 `aviation_support` 已从活动 schema、mapping 和 fixtures 删除，adapter 编译运行入口继续返回 `retired_model_family`。
9. “飞机任务可靠性评估”是独立的确定性结构可靠性页面，位于“任务可靠度评估”之前。它按飞机型号和任务剖面读取任务时长、可靠性框图及产品参数；输入变化后必须由用户点击“运行分析”才重新计算，结果只保留整机级汇总并可导出 XLSX，不复用 `mission_reliability` Mesa 样本成功率。该页与其余四个结果分析页统一使用后端 openpyxl 导出，不再保留浏览器内自建 ZIP/XLSX 实现。
10. 其余四个结果分析页当前为独立轻量 Mesa 会话页：前端提交当前 Project 与页面设置到 `POST /api/mesa-analysis-runs`，后端编译为 `aircraft_support_v1` simulation inputs 后只在内存中运行样本并返回页面摘要；该路径不创建 `/api/runs`、SQLite run、Result 或正式 artifact，也不读取 current result 面板。每个样本默认以独立进程执行并有 60 秒硬上限，整批预算按 `ceil(samples / worker_count)` 个波次计算、限制在 180 到 900 秒；前端按相同口径等待并增加 30 秒响应余量，不能把预算内的正常长任务误报为网络失败。响应必须带请求/完成/失败样本数、逐样本状态与耗时、以及编译/样本执行/聚合/投影总耗时；全部超时、部分失败和完成状态均应给出可操作提示。备件短板分析、飞机转场携行清单分析、飞机任务可靠性评估、任务可靠度评估和停机因素分析五个页面均在“分析设定”之前显示包含页面标题和运行上下文的标题横幅；四个轻量 Mesa 页面保留显式“运行分析”入口、运行状态、样本量和随机种子，停机因素页保留排序范围。五页只在已有完成结果时启用“导出 Excel”，将当前筛选/排序后的可见快照提交到 `POST /api/analysis-results/export-xlsx`，生成“分析信息 / 结果摘要 / 结果明细”三 sheet 的真实 OOXML；项目/实验方案身份在结果生成时绑定，旧飞机可靠性快照没有可信方案来源时按项目历史记录导出，不借用当前下拉方案身份。导出不重跑分析，任务可靠度复用 `result_fields` 的四字段和 half-even 显示值，停机事件复用 `downtimeEventDisplayRow` 的中文与 `DAY_n HH:MM`。界面不显示“样本量 / 随机种子只读”提示。
11. 轻量 Mesa 指标口径：`出动架次率 = 起飞总架次 / 飞机总数 / 仿真总天数`，展示为小数；`仿真总天数` 来自编译后的仿真窗口，周期任务有显式星期排程时按最后有任务日停止，没有显式任务日时才回退整周期/重复次数或 `durationHours`；`整周期任务可靠度 = 全部计划任务均已评估且成功的实验数 / 已执行实验总数`，未评估或失败的任一计划任务都会使该次实验判为整周期失败，周期支持天、周、月等由 Project 实际配置形成的任意长度；`战备完好率 = 每天 14:00 的可用飞机数量 / 总飞机数量`，多天结果取日采样均值；`平均备件延误时间(h) = 总调运延误时间(分钟) / 60 / 备件调运次数`，用于备件短板页替代原先会被误读为缺件次数的分钟累计值。备件短板明细按“机型 + 备件类别”聚合，需求/满足/缺件数量来自对应事件数量，并允许直接从需求数量或满足率列头选择升序、降序；携行清单可从建议携行数量列头排序，有寿件说明放在列头悬浮提示中。
12. 阶段 6P 仿真分析验收数据包保留在 `tests/fixtures/simulation_analysis_cases/canonical_platform_case.json`，用于验证平台标准建模导入案例可以通过 validation 并编译为 `aircraft_support_v1` Scenario；不再要求 6P canonical 生成正式分析产物。
13. 任务字段按单一归属保存：`basicMissions[].minRequiredSorties` 是最小装备数量唯一来源，复合任务项只读继承；`compositeTasks[].priority` 是任务优先级唯一来源。基本任务与复合任务项中的旧 `priority`、以及 task item 的旧 `minRequiredSystems` 都只在迁移时读取后删除。修改该边界时必须同步更新 contract、后台 Project 迁移、canonical/M9.6/clean Project 导出 JSON，并运行两条 fixture drift check；已发布 import 和历史 run/snapshot 不得原地覆盖，应发布新版本后创建新 Project。
14. 周期性任务的月、年剖面组合保存在 `missionProfile.periodicProfileLists`。月剖面的 4 个固定周坑位和可选第 5 周、年剖面的 12 个月均允许以空字符串表示“未配置”，新建时默认全空；保存、重新打开、删除被引用剖面和汇总时不得静默回退为首个周/月剖面。月汇总只统计非空周引用，年汇总只统计非空月引用及其非空周引用；仿真编译仍由 `periodicTasks[]` 周级计划驱动并忽略这些空槽。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`product-roadmap.md`](product-roadmap.md) | 总路线图：产品里程碑、阶段依赖、主干运行路径和验收口径。 |
| [`spare_mvp_rms_allocation_design.md`](spare_mvp_rms_allocation_design.md) | 当前 RMS 指标分配工作台的实现说明、算法口径、UI 边界和非目标。 |
| [`reliability-block-diagram-contract.md`](reliability-block-diagram-contract.md) | 当前可靠性框图绘图契约。 |
| [`lite-mesa-formal-runtime.md`](lite-mesa-formal-runtime.md) | lite Mesa 作为当前用户可见运行路径的边界说明。 |
| [`archive/deprecated/README.md`](archive/deprecated/README.md) | 过期文档归档入口，包含历史计划、阶段规格、原始概要设计和运行边界审计。 |
| [`../contracts/README.md`](../contracts/README.md) | Project / Scenario / Run / Result / ArtifactManifest schema bundle 与运行契约说明。 |
| [`../front/rms-allocation-engine.mjs`](../front/rms-allocation-engine.mjs) | RMS 分配本地计算入口，按规则归一化节点权重并换算失效率、MTBF 和 MTTR。 |
| [`../front/rms-allocation-workbench.mjs`](../front/rms-allocation-workbench.mjs) | RMS 分配页面渲染模块。 |
| [`../src/spare_mvp_backend/http_server.py`](../src/spare_mvp_backend/http_server.py) | 本地标准库 HTTP facade，同源服务 `/api` 与 `front/` 静态文件。 |
| [`../src/spare_mvp_backend/simulation_analysis_cases.py`](../src/spare_mvp_backend/simulation_analysis_cases.py) | 阶段 6P 仿真分析验收数据包生成器。 |
| [`../agent.md`](../agent.md) | 后续 agent 协作、验证和 subagent 使用约定。 |

## 运行与验证入口

```bash
npm test
npm run start:system
```

浏览器访问：

```text
http://127.0.0.1:4173/front/
```

`npm run start:system` 等价于 `bash scripts/start-system.sh start`，默认启动同源 app/backend、SQLite 和平台管理的 Solara 可视化 sidecar（默认 `http://127.0.0.1:8765/`）。当前用户可见分析通过 `/api/mesa-analysis-runs` 运行 lite Mesa 会话；可视化推演页嵌入 Solara iframe；旧 `/api/runs` 账本链路仅作为历史实现、内部治理能力或后续持久化运行治理候选。

## 文档维护规则

1. 新增功能或修改页面流转时，同步更新本入口、总路线图和相关当前开发面文档。
2. 阶段计划、一次性审计、历史规格或已被替换的方案不得继续放在活跃文档层；需要保留证据时移动到 `archive/deprecated/` 并在归档入口登记。
3. 对外说明使用中文；保留代码标识、命令、路径、文件名和外部项目名的原文。
4. 文档不得把静态原型、本地计算工作台或小样本仿真描述成后端持久化能力、正式仿真消费能力或工程级校准平台。
5. 删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧文案和新文案搜索 `README.md`、`docs/`、`agent.md`，同步更新当前状态文档；归档文档保留原始语境时必须位于 `archive/deprecated/`。
