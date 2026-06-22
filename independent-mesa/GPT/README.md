# GPT Independent Mesa 可视化模型

这个版本直接读取仓库根部 `tests/fixtures/modeling_import_project.json`，按 `data/input_overrides.json` 应用有记录的输入修订，然后运行一个 Mesa 3 模型，输出飞机任务执行全过程的可视化回放。

## 覆盖范围

- 飞机 Agent: 6 架舰载机，每架保留型号、寿命、起落次数、部署位置和任务状态。
- 任务过程: 甲板待命 -> 飞行前准备 -> 任务就绪 -> 起飞执行 -> 返航 -> 回收检查 -> 任务后就绪。
- 输入数据消费: `missionProfiles`、`combatUnit`、`compositeTasks`、`missionPhases`、`supportActivities`、`supportResources`、`equipmentAssets`。
- 输入修订记录: 每次运行都会写出 `output/single-run/input_changes.json`。

## 运行

```bash
cd /Users/gaojihe/Models/spare_mvp/independent-mesa/GPT
../../.abm-mesa-test-env/bin/python run_single.py --steps 104 --sample-every 1 --seed 20260621
```

打开生成的页面:

```text
output/single-run/visualization.html
```

同时生成:

- `frames.json`: 每帧 Mesa 可视化状态。
- `metrics.json`: 最终指标、飞机时间线、事件日志和库存变化。
- `scenario_summary.json`: 原始导入包摘要。
- `input_changes.json`: 实际应用的输入数值修订。

## 测试

```bash
cd /Users/gaojihe/Models/spare_mvp/independent-mesa/GPT
PYTHONPATH=. ../../.abm-mesa-test-env/bin/python -m unittest discover -s tests -v
```
