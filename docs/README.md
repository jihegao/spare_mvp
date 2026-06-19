# 项目文档入口

本目录是 `spare_mvp` 项目的文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 当前开发状态

截至 2026-06-19，当前原型已经具备以下能力：

1. 登录页和登录后的项目列表着陆页。
2. 从项目列表进入功能工作台，左侧按一级、二级、三级组织导航，主区显示四级功能页面。
3. 四级功能页面标题显示三级功能名称；功能页头不显示通用说明文案；非建模页面右上角保留当前方案名称，点击可回到对应模块的仿真实验方案列表。
4. 仿真建模页面不显示右上角“当前方案”卡片；仿真建模和仿真实验页面不再显示“xxx入口”卡片，多四级页面使用紧凑中文标签。
5. 内置场景页面配置机场、任务区的名称、位置、距离等属性；任务类型、重复周期、结束条件等字段归入“任务剖面参数”页面。
6. 基本作战单元建模页面对齐 `vendor/ship_front` 的基本使用单元形态，包含编队需求、成员飞机编号和备用机清单。
7. 基本任务建模页面对齐 `vendor/ship_front` 的基本任务结构树和信息编辑形态，包含任务编号、任务区域、装备数量、任务时长、准备/取消时间和使用保障活动。
8. 任务建模下的任务剖面能力拆为“任务剖面参数”“复合任务建模”“周期性任务建模”：参数页维护任务类型、重复周期和结束条件；复合/周期页对齐 `vendor/ship_front` 的复合任务、周期性任务建模形态，包含复合任务列表、基本任务编排、典型组合任务时序表和周期性任务周历分配。
9. 装备组成建模、装备故障建模页面对齐 `vendor/ship_front` 的装备组成树和属性配置形态；组成页默认进入装备组成建模，只显示装备组成树以及组件名称、父节点、备件类型、连接类型，故障页显示数量、n 中取 k、故障属性和 RMS 指标。
10. 保障组织建模、保障活动建模页面保留外层四级导航，删除内部重复页签；保障组织的备件、人员、设备四级页会跳转到对应资源表，保障活动页面已对齐 `vendor/ship_front` 的树编辑、工作项目清单和网络图形态。
11. 可视化推演页面恢复三级标题“可视化推演”，只保留一个可导航入口并直接嵌入 Mesa 航空保障可视化状态；飞机、任务、保障和 `Ontology视图` 在 Mesa 页面内部切换，旧的场景切换、结果展示 hash 兼容回流到该入口。
12. 蒙特卡洛实验配置页只读展示当前仿真实验，只保留参数配置和“启动”；启动后回到方案列表并显示“运行中”。
13. 蒙特卡洛评估结果已经迁移到“结果分析 / 蒙特卡洛实验结果展示”。
14. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的页面形态。
15. Ontology Playground 导出关系 ID 已加唯一性约束；Monte Carlo 扫参输入会真实更新场景并重算结果。
16. Mesa `Ontology视图` 的后续约定为四层纵向画布：`建模对象 -> 仿真实验 -> 模型实例 -> 计算产物`；建模对象层对齐前端四级功能，模型实例层按 `AviationSupportModel` 的真实 Mesa/Python 运行时对象绘制，并包含当前 step 的指标对象。
17. M2a / PR-C 已增加最小 `SimulationAdapter`：当前支持 Project JSON 根字段校验、`smoke` Scenario 编译、`SmokeSpareMvpModel` 运行、Result summary 和 ArtifactManifest 生成；`aviation_support` Scenario 编译仍需先完成治理批准的字段派生规则。
18. PR-D 已增加 SQLite 数据持久化切片：`schema.sql` 声明项目、用户、方案、建模快照、场景、运行、结果摘要和产物清单表；repository helper 可保存 contract 对象并按 `run_id` 查询版本化身份链。
19. PR-E 已增加函数级 Backend API facade：API 层只编排 Project 校验、项目保存、建模快照、实验计划、Adapter Scenario 编译、Mesa 运行、结果与产物持久化和按 `run_id` 查询，不在前端或 CRUD handler 中生成最终 Scenario。
20. PR-F 已增加前端 API client 接入：`front/api-client.mjs` 定义保存 Project、创建建模快照、创建实验计划、启动仿真运行、读取结果摘要和产物清单的稳定方法；`front/app.js` 通过该 client 编排保存、运行和结果读取，不再直接调用本地仿真函数生成页面结果。
21. M3-0 真实后端闭环已收束：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py`、`tests/e2e-contract-flow.test.mjs` 和 `reports/m3-0-real-backend-loop/README.md` 覆盖同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest smoke；当前仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不等同于生产 Web API、worker 或长期对象存储。
22. M3-1 浏览器后端闭环已验证：`reports/m3-1-browser-backend-smoke/README.md` 记录浏览器从同源 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取结果和 artifact manifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
23. 系统管理新增“装备RMS指标分配”本地计算工作台：使用模拟装备构型和任务剖面，支持页面调节装备级 R/M/S、MTBF、MTTR、MLDT、Ai/Ao 目标，选择等分配、比例分配、AGREE 和评分分配方法，生成任务暴露矩阵、节点级 RMS target、敏感度排名和自底向上校核结果。当前发布操作只在浏览器内写入模拟装备节点的 `rms.target`，不覆盖 `prediction` 或 `actual`，也尚未接入后端持久化、复杂 RBD 数值求解或真实仿真消费。
24. M5 建模数据入口已进入 M5.1 服务化切片：`contracts/modeling_import.schema.json` 定义导入包、草稿/发布生命周期、对象集合、变更和校验问题结构；`front/modeling-import-contract.mjs` 提供纯校验函数，`src/spare_mvp_backend/modeling_import.py` 在后端复用同一语义，`src/spare_mvp_backend/http_server.py` 暴露 `/api/modeling-imports/*` validate/save/get/publish 路径，SQLite `modeling_imports` 表持久化 `draft_payload_json`、`published_payload_json` 和 validation summary。`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照；同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。
25. M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）。该入口消费 M5.1 的显式 API、后端恢复的草稿/发布快照和已发布导入包；该阶段仍不包含完整 Excel 解析、worker 基础设施、权限/审计或 `aviation_support` 编译解锁。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`3概要设计方案.md`](3概要设计方案.md) | 原始概要设计转换稿，是功能范围和术语来源。 |
| [`spare_mvp_rms_allocation_design.md`](spare_mvp_rms_allocation_design.md) | 装备 RMS 指标分配页面的输入设计文档，描述 RMS 口径、分配算法、页面结构、契约和阶段验收。 |
| [`product-roadmap.md`](product-roadmap.md) | 从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。 |
| [`simulation-service-governance.md`](simulation-service-governance.md) | Mesa 仿真服务治理、Claude 对齐规则和 6 类 agent swarm 分工。 |
| [`ontology-mesa-rebuild-plan.md`](ontology-mesa-rebuild-plan.md) | Ontology + Mesa 重构边界、里程碑、当前状态和四层可视化约定。 |
| [`../contracts/README.md`](../contracts/README.md) | Contract Curator Agent 发布的 Project / Scenario / Run / Result / ArtifactManifest schema bundle。 |
| [`../src/spare_mvp_contract/adapter.py`](../src/spare_mvp_contract/adapter.py) | M2a / PR-C 的最小 Simulation Adapter，负责已批准的 Project -> Scenario -> Run/Result/ArtifactManifest 链路。 |
| [`../src/spare_mvp_backend/schema.sql`](../src/spare_mvp_backend/schema.sql) | PR-D 的 SQLite 持久化 schema，用于保存版本化 contract 对象和运行身份链。 |
| [`../src/spare_mvp_backend/api.py`](../src/spare_mvp_backend/api.py) | PR-E 的函数级 Backend API facade，用于稳定 PR-F 前端接入前的保存、运行和结果读取边界。 |
| [`../src/spare_mvp_backend/http_server.py`](../src/spare_mvp_backend/http_server.py) | M3 的本地标准库 HTTP facade，同源服务 `/api` 与 `front/` 静态文件，用于 M3-0/M3-1 真实后端闭环 smoke。 |
| [`../front/api-client.mjs`](../front/api-client.mjs) | PR-F 的前端 API client，用于让静态前端通过后端 API contract 执行保存、运行和结果读取。 |
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
