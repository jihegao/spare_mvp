# Agent 协作约定

本文档约束后续 agent 在本仓库中的工作方式。除代码、命令、路径和外部工具名称外，面向项目的说明文档统一使用中文。

## 基本原则

1. 先读取当前仓库状态，再判断实现边界；不要只按历史记忆修改。
2. 保持 PR 切片边界清晰。当前工作主要集中在 `front/`、`tests/`、`docs/`、`contracts/`、`reports/`、`src/spare_mvp_backend/`、`src/spare_mvp_contract/`、`src/spare_mvp_abm/aviation_support/` 和 `vendor/ship_front/`；M4 backfill 触达本地用户、会话、授权、审计和受保护 M5 HTTP 路径，M5 数据入口切片还会触达导入 fixture、contract 测试、`modeling_imports` 持久化、`/api/modeling-imports/*` 本地后端路径和 M5.2 的「建模数据导入」系统管理工作台。
3. 不把静态原型、小样本 Monte Carlo 或 Mesa 烟测描述成工程级校准平台。
4. 修改功能流转、页面入口、仿真参数或结果口径时，必须同步更新 `README.md`、`docs/README.md` 或对应设计/实现文档。
5. 运行时代码不得依赖 `/Users/gaojihe/...` 下的外部原型路径；这些路径只能出现在来源说明或本地验证命令中。
6. 当测试或实现删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧标题、旧 CSS/函数名、旧中文文案和新入口关键词搜索 `README.md`、`docs/`、`agent.md`，并更新命中的当前状态文档。

## 常用验证

```bash
npm test
npm run start:system
npm run start:system:with-contract-provider  # 仅在需要 legacy/dev contract provider sidecar 时使用
```

