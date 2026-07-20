#!/usr/bin/env python3
"""Write or check the aircraft_support_v1 contract fixture identity chain."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_contract.adapter import SimulationAdapter


FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures"
PROJECT_PATH = FIXTURE_DIR / "aircraft_support_v1_project.json"
SCENARIO_PATH = FIXTURE_DIR / "aircraft_support_v1_scenario.json"
CHAIN_PATHS = (
    FIXTURE_DIR / "aircraft_support_v1_run.json",
    FIXTURE_DIR / "aircraft_support_v1_result.json",
    FIXTURE_DIR / "aircraft_support_v1_artifact_manifest.json",
)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_contract_fixtures(*, scenario_id: str) -> dict[Path, dict[str, Any]]:
    project = _load(PROJECT_PATH)
    scenario = SimulationAdapter(REPO_ROOT).compile_scenario(project, model_family="aircraft_support_v1")
    scenario.pop("compiled_at", None)
    scenario["scenario_id"] = scenario_id

    payloads = {SCENARIO_PATH: scenario}
    for path in CHAIN_PATHS:
        payload = copy.deepcopy(_load(path))
        payload["scenario_id"] = scenario_id
        payload["scenario_version"] = scenario["scenario_version"]
        payloads[path] = payload
    return payloads


def fixture_drift(*, scenario_id: str) -> list[str]:
    return [
        str(path.relative_to(REPO_ROOT))
        for path, expected in build_contract_fixtures(scenario_id=scenario_id).items()
        if not path.exists() or _load(path) != expected
    ]


def write_fixtures(*, scenario_id: str) -> None:
    for path, payload in build_contract_fixtures(scenario_id=scenario_id).items():
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--scenario-id", required=True)
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")

    if args.write:
        write_fixtures(scenario_id=args.scenario_id)
        print("wrote aircraft_support_v1 contract fixtures")
        return 0

    drifted = fixture_drift(scenario_id=args.scenario_id)
    if drifted:
        print("aircraft_support_v1 contract fixtures are missing or stale:")
        for path in drifted:
            print(f"- {path}")
        return 1
    print("aircraft_support_v1 contract fixtures are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
