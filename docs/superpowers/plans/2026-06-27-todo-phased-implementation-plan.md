# 2026-06-27 TODO 分阶段实施计划

> **给 agent 执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪状态。
>
> **活跃入口：** 本文是 2026-06-27 TODO 的唯一活跃执行计划。原始 TODO 与评审改写稿已归档为备查，不再作为执行入口。

**目标：** 将 2026-06-27 TODO 评审稿拆成分阶段、可测试、可交付的实施切片，避免把已确认页面修订、阻断中的算法事项、集成工作和下一阶段系统配置混在同一批实现中。

**架构：** 以归档的 2026-06-27 原始 TODO 和评审改写稿为需求来源，但按依赖顺序拆分实施。当前阶段优先处理两个业务模块共用的建模页面；正式 run 和结果集成必须先关闭后端鉴权、输入追溯和 artifact 安全缺口；系统运行支持配置保持为后续阶段。RMS 算法切片不参与当前建模仿真主流程，推迟到阶段 4，在公式和字段名确认后独立推进。

**技术栈：** `front/` 浏览器端 ES modules、Node `node:test`、`src/spare_mvp_backend/` Python 标准库后端与 SQLite、`src/spare_mvp_contract/` 和 `contracts/` 中的仿真 adapter 与契约 schema、Python `unittest`。

---

## 阶段 0：基线加固与需求冻结

**目的：** 在算法和结果集成实现前，先让后续正式集成工作具备安全边界，并把会阻塞主流程的需求明确冻结。RMS 指标分配结果当前不作为 `aircraft_support_v1` 建模、compile 或 `/api/runs` 的必填输入，因此只记录为阶段 4 的 `decision-needed`，不阻塞阶段 0 合并。

**文件：**
- 修改：`src/spare_mvp_backend/http_server.py`
- 修改：`src/spare_mvp_backend/api.py`
- 修改：`src/spare_mvp_backend/repository.py`
- 修改：`src/spare_mvp_backend/run_service.py`
- 修改：`src/spare_mvp_contract/adapter.py`
- 修改：`contracts/aircraft_support_v1_input.schema.json`
- 测试：`tests/test_backend_http_api.py`
- 测试：`tests/test_backend_api_contract.py`
- 测试：`tests/test_database_contract.py`
- 测试：`tests/test_simulation_adapter.py`
- 测试：`tests/test_aircraft_support_v1_model.py`
- 文档：`docs/superpowers/plans/2026-06-27-todo-phased-implementation-plan.md`

- [x] HTTP 项目写入、项目删除、实验方案创建和 `/api/runs` 提交必须要求已认证的 M4 session。
- [x] 正式 run 成功后记录 `modeling_import -> run_id` 引用，并拒绝重新发布已被 run 引用的导入包。
- [x] 修复 `aircraft_support_v1` 时长编译 gate：有效周期任务可以在没有 `missionProfile.durationHours` 时推导时长；周期任务无法推导时长时仍必须阻断。
- [x] 在 compile gate 拒绝保障活动工作项目的环形紧前关系。
- [x] 在 compile gate 拒绝归一化后重复的飞机尾号。
- [x] 在本计划中冻结仍未确认的主流程需求决策，并把 RMS 算法问题标记为阶段 4 非阻塞决策：
  - RMS 反算字段的新名称、运行比定义和 MTBCF/MTBF 公式，推迟到阶段 4，不阻塞阶段 0。
  - `颗粒度 B` 字段集合。
  - `海航大对应模块原型` 的截图或路径。
  - 每个“完成集成”事项的正式 artifact / 数据来源。

**验证：**
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract -v`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_aircraft_support_v1_model -v`。
- [x] 运行 `npm test`。

阶段 0 验证记录：如果当前 worktree 未包含相对路径 `.abm-mesa-test-env`，可使用同一仓库主 checkout 中的本地等价解释器执行上述 Python 验证命令；不要把具体机器上的绝对路径视为计划要求。

**退出标准：** 正式 run 写路径已鉴权，导入包 lineage 在 run 使用后不可被覆盖，主流程阻断需求被明确标注为阻断项而不是被静默实现；RMS 相关未确认项已明确移入阶段 4，不作为阶段 0 合并门槛。

---

