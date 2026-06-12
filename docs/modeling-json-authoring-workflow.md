# 建模页项目 JSON Authoring Workflow

| 项目 | 内容 |
| --- | --- |
| 文档版本 | V0.1 |
| 更新日期 | 2026-06-13 |
| 所属阶段 | Phase 2：MVP 详细设计与字段契约 |
| 对应 PR | PR #14：`[codex] Define frontend modeling JSON authoring workflow` |
| 输入依据 | `docs/modeling-json-schema.md`、`front/modeling-contract.js`、`docs/modeling-detailed-requirements.md`、`docs/mvp-acceptance-checklist.md` |
| 输出性质 | 后续 PR #15/#16 的产品 workflow 和验收边界 |

## 1. 目标和范围

PR #14 的目标是讲清楚两个建模页如何从用户输入完整产生 MVP 项目 JSON。本文定义页面区域、对象映射、用户操作、校验、导入导出、JSON 预览、脏状态、保存状态和错误状态。

本文不是运行时代码设计。PR #14 不实现前端状态模型，PR #14 不实现可编辑 UI，PR #14 不实现后端 API，PR #14 不实现 `core/` adapter，也不接入数据库或运行产物目录。

后续阶段分工：

| 后续 PR | 责任 |
| --- | --- |
| PR #15 | 把本文 workflow 落成前端 project JSON 状态、字段元数据、清洗和校验函数 |
| PR #16 | 把两个建模页升级为可编辑作者界面 |
| PR #17 | 以项目 JSON 为输入定义实验、运行和结果产物契约 |
| PR #18/#19 | 让后端、产物和前端结果展示接入稳定契约 |

## 2. 核心原则

备件规划仿真建模页和任务可靠度仿真建模页共享同一个项目 JSON。它们不是两个互不相通的项目数据，而是同一个项目数据在不同业务重点下的两个编辑视图。

统一项目 JSON 的标准对象来自 `docs/modeling-json-schema.md`：

| 标准对象 | Authoring 责任 |
| --- | --- |
| `missionProfiles` | 维护基本任务、复合任务、周期任务、基本使用单元和任务剖面字段 |
| `equipmentAssets` | 维护飞机或装备资产、状态、寿命和可用性输入 |
| `equipmentTree` | 维护装备组成、层级、部件/LRU 和当前可确认的故障参数 |
| `supportResources` | 维护保障组织、人员、设备、站位和设施 |
| `inventoryResources` | 维护备件、弹药、库存和后续资源消耗输入 |
| `supportActivities` | 维护基本活动、使用保障、预防维修和修复维修方案 |
| `metricPlans` | 维护指标、约束、优化目标和实验指标输入 |

页面可以按模块展示不同重点，但导出、校验、保存和后端消费必须面向同一个 normalized project JSON。

## 3. 项目 JSON 最小形态

后续前端状态模型应至少能导出以下结构。字段细节以 `docs/modeling-json-schema.md` 为准。

```json
{
  "projectId": "demo-601",
  "projectName": "601 备件评估演示项目",
  "schemaVersion": "mvp-modeling-v0.1",
  "tables": {
    "missionProfiles": [],
    "equipmentAssets": [],
    "equipmentTree": [],
    "supportResources": [],
    "inventoryResources": [],
    "supportActivities": [],
    "metricPlans": []
  },
  "validation": {
    "status": "draft",
    "errors": [],
    "warnings": []
  },
  "sourceTrace": {
    "origin": "user-authored",
    "importedSheets": []
  }
}
```

`rbd` 结构可以作为任务可靠度建模页的后续扩展对象，但在 PR #14 到 PR #16 的最小 authoring 闭环中，可靠性框图不得被描述成已经具备完整串并联计算能力。当前只要求稳定记录可编辑字段、可预览结构、可记录待补关系字段。

## 4. 页面职责划分

### 4.1 备件规划建模页

备件规划页优先暴露任务、保障组织、备件库存、保障资源、保障活动和指标约束。

| 页面区域 | 对应对象 | 最小操作 |
| --- | --- | --- |
| 任务建模 | `missionProfiles` | 创建、编辑、删除任务记录；维护任务编号、名称、机型、数量、时长和保障方案引用 |
| 装备建模 | `equipmentAssets`、`equipmentTree` | 维护飞机池、装备组成、部件/LRU、数量和当前状态 |
| 备件与弹药 | `inventoryResources` | 维护备件、弹药、型号、数量和资源类型 |
| 保障组织与资源 | `supportResources` | 维护组织、人员、设备、站位、设施和设施映射 |
| 保障活动 | `supportActivities` | 维护活动库、使用保障、预防维修和修复维修资源需求 |
| 指标方案 | `metricPlans` | 维护优化目标、约束阈值和指标目标值 |

