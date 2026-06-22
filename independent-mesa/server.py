#!/usr/bin/env python3
"""Unified local backend for the two independent Mesa schemes."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import html
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
PYTHON = sys.executable

SCHEMES = {
    "scheme1": {
        "label": "方案一",
        "root": ROOT / "GLM",
        "single": ["run_single.py", "--steps", "48", "--sample-every", "4"],
        "sweep": ["run_sweep.py", "--steps", "48", "--samples", "12"],
        "single_html": ROOT / "GLM" / "output" / "single-run" / "visualization.html",
        "sweep_html": ROOT / "GLM" / "output" / "sweep" / "monte_carlo.html",
    },
    "scheme2": {
        "label": "方案二",
        "root": ROOT / "GPT",
        "single": ["run_single.py", "--steps", "104", "--sample-every", "1"],
        "sweep": ["run_sweep.py", "--steps", "104", "--samples", "8"],
        "single_html": ROOT / "GPT" / "output" / "single-run" / "visualization.html",
        "sweep_html": ROOT / "GPT" / "output" / "sweep" / "monte_carlo.html",
    },
}

ANALYSES = {
    "spare_shortfall": "备件短板分析",
    "carry_list": "飞机转场携行清单分析",
    "mission_reliability": "任务可靠度评估",
    "downtime_factors": "停机因素分析",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        path = unquote(self.path.split("?", 1)[0])
        if path in {"/", "/index.html"}:
            self._send_html(index_html())
            return
        if path.startswith("/run/"):
            self._handle_run(path)
            return
        super().do_GET()

    def _handle_run(self, path: str) -> None:
        parts = [part for part in path.split("/") if part]
        if len(parts) < 3:
            self.send_error(404)
            return
        _, scheme_id, action = parts[:3]
        scheme = SCHEMES.get(scheme_id)
        if not scheme:
            self.send_error(404)
            return
        try:
            if action == "single":
                html_path = _run_command(scheme, scheme["single"], scheme["single_html"])
            elif action == "sweep":
                html_path = _run_command(scheme, scheme["sweep"], scheme["sweep_html"])
            elif action == "analysis" and len(parts) == 4 and parts[3] in ANALYSES:
                analysis_type = parts[3]
                html_path = _run_command(
                    scheme,
                    ["run_analysis.py", "--type", analysis_type, "--samples", "6"],
                    scheme["root"] / "output" / "analyses" / f"{analysis_type}.html",
                )
            else:
                self.send_error(404)
                return
        except subprocess.CalledProcessError as exc:
            detail = (exc.stdout or "") + "\n" + (exc.stderr or "")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(detail.encode("utf-8", errors="replace"))
            return
        rel = html_path.relative_to(ROOT).as_posix()
        self.send_response(302)
        self.send_header("Location", "/" + rel)
        self.end_headers()

    def _send_html(self, content: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content.encode("utf-8"))


def _run_command(scheme: dict[str, object], args: list[str], html_path: Path) -> Path:
    subprocess.run(
        [PYTHON, *args],
        cwd=scheme["root"],
        check=True,
        text=True,
        capture_output=True,
    )
    return html_path


def index_html() -> str:
    scheme_cards = []
    for scheme_id, scheme in SCHEMES.items():
        analyses = "".join(
            f"<form method='get' action='/run/{scheme_id}/analysis/{key}'><button class='analysis-button' type='submit'>启动{html.escape(label)}</button></form>"
            for key, label in ANALYSES.items()
        )
        scheme_cards.append(
            f"""
            <section>
              <h2>{html.escape(str(scheme['label']))}</h2>
              <div class="actions">
                <form method="get" action="/run/{scheme_id}/single"><button type="submit">启动可视化仿真</button></form>
                <form method="get" action="/run/{scheme_id}/sweep"><button type="submit">启动蒙特卡洛实验</button></form>
              </div>
              <h3>四个分析实验（点击按钮生成并打开结果页）</h3>
              <div class="grid">{analyses}</div>
            </section>
            """
        )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>独立仿真统一后台</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ background: #1d2730; color: white; padding: 18px 24px; }}
    h1 {{ margin: 0; font-size: 22px; }}
    main {{ max-width: 1120px; margin: 0 auto; padding: 18px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }}
    section {{ background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 16px; }}
    h2 {{ margin: 0 0 14px; font-size: 20px; }}
    h3 {{ margin: 18px 0 10px; font-size: 14px; color: #52606d; }}
    .actions, .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }}
    form {{ margin: 0; }}
    button {{ display: block; width: 100%; border: 1px solid #1c7ed6; border-radius: 6px; padding: 10px 12px; background: #1c7ed6; color: white; text-align: center; font: inherit; font-weight: 700; cursor: pointer; min-height: 44px; }}
    button:hover {{ background: #1864ab; border-color: #1864ab; }}
    button.analysis-button {{ color: #102a43; border-color: #15aabf; background: #e3fafc; font-weight: 700; }}
    button.analysis-button:hover {{ border-color: #0b7285; background: #c5f6fa; }}
    a {{ display: block; text-decoration: none; color: #102a43; border: 1px solid #bcccdc; border-radius: 6px; padding: 10px 12px; background: #f8fafc; text-align: center; }}
    a:hover {{ border-color: #1c7ed6; background: #e7f5ff; }}
    @media (max-width: 760px) {{ main {{ grid-template-columns: 1fr; }} .actions, .grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header><h1>独立仿真统一后台</h1></header>
  <main>{''.join(scheme_cards)}</main>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    host = args.host
    port = args.port
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"open http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
