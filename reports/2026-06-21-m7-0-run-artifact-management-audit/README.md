# M7.0 运行与产物管理审计报告

## Status

M7.0 Task 5 最终验证完成。当前实现口径来自：

- `docs/superpowers/specs/2026-06-21-m7-0-run-artifact-management-design.md`
- `docs/superpowers/plans/2026-06-21-m7-0-run-artifact-management.md`

M7.0 当前只把本地同步 run 的运行账本和产物账本补成可管理、可下载、可归档、可软删除、可审计的最小闭环；最终浏览器 smoke 已通过并记录 run/artifact 管理证据。

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
2. Frontend command: `npm test` PASS, 196 tests.
3. Frontend contract command: `npm test -- tests/frontend-contract.test.mjs` PASS, 83 tests.
4. Browser smoke command: `SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs` PASS.
5. Diff hygiene: `git diff --check` PASS in previous stages; final controller will rerun after this commit.

本报告更新时运行：

```bash
test -f reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
rg -n "Browser smoke|PASS|196|runListVisibleIncludesRunId|downloadObserved|archiveStateVisible|tombstoneVisible|physicalDeletionImplied|M7\.0|运行与产物管理" reports/2026-06-21-m7-0-run-artifact-management-audit/README.md
git diff --check
```

## Evidence

Final browser evidence for Task 5 from `output/playwright/m3-1-browser-backend-smoke/browser-backend-smoke-result.json`:

1. Smoke result `ok: true`.
2. `m7RunArtifactEvidence.runListVisibleIncludesRunId: true`.
3. `m7RunArtifactEvidence.detailVisible: true`.
4. `m7RunArtifactEvidence.artifactColumnsVisible: true`.
5. `m7RunArtifactEvidence.artifactSha25664: true`.
6. `m7RunArtifactEvidence.downloadObserved: true`.
7. `m7RunArtifactEvidence.filenameIncludesArtifactId: true`.
8. `m7RunArtifactEvidence.archiveStateVisible: true`.
9. `m7RunArtifactEvidence.tombstoneVisible: true`.
10. `m7RunArtifactEvidence.softDeleteBoundaryVisible: true`.
11. `m7RunArtifactEvidence.physicalDeletionImplied: false`.
12. `offlineBlocked.hasNoFakeRun: true`.

Documentation evidence added in Task 4:

1. `README.md` links the M7.0 plan/spec and records the current run/artifact management status.
2. `docs/README.md` links the M7.0 plan/spec and adds the current status bullet.
3. `docs/product-roadmap.md` records M7.0 current state after M6.2.y and updates stale future-only M7 wording.
4. `agent.md` requires new run management work to use canonical `/api/runs` and artifact ids, and forbids restoring `/api/simulation-runs`.
