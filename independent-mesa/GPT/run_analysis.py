#!/usr/bin/env python3
"""Run方案二 independent analyses."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common_analyses import ANALYSES, AnalysisRuntime, run_analysis
from independent_mesa_gpt import VisualMissionModel, load_scenario


OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "analyses"


def _metrics(model: VisualMissionModel) -> dict[str, Any]:
    report = model.final_report()
    metrics = report.get("metrics", {})
    return {
        **report,
        "sortie_rate": metrics.get("launchRate", 0),
        "sortie_completion_rate": metrics.get("completionRate", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", choices=sorted(ANALYSES))
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--samples", type=int)
    parser.add_argument("--seed", type=int, default=20260621)
    args = parser.parse_args()
    if not args.all and not args.type:
        parser.error("--type or --all is required")

    package, _ = load_scenario()
    runtime = AnalysisRuntime(
        scheme_label="方案二",
        data_source="independent-mesa/GPT scenario_loader",
        package=package,
        model_factory=lambda pkg, seed: VisualMissionModel(pkg, seed=seed),
        metrics_extractor=_metrics,
        output_dir=OUTPUT_DIR,
        seed=args.seed,
    )
    targets = sorted(ANALYSES) if args.all else [args.type]
    for target in targets:
        paths = run_analysis(runtime, target, samples=args.samples)
        print(f"{target}: {paths['html']}")


if __name__ == "__main__":
    main()
