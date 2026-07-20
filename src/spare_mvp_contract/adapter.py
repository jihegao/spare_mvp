"""Simulation Adapter boundary for contract-first backend migration.

The adapter owns application-facing Project -> Scenario -> Run/Result/Artifact
translation. The aircraft_support_v1 product runtime is the formal run target;
aviation_support is retained only as historical model source and is retired at
the adapter entrypoints.
"""

from __future__ import annotations

import copy
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import math
import multiprocessing
from pathlib import Path
import re
from typing import Any

from src.spare_mvp_backend.project_payload import (
    normalize_project_products,
    normalize_support_activity_maintenance_plans,
)
from src.spare_mvp_contract.downtime import (
    normalize_downtime_event_for_analysis,
    sanitize_downtime_user_projection,
)
from src.spare_mvp_contract.monte_carlo_moments import (
    build_monte_carlo_metric_moments,
    finite_mean,
    is_finite_json_number,
)

from src.spare_mvp_abm.aircraft_support_v1.mission_reliability import (
    mission_period_outcome,
    period_completion_summary,
)
from src.spare_mvp_contract.task_reliability import build_task_reliability_result_fields

PROJECT_SCHEMA_VERSION = "project-v0"
SCENARIO_SCHEMA_VERSION = "scenario-v0"
RUN_SCHEMA_VERSION = "run-v0"
RESULT_SCHEMA_VERSION = "result-v0"
ARTIFACT_MANIFEST_SCHEMA_VERSION = "artifact-manifest-v0"
VISUALIZATION_STATE_SERIES_SCHEMA_VERSION = "visualization-state-series-v0"
MESA_CONTRACT_VERSION = "1.0.0"
ADAPTER_NAME = "Simulation Adapter Agent"
ACTIVE_MODEL_FAMILY = "aircraft_support_v1"
RETIRED_ADAPTER_MODEL_FAMILIES = ("smoke", "aviation_support")
REMOVED_MISSION_AREA_KEYS = {"missionAreas", "mission_areas"}
SPARE_SHORTFALL_CONSTRAINTS = [0.85, 0.9, 0.95]
SPARE_SHORTFALL_TRUNCATION = {
    "mode": "clamp_0_1",
    "fields": ["fill_rate", "utilization", "shortage_probability"],
}
_PERIODIC_WEEKDAY_INDEXES = {
    "monday": 0,
    "mondaycompositetaskid": 0,
    "mon": 0,
    "周一": 0,
    "星期一": 0,
    "tuesday": 1,
    "tuesdaycompositetaskid": 1,
    "tue": 1,
    "周二": 1,
    "星期二": 1,
    "wednesday": 2,
    "wednesdaycompositetaskid": 2,
    "wed": 2,
    "周三": 2,
    "星期三": 2,
    "thursday": 3,
    "thursdaycompositetaskid": 3,
    "thu": 3,
    "周四": 3,
    "星期四": 3,
    "friday": 4,
    "fridaycompositetaskid": 4,
    "fri": 4,
    "周五": 4,
    "星期五": 4,
    "saturday": 5,
    "saturdaycompositetaskid": 5,
    "sat": 5,
    "周六": 5,
    "星期六": 5,
    "sunday": 6,
    "sundaycompositetaskid": 6,
    "sun": 6,
    "周日": 6,
    "星期日": 6,
    "星期天": 6,
}
_PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS = (
    "mondayCompositeTaskId",
    "tuesdayCompositeTaskId",
    "wednesdayCompositeTaskId",
    "thursdayCompositeTaskId",
    "fridayCompositeTaskId",
    "saturdayCompositeTaskId",
    "sundayCompositeTaskId",
)