## 阶段 1：共用建模页面收敛

**目的：** 交付 `备件规划评估模块` 和 `任务可靠度评估模块` 当前阶段已确认的 UI / 数据模型修订。

**文件：**
- 修改：`front/feature-catalog.mjs`
- 修改：`front/app.js`
- 修改：`front/styles.css`
- 修改：`front/equipment-tree-model.mjs`
- 修改：`front/mission-exposure-compiler.mjs`
- 修改：`front/modeling-import-contract.mjs`
- 修改：`src/spare_mvp_backend/modeling_import.py`
- 修改：`src/spare_mvp_contract/adapter.py`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/frontend-app-runtime.test.mjs`
- 测试：`tests/equipment-tree-model.test.mjs`
- 测试：`tests/mission-exposure-compiler.test.mjs`
- 测试：`tests/modeling-import-contract.test.mjs`

- [x] 装备系统建模：
  - MTBF / MTTR 分布类型仅保留 `固定值`、`指数分布`、`正态分布`、`均匀分布`。
  - MTBF / MTTR 先选择分布类型再显示关联参数输入；MTBF 默认 `指数分布`，MTTR 默认 `固定值`。
  - 按分布类型渲染精确的参数字段，`固定值`、`指数分布`、`正态分布`、`均匀分布` 都有对应输入形态。
  - 删除示例 `舰载机` 节点。
  - 校验 SRU 的上级必须是 LRU。
  - 组件属性为空时显示为空白。
  - 点击飞机级节点时，右侧行按节点从高到低排序。
  - 左侧装备组成树增加 `导入表格` 入口，支持 CSV / TSV / JSON 装备结构表导入并覆盖当前装备结构树。
  - 点击整机级节点时，右侧显示整机级信息行以及其子孙节点；整机名称与整机数量可在右侧维护。
  - 点击系统级节点时，右侧显示该系统节点及其子孙节点。
- [x] 装备可靠性框图建模：
  - 该页面只保留在 `任务可靠度评估模块` 下。
  - 左侧展示装备树。
  - 点击飞机列表根节点时，右侧不显示框图。
  - 点击整机或组件时，右侧只展示直接下一级节点，不显示当前选中节点自身。
  - `n中取k` 以外层并联框和 N 个同名分支节点展示，逻辑表格只保留一行。
  - 门逻辑节点单独处理。
  - 绘图契约已固化在 `docs/reliability-block-diagram-contract.md`，并由 `tests/rbd-evaluator.test.mjs` 与 `tests/frontend-contract.test.mjs` 覆盖。
- [x] 基本任务建模：
  - 删除 `返回时间比`。
  - 将 `任务阶段` 移入 `基本任务信息编辑`。
  - 新增 `提前通知时间`。
- [x] 复合任务建模：
  - 时序表按出动时刻排序。
  - 排序后重新连续编号波次序号。
- [x] 周期性任务建模：
  - 在周期性任务上方增加一层任务。
  - 左侧先配置总周数，并按总周数生成 `第1周` 到 `第n周` 的周次列表，每周对应一行。
  - 选中某一周后，右侧表格只维护该周 7 天的周内复合任务配置。
  - 去掉可编辑的 `任务周期天数` 字段，周期固定为一周 7 天。
  - 右侧表格的 `周次` 字段始终显示当前选中的第几周。
- [x] 基本作战单元建模：
  - 将 `日历日时间` 重命名或解释为大修周期语义。

**验证：**
- [x] 运行 `node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs tests/equipment-tree-model.test.mjs tests/mission-exposure-compiler.test.mjs tests/modeling-import-contract.test.mjs`。
- [x] 运行 `npm test`。

阶段 1B 验证记录：
- [x] 运行 `node --test tests/frontend-contract.test.mjs`。
- [x] 运行 `node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs tests/equipment-tree-model.test.mjs tests/mission-exposure-compiler.test.mjs tests/modeling-import-contract.test.mjs`。
- [x] 运行 `npm test`。

阶段 1A 验证记录：
- [x] 运行 `node --test tests/equipment-tree-model.test.mjs tests/rbd-evaluator.test.mjs tests/modeling-import-contract.test.mjs tests/frontend-contract.test.mjs`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_api_reports_field_level_issues tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_api_rejects_sru_parent_that_is_not_lru tests.test_backend_api_contract.BackendApiContractTest.test_modeling_import_api_covers_contract_parity_issues tests.test_backend_api_contract.BackendApiContractTest.test_create_project_from_modeling_import_saves_project_and_snapshot -v`。
- [x] 运行 `npm test`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract -v`。

**退出标准：** 两个业务模块暴露一致的建模行为，每个修改页面都有运行时测试或契约测试覆盖。

---

## 阶段 2：保障组织、资源与基本保障活动库

**目的：** 规范保障组织/资源页面，并构建后续保障活动流程依赖的可复用基本保障活动库。

**文件：**
- 修改：`front/app.js`
- 修改：`front/support-activity-jobs.mjs`
- 修改：`front/modeling-import-contract.mjs`
- 修改：`front/styles.css`
- 修改：`src/spare_mvp_backend/modeling_import.py`
- 修改：`src/spare_mvp_contract/adapter.py`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/frontend-app-runtime.test.mjs`
- 测试：`tests/support-activity-jobs.test.mjs`
- 测试：`tests/modeling-import-contract.test.mjs`

