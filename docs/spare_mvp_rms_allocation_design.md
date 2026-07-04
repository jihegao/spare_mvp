# RMS 指标分配方法与当前实现

状态：当前实现说明。更新时间：2026-07-04。

代码入口：

- `front/rms-allocation-engine.mjs`
- `front/rms-allocation-workbench.mjs`
- `front/app.js`
- `tests/rms-allocation-engine.test.mjs`
- `tests/frontend-contract.test.mjs`

## 当前边界

装备 RMS 指标分配是系统运行支持模块下的本地计算工作台。当前页面用于在前端计算装备节点的 RMS target，帮助检查不同分配方法的指标口径；它不是项目建模数据的持久编辑器，也不是正式仿真输入消费链路。

当前 UI 只提供“计算”动作：

- 支持导入 RMS 工作台独立装备树。
- 支持选择装备根节点后只对该机型下的直接子系统分配。
- 支持等分配法、比例分配法和相似产品分配法。
- 展示节点级风险权重、风险预算、失效率、MTBCF、MTBF、MTTR、Ai、Ao 和状态。

当前 UI 不提供：

- 保存 RMS 分配草稿。
- 发布 RMS target 到项目建模数据。
- 后端 API 持久化。
- 复杂 RBD 数值求解。
- 正式 `aircraft_support_v1` 仿真消费。

引擎层保留 `publishRmsAllocation(project, allocationResult)` helper。该 helper 会克隆项目并只写入节点 `rms.target`，保留原有 `rms.prediction` 与 `rms.actual`；前端当前没有调用该 helper 的按钮或工作流。

## 数据结构

默认演示数据由 `createDemoRmsAllocationProject()` 构造，包含一个当前目标机型 `F16`，以及可作为相似产品基准的 `F15` 和 `F18`。导入数据通过 `normalizeRmsEquipmentImportRows()` 进入独立 RMS project，不回写当前业务 Project。

RMS project 的关键字段：

- `projectId`、`name`：工作台数据身份。
- `rootId`：当前参与计算的装备根节点。
- `equipmentNodes[]`：装备树节点。
- `reliabilityGroups[]`：当前 MVP 的串联系统分组提示。
- `missionProfile.missionHours`：默认任务时长来源。

装备节点常用字段：

- `id`、`name`、`parentId`、`level`、`quantity`、`structure`。
- `missionUse.runningRatio` 或 `runningRatio`：运行比，计算产品强度。
- `criticality`、`repairDifficulty`、`supportDifficulty`：保障需求、MTTR 和 MLDT 加权。
- `failureModel.baselineMtbfHours`、`repairModel.baselineMttrHours`。
- `rms.prediction`、`rms.actual`、`rms.similar`、`rms.target`。

默认分配方案由 `createDefaultRmsAllocationPlan(project)` 构造：

- `schemaVersion: "rms-allocation-plan-v1"`。
- `algorithmVersion: "rms-engine-1.2.0"`。
- `targets.reliability.value`：任务可靠度目标，默认 `0.95`。
- `targets.taskDurationHours`：任务时长，默认读取 `missionProfile.missionHours`。
- `targets.criticalFailureRatio`：关键故障占比，用于从 MTBCF 换算 MTBF。
- `targets.mttrHours`、`targets.mldtHours`：维修性和保障性目标。
- `methods.reliability`：`equal`、`proportional` 或 `similar`。
- `methods.proportional.adjustmentFactor`：比例分配修正系数。
- `methods.similarProduct.sourceModel`、`targetModel`、`adjustmentFactor`：相似产品分配参数。

## 计算口径

`calculateRmsAllocation(plan, project)` 当前只对 `project.rootId` 下的直接子节点分配。总风险预算来自任务可靠度：

```text
riskBudget = -ln(R_target)
```

任务级目标指标：

```text
targetMtbcf = taskDurationHours / riskBudget
targetMtbf = targetMtbcf * criticalFailureRatio
```

节点产品强度：

```text
productIntensityHours_i = taskDurationHours * runningRatio_i
```

节点风险预算：

```text
riskBudget_i = riskBudget * riskWeight_i
```

节点可靠性指标：

