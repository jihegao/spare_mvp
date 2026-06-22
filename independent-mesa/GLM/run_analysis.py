#!/usr/bin/env python3
"""Run方案一 independent analyses."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common_analyses import ANALYSES, AnalysisRuntime, run_analysis
from independent_mesa.model import IndependentMesaModel


DATA_PATH = Path(__file__).resolve().parent / "data" / "import_package.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "analyses"


def _metrics(model: IndependentMesaModel) -> dict[str, Any]:
    metrics = model.compute_final_metrics()
    return {
        **metrics,
        "events": model.event_log,
        "spare_requests": model.spare_requests,
        "spare_fulfilled": model.spare_fulfilled,
        "delayed_sorties": model.delayed_sorties,
        "transport_orders": getattr(model.support_network, "_order_counter", 0),
        "arrived_transport_orders": len(model.support_network.arrived_order_delays),
        "inventoryStart": {},
        "inventoryEnd": {node_id: dict(node.inventory) for node_id, node in model.support_network.nodes.items()},
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

    package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    runtime = AnalysisRuntime(
        scheme_label="方案一",
        data_source=str(DATA_PATH),
        package=package,
        model_factory=lambda pkg, seed: IndependentMesaModel(pkg, steps=48, seed=seed),
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
