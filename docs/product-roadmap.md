# 产品里程碑路线图

日期：2026-06-22

## 定位

本文档定义 `spare_mvp` 从静态可交互原型走向真实系统的产品里程碑，是当前产品推进顺序的主入口。早期 Ontology + Mesa 重构记录和 Mesa 服务治理文档已归档到 `docs/archive/deprecated/`，仅作为历史背景，不再作为当前产品约束；当前产品、运行时代码和测试门不再维护 ontology 需求。

当前仓库已经具备登录页、项目列表、四级功能导航、建模页、Monte Carlo 配置与结果、结果分析、Mesa 可视化嵌入等原型能力。但页面数量稳定不等于业务流稳定。后续不能直接跳到后端接入，必须先把前端业务语义、最小闭环、数据对象和结果口径冻结下来。

## 路线图硬约束

1. 后端接入前必须先稳定当前原型基线，避免把假按钮、死入口、数据错配固化成 API。
2. 每个页面必须说明输入对象、写入对象、输出对象和结果来源。
3. 项目、方案、场景、运行、结果和产物必须有版本化 schema，不能靠页面临时对象隐式转换。
4. 结果分析和可视化推演最终必须由 `run_id`、数据库记录或 run artifacts 驱动；静态 demo frame 只能作为 fixture 或 fallback。
5. 测试必须覆盖行为，不只检查页面数量、源码字符串或静态结构。
6. 文档不得把静态原型、小样本 Monte Carlo 或 Mesa 烟测描述成工程级校准平台。
7. 早期仿真 ontology 与 contract-first 设想仅作为历史参考；当前数据契约必须以应用系统 schema、Project draft、run identity chain、权限、审计和产物治理为主，active schema 不再引入 ontology 版本字段。
8. `reports/2026-06-19-page-revision-suggestions/README.md` 的页面建议先作为 M6.1.1 前置输入可用性和死按钮收口处理；当前项目数据管理已从独立 M5.2 工作台口径收敛为项目列表、模板管理、数据概览和经校验的 JSON 覆盖，原始 JSON 查看区已移除，页面清理不得顺手扩大为 M6.1.1 或 M6.2。

## 当前基线判断

截至 2026-07-05，M3-1 的历史浏览器验收已被当前 canonical `/api/runs` + `aircraft_support_v1` 主线取代，但整体系统仍处在原型到真实系统迁移阶段。历史记录仍保留：截至 2026-06-19，M3-1 已证明同源后端浏览器闭环可行，但该证据不再代表现行模型族或运行入口。

1. 四级功能页面化和核心静态工作台已经稳定，M0/M1 浏览器 smoke 可作为后续后端接入的对照基线。
2. `src/spare_mvp_backend/http_server.py`、`BackendApi`、`SimulationAdapter` 和 SQLite repository 已跑通同源 `/api` + `Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest` 真实后端闭环，并已通过浏览器刷新恢复和 API 不可用阻断验收。
3. 前端已有 `front/api-client.mjs` 边界，显式保存、启动运行、读取结果和读取产物通过 API client 表达；通用建模编辑仍保持本地，直到显式保存或运行。
4. Monte Carlo 页面仍保留本地预览能力，但正式产品运行主线已通过 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts` 收敛到后端同步本地切片；尚未升级为生产 worker 或长期批量运行产物管理。
5. Mesa 可视化页已嵌入本地航空保障状态；产品口径已删除 Mesa 内部 `Ontology视图`、Ontology Playground 导出和 repo 根目录 ontology 产物。M9.4/M9.5 的 `aviation_support` 路径已作为历史阶段归档；当前正式 `/api/runs`、前端 run shortcut 和 modeling import compile 入口只接受 `aircraft_support_v1`。
6. 本地 M4 backfill 已补入最小用户、会话、建模导入授权和审计边界；完整用户管理、项目级权限矩阵、SSO、运行管理、长期 artifact storage 和生产 Web API 还没有真实系统实现。
7. 2026-06-19 页面走查建议正在收口：优先处理项目列表、系统管理、装备/任务/保障建模页面中的死按钮、字段口径、选择/批量操作和 M6.1.1 输入风险；「建模数据导入」入口保留。
8. 旧 contract provider、smoke model、smoke scenarios 和 smoke JSON fixtures 已退役删除；默认产品运行只依赖同源 app/backend、SQLite 和 canonical `/api/runs` 产物。

## M0：稳定当前原型基线

目标：冻结当前前端原型的可用业务路径，先修顺功能语义，再考虑后端接入。

核心工作：

1. 修正可视化推演下的入口可达性，保证四级入口与 Mesa 页面内部运行/状态能力一致，并移除 Mesa 内部 Ontology 视图的产品依赖。
2. 验证 Monte Carlo 实验选择、样本数、故障率、备件倍数、保障容量等配置是否真实生效。
3. 修正携行清单、短板分析、可靠度和停机因素等结果页的风险等级、指标解释和数据来源显示。
4. 检查登录、项目列表、方案列表、建模页、Monte Carlo 配置、Monte Carlo 结果、结果分析、Mesa 可视化的完整路径。

完成标准：

1. 核心路径无死入口、无假按钮、无明显数据错配。
2. 页面数量、导航可达性和业务流转同时稳定。
3. `npm test` 覆盖关键前端契约，必要时补充浏览器烟测记录。

## M1：冻结 MVP 业务闭环和验收口径

目标：把“页面看起来像”升级为可验收的最小业务闭环。

最小闭环：

```text
用户选择项目 -> 维护项目建模数据 -> 创建实验方案 -> 启动仿真/Monte Carlo
-> 查看运行状态 -> 查看结果产物 -> 导出/归档报告
```

核心工作：

1. 为每个页面标注输入对象、写入对象、输出对象。
2. 为每个结果页标注结果来源：实时运行、缓存结果、导入结果或示例数据。
3. 定义 MVP 验收清单、页面到数据对象映射、结果指标口径说明。
4. 明确哪些能力属于 MVP，哪些只是后续系统化能力。

完成标准：

1. 有稳定的 MVP 验收清单。
2. 页面到数据对象映射完整覆盖核心路径。
3. 指标口径能解释备件短板、携行清单、任务可靠度、停机因素和 Monte Carlo 聚合结果。

## M2：定义真实数据契约和版本化 schema

目标：让前端概念成为真实系统可持久化、可迁移、可校验的数据契约。

核心对象：

| 对象 | 用途 |
| --- | --- |
| `Project` | 项目、资料、权限和版本聚合根。 |
| `ExperimentPlan` | 仿真实验方案、参数组和运行配置来源。 |
| `Scenario` | 后端仿真可消费的场景输入。 |
| `ModelingObject` | 任务、装备、保障组织、保障活动、备件、指标方案等建模对象。 |
| `SimulationExperimentBase` | 单次仿真实验和 Monte Carlo 实验共享的运行对象契约，包含实验身份、方案、Scenario identity、随机种子、状态、进度、`run_id` 和 artifact 引用。 |
| `SingleSimulationExperiment` | 单次或交互式仿真记录，复用公共实验字段并扩展状态帧或交互会话信息。 |
| `MonteCarloExperiment` | 批量 Monte Carlo 实验记录，复用公共实验字段并扩展样本量、sweep、样本批次、聚合结果和 projection artifact。 |
| `SampleResult` | 单样本运行结果。 |
| `AggregateResult` | 聚合指标、分布统计和对比结果。 |
| `ArtifactManifest` | 输入、配置、日志、结果、报告等产物索引。 |
| 用户与权限对象 | 账号、角色、项目访问范围和操作权限。 |

核心工作：

1. 每个对象定义 `schema_version`、必填字段、引用关系、校验规则和迁移策略。
2. 明确 `project JSON`、`scenario JSON`、`run JSON`、`result JSON` 的边界和转换规则。
3. 将 `scenario`、`experiment`、`monteCarlo`、`runs`、`summary` 等前端概念收敛为正式对象。
4. 定义导入、保存、发布、运行、归档过程中对象版本如何变化。
5. 不再把 M2 拆成可见的 `Simulation/Ontology Contract` 与 `Application Data Contract` 双轨。M2 统一收敛到应用数据契约：Project、ModelingObject、Scenario、SimulationRun、Result、ArtifactManifest、用户权限、审计和迁移策略；ontology 不再是当前 schema 或运行链路的一部分。

完成标准：

1. 数据对象关系图和 schema 草案完成。
2. 关键对象可用 JSON Schema 或等价校验规则验证。
3. 页面临时对象不能绕过数据契约直接驱动后端运行。
4. 后端应用 API 能校验一个最小项目数据样例，并通过当前受支持的 adapter 编译出后端仿真可消费的 `Scenario`。

## 已过期：仿真契约先行开发模式（Simulation-Contract-First Development）

> 状态：已过期。该模式来自早期 Ontology + Mesa 重构和 agent swarm 分工设想，相关治理文档已移动到 `docs/archive/deprecated/`。当前产品路线不再要求先建设独立 Simulation Contract Service，也不再把 Mesa ontology 作为可见产品视图或主契约入口。

目标：先让仿真模型和 ontology 成为可执行契约提供者，再用 TDD 推进前端、数据库和后端 API 对接。

推荐结构：

```text
仿真模型 / ontology
        ↓
