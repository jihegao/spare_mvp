# M6.0 仿真运行服务边界设计

## 背景

M3-0/M3-1 已经跑通 `Project -> ModelingSnapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest` 的本地后端闭环。M5.3 进一步明确了 Project draft 与 ExperimentPlan 分支的边界：建模页保存 Project，仿真实验方案保存可运行的分支身份，运行必须从选中的 ExperimentPlan 生成 identity chain。

M6 的目标是把前端 JS 重算和本地 Mesa 状态帧升级为后端服务或 worker 运行。M6.0 不直接建设完整 worker 平台；它先把当前同步 `BackendApi.start_simulation_run()` 收敛到可替换的 run service 边界，提供 canonical run submission/status API，并让前端按 run status 轮询结果。后续 M6.1 先补齐 Frontend Project / ExperimentPlan 到 Mesa Scenario input 的编译一致性，M6.2 再基于已对齐的 Scenario 建设统一 Monte Carlo 和 analysis projection。

## 目标

1. 新增后端 `RunService` 边界，集中处理 run request、Scenario 编译、同步本地执行、状态读取和输出读取。
2. 新增 canonical HTTP 路径 `POST /api/runs`、`GET /api/runs/{run_id}`、`GET /api/runs/{run_id}/result`、`GET /api/runs/{run_id}/artifacts` 和 `GET /api/runs/{run_id}/chain`。2026-06-21 退役切片完成后，旧 run API 只返回 `410 legacy_run_api_retired`。
3. 前端 `api-client` 使用 run submission/status 语义，Monte Carlo “启动”后先拿到 run id，再通过 status/result/artifact/chain 接口刷新页面状态。
4. 当前执行器仍是同步本地 smoke runner：请求返回时 run 通常已完成，但接口表现为可轮询的服务化运行。这样后续替换为异步 worker 时不用重写前端与 API contract。
5. 文档明确 M6.0 不是完整 worker、不是真实批量 Monte Carlo、不是 `aviation_support` 编译解锁，也不扩大 M4 权限审计范围。

## 推荐方案

采用“RunService + 同步本地执行器”的窄切片。

### 备选方案

1. 直接建设 worker 队列：最接近 M6 终态，但会同时引入队列、生命周期、取消、日志、重试、资源隔离和进程管理，超出一个 PR 切片。
2. 继续只保留 `BackendApi.start_simulation_run()`：改动最小，但前端仍把“启动运行”等同于一次同步函数调用，无法为状态轮询、运行管理和 worker 替换建立稳定边界。
3. 推荐方案：先抽出 `RunService` 和 `/api/runs`，同步执行保持现有 smoke 能力，状态 contract 先稳定下来。它能最小化行为风险，同时为 M6 后续切片提供清晰接缝。

## 关键边界

### RunService 所有权

`src/spare_mvp_backend/run_service.py` 是 M6.0 新增边界，负责：

1. 校验 canonical run request 必须显式包含 `project_id`、`experiment_plan_id` 和 `model_family`。
2. 验证 ExperimentPlan 属于 Project，并优先读取计划绑定的 ModelingSnapshot。
3. 调用 `SimulationAdapter.compile_scenario()`，不在 HTTP handler 或前端拼接最终 Scenario JSON。
4. 调用当前本地同步执行器运行 smoke model。
5. 持久化 `Scenario`、`SimulationRun`、`ResultSummary` 和 `ArtifactManifest`。
6. 返回统一 run status envelope。

`BackendApi` 保持编排门面，旧的 `start_simulation_run()` 和新的 `submit_run()` 都委托给 `RunService.submit_run()`。由于当前 HTTP server 是 threaded，canonical `/api/runs` 也必须复用 `BackendApi` 现有的 run lock，避免 `next_run_id()` 读后写之间发生并发 run id 冲突。HTTP handler 只做 request/response 路由。

M6.0 的后端仿真输入边界保持保守：run identity 必须来自持久化 ExperimentPlan，实际 smoke Scenario 编译仍使用该 ExperimentPlan 绑定的 ModelingSnapshot，加上当前明确支持的计划配置字段。M6.0 支持的计划配置字段只有 `steps`；`seed`、Monte Carlo sweep 和完整可编辑 ExperimentPlan Project payload 编译是后续切片，不在本首片中补做。这样可以避免把当前前端本地 plan draft 误描述为已经完整持久化并被后端消费。

### Run Status Envelope

`GET /api/runs/{run_id}` 返回的 payload 使用稳定 envelope：

```json
{
  "run_id": "run-scenario-smoke-contract-demo-0001",
  "project_id": "project-smoke-contract-001",
  "experiment_plan_id": "experiment-plan-project-smoke-contract-001-...",
  "modeling_snapshot_id": "modeling-snapshot-project-smoke-contract-001-0001",
  "scenario_id": "scenario-smoke-contract-demo-0001",
  "status": "succeeded",
  "phase": "completed",
  "progress": 1,
  "run_type": "single",
  "model_family": "smoke",
  "seed": 20260620,
  "queued_at": "2026-06-20T00:00:00Z",
  "started_at": "2026-06-20T00:00:00Z",
  "completed_at": "2026-06-20T00:00:00Z",
  "error": null,
  "result_summary_id": "result-run-...",
  "artifact_manifest_id": "artifact-manifest-run-..."
}
```

M6.0 的同步执行器允许 `queued_at` 和 `started_at` 相同，`status` 可以直接从 `running` 进入 `succeeded`。接口必须能表示 `queued`、`running`、`succeeded`、`failed`，即使当前实现通常只持久化完成态。

### Run Request

Canonical `POST /api/runs` 接收：

