"""Visual Mesa model for complete aircraft mission execution from import data."""

from __future__ import annotations

from dataclasses import dataclass, field
import random
from typing import Any

from mesa import Agent, Model


def parse_hhmm(value: str) -> int:
    hours, minutes = value.split(":", 1)
    return int(hours) * 60 + int(minutes)


def minutes_label(minutes: int) -> str:
    day = minutes // 1440
    minute_of_day = minutes % 1440
    return f"D{day + 1} {minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


@dataclass
class MissionWave:
    wave_id: int
    name: str
    aircraft_type: str
    required_aircraft: int
    dispatch_time: int
    launch_time: int
    duration_minutes: int
    preparation_minutes: int
    cancel_minutes: int
    recovery_minutes: int
    threat_level: str
    status: str = "scheduled"
    assigned: list[str] = field(default_factory=list)
    actual_launch_time: int | None = None
    return_time: int | None = None
    completed_time: int | None = None


class AircraftAgent(Agent):
    """Aircraft agent with task, support, and equipment-derived state."""

    def __init__(self, model: "VisualMissionModel", member: dict[str, Any], index: int) -> None:
        super().__init__(model)
        self.tail_number = str(member.get("aircraftNo", f"AC-{index + 1}"))
        self.aircraft_type = str(member.get("model", "J-15"))
        self.role = str(member.get("role", ""))
        self.location = str(member.get("deploymentLocation", "航母飞行甲板"))
        self.remaining_life_hours = float(member.get("remainingLifeHours", 0))
        self.pre_life_requirement_hours = float(member.get("preLifeRequirementHours", 0))
        self.takeoff_landing_count = int(member.get("takeoffLandingCount", 0))
        self.phase = "idle"
        self.phase_label = "甲板待命"
        self.current_wave_id: int | None = None
        self.phase_until: int | None = None
        self.current_activity = ""
        self.failed_component = ""
        self.flight_hours = 0.0
        self.completed_sorties = 0
        self.timeline: list[dict[str, Any]] = []

    @property
    def is_available(self) -> bool:
        return self.phase in {"idle", "ready"} and not self.failed_component

    def set_phase(
        self,
        phase: str,
        label: str,
        now: int,
        *,
        until: int | None = None,
        wave_id: int | None = None,
        activity: str = "",
    ) -> None:
        if self.phase == phase and self.current_wave_id == wave_id and self.phase_until == until:
            return
        self.phase = phase
        self.phase_label = label
        self.phase_until = until
        self.current_wave_id = wave_id
        self.current_activity = activity
        self.timeline.append(
            {
                "time": now,
                "label": minutes_label(now),
                "phase": phase,
                "phaseLabel": label,
                "waveId": wave_id,
                "activity": activity,
            }
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "tailNumber": self.tail_number,
            "type": self.aircraft_type,
            "role": self.role,
            "location": self.location,
            "phase": self.phase,
            "phaseLabel": self.phase_label,
            "currentWaveId": self.current_wave_id,
            "activity": self.current_activity,
            "remainingLifeHours": round(self.remaining_life_hours, 2),
            "takeoffLandingCount": self.takeoff_landing_count,
            "flightHours": round(self.flight_hours, 2),
            "completedSorties": self.completed_sorties,
            "failedComponent": self.failed_component,
            "until": minutes_label(self.phase_until) if self.phase_until is not None else "",
        }


