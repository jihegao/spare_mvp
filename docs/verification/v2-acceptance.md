# V2 acceptance implementation record

## Scope and frozen behavior

Issues #361, #362, #363; bounded performance work from #364/PR #365.

- Reliability details preserve every sample/day/wave. Summaries use integer success/planned totals. Never align missing waves by array position.
- Spare fill means immediate, complete multi-product allocation at the first actual spare request per job step. Partial stock counts zero, retries do not repeat demand, later deliveries do not improve the first outcome, zero demand yields one. Utilization remains a separate consumption metric.
- Each aircraft's first actual takeoff per simulation day uses preflight; later takeoffs use relaunch. Postflight occurs after the dynamically determined final daily return. At rollover close the prior daily cycle; airborne aircraft wait until return. Failed return repairs precede necessary postflight. Unfinished work remains unfinished at the horizon.
- Empty operations phases mean no work, zero time/resources. No fabricated fallback tasks. Preserve serial topological work-step ordering. Count completed sorties independently of postflight jobs.
- Project export and compilation remain owned by ProjectJsonExporter and SimulationAdapter. Runtime SQLite is not a baseline artifact.

## Delivery procedure

Each batch: design -> development/self-test -> independent test -> independent review -> fix/retest -> integration. Shared-file changes integrate sequentially. Existing worktrees and unrelated remote applications are preserved.

## Evidence to date

- Base: `1091c98`. Integration branch: `implementation/v2-acceptance`.
- Frontend development checks: 327 contract/runtime tests passed; isolated browser pagination cases 3 passed. These alone do not prove all real pages are wired.
- Independent review caught and integration fixed the shared reliability table pagination and RBD tab accessibility. Real Chromium confirmed 104 detail rows / 20 visible and reachable RBD tab.
- Reliability developer checks: 179 BackendApiContract, 78 adapter, 164 frontend runtime, 11 XLSX, 18 JS helper/projection tests passed on Python 3.10. Fixed-dependency independent checks run separately on Python 3.12.
- Performance review found same-tick downtime closure order changed by original PR365. Integration preserves active-event insertion order and adds a regression.
- Fixed-dependency performance comparison (original PR candidate vs base; ordering fix independently reproduced): three 4-sample/4-worker runs, median 4.944 -> 3.789 seconds, throughput .809 -> 1.056 samples/s, sampled process-tree peak RSS 382.76 -> 396.88 MiB, response approximately 2,900,170 bytes, zero sample failures. Three seeded full model outputs and canonical full-frame output matched. Rebenchmark final business semantics before acceptance.
- Independent fixed-dependency baseline/candidate model+adapter suites: 189 each passed. One unrelated Excel CR normalization expectation also fails on frozen base; this is not a green full-suite result and must be resolved for final supported runtime.

## Final Windows acceptance

Target: 4700-4, `C:\Users\user\Models`, isolated newly named acceptance directory. Tailscale SSH `user@100.74.196.88` verified against existing host trust. Do not modify the conflicting LAN known_hosts entry.

Use app-local Python, locked offline dependencies, fresh fixture database, independent ports, scoped process management. Record package and input SHA-256, commit, versions, commands, logs, screenshots and XLSX. Test install/start/login/model save/import/visual simulation/Monte Carlo/analysis/export. Verify no public network dependency while preserving management access. Preserve final evidence and stop only test-owned processes. This is isolated-environment acceptance on an existing Windows host, not proof of a fresh Windows OS installation.

## Pending acceptance gates

- Complete and independently validate operations phases and immediate fill semantics.
- Complete Excel standard template and full round trip.
- Complete real-page UI coverage and autosave failure/recovery acceptance.
- Final integration tests and performance measurements.
- Deploy final candidate to 4700-4 and complete browser/runtime/offline acceptance.
