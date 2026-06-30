# M7.0 运行与产物管理设计

## 背景

M6.2/M6.2.x/M6.2.y 已把正式运行入口收敛到 `RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts`，并退役 legacy `/api/simulation-runs`。当前系统已经能提交 single/Monte Carlo run、读取 status/result/artifacts/chain，并在 SQLite 中保存 `simulation_runs`、`result_summaries`、`artifact_manifests`。

M7.0 的目标不是扩大仿真能力，而是把运行账本和产物账本补成可运营、可审计、可下载、可复现的最小闭环：系统必须能回答谁在什么时候启动了 run、run 使用哪个 `Project` / `ExperimentPlan` / `Scenario` / seed / config、输出了哪些 artifacts、失败原因是什么，以及这些结果是否已归档或删除。

## 目标

1. Run list/detail 可以列出正式运行历史，包含 identity chain、运行配置摘要、生命周期状态、失败原因和 artifact 摘要。
2. Artifact manifest 中每个 artifact 都有稳定 `artifact_id`、`kind`、repo-local `path`、`media_type`、`sha256`、`size_bytes` 和必要 provenance。
3. Single run 和 Monte Carlo run 都写出可下载支撑文件：`run_config`、`input_project`、`compiled_scenario`、`result_summary`、`metrics`、`report`、`log`。Monte Carlo run 还必须登记 `sample_results`、`aggregate_result`，并修正当前 manifest 漏登记支撑文件的问题。
4. 失败 run 保留 failed status envelope，并生成可下载 log artifact 或等价 detail 下载入口。
5. HTTP 暴露 canonical M7 管理接口：`GET /api/runs`、`GET /api/runs/{id}/detail`、`GET /api/runs/{id}/artifacts/{artifact_id}`、`POST /api/runs/{id}/archive`、`DELETE /api/runs/{id}`。
6. 前端提供轻量“运行与产物”视图或扩展 Monte Carlo 详情页，展示 run list/detail、artifact identity/hash/size，并提供下载、归档、软删除操作。
7. README、docs 索引、roadmap、agent 约束和审计报告同步 M7.0 的能力边界。

## 非目标

1. 不实现生产 worker queue、分布式调度、object storage、取消/重试完整体系、资源隔离或长期保留策略。
2. 不实现 M8 projection payload 驱动 KPI 展示；前端可以展示 artifact 元数据和下载入口，但不解析正式 projection payload 替换分析卡数值。
3. 不实现 M9 state stream、可视化状态帧流或交互式 timeline。
4. 不解锁 `aviation_support` 正式执行；该模型族仍由 compiler gate fail closed。
5. 不恢复 legacy `/api/simulation-runs`；旧路径继续只允许返回 `410 legacy_run_api_retired`。
6. 不改变 M6.2 的 canonical Monte Carlo config 来源：正式 MC 数值配置仍只能从 `ExperimentPlan.config.analysisRequests.largeSample` 生成。

## 核心对象

### Run Ledger

`simulation_runs` 继续是运行主账本。M7.0 在 payload 和必要查询列中补充：

- `created_by`：启动者标识。HTTP 当前没有完整用户透传时，可先记录 session user id；本地/API 测试可记录 `"system"`。
- `created_at` / `queued_at` / `started_at` / `completed_at`：运行时间线。
- `lifecycle_status`：`active`、`archived`、`deleted`。`DELETE` 只做软删除。
- `archived_at` / `deleted_at`：生命周期时间戳。
- `run_config`：运行时配置快照，包含 `project_id`、`experiment_plan_id`、`modeling_snapshot_id`、`scenario_id`、`run_type`、`model_family`、`seed`、`steps`、Monte Carlo normalized config、`mc_experiment_id`。
- `error`：失败 code/message/details，和可下载 log artifact 指针保持一致。

### Artifact Ledger

`artifact_manifests` 继续保存 manifest payload。每个 artifact entry 必须满足：

```json
{
  "artifact_id": "run_config-run-m7-smoke-001",
  "kind": "run_config",
  "path": "run-m7-smoke-001/run-config.json",
  "media_type": "application/json",
  "sha256": "64 lowercase hex chars",
  "size_bytes": 1234,
  "schema_version": "run-config-v0"
}
```

