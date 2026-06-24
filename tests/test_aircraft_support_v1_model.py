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

    def test_behavior_scope_excludes_fields_that_are_only_compiled_into_payload(self) -> None:
        scope = AircraftSupportV1Model.behavior_scope()

        self.assertNotIn("components[].failureDistribution", scope["behavior_driving_fields"])
        self.assertNotIn("supportNodes[].transportPolicies", scope["behavior_driving_fields"])
        self.assertIn("components[].failureDistribution", scope["m9_7_4_coverage_hardening_fields"])
        self.assertIn("supportNodes[].transportPolicies", scope["m9_7_4_coverage_hardening_fields"])

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


if __name__ == "__main__":
    unittest.main()
