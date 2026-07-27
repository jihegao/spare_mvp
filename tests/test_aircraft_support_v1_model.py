from __future__ import annotations

import json
import unittest
from pathlib import Path

from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_abm.aircraft_support_v1.component_index import aircraft_type_tokens
from src.spare_mvp_abm.aircraft_support_v1.model import (
    AircraftSupportV1Model,
    JobState,
    MissionState,
    _resource_quantity,
)
from src.spare_mvp_abm.aircraft_support_v1.organization_observability import organization_dispatch_summary
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


def _vertical_organization_inputs(*, local_quantity: int = 0, parent_quantity: int = 3) -> dict:
    inputs = _minimal_inputs()
    inputs["aircraft"]["fleet_count"] = 1
    inputs["aircraft"]["initial_ready"] = 1
    inputs["support_network"] = {
        "nodes": [
            {
                "id": "deck",
                "name": "Deck",
                "organization_node_id": "org-leaf",
                "personnel_capacity": 2,
                "equipment_capacity": 2,
                "inventory": {"shared-spare": local_quantity},
                "transport_policies": [],
            },
            {
                "id": "stock",
                "name": "Stock",
                "organization_node_id": "org-parent",
                "personnel_capacity": 1,
                "equipment_capacity": 1,
                "inventory": {"shared-spare": parent_quantity},
                "transport_policies": [],
            },
            {
                "id": "lateral-stock",
                "name": "Lateral Stock",
                "organization_node_id": "org-lateral",
                "personnel_capacity": 1,
                "equipment_capacity": 1,
                "inventory": {"shared-spare": 9},
                "transport_policies": [],
            },
        ],
        "organization_graph": {
            "nodes": [
                {"id": "org-root", "name": "Root", "parent_id": None, "service_scope": {}},
                {"id": "org-parent", "name": "Parent", "parent_id": "org-root", "service_scope": {}},
                {"id": "org-leaf", "name": "Leaf", "parent_id": "org-parent", "service_scope": {}},
                {"id": "org-lateral", "name": "Lateral", "parent_id": "org-root", "service_scope": {}},
            ],
            "parent_edges": [
                {"from_node_id": "org-root", "to_node_id": "org-parent"},
                {"from_node_id": "org-parent", "to_node_id": "org-leaf"},
                {"from_node_id": "org-root", "to_node_id": "org-lateral"},
            ],
            "lateral_edges": [
                {
                    "id": "lateral-to-leaf",
                    "from_node_id": "org-lateral",
                    "to_node_id": "org-leaf",
                    "priority": 1,
                }
            ],
            "resource_ownership": [],
            "transport_policies": [
                {
                    "id": "parent-to-leaf",
                    "from_organization_node_id": "org-parent",
                    "to_organization_node_id": "org-leaf",
                    "product_id": "shared-spare",
                    "capacity": 2,
                    "priority": 1,
                    "transport_time_hours": 1 / 6,
                },
                {
                    "id": "lateral-policy",
                    "from_organization_node_id": "org-lateral",
                    "to_organization_node_id": "org-leaf",
                    "product_id": "shared-spare",
                    "capacity": 9,
                    "priority": 1,
                    "transport_time_hours": 0,
                },
            ],
        },
    }
    repair = inputs["support_activities"]["activities"][1]
    repair["maintenance_methods"] = ["replacement"]
    repair["replacement_ratio"] = 1.0
    repair["resource_id"] = "deck"
    repair["jobs"] = [{
        "activityCode": "replace",
        "durationMinutes": 1,
        "spare": [{"product_id": "shared-spare", "quantity": 1}],
    }]
    return inputs


def _lateral_organization_inputs(*, local_quantity: int = 0, parent_quantity: int = 3) -> dict:
    inputs = _vertical_organization_inputs(
        local_quantity=local_quantity,
        parent_quantity=parent_quantity,
    )
    graph = inputs["support_network"]["organization_graph"]
    graph["runtime_mode"] = "vertical_lateral"
    graph["nodes"][-1]["parent_id"] = "org-parent"
    graph["parent_edges"][-1] = {
        "from_node_id": "org-parent",
        "to_node_id": "org-lateral",
    }
    graph["lateral_edges"][0]["enabled"] = True
    for node in graph["nodes"]:
        node["service_scope"] = {
            "airport_ids": [],
            "aircraft_models": [],
            "product_ids": [],
            "resource_types": [],
        }
    return inputs


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
    project.setdefault("supportOrganization", {})["runtimeMode"] = "vertical"
    for activity in project["supportActivities"]:
        activity["resourceId"] = "基地"
    inputs = SimulationAdapter().compile_scenario(project, model_family="aircraft_support_v1")["simulation_inputs"]
    # Direct model tests keep the canonical runtime-node ID emitted by the
    # SimulationAdapter. Display names such as "基地" are not runtime IDs.
    assert all(
        activity.get("resource_id") == "carrier-deck"
        for activity in inputs["support_activities"]["activities"]
    )
    return inputs


