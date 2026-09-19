"""Read-only 43-day route comparison. Raw project data stays outside the report."""
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

import simpy
from jsonschema import Draft202012Validator
from experiments.compiled_routes.ir import CompiledStructure
from experiments.compiled_routes.runtime import TriggeredModel, CompiledModel, SimpyProcessModel, ParallelDAGModel, SimpyDAGModel
from experiments.compiled_routes.validation import CheckedMixin, compare
from experiments.event_calendar.benchmark import digest, first_difference, terminal_state
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter

ENGINES = (AircraftSupportV1Model, TriggeredModel, CompiledModel, SimpyProcessModel, ParallelDAGModel, SimpyDAGModel)


def create(cls, inputs, ir):
    return cls(inputs, ir) if issubclass(cls, CompiledModel) else cls(inputs)


def execute(cls, inputs, ir):
    start = time.perf_counter()
    model = create(cls, inputs, ir)
    initialized = time.perf_counter()
    result = model.run()
    finished = time.perf_counter()
    return model, result, {"init_seconds": initialized - start, "run_seconds": finished - initialized,
                           "total_seconds": finished - start,
                           "transition_times": getattr(model, "executed_ticks", model.steps),
                           "resource_dispatch_passes": getattr(model, "resource_dispatch_passes", model.steps),
                           "resource_jobs_examined": getattr(model, "resource_jobs_examined", None),
                           "dag_unlocked_nodes": getattr(model, "dag_unlocked_nodes", 0),
                           "retained_job_records": len(model.jobs), "event_count": len(result["events"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--seeds", default="0,1,7")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as conn:
        raw = ContractRepository(conn).get_project(args.project_id)
    start = time.perf_counter()
    project = ProjectJsonExporter().export(raw)
    inputs = SimulationAdapter(ROOT).compile_scenario(project)["simulation_inputs"]
    adapter_seconds = time.perf_counter() - start
    Draft202012Validator(json.loads((ROOT / "contracts/aircraft_support_v1_input.schema.json").read_text())).validate(inputs)
    inputs["disable_visualization_frames"] = True
    start = time.perf_counter()
    ir = CompiledStructure.compile(inputs)
    ir_seconds = time.perf_counter() - start
    report = {"status": "running", "project_id": args.project_id, "project_sha256": digest(project),
              "inputs_sha256": digest(inputs), "python": sys.version, "platform": platform.platform(),
              "simpy": simpy.__version__, "source_database": str(args.database),
              "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*.py")},
              "adapter_seconds": adapter_seconds, "ir_compile_seconds": ir_seconds,
              "time": inputs["time"], "ir": ir.summary(), "rows": [], "comparisons": [], "invariants": [],
              "scope": "single-process init+run+materialization; excludes shared IR compile, adapter, JSON I/O, API and MC orchestration"}
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    save()
    try:
        # Candidate warmups double as real-case invariant checks. Baseline is
        # warmed separately. None of these instrumented times enter the table.
        warm_inputs = copy.deepcopy(inputs)
        warm_inputs["seed"] = int(args.seeds.split(",")[0])
        for cls in ENGINES:
            if cls is AircraftSupportV1Model:
                execute(cls, warm_inputs, ir)
            else:
                checked = type("Checked" + cls.__name__, (CheckedMixin, cls), {})
                model = create(checked, warm_inputs, ir)
                model.run()
                report["invariants"].append({"engine": cls.__name__, "seed": warm_inputs["seed"], "checks": model.invariant_checks})
            print("WARM", cls.__name__, flush=True)
        for seed in map(int, args.seeds.split(",")):
            seeded = copy.deepcopy(inputs)
            seeded["seed"] = seed
            for repeat in range(args.repeats):
                outputs, models = {}, {}
                offset = (repeat + seed) % len(ENGINES)
                for cls in ENGINES[offset:] + ENGINES[:offset]:
                    model, result, timing = execute(cls, seeded, ir)
                    models[cls.__name__], outputs[cls.__name__] = model, result
                    report["rows"].append({"engine": cls.__name__, "seed": seed, "repeat": repeat,
                        "result_sha256": digest(result), "metrics": result["metrics"], **timing})
                    print("RUN", seed, repeat, cls.__name__, round(timing["total_seconds"], 4), flush=True)
                baseline = outputs["AircraftSupportV1Model"]
                for name in ("TriggeredModel", "CompiledModel", "SimpyProcessModel"):
                    check = compare(baseline, outputs[name])
                    check.update(engine=name, seed=seed, repeat=repeat)
                    check["terminal_state_difference"] = first_difference(terminal_state(models["AircraftSupportV1Model"]), terminal_state(models[name]))
                    report["comparisons"].append(check)
                    if check["core_difference"] or check["terminal_state_difference"]:
                        raise AssertionError(check)
                dag_diff = first_difference(outputs["ParallelDAGModel"], outputs["SimpyDAGModel"])
                dag_state_diff = first_difference(terminal_state(models["ParallelDAGModel"]), terminal_state(models["SimpyDAGModel"]))
                report["comparisons"].append({"engine": "DAG direct vs SimPy", "seed": seed, "repeat": repeat,
                    "core_difference": dag_diff, "terminal_state_difference": dag_state_diff})
                if dag_diff or dag_state_diff:
                    raise AssertionError((dag_diff, dag_state_diff))
                save()
        medians = {cls.__name__: statistics.median(r["total_seconds"] for r in report["rows"] if r["engine"] == cls.__name__) for cls in ENGINES}
        report["median_total_seconds"] = medians
        report["speedup_vs_tick"] = {name: medians["AircraftSupportV1Model"] / value for name, value in medians.items()}
        report["status"] = "passed"
    except Exception as error:
        report["status"], report["error"] = "failed", str(error)
        raise
    finally:
        save()
    print(json.dumps(report["speedup_vs_tick"], indent=2), flush=True)


if __name__ == "__main__":
    main()
