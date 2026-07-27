# Aircraft support v1 runtime

`AircraftSupportV1Model` is the stable runtime facade. Project JSON must still be
compiled by `SimulationAdapter`; this package does not own or duplicate
Project-to-model compilation.

## Module responsibilities

- `model.py`: facade, runtime initialization, the public run loop, and minute-step
  orchestration.
- `state.py`: mutable runtime state records for aircraft, missions, jobs, and
  transport.
- `model_builders.py`: construction and normalization of compiled model inputs.
- `component_index.py`: immutable aircraft/component applicability indexes.
- `failure_engine.py`: failure clocks and failure-event creation.
- `mission_engine.py`: preflight, dispatch, mission progress, and recovery.
- `maintenance_engine.py`: job lifecycle and preventive-maintenance scheduling.
- `support_engine.py`: support-resource and spare allocation.
- `transport_engine.py`: replenishment and resource movement.
- `metrics_engine.py`: stop conditions, readiness, availability, and downtime.
- `telemetry.py`: snapshots, visualization frames, and event projection.
- `runtime_utils.py`: pure normalization helpers shared by the modules above.

## Runtime invariants

The order in `AircraftSupportV1Model.step()` is behaviorally significant. In
particular, arrivals and completed work are applied before new work is started;
failures are evaluated before mission success and return processing; preventive
work is generated after mission return processing. Reordering these operations
changes same-minute resource visibility and seeded simulation results.

Failure-timer initialization intentionally samples every behavior component in
the original component order before applying the precomputed applicability
index. This preserves the historical random-number stream while removing
repeated component/aircraft string normalization from every simulation minute.

Mixin methods remain callable through `AircraftSupportV1Model` for compatibility
with existing tests and backend callers. New external callers should use the
facade's `run()`, `step()`, `snapshot()`, and `visualization_frame()` methods.
