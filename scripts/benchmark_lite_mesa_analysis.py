#!/usr/bin/env python3
"""Benchmark the in-memory lite Mesa analysis path with a real Project JSON."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.api import BackendApi
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True, help="Project JSON path")
    parser.add_argument("--analysis-type", default="mission_reliability")
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260621)
    parser.add_argument("--parallel-cores", type=int, default=1)
    parser.add_argument("--sample-timeout-seconds", type=int)
    parser.add_argument("--session-timeout-seconds", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = REPO_ROOT
    project_path = args.project.resolve()
    project = json.loads(project_path.read_text(encoding="utf-8"))
    connection = sqlite3.connect(":memory:")
    initialize_database(connection)
    try:
        with tempfile.TemporaryDirectory() as output_dir:
            api = BackendApi(
                ContractRepository(connection),
                SimulationAdapter(repo_root),
                output_dir=output_dir,
            )
            settings = {
                "samples": args.samples,
                "seed": args.seed,
                "parallelCores": args.parallel_cores,
            }
            if args.sample_timeout_seconds is not None:
                settings["sampleTimeoutSeconds"] = args.sample_timeout_seconds
            if args.session_timeout_seconds is not None:
                settings["sessionTimeoutSeconds"] = args.session_timeout_seconds
            started = time.perf_counter()
            result = api.run_lite_mesa_analysis(
                project,
                analysis_type=args.analysis_type,
                settings=settings,
            )
            elapsed_seconds = time.perf_counter() - started
            failed_samples = result.get("failed_samples") or result.get("errors") or []
            try:
                project_label = str(project_path.relative_to(repo_root))
            except ValueError:
                project_label = str(project_path)
            print(
                json.dumps(
                    {
                        "project": project_label,
                        "project_id": project.get("project_id"),
                        "analysis_type": args.analysis_type,
                        "requested_samples": args.samples,
                        "seed": args.seed,
                        "parallel_cores": args.parallel_cores,
                        "worker_count": result.get("worker_count"),
                        "status": result.get("status"),
                        "completed_samples": result.get("sample_count", 0),
                        "failed_samples": len(failed_samples),
                        "failure_codes": [
                            item.get("error", {}).get("code")
                            for item in failed_samples
                        ],
                        "sample_timeout_seconds": result.get("sample_timeout_seconds"),
                        "session_timeout_seconds": result.get("session_timeout_seconds"),
                        "timings": result.get("timings", {}),
                        "elapsed_seconds": round(elapsed_seconds, 6),
                        "response_bytes": len(json.dumps(result, ensure_ascii=False).encode("utf-8")),
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        connection.close()


if __name__ == "__main__":
    main()
