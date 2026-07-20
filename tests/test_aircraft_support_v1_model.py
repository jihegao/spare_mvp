from __future__ import annotations

import json
import unittest
from pathlib import Path

from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model, JobState, _resource_quantity
from src.spare_mvp_contract import SimulationAdapter


def _minimal_inputs() -> dict:
    return {
        "seed": 0,
        "time": {"duration_minutes": 120, "tick_minutes": 1, "sample_every_minutes": 30},
        "aircraft": {"fleet_count": 2, "initial_ready": 2, "models": ["J-15"]},
        "equipment_tree": {"components": []},
        "support_network": {
            "nodes": [
                {
                    "id": "deck",
                    "name": "Deck",
                    "personnel_capacity": 2,
                    "equipment_capacity": 2,
                    "inventory": {},
                    "transport_policies": [{"from": "stock", "to": "deck", "transport_time_hours": 2}],
                }
            ]
        },
        "support_activities": {
            "activities": [
                {
                    "id": "preflight",
                    "name": "preflight",
                    "resource_id": "deck",
                    "jobs": [{"activityCode": "pf-1", "durationMinutes": 20, "workName": "preflight"}],
                },
                {
                    "id": "repair",
                    "name": "repair",
                    "resource_id": "deck",
                    "jobs": [{"activityCode": "rp-1", "durationMinutes": 20, "workName": "repair"}],
                },
                {
                    "id": "postflight",
                    "name": "postflight",
                    "activity_type": "postflight",
                    "resource_id": "deck",
                    "jobs": [{"activityCode": "po-1", "durationMinutes": 5, "workName": "postflight"}],
                },
                {
                    "id": "preventive",
                    "name": "preventive",
                    "activity_type": "preventive",
                    "resource_id": "deck",
                    "calendarDayInterval": 1,
                    "jobs": [{"activityCode": "pm-1", "durationMinutes": 5, "workName": "preventive"}],
                },
            ]
        },
        "mission_profile": {
            "duration_hours": 2,
            "basic_missions": [
                {
                    "id": "mission-a",
                    "missionId": "mission-a",
                    "name": "mission",
                    "startHour": 0,
                    "preparationMinutes": 20,
                    "taskDurationMinutes": 30,
                    "equipmentQuantity": 2,
                    "cancelMinutes": 10,
                }
            ],
            "composite_tasks": [],
        },
    }


def _preflight_timing_inputs() -> dict:
    inputs = _minimal_inputs()
    inputs["time"]["duration_minutes"] = 8 * 60
    inputs["aircraft"]["fleet_count"] = 1
    inputs["aircraft"]["initial_ready"] = 1
    basic = inputs["mission_profile"]["basic_missions"][0]
    basic["preparationMinutes"] = 20
    basic["equipmentQuantity"] = 1
    inputs["mission_profile"]["composite_tasks"] = [
        {
            "id": "composite-a",
            "name": "Composite A",
            "taskItems": [
                {
                    "id": "task-a",
                    "basicMissionId": "mission-a",
                    "basicTaskName": "mission",
                    "firstWaveTime": "08:00",
                    "taskDurationMinutes": 30,
                    "equipmentQuantity": 1,
                }
            ],
        }
    ]
    return inputs


def _periodic_repeat_inputs(repeat_count: int) -> dict:
    inputs = _minimal_inputs()
    inputs["time"] = {"duration_minutes": 14 * 24 * 60, "tick_minutes": 1, "sample_every_minutes": 24 * 60}
    inputs["aircraft"] = {"fleet_count": 1, "initial_ready": 1, "models": ["J-15"]}
    inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
    inputs["mission_profile"]["composite_tasks"] = [
        {
            "id": "composite-weekly",
            "name": "weekly mission",
            "taskItems": [
                {
                    "id": "weekly-sortie",
                    "basicMissionId": "mission-a",
                    "basicTaskName": "mission",
                    "firstWaveTime": "00:10",
                    "preparationMinutes": 1,
                    "taskDurationMinutes": 5,
                    "equipmentQuantity": 1,
                }
            ],
        }
    ]
    inputs["mission_profile"]["periodic_tasks"] = [
        {
            "id": "periodic-weekly",
            "periodicTaskName": "weekly repeat",
            "compositeTaskIds": ["composite-weekly"],
            "periodDays": 7,
            "repeatCount": repeat_count,
            "weekdayAssignments": {"monday": "composite-weekly"},
        }
    ]
    for activity in inputs["support_activities"]["activities"]:
        for job in activity["jobs"]:
            job["durationMinutes"] = 1
    return inputs


def aircraft_payload_nodes(model: AircraftSupportV1Model, aircraft) -> list[dict]:
    return model._aircraft_failure_tree_payload(aircraft)["nodes"]


def _runtime_component(
    component_id: str,
    parent_id: str,
    name: str,
    rate: float,
    *,
    product_type: str = "LRU",
    **overrides,
) -> dict:
    component = {
        "id": component_id,
        "parent_id": parent_id,
        "name": name,
        "product_id": f"product-{component_id}",
        "product_name": name,
        "product_type": product_type,
        "failure_distribution": {"distributionType": "指数分布", "parameters": f"lambda={rate}"},
    }
    component.update(overrides)
    return component


def _canonical_import_inputs() -> dict:
    fixture_path = Path(__file__).parent / "fixtures" / "modeling_import_project.json"
    import_package = json.loads(fixture_path.read_text(encoding="utf-8"))
    validation = validate_modeling_import_package(import_package)
    project = modeling_import_to_project(import_package, validation=validation)
    return SimulationAdapter().compile_scenario(project, model_family="aircraft_support_v1")["simulation_inputs"]


