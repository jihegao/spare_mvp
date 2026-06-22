"""Mission scheduler: composite tasks, periodic weekday assignments, wave generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_WEEKDAY_KEYS = [
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday",
]


@dataclass
class MissionWave:
    wave_id: int
    planned_start: float
    duration_minutes: float
    required_aircraft: int
    aircraft_type: str
    preparation_minutes: float
    recovery_time: float
    priority: int
    mission_area_id: str | None = None
    threat_level: str = "中"
    status: str = "scheduled"
    actual_start: float | None = None
    return_time: float | None = None
    assigned_tail_numbers: list[str] = None


class MissionScheduler:
    """Schedules composite and periodic tasks based on weekday assignments."""

    def __init__(self, mission_profile: dict[str, Any]) -> None:
        self.mission_profile = mission_profile
        self.composite_tasks = {
            str(ct["id"]): ct for ct in mission_profile.get("compositeTasks", [])
        }
        periodic = mission_profile.get("periodicTasks", [])
        self.periodic_task = periodic[0] if periodic else {}
        self.repeat_cycle_days = int(self.periodic_task.get("repeatCycleDays", 7))
        self.weekday_assignments = self.periodic_task.get("weekdayAssignments", {})
        basic = mission_profile.get("basicMission", {})
        self.cancel_minutes = float(basic.get("cancelMinutes", 20))
        self.min_required_sorties = int(basic.get("minRequiredSorties", 1))
        self.task_duration_minutes = float(basic.get("taskDurationMinutes", 90))
        self.preparation_minutes = float(basic.get("preparationMinutes", 50))
        self._wave_counter = 0

    def get_composite_for_day(self, day_index: int) -> dict[str, Any]:
        """Return the composite task assigned to the given day (0-based, wraps over cycle)."""
        weekday_index = day_index % self.repeat_cycle_days
        weekday_key = _WEEKDAY_KEYS[weekday_index % 7]
        composite_id = str(self.weekday_assignments.get(weekday_key, ""))
        return self.composite_tasks.get(composite_id, next(iter(self.composite_tasks.values())))

    def generate_waves_for_day(self, day_index: int, composite: dict[str, Any]) -> list[MissionWave]:
        """Generate mission waves for a day based on the composite task's taskItems."""
        day_offset_minutes = day_index * 24 * 60
        waves: list[MissionWave] = []
        for task_item in composite.get("taskItems", []):
            first_wave_time = _parse_time_to_minutes(str(task_item.get("firstWaveTime", "08:00")))
            recovery_time = _parse_time_to_minutes(str(task_item.get("recoveryTime", "11:00")))
            daily_repeat = int(task_item.get("dailyRepeatCount", 1))
            interval_hours = float(task_item.get("intervalHours", 6))
            duration = float(task_item.get("taskDurationMinutes", self.task_duration_minutes))
            prep = float(task_item.get("preparationMinutes", self.preparation_minutes))
            for repeat_idx in range(daily_repeat):
                self._wave_counter += 1
                wave_start = day_offset_minutes + first_wave_time + repeat_idx * interval_hours * 60
                waves.append(MissionWave(
                    wave_id=self._wave_counter,
                    planned_start=wave_start,
                    duration_minutes=duration,
                    required_aircraft=int(task_item.get("minRequiredSystems", task_item.get("equipmentQuantity", 1))),
                    aircraft_type=str(task_item.get("equipmentType", "J-15")),
                    preparation_minutes=prep,
                    recovery_time=day_offset_minutes + recovery_time,
                    priority=int(task_item.get("priority", 1)),
                ))
        return waves


def _parse_time_to_minutes(time_str: str) -> float:
    """Parse 'HH:MM' into minutes from midnight."""
    parts = time_str.strip().split(":")
    if len(parts) < 2:
        return 480.0
    return float(parts[0]) * 60 + float(parts[1])
