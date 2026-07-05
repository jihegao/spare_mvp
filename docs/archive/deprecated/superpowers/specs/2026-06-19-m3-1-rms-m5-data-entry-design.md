# M3-1 RMS 收束与 M5 数据入口设计

## 背景

当前分支正在从 M3-1/RMS 收束推进到 M5 数据入口首片，已有基础包含两类工作：

1. M3-1 真实浏览器后端闭环：同源 `/api`、持久 SQLite、Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest 链路，以及 `/api` 不可用时阻断离线假 run。
2. RMS 指标分配页面：装备 RMS 分配设计、前端页面入口、分配结果、后端 contract 和测试补充。

用户明确跳过 M4 用户、权限和审计，选择继续推进当前分支收束，并把 M5 建模数据真实化作为下一目标。因此本设计把工作拆成两个连续阶段：阶段 A 收束当前分支，阶段 B 为 M5 建立可执行入口。

## 目标

阶段 A 的目标是让当前分支可验收、可测试、可发 PR。验收口径是：浏览器通过真实同源 `/api` 完成保存、运行、刷新恢复结果；RMS 分配页面可进入、可解释、可复算；文档明确当前能力和非目标。

阶段 B 的目标是启动 M5 建模数据真实化，但不把 M5 的全部实现塞进当前分支。M5 第一片应聚焦导入、校验、发布和错误定位的 contract 入口，为后续 Excel/JSON 导入和 Project -> Scenario 前置校验打基础。

## 阶段 A 范围

阶段 A 包含：

1. 复核当前 dirty worktree，确认未提交文件都属于 M3-1 或 RMS 分配收束。
2. 运行并修复当前 contract、backend、frontend 和 e2e 测试。
3. 运行 M3-1 浏览器后端 smoke，保留 JSON 和截图证据。
4. 确认 RMS 分配页面的保存边界：分配结果只能写入 RMS `target` 或 allocation plan，不覆盖 `prediction` 和 `actual`。
5. 同步 `README.md`、`docs/README.md`、`docs/product-roadmap.md`、`docs/simulation-service-governance.md` 和相关报告。

阶段 A 非目标：

1. 不做 M4 用户、权限、角色、审计。
2. 不解锁 `aviation_support` Project -> Scenario 编译。
3. 不扩展 Mesa 行为、随机过程、指标口径或 artifact 结构。
4. 不声明生产 Web API、worker 队列、长期对象存储或校准质量已经完成。

## 阶段 B 范围

阶段 B 的第一片是 M5 数据入口，不是完整 M5。它包含：

1. 定义项目建模数据导入格式，可以先支持 JSON fixture 或简化 CSV，Excel 作为后续导入适配层。
2. 建立对象 ID、引用关系、必填字段、重复编号、非法数值和运行引用保护的校验结果结构。
3. 区分 Project 草稿、发布版本和被运行引用后的只读版本。
4. 让错误结果可以定位到页面、对象、字段路径和严重级别。
5. 保持 Project JSON 可由前端编辑，Scenario JSON 必须由 Simulation Adapter 编译。

阶段 B 非目标：

1. 不做完整 Excel UI 和复杂表格映射器。
2. 不做权限审计。
3. 不做生产 worker。
4. 不改变仿真模型口径。

## 数据流

阶段 A 数据流：

```text
浏览器 /front/
  -> front/api-client.mjs
  -> src/spare_mvp_backend/http_server.py
  -> BackendApi
  -> ContractRepository + SimulationAdapter
  -> SQLite + run artifact directory
  -> 浏览器刷新后按 run_id 恢复结果
```

阶段 B 数据流：

```text
导入文件或前端建模数据
  -> Project draft
  -> import / validate contract
  -> field path errors
  -> published Project version
  -> Simulation Adapter compile-scenario
```

## 错误处理

阶段 A：

1. `/api` 不可用时，前端必须显示后端不可用，并且不创建 fake run_id。
2. 后端 API 返回错误时，前端展示错误状态，保留本地编辑状态。
3. 浏览器 smoke 必须覆盖刷新恢复和 API 阻断路径。

阶段 B：

1. 导入错误必须包含 `object_id`、`field_path`、`severity` 和 `message`。
2. 引用错误必须指出来源对象、字段和缺失目标 ID。
3. 已发布且被 run 引用的对象不得被无痕覆盖，只能产生新版本。

## 测试策略

阶段 A 验证命令：

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

阶段 B 首片验证命令应在实施时补充，但至少包括：

```bash
npm test
.abm-mesa-test-env/bin/python -m unittest discover tests
```

## 验收标准

阶段 A 完成时：

1. 当前分支测试通过。
2. M3-1 浏览器 smoke 有最新 JSON 和截图证据。
3. README 和 docs 明确 M3-1、RMS 分配和非目标。
4. PR 描述可以清楚说明未修改 Mesa 行为。

阶段 B 首片完成时：

1. 导入/校验 contract 有 fixture 和测试。
2. 错误定位可以映射到页面、对象和字段路径。
3. Project 草稿、发布版本和运行引用保护有最小测试。
4. 没有绕过 Simulation Adapter 直接拼 Scenario JSON。

## 自检

本设计无待定项。阶段 A 和阶段 B 是连续但独立的交付单元；阶段 A 可以先发 PR，阶段 B 应另起分支或后续 PR，以免把当前分支验收和 M5 长线工作混在一起。
