# 仿真任务 API

耗时分析通过进程内 `SimulationTaskService` 执行。任务状态不写入 SQLite，服务重启后不恢复；终态结果保留 30 分钟。每个后端实例同时只运行一个重任务。

## 创建任务

`POST /api/simulation-tasks` 需要登录，复用 `/api/mesa-analysis-runs` 的请求字段：

```json
{
  "kind": "lite_mesa_analysis",
  "context": {},
  "analysis_type": "mission_reliability",
  "settings": {"samples": 50, "seed": 42, "parallelCores": 8},
  "model_family": "aircraft_support_v1"
}
```

`kind` 可省略，目前只支持 `lite_mesa_analysis`。`context` 与旧接口一致；也可继续提交 `project` 或 `projectJson`。提交时服务会深拷贝请求并计算 `input_fingerprint`，之后的 Project 编辑不改变运行输入。

服务先归一化 `kind`、`analysisType` / `analysis_type`、`projectJson` / `project` 和默认 `model_family`，同时原样保留 `settings` 中影响执行的字段，再计算指纹并保存规范化请求。同一用户重复提交语义相同的活动请求时返回原 `task_id`。已有其他重任务时返回 HTTP 409 `simulation_task_busy`，响应不会包含活动任务标识。

创建和查询状态均返回：

```json
{
  "task_id": "simulation-task-...",
  "status": "running",
  "stage": "running",
  "processed": 12,
  "total": 50,
  "succeeded": 12,
  "failed": 0,
  "elapsed_seconds": 8.4,
  "eta_seconds": 26.6,
  "input_fingerprint": "...",
  "created_at": "...",
  "started_at": "...",
  "completed_at": null,
  "expires_at": null
}
```

状态仅有 `running`、`completed`、`failed`。样本计数来自实际 worker 结果，并强制满足非负、单调、`processed = succeeded + failed` 和 `processed <= total`；非法或倒退的内部回调不会覆盖最后一次合法状态。尚无已完成样本时 `eta_seconds` 为 `null`，终态时也固定为 `null`。

## 查询状态与结果

- `GET /api/simulation-tasks/{task_id}`：返回任务状态。
- `GET /api/simulation-tasks/{task_id}/result`：完成后返回 `{task_id, status, result}`，其中 `result` 保持旧 `/api/mesa-analysis-runs` 的响应结构。

运行中查询结果返回 HTTP 409 `simulation_task_not_completed`。不存在、已过期和不属于当前用户的任务统一返回 HTTP 404 `simulation_task_not_found`，避免泄露其他用户的任务标识。未处理异常只向客户端返回通用 `simulation_task_failed`，详细异常仅写入服务日志。

编译阻断或全部样本失败产生的旧响应 `status: blocked` 会映射为任务 `failed`，结果接口仍保留原响应并附带 `simulation_task_blocked` 标准错误。旧同步端点继续以 HTTP 200 返回原 `blocked` payload，保持兼容。

旧 `POST /api/mesa-analysis-runs` 保持同步响应，但内部提交并等待同一个任务服务和 `EngineRunner`，因此同样遵守单重任务与用户幂等规则。`EngineRunner` 通过 `SimulationEngineAdapter` 调用现有 `BackendApi.run_lite_mesa_analysis()`，继续由唯一 `SimulationAdapter` 完成 Project 编译。
