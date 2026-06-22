"""Frame export: collect visualization_state at intervals."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .model import IndependentMesaModel


def export_frames(
    model: IndependentMesaModel,
    steps: int,
    sample_every: int,
) -> list[dict[str, Any]]:
    """Run model for `steps` steps, sampling frames every `sample_every` steps."""
    frames = [model.visualization_state()]
    for step in range(1, steps + 1):
        model.step()
        if step % sample_every == 0 or step == steps:
            frames.append(model.visualization_state())
    return frames


def save_frames_and_metrics(
    model: IndependentMesaModel,
    steps: int,
    sample_every: int,
    output_dir: Path,
) -> None:
    """Run model, save frames.json and metrics.json to output_dir."""
    frames = export_frames(model, steps, sample_every)
    metrics = model.compute_final_metrics()
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "frames.json").write_text(
        json.dumps({"frames": frames}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
