# Project Agent Guide

## Project Context

This repository is the new baseline for the spare-parts planning and mission-reliability evaluation MVP.

Previous frontend and modeling versions are abandoned for this project line. Do not treat older UI layouts, older modeling flows, or earlier simulation assumptions as authoritative unless the user explicitly asks to salvage a specific piece.

The current MVP is the smallest complete implementation across the full CSCI scope. It is not a UI-only prototype. The product must eventually prove this closed loop:

```text
modeling input -> experiment plan -> backend computation or local service -> persisted run artifacts -> frontend display -> acceptance evidence
```

The current delivery route is:

1. Preserve the Phase 0 static frontend as the review and page-field baseline.
2. Use the agreed pages, fields, and MVP acceptance checklist as the product contract.
3. Define the interface, field, and artifact contracts before backend integration.
4. Update or wrap the backend simulation and data adapters so their outputs align with the contract.
5. Connect the frontend to backend results or persisted artifacts without claiming demo fixtures are real simulation output.

## Current Scope

The current committed baseline is a static CSCI frontend review baseline plus candidate simulation code:

- `front/`: static review baseline for 3 modules and 9 CSCI function pages.
- `docs/prd.md`: full minimum viable product PRD, with the static frontend clearly marked as Phase 0 baseline.
- `docs/development-handoff-plan.md`: overall phase plan and status control document.
- `docs/mvp-acceptance-checklist.md`: full MVP acceptance contract covering frontend, backend, simulation, artifacts, and integration evidence.
- `docs/modeling-detailed-requirements.md`: modeling field and business-rule input for the MVP field contract.
- `core/`: candidate backend simulation code. It is in MVP scope, but its product contract is not accepted until a backend-alignment phase defines field tests, result mapping, and artifact evidence.

Treat `docs/development-handoff-plan.md` as the phase-control source of truth. Treat `docs/prd.md` and `docs/mvp-acceptance-checklist.md` as the product and acceptance sources of truth. Treat `front/` as the Phase 0 page baseline. Treat `core/` as candidate implementation material that must be validated through the MVP contract before its outputs are described as accepted product behavior.

## Development Method

Use TDD for implementation phases.

For production code changes:

1. Write or update a focused failing test first.
2. Run it and confirm the expected failure.
3. Implement the smallest change that makes it pass.
4. Run the focused test and the relevant broader checks.
5. Refactor only after tests are green.

For documentation-only phases, use repeatable verification instead of code tests. At minimum, run searches that prove old or conflicting project claims are not left behind, and check Markdown table structure when tables are edited.

## Phase Workflow

Development is phase-based. Each phase should have:

1. A short scope statement in docs or the PR body.
2. Concrete acceptance checks.
3. A dedicated Git branch.
4. A commit with only the intended phase changes.
5. A pushed GitHub branch and pull request.

Do not push phase work directly to `main`. Open a PR for review. Use draft PRs unless the user explicitly asks for ready-for-review.

At the end of each phase, update `docs/development-handoff-plan.md` with the phase status, validation evidence, key artifacts, remaining questions, and next-stage entry point.

## Subagents

Subagents may be used for bounded side work.

Use downgraded or cheaper models for read-only scans, wording audits, checklist reviews, and independent low-risk drafts. Keep final integration, file edits, verification, commits, pushes, and PR creation in the main agent session unless the user explicitly requests otherwise.

When using subagents:

1. Give them narrow, self-contained prompts.
2. Prefer read-only tasks unless a disjoint write scope is explicitly assigned.
3. Treat their output as evidence to verify, not as final truth.
4. Close subagents when their result has been integrated or dismissed.

## Route Guardrails

- Do not revive abandoned frontend or modeling assumptions without explicit user approval.
- Do not call the static frontend baseline the current MVP.
- Do not claim static demo data is real simulation output.
- Do not make `core/` authoritative until a backend-alignment phase defines tests, field mapping, and artifact evidence.
- Do not add backend APIs before the frontend, field, and artifact contracts are stable.
- Do not broaden a phase beyond its stated acceptance checks.
- Do not treat far-future platform depth as required for the current MVP; implement the smallest complete path across all CSCI components first.

## Useful Checks

For documentation phases:

```bash
rg -n "Route A|路线 A|静态前端 MVP|当前交付目标仍是静态|2 modules|4 analysis|4 个结果页|前端原型 PRD|route A frontend" agent.md docs
rg -n "真实仿真计算输出|不代表真实|演示夹具|静态前端基线|Phase 0|core/|字段契约" agent.md docs
awk 'BEGIN{bad=0} /^\\|/ { n=gsub(/\\|/,"&"); if (lastfile==FILENAME && prevbar>0 && n!=prevbar && prevline ~ /^\\|/) { print "table column change near " FILENAME ":" FNR " prev=" prevbar " now=" n; bad=1 } prevbar=n; prevline=$0; lastfile=FILENAME; next } { prevbar=0; prevline=$0; lastfile=FILENAME } END{exit bad}' docs/*.md
```

For frontend baseline checks:

```bash
node --test tests/front-pages.test.mjs tests/front-render.test.mjs
```

For Python code phases:

```bash
python3 -m py_compile core/*.py
```
