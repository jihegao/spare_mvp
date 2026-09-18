# V2 acceptance implementation record

**Accepted on 2026-09-18:** implementation, independent reviews, native Windows offline browser acceptance, owned-process shutdown and post-run immutable-package verification are complete.

## Candidate and scope

- Base: `1091c98`; integration branch: `implementation/v2-acceptance`.
- Final packaging candidate: `e0f7824ecc6d9d2d00543aafd978e70b35bedfc4`.
- Scope: issues #361, #362, #363 and bounded performance work from #364 / PR #365; Project Excel exchange and isolated Windows delivery.
- Procedure: design → development/self-test → independent test/review → fix/retest → sequential integration. Existing worktrees, runtime databases and unrelated remote applications are preserved.

## Frozen behavior

- Reliability retains every sample/day/wave. Summaries divide integer success totals by integer planned totals; missing waves are never aligned by array position. Display and export preserve their denominators.
- Immediate spare fill records the first actual allocation request for each job step. A multi-product request is atomic: partial availability yields zero immediate fulfillment. Retries do not repeat demand; later deliveries do not revise the first outcome. Cancellation preserves request history; a rebuilt job makes a new request. Zero demand yields one. Utilization is a separate consumption metric.
- Each aircraft's first actual takeoff per simulation day uses preflight; subsequent takeoffs use relaunch. A canceled attempt does not increment takeoffs. Postflight follows the dynamically determined final daily return, without preallocating the day's aircraft assignments. Day rollover closes the prior cycle; airborne aircraft wait for return, and repair precedes required postflight. Cross-day preparation is invalidated and rebuilt. Unfinished work remains unfinished at cutoff; completed sorties count normal returns.
- Empty phases pass with zero work, time and resources; no fallback 30-minute task. Phase DAGs run in stable topological serial order. Each task item selects a plan using its effective aircraft type; every phase must cover every selectable type. Implicit selection considers only wholly compatible groups; explicit invalid selections remain errors.
- ProjectJsonExporter and SimulationAdapter own export and Project-to-model compilation. Excel encodes Project data through these boundaries; it does not add another compiler. Excel import rejects lossy cells and preserves open-object keys and text newlines. Runtime SQLite is not a baseline artifact.

## Independent findings resolved

- Restored pagination on the shared reliability detail table and RBD navigation/accessibility; aligned detail rows, business day/wave labels and exports.
- Preserved same-tick downtime event insertion order after the performance optimization; regression reproduced independently.
- Fixed operations binding for composite aircraft overrides and implicit groups containing incompatible phases; updated evaluator mapping and canonical template bindings.
- Verified operations jobs share the first-request spare accounting: waiting retries, cancellation/return of reservations, rebuilt jobs and midnight transitions do not duplicate a job-step request.
- Bound all copied application files, scripts, entrypoints and documentation to the source manifest. Process ownership now requires creation time, executable, service command and instance token; stale or unknown records do not authorize stopping unrelated processes.
- Runtime preparation reconstructs a new directory from the locked CPython archive and wheelhouse. Its immutable manifest binds archive, specification, dependency lock and installed files. Build verifies the actual RuntimeSource and rechecks the copied runtime before sealing; verification does not create a new baseline.
- Fixed the native first-start failure: include `schema.sql`, ship the initializer and initialize using the staged application's own code. An independent negative test removing staged `schema.sql` fails at the package path, without source-checkout fallback.
- Fixed Windows Excel CR/LF preservation without globally patching the XML writer.
- Bundled 555 hash-locked Solara frontend resources from five official npm archives, including production dynamic scripts, CSS and fonts. Startup binds the packaged cache; cache misses can only contact a refused loopback endpoint. Two unused development chunks exceeded the tested Windows path limit and were removed after independently verifying production webpack references. The final target layout stays below 260 characters; arbitrary deeper paths and development mode are not covered.

## Verification evidence

Counts describe separate suites and may overlap; do not sum them into a unique-test total. Earlier failing runs are superseded only within the scope of successful reruns below.

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| Integrated Python checks | 561 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-v2-acceptance-python.log` (543.975 s); not the earlier failing `spare-v2-final-python.log` |
| Integrated Node checks | 691 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-v2-final-node.log` |
| Chromium pagination/autosave E2E | 9 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-v2-final-e2e.log` |
| Excel newline/codec/export checks after final fix | 40 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/windows-crlf-local-final-tests.log` |
| Final affected-code regression checks | 52 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-v2-final-fixes.log` (26.345 s) |
| Native Windows functional checks | 329 passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-windows-functional-tests.log`; Python 3.13.15, source labeled `source-10ea7a1-crlf-review`, no source paths changed; this is not final package browser acceptance |
| Native v4 runtime/package unit checks | 15 passed; PowerShell 14 assertions passed | Remote `review-tests/v4-native-tests.log`, `v4-native-process-tests.log`; v4 Python and `source-71174fe/tests` paths independently recorded |
| Native runtime integrity | Two successful verifications, 90 locked wheels; manifest unchanged | Remote `review-tests/v4-native-runtime.log`; SHA-256 `085b533b4b0d4db47157f4a01e0c54868a2d17483e0984bbc19c4d8471cdc19b`. An optional third verification hit the SSH wrapper timeout and is not counted as passed |
| Staged database initialization | Positive and missing-schema negative cases passed | `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare_staged_initializer_review.py`; temporary package, independent cwd and `-I -B` |
| Offline frontend resource and packaging regression | 21 passed | /home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-solara-shortpaths-review.log; independent ZIP set/hash verification and production dynamic dependency closure. Earlier 20-test integrity review also rejected missing, modified and extra resources and changed locks |
| Earlier Linux real-browser business flow | Recorded functional checks passed; browser-only network restriction | `/tmp/spare-v2-live-final/browser-acceptance.json`: autosave/reload, 4 Monte Carlo samples, reliability detail, XLSX/template download and confirmed import, visualization frame advancement; no recorded external browser requests or uncaught browser errors. Only browser public-network access was blocked; the server could fetch/cache CDN assets. This proves neither both browser and server operating offline nor final Windows Edge behavior |

