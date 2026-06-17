"""Mesa aviation sortie support model with resource-constrained operations.

The model keeps Mesa as the experiment and visualization surface while encoding
basic DES-style support jobs directly: ordered tasks request constrained
resources, consume simulated time, and release the resources when complete.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
import json
import math
from pathlib import Path
from typing import Any

from mesa import Agent, Model


@dataclass(frozen=True)
class BasicSupportTask:
    name: str
    duration: float
    resources: dict[str, int]
    spare_parts: dict[str, int] = field(default_factory=dict)
    repair_failed_lru: bool = False


@dataclass
class ResourcePool:
    name: str
    capacity: int
    display_name: str | None = None
    category: str = "resource"
    in_use: int = 0
    busy_minutes: float = 0.0
    work_count: int = 0

    @property
    def available(self) -> int:
        return self.capacity - self.in_use

    def utilization(self, elapsed_minutes: float) -> float:
        if self.capacity <= 0 or elapsed_minutes <= 0:
            return 0.0
        return min(1.0, self.busy_minutes / (self.capacity * elapsed_minutes))


@dataclass
class SparePartInventory:
    part_id: str
    name: str
    quantity: int
    reorder_point: int = 0
    reorder_quantity: int = 0
    lead_time: float = 0.0
    consumed: int = 0
    replenished: int = 0
    pending_deliveries: list[dict[str, float | int]] = field(default_factory=list)

    @property
    def pending_quantity(self) -> int:
        return sum(int(delivery["quantity"]) for delivery in self.pending_deliveries)


@dataclass
class SupportJob:
    job_id: int
    aircraft: "AircraftAgent"
    kind: str
    tasks: list[BasicSupportTask]
    created_time: float
    priority: int
    task_index: int = 0
    state: str = "waiting"
    remaining: float = 0.0
    active_task: BasicSupportTask | None = None
    allocated_resources: dict[str, int] = field(default_factory=dict)
    started_time: float | None = None
    completed_time: float | None = None

    @property
    def current_task(self) -> BasicSupportTask | None:
        if self.task_index >= len(self.tasks):
            return None
        return self.tasks[self.task_index]


@dataclass
class MissionSpec:
    mission_id: int
    planned_start: float
    duration: float
    required_aircraft: int
    aircraft_type: str
    status: str = "scheduled"
    actual_start: float | None = None
    return_time: float | None = None
    assigned_tail_numbers: list[str] = field(default_factory=list)


class AircraftAgent(Agent):
    """Aircraft with history, mission state, and ontology-configured equipment."""

    def __init__(
        self,
        model: "AviationSupportModel",
        tail_number: str,
        aircraft_type: str,
        index: int,
        history: dict[str, Any] | None = None,
    ):
        super().__init__(model)
        history = history or {}
        self.tail_number = tail_number
        self.aircraft_type = aircraft_type
        self.index = index
        self.state = "available"
        self.current_job_id: int | None = None
        self.current_mission_id: int | None = None
        self.scheduled_return_time: float | None = None
        self.total_flight_hours = float(history.get("flight_hours", model.initial_flight_hours + 12 * index))
        self.landings = int(history.get("landings", model.initial_landings + 4 * index))
        self.overhaul_calendar_days = float(history.get("overhaul_days", model.initial_overhaul_days + index))
        self.failed_lru: dict | None = None
        self.last_failure_time: float | None = None
        type_config = model.aircraft_type_configs.get(aircraft_type, model.default_aircraft_type_config())
        self.systems = copy.deepcopy(type_config.get("systems", []))
        self.lrus = self._flatten_lrus()

    @property
    def display_x(self) -> int:
        columns = max(1, self.model.parking_columns)
        return self.index % columns

    @property
    def display_y(self) -> int:
        columns = max(1, self.model.parking_columns)
        return self.index // columns

    def _flatten_lrus(self) -> list[dict[str, Any]]:
        lrus: list[dict[str, Any]] = []
        for system in self.systems:
            system.setdefault("health", "healthy")
            for lru in system.get("lrus", []):
                lru.setdefault("health", "healthy")
                lru.setdefault("subsystem", system.get("id", system.get("name", "system")))
                lru.setdefault("mtbf_hours", 300.0)
                lru.setdefault("mttr_minutes", 90.0)
                lru.setdefault("spare_part", f"{lru.get('id', lru.get('name', 'lru'))}_spare")
                lrus.append(lru)
        return lrus

    def mark_lru_failed(self, failed_lru: dict[str, Any], sim_time: float) -> None:
        self.failed_lru = dict(failed_lru)
        self.last_failure_time = sim_time
        for system in self.systems:
            for lru in system.get("lrus", []):
                if lru.get("id") == failed_lru.get("id") or lru.get("name") == failed_lru.get("name"):
                    lru["health"] = "failed"
                    system["health"] = "degraded"

    def restore_failed_lru(self) -> None:
        if not self.failed_lru:
            return
        failed_id = self.failed_lru.get("id")
        failed_name = self.failed_lru.get("name")
        for system in self.systems:
            for lru in system.get("lrus", []):
                if lru.get("id") == failed_id or lru.get("name") == failed_name:
                    lru["health"] = "healthy"
            if all(lru.get("health") == "healthy" for lru in system.get("lrus", [])):
                system["health"] = "healthy"
        self.failed_lru = None

    def equipment_snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "id": system.get("id", system.get("name", "")),
                "name": system.get("name", system.get("id", "")),
                "health": system.get("health", "healthy"),
                "lrus": [
                    {
                        "id": lru.get("id", lru.get("name", "")),
                        "name": lru.get("name", lru.get("id", "")),
                        "health": lru.get("health", "healthy"),
                        "mtbf_hours": lru.get("mtbf_hours", 0),
                        "mttr_minutes": lru.get("mttr_minutes", 0),
                        "spare_part": lru.get("spare_part", ""),
                    }
                    for lru in system.get("lrus", [])
                ],
            }
            for system in self.systems
        ]


class AviationSupportModel(Model):
    """Sortie-generation support model for aircraft, tasks, and resources."""

    def __init__(
        self,
        aircraft_count: int | None = None,
        aircraft_type: str | None = None,
        mission_count: int | None = None,
        mission_aircraft_required: int | None = None,
        first_mission_start: float | None = None,
        mission_interval: float | None = None,
        mission_duration: float | None = None,
        max_departure_delay: float | None = None,
        tick_minutes: float | None = None,
        mechanic_teams: int | None = None,
        fuel_trucks: int | None = None,
        power_carts: int | None = None,
        weapons_crews: int | None = None,
        maintenance_bays: int | None = None,
        pre_power_check_duration: float = 20.0,
        pre_refuel_duration: float = 30.0,
        pre_weapons_duration: float = 35.0,
        preflight_inspection_duration: float = 25.0,
        postflight_inspection_duration: float = 25.0,
        post_refuel_duration: float = 20.0,
        fault_isolation_duration: float = 30.0,
        functional_test_duration: float = 20.0,
        lru_failure_multiplier: float = 1.0,
        initial_flight_hours: float = 120.0,
        initial_landings: int = 40,
        initial_overhaul_days: float = 20.0,
        ontology_path: str | None = None,
        use_ontology_scenario: bool = False,
        spare_reorder_enabled: bool = True,
        seed: int | None = None,
    ):
        super().__init__(rng=seed)
        self.ontology_path = self._resolve_ontology_path(ontology_path)
        self.ontology = self._load_ontology(self.ontology_path)
        self.simulation_config = self.ontology.get("simulation", {})
        self.use_ontology_scenario = bool(use_ontology_scenario or ontology_path)
        self.spare_reorder_enabled = bool(spare_reorder_enabled)

        self.aircraft_type_configs = {
            item["id"]: item for item in self.simulation_config.get("aircraft_types", [])
        }
        scenario_aircraft = self.simulation_config.get("aircraft", [])
        scenario_missions = self.simulation_config.get("missions", [])

        self.aircraft_type = str(
            aircraft_type
            or self.simulation_config.get("default_aircraft_type")
            or next(iter(self.aircraft_type_configs), "fighter")
        )
        self.aircraft_count = int(aircraft_count or len(scenario_aircraft) or self.simulation_config.get("aircraft_count", 8))
        self.mission_count = int(mission_count or len(scenario_missions) or self.simulation_config.get("mission_count", 3))
        self.mission_aircraft_required = int(
            mission_aircraft_required or self.simulation_config.get("mission_aircraft_required", 4)
        )
        self.first_mission_start = float(first_mission_start or self.simulation_config.get("first_mission_start", 120.0))
        self.mission_interval = float(mission_interval or self.simulation_config.get("mission_interval", 180.0))
        self.mission_duration = float(mission_duration or self.simulation_config.get("mission_duration", 90.0))
        self.max_departure_delay = float(max_departure_delay or self.simulation_config.get("max_departure_delay", 90.0))
        self.tick_minutes = float(tick_minutes or self.simulation_config.get("tick_minutes", 10.0))
        self.lru_failure_multiplier = float(lru_failure_multiplier)
        self.initial_flight_hours = float(initial_flight_hours)
        self.initial_landings = int(initial_landings)
        self.initial_overhaul_days = float(initial_overhaul_days)
        self.parking_columns = 4

        self._validate_inputs()

        self.sim_time = 0.0
        self.steps_run = 0
        self.next_job_id = 1
        self.support_jobs: list[SupportJob] = []
        self.completed_jobs: list[SupportJob] = []
        self.event_log: list[dict] = []
        self.launched_sorties = 0
        self.completed_sorties = 0
        self.delayed_sorties = 0
        self.cancelled_sorties = 0
        self.total_departure_delay = 0.0
        self.lru_failures = 0
        self.maintenance_jobs_started = 0
        self.last_completed_operations = 0

        capacity_overrides = {
            "mechanic_team": mechanic_teams,
            "fuel_truck": fuel_trucks,
            "power_cart": power_carts,
            "weapons_crew": weapons_crews,
            "maintenance_bay": maintenance_bays,
        }
        self.resources = self._build_resources(capacity_overrides)
        self.spares = self._build_spares()
        self.support_plan = self._build_support_plan(
            pre_power_check_duration,
            pre_refuel_duration,
            pre_weapons_duration,
            preflight_inspection_duration,
            postflight_inspection_duration,
            post_refuel_duration,
            fault_isolation_duration,
            functional_test_duration,
        )

        self.aircraft = self._build_aircraft(scenario_aircraft if self.use_ontology_scenario else [])
        self.missions = self._build_missions(scenario_missions if self.use_ontology_scenario else [])

        self._log("model_initialized", f"{self.aircraft_count} aircraft and {self.mission_count} missions loaded")

    def _validate_inputs(self) -> None:
        if self.aircraft_count < 1:
            raise ValueError("aircraft_count must be at least 1")
        if self.mission_count < 1:
            raise ValueError("mission_count must be at least 1")
        if self.mission_aircraft_required < 1:
            raise ValueError("mission_aircraft_required must be at least 1")
        if self.tick_minutes <= 0:
            raise ValueError("tick_minutes must be positive")
        if self.mission_duration <= 0:
            raise ValueError("mission_duration must be positive")

    def _resolve_ontology_path(self, ontology_path: str | None) -> Path:
        if ontology_path:
            path = Path(ontology_path).expanduser()
            if not path.is_absolute() and not path.exists():
                path = Path(__file__).resolve().parent / path
            return path.resolve()
        return Path(__file__).resolve().with_name("ontology.json")

    def _load_ontology(self, ontology_path: Path) -> dict[str, Any]:
        if ontology_path.exists():
            return json.loads(ontology_path.read_text(encoding="utf-8"))
        return self._fallback_ontology()

    def _fallback_ontology(self) -> dict[str, Any]:
        return {
            "name": "Aviation Support",
            "entityTypes": [],
            "relationships": [],
            "simulation": {
                "default_aircraft_type": "fighter",
                "aircraft_types": [self.default_aircraft_type_config()],
                "resources": [
                    {"id": "mechanic_team", "name": "Mechanic Team", "category": "personnel", "capacity": 3},
                    {"id": "fuel_truck", "name": "Fuel Truck", "category": "equipment", "capacity": 2},
                    {"id": "power_cart", "name": "Power Cart", "category": "equipment", "capacity": 1},
                    {"id": "weapons_crew", "name": "Weapons Crew", "category": "personnel", "capacity": 1},
                    {"id": "maintenance_bay", "name": "Maintenance Bay", "category": "facility", "capacity": 1},
                ],
            },
        }

    def default_aircraft_type_config(self) -> dict[str, Any]:
        return {
            "id": "fighter",
            "name": "Fighter",
            "tail_prefix": "FTR",
            "systems": [
                {
                    "id": "propulsion",
                    "name": "Propulsion",
                    "lrus": [
                        {
                            "id": "engine_control_unit",
                            "name": "Engine Control Unit",
                            "mtbf_hours": 320.0,
                            "mttr_minutes": 90.0,
                            "spare_part": "engine_control_unit",
                        }
                    ],
                },
                {
                    "id": "hydraulic",
                    "name": "Hydraulic",
                    "lrus": [
                        {
                            "id": "hydraulic_pump",
                            "name": "Hydraulic Pump",
                            "mtbf_hours": 260.0,
                            "mttr_minutes": 75.0,
                            "spare_part": "hydraulic_pump",
                        }
                    ],
                },
                {
                    "id": "avionics",
                    "name": "Avionics",
                    "lrus": [
                        {
                            "id": "radar_processor",
                            "name": "Radar Processor",
                            "mtbf_hours": 420.0,
                            "mttr_minutes": 110.0,
                            "spare_part": "radar_processor",
                        }
                    ],
                },
            ],
        }

    def _build_resources(self, capacity_overrides: dict[str, int | None]) -> dict[str, ResourcePool]:
        configured = self.simulation_config.get("resources") or self._fallback_ontology()["simulation"]["resources"]
        resources = {}
        for item in configured:
            resource_id = str(item["id"])
            capacity = int(capacity_overrides.get(resource_id) or item.get("capacity", 1))
            resources[resource_id] = ResourcePool(
                name=resource_id,
                display_name=str(item.get("name") or resource_id),
                category=str(item.get("category") or "resource"),
                capacity=capacity,
            )
        return resources

    def _build_spares(self) -> dict[str, SparePartInventory]:
        spares = {}
        for item in self.simulation_config.get("spares", []):
            part_id = str(item["id"])
            spares[part_id] = SparePartInventory(
                part_id=part_id,
                name=str(item.get("name") or part_id),
                quantity=int(item.get("initial_quantity", 0)),
                reorder_point=int(item.get("reorder_point", 0)),
                reorder_quantity=int(item.get("reorder_quantity", 0)),
                lead_time=float(item.get("lead_time", 0.0)),
            )
        for type_config in self.aircraft_type_configs.values():
            for system in type_config.get("systems", []):
                for lru in system.get("lrus", []):
                    part_id = str(lru.get("spare_part") or lru.get("id") or lru.get("name"))
                    spares.setdefault(part_id, SparePartInventory(part_id=part_id, name=part_id, quantity=2))
        return spares

    def _build_aircraft(self, configured_aircraft: list[dict[str, Any]]) -> list[AircraftAgent]:
        if configured_aircraft:
            aircraft = []
            for index, item in enumerate(configured_aircraft):
                aircraft.append(
                    AircraftAgent(
                        self,
                        tail_number=str(item.get("tail_number") or item.get("id") or f"{self.aircraft_type.upper()}-{index + 1:02d}"),
                        aircraft_type=str(item.get("aircraft_type") or self.aircraft_type),
                        index=index,
                        history=dict(item.get("history") or {}),
                    )
                )
            self.aircraft_count = len(aircraft)
            return aircraft

        type_config = self.aircraft_type_configs.get(self.aircraft_type, self.default_aircraft_type_config())
        prefix = str(type_config.get("tail_prefix") or self.aircraft_type.upper())
        return [
            AircraftAgent(
                self,
                tail_number=f"{prefix}-{index + 1:02d}",
                aircraft_type=self.aircraft_type,
                index=index,
            )
            for index in range(self.aircraft_count)
        ]

    def _build_missions(self, configured_missions: list[dict[str, Any]]) -> list[MissionSpec]:
        if configured_missions:
            missions = []
            for index, item in enumerate(configured_missions):
                missions.append(
                    MissionSpec(
                        mission_id=int(item.get("mission_id") or item.get("id") or index + 1),
                        planned_start=float(item.get("planned_start", self.first_mission_start)),
                        duration=float(item.get("duration", self.mission_duration)),
                        required_aircraft=int(item.get("required_aircraft", self.mission_aircraft_required)),
                        aircraft_type=str(item.get("aircraft_type") or self.aircraft_type),
                    )
                )
            self.mission_count = len(missions)
            return missions

        return [
            MissionSpec(
                mission_id=index + 1,
                planned_start=self.first_mission_start + index * self.mission_interval,
                duration=self.mission_duration,
                required_aircraft=self.mission_aircraft_required,
                aircraft_type=self.aircraft_type,
            )
            for index in range(self.mission_count)
        ]

    def _build_support_plan(
        self,
        pre_power_check_duration: float,
        pre_refuel_duration: float,
        pre_weapons_duration: float,
        preflight_inspection_duration: float,
        postflight_inspection_duration: float,
        post_refuel_duration: float,
        fault_isolation_duration: float,
        functional_test_duration: float,
    ) -> dict[str, list[BasicSupportTask]]:
        configured_tasks = self.simulation_config.get("support_tasks", {})
        configured_plans = self.simulation_config.get("support_plans", {})
        if configured_tasks and configured_plans:
            catalog = {}
            for task_id, raw_task in configured_tasks.items():
                resources = {
                    str(name): int(amount)
                    for name, amount in dict(raw_task.get("resources") or {}).items()
                }
                unknown = [name for name in resources if name not in self.resources]
                if unknown:
                    raise ValueError(f"support task {task_id!r} references unknown resources: {unknown}")
                catalog[str(task_id)] = BasicSupportTask(
                    name=str(raw_task.get("name") or task_id),
                    duration=float(raw_task.get("duration", 0.0)),
                    resources=resources,
                    spare_parts={
                        str(name): int(amount)
                        for name, amount in dict(raw_task.get("spare_parts") or {}).items()
                    },
                    repair_failed_lru=bool(raw_task.get("repair_failed_lru", False)),
                )

            support_plan = {}
            for plan_id, task_ids in configured_plans.items():
                support_plan[str(plan_id)] = [catalog[str(task_id)] for task_id in task_ids]
            return support_plan

        return {
            "pre_mission": [
                BasicSupportTask("power_check", float(pre_power_check_duration), {"mechanic_team": 1, "power_cart": 1}),
                BasicSupportTask("refuel", float(pre_refuel_duration), {"mechanic_team": 1, "fuel_truck": 1}),
                BasicSupportTask("weapons_load", float(pre_weapons_duration), {"mechanic_team": 1, "weapons_crew": 1}),
                BasicSupportTask("preflight_inspection", float(preflight_inspection_duration), {"mechanic_team": 1}),
            ],
            "post_mission": [
                BasicSupportTask("postflight_inspection", float(postflight_inspection_duration), {"mechanic_team": 1}),
                BasicSupportTask("turnaround_refuel", float(post_refuel_duration), {"mechanic_team": 1, "fuel_truck": 1}),
            ],
            "maintenance": [
                BasicSupportTask("fault_isolation", float(fault_isolation_duration), {"mechanic_team": 1, "maintenance_bay": 1}),
                BasicSupportTask(
                    "lru_replacement",
                    0.0,
                    {"mechanic_team": 1, "maintenance_bay": 1},
                    repair_failed_lru=True,
                ),
                BasicSupportTask("functional_test", float(functional_test_duration), {"mechanic_team": 1, "power_cart": 1}),
            ],
        }

    def step(self) -> None:
        self.last_completed_operations = 0
        self._receive_due_spares()
        self._return_due_aircraft()
        self._launch_due_missions()
        self._dispatch_available_aircraft_to_pre_support()
        self._start_waiting_jobs()
        self._charge_resource_busy_time()
        self._advance_active_jobs()
        self.sim_time += self.tick_minutes
        self.steps_run += 1
        self._advance_aircraft_calendar()

    def _dispatch_available_aircraft_to_pre_support(self) -> None:
        if not any(mission.status in {"scheduled", "delayed"} for mission in self.missions):
            return
        for aircraft in self.aircraft:
            if aircraft.state == "available":
                self._create_job(aircraft, "pre_mission")

    def _create_job(self, aircraft: AircraftAgent, kind: str) -> SupportJob:
        tasks = self._tasks_for_job(aircraft, kind)
        priority = {"pre_mission": 0, "maintenance": 1, "post_mission": 2}.get(kind, 3)
        job = SupportJob(
            job_id=self.next_job_id,
            aircraft=aircraft,
            kind=kind,
            tasks=tasks,
            created_time=self.sim_time,
            priority=priority,
        )
        self.next_job_id += 1
        aircraft.current_job_id = job.job_id
        if kind == "pre_mission":
            aircraft.state = "pre_support"
        elif kind == "post_mission":
            aircraft.state = "post_support"
        elif kind == "maintenance":
            aircraft.state = "maintenance"
            self.maintenance_jobs_started += 1
        self.support_jobs.append(job)
        self._log("job_created", f"{kind} job {job.job_id} created for {aircraft.tail_number}")
        return job

    def _tasks_for_job(self, aircraft: AircraftAgent, kind: str) -> list[BasicSupportTask]:
        if kind != "maintenance":
            return list(self.support_plan[kind])
        tasks = []
        for task in self.support_plan["maintenance"]:
            if not task.repair_failed_lru:
                tasks.append(task)
                continue
            mttr = 90.0
            spare_parts = dict(task.spare_parts)
            if aircraft.failed_lru:
                mttr = float(aircraft.failed_lru["mttr_minutes"])
                spare_part = aircraft.failed_lru.get("spare_part")
                if spare_part:
                    spare_parts[str(spare_part)] = spare_parts.get(str(spare_part), 0) + 1
            tasks.append(
                BasicSupportTask(
                    task.name,
                    mttr,
                    dict(task.resources),
                    spare_parts=spare_parts,
                    repair_failed_lru=True,
                )
            )
        return tasks

    def _start_waiting_jobs(self) -> None:
        waiting = [job for job in self.support_jobs if job.state == "waiting"]
        waiting.sort(key=lambda item: (item.priority, item.created_time, item.aircraft.tail_number))
        for job in waiting:
            task = job.current_task
            if task is None:
                self._complete_job(job)
                continue
            if not self._can_allocate(task):
                continue
            self._allocate(task.resources)
            self._consume_spares(task.spare_parts)
            job.allocated_resources = dict(task.resources)
            job.active_task = task
            job.remaining = float(task.duration)
            job.state = "active"
            if job.started_time is None:
                job.started_time = self.sim_time
            self._log("task_started", f"{job.aircraft.tail_number} started {task.name}")

    def _advance_active_jobs(self) -> None:
        active = [job for job in self.support_jobs if job.state == "active"]
        for job in active:
            job.remaining -= self.tick_minutes
            if job.remaining > 0:
                continue
            self._release(job.allocated_resources)
            completed_task = job.active_task.name if job.active_task else "task"
            job.allocated_resources = {}
            job.active_task = None
            job.task_index += 1
            self.last_completed_operations += 1
            self._log("task_completed", f"{job.aircraft.tail_number} completed {completed_task}")
            if job.task_index >= len(job.tasks):
                self._complete_job(job)
            else:
                job.state = "waiting"

    def _complete_job(self, job: SupportJob) -> None:
        job.state = "completed"
        job.completed_time = self.sim_time + self.tick_minutes
        job.aircraft.current_job_id = None
        if job.kind == "pre_mission":
            job.aircraft.state = "mission_ready"
        elif job.kind == "post_mission":
            if job.aircraft.failed_lru:
                self._create_job(job.aircraft, "maintenance")
            else:
                job.aircraft.state = "available"
        elif job.kind == "maintenance":
            job.aircraft.restore_failed_lru()
            job.aircraft.state = "available"
        self.completed_jobs.append(job)
        self._log("job_completed", f"{job.kind} job {job.job_id} completed for {job.aircraft.tail_number}")

    def _can_allocate(self, task: BasicSupportTask) -> bool:
        for name, amount in task.resources.items():
            pool = self.resources[name]
            if pool.available < amount:
                return False
        for part_id, amount in task.spare_parts.items():
            spare = self.spares.get(part_id)
            if spare is None or spare.quantity < amount:
                return False
        return True

    def _allocate(self, requirements: dict[str, int]) -> None:
        for name, amount in requirements.items():
            pool = self.resources[name]
            pool.in_use += amount
            pool.work_count += amount

    def _release(self, requirements: dict[str, int]) -> None:
        for name, amount in requirements.items():
            pool = self.resources[name]
            pool.in_use = max(0, pool.in_use - amount)

    def _charge_resource_busy_time(self) -> None:
        for pool in self.resources.values():
            pool.busy_minutes += pool.in_use * self.tick_minutes

    def _consume_spares(self, requirements: dict[str, int]) -> None:
        for part_id, amount in requirements.items():
            spare = self.spares[part_id]
            spare.quantity -= amount
            spare.consumed += amount
            self._log("spare_consumed", f"{amount} {spare.name} consumed")
            self._maybe_schedule_replenishment(spare)

    def _maybe_schedule_replenishment(self, spare: SparePartInventory) -> None:
        if not self.spare_reorder_enabled or spare.reorder_quantity <= 0:
            return
        projected = spare.quantity + spare.pending_quantity
        if projected > spare.reorder_point:
            return
        delivery = {
            "due_time": self.sim_time + spare.lead_time,
            "quantity": spare.reorder_quantity,
        }
        spare.pending_deliveries.append(delivery)
        self._log("spare_reorder", f"{spare.reorder_quantity} {spare.name} ordered")

    def _receive_due_spares(self) -> None:
        for spare in self.spares.values():
            due = [delivery for delivery in spare.pending_deliveries if float(delivery["due_time"]) <= self.sim_time]
            if not due:
                continue
            spare.pending_deliveries = [
                delivery for delivery in spare.pending_deliveries if float(delivery["due_time"]) > self.sim_time
            ]
            received = sum(int(delivery["quantity"]) for delivery in due)
            spare.quantity += received
            spare.replenished += received
            self._log("spare_replenished", f"{received} {spare.name} replenished")

    def _advance_aircraft_calendar(self) -> None:
        day_fraction = self.tick_minutes / 1440.0
        for aircraft in self.aircraft:
            aircraft.overhaul_calendar_days += day_fraction

    def _launch_due_missions(self) -> None:
        for mission in self.missions:
            if mission.status not in {"scheduled", "delayed"}:
                continue
            if self.sim_time < mission.planned_start:
                continue

            ready_aircraft = [
                aircraft
                for aircraft in self.aircraft
                if aircraft.state == "mission_ready" and aircraft.aircraft_type == mission.aircraft_type
            ]
            deadline = mission.planned_start + self.max_departure_delay
            if len(ready_aircraft) < mission.required_aircraft:
                mission.status = "delayed"
                if self.sim_time >= deadline:
                    mission.status = "cancelled"
                    self.cancelled_sorties += mission.required_aircraft
                    self._log("mission_cancelled", f"mission {mission.mission_id} cancelled for insufficient ready aircraft")
                continue

            assigned = sorted(ready_aircraft, key=lambda aircraft: aircraft.tail_number)[: mission.required_aircraft]
            mission.status = "flying"
            mission.actual_start = self.sim_time
            mission.return_time = self.sim_time + mission.duration
            mission.assigned_tail_numbers = [aircraft.tail_number for aircraft in assigned]
            delay = max(0.0, self.sim_time - mission.planned_start)
            self.total_departure_delay += delay * len(assigned)
            if delay > 0:
                self.delayed_sorties += len(assigned)
            self.launched_sorties += len(assigned)
            for aircraft in assigned:
                aircraft.state = "flying"
                aircraft.current_mission_id = mission.mission_id
                aircraft.scheduled_return_time = mission.return_time
            self._log("mission_launched", f"mission {mission.mission_id} launched with {len(assigned)} aircraft")

    def _return_due_aircraft(self) -> None:
        returned_by_mission: set[int] = set()
        for aircraft in self.aircraft:
            if aircraft.state != "flying":
                continue
            if aircraft.scheduled_return_time is None or aircraft.scheduled_return_time > self.sim_time:
                continue
            mission = self._mission_by_id(aircraft.current_mission_id)
            mission_duration = mission.duration if mission else self.mission_duration
            aircraft.total_flight_hours += mission_duration / 60.0
            aircraft.landings += 1
            aircraft.state = "post_support"
            returned_by_mission.add(aircraft.current_mission_id or -1)
            aircraft.current_mission_id = None
            aircraft.scheduled_return_time = None
            failed_lru = self._sample_lru_failure(aircraft, mission_duration / 60.0)
            if failed_lru:
                aircraft.mark_lru_failed(failed_lru, self.sim_time)
                self.lru_failures += 1
                self._log("lru_failure", f"{aircraft.tail_number} returned with {failed_lru['name']} fault")
            self._create_job(aircraft, "post_mission")

        for mission_id in returned_by_mission:
            mission = self._mission_by_id(mission_id)
            if mission and not any(aircraft.current_mission_id == mission.mission_id for aircraft in self.aircraft):
                mission.status = "completed"
                self.completed_sorties += len(mission.assigned_tail_numbers)
                self._log("mission_completed", f"mission {mission.mission_id} completed")

    def _mission_by_id(self, mission_id: int | None) -> MissionSpec | None:
        if mission_id is None:
            return None
        for mission in self.missions:
            if mission.mission_id == mission_id:
                return mission
        return None

    def _sample_lru_failure(self, aircraft: AircraftAgent, mission_hours: float) -> dict | None:
        if self.lru_failure_multiplier <= 0:
            return None
        for lru in aircraft.lrus:
            hazard = mission_hours / float(lru["mtbf_hours"]) * self.lru_failure_multiplier
            probability = 1.0 - math.exp(-hazard)
            if self.random.random() < probability:
                return dict(lru)
        return None

    def _log(self, event: str, message: str) -> None:
        self.event_log.append({"time": self.sim_time, "event": event, "message": message})
        if len(self.event_log) > 200:
            self.event_log = self.event_log[-200:]

    def snapshot(self) -> dict:
        counts = self._state_counts()
        planned_sorties = sum(mission.required_aircraft for mission in self.missions)
        avg_departure_delay = self.total_departure_delay / self.launched_sorties if self.launched_sorties else 0.0
        waiting_jobs = sum(1 for job in self.support_jobs if job.state == "waiting")
        active_jobs = sum(1 for job in self.support_jobs if job.state == "active")
        maintenance_backlog = sum(
            1 for job in self.support_jobs if job.kind == "maintenance" and job.state in {"waiting", "active"}
        )
        mechanic_utilization = self._resource_utilization("mechanic_team")
        fuel_truck_utilization = self._resource_utilization("fuel_truck")
        power_cart_utilization = self._resource_utilization("power_cart")
        maintenance_bay_utilization = self._resource_utilization("maintenance_bay")
        spare_stock_total = sum(spare.quantity for spare in self.spares.values())
        spare_consumed_total = sum(spare.consumed for spare in self.spares.values())
        spare_replenished_total = sum(spare.replenished for spare in self.spares.values())
        resource_work_count = sum(pool.work_count for pool in self.resources.values())
        return {
            "time": self.sim_time,
            "elapsed_hours": self.sim_time / 60.0,
            "aircraft_count": self.aircraft_count,
            "available_aircraft": counts.get("available", 0),
            "pre_support_aircraft": counts.get("pre_support", 0),
            "mission_ready_aircraft": counts.get("mission_ready", 0),
            "flying_aircraft": counts.get("flying", 0),
            "post_support_aircraft": counts.get("post_support", 0),
            "maintenance_aircraft": counts.get("maintenance", 0),
            "planned_sorties": planned_sorties,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "delayed_sorties": self.delayed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "sortie_completion_rate": self.completed_sorties / planned_sorties if planned_sorties else 0.0,
            "avg_departure_delay": avg_departure_delay,
            "waiting_jobs": waiting_jobs,
            "active_jobs": active_jobs,
            "maintenance_backlog": maintenance_backlog,
            "lru_failures": self.lru_failures,
            "maintenance_jobs_started": self.maintenance_jobs_started,
            "mechanic_utilization": mechanic_utilization,
            "fuel_truck_utilization": fuel_truck_utilization,
            "power_cart_utilization": power_cart_utilization,
            "maintenance_bay_utilization": maintenance_bay_utilization,
            "resource_in_use": sum(pool.in_use for pool in self.resources.values()),
            "resource_work_count": resource_work_count,
            "spare_stock_total": spare_stock_total,
            "spare_consumed_total": spare_consumed_total,
            "spare_replenished_total": spare_replenished_total,
            "completed_operations_last_step": self.last_completed_operations,
        }

    def _resource_utilization(self, name: str) -> float:
        pool = self.resources.get(name)
        if pool is None:
            return 0.0
        return pool.utilization(max(self.sim_time, self.tick_minutes))

    def visualization_state(self) -> dict:
        return {
            "snapshot": self.snapshot(),
            "aircraft": [
                {
                    "tail_number": aircraft.tail_number,
                    "type": aircraft.aircraft_type,
                    "state": aircraft.state,
                    "mission_id": aircraft.current_mission_id,
                    "support_job_id": aircraft.current_job_id,
                    "x": aircraft.display_x,
                    "y": aircraft.display_y,
                    "flight_hours": round(aircraft.total_flight_hours, 2),
                    "landings": aircraft.landings,
                    "overhaul_days": round(aircraft.overhaul_calendar_days, 2),
                    "failed_lru": aircraft.failed_lru["name"] if aircraft.failed_lru else "",
                    "systems": aircraft.equipment_snapshot(),
                }
                for aircraft in self.aircraft
            ],
            "resources": [
                {
                    "name": pool.name,
                    "display_name": pool.display_name or pool.name,
                    "category": pool.category,
                    "capacity": pool.capacity,
                    "in_use": pool.in_use,
                    "status": "working" if pool.in_use else "idle",
                    "busy_minutes": pool.busy_minutes,
                    "work_count": pool.work_count,
                    "utilization": pool.utilization(max(self.sim_time, self.tick_minutes)),
                }
                for pool in self.resources.values()
            ],
            "spares": [
                {
                    "part_id": spare.part_id,
                    "name": spare.name,
                    "quantity": spare.quantity,
                    "consumed": spare.consumed,
                    "replenished": spare.replenished,
                    "pending_quantity": spare.pending_quantity,
                    "reorder_point": spare.reorder_point,
                }
                for spare in self.spares.values()
            ],
            "missions": [
                {
                    "mission_id": mission.mission_id,
                    "planned_start": mission.planned_start,
                    "actual_start": mission.actual_start,
                    "return_time": mission.return_time,
                    "required_aircraft": mission.required_aircraft,
                    "status": mission.status,
                    "assigned_tail_numbers": list(mission.assigned_tail_numbers),
                    "assigned_aircraft": [
                        {
                            "tail_number": aircraft.tail_number,
                            "state": aircraft.state,
                            "failed_lru": aircraft.failed_lru["name"] if aircraft.failed_lru else "",
                        }
                        for aircraft in self.aircraft
                        if aircraft.tail_number in mission.assigned_tail_numbers
                    ],
                }
                for mission in self.missions
            ],
            "jobs": [
                {
                    "job_id": job.job_id,
                    "tail_number": job.aircraft.tail_number,
                    "kind": job.kind,
                    "state": job.state,
                    "task": job.active_task.name if job.active_task else (job.current_task.name if job.current_task else ""),
                    "remaining": max(0.0, job.remaining),
                }
                for job in self.support_jobs
                if job.state != "completed"
            ],
            "events": list(self.event_log[-20:]),
        }

    def _state_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for aircraft in self.aircraft:
            counts[aircraft.state] = counts.get(aircraft.state, 0) + 1
        return counts


SortieSupportModel = AviationSupportModel