- [x] 保障组织：
  - 移除 3 级硬限制。
  - 持久化递归树节点。
- [x] 备件：
  - 增加 `所属装备`。
  - 移除行级编辑按钮。
- [x] 保障人员：
  - 将 `专业` 改为下拉选择。
  - 字典可用时从后续 `建模表单管理` 的专业字典读取；本阶段仅允许使用本地固定字典作为兼容回退。
  - 移除 `所属型号`。
  - 移除行级编辑按钮。
- [x] 保障设备：
  - 移除行级编辑按钮。
- [x] 基本保障活动建模：
  - 将即改即存改为编辑弹窗，点击 `编辑` 时弹出窗口，不在列表下方展开编辑面板。
  - 支持查询、新增、编辑、删除和按活动类型导入；活动类型选择仅保留 `使用保障活动`、`预防性维修`、`修复性维修`，不再提供 `后勤保障`。
  - 维护活动编号、工作名称、适用飞机、作业时长分布、保障人员、保障设备、备件需求。
  - 基本保障活动清单前端仅展示类型、名称、编号、适用对象和工期，不再展示 `保障人员`、`保障设备`、`备件` 字段；资源需求保留在编辑弹窗中维护。
  - `保障人员`、`保障设备`、`备件` 三个模块不在同一行展示，改为各自一行；每个模块均提供独立 `新增` 按钮，点击后弹出对应资源需求配置窗口，可一次维护多条参数。
  - 保障人员数据源来自 `保障组织建模 / 保障人员建模`，弹窗字段为 `专业`（从保障人员建模的专业字段下拉选择）和 `数量`。
  - 保障设备数据源来自 `保障组织建模 / 保障设备建模`，弹窗字段为 `型号`（从保障设备建模的型号字段搜索）、`名称`（从保障设备建模的名称字段搜索）和 `数量`。
  - 备件数据源来自 `保障组织建模 / 备件建模`，弹窗字段为 `型号`（从备件建模的型号字段搜索）、`名称`（从备件建模的名称字段搜索）和 `数量`。
  - 作业时长分布与四类允许分布保持一致。
- [x] 使用保障、预防性维修、修复性维修和后勤保障活动：
  - 工作项目从基本保障活动建模表中选择/搜索；点击 `新增工作项目` 后，`作业项` 可通过基础活动选择控件搜索并回填所需基本保障活动。
  - 根据选中的基本保障活动自动回填字段。
  - 保障活动所有工作项目清单不在前端展示 `保障人员`、`保障设备`、`备件` 字段；这些资源数据仍随所选基本保障活动写入工作项目数据，用于后续仿真/导出。
  - `紧前作业` 字段仅展示摘要，不提供表格内多选或普通工作项目编辑弹窗内编辑；每条工作项目通过紧前作业字段右侧的 `编辑紧前作业` 按钮打开独立弹窗维护。
  - `编辑紧前作业` 弹窗内可勾选当前工作项目清单中的已有作业；点击 `新增` 后，可搜索基本保障活动库并添加为新的工作项目，同时自动写入当前作业的紧前关系。
  - 修复性维修中，MTTR 从装备系统建模读取并只读展示，移除 `维修对象`。
  - 使用保障和后勤保障中，`方案名称` 移到三个阶段上方并由三个阶段共用。
  - 按要求移除 `最大时间参考` / `最大修复时间` 字段。