class AircraftSupportV1ModelTest(unittest.TestCase):
    def test_composite_items_without_ids_have_distinct_runtime_missions_and_all_complete(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 120
        inputs["aircraft"] = {"fleet_count": 3, "initial_ready": 3, "models": ["J-15"]}
        basic = inputs["mission_profile"]["basic_missions"][0]
        basic["preparationMinutes"] = 0
        basic["equipmentQuantity"] = 1
        inputs["mission_profile"]["composite_tasks"] = [
            {
                "id": "composite-no-item-ids",
                "name": "A/B/D formation sorties",
                "taskItems": [
                    {
                        "basicMissionId": "mission-a",
                        "basicTaskName": "A sortie",
                        "groupName": "A",
                        "firstWaveTime": "00:20",
                        "taskDurationMinutes": 5,
                        "equipmentQuantity": 1,
                    },
                    {
                        "basicMissionId": "mission-a",
                        "basicTaskName": "B sortie",
                        "groupName": "B",
                        "firstWaveTime": "00:40",
                        "taskDurationMinutes": 5,
                        "equipmentQuantity": 1,
                    },
                    {
                        "basicMissionId": "mission-a",
                        "basicTaskName": "D sortie",
                        "groupName": "D",
                        "firstWaveTime": "01:00",
                        "taskDurationMinutes": 5,
                        "equipmentQuantity": 1,
                    },
                ],
            }
        ]
        for activity in inputs["support_activities"]["activities"]:
            for job in activity["jobs"]:
                job["durationMinutes"] = 1

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(len({mission.mission_id for mission in model.missions}), 3)
        self.assertEqual(
            [mission.mission_id for mission in model.missions],
            [
                "composite-no-item-ids__item-1-d1-w1",
                "composite-no-item-ids__item-2-d1-w1",
                "composite-no-item-ids__item-3-d1-w1",
            ],
        )

        model.run()

        self.assertEqual([mission.status for mission in model.missions], ["completed", "completed", "completed"])
        self.assertEqual(model.completed_sorties, 3)

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

    def test_j16_mission_does_not_dispatch_j16d_aircraft_by_prefix(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["assets"] = [
            {"tailNumber": "J16D-201", "aircraftType": "J16D", "model": "J16D", "initialState": "available"},
            {"tailNumber": "J16-101", "aircraftType": "J16", "model": "J16", "initialState": "available"},
        ]
        inputs["mission_profile"]["basic_missions"][0]["equipmentType"] = "J16"
        inputs["mission_profile"]["basic_missions"][0]["equipmentQuantity"] = 1
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0

        model._create_due_preflight_jobs()

        self.assertEqual([job.tail_number for job in model.jobs if job.kind == "preflight"], ["J16-101"])
        model.aircraft[0].prepared_mission_ids.add(mission.mission_id)
        model.aircraft[1].state = "available"
        model.aircraft[1].prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()

        self.assertEqual(mission.assigned_tail_numbers, ["J16-101"])
        self.assertEqual(model.aircraft[0].state, "available")

    def test_preflight_uses_the_support_activity_owned_by_each_basic_mission(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["assets"] = [
            {"tailNumber": "J16-101", "aircraftType": "J16", "model": "J16", "initialState": "available"},
            {"tailNumber": "J16D-201", "aircraftType": "J16D", "model": "J16D", "initialState": "available"},
        ]
        inputs["support_activities"]["activities"][0] = {
            "id": "j16-preflight",
            "name": "J16使用保障",
            "activity_type": "使用保障活动",
            "aircraft_model": "J16",
            "resource_id": "deck",
            "jobs": [{"activityCode": "j16-pf", "durationMinutes": 20, "workName": "J16 preflight"}],
        }
        inputs["support_activities"]["activities"].insert(1, {
            "id": "j16d-preflight",
            "name": "J16D使用保障",
            "activity_type": "使用保障活动",
            "aircraft_model": "J16D",
            "resource_id": "deck",
            "jobs": [{"activityCode": "j16d-pf", "durationMinutes": 20, "workName": "J16D preflight"}],
        })
        inputs["mission_profile"]["basic_missions"] = [
            {
                "id": "mission-j16",
                "name": "J16 mission",
                "equipmentType": "J16",
                "equipmentQuantity": 1,
                "preparationMinutes": 20,
                "supportActivityName": "J16使用保障",
            },
            {
                "id": "mission-j16d",
                "name": "J16D mission",
                "equipmentType": "J16D",
                "equipmentQuantity": 1,
                "preparationMinutes": 20,
                "supportActivityName": "J16D使用保障",
            },
        ]
        inputs["mission_profile"]["composite_tasks"] = [{
            "id": "mixed-missions",
            "taskItems": [
                {
                    "id": "j16-wave",
                    "basicMissionId": "mission-j16",
                    "equipmentType": "J16",
                    "equipmentQuantity": 1,
                    "firstWaveTime": "00:20",
                },
                {
                    "id": "j16d-wave",
                    "basicMissionId": "mission-j16d",
                    "equipmentType": "J16D",
                    "equipmentQuantity": 1,
                    "firstWaveTime": "00:20",
                },
            ],
        }]
        model = AircraftSupportV1Model(inputs)

        model._create_due_preflight_jobs()

        jobs_by_tail = {
            job.tail_number: job.activity_id
            for job in model.jobs
            if job.kind == "preflight"
        }
        self.assertEqual(
            jobs_by_tail,
            {"J16-101": "j16-preflight", "J16D-201": "j16d-preflight"},
        )

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

    def test_default_postflight_uses_aircraft_local_node_with_canonical_organization(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [{
                "tail_number": "J15-101",
                "aircraft_type": "J-15",
                "model": "J-15",
                "airport": "A",
                "initial_state": "available",
            }],
        }
        inputs["support_network"] = {
            "nodes": [
                {
                    "id": "基地",
                    "name": "基地",
                    "organization_node_id": "org-base",
                    "personnel_capacity": 0,
                    "equipment_capacity": 0,
                    "inventory": {},
                    "transport_policies": [],
                },
                {
                    "id": "基层",
                    "name": "基层",
                    "organization_node_id": "org-local",
                    "airport": "A",
                    "personnel_capacity": 2,
                    "equipment_capacity": 2,
                    "inventory": {},
                    "transport_policies": [],
                },
            ],
            "organization_graph": {
                "nodes": [
                    {"id": "org-root", "name": "保障组织", "parent_id": None, "service_scope": {}},
                    {"id": "org-base", "name": "基地", "parent_id": "org-root", "service_scope": {}},
                    {"id": "org-local", "name": "基层", "parent_id": "org-root", "service_scope": {}},
                ],
                "parent_edges": [
                    {"from_node_id": "org-root", "to_node_id": "org-base"},
                    {"from_node_id": "org-root", "to_node_id": "org-local"},
                ],
                "lateral_edges": [],
                "resource_ownership": [],
                "transport_policies": [],
            },
        }
        inputs["support_activities"]["activities"] = [
            activity for activity in inputs["support_activities"]["activities"] if activity["id"] != "postflight"
        ]
        for activity in inputs["support_activities"]["activities"]:
            activity["resource_id"] = "基层"
        model = AircraftSupportV1Model(inputs)
        mission = model.missions[0]
        mission.planned_start = 0
        mission.preparation_start = 0
        mission.duration_minutes = 5
        mission.required_aircraft = 1
        model.aircraft[0].prepared_mission_ids.add(mission.mission_id)

        model._dispatch_due_missions()
        model.minute = 5
        model._process_mission_returns()

        postflight_job = next(job for job in model.jobs if job.kind == "postflight")
        self.assertEqual(postflight_job.resource_node_id, "基层")
        model._start_waiting_jobs()
        self.assertEqual(postflight_job.state, "running")

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

    def test_operational_availability_uses_hourly_binary_fleet_samples(self) -> None:
        model = AircraftSupportV1Model(_minimal_inputs())
        first, second = model.aircraft
        first.state = "flying"
        first.component_failure_minutes["minor-lru"] = 10
        second.state = "available"
        delayed_preventive = JobState(
            job_id="preventive-resource-delay",
            tail_number=second.tail_number,
            kind="preventive",
            activity_id="preventive",
            activity_name="preventive",
            tasks=[{"workName": "inspection"}],
            priority=1,
            resource_node_id="deck",
            state="waiting",
            shortage_reason="equipment_capacity",
        )
        model.jobs.append(delayed_preventive)

        model.minute = 59
        model._record_operational_availability_sample_if_due()
        before_first_hour = model.snapshot()
        self.assertIsNone(before_first_hour["operational_availability"])
        self.assertEqual(before_first_hour["operational_availability_sample_count"], 0)

        model.minute = 60
        model._record_operational_availability_sample_if_due()
        first_hour = model.snapshot()
        self.assertEqual(first_hour["available_aircraft_hours"], 1)
        self.assertEqual(first_hour["total_aircraft_hours"], 2)
        self.assertEqual(first_hour["operational_availability"], 0.5)

        delayed_preventive.state = "completed"
        second.state = "post_support"
        first.in_flight_failure = True
        first.failed_component_id = "critical-lru"
        model.minute = 120
        model._record_operational_availability_sample_if_due()
        second_hour = model.snapshot()
        self.assertEqual(second_hour["operational_availability_sample_count"], 2)
        self.assertEqual(second_hour["available_aircraft_hours"], 2)
        self.assertEqual(second_hour["total_aircraft_hours"], 4)
        self.assertEqual(second_hour["operational_availability"], 0.5)

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

    def test_initial_life_state_creates_one_minute_zero_job_with_all_due_dimensions(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [
                {
                    "tail_number": "J15-101",
                    "aircraft_type": "J-15",
                    "model": "J-15",
                    "initial_state": "available",
                    "initial_preventive_due": True,
                    "initial_life_state": {
                        "calendar_days": 10,
                        "flight_hours": 100.5,
                        "takeoff_landing_cycles": 20,
                    },
                }
            ],
        }
        preventive = inputs["support_activities"]["activities"][3]
        preventive.update(
            {
                "calendarDayInterval": 10,
                "runHourInterval": 100.5,
                "takeoffLandingInterval": 20,
            }
        )

        model = AircraftSupportV1Model(inputs)

        preventive_jobs = [job for job in model.jobs if job.kind == "preventive"]
        self.assertEqual(len(preventive_jobs), 1)
        self.assertEqual(
            preventive_jobs[0].due_dimensions,
            ["calendar_days", "flight_hours", "takeoff_landing_cycles"],
        )
        self.assertEqual(model.minute, 0)
        self.assertEqual(model.snapshot()["available_aircraft"], 0)
        self.assertEqual(model.snapshot()["preventive_maintenance_events"], 1)
        self.assertEqual(model.aircraft[0].flight_hours, 100.5)
        self.assertEqual(model.aircraft[0].takeoff_count, 20)
        self.assertEqual(model.aircraft[0].landing_count, 20)
        created = next(event for event in model.event_log if event["event"] == "preventive_created")
        self.assertEqual(created["time"], 0)
        self.assertEqual(created["details"]["due_dimensions"], preventive_jobs[0].due_dimensions)

    def test_initial_life_state_below_every_threshold_keeps_aircraft_available(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [
                {
                    "tail_number": "J15-101",
                    "aircraft_type": "J-15",
                    "model": "J-15",
                    "initial_state": "available",
                    "initial_preventive_due": False,
                    "initial_life_state": {
                        "calendar_days": 9,
                        "flight_hours": 100.25,
                        "takeoff_landing_cycles": 19,
                    },
                }
            ],
        }
        inputs["support_activities"]["activities"][3].update(
            {
                "calendarDayInterval": 10,
                "runHourInterval": 100.5,
                "takeoffLandingInterval": 20,
            }
        )

        model = AircraftSupportV1Model(inputs)

        self.assertEqual([job for job in model.jobs if job.kind == "preventive"], [])
        self.assertEqual(model.aircraft[0].state, "available")
        self.assertEqual(model.aircraft[0].initial_due_dimensions, [])
        self.assertEqual(model.snapshot()["preventive_maintenance_events"], 0)

    def test_zero_and_null_preventive_thresholds_disable_pre_life_dimensions(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [
                {
                    "tail_number": "J15-101",
                    "aircraft_type": "J-15",
                    "model": "J-15",
                    "initial_state": "available",
                    "initial_preventive_due": True,
                    "initial_life_state": {
                        "calendar_days": 500,
                        "flight_hours": 500.0,
                        "takeoff_landing_cycles": 500,
                    },
                }
            ],
        }
        inputs["support_activities"]["activities"][3].update(
            {
                "calendarDayInterval": 0,
                "runHourInterval": None,
                "takeoffLandingInterval": 0,
            }
        )

        model = AircraftSupportV1Model(inputs)

        self.assertEqual(model.aircraft[0].preventive_thresholds, {
            "calendar_days": 0,
            "flight_hours": 0.0,
            "takeoff_landing_cycles": 0,
        })
        self.assertEqual([job for job in model.jobs if job.kind == "preventive"], [])

    def test_initial_life_trace_survives_completion_in_run_and_visualization_results(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"] = {"duration_minutes": 8, "tick_minutes": 1, "sample_every_minutes": 1}
        inputs["aircraft"] = {
            "fleet_count": 1,
            "initial_ready": 1,
            "models": ["J-15"],
            "assets": [
                {
                    "tail_number": "J15-101",
                    "aircraft_type": "J-15",
                    "model": "J-15",
                    "initial_state": "available",
                    "initial_life_state": {
                        "calendar_days": 1,
                        "flight_hours": 8,
                        "takeoff_landing_cycles": 6,
                    },
                }
            ],
        }
        preventive = inputs["support_activities"]["activities"][3]
        preventive.update(
            {
                "calendarDayInterval": 1,
                "runHourInterval": 8,
                "takeoffLandingInterval": 6,
            }
        )
        preventive["jobs"][0]["durationMinutes"] = 1

        model = AircraftSupportV1Model(inputs)
        initial_frame = model.visualization_frame(run_id="trace", step=0)
        execution = model.run()

        expected_initial = {
            "calendar_days": 1,
            "flight_hours": 8.0,
            "takeoff_landing_cycles": 6,
        }
        expected_dimensions = ["calendar_days", "flight_hours", "takeoff_landing_cycles"]
        self.assertEqual(initial_frame["aircraft"][0]["initial_life_state"], expected_initial)
        self.assertEqual(initial_frame["aircraft"][0]["due_dimensions"], expected_dimensions)
        self.assertEqual(initial_frame["jobs"][0]["due_dimensions"], expected_dimensions)
        trace = execution["lifecycle_trace"][0]
        self.assertEqual(trace["initial_life_state"], expected_initial)
        self.assertEqual(trace["initial_due_dimensions"], expected_dimensions)
        self.assertFalse(trace["preventive_due"])
        self.assertEqual(trace["current_life_state"]["flight_hours"], 0.0)
        self.assertEqual(trace["current_life_state"]["takeoff_landing_cycles"], 0)
        self.assertLess(trace["current_life_state"]["calendar_days"], 1)
        self.assertTrue(any(event["event"] == "preventive_completed" for event in execution["events"]))

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

    def test_lru_failure_timers_and_countdown_are_scoped_to_aircraft_model(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["assets"] = [
            {"tailNumber": "J16-101", "aircraftType": "J16", "model": "J16", "initialState": "available"},
            {"tailNumber": "J16D-201", "aircraftType": "J16D", "model": "J16D", "initialState": "available"},
        ]
        inputs["equipment_tree"]["components"] = [
            _runtime_component("j16-root", "", "J16", 0, product_type="system", aircraft_model="J16"),
            _runtime_component("j16-lru", "j16-root", "J16 LRU", 1000, aircraft_model="J16"),
            _runtime_component("j16d-root", "", "J16D", 0, product_type="system", aircraft_model="J16D"),
            _runtime_component("j16d-lru", "j16d-root", "J16D LRU", 1000, aircraft_model="J16D"),
        ]

        model = AircraftSupportV1Model(inputs)
        j16, j16d = model.aircraft

        self.assertEqual(set(j16.lru_failure_remaining_minutes), {"j16-lru"})
        self.assertEqual(set(j16d.lru_failure_remaining_minutes), {"j16d-lru"})

        j16.state = "flying"
        j16.lru_failure_remaining_minutes["j16-lru"] = 999.0
        j16.lru_failure_remaining_minutes["j16d-lru"] = 1.0
        model.minute = 1

        model._evaluate_failures()

        self.assertNotIn("j16d-lru", j16.component_failure_minutes)
        self.assertEqual(model.snapshot()["lru_failures"], 0)

    def test_failure_steps_use_precomputed_component_applicability(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"]["fleet_count"] = 1
        inputs["aircraft"]["initial_ready"] = 1
        inputs["equipment_tree"]["components"] = [
            _runtime_component("engine", "aircraft", "Engine", 0.001, aircraft_model="J-15")
        ]
        aircraft_type_tokens.cache_clear()
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]
        aircraft.state = "flying"
        aircraft.lru_failure_remaining_minutes["engine"] = 10_000.0
        cache_after_initialization = aircraft_type_tokens.cache_info()

        for minute in range(1, 11):
            model.minute = minute
            model._evaluate_failures()

        self.assertEqual(aircraft_type_tokens.cache_info(), cache_after_initialization)
        self.assertEqual(aircraft.lru_failure_remaining_minutes["engine"], 9_990.0)

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

    def test_replacement_reserves_spare_at_start_so_one_unit_cannot_complete_two_jobs(self) -> None:
        inputs = _minimal_inputs()
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["replacement"]
        activity["replacement_ratio"] = 1.0
        activity["jobs"] = [{
            "activityCode": "replace", "durationMinutes": 1,
            "spare": [{"product_id": "shared-spare", "quantity": 1}],
        }]
        inputs["support_network"]["nodes"][0]["inventory"] = {"shared-spare": 1}
        model = AircraftSupportV1Model(inputs)
        for aircraft in model.aircraft:
            model._create_job(aircraft, model.activities[1], kind="repair")

        model._start_waiting_jobs()

        running = [job for job in model.jobs if job.state == "running"]
        waiting = [job for job in model.jobs if job.state == "waiting"]
        self.assertEqual(len(running), 1)
        self.assertEqual(len(waiting), 1)
        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 0)
        self.assertEqual(model.spare_consumed_total, 1)

        model._process_job_progress_and_completions()
        model._start_waiting_jobs()

        self.assertEqual(len([job for job in model.jobs if job.state == "completed"]), 1)
        self.assertEqual(len([job for job in model.jobs if job.state == "waiting"]), 1)
        consumed = [event for event in model.event_log if event["event"] == "spare_consumed"]
        self.assertEqual(len(consumed), 1)

    def test_canonical_organization_uses_local_inventory_before_parent_or_lateral_supply(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=1, parent_quantity=3)
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()

        # Assert.
        self.assertEqual(model.jobs[-1].state, "running")
        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 0)
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 3)
        self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 9)
        self.assertEqual(model.transport_shipments, [])
        local_events = [event for event in model.event_log if event["event"] == "organization_local_fulfilled"]
        self.assertEqual(local_events[-1]["details"]["context"]["organization_node_id"], "org-leaf")

    def test_canonical_parent_supply_uses_policy_batch_capacity_time_and_atomic_reservation(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=3)
        inputs["support_activities"]["activities"][1]["jobs"][0]["spare"][0]["quantity"] = 3
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        # Act / Assert: first policy-limited batch is reserved at dispatch.
        model._start_waiting_jobs()
        self.assertEqual(job.state, "waiting")
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 1)
        self.assertEqual(len(model.transport_shipments), 1)
        first = model.transport_shipments[0]
        self.assertEqual(first.quantity, 2)
        self.assertEqual(first.arrival_minute, 10)
        self.assertEqual(first.path_organization_node_ids, ("org-parent", "org-leaf"))
        self.assertEqual(first.transport_policy_ids, ("parent-to-leaf",))

        # Act / Assert: arrival enables the next deterministic batch, not over-capacity movement.
        model.minute = 10
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 0)
        self.assertEqual(len(model.transport_shipments), 1)
        self.assertEqual(model.transport_shipments[0].quantity, 1)
        self.assertEqual(model.transport_shipments[0].arrival_minute, 20)

        model.minute = 20
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "running")
        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 0)

    def test_canonical_two_hop_parent_chain_accumulates_time_and_ignores_lateral_edge(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        inputs["support_network"]["nodes"].append({
            "id": "root-stock",
            "name": "Root Stock",
            "organization_node_id": "org-root",
            "personnel_capacity": 1,
            "equipment_capacity": 1,
            "inventory": {"shared-spare": 1},
            "transport_policies": [],
        })
        inputs["support_network"]["organization_graph"]["transport_policies"].append({
            "id": "root-to-parent",
            "from_organization_node_id": "org-root",
            "to_organization_node_id": "org-parent",
            "product_id": "shared-spare",
            "capacity": 1,
            "priority": 2,
            "transport_time_hours": 5 / 60,
        })
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()

        # Assert.
        self.assertEqual(len(model.transport_shipments), 1)
        shipment = model.transport_shipments[0]
        self.assertEqual(shipment.source_node_id, "root-stock")
        self.assertEqual(shipment.arrival_minute, 15)
        self.assertEqual(shipment.path_organization_node_ids, ("org-root", "org-parent", "org-leaf"))
        self.assertEqual(shipment.transport_policy_ids, ("root-to-parent", "parent-to-leaf"))
        self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 9)

    def test_canonical_missing_vertical_policy_fails_closed_without_global_or_lateral_fallback(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [
            policy for policy in graph["transport_policies"] if policy["id"] == "lateral-policy"
        ]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()

        # Assert.
        self.assertEqual(model.jobs[-1].state, "waiting")
        self.assertEqual(model.jobs[-1].shortage_reason, "organization_no_vertical_path:shared-spare")
        self.assertEqual(model.transport_shipments, [])
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 1)
        self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 9)
        failures = [event for event in model.event_log if event["event"] == "organization_dispatch_failed"]
        self.assertEqual(failures[-1]["details"]["reason"], "no_vertical_path")

    def test_canonical_concurrent_jobs_cannot_reserve_one_parent_unit_twice(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        inputs["aircraft"]["fleet_count"] = 2
        inputs["aircraft"]["initial_ready"] = 2
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"][0]["capacity"] = 1
        graph["transport_policies"][0]["transport_time_hours"] = 1 / 60
        model = AircraftSupportV1Model(inputs)
        for aircraft in model.aircraft:
            model._create_job(aircraft, model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()

        # Assert.
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 0)
        self.assertEqual(len(model.transport_shipments), 1)
        self.assertEqual(model.transport_shipments[0].quantity, 1)
        self.assertEqual([job.state for job in model.jobs], ["waiting", "waiting"])

    def test_canonical_plural_spare_dispatch_has_zero_side_effect_when_any_product_has_no_plan(self) -> None:
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent = inputs["support_network"]["nodes"][:2]
        deck["inventory"] = {"product-a": 0, "product-b": 0}
        parent["inventory"] = {"product-a": 1, "product-b": 0}
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [
            {
                "id": f"parent-to-leaf-{product_id}",
                "from_organization_node_id": "org-parent",
                "to_organization_node_id": "org-leaf",
                "product_id": product_id,
                "capacity": 1,
                "priority": 1,
                "transport_time_hours": 1 / 60,
            }
            for product_id in ("product-a", "product-b")
        ]
        repair = inputs["support_activities"]["activities"][1]
        repair["jobs"][0]["spare"] = [
            {"product_id": "product-a", "quantity": 1},
            {"product_id": "product-b", "quantity": 1},
        ]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        model._start_waiting_jobs()

        self.assertEqual(model.nodes["stock"]["inventory"], {"product-a": 1, "product-b": 0})
        self.assertEqual(model.transport_shipments, [])
        self.assertEqual(model.transport_replenishment_events, 0)

    def test_canonical_arrival_is_reserved_for_requesting_job_and_cancellation_returns_stock(self) -> None:
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        inputs["aircraft"].update({"fleet_count": 2, "initial_ready": 2})
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"][0].update({"capacity": 1, "transport_time_hours": 1 / 60})
        model = AircraftSupportV1Model(inputs)
        for aircraft in model.aircraft:
            model._create_job(aircraft, model.activities[1], kind="repair")
        requesting_job, competing_job = model.jobs

        model._start_waiting_jobs()
        model.minute = 1
        model._process_transport_arrivals()
        competing_job.priority = 1
        requesting_job.priority = 2
        model._start_waiting_jobs()

        self.assertEqual(requesting_job.state, "running")
        self.assertEqual(competing_job.state, "waiting")
        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 0)

        # A later shipment for a cancelled task is recoverable destination stock.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        inputs["support_network"]["organization_graph"]["transport_policies"][0].update(
            {"capacity": 1, "transport_time_hours": 1 / 60}
        )
        cancelled_model = AircraftSupportV1Model(inputs)
        cancelled_model._create_job(
            cancelled_model.aircraft[0], cancelled_model.activities[1], kind="repair"
        )
        cancelled_job = cancelled_model.jobs[-1]
        cancelled_model._start_waiting_jobs()
        cancelled_job.state = "cancelled"
        cancelled_model.minute = 1
        cancelled_model._process_transport_arrivals()
        self.assertEqual(cancelled_job.spare_reservations, {})
        self.assertEqual(cancelled_model.nodes["deck"]["inventory"]["shared-spare"], 1)

    def test_canonical_local_and_parent_stock_are_one_job_reservation_before_arrival(self) -> None:
        # Arrange: job 1 needs the leaf unit plus one parent unit; job 2 only needs
        # one unit and becomes higher priority after job 1's atomic plan commits.
        inputs = _vertical_organization_inputs(local_quantity=1, parent_quantity=1)
        inputs["aircraft"].update({"fleet_count": 2, "initial_ready": 2})
        inputs["support_network"]["organization_graph"]["transport_policies"][0].update(
            {"capacity": 1, "transport_time_hours": 1 / 60}
        )
        repair = inputs["support_activities"]["activities"][1]
        repair["jobs"][0]["spare"][0]["quantity"] = 2
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        repair_activity = model.activities[1]
        repair_activity["jobs"][0]["spare"][0]["quantity"] = 1
        model._create_job(model.aircraft[1], repair_activity, kind="repair")
        requesting_job, competing_job = model.jobs

        # Act / Assert: local and parent contributions commit atomically for job 1.
        model._start_waiting_jobs()
        self.assertEqual(requesting_job.spare_reservations, {(0, "shared-spare"): 1})
        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 0)
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 0)
        self.assertEqual(len(model.transport_shipments), 1)

        competing_job.priority = 1
        requesting_job.priority = 2
        model._start_waiting_jobs()
        self.assertEqual(competing_job.state, "waiting")

        model.minute = 1
        model._process_transport_arrivals()
        self.assertEqual(requesting_job.spare_reservations, {(0, "shared-spare"): 2})
        model._start_waiting_jobs()
        self.assertEqual(requesting_job.state, "running")
        self.assertEqual(competing_job.state, "waiting")

        # The same local + inbound reservation is fully recoverable on cancel.
        cancelled_inputs = _vertical_organization_inputs(local_quantity=1, parent_quantity=1)
        cancelled_inputs["support_network"]["organization_graph"]["transport_policies"][0].update(
            {"capacity": 1, "transport_time_hours": 1 / 60}
        )
        cancelled_inputs["support_activities"]["activities"][1]["jobs"][0]["spare"][0]["quantity"] = 2
        cancelled_model = AircraftSupportV1Model(cancelled_inputs)
        cancelled_model._create_job(
            cancelled_model.aircraft[0], cancelled_model.activities[1], kind="repair"
        )
        cancelled_job = cancelled_model.jobs[-1]
        cancelled_model._start_waiting_jobs()
        cancelled_job.state = "cancelled"
        cancelled_model.minute = 1
        cancelled_model._process_transport_arrivals()
        self.assertEqual(cancelled_job.spare_reservations, {})
        self.assertEqual(cancelled_model.nodes["deck"]["inventory"]["shared-spare"], 2)

    def test_canonical_personnel_and_equipment_can_arrive_from_different_nearest_ancestors(self) -> None:
        # Arrange: the parent can supply personnel while only the root can supply equipment.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent = inputs["support_network"]["nodes"][:2]
        deck.update({"personnel_capacity": 1, "equipment_capacity": 1})
        parent.update({"personnel_capacity": 3, "equipment_capacity": 1})
        inputs["support_network"]["nodes"].append({
            "id": "root-stock",
            "name": "Root Stock",
            "organization_node_id": "org-root",
            "personnel_capacity": 1,
            "equipment_capacity": 3,
            "inventory": {},
            "transport_policies": [],
        })
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [
            {
                "id": "parent-to-leaf-wildcard",
                "from_organization_node_id": "org-parent",
                "to_organization_node_id": "org-leaf",
                "product_id": "*",
                "capacity": 3,
                "priority": 1,
                "transport_time_hours": 1 / 6,
            },
            {
                "id": "root-to-parent-wildcard",
                "from_organization_node_id": "org-root",
                "to_organization_node_id": "org-parent",
                "product_id": "*",
                "capacity": 3,
                "priority": 1,
                "transport_time_hours": 5 / 60,
            },
        ]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair",
            "durationMinutes": 1,
            "requiredPersonnel": 2,
            "requiredDevices": 2,
        }]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        # Act / Assert: both capacities are atomically reserved at their suppliers.
        model._start_waiting_jobs()
        self.assertEqual(job.state, "waiting")
        self.assertEqual(job.resource_reservations, {
            "personnel": ("stock", 2),
            "equipment": ("root-stock", 2),
        })
        self.assertEqual(model.nodes["stock"]["personnel_in_use"], 2)
        self.assertEqual(model.nodes["root-stock"]["equipment_in_use"], 2)
        self.assertEqual(model.nodes["deck"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["deck"]["equipment_in_use"], 0)

        model.minute = 10
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "waiting")
        self.assertEqual(job.remote_resources_pending, {"equipment"})

        model.minute = 15
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "running")

        model._process_job_progress_and_completions()
        self.assertEqual(job.state, "completed")
        self.assertEqual(model.nodes["stock"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["root-stock"]["equipment_in_use"], 0)
        self.assertEqual(model.nodes["deck"]["personnel_capacity"], 1)
        self.assertEqual(model.nodes["deck"]["equipment_capacity"], 1)

    def test_canonical_resource_reservation_is_atomic_when_equipment_path_is_missing(self) -> None:
        # Arrange: personnel has a usable parent path, while equipment only exists
        # at root and the root-to-parent hop has no policy.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent = inputs["support_network"]["nodes"][:2]
        deck.update({"personnel_capacity": 1, "equipment_capacity": 1})
        parent.update({"personnel_capacity": 3, "equipment_capacity": 1})
        inputs["support_network"]["nodes"].append({
            "id": "root-stock",
            "name": "Root Stock",
            "organization_node_id": "org-root",
            "personnel_capacity": 1,
            "equipment_capacity": 3,
            "inventory": {},
            "transport_policies": [],
        })
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [
            {
                "id": "parent-to-leaf-wildcard",
                "from_organization_node_id": "org-parent",
                "to_organization_node_id": "org-leaf",
                "product_id": "*",
                "capacity": 3,
                "priority": 1,
                "transport_time_hours": 0,
            },
        ]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair",
            "durationMinutes": 1,
            "requiredPersonnel": 2,
            "requiredDevices": 2,
        }]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        # Act.
        model._start_waiting_jobs()

        # Assert: the valid personnel plan was not partially reserved.
        self.assertEqual(job.state, "waiting")
        self.assertEqual(job.shortage_reason, "organization_no_vertical_resource_path:equipment")
        self.assertEqual(job.resource_reservations, {})
        self.assertEqual(model.resource_transits, [])
        self.assertEqual(model.nodes["stock"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["root-stock"]["equipment_in_use"], 0)
        blocked = [event for event in model.event_log if event["event"] == "organization_resource_blocked"]
        self.assertEqual(blocked[-1]["details"]["context"]["resource_kind"], "equipment")

    def test_canonical_zero_minute_resource_transport_arrives_on_next_tick(self) -> None:
        # Arrange.
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent = inputs["support_network"]["nodes"][:2]
        deck.update({"personnel_capacity": 1, "equipment_capacity": 1})
        parent.update({"personnel_capacity": 3, "equipment_capacity": 3})
        inputs["support_network"]["organization_graph"]["transport_policies"] = [{
            "id": "instant-parent-to-leaf",
            "from_organization_node_id": "org-parent",
            "to_organization_node_id": "org-leaf",
            "product_id": "*",
            "capacity": 3,
            "priority": 1,
            "transport_time_hours": 0,
        }]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair",
            "durationMinutes": 1,
            "requiredPersonnel": 2,
            "requiredDevices": 2,
        }]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        # Act / Assert: zero policy time still cannot arrive in the dispatch tick.
        model._start_waiting_jobs()
        self.assertEqual(job.state, "waiting")
        self.assertEqual({transit.arrival_minute for transit in model.resource_transits}, {1})
        model._process_transport_arrivals()
        self.assertEqual(job.remote_resources_pending, {"personnel", "equipment"})

        model.minute = 1
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "running")

    def test_canonical_resources_are_atomically_reserved_and_dispatched_in_policy_batches(self) -> None:
        inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent = inputs["support_network"]["nodes"][:2]
        deck.update({"personnel_capacity": 0, "equipment_capacity": 0})
        parent.update({"personnel_capacity": 5, "equipment_capacity": 5})
        inputs["support_network"]["organization_graph"]["transport_policies"] = [{
            "id": "parent-to-leaf-wildcard",
            "from_organization_node_id": "org-parent",
            "to_organization_node_id": "org-leaf",
            "product_id": "*",
            "capacity": 2,
            "priority": 1,
            "transport_time_hours": 0,
        }]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair",
            "durationMinutes": 1,
            "requiredPersonnel": 5,
            "requiredDevices": 5,
        }]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        model._start_waiting_jobs()
        model._start_waiting_jobs()

        self.assertEqual(job.resource_reservations, {
            "personnel": ("stock", 5),
            "equipment": ("stock", 5),
        })
        self.assertEqual(model.nodes["stock"]["personnel_in_use"], 5)
        self.assertEqual(model.nodes["stock"]["equipment_in_use"], 5)
        self.assertEqual(
            sorted(transit.quantity for transit in model.resource_transits if transit.resource_kind == "personnel"),
            [1, 2, 2],
        )
        self.assertEqual(
            sorted(transit.quantity for transit in model.resource_transits if transit.resource_kind == "equipment"),
            [1, 2, 2],
        )
        selected = [event for event in model.event_log if event["event"] == "organization_resource_selected"]
        dispatched = [event for event in model.event_log if event["event"] == "organization_resource_dispatched"]
        self.assertEqual(len(selected), 2)
        self.assertEqual(len(dispatched), 6)

        model.minute = 1
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "running")
        model._process_job_progress_and_completions()
        self.assertEqual(job.state, "completed")
        self.assertEqual(model.nodes["stock"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["stock"]["equipment_in_use"], 0)

    def test_lateral_mode_uses_direct_incoming_relation_before_vertical_parent(self) -> None:
        # Arrange.
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=3)
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()

        # Assert.
        self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 8)
        self.assertEqual(model.nodes["stock"]["inventory"]["shared-spare"], 3)
        shipment = model.transport_shipments[0]
        self.assertEqual(shipment.path_organization_node_ids, ("org-lateral", "org-leaf"))
        self.assertEqual(shipment.transport_policy_ids, ("lateral-policy",))
        self.assertEqual(shipment.supply_mode, "lateral")
        self.assertEqual(shipment.relation_id, "lateral-to-leaf")
        dispatched = [
            event for event in model.event_log
            if event["event"] == "organization_transport_dispatched"
        ][-1]
        self.assertEqual(dispatched["details"]["source_mode"], "lateral")
        self.assertEqual(dispatched["details"]["relation_id"], "lateral-to-leaf")

        model.minute = 1
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(model.jobs[-1].state, "running")
        self.assertFalse(any(
            event["event"] == "organization_local_fulfilled"
            and event["details"]["requirement_type"] == "spare"
            for event in model.event_log
        ))

    def test_local_spare_personnel_and_equipment_emit_three_fulfilled_requirements(self) -> None:
        # Arrange.
        inputs = _lateral_organization_inputs(local_quantity=1, parent_quantity=0)
        task = inputs["support_activities"]["activities"][1]["jobs"][0]
        task.update({"requiredPersonnel": 1, "requiredDevices": 1})
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        # Act.
        model._start_waiting_jobs()
        summary = organization_dispatch_summary(
            model.event_log,
            identity=model.organization_graph_identity,
        )

        # Assert.
        fulfilled = [
            event for event in model.event_log
            if event["event"] == "organization_local_fulfilled"
        ]
        self.assertEqual(
            {(event["details"]["requirement_type"], event["details"]["requirement_id"]) for event in fulfilled},
            {("spare", "shared-spare"), ("personnel", "personnel"), ("equipment", "equipment")},
        )
        self.assertEqual(summary["observed_request_count"], 3)
        self.assertEqual(summary["observed_fulfilled_count"], 3)
        self.assertEqual(summary["observed_fulfillment_rate"], 1.0)

    def test_vertical_mode_and_disabled_lateral_relation_do_not_use_lateral_supply(self) -> None:
        for mode, enabled in (("vertical", True), ("vertical_lateral", False)):
            with self.subTest(mode=mode, enabled=enabled):
                inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=1)
                graph = inputs["support_network"]["organization_graph"]
                graph["runtime_mode"] = mode
                graph["lateral_edges"][0]["enabled"] = enabled
                model = AircraftSupportV1Model(inputs)
                model._create_job(model.aircraft[0], model.activities[1], kind="repair")

                model._start_waiting_jobs()

                shipment = model.transport_shipments[0]
                self.assertEqual(shipment.source_node_id, "stock")
                self.assertEqual(shipment.supply_mode, "vertical")
                self.assertEqual(shipment.relation_id, "")
                self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 9)

    def test_lateral_candidates_are_stable_by_priority_then_id_and_input_order(self) -> None:
        def configured_inputs(*, reverse: bool) -> dict:
            inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
            graph = inputs["support_network"]["organization_graph"]
            graph["nodes"].append({
                "id": "org-lateral-b",
                "name": "Lateral B",
                "parent_id": "org-parent",
                "service_scope": {
                    "airport_ids": [], "aircraft_models": [],
                    "product_ids": [], "resource_types": [],
                },
            })
            graph["parent_edges"].append({
                "from_node_id": "org-parent", "to_node_id": "org-lateral-b",
            })
            inputs["support_network"]["nodes"].append({
                "id": "lateral-stock-b", "name": "Lateral B",
                "organization_node_id": "org-lateral-b",
                "personnel_capacity": 1, "equipment_capacity": 1,
                "inventory": {"shared-spare": 4}, "transport_policies": [],
            })
            graph["lateral_edges"].extend([
                {
                    "id": "z-relation", "from_node_id": "org-lateral-b",
                    "to_node_id": "org-leaf", "priority": 1, "enabled": True,
                },
                {
                    "id": "a-relation", "from_node_id": "org-lateral",
                    "to_node_id": "org-leaf", "priority": 1, "enabled": True,
                },
            ])
            # Remove the helper relation so equal-priority ID ordering decides.
            graph["lateral_edges"] = [
                edge for edge in graph["lateral_edges"] if edge["id"] != "lateral-to-leaf"
            ]
            graph["transport_policies"].append({
                "id": "lateral-b-policy",
                "from_organization_node_id": "org-lateral-b",
                "to_organization_node_id": "org-leaf",
                "product_id": "shared-spare", "capacity": 2,
                "priority": 1, "transport_time_hours": 0,
            })
            if reverse:
                graph["nodes"].reverse()
                graph["parent_edges"].reverse()
                graph["lateral_edges"].reverse()
                graph["transport_policies"].reverse()
                inputs["support_network"]["nodes"].reverse()
            return inputs

        selected = []
        for reverse in (False, True):
            model = AircraftSupportV1Model(configured_inputs(reverse=reverse))
            model._create_job(model.aircraft[0], model.activities[1], kind="repair")
            model._start_waiting_jobs()
            selected.append((
                model.transport_shipments[0].source_node_id,
                model.transport_shipments[0].relation_id,
            ))

        self.assertEqual(selected, [("lateral-stock", "a-relation")] * 2)

    def test_lateral_candidate_without_stock_or_policy_falls_back_to_vertical_parent(self) -> None:
        for mutation in ("no-stock", "no-policy"):
            with self.subTest(mutation=mutation):
                inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=1)
                graph = inputs["support_network"]["organization_graph"]
                if mutation == "no-stock":
                    inputs["support_network"]["nodes"][2]["inventory"]["shared-spare"] = 0
                else:
                    graph["transport_policies"] = [
                        policy for policy in graph["transport_policies"]
                        if policy["id"] != "lateral-policy"
                    ]
                model = AircraftSupportV1Model(inputs)
                model._create_job(model.aircraft[0], model.activities[1], kind="repair")

                model._start_waiting_jobs()

                self.assertEqual(model.transport_shipments[0].source_node_id, "stock")
                self.assertEqual(model.transport_shipments[0].supply_mode, "vertical")

    def test_lateral_mode_does_not_borrow_from_unrelated_sibling_without_relation(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        graph = inputs["support_network"]["organization_graph"]
        graph["lateral_edges"] = []
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        model._start_waiting_jobs()

        self.assertEqual(model.transport_shipments, [])
        self.assertEqual(model.nodes["lateral-stock"]["inventory"]["shared-spare"], 9)
        self.assertEqual(model.jobs[-1].shortage_reason, "organization_no_available_supplier:shared-spare")

    def test_lateral_scope_mismatch_skips_relation_and_uses_vertical_parent(self) -> None:
        mismatches = {
            "resource_types": (["personnel"], "spare"),
            "product_ids": (["other-spare"], "shared-spare"),
            "aircraft_models": (["J-20"], "J-15"),
            "airport_ids": (["airport-b"], "airport-a"),
        }
        for field, (allowed_values, requested_value) in mismatches.items():
            with self.subTest(field=field):
                inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=1)
                inputs["support_network"]["nodes"][0]["airport_id"] = "airport-a"
                lateral_node = inputs["support_network"]["organization_graph"]["nodes"][-1]
                lateral_node["service_scope"][field] = allowed_values
                model = AircraftSupportV1Model(inputs)
                model._create_job(model.aircraft[0], model.activities[1], kind="repair")

                model._start_waiting_jobs()
                model._start_waiting_jobs()

                self.assertEqual(model.transport_shipments[0].source_node_id, "stock")
                self.assertEqual(model.transport_shipments[0].supply_mode, "vertical")
                rejected = [
                    event for event in model.event_log
                    if event["event"] == "organization_candidate_rejected"
                    and event["details"]["source_organization_node_id"] == "org-lateral"
                ]
                self.assertEqual(len(rejected), 1)
                expected_details = {
                    "job_id": model.jobs[-1].job_id,
                    "task_index": 0,
                    "resource_kind": "spare",
                    "product_id": "shared-spare",
                    "source_resource_id": "lateral-stock",
                    "source_organization_node_id": "org-lateral",
                    "destination_resource_id": "deck",
                    "destination_organization_node_id": "org-leaf",
                    "supply_mode": "lateral",
                    "relation_id": "lateral-to-leaf",
                    "reason": "scope_mismatch",
                    "scope_dimension": field,
                    "requested_value": requested_value,
                    "allowed_values": allowed_values,
                }
                self.assertEqual(
                    {key: {**rejected[0]["details"]["context"], **rejected[0]["details"]}[key] for key in expected_details},
                    expected_details,
                )
                self.assertEqual(rejected[0]["details"]["fact_type"], "candidate_rejected")
                self.assertEqual(rejected[0]["details"]["runtime_mode"], "vertical_lateral")
                self.assertEqual(len(rejected[0]["details"]["organization_graph_hash"]), 64)
                event_names = [event["event"] for event in model.event_log]
                self.assertLess(
                    event_names.index("organization_candidate_rejected"),
                    event_names.index("organization_supply_selected"),
                )
                self.assertLess(
                    event_names.index("organization_supply_selected"),
                    event_names.index("organization_transport_dispatched"),
                )

    def test_disabled_lateral_edge_still_participates_in_runtime_cycle_validation(self) -> None:
        inputs = _lateral_organization_inputs()
        inputs["support_network"]["organization_graph"]["lateral_edges"].append({
            "id": "disabled-reverse",
            "from_node_id": "org-leaf",
            "to_node_id": "org-lateral",
            "priority": 2,
            "enabled": False,
        })

        with self.assertRaisesRegex(ValueError, "acyclic"):
            AircraftSupportV1Model(inputs)

    def test_scope_rejection_remains_auditable_when_no_candidate_can_fulfill(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        lateral_node = inputs["support_network"]["organization_graph"]["nodes"][-1]
        lateral_node["service_scope"]["product_ids"] = ["other-spare"]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        model._start_waiting_jobs()

        event_names = [event["event"] for event in model.event_log]
        self.assertIn("organization_candidate_rejected", event_names)
        self.assertIn("organization_dispatch_failed", event_names)
        self.assertLess(
            event_names.index("organization_candidate_rejected"),
            event_names.index("organization_dispatch_failed"),
        )
        failure = next(
            event for event in model.event_log
            if event["event"] == "organization_dispatch_failed"
        )
        self.assertEqual(failure["details"]["reason"], "no_available_supplier")

    def test_lateral_mode_checks_local_scope_before_using_local_inventory(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=1, parent_quantity=0)
        leaf_node = inputs["support_network"]["organization_graph"]["nodes"][2]
        leaf_node["service_scope"]["product_ids"] = ["other-spare"]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        model._start_waiting_jobs()

        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], 1)
        self.assertEqual(model.transport_shipments[0].source_node_id, "lateral-stock")
        self.assertEqual(model.transport_shipments[0].supply_mode, "lateral")

    def test_lateral_plural_spare_plan_is_atomic_when_one_product_has_no_supplier(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent, lateral = inputs["support_network"]["nodes"]
        deck["inventory"] = {"product-a": 0, "product-b": 0}
        parent["inventory"] = {"product-a": 0, "product-b": 0}
        lateral["inventory"] = {"product-a": 1, "product-b": 0}
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [{
            "id": "lateral-product-a",
            "from_organization_node_id": "org-lateral",
            "to_organization_node_id": "org-leaf",
            "product_id": "product-a", "capacity": 1,
            "priority": 1, "transport_time_hours": 0,
        }]
        inputs["support_activities"]["activities"][1]["jobs"][0]["spare"] = [
            {"product_id": "product-a", "quantity": 1},
            {"product_id": "product-b", "quantity": 1},
        ]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")

        model._start_waiting_jobs()

        self.assertEqual(model.nodes["lateral-stock"]["inventory"], {"product-a": 1, "product-b": 0})
        self.assertEqual(model.transport_shipments, [])
        self.assertEqual(model.transport_replenishment_events, 0)

    def test_lateral_personnel_and_equipment_use_existing_atomic_batches_and_release(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        deck, parent, lateral = inputs["support_network"]["nodes"]
        deck.update({"personnel_capacity": 0, "equipment_capacity": 0})
        parent.update({"personnel_capacity": 0, "equipment_capacity": 0})
        lateral.update({"personnel_capacity": 5, "equipment_capacity": 5})
        graph = inputs["support_network"]["organization_graph"]
        graph["transport_policies"] = [{
            "id": "lateral-wildcard",
            "from_organization_node_id": "org-lateral",
            "to_organization_node_id": "org-leaf",
            "product_id": "*", "capacity": 2,
            "priority": 1, "transport_time_hours": 0,
        }]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair", "durationMinutes": 1,
            "requiredPersonnel": 5, "requiredDevices": 5,
        }]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        model._start_waiting_jobs()

        self.assertEqual(job.resource_reservations, {
            "personnel": ("lateral-stock", 5),
            "equipment": ("lateral-stock", 5),
        })
        for resource_kind in ("personnel", "equipment"):
            transits = [
                transit for transit in model.resource_transits
                if transit.resource_kind == resource_kind
            ]
            self.assertEqual(sorted(transit.quantity for transit in transits), [1, 2, 2])
            self.assertEqual({transit.supply_mode for transit in transits}, {"lateral"})
            self.assertEqual({transit.relation_id for transit in transits}, {"lateral-to-leaf"})
        dispatched = [
            event for event in model.event_log
            if event["event"] == "organization_resource_dispatched"
        ]
        self.assertEqual({event["details"]["source_mode"] for event in dispatched}, {"lateral"})
        self.assertEqual({event["details"]["relation_id"] for event in dispatched}, {"lateral-to-leaf"})

        model.minute = 1
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(job.state, "running")
        model._process_job_progress_and_completions()
        self.assertEqual(job.state, "completed")
        self.assertEqual(model.nodes["lateral-stock"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["lateral-stock"]["equipment_in_use"], 0)

    def test_lateral_concurrent_resource_jobs_cannot_double_reserve_supplier_capacity(self) -> None:
        inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=0)
        inputs["aircraft"].update({"fleet_count": 2, "initial_ready": 2})
        deck, parent, lateral = inputs["support_network"]["nodes"]
        deck.update({"personnel_capacity": 0, "equipment_capacity": 0})
        parent.update({"personnel_capacity": 0, "equipment_capacity": 0})
        lateral.update({"personnel_capacity": 5, "equipment_capacity": 5})
        inputs["support_network"]["organization_graph"]["transport_policies"] = [{
            "id": "lateral-wildcard",
            "from_organization_node_id": "org-lateral",
            "to_organization_node_id": "org-leaf",
            "product_id": "*", "capacity": 2,
            "priority": 1, "transport_time_hours": 0,
        }]
        repair = inputs["support_activities"]["activities"][1]
        repair["maintenance_methods"] = ["non_replacement"]
        repair["jobs"] = [{
            "activityCode": "repair", "durationMinutes": 1,
            "requiredPersonnel": 3, "requiredDevices": 3,
        }]
        model = AircraftSupportV1Model(inputs)
        for aircraft in model.aircraft:
            model._create_job(aircraft, model.activities[1], kind="repair")

        model._start_waiting_jobs()

        self.assertEqual(model.nodes["lateral-stock"]["personnel_in_use"], 3)
        self.assertEqual(model.nodes["lateral-stock"]["equipment_in_use"], 3)
        self.assertEqual(len([job for job in model.jobs if job.resource_reservations]), 1)
        self.assertEqual(len(model.resource_transits), 4)

    def test_lateral_runtime_rejects_cycles_unknown_unreachable_and_invalid_scope(self) -> None:
        cases: list[tuple[str, dict, str]] = []

        cyclic = _lateral_organization_inputs()
        cyclic["support_network"]["organization_graph"]["lateral_edges"].append({
            "id": "leaf-to-lateral", "from_node_id": "org-leaf",
            "to_node_id": "org-lateral", "priority": 1, "enabled": True,
        })
        cases.append(("cycle", cyclic, "acyclic"))

        unknown = _lateral_organization_inputs()
        unknown["support_network"]["organization_graph"]["lateral_edges"][0]["from_node_id"] = "unknown"
        cases.append(("unknown", unknown, "unknown endpoint"))

        unreachable = _lateral_organization_inputs()
        graph = unreachable["support_network"]["organization_graph"]
        graph["nodes"].append({
            "id": "org-unreachable", "name": "Unreachable", "parent_id": "org-parent",
            "service_scope": {
                "airport_ids": [], "aircraft_models": [],
                "product_ids": [], "resource_types": [],
            },
        })
        graph["parent_edges"].append({
            "from_node_id": "org-parent", "to_node_id": "org-unreachable",
        })
        graph["lateral_edges"][0]["from_node_id"] = "org-unreachable"
        cases.append(("unreachable", unreachable, "not runtime reachable"))

        invalid_scope = _lateral_organization_inputs()
        invalid_scope["support_network"]["organization_graph"]["nodes"][-1]["service_scope"]["product_ids"] = "shared-spare"
        cases.append(("scope", invalid_scope, "must be an array"))

        invalid_scope_value = _lateral_organization_inputs()
        invalid_scope_value["support_network"]["organization_graph"]["nodes"][-1]["service_scope"]["resource_types"] = ["fuel"]
        cases.append(("scope-value", invalid_scope_value, "invalid values"))

        for name, inputs, message in cases:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, message):
                    AircraftSupportV1Model(inputs)

    def test_vertical_lateral_with_no_relations_is_equivalent_to_vertical_mode(self) -> None:
        vertical_inputs = _lateral_organization_inputs(local_quantity=0, parent_quantity=1)
        vertical_inputs["support_network"]["organization_graph"].update({
            "runtime_mode": "vertical", "lateral_edges": [],
        })
        lateral_inputs = json.loads(json.dumps(vertical_inputs))
        lateral_inputs["support_network"]["organization_graph"]["runtime_mode"] = "vertical_lateral"

        results = []
        for inputs in (vertical_inputs, lateral_inputs):
            model = AircraftSupportV1Model(inputs)
            model._create_job(model.aircraft[0], model.activities[1], kind="repair")
            model._start_waiting_jobs()
            results.append((
                model.transport_shipments[0].source_node_id,
                model.transport_shipments[0].quantity,
                model.transport_shipments[0].arrival_minute,
                model.transport_shipments[0].transport_policy_ids,
                model.nodes["stock"]["inventory"]["shared-spare"],
            ))

        self.assertEqual(results[0], results[1])

    def test_canonical_runtime_nodes_require_unique_explicit_organization_mapping(self) -> None:
        # Arrange.
        missing = _vertical_organization_inputs()
        missing["support_network"]["nodes"][0].pop("organization_node_id")
        duplicate = _vertical_organization_inputs()
        duplicate["support_network"]["nodes"][1]["organization_node_id"] = "org-leaf"

        # Act / Assert.
        with self.assertRaisesRegex(ValueError, "requires organization_node_id"):
            AircraftSupportV1Model(missing)
        with self.assertRaisesRegex(ValueError, "maps to multiple runtime nodes"):
            AircraftSupportV1Model(duplicate)

    def test_replacement_reservation_is_atomic_across_plural_spares(self) -> None:
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
        inputs["support_network"]["nodes"][0]["inventory"] = {"product-a": 2, "product-b": 2}
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        model._start_waiting_jobs()

        self.assertEqual(job.state, "waiting")
        self.assertEqual(model.nodes["deck"]["inventory"], {"product-a": 2, "product-b": 2})
        self.assertEqual(model.spare_consumed_total, 0)
        self.assertFalse(any(event["event"] == "spare_consumed" for event in model.event_log))

        model.nodes["deck"]["inventory"]["product-b"] = 3
        model._start_waiting_jobs()

        self.assertEqual(job.state, "running")
        self.assertEqual(model.nodes["deck"]["inventory"], {"product-a": 0, "product-b": 0})
        self.assertEqual(model.spare_consumed_total, 5)

    def test_zero_quantity_is_explicit_no_requirement_on_all_replacement_paths(self) -> None:
        inputs = _minimal_inputs()
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["replacement"]
        activity["replacement_ratio"] = 1.0
        activity["jobs"] = [{
            "activityCode": "replace", "durationMinutes": 1,
            "spare": [
                {"product_id": "zero-spare", "quantity": 0},
                {"product_id": "positive-spare", "quantity": 2},
            ],
        }]
        inputs["support_network"]["nodes"][0]["inventory"] = {"zero-spare": 0, "positive-spare": 2, "failed-lru": 4}
        model = AircraftSupportV1Model(inputs)
        failed_lru = _runtime_component("failed", "aircraft", "Failed LRU", 0.1, product_id="failed-lru")

        model._create_job(model.aircraft[0], model.activities[1], kind="repair", component=failed_lru)
        job = model.jobs[-1]

        self.assertEqual(model._task_spare_requirements(job, job.tasks[0]), [("positive-spare", 2)])
        self.assertEqual(job.tasks[0]["spare"][0], {"product_id": "zero-spare", "quantity": 0})
        self.assertFalse(any("failed-lru" in str(task.get("spare")) for task in job.tasks))

        model._start_waiting_jobs()
        model._process_job_progress_and_completions()

        self.assertEqual(job.state, "completed")
        self.assertEqual(model.nodes["deck"]["inventory"]["zero-spare"], 0)
        self.assertEqual(model.nodes["deck"]["inventory"]["positive-spare"], 0)
        self.assertEqual(model.nodes["deck"]["inventory"]["failed-lru"], 4)
        self.assertEqual(model.spare_consumed_total, 2)
        traced_products = {
            event["details"]["product_id"]
            for event in model.event_log
            if event["event"] in {"spare_shortage", "spare_consumed"}
        }
        self.assertEqual(traced_products, {"positive-spare"})

    def test_unchanged_shortage_is_not_relogged_but_new_task_shortage_is(self) -> None:
        inputs = _minimal_inputs()
        activity = inputs["support_activities"]["activities"][1]
        activity["maintenance_methods"] = ["replacement"]
        activity["replacement_ratio"] = 1.0
        activity["jobs"] = [
            {"activityCode": "replace-1", "durationMinutes": 1, "spare": [{"product_id": "repeat-spare", "quantity": 1}]},
            {"activityCode": "replace-2", "durationMinutes": 1, "spare": [{"product_id": "repeat-spare", "quantity": 1}]},
        ]
        inputs["support_network"]["nodes"][0]["inventory"] = {"repeat-spare": 0}
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        job = model.jobs[-1]

        for minute in (1, 2, 3):
            model.minute = minute
            model._start_waiting_jobs()

        shortages = [event for event in model.event_log if event["event"] == "spare_shortage"]
        self.assertEqual(len(shortages), 1)
        self.assertEqual(model.shortage_events, 1)

        model.nodes["deck"]["inventory"]["repeat-spare"] = 1
        model._start_waiting_jobs()
        model._process_job_progress_and_completions()
        model._start_waiting_jobs()

        shortages = [event for event in model.event_log if event["event"] == "spare_shortage"]
        self.assertEqual(job.task_index, 1)
        self.assertEqual(job.state, "waiting")
        self.assertEqual(len(shortages), 2)
        self.assertEqual(model.shortage_events, 2)

        model._start_waiting_jobs()
        self.assertEqual(len([event for event in model.event_log if event["event"] == "spare_shortage"]), 2)

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
        interleaved = AircraftSupportV1Model(inputs)
        repair_control = AircraftSupportV1Model(inputs)
        preventive_control = AircraftSupportV1Model(inputs)
        interleaved_failure_rng_state = interleaved.rng.getstate()
        control_failure_rng_state = repair_control.rng.getstate()

        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[3], kind="preventive")
        first_preventive = interleaved.jobs[-1]
        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[0], kind="preflight")
        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[1], kind="repair")
        repair_control._create_job(repair_control.aircraft[0], repair_control.activities[1], kind="repair")
        preventive_control._create_job(
            preventive_control.aircraft[0],
            preventive_control.activities[3],
            kind="preventive",
        )
        first_interleaved_repair = interleaved.jobs[-1]
        first_control_repair = repair_control.jobs[-1]

        self.assertNotEqual(first_interleaved_repair.job_id, first_control_repair.job_id)
        self.assertEqual(first_interleaved_repair.maintenance_occurrence, 1)
        self.assertEqual(first_control_repair.maintenance_occurrence, 1)
        self.assertEqual(first_interleaved_repair.maintenance_decision_roll, first_control_repair.maintenance_decision_roll)
        self.assertEqual(first_interleaved_repair.maintenance_rng_stream, first_control_repair.maintenance_rng_stream)
        self.assertEqual(first_preventive.maintenance_decision_roll, preventive_control.jobs[-1].maintenance_decision_roll)

        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[2], kind="postflight")
        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[3], kind="preventive")
        interleaved._create_job(interleaved.aircraft[0], interleaved.activities[1], kind="repair")
        repair_control._create_job(repair_control.aircraft[0], repair_control.activities[1], kind="repair")
        second_interleaved_repair = interleaved.jobs[-1]
        second_control_repair = repair_control.jobs[-1]

        self.assertEqual(second_interleaved_repair.maintenance_occurrence, 2)
        self.assertEqual(second_control_repair.maintenance_occurrence, 2)
        self.assertEqual(second_interleaved_repair.maintenance_decision_roll, second_control_repair.maintenance_decision_roll)
        self.assertEqual(second_interleaved_repair.maintenance_rng_stream, second_control_repair.maintenance_rng_stream)
        self.assertNotEqual(second_interleaved_repair.maintenance_rng_stream, first_interleaved_repair.maintenance_rng_stream)
        self.assertEqual(interleaved.rng.getstate(), interleaved_failure_rng_state)
        self.assertEqual(repair_control.rng.getstate(), control_failure_rng_state)

        interleaved_next_failure = interleaved._sample_lru_failure_minutes(interleaved.components[0])
        control_next_failure = repair_control._sample_lru_failure_minutes(repair_control.components[0])

        self.assertEqual(interleaved_next_failure, control_next_failure)
        decision = next(
            event
            for event in interleaved.event_log
            if event["event"] == "maintenance_method_selected"
            and event["details"]["job_id"] == first_interleaved_repair.job_id
        )
        self.assertEqual(decision["details"]["maintenance_occurrence"], 1)
        self.assertEqual(decision["details"]["rng_stream"], first_interleaved_repair.maintenance_rng_stream)

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

    def test_overlapping_preflight_windows_preserve_earlier_mission_ready_aircraft(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 600
        inputs["aircraft"].update({"fleet_count": 4, "initial_ready": 4})
        inputs["support_network"]["nodes"][0].update({
            "personnel_capacity": 4,
            "equipment_capacity": 4,
        })
        model = AircraftSupportV1Model(inputs)
        early = MissionState(
            mission_id="wave-0600",
            name="06:00 wave",
            planned_start=360,
            preparation_start=180,
            duration_minutes=30,
            required_aircraft=2,
            min_required_aircraft=2,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        late = MissionState(
            mission_id="wave-0845",
            name="08:45 wave",
            planned_start=525,
            preparation_start=345,
            duration_minutes=30,
            required_aircraft=2,
            min_required_aircraft=2,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        model.missions = [early, late]

        early_preflight_counts = []
        while model.minute < 359:
            model.step()
            if 323 <= model.minute <= 359:
                early_preflight_counts.append(sum(
                    1 for job in model.jobs
                    if job.kind == "preflight" and job.mission_id == early.mission_id
                ))

        early_tails = {
            aircraft.tail_number for aircraft in model.aircraft
            if aircraft.current_mission_id == early.mission_id
        }
        late_tails = {
            aircraft.tail_number for aircraft in model.aircraft
            if aircraft.current_mission_id == late.mission_id
        }
        self.assertEqual(len(early_tails), 2)
        self.assertEqual(len(late_tails), 2)
        self.assertTrue(early_tails.isdisjoint(late_tails))
        self.assertTrue(all(
            aircraft.state == "mission_ready"
            for aircraft in model.aircraft
            if aircraft.tail_number in early_tails
        ))
        self.assertEqual(set(early_preflight_counts), {2})
        self.assertEqual(model.snapshot()["available_aircraft"], 2)
        self.assertEqual(model.snapshot()["mission_ready_aircraft"], 2)
        self.assertEqual(model.snapshot()["unassigned_available_aircraft"], 0)

        model.step()

        self.assertEqual(model.minute, 360)
        self.assertEqual(early.status, "launched")
        self.assertEqual(set(early.assigned_tail_numbers), early_tails)
        self.assertFalse(any(
            event["event"] == "mission_cancelled"
            and early.mission_id in event["message"]
            for event in model.event_log
        ))

    def test_later_mission_records_conflict_without_preempting_earlier_reservations(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 600
        model = AircraftSupportV1Model(inputs)
        early = MissionState(
            mission_id="wave-0600",
            name="06:00 wave",
            planned_start=360,
            preparation_start=180,
            duration_minutes=200,
            required_aircraft=2,
            min_required_aircraft=2,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        late = MissionState(
            mission_id="wave-0845",
            name="08:45 wave",
            planned_start=525,
            preparation_start=345,
            duration_minutes=30,
            required_aircraft=2,
            min_required_aircraft=2,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        model.missions = [early, late]

        while model.minute < 359:
            model.step()

        conflicts = [
            event for event in model.event_log
            if event["event"] == "preflight_resource_conflict"
            and event.get("details", {}).get("mission_id") == late.mission_id
        ]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["details"]["shortfall"], 2)
        self.assertEqual(conflicts[0]["details"]["policy"], "no_preemption_earlier_mission")
        self.assertEqual(
            {item["mission_id"] for item in conflicts[0]["details"]["blocking_reservations"]},
            {early.mission_id},
        )
        self.assertFalse(any(
            job.mission_id == late.mission_id
            for job in model.jobs
        ))
        self.assertEqual(
            {aircraft.current_mission_id for aircraft in model.aircraft},
            {early.mission_id},
        )
        frame_conflict = next(
            event for event in model.visualization_frame(
                run_id="conflict-test",
                step=model.steps,
            )["events"]
            if event["event_type"] == "preflight_resource_conflict"
        )
        self.assertEqual(frame_conflict["details"]["mission_id"], late.mission_id)
        self.assertEqual(frame_conflict["details"]["shortfall"], 2)

    def test_mission_cancellation_releases_preflight_jobs_resources_and_aircraft(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"].update({"fleet_count": 1, "initial_ready": 1})
        model = AircraftSupportV1Model(inputs)
        mission = MissionState(
            mission_id="under-resourced-wave",
            name="under-resourced wave",
            planned_start=5,
            preparation_start=0,
            duration_minutes=30,
            required_aircraft=2,
            min_required_aircraft=2,
            priority=1,
            cancel_minutes=1,
            required_aircraft_type="J-15",
        )
        model.missions = [mission]

        while model.minute < 6:
            model.step()

        preflight_job = next(job for job in model.jobs if job.kind == "preflight")
        aircraft = model.aircraft[0]
        node = model.nodes["deck"]
        frame = model.visualization_frame(run_id="cancel-test", step=model.steps)

        self.assertEqual(mission.status, "cancelled")
        self.assertEqual(preflight_job.state, "cancelled")
        self.assertEqual(aircraft.state, "available")
        self.assertIsNone(aircraft.current_mission_id)
        self.assertEqual(node["personnel_in_use"], 0)
        self.assertEqual(node["equipment_in_use"], 0)
        self.assertEqual(frame["jobs"], [])
        self.assertEqual(model.delayed_sorties, 2)
        released = next(
            event for event in model.event_log
            if event["event"] == "mission_preflight_released"
        )
        self.assertEqual(released["details"]["cancelled_job_ids"], [preflight_job.job_id])
        self.assertEqual(released["details"]["released_tail_numbers"], [aircraft.tail_number])
        self.assertFalse(any(
            event["event"] == "preflight_resource_conflict"
            for event in model.event_log
        ))

    def test_calendar_due_during_preflight_defers_preventive_until_mission_return(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 1520
        inputs["aircraft"].update({"fleet_count": 1, "initial_ready": 1})
        model = AircraftSupportV1Model(inputs)
        mission = MissionState(
            mission_id="threshold-wave",
            name="threshold wave",
            planned_start=1450,
            preparation_start=1430,
            duration_minutes=30,
            required_aircraft=1,
            min_required_aircraft=1,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        model.missions = [mission]

        while model.minute < 1450:
            model.step()

        preflight = next(job for job in model.jobs if job.kind == "preflight")
        aircraft = model.aircraft[0]
        self.assertEqual(preflight.state, "completed")
        self.assertEqual(aircraft.state, "flying")
        self.assertTrue(aircraft.preventive_due)
        self.assertEqual(aircraft.preventive_due_dimensions, ["calendar_days"])
        self.assertEqual(aircraft.current_mission_id, mission.mission_id)
        self.assertNotIn(mission.mission_id, aircraft.prepared_mission_ids)
        self.assertEqual(mission.status, "launched")
        self.assertEqual(model.snapshot()["available_aircraft"], 0)
        self.assertEqual(
            [job for job in model.jobs if job.kind == "preventive"],
            [],
        )

        while model.minute < 1480:
            model.step()

        self.assertEqual(aircraft.state, "post_support")
        self.assertEqual(
            [job for job in model.jobs if job.kind == "preventive"],
            [],
        )

        while model.minute < 1485:
            model.step()

        preventive = next(job for job in model.jobs if job.kind == "preventive")
        self.assertEqual(aircraft.state, "maintenance")
        self.assertTrue(aircraft.preventive_due)
        self.assertEqual(preventive.due_dimensions, ["calendar_days"])
        created = next(
            event for event in model.event_log
            if event["event"] == "preventive_created"
        )
        self.assertEqual(created["time"], 1485)
        self.assertFalse(any(
            event["event"] == "mission_preflight_released"
            for event in model.event_log
        ))

    def test_available_aircraft_due_on_calendar_day_is_unavailable_at_midnight(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 1500
        inputs["aircraft"].update({"fleet_count": 1, "initial_ready": 1})
        model = AircraftSupportV1Model(inputs)
        mission = MissionState(
            mission_id="midnight-wave",
            name="midnight wave",
            planned_start=1460,
            preparation_start=1440,
            duration_minutes=30,
            required_aircraft=1,
            min_required_aircraft=1,
            priority=1,
            cancel_minutes=20,
            required_aircraft_type="J-15",
        )
        model.missions = [mission]

        while model.minute < 1440:
            model.step()

        aircraft = model.aircraft[0]
        preventive = next(job for job in model.jobs if job.kind == "preventive")
        self.assertEqual(aircraft.state, "maintenance")
        self.assertTrue(aircraft.preventive_due)
        self.assertEqual(preventive.due_dimensions, ["calendar_days"])
        created = next(
            event for event in model.event_log
            if event["event"] == "preventive_created"
        )
        self.assertEqual(created["time"], 1440)
        self.assertEqual(
            [job for job in model.jobs if job.kind == "preflight"],
            [],
        )
        self.assertEqual(model.snapshot()["available_aircraft"], 0)

    def test_flight_hour_and_landing_due_start_preventive_after_return_and_postflight(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 90
        inputs["aircraft"].update({"fleet_count": 1, "initial_ready": 1})
        inputs["support_activities"]["activities"][3].update({
            "calendarDayInterval": 0,
            "runHourInterval": 0.5,
            "takeoffLandingInterval": 1,
        })
        model = AircraftSupportV1Model(inputs)
        mission = MissionState(
            mission_id="usage-threshold-wave",
            name="usage threshold wave",
            planned_start=20,
            preparation_start=0,
            duration_minutes=30,
            required_aircraft=1,
            min_required_aircraft=1,
            priority=1,
            cancel_minutes=10,
            required_aircraft_type="J-15",
        )
        model.missions = [mission]

        while model.minute < 49:
            model.step()

        aircraft = model.aircraft[0]
        self.assertEqual(aircraft.state, "flying")
        self.assertFalse(aircraft.preventive_due)
        self.assertEqual(
            [job for job in model.jobs if job.kind == "preventive"],
            [],
        )

        postflight_completion = int(mission.return_time or 0) + 5
        while model.minute < postflight_completion:
            model.step()

        preventive = next(job for job in model.jobs if job.kind == "preventive")
        self.assertEqual(aircraft.state, "maintenance")
        self.assertEqual(
            preventive.due_dimensions,
            ["flight_hours", "takeoff_landing_cycles"],
        )
        created = next(
            event for event in model.event_log
            if event["event"] == "preventive_created"
        )
        self.assertEqual(created["time"], postflight_completion)

    def test_independent_flight_hour_preventive_cycles_reset_only_their_own_counter(self) -> None:
        inputs = _minimal_inputs()
        inputs["aircraft"].update({
            "fleet_count": 1,
            "initial_ready": 1,
            "assets": [{
                "tail_number": "J15-101",
                "aircraft_type": "J-15",
                "model": "J-15",
                "initial_state": "available",
                "initial_life_state": {
                    "calendar_days": 0,
                    "flight_hours": 0.0,
                    "takeoff_landing_cycles": 0,
                },
                "preventive_cycles": [
                    {
                        "activity_id": "preventive",
                        "thresholds": {
                            "calendar_days": 0,
                            "flight_hours": 25.0,
                            "takeoff_landing_cycles": 0,
                        },
                        "initial_life_state": {
                            "calendar_days": 0,
                            "flight_hours": 0.0,
                            "takeoff_landing_cycles": 0,
                        },
                    },
                    {
                        "activity_id": "preventive-50h",
                        "thresholds": {
                            "calendar_days": 0,
                            "flight_hours": 50.0,
                            "takeoff_landing_cycles": 0,
                        },
                        "initial_life_state": {
                            "calendar_days": 0,
                            "flight_hours": 0.0,
                            "takeoff_landing_cycles": 0,
                        },
                    },
                ],
            }],
        })
        inputs["support_activities"]["activities"][3].update({
            "calendarDayInterval": 0,
            "runHourInterval": 25,
            "jobs": [{"activityCode": "pm-25", "durationMinutes": 1, "workName": "pm-25"}],
        })
        inputs["support_activities"]["activities"].append({
            "id": "preventive-50h",
            "name": "preventive-50h",
            "activity_type": "preventive",
            "resource_id": "deck",
            "runHourInterval": 50,
            "jobs": [{"activityCode": "pm-50", "durationMinutes": 1, "workName": "pm-50"}],
        })
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]

        model._record_preventive_usage(aircraft, flight_hours=25)
        model._generate_preventive_jobs()
        first = next(job for job in model.jobs if job.kind == "preventive")
        self.assertEqual(first.activity_id, "preventive")
        first.state = "completed"
        model._complete_job_effect(first)
        self.assertEqual(aircraft.preventive_cycles["preventive"]["life_state"]["flight_hours"], 0.0)
        self.assertEqual(aircraft.preventive_cycles["preventive-50h"]["life_state"]["flight_hours"], 25.0)

        model._record_preventive_usage(aircraft, flight_hours=25)
        model._generate_preventive_jobs()
        second = next(job for job in model.jobs if job.kind == "preventive" and job is not first)
        self.assertEqual(second.activity_id, "preventive")
        second.state = "completed"
        model._complete_job_effect(second)
        model._generate_preventive_jobs()
        third = next(job for job in model.jobs if job.kind == "preventive" and job is not first and job is not second)
        self.assertEqual(third.activity_id, "preventive-50h")

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
        self.assertIn("support_network.organization_graph.lateral_edges[]", scope["behavior_driving_fields"])
        self.assertIn("combatUnit.members[].preLifeCalendarDays", scope["behavior_driving_fields"])
        self.assertIn("combatUnit.members[].preLifeFlightHours", scope["behavior_driving_fields"])
        self.assertIn("combatUnit.members[].preLifeTakeoffLandingCount", scope["behavior_driving_fields"])
        self.assertNotIn("experiment.steps", scope["behavior_driving_fields"])
        self.assertIn("combatUnit.members[].preLifeCalendarDays", scope["fail_closed_fields"])
        self.assertIn("combatUnit.members[].preLifeFlightHours", scope["fail_closed_fields"])
        self.assertIn("combatUnit.members[].preLifeTakeoffLandingCount", scope["fail_closed_fields"])
        self.assertIn("supportActivities[].runHourInterval", scope["fail_closed_fields"])
        self.assertIn("support_network.organization_graph.lateral_edges[]", scope["fail_closed_fields"])
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
