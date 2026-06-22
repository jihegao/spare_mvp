"""Shared static analysis builders for the independent Mesa variants."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import html
import json
import math
from pathlib import Path
import statistics
from typing import Any, Callable


ModelFactory = Callable[[dict[str, Any], int], Any]
MetricsExtractor = Callable[[Any], dict[str, Any]]


@dataclass(frozen=True)
class AnalysisRuntime:
    scheme_label: str
    data_source: str
    package: dict[str, Any]
    model_factory: ModelFactory
    metrics_extractor: MetricsExtractor
    output_dir: Path
    seed: int = 20260621


ANALYSES = {
    "spare_shortfall": "备件短板分析",
    "carry_list": "飞机转场携行清单分析",
    "mission_reliability": "任务可靠度评估",
    "downtime_factors": "停机因素分析",
}


def run_analysis(runtime: AnalysisRuntime, analysis_type: str, samples: int | None = None) -> dict[str, Path]:
    if analysis_type not in ANALYSES:
        raise ValueError(f"unsupported analysis type: {analysis_type}")
    payload = _build_payload(runtime, analysis_type, samples=samples)
    runtime.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = runtime.output_dir / f"{analysis_type}.json"
    html_path = runtime.output_dir / f"{analysis_type}.html"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    html_path.write_text(build_analysis_html(payload), encoding="utf-8")
    return {"json": json_path, "html": html_path}


def _build_payload(runtime: AnalysisRuntime, analysis_type: str, samples: int | None) -> dict[str, Any]:
    builders = {
        "spare_shortfall": _spare_shortfall,
        "carry_list": _carry_list,
        "mission_reliability": _mission_reliability,
        "downtime_factors": _downtime_factors,
    }
    result = builders[analysis_type](runtime, samples)
    result["presentation"] = _presentation_model(runtime, analysis_type, result)
    result["evidence"] = _evidence_scope(runtime, result)
    return {
        "analysis_type": analysis_type,
        "title": ANALYSES[analysis_type],
        "scheme_label": runtime.scheme_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": runtime.data_source,
        **result,
    }


def _run_samples(
    runtime: AnalysisRuntime,
    *,
    samples: int,
    steps: int,
    mutator: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for idx in range(samples):
        package = copy.deepcopy(runtime.package)
        if mutator:
            mutator(package)
        model = runtime.model_factory(package, runtime.seed + idx)
        for _ in range(steps):
            model.step()
        reports.append(runtime.metrics_extractor(model))
    return reports


def _spare_shortfall(runtime: AnalysisRuntime, samples: int | None) -> dict[str, Any]:
    n = samples or 12
    steps = 48
    multiplier = 1.0

    def mutate(package: dict[str, Any]) -> None:
        for resource in package.get("objects", {}).get("supportResources", []):
            inv = resource.get("inventory")
            if isinstance(inv, dict):
                for key, value in list(inv.items()):
                    if isinstance(value, (int, float)):
                        inv[key] = max(0, int(round(value * multiplier)))

    reports = _run_samples(runtime, samples=n, steps=steps, mutator=mutate)
    spare_types = sorted(_inventory(runtime.package).keys() or _spare_types(runtime.package))
    rows: list[dict[str, Any]] = []
    for spare_type in spare_types:
        start = _inventory(runtime.package).get(spare_type, 0.0)
        shortages = sum(_count_events(r, "shortage", spare_type) for r in reports)
        consumed = [_inventory_delta(r, spare_type) for r in reports]
        shortage_probability = min(1.0, shortages / max(n, 1))
        fill_rate = 1.0 - shortage_probability
        if shortage_probability >= 0.20:
            risk = "严重"
        elif shortage_probability > 0.01:
            risk = "短缺"
        else:
            risk = "关注"
        rows.append(
            {
                "spare_type": spare_type,
                "base_stock": round(start, 2),
                "avg_consumed": round(statistics.mean(consumed), 2) if consumed else 0,
                "shortage_events": shortages,
                "fill_rate": round(fill_rate, 3),
                "shortage_probability": round(shortage_probability, 3),
                "risk_level": risk,
            }
        )
    rows.sort(key=lambda item: (-item["shortage_probability"], item["spare_type"]))
    risky = [r for r in rows if r["risk_level"] != "关注"]
    aircraft_metrics = _aircraft_shortfall_rows(reports, rows)
    rms_metrics = _rms_shortfall_metrics(rows, aircraft_metrics)
    event_timeline = _spare_shortfall_event_timeline(reports, rows, aircraft_metrics)
    event_stats = _spare_shortfall_event_stats(reports, rows)
    sample_distribution = {
        "title": "输出指标样本分布",
        "metric": "备件满足率",
        "unit": "%",
        "values": [{"label": str(row.get("spare_type", f"S{idx + 1}")), "value": float(row.get("fill_rate") or 0)} for idx, row in enumerate(rows)],
    }
    return {
        "config": {"samples": n, "mission_steps": steps, "spare_multiplier": multiplier},
        "metrics": [
            ["短板备件数", str(len(risky))],
            ["最低满足率", _pct(min((r["fill_rate"] for r in rows), default=1.0))],
            ["最高短缺概率", _pct(max((r["shortage_probability"] for r in rows), default=0.0))],
            ["建议优先补充", "、".join(r["spare_type"] for r in rows[:2]) or "无"],
        ],
        "columns": ["spare_type", "base_stock", "avg_consumed", "shortage_events", "fill_rate", "shortage_probability", "risk_level"],
        "rows": rows,
        "aircraft_metrics": aircraft_metrics,
        "rms_metrics": rms_metrics,
        "event_timeline": event_timeline,
        "event_stats": event_stats,
        "sample_distribution": sample_distribution,
        "logic": ["按样本运行任务节奏。", "统计备件短缺事件和库存消耗。", "短缺概率超过 20% 判为严重，超过 1% 判为短缺。"],
    }


def _carry_list(runtime: AnalysisRuntime, samples: int | None) -> dict[str, Any]:
    transit_hours = 4
    aircraft_count = 2
    target_p = 0.95
    rows = []
    for asset in runtime.package.get("objects", {}).get("equipmentAssets", []):
        spare_type = str(asset.get("spareType") or asset.get("id") or "")
        if not spare_type:
            continue
        failure_rate = float(asset.get("failureRate") or 0)
        lam = max(0.0, failure_rate * transit_hours * aircraft_count)
        qty = _poisson_min_k(lam, target_p)
        conn = str(asset.get("connectionType") or asset.get("connection") or "")
        priority = "高" if "串" in conn or "series" in conn.lower() else "中" if conn else "低"
        rows.append(
            {
                "spare_type": spare_type,
                "failure_rate": round(failure_rate, 5),
                "lambda": round(lam, 4),
                "qty": qty,
                "multiplier": round(qty / max(1, round(lam)), 2),
                "priority": priority,
                "target_success_probability": target_p,
            }
        )
    rows.sort(key=lambda item: (-item["qty"], item["spare_type"]))
    aircraft_metrics = _aircraft_config_rows(runtime.package, transit_hours, rows)
    rms_metrics = _carry_rms_metrics(rows, target_p, aircraft_metrics)
    event_stats = _carry_list_event_stats(rows, transit_hours, aircraft_count, target_p)
    sample_distribution = {
        "title": "输出指标样本分布",
        "metric": "推荐携行量",
        "unit": "件",
        "values": [{"label": str(row.get("spare_type", f"S{idx + 1}")), "value": float(row.get("qty") or 0)} for idx, row in enumerate(rows)],
    }
    return {
        "config": {"transit_hours": transit_hours, "transit_aircraft_count": aircraft_count, "target_success_probability": target_p},
        "metrics": [
            ["总携行件数", str(sum(r["qty"] for r in rows))],
            ["最高倍率", str(max((r["multiplier"] for r in rows), default=0))],
            ["高优先级备件", "、".join(r["spare_type"] for r in rows if r["priority"] == "高")[:60] or "无"],
            ["优化条件", f"{aircraft_count} 架 / {transit_hours} 小时 / {_pct(target_p)}"],
        ],
        "columns": ["spare_type", "failure_rate", "lambda", "qty", "multiplier", "priority", "target_success_probability"],
        "rows": rows,
        "aircraft_metrics": aircraft_metrics,
        "rms_metrics": rms_metrics,
        "event_stats": event_stats,
        "sample_distribution": sample_distribution,
        "logic": ["按 Poisson 需求模型估算转场期间需求。", "寻找满足 P(X<=K) 不低于目标概率的最小 K。", "串联系统相关备件优先级更高。"],
    }


def _mission_reliability(runtime: AnalysisRuntime, samples: int | None) -> dict[str, Any]:
    n = samples or 8
    duration = 24
    target = 0.95
    steps = max(1, duration * 2)
    reports = _run_samples(runtime, samples=n, steps=steps)
    sortie_rates = [_report_number(r, "sortie_rate", "launchRate", "sortie_completion_rate", "completionRate") for r in reports]
    sim_sortie_rate = statistics.mean(sortie_rates) if sortie_rates else 0.0
    blocks = _rbd_nodes(runtime.package)
    rows = []
    component_rs = []
    for node in blocks:
        rate = float(node.get("failureRate") or 0)
        rel = math.exp(-rate * duration) if rate > 0 else 1.0
        component_rs.append(rel)
        rows.append(
            {
                "name": str(node.get("name") or node.get("id")),
                "connection_type": str(node.get("connectionType") or ""),
                "failure_rate": round(rate, 5),
                "mtbf_hours": round(1 / rate, 2) if rate > 0 else "∞",
                "reliability_at_dt": round(rel, 4),
            }
        )
    system_r = math.prod(component_rs) if component_rs else 1.0
    probability = system_r * sim_sortie_rate
    state = "满足" if probability >= target else "风险" if probability < 0.70 else "关注"
    aircraft_metrics = _aircraft_shortfall_rows(reports, [])
    rms_metrics = {
        "reliability_index": max(0.0, min(1.0, system_r)),
        "maintainability_index": max(0.0, min(1.0, sim_sortie_rate)),
        "supportability_index": max(0.0, min(1.0, probability / max(target, 0.01))),
    }
    trend_rows = []
    for index, hours in enumerate([12, 24, 48], start=1):
        duration_rs = [
            math.exp(-float(node.get("failureRate") or 0) * hours) if float(node.get("failureRate") or 0) > 0 else 1.0
            for node in blocks
        ]
        duration_system_r = math.prod(duration_rs) if duration_rs else 1.0
        duration_probability = duration_system_r * sim_sortie_rate
        trend_rows.append(
            {
                "wave": f"{hours}h",
                "probability": round(duration_probability, 4),
                "sorties": round(sim_sortie_rate * 100),
                "available": round(duration_system_r * 100),
                "state": "满足" if duration_probability >= target else "风险" if duration_probability < 0.70 else "关注",
            }
        )
    event_stats = _mission_reliability_event_stats(reports, rows, trend_rows, probability, target)
    sample_distribution = {
        "title": "输出指标样本分布",
        "metric": "出动架次率",
        "unit": "%",
        "values": [
            {"label": f"S{idx + 1}", "value": _report_number(report, "sortie_rate", "launchRate", "sortie_completion_rate", "completionRate")}
            for idx, report in enumerate(reports)
        ],
    }
    return {
        "config": {"mission_duration_hours": duration, "target_reliability": target, "samples": n},
        "metrics": [
            ["任务成功概率", _pct(probability)],
            ["出动架次率", _pct(sim_sortie_rate)],
            ["系统可靠度", _pct(system_r)],
            ["目标达成", state],
        ],
        "columns": ["name", "connection_type", "failure_rate", "mtbf_hours", "reliability_at_dt"],
        "rows": rows,
        "projection_rows": trend_rows,
        "aircraft_metrics": aircraft_metrics,
        "rms_metrics": rms_metrics,
        "event_stats": event_stats,
        "sample_distribution": sample_distribution,
        "logic": ["单部件可靠度 R=e^(-lambda t)。", "当前独立页以保守串联系统合成系统可靠度。", "任务成功概率=系统可靠度×仿真出动架次率。"],
    }


def _downtime_factors(runtime: AnalysisRuntime, samples: int | None) -> dict[str, Any]:
    n = samples or 10
    steps = 48
    reports = _run_samples(runtime, samples=n, steps=steps)
    counts = {
        "装备故障": sum(_count_events(r, "failure") + _count_events(r, "maintenance") for r in reports),
        "备件短缺": sum(_count_events(r, "shortage") + _count_events(r, "spare") for r in reports),
        "资源延误": sum(_count_events(r, "delay") for r in reports),
        "计划延误": sum(_count_events(r, "cancel") + _count_events(r, "delayed") for r in reports),
    }
    total = max(sum(counts.values()), 1)
    rows = [
        {
            "factor": key,
            "count": value,
            "contribution": round(value / total, 3),
            "contribution_label": _pct(value / total),
            "total_downtime_minutes": int(value * 30),
        }
        for key, value in counts.items()
    ]
    rows.sort(key=lambda item: -item["count"])
    aircraft_metrics = _aircraft_shortfall_rows(reports, [])
    rms_metrics = _downtime_rms_metrics(rows, aircraft_metrics)
    event_stats = _downtime_event_stats(reports, rows)
    sample_distribution = {
        "title": "输出指标样本分布",
        "metric": "保障占用飞机数",
        "unit": "架",
        "values": [
            {
                "label": f"S{idx + 1}",
                "value": _report_number(report, "support_aircraft", "supportAircraft"),
            }
            for idx, report in enumerate(reports)
        ],
    }
    return {
        "config": {"samples": n, "mission_steps": steps, "resource_delay_threshold_minutes": 30, "schedule_delay_threshold_minutes": 20},
        "metrics": [
            ["停机因素总次数", str(sum(counts.values()))],
            ["首要因素", rows[0]["factor"] if rows else "无"],
            ["次要因素", rows[1]["factor"] if len(rows) > 1 else "无"],
            ["总停机时长", f"{sum(r['total_downtime_minutes'] for r in rows)} min"],
        ],
        "columns": ["factor", "count", "contribution", "contribution_label", "total_downtime_minutes"],
        "rows": rows,
        "aircraft_metrics": aircraft_metrics,
        "rms_metrics": rms_metrics,
        "event_stats": event_stats,
        "sample_distribution": sample_distribution,
        "logic": ["从事件日志归因到装备故障、备件短缺、资源延误、计划延误。", "贡献占比=该类次数/总次数。", "停机时长以 30 分钟 tick 作为保守估算。"],
    }


def build_analysis_html(payload: dict[str, Any]) -> str:
    rows = payload.get("rows", [])
    columns = payload.get("columns", [])
    metrics = payload.get("metrics", [])
    body_html = (
        _scheme_one_original_body(payload)
        if payload.get("scheme_label") == "方案一"
        else _scheme_two_scientific_body(payload)
        if payload.get("scheme_label") == "方案二"
        else ""
    )
    bars = "" if body_html else _bar_svg(rows[:12], columns[0] if columns else "name")
    metrics_html = "".join(
        f"<div class='metric'><span>{html.escape(str(label))}</span><strong>{html.escape(str(value))}</strong></div>"
        for label, value in metrics
    )
    table_html = "".join(
        "<tr>" + "".join(f"<td>{html.escape(str(row.get(col, '')))}</td>" for col in columns) + "</tr>"
        for row in rows
    )
    logic_html = "".join(f"<li>{html.escape(str(item))}</li>" for item in payload.get("logic", []))
    config_html = _config_controls_html(payload)
    perspective_html = "" if payload.get("scheme_label") == "方案二" else _perspective_html(payload.get("presentation", {}))
    launch_path = _launch_path(payload)
    launch_button = (
        f"<form class='launch-form' method='get' action='{html.escape(launch_path)}'>"
        f"<button class='launch-button' type='submit'>启动{html.escape(str(payload['title']))}</button>"
        "</form>"
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(payload['scheme_label'])} {html.escape(payload['title'])}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fa; }}
    header {{ padding: 16px 24px; background: #1d2730; color: white; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }}
    h1 {{ margin: 0; font-size: 21px; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 16px; display: grid; grid-template-columns: 260px 1fr; gap: 14px; }}
    section, aside {{ background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; min-width: 0; }}
    h2 {{ margin: 0 0 10px; font-size: 16px; color: #243b53; }}
    label {{ display: block; font-size: 12px; color: #52606d; margin-bottom: 10px; }}
    input, select {{ width: 100%; margin-top: 4px; border: 1px solid #bcccdc; border-radius: 6px; padding: 7px; background: #f8fafc; color: #102a43; }}
    input[type="range"] {{ padding: 0; border: 0; background: transparent; accent-color: #1c7ed6; }}
    .config-control {{ border: 1px solid #e4e7eb; border-radius: 8px; padding: 9px; margin-bottom: 10px; background: #fbfcfe; }}
    .config-control label {{ margin: 0; }}
    .config-control strong {{ display: block; margin-bottom: 4px; color: #102a43; font-size: 13px; }}
    .config-control span {{ display: block; margin-top: 5px; color: #52606d; font-size: 11px; line-height: 1.35; }}
    .range-row {{ display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }}
    .range-value {{ min-width: 52px; padding: 4px 6px; border-radius: 6px; background: #e7f5ff; color: #0b7285; text-align: center; font-weight: 800; }}
    .point-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }}
    .point-grid label {{ font-size: 11px; }}
    .point-grid input {{ padding: 6px; }}
    .launch-form {{ margin: 0; }}
    .launch-button {{ border: 1px solid #15aabf; border-radius: 6px; padding: 10px 14px; background: #e3fafc; color: #102a43; font: inherit; font-weight: 800; cursor: pointer; min-height: 42px; }}
    .launch-button:hover {{ border-color: #0b7285; background: #c5f6fa; }}
    aside .launch-form {{ margin-bottom: 12px; }}
    aside .launch-button {{ width: 100%; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 14px; }}
    .metric {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 9px; background: #f8fafc; }}
    .metric span {{ display: block; font-size: 12px; color: #627d98; }}
    .metric strong {{ display: block; font-size: 18px; color: #102a43; overflow-wrap: anywhere; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
    th, td {{ border-bottom: 1px solid #e4e7eb; padding: 7px; text-align: left; overflow-wrap: anywhere; }}
    th {{ background: #f0f4f8; color: #52606d; }}
    .table-wrap {{ overflow-x: auto; }}
    svg {{ width: 100%; height: auto; border: 1px solid #e4e7eb; border-radius: 6px; background: #fbfcfe; }}
    .perspective {{ margin: 14px 0; border: 1px solid #d9e2ec; border-radius: 8px; padding: 12px; background: #fbfcfe; }}
    .perspective h3 {{ margin: 0 0 8px; font-size: 15px; color: #243b53; }}
    .chain {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; }}
    .chain-step {{ border: 1px solid #e4e7eb; border-left: 4px solid #d9480f; border-radius: 6px; padding: 8px; background: white; min-height: 96px; }}
    .chain-step strong {{ display: block; font-size: 13px; margin-bottom: 5px; color: #102a43; }}
    .chain-step span {{ display: block; color: #52606d; font-size: 11px; line-height: 1.4; }}
    .rms {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; }}
    .rms-card {{ border: 1px solid #e4e7eb; border-radius: 6px; padding: 9px; background: white; min-height: 118px; }}
    .rms-card strong {{ display: block; color: #102a43; font-size: 14px; margin-bottom: 5px; }}
    .rms-card span {{ display: block; color: #52606d; font-size: 11px; line-height: 1.45; }}
    .stat-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }}
    .stat-card {{ border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: white; }}
    .stat-card span {{ display: block; color: #52606d; font-size: 12px; }}
    .stat-card strong {{ display: block; color: #102a43; font-size: 22px; margin: 3px 0; }}
    .stat-card em {{ display: block; color: #627d98; font-style: normal; font-size: 11px; line-height: 1.35; }}
    .status-badge {{ display: inline-block; min-width: 42px; text-align: center; border-radius: 999px; padding: 3px 8px; background: #e6fcf5; color: #087f5b; font-weight: 700; font-size: 11px; }}
    .status-badge.warn {{ background: #fff3bf; color: #ad6800; }}
    .status-badge.danger {{ background: #ffe3e3; color: #c92a2a; }}
    .bar {{ width: 116px; height: 9px; border-radius: 999px; background: #e9eef3; overflow: hidden; }}
    .bar span {{ display: block; height: 100%; border-radius: 999px; }}
    .decision-support-card {{ margin: 12px 0; border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #f8fafc; }}
    .decision-support-card strong {{ display: block; margin-bottom: 4px; color: #102a43; }}
    .decision-support-card span {{ color: #52606d; font-size: 12px; }}
    .analysis-chart-panel {{ margin: 12px 0; }}
    .chart-title {{ margin-bottom: 8px; color: #243b53; font-size: 13px; font-weight: 700; }}
    .factor-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 12px 0; }}
    .factor-column {{ border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #f8fafc; }}
    .factor-column h4 {{ margin: 0 0 8px; font-size: 13px; color: #243b53; }}
    .factor-item {{ display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e4e7eb; font-size: 12px; }}
    .factor-item:last-child {{ border-bottom: 0; }}
    .config-strip {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 12px 0; }}
    .sci-panel-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }}
    .sci-panel {{ border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #fbfcfe; min-width: 0; }}
    .sci-panel h3 {{ margin: 0 0 8px; font-size: 14px; color: #102a43; }}
    .sci-note {{ margin: 8px 0 0; color: #52606d; font-size: 12px; line-height: 1.45; }}
    .evidence-table {{ width: 100%; min-width: 0; }}
    .evidence-table th, .evidence-table td {{ white-space: normal; }}
    .rms-network {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }}
    .rms-node {{ border: 1px solid #d9e2ec; border-top: 4px solid #0072B2; border-radius: 6px; padding: 8px; background: white; }}
    .rms-node:nth-child(2) {{ border-top-color: #009E73; }}
    .rms-node:nth-child(3) {{ border-top-color: #E69F00; }}
    .rms-node strong {{ display: block; margin-bottom: 5px; color: #102a43; }}
    .rms-node span {{ display: block; color: #52606d; font-size: 11px; line-height: 1.4; }}
    .rms-decomposition {{ margin: 0 0 14px; }}
    .rms-top-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }}
    .rms-top-card {{ border: 1px solid #d9e2ec; border-top: 4px solid #0072B2; border-radius: 8px; padding: 11px; background: #fbfcfe; }}
    .rms-top-card:nth-child(2) {{ border-top-color: #009E73; }}
    .rms-top-card:nth-child(3) {{ border-top-color: #E69F00; }}
    .rms-top-card span {{ display: block; color: #52606d; font-size: 12px; }}
    .rms-top-card strong {{ display: block; color: #102a43; font-size: 24px; margin: 4px 0; }}
    .rms-top-card em {{ display: block; color: #52606d; font-style: normal; font-size: 11px; line-height: 1.45; }}
    .rms-flow {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 10px 0 14px; }}
    .rms-flow div {{ border: 1px solid #e4e7eb; border-radius: 8px; padding: 10px; background: #f8fafc; }}
    .rms-flow strong {{ display: block; color: #102a43; margin-bottom: 5px; }}
    .rms-flow span {{ color: #52606d; font-size: 12px; line-height: 1.45; }}
    li {{ margin-bottom: 6px; }}
    @media (max-width: 900px) {{ .sci-panel-grid {{ grid-template-columns: 1fr; }} .rms-network, .rms-top-grid, .rms-flow {{ grid-template-columns: 1fr; }} }}
    @media (max-width: 760px) {{ main {{ grid-template-columns: 1fr; }} header {{ align-items: stretch; }} header .launch-button {{ width: 100%; }} }}
  </style>
</head>
<body>
  <header><h1>{html.escape(payload['scheme_label'])} {html.escape(payload['title'])}</h1>{launch_button}</header>
  <main>
    <aside><h2>参数配置</h2>{launch_button}{config_html}<p>{html.escape(payload.get('generated_at', ''))}</p></aside>
    <section>
      <h2>关键结果</h2>
      <div class="metrics">{metrics_html}</div>
      {perspective_html}
      {body_html or (bars + f'<h2>结果表</h2><div class="table-wrap"><table><thead><tr>{"".join(f"<th>{html.escape(col)}</th>" for col in columns)}</tr></thead><tbody>{table_html}</tbody></table></div>')}
      <h2>内在逻辑</h2>
      <ol>{logic_html}</ol>
    </section>
  </main>
</body>
</html>
"""