**验证：**
- [x] 运行 `node --test tests/support-activity-jobs.test.mjs tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs tests/modeling-import-contract.test.mjs`。
- [x] 运行 `npm test`。

阶段 2 验证记录：
- [x] 运行 `node --test tests/support-activity-jobs.test.mjs tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs tests/modeling-import-contract.test.mjs`。
- [x] 运行 `npm test`。

阶段 2 已完成保障组织递归树、资源表字段收敛、基本保障活动库编辑弹窗、工作项目基础库引用/搜索/自动回填，以及仅通过 `编辑紧前作业` 独立弹窗维护紧前关系。阶段 3 的仿真实验、可视化和结果承载信息架构仍未开始，不作为阶段 2 完成口径。

**退出标准：** 保障活动页面使用共享基本活动库，紧前作业只能通过每行 `编辑紧前作业` 打开的独立弹窗编辑，且弹窗支持从基本保障活动库搜索新增紧前作业；TODO 要求弹窗编辑的页面不再依赖隐藏的即改即存行为。

---

## 阶段 3：仿真实验、可视化与结果承载信息架构

**目的：** 移除分散的结果页面，让正式结果通过 `蒙特卡洛实验` 页面和正式 state-series / artifact 路径承载。

**文件：**
- 修改：`front/feature-catalog.mjs`
- 修改：`front/app.js`
- 修改：`front/api-client.mjs`
- 修改：`front/state-series-replay.mjs`
- 修改：`front/analysis-projection-adapters.mjs`
- 修改：`front/styles.css`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/frontend-api-client.test.mjs`
- 测试：`tests/state-series-replay.test.mjs`
- 测试：`tests/analysis-projection-adapters.test.mjs`
- 测试：`tests/frontend-app-runtime.test.mjs`

- [x] 仿真实验方案管理：
  - 移除场景字典。
  - 移除 `方案列表` / `方案编辑` 标签页。
  - 从列表编辑按钮跳转到编辑页。
  - 从方案列表移除 `启动可视化推演` 和 `创建蒙特卡洛实验` 按钮。
- [x] 可视化推演：
  - 将维修中的飞机和保障中的飞机拆分成两个统计指标。
  - 移除顶部飞机选择器。
  - 单机选择只保留在左侧列表。
  - 当缺少 `aircraft_support_v1` state-series 时，正式可视化不得静默回退到旧 `aviation_support` 或 demo state。
- [x] 蒙特卡洛实验页面：
  - 将原蒙特卡洛结果内容承载到蒙特卡洛实验详情/结果区域中。
  - 正式来源使用 canonical `/api/runs`、projection artifacts 和 `monte_carlo_base`。
  - 显式展示失败、缺 artifact、解析失败和 retry-pending 状态。
- [x] 移除独立结果页面：
  - 移除 `备件规划评估模块 / 结果分析 / 蒙特卡洛实验结果`。
  - 移除 `任务可靠度评估模块 / 结果分析 / 蒙特卡洛实验结果`。
  - 移除 `任务可靠度评估模块 / 结果分析 / 飞机任务可靠度分析`。
  - 旧路由别名只保留为重定向或 tombstone 提示，不再作为活跃页面。
- [x] Projection payload 校验：
  - 校验 projection payload 的 traceability 与当前 run id、model family 一致。
  - 正式回放必须要求 `aircraft_support_v1` state-series。

**验证：**
- [x] 运行 `node --test tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs tests/state-series-replay.test.mjs tests/analysis-projection-adapters.test.mjs tests/frontend-app-runtime.test.mjs`。
- [x] 运行 `npm test`。
- [x] 对方案管理、可视化回放、蒙特卡洛详情和已移除结果页导航运行浏览器冒烟。

阶段 3 浏览器冒烟验证记录：
- [x] 运行 `node reports/system-smoke/browser-smoke.mjs`。
- [x] 验证项目列表、项目进入、基本任务建模编辑、保障活动建模按钮反馈、蒙特卡洛实验列表/编辑/详情结果、可视化推演。
- [x] 验证旧结果页 alias 不再作为活跃页面：`spare-planning-monte-carlo-results` -> `spare-planning-monte-carlo-experiment-list`，`mission-reliability-monte-carlo-results` -> `mission-reliability-monte-carlo-experiment-list`，`mission-reliability-aircraft-task-reliability` -> `mission-reliability-task-reliability`。
- [x] 证据写入 `output/playwright/system-smoke-result.json` 和 `output/playwright/01-project-list.txt` 到 `output/playwright/11-legacy-aircraft-task-reliability.txt`。

**退出标准：** 正式结果可从蒙特卡洛实验页面访问，旧结果页不再活跃，正式可视化不会被误认为旧演示输出。

---

## 阶段 4：RMS 算法切片

**目的：** 在不阻塞阶段 0 建模仿真主流程的前提下，按已确认公式和字段名实现 RMS 变更。

**已确认口径：**
- 当前反算字段命名为 `校核可靠度`，只作为整机校核指标显示。
- 节点分配结果删除 `暴露时间` 和 `R目标`，不保留对应隐藏计算值。
- `运行比` 是 `0..1` 的任务使用比例，界面按紧凑数字显示，例如 `0.65`。
- 任务可靠度 `R` 和任务时长 `T` 到 MTBCF 的公式：`MTBCF = -T / ln(R)`。
- 关键故障占比 `p` 到 MTBF 的默认公式：`MTBF = p * MTBCF`，默认 `p = 1`。

**文件：**
- 修改：`front/rms-allocation-engine.mjs`
- 修改：`front/rms-allocation-workbench.mjs`
- 修改：`front/app.js`
- 验证既有样式：`front/styles.css`
- 测试：`tests/rms-allocation-engine.test.mjs`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/frontend-app-runtime.test.mjs`

