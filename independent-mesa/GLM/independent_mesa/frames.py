"""Frame export: collect visualization_state at intervals."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .model import IndependentMesaModel
from .visualization import write_outputs as write_visualization


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
    """Run model, save frames.json, metrics.json and visualization.html to output_dir."""
    write_visualization(model, output_dir, steps=steps, sample_every=sample_every)
