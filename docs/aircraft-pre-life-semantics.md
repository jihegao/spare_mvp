# 飞机寿命前置数据语义

`combatUnit.members[]` 的三项寿命前置字段表示仿真开始前、上次预防维修后的累计消耗：

| Project 字段 | Scenario 字段 | 单位与约束 | 正式阈值来源 |
| --- | --- | --- | --- |
| `preLifeCalendarDays` | `initial_life_state.calendar_days` | 非负整数日 | `calendarDayInterval` |
| `preLifeFlightHours` | `initial_life_state.flight_hours` | 非负有限小时数 | `runHourInterval` |
| `preLifeTakeoffLandingCount` | `initial_life_state.takeoff_landing_cycles` | 非负整数循环 | `takeoffLandingInterval` |

阈值只取按 `aircraftModel` 和可选 `equipmentId` 严格解析到该飞机的预防性维修方案。`0` 或 `null` 表示该维度禁用；不读取组件 `lifeLimitHours`，也不从任务剖面推导。多个适用方案的非零阈值按维度合并：唯一值可由任一方案贡献并记录 activity/equipment 来源，同一维度出现不同正值则阻断编译。任一累计消耗大于零但没有启用的同维阈值时同样阻断，并返回精确字段路径。

历史数据缺失 canonical 字段时物化为 `0`，不自动转换任何 legacy 字段。`takeoffLandingCount` 可能是全寿命总循环，`preLifeRequirementHours` 是要求值，`remainingLifeHours` 是剩余值，三者都不等于上次预防维修后的累计消耗；原始导入数据可保留它们，但它们不驱动 pre-life 行为。

Scenario 编译阶段就写入 `source_initial_state`、`initial_preventive_due`、`preventive_thresholds` 和 `initial_due_dimensions`，并从 `initial_ready` 中排除 minute=0 已到期飞机。模型只消费该显式到期标记创建一个预防维修工单，`due_dimensions` 保留全部到期维度；普通初始维修状态不会被误建预防工单。维修完成后三类累计量从零重新计算。单次运行、Monte Carlo、轻量 Mesa 与 Solara 都消费同一份 Scenario/model 输入。状态帧、事件和运行结果中的寿命字段用于追溯。
