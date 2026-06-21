# 备件规划与任务可靠度验证评估平台原型

本仓库当前是基于 `docs/3概要设计方案.docx` 重构出的备件规划与任务可靠度验证评估原型。当前开发分支已经包含登录、项目列表着陆页、四级功能导航、Mesa 可视化嵌入、蒙特卡洛扫参与结果分析页、以及 ship_front / 备件_front 对齐页面；早期 Ontology + Mesa 重构和 Simulation-Contract-First 治理文档已归档为历史材料，当前产品、运行时代码和测试门不再保留 ontology 需求。

## 项目文档入口

统一文档入口见 [`docs/README.md`](docs/README.md)。常用文档：

- [`docs/3概要设计方案.md`](docs/3概要设计方案.md)：原始概要设计的 Markdown 转换稿。
- [`docs/spare_mvp_rms_allocation_design.md`](docs/spare_mvp_rms_allocation_design.md)：装备 RMS 指标分配页面的输入设计文档。
- [`docs/product-roadmap.md`](docs/product-roadmap.md)：从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。
- [`docs/superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md`](docs/superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md)：M3-1/RMS 收束与 M5 数据入口首片设计。
- [`docs/superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md`](docs/superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md)：M3-1/RMS 验收收束与 M5 首片实施计划。
- [`docs/superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md`](docs/superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md)：M5.1 建模导入服务化设计。
- [`docs/superpowers/plans/2026-06-19-m5-1-modeling-import-service.md`](docs/superpowers/plans/2026-06-19-m5-1-modeling-import-service.md)：M5.1 后端 API、SQLite 持久化和前端 client 实施计划。
- [`docs/superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md`](docs/superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md)：M5.2 建模导入工作台和 Scenario 预览设计。
- [`docs/superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md`](docs/superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md)：M5.2 系统管理入口、映射/错误/版本预览和 `compile-scenario` 实施计划。
- [`docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md`](docs/superpowers/specs/2026-06-20-m6-0-run-service-boundary-design.md)：M6.0 仿真运行服务边界设计。
- [`docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md`](docs/superpowers/plans/2026-06-20-m6-0-run-service-boundary.md)：M6.0 canonical run API、status 轮询和同步本地执行器实施计划。
- [`docs/superpowers/specs/2026-06-20-m6-1-input-consistency-design.md`](docs/superpowers/specs/2026-06-20-m6-1-input-consistency-design.md)：M6.1 前端 Project / ExperimentPlan 到 Mesa Scenario input 的一致性、mapping 和编译阻断设计。
- [`reports/2026-06-19-page-revision-suggestions/README.md`](reports/2026-06-19-page-revision-suggestions/README.md)：2026-06-19 页面走查建议；已取消删除“建模数据导入”页，保留 M5.2 工作台。
- [`docs/superpowers/plans/2026-06-20-page-suggestion-alignment.md`](docs/superpowers/plans/2026-06-20-page-suggestion-alignment.md)：页面建议收口计划，先修 M6.1.1 前置输入可用性和死按钮问题。
- [`docs/superpowers/specs/2026-06-20-m6-2-unified-monte-carlo-analysis-design.md`](docs/superpowers/specs/2026-06-20-m6-2-unified-monte-carlo-analysis-design.md)：M6.2 统一 Monte Carlo artifact 和四类 analysis projection 设计。
- [`docs/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md`](docs/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md)：RunIntent、canonical MonteCarloRunConfig、“由建模导入生成示例项目”和静态数据退出边界的 M6.2 后续收敛切片记录。
- [`docs/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md`](docs/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md)：M6.2.x 前台静态业务数据退场、可导入 Project JSON 单一示例源和空态契约实施记录。
- [`docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md`](docs/superpowers/plans/2026-06-21-legacy-run-api-retirement.md)：legacy `/api/simulation-runs` 退场、canonical `/api/runs` 唯一路径和 smoke 测试迁移计划。
- [`docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`](docs/superpowers/specs/2026-06-17-four-level-function-page-design.md)：四级功能页面化设计规格。
- [`docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md`](docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md)：本轮前端集成实现记录。
- [`agent.md`](agent.md)：后续 agent 协作规则和 subagent 使用约定。

