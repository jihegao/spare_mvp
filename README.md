# 备件规划与任务可靠度验证评估平台原型

本仓库当前是基于 `docs/3概要设计方案.docx` 重构出的 Ontology + Mesa ABM + 静态前端原型。当前开发分支已经包含登录、项目列表着陆页、四级功能导航、Mesa 可视化嵌入、蒙特卡洛扫参与结果分析页、以及 ship_front / 备件_front 对齐页面。

## 项目文档入口

统一文档入口见 [`docs/README.md`](docs/README.md)。常用文档：

- [`docs/3概要设计方案.md`](docs/3概要设计方案.md)：原始概要设计的 Markdown 转换稿。
- [`docs/spare_mvp_rms_allocation_design.md`](docs/spare_mvp_rms_allocation_design.md)：装备 RMS 指标分配页面的输入设计文档。
- [`docs/product-roadmap.md`](docs/product-roadmap.md)：从当前原型到真实系统的产品里程碑、阶段依赖和验收口径。
- [`docs/ontology-mesa-rebuild-plan.md`](docs/ontology-mesa-rebuild-plan.md)：Ontology + Mesa 重构边界和当前状态。
- [`docs/superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md`](docs/superpowers/specs/2026-06-19-m3-1-rms-m5-data-entry-design.md)：M3-1/RMS 收束与 M5 数据入口首片设计。
- [`docs/superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md`](docs/superpowers/plans/2026-06-19-m3-1-rms-m5-data-entry.md)：M3-1/RMS 验收收束与 M5 首片实施计划。
- [`docs/superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md`](docs/superpowers/specs/2026-06-19-m5-1-modeling-import-service-design.md)：M5.1 建模导入服务化设计。
- [`docs/superpowers/plans/2026-06-19-m5-1-modeling-import-service.md`](docs/superpowers/plans/2026-06-19-m5-1-modeling-import-service.md)：M5.1 后端 API、SQLite 持久化和前端 client 实施计划。
- [`docs/superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md`](docs/superpowers/specs/2026-06-19-m5-2-modeling-import-workbench-design.md)：M5.2 建模导入工作台和 Scenario 预览设计。
- [`docs/superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md`](docs/superpowers/plans/2026-06-19-m5-2-modeling-import-workbench.md)：M5.2 系统管理入口、映射/错误/版本预览和 `compile-scenario` 实施计划。
- [`docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`](docs/superpowers/specs/2026-06-17-four-level-function-page-design.md)：四级功能页面化设计规格。
- [`docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md`](docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md)：本轮前端集成实现记录。
- [`agent.md`](agent.md)：后续 agent 协作规则和 subagent 使用约定。

## 已覆盖范围