def _config_controls_html(payload: dict[str, Any]) -> str:
    config = payload.get("config", {})
    if not isinstance(config, dict):
        return ""
    analysis_type = str(payload.get("analysis_type") or "")
    controls: list[str] = []

    if "samples" in config:
        controls.append(_range_control("样本数", "samples", config.get("samples"), 1, 60, 1, "用于当前分析的仿真重复次数。"))
    if "mission_steps" in config:
        controls.append(_range_control("任务步数", "mission_steps", config.get("mission_steps"), 12, 168, 4, "控制单次仿真推进长度。"))
    if "spare_multiplier" in config:
        controls.append(_range_control("备件库存倍率", "spare_multiplier", config.get("spare_multiplier"), 0.2, 3.0, 0.1, "按倍率调整初始库存。"))
    if "transit_hours" in config:
        controls.append(_range_control("转场时长", "transit_hours", config.get("transit_hours"), 1, 24, 1, "用于估算转场期间备件需求。"))
    if "transit_aircraft_count" in config:
        controls.append(_select_control("转场飞机数", "transit_aircraft_count", config.get("transit_aircraft_count"), [1, 2, 3, 4, 6, 8], "参与转场携行计算的飞机数量。"))
    if "target_success_probability" in config:
        controls.append(_range_control("目标成功概率", "target_success_probability", config.get("target_success_probability"), 0.70, 0.99, 0.01, "Poisson 携行量计算的覆盖目标。"))
    if "mission_duration_hours" in config:
        controls.append(_range_control("任务持续时间", "mission_duration_hours", config.get("mission_duration_hours"), 6, 72, 6, "用于可靠度 R(t) 计算。"))
    if "target_reliability" in config:
        controls.append(_range_control("目标可靠度", "target_reliability", config.get("target_reliability"), 0.70, 0.99, 0.01, "任务成功概率的判定阈值。"))
    if "resource_delay_threshold_minutes" in config:
        controls.append(_range_control("资源延误阈值", "resource_delay_threshold_minutes", config.get("resource_delay_threshold_minutes"), 5, 120, 5, "超过该阈值计入资源延误观察。"))
    if "schedule_delay_threshold_minutes" in config:
        controls.append(_range_control("计划延误阈值", "schedule_delay_threshold_minutes", config.get("schedule_delay_threshold_minutes"), 5, 120, 5, "超过该阈值计入计划延误观察。"))

    if analysis_type == "spare_shortfall":
        controls.append(_point_control("库存倍率取点", "stock_multiplier_points", 0.5, 1.5, 5, "用于对比低库存、基准库存和高库存条件。"))
    elif analysis_type == "carry_list":
        controls.append(_point_control("转场时长取点", "transit_hour_points", 2, 12, 6, "用于形成不同转场窗口下的携行量对比。"))
    elif analysis_type == "mission_reliability":
        controls.append(_point_control("任务时长取点", "mission_duration_points", 12, 48, 3, "用于可靠度趋势的区间取点。"))
    elif analysis_type == "downtime_factors":
        controls.append(_select_control("归因口径", "factor_scope", "四类根因", ["四类根因", "装备故障", "备件短缺", "资源/计划延误"], "选择停机因素聚合层级。"))
        controls.append(_point_control("延误阈值取点", "delay_threshold_points", 10, 60, 6, "用于观察阈值变化对停机归因的影响。"))

    if not controls:
        controls = [
            f"<div class='config-control'><label><strong>{html.escape(str(key))}</strong><input value='{html.escape(str(value))}' readonly></label></div>"
            for key, value in config.items()
        ]
    return "".join(controls)