### 4.2 任务可靠度建模页

任务可靠度页优先暴露任务剖面、飞机与装备组成、故障模型、可靠性框图、保障活动和指标分配。

| 页面区域 | 对应对象 | 最小操作 |
| --- | --- | --- |
| 任务剖面 | `missionProfiles` | 编辑波次、复合任务、周期任务、首次出动时间和重复规则 |
| 飞机与装备组成 | `equipmentAssets`、`equipmentTree` | 编辑飞机状态、寿命、装备层级、部件/LRU 和数量 |
| 故障模型 | `equipmentTree` | 编辑 LRU 故障率、维修分布、MTBCF、MTTR、检测时间和可检测标记 |
| 装备可靠性框图 | `equipmentTree`，后续 `rbd` | 预览由装备层级推导的结构；记录 parentId、relationType、successThreshold 等待补字段 |
| 保障组织与资源 | `supportResources`、`inventoryResources` | 编辑保障人员、设备、备件、弹药、站位和设施 |
| 保障活动 | `supportActivities` | 编辑故障维修、预防维修、任务间保障和使用保障 |
| 指标分配 | `metricPlans` | 编辑任务可靠度、可用度、利用率等指标方案 |

## 5. Authoring 操作流

### 5.1 创建

用户可以从任一建模页创建新项目或从当前默认示例项目复制。新项目必须初始化 7 类标准对象为空数组，并生成 `projectId`、`projectName`、`schemaVersion`、`validation.status=draft`。

创建记录时，页面必须先确定目标标准对象，再生成稳定 `id`。如果来源对象没有 raw `id`，前端状态模型应使用和 schema 文档一致的可重复规则，例如 `basicUsageUnits:<formationName>` 或 `constraints:<targetType>:<symbol>:<targetValue>`。

### 5.2 编辑

用户编辑单元格或详情面板字段后，页面应立即更新共享项目 JSON 的对应对象。编辑不应只更新当前页面的临时展示字段。

编辑规则：

1. 数字、概率、时间、布尔、枚举和引用字段使用明确控件或解析规则。
2. 字段修改后立即标记项目为脏状态。
3. 对被另一页面展示的共享对象，另一个页面切换回来时必须读取同一份项目 JSON。
4. `equipmentTree` 中 `parentId`、`relationType`、`successThreshold` 仍按未来字段处理，不能混入当前已确认字段。

### 5.3 删除

删除记录前必须执行引用检查。被任务、活动、维修方案、指标方案或实验方案引用的对象不能直接删除。

最小删除规则：

| 场景 | 处理 |
| --- | --- |
| 无引用记录 | 允许删除，写入脏状态 |
| 有引用记录 | 阻止删除，展示引用来源 |
| 用户仍需删除 | 后续 PR 可提供解除引用或迁移入口；PR #15/#16 的最小实现可先阻止 |

### 5.4 校验

校验必须覆盖 `docs/modeling-json-schema.md` 中的基础口径：

1. 编号唯一。
2. 名称必填。
3. 数量非负。
4. 概率范围为 0~1 或 0%~100%，并声明转换口径。
5. 引用对象必须存在。
6. 被引用对象不可直接删除。
7. 时间字段必须声明单位。
8. 数字字符串导入时转数字。
9. `"null"` 字符串、空字符串和缺失字段按语义转为空值、空数组或默认值。

校验结果进入 `validation.errors` 和 `validation.warnings`。阻断后端运行的错误进入 `errors`；不会阻断当前编辑但需要用户确认的内容进入 `warnings`。

### 5.5 JSON 预览

两个建模页都应提供 JSON 预览入口。预览必须显示当前共享项目 JSON，而不是当前页面局部数据。

JSON 预览最少包含：

1. `projectId`、`projectName`、`schemaVersion`。
2. 7 类标准对象的记录数。
3. 当前选中对象或全量对象的格式化 JSON。
4. 校验状态、错误数量和警告数量。
5. 来源追踪，例如用户录入、示例项目、导入文件或工作簿式 JSON。

### 5.6 导入

导入支持两类输入：

| 输入类型 | 处理 |
| --- | --- |
| normalized project JSON | 直接读取 7 类标准对象并校验 |
| workbook-style JSON | 按 schema 文档中的 raw 到 normalized 规则清洗并生成标准对象 |

导入必须执行清洗：