class VisualMissionModel(Model):
    """A Mesa model driven by the imported project package.

    It focuses on visual inspection of the complete aircraft task lifecycle:
    standby, preflight, launch, sortie, return, recovery inspection, optional
    corrective maintenance, and ready state.
    """

    def __init__(
        self,
        import_package: dict[str, Any],
        seed: int = 20260621,
        tick_minutes: int = 15,
    ) -> None:
        super().__init__(rng=seed)
        self.import_package = import_package
        self.random = random.Random(seed)
        self.tick_minutes = tick_minutes
        self.sim_time = 0
        self.event_log: list[dict[str, Any]] = []

        objects = import_package["objects"]
        self.objects = objects
        self.mission_profile = objects["missionProfiles"][0]
        self.activities = {item["id"]: item for item in objects.get("supportActivities", [])}
        self.resources = {item["id"]: item for item in objects.get("supportResources", [])}
        self.equipment_assets = objects.get("equipmentAssets", [])
        self.phase_names = {
            item.get("state"): item.get("name", item.get("state"))
            for item in self.mission_profile.get("missionPhases", [])
        }
        self.recovery_minutes = int(
            60
            * float(
                next(
                    (
                        item.get("limitHours", 1)
                        for item in self.mission_profile.get("missionPhases", [])
                        if item.get("state") == "ready"
                    ),
                    1,
                )
            )
        )

        self.aircraft: list[AircraftAgent] = [
            AircraftAgent(self, member, index)
            for index, member in enumerate(self.mission_profile.get("combatUnit", {}).get("members", []))
        ]
        for aircraft in self.aircraft:
            aircraft.set_phase("idle", self.phase_names.get("idle", "甲板待命"), 0)

        self.waves = self._build_waves()
        self.initial_inventory = {
            node_id: dict(resource.get("inventory", {})) for node_id, resource in self.resources.items()
        }
        self.inventory = {
            node_id: dict(resource.get("inventory", {})) for node_id, resource in self.resources.items()
        }
        self.resource_busy: dict[str, int] = {node_id: 0 for node_id in self.resources}
        self.completed_sorties = 0
        self.cancelled_sorties = 0
        self.delayed_launches = 0
        self.maintenance_count = 0
        self._log("model_started", "导入包已加载，飞机进入甲板待命。")

    def step(self) -> None:
        self._start_preflight()
        self._finish_preflight()
        self._launch_ready_waves()
        self._return_due_aircraft()
        self._finish_recovery_or_maintenance()
        self.sim_time += self.tick_minutes

    def snapshot(self) -> dict[str, Any]:
        total_required = sum(w.required_aircraft for w in self.waves)
        launched = sum(len(w.assigned) for w in self.waves if w.status in {"flying", "recovery", "completed"})
        ready = sum(1 for aircraft in self.aircraft if aircraft.phase in {"idle", "ready"})
        return {
            "time": self.sim_time,
            "timeLabel": minutes_label(self.sim_time),
            "readyAircraft": ready,
            "flyingAircraft": sum(1 for aircraft in self.aircraft if aircraft.phase == "flying"),
            "supportAircraft": sum(1 for aircraft in self.aircraft if aircraft.phase in {"preparing", "recovery", "maintenance"}),
            "completedSorties": self.completed_sorties,
            "totalRequiredSorties": total_required,
            "launchRate": launched / max(total_required, 1),
            "completionRate": self.completed_sorties / max(total_required, 1),
            "cancelledSorties": self.cancelled_sorties,
            "delayedLaunches": self.delayed_launches,
            "maintenanceCount": self.maintenance_count,
            "inventoryTotal": sum(sum(v for v in stock.values() if isinstance(v, (int, float))) for stock in self.inventory.values()),
        }

    def visualization_state(self) -> dict[str, Any]:
        return {
            "snapshot": self.snapshot(),
            "aircraft": [aircraft.snapshot() for aircraft in self.aircraft],
            "waves": [
                {
                    "waveId": wave.wave_id,
                    "name": wave.name,
                    "aircraftType": wave.aircraft_type,
                    "requiredAircraft": wave.required_aircraft,
                    "dispatchTime": minutes_label(wave.dispatch_time),
                    "launchTime": minutes_label(wave.launch_time),
                    "returnTime": minutes_label(wave.return_time) if wave.return_time is not None else "",
                    "completedTime": minutes_label(wave.completed_time) if wave.completed_time is not None else "",
                    "status": wave.status,
                    "assigned": list(wave.assigned),
                }
                for wave in self.waves
            ],
            "resources": [
                {
                    "nodeId": node_id,
                    "name": resource.get("name", node_id),
                    "capacity": resource.get("capacity"),
                    "personnelCapacity": resource.get("personnelCapacity"),
                    "inventory": dict(self.inventory[node_id]),
                    "busyMinutes": self.resource_busy[node_id],
                }
                for node_id, resource in self.resources.items()
            ],
            "events": self.event_log[-24:],
        }

    def final_report(self) -> dict[str, Any]:
        return {
            "metrics": self.snapshot(),
            "aircraftTimelines": {aircraft.tail_number: aircraft.timeline for aircraft in self.aircraft},
            "waves": [
                {
                    "waveId": wave.wave_id,
                    "name": wave.name,
                    "status": wave.status,
                    "assigned": wave.assigned,
                    "actualLaunchTime": minutes_label(wave.actual_launch_time) if wave.actual_launch_time else "",
                    "completedTime": minutes_label(wave.completed_time) if wave.completed_time else "",
                }
                for wave in self.waves
            ],
            "events": self.event_log,
            "inventoryStart": self.initial_inventory,
            "inventoryEnd": self.inventory,
        }

    def _build_waves(self) -> list[MissionWave]:
        basic = self.mission_profile.get("basicMission", {})
        cancel_minutes = int(basic.get("cancelMinutes", 20))
        default_duration = int(basic.get("taskDurationMinutes", 180))
        areas = self.mission_profile.get("missionAreas", [])
        threat_level = str(areas[0].get("threatLevel", "中")) if areas else "中"
        periodic = self.mission_profile.get("periodicTasks", [{}])[0]
        weekday_assignments = periodic.get("weekdayAssignments", {})
        composite_by_id = {item["id"]: item for item in self.mission_profile.get("compositeTasks", [])}
        monday_composite_id = weekday_assignments.get("monday") or next(iter(composite_by_id))
        composite = composite_by_id[monday_composite_id]

        waves: list[MissionWave] = []
        wave_id = 0
        for task in composite.get("taskItems", []):
            repeat_count = int(task.get("dailyRepeatCount", 1))
            interval = int(float(task.get("intervalHours", 6)) * 60)
            launch_base = parse_hhmm(str(task.get("firstWaveTime", "08:00")))
            dispatch_base = parse_hhmm(str(task.get("taskDispatchTime", "07:00")))
            for repeat_index in range(repeat_count):
                wave_id += 1
                launch_time = launch_base + repeat_index * interval
                dispatch_time = dispatch_base + repeat_index * interval
                waves.append(
                    MissionWave(
                        wave_id=wave_id,
                        name=str(task.get("basicTaskName", task.get("id", f"wave-{wave_id}"))),
                        aircraft_type=str(task.get("equipmentType", "J-15")),
                        required_aircraft=int(task.get("minRequiredSystems", task.get("equipmentQuantity", 1))),
                        dispatch_time=dispatch_time,
                        launch_time=launch_time,
                        duration_minutes=int(task.get("taskDurationMinutes", default_duration)),
                        preparation_minutes=int(task.get("preparationMinutes", basic.get("preparationMinutes", 50))),
                        cancel_minutes=cancel_minutes,
                        recovery_minutes=self.recovery_minutes,
                        threat_level=threat_level,
                    )
                )

        night = composite_by_id.get("composite-night-alert")
        if night:
            for task in night.get("taskItems", []):
                wave_id += 1
                waves.append(
                    MissionWave(
                        wave_id=wave_id,
                        name=str(task.get("basicTaskName", task.get("id", f"wave-{wave_id}"))),
                        aircraft_type=str(task.get("equipmentType", "J-35")),
                        required_aircraft=int(task.get("minRequiredSystems", task.get("equipmentQuantity", 1))),
                        dispatch_time=parse_hhmm(str(task.get("taskDispatchTime", "19:00"))),
                        launch_time=parse_hhmm(str(task.get("firstWaveTime", "20:15"))),
                        duration_minutes=int(task.get("taskDurationMinutes", default_duration)),
                        preparation_minutes=int(task.get("preparationMinutes", basic.get("preparationMinutes", 50))),
                        cancel_minutes=cancel_minutes,
                        recovery_minutes=self.recovery_minutes,
                        threat_level="高",
                    )
                )
        return sorted(waves, key=lambda item: item.launch_time)

    def _start_preflight(self) -> None:
        preflight = self.activities.get("preflight", {})
        for wave in self.waves:
            if wave.status != "scheduled" or self.sim_time < wave.dispatch_time:
                continue
            candidates = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.aircraft_type == wave.aircraft_type and aircraft.is_available
            ]
            if len(candidates) < wave.required_aircraft:
                continue
            assigned = sorted(candidates, key=lambda item: item.tail_number)[: wave.required_aircraft]
            wave.assigned = [aircraft.tail_number for aircraft in assigned]
            wave.status = "preparing"
            finish_time = self.sim_time + wave.preparation_minutes
            for aircraft in assigned:
                aircraft.set_phase(
                    "preparing",
                    self.phase_names.get("preparing", "飞行前准备"),
                    self.sim_time,
                    until=finish_time,
                    wave_id=wave.wave_id,
                    activity=preflight.get("activityName", "飞行前保障"),
                )
            self._charge_resource(preflight.get("resourceId", "carrier-deck"), wave.preparation_minutes)
            self._log("preflight_started", f"{wave.name} 波次 {wave.wave_id} 开始飞行前准备: {', '.join(wave.assigned)}")

    def _finish_preflight(self) -> None:
        for wave in self.waves:
            if wave.status != "preparing":
                continue
            assigned = [self._aircraft_by_tail(tail) for tail in wave.assigned]
            if all(aircraft and aircraft.phase_until is not None and self.sim_time >= aircraft.phase_until for aircraft in assigned):
                wave.status = "ready"
                for aircraft in assigned:
                    if aircraft:
                        aircraft.set_phase("ready", "任务就绪", self.sim_time, wave_id=wave.wave_id)
                self._log("preflight_completed", f"波次 {wave.wave_id} 飞行前准备完成。")

    def _launch_ready_waves(self) -> None:
        for wave in self.waves:
            if wave.status not in {"ready", "preparing"} or self.sim_time < wave.launch_time:
                continue
            assigned = [self._aircraft_by_tail(tail) for tail in wave.assigned]
            if wave.status == "preparing" or any(not aircraft or aircraft.phase != "ready" for aircraft in assigned):
                if self.sim_time <= wave.launch_time + wave.cancel_minutes:
                    wave.status = "ready" if wave.status == "preparing" else wave.status
                    self.delayed_launches += 1
                    continue
                wave.status = "cancelled"
                self.cancelled_sorties += wave.required_aircraft
                self._log("wave_cancelled", f"波次 {wave.wave_id} 因准备不足取消。")
                continue
            wave.status = "flying"
            wave.actual_launch_time = self.sim_time
            wave.return_time = self.sim_time + wave.duration_minutes
            for aircraft in assigned:
                if aircraft:
                    aircraft.set_phase(
                        "flying",
                        self.phase_names.get("sortie", "出动执行"),
                        self.sim_time,
                        until=wave.return_time,
                        wave_id=wave.wave_id,
                        activity=wave.name,
                    )
            self._log("wave_launched", f"波次 {wave.wave_id} 起飞执行 {wave.name}: {', '.join(wave.assigned)}")

    def _return_due_aircraft(self) -> None:
        for wave in self.waves:
            if wave.status != "flying" or wave.return_time is None or self.sim_time < wave.return_time:
                continue
            wave.status = "recovery"
            recovery_end = self.sim_time + wave.recovery_minutes
            for tail in wave.assigned:
                aircraft = self._aircraft_by_tail(tail)
                if not aircraft:
                    continue
                aircraft.flight_hours += wave.duration_minutes / 60
                aircraft.remaining_life_hours -= wave.duration_minutes / 60
                aircraft.takeoff_landing_count += 1
                aircraft.completed_sorties += 1
                aircraft.set_phase(
                    "recovery",
                    self.phase_names.get("ready", "回收检查"),
                    self.sim_time,
                    until=recovery_end,
                    wave_id=wave.wave_id,
                    activity="回收检查",
                )
            self._charge_resource("carrier-deck", wave.recovery_minutes)
            self._log("wave_returned", f"波次 {wave.wave_id} 返航，进入回收检查。")

    def _finish_recovery_or_maintenance(self) -> None:
        corrective = self.activities.get("corrective", {})
        for aircraft in self.aircraft:
            if aircraft.phase_until is None or self.sim_time < aircraft.phase_until:
                continue
            if aircraft.phase == "recovery":
                wave = self._wave_by_id(aircraft.current_wave_id)
                failed_component = self._sample_failure(wave)
                if failed_component:
                    duration = int(float(corrective.get("durationHours", 3)) * 60)
                    aircraft.failed_component = failed_component
                    aircraft.set_phase(
                        "maintenance",
                        "修复性维修",
                        self.sim_time,
                        until=self.sim_time + duration,
                        wave_id=aircraft.current_wave_id,
                        activity=corrective.get("activityName", "修复性维修"),
                    )
                    self.maintenance_count += 1
                    self._consume_spare(corrective.get("resourceId", "carrier-deck"), corrective.get("spareType"), corrective.get("spareQuantity", 0))
                    self._charge_resource(corrective.get("resourceId", "carrier-deck"), duration)
                    self._log("maintenance_started", f"{aircraft.tail_number} {failed_component} 故障，进入修复性维修。")
                    continue
                self._complete_aircraft_wave(aircraft)
            elif aircraft.phase == "maintenance":
                aircraft.failed_component = ""
                self._complete_aircraft_wave(aircraft)

    def _complete_aircraft_wave(self, aircraft: AircraftAgent) -> None:
        wave = self._wave_by_id(aircraft.current_wave_id)
        aircraft.set_phase("ready", "任务后就绪", self.sim_time)
        if not wave:
            return
        assigned = [self._aircraft_by_tail(tail) for tail in wave.assigned]
        if all(item and item.phase in {"ready", "idle"} for item in assigned):
            wave.status = "completed"
            wave.completed_time = self.sim_time
            self.completed_sorties += len(wave.assigned)
            self._log("wave_completed", f"波次 {wave.wave_id} 完成回收保障闭环。")

    def _sample_failure(self, wave: MissionWave | None) -> str:
        multiplier = 1.3 if wave and wave.threat_level == "高" else 1.0
        candidates = [item for item in self.equipment_assets if item.get("parentId") and item.get("failureRate")]
        if not candidates:
            return ""
        # Keep visual runs mostly mission-focused; failures still come from input failureRate.
        for item in candidates:
            probability = min(0.18, float(item.get("failureRate", 0)) * multiplier * 0.15)
            if self.random.random() < probability:
                return str(item.get("name") or item.get("id"))
        return ""

    def _consume_spare(self, node_id: str, spare_type: Any, quantity: Any) -> None:
        if not spare_type or not quantity:
            return
        stock = self.inventory.get(str(node_id), {})
        stock[str(spare_type)] = max(0, float(stock.get(str(spare_type), 0)) - float(quantity))

    def _charge_resource(self, node_id: Any, minutes: int) -> None:
        key = str(node_id)
        if key in self.resource_busy:
            self.resource_busy[key] += minutes

    def _aircraft_by_tail(self, tail: str) -> AircraftAgent | None:
        return next((aircraft for aircraft in self.aircraft if aircraft.tail_number == tail), None)

    def _wave_by_id(self, wave_id: int | None) -> MissionWave | None:
        return next((wave for wave in self.waves if wave.wave_id == wave_id), None)

    def _log(self, event: str, message: str) -> None:
        self.event_log.append(
            {
                "time": self.sim_time,
                "timeLabel": minutes_label(self.sim_time),
                "event": event,
                "message": message,
            }
        )
