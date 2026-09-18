# Repository Agent Guide

本文件是仓库统一的 Agent 协作入口，只维护长期规则。当前功能状态、运行入口和阶段验收要求见 `README.md`、`docs/README.md` 及相关专题文档；历史记录通过 Git 或 `docs/archive/deprecated/` 追溯，不作为当前实现依据。

## 协作与文档维护

- 修改前检查当前代码和 Git 状态，保护已有修改及未跟踪文件，不根据历史记忆推断实现边界。
- 面向项目的说明文档默认使用中文；代码标识、命令、路径和外部工具名称保留原文。
- 修改页面入口、功能流转、仿真参数或结果口径时，同步更新相关当前文档。移除或替换功能时，用旧名称和新名称搜索 `README.md`、`docs/` 和 `AGENTS.md`，修正过期描述；归档资料保留历史语境。
- 运行时代码不得依赖开发者机器上的外部原型绝对路径。
- 区分静态原型、自动化测试、后端仿真与浏览器验收证据，不把小样本结果描述为工程级校准结论。
- 使用 subagent 时明确目标、文件范围和验证要求，避免并行修改同一文件；主线程复核结果并负责最终集成、验证和提交。

## Project Contract Ownership

- Treat `contracts/`, `src/spare_mvp_backend/project_payload.py` (`ProjectJsonExporter`), and `src/spare_mvp_contract/adapter.py` (`SimulationAdapter`) as the sources of truth for Project JSON and Project-to-model compilation semantics.
- Do not add a second Project-to-`aircraft-support-v1` input compiler in scripts, skills, tests, frontend code, or backend handlers. Project operations must use the repository/exporter boundary, and model input must be produced by `SimulationAdapter`.
- Keep modeling changes synchronized across the Project and input schemas, `ProjectJsonExporter`, `SimulationAdapter`, canonical fixtures, contract tests, and relevant documentation.
- Treat SQLite databases as local runtime state. Reproducible baseline data belongs in reviewed fixtures or deterministic fixture generators, not in a checked-in database.

## Modeling Vocabulary

Explain Project modeling data in this order: task, equipment, support organization, support activity. The maintained field ownership and compatibility rules are in [`docs/modeling/project-json-four-domain-map.md`](docs/modeling/project-json-four-domain-map.md); the executable contracts remain authoritative when documentation and code disagree.

## Verification

For Project structure or compilation changes, run the focused exporter, Project contract, Simulation Adapter, and affected frontend contract tests. Validate canonical compiled `simulation_inputs` against `contracts/aircraft_support_v1_input.schema.json`, then run `git diff --check`.
