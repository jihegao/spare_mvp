# Issue #261：`case-large` Monte Carlo 超时定位与修复证据

## 结论

`case-large` 不是单样本死循环，也不是响应体过大。修复前单样本约 9.7 秒，默认 4 样本串行约 43.4 秒；保存方案若使用 24 样本、1 核，按实测线性估算约 4.3 分钟，会超过前端固定 180 秒请求上限。后端同时缺少单样本和整批硬截止时间，因此异常样本也不能及时失败关闭。

修复后，前端等待预算和后端整批预算统一按并行执行波次计算；样本在独立进程中运行，默认单样本上限 60 秒，整批上限为 180 到 900 秒。响应会记录请求、完成和失败样本数、逐样本状态与耗时，以及编译、样本执行、聚合、投影和总耗时。

## 复现配置与修复前基线

输入文件为 `exports/project-case-large.json`，Project ID 为 `project-case-large`，分析类型为 `mission_reliability`，Base seed 为 `20260621`。

| 样本 | 并行核心 | 状态 | 总耗时 | 响应体 |
| ---: | ---: | --- | ---: | ---: |
| 1 | 1 | 完成，0 失败 | 9.717 秒 | 31,784 bytes |
| 4 | 1 | 完成，0 失败 | 43.387 秒 | 32,181 bytes |
| 24 | 4 | 完成，0 失败 | 70.949 秒 | 36,408 bytes |

24 样本、1 核的 4.3 分钟是根据上述真实单核耗时做出的估算，不作为实测值。响应体只有约 31 到 36 KB，可排除大响应传输为主要原因。

## 修复后基线

使用 `scripts/benchmark_lite_mesa_analysis.py` 从真实 Project JSON 经过 `BackendApi.run_lite_mesa_analysis()` 运行：

| 样本 | 并行核心 | 后端整批预算 | 状态 | 总耗时 | 响应体 |
| ---: | ---: | ---: | --- | ---: | ---: |
| 4 | 1 | 300 秒 | 4/4 完成，0 失败 | 54.913 秒 | 33,750 bytes |
| 24 | 4 | 420 秒 | 24/24 完成，0 失败 | 89.208 秒 | 39,064 bytes |

对应前端请求上限分别为 330 秒和 450 秒；24 样本、1 核受整批上限约束时为 930 秒（900 秒后端上限加 30 秒响应余量）。正常长任务在预算内不会再被固定 180 秒误报为网络失败。

## 超时失败关闭验证

以下命令把真实 `case-large` 单样本上限压缩到 1 秒：

```bash
python scripts/benchmark_lite_mesa_analysis.py \
  --project exports/project-case-large.json \
  --samples 1 \
  --parallel-cores 1 \
  --sample-timeout-seconds 1 \
  --session-timeout-seconds 10
```

结果在 1.177 秒返回 `blocked`，失败样本为 1，错误码为 `sample_timeout`，后端记录的样本执行耗时为 1.081 秒。该结果证明异常样本会被硬截止并返回可诊断状态。

另以默认 60 秒单样本上限、1 秒整批上限运行同一输入，结果在 1.110 秒返回 `blocked`，失败错误码为 `session_timeout`。这验证了整批截止时间会终止仍在运行或等待的样本进程。

## 自动化验证

- `python -m unittest tests.test_backend_api_contract`：139 项通过。
- `python -m unittest discover -s tests`：359 项通过。
- `node --test tests/frontend-contract.test.mjs tests/frontend-api-client.test.mjs tests/frontend-app-runtime.test.mjs`：292 项通过。
- `npm test`：491 项通过。
- 前端运行时测试覆盖运行中上下文、部分样本失败、后端全样本超时阻断、动态请求预算和网络错误/请求超时分类。

当前环境没有安装 Chromium、Chrome 或 Playwright，因此未执行真实浏览器点击回归；DOM 运行时契约已通过，真实浏览器验收仍需在具备浏览器的环境补跑。Issue 在代码进入远端并完成该验收前不应关闭。