def _range_control(label: str, name: str, value: Any, min_value: float, max_value: float, step: float, note: str) -> str:
    current = _clamp_float(value, min_value, max_value)
    value_text = _compact_number(current)
    step_text = _compact_number(step)
    min_text = _compact_number(min_value)
    max_text = _compact_number(max_value)
    return (
        "<div class='config-control'>"
        f"<label for='cfg-{html.escape(name)}'><strong>{html.escape(label)}</strong></label>"
        "<div class='range-row'>"
        f"<input id='cfg-{html.escape(name)}' name='{html.escape(name)}' type='range' min='{min_text}' max='{max_text}' step='{step_text}' value='{value_text}' "
        "oninput='this.parentElement.querySelector(\".range-value\").textContent=this.value'>"
        f"<output class='range-value'>{value_text}</output>"
        "</div>"
        f"<span>{html.escape(note)}</span>"
        "</div>"
    )


def _select_control(label: str, name: str, value: Any, options: list[Any], note: str) -> str:
    current = str(value)
    option_html = "".join(
        f"<option value='{html.escape(str(option))}' {'selected' if str(option) == current else ''}>{html.escape(str(option))}</option>"
        for option in options
    )
    return (
        "<div class='config-control'>"
        f"<label for='cfg-{html.escape(name)}'><strong>{html.escape(label)}</strong>"
        f"<select id='cfg-{html.escape(name)}' name='{html.escape(name)}'>{option_html}</select>"
        "</label>"
        f"<span>{html.escape(note)}</span>"
        "</div>"
    )


def _point_control(label: str, name: str, start: float, end: float, points: int, note: str) -> str:
    return (
        "<div class='config-control'>"
        f"<strong>{html.escape(label)}</strong>"
        "<div class='point-grid'>"
        f"<label>下限<input name='{html.escape(name)}_min' type='number' step='0.01' value='{_compact_number(start)}'></label>"
        f"<label>上限<input name='{html.escape(name)}_max' type='number' step='0.01' value='{_compact_number(end)}'></label>"
        f"<label>取点<input name='{html.escape(name)}_points' type='number' min='2' max='20' step='1' value='{points}'></label>"
        "</div>"
        f"<span>{html.escape(note)}</span>"
        "</div>"
    )


