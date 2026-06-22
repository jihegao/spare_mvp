"""Standalone Monte Carlo visualization for方案二."""

from __future__ import annotations

import html
import json
import statistics
from typing import Any

from .visualization import PHASE_COLORS


def _pct(value: float) -> str:
    return f"{round(float(value) * 100)}%"


def _num(value: Any, digits: int = 3) -> str:
    return str(round(float(value), digits))


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
    center_fr = float(statistics.median(failure_rates)) if failure_rates else 0.0
    center_sm = float(statistics.median(spare_multipliers)) if spare_multipliers else 1.0
    center_sc = int(statistics.median(support_capacities)) if support_capacities else 3
    frames: list[dict[str, Any]] = []
    for row in results:
        if row.get("failure_rate") == center_fr and row.get("spare_multiplier") == center_sm and row.get("support_capacity") == center_sc:
            frames = row.get("representative_frames") or []
            break
    if not frames:
        frames = next((row.get("representative_frames") for row in results if row.get("representative_frames")), [])

    summary = []
    if results:
        availability = [float(row.get("mean", {}).get("availability", 0)) for row in results]
        completion = [float(row.get("mean", {}).get("sortie_completion_rate", 0)) for row in results]
        best_idx = max(range(len(results)), key=lambda i: availability[i])
        best = results[best_idx]
        summary = [
            ("扫描组合数", str(len(results))),
            ("每组合样本量", str(samples)),
            ("平均可用度", _pct(statistics.mean(availability))),
            ("平均完成率", _pct(statistics.mean(completion))),
            ("最佳组合", f"FR={best.get('failure_rate')} SM={best.get('spare_multiplier')} SC={best.get('support_capacity')}"),
        ]
    summary_html = "".join(f"<div class='metric'><span>{html.escape(k)}</span><strong>{html.escape(v)}</strong></div>" for k, v in summary)
    table_rows = []
    for idx, row in enumerate(results, start=1):
        mean = row.get("mean", {})
        std = row.get("std", {})
        table_rows.append(
            "<tr>"
            f"<td>{idx}</td><td>{_num(row['failure_rate'])}</td><td>{_num(row['spare_multiplier'], 2)}</td><td>{row['support_capacity']}</td>"
            f"<td>{row.get('samples', 0)}</td><td>{row.get('failed', 0)}</td>"
            f"<td>{_pct(mean.get('availability', 0))} <span>±{_pct(std.get('availability', 0))}</span></td>"
            f"<td>{_pct(mean.get('sortie_completion_rate', 0))} <span>±{_pct(std.get('sortie_completion_rate', 0))}</span></td>"
            f"<td>{_num(mean.get('avg_spare_delay', 0), 1)}</td>"
            "</tr>"
        )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>方案二 蒙特卡洛扫描可视化</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ padding: 14px 24px; background: #1d2730; color: white; }}
    h1 {{ margin: 0; font-size: 20px; }}
    main {{ max-width: 1220px; margin: 0 auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }}
    section {{ background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; }}
    h2 {{ margin: 0 0 10px; font-size: 15px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }}
    .metric {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; background: #f8fafc; }}
    .metric span {{ display: block; color: #627d98; font-size: 12px; }}
    .metric strong {{ display: block; font-size: 17px; overflow-wrap: anywhere; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; min-width: 760px; }}
    th, td {{ border-bottom: 1px solid #e4e7eb; padding: 7px; text-align: left; white-space: nowrap; }}
    th {{ background: #f0f4f8; color: #52606d; }}
    .table-wrap {{ overflow-x: auto; }}
    .controls {{ display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }}
    button {{ border: 1px solid #bcccdc; background: white; border-radius: 6px; padding: 6px 10px; cursor: pointer; }}
    input[type=range] {{ flex: 1; min-width: 180px; }}
    svg {{ width: 100%; height: auto; aspect-ratio: 900 / 360; border: 1px solid #d9e2ec; border-radius: 8px; background: #eef6fb; }}
    @media (max-width: 720px) {{ table {{ min-width: 680px; }} }}
  </style>
</head>
<body>
  <header><h1>方案二 蒙特卡洛扫描可视化</h1></header>
  <main>
    <section><h2>扫描汇总</h2><div class="metrics">{summary_html}</div></section>
    <section><h2>聚合指标</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>故障率</th><th>备件倍数</th><th>保障容量</th><th>样本</th><th>失败</th><th>可用度</th><th>完成率</th><th>平均延误</th></tr></thead><tbody>{''.join(table_rows)}</tbody></table></div></section>
    <section>
      <h2>代表样本回放</h2>
      <div class="controls"><button id="prev">上一帧</button><button id="play">播放</button><button id="next">下一帧</button><input id="slider" type="range" min="0" max="0" value="0"><span id="time"></span></div>
      <div class="metrics" id="sceneMetrics"></div>
      <svg id="scene" viewBox="0 0 900 360"></svg>
    </section>
  </main>
  <script>
    const frames = {json.dumps(frames, ensure_ascii=False)};
    const colors = {json.dumps(PHASE_COLORS)};
    let index = 0;
    let timer = null;
    const slider = document.getElementById("slider");
    slider.max = String(Math.max(0, frames.length - 1));
    document.getElementById("prev").onclick = () => setFrame(Math.max(0, index - 1));
    document.getElementById("next").onclick = () => setFrame(Math.min(frames.length - 1, index + 1));
    document.getElementById("play").onclick = () => {{
      if (timer) {{ clearInterval(timer); timer = null; document.getElementById("play").textContent = "播放"; return; }}
      document.getElementById("play").textContent = "暂停";
      timer = setInterval(() => setFrame((index + 1) % Math.max(1, frames.length)), 450);
    }};
    slider.oninput = () => setFrame(Number(slider.value));
    function setFrame(nextIndex) {{ index = nextIndex; slider.value = String(index); if (frames.length) render(frames[index]); }}
    function render(frame) {{
      document.getElementById("time").textContent = frame.snapshot.timeLabel || "";
      document.getElementById("sceneMetrics").innerHTML = [
        ["就绪", frame.snapshot.readyAircraft],
        ["飞行中", frame.snapshot.flyingAircraft],
        ["保障中", frame.snapshot.supportAircraft],
        ["完成率", Math.round((frame.snapshot.completionRate || 0) * 100) + "%"]
      ].map(([k, v]) => `<div class="metric"><span>${{k}}</span><strong>${{v}}</strong></div>`).join("");
      const lanes = {{ idle: 70, ready: 70, preparing: 150, flying: 235, recovery: 150, maintenance: 300 }};
      const svg = document.getElementById("scene");
      svg.innerHTML = `<rect x="35" y="42" width="540" height="90" rx="8" fill="#dde7ee" stroke="#9fb3c8"></rect><text x="50" y="70" font-size="16" font-weight="700">航母甲板 / 任务就绪</text><rect x="35" y="135" width="540" height="60" rx="8" fill="#fff4db" stroke="#f59f00"></rect><text x="50" y="170" font-size="15">飞行前准备 / 回收检查</text><rect x="35" y="205" width="540" height="80" rx="8" fill="#dbeafe" stroke="#1c7ed6"></rect><text x="50" y="250" font-size="15">任务空域</text><rect x="35" y="295" width="540" height="45" rx="8" fill="#ffe8cc" stroke="#d9480f"></rect><text x="50" y="323" font-size="15">修复性维修</text>`;
      frame.aircraft.forEach((a, i) => {{
        const x = 135 + (i % 6) * 74;
        const y = lanes[a.phase] || 70;
        svg.insertAdjacentHTML("beforeend", `<circle cx="${{x}}" cy="${{y}}" r="24" fill="${{colors[a.phase] || "#627d98"}}" stroke="#102a43"></circle><text x="${{x}}" y="${{y + 4}}" text-anchor="middle" fill="white" font-size="11" font-weight="700">${{a.tailNumber}}</text>`);
      }});
    }}
    setFrame(0);
  </script>
</body>
</html>"""