```json
{
  "project_id": "project-smoke-contract-001",
  "experiment_plan_id": "experiment-plan-project-smoke-contract-001-...",
  "model_family": "smoke",
  "run_type": "single"
}
```

M6.0 只执行 `model_family=smoke` 和 `run_type=single`。Canonical `/api/runs` 缺少 `model_family` 时返回 `bad_run_request`；2026-06-21 退役切片完成后，旧 run API 不再作为默认 `smoke` 入口。`aviation_support` 继续返回 `unsupported_model_family`。M6.1 负责为 `aviation_support` 或正式业务模型族补 Scenario compiler skeleton、字段 mapping、默认值和阻断策略；真实批量 Monte Carlo fan-out、取消、重试、超时、资源隔离和运行日志是 M6.2/M7 范围。

### 前端行为

前端仍从 ExperimentPlan 启动运行：

```text
Project draft -> persisted ExperimentPlan identity + ModelingSnapshot -> POST /api/runs
-> poll GET /api/runs/{run_id}
-> GET result/artifacts/chain -> 更新结果页和 identity chain 展示
```

Monte Carlo 配置页的“启动”按钮可以继续复用当前 ExperimentPlan 创建逻辑，但不得绕过持久化 ExperimentPlan identity 或用当前可变 Project draft 重建 run identity。M6.0 只承诺后端 smoke run 使用 ExperimentPlan 绑定的 ModelingSnapshot 和 `steps`；前端若仍用本地保留的 plan draft 辅助展示，必须清楚区别于后端 artifact 的来源。启动后页面显示 run id、状态、进度和结果来源；如果 API 不可用，继续显示阻断状态，不创建 `offline-demo-run`。

### 实验方案、运行监控与结果分析关系

仿真实验方案是运行和分析的配置源，不是结果页的附属表单。后续 ExperimentPlan 需要保留三类信息：

1. 基本信息：实验名称、仿真总时长、随机种子。
2. 实验类型配置：以 `analysisRequests` 或等价结构记录勾选项和配置面板参数。
3. 运行身份：Project、ModelingSnapshot、Scenario、Run、Result 和 ArtifactManifest 的 identity chain。

实验类型按业务模块分组：

1. 通用实验：大样本评估。
2. 备件规划评估模块：备件短板、携行清单。
3. 任务可靠度评估模块：任务可靠度、停机因素。

用户在仿真实验方案中勾选某个实验类型后，页面打开对应配置面板；未勾选的实验类型不生成正式分析请求。M6.0 只稳定 run service/status 边界，不实现这些配置面板和完整 payload 编译。

M6.1 的优先目标是输入一致性：定义哪些 Project / ExperimentPlan 字段进入目标模型族 Scenario，哪些字段默认、派生、忽略或阻断，并在无法编译时 fail closed。

配置面板、运行监控和方案列表状态应在 M6.2 基于已通过编译的 Scenario 落地，避免先做出“看起来运行了”但实际仍是 demo 的分析结果。

结果分析页只消费 ExperimentPlan 中已配置的实验类型和 run artifacts。M6.2/M8.0 应按以下状态展示：

1. 已配置且运行完成：显示对应分析结果，并展示 `run_id`、样本数、输入版本和指标口径。
2. 已配置且运行中：显示运行中状态、进度和最近日志摘要。
3. 已配置且运行失败：显示失败原因、日志入口和重试入口。
4. 未配置：显示“未配置”，不得用静态演示图表冒充正式结果。

### 权限与审计边界

M6.0 不扩大 M4 的用户、会话、授权和审计范围。当前运行 API 的可用入口是 canonical `/api/runs`；后续若要求普通评估用户提交运行、系统管理员管理资源，需要单独做 M4/M7 权限切片。

### Artifact 边界

M6.0 继续使用当前 `SimulationAdapter.run_scenario()` 写出的本地 artifact manifest，不引入长期对象存储或下载授权。Artifact manifest 必须继续能通过 `run_id` 查询，并与 `result_summary_id`、`artifact_manifest_id` 的 identity chain 保持一致。

## 测试策略

1. 后端 API tests 覆盖 `RunService.submit_run()`、status envelope、Plan/Project 不匹配阻断、unsupported model family 阻断和旧 `BackendApi.start_simulation_run()` 兼容。
2. HTTP tests 覆盖 `POST /api/runs`、`GET /api/runs/{run_id}` status envelope，以及旧 run API 的 `410 legacy_run_api_retired` 负向契约。
3. Frontend API client tests 覆盖 `submitRun()`、`getRunStatus()`、旧 `startSimulationRun()` alias 和 status/result/artifact/chain 读取顺序。
4. Frontend contract tests 覆盖 Monte Carlo 启动通过 run status 刷新，不绕过 ExperimentPlan branch，不创建 `offline-demo-run`。
5. Browser smoke 更新为等待 `/api/runs`，验证 run status、result、artifact manifest 和 identity chain 刷新后仍可恢复。
6. 文档同步后运行 stale wording 搜索，确认 M6.0 没有宣称完整 worker、真实批量 Monte Carlo 或 `aviation_support` 解锁。

## 验收标准

1. `POST /api/runs` 可从已保存 Project 和 ExperimentPlan 创建 smoke run，并返回 run id 与完成态 status envelope。
2. `GET /api/runs/{run_id}`、`result`、`artifacts` 和 `chain` 在服务重启后仍能查询同一 run。
3. 旧 run API 返回 `410 legacy_run_api_retired`，不再作为 status envelope 或 raw stored run 查询入口。
4. 前端启动运行后以 run status/result/artifact/chain 更新状态；API 不可用时阻断，不生成离线 run。
5. `npm test`、选定后端 `unittest`、浏览器 smoke 和 `git diff --check` 通过。