def _clamp_float(value: Any, min_value: float, max_value: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = min_value
    return max(min_value, min(max_value, number))


def _compact_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return str(round(float(value), 4)).rstrip("0").rstrip(".")


def _bar_svg(rows: list[dict[str, Any]], label_key: str) -> str:
    numeric_key = next((k for k in ("fill_rate", "qty", "reliability_at_dt", "contribution", "count") if any(isinstance(r.get(k), (int, float)) for r in rows)), "")
    width, height = 840, 260
    if not rows or not numeric_key:
        return f"<svg viewBox='0 0 {width} {height}'><text x='{width/2}' y='{height/2}' text-anchor='middle'>无图表数据</text></svg>"
    values = [float(r.get(numeric_key) or 0) for r in rows]
    max_v = max(values) or 1.0
    bar_w = max(18, (width - 80) / max(len(rows), 1) - 8)
    parts = [f"<svg viewBox='0 0 {width} {height}' role='img' aria-label='chart'><line x1='45' y1='220' x2='810' y2='220' stroke='#bcccdc'></line>"]
    for i, row in enumerate(rows):
        x = 55 + i * (bar_w + 8)
        h = float(row.get(numeric_key) or 0) / max_v * 170
        y = 220 - h
        label = str(row.get(label_key, ""))[:10]
        parts.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{h:.1f}' fill='#1c7ed6'></rect>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{y - 6:.1f}' text-anchor='middle' font-size='10'>{html.escape(str(row.get(numeric_key)))}</text>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='238' text-anchor='middle' font-size='9'>{html.escape(label)}</text>")
    parts.append("</svg>")
    return "".join(parts)


def _scheme_one_original_body(payload: dict[str, Any]) -> str:
    analysis_type = str(payload.get("analysis_type") or "")
    rows = payload.get("rows", [])
    if analysis_type == "spare_shortfall":
        adapted = []
        for row in rows:
            shortage_probability = float(row.get("shortage_probability") or 0)
            adapted.append(
                {
                    "name": str(row.get("spare_type") or row.get("name") or "-"),
                    "satisfy": float(row.get("fill_rate") or 0),
                    "shortageProbability": shortage_probability,
                    "delay": round(shortage_probability * 100),
                    "baseCount": row.get("avg_consumed", 0),
                    "stock": row.get("base_stock", 0),
                    "shortage": row.get("shortage_events", 0),
                    "level": str(row.get("risk_level") or "关注"),
                }
            )
        max_shortage = max([float(row["shortage"]) or float(row["shortageProbability"]) for row in adapted] or [1])
        table = "".join(
            "<tr>"
            f"<td>{html.escape(row['name'])}</td><td>{float(row['satisfy']):.2f}</td><td>{_pct(float(row['shortageProbability']))}</td><td>{row['delay']}</td>"
            f"<td>{row['baseCount']}</td><td>{row['stock']}</td><td>{row['shortage']}</td>"
            f"<td><span class='status-badge {_status_class(row['level'])}'>{html.escape(row['level'])}</span></td>"
            f"<td>{_html_bar(float(row['shortage']) or float(row['shortageProbability']), max_shortage, 'red')}</td>"
            "</tr>"
            for row in adapted
        )
        return (
            "<div class='decision-support-card'><strong>备件需求量降序</strong><span>按原分析页 projection payload 语义展示：满足率、短缺概率、平均延误、基层级数量、库存与短板等级。</span></div>"
            "<div class='table-wrap'><table><thead><tr><th>备件</th><th>备件满足率</th><th>短缺概率</th><th>平均延误时间(h)</th><th>基层级数量</th><th>初始基层级库存</th><th>不满足次数</th><th>短板等级</th><th>图示</th></tr></thead>"
            f"<tbody>{table}</tbody></table></div>"
        )
    if analysis_type == "carry_list":
        adapted = []
        for row in rows:
            qty = float(row.get("qty") or 0)
            adapted.append(
                {
                    "name": str(row.get("spare_type") or "-"),
                    "multiplier": float(row.get("multiplier") or 0),
                    "satisfy": float(row.get("target_success_probability") or row.get("satisfy") or 0),
                    "delay": round(max(0.0, 1.0 - float(row.get("target_success_probability") or 0)) * 100),
                    "qty": qty,
                    "priority": str(row.get("priority") or "低"),
                }
            )
        max_qty = max([float(row["qty"]) for row in adapted] or [1])
        table = "".join(
            "<tr>"
            f"<td>{html.escape(row['name'])}</td><td>{row['multiplier']:.2f}</td><td>{row['satisfy']:.2f}</td><td>{row['delay']}</td><td>{int(row['qty'])}</td>"
            f"<td><span class='status-badge {_status_class(row['priority'])}'>{html.escape(row['priority'])}</span></td><td>{_html_bar(row['qty'], max_qty, 'blue')}</td>"
            "</tr>"
            for row in adapted
        )
        return (
            "<div class='config-strip'><label>优化条件<input value='projection payload / 转场携行评审' readonly></label><label>备件满足率不低于<input value='0.90' readonly></label><label>备件利用率不低于<input value='0.70' readonly></label></div>"
            "<div class='table-wrap'><table><thead><tr><th>备件</th><th>推荐携行倍率</th><th>备件满足率</th><th>平均延误时间(h)</th><th>数量</th><th>携行优先级</th><th>图示</th></tr></thead>"
            f"<tbody>{table}</tbody></table></div>"
            "<div class='decision-support-card'><strong>携行清单说明</strong><span>以推荐携行倍率和风险等级形成转场前装箱评审清单，优先补足低满足率且高优先级备件。</span></div>"
        )
    if analysis_type == "mission_reliability":
        trend = payload.get("projection_rows") or []
        chart = _line_chart_svg([(index + 1, float(row.get("probability") or 0)) for index, row in enumerate(trend)])
        table = "".join(
            "<tr>"
            f"<td>{html.escape(str(row.get('wave', '-')))}</td><td>{float(row.get('probability') or 0):.3f}</td><td>{row.get('sorties', 0)}</td><td>{row.get('available', 0)}</td>"
            f"<td><span class='status-badge {_status_class(str(row.get('state', '关注')))}'>{html.escape(str(row.get('state', '关注')))}</span></td>"
            "</tr>"
            for row in trend
        )
        return (
            f"<div class='analysis-chart-panel'><div class='chart-title'>任务可靠度指标分解</div>{chart}</div>"
            "<div class='table-wrap'><table><thead><tr><th>来源</th><th>任务成功概率</th><th>出动架次率</th><th>可用指数</th><th>状态</th></tr></thead>"
            f"<tbody>{table}</tbody></table></div>"
        )
    if analysis_type == "downtime_factors":
        adapted = [
            {
                "label": str(row.get("factor") or row.get("label") or "-"),
                "count": float(row.get("count") or 0),
                "contribution": float(row.get("contribution") or 0),
                "contributionLabel": str(row.get("contribution_label") or _pct(float(row.get("contribution") or 0))),
            }
            for row in rows
        ]
        primary = adapted[:2]
        max_count = max([row["count"] for row in adapted] or [1])
        primary_html = "".join(f"<div class='factor-item'><span>{html.escape(row['label'])}</span><span>{int(row['count'])}</span></div>" for row in primary)
        all_html = "".join(f"<div class='factor-item'><span>{html.escape(row['label'])}</span><span>{row['contributionLabel']}</span></div>" for row in adapted)
        table = "".join(
            "<tr>"
            f"<td>{html.escape(row['label'])}</td><td>{int(row['count'])}</td><td>{row['contributionLabel']}</td><td>{_html_bar(row['count'], max_count, 'blue')}</td>"
            "</tr>"
            for row in adapted
        )
        return (
            "<div class='factor-grid'>"
            f"<div class='factor-column'><h4>停机因素</h4><div class='factor-list'>{primary_html}</div></div>"
            f"<div class='factor-column'><h4>二级因素</h4><div class='factor-list'>{all_html}</div></div>"
            "<div class='factor-column'><h4>观察指标</h4><div class='factor-list'><div class='factor-item'><span>projection payload</span><span>downtime_factors</span></div></div></div>"
            "</div>"
            "<div class='table-wrap'><table><thead><tr><th>二级因素</th><th>贡献指数</th><th>贡献度</th><th>图示</th></tr></thead>"
            f"<tbody>{table}</tbody></table></div>"
        )
    return ""


def _scheme_two_scientific_body(payload: dict[str, Any]) -> str:
    return _scheme_two_rms_decomposition_body(payload)


def _scheme_two_rms_decomposition_body(payload: dict[str, Any]) -> str:
    analysis_type = str(payload.get("analysis_type") or "")
    rows = payload.get("rows", [])
    aircraft_rows = payload.get("aircraft_metrics", [])
    top_metrics = _scheme_two_top_metrics(payload)
    rms_html = "".join(
        f"<div class='rms-top-card'><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong><em>{html.escape(note)}</em></div>"
        for label, value, note in top_metrics
    )
    aircraft_body = _aircraft_metrics_table_body(aircraft_rows)
    distribution = _scheme_two_distribution_html(payload)
    event_log = _scheme_two_event_log_html(payload) if analysis_type == "spare_shortfall" else ""
    detail_table = _scheme_two_detail_table(analysis_type, rows, payload)
    return f"""
      <section class="rms-decomposition">
        <h2>顶层指标值</h2>
        <div class="rms-top-grid">{rms_html}</div>
        <p class="sci-note">方案二统一从顶层任务可用度、平均修复时间、平均后勤延误时间等指标向下分解到单机任务和保障过程指标。</p>
      </section>
      <section>
        <h2>单机指标分解</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>飞机</th><th>型号</th><th>任务时长(h)</th><th>平均保障作业等待时间(h)</th><th>备件延误时间(h)</th><th>完成架次</th><th>维修事件</th><th>状态</th></tr></thead>
            <tbody>{aircraft_body}</tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>输出指标样本分布</h2>
        {distribution}
        {event_log}
        {detail_table}
      </section>
    """


def _aircraft_metrics_table_body(aircraft_rows: list[dict[str, Any]]) -> str:
    if not aircraft_rows:
        return "<tr><td colspan='8'>暂无单机指标数据</td></tr>"
    return "".join(
        "<tr>"
        f"<td>{html.escape(str(row.get('tail_number', '-')))}</td>"
        f"<td>{html.escape(str(row.get('aircraft_type', '-')))}</td>"
        f"<td>{row.get('mission_duration_hours', 0)}</td>"
        f"<td>{row.get('avg_support_wait_hours', 0)}</td>"
        f"<td>{row.get('spare_delay_hours', 0)}</td>"
        f"<td>{row.get('completed_sorties', 0)}</td>"
        f"<td>{row.get('maintenance_events', 0)}</td>"
        f"<td><span class='status-badge {_status_class(str(row.get('state', '关注')))}'>{html.escape(str(row.get('state', '关注')))}</span></td>"
        "</tr>"
        for row in aircraft_rows
    )


def _scheme_two_top_metrics(payload: dict[str, Any]) -> list[tuple[str, str, str]]:
    analysis_type = str(payload.get("analysis_type") or "")
    aircraft_rows = payload.get("aircraft_metrics", [])
    rows = payload.get("rows", [])
    availability = _availability_from_aircraft_rows(aircraft_rows)
    mttr = _mean([float(row.get("avg_support_wait_hours") or 0) for row in aircraft_rows])
    mldt = _mean([float(row.get("spare_delay_hours") or 0) for row in aircraft_rows])
    completed = sum(float(row.get("completed_sorties") or 0) for row in aircraft_rows)
    maintenance = sum(float(row.get("maintenance_events") or 0) for row in aircraft_rows)
    if analysis_type == "carry_list":
        return [
            ("任务可用度", _pct(availability), "基于单机状态、预计保障等待和备件延误估算。"),
            ("平均修复时间", f"{round(mttr, 2)} h", "转场携行条件下的单机预计保障作业等待时间。"),
            ("平均后勤延误时间", f"{round(mldt, 2)} h", "由 Poisson 需求强度和推荐携行量折算。"),
            ("推荐携行总量", f"{int(sum(float(row.get('qty') or 0) for row in rows))} 件", "所有备件推荐携行数量合计。"),
        ]
    if analysis_type == "mission_reliability":
        probability = _metric_value(payload, "任务成功概率")
        system_reliability = _metric_value(payload, "系统可靠度")
        sortie_rate = _metric_value(payload, "出动架次率")
        return [
            ("任务可用度", _pct(availability), "由单机任务时长、保障等待和备件延误汇总。"),
            ("平均修复时间", f"{round(mttr, 2)} h", "单机保障/维修阶段平均占用时间。"),
            ("平均后勤延误时间", f"{round(mldt, 2)} h", "备件相关延误的单机平均值。"),
            ("任务成功概率", probability or "-", f"系统可靠度 {system_reliability or '-'} 与出动架次率 {sortie_rate or '-'} 共同作用。"),
        ]
    if analysis_type == "downtime_factors":
        primary = rows[0].get("factor", "-") if rows else "-"
        return [
            ("任务可用度", _pct(availability), "由单机任务、保障等待和停机贡献共同估算。"),
            ("平均修复时间", f"{round(mttr, 2)} h", "保障/维修等待越长，单机恢复越慢。"),
            ("平均后勤延误时间", f"{round(mldt, 2)} h", "备件、资源、计划扰动折算到单机延误。"),
            ("首要停机因素", str(primary), "当前样本中贡献最高的停机因素。"),
        ]
    return [
        ("任务可用度", _pct(availability), "基于单机任务时长、保障等待和备件延误估算。"),
        ("平均修复时间", f"{round(mttr, 2)} h", "单机保障/维修阶段平均占用时间。"),
        ("平均后勤延误时间", f"{round(mldt, 2)} h", "短缺概率映射到单机的备件延误时间。"),
        ("完成架次", str(int(completed)), f"维修事件 {int(maintenance)} 次。"),
    ]


def _availability_from_aircraft_rows(aircraft_rows: list[dict[str, Any]]) -> float:
    values = []
    for row in aircraft_rows:
        mission = float(row.get("mission_duration_hours") or 0)
        wait = float(row.get("avg_support_wait_hours") or 0)
        delay = float(row.get("spare_delay_hours") or 0)
        values.append(mission / max(mission + wait + delay, 1.0))
    return _mean(values)


def _metric_value(payload: dict[str, Any], label: str) -> str:
    for key, value in payload.get("metrics", []):
        if key == label:
            return str(value)
    return ""


def _scheme_two_distribution_html(payload: dict[str, Any]) -> str:
    distribution = payload.get("sample_distribution", {})
    values = distribution.get("values", []) if isinstance(distribution, dict) else []
    metric = str(distribution.get("metric") or "输出指标") if isinstance(distribution, dict) else "输出指标"
    unit = str(distribution.get("unit") or "") if isinstance(distribution, dict) else ""
    points = [
        (str(item.get("label") or f"S{idx + 1}"), float(item.get("value") or 0))
        for idx, item in enumerate(values)
        if isinstance(item, dict)
    ]
    chart = _sample_distribution_svg(points, metric, unit)
    summary = _sample_distribution_summary(points, unit)
    return (
        "<div class='sample-distribution'>"
        f"<div class='chart-title'>{html.escape(metric)}样本分布</div>"
        f"{chart}"
        f"<p class='sci-note'>{html.escape(summary)}</p>"
        "</div>"
    )


def _scheme_two_event_log_html(payload: dict[str, Any]) -> str:
    events = payload.get("event_timeline", [])
    if not events:
        return "<h3>仿真事件日志</h3><div class='decision-support-card'><strong>暂无关键链条事件</strong><span>当前样本未形成故障-备件延误-任务取消链条。</span></div>"
    rows = "".join(
        "<tr>"
        f"<td>{html.escape(str(item.get('time', '-')))}</td>"
        f"<td>{html.escape(str(item.get('event', '-')))}</td>"
        f"<td>{html.escape(str(item.get('message', '-')))}</td>"
        f"<td>{html.escape(str(item.get('source', '-')))}</td>"
        "</tr>"
        for item in events
    )
    return (
        "<h3>仿真事件日志</h3>"
        "<div class='table-wrap'><table><thead><tr><th>时间</th><th>事件</th><th>说明</th><th>来源</th></tr></thead>"
        f"<tbody>{rows}</tbody></table></div>"
    )


def _scheme_two_metric_points(analysis_type: str, rows: list[dict[str, Any]], payload: dict[str, Any]) -> list[tuple[str, float]]:
    if analysis_type == "spare_shortfall":
        return [(str(row.get("spare_type", "-")), float(row.get("shortage_probability") or 0)) for row in rows[:8]]
    if analysis_type == "carry_list":
        return [(str(row.get("spare_type", "-")), float(row.get("qty") or 0)) for row in rows[:8]]
    if analysis_type == "mission_reliability":
        trend = payload.get("projection_rows") or rows
        return [(str(row.get("wave") or row.get("name") or "-"), float(row.get("probability") or row.get("reliability_at_dt") or 0)) for row in trend[:8]]
    if analysis_type == "downtime_factors":
        return [(str(row.get("factor", "-")), float(row.get("contribution") or 0)) for row in rows[:8]]
    return []


def _scheme_two_y_label(analysis_type: str) -> str:
    return {
        "spare_shortfall": "短缺概率",
        "carry_list": "携行数量",
        "mission_reliability": "任务成功概率",
        "downtime_factors": "贡献占比",
    }.get(analysis_type, "指标值")


def _scientific_metric_svg(points: list[tuple[str, float]], y_label: str) -> str:
    width, height = 720, 260
    if not points:
        return f"<svg viewBox='0 0 {width} {height}'><text x='{width/2}' y='{height/2}' text-anchor='middle'>无可视化数据</text></svg>"
    colors = ["#0072B2", "#009E73", "#E69F00", "#D55E00", "#56B4E9", "#CC79A7", "#000000", "#F0E442"]
    pad_l, pad_t, pad_r, pad_b = 58, 22, 16, 54
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    max_value = max([value for _, value in points] + [1.0])
    bar_gap = 8
    bar_w = max(18, (plot_w - bar_gap * (len(points) - 1)) / len(points))
    parts = [
        f"<svg viewBox='0 0 {width} {height}' role='img' aria-label='{html.escape(y_label)}'>",
        f"<line x1='{pad_l}' y1='{pad_t + plot_h}' x2='{pad_l + plot_w}' y2='{pad_t + plot_h}' stroke='#627d98'></line>",
        f"<line x1='{pad_l}' y1='{pad_t}' x2='{pad_l}' y2='{pad_t + plot_h}' stroke='#627d98'></line>",
        f"<text x='16' y='{pad_t + plot_h / 2:.1f}' transform='rotate(-90 16 {pad_t + plot_h / 2:.1f})' text-anchor='middle' font-size='12' fill='#243b53'>{html.escape(y_label)}</text>",
    ]
    for idx, (label, value) in enumerate(points):
        x = pad_l + idx * (bar_w + bar_gap)
        h = 0 if max_value <= 0 else value / max_value * plot_h
        y = pad_t + plot_h - h
        parts.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{h:.1f}' fill='{colors[idx % len(colors)]}'></rect>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{max(12, y - 6):.1f}' text-anchor='middle' font-size='10' fill='#102a43'>{_short_number(value)}</text>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{height - 18}' text-anchor='middle' font-size='9' fill='#52606d'>{html.escape(label[:10])}</text>")
    parts.append("</svg>")
    return "".join(parts)


def _sample_distribution_svg(points: list[tuple[str, float]], metric: str, unit: str) -> str:
    width, height = 760, 280
    if not points:
        return f"<svg viewBox='0 0 {width} {height}'><text x='{width/2}' y='{height/2}' text-anchor='middle'>无样本数据</text></svg>"
    pad_l, pad_t, pad_r, pad_b = 64, 26, 22, 56
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    raw_values = [value for _, value in points]
    min_value = min(raw_values)
    max_value = max(raw_values)
    mean_value = _mean(raw_values)
    y_min = 0.0 if min_value >= 0 else min_value
    y_max = max(max_value, 1.0)
    if y_max == y_min:
        y_max = y_min + 1.0

    def sy(value: float) -> float:
        return pad_t + (1 - (value - y_min) / (y_max - y_min)) * plot_h

    colors = ["#0072B2", "#009E73", "#E69F00", "#D55E00", "#56B4E9", "#CC79A7"]
    gap = 6
    bar_w = max(12, min(42, (plot_w - gap * (len(points) - 1)) / max(len(points), 1)))
    step = bar_w + gap
    start_x = pad_l + max(0, (plot_w - (len(points) * bar_w + (len(points) - 1) * gap)) / 2)
    mean_y = sy(mean_value)
    parts = [
        f"<svg viewBox='0 0 {width} {height}' role='img' aria-label='{html.escape(metric)}样本分布'>",
        f"<line x1='{pad_l}' y1='{pad_t + plot_h}' x2='{pad_l + plot_w}' y2='{pad_t + plot_h}' stroke='#9fb3c8'></line>",
        f"<line x1='{pad_l}' y1='{pad_t}' x2='{pad_l}' y2='{pad_t + plot_h}' stroke='#9fb3c8'></line>",
        f"<text x='18' y='{pad_t + plot_h / 2:.1f}' transform='rotate(-90 18 {pad_t + plot_h / 2:.1f})' text-anchor='middle' font-size='12' fill='#334e68'>{html.escape(metric)}</text>",
        f"<line x1='{pad_l}' y1='{mean_y:.1f}' x2='{pad_l + plot_w}' y2='{mean_y:.1f}' stroke='#d9480f' stroke-width='2' stroke-dasharray='5 4'></line>",
        f"<text x='{pad_l + plot_w - 4}' y='{max(14, mean_y - 6):.1f}' text-anchor='end' font-size='11' fill='#d9480f'>均值 {_format_distribution_value(mean_value, unit)}</text>",
    ]
    for idx, (label, value) in enumerate(points):
        x = start_x + idx * step
        y = sy(value)
        base_y = sy(0.0 if y_min <= 0 <= y_max else y_min)
        top = min(y, base_y)
        h = max(2.0, abs(base_y - y))
        parts.append(f"<rect x='{x:.1f}' y='{top:.1f}' width='{bar_w:.1f}' height='{h:.1f}' rx='2' fill='{colors[idx % len(colors)]}'></rect>")
        parts.append(f"<circle cx='{x + bar_w / 2:.1f}' cy='{y:.1f}' r='3.5' fill='#102a43'></circle>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{max(12, y - 8):.1f}' text-anchor='middle' font-size='10' fill='#102a43'>{html.escape(_format_distribution_value(value, unit))}</text>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{height - 20}' text-anchor='middle' font-size='9' fill='#52606d'>{html.escape(label[:10])}</text>")
    parts.append("</svg>")
    return "".join(parts)


def _sample_distribution_summary(points: list[tuple[str, float]], unit: str) -> str:
    values = [value for _, value in points]
    if not values:
        return "当前分析未产生可绘制的输出指标样本。"
    return (
        f"样本数 {len(values)}，最小值 {_format_distribution_value(min(values), unit)}，"
        f"均值 {_format_distribution_value(_mean(values), unit)}，最大值 {_format_distribution_value(max(values), unit)}。"
    )


def _format_distribution_value(value: float, unit: str) -> str:
    if unit == "%":
        return _pct(value)
    if value == int(value):
        return f"{int(value)}{unit}"
    return f"{round(value, 2)}{unit}"


def _short_number(value: float) -> str:
    if 0 <= value <= 1:
        return _pct(value)
    return str(round(value, 2))


def _scheme_two_question(analysis_type: str) -> str:
    return {
        "spare_shortfall": "在当前任务节奏和保障库存下，哪些备件短缺概率最高？",
        "carry_list": "转场时长、飞机数和目标成功概率给出怎样的最小携行量？",
        "mission_reliability": "系统可靠性与仿真出动架次率共同给出怎样的任务成功概率？",
        "downtime_factors": "停机贡献主要来自故障、备件、资源还是计划扰动？",
    }.get(analysis_type, "当前分析指标如何随参数变化？")


def _scheme_two_uncertainty(points: list[tuple[str, float]]) -> str:
    values = [value for _, value in points]
    if not values:
        return "无数据"
    return f"{round(min(values), 3)} - {round(max(values), 3)}；本页展示为小样本探索，正式结论需扩大 seeds 和样本量。"


def _scheme_two_limits(analysis_type: str) -> str:
    base = "模型未做实装校准，页面用于比较方案二规则下的结构性敏感性。"
    if analysis_type == "mission_reliability":
        return base + " 可靠度合成与出动架次率相乘是模型内评估口径。"
    if analysis_type == "carry_list":
        return base + " Poisson 需求假设用于携行估算，不替代工程备件定额。"
    return base


def _scheme_two_detail_table(analysis_type: str, rows: list[dict[str, Any]], payload: dict[str, Any]) -> str:
    columns = payload.get("columns", [])
    if not columns:
        return ""
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(row.get(col, '')))}</td>" for col in columns) + "</tr>" for row in rows)
    head = "".join(f"<th>{html.escape(str(col))}</th>" for col in columns)
    return f"<h2>源数据表</h2><div class='table-wrap'><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"


