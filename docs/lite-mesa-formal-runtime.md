# Lite Mesa 正式产品运行路径说明

日期：2026-07-08
状态：路线收敛说明
跟踪 issue：#147

## 结论

当前用户可见的正式产品运行路径收敛为 lite Mesa 分析会话。

主路径为：当前 Project 数据进入 `POST /api/mesa-analysis-runs` Mesa 分析接口，后端编译为 `aircraft_support_v1` simulation inputs，然后在内存中运行 `AircraftSupportV1Model` 样本并返回 lite Mesa 会话摘要。

## 当前边界

- 用户可见分析、Monte Carlo 和可视化结果应优先来自 lite Mesa 会话结果。
- lite Mesa 会话读取当前 Project 数据，不修改 Project，不创建运行账本，不生成持久化结果产物。
- `aircraft_support_v1` 是当前正式模型核心。
- 旧 `/api/runs` 运行账本路径、RunService、SimulationRun、ResultSummary 和 ArtifactManifest 后续只作为历史实现、内部治理能力或后续持久化运行治理候选。

## 后续切片

1. 更新活跃文档和 agent 协作约定，统一产品路线表述。
2. 前端入口收敛到 lite Mesa 会话接口。
3. 后端为旧运行账本路径保留清晰迁移提示。
4. 测试保留 lite Mesa 正向契约，并调整旧路径的契约定位。
5. 再决定 RunService 是否迁移到 legacy/internal 命名空间。

## 验收口径

- 当前用户主流程不再依赖运行账本路径作为正式结果来源。
- 页面正式结果来自 lite Mesa 会话返回的指标、表格和事件摘要。
- 文档不得把小样本会话结果描述成工程级校准结论。
