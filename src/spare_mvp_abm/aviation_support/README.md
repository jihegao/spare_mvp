# 航空保障 Mesa 场景包

该场景包用于描述单条飞行保障线的出动生成过程，并显式考虑保障资源约束。

## 范围

- 任务定义计划起飞时间、任务时长、所需飞机类型和所需飞机数量。
- 飞机记录飞行小时、着陆次数、距大修日历天数，并包含小型子系统 / LRU 可靠性树。
- 保障方案由基础作业组成，当前版本包含飞行前保障、飞行后保障和 LRU 维修保障。
- 资源被建模为受限池，包括机务班组、加油车、电源车、挂弹班组和维修工位。
- `ontology.json` 是飞机类型、飞机库存、任务计划、保障作业、保障方案、资源和备件配置的来源；`ontology.normalized.json` 和 `ontology.report.json` 记录本地 ontology IR 规范化结果。

## 模型边界

`model.py` 是 Mesa 可执行模型入口。有序保障作业在 Mesa 模型内部使用离散事件风格逻辑：每个作业等待资源、占用资源一段时间、释放资源，并推进飞机状态。

当前切片不声称已经校准真实飞机可靠性。LRU 故障使用固定随机种子和已编码 MTBF 值进行指数分布采样。

本体描述结构和场景配置；动态行为仍由 Mesa 规则实现，包括出动决策、保障排队、资源占用、作业时长、LRU 故障采样、备件消耗和备件补充。

## 可视化

通过本地 HTTP 服务打开 `visualization.html` 可进行浏览器检查。页面包含三个联动视图：

- 飞机视图：选择单架飞机，检查任务状态、保障状态、飞行历史、系统、LRU、健康状态、MTBF、MTTR 和备件映射。
- 任务视图：检查任务计划表、执行进度、指派飞机组，以及每架指派飞机的当前状态。
- 保障视图：检查资源工作/空闲状态、累计工作时间、工作次数、保障作业、事件日志、备件库存、消耗数量、补充数量和待补充数量。

## 证据命令

运行确定性烟测场景：

```bash
python3 /Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/aviation_support/model.py \
  --config src/spare_mvp_abm/aviation_support/smoke.json \
  --output-dir /tmp/aviation-support-smoke \
  --install-dir .abm-mesa-env
```

运行资源容量扫参：

```bash
python3 /Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/aviation_support/model.py \
  --config src/spare_mvp_abm/aviation_support/experiment.json \
  --output-dir /tmp/aviation-support-sweep \
  --install-dir .abm-mesa-env
```

主要输出为逐步 CSV 文件和 `summary.json`。需要浏览器检查时，通过本地 HTTP 服务打开 `visualization.html`。
