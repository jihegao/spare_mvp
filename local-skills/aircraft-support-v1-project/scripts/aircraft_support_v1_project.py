#!/usr/bin/env python3
"""Standalone Project JSON helper for aircraft_support_v1.

This script intentionally avoids the spare_mvp formal adapter/backend path. It
can read backend SQLite project rows, remember the modeling table shape, explain
the Project by four domain groups, compile a narrow aircraft_support_v1 input
payload, and run the Mesa model when its package is importable.
"""

from __future__ import annotations

import argparse
import copy
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import sqlite3
import sys
from typing import Any


DEFAULT_MEMORY_PATH = Path.home() / ".codex" / "memory" / "aircraft-support-v1-project-schema.json"
REMOVED_MISSION_AREA_KEYS = {"missionAreas", "mission_areas"}
TABLE_PATHS = {
    "missionProfile": ("missionProfile",),
    "basicMissions": ("basicMissions",),
    "basicMissions.missionPhases": ("basicMissions", "*", "missionPhases"),
    "missionProfile.compositeTasks": ("missionProfile", "compositeTasks"),
    "missionProfile.periodicProfileLists": ("missionProfile", "periodicProfileLists"),
    "missionProfile.periodicTasks": ("missionProfile", "periodicTasks"),
    "products": ("products",),
    "components": ("components",),
    "combatUnit.members": ("combatUnit", "members"),
    "supportNodes": ("supportNodes",),
    "supportNodes.transportPolicies": ("supportNodes", "*", "transportPolicies"),
    "supportResources": ("supportResources",),
    "supportOrganization": ("supportOrganization",),
    "transportPolicies": ("transportPolicies",),
    "supportActivities": ("supportActivities",),
    "supportActivityJobs": ("supportActivityJobs",),
    "supportActivities.jobs": ("supportActivities", "*", "jobs"),
    "reliabilityBlockDiagram.nodes": ("reliabilityBlockDiagram", "nodes"),
    "reliabilityBlockDiagram.edges": ("reliabilityBlockDiagram", "edges"),
}


def uses_formal_project_path() -> bool:
    """Return whether this module imports the formal spare_mvp adapter path."""
    return False


def list_backend_projects(db_path: Path | str) -> list[dict[str, Any]]:
    connection = sqlite3.connect(str(db_path))
    try:
        cursor = connection.execute(
            """
            SELECT project_id, payload_json, updated_at
            FROM projects
            ORDER BY datetime(updated_at) DESC
            """
        )
        projects = []
        for project_id, payload_json, updated_at in cursor.fetchall():
            project = _loads_object(payload_json)
            projects.append(
                {
                    "project_id": str(project_id),
                    "name": _project_name(project),
                    "scenario_id": str(project.get("scenarioId") or ""),
                    "source_import_id": str((project.get("missionProfile") or {}).get("sourceImportId") or ""),
                    "active_module": str(project.get("activeModule") or ""),
                    "updated_at": updated_at,
                }
            )
        return projects
    finally:
        connection.close()


