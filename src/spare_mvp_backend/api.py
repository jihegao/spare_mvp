"""Function-level backend API facade for contract-first simulation flows."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


class BackendApiError(ValueError):
    """Structured API facade error."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class BackendApi:
    """Thin orchestration layer over the Simulation Adapter and repository."""

    def __init__(
        self,
        repository: ContractRepository,
        adapter: SimulationAdapter,
        output_dir: Path | str,
    ) -> None:
        self.repository = repository
        self.adapter = adapter
        self.output_dir = Path(output_dir)

    def validate_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        return self.adapter.validate_project(project_json)

    def save_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        validation = self.validate_project(project_json)
        if not validation["ok"]:
            raise BackendApiError("invalid_project", "Project JSON failed validation", errors=validation["errors"])

        project = copy.deepcopy(project_json)
        project["project_id"] = validation["project_id"]
        project["schema_version"] = validation["project_schema_version"]
        project["project_version"] = validation["project_version"]
        self.repository.upsert_project(project)
        return {
            "project_id": project["project_id"],
            "project_version": project["project_version"],
            "schema_version": project["schema_version"],
            "status": "saved",
        }

    def create_modeling_snapshot(self, project_id: str) -> dict[str, Any]:
        project = self.repository.get_project(project_id)
        snapshot = {
            "snapshot_id": f"modeling-snapshot-{project_id}-{project['project_version']}",
            "project_id": project_id,
            "schema_version": "modeling-snapshot-v0",
            "project_version": project["project_version"],
            "project": copy.deepcopy(project),
        }
        self.repository.upsert_modeling_snapshot(snapshot)
        return snapshot

    def create_experiment_plan(self, project_id: str, config: dict[str, Any]) -> dict[str, Any]:
        project = self.repository.get_project(project_id)
        plan = {
            "experiment_plan_id": f"experiment-plan-{project_id}-{_stable_hash(config)}",
            "project_id": project_id,
            "schema_version": "experiment-plan-v0",
            "project_version": project["project_version"],
            "status": "draft",
            "config": copy.deepcopy(config),
        }
        self.repository.upsert_experiment_plan(plan)
        return plan

    def start_simulation_run(
        self,
        project_id: str,
        experiment_plan_id: str,
        model_family: str = "smoke",
    ) -> dict[str, Any]:
        project = self.repository.get_project(project_id)
        plan = self.repository.get_experiment_plan(experiment_plan_id)
        if plan["project_id"] != project_id:
            raise BackendApiError(
                "project_plan_mismatch",
                "experiment plan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )

        try:
            scenario = self.adapter.compile_scenario(project, model_family=model_family)
        except AdapterError as exc:
            raise self._to_backend_error(exc, model_family) from exc

        self.repository.upsert_scenario(scenario)
        try:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=self.output_dir,
                steps=_steps_from_plan(plan),
            )
        except AdapterError as exc:
            raise self._to_backend_error(exc, model_family) from exc

        run = copy.deepcopy(bundle["run"])
        run["experiment_plan_id"] = experiment_plan_id
        result = bundle["result"]
        manifest = bundle["artifact_manifest"]
        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(result)
        self.repository.upsert_artifact_manifest(manifest)

        return {
            "run_id": run["run_id"],
            "project_id": run["project_id"],
            "scenario_id": run["scenario_id"],
            "result_summary_id": run["result_summary_id"],
            "artifact_manifest_id": run["artifact_manifest_id"],
            "status": run["status"],
        }

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_run(run_id)

    def get_run_result(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_result_summary_for_run(run_id)

    def get_run_artifacts(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_artifact_manifest_for_run(run_id)

    def get_run_chain(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_run_chain(run_id)

    def _to_backend_error(self, exc: AdapterError, model_family: str) -> BackendApiError:
        if exc.code == "unsupported_model_family" and model_family == "aviation_support":
            return BackendApiError(
                "unsupported_model_family",
                "aviation_support scenario compilation is blocked until governed field derivation rules are approved",
                **exc.details,
            )
        return BackendApiError(exc.code, str(exc), **exc.details)


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:12]


def _steps_from_plan(plan: dict[str, Any]) -> int:
    steps = plan.get("config", {}).get("steps", 3)
    if isinstance(steps, bool):
        return 3
    try:
        return max(0, int(steps))
    except (TypeError, ValueError):
        return 3
