# 设计与编码评审（2026-06-20）

日期：2026-06-20

> 行号说明：本评审所有行号基于 2026-06-20 评审时的 HEAD 快照（`front/app.js` 当时 5898 行）。代码持续演进，定位问题时以**函数名/标识符**为准，行号仅作辅助参考。
>
> 本文件是一次**只读评审产物**，不改变任何代码、契约或产品边界，也不代表已实施的修复。每条问题附文件路径与函数名/行号、影响、修复方向。

## 范围

覆盖 `front/`（原生 ES module 前端）、`src/spare_mvp_backend/`（Python 标准库 + SQLite 后端）、`src/spare_mvp_contract/adapter.py`（契约适配）、`src/spare_mvp_backend/repository.py` + `schema.sql`（持久化）、`src/spare_mvp_backend/http_server.py`（HTTP 边界）。Mesa ABM 模型实现（`aviation_support/model.py`、`smoke_model.py`）与 `docs/`、`contracts/` 不在本次重点评审范围。

## 总体判断

这是一个**架构思路清晰、契约纪律严、测试扎实**的原型，但积压了两类系统性债务：**前端单文件巨型化**（`app.js` 5898 行）和**后端单连接跨线程共享 SQLite**。多数"契约正确性"承诺在 happy path 上成立，但在并发和"非 publish 入口"下会被绕过。

亮点（不夸大）：

- 测试纪律强：评审时 `npm test` 159 个测试全部通过，含 8 个 Python 后端契约测试（`test_backend_api_contract`、`test_backend_http_api`、`test_database_contract`、`test_simulation_adapter`、`test_contract_server` 等）与 `tests/e2e-contract-flow.test.mjs`。
- contract-first 设计落实：schema 版本号、`compiled_from.mapping_provenance`、artifact manifest + `sha256` + `size_bytes`、consumed/ignored/unsupported 字段追踪都有迹可循。
- fail-closed compile gate 严谨：`aviation_support` 在 `_compile_scenario_with_gate` 显式阻断并返回字段级 diagnostics；无法编译的 ExperimentPlan 走 `_persist_failed_compile_run`，返回 failed status envelope、不生成 `result_summary_id`、给空 ArtifactManifest，不回退到 demo 或前端局部推导。
- 边界声明诚实：README / agent.md 反复强调"原型不是校准后的工程级仿真平台"，不在文档里把小样本结果说成最优方案。

## 评审期间验证证据

| 命令 | 结果 |
| --- | --- |
| `wc -l front/app.js` | 5898 行（单文件巨型化佐证） |
| `npm test` | 159 个测试通过，0 失败 |
| `grep -rn "def _stable_hash\|def _utc_now\|def _steps_from_plan" src/` | `_stable_hash` 在 `api.py`/`run_service.py`/`repository.py` 各一份；`_utc_now` 在 `adapter.py`/`run_service.py` 各一份且实现不一致；`_steps_from_plan` 在 `api.py`（死代码）/`run_service.py` 各一份 |
| `git ls-files \| grep -E '\.pyc$\|__pycache__\|\.DS_Store'` | 空（工程卫生合格） |
| `grep -n "htmlEscape\|aircraft.label\|mission.id" front/app.js` | 全项目渲染均用 `htmlEscape`，唯独 Mesa 渲染区（`renderMesaStage` 等）遗漏 |

## 一、设计与架构问题（高优先）

### A1. 单 SQLite 连接跨线程共享 —— 并发数据竞争根因

`http_server.py:30` 用 `sqlite3.connect(..., check_same_thread=False)` 建一个连接，配合 `ThreadingHTTPServer`（`BackendHTTPServer`）让所有请求线程共享同一个 `Connection` / `ContractRepository`。

- `sqlite3` 隐式事务（`isolation_level=""`）下，A 线程的写和 B 线程的写可能落入**同一个隐式事务**，任一方 `commit()` 会把另一方未完成的写一起提交；`repository` 每个方法末尾的 `self.connection.commit()`（如 `upsert_project`、`upsert_modeling_import`、`upsert_run`）跨线程互相干扰。
- 读一致性丢失：`get_modeling_import` 读 `draft_payload_json` / `published_payload_json` 时，另一线程可能正写到一半。
- 这是 A4 / A5 / 编码 C3 的共同前提，不先修这个，并发问题修不干净。
- **修复方向**：每请求一个连接（去掉 `check_same_thread=False` 共享），或 `threading.local()` 持有线程连接；加 `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`。