Simulation Contract Service
        ↓
前端 TDD / 数据库 TDD / API TDD
```

### 契约服务职责

`Simulation Contract Service` 是仿真侧面向应用系统的稳定边界。它可以先是本地进程、CLI wrapper 或轻量 HTTP 服务，后续再并入正式后端。

建议能力：

1. `GET /contracts`：返回当前 schema version、实体定义、字段约束、关系约束、指标定义和 artifact 类型。
2. `POST /validate/project`：校验项目建模数据，返回字段路径、对象 ID、引用关系和错误级别。
3. `POST /compile-scenario`：把已校验项目数据编译成仿真可运行的 `Scenario`。
4. `POST /runs`：提交单次仿真或 Monte Carlo 运行。
5. `GET /runs/{run_id}`：查询运行状态、输入版本、随机种子、进度和失败原因。
6. `GET /runs/{run_id}/artifacts`：返回结果摘要、指标口径和 artifact manifest。

### TDD 推进顺序

1. 契约测试先行：提交一个最小项目 JSON，契约服务必须能校验并生成 `Scenario`。
2. 数据库测试跟进：数据库必须能保存同一个 `Project`、`ExperimentPlan`、`Scenario`、`SimulationRun`、`ArtifactManifest`，并保留 schema version。
3. 前端测试跟进：用户修改建模表单后，提交的数据能通过契约服务校验；启动运行后能拿到真实 `run_id`。
4. 端到端测试闭环：导入数据 -> 保存项目 -> 创建方案 -> 编译场景 -> 启动运行 -> 查询结果 -> 展示分析页。

### Subagent 使用边界

可以开启 subagent 做仿真服务切片、运行烟测、补契约测试或持续观察仿真输出，但 subagent 不是正式服务边界。正式服务必须是普通可启动进程，例如 `python -m ...`、`uvicorn`、CLI wrapper 或后续 worker 进程；主线程仍负责合并契约、复核测试和决定数据口径。

### 边界风险

1. 不要把 ontology 误当作完整业务数据库 schema。ontology 负责领域结构，应用 schema 负责生命周期、权限、审计、版本和产物治理。
2. 不要让前端绕过契约服务直接拼后端 `Scenario`。前端可以编辑项目数据，但场景编译口径应由契约服务统一。
3. 不要让仿真模型隐式新增字段。新增输入、输出或指标时，必须同步更新契约版本和测试样例。
4. 不要先实现大而全后端。先用契约服务把 M2/M3/M6 的最小闭环跑通，再扩展正式 API、DB 和 worker。

## M3：后端 API 与数据库落地

目标：建立原型到真实系统的持久化分水岭。

M3-0 历史收束：M3-0 函数/API smoke 已完成本地标准库 HTTP facade + Backend API 的真实后端闭环 smoke，证据见 `reports/m3-0-real-backend-loop/README.md`。该归档证据只证明当时的 `/api`、Backend API facade 和 repository 能完成保存、编译、运行、结果、产物和身份链读取；它不代表现行模型族、生产 Web API、worker 队列、长期对象存储或权限体系。

M3-1 当前收束：已完成浏览器同源后端闭环 smoke，证据见 `reports/m3-1-browser-backend-smoke/README.md`。该归档证据证明前端可从 `/front/` 通过 `/api` 保存项目、启动历史 smoke run、读取 Result/ArtifactManifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时不再生成 `offline-demo-run`。现行正式运行入口只接受 `aircraft_support_v1`。

核心 API：

1. 契约查询与版本查询。
2. 项目数据校验。
3. 项目数据到 `Scenario` 的编译。
4. 项目 CRUD。
5. 方案 CRUD。
6. 建模数据保存。
7. 场景生成。
8. 运行提交。
9. 运行状态查询。
10. 结果查询。
11. 产物下载。
12. 用户登录与基础会话接口。

正式后端应通过当前受支持的 `SimulationAdapter` 或后续 worker 边界编排仿真运行，并必须把 schema version、scenario version、run_id 和 artifact manifest 持久化下来。

数据库最小覆盖：

1. 项目。
2. 用户。
3. 方案。
4. 建模快照。
5. 运行记录。
6. 结果摘要。
7. artifact metadata。

大产物处理：

1. 样本日志、时间序列、导出 JSON、报告等文件型产物可以先放对象存储或本地 artifact 目录。
2. 所有文件型产物必须有 manifest。
3. 数据库必须能索引 run、输入版本、结果摘要和产物位置。

完成标准：

1. 刷新浏览器、换设备、重新登录后，项目和方案仍然存在。
2. 运行结果可追溯到输入项目版本、方案版本和场景版本。
3. API 不依赖前端内存状态才能解释结果。
4. 后端保存的数据能通过应用 schema 重新校验，并能经受支持的 adapter 重新编译出同版本 `Scenario`。

## M4：真实用户、权限和审计

目标：把 demo 登录升级为真实账号、角色和审计体系。

核心工作：

1. 支持账号密码或统一身份认证。
2. 支持角色权限和项目访问控制。
3. 支持操作审计、登录状态过期和敏感操作确认。
4. 将按钮可见性、操作范围和项目可见性与权限绑定。

建议角色：

| 角色 | 权限范围 |
| --- | --- |
| 系统管理员 | 管理用户、项目、运行资源和系统配置。 |
| 数据管理员 | 维护项目建模数据，导入、清洗、发布项目资料。 |
| 普通评估用户 | 创建方案、启动运行、查看结果和导出报告。 |

完成标准：

1. 不同角色看到的项目、按钮和操作范围不同。
2. 关键操作有审计记录。
3. 未授权访问被后端阻断，而不只是前端隐藏按钮。

当前 backfill 口径：M5.1/M5.2 已先行落地后，本阶段补入本地 M4 最小边界。SQLite 已包含用户、会话、项目访问和审计事件表；`/api/auth/login` 返回 bearer token；建模导入 save/publish/compile-scenario 的 HTTP 路径要求真实会话。数据管理员和系统管理员可以保存/发布建模导入，普通用户发布会被后端 `403` 阻断并记录审计。该 backfill 仍不是完整用户管理、密码重置、SSO、生产权限矩阵或试点部署安全方案。

## M5：建模数据从页面表单升级为可校验项目数据

目标：让建模页成为真实项目资料维护和场景生成入口，而不是静态表单集合。

当前推进口径：M5 数据入口曾在跳过 M4 的前提下先行推进；当前 M4 backfill 已补入本地会话、角色和审计边界，因此 M5 的 save/publish/compile-scenario HTTP 路径必须带 M4 bearer token。M5 首片不做完整 Excel UI；先定义建模数据导入/校验 contract、错误定位结构、草稿/发布版本和运行引用保护。M5.1 将该 contract 接入本地后端 API、SQLite 持久化和前端 API client。当前项目数据管理页以 Project 数据层为入口：左侧项目列表显示【模板】标记，右侧只保留模板管理和数据概览，不展示 Project JSON 原始数据；经校验的 JSON 文件选择、覆盖预览、确认覆盖、并发版本冲突和审计能力继续保留。项目列表页从已标记 Project 模板复制创建项目；旧的内置建模导入模板注册表和下拉选择器已退役；建模导入范围只通过 `usedTables` 声明；项目数据管理页不再展示已发布模板列表、模板预览、字段映射、v1/v2 分类或旧校验级别分类。M5 建模导入 API 仍作为后台维护、导入转换和 Scenario 编译能力保留。M5.3 把建模页当前数据保存为后端 Project draft，同时保留概要设计中的 `仿真实验方案管理` 作为 ExperimentPlan 分支工作流。

核心工作：

1. 首片先支持 JSON fixture 或简化 CSV 导入/校验；Excel 作为后续导入适配层。
2. 支持字段清洗、引用校验、对象增删改。
3. 支持版本保存、差异对比、草稿/已发布状态。
4. 支持错误定位，并通过 Simulation Adapter 生成后端可消费的 `Scenario`。
5. 校验任务、装备、保障组织、保障活动、备件、指标方案之间的引用关系。

必须阻断的问题：

1. 悬空引用。
2. 重复编号。
3. 非法数值。
4. 缺失必填字段。
5. 已发布对象被运行记录引用后被无痕覆盖。

完成标准：

1. 用户可以从真实项目资料导入或维护一个项目。
2. 系统可以从已发布项目数据生成后端可消费的 `Scenario`。
3. 错误提示能定位到字段、对象和引用路径。

当前首片实现入口：

1. `contracts/modeling_import.schema.json` 定义导入包、草稿/发布生命周期、对象集合、变更和校验问题结构。
2. `front/modeling-import-contract.mjs` 校验重复编号、悬空引用、非法数值和已发布且被运行引用后的覆盖保护。
3. `tests/modeling-import-contract.test.mjs` 和 `tests/fixtures/modeling_import_project.json` 固化 JSON fixture 首片，不包含完整 Excel UI、生产 worker、Mesa 行为变更或 `aviation_support` Scenario 编译解锁；权限审计由当前 M4 backfill 作为独立边界补入。

M5.1 服务化入口：

1. `src/spare_mvp_backend/modeling_import.py` 提供服务端纯 Python 校验器，保持与前端 contract issue shape 一致。
2. `src/spare_mvp_backend/schema.sql` 和 `ContractRepository` 增加 `modeling_imports` 持久化，用于保存 `draft_payload_json`、`published_payload_json`、validation summary、草稿/发布状态和引用保护信息。
3. `BackendApi` 和本地 HTTP facade 暴露 `validate/save/get/publish` 路径；`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，前端 `api-client` 只新增显式调用方法，不从通用编辑事件自动保存。
4. M5.1/M5.2 明确同一 `import_id` 被 run 引用后不可再发布覆盖；发布后保存新草稿会保留已发布快照并形成可恢复差异。该切片选择“新版本使用新 `import_id`”，暂不引入 `(import_id, import_version)` 复合主键。