## 已覆盖范围

- 前端建模：任务剖面参数、复合任务、周期性任务、基本任务、任务阶段、装备、组件、保障节点、保障活动字段。
- 可靠性框图：树状展示串联、并联、备用关系及组件故障参数。
- 保障活动建模：以树编辑、工作项目清单和节点网络图展示基本保障、使用保障、预防性维修、修复性维修活动。
- 可视化仿真：单次仿真的任务态势、机场保障视图、指标和事件流；Mesa 内部 `Ontology视图`、Ontology Playground 导出和项目级本体校验已从当前产品范围删除。
- 蒙特卡洛实验：已拆分为实验列表、添加/编辑实验和实验详情。实验对象保存 `SimulationExperimentBase` 共享字段、`mc_experiment_id`、关联方案、样本量、随机种子、状态、进度、`run_id`、artifact manifest 和 projection artifact 引用；旧 `monte-carlo-config` hash 兼容到添加/编辑页。
- 仿真实验方案流程：M6.1 已补齐 smoke 输入 mapping provenance、`aviation_support` fail-closed compiler skeleton 和 blocked run status envelope；M6.1.1 已让单次 run 优先从 ExperimentPlan 分支 Project JSON 编译 Scenario；M6.2 已让正式运行收敛到 `RunIntent -> /api/runs -> RunService -> artifacts`，正式 Monte Carlo 通过 `run_type: "monte_carlo"` 基于已编译 Scenario 生成 `monte_carlo_base` artifact 和四类 `analysis_projection_*` artifact。未配置、缺少 compiler provenance 或缺少正式 MC/projection artifact 的分析页只能显示“本地预览，不是正式后端仿真结果”。
- RMS 指标分配：系统管理新增“装备RMS指标分配”本地计算页，使用模拟装备构型和任务剖面，支持调节装备级 R/M/S、MTBF、MTTR、MLDT、Ai/Ao 目标，选择等分配、比例分配、AGREE 和评分分配方法，并展示节点级 RMS target、任务暴露矩阵和自底向上校核；当前发布仅在浏览器内写入模拟装备节点的 `rms.target`，不覆盖 `prediction` 或 `actual`，尚未后端持久化或真实仿真消费。
- 结果分析：备件短板分析、飞机转场携行清单、飞机任务可靠性分析、停机因素分析；每个分析页先进入分析任务列表，支持选择方案和参数后自动创建新的 Monte Carlo 实验并绑定分析任务。M6.2 阶段只有绑定的 `mc_experiment_id`、`run_type: "monte_carlo"`、compiler provenance、`monte_carlo_base` 和对应 `analysis_projection_*` 同时存在时才解锁正式结果，否则显示未配置、待运行、运行中、运行失败或本地预览边界。
- M2a 契约适配：`src/spare_mvp_contract/adapter.py` 已支持 Project JSON 校验、已批准的 `smoke` Scenario 编译、`SmokeSpareMvpModel` 运行、Result summary 和 ArtifactManifest 生成；M6.1 为 `aviation_support` 增加 compiler skeleton 和字段级 fail-closed diagnostics，但仍未解锁正式执行。
- PR-D 数据持久化：`src/spare_mvp_backend/schema.sql` 和 repository helper 已提供 SQLite 版 Project / Scenario / Run / Result / ArtifactManifest 持久化与 `run_id` 身份链查询。
- PR-E 后端 API：`src/spare_mvp_backend/api.py` 提供函数级 Backend API facade，按 Project -> Snapshot -> ExperimentPlan -> Adapter 编译 Scenario -> Mesa 运行 -> Result/Artifact 持久化编排；API 层不自行拼接 Scenario JSON，不改写 Mesa 指标。
- PR-F 前端接入：`front/api-client.mjs` 提供前端 API client，`front/app.js` 的项目保存、实验计划创建、仿真启动、结果摘要和产物读取通过 API client 编排；静态演示结果也封装在 client 内，避免 app 直接生成最终 Scenario 或直接运行本地仿真函数。
- M3-0 真实后端闭环：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py`、`tests/e2e-contract-flow.test.mjs` 和 [`reports/m3-0-real-backend-loop/README.md`](reports/m3-0-real-backend-loop/README.md) 已收束同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest smoke；该闭环仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不代表生产 Web API、worker 或 calibration quality。
- M3-1 浏览器后端闭环：[`reports/m3-1-browser-backend-smoke/README.md`](reports/m3-1-browser-backend-smoke/README.md) 已验证浏览器从同源 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取结果和 artifact manifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
- M4 权限审计 backfill：`users`、`sessions`、`project_access` 和 `audit_events` 已纳入 SQLite schema；`/api/auth/login` 建立本地 M4 会话，`front/api-client.mjs` 会对受保护请求附加 bearer token。建模导入的 save/publish/compile-scenario HTTP 路径要求真实会话，普通用户发布会被后端 `403` 阻断并写入审计；函数级 `BackendApi` 仍保留无 actor 的内部 contract 测试入口。
- M5 数据入口：`contracts/modeling_import.schema.json`、`front/modeling-import-contract.mjs` 和 `tests/modeling-import-contract.test.mjs` 定义建模数据导入/校验 contract；M5.1 已通过本地 `/api/modeling-imports/*`、`BackendApi` 和 SQLite repository 服务化 validation/save/publish/get，覆盖对象 ID、引用关系、非法数值、错误定位和已发布且被运行引用后的覆盖保护。`modeling_imports` 持久化 `draft_payload_json` 与 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照。同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）；M6.2 后续收敛切片把“从 modeling import 生成 imported sample Project draft”作为功能测试和正式 run 的前置入口。项目列表的「从导入数据生成示例项目」在没有已发布包时会先保存并发布示例导入包，再调用 `create-project`。完整 Excel 解析、worker 基础设施和 `aviation_support` 正式执行仍不在本阶段。
- 页面建议收口：`reports/2026-06-19-page-revision-suggestions/README.md` 是当前页面修复输入，已明确保留「建模数据导入」工作台；本收口先修项目列表、系统管理、装备/任务/保障建模的死按钮、字段口径和选择/批量操作问题，为 M6.1.1 单次仿真输入对齐降低数据错配风险，但不直接实现 M6.1.1 或 M6.2。
- M6.0 运行服务边界：`src/spare_mvp_backend/run_service.py` 已承接 run request 校验、ExperimentPlan 绑定 ModelingSnapshot 解析、同步 smoke 执行、status envelope 和结果/产物持久化；HTTP 暴露 canonical `/api/runs`，前端通过 `submitRun()`、`getRunStatus()`、result/artifacts/chain 刷新结果，同时保留 `/api/simulation-runs` 兼容路径。RunService 在当前进程内串行化 run id 生成，并能返回 failed status envelope。该切片仍不是完整 worker 队列、取消、重试、真实批量 Monte Carlo fan-out、对象存储或 `aviation_support` 正式执行。
- M6.1 输入一致性收束：`smoke` Scenario 已带 `compiled_from.mapping_provenance`，`aviation_support` compiler skeleton fail closed 并返回字段级 diagnostics；被 gate 阻断的 run 返回 failed status envelope、无 `result_summary_id`、空 ArtifactManifest。前端 `submitRun()`/API 错误保留 compile gate details，四个结果分析 dashboard 在缺少 compiler provenance 或官方 analysis artifact 时只显示本地预览边界。
- M6.1.1 单次仿真输入对齐：ExperimentPlan config 现在持久化完整分支 `projectJson`，RunService 编译单次 smoke run 时优先使用该分支 Project JSON，并把 `experiment_plan_id`、`modeling_snapshot_id` 写入 mapping provenance；修改分支 seed、组件故障率或保障容量会进入后端 compiled Scenario 和 run artifact。旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。
- M6.2 当前收束：`RunService` 已接受正式 `run_type: "monte_carlo"`，同步本地 smoke 执行器会基于已对齐 Scenario 运行样本、生成 `monte_carlo_base` 和四类 `analysis_projection_*` artifact，并在 run status 中返回 `SimulationExperimentBase` / `mc_experiment_id`。RunIntent / MonteCarloRunConfig / imported sample Project 后续收敛切片的当前口径是：正式 run 由前端 `RunIntent` 保存 Project、创建 Snapshot/ExperimentPlan 后提交 `/api/runs`；正式 MC 数值配置只从 `ExperimentPlan.config.analysisRequests.largeSample -> MonteCarloRunConfig` 解释；功能测试路径应先通过“从导入数据生成示例项目”创建 imported sample Project。`/api/runs` 会由 HTTP 层标记为 `formal_run`，RunService 要求 Project JSON 的 `missionProfile.sourceImportId` 指向已发布 modeling import、`projectId` 匹配，并且后端审计日志存在同一 import/project 的 `modeling_import.create_project` allowed 记录；手工伪造 `sourceImportId` 不能通过 gate。页面内置静态项目只能作为本地预览或 fixture；对该 preview fixture 发起正式 single/Monte Carlo run 时应 fail closed，不得把静态 seed 当作正式输入；旧 `/api/simulation-runs` 兼容路径仍可用于 preview/legacy smoke。该切片仍不是生产 worker queue、object storage、取消/重试、长期 artifact storage、M9 state stream、`aviation_support` 正式执行，也尚未在前端拉取 projection payload 替换本地 KPI 数值；静态分析卡和可视化帧仍分别按后续 M8/M9 计划退出，尚未完成删除。
- M6.2.x 输入源治理已收束：前台建模和正式 run 功能测试的业务示例源已收敛到 `tests/fixtures/modeling_import_project.json`；缺少 imported JSON 数据时页面显示空态或创建入口，不再从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例。该切片只关闭输入源治理，不实现 M8 projection payload 驱动 KPI 或 M9 state stream。

## 本地运行

```bash
npm test
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/front/index.html
```

需要验证 M3-1 浏览器后端闭环时，使用 Mesa-capable Python 环境启动同源前端和 `/api`：

```bash
.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173
```

打开：

```text
http://127.0.0.1:4173/front/
```

## Mesa 烟测

需要 Python 3.10+。本机验证使用 Python 3.12 和 `mesa-abm-skill` runner：

`SmokeSpareMvpModel` 的场景输入来自前端数据模型快照
`scenarios/frontend-project-smoke/project.json`。两个 smoke experiment 只传
`projectJsonPath` 和前端 Monte Carlo 风格的 sweep 参数，不再使用
`equipment_count`、`initial_spare_stock` 等旧标量输入。

```bash
/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/smoke_model.py \
  --config scenarios/spare-planning-smoke/experiment.json \
  --output-dir runs/spare-planning-smoke/latest \
  --install-dir .abm-mesa-test-env

/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/smoke_model.py \
  --config scenarios/mission-reliability-smoke/experiment.json \
  --output-dir runs/mission-reliability-smoke/latest \
  --install-dir .abm-mesa-test-env
```

`runs/` 下的原始 CSV/JSON 输出默认不提交；场景配置和模型代码是可复现实验入口。

## 边界

该原型是可交互、可运行的第一版，不是校准后的工程级仿真平台。小样本结果只能解释“在当前规则和参数下的模型行为”，不能直接声称真实最优方案。
