"""Standalone Monte Carlo sweep visualization HTML for the GLM model.

Renders the 27-combination sweep results as an aggregate metrics table plus
sensitivity trend lines, and embeds a representative single-run frame replay
(reusing the phase lane rendering from ``visualization``).
"""

from __future__ import annotations

import html
import json
import statistics
from typing import Any

from .visualization import PHASE_COLORS, PHASE_LANES, PHASE_LABELS


def _fmt_pct(value: float) -> str:
    return f"{round(value * 100)}%"


def _fmt_float(value: float, digits: int = 3) -> str:
    return f"{round(value, digits)}"


def _mean_std_cell(mean: dict[str, Any], std: dict[str, Any], key: str, fmt: str = "float") -> str:
    if key not in mean:
        return "<td>—</td>"
    m = float(mean[key])
    s = float(std.get(key, 0.0))
    if fmt == "pct":
        return f"<td>{_fmt_pct(m)} <span class='std'>±{_fmt_pct(s)}</span></td>"
    return f"<td>{_fmt_float(m)} <span class='std'>±{_fmt_float(s)}</span></td>"


def _sensitivity_points(
    results: list[dict[str, Any]],
    dim_key: str,
    fixed: dict[str, Any],
) -> list[tuple[float, float]]:
    """Return (x, completion_rate) points for one sweep dimension."""
    points: list[tuple[float, float]] = []
    for row in results:
        if all(row.get(k) == v for k, v in fixed.items()):
            mean = row.get("mean", {})
            rate = mean.get("availability")
            if rate is None:
                continue
            points.append((float(row[dim_key]), float(rate)))
    points.sort(key=lambda item: item[0])
    return points


def _sensitivity_svg(
    results: list[dict[str, Any]],
    failure_rates: list[float],
    spare_multipliers: list[float],
    support_capacities: list[int],
) -> str:
    """Build three small line charts showing availability vs each dimension."""
    charts: list[str] = []
    center = {
        "failure_rate": float(statistics.median(failure_rates)) if failure_rates else 0.0,
        "spare_multiplier": float(statistics.median(spare_multipliers)) if spare_multipliers else 1.0,
        "support_capacity": int(statistics.median(support_capacities)) if support_capacities else 3,
    }
    dims = [
        ("failure_rate", "故障率", center_fixed({"spare_multiplier": center["spare_multiplier"], "support_capacity": center["support_capacity"]})),
        ("spare_multiplier", "备件倍数", center_fixed({"failure_rate": center["failure_rate"], "support_capacity": center["support_capacity"]})),
        ("support_capacity", "保障容量", center_fixed({"failure_rate": center["failure_rate"], "spare_multiplier": center["spare_multiplier"]})),
    ]
    for dim_key, label, fixed in dims:
        points = _sensitivity_points(results, dim_key, fixed)
        charts.append(_line_chart_svg(points, label))
    return "\n".join(charts)


def center_fixed(fixed: dict[str, Any]) -> dict[str, Any]:
    return fixed


def _line_chart_svg(points: list[tuple[float, float]], label: str) -> str:
    width, height = 240, 150
    pad_l, pad_b, pad_t, pad_r = 44, 28, 12, 12
    if not points:
        return f'<svg class="mini" viewBox="0 0 {width} {height}"><text x="{width//2}" y="{height//2}" text-anchor="middle" fill="#9fb3c8" font-size="11">{html.escape(label)}: 无数据</text></svg>'
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = 0.0, max(1.0, max(ys))
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def sx(x: float) -> float:
        if x_max == x_min:
            return pad_l + plot_w / 2
        return pad_l + (x - x_min) / (x_max - x_min) * plot_w

    def sy(y: float) -> float:
        return pad_t + (1 - (y - y_min) / (y_max - y_min)) * plot_h

    poly = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in points)
    dots = "".join(
        f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="3.5" fill="#1c7ed6"></circle>'
        f'<text x="{sx(x):.1f}" y="{sy(y) - 7:.1f}" text-anchor="middle" font-size="9" fill="#486581">{_fmt_pct(y)}</text>'
        for x, y in points
    )
    x_labels = "".join(
        f'<text x="{sx(x):.1f}" y="{height - 8}" text-anchor="middle" font-size="9" fill="#627d98">{_fmt_float(x, 2)}</text>'
        for x in xs
    )
    return (
        f'<svg class="mini" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(label)} 敏感度">'
        f'<text x="{width//2}" y="11" text-anchor="middle" font-size="11" font-weight="700" fill="#243b53">{html.escape(label)} → 可用度</text>'
        f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" stroke="#bcccdc"></line>'
        f'<line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{pad_l + plot_w}" y2="{pad_t + plot_h}" stroke="#bcccdc"></line>'
        f'<polyline points="{poly}" fill="none" stroke="#1c7ed6" stroke-width="2"></polyline>'
        f'{dots}{x_labels}'
        f'</svg>'
    )


