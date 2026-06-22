# GPT Mesa 输入数据修订记录

本目录不直接覆盖仓库根部的 `tests/fixtures/modeling_import_project.json`。运行时由 `independent_mesa_gpt.scenario_loader` 读取原始 `modeling-import-v1` 包，再应用 `data/input_overrides.json` 中的数值修订，并把实际修订写入输出目录的 `input_changes.json`。

## 修订原因

原始导入包中昼间制空任务要求 4 架 J-15 同时出动，但 `combatUnit.members` 只有 3 架 J-15。若保持原值，昼间任务会一直延误并取消，无法形成完整的“准备 -> 起飞 -> 任务执行 -> 返航 -> 回收检查 -> 就绪”可视化闭环。

## 修订项

| 字段 | 原值 | 新值 | 说明 |
| --- | --- | --- | --- |
| `objects.missionProfiles[0].basicMission.minRequiredSorties` | `5` | `3` | 与可执行 J-15 编队规模对齐。 |
| `objects.equipment.minRequiredSorties` | `5` | `3` | 与整机层出动门槛对齐。 |
| `objects.missionProfiles[0].compositeTasks[0].taskItems[0].equipmentQuantity` | `4` | `3` | 昼间 J-15 编队实际可用 3 架。 |
| `objects.missionProfiles[0].compositeTasks[0].taskItems[0].minRequiredSystems` | `4` | `3` | 允许昼间波次正常起飞。 |
| `objects.missionProfiles[0].compositeTasks[0].taskItems[0].taskDispatchTime` | `07:15` | `06:45` | 让飞行前准备能在 08:00 前完成。 |
| `objects.missionProfiles[0].compositeTasks[1].taskItems[0].taskDispatchTime` | `19:30` | `19:00` | 让夜间警戒准备能在 20:15 前完成。 |

## 未修订但被显式消费的字段

- `missionPhases`: 映射飞机状态显示和回收检查时长。
- `supportActivities`: 映射飞行前保障、修复性维修、预防性维修的作业名称和耗时。
- `supportResources`: 映射甲板、前出保障点和备件库的资源/库存面板。
- `equipmentAssets`: 映射飞机关键部件、寿命和故障率。
- `monteCarlo` / `analysisRequests`: 在本 GPT 版本中写入场景摘要和输出头，单场景可视化不执行 sweep。
