"""Frame export and standalone visual replay generation."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from .model import VisualMissionModel
from .scenario_loader import scenario_summary


PHASE_COLORS = {
    "idle": "#8fa3ad",
    "ready": "#2f9e44",
    "preparing": "#f59f00",
    "flying": "#1c7ed6",
    "recovery": "#7950f2",
    "maintenance": "#d9480f",
}


def export_frames(model: VisualMissionModel, steps: int, sample_every: int) -> list[dict[str, Any]]:
    frames = [model.visualization_state()]
    for step in range(1, steps + 1):
        model.step()
        if step % sample_every == 0 or step == steps:
            frames.append(model.visualization_state())
    return frames


def write_outputs(
    model: VisualMissionModel,
    package: dict[str, Any],
    input_changes: list[dict[str, Any]],
    output_dir: Path,
    *,
    steps: int,
    sample_every: int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    frames = export_frames(model, steps, sample_every)
    report = model.final_report()
    (output_dir / "frames.json").write_text(
        json.dumps({"frames": frames}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "input_changes.json").write_text(
        json.dumps({"changes": input_changes}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "scenario_summary.json").write_text(
        json.dumps(scenario_summary(package), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "visualization.html").write_text(
        build_visualization_html(frames, report, input_changes),
        encoding="utf-8",
    )


def build_visualization_html(
    frames: list[dict[str, Any]],
    report: dict[str, Any],
    input_changes: list[dict[str, Any]],
) -> str:
    frames_json = json.dumps(frames, ensure_ascii=False)
    changes_rows = "\n".join(
        f"<tr><td class='field-path'>{html.escape(change['path'])}</td>"
        f"<td class='value-cell'>{html.escape(str(change['to']))}</td></tr>"
        for change in input_changes
    )
    timeline_rows = []
    for tail, events in report["aircraftTimelines"].items():
        cells = "".join(
            f"<span class='pill' data-phase='{html.escape(event['phase'])}'>{html.escape(event['label'])} "
            f"{html.escape(event['phaseLabel'])}</span>"
            for event in events
        )
        timeline_rows.append(f"<tr><th>{html.escape(tail)}</th><td>{cells}</td></tr>")
    timeline_html = "\n".join(timeline_rows)

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>方案二 Independent Mesa 可视化回放</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ padding: 18px 24px; background: #1d2730; color: white; }}
    main {{ display: grid; grid-template-columns: minmax(620px, 1fr) minmax(420px, 24vw); gap: 16px; padding: 16px; }}
    section {{ min-width: 0; background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; overflow: hidden; }}
    h1 {{ margin: 0; font-size: 22px; }}
    h2 {{ margin: 0 0 10px; font-size: 16px; }}
    .controls {{ display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }}
    button {{ border: 1px solid #bcccdc; background: white; border-radius: 6px; padding: 6px 10px; cursor: pointer; }}
    input[type=range] {{ width: 260px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }}
    .metric {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; }}
    .metric strong {{ display: block; font-size: 18px; }}
    svg {{ width: 100%; height: 360px; border: 1px solid #d9e2ec; background: #eef6fb; border-radius: 8px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
    th, td {{ border-bottom: 1px solid #e4e7eb; padding: 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }}
    .data-table {{ table-layout: fixed; }}
    .waves-table th:nth-child(1), .waves-table td:nth-child(1) {{ width: 34px; }}
    .waves-table th:nth-child(2), .waves-table td:nth-child(2) {{ width: 30%; }}
    .waves-table th:nth-child(3), .waves-table td:nth-child(3) {{ width: 72px; }}
    .field-path {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #334e68; line-height: 1.35; }}
    .value-cell {{ width: 54px; white-space: nowrap; color: #102a43; font-weight: 700; }}
    .change-table col:nth-child(1) {{ width: auto; }}
    .change-table col:nth-child(2) {{ width: 112px; }}
    .timeline-table th {{ width: 64px; }}
    .pill {{ display: inline-block; border-radius: 999px; padding: 3px 7px; margin: 2px; color: white; background: #627d98; }}
    .log {{ max-height: 240px; overflow: auto; font-size: 12px; }}
    .side {{ min-width: 0; display: flex; flex-direction: column; gap: 16px; }}
    [data-phase=idle] {{ background: #8fa3ad; }}
    [data-phase=ready] {{ background: #2f9e44; }}
    [data-phase=preparing] {{ background: #f59f00; }}
    [data-phase=flying] {{ background: #1c7ed6; }}
    [data-phase=recovery] {{ background: #7950f2; }}
    [data-phase=maintenance] {{ background: #d9480f; }}
    @media (max-width: 900px) {{ main {{ grid-template-columns: 1fr; }} .metrics {{ grid-template-columns: repeat(2, 1fr); }} }}
  </style>
</head>
<body>
  <header>
    <h1>方案二 Independent Mesa 可视化回放</h1>
  </header>
  <main>
    <section>
      <div class="controls">
        <button id="prev">上一帧</button>
        <button id="play">播放</button>
        <button id="next">下一帧</button>
        <input id="slider" type="range" min="0" max="0" value="0" />
        <span id="time"></span>
      </div>
      <div class="metrics" id="metrics"></div>
      <svg id="scene" viewBox="0 0 900 360" role="img" aria-label="aircraft mission scene"></svg>
      <h2>飞机任务执行时间线</h2>
      <table class="data-table timeline-table"><tbody>{timeline_html}</tbody></table>
    </section>
    <div class="side">
      <section>
        <h2>任务波次</h2>
        <table id="waves" class="data-table waves-table"></table>
      </section>
      <section>
        <h2>事件日志</h2>
        <div class="log" id="events"></div>
      </section>
      <section>
        <h2>输入数据表</h2>
        <table class="data-table change-table">
          <colgroup><col /><col /></colgroup>
          <thead><tr><th>输入参数名</th><th>修订后的值</th></tr></thead>
          <tbody>{changes_rows}</tbody>
        </table>
      </section>
    </div>
  </main>
  <script>
    const frames = {frames_json};
    const colors = {json.dumps(PHASE_COLORS)};
    let index = 0;
    let timer = null;
    const slider = document.getElementById("slider");
    slider.max = String(frames.length - 1);
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
      document.getElementById("time").textContent = frame.snapshot.timeLabel;
      document.getElementById("metrics").innerHTML = [
        ["就绪", frame.snapshot.readyAircraft],
        ["飞行中", frame.snapshot.flyingAircraft],
        ["保障中", frame.snapshot.supportAircraft],
        ["完成率", Math.round(frame.snapshot.completionRate * 100) + "%"]
      ].map(([label, value]) => `<div class="metric">${{label}}<strong>${{value}}</strong></div>`).join("");
      renderScene(frame);
      document.getElementById("waves").innerHTML = "<tr><th>波次</th><th>任务</th><th>状态</th><th>飞机</th></tr>" +
        frame.waves.map(w => `<tr><td>${{w.waveId}}</td><td>${{w.name}}</td><td>${{w.status}}</td><td>${{w.assigned.join(", ")}}</td></tr>`).join("");
      document.getElementById("events").innerHTML = frame.events.map(e => `<div><b>${{e.timeLabel}}</b> ${{e.message}}</div>`).join("");
    }}

    function renderScene(frame) {{
      const svg = document.getElementById("scene");
      const lanes = {{ idle: 70, ready: 70, preparing: 150, flying: 235, recovery: 150, maintenance: 300 }};
      const xBase = {{ "J-15": 150, "J-35": 420 }};
      svg.innerHTML = `
        <rect x="35" y="42" width="540" height="90" rx="8" fill="#dde7ee" stroke="#9fb3c8"></rect>
        <text x="50" y="70" font-size="16" font-weight="700">航母甲板 / 任务就绪</text>
        <rect x="35" y="135" width="540" height="60" rx="8" fill="#fff4db" stroke="#f59f00"></rect>
        <text x="50" y="170" font-size="15">飞行前准备 / 回收检查</text>
        <rect x="35" y="205" width="540" height="80" rx="8" fill="#dbeafe" stroke="#1c7ed6"></rect>
        <text x="50" y="250" font-size="15">任务空域</text>
        <rect x="35" y="295" width="540" height="45" rx="8" fill="#ffe8cc" stroke="#d9480f"></rect>
        <text x="50" y="323" font-size="15">修复性维修</text>
        <rect x="630" y="42" width="220" height="298" rx="8" fill="#f8fafc" stroke="#bcccdc"></rect>
        <text x="650" y="70" font-size="16" font-weight="700">保障资源 / 库存</text>
      `;
      frame.aircraft.forEach((a, i) => {{
        const typeOffset = xBase[a.type] || 240;
        const x = typeOffset + (i % 3) * 74;
        const y = lanes[a.phase] || 70;
        const color = colors[a.phase] || "#627d98";
        svg.insertAdjacentHTML("beforeend", `
          <g>
            <circle cx="${{x}}" cy="${{y}}" r="24" fill="${{color}}" stroke="#102a43" stroke-width="1.5"></circle>
            <text x="${{x}}" y="${{y - 3}}" text-anchor="middle" fill="white" font-size="11" font-weight="700">${{a.tailNumber}}</text>
            <text x="${{x}}" y="${{y + 12}}" text-anchor="middle" fill="white" font-size="10">${{a.phaseLabel}}</text>
          </g>`);
      }});
      frame.resources.forEach((r, i) => {{
        const y = 100 + i * 72;
        const inv = Object.entries(r.inventory).map(([k, v]) => `${{k}}:${{v}}`).join(" / ");
        svg.insertAdjacentHTML("beforeend", `
          <text x="650" y="${{y}}" font-size="13" font-weight="700">${{r.name}}</text>
          <text x="650" y="${{y + 20}}" font-size="12">容量 ${{r.capacity}} 人员 ${{r.personnelCapacity}}</text>
          <text x="650" y="${{y + 40}}" font-size="11">${{inv}}</text>`);
      }});
    }}
    setFrame(0);
  </script>
</body>
</html>
"""
