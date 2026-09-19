"""Compile canonical runtime structure, never Project JSON, into reusable IR."""
from dataclasses import dataclass
import copy

from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model


@dataclass(frozen=True)
class JobDAG:
    codes: tuple[str, ...]
    predecessors: tuple[tuple[int, ...], ...]
    successors: tuple[tuple[int, ...], ...]
    durations: tuple[int, ...]
    critical_path_minutes: int
    serial_minutes: int

    @classmethod
    def compile(cls, activity):
        jobs = activity.get("jobs") or []
        codes = tuple(str(j.get("activityCode") or f"task-{i}") for i, j in enumerate(jobs))
        if len(set(codes)) != len(codes):
            raise ValueError(f"duplicate task code: {activity['id']}")
        index = {code: i for i, code in enumerate(codes)}
        predecessors = []
        for job in jobs:
            unknown = set(job.get("predecessors") or []) - index.keys()
            if unknown:
                raise ValueError(f"unknown predecessor in {activity['id']}: {sorted(unknown)}")
            predecessors.append(tuple(index[p] for p in job.get("predecessors") or []))
        durations = tuple(max(1, int(j.get("durationMinutes") or j.get("duration_minutes") or activity.get("duration_minutes") or 30)) for j in jobs)
        ends = {}
        while len(ends) < len(jobs):
            ready = [i for i in range(len(jobs)) if i not in ends and all(p in ends for p in predecessors[i])]
            if not ready:
                raise ValueError(f"cycle in {activity['id']}")
            for i in ready:
                ends[i] = max((ends[p] for p in predecessors[i]), default=0) + durations[i]
        successors = tuple(tuple(i for i, ps in enumerate(predecessors) if parent in ps) for parent in range(len(jobs)))
        return cls(codes, tuple(predecessors), successors, durations, max(ends.values(), default=0), sum(durations))


@dataclass(frozen=True)
class CompiledStructure:
    # Private templates are copied into each run; mutable inventories and RNG
    # state are never shared between Monte Carlo samples.
    aircraft: list
    components: list
    equipment: list
    nodes: dict
    activities: list
    missions: list
    dags: dict[str, JobDAG]

    @classmethod
    def compile(cls, inputs):
        model = AircraftSupportV1Model(inputs)
        return cls(model._build_aircraft(), copy.deepcopy(model.components),
                   copy.deepcopy(model.equipment_tree_components), model._build_support_nodes(),
                   copy.deepcopy(model.activities), model._build_missions(),
                   {a["id"]: JobDAG.compile(a) for a in model.activities})

    def summary(self):
        return {"aircraft": len(self.aircraft), "components": len(self.components),
                "missions": len(self.missions), "nodes": len(self.nodes),
                "activity_dags": {key: {"tasks": len(dag.codes),
                    "edges": sum(map(len, dag.predecessors)),
                    "critical_path_minutes": dag.critical_path_minutes,
                    "serial_minutes": dag.serial_minutes} for key, dag in self.dags.items()}}