### A2. "发布后被 run 引用的 import 不可覆盖"承诺可被绕过

README / agent.md 把这条作为核心不变量反复强调，但实现有缺口（已逐行核实 `repository.py` `upsert_modeling_import`，约 252–297 行）：

- `upsert_modeling_import`（保存/存草稿入口，`api.py` `_save_modeling_import_trusted` 直接调它）**从不调用 `assert_modeling_import_can_publish`**。
- 当上传包带 `lifecycle.state == "published"` 时，`published_payload_json = _to_json(payload)` 直接覆盖已发布快照；`referenced_run_ids` 的回填条件 `state != "published"` 不满足，于是用调用方传入的 `referencedRunIds`（可为 `[]`）。
- **结果**：一个已发布、已被 run 引用的 import，只要有人 `POST` 一个 `state:"published"` 的包到 `/api/modeling-imports`，引用记录和已发布快照被静默覆盖，覆盖保护完全不触发。现有测试只覆盖了"先存草稿 → 再调 `publish_modeling_import` 被拦"这一条路径，未覆盖这条绕过路径。
- **修复方向**：`upsert_modeling_import` 入口，凡 `state == "published"` 或 existing 已 published，必须先调 `assert_modeling_import_can_publish`，并补一条覆盖绕过路径的回归测试。

### A3. 版本号字段当乐观锁却从不校验 —— 形同虚设

`schema.sql` 定义了 `project_version` / `import_version`，但所有 `ON CONFLICT DO UPDATE` 都是无条件 `import_version = excluded.import_version`（如 `repository.py` `upsert_modeling_import`），从不带 `WHERE version = :expected`，也从不检查 `cursor.rowcount`。丢失更新发生时调用方毫无感知。README 的"新版本需用新 import_id"靠约定，不是强制。

- **修复方向**：version 更新改为 `UPDATE … WHERE version = ?` 后校验 `cursor.rowcount == 1`，否则抛冲突错误。

### A4. 前端 `app.js` 5898 行上帝文件 + ~60 个顶层 `let` 全局状态

单文件同时承担路由、6+ 套领域渲染（项目列表 / 系统管理 / 装备建模 / 任务建模 / RMS / Mesa / Monte Carlo / 结果分析）、认证、localStorage、~800 行的 `click` / `input` if-链事件分发、本地仿真编排。约 60 个顶层可变状态（`scenario` / `experimentPlanDraft` / `singleResult` / `backendRun*` / `rmsAllocation*` / `modelingImport*` 等）无单一事实源、无订阅机制。

- `scenario` ↔ `experimentPlanDraft` 是手工同步的"分支"关系（`experimentPlanBranchActive` 标志多处手动复位），漏一处就读到陈旧值；这也是 H1（异步竞态）的温床。
- 这是可维护性核心债务。workbench 已拆成独立 `.mjs`（`modeling-import-workbench.mjs`、`rms-allocation-workbench.mjs` 等），证明可拆。
- **修复方向**：按域渐进拆分——先抽 `state/store.mjs`（集中 ~60 个全局变量）与 `router.mjs`，再逐页拆 `pages/*.mjs`；事件分发改 data-attribute → handler 注册表。

### A5. formal-result boundary 的"降级语义"被削弱

README / agent.md 要求"`/api` 不可用时显示阻断状态，不创建 `offline-demo-run`"。但前端在 `/api` 失败时（`saveCurrentProjectDraftThroughApi` 的 catch 分支、登录失败分支）：

- 登录失败时直接 `isLoggedIn = true` 放行进入工作台；
- 保存项目失败后用伪造的 `savedProject = { status: "offline-demo", ... }` 占位，后续 `createModelingSnapshot` / `createExperimentPlan` / `submitRun` 仍以这个伪造 `project_id` 继续发请求；
- 前端没有真正的"阻断态"，而是把降级结果伪装成有效状态。

