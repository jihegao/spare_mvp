#!/usr/bin/env python3
"""Run the GPT visual Mesa model and write replay artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path

from independent_mesa_gpt import VisualMissionModel, load_scenario
from independent_mesa_gpt.visualization import write_outputs


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "single-run"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=104, help="Number of 15-minute ticks. 104 covers 26 hours.")
    parser.add_argument("--sample-every", type=int, default=1, help="Frame sampling interval in ticks.")
    parser.add_argument("--seed", type=int, default=20260621)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    package, input_changes = load_scenario()
    model = VisualMissionModel(package, seed=args.seed)
    write_outputs(
        model,
        package,
        input_changes,
        args.output_dir,
        steps=args.steps,
        sample_every=args.sample_every,
    )
    print(f"wrote {args.output_dir}")
    print(f"open {args.output_dir / 'visualization.html'}")


if __name__ == "__main__":
    main()
