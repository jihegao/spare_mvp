"""Production compiled executor differential and mutable-state isolation checks."""
from __future__ import annotations

import copy
from dataclasses import asdict
import math
import unittest

from src.spare_mvp_abm.aircraft_support_v1.compiled_runtime import (
    CalendarIR, CompiledAircraftSupportModel, CompiledSimulation, JobDAG,
)
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model, MissionState
from tests.test_aircraft_support_v1_model import (
    _minimal_inputs, _runtime_component, _vertical_organization_inputs,
    _lateral_organization_inputs,
)


def core_result(result):
    result = copy.deepcopy(result)
    result["metrics"].pop("downtime_resource_delay_events", None)
    result["events"] = [event for event in result["events"]
                        if event["event"] not in {"personnel_delay", "equipment_shortage"}]
    return result


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


class CheckedCompiledModel(CompiledAircraftSupportModel):
    """Check physical conservation at every integrated/event time boundary."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.initial_stock = sum(sum(node["inventory"].values()) for node in self.nodes.values())
        self.invariant_checks = 0

    def _record_downtime_minutes(self):
        super()._record_downtime_minutes()
        for node in self.nodes.values():
            for resource in ("personnel", "equipment"):
                assert 0 <= node[resource + "_in_use"] <= node[resource + "_capacity"]
                if self.canonical_organization_enabled:
                    reservations = sum(job.resource_reservations.get(resource, ("", 0))[1]
                        for job in self.jobs
                        if job.resource_reservations.get(resource, ("", 0))[0] == node["id"])
                    assert reservations == node[resource + "_in_use"]
            assert all(quantity >= 0 for quantity in node["inventory"].values())
        stock = sum(sum(node["inventory"].values()) for node in self.nodes.values())
        reserved = sum(sum(job.spare_reservations.values()) for job in self.jobs)
        travelling = sum(shipment.quantity for shipment in self.transport_shipments)
        assert stock + reserved + travelling + self.spare_consumed_total == self.initial_stock
        self.invariant_checks += 1


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


class CompiledRuntimeTests(unittest.TestCase):
    def test_same_seed_reference_results_and_terminal_state(self):
        # 13 scenarios x 3 seeds; all outputs except the two explicitly relaxed
        # repeated polling observations must agree, including RNG state.
        checked = 0
        for name, inputs in cases():
            inputs["disable_visualization_frames"] = True
            original = copy.deepcopy(inputs)
            compiled = CompiledSimulation.compile(inputs)
            templates = copy.deepcopy(compiled)
            for seed in (0, 1, 7):
                with self.subTest(case=name, seed=seed):
                    seeded = dict(inputs, seed=seed)
                    reference = AircraftSupportV1Model(seeded)
                    candidate = CheckedCompiledModel(seeded, compiled)
                    self.assertEqual(core_result(reference.run()), core_result(candidate.run()))
                    self.assertEqual(terminal_state(reference), terminal_state(candidate))
                    self.assertEqual(compiled, templates)
                    self.assertGreater(candidate.invariant_checks, 0)
                    checked += 1
            self.assertEqual(inputs, original)
        self.assertEqual(checked, 39)

    def test_event_snapshots_preserve_reference_context(self):
        checked = 0
        for name, inputs in cases():
            inputs.update(disable_visualization_frames=True, write_event_snapshots=True)
            compiled = CompiledSimulation.compile(inputs)
            for seed in (0, 1, 7):
                with self.subTest(case=name, seed=seed):
                    seeded = dict(inputs, seed=seed)
                    reference = AircraftSupportV1Model(seeded)
                    candidate = CheckedCompiledModel(seeded, compiled)
                    self.assertTrue(candidate._compiled_enabled)
                    self.assertEqual(core_result(reference.run()), core_result(candidate.run()))
                    self.assertEqual(terminal_state(reference), terminal_state(candidate))
                    checked += 1
        self.assertEqual(checked, 39)

    def test_stable_failure_countdown_matches_repeated_binary64_subtraction(self):
        # Cross exponent boundaries from both adjacent representable floats.
        # Above 2**53, unit subtraction can round back to the original timer;
        # direct subtraction by skipped would incorrectly move such a timer.
        values = [1.1, 2.1, 100.1, 300.125, 1024.75]
        for exponent in (1, 8, 20, 52, 53, 54):
            boundary = float(2**exponent)
            values.extend((math.nextafter(boundary, 0.0), boundary,
                           math.nextafter(boundary, math.inf)))
        inputs = _minimal_inputs()
        inputs["disable_visualization_frames"] = True
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 2)]
        compiled = CompiledSimulation.compile(inputs)
        for remaining in values:
            for skipped in {1, min(257, math.ceil(remaining) - 1)}:
                with self.subTest(remaining=remaining.hex(), skipped=skipped):
                    self.assertLess(skipped, remaining)  # no event inside interval
                    model = CompiledAircraftSupportModel(inputs, compiled)
                    aircraft = model.aircraft[0]
                    aircraft.state = "flying"
                    aircraft.in_flight_failure = False
                    aircraft.component_failure_minutes.clear()
                    keys = model._failure_component_keys[aircraft.tail_number]
                    self.assertTrue(keys)
                    for key in keys:
                        aircraft.lru_failure_remaining_minutes[key] = remaining
                    expected = remaining
                    for _ in range(skipped):
                        expected -= 1
                    model._advance_stable_interval(skipped)
                    for key in keys:
                        self.assertEqual(aircraft.lru_failure_remaining_minutes[key].hex(),
                                         expected.hex())
                    self.assertEqual(model.minute, skipped)
                    self.assertEqual(model.skipped_ticks, skipped)

    def test_samples_do_not_share_inventory_jobs_or_aircraft(self):
        inputs = _vertical_organization_inputs(local_quantity=1, parent_quantity=2)
        inputs["disable_visualization_frames"] = True
        compiled = CompiledSimulation.compile(inputs)
        first = CompiledAircraftSupportModel(inputs, compiled)
        second = CompiledAircraftSupportModel(dict(inputs, seed=7), compiled)
        second_before = copy.deepcopy(terminal_state(second))
        for node in first.nodes.values():
            node["inventory"]["isolation-probe"] = 999
        first.aircraft[0].state = "maintenance"
        first.run()
        self.assertEqual(terminal_state(second), second_before)
        self.assertTrue(all("isolation-probe" not in n["inventory"] for n in compiled.nodes.values()))

    def test_visualization_and_non_unit_tick_fall_back_exactly(self):
        for mode in ("frames", "non-unit-tick"):
            with self.subTest(mode=mode):
                inputs = _minimal_inputs()
                inputs["disable_visualization_frames"] = mode != "frames"
                if mode == "non-unit-tick":
                    inputs["time"]["tick_minutes"] = 5
                expected = AircraftSupportV1Model(inputs)
                actual = CompiledAircraftSupportModel(inputs)
                self.assertFalse(actual._compiled_enabled)
                self.assertEqual(expected.run(), actual.run())
                self.assertEqual(terminal_state(expected), terminal_state(actual))
                self.assertEqual(actual.skipped_ticks, 0)

    def test_invalid_dags_rejected_and_repeated_predecessors_deduplicated(self):
        invalid = (
            [{"activityCode": "a", "predecessors": ["missing"]}],
            [{"activityCode": "a", "predecessors": ["b"]},
             {"activityCode": "b", "predecessors": ["a"]}],
            [{"activityCode": "a"}, {"activityCode": "a"}],
        )
        for jobs in invalid:
            with self.subTest(jobs=jobs), self.assertRaises(ValueError):
                JobDAG.compile({"id": "invalid", "jobs": jobs})
        dag = JobDAG.compile({"id": "diamond", "jobs": [
            {"activityCode": "a", "durationMinutes": 2},
            {"activityCode": "b", "durationMinutes": 3, "predecessors": ["a", "a"]},
            {"activityCode": "c", "durationMinutes": 5, "predecessors": ["a"]},
            {"activityCode": "d", "durationMinutes": 2, "predecessors": ["b", "c"]},
        ]})
        self.assertEqual(dag.predecessors, ((), (0,), (0,), (1, 2)))
        self.assertEqual(dag.successors, ((1, 2), (3,), (3,), ()))
        self.assertEqual(dag.critical_path_minutes, 9)
        self.assertEqual(dag.serial_minutes, 12)

    def test_cancelled_spare_reservation_wakes_waiting_repair(self):
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
        results = []
        for cls in (AircraftSupportV1Model, CompiledAircraftSupportModel):
            model = cls(inputs)
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
            if isinstance(model, CompiledAircraftSupportModel):
                # Deliberately seeded post-construction state requires rebuilding
                # the static indexes; ordinary inputs are fixed before compile.
                model.calendar = CalendarIR.compile(model)
                model._active_jobs = list(model.jobs)
                model._known_job_ids = {j.job_id for j in model.jobs}
            results.append(core_result(model.run()))
            self.assertEqual(model.jobs[1].state, "completed")
            self.assertEqual(model.jobs[1].started_time, 7)
        self.assertEqual(*results)


if __name__ == "__main__":
    unittest.main()
