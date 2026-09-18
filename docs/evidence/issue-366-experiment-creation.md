# Issue 366: opening a new experiment plan

Measured 2026-09-18 on the same local Node.js 22 runtime and F35 Project, five fresh app instances per revision. The existing `frontend-app-runtime` harness dispatches the actual add-button click and waits for its asynchronous tasks; the editor HTML must contain the save action after each sample. Backend responses and DOM are simulated by that harness, so these numbers do not measure browser painting, network latency, or saving a plan.

The local SQLite database was opened with `mode=ro`. Its Project payload passed through `ProjectJsonExporter` and was transferred in memory; no private Project data is included in this evidence. Temporary wrappers timed the real clone/default/preview/render functions. Input identity was normalized to the harness project ID only.

| Measurement (ms) | Before median | After median |
|---|---:|---:|
| totalMs | 43.967 | 9.324 |
| cloneScenario | 4.412 | 4.183 |
| ensureMonteCarloSweepDefaults | 0.164 | 0.162 |
| ensureExperimentPlanDraftDefaults | 0.214 | 0.203 |
| updatePreviewResultsThroughApiClient | 34.083 | 0.000 |
| render | 0.488 | 0.388 |

| Sample | Before click (ms) | After click (ms) |
|---|---:|---:|
| 1 | 68.609 | 11.683 |
| 2 | 44.927 | 9.475 |
| 3 | 43.477 | 9.324 |
| 4 | 43.446 | 9.049 |
| 5 | 43.967 | 9.201 |

Opening the branch used to calculate both legacy preview simulations synchronously even though the configuration editor does not display their results. The change removes that call from branch creation, preserving copying/default initialization and the existing save, snapshot, plan creation, and preflight API chain. Other explicit preview/analysis paths are unchanged.

This confirms a local avoidable CPU cost; it does not reproduce or resolve an unmeasured seconds-long delay in a deployed browser. No 60-second acceptance threshold applies to this work item. Existing runtime tests cover editing and saving the isolated draft; the added boundary regression rejects implicit simulation during branch creation.
