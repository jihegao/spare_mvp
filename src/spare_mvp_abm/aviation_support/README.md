# Aviation Support Scenario

This scenario pack models sortie generation for a single flightline with
resource-constrained support operations.

## Scope

- Missions specify planned departure time, duration, required aircraft type, and
  required aircraft count.
- Aircraft keep a history of flight hours, landings, calendar days since
  overhaul, and a small subsystem/LRU reliability tree.
- Support plans are composed from basic operations. The first version includes
  pre-mission support, post-mission support, and LRU maintenance support.
- Resources are constrained pools for mechanic teams, fuel trucks, power carts,
  weapons crews, and maintenance bays.
- `ontology.json` is the source for configurable aircraft types, aircraft
  inventories, mission plans, support tasks, support plans, resources, and spare
  parts. `ontology.normalized.json` and `ontology.report.json` record the local
  ontology-IR normalization result.

## Model Boundary

`model.py` keeps Mesa as the executable model surface. Ordered support tasks use
DES-style logic inside the Mesa model: each task waits for resources, occupies
them for a duration, releases them, and advances the aircraft state.

The current slice does not claim calibrated aircraft reliability. LRU failures
use seeded exponential failure sampling from the encoded MTBF values.

The ontology describes structure and scenario configuration. Mesa rules still
implement the dynamic behavior: launch decisions, support queues, resource
occupation, task durations, LRU failure sampling, spare consumption, and spare
replenishment.

## Visualization

Open `visualization.html` through a local HTTP server for browser inspection.
The page has three coordinated views:

- Aircraft view: select one aircraft and inspect mission status, support status,
  flight history, systems, LRUs, health state, MTBF, MTTR, and spare mapping.
- Mission view: inspect the mission schedule table, execution progress, assigned
  aircraft group, and each assigned aircraft's current state.
- Support view: inspect resource working/idle status, accumulated work time,
  work counts, support jobs, event log, spare stock, consumed count, replenished
  count, and pending replenishment quantity.

## Evidence

Run the deterministic smoke scenario:

```bash
python3 /Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/aviation_support/model.py \
  --config src/spare_mvp_abm/aviation_support/smoke.json \
  --output-dir /tmp/aviation-support-smoke \
  --install-dir .abm-mesa-env
```

Run the resource-capacity sweep:

```bash
python3 /Users/gaojihe/apps/mesa-abm-skill/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/aviation_support/model.py \
  --config src/spare_mvp_abm/aviation_support/experiment.json \
  --output-dir /tmp/aviation-support-sweep \
  --install-dir .abm-mesa-env
```

Primary outputs are per-step CSV files and `summary.json`. Open
`visualization.html` for a browser inspection surface.
