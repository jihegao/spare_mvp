# 产品里程碑路线图

日期：2026-06-20

## 定位

本文档定义 `spare_mvp` 从静态可交互原型走向真实系统的产品里程碑，是当前产品推进顺序的主入口。早期 Ontology + Mesa 重构记录和 Mesa 服务治理文档已归档到 `docs/archive/deprecated/`，仅作为历史背景，不再作为当前产品约束。

当前仓库已经具备登录页、项目列表、四级功能导航、建模页、Monte Carlo 配置与结果、结果分析、Mesa 可视化嵌入等原型能力。但页面数量稳定不等于业务流稳定。后续不能直接跳到后端接入，必须先把前端业务语义、最小闭环、数据对象和结果口径冻结下来。

## 路线图硬约束

1. 后端接入前必须先稳定当前原型基线，避免把假按钮、死入口、数据错配固化成 API。
2. 每个页面必须说明输入对象、写入对象、输出对象和结果来源。
3. 项目、方案、场景、运行、结果和产物必须有版本化 schema，不能靠页面临时对象隐式转换。
4. 结果分析和可视化推演最终必须由 `run_id`、数据库记录或 run artifacts 驱动；静态 demo frame 只能作为 fixture 或 fallback。
5. 测试必须覆盖行为，不只检查页面数量、源码字符串或静态结构。
6. 文档不得把静态原型、小样本 Monte Carlo 或 Mesa 烟测描述成工程级校准平台。
7. 早期仿真 ontology 与 contract-first 设想仅作为历史参考；当前数据契约必须以应用系统 schema、Project draft、run identity chain、权限、审计和产物治理为主。

## 当前基线判断

截至 2026-06-19，M3-1 已在 M3-0 函数/API smoke 基础上收束出浏览器可访问的同源后端闭环 smoke，但整体系统仍处在原型到真实系统迁移阶段：

1. 四级功能页面化和核心静态工作台已经稳定，M0/M1 浏览器 smoke 可作为后续后端接入的对照基线。
2. `src/spare_mvp_backend/http_server.py`、`BackendApi`、`SimulationAdapter` 和 SQLite repository 已跑通同源 `/api` + `Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest` 真实后端闭环 smoke，并已通过 M3-1 浏览器刷新恢复和 API 不可用阻断验收。
3. 前端已有 `front/api-client.mjs` 边界，显式保存、启动运行、读取结果和读取产物通过 API client 表达；通用建模编辑仍保持本地，直到显式保存或运行。
4. Monte Carlo 页面仍保留前端局部演示/扫参能力，尚未升级为后端 worker 或批量运行产物。
5. Mesa 可视化页已嵌入本地航空保障状态；产品口径不再保留 Mesa 内部 `Ontology视图`，`aviation_support` Project 到 Scenario 的字段派生规则仍保持未批准。
6. 本地 M4 backfill 已补入最小用户、会话、建模导入授权和审计边界；完整用户管理、项目级权限矩阵、SSO、运行管理、长期 artifact storage 和生产 Web API 还没有真实系统实现。

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
| `SimulationRun` | 单次仿真运行记录。 |
| `MonteCarloRun` | 批量 Monte Carlo 运行记录。 |
| `SampleResult` | 单样本运行结果。 |
| `AggregateResult` | 聚合指标、分布统计和对比结果。 |
| `ArtifactManifest` | 输入、配置、日志、结果、报告等产物索引。 |
| 用户与权限对象 | 账号、角色、项目访问范围和操作权限。 |

核心工作：

1. 每个对象定义 `schema_version`、必填字段、引用关系、校验规则和迁移策略。
2. 明确 `project JSON`、`scenario JSON`、`run JSON`、`result JSON` 的边界和转换规则。
3. 将 `scenario`、`experiment`、`monteCarlo`、`runs`、`summary` 等前端概念收敛为正式对象。
4. 定义导入、保存、发布、运行、归档过程中对象版本如何变化。
5. 不再把 M2 拆成可见的 `Simulation/Ontology Contract` 与 `Application Data Contract` 双轨。M2 统一收敛到应用数据契约：Project、ModelingObject、Scenario、SimulationRun、Result、ArtifactManifest、用户权限、审计和迁移策略。

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

