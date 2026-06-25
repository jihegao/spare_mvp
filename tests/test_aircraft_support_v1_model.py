from __future__ import annotations

import unittest

from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model


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
            "basic_mission": {
                "missionId": "mission-a",
                "name": "mission",
                "startHour": 0,
                "preparationMinutes": 20,
                "taskDurationMinutes": 30,
                "equipmentQuantity": 2,
                "cancelMinutes": 10,
            },
            "composite_tasks": [],
        },
    }


class AircraftSupportV1ModelTest(unittest.TestCase):
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

        self.assertEqual(aircraft.state, "maintenance")
        self.assertTrue(aircraft.postflight_required)
        self.assertEqual(model.completed_sorties, 0)
        self.assertEqual(model.snapshot()["postflight_backlog"], 1)
        self.assertTrue(any(job.kind == "postflight" and job.tail_number == aircraft.tail_number for job in model.jobs))

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

    def test_in_flight_failure_counts_failed_sortie_and_requires_repair_after_return(self) -> None:
        inputs = _minimal_inputs()
        inputs["equipment_tree"]["components"] = [
            {"id": "engine", "parent_id": "aircraft", "name": "Engine", "failure_rate": 1000, "spare_type": "engine"}
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
        self.assertIn("supportNodes[].transportPolicies", scope["behavior_driving_fields"])
        self.assertIn("missionProfile.periodicTasks", scope["behavior_driving_fields"])
        self.assertIn("reliabilityBlockDiagram", scope["behavior_driving_fields"])
        self.assertNotIn("experiment.steps", scope["behavior_driving_fields"])
        self.assertEqual(scope["fail_closed_fields"], [])
        self.assertEqual(scope["m9_7_4_coverage_hardening_fields"], [])

    def test_failure_distribution_types_drive_effective_rates(self) -> None:
        inputs = _minimal_inputs()
        inputs["equipment_tree"]["components"] = [
            {
                "id": "weibull",
                "parent_id": "aircraft",
                "failure_rate": 0,
                "failure_distribution": {"distributionType": "威布尔分布", "parameters": "beta=2, eta=100"},
            },
            {
                "id": "normal",
                "parent_id": "aircraft",
                "failure_rate": 0,
                "failure_distribution": {"distributionType": "正态分布", "parameters": "mean=50, sigma=5"},
            },
        ]

        model = AircraftSupportV1Model(inputs)

        rates = {component["id"]: component["failure_rate"] for component in model.components}
        self.assertGreater(rates["weibull"], 0)
        self.assertAlmostEqual(rates["normal"], 0.02)

    def test_rbd_edges_parent_topology_and_weights_drive_rates(self) -> None:
        inputs = _minimal_inputs()
        inputs["reliability_block_diagram"] = {
            "nodes": [
                {"id": "root", "failureRate": 0.1, "parentId": None, "connectionType": "串联"},
                {"id": "parallel", "failureRate": 0.1, "parentId": "root", "connectionType": "串联"},
                {"id": "series", "failureRate": 0.1, "parentId": "root", "connectionType": "串联"},
            ],
            "edges": [
                {"from": "root", "to": "parallel", "type": "并联", "weight": 0.5},
                {"from": "root", "to": "series", "type": "串联", "weight": 1.0},
            ],
        }

        model = AircraftSupportV1Model(inputs)

        rates = {component["id"]: component["failure_rate"] for component in model.components}
        self.assertLess(rates["rbd:parallel"], rates["rbd:series"])

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


if __name__ == "__main__":
    unittest.main()