项目数据管理入口：

1. 系统管理 / 项目管理 / 项目数据管理展示左侧项目列表；`projectInfo.isTemplate` 为真的项目显示【模板】。
2. 右侧只保留模板管理和数据概览，不展示 Project JSON 原始数据或递归查看器；模板管理提供“设为模板 / 取消设为模板”，并写回 Project JSON。写回时必须同步 `projectInfo.isTemplate`、`projectInfo.is_template`、顶层 `isTemplate` 和顶层 `is_template`；读取时以 `projectInfo.isTemplate` 为首选 canonical 字段，避免旧兼容字段使取消操作反弹。
3. 数据概览只显示任务、装备、保障系统、保障活动四类计数；数据管理入口保留 JSON 文件选择、校验、覆盖预览和确认覆盖，后端继续处理并发版本冲突与审计。
4. 项目列表页只从已标记 Project 模板复制创建项目；旧的内置建模导入模板注册表和下拉选择器不再使用。
5. 普通项目数据管理页不再提供建模数据源配置、sheet 选择器、已发布模板列表、模板预览、字段映射或 v1/v2 分类。
6. 建模导入 save/publish/compile-scenario 仍是后台维护和导入转换能力；局部导入入口只保留文件导入、当前项目回灌、内嵌样例恢复、校验、保存、发布和编译维护动作；当前切片仍不包含完整 Excel 解析、worker 基础设施、Mesa 行为变更或 `aviation_support` 编译解锁。

### M5.3 建模草稿持久化与实验方案分支

目标：把建模页的项目数据保存为后端 Project draft，同时保留概要设计中的 `仿真实验方案管理`。ExperimentPlan 是从 Project 复制出的可编辑仿真分支，编辑方案不影响项目数据；方案编辑页可以维护 Project JSON path 覆盖项、固定/随机 base seed 策略和样本量，并在保存时生成可复现的 ExperimentPlan config。运行仿真和 Monte Carlo 时使用选中的方案保留可复现 run identity chain。

边界：

1. Project draft 持久化只负责当前项目建模数据的保存与恢复，不替代 `方案列表` 和 `方案编辑`。
2. `data-save-plan` 属于 ExperimentPlan 分支保存动作；通用建模字段编辑使用 Project draft 保存路径。
3. 创建或运行 ExperimentPlan 时从当前 Project 建模快照复制配置，方案编辑状态不回写 source Project；`scenarioComposition` 记录覆盖路径和覆盖值，覆盖后的 `config.projectJson` 才作为方案分支输入。
4. `seedPolicy`、steps、samples、`analysisRequests.largeSample` 和 Monte Carlo sweep 归 `ExperimentPlan.config` 所有，不进入持久 Project JSON。
5. 本阶段不扩大 M4 用户、会话、授权或审计范围，也不把 Project 数据层模板标记或 M5 建模导入 API 扩展为完整 Excel UI。

## M6：仿真引擎服务化

目标：把前端 JS 重算和本地 Mesa 状态帧升级为后端服务或 worker 运行。

推进方式：以正式后端 API + worker + artifact storage 为目标演进；开发期可以继续使用本地 adapter 和 smoke model 做可脚本化验证，但不再要求先建设独立 `Simulation Contract Service`。

M6.0 当前收束：已新增 `RunService` 与 canonical `/api/runs`，把当前同步 run 包装成可轮询的运行服务边界。前端启动运行后先拿 `run_id`，再查询 status/result/artifact/chain；旧 `/api/simulation-runs*` 已退役并返回 `410 legacy_run_api_retired`。RunService 在当前进程内串行化 run id 生成，并能在执行器失败后返回 failed status envelope。该首片仍使用本地同步执行器，不包含完整 worker 队列、取消、重试、超时、资源隔离、真实批量 Monte Carlo fan-out 或长期 artifact storage。

M6.1/M9.4 当前收束：输入一致性与 Scenario 编译 gate 已落地为窄闭环。`Frontend Project / ExperimentPlan -> Scenario compiler / adapter mapping -> Mesa simulation input` 是可审计边界：`smoke` 和 `aviation_support` Scenario 都带 `compiled_from.mapping_provenance`，记录 consumed/defaulted/derived/ignored/unsupported 字段；未知模型族或无效 Project 仍会返回 failed run status envelope，`error.details.issues` 和 `error.details.provenance` 可供前端展示。前端四个结果分析 dashboard 在缺少 compiler provenance 或官方 analysis artifact 时只显示“本地预览，不是正式后端仿真结果”，不能把 `singleResult` 局部推导包装成正式后端结果。

M6.1.1 当前收束：单次仿真输入已经从“ExperimentPlan 绑定 snapshot + steps”收敛为“ExperimentPlan 清理后的分支 Project JSON + runtime config -> Scenario compiler”。前端创建实验方案时把建模分支 `projectJson` 写入 plan config，并把 steps / samples / seed 保留在 ExperimentPlan runtime config；RunService 编译当前正式单次 run 时优先消费该分支 Project JSON，并把 `experiment_plan_id`、`modeling_snapshot_id` 写入 mapping provenance。当前正式模型族为 `aircraft_support_v1`，历史 smoke 单次路径只保留为低层回归证据。修改分支组件故障率或保障容量会进入后端 Scenario input 和 run artifact；修改 seed 会进入 runtime config 而不是 Project；旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。

M6.2 当前收束：统一 Monte Carlo / analysis profile 已落地为同步本地执行切片，并补齐单次仿真实验与 Monte Carlo 实验的对象一致性。基于 M6.1/M6.1.1 已对齐的 Scenario 跑样本，产出统一 MC artifacts；`monte_carlo_base` 是基础 artifact，“备件短板”“携行清单”“任务可靠度”“停机因素”是同一 artifact 的 `analysis_projection_*`。单次仿真实验与 Monte Carlo 实验共享 `SimulationExperimentBase` 的 `experiment_id`、`experiment_type`、关联方案、Scenario identity、随机种子、状态、进度、`run_id` 和 artifact 引用；Monte Carlo 实验保存 `mc_experiment_id`、样本量、sweep、聚合结果和 projection artifact，正式 MC 调度不再伪装成 `run_type: "single"`。#117 后四个结果分析页改为 current result 主流程：用户从页面直接运行当前分析，后台可保留 AnalysisTask / MonteCarloExperiment / run / artifact 作为内部追溯，但主界面不展示任务列表、绑定 MC、artifact/run 选择器或历史结果列表；未运行、运行中、运行失败、缺少 compiler provenance、`monte_carlo_base`、projection artifact、payload 或 payload 类型不匹配时不渲染正式结果图表。