M7.0 允许的新增 kind：

- `run_config`
- `sample_results`
- `aggregate_result`
- `metrics`

既有 kind 继续保留：`input_project`、`compiled_scenario`、`snapshot`、`time_series`、`result_summary`、`report`、`log`、`monte_carlo_base`、`analysis_projection_*`。

`contracts/artifact_manifest.schema.json` 中 artifact entry 的 `required` 数组必须包含 `artifact_id`、`kind`、`path`、`media_type`、`sha256` 和 `size_bytes`。

`run_config` artifact 必须包含 `experiment_plan_id` 和 `modeling_snapshot_id`。Adapter 可以先写基础 `run_config` 文件；`RunService` 在拿到 `ExperimentPlan`、`ModelingSnapshot` 和 request 后，必须在持久化 manifest 前重写 `run_config` 文件、注入 `experiment_plan_id` / `modeling_snapshot_id` / `plan_config` / request 摘要，并重新计算该 artifact 的 `sha256` 与 `size_bytes`。

## Runtime Audit Boundary

M7.0 只增加最小运行产物操作审计，不扩大 M4 角色、登录、授权范围：

- `GET /api/runs` 不写 `audit_events`。
- `GET /api/runs/{id}/detail` 不写 `audit_events`。
- `GET /api/runs/{id}/artifacts/{artifact_id}` 成功下载时写 `audit_events`，字段包括 actor、timestamp、`action="runs.artifact.download"`、`resource_type="run"`、`resource_id=run_id`、`outcome="allowed"` 和 artifact 摘要。
- `POST /api/runs/{id}/archive` 成功时写 `audit_events`，`action="runs.archive"`。
- `DELETE /api/runs/{id}` 软删除成功时写 `audit_events`，`action="runs.delete"`。

HTTP 当前 run 管理入口不引入新的 broad auth gate；没有用户会话的本地运行管理请求记录 `actor_user_id="system"`。

### Run Detail

`GET /api/runs/{id}/detail` 返回一个人可读、前端可直接渲染的组合对象：

```json
{
  "run": { "run_id": "run-m7-smoke-001", "status": "succeeded", "lifecycle_status": "active" },
  "chain": { "project_id": "project-m7-smoke", "experiment_plan_id": "experiment-plan-m7-smoke" },
  "result_summary": { "result_id": "result-run-m7-smoke-001" },
  "artifact_manifest": { "artifact_manifest_id": "artifact-manifest-run-m7-smoke-001", "artifacts": [] },
  "download_base": "/api/runs/run-m7-smoke-001/artifacts"
}
```

失败 run 没有 `result_summary` 时，`result_summary` 返回 `null`，但 `artifact_manifest` 仍可包含 `log` artifact。

## HTTP 设计

### `GET /api/runs`

返回运行列表，默认不返回软删除 run。

支持查询参数：

- `include_deleted=1`：包含软删除 run。
- `project_id=project-m7-smoke`
- `experiment_plan_id=experiment-plan-m7-smoke`
- `run_type=single|monte_carlo`
- `status=queued|running|succeeded|failed|cancelled`
- `limit=50`

响应：

```json
{
  "runs": [
    {
      "run_id": "run-m7-smoke-001",
      "project_id": "project-m7-smoke",
      "experiment_plan_id": "experiment-plan-m7-smoke",
      "run_type": "monte_carlo",
      "model_family": "smoke",
      "status": "succeeded",
      "phase": "completed",
      "seed": 20260621,
      "created_by": "system",
      "queued_at": "2026-06-21T00:00:00Z",
      "completed_at": "2026-06-21T00:00:01Z",
      "lifecycle_status": "active",
      "artifact_count": 11,
      "artifact_manifest_id": "artifact-manifest-run-m7-smoke-001"
    }
  ]
}
```

### `GET /api/runs/{id}/detail`

返回 run、identity chain、result summary、artifact manifest 和 lifecycle metadata。软删除 run 默认可通过 explicit id 查询，用于 tombstone 页面显示，但 detail 必须标明 `lifecycle_status: "deleted"`。

