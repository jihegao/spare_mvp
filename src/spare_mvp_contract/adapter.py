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
