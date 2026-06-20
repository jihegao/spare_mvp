# M6.2 统一 Monte Carlo 与 Analysis Profile 设计

## 背景

M6.2 必须建立在 M6.1 输入一致性和 M6.1.1 单次仿真输入对齐之上。只有当前端 Project / ExperimentPlan 分支已经能被 compiler 转换为可审计 Scenario input，Monte Carlo 样本和四类分析投影才有可信输入来源。

M6.2 的目标是把大样本运行和分析类型统一到一个 analysis profile 中：大样本评估生成基础 Monte Carlo artifact，备件短板、携行清单、任务可靠度、停机因素作为同一 artifact 的 projection，而不是各自独立做一套 demo 计算。

## 目标

1. ExperimentPlan 增加 `analysisRequests` 或等价结构，记录实验类型勾选状态和配置面板参数。
2. 基于 M6.1 编译通过的 Scenario 执行统一 Monte Carlo 样本。
3. 产出统一 Monte Carlo artifacts，包含样本输入、样本输出、聚合指标、mapping/provenance 和随机种子。
4. 四类分析页面只从正式 artifacts 做 projection。
5. 未配置、运行中、运行失败、输入不一致的分析页必须显示对应状态，不能显示静态正式结果。

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

未勾选的请求不生成 projection artifact，结果页显示“未配置”。

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

结果分析页按 ExperimentPlan 和 run artifacts 显示：

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
