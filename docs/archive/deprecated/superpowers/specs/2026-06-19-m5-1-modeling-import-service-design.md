# M5.1 建模导入服务化设计

## 背景

M5 首片已经定义 `modeling-import-v1` 导入包、JSON fixture、纯前端校验器和 contract tests。M5.1 的目标是把这个 contract 接入本地后端 API 和 SQLite repository，使导入校验、保存、发布和运行引用保护进入真实持久化边界。

本阶段继续跳过 M4 用户、权限和审计，不做完整 Excel UI，不做生产 worker，不改变 Mesa 行为，不让前端直接生成最终 Scenario，也不解锁 `aviation_support` Project -> Scenario 编译。

## 目标

1. 后端提供建模导入校验 API，接受 `modeling-import-v1` 包并返回字段级 issues。
2. SQLite repository 持久化导入包、validation summary、草稿/发布状态和版本。
3. 已发布且被 run 引用的导入版本不能被无痕覆盖；再次发布必须产生新版本或返回阻断错误。
4. 前端 API client 暴露导入校验/保存/发布方法，但不改变通用编辑自动保存边界。
5. 文档同步说明 M5.1 是服务化首片，不是 Excel UI 或完整 M5。

## API 设计

新增同源 `/api` 路径：

```text
POST /api/modeling-imports/validate
POST /api/modeling-imports
POST /api/modeling-imports/{import_id}/publish
GET  /api/modeling-imports/{import_id}
```

`validate` 只运行 contract 校验，不写入数据库。`POST /modeling-imports` 保存草稿或校验结果。`publish` 将导入包标记为 `published`，如果同一个 `import_id` 的已发布版本被 run 引用，则返回 `published_import_referenced`，要求调用方创建新 `import_id` 或新版本。

所有错误保持结构化：

```json
{
  "code": "invalid_modeling_import",
  "message": "Modeling import package failed validation",
  "details": {
    "issues": [
      {
        "code": "missing_reference",
        "severity": "error",
        "page": "保障活动建模",
        "object_id": "replace-radar",
        "field_path": "objects.supportActivities[0].resourceId",
        "message": "..."
      }
    ]
  }
}
```

## 数据模型

新增表 `modeling_imports`：

```text
import_id TEXT PRIMARY KEY
project_id TEXT NOT NULL
schema_version TEXT NOT NULL
import_version INTEGER NOT NULL
status TEXT NOT NULL
validation_status TEXT NOT NULL
referenced_run_ids_json TEXT NOT NULL
payload_json TEXT NOT NULL
draft_payload_json TEXT
published_payload_json TEXT
created_at TEXT
updated_at TEXT
```

`payload_json` 保留兼容性快照，`draft_payload_json` 与 `published_payload_json` 保存可恢复的草稿/发布版本。`referenced_run_ids_json` 是最小引用保护入口；后续可迁移为独立 join table。M5.1 不把导入包编译为 Scenario，不写入 `scenarios`。

## 校验规则

服务端复用与前端一致的 M5 首片语义，但实现为 Python 纯函数，避免后端调用 Node：

1. `schemaVersion` 必须是 `modeling-import-v1`。
2. 根字段 `importId`、`projectId`、`lifecycle`、四个对象集合必填。
3. 对象内必填字段必须存在。
4. `durationHours`、`quantity`、`mtbfHours`、`capacity` 必须大于 0。
5. `equipmentAssets.parentId`、`supportActivities.equipmentId`、`supportActivities.resourceId` 必须指向已存在对象。
6. `published` 且有 `referencedRunIds` 时，`update/delete` 变更返回 `published_reference_protection`。

## 测试策略

1. Python repository tests 覆盖表结构、保存/读取导入包、发布状态和引用保护。
2. Backend API tests 覆盖 validate、save、publish、get 四个函数级入口。
3. HTTP tests 覆盖同源 `/api/modeling-imports/*` 路径、invalid package 的 400 错误和 issue 结构。
4. Frontend API client tests 覆盖新增方法的路径和 body，不触发通用编辑自动保存。
5. 现有 Node/Python smoke 保持通过。

## 非目标

1. 不做 Excel 上传 UI、复杂表格映射或字段清洗工作台。
2. 不做用户权限、角色、审计。
3. 不做生产 worker、长期对象存储、运行取消/重试。
4. 不改变 `SimulationAdapter` 的 Scenario 编译口径。
5. 不修改 Mesa 模型、指标或 artifact 结构。
