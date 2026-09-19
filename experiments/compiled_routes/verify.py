"""Differential and hand-calculated checks for the experimental routes."""
import copy
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from experiments.compiled_routes.ir import CompiledStructure, JobDAG
from experiments.compiled_routes.runtime import TriggeredModel, CompiledModel, SimpyProcessModel, ParallelDAGModel, SimpyDAGModel
from experiments.compiled_routes.validation import CheckedMixin, compare
from experiments.event_calendar.benchmark import first_difference, terminal_state
from experiments.event_calendar.runtime import CalendarIR
from experiments.event_calendar.verify import cases
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model, MissionState
from tests.test_aircraft_support_v1_model import _minimal_inputs, _vertical_organization_inputs


def verify():
    counts = {"serial_comparisons": 0, "dag_scheduler_comparisons": 0, "invariant_checks": 0}
    for name, inputs in cases():
        inputs["disable_visualization_frames"] = True
        ir = CompiledStructure.compile(inputs)
        for seed in (0, 1, 7):
            inputs["seed"] = seed
            reference = AircraftSupportV1Model(inputs)
            expected = reference.run()
            for cls in (TriggeredModel, CompiledModel, SimpyProcessModel):
                checked = type("Checked" + cls.__name__, (CheckedMixin, cls), {})
                model = checked(inputs) if cls is TriggeredModel else checked(inputs, ir)
                if cls is SimpyProcessModel:
                    with patch.object(AircraftSupportV1Model, "step", side_effect=AssertionError("SimPy called tick step")):
                        actual = model.run()
                else:
                    actual = model.run()
                diff = compare(expected, actual)["core_difference"]
                assert diff is None, (name, seed, cls.__name__, diff)
                diff = first_difference(terminal_state(reference), terminal_state(model))
                assert diff is None, (name, seed, cls.__name__, diff)
                counts["serial_comparisons"] += 1
                counts["invariant_checks"] += model.invariant_checks
        print("PASS", name, flush=True)
    inputs = _minimal_inputs()
    inputs["disable_visualization_frames"] = True
    inputs["aircraft"].update(fleet_count=1, initial_ready=1)
    inputs["time"]["duration_minutes"] = 100
    inputs["mission_profile"]["basic_missions"][0].update(startHour=1, preparationMinutes=60, equipmentQuantity=1, taskDurationMinutes=5)
    inputs["support_activities"]["activities"][0]["jobs"] = [
        {"activityCode": code, "durationMinutes": duration, "predecessors": pred,
         "personnel": 1, "equipment": 1}
        for code, duration, pred in (("a", 2, []), ("b", 3, ["a"]), ("c", 5, ["a"]), ("d", 2, ["b", "c"]))]
    for capacity, expected_finish in ((1, 13), (2, 10)):
        inputs["support_network"]["nodes"][0].update(personnel_capacity=capacity, equipment_capacity=capacity)
        ir = CompiledStructure.compile(inputs)
        outputs = []
        for cls in (ParallelDAGModel, SimpyDAGModel):
            checked = type("Checked" + cls.__name__, (CheckedMixin, cls), {})
            model = checked(inputs, ir)
            result = model.run()
            finished = [e["time"] for e in result["events"] if e["event"] == "preflight_completed"]
            assert finished == [expected_finish], (capacity, finished)
            outputs.append(result)
            counts["invariant_checks"] += model.invariant_checks
        assert first_difference(*outputs) is None
        counts["dag_scheduler_comparisons"] += 1
    # Fail closed on malformed graphs; no partial sort fallback.
    for jobs in ([{"activityCode": "a", "predecessors": ["missing"]}],
                 [{"activityCode": "a", "predecessors": ["b"]}, {"activityCode": "b", "predecessors": ["a"]}],
                 [{"activityCode": "a"}, {"activityCode": "a"}]):
        try:
            JobDAG.compile({"id": "invalid", "jobs": jobs})
        except ValueError:
            pass
        else:
            raise AssertionError("accepted malformed graph")
    counts["invalid_graph_rejections"] = 3
    # A blocked preflight reserves the last spare but cannot reserve personnel.
    # Cancellation returns that spare without releasing resource capacity.
    # Another repair must wake at minute 7 instead of sleeping forever.
    inputs = _vertical_organization_inputs(local_quantity=1, parent_quantity=0)
    inputs["disable_visualization_frames"] = True
    inputs["aircraft"].update(fleet_count=2, initial_ready=2)
    inputs["time"]["duration_minutes"] = 40
    blocked = copy.deepcopy(inputs["support_activities"]["activities"][0])
    blocked.update(id="blocked-preflight", name="blocked-preflight")
    blocked["jobs"] = [{"activityCode": "blocked", "durationMinutes": 2,
                        "spare": [{"product_id": "shared-spare", "quantity": 1}],
                        "requiredPersonnel": 999, "requiredDevices": 1}]
    inputs["support_activities"]["activities"].append(blocked)
    ir = CompiledStructure.compile(inputs)
    expected = None
    for cls in (AircraftSupportV1Model, TriggeredModel, CompiledModel, SimpyProcessModel, ParallelDAGModel, SimpyDAGModel):
        checked = type("Checked" + cls.__name__, (CheckedMixin, cls), {})
        model = checked(inputs, ir) if issubclass(cls, CompiledModel) else checked(inputs)
        model.missions = [MissionState("cancel", "cancel", 5, 0, 5, 1, 1, 1, 1)]
        model._create_job(model.aircraft[0], blocked, kind="preflight", mission_id="cancel")
        model.aircraft[0].state = "pre_support"
        model.aircraft[0].current_mission_id = "cancel"
        repair = copy.deepcopy(model.activities[1])
        repair["jobs"] = [{"activityCode": "repair", "durationMinutes": 2,
                           "spare": [{"product_id": "shared-spare", "quantity": 1}],
                           "requiredPersonnel": 1, "requiredDevices": 1}]
        model._create_job(model.aircraft[1], repair, kind="repair")
        model.aircraft[1].state = "maintenance"
        # This focused test seeds state after construction, so rebuild static
        # scheduler indexes explicitly; product runs never mutate the IR.
        if isinstance(model, TriggeredModel):
            model.calendar = CalendarIR.compile(model)
        if isinstance(model, CompiledModel):
            model._active_jobs = list(model.jobs)
            model._known_job_ids = {j.job_id for j in model.jobs}
        result = model.run()
        assert model.jobs[1].state == "completed" and model.jobs[1].started_time == 7
        if expected is None:
            expected = result
        else:
            assert compare(expected, result)["core_difference"] is None
        counts["invariant_checks"] += model.invariant_checks
    counts["cancelled_reservation_wakeup_checks"] = 6
    return counts


if __name__ == "__main__":
    result = verify()
    print(json.dumps(result, indent=2))
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(result, indent=2) + "\n")