- [x] 产品口径确认后，重命名反算字段。
- [x] 从节点分配结果中移除 `暴露时间` 和 `R目标`。
- [x] 增加 `运行比` 输入，并在左侧结构树节点显示。
- [x] 增加 `任务时长`。
- [x] 根据运行比计算产品强度。
- [x] 根据任务可靠度和任务时长计算 MTBCF。
- [x] 使用关键故障占比或故障类型映射，将 MTBCF 折算为 MTBF。
- [x] RMS 装备结构树导入支持同一文件内的多种机型；每个无父节点装备保留为可选机型根。
- [x] 选定机型后，左侧结构树和节点分配结果只展示/计算对应机型子树。
- [x] 相似产品分配法的基准机型下拉保留其他已导入机型，并优先按同名结构节点引用基准机型 MTBF。

**验证：**
- [x] 运行 `node --test tests/rms-allocation-engine.test.mjs tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs`。
- [x] 运行 `npm test`。

阶段 4 多机型 RMS 验证记录：
- [x] 运行 `node --test tests/rms-allocation-engine.test.mjs`。
- [x] 运行 `node --test tests/frontend-app-runtime.test.mjs --test-name-pattern "RMS"`。

**退出标准：** RMS 公式在代码和测试中明确表达，不保留占位算法；多机型导入后必须先选定目标机型再展示结构树，相似产品分配法可引用其他已导入机型作为基准。

---

## 阶段 5：系统运行支持配置阶段

**目的：** 在当前阶段建模页面稳定后，交付明确列为下一阶段的系统运行支持修改。

**文件：**
- 修改：`front/feature-catalog.mjs`
- 修改：`front/app.js`
- 修改：`front/styles.css`
- 修改：`src/spare_mvp_backend/api.py`
- 修改：`src/spare_mvp_backend/http_server.py`
- 修改：`src/spare_mvp_backend/repository.py`
- 修改：`src/spare_mvp_backend/schema.sql`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/frontend-app-runtime.test.mjs`
- 测试：`tests/test_backend_api_contract.py`
- 测试：`tests/test_backend_http_api.py`
- 测试：`tests/test_database_contract.py`

- [x] 项目数据管理：
  - 拆分为两个配置模块。
  - 移除顶部 `仿真建模数据表 sheet 选择器`。
- [x] 建模颗粒度管理：
  - 增加包含全部表单字段的 `颗粒度 A`。
  - 字段清单确认后增加 `颗粒度 B`。
- [x] 用户管理：
  - 保留新增、编辑、删除、查询和角色字段。
- [x] 系统功能权限管理：
  - 按模块/表格配置三类用户权限。
  - 仅暴露 `只读` 和 `编辑`，或文档化从现有角色/动作语义到该口径的兼容映射。
- [x] 建模表单管理：
  - 增加字段单位管理。
  - 支持时间单位 `小时` 和 `分钟`。
  - 增加保障人员专业字典。
  - 将该字典接入保障人员建模。

**验证：**
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract -v`。
- [x] 运行 `node --test tests/frontend-contract.test.mjs tests/frontend-app-runtime.test.mjs`。
- [x] 运行 `npm test`。

