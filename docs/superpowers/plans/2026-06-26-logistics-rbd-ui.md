# Logistics Transport And RBD UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update logistics support transport strategy controls and render the reliability block diagram from k-out-of-n plus series/parallel relationships.

**Architecture:** Keep the transport selection state inside the existing front-end module and mutate `supportActivities[].transportStrategies` in place. Build RBD layout metadata in `front/rbd-evaluator.mjs`, then let `front/app.js` render a deterministic SVG-backed diagram and the existing node/edge tables.

**Tech Stack:** Browser ES modules, Node `node:test`, static HTML/CSS front end.

---

### Task 1: Logistics Transport Batch Delete UI

**Files:**
- Modify: `front/app.js`
- Test: `tests/frontend-contract.test.mjs`

- [x] Add selected transport row state near existing support activity selection state:

```js
let selectedLogisticsTransportStrategyIndexes = new Set();
```

- [x] Change add/delete behavior so the section header shows `新增` and `删除`, rows start with checkboxes, and deletion removes selected rows.

- [x] Verify by running:

```bash
npm test -- tests/frontend-contract.test.mjs
```

Expected: the frontend contract assertions pass.

### Task 2: Reliability Block Diagram Layout

**Files:**
- Modify: `front/rbd-evaluator.mjs`
- Modify: `front/app.js`
- Modify: `front/styles.css`
- Test: `tests/rbd-evaluator.test.mjs`
- Test: `tests/frontend-contract.test.mjs`

- [x] Add layout helpers that group nodes by parent, mark children as series/parallel/standby/k-of-n, and assign deterministic coordinates.

- [x] Render the RBD as an SVG with start/end terminals, parent-to-child connectors, parallel/k-of-n lanes, and node badges for `n中取k`.

- [x] Verify by running:

```bash
npm test -- tests/rbd-evaluator.test.mjs tests/frontend-contract.test.mjs
```

Expected: evaluator and frontend contract assertions pass.

### Task 3: Full Frontend Verification

**Files:**
- No code edits unless tests expose an issue.

- [x] Run:

```bash
npm test
```

Expected: the full Node test suite passes.
