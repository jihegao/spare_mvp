#!/usr/bin/env python3
"""Monte Carlo sweep runner for the independent Mesa model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from independent_mesa.monte_carlo import MonteCarloRunner


DATA_PATH = Path(__file__).resolve().parent / "data" / "import_package.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "sweep"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=48)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--seed", type=int, default=20260621)
    parser.add_argument("--keep-frames", action="store_true", default=False)
    args = parser.parse_args()

    package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    runner = MonteCarloRunner(package, steps=args.steps, samples=args.samples, seed=args.seed)
    results = runner.run_sweep()
    runner.save_results(results, OUTPUT_DIR / "results.json")
    runner.save_visualization(
        results,
        OUTPUT_DIR / "monte_carlo.html",
        steps=args.steps,
        samples=args.samples,
        seed=args.seed,
    )
    print(f"Sweep results saved to {OUTPUT_DIR / 'results.json'} ({len(results)} combinations)")
    print(f"open {OUTPUT_DIR / 'monte_carlo.html'}")


if __name__ == "__main__":
    main()
