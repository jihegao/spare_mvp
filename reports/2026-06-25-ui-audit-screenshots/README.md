# 2026-06-25 UI 审计截图基线

这些截图是在 2026-06-25 使用本地页面 `http://127.0.0.1:4173/front/` 截取的当前状态基线，用于后续实现后的 before/after 对比。

## 截图清单

- `00-project-list-baseline.jpg`：项目列表，证明当前项目卡片只有 `进入 / 编辑 / 删除`，尚无项目 JSON `导入 / 导出`。
- `01-equipment-composition-baseline.jpg`：装备组成建模，证明当前装备系统建模仍拆分为组成/故障两个页签。
- `02-equipment-failure-baseline.jpg`：装备故障建模，证明当前故障属性仍在独立页签中。
- `03-rms-allocation-baseline.jpg`：装备 RMS 指标分配，证明当前布局和方法选项尚未按新方案重构。
- `04-composite-task-baseline.jpg`：复合任务建模，证明当前存在从基本任务带入的属性列和操作列。
- `05-support-organization-baseline.jpg`：保障组织结构建模，证明当前组织详情仍以表单方式展示。
- `06-support-personnel-baseline.jpg`：保障人员建模，证明当前资源表仍包含 `适用机型` 和 `操作` 列。
- `07-basic-support-activity-baseline.jpg`：基本保障活动建模，证明当前表格仍包含 `弹药需求` 和 `操作` 列。
- `08-experiment-plan-list-baseline.jpg`：仿真实验方案列表，证明当前仍包含 `场景`、`操作` 和启动/创建按钮。

## 后续对比约定

- 修改后截图使用相同编号和 `after` 后缀，例如 `01-equipment-composition-after.jpg`。
- 每次实现分片完成后，至少补充该分片涉及页面的 after 截图。
- 对比结论写回 `docs/superpowers/plans/2026-06-25-ui-audit-todo.md` 对应条目。
