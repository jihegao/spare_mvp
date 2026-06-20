# M6.2 统一 Monte Carlo 与 Analysis Profile 设计

## 背景

M6.2 必须建立在 M6.1 输入一致性和 M6.1.1 单次仿真输入对齐之上。只有当前端 Project / ExperimentPlan 分支已经能被 compiler 转换为可审计 Scenario input，Monte Carlo 样本和四类分析投影才有可信输入来源。

M6.2 的目标是把大样本运行和分析类型统一到一套实验对象中：仿真实验方案是可编辑输入分支，Monte Carlo 实验是批量运行历史，备件短板、携行清单、任务可靠度、停机因素是绑定 Monte Carlo artifact 的分析任务或 projection，而不是各自独立做一套 demo 计算。

## 对象定位

1. `ExperimentPlan`：仿真实验方案，保存从项目建模数据复制出的参数分支。方案编辑可以按三级功能、四级功能、字段和值定位覆盖项，也可以通过字段搜索定位；方案修改不回写 Project draft。
2. `MonteCarloExperiment`：批量运行记录，保存 `mc_experiment_id`、关联方案、样本量、随机种子、状态、进度、`run_id` 和 artifact 引用。可视化推演仍是单次或交互式运行入口，Monte Carlo 实验是批量运行主账本。
3. `AnalysisTask`：结果分析任务，保存分析类型、关联方案、分析参数和 `linkedMonteCarloExperimentId`。四个分析页可以提供列表、创建、编辑、删除和详情体验，但它们必须绑定 Monte Carlo 实验或其 artifact，不直接各自重新定义一套仿真运行。

允许用户在分析页选择方案和参数后自动创建一个新的 Monte Carlo 实验，并把新实验的 `mc_experiment_id` 写入分析任务的 `linkedMonteCarloExperimentId`。页面必须显式展示该绑定关系，防止用户误以为分析页独立运行了另一套样本。

## 目标

1. ExperimentPlan 保存可运行的方案分支和默认运行配置。
2. Monte Carlo 实验基于 M6.1 编译通过的 Scenario 执行统一样本，并保存全部实验运行历史。
3. 产出统一 Monte Carlo artifacts，包含样本输入、样本输出、聚合指标、mapping/provenance 和随机种子。
4. 四类分析页面管理 AnalysisTask，只从绑定的正式 artifacts 做 projection。
5. 未创建任务、未绑定 Monte Carlo 实验、运行中、运行失败、输入不一致的分析页必须显示对应状态，不能显示静态正式结果。

## Analysis Profile

建议 ExperimentPlan 中保存：

```json
{
  "basicInfo": {
    "name": "陆基昼夜保障大样本实验",
    "durationHours": 72,
    "seed": 20260620
  },
  "analysisRequests": {
    "largeSample": {
      "enabled": true,
      "samples": 1000,
      "sweep": {
        "failureRates": [0.06, 0.08, 0.1],
        "spareMultipliers": [0.75, 1.0, 1.25],
        "capacities": [2, 3]
      }
    },
    "spareShortfall": {
      "enabled": true,
      "threshold": 0.95
    },
    "carryList": {
      "enabled": true,
      "missionWindowHours": 72
    },
    "missionReliability": {
      "enabled": true,
      "target": 0.9
    },
    "downtimeFactors": {
      "enabled": true,
      "topN": 10
    }
  }
}
```

未勾选的请求不生成 projection artifact，结果页显示“未配置”。如果用户从某个分析页直接创建任务，系统可以根据所选方案、样本量、随机种子和分析参数自动创建一个 `MonteCarloExperiment`，再把该实验绑定回 `AnalysisTask`。

## 页面结构

1. 仿真实验方案管理：
   - 方案列表：每个方案提供“启动可视化推演”和“创建蒙特卡洛实验”。
   - 方案编辑：修改方案输入参数和默认实验配置。
2. 可视化推演：
   - 选择方案，启动单次或交互式仿真。
3. 蒙特卡洛实验：
   - 实验列表：保存全部运行历史。
   - 添加/编辑实验：选择方案、样本量、随机种子和 sweep 参数。
   - 实验详情：启动实验、查看进度、日志、结果和 artifact。
4. 结果分析：
   - 每个分析类型先进入分析任务列表。
   - 创建任务时选择方案和分析参数；没有可用 Monte Carlo 实验时允许自动创建并绑定。
   - 详情页展示 `linkedMonteCarloExperimentId`、`mc_experiment_id`、run/artifact 来源和 projection 结果。

## Artifact 分层

M6.2 artifact 应分为两层：

1. 基础 Monte Carlo artifact：
   - compiled scenario identity
   - mapping version
   - sample count
   - seed
   - sweep dimensions
   - per-sample metrics
   - aggregate metrics
   - logs summary

2. Analysis projection artifact：
   - `large_sample_summary`
   - `spare_shortfall`
   - `carry_list`
   - `mission_reliability`
   - `downtime_factors`

四类 analysis projection 必须引用同一个基础 Monte Carlo artifact，不能重新读取前端当前 draft，也不能绕过 M6.1 compiler。

## 页面状态

结果分析页按 AnalysisTask、绑定的 MonteCarloExperiment 和 run artifacts 显示：

1. 未配置：显示“未配置”，不渲染正式图表。
2. 已配置但未运行：显示“待运行”。
3. 运行中：显示进度、样本完成数和最近日志摘要。
4. 运行失败：显示失败原因、字段级错误或执行日志入口。
5. 运行完成：显示对应 projection，并展示 run id、mapping version、sample count、seed 和 artifact id。

## 非目标

1. M6.2 不修补 M6.1/M6.1.1 未覆盖的输入字段。
2. M6.2 不允许为缺少 compiler provenance 的结果生成正式 artifact。
3. M6.2 不要求生产级分布式 worker，但必须保留向异步 worker 替换的 status/progress contract。
4. M6.2 不扩大权限审计边界。

## 验收标准

1. 同一 ExperimentPlan、mapping version 和 seed 能复现 Monte Carlo aggregate。
2. 修改 M6.1 consumed field 后，Monte Carlo artifact 的输入版本或指标发生可解释变化。
3. 未勾选的分析页显示“未配置”。
4. 四类分析 projection 均能追溯到同一个基础 Monte Carlo artifact。
5. 任何绕过 Scenario compiler 的 demo 或前端局部推导不得标记为正式后端结果。
