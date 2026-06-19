# M3-1 同源后端浏览器闭环验收

日期：2026-06-19

## 结论

M3-1 把 M3-0 的函数/API smoke 推进到真实浏览器路径：前端从同源 `/front/` 加载，并通过同源 `/api` 执行 `Project -> Snapshot -> ExperimentPlan -> Scenario -> Run -> Result -> ArtifactManifest`。验收使用持久 SQLite 文件启动 HTTP facade，浏览器点击保存方案、启动 run、进入结果页读取 run identity chain 与 artifact manifest；刷新后，前端从后端恢复同一个 `run_id`，Project/Run/Result/Artifact 仍可查。

`/api` 不可用时，前端不再生成 `offline-demo-run`。页面会显式显示后端不可用和未创建 run_id，避免把离线演示误判为闭环。

## 启动命令

```bash
.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173 --database output/playwright/m3-1-browser-backend-smoke/m3-1.sqlite3 --output-dir output/playwright/m3-1-browser-backend-smoke/runs
```

该命令等价于用户指定的 `.abm-mesa-test-env/bin/python -m src.spare_mvp_backend.http_server --port 4173`，只额外指定持久 SQLite 和浏览器验收产物目录。

## 浏览器验收命令

```bash
SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs
```

脚本输出：

- `output/playwright/m3-1-browser-backend-smoke/browser-backend-smoke-result.json`
- `output/playwright/m3-1-browser-backend-smoke/01-real-backend-result.png`
- `output/playwright/m3-1-browser-backend-smoke/02-refresh-restored-result.png`
- `output/playwright/m3-1-browser-backend-smoke/03-api-unavailable-blocked.png`

本地验收样例：

- `run_id`: `run-scenario-carrier-turnaround-demo-b503e0a688ac-0001`
- `snapshot_id`: `modeling-snapshot-project-carrier-day-night-0006`
- `experiment_plan_id`: `experiment-plan-project-carrier-day-night-da4de4ae23ba`
- `artifact_manifest_id`: `artifact-manifest-run-scenario-carrier-turnaround-demo-b503e0a688ac-0001`
- 刷新后状态：`后端状态：已从后端恢复`
- `/api` 503 阻断状态：`后端状态：后端不可用，未创建 run_id：blocked by M3-1 smoke`

## 覆盖链路

1. 浏览器登录并进入项目工作台。
2. 点击方案编辑页的保存方案，经 `/api/projects` 保存 Project 并创建 Snapshot。
3. 点击蒙特卡洛实验启动，经 `/api/projects/:id/experiment-plans` 创建 ExperimentPlan，经 `/api/simulation-runs` 启动 smoke run。
4. 结果页显示 Project、Snapshot、ExperimentPlan、Scenario、Run、Result、ArtifactManifest 身份链。
5. 结果页显示 artifact manifest 中的 input project、compiled scenario、snapshot、result summary。
6. 刷新后，前端从持久 SQLite 后端读取同一个 run_id、Result 和 ArtifactManifest。
7. 浏览器拦截 `/api` 为 503 时，页面显示未创建 run_id，不生成离线演示 run。

## 验证命令

| 命令 | 当前结果 |
| --- | --- |
| `.abm-mesa-test-env/bin/python -m unittest tests.test_backend_http_api` | 4 个 HTTP API 测试通过，包含持久 SQLite 重启后 Project/Run/Result/Artifact 查询 |
| `node --test tests/frontend-api-client.test.mjs` | 3 个前端 API client/save-boundary 测试通过，包含刷新恢复入口和无 fake offline run 检查 |
| `node --test tests/e2e-contract-flow.test.mjs` | 覆盖 M3-1 README 文档契约 |
| `SMOKE_BASE_URL=http://127.0.0.1:4173/front/ node reports/m3-1-browser-backend-smoke/browser-backend-smoke.mjs` | 真实浏览器验收脚本，输出 JSON 与截图证据 |

## 非目标和边界

- 不做生产账号/权限。
- 不做 worker 队列。
- 不解锁 aviation_support Scenario 编译。
- 不扩展 Mesa 行为。
- 不声明生产 HTTP API、长期 artifact storage、运行取消/重试/超时或跨设备部署已经完成。