默认产品运行入口是 `npm run start:system` / `bash scripts/start-system.sh start`：只启动同源 app/backend、使用 `runs/system-start/spare_mvp.sqlite3` 持久化，并通过 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts` 生成正式结果。`npm run start:system:with-contract-provider` / `bash scripts/start-system.sh start --with-contract-provider` 仅为历史 contract-provider 调试和低层回归额外启动 `src/spare_mvp_abm/contract_server.py :8521` legacy/dev sidecar；该 sidecar 不是默认产品运行路径。

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
7. 当前同源后端验证用 `npm run start:system` 启动后，浏览器从 `/front/` 通过 canonical `/api/runs` 保存项目、启动 `aircraft_support_v1` formal run、读取 result/artifact，并在刷新后恢复同一个 `run_id`；M3-1 smoke 闭环只作为归档证据保留在 `reports/m3-1-browser-backend-smoke/`。
8. `/api` 不可用时，前端必须显示阻断状态，不创建 `offline-demo-run`。
9. RMS 分配发布只允许写入 `rms.target` 或 allocation plan，不覆盖 `prediction` 或 `actual`。
10. M5 建模数据入口必须校验重复 ID、悬空引用、非法数值和已发布且被运行引用后的覆盖保护，并返回页面、对象、字段路径和严重级别。
11. M4 backfill 后，HTTP 侧建模导入 save/publish/compile-scenario 必须带 `/api/auth/login` 返回的 bearer token；未登录请求返回 `unauthorized`，普通用户发布返回 `forbidden` 并写入 `audit_events`。
12. M5.1 本地后端路径必须通过 `/api/modeling-imports/validate`、带 M4 session 的 `/api/modeling-imports`、`/api/modeling-imports/{import_id}` 和带 M4 session 的 `/api/modeling-imports/{import_id}/publish` 验证；`modeling_imports` 必须保留 `draft_payload_json` 和 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`；同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。
13. M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/后端可恢复版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`/api/modeling-imports/{import_id}/compile-scenario`）；`compile-scenario` 必须读取持久化 published payload，而不是当前 draft 或前端内存快照；该切片仍不包含完整 Excel 解析或 worker 基础设施。
14. M6.0 运行服务首片必须通过 canonical `/api/runs` 创建和查询 run status；旧 `/api/simulation-runs*` 已退役，只能返回 `410 legacy_run_api_retired` 负向契约。运行 identity 必须来自 ExperimentPlan，后端输入使用该计划绑定的 ModelingSnapshot 和当前支持的 `steps` 配置，不能绕过 M5.3 的 Project/Plan 分界。
15. M6.1/M9.4 输入一致性已形成窄闭环，但 `smoke` 和 `aviation_support` 现仅保留为历史/低层回归基线；正式 `/api/runs`、`BackendApi.start_simulation_run()`、前端 run shortcut 和 modeling import `compile-scenario` 入口只接受 `aircraft_support_v1`。旧模型族必须返回 `retired_model_family`，并在 details 中给出 `replacement_model_family: "aircraft_support_v1"`；未知模型族或无效 Project 仍必须 fail closed，返回 failed status envelope、保留 `error.details.issues/provenance`、不伪造正式产物。
16. M6.1 前端 formal-result boundary 必须保留：四个结果分析页缺少 compiler provenance 或官方 analysis artifact 时，只能显示“本地预览，不是正式后端仿真结果”和“缺少 compiler provenance”等边界信息，不能把本地 `singleResult` 投影呈现为正式后端产物。
17. M6.1.1 单次仿真输入对齐必须保留：ExperimentPlan config 携带完整分支 `projectJson`，RunService 编译单次 smoke run 时优先使用该分支输入，并在 mapping provenance 中记录 `experiment_plan_id` 和 `modeling_snapshot_id`；旧计划缺少 `projectJson` 时才回退 ModelingSnapshot。
18. M6.2 统一 Monte Carlo / analysis profile 已形成同步本地切片，M8.0 已补齐 projection payload 消费，M9.0/M9.1 已补齐离线状态序列回放与事件追溯，M9.2 已补齐最小在线状态流和运行订阅，M9.3 已补齐最小 run lifecycle / control plane，M9.7.4 已由 `aircraft_support_v1` 承接正式 single/formal Monte Carlo/projection/state-series 能力；M9.4/M9.5 的 `aviation_support` 能力仅作为归档历史和低层回归参考。单次仿真实验和 Monte Carlo 实验必须共享 `SimulationExperimentBase`，统一实验身份、方案、Scenario identity、随机种子、状态、进度、`run_id` 和 artifact 引用；正式 MC 必须使用 `run_type: "monte_carlo"` 和 `model_family: "aircraft_support_v1"`，不得回退到 `single` 或旧模型族。四个结果分析页是用户可见的 current result flow：页面直接运行当前分析，后台可保留 AnalysisTask、MonteCarloExperiment、run、artifact 和 provenance 作为内部追溯，但普通主界面不得展示任务列表、绑定 MC、artifact/run 选择器或历史结果列表；只有后端 `current analysis result` 记录在运行完成、compiler provenance、`monte_carlo_base`、对应 projection artifact 和已解析 projection payload 同时校验通过时，才显示正式 KPI/表格/图形。Mesa 可视化页在已完成 run 存在 `visualization_state_series` artifact 且 payload 通过 `run_id + artifact_id`、schema、事件引用和 traceability 校验后显示正式离线回放和事件流。当前同步执行器的 M9.2 `GET /api/runs/{run_id}/state-stream` 从已持久化状态序列输出 `run_status`、`state_frame` 和 `artifact_ready`；在线帧只用于展示当前流状态，最终 artifact 才能解锁离线回放。M9.3 的 `POST /api/runs/{run_id}/control` 只在后端确认 `cancel`/`retry` 后改变正式 run 状态并写入 `runs.control.*` 审计；`retry` 会阻断旧 result/artifact 正式读取，run detail 只展示 pending 空 artifact manifest。未运行、运行失败、缺少 compiler provenance、缺少 projection artifact、缺少 state-series artifact、payload 解析失败或 retry-pending 无正式产物时不得显示正式结果/回放。生产 worker queue、真实运行中增量推送、object storage、完整 cancel/retry 基础设施、checkpoint restart 和新 auth/audit scope 只在对应阶段最小需要时纳入。
19. 执行 `reports/2026-06-19-page-revision-suggestions/README.md` 页面建议时，必须保留系统管理下的「建模数据导入」工作台；已取消“删除此页面”。页面建议收口只修 M6.1.1 前置输入可用性、死按钮和字段口径，不得顺手实现 M6.1.1、M6.2 或删除 M5.2 导入入口。
20. RunIntent / MonteCarloRunConfig / imported sample Project 收敛已作为 M6.2 后续切片完成：正式 run 必须走 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`；正式 MC 数值配置只能从 `ExperimentPlan.config.analysisRequests.largeSample` 生成 canonical `MonteCarloRunConfig`；request-level MC numeric config 必须被拒绝；Adapter 缺 normalized config 或收到 legacy params 时必须 fail closed，不得继续让 request、Project draft、Adapter 和前端本地 sweep 多处猜值。项目列表可从 modeling import 生成示例 Project draft；没有已发布包时入口会先保存并发布示例导入包，再 create-project。`/api/runs` formal gate 必须验证 `missionProfile.sourceImportId`、已发布 import/projectId 匹配和 `modeling_import.create_project` allowed 审计记录，手工伪造来源不能通过；正式和预览测试运行提交、查询、结果、产物和身份链都只走 canonical `/api/runs` 路径。`defaultScenario`、`runSimulation` 和 `runMonteCarlo` 只能保留为离线 fixture、本地预览或测试 fallback，不能作为正式结果来源。
21. M6.2.x 输入源治理已收束：`tests/fixtures/modeling_import_project.json` 是唯一完整业务示例源。前端页面缺少 imported JSON 数据时必须显示空态或创建入口，不得从 `defaultScenario`、`SUPPORT_*`、`MISSION_*` 或 preview fixture 静默补业务样例；preview fixture 只能用于显式本地预览和测试 fallback。M8.0 已消费 projection payload，M9.0/M9.1 已消费可追溯离线 `visualization_state_series` payload，M9.2 已消费 run-scoped 在线状态流，M9.3 已消费后端确认的最小 run control，当前正式消费路径统一为 `aircraft_support_v1`；该规则不表示生产 worker、object storage 或完整 cancel/retry 已完成。
22. Legacy `/api/simulation-runs` 已退役：新实现、测试、浏览器 smoke 和文档不得把它作为可用入口；运行提交和查询必须走 canonical `/api/runs`、`/api/runs/{run_id}`、`/api/runs/{run_id}/result`、`/api/runs/{run_id}/artifacts` 和 `/api/runs/{run_id}/chain`。旧路径只允许返回 `410 legacy_run_api_retired` 的负向契约。
23. M7.0 之后所有新的运行管理工作必须继续使用 canonical `/api/runs` 和 artifact ids：run list/detail、下载、归档、软删除、审计和前端展示都必须按 `run_id` + `artifact_id` 定位，不能接受裸 artifact path，也不得恢复或重新引入 legacy `/api/simulation-runs`。
24. M9.0/M9.1 离线状态序列回放必须继续使用 canonical `/api/runs/{run_id}/artifacts/{artifact_id}` 下载 `visualization_state_series`，每帧必须携带 run identity、时间步、飞机/任务/资源状态、事件摘要、事件 id、指标引用和 run/result/manifest/compiled Scenario trace。`aircraft_support_v1` 的任务帧必须保留周期任务、复合任务、基本任务、实际天、波次、要求机型/数量、时长和实际执行飞机字段，供任务计划甘特视图直接消费；缺少这些任务计划字段时前端必须 fail closed，不得从旧 artifact 的 id/name/aircraft_type 兜底推断。前端播放、暂停、单步、重置、时间轴拖动和事件点击只控制本地回放索引，不控制后端执行器；缺少 artifact、payload 类型不匹配、run_id 不一致、事件引用不一致或 traceability 缺失时必须 fail closed，不能把契约服务 demo 或内置 demo frame 当成正式回放。
25. M9.7.4 已在 `aircraft_support_v1` 真实 single-run core 和 formal Monte Carlo/projection 后关闭最终字段覆盖：`SimulationAdapter.compile_scenario_with_gate()` 继续生成 `AircraftSupportV1Model` Scenario envelope 和独立 input payload，`SimulationAdapter.run_scenario()` / `run_monte_carlo_scenario()` 通过 `src/spare_mvp_abm/aircraft_support_v1/` 写出 canonical result/artifact/run chain/metrics/report/log/projection/state-series、`monte_carlo_base` 和样本失败账本。report/log 必须声明 `m9_7_4_behavior_scope`，行为驱动字段包含 `components[].failureDistribution`、`supportNodes[].transportPolicies`、`reliabilityBlockDiagram`、RMS/k-out-of-n、周期任务、任务阶段/机场/任务区、保障活动 job DAG、库存、资源容量、Monte Carlo sweep 与 seed；`aircraft_support_v1` 仿真时长必须优先由周期任务配置天数 × 重复次数推导，`durationHours` 只作为无周期任务时的回退；`supportOrganization` 是 governance-only / 不驱动仿真字段，进入 provenance 而不再阻断 M9.6 frozen 案例。M9.6 field coverage 中 frozen 字段 unsupported 汇总必须保持 0。
26. M9.2 在线状态流必须继续使用 canonical `/api/runs/{run_id}/state-stream`，事件类型为 `run_status`、`state_frame` 和 `artifact_ready`；`state_frame` 复用 `visualization_state_series` 的帧字段和 traceability，不另造前端静态帧。原生 `EventSource` 的本地会话 token 只允许作为该 SSE 路由的 `access_token` 查询参数折中，其他受保护 API 仍使用 Bearer header。M9.3 后端运行控制必须继续使用 canonical `POST /api/runs/{run_id}/control`；`cancel`/`retry` 必须以后端确认和审计为准，`pause`、`resume`、`step`、`reset` 必须 fail closed，不得在前端伪造。当前 formal run/state-stream/control 的新入口只允许 `aircraft_support_v1`；后续不得把 checkpoint restart 混入无对应 contract 的阶段。
27. M9.8 平台嵌入已完成：前端 RunIntent 默认模型族是 `aircraft_support_v1`，可视化仿真、single run、Monte Carlo 和四类分析页的正式结果必须来自 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`、`/api/runs/{run_id}/artifacts/{artifact_id}` 或 `/api/runs/{run_id}/state-stream`。任务视图必须以合并后的任务计划甘特表为主工作区，按周期性任务 / 复合任务 / 每天基本任务展示实际天、波次、要求型号、数量、实际执行飞机和状态，不再拆成独立任务计划表和任务卡片；缺少正式任务计划字段时必须阻断并要求重新运行，不得前端补标签。`scripts/start-system.sh start` 默认只启动平台同源 app/backend 和 SQLite；只有 `start --with-contract-provider` 才额外启动 `src/spare_mvp_abm/contract_server.py :8521` legacy/dev sidecar。该 sidecar 不属于默认产品运行路径，不得替代 canonical run artifacts；脚本也不得启动 `independent-mesa/server.py`、不得依赖 `8765`，也不得把静态 HTML 输出描述为正式产品入口；`independent-mesa/GLM` 和 `independent-mesa/GPT` 源码树已移除，后续不得恢复为旁路服务或离线复现实验入口。
28. M9.6 已冻结平台案例数据包、字段覆盖表和 golden fixtures：`tests/fixtures/modeling_import_project.json` 是唯一完整业务案例源；`tests/fixtures/m9_6_platform_case_export.json`、`tests/fixtures/m9_6_field_coverage.json` 和 `tests/fixtures/m9_6_expected_artifact_kinds.json` 是后续 M9.7/M9.8 的验收输入。修改 canonical import fixture、导出链路、adapter provenance 或 artifact kind 时，必须运行 `python3 scripts/export-m9-6-case-package.py --check` 和 `python3 -m unittest tests.test_m9_6_case_package -v`。
29. 阶段 6P 已冻结仿真分析验收数据包：`tests/fixtures/simulation_analysis_cases/` 包含 `minimal_single_aircraft`、`canonical_platform_case` 和 `max_granularity_multi_aircraft` 三类正式分析输入。修改 6P fixture、`src/spare_mvp_backend/simulation_analysis_cases.py`、Monte Carlo sweep 覆盖规则或正式 analysis artifact kind 时，必须运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python scripts/export-simulation-analysis-cases.py --check` 和 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_analysis_cases -v`。6P 是分析验收基线，不是生产性能压测。
30. 2026-06-27 TODO 阶段 2 后，触达保障组织、备件、保障人员、保障设备或保障活动页面时，必须保持递归组织树、备件所属装备、保障人员专业字典回退、无所属型号、无行级编辑按钮、基本保障活动编辑面板、工作项目基础库选择/搜索/自动回填和显式紧前作业编辑。建模表单管理的持久专业字典仍属后续阶段；阶段 3 的结果页、可视化承载迁移不得回退这些页面约束。

