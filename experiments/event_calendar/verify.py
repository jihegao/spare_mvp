"""Check every visited event boundary against minute-by-minute execution."""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from experiments.event_calendar.benchmark import first_difference, terminal_state
from experiments.event_calendar.runtime import CalendarModel, SimpyCalendarModel
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from tests.test_aircraft_support_v1_model import (
    _minimal_inputs, _runtime_component, _vertical_organization_inputs,
    _lateral_organization_inputs,
)


def cases():
    for name in ("normal", "failure", "shortage", "cancellation", "preventive", "stop", "failure-stop", "overlap", "redundant", "zero-duration"):
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 1700
        mission = inputs["mission_profile"]["basic_missions"][0]
        mission.update(startHour=2, cancelMinutes=60, taskDurationMinutes=90)
        if name in {"failure", "failure-stop", "redundant"}:
            inputs["equipment_tree"]["components"] = [_runtime_component("engine", "aircraft", "Engine", 2)]
        if name == "redundant":
            inputs["equipment_tree"]["components"] = [
                _runtime_component("avionics", "aircraft-root", "Avionics", 0,
                                   product_type="system", k_out_of_n={"enabled": True, "n": 2, "k": 2}),
                _runtime_component("radar", "avionics", "Radar", 1),
                _runtime_component("computer", "avionics", "Computer", 2),
            ]
        if name == "shortage":
            inputs["support_network"]["nodes"][0]["personnel_capacity"] = 1
        if name == "cancellation":
            mission["equipmentQuantity"] = 3
        if name == "zero-duration":
            for activity in inputs["support_activities"]["activities"]:
                for job in activity["jobs"]:
                    job["durationMinutes"] = 0
        if name == "preventive":
            mission["startHour"] = 1450 / 60
        if name == "stop":
            inputs["stop_policy"] = {"mode": "or", "conditions": [{"type": "specified_time", "minute": 131}]}
        if name == "failure-stop":
            inputs["stop_policy"] = {"mode": "or", "conditions": [{"type": "failure"}]}
        if name == "overlap":
            second = copy.deepcopy(mission)
            second.update(id="mission-b", missionId="mission-b", startHour=2.25)
            inputs["mission_profile"]["basic_missions"].append(second)
        yield name, inputs
    for name, factory in (("vertical-transport", _vertical_organization_inputs), ("lateral-transport", _lateral_organization_inputs)):
        inputs = factory()
        inputs["time"]["duration_minutes"] = 300
        inputs["mission_profile"]["basic_missions"][0].update(startHour=1, equipmentQuantity=1, taskDurationMinutes=90)
        inputs["equipment_tree"]["components"] = [_runtime_component("engine", "aircraft", "Engine", 10)]
        yield name, inputs
    inputs = _minimal_inputs()
    inputs["mission_profile"]["basic_missions"] = []
    inputs["time"]["duration_minutes"] = 3000
    yield "calendar-no-missions", inputs


def verify():
    checked = 0
    boundaries = 0
    event_kinds = set()
    for name, inputs in cases():
        inputs["disable_visualization_frames"] = True
        for seed in (0, 1, 7):
            inputs["seed"] = seed
            for cls in (CalendarModel, SimpyCalendarModel):
                reference = AircraftSupportV1Model(inputs)
                candidate = cls(inputs)
                while candidate.running:
                    candidate.step()
                    while reference.running and reference.minute < candidate.minute:
                        reference.step()
                    # Event order and full mutable domain state at each wakeup,
                    # not merely matching aggregate metrics at the end.
                    expected = (reference.minute, reference.running, reference.event_log,
                                terminal_state(reference), reference.snapshot(), reference.downtime_events,
                                reference._active_downtime_events)
                    actual = (candidate.minute, candidate.running, candidate.event_log,
                              terminal_state(candidate), candidate.snapshot(), candidate.downtime_events,
                              candidate._active_downtime_events)
                    diff = first_difference(expected, actual)
                    if diff:
                        raise AssertionError(f"{name}, seed={seed}, {cls.__name__}, minute={candidate.minute}: {diff}")
                    boundaries += 1
                diff = first_difference(reference.run(), candidate.run())
                if diff:
                    raise AssertionError(f"{name} finalization: {diff}")
                event_kinds.update(event["event"] for event in candidate.event_log)
                checked += 1
        print("PASS", name, flush=True)
    # Unsupported telemetry/tick configurations must fail explicitly.
    for update in ({"disable_visualization_frames": False}, {"write_event_snapshots": True}, {"time": {"tick_minutes": 5}}):
        inputs = _minimal_inputs()
        inputs["disable_visualization_frames"] = True
        inputs.update(update)
        try:
            CalendarModel(inputs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted unsupported configuration: {update}")
    return {"differential_runs": checked, "checked_boundaries": boundaries, "event_kinds": sorted(event_kinds), "unsupported_config_checks": 3}


if __name__ == "__main__":
    result = verify()
    print(json.dumps(result, indent=2))
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(result, indent=2) + "\n")
