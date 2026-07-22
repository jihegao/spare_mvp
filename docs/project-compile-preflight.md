# Project 运行编译预检

运行编译预检用于判断已保存 Project 或 ExperimentPlan 是否能通过正式 `aircraft_support_v1` Scenario compiler gate。它只返回可运行状态和字段级诊断，不返回编译后的 Scenario，也不创建 ModelingSnapshot、Scenario、SimulationRun、ResultSummary 或 ArtifactManifest。

## HTTP 接口

两个接口均使用 `POST`，要求有效的 bearer session；请求体可省略，当前唯一支持的正式模型族是 `aircraft_support_v1`。

```text
POST /api/projects/{project_id}/compile-preflight
POST /api/projects/{project_id}/experiment-plans/{experiment_plan_id}/compile-preflight
```

可选请求体：

```json
{
  "model_family": "aircraft_support_v1"
}
```

响应使用 `project-compile-preflight-v0`：

```json
{
  "schema_version": "project-compile-preflight-v0",
  "project_id": "project-example",
  "model_family": "aircraft_support_v1",
  "status": "blocked",
  "issues": [
    {
      "code": "missing_support_activities",
      "message": "保障活动不能为空。",
      "field_path": "supportActivities",
      "page": "保障活动建模",
      "severity": "error",
      "suggestion": "修正输入后重新执行运行编译预检。"
    }
  ],
  "warnings": []
}
```

ExperimentPlan 响应额外包含 `experiment_plan_id`。预检复用正式运行路径的输入解析规则：优先使用 `ExperimentPlan.config.projectJson` 分支，否则回退到绑定的 ModelingSnapshot，再回退到已保存 Project；运行配置只作为 Adapter 编译参数读取，不写回 Project。

预检编译与正式 run lifecycle 使用同一进程锁。共享 `SimulationAdapter` 实例时，两者不会并发改写编译输入快照缓存，正式 run 的 `input_project` artifact 因而始终对应本次 run 自己的 Project/ExperimentPlan 分支。

## 状态边界

- `compiled`：输入已通过当前正式 compiler gate；响应仍不持久化 Scenario。
- `blocked`：`issues[]` 给出 `code`、`field_path`、`page` 和 `suggestion`，供宿主页面定位建模字段。
- `unsupported`：请求了已退役或未知模型族。
- Project 或 ExperimentPlan 不存在时返回 HTTP 404；方案归属或分支 Project ID 与请求项目不一致时返回 `project_plan_mismatch`，不尝试猜测或回退到其他方案。

该接口不改变 Project 的“草稿已保存”语义。前端是否允许创建草稿方案、何时展示“可运行”、以及何时挂载 Solara iframe，由后续 UI 集成负责。
