#!/usr/bin/env python3
"""Reproducible AMD128 F35 Monte Carlo benchmark.

The parent process owns the matrix and evidence file.  Every measured cell is
run in a fresh child process so import/allocator state cannot leak between the
Python and Rust sides.  The live SQLite database is opened read-only and
backed up to a disposable database before a RunService plan is inserted.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterable

try:
    import psutil
except ImportError:  # pragma: no cover - reported when an actual run is requested
    psutil = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DEFAULT_PROJECT_ID = "project-j16-8aircraft-43day-availability-20260727-copy-2"
DEFAULT_DATABASE = Path("/home/g/Models/spare_mvp/runs/system-start/spare_mvp.sqlite3")
PYTHON_BACKEND = "python"
RUST_BACKEND = "rust_event_time_v2"
BACKENDS = (PYTHON_BACKEND, RUST_BACKEND)
CORE_ARTIFACT_KINDS = frozenset({
    "run_config",
    "input_project",
    "compiled_scenario",
    "sample_results",
    "aggregate_result",
    "metrics",
    "report",
    "log",
})


@dataclass(frozen=True)
class Matrix:
    samples: tuple[int, ...] = (32, 128)
    workers: tuple[int, ...] = (1, 8, 32)
    warmup: int = 1
    repeats: int = 6


def self_test() -> None:
    expected_core_artifact_kinds = frozenset({
        "run_config",
        "input_project",
        "compiled_scenario",
        "sample_results",
        "aggregate_result",
        "metrics",
        "report",
        "log",
    })
    if CORE_ARTIFACT_KINDS != expected_core_artifact_kinds:
        raise AssertionError(f"CORE_ARTIFACT_KINDS={sorted(CORE_ARTIFACT_KINDS)!r}")


def digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def parse_ints(value: str, *, name: str) -> tuple[int, ...]:
    values = tuple(int(item.strip()) for item in value.split(",") if item.strip())
    if not values or any(item <= 0 for item in values):
        raise argparse.ArgumentTypeError(f"{name} must contain positive integers")
    return values


def parse_commit(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise argparse.ArgumentTypeError("compiler commit must be exactly 40 lowercase hexadecimal characters")
    return value


def git_commit(path: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def wheel_hashes(path: Path, explicit: Iterable[Path]) -> dict[str, str]:
    candidates = list(explicit)
    for directory in (path / "dist", path / "target" / "wheels"):
        if directory.exists():
            candidates.extend(sorted(directory.glob("*.whl")))
    result: dict[str, str] = {}
    for wheel in sorted(set(candidate.resolve() for candidate in candidates if candidate.exists())):
        result[str(wheel)] = sha256_file(wheel)
    return result


def cpu_frequency() -> dict[str, float | None] | None:
    try:
        value = psutil.cpu_freq(percpu=False)
    except (OSError, AttributeError):
        return None
    if value is None:
        return None
    return {"current_mhz": value.current, "min_mhz": value.min, "max_mhz": value.max}


def system_snapshot() -> dict[str, Any]:
    try:
        load = list(os.getloadavg())
    except OSError:
        load = []
    return {
        "loadavg": load,
        "cpu_count": psutil.cpu_count(logical=True) if psutil else None,
        "physical_cpu_count": psutil.cpu_count(logical=False) if psutil else None,
        "cpu_frequency": cpu_frequency(),
    }


def set_affinity(workers: int) -> dict[str, Any]:
    requested = list(range(workers))
    result: dict[str, Any] = {"requested": requested, "effective": None, "error": None}
    if not hasattr(os, "sched_setaffinity"):
        result["error"] = "sched_setaffinity_unavailable"
        return result
    try:
        os.sched_setaffinity(0, set(requested))
        result["effective"] = sorted(os.sched_getaffinity(0))
    except (OSError, ValueError) as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def output_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file()) if path.exists() else 0


def artifact_kinds(manifest: dict[str, Any] | None) -> list[str]:
    if not manifest:
        return []
    return sorted({str(item.get("kind")) for item in manifest.get("artifacts", []) if item.get("kind")})


def failed_count(payload: dict[str, Any]) -> int | None:
    value = payload.get("failed_sample_count")
    if value is not None:
        return int(value)
    failed = payload.get("failed_samples")
    return len(failed) if isinstance(failed, list) else None


def semantic_summary(sample_results: dict[str, Any], aggregate_result: dict[str, Any]) -> dict[str, Any]:
    sample_keys = ("sample_index", "seed", "sweep", "metrics", "rng_requests", "stop_reason", "terminal_state", "time")
    samples = []
    for sample in sample_results.get("samples") or []:
        if isinstance(sample, dict):
            samples.append({key: sample[key] for key in sample_keys if key in sample})
    return {
        "samples": samples,
        "failed_samples": aggregate_result.get("failed_samples", sample_results.get("failed_samples", [])),
        "aggregate_metrics": aggregate_result.get("aggregate_metrics"),
        "metric_moments": aggregate_result.get("metric_moments"),
        "failed_sample_count": aggregate_result.get("failed_sample_count"),
    }


def artifact_payload(manifest: dict[str, Any] | None, output_dir: Path, kind: str) -> dict[str, Any]:
    for artifact in (manifest or {}).get("artifacts", []):
        if artifact.get("kind") == kind:
            path = output_dir / str(artifact.get("path") or "")
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
    return {}


def validate_core_row(row: dict[str, Any], expected_compiler_commit: str | None = None) -> list[str]:
    errors: list[str] = []
    if row.get("parent_returncode") != 0:
        errors.append(f"parent_returncode={row.get('parent_returncode')!r}")
    if row.get("status") != "succeeded":
        errors.append(f"status={row.get('status')!r}")
    result = row.get("result_summary") if isinstance(row.get("result_summary"), dict) else {}
    run = row.get("run") if isinstance(row.get("run"), dict) else {}
    analysis_status = result.get("analysis_status", run.get("analysis_status"))
    if analysis_status != "not_generated":
        errors.append(f"analysis_status={analysis_status!r}")
    if row.get("failed_sample_count") != 0:
        errors.append(f"failed_sample_count={row.get('failed_sample_count')!r}")
    if row.get("semantic_sample_count") != row.get("samples"):
        errors.append(f"semantic_sample_count={row.get('semantic_sample_count')!r}")
    if row.get("semantic_failed_sample_count") != 0:
        errors.append(f"semantic_failed_sample_count={row.get('semantic_failed_sample_count')!r}")
    workers = row.get("workers")
    samples = row.get("samples")
    expected_affinity = list(range(workers)) if isinstance(workers, int) and workers >= 0 else None
    affinity = row.get("affinity") if isinstance(row.get("affinity"), dict) else {}
    if expected_affinity is None or set(("error", "requested", "effective")) - affinity.keys() or affinity.get("error") is not None or affinity.get("requested") != expected_affinity or affinity.get("effective") != expected_affinity:
        errors.append(f"affinity={affinity!r}")
    expected_worker_count = min(samples, workers) if isinstance(samples, int) and isinstance(workers, int) and samples >= 0 and workers >= 0 else None
    if expected_worker_count is None or "worker_count" not in run or run.get("worker_count") != expected_worker_count:
        errors.append(f"worker_count={run.get('worker_count')!r}")
    actual_kinds = frozenset(row.get("artifact_kinds") or ())
    if actual_kinds != CORE_ARTIFACT_KINDS:
        errors.append(f"artifact_kinds={sorted(actual_kinds)!r}")
    if row.get("backend") == RUST_BACKEND and expected_compiler_commit:
        engine_metadata = run.get("engine_metadata") if isinstance(run.get("engine_metadata"), dict) else {}
        actual_commit = engine_metadata.get("build_commit")
        if actual_commit != expected_compiler_commit:
            errors.append(f"engine_metadata.build_commit={actual_commit!r}")
    return errors


def build_selector_config(base_plan: dict[str, Any], backend: str, samples: int, workers: int) -> dict[str, Any]:
    config = json.loads(json.dumps(base_plan.get("config") or {}))
    config["samples"] = samples
    config["parallelCores"] = workers
    requests = config.setdefault("analysisRequests", {})
    large_sample = requests.setdefault("largeSample", {})
    large_sample.update({
        "enabled": True,
        "samples": samples,
        "sweep": large_sample.get("sweep") or {
            "failureRates": [0.06],
            "spareMultipliers": [1],
            "supportCapacities": [1],
        },
    })
    config["monteCarloBackend"] = backend
    config["monteCarloOutputScope"] = "core"
    return config


def backup_database(source: Path, destination: Path) -> None:
    source_uri = source.resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source_connection:
        with sqlite3.connect(destination) as destination_connection:
            source_connection.backup(destination_connection)


def prepare_run_database(source: Path, base_plan: dict[str, Any], backend: str, samples: int, workers: int, cache_dir: Path, root: Path) -> tuple[Path, str]:
    fd, name = tempfile.mkstemp(prefix="f35-mc-", suffix=".sqlite3", dir=root)
    os.close(fd)
    destination = Path(name)
    backup_database(source, destination)
    plan = json.loads(json.dumps(base_plan))
    plan_id = f"benchmark-{backend}-{samples}-{workers}-{os.getpid()}-{time.time_ns()}"
    plan["experiment_plan_id"] = plan_id
    plan["status"] = "draft"
    plan["config"] = build_selector_config(base_plan, backend, samples, workers)
    plan["canonical_fingerprint"] = digest(plan["config"])
    with sqlite3.connect(destination) as connection:
        from src.spare_mvp_backend.repository import ContractRepository

        ContractRepository(connection).upsert_experiment_plan(plan)
    return destination, plan_id


def run_backend_child(args: argparse.Namespace) -> None:
    affinity = set_affinity(args.child_workers)
    started = time.perf_counter()
    from src.spare_mvp_backend.repository import ContractRepository
    from src.spare_mvp_backend.run_service import RunService
    from src.spare_mvp_contract.adapter import SimulationAdapter

    output_dir = Path(args.child_output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.child_database) as connection:
        repository = ContractRepository(connection)
        service = RunService(repository, SimulationAdapter(ROOT), output_dir=output_dir)
        run = service.submit_run({
            "project_id": args.child_project_id,
            "experiment_plan_id": args.child_plan_id,
            "model_family": "aircraft_support_v1",
            "run_type": "monte_carlo",
            "formal_run": False,
        })
        detail = repository.get_run_detail(run["run_id"])
    result = detail.get("result_summary") or {}
    stored_run = detail.get("run") or run
    finished = time.perf_counter()
    atomic_write_json(Path(args.child_measurement_output), {
        "run_service_finished": True,
        "run_service_end_to_end_seconds": stored_run.get("run_service_end_to_end_seconds"),
    })
    sample_results = artifact_payload(detail.get("artifact_manifest"), output_dir, "sample_results")
    aggregate_result = artifact_payload(detail.get("artifact_manifest"), output_dir, "aggregate_result")
    semantic = semantic_summary(sample_results, aggregate_result)
    semantic_failed_samples = semantic.get("failed_samples")
    semantic_failed_count = semantic.get("failed_sample_count")
    if semantic_failed_count is None and isinstance(semantic_failed_samples, list):
        semantic_failed_count = len(semantic_failed_samples)
    stored_timings = stored_run.get("timings") if isinstance(stored_run.get("timings"), dict) else {}
    result_timings = result.get("timings") if isinstance(result.get("timings"), dict) else {}
    timings = {**stored_timings, **result_timings}
    for timing_source in (stored_run, result):
        if timing_source.get("run_service_end_to_end_seconds") is not None:
            timings.setdefault("run_service_end_to_end_seconds", timing_source["run_service_end_to_end_seconds"])
    result_failed_count = failed_count(result)
    payload = {
        "backend": args.child_backend,
        "status": stored_run.get("status"),
        "run_id": stored_run.get("run_id"),
        "run": stored_run,
        "result_summary": result,
        "artifact_kinds": artifact_kinds(detail.get("artifact_manifest")),
        "failed_sample_count": result_failed_count if result_failed_count is not None else failed_count(stored_run),
        "timings": timings,
        "throughput": result.get("throughput") or stored_run.get("throughput"),
        "cache_status": stored_run.get("plan_cache_status") or result.get("plan_cache_status") or result.get("execution_metadata", {}).get("plan_cache_status") or "not_reported",
        "output_bytes": output_bytes(output_dir),
        "affinity": affinity,
        "wall_seconds": finished - started,
        "cache_dir": str(args.child_cache_dir),
        "semantic_digest": digest(semantic),
        "semantic_sample_count": len(semantic.get("samples") or []),
        "semantic_failed_sample_count": semantic_failed_count,
        "system": system_snapshot(),
    }
    atomic_write_json(Path(args.child_output), payload)


def descendants_rss(process: psutil.Process) -> int:
    if psutil is None:
        return 0
    try:
        processes = [process, *process.children(recursive=True)]
    except psutil.Error:
        processes = [process]
    total = 0
    for child in processes:
        try:
            total += child.memory_info().rss
        except psutil.Error:
            continue
    return total


def run_child(command: list[str], result_path: Path, measurement_marker: Path, interval: float) -> dict[str, Any]:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    peak = 0
    measurement_finished = False
    while process.poll() is None:
        if measurement_marker.exists():
            measurement_finished = True
        if not measurement_finished:
            peak = max(peak, descendants_rss(psutil.Process(process.pid)))
        time.sleep(interval)
    stdout, stderr = process.communicate()
    if not measurement_finished and measurement_marker.exists():
        measurement_finished = True
    if not measurement_finished and psutil.pid_exists(process.pid):
        peak = max(peak, descendants_rss(psutil.Process(process.pid)))
    if not result_path.exists():
        raise RuntimeError(f"child did not write {result_path}: rc={process.returncode} stderr={stderr[-1000:]}")
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    payload.update({"parent_returncode": process.returncode, "parent_peak_rss_bytes": peak, "parent_stdout": stdout[-2000:], "parent_stderr": stderr[-2000:]})
    return payload


def canonical_source(database: Path, project_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    from jsonschema import Draft202012Validator
    from src.spare_mvp_backend.project_payload import ProjectJsonExporter
    from src.spare_mvp_backend.repository import ContractRepository
    from src.spare_mvp_contract.adapter import SimulationAdapter

    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        repository = ContractRepository(connection)
        raw = repository.get_project(project_id)
        plans = repository.list_experiment_plans(project_id)
    base_plan = max(plans, key=lambda plan: int(((plan.get("config") or {}).get("analysisRequests") or {}).get("largeSample", {}).get("samples") or 0))
    project = ProjectJsonExporter().export(raw)
    scenario = SimulationAdapter(ROOT).compile_scenario(project)
    inputs = scenario["simulation_inputs"]
    schema = json.loads((ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(inputs)
    inputs["disable_visualization_frames"] = True
    return project, inputs, base_plan


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--self-test", action="store_true", help="validate benchmark harness constants without running a benchmark")
    result.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    result.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    result.add_argument("--compiler-root", type=Path, help="optional sim_engine_compiler checkout recorded in evidence metadata")
    result.add_argument("--compiler-commit", type=parse_commit, help="explicit 40-character compiler build commit for archived checkouts")
    result.add_argument("--output", type=Path, required=False, default=Path("/tmp/f35-rust-monte-carlo.json"))
    result.add_argument("--samples", default=None, help="comma-separated sample counts; default 32,128")
    result.add_argument("--workers", default=None, help="comma-separated worker counts; default 1,8,32")
    result.add_argument("--warmup", type=int, default=1)
    result.add_argument("--repeats", type=int, default=6)
    result.add_argument("--smoke", action="store_true", help="run one 32-sample/one-worker pair and one measured repeat")
    result.add_argument("--rss-interval-ms", type=int, default=20)
    result.add_argument("--wheel", action="append", type=Path, default=[])
    result.add_argument("--child-backend", choices=BACKENDS, help=argparse.SUPPRESS)
    result.add_argument("--child-database", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--child-project-id", help=argparse.SUPPRESS)
    result.add_argument("--child-plan-id", help=argparse.SUPPRESS)
    result.add_argument("--child-output-dir", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--child-output", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--child-measurement-output", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--child-cache-dir", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--child-workers", type=int, help=argparse.SUPPRESS)
    result.add_argument("--child-samples", type=int, help=argparse.SUPPRESS)
    return result


def main() -> None:
    args = parser().parse_args()
    if args.self_test:
        self_test()
        print("benchmark self-test: ok")
        return
    if psutil is None:
        raise SystemExit("psutil is required for an actual benchmark run; install it in the benchmark environment")
    if args.child_backend:
        sys.path.insert(0, str(ROOT))
        run_backend_child(args)
        return
    samples = parse_ints(args.samples or ("32" if args.smoke else "32,128"), name="--samples")
    workers = parse_ints(args.workers or ("1" if args.smoke else "1,8,32"), name="--workers")
    repeats = 1 if args.smoke else args.repeats
    if args.warmup < 0 or repeats < 1:
        raise SystemExit("--warmup must be >= 0 and --repeats must be positive")
    compiler_root = args.compiler_root.resolve() if args.compiler_root else None
    compiler_commit = args.compiler_commit or (git_commit(compiler_root) if compiler_root else None)
    project, inputs, base_plan = canonical_source(args.database, args.project_id)
    base_config = base_plan.get("config") or {}
    base_large_sample = (base_config.get("analysisRequests") or {}).get("largeSample") or {}
    with tempfile.TemporaryDirectory(prefix="f35-rust-mc-", dir=args.output.parent if args.output.parent.exists() else None) as temporary:
        temporary_root = Path(temporary)
        canonical_dir = temporary_root / "canonical"
        canonical_dir.mkdir()
        (canonical_dir / "simulation-inputs.json").write_text(json.dumps(inputs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report: dict[str, Any] = {
            "schema_version": "rust-monte-carlo-benchmark-v1",
            "status": "running",
            "source": {"database": str(args.database), "project_id": args.project_id, "project_sha256": digest(project), "canonical_inputs_sha256": digest(inputs), "base_experiment_plan_id": base_plan.get("experiment_plan_id"), "base_canonical_fingerprint": base_plan.get("canonical_fingerprint"), "base_config_sha256": digest(base_config), "base_seed": base_config.get("seed"), "base_sweep": base_large_sample.get("sweep"), "spare_mvp_commit": git_commit(ROOT), "compiler_commit": compiler_commit, "compiler_root": str(compiler_root) if compiler_root else None, "wheel_sha256": wheel_hashes(compiler_root, args.wheel) if compiler_root else {}, "python": sys.version, "platform": platform.platform()},
            "matrix": asdict(Matrix(samples=samples, workers=workers, warmup=args.warmup, repeats=repeats)),
            "scope": "core Monte Carlo only; no analysis requests or analysis-module artifacts",
            "rows": [],
            "pairs": [],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(args.output, report)
        for sample_count in samples:
            for worker_count in workers:
                pair_id = f"samples={sample_count},workers={worker_count}"
                cell_dir = temporary_root / f"cell-{sample_count}-{worker_count}"
                cache_dir = cell_dir / "sim-engine-cache"
                cache_dir.mkdir(parents=True, exist_ok=True)
                for warmup in range(args.warmup):
                    for backend in BACKENDS:
                        row = run_one(args, report, base_plan, temporary_root, cache_dir, backend, sample_count, worker_count, warmup, "warmup", pair_id)
                        report["rows"].append(row)
                        atomic_write_json(args.output, report)
                        if row.get("validation_errors"):
                            report["status"] = "failed_closed"
                            atomic_write_json(args.output, report)
                            raise SystemExit(f"core contract failed: {row['validation_errors']}")
                for repeat in range(repeats):
                    order = BACKENDS if repeat % 2 == 0 else tuple(reversed(BACKENDS))
                    pair_rows = []
                    for order_index, backend in enumerate(order):
                        row = run_one(args, report, base_plan, temporary_root, cache_dir, backend, sample_count, worker_count, repeat, "measurement", pair_id, order_index)
                        report["rows"].append(row)
                        pair_rows.append(row)
                        atomic_write_json(args.output, report)
                        if row.get("validation_errors"):
                            report["status"] = "failed_closed"
                            atomic_write_json(args.output, report)
                            raise SystemExit(f"core contract failed: {row['validation_errors']}")
                    if len({row.get("semantic_digest") for row in pair_rows}) != 1:
                        report["status"] = "failed_closed"
                        report["pairs"].append({"pair_id": pair_id, "repeat": repeat, "order": list(order), "rows": [row["row_id"] for row in pair_rows], "semantic_match": False})
                        atomic_write_json(args.output, report)
                        raise SystemExit(f"semantic core mismatch in {pair_id} repeat={repeat}")
                    report["pairs"].append({"pair_id": pair_id, "repeat": repeat, "order": list(order), "rows": [row["row_id"] for row in pair_rows], "semantic_match": True})
                    atomic_write_json(args.output, report)
        report["status"] = "passed"
        report["summary"] = summarize(report["rows"])
        atomic_write_json(args.output, report)


def run_one(args: argparse.Namespace, report: dict[str, Any], base_plan: dict[str, Any], temporary_root: Path, cache_dir: Path, backend: str, samples: int, workers: int, repeat: int, phase: str, pair_id: str, order_index: int = 0) -> dict[str, Any]:
    database, plan_id = prepare_run_database(args.database, base_plan, backend, samples, workers, cache_dir, temporary_root)
    run_dir = temporary_root / f"{phase}-{backend}-{samples}-{workers}-{repeat}-{order_index}"
    run_dir.mkdir(parents=True, exist_ok=True)
    link = run_dir / "sim-engine-cache"
    try:
        link.symlink_to(cache_dir, target_is_directory=True)
    except FileExistsError:
        pass
    child_output = run_dir / "child.json"
    measurement_marker = run_dir / "measurement-marker.json"
    command = [sys.executable, str(Path(__file__).resolve()), "--child-backend", backend, "--child-database", str(database), "--child-project-id", args.project_id, "--child-plan-id", plan_id, "--child-output-dir", str(run_dir), "--child-output", str(child_output), "--child-measurement-output", str(measurement_marker), "--child-cache-dir", str(cache_dir), "--child-workers", str(workers), "--child-samples", str(samples)]
    before = system_snapshot()
    started = time.perf_counter()
    payload = run_child(command, child_output, measurement_marker, max(0.001, args.rss_interval_ms / 1000))
    finished = time.perf_counter()
    after = system_snapshot()
    try:
        database.unlink()
    except OSError:
        pass
    cleanup_error = None
    try:
        if link.is_symlink():
            link.unlink()
        shutil.rmtree(run_dir)
    except OSError as exc:
        cleanup_error = f"run_dir cleanup failed: {type(exc).__name__}: {exc}"
    payload.update({"row_id": f"{pair_id}:{phase}:{repeat}:{backend}", "pair_id": pair_id, "phase": phase, "repeat": repeat, "order_index": order_index, "samples": samples, "workers": workers, "backend": backend, "wall_seconds_parent": finished - started, "system_before": before, "system_after": after})
    payload["validation_errors"] = validate_core_row(payload, args.compiler_commit)
    if cleanup_error:
        payload["validation_errors"].append(cleanup_error)
    return payload


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for sample_count in sorted({row.get("samples") for row in rows if row.get("phase") == "measurement"}):
        for worker_count in sorted({row.get("workers") for row in rows if row.get("phase") == "measurement" and row.get("samples") == sample_count}):
            cell = f"samples={sample_count},workers={worker_count}"
            by_backend: dict[str, Any] = {}
            for backend in BACKENDS:
                selected = [row for row in rows if row.get("phase") == "measurement" and row.get("samples") == sample_count and row.get("workers") == worker_count and row.get("backend") == backend and row.get("parent_returncode") == 0]
                service_times = [float(row["timings"]["run_service_end_to_end_seconds"]) for row in selected if row.get("timings", {}).get("run_service_end_to_end_seconds") is not None]
                child_walls = [float(row["wall_seconds"]) for row in selected if row.get("wall_seconds") is not None]
                parent_walls = [float(row["wall_seconds_parent"]) for row in selected]
                throughputs = [float(value) for row in selected if (value := row.get("throughput")) is not None]
                rss = [int(row["parent_peak_rss_bytes"]) for row in selected if row.get("parent_peak_rss_bytes") is not None]
                by_backend[backend] = {"count": len(selected), "median_run_service_end_to_end_seconds": statistics.median(service_times) if service_times else None, "median_child_wall_seconds": statistics.median(child_walls) if child_walls else None, "median_parent_process_seconds": statistics.median(parent_walls) if parent_walls else None, "median_throughput": statistics.median(throughputs) if throughputs else None, "median_peak_rss_bytes": statistics.median(rss) if rss else None}
            python_time = by_backend.get(PYTHON_BACKEND, {}).get("median_run_service_end_to_end_seconds")
            rust_time = by_backend.get(RUST_BACKEND, {}).get("median_run_service_end_to_end_seconds")
            by_backend["speedup_python_over_rust"] = python_time / rust_time if python_time and rust_time else None
            result[cell] = by_backend
    return result


if __name__ == "__main__":
    main()