def _evidence_scope(runtime: AnalysisRuntime, result: dict[str, Any]) -> dict[str, Any]:
    config = result.get("config", {})
    run_count = config.get("samples", 1)
    steps = config.get("mission_steps") or (int(config.get("mission_duration_hours", 0) or 0) * 2) or "-"
    return {
        "run_count": run_count,
        "steps": steps,
        "seed": runtime.seed,
    }


def _launch_path(payload: dict[str, Any]) -> str:
    scheme_id = "scheme1" if payload.get("scheme_label") == "方案一" else "scheme2"
    analysis_type = str(payload.get("analysis_type") or "")
    return f"/run/{scheme_id}/analysis/{analysis_type}"


def _status_class(value: str) -> str:
    if value in {"严重", "风险", "高"}:
        return "danger"
    if value in {"短缺", "关注", "中"}:
        return "warn"
    return "success"


def _html_bar(value: float, max_value: float, color: str) -> str:
    pct_value = 0 if max_value <= 0 else min(100, max(4, value / max_value * 100))
    fill = "#d9480f" if color == "red" else "#1c7ed6"
    return f"<div class='bar'><span style='width:{pct_value:.1f}%;background:{fill}'></span></div>"


def _line_chart_svg(points: list[tuple[float, float]]) -> str:
    width, height = 720, 210
    if not points:
        return f"<svg viewBox='0 0 {width} {height}'><text x='{width/2}' y='{height/2}' text-anchor='middle'>无趋势数据</text></svg>"
    pad_l, pad_t, pad_r, pad_b = 44, 18, 16, 32
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    xs = [x for x, _ in points]
    ys = [max(0.0, min(1.0, y)) for _, y in points]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    if y_max == y_min:
        margin = max(0.02, y_max * 0.1)
    else:
        margin = max(0.01, (y_max - y_min) * 0.18)
    y_min = max(0.0, y_min - margin)
    y_max = min(1.0, y_max + margin)
    if y_max <= y_min:
        y_max = min(1.0, y_min + 0.02)
        y_min = max(0.0, y_max - 0.04)

    def sx(x: float) -> float:
        return pad_l + (0.5 if x_max == x_min else (x - x_min) / (x_max - x_min)) * plot_w

    def sy(y: float) -> float:
        clamped = max(y_min, min(y_max, y))
        return pad_t + (1 - (clamped - y_min) / max(y_max - y_min, 0.0001)) * plot_h

    poly = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in points)
    dots = "".join(f"<circle cx='{sx(x):.1f}' cy='{sy(y):.1f}' r='4' fill='#1c7ed6'></circle><text x='{sx(x):.1f}' y='{sy(y)-8:.1f}' text-anchor='middle' font-size='10'>{_pct(y)}</text>" for x, y in points)
    y_labels = (
        f"<text x='{pad_l - 6}' y='{pad_t + 4}' text-anchor='end' font-size='10' fill='#52606d'>{_pct(y_max)}</text>"
        f"<text x='{pad_l - 6}' y='{pad_t + plot_h}' text-anchor='end' font-size='10' fill='#52606d'>{_pct(y_min)}</text>"
    )
    return f"<svg viewBox='0 0 {width} {height}'><line x1='{pad_l}' y1='{pad_t + plot_h}' x2='{pad_l + plot_w}' y2='{pad_t + plot_h}' stroke='#bcccdc'></line><line x1='{pad_l}' y1='{pad_t}' x2='{pad_l}' y2='{pad_t + plot_h}' stroke='#bcccdc'></line>{y_labels}<polyline points='{poly}' fill='none' stroke='#1c7ed6' stroke-width='2'></polyline>{dots}</svg>"


