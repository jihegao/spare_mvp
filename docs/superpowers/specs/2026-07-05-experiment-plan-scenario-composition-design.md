# 仿真实验方案 Scenario 拼接设计

日期：2026-07-05
状态：已确认设计，待实现计划

## 背景

`仿真实验方案管理` 是独立于 Project 建模草稿的实验分支工作流。用户需要从当前 Project JSON 生成一个可运行的实验方案，在方案里修改 Project JSON 的部分值，定义随机种子策略和样本量，然后保存为后续可启动仿真的 ExperimentPlan。

当前实现已经有 `experimentPlanDraft`、`data-save-plan` 和后端 `ExperimentPlan.config.projectJson`。本设计在这个分支边界上补齐 Scenario 拼接能力，不把实验参数回写到 Project 本体。

## 目标

1. 用户可以在实验方案编辑页基于当前 Project JSON 生成方案分支。
2. 用户可以维护一组 Project JSON path 覆盖项，保存时拼接成方案私有的 `projectJson`。
3. 用户可以选择固定随机种子或随机生成随机种子。
4. 用户可以定义样本量，并让正式 Monte Carlo 配置从 ExperimentPlan 读取该样本量。
5. 保存动作只生成 ExperimentPlan，不立即启动 run，不写 Result 或 ArtifactManifest。

## 非目标

1. 不创建派生 Project，不污染项目列表。
2. 不把 `samples`、seed、Monte Carlo sweep 或 `analysisRequests` 回写到持久 Project JSON。
3. 不新增运行队列、worker、取消重试或 artifact 存储能力。
4. 不引入新的表达式 DSL。第一版只支持明确的 Project JSON path 覆盖。
5. 不改 `docs/3概要设计方案.md` 的四级功能口径。

## 推荐方案

采用 ExperimentPlan 分支覆盖表。

流程：

1. 进入 `仿真实验方案管理` 的方案编辑页。
2. 系统从当前 Project JSON clone 出 `experimentPlanDraft`。
3. 用户编辑基础字段、样本量、seed 策略和 Scenario 覆盖表。
4. 保存时按顺序把覆盖项应用到 `experimentPlanDraft`，得到 composed Project branch。
5. 前端调用 `createExperimentPlan(project_id, config)`。
6. 后端保存 ExperimentPlan，并继续清理 branch `projectJson` 中不属于 Project runtime input 的字段。

## 数据结构

ExperimentPlan config 增加以下结构：

```json
{
  "name": "某项目 仿真实验方案",
  "steps": 24,
  "samples": 100,
  "seed": 20260705,
  "seedPolicy": {
    "mode": "fixed",
    "baseSeed": 20260705
  },
  "scenarioComposition": {
    "schemaVersion": "scenario-composition-v0",
    "sourceProjectId": "project-example",
    "baseProjectVersion": "project-v0.1",
    "overrides": [
      {
        "path": "supportNodes.0.inventory.LRU-A",
        "valueType": "number",
        "value": 12,
        "label": "基层保障点 LRU-A 库存"
      }
    ]
  },
  "analysisRequests": {
    "largeSample": {
      "enabled": true,
      "samples": 100,
      "sweep": {
        "failureRates": [0.06],
        "spareMultipliers": [1],
        "supportCapacities": [2]
      }
    }
  },
  "projectJson": {}
}
```

`projectJson` 保存覆盖后的方案分支。`scenarioComposition.overrides` 保存用户为什么改、改了哪些 path，供列表、审计和以后重新生成使用。

## Scenario 拼接规则

1. path 使用当前前端已有的点号路径形式，例如 `experiment.steps`、`supportNodes.0.inventory.LRU-A`。
2. 覆盖项按列表顺序应用；后面的同 path 覆盖前面的同 path。
3. `valueType` 支持 `string`、`number`、`boolean`、`json`。
4. `json` 类型必须能解析成合法 JSON 值，否则保存失败并停留在编辑页。
5. 空 path、非法 path、不能解析的 value 必须 fail closed，不创建 ExperimentPlan。
6. 第一版不支持删除字段；如需表达删除，后续增加独立 op 类型。

## Seed 策略

`fixed`：

- 用户输入 `baseSeed`。
- 保存时 `config.seed = baseSeed`。
- 运行样本按当前后端规则从 base seed 派生，保证可复现。

`random`：

- 用户不需要输入固定 seed。
- 点击保存/生成方案时前端生成一个正整数 base seed，并写入 `config.seed` 与 `seedPolicy.baseSeed`。
- 保存后的方案仍然可复现，因为随机只发生在生成方案的一刻。

## 样本量规则

1. 方案编辑页显示 `samples` 为正整数。
2. 保存时同时写入 `config.samples` 和 `config.analysisRequests.largeSample.samples`。
3. 如果存在 sweep，`samples` 不能小于 sweep 的笛卡尔积点数；不足时自动提升到最小覆盖值，并在保存后的 config 中体现提升后的样本量。
4. 单次仿真可以保留 `samples`，但正式消费主要面向 Monte Carlo。

## UI 行为

方案编辑页分三块：

1. 基础配置：方案名称、仿真步数、样本量。
2. 随机种子：固定/随机切换；固定模式显示 seed 输入，随机模式显示生成后的 base seed。
3. Scenario 拼接：覆盖表，包含 path、类型、值、说明、删除覆盖项按钮。

保存按钮仍为 `data-save-plan`。保存成功后回到方案列表，并选中新建的 ExperimentPlan。

## 后端边界

后端继续以 `create_experiment_plan(project_id, config)` 为入口。后端职责：

1. 规范化 `config.projectJson`，继续剥离不属于 Project 的 runtime config。
2. 保留 `seedPolicy`、`scenarioComposition`、`samples`、`analysisRequests` 在 ExperimentPlan config。
3. 如果后端后续增加强校验，应校验覆盖后的 `projectJson` 能通过当前 Project/Scenario compiler gate。

## 测试要求

前端合同测试：

1. 方案编辑页存在 seed 策略、样本量和 scenario override 表入口。
2. 覆盖项写回 `experimentPlanDraft`，不写回 `scenario`。
3. `data-save-plan` 仍走 `saveCurrentExperimentPlanThroughApi()`。

前端运行时测试：

1. 用户新增覆盖项并保存，POST body 的 `config.projectJson` 包含覆盖后的值。
2. 原 Project JSON 不包含该覆盖值。
3. fixed seed 保存指定 seed。
4. random seed 保存时生成 base seed，且保存在 config 中。

后端测试：

1. `create_experiment_plan()` 保留 `seedPolicy` 和 `scenarioComposition`。
2. 保存后的 `config.projectJson` 不含根 `experiment`、根 `analysisRequests` 或 `monteCarlo`。
3. `analysisRequests.largeSample.samples` 仍作为正式 Monte Carlo 样本量来源。

## 实施顺序

1. 先添加测试锁定 ExperimentPlan branch、seed policy 和 scenario composition contract。
2. 再提取前端 helper：normalize seed policy、parse override value、apply overrides。
3. 扩展方案编辑 UI。
4. 扩展 `buildExperimentPlanConfig()`，让 config 保留 `seedPolicy` 与 `scenarioComposition`。
5. 增加后端 config 保留测试。
6. 最后做浏览器 smoke，确认方案编辑、保存和列表回显可用。
