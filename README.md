# 备件规划与任务可靠度验证评估平台原型

本仓库当前是基于已归档的原始概要设计重构出的备件规划与任务可靠度验证评估原型。当前开发分支已经包含登录、项目列表着陆页、四级功能导航、Mesa 可视化嵌入、蒙特卡洛扫参与结果分析页、以及 ship_front / 备件_front 对齐页面；早期 Ontology + Mesa 重构和 Simulation-Contract-First 治理文档已归档为历史材料，当前产品、运行时代码和测试门不再保留 ontology 需求。

## 项目文档入口

统一文档入口见 [`docs/README.md`](docs/README.md)。常用文档：

- [`docs/product-roadmap.md`](docs/product-roadmap.md)：从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。
- [`docs/spare_mvp_rms_allocation_design.md`](docs/spare_mvp_rms_allocation_design.md)：装备 RMS 指标分配当前实现、算法口径和非目标。
- [`docs/reliability-block-diagram-contract.md`](docs/reliability-block-diagram-contract.md)：可靠性框图当前绘图契约。
- [`docs/archive/deprecated/README.md`](docs/archive/deprecated/README.md)：已过期历史文档归档入口。
- [`agent.md`](agent.md)：后续 agent 协作规则和 subagent 使用约定。

## 已覆盖范围