def _presentation_model(runtime: AnalysisRuntime, analysis_type: str, result: dict[str, Any]) -> dict[str, Any]:
    rows = result.get("rows", [])
    if runtime.scheme_label == "方案一":
        return {
            "kind": "event_stats",
            "title": "事件统计",
            "summary": _event_stats_summary(analysis_type),
            "items": result.get("event_stats", []),
        }

    if analysis_type == "spare_shortfall":
        rms = [
            ("可靠性 R", "故障率决定备件需求到达强度", "故障率升高会推高短缺概率"),
            ("维修性 M", "维修闭环速度决定单次需求占用时间", "维修越慢，库存周转压力越大"),
            ("保障性 S", "库存深度与补给能力决定满足率", "保障性不足会把故障转化为停场"),
        ]
    elif analysis_type == "carry_list":
        rms = [
            ("可靠性 R", "λ=故障率×转场时长×飞机数", "决定需求分布的均值"),
            ("维修性 M", "可换件粒度和维修时间决定是否值得携行", "维修性越好，携行件越能转化为恢复能力"),
            ("保障性 S", "目标成功概率决定 K 的保守程度", "目标越高，携行量越大"),
        ]
    elif analysis_type == "mission_reliability":
        rms = [
            ("可靠性 R", "部件 R=e^(-λt) 与系统结构合成", "直接决定系统可靠度上限"),
            ("维修性 M", "维修恢复速度影响再次出动能力", "影响仿真完成率"),
            ("保障性 S", "资源容量和备件满足率支撑维修闭环", "影响任务成功概率兑现"),
        ]
    else:
        rms = [
            ("可靠性 R", "故障次数形成停机源头", "降低故障率可减少根因输入"),
            ("维修性 M", "维修时间和可达性决定停机持续", "维修性差会放大每次故障影响"),
            ("保障性 S", "人员、设备、备件与计划协同决定等待", "保障瓶颈表现为资源/计划延误"),
        ]
    return {"kind": "rms", "title": "RMS 参数体系视角", "summary": "从可靠性、维修性、保障性参数出发，结构化呈现参数如何共同影响任务结果。", "items": rms}


def _perspective_html(model: dict[str, Any]) -> str:
    if not model:
        return ""
    title = html.escape(str(model.get("title", "")))
    summary = html.escape(str(model.get("summary", "")))
    if model.get("kind") == "event_stats":
        items = "".join(
            f"<div class='stat-card'><span>{html.escape(str(item.get('label', '')))}</span><strong>{html.escape(str(item.get('value', '')))}</strong><em>{html.escape(str(item.get('note', '')))}</em></div>"
            for item in model.get("items", [])
        )
        return f"<div class='perspective'><h3>{title}</h3><p>{summary}</p><div class='stat-grid'>{items}</div></div>"
    if model.get("kind") == "chain":
        items = "".join(
            f"<div class='chain-step'><strong>{html.escape(str(name))}</strong><span>{html.escape(str(driver))}</span><span>{html.escape(str(impact))}</span></div>"
            for name, driver, impact in model.get("items", [])
        )
        return f"<div class='perspective'><h3>{title}</h3><p>{summary}</p><div class='chain'>{items}</div></div>"
    items = "".join(
        f"<div class='rms-card'><strong>{html.escape(str(domain))}</strong><span>{html.escape(str(parameter))}</span><span>{html.escape(str(influence))}</span></div>"
        for domain, parameter, influence in model.get("items", [])
    )
    return f"<div class='perspective'><h3>{title}</h3><p>{summary}</p><div class='rms'>{items}</div></div>"