M3-0 当前收束：已完成本地标准库 HTTP facade + 函数级 Backend API 的真实后端闭环 smoke，证据见 `reports/m3-0-real-backend-loop/README.md`。该收束证明已批准的 `smoke` 模型族可以通过同源 `/api`、Backend API facade 和 repository 完成保存、编译、运行、结果、产物和身份链读取；它不代表生产 Web API、worker 队列、长期对象存储、权限体系或 `aviation_support` Scenario 编译已经完成。

M3-1 当前收束：已完成浏览器同源后端闭环 smoke，证据见 `reports/m3-1-browser-backend-smoke/README.md`。该收束证明前端可从 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取 Result/ArtifactManifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时不再生成 `offline-demo-run`。

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

当前推进口径：M5 数据入口曾在跳过 M4 的前提下先行推进；当前 M4 backfill 已补入本地会话、角色和审计边界，因此 M5 的 save/publish/compile-scenario HTTP 路径必须带 M4 bearer token。M5 首片不做完整 Excel UI；先定义建模数据导入/校验 contract、错误定位结构、草稿/发布版本和运行引用保护。M5.1 将该 contract 接入本地后端 API、SQLite 持久化和前端 API client。M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）。M5.3 把建模页当前数据保存为后端 Project draft，同时保留概要设计中的 `仿真实验方案管理` 作为 ExperimentPlan 分支工作流。

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

M5.2 工作台与 Scenario 预览入口：

1. 系统管理 / 项目管理新增「建模数据导入」入口，用于查看导入包摘要、目标页面/字段映射、校验错误和草稿/发布版本差异。
2. 映射、错误和版本预览继续消费 M5.1 的 modeling-import contract issue shape 和后端恢复的 `draftPackage`/`publishedPackage`，不新增自动保存或自由 Excel 映射器。
3. 已发布且通过校验的导入包可请求后端 Scenario 预览，后端必须读取持久化的 `publishedPackage` 并经 `SimulationAdapter.compile_scenario()` 生成，前端和 Backend API handler 不直接拼最终 Scenario JSON。
4. M5.2 仍不包含完整 Excel 解析、worker 基础设施、Mesa 行为变更或 `aviation_support` 编译解锁；HTTP 侧 save/publish/compile-scenario 已接入 M4 会话和审计边界。

### M5.3 建模草稿持久化与实验方案分支

目标：把建模页的项目数据保存为后端 Project draft，同时保留概要设计中的 `仿真实验方案管理`。ExperimentPlan 是从 Project 复制出的可编辑仿真分支，编辑方案不影响项目数据；运行仿真和 Monte Carlo 时使用选中的方案保留可复现 run identity chain。

边界：

1. Project draft 持久化只负责当前项目建模数据的保存与恢复，不替代 `方案列表` 和 `方案编辑`。
2. `data-save-plan` 属于 ExperimentPlan 分支保存动作；通用建模字段编辑使用 Project draft 保存路径。
3. 创建或运行 ExperimentPlan 时从当前 Project 建模快照复制配置，方案编辑状态不回写 source Project。
4. 本阶段不扩大 M4 用户、会话、授权或审计范围，也不把 M5.1/M5.2 的建模导入工作台扩展为完整 Excel UI。

## M6：仿真引擎服务化

目标：把前端 JS 重算和本地 Mesa 状态帧升级为后端服务或 worker 运行。

推进方式：以正式后端 API + worker + artifact storage 为目标演进；开发期可以继续使用本地 adapter 和 smoke model 做可脚本化验证，但不再要求先建设独立 `Simulation Contract Service`。

M6.0 当前收束：已新增 `RunService` 与 canonical `/api/runs`，把当前同步 smoke run 包装成可轮询的运行服务边界。前端启动运行后先拿 `run_id`，再查询 status/result/artifact/chain；旧 `/api/simulation-runs` 路径继续兼容。RunService 在当前进程内串行化 run id 生成，并能在执行器失败后返回 failed status envelope。该首片仍使用本地同步执行器，不包含完整 worker 队列、取消、重试、超时、资源隔离、真实批量 Monte Carlo fan-out、长期 artifact storage 或 `aviation_support` 正式执行。