- 前端建模：任务剖面参数、复合任务、周期性任务、基本任务、任务阶段、装备、组件、保障节点、保障活动字段；装备任务建模已收敛为基本任务删除返回时间比并新增提前通知时间、任务阶段并入信息编辑，复合任务时序按出动时刻排序并连续重排波次，周期性任务支持上级任务和周次/周内日配置，基本作战单元使用大修周期语义；装备系统建模按选中飞机/系统节点展示组件行，MTBF/MTTR 先选择分布类型再显示关联参数输入，MTBF 默认指数分布，MTTR 默认固定值，分布类型限定为固定值、指数分布、正态分布和均匀分布。
- 可靠性框图：仅在任务可靠度评估模块下作为正式建模页展示，左侧复用装备树；选中“飞机列表”根节点时右侧不显示框图，选中整机或组件时右侧只展示全部直接下一级 RBD 节点且不展示当前选中根节点，`n中取k` 节点以外层并联框展示，并在框内展开 N 个同名分支节点，门逻辑节点保持独立展示；完整绘图契约见 `docs/reliability-block-diagram-contract.md`。
- 保障组织与活动建模：保障组织支持递归树节点；备件记录所属装备，保障人员专业使用下拉字典兼容回退且不再维护所属型号，备件、人员和设备资源表不再依赖行级编辑按钮；基本保障活动通过编辑面板维护活动编号、工作名称、适用飞机、作业时长分布、人员、设备和备件需求；使用保障、预防性维修、修复性维修和后勤保障的工作项目从基本保障活动库选择/搜索并自动回填，紧前作业通过显式编辑入口维护。
- 可视化仿真：导航入口直接进入 Mesa 页面并读取当前 Project 启动独立 Mesa 仿真，不再经过可视化启动/回放列表页；旧 `visual-start-stop`、`scenario-switch`、`visual-results` hash 兼容到该 Mesa 页面。页面展示单次仿真的飞机、任务、保障态势、指标和事件流；M9.8 后平台入口默认使用 `aircraft_support_v1` 通过 canonical `/api/runs` 提交正式 run，并从 `visualization_state_series` artifact 或 `/api/runs/{run_id}/state-stream` 展示状态。任务视图把任务计划表和每日甘特图合并为同一工作区，按周期性任务 / 复合任务 / 基本任务组织，直接展示实际天、波次、要求型号、数量、实际执行飞机和状态；缺少这些正式任务计划字段的旧 artifact 不再由前端从 id/name/aircraft_type 兜底推断。Mesa 内部 `Ontology视图`、Ontology Playground 导出和项目级本体校验已从当前产品范围删除。
- 蒙特卡洛实验：导航入口直接进入嵌入的 Mesa 蒙特卡洛分析页，读取当前 Project JSON、样本量和随机种子并在页面内展示统计结果；旧 `monte-carlo-config`、列表和编辑 hash 兼容到该详情页。
- 仿真实验方案流程：M6.1.1 已让单次 run 优先从 ExperimentPlan 分支 Project JSON 编译 Scenario；M6.2 已让正式运行收敛到 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`，正式 Monte Carlo 通过 `run_type: "monte_carlo"` 基于已编译 Scenario 生成 `monte_carlo_base` artifact 和四类 `analysis_projection_*` artifact。旧 `smoke` 模型、contract provider、smoke scenarios 和 smoke JSON fixtures 已退役删除；`aviation_support` 仅保留历史 schema/fixture 证据且 adapter 入口返回 `retired_model_family` 并指向 `aircraft_support_v1`。M9.7.1 已新增 `aircraft_support_v1` schema/compiler gate；M9.7.2 已新增可合并的真实 single-run core；M9.7.3 已解锁 `aircraft_support_v1` formal Monte Carlo；M9.7.4 已完成 coverage hardening 收口。M9.8 已完成平台嵌入：前端 RunIntent 默认使用 `aircraft_support_v1`，可视化仿真、Monte Carlo 和四类分析页只把 canonical `/api/runs` 产物作为正式结果来源。`AircraftSupportV1Model` 通过 canonical `/api/runs` 产出 result、metrics、report、log、run chain、四类 projection、`monte_carlo_base`、代表样本 `visualization_state_series` 和失败样本账本；行为驱动字段覆盖机队数量/初始可用、任务波次、`components[].failureDistribution`、组件寿命/RMS/k-out-of-n、`reliabilityBlockDiagram`、保障资源容量、库存、`supportNodes[].transportPolicies`、保障活动 job DAG、周期任务、任务阶段/机场/任务区、Monte Carlo sweep 与 seed。`aircraft_support_v1` 仿真时长优先由周期任务的配置天数乘重复次数推导，`durationHours` 只在缺少周期任务时作为回退输入。`components[].failureDistribution` 是 behavior-driving 故障分布输入，`supportNodes[].transportPolicies` 是 behavior-driving 补给转运输入。`supportOrganization` 当前批准为 governance-only / 不驱动仿真字段，进入 provenance 而不再阻断 M9.6 冻结案例。未配置、缺少 compiler provenance 或缺少正式 projection/state-series artifact 的分析页只能显示“本地预览，不是正式后端仿真结果”。
- RMS 指标分配：系统运行支持模块的“装备RMS指标分配”本地计算页已按当前阶段收敛为顶部参数输入、左侧独立装备树导入、右侧方法选择和底部节点分配结果；输入聚焦任务可靠度、任务时长、关键故障占比和 MTTR，装备树先选择装备再显示当前装备树；方法保留等分配、比例分配、相似产品分配，并按方法展示参数，相似产品分配法的基准机型来自装备列表下拉。当前页面只保留计算动作，暂不提供保存草稿或发布到装备模型入口，尚未后端持久化或真实仿真消费。
- 结果分析：备件短板分析、飞机转场携行清单、任务可靠度评估、停机因素分析；每个分析页先进入分析任务列表，支持选择方案和参数后自动创建新的 Monte Carlo 实验并绑定分析任务。独立的 Monte Carlo 结果页已移除，正式 Monte Carlo 结果承载在“蒙特卡洛实验 / 实验详情”的结果区。M8.0 阶段只有绑定的 `mc_experiment_id`、`run_type: "monte_carlo"`、compiler provenance、`monte_carlo_base`、对应 `analysis_projection_*` 和已成功解析的 projection payload 同时存在时才解锁正式结果；正式态 KPI、表格和图形来自 downloaded projection payload，否则显示未配置、待运行、运行中、运行失败或本地预览边界。
- M2a/M9.7.4 契约适配：`src/spare_mvp_contract/adapter.py` 当前正式编译和运行入口只接受 `aircraft_support_v1`；旧 `smoke` 编译/运行实现和 JSON fixtures 已删除，`aviation_support` 仅保留历史 schema/fixture 证据且 adapter 入口返回 `retired_model_family` 并指向 `aircraft_support_v1`。正式 `/api/runs`、`BackendApi.start_simulation_run()`、前端 `startSimulationRun()` / `startMonteCarloRun()` 和 modeling import `compile-scenario` 入口只接受 `aircraft_support_v1`。M9.7.1 新增 `aircraft_support_v1` 编译 gate、`contracts/aircraft_support_v1_input.schema.json`、Scenario/run schema selector 和 mapping metadata。M9.7.2 新增 `src/spare_mvp_abm/aircraft_support_v1/` single-run core；M9.7.3 让 `SimulationAdapter.run_monte_carlo_scenario()` 支持 `aircraft_support_v1` formal Monte Carlo；M9.7.4 关闭 M9.6 frozen 字段的 unsupported 债务，report/log 统一声明 `m9_7_4_behavior_scope`，sampling contract 不再暴露 M9.7.4 pending 字段。`supportOrganization` 作为 governance-only 字段进入 mapping provenance，不驱动仿真且不再阻断正式 run。
- PR-D 数据持久化：`src/spare_mvp_backend/schema.sql` 和 repository helper 已提供 SQLite 版 Project / Scenario / Run / Result / ArtifactManifest 持久化与 `run_id` 身份链查询。
- PR-E 后端 API：`src/spare_mvp_backend/api.py` 提供函数级 Backend API facade，按 Project -> Snapshot -> ExperimentPlan -> Adapter 编译 Scenario -> Mesa 运行 -> Result/Artifact 持久化编排；API 层不自行拼接 Scenario JSON，不改写 Mesa 指标。
- PR-F 前端接入：`front/api-client.mjs` 提供前端 API client，`front/app.js` 的项目保存、实验计划创建、仿真启动、结果摘要和产物读取通过 API client 编排；静态演示结果也封装在 client 内，避免 app 直接生成最终 Scenario 或直接运行本地仿真函数。
- M3-0 真实后端闭环：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py` 和 `tests/e2e-contract-flow.test.mjs` 已迁移到同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest current flow；历史收束证据见 [`reports/m3-0-real-backend-loop/README.md`](reports/m3-0-real-backend-loop/README.md)。该闭环仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不代表生产 Web API、worker 或 calibration quality。
- M3-1 浏览器后端闭环：[`reports/m3-1-browser-backend-smoke/README.md`](reports/m3-1-browser-backend-smoke/README.md) 是历史浏览器验收报告；当前运行和测试入口只接受 canonical `/api/runs` + `aircraft_support_v1`，`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
- M4 权限审计 backfill：`users`、`sessions`、`project_access` 和 `audit_events` 已纳入 SQLite schema；`/api/auth/login` 建立本地 M4 会话，`front/api-client.mjs` 会对受保护请求附加 bearer token。建模导入的 save/publish/compile-scenario HTTP 路径要求真实会话，普通用户发布会被后端 `403` 阻断并写入审计；函数级 `BackendApi` 仍保留无 actor 的内部 contract 测试入口。
- M5 数据入口：`contracts/modeling_import.schema.json`、`front/modeling-import-contract.mjs` 和 `tests/modeling-import-contract.test.mjs` 定义建模数据导入/校验 contract；M5.1 已通过本地 `/api/modeling-imports/*`、`BackendApi` 和 SQLite repository 服务化 validation/save/publish/get，覆盖对象 ID、引用关系、非法数值、错误定位和已发布且被运行引用后的覆盖保护。`modeling_imports` 持久化 `draft_payload_json` 与 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照。同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。建模导入范围只通过 `usedTables` 声明，旧校验级别分类不再作为数据契约。当前项目数据管理页已从 sheet 数据源配置收敛为 Project 数据层入口：左侧显示项目列表，`projectInfo.isTemplate` 为真的项目显示【模板】；右侧只保留模板管理（设为模板 / 取消设为模板）、数据概览（任务、装备、保障系统、保障活动）和可折叠 Project JSON 原始数据。后端 Project 原始数据会剥离当前 `aircraft_support_v1` 不消费的草稿/预览字段、运行配置和拼写错误字段，例如根 `experiment`、根 `analysisRequests`、`monteCarlo`、`missionProfile.profileType/endCondition/repeatCycleHours`、`missionProfile.analysisRequests`、`deletedSupportResourceKeys` 和 `supportActivities[].requireDevices`；正式运行的 steps / samples / seed 与 Monte Carlo 数值配置由 `ExperimentPlan.config`、`RunIntent` 和 `MonteCarloRunConfig` 承载。项目列表页从这些已标记 Project 模板复制创建项目；旧的内置建模导入模板注册表和下拉选择器已退役。M5 建模导入 API 仍作为后台维护、导入转换和 compile-scenario 能力保留，但普通项目数据管理页不再展示已发布模板列表、模板预览、字段映射或 v1/v2 分类；局部导入入口只保留文件导入、当前项目回灌、内嵌样例恢复、校验、保存、发布和编译维护动作。完整 Excel 解析和 worker 基础设施仍不在 M5 切片内。
- 页面建议收口：`reports/2026-06-19-page-revision-suggestions/README.md` 是页面修复输入；当前项目数据管理入口已改为项目列表、模板管理、数据概览和 Project JSON 原始数据。本收口先修项目列表、系统管理、装备/任务/保障建模的死按钮、字段口径和选择/批量操作问题，为 M6.1.1 单次仿真输入对齐降低数据错配风险，但不直接实现 M6.1.1 或 M6.2。
- M6.0 运行服务边界：`src/spare_mvp_backend/run_service.py` 已承接 run request 校验、ExperimentPlan 绑定 ModelingSnapshot 解析、同步执行、status envelope 和结果/产物持久化；HTTP 暴露 canonical `/api/runs`，前端通过 `submitRun()`、`getRunStatus()`、result/artifacts/chain 刷新结果；旧 `/api/simulation-runs*` 已退役并返回 `410 legacy_run_api_retired`。RunService 在当前进程内串行化 run id 生成，并能返回 failed status envelope。该切片仍不是完整 worker 队列、取消、重试、真实批量 Monte Carlo fan-out 或对象存储。
- M6.1/M9.4 输入一致性收束：当前正式入口只编译并运行 `aircraft_support_v1`。旧 `smoke` 模型族已从 schema、adapter 执行路径和 fixtures 删除；`aviation_support` 仅作为历史 schema/fixture 保留并在 adapter 入口返回 `retired_model_family`。未知模型族仍通过 compile gate fail closed；四个结果分析 dashboard 在缺少 compiler provenance 或官方 analysis artifact 时只显示本地预览边界。
- M6.1.1 单次仿真输入对齐：ExperimentPlan config 现在持久化清理后的分支 `projectJson`，RunService 编译当前正式单次 run 时优先使用该分支 Project JSON，并从 ExperimentPlan runtime config 注入 steps / samples / seed，把 `experiment_plan_id`、`modeling_snapshot_id` 写入 mapping provenance；当前正式模型族为 `aircraft_support_v1`。修改分支组件故障率或保障容量会进入后端 compiled Scenario 和 run artifact，修改 seed 会进入 runtime config 而不是 Project。旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。
- M6.2 当前收束：`RunService` 已接受正式 `run_type: "monte_carlo"`，同步本地执行器会基于已对齐 Scenario 运行样本、生成 `monte_carlo_base` 和四类 `analysis_projection_*` artifact，并在 run status 中返回 `SimulationExperimentBase` / `mc_experiment_id`。RunIntent / MonteCarloRunConfig / imported sample Project 后续收敛切片的当前口径是：正式 run 由前端 `RunIntent` 保存 Project、创建 Snapshot/ExperimentPlan 后提交 `/api/runs`；正式 MC 数值配置只从 `ExperimentPlan.config.analysisRequests.largeSample -> MonteCarloRunConfig` 解释；功能测试路径应从已保存的 Project JSON 出发，项目数据管理页只负责项目选择、模板标记、数据概览和 JSON 查看。`/api/runs` 会由 HTTP 层标记为 `formal_run`，RunService 要求 Project JSON 的 `missionProfile.sourceImportId` 指向已发布 modeling import、`projectId` 匹配，并且后端审计日志存在同一 import/project 的 `modeling_import.create_project` allowed 记录；手工伪造 `sourceImportId` 不能通过 gate。页面内置静态项目只能作为本地预览或 fixture；对该 preview fixture 发起正式 single/Monte Carlo run 时应 fail closed，不得把静态 seed 当作正式输入；正式和预览测试运行提交、查询、结果、产物和身份链都只走 canonical `/api/runs` 路径，且正式模型族必须是 `aircraft_support_v1`。生产 worker queue、object storage、完整取消/重试、checkpoint restart 和长期 artifact storage 仍非当前本地同步边界目标。
- M6.2.x 输入源治理已收束：前台建模和正式 run 功能测试的业务示例源已收敛到 `tests/fixtures/modeling_import_project.json`；缺少 imported JSON 数据时页面显示空态或创建入口，不再从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例。该切片只关闭输入源治理；在线订阅能力由 M9.2 提供。
- M6.2.y 运行 API 退场收束：legacy `/api/simulation-runs` 已从正式和预览测试路径退役；前端 API client、HTTP contract tests 和浏览器 smoke 只使用 canonical `/api/runs` 及其 status/result/artifacts/chain 路径。旧路径返回 `410 legacy_run_api_retired`，用于让外部调用者明确迁移到 `/api/runs`。该切片只清理 run API 兼容层；生产 worker queue、object storage 和取消/重试仍是后续运行基础设施。
- M7.0 运行与产物管理：canonical `/api/runs` 已扩展为运行列表、运行详情、artifact id 下载、归档和软删除管理边界，前端在 Monte Carlo 详情中展示 run/artifact 账本字段与生命周期状态。该切片只管理本地运行账本、产物账本、下载、归档和软删除，不恢复 legacy `/api/simulation-runs`；生产 worker queue、object storage、取消/重试完整体系仍非本阶段目标。
- M8.0/M9.7.3 projection payload 结果分析：四个结果分析页现在通过 `run_id + artifact_id` 下载并解析对应 `analysis_projection_*` JSON payload，正式态 KPI、表格和图形由 payload adapter 驱动；历史 `aviation_support` projection artifact 仍可作为归档回归证据，当前正式结果只接受 `aircraft_support_v1` 产出的 `monte_carlo_base` 和四类 projection payload。payload 缺失、类型不匹配或解析失败时 fail closed，继续显示本地预览或阻断边界。该切片不包含完整报告导出、异常样本钻取、生产 worker queue、object storage 或取消/重试完整体系。
- M9.0/M9.1/M9.7.3 状态序列回放与追溯：当前 formal run 入口只允许 `aircraft_support_v1` single/formal Monte Carlo 写出新的状态序列。payload 以 `run_id + artifact_id` 定位并包含逐帧时间步、飞机/任务/资源状态、事件摘要、事件 id、指标引用和 run/result/manifest/compiled Scenario 追溯字段。`aircraft_support_v1` 的任务帧会携带周期任务、复合任务、基本任务、实际天、波次、要求机型/数量、时长和实际执行飞机字段，供任务计划甘特视图直接消费；缺少这些字段时任务计划视图 fail closed，不从旧 artifact 的 id/name/aircraft_type 推断。Mesa 可视化页可按 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载、校验、本地播放/暂停/单步/重置/拖动时间轴，并展示可点击定位的事件流；缺少 artifact、payload 类型不匹配或解析失败时保持 fail closed，演示快照只作为本地预览。
- M9.2 在线状态流和运行订阅已形成最小闭环：HTTP 暴露 run-scoped SSE `GET /api/runs/{run_id}/state-stream`，当前同步执行器从已持久化 `visualization_state_series` payload 输出 `run_status`、`state_frame` 和 `artifact_ready`；在线 `state_frame` 复用离线帧 schema，最终 `artifact_ready` 事件切回 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 离线回放解析路径。前端 Mesa 可视化页支持订阅运行、断线/重连提示、未授权和失败状态提示；在线帧只用于展示当前流状态，不解锁播放/单步/重置控制。
- M9.3 Run lifecycle / control plane 已形成最小闭环：HTTP 暴露 `POST /api/runs/{run_id}/control`，后端确认 `cancel` 和 `retry` 后才更新正式 run 状态并写入 `runs.control.*` 审计；`retry` 会阻断旧 result/artifact 正式读取，并在 run detail 中展示 pending 空 artifact manifest。`pause`、`resume`、`step`、`reset` 仍 fail closed，前端 Mesa 控制区只展示后端确认状态或不可用原因，不用本地回放索引、demo frame 或计时器伪造后端控制。M9.4/M9.5 的 `aviation_support` 正式执行记录已归档，当前 lifecycle/control 的正式新 run 入口只接受 `aircraft_support_v1`；生产 worker queue、真实运行中增量推送、object storage、完整 cancel/retry 基础设施和 checkpoint restart 只在后续阶段最小需要时纳入。
- M9.6 已冻结平台案例数据包、字段覆盖表和 golden fixtures：`tests/fixtures/modeling_import_project.json` 仍是唯一完整业务案例源，`tests/fixtures/m9_6_platform_case_export.json` 固化 published modeling import -> clean Project -> ModelingSnapshot -> ExperimentPlan runtime config -> RunIntent -> MonteCarloRunConfig -> compiled `aircraft_support_v1` Scenario 链路，`tests/fixtures/m9_6_field_coverage.json` 逐字段标注 consumed/derived/defaulted/governance_only/ignored/unsupported，且 M9.7.4 后 M9.6 已冻结业务字段的 unsupported 汇总为 0；`tests/fixtures/m9_6_expected_artifact_kinds.json` 固定 single 与 Monte Carlo artifact kind 口径。M9.8 已完成平台嵌入和 `independent-mesa` 退役：`independent-mesa/GLM` 与 `independent-mesa/GPT` 源码树已从当前仓库移除，不再保留旁路服务、静态 HTML 或离线复现实验入口；历史设计记录只保留在 `docs/archive/deprecated/superpowers/` 的归档计划和规格中。
- 阶段 6P 仿真分析验收数据包已收束：`tests/fixtures/case_new.json` 是从前端导出恢复的测试案例基础数据，`tests/fixtures/simulation_analysis_cases/` 只固定 `canonical_platform_case` 这一类 modeling-import-v1 案例；`src/spare_mvp_backend/simulation_analysis_cases.py` 与 `scripts/export-simulation-analysis-cases.py --write|--check` 负责生成和漂移检查；`tests/test_simulation_analysis_cases.py` 验证该数据可进入 `aircraft_support_v1` formal Monte Carlo，并产出 `monte_carlo_base`、`visualization_state_series` 和四类 `analysis_projection_*` artifact。旧的 minimal single-aircraft / frontend project smoke schema 文件已退役。6P 是分析功能前置数据基线，不是生产性能压测。

## 本地运行

当前正式运行主线是 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`。旧 contract provider、smoke model、smoke scenarios 和 smoke JSON fixtures 已退役删除；`scripts/start-system.sh` 只启动同源 app/backend 和 SQLite。

首次克隆仓库后，先创建仓库本地 Python 环境 `.abm-mesa-test-env`。该目录只用于本机运行和测试，不提交到 Git。

```bash
python3.12 -m venv .abm-mesa-test-env
.abm-mesa-test-env/bin/python -m pip install -U pip
.abm-mesa-test-env/bin/python -m pip install -e .
```

当前依赖要求 Python 3.12+；团队验证默认以 Python 3.12 为准。

```bash
npm test
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/front/index.html
```

需要验证同源前端和 canonical `/api/runs` 后端闭环时，使用 `.abm-mesa-test-env` 启动本地系统：

```bash
npm run start:system
```

打开：

```text
http://127.0.0.1:4173/front/
```

### 数据库备份与恢复

本地系统默认 SQLite 数据库位于 `runs/system-start/spare_mvp.sqlite3`，备份文件默认写入 `runs/database-backups/`。`runs/` 是本机运行产物目录，不作为 Git 管理的发布资产；需要保留运行数据时应使用脚本生成备份文件。

备份当前默认数据库：

```bash
scripts/backup-database.sh
```

可按需给备份文件加标签，生成的文件名会包含时间戳和标签：

```bash
scripts/backup-database.sh --label before-import
```

如果需要备份非默认数据库或写入指定目录：

```bash
scripts/backup-database.sh \
  --database runs/system-start/spare_mvp.sqlite3 \
  --backup-dir runs/database-backups \
  --label before-import
```

恢复前先停止本地系统，避免正在运行的 HTTP server 继续持有旧 SQLite 连接或写入 WAL 文件：

```bash
npm run stop:system
scripts/restore-database.sh --force runs/database-backups/spare_mvp-YYYYmmdd-HHMMSS-before-import.sqlite3
```

恢复脚本默认拒绝覆盖已有数据库；确认要覆盖时必须显式传入 `--force`。如需恢复到非默认数据库路径，可使用：

```bash
scripts/restore-database.sh \
  --database runs/system-start/spare_mvp.sqlite3 \
  --force \
  runs/database-backups/spare_mvp-YYYYmmdd-HHMMSS-before-import.sqlite3
```

## 仿真运行验证

需要先按“本地运行”创建 `.abm-mesa-test-env`。本机验证使用 Python 3.12；仓库依赖由 `pyproject.toml` 管理，当前包含 `mesa==3.5.1` 和 `jsonschema==4.26.0`。

当前可执行仿真入口是 `aircraft_support_v1`，6P 分析验收数据只保留 `tests/fixtures/simulation_analysis_cases/canonical_platform_case.json`：

```bash
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_simulation_analysis_cases -v
python3 scripts/export-simulation-analysis-cases.py --check
```

`runs/` 下的原始 JSON 输出默认不提交；正式可复现输入由 contract fixtures 和 6P canonical case 维护。

## 边界

该原型是可交互、可运行的第一版，不是校准后的工程级仿真平台。小样本结果只能解释“在当前规则和参数下的模型行为”，不能直接声称真实最优方案。
