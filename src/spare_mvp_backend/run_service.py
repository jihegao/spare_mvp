"""M6.0 run service boundary over the local synchronous smoke executor."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
from typing import Any

from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_contract.adapter import (
    ARTIFACT_MANIFEST_SCHEMA_VERSION,
    AdapterError,
    RUN_SCHEMA_VERSION,
    SimulationAdapter,
)


class RunServiceError(ValueError):
    """Structured error raised by the M6.0 run service."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class RunService:
    """Submit and query simulation runs without exposing executor details."""

    def __init__(
        self,
        repository: ContractRepository,
        adapter: SimulationAdapter,
        output_dir: Path | str,
    ) -> None:
        self.repository = repository
        self.adapter = adapter
        self.output_dir = Path(output_dir)
        self._run_lock = threading.Lock()

    def submit_run(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._run_lock:
            return self._submit_run_unlocked(request)

    def _submit_run_unlocked(self, request: dict[str, Any]) -> dict[str, Any]:
        project_id = str(request.get("project_id") or "")
        experiment_plan_id = str(request.get("experiment_plan_id") or "")
        raw_model_family = request.get("model_family")
        run_type = str(request.get("run_type") or "single")
        if not project_id or not experiment_plan_id or raw_model_family in (None, ""):
            raise RunServiceError("bad_run_request", "project_id, experiment_plan_id, and model_family are required")
        model_family = str(raw_model_family)
        if run_type != "single":
            raise RunServiceError("unsupported_run_type", "M6.0 only supports run_type=single", run_type=run_type)

        project = self.repository.get_project(project_id)
        plan = self.repository.get_experiment_plan(experiment_plan_id)
        if plan["project_id"] != project_id:
            raise RunServiceError(
                "project_plan_mismatch",
                "experiment plan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )

        snapshot = (
            self.repository.get_modeling_snapshot(plan["modeling_snapshot_id"])
            if plan.get("modeling_snapshot_id")
            else None
        )
        project_for_run = copy.deepcopy(snapshot["project"]) if snapshot else project

        compile_gate = getattr(self.adapter, "compile_scenario_with_gate", None)
        if callable(compile_gate):
            compile_result = compile_gate(project_for_run, model_family=model_family)
            if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
                return self._persist_failed_compile_run(
                    project_id=project_id,
                    experiment_plan_id=experiment_plan_id,
                    modeling_snapshot_id=plan.get("modeling_snapshot_id"),
                    project_for_run=project_for_run,
                    model_family=model_family,
                    compile_result=compile_result,
                )
            scenario = compile_result["scenario"]
        else:
            try:
                scenario = self.adapter.compile_scenario(project_for_run, model_family=model_family)
            except AdapterError as exc:
                raise RunServiceError(exc.code, str(exc), **exc.details) from exc

        scenario = copy.deepcopy(scenario)
        scenario_base_id = f"{scenario['scenario_id']}-{_stable_hash({'experiment_plan_id': experiment_plan_id})}"
        run_id = self.repository.next_run_id(scenario_base_id)
        scenario["scenario_id"] = run_id.removeprefix("run-")

        self.repository.upsert_scenario(scenario)
        try:
            bundle = self.adapter.run_scenario(
                scenario,
                output_dir=self.output_dir,
                steps=_steps_from_plan(plan),
                run_id=run_id,
            )
        except AdapterError as exc:
            return self._persist_failed_run(
                run_id=run_id,
                scenario=scenario,
                experiment_plan_id=experiment_plan_id,
                modeling_snapshot_id=plan.get("modeling_snapshot_id"),
                project_for_run=project_for_run,
                error=exc,
            )

        run = copy.deepcopy(bundle["run"])
        run["experiment_plan_id"] = experiment_plan_id
        run["modeling_snapshot_id"] = plan.get("modeling_snapshot_id")
        run["project_version"] = project_for_run.get("project_version")
        run["project_schema_version"] = project_for_run.get("schema_version")
        run["scenario_schema_version"] = scenario["schema_version"]
        run["phase"] = run.get("phase") or _phase_from_status(run["status"])
        run["queued_at"] = run.get("queued_at") or run.get("started_at")

        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(bundle["result"])
        self.repository.upsert_artifact_manifest(bundle["artifact_manifest"])
        return self._status_from_run(run)

    def get_run_status(self, run_id: str) -> dict[str, Any]:
        return self._status_from_run(self.repository.get_run(run_id))

    def _persist_failed_run(
        self,
        *,
        run_id: str,
        scenario: dict[str, Any],
        experiment_plan_id: str,
        modeling_snapshot_id: str | None,
        project_for_run: dict[str, Any],
        error: AdapterError,
    ) -> dict[str, Any]:
        now = _utc_now()
        manifest_id = f"artifact-manifest-{run_id}"
        model = scenario.get("simulation_model", {})
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "experiment_plan_id": experiment_plan_id,
            "modeling_snapshot_id": modeling_snapshot_id,
            "project_version": project_for_run.get("project_version"),
            "project_schema_version": project_for_run.get("schema_version"),
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "scenario_schema_version": scenario["schema_version"],
            "model_family": model.get("family", "unknown"),
            "model_id": model.get("model_id", "unknown"),
            "status": "failed",
            "phase": "failed",
            "run_type": "single",
            "seed": scenario.get("simulation_inputs", {}).get("seed"),
            "progress": 0,
            "queued_at": now,
            "started_at": now,
            "completed_at": now,
            "result_summary_id": None,
            "artifact_manifest_id": manifest_id,
            "error": {"code": error.code, "message": str(error), "details": error.details},
        }
        manifest = {
            "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
            "artifact_manifest_id": manifest_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "created_at": now,
            "artifacts": [],
        }
        self.repository.upsert_run(run)
        self.repository.upsert_artifact_manifest(manifest)
        return self._status_from_run(run)

    def _persist_failed_compile_run(
        self,
        *,
        project_id: str,
        experiment_plan_id: str,
        modeling_snapshot_id: str | None,
        project_for_run: dict[str, Any],
        model_family: str,
        compile_result: dict[str, Any],
    ) -> dict[str, Any]:
        now = _utc_now()
        run_base_id = f"compile-gate-{_stable_hash({'project_id': project_id, 'experiment_plan_id': experiment_plan_id, 'model_family': model_family})}"
        run_id = self.repository.next_run_id(run_base_id)
        manifest_id = f"artifact-manifest-{run_id}"
        issues = copy.deepcopy(compile_result.get("issues") or [])
        provenance = copy.deepcopy(compile_result.get("provenance") or {})
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": project_id,
            "experiment_plan_id": experiment_plan_id,
            "modeling_snapshot_id": modeling_snapshot_id,
            "project_version": project_for_run.get("project_version"),
            "project_schema_version": project_for_run.get("schema_version"),
            "scenario_id": None,
            "scenario_version": None,
            "scenario_schema_version": None,
            "model_family": model_family,
            "model_id": "ScenarioCompilerGate",
            "status": "failed",
            "phase": "failed",
            "run_type": "single",
            "seed": _seed_from_project(project_for_run),
            "progress": 0,
            "queued_at": now,
            "started_at": now,
            "completed_at": now,
            "result_summary_id": None,
            "artifact_manifest_id": manifest_id,
            "error": {
                "code": _compile_gate_error_code(compile_result),
                "message": _compile_gate_error_message(compile_result, model_family),
                "details": {
                    "issues": issues,
                    "provenance": provenance,
                },
            },
        }
        manifest = {
            "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
            "artifact_manifest_id": manifest_id,
            "run_id": run_id,
            "scenario_id": None,
            "scenario_version": None,
            "created_at": now,
            "artifacts": [],
        }
        self.repository.upsert_run(run)
        self.repository.upsert_artifact_manifest(manifest)
        return self._status_from_run(run)

    def _status_from_run(self, run: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": run["run_id"],
            "project_id": run["project_id"],
            "experiment_plan_id": run.get("experiment_plan_id"),
            "modeling_snapshot_id": run.get("modeling_snapshot_id"),
            "scenario_id": run.get("scenario_id"),
            "status": run["status"],
            "phase": run.get("phase") or _phase_from_status(run["status"]),
            "progress": run.get("progress", 0),
            "run_type": run.get("run_type") or "single",
            "model_family": run["model_family"],
            "seed": run.get("seed"),
            "queued_at": run.get("queued_at") or run.get("started_at"),
            "started_at": run.get("started_at"),
            "completed_at": run.get("completed_at"),
            "error": run.get("error"),
            "result_summary_id": run.get("result_summary_id"),
            "artifact_manifest_id": run.get("artifact_manifest_id"),
        }


def _phase_from_status(status: str) -> str:
    if status == "succeeded":
        return "completed"
    if status == "failed":
        return "failed"
    if status == "running":
        return "running"
    return "queued"


def _steps_from_plan(plan: dict[str, Any]) -> int:
    steps = plan.get("config", {}).get("steps", 3)
    if isinstance(steps, bool):
        return 3
    try:
        return max(0, int(steps))
    except (TypeError, ValueError):
        return 3


def _compile_gate_error_code(compile_result: dict[str, Any]) -> str:
    if compile_result.get("status") == "blocked":
        return "invalid_project"
    return "unsupported_model_family"


def _compile_gate_error_message(compile_result: dict[str, Any], model_family: str) -> str:
    if compile_result.get("status") == "blocked":
        return "Project JSON failed Scenario compiler gate validation"
    return f"{model_family} scenario compilation is blocked until governed field derivation rules are approved"


def _seed_from_project(project: dict[str, Any]) -> int | None:
    seed = project.get("experiment", {}).get("seed")
    if isinstance(seed, bool):
        return None
    try:
        return int(seed)
    except (TypeError, ValueError):
        return None


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:12]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
