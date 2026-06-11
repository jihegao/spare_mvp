# Project Agent Guide

## Project Context

This repository is the new baseline for the spare-parts planning and mission-reliability evaluation MVP.

Previous frontend and modeling versions are abandoned for this project line. Do not treat older UI layouts, older modeling flows, or earlier simulation assumptions as authoritative unless the user explicitly asks to salvage a specific piece.

The current delivery route is:

1. Build and review the frontend prototype first.
2. Use the agreed frontend pages and fields as the product contract.
3. Then update the backend simulation algorithm and data adapters so their outputs align with the frontend fields.

## Current Scope

The current committed baseline is a static frontend review prototype plus legacy candidate simulation code:

- `front/`: static prototype for 2 modules and 4 analysis pages.
- `docs/prd.md`: current frontend prototype PRD.
- `docs/development-handoff-plan.md`: development handoff and phased route.
- `docs/mvp-acceptance-checklist.md`: route A frontend acceptance checklist.
- `core/`: candidate backend simulation code. It is not yet accepted as the current product algorithm contract.

Treat `front/` and `docs/` as the current source of truth for the frontend prototype. Treat `core/` as future backend-alignment material until a phase explicitly brings it into scope.

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
- Do not claim static demo data is real simulation output.
- Do not make `core/` authoritative before a backend-alignment phase defines tests and field contracts.
- Do not add backend APIs before the frontend field contract is stable.
- Do not broaden a phase beyond its stated acceptance checks.

## Useful Checks

For the current documentation phase:

```bash
rg -n "旧版|废弃|前端原型|TDD|PR|pull request|core/|仿真算法|字段" agent.md docs
rg -n "真实仿真计算输出|不代表真实|静态前端|路线 A" docs
awk 'BEGIN{bad=0} /^\\|/ { n=gsub(/\\|/,"&"); if (lastfile==FILENAME && prevbar>0 && n!=prevbar && prevline ~ /^\\|/) { print "table column change near " FILENAME ":" FNR " prev=" prevbar " now=" n; bad=1 } prevbar=n; prevline=$0; lastfile=FILENAME; next } { prevbar=0; prevline=$0; lastfile=FILENAME } END{exit bad}' docs/*.md
```

For Python code phases:

```bash
python3 -m py_compile core/*.py
```
