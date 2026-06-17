#!/usr/bin/env python3
"""Export sampled aviation support visualization frames for static frontend use."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
from typing import Any


ASSET_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=90)
    parser.add_argument("--sample-every", type=int, default=10)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def load_model_class() -> Any:
    spec = importlib.util.spec_from_file_location("spare_mvp_local_aviation_support", ASSET_DIR / "model.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load local aviation support model.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.AviationSupportModel


def export_frames(steps: int, sample_every: int, seed: int) -> list[dict[str, Any]]:
    model_cls = load_model_class()
    model = model_cls(
        ontology_path=str(ASSET_DIR / "ontology.json"),
        use_ontology_scenario=True,
        lru_failure_multiplier=0,
        seed=seed,
    )
    frames = [model.visualization_state()]
    for step in range(1, steps + 1):
        model.step()
        if step % sample_every == 0 or step == steps:
            frames.append(model.visualization_state())
    return frames


def main() -> None:
    args = parse_args()
    frames = export_frames(max(0, args.steps), max(1, args.sample_every), args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"frames": frames}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
