#!/usr/bin/env python3
"""Write or check Phase 6P simulation-analysis case fixtures."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.simulation_analysis_cases import (
    simulation_analysis_case_fixture_drift,
    write_simulation_analysis_case_fixtures,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write Phase 6P golden fixtures")
    parser.add_argument("--check", action="store_true", help="check Phase 6P golden fixtures for drift")
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")

    if args.write:
        write_simulation_analysis_case_fixtures(REPO_ROOT)
        print("wrote Phase 6P simulation-analysis fixtures")
        return 0

    drifted = simulation_analysis_case_fixture_drift(REPO_ROOT)
    if drifted:
        print("Phase 6P simulation-analysis fixtures are missing or stale:")
        for path in drifted:
            print(f"- {path}")
        return 1
    print("Phase 6P simulation-analysis fixtures are current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
