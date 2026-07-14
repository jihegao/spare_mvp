# 自动化验证记录

## 已完成

- 前端完整测试：`npm test`，445/445 通过。
- Solara 目标测试：`tests.test_aircraft_support_v1_solara`，8/8 通过。
- 后端完整目标测试：`tests.test_aircraft_support_v1_model`、`tests.test_backend_api_contract`、`tests.test_backend_http_api`，216/216 通过。
- RMS `.xlsx` 导出由真实 Excel 工作簿生成；#188 后表头与页面节点结果统一为层级、节点、型号、安装数、运行比、分配份额、状态，并由 openpyxl 真实性和逐字段测试覆盖。
- #181 运行上下文由前端运行时与源码契约测试覆盖：无保存方案时默认使用当前 Project，非法无 ID 方案与未保存内存分支不进入选项，直接运行不创建 ExperimentPlan；方案列表勾选、编辑和保存不改变独立运行来源；选择已保存方案时提交 clean Project JSON，Solara 通过独立 URL 上下文接收经校验的 `experiment_plan_id` 与 `steps/samples/seed` 并作为 `runtime_config` 编译，且不创建新方案；切回无根 `experiment` 的当前 Project 或所选方案刷新后失效时恢复页面默认样本量与随机种子。

## 本轮复核范围

- 正式分析投影：并列最高缺件备件。
- 实验方案：基本信息、运行配置、分析配置三组，页面不再出现 Scenario 编辑区。
- 任务可靠性：连续 7 天运行有效，休息日自然通过，仅校验计划任务是否全部完成。
- 停机因素：人员等待与设备短缺分离；四类停机时长互斥归因。
- 项目 JSON 覆盖：版本条件更新与审计记录在同一事务提交。
- 浏览器：项目数据管理、颗粒度、RMS、可视化推演及推演运行状态；项目数据管理当前不再展示 Project JSON 原始数据区。

## 已知限制

- 修改前截图来自 2026-06-25 历史验收，项目数据、账号和视口并非完全一致。
- 本目录没有装备搜索、周期任务、导入错误提示等交互的逐项截图；这些项以自动化测试和代码评审为证据。
