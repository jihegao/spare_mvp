# 保障组织图契约

Issue #314 将保障组织从仅用于展示/追溯的数据，收敛为可校验、可编译的 Project 契约；本阶段只建立组织图和资源归属，不改变 `aircraft_support_v1` 的资源选择与运输行为。运行时继续使用既有 `support_network.nodes`，组织图的行为化由后续阶段完成。

## Project 规范结构

- `supportOrganization.tree` 是唯一根节点对象。节点必须有稳定且全局唯一的 `id`、`name` 和 `children[]`，可选 `description`。
- 节点 `serviceScope` 固定包含 `airportIds[]`、`aircraftModels[]`、`productIds[]`、`resourceTypes[]`；空数组表示该维度不限制。
- 树父子关系是唯一纵向边来源；`supportOrganization.relations[]` 仅保存横向 DAG 边，格式为 `id`、`type: "lateral"`、`fromOrganizationNodeId`、`toOrganizationNodeId`、`priority`。
- 每个 `supportNodes[]` 通过唯一的 `organizationNodeId` 关联一个组织节点；每个 `supportResources[]` 也必须声明唯一组织归属。
- 顶层 `transportPolicies[]` 是运输策略唯一规范表，端点使用 `fromOrganizationNodeId` / `toOrganizationNodeId`，并可带 `productId`、`capacity`、`priority`、`transportTimeHours`。运输允许双向边，但不允许自环。

## 迁移和失败关闭

- 历史单元素 `supportOrganization.tree[]` 可迁移为单根对象；多根数组无法确定归属，必须阻断。
- 历史节点名、保障点名或节点级运输策略只在引用唯一且一致时迁移。缺失策略 ID 时按规范内容生成稳定的 `migrated-transport-<hash>`，不能使用数组下标。
- 只有所有路由与业务字段都为空的历史运输草稿可以丢弃并记录为默认处理；只要存在端点或业务字段，缺端点和自环都必须阻断。
- 重复组织 ID、孤立归属、歧义名称、组织树环、横向边自环/重复/环，以及作用域引用不存在或资源超出所属节点作用域，都返回具体错误码，并统一带 `invalid_support_organization` 分类。

## Scenario 编译结果

编译器将规范结构稳定排序后写入 `simulation_inputs.support_network.organization_graph`：

- `nodes[]`
- `parent_edges[]`
- `lateral_edges[]`
- `resource_ownership[]`
- `transport_policies[]`

这些字段进入 consumed/derived provenance，同时整个 `organization_graph` 标记为 `runtime_deferred_fields`。仅修改组织图时，既有 `support_network.nodes` 和当前模型指标必须保持不变。
