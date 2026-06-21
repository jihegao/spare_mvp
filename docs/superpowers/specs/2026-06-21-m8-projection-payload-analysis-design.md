# M8.0 Projection Payload 驱动结果分析设计

## 目标

M8.0 将四个结果分析页从“artifact 元数据解锁 + 本地预览 KPI”推进到“正式 `analysis_projection_*` payload 驱动 KPI、表格和图形”的最小闭环。正式结果必须来自绑定 Monte Carlo run 的 artifact payload，不能继续使用 `singleResult`、`runSimulation()`、`runMonteCarlo()` 或页面内置 preview fixture 作为正式值来源。

## 输入边界

正式分析页必须同时满足：

1. AnalysisTask 已创建并绑定 `linkedMonteCarloExperimentId`。
2. 绑定的 Monte Carlo 实验有完成态 `run_id`。
3. 当前后端 run 与绑定实验一致，且 `run_type=monte_carlo`。
4. run 带 compiler provenance。
5. artifact manifest 中存在 `monte_carlo_base`。
6. artifact manifest 中存在当前分析类型对应的 projection artifact。
7. 前端已通过 `GET /api/runs/{run_id}/artifacts/{artifact_id}` 下载并成功解析对应 JSON payload。

缺少任一条件时，页面必须 fail closed，显示未配置、待运行、运行中、运行失败、输入未通过编译或“本地预览，不是正式后端仿真结果”，不得把本地预览值渲染为正式结果。

## Projection 映射

| 页面 | artifact kind | payload `projection_type` |
| --- | --- | --- |
| 备件短板分析 | `analysis_projection_spare_shortfall` | `spare_shortfall` |
| 飞机转场携行清单分析 | `analysis_projection_carry_list` | `carry_list` |
| 任务可靠度评估 | `analysis_projection_mission_reliability` | `mission_reliability` |
| 停机因素分析 | `analysis_projection_downtime_factors` | `downtime_factors` |

前端选择 artifact 时必须按 `kind` / `analysis_type` / `projection_type` 精确匹配，不能靠路径或 id 的松散文本包含关系误匹配。payload normalize 时必须校验 `projection_type` 与页面分析类型一致。

## 当前实现

- `front/api-client.mjs` 新增 `getRunArtifactPayload(runId, artifactId)`，复用 canonical artifact 下载路径并按 JSON 响应解析 payload。
- `front/analysis-projection-adapters.mjs` 负责四类 payload 的 fail-closed normalize，并输出页面可渲染的 metrics/rows。
- `front/app.js` 在 run 完成刷新时下载四类 projection payload；`formalAnalysisBoundary()` 只有在 payload 已解析成功后才解锁正式结果。
- 四个分析 dashboard 在正式态使用 projection payload 的 metrics/rows 渲染 KPI、表格和图形；预览态继续保留明确的本地预览标记。

## 非目标

M8.0 不实现生产 worker queue、object storage、取消/重试完整体系、长期 artifact storage、M9 state stream、`aviation_support` 正式执行、完整置信区间/分布统计、异常样本钻取或报告导出体系。M7 的 run/artifact 生命周期管理和 M8 的 payload 消费共享 canonical `/api/runs` 与 `run_id + artifact_id` 定位规则。

## 验证

当前测试覆盖：

1. `tests/frontend-api-client.test.mjs`：前端 API client 可按 JSON 读取 artifact payload。
2. `tests/analysis-projection-adapters.test.mjs`：四类 projection payload normalize 和错误 payload fail closed。
3. `tests/frontend-contract.test.mjs`：正式分析页刷新 projection payload，formal rendering 使用 payload metrics，且正式 run 不消费本地 preview 输出。
