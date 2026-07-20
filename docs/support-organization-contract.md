# 保障组织图契约

Issue #314 将保障组织从仅用于展示/追溯的数据，收敛为可校验、可编译的 Project 契约；Issue #315 在该契约上启用本级优先、沿父链逐级上溯的纵向保障调度。横向关系仍只编译和审计，运行时行为留给 #316。

## Project 规范结构

- `supportOrganization.runtimeMode` 明确保存 `legacy` 或 `vertical`。缺失/空组织图从历史 `supportNodes[]` 派生树时物化为 `legacy`，显式规范树缺省物化为 `vertical`，所以保存/重载不会意外改变运行语义。
- `supportOrganization.tree` 是唯一根节点对象。节点必须有稳定且全局唯一的 `id`、`name` 和 `children[]`，可选 `description`。
- 节点 `serviceScope` 固定包含 `airportIds[]`、`aircraftModels[]`、`productIds[]`、`resourceTypes[]`；空数组表示该维度不限制。
- 树父子关系是唯一纵向边来源；`supportOrganization.relations[]` 仅保存横向 DAG 边，格式为 `id`、`type: "lateral"`、`fromOrganizationNodeId`、`toOrganizationNodeId`、`priority`。
- 每个 `supportNodes[]` 通过唯一的 `organizationNodeId` 关联一个组织节点；每个 `supportResources[]` 也必须声明唯一组织归属。
- `supportActivities[].resourceId` 是运行保障点的显式关系。`vertical` 模式下缺失该字段时，只有组织树根节点恰好唯一映射一个运行保障点才允许确定性默认并记录 provenance；否则编译阻断，不按名称、顺序或首项猜测。
- 顶层 `transportPolicies[]` 是运输策略唯一规范表，端点使用 `fromOrganizationNodeId` / `toOrganizationNodeId`，并可带 `productId`、`capacity`、`priority`、`transportTimeHours`。运输允许双向边，但不允许自环。

## 迁移和失败关闭

- 历史单元素 `supportOrganization.tree[]` 可迁移为单根对象；多根数组无法确定归属，必须阻断。
- 历史节点名、保障点名或节点级运输策略只在引用唯一且一致时迁移。缺失策略 ID 时按规范内容生成稳定的 `migrated-transport-<hash>`，不能使用数组下标。
- 只有所有路由与业务字段都为空的历史运输草稿可以丢弃并记录为默认处理；只要存在端点或业务字段，缺端点和自环都必须阻断。
- 重复组织 ID、孤立归属、歧义名称、组织树环、横向边自环/重复/环，以及作用域引用不存在或资源超出所属节点作用域，都返回具体错误码，并统一带 `invalid_support_organization` 分类。

## Scenario 编译结果

编译器将规范结构稳定排序后写入 `simulation_inputs.support_network.organization_graph`：

- `runtime_mode`
- `nodes[]`
- `parent_edges[]`
- `lateral_edges[]`
- `resource_ownership[]`
- `transport_policies[]`

这些字段进入 consumed/derived provenance。`support_network.nodes[]` 同时带唯一 `organization_node_id`，用于把作业保障点映射回规范组织节点；只有 `organization_graph.lateral_edges` 继续标记为 `runtime_deferred_fields`。

## 纵向运行时语义

- `organization_graph.runtime_mode == "vertical"` 时启用规范组织调度；`legacy` 保持历史 support-node 语义。旧输入缺少该字段时，非空图回退为 `vertical`，空图回退为 `legacy`。
- 作业先使用本级组织资源；本级不足时只按 `parent_edges[]` 从父级向祖先逐级选择，禁止名称猜测、兄弟节点、横向边或全局资源池回退。
- `vertical` 模式不为缺失人员/设备资源填充容量；未建模就是 `0`。只有 `legacy` 模式保留历史最小容量 `1`。
- 每条祖先到目的组织的路径必须逐边存在运输策略。每一跳优先选产品专用策略，再选通配策略，然后按 `priority`、运输时间和稳定 ID 排序；祖先距离始终优先于策略优先级。
- 人员和设备容量在供给组织按整条路径容量拆批（例如需求 5、容量 2 为 2/2/1），整项需求先原子预约；全部批次到达后作业才能开始，完成后全量释放回各供给组织，不增加目的组织的永久容量。人员与设备可来自不同祖先，但两类计划必须一起提交或一起失败。
- 备件先为一个任务的全部产品缺口构建完整可行计划，全部可行后才统一扣来源库存并创建在途批次；任何一种备件失败都不得留下局部扣减。到货写入 `(job, task, product)` 专属预留，不能进入共享库存被其他作业抢占；齐套启动时消费，取消时退回目的库存。单批数量取缺口、来源可用量和整条路径最小容量三者的最小值；多跳时间为逐边分钟数之和，零时延策略也在下一 tick 到达。
- 无完整纵向路径、资源不足或已有同一作业批次在途时保持等待并记录确定的阻断事实，不得静默改用其他节点。固定 seed 下，single run 与 Monte Carlo 样本共用同一模型调度代码。
