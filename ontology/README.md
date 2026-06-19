# Project Ontology Artifacts

This directory holds the project-level ontology contract for
Simulation-Contract-First Development.

## Files

### `spare_mvp.ontology.json`

This is the canonical source. Edit this file when the project ontology changes.
It uses an Ontology-Playground-compatible JSON shape: entity types, typed
properties, relationships, cardinalities, display metadata, and project-json
bindings.

Mesa models may read this file directly, or read a generated artifact derived
from it. Ontology describes structure; Mesa still owns behavior rules, scheduling,
stochastic processes, resource contention, and metric calculation.

### `spare_mvp.normalized.json`

This is a generated artifact produced from `spare_mvp.ontology.json`.
It is the normalized local IR used by ontology tooling and Mesa scaffolding.

### `spare_mvp.validation.json`

This is a validation report generated with the normalized ontology. It records
entity, relationship, and property counts plus validation errors and warnings.
It is evidence for review, not a second source of truth.

## Regeneration

Do not edit generated files by hand. Regenerate them after changing
`spare_mvp.ontology.json`:

```bash
python3 scripts/normalize_ontology.py \
  --input ontology/spare_mvp.ontology.json \
  --output ontology/spare_mvp.normalized.json \
  --report ontology/spare_mvp.validation.json
```

The test suite checks that the checked-in normalized ontology and validation
report can be regenerated from the canonical source.
