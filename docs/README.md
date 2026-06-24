# 项目文档入口

本目录是 `spare_mvp` 项目的文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 当前开发状态

截至 2026-06-22，当前原型已经具备以下能力：

1. 登录页和登录后的项目列表着陆页。
2. 从项目列表进入功能工作台，左侧按一级、二级、三级组织导航，主区显示四级功能页面。
3. 四级功能页面标题显示三级功能名称；功能页头不显示通用说明文案；非建模页面右上角保留当前方案名称，点击可回到对应模块的仿真实验方案列表。
4. 仿真建模页面不显示右上角“当前方案”卡片；仿真建模和仿真实验页面不再显示“xxx入口”卡片，多四级页面使用紧凑中文标签。
5. 内置场景页面配置机场、任务区的名称、位置、距离等属性；任务类型、重复周期、结束条件等字段归入“任务剖面参数”页面。
6. 基本作战单元建模页面对齐 `vendor/ship_front` 的基本使用单元形态，包含编队需求、成员飞机编号和备用机清单。
7. 基本任务建模页面对齐 `vendor/ship_front` 的基本任务结构树和信息编辑形态，包含任务编号、任务区域、装备数量、最小装备数量、任务时长、取消时间、使用保障活动、阶段占比和任务时间系数。
8. 任务建模下的任务剖面能力拆为“任务剖面参数”“复合任务建模”“周期性任务建模”：参数页维护任务类型、重复周期和结束条件；复合/周期页对齐 `vendor/ship_front` 的复合任务、周期性任务建模形态，包含复合任务列表、基本任务引用、典型组合任务时序表和按周期天数分配复合任务。
9. 装备组成建模、装备故障建模页面对齐 `vendor/ship_front` 的装备组成树和属性配置形态；组成页默认进入装备组成建模，只显示装备组成树以及组件名称、父节点、所属飞机、数量、组件属性和 N 中取 K，故障页显示 MTBF、故障分布、修复时间分布和 RMS 指标。
10. 保障组织建模、保障活动建模页面保留外层四级导航，删除内部重复页签；保障组织的备件、人员、设备四级页会跳转到对应资源表，保障活动页面已对齐 `vendor/ship_front` 的树编辑、工作项目清单和网络图形态。
11. 可视化推演页面恢复三级标题“可视化推演”，只保留一个可导航入口并直接嵌入 Mesa 航空保障可视化状态；当前产品口径保留飞机、任务、保障等状态视图，Mesa 内部 `Ontology视图`、Ontology Playground 导出和项目级本体校验已从当前产品、运行时代码和测试门删除。
12. 蒙特卡洛实验已拆为实验列表、添加/编辑实验和实验详情；实验对象保存 `mc_experiment_id`、关联方案、样本量、随机种子、状态、进度、`run_id` 和 artifact 引用。
13. 蒙特卡洛评估结果已经迁移到“结果分析 / 蒙特卡洛实验结果展示”；四个结果分析页先展示分析任务列表，并允许按方案和参数自动创建新的 MC 实验后绑定分析任务。
14. M6.2 对象一致性已落地为同步本地切片：单次仿真实验和 Monte Carlo 实验共享 `SimulationExperimentBase` 字段；正式 run 走 `RunIntent -> /api/runs -> RunService -> artifacts`，Monte Carlo 通过 canonical `/api/runs` 提交 `run_type: "monte_carlo"`，并生成 `monte_carlo_base` 与四类 `analysis_projection_*` artifact。前端 MC 实验详情和 AnalysisTask 列表展示 `mc_experiment_id`、`linkedMonteCarloExperimentId`、run/artifact/projection 来源。
14. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的页面形态。
15. Monte Carlo 扫参输入会真实更新场景并重算结果。
16. 早期 Mesa `Ontology视图` 四层纵向画布约定已归档为历史设计；当前产品路线不再要求在 Mesa 仿真中展示 ontology 视图，也不再维护 repo 根目录 ontology 产物。
17. M2a / PR-C / M9.5 已扩展 `SimulationAdapter`：当前支持 Project JSON 根字段校验、`smoke` Scenario 编译、`SmokeSpareMvpModel` 运行，以及 `aviation_support` Scenario 编译、`AviationSupportModel` 单次正式执行和受治理采样契约下的 `aviation_support` formal Monte Carlo；正式 run 都生成 Result summary、ArtifactManifest、projection payload 和 `visualization_state_series`。
18. PR-D 已增加 SQLite 数据持久化切片：`schema.sql` 声明项目、用户、方案、建模快照、场景、运行、结果摘要和产物清单表；repository helper 可保存 contract 对象并按 `run_id` 查询版本化身份链。
19. PR-E 已增加函数级 Backend API facade：API 层只编排 Project 校验、项目保存、建模快照、实验计划、Adapter Scenario 编译、Mesa 运行、结果与产物持久化和按 `run_id` 查询，不在前端或 CRUD handler 中生成最终 Scenario。
20. PR-F 已增加前端 API client 接入：`front/api-client.mjs` 定义保存 Project、创建建模快照、创建实验计划、启动仿真运行、读取结果摘要和产物清单的稳定方法；`front/app.js` 通过该 client 编排保存、运行和结果读取，不再直接调用本地仿真函数生成页面结果。
21. M3-0 真实后端闭环已收束：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py`、`tests/e2e-contract-flow.test.mjs` 和 `reports/m3-0-real-backend-loop/README.md` 覆盖同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest smoke；当前仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不等同于生产 Web API、worker 或长期对象存储。
22. M3-1 浏览器后端闭环已验证：`reports/m3-1-browser-backend-smoke/README.md` 记录浏览器从同源 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取结果和 artifact manifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
23. 系统管理新增“装备RMS指标分配”本地计算工作台：使用模拟装备构型和任务剖面，支持页面调节装备级 R/M/S、MTBF、MTTR、MLDT、Ai/Ao 目标，选择等分配、比例分配、AGREE 和评分分配方法，生成任务暴露矩阵、节点级 RMS target、敏感度排名和自底向上校核结果。当前发布操作只在浏览器内写入模拟装备节点的 `rms.target`，不覆盖 `prediction` 或 `actual`，也尚未接入后端持久化、复杂 RBD 数值求解或真实仿真消费。
24. M4 权限审计 backfill 已建立本地用户、会话和审计边界：SQLite schema 包含 `users`、`sessions`、`project_access` 和 `audit_events`；`/api/auth/login` 返回 bearer token；`front/app.js` 登录后保存 M4 会话，`front/api-client.mjs` 对受保护请求附加 token。建模导入 save/publish/compile-scenario 的 HTTP 路径要求真实会话，普通用户发布会被后端阻断并写入审计。
25. M5 建模数据入口已进入 M5.1 服务化切片：`contracts/modeling_import.schema.json` 定义导入包、草稿/发布生命周期、对象集合、变更和校验问题结构；`front/modeling-import-contract.mjs` 提供纯校验函数，`src/spare_mvp_backend/modeling_import.py` 在后端复用同一语义，`src/spare_mvp_backend/http_server.py` 暴露 `/api/modeling-imports/*` validate/save/get/publish 路径，SQLite `modeling_imports` 表持久化 `draft_payload_json`、`published_payload_json` 和 validation summary。`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照；同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。
26. M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）。该入口消费 M5.1 的显式 API、后端恢复的草稿/发布快照和已发布导入包；完整 Excel 解析和 worker 基础设施仍不在 M5 切片内。
27. M5.3 建模页保存当前 Project draft；`仿真实验方案管理` 仍保留为概要设计要求的实验方案分支工作流。用户可从项目数据创建多个实验方案，编辑方案不回写项目数据，仿真运行和 Monte Carlo 使用选中的实验方案生成 run identity chain。
28. M6.0 已把当前同步 run 收敛到 `RunService` 和 canonical `/api/runs` 边界；`BackendApi.submit_run()`、HTTP `/api/runs`、前端 `submitRun()` / `getRunStatus()` 共同使用 run status/result/artifact/chain 刷新状态；旧 `/api/simulation-runs*` 已退役并返回 `410 legacy_run_api_retired`。RunService 会在当前进程内串行化 run id 生成，执行器失败后持久化 failed run 和空 ArtifactManifest 供 status 查询。该切片仍不是完整 worker 队列、取消、重试、真实批量 Monte Carlo fan-out或对象存储。
29. M6.1/M9.4 输入一致性已落地：`smoke` 和 `aviation_support` Scenario 均返回 `compiled_from.mapping_provenance`，记录 consumed/defaulted/derived/ignored/unsupported 字段；未知模型族仍通过 compile gate fail closed。前端保留 compile gate error details，并在四个结果分析 dashboard 缺少 compiler provenance 或官方 analysis artifact 时标注“本地预览，不是正式后端仿真结果”。
30. M6.1.1 单次仿真输入对齐已落地：ExperimentPlan config 持久化完整分支 `projectJson`，单次 smoke run 编译优先消费该分支 Project JSON，并在 mapping provenance 中记录 `experiment_plan_id` 和 `modeling_snapshot_id`；分支 seed、故障率、保障容量会进入后端 Scenario input。旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。
31. M6.2 当前收束：基于 M6.1/M6.1.1 编译通过的 Scenario 跑同步本地 Monte Carlo 样本，产出统一 MC artifacts，并把备件短板、携行清单、任务可靠度、停机因素作为同一个基础 MC artifact 的 projection。RunIntent / MonteCarloRunConfig / imported sample Project 后续收敛切片的当前口径是：正式 Monte Carlo 数值配置只从 `ExperimentPlan.config.analysisRequests.largeSample -> MonteCarloRunConfig` 解释；request-level MC numeric config 被拒绝；Adapter 缺 normalized config 或 legacy params 时 fail closed；功能测试和正式 run 路径应先通过“从导入数据生成示例项目”创建 imported sample Project。项目列表入口在没有已发布包时会先保存并发布示例导入包，再创建 imported sample Project；`/api/runs` formal gate 还要求 `missionProfile.sourceImportId`、已发布 import/projectId 匹配和 `modeling_import.create_project` allowed 审计记录，手工伪造来源不能通过。未创建任务、未绑定 MC、运行中、运行失败、输入未通过编译、缺少 projection artifact 或 payload 解析失败时，结果页不得显示正式结果图表。M9.5 已在该路径上补齐受治理的 `aviation_support` formal Monte Carlo；生产 worker queue、object storage、完整取消/重试、新 auth/audit scope 和 checkpoint restart 仍非当前本地同步边界目标。
32. `docs/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md` 记录当前小切片的实施和边界：`defaultScenario`、`runSimulation` 和 `runMonteCarlo` 只保留为本地预览、离线 fixture 或测试 fallback，不作为正式结果来源；页面内置 preview fixture 项目不得进入正式 single/Monte Carlo run，应 fail closed。M8.0 已让正式分析 KPI 消费 projection payload，M9.0/M9.1 已让 Mesa 可视化页消费可追溯 `visualization_state_series` artifact；本地预览 fallback 仍只能作为预览，不是正式结果来源。
33. M6.2.x 输入源治理已收束：前台建模和正式 run 功能测试的业务示例源已收敛到 `tests/fixtures/modeling_import_project.json`；缺少 imported JSON 数据时页面显示空态或创建入口，不再从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例。该切片只关闭输入源治理；在线订阅能力由 M9.2 提供。
34. M6.2.y 运行 API 退场已收束：legacy `/api/simulation-runs` 已从正式和预览测试路径退役；前端 API client、HTTP contract tests 和浏览器 smoke 只使用 canonical `/api/runs` 及其 status/result/artifacts/chain 路径。旧路径返回 `410 legacy_run_api_retired`，用于让外部调用者明确迁移到 `/api/runs`。该切片只清理 run API 兼容层；生产 worker queue、object storage 和取消/重试仍是后续运行基础设施。
35. M7.0 运行与产物管理已落地为 canonical `/api/runs` 的管理切片：支持 run list/detail、artifact id 下载、归档、软删除和生命周期状态展示；前端展示运行账本、artifact metadata 和下载入口，也为 M8/M9 按 `run_id + artifact_id` 读取 payload 提供定位基础；该切片不恢复 legacy `/api/simulation-runs`，生产 worker queue、object storage、取消/重试完整体系仍非本阶段目标。
36. M8.0/M9.5 projection payload 结果分析已落地：四个结果分析页按绑定 AnalysisTask / MonteCarloExperiment / run artifact 精确选择 `analysis_projection_*`，通过 `/api/runs/{run_id}/artifacts/{artifact_id}` 下载 JSON payload，并由 `front/analysis-projection-adapters.mjs` 驱动正式 KPI、表格和图形。M9.4 已让 `aviation_support` 单次正式 run 同步产出四类 projection payload，M9.5 已让 `aviation_support` formal Monte Carlo 同步产出同一组 projection payload。payload 缺失、类型不匹配或解析失败时 fail closed，继续显示本地预览或阻断边界；完整报告导出、异常样本钻取、生产 worker queue、object storage 和取消/重试完整体系仍非本阶段目标。
37. M9.0/M9.1/M9.5 状态序列回放与追溯已落地：成功 smoke single/Monte Carlo run、`aviation_support` single run 和 `aviation_support` formal Monte Carlo run 会写出 `visualization_state_series` artifact；payload 有独立 schema/fixture，包含 run identity、帧结构、状态字段、事件 id、指标引用、result/manifest/compiled Scenario 追溯字段，artifact manifest 记录 kind/schema version/hash/size/source run。前端 Mesa 可视化页通过 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载并校验 payload，支持本地播放、暂停、单步、重置、时间轴拖动和事件流点击定位。缺少 artifact、payload 类型不匹配或解析失败时 fail closed，演示快照只用于本地预览。
38. M9.2 在线状态流和运行订阅已落地为最小 SSE 切片：`GET /api/runs/{run_id}/state-stream` 按 run 订阅 `run_status`、`state_frame` 和 `artifact_ready` 事件，当前同步执行器从已持久化 `visualization_state_series` payload 输出在线帧；在线帧复用离线帧 schema，最终 artifact 仍通过 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载并走同一 replay adapter。前端 Mesa 可视化页显示订阅、断线/重连、未授权、失败和 artifact-ready handoff 状态；在线帧只用于展示当前流状态，不解锁播放/单步/重置控制。
39. M9.3 Run lifecycle / control plane 已落地为最小控制切片：`POST /api/runs/{run_id}/control` 接受 `cancel` 和 `retry`，后端确认后更新 run status/phase/progress 并写入 `runs.control.*` 审计；`retry` 阻断旧 result/artifact 正式读取，run detail 返回 pending 空 artifact manifest。`pause`、`resume`、`step`、`reset` 返回 fail-closed 控制错误，前端 Mesa 控制区展示后端确认状态或不可用原因，不用本地回放控制冒充后端执行控制。M9.4 已专门解锁 `aviation_support` 单次正式执行和后端输出对齐，M9.5 已解锁 `aviation_support` formal Monte Carlo；生产 worker queue、真实运行中增量推送、object storage、完整 cancel/retry 基础设施和 checkpoint restart 仍非本阶段目标。
40. M9.6 已冻结平台案例数据包、字段覆盖表和 golden fixtures：`tests/fixtures/modeling_import_project.json` 是唯一完整业务案例源；`tests/fixtures/m9_6_platform_case_export.json` 固化 published modeling import、Project、ModelingSnapshot、ExperimentPlan、RunIntent、MonteCarloRunConfig 和 compiled `aviation_support` Scenario；`tests/fixtures/m9_6_field_coverage.json` 覆盖业务字段并逐字段标注 consumed/derived/defaulted/ignored/unsupported；`tests/fixtures/m9_6_expected_artifact_kinds.json` 固定 single 与 Monte Carlo artifact kind 列表。M9.6 不实现 M9.7 正式飞机保障仿真模型族，也不把 `independent-mesa` 或 `8765` 旁路作为正式产品入口；不得先把 `independent-mesa` 旁路页面嵌入产品入口。
41. M9.7.1 已建立 `aircraft_support_v1` schema/compiler gate：`contracts/aircraft_support_v1_input.schema.json` 定义独立 input payload，`contracts/scenario.schema.json` 和 `contracts/run.schema.json` 已允许 `model_family = "aircraft_support_v1"` / `model_id = "AircraftSupportV1Model"`，`scenario_adapter_mapping.json` 记录字段来源，`SimulationAdapter.compile_scenario_with_gate()` 可把 M9.6 平台案例 Project 编译成 `aircraft_support_v1` Scenario。缺字段或非法引用继续 fail closed；真实 single run、formal Monte Carlo/projection 和 coverage 关闭仍是 M9.7.2-M9.7.4。
42. 页面建议收口执行 `reports/2026-06-19-page-revision-suggestions/README.md`：已取消删除「建模数据导入」页，M5.2 工作台继续保留；其余页面建议优先修复死按钮、字段口径、选择/批量操作和建模输入可用性，作为 M6.1.1 前的页面输入稳定工作，不扩大为 M6.1.1/M6.2 实现。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`3概要设计方案.md`](3概要设计方案.md) | 原始概要设计转换稿，是功能范围和术语来源。 |
| [`spare_mvp_rms_allocation_design.md`](spare_mvp_rms_allocation_design.md) | 装备 RMS 指标分配页面的输入设计文档，描述 RMS 口径、分配算法、页面结构、契约和阶段验收。 |
| [`product-roadmap.md`](product-roadmap.md) | 从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。 |
| [`archive/deprecated/simulation-service-governance.md`](archive/deprecated/simulation-service-governance.md) | 已过期：早期 Mesa 仿真服务治理和 Simulation-Contract-First 分工记录，仅作历史参考。 |
| [`archive/deprecated/ontology-mesa-rebuild-plan.md`](archive/deprecated/ontology-mesa-rebuild-plan.md) | 已过期：早期 Ontology + Mesa 重构边界和四层可视化约定，仅作历史参考。 |
| [`../contracts/README.md`](../contracts/README.md) | Contract Curator Agent 发布的 Project / Scenario / Run / Result / ArtifactManifest schema bundle。 |
| [`../src/spare_mvp_contract/adapter.py`](../src/spare_mvp_contract/adapter.py) | M2a / PR-C 的最小 Simulation Adapter，负责已批准的 Project -> Scenario -> Run/Result/ArtifactManifest 链路。 |
| [`../src/spare_mvp_backend/schema.sql`](../src/spare_mvp_backend/schema.sql) | SQLite 持久化 schema，用于保存版本化 contract 对象、运行身份链、M4 用户会话和审计事件。 |
| [`../src/spare_mvp_backend/api.py`](../src/spare_mvp_backend/api.py) | 函数级 Backend API facade，用于保存、运行、结果读取，以及 actor-aware 的 M4 建模导入授权审计。 |
| [`../src/spare_mvp_backend/http_server.py`](../src/spare_mvp_backend/http_server.py) | 本地标准库 HTTP facade，同源服务 `/api` 与 `front/` 静态文件，并暴露 M4 `/auth/login`、受保护 M5 mutation 和审计查询路径。 |
| [`../front/api-client.mjs`](../front/api-client.mjs) | 前端 API client，用于让静态前端通过后端 API contract 执行登录、保存、运行、建模导入和结果读取。 |
| [`../front/rms-allocation-engine.mjs`](../front/rms-allocation-engine.mjs) | RMS 分配 MVP 的本地计算入口，覆盖风险预算分配、MTTR/MLDT 加权、自底向上校核和发布到模拟 `rms.target`。 |
| [`../front/rms-allocation-workbench.mjs`](../front/rms-allocation-workbench.mjs) | RMS 分配页面渲染模块，展示装备树、目标输入、方法选择、节点级结果表、任务暴露矩阵和校核摘要。 |
| [`../reports/m3-0-real-backend-loop/README.md`](../reports/m3-0-real-backend-loop/README.md) | M3-0 真实后端闭环收束证据，记录后端 smoke 链路、验证命令、分阶段评审和当前边界。 |
| [`../reports/m3-1-browser-backend-smoke/README.md`](../reports/m3-1-browser-backend-smoke/README.md) | M3-1 浏览器同源后端闭环证据，记录真实 `/api` 保存、运行、刷新恢复和 API 不可用阻断。 |
| [`superpowers/specs/2026-06-17-four-level-function-page-design.md`](superpowers/specs/2026-06-17-four-level-function-page-design.md) | 四级功能页面化设计规格。 |
| [`superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md`](superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md) | 当前分支 M3-1/RMS 收束和 M5 建模数据入口的阶段边界设计。 |
| [`superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md`](superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md) | 当前分支验收收束和 M5 首片入口的实施计划。 |
| [`../contracts/modeling_import.schema.json`](../contracts/modeling_import.schema.json) | M5 首片建模数据导入/校验 contract，描述导入包、对象集合、生命周期、变更和字段级问题定位结构。 |
| [`superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md`](superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md) | M5.1 建模导入服务化设计，限定本地后端 API、SQLite 持久化、发布保护和非目标。 |
| [`superpowers/plans/2026-06-19-m5-1-modeling-import-service.md`](superpowers/plans/2026-06-19-m5-1-modeling-import-service.md) | M5.1 后端 API、repository、HTTP facade、前端 API client 和文档同步实施计划。 |
| [`superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md`](superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md) | M5.2 建模导入工作台和受控 Scenario 预览设计，限定系统管理入口、映射/错误/版本预览和非目标。 |
| [`superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md`](superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md) | M5.2 import workbench、`compile-scenario` 后端预览和文档同步实施计划。 |
| [`superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md`](superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md) | M6.0 仿真运行服务边界设计，限定 RunService、canonical `/api/runs`、status envelope 和非目标。 |
| [`superpowers/specs/2026-06-20-m6-1-input-consistency-design.md`](superpowers/specs/2026-06-20-m6-1-input-consistency-design.md) | M6.1 输入一致性、Scenario compiler mapping、默认值策略、provenance 和 fail-closed 编译 gate。 |
| [`superpowers/specs/2026-06-20-m6-2-unified-monte-carlo-analysis-design.md`](superpowers/specs/2026-06-20-m6-2-unified-monte-carlo-analysis-design.md) | M6.2 统一 Monte Carlo artifact、analysis profile 和四类分析 projection 的阶段边界。 |
| [`superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md`](superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md) | RunIntent、canonical MonteCarloRunConfig、预览/正式结果分界、“由建模导入生成示例项目”和静态数据退出边界的 M6.2 后续收敛切片记录。 |
| [`superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md`](superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md) | M6.2.x 前台静态业务数据退场、可导入 Project JSON 单一示例源和空态契约实施记录。 |
| [`superpowers/plans/2026-06-21-legacy-run-api-retirement.md`](superpowers/plans/2026-06-21-legacy-run-api-retirement.md) | legacy `/api/simulation-runs` 退场、canonical `/api/runs` 唯一路径和 smoke 测试迁移计划。 |
| [`superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md`](superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md) | M7.0 运行与产物管理设计，限定 run list/detail、artifact 下载、归档、软删除和审计边界。 |
| [`superpowers/plans/2026-06-21-m7-0-run-artifact-management.md`](superpowers/plans/2026-06-21-m7-0-run-artifact-management.md) | M7.0 运行与产物管理实施计划和 Task 4 文档同步边界。 |
| [`superpowers/specs/2026-06-21-m8-projection-payload-analysis-design.md`](superpowers/specs/2026-06-21-m8-projection-payload-analysis-design.md) | M8.0 projection payload 驱动四个结果分析页正式 KPI、表格和图形的设计与非目标。 |
| [`superpowers/plans/2026-06-22-m9-4-aviation-support-formal-run.md`](superpowers/plans/2026-06-22-m9-4-aviation-support-formal-run.md) | M9.4 `aviation_support` 单次正式执行、后端输出对齐和历史非目标记录。 |
| [`superpowers/plans/2026-06-22-m9-5-aviation-support-formal-monte-carlo.md`](superpowers/plans/2026-06-22-m9-5-aviation-support-formal-monte-carlo.md) | M9.5 受治理航空保障采样契约和 `aviation_support` formal Monte Carlo 完成记录。 |
| [`superpowers/plans/2026-06-23-m9-6-platform-case-fixtures.md`](superpowers/plans/2026-06-23-m9-6-platform-case-fixtures.md) | M9.6 平台案例数据包、字段覆盖表、导出链路和 golden fixtures 冻结记录。 |
| [`superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md`](superpowers/specs/2026-06-24-m9-7-aircraft-support-v1-design.md) | M9.7 `aircraft_support_v1` 正式飞机保障仿真模型族设计规格。 |
| [`superpowers/specs/2026-06-24-m9-7-2-parameter-to-result-flow.html`](superpowers/specs/2026-06-24-m9-7-2-parameter-to-result-flow.html) | M9.7.2 从参数输入、Scenario 编译、canonical `/api/runs` 到 single run artifacts 的可视化路径图。 |
| [`../reports/2026-06-19-page-revision-suggestions/README.md`](../reports/2026-06-19-page-revision-suggestions/README.md) | 2026-06-19 页面走查建议；已取消删除「建模数据导入」页，其余建议作为页面收口输入。 |
| [`superpowers/plans/2026-06-20-page-suggestion-alignment.md`](superpowers/plans/2026-06-20-page-suggestion-alignment.md) | 页面建议收口实施计划，限定保留 M5.2 建模数据导入工作台并先处理 M6.1.1 前置输入可用性。 |
| [`superpowers/plans/2026-06-20-m6-1-1-single-simulation-input-alignment.md`](superpowers/plans/2026-06-20-m6-1-1-single-simulation-input-alignment.md) | M6.1.1 单次仿真输入对齐执行计划，要求可视化推演和单次运行先通过 `ExperimentPlan + ModelingSnapshot -> Scenario compiler -> compiled Scenario`。 |
| [`superpowers/plans/2026-06-20-m6-0-run-service-boundary.md`](superpowers/plans/2026-06-20-m6-0-run-service-boundary.md) | M6.0 RunService、HTTP run routes、前端 status polling、浏览器 smoke 和文档同步实施计划。 |
| [`superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md`](superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md) | contract-first agent swarm 分阶段开发计划。 |
| [`superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md`](superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md) | 当前前端集成实现记录和验收情况。 |
| [`../src/spare_mvp_abm/aviation_support/README.md`](../src/spare_mvp_abm/aviation_support/README.md) | 本地 Mesa 航空保障场景包说明。 |
| [`../agent.md`](../agent.md) | 后续 agent 协作、验证和 subagent 使用约定。 |

## 运行与验证入口

```bash
npm test
python3 -m http.server 4173
.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173
```

浏览器访问：

```text
http://127.0.0.1:4173/front/
```

第一条静态服务命令用于原型浏览；第二条同源后端服务命令用于 M3-1 `/api` 真实浏览器闭环 smoke。

## 文档维护规则

1. 新增功能或修改页面流转时，同步更新本入口和相关设计/实现记录。
2. 对外说明使用中文；保留代码标识、命令、路径、文件名和外部项目名的原文。
3. 文档不得把静态原型或小样本仿真描述成工程级校准平台。
4. 引用 `vendor/` 或 skill 资产时，必须说明其只是本项目的本地参考或本地副本，运行时代码不得依赖用户主目录下的原始路径。
5. 删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧文案和新文案搜索 `README.md`、`docs/`、`agent.md`，同步更新当前状态文档；历史设计稿保留时必须标注当前实现差异。
