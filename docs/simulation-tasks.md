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

编译阻断或全部样本失败产生的旧响应 `status: blocked` 会映射为任务 `failed`，结果接口仍保留原响应并附带具体错误码：真实编译校验失败为 `modeling_validation_failed`，全部样本超时为 `analysis_samples_timeout`，其他全部执行失败为 `analysis_samples_failed`；无具体码的兼容结果才使用 `simulation_task_blocked`。部分失败保留成功结果及失败统计。旧同步端点继续以 HTTP 200 返回原 `blocked` payload，保持兼容。

旧 `POST /api/mesa-analysis-runs` 保持同步响应，但内部提交并等待同一个任务服务和 `EngineRunner`，因此同样遵守单重任务与用户幂等规则。`EngineRunner` 通过 `SimulationEngineAdapter` 调用现有 `BackendApi.run_lite_mesa_analysis()`，继续由唯一 `SimulationAdapter` 完成 Project 编译。


## 结果来源和停机 Excel 导出

完成结果的 `analysis_source` 保存 `kind`、`projectId`、`projectName`、`experimentPlanId` 和 `experimentPlanName`，任务恢复和导出沿用该来源，不能改用后来切换的项目名称。

`POST /api/analysis-results/export-xlsx` 新增以下分支，普通 API 的 1 MiB 请求限制不变：

```json
{
  "task_id": "simulation-task-...",
  "analysis_type": "downtime_factors",
  "filters": {
    "factors": ["spare_shortage", "failure"],
    "sample_indices": [0],
    "seeds": [],
    "statuses": ["unresolved"]
  }
}
```

省略筛选表示全部。样本、种子、状态空数组表示全部，因素空数组表示不选任何因素。样本编号为零基；页面和工作簿显示编号加一。服务端检查本人归属、完成状态和分析类型，先筛选完整事件账本再计算汇总，不接受分页范围代替完整筛选集合，也不重新运行仿真。

每张明细表至多 10,000 个事件，自动分表并重复表头；总计最多 100,000 个事件、40 列、64 MiB 单元格 UTF-8 文本、64 MiB 文件，超限返回 `analysis_export_too_large` / HTTP 413，不返回部分文件。采用逐行写入并继续防护公式注入和非法 XML 字符。

前端立即显示导出中并禁用重复点击，导出专用等待上限 120 秒。任务完成 30 分钟后、服务重启或归属不符均不可访问；页面提示重新运行，不自动重跑或回退上传全量事件。其他分析类型保留快照导出兼容分支。
