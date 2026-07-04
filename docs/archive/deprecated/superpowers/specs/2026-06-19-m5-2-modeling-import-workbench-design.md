# M5.2 建模导入工作台与 Scenario 生成设计

## 背景

M5.1 已经把 `modeling-import-v1` 导入包接入后端校验、SQLite 持久化、草稿/发布状态和同源 `/api/modeling-imports/*`。M5.2 继续推进用户要求的导入页面入口、映射预览、字段错误定位、草稿/发布版本、差异对比和通过 `SimulationAdapter` 生成 Scenario。

本阶段继续保持 M5 的窄边界：不做 Excel 文件解析器，不做用户/权限/审计，不解锁 `aviation_support` 编译，不让前端直接拼 Scenario JSON。

## 目标

1. 在系统管理导航中提供「建模数据导入」入口，页面展示导入包摘要、字段映射预览、校验错误定位、草稿/发布状态和版本差异。
2. 前端通过显式按钮调用 M5.1 API 校验、保存、发布导入包，不接入通用编辑自动保存。
3. 后端提供一个从已发布导入包生成 smoke Project 并调用 `SimulationAdapter.compile_scenario()` 的函数/API，返回编译出的 Scenario 预览和 trace metadata。
4. 导入包草稿可以保存和重新校验；已发布且被运行引用的版本仍受 M5.1 引用保护约束。
5. 文档明确 M5.2 是「导入工作台 + 受控 Scenario 预览」阶段，不是完整 Excel UI、生产 worker 或 aviation_support 解锁。

## 关键边界

### 导入页面入口

入口放在系统管理 / 项目管理下，四级功能名为「建模数据导入」。这样它与项目独有数据、建模颗粒度管理同属数据管理域，不挤进仿真建模页面，也不改变现有任务/装备/保障表单的编辑流。

### 映射预览

映射预览只展示 `modeling-import-v1` 对象集合到现有四级建模页面的关系：

- `missionProfiles` -> 任务剖面参数
- `equipmentAssets` -> 装备组成建模
- `supportResources` -> 保障资源建模
- `supportActivities` -> 保障活动建模

预览显示集合行数、关键字段、目标页面、目标 Project 字段路径。M5.2 不做自由拖拽映射。

### 字段错误定位

校验错误沿用 M5.1 issue 结构：`page`、`object_id`、`field_path`、`severity`、`message`。前端以问题列表和字段路径卡片展示，不新增另一套错误格式。

### 草稿/发布与差异

后端 `modeling_imports` 保存同一 `import_id` 的 `draft_payload_json` 与 `published_payload_json`。`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，前端用这两个持久对象计算新增、删除、修改的字段路径和对象 ID。发布后再次保存草稿只更新 draft payload，不覆盖 published payload；`compile-scenario` 只读取 published payload。

### Scenario 生成

后端新增 `compile_modeling_import_scenario(import_id, model_family="smoke")`：

1. 读取已保存导入包。
2. 要求导入包校验通过；未发布时返回 `unpublished_modeling_import`。
3. 将导入包映射为当前 `project-v0` 的最小 smoke Project。
4. 调用 `SimulationAdapter.compile_scenario(project, model_family="smoke")`。
5. 返回 `project`、`scenario` 和 `compiled_from_import` metadata。

`aviation_support` 继续返回 `unsupported_model_family`。

## 测试策略

1. 后端 API tests 覆盖导入包 -> Project 映射、未发布阻断、invalid 阻断、Scenario 由 `SimulationAdapter` 编译。
2. HTTP tests 覆盖 `POST /api/modeling-imports/{import_id}/compile-scenario`。
3. Frontend unit tests 覆盖映射预览、差异计算、API client 方法和 app 中的导入工作台入口。
4. 文档同步后运行 stale wording 搜索，确认 M5.2 非目标没有被过度承诺。

## 验收标准

1. 页面能从系统管理导航进入「建模数据导入」。
2. 页面能显示映射预览、字段错误定位、草稿/发布状态和发布差异。
3. 页面显式按钮可调用 validate/save/publish/compile-scenario API client。
4. 后端 Scenario 预览必须经 `SimulationAdapter.compile_scenario()` 生成。
5. `npm test`、后端相关 `unittest` 和 `git diff --check` 通过。