def build_monte_carlo_html(
    results: list[dict[str, Any]],
    *,
    steps: int,
    samples: int,
    seed: int,
    failure_rates: list[float],
    spare_multipliers: list[float],
    support_capacities: list[int],
) -> str:
    """Return a self-contained HTML document for the Monte Carlo sweep."""
    # Pick the representative frames: the group closest to the grid center.
    center_fr = float(statistics.median(failure_rates)) if failure_rates else 0.0
    center_sm = float(statistics.median(spare_multipliers)) if spare_multipliers else 1.0
    center_sc = int(statistics.median(support_capacities)) if support_capacities else 3
    representative: list[dict[str, Any]] = []
    for row in results:
        if (
            row.get("failure_rate") == center_fr
            and row.get("spare_multiplier") == center_sm
            and row.get("support_capacity") == center_sc
        ):
            representative = row.get("representative_frames") or []
            break
    if not representative:
        for row in results:
            if row.get("representative_frames"):
                representative = row["representative_frames"]
                break

    frames_json = json.dumps(representative, ensure_ascii=False)
    phase_labels_json = json.dumps(PHASE_LABELS)
    phase_colors_json = json.dumps(PHASE_COLORS)
    phase_lanes_json = json.dumps(PHASE_LANES)

    # Aggregate table rows.
    rows_html: list[str] = []
    for idx, row in enumerate(results, start=1):
        mean = row.get("mean", {})
        std = row.get("std", {})
        rows_html.append(
            "<tr>"
            f"<td>{idx}</td>"
            f"<td>{_fmt_float(row['failure_rate'], 3)}</td>"
            f"<td>{_fmt_float(row['spare_multiplier'], 2)}</td>"
            f"<td>{row['support_capacity']}</td>"
            f"<td>{row.get('samples', 0)}</td>"
            f"<td>{row.get('failed', 0)}</td>"
            f"{_mean_std_cell(mean, std, 'availability', 'pct')}"
            f"{_mean_std_cell(mean, std, 'sortie_rate')}"
            f"{_mean_std_cell(mean, std, 'turnaround_time')}"
            f"{_mean_std_cell(mean, std, 'spare_fill_rate', 'pct')}"
            f"{_mean_std_cell(mean, std, 'avg_spare_delay')}"
            "</tr>"
        )
    table_body = "\n".join(rows_html) or '<tr><td colspan="11">无扫描结果</td></tr>'

    sensitivity = _sensitivity_svg(results, failure_rates, spare_multipliers, support_capacities)

    summary_metrics: list[tuple[str, str]] = []
    if results:
        all_availability = [float(r.get("mean", {}).get("availability", 0)) for r in results]
        all_sortie_rate = [float(r.get("mean", {}).get("sortie_rate", 0)) for r in results]
        all_turnaround = [float(r.get("mean", {}).get("turnaround_time", 0)) for r in results]
        all_fill = [float(r.get("mean", {}).get("spare_fill_rate", 0)) for r in results]
        all_delay = [float(r.get("mean", {}).get("avg_spare_delay", 0)) for r in results]
        best_idx = max(range(len(results)), key=lambda i: all_availability[i]) if all_availability else 0
        best = results[best_idx] if results else {}
        summary_metrics = [
            ("扫描组合数", str(len(results))),
            ("每组合样本量", str(samples)),
            ("总步数", str(steps)),
            ("随机种子基", str(seed)),
            ("平均可用度", _fmt_pct(statistics.mean(all_availability)) if all_availability else "—"),
            ("可用度最高", _fmt_pct(all_availability[best_idx]) if all_availability else "—"),
            ("平均出动架次率", _fmt_float(statistics.mean(all_sortie_rate), 2) if all_sortie_rate else "—"),
            ("平均再出动准备", f"{round(statistics.mean(all_turnaround), 1)} min" if all_turnaround else "—"),
            ("平均备件满足率", _fmt_pct(statistics.mean(all_fill)) if all_fill else "—"),
            ("平均备件延误", f"{round(statistics.mean(all_delay), 1)} min" if all_delay else "—"),
            ("最佳组合", f"FR={best.get('failure_rate')} SM={best.get('spare_multiplier')} SC={best.get('support_capacity')}" if best else "—"),
        ]
    summary_html = "".join(
        f"<div class='metric'><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong></div>"
        for label, value in summary_metrics
    )

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GLM 蒙特卡洛扫描可视化</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ padding: 14px 24px; background: #1d2730; color: white; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }}
    h1 {{ margin: 0; font-size: 20px; }}
    h2 {{ margin: 0 0 10px; font-size: 15px; color: #243b53; }}
    .meta {{ color: #bcccdc; font-size: 12px; }}
    main {{ max-width: 1280px; margin: 0 auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }}
    section {{ min-width: 0; background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; overflow: hidden; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }}
    .metric {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; background: #f8fafc; }}
    .metric span {{ display: block; font-size: 11px; color: #627d98; }}
    .metric strong {{ display: block; font-size: 16px; color: #102a43; word-break: break-word; }}
    .table-wrap {{ overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; min-width: 720px; }}
    th, td {{ border-bottom: 1px solid #e4e7eb; padding: 6px; text-align: left; white-space: nowrap; }}
    th {{ color: #627d98; background: #f0f4f8; position: sticky; top: 0; }}
    tr.best {{ background: #e7f5ff; }}
    .std {{ color: #9fb3c8; font-size: 10px; }}
    .charts {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }}
    svg.mini {{ width: 100%; height: auto; aspect-ratio: 240 / 150; background: #f8fafc; border: 1px solid #e4e7eb; border-radius: 6px; }}
    .replay {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: 14px; }}
    .controls {{ display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }}
    button {{ border: 1px solid #bcccdc; background: white; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }}
    button:hover {{ border-color: #627d98; }}
    input[type=range] {{ width: 100%; min-width: 160px; flex: 1 1 200px; accent-color: #1c7ed6; }}
    #time {{ font-variant-numeric: tabular-nums; color: #243b53; font-weight: 700; white-space: nowrap; }}
    .scene-metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; margin-bottom: 10px; }}
    .scene-metrics .metric strong {{ font-size: 15px; }}
    svg.scene {{ width: 100%; height: auto; aspect-ratio: 900 / 380; border: 1px solid #d9e2ec; background: #eef6fb; border-radius: 8px; }}
    .side {{ min-width: 0; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }}
    .side h3 {{ margin: 0 0 4px; font-size: 13px; color: #243b53; }}
    .card {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 6px 8px; margin-bottom: 5px; background: #f8fafc; font-size: 11px; }}
    .card strong {{ display: block; color: #102a43; font-size: 12px; }}
    .log {{ max-height: 180px; overflow: auto; line-height: 1.5; }}
    .log div {{ border-bottom: 1px solid #eef2f6; padding: 2px 0; }}
    @media (max-width: 820px) {{ .replay {{ grid-template-columns: 1fr; }} }}
    @media (max-width: 520px) {{ .scene-metrics {{ grid-template-columns: repeat(2, 1fr); }} header {{ flex-direction: column; align-items: flex-start; }} }}
  </style>
</head>
<body>
  <header>
    <h1>GLM 蒙特卡洛扫描可视化</h1>
    <span class="meta">故障率 ×{len(failure_rates)} · 备件倍数 ×{len(spare_multipliers)} · 保障容量 ×{len(support_capacities)} · 样本 {samples} · 步数 {steps}</span>
  </header>
  <main>
    <section>
      <h2>扫描汇总</h2>
      <div class="metrics">{summary_html}</div>
    </section>
    <section>
      <h2>敏感度趋势（可用度 vs 单维度，其余取中位）</h2>
      <div class="charts">{sensitivity}</div>
    </section>
    <section>
      <h2>聚合指标表（均值 ± 标准差）</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>#</th><th>故障率</th><th>备件倍数</th><th>保障容量</th><th>样本数</th><th>失败</th>
            <th>可用度</th><th>出动架次率</th><th>再出动准备(min)</th><th>备件满足率</th><th>平均备件延误(min)</th>
          </tr></thead>
          <tbody>{table_body}</tbody>
        </table>
      </div>
    </section>
    <section>
      <h2>代表样本回放（中心组合 FR={center_fr} SM={center_sm} SC={center_sc}）</h2>
      <div class="replay">
        <div>
          <div class="controls">
            <button id="prev">上一帧</button>
            <button id="play">播放</button>
            <button id="next">下一帧</button>
            <input id="slider" type="range" min="0" max="0" value="0" />
            <span id="time">D1 00:00</span>
          </div>
          <div class="scene-metrics" id="sceneMetrics"></div>
          <svg class="scene" id="scene" viewBox="0 0 900 380" role="img" aria-label="representative replay"></svg>
        </div>
        <div class="side">
          <div><h3>任务波次</h3><div id="waves"></div></div>
          <div><h3>保障资源</h3><div id="resources"></div></div>
          <div><h3>事件日志</h3><div class="log" id="events"></div></div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const frames = {frames_json};
    const phaseLabels = {phase_labels_json};
    const phaseColors = {phase_colors_json};
    const phaseLanes = {phase_lanes_json};
    let index = 0;
    let timer = null;
    const slider = document.getElementById("slider");
    slider.max = String(Math.max(0, frames.length - 1));

    function timeLabel(minutes) {{
      const total = Math.round(Number(minutes));
      const day = Math.floor(total / 1440);
      const m = total % 1440;
      return `D${{day + 1}} ${{String(Math.floor(m / 60)).padStart(2, "0")}}:${{String(m % 60).padStart(2, "0")}}`;
    }}

    document.getElementById("prev").onclick = () => setFrame(Math.max(0, index - 1));
    document.getElementById("next").onclick = () => setFrame(Math.min(frames.length - 1, index + 1));
    document.getElementById("play").onclick = () => {{
      if (timer) {{ clearInterval(timer); timer = null; document.getElementById("play").textContent = "播放"; return; }}
      document.getElementById("play").textContent = "暂停";
      timer = setInterval(() => setFrame((index + 1) % Math.max(1, frames.length)), 450);
    }};
    slider.oninput = () => setFrame(Number(slider.value));

    function setFrame(nextIndex) {{
      index = nextIndex;
      slider.value = String(index);
      if (frames.length) render(frames[index]);
    }}

    function countSupport(aircraft) {{
      return aircraft.filter(a => a.phase === "preparing" || a.phase === "post_support").length;
    }}

    function render(frame) {{
      const snap = frame.snapshot;
      const tLabel = timeLabel(snap.time);
      document.getElementById("time").textContent = tLabel;
      document.getElementById("sceneMetrics").innerHTML = [
        ["就绪", snap.ready_aircraft],
        ["飞行中", snap.flying_aircraft],
        ["可用度", Math.round(snap.availability * 100) + "%"],
        ["出动架次率", (snap.sortie_rate || 0).toFixed(2)],
        ["备件满足率", Math.round(snap.spare_fill_rate * 100) + "%"],
        ["备件延误", Math.round(snap.avg_spare_delay || 0) + "min"]
      ].map(([l, v]) => `<div class="metric"><span>${{l}}</span><strong>${{v}}</strong></div>`).join("");
      renderScene(frame);
      renderWaves(frame);
      renderResources(frame);
      renderEvents(frame);
    }}

    function renderScene(frame) {{
      const svg = document.getElementById("scene");
      svg.innerHTML = `
        <rect x="30" y="42" width="560" height="80" rx="8" fill="#dde7ee" stroke="#9fb3c8"></rect>
        <text x="46" y="68" font-size="15" font-weight="700">甲板待命 / 任务就绪</text>
        <rect x="30" y="128" width="560" height="56" rx="8" fill="#fff4db" stroke="#f59f00"></rect>
        <text x="46" y="160" font-size="14">飞行前准备 / 回收保障</text>
        <rect x="30" y="195" width="560" height="70" rx="8" fill="#dbeafe" stroke="#1c7ed6"></rect>
        <text x="46" y="235" font-size="14">任务空域</text>
        <rect x="30" y="275" width="560" height="80" rx="8" fill="#ffe8cc" stroke="#d9480f"></rect>
        <text x="46" y="318" font-size="14">修复性维修</text>
        <rect x="620" y="42" width="250" height="313" rx="8" fill="#f8fafc" stroke="#bcccdc"></rect>
        <text x="640" y="66" font-size="14" font-weight="700">保障资源 / 库存</text>
      `;
      const typeBase = {{ "J-15": 120, "J-35": 400 }};
      const typeCount = {{}};
      frame.aircraft.forEach((a) => {{
        const base = typeBase[a.type] || 240;
        const idx = typeCount[a.type] = (typeCount[a.type] || 0);
        typeCount[a.type] += 1;
        const x = base + (idx % 3) * 78;
        const y = phaseLanes[a.phase] || 70;
        const color = phaseColors[a.phase] || "#627d98";
        const label = phaseLabels[a.phase] || a.phase;
        svg.insertAdjacentHTML("beforeend", `
          <g>
            <circle cx="${{x}}" cy="${{y}}" r="23" fill="${{color}}" stroke="#102a43" stroke-width="1.5"></circle>
            <text x="${{x}}" y="${{y - 3}}" text-anchor="middle" fill="white" font-size="10" font-weight="700">${{a.tail_number}}</text>
            <text x="${{x}}" y="${{y + 11}}" text-anchor="middle" fill="white" font-size="9">${{label}}</text>
          </g>`);
      }});
      frame.resources.forEach((r, i) => {{
        const y = 96 + i * 84;
        const inv = Object.entries(r.inventory).map(([k, v]) => `${{k}}:${{v}}`).join(" / ");
        const util = Math.round((r.utilization || 0) * 100);
        svg.insertAdjacentHTML("beforeend", `
          <text x="640" y="${{y}}" font-size="12" font-weight="700">${{r.name}}</text>
          <text x="640" y="${{y + 16}}" font-size="11">人员 ${{r.personnel_available}}/${{r.personnel_capacity}} · 设备 ${{r.equipment_available}}/${{r.equipment_capacity}}</text>
          <text x="640" y="${{y + 32}}" font-size="11">利用率 ${{util}}%</text>
          <text x="640" y="${{y + 48}}" font-size="10" fill="#486581">${{inv}}</text>`);
      }});
    }}

    function renderWaves(frame) {{
      const items = (frame.missions || []).map(m => {{
        const start = m.actual_start != null ? timeLabel(m.actual_start) : "—";
        return `<div class="card"><strong>波次 ${{m.wave_id}} / ${{m.aircraft_type}} / ${{m.status}}</strong><span>计划 ${{timeLabel(m.planned_start)}} / 实际 ${{start}} / 需求 ${{m.required_aircraft}} / ${{(m.assigned_tail_numbers || []).join(", ") || "未编组"}}</span></div>`;
      }}).join("");
      document.getElementById("waves").innerHTML = items || "<div class='card'><span>无任务波次</span></div>";
    }}

    function renderResources(frame) {{
      const items = (frame.resources || []).map(r => {{
        const util = Math.round((r.utilization || 0) * 100);
        return `<div class="card"><strong>${{r.name}}</strong><span>人员 ${{r.personnel_available}}/${{r.personnel_capacity}} · 设备 ${{r.equipment_available}}/${{r.equipment_capacity}} · 利用率 ${{util}}%</span></div>`;
      }}).join("");
      document.getElementById("resources").innerHTML = items || "<div class='card'><span>无保障节点</span></div>";
    }}

    function renderEvents(frame) {{
      const items = (frame.events || []).slice().reverse().slice(0, 12).map(e => {{
        return `<div><b>${{timeLabel(e.time)}}</b> [${{e.event}}] ${{e.message}}</div>`;
      }}).join("");
      document.getElementById("events").innerHTML = items || "<div>暂无事件</div>";
    }}

    if (frames.length) setFrame(0);
  </script>
</body>
</html>
"""
