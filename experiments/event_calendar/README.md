# 事件日历提速实验

这是独立调度实验，生产入口未接入。输入仍经过
`ContractRepository → ProjectJsonExporter → SimulationAdapter → simulation_inputs`，
没有第二套 Project 编译器，没有修改运行数据库。

## 实验问题与范围

在保留现有业务行为、事件顺序、随机数序列和指标定义的条件下，跳过没有状态变化的分钟，能带来多少收益？SimPy 的调度成本是否显著？

三组共用现有任务、故障、维修、运输和资源分配方法：

1. `AircraftSupportV1Model`：现有逐分钟基线。
2. `CalendarModel`：静态时间表 + 动态下一事件计算，直接跳时。
3. `SimpyCalendarModel`：相同跳时策略，使用 SimPy 4.1.1 `Environment/Timeout` 推进日历。

`CalendarIR` 只包含任务准备、计划出动、取消和停止时间等静态唤醒点。
动态唤醒包含返航、作业完成、故障倒计时、运输到达、预防维修阈值、任务成功检查点和统计采样。
同一分钟内仍完整调用原 `step()`，保留运输→返航→作业→故障→预防维修→飞前保障→资源分配→出动→统计的顺序。

**这不是完整的可执行图 IR，也不是独立重写的 SimPy process/resource 模型。**
它隔离测量调度改变的收益，不能证明数组化、图共享、Numba/Rust 或 GPU 的收益。
静态时间表每次初始化生成，计时包含其成本；尚未测试跨样本共享编译图。

## 为保证等价保留的成本

- 有 waiting 作业，或已到准备窗口但尚未出动的任务时，继续逐分钟运行。
  当前等待重试会生成事件并累计人员／设备短缺计数，直接删除会改变结果。
- 故障倒计时对跳过的每分钟重复同样的浮点减法，避免一次减去整个间隔造成舍入差异。
  随机抽样仍由原方法执行，未引入新随机流。
- 稳定区间的停机时间按区间长度积分，变化边界仍以一分钟计入。
- 仅支持 `tick_minutes=1`、无可视化帧、无事件快照。其他配置明确拒绝。
  实验不提供逐分钟 UI `step()` 语义，也不支持初始化后修改任务时间表。

## 复现

使用项目的 Python >=3.12 环境及既有项目依赖：

```bash
.abm-mesa-test-env/bin/python -m pip install -r experiments/event_calendar/requirements.txt
.abm-mesa-test-env/bin/python experiments/event_calendar/verify.py experiments/event_calendar/verification.json

.abm-mesa-test-env/bin/python experiments/event_calendar/benchmark.py \
  --database runs/database-backups/spare_mvp-20260918-165806-before-restore-4700-4-e0f7824.sqlite3 \
  --project-id project-case-expanded-j16d-configuration-20260727 \
  --project-id project-preventive-maintenance-lru0-transfer-20260726 \
  --seeds 0,1,7 --repeats 3 \
  --output experiments/event_calendar/results.json
```

上述数据库是本机历史快照，以 SQLite `mode=ro` 打开；它不是版本控制内的可复现 fixture，也不会提交实验包。
其他机器可用 `--project /path/to/project.json` 替代数据库参数；原始 Project 的 SHA-256、规范输入 SHA-256 和运行环境写入报告，用于核对是否为同一案例。
仓库公开案例也可直接运行：

```bash
.abm-mesa-test-env/bin/python experiments/event_calendar/benchmark.py \
  --project tests/fixtures/aircraft_support_v1_project.json \
  --seeds 0,1,7 --repeats 3 \
  --output experiments/event_calendar/fixture-results.json
```

计时在同一进程内进行，先预热，每种子重复三次并轮换引擎次序。
报告的总耗时包含模型构造、日历构造、运行和返回结果构造；不包含 Project 导出、Adapter 编译、数据库／文件 I/O、多进程启动或 Monte Carlo 聚合。
Project 导出和 Adapter 编译另列一次耗时；三组输入完全相同且均关闭可视化帧。
因此速度比不是 API 端到端速度比，也不能直接与先前对话中的单样本历史计时比较。

## 等价性证据

`benchmark.py` 对完整返回对象逐字段比较，包括事件列表顺序、所有指标、停机事件、生命周期轨迹和组织调度摘要；额外比较飞机、任务、作业、节点资源、在途运输、逻辑步数和 RNG 最终状态。任意差异立即失败，报告首个不同路径。

`verify.py` 使用仓库已有的底层输入 fixture 辅助函数，验证无故障／故障、资源不足、任务取消、预防维修、指定时间停止、故障停止、重叠任务、冗余组件、零时长作业、纵向／横向运输、无任务日历维护。在候选引擎每个唤醒边界，将基线逐分钟推进到同一时刻，比较完整业务状态、事件和指标，再比较最终返回值。它验证已覆盖情形，不等于对所有合法输入的形式化等价证明。

## 2026-09-18 实测结果

基线 commit `1091c98eeca25b99566df1f3143e1f3d183da33c`，Python 3.12.13，SimPy 4.1.1。
每案例使用种子 0、1、7，每种子每引擎重复 3 次；下表为 9 次的中位数，单位秒。

| 案例 | 分钟基线 | 直接日历 | SimPy 日历 | 直接日历加速比 | SimPy 加速比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| J16D expanded | 2.9342 | 2.2021 | 2.2180 | 1.33× | 1.32× |
| 预防维修 + 运输 | 0.8149 | 0.0740 | 0.0780 | 11.00× | 10.44× |
| 公开 contract fixture | 0.00814 | 0.00064 | 0.00071 | 12.68× | 11.44× |

公开 fixture 的绝对耗时很小，只作为可移植的复现／正确性用例，不能据此估计大型业务模型吞吐量。
原始计时见 [results.json](results.json) 和 [fixture-results.json](fixture-results.json)。

- J16D 配置最长 10,080 分钟，实际按原停止语义在 5,705 分钟结束。日历执行 3,163～3,166 次完整 tick，跳过约 44.5%。
- 预防维修案例配置最长 40,320 分钟，实际在 38,162 分钟结束。日历执行 1,273 次完整 tick，跳过约 96.7%。
- 三个案例的 54 组候选／基线比较全部严格一致（3 案例 × 3 种子 × 3 重复 × 2 候选）。
- 补充边界验证完成 78 组运行、2,780 个边界及 3 个不支持配置拒绝检查，见 [verification.json](verification.json)。
- 现有模型、Project 契约、SimulationAdapter、ProjectJsonExporter 共 240 项回归测试通过；`git diff --check` 及新增文件空白检查通过。

回归检查命令：

```bash
.abm-mesa-test-env/bin/python -m unittest \
  tests.test_aircraft_support_v1_model \
  tests.test_aircraft_support_v1_project_contract \
  tests.test_simulation_adapter \
  tests.test_project_json_exporter
git diff --check
```

实验证明：**对当前这些输入，保留原语义的事件跳时可行，但收益高度依赖空闲区间比例。**
SimPy 相比直接日历的中位总耗时，在 J16D 上约增加 0.7%，在预防维修案例上约增加 5.4%；本实验没有显示出“必须先替换 SimPy 才能提速”的依据。

本次并未证明 J16D 可以获得数量级加速，更未证明预展开随机分支 DAG 有效。
若继续推进，优先明确分钟等待计数／日志的兼容要求，再把剩余高频扫描和动态结构转换为可共享的运行 IR，建立更广的同种子边界差分验证后，才考虑接入批量运行入口。