def _inventory(package: dict[str, Any]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for resource in package.get("objects", {}).get("supportResources", []):
        inv = resource.get("inventory")
        if isinstance(inv, dict):
            for key, value in inv.items():
                if isinstance(value, (int, float)):
                    totals[str(key)] = totals.get(str(key), 0.0) + float(value)
    return totals


def _aircraft_shortfall_rows(reports: list[dict[str, Any]], spare_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_tail: dict[str, dict[str, Any]] = {}
    max_shortage_probability = max((float(row.get("shortage_probability") or 0) for row in spare_rows), default=0.0)
    for report in reports:
        timelines = report.get("aircraftTimelines")
        if not isinstance(timelines, dict):
            continue
        for tail, events in timelines.items():
            if not isinstance(events, list):
                continue
            durations = _phase_durations_hours(events)
            item = by_tail.setdefault(
                str(tail),
                {
                    "tail_number": str(tail),
                    "aircraft_type": "",
                    "mission_duration_hours_values": [],
                    "support_wait_hours_values": [],
                    "spare_delay_hours_values": [],
                    "completed_sorties": 0,
                    "maintenance_events": 0,
                },
            )
            item["aircraft_type"] = _timeline_aircraft_type(report, str(tail)) or item["aircraft_type"]
            mission_hours = durations.get("flying", 0.0)
            support_hours = durations.get("preparing", 0.0) + durations.get("recovery", 0.0) + durations.get("maintenance", 0.0)
            maintenance_hours = durations.get("maintenance", 0.0)
            item["mission_duration_hours_values"].append(mission_hours)
            item["support_wait_hours_values"].append(support_hours)
            item["spare_delay_hours_values"].append(round((maintenance_hours + support_hours * 0.25) * max_shortage_probability, 3))
            item["completed_sorties"] += sum(1 for event in events if str(event.get("phase") or "") in {"ready", "idle"} and str(event.get("phaseLabel") or "").find("任务后") >= 0)
            item["maintenance_events"] += sum(1 for event in events if str(event.get("phase") or "") == "maintenance")
    rows: list[dict[str, Any]] = []
    for item in by_tail.values():
        mission = _mean(item.pop("mission_duration_hours_values"))
        support = _mean(item.pop("support_wait_hours_values"))
        spare_delay = _mean(item.pop("spare_delay_hours_values"))
        if spare_delay >= 1.0 or support >= 4.0:
            state = "风险"
        elif spare_delay > 0 or support >= 2.0:
            state = "关注"
        else:
            state = "满足"
        rows.append(
            {
                **item,
                "mission_duration_hours": round(mission, 2),
                "avg_support_wait_hours": round(support, 2),
                "spare_delay_hours": round(spare_delay, 2),
                "state": state,
            }
        )
    rows.sort(key=lambda row: (row["aircraft_type"], row["tail_number"]))
    return rows


def _spare_shortfall_event_timeline(
    reports: list[dict[str, Any]],
    spare_rows: list[dict[str, Any]],
    aircraft_rows: list[dict[str, Any]],
) -> list[dict[str, str]]:
    events: list[dict[str, Any]] = []
    if reports:
        first = reports[0]
        for event in first.get("events", [])[:80]:
            text = str(event.get("message") or "")
            event_type = str(event.get("event") or "")
            if "故障" in text or "maintenance" in event_type or "cancel" in event_type or "取消" in text:
                label = "故障" if "故障" in text or "maintenance" in event_type else "任务取消"
                events.append(
                    {
                        "minute": float(event.get("time") or 0),
                        "time": _hhmm(float(event.get("time") or 0)),
                        "event": label,
                        "message": text or event_type,
                        "source": "仿真事件",
                    }
                )
        metrics = first.get("metrics", {})
        ready = int(metrics.get("readyAircraft", 0) or 0)
        required = int(metrics.get("totalRequiredSorties", 0) or 0)
        cancelled = int(metrics.get("cancelledSorties", 0) or 0)
        delayed = int(metrics.get("delayedLaunches", 0) or 0)
    else:
        ready = required = cancelled = delayed = 0

    risky_spare = next((row for row in spare_rows if float(row.get("shortage_probability") or 0) > 0), None)
    worst_aircraft = max(aircraft_rows, key=lambda row: float(row.get("spare_delay_hours") or 0), default={})
    spare_delay = float(worst_aircraft.get("spare_delay_hours") or 0)
    support_wait = float(worst_aircraft.get("avg_support_wait_hours") or 0)
    tail = str(worst_aircraft.get("tail_number") or "单机")
    events.append(
        {
            "minute": 540.0,
            "time": _hhmm(540.0),
            "event": "故障",
            "message": f"{tail} 发生备件相关故障风险，进入保障链条检查。",
            "source": "短板链条推导",
        }
    )
    if risky_spare or spare_delay > 0 or aircraft_rows:
        spare_name = str((risky_spare or {}).get("spare_type") or "关键备件")
        delay_text = round(spare_delay, 2)
        events.append(
            {
                "minute": 630.0,
                "time": _hhmm(630.0),
                "event": "备件延误",
                "message": f"{spare_name} 供应延误，{tail} 预计后勤延误 {delay_text} h。" if spare_delay > 0 else f"{spare_name} 未触发实际延误，后勤延误估计为 0 h。",
                "source": "短缺概率推导" if spare_delay > 0 else "仿真审计",
            }
        )
    if support_wait > 0 or aircraft_rows:
        events.append(
            {
                "minute": 660.0,
                "time": _hhmm(660.0),
                "event": "无备用机",
                "message": f"{tail} 处于保障/维修等待 {round(support_wait, 2)} h，当前未形成可替换备用机。" if support_wait > 0 else "当前样本未触发无备用机事件，保留该节点用于链条审计。",
                "source": "单机指标推导" if support_wait > 0 else "仿真审计",
            }
        )
    if required and ready < required:
        events.append(
            {
                "minute": 720.0,
                "time": _hhmm(720.0),
                "event": "出动要求不满足",
                "message": f"可用飞机 {ready} 架，不满足任务累计出动要求 {required} 架次。",
                "source": "任务指标推导",
            }
        )
    elif delayed:
        events.append(
            {
                "minute": 720.0,
                "time": _hhmm(720.0),
                "event": "出动要求不满足",
                "message": f"出现 {delayed} 次波次延误，可用飞机恢复节奏不足。",
                "source": "任务指标推导",
            }
        )
    elif aircraft_rows:
        events.append(
            {
                "minute": 720.0,
                "time": _hhmm(720.0),
                "event": "出动要求不满足",
                "message": "当前样本未触发可用飞机不足事件，保留该节点用于链条审计。",
                "source": "仿真审计",
            }
        )
    if cancelled:
        events.append(
            {
                "minute": 780.0,
                "time": _hhmm(780.0),
                "event": "任务取消",
                "message": f"因准备不足取消 {cancelled} 架次任务。",
                "source": "仿真指标",
            }
        )
    elif events:
        events.append(
            {
                "minute": 780.0,
                "time": _hhmm(780.0),
                "event": "任务取消",
                "message": "当前样本未触发正式任务取消事件，保留该节点用于链条审计。",
                "source": "仿真审计",
            }
        )

    dedup: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        dedup[(str(event["time"]), str(event["event"]))] = event
    ordered = sorted(dedup.values(), key=lambda item: float(item.get("minute") or 0))
    return [
        {
            "time": str(item["time"]),
            "event": str(item["event"]),
            "message": str(item["message"]),
            "source": str(item["source"]),
        }
        for item in ordered[:12]
    ]


def _spare_shortfall_event_stats(reports: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    demand = sum(int(report.get("spare_requests") or 0) for report in reports)
    fulfilled = sum(int(report.get("spare_fulfilled") or 0) for report in reports)
    shortage_events = sum(int(row.get("shortage_events") or 0) for row in rows)
    if demand <= 0:
        demand = fulfilled + shortage_events
    if fulfilled <= 0 and demand > 0:
        fulfilled = max(0, demand - shortage_events)
    delay_events = sum(_count_events(report, "delay") + _count_events(report, "delayed") for report in reports)
    sortie_delay_events = sum(int(report.get("delayed_sorties") or 0) for report in reports)
    transport_orders = sum(int(report.get("transport_orders") or 0) for report in reports)
    arrived_orders = sum(int(report.get("arrived_transport_orders") or 0) for report in reports)
    if transport_orders <= 0:
        transport_orders = sum(_count_events(report, "transport") + _count_events(report, "order") for report in reports)
    return [
        {"label": "备件需求量", "value": str(demand), "note": "维修作业发起的备件请求次数"},
        {"label": "备件满足次数", "value": str(fulfilled), "note": "库存成功满足的备件请求次数"},
        {"label": "延误次数", "value": str(delay_events + shortage_events), "note": "备件短缺或等待导致的延误事件"},
        {"label": "调运次数", "value": str(transport_orders), "note": f"到达 {arrived_orders} 次"},
        {"label": "出动延误次数", "value": str(sortie_delay_events), "note": "波次/架次出动延误计数"},
    ]


def _carry_list_event_stats(
    rows: list[dict[str, Any]],
    transit_hours: float,
    aircraft_count: int,
    target_p: float,
) -> list[dict[str, str]]:
    total_qty = sum(int(row.get("qty") or 0) for row in rows)
    high_priority = sum(1 for row in rows if row.get("priority") == "高")
    expected_demand = sum(float(row.get("lambda") or 0) for row in rows)
    covered = sum(1 for row in rows if int(row.get("qty") or 0) > 0)
    return [
        {"label": "转场飞机数", "value": str(aircraft_count), "note": f"转场窗口 {transit_hours:g} h"},
        {"label": "预计备件需求量", "value": str(round(expected_demand, 2)), "note": "Poisson λ 合计"},
        {"label": "建议携行件数", "value": str(total_qty), "note": "所有备件 K 值合计"},
        {"label": "覆盖备件种类", "value": str(covered), "note": f"目标满足概率 {_pct(target_p)}"},
        {"label": "高优先级备件数", "value": str(high_priority), "note": "串联系统相关备件"},
    ]


def _mission_reliability_event_stats(
    reports: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    trend_rows: list[dict[str, Any]],
    probability: float,
    target: float,
) -> list[dict[str, str]]:
    failure_events = sum(_count_events(report, "failure") + _count_events(report, "故障") + int(report.get("lru_failures") or 0) for report in reports)
    delayed = sum(int(report.get("delayed_sorties") or 0) for report in reports)
    risk_points = sum(1 for row in trend_rows if row.get("state") == "风险")
    min_rel = min((float(row.get("reliability_at_dt") or 1) for row in rows), default=1.0)
    return [
        {"label": "评估部件数", "value": str(len(rows)), "note": "参与系统可靠度合成"},
        {"label": "故障事件数", "value": str(failure_events), "note": "样本事件日志与指标汇总"},
        {"label": "风险时点数", "value": str(risk_points), "note": "12h/24h/48h 趋势中的风险点"},
        {"label": "出动延误次数", "value": str(delayed), "note": "影响任务成功概率"},
        {"label": "目标达成", "value": "是" if probability >= target else "否", "note": f"最低部件可靠度 {_pct(min_rel)}"},
    ]


def _downtime_event_stats(reports: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    by_factor = {str(row.get("factor")): int(row.get("count") or 0) for row in rows}
    total = sum(by_factor.values())
    primary = rows[0].get("factor", "-") if rows else "-"
    return [
        {"label": "停机因素总次数", "value": str(total), "note": "四类根因计数合计"},
        {"label": "装备故障次数", "value": str(by_factor.get("装备故障", 0)), "note": "故障和维修进入停机源头"},
        {"label": "备件短缺次数", "value": str(by_factor.get("备件短缺", 0)), "note": "缺件导致维修闭环延长"},
        {"label": "资源/计划延误次数", "value": str(by_factor.get("资源延误", 0) + by_factor.get("计划延误", 0)), "note": "资源排队和波次计划扰动"},
        {"label": "首要因素", "value": str(primary), "note": "贡献度最高的停机因素"},
    ]


def _event_stats_summary(analysis_type: str) -> str:
    return {
        "spare_shortfall": "按仿真样本汇总备件需求、满足、延误、调运和出动延误事件。",
        "carry_list": "按转场参数汇总预计需求、建议携行、覆盖种类和优先级事件。",
        "mission_reliability": "按可靠度评估过程汇总部件、故障、风险时点和出动延误事件。",
        "downtime_factors": "按停机根因汇总装备故障、备件短缺、资源延误和计划延误事件。",
    }.get(analysis_type, "按当前分析过程汇总关键事件。")


def _hhmm(minutes: float) -> str:
    total = int(round(minutes)) % 1440
    return f"{total // 60:02d}{total % 60:02d}"


def _rms_shortfall_metrics(spare_rows: list[dict[str, Any]], aircraft_rows: list[dict[str, Any]]) -> dict[str, float]:
    max_shortage = max((float(row.get("shortage_probability") or 0) for row in spare_rows), default=0.0)
    min_fill = min((float(row.get("fill_rate") or 1.0) for row in spare_rows), default=1.0)
    avg_support_wait = _mean([float(row.get("avg_support_wait_hours") or 0) for row in aircraft_rows])
    avg_spare_delay = _mean([float(row.get("spare_delay_hours") or 0) for row in aircraft_rows])
    return {
        "reliability_index": max(0.0, min(1.0, 1.0 - max_shortage)),
        "maintainability_index": max(0.0, min(1.0, 1.0 / (1.0 + avg_support_wait / 4.0))),
        "supportability_index": max(0.0, min(1.0, min_fill * (1.0 / (1.0 + avg_spare_delay / 2.0)))),
    }


def _aircraft_config_rows(package: dict[str, Any], mission_hours: float, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    members = package.get("objects", {}).get("missionProfiles", [{}])[0].get("combatUnit", {}).get("members", [])
    total_qty = sum(float(row.get("qty") or 0) for row in rows)
    avg_lambda = _mean([float(row.get("lambda") or 0) for row in rows])
    spare_delay = round(avg_lambda / max(total_qty, 1.0), 2)
    aircraft_rows: list[dict[str, Any]] = []
    for index, member in enumerate(members):
        wait = round(0.25 + spare_delay * (1 + (index % 3) * 0.15), 2)
        state = "满足" if spare_delay < 0.5 else "关注" if spare_delay < 1.5 else "风险"
        aircraft_rows.append(
            {
                "tail_number": str(member.get("aircraftNo", f"AC-{index + 1}")),
                "aircraft_type": str(member.get("model", "")),
                "mission_duration_hours": round(float(mission_hours), 2),
                "avg_support_wait_hours": wait,
                "spare_delay_hours": spare_delay,
                "completed_sorties": 0,
                "maintenance_events": 0,
                "state": state,
            }
        )
    return aircraft_rows


def _carry_rms_metrics(rows: list[dict[str, Any]], target_p: float, aircraft_rows: list[dict[str, Any]]) -> dict[str, float]:
    avg_lambda = _mean([float(row.get("lambda") or 0) for row in rows])
    avg_wait = _mean([float(row.get("avg_support_wait_hours") or 0) for row in aircraft_rows])
    total_qty = sum(float(row.get("qty") or 0) for row in rows)
    return {
        "reliability_index": max(0.0, min(1.0, 1.0 / (1.0 + avg_lambda))),
        "maintainability_index": max(0.0, min(1.0, 1.0 / (1.0 + avg_wait))),
        "supportability_index": max(0.0, min(1.0, float(target_p) * (1.0 / (1.0 + avg_lambda / max(total_qty, 1.0))))),
    }


def _downtime_rms_metrics(rows: list[dict[str, Any]], aircraft_rows: list[dict[str, Any]]) -> dict[str, float]:
    contribution = {str(row.get("factor")): float(row.get("contribution") or 0) for row in rows}
    avg_wait = _mean([float(row.get("avg_support_wait_hours") or 0) for row in aircraft_rows])
    avg_spare_delay = _mean([float(row.get("spare_delay_hours") or 0) for row in aircraft_rows])
    failure = contribution.get("装备故障", 0.0)
    spare = contribution.get("备件短缺", 0.0)
    resource = contribution.get("资源延误", 0.0)
    schedule = contribution.get("计划延误", 0.0)
    return {
        "reliability_index": max(0.0, min(1.0, 1.0 - failure)),
        "maintainability_index": max(0.0, min(1.0, 1.0 / (1.0 + avg_wait / 4.0))),
        "supportability_index": max(0.0, min(1.0, 1.0 - min(1.0, spare + resource + schedule + avg_spare_delay / 8.0))),
    }


def _phase_durations_hours(events: list[dict[str, Any]]) -> dict[str, float]:
    ordered = sorted((event for event in events if isinstance(event.get("time"), (int, float))), key=lambda event: float(event["time"]))
    durations: dict[str, float] = {}
    for idx, event in enumerate(ordered):
        phase = str(event.get("phase") or "")
        start = float(event.get("time") or 0)
        end = float(ordered[idx + 1].get("time") or start) if idx + 1 < len(ordered) else start
        if end > start and phase:
            durations[phase] = durations.get(phase, 0.0) + (end - start) / 60.0
    return durations


def _timeline_aircraft_type(report: dict[str, Any], tail: str) -> str:
    # The GPT report stores type in visualization frames, not the compact final timeline.
    # Keep this as a hook for future richer reports and return blank for current artifacts.
    return str(report.get("aircraftTypes", {}).get(tail, "")) if isinstance(report.get("aircraftTypes"), dict) else ""


def _mean(values: list[float]) -> float:
    return statistics.mean(values) if values else 0.0


def _spare_types(package: dict[str, Any]) -> list[str]:
    return sorted({str(a.get("spareType") or a.get("id")) for a in package.get("objects", {}).get("equipmentAssets", []) if a.get("spareType") or a.get("id")})


def _inventory_delta(report: dict[str, Any], spare_type: str) -> float:
    start = _flatten_inventory(report.get("inventoryStart") or report.get("inventory_start") or {})
    end = _flatten_inventory(report.get("inventoryEnd") or report.get("inventory_end") or {})
    return max(0.0, start.get(spare_type, 0.0) - end.get(spare_type, 0.0))


def _flatten_inventory(raw: Any) -> dict[str, float]:
    totals: dict[str, float] = {}
    if isinstance(raw, dict):
        for value in raw.values():
            if isinstance(value, dict):
                for k, v in value.items():
                    if isinstance(v, (int, float)):
                        totals[str(k)] = totals.get(str(k), 0.0) + float(v)
    return totals


def _count_events(report: dict[str, Any], needle: str, spare_type: str | None = None) -> int:
    text = needle.lower()
    total = 0
    for event in report.get("events", []) or report.get("event_log", []):
        blob = json.dumps(event, ensure_ascii=False).lower()
        if text in blob and (spare_type is None or spare_type.lower() in blob):
            total += 1
    return total


def _report_number(report: dict[str, Any], *keys: str) -> float:
    containers = [report]
    metrics = report.get("metrics")
    if isinstance(metrics, dict):
        containers.append(metrics)
    for container in containers:
        for key in keys:
            value = container.get(key)
            if isinstance(value, (int, float)):
                return float(value)
    return 0.0


def _rbd_nodes(package: dict[str, Any]) -> list[dict[str, Any]]:
    mission = package.get("objects", {}).get("missionProfiles", [{}])[0]
    rbd = mission.get("reliabilityBlockDiagram", {})
    nodes = rbd.get("nodes") if isinstance(rbd, dict) else None
    if nodes:
        return [n for n in nodes if isinstance(n, dict)]
    return [a for a in package.get("objects", {}).get("equipmentAssets", []) if isinstance(a, dict)]


def _poisson_min_k(lam: float, target_p: float) -> int:
    cdf = 0.0
    k = 0
    while k < 999:
        cdf += math.exp(-lam) * (lam**k) / math.factorial(k)
        if cdf >= target_p:
            return k
        k += 1
    return k


def _pct(value: float) -> str:
    return f"{round(float(value) * 100, 1)}%"
