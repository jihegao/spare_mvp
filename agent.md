# Agent 协作约定

本文档约束后续 agent 在本仓库中的工作方式。除代码、命令、路径和外部工具名称外，面向项目的说明文档统一使用中文。

## 基本原则

1. 先读取当前仓库状态，再判断实现边界；不要只按历史记忆修改。
2. 保持 PR 切片边界清晰。当前工作主要集中在 `front/`、`tests/`、`docs/`、`contracts/`、`reports/`、`src/spare_mvp_backend/`、`src/spare_mvp_contract/`、`src/spare_mvp_abm/aviation_support/` 和 `vendor/ship_front/`；M4 backfill 触达本地用户、会话、授权、审计和受保护 M5 HTTP 路径，M5 数据入口切片还会触达导入 fixture、contract 测试、`modeling_imports` 持久化、`/api/modeling-imports/*` 本地后端路径和系统运行支持模块的项目数据管理模板入口。
3. 不把静态原型、小样本 Monte Carlo 或 Mesa 烟测描述成工程级校准平台。
4. 修改功能流转、页面入口、仿真参数或结果口径时，必须同步更新 `README.md`、`docs/README.md` 或对应设计/实现文档。
5. 运行时代码不得依赖 `/Users/gaojihe/...` 下的外部原型路径；这些路径只能出现在来源说明或本地验证命令中。
6. 当测试或实现删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧标题、旧 CSS/函数名、旧中文文案和新入口关键词搜索 `README.md`、`docs/`、`agent.md`，并更新命中的当前状态文档。

## 常用验证

```bash
npm test
npm run start:system
```

默认产品运行入口是 `npm run start:system` / `bash scripts/start-system.sh start`：只启动同源 app/backend、使用 `runs/system-start/spare_mvp.sqlite3` 持久化。当前用户可见分析结果通过 `当前 Project -> POST /api/mesa-analysis-runs -> aircraft_support_v1 simulation inputs -> in-memory AircraftSupportV1Model -> lite Mesa 会话摘要` 生成。旧 `/api/runs`、RunService、SimulationRun、ResultSummary 和 ArtifactManifest 运行账本路径仅作为历史实现、内部治理能力或后续持久化运行治理候选；旧 contract provider、smoke model、smoke scenarios 和 smoke JSON fixtures 已退役删除，后续不得恢复为运行入口或测试夹具。

Python/Mesa 相关 unittest 仍使用 repo-local `.abm-mesa-test-env`；不要切回早期 Mesa 测试环境。

浏览器检查入口：

```text
http://127.0.0.1:4173/front/
```

重点验证路径：