## Final-semantics performance measurement

Artifact: `/home/g/Models/spare_mvp-v2-acceptance-evidence/local/spare-v2-final-benchmark.json`, rerun on candidate **`f55f1735d3b63690862ff7f1fa323f658ebc5732`**. These values supersede the earlier `10ea7a1` measurement; later changes affect offline packaging and the acceptance driver; model sources and canonical input are unchanged.

Input: `exports/project-case-large.json`, SHA-256 `ed75b6f6942741ca6ee59967aaa801168c1d55264641ac88a604f0cd7af09484`. Python 3.12.13, Mesa 3.5.1; three repetitions of mission reliability, four samples/four workers, seed `20260621`. All three completed 4/4 samples with zero failures.

- Median request elapsed: **4.819034 s**; repetitions 4.819034 / 4.807398 / 4.868808 s.
- Throughput: **0.8216–0.8321 samples/s**.
- Response: **1,554,889–1,554,893 bytes**.
- Sampled process-tree peak RSS: **327,593,984–339,079,168 bytes** (312.42–323.37 MiB).

The earlier isolated PR365 comparison showed 4.944 → 3.789 s and byte-equivalent seeded outputs under its original input/semantics. It is historical optimization evidence, not a like-for-like speedup claim for this final business-semantics measurement.

## Final Windows package acceptance

Host: **4700-4**, existing Windows installation. Isolated root: `C:\Users\user\Models\spare_mvp-acceptance-20260918T151500-1091c98`; final package **`package-e0f7824`**, app-local CPython 3.13.15, Mesa 3.5.1 and Solara 1.57.5. This is an isolated test environment on an existing OS, not a fresh Windows installation test.

Retained evidence root: `/home/g/Models/spare_mvp-v2-acceptance-evidence`. Paths below are relative to that directory. Failed f55 (missing CDN resources) and 62a (two development paths too long) candidates remain separately archived and are not accepted results.

| Required evidence | Result |
| --- | --- |
| Build, seal and startup | **PASSED** — `windows-e0f7824/build-e0f7824.log` and `start-e0f7824.status`; 18,823 immutable files verified against source `e0f7824ecc6d9d2d00543aafd978e70b35bedfc4` |
| Native Edge workflow | **PASSED — 21/21 checks** — Edge 153.0.4234.32; V2/RBD, autosave/reload, 4 Monte Carlo samples with zero failures, per-sample reliability and business wave axis, native XLSX downloads, template preview/public compilation/confirmed import, visualization from minute 0 to 1. `windows-browser-e0f7824/browser-acceptance.json`, eight screenshots and two actual XLSX files |
| Browser and server public-network restrictions | **PASSED** — exact candidate Python executable outbound firewall block; TCP external probe refused while loopback health succeeded. Test Edge process used a non-listening proxy plus loopback bypass; same-browser external probe returned `ERR_PROXY_CONNECTION_FAILED` and local health 200. No external business requests, local resource failures or uncaught browser errors. This is scoped public-network blocking, not physical disconnection; management access was preserved |
| Stop only package-owned services | **PASSED** — backend 19676 and Solara 15588 stopped using verified ownership; ports 18473/18475 released and candidate firewall rule removed. Test Edge 18608 and port 19224 also stopped; local test servers and SSH tunnel closed. `windows-e0f7824/stop-e0f7824.json` and `browser-stop-e0f7824.json` |
| Full immutable verification after shutdown | **PASSED** — all 18,823 immutable files unchanged; package and runtime manifest hashes unchanged. `windows-e0f7824/post-run-integrity-e0f7824.json` and `.log` |

Package manifest SHA-256: `9abc598b0aa90a2b8f5a3db38c5ebad757603a0c054dd47df93414939be68d39`. Runtime manifest SHA-256: `085b533b4b0d4db47157f4a01e0c54868a2d17483e0984bbc19c4d8471cdc19b`. Source archive, source manifest, input, dependency lock and frontend asset archive hashes are recorded in `candidate.json`; frontend ZIP and source ZIP are retained in `candidate/`.

The build used `source-e0f7824/scripts/build-portable.ps1` with `offline-runtime-v4/runtime`, `-DependencyBundle offline-runtime-v4`, `-FrontendAssets solara-cdn-d52ecb78df9c`, the transferred source manifest and new destination `package-e0f7824`. Startup used `-BackendPort 18473 -SolaraPort 18475 -NoBrowser`. The committed `scripts/verify-live-workbench.mjs` drove native Edge over CDP with an isolated download directory and SCP transfer; it did not replace browser downloads with direct API retrieval.

Implementation remains on `implementation/v2-acceptance`. The original `spare_mvp` main checkout is preserved; the later acceptance-report commit does not change packaged application bytes.
