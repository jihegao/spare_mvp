"""Simulation Adapter boundary for contract-first backend migration.

The adapter owns application-facing Project -> Scenario -> Run/Result/Artifact
translation. It consumes the governed Mesa smoke model, but it does not change
Mesa behavior or the contract provider endpoint surface.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any

from src.spare_mvp_abm.smoke_model import SmokeSpareMvpModel


PROJECT_SCHEMA_VERSION = "project-v0"
SCENARIO_SCHEMA_VERSION = "scenario-v0"
RUN_SCHEMA_VERSION = "run-v0"
RESULT_SCHEMA_VERSION = "result-v0"
ARTIFACT_MANIFEST_SCHEMA_VERSION = "artifact-manifest-v0"
MESA_CONTRACT_VERSION = "1.0.0"
ADAPTER_NAME = "Simulation Adapter Agent"


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

        return {
            "ok": not errors,
            "project_id": self._project_id(project),
            "project_version": self._project_version(project),
            "project_schema_version": schema_version,
            "errors": errors,
        }

    def compile_scenario(self, project: dict[str, Any], model_family: str = "smoke") -> dict[str, Any]:
        """Compile a validated Project JSON document into a model-specific Scenario."""
        result = self._compile_scenario_with_gate(project, model_family=model_family)
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
        raise AdapterError(
            "unsupported_model_family",
            "aviation_support requires a Claude-approved compilation rule before Scenario JSON can be emitted",
            model_family=model_family,
            issues=result["issues"],
            provenance=result["provenance"],
        )

    def compile_scenario_with_gate(self, project: dict[str, Any], model_family: str = "smoke") -> dict[str, Any]:
        """Compile with an explicit fail-closed gate result for unsupported paths."""
        return self._compile_scenario_with_gate(project, model_family=model_family)

    def _compile_scenario_with_gate(self, project: dict[str, Any], model_family: str = "smoke") -> dict[str, Any]:
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
                "provenance": self._compile_gate_provenance(project, model_family),
                "issues": issues,
                "errors": validation["errors"],
            }
        if model_family == "smoke":
            scenario = self._compile_smoke_scenario(project, validation)
            return {
                "status": "compiled",
                "scenario": scenario,
                "provenance": scenario["compiled_from"]["mapping_provenance"],
                "issues": [],
            }
        if model_family == "aviation_support":
            provenance = self._compile_gate_provenance(project, model_family)
            return {
                "status": "unsupported",
                "scenario": None,
                "provenance": provenance,
                "issues": self._aviation_support_compile_issues(),
            }
        provenance = self._compile_gate_provenance(project, model_family)
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
                    "suggestion": "Choose smoke or add a governed compiler before submitting this run.",
                }
            ],
        }

    def _compile_smoke_scenario(self, project: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
        project_id = validation["project_id"]
        project_version = validation["project_version"]
        scenario_key = _safe_identifier(str(project.get("scenarioId") or project_id))
        inputs = self._compile_smoke_inputs(project, project_version)
        now = _utc_now()

        return {
            "schema_version": SCENARIO_SCHEMA_VERSION,
            "scenario_id": f"scenario-{scenario_key}",
            "project_id": project_id,
            "scenario_version": "scenario-v0.1",
            "simulation_model": {
                "family": "smoke",
                "model_id": "SmokeSpareMvpModel",
                "contract_version": MESA_CONTRACT_VERSION,
            },
            "compiled_at": now,
            "compiled_by": ADAPTER_NAME,
            "compiled_from": {
                "project_id": project_id,
                "project_version": project_version,
                "project_schema_version": validation["project_schema_version"],
                "mesa_contract_version": MESA_CONTRACT_VERSION,
                "mapping_provenance": self._smoke_mapping_provenance(project_id, project),
            },
            "simulation_inputs": inputs,
        }

    def run_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Run a compiled smoke Scenario and write traceable contract artifacts."""
        self._assert_smoke_scenario(scenario)
        if steps < 0:
            raise AdapterError("bad_steps", "steps must be non-negative", steps=steps)

        inputs = scenario["simulation_inputs"]
        model = SmokeSpareMvpModel(
            projectData=copy.deepcopy(inputs["project_snapshot"]),
            activeModule=inputs["active_module"],
            spareMultiplier=inputs["spare_multiplier"],
            failureRate=inputs["failure_rate"],
            supportCapacity=inputs["support_capacity"],
            minRequiredSorties=inputs["min_required_sorties"],
            seed=inputs["seed"],
        )
        for _ in range(steps):
            model.step()
        snapshot = model.snapshot()

        run_id = run_id or f"run-{scenario['scenario_id']}"
        result_id = f"result-{run_id}"
        manifest_id = f"artifact-manifest-{run_id}"
        now = _utc_now()

        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "model_family": "smoke",
            "result_id": result_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "metrics": snapshot,
        }
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": "smoke",
            "model_id": "SmokeSpareMvpModel",
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
            ("input_project", "input-project.json", inputs["project_snapshot"], PROJECT_SCHEMA_VERSION),
            ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
            ("snapshot", "snapshot.json", snapshot, None),
            ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
        ]
        artifacts = [
            self._write_artifact(run_dir, output_root, kind, filename, payload, schema_version)
            for kind, filename, payload, schema_version in artifact_specs
        ]
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

    def run_monte_carlo_scenario(
        self,
        scenario: dict[str, Any],
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
        monte_carlo_config: dict[str, Any] | None = None,
        **legacy_config: Any,
    ) -> dict[str, dict[str, Any]]:
        """Run a synchronous M6.2 Monte Carlo batch from a compiled smoke Scenario."""
        config = self._require_monte_carlo_config(
            monte_carlo_config=monte_carlo_config,
            legacy_config=legacy_config,
        )
        self._assert_smoke_scenario(scenario)
        if steps < 0:
            raise AdapterError("bad_steps", "steps must be non-negative", steps=steps)

        inputs = scenario["simulation_inputs"]
        run_id = run_id or f"run-{scenario['scenario_id']}-mc"
        result_id = f"result-{run_id}"
        manifest_id = f"artifact-manifest-{run_id}"
        mc_experiment_id = config.get("mc_experiment_id") or f"mc-{run_id.removeprefix('run-')}"
        now = _utc_now()

        profile = self._monte_carlo_profile(scenario, monte_carlo_config=config)
        samples = [
            self._run_monte_carlo_sample(inputs, profile["sample_points"][index], steps=steps, sample_index=index)
            for index in range(profile["sample_count"])
        ]
        aggregate = self._aggregate_sample_metrics(samples)
        base_artifact_id = f"monte_carlo_base-{run_id}"
        projections = self._analysis_projections(aggregate, samples, base_artifact_id)
        base_artifact = {
            "artifact_type": "monte_carlo_base",
            "run_id": run_id,
            "mc_experiment_id": mc_experiment_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "mapping_provenance": copy.deepcopy(scenario["compiled_from"]["mapping_provenance"]),
            "mapping_version": scenario["compiled_from"]["mapping_provenance"].get("mapping_version"),
            "sample_count": profile["sample_count"],
            "seed": inputs["seed"],
            "sweep": profile["sweep"],
            "sample_points": profile["sample_points"],
            "samples": samples,
            "aggregate_metrics": aggregate,
            "logs_summary": {
                "completed_samples": profile["sample_count"],
                "failed_samples": 0,
                "executor": "local_sync_smoke",
            },
        }

        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "model_family": "smoke",
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
            },
        }
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": "smoke",
            "model_id": "SmokeSpareMvpModel",
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
        support_artifact_specs = [
            ("input_project", "input-project.json", inputs["project_snapshot"], PROJECT_SCHEMA_VERSION),
            ("compiled_scenario", "compiled-scenario.json", scenario, SCENARIO_SCHEMA_VERSION),
            ("result_summary", "result-summary.json", result, RESULT_SCHEMA_VERSION),
        ]
        for kind, filename, payload, schema_version in support_artifact_specs:
            self._write_artifact(run_dir, output_root, kind, filename, payload, schema_version)

        artifact_specs = [
            ("monte_carlo_base", "monte-carlo-base.json", base_artifact, None),
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

    def _project_required_fields(self) -> list[str]:
        schema = json.loads((self.contracts_dir / "project.schema.json").read_text(encoding="utf-8"))
        return list(schema["required"])

    def _compile_smoke_inputs(self, project: dict[str, Any], project_version: str) -> dict[str, Any]:
        return {
            "project_snapshot": copy.deepcopy(project),
            "project_version": project_version,
            "active_module": str(project.get("activeModule", "sparePlanning")),
            "spare_multiplier": self._first_number(project.get("monteCarlo", {}).get("spareMultipliers"), 1.0),
            "failure_rate": self._mean_component_failure_rate(project),
            "support_capacity": self._first_positive_int(project.get("supportNodes", []), "equipmentCapacity", 1),
            "min_required_sorties": self._positive_int(
                project.get("equipment", {}).get("minRequiredSorties")
                or project.get("basicMission", {}).get("minRequiredSorties"),
                1,
            ),
            "seed": self._positive_int(project.get("experiment", {}).get("seed"), 0),
        }

    def _smoke_mapping_provenance(self, project_id: str, project: dict[str, Any]) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "modeling_snapshot_id": None,
            "experiment_plan_id": None,
            "model_family": "smoke",
            "mapping_version": "smoke-input-v0",
            "consumed_fields": [
                "activeModule",
                "monteCarlo.spareMultipliers",
                "components[].failureRate",
                "supportNodes[].equipmentCapacity",
                "equipment.minRequiredSorties",
                "basicMission.minRequiredSorties",
                "experiment.seed",
            ],
            "defaults_applied": self._smoke_defaults_applied(project),
            "derived_fields": ["simulation_inputs.failure_rate"],
            "ignored_fields": ["monteCarlo.failureRates", "monteCarlo.supportCapacities"],
            "unsupported_fields": [],
        }

    def _smoke_defaults_applied(self, project: dict[str, Any]) -> list[str]:
        defaults: list[str] = []
        if not self._has_any_number(project.get("monteCarlo", {}).get("spareMultipliers")):
            defaults.append("monteCarlo.spareMultipliers=1.0")
        if not any(self._is_number(component.get("failureRate")) for component in project.get("components", [])):
            defaults.append("components[].failureRate=0.05")
        if not any(
            isinstance(node, dict) and self._is_positive_number(node.get("equipmentCapacity"))
            for node in project.get("supportNodes", [])
        ):
            defaults.append("supportNodes[].equipmentCapacity=1")
        sortie_candidates = [
            project.get("equipment", {}).get("minRequiredSorties"),
            project.get("basicMission", {}).get("minRequiredSorties"),
        ]
        if not any(self._is_positive_number(value) for value in sortie_candidates):
            defaults.append("equipment.minRequiredSorties|basicMission.minRequiredSorties=1")
        if not self._is_number(project.get("experiment", {}).get("seed")):
            defaults.append("experiment.seed=0")
        return defaults

    def _compile_gate_provenance(self, project: dict[str, Any], model_family: str) -> dict[str, Any]:
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
            "unsupported_fields": [
                "missionProfile.durationHours",
                "components[].mtbfHours",
                "supportActivities[].durationHours",
            ]
            if model_family == "aviation_support"
            else ["model_family"],
        }

    def _aviation_support_compile_issues(self) -> list[dict[str, str]]:
        return [
            {
                "code": "missing_compilation_rule",
                "message": "Mission duration cannot be compiled into aviation_support runtime inputs yet.",
                "field_path": "missionProfile.durationHours",
                "page": "任务剖面建模",
                "severity": "error",
                "suggestion": "Approve a field derivation rule for mission duration before enabling aviation_support runs.",
            },
            {
                "code": "missing_compilation_rule",
                "message": "Component MTBF cannot be compiled into aviation_support failure parameters yet.",
                "field_path": "components[].mtbfHours",
                "page": "装备组成建模",
                "severity": "error",
                "suggestion": "Approve an MTBF to failure-parameter mapping before enabling aviation_support runs.",
            },
            {
                "code": "missing_compilation_rule",
                "message": "Support activity duration cannot be compiled into aviation_support service-time inputs yet.",
                "field_path": "supportActivities[].durationHours",
                "page": "保障活动建模",
                "severity": "error",
                "suggestion": "Approve a support activity duration mapping before enabling aviation_support runs.",
            },
        ]

    def _assert_smoke_scenario(self, scenario: dict[str, Any]) -> None:
        model = scenario.get("simulation_model", {})
        if scenario.get("schema_version") != SCENARIO_SCHEMA_VERSION:
            raise AdapterError("invalid_scenario", "unsupported scenario schema version")
        if model.get("family") != "smoke" or model.get("model_id") != "SmokeSpareMvpModel":
            raise AdapterError("unsupported_model_family", "run_scenario currently supports only smoke scenarios")

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
        sample_points = [copy.deepcopy(points[index % len(points)]) for index in range(count)]
        for index, point in enumerate(sample_points):
            point["seed"] = int(inputs["seed"]) + index
        return {
            "sample_count": count,
            "sweep": normalized,
            "sample_points": sample_points,
        }

    def _run_monte_carlo_sample(
        self,
        inputs: dict[str, Any],
        point: dict[str, Any],
        *,
        steps: int,
        sample_index: int,
    ) -> dict[str, Any]:
        model = SmokeSpareMvpModel(
            projectData=copy.deepcopy(inputs["project_snapshot"]),
            activeModule=inputs["active_module"],
            spareMultiplier=point["spare_multiplier"],
            failureRate=point["failure_rate"],
            supportCapacity=point["support_capacity"],
            minRequiredSorties=inputs["min_required_sorties"],
            seed=point["seed"],
        )
        for _ in range(steps):
            model.step()
        return {
            "sample_index": sample_index,
            "seed": point["seed"],
            "sweep": {
                "failure_rate": point["failure_rate"],
                "spare_multiplier": point["spare_multiplier"],
                "support_capacity": point["support_capacity"],
            },
            "metrics": model.snapshot(),
        }

    def _aggregate_sample_metrics(self, samples: list[dict[str, Any]]) -> dict[str, Any]:
        keys = sorted({key for sample in samples for key in sample["metrics"] if self._is_number(sample["metrics"][key])})
        aggregate = {
            key: sum(float(sample["metrics"].get(key, 0)) for sample in samples) / max(1, len(samples))
            for key in keys
        }
        aggregate["sample_count"] = len(samples)
        aggregate["mission_success_probability"] = aggregate.get("mission_success_rate", 0)
        aggregate["spare_shortage_probability"] = (
            sum(1 for sample in samples if float(sample["metrics"].get("shortage_events", 0)) > 0) / max(1, len(samples))
        )
        return aggregate

    def _analysis_projections(
        self,
        aggregate: dict[str, Any],
        samples: list[dict[str, Any]],
        base_artifact_id: str,
    ) -> dict[str, dict[str, Any]]:
        shortage_probability = aggregate.get("spare_shortage_probability", 0)
        spare_fill_rate = aggregate.get("spare_fill_rate", 0)
        downtime_total = (
            aggregate.get("downtime_failure_events", 0)
            + aggregate.get("downtime_spare_shortage_events", 0)
            + aggregate.get("downtime_resource_delay_events", 0)
        ) or 1
        return {
            "large_sample_summary": {
                "projection_type": "large_sample_summary",
                "base_artifact_id": base_artifact_id,
                "data": {
                    "sample_count": len(samples),
                    "mission_success_probability": aggregate.get("mission_success_probability", 0),
                    "spare_fill_rate": spare_fill_rate,
                    "mean_repair_backlog": aggregate.get("repair_backlog", 0),
                },
            },
            "spare_shortfall": {
                "projection_type": "spare_shortfall",
                "base_artifact_id": base_artifact_id,
                "data": [
                    {
                        "spare_type": "generic_spares",
                        "fill_rate": spare_fill_rate,
                        "shortage_probability": shortage_probability,
                        "risk_level": "high" if shortage_probability >= 0.2 else "medium" if shortage_probability > 0 else "low",
                    }
                ],
            },
            "carry_list": {
                "projection_type": "carry_list",
                "base_artifact_id": base_artifact_id,
                "data": [
                    {
                        "spare_type": "generic_spares",
                        "recommended_multiplier": max(1.0, 1.0 + shortage_probability),
                        "risk_level": "high" if spare_fill_rate < 0.75 else "medium" if spare_fill_rate < 0.95 else "low",
                    }
                ],
            },
            "mission_reliability": {
                "projection_type": "mission_reliability",
                "base_artifact_id": base_artifact_id,
                "data": {
                    "mission_success_probability": aggregate.get("mission_success_probability", 0),
                    "sortie_rate": aggregate.get("sortie_rate", 0),
                    "target_met": aggregate.get("mission_success_probability", 0) >= 0.9,
                },
            },
            "downtime_factors": {
                "projection_type": "downtime_factors",
                "base_artifact_id": base_artifact_id,
                "data": [
                    {
                        "factor": "failure",
                        "contribution": aggregate.get("downtime_failure_events", 0) / downtime_total,
                    },
                    {
                        "factor": "spare_shortage",
                        "contribution": aggregate.get("downtime_spare_shortage_events", 0) / downtime_total,
                    },
                    {
                        "factor": "resource_delay",
                        "contribution": aggregate.get("downtime_resource_delay_events", 0) / downtime_total,
                    },
                ],
            },
        }

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

    def _mean_component_failure_rate(self, project: dict[str, Any]) -> float:
        rates = [
            float(component["failureRate"])
            for component in project.get("components", [])
            if self._is_number(component.get("failureRate"))
        ]
        if not rates:
            return 0.05
        return sum(rates) / len(rates)

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
        self._write_json(target, payload)
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

    def _write_json(self, target: Path, payload: Any) -> None:
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_identifier(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip(".-")
    safe = safe.replace("..", ".")
    return safe or "scenario"
