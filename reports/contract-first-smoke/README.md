# Contract-first smoke 证据

本报告记录 Task 7 的 contract-first 端到端 smoke 证据。该证据只覆盖 `smoke` 模型族的合约编排路径，不代表 calibration quality，也不扩大到 `aviation_support` 场景编译规则。

## 命令

| 命令 | 结果 |
| --- | --- |
| `node --test tests/e2e-contract-flow.test.mjs` | RED：首次运行失败，原因是本 evidence report 尚不存在；e2e 链路执行到 run/result/artifact manifest 后触发报告存在性断言。 |
| `python3 --version` | `Python 3.9.6` |
| `node --version` | `v25.3.0` |
| `node --test tests/e2e-contract-flow.test.mjs` | GREEN：1 个 e2e 测试通过，0 失败。 |
| `python3 -m unittest tests.test_backend_api_contract tests.test_simulation_adapter` | 7 个相邻后端/adapter 合约测试通过，0 失败。 |
| `npm test` | 91 个 Node contract/frontend/ontology 测试通过，0 失败。 |
| `.abm-mesa-env/bin/python --version` | `Python 3.12.13` |
| `.abm-mesa-env/bin/python -c "import mesa; print(mesa.__version__)"` | `3.5.1` |
| `.abm-mesa-env/bin/python -m unittest discover tests` | 30 个 Python unittest 通过，0 失败。 |

## 覆盖链路

本 smoke 测试通过 `BackendApi` 和 `SimulationAdapter` 执行以下链路：

1. 读取 `tests/fixtures/smoke_project.json`。
2. `validate_project` 校验 Project JSON。
3. `save_project` 保存项目合约。
4. `create_modeling_snapshot` 生成 modeling snapshot。
5. `create_experiment_plan` 创建实验计划，配置 `steps: 4`。
6. `start_simulation_run` 委托 adapter 编译 `smoke` Scenario 并启动 run。
7. `get_run_result` 读取 result summary。
8. `get_run_artifacts` 读取 artifact manifest。
9. `get_run_chain` 验证 project -> modeling snapshot -> experiment plan -> scenario -> run -> result summary -> artifact manifest 身份链。

## Run IDs

| 字段 | 值 |
| --- | --- |
| `project_id` | `project-smoke-contract-001` |
| `scenario_id` | `scenario-smoke-contract-demo-<plan-hash>-0001` |
| `run_id` | `run-scenario-smoke-contract-demo-<plan-hash>-0001`（同一 Scenario/plan 重复运行时递增） |
| `result_summary_id` | `result-run-scenario-smoke-contract-demo-<plan-hash>-0001` |
| `artifact_manifest_id` | `artifact-manifest-run-scenario-smoke-contract-demo-<plan-hash>-0001` |
| `model_family` | `smoke` |
| `model_id` | `SmokeSpareMvpModel` |

## 产物口径

artifact manifest 记录四类 JSON 产物：

| `kind` | 文件名 |
| --- | --- |
| `input_project` | `input-project.json` |
| `compiled_scenario` | `compiled-scenario.json` |
| `snapshot` | `snapshot.json` |
| `result_summary` | `result-summary.json` |

测试使用临时目录保存运行产物，并断言每个 artifact 有相对路径、无 `..` 路径段、非零大小和 64 字符十六进制 `sha256`。

## 已知限制

- 该 smoke 只验证 contract-first 编排和持久化链路，没有评价或承诺仿真 calibration quality。
- `aviation_support` Scenario 编译仍按既有边界保持阻塞，等待受治理的字段派生规则。
- 测试使用内存 SQLite 和临时 artifact 目录，不代表生产数据库、长期对象存储或并发队列行为。
- Python 全量 unittest 依赖本仓库 `.abm-mesa-env`；系统 `python3` 可执行本 Task 7 smoke 子流程，但缺少 Mesa 依赖，不能作为完整 Mesa 契约测试环境。
- `run_id` 当前由 smoke scenario identity、experiment plan hash 和 repository 内递增序号派生，适合本地合约回归 smoke；未来生产环境仍需要更完整的全局唯一 ID 和并发策略。
- 本任务没有修改 Mesa 行为、`src/spare_mvp_abm/contract_server.py`、既有 schema 或 API 语义。
