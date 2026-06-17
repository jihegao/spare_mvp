# 备件规划 Smoke 场景

该场景用于验证“任务需求 -> 装备故障 -> 保障活动 -> 库存消耗/短缺 -> 备件短板和携行清单”的最小闭环。

主要扫参建议：

- `initialSpareStock`: 初始备件数量。
- `failureRate`: 装备故障概率。
- `supportCapacity`: 保障节点维修并发能力。

主指标：

- `spare_fill_rate`
- `spare_utilization`
- `shortage_events`
- `repair_backlog`
