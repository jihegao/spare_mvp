# M6.1 输入一致性与 Scenario 编译 Gate 设计

## 背景

M6.0 已把运行入口收敛到 `RunService` 和 canonical `/api/runs`，但它仍只承诺 `smoke` 模型族的窄输入：ExperimentPlan 绑定的 ModelingSnapshot 加当前支持的 `steps`。如果直接进入统一 Monte Carlo、四类分析模板或结果 artifact，会出现两个高风险问题：

1. 前端修改任务、装备、保障活动后，Mesa 实际输入没有消费这些字段。
2. 备件短板、携行清单、任务可靠度、停机因素看起来像真实仿真结果，实际仍来自 demo 或前端局部推导。

因此 M6.1 的目标不是先做运行状态流或结果模板，而是补齐输入一致性：把 `Frontend Project / ExperimentPlan -> Scenario compiler / adapter mapping -> Mesa simulation input` 做成可审计、可阻断、可测试的正式 contract。

## 目标

1. 定义前端 Project 和 ExperimentPlan 中哪些字段进入目标模型族的 Scenario。
2. 为每个模型族建立 mapping version、字段来源、默认值策略和 unsupported 字段声明。
3. 在 run 前增加 compile gate：无法编译的 ExperimentPlan 必须 fail closed，不创建成功 run，不回退到 demo。
4. 编译产物记录 provenance，后续 result artifact 能追溯输入版本和字段口径。
5. 为 `aviation_support` 或正式业务模型族补 compiler skeleton；未覆盖字段必须显式阻断或标记 ignored，不能静默消费。

## 非目标

1. 不在 M6.1 做统一 Monte Carlo fan-out。
2. 不产出四类正式分析 artifact。
3. 不把前端局部推导包装成后端结果。
4. 不建设完整 worker 队列、取消、重试、资源隔离或长期对象存储。
5. 不扩大 M4 权限审计边界。

## 输入 Mapping Contract

M6.1 应新增模型族级 mapping 说明，建议结构如下：

```json
{
  "mapping_version": "aviation-support-input-v0",
  "model_family": "aviation_support",
  "fields": [
    {
      "scenario_path": "simulation_inputs.mission.duration_hours",
      "source": "project.missionProfile.durationHours",
      "status": "required",
      "default": null,
      "page": "任务剖面参数",
      "reason": "任务可靠度和停机因素必须基于任务时长计算"
    },
    {
      "scenario_path": "simulation_inputs.equipment.components[].mtbf_hours",
      "source": "project.components[].mtbfHours",
      "status": "required",
      "default": null,
      "page": "装备故障参数建模",
      "reason": "故障事件生成必须消费装备可靠性输入"
    },
    {
      "scenario_path": "simulation_inputs.support.activities[].duration_hours",
      "source": "project.supportActivities[].durationHours",
      "status": "required",
      "default": null,
      "page": "保障活动建模",
      "reason": "停机时间和保障资源占用必须消费活动时长"
    }
  ]
}
```

字段状态必须使用固定枚举：

1. `required`：缺失或非法时阻断编译。
2. `optional`：允许缺失，但 Scenario 中应省略或以模型可识别的空值表达。
3. `defaulted`：允许缺失，但必须记录默认值、默认来源和 reason。
4. `derived`：由一个或多个源字段派生，必须记录派生规则。
5. `unsupported`：当前模型族不支持，若分析请求依赖该字段则阻断。
6. `ignored`：不影响当前模型族，必须在 provenance 中列出，避免用户误以为已被仿真消费。

## Compile Gate

RunService 在提交 run 前必须调用目标模型族 compiler。编译结果分三类：

1. `compiled`：生成 Scenario，允许创建 run。
2. `blocked`：返回字段级问题，不创建成功 run；如果需要持久化失败 run，也必须显示 `status=failed` 和错误详情。
3. `unsupported`：模型族或 analysis request 当前不支持，不创建正式结果 artifact。

错误信息必须包含：

1. `code`
2. `message`
3. `field_path`
4. `page`
5. `severity`
6. `suggestion`

示例：

```json
{
  "code": "required_field_missing",
  "message": "任务时长缺失，无法编译 aviation_support Scenario",
  "field_path": "missionProfile.durationHours",
  "page": "任务剖面参数",
  "severity": "error",
  "suggestion": "在任务剖面参数页填写任务时长后重新保存实验方案"
}
```

## Scenario Provenance

M6.1 编译产物必须记录输入 provenance：

```json
{
  "project_id": "project-landbase-day-night",
  "modeling_snapshot_id": "modeling-snapshot-project-landbase-day-night-0001",
  "experiment_plan_id": "experiment-plan-project-landbase-day-night-...",
  "model_family": "aviation_support",
  "mapping_version": "aviation-support-input-v0",
  "consumed_fields": [
    "missionProfile.durationHours",
    "components[].mtbfHours",
    "supportActivities[].durationHours"
  ],
  "defaults_applied": [],
  "derived_fields": [],
  "ignored_fields": [
    "monteCarlo.failureRates"
  ],
  "unsupported_fields": []
}
```

后续 ResultSummary 和 ArtifactManifest 必须能通过 `run_id` 追溯到这份 provenance。

## 验收标准

1. 修改任务、装备或保障活动中的关键字段后，编译出的 Scenario input 有可观察变化。
2. 缺少 required 字段时，run 被阻断并返回字段级错误，不生成成功结果 artifact。
3. `smoke` 仍保留 M6.0 兼容行为，但 mapping provenance 必须说明它只消费窄字段。
4. `aviation_support` 或正式业务模型族至少有 compiler skeleton，unsupported 字段和默认值策略可审计。
5. 前端结果页不能把未经过 Scenario compiler 的局部推导展示为正式后端仿真结果。