### `GET /api/runs/{id}/artifacts/{artifact_id}`

下载单个 artifact 文件。服务端必须：

1. 从该 run 的 manifest 查找 `artifact_id`，不能接受裸 path。
2. 将 manifest `path` resolve 到 `output_dir` 内，阻断 `..`、绝对路径和 symlink 越界。
3. 读取文件后计算 sha256，必须等于 manifest `sha256`；不一致返回 `409 artifact_hash_mismatch`。
4. 设置 `content-type` 为 manifest `media_type`，设置 `content-disposition: attachment; filename="<basename>"`。

### `POST /api/runs/{id}/archive`

把 active run 标记为 archived，保留结果和 artifact 下载。重复归档返回当前 archived 状态，不创建新 artifact。

### `DELETE /api/runs/{id}`

软删除 run。删除后：

- `GET /api/runs` 默认不显示该 run。
- `GET /api/runs?include_deleted=1` 显示 tombstone。
- `GET /api/runs/{id}/detail` 返回 tombstone/detail，不删除本地文件。
- 单 artifact 下载默认拒绝已删除 run，返回 `410 run_deleted`。如果后续需要管理员恢复或强制下载，另立阶段。

## 前端设计

M7.0 可以选择两种最小交付方式之一：

1. 扩展 Monte Carlo 实验详情页：在当前 identity chain 与 artifact 表上增加 `artifact_id`、`sha256`、`size_bytes`、下载、归档、删除。
2. 新增轻量“运行与产物”面板：显示 run list，点击 run 后展示 detail 和 artifact 表。

无论选择哪种，前端必须满足：

- 调用 `listRuns()` 获取 run list。
- 调用 `getRunDetail(runId)` 获取组合 detail。
- 调用 `downloadRunArtifact(runId, artifactId)` 触发下载。
- 调用 `archiveRun(runId)` 和 `deleteRun(runId)` 后刷新列表/detail。
- 不解析 projection payload，不把 artifact 下载内容用于 M8 KPI。
- 明确显示 deleted/archived 状态，避免用户以为删除是物理删除。

## 迁移与兼容

1. SQLite schema 可增加 `simulation_runs.lifecycle_status`、`archived_at`、`deleted_at`、`created_by` 查询列。旧数据库初始化时回填 `lifecycle_status='active'`。
2. `payload_json` 中的 run lifecycle metadata 是最终事实源；查询列用于列表性能和过滤。
3. 旧 manifest 缺少新增 artifacts 时，M7.0 不 retroactively 生成历史文件。新 run 必须完整登记。
4. Legacy `/api/simulation-runs` 不参与 M7.0 管理接口。

## 验收标准

1. 新 single run 的 manifest 至少包含 `run_config`、`input_project`、`compiled_scenario`、`snapshot`、`result_summary`、`metrics`、`report`、`log`。
2. 新 Monte Carlo run 的 manifest 至少包含 `run_config`、`input_project`、`compiled_scenario`、`sample_results`、`aggregate_result`、`result_summary`、`metrics`、`report`、`log`、`monte_carlo_base` 和四类 `analysis_projection_*`；现有支撑文件不再漏登记。
3. `run_config` artifact 包含 `experiment_plan_id`、`modeling_snapshot_id`、`project_id` 和 `run_id`，其 manifest `sha256` 与重写后的文件内容一致。
4. failed compile/executor run 返回 failed status，并有可下载 log artifact 或 detail 下载入口。
5. archive/delete/download 写入 `audit_events`；list/detail 不写入 `audit_events`。
6. `GET /api/runs` 能过滤/隐藏软删除 run，`GET /api/runs/{id}/detail` 能展示完整 identity chain 和 artifact ledger。
7. 单 artifact 下载只按 `artifact_id` 取文件，路径越界和 hash mismatch 被拒绝。
8. 前端展示 `artifact_id`、`kind`、`path`、`sha256`、`size_bytes` 和下载/归档/删除状态。
9. 文档和审计报告明确 M7.0 不包含生产队列、对象存储、取消重试完整体系、M8 KPI payload、M9 state stream、`aviation_support` 正式执行和 legacy run API 恢复。