M6.2 后续收敛切片已完成：`docs/archive/deprecated/superpowers/plans/2026-06-20-runintent-mc-config-imported-sample-project.md` 记录了 RunIntent、MonteCarloRunConfig 和 imported sample Project 的实施边界。正式产品运行入口已收敛为 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`；正式 Monte Carlo 数值配置只允许从 `ExperimentPlan.config.analysisRequests.largeSample` 生成 `MonteCarloRunConfig`，request-level MC numeric config 会被拒绝；Adapter 不再从 Project draft 或 legacy request params 猜测 MC sweep，缺少 normalized config 或收到 legacy params 时 fail closed；项目数据管理页只维护项目选择、模板标记、概览和经校验的 JSON 覆盖，不提供原始 JSON 查看。`/api/runs` formal gate 基于持久 Project JSON 的 `missionProfile.sourceImportId`、已发布 import/projectId 匹配和 `modeling_import.create_project` allowed 审计记录 fail-closed，手工伪造来源不能进入正式 run；正式和预览测试运行提交、查询、结果、产物和身份链都只走 canonical `/api/runs` 路径。`defaultScenario`、`runSimulation` 和 `runMonteCarlo` 仍可作为离线 fixture、本地预览和测试 fallback，但不能作为正式结果来源。该收束仍不是生产 worker queue、object storage、完整取消/重试或长期 artifact storage；M8.0 已完成 projection payload 驱动四个分析页正式 KPI，M9.0/M9.1 已完成离线 `visualization_state_series` artifact 回放、状态序列契约和事件追溯，M9.2 已完成最小在线状态流订阅，M9.3 已完成最小 run lifecycle/control plane，M9.4/M9.5 的 `aviation_support` 能力已归档，当前正式模型族由 M9.7.3+ 的 `aircraft_support_v1` formal Monte Carlo/projection 承接。

Project JSON 持久化字段边界在当前实现中进一步收窄：保存和后端读取路径会剥离 `aircraft_support_v1` 不消费的草稿/预览字段与运行配置，包括根 `experiment`、根 `analysisRequests`、`monteCarlo`、`seedPolicy`、`scenarioComposition`、`missionProfile.profileType`、`missionProfile.endCondition`、`missionProfile.repeatCycleHours`、`missionProfile.analysisRequests`、`supportResourceOverrides`、`deletedSupportResourceKeys`、字面拼写错误的 `supportActivities[].requireDevices` 以及活动方案层的 `supportActivities[].requiredDevices`、`supportActivities[].requiredPersonnel`、`supportActivities[].resourceId`、`supportActivities[].planGroupId`。该边界描述后端保存与读取契约，不表示前端提供原始 JSON 查看器。`supportActivities[]` 保留方案引用和约束；修复性/预防性方案以 `maintenanceMethods` 与 `replacementRatio` 成对持久化，历史缺省为非换件和 0，修复性非换件显示“原位维修”，预防性非换件显示“检查/保养”。页面比例为 0–100% 且最多两位小数，内部为 0–1 且最多四位小数；旧 `repairType` 只允许修复性方案精确迁移，且不复用 `repairTypes` 或组件特殊维修比例。Scenario 编译保留组件/机型作用域，维修事件按维修种类和发生序号使用独立确定性随机子流；换件作业启动前对全部正数量备件进行原子校验和扣减，零数量明确表示无需求，短缺事件仅在短缺状态变化时追加。`planType` 归一为 `使用保障方案`、`修复性维修方案`、`预防性维修方案`、`后勤保障方案`，资源需求与作业定义归 `supportActivityJobs[]` / `supportResources[]`；#307 基本保障活动 CSV 不承载方案维修比例。正式运行仍保留 `missionProfile.sourceImportId`、`modelingImportValidation`、`scenarioId`、`schema_version`、`project_version` 等门禁/身份/溯源字段；steps / samples / seed、固定/随机 base seed 策略、Project JSON path 覆盖记录与 `analysisRequests.largeSample` 的正式 Monte Carlo 数值配置继续归 `ExperimentPlan.config`、`RunIntent` 和 `MonteCarloRunConfig` 所有，不能回流成 Project 模型输入。

#305 已把飞机寿命前置数据接入正式行为：三项 canonical 值是上次预防维修后的累计日历日、飞行小时和起落循环，缺失历史值默认 0；不迁移 `takeoffLandingCount`、要求小时或剩余小时。适用预防性维修方案的三个 interval 是唯一正式阈值来源，`0/null` 禁用；正累计值缺阈值、作用域未知、单位非法或同维阈值冲突均按精确路径失败关闭。Scenario 在运行前派生一致的初始可用数、到期标记、阈值与全部 `due_dimensions`；minute=0 只建一个 preventive 工单，普通初始维修状态不误建。单次、Monte Carlo、lite Mesa 与 Solara 共用同一初始化状态，结果和状态帧保留 `initial_life_state` 追溯。原始 import fixture 的全寿命起落计数保持原样且不驱动 pre-life。

M6.2.x 当前收束：`docs/archive/deprecated/superpowers/plans/2026-06-21-imported-json-single-source-static-data-exit.md` 记录前台静态业务数据退场实施。前台建模和正式 run 功能测试的业务样例源已收敛到 `tests/fixtures/modeling_import_project.json`：页面缺少 imported JSON 数据时显示空态或创建入口，不再由前端静态常量偷偷补出任务、装备、保障组织、保障活动或 Monte Carlo 配置；完整 JSON 导入后可通过 published modeling import 生成 imported sample Project。后端 `modeling_import_to_project()` 已保留 `projectInfo`、`supportOrganization` 和显式空集合，`objects.analysisRequests` 与 `objects.missionProfiles[].experiment` 只进入 ExperimentPlan/runtime config，不进入 Project。该切片只治理建模/运行输入源；在线状态流由 M9.2 的 run subscription 切片提供。

M6.2.y 运行 API 退场收束：legacy `/api/simulation-runs` 已从正式和预览测试路径退役；前端 API client、HTTP contract tests 和浏览器 smoke 只使用 canonical `/api/runs` 及其 status/result/artifacts/chain 路径。旧路径返回 `410 legacy_run_api_retired`，用于让外部调用者明确迁移到 `/api/runs`。该切片只清理 run API 兼容层；生产 worker queue、object storage 和取消/重试仍是后续运行基础设施。

M7.0 当前收束：运行与产物管理已在 canonical `/api/runs` 上形成本地管理闭环，覆盖 run list/detail、artifact id 下载、归档、软删除、生命周期状态和最小审计事件。前端在 Monte Carlo 详情中展示运行账本、artifact identity、`sha256`、`size_bytes`、下载入口、归档状态和软删除 tombstone。该切片只管理本地 SQLite 运行账本、artifact manifest 和 repo-local artifact 文件，不恢复 legacy `/api/simulation-runs`；生产 worker queue、object storage 和取消/重试完整体系仍非本阶段目标。

核心能力：

1. 单次仿真。
2. 输入一致性编译 gate。
3. 固定随机种子。
4. 参数 sweep。
5. 运行取消。
6. 运行超时。
7. 错误重试。
8. 资源隔离。
9. 运行日志。
10. 统一 MC artifact 与 analysis projection。

完成标准：

1. 前端点击启动后，后端创建 run。
2. 单次仿真和 Monte Carlo 样本创建前都先通过模型族 Scenario compiler；无法编译时返回字段级错误并阻断正式结果。
3. worker 或本地执行器只消费编译后的 Scenario input，不读取前端当前 draft。
4. 前端轮询或订阅运行状态。
5. 最终结果来自真实 run artifacts，且能追溯 mapping version、输入版本、运行配置和 seed。
6. M6.2 提供同步本地 Monte Carlo artifact/projection 与 RunIntent/MonteCarloRunConfig 收敛切片；M7.0 已补入本地运行与产物管理，M8.0 已补入 projection payload 驱动的正式分析 KPI 展示，M9.0/M9.1 已补入离线状态序列回放、状态契约和事件追溯，M9.2 已补入 run-scoped 在线状态流订阅，M9.3 已补入最小后端确认 run control，M9.4/M9.5 的 `aviation_support` 路径已归档，当前正式模型族为 `aircraft_support_v1`。生产级 worker、完整取消/重试、对象存储和 checkpoint restart 仍留给后续阶段。
7. 正式 Monte Carlo 输入现在只有一个 canonical `MonteCarloRunConfig` 解释层，页面默认示例项目可以由已发布建模导入包生成；继续扩大 worker、在线 state stream 或 KPI payload 消费前，不应重新引入 request-level MC numeric config。

## M7：运行管理和产物管理

目标：系统能回答每次运行的来源、参数、结果和产物。

M7.0 当前收束：`docs/archive/deprecated/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md` 和 `docs/archive/deprecated/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md` 已把本阶段限定在 canonical `/api/runs` 运行账本和 artifact 账本管理。当前能力包括运行列表、运行详情、artifact id 下载、归档、软删除、下载/归档/删除审计，以及前端展示 artifact id/hash/size/lifecycle 状态；旧 `legacy /api/simulation-runs` 仍保持退役。M7.0 不包含生产 worker queue、object storage、取消/重试完整体系或 `aviation_support` 正式执行。

必须可追溯的问题：

1. 谁在什么时候启动了运行。
2. 使用哪个项目版本。
3. 使用哪个方案和参数。
4. 使用哪个随机种子。
5. 输出了哪些结果文件。
6. 失败原因是什么。

建议 artifact manifest：

```text
input.json
run_config.json
sample_results.jsonl
aggregate_result.json
events/logs
metrics.csv
report.json 或 report.html
```

完成标准：

1. 每次运行都有唯一 `run_id`。
2. 结果能下载、复现、归档和删除。
3. 失败运行能看到失败原因和错误日志。
4. 本地 run/artifact 管理通过 canonical `/api/runs` 完成，legacy `/api/simulation-runs` 只保留 `410 legacy_run_api_retired` 负向契约。

## M8：结果分析从演示图表升级为产物驱动

目标：所有分析页都随真实运行产物变化，并能追溯计算来源。

M8.0 当前收束：`docs/archive/deprecated/superpowers/specs/2026-06-21-m8-projection-payload-analysis-design.md` 已把结果分析推进到 projection payload 驱动，#117 后产品主流程进一步收敛为每个分析页一个 current result record。前端通过 current result 面板触发当前页正式运行；后端 `/api/projects/{project_id}/analysis-results/{analysis_type}` 从正式 `aircraft_support_v1` Monte Carlo run 中校验 compiler provenance、`monte_carlo_base`、当前分析类型 `analysis_projection_*`、payload JSON、`projection_type` 和 traceability，校验通过后才返回 `completed/formal_backend`。缺少任一正式条件、payload 类型不匹配或解析失败时统一 fail closed，不能用静态演示图表或本地 preview 冒充正式结果。

阶段 6P 当前收束：在四个分析功能继续细化前，已恢复 `tests/fixtures/case_new.json` 作为仿真分析验收数据包基础数据，并由它生成 `tests/fixtures/simulation_analysis_cases/canonical_platform_case.json` 这一类 modeling-import-v1 案例。该数据包由 `src/spare_mvp_backend/simulation_analysis_cases.py` 和 `scripts/export-simulation-analysis-cases.py --write|--check` 生成与检查，`tests/test_simulation_analysis_cases.py` 只验证该数据可通过 modeling import validation 并编译为 `aircraft_support_v1` Scenario，不再要求跑出 formal Monte Carlo、`monte_carlo_base`、`visualization_state_series` 或四类 `analysis_projection_*` artifact。旧的 minimal single-aircraft 与 frontend smoke Project JSON schema 已退役；6P 用于覆盖平台标准案例，不作为生产性能压测。

核心工作：

1. 备件短板、携行清单、任务可靠度、停机因素、Monte Carlo 聚合结果来自 run artifacts 或数据库聚合。
2. 支持结果版本、指标解释、样本数、置信区间或分布统计。
3. 支持异常样本查看、参数组对比和导出报告。
4. 明确每个指标的计算公式、输入字段、聚合窗口和样本范围。

完成标准：

1. 换一组真实运行结果后，所有分析页随产物变化。
2. 页面能显示结果来源、run_id、输入版本和指标口径。
3. 前端硬编码或局部推导不能作为正式结果来源。

## M9：可视化推演接入真实运行状态

目标：Mesa 可视化页从静态状态帧和前端回放升级为平台管理的 Solara iframe，由 Solara/Mesa 控制器直接推进 `aircraft_support_v1` 模型；旧状态序列和在线状态流保留为历史账本能力。

分阶段目标：

### M9.0：离线状态序列回放

目标：先把可视化页从内置 demo frame 推进到 `run_id + artifact_id` 驱动的真实运行回放，不引入在线推送或生产 worker。

当前收束：历史 smoke / `aviation_support` run 已写出的 `visualization_state_series` artifact 可保留为归档回归证据；当前 formal run 只允许 `aircraft_support_v1` single/formal Monte Carlo 写出新的状态序列，artifact manifest schema 已允许该 kind。前端 Mesa 可视化页可从已完成 run 选择 `run_id`，按 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载并校验 payload，用本地时间轴播放、暂停、单步、重置或拖动。缺少状态序列 artifact、payload 类型不匹配、`run_id` 不一致或解析失败时继续 fail closed；内置 demo frame 只保留为本地预览和空态示例。M9.1 已在此基础上补齐状态序列契约和事件追溯；M9.2 已在同一帧契约上补入在线状态流订阅；M9.3 已补入后端确认的最小 run control；M9.7.2/M9.7.3 已补入 `aircraft_support_v1` single/formal Monte Carlo 状态序列。

范围：

1. 后端正式 run 完成后写出 canonical `visualization_state_series` artifact。
2. 状态序列每帧必须包含 `run_id`、时间步或仿真时间、飞机状态、任务状态、资源状态和事件摘要。
3. 前端 Mesa 可视化页按 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载状态序列，并用时间轴回放。
4. 页面提供播放、暂停、单步、重置和时间轴拖动；这些控制只作用于前端回放，不控制后端执行器。
5. 缺少状态序列 artifact、payload 类型不匹配或解析失败时 fail closed；内置 demo frame 只能作为本地预览或空态示例，不能作为正式完成口径。

完成标准：

1. 选择某个已完成 run 后，可视化页展示该 run 的真实状态序列。
2. 页面可显示状态来源、`run_id`、artifact id、时间步范围和事件数量。
3. 切换不同 run 时，状态轨迹随 artifact 变化。

### M9.1：状态序列契约和事件追溯

目标：把 M9.0 的状态帧固化为可测试 contract，并补齐事件日志追溯。

当前收束：`contracts/visualization_state_series.schema.json` 已纳入 contract bundle；状态序列 payload 记录 `result_summary_id`、`artifact_manifest_id`、run config/input project/compiled Scenario artifact id，每帧记录 `trace`，每个事件记录 `event_id`、`run_id`、`step`、`event_type` 和 `metric_refs`。`visualization_state_series` manifest entry 必须带 `source_run_id`、`source_result_summary_id` 和 `source_scenario_id`。前端 replay adapter 会校验事件引用并生成跨帧 event stream，可视化页展示事件追溯列表并支持点击事件定位到对应帧；事件流不从 demo frame 生成正式事件。

范围：

1. 增加状态序列 schema fixture 和契约测试，覆盖帧结构、时间步单调性、run identity、事件引用和状态字段类型。
2. 后端 artifact manifest 标记状态序列的 kind、schema version、sha256、size bytes 和来源 run。
3. 前端在可视化页展示事件流列表，并能从时间轴定位到对应事件。
4. 状态序列必须能追溯到运行输入、compiled Scenario identity、run result 和 artifact manifest。

完成标准：

1. 状态序列 schema 和 fixture 纳入自动测试。
2. 任一可视化帧都能解释其来源 run、时间步和事件摘要。
3. 状态序列不再依赖前端静态常量补业务数据。

### M9.2：在线状态流和运行订阅

目标：在离线回放契约稳定后，引入按 `run_id` 订阅的状态流；当前同步本地执行器先提供可订阅的状态序列流，生产 worker 的真实运行中增量推送留给后续运行基础设施。

当前收束：M9.2 在线状态流已通过 run-scoped SSE `GET /api/runs/{run_id}/state-stream` 落地在当前同步执行器边界上。后端从同一 run 的已持久化 `visualization_state_series` payload 输出 `run_status`、逐帧 `state_frame` 和最终 `artifact_ready` 事件；`state_frame` 复用 `visualization_state_series` 的帧结构和 traceability 字段，`artifact_ready` 后仍通过 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载最终 artifact 并走同一 replay adapter。前端 Mesa 可视化页支持订阅运行、停止订阅、断线/重连提示、未授权提示、失败提示和最终 artifact 回放切换；在线帧只用于展示当前流状态，不解锁本地播放/单步/重置控制。M9.3 已把取消、重试和不支持控制的 fail-closed 反馈接入后端确认控制面；M9.4/M9.5 的 `aviation_support` 正式路径已归档，当前正式模型族由 `aircraft_support_v1` 承接；生产 worker queue、真实运行中增量推送和 object storage 仍只在被运行控制或模型族执行最小需要时纳入对应阶段。

范围：

1. 通过 SSE 或 WebSocket 暴露按 `run_id` 订阅的状态流。
2. 在线流与离线状态序列使用同一帧 schema；运行结束后仍写入可下载 artifact。
3. 前端支持按 run 订阅、断线提示、重连后的状态恢复和最终 artifact 回放切换。
4. 运行控制只接入后端明确支持的能力；未支持的暂停、单步、重置必须显示不可用，而不是在前端伪造。

完成标准：

1. 可视化页能按后端状态流更新当前帧；当前同步执行器先输出已持久化状态序列，生产 worker 的实时增量推送另行实现。
2. 在线流结束后生成的 artifact 与回放页面使用同一解析路径。
3. 断线、失败和未授权订阅都有明确 UI 状态和测试覆盖。

### M9.3：Run lifecycle 和后端运行控制

目标：把 M9.2 的只读订阅推进到可审计 run lifecycle/control plane。M9.3 只管理运行生命周期、后端确认的控制动作、审计和 UI 状态反映；`aviation_support` 正式执行由 M9.4 独立解锁。

当前收束：M9.3 已通过 canonical `POST /api/runs/{run_id}/control` 落地最小控制面。`cancel` 会以后端确认为准把 run 转为 `cancelled`，`retry` 会把 failed/cancelled run 转回 `queued` 并阻断旧 result/artifact 的正式读取；retry-pending 或 cancel-after-retry 的 run detail 返回 pending 空 artifact manifest，不暴露旧正式产物。`pause`、`resume`、`step`、`reset` 目前明确 fail closed 并写入 denied 审计。前端 Mesa 控制区显示 M9.3 后端控制状态，只在 `controlRun()` 返回后更新状态或停止订阅；本地播放、单步、重置仍只作用于已加载的离线 `visualization_state_series` 回放。

范围：

1. 明确 canonical `/api/runs` 的运行状态机和控制状态转换；`queued`、`running`、`succeeded`、`failed`、`cancelled` 之外是否新增 `pausing`、`paused`、`cancelling` 或 `retrying`，必须通过 contract/test 固化。
2. 增加后端控制请求边界，例如 cancel、retry、pause、resume、step 或 reset；每个动作必须由后端确认后才改变正式 run 状态。
3. 每个控制动作必须写入审计事件，并能从 run detail、run chain 或审计查询中追溯 actor、action、outcome、时间和失败原因。
4. M9.2 的 SSE 继续作为状态展示通道，但 M9.3 负责“控制动作 -> 后端状态确认 -> 在线状态/前端按钮状态”的闭环。
5. 不支持的控制能力必须 fail closed，并在前端显示不可用原因；不得用本地回放索引、demo frame 或前端计时器伪造后端暂停、单步、恢复、重置或重试。
6. 状态快照如在本阶段保留，只能作为 run artifact 或 checkpoint 查看上下文；不能作为新的正式仿真输入，除非后续阶段定义 restart contract。
7. 生产 worker queue、object storage、完整 cancel/retry 基础设施、checkpoint restart 和真实运行中暂停/单步只在后续阶段最小需要时纳入；M9.3 不夹带 `aviation_support` 正式执行。

完成标准：

1. 支持的运行控制都经过后端确认，并有审计记录和可查询的 run 状态变化。
2. 前端按钮状态、SSE 状态和 run detail 对同一个 `run_id` 给出一致生命周期结论。
3. 不支持的控制能力保持 fail closed，测试覆盖不得把本地回放控制误认为后端控制。
4. M9.3 完成时只交付控制面；`aviation_support` 正式执行由 M9.4 的独立 contract 和测试解锁。

### M9.4：aviation_support 正式执行和后端输出对齐（历史归档）

历史收束：在 run lifecycle/control 边界稳定后，M9.4 曾解除 `aviation_support` 的 `unsupported_model_family` gate，让航空保障模型族进入 `RunService -> SimulationAdapter -> artifacts` 单次正式执行路径，并对齐 result、projection、state-series、artifact manifest 和 run chain 的后端输出语义。2026-06-26 起该模型族已从正式和 adapter 编译运行入口退役；2026-07-16 起也不再保留于活动 schema、mapping 和 fixtures，新的 formal run 必须使用 `aircraft_support_v1`。

范围：

1. 已批准并实现 `Project/ExperimentPlan -> aviation_support Scenario` 字段派生规则；所有字段必须标注 consumed、derived、ignored、defaulted 或 unsupported，并写入 compiler provenance。
2. `SimulationAdapter` 支持 `AviationSupportModel` 单次正式运行；不得通过前端 demo、contract provider 快照或静态 fixture 冒充正式执行。
3. `result.schema.json` 的 `aviation_support` 分支、run result、artifact manifest、run chain 和 `visualization_state_series` 必须使用同一组 `run_id`、scenario identity、schema version、seed 和 traceability 字段。
4. aviation 输出指标要与 smoke 指标保持语义隔离；不得把航空保障指标强行归一到 smoke metric family，也不得让结果分析页用本地推导补正式 KPI。
5. aviation projection payload 的输入 artifact 是本次 `result_summary` artifact；指标口径来自 `AviationSupportModel.snapshot()`，样本范围是单次正式 run，缺失时 fail closed。
6. 前端正式态只在 aviation run 具备 compiler provenance、result summary、artifact manifest、state-series artifact 和对应 projection artifact 时解锁；缺任一正式产物时显示阻断或本地预览边界。
7. M9.4 不重新设计 run lifecycle/control；它消费 M9.3 已确定的 `/api/runs`、审计和状态展示边界。

完成标准：

1. `model_family=aviation_support` 的正式 run 不再走 `unsupported_model_family`，并能产出可下载、可追溯、schema 校验通过的后端 artifacts。
2. 同一个 aviation `run_id` 的 result、projection、state-series、artifact manifest 和 run chain 能相互校验 identity 与 traceability。
3. 前端切换 smoke 和 aviation run 时，正式结果和可视化状态均随 artifact 变化，不回退到 demo frame 或前端局部推导。
4. smoke 路径当时回归保持通过，aviation 解锁不改变既有 Monte Carlo/projection 口径；`aviation_support` Monte Carlo 后续由 M9.5 定义受治理采样契约并解锁，当前 adapter 入口已统一退役。

### M9.5：aviation_support formal Monte Carlo（历史归档）

历史收束：M9.5 在 M9.4 单次正式执行基础上定义受治理的航空保障采样契约，让 `model_family=aviation_support`、`run_type=monte_carlo` 通过 canonical `/api/runs -> RunService -> SimulationAdapter -> artifacts` 路径执行。2026-06-26 起该路径不再是正式或测试入口；`model_family=aviation_support` 和 `model_family=smoke` 在 formal entrypoints 返回 `retired_model_family`，replacement 为 `aircraft_support_v1`。

范围：

1. `aviation_support` formal Monte Carlo 必须先通过 `Project/ExperimentPlan -> aviation_support Scenario` compiler provenance，再由受治理采样契约解释样本数、LRU 故障倍率、备件倍数和保障容量 sweep；兼容字段 `failureRates` 在航空保障路径中表示 LRU hazard multiplier，不是绝对失效概率；`sample_count` 必须覆盖全部 Cartesian sweep 点，超出的样本才按确定性顺序重复。
2. `monte_carlo_base` payload 必须标记航空保障采样 contract version、`model_family`、`run_id`、样本数量和样本结果，四类 `analysis_projection_*` artifact 从该 base artifact 派生。
3. 成功 run 必须同时暴露 result、artifact manifest、run chain 和 `visualization_state_series`，并在 HTTP `/api/runs/{run_id}`、`/result`、`/artifacts`、`/chain` 上保持同一组 identity。
4. 缺少 imported sample gate、compiler provenance、normalized MonteCarloRunConfig、projection artifact 或 state-series artifact 时继续 fail closed，不回退到前端 demo 或静态 fixture。
5. M9.5 不实现生产 worker queue、object storage、完整 cancel/retry 基础设施、checkpoint restart、真实运行中暂停/单步或新的 auth/audit scope。

完成标准：

1. 历史完成时 HTTP `/api/runs` 能提交 `model_family=aviation_support`、`run_type=monte_carlo` 的 formal run，并返回 succeeded status；当前入口已退役并返回 `retired_model_family`。
2. 产物清单包含 `monte_carlo_base`、四类 `analysis_projection_*`、`visualization_state_series`，且 projection 来源指向 base artifact。
3. result、status、artifact manifest 和 chain 不再出现 `unsupported_model_family`，并能用同一个 `run_id` 和 Scenario identity 串联。

### M9.6：平台案例数据包和字段覆盖冻结（已完成）

目标：按平台数据结构配置一套完整飞机保障案例数据，并形成后续正式模型族的唯一验收输入。该阶段已冻结数据、导出和覆盖口径，不实现新的仿真动力学，也不把 `independent-mesa` 结果当作正式平台结果。

范围：

1. 以 `tests/fixtures/case_new.json` 为基础，整理一套完整案例包，覆盖任务剖面、复合任务、周期任务、飞机/装备层级、LRU/SRU 故障与 RMS 字段、保障组织、保障资源、库存、运输策略、保障活动作业网络、Monte Carlo 配置和四类分析请求。
2. 从案例包导出平台对象链：published modeling import、Project、ModelingSnapshot、ExperimentPlan、RunIntent、MonteCarloRunConfig 和预期 Scenario fixture。
3. 建立字段覆盖表，逐字段标注 `consumed`、`derived`、`defaulted`、`ignored` 或 `unsupported`，并说明目标模型模块、默认规则和不支持原因。
4. 建立 golden fixture：预期 compiled Scenario、单次 run artifact kind 列表和 Monte Carlo artifact kind 列表；`visualization_state_series` 基本结构和四类 `analysis_projection_*` payload 结构继续由既有 M9.1/M9.5 schema 与 adapter 测试约束。
5. 固化导出/漂移检查：案例包、前端 demo fixture、平台 Project draft 和预期 Scenario 之间不得出现静默业务字段漂移。

完成标准：

1. 同一套案例数据可以从平台导入、保存、发布、生成 Project、创建 ExperimentPlan，并通过后端校验。
2. 字段覆盖表覆盖案例包全部业务字段，且没有未解释的隐式丢弃。
3. 测试能证明缺少 imported JSON 时继续 fail closed，不从 `defaultScenario`、preview fixture 或 `independent-mesa` 副本静默补业务数据。

完成记录：M9.6 平台案例数据包、字段覆盖表和 golden fixtures 已落地为 `tests/fixtures/m9_6_platform_case_export.json`、`tests/fixtures/m9_6_field_coverage.json` 和 `tests/fixtures/m9_6_expected_artifact_kinds.json`，由 `src/spare_mvp_backend/m9_6_case_package.py` 与 `scripts/export-m9-6-case-package.py` 生成和检查。后续修改 canonical import fixture、导出链路、adapter provenance 或 artifact kind 时，必须显式更新这些 golden fixtures。

### M9.7：完整飞机保障仿真模型族

目标：利用 `simulation-skills` 工作流搭建新的正式飞机保障仿真模型族，吸收两版 `independent-mesa` 的设计要素，消费 M9.6 案例包全部项目配置数据，并通过 `SimulationAdapter` 进入平台正式运行链路。

范围：

1. 新模型族必须是平台正式 `model_family`，由 `SimulationAdapter.compile_scenario()` 和 `SimulationAdapter.run_scenario()` 调用；不得作为第三套旁路 HTTP 页面长期存在。
2. 机制设计吸收历史 `independent-mesa/GLM` 的全字段消费、领域模块拆分、Monte Carlo sweep 和四类分析思路，也评估历史 `independent-mesa/GPT` 中更好的状态表达、调度或可视化方案；吸收的是机制和验收要素，不直接保留旁路入口。当前源码树已删除这两套 retired 旁路实现。
3. 模型结构采用 Mesa 外壳加领域模块：任务调度、飞机 agent、装备树与故障、保障活动 DAG、保障资源/库存/运输、可靠性框图、RMS/维修性/保障性指标、Monte Carlo 采样和状态帧导出。
4. 每个输入字段必须按 M9.6 覆盖表进入模型行为、派生规则、默认规则、governance_only、明确忽略或明确 unsupported；M9.7.4 后 M9.6 已冻结业务字段不得仍为 unsupported，新增字段必须同步更新覆盖表、Scenario schema 和测试 fixture。
5. 单次正式 run 必须产出 `result_summary`、`artifact_manifest`、`visualization_state_series`、metrics/report/log 和 run chain；Monte Carlo 必须产出 `monte_carlo_base`、四类 `analysis_projection_*` 和 state-series。
6. 固定 seed 必须可复现；随机 sweep 必须记录样本数、参数组合、seed、失败样本和聚合口径；模型结果只能解释当前规则和参数下的行为，不声称工程校准结论。

当前收束：M9.7.4 已在 M9.7.1 `aircraft_support_v1` schema/compiler gate、M9.7.2 single-run core 和 M9.7.3 formal Monte Carlo/projection 后完成 coverage hardening。`src/spare_mvp_abm/aircraft_support_v1/` 提供 `AircraftSupportV1Model`，内部使用 `tick_minutes=1`、`sample_every_minutes=30` 和固定阶段顺序推进；`SimulationAdapter.run_scenario()` 和 `SimulationAdapter.run_monte_carlo_scenario()` 可通过 canonical `/api/runs` 执行 `aircraft_support_v1` Scenario，产出 result summary、artifact manifest、run chain、metrics、report、log、四类 projection、`monte_carlo_base`、样本失败账本和 `visualization_state_series`。行为驱动字段包含机队数量/初始可用、任务波次、`components[].failureDistribution`、组件寿命/RMS/k-out-of-n、`reliabilityBlockDiagram`、`supportResources[]` 人员/设备/备件数量、`transportPolicies[]`、保障活动 job DAG、周期任务、任务阶段/机场、Monte Carlo sweep 与 seed；仿真时长优先取周期任务显式排程的最后有任务日，没有显式任务日时才按周期任务配置天数 × 重复次数推导，`durationHours` 只作为缺少周期任务时的回退；`supportOrganization` 已批准为 governance-only / 不驱动仿真字段并写入 provenance。M9.7.4 将 M9.6 frozen 字段 coverage 中的 unsupported 汇总关闭为 0。

完成标准：

1. `model_family=<new_aircraft_support_family>` 的 single 和 Monte Carlo run 均通过 canonical `/api/runs` 成功执行，并能下载全部正式 artifacts。
2. 同一个 run 的 result、projection、state-series、artifact manifest 和 chain 能用 `run_id`、Scenario identity、schema version 和 seed 相互校验。
3. 缺字段、非法引用、未来新增 unsupported 字段族、缺 compiler provenance、缺 projection 或缺 state-series 时 fail closed，不回退到前端 demo 或 `independent-mesa` 静态输出。
4. 历史 `aviation_support` 和 smoke 产物/schema 口径保持兼容，新模型族不改变既有正式 artifact 口径；当前 `aviation_support` adapter/formal 入口返回 `retired_model_family`。

### M9.8：嵌入平台并退役 independent-mesa

目标：把 M9.7 的正式模型族嵌入平台可视化仿真、Monte Carlo 和四类分析页面，并退役 `independent-mesa` 旁路服务和产品入口。

范围：

1. 前端可视化仿真页通过平台管理的 Solara iframe 承载 Mesa 页面，由 Solara/Mesa 控制器直接推进 `aircraft_support_v1`；不跳转到 `independent-mesa/server.py`，也不提交用户主流程 `/api/runs`。
2. 旧状态回放、`/api/runs/{run_id}/artifacts/{artifact_id}`、`visualization_state_series` 和 `/api/runs/{run_id}/state-stream` 只保留为历史账本/内部治理能力；四类分析页继续消费 lite Mesa session payload。
3. Solara 页面直接读取模型当前状态展示任务、飞机、资源和事件；旧前端任务计划表、每日甘特图和状态序列解析不再作为可视化推演主承载。
4. `independent-mesa/GLM` 和 `independent-mesa/GPT` 的源码树、旁路服务和静态输出入口从当前仓库移除；历史参考只保留在归档计划和规格文档中，不再保留离线复现实验命令。
5. 删除或标记过期所有把 `independent-mesa`、静态 HTML 输出、旧 contract provider 或 `/api/runs` 当作当前用户主流程的 README、roadmap、agent 约束、测试和启动脚本引用；`8765` 仅允许作为平台管理的 Solara iframe 默认端口出现。
6. 浏览器 smoke 覆盖完整平台流：导入案例数据、创建方案、打开 Solara iframe 可视化、启动 Monte Carlo、查看四类 lite Mesa 分析结果。

完成标准：

1. 正式平台流程中搜索不到对 `independent-mesa` 服务地址或静态输出目录的运行依赖；如有引用，只能是归档说明、迁移记录或离线开发参考。
2. `scripts/start-system.sh start` 启动默认产品所需的同源 app/backend、SQLite 和 Solara iframe sidecar，不再强制启动 `independent-mesa/server.py`，也不启动旧 contract provider sidecar。
3. 可视化推演主工作区由 Solara iframe 承载，前端不再以本地时间轴播放 `visualization_state_series`。
4. 从平台入口完成 M9.6 案例的 Solara 可视化、Monte Carlo 和四类分析，且分析结果来源都是 lite Mesa session payload。

当前收束：M9.8 已完成平台嵌入和 `independent-mesa` 退役。可视化仿真页嵌入平台管理的 Solara iframe，Solara/Mesa 控制器直接推进 `aircraft_support_v1`；Monte Carlo 和四类分析页通过 `/api/mesa-analysis-runs` 读取 lite Mesa session 指标、表格和事件摘要。旧 `/api/runs`、artifact state-series、state-stream 和 run control 保留为历史账本/内部治理能力，不作为用户主流程。旧 `smoke` 执行路径、contract provider、scenarios 和 fixtures 已退役删除；`aviation_support` 已从活动 schema、mapping 和 fixtures 删除，正式、测试和 adapter 编译运行入口统一返回 `retired_model_family` 并指向 `aircraft_support_v1`。`scripts/start-system.sh start` 默认启动平台同源 app/backend、SQLite 和 Solara 可视化 sidecar；脚本不启动 `independent-mesa/server.py` 或旧 contract provider。`independent-mesa/GLM` 与 `independent-mesa/GPT` 源码树、旁路服务和静态输出入口已从当前仓库移除；历史设计记录只保留在 `docs/archive/deprecated/superpowers/` 的归档计划和规格中。

## M10：工程质量和自动化测试

目标：建立真实系统所需的测试矩阵和持续集成质量门。

测试矩阵：

1. 单元测试。
2. schema 校验测试。
3. API 集成测试。
4. 前端 E2E。
5. 仿真确定性测试。
6. 导入样例测试。
7. 运行产物一致性测试。
8. 权限测试。
9. 回归数据集。

必须补齐的行为测试示例：

1. 修改 Monte Carlo 样本数后结果样本数变化。
2. 导入非法项目 JSON 时显示字段错误。
3. 删除被引用对象时被阻断。
4. 使用不同角色登录时按钮和 API 权限不同。
5. 同一 seed 和输入版本能复现运行摘要。

完成标准：

1. 主分支 CI 能稳定跑通核心测试。
2. 关键路径有 E2E 覆盖。
3. 测试不只检查源码字符串，而是验证用户行为、数据变化和产物一致性。

## M11：部署、配置和运维

目标：让系统具备可部署、可回滚、可定位问题的运行环境。

核心工作：

1. 区分开发、测试、预生产、生产环境。
2. 建立配置文件和密钥管理方式。
3. 支持数据库迁移。
4. 建立日志、监控、错误追踪。
5. 支持备份恢复、版本发布和回滚方案。
6. 为耗时仿真建立任务队列和 worker 资源管理。

最小部署组合：

```text
Web API + DB + worker + artifact storage + frontend static hosting
```

完成标准：

1. 能一键部署到测试环境。
2. 数据库迁移可重复执行。
3. 运行失败可定位。
4. 版本可回滚。

## M12：试点验收和真实用户闭环

目标：用真实项目资料验证端到端业务闭环。

建议试点：

1. 选择 1 到 2 个典型项目资料。
2. 覆盖导入数据、校验建模对象、创建方案、运行单次仿真、运行 Monte Carlo。
3. 覆盖短板、携行、可靠度、停机因素、报告导出和同一运行复现。

试点流程：

```text
导入数据 -> 校验建模对象 -> 创建方案 -> 运行单次仿真 -> 运行 Monte Carlo
-> 查看短板/携行/可靠度/停机因素 -> 导出报告 -> 复现同一运行
```

完成标准：

1. 业务用户能独立完成流程。
2. 专家能接受指标解释。
3. 开发团队能复现问题和结果。

## 推荐推进主线

### 主线一：产品与数据契约

覆盖：M0、M1、M2。

这条主线先完成原型基线、MVP 闭环、页面数据映射和版本化 schema。它是后端、仿真运行和权限系统的前置约束。

M2 采用应用数据契约先行：先冻结 Project、ModelingObject、Scenario、Run、Result、ArtifactManifest 和权限审计对象，再决定哪些仿真 adapter 能消费这些对象。

### 主线二：后端与仿真运行

覆盖：M3、M5、M6、M7、M9。

这条主线负责把项目资料、方案、场景、运行和产物落到真实系统。M5 虽然编号在 M4 后，但会反向影响 M2/M3 的数据契约和数据库设计，应尽早并行细化。

M3/M6 的第一步不是直接建设完整生产平台，而是把保存、编译、运行、结果和 artifact identity chain 接成可测试的本地后端闭环，再逐步替换为 worker 化运行。

### 主线三：工程化与上线

覆盖：M4、M8、M10、M11、M12。

这条主线负责权限、分析产物化、测试矩阵、部署运维和试点验收。M10 不是后期才开始的单点任务，而是从 M0 起持续累积，到 M10 阶段补齐完整 CI 和回归体系。

## 阶段依赖

| 依赖 | 说明 |
| --- | --- |
| M0 -> M1 | 只有核心路径无死入口、无假按钮后，MVP 闭环验收才有意义。 |
| M1 -> M2 | 页面输入、写入、输出和结果来源明确后，才能冻结真实数据契约。 |
| M2 -> M3 | API 和数据库必须围绕版本化对象设计，不能直接复制前端临时状态；应用 schema、Project draft、Scenario 编译和 run identity chain 必须先形成可测试闭环。 |
| M2/M3 -> M5 | 建模数据导入、校验、发布会反向修正 schema 和持久化设计。 |
| M3/M6 -> M7 | 只有真实 run、契约版本、worker 产物和 artifact manifest 存在后，运行管理才能闭环。 |
| M7 -> M8/M9 | 结果分析和可视化推演必须消费 run artifacts 或 run_id 状态序列。 |
| M4/M10/M11 -> M12 | 试点前必须具备权限边界、质量门、部署和问题定位能力。 |

## 近期建议

1. 保持 M3-1/RMS 浏览器后端闭环、RMS 分配页面、测试和证据报告一致。
2. M4 backfill 当前只覆盖本地用户、会话、建模导入授权和审计；后续若进入试点，需要继续补项目级访问控制、权限矩阵、密码/SSO 和部署安全。
3. M5.1 已将建模数据导入/校验 contract 接入本地后端 API、SQLite 持久化和前端显式 API client。
4. 项目数据管理当前聚焦项目列表、模板标记、数据概览和经校验的 JSON 覆盖，不展示 Project JSON 原始数据；M5 建模导入 API 继续作为后台导入转换能力，完整 Excel UI 或生产 worker 仍不在本阶段。
5. RunIntent / MonteCarloRunConfig / imported sample Project 收敛已作为 M6.2 后续切片完成；M7.0 已补入本地运行/产物管理，M8.0 已补入 projection payload 消费，M9.0/M9.1 已补入离线状态序列回放、状态契约和事件追溯，M9.2 已补入在线状态流和运行订阅，M9.3 已补入最小 run lifecycle、后端控制、控制审计和 UI 状态确认，M9.4/M9.5 的 `aviation_support` 正式执行与 formal Monte Carlo 已归档，当前正式路径只接受 `aircraft_support_v1`。生产 worker、object storage、完整 cancel/retry、checkpoint restart 和真实运行中暂停/单步只在对应阶段最小需要时纳入。
6. M9.6 已完成平台案例数据包、字段覆盖表、导出链路和 golden fixtures 冻结；M9.7 已完成 `aircraft_support_v1` 正式飞机保障仿真模型族、single run、Monte Carlo 和 coverage hardening。
7. M9.8 已完成平台嵌入和 `independent-mesa` 退役；平台通过 Solara iframe 承载可视化推演，通过 `/api/mesa-analysis-runs` 完成 Monte Carlo 和四类分析，`independent-mesa` 旁路源码树已从当前仓库移除。
8. 2026-06-27 TODO 阶段 2 已完成保障组织、资源表和基本保障活动库收敛；后续阶段 3 才迁移仿真实验、可视化与结果承载信息架构，不应把阶段 2 的页面编辑收敛扩大为结果页重构。
9. 每次 PR 更新页面流转、数据对象或结果口径时，同步更新本文档或相关验收清单。
