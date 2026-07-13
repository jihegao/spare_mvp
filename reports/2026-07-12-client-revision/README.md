# 2026-07-10 甲方修改意见浏览器验收记录

本目录保存 2026-07-12 实施验收截图。证据分为历史修改前、当前修改后、并排对比和关键交互状态四类；所有图片均复制到本报告目录，不依赖临时输出目录。

## 可直接比较的证据

| 页面 | 修改前 | 修改后 | 并排对比 | 说明 |
|---|---|---|---|---|
| 项目列表 | `before/01-project-list-before.jpg` | `after/01-project-list-after.png` | `compare/01-project-list-before-after.png` | 历史基线账号、项目数据和视口不同，仅作为布局辅助证据 |
| RMS 指标分配 | `before/02-rms-allocation-before.jpg` | `after/04-rms-allocation-after.png` | `compare/02-rms-allocation-before-after.png` | 同页核心对比；可见旧 Ai/Ao/状态区域移除，以及安装树、MTBF、导入/导出布局 |

## 仅修改后证据

| 截图 | 验收内容 |
|---|---|
| `after/02-project-data-management-after.png` | 历史证据：数据管理入口、数据概览及 #185 移除前的 Project JSON 折叠区；不再作为当前页面验收图 |
| `after/03-granularity-management-after.png` | 两种保障仿真颗粒度和蓝色选中状态 |
| `after/05-visual-simulation-after.png` | 顶部方案工具栏、压缩标题区和扩大后的推演区域 |

这些页面没有可确认的同页历史截图，因此不标记为“修改前后对比”。

## 关键交互状态

| 截图 | 验收内容 |
|---|---|
| `interaction/01-visual-simulation-running.png` | 推演已启动，飞机视图、运行控制和指标区域正常显示 |

## Subagent 评审结论

- 前端评审发现并修正：实验方案重复字段和 Scenario 编辑模块、装备搜索输入焦点、周期任务复制 ID、并列最高缺件展示、工作项目导入数值校验。
- 仿真/后端评审发现并修正：7 天可靠性不应要求休息日存在任务、人员等待不得归入设备短缺、预防性维修采用累计事件数、同一飞机停机时长按优先级互斥归因、Excel 依赖声明。
- 证据评审确认 RMS 是本轮最强修改前后证据；项目列表只作为辅助对比，其他新页面只列修改后截图，避免扩大截图可证明的范围。

自动化验证结果见 `test-results.md`。

## #185 后续收口

项目数据管理页不再渲染 Project JSON 原始数据区及递归查看器。当前验收以运行时测试确认查看区完全缺席，同时确认模板管理、数据概览、JSON 文件选择和覆盖流程入口仍存在；上述历史截图保留用于说明变更前状态。