## Legacy/dev Mesa 后台契约服务（Contract Provider）

本仓库仍保留一个零依赖（Python 标准库 `http.server`）的 Mesa 契约服务，把 `AviationSupportModel` 与 `SmokeSpareMvpModel` 的状态暴露为稳定 JSON 端点，供历史 contract-provider 调试、低层回归和 swarm agent 只读消费。服务源文件为 `src/spare_mvp_abm/contract_server.py`，默认调试端口为 `8521`，但它是可选 legacy/dev sidecar，不是默认产品运行路径。正式产品结果必须来自 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`，不能用该 sidecar 的 snapshot、visualization 或 experiment 响应替代。

### 默认端口

`127.0.0.1:8521`（Mesa 惯例端口，不与前端静态服务 4173 冲突）。

### 启动命令

默认 `bash scripts/start-system.sh start` / `npm run start:system` 不启动该 sidecar。需要历史 contract provider 或旧 Mesa contract 调试面时使用：

```bash
npm run start:system:with-contract-provider
bash scripts/start-system.sh start --with-contract-provider
```

需要只调试单独 sidecar 时，依赖本地 `.abm-mesa-test-env`（Python 3.12 + mesa 3.5.1，已被 `.gitignore` 忽略，仅本机可用，不进 CI）：

```bash
.abm-mesa-test-env/bin/python src/spare_mvp_abm/contract_server.py --host 127.0.0.1 --port 8521
```

Python 测试解释器约定：凡是运行 `tests/test_contract_server.py`、`tests/test_aviation_support_local.py`、涉及 Mesa 的 unittest，或执行 `unittest discover` 全量发现测试，都必须使用 repo-local `.abm-mesa-test-env/bin/python`。不要用系统 `python3 -m unittest discover` 运行这些测试；当前系统解释器可能缺少 `mesa`，会在发现 `test_contract_server` 时失败。

```bash
.abm-mesa-test-env/bin/python -m unittest discover -s tests -v
```

验证存活：

```bash
curl -s http://127.0.0.1:8521/health
```

### 端点契约

所有响应为统一信封 `{"ok": bool, "contract_version": "1.0.0", "data": ..., "error": {...}|null}`。错误码：`400 bad_param`（参数非法或模型与端点不匹配）、`404 not_found`（未知端点或 experiment 配置缺失）、`500 model_error`（模型异常，附带 traceback）。CORS 已开放（`Access-Control-Allow-Origin: *`），为将来前端跨域 fetch 预留。

| 方法 | 路径 | 查询参数 | 返回 |
|---|---|---|---|
| GET | `/health` | 无 | 存活状态 + `contract_version` + 可用模型 |
| GET | `/contract` | 无 | 自描述：端点 / 信封 / 错误 / 所有权 |
| GET | `/snapshot` | `model`（aviation\|smoke）、`steps`（int 0..1000，默认 0）、航空模型入参（见下）、`project`（smoke 的 project.json 路径） | `model.snapshot()` |
| GET | `/visualization` | `model=aviation`（仅）、`steps` | snapshot/aircraft/resources/spares/missions/jobs/support_tasks/metrics/object_relationships/events |
| GET | `/experiment` | `name`（`scenarios/<name>/experiment.json`，缺省读 `aviation_support/experiment.json`） | experiment.json 原文 |

模型能力不对称：`/visualization` 仅 `aviation` 暴露；`smoke` 通过 `/snapshot` 和后端 RunService 参与 Project -> Scenario -> Run smoke 链路。旧 `/ontology-mapping` 端点已随 ontology 需求删除，不再作为只读契约服务能力。

可覆盖的航空模型入参（白名单）：`aircraft_count`、`aircraft_type`、`mission_count`、`mechanic_teams`、`fuel_trucks`、`power_carts`、`weapons_crews`、`maintenance_bays`、`tick_minutes`、`lru_failure_multiplier`、`seed`。未列入的构造参数不可通过 HTTP 修改。

### 消费示例

```bash
curl -s "http://127.0.0.1:8521/snapshot?model=aviation&steps=10&seed=17"
curl -s "http://127.0.0.1:8521/visualization?model=aviation&steps=5"
curl -s "http://127.0.0.1:8521/experiment?name=mission-reliability-smoke"
```

本机存在全局 HTTP 代理，Python 消费必须禁用代理，否则 127.0.0.1 请求会被转发给代理返回 502：

```python
import urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
opener.open("http://127.0.0.1:8521/health").read().decode()
```

### 所有权声明

以下资产归 Claude（主控 agent）维护，其他 swarm agent 为只读消费者：

1. 服务源文件 `src/spare_mvp_abm/contract_server.py`。
2. 本段落（`## Mesa 后台契约服务`）的契约文本。
3. 默认端口 `8521`、端点清单与路径、查询参数白名单、统一信封结构、`CONTRACT_VERSION`。
4. 契约测试 `tests/test_contract_server.py`。

