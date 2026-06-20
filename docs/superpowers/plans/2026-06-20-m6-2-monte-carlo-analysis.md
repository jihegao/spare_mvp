# M6.2 Monte Carlo Analysis Implementation Plan

## Goal

Implement the minimal M6.2 slice after M6.1.1: persist an ExperimentPlan analysis profile, run one compiled Scenario through a unified Monte Carlo batch, write one base Monte Carlo artifact, and write enabled analysis projection artifacts that all reference that base artifact.

## Scope

- Keep this work on `codex/m6-2-monte-carlo-analysis` as a stacked branch above M6.1.1.
- Reuse `experiment_plans.payload_json`, `simulation_runs.run_type`, `result_summaries`, and `artifact_manifests`; do not add Monte Carlo or AnalysisTask tables in this slice.
- Add `SimulationExperimentBase` and Monte Carlo batch logic in `src/spare_mvp_contract`, with no database dependency.
- Let `RunService` keep ownership of project, snapshot, ExperimentPlan, compiler gate, scenario persistence, run persistence, and status envelope.
- Extend frontend ExperimentPlan config to emit `analysisRequests`; frontend analysis pages should read formal artifact/projection metadata and show unconfigured/pending/running/failed/completed states.

## Non-Goals

- No A4 `front/app.js` module split.
- No production async worker, queue, cancellation, or retry subsystem.
- No aviation_support compiler work.
- No M6.1/M6.1.1 input gap repair beyond preserving the compiled Scenario boundary.
- No frontend-local Monte Carlo experiment database or local AnalysisTask persistence.
- No demo/local projection labeled as official result.

## TDD Steps

1. Backend API contract red tests:
   - `monte_carlo` run type is accepted and persists run, result summary, base artifact, and enabled projection artifacts.
   - Compiler gate still fail-closes unsupported model families with no scenario and no artifacts.
   - Disabled analysis requests do not produce projection artifacts.
   - All projection artifacts reference the same base Monte Carlo artifact.
2. Adapter red tests:
   - Monte Carlo batch artifact contains compiled scenario identity, mapping version, sample count, seed, sweep dimensions, per-sample metrics, aggregate metrics, and logs summary.
   - Same Scenario, plan config, mapping version, and seed reproduce aggregate and per-sample inputs.
3. Frontend red tests:
   - `buildExperimentPlanConfig()` emits M6.2 `analysisRequests`.
   - Monte Carlo launch submits `run_type: "monte_carlo"` from the current ExperimentPlan branch.
   - Formal analysis boundary unlocks from projection artifact metadata instead of hard-coded local/demo output.

## Implementation Steps

1. Add `src/spare_mvp_contract/experiments.py`.
   - `SimulationExperimentBase` provides JSON artifact writing, hashing, timestamp, and identity helpers.
   - `MonteCarloBatchExperiment` runs smoke samples from a compiled Scenario and normalized analysis profile.
   - `AnalysisTaskProjection` writes `large_sample_summary`, `spare_shortfall`, `carry_list`, `mission_reliability`, and `downtime_factors` payloads when enabled.
2. Add `SimulationAdapter.run_monte_carlo_batch(...)` as the contract-layer adapter entrypoint.
3. Update `RunService` to allow `run_type in {"single", "monte_carlo"}` and call the adapter Monte Carlo entrypoint after the same compiler gate path.
4. Extend frontend config and launch wiring.
5. Update docs/status text only after tests pass.

## Verification

- `python3 -m unittest tests.test_simulation_adapter tests.test_backend_api_contract -v`
- `node --test tests/frontend-api-client.test.mjs tests/frontend-contract.test.mjs`
- `npm test`
- `git diff --check`
