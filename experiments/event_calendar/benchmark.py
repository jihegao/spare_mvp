"""Reproducible differential benchmark, without modifying the source database."""
from __future__ import annotations

import argparse
import copy
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import platform
import sqlite3
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from jsonschema import Draft202012Validator
import simpy
from experiments.event_calendar.runtime import CalendarModel, SimpyCalendarModel
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def terminal_state(model):
    return {
        "aircraft": [asdict(x) for x in model.aircraft],
        "missions": [asdict(x) for x in model.missions],
        "jobs": [asdict(x) for x in model.jobs],
        "nodes": model.nodes,
        "shipments": [asdict(x) for x in model.transport_shipments],
        "transits": [asdict(x) for x in model.resource_transits],
        "rng": model.rng.getstate(), "steps": model.steps,
    }


def first_difference(a, b, path="root"):
    if type(a) is not type(b):
        return path + ": type"
    if isinstance(a, dict):
        if a.keys() != b.keys():
            return path + ": keys"
        for key in a:
            diff = first_difference(a[key], b[key], f"{path}.{key}")
            if diff:
                return diff
    elif isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for index, (left, right) in enumerate(zip(a, b)):
            diff = first_difference(left, right, f"{path}[{index}]")
            if diff:
                return diff
    elif a != b:
        return f"{path}: {a!r} != {b!r}"
    return None


def execute(cls, inputs):
    start = time.perf_counter()
    model = cls(inputs)
    initialized = time.perf_counter()
    result = model.run()
    finished = time.perf_counter()
    return model, result, {
        "init_seconds": initialized - start,
        "run_seconds": finished - initialized,
        "total_seconds": finished - start,
        "executed_ticks": getattr(model, "executed_ticks", model.steps),
        "skipped_ticks": getattr(model, "skipped_ticks", 0),
    }


def benchmark(inputs, seeds, repeats):
    rows = []
    engines = [AircraftSupportV1Model, CalendarModel, SimpyCalendarModel]
    # Warm all implementations, outside reported timings.
    for cls in engines:
        execute(cls, inputs)
    for seed in seeds:
        seeded = copy.deepcopy(inputs)
        seeded["seed"] = seed
        for repeat in range(repeats):
            outputs = {}
            # Rotate order to reduce consistent thermal/cache ordering bias.
            order = engines[repeat % 3:] + engines[:repeat % 3]
            for cls in order:
                model, result, timing = execute(cls, seeded)
                outputs[cls.__name__] = (result, terminal_state(model))
                rows.append({"seed": seed, "repeat": repeat, "engine": cls.__name__,
                             "result_sha256": digest(result), **timing})
            reference = outputs["AircraftSupportV1Model"]
            for name, actual in outputs.items():
                diff = first_difference(reference, actual)
                if diff:
                    raise AssertionError(f"seed={seed}, repeat={repeat}, {name}: {diff}")
            print(f"PASS seed={seed} repeat={repeat}", flush=True)
    medians = {cls.__name__: statistics.median(r["total_seconds"] for r in rows if r["engine"] == cls.__name__) for cls in engines}
    return {"all_exact_equal": True, "rows": rows, "median_total_seconds": medians,
            "speedup": {name: medians["AircraftSupportV1Model"] / value for name, value in medians.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--database", type=Path)
    source.add_argument("--project", type=Path)
    parser.add_argument("--project-id", action="append")
    parser.add_argument("--seeds", default="0,1,2")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    if args.database and not args.project_id:
        parser.error("--database requires --project-id")
    if args.database:
        with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as conn:
            repo = ContractRepository(conn)
            projects = [repo.get_project(pid) for pid in args.project_id]
    else:
        projects = [json.loads(args.project.read_text())]
    report = {
        "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "python": sys.version, "platform": platform.platform(), "simpy": simpy.__version__,
        "runtime_sha256": hashlib.sha256(Path(__file__).with_name("runtime.py").read_bytes()).hexdigest(),
        "timing_scope": "in-process model initialization + run; excludes Project export/Adapter and file I/O",
        "cases": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for raw in projects:
        started = time.perf_counter()
        project = ProjectJsonExporter().export(raw)
        scenario = SimulationAdapter(ROOT).compile_scenario(project, model_family="aircraft_support_v1")
        compile_seconds = time.perf_counter() - started
        inputs = scenario["simulation_inputs"]
        schema = json.loads((ROOT / "contracts/aircraft_support_v1_input.schema.json").read_text())
        Draft202012Validator(schema).validate(inputs)
        inputs["disable_visualization_frames"] = True
        print("CASE", project["project_id"], inputs["time"], flush=True)
        result = benchmark(inputs, [int(s) for s in args.seeds.split(",")], args.repeats)
        report["cases"].append({"project_id": project["project_id"], "project_sha256": digest(project),
                                "inputs_sha256": digest(inputs), "compile_seconds": compile_seconds, **result})
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(result["speedup"]), flush=True)


if __name__ == "__main__":
    main()
