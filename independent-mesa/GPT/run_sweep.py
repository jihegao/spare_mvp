#!/usr/bin/env python3
"""Monte Carlo sweep runner for方案二."""

from __future__ import annotations

import argparse
from pathlib import Path

from independent_mesa_gpt import load_scenario
from independent_mesa_gpt.monte_carlo import MonteCarloRunner


OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "sweep"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=104)
    parser.add_argument("--samples", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20260621)
    args = parser.parse_args()

    package, _ = load_scenario()
    runner = MonteCarloRunner(package, steps=args.steps, samples=args.samples, seed=args.seed)
    results = runner.run_sweep()
    runner.save_results(results, OUTPUT_DIR / "results.json")
    runner.save_visualization(results, OUTPUT_DIR / "monte_carlo.html", steps=args.steps, samples=args.samples, seed=args.seed)
    print(f"Sweep results saved to {OUTPUT_DIR / 'results.json'} ({len(results)} combinations)")
    print(f"open {OUTPUT_DIR / 'monte_carlo.html'}")


if __name__ == "__main__":
    main()
