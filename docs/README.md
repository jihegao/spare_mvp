# 项目文档入口

本目录是 `spare_mvp` 项目的文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 当前开发状态

截至 2026-06-18，当前原型已经具备以下能力：

1. 登录页和登录后的项目列表着陆页。
2. 从项目列表进入功能工作台，左侧按一级、二级、三级组织导航，主区显示四级功能页面。
3. 四级功能页面标题显示三级功能名称；功能页头不显示通用说明文案；非建模页面右上角保留当前方案名称，点击可回到对应模块的仿真实验方案列表。
4. 仿真建模页面不显示右上角“当前方案”卡片；仿真建模和仿真实验页面不再显示“xxx入口”卡片，多四级页面使用紧凑中文标签。
5. 内置场景页面配置机场、任务区的名称、位置、距离等属性；任务类型、重复周期、结束条件等字段归入“任务剖面参数”页面。
6. 基本作战单元建模页面对齐 `vendor/ship_front` 的基本使用单元形态，包含编队需求、成员飞机编号和备用机清单。
7. 基本任务建模页面对齐 `vendor/ship_front` 的基本任务结构树和信息编辑形态，包含任务编号、任务区域、装备数量、任务时长、准备/取消时间和使用保障活动。
8. 任务建模下的任务剖面能力拆为“任务剖面参数”“复合任务建模”“周期性任务建模”：参数页维护任务类型、重复周期和结束条件；复合/周期页对齐 `vendor/ship_front` 的复合任务、周期性任务建模形态，包含复合任务列表、基本任务编排、典型组合任务时序表和周期性任务周历分配。
9. 装备组成建模、装备故障建模页面对齐 `vendor/ship_front` 的装备组成树和属性配置形态；组成页默认进入装备组成建模，只显示装备组成树以及组件名称、父节点、备件类型、连接类型，故障页显示数量、n 中取 k、故障属性和 RMS 指标。
10. 保障组织建模、保障活动建模页面保留外层四级导航，删除内部重复页签；保障组织的备件、人员、设备四级页会跳转到对应资源表，保障活动页面已对齐 `vendor/ship_front` 的树编辑、工作项目清单和网络图形态。
11. 可视化推演页面恢复三级标题“可视化推演”，只保留一个可导航入口并直接嵌入 Mesa 航空保障可视化状态；飞机、任务、保障和 `Ontology视图` 在 Mesa 页面内部切换，旧的场景切换、结果展示 hash 兼容回流到该入口。
12. 蒙特卡洛实验配置页只读展示当前仿真实验，只保留参数配置和“启动”；启动后回到方案列表并显示“运行中”。
13. 蒙特卡洛评估结果已经迁移到“结果分析 / 蒙特卡洛实验结果展示”。
14. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的页面形态。
15. Ontology Playground 导出关系 ID 已加唯一性约束；Monte Carlo 扫参输入会真实更新场景并重算结果。
16. Mesa `Ontology视图` 的后续约定为四层纵向画布：`建模对象 -> 仿真实验 -> 模型实例 -> 计算产物`；建模对象层对齐前端四级功能，模型实例层按 `AviationSupportModel` 的真实 Mesa/Python 运行时对象绘制，并包含当前 step 的指标对象。
17. M2a / PR-C 已增加最小 `SimulationAdapter`：当前支持 Project JSON 根字段校验、`smoke` Scenario 编译、`SmokeSpareMvpModel` 运行、Result summary 和 ArtifactManifest 生成；`aviation_support` Scenario 编译仍需先完成治理批准的字段派生规则。
18. PR-D 已增加 SQLite 数据持久化切片：`schema.sql` 声明项目、用户、方案、建模快照、场景、运行、结果摘要和产物清单表；repository helper 可保存 contract 对象并按 `run_id` 查询版本化身份链。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`3概要设计方案.md`](3概要设计方案.md) | 原始概要设计转换稿，是功能范围和术语来源。 |
| [`product-roadmap.md`](product-roadmap.md) | 从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。 |
| [`simulation-service-governance.md`](simulation-service-governance.md) | Mesa 仿真服务治理、Claude 对齐规则和 6 类 agent swarm 分工。 |
| [`ontology-mesa-rebuild-plan.md`](ontology-mesa-rebuild-plan.md) | Ontology + Mesa 重构边界、里程碑、当前状态和四层可视化约定。 |
| [`../contracts/README.md`](../contracts/README.md) | Contract Curator Agent 发布的 Project / Scenario / Run / Result / ArtifactManifest schema bundle。 |
| [`../src/spare_mvp_contract/adapter.py`](../src/spare_mvp_contract/adapter.py) | M2a / PR-C 的最小 Simulation Adapter，负责已批准的 Project -> Scenario -> Run/Result/ArtifactManifest 链路。 |
| [`../src/spare_mvp_backend/schema.sql`](../src/spare_mvp_backend/schema.sql) | PR-D 的 SQLite 持久化 schema，用于保存版本化 contract 对象和运行身份链。 |
| [`superpowers/specs/2026-06-17-four-level-function-page-design.md`](superpowers/specs/2026-06-17-four-level-function-page-design.md) | 四级功能页面化设计规格。 |
| [`superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md`](superpowers/plans/2026-06-18-agent-swarm-contract-first-development.md) | contract-first agent swarm 分阶段开发计划。 |
| [`superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md`](superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md) | 当前前端集成实现记录和验收情况。 |
| [`../src/spare_mvp_abm/aviation_support/README.md`](../src/spare_mvp_abm/aviation_support/README.md) | 本地 Mesa 航空保障场景包说明。 |
| [`../agent.md`](../agent.md) | 后续 agent 协作、验证和 subagent 使用约定。 |

## 运行与验证入口

```bash
npm test
python3 -m http.server 4173
```

浏览器访问：

```text
http://127.0.0.1:4173/front/
```

## 文档维护规则

1. 新增功能或修改页面流转时，同步更新本入口和相关设计/实现记录。
2. 对外说明使用中文；保留代码标识、命令、路径、文件名和外部项目名的原文。
3. 文档不得把静态原型或小样本仿真描述成工程级校准平台。
4. 引用 `vendor/` 或 skill 资产时，必须说明其只是本项目的本地参考或本地副本，运行时代码不得依赖用户主目录下的原始路径。
5. 删除旧 UI、迁移入口、移除路由、改变结果来源或替换可视化承载位置时，必须用旧文案和新文案搜索 `README.md`、`docs/`、`agent.md`，同步更新当前状态文档；历史设计稿保留时必须标注当前实现差异。
