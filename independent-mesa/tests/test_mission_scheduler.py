from __future__ import annotations

import unittest

from independent_mesa.mission_scheduler import (
    MissionScheduler,
    MissionWave,
)


def _sample_mission_profile() -> dict:
    return {
        "id": "mission-profile-day-night",
        "durationHours": 24,
        "basicMission": {
            "minRequiredSorties": 5,
            "taskDurationMinutes": 180,
            "preparationMinutes": 50,
            "cancelMinutes": 20,
        },
        "compositeTasks": [
            {
                "id": "composite-day-cap",
                "name": "昼间制空复合任务",
                "taskItems": [{
                    "id": "day-cap-main",
                    "basicTaskName": "近海制空巡逻任务",
                    "equipmentType": "J-15",
                    "equipmentQuantity": 4,
                    "taskDispatchTime": "07:15",
                    "firstWaveTime": "08:00",
                    "recoveryTime": "11:00",
                    "priority": 1,
                    "minRequiredSystems": 4,
                    "dailyRepeatCount": 2,
                    "intervalHours": 6,
                    "preparationMinutes": 50,
                }],
            },
            {
                "id": "composite-night-alert",
                "name": "夜间警戒复合任务",
                "taskItems": [{
                    "id": "night-alert-main",
                    "basicTaskName": "远海警戒任务",
                    "equipmentType": "J-35",
                    "equipmentQuantity": 3,
                    "taskDispatchTime": "19:30",
                    "firstWaveTime": "20:15",
                    "recoveryTime": "23:30",
                    "priority": 2,
                    "minRequiredSystems": 3,
                    "dailyRepeatCount": 1,
                    "intervalHours": 8,
                    "preparationMinutes": 55,
                }],
            },
        ],
        "periodicTasks": [{
            "id": "periodic-carrier-day-night",
            "repeatCycleDays": 7,
            "weekdayAssignments": {
                "monday": "composite-day-cap",
                "tuesday": "composite-day-cap",
                "wednesday": "composite-night-alert",
                "thursday": "composite-day-cap",
                "friday": "composite-day-cap",
                "saturday": "composite-night-alert",
                "sunday": "composite-day-cap",
            },
        }],
    }


class TestMissionScheduler(unittest.TestCase):
    def test_weekday_monday_selects_day_cap(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)  # day 0 = Monday
        self.assertEqual(composite["id"], "composite-day-cap")

    def test_weekday_wednesday_selects_night_alert(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(2)  # day 2 = Wednesday
        self.assertEqual(composite["id"], "composite-night-alert")

    def test_weekday_wraps_after_cycle(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(7)  # day 7 = Monday again
        self.assertEqual(composite["id"], "composite-day-cap")

    def test_generate_waves_for_day_cap(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)
        waves = scheduler.generate_waves_for_day(0, composite)
        self.assertEqual(len(waves), 2)  # dailyRepeatCount=2
        self.assertIsInstance(waves[0], MissionWave)
        self.assertEqual(waves[0].required_aircraft, 4)
        self.assertEqual(waves[0].aircraft_type, "J-15")
        self.assertEqual(waves[0].duration_minutes, 180)

    def test_wave_times_parsed_from_first_wave_time(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)
        waves = scheduler.generate_waves_for_day(0, composite)
        # firstWaveTime "08:00" → 480 minutes
        self.assertEqual(waves[0].planned_start, 480.0)
        # second wave 480 + 6*60 = 840
        self.assertEqual(waves[1].planned_start, 840.0)

    def test_cancel_minutes_from_basic_mission(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        self.assertEqual(scheduler.cancel_minutes, 20)


if __name__ == "__main__":
    unittest.main()
