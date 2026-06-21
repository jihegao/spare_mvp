# M7.0 运行与产物管理审计报告

## Status

M7.0 Task 4 文档同步与边界审计完成。当前实现口径来自：

- `docs/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md`
- `docs/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md`

M7.0 当前只把本地同步 run 的运行账本和产物账本补成可管理、可下载、可归档、可软删除、可审计的最小闭环；后续 Task 5 仍需要完成最终浏览器 smoke 证据。

## Scope

本阶段管理 canonical `/api/runs` 运行链路：

1. `GET /api/runs` 运行列表。
2. `GET /api/runs/{run_id}/detail` 运行详情、identity chain、result summary 和 artifact manifest。
3. `GET /api/runs/{run_id}/artifacts/{artifact_id}` 通过 `artifact_id` 下载单个 artifact，并校验路径边界和 `sha256`。
4. `POST /api/runs/{run_id}/archive` 归档运行。
5. `DELETE /api/runs/{run_id}` 软删除运行并保留 tombstone。
6. 前端 Monte Carlo 详情展示 run/artifact 账本字段、生命周期状态和下载/归档/软删除操作。

## Non-Goals Preserved

M7.0 运行与产物管理只管理 canonical /api/runs 的运行账本、产物账本、下载、归档和软删除；不实现生产 worker queue/object storage/取消重试完整体系，不实现 M8 projection payload KPI 展示，不实现 M9 state stream，不解锁 aviation_support 正式执行，不恢复 legacy /api/simulation-runs。

边界自查：

1. 未引入生产 worker queue 或分布式调度。
2. 未引入 object storage 或长期保留策略。
3. 未实现完整取消/重试生命周期。
4. 未把 projection payload 解析为 M8 KPI 展示。
5. 未实现 M9 state stream 或可视化状态帧流。
6. 未解锁 `aviation_support` 正式执行。
7. 未恢复 legacy `/api/simulation-runs`。

## Verification

已知当前分支验证证据：

1. Backend focused command: `.abm-mesa-test-env/bin/python -m unittest tests.test_simulation_adapter tests.test_backend_api_contract tests.test_backend_http_api tests.test_database_contract` PASS, 116 tests.
2. Frontend command: `npm test` PASS, 193 tests after M7 cold refresh test.
3. Diff hygiene: `git diff --check` PASS.
4. Browser smoke: pending final Task 5 verification. 本报告不声明浏览器 smoke PASS。

Task 4 文档同步后需再次运行：

```bash
test -f reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
rg -n "M7\.0|运行与产物管理|legacy /api/simulation-runs|worker queue|object storage|M8 projection|M9 state stream|aviation_support" README.md docs/README.md docs/product-roadmap.md agent.md reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
git diff --check
```

## Evidence

Expected final browser evidence for Task 5:

1. Run list visible.
2. Run detail visible.
3. Artifact row includes `artifact_id`, `sha256`, and `size_bytes`.
4. One artifact download request observed.
5. Archive state visible.
6. Soft-delete tombstone visible.
7. Legacy `/api/simulation-runs` remains retired and returns the retired-route contract.

Documentation evidence added in Task 4:

1. `README.md` links the M7.0 plan/spec and records the current run/artifact management status.
2. `docs/README.md` links the M7.0 plan/spec and adds the current status bullet.
3. `docs/product-roadmap.md` records M7.0 current state after M6.2.y and updates stale future-only M7 wording.
4. `agent.md` requires new run management work to use canonical `/api/runs` and artifact ids, and forbids restoring `/api/simulation-runs`.
