"""Standalone visual replay HTML generation for the GLM independent Mesa model.

Mirrors the GPT frame-replay approach but renders the GLM model's richer
``visualization_state`` (snapshot metrics, aircraft with equipment trees,
mission waves, support resources/spares/jobs, event log) on a single page
without tab switching.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from .model import IndependentMesaModel


PHASE_LABELS: dict[str, str] = {
    "idle": "甲板待命",
    "preparing": "飞行前准备",
    "ready": "任务就绪",
    "flying": "出动执行",
    "post_support": "回收保障",
    "maintenance": "修复性维修",
}

PHASE_COLORS: dict[str, str] = {
    "idle": "#8fa3ad",
    "preparing": "#f59f00",
    "ready": "#2f9e44",
    "flying": "#1c7ed6",
    "post_support": "#7950f2",
    "maintenance": "#d9480f",
}

# Vertical lane (Y) for each phase inside the SVG scene.
PHASE_LANES: dict[str, int] = {
    "idle": 70,
    "ready": 70,
    "preparing": 150,
    "flying": 235,
    "post_support": 150,
    "maintenance": 300,
}


def _time_label(minutes: float) -> str:
    total = int(round(minutes))
    day = total // 1440
    minute_of_day = total % 1440
    return f"D{day + 1} {minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


def export_frames(
    model: IndependentMesaModel,
    steps: int,
    sample_every: int,
) -> list[dict[str, Any]]:
    """Run ``model`` for ``steps`` ticks, sampling a frame every ``sample_every``."""
    frames = [model.visualization_state()]
    for step in range(1, steps + 1):
        model.step()
        if step % sample_every == 0 or step == steps:
            frames.append(model.visualization_state())
    return frames


def write_outputs(
    model: IndependentMesaModel,
    output_dir: Path,
    *,
    steps: int,
    sample_every: int,
) -> None:
    """Run the model and write frames.json, metrics.json and visualization.html."""
    output_dir.mkdir(parents=True, exist_ok=True)
    frames = export_frames(model, steps, sample_every)
    metrics = model.compute_final_metrics()
    (output_dir / "frames.json").write_text(
        json.dumps({"frames": frames}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "visualization.html").write_text(
        build_visualization_html(frames, metrics),
        encoding="utf-8",
    )


def build_visualization_html(
    frames: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> str:
    """Return a self-contained HTML document embedding ``frames`` for replay."""
    frames_json = json.dumps(frames, ensure_ascii=False)
    phase_labels_json = json.dumps(PHASE_LABELS)
    phase_colors_json = json.dumps(PHASE_COLORS)
    phase_lanes_json = json.dumps(PHASE_LANES)
    metrics_rows = "".join(
        f"<div class='metric'><span>{html.escape(label)}</span>"
        f"<strong>{html.escape(str(value))}</strong></div>"
        for label, value in [
            ("可用度", f"{round(metrics.get('availability', 0) * 100)}%"),
            ("出动架次率", f"{round(metrics.get('sortie_rate', 0), 2)}"),
            ("再次出动准备时间", f"{round(metrics.get('turnaround_time', 0), 1)} min"),
            ("备件满足率", f"{round(metrics.get('spare_fill_rate', 0) * 100)}%"),
            ("平均备件延误时间", f"{round(metrics.get('avg_spare_delay', 0), 1)} min"),
        ]
    )

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GLM Independent Mesa 可视化回放</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ padding: 14px 24px; background: #1d2730; color: white; display: flex; align-items: center; justify-content: space-between; }}
    h1 {{ margin: 0; font-size: 20px; }}
    h2 {{ margin: 0 0 10px; font-size: 15px; color: #243b53; }}
    main {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 320px); gap: 14px; padding: 14px; max-width: 1280px; margin: 0 auto; }}
    section {{ min-width: 0; background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; overflow: hidden; }}
    .controls {{ display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }}
    button {{ border: 1px solid #bcccdc; background: white; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }}
    button:hover {{ border-color: #627d98; }}
    input[type=range] {{ width: 100%; min-width: 160px; flex: 1 1 200px; accent-color: #1c7ed6; }}
    #time {{ font-variant-numeric: tabular-nums; color: #243b53; font-weight: 700; white-space: nowrap; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }}
    .metric {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; background: #f8fafc; }}
    .metric span {{ display: block; font-size: 11px; color: #627d98; }}
    .metric strong {{ display: block; font-size: 18px; color: #102a43; }}
    svg {{ width: 100%; height: auto; aspect-ratio: 900 / 380; border: 1px solid #d9e2ec; background: #eef6fb; border-radius: 8px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
    th, td {{ border-bottom: 1px solid #e4e7eb; padding: 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }}
    th {{ color: #627d98; background: #f0f4f8; }}
    .data-table {{ table-layout: fixed; }}
    .waves-table th:nth-child(1), .waves-table td:nth-child(1) {{ width: 40px; }}
    .waves-table th:nth-child(4), .waves-table td:nth-child(4) {{ width: 64px; }}
    .pill {{ display: inline-block; border-radius: 999px; padding: 2px 8px; margin: 1px; color: white; font-size: 11px; }}
    .status-scheduled {{ background: #8fa3ad; }}
    .status-preparing {{ background: #f59f00; }}
    .status-ready {{ background: #2f9e44; }}
    .status-flying {{ background: #1c7ed6; }}
    .status-recovery, .status-post_support {{ background: #7950f2; }}
    .status-completed {{ background: #2f9e44; }}
    .status-delayed {{ background: #e8590c; }}
    .status-cancelled {{ background: #c92a2a; }}
    .status-maintenance {{ background: #d9480f; }}
    .side {{ min-width: 0; display: flex; flex-direction: column; gap: 14px; }}
    .log {{ max-height: 220px; overflow: auto; font-size: 12px; line-height: 1.5; }}
    .log div {{ border-bottom: 1px solid #eef2f6; padding: 3px 0; }}
    .resource-card, .spare-card, .job-card {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; margin-bottom: 6px; background: #f8fafc; }}
    .resource-card strong, .spare-card strong, .job-card strong {{ display: block; font-size: 13px; color: #102a43; }}
    .resource-card span, .spare-card span, .job-card span {{ font-size: 11px; color: #627d98; }}
    .bar {{ height: 6px; margin-top: 4px; border-radius: 999px; background: #dbe3ec; overflow: hidden; }}
    .bar > i {{ display: block; height: 100%; background: #1c7ed6; }}
    .equip-row {{ font-size: 11px; color: #486581; padding: 1px 0 1px 10px; }}
    .equip-row.failed {{ color: #c92a2a; font-weight: 700; }}
    @media (max-width: 880px) {{ main {{ grid-template-columns: 1fr; }} .metrics {{ grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }} }}
    @media (max-width: 520px) {{ .metrics {{ grid-template-columns: repeat(2, 1fr); }} header {{ flex-direction: column; align-items: flex-start; gap: 6px; }} }}
  </style>
</head>
<body>
  <header>
    <h1>GLM Independent Mesa 可视化回放</h1>
    <span id="clock">D1 00:00</span>
  </header>
  <main>
    <section>
      <div class="controls">
        <button id="prev">上一帧</button>
        <button id="play">播放</button>
        <button id="next">下一帧</button>
        <input id="slider" type="range" min="0" max="0" value="0" />
        <span id="time">D1 00:00</span>
      </div>
      <div class="metrics" id="metrics"></div>
      <svg id="scene" viewBox="0 0 900 380" role="img" aria-label="aircraft mission scene"></svg>
      <h2 style="margin-top:14px;">任务波次</h2>
      <table id="waves" class="data-table waves-table"></table>
      <h2 style="margin-top:14px;">单机装备状态</h2>
      <div id="aircraftDetail"></div>
    </section>
    <div class="side">
      <section>
        <h2>保障资源</h2>
        <div id="resources"></div>
      </section>
      <section>
        <h2>备件库存</h2>
        <div id="spares"></div>
      </section>
      <section>
        <h2>当前作业</h2>
        <div id="jobs"></div>
      </section>
      <section>
        <h2>事件日志</h2>
        <div class="log" id="events"></div>
      </section>
      <section>
        <h2>最终指标</h2>
        <div class="metrics" style="grid-template-columns: repeat(2, 1fr);">{metrics_rows}</div>
      </section>
    </div>
  </main>
  <script>
    const frames = {frames_json};
    const phaseLabels = {phase_labels_json};
    const phaseColors = {phase_colors_json};
    const phaseLanes = {phase_lanes_json};
    let index = 0;
    let timer = null;
    const slider = document.getElementById("slider");
    slider.max = String(frames.length - 1);

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
      timer = setInterval(() => setFrame((index + 1) % frames.length), 450);
    }};
    slider.oninput = () => setFrame(Number(slider.value));

    function setFrame(nextIndex) {{
      index = nextIndex;
      slider.value = String(index);
      render(frames[index]);
    }}

    function render(frame) {{
      const snap = frame.snapshot;
      const tLabel = timeLabel(snap.time);
      document.getElementById("clock").textContent = tLabel;
      document.getElementById("time").textContent = tLabel;
      document.getElementById("metrics").innerHTML = [
        ["就绪", snap.ready_aircraft],
        ["飞行中", snap.flying_aircraft],
        ["保障中", countSupport(frame.aircraft)],
        ["维修中", snap.maintenance_aircraft],
        ["可用度", Math.round(snap.availability * 100) + "%"],
        ["出动架次率", (snap.sortie_rate || 0).toFixed(2)],
        ["再次出动准备", Math.round(snap.turnaround_time || 0) + " min"],
        ["备件满足率", Math.round(snap.spare_fill_rate * 100) + "%"],
        ["平均备件延误", Math.round(snap.avg_spare_delay || 0) + " min"],
        ["备件库存", snap.spare_stock_total]
      ].map(([label, value]) => `<div class="metric"><span>${{label}}</span><strong>${{value}}</strong></div>`).join("");
      renderScene(frame);
      renderWaves(frame);
      renderAircraftDetail(frame);
      renderResources(frame);
      renderSpares(frame);
      renderJobs(frame);
      renderEvents(frame);
    }}

    function countSupport(aircraft) {{
      return aircraft.filter(a => a.phase === "preparing" || a.phase === "post_support").length;
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
          <text x="640" y="${{y + 16}}" font-size="11">人员 ${{r.personnel_available}}/${{r.personnel_capacity}}  设备 ${{r.equipment_available}}/${{r.equipment_capacity}}</text>
          <text x="640" y="${{y + 32}}" font-size="11">利用率 ${{util}}%</text>
          <text x="640" y="${{y + 48}}" font-size="10" fill="#486581">${{inv}}</text>`);
      }});
    }}

    function renderWaves(frame) {{
      const rows = frame.missions.map(m => {{
        const start = m.actual_start != null ? timeLabel(m.actual_start) : "—";
        const ret = m.return_time != null ? timeLabel(m.return_time) : "—";
        const assigned = (m.assigned_tail_numbers || []).join(", ") || "未编组";
        return `<tr><td>${{m.wave_id}}</td><td>${{m.aircraft_type}}</td><td>${{timeLabel(m.planned_start)}} / ${{start}}</td><td><span class="pill status-${{m.status}}">${{m.status}}</span></td><td>${{m.required_aircraft}}</td><td>${{assigned}}</td></tr>`;
      }}).join("");
      document.getElementById("waves").innerHTML =
        "<tr><th>波次</th><th>机型</th><th>计划/实际起飞</th><th>状态</th><th>需求数</th><th>已分配</th></tr>" + (rows || "<tr><td colspan='6'>无任务波次</td></tr>");
    }}

    function renderAircraftDetail(frame) {{
      const cards = frame.aircraft.map(a => {{
        const equip = (a.equipment || []).map(sys => {{
          const kids = (sys.children || []).map(c => {{
            const cls = c.health === "failed" ? "equip-row failed" : "equip-row";
            return `<div class="${{cls}}">${{c.name}} / ${{c.health}} / 累计 ${{c.accumulated_hours}}h / 故障 ${{c.failure_count}}</div>`;
          }}).join("");
          const sysCls = sys.health === "failed" ? "equip-row failed" : "equip-row";
          return `<div class="${{sysCls}}"><b>${{sys.name}}</b> / ${{sys.health}}</div>${{kids}}`;
        }}).join("");
        const phaseLabel = phaseLabels[a.phase] || a.phase;
        return `<div class="job-card"><strong>${{a.tail_number}} / ${{a.type}}</strong><span>阶段：${{phaseLabel}} | 任务 ${{a.mission_id ?? "—"}} | 飞行 ${{a.flight_hours}}h | 起降 ${{a.landings}} | 故障 ${{a.failed_lru || "无"}}</span>${{equip}}</div>`;
      }}).join("");
      document.getElementById("aircraftDetail").innerHTML = cards || "<div class='job-card'><span>无飞机数据</span></div>";
    }}

    function renderResources(frame) {{
      const cards = frame.resources.map(r => {{
        const pers = r.personnel_available / Math.max(r.personnel_capacity, 1);
        const util = Math.round((r.utilization || 0) * 100);
        return `<div class="resource-card"><strong>${{r.name}}</strong><span>人员 ${{r.personnel_available}}/${{r.personnel_capacity}} · 设备 ${{r.equipment_available}}/${{r.equipment_capacity}} · 利用率 ${{util}}%</span><div class="bar"><i style="width:${{Math.round(pers * 100)}}%"></i></div></div>`;
      }}).join("");
      document.getElementById("resources").innerHTML = cards || "<div class='resource-card'><span>无保障节点</span></div>";
    }}

    function renderSpares(frame) {{
      const cards = frame.spares.map(s => {{
        const inv = Object.entries(s.inventory).map(([k, v]) => `<span>${{k}}: ${{v}}</span>`).join(" · ");
        return `<div class="spare-card"><strong>${{s.node_id}}</strong>${{inv || "<span>无库存</span>"}}</div>`;
      }}).join("");
      document.getElementById("spares").innerHTML = cards || "<div class='spare-card'><span>无备件数据</span></div>";
    }}

    function renderJobs(frame) {{
      const cards = frame.jobs.map(j => {{
        return `<div class="job-card"><strong>${{j.aircraft_tail}} / ${{j.activity_id}}</strong><span>状态 ${{j.state}} · 当前 ${{j.current_task || "—"}} · 剩余 ${{Math.ceil(j.remaining)}} min</span></div>`;
      }}).join("");
      document.getElementById("jobs").innerHTML = cards || "<div class='job-card'><span>无等待作业</span></div>";
    }}

    function renderEvents(frame) {{
      const items = (frame.events || []).slice().reverse().map(e => {{
        const t = timeLabel(e.time);
        return `<div><b>${{t}}</b> [${{e.event}}] ${{e.message}}</div>`;
      }}).join("");
      document.getElementById("events").innerHTML = items || "<div>暂无事件</div>";
    }}

    setFrame(0);
  </script>
</body>
</html>
"""
