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
- 装备产品关联：装备系统建模的产品列使用可编辑组合框按 `products[].id/name/model` 实时搜索，键盘或鼠标选择候选后只把精确 `products[].id` 写入 `components[].productId`。没有合适候选时可显式填写名称、型号和类型创建产品，自动 ID 在当前目录内冲突安全；空名称、同名或同型号创建会被阻断，自由文本、取消操作和搜索过程不会修改组件关联或既有产品定义。
- 建模表单管理：产品列表默认展开并支持键盘可达的会话内折叠，折叠和页面重渲染不会清空搜索或未保存的产品编辑状态；带时间单位的字段区按产品列表实际高度紧邻排列，桌面与窄屏均不保留固定占位。该交互只改变本地页面布局，不修改 Project 数据、字段校验、保存流程或 API。
- 可靠性框图：仅在任务可靠度评估模块下作为正式建模页展示，左侧复用装备树；选中“飞机列表”根节点时右侧不显示框图，选中整机或组件时右侧只展示全部直接下一级 RBD 节点且不展示当前选中根节点，`n中取k` 节点以外层并联框展示，并在框内展开 N 个同名分支节点，门逻辑节点保持独立展示；完整绘图契约见 `docs/reliability-block-diagram-contract.md`。
- 保障组织与活动建模：保障组织支持递归树节点；备件记录所属装备，保障人员专业使用下拉字典兼容回退且不再维护所属型号，备件、人员和设备资源表不再依赖行级编辑按钮；基本保障活动通过编辑面板维护活动编号、工作名称、整机适用对象、作业时长分布、人员专业、设备和备件需求，设备/备件按资源唯一标识保存且不再耦合保障组织范围；使用保障、预防性维修、修复性维修和后勤保障的工作项目从基本保障活动库选择/搜索并自动回填，紧前作业通过显式编辑入口维护，修复性维修 MTTR 以装备系统建模 `components[].repairDistribution` 为来源。
- 可视化仿真：导航入口直接进入 Solara iframe 承载的 Mesa 页面，不再经过可视化启动/回放列表页；旧 `visual-start-stop`、`scenario-switch`、`visual-results` hash 兼容到该页面。父页不再提供“刷新推演”，选择已保存 ExperimentPlan 后会先自动同步其分支 Project，再挂载 iframe。Solara 不再渲染重复的默认“可视化推演”标题，重置、推演/暂停、单步推进及间隔设置统一置于内容区顶部。所有任务时间线、提示、详情、状态与日志只显示任务名称和天/波次/机型等业务上下文，缺少名称时显示“未命名任务”；`mission_id`、波次实例 ID 和保障作业 ID 只保留在数据关联与调试字段中。`scripts/start-system.sh` 默认启动平台管理的 Solara 可视化 sidecar（默认 `http://127.0.0.1:8765/`），页面 iframe 可通过 `solaraUrl` 参数或 localStorage 覆盖地址。该 sidecar 只作为交互式可视化承载，不恢复旧 contract provider、`independent-mesa` 旁路、旧 `/api/runs` 运行账本主流程、状态流或 artifact 回放；Monte Carlo 和四个分析页仍以 lite Mesa 会话摘要为用户可见结果来源。Mesa 内部 `Ontology视图`、Ontology Playground 导出和项目级本体校验已从当前产品范围删除。
- 蒙特卡洛实验：导航入口直接进入嵌入的 Mesa 蒙特卡洛分析页，读取当前 Project JSON、样本量和随机种子并在页面内展示主要业务指标的均值、n-1 样本方差、单位和逐指标有效样本数，同时展示总/成功/失败样本数；旧 `monte-carlo-config`、列表和编辑 hash 兼容到该详情页。统计只接收白名单指标中的原生有限数值，失败样本、缺失值、字符串、NaN/Inf、样本身份、日志和调试字段不进入统计，n<2 时样本方差明确不可计算；若有限极值的方差超出 JSON 数值可表示范围，则保留有效样本数、以 `invalid_reason` 标记并显示“不可计算”，不输出 Infinity 或伪造为 0。
- 仿真实验方案流程：ExperimentPlan 继续承载分支 Project JSON、样本量、随机种子和页面会话设置；当前用户可见的运行结果由 `当前 Project -> POST /api/mesa-analysis-runs -> aircraft_support_v1 simulation inputs -> in-memory AircraftSupportV1Model -> lite Mesa 会话摘要` 生成。旧 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> SQLite + artifacts` 账本链路保留为历史实现、内部治理能力和后续持久化运行治理候选，不再作为可视化、Monte Carlo 或四类分析页的用户主流程结果来源。旧 `smoke` 模型、contract provider、smoke scenarios 和 smoke JSON fixtures 已退役删除；`aviation_support` 已从活动 schema、mapping 和 fixtures 删除，adapter 入口仍返回 `retired_model_family` 并指向 `aircraft_support_v1`。`aircraft_support_v1` 是当前正式模型核心；`components[].failureDistribution` 是 behavior-driving 故障分布输入，其他行为驱动字段覆盖机队数量/初始可用、任务波次、组件寿命/RMS/k-out-of-n、`reliabilityBlockDiagram`、`supportResources[]` 人员/设备/备件数量、顶层 `transportPolicies[]`、保障活动 job DAG、周期任务、任务阶段/机场、Monte Carlo sweep 与 seed。后勤保障活动建模页读写 `scenario.transportPolicies`，不再把运输策略保存为 `supportActivities[].transportStrategies`；旧活动级策略仅作为导入/保存兼容来源被提升到顶层。`supportOrganization` 当前批准为 governance-only / 不驱动仿真字段，进入 provenance 而不阻断 M9.6 冻结案例。会话结果是当前规则和参数下的原型分析摘要，不是工程级校准结论。
- RMS 指标分配：系统运行支持模块的“装备RMS指标分配”本地工作台先选择机型并下载/上传安装数数据，再维护任务时长、整机 MTBF 和 MTTR，按等分配、比例分配或相似产品分配规则计算节点权重。引擎以整机故障风险预算换算各节点失效率和 MTBF，并按维修难度缩放节点 MTTR；页面与真实 XLSX 统一展示层级、节点、运行比、失效率、MTBF、MTTR 六列。安装数必须为正整数，运行比必须在 0..1；运行比为 0 的节点不参与风险分配，空结构、零总权重或无效相似基准均失败关闭。页面不提供任务可靠度、目标 R、校核可靠度、MTBCF、MTTR 裕度、保存或发布入口，也不影响装备系统建模中的 MTBF/MTTR 字段。装备系统建模页的模板下载、当前机型导出和文件上传统一位于左侧装备结构树面板，右侧详情面板只保留建模表与编辑器。
- 结果分析：独立“飞机任务可靠性评估”位于“任务可靠度评估”上方。该页面读取当前运行上下文中的飞机型号、基本任务剖面、任务时长、`reliabilityBlockDiagram` 和产品失效分布，用户点击“运行分析”后按 `R(t)=exp(-λt)`、串联乘积、并联 `1-∏(1-Ri)` 与 n 中取 k 动态规划自底向上计算整机可靠度；输入变化只清空旧结果，不静默重算。缺框图、缺关系/参数、无效时长/单位、循环或无效节点均失败关闭；页面只展示整机汇总并导出 XLSX，不提供保存或节点级明细，既有不可变历史快照仍可只读查看。备件短板分析、飞机转场携行清单、飞机任务可靠性评估、任务可靠度评估和停机因素分析五个页面均显示页面标题，并在标题横幅右侧显示运行上下文；四个 lite Mesa 会话页同时保留分析设定、运行状态和显式“运行分析”入口，停机因素页保留排序范围。五页统一把当前已完成、已筛选和已排序的可见快照提交到后端 `/api/analysis-results/export-xlsx`，由 openpyxl 生成包含“分析信息 / 结果摘要 / 结果明细”的真实 OOXML；导出身份绑定在生成结果时的项目或实验方案上，查看缺少方案来源证明的旧飞机可靠性快照时明确标为项目历史记录，不使用当前下拉方案冒充来源。无结果或运行中禁用导出，导出不重跑分析，蒙特卡洛实验页不提供此入口。任务可靠度按完整任务周期判定，`整周期任务可靠度 = 整周期成功实验数 / 已执行实验总数`，与基于产品结构的飞机任务可靠性是不同口径。停机因素按连续停机区间形成唯一事件账本，使用 `备件短缺 > 保障设备短缺 > 装备故障 > 预防性维修` 的直接原因优先级避免重复归类；四类汇总的次数、时长和当前筛选范围占比均从同一完整明细集合计算，页面多选筛选只更新展示而不重新运行仿真。
- M2a/M9.7.4 契约适配：`src/spare_mvp_contract/adapter.py` 当前编译入口只接受 `aircraft_support_v1`；旧 `smoke` 编译/运行实现和 JSON fixtures 已删除，`aviation_support` 也已退出活动 schema/mapping/fixture bundle，adapter 入口继续返回 `retired_model_family` 并指向 `aircraft_support_v1`。M9.7.1 新增 `aircraft_support_v1` 编译 gate、`contracts/aircraft_support_v1_input.schema.json`、Scenario/run schema selector 和 mapping metadata。M9.7.2 到 M9.7.4 的 `/api/runs`、projection、state-series 和 artifact 账本能力保留为历史实现与内部治理能力；当前用户主流程以 lite Mesa 会话摘要为准。
- PR-D 数据持久化：`src/spare_mvp_backend/schema.sql` 和 repository helper 已提供 SQLite 版 Project / Scenario / Run / Result / ArtifactManifest 持久化与 `run_id` 身份链查询；后端仍保留已有飞机任务可靠性项目级不可变快照，当前页面只读历史且不再创建新快照。`reliabilityBlockDiagram` 本身属于建模输入并保留在 clean Project。历史运行账本对象当前定位为历史实现、内部治理能力或后续持久化运行治理候选。
- PR-E 后端 API：`src/spare_mvp_backend/api.py` 提供函数级 Backend API facade。当前用户可见分析通过 `run_lite_mesa_analysis()` / `/api/mesa-analysis-runs` 编译当前 Project 并在内存中运行 `AircraftSupportV1Model` 样本；旧 RunService 编排仍保留但不作为用户主流程结果来源。
- PR-F 前端接入：`front/api-client.mjs` 提供前端 API client，`front/app.js` 的项目保存、实验计划创建和 lite Mesa 会话提交通过 API client 编排；静态演示结果也封装在 client 内，避免 app 直接生成最终 Scenario 或把本地预览描述成正式结果。
- M3-0 真实后端闭环：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py` 和 `tests/e2e-contract-flow.test.mjs` 已迁移到同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest current flow；历史收束证据见 [`reports/m3-0-real-backend-loop/README.md`](reports/m3-0-real-backend-loop/README.md)。该闭环仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不代表生产 Web API、worker 或 calibration quality。
- M3-1 浏览器后端闭环：[`reports/m3-1-browser-backend-smoke/README.md`](reports/m3-1-browser-backend-smoke/README.md) 是历史浏览器验收报告；当前用户可见分析入口接受 `/api/mesa-analysis-runs` + `aircraft_support_v1`，`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
- M4 权限审计 backfill：`users`、`sessions`、`project_access` 和 `audit_events` 已纳入 SQLite schema；`/api/auth/login` 建立本地 M4 会话，`front/api-client.mjs` 会对受保护请求附加 bearer token。建模导入的 save/publish/compile-scenario HTTP 路径要求真实会话，普通用户发布会被后端 `403` 阻断并写入审计；函数级 `BackendApi` 仍保留无 actor 的内部 contract 测试入口。
- M5 数据入口：`contracts/modeling_import.schema.json`、`front/modeling-import-contract.mjs` 和 `tests/modeling-import-contract.test.mjs` 定义建模数据导入/校验 contract；M5.1 已通过本地 `/api/modeling-imports/*`、`BackendApi` 和 SQLite repository 服务化 validation/save/publish/get，覆盖对象 ID、引用关系、非法数值、错误定位和已发布且被运行引用后的覆盖保护。`modeling_imports` 持久化 `draft_payload_json` 与 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照。同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。建模导入范围只通过 `usedTables` 声明，旧校验级别分类不再作为数据契约。当前项目数据管理页已从 sheet 数据源配置收敛为 Project 数据层入口：左侧显示项目列表，`projectInfo.isTemplate` 为真的项目显示【模板】；右侧只保留模板管理（设为模板 / 取消设为模板）和数据概览（任务、装备、保障系统、保障活动），不展示 Project JSON 原始数据。经校验的 JSON 文件选择、覆盖预览、确认覆盖、并发版本冲突和审计能力继续保留。后端 Project 持久化边界会剥离当前 `aircraft_support_v1` 不消费的草稿/预览字段、运行配置和拼写错误字段，例如根 `experiment`、根 `analysisRequests`、`monteCarlo`、`missionProfile.profileType/endCondition/repeatCycleHours`、`missionProfile.analysisRequests`、`supportResourceOverrides`、`deletedSupportResourceKeys`、`supportActivities[].requireDevices`、`supportActivities[].requiredDevices`、`supportActivities[].requiredPersonnel`、`supportActivities[].resourceId` 和保障活动/作业项内的 MTTR 草稿字段；基本保障活动定义持久化在顶层 `supportActivityJobs[]`，`supportActivities[]` 是方案引用层，只保存 `activityName/activityType/planType`、方案约束、`activityCodes[]` 引用和方案内 `predecessors` DAG，`planType` 只使用 `使用保障方案`、`修复性维修方案`、`预防性维修方案`、`后勤保障方案` 四类；lite Mesa 会话的 samples / seed 与 Monte Carlo 数值配置由 `ExperimentPlan.config` 和页面设置承载。项目列表页从这些已标记 Project 模板复制创建项目；旧的内置建模导入模板注册表和下拉选择器已退役。M5 建模导入 API 仍作为后台维护、导入转换和 compile-scenario 能力保留，但普通项目数据管理页不再展示已发布模板列表、模板预览、字段映射或 v1/v2 分类；局部导入入口只保留文件导入、当前项目回灌、内嵌样例恢复、校验、保存、发布和编译维护动作。完整 Excel 解析和 worker 基础设施仍不在 M5 切片内。
- 页面建议收口：`reports/2026-06-19-page-revision-suggestions/README.md` 是页面修复输入；当前项目数据管理入口已改为项目列表、模板管理和数据概览，原始 Project JSON 查看区已移除。本收口先修项目列表、系统管理、装备/任务/保障建模的死按钮、字段口径和选择/批量操作问题，为 M6.1.1 单次仿真输入对齐降低数据错配风险，但不直接实现 M6.1.1 或 M6.2。
- Lite Mesa 当前运行契约：用户可见的 Monte Carlo 和四个结果分析页以 `POST /api/mesa-analysis-runs` 为主路径。请求携带当前 Project 或 ExperimentPlan 分支 Project、分析类型和页面设置；后端编译为 `aircraft_support_v1` simulation inputs，在内存中运行 `AircraftSupportV1Model` 样本，并返回 `session_complete`、指标、表格、事件快照和限制说明。每个样本默认有 60 秒硬上限，整批预算按 `ceil(samples / worker_count)` 个执行波次计算并限制在 180 到 900 秒；前端请求上限使用同一波次口径并额外保留 30 秒响应余量。响应中的请求/完成/失败样本数、样本诊断和编译/执行/聚合/投影耗时用于区分正常长任务、样本失败和超时。可视化推演页只允许从当前 Project 已保存的 ExperimentPlan 中按稳定 `experiment_plan_id` 选择方案，不提供“当前项目”回退；没有方案或选择失效时显示中文空态，不保存 Project，也不启动 iframe。选定方案后，页面自动同步该方案的分支 Project JSON 并挂载 Solara iframe，Mesa 控制器使用方案运行配置直接推进模型；该 iframe 承载不把运行配置写入 clean Project，不创建运行账本，不生成持久化 artifact，也不读取 current-result 面板。#261 的定位与 `case-large` 性能证据见 [`reports/2026-07-18-issue-261-monte-carlo-timeout/README.md`](reports/2026-07-18-issue-261-monte-carlo-timeout/README.md)。
- 旧运行账本路径定位：M6.0 到 M9.7.4 形成的 `/api/runs`、RunService、SimulationRun、ResultSummary、ArtifactManifest、state-stream、control plane、projection payload 和 artifact 下载能力仍保留在代码与测试中，但当前只作为历史实现、内部治理能力和后续持久化运行治理候选。后续如果重新启用账本路径作为用户主流程，必须先更新 `docs/lite-mesa-formal-runtime.md`、本 README、`docs/README.md`、`agent.md` 和对应契约测试。
- 模型与输入边界：`aircraft_support_v1` 是当前正式模型核心；旧 `smoke` 与 `aviation_support` 模型族均已退出活动 schema 和 fixtures，旧模型族 adapter 入口返回 `retired_model_family`。`tests/fixtures/modeling_import_project.json` 是唯一完整业务示例源；缺少 imported JSON 数据时页面显示空态或创建入口，不从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例。
- 阶段 6P 仿真分析验收数据包已收束：`tests/fixtures/case_new.json` 是从前端导出恢复的测试案例基础数据，`tests/fixtures/simulation_analysis_cases/` 只固定 `canonical_platform_case` 这一类 modeling-import-v1 案例；`src/spare_mvp_backend/simulation_analysis_cases.py` 与 `scripts/export-simulation-analysis-cases.py --write|--check` 负责生成和漂移检查；`tests/test_simulation_analysis_cases.py` 只验证该数据可通过 modeling import validation 并编译为 `aircraft_support_v1` Scenario，不再要求 6P canonical 生成正式分析产物。旧的 minimal single-aircraft / frontend project smoke schema 文件已退役。6P 是分析功能前置数据基线，不是生产性能压测。

## 本地运行

当前用户可见运行主线是 `当前 Project -> POST /api/mesa-analysis-runs -> aircraft_support_v1 simulation inputs -> in-memory AircraftSupportV1Model -> lite Mesa 会话摘要`。旧 `/api/runs` 运行账本链路仍保留为历史实现、内部治理能力和后续持久化运行治理候选；旧 contract provider、smoke model、smoke scenarios 和 smoke JSON fixtures 已退役删除；`scripts/start-system.sh` 只启动同源 app/backend 和 SQLite。

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

需要验证同源前端、lite Mesa 会话接口和 Solara iframe 可视化时，使用 `.abm-mesa-test-env` 启动本地系统：

```bash
npm run start:system
```

打开：

```text
http://127.0.0.1:4173/front/
```

Solara 可视化 sidecar 默认同时启动：

```text
http://127.0.0.1:8765/
```

如只需后端/前端而不启动 Solara，可设置 `SOLARA_ENABLED=0 npm run start:system`。

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
