# 飞机寿命前置数据语义

`combatUnit.members[]` 的三项寿命前置字段表示仿真开始前的历史累计消耗。编译器假设历史上已经跨过的完整预防维修周期均按时完成，因此运行时只继承当前周期余量：

| Project 字段 | Scenario 字段 | 单位与约束 | 正式阈值来源 |
| --- | --- | --- | --- |
| `preLifeCalendarDays` | `initial_life_state.calendar_days` | 非负整数日 | `calendarDayInterval` |
| `preLifeFlightHours` | `initial_life_state.flight_hours` | 非负有限小时数 | `runHourInterval` |
| `preLifeTakeoffLandingCount` | `initial_life_state.takeoff_landing_cycles` | 非负整数循环 | `takeoffLandingInterval` |

阈值只取按 `aircraftModel` 和可选 `equipmentId` 严格解析到该飞机的预防性维修方案。`0` 或 `null` 表示该维度禁用；不读取组件 `lifeLimitHours`，也不从任务剖面推导。每个适用方案保留自己的日历日、飞行小时和起落次数周期及 activity/equipment 来源；同一维度可以有不同的正值（例如 25 小时与 50 小时），并分别触发对应维修。任一累计消耗大于零但没有启用的同维阈值时同样阻断，并返回精确字段路径。

历史数据缺失 canonical 字段时物化为 `0`，不自动转换任何 legacy 字段。`takeoffLandingCount` 可能是全寿命总循环，`preLifeRequirementHours` 是要求值，`remainingLifeHours` 是剩余值，三者都不等于上次预防维修后的累计消耗；原始导入数据可保留它们，但它们不驱动 pre-life 行为。

Scenario 编译阶段把 Project 原值保存在 `source_initial_life_state`，并为每个启用方案分别计算其周期余量。未启用阈值的维度保持原值；正累计值缺少同维阈值仍失败关闭。取余后的飞机不会因为历史完整周期在 minute=0 重复创建定检工单，`initial_preventive_due=false`、`initial_due_dimensions=[]`，初始可用状态保持与 Project 一致。进入仿真后，各方案计数器从自己的余量继续累积，到达阈值时创建对应预防维修工单；维修完成后只重置该方案启用的计数器。单次运行、Monte Carlo、轻量 Mesa 与 Solara 都消费同一份 Scenario/model 输入。