class AircraftSupportV1ModelTest(unittest.TestCase):
    def test_downtime_ledger_uses_unique_direct_cause_intervals(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {"fleet_count": 4, "initial_ready": 4, "models": ["J-15"]}
        model = AircraftSupportV1Model(inputs)
        tails = [aircraft.tail_number for aircraft in model.aircraft]
        model.jobs.extend(
            [
                JobState(
                    job_id="spare-job", tail_number=tails[0], kind="repair", activity_id="repair",
                    activity_name="repair", tasks=[{"workName": "replace LRU", "spare": "LRU,1"}],
                    priority=1, resource_node_id="deck", state="waiting", shortage_reason="spare:LRU",
                ),
                JobState(
                    job_id="equipment-job", tail_number=tails[1], kind="repair", activity_id="repair",
                    activity_name="repair", tasks=[{"workName": "repair", "requiredDevices": 3}],
                    priority=1, resource_node_id="deck", state="waiting", shortage_reason="equipment_capacity",
                ),
                JobState(
                    job_id="failure-job", tail_number=tails[2], kind="repair", activity_id="repair",
                    activity_name="repair", tasks=[{"workName": "repair"}], priority=1,
                    resource_node_id="deck", state="running", remaining=10,
                ),
                JobState(
                    job_id="preventive-job", tail_number=tails[3], kind="preventive", activity_id="preventive",
                    activity_name="preventive", tasks=[{"workName": "inspection"}], priority=1,
                    resource_node_id="deck", state="running", remaining=10,
                ),
            ]
        )
        model.aircraft[0].failed_component_id = "underlying-failure"
        model.aircraft[1].failed_component_id = "underlying-failure"
        model.aircraft[2].failed_component_id = "underlying-failure"
        model.aircraft[3].preventive_due = True

        for minute in (1, 2):
            model.minute = minute
            model._record_downtime_minutes()

        self.assertEqual(
            {tail: event["factor"] for tail, event in model._active_downtime_events.items()},
            {
                tails[0]: "spare_shortage",
                tails[1]: "equipment_shortage",
                tails[2]: "failure",
                tails[3]: "preventive",
            },
        )
        # A direct blocker change closes the prior interval instead of double-counting it.
        model.jobs[0].shortage_reason = "equipment_capacity"
        model.minute = 3
        model._record_downtime_minutes()
        model._close_all_downtime_events()

        metrics = model.snapshot()
        self.assertEqual(metrics["downtime_spare_shortage_events"], 1)
        self.assertEqual(metrics["downtime_equipment_shortage_events"], 2)
        self.assertEqual(metrics["downtime_failure_events"], 1)
        self.assertEqual(metrics["downtime_preventive_events"], 1)
        self.assertEqual(sum(event["duration_minutes"] for event in model.downtime_events), 12)
        self.assertEqual(len({event["event_id"] for event in model.downtime_events}), 5)
        spare = next(event for event in model.downtime_events if event["factor"] == "spare_shortage")
        self.assertEqual(spare["details"]["shortage_quantity"], 1)
        self.assertIsNone(spare["details"]["arrival_minute"])
        self.assertEqual(spare["details"]["wait_end_minute"], 2)
        equipment = next(
            event for event in model.downtime_events
            if event["factor"] == "equipment_shortage" and event["tail_number"] == tails[1]
        )
        self.assertEqual(equipment["details"]["wait_minutes"], 3)
        model.jobs[1].shortage_reason = "personnel_capacity"
        personnel_wait = model._current_downtime_event(model.aircraft[1], 3)
        self.assertEqual(personnel_wait["factor"], "failure")

    def test_downtime_ledger_splits_same_factor_when_repair_task_context_changes(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        aircraft = model.aircraft[0]
        aircraft.failed_component_id = "component-1"
        job = JobState(
            job_id="repair-1",
            tail_number=aircraft.tail_number,
            kind="repair",
            activity_id="repair",
            activity_name="repair",
            tasks=[
                {"activityCode": "diagnose", "workName": "故障诊断"},
                {"activityCode": "replace", "workName": "部件更换"},
            ],
            priority=1,
            resource_node_id="deck",
            state="running",
            remaining=10,
        )
        model.jobs.append(job)

        model.minute = 1
        model._record_downtime_minutes()
        job.task_index = 1
        model.minute = 2
        model._record_downtime_minutes()
        model._close_all_downtime_events()

        self.assertEqual(len(model.downtime_events), 2)
        diagnose, replace = model.downtime_events
        self.assertEqual([diagnose["factor"], replace["factor"]], ["failure", "failure"])
        self.assertEqual(
            [(diagnose["mission_phase_name"], diagnose["start_minute"], diagnose["end_minute"]),
             (replace["mission_phase_name"], replace["start_minute"], replace["end_minute"])],
            [("故障诊断", 0.0, 1.0), ("部件更换", 1.0, 2.0)],
        )
        self.assertEqual(sum(event["duration_minutes"] for event in model.downtime_events), 2)
        self.assertEqual(model.snapshot()["downtime_failure_events"], 2)

    def test_failure_return_preserves_mission_and_phase_context_in_downtime_event(self) -> None:
        inputs = _minimal_inputs()
        inputs["support_activities"]["activities"][1]["name"] = "修复性维修"
        inputs["support_activities"]["activities"][1]["jobs"][0]["workName"] = "故障诊断"
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]
        mission = model.missions[0]
        aircraft.state = "flying"
        aircraft.current_mission_id = mission.mission_id
        aircraft.return_time = 30
        aircraft.failed_component_id = "component-1"
        aircraft.failed_component_minute = 25
        aircraft.component_failure_minutes["component-1"] = 25
        aircraft.in_flight_failure = True
        model.minute = 30

        model._return_aircraft_from_mission(aircraft, early_return=True)
        event = model._current_downtime_event(aircraft, 30)

        self.assertIsNone(aircraft.current_mission_id)
        self.assertEqual(model.jobs[-1].mission_id, mission.mission_id)
        self.assertEqual(event["mission_id"], mission.mission_id)
        self.assertEqual(event["mission_name"], "mission")
        self.assertEqual(event["mission_phase_id"], "rp-1")
        self.assertEqual(event["mission_phase_name"], "故障诊断")
        self.assertEqual(event["details"]["failure_minute"], 25)
        self.assertEqual(event["description"], f"飞机{aircraft.tail_number}装备故障后不可用，等待修复，当前阶段为故障诊断")

    def test_component_failure_minute_is_used_when_whole_aircraft_failure_time_is_absent(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        aircraft = model.aircraft[0]
        aircraft.component_failure_minutes["component-1"] = 17
        job = JobState(
            job_id="repair-component",
            tail_number=aircraft.tail_number,
            kind="repair",
            activity_id="repair",
            activity_name="修复性维修",
            tasks=[{"activityCode": "diagnose", "workName": "故障诊断"}],
            priority=1,
            resource_node_id="deck",
            component_id="component-1",
            state="running",
            remaining=10,
        )
        model.jobs.append(job)

        event = model._current_downtime_event(aircraft, 17)

        self.assertEqual(event["details"]["failure_minute"], 17)

    def test_blank_activity_resource_uses_aircraft_airport_support_node(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [{"tail_number": "AC-001", "model": "J-15", "airportId": "SQUADRON-BASE"}],
        }
        inputs["support_network"]["nodes"] = [
            {"id": "relay", "name": "中继", "airport": "前出基地", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {}},
            {"id": "line", "name": "基层", "airport_id": "squadron-base", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {}},
        ]
        activity = inputs["support_activities"]["activities"][0]
        activity.pop("resource_id")
        model = AircraftSupportV1Model(inputs)

        model._create_job(model.aircraft[0], activity, kind="preflight")

        self.assertEqual(model.jobs[-1].resource_node_id, "line")

    def test_composite_priority_overrides_legacy_child_and_basic_priority(self) -> None:
        inputs = _preflight_timing_inputs()
        basic = inputs["mission_profile"]["basic_missions"][0]
        composite = inputs["mission_profile"]["composite_tasks"][0]
        basic["priority"] = 1
        composite["priority"] = 4
        composite["taskItems"][0]["priority"] = 1

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(model.missions[0].priority, 4)

    def test_structured_personnel_requirements_sum_resource_quantity(self) -> None:
        quantity = _resource_quantity(
            [
                {"professional": "机务", "quantity": 2},
                {"professional": "航电", "quantity": 1},
            ],
            None,
            default=1,
        )

        self.assertEqual(quantity, 3)

    def test_structured_spare_requirement_reads_name_and_quantity(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        job = JobState(
            job_id="job-1",
            tail_number="J15-001",
            kind="preflight",
            activity_id="preflight",
            activity_name="preflight",
            tasks=[],
            priority=1,
            resource_node_id="deck",
        )

        self.assertEqual(
            model._task_spare_requirement(job, {"spare": [{"model": "LRU", "name": "航电模块", "quantity": 2}]}),
            ("航电模块", 2),
        )

    def test_spare_events_preserve_the_job_aircraft_model(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        task = {"spare": "航电模块,1", "durationMinutes": 1}
        job = JobState(
            job_id="job-aircraft-model",
            tail_number=model.aircraft[0].tail_number,
            kind="preflight",
            activity_id="preflight",
            activity_name="preflight",
            tasks=[task],
            priority=1,
            resource_node_id="deck",
        )
        model.jobs.append(job)

        model._start_waiting_jobs()

        shortage = model.event_log[-1]
        self.assertEqual(shortage["event"], "spare_shortage")
        self.assertEqual(shortage["details"]["aircraft_model"], "J-15")

        model.nodes["deck"]["inventory"]["航电模块"] = 1
        model._consume_task_spare(job, task)

        consumed = model.event_log[-1]
        self.assertEqual(consumed["event"], "spare_consumed")
        self.assertEqual(consumed["details"]["aircraft_model"], "J-15")

    def test_structured_no_spare_requirement_does_not_block_preflight(self) -> None:
        inputs = _minimal_inputs()
        preflight = next(activity for activity in inputs["support_activities"]["activities"] if activity["id"] == "preflight")
        preflight["jobs"][0]["spare"] = [{"name": "无", "quantity": 1}]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 30
        mission.preparation_start = 1
        mission.required_aircraft = 1

        model.minute = 1
        model._create_due_preflight_jobs()
        model._start_waiting_jobs()

        preflight_jobs = [job for job in model.jobs if job.kind == "preflight"]
        self.assertEqual(len(preflight_jobs), 1)
        self.assertEqual(preflight_jobs[0].state, "running")
        self.assertIsNone(preflight_jobs[0].shortage_reason)

    def test_preflight_jobs_mark_aircraft_as_pre_support_not_maintenance(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 30
        mission.preparation_start = 1
        mission.required_aircraft = 1

        model.minute = 1
        model._create_due_preflight_jobs()

        self.assertEqual(model.aircraft[0].state, "pre_support")
        self.assertEqual(model.snapshot()["repairing_count"], 0)

    def test_preflight_start_uses_task_item_advance_notice_before_basic(self) -> None:
        inputs = _preflight_timing_inputs()
        inputs["mission_profile"]["basic_missions"][0]["advanceNoticeMinutes"] = 30
        inputs["mission_profile"]["composite_tasks"][0]["taskItems"][0]["advanceNoticeMinutes"] = 60
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]

        self.assertEqual(mission.planned_start, 8 * 60)
        self.assertEqual(mission.preparation_start, 7 * 60)
        model.minute = 7 * 60 - 1
        model._create_due_preflight_jobs()
        self.assertEqual([job for job in model.jobs if job.kind == "preflight"], [])

        model.minute = 7 * 60
        model._create_due_preflight_jobs()

        self.assertEqual(len([job for job in model.jobs if job.kind == "preflight"]), 1)

    def test_preflight_start_uses_basic_advance_notice_when_item_missing(self) -> None:
        inputs = _preflight_timing_inputs()
        inputs["mission_profile"]["basic_missions"][0]["advanceNoticeMinutes"] = 60
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]

        self.assertEqual(mission.planned_start, 8 * 60)
        self.assertEqual(mission.preparation_start, 7 * 60)

    def test_preflight_start_falls_back_to_preparation_minutes_without_advance_notice(self) -> None:
        model = AircraftSupportV1Model(_preflight_timing_inputs())
        mission = model.missions[0]

        self.assertEqual(mission.planned_start, 8 * 60)
        self.assertEqual(mission.preparation_start, 8 * 60 - 20)

    def test_real_aircraft_assets_are_loaded_before_generated_tail_numbers(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["assets"] = [
            {"tailNumber": "J15-101", "aircraftType": "J-15", "model": "J-15A", "initialState": "available"},
            {"tail_number": "J15-102", "aircraft_type": "J-15", "model": "J-15B", "initial_state": "maintenance"},
        ]

        model = AircraftSupportV1Model(inputs)

        self.assertEqual([aircraft.tail_number for aircraft in model.aircraft], ["J15-101", "J15-102"])
        self.assertEqual(model.aircraft[0].aircraft_type, "J-15")
        self.assertEqual(model.aircraft[1].state, "maintenance")

    def test_partial_real_aircraft_assets_are_supplemented_to_fleet_count(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 4,
            "initial_ready": 3,
            "models": ["J-15"],
            "assets": [
                {"tailNumber": "J15-101", "aircraftType": "J-15", "model": "J-15A", "initialState": "available"},
            ],
        }

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(len(model.aircraft), 4)
        self.assertEqual(model.aircraft[0].tail_number, "J15-101")
        self.assertEqual([aircraft.state for aircraft in model.aircraft], ["available", "available", "available", "maintenance"])

    def test_preflight_and_dispatch_respect_required_aircraft_type(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["assets"] = [
            {"tailNumber": "J35-201", "aircraftType": "J-35", "model": "J-35", "initialState": "available"},
            {"tailNumber": "J15-101", "aircraftType": "J-15", "model": "J-15A", "initialState": "available"},
        ]
        inputs["mission_profile"]["basic_missions"][0]["equipmentType"] = "J-15"
        inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0

        model._create_due_preflight_jobs()

        self.assertEqual([job.tail_number for job in model.jobs if job.kind == "preflight"], ["J15-101"])
        model.aircraft[0].prepared_mission_ids.add(mission.mission_id)
        model.aircraft[1].state = "available"
        model.aircraft[1].prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()

        self.assertEqual(mission.assigned_tail_numbers, ["J15-101"])
        self.assertEqual(model.aircraft[0].state, "available")

    def test_missing_postflight_activity_uses_default_postflight_not_first_activity(self) -> None:
        inputs = _minimal_inputs()
        inputs["support_activities"]["activities"] = [
            activity for activity in inputs["support_activities"]["activities"] if activity["id"] != "postflight"
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()
        model.minute = 5
        model._process_mission_returns()

        postflight_jobs = [job for job in model.jobs if job.kind == "postflight"]
        self.assertEqual(model.postflight_activity["id"], "postflight")
        self.assertEqual(postflight_jobs[0].activity_id, "postflight")

    def test_mission_return_creates_postflight_before_aircraft_becomes_available(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 10
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()
        model.minute = 10
        model._process_mission_returns()

        self.assertEqual(aircraft.state, "post_support")
        self.assertTrue(aircraft.postflight_required)
        self.assertEqual(model.completed_sorties, 0)
        self.assertEqual(model.snapshot()["repairing_count"], 0)
        self.assertEqual(model.snapshot()["postflight_backlog"], 1)
        self.assertTrue(any(job.kind == "postflight" and job.tail_number == aircraft.tail_number for job in model.jobs))

    def test_mission_success_rate_uses_success_point_wave_threshold_not_postflight_completion(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 10
        mission.required_aircraft = 2
        mission.min_required_aircraft = 1
        mission.success_point = 0.5
        for aircraft in model.aircraft:
            aircraft.prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()
        model.minute = 5
        model._evaluate_mission_success_points()

        snapshot = model.snapshot()
        self.assertTrue(mission.succeeded)
        self.assertEqual(mission.success_member_count, 2)
        self.assertEqual(model.completed_sorties, 0)
        self.assertEqual(snapshot["planned_mission_waves"], 1)
        self.assertEqual(snapshot["successful_mission_waves"], 1)
        self.assertEqual(snapshot["mission_success_rate"], 1)

    def test_mission_success_point_fails_when_available_members_below_minimum(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 0
        mission.duration_minutes = 10
        mission.min_required_aircraft = 2
        mission.success_point = 0.5
        mission.assigned_tail_numbers = [aircraft.tail_number for aircraft in model.aircraft]
        mission.failed_tail_numbers = [model.aircraft[0].tail_number]
        model.minute = 5

        model._evaluate_mission_success_points()

        snapshot = model.snapshot()
        self.assertFalse(mission.succeeded)
        self.assertEqual(mission.success_member_count, 1)
        self.assertEqual(snapshot["planned_mission_waves"], 1)
        self.assertEqual(snapshot["successful_mission_waves"], 0)
        self.assertEqual(snapshot["mission_success_rate"], 0)

    def test_snapshot_sortie_rate_is_launched_sorties_per_aircraft_per_day(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 2880
        model = AircraftSupportV1Model(inputs)
        model.launched_sorties = 2

        snapshot = model.snapshot()

        self.assertEqual(snapshot["aircraft_count"], 2)
        self.assertEqual(snapshot["simulation_days"], 2)
        self.assertEqual(snapshot["sortie_rate"], 0.5)

    def test_snapshot_mean_transport_delay_is_hours_per_replenishment(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        model.total_transport_delay = 180
        model.transport_replenishment_events = 2

        snapshot = model.snapshot()

        self.assertEqual(snapshot["total_transport_delay_minutes"], 180)
        self.assertEqual(snapshot["transport_replenishment_events"], 2)
        self.assertEqual(snapshot["mean_transport_delay"], 1.5)

    def test_ready_rate_uses_daily_1400_available_aircraft_samples(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())

        model.aircraft[0].state = "available"
        model.aircraft[1].state = "maintenance"
        model.minute = 14 * 60
        model._record_daily_readiness_sample_if_due()

        model.aircraft[0].state = "available"
        model.aircraft[1].state = "available"
        model.minute = 1440 + 14 * 60
        model._record_daily_readiness_sample_if_due()

        model.aircraft[0].state = "maintenance"
        model.aircraft[1].state = "maintenance"
        snapshot = model.snapshot()

        self.assertEqual(snapshot["daily_readiness_sample_count"], 2)
        self.assertEqual(snapshot["ready_rate"], 0.75)

    def test_transport_minutes_create_in_transit_inventory_before_arrival(self) -> None:
        inputs = _minimal_inputs()
        model = AircraftSupportV1Model(inputs)
        model.nodes["stock"] = {
            "id": "stock",
            "name": "Stock",
            "personnel_capacity": 1,
            "equipment_capacity": 1,
            "personnel_in_use": 0,
            "equipment_in_use": 0,
            "inventory": {"module": 10},
            "transport_policies": [],
            "work_count": 0,
        }
        deck = model.nodes["deck"]
        deck["inventory"]["module"] = 0
        deck["transport_policies"] = [{"from": "stock", "to": "deck", "spare_type": "module", "capacity": 2, "transport_minutes": 10}]

        model._try_transport_replenishment(deck, "module", 1)

        self.assertEqual(deck["inventory"]["module"], 0)
        self.assertEqual(model.nodes["stock"]["inventory"]["module"], 9)
        self.assertEqual(model.snapshot()["transport_in_transit_count"], 1)
        model.minute = 9
        model._process_transport_arrivals()
        self.assertEqual(deck["inventory"]["module"], 0)
        model.minute = 10
        model._process_transport_arrivals()
        self.assertEqual(deck["inventory"]["module"], 1)

    def test_preventive_jobs_are_generated_from_calendar_trigger(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        model.minute = 1440

        model._generate_preventive_jobs()

        self.assertEqual(model.aircraft[0].state, "maintenance")
        self.assertTrue(model.aircraft[0].preventive_due)
        self.assertEqual(model.snapshot()["preventive_backlog"], 2)
        self.assertEqual(len([job for job in model.jobs if job.kind == "preventive"]), 2)

    def test_canonical_preventive_jobs_can_complete_after_day_two(self) -> None:
        model = AircraftSupportV1Model(_canonical_import_inputs())
        execution = model.run()
        frame = min(execution["frames"], key=lambda item: abs(item["simulation_time"] - 2550))

        self.assertEqual(
            [job.get("shortage_reason") for job in frame["jobs"] if job["kind"] == "preventive"],
            [],
        )
        self.assertEqual(
            {aircraft["tail_number"]: aircraft["state"] for aircraft in frame["aircraft"]},
            {
                "J15-101": "available",
                "J15-102": "available",
                "J15-103": "available",
                "J35-201": "available",
                "J35-202": "available",
                "J35-203": "available",
            },
        )

    def test_natural_stop_waits_for_future_repeat_cycle_when_today_has_no_tasks(self) -> None:
        model = AircraftSupportV1Model(_periodic_repeat_inputs(repeat_count=2))

        execution = model.run()

        metrics = execution["metrics"]
        self.assertEqual(metrics["stop_reason"], "natural_complete")
        self.assertGreaterEqual(metrics["elapsed_minutes"], 7 * 24 * 60)
        self.assertEqual(max(mission.day_index for mission in model.missions), 8)
        self.assertEqual(model.completed_sorties, 2)

    def test_natural_stop_ends_when_today_has_no_tasks_and_repeat_cycle_is_last(self) -> None:
        model = AircraftSupportV1Model(_periodic_repeat_inputs(repeat_count=1))

        execution = model.run()

        metrics = execution["metrics"]
        self.assertEqual(metrics["stop_reason"], "natural_complete")
        self.assertLess(metrics["elapsed_minutes"], 24 * 60)
        self.assertEqual(model.completed_sorties, 1)

    def test_explicit_temporal_stop_policy_waits_past_natural_completion(self) -> None:
        for condition, expected_reason in [
            ({"type": "duration", "duration_minutes": 24 * 60}, "duration"),
            ({"type": "specified_time", "minute": 24 * 60}, "specified_time"),
        ]:
            with self.subTest(condition=condition):
                inputs = _periodic_repeat_inputs(repeat_count=1)
                inputs["stop_policy"] = {"mode": "or", "conditions": [condition]}

                execution = AircraftSupportV1Model(inputs).run()

                metrics = execution["metrics"]
                self.assertEqual(metrics["elapsed_minutes"], 24 * 60)
                self.assertEqual(metrics["stop_reason"], expected_reason)
                self.assertEqual(metrics["stop_conditions_met"], [expected_reason])
                self.assertEqual(metrics["completed_sorties"], 1)

    def test_stop_policy_duration_condition_stops_at_configured_duration(self) -> None:
        inputs = _minimal_inputs()
        inputs["stop_policy"] = {
            "mode": "or",
            "conditions": [{"type": "duration", "duration_minutes": 80}],
        }

        execution = AircraftSupportV1Model(inputs).run()

        self.assertEqual(execution["metrics"]["elapsed_minutes"], 80)
        self.assertEqual(execution["metrics"]["stop_reason"], "duration")
        self.assertEqual(execution["metrics"]["stop_conditions_met"], ["duration"])

    def test_stop_policy_failure_condition_stops_on_task_failure(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {"fleet_count": 1, "initial_ready": 1, "models": ["J-15"]}
        inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 1000)
        ]
        inputs["stop_policy"] = {"mode": "or", "conditions": [{"type": "failure"}]}
        model = AircraftSupportV1Model(inputs)
        for aircraft in model.aircraft:
            aircraft.lru_failure_remaining_minutes["engine"] = 1.0

        execution = model.run()

        self.assertEqual(execution["metrics"]["stop_reason"], "failure")
        self.assertEqual(execution["metrics"]["stop_conditions_met"], ["failure"])
        self.assertGreater(model.failed_sorties, 0)

    def test_stop_policy_specified_time_condition_stops_at_configured_minute(self) -> None:
        inputs = _minimal_inputs()
        inputs["stop_policy"] = {
            "mode": "or",
            "conditions": [{"type": "specified_time", "minute": 45}],
        }

        execution = AircraftSupportV1Model(inputs).run()

        self.assertEqual(execution["metrics"]["elapsed_minutes"], 45)
        self.assertEqual(execution["metrics"]["stop_reason"], "specified_time")
        self.assertEqual(execution["metrics"]["stop_conditions_met"], ["specified_time"])

    def test_stop_policy_or_and_modes_compose_multiple_conditions(self) -> None:
        or_inputs = _minimal_inputs()
        or_inputs["stop_policy"] = {
            "mode": "or",
            "conditions": [
                {"type": "specified_time", "minute": 45},
                {"type": "duration", "duration_minutes": 80},
            ],
        }
        and_inputs = _minimal_inputs()
        and_inputs["stop_policy"] = {
            "mode": "and",
            "conditions": [
                {"type": "specified_time", "minute": 45},
                {"type": "duration", "duration_minutes": 80},
            ],
        }

        or_execution = AircraftSupportV1Model(or_inputs).run()
        and_execution = AircraftSupportV1Model(and_inputs).run()

        self.assertEqual(or_execution["metrics"]["elapsed_minutes"], 45)
        self.assertEqual(or_execution["metrics"]["stop_conditions_met"], ["specified_time"])
        self.assertEqual(and_execution["metrics"]["elapsed_minutes"], 80)
        self.assertEqual(and_execution["metrics"]["stop_reason"], "stop_policy")
        self.assertEqual(and_execution["metrics"]["stop_conditions_met"], ["specified_time", "duration"])

    def test_in_flight_failure_counts_failed_sortie_and_requires_repair_after_return(self) -> None:
        inputs = _minimal_inputs()
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 1000)
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        model._dispatch_due_missions()

        model.minute = 1
        model._evaluate_failures()
        model.minute = 5
        model._process_mission_returns()

        metrics = model.snapshot()
        self.assertEqual(metrics["failed_sorties"], 1)
        self.assertEqual(metrics["in_flight_failures"], 1)
        self.assertEqual(aircraft.state, "maintenance")
        self.assertTrue(any(job.kind == "repair" for job in model.jobs))

    def test_available_aircraft_does_not_fail_before_mission_execution(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 1000)
        ]
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]

        model.minute = 1
        model._evaluate_failures()

        self.assertEqual(aircraft.state, "available")
        self.assertIsNone(aircraft.failed_component_id)
        self.assertEqual(model.snapshot()["lru_failures"], 0)

    def test_lru_failure_time_is_consumed_during_mission_execution(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 1000)
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        aircraft.lru_failure_remaining_minutes = {"engine": 2.0}

        model._dispatch_due_missions()
        model.minute = 1
        model._evaluate_failures()

        self.assertEqual(aircraft.state, "flying")
        self.assertIsNone(aircraft.failed_component_id)

        model.minute = 2
        model._evaluate_failures()

        self.assertEqual(aircraft.state, "maintenance")
        self.assertEqual(aircraft.failed_component_id, "engine")
        self.assertTrue(aircraft.in_flight_failure)
        self.assertIsNone(aircraft.current_mission_id)
        self.assertEqual(mission.status, "failed")
        self.assertTrue(any(job.kind == "repair" and job.tail_number == aircraft.tail_number for job in model.jobs))

    def test_k_out_of_n_component_failure_waits_until_threshold_and_repairs_after_return(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component(
                "avionics",
                "aircraft-root",
                "Avionics",
                0,
                product_type="system",
                k_out_of_n={"enabled": True, "n": 2, "k": 2},
            ),
            _runtime_component("radar", "avionics", "Radar LRU", 1000),
            _runtime_component("computer", "avionics", "Mission Computer LRU", 1000),
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        aircraft.lru_failure_remaining_minutes = {"radar": 1.0, "computer": 999.0}

        model._dispatch_due_missions()
        model.minute = 1
        model._evaluate_failures()

        tree = aircraft.component_failure_minutes
        self.assertIn("radar", tree)
        self.assertIsNone(aircraft.failed_component_id)
        self.assertFalse(aircraft.in_flight_failure)
        self.assertEqual(aircraft.state, "flying")
        avionics_node = next(node for node in aircraft_payload_nodes(model, aircraft) if node["id"] == "avionics")
        self.assertFalse(avionics_node["failed"])

        model.minute = 5
        model._process_mission_returns()

        self.assertEqual(aircraft.state, "maintenance")
        self.assertEqual(mission.status, "completed")
        self.assertEqual(model.snapshot()["failed_sorties"], 0)
        self.assertTrue(any(job.kind == "repair" and job.tail_number == aircraft.tail_number for job in model.jobs))

    def test_k_out_of_n_threshold_failure_propagates_to_whole_aircraft_and_can_fail_mission(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component(
                "avionics",
                "aircraft-root",
                "Avionics",
                0,
                product_type="system",
                k_out_of_n={"enabled": True, "n": 2, "k": 2},
            ),
            _runtime_component("radar", "avionics", "Radar LRU", 1000),
            _runtime_component("computer", "avionics", "Mission Computer LRU", 1000),
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        aircraft.lru_failure_remaining_minutes = {"radar": 1.0, "computer": 1.0}

        model._dispatch_due_missions()
        model.minute = 1
        model._evaluate_failures()

        payload = model._aircraft_failure_tree_payload(aircraft)
        payload_nodes = payload["nodes"]
        self.assertEqual(payload["root_id"], "whole-aircraft-root")
        self.assertEqual(payload["equipment_root_id"], "aircraft-root")
        root_node = next(node for node in payload_nodes if node["id"] == payload["root_id"])
        avionics_node = next(node for node in payload_nodes if node["id"] == "avionics")
        self.assertNotIn(payload["equipment_root_id"], {node["id"] for node in payload_nodes})
        self.assertTrue(root_node["failed"])
        self.assertTrue(avionics_node["propagated_failed"])
        self.assertEqual(aircraft.state, "maintenance")
        self.assertTrue(aircraft.in_flight_failure)
        self.assertEqual(mission.status, "failed")
        self.assertEqual(model.snapshot()["failed_sorties"], 1)
        self.assertTrue(any(job.kind == "repair" and job.tail_number == aircraft.tail_number for job in model.jobs))

    def test_event_snapshots_keep_aircraft_state_lightweight(self) -> None:
        inputs = _minimal_inputs()
        inputs["write_event_snapshots"] = True
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("aircraft-root", None, "Aircraft Root", 1000),
            _runtime_component("avionics", "aircraft-root", "Avionics", 1000),
            _runtime_component("radar", "avionics", "Radar LRU", 1000),
        ]
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]
        aircraft.state = "maintenance"
        aircraft.failed_component_id = "radar"
        aircraft.component_failure_minutes["radar"] = 1.0

        model._event("failure", "synthetic failure")

        snapshot = model.event_log[-1]["snapshot"]
        aircraft_payload = snapshot["aircraft_state"]["aircraft"][0]
        self.assertEqual(aircraft_payload["tail_number"], aircraft.tail_number)
        self.assertEqual(aircraft_payload["state"], "maintenance")
        self.assertEqual(aircraft_payload["failed_lru"], "radar")
        self.assertNotIn("failure_tree", aircraft_payload)

    def test_event_snapshots_are_limited_per_run(self) -> None:
        inputs = _minimal_inputs()
        inputs["write_event_snapshots"] = True
        inputs["event_snapshot_limit"] = 2
        model = AircraftSupportV1Model(inputs)

        for index in range(5):
            model._event("resource_delay", f"synthetic delay {index}")

        snapshots = [event for event in model.event_log if "snapshot" in event]
        self.assertEqual(len(snapshots), 2)
        self.assertNotIn("snapshot", model.event_log[-1])

    def test_lru_repair_uses_product_id_and_preserves_product_display_name(self) -> None:
        inputs = _minimal_inputs()
        inputs["support_activities"]["activities"][1].update({
            "maintenance_methods": ["replacement"],
            "replacement_ratio": 1.0,
        })
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("radar", "aircraft", "Radar LRU", 1000)
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        aircraft.lru_failure_remaining_minutes["radar"] = 1.0
        model._dispatch_due_missions()

        model.minute = 1
        model._evaluate_failures()

        repair_job = next(job for job in model.jobs if job.kind == "repair")
        self.assertEqual(repair_job.tasks[-1]["spare"], "product-radar,1")
        model.nodes["deck"]["product_names"]["product-radar"] = "Radar LRU"
        model._start_waiting_jobs()
        shortage = next(event for event in reversed(model.event_log) if event["event"] == "spare_shortage")
        self.assertEqual(shortage["details"]["product_id"], "product-radar")
        self.assertEqual(shortage["details"]["spare_type"], "Radar LRU")
        downtime = model._current_downtime_event(aircraft, model.minute)
        self.assertEqual(downtime["details"]["product_id"], "product-radar")
        self.assertEqual(downtime["details"]["spare_name"], "Radar LRU")

    def test_non_lru_repair_does_not_auto_create_spare_requirement(self) -> None:
        inputs = _minimal_inputs()
        inputs["support_activities"]["activities"][1].update({
            "maintenance_methods": ["replacement"],
            "replacement_ratio": 1.0,
        })
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("wing", "aircraft", "Wing Assembly", 1000, product_type="SRU")
        ]
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        aircraft = model.aircraft[0]
        aircraft.prepared_mission_ids.add(mission.mission_id)
        aircraft.lru_failure_remaining_minutes["wing"] = 1.0
        model._dispatch_due_missions()

        model.minute = 1
        model._evaluate_failures()

        repair_job = next(job for job in model.jobs if job.kind == "repair")
        self.assertNotIn("spare", repair_job.tasks[-1])

    def test_maintenance_activity_selection_uses_exact_component_and_aircraft_scope(self) -> None:
        scoped_activities = [
            {
                "id": "repair-j35-radar", "name": "repair", "activity_type": "corrective",
                "aircraft_model": "J-35", "equipment_id": "radar", "resource_id": "deck", "jobs": [],
            },
            {
                "id": "repair-j15-engine", "name": "repair", "activity_type": "corrective",
                "aircraft_model": "J-15", "equipment_id": "engine", "resource_id": "deck", "jobs": [],
            },
            {
                "id": "repair-j15-radar", "name": "repair", "activity_type": "corrective",
                "aircraft_model": "J-15", "equipment_id": "radar", "resource_id": "deck", "jobs": [],
            },
        ]
        for activities in (scoped_activities, list(reversed(scoped_activities))):
            with self.subTest(order=[activity["id"] for activity in activities]):
                inputs = _minimal_inputs()
                inputs["equipment_tree"]["components"] = [
                    _runtime_component("radar", "aircraft", "Radar", 0.1, aircraft_model="J-15"),
                    _runtime_component("engine", "aircraft", "Engine", 0.1, aircraft_model="J-15"),
                ]
                inputs["support_activities"]["activities"] = activities
                model = AircraftSupportV1Model(inputs)

                selected = model._select_activity(
                    "repair",
                    aircraft=model.aircraft[0],
                    component=model._component_by_id("radar"),
                )

                self.assertEqual(selected["id"], "repair-j15-radar")

    def test_preventive_activity_selection_uses_exact_aircraft_scope_independent_of_order(self) -> None:
        scoped_activities = [
            {
                "id": "preventive-j35", "name": "preventive", "activity_type": "preventive",
                "aircraft_model": "J-35", "resource_id": "deck", "calendarDayInterval": 1, "jobs": [],
            },
            {
                "id": "preventive-j15", "name": "preventive", "activity_type": "preventive",
                "aircraft_model": "J-15", "resource_id": "deck", "calendarDayInterval": 1, "jobs": [],
            },
        ]
        for activities in (scoped_activities, list(reversed(scoped_activities))):
            with self.subTest(order=[activity["id"] for activity in activities]):
                inputs = _minimal_inputs()
                inputs["support_activities"]["activities"] = activities
                model = AircraftSupportV1Model(inputs)

                selected = model._select_activity("preventive", aircraft=model.aircraft[0])

                self.assertEqual(selected["id"], "preventive-j15")

    def test_replacement_consumes_all_explicit_spares_without_lru_overwrite(self) -> None:
        for kind, activity_index in (("repair", 1), ("preventive", 3)):
            with self.subTest(kind=kind):
                inputs = _minimal_inputs()
                activity = inputs["support_activities"]["activities"][activity_index]
                activity["maintenance_methods"] = ["replacement"]
                activity["replacement_ratio"] = 1.0
                explicit_spares = [
                    {"product_id": "product-a", "quantity": 2},
                    {"product_id": "product-b", "quantity": 3},
                ]
                activity["jobs"] = [{"activityCode": "replace", "durationMinutes": 1, "spare": explicit_spares}]
                inputs["support_network"]["nodes"][0]["inventory"] = {"product-a": 5, "product-b": 7, "failed-lru": 9}
                model = AircraftSupportV1Model(inputs)
                component = _runtime_component("failed", "aircraft", "Failed LRU", 0.1, product_id="failed-lru")

                model._create_job(
                    model.aircraft[0],
                    model.activities[activity_index],
                    kind=kind,
                    component=component if kind == "repair" else None,
                )
                job = model.jobs[-1]
                model._consume_task_spare(job, job.tasks[0])

                self.assertEqual(job.maintenance_method, "replacement")
                self.assertEqual(job.tasks[0]["spare"], explicit_spares)
                self.assertEqual(model.nodes["deck"]["inventory"]["product-a"], 3)
                self.assertEqual(model.nodes["deck"]["inventory"]["product-b"], 4)
                self.assertEqual(model.nodes["deck"]["inventory"]["failed-lru"], 9)
                self.assertEqual(model.spare_consumed_total, 5)

    def test_non_replacement_does_not_gate_or_consume_explicit_spares(self) -> None:
        inputs = _minimal_inputs()
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["non_replacement"]
        activity["replacement_ratio"] = 0.0
        activity["jobs"] = [{
            "activityCode": "repair", "durationMinutes": 1,
            "spare": [{"product_id": "missing-spare", "quantity": 4}],
        }]
        model = AircraftSupportV1Model(inputs)

        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]
        model._start_waiting_jobs()
        model._consume_task_spare(job, job.tasks[0])

        self.assertEqual(job.maintenance_method, "non_replacement")
        self.assertEqual(job.state, "running")
        self.assertEqual(model.spare_consumed_total, 0)
        self.assertFalse(any(event["event"] == "spare_shortage" for event in model.event_log))

    def test_replacement_plural_spares_flow_through_shortage_transport_and_consumption(self) -> None:
        inputs = _minimal_inputs()
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["replacement"]
        activity["replacement_ratio"] = 1.0
        activity["jobs"] = [{
            "activityCode": "replace", "durationMinutes": 1,
            "spare": [
                {"product_id": "product-a", "quantity": 2},
                {"product_id": "product-b", "quantity": 3},
            ],
        }]
        deck = inputs["support_network"]["nodes"][0]
        deck["inventory"] = {"product-a": 0, "product-b": 0}
        deck["transport_policies"] = [
            {"from": "stock", "to": "deck", "spare_type": "product-a", "capacity": 2, "transport_minutes": 1},
            {"from": "stock", "to": "deck", "spare_type": "product-b", "capacity": 3, "transport_minutes": 1},
        ]
        inputs["support_network"]["nodes"].append({
            "id": "stock", "name": "Stock", "personnel_capacity": 1, "equipment_capacity": 1,
            "inventory": {"product-a": 2, "product-b": 3}, "transport_policies": [],
        })
        model = AircraftSupportV1Model(inputs)
        failed_lru = _runtime_component("failed", "aircraft", "Failed LRU", 0.1, product_id="failed-lru")

        model._create_job(model.aircraft[0], model.activities[1], kind="repair", component=failed_lru)
        job = model.jobs[-1]
        model._start_waiting_jobs()

        self.assertEqual(job.state, "waiting")
        self.assertEqual(len(model.transport_shipments), 2)
        self.assertEqual({shipment.spare_type for shipment in model.transport_shipments}, {"product-a", "product-b"})
        shortages = [event for event in model.event_log if event["event"] == "spare_shortage"]
        dispatched = [event for event in model.event_log if event["event"] == "transport_dispatched"]
        self.assertEqual({event["details"]["product_id"] for event in shortages}, {"product-a", "product-b"})
        self.assertEqual({event["details"]["product_id"] for event in dispatched}, {"product-a", "product-b"})

        model.minute = 1
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        model._process_job_progress_and_completions()

        self.assertEqual(job.state, "completed")
        self.assertEqual(model.nodes["deck"]["inventory"], {"product-a": 0, "product-b": 0})
        self.assertEqual(model.spare_consumed_total, 5)
        arrived = [event for event in model.event_log if event["event"] == "transport_arrived"]
        consumed = [event for event in model.event_log if event["event"] == "spare_consumed"]
        self.assertEqual({event["details"]["product_id"] for event in arrived}, {"product-a", "product-b"})
        self.assertEqual({event["details"]["product_id"] for event in consumed}, {"product-a", "product-b"})

    def test_maintenance_ratio_boundaries_and_midpoint_use_one_deterministic_roll(self) -> None:
        for ratio in (0.0, 0.5, 1.0):
            with self.subTest(ratio=ratio):
                inputs = _minimal_inputs()
                activity = inputs["support_activities"]["activities"][1]
                activity["maintenance_methods"] = ["non_replacement", "replacement"]
                activity["replacement_ratio"] = ratio
                model = AircraftSupportV1Model(inputs)

                model._create_job(model.aircraft[0], model.activities[1], kind="repair")

                job = model.jobs[-1]
                expected = "replacement" if job.maintenance_decision_roll < ratio else "non_replacement"
                self.assertEqual(job.maintenance_method, expected)
                self.assertEqual(job.replacement_ratio, ratio)
                decisions = [event for event in model.event_log if event["event"] == "maintenance_method_selected"]
                self.assertEqual(len(decisions), 1)

    def test_maintenance_rng_substreams_are_deterministic_and_do_not_advance_failure_rng(self) -> None:
        inputs = _minimal_inputs()
        inputs["seed"] = 314159
        component = _runtime_component("radar", "aircraft", "Radar", 0.2)
        inputs["equipment_tree"]["components"] = [component]
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["non_replacement", "replacement"]
        activity["replacement_ratio"] = 0.5
        first = AircraftSupportV1Model(inputs)
        second = AircraftSupportV1Model(inputs)
        first_failure_rng_state = first.rng.getstate()
        second_failure_rng_state = second.rng.getstate()

        first._create_job(first.aircraft[0], first.activities[1], kind="repair")
        second._create_job(second.aircraft[0], second.activities[1], kind="repair")

        first_job = first.jobs[-1]
        second_job = second.jobs[-1]
        self.assertEqual(first_job.maintenance_method, second_job.maintenance_method)
        self.assertEqual(first_job.maintenance_decision_roll, second_job.maintenance_decision_roll)
        self.assertEqual(first_job.maintenance_rng_stream, second_job.maintenance_rng_stream)
        self.assertEqual(first.rng.getstate(), first_failure_rng_state)
        self.assertEqual(second.rng.getstate(), second_failure_rng_state)
        first_next_failure = first._sample_lru_failure_minutes(first.components[0])
        second_next_failure = second._sample_lru_failure_minutes(second.components[0])
        self.assertEqual(first_next_failure, second_next_failure)
        self.assertEqual(first.rng.getstate(), second.rng.getstate())
        failure_rng_state_after_sample = first.rng.getstate()
        decision = next(event for event in first.event_log if event["event"] == "maintenance_method_selected")
        self.assertEqual(decision["details"]["job_id"], first_job.job_id)
        self.assertEqual(decision["details"]["maintenance_method"], first_job.maintenance_method)
        self.assertEqual(decision["details"]["rng_stream"], first_job.maintenance_rng_stream)

        first._create_job(first.aircraft[0], first.activities[1], kind="repair")

        self.assertNotEqual(first.jobs[-1].maintenance_rng_stream, first_job.maintenance_rng_stream)
        self.assertEqual(first.rng.getstate(), failure_rng_state_after_sample)

    def test_dispatch_requires_every_aircraft_to_complete_preflight(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.required_aircraft = 2
        model.aircraft[0].prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()

        self.assertNotEqual(mission.status, "launched")
        self.assertEqual(model.aircraft[0].state, "available")
        self.assertEqual(model.aircraft[1].state, "available")

    def test_preflight_jobs_are_supplemented_until_required_aircraft_are_commissioned(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.planned_start = 60
        mission.preparation_start = 0
        mission.required_aircraft = 2
        model.aircraft[1].state = "maintenance"

        model._create_due_preflight_jobs()

        self.assertFalse(mission.preflight_created)
        self.assertEqual(len([job for job in model.jobs if job.kind == "preflight"]), 1)

        model.aircraft[1].state = "available"
        model._create_due_preflight_jobs()

        self.assertTrue(mission.preflight_created)
        self.assertEqual(len([job for job in model.jobs if job.kind == "preflight"]), 2)

    def test_behavior_scope_promotes_m9_7_4_fields(self) -> None:
        scope = AircraftSupportV1Model.behavior_scope()

        self.assertIn("components[].failureDistribution", scope["behavior_driving_fields"])
        self.assertIn("transportPolicies[]", scope["behavior_driving_fields"])
        self.assertIn("supportResources[].quantity", scope["behavior_driving_fields"])
        self.assertIn("missionProfile.periodicTasks", scope["behavior_driving_fields"])
        self.assertNotIn("reliabilityBlockDiagram", scope["behavior_driving_fields"])
        self.assertIn("supportActivityJobs[]", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].aircraftModel", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].equipmentId", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].activityCodes", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].predecessors", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].maintenanceMethods", scope["behavior_driving_fields"])
        self.assertIn("supportActivities[].replacementRatio", scope["behavior_driving_fields"])
        self.assertNotIn("experiment.steps", scope["behavior_driving_fields"])
        self.assertEqual(scope["fail_closed_fields"], [])
        self.assertEqual(scope["m9_7_4_coverage_hardening_fields"], [])

    def test_failure_distribution_types_drive_effective_rates(self) -> None:
        inputs = _minimal_inputs()
        inputs["equipment_tree"]["components"] = [
            {
                "id": "weibull",
                "parent_id": "aircraft",
                "failure_distribution": {"distributionType": "威布尔分布", "parameters": "beta=2, eta=100"},
            },
            {
                "id": "normal",
                "parent_id": "aircraft",
                "failure_distribution": {"distributionType": "正态分布", "parameters": "mean=50, sigma=5"},
            },
        ]

        model = AircraftSupportV1Model(inputs)

        rates = {component["id"]: component["failure_rate"] for component in model.components}
        self.assertGreater(rates["weibull"], 0)
        self.assertAlmostEqual(rates["normal"], 0.02)

    def test_scalar_failure_rate_is_not_a_runtime_fallback(self) -> None:
        inputs = _minimal_inputs()
        inputs["equipment_tree"]["components"] = [
            {"id": "legacy", "parent_id": "aircraft", "name": "Legacy", "failure_rate": 1000}
        ]

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(model.components, [])

    def test_transport_policy_capacity_limits_single_replenishment(self) -> None:
        inputs = _minimal_inputs()
        model = AircraftSupportV1Model(inputs)
        model.nodes["stock"] = {
            "id": "stock",
            "name": "Stock",
            "personnel_capacity": 1,
            "equipment_capacity": 1,
            "personnel_in_use": 0,
            "equipment_in_use": 0,
            "inventory": {"module": 10},
            "transport_policies": [],
            "work_count": 0,
        }
        deck = model.nodes["deck"]
        deck["inventory"]["module"] = 0
        deck["transport_policies"] = [{"from": "stock", "to": "deck", "spare_type": "module", "capacity": 2}]

        model._try_transport_replenishment(deck, "module", 5)

        self.assertEqual(deck["inventory"]["module"], 2)
        self.assertEqual(model.nodes["stock"]["inventory"]["module"], 8)

    def test_mean_recovery_time_uses_elapsed_duration_not_absolute_return_time(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        mission = model.missions[0]
        mission.actual_start = 15
        mission.return_time = 45

        self.assertEqual(model.snapshot()["mean_recovery_time"], 30)

    def test_mission_return_without_actual_start_keeps_flight_hours_non_negative(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        aircraft = model.aircraft[0]
        mission = model.missions[0]
        mission.actual_start = None
        aircraft.state = "flying"
        aircraft.current_mission_id = mission.mission_id
        aircraft.return_time = 45
        model.minute = 45

        model._return_aircraft_from_mission(aircraft, early_return=False)

        self.assertGreaterEqual(aircraft.flight_hours, 0.0)
        self.assertEqual(aircraft.landing_count, 1)

    def test_failed_count_tracks_aircraft_under_failed_component_maintenance(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        model.aircraft[0].state = "maintenance"
        model.aircraft[0].failed_component_id = "engine"

        self.assertEqual(model.snapshot()["failed_count"], 1)

    def test_duplicate_periodic_composite_reference_fails_closed(self) -> None:
        inputs = _minimal_inputs()
        inputs["mission_profile"]["composite_tasks"] = [
            {
                "id": "composite-a",
                "name": "Composite A",
                "taskItems": [
                    {
                        "id": "task-a",
                        "basicTaskName": "Basic A",
                        "firstWaveTime": "00:00",
                        "equipmentQuantity": 1,
                        "equipmentType": "J-15",
                    }
                ],
            }
        ]
        inputs["mission_profile"]["periodic_tasks"] = [
            {"id": "periodic-1", "name": "Periodic 1", "repeatCount": 1, "compositeTaskIds": ["composite-a"]},
            {"id": "periodic-2", "name": "Periodic 2", "repeatCount": 1, "compositeTaskIds": ["composite-a"]},
        ]

        with self.assertRaisesRegex(ValueError, "composite-a"):
            AircraftSupportV1Model(inputs)

    def test_periodic_weekday_rows_restrict_active_mission_days(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 7 * 24 * 60
        inputs["mission_profile"]["composite_tasks"] = [
            {
                "id": "composite-a",
                "name": "Three day composite",
                "taskItems": [
                    {
                        "id": "task-a",
                        "basicMissionId": "mission-a",
                        "basicTaskName": "mission",
                        "firstWaveTime": "00:00",
                        "taskDurationMinutes": 30,
                        "equipmentQuantity": 1,
                        "equipmentType": "J-15",
                    }
                ],
            }
        ]
        inputs["mission_profile"]["periodic_tasks"] = [
            {
                "id": "periodic-three-day",
                "name": "Three day task",
                "periodDays": 7,
                "repeatCount": 1,
                "compositeTaskIds": ["composite-a"],
                "compositeTasks": [
                    {"weekIndex": 1, "weekday": "mondayCompositeTaskId", "compositeTaskId": "composite-a"},
                    {"weekIndex": 1, "weekday": "tuesdayCompositeTaskId", "compositeTaskId": "composite-a"},
                    {"weekIndex": 1, "weekday": "wednesdayCompositeTaskId", "compositeTaskId": "composite-a"},
                    {"weekIndex": 1, "weekday": "thursdayCompositeTaskId", "compositeTaskId": ""},
                    {"weekIndex": 1, "weekday": "fridayCompositeTaskId", "compositeTaskId": ""},
                    {"weekIndex": 1, "weekday": "saturdayCompositeTaskId", "compositeTaskId": ""},
                    {"weekIndex": 1, "weekday": "sundayCompositeTaskId", "compositeTaskId": ""},
                ],
            }
        ]

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(sorted({mission.day_index for mission in model.missions}), [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