`formalAnalysisBoundary()` 硬编码 `formalUnlocked = false` 兜住了四类分析页（这点是好的、是当前最安全的兜底），但 run 启动时先用本地 `singleResult` 覆盖全局结果再 `await` 后端，窗口期内 UI 渲染的是无标注的本地数据。

- **修复方向**：后端不可用时把对应操作置为显式阻断（按钮 disabled + 错误横幅），不伪造 `savedProject` 占位，登录失败不 `isLoggedIn = true`；`saveProject` 失败时 `savedProject = null` 并 `return`，不继续 snapshot/plan/run。

## 二、安全问题

| # | 位置（函数名 / 行号快照） | 问题 | 严重度 |
| --- | --- | --- | --- |
| S1 | `api.py` `_password_hash`（约 450 行）；`repository.py` `create_user` 默认密码=用户名（约 86 行） | 密码用**裸 SHA-256 无盐**；默认用户密码 = 用户名。无 salt、无慢哈希，彩虹表/暴力秒破 | 高 |
| S2 | `app.js` `renderMesaStage` / `renderMesaAircraftPanel` / `renderMesaMissionPanel`（约 4757–4825 行） | Mesa 可视化把来自外部 8521 契约服务的 `aircraft.label` / `aircraft.type`、`mission.id` / `mission.status` 等**未转义直插 innerHTML**——全项目其他渲染都用了 `htmlEscape`，唯独这块遗漏。叠加 S3 可形成窃取 token 的 XSS 链 | 高 |
| S3 | `app.js` `localStorage.setItem(AUTH_SESSION_KEY, ...)` / `readStoredBackendAuthToken` | bearer token 明文存 localStorage，启动时读出即用、无 exp 校验。S2 一旦触发即可被读走 | 中 |
| S4 | `http_server.py` `_read_json`（约 168–173 行） | 按 `Content-Length` 全量 `rfile.read(length)`，**无大小上限** → 内存耗尽 DoS | 中 |
| S5 | `http_server.py` `_send_json`（约 180 行）；`contract_server.py` | `Access-Control-Allow-Origin: *` 全开，但只实现 `do_GET` / `do_POST`、**无 `do_OPTIONS` preflight**，也未设 `Allow-Headers` / `Allow-Methods`。带 Authorization 的跨域请求会被浏览器 preflight 拦死，公开端点却任由任意站点调用——CORS 语义不一致 | 中 |
| S6 | `http_server.py` `/api/auth/login` 路由 | 无登录失败限流/锁定 → 暴力破解（本地原型可接受，上生产必修） | 低 |

> S1 / S2 在本地可信内网原型里威胁面有限，但都是**明确的反模式**且会随部署外移被放大，建议现在就修。

## 三、编码质量问题

### 后端

- **C1 代码重复 + 实现不一致**：`_stable_hash` 在 `api.py`、`run_service.py`、`repository.py` **各一份**（3 份）；`_utc_now` 在 `adapter.py`（带 `.replace(microsecond=0)`）和 `run_service.py`（**不带** microsecond 截断）——同一概念两种实现，时间戳精度不一致，是潜在 bug；`_steps_from_plan` 在 `api.py`（死代码）和 `run_service.py` 各一份。应抽到公共模块（如 `src/spare_mvp_backend/_util.py`）。
- **C2 反射式冗余防御**：`run_service.py` `_submit_run_unlocked` 用 `getattr(self.adapter, "compile_scenario_with_gate", None)` + `callable()` 检查（约 77–94 行），但该方法在 adapter 里是明确存在的稳定方法，`else` 分支（直接调 `compile_scenario` 并 catch `AdapterError`）永远不会执行——死分支，徒增理解成本。
- **C3 ID 生成不可靠**：`next_run_id` / `next_modeling_snapshot_id`（`repository.py` 约 558–591 行）用 `LIKE 'prefix%'` 扫全表取 max+1 自增；进程内靠 `RunService._run_lock` 串行，但跨进程/多实例会碰撞，且 `ON CONFLICT(run_id)` 会静默覆盖（丢失更新无报错）；`run-xxx-0001` 顺序递增可枚举。建议改 UUID 或 `INSERT … ON CONFLICT DO NOTHING` 重试。
- **C4 `_get_payload` 用 f-string 拼表名/列名**（`repository.py` 约 687 行）：当前调用方传内部常量不可控，但属应禁用的 SQL 拼接模式。
- **C5 `json.loads` 无防御**：`list_audit_events`（`repository.py` 约 218 行）等处解析历史 `details_json` 不 try/except，坏数据会让整个 list 接口 500。