1. 数字字符串转 number 或 integer。
2. `0/1` 转 boolean。
3. 分隔字符串转数组。
4. `"null"`、空字符串和缺失字段按语义转换。
5. 没有 raw `id` 的记录生成稳定 ID。
6. `supportStationCodes`、`nonSupportStationCodes`、`shipTypes`、`initialLayouts` 只作为上下文或后续环境配置，不进入建模主对象。

导入完成后，页面必须展示导入摘要：导入来源、成功对象数、清洗转换数、错误数和警告数。

### 5.7 导出

导出只导出 normalized project JSON。导出文件必须包含 schema 版本和 validation 状态。

导出前应重新运行校验：

| 校验状态 | 导出规则 |
| --- | --- |
| `valid` | 允许导出，文件可作为 PR #17 后续实验方案输入 |
| `warning` | 允许导出，但导出摘要必须保留警告 |
| `invalid` | 允许用户保存草稿 JSON，但不得标记为可运行输入 |

### 5.8 脏状态和保存状态

页面状态至少包含：

| 状态 | 触发 | UI 含义 |
| --- | --- | --- |
| `clean` | 当前 JSON 与最近保存点一致 | 无未保存修改 |
| `dirty` | 用户创建、编辑、删除、导入或校验修复后 | 有未保存修改 |
| `saving` | 后续服务或本地保存动作进行中 | 暂停重复保存 |
| `saved` | 保存成功 | 更新最近保存点 |
| `save_failed` | 保存失败 | 保留本地草稿和错误状态 |

在无后端阶段，PR #15/#16 可以把“保存”定义为浏览器内存或文件导出准备状态，但 UI 文案必须说明尚未接入后端持久化。

### 5.9 错误状态

错误状态分三类：

| 类型 | 示例 | 页面处理 |
| --- | --- | --- |
| 字段错误 | 必填缺失、数量为负、概率越界 | 定位到字段和记录 |
| 引用错误 | 活动引用不存在的人员、备件或设施 | 展示引用来源和缺失对象 |
| 导入错误 | JSON 解析失败、sheet 类型错误、无法清洗字段 | 阻止覆盖当前项目，保留错误摘要 |

错误状态不得伪装成已完成建模。若项目存在阻断错误，后续实验方案和后端运行入口应保持不可用或显示明确原因。

## 6. 页面到对象映射矩阵

| 标准对象 | 备件规划页 | 任务可靠度页 | 共享规则 |
| --- | --- | --- | --- |
| `missionProfiles` | 任务建模 | 任务剖面 | 同一任务记录，页面可展示不同字段列 |
| `equipmentAssets` | 装备建模 | 飞机与装备组成 | 同一飞机池和状态记录 |
| `equipmentTree` | 装备建模 | 飞机与装备组成、故障模型、可靠性框图 | 同一装备层级；RBD 字段保持待补边界 |
| `supportResources` | 保障组织与资源 | 保障组织与资源 | 同一组织、人员、设备、站位和设施 |
| `inventoryResources` | 备件与弹药 | 保障组织与资源 | 同一备件和弹药资源 |
| `supportActivities` | 保障活动 | 保障活动 | 同一活动库和维修方案 |
| `metricPlans` | 指标方案 | 指标分配 | 同一约束、指标和优化目标 |

## 7. PR #15/#16 验收输入

PR #15 至少应根据本文提供：

1. 前端共享 project JSON 状态对象。
2. 7 类标准对象的元数据入口。
3. 字段级校验函数。
4. raw 到 normalized 的导入清洗函数。
5. 测试覆盖创建、编辑、删除阻断、校验、导入清洗和导出。

PR #16 至少应根据本文提供：

1. 两个建模页共用同一项目 JSON 的 UI 行为。
2. 对 7 类标准对象的对象列表、详情编辑和记录数展示。
3. JSON 预览、导入、导出、脏状态、保存状态和错误状态。
4. 页面切换后共享数据不丢失的测试。
5. 未接后端时的边界提示。

## 8. PR #14 验收检查

PR #14 完成时需要满足：

1. 本文存在并覆盖创建、编辑、删除、校验、JSON 预览、导入、导出、脏状态、保存状态和错误状态。
2. 本文明确两个建模页共享同一项目 JSON。
3. 本文映射 `missionProfiles`、`equipmentAssets`、`equipmentTree`、`supportResources`、`inventoryResources`、`supportActivities`、`metricPlans`。
4. 本文明确 PR #14 不实现前端状态模型、可编辑 UI、后端 API 或 `core/` adapter。
5. `tests/modeling-authoring-workflow-doc.test.mjs` 通过。
