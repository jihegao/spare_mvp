# M3-0 真实后端闭环收束

日期：2026-06-19

## 结论

M3-0 已把当前 contract-first 后端闭环收束为可回归 smoke：同源 `/api` + `Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest`。该闭环通过本地标准库 HTTP facade、函数级 `BackendApi`、`SimulationAdapter` 和 SQLite repository，能保存 Project、生成建模快照和实验计划、编译已批准的 `smoke` Scenario、启动真实 `SmokeSpareMvpModel` run、持久化 Result summary 与 ArtifactManifest，并按 `run_id` 读取身份链。HTTP facade 只服务 `/api` 和 `front/` 静态文件。

本收束不改变 Mesa 行为、不修改 `aviation_support` Scenario 编译边界、不声明 calibration quality，也不把当前本地 HTTP facade 描述为生产 Web API、队列 worker 或长期对象存储。

## 覆盖链路

1. 读取 `tests/fixtures/smoke_project.json`。
2. `BackendApi.validate_project` 校验 Project JSON。
3. `BackendApi.save_project` 保存 Project contract。
4. `BackendApi.create_modeling_snapshot` 生成建模快照。
5. `BackendApi.create_experiment_plan` 创建实验计划。
6. `BackendApi.start_simulation_run` 委托 `SimulationAdapter` 编译 `smoke` Scenario 并运行 Mesa smoke model。
7. `BackendApi.get_run`、`get_run_result`、`get_run_artifacts`、`get_run_chain` 从 repository 读取运行记录、结果、产物和身份链。
8. `src/spare_mvp_backend/http_server.py` 用同源 `/api` 暴露上述能力，并可同时服务 `front/` 静态文件。
9. `front/api-client.mjs` 保持前端保存、运行、结果、产物和身份链读取的稳定 API client 边界；通用编辑仍保持本地，直到显式保存或运行。

## 分阶段评审

| 阶段 | 评审重点 | 结果 |
| --- | --- | --- |
| Phase 1: contract/backend smoke | 后端闭环是否真实经过 adapter、repository、run/result/artifact 身份链，重复 run 是否保留独立身份链 | 通过 `tests/test_backend_api_contract.py`、`tests/test_simulation_adapter.py`、`tests/test_database_contract.py`、`tests/e2e-contract-flow.test.mjs` 覆盖 |
| Phase 2: HTTP/frontend boundary | 同源 `/api` 是否响应前端 contract 路径，前端是否通过 API client 编排保存/运行/结果/产物/身份链读取，普通编辑是否不自动保存 | 通过 `tests/test_backend_http_api.py`、`tests/frontend-api-client.test.mjs` 和 `tests/frontend-contract.test.mjs` 覆盖 |
| Phase 3: claim/document boundary | README、docs 入口、roadmap 和 smoke evidence 是否同步 M3-0 当前边界 | 通过 `tests/e2e-contract-flow.test.mjs` 的 M3-0 closeout 文档契约覆盖 |

## 验证命令

| 命令 | 当前结果 |
| --- | --- |
| `node --test tests/e2e-contract-flow.test.mjs` | RED 后 GREEN：新增 M3-0 文档契约；2 个测试通过 |
| `npm test` | 91 个 Node contract/frontend/ontology 测试通过，0 失败 |
| `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_api_contract tests.test_backend_http_api tests.test_simulation_adapter tests.test_database_contract tests.test_evaluator_mesa_contract` | 20 个后端、HTTP API、adapter、database、evaluator 测试通过，0 失败 |
| `.abm-mesa-test-env/bin/python -m unittest discover tests` | 37 个 Python unittest 通过，0 失败 |
| `.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173` | 可同源服务 `http://127.0.0.1:4173/front/` 和 `/api` |

## 当前边界

- 已完成：本地同源 HTTP API、函数级真实后端 smoke 闭环、SQLite contract persistence、Result/ArtifactManifest 身份链、前端 API client 边界和可回归文档契约。
- 未完成：生产 HTTP API、长期 artifact storage、真实账号/权限/审计、worker 队列、运行取消/重试/超时、跨设备持久化部署。
- 受治理阻塞：`aviation_support` Project 到 Scenario 的字段派生规则未批准，因此该模型族仍保持显式 unsupported。
- 证据口径：本报告只证明 M3-0 contract-first smoke 闭环可运行，不证明工程校准质量或生产可用性。
