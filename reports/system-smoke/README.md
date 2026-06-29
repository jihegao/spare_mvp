# M0/M1 System Smoke Baseline

Date: 2026-06-19 (Asia/Shanghai)

## Conclusion

M0/M1 static frontend and local simulation contracts pass the preserved smoke baseline. The tested path covers login, project selection, modeling edit, Monte Carlo configuration/start, result analysis, and visual simulation.

This remains the M0/M1 static baseline preserved for comparison with later M3 backend smoke reports. It is no longer the current backend-service state; M3-0 and M3-1 evidence live under `reports/m3-0-real-backend-loop/` and `reports/m3-1-browser-backend-smoke/`.

## Automated Baseline

| Command | Result |
| --- | --- |
| `npm test` | Pass: 90 tests, 0 failures |
| `.abm-mesa-env/bin/python -m unittest discover tests` | Pass: 30 tests, 0 failures |
| `python3 -m http.server 4173` | Started from repo root on port 4173 |
| `curl --noproxy '*' -I http://localhost:4173/front/index.html` | `HTTP/1.0 200 OK` |

Environment note: this shell has global proxy variables set. Localhost requests must bypass proxy with `--noproxy '*'`, `NO_PROXY`, or by unsetting `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY`.

## Browser Smoke

Runner:

```bash
node reports/system-smoke/browser-smoke.mjs
```

Output:

- JSON: `output/playwright/system-smoke-result.json`
- Screenshots: `output/playwright/*.png`

| Step | Evidence |
| --- | --- |
| Login -> project list | `output/playwright/01-project-list.png` |
| Enter project | `output/playwright/02-project-workbench.png` |
| Modeling page before edit | `output/playwright/03-modeling-before-edit.png` |
| Modeling page after edit | `output/playwright/04-modeling-after-edit.png` |
| Monte Carlo list | `output/playwright/05-monte-carlo-list.png` |
| Monte Carlo editor | `output/playwright/05b-monte-carlo-editor.png` |
| Monte Carlo detail results | `output/playwright/06-monte-carlo-detail-results.png` |
| Visual simulation | `output/playwright/08-visual-simulation.png` |

Observed final state:

- Page title: `备件规划及任务可靠度验证评估平台`
- Final heading: `可视化推演`
- Final breadcrumb: `备件规划评估模块 / 仿真实验 / 可视化推演`
- Visual simulation tabs: aircraft / mission / support

## Issues

### Blocker

- No product blocker found on the tested M0/M1 path.
- Test environment blocker: global proxy configuration can break localhost smoke checks unless bypassed. This caused false failures for plain `curl` and Python `urllib` before using explicit proxy bypass.

### Polish

- Left-nav controls are automation-fragile around collapsed `details/summary` groups. The smoke runner can use DOM-click fallback when opening nested feature pages.
- Monte Carlo smoke now verifies the experiment list, editor, and detail results area instead of the removed standalone result page.
- Visual simulation keeps the product-facing aircraft, mission, and support views; the old graph view is no longer part of the baseline.

### Future Backend

- The baseline uses static `http.server` and frontend-local simulation state. M3 should replace this with real backend service startup and health checks.
- `front/api-client.mjs` already defines `/api` contracts, but the smoke path does not validate a live backend implementation.
- Mesa visualization references the local contract service path in frontend code; M3 should run and verify the real Mesa contract service instead of relying on static/demo state.

## M3 Entry Gate

Before starting M3 backend serviceization, preserve this baseline as the comparison target:

1. Run both automated baselines and keep them green.
2. Start frontend on port 4173 with localhost proxy bypass configured.
3. Run `node reports/system-smoke/browser-smoke.mjs`.
4. Confirm `output/playwright/system-smoke-result.json` reports `ok: true`.
5. Add a new M3 backend smoke that exercises real `/api` and Mesa contract endpoints without changing this M0/M1 baseline.