**退出标准：** 配置页面可持久化数据，下游建模页面能读取已配置的字典和单位值。

---

## 阶段 6：高级结果分析集成

**目的：** 在蒙特卡洛结果承载方式稳定后，完成各分析项的专项集成。

### 阶段 6P：仿真分析验收数据包

**命名说明：** `阶段 6P` 是 Phase 6 的前置数据基线（P = Prep），不是 `阶段 6B`。四个分析功能开发统一使用 `阶段 6A` 到 `阶段 6D` 命名，避免“前置 6B”和“分析 6B”重复。

**决策：** 仿真分析测试数据应从阶段 6 开始，作为四个分析功能实现前的独立验收数据包切片推进，不并入阶段 4 RMS 算法，也不等阶段 6 全部完成后再补。

**原因：**
- 阶段 0-3 已稳定正式 `/api/runs`、artifact、state-series、Monte Carlo 和结果承载路径，测试数据现在可以验证真实 `aircraft_support_v1` 链路，而不是静态预览。
- 阶段 5 已完成建模颗粒度管理，最小粒度与最大粒度样例可以绑定系统配置语义。
- 阶段 6 的剩余分析项需要正式 projection 和 state-series 作为输入，先冻结验收数据可以避免页面继续依赖过薄 fixture。

**数据包分层：**
- `minimal_single_aircraft`：Level 0 最小可运行包。只声明核心表域 `missionProfiles`、`equipmentAssets` 和 `reliabilityBlockDiagram`，并将 `supportResources`、`supportActivities`、`supportOrganization`、`transportPolicies` 标记为 `usedTables=false`；这些未建模域只产生 `scope_not_modeled` warning，并通过 `disabledDomains` / provenance 传入编译链路，不允许用空数组或空对象伪装成已建模表。该层用于验证最小闭环、缺 artifact、缺 provenance、缺支援网络和 fail-closed 边界。
- `canonical_platform_case`：Level 1 平台标准包。以恢复的 `tests/fixtures/case_new.json` 作为 6P 测试案例基础数据，所有 modeling-import 表域 `usedTables=true`，且每个声明域必须存在并包含有效内容；`supportOrganization` 虽然在 `aircraft_support_v1` 中是 governance-only，不驱动仿真行为，但在 Level 1 导入包中仍必须作为非空建模内容保留。该层保持 M9.6/M9.7/M9.8 验收链路一致。

**Level 0 / Level 1 契约口径：**
- `validationLevel=level0` 是有意缩小建模范围的导入包，允许非核心表域 `usedTables=false`，但必须把关闭的域写入 warnings/provenance，编译门按 disabled domain 放宽缺失域。
- `validationLevel=level1` 是完整声明建模包，不允许任何非核心域 `usedTables=false`；声明为 true 的集合域必须非空，声明为 true 的对象域必须有最小有效结构。
- 两层数据包不是两种任意严格度：当前 6P 只有一个 Level 0 最小层和一个 Level 1 平台标准层。后续新增“中间颗粒度”前必须先明确它是 Level 0 缩域包，还是 Level 1 完整声明包。