1. 登录 -> 项目列表 -> 进入当前项目。
2. 方案列表作为进入项目后的默认页。
3. 当前方案名称可回到方案列表。
4. Monte Carlo 配置页修改扫参后，结果分析页显示新参数组。
5. 点击 Monte Carlo “启动”后返回方案列表，当前方案状态为“运行中”。
6. 可视化推演页面直接显示 Mesa 页面内容，不显示外层四级导航，也不显示旧 `Ontology视图`。
7. 当前同源后端验证用 `npm run start:system` 启动后，浏览器从 `/front/` 通过 `/api/mesa-analysis-runs` 提交当前 Project 或 ExperimentPlan 分支 Project，返回 lite Mesa 会话指标、表格和事件摘要；M3-1 `/api/runs` smoke 闭环只作为归档证据保留在 `reports/m3-1-browser-backend-smoke/`。
8. `/api` 不可用时，前端必须显示阻断状态，不创建 `offline-demo-run`。
9. RMS 分配发布只允许写入 `rms.target` 或 allocation plan，不覆盖 `prediction` 或 `actual`。
10. M5 建模数据入口必须校验重复 ID、悬空引用、非法数值和已发布且被运行引用后的覆盖保护，并返回页面、对象、字段路径和严重级别。
11. M4 backfill 后，HTTP 侧建模导入 save/publish/compile-scenario 必须带 `/api/auth/login` 返回的 bearer token；未登录请求返回 `unauthorized`，普通用户发布返回 `forbidden` 并写入 `audit_events`。
12. M5.1 本地后端路径必须通过 `/api/modeling-imports/validate`、带 M4 session 的 `/api/modeling-imports`、`/api/modeling-imports/{import_id}` 和带 M4 session 的 `/api/modeling-imports/{import_id}/publish` 验证；`modeling_imports` 必须保留 `draft_payload_json` 和 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`；同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。
13. 项目数据管理当前以 Project 数据层为入口：左侧显示项目列表，`projectInfo.isTemplate` 为真的项目显示【模板】；右侧只保留模板管理（设为模板 / 取消设为模板）和数据概览（任务、装备、保障系统、保障活动），不得恢复 Project JSON 原始数据查看区或递归查看器。经校验的 JSON 文件选择、覆盖预览、确认覆盖、并发版本冲突提示和审计能力必须保留。项目列表页也必须从这些已标记 Project 模板复制创建项目，不得恢复旧的内置建模导入模板注册表或下拉选择器。普通项目数据管理页不得恢复建模数据源配置、sheet 选择器、已发布模板预览、字段映射、v1/v2 分类或旧校验级别分类。M5 建模导入 save/publish/compile-scenario API 仍作为后台维护和导入转换能力保留；导入范围只通过 `usedTables` 声明；局部导入入口只保留文件导入、当前项目回灌、内嵌样例恢复、校验、保存、发布和编译维护动作；`compile-scenario` 必须读取持久化 published payload，而不是当前 draft 或前端内存快照；该切片仍不包含完整 Excel 解析或 worker 基础设施。
14. 当前用户可见运行主线必须通过 `POST /api/mesa-analysis-runs` 创建 lite Mesa 会话；旧 `/api/simulation-runs*` 已退役，只能返回 `410 legacy_run_api_retired` 负向契约。`/api/runs`、RunService、SimulationRun、ResultSummary、ArtifactManifest、state-stream、control plane 和 artifact 下载能力保留为历史实现、内部治理能力或后续持久化运行治理候选，不得在没有新契约的情况下恢复为用户主流程。
15. M6.1/M9.4 输入一致性已形成窄闭环；`smoke` 执行路径、contract provider 和 JSON fixtures 已退役删除，`aviation_support` 也已退出活动 schema、mapping 和 fixtures。当前 lite Mesa 会话、modeling import `compile-scenario` 和旧账本路径都只能使用 `aircraft_support_v1` 作为当前模型核心。旧模型族必须返回 `retired_model_family` 并给出 `replacement_model_family: "aircraft_support_v1"`；未知模型族或无效 Project 仍必须 fail closed，不伪造页面会话结果。
16. 四个结果分析页是独立 `lite-mesa-analysis` 会话页：页面直接提交当前 Project 或所选 ExperimentPlan 分支 Project 到 `/api/mesa-analysis-runs`，返回 session 指标、表格、波次明细、日采样或事件快照。每个样本必须在独立进程中受默认 60 秒硬上限约束；整批后端预算按并行执行波次计算并限制在 180 到 900 秒，前端使用相同波次口径加 30 秒响应余量。响应必须保留请求/完成/失败样本数、逐样本诊断及分阶段耗时，前端必须区分请求超时、网络错误、整批阻断和部分样本失败。不得把这四页重新路由到 current-result 面板、AnalysisTask、MonteCarloExperiment、run/artifact 选择器、`analysis_projection_*` payload 或 `/api/runs` 账本路径。
17. ExperimentPlan config 继续携带分支 `projectJson`、samples、seed 和页面会话设置；lite Mesa 会话优先使用所选 ExperimentPlan 的分支 Project。旧 RunService 编译分支 Project JSON 的能力只作为内部治理/历史账本路径保留，不是四个分析页和 Monte Carlo 详情的用户主流程。
18. M6.2 到 M9.7.4 形成的正式 run、formal Monte Carlo、projection、state-series、run lifecycle 和 control plane 能力是历史实现与内部治理资产。后续若要把 `/api/runs` 重新提升为用户可见主流程，必须先更新 `docs/lite-mesa-formal-runtime.md`、`README.md`、`docs/README.md`、本文件和契约测试；在此之前，页面“正式结果”文案应指 lite Mesa 会话摘要，而不是 ResultSummary、ArtifactManifest、current result 或 projection artifact。
19. 执行 `reports/2026-06-19-page-revision-suggestions/README.md` 页面建议时，当前项目数据管理入口应保持为项目列表、模板管理和数据概览，并保留经校验的 JSON 覆盖流程；不得恢复 Project JSON 原始数据查看区，也不要恢复旧的建模数据源配置、sheet 选择器、已发布模板预览或独立建模数据导入工作台。页面建议收口只修 M6.1.1 前置输入可用性、死按钮和字段口径，不得顺手实现 M6.1.1 或 M6.2。
20. RunIntent / MonteCarloRunConfig / imported sample Project 收敛已作为历史账本切片完成；当前用户主流程不从 request、Project draft、Adapter 和前端本地 sweep 多处猜值，而是由 ExperimentPlan config 与页面设置驱动 lite Mesa 会话。项目数据管理只维护项目选择、模板标记、概览和经校验的 JSON 覆盖，不提供原始 JSON 查看；`defaultScenario`、`runSimulation` 和 `runMonteCarlo` 只能保留为离线 fixture、本地预览或测试 fallback，不能作为 lite Mesa 会话结果来源。
21. M6.2.x 输入源治理已收束：`tests/fixtures/modeling_import_project.json` 是唯一完整业务示例源。前端页面缺少 imported JSON 数据时必须显示空态或创建入口，不得从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例；preview fixture 只能用于显式本地预览和测试 fallback。M8.0 已消费 projection payload，M9.0/M9.1 已消费可追溯离线 `visualization_state_series` payload，M9.2 已消费 run-scoped 在线状态流，M9.3 已消费后端确认的最小 run control，当前正式消费路径统一为 `aircraft_support_v1`；该规则不表示生产 worker、object storage 或完整 cancel/retry 已完成。
22. Legacy `/api/simulation-runs` 已退役：新实现、测试、浏览器 smoke 和文档不得把它作为可用入口；旧路径只允许返回 `410 legacy_run_api_retired` 的负向契约。新的用户可见分析入口应使用 `/api/mesa-analysis-runs`；新的运行账本治理工作如需使用 `/api/runs`，必须明确标注为 internal/legacy/future-governance，不能写成四个分析页的当前产品结果来源。
23. 后续所有运行管理工作若继续触达 `/api/runs` 和 artifact ids，必须按 `run_id` + `artifact_id` 定位，并保持其内部治理/后续持久化候选定位；不得恢复或重新引入 legacy `/api/simulation-runs`，也不得让普通主界面展示 run/artifact 选择器来替代 lite Mesa 会话页。
24. M9.0/M9.1 离线状态序列回放、`visualization_state_series`、state-stream 和 run control 属于旧账本路径能力。修改相关代码时仍要保持 run identity、时间步、飞机/任务/资源状态、事件摘要、事件 id、指标引用和 traceability 的 fail-closed 规则；但这些规则不得被表述为当前四个结果分析页的用户主流程。
25. M9.7.4 已在 `aircraft_support_v1` 真实 single-run core 和 formal Monte Carlo/projection 后关闭最终字段覆盖：`SimulationAdapter.compile_scenario_with_gate()` 继续生成 `AircraftSupportV1Model` Scenario envelope 和独立 input payload，`SimulationAdapter.run_scenario()` / `run_monte_carlo_scenario()` 通过 `src/spare_mvp_abm/aircraft_support_v1/` 写出 canonical result/artifact/run chain/metrics/report/log/projection/state-series、`monte_carlo_base` 和样本失败账本。report/log 必须声明 `m9_7_4_behavior_scope`，行为驱动字段包含 `components[].failureDistribution`、顶层 `transportPolicies[]`、`reliabilityBlockDiagram`、RMS/k-out-of-n、周期任务、任务阶段/机场、保障活动 job DAG、库存、资源容量、Monte Carlo sweep 与 seed；后勤保障活动建模页的运输策略以 `scenario.transportPolicies` 为单一来源，`supportActivities[].transportStrategies` / `organizationStrategies` 仅保留旧数据导入兼容，不进入 clean Project 或编译 payload；`aircraft_support_v1` 仿真时长必须优先由周期任务配置天数 × 重复次数推导，`durationHours` 只作为无周期任务时的回退；`supportOrganization` 是 governance-only / 不驱动仿真字段，进入 provenance 而不再阻断 M9.6 frozen 案例。M9.6 field coverage 中 frozen 字段 unsupported 汇总必须保持 0。
26. M9.2 在线状态流和 M9.3 后端运行控制保留为旧账本路径能力；`cancel`/`retry` 必须以后端确认和审计为准，`pause`、`resume`、`step`、`reset` 必须 fail closed，不得在前端伪造。当前 lite Mesa 用户主流程不依赖 state-stream/control 解锁页面结果；后续不得把 checkpoint restart 混入无对应 contract 的阶段。
27. M9.8 平台嵌入后的当前用户可见分析结果必须来自 lite Mesa 会话摘要：Monte Carlo 详情和四类分析页通过 `/api/mesa-analysis-runs` 运行，页面展示 session 指标、表格和事件摘要，不展示 run/artifact 选择器。可视化推演页允许使用平台管理的 Solara iframe sidecar（默认 `8765`）直接驱动 `AircraftSupportV1Model.step()`，但该 sidecar 只是交互式可视化承载，不得恢复旧 contract provider、`independent-mesa/server.py`、`/mesa-visualization-runs`、静态 HTML 旁路或 `/api/runs` 用户主流程；`independent-mesa/GLM` 和 `independent-mesa/GPT` 源码树已移除，后续不得恢复为旁路服务或离线复现实验入口。
28. M9.6 已冻结平台案例数据包、字段覆盖表和 golden fixtures：`tests/fixtures/modeling_import_project.json` 是唯一完整业务案例源；`tests/fixtures/m9_6_platform_case_export.json`、`tests/fixtures/m9_6_field_coverage.json` 和 `tests/fixtures/m9_6_expected_artifact_kinds.json` 是后续 M9.7/M9.8 的验收输入。修改 canonical import fixture、导出链路、adapter provenance 或 artifact kind 时，必须运行 `python3 scripts/export-m9-6-case-package.py --check` 和 `python3 -m unittest tests.test_m9_6_case_package -v`。
29. 阶段 6P 仿真分析验收数据包已收束为 `tests/fixtures/simulation_analysis_cases/canonical_platform_case.json` 单一 canonical modeling-import 输入；`minimal_single_aircraft`、`max_granularity_multi_aircraft` 和旧 frontend smoke Project JSON 均已退役。6P canonical 只要求 validation 与 `aircraft_support_v1` Scenario 编译通过，不再要求生成 formal Monte Carlo 或正式分析 artifact。修改 6P fixture 或 `src/spare_mvp_backend/simulation_analysis_cases.py` 时，必须运行 `python3 scripts/export-simulation-analysis-cases.py --check` 和 `python3 -m unittest -q tests.test_simulation_analysis_cases`。6P 是分析验收基线，不是生产性能压测。
30. 2026-06-27 TODO 阶段 2 后，触达保障组织、备件、保障人员、保障设备或保障活动页面时，必须保持递归组织树、备件所属装备、保障人员专业字典回退、无所属型号、无行级编辑按钮、基本保障活动编辑面板、工作项目基础库选择/搜索/自动回填和显式紧前作业编辑。建模表单管理的持久专业字典仍属后续阶段；阶段 3 的结果页、可视化承载迁移不得回退这些页面约束。
31. 任务建模字段必须保持唯一归属：最小装备数量只写 `basicMissions[].minRequiredSorties`，复合任务项只读继承；任务优先级只写 `missionProfile.compositeTasks[].priority`。不得重新写入 basic mission 或 task item 的 `priority`，也不得写入 task item 的 `minRequiredSystems`。改动该边界时，同步更新 contract、Project payload normalizer、adapter/model、现有 Project 迁移脚本、canonical/M9.6/clean Project fixtures，并保留已发布 import 与历史 run/snapshot 的不可覆写边界。

## Contract Provider 退役边界

旧 contract provider 源文件、旧 smoke 模型、smoke scenarios、smoke JSON fixtures 和对应测试已退役删除。后续 agent 不得把旧 sidecar、smoke scenario 或旧 smoke fixture 恢复为开发/验证入口；需要验证用户可见运行链路时使用 `/api/mesa-analysis-runs`、`aircraft_support_v1`、M9.6 fixtures 和 6P `canonical_platform_case`。旧 `/api/runs` 账本路径只在内部治理或后续持久化运行治理任务中验证。

## 文档同步检查

修改前端页面结构、功能入口、仿真参数、结果来源或测试断言时，完成前必须执行一次文档同步检查：

1. 用旧文案和新文案分别搜索文档，例如 `rg -n "Ontology 上下文|ontology-map|Ontology视图|可视化推演" README.md docs agent.md`，确认命中仅限归档历史或删除说明。
2. 如果测试中新增了 `doesNotMatch` 删除旧 UI 或旧路由，必须用被删除的字符串搜索文档，确认没有当前状态文档仍按旧 UI 描述。
3. 至少检查 `README.md`、`docs/README.md`、`docs/product-roadmap.md`、相关当前开发面文档和 `agent.md`。
4. 历史计划、阶段规格或一次性审计只应位于 `docs/archive/deprecated/`；除非任务要求追溯历史，不要把归档文档作为当前实现依据。
5. 最终回复要说明更新了哪些文档，或者说明为什么某个命中文档是历史记录而不需要改。

## Subagent 使用约定

主线程始终是控制者，subagent 只承担边界清晰的并行子任务。

适合派发 subagent 的任务：

1. 独立文档审阅，例如检查某个目录是否仍有英文说明或过期口径。
2. 独立代码阅读，例如对比 `vendor/ship_front` 与当前 `front/` 的页面结构。
3. 独立测试补充建议，例如为某个页面流转列出缺失断言。
4. 不共享同一文件的并行实现任务。

不适合派发 subagent 的任务：

1. 需要持续修改同一个核心文件，例如同时改 `front/app.js` 的多个交互路径。
2. 需要最终取舍产品口径或验收边界的任务。
3. 涉及提交、推送、开 PR、合并或删除文件的任务。
4. 需要访问用户凭据、外部账号或敏感本地文件的任务。

派发 subagent 时必须提供：

1. 明确目标和非目标。
2. 允许读取或修改的文件范围。
3. 预期输出格式，优先要求给出文件路径、行号、问题和建议。
4. 验证命令或人工检查点。

subagent 返回后，主线程必须：

1. 本地复核关键结论，不直接把 subagent 报告当作事实。
2. 自己执行最终测试和浏览器验证。
3. 自己负责暂存、提交、推送和 PR 更新。
4. 在最终回复中说明验证证据，而不是只复述 subagent 结论。

## 文档语言规则

1. 新增 Markdown 文档默认中文。
2. 历史英文说明需要在触达时翻译或替换为中文当前状态。
3. 代码片段、测试名称、命令、JSON 字段、路径和第三方项目名可保留原文。
4. 如果文档描述的是历史计划，必须标注“历史记录”或“当前状态”，避免读者误以为仍是待执行任务。
