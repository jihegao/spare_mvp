# M9.6 平台案例数据包与 Golden Fixtures 完成记录

> **面向 agentic workers:** 后续修改本切片时，必须保持 `tests/fixtures/modeling_import_project.json` 为唯一完整业务案例源，并运行本文末尾的验证命令。

**目标:** 冻结 M9.6 平台飞机保障案例数据包、字段覆盖表、导出链路和 artifact kind golden fixtures，为 M9.7 正式飞机保障仿真模型族提供验收输入。

**架构:** 复用 `tests/fixtures/modeling_import_project.json`，通过后端 helper 生成 deterministic published modeling import、Project、ModelingSnapshot、ExperimentPlan、RunIntent、MonteCarloRunConfig 和 compiled `aviation_support` Scenario。字段覆盖表逐业务 leaf 标注 `consumed`、`derived`、`defaulted`、`ignored` 或 `unsupported`，其中 `consumed` 只表示当前 `aviation_support` adapter 真实消费的字段。Golden fixtures 由脚本生成，`--check` 用于检测 drift。

**技术栈:** Python 标准库、`modeling_import_to_project()`、`validate_modeling_import_package()`、`normalize_monte_carlo_run_config()`、`SimulationAdapter`、`unittest`、Node 文档契约测试。

---

## 完成范围

- [x] **契约测试**
  - 新增 `tests/test_m9_6_case_package.py`。
  - 覆盖平台导出链路、字段覆盖、artifact kind 列表和 golden fixture drift。
  - 测试确认导出前会经过 canonical modeling import validation。

- [x] **导出 helper**
  - 新增 `src/spare_mvp_backend/m9_6_case_package.py`。
  - 导出固定链路：published modeling import -> Project -> ModelingSnapshot -> ExperimentPlan -> RunIntent -> MonteCarloRunConfig -> compiled `aviation_support` Scenario。
  - 固定时间戳为 `2026-06-23T00:00:00Z`，避免 golden fixture 非确定性漂移。

- [x] **Golden fixtures**
  - 新增 `tests/fixtures/m9_6_platform_case_export.json`。
  - 新增 `tests/fixtures/m9_6_field_coverage.json`。
  - 新增 `tests/fixtures/m9_6_expected_artifact_kinds.json`。
  - 新增 `scripts/export-m9-6-case-package.py --check|--write`。

- [x] **文档同步**
  - 更新 `README.md`、`docs/README.md`、`docs/product-roadmap.md`、`contracts/README.md`、`agent.md` 和 `AGENT.md`。
  - 新增 `tests/frontend-contract.test.mjs` 的 M9.6 文档契约，防止把 M9.6 写成 M9.7 模型族完成或 `independent-mesa` 正式平台入口。

- [x] **评审处理**
  - coverage 的 `consumed` 语义已收窄到当前 adapter 实际消费字段。
  - golden fixture 生成前已接入 canonical import validation。
  - roadmap 已收窄为 artifact kind golden，不再声称本切片新增 `visualization_state_series` 或四类 projection payload-shape goldens；这些 payload 结构继续由既有 M9.1/M9.5 schema 与 adapter 测试约束。

## 非目标

1. 不实现 M9.7 正式飞机保障仿真模型族。
2. 不把 `independent-mesa`、`8765` 或静态 HTML 输出作为正式产品入口。
3. 不替换 M9.1/M9.5 已有 state-series、projection payload schema 和 adapter artifact 测试。
4. 不引入生产 worker queue、object storage、完整 cancel/retry 或 checkpoint restart。

## 验证命令

```bash
python3 scripts/export-m9-6-case-package.py --check
python3 -m unittest tests.test_m9_6_case_package -v
node --test tests/frontend-contract.test.mjs
npm test
.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter -v
```

涉及 `aviation_support` Mesa runtime 的测试必须使用 `.abm-mesa-test-env/bin/python`；系统 `python3` 可能缺少 `mesa`。
