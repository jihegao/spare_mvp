"""Solara sidecar page for interactive aircraft_support_v1 visual simulation."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

import solara
from mesa.visualization import SolaraViz

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_contract.adapter import SimulationAdapter


SOLARA_PROJECT_JSON_ENV = "SPARE_MVP_SOLARA_PROJECT_JSON"
SOLARA_DURATION_MINUTES_ENV = "SPARE_MVP_SOLARA_DURATION_MINUTES"
SOLARA_SEED_ENV = "SPARE_MVP_SOLARA_SEED"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _project_json_path() -> Path:
    configured = os.environ.get(SOLARA_PROJECT_JSON_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    repo_root = _repo_root()
    for candidate in (
        repo_root / "exports" / "frontend_project.json",
        repo_root / "exports" / "project-case-large.json",
        repo_root / "public" / "import-templates" / "canonical_platform_case.json",
    ):
        if candidate.exists():
            return candidate
    return repo_root / "exports" / "frontend_project.json"


def _load_project_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, dict):
        raise ValueError(f"Project JSON must be an object: {path}")
    return payload


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _model_inputs() -> tuple[dict[str, Any], dict[str, Any]]:
    path = _project_json_path()
    project = _load_project_json(path)
    adapter = SimulationAdapter(_repo_root())
    result = adapter.compile_scenario_with_gate(project, model_family="aircraft_support_v1")
    if result.get("status") != "compiled" or not isinstance(result.get("scenario"), dict):
        issues = result.get("issues") or result.get("errors") or []
        raise ValueError(f"Project JSON cannot compile to aircraft_support_v1: {issues}")
    scenario = result["scenario"]
    inputs = copy.deepcopy(scenario["simulation_inputs"])
    inputs.setdefault("time", {})
    inputs["time"]["duration_minutes"] = max(1, _int_env(SOLARA_DURATION_MINUTES_ENV, int(inputs["time"].get("duration_minutes") or 1440)))
    inputs["seed"] = _int_env(SOLARA_SEED_ENV, int(inputs.get("seed") or 1))
    return inputs, {"project": project, "scenario": scenario, "path": str(path)}


INITIAL_INPUTS, INITIAL_SOURCE = _model_inputs()


@solara.component
def MetricsPanel(model: AircraftSupportV1Model) -> None:
    metrics = model.snapshot()
    rows = [
        ("仿真分钟", model.minute),
        ("任务成功率", f"{metrics['mission_success_rate']:.1%}"),
        ("战备完好率", f"{metrics['ready_rate']:.1%}"),
        ("可用飞机", metrics["available_aircraft"]),
        ("维修中", metrics["repairing_count"]),
        ("缺件事件", metrics["shortage_events"]),
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 会话指标",
                "",
                "| 指标 | 当前值 |",
                "| --- | ---: |",
                *[f"| {label} | {value} |" for label, value in rows],
            ]
        )
    )


@solara.component
def AircraftPanel(model: AircraftSupportV1Model) -> None:
    frame = model.visualization_frame(run_id="solara-session", step=model.steps)
    aircraft_rows = [
        f"| {item.get('tail_number')} | {item.get('type')} | {item.get('state')} | {item.get('current_mission_id') or '-'} |"
        for item in frame.get("aircraft", [])
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 飞机状态",
                "",
                "| 编号 | 型号 | 状态 | 任务 |",
                "| --- | --- | --- | --- |",
                *(aircraft_rows or ["| - | - | - | - |"]),
            ]
        )
    )


@solara.component
def EventPanel(model: AircraftSupportV1Model) -> None:
    events = list(model.event_log[-12:])
    event_rows = [
        f"| {item.get('time')} | {item.get('type')} | {str(item.get('message') or '')[:120]} |"
        for item in events
    ]
    solara.Markdown(
        "\n".join(
            [
                "### 事件流",
                "",
                "| 分钟 | 类型 | 事件 |",
                "| ---: | --- | --- |",
                *(event_rows or ["| - | - | 等待模型推进 |"]),
            ]
        )
    )


@solara.component
def SourcePanel(model: AircraftSupportV1Model) -> None:
    source = INITIAL_SOURCE
    project = source["project"]
    scenario = source["scenario"]
    solara.Markdown(
        "\n".join(
            [
                "### 数据来源",
                "",
                f"- Project: `{project.get('project_id') or project.get('scenarioId') or 'unknown'}`",
                f"- Scenario: `{scenario.get('scenario_id')}`",
                f"- JSON: `{source['path']}`",
                f"- Seed: `{model.seed}`",
                f"- Duration minutes: `{model.duration_minutes}`",
            ]
        )
    )


@solara.component
def Page() -> None:
    solara.Style(
        """
        a[href*="solara.dev"],
        .solara-watermark {
            display: none !important;
        }
        .v-main__wrap {
            padding-bottom: 24px;
        }
        """
    )
    model = AircraftSupportV1Model(copy.deepcopy(INITIAL_INPUTS))
    SolaraViz(
        model,
        components=[
            (MetricsPanel, 0),
            (AircraftPanel, 0),
            (EventPanel, 1),
            (SourcePanel, 1),
        ],
        model_params={"inputs": copy.deepcopy(INITIAL_INPUTS)},
        name="aircraft_support_v1 Solara 推演",
        play_interval=250,
        render_interval=10,
    )