M6.1 当前收束：输入一致性与 Scenario 编译 gate 已落地为窄闭环。真正做统一 Monte Carlo、四类分析模板和正式结果 artifact 前，当前实现先打通 `Frontend Project / ExperimentPlan -> Scenario compiler / adapter mapping -> Mesa simulation input` 的可审计边界：`smoke` Scenario 带 `compiled_from.mapping_provenance`，记录 consumed/ignored/derived 字段；`aviation_support` 有 compiler skeleton，暂以字段级 diagnostics fail closed；无法编译的 ExperimentPlan 会返回 failed run status envelope，`error.details.issues` 和 `error.details.provenance` 可供前端展示，且没有 `result_summary_id`，ArtifactManifest 为空。前端四个结果分析 dashboard 在缺少 compiler provenance 或官方 analysis artifact 时只显示“本地预览，不是正式后端仿真结果”，不能把 `singleResult` 局部推导包装成正式后端结果。

M6.1.1 当前收束：单次仿真输入已经从“ExperimentPlan 绑定 snapshot + steps”收敛为“ExperimentPlan 分支 Project JSON -> Scenario compiler”。前端创建实验方案时把完整分支 `projectJson` 写入 plan config；RunService 编译单次 smoke run 时优先消费该分支 Project JSON，并把 `experiment_plan_id`、`modeling_snapshot_id` 写入 mapping provenance。修改分支 seed、组件故障率或保障容量会进入后端 Scenario input 和 run artifact；旧计划缺少 `projectJson` 时仍回退到 ModelingSnapshot。

M6.2 当前收束：统一 Monte Carlo / analysis profile 已完成同步本地最小闭环。基于 M6.1/M6.1.1 已对齐的 Scenario 跑样本，产出 `monte_carlo_base` artifact；“大样本评估”“备件短板”“携行清单”“任务可靠度”“停机因素”作为同一 artifact 的 projection，并在 ArtifactManifest 中引用同一个 base artifact。仿真实验方案保存 `analysisRequests` 配置，结果分析页按 ArtifactManifest metadata、ResultSummary `analysis_outputs` 和 run status 显示“未配置”“待运行”“运行中”“运行失败”或完成状态。当前仍未实现生产 worker queue、object storage、取消/重试、artifact payload 浏览 API 或新的 auth/audit scope。

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
2. Run 创建前先通过模型族 Scenario compiler；无法编译时返回字段级错误并阻断正式结果。
3. worker 或本地执行器只消费编译后的 Scenario input，不读取前端当前 draft。
4. 前端轮询或订阅运行状态。
5. 最终结果来自真实 run artifacts，且能追溯 mapping version、输入版本、运行配置和 seed。

## M7：运行管理和产物管理

目标：系统能回答每次运行的来源、参数、结果和产物。

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

## M8：结果分析从演示图表升级为产物驱动

目标：所有分析页都随真实运行产物变化，并能追溯计算来源。

M8.0 建议切片：结果分析按 ExperimentPlan 的实验类型配置和 M6.2 run artifacts 解锁。已配置且运行完成的分析页显示对应 projection；已配置且运行中显示进度和日志摘要；已配置且运行失败显示失败原因、日志入口和重试入口；未配置或缺少 M6.1 compiler provenance 的分析页统一显示“未配置”或“输入未通过编译”，不能用静态演示图表冒充正式结果。

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

目标：Mesa 可视化页从静态状态帧升级为真实状态序列或在线状态流。

分阶段路径：

1. 离线回放：后端运行完成后写出 time-series，前端按时间轴回放。
2. 在线推演：通过 WebSocket 或 SSE 推送状态，前端支持运行控制和状态订阅。

核心能力：

1. 运行控制。
2. 单步推进。
3. 暂停。
4. 重置。
5. 时间轴。
6. 事件流。
7. 飞机、任务、资源状态订阅。
8. 状态快照保存。

完成标准：

1. 可视化页面展示某个 `run_id` 的真实状态序列。
2. 内置 demo frame 不再作为正式完成口径。
3. 状态流能追溯到运行输入、时间步和事件日志。

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
4. M5.2 当前聚焦系统管理下「建模数据导入」工作台、映射/错误/版本预览和经 `SimulationAdapter` 编译的后端 Scenario 预览；完整 Excel UI 或生产 worker 仍不在本阶段。
5. 每次 PR 更新页面流转、数据对象或结果口径时，同步更新本文档或相关验收清单。