```text
reliability_i = exp(-riskBudget_i)
mtbcf_i = productIntensityHours_i / riskBudget_i
mtbf_i = mtbcf_i * criticalFailureRatio
failureRate_i = 1 / mtbf_i
```

`runningRatio_i` 从 `missionUse.runningRatio`、`missionUse.dutyCycle` 或节点顶层 `runningRatio` 读取，并限制在 `0..1`。因此同一任务时长下，运行比越低，产品强度越低，分配出的 MTBF 要求也会随之变化。

## 分配方法

等分配法：

```text
rawWeight_i = 1
```

所有直接子节点按相同原始权重归一化分配风险预算。

比例分配法：

```text
rawWeight_i = productIntensityHours_i / (predictedMtbf_i * adjustmentFactor)
```

`predictedMtbf_i` 优先读取 `node.rms.prediction.mtbfHours`，缺失时回退到 `node.failureModel.baselineMtbfHours`。预测 MTBF 较弱、产品强度较高的节点获得更高风险预算，最终 MTBF 要求更低。

相似产品分配法：

```text
rawWeight_i = productIntensityHours_i / (similarMtbf_i * similarFactor_i)
```

`similarMtbf_i` 优先从 `methods.similarProduct.sourceModel` 指定的基准机型中按去除机型前缀后的节点名匹配。例如 `F16 发动机` 可匹配 `F15 发动机` 或 `F18 发动机`。找不到基准节点时，再回退到节点自身的 `rms.similar.mtbfHours`、`similarProduct.mtbfHours`、预测 MTBF 或 baseline MTBF。

`similarFactor_i` 优先读取节点 `rms.similar.adjustmentFactor` 或 `similarProduct.adjustmentFactor`，否则使用方案级 `methods.similarProduct.adjustmentFactor`。

## 维修性和保障性

可靠性分配完成后，`attachMaintainabilityAndSupportability()` 计算节点 MTTR、MLDT、Ai 和 Ao：

- MTTR 按节点失效率权重和 `repairDifficulty` 缩放，使加权平均不超过 `targets.mttrHours`。
- MLDT 按 `failureRate * productIntensityHours * quantity * criticality` 得到保障需求，再按 `supportDifficulty` 缩放，使加权平均不超过 `targets.mldtHours`。
- `Ai = MTBF / (MTBF + MTTR)`。
- `Ao = MTBF / (MTBF + MTTR + MLDT)`。

状态判定当前只比较预测 MTBF 与分配目标 MTBF：

- 预测 MTBF 存在且低于目标 MTBF 时显示“风险”。
- 否则显示“满足”。

## 校核与限制

结果通过 `evaluateBottomUpReliability()` 做自底向上可靠度校核。当前 MVP 的正式 UI 口径是根节点下直接子系统的串联系统分配；如果根分组不是 `series`，结果会带 `MVP_SERIES_ONLY` warning，提示复杂结构将在后续数值求解阶段扩展。

当前算法不会把 `reliability` 字段写入节点结果；节点结果以 `riskBudget`、`failureRate`、MTBCF、MTBF、MTTR、MLDT、Ai、Ao 等工程指标为主。

## 页面契约

`renderRmsAllocationWorkbench()` 当前页面结构：

- 顶部参数：任务可靠度、任务时长、关键故障占比、MTTR。
- 左侧：独立装备树、导入表格按钮、装备根节点选择、导入状态。
- 右侧：可靠性分配方法选择，按方法展示比例修正系数或基准机型/相似修正系数。
- 底部：节点分配结果表。

页面不显示计划名称，不显示导入样例按钮，不显示 AGREE 分配法、评分分配法、任务暴露矩阵、暴露时间、保存草稿或发布动作。

## 验证入口

主要契约由以下测试覆盖：

- `tests/rms-allocation-engine.test.mjs`：算法公式、运行比、比例分配、相似产品分配、导入装备树、机型切换和引擎级 target 写入 helper。
- `tests/frontend-contract.test.mjs`：页面入口、UI 字段、方法选项、计算动作和非目标按钮。

建议验证命令：

```bash
node --test tests/rms-allocation-engine.test.mjs tests/frontend-contract.test.mjs
```