- 前端建模：任务剖面参数、复合任务、周期性任务、基本任务、任务阶段、装备、组件、保障节点、保障活动字段。
- 可靠性框图：树状展示串联、并联、备用关系及组件故障参数。
- 保障活动建模：以树编辑、工作项目清单和节点网络图展示基本保障、使用保障、预防性维修、修复性维修活动。
- 可视化仿真：单次仿真的任务态势、机场保障视图、指标、事件流和 Mesa 内部 `Ontology视图`。
- Ontology 约定：`Ontology视图` 后续按 `建模对象 -> 仿真实验 -> 模型实例 -> 计算产物` 四层纵向画布组织；建模对象层对齐前端四级功能，模型实例层按 `AviationSupportModel` 的真实 Mesa/Python 运行时对象关系绘制，并包含当前 step 的指标对象。
- 蒙特卡洛实验：只读展示当前仿真实验，配置样本数、随机种子、故障率、备件倍数、保障容量扫参；配置页只保留参数和启动按钮，评估结果统一在“结果分析 / 蒙特卡洛实验结果展示”中查看。
- RMS 指标分配：系统管理新增“装备RMS指标分配”本地计算页，使用模拟装备构型和任务剖面，支持调节装备级 R/M/S、MTBF、MTTR、MLDT、Ai/Ao 目标，选择等分配、比例分配、AGREE 和评分分配方法，并展示节点级 RMS target、任务暴露矩阵和自底向上校核；当前发布仅在浏览器内写入模拟装备节点的 `rms.target`，不覆盖 `prediction` 或 `actual`，尚未后端持久化或真实仿真消费。
- 结果分析：备件短板分析、飞机转场携行清单、飞机任务可靠性分析、停机因素分析。
- M2a 契约适配：`src/spare_mvp_contract/adapter.py` 已支持 Project JSON 校验、已批准的 `smoke` Scenario 编译、`SmokeSpareMvpModel` 运行、Result summary 和 ArtifactManifest 生成；`aviation_support` Scenario 编译仍需先完成治理批准的字段派生规则。
- PR-D 数据持久化：`src/spare_mvp_backend/schema.sql` 和 repository helper 已提供 SQLite 版 Project / Scenario / Run / Result / ArtifactManifest 持久化与 `run_id` 身份链查询。
- PR-E 后端 API：`src/spare_mvp_backend/api.py` 提供函数级 Backend API facade，按 Project -> Snapshot -> ExperimentPlan -> Adapter 编译 Scenario -> Mesa 运行 -> Result/Artifact 持久化编排；API 层不自行拼接 Scenario JSON，不改写 Mesa 指标。
- PR-F 前端接入：`front/api-client.mjs` 提供前端 API client，`front/app.js` 的项目保存、实验计划创建、仿真启动、结果摘要和产物读取通过 API client 编排；静态演示结果也封装在 client 内，避免 app 直接生成最终 Scenario 或直接运行本地仿真函数。
- M3-0 真实后端闭环：`src/spare_mvp_backend/http_server.py`、`tests/test_backend_http_api.py`、`tests/e2e-contract-flow.test.mjs` 和 [`reports/m3-0-real-backend-loop/README.md`](reports/m3-0-real-backend-loop/README.md) 已收束同源 `/api` + Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest smoke；该闭环仍是本地标准库 HTTP server、SQLite 和临时 artifact 目录，不代表生产 Web API、worker 或 calibration quality。
- M3-1 浏览器后端闭环：[`reports/m3-1-browser-backend-smoke/README.md`](reports/m3-1-browser-backend-smoke/README.md) 已验证浏览器从同源 `/front/` 通过 `/api` 保存项目、启动 smoke run、读取结果和 artifact manifest，并在刷新后从持久 SQLite 恢复同一个 `run_id`；`/api` 不可用时前端显示阻断状态，不创建 `offline-demo-run`。
- M5 数据入口：`contracts/modeling_import.schema.json`、`front/modeling-import-contract.mjs` 和 `tests/modeling-import-contract.test.mjs` 定义建模数据导入/校验 contract；M5.1 已通过本地 `/api/modeling-imports/*`、`BackendApi` 和 SQLite repository 服务化 validation/save/publish/get，覆盖对象 ID、引用关系、非法数值、错误定位和已发布且被运行引用后的覆盖保护。`modeling_imports` 持久化 `draft_payload_json` 与 `published_payload_json`，`GET /api/modeling-imports/{import_id}` 返回 `draftPackage`、`publishedPackage`、`validation` 和 `lifecycle`，发布后再保存草稿不会覆盖已发布快照。同一 `import_id` 被 run 引用后不可再发布覆盖，新版本需使用新 `import_id`。M5.2 新增系统管理下的「建模数据导入」工作台、映射/错误/版本预览，以及经 `SimulationAdapter.compile_scenario()` 生成的后端 Scenario 预览（`compile-scenario`）；该阶段仍不包含完整 Excel 解析、worker 基础设施、权限/审计或 `aviation_support` 编译解锁。

## 本地运行

```bash
npm test
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/front/index.html
```

需要验证 M3-1 浏览器后端闭环时，使用 Mesa-capable Python 环境启动同源前端和 `/api`：

```bash
.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173
```

打开：

```text
http://127.0.0.1:4173/front/
```

## 本体校验

```bash
python3 /Users/gaojihe/.codex/skills/ontology-mesa-modeling/scripts/normalize_ontology.py \
  --input ontology/spare_mvp.ontology.json \
  --output ontology/spare_mvp.normalized.json \
  --report ontology/spare_mvp.validation.json
```

当前本体包含 8 个实体、13 条关系、39 个属性，校验报告见 `ontology/spare_mvp.validation.json`。

## Mesa 烟测

需要 Python 3.10+。本机验证使用 Python 3.12 和 `mesa-abm-skill` runner：

`SmokeSpareMvpModel` 的场景输入来自前端数据模型快照
`scenarios/frontend-project-smoke/project.json`。两个 smoke experiment 只传
`projectJsonPath` 和前端 Monte Carlo 风格的 sweep 参数，不再使用
`equipment_count`、`initial_spare_stock` 等旧标量输入。

```bash
/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/smoke_model.py \
  --config scenarios/spare-planning-smoke/experiment.json \
  --output-dir runs/spare-planning-smoke/latest \
  --install-dir .abm-mesa-env

/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/smoke_model.py \
  --config scenarios/mission-reliability-smoke/experiment.json \
  --output-dir runs/mission-reliability-smoke/latest \
  --install-dir .abm-mesa-env
```

`runs/` 下的原始 CSV/JSON 输出默认不提交；场景配置和模型代码是可复现实验入口。

## 边界

该原型是可交互、可运行的第一版，不是校准后的工程级仿真平台。小样本结果只能解释“在当前规则和参数下的模型行为”，不能直接声称真实最优方案。
