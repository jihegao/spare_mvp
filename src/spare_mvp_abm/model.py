"""Compatibility shim for the legacy project-level smoke model.

The aviation support scenario package lives under
`spare_mvp_abm.aviation_support.model`. New project-level smoke scenarios
should import `SmokeSpareMvpModel` from `spare_mvp_abm.smoke_model`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

try:
    from .smoke_model import SmokeSpareMvpModel
except ImportError:  # Support direct file loading by the Mesa experiment runner.
    smoke_model_path = Path(__file__).with_name("smoke_model.py")
    spec = importlib.util.spec_from_file_location("spare_mvp_smoke_model", smoke_model_path)
    if spec is None or spec.loader is None:
        raise
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    SmokeSpareMvpModel = module.SmokeSpareMvpModel

SpareMvpModel = SmokeSpareMvpModel

__all__ = ["SmokeSpareMvpModel", "SpareMvpModel"]
