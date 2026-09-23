# #394–#403 当前 F35 案例独立验收

验收基于 `main@8b55e81549d906c02cf3c3fde9c01b8e48c0923c` 的未提交集成源码。运行时源码包指纹为 `5fc6a479cb1d9d5f54c94647923a9fc263acdf69588aec82e8ba0da3db3371fb`。源数据库 `runs/system-start/spare_mvp.sqlite3` 前后 SHA-256 均为 `2614c80566ac372a6c7428fd7b4b9dcbb4b0d5319f083d3a40c0f29761bbec2c`；所有运行只使用 `/tmp` 中的 SQLite backup。F35 项目 payload 前后 SHA-256 均为 `68f376719bdd5cd9d5f5b2cdfe0f9ffd84662042213d14b14c67b34222f33926`。

- 四个固定种子 `20260621–20260624` 均通过 `ContractRepository → ProjectJsonExporter → BackendApi → SimulationAdapter` 完成，4/4 成功。当前案例原始合计：计划 832 架次、出动 690、完成 646；备件需求 12、立即满足 1、消耗 1，各样本携行 501。
- RBD 使用真实 F35 项目在 Chromium 151 实测通过：长名称保留全文和 title，树宽从 300px 调至当前布局上限 692px 后右侧仍保留 320px；71 个节点从第 1/4 页切换至第 2/4 页；10%–400% 缩放边界、100%、鼠标中心滚轮缩放、适应窗口及框内滚动均通过。最终 RBD 源码指纹前后相同。
- 停机分析通过进程内 task reference 导出真实 4 样本结果：271 条事件，其中装备故障 33、备件短缺 11、预防性维修 227；状态为已完成 257、阶段转换 3、未解决 11。11 条短缺均保留 `organization_no_available_ancestor`，启动库存警告为 0。
- 导出 XLSX 含“分析信息、结果摘要、因素排行、停机事件明细”四张表和全部 271 条事件。已将 XLSX 全部 271 行逐行与服务端有序事件账本的 16 个导出字段比较，271/271 完全一致；样本、种子、机号、因素、起止时间、时长和状态的顺序一致，事件总数及累计 9594.666667 小时也一致。末行实际证据为样本 1、seed `20260621`、F35-05 在 `DAY_44 00:00` 仿真截止，状态“未修复·仍等待备件”，短缺原因“上级组织无可用库存”，未伪造到货时间。

主要文件：

- `acceptance-summary.json`：可机器读取的总验收结论
- `fixed-seed-actual-metrics.json`：四个固定种子的原始标量指标
- `rbd-browser-acceptance.json`、`rbd-visible-viewport.png`：真实浏览器报告与可读的 1440×1000 当前视口截图
- `task-reference-export-acceptance.json`、`task-reference-export-completeness.json`、`f35-downtime-task-reference.xlsx`：任务引用导出报告、逐行完整性报告与工作簿

本次没有修改源数据库、案例产品类型、库存、可靠度参数或冻结方案，也没有执行 Windows 打包或 Windows 原生验收。
