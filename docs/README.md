# 项目文档入口

本目录是 `spare_mvp` 项目的文档入口。除代码、命令、路径、外部工具名称外，项目说明文档统一使用中文维护。

## 当前开发状态

截至 2026-06-18，当前原型已经具备以下能力：

1. 登录页和登录后的项目列表着陆页。
2. 从项目列表进入功能工作台，左侧按一级、二级、三级组织导航，主区显示四级功能页面。
3. 三级功能页面右上角显示当前方案名称，点击可回到对应模块的仿真实验方案列表。
4. 仿真建模和仿真实验页面不再显示“xxx入口”卡片；多四级页面使用紧凑中文标签。
5. 可视化推演页面直接嵌入 Mesa 航空保障可视化状态，不再显示外层“可视化实验启动与停止”标题和外层四级导航。
6. 蒙特卡洛实验配置页只保留参数配置和“启动”；启动后回到方案列表并显示“运行中”。
7. 蒙特卡洛评估结果已经迁移到“结果分析 / 蒙特卡洛实验结果展示”。
8. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的页面形态。
9. 保障组织建模、保障活动建模已对齐 `vendor/ship_front` 的树表编辑、方案列表和网络图形态。
10. Ontology Playground 导出关系 ID 已加唯一性约束；Monte Carlo 扫参输入会真实更新场景并重算结果。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 仓库概览、运行方式、能力范围和边界。 |
| [`3概要设计方案.md`](3概要设计方案.md) | 原始概要设计转换稿，是功能范围和术语来源。 |
| [`ontology-mesa-rebuild-plan.md`](ontology-mesa-rebuild-plan.md) | Ontology + Mesa 重构边界、里程碑和当前状态说明。 |
| [`superpowers/specs/2026-06-17-four-level-function-page-design.md`](superpowers/specs/2026-06-17-four-level-function-page-design.md) | 四级功能页面化设计规格。 |
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
