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
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


DEFAULT_MEMORY_PATH = Path.home() / ".codex" / "memory" / "aircraft-support-v1-project-schema.json"
TABLE_PATHS = {
    "missionProfile": ("missionProfile",),
    "basicMissions": ("basicMissions",),
    "missionProfile.compositeTasks": ("missionProfile", "compositeTasks"),
    "missionProfile.periodicTasks": ("missionProfile", "periodicTasks"),
    "components": ("components",),
    "combatUnit.members": ("combatUnit", "members"),
    "supportNodes": ("supportNodes",),
    "supportNodes.transportPolicies": ("supportNodes", "*", "transportPolicies"),
    "supportResources": ("supportResources",),
    "supportOrganization": ("supportOrganization",),
    "transportPolicies": ("transportPolicies",),
    "supportActivities": ("supportActivities",),
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
    support_nodes = _support_nodes(project)
    support_aliases = _support_node_aliases(project)
    activities = [_support_activity(activity, support_aliases) for activity in _list(project.get("supportActivities"))]
    return {
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
            "basic_missions": copy.deepcopy(_list(project.get("basicMissions"))),
            "composite_tasks": copy.deepcopy(_list(mission_profile.get("compositeTasks"))),
            "periodic_tasks": copy.deepcopy(_list(mission_profile.get("periodicTasks"))),
            "mission_phases": copy.deepcopy(_list(project.get("missionPhases"))),
            "airports": _runtime_airports(project.get("airports")),
            "mission_areas": copy.deepcopy(_list(project.get("missionAreas"))),
        },
        "aircraft": {
            "fleet_count": aircraft_summary["fleet_count"],
            "initial_ready": aircraft_summary["initial_ready"],
            "models": aircraft_summary["models"],
            "assets": aircraft_summary["assets"],
        },
        "equipment_tree": {
            "root_component_id": _root_component_id(project.get("components")),
            "components": [_component(component) for component in _list(project.get("components"))],
        },
        "support_network": {"nodes": support_nodes},
        "support_activities": {"activities": activities},
        "reliability_block_diagram": copy.deepcopy(_dict(project.get("reliabilityBlockDiagram"))),
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
    return {"row_count": len(rows), "tables": _memory_tables(memory, ("missionProfile", "basicMissions", "missionProfile.compositeTasks", "missionProfile.periodicTasks")), "rows": rows}


def _explain_equipment(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for member in _list(_dict(project.get("combatUnit")).get("members")):
        rows.append({"kind": "aircraft", "id": member.get("aircraftNo"), "model": member.get("model"), "status": member.get("status")})
    for component in _list(project.get("components")):
        rows.append(
            {
                "kind": "component",
                "id": component.get("id"),
                "name": component.get("name"),
                "parent_id": component.get("parentId"),
                "aircraft_model": component.get("aircraftModel"),
                "failure_rate": component.get("failureRate"),
            }
        )
    return {"row_count": len(rows), "tables": _memory_tables(memory, ("combatUnit.members", "components", "reliabilityBlockDiagram.nodes", "reliabilityBlockDiagram.edges")), "rows": rows}


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
    for activity in _list(project.get("supportActivities")):
        jobs = _list(activity.get("jobs"))
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
    return {"row_count": len(rows), "tables": _memory_tables(memory, ("supportActivities", "supportActivities.jobs")), "rows": rows}


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
                "model": str(member.get("model") or models[0]),
                "initial_state": initial_state,
            }
        )
    initial_ready = sum(1 for asset in assets if asset["initial_state"] == "available") if assets else fleet_count
    return {"fleet_count": fleet_count, "initial_ready": min(initial_ready, fleet_count), "models": models, "assets": assets}