**推荐落点：**
- [x] 新增 `src/spare_mvp_backend/simulation_analysis_cases.py` 生成 `minimal_single_aircraft` 和 `canonical_platform_case` 两类数据包。
- [x] 新增 `tests/fixtures/simulation_analysis_cases/`，只放可复现、可校验的建模导入包或由 canonical case 派生的 fixture。
- [x] 新增 `scripts/export-simulation-analysis-cases.py --write|--check`，用于写入和检查 6P fixture drift。
- [x] Python 测试覆盖 `SimulationAdapter`、正式 Monte Carlo 产物、`monte_carlo_base`、四类 `analysis_projection_*` 和 `visualization_state_series`。
- [x] 前端测试继续覆盖 projection adapter、state-series replay、蒙特卡洛实验详情和剩余分析页的正式来源阻断。

**退出标准：** 两类数据都能从建模导入或 canonical case 进入正式 run 链路；Level 0 包的 disabled domain 必须在 validation warnings、Project provenance、Scenario provenance 和 run artifact 链路中可追踪，Level 1 包不得通过关闭表域绕过完整建模要求；每个分析页要么消费对应正式 artifact，要么明确显示缺少正式来源，不允许回退到本地预览数据并声明为正式结果。

**6P 文件：**
- 新增：`src/spare_mvp_backend/simulation_analysis_cases.py`
- 新增：`scripts/export-simulation-analysis-cases.py`
- 新增：`tests/fixtures/case_new.json`
- 新增：`tests/fixtures/simulation_analysis_cases/minimal_single_aircraft.json`
- 新增：`tests/fixtures/simulation_analysis_cases/canonical_platform_case.json`
- 新增：`tests/test_simulation_analysis_cases.py`

阶段 6P 验证记录：
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_analysis_cases -v`。

阶段 6P 已完成两类仿真分析验收数据包、fixture drift 检查和正式 `aircraft_support_v1` Monte Carlo artifact 验证。浏览器冒烟仍作为最终验证矩阵的一部分执行，不阻塞 6P 数据基线合并。

阶段 6P 后续待办：
- [ ] 将 `系统运行支持模块 / 项目管理 / 建模颗粒度管理` 的选中字段对齐到两类 6P 导入案例标准：`minimal_single_aircraft` 作为 Level 0 最小可运行颗粒度，`canonical_platform_case` 作为 Level 1 平台标准案例。实现时应新增从 `modeling_import` 字段路径到前端建模字段 key 的显式映射，并用覆盖率测试防止行为字段被静默遗漏；不要仅调整 UI 默认勾选状态，也不要让 Level 1 颗粒度通过 `usedTables=false` 规避字段覆盖。

**文件：**
- 修改：`front/app.js`
- 修改：`front/analysis-projection-adapters.mjs`
- 修改：`src/spare_mvp_contract/adapter.py`
- 修改：`contracts/result.schema.json`
- 修改：`contracts/artifact_manifest.schema.json`
- 测试：`tests/analysis-projection-adapters.test.mjs`
- 测试：`tests/frontend-contract.test.mjs`
- 测试：`tests/test_simulation_adapter.py`

### 阶段 6A-6D：四个分析功能开发

- [x] 阶段 6A：备件短板分析：
  - 增加备件满足率约束 `0.85`、`0.9`、`0.95`。
  - 增加备件利用率约束 `0.85`、`0.9`、`0.95`。
  - 定义并测试截断规则。
- [x] 阶段 6B：飞机转场携行清单：
  - 移除优化条件 UI。
  - 默认目标为携行备件越少越好。
  - 除非后续需求改变，否则该目标不可被误改。
- [x] 阶段 6C：任务可靠度图表：
  - 仅实现已确认的纵坐标从 0 开始。
  - 横轴使用等距序号绘制，并在表格中保留仿真时间。
  - 图上不显示风险阈值线，改为显示可靠度曲线下降最大的区间。
  - 任务可靠度页只允许正式 projection；缺少 `analysis_projection_mission_reliability` 时阻断，不回退到本地预览。
  - 不实现标记为 `具体需求待甲方确定` 的内容。
- [x] 阶段 6D：停机因素分析：
  - 检测异常停机事件。
  - 记录时间、事件、结果和保障活动状态快照。
  - 展示快照详情。
  - 定位到对应作业节点。
  - 导出和删除异常快照记录。

**验证：**
- [x] 运行 `node --test tests/analysis-projection-adapters.test.mjs tests/frontend-contract.test.mjs`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter -v`。
- [x] 运行 `npm test`。

