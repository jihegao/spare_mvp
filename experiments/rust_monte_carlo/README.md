# AMD128 F35 RunService / core Monte Carlo 基准

`benchmark.py` 固定使用 `spare_mvp` 的真实 F35 Project：

```text
project-j16-8aircraft-43day-availability-20260727-copy-2
```

默认矩阵是 `samples=32,128`、`workers=1,8,32`、`warmup=1`、每个配对 `repeats=6`。每个 Python/Rust 样本都在新的子进程运行；配对重复交错执行（偶数次 Python→Rust，奇数次 Rust→Python），减少固定顺序和温度偏差。子进程将 affinity 固定为 `0..workers-1`，父进程用 `psutil` 汇总进程树峰值 RSS。

## 运行

在 AMD128 直接执行（`--compiler-root` 仅用于把 compiler commit/wheel hash 写入证据，可省略）：

```bash
python experiments/rust_monte_carlo/benchmark.py \
  --compiler-root /home/g/apps/sim_engine_compiler-o5bcd-20260921/o5d-runtime \
  --output /tmp/f35-rust-monte-carlo.json
```

最小 smoke：

```bash
python experiments/rust_monte_carlo/benchmark.py \
  --compiler-root /home/g/apps/sim_engine_compiler-o5bcd-20260921/o5d-runtime \
  --smoke --output /tmp/f35-rust-monte-carlo-smoke.json
```

矩阵可缩小，例如：

```bash
python experiments/rust_monte_carlo/benchmark.py \
  --compiler-root /path/to/sim_engine_compiler \
  --samples 32 --workers 1,8 --warmup 1 --repeats 2 \
  --output /tmp/f35-rust-monte-carlo-small.json
```

`--database` 和 `--project-id` 可覆盖默认固定来源；默认 live DB 只以 SQLite `mode=ro` 打开。每次子进程前，父进程通过 SQLite `Connection.backup()` 复制到临时 DB，再插入本次 backend/sample/worker 对应的临时 ExperimentPlan。所有 run、result 和 artifact 写入临时 DB/临时 output，退出后自动清理；live DB 不写入。

同一个 `samples/workers` cell 使用一个共享 `sim-engine-cache` 目录；每个 fresh child 的 output 下建立指向该目录的 symlink。这样 warmup 后可以观察 Rust plan cache 的 cold/hit 状态，同时仍保持每次运行独立 DB。第一条 warmup 行就是 cold-cache 证据。

## 计划和后端边界

每个临时 plan 同时写入兼容字段：

```json
{
  "monteCarloBackend": "python | rust_event_time_v2",
  "monteCarloOutputScope": "core",
  "monte_carlo_backend": "python | rust_event_time_v2",
  "monte_carlo_output_scope": "core"
}
```

两边都通过同一个 `RunService.submit_run()`、`SimulationAdapter` 和 `run_type=monte_carlo` 子进程执行；唯一变量是临时 ExperimentPlan 的 `monteCarloBackend`（`python` 或 `rust_event_time_v2`）。请求不携带数值覆盖，样本数和并行度只写入 ExperimentPlan 的 `analysisRequests.largeSample` 与 `parallelCores`。`--compiler-root` 不参与执行 dispatch，只用于记录 compiler commit/wheel hash。若后端 selector 未部署，Rust 行会按后端返回的显式 unsupported/failed 状态记录，不绕过 RunService 偷换成另一套 runtime。

本基准只记录 core Monte Carlo 结果，不调用 analysis API，也不生成 analysis-module 结果。Rust runtime 使用 `summary` observation level；比较或解释时应只使用 plan fingerprint、sample index/seed、metrics、stop reason、terminal state 和 sample requests。

## 输出证据

结果 JSON 原子增量写入：每完成一个 warmup/测量行和每个 pair 都执行临时文件 + `fsync` + `os.replace`。顶层记录：

- Project/canonical/Execution Plan fingerprints、两边 git commit、Python/platform、wheel SHA-256；
- matrix、warmup/repeat/交错顺序和 affinity；
- 每行 wall/init/run timings、throughput、output bytes、cache/status、artifact kinds、失败样本数；
- 父进程进程树峰值 RSS，以及运行前后的 load average 和 CPU frequency。

结果文件只能放在 `/tmp` 或其他未跟踪目录，不要提交到 Git。

脚本会优先使用 `dist/*.whl`、`target/wheels/*.whl`，也可通过重复 `--wheel` 显式记录 wheel hash。没有 wheel 时记录空映射，不伪造 hash。

固定 F35 输入和 Rust/Python differential fixture 仍以 `tests/fixtures/spare_mvp/f35-43day-5352a0d/`、`scripts/export_spare_mvp_fixture.py`、`scripts/compile_execution_plan.py`、`scripts/run_reference_plan.py`、`tests/conformance/test_f35_reference.py` 和 `tests/differential/test_rust_runtime.py` 为准。