### 前端

- **C6 全量 `render()` 重建 `app.innerHTML`**（`render`，调用点遍布 click/input）：每次交互重建数千节点 DOM，**输入框焦点丢失、未提交表单清空**；配合 C7 编辑体验明显损坏。
- **C7 表单 `[data-path]` 同步绑在 `click` 而非 `change` / `input`**：用户键入时内存 `scenario` 不更新，输入框值与状态长期不同步。应改 `change`（失焦提交）+ 局部更新而非整树重建。
- **C8 `runMonteCarlo` 在交互路径上同步阻塞主线程**：`updateDemoResultsThroughApiClient` 在多个交互点同步触发 `sweep × samples` 次 `runSimulation`（默认 samples=24，sweep 笛卡尔积膨胀），UI 卡顿。应延迟到显式"启动/刷新"或去抖 + Web Worker。
- **C9 fetch 无超时、不区分网络错误与业务错误**（`api-client.mjs` `createFetchTransport` 约 152 行）：无 `AbortController`，后端 hang 时永久挂起；网络层 `TypeError` 被当普通 4xx 展示，无法进入真正的"阻断态"。这也是 A5 降级逻辑混乱的帮凶。
- **C10 schema 版本前端硬编码兜底**：`api-client.mjs`（约 106 行）`schema_version ||= "project-v0"`、`project_version ||= "project-v0.1"` 静默补默认值，后端 bump 版本时前端仍写旧串，契约漂移无感知。

## 四、工程卫生（基本合格，少量瑕疵）

- 合格：`.gitignore` 正确忽略 `__pycache__` / `*.pyc` / `.DS_Store` / `runs/*`，`git ls-files` 未追踪这些；硬编码 `/Users/gaojihe` 只出现在 `src/spare_mvp_abm/aviation_support/*.md` 来源说明里，符合 agent.md 规则 5。
- 瑕疵：README 的"本地运行 / 烟测"命令写死了 `/opt/homebrew/bin/python3.12` 和 `/Users/gaojihe/.codex/skills/...` 绝对路径——在文档/本地验证命令里合规，但**完全不可移植**，换机器即失效。建议改用 `.abm-mesa-test-env/bin/python` + 相对引用，或明确标注"本机路径，需替换"。

## 五、建议的修复顺序

1. **A2**（覆盖保护绕过）—— 契约正确性，改动小、收益大，加几行校验 + 补一条绕过路径的测试。
2. **A1 + schema**（连接模型 + `WAL` / `busy_timeout`）—— 并发根因，是 A3 / C3 的前提。
3. **S1**（密码改 `pbkdf2_hmac` / `scrypt` 加盐，去掉默认密码=用户名）+ **S2**（Mesa 渲染补 `htmlEscape`）+ **S4**（`_read_json` 加大小上限）—— 安全反模式，改动都不大。
4. **C1**（抽公共 `_stable_hash` / `_utc_now` / `_steps_from_plan`，统一 `_utc_now` 实现）—— 顺手清理，消除时间戳不一致隐患。
5. **A4**（拆 `app.js`）—— 最大但最慢的债务，建议按域渐进拆分。
6. A3 / A5 / C3 / C6–C10 按模块逐步收敛。

## 边界声明

- 本文件是一次只读评审的归档产物，**不代表任何修复已实施**，也不改变现有契约、schema、API 或产品边界。
- 行号为 2026-06-20 HEAD 快照，代码持续演进，定位以函数名/标识符为准。
- 评审未修改任何运行时代码、测试或配置文件；`npm test`（159 通过）为评审时的基线，修复实施后应重新跑全量测试确认。