阶段 6A 验证记录：
- [x] 运行 `node --test tests/analysis-projection-adapters.test.mjs`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_aircraft_support_v1_monte_carlo_writes_formal_projection_artifacts -v`。
- [x] 运行 `node --test tests/frontend-contract.test.mjs --test-name-pattern "phase 6A spare shortfall formal table"`。

阶段 6A 已完成备件短板分析 projection payload 的三档满足率/利用率约束、`0..1` 截断规则、行级约束达标状态，以及正式结果表格中的利用率和约束状态展示。飞机转场携行清单、任务可靠度图表和停机因素分析当时未纳入阶段 6A 完成口径。

阶段 6B 验证记录：
- [x] 运行 `node --test tests/analysis-projection-adapters.test.mjs tests/frontend-contract.test.mjs`。

阶段 6B 已移除飞机转场携行清单的优化条件切换 UI，将本地预览和正式 projection 目标固定为“携行备件越少越好”，并增加测试防止目标被误改。任务可靠度图表和停机因素分析当时未纳入阶段 6B 完成口径。

阶段 6C 验证记录：
- [x] 运行 `node --test tests/frontend-contract.test.mjs --test-name-pattern "phase 6C mission reliability chart"`。
- [x] 运行 `node --test tests/analysis-projection-adapters.test.mjs --test-name-pattern "normalizes mission reliability"`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_aircraft_support_v1_monte_carlo_writes_formal_projection_artifacts -v`。

阶段 6C 已将任务可靠度趋势图纵坐标下限从 `0.84` 调整为 `0`，横轴改为正式 projection 序列的等距序号，表格保留仿真时间，并显示可靠度曲线下降最大的相邻区间。任务可靠度页只消费正式 `analysis_projection_mission_reliability`，缺少正式 projection 时显示阻断说明，不回退到本地预览。该阶段不实现标记为 `具体需求待甲方确定` 的内容；停机因素分析当时未纳入阶段 6C 完成口径。

阶段 6D 验证记录：
- [x] 运行 `node --test tests/analysis-projection-adapters.test.mjs --test-name-pattern "downtime factor|malformed"`。
- [x] 运行 `node --test tests/frontend-contract.test.mjs --test-name-pattern "phase 6D|empty-shell|generic operation"`。
- [x] 运行 `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter.SimulationAdapterTest.test_run_aircraft_support_v1_single_run_writes_real_artifacts_and_behavior_scope -v`。

阶段 6D 已让 `analysis_projection_downtime_factors` 产出异常停机事件快照，记录仿真时间、事件、结果、保障活动状态和作业节点定位；停机因素页只消费正式 projection，缺少正式 projection 时阻断，不回退到本地预览。页面可导出当前异常快照，并可在本地视图中删除单条快照记录。

**退出标准：** 分析页面消费正式 artifact，或在缺少正式来源时明确阻断；任何结果页都不得把本地预览数据声明为正式输出。

---

## 推荐分支顺序

1. `codex/todo-2026-06-27-phase-0-baseline`
2. `codex/todo-2026-06-27-phase-1-modeling-pages`
3. `codex/todo-2026-06-27-phase-2-support-activities`
4. `codex/todo-2026-06-27-phase-3-experiment-results`
5. `codex/todo-2026-06-27-phase-4-rms-algorithm`
6. `codex/todo-2026-06-27-phase-5-system-support`
7. `codex/todo-2026-06-27-phase-6-analysis-integration`

每个分支都应独立可测试、可合并。阶段 4 或阶段 6 不应在公式和数据源决策冻结前开始实现。

## 归档备查

- 原始输入：`docs/archive/deprecated/2026-06-27-todo.md`
- 评审改写稿：`docs/archive/deprecated/2026-06-27-todo-review-and-rewrite.md`

## 最终验证矩阵

- [ ] `git diff --check`
- [ ] `npm test`
- [ ] `PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api tests.test_backend_api_contract tests.test_database_contract tests.test_simulation_adapter tests.test_aircraft_support_v1_model -v`
- [ ] 浏览器冒烟覆盖：项目数据管理、RMS 分配、装备系统建模、基本任务、复合任务、周期性任务、保障组织、保障人员、基本保障活动、使用保障活动、修复性维修活动、仿真实验方案、可视化推演、蒙特卡洛实验、停机因素分析。
