"""M6.0 run service boundary over the local synchronous smoke executor."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
from typing import Any

from src.spare_mvp_backend.errors import RunServiceError
from src.spare_mvp_backend.monte_carlo_config import (
    normalize_monte_carlo_run_config,
    reject_request_level_monte_carlo_config,
)
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_contract.adapter import (
    ARTIFACT_MANIFEST_SCHEMA_VERSION,
    AdapterError,
    RUN_SCHEMA_VERSION,
    SimulationAdapter,
)


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
        if run_type not in {"single", "monte_carlo"}:
            raise RunServiceError(
                "unsupported_run_type",
                "run_type must be single or monte_carlo",
                run_type=run_type,
            )
        if run_type == "monte_carlo":
            reject_request_level_monte_carlo_config(request)

        project = self.repository.get_project(project_id)
        plan = self.repository.get_experiment_plan(experiment_plan_id)
        if plan["project_id"] != project_id:
            raise RunServiceError(
                "project_plan_mismatch",
                "experiment plan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )
        mc_config = None
        if run_type == "monte_carlo":
            mc_config = normalize_monte_carlo_run_config(
                plan.get("config") or {},
                mc_experiment_id=_monte_carlo_experiment_id(request, plan, ""),
            )

        snapshot = (
            self.repository.get_modeling_snapshot(plan["modeling_snapshot_id"])
            if plan.get("modeling_snapshot_id")
            else None
        )
        project_for_run = _project_for_experiment_plan(project, plan, snapshot)
        if request.get("formal_run"):
            self._assert_formal_run_uses_imported_sample(project_for_run)

        compile_gate = getattr(self.adapter, "compile_scenario_with_gate", None)
        if callable(compile_gate):
            compile_result = compile_gate(project_for_run, model_family=model_family)
            _annotate_mapping_provenance(
                compile_result.get("provenance"),
                experiment_plan_id=experiment_plan_id,
                modeling_snapshot_id=plan.get("modeling_snapshot_id"),
            )
            if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
                return self._persist_failed_compile_run(
                    project_id=project_id,
                    experiment_plan_id=experiment_plan_id,
                    modeling_snapshot_id=plan.get("modeling_snapshot_id"),
                    project_for_run=project_for_run,
                    model_family=model_family,
                    run_type=run_type,
                    compile_result=compile_result,
                )
            scenario = compile_result["scenario"]
        else:
            try:
                scenario = self.adapter.compile_scenario(project_for_run, model_family=model_family)
            except AdapterError as exc:
                raise RunServiceError(exc.code, str(exc), **exc.details) from exc

        scenario = copy.deepcopy(scenario)
        _annotate_mapping_provenance(
            scenario.get("compiled_from", {}).get("mapping_provenance"),
            experiment_plan_id=experiment_plan_id,
            modeling_snapshot_id=plan.get("modeling_snapshot_id"),
        )
        scenario_base_id = f"{scenario['scenario_id']}-{_stable_hash({'experiment_plan_id': experiment_plan_id})}"
        run_id = self.repository.next_run_id(scenario_base_id)
        scenario["scenario_id"] = run_id.removeprefix("run-")

        self.repository.upsert_scenario(scenario)
        try:
            if run_type == "monte_carlo":
                config_payload = mc_config.to_adapter_payload()
                config_payload["mc_experiment_id"] = config_payload.get("mc_experiment_id") or _monte_carlo_experiment_id(
                    request,
                    plan,
                    run_id,
                )
                bundle = self.adapter.run_monte_carlo_scenario(
                    scenario,
                    output_dir=self.output_dir,
                    steps=_steps_from_plan(plan),
                    run_id=run_id,
                    monte_carlo_config=config_payload,
                )
            else:
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
                run_type=run_type,
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
        _attach_simulation_experiment_base(
            run,
            scenario=scenario,
            run_type=run_type,
            experiment_plan_id=experiment_plan_id,
            modeling_snapshot_id=plan.get("modeling_snapshot_id"),
            artifact_manifest=bundle["artifact_manifest"],
            request=request,
        )
        self._augment_run_config_artifact(
            bundle["artifact_manifest"],
            run_id=run_id,
            experiment_plan_id=experiment_plan_id,
            modeling_snapshot_id=plan.get("modeling_snapshot_id"),
            plan=plan,
            request=request,
        )

        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(bundle["result"])
        self.repository.upsert_artifact_manifest(bundle["artifact_manifest"])
        return self._status_from_run(run)

    def _assert_formal_run_uses_imported_sample(self, project_for_run: dict[str, Any]) -> None:
        project_id = str(project_for_run.get("project_id") or "")
        mission_profile = project_for_run.get("missionProfile") if isinstance(project_for_run.get("missionProfile"), dict) else {}
        source_import_id = str((mission_profile or {}).get("sourceImportId") or "")
        if not source_import_id:
            raise RunServiceError(
                "formal_run_requires_imported_sample",
                "formal runs require a project generated from a published modeling import",
                project_id=project_id,
                source_import_id=None,
            )
        try:
            stored_import = self.repository.get_modeling_import(source_import_id)
        except KeyError as exc:
            raise RunServiceError(
                "formal_run_requires_imported_sample",
                "formal runs require a project generated from a published modeling import",
                project_id=project_id,
                source_import_id=source_import_id,
            ) from exc
        published_package = stored_import.get("publishedPackage")
        if not published_package:
            raise RunServiceError(
                "formal_run_requires_imported_sample",
                "formal runs require a published modeling import",
                project_id=project_id,
                source_import_id=source_import_id,
            )
        published_project_id = str(published_package.get("projectId") or stored_import.get("projectId") or "")
        if published_project_id and project_id and published_project_id != project_id:
            raise RunServiceError(
                "formal_run_requires_imported_sample",
                "formal run project does not match the published modeling import",
                project_id=project_id,
                source_import_id=source_import_id,
                published_project_id=published_project_id,
            )
        create_events = [
            event
            for event in self.repository.list_audit_events(resource_id=source_import_id)
            if event.get("action") == "modeling_import.create_project"
            and event.get("outcome") == "allowed"
            and (event.get("details") or {}).get("project_id") == project_id
        ]
        if not create_events:
            raise RunServiceError(
                "formal_run_requires_imported_sample",
                "formal runs require a backend-created imported sample Project",
                project_id=project_id,
                source_import_id=source_import_id,
                reason="missing_create_project_audit",
            )

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
        run_type: str,
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
            "run_type": run_type,
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
        log_payload = {
            "schema_version": "run-log-v0",
            "run_id": run_id,
            "status": "failed",
            "project_id": run["project_id"],
            "experiment_plan_id": experiment_plan_id,
            "modeling_snapshot_id": modeling_snapshot_id,
            "scenario_id": scenario.get("scenario_id"),
            "scenario_version": scenario.get("scenario_version"),
            "model_family": run["model_family"],
            "run_type": run_type,
            "events": [
                {
                    "event": "run_failed",
                    "at": now,
                    "error": run["error"],
                }
            ],
        }
        manifest["artifacts"] = [self._write_run_log_artifact(run_id, manifest_id, log_payload)]
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
        run_type: str,
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
            "run_type": run_type,
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
        log_payload = {
            "schema_version": "run-log-v0",
            "run_id": run_id,
            "status": "failed",
            "project_id": project_id,
            "experiment_plan_id": experiment_plan_id,
            "modeling_snapshot_id": modeling_snapshot_id,
            "scenario_id": None,
            "scenario_version": None,
            "model_family": model_family,
            "run_type": run_type,
            "events": [
                {
                    "event": "compile_gate_failed",
                    "at": now,
                    "error": run["error"],
                    "issues": issues,
                    "provenance": provenance,
                }
            ],
        }
        manifest["artifacts"] = [self._write_run_log_artifact(run_id, manifest_id, log_payload)]
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
            "experiment_id": run.get("experiment_id"),
            "experiment_type": run.get("experiment_type"),
            "mc_experiment_id": run.get("mc_experiment_id"),
            "simulation_experiment_base": run.get("simulation_experiment_base"),
        }

    def _augment_run_config_artifact(
        self,
        manifest: dict[str, Any],
        *,
        run_id: str,
        experiment_plan_id: str,
        modeling_snapshot_id: str | None,
        plan: dict[str, Any],
        request: dict[str, Any],
    ) -> None:
        run_config = next(
            (artifact for artifact in manifest.get("artifacts", []) if artifact.get("kind") == "run_config"),
            None,
        )
        if run_config is None:
            return
        target = (self.output_dir / run_config["path"]).resolve()
        output_root = self.output_dir.resolve()
        if output_root not in target.parents and target != output_root:
            raise RunServiceError("artifact_path_escape", "run_config artifact path escapes output directory", run_id=run_id)
        payload = json.loads(target.read_text(encoding="utf-8"))
        payload["experiment_plan_id"] = experiment_plan_id
        payload["modeling_snapshot_id"] = modeling_snapshot_id
        payload["plan_config"] = copy.deepcopy(plan.get("config") or {})
        payload["request"] = {
            "run_type": request.get("run_type"),
            "model_family": request.get("model_family"),
            "mc_experiment_id": request.get("mc_experiment_id"),
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        data = target.read_bytes()
        run_config["sha256"] = hashlib.sha256(data).hexdigest()
        run_config["size_bytes"] = len(data)

    def _write_run_log_artifact(self, run_id: str, manifest_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        run_dir = self.output_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        target = run_dir / "events-log.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        data = target.read_bytes()
        return {
            "artifact_id": f"log-{run_id}",
            "kind": "log",
            "path": target.relative_to(self.output_dir).as_posix(),
            "media_type": "application/json",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
            "schema_version": "run-log-v0",
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


def _monte_carlo_experiment_id(request: dict[str, Any], plan: dict[str, Any], run_id: str) -> str:
    config = plan.get("config") or {}
    candidates = [
        request.get("mc_experiment_id"),
        request.get("experiment_id"),
        (request.get("monte_carlo") or {}).get("mc_experiment_id") if isinstance(request.get("monte_carlo"), dict) else None,
        (config.get("monteCarloExperiment") or {}).get("mc_experiment_id")
        if isinstance(config.get("monteCarloExperiment"), dict)
        else None,
    ]
    for value in candidates:
        if value:
            return str(value)
    if not run_id:
        return ""
    return f"mc-{run_id.removeprefix('run-')}"


def _attach_simulation_experiment_base(
    run: dict[str, Any],
    *,
    scenario: dict[str, Any],
    run_type: str,
    experiment_plan_id: str,
    modeling_snapshot_id: str | None,
    artifact_manifest: dict[str, Any],
    request: dict[str, Any],
) -> None:
    experiment_type = "monte_carlo" if run_type == "monte_carlo" else "single"
    experiment_id = str(request.get("experiment_id") or run.get("experiment_id") or f"experiment-{run['run_id']}")
    artifact_ids = [
        artifact.get("artifact_id")
        for artifact in artifact_manifest.get("artifacts", [])
        if isinstance(artifact, dict) and artifact.get("artifact_id")
    ]
    base = {
        "experiment_id": experiment_id,
        "experiment_type": experiment_type,
        "module": scenario.get("simulation_inputs", {}).get("active_module"),
        "project_id": run.get("project_id"),
        "experiment_plan_id": experiment_plan_id,
        "modeling_snapshot_id": modeling_snapshot_id,
        "scenario_id": scenario.get("scenario_id"),
        "scenario_version": scenario.get("scenario_version"),
        "scenario_schema_version": scenario.get("schema_version"),
        "mapping_provenance": copy.deepcopy(scenario.get("compiled_from", {}).get("mapping_provenance") or {}),
        "seed": run.get("seed"),
        "status": run.get("status"),
        "progress": run.get("progress", 0),
        "run_id": run.get("run_id"),
        "artifact_manifest_id": run.get("artifact_manifest_id"),
        "artifact_ids": artifact_ids,
    }
    run["experiment_id"] = experiment_id
    run["experiment_type"] = experiment_type
    if run_type == "monte_carlo":
        run["mc_experiment_id"] = run.get("mc_experiment_id") or _monte_carlo_experiment_id(request, {"config": {}}, run["run_id"])
        base["mc_experiment_id"] = run["mc_experiment_id"]
    run["simulation_experiment_base"] = base


def _project_for_experiment_plan(project: dict[str, Any], plan: dict[str, Any], snapshot: dict[str, Any] | None) -> dict[str, Any]:
    config = plan.get("config") or {}
    branch_project = config.get("projectJson") or config.get("project_json")
    if isinstance(branch_project, dict):
        project_for_run = copy.deepcopy(branch_project)
        expected_project_id = project.get("project_id")
        branch_project_id = project_for_run.get("project_id") or project_for_run.get("scenarioId")
        if branch_project_id and expected_project_id and branch_project_id != expected_project_id:
            raise RunServiceError(
                "project_plan_mismatch",
                "experiment plan projectJson does not belong to project",
                project_id=expected_project_id,
                experiment_plan_id=plan.get("experiment_plan_id"),
                branch_project_id=branch_project_id,
            )
        if expected_project_id:
            project_for_run["project_id"] = expected_project_id
        return project_for_run
    return copy.deepcopy(snapshot["project"]) if snapshot else project


def _annotate_mapping_provenance(
    provenance: dict[str, Any] | None,
    *,
    experiment_plan_id: str,
    modeling_snapshot_id: str | None,
) -> None:
    if not isinstance(provenance, dict):
        return
    provenance["experiment_plan_id"] = experiment_plan_id
    provenance["modeling_snapshot_id"] = modeling_snapshot_id


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