其他 agent 不得：修改服务源文件、改端口、增删或重命名端点、改查询参数白名单、改信封结构、改 `CONTRACT_VERSION`。只读消费（`curl` / fetch `/contract` 及各 GET 端点）允许。

### 契约变更流程

任何对上述受保护资产的变更，按顺序执行：

1. 先在本段落登记变更（端点、参数、版本、行为），按 semver 升 `CONTRACT_VERSION`。
2. 再改 `contract_server.py` 与 `tests/test_contract_server.py`，保持测试通过。
3. 同步 `/contract` 自描述响应与本段落文本一致。
4. 在最终回复中说明：变更了哪个端点、版本从什么升到什么、是否破坏性。

破坏性变更（删端点、改字段语义、改默认行为）必须升主版本号并在回复顶部标注。

## 文档同步检查

修改前端页面结构、功能入口、仿真参数、结果来源或测试断言时，完成前必须执行一次文档同步检查：

1. 用旧文案和新文案分别搜索文档，例如 `rg -n "Ontology 上下文|ontology-map|Ontology视图|可视化推演" README.md docs agent.md`，确认命中仅限归档历史或删除说明。
2. 如果测试中新增了 `doesNotMatch` 删除旧 UI 或旧路由，必须用被删除的字符串搜索文档，确认没有当前状态文档仍按旧 UI 描述。
3. 至少检查 `README.md`、`docs/README.md`、相关 `docs/superpowers/specs/`、相关 `docs/superpowers/plans/` 和 `agent.md`。
4. 最终回复要说明更新了哪些文档，或者说明为什么某个命中文档是历史记录而不需要改。

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
