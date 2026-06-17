# 任务可靠度烟测场景

该场景用于验证“任务剖面 -> 出动准备 -> 故障/保障延迟 -> 任务成功判定 -> 任务可靠度和停机因素”的最小闭环。

主要扫参建议：

- `minRequiredSorties`: 最低出动数量。
- `failureRate`: 故障概率。
- `supportCapacity`: 保障容量。

主指标：

- `mission_success_rate`
- `ready_rate`
- `sortie_rate`
- `downtime_failure_events`
- `downtime_spare_shortage_events`