def _support_nodes(project: dict[str, Any]) -> list[dict[str, Any]]:
    aliases = _support_node_aliases(project)
    nodes_by_name: dict[str, dict[str, Any]] = {}
    for raw in _list(project.get("supportNodes")):
        name = _support_node_name(raw)
        nodes_by_name[name] = {
            "id": name,
            "name": name,
            "personnel_capacity": _positive_int(raw.get("personnelCapacity"), _positive_int(raw.get("capacity"), 1)),
            "equipment_capacity": _positive_int(raw.get("equipmentCapacity"), _positive_int(raw.get("capacity"), 1)),
            "inventory": copy.deepcopy(_dict(raw.get("inventory"))),
            "transport_policies": [],
        }
    for resource in _list(project.get("supportResources")):
        node_name = aliases.get(str(resource.get("supportNodeName") or resource.get("supportNodeId") or ""), "")
        if not node_name:
            continue
        node = nodes_by_name.setdefault(node_name, {"id": node_name, "name": node_name, "personnel_capacity": 0, "equipment_capacity": 0, "inventory": {}, "transport_policies": []})
        quantity = _non_negative_int(resource.get("quantity"), 0)
        resource_type = str(resource.get("type") or "").lower()
        if resource_type == "personnel":
            node["personnel_capacity"] += quantity
        elif resource_type == "equipment":
            node["equipment_capacity"] += quantity
        elif resource_type == "spare":
            spare_name = str(resource.get("name") or resource.get("spareName") or resource.get("spareType") or "")
            if spare_name:
                node["inventory"][spare_name] = node["inventory"].get(spare_name, 0) + quantity
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
    return list(nodes_by_name.values()) or [{"id": "support-node", "name": "support node", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {}, "transport_policies": []}]


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
    from_value = str(policy.get("fromSupportNodeName") or policy.get("fromSupportNodeId") or policy.get("from") or default_node)
    to_value = str(policy.get("toSupportNodeName") or policy.get("toSupportNodeId") or policy.get("to") or default_node)
    return {
        "from": aliases.get(from_value, from_value),
        "to": aliases.get(to_value, to_value),
        "spareType": str(policy.get("spareName") or policy.get("spareType") or policy.get("spare_type") or ""),
        "capacity": _positive_int(policy.get("capacity"), 1),
        "priority": _positive_int(policy.get("priority"), 1),
        "transportTimeHours": _non_negative_float(policy.get("transportTimeHours"), _non_negative_float(policy.get("transport_time_hours"), 0.0)),
    }


def _support_activity(activity: dict[str, Any], aliases: dict[str, str]) -> dict[str, Any]:
    resource_id = str(activity.get("resourceId") or activity.get("supportNodeId") or "")
    compiled = {
        "id": str(activity.get("id") or "support-activity"),
        "name": str(activity.get("name") or activity.get("activityName") or activity.get("id") or "support activity"),
        "activity_type": str(activity.get("activityType") or activity.get("planType") or "support activity"),
        "resource_id": aliases.get(resource_id, resource_id) or next(iter(aliases.values()), "support-node"),
        "priority": _positive_int(activity.get("priority"), 1),
        "duration_minutes": _positive_int(activity.get("durationMinutes"), _positive_int(activity.get("durationHours"), 1) * 60),
        "required_personnel": _positive_int(activity.get("requiredPersonnel"), 1),
        "required_devices": _positive_int(activity.get("requiredDevices"), 1),
        "spare_type": _optional_string(activity.get("spareType")),
        "spare_quantity": _non_negative_int(activity.get("spareQuantity"), 0),
        "calendarDayInterval": activity.get("calendarDayInterval"),
        "runHourInterval": activity.get("runHourInterval"),
        "takeoffLandingInterval": activity.get("takeoffLandingInterval"),
        "floatRatio": activity.get("floatRatio"),
        "transport_strategies": copy.deepcopy(_list(activity.get("transportStrategies"))),
        "organization_strategies": copy.deepcopy(_list(activity.get("organizationStrategies"))),
        "jobs": [_support_job(job, activity) for job in _list(activity.get("jobs"))],
    }
    return compiled


def _support_job(job: dict[str, Any], activity: dict[str, Any]) -> dict[str, Any]:
    return {
        **copy.deepcopy(job),
        "activityCode": str(job.get("activityCode") or job.get("id") or "job"),
        "workName": str(job.get("workName") or job.get("name") or activity.get("name") or activity.get("id") or "job"),
        "durationMinutes": _positive_int(job.get("durationMinutes"), _positive_int(activity.get("durationMinutes"), _positive_int(activity.get("durationHours"), 1) * 60)),
        "predecessors": list(job.get("predecessors") or []),
    }


def _component(component: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(component.get("id") or "component"),
        "name": str(component.get("name") or component.get("id") or "component"),
        "parent_id": _optional_string(component.get("parentId")),
        "aircraft_model": _optional_string(component.get("aircraftModel")),
        "product_type": _optional_string(component.get("productType")),
        "quantity": _positive_int(component.get("quantity"), 1),
        "failure_rate": _non_negative_float(component.get("failureRate"), 0.0),
        "failure_distribution": copy.deepcopy(_dict(component.get("failureDistribution"))),
        "k_out_of_n": copy.deepcopy(_dict(component.get("kOutOfN"))),
        "life_limit_hours": _optional_positive_number(component.get("lifeLimitHours")),
        "mtbf_hours": _optional_positive_number(component.get("mtbfHours")),
        "rms": copy.deepcopy(_dict(component.get("rms"))),
        "spare_type": _optional_string(component.get("spareType")),
        "special_repair_profile": copy.deepcopy(_dict(component.get("specialRepairProfile"))),
    }


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