class AdapterError(ValueError):
    """Structured adapter error for validation and unsupported compilation paths."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class SimulationAdapter:
    """Minimal M2a adapter over the repository-local contract bundle."""

    def __init__(self, repo_root: Path | str | None = None) -> None:
        self.repo_root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
        self.contracts_dir = self.repo_root / "contracts"
        self._compiled_project_snapshots: dict[str, dict[str, Any]] = {}

    def validate_project(self, project: dict[str, Any]) -> dict[str, Any]:
        """Validate the roots required by the current Project JSON contract."""
        errors: list[dict[str, str]] = []
        for field in self._project_required_fields():
            if field not in project:
                errors.append(
                    {
                        "code": "missing_required",
                        "path": field,
                        "message": f"Project JSON is missing required field {field!r}",
                    }
                )

        schema_version = str(project.get("schema_version", PROJECT_SCHEMA_VERSION))
        if schema_version != PROJECT_SCHEMA_VERSION:
            errors.append(
                {
                    "code": "unsupported_schema_version",
                    "path": "schema_version",
                    "message": f"expected {PROJECT_SCHEMA_VERSION}, got {schema_version}",
                }
            )

        errors.extend(self._support_resource_identity_errors(project))

        return {
            "ok": not errors,
            "project_id": self._project_id(project),
            "project_version": self._project_version(project),
            "project_schema_version": schema_version,
            "errors": errors,
        }

    def _support_resource_identity_errors(self, project: dict[str, Any]) -> list[dict[str, str]]:
        errors: list[dict[str, str]] = []
        resources = self._dict_list(project.get("supportResources"))
        ids: dict[str, int] = {}
        for index, resource in enumerate(resources):
            resource_id = str(resource.get("id") or "").strip()
            if not resource_id:
                continue
            if resource_id in ids:
                errors.append({
                    "code": "duplicate_support_resource_id",
                    "path": f"supportResources[{index}].id",
                    "message": f"support resource ID {resource_id} duplicates supportResources[{ids[resource_id]}].id",
                })
            else:
                ids[resource_id] = index

        organization_ids: set[str] = set()
        organization_ids_by_name: dict[str, set[str]] = {}
        organization_descendant_leaf_ids: dict[str, set[str]] = {}
        organization = project.get("supportOrganization") if isinstance(project.get("supportOrganization"), dict) else {}
        raw_tree = organization.get("tree")
        roots = raw_tree if isinstance(raw_tree, list) else [raw_tree]

        def collect_organization(node: Any) -> set[str]:
            if not isinstance(node, dict):
                return set()
            node_id = str(node.get("id") or "").strip()
            node_name = str(node.get("name") or "").strip()
            if node_id:
                organization_ids.add(node_id)
                if node_name:
                    organization_ids_by_name.setdefault(node_name, set()).add(node_id)
            child_leaves: set[str] = set()
            children = node.get("children") if isinstance(node.get("children"), list) else []
            for child in children:
                child_leaves.update(collect_organization(child))
            leaves = child_leaves or ({node_id} if node_id else set())
            if node_id:
                organization_descendant_leaf_ids[node_id] = leaves
            return leaves

        for root in roots:
            collect_organization(root)

        support_node_ids: set[str] = set()
        support_node_ids_by_name: dict[str, set[str]] = {}
        for node in self._dict_list(project.get("supportNodes")):
            node_id = str(node.get("id") or "").strip()
            node_name = str(node.get("name") or node.get("supportNodeName") or "").strip()
            if node_id:
                support_node_ids.add(node_id)
                if node_name:
                    support_node_ids_by_name.setdefault(node_name, set()).add(node_id)

        logical_seen: dict[tuple[str, str], int] = {}
        for index, resource in enumerate(resources):
            if str(resource.get("type") or "").strip().lower() != "spare":
                continue
            resource_id = str(resource.get("id") or "").strip()
            if resource_id.startswith("support-spare-tombstone:"):
                continue
            product_id = str(resource.get("productId") or "").strip()
            explicit_organization_ref = str(resource.get("organizationNodeName") or "").strip()
            organization_ref = explicit_organization_ref or str(resource.get("supportNodeName") or "").strip()
            canonical_org = organization_ref
            identity_resolved = False
            if organization_ids:
                if organization_ref in organization_ids:
                    canonical_org = organization_ref
                    identity_resolved = True
                else:
                    matches = organization_ids_by_name.get(organization_ref, set())
                    if len(matches) == 1:
                        canonical_org = next(iter(matches))
                        identity_resolved = True
                    else:
                        support_ref = str(resource.get("supportNodeName") or "").strip()
                        support_matches = (
                            {support_ref} if support_ref in support_node_ids else support_node_ids_by_name.get(support_ref, set())
                        )
                        if not explicit_organization_ref and len(support_matches) == 1:
                            canonical_org = f"support-node:{next(iter(support_matches))}"
                            identity_resolved = True
                        else:
                            errors.append({
                                "code": "ambiguous_support_resource_organization" if len(matches) > 1 else "unknown_support_resource_organization",
                                "path": f"supportResources[{index}].{'organizationNodeName' if explicit_organization_ref else 'supportNodeName'}",
                                "message": f"support resource organization {organization_ref or '<empty>'} is not a unique organization node",
                            })
                            continue
            else:
                support_matches = (
                    {organization_ref} if organization_ref in support_node_ids else support_node_ids_by_name.get(organization_ref, set())
                )
                if len(support_matches) == 1:
                    canonical_org = f"support-node:{next(iter(support_matches))}"
                    identity_resolved = True
                else:
                    canonical_org = f"legacy:{organization_ref}"
            descendant_leaves = organization_descendant_leaf_ids.get(canonical_org, set())
            if len(descendant_leaves) > 1 and self._non_negative_int(resource.get("quantity"), 0) > 0:
                errors.append({
                    "code": "ambiguous_support_resource_migration",
                    "path": f"supportResources[{index}].organizationNodeName",
                    "message": f"non-zero spare on organization {canonical_org} cannot be distributed across multiple leaf organizations",
                })
                continue
            if not canonical_org or not product_id:
                continue
            logical_key = (canonical_org, product_id)
            if identity_resolved and logical_key in logical_seen:
                errors.append({
                    "code": "duplicate_support_resource_identity",
                    "path": f"supportResources[{index}]",
                    "message": (
                        f"live spare identity ({canonical_org}, {product_id}) duplicates "
                        f"supportResources[{logical_seen[logical_key]}]"
                    ),
                })
            elif identity_resolved:
                logical_seen[logical_key] = index

        known_resource_ids = set(ids)
        stable_identity_payload = any(resource_id.startswith("support-spare:") for resource_id in known_resource_ids)
        for job_index, job in enumerate(self._dict_list(project.get("supportActivityJobs"))):
            for spare_index, requirement in enumerate(self._dict_list(job.get("spare"))):
                key = str(requirement.get("key") or "").strip()
                if stable_identity_payload and key and key not in known_resource_ids:
                    errors.append({
                        "code": "missing_support_resource_key_reference",
                        "path": f"supportActivityJobs[{job_index}].spare[{spare_index}].key",
                        "message": f"support activity spare key references unknown support resource {key}",
                    })
        return errors

    def compile_scenario(
        self,
        project: dict[str, Any],
        model_family: str = ACTIVE_MODEL_FAMILY,
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Compile a validated Project JSON document into a model-specific Scenario."""
        result = self._compile_scenario_with_gate(project, model_family=model_family, runtime_config=runtime_config)
        if result["status"] == "compiled" and result["scenario"] is not None:
            return result["scenario"]
        if result["status"] == "blocked":
            raise AdapterError(
                "invalid_project",
                "Project JSON failed validation",
                errors=result.get("errors", []),
                issues=result["issues"],
                provenance=result["provenance"],
            )
        if result["issues"] and result["issues"][0].get("code") == "retired_model_family":
            raise AdapterError(
                "retired_model_family",
                result["issues"][0]["message"],
                model_family=model_family,
                replacement_model_family=ACTIVE_MODEL_FAMILY,
                retired_model_families=list(RETIRED_ADAPTER_MODEL_FAMILIES),
                issues=result["issues"],
                provenance=result["provenance"],
            )
        raise AdapterError(
            "unsupported_model_family",
            f"{model_family} does not have an approved Project to Scenario compiler",
            model_family=model_family,
            issues=result["issues"],
            provenance=result["provenance"],
        )

    def compile_scenario_with_gate(
        self,
        project: dict[str, Any],
        model_family: str = ACTIVE_MODEL_FAMILY,
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Compile with an explicit fail-closed gate result for unsupported paths."""
        return self._compile_scenario_with_gate(project, model_family=model_family, runtime_config=runtime_config)

    def _retired_model_family_gate(self, model_family: str) -> dict[str, Any]:
        message = f"{model_family} is retired; use {ACTIVE_MODEL_FAMILY}"
        return {
            "status": "unsupported",
            "scenario": None,
            "provenance": {
                "project_id": "",
                "modeling_snapshot_id": None,
                "experiment_plan_id": None,
                "model_family": model_family,
                "mapping_version": "retired-model-family",
                "consumed_fields": [],
                "defaults_applied": [],
                "derived_fields": [],
                "ignored_fields": [],
                "unsupported_fields": ["model_family"],
            },
            "issues": [
                {
                    "code": "retired_model_family",
                    "message": message,
                    "field_path": "model_family",
                    "page": "Simulation run",
                    "severity": "error",
                    "suggestion": f"Use {ACTIVE_MODEL_FAMILY} for current formal and low-level adapter runs.",
                    "replacement_model_family": ACTIVE_MODEL_FAMILY,
                    "retired_model_families": list(RETIRED_ADAPTER_MODEL_FAMILIES),
                }
            ],
        }

    def _retired_model_family_error(self, model_family: str) -> AdapterError:
        return AdapterError(
            "retired_model_family",
            f"{model_family} is retired; use {ACTIVE_MODEL_FAMILY}",
            model_family=model_family,
            replacement_model_family=ACTIVE_MODEL_FAMILY,
            retired_model_families=list(RETIRED_ADAPTER_MODEL_FAMILIES),
        )

    def _compile_scenario_with_gate(
        self,
        project: dict[str, Any],
        model_family: str = ACTIVE_MODEL_FAMILY,
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if model_family in RETIRED_ADAPTER_MODEL_FAMILIES:
            return self._retired_model_family_gate(model_family)
        maintenance_plan_changes: list[str] = []
        if model_family == "aircraft_support_v1":
            project = normalize_project_products(project)
            try:
                project, maintenance_plan_changes = normalize_support_activity_maintenance_plans(project)
            except ValueError as error:
                message = str(error)
                path_match = re.search(r" schema at ([^:]+):", message)
                field_path = path_match.group(1) if path_match else "supportActivities"
                provenance = self._aircraft_support_v1_mapping_provenance(self._project_id(project), project, runtime_config)
                return {
                    "status": "blocked",
                    "scenario": None,
                    "provenance": provenance,
                    "issues": [{
                        "code": "invalid_maintenance_plan",
                        "message": message,
                        "field_path": field_path,
                        "page": "Project JSON",
                        "severity": "error",
                        "suggestion": "Use the canonical maintenanceMethods/replacementRatio pair on corrective or preventive plans.",
                    }],
                    "errors": [{"code": "invalid_maintenance_plan", "path": field_path, "message": message}],
                }
        validation = self.validate_project(project)
        if not validation["ok"]:
            issues = [
                {
                    "code": error["code"],
                    "message": error["message"],
                    "field_path": error["path"],
                    "page": "Project JSON",
                    "severity": "error",
                    "suggestion": "Provide the required Project JSON field before compiling a Scenario.",
                }
                for error in validation["errors"]
            ]
            return {
                "status": "blocked",
                "scenario": None,
                "provenance": self._with_modeling_import_validation_provenance(
                    self._compile_gate_provenance(project, model_family),
                    project,
                ),
                "issues": issues,
                "errors": validation["errors"],
            }
        if model_family == "aircraft_support_v1":
            provenance = self._with_modeling_import_validation_provenance(
                self._aircraft_support_v1_mapping_provenance(self._project_id(project), project, runtime_config),
                project,
            )
            provenance["defaults_applied"] = list(provenance.get("defaults_applied") or []) + maintenance_plan_changes
            issues = self._aircraft_support_v1_compile_issues(project)
            if issues:
                return {
                    "status": "blocked",
                    "scenario": None,
                    "provenance": provenance,
                    "issues": issues,
                    "errors": [
                        {
                            "code": issue["code"],
                            "path": issue["field_path"],
                            "message": issue["message"],
                        }
                        for issue in issues
                    ],
                }
            scenario = self._compile_aircraft_support_v1_scenario(project, validation, runtime_config=runtime_config)
            scenario = self._scenario_with_mapping_provenance(scenario, provenance)
            return {
                "status": "compiled",
                "scenario": scenario,
                "provenance": provenance,
                "issues": [],
            }
        provenance = self._with_modeling_import_validation_provenance(
            self._compile_gate_provenance(project, model_family),
            project,
        )
        return {
            "status": "unsupported",
            "scenario": None,
            "provenance": provenance,
            "issues": [
                {
                    "code": "unsupported_model_family",
                    "message": f"{model_family} does not have an approved Project to Scenario compiler.",
                    "field_path": "model_family",
                    "page": "Simulation run",
                    "severity": "error",
                    "suggestion": "Choose aircraft_support_v1 or add a governed compiler before submitting this run.",
                }
            ],
        }

    def _compile_aircraft_support_v1_scenario(
        self,
        project: dict[str, Any],
        validation: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        project_id = validation["project_id"]
        project_version = validation["project_version"]
        scenario_key = _safe_identifier(str(project.get("scenarioId") or project_id))
        inputs = self._compile_aircraft_support_v1_inputs(project, validation, runtime_config=runtime_config)
        now = _utc_now()

        scenario = {
            "schema_version": SCENARIO_SCHEMA_VERSION,
            "scenario_id": f"scenario-{scenario_key}",
            "project_id": project_id,
            "scenario_version": "scenario-v0.1",
            "simulation_model": {
                "family": "aircraft_support_v1",
                "model_id": "AircraftSupportV1Model",
                "contract_version": MESA_CONTRACT_VERSION,
            },
            "compiled_at": now,
            "compiled_by": ADAPTER_NAME,
            "compiled_from": {
                "project_id": project_id,
                "project_version": project_version,
                "project_schema_version": validation["project_schema_version"],
                "mesa_contract_version": MESA_CONTRACT_VERSION,
                "mapping_provenance": self._aircraft_support_v1_mapping_provenance(project_id, project, runtime_config),
            },
            "simulation_inputs": inputs,
        }
        self._compiled_project_snapshots[scenario["scenario_id"]] = copy.deepcopy(project)
        self._compiled_project_snapshots[scenario["project_id"]] = copy.deepcopy(project)
        return scenario

    def run_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Run a compiled single-run Scenario and write traceable contract artifacts."""
        model_family = scenario.get("simulation_model", {}).get("family")
        if model_family == "aviation_support":
            raise self._retired_model_family_error(model_family)
        if model_family == "aircraft_support_v1":
            return self._run_aircraft_support_v1_scenario(
                scenario,
                output_dir=output_dir,
                steps=steps,
                run_id=run_id,
            )
        raise AdapterError(
            "unsupported_model_family",
            f"{model_family} does not have an executable adapter runtime",
            model_family=model_family,
        )

    def run_monte_carlo_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
        monte_carlo_config: dict[str, Any] | None = None,
        **legacy_config: Any,
    ) -> dict[str, dict[str, Any]]:
        """Run a synchronous formal Monte Carlo batch from a compiled Scenario."""
        model_family = scenario.get("simulation_model", {}).get("family")
        if model_family == "aviation_support":
            raise self._retired_model_family_error(model_family)
        config = self._require_monte_carlo_config(
            monte_carlo_config=monte_carlo_config,
            legacy_config=legacy_config,
        )
        if model_family == "aircraft_support_v1":
            return self._run_aircraft_support_v1_monte_carlo_scenario(
                scenario,
                output_dir=output_dir,
                steps=steps,
                run_id=run_id,
                monte_carlo_config=config,
            )
        raise AdapterError(
            "unsupported_model_family",
            f"{model_family} does not have an executable Monte Carlo adapter runtime",
            model_family=model_family,
        )

    def _project_required_fields(self) -> list[str]:
        schema = json.loads((self.contracts_dir / "project.schema.json").read_text(encoding="utf-8"))
        return list(schema["required"])

    def _compile_aircraft_support_v1_inputs(
        self,
        project: dict[str, Any],
        validation: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        mission_profile = project.get("missionProfile") if isinstance(project.get("missionProfile"), dict) else {}
        aircraft_summary = self._aircraft_support_v1_aircraft_summary(project, mission_profile)
        experiment = self._runtime_experiment_config(project, runtime_config)
        monte_carlo = self._runtime_monte_carlo_config(project, runtime_config)
        fleet_count = aircraft_summary["fleet_count"]
        initial_ready = aircraft_summary["initial_ready"]
        products_by_id = self._aircraft_support_v1_products_by_id(project)
        support_network_nodes = self._aircraft_support_v1_support_nodes(project, products_by_id)
        support_node_aliases = self._support_node_reference_aliases(project)
        basic_missions = copy.deepcopy(self._basic_missions(project))
        composite_tasks = copy.deepcopy(self._dict_list(mission_profile.get("compositeTasks")))
        self._normalize_mission_task_field_ownership(basic_missions, composite_tasks)
        periodic_plan = self._compile_periodic_profile_plan(mission_profile, composite_tasks)
        compiled_mission_profile = {**mission_profile, "periodicTasks": periodic_plan["periodic_tasks"]}
        duration_minutes = self._aircraft_support_v1_duration_minutes(compiled_mission_profile)
        stop_policy = self._runtime_stop_policy_config(project, runtime_config, duration_minutes)

        inputs = {
            "schema_version": "aircraft-support-v1-input-v0",
            "project_identity": {
                "project_id": validation["project_id"],
                "project_version": validation["project_version"],
                "scenario_id": str(project.get("scenarioId") or validation["project_id"]),
                "source_import_id": self._optional_string(mission_profile.get("sourceImportId")),
            },
            "mission_profile": {
                "profile_id": str(mission_profile.get("profileId") or mission_profile.get("id") or "mission-profile"),
                "name": str(mission_profile.get("name") or "mission profile"),
                "duration_minutes": duration_minutes,
                "basic_missions": basic_missions,
                "composite_tasks": periodic_plan["composite_tasks"],
                "periodic_tasks": periodic_plan["periodic_tasks"],
                "periodic_source": periodic_plan["source"],
                "mission_phases": self._aircraft_support_v1_mission_phases(project, basic_missions),
                "airports": self._runtime_airports(project.get("airports")),
            },
            "aircraft": {
                "fleet_count": fleet_count,
                "initial_ready": initial_ready,
                "models": aircraft_summary["models"],
                "assets": self._aircraft_support_v1_aircraft_assets(
                    project,
                    mission_profile,
                    aircraft_summary,
                    fleet_count,
                    initial_ready,
                ),
            },
            "equipment_tree": {
                "root_component_id": self._root_component_id(project.get("components")),
                "components": [
                    self._aircraft_support_v1_component(component, products_by_id)
                    for component in self._dict_list(project.get("components"))
                ],
            },
            "support_network": {
                "nodes": support_network_nodes,
            },
            "support_activities": {
                "activities": [
                    self._aircraft_support_v1_support_activity(
                        activity,
                        support_node_aliases,
                        self._support_activity_job_definitions(project),
                    )
                    for activity in self._dict_list(project.get("supportActivities"))
                ],
            },
            "time": {
                "duration_minutes": duration_minutes,
                "tick_minutes": 1,
                "sample_every_minutes": 30,
                "max_state_frames_single": 2000,
                "requested_steps": self._positive_int(experiment.get("steps"), max(1, duration_minutes // 30)),
            },
            "monte_carlo": {
                "sample_count": self._positive_int(experiment.get("samples"), 1),
                "sweep": {
                    "failureRates": self._non_negative_numbers(monte_carlo.get("failureRates"), [1.0]),
                    "spareMultipliers": self._non_negative_numbers(monte_carlo.get("spareMultipliers"), [1.0]),
                    "supportCapacities": self._positive_int_list(monte_carlo.get("supportCapacities"), [1]),
                },
            },
            "seed": self._positive_int(experiment.get("seed"), 0),
            "stop_policy": stop_policy,
        }
        self._strip_removed_mission_area_fields(inputs)
        return inputs

    def _runtime_experiment_config(
        self,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        experiment = copy.deepcopy(project.get("experiment") if isinstance(project.get("experiment"), dict) else {})
        runtime = runtime_config if isinstance(runtime_config, dict) else {}
        nested = runtime.get("experiment") if isinstance(runtime.get("experiment"), dict) else {}
        for source in (nested, runtime):
            for key in ("name", "steps", "samples", "seed"):
                if key in source:
                    experiment[key] = copy.deepcopy(source[key])
        if "samples" not in experiment and "sample_count" in runtime:
            experiment["samples"] = copy.deepcopy(runtime["sample_count"])
        return experiment

    def _runtime_monte_carlo_config(
        self,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        monte_carlo = copy.deepcopy(project.get("monteCarlo") if isinstance(project.get("monteCarlo"), dict) else {})
        runtime = runtime_config if isinstance(runtime_config, dict) else {}
        runtime_monte_carlo = runtime.get("monteCarlo") if isinstance(runtime.get("monteCarlo"), dict) else {}
        monte_carlo.update(copy.deepcopy(runtime_monte_carlo))
        analysis_requests = runtime.get("analysisRequests") if isinstance(runtime.get("analysisRequests"), dict) else {}
        large_sample = analysis_requests.get("largeSample") if isinstance(analysis_requests.get("largeSample"), dict) else {}
        large_sample_sweep = large_sample.get("sweep") if isinstance(large_sample.get("sweep"), dict) else {}
        monte_carlo.update(copy.deepcopy(large_sample_sweep))
        direct_sweep = runtime.get("sweep") if isinstance(runtime.get("sweep"), dict) else {}
        monte_carlo.update(copy.deepcopy(direct_sweep))
        return monte_carlo

    def _runtime_stop_policy_config(
        self,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None,
        duration_minutes: int,
    ) -> dict[str, Any]:
        source: dict[str, Any] = {}
        sources = self._runtime_stop_policy_sources(project, runtime_config)
        for candidate in sources:
            source.update(copy.deepcopy(candidate))
        mode = "and" if str(source.get("mode") or "").strip().lower() == "and" else "or"
        raw_conditions = source.get("conditions") if isinstance(source.get("conditions"), list) else []
        if not raw_conditions and source.get("type") not in (None, ""):
            raw_conditions = [{"type": source.get("type")}]
        conditions = [
            condition
            for raw_condition in raw_conditions
            if (condition := self._normalized_stop_policy_condition(raw_condition, duration_minutes)) is not None
        ]
        if not conditions:
            conditions = [{"type": "duration", "duration_minutes": max(1, int(duration_minutes))}]
        return {
            "schema_version": str(source.get("schemaVersion") or source.get("schema_version") or "stop-policy-v0"),
            "mode": mode,
            "conditions": conditions,
            "defaulted": not sources or self._truthy_config_flag(source.get("defaulted")),
        }

    def _runtime_stop_policy_sources(
        self,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        runtime = runtime_config if isinstance(runtime_config, dict) else {}
        project_experiment = project.get("experiment") if isinstance(project.get("experiment"), dict) else {}
        runtime_experiment = runtime.get("experiment") if isinstance(runtime.get("experiment"), dict) else {}
        candidates = [
            project_experiment.get("stopPolicy"),
            project_experiment.get("stop_policy"),
            project.get("stopPolicy"),
            project.get("stop_policy"),
            runtime_experiment.get("stopPolicy"),
            runtime_experiment.get("stop_policy"),
            runtime.get("stopPolicy"),
            runtime.get("stop_policy"),
        ]
        return [candidate for candidate in candidates if isinstance(candidate, dict)]

    def _normalized_stop_policy_condition(
        self,
        condition: Any,
        duration_minutes: int,
    ) -> dict[str, Any] | None:
        if isinstance(condition, str):
            condition = {"type": condition}
        if not isinstance(condition, dict):
            return None
        condition_type = self._stop_policy_condition_type(condition.get("type"))
        if not condition_type:
            return None
        if condition_type == "duration":
            duration = max(1, int(duration_minutes))
            for key in ("durationMinutes", "duration_minutes", "minute", "minutes"):
                if self._is_positive_number(condition.get(key)):
                    duration = max(1, int(round(float(condition[key]))))
                    break
            return {"type": "duration", "duration_minutes": duration}
        if condition_type == "specified_time":
            minute = self._stop_policy_condition_minute(condition)
            if minute is None:
                return None
            return {"type": "specified_time", "minute": minute}
        return {"type": "failure"}

    def _stop_policy_condition_type(self, value: Any) -> str:
        text = str(value or "").strip().lower().replace("-", "_")
        compact = text.replace("_", "")
        if compact in {"duration", "taskduration", "reachtaskduration", "maxduration"}:
            return "duration"
        if compact in {"failure", "taskfailure", "missionfailure"}:
            return "failure"
        if compact in {"specifiedtime", "targettime", "time", "specifiedminute"}:
            return "specified_time"
        return ""

    def _stop_policy_condition_minute(self, condition: dict[str, Any]) -> int | None:
        for key in ("minute", "minutes", "timeMinute", "time_minute", "specifiedMinute", "specified_minute", "targetMinute"):
            if self._is_positive_number(condition.get(key)):
                return max(1, int(round(float(condition[key]))))
        for key in ("time", "targetTime", "target_time", "at", "specifiedAt"):
            parsed = self._clock_time_to_minute(condition.get(key))
            if parsed is not None:
                return parsed
        return None

    def _clock_time_to_minute(self, value: Any) -> int | None:
        text = str(value or "").strip()
        if ":" not in text:
            return None
        parts = text.split(":")
        try:
            hour = int(parts[0])
            minute = int(parts[1])
        except (TypeError, ValueError):
            return None
        if hour < 0 or minute < 0:
            return None
        return max(1, hour * 60 + minute)

    def _aircraft_support_v1_products_by_id(self, project: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {
            str(product.get("id")): copy.deepcopy(product)
            for product in self._dict_list(project.get("products"))
            if product.get("id") not in (None, "")
        }

    def _aircraft_support_v1_component(
        self,
        component: dict[str, Any],
        products_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        failure_distribution = copy.deepcopy(component.get("failureDistribution") if isinstance(component.get("failureDistribution"), dict) else {})
        failure_rate = self._failure_distribution_rate(failure_distribution)
        product_id = str(component.get("productId") or "")
        product = products_by_id.get(product_id, {})
        return {
            "id": str(component.get("id") or "component"),
            "name": str(component.get("name") or component.get("id") or "component"),
            "parent_id": self._optional_string(component.get("parentId")),
            "aircraft_model": self._optional_string(component.get("aircraftModel")),
            "product_id": product_id,
            "product_name": str(product.get("name") or component.get("name") or product_id),
            "product_type": self._optional_string(component.get("productType")),
            "quantity": self._positive_int(component.get("quantity"), 1),
            "failure_rate": 0.0 if failure_rate is None else failure_rate,
            "failure_distribution": failure_distribution,
            "repair_distribution": copy.deepcopy(component.get("repairDistribution") if isinstance(component.get("repairDistribution"), dict) else {}),
            "k_out_of_n": copy.deepcopy(component.get("kOutOfN") if isinstance(component.get("kOutOfN"), dict) else {}),
            "special_repair_profile": copy.deepcopy(
                component.get("specialRepairProfile") if isinstance(component.get("specialRepairProfile"), dict) else {}
            ),
        }

    def _failure_distribution_rate(self, distribution: dict[str, Any]) -> float | None:
        parameters = distribution.get("parameters") or distribution.get("params")
        multiplier = self._non_negative_number(distribution.get("_rate_multiplier"), 1.0)
        if isinstance(parameters, (int, float)) and not isinstance(parameters, bool):
            return max(0.0, float(parameters)) * multiplier
        if not isinstance(parameters, str):
            return None
        values = self._distribution_parameters(parameters)
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
        return None

    def _distribution_parameters(self, parameters: str) -> dict[str, float]:
        text = parameters.replace("，", ",").replace("；", ",").replace(";", ",")
        values: dict[str, float] = {}
        for item in text.split(","):
            if "=" not in item:
                continue
            key, value = [part.strip().lower() for part in item.split("=", 1)]
            values[key] = self._non_negative_number(value, 0.0)
        return values

    def _aircraft_support_v1_aircraft_summary(
        self,
        project: dict[str, Any],
        mission_profile: dict[str, Any],
    ) -> dict[str, Any]:
        equipment = project.get("equipment") if isinstance(project.get("equipment"), dict) else {}
        combat_unit = self._aircraft_support_v1_combat_unit(project, mission_profile)
        members = self._dict_list(combat_unit.get("members"))
        components = self._dict_list(project.get("components"))
        fleet_count = self._aircraft_support_v1_fleet_count(equipment, combat_unit, members, components)
        if members:
            initial_ready = sum(
                1
                for member in members[:fleet_count]
                if not self._aircraft_support_v1_member_in_maintenance(member)
            )
        else:
            initial_ready = min(self._positive_int(equipment.get("initialReady"), fleet_count), fleet_count)
        models = self._aircraft_support_v1_aircraft_models(equipment, members, components)
        return {
            "fleet_count": fleet_count,
            "initial_ready": min(initial_ready, fleet_count),
            "models": models,
            "model": models[0] if models else "Aircraft",
        }

    def _aircraft_support_v1_combat_unit(
        self,
        project: dict[str, Any],
        mission_profile: dict[str, Any],
    ) -> dict[str, Any]:
        combat_unit = project.get("combatUnit") if isinstance(project.get("combatUnit"), dict) else {}
        if combat_unit:
            return combat_unit
        return mission_profile.get("combatUnit") if isinstance(mission_profile.get("combatUnit"), dict) else {}

    def _aircraft_support_v1_combat_members(
        self,
        project: dict[str, Any],
        mission_profile: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return self._dict_list(self._aircraft_support_v1_combat_unit(project, mission_profile).get("members"))

    def _aircraft_support_v1_fleet_count(
        self,
        equipment: dict[str, Any],
        combat_unit: dict[str, Any],
        members: list[dict[str, Any]],
        components: list[dict[str, Any]],
    ) -> int:
        if members:
            return len(members)
        if self._is_positive_number(combat_unit.get("quantity")):
            return self._positive_int(combat_unit.get("quantity"), 1)
        root_quantity = self._aircraft_support_v1_root_component_quantity(components)
        if root_quantity is not None:
            return root_quantity
        return self._positive_int(equipment.get("quantity"), 1)

    def _aircraft_support_v1_root_component_quantity(self, components: list[dict[str, Any]]) -> int | None:
        for component in components:
            if component.get("parentId") in (None, "") and self._is_positive_number(component.get("quantity")):
                return self._positive_int(component.get("quantity"), 1)
        return None

    def _aircraft_support_v1_aircraft_models(
        self,
        equipment: dict[str, Any],
        members: list[dict[str, Any]],
        components: list[dict[str, Any]],
    ) -> list[str]:
        models = self._unique_string_list(member.get("model") for member in members)
        if not models:
            models = self._unique_string_list(component.get("aircraftModel") for component in components)
        if not models:
            models = self._aircraft_support_v1_equipment_aircraft_models(equipment)
        return models or ["Aircraft"]

    def _aircraft_support_v1_equipment_aircraft_models(self, equipment: dict[str, Any]) -> list[str]:
        values: list[Any] = []
        aircraft_types = equipment.get("aircraftTypes")
        if isinstance(aircraft_types, list):
            for aircraft_type in aircraft_types:
                if isinstance(aircraft_type, dict):
                    values.append(aircraft_type.get("model") or aircraft_type.get("name") or aircraft_type.get("id"))
                else:
                    values.append(aircraft_type)
        values.extend(self._string_list(equipment.get("wholeMachineModels")))
        values.append(equipment.get("model"))
        return self._unique_string_list(values)

    def _aircraft_support_v1_member_in_maintenance(self, member: dict[str, Any]) -> bool:
        status = str(member.get("status") or "").strip().lower()
        unavailable_tokens = ("维修", "故障", "不可用", "maintenance", "failed", "failure", "unavailable", "down")
        return any(token in status for token in unavailable_tokens)

    def _aircraft_support_v1_aircraft_assets(
        self,
        project: dict[str, Any],
        mission_profile: dict[str, Any],
        aircraft_summary: dict[str, Any],
        fleet_count: int,
        initial_ready: int,
    ) -> list[dict[str, str]]:
        combat_unit = self._aircraft_support_v1_combat_unit(project, mission_profile)
        members = self._dict_list(combat_unit.get("members"))
        if not members:
            return []
        default_model = str(aircraft_summary.get("model") or "Aircraft")
        assets = []
        for index, member in enumerate(members[:fleet_count]):
            model = str(member.get("model") or default_model)
            initial_state = "available" if index < initial_ready else "maintenance"
            if self._aircraft_support_v1_member_in_maintenance(member):
                initial_state = "maintenance"
            assets.append(
                {
                    "tail_number": str(
                        member.get("aircraftNo")
                        or member.get("tailNumber")
                        or member.get("tail_number")
                        or f"AC-{index + 1:03d}"
                    ),
                    "aircraft_type": model,
                    "model": model,
                    "initial_state": initial_state,
                    "airport": self._optional_string(member.get("airport")) or "",
                    "airport_id": self._optional_string(member.get("airportId") or member.get("baseAirportId")) or "",
                }
            )
        return assets

    def _aircraft_support_v1_support_nodes(
        self,
        project: dict[str, Any],
        products_by_id: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        raw_nodes = self._dict_list(project.get("supportNodes"))
        resources = self._dict_list(project.get("supportResources"))
        aliases = self._support_node_reference_aliases(project)
        nodes_by_name: dict[str, dict[str, Any]] = {}

        for raw_node in raw_nodes:
            node = self._aircraft_support_v1_support_node(raw_node, products_by_id)
            node_name = self._support_node_runtime_name(raw_node)
            node["id"] = node_name
            node["name"] = node_name
            if resources and not any(field in raw_node for field in ("capacity", "personnelCapacity", "equipmentCapacity", "inventory")):
                node["personnel_capacity"] = 0
                node["equipment_capacity"] = 0
                node["inventory"] = {}
            node["transport_policies"] = []
            nodes_by_name[node_name] = node

        for resource in resources:
            node_name = self._support_resource_node_name(resource, aliases)
            if not node_name:
                continue
            node = nodes_by_name.setdefault(node_name, self._empty_aircraft_support_v1_support_node(node_name))
            quantity = self._non_negative_int(resource.get("quantity"), self._non_negative_int(resource.get("capacity"), 0))
            resource_type = str(resource.get("type") or "").strip().lower()
            if resource_type == "personnel":
                node["personnel_capacity"] = max(0, int(node.get("personnel_capacity", 0))) + quantity
            elif resource_type == "equipment":
                node["equipment_capacity"] = max(0, int(node.get("equipment_capacity", 0))) + quantity
            elif resource_type == "spare":
                product_id = str(resource.get("productId") or "").strip()
                if product_id:
                    node["inventory"][product_id] = int(node["inventory"].get(product_id, 0)) + quantity
                    product = products_by_id.get(product_id, {})
                    node["product_names"][product_id] = str(product.get("name") or resource.get("name") or product_id)

        for node in nodes_by_name.values():
            node["personnel_capacity"] = max(1, int(node.get("personnel_capacity", 0) or 0))
            node["equipment_capacity"] = max(1, int(node.get("equipment_capacity", 0) or 0))

        for policy in self._project_transport_policies(project):
            normalized = self._aircraft_support_v1_transport_policy(policy, aliases, products_by_id)
            destination = str(normalized.get("to") or "")
            if not destination or destination not in nodes_by_name:
                continue
            nodes_by_name[destination]["transport_policies"].append(normalized)

        return list(nodes_by_name.values())

    def _aircraft_support_v1_support_node(
        self,
        node: dict[str, Any],
        products_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
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
        raw_inventory = node.get("inventory") if isinstance(node.get("inventory"), dict) else {}
        inventory = {
            product_ids_by_label.get(str(key).strip(), str(key)): copy.deepcopy(quantity)
            for key, quantity in raw_inventory.items()
        }
        return {
            "id": self._support_node_runtime_name(node),
            "name": self._support_node_runtime_name(node),
            "airport": self._optional_string(node.get("airport")) or "",
            "airport_id": self._optional_string(node.get("airportId") or node.get("baseAirportId")) or "",
            "node_type": self._optional_string(node.get("nodeType")),
            "support_level": self._optional_string(node.get("supportLevel")),
            "personnel_capacity": self._positive_int(node.get("personnelCapacity"), self._positive_int(node.get("capacity"), 1)),
            "equipment_capacity": self._positive_int(node.get("equipmentCapacity"), self._positive_int(node.get("capacity"), 1)),
            "inventory": inventory,
            "product_names": product_names,
            "lateral_support_nodes": self._string_list(node.get("lateralSupportNodes")),
            "transport_policies": copy.deepcopy(self._dict_list(node.get("transportPolicies"))),
            "policy": self._optional_string(node.get("policy")),
            "organization_strategy": self._optional_string(node.get("organizationStrategy")),
        }

    def _empty_aircraft_support_v1_support_node(self, node_name: str) -> dict[str, Any]:
        return {
            "id": node_name,
            "name": node_name,
            "airport": "",
            "airport_id": "",
            "node_type": None,
            "support_level": None,
            "personnel_capacity": 0,
            "equipment_capacity": 0,
            "inventory": {},
            "product_names": {},
            "lateral_support_nodes": [],
            "transport_policies": [],
            "policy": None,
            "organization_strategy": None,
        }

    def _support_node_runtime_name(self, node: dict[str, Any]) -> str:
        return str(node.get("name") or node.get("supportNodeName") or node.get("id") or "support-node")

    def _support_resource_node_name(self, resource: dict[str, Any], aliases: dict[str, str]) -> str:
        for key in ("supportNodeName", "organizationNodeName", "organizationNodeId", "supportNodeId"):
            value = resource.get(key)
            if value not in (None, ""):
                return aliases.get(str(value), str(value))
        return aliases.get(str(resource.get("id") or ""), "")

    def _support_node_reference_aliases(self, project: dict[str, Any]) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for node in self._dict_list(project.get("supportNodes")):
            name = self._support_node_runtime_name(node)
            for key in ("id", "name", "organizationNodeId", "supportNodeId"):
                value = node.get(key)
                if value not in (None, ""):
                    aliases[str(value)] = name
            aliases[name] = name
        for resource in self._dict_list(project.get("supportResources")):
            node_name = str(resource.get("supportNodeName") or resource.get("organizationNodeName") or "").strip()
            if node_name:
                aliases[node_name] = node_name
        return aliases

    def _project_transport_policies(self, project: dict[str, Any]) -> list[dict[str, Any]]:
        policies = copy.deepcopy(self._dict_list(project.get("transportPolicies")))
        for node in self._dict_list(project.get("supportNodes")):
            policies.extend(copy.deepcopy(self._dict_list(node.get("transportPolicies"))))
        return policies

    def _aircraft_support_v1_transport_policy(
        self,
        policy: dict[str, Any],
        aliases: dict[str, str],
        products_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        from_value = str(policy.get("fromSupportNodeName") or policy.get("from") or "")
        to_value = str(policy.get("toSupportNodeName") or policy.get("to") or "")
        product_id = str(policy.get("productId") or "")
        return {
            "from": aliases.get(from_value, from_value),
            "to": aliases.get(to_value, to_value),
            "product_id": product_id,
            "capacity": self._positive_int(policy.get("capacity"), 1),
            "priority": self._positive_int(policy.get("priority"), 1),
            "transportTimeHours": self._non_negative_float(policy.get("transportTimeHours"), self._non_negative_float(policy.get("transport_time_hours"), 0.0)),
        }

    def _aircraft_support_v1_support_activity(
        self,
        activity: dict[str, Any],
        support_node_aliases: dict[str, str] | None = None,
        job_definitions: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        resource_id = str(activity.get("resourceId") or "")
        if support_node_aliases:
            resource_id = support_node_aliases.get(resource_id, resource_id)
        compiled = {
            "id": str(activity.get("id") or "support-activity"),
            "name": str(activity.get("name") or activity.get("activityName") or activity.get("id") or "support activity"),
            "activity_type": str(activity.get("activityType") or activity.get("planType") or "support activity"),
            "aircraft_model": str(activity.get("aircraftModel") or ""),
            "equipment_id": str(activity.get("equipmentId") or ""),
            "resource_id": resource_id,
            "priority": self._positive_int(activity.get("priority"), 1),
            "duration_minutes": self._positive_int(
                activity.get("durationMinutes"),
                self._positive_int(activity.get("durationHours"), 1) * 60,
            ),
            "required_personnel": self._positive_int(activity.get("requiredPersonnel"), 1),
            "required_devices": self._positive_int(activity.get("requiredDevices"), 1),
            "spare_quantity": self._positive_int(activity.get("spareQuantity"), 0),
            "calendarDayInterval": activity.get("calendarDayInterval"),
            "runHourInterval": activity.get("runHourInterval"),
            "takeoffLandingInterval": activity.get("takeoffLandingInterval"),
            "floatRatio": activity.get("floatRatio"),
            "jobs": self._support_activity_jobs_for_activity(activity, job_definitions or {}),
        }
        if self._support_activity_maintenance_kind(activity):
            methods, replacement_ratio = self._support_activity_maintenance_policy(activity)
            compiled["maintenance_methods"] = methods
            compiled["replacement_ratio"] = replacement_ratio
        return compiled

    def _support_activity_maintenance_kind(self, activity: dict[str, Any]) -> str:
        plan_type = str(activity.get("planType") or "").strip()
        activity_type = str(activity.get("activityType") or "").strip().lower()
        if plan_type == "预防性维修方案" or "preventive" in activity_type or "预防性维修" in activity_type:
            return "preventive"
        if plan_type == "修复性维修方案" or "corrective" in activity_type or "修复性维修" in activity_type:
            return "repair"
        return ""

    def _support_activity_maintenance_policy(self, activity: dict[str, Any]) -> tuple[list[str], float]:
        return list(activity["maintenanceMethods"]), float(activity["replacementRatio"])

    def _support_activity_job_definitions(self, project: dict[str, Any]) -> dict[str, dict[str, Any]]:
        definitions: dict[str, dict[str, Any]] = {}
        for job in self._dict_list(project.get("supportActivityJobs")):
            code = str(job.get("activityCode") or "").strip()
            if code and code not in definitions:
                definitions[code] = self._support_activity_job_definition(job)
        return definitions

    def _support_activity_job_definition(self, job: dict[str, Any]) -> dict[str, Any]:
        definition = copy.deepcopy(job)
        for field in (
            "maxRepairTimeMinutes",
            "meanRepairTimeMinutes",
            "mttrMinutes",
            "mttr",
            "repairDistribution",
            "repairDistributionType",
            "repairTypes",
        ):
            definition.pop(field, None)
        return definition

    def _support_activity_jobs_for_activity(
        self,
        activity: dict[str, Any],
        job_definitions: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        legacy_jobs = self._dict_list(activity.get("jobs"))
        if legacy_jobs:
            return copy.deepcopy(legacy_jobs)
        activity_codes = activity.get("activityCodes")
        if not isinstance(activity_codes, list):
            return []
        predecessors = activity.get("predecessors") if isinstance(activity.get("predecessors"), dict) else {}
        jobs: list[dict[str, Any]] = []
        for raw_code in activity_codes:
            code = str(raw_code or "").strip()
            if not code or code not in job_definitions:
                continue
            job = copy.deepcopy(job_definitions[code])
            raw_predecessors = predecessors.get(code)
            job["predecessors"] = [str(value) for value in raw_predecessors] if isinstance(raw_predecessors, list) else []
            jobs.append(job)
        return jobs

    def _aviation_support_mapping_provenance(self, project_id: str, project: dict[str, Any]) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "modeling_snapshot_id": None,
            "experiment_plan_id": None,
            "model_family": "aviation_support",
            "mapping_version": "aviation-support-input-v0",
            "consumed_fields": [
                "equipment.quantity",
                "missionProfile.missionCount",
                "basicMissions[].equipmentQuantity",
                "supportNodes[].personnelCapacity",
                "supportNodes[].equipmentCapacity",
                "monteCarlo.lruFailureMultipliers",
                "experiment.seed",
            ],
            "defaults_applied": self._aviation_support_defaults_applied(project),
            "derived_fields": [
                "simulation_inputs.fuel_trucks",
                "simulation_inputs.maintenance_bays",
            ],
            "ignored_fields": [
                "components[].failureRate",
                "supportActivities[]",
            ],
            "unsupported_fields": [],
        }

    def _aircraft_support_v1_mapping_provenance(
        self,
        project_id: str,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "modeling_snapshot_id": None,
            "experiment_plan_id": None,
            "model_family": "aircraft_support_v1",
            "mapping_version": "aircraft-support-v1-input-v0",
            "consumed_fields": [
                "combatUnit.members",
                "missionProfile.combatUnit.members",
                "missionProfile.durationHours",
                "missionProfile.compositeTasks",
                "missionProfile.periodicTasks",
                "basicMissions",
                "basicMissions[].missionPhases",
                "airports",
                "products[]",
                "components[].productId",
                "components[].aircraftModel",
                "components[].failureDistribution",
                "components[].kOutOfN",
                "components[].specialRepairProfile",
                "supportResources[].quantity",
                "supportResources[].type",
                "supportResources[].productId",
                "supportResources[].supportNodeName",
                "transportPolicies[]",
                "supportActivityJobs[]",
                "supportActivities[].aircraftModel",
                "supportActivities[].equipmentId",
                "supportActivities[].activityCodes",
                "supportActivities[].predecessors",
                "supportActivities[].maintenanceMethods",
                "supportActivities[].replacementRatio",
                "ExperimentPlan.config.analysisRequests.largeSample.sweep.failureRates",
                "ExperimentPlan.config.analysisRequests.largeSample.sweep.spareMultipliers",
                "ExperimentPlan.config.analysisRequests.largeSample.sweep.supportCapacities",
                "ExperimentPlan.config.seed",
                "ExperimentPlan.config.samples",
                "ExperimentPlan.config.stopPolicy",
            ],
            "defaults_applied": self._aircraft_support_v1_defaults_applied(project, runtime_config),
            "derived_fields": [
                "simulation_inputs.project_identity",
                "simulation_inputs.aircraft.initial_ready",
                "simulation_inputs.support_activities.activities[].aircraft_model",
                "simulation_inputs.support_activities.activities[].equipment_id",
                "simulation_inputs.support_activities.activities[].maintenance_methods",
                "simulation_inputs.support_activities.activities[].replacement_ratio",
                "simulation_inputs.time.duration_minutes",
                "simulation_inputs.time.requested_steps",
                "ExperimentPlan.config.steps",
            ],
            "ignored_fields": [],
            "governance_only_fields": [
                "projectInfo",
                "missionProfile.combatUnit",
                "scenarioId",
                "project_id",
                "project_version",
                "supportOrganization.tree",
            ],
            "unsupported_fields": self._aircraft_support_v1_unsupported_fields(project),
        }

    def _aircraft_support_v1_defaults_applied(
        self,
        project: dict[str, Any],
        runtime_config: dict[str, Any] | None = None,
    ) -> list[str]:
        defaults = [
            "time.tick_minutes=1",
            "time.sample_every_minutes=30",
            "time.max_state_frames_single=2000",
        ]
        equipment = project.get("equipment") if isinstance(project.get("equipment"), dict) else {}
        mission_profile = project.get("missionProfile") if isinstance(project.get("missionProfile"), dict) else {}
        experiment = self._runtime_experiment_config(project, runtime_config)
        monte_carlo = self._runtime_monte_carlo_config(project, runtime_config)
        combat_members = self._aircraft_support_v1_combat_members(project, mission_profile)
        if not combat_members and not self._is_positive_number(equipment.get("initialReady")):
            defaults.append("aircraft.initialReady=derivedFleetCount")
        if not self._is_positive_number(mission_profile.get("durationHours")) and not self._mission_profile_has_periodic_duration(mission_profile):
            defaults.append("missionProfile.durationHours=24")
        if self._uses_root_mission_phase_fallback(project):
            defaults.append("basicMissions[].missionPhases=legacyRootMissionPhases")
        if not self._is_positive_number(experiment.get("steps")):
            defaults.append("ExperimentPlan.config.steps=durationMinutes/sampleEveryMinutes")
        if not self._is_positive_number(experiment.get("samples")):
            defaults.append("ExperimentPlan.config.samples=1")
        if not self._has_any_number(monte_carlo.get("failureRates")):
            defaults.append("ExperimentPlan.config.analysisRequests.largeSample.sweep.failureRates=[1.0]")
        if not self._has_any_number(monte_carlo.get("spareMultipliers")):
            defaults.append("ExperimentPlan.config.analysisRequests.largeSample.sweep.spareMultipliers=[1.0]")
        if not self._has_any_number(monte_carlo.get("supportCapacities")):
            defaults.append("ExperimentPlan.config.analysisRequests.largeSample.sweep.supportCapacities=[1]")
        if not self._is_number(experiment.get("seed")):
            defaults.append("ExperimentPlan.config.seed=0")
        if not self._runtime_stop_policy_sources(project, runtime_config):
            defaults.append("ExperimentPlan.config.stopPolicy=duration")
        return defaults

    def _aircraft_support_v1_unsupported_fields(self, project: dict[str, Any]) -> list[str]:
        return []

    def _is_empty_support_organization(self, value: Any) -> bool:
        if value in (None, {}, []):
            return True
        if not isinstance(value, dict):
            return False
        tree = value.get("tree")
        non_empty_other_values = [
            item for key, item in value.items() if key != "tree" and item not in (None, "", [], {})
        ]
        return tree in (None, []) and not non_empty_other_values

    def _aviation_support_defaults_applied(self, project: dict[str, Any]) -> list[str]:
        defaults: list[str] = []
        if not self._is_positive_number(project.get("equipment", {}).get("quantity")):
            defaults.append("equipment.quantity=8")
        if not self._is_positive_number(project.get("missionProfile", {}).get("missionCount")):
            defaults.append("missionProfile.missionCount=3")
        if not self._is_positive_number(self._primary_basic_mission(project).get("equipmentQuantity")):
            defaults.append("basicMissions[].equipmentQuantity=1")
        if not any(
            isinstance(node, dict) and self._is_positive_number(node.get("personnelCapacity"))
            for node in project.get("supportNodes", [])
        ):
            defaults.append("supportNodes[].personnelCapacity=1")
        if not any(
            isinstance(node, dict) and self._is_positive_number(node.get("equipmentCapacity"))
            for node in project.get("supportNodes", [])
        ):
            defaults.append("supportNodes[].equipmentCapacity=1")
        if not self._has_any_number(project.get("monteCarlo", {}).get("lruFailureMultipliers")):
            defaults.append("monteCarlo.lruFailureMultipliers=1.0")
        if not self._is_number(project.get("experiment", {}).get("seed")):
            defaults.append("experiment.seed=0")
        return defaults

    def _compile_gate_provenance(self, project: dict[str, Any], model_family: str) -> dict[str, Any]:
        if model_family == "aviation_support":
            return self._aviation_support_mapping_provenance(self._project_id(project), project)
        if model_family == "aircraft_support_v1":
            return self._aircraft_support_v1_mapping_provenance(self._project_id(project), project)
        return {
            "project_id": self._project_id(project),
            "modeling_snapshot_id": None,
            "experiment_plan_id": None,
            "model_family": model_family,
            "mapping_version": f"{model_family}-input-v0",
            "consumed_fields": [],
            "defaults_applied": [],
            "derived_fields": [],
            "ignored_fields": [],
            "unsupported_fields": ["model_family"],
        }

    def _with_modeling_import_validation_provenance(
        self,
        provenance: dict[str, Any],
        project: dict[str, Any],
    ) -> dict[str, Any]:
        validation_scope = project.get("modelingImportValidation")
        if not isinstance(validation_scope, dict):
            return provenance

        enriched = copy.deepcopy(provenance)
        used_tables = validation_scope.get("usedTables") if isinstance(validation_scope.get("usedTables"), dict) else {}
        normalized_used_tables = {
            str(domain): enabled
            for domain, enabled in used_tables.items()
            if isinstance(enabled, bool)
        }
        disabled_domains = validation_scope.get("disabledDomains")
        if not isinstance(disabled_domains, list):
            disabled_domains = [domain for domain, enabled in normalized_used_tables.items() if enabled is False]

        enriched["used_tables"] = normalized_used_tables
        enriched["disabled_domains"] = [str(domain) for domain in disabled_domains]
        enriched["validation_warnings"] = copy.deepcopy(validation_scope.get("warnings") or [])
        return enriched

    def _scenario_with_mapping_provenance(
        self,
        scenario: dict[str, Any],
        provenance: dict[str, Any],
    ) -> dict[str, Any]:
        enriched = copy.deepcopy(scenario)
        mapping_provenance = enriched.get("compiled_from", {}).get("mapping_provenance")
        if isinstance(mapping_provenance, dict):
            mapping_provenance.update(copy.deepcopy(provenance))
        return enriched

    def _modeling_import_domain_disabled(self, project: dict[str, Any], domain: str) -> bool:
        validation_scope = project.get("modelingImportValidation")
        if not isinstance(validation_scope, dict):
            return False
        used_tables = validation_scope.get("usedTables") if isinstance(validation_scope.get("usedTables"), dict) else {}
        disabled_domains = validation_scope.get("disabledDomains") if isinstance(validation_scope.get("disabledDomains"), list) else []
        return used_tables.get(domain) is False or domain in disabled_domains

    def _aircraft_support_v1_compile_issues(self, project: dict[str, Any]) -> list[dict[str, str]]:
        issues: list[dict[str, str]] = []
        products = self._dict_list(project.get("products"))
        components = self._dict_list(project.get("components"))
        support_resources = self._dict_list(project.get("supportResources"))
        support_nodes = self._dict_list(project.get("supportNodes"))
        support_activities = self._dict_list(project.get("supportActivities"))
        mission_profile = project.get("missionProfile") if isinstance(project.get("missionProfile"), dict) else {}
        support_resources_disabled = self._modeling_import_domain_disabled(project, "supportResources")
        support_activities_disabled = self._modeling_import_domain_disabled(project, "supportActivities")

        issues.extend(self._periodic_profile_compile_issues(project))

        if not components:
            issues.append(
                self._compile_issue(
                    "missing_equipment_tree",
                    "components",
                    "装备树不能为空，aircraft_support_v1 需要可审计的装备组成。",
                    "装备系统建模",
                )
            )
        if not products:
            issues.append(
                self._compile_issue(
                    "missing_product_catalog",
                    "products",
                    "产品目录不能为空，aircraft_support_v1 需要组件和备件资源引用正式产品。",
                    "建模表单管理",
                )
            )
        if not support_nodes and not support_resources_disabled:
            issues.append(
                self._compile_issue(
                    "missing_support_network",
                    "supportNodes",
                    "保障资源节点不能为空，aircraft_support_v1 需要保障网络输入。",
                    "保障资源建模",
                )
            )
        if not support_activities and not support_activities_disabled:
            issues.append(
                self._compile_issue(
                    "missing_support_activities",
                    "supportActivities",
                    "保障活动不能为空，aircraft_support_v1 需要保障活动 DAG 输入。",
                    "保障活动建模",
                )
            )
        if not self._is_positive_number(mission_profile.get("durationHours")) and not self._mission_profile_has_periodic_duration(mission_profile):
            issues.append(
                self._compile_issue(
                    "missing_mission_duration",
                    "missionProfile.durationHours",
                    "任务剖面 durationHours 必须大于 0，或周期任务必须提供可推导总时长的周期/重复配置。",
                    "任务剖面参数",
                )
            )

        product_ids: set[str] = set()
        for product_index, product in enumerate(products):
            product_id = str(product.get("id") or "").strip()
            if not product_id:
                continue
            if product_id in product_ids:
                issues.append(
                    self._compile_issue(
                        "duplicate_product_id",
                        f"products[{product_index}].id",
                        f"产品 ID {product_id} 重复。",
                        "建模表单管理",
                    )
                )
            product_ids.add(product_id)

        component_ids = {str(component.get("id")) for component in components if component.get("id") not in (None, "")}
        support_node_aliases = self._support_node_reference_aliases(project)
        support_node_ids = set(support_node_aliases.keys()) | set(support_node_aliases.values())
        support_activity_job_definitions = self._support_activity_job_definitions(project)
        tail_seen: dict[str, str] = {}
        combat_unit = project.get("combatUnit") if isinstance(project.get("combatUnit"), dict) else {}
        if not combat_unit:
            combat_unit = mission_profile.get("combatUnit") if isinstance(mission_profile.get("combatUnit"), dict) else {}
        for member_index, member in enumerate(self._dict_list(combat_unit.get("members"))):
            raw_tail = member.get("aircraftNo") or member.get("tailNumber") or member.get("tail_number")
            normalized_tail = _normalized_aircraft_tail_number(raw_tail)
            if not normalized_tail:
                continue
            if normalized_tail in tail_seen:
                issues.append(
                    self._compile_issue(
                        "duplicate_aircraft_tail_number",
                        f"combatUnit.members[{member_index}].aircraftNo",
                        f"飞机尾号 {raw_tail} 与 {tail_seen[normalized_tail]} 归一化后重复。",
                        "基本作战单元建模",
                    )
                )
            else:
                tail_seen[normalized_tail] = str(raw_tail).strip()
        for index, component in enumerate(components):
            product_id = str(component.get("productId") or "").strip()
            if not product_id or product_id not in product_ids:
                issues.append(
                    self._compile_issue(
                        "missing_product_reference",
                        f"components[{index}].productId",
                        f"组件 productId 必须引用存在的产品，当前值为 {product_id or '<empty>'}。",
                        "装备系统建模",
                    )
                )
            parent_id = component.get("parentId")
            if parent_id in (None, ""):
                continue
            if str(parent_id) not in component_ids:
                issues.append(
                    self._compile_issue(
                        "missing_component_parent",
                        f"components[{index}].parentId",
                        f"组件 parentId 引用了不存在的组件 {parent_id}。",
                        "装备系统建模",
                    )
                )
            distribution = component.get("failureDistribution")
            if not isinstance(distribution, dict) or self._failure_distribution_rate(distribution) is None:
                issues.append(
                    self._compile_issue(
                        "invalid_component_failure_distribution",
                        f"components[{index}].failureDistribution",
                        "非根组件必须提供可解析的 failureDistribution，不能回退到 failureRate 或默认失效率。",
                        "装备系统建模",
                    )
                )

        for resource_index, resource in enumerate(support_resources):
            if str(resource.get("type") or "").strip().lower() != "spare":
                continue
            product_id = str(resource.get("productId") or "").strip()
            if not product_id or product_id not in product_ids:
                issues.append(
                    self._compile_issue(
                        "missing_product_reference",
                        f"supportResources[{resource_index}].productId",
                        f"备件资源 productId 必须引用存在的产品，当前值为 {product_id or '<empty>'}。",
                        "保障资源建模",
                    )
                )
        for job_index, job in enumerate(self._dict_list(project.get("supportActivityJobs"))):
            for spare_index, requirement in enumerate(self._dict_list(job.get("spare"))):
                product_id = str(requirement.get("productId") or "").strip()
                if not product_id or product_id not in product_ids:
                    issues.append(
                        self._compile_issue(
                            "missing_product_reference",
                            f"supportActivityJobs[{job_index}].spare[{spare_index}].productId",
                            f"保障活动备件需求 productId 必须引用存在的产品，当前值为 {product_id or '<empty>'}。",
                            "保障活动建模",
                        )
                    )
        for policy_index, policy in enumerate(self._project_transport_policies(project)):
            product_id = str(policy.get("productId") or "").strip()
            if product_id and product_id not in product_ids:
                issues.append(
                    self._compile_issue(
                        "missing_product_reference",
                        f"transportPolicies[{policy_index}].productId",
                        f"运输策略 productId 必须引用存在的产品，当前值为 {product_id or '<empty>'}。",
                        "保障资源建模",
                    )
                )
            for endpoint in ("from", "to"):
                field_name = "fromSupportNodeName" if endpoint == "from" else "toSupportNodeName"
                value = policy.get(field_name, policy.get(endpoint))
                if value in (None, ""):
                    continue
                if str(value) not in support_node_ids:
                    issues.append(
                        self._compile_issue(
                            "missing_transport_node_reference",
                            f"transportPolicies[{policy_index}].{field_name}",
                            f"运输策略 {field_name} 引用了不存在的保障节点 {value}。",
                            "保障资源建模",
                        )
                    )
            for endpoint in ("from", "to"):
                value = policy.get(endpoint)
                if value in (None, ""):
                    continue
                if str(value) not in support_node_ids:
                    issues.append(
                        self._compile_issue(
                            "missing_transport_node_reference",
                            f"transportPolicies[{policy_index}].{endpoint}",
                            f"运输策略 {endpoint} 引用了不存在的保障节点 {value}。",
                            "保障资源建模",
                        )
                    )

        for activity_index, activity in enumerate(support_activities):
            equipment_id = activity.get("equipmentId")
            if equipment_id not in (None, "") and str(equipment_id) not in component_ids:
                issues.append(
                    self._compile_issue(
                        "missing_equipment_reference",
                        f"supportActivities[{activity_index}].equipmentId",
                        f"保障活动 equipmentId 引用了不存在的装备组件 {equipment_id}。",
                        "保障活动建模",
                    )
                )
            resource_id = activity.get("resourceId")
            if resource_id not in (None, "") and str(resource_id) not in support_node_ids:
                issues.append(
                    self._compile_issue(
                        "missing_support_resource_reference",
                        f"supportActivities[{activity_index}].resourceId",
                        f"保障活动 resourceId 引用了不存在的保障资源 {resource_id}。",
                        "保障活动建模",
                    )
                )
            legacy_jobs = self._dict_list(activity.get("jobs"))
            if not legacy_jobs and isinstance(activity.get("activityCodes"), list):
                for code_index, raw_code in enumerate(activity.get("activityCodes") or []):
                    code = str(raw_code or "").strip()
                    if code and code not in support_activity_job_definitions:
                        issues.append(
                            self._compile_issue(
                                "missing_support_activity_job_reference",
                                f"supportActivities[{activity_index}].activityCodes[{code_index}]",
                                f"保障活动引用了不存在的基本保障活动 activityCode {code}。",
                                "保障活动建模",
                            )
                        )
            jobs = self._support_activity_jobs_for_activity(activity, support_activity_job_definitions)
            job_codes = {str(job.get("activityCode")) for job in jobs if job.get("activityCode") not in (None, "")}
            predecessor_graph: dict[str, list[str]] = {}
            for job_index, job in enumerate(jobs):
                job_code = str(job.get("activityCode") or "")
                predecessors = job.get("predecessors")
                if predecessors is None:
                    if job_code:
                        predecessor_graph[job_code] = []
                    continue
                if not isinstance(predecessors, list):
                    issues.append(
                        self._compile_issue(
                            "invalid_support_activity_predecessors",
                            f"supportActivities[{activity_index}].jobs[{job_index}].predecessors",
                            "保障活动 job predecessors 必须是数组。",
                            "保障活动建模",
                        )
                    )
                    continue
                if job_code:
                    predecessor_graph[job_code] = [str(predecessor) for predecessor in predecessors if str(predecessor) in job_codes]
                for predecessor in predecessors:
                    if str(predecessor) not in job_codes:
                        issues.append(
                            self._compile_issue(
                                "missing_support_activity_predecessor",
                                f"supportActivities[{activity_index}].predecessors.{job_code}" if not legacy_jobs else f"supportActivities[{activity_index}].jobs[{job_index}].predecessors",
                                f"保障活动 job 前序引用了不存在的 activityCode {predecessor}。",
                                "保障活动建模",
                            )
                        )
            if _has_cycle(predecessor_graph):
                issues.append(
                    self._compile_issue(
                        "circular_support_activity_predecessor",
                        f"supportActivities[{activity_index}].predecessors" if not legacy_jobs else f"supportActivities[{activity_index}].jobs[].predecessors",
                        "保障活动工作项目存在环形紧前关系。",
                        "保障活动建模",
                    )
                )

        return issues

    def _compile_issue(self, code: str, field_path: str, message: str, page: str) -> dict[str, str]:
        return {
            "code": code,
            "message": message,
            "field_path": field_path,
            "page": page,
            "severity": "error",
            "suggestion": "修正输入引用后重新编译 aircraft_support_v1 Scenario。",
        }

    def _assert_aircraft_support_v1_scenario(self, scenario: dict[str, Any]) -> None:
        model = scenario.get("simulation_model", {})
        if scenario.get("schema_version") != SCENARIO_SCHEMA_VERSION:
            raise AdapterError("invalid_scenario", "unsupported scenario schema version")
        if model.get("family") != "aircraft_support_v1" or model.get("model_id") != "AircraftSupportV1Model":
            raise AdapterError("unsupported_model_family", "run_scenario received a non aircraft_support_v1 scenario")
        provenance = scenario.get("compiled_from", {}).get("mapping_provenance", {})
        unsupported_fields = list(provenance.get("unsupported_fields") or [])
        if unsupported_fields:
            raise AdapterError(
                "unsupported_aircraft_support_v1_fields",
                "aircraft_support_v1 single run refuses Scenario inputs with unsupported M9.6 fields",
                unsupported_fields=unsupported_fields,
                m9_7_4_coverage_hardening=True,
            )

    def _run_aircraft_support_v1_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        self._assert_aircraft_support_v1_scenario(scenario)
        if steps < 0:
            raise AdapterError("bad_steps", "steps must be non-negative", steps=steps)

        from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model

        inputs = scenario["simulation_inputs"]
        model = AircraftSupportV1Model(copy.deepcopy(inputs))
        run_id = run_id or f"run-{scenario['scenario_id']}"
        try:
            execution = model.run()
        except ValueError as exc:
            raise AdapterError(
                "state_series_frame_limit_exceeded",
                str(exc),
                max_state_frames_single=inputs.get("time", {}).get("max_state_frames_single"),
                sample_every_minutes=inputs.get("time", {}).get("sample_every_minutes"),
            ) from exc
        snapshot = execution["metrics"]
        state_series_frames = []
        for frame in execution["frames"]:
            traced = copy.deepcopy(frame)
            traced["run_id"] = run_id
            state_series_frames.append(traced)

        result_id = f"result-{run_id}"
        manifest_id = f"artifact-manifest-{run_id}"
        now = _utc_now()
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "model_family": "aircraft_support_v1",
            "result_id": result_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "metrics": snapshot,
        }
        result_summary_artifact_id = f"result_summary-{run_id}"
        projections = self._aircraft_support_v1_analysis_projections(
            snapshot,
            result_summary_artifact_id,
            samples=[
                {
                    "sample_index": 0,
                    "seed": inputs["seed"],
                    "sweep": {},
                    "frames": state_series_frames,
                    "events": copy.deepcopy(execution.get("events") or []),
                    "downtime_events": copy.deepcopy(execution.get("downtime_events") or []),
                }
            ],
            run_id=run_id,
            validation_scope=scenario.get("compiled_from", {}).get("mapping_provenance", {}),
            simulation_inputs=inputs,
        )
        result["analysis_outputs"] = {
            "spare_shortage": projections["spare_shortfall"]["data"],
            "carry_list": projections["carry_list"]["data"],
            "mission_reliability": projections["mission_reliability"]["data"],
            "downtime_factors": projections["downtime_factors"]["data"],
        }
        behavior_scope = AircraftSupportV1Model.behavior_scope()
        run_config = {
            "schema_version": "run-config-v0",
            "run_id": run_id,
            "run_type": "single",
            "model_family": "aircraft_support_v1",
            "project_id": scenario["project_id"],
            "experiment_plan_id": None,
            "modeling_snapshot_id": None,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "seed": inputs["seed"],
            "steps": steps,
            "tick_minutes": inputs.get("time", {}).get("tick_minutes"),
            "sample_every_minutes": inputs.get("time", {}).get("sample_every_minutes"),
            "duration_minutes": inputs.get("time", {}).get("duration_minutes"),
            "m9_7_4_behavior_scope": copy.deepcopy(behavior_scope),
        }
        input_project = self._input_project_for_scenario(scenario)
        metrics = {
            "schema_version": "metrics-v0",
            "run_id": run_id,
            "metrics": snapshot,
        }
        report = {
            "schema_version": "run-report-v0",
            "run_id": run_id,
            "title": "Aircraft support v1 single run report",
            "summary": {
                "status": "succeeded",
                "seed": inputs["seed"],
                "duration_minutes": inputs.get("time", {}).get("duration_minutes"),
                "tick_minutes": inputs.get("time", {}).get("tick_minutes"),
                "sample_every_minutes": inputs.get("time", {}).get("sample_every_minutes"),
                "sortie_completion_rate": snapshot.get("sortie_completion_rate", 0),
                "available_aircraft": snapshot.get("available_aircraft", 0),
                "maintenance_backlog": snapshot.get("maintenance_backlog", 0),
            },
            "m9_7_4_behavior_scope": copy.deepcopy(behavior_scope),
        }
        event_log = {
            "schema_version": "run-log-v0",
            "run_id": run_id,
            "events": [
                {"event": "run_started", "at": now},
                {
                    "event": "m9_7_4_behavior_scope_declared",
                    "at": now,
                    "behavior_driving_fields": behavior_scope["behavior_driving_fields"],
                    "fail_closed_fields": behavior_scope["fail_closed_fields"],
                    "m9_7_4_coverage_hardening_fields": behavior_scope["m9_7_4_coverage_hardening_fields"],
                },
                *[
                    {
                        "event": event.get("event", "aircraft_support_v1_event"),
                        "at": now,
                        "time": event.get("time"),
                        "message": event.get("message", ""),
                    }
                    for event in execution["events"][-40:]
                ],
                {"event": "run_completed", "at": now, "status": "succeeded"},
            ],
        }
        visualization_state_series = self._visualization_state_series_payload(
            run_id=run_id,
            scenario=scenario,
            model_family="aircraft_support_v1",
            result_summary_id=result_id,
            artifact_manifest_id=manifest_id,
            frames=state_series_frames,
        )
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": "aircraft_support_v1",
            "model_id": "AircraftSupportV1Model",
            "status": "succeeded",
            "run_type": "single",
            "seed": inputs["seed"],
            "progress": 1,
            "started_at": now,
            "completed_at": now,
            "result_summary_id": result_id,
            "artifact_manifest_id": manifest_id,
            "error": None,
        }

        output_root = Path(output_dir)
        run_dir = output_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        artifact_specs = [
            ("run_config", "run-config.json", run_config, "run-config-v0"),
            ("input_project", "input-project.json", input_project, PROJECT_SCHEMA_VERSION),
            ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
            ("snapshot", "snapshot.json", snapshot, None),
            ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
            ("metrics", "metrics.json", metrics, "metrics-v0"),
            ("report", "report.json", report, "run-report-v0"),
            ("log", "events-log.json", event_log, "run-log-v0"),
            (
                "visualization_state_series",
                "visualization-state-series.json",
                visualization_state_series,
                VISUALIZATION_STATE_SERIES_SCHEMA_VERSION,
            ),
            ("analysis_projection_spare_shortfall", "spare-shortfall.json", projections["spare_shortfall"], "analysis-projection-v0"),
            ("analysis_projection_carry_list", "carry-list.json", projections["carry_list"], "analysis-projection-v0"),
            ("analysis_projection_mission_reliability", "mission-reliability.json", projections["mission_reliability"], "analysis-projection-v0"),
            ("analysis_projection_downtime_factors", "downtime-factors.json", projections["downtime_factors"], "analysis-projection-v0"),
        ]
        artifacts = [
            self._write_artifact(run_dir, output_root, kind, filename, payload, schema_version)
            for kind, filename, payload, schema_version in artifact_specs
        ]
        for artifact in artifacts:
            kind = artifact.get("kind", "")
            if str(kind).startswith("analysis_projection_"):
                artifact["source_artifact_id"] = result_summary_artifact_id
                artifact["analysis_type"] = str(kind).removeprefix("analysis_projection_")
        self._annotate_state_series_artifact(artifacts, run_id, result_id, scenario["scenario_id"])
        manifest = {
            "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
            "artifact_manifest_id": manifest_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "created_at": now,
            "artifacts": artifacts,
        }
        self._write_json(run_dir / "artifact-manifest.json", manifest)
        return {"run": run, "result": result, "artifact_manifest": manifest}

    def _run_aircraft_support_v1_monte_carlo_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
        monte_carlo_config: dict[str, Any] | None = None,
    ) -> dict[str, dict[str, Any]]:
        self._assert_aircraft_support_v1_scenario(scenario)
        if steps < 0:
            raise AdapterError("bad_steps", "steps must be non-negative", steps=steps)

        from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model

        inputs = scenario["simulation_inputs"]
        config = self._require_monte_carlo_config(monte_carlo_config=monte_carlo_config, legacy_config={})
        run_id = run_id or f"run-{scenario['scenario_id']}-mc"
        result_id = f"result-{run_id}"
        manifest_id = f"artifact-manifest-{run_id}"
        mc_experiment_id = config.get("mc_experiment_id") or f"mc-{run_id.removeprefix('run-')}"
        now = _utc_now()

        profile = self._monte_carlo_profile(scenario, monte_carlo_config=config)
        parallel_cores = self._validate_monte_carlo_parallel_cores(config.get("parallel_cores", 1))
        worker_count = min(parallel_cores, len(profile["sample_points"]))
        sampling_contract = self._aircraft_support_v1_monte_carlo_sampling_contract(profile)
        samples, failed_samples = self._execute_aircraft_support_v1_monte_carlo_samples(
            inputs,
            profile["sample_points"],
            steps=steps,
            worker_count=worker_count,
        )
        if not samples:
            raise AdapterError(
                "monte_carlo_all_samples_failed",
                "aircraft_support_v1 Monte Carlo run has no successful samples to aggregate",
                failed_samples=failed_samples,
            )

        aggregate = self._aggregate_sample_metrics(samples)
        metric_moments = build_monte_carlo_metric_moments(
            samples,
            total_sample_count=profile["sample_count"],
            failed_sample_count=len(failed_samples),
        )
        self._coerce_result_integer_metrics(aggregate)
        if "mission_success_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["mission_success_rate"]
        elif "sortie_completion_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["sortie_completion_rate"]
        base_artifact_id = f"monte_carlo_base-{run_id}"
        projections = self._aircraft_support_v1_analysis_projections(
            aggregate,
            base_artifact_id,
            samples=samples,
            run_id=run_id,
            validation_scope=scenario.get("compiled_from", {}).get("mapping_provenance", {}),
            simulation_inputs=inputs,
        )
        behavior_scope = AircraftSupportV1Model.behavior_scope()
        input_project = self._input_project_for_scenario(scenario)
        base_artifact = {
            "artifact_type": "monte_carlo_base",
            "model_family": "aircraft_support_v1",
            "run_id": run_id,
            "mc_experiment_id": mc_experiment_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "mapping_provenance": copy.deepcopy(scenario["compiled_from"]["mapping_provenance"]),
            "mapping_version": scenario["compiled_from"]["mapping_provenance"].get("mapping_version"),
            "sampling_contract": sampling_contract,
            "sample_count": profile["sample_count"],
            "seed": inputs["seed"],
            "sweep": profile["sweep"],
            "sample_points": profile["sample_points"],
            "samples": samples,
            "failed_samples": failed_samples,
            "aggregate_metrics": aggregate,
            "metric_moments": metric_moments,
            "logs_summary": {
                "completed_samples": len(samples),
                "failed_samples": len(failed_samples),
                "executor": "local_sync_aircraft_support_v1" if worker_count == 1 else "process_pool_aircraft_support_v1",
                "parallel_cores": parallel_cores,
                "worker_count": worker_count,
            },
        }
        run_config = {
            "schema_version": "run-config-v0",
            "run_id": run_id,
            "run_type": "monte_carlo",
            "model_family": "aircraft_support_v1",
            "project_id": scenario["project_id"],
            "experiment_plan_id": None,
            "modeling_snapshot_id": None,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "seed": inputs["seed"],
            "steps": steps,
            "mc_experiment_id": mc_experiment_id,
            "monte_carlo_config": copy.deepcopy(config),
            "sampling_contract": copy.deepcopy(sampling_contract),
            "m9_7_4_behavior_scope": copy.deepcopy(behavior_scope),
        }
        sample_results = {
            "schema_version": "sample-results-v0",
            "run_id": run_id,
            "mc_experiment_id": mc_experiment_id,
            "model_family": "aircraft_support_v1",
            "samples": samples,
            "failed_samples": failed_samples,
        }
        aggregate_result = {
            "schema_version": "aggregate-result-v0",
            "run_id": run_id,
            "mc_experiment_id": mc_experiment_id,
            "model_family": "aircraft_support_v1",
            "aggregate_metrics": aggregate,
            "metric_moments": metric_moments,
            "failed_sample_count": len(failed_samples),
        }
        metrics = {
            "schema_version": "metrics-v0",
            "run_id": run_id,
            "metrics": aggregate,
        }
        report = {
            "schema_version": "run-report-v0",
            "run_id": run_id,
            "title": "Aircraft support v1 Monte Carlo run report",
            "summary": {
                "status": "succeeded",
                "sample_count": profile["sample_count"],
                "completed_samples": len(samples),
                "failed_samples": len(failed_samples),
                "seed": inputs["seed"],
                "mc_experiment_id": mc_experiment_id,
                "sortie_completion_rate": aggregate.get("sortie_completion_rate", 0),
                "available_aircraft": aggregate.get("available_aircraft", 0),
            },
            "m9_7_4_behavior_scope": copy.deepcopy(behavior_scope),
        }
        event_log = {
            "schema_version": "run-log-v0",
            "run_id": run_id,
            "events": [
                {"event": "run_started", "at": now},
                {
                    "event": "m9_7_4_monte_carlo_scope_declared",
                    "at": now,
                    "behavior_driving_fields": behavior_scope["behavior_driving_fields"],
                    "fail_closed_fields": behavior_scope["fail_closed_fields"],
                    "m9_7_4_coverage_hardening_fields": behavior_scope["m9_7_4_coverage_hardening_fields"],
                },
                {
                    "event": "samples_completed",
                    "at": now,
                    "completed_samples": len(samples),
                    "failed_samples": len(failed_samples),
                },
                {"event": "run_completed", "at": now, "status": "succeeded"},
            ],
        }
        visualization_state_series = self._visualization_state_series_payload(
            run_id=run_id,
            scenario=scenario,
            model_family="aircraft_support_v1",
            result_summary_id=result_id,
            artifact_manifest_id=manifest_id,
            frames=self._aircraft_support_v1_monte_carlo_visualization_frames(run_id, samples),
        )
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "model_family": "aircraft_support_v1",
            "result_id": result_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "metrics": aggregate,
            "analysis_outputs": {
                "large_sample_summary": projections["large_sample_summary"]["data"],
                "spare_shortage": projections["spare_shortfall"]["data"],
                "carry_list": projections["carry_list"]["data"],
                "mission_reliability": projections["mission_reliability"]["data"],
                "downtime_factors": projections["downtime_factors"]["data"],
                "monte_carlo_metric_moments": metric_moments,
            },
        }
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": "aircraft_support_v1",
            "model_id": "AircraftSupportV1Model",
            "status": "succeeded",
            "run_type": "monte_carlo",
            "seed": inputs["seed"],
            "progress": 1,
            "started_at": now,
            "completed_at": now,
            "result_summary_id": result_id,
            "artifact_manifest_id": manifest_id,
            "error": None,
            "experiment_id": f"experiment-{run_id}",
            "experiment_type": "monte_carlo",
            "mc_experiment_id": mc_experiment_id,
        }

        output_root = Path(output_dir)
        run_dir = output_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        artifact_specs = [
            ("run_config", "run-config.json", run_config, "run-config-v0"),
            ("input_project", "input-project.json", input_project, PROJECT_SCHEMA_VERSION),
            ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
            ("sample_results", "sample-results.json", sample_results, "sample-results-v0"),
            ("aggregate_result", "aggregate-result.json", aggregate_result, "aggregate-result-v0"),
            ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
            ("metrics", "metrics.json", metrics, "metrics-v0"),
            ("report", "report.json", report, "run-report-v0"),
            ("log", "events-log.json", event_log, "run-log-v0"),
            ("monte_carlo_base", "monte-carlo-base.json", base_artifact, None),
            (
                "visualization_state_series",
                "visualization-state-series.json",
                visualization_state_series,
                VISUALIZATION_STATE_SERIES_SCHEMA_VERSION,
            ),
            ("analysis_projection_spare_shortfall", "spare-shortfall.json", projections["spare_shortfall"], "analysis-projection-v0"),
            ("analysis_projection_carry_list", "carry-list.json", projections["carry_list"], "analysis-projection-v0"),
            ("analysis_projection_mission_reliability", "mission-reliability.json", projections["mission_reliability"], "analysis-projection-v0"),
            ("analysis_projection_downtime_factors", "downtime-factors.json", projections["downtime_factors"], "analysis-projection-v0"),
        ]
        artifacts = [
            self._write_artifact(run_dir, output_root, kind, filename, payload, schema_version)
            for kind, filename, payload, schema_version in artifact_specs
        ]
        for artifact in artifacts:
            kind = artifact.get("kind", "")
            if str(kind).startswith("analysis_projection_"):
                artifact["source_artifact_id"] = base_artifact_id
                artifact["analysis_type"] = str(kind).removeprefix("analysis_projection_")
        self._annotate_state_series_artifact(artifacts, run_id, result_id, scenario["scenario_id"])
        self._annotate_representative_sample_artifact(artifacts, samples)
        manifest = {
            "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
            "artifact_manifest_id": manifest_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "created_at": now,
            "artifacts": artifacts,
        }
        self._write_json(run_dir / "artifact-manifest.json", manifest)
        return {"run": run, "result": result, "artifact_manifest": manifest}

    def _execute_aircraft_support_v1_monte_carlo_samples(
        self,
        inputs: dict[str, Any],
        sample_points: list[dict[str, Any]],
        *,
        steps: int,
        worker_count: int,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        tasks = [
            (inputs, point, steps, sample_index)
            for sample_index, point in enumerate(sample_points)
        ]
        if worker_count == 1:
            outcomes = [self._run_aircraft_support_v1_monte_carlo_worker_task(task) for task in tasks]
        else:
            with ProcessPoolExecutor(
                max_workers=worker_count,
                mp_context=multiprocessing.get_context("spawn"),
            ) as executor:
                futures = [executor.submit(_aircraft_support_v1_monte_carlo_process_worker, task) for task in tasks]
                outcomes = [future.result() for future in as_completed(futures)]
        outcomes.sort(key=lambda outcome: outcome["sample_index"])
        samples = [outcome["sample"] for outcome in outcomes if outcome["status"] == "ok"]
        failed_samples = [outcome["failure"] for outcome in outcomes if outcome["status"] == "failed"]
        return samples, failed_samples

    def _run_aircraft_support_v1_monte_carlo_worker_task(
        self,
        task: tuple[dict[str, Any], dict[str, Any], int, int],
    ) -> dict[str, Any]:
        inputs, point, steps, sample_index = task
        try:
            sample = self._run_aircraft_support_v1_monte_carlo_sample(
                inputs,
                point,
                steps=steps,
                sample_index=sample_index,
            )
            return {"status": "ok", "sample_index": sample_index, "sample": sample}
        except AdapterError as exc:
            failure = self._failed_monte_carlo_sample(sample_index, point, exc.code, str(exc), exc.details)
        except Exception as exc:
            failure = self._failed_monte_carlo_sample(sample_index, point, "sample_failed", str(exc), {})
        return {"status": "failed", "sample_index": sample_index, "failure": failure}

    def _aircraft_support_v1_monte_carlo_sampling_contract(self, profile: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": "aircraft-support-v1-monte-carlo-sampling-v0",
            "model_family": "aircraft_support_v1",
            "sample_count": profile["sample_count"],
            "dimensions": [
                {
                    "source": "analysisRequests.largeSample.sweep.failureRates",
                    "target": "AircraftSupportV1Model.components[].failure_rate",
                    "interpretation": "multiplier applied to compiled component failure_rate values",
                    "values": profile["sweep"]["failureRates"],
                },
                {
                    "source": "analysisRequests.largeSample.sweep.spareMultipliers",
                    "target": "AircraftSupportV1Model supportResources[type=spare].quantity",
                    "interpretation": "multiplier applied to compiled spare resource quantities",
                    "values": profile["sweep"]["spareMultipliers"],
                },
                {
                    "source": "analysisRequests.largeSample.sweep.supportCapacities",
                    "target": "AircraftSupportV1Model supportResources[type=personnel|equipment].quantity",
                    "interpretation": "sample-level override for compiled personnel and equipment capacity",
                    "values": profile["sweep"]["supportCapacities"],
                },
            ],
            "seed_policy": "sample_seed = compiled Scenario seed + sample_index",
            "sample_point_policy": "sample_count must cover every cartesian sweep point; extra samples repeat points in deterministic order",
            "failed_sample_policy": "sample errors are recorded in failed_samples; aggregate metrics use successful samples only",
            "m9_7_4_closed_field_policy": (
                "M9.6 frozen aircraft_support_v1 fields are behavior-driving, derived/defaulted, or governance-only; "
                "no M9.7.4 pending field list remains."
            ),
        }

    def _run_aircraft_support_v1_monte_carlo_sample(
        self,
        inputs: dict[str, Any],
        point: dict[str, Any],
        *,
        steps: int,
        sample_index: int,
    ) -> dict[str, Any]:
        from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model

        sample_inputs = copy.deepcopy(inputs)
        sample_inputs["seed"] = point["seed"]
        self._apply_aircraft_support_v1_failure_multiplier(sample_inputs, point["failure_rate"])
        self._apply_aircraft_support_v1_spare_multiplier(sample_inputs, point["spare_multiplier"])
        self._apply_aircraft_support_v1_capacity(sample_inputs, point["support_capacity"])
        model = AircraftSupportV1Model(sample_inputs)
        execution = model.run()
        mission_wave_reliability = self._aircraft_support_v1_sample_mission_wave_reliability(model.missions)
        period_outcome = mission_period_outcome(
            model.missions,
            duration_days=execution.get("metrics", {}).get("simulation_days", 0),
        )
        sweep = {
            "failure_rate": point["failure_rate"],
            "spare_multiplier": point["spare_multiplier"],
            "support_capacity": point["support_capacity"],
        }
        frames = []
        max_frames = max(1, int(steps)) if steps > 0 else 1
        for sample_step, frame in enumerate(execution["frames"][:max_frames]):
            item = copy.deepcopy(frame)
            item["sample_index"] = sample_index
            item["sample_step"] = sample_step
            item["seed"] = point["seed"]
            item["sweep"] = copy.deepcopy(sweep)
            frames.append(item)
        if not frames:
            item = model.visualization_frame(run_id="", step=0)
            item["sample_index"] = sample_index
            item["sample_step"] = 0
            item["seed"] = point["seed"]
            item["sweep"] = copy.deepcopy(sweep)
            frames.append(item)
        return {
            "sample_index": sample_index,
            "seed": point["seed"],
            "sweep": sweep,
            "metrics": execution["metrics"],
            "mission_wave_reliability": mission_wave_reliability,
            "period_outcome": period_outcome,
            "frames": frames,
            "events": copy.deepcopy(execution.get("events") or []),
            "downtime_events": copy.deepcopy(execution.get("downtime_events") or []),
        }

    def _apply_aircraft_support_v1_failure_multiplier(self, inputs: dict[str, Any], multiplier: float) -> None:
        for component in inputs.get("equipment_tree", {}).get("components", []):
            if not isinstance(component, dict):
                continue
            component["failure_rate"] = max(0.0, float(component.get("failure_rate", 0) or 0) * float(multiplier))
            distribution = component.get("failure_distribution")
            if isinstance(distribution, dict):
                distribution["_rate_multiplier"] = max(0.0, float(multiplier))

    def _apply_aircraft_support_v1_spare_multiplier(self, inputs: dict[str, Any], multiplier: float) -> None:
        for node in inputs.get("support_network", {}).get("nodes", []):
            if not isinstance(node, dict):
                continue
            inventory = node.get("inventory")
            if not isinstance(inventory, dict):
                continue
            node["inventory"] = {
                str(key): max(0, int(round(float(value or 0) * float(multiplier))))
                for key, value in inventory.items()
                if isinstance(value, (int, float))
            }

    def _apply_aircraft_support_v1_capacity(self, inputs: dict[str, Any], capacity: int) -> None:
        capacity_value = max(1, int(capacity))
        for node in inputs.get("support_network", {}).get("nodes", []):
            if not isinstance(node, dict):
                continue
            node["personnel_capacity"] = capacity_value
            node["equipment_capacity"] = capacity_value

    def _failed_monte_carlo_sample(
        self,
        sample_index: int,
        point: dict[str, Any],
        code: str,
        message: str,
        details: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "sample_index": sample_index,
            "seed": point.get("seed"),
            "sweep": {
                "failure_rate": point.get("failure_rate"),
                "spare_multiplier": point.get("spare_multiplier"),
                "support_capacity": point.get("support_capacity"),
            },
            "error": {
                "code": code,
                "message": message,
                "details": copy.deepcopy(details),
            },
        }

    def _coerce_result_integer_metrics(self, metrics: dict[str, Any]) -> None:
        for key in [
            "available_aircraft",
            "active_jobs",
            "spare_stock_total",
            "spare_consumed_total",
            "maintenance_backlog",
            "lru_failures",
        ]:
            if key in metrics and self._is_number(metrics[key]):
                metrics[key] = max(0, int(round(float(metrics[key]))))

    def _annotate_representative_sample_artifact(
        self,
        artifacts: list[dict[str, Any]],
        samples: list[dict[str, Any]],
    ) -> None:
        if not samples:
            return
        sample = samples[0]
        for artifact in artifacts:
            if artifact.get("kind") != "visualization_state_series":
                continue
            artifact["representative_sample_id"] = int(sample.get("sample_index", 0))
            artifact["representative_sample_seed"] = int(sample.get("seed", 0))
            artifact["representative_sample_sweep"] = copy.deepcopy(sample.get("sweep") or {})
            artifact["representative_sample_reason"] = "first successful deterministic sample"
            artifact["representative_sample_frame_count"] = len(sample.get("frames") or [])

    def _aircraft_support_v1_monte_carlo_visualization_frames(
        self,
        run_id: str,
        samples: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        next_step = 0
        representative_sample = samples[0] if samples else {}
        for sample_frame in representative_sample.get("frames") or []:
            frame = copy.deepcopy(sample_frame)
            frame["run_id"] = run_id
            frame["step"] = next_step
            frame["simulation_time"] = next_step
            frames.append(frame)
            next_step += 1
        return frames

    def _aviation_visualization_state_frame(self, run_id: str, state: dict[str, Any], step: int) -> dict[str, Any]:
        metrics = state["snapshot"]
        aircraft_count = max(1, int(metrics.get("aircraft_count", 1) or 1))
        planned_sorties = max(1, int(metrics.get("planned_sorties", 1) or 1))
        spare_total = float(metrics.get("spare_stock_total", 0) or 0) + float(metrics.get("spare_consumed_total", 0) or 0)
        spare_fill_rate = 1.0 if spare_total <= 0 else float(metrics.get("spare_stock_total", 0) or 0) / spare_total
        event_items = state.get("events") or [
            {
                "time": metrics.get("time", 0),
                "event": "state_frame",
                "message": "aviation_support state frame generated",
            }
        ]
        return {
            "run_id": run_id,
            "step": step,
            "simulation_time": float(metrics.get("time", 0) or 0),
            "aircraft_state": {
                "ready_rate": float(metrics.get("available_aircraft", 0) or 0) / aircraft_count,
                "failed_count": float(metrics.get("maintenance_aircraft", 0) or 0),
                "repairing_count": float(metrics.get("maintenance_aircraft", 0) or 0),
                "sortie_count": float(metrics.get("launched_sorties", 0) or 0),
            },
            "mission_state": {
                "mission_success_rate": float(
                    metrics.get("mission_success_rate", metrics.get("sortie_completion_rate", 0)) or 0
                ),
                "sortie_rate": float(metrics.get("launched_sorties", 0) or 0) / planned_sorties,
                "mean_launch_time": float(metrics.get("avg_departure_delay", 0) or 0),
                "mean_recovery_time": float(metrics.get("avg_departure_delay", 0) or 0),
                "mean_turnaround_time": float(metrics.get("avg_departure_delay", 0) or 0),
            },
            "resource_state": {
                "spare_fill_rate": spare_fill_rate,
                "spare_utilization": 1.0 - spare_fill_rate,
                "repair_backlog": float(metrics.get("maintenance_backlog", 0) or 0),
            },
            "event_summary": {
                "shortage_events": 0,
                "downtime_failure_events": float(metrics.get("lru_failures", 0) or 0),
                "downtime_spare_shortage_events": 0,
                "downtime_resource_delay_events": float(metrics.get("delayed_sorties", 0) or 0),
            },
            "aircraft": copy.deepcopy(state.get("aircraft") or []),
            "missions": copy.deepcopy(state.get("missions") or []),
            "resources": copy.deepcopy(state.get("resources") or []),
            "spares": copy.deepcopy(state.get("spares") or []),
            "jobs": copy.deepcopy(state.get("jobs") or []),
            "events": [
                {
                    "time": float(event.get("time", 0) or 0),
                    "event": str(event.get("event") or "aviation_event"),
                    "event_type": str(event.get("event") or "aviation_event"),
                    "message": str(event.get("message") or "aviation support event"),
                    "metric_refs": self._aviation_event_metric_refs(str(event.get("event") or "")),
                }
                for event in event_items
            ],
        }

    def _aviation_event_metric_refs(self, event_type: str) -> list[str]:
        if event_type.startswith("mission"):
            return ["sortie_completion_rate", "avg_departure_delay"]
        if event_type.startswith("spare"):
            return ["spare_stock_total", "spare_consumed_total"]
        if event_type.startswith("job") or event_type.startswith("task"):
            return ["active_jobs", "maintenance_backlog"]
        return ["sortie_completion_rate", "available_aircraft", "active_jobs"]

    def _aviation_analysis_projections(
        self,
        metrics: dict[str, Any],
        source_artifact_id: str,
    ) -> dict[str, dict[str, Any]]:
        spare_stock_total = max(0.0, float(metrics.get("spare_stock_total", 0) or 0))
        spare_consumed_total = max(0.0, float(metrics.get("spare_consumed_total", 0) or 0))
        spare_denominator = max(1.0, spare_stock_total + spare_consumed_total)
        spare_fill_rate = min(1.0, spare_stock_total / spare_denominator)
        shortage_probability = min(1.0, metrics.get("spare_shortage_probability", 0)) if "spare_shortage_probability" in metrics else (
            1.0 if spare_stock_total <= 0 and spare_consumed_total > 0 else 0.0
        )
        sortie_completion_rate = min(1.0, max(0.0, float(metrics.get("sortie_completion_rate", 0) or 0)))
        planned_sorties = max(1.0, float(metrics.get("planned_sorties", 1) or 1))
        sortie_rate = min(1.0, max(0.0, float(metrics.get("launched_sorties", 0) or 0) / planned_sorties))
        failure_events = max(0.0, float(metrics.get("lru_failures", 0) or 0))
        spare_delay_events = max(0.0, float(shortage_probability))
        resource_delay_events = max(0.0, float(metrics.get("delayed_sorties", 0) or 0))
        downtime_total = failure_events + spare_delay_events + resource_delay_events or 1.0
        risk_level = "high" if shortage_probability >= 0.2 else "medium" if shortage_probability > 0 else "low"
        return {
            "spare_shortfall": {
                "projection_type": "spare_shortfall",
                "base_artifact_id": source_artifact_id,
                "data": [
                    {
                        "spare_type": "aviation_support_spares",
                        "fill_rate": spare_fill_rate,
                        "shortage_probability": shortage_probability,
                        "risk_level": risk_level,
                    }
                ],
            },
            "carry_list": {
                "projection_type": "carry_list",
                "base_artifact_id": source_artifact_id,
                "data": [
                    {
                        "spare_type": "aviation_support_spares",
                        "recommended_multiplier": max(1.0, 1.0 + shortage_probability),
                        "risk_level": risk_level,
                    }
                ],
            },
            "mission_reliability": {
                "projection_type": "mission_reliability",
                "base_artifact_id": source_artifact_id,
                "data": {
                    "mission_success_probability": sortie_completion_rate,
                    "sortie_rate": sortie_rate,
                    "target_met": sortie_completion_rate >= 0.9,
                },
            },
            "downtime_factors": {
                "projection_type": "downtime_factors",
                "base_artifact_id": source_artifact_id,
                "data": [
                    {"factor": "failure", "contribution": failure_events / downtime_total},
                    {"factor": "spare_shortage", "contribution": spare_delay_events / downtime_total},
                    {"factor": "resource_delay", "contribution": resource_delay_events / downtime_total},
                ],
            },
        }

    def _aircraft_support_v1_scoped_spare_projection_rows(
        self,
        metrics: dict[str, Any],
        samples: list[dict[str, Any]],
        simulation_inputs: dict[str, Any],
    ) -> list[dict[str, Any]]:
        scoped_nodes = self._aircraft_support_v1_scoped_support_nodes(simulation_inputs)
        scoped_node_ids = {str(node.get("id") or "") for node in scoped_nodes if str(node.get("id") or "")}
        modeled_aircraft_models = self._aircraft_support_v1_modeled_aircraft_models(simulation_inputs)
        spare_models = self._aircraft_support_v1_spare_models(simulation_inputs, modeled_aircraft_models)
        product_names = self._aircraft_support_v1_product_names(simulation_inputs)
        baseline_quantities: dict[str, int] = {}
        for node in scoped_nodes:
            inventory = node.get("inventory") if isinstance(node.get("inventory"), dict) else {}
            for raw_product_id, quantity in inventory.items():
                product_id = str(raw_product_id or "").strip()
                if not product_id or not self._is_number(quantity):
                    continue
                baseline_quantities[product_id] = baseline_quantities.get(product_id, 0) + self._positive_int(quantity, 0)

        stats = self._aircraft_support_v1_spare_event_stats(samples, scoped_node_ids)
        for _aircraft_model, product_id in stats:
            baseline_quantities.setdefault(product_id, 0)
        for product_id in spare_models:
            baseline_quantities.setdefault(product_id, 0)

        rows = []
        sample_count = max(1, len(samples))
        planned_sorties = max(1.0, float(metrics.get("planned_sorties", 1) or 1))
        mean_transport_delay = max(0.0, float(metrics.get("mean_transport_delay", 0) or 0))
        row_keys: list[tuple[str, str]] = []
        for product_id in baseline_quantities:
            event_models = {
                aircraft_model
                for aircraft_model, stat_product_id in stats
                if stat_product_id == product_id and aircraft_model in modeled_aircraft_models
            }
            models = event_models | spare_models.get(product_id, set())
            for aircraft_model in sorted(models):
                row_keys.append((aircraft_model, product_id))
        for row_key in sorted(stats):
            if row_key[0] in modeled_aircraft_models and row_key not in row_keys:
                row_keys.append(row_key)

        for aircraft_model, product_id in row_keys:
            baseline_quantity = baseline_quantities.get(product_id, 0)
            row_stats = stats.get((aircraft_model, product_id), {})
            consumed_quantity = max(0.0, float(row_stats.get("consumed_quantity", 0) or 0))
            shortage_count = max(0.0, float(row_stats.get("shortage_count", 0) or 0))
            shortage_quantity = max(0.0, float(row_stats.get("shortage_quantity", 0) or 0))
            demand_quantity = max(0.0, float(row_stats.get("demand_quantity", 0) or 0))
            demand_count = demand_quantity if demand_quantity > 0 else consumed_quantity + shortage_quantity
            filled_count = consumed_quantity
            fill_rate = filled_count / demand_count if demand_count > 0 else 1.0
            type_shortage_probability = min(1.0, shortage_count / planned_sorties)
            risk_level = self._aircraft_support_v1_spare_risk_level(fill_rate, type_shortage_probability)
            replenish_quantity = int(math.ceil(shortage_quantity / sample_count)) if shortage_quantity > 0 else 0
            recommended_quantity = max(0, baseline_quantity + replenish_quantity)
            carry_capacity = recommended_quantity * sample_count
            carry_utilization = max(0.0, consumed_quantity / carry_capacity) if carry_capacity > 0 else None
            rows.append(
                {
                    "aircraft_model": aircraft_model,
                    "product_id": product_id,
                    "spare_type": product_names.get(product_id, product_id),
                    "baseline_quantity": baseline_quantity,
                    "recommended_quantity": recommended_quantity,
                    "used_quantity": consumed_quantity,
                    "carried_quantity": carry_capacity,
                    "demand_count": demand_count,
                    "filled_count": filled_count,
                    "shortage_count": shortage_count,
                    "fill_rate": min(1.0, max(0.0, fill_rate)),
                    "utilization": min(1.0, consumed_quantity / max(1.0, float(baseline_quantity))),
                    "carry_utilization": carry_utilization,
                    "shortage_probability": type_shortage_probability,
                    "mean_transport_delay": mean_transport_delay if shortage_count > 0 else 0.0,
                    "in_transit_count": 0,
                    "risk_level": risk_level,
                }
            )
        return rows

    def _aircraft_support_v1_modeled_aircraft_models(self, simulation_inputs: dict[str, Any]) -> set[str]:
        models = {
            str(asset.get("aircraft_type") or asset.get("aircraftType") or asset.get("model") or "").strip()
            for asset in simulation_inputs.get("aircraft", {}).get("assets", []) or []
            if isinstance(asset, dict)
        }
        models.update(
            str(component.get("aircraft_model") or component.get("aircraftModel") or "").strip()
            for component in simulation_inputs.get("equipment_tree", {}).get("components", []) or []
            if isinstance(component, dict)
        )
        return {model for model in models if model}

    def _aircraft_support_v1_spare_models(
        self,
        simulation_inputs: dict[str, Any],
        modeled_aircraft_models: set[str],
    ) -> dict[str, set[str]]:
        spare_models: dict[str, set[str]] = {}
        for component in simulation_inputs.get("equipment_tree", {}).get("components", []) or []:
            if not isinstance(component, dict):
                continue
            product_type = str(component.get("product_type") or component.get("productType") or "").strip().casefold()
            if product_type == "whole":
                continue
            aircraft_model = str(component.get("aircraft_model") or component.get("aircraftModel") or "").strip()
            product_id = str(component.get("product_id") or "").strip()
            if aircraft_model not in modeled_aircraft_models or not product_id:
                continue
            spare_models.setdefault(product_id, set()).add(aircraft_model)
        return spare_models

    def _aircraft_support_v1_product_names(self, simulation_inputs: dict[str, Any]) -> dict[str, str]:
        product_names: dict[str, str] = {}
        for component in simulation_inputs.get("equipment_tree", {}).get("components", []) or []:
            if not isinstance(component, dict):
                continue
            product_id = str(component.get("product_id") or "").strip()
            if product_id:
                product_names[product_id] = str(component.get("product_name") or product_id)
        for node in simulation_inputs.get("support_network", {}).get("nodes", []) or []:
            if not isinstance(node, dict) or not isinstance(node.get("product_names"), dict):
                continue
            product_names.update(
                {
                    str(product_id): str(name or product_id)
                    for product_id, name in node["product_names"].items()
                    if str(product_id or "").strip()
                }
            )
        return product_names

    def _aircraft_support_v1_scoped_support_nodes(self, simulation_inputs: dict[str, Any]) -> list[dict[str, Any]]:
        nodes = [
            item for item in simulation_inputs.get("support_network", {}).get("nodes", [])
            if isinstance(item, dict)
        ]
        nodes_by_id = {str(node.get("id") or ""): node for node in nodes if str(node.get("id") or "")}
        if not nodes_by_id:
            return []

        airports = [
            item for item in simulation_inputs.get("mission_profile", {}).get("airports", [])
            if isinstance(item, dict)
        ]
        aircraft_tokens = self._aircraft_support_v1_aircraft_airport_tokens(simulation_inputs)
        matched_airports = [
            airport for airport in airports
            if self._aircraft_support_v1_scope_matches(airport, aircraft_tokens)
        ]
        if not matched_airports and airports:
            matched_airports = [airports[0]]

        support_node_ids: set[str] = set()
        for airport in matched_airports:
            for key in ("supportNodeId", "support_node_id", "id"):
                value = str(airport.get(key) or "").strip()
                if value:
                    support_node_ids.add(value)

        scoped_nodes = [nodes_by_id[node_id] for node_id in support_node_ids if node_id in nodes_by_id]
        if scoped_nodes:
            return scoped_nodes

        node_matches = [
            node for node in nodes
            if self._aircraft_support_v1_scope_matches(node, aircraft_tokens)
            and isinstance(node.get("inventory"), dict)
            and node.get("inventory")
        ]
        if node_matches:
            return node_matches

        return [
            node for node in nodes
            if isinstance(node.get("inventory"), dict) and node.get("inventory")
        ][:1]

    def _aircraft_support_v1_aircraft_airport_tokens(self, simulation_inputs: dict[str, Any]) -> set[str]:
        tokens: set[str] = set()
        for asset in simulation_inputs.get("aircraft", {}).get("assets", []) or []:
            if not isinstance(asset, dict):
                continue
            for key in ("airport", "airport_id", "airportId", "baseAirportId"):
                token = self._normalized_scope_token(asset.get(key))
                if token:
                    tokens.add(token)
        return tokens

    def _aircraft_support_v1_scope_matches(self, item: dict[str, Any], tokens: set[str]) -> bool:
        if not tokens:
            return False
        for key in (
            "id",
            "name",
            "airport",
            "airport_id",
            "airportId",
            "baseAirportId",
            "airportCode",
            "code",
            "location",
            "supportNodeId",
            "support_node_id",
        ):
            if self._normalized_scope_token(item.get(key)) in tokens:
                return True
        return False

    def _normalized_scope_token(self, value: Any) -> str:
        return str(value or "").strip().casefold()

    def _aircraft_support_v1_spare_event_stats(
        self,
        samples: list[dict[str, Any]],
        scoped_node_ids: set[str],
    ) -> dict[tuple[str, str], dict[str, float]]:
        demand_quantities: dict[tuple[str, str], dict[tuple[str, ...], float]] = {}
        filled_quantities: dict[tuple[str, str], dict[tuple[str, ...], float]] = {}
        shortage_quantities: dict[tuple[str, str], dict[tuple[str, ...], float]] = {}
        for sample in samples:
            sample_key = str(sample.get("sample_index", sample.get("seed", "")))
            for event_index, event in enumerate(sample.get("events") or []):
                if not isinstance(event, dict):
                    continue
                event_name = str(event.get("event") or event.get("event_type") or "")
                if event_name not in {"spare_shortage", "spare_consumed"}:
                    continue
                details = event.get("details") if isinstance(event.get("details"), dict) else {}
                product_id = str(details.get("product_id") or details.get("productId") or details.get("spare_type") or "").strip()
                if not product_id:
                    continue
                aircraft_model = str(
                    details.get("aircraft_model")
                    or details.get("aircraftModel")
                    or ""
                ).strip()
                if not aircraft_model:
                    continue
                node_id = str(
                    details.get("resource_id")
                    or details.get("support_node_id")
                    or details.get("supportNodeId")
                    or details.get("node_id")
                    or ""
                ).strip()
                if scoped_node_ids and node_id and node_id not in scoped_node_ids:
                    continue
                quantity = max(1.0, self._non_negative_number(details.get("quantity"), 1.0))
                job_id = str(details.get("job_id") or details.get("jobId") or "").strip()
                event_key = job_id or f"event-{event_index}"
                spare_key = (aircraft_model, product_id)
                demand_key = (sample_key, node_id, aircraft_model, product_id, event_key)
                if event_name == "spare_consumed":
                    filled_quantities.setdefault(spare_key, {})[demand_key] = max(
                        filled_quantities.setdefault(spare_key, {}).get(demand_key, 0.0),
                        quantity,
                    )
                    demand_quantities.setdefault(spare_key, {})[demand_key] = max(
                        demand_quantities.setdefault(spare_key, {}).get(demand_key, 0.0),
                        quantity,
                    )
                else:
                    required = max(
                        quantity,
                        self._non_negative_number(details.get("required_quantity"), quantity),
                    )
                    shortage_quantities.setdefault(spare_key, {})[demand_key] = max(
                        shortage_quantities.setdefault(spare_key, {}).get(demand_key, 0.0),
                        required,
                    )
                    demand_quantities.setdefault(spare_key, {})[demand_key] = max(
                        demand_quantities.setdefault(spare_key, {}).get(demand_key, 0.0),
                        required,
                    )
        stats: dict[tuple[str, str], dict[str, float]] = {}
        for spare_key in sorted(set(demand_quantities) | set(filled_quantities) | set(shortage_quantities)):
            stats[spare_key] = {
                "consumed_quantity": sum(filled_quantities.get(spare_key, {}).values()),
                "shortage_count": float(len(shortage_quantities.get(spare_key, {}))),
                "shortage_quantity": sum(shortage_quantities.get(spare_key, {}).values()),
                "demand_quantity": sum(demand_quantities.get(spare_key, {}).values()),
            }
        return stats

    def _aircraft_support_v1_spare_risk_level(self, fill_rate: float, shortage_probability: float) -> str:
        if shortage_probability >= 0.2 or fill_rate < 0.85:
            return "high"
        if shortage_probability > 0 or fill_rate < 1.0:
            return "medium"
        return "low"

    def _aircraft_support_v1_analysis_projections(
        self,
        metrics: dict[str, Any],
        source_artifact_id: str,
        samples: list[dict[str, Any]] | None = None,
        run_id: str = "",
        validation_scope: dict[str, Any] | None = None,
        simulation_inputs: dict[str, Any] | None = None,
    ) -> dict[str, dict[str, Any]]:
        projection_applicability = {
            projection_type: self._aircraft_support_v1_projection_applicability(projection_type, validation_scope or {})
            for projection_type in (
                "large_sample_summary",
                "spare_shortfall",
                "carry_list",
                "mission_reliability",
                "downtime_factors",
            )
        }
        planned_sorties = max(1.0, float(metrics.get("planned_sorties", 1) or 1))
        shortage_events = max(0.0, float(metrics.get("shortage_events", 0) or 0))
        shortage_probability = min(1.0, shortage_events / planned_sorties)
        spare_fill_rate = min(1.0, max(0.0, float(metrics.get("spare_fill_rate", 0) or 0)))
        spare_utilization = min(1.0, max(0.0, float(metrics.get("spare_utilization", 0) or 0)))
        mission_success = min(1.0, max(0.0, float(metrics.get("mission_success_rate", metrics.get("sortie_completion_rate", 0)) or 0)))
        sortie_rate = max(0.0, float(metrics.get("sortie_rate", 0) or 0))
        downtime_values = {
            "failure": max(0.0, float(metrics.get("downtime_failure_hours", 0) or 0)),
            "equipment_shortage": max(0.0, float(metrics.get("downtime_equipment_shortage_hours", 0) or 0)),
            "spare_shortage": max(0.0, float(metrics.get("downtime_spare_shortage_hours", 0) or 0)),
            "preventive": max(0.0, float(metrics.get("downtime_preventive_hours", 0) or 0)),
        }
        downtime_total = sum(downtime_values.values()) or 1.0
        downtime_counts = {
            "failure": max(0, int(round(float(metrics.get("downtime_failure_events", 0) or 0)))),
            "equipment_shortage": max(0, int(round(float(metrics.get("downtime_equipment_shortage_events", 0) or 0)))),
            "spare_shortage": max(0, int(round(float(metrics.get("downtime_spare_shortage_events", 0) or 0)))),
            "preventive": max(0, int(round(float(metrics.get("downtime_preventive_events", 0) or 0)))),
        }
        downtime_event_details: list[dict[str, Any]] = []
        for sample in samples or []:
            for event in sample.get("downtime_events") or []:
                if not isinstance(event, dict) or event.get("factor") not in downtime_values:
                    continue
                item = normalize_downtime_event_for_analysis(event)
                item["sample_index"] = int(sample.get("sample_index", 0) or 0)
                item["seed"] = sample.get("seed")
                item["source_event_id"] = str(event.get("event_id") or "")
                item["event_id"] = (
                    f"sample-{item['sample_index']}-"
                    f"{item['source_event_id'] or len(downtime_event_details) + 1}"
                )
                downtime_event_details.append(item)
        if downtime_event_details:
            downtime_values = {factor: 0.0 for factor in downtime_values}
            downtime_counts = {factor: 0 for factor in downtime_counts}
            for event in downtime_event_details:
                factor = str(event["factor"])
                downtime_counts[factor] += 1
                downtime_values[factor] += max(0.0, float(event.get("duration_minutes", 0) or 0)) / 60.0
            downtime_total = sum(downtime_values.values()) or 1.0
        period_summary = period_completion_summary(samples or [])
        total_period_samples = period_summary["total_samples"]
        successful_period_samples = period_summary["successful_samples"]
        failed_period_samples = period_summary["failed_samples"]
        period_completion_probability = period_summary["completion_probability"]
        risk_level = "high" if shortage_probability >= 0.2 else "medium" if shortage_probability > 0 else "low"
        spare_rows = self._aircraft_support_v1_scoped_spare_projection_rows(
            metrics,
            samples or [],
            simulation_inputs if isinstance(simulation_inputs, dict) else {},
        )
        mission_wave_rows = self._aircraft_support_v1_mission_reliability_series(
            metrics=metrics,
            samples=samples or [],
        )
        task_reliability_result_fields = build_task_reliability_result_fields(
            sortie_rate=sortie_rate,
            wave_success_rate=mission_success,
            period_completion_probability=period_completion_probability,
            period_duration_days=period_summary["duration_days"],
        )
        return {
            "large_sample_summary": {
                "projection_type": "large_sample_summary",
                "run_id": run_id,
                "model_family": "aircraft_support_v1",
                "base_artifact_id": source_artifact_id,
                "applicability": projection_applicability["large_sample_summary"],
                "data": {
                    "sample_count": len(samples or []),
                    "mission_success_probability": mission_success,
                    "spare_fill_rate": spare_fill_rate,
                    "mean_repair_backlog": metrics.get("repair_backlog", 0),
                    "mean_postflight_backlog": metrics.get("postflight_backlog", 0),
                    "mean_preventive_backlog": metrics.get("preventive_backlog", 0),
                },
            },
            "spare_shortfall": {
                "projection_type": "spare_shortfall",
                "run_id": run_id,
                "model_family": "aircraft_support_v1",
                "base_artifact_id": source_artifact_id,
                "applicability": projection_applicability["spare_shortfall"],
                "constraints": {
                    "fill_rate": SPARE_SHORTFALL_CONSTRAINTS,
                    "utilization": SPARE_SHORTFALL_CONSTRAINTS,
                },
                "truncation": SPARE_SHORTFALL_TRUNCATION,
                "data": [
                    {
                        "aircraft_model": row.get("aircraft_model", "全部机型"),
                        "product_id": row["product_id"],
                        "spare_type": row["spare_type"],
                        "baseline_quantity": row["baseline_quantity"],
                        "demand_count": row["demand_count"],
                        "filled_count": row["filled_count"],
                        "shortage_count": row["shortage_count"],
                        "fill_rate": row["fill_rate"],
                        "utilization": row["utilization"],
                        "shortage_probability": row["shortage_probability"],
                        "mean_transport_delay": row["mean_transport_delay"],
                        "in_transit_count": row["in_transit_count"],
                        "risk_level": row["risk_level"],
                        "constraint_results": {
                            "fill_rate": self._spare_shortfall_constraint_result(row["fill_rate"]),
                            "utilization": self._spare_shortfall_constraint_result(row["utilization"]),
                        },
                    }
                    for row in spare_rows
                ],
            },
            "carry_list": {
                "projection_type": "carry_list",
                "run_id": run_id,
                "model_family": "aircraft_support_v1",
                "base_artifact_id": source_artifact_id,
                "applicability": projection_applicability["carry_list"],
                "data": [
                    {
                        "aircraft_model": row.get("aircraft_model", "全部机型"),
                        "product_id": row["product_id"],
                        "spare_type": row["spare_type"],
                        "baseline_quantity": row["baseline_quantity"],
                        "recommended_quantity": row["recommended_quantity"],
                        "used_quantity": row["used_quantity"],
                        "carried_quantity": row["carried_quantity"],
                        "recommended_multiplier": (
                            row["recommended_quantity"] / row["baseline_quantity"]
                            if row["baseline_quantity"] > 0
                            else max(1.0, 1.0 + row["shortage_probability"])
                        ),
                        "demand_count": row["demand_count"],
                        "shortage_count": row["shortage_count"],
                        "utilization": row["carry_utilization"],
                        "risk_level": row["risk_level"],
                        "minimum_satisfaction_rate": 0.9,
                        "hide_zero_demand": True,
                        "life_limited": False,
                        "life_landings": 0,
                        "life_hours": 0,
                    }
                    for row in spare_rows
                ],
            },
            "mission_reliability": {
                "projection_type": "mission_reliability",
                "run_id": run_id,
                "model_family": "aircraft_support_v1",
                "base_artifact_id": source_artifact_id,
                "applicability": projection_applicability["mission_reliability"],
                "data": {
                    "mission_success_probability": mission_success,
                    "sortie_rate": sortie_rate,
                    "failed_sorties": metrics.get("failed_sorties", 0),
                    "in_flight_failures": metrics.get("in_flight_failures", 0),
                    "target_met": mission_success >= 0.9,
                    "profile_reliability": mission_success,
                    "wave_success_rate": mission_success,
                    "period_completion_probability": period_completion_probability,
                    "period_duration_days": period_summary["duration_days"],
                    "result_fields": task_reliability_result_fields,
                    "total_samples": total_period_samples,
                    "successful_samples": successful_period_samples,
                    "failed_samples": failed_period_samples,
                    "valid_samples": total_period_samples,
                    "mission_wave_rows": mission_wave_rows,
                    "series": mission_wave_rows,
                },
            },
            "downtime_factors": {
                "projection_type": "downtime_factors",
                "run_id": run_id,
                "model_family": "aircraft_support_v1",
                "base_artifact_id": source_artifact_id,
                "applicability": projection_applicability["downtime_factors"],
                "data": [
                    {
                        "factor": factor,
                        "event_count": downtime_counts[factor],
                        "downtime_hours": value,
                        "contribution": value / downtime_total,
                        "duration_contribution": value / downtime_total,
                    }
                    for factor, value in downtime_values.items()
                ],
                "event_details": downtime_event_details,
                "anomaly_snapshots": self._aircraft_support_v1_downtime_anomaly_snapshots(samples or [], run_id),
            },
        }

    def _aircraft_support_v1_projection_applicability(
        self,
        projection_type: str,
        validation_scope: dict[str, Any],
    ) -> dict[str, Any]:
        required_domains_by_projection = {
            "large_sample_summary": set(),
            "spare_shortfall": {"supportResources", "supportActivities"},
            "carry_list": {"supportResources"},
            "mission_reliability": set(),
            "downtime_factors": {"supportResources", "supportActivities"},
        }
        required_domains = required_domains_by_projection.get(projection_type, set())
        disabled_domains = {
            str(domain)
            for domain in validation_scope.get("disabled_domains", [])
            if isinstance(domain, str)
        }
        disabled_domains.update(
            str(domain)
            for domain, enabled in (validation_scope.get("used_tables") or {}).items()
            if enabled is False
        )
        missing_domains = sorted(required_domains & disabled_domains)
        if missing_domains:
            return {
                "status": "not_applicable",
                "reason_code": "scope_not_modeled",
                "required_domains": sorted(required_domains),
                "disabled_domains": sorted(disabled_domains),
            }
        return {
            "status": "applicable",
            "required_domains": sorted(required_domains),
            "disabled_domains": sorted(disabled_domains),
        }

    def _aircraft_support_v1_downtime_anomaly_snapshots(
        self,
        samples: list[dict[str, Any]],
        run_id: str,
    ) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for sample in samples:
            sample_index = int(sample.get("sample_index", 0) or 0)
            seed = sample.get("seed")
            sweep = copy.deepcopy(sample.get("sweep") or {})
            snapshot_count_before_event_log = len(snapshots)
            for event in sample.get("events") or []:
                event_type = self._downtime_event_type(str(event.get("event_type") or event.get("event") or ""))
                event_snapshot = event.get("snapshot") if isinstance(event.get("snapshot"), dict) else None
                if not event_type or event_snapshot is None:
                    continue
                snapshots.append(
                    self._downtime_event_log_snapshot(
                        run_id=run_id,
                        ordinal=len(snapshots) + 1,
                        sample_index=sample_index,
                        seed=seed,
                        sweep=sweep,
                        event_type=event_type,
                        event=event,
                        event_snapshot=event_snapshot,
                    )
                )
                if len(snapshots) >= 20:
                    return snapshots
            if len(snapshots) > snapshot_count_before_event_log:
                continue
            for frame in sample.get("frames") or []:
                candidates = self._downtime_snapshot_events(frame)
                for event_type, event in candidates:
                    snapshots.append(
                        self._downtime_anomaly_snapshot(
                            run_id=run_id,
                            ordinal=len(snapshots) + 1,
                            sample_index=sample_index,
                            seed=seed,
                            sweep=sweep,
                            frame=frame,
                            event_type=event_type,
                            event=event,
                        )
                    )
                    if len(snapshots) >= 20:
                        return snapshots
        return snapshots

    def _downtime_event_log_snapshot(
        self,
        *,
        run_id: str,
        ordinal: int,
        sample_index: int,
        seed: Any,
        sweep: dict[str, Any],
        event_type: str,
        event: dict[str, Any],
        event_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        aircraft_state = copy.deepcopy(event_snapshot.get("aircraft_state") or {})
        support_resources = copy.deepcopy(event_snapshot.get("support_resources") or [])
        spare_shortages = copy.deepcopy(event_snapshot.get("spare_shortages") or [])
        active_jobs = [job for job in event_snapshot.get("active_jobs") or [] if isinstance(job, dict)]
        job = active_jobs[0] if active_jobs else {}
        support_activity_state = {
            "active_jobs": len(active_jobs),
            "repair_backlog": sum(1 for item in active_jobs if item.get("kind") == "repair"),
            "postflight_backlog": sum(1 for item in active_jobs if item.get("kind") == "postflight"),
            "preventive_backlog": sum(1 for item in active_jobs if item.get("kind") == "preventive"),
            "spare_fill_rate": float((event_snapshot.get("metrics") or {}).get("spare_fill_rate", 0) or 0),
        }
        return sanitize_downtime_user_projection({
            "snapshot_id": f"downtime-{run_id or 'run'}-{ordinal:04d}",
            "source": "model_event_log",
            "run_id": run_id,
            "sample_index": sample_index,
            "seed": seed,
            "sweep": sweep,
            "simulation_time": float(event.get("time", event_snapshot.get("time", 0)) or 0),
            "event_type": event_type,
            "event_label": event_type,
            "event": sanitize_downtime_user_projection(event),
            "result": self._downtime_snapshot_result(event_type),
            "aircraft_state": aircraft_state,
            "support_resources": support_resources,
            "spare_shortages": spare_shortages,
            "support_activity_state": support_activity_state,
            "job_node": {
                "job_id": str(job.get("job_id") or f"{event_type}-node"),
                "kind": str(job.get("kind") or event_type),
                "state": str(job.get("state") or "observed"),
                "task": str(job.get("task") or self._downtime_snapshot_result(event_type)),
                "tail_number": str(job.get("tail_number") or ""),
            },
            "frame_ref": {
                "sample_index": sample_index,
                "sample_step": int(float(event.get("time", event_snapshot.get("time", 0)) or 0)),
                "step": int(float(event.get("time", event_snapshot.get("time", 0)) or 0)),
            },
        })

    def _downtime_snapshot_events(self, frame: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        events: list[tuple[str, dict[str, Any]]] = []
        for event in frame.get("events") or []:
            event_type = str(event.get("event_type") or event.get("event") or "")
            downtime_type = self._downtime_event_type(event_type)
            if downtime_type:
                events.append((downtime_type, copy.deepcopy(event)))
        if events:
            return events
        summary = frame.get("event_summary") if isinstance(frame.get("event_summary"), dict) else {}
        fallback_map = [
            ("failure", "downtime_failure_events"),
            ("equipment_shortage", "downtime_equipment_shortage_events"),
            ("spare_shortage", "downtime_spare_shortage_events"),
            ("preventive", "downtime_preventive_events"),
        ]
        for event_type, metric in fallback_map:
            if float(summary.get(metric, 0) or 0) > 0:
                return [
                    (
                        event_type,
                        {
                            "time": frame.get("simulation_time", frame.get("step", 0)),
                            "event": event_type,
                            "event_type": event_type,
                            "message": f"{event_type} downtime metric exceeded zero",
                            "metric_refs": [metric],
                        },
                    )
                ]
        return []

    def _downtime_event_type(self, event_type: str) -> str:
        normalized = event_type.lower()
        if "spare" in normalized:
            return "spare_shortage"
        if "equipment_shortage" in normalized:
            return "equipment_shortage"
        if "preventive" in normalized:
            return "preventive"
        if "fail" in normalized:
            return "failure"
        return ""

    def _downtime_anomaly_snapshot(
        self,
        *,
        run_id: str,
        ordinal: int,
        sample_index: int,
        seed: Any,
        sweep: dict[str, Any],
        frame: dict[str, Any],
        event_type: str,
        event: dict[str, Any],
    ) -> dict[str, Any]:
        resource_state = frame.get("resource_state") if isinstance(frame.get("resource_state"), dict) else {}
        jobs = [job for job in frame.get("jobs") or [] if isinstance(job, dict)]
        job = jobs[0] if jobs else {}
        simulation_time = float(frame.get("simulation_time", event.get("time", frame.get("step", 0))) or 0)
        spare_shortages = self._downtime_frame_spare_shortages(frame, event)
        return sanitize_downtime_user_projection({
            "snapshot_id": f"downtime-{run_id or 'run'}-{ordinal:04d}",
            "source": "state_series_frame",
            "run_id": run_id,
            "sample_index": sample_index,
            "seed": seed,
            "sweep": sweep,
            "simulation_time": simulation_time,
            "event_type": event_type,
            "event_label": event_type,
            "event": sanitize_downtime_user_projection(event),
            "result": self._downtime_snapshot_result(event_type),
            "aircraft_state": copy.deepcopy(frame.get("aircraft_state") or {}),
            "support_resources": copy.deepcopy(frame.get("resources") or []),
            "spare_shortages": spare_shortages,
            "support_activity_state": {
                "active_jobs": len(jobs),
                "repair_backlog": float(resource_state.get("repair_backlog", 0) or 0),
                "postflight_backlog": float(resource_state.get("postflight_backlog", 0) or 0),
                "preventive_backlog": float(resource_state.get("preventive_backlog", 0) or 0),
                "spare_fill_rate": float(resource_state.get("spare_fill_rate", 0) or 0),
            },
            "job_node": {
                "job_id": str(job.get("job_id") or f"{event_type}-node"),
                "kind": str(job.get("kind") or event_type),
                "state": str(job.get("state") or "observed"),
                "task": str(job.get("task") or self._downtime_snapshot_result(event_type)),
                "tail_number": str(job.get("tail_number") or ""),
            },
            "frame_ref": {
                "sample_index": sample_index,
                "sample_step": int(frame.get("sample_step", frame.get("step", 0)) or 0),
                "step": int(frame.get("step", frame.get("sample_step", 0)) or 0),
            },
        })

    def _downtime_frame_spare_shortages(self, frame: dict[str, Any], event: dict[str, Any]) -> list[dict[str, Any]]:
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        spare_type = str(details.get("spare_type") or "")
        if spare_type:
            return [
                {
                    "spare_type": spare_type,
                    "required_quantity": int(details.get("required_quantity", 0) or 0),
                    "available_quantity": int(details.get("available_quantity", 0) or 0),
                    "resource_id": str(details.get("resource_id") or ""),
                    "job_id": str(details.get("job_id") or ""),
                    "reason": str(details.get("reason") or "spare_shortage"),
                }
            ]
        shortages = []
        for spare in frame.get("spares") or []:
            if not isinstance(spare, dict):
                continue
            if float(spare.get("quantity", 0) or 0) <= 0 and float(spare.get("consumed", 0) or 0) >= 0:
                shortages.append(
                    {
                        "spare_type": str(spare.get("name") or spare.get("part_id") or ""),
                        "required_quantity": 0,
                        "available_quantity": int(float(spare.get("quantity", 0) or 0)),
                        "resource_id": "",
                        "job_id": "",
                        "reason": "spare_shortage",
                    }
                )
        return shortages

    def _downtime_snapshot_result(self, event_type: str) -> str:
        if event_type == "spare_shortage":
            return "mission_delayed_by_spare_shortage"
        if event_type == "equipment_shortage":
            return "mission_delayed_by_equipment_shortage"
        if event_type == "preventive":
            return "aircraft_unavailable_for_preventive_maintenance"
        if event_type == "failure":
            return "aircraft_unavailable_after_failure"
        return "downtime_anomaly_recorded"

    def _aircraft_support_v1_mission_reliability_series(
        self,
        *,
        metrics: dict[str, Any],
        samples: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        rows = self._aircraft_support_v1_mission_wave_rows(samples)
        return rows

    def _aircraft_support_v1_sample_mission_wave_reliability(self, missions: list[Any]) -> list[dict[str, Any]]:
        by_wave: dict[tuple[int, int], dict[str, float]] = {}
        for mission in missions:
            day = max(1, self._positive_int(getattr(mission, "day_index", 1), 1))
            wave = max(1, self._positive_int(getattr(mission, "wave_index", 1), 1))
            planned = max(1, self._positive_int(getattr(mission, "required_aircraft", 1), 1))
            assigned = len(getattr(mission, "assigned_tail_numbers", []) or [])
            evaluated = bool(getattr(mission, "success_evaluated", False))
            successful = int(bool(getattr(mission, "succeeded", False))) if evaluated else 0
            bucket = by_wave.setdefault(
                (day, wave),
                {
                    "planned_sorties": 0.0,
                    "launched_sorties": 0.0,
                    "successful_sorties": 0.0,
                    "planned_waves": 0.0,
                    "successful_waves": 0.0,
                },
            )
            bucket["planned_sorties"] += planned
            bucket["launched_sorties"] += max(0, min(planned, assigned))
            bucket["successful_sorties"] += successful
            bucket["planned_waves"] += 1
            bucket["successful_waves"] += successful
        rows = []
        for sequence, (day, wave) in enumerate(sorted(by_wave), start=1):
            bucket = by_wave[(day, wave)]
            planned_waves = max(1.0, float(bucket["planned_waves"]))
            mission_success = self._clamp01(bucket["successful_waves"] / planned_waves)
            sortie_rate = self._clamp01(bucket["launched_sorties"] / max(1.0, bucket["planned_sorties"]))
            rows.append(
                {
                    "sequence": sequence,
                    "day_index": day,
                    "wave_index": wave,
                    "wave_key": self._mission_wave_key(day, wave),
                    "wave_label": self._mission_wave_label(day, wave),
                    "planned_sorties": bucket["planned_sorties"],
                    "launched_sorties": bucket["launched_sorties"],
                    "successful_sorties": bucket["successful_sorties"],
                    "planned_waves": bucket["planned_waves"],
                    "successful_waves": bucket["successful_waves"],
                    "mission_success_rate": mission_success,
                    "sortie_rate": sortie_rate,
                }
            )
        return rows

    def _aircraft_support_v1_mission_wave_rows(self, samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for fallback_sample_index, sample in enumerate(samples):
            sample_index = self._non_negative_int(sample.get("sample_index"), fallback_sample_index)
            for row in sample.get("mission_wave_reliability") or []:
                day = max(1, self._positive_int(row.get("day_index", row.get("dayIndex", 1)), 1))
                wave = max(1, self._positive_int(row.get("wave_index", row.get("waveIndex", 1)), 1))
                planned_sorties = self._float_value(row.get("planned_sorties", row.get("plannedSorties")), 0.0)
                launched_sorties = self._float_value(row.get("launched_sorties", row.get("launchedSorties")), 0.0)
                planned_waves = self._float_value(row.get("planned_waves", row.get("plannedWaves")), 0.0)
                successful_waves = self._float_value(row.get("successful_waves", row.get("successfulWaves")), 0.0)
                mission_success = self._clamp01(
                    successful_waves / planned_waves
                    if planned_waves > 0
                    else row.get("mission_success_rate", row.get("missionSuccessRate", row.get("mean_mission_success_rate")))
                )
                sortie_rate = self._clamp01(
                    launched_sorties / planned_sorties
                    if planned_sorties > 0
                    else row.get("sortie_rate", row.get("sortieRate", row.get("mean_sortie_rate")))
                )
                rows.append({
                    "sample_index": sample_index,
                    "sample_label": f"样本 {sample_index + 1}",
                    "day_index": day,
                    "wave_index": wave,
                    "wave_key": self._mission_wave_key(day, wave),
                    "wave_label": self._mission_wave_label(day, wave),
                    "planned_sorties": planned_sorties,
                    "launched_sorties": launched_sorties,
                    "successful_sorties": self._float_value(row.get("successful_sorties", row.get("successfulSorties")), 0.0),
                    "planned_waves": planned_waves,
                    "successful_waves": successful_waves,
                    "mean_mission_success_rate": mission_success,
                    "mission_success_probability": mission_success,
                    "mean_sortie_rate": sortie_rate,
                    "sortie_rate": sortie_rate,
                })
        rows.sort(key=lambda row: (row["sample_index"], row["day_index"], row["wave_index"]))
        for sequence, row in enumerate(rows, start=1):
            row["sequence"] = sequence
        return rows

    def _mission_wave_key(self, day: int, wave: int) -> str:
        return f"d{day}-w{wave}"

    def _mission_wave_label(self, day: int, wave: int) -> str:
        return f"第{day}天 第{wave}波"

    def _clamp01(self, value: Any) -> float:
        return min(1.0, max(0.0, self._float_value(value, 0.0)))

    def _float_value(self, value: Any, fallback: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(fallback)

    def _input_project_for_scenario(self, scenario: dict[str, Any]) -> dict[str, Any]:
        input_project = copy.deepcopy(
            self._compiled_project_snapshots.get(scenario["scenario_id"])
            or self._compiled_project_snapshots.get(scenario["project_id"])
        )
        if input_project is not None:
            return input_project
        return {
            "schema_version": PROJECT_SCHEMA_VERSION,
            "project_id": scenario["project_id"],
            "project_version": scenario["compiled_from"]["project_version"],
            "project_schema_version": scenario["compiled_from"]["project_schema_version"],
            "mapping_provenance": copy.deepcopy(scenario["compiled_from"]["mapping_provenance"]),
        }

    def _aviation_monte_carlo_sampling_contract(self, profile: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": "aviation-support-monte-carlo-sampling-v0",
            "model_family": "aviation_support",
            "sample_count": profile["sample_count"],
            "dimensions": [
                {
                    "source": "analysisRequests.largeSample.sweep.failureRates",
                    "target": "AviationSupportModel.lru_failure_multiplier",
                    "interpretation": "multiplier applied to the compiled aviation LRU hazard baseline",
                    "values": profile["sweep"]["failureRates"],
                },
                {
                    "source": "analysisRequests.largeSample.sweep.spareMultipliers",
                    "target": "AviationSupportModel.spares.initial_quantity_multiplier",
                    "values": profile["sweep"]["spareMultipliers"],
                },
                {
                    "source": "analysisRequests.largeSample.sweep.supportCapacities",
                    "target": "AviationSupportModel mechanic_teams/fuel_trucks/maintenance_bays",
                    "values": profile["sweep"]["supportCapacities"],
                },
            ],
            "seed_policy": "sample_seed = compiled Scenario seed + sample_index",
            "sample_point_policy": "sample_count must cover every cartesian sweep point; extra samples repeat points in deterministic order",
            "unsupported_fields": [],
        }

    def _apply_aviation_spare_multiplier(self, model: Any, multiplier: float) -> None:
        for spare in model.spares.values():
            spare.quantity = max(0, int(round(spare.quantity * multiplier)))
            spare.reorder_point = max(0, int(round(spare.reorder_point * multiplier)))
            spare.reorder_quantity = max(0, int(round(spare.reorder_quantity * multiplier)))

    def _aviation_spare_shortage_probability(self, samples: list[dict[str, Any]]) -> float:
        return (
            sum(
                1
                for sample in samples
                if self._aviation_sample_has_spare_shortage(sample)
            )
            / max(1, len(samples))
        )

    def _aviation_sample_has_spare_shortage(self, sample: dict[str, Any]) -> bool:
        frames = sample.get("frames") or []
        spares = frames[-1].get("spares") if frames else []
        if isinstance(spares, list):
            return any(
                float(spare.get("quantity", 0) or 0) <= 0
                and float(spare.get("consumed", 0) or 0) > 0
                for spare in spares
                if isinstance(spare, dict)
            )
        return (
            float(sample["metrics"].get("spare_stock_total", 0) or 0) <= 0
            and float(sample["metrics"].get("spare_consumed_total", 0) or 0) > 0
        )

    def _aviation_monte_carlo_analysis_projections(
        self,
        aggregate: dict[str, Any],
        samples: list[dict[str, Any]],
        base_artifact_id: str,
    ) -> dict[str, dict[str, Any]]:
        projections = self._aviation_analysis_projections(aggregate, base_artifact_id)
        projections["large_sample_summary"] = {
            "projection_type": "large_sample_summary",
            "base_artifact_id": base_artifact_id,
            "data": {
                "sample_count": len(samples),
                "mission_success_probability": aggregate.get("mission_success_probability", 0),
                "spare_fill_rate": self._aviation_spare_fill_rate(aggregate),
                "mean_repair_backlog": aggregate.get("maintenance_backlog", 0),
            },
        }
        return projections

    def _aviation_spare_fill_rate(self, metrics: dict[str, Any]) -> float:
        stock = max(0.0, float(metrics.get("spare_stock_total", 0) or 0))
        consumed = max(0.0, float(metrics.get("spare_consumed_total", 0) or 0))
        total = stock + consumed
        return 1.0 if total <= 0 else min(1.0, stock / total)

    def _aviation_monte_carlo_visualization_frames(self, run_id: str, samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        next_step = 0
        for sample in samples:
            sample_frames = sample.get("frames") or []
            for sample_frame in sample_frames:
                frame = copy.deepcopy(sample_frame)
                frame["run_id"] = run_id
                frame["step"] = next_step
                frame["simulation_time"] = next_step
                frames.append(frame)
                next_step += 1
        return frames

    def _monte_carlo_profile(
        self,
        scenario: dict[str, Any],
        *,
        monte_carlo_config: dict[str, Any],
    ) -> dict[str, Any]:
        inputs = scenario["simulation_inputs"]
        sweep = monte_carlo_config.get("sweep") if isinstance(monte_carlo_config.get("sweep"), dict) else {}
        normalized = {
            "failureRates": self._normalize_numeric_sweep_values(
                self._first_present(sweep, ["failureRates", "failure_rates"]),
                [],
                field_path="monte_carlo_config.sweep.failureRates",
            ),
            "spareMultipliers": self._normalize_numeric_sweep_values(
                self._first_present(sweep, ["spareMultipliers", "spare_multipliers"]),
                [],
                field_path="monte_carlo_config.sweep.spareMultipliers",
            ),
            "supportCapacities": self._normalize_support_capacities(
                self._first_present(sweep, ["supportCapacities", "support_capacities"]),
                [],
                field_path="monte_carlo_config.sweep.supportCapacities",
            ),
        }
        points = []
        for failure_rate in normalized["failureRates"]:
            for spare_multiplier in normalized["spareMultipliers"]:
                for support_capacity in normalized["supportCapacities"]:
                    points.append(
                        {
                            "failure_rate": failure_rate,
                            "spare_multiplier": spare_multiplier,
                            "support_capacity": support_capacity,
                        }
                    )
        count = self._validate_monte_carlo_sample_count(monte_carlo_config.get("sample_count"))
        if count < len(points):
            raise AdapterError(
                "bad_analysis_request",
                "monte carlo samples must cover every configured sweep point",
                field_path="monte_carlo_config.sample_count",
                sample_count=count,
                sweep_point_count=len(points),
            )
        sample_points = [copy.deepcopy(points[index % len(points)]) for index in range(count)]
        for index, point in enumerate(sample_points):
            point["seed"] = int(inputs["seed"]) + index
        return {
            "sample_count": count,
            "sweep": normalized,
            "sample_points": sample_points,
        }

    def _aggregate_sample_metrics(self, samples: list[dict[str, Any]]) -> dict[str, Any]:
        keys = sorted(
            {
                key
                for sample in samples
                for key, value in sample.get("metrics", {}).items()
                if is_finite_json_number(value)
            }
        )
        aggregate = {}
        for key in keys:
            values = [
                float(sample["metrics"][key])
                for sample in samples
                if is_finite_json_number(sample.get("metrics", {}).get(key))
            ]
            mean = finite_mean(values)
            if mean is not None:
                aggregate[key] = mean
        aggregate["sample_count"] = len(samples)
        if "mission_success_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["mission_success_rate"]
        elif "sortie_completion_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["sortie_completion_rate"]
        shortage_values = [
            float(sample["metrics"]["shortage_events"])
            for sample in samples
            if is_finite_json_number(sample.get("metrics", {}).get("shortage_events"))
        ]
        if shortage_values:
            aggregate["spare_shortage_probability"] = (
                sum(1 for value in shortage_values if value > 0) / len(shortage_values)
            )
        return aggregate

    def _visualization_state_series_payload(
        self,
        *,
        run_id: str,
        scenario: dict[str, Any],
        model_family: str,
        result_summary_id: str,
        artifact_manifest_id: str,
        frames: list[dict[str, Any]],
    ) -> dict[str, Any]:
        trace = {
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "result_summary_id": result_summary_id,
            "artifact_manifest_id": artifact_manifest_id,
            "run_config_artifact_id": f"run_config-{run_id}",
            "input_project_artifact_id": f"input_project-{run_id}",
            "compiled_scenario_artifact_id": f"compiled_scenario-{run_id}",
        }
        traced_frames = [self._trace_visualization_frame(frame, trace) for frame in frames]
        mission_templates = self._compact_mission_frames(traced_frames)
        failure_tree_templates = self._compact_failure_tree_frames(traced_frames)
        payload = {
            "schema_version": VISUALIZATION_STATE_SERIES_SCHEMA_VERSION,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": model_family,
            "artifact_manifest_id": artifact_manifest_id,
            "result_summary_id": result_summary_id,
            "run_config_artifact_id": trace["run_config_artifact_id"],
            "input_project_artifact_id": trace["input_project_artifact_id"],
            "compiled_scenario_artifact_id": trace["compiled_scenario_artifact_id"],
            "frames": traced_frames,
        }
        if mission_templates:
            payload["mission_templates"] = mission_templates
        if failure_tree_templates:
            payload["failure_tree_templates"] = failure_tree_templates
        return payload

    def _compact_mission_frames(self, frames: list[dict[str, Any]]) -> dict[str, Any]:
        templates: dict[str, Any] = {}
        for frame in frames:
            compact_missions = []
            for mission in frame.get("missions") or []:
                if not isinstance(mission, dict):
                    continue
                mission_id = str(mission.get("mission_id") or "")
                if not mission_id:
                    continue
                if mission_id not in templates:
                    templates[mission_id] = {
                        key: copy.deepcopy(value)
                        for key, value in mission.items()
                        if key
                        not in {
                            "actual_start",
                            "return_time",
                            "status",
                            "assigned_tail_numbers",
                            "delay_minutes",
                        }
                    }
                compact_missions.append(
                    {
                        "mission_id": mission_id,
                        "actual_start": mission.get("actual_start"),
                        "return_time": mission.get("return_time"),
                        "status": str(mission.get("status") or ""),
                        "assigned_tail_numbers": list(mission.get("assigned_tail_numbers") or []),
                        "delay_minutes": mission.get("delay_minutes") or 0,
                    }
                )
            frame["missions"] = compact_missions
        return templates

    def _compact_failure_tree_frames(self, frames: list[dict[str, Any]]) -> dict[str, Any]:
        templates: dict[str, Any] = {}
        template_keys: dict[str, str] = {}
        for frame in frames:
            for aircraft in frame.get("aircraft") or []:
                tree = aircraft.pop("failure_tree", None)
                if not isinstance(tree, dict) or not isinstance(tree.get("nodes"), list):
                    continue
                template = self._failure_tree_template(tree)
                key = json.dumps(template, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                ref = template_keys.get(key)
                if ref is None:
                    ref = f"failure-tree-template-{len(templates) + 1:03d}"
                    template_keys[key] = ref
                    templates[ref] = template
                aircraft["failure_tree_ref"] = ref
                aircraft["failure_tree_state"] = self._failure_tree_state(tree)
        return templates

    def _failure_tree_template(self, tree: dict[str, Any]) -> dict[str, Any]:
        return {
            "tail_number": str(tree.get("tail_number") or ""),
            "aircraft_type": str(tree.get("aircraft_type") or ""),
            "root_id": str(tree.get("root_id") or ""),
            "equipment_root_id": str(tree.get("equipment_root_id") or ""),
            "nodes": [
                {
                    "id": str(node.get("id") or ""),
                    "name": str(node.get("name") or node.get("id") or ""),
                    "parent_id": str(node.get("parent_id") or ""),
                    "product_type": str(node.get("product_type") or ""),
                    "quantity": int(node.get("quantity") or 1),
                    "k_out_of_n": copy.deepcopy(node.get("k_out_of_n") if isinstance(node.get("k_out_of_n"), dict) else {}),
                    "failure_threshold": int(node.get("failure_threshold") or 1),
                }
                for node in tree.get("nodes") or []
                if isinstance(node, dict)
            ],
            "edges": [
                {"from": str(edge.get("from") or ""), "to": str(edge.get("to") or "")}
                for edge in tree.get("edges") or []
                if isinstance(edge, dict)
            ],
        }

    def _failure_tree_state(self, tree: dict[str, Any]) -> dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": str(node.get("id") or ""),
                    "failed_children": int(node.get("failed_children") or 0),
                    "failed": bool(node.get("failed")),
                    "direct_failed": bool(node.get("direct_failed")),
                    "propagated_failed": bool(node.get("propagated_failed")),
                    "failure_time": node.get("failure_time"),
                }
                for node in tree.get("nodes") or []
                if isinstance(node, dict)
                and (
                    node.get("failed")
                    or node.get("direct_failed")
                    or node.get("propagated_failed")
                    or node.get("failure_time") is not None
                    or int(node.get("failed_children") or 0) > 0
                )
            ],
            "active_edges": [
                str(edge.get("to") or "")
                for edge in tree.get("edges") or []
                if isinstance(edge, dict) and edge.get("active")
            ],
        }

    def _trace_visualization_frame(self, frame: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
        traced = copy.deepcopy(frame)
        traced["run_id"] = trace["run_id"]
        traced["scenario_id"] = trace["scenario_id"]
        traced["scenario_version"] = trace["scenario_version"]
        traced["artifact_manifest_id"] = trace["artifact_manifest_id"]
        traced["result_summary_id"] = trace["result_summary_id"]
        traced["trace"] = copy.deepcopy(trace)
        step = int(traced["step"])
        traced["events"] = [
            {
                **event,
                "event_id": event.get("event_id") or f"{trace['run_id']}-step-{step}-{index}-{event.get('event', 'event')}",
                "run_id": trace["run_id"],
                "step": step,
                "event_type": event.get("event_type") or event.get("event") or "event",
                "metric_refs": list(event.get("metric_refs") or self._event_metric_refs(str(event.get("event") or ""))),
            }
            for index, event in enumerate(traced.get("events") or [])
        ]
        return traced

    def _event_metric_refs(self, event_type: str) -> list[str]:
        if event_type == "spare_shortage":
            return ["shortage_events", "downtime_spare_shortage_events"]
        if event_type == "resource_delay":
            return ["downtime_resource_delay_events"]
        return ["ready_rate", "mission_success_rate", "spare_fill_rate"]

    def _annotate_state_series_artifact(
        self,
        artifacts: list[dict[str, Any]],
        run_id: str,
        result_summary_id: str,
        scenario_id: str,
    ) -> None:
        for artifact in artifacts:
            if artifact.get("kind") == "visualization_state_series":
                artifact["source_run_id"] = run_id
                artifact["source_result_summary_id"] = result_summary_id
                artifact["source_scenario_id"] = scenario_id

    def _round_metric(self, value: Any) -> int:
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return 0

    def _spare_shortfall_constraint_result(self, value: float) -> dict[str, Any]:
        achieved = [threshold for threshold in SPARE_SHORTFALL_CONSTRAINTS if value >= threshold]
        if achieved:
            return {"status": "met", "threshold": achieved[-1]}
        return {"status": "below", "threshold": SPARE_SHORTFALL_CONSTRAINTS[0]}

    def _require_monte_carlo_config(
        self,
        *,
        monte_carlo_config: dict[str, Any] | None,
        legacy_config: dict[str, Any],
    ) -> dict[str, Any]:
        if legacy_config:
            raise AdapterError(
                "bad_analysis_request",
                "run_monte_carlo_scenario requires monte_carlo_config; legacy Monte Carlo parameters are not supported",
                fields=sorted(legacy_config),
            )
        if not isinstance(monte_carlo_config, dict):
            raise AdapterError(
                "bad_analysis_request",
                "run_monte_carlo_scenario requires monte_carlo_config",
                field_path="monte_carlo_config",
            )
        return copy.deepcopy(monte_carlo_config)

    def _first_present(self, source: dict[str, Any], keys: list[str]) -> Any:
        for key in keys:
            if isinstance(source, dict) and key in source:
                return source[key]
        return None

    def _validate_monte_carlo_sample_count(self, value: Any) -> int:
        if isinstance(value, bool) or not self._is_integer_like(value):
            raise AdapterError(
                "bad_analysis_request",
                "monte carlo samples must be an integer between 1 and 1000",
                field_path="samples",
                value=value,
            )
        count = int(value)
        if count < 1 or count > 1000:
            raise AdapterError(
                "bad_analysis_request",
                "monte carlo samples must be an integer between 1 and 1000",
                field_path="samples",
                value=value,
                minimum=1,
                maximum=1000,
            )
        return count

    def _validate_monte_carlo_parallel_cores(self, value: Any) -> int:
        if isinstance(value, bool) or not self._is_integer_like(value):
            raise AdapterError(
                "bad_analysis_request",
                "monte carlo parallel_cores must be an integer between 1 and 32",
                field_path="monte_carlo_config.parallel_cores",
                value=value,
            )
        count = int(value)
        if count < 1 or count > 32:
            raise AdapterError(
                "bad_analysis_request",
                "monte carlo parallel_cores must be an integer between 1 and 32",
                field_path="monte_carlo_config.parallel_cores",
                value=value,
                minimum=1,
                maximum=32,
            )
        return count

    def _normalize_numeric_sweep_values(self, values: Any, fallback: list[float], *, field_path: str) -> list[float]:
        if values is None:
            if not fallback:
                raise AdapterError(
                    "bad_analysis_request",
                    f"{field_path} must include at least one numeric value",
                    field_path=field_path,
                    value=values,
                )
            return [float(value) for value in fallback]
        raw_values = values if isinstance(values, list) else [values]
        if len(raw_values) == 0:
            raise AdapterError(
                "bad_analysis_request",
                f"{field_path} must include at least one numeric value",
                field_path=field_path,
                value=values,
            )
        invalid = [value for value in raw_values if not self._is_json_number(value)]
        if invalid:
            raise AdapterError(
                "bad_analysis_request",
                f"{field_path} must contain only numeric values",
                field_path=field_path,
                invalid_values=invalid,
            )
        return [float(value) for value in raw_values]

    def _normalize_support_capacities(self, values: Any, fallback: list[int], *, field_path: str) -> list[int]:
        if values is None:
            if not fallback:
                raise AdapterError(
                    "bad_analysis_request",
                    f"{field_path} must include at least one positive integer",
                    field_path=field_path,
                    value=values,
                )
            return [int(value) for value in fallback]
        raw_values = values if isinstance(values, list) else [values]
        if len(raw_values) == 0:
            raise AdapterError(
                "bad_analysis_request",
                f"{field_path} must include at least one positive integer",
                field_path=field_path,
                value=values,
            )
        invalid = [
            value
            for value in raw_values
            if isinstance(value, bool) or not self._is_integer_like(value) or int(value) < 1
        ]
        if invalid:
            raise AdapterError(
                "bad_analysis_request",
                f"{field_path} must contain only integers greater than or equal to 1",
                field_path=field_path,
                invalid_values=invalid,
            )
        return [int(value) for value in raw_values]

    def _project_id(self, project: dict[str, Any]) -> str:
        return str(project.get("project_id") or project.get("scenarioId") or "project-unknown")

    def _project_version(self, project: dict[str, Any]) -> str:
        return str(project.get("project_version") or "project-v0.1")

    def _dict_list(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]

    def _strip_removed_mission_area_fields(self, value: Any) -> None:
        if isinstance(value, dict):
            for key in list(value):
                if key in REMOVED_MISSION_AREA_KEYS:
                    value.pop(key, None)
                    continue
                self._strip_removed_mission_area_fields(value[key])
        elif isinstance(value, list):
            for item in value:
                self._strip_removed_mission_area_fields(item)

    def _runtime_airports(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        airports: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in value:
            if isinstance(item, dict):
                airports.append(copy.deepcopy(item))
                continue
            airport = str(item or "").strip()
            if not airport or airport in seen:
                continue
            seen.add(airport)
            airport_id = self._airport_id_from_name(airport)
            airports.append({
                "id": airport_id,
                "name": airport,
                "location": airport,
                "supportNodeId": airport_id,
            })
        return airports

    def _airport_id_from_name(self, name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", str(name).strip().lower()).strip("-")
        if not slug:
            slug = hashlib.sha1(str(name).encode("utf-8")).hexdigest()[:8]
        return f"airport-{slug}"

    def _basic_missions(self, project: dict[str, Any]) -> list[dict[str, Any]]:
        return self._dict_list(project.get("basicMissions"))

    def _normalize_mission_task_field_ownership(
        self,
        basic_missions: list[dict[str, Any]],
        composite_tasks: list[dict[str, Any]],
    ) -> None:
        basic_by_reference: dict[str, dict[str, Any]] = {}
        for basic in basic_missions:
            basic.pop("priority", None)
            for value in (basic.get("id"), basic.get("missionId"), basic.get("taskNo"), basic.get("name"), basic.get("basicTaskName")):
                reference = str(value or "").strip()
                if reference:
                    basic_by_reference[reference] = basic
        for composite in composite_tasks:
            task_items = self._dict_list(composite.get("taskItems"))
            inherited_priority = next(
                (
                    self._positive_int(item.get("priority"), 0)
                    for item in task_items
                    if self._positive_int(item.get("priority"), 0) > 0
                ),
                1,
            )
            composite["priority"] = self._positive_int(composite.get("priority"), inherited_priority)
            for item in task_items:
                minimum = self._positive_int(item.get("minRequiredSystems"), 0)
                basic = basic_by_reference.get(str(item.get("basicMissionId") or "").strip()) or basic_by_reference.get(str(item.get("basicTaskName") or "").strip())
                if minimum and basic and not self._positive_int(basic.get("minRequiredSorties"), 0):
                    basic["minRequiredSorties"] = minimum
                item.pop("priority", None)
                item.pop("minRequiredSystems", None)
                item.pop("equipmentQuantity", None)
                item.pop("requiredEquipmentQuantity", None)

    def _aircraft_support_v1_mission_phases(
        self,
        project: dict[str, Any],
        basic_missions: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        missions = basic_missions if basic_missions is not None else self._basic_missions(project)
        phases: list[dict[str, Any]] = []
        for mission in missions:
            mission_id = str(mission.get("id") or mission.get("missionId") or mission.get("name") or "").strip()
            for phase in self._dict_list(mission.get("missionPhases")):
                row = copy.deepcopy(phase)
                if mission_id and row.get("basicMissionId") in (None, ""):
                    row["basicMissionId"] = mission_id
                phases.append(row)
        if phases:
            return phases
        return copy.deepcopy(self._dict_list(project.get("missionPhases")))

    def _uses_root_mission_phase_fallback(self, project: dict[str, Any]) -> bool:
        if not self._dict_list(project.get("missionPhases")):
            return False
        return not self._aircraft_support_v1_mission_phases({**project, "missionPhases": []})

    def _primary_basic_mission(self, project: dict[str, Any]) -> dict[str, Any]:
        missions = self._basic_missions(project)
        return missions[0] if missions else {}

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            value = [value]
        return [str(item) for item in value if item not in (None, "")]

    def _unique_string_list(self, values: Any) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value in (None, ""):
                continue
            item = str(value)
            if item in seen:
                continue
            result.append(item)
            seen.add(item)
        return result

    def _optional_string(self, value: Any) -> str | None:
        if value in (None, ""):
            return None
        return str(value)

    def _root_component_id(self, components: Any) -> str | None:
        for component in self._dict_list(components):
            if component.get("parentId") in (None, "") and component.get("id") not in (None, ""):
                return str(component["id"])
        return None

    def _duration_minutes(self, duration_hours: Any) -> int:
        if not self._is_positive_number(duration_hours):
            return 24 * 60
        return max(1, int(round(float(duration_hours) * 60)))

    def _periodic_profile_compile_issues(self, project: dict[str, Any]) -> list[dict[str, str]]:
        issues: list[dict[str, str]] = []
        mission_profile = project.get("missionProfile") if isinstance(project.get("missionProfile"), dict) else {}
        periodic_tasks = self._dict_list(mission_profile.get("periodicTasks"))
        week_ids = {str(item.get("id") or "").strip() for item in periodic_tasks}
        composite_ids = {str(item.get("id") or "").strip() for item in self._dict_list(mission_profile.get("compositeTasks"))}
        basic_ids = {
            str(value or "").strip()
            for item in self._basic_missions(project)
            for value in (item.get("id"), item.get("missionId"), item.get("taskNo"), item.get("name"))
            if str(value or "").strip()
        }
        lists = mission_profile.get("periodicProfileLists") if isinstance(mission_profile.get("periodicProfileLists"), dict) else {}
        months = self._dict_list(lists.get("month"))
        years = self._dict_list(lists.get("year"))
        month_ids = {str(item.get("id") or "").strip() for item in months}
        periodic_composite_ids = {
            str(reference or "").strip()
            for task in periodic_tasks
            for reference in [
                *(task.get("compositeTaskIds") or []),
                *(row.get("compositeTaskId") for row in self._dict_list(task.get("compositeTasks"))),
            ]
            if str(reference or "").strip()
        }
        for composite_index, composite in enumerate(self._dict_list(mission_profile.get("compositeTasks"))):
            if str(composite.get("id") or "").strip() not in periodic_composite_ids:
                continue
            for item_index, item in enumerate(self._dict_list(composite.get("taskItems"))):
                reference = str(item.get("basicMissionId") or item.get("basicTaskName") or "").strip()
                if reference and reference not in basic_ids:
                    issues.append(self._compile_issue(
                        "missing_periodic_basic_mission_reference",
                        f"missionProfile.compositeTasks[{composite_index}].taskItems[{item_index}].basicMissionId",
                        f"复合任务引用的基础任务 {reference} 不存在。", "周期性任务建模",
                    ))
        for task_index, task in enumerate(periodic_tasks):
            references = [str(item or "").strip() for item in task.get("compositeTaskIds") or []]
            references.extend(str(row.get("compositeTaskId") or "").strip() for row in self._dict_list(task.get("compositeTasks")))
            for reference in references:
                if reference and reference not in composite_ids:
                    issues.append(self._compile_issue(
                        "missing_periodic_composite_reference", f"missionProfile.periodicTasks[{task_index}]",
                        f"周剖面引用的复合任务 {reference} 不存在。", "周期性任务建模",
                    ))
        for month_index, month in enumerate(months):
            slots = month.get("weekProfileIds")
            if not isinstance(slots, list):
                issues.append(self._compile_issue(
                    "invalid_periodic_week_profile_slots",
                    f"missionProfile.periodicProfileLists.month[{month_index}].weekProfileIds",
                    "月剖面的周槽位必须是字符串数组。", "周期性任务建模",
                ))
                continue
            for slot_index, reference in enumerate(slots):
                if not isinstance(reference, str):
                    issues.append(self._compile_issue(
                        "invalid_periodic_week_profile_slot",
                        f"missionProfile.periodicProfileLists.month[{month_index}].weekProfileIds[{slot_index}]",
                        "月剖面的周槽位必须是字符串。", "周期性任务建模",
                    ))
                    continue
                reference = str(reference or "").strip()
                if reference and reference not in week_ids:
                    issues.append(self._compile_issue(
                        "missing_periodic_week_profile_reference",
                        f"missionProfile.periodicProfileLists.month[{month_index}].weekProfileIds[{slot_index}]",
                        f"月剖面引用的周剖面 {reference} 不存在。", "周期性任务建模",
                    ))
        for year_index, year in enumerate(years):
            slots = year.get("monthProfileIds")
            if not isinstance(slots, list):
                issues.append(self._compile_issue(
                    "invalid_periodic_month_profile_slots",
                    f"missionProfile.periodicProfileLists.year[{year_index}].monthProfileIds",
                    "年剖面的月槽位必须是字符串数组。", "周期性任务建模",
                ))
                continue
            for slot_index, reference in enumerate(slots):
                if not isinstance(reference, str):
                    issues.append(self._compile_issue(
                        "invalid_periodic_month_profile_slot",
                        f"missionProfile.periodicProfileLists.year[{year_index}].monthProfileIds[{slot_index}]",
                        "年剖面的月槽位必须是字符串。", "周期性任务建模",
                    ))
                    continue
                reference = str(reference or "").strip()
                if reference and reference not in month_ids:
                    issues.append(self._compile_issue(
                        "missing_periodic_month_profile_reference",
                        f"missionProfile.periodicProfileLists.year[{year_index}].monthProfileIds[{slot_index}]",
                        f"年剖面引用的月剖面 {reference} 不存在。", "周期性任务建模",
                    ))
        if periodic_tasks and not self._periodic_profile_schedule(mission_profile)[1]:
            issues.append(self._compile_issue(
                "empty_periodic_task_schedule", "missionProfile.periodicTasks",
                "周期任务无法生成任何有效任务实例，请至少配置一个存在的复合任务。", "周期性任务建模",
            ))
        return issues

    def _periodic_profile_schedule(self, mission_profile: dict[str, Any]) -> tuple[str, list[tuple[int, str]]]:
        tasks = self._dict_list(mission_profile.get("periodicTasks"))
        task_by_id = {str(item.get("id") or "").strip(): item for item in tasks}
        lists = mission_profile.get("periodicProfileLists") if isinstance(mission_profile.get("periodicProfileLists"), dict) else {}
        months = self._dict_list(lists.get("month"))
        years = self._dict_list(lists.get("year"))
        month_by_id = {str(item.get("id") or "").strip(): item for item in months}
        year_has_refs = any(
            str(ref or "").strip()
            for item in years
            for ref in (item.get("monthProfileIds") if isinstance(item.get("monthProfileIds"), list) else [])
        )
        month_has_refs = any(
            str(ref or "").strip()
            for item in months
            for ref in (item.get("weekProfileIds") if isinstance(item.get("weekProfileIds"), list) else [])
        )
        schedule: list[tuple[int, str]] = []
        if year_has_refs:
            week_offset = 0
            for year in years:
                year_slots = year.get("monthProfileIds") if isinstance(year.get("monthProfileIds"), list) else []
                for month_ref in year_slots:
                    month = month_by_id.get(str(month_ref or "").strip())
                    month_slots = month.get("weekProfileIds") if month and isinstance(month.get("weekProfileIds"), list) else ["", "", "", ""]
                    for week_ref in month_slots:
                        reference = str(week_ref or "").strip()
                        if reference in task_by_id:
                            schedule.append((week_offset, reference))
                        week_offset += 1
            return "year", schedule
        if month_has_refs:
            week_offset = 0
            for month in months:
                month_slots = month.get("weekProfileIds") if isinstance(month.get("weekProfileIds"), list) else []
                for week_ref in month_slots:
                    reference = str(week_ref or "").strip()
                    if reference in task_by_id:
                        schedule.append((week_offset, reference))
                    week_offset += 1
            return "month", schedule
        for task in tasks:
            task_id = str(task.get("id") or "").strip()
            if self._periodic_task_active_duration_days(task) is not None:
                schedule.append((0, task_id))
        return "week", schedule

    def _compile_periodic_profile_plan(self, mission_profile: dict[str, Any], composite_tasks: list[dict[str, Any]]) -> dict[str, Any]:
        source_level, schedule = self._periodic_profile_schedule(mission_profile)
        tasks = self._dict_list(mission_profile.get("periodicTasks"))
        source = {"level": source_level, "label": {"week": "周剖面", "month": "月剖面", "year": "年剖面"}[source_level], "configured_slots": len(schedule)}
        if source_level == "week":
            return {"source": source, "periodic_tasks": copy.deepcopy(tasks), "composite_tasks": composite_tasks}
        task_by_id = {str(item.get("id") or "").strip(): item for item in tasks}
        composite_by_id = {str(item.get("id") or "").strip(): item for item in composite_tasks}
        compiled_tasks: list[dict[str, Any]] = []
        compiled_composites: list[dict[str, Any]] = []
        total_weeks = max((offset for offset, _ in schedule), default=0) + 1
        for occurrence, (week_offset, task_id) in enumerate(schedule, start=1):
            task = copy.deepcopy(task_by_id[task_id])
            suffix = f"__{source_level}_{occurrence}"
            references = {str(row.get("compositeTaskId") or "").strip() for row in self._dict_list(task.get("compositeTasks")) if str(row.get("compositeTaskId") or "").strip()}
            references.update(str(item or "").strip() for item in task.get("compositeTaskIds") or [] if str(item or "").strip())
            reference_map = {reference: f"{reference}{suffix}" for reference in sorted(references)}
            for reference, clone_id in reference_map.items():
                clone = copy.deepcopy(composite_by_id[reference])
                clone["id"] = clone_id
                compiled_composites.append(clone)
            task["id"] = f"{task_id}{suffix}"
            task["repeatWeeks"] = task["repeatRounds"] = task["repeatCount"] = total_weeks
            task["compositeTaskIds"] = list(reference_map.values())
            rows = []
            for row in self._dict_list(task.get("compositeTasks")):
                reference = str(row.get("compositeTaskId") or "").strip()
                if not reference:
                    continue
                row["compositeTaskId"] = reference_map[reference]
                row["weekIndex"] = week_offset + max(1, self._positive_int(row.get("weekIndex"), 1))
                rows.append(row)
            task["compositeTasks"] = rows
            task["weekdayAssignments"] = {}
            compiled_tasks.append(task)
        return {"source": source, "periodic_tasks": compiled_tasks, "composite_tasks": compiled_composites}

    def _aircraft_support_v1_duration_minutes(self, mission_profile: dict[str, Any]) -> int:
        periodic_days = []
        for periodic in self._dict_list(mission_profile.get("periodicTasks")):
            active_days = self._periodic_task_active_duration_days(periodic)
            if active_days is not None:
                periodic_days.append(active_days)
                continue
            total_days = self._periodic_task_total_days(periodic)
            if total_days is not None:
                periodic_days.append(total_days)
        if periodic_days:
            return max(1, int(round(max(periodic_days) * 24 * 60)))
        return self._duration_minutes(mission_profile.get("durationHours"))

    def _periodic_task_active_duration_days(self, periodic: dict[str, Any]) -> int | None:
        period_days = max(1, int(round(self._periodic_task_period_days(periodic) or 1)))
        total_days = max(1, int(round(self._periodic_task_total_days(periodic) or period_days)))
        composite_days = self._periodic_task_explicit_composite_days(periodic, total_days, period_days)
        if not composite_days:
            composite_days = self._periodic_task_weekday_assignment_days(periodic, total_days, period_days)
        if not composite_days:
            composite_ids = [item for item in periodic.get("compositeTaskIds") or [] if str(item or "").strip()]
            return total_days if composite_ids else None
        active_days = [day for days in composite_days.values() for day in days]
        return max(active_days) + 1 if active_days else None

    def _periodic_task_explicit_composite_days(
        self,
        periodic: dict[str, Any],
        total_days: int,
        period_days: int,
    ) -> dict[str, set[int]]:
        composite_days: dict[str, set[int]] = {}
        for item in self._dict_list(periodic.get("compositeTasks")):
            composite_id = str(item.get("compositeTaskId") or "").strip()
            if not composite_id:
                continue
            weekday_index = self._periodic_weekday_index(item.get("weekday") or item.get("dayOfWeek"))
            if weekday_index is not None:
                week_index = self._positive_int(item.get("weekIndex", item.get("week")), 1)
                active_day = (week_index - 1) * period_days + weekday_index
                if 0 <= active_day < total_days:
                    composite_days.setdefault(composite_id, set()).add(active_day)
                continue
            period_index = self._positive_int(item.get("week", item.get("weekIndex")), 1)
            start_day = max(0, (period_index - 1) * period_days)
            active_days = set(range(start_day, min(total_days, start_day + period_days)))
            if active_days:
                composite_days.setdefault(composite_id, set()).update(active_days)
        return composite_days

    def _periodic_task_weekday_assignment_days(
        self,
        periodic: dict[str, Any],
        total_days: int,
        period_days: int,
    ) -> dict[str, set[int]]:
        assignments: dict[int, str] = {}
        raw_assignments = periodic.get("weekdayAssignments") if isinstance(periodic.get("weekdayAssignments"), dict) else {}
        for key, composite_id in raw_assignments.items():
            weekday_index = self._periodic_weekday_index(key)
            composite_text = str(composite_id or "").strip()
            if weekday_index is not None and composite_text:
                assignments[weekday_index] = composite_text
        for key in _PERIODIC_WEEKDAY_ASSIGNMENT_FIELDS:
            weekday_index = self._periodic_weekday_index(key)
            composite_text = str(periodic.get(key) or "").strip()
            if weekday_index is not None and composite_text:
                assignments[weekday_index] = composite_text

        composite_days: dict[str, set[int]] = {}
        for start_day in range(0, total_days, max(1, period_days)):
            for weekday_index, composite_id in assignments.items():
                active_day = start_day + weekday_index
                if active_day < total_days:
                    composite_days.setdefault(composite_id, set()).add(active_day)
        return composite_days

    def _periodic_weekday_index(self, value: Any) -> int | None:
        text = str(value or "").strip()
        if not text:
            return None
        return _PERIODIC_WEEKDAY_INDEXES.get(text.replace("_", "").replace("-", "").lower())

    def _periodic_task_total_days(self, periodic: dict[str, Any]) -> float | None:
        period_days = self._periodic_task_period_days(periodic)
        repeat_count = self._periodic_task_repeat_count(periodic)
        if period_days is None:
            if not self._periodic_task_has_repeat_count(periodic):
                return None
            period_days = 1.0
        return max(1.0, period_days * repeat_count)

    def _mission_profile_has_periodic_duration(self, mission_profile: dict[str, Any]) -> bool:
        periodic_tasks = self._dict_list(mission_profile.get("periodicTasks"))
        return any(self._periodic_task_total_days(periodic) is not None for periodic in periodic_tasks)

    def _periodic_task_period_days(self, periodic: dict[str, Any]) -> float | None:
        for key in ("taskPeriodDays", "periodDays", "cycleDays", "repeatCycleDays"):
            if self._is_positive_number(periodic.get(key)):
                return float(periodic[key])
        if self._is_positive_number(periodic.get("repeatCycleValue")):
            value = float(periodic["repeatCycleValue"])
            unit = str(periodic.get("repeatCycleUnit") or "day").lower()
            if unit in {"week", "weeks", "周", "星期"}:
                return value * 7
            if unit in {"hour", "hours", "小时"}:
                return value / 24
            return value
        return None

    def _periodic_task_repeat_count(self, periodic: dict[str, Any]) -> float:
        for key in ("repeatCount", "repeatRounds", "repeatWeeks"):
            if self._is_positive_number(periodic.get(key)):
                return max(1.0, float(periodic[key]))
        return 1.0

    def _periodic_task_has_repeat_count(self, periodic: dict[str, Any]) -> bool:
        return any(self._is_positive_number(periodic.get(key)) for key in ("repeatCount", "repeatRounds", "repeatWeeks"))

    def _non_negative_number(self, value: Any, fallback: float) -> float:
        if self._is_number(value):
            return max(0.0, float(value))
        return float(fallback)

    def _optional_positive_number(self, value: Any) -> float | None:
        if not self._is_positive_number(value):
            return None
        return float(value)

    def _non_negative_numbers(self, value: Any, fallback: list[float]) -> list[float]:
        values = value if isinstance(value, list) else [value]
        numbers = [max(0.0, float(item)) for item in values if self._is_number(item)]
        return numbers or list(fallback)

    def _positive_int_list(self, value: Any, fallback: list[int]) -> list[int]:
        values = value if isinstance(value, list) else [value]
        numbers = [self._positive_int(item, 1) for item in values if self._is_number(item)]
        return numbers or list(fallback)

    def _first_number(self, values: Any, fallback: float) -> float:
        if isinstance(values, list):
            for value in values:
                if self._is_number(value):
                    return float(value)
        if self._is_number(values):
            return float(values)
        return float(fallback)

    def _first_positive_int(self, items: Any, key: str, fallback: int) -> int:
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and self._is_number(item.get(key)):
                    return self._positive_int(item[key], fallback)
        return int(fallback)

    def _positive_int(self, value: Any, fallback: int) -> int:
        if not self._is_number(value):
            return int(fallback)
        if int(fallback) == 0:
            return max(0, int(round(float(value))))
        return max(1, int(round(float(value))))

    def _non_negative_int(self, value: Any, fallback: int) -> int:
        if not self._is_number(value):
            return max(0, int(fallback))
        return max(0, int(round(float(value))))

    def _non_negative_float(self, value: Any, fallback: float) -> float:
        if not self._is_number(value):
            return max(0.0, float(fallback))
        return max(0.0, float(value))

    def _is_number(self, value: Any) -> bool:
        try:
            float(value)
        except (TypeError, ValueError):
            return False
        return True

    def _is_json_number(self, value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))

    def _is_integer_like(self, value: Any) -> bool:
        if not self._is_json_number(value):
            return False
        numeric = float(value)
        return numeric.is_integer()

    def _is_positive_number(self, value: Any) -> bool:
        return self._is_number(value) and float(value) > 0

    def _truthy_config_flag(self, value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if value in (None, ""):
            return False
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _has_any_number(self, value: Any) -> bool:
        if isinstance(value, list):
            return any(self._is_number(item) for item in value)
        return self._is_number(value)

    def _write_artifact(
        self,
        run_dir: Path,
        output_root: Path,
        kind: str,
        filename: str,
        payload: Any,
        schema_version: str | None,
    ) -> dict[str, Any]:
        target = run_dir / filename
        self._write_json(target, payload, compact=kind == "visualization_state_series")
        data = target.read_bytes()
        artifact = {
            "artifact_id": f"{kind}-{run_dir.name}",
            "kind": kind,
            "path": target.relative_to(output_root).as_posix(),
            "media_type": "application/json",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
        }
        if schema_version is not None:
            artifact["schema_version"] = schema_version
        return artifact

    def _write_json(self, target: Path, payload: Any, *, compact: bool = False) -> None:
        if compact:
            target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            return
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _aircraft_support_v1_monte_carlo_process_worker(
    task: tuple[dict[str, Any], dict[str, Any], int, int],
) -> dict[str, Any]:
    """Run one isolated sample in a spawned process without sharing adapter/model state."""
    return SimulationAdapter()._run_aircraft_support_v1_monte_carlo_worker_task(task)  # noqa: SLF001


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_identifier(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip(".-")
    safe = safe.replace("..", ".")
    return safe or "scenario"


def _normalized_aircraft_tail_number(value: Any) -> str:
    if value in (None, ""):
        return ""
    return re.sub(r"\s+", "", str(value)).casefold()


def _has_cycle(graph: dict[str, list[str]]) -> bool:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        for predecessor in graph.get(node, []):
            if visit(predecessor):
                return True
        visiting.remove(node)
        visited.add(node)
        return False

    return any(visit(node) for node in graph)
