#!/usr/bin/env python3
"""Write or check M9.6 platform case package golden fixtures."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.m9_6_case_package import (
    m9_6_golden_fixture_drift,
    write_m9_6_golden_fixtures,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write M9.6 golden fixtures")
    parser.add_argument("--check", action="store_true", help="check M9.6 golden fixtures for drift")
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")

    if args.write:
        write_m9_6_golden_fixtures(REPO_ROOT)
        print("wrote M9.6 golden fixtures")
        return 0

    drifted = m9_6_golden_fixture_drift(REPO_ROOT)
    if drifted:
        print("M9.6 golden fixtures are missing or stale:")
        for path in drifted:
            print(f"- {path}")
        return 1
    print("M9.6 golden fixtures are current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
