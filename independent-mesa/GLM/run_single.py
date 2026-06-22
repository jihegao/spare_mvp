#!/usr/bin/env python3
"""Single scenario runner for the independent Mesa model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from independent_mesa.frames import save_frames_and_metrics
from independent_mesa.model import IndependentMesaModel


DATA_PATH = Path(__file__).resolve().parent / "data" / "import_package.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "single-run"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=48)
    parser.add_argument("--sample-every", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260621)
    args = parser.parse_args()

    package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    model = IndependentMesaModel(package, steps=args.steps, seed=args.seed)
    save_frames_and_metrics(model, args.steps, args.sample_every, OUTPUT_DIR)
    print(f"Frames, metrics and visualization saved to {OUTPUT_DIR}")
    print(f"open {OUTPUT_DIR / 'visualization.html'}")


if __name__ == "__main__":
    main()