def load_backend_project(db_path: Path | str, project_id: str) -> dict[str, Any]:
    connection = sqlite3.connect(str(db_path))
    try:
        cursor = connection.execute(
            "SELECT payload_json FROM projects WHERE project_id = ?",
            (project_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(f"project not found: {project_id}")
        return _loads_object(row[0])
    finally:
        connection.close()


def save_project_template(
    db_path: Path | str,
    project: dict[str, Any],
    *,
    template_id: str | None = None,
    template_name: str | None = None,
    scenario_id: str | None = None,
    replace: bool = False,
) -> dict[str, Any]:
    source_project_id = str(project.get("project_id") or project.get("projectId") or "").strip()
    if not source_project_id:
        raise ValueError("source Project JSON must include project_id")
    target_project_id = str(template_id or f"{source_project_id}-template").strip()
    if not target_project_id:
        raise ValueError("template_id is required")
    if target_project_id == source_project_id:
        raise ValueError("template_id must differ from the source project_id")

    template = copy.deepcopy(project)
    original_scenario_id = str(project.get("scenarioId") or source_project_id)
    target_scenario_id = str(scenario_id or f"{original_scenario_id}-template").strip()
    if target_scenario_id == original_scenario_id:
        target_scenario_id = f"{target_scenario_id}-template"

    project_info = _dict(template.get("projectInfo")).copy()
    original_name = _project_name(project) or source_project_id
    project_info["name"] = str(template_name or f"{original_name} 模板")
    project_info["isTemplate"] = True
    project_info["is_template"] = True
    project_info["sourceProjectId"] = source_project_id

    template["project_id"] = target_project_id
    template["schema_version"] = str(template.get("schema_version") or "project-v0")
    template["project_version"] = str(template.get("project_version") or "project-v0.1")
    template["scenarioId"] = target_scenario_id
    template["activeModule"] = str(template.get("activeModule") or "sparePlanning")
    template["projectInfo"] = project_info

    connection = sqlite3.connect(str(db_path))
    try:
        existing = connection.execute(
            "SELECT 1 FROM projects WHERE project_id = ?",
            (target_project_id,),
        ).fetchone()
        if existing is not None and not replace:
            raise ValueError(f"project template already exists: {target_project_id}")
        connection.execute(
            """
            INSERT INTO projects (
              project_id, schema_version, project_version, scenario_id,
              active_module, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id) DO UPDATE SET
              schema_version = excluded.schema_version,
              project_version = excluded.project_version,
              scenario_id = excluded.scenario_id,
              active_module = excluded.active_module,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                target_project_id,
                template["schema_version"],
                template["project_version"],
                template.get("scenarioId"),
                template.get("activeModule"),
                json.dumps(template, ensure_ascii=False, sort_keys=True),
            ),
        )
        connection.commit()
    finally:
        connection.close()
    return {
        "status": "saved",
        "project_id": target_project_id,
        "schema_version": template["schema_version"],
        "project_version": template["project_version"],
        "scenario_id": template["scenarioId"],
        "source_project_id": source_project_id,
        "is_template": True,
        "replaced": bool(existing),
    }


def remember_project_structure(
    project: dict[str, Any],
    *,
    memory_path: Path | str | None = None,
    project_source: str = "",
) -> dict[str, Any]:
    memory = {
        "model_family": "aircraft_support_v1",
        "project_id": str(project.get("project_id") or project.get("projectId") or ""),
        "scenario_id": str(project.get("scenarioId") or ""),
        "project_source": project_source,
        "tables": {name: _table_shape(project, path) for name, path in TABLE_PATHS.items()},
    }
    output_path = Path(memory_path) if memory_path is not None else DEFAULT_MEMORY_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(memory, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return memory


def explain_project(project: dict[str, Any], *, memory: dict[str, Any] | None = None) -> dict[str, Any]:
    if memory is None:
        memory = {"tables": {name: _table_shape(project, path) for name, path in TABLE_PATHS.items()}}
    return {
        "任务": _explain_tasks(project, memory),
        "装备": _explain_equipment(project, memory),
        "保障组织": _explain_support_organization(project, memory),
        "保障活动": _explain_support_activities(project, memory),
    }


def compile_project_json_to_aircraft_support_inputs(
    project: dict[str, Any],
    *,
    runtime_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runtime = runtime_config or {}
    mission_profile = _dict(project.get("missionProfile"))
    duration_minutes = _positive_int(
        runtime.get("duration_minutes"),
        _duration_minutes(mission_profile.get("durationHours")),
    )
    sample_every = _positive_int(runtime.get("sample_every_minutes"), 30)
    seed = _positive_int(runtime.get("seed"), 0)
    aircraft_summary = _aircraft_summary(project)
    _validate_aircraft_pre_life_thresholds(project, aircraft_summary)
    products_by_id = _products_by_id(project)
    organization_graph = _organization_graph(project)
    canonical_organization = organization_graph["runtime_mode"] in {"vertical", "vertical_lateral"}
    support_nodes = _support_nodes(
        project,
        products_by_id,
        canonical_organization=canonical_organization,
    )
    default_activity_resource_id = _canonical_root_runtime_resource_id(
        organization_graph,
        support_nodes,
    )
    support_aliases = _support_node_aliases(project)
    job_definitions = _support_activity_job_definitions(project)
    basic_missions = _list(project.get("basicMissions"))
    activities = [
        _support_activity(
            activity,
            support_aliases,
            job_definitions,
            default_resource_id=default_activity_resource_id,
            canonical_organization=canonical_organization,
        )
        for activity in _list(project.get("supportActivities"))
    ]
    inputs = {
        "schema_version": "aircraft-support-v1-input-v0",
        "project_identity": {
            "project_id": str(project.get("project_id") or project.get("projectId") or "project"),
            "project_version": str(project.get("project_version") or project.get("projectVersion") or "project-v0.1"),
            "scenario_id": str(project.get("scenarioId") or project.get("project_id") or "scenario"),
            "source_import_id": _optional_string(mission_profile.get("sourceImportId")),
        },
        "mission_profile": {
            "profile_id": str(mission_profile.get("profileId") or mission_profile.get("id") or "mission-profile"),
            "name": str(mission_profile.get("name") or "mission profile"),
            "duration_minutes": duration_minutes,
            "basic_missions": _runtime_copy(basic_missions),
            "composite_tasks": _runtime_copy(_list(mission_profile.get("compositeTasks"))),
            "periodic_tasks": _runtime_copy(_list(mission_profile.get("periodicTasks"))),
            "mission_phases": _mission_phases(project, basic_missions),
            "airports": _runtime_airports(project.get("airports")),
        },
        "aircraft": {
            "fleet_count": aircraft_summary["fleet_count"],
            "initial_ready": aircraft_summary["initial_ready"],
            "models": aircraft_summary["models"],
            "assets": aircraft_summary["assets"],
        },
        "equipment_tree": {
            "root_component_id": _root_component_id(project.get("components")),
            "components": [_component(component, products_by_id) for component in _list(project.get("components"))],
        },
        "support_network": {
            "nodes": support_nodes,
            "organization_graph": organization_graph,
        },
        "support_activities": {"activities": activities},
        "time": {
            "duration_minutes": duration_minutes,
            "tick_minutes": 1,
            "sample_every_minutes": sample_every,
            "max_state_frames_single": _positive_int(runtime.get("max_state_frames_single"), 2000),
            "requested_steps": _positive_int(runtime.get("steps"), max(1, duration_minutes // max(1, sample_every))),
        },
        "monte_carlo": {"sample_count": _positive_int(runtime.get("samples"), 1), "sweep": {}},
        "seed": seed,
        "stop_policy": {
            "schema_version": "stop-policy-v0",
            "mode": "or",
            "conditions": [{"type": "duration", "duration_minutes": duration_minutes}],
            "defaulted": True,
        },
    }
    _strip_removed_mission_area_fields(inputs)
    return inputs


def run_aircraft_support_v1_project(
    project: dict[str, Any],
    *,
    repo_root: Path | str | None = None,
    runtime_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if repo_root is not None:
        root = str(Path(repo_root).resolve())
        if root not in sys.path:
            sys.path.insert(0, root)
    from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model

    inputs = compile_project_json_to_aircraft_support_inputs(project, runtime_config=runtime_config)
    model = AircraftSupportV1Model(inputs)
    output = model.run()
    return {
        "model_family": "aircraft_support_v1",
        "project_id": inputs["project_identity"]["project_id"],
        "scenario_id": inputs["project_identity"]["scenario_id"],
        "metrics": output["metrics"],
        "frames": output["frames"],
        "events": output["events"],
        "compiled_inputs": inputs,
    }


def _loads_object(payload_json: str) -> dict[str, Any]:
    payload = json.loads(payload_json or "{}")
    if not isinstance(payload, dict):
        raise ValueError("payload_json must decode to an object")
    return payload


def _project_name(project: dict[str, Any]) -> str:
    project_info = _dict(project.get("projectInfo"))
    mission_profile = _dict(project.get("missionProfile"))
    return str(project_info.get("name") or mission_profile.get("name") or project.get("project_id") or "")


def _table_shape(project: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    rows = _values_at_path(project, path)
    if isinstance(rows, dict):
        records = [rows]
    elif isinstance(rows, list):
        records = [item for item in rows if isinstance(item, dict)]
    else:
        records = []
    fields: dict[str, dict[str, Any]] = {}
    for record in records:
        for key, value in record.items():
            field = fields.setdefault(key, {"types": [], "example": None})
            value_type = type(value).__name__
            if value_type not in field["types"]:
                field["types"].append(value_type)
            if field["example"] is None and value not in (None, "", [], {}):
                field["example"] = copy.deepcopy(value)
    return {"row_count": len(records), "fields": fields}


def _values_at_path(value: Any, path: tuple[str, ...]) -> Any:
    if not path:
        return value
    head, *tail = path
    if head == "*":
        result = []
        for item in value if isinstance(value, list) else []:
            child = _values_at_path(item, tuple(tail))
            if isinstance(child, list):
                result.extend(child)
            elif child not in (None, "", [], {}):
                result.append(child)
        return result
    if isinstance(value, dict):
        return _values_at_path(value.get(head), tuple(tail))
    return None


def _explain_tasks(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    profile = _dict(project.get("missionProfile"))
    rows = []
    for mission in _list(project.get("basicMissions")):
        rows.append(
            {
                "id": mission.get("id") or mission.get("missionId"),
                "name": mission.get("name") or mission.get("basicTaskName"),
                "equipment": mission.get("equipmentType") or mission.get("aircraftModel"),
                "duration_minutes": mission.get("taskDurationMinutes"),
            }
        )
    for composite in _list(profile.get("compositeTasks")):
        rows.append(
            {
                "id": composite.get("id"),
                "name": composite.get("name"),
                "task_items": len(_list(composite.get("taskItems"))),
                "kind": "composite",
            }
        )
    for periodic in _list(profile.get("periodicTasks")):
        rows.append(
            {
                "id": periodic.get("id"),
                "name": periodic.get("periodicTaskName") or periodic.get("name"),
                "period_days": periodic.get("periodDays"),
                "kind": "periodic",
            }
        )
    return {
        "row_count": len(rows),
        "tables": _memory_tables(
            memory,
            (
                "missionProfile",
                "basicMissions",
                "basicMissions.missionPhases",
                "missionProfile.compositeTasks",
                "missionProfile.periodicProfileLists",
                "missionProfile.periodicTasks",
            ),
        ),
        "rows": rows,
    }


def _explain_equipment(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for product in _list(project.get("products")):
        rows.append(
            {
                "kind": "product",
                "id": product.get("id"),
                "name": product.get("name"),
                "model": product.get("model"),
                "product_kind": product.get("kind"),
            }
        )
    for member in _list(_dict(project.get("combatUnit")).get("members")):
        rows.append({"kind": "aircraft", "id": member.get("aircraftNo"), "model": member.get("model"), "status": member.get("status")})
    for component in _list(project.get("components")):
        rows.append(
            {
                "kind": "component",
                "id": component.get("id"),
                "name": component.get("name"),
                "parent_id": component.get("parentId"),
                "product_id": component.get("productId"),
                "aircraft_model": component.get("aircraftModel"),
                "failure_distribution": component.get("failureDistribution"),
            }
        )
    return {"row_count": len(rows), "tables": _memory_tables(memory, ("combatUnit.members", "products", "components")), "rows": rows}


def _explain_support_organization(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for node in _list(project.get("supportNodes")):
        rows.append(
            {
                "kind": "support_node",
                "id": node.get("id"),
                "name": node.get("name"),
                "personnel_capacity": node.get("personnelCapacity"),
                "equipment_capacity": node.get("equipmentCapacity"),
                "inventory": node.get("inventory"),
            }
        )
    for resource in _list(project.get("supportResources")):
        rows.append(
            {
                "kind": "resource",
                "id": resource.get("id"),
                "name": resource.get("name"),
                "node": resource.get("supportNodeName") or resource.get("supportNodeId"),
                "type": resource.get("type"),
                "product_id": resource.get("productId"),
                "quantity": resource.get("quantity"),
            }
        )
    return {
        "row_count": len(rows),
        "tables": _memory_tables(
            memory,
            ("supportNodes", "supportNodes.transportPolicies", "supportResources", "supportOrganization", "transportPolicies"),
        ),
        "rows": rows,
    }


def _explain_support_activities(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    rows = []
    job_definitions = _support_activity_job_definitions(project)
    for activity in _list(project.get("supportActivities")):
        jobs = _activity_jobs(activity, job_definitions)
        rows.append(
            {
                "id": activity.get("id"),
                "name": activity.get("name") or activity.get("activityName"),
                "type": activity.get("activityType"),
                "resource_id": activity.get("resourceId"),
                "job_count": len(jobs),
                "duration_hours": activity.get("durationHours"),
            }
        )
        for job in jobs:
            rows.append(
                {
                    "kind": "job",
                    "activity_id": activity.get("id"),
                    "id": job.get("id") or job.get("activityCode"),
                    "name": job.get("workName") or job.get("name"),
                    "predecessors": job.get("predecessors") or [],
                }
            )
    return {
        "row_count": len(rows),
        "tables": _memory_tables(memory, ("supportActivities", "supportActivityJobs", "supportActivities.jobs")),
        "rows": rows,
    }


def _memory_tables(memory: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any]:
    tables = _dict(memory.get("tables"))
    return {name: tables.get(name, {}) for name in names}


def _aircraft_summary(project: dict[str, Any]) -> dict[str, Any]:
    combat_unit = _dict(project.get("combatUnit")) or _dict(_dict(project.get("missionProfile")).get("combatUnit"))
    members = _list(combat_unit.get("members"))
    components = _list(project.get("components"))
    fleet_count = len(members) or _positive_int(combat_unit.get("quantity"), _root_component_quantity(components) or 1)
    models = _unique(
        [member.get("model") for member in members]
        + [component.get("aircraftModel") for component in components]
        + [project.get("equipment", {}).get("model") if isinstance(project.get("equipment"), dict) else None]
    ) or ["Aircraft"]
    assets = []
    for index, member in enumerate(members[:fleet_count]):
        status = str(member.get("status") or "").lower()
        initial_state = "maintenance" if any(token in status for token in ("维修", "故障", "maintenance", "failed")) else "available"
        assets.append(
            {
                "tail_number": str(member.get("aircraftNo") or member.get("tailNumber") or f"AC-{index + 1:03d}"),
                "aircraft_type": str(member.get("model") or models[0]),
                "model": str(member.get("model") or models[0]),
                "initial_state": initial_state,
                "airport": str(member.get("airport") or ""),
                "airport_id": str(member.get("airportId") or member.get("baseAirportId") or ""),
                "initial_life_state": _aircraft_initial_life_state(member, index),
            }
        )
    initial_ready = sum(1 for asset in assets if asset["initial_state"] == "available") if assets else fleet_count
    return {"fleet_count": fleet_count, "initial_ready": min(initial_ready, fleet_count), "models": models, "assets": assets}


def _aircraft_initial_life_state(member: dict[str, Any], index: int) -> dict[str, int | float]:
    values = {
        "calendar_days": member.get("preLifeCalendarDays", 0),
        "flight_hours": member.get("preLifeFlightHours", 0),
        "takeoff_landing_cycles": member.get("preLifeTakeoffLandingCount", 0),
    }
    for field, value in values.items():
        path_field = {
            "calendar_days": "preLifeCalendarDays",
            "flight_hours": "preLifeFlightHours",
            "takeoff_landing_cycles": "preLifeTakeoffLandingCount",
        }[field]
        is_number = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        integer_required = field != "flight_hours"
        if not is_number or value < 0 or (integer_required and not isinstance(value, int)):
            raise ValueError(f"combatUnit.members[{index}].{path_field} must be a non-negative finite {'integer' if integer_required else 'number'}")
    return values


def _validate_aircraft_pre_life_thresholds(project: dict[str, Any], summary: dict[str, Any]) -> None:
    components = {str(item.get("id") or ""): item for item in _list(project.get("components"))}
    known_models = set(summary["models"])
    preventive = []
    interval_specs = (
        ("calendarDayInterval", "calendar_days"),
        ("runHourInterval", "flight_hours"),
        ("takeoffLandingInterval", "takeoff_landing_cycles"),
    )
    for index, activity in enumerate(_list(project.get("supportActivities"))):
        text = f"{activity.get('planType', '')} {activity.get('activityType', '')}".lower()
        if "预防性维修" not in text and "preventive" not in text:
            continue
        preventive.append((index, activity))
        model = str(activity.get("aircraftModel") or "")
        equipment_id = str(activity.get("equipmentId") or "")
        if model and model not in known_models:
            raise ValueError(f"supportActivities[{index}].aircraftModel references unknown model {model}")
        if equipment_id and equipment_id not in components:
            raise ValueError(f"supportActivities[{index}].equipmentId references unknown component {equipment_id}")
        component_model = str(components.get(equipment_id, {}).get("aircraftModel") or "")
        if model and component_model and model != component_model:
            raise ValueError(f"supportActivities[{index}].equipmentId conflicts with aircraftModel")
        for threshold_field, _life_field in interval_specs:
            value = activity.get(threshold_field)
            if value is None:
                continue
            integer_required = threshold_field != "runHourInterval"
            valid = (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and value >= 0
                and (not integer_required or isinstance(value, int))
            )
            if not valid:
                raise ValueError(f"supportActivities[{index}].{threshold_field} must be a non-negative finite threshold")
    for member_index, asset in enumerate(summary["assets"]):
        model = asset["model"]
        applicable = []
        for activity_index, activity in preventive:
            equipment_id = str(activity.get("equipmentId") or "")
            scoped_model = str(activity.get("aircraftModel") or components.get(equipment_id, {}).get("aircraftModel") or "")
            if not scoped_model or scoped_model == model:
                applicable.append((activity_index, activity))
        thresholds: dict[str, int | float] = {}
        threshold_sources: dict[str, list[dict[str, str]]] = {}
        due_dimensions: list[str] = []
        for threshold_field, life_field in interval_specs:
            enabled = [
                (index, activity[threshold_field])
                for index, activity in applicable
                if isinstance(activity.get(threshold_field), (int, float))
                and not isinstance(activity.get(threshold_field), bool)
                and math.isfinite(activity[threshold_field])
                and activity[threshold_field] > 0
            ]
            if len({float(value) for _index, value in enabled}) > 1:
                raise ValueError(f"supportActivities[{enabled[-1][0]}].{threshold_field} conflicts for model {model}")
            threshold = enabled[0][1] if enabled else 0
            thresholds[life_field] = threshold
            threshold_sources[life_field] = [
                {
                    "activity_id": str(activity.get("id") or ""),
                    "equipment_id": str(activity.get("equipmentId") or ""),
                }
                for _index, activity in applicable
                if isinstance(activity.get(threshold_field), (int, float))
                and not isinstance(activity.get(threshold_field), bool)
                and activity[threshold_field] > 0
            ]
            if asset["initial_life_state"][life_field] <= 0:
                continue
            if not enabled:
                canonical = {
                    "calendar_days": "preLifeCalendarDays",
                    "flight_hours": "preLifeFlightHours",
                    "takeoff_landing_cycles": "preLifeTakeoffLandingCount",
                }[life_field]
                raise ValueError(f"combatUnit.members[{member_index}].{canonical} has no enabled {threshold_field}")
            if asset["initial_life_state"][life_field] >= threshold:
                due_dimensions.append(life_field)
        asset["source_initial_state"] = asset["initial_state"]
        asset["preventive_thresholds"] = thresholds
        asset["preventive_threshold_sources"] = threshold_sources
        asset["initial_due_dimensions"] = due_dimensions
        asset["initial_preventive_due"] = bool(due_dimensions)
        if due_dimensions:
            asset["initial_state"] = "maintenance"
    summary["initial_ready"] = sum(1 for asset in summary["assets"] if asset["initial_state"] == "available")


def _support_nodes(
    project: dict[str, Any],
    products_by_id: dict[str, dict[str, Any]],
    *,
    canonical_organization: bool = False,
) -> list[dict[str, Any]]:
    aliases = _support_node_aliases(project)
    product_names = {
        product_id: str(product.get("name") or product_id)
        for product_id, product in products_by_id.items()
    }
    product_ids_by_label = {
        str(label).strip(): product_id
        for product_id, product in products_by_id.items()
        for label in (product_id, product.get("name"), product.get("model"))
        if str(label or "").strip()
    }
    nodes_by_name: dict[str, dict[str, Any]] = {}
    for raw in _list(project.get("supportNodes")):
        name = _support_node_name(raw)
        has_aggregated_resources = bool(_list(project.get("supportResources"))) and not any(
            field in raw for field in ("capacity", "personnelCapacity", "equipmentCapacity", "inventory")
        )
        default_capacity = 0 if canonical_organization or has_aggregated_resources else 1
        nodes_by_name[name] = {
            "id": name,
            "name": name,
            "organization_node_id": str(raw.get("organizationNodeId") or ""),
            "personnel_capacity": _non_negative_int(
                raw.get("personnelCapacity"),
                _non_negative_int(raw.get("capacity"), default_capacity),
            ),
            "equipment_capacity": _non_negative_int(
                raw.get("equipmentCapacity"),
                _non_negative_int(raw.get("capacity"), default_capacity),
            ),
            "inventory": {
                product_ids_by_label.get(str(key).strip(), str(key)): copy.deepcopy(quantity)
                for key, quantity in _dict(raw.get("inventory")).items()
            },
            "product_names": copy.deepcopy(product_names),
            "transport_policies": [],
        }
    for resource in _list(project.get("supportResources")):
        node_name = aliases.get(
            str(
                resource.get("organizationNodeId")
                or resource.get("supportNodeName")
                or resource.get("supportNodeId")
                or ""
            ),
            "",
        )
        if not node_name:
            continue
        node = nodes_by_name.setdefault(node_name, {"id": node_name, "name": node_name, "organization_node_id": "", "personnel_capacity": 0, "equipment_capacity": 0, "inventory": {}, "product_names": copy.deepcopy(product_names), "transport_policies": []})
        if resource.get("organizationNodeId") not in (None, ""):
            node["organization_node_id"] = str(resource["organizationNodeId"])
        quantity = _non_negative_int(resource.get("quantity"), 0)
        resource_type = str(resource.get("type") or "").lower()
        if resource_type == "personnel":
            node["personnel_capacity"] += quantity
        elif resource_type == "equipment":
            node["equipment_capacity"] += quantity
        elif resource_type == "spare":
            product_id = str(resource.get("productId") or "").strip()
            if product_id:
                node["inventory"][product_id] = node["inventory"].get(product_id, 0) + quantity
                node["product_names"][product_id] = product_names.get(product_id, str(resource.get("name") or product_id))
    for policy in _list(project.get("transportPolicies")):
        normalized = _transport_policy(policy, aliases)
        destination = str(normalized.get("to") or "")
        if destination in nodes_by_name:
            nodes_by_name[destination]["transport_policies"].append(normalized)
    for raw in _list(project.get("supportNodes")):
        node_name = _support_node_name(raw)
        for policy in _list(raw.get("transportPolicies")):
            normalized = _transport_policy(policy, aliases, default_node=node_name)
            if node_name in nodes_by_name:
                nodes_by_name[node_name]["transport_policies"].append(normalized)
    if not canonical_organization:
        for node in nodes_by_name.values():
            node["personnel_capacity"] = max(1, int(node.get("personnel_capacity", 0) or 0))
            node["equipment_capacity"] = max(1, int(node.get("equipment_capacity", 0) or 0))
    return list(nodes_by_name.values()) or [{"id": "support-node", "name": "support node", "organization_node_id": "", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {}, "product_names": copy.deepcopy(product_names), "transport_policies": []}]


def _canonical_root_runtime_resource_id(
    organization_graph: dict[str, Any],
    support_nodes: list[dict[str, Any]],
) -> str | None:
    if organization_graph.get("runtime_mode") not in {"vertical", "vertical_lateral"}:
        return None
    root_ids = [
        str(node.get("id") or "")
        for node in _list(organization_graph.get("nodes"))
        if node.get("parent_id") in (None, "") and node.get("id") not in (None, "")
    ]
    if len(root_ids) != 1:
        return None
    matches = [
        str(node.get("id") or "")
        for node in support_nodes
        if str(node.get("organization_node_id") or "") == root_ids[0] and node.get("id") not in (None, "")
    ]
    return matches[0] if len(matches) == 1 else None


def _organization_graph(project: dict[str, Any]) -> dict[str, Any]:
    organization = _dict(project.get("supportOrganization"))
    root = organization.get("tree")
    nodes: list[dict[str, Any]] = []
    parent_edges: list[dict[str, str]] = []

    def visit(node: Any, parent_id: str | None = None) -> None:
        if not isinstance(node, dict):
            return
        node_id = str(node.get("id") or "")
        scope = _dict(node.get("serviceScope"))
        nodes.append({
            "id": node_id,
            "name": str(node.get("name") or node_id),
            "parent_id": parent_id,
            "service_scope": {
                "airport_ids": sorted(_unique(_list(scope.get("airportIds")))),
                "aircraft_models": sorted(_unique(_list(scope.get("aircraftModels")))),
                "product_ids": sorted(_unique(_list(scope.get("productIds")))),
                "resource_types": sorted(_unique(_list(scope.get("resourceTypes")))),
            },
        })
        if parent_id is not None:
            parent_edges.append({"from_node_id": parent_id, "to_node_id": node_id})
        for child in _list(node.get("children")):
            visit(child, node_id)

    visit(root)
    lateral_edges = [
        {
            "id": str(relation.get("id") or ""),
            "from_node_id": str(relation.get("fromOrganizationNodeId") or ""),
            "to_node_id": str(relation.get("toOrganizationNodeId") or ""),
            "priority": _positive_int(relation.get("priority"), 1),
            "enabled": relation.get("enabled", True) is True,
        }
        for relation in _list(organization.get("relations"))
        if isinstance(relation, dict)
    ]
    resource_ownership = [
        {
            "resource_id": str(resource.get("id") or ""),
            "resource_type": str(resource.get("type") or ""),
            "organization_node_id": str(resource.get("organizationNodeId") or ""),
        }
        for resource in _list(project.get("supportResources"))
        if isinstance(resource, dict)
    ]
    transport_policies = [
        {
            "id": str(policy.get("id") or ""),
            "from_organization_node_id": str(policy.get("fromOrganizationNodeId") or ""),
            "to_organization_node_id": str(policy.get("toOrganizationNodeId") or ""),
            "capacity": _positive_int(policy.get("capacity"), 1),
            "priority": _positive_int(policy.get("priority"), 1),
            "transport_time_hours": _non_negative_float(
                policy.get("transportTimeHours"),
                _non_negative_float(policy.get("transport_time_hours"), 0.0),
            ),
            **({"product_id": str(policy["productId"])} if policy.get("productId") not in (None, "") else {}),
        }
        for policy in _list(project.get("transportPolicies"))
        if isinstance(policy, dict)
    ]
    return {
        "runtime_mode": str(
            organization.get("runtimeMode")
            or ("vertical" if nodes else "legacy")
        ),
        "nodes": sorted(nodes, key=lambda item: item["id"]),
        "parent_edges": sorted(parent_edges, key=lambda item: (item["from_node_id"], item["to_node_id"])),
        "lateral_edges": sorted(lateral_edges, key=lambda item: item["id"]),
        "resource_ownership": sorted(resource_ownership, key=lambda item: item["resource_id"]),
        "transport_policies": sorted(transport_policies, key=lambda item: item["id"]),
    }


def _support_node_aliases(project: dict[str, Any]) -> dict[str, str]:
    aliases = {}
    for node in _list(project.get("supportNodes")):
        name = _support_node_name(node)
        for key in ("id", "name", "supportNodeId", "organizationNodeId"):
            if node.get(key) not in (None, ""):
                aliases[str(node[key])] = name
        aliases[name] = name
    for resource in _list(project.get("supportResources")):
        node_name = str(resource.get("supportNodeName") or "")
        if node_name:
            aliases[node_name] = node_name
    return aliases


def _support_node_name(node: dict[str, Any]) -> str:
    return str(node.get("name") or node.get("supportNodeName") or node.get("id") or "support-node")


def _transport_policy(policy: dict[str, Any], aliases: dict[str, str], default_node: str = "") -> dict[str, Any]:
    from_value = str(
        policy.get("fromOrganizationNodeId")
        or policy.get("fromSupportNodeName")
        or policy.get("fromSupportNodeId")
        or policy.get("from")
        or default_node
    )
    to_value = str(
        policy.get("toOrganizationNodeId")
        or policy.get("toSupportNodeName")
        or policy.get("toSupportNodeId")
        or policy.get("to")
        or default_node
    )
    return {
        "from": aliases.get(from_value, from_value),
        "to": aliases.get(to_value, to_value),
        "productId": str(policy.get("productId") or ""),
        "capacity": _positive_int(policy.get("capacity"), 1),
        "priority": _positive_int(policy.get("priority"), 1),
        "transportTimeHours": _non_negative_float(policy.get("transportTimeHours"), _non_negative_float(policy.get("transport_time_hours"), 0.0)),
    }


def _mission_phases(project: dict[str, Any], basic_missions: list[Any]) -> list[dict[str, Any]]:
    phases: list[dict[str, Any]] = []
    for mission in basic_missions:
        if not isinstance(mission, dict):
            continue
        mission_id = str(mission.get("id") or mission.get("missionId") or mission.get("name") or "").strip()
        for phase in _list(mission.get("missionPhases")):
            if not isinstance(phase, dict):
                continue
            row = copy.deepcopy(phase)
            if mission_id and row.get("basicMissionId") in (None, ""):
                row["basicMissionId"] = mission_id
            phases.append(row)
    if phases:
        return _runtime_copy(phases)
    return _runtime_copy(_list(project.get("missionPhases")))


def _support_activity(
    activity: dict[str, Any],
    aliases: dict[str, str],
    job_definitions: dict[str, dict[str, Any]],
    *,
    default_resource_id: str | None = None,
    canonical_organization: bool = False,
) -> dict[str, Any]:
    resource_id = str(activity.get("resourceId") or activity.get("supportNodeId") or "")
    if not resource_id and default_resource_id:
        resource_id = default_resource_id
    if not resource_id and canonical_organization:
        raise ValueError(
            "supportActivities[].resourceId is required unless the organization root uniquely maps one runtime node"
        )
    maintenance_plan = _maintenance_method_plan(activity)
    compiled = {
        "id": str(activity.get("id") or "support-activity"),
        "name": str(activity.get("name") or activity.get("activityName") or activity.get("id") or "support activity"),
        "activity_type": str(activity.get("activityType") or activity.get("planType") or "support activity"),
        "resource_id": (
            aliases.get(resource_id, resource_id)
            if resource_id
            else next(iter(aliases.values()), "support-node")
        ),
        "priority": _positive_int(activity.get("priority"), 1),
        "duration_minutes": _positive_int(activity.get("durationMinutes"), _positive_int(activity.get("durationHours"), 1) * 60),
        "required_personnel": _positive_int(activity.get("requiredPersonnel"), 1),
        "required_devices": _positive_int(activity.get("requiredDevices"), 1),
        "spare_quantity": _non_negative_int(activity.get("spareQuantity"), 0),
        "calendarDayInterval": activity.get("calendarDayInterval"),
        "runHourInterval": activity.get("runHourInterval"),
        "takeoffLandingInterval": activity.get("takeoffLandingInterval"),
        "floatRatio": activity.get("floatRatio"),
        "aircraft_model": str(activity.get("aircraftModel") or ""),
        "equipment_id": str(activity.get("equipmentId") or ""),
        "jobs": [_support_job(job, activity) for job in _activity_jobs(activity, job_definitions)],
    }
    if maintenance_plan is not None:
        maintenance_methods, replacement_ratio = maintenance_plan
        compiled.update(
            {
                "maintenance_methods": maintenance_methods,
                "replacement_ratio": replacement_ratio,
                "maintenance_plan_source": {
                    "activity_id": str(activity.get("id") or "support-activity"),
                    "aircraft_model": str(activity.get("aircraftModel") or ""),
                    "equipment_id": str(activity.get("equipmentId") or ""),
                },
            }
        )
    return compiled


def _maintenance_method_plan(activity: dict[str, Any]) -> tuple[list[str], float] | None:
    plan_type = str(activity.get("planType") or "").strip()
    activity_type = str(activity.get("activityType") or "").strip()
    activity_contract = f"{plan_type} {activity_type}".lower()
    is_corrective = plan_type == "修复性维修方案" or "corrective" in activity_contract or "修复性维修" in activity_contract
    is_preventive = plan_type == "预防性维修方案" or "preventive" in activity_contract or "预防性维修" in activity_contract
    is_maintenance = is_corrective or is_preventive
    has_methods = "maintenanceMethods" in activity
    has_ratio = "replacementRatio" in activity
    has_legacy = "repairType" in activity
    if not is_maintenance:
        if has_methods or has_ratio or has_legacy:
            raise ValueError("maintenance method fields are only valid on corrective or preventive activities")
        return None
    if has_methods != has_ratio:
        raise ValueError("maintenanceMethods and replacementRatio must appear together")
    legacy = {
        "原位维修": (["non_replacement"], 0.0),
        "换件维修": (["replacement"], 1.0),
    }
    if has_legacy:
        if not is_corrective:
            raise ValueError("legacy repairType migration is only supported for corrective maintenance")
        legacy_value = str(activity.get("repairType") or "").strip()
        if legacy_value not in legacy:
            raise ValueError(f"unsupported legacy repairType: {legacy_value}")
        legacy_methods, legacy_ratio = legacy[legacy_value]
        if not has_methods:
            methods, ratio = legacy_methods, legacy_ratio
        else:
            methods, ratio = activity.get("maintenanceMethods"), activity.get("replacementRatio")
            if methods != legacy_methods or ratio != legacy_ratio:
                raise ValueError("legacy repairType conflicts with canonical maintenance fields")
    elif not has_methods:
        methods, ratio = ["non_replacement"], 0.0
    else:
        methods, ratio = activity.get("maintenanceMethods"), activity.get("replacementRatio")
    allowed = {"non_replacement", "replacement"}
    if (
        not isinstance(methods, list)
        or not 1 <= len(methods) <= 2
        or any(not isinstance(method, str) or method not in allowed for method in methods)
        or len(set(methods)) != len(methods)
    ):
        raise ValueError("maintenanceMethods must contain one or both canonical values without duplicates")
    if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not math.isfinite(float(ratio)) or not 0 <= float(ratio) <= 1:
        raise ValueError("replacementRatio must be a finite number between 0 and 1")
    normalized_ratio = float(ratio)
    if methods == ["non_replacement"] and normalized_ratio != 0:
        raise ValueError("non_replacement-only activities require replacementRatio 0")
    if methods == ["replacement"] and normalized_ratio != 1:
        raise ValueError("replacement-only activities require replacementRatio 1")
    try:
        decimal_ratio = Decimal(str(ratio))
    except (InvalidOperation, ValueError):
        decimal_ratio = Decimal("NaN")
    if not decimal_ratio.is_finite() or decimal_ratio != decimal_ratio.quantize(Decimal("0.0001")):
        raise ValueError("replacementRatio must have at most four decimal places")
    return list(methods), normalized_ratio


def _support_activity_job_definitions(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    definitions: dict[str, dict[str, Any]] = {}
    for job in _list(project.get("supportActivityJobs")):
        code = str(job.get("activityCode") or job.get("id") or "")
        if code:
            definitions[code] = _runtime_copy(job)
    return definitions


def _activity_jobs(activity: dict[str, Any], job_definitions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    jobs = [_runtime_copy(job) for job in _list(activity.get("jobs"))]
    if jobs:
        return jobs
    predecessors = _dict(activity.get("predecessors"))
    resolved: list[dict[str, Any]] = []
    for code in _list(activity.get("activityCodes")):
        code_text = str(code)
        job = copy.deepcopy(job_definitions.get(code_text, {"activityCode": code_text}))
        job["activityCode"] = str(job.get("activityCode") or code_text)
        job["predecessors"] = list(predecessors.get(code_text) or job.get("predecessors") or [])
        resolved.append(job)
    return resolved


def _support_job(job: dict[str, Any], activity: dict[str, Any]) -> dict[str, Any]:
    return {
        **_runtime_copy(job),
        "activityCode": str(job.get("activityCode") or job.get("id") or "job"),
        "workName": str(job.get("workName") or job.get("name") or activity.get("name") or activity.get("id") or "job"),
        "durationMinutes": _positive_int(job.get("durationMinutes"), _positive_int(activity.get("durationMinutes"), _positive_int(activity.get("durationHours"), 1) * 60)),
        "predecessors": list(job.get("predecessors") or []),
    }


def _products_by_id(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(product.get("id")): copy.deepcopy(product)
        for product in _list(project.get("products"))
        if product.get("id") not in (None, "")
    }


def _component(
    component: dict[str, Any],
    products_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    failure_distribution = copy.deepcopy(_dict(component.get("failureDistribution")))
    product_id = str(component.get("productId") or "")
    product = products_by_id.get(product_id, {})
    return {
        "id": str(component.get("id") or "component"),
        "name": str(component.get("name") or component.get("id") or "component"),
        "parent_id": _optional_string(component.get("parentId")),
        "aircraft_model": _optional_string(component.get("aircraftModel")),
        "product_id": product_id,
        "product_name": str(product.get("name") or component.get("name") or product_id),
        "product_type": _optional_string(component.get("productType")),
        "quantity": _positive_int(component.get("quantity"), 1),
        "failure_rate": _component_failure_rate(failure_distribution),
        "failure_distribution": failure_distribution,
        "k_out_of_n": copy.deepcopy(_dict(component.get("kOutOfN"))),
        "special_repair_profile": copy.deepcopy(_dict(component.get("specialRepairProfile"))),
    }


def _component_failure_rate(distribution: dict[str, Any]) -> float:
    parameters = distribution.get("parameters") or distribution.get("params")
    multiplier = _non_negative_float(distribution.get("_rate_multiplier"), 1.0)
    if isinstance(parameters, (int, float)) and not isinstance(parameters, bool):
        return max(0.0, float(parameters)) * multiplier
    if not isinstance(parameters, str):
        return 0.0
    values = _distribution_parameters(parameters)
    distribution_type = str(distribution.get("distributionType") or distribution.get("distribution_type") or "").lower()
    if "lambda" in values or "λ" in values or "rate" in values or "failure_rate" in values:
        return (
            values.get("lambda")
            or values.get("λ")
            or values.get("rate")
            or values.get("failure_rate")
            or 0.0
        ) * multiplier
    if "weibull" in distribution_type or "威布尔" in distribution_type:
        beta = values.get("beta") or values.get("shape") or 1.0
        eta = values.get("eta") or values.get("scale") or values.get("mean")
        if eta and eta > 0:
            mean_time = eta * math.gamma(1.0 + 1.0 / max(beta, 0.001))
            return (1.0 / mean_time) * multiplier
    if "normal" in distribution_type or "正态" in distribution_type:
        mean = values.get("mean") or values.get("mu")
        if mean and mean > 0:
            return (1.0 / mean) * multiplier
    return 0.0


def _distribution_parameters(parameters: str) -> dict[str, float]:
    text = parameters.replace("，", ",").replace("；", ",").replace(";", ",")
    values: dict[str, float] = {}
    for item in text.split(","):
        if "=" not in item:
            continue
        key, value = [part.strip().lower() for part in item.split("=", 1)]
        values[key] = _non_negative_float(value, 0.0)
    return values


def _runtime_copy(value: Any) -> Any:
    copied = copy.deepcopy(value)
    _strip_removed_mission_area_fields(copied)
    return copied


def _strip_removed_mission_area_fields(value: Any) -> None:
    if isinstance(value, dict):
        for key in list(value):
            if key in REMOVED_MISSION_AREA_KEYS:
                value.pop(key, None)
                continue
            _strip_removed_mission_area_fields(value[key])
    elif isinstance(value, list):
        for item in value:
            _strip_removed_mission_area_fields(item)


def _runtime_airports(value: Any) -> list[dict[str, Any]]:
    airports = []
    for item in _list(value):
        if isinstance(item, dict):
            airports.append(copy.deepcopy(item))
        else:
            airports.append({"id": str(item), "name": str(item)})
    return airports


def _root_component_id(components: Any) -> str | None:
    for component in _list(components):
        if component.get("parentId") in (None, "") and component.get("id") not in (None, ""):
            return str(component["id"])
    return None


def _root_component_quantity(components: list[dict[str, Any]]) -> int | None:
    for component in components:
        if component.get("parentId") in (None, "") and component.get("quantity") not in (None, ""):
            return _positive_int(component.get("quantity"), 1)
    return None


def _duration_minutes(duration_hours: Any) -> int:
    return max(1, int(round(_non_negative_float(duration_hours, 24.0) * 60)))


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _unique(values: list[Any]) -> list[str]:
    result = []
    seen = set()
    for value in values:
        if value in (None, ""):
            continue
        item = str(value)
        if item not in seen:
            result.append(item)
            seen.add(item)
    return result


def _optional_string(value: Any) -> str | None:
    return None if value in (None, "") else str(value)


def _optional_positive_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    number = _non_negative_float(value, -1.0)
    return number if number >= 0 else None


def _positive_int(value: Any, default: int) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return max(1, int(default))
    return max(1, number)


def _non_negative_int(value: Any, default: int) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return max(0, int(default))
    return max(0, number)


def _non_negative_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return max(0.0, float(default))
    return max(0.0, number)


def _read_project(path: Path | str) -> dict[str, Any]:
    return _loads_object(Path(path).read_text(encoding="utf-8"))


def _write_json(payload: dict[str, Any], output: Path | None) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if output is None:
        print(encoded, end="")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone aircraft_support_v1 Project JSON helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list-projects")
    list_parser.add_argument("--db", required=True, type=Path)

    get_parser = subparsers.add_parser("get-project")
    get_parser.add_argument("--db", required=True, type=Path)
    get_parser.add_argument("--project-id", required=True)
    get_parser.add_argument("--output", type=Path)

    remember_parser = subparsers.add_parser("remember-structure")
    remember_parser.add_argument("--project-json", required=True, type=Path)
    remember_parser.add_argument("--memory", type=Path, default=DEFAULT_MEMORY_PATH)

    explain_parser = subparsers.add_parser("explain")
    explain_parser.add_argument("--project-json", required=True, type=Path)
    explain_parser.add_argument("--memory", type=Path)
    explain_parser.add_argument("--output", type=Path)

    save_template_parser = subparsers.add_parser("save-template")
    save_template_parser.add_argument("--db", required=True, type=Path)
    save_template_parser.add_argument("--project-json", required=True, type=Path)
    save_template_parser.add_argument("--template-id", required=True)
    save_template_parser.add_argument("--template-name")
    save_template_parser.add_argument("--scenario-id")
    save_template_parser.add_argument("--replace", action="store_true")

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--project-json", required=True, type=Path)
    run_parser.add_argument("--repo-root", type=Path)
    run_parser.add_argument("--duration-minutes", type=int, default=120)
    run_parser.add_argument("--sample-every-minutes", type=int, default=30)
    run_parser.add_argument("--seed", type=int, default=0)
    run_parser.add_argument("--output", type=Path)

    args = parser.parse_args(argv)
    if args.command == "list-projects":
        _write_json({"projects": list_backend_projects(args.db)}, None)
        return 0
    if args.command == "get-project":
        _write_json(load_backend_project(args.db, args.project_id), args.output)
        return 0
    if args.command == "remember-structure":
        project = _read_project(args.project_json)
        _write_json(remember_project_structure(project, memory_path=args.memory, project_source=str(args.project_json)), None)
        return 0
    if args.command == "explain":
        project = _read_project(args.project_json)
        memory = _loads_object(args.memory.read_text(encoding="utf-8")) if args.memory else None
        _write_json(explain_project(project, memory=memory), args.output)
        return 0
    if args.command == "save-template":
        project = _read_project(args.project_json)
        try:
            saved = save_project_template(
                args.db,
                project,
                template_id=args.template_id,
                template_name=args.template_name,
                scenario_id=args.scenario_id,
                replace=args.replace,
            )
        except (KeyError, ValueError, sqlite3.Error) as exc:
            print(str(exc), file=sys.stderr)
            return 1
        _write_json(saved, None)
        return 0
    if args.command == "run":
        project = _read_project(args.project_json)
        result = run_aircraft_support_v1_project(
            project,
            repo_root=args.repo_root,
            runtime_config={
                "duration_minutes": args.duration_minutes,
                "sample_every_minutes": args.sample_every_minutes,
                "seed": args.seed,
            },
        )
        _write_json(result, args.output)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
