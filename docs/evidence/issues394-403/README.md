# 11 项 issue 整合修复验收记录

日期：2026-09-22。范围：#385、#394–#403。基线：`main@8b55e81549d906c02cf3c3fde9c01b8e48c0923c`；实现为本轮工作区补丁，尚未生成发布版本。

## 实现与边界

当前规则见 [`../../analysis-results-contract.md`](../../analysis-results-contract.md)。本轮交付导航状态、错误分类、指标名称与展示删减、携行清单归一化、互斥停机分段、样本筛选与算术平均趋势、任务引用分表导出、来源文件名、实验名称原子事务及框图视口。

案例动力装置改 LRU 的业务决定另行实施；没有迁移案例产品类型、库存或冻结方案。没有 Windows 打包部署，没有关闭 issue。本记录不构成 Windows 原生验收或工程级模型校准。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 787 项通过；完整套件在允许 Python 子进程的环境运行 |
| Playwright `frontend-smoke`、`table-pagination`、`v2-workbench-pagination` | 11 项通过 |
| `test_backend_api_contract` | 184 项通过；其中两项本地 HTTP 用例在允许监听端口的环境补跑 |
| `test_issue395_names`、`test_analysis_error_identity`、`test_downtime_issue401`、Project 契约、数据库与权限 | 合计 64 项通过 |
| `test_project_json_exporter`、`test_clean_project_golden_fixtures` | 45 项通过 |
| `test_spare_immediate_fill` | 14 项通过 |
| 模型、Simulation Adapter、XLSX、任务服务首轮回归 | 212 项通过；其中两项 HTTP 用例单独补跑 |
| 导出任务引用及既有导出/HTTP 聚焦回归 | 29 项通过 |
| `git diff --check` | 通过 |

上表存在交叉用例，不相加作为独立测试总数。沙箱禁止 socket 或 Node 启动 Python 时的 `EPERM` / `PermissionError` 已用相同测试在允许相应本地能力的环境复核，没有通过删除断言或跳过用例消除错误。

关键回归包括：四页任务占用只显示一次；超时/执行失败不误报建模不足；同项目跨用户名称查重、并发最多一成功及快照回滚；0/"0" 与不可用需求的区别；原始比例 0.9 边界与百分点余量；1/1、0/9 的样本率均值为 50%；缺失率不补零、缺口保留波次；等待和维修不重叠、截止不伪造完成时间；全部筛选行导出。

导出构造数据测试覆盖 3,218 条唯一事件的真实 HTTP 任务引用，Excel 实际超过 1 MiB，普通请求体大于 1 MiB 仍拒绝；10,001 条分表逐行核对 seed/机号顺序，未遗漏或重复。容量测试以受控上限覆盖精确边界与超一边界，另覆盖列数、文本、文件大小、过期、跨用户、失败任务和服务重启。这些属于自动化构造数据证据，不等同于现场案例验收。

## 当前 F35 案例副本

真实案例检查通过 SQLite backup 副本执行，源库不用于写入。模型输入仍沿 `ContractRepository → ProjectJsonExporter → BackendApi → SimulationAdapter` 生成。

四个固定 seed（20260621–20260624）均成功完成。实际需求数量各为 3，总计 12；仅 seed 20260623 即时满足并消耗 1 件，每样本实际携行量为 501。由此两项指标的有效样本均为 4，满足率样本均值为 1/12，利用率样本均值为 1/2004。此处是当前副本观测值，不沿用历史案例数量，也不声明模型已校准。

停机任务的四样本账本共 271 段：故障维修 33、备件短缺 11、预防性维修 227、保障设备短缺 0；257 段完成、11 段截止未恢复、3 段阶段转换。无库存按真实等待输出，没有额外启动警告。

真实浏览器检查使用当前 F35 的长名称和 424 个组件，验证树宽约束、分页重绘、10%–400% 缩放、100%、适应窗口、鼠标中心和框内滚动。操作前后模型 payload 哈希一致。源码指纹、数据库副本标识、逐行导出核验、截图和工作簿随本目录证据文件保存；完整数据库及 Project 副本只保留在独立 `/tmp` 验收目录。

证据入口：

- [当前案例独立验收说明](current-case.md)及[机器可读总记录](acceptance-summary.json)
- [框图可见视口截图](rbd-visible-viewport.png)及[浏览器检查结果](rbd-browser-acceptance.json)
- [实际停机工作簿](f35-downtime-task-reference.xlsx)及[逐行完整性检查](task-reference-export-completeness.json)：271/271 行、16 字段完全一致，总时长 9594.666667 小时
- [四 seed 原始指标](fixed-seed-actual-metrics.json)
