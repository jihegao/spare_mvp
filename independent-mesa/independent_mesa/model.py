"""IndependentMesaModel: orchestration layer consuming modeling-import-v1 data."""

from __future__ import annotations

import json
import copy
from pathlib import Path
from typing import Any

import numpy as np
from mesa import Model

from .equipment import (
    EquipmentNode,
    build_equipment_tree,
    age_and_sample_failures,
    decide_repair_or_replace,
    get_repair_duration,
    is_life_limit_exceeded,
    check_k_out_of_n,
)
from .reliability import build_reliability_diagram, evaluate_system_reliability
from .mission_scheduler import MissionScheduler, MissionWave
from .activity_planner import ActivityPlanner, ActivityJob, sample_duration
from .support_network import SupportNetwork, TransportOrder
from .agents import AircraftAgent


class IndependentMesaModel(Model):
    """Standalone Mesa model consuming a full modeling-import-v1 package."""

    def __init__(
        self,
        import_package: dict[str, Any],
        steps: int = 48,
        seed: int = 20260621,
        threat_multiplier_override: float | None = None,
    ) -> None:
        super().__init__(rng=seed)
        self.import_package = import_package
        self.steps_planned = steps
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.threat_multiplier_override = threat_multiplier_override

        objects = import_package.get("objects", {})
        mission_profile = objects.get("missionProfiles", [{}])[0]
        self.mission_profile = mission_profile
        self.duration_hours = float(mission_profile.get("durationHours", 24))
        self.tick_minutes = max(1.0, self.duration_hours * 60 / max(steps, 1))

        self.mission_scheduler = MissionScheduler(mission_profile)
        self.activity_planner = ActivityPlanner(objects.get("supportActivities", []))
        self.support_network = SupportNetwork(objects.get("supportResources", []))
        self.reliability_blocks = build_reliability_diagram(
            mission_profile.get("reliabilityBlockDiagram", {"nodes": [], "edges": []})
        )

        equipment = objects.get("equipment", {})
        self.pre_life_requirement_hours = float(equipment.get("preLifeRequirementHours", 0))
        self.min_required_sorties = int(equipment.get("minRequiredSorties", 1))

        combat_unit = mission_profile.get("combatUnit", {})
        members = combat_unit.get("members", [])
        self.aircraft_assets = objects.get("equipmentAssets", [])
        self.aircraft: list[AircraftAgent] = []
        for index, member in enumerate(members):
            tree = build_equipment_tree(copy.deepcopy(self.aircraft_assets))
            agent = AircraftAgent(
                model=self,
                tail_number=str(member.get("aircraftNo", f"AC-{index}")),
                aircraft_type=str(member.get("model", "J-15")),
                index=index,
                member_data=member,
                equipment_tree=tree,
            )
            self.aircraft.append(agent)

        self.mission_areas = {
            str(area["id"]): area for area in mission_profile.get("missionAreas", [])
        }
        self.airports = {
            str(ap["id"]): ap for ap in mission_profile.get("airports", [])
        }

        self.sim_time = 0.0
        self.steps_run = 0
        self.all_waves: list[MissionWave] = []
        self.active_waves: list[MissionWave] = []
        self.launched_sorties = 0
        self.completed_sorties = 0
        self.delayed_sorties = 0
        self.cancelled_sorties = 0
        self.lru_failures = 0
        self.repair_count = 0
        self.replace_count = 0
        self.total_departure_delay = 0.0
        self.activity_jobs: list[ActivityJob] = []
        self.completed_jobs: list[ActivityJob] = []
        self.event_log: list[dict[str, Any]] = []
        self._job_counter = 0
        self._day_index = 0
        self._waves_generated_for_days: set[int] = set()

    def step(self) -> None:
        self._generate_waves_for_current_day()
        self._return_due_aircraft()
        self._launch_due_waves()
        self._age_and_sample_failures()
        self._dispatch_support_jobs()
        self._advance_activity_jobs()
        self._check_preventive_maintenance()
        self.support_network.process_arrivals(self.sim_time)
        self.support_network.check_and_trigger_replenishment(self.sim_time)
        self.support_network.charge_busy_time(self.tick_minutes)
        self.sim_time += self.tick_minutes
        self.steps_run += 1
        for aircraft in self.aircraft:
            aircraft.days_since_last_pm += self.tick_minutes / (24 * 60)

    def _current_day_index(self) -> int:
        return int(self.sim_time / (24 * 60))

    def _generate_waves_for_current_day(self) -> None:
        day = self._current_day_index()
        if day in self._waves_generated_for_days:
            return
        composite = self.mission_scheduler.get_composite_for_day(day)
        waves = self.mission_scheduler.generate_waves_for_day(day, composite)
        self.all_waves.extend(waves)
        self._waves_generated_for_days.add(day)

    def _return_due_aircraft(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase != "flying":
                continue
            if aircraft.scheduled_return_time is None or aircraft.scheduled_return_time > self.sim_time:
                continue
            mission_duration_hours = 0
            wave = self._find_wave(aircraft.current_mission_id)
            if wave:
                mission_duration_hours = wave.duration_minutes / 60.0
            aircraft.total_flight_hours += mission_duration_hours
            aircraft.takeoff_landing_count += 1
            aircraft.landings_since_last_pm += 1
            aircraft.flight_hours_since_last_pm += mission_duration_hours
            aircraft.phase = "post_support"
            aircraft.scheduled_return_time = None
            wave_id = aircraft.current_mission_id
            aircraft.current_mission_id = None
            self._sample_post_mission_failure(aircraft, mission_duration_hours, wave)
            if wave and not any(a.current_mission_id == wave.wave_id for a in self.aircraft):
                wave.status = "completed"
                self.completed_sorties += len(wave.assigned_tail_numbers or [])
                self._log("wave_completed", f"wave {wave.wave_id} completed")

    def _sample_post_mission_failure(
        self,
        aircraft: AircraftAgent,
        mission_hours: float,
        wave: MissionWave | None,
    ) -> None:
        threat_multiplier = 1.0
        if wave and wave.threat_level == "高":
            threat_multiplier = 1.3
        elif wave and wave.threat_level == "中":
            threat_multiplier = 1.1
        if self.threat_multiplier_override is not None:
            threat_multiplier = self.threat_multiplier_override
        failed = age_and_sample_failures(
            aircraft.equipment_tree,
            mission_hours,
            self.rng,
            threat_multiplier,
        )
        if failed:
            aircraft.failed_lru_id = failed[0]
            aircraft.lru_failures += 1
            self.lru_failures += 1
            self._log("lru_failure", f"{aircraft.tail_number} returned with {failed[0]} fault")

    def _launch_due_waves(self) -> None:
        for wave in self.all_waves:
            if wave.status not in ("scheduled", "delayed"):
                continue
            if self.sim_time < wave.planned_start:
                continue
            ready_aircraft = [
                a for a in self.aircraft
                if a.is_mission_ready and a.aircraft_type == wave.aircraft_type
            ]
            deadline = wave.planned_start + self.mission_scheduler.cancel_minutes
            if len(ready_aircraft) < wave.required_aircraft:
                wave.status = "delayed"
                if self.sim_time >= deadline:
                    wave.status = "cancelled"
                    self.cancelled_sorties += wave.required_aircraft
                    self._log("wave_cancelled", f"wave {wave.wave_id} cancelled")
                continue
            assigned = sorted(ready_aircraft, key=lambda a: a.tail_number)[: wave.required_aircraft]
            wave.status = "flying"
            wave.actual_start = self.sim_time
            wave.return_time = self.sim_time + wave.duration_minutes
            wave.assigned_tail_numbers = [a.tail_number for a in assigned]
            delay = max(0.0, self.sim_time - wave.planned_start)
            self.total_departure_delay += delay * len(assigned)
            if delay > 0:
                self.delayed_sorties += len(assigned)
            self.launched_sorties += len(assigned)
            for a in assigned:
                a.phase = "flying"
                a.current_mission_id = wave.wave_id
                a.scheduled_return_time = wave.return_time
            self._log("wave_launched", f"wave {wave.wave_id} launched with {len(assigned)} aircraft")

    def _find_wave(self, wave_id: int | None) -> MissionWave | None:
        if wave_id is None:
            return None
        for wave in self.all_waves:
            if wave.wave_id == wave_id:
                return wave
        return None

    def _age_and_sample_failures(self) -> None:
        dt_hours = self.tick_minutes / 60.0
        for aircraft in self.aircraft:
            if aircraft.phase == "flying":
                continue
            failed = age_and_sample_failures(
                aircraft.equipment_tree,
                dt_hours,
                self.rng,
                self.threat_multiplier_override or 1.0,
            )
            if failed:
                aircraft.failed_lru_id = failed[0]
                aircraft.lru_failures += 1
                self.lru_failures += 1

    def _dispatch_support_jobs(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase == "post_support":
                activity_id = "corrective" if aircraft.failed_lru_id else "preflight"
                if self.activity_planner.get_activity(activity_id):
                    self._create_job(aircraft, activity_id)
            elif aircraft.phase == "idle" and aircraft.failed_lru_id:
                if self.activity_planner.get_activity("corrective"):
                    self._create_job(aircraft, "corrective")

    def _create_job(self, aircraft: AircraftAgent, activity_id: str) -> None:
        self._job_counter += 1
        job = self.activity_planner.create_activity_job(
            activity_id, aircraft.tail_number, self.sim_time,
        )
        aircraft.current_job_id = self._job_counter
        if activity_id == "corrective":
            aircraft.phase = "maintenance"
        elif activity_id == "preflight":
            aircraft.phase = "preparing"
        self.activity_jobs.append(job)
        self._log("job_created", f"{activity_id} job for {aircraft.tail_number}")

    def _advance_activity_jobs(self) -> None:
        waiting = [j for j in self.activity_jobs if j.state == "waiting"]
        waiting.sort(key=lambda j: (j.priority, j.created_time))
        for job in waiting:
            task = job.tasks[job.task_index] if job.task_index < len(job.tasks) else None
            if task is None:
                self._complete_job(job)
                continue
            node = self.support_network.nodes.get(job.resource_id)
            if node is None:
                continue
            if not self._can_allocate_resources(node, job):
                continue
            self._allocate_resources(node, job)
            if job.spare_type and job.spare_quantity > 0:
                if not self.support_network.consume_spare(job.resource_id, job.spare_type, job.spare_quantity):
                    self._release_resources(node, job)
                    continue
            job.active_task = task
            job.remaining = sample_duration(task.get("durationProfile", {}), self.rng, float(task.get("durationMinutes", 30)))
            job.state = "active"
            if job.started_time is None:
                job.started_time = self.sim_time

        active = [j for j in self.activity_jobs if j.state == "active"]
        for job in active:
            job.remaining -= self.tick_minutes
            if job.remaining > 0:
                continue
            node = self.support_network.nodes.get(job.resource_id)
            if node:
                self._release_resources(node, job)
            job.active_task = None
            job.task_index += 1
            if job.task_index >= len(job.tasks):
                self._complete_job(job)
            else:
                job.state = "waiting"

    def _can_allocate_resources(self, node: Any, job: ActivityJob) -> bool:
        return node.personnel_pool.available >= job.required_personnel

    def _allocate_resources(self, node: Any, job: ActivityJob) -> None:
        node.personnel_pool.allocate(job.required_personnel)

    def _release_resources(self, node: Any, job: ActivityJob) -> None:
        node.personnel_pool.release(job.required_personnel)

    def _complete_job(self, job: ActivityJob) -> None:
        job.state = "completed"
        job.completed_time = self.sim_time + self.tick_minutes
        aircraft = next((a for a in self.aircraft if a.tail_number == job.aircraft_tail), None)
        if aircraft:
            aircraft.current_job_id = None
            if job.activity_id == "corrective":
                if aircraft.failed_lru_id:
                    decision = decide_repair_or_replace(
                        aircraft.equipment_tree.get(aircraft.failed_lru_id, {}).special_repair_profile or {},
                        self.rng,
                    )
                    if decision == "repair":
                        self.repair_count += 1
                    else:
                        self.replace_count += 1
                    aircraft.restore_failed_lru(aircraft.failed_lru_id)
                aircraft.phase = "ready"
            elif job.activity_id == "preflight":
                aircraft.phase = "ready"
            elif job.activity_id == "preventive":
                aircraft.flight_hours_since_last_pm = 0
                aircraft.days_since_last_pm = 0
                aircraft.landings_since_last_pm = 0
                aircraft.phase = "ready"
        self.completed_jobs.append(job)
        self._log("job_completed", f"{job.activity_id} job for {job.aircraft_tail}")

    def _check_preventive_maintenance(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase not in ("idle", "ready"):
                continue
            due = self.activity_planner.check_preventive_due(
                aircraft.flight_hours_since_last_pm,
                aircraft.days_since_last_pm,
                aircraft.landings_since_last_pm,
            )
            if due and self.activity_planner.get_activity("preventive"):
                self._create_job(aircraft, "preventive")

    def _log(self, event: str, message: str) -> None:
        self.event_log.append({"time": self.sim_time, "event": event, "message": message})
        if len(self.event_log) > 500:
            self.event_log = self.event_log[-500:]

    def snapshot(self) -> dict[str, Any]:
        planned = sum(w.required_aircraft for w in self.all_waves if w.status in ("scheduled", "delayed", "flying"))
        planned_total = sum(w.required_aircraft for w in self.all_waves)
        spare_total = sum(self.support_network.get_total_inventory(st) for st in set())
        spare_stock = sum(
            sum(node.inventory.values()) for node in self.support_network.nodes.values()
        )
        ready_count = sum(1 for a in self.aircraft if a.is_mission_ready)
        reliability = evaluate_system_reliability(self.reliability_blocks, self.tick_minutes / 60)
        return {
            "time": self.sim_time,
            "elapsed_hours": self.sim_time / 60.0,
            "aircraft_count": len(self.aircraft),
            "ready_aircraft": ready_count,
            "flying_aircraft": sum(1 for a in self.aircraft if a.phase == "flying"),
            "maintenance_aircraft": sum(1 for a in self.aircraft if a.phase == "maintenance"),
            "planned_sorties": planned_total,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "delayed_sorties": self.delayed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "sortie_completion_rate": self.completed_sorties / max(planned_total, 1),
            "avg_departure_delay": self.total_departure_delay / max(self.launched_sorties, 1),
            "lru_failures": self.lru_failures,
            "repair_count": self.repair_count,
            "replace_count": self.replace_count,
            "spare_stock_total": spare_stock,
            "system_reliability": reliability,
            "waiting_jobs": sum(1 for j in self.activity_jobs if j.state == "waiting"),
            "active_jobs": sum(1 for j in self.activity_jobs if j.state == "active"),
        }

    def visualization_state(self) -> dict[str, Any]:
        return {
            "snapshot": self.snapshot(),
            "aircraft": [
                {
                    "tail_number": a.tail_number,
                    "type": a.aircraft_type,
                    "phase": a.phase,
                    "mission_id": a.current_mission_id,
                    "flight_hours": round(a.total_flight_hours, 2),
                    "landings": a.takeoff_landing_count,
                    "failed_lru": a.failed_lru_id or "",
                    "equipment": a.equipment_snapshot(),
                }
                for a in self.aircraft
            ],
            "resources": [
                {
                    "node_id": node.id,
                    "name": node.name,
                    "personnel_available": node.personnel_pool.available,
                    "personnel_capacity": node.personnel_pool.capacity,
                    "equipment_available": node.equipment_pool.available,
                    "equipment_capacity": node.equipment_pool.capacity,
                    "inventory": dict(node.inventory),
                    "utilization": node.personnel_pool.utilization(max(self.sim_time, self.tick_minutes)),
                }
                for node in self.support_network.nodes.values()
            ],
            "spares": [
                {
                    "node_id": node.id,
                    "inventory": dict(node.inventory),
                }
                for node in self.support_network.nodes.values()
            ],
            "missions": [
                {
                    "wave_id": w.wave_id,
                    "planned_start": w.planned_start,
                    "actual_start": w.actual_start,
                    "return_time": w.return_time,
                    "required_aircraft": w.required_aircraft,
                    "aircraft_type": w.aircraft_type,
                    "status": w.status,
                    "assigned_tail_numbers": list(w.assigned_tail_numbers or []),
                }
                for w in self.all_waves
                if w.status != "completed"
            ],
            "jobs": [
                {
                    "activity_id": j.activity_id,
                    "aircraft_tail": j.aircraft_tail,
                    "state": j.state,
                    "current_task": j.active_task.get("workName", "") if j.active_task else "",
                    "remaining": max(0.0, j.remaining),
                }
                for j in self.activity_jobs
                if j.state != "completed"
            ],
            "events": list(self.event_log[-20:]),
        }

    def compute_final_metrics(self) -> dict[str, Any]:
        planned_total = sum(w.required_aircraft for w in self.all_waves)
        spare_consumed = sum(
            sum(inv.values()) for inv in (node.inventory for node in self.support_network.nodes.values())
        )
        initial_spare = sum(
            sum(node.inventory.values()) for node in self.support_network.nodes.values()
        )
        return {
            "sortie_completion_rate": self.completed_sorties / max(planned_total, 1),
            "launch_rate": self.launched_sorties / max(planned_total, 1),
            "cancelled_rate": self.cancelled_sorties / max(planned_total, 1),
            "delayed_rate": self.delayed_sorties / max(self.launched_sorties, 1),
            "spare_fill_rate": 1.0 - (self.replace_count / max(self.lru_failures, 1)) if self.lru_failures > 0 else 1.0,
            "lru_failures": self.lru_failures,
            "repair_count": self.repair_count,
            "replace_count": self.replace_count,
            "repair_to_replace_ratio": self.repair_count / max(self.repair_count + self.replace_count, 1),
            "avg_departure_delay": self.total_departure_delay / max(self.launched_sorties, 1),
            "spare_stock_remaining": initial_spare,
        }
