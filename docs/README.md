# 项目文档入口

本目录是 `spare_mvp` 项目的文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 当前开发状态

截至 2026-06-28，当前原型已经具备以下能力：

1. 登录页和登录后的项目列表着陆页。
2. 从项目列表进入功能工作台，左侧按一级、二级、三级组织导航，主区显示四级功能页面。
3. 四级功能页面标题显示三级功能名称；功能页头不显示通用说明文案；非建模页面右上角保留当前方案名称，点击可回到对应模块的仿真实验方案列表。
4. 仿真建模页面不显示右上角“当前方案”卡片；仿真建模和仿真实验页面不再显示“xxx入口”卡片，多四级页面使用紧凑中文标签。
5. 内置场景页面配置机场、任务区的名称、位置、距离等属性；任务类型、重复周期、结束条件等字段归入“任务剖面参数”页面。
6. 基本作战单元建模页面对齐 `vendor/ship_front` 的基本使用单元形态，按飞机列表维护飞机编号、飞机类型和大修周期语义下的日历日、飞行小时、起落次数。
7. 基本任务建模页面对齐 `vendor/ship_front` 的基本任务结构树和信息编辑形态，包含任务编号、任务区域、装备数量、最小装备数量、任务时长、提前通知时间、取消时间、使用保障活动、阶段占比和任务时间系数；`返回时间比` 已从当前页面移除，任务阶段已并入基本任务信息编辑区。
8. 任务建模下的任务剖面能力拆为“任务剖面参数”“复合任务建模”“周期性任务建模”：参数页维护任务类型、重复周期和结束条件；复合任务页按出动时刻排序典型组合任务时序表并连续重排波次序号；周期性任务页使用统一删除动作、上级任务名称和“周次 + 周内日”配置不同复合任务。
9. 装备系统建模页面对齐 `vendor/ship_front` 的装备组成树和属性配置形态；默认进入单一装备系统建模页，左侧显示装备组成树，右侧按当前选中飞机或系统节点展示对应组件表，维护组件名称、父节点、数量 n、组件属性、k 值（n 中取 k）。MTBF/MTTR 先选择分布类型再显示关联参数输入，MTBF 默认指数分布，MTTR 默认固定值；分布类型当前限定为固定值、指数分布、正态分布和均匀分布；导入校验要求 SRU 的上级必须是 LRU。
10. 装备可靠性框图建模只保留在 `任务可靠度评估模块` 下，左侧复用装备树；选中“飞机列表”根节点时右侧不显示框图，选中整机或组件时右侧只展示全部直接下一级 RBD 节点且不展示当前选中根节点，`n中取k` 节点以外层并联框展示，并在框内展开 N 个同名分支节点，门逻辑节点保持独立展示；完整绘图契约见 `docs/reliability-block-diagram-contract.md`。
11. 保障组织建模、保障活动建模页面保留外层四级导航，删除内部重复页签；保障组织支持递归树节点，备件记录所属装备，保障人员专业使用下拉字典兼容回退且不再维护所属型号，备件、人员和设备资源表不再依赖行级编辑按钮；基本保障活动通过编辑面板维护活动编号、工作名称、适用飞机、作业时长分布、人员、设备和备件需求；使用保障、预防性维修、修复性维修和后勤保障的工作项目从基本保障活动库选择/搜索并自动回填，紧前作业通过显式编辑入口维护。
12. 可视化推演页面恢复三级标题“可视化推演”，只保留一个可导航入口并直接嵌入 Mesa 航空保障可视化状态；当前产品口径保留飞机、任务、保障等状态视图，Mesa 内部 `Ontology视图`、Ontology Playground 导出和项目级本体校验已从当前产品、运行时代码和测试门删除。
13. 蒙特卡洛实验已拆为实验列表、添加/编辑实验和实验详情；实验对象保存 `mc_experiment_id`、关联方案、样本量、随机种子、状态、进度、`run_id` 和 artifact 引用。
14. 蒙特卡洛评估结果已经迁移到“蒙特卡洛实验 / 实验详情”的结果区；四个结果分析页先展示分析任务列表，并允许按方案和参数自动创建新的 MC 实验后绑定分析任务。
15. M6.2 对象一致性已落地为同步本地切片：单次仿真实验和 Monte Carlo 实验共享 `SimulationExperimentBase` 字段；正式产品运行主线走 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`，Monte Carlo 通过 canonical `/api/runs` 提交 `run_type: "monte_carlo"`，并生成 `monte_carlo_base` 与四类 `analysis_projection_*` artifact。前端 MC 实验详情和 AnalysisTask 列表展示 `mc_experiment_id`、`linkedMonteCarloExperimentId`、run/artifact/projection 来源。
16. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的页面形态。
17. Monte Carlo 扫参输入会真实更新场景并重算结果。
18. 早期 Mesa `Ontology视图` 四层纵向画布约定已归档为历史设计；当前产品路线不再要求在 Mesa 仿真中展示 ontology 视图，也不再维护 repo 根目录 ontology 产物。
19. M2a / PR-C / M9.7.3 已扩展 `SimulationAdapter`：低层 adapter 仍保留 `smoke` 与 `aviation_support` 历史回归路径；M9.7.1-M9.7.3 已新增 `aircraft_support_v1` schema/compiler、single-run core 和 formal Monte Carlo/projection。当前正式 run 入口只接受 `aircraft_support_v1`，并生成 Result summary、ArtifactManifest、projection payload 和 `visualization_state_series`。
20. PR-D 已增加 SQLite 数据持久化切片：`schema.sql` 声明项目、用户、方案、建模快照、场景、运行、结果摘要和产物清单表；repository helper 可保存 contract 对象并按 `run_id` 查询版本化身份链。
21. PR-E 已增加函数级 Backend API facade：API 层只编排 Project 校验、项目保存、建模快照、实验计划、Adapter Scenario 编译、Mesa 运行、结果与产物持久化和按 `run_id` 查询，不在前端或 CRUD handler 中生成最终 Scenario。
22. PR-F 已增加前端 API client 接入：`front/api-client.mjs` 定义保存 Project、创建建模快照、创建实验计划、启动仿真运行、读取结果摘要和产物清单的稳定方法；`front/app.js` 通过该 client 编排保存、运行和结果读取，不再直接调用本地仿真函数生成页面结果。
23. M3-0 真实后端闭环已收束：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py`、`tests/e2e-contract-flow.test.mjs` 和 `reports/m3-0-real-backend-loop/README.md` 覆盖同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest smoke；当前仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不等同于生产 Web API、worker 或长期对象存储。
24. M3-1 浏览器后端闭环已验证：`reports/m3-1-browser-backend-smoke/README.md` 记录浏览器从同源 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取结果和 artifact manifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
25. 系统运行支持模块下的“装备RMS指标分配”本地计算工作台已移入当前阶段：页面按顶部参数输入、左侧独立 `装备树`、右侧方法选择和底部 `节点分配结果` 布局组织；输入聚焦 `任务可靠度`、`MTTR`、`MTBF`，装备树先选择装备再显示当前装备树；方法保留等分配、比例分配和相似产品分配，并按方法展示参数，相似产品分配法的 `基准机型` 来自装备列表下拉。装备树导入只更新 RMS 工作台数据，不污染项目建模数据；当前页面只保留计算动作，暂不提供保存草稿或发布到装备模型入口，也尚未接入后端持久化、复杂 RBD 数值求解或真实仿真消费。
26. M4 权限审计 backfill 已建立本地用户、会话和审计边界：SQLite schema 包含 `users`、`sessions`、`project_access` 和 `audit_events`；`/api/auth/login` 返回 bearer token；`front/app.js` 登录后保存 M4 会话，`front/api-client.mjs` 对受保护请求附加 token。建模导入 save/publish/compile-scenario 的 HTTP 路径要求真实会话，普通用户发布会被后端阻断并写入审计。
27. M5 建模数据入口已进入 M5.1 服务化切片：`contracts/modeling_import.schema.json` 定义导入包、草稿/发布生命周期、对象集合、变更和校验问题结构；`front/modeling-import-contract.mjs` 提供纯校验函数，`src/spare_mvp_backend/modeling_import.py` 在后端复用同一语义，`src/spare_mvp_backend/http_server.py` 暴露 `/api/modeling-imports/*` validate/save/get/publish 路径，SQLite `modeling_imports` 表持久化 `draft_payload_json`、`published_payload_json` 和 validation summary。`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照；同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。
28. M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）。该入口消费 M5.1 的显式 API、后端恢复的草稿/发布快照和已发布导入包；完整 Excel 解析和 worker 基础设施仍不在 M5 切片内。
29. M5.3 建模页保存当前 Project draft；`仿真实验方案管理` 仍保留为概要设计要求的实验方案分支工作流。用户可从项目数据创建多个实验方案，编辑方案不回写项目数据，仿真运行和 Monte Carlo 使用选中的实验方案生成 run identity chain。
30. M6.0 已把当前同步 run 收敛到 `RunService` 和 canonical `/api/runs` 边界；`BackendApi.submit_run()`、HTTP `/api/runs`、前端 `submitRun()` / `getRunStatus()` 共同使用 run status/result/artifact/chain 刷新状态；旧 `/api/simulation-runs*` 已退役并返回 `410 legacy_run_api_retired`。RunService 会在当前进程内串行化 run id 生成，执行器失败后持久化 failed run 和空 ArtifactManifest 供 status 查询。该切片仍不是完整 worker 队列、取消、重试、真实批量 Monte Carlo fan-out或对象存储。
31. M6.1/M9.4 输入一致性已落地：`smoke` 和 `aviation_support` Scenario 均返回 `compiled_from.mapping_provenance`，记录 consumed/defaulted/derived/ignored/unsupported 字段；未知模型族仍通过 compile gate fail closed。前端保留 compile gate error details，并在四个结果分析 dashboard 缺少 compiler provenance 或官方 analysis artifact 时标注“本地预览，不是正式后端仿真结果”。
32. M6.1.1 单次仿真输入对齐已落地：ExperimentPlan config 持久化完整分支 `projectJson`，单次 smoke run 编译优先消费该分支 Project JSON，并在 mapping provenance 中记录 `experiment_plan_id` 和 `modeling_snapshot_id`；分支 seed、故障率、保障容量会进入后端 Scenario input。旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。
33. M6.2 当前收束：基于 M6.1/M6.1.1 编译通过的 Scenario 跑同步本地 Monte Carlo 样本，产出统一 MC artifacts，并把备件短板、携行清单、任务可靠度、停机因素作为同一个基础 MC artifact 的 projection。RunIntent / MonteCarloRunConfig / imported sample Project 后续收敛切片的当前口径是：正式 Monte Carlo 数值配置只从 `ExperimentPlan.config.analysisRequests.largeSample -> MonteCarloRunConfig` 解释；request-level MC numeric config 被拒绝；Adapter 缺 normalized config 或 legacy params 时 fail closed；功能测试和正式 run 路径应先通过“从导入数据生成示例项目”创建 imported sample Project。项目列表入口在没有已发布包时会先保存并发布示例导入包，再创建 imported sample Project；`/api/runs` formal gate 还要求 `missionProfile.sourceImportId`、已发布 import/projectId 匹配和 `modeling_import.create_project` allowed 审计记录，手工伪造来源不能通过。未创建任务、未绑定 MC、运行中、运行失败、输入未通过编译、缺少 projection artifact 或 payload 解析失败时，结果页不得显示正式结果图表。M9.5 的 `aviation_support` formal Monte Carlo 已归档，当前正式模型族为 `aircraft_support_v1`；生产 worker queue、object storage、完整取消/重试、新 auth/audit scope 和 checkpoint restart 仍非当前本地同步边界目标。
34. `docs/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md` 记录当前小切片的实施和边界：`defaultScenario`、`runSimulation` 和 `runMonteCarlo` 只保留为本地预览、离线 fixture 或测试 fallback，不作为正式结果来源；页面内置 preview fixture 项目不得进入正式 single/Monte Carlo run，应 fail closed。M8.0 已让正式分析 KPI 消费 projection payload，M9.0/M9.1 已让 Mesa 可视化页消费可追溯 `visualization_state_series` artifact；本地预览 fallback 仍只能作为预览，不是正式结果来源。
35. M6.2.x 输入源治理已收束：前台建模和正式 run 功能测试的业务示例源已收敛到 `tests/fixtures/modeling_import_project.json`；缺少 imported JSON 数据时页面显示空态或创建入口，不再从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例。该切片只关闭输入源治理；在线订阅能力由 M9.2 提供。
36. M6.2.y 运行 API 退场已收束：legacy `/api/simulation-runs` 已从正式和预览测试路径退役；前端 API client、HTTP contract tests 和浏览器 smoke 只使用 canonical `/api/runs` 及其 status/result/artifacts/chain 路径。旧路径返回 `410 legacy_run_api_retired`，用于让外部调用者明确迁移到 `/api/runs`。该切片只清理 run API 兼容层；生产 worker queue、object storage 和取消/重试仍是后续运行基础设施。
37. M7.0 运行与产物管理已落地为 canonical `/api/runs` 的管理切片：支持 run list/detail、artifact id 下载、归档、软删除和生命周期状态展示；前端展示运行账本、artifact metadata 和下载入口，也为 M8/M9 按 `run_id + artifact_id` 读取 payload 提供定位基础；该切片不恢复 legacy `/api/simulation-runs`，生产 worker queue、object storage、取消/重试完整体系仍非本阶段目标。
38. M8.0/M9.7.3 projection payload 结果分析已落地：四个结果分析页按绑定 AnalysisTask / MonteCarloExperiment / run artifact 精确选择 `analysis_projection_*`，通过 `/api/runs/{run_id}/artifacts/{artifact_id}` 下载 JSON payload，并由 `front/analysis-projection-adapters.mjs` 驱动正式 KPI、表格和图形。历史 `aviation_support` projection payload 可保留为归档回归证据；当前正式和测试入口只接受 `aircraft_support_v1` formal Monte Carlo 产出的 `monte_carlo_base` 和四类 projection payload。payload 缺失、类型不匹配或解析失败时 fail closed，继续显示本地预览或阻断边界；完整报告导出、异常样本钻取、生产 worker queue、object storage 和取消/重试完整体系仍非本阶段目标。
39. M9.0/M9.1/M9.7.3 状态序列回放与追溯已落地：历史 smoke / `aviation_support` run artifact 仍可作为归档和低层回归证据；当前 formal run 入口只允许 `aircraft_support_v1` single/formal Monte Carlo 写出新的 `visualization_state_series` artifact。payload 有独立 schema/fixture，包含 run identity、帧结构、状态字段、事件 id、指标引用、result/manifest/compiled Scenario 追溯字段，artifact manifest 记录 kind/schema version/hash/size/source run。`aircraft_support_v1` 任务帧额外携带周期任务、复合任务、基本任务、实际天、波次、要求机型/数量、时长和实际执行飞机字段；缺少这些字段时任务计划视图 fail closed，不从旧 artifact 的 id/name/aircraft_type 推断。前端 Mesa 可视化页通过 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载并校验 payload，支持本地播放、暂停、单步、重置、时间轴拖动和事件流点击定位。缺少 artifact、payload 类型不匹配或解析失败时 fail closed，演示快照只用于本地预览。
40. M9.2 在线状态流和运行订阅已落地为最小 SSE 切片：`GET /api/runs/{run_id}/state-stream` 按 run 订阅 `run_status`、`state_frame` 和 `artifact_ready` 事件，当前同步执行器从已持久化 `visualization_state_series` payload 输出在线帧；在线帧复用离线帧 schema，最终 artifact 仍通过 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载并走同一 replay adapter。前端 Mesa 可视化页显示订阅、断线/重连、未授权、失败和 artifact-ready handoff 状态；在线帧只用于展示当前流状态，不解锁播放/单步/重置控制。
41. M9.3 Run lifecycle / control plane 已落地为最小控制切片：`POST /api/runs/{run_id}/control` 接受 `cancel` 和 `retry`，后端确认后更新 run status/phase/progress 并写入 `runs.control.*` 审计；`retry` 阻断旧 result/artifact 正式读取，run detail 返回 pending 空 artifact manifest。`pause`、`resume`、`step`、`reset` 返回 fail-closed 控制错误，前端 Mesa 控制区展示后端确认状态或不可用原因，不用本地回放控制冒充后端执行控制。M9.4/M9.5 的 `aviation_support` 能力已归档；当前 formal lifecycle/control 新 run 入口只接受 `aircraft_support_v1`。生产 worker queue、真实运行中增量推送、object storage、完整 cancel/retry 基础设施和 checkpoint restart 仍非本阶段目标。
42. M9.6 已冻结平台案例数据包、字段覆盖表和 golden fixtures：`tests/fixtures/modeling_import_project.json` 是唯一完整业务案例源；`tests/fixtures/m9_6_platform_case_export.json` 固化 published modeling import、Project、ModelingSnapshot、ExperimentPlan、RunIntent、MonteCarloRunConfig 和 compiled `aviation_support` Scenario；`tests/fixtures/m9_6_field_coverage.json` 覆盖业务字段并逐字段标注 consumed/derived/defaulted/governance_only/ignored/unsupported，M9.7.4 后 M9.6 frozen 字段 unsupported 汇总为 0；`tests/fixtures/m9_6_expected_artifact_kinds.json` 固定 single 与 Monte Carlo artifact kind 列表。M9.6 自身不实现 M9.7 正式飞机保障仿真模型族，也不把 `independent-mesa` 或 `8765` 旁路作为正式产品入口；M9.8 后这些旁路源码树已移除，历史参考只保留在 `docs/superpowers/` 的归档计划和规格中。
43. M9.7.4 已在 M9.7.1 `aircraft_support_v1` schema/compiler gate、M9.7.2 single-run core 和 M9.7.3 formal Monte Carlo/projection 之后完成 coverage hardening 收口：`src/spare_mvp_abm/aircraft_support_v1/` 提供 `AircraftSupportV1Model`，`SimulationAdapter.run_scenario()` 和 `SimulationAdapter.run_monte_carlo_scenario()` 可通过 canonical `/api/runs` 执行 `aircraft_support_v1` Scenario，并产出 result、metrics、report、log、run chain、四类 projection、`monte_carlo_base`、样本失败账本和 `visualization_state_series`。M9.7.4 行为驱动字段包含机队数量/初始可用、任务波次、`components[].failureDistribution`、组件寿命/RMS/k-out-of-n、`reliabilityBlockDiagram`、保障资源容量、库存、`supportNodes[].transportPolicies`、保障活动 job DAG、周期任务、任务阶段/机场/任务区、Monte Carlo sweep 与 seed；仿真时长优先由周期任务配置天数 × 重复次数推导，`durationHours` 只作为无周期任务时的回退。`supportOrganization` 已批准为 governance-only / 不驱动仿真字段，进入 provenance 而不再阻断 M9.6 冻结案例。
44. M9.8 平台嵌入已收束：前端 RunIntent 默认提交 `aircraft_support_v1`，可视化仿真、Monte Carlo 和四类分析页以 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`、`/api/runs/{run_id}/artifacts/{artifact_id}` 和 `/api/runs/{run_id}/state-stream` 作为正式数据来源。可视化仿真任务视图已将任务计划表和任务甘特图合并，按周期性任务 / 复合任务 / 每天基本任务分组展示实际天、波次、要求型号、数量、实际执行飞机和状态；缺少正式任务计划字段时不再前端兜底。`scripts/start-system.sh start` 默认只启动平台同源 app/backend 和 SQLite；只有显式传入 `--with-contract-provider` 时才启动 `src/spare_mvp_abm/contract_server.py :8521` legacy/dev sidecar。该 sidecar 不属于默认产品运行路径；`independent-mesa/GLM`、`independent-mesa/GPT` 以及服务/静态输出入口已从当前源码树移除。
45. 阶段 6P 仿真分析验收数据包已落地：`tests/fixtures/simulation_analysis_cases/` 固定 `minimal_single_aircraft`、`canonical_platform_case` 和 `max_granularity_multi_aircraft` 三类 modeling-import-v1 案例；`src/spare_mvp_backend/simulation_analysis_cases.py` 与 `scripts/export-simulation-analysis-cases.py --write|--check` 负责生成和漂移检查；`tests/test_simulation_analysis_cases.py` 验证三类数据均可进入 `aircraft_support_v1` formal Monte Carlo，并产出 `monte_carlo_base`、`visualization_state_series` 和四类 `analysis_projection_*` artifact。该数据包是分析功能前置验收基线，不是生产性能压测。
46. 2026-06-26 退役收束：`smoke` 与 `aviation_support` 从正式和测试入口退役；canonical `/api/runs`、`BackendApi.start_simulation_run()`、前端 run shortcut 和 modeling import `compile-scenario` 只接受 `aircraft_support_v1`，旧模型族返回 `retired_model_family` 并指向 `aircraft_support_v1`。低层 adapter/fixture 可继续作为历史回归证据。
47. 页面建议收口执行 `reports/2026-06-19-page-revision-suggestions/README.md`：已取消删除「建模数据导入」页，M5.2 工作台继续保留；其余页面建议优先修复死按钮、字段口径、选择/批量操作和建模输入可用性，作为 M6.1.1 前的页面输入稳定工作，不扩大为 M6.1.1/M6.2 实现。

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
| [`../src/spare_mvp_backend/simulation_analysis_cases.py`](../src/spare_mvp_backend/simulation_analysis_cases.py) | 阶段 6P 仿真分析验收数据包生成器，负责最小单机、平台标准和最大多机三类 fixture。 |
| [`../src/spare_mvp_backend/http_server.py`](../src/spare_mvp_backend/http_server.py) | 本地标准库 HTTP facade，同源服务 `/api` 与 `front/` 静态文件，并暴露 M4 `/auth/login`、受保护 M5 mutation 和审计查询路径。 |
| [`../front/api-client.mjs`](../front/api-client.mjs) | 前端 API client，用于让静态前端通过后端 API contract 执行登录、保存、运行、建模导入和结果读取。 |
| [`../front/rms-allocation-engine.mjs`](../front/rms-allocation-engine.mjs) | RMS 分配 MVP 的本地计算入口，覆盖风险预算分配、MTTR/MLDT 加权、自底向上校核和发布到模拟 `rms.target`。 |
| [`../front/rms-allocation-workbench.mjs`](../front/rms-allocation-workbench.mjs) | RMS 分配页面渲染模块，展示顶部任务可靠度/MTTR/MTBF 参数、独立导入装备树、三种当前阶段方法选择和节点分配结果表。 |
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
npm run start:system
npm run start:system:with-contract-provider  # 仅在需要 legacy/dev contract provider sidecar 时使用
```

浏览器访问：

```text
http://127.0.0.1:4173/front/
```

`npm run start:system` 等价于 `bash scripts/start-system.sh start`，默认只启动同源 app/backend、使用 `runs/system-start/spare_mvp.sqlite3` 持久化，并通过正式主线 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts` 运行。`npm run start:system:with-contract-provider` 等价于 `bash scripts/start-system.sh start --with-contract-provider`，只在需要历史 contract provider 或旧 Mesa contract 调试面时额外启动 `src/spare_mvp_abm/contract_server.py :8521` legacy/dev sidecar。

## 文档维护规则

1. 新增功能或修改页面流转时，同步更新本入口和相关设计/实现记录。
2. 对外说明使用中文；保留代码标识、命令、路径、文件名和外部项目名的原文。
3. 文档不得把静态原型或小样本仿真描述成工程级校准平台。
4. 引用 `vendor/` 或 skill 资产时，必须说明其只是本项目的本地参考或本地副本，运行时代码不得依赖用户主目录下的原始路径。
5. 删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧文案和新文案搜索 `README.md`、`docs/`、`agent.md`，同步更新当前状态文档；历史设计稿保留时必须标注当前实现差异。
