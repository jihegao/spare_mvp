"""Function-level backend API facade for contract-first simulation flows."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import threading
from typing import Any

from src.spare_mvp_backend.errors import BackendApiError
from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_backend.project_payload import project_runtime_config_paths, strip_project_sweep
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_backend.run_service import ACTIVE_FORMAL_MODEL_FAMILY, RETIRED_FORMAL_MODEL_FAMILIES, RunService, RunServiceError
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


ANALYSIS_PROJECTION_ARTIFACT_KINDS = {
    "spare_shortfall": "analysis_projection_spare_shortfall",
    "carry_list": "analysis_projection_carry_list",
    "mission_reliability": "analysis_projection_mission_reliability",
    "downtime_factors": "analysis_projection_downtime_factors",
}


class BackendApi:
    """Thin orchestration layer over the Simulation Adapter and repository."""

    def __init__(
        self,
        repository: ContractRepository,
        adapter: SimulationAdapter,
        output_dir: Path | str,
        run_lifecycle_lock: threading.Lock | None = None,
    ) -> None:
        self.repository = repository
        self.adapter = adapter
        self.output_dir = Path(output_dir)
        lifecycle_lock = run_lifecycle_lock or threading.Lock()
        self.run_service = RunService(repository, adapter, self.output_dir, run_lifecycle_lock=lifecycle_lock)

    def validate_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        validation = self.adapter.validate_project(project_json)
        runtime_config_errors = [
            {
                "code": "unsupported_project_runtime_config",
                "path": path,
                "message": (
                    "Project JSON must not include runtime analysis or Monte Carlo config; "
                    "use ExperimentPlan.config / RunIntent / MonteCarloRunConfig"
                ),
            }
            for path in project_runtime_config_paths(project_json)
        ]
        if runtime_config_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *runtime_config_errors]
        return validation

    def login(self, username: str, password: str) -> dict[str, Any]:
        try:
            user = self.repository.get_user_by_username(username)
        except KeyError as exc:
            raise BackendApiError("invalid_credentials", "Invalid username or password") from exc
        if user.get("status") != "active" or user.get("password_hash") != _password_hash(password):
            raise BackendApiError("invalid_credentials", "Invalid username or password")
        session = self.repository.create_session(user["user_id"])
        self.repository.insert_audit_event(
            actor_user_id=user["user_id"],
            action="auth.login",
            resource_type="session",
            resource_id=_session_audit_id(session["token"]),
            outcome="allowed",
            details={"username": username},
        )
        return {
            "user": _public_user(user),
            "session": {"token": session["token"]},
        }

    def get_session_user(self, token: str) -> dict[str, Any]:
        user = self.repository.get_session_user(token)
        if user.get("status") != "active":
            raise KeyError(token)
        return _public_user(user)

    def list_users(self, *, actor_user_id: str | None = None) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员"},
            action="users.list",
            resource_type="users",
            resource_id="users",
        )
        return {"users": [_public_user(user) for user in self.repository.list_users()]}

    def create_user(self, user: dict[str, Any], *, actor_user_id: str | None = None) -> dict[str, Any]:
        resource_id = str(user.get("username") or "")
        self._require_role(
            actor_user_id,
            {"系统管理员"},
            action="users.create",
            resource_type="user",
            resource_id=resource_id,
        )
        created = self.repository.create_user(user)
        self._audit_allowed(
            actor_user_id,
            action="users.create",
            resource_type="user",
            resource_id=created["user_id"],
            details={"username": created["username"], "role": created["role"]},
        )
        return _public_user(created)

    def update_user(
        self,
        user_id: str,
        updates: dict[str, Any],
        *,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员"},
            action="users.update",
            resource_type="user",
            resource_id=user_id,
        )
        updated = self.repository.update_user(user_id, updates)
        self._audit_allowed(
            actor_user_id,
            action="users.update",
            resource_type="user",
            resource_id=updated["user_id"],
            details={"username": updated["username"], "role": updated["role"], "status": updated.get("status")},
        )
        return _public_user(updated)

    def delete_user(self, user_id: str, *, actor_user_id: str | None = None) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员"},
            action="users.delete",
            resource_type="user",
            resource_id=user_id,
        )
        try:
            deleted = self.repository.delete_user(user_id)
        except ValueError as exc:
            raise BackendApiError("protected_user", str(exc), user_id=user_id) from exc
        self._audit_allowed(
            actor_user_id,
            action="users.delete",
            resource_type="user",
            resource_id=deleted["user_id"],
            details={"username": deleted["username"], "status": deleted.get("status")},
        )
        return {"deleted": True, "user": _public_user(deleted)}

    def get_system_config(self, config_key: str) -> dict[str, Any]:
        try:
            return self.repository.get_system_config(config_key)
        except KeyError:
            return {"config_key": config_key, "payload": {}, "updated_by": None, "updated_at": None}

    def save_system_config(
        self,
        config_key: str,
        payload: dict[str, Any],
        *,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="system_config.save",
            resource_type="system_config",
            resource_id=config_key,
        )
        saved = self.repository.upsert_system_config(config_key, payload, updated_by=actor_user_id)
        self._audit_allowed(
            actor_user_id,
            action="system_config.save",
            resource_type="system_config",
            resource_id=config_key,
            details={"config_key": config_key},
        )
        return saved

    def get_project(self, project_id: str) -> dict[str, Any]:
        return strip_project_sweep(self.repository.get_project(project_id))

    def list_projects(self) -> dict[str, Any]:
        projects = self.repository.list_projects()
        return {
            "projects": [_project_list_entry(project) for project in projects],
        }

    def delete_project(self, project_id: str) -> dict[str, Any]:
        try:
            return self.repository.delete_project(project_id)
        except ValueError as exc:
            raise BackendApiError("project_has_runs", str(exc)) from exc

    def save_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        validation = self.validate_project(project_json)
        if not validation["ok"]:
            raise BackendApiError("invalid_project", "Project JSON failed validation", errors=validation["errors"])

        project = strip_project_sweep(project_json)
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

    def validate_modeling_import(self, import_package: dict[str, Any]) -> dict[str, Any]:
        return validate_modeling_import_package(import_package)

    def save_modeling_import(
        self,
        import_package: dict[str, Any],
        *,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        return self._save_modeling_import_trusted(import_package, actor_user_id=actor_user_id, allow_system=False)

    def save_modeling_import_as_system(self, import_package: dict[str, Any]) -> dict[str, Any]:
        return self._save_modeling_import_trusted(import_package, actor_user_id=None, allow_system=True)

    def _save_modeling_import_trusted(
        self,
        import_package: dict[str, Any],
        *,
        actor_user_id: str | None,
        allow_system: bool,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="modeling_import.save",
            resource_type="modeling_import",
            resource_id=str(import_package.get("importId") or ""),
            allow_system=allow_system,
        )
        validation = self.validate_modeling_import(import_package)
        if not validation["ok"]:
            raise BackendApiError(
                "invalid_modeling_import",
                "Modeling import package failed validation",
                issues=validation["issues"],
            )
        try:
            self.repository.upsert_modeling_import(import_package, validation)
        except ValueError as exc:
            raise BackendApiError("published_import_referenced", str(exc), import_id=import_package["importId"]) from exc
        self._audit_allowed(
            actor_user_id,
            action="modeling_import.save",
            resource_type="modeling_import",
            resource_id=import_package["importId"],
            details={"project_id": import_package["projectId"], **({"actor": "system"} if allow_system else {})},
            allow_system=allow_system,
        )
        return {
            "import_id": import_package["importId"],
            "project_id": import_package["projectId"],
            "schema_version": import_package["schemaVersion"],
            "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
            "status": import_package.get("lifecycle", {}).get("state", "draft"),
            "validation_status": validation["status"],
        }

    def get_modeling_import(self, import_id: str) -> dict[str, Any]:
        return self.repository.get_modeling_import(import_id)

    def list_project_data_templates(self, *, state: str = "published") -> dict[str, Any]:
        return {
            "templates": self.repository.list_project_data_templates(state=state or "published")
        }

    def publish_modeling_import(self, import_id: str, *, actor_user_id: str | None = None) -> dict[str, Any]:
        return self._publish_modeling_import_trusted(import_id, actor_user_id=actor_user_id, allow_system=False)

    def publish_modeling_import_as_system(self, import_id: str) -> dict[str, Any]:
        return self._publish_modeling_import_trusted(import_id, actor_user_id=None, allow_system=True)

    def _publish_modeling_import_trusted(
        self,
        import_id: str,
        *,
        actor_user_id: str | None,
        allow_system: bool,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="modeling_import.publish",
            resource_type="modeling_import",
            resource_id=import_id,
            allow_system=allow_system,
        )
        try:
            published = self.repository.publish_modeling_import(import_id)
        except ValueError as exc:
            raise BackendApiError("published_import_referenced", str(exc), import_id=import_id) from exc
        self._audit_allowed(
            actor_user_id,
            action="modeling_import.publish",
            resource_type="modeling_import",
            resource_id=import_id,
            details={"project_id": published["projectId"], **({"actor": "system"} if allow_system else {})},
            allow_system=allow_system,
        )
        return published

    def compile_modeling_import_scenario(self, import_id: str, model_family: str = ACTIVE_FORMAL_MODEL_FAMILY) -> dict[str, Any]:
        if model_family != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "retired_model_family",
                f"{model_family} is retired for modeling import Scenario compilation; use {ACTIVE_FORMAL_MODEL_FAMILY}",
                model_family=model_family,
                replacement_model_family=ACTIVE_FORMAL_MODEL_FAMILY,
                retired_model_families=list(RETIRED_FORMAL_MODEL_FAMILIES),
            )
        stored = self.repository.get_modeling_import(import_id)
        import_package = stored.get("publishedPackage")
        if import_package is None:
            raise BackendApiError(
                "unpublished_modeling_import",
                "Modeling import must be published before Scenario compilation",
                import_id=import_id,
            )
        validation = self.validate_modeling_import(import_package)
        if not validation["ok"]:
            raise BackendApiError(
                "invalid_modeling_import",
                "Modeling import package failed validation",
                issues=validation["issues"],
            )

        project = modeling_import_to_project(import_package, validation=validation)
        try:
            gate = self.adapter.compile_scenario_with_gate(project, model_family=model_family)
        except AdapterError as exc:
            raise self._to_backend_error(exc, model_family) from exc

        gate_issues = list(gate.get("issues") or [])
        gate_errors = list(gate.get("errors") or [])
        return {
            "compiled_from_import": {
                "import_id": import_id,
                "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
                "project_id": project["project_id"],
                "model_family": model_family,
            },
            "project": project,
            "status": gate.get("status", "blocked"),
            "scenario": gate.get("scenario"),
            "provenance": copy.deepcopy(gate.get("provenance") or {}),
            "issues": gate_issues,
            "errors": gate_errors,
            "usedTables": copy.deepcopy(validation["usedTables"]),
            "warnings": copy.deepcopy(validation.get("warnings") or []) + list(gate.get("warnings") or []),
        }

    def create_project_from_modeling_import(
        self,
        import_id: str,
        *,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        return self._create_project_from_modeling_import_trusted(
            import_id,
            actor_user_id=actor_user_id,
            allow_system=False,
        )

    def create_project_from_modeling_import_as_system(self, import_id: str) -> dict[str, Any]:
        return self._create_project_from_modeling_import_trusted(
            import_id,
            actor_user_id=None,
            allow_system=True,
        )

    def _create_project_from_modeling_import_trusted(
        self,
        import_id: str,
        *,
        actor_user_id: str | None,
        allow_system: bool,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="modeling_import.create_project",
            resource_type="modeling_import",
            resource_id=import_id,
            allow_system=allow_system,
        )
        stored = self.repository.get_modeling_import(import_id)
        import_package = stored.get("publishedPackage")
        if import_package is None:
            raise BackendApiError(
                "unpublished_modeling_import",
                "Modeling import must be published before creating a sample Project",
                import_id=import_id,
            )
        validation = self.validate_modeling_import(import_package)
        if not validation["ok"]:
            raise BackendApiError(
                "invalid_modeling_import",
                "Modeling import package failed validation",
                issues=validation["issues"],
            )

        project_json = self._project_instance_from_modeling_import(modeling_import_to_project(import_package, validation=validation))
        saved = self.save_project(project_json)
        project = self.repository.get_project(saved["project_id"])
        snapshot = self.create_modeling_snapshot(saved["project_id"])
        self._audit_allowed(
            actor_user_id,
            action="modeling_import.create_project",
            resource_type="modeling_import",
            resource_id=import_id,
            details={
                "project_id": saved["project_id"],
                "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
                **({"actor": "system"} if allow_system else {}),
            },
            allow_system=allow_system,
        )
        return {
            "sourceImport": {
                "import_id": import_id,
                "import_version": int(import_package.get("lifecycle", {}).get("version") or 1),
                "project_id": saved["project_id"],
            },
            "savedProject": saved,
            "project": project,
            "modelingSnapshot": snapshot,
        }

    def _project_instance_from_modeling_import(self, project_json: dict[str, Any]) -> dict[str, Any]:
        project = copy.deepcopy(project_json)
        base_project_id = str(project.get("project_id") or "project-imported-sample").strip() or "project-imported-sample"
        base_scenario_id = str(project.get("scenarioId") or base_project_id).strip() or base_project_id
        existing_project_ids = {
            str(entry.get("project_id") or "").strip()
            for entry in self.repository.list_projects()
            if str(entry.get("project_id") or "").strip()
        }
        if base_project_id not in existing_project_ids:
            project["project_id"] = base_project_id
            project["scenarioId"] = base_scenario_id
            return project

        sequence = 2
        while True:
            suffix = f"copy-{sequence}"
            project_id = f"{base_project_id}-{suffix}"
            if project_id not in existing_project_ids:
                project["project_id"] = project_id
                project["scenarioId"] = f"{base_scenario_id}-{suffix}"
                for section_key in ("experiment", "projectInfo"):
                    section = project.get(section_key)
                    if not isinstance(section, dict):
                        continue
                    name = section.get("name")
                    if isinstance(name, str) and name.strip():
                        section["name"] = f"{name.strip()} 副本 {sequence}"
                return project
            sequence += 1

    def create_modeling_snapshot(self, project_id: str) -> dict[str, Any]:
        project = self.repository.get_project(project_id)
        snapshot = {
            "snapshot_id": self.repository.next_modeling_snapshot_id(project_id),
            "project_id": project_id,
            "schema_version": "modeling-snapshot-v0",
            "project_version": project["project_version"],
            "project": copy.deepcopy(project),
        }
        self.repository.upsert_modeling_snapshot(snapshot)
        return snapshot

    def create_experiment_plan(self, project_id: str, config: dict[str, Any]) -> dict[str, Any]:
        project = self.repository.get_project(project_id)
        plan_config = _normalize_experiment_plan_config(config)
        requested_snapshot_id = str(plan_config.pop("modeling_snapshot_id", "") or "").strip()
        snapshot = (
            self.repository.get_modeling_snapshot(requested_snapshot_id)
            if requested_snapshot_id
            else self.repository.get_latest_modeling_snapshot(project_id)
        )
        if snapshot is not None and snapshot.get("project_id") != project_id:
            raise BackendApiError(
                "modeling_snapshot_project_mismatch",
                "modeling snapshot does not belong to project",
                project_id=project_id,
                modeling_snapshot_id=snapshot.get("snapshot_id"),
            )
        if snapshot is None:
            snapshot = self.create_modeling_snapshot(project_id)
        plan_key = {"config": plan_config, "modeling_snapshot_id": snapshot["snapshot_id"]}
        plan = {
            "experiment_plan_id": f"experiment-plan-{project_id}-{_stable_hash(plan_key)}",
            "project_id": project_id,
            "modeling_snapshot_id": snapshot["snapshot_id"],
            "schema_version": "experiment-plan-v0",
            "project_version": project["project_version"],
            "status": "draft",
            "config": plan_config,
        }
        self.repository.upsert_experiment_plan(plan)
        return plan

    def list_experiment_plans(self, project_id: str) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "experiment_plans": self.repository.list_experiment_plans(project_id),
        }

    def delete_experiment_plan(
        self,
        project_id: str,
        experiment_plan_id: str,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        actor_user_id = _require_m7_actor(actor_user_id)
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="experiment_plans.delete",
            resource_type="experiment_plan",
            resource_id=experiment_plan_id,
        )
        try:
            return self.run_service.delete_experiment_plan(
                project_id,
                experiment_plan_id,
                actor_user_id=actor_user_id,
            )
        except KeyError as exc:
            raise BackendApiError(
                "experiment_plan_not_found",
                "ExperimentPlan not found",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            ) from exc

    def start_simulation_run(
        self,
        project_id: str,
        experiment_plan_id: str,
        model_family: str = ACTIVE_FORMAL_MODEL_FAMILY,
    ) -> dict[str, Any]:
        return self.submit_run(
            {
                "project_id": project_id,
                "experiment_plan_id": experiment_plan_id,
                "model_family": model_family,
                "run_type": "single",
                "formal_run": True,
            }
        )

    def submit_run(self, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.run_service.submit_run(request)
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_run(run_id)

    def get_run_status(self, run_id: str) -> dict[str, Any]:
        return self.run_service.get_run_status(run_id)

    def subscribe_run_state_stream(self, run_id: str) -> dict[str, Any]:
        try:
            return self.run_service.subscribe_run_state_stream(run_id)
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc

    def get_run_result(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_result_summary_for_run(run_id)

    def get_run_artifacts(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_artifact_manifest_for_run(run_id)

    def get_current_analysis_result(self, project_id: str, analysis_type: str) -> dict[str, Any]:
        normalized_analysis_type = _normalize_analysis_type(analysis_type)
        runs = self.repository.list_runs(
            project_id=project_id,
            run_type="monte_carlo",
            limit=100,
        )
        latest_result: dict[str, Any] | None = None
        latest_failure: dict[str, Any] | None = None
        for run_entry in runs:
            run_id = run_entry["run_id"]
            run = self.repository.get_run(run_id)
            run_analysis_type = _analysis_type_for_run(run)
            if run_analysis_type and run_analysis_type != normalized_analysis_type:
                continue
            run_status = str(run.get("status") or "")
            if run_status in {"queued", "running", "pending"}:
                latest_result = _empty_current_analysis_result(
                    project_id,
                    normalized_analysis_type,
                    status="running",
                    message=f"Formal Monte Carlo run is {run_status}",
                    code=run_status,
                    run_id=run_id,
                )
                break
            if run_status == "failed":
                error = run.get("error") if isinstance(run.get("error"), dict) else {}
                latest_failure = _current_analysis_failure_from_error(
                    normalized_analysis_type,
                    run,
                    code=str(error.get("code") or "failed"),
                    message=str(error.get("message") or "Formal Monte Carlo run failed"),
                    details=error.get("details") if isinstance(error.get("details"), dict) else {},
                )
                latest_result = _empty_current_analysis_result(
                    project_id,
                    normalized_analysis_type,
                    status="failed",
                    message=latest_failure["message"],
                    code=latest_failure["code"],
                    details=latest_failure["details"],
                    run_id=run_id,
                )
                break
            try:
                result = self._current_analysis_result_for_run(project_id, normalized_analysis_type, run)
            except BackendApiError as exc:
                latest_failure = _current_analysis_failure_from_error(
                    normalized_analysis_type,
                    run,
                    code=exc.code,
                    message=str(exc),
                    details=exc.details,
                )
                latest_result = _empty_current_analysis_result(
                    project_id,
                    normalized_analysis_type,
                    status="blocked",
                    message=latest_failure["message"],
                    code=latest_failure["code"],
                    details=latest_failure["details"],
                    run_id=run_id,
                )
                break
            if result["status"] == "completed":
                return result
            latest_result = result
            break

        if latest_result is None:
            return _empty_current_analysis_result(
                project_id,
                normalized_analysis_type,
                status="empty",
                message="No formal Monte Carlo run exists for this analysis type",
            )
        if latest_result["status"] == "completed":
            return latest_result

        previous_success = self._previous_successful_current_analysis_result(
            project_id,
            normalized_analysis_type,
            runs,
            skip_run_id=str((latest_result.get("internal_run_ref") or {}).get("run_id") or ""),
        )
        if previous_success is not None:
            return {
                **previous_success,
                "status": latest_result["status"],
                "last_failure": latest_failure or latest_result.get("last_failure"),
                "is_stale": True,
                "updated_at": latest_result.get("updated_at") or previous_success.get("updated_at"),
                "internal_run_ref": {
                    **(previous_success.get("internal_run_ref") or {}),
                    "latest_run_id": (latest_failure or latest_result.get("last_failure") or {}).get("run_id"),
                },
            }
        return latest_result or _empty_current_analysis_result(
            project_id,
            normalized_analysis_type,
            status="blocked",
            message="No valid formal projection is available",
        )

    def _previous_successful_current_analysis_result(
        self,
        project_id: str,
        analysis_type: str,
        runs: list[dict[str, Any]],
        *,
        skip_run_id: str,
    ) -> dict[str, Any] | None:
        for run_entry in runs:
            run_id = str(run_entry.get("run_id") or "")
            if run_id == skip_run_id:
                continue
            run = self.repository.get_run(run_id)
            run_analysis_type = _analysis_type_for_run(run)
            if run_analysis_type and run_analysis_type != analysis_type:
                continue
            if run.get("status") != "succeeded":
                continue
            try:
                return self._current_analysis_result_for_run(project_id, analysis_type, run)
            except BackendApiError:
                continue
        return None

    def _current_analysis_result_for_run(
        self,
        project_id: str,
        analysis_type: str,
        run: dict[str, Any],
    ) -> dict[str, Any]:
        run_id = str(run.get("run_id") or "")
        if run.get("project_id") != project_id:
            raise BackendApiError("project_mismatch", "run does not belong to project", run_id=run_id, project_id=project_id)
        if run.get("run_type") != "monte_carlo":
            raise BackendApiError("not_monte_carlo", "run_type must be monte_carlo", run_id=run_id)
        run_analysis_type = _analysis_type_for_run(run)
        if run_analysis_type and run_analysis_type != analysis_type:
            raise BackendApiError(
                "analysis_type_mismatch",
                f"run analysis_type mismatch: expected {analysis_type}, got {run_analysis_type}",
                run_id=run_id,
                analysis_type=analysis_type,
                run_analysis_type=run_analysis_type,
            )
        if run.get("model_family") != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "model_family_mismatch",
                f"model_family must be {ACTIVE_FORMAL_MODEL_FAMILY}",
                run_id=run_id,
                model_family=run.get("model_family"),
            )
        provenance = _compiler_provenance_for_run(run)
        if not provenance:
            raise BackendApiError("missing_compiler_provenance", "compiler provenance is required", run_id=run_id)
        manifest = self.repository.get_artifact_manifest_for_run(run_id)
        artifacts = manifest.get("artifacts") or []
        base_artifact = _find_artifact_by_kind(artifacts, "monte_carlo_base")
        if base_artifact is None:
            raise BackendApiError("missing_monte_carlo_base", "monte_carlo_base artifact is required", run_id=run_id)
        artifact_kind = ANALYSIS_PROJECTION_ARTIFACT_KINDS[analysis_type]
        projection_artifact = _find_artifact_by_kind(artifacts, artifact_kind)
        if projection_artifact is None:
            raise BackendApiError(
                "missing_analysis_projection",
                f"{artifact_kind} artifact is required",
                run_id=run_id,
                analysis_type=analysis_type,
            )
        payload = self._read_json_artifact_payload(run_id, projection_artifact)
        projection_type = payload.get("projection_type")
        if projection_type != analysis_type:
            raise BackendApiError(
                "projection_type_mismatch",
                f"projection_type mismatch: expected {analysis_type}, got {projection_type}",
                run_id=run_id,
                analysis_type=analysis_type,
                projection_type=projection_type,
            )
        payload_run_id = payload.get("run_id")
        if not payload_run_id:
            raise BackendApiError(
                "projection_run_missing",
                "projection run_id is required",
                run_id=run_id,
            )
        if payload_run_id != run_id:
            raise BackendApiError(
                "projection_run_mismatch",
                "projection payload run_id does not match current run",
                run_id=run_id,
                payload_run_id=payload_run_id,
            )
        payload_model_family = payload.get("model_family")
        if not payload_model_family:
            raise BackendApiError(
                "projection_model_family_missing",
                "projection model_family is required",
                run_id=run_id,
            )
        if payload_model_family != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "projection_model_family_mismatch",
                "projection payload model_family does not match aircraft_support_v1",
                run_id=run_id,
                model_family=payload_model_family,
            )
        return {
            "project_id": project_id,
            "analysis_type": analysis_type,
            "profile_version": "default-v0",
            "base_plan_version": str(run.get("modeling_snapshot_id") or run.get("experiment_plan_id") or ""),
            "status": "completed",
            "last_success_result": {
                "run_id": run_id,
                "projection_type": projection_type,
                "payload": payload,
            },
            "last_failure": None,
            "is_stale": False,
            "source": "formal_backend",
            "internal_run_ref": {
                "run_id": run_id,
                "run_type": run.get("run_type"),
                "model_family": run.get("model_family"),
                "experiment_plan_id": run.get("experiment_plan_id"),
                "modeling_snapshot_id": run.get("modeling_snapshot_id"),
            },
            "internal_artifact_ref": {
                "artifact_id": projection_artifact.get("artifact_id"),
                "kind": projection_artifact.get("kind"),
                "source_artifact_id": projection_artifact.get("source_artifact_id") or base_artifact.get("artifact_id"),
            },
            "updated_at": run.get("completed_at") or run.get("updated_at") or run.get("started_at"),
        }

    def _read_json_artifact_payload(self, run_id: str, artifact: dict[str, Any]) -> dict[str, Any]:
        relative_path = Path(str(artifact.get("path") or ""))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise BackendApiError(
                "artifact_path_escape",
                "artifact path escapes output directory",
                run_id=run_id,
                artifact_id=artifact.get("artifact_id"),
            )
        output_root = self.output_dir.resolve()
        target = (output_root / relative_path).resolve()
        if output_root not in target.parents and target != output_root:
            raise BackendApiError(
                "artifact_path_escape",
                "artifact path escapes output directory",
                run_id=run_id,
                artifact_id=artifact.get("artifact_id"),
            )
        if not target.is_file():
            raise BackendApiError(
                "artifact_missing",
                "artifact file is missing",
                run_id=run_id,
                artifact_id=artifact.get("artifact_id"),
            )
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise BackendApiError(
                "projection_payload_invalid",
                "projection payload JSON is invalid",
                run_id=run_id,
                artifact_id=artifact.get("artifact_id"),
            ) from exc
        if not isinstance(payload, dict):
            raise BackendApiError(
                "projection_payload_invalid",
                "projection payload must be an object",
                run_id=run_id,
                artifact_id=artifact.get("artifact_id"),
            )
        return payload

    def get_run_chain(self, run_id: str) -> dict[str, Any]:
        return self.repository.get_run_chain(run_id)

    def list_runs(self, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        filters = filters or {}
        return {
            "runs": self.repository.list_runs(
                include_deleted=_truthy_query_flag(filters.get("include_deleted")),
                project_id=filters.get("project_id"),
                experiment_plan_id=filters.get("experiment_plan_id"),
                run_type=filters.get("run_type"),
                status=filters.get("status"),
                limit=_clamped_run_limit(filters.get("limit")),
            )
        }

    def get_run_detail(self, run_id: str) -> dict[str, Any]:
        detail = self.repository.get_run_detail(run_id)
        detail["download_base"] = f"/api/runs/{run_id}/artifacts"
        return detail

    def archive_run(self, run_id: str, actor_user_id: str | None = None) -> dict[str, Any]:
        actor_user_id = _require_m7_actor(actor_user_id)
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="runs.archive",
            resource_type="run",
            resource_id=run_id,
        )
        return self.run_service.archive_run(run_id, actor_user_id=actor_user_id)

    def soft_delete_run(self, run_id: str, actor_user_id: str | None = None) -> dict[str, Any]:
        actor_user_id = _require_m7_actor(actor_user_id)
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="runs.delete",
            resource_type="run",
            resource_id=run_id,
        )
        return self.run_service.soft_delete_run(run_id, actor_user_id=actor_user_id)

    def control_run(self, run_id: str, action: str, *, actor_user_id: str | None = None) -> dict[str, Any]:
        actor_user_id = _require_m7_actor(actor_user_id)
        action_name = str(action or "").strip().lower()
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action=f"runs.control.{action_name or 'unknown'}",
            resource_type="run",
            resource_id=run_id,
        )
        try:
            return self.run_service.control_run(run_id, action_name, actor_user_id=actor_user_id)
        except ValueError as exc:
            reason = str(exc)
            if reason == "run_deleted":
                raise BackendApiError("run_deleted", "run is soft-deleted", run_id=run_id) from exc
            if reason == "unsupported_run_control":
                raise BackendApiError(
                    "unsupported_run_control",
                    f"run control action is not supported: {action_name or 'unknown'}",
                    run_id=run_id,
                    action=action_name,
                ) from exc
            raise

    def get_run_artifact_download(
        self,
        run_id: str,
        artifact_id: str,
        *,
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        actor_user_id = _require_m7_actor(actor_user_id)
        run = self.repository.get_run(run_id)
        if run.get("lifecycle_status") == "deleted":
            raise BackendApiError("run_deleted", "run is soft-deleted", run_id=run_id)
        artifact = self.repository.find_artifact_for_run(run_id, artifact_id)
        relative_path = Path(str(artifact["path"]))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise BackendApiError(
                "artifact_path_escape",
                "artifact path escapes output directory",
                artifact_id=artifact_id,
            )
        output_root = Path(self.output_dir).resolve()
        target = (output_root / relative_path).resolve()
        if output_root not in target.parents and target != output_root:
            raise BackendApiError(
                "artifact_path_escape",
                "artifact path escapes output directory",
                artifact_id=artifact_id,
            )
        if not target.is_file():
            raise BackendApiError("artifact_missing", "artifact file is missing", artifact_id=artifact_id)
        body = target.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        if digest != artifact.get("sha256"):
            raise BackendApiError(
                "artifact_hash_mismatch",
                "artifact file hash does not match manifest",
                artifact_id=artifact_id,
            )
        self.repository.insert_audit_event(
            actor_user_id=actor_user_id,
            action="runs.artifact.download",
            resource_type="run",
            resource_id=run_id,
            outcome="allowed",
            details={"artifact_id": artifact_id, "sha256": digest, "size_bytes": artifact.get("size_bytes")},
        )
        return {
            "path": target,
            "artifact": artifact,
            "body": body,
            "content_type": artifact.get("media_type") or "application/octet-stream",
            "filename": artifact.get("filename") or artifact.get("display_name") or target.name,
        }

    def _to_backend_error(self, exc: AdapterError, model_family: str) -> BackendApiError:
        return BackendApiError(exc.code, str(exc), **exc.details)

    def _run_service_error_to_backend_error(self, exc: RunServiceError) -> BackendApiError:
        return BackendApiError(exc.code, str(exc), **exc.details)

    def _require_role(
        self,
        actor_user_id: str | None,
        allowed_roles: set[str],
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        allow_system: bool = False,
    ) -> None:
        if actor_user_id is None:
            if allow_system:
                return
            self.repository.insert_audit_event(
                actor_user_id=None,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                outcome="denied",
                details={"reason": "missing_actor"},
            )
            raise BackendApiError("unauthorized", "M4 actor is required")
        try:
            user = self.repository.get_user(actor_user_id)
        except KeyError as exc:
            self.repository.insert_audit_event(
                actor_user_id=actor_user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                outcome="denied",
                details={"reason": "unknown_user"},
            )
            raise BackendApiError("forbidden", "User is not allowed to perform this action") from exc
        if user.get("status") != "active" or user.get("role") not in allowed_roles:
            self.repository.insert_audit_event(
                actor_user_id=actor_user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                outcome="denied",
                details={"role": user.get("role")},
            )
            raise BackendApiError("forbidden", "User is not allowed to perform this action")

    def _audit_allowed(
        self,
        actor_user_id: str | None,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any],
        allow_system: bool = False,
    ) -> None:
        if actor_user_id is None and not allow_system:
            return
        self.repository.insert_audit_event(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome="allowed",
            details=details,
        )


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:12]


def _truthy_query_flag(value: Any) -> bool:
    return value is True or value in {"1", "true", "True"}


def _clamped_run_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 50
    return max(1, min(parsed, 200))


def _require_m7_actor(actor_user_id: str | None) -> str:
    if actor_user_id is None or str(actor_user_id).strip() == "":
        raise BackendApiError("missing_actor", "M7 run management action requires an actor")
    return str(actor_user_id)


def _normalize_analysis_type(analysis_type: str) -> str:
    normalized = str(analysis_type or "").strip()
    if normalized not in ANALYSIS_PROJECTION_ARTIFACT_KINDS:
        raise BackendApiError(
            "unsupported_analysis_type",
            f"Unsupported analysis_type: {normalized or 'empty'}",
            analysis_type=normalized,
            supported_analysis_types=sorted(ANALYSIS_PROJECTION_ARTIFACT_KINDS),
        )
    return normalized


def _analysis_type_for_run(run: dict[str, Any]) -> str:
    direct = str(run.get("analysis_type") or "").strip()
    if direct:
        return direct
    base = run.get("simulation_experiment_base")
    if isinstance(base, dict):
        return str(base.get("analysis_type") or "").strip()
    return ""


def _current_analysis_failure_from_error(
    analysis_type: str,
    run: dict[str, Any],
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run_id = str(run.get("run_id") or "")
    return {
        "code": code,
        "message": message,
        "details": details or {},
        "run_id": run_id,
        "analysis_type": analysis_type,
        "status": run.get("status"),
        "updated_at": run.get("completed_at") or run.get("updated_at") or run.get("started_at"),
    }


def _empty_current_analysis_result(
    project_id: str,
    analysis_type: str,
    *,
    status: str,
    message: str,
    code: str | None = None,
    details: dict[str, Any] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    failure = None
    if status != "empty":
        failure = {
            "code": code or status,
            "message": message,
            "details": details or {},
            "run_id": run_id,
            "analysis_type": analysis_type,
        }
    return {
        "project_id": project_id,
        "analysis_type": analysis_type,
        "profile_version": "default-v0",
        "base_plan_version": "",
        "status": status,
        "last_success_result": None,
        "last_failure": failure,
        "is_stale": False,
        "source": "empty" if status == "empty" else "blocked",
        "internal_run_ref": {"run_id": run_id} if run_id else None,
        "internal_artifact_ref": None,
        "updated_at": None,
    }


def _compiler_provenance_for_run(run: dict[str, Any]) -> dict[str, Any] | None:
    candidates = [
        run.get("compiler_provenance"),
        run.get("compiled_from", {}).get("mapping_provenance") if isinstance(run.get("compiled_from"), dict) else None,
        run.get("simulation_experiment_base", {}).get("mapping_provenance")
        if isinstance(run.get("simulation_experiment_base"), dict)
        else None,
    ]
    return next((candidate for candidate in candidates if isinstance(candidate, dict) and candidate), None)


def _find_artifact_by_kind(artifacts: list[Any], kind: str) -> dict[str, Any] | None:
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        if artifact.get("kind") == kind or artifact.get("artifact_type") == kind:
            return artifact
    return None


def _steps_from_plan(plan: dict[str, Any]) -> int:
    steps = plan.get("config", {}).get("steps", 3)
    if isinstance(steps, bool):
        return 3
    try:
        return max(0, int(steps))
    except (TypeError, ValueError):
        return 3


def _normalize_experiment_plan_config(config: dict[str, Any]) -> dict[str, Any]:
    plan_config = copy.deepcopy(config)
    branch_project = plan_config.get("projectJson") or plan_config.get("project_json")
    if not isinstance(branch_project, dict):
        return plan_config

    experiment = branch_project.get("experiment") if isinstance(branch_project.get("experiment"), dict) else {}
    if "name" not in plan_config and experiment.get("name"):
        plan_config["name"] = experiment["name"]
    for key in ("steps", "samples", "seed"):
        if key not in plan_config and key in experiment:
            plan_config[key] = copy.deepcopy(experiment[key])
    if "monteCarlo" not in plan_config and isinstance(branch_project.get("monteCarlo"), dict):
        plan_config["monteCarlo"] = copy.deepcopy(branch_project["monteCarlo"])
    if "analysisRequests" not in plan_config and isinstance(branch_project.get("analysisRequests"), dict):
        plan_config["analysisRequests"] = copy.deepcopy(branch_project["analysisRequests"])

    clean_project = strip_project_sweep(branch_project)
    if "projectJson" in plan_config:
        plan_config["projectJson"] = clean_project
    else:
        plan_config["project_json"] = clean_project
    return plan_config


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "role": user["role"],
        "display_name": user.get("display_name") or user["username"],
        "status": user.get("status") or "active",
    }


def _password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _session_audit_id(token: str) -> str:
    return f"session-{hashlib.sha256(token.encode('utf-8')).hexdigest()[:16]}"


def _project_list_entry(project: dict[str, Any]) -> dict[str, Any]:
    payload = project.get("payload_json")
    if not isinstance(payload, dict):
        payload = project if isinstance(project, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    project_name = payload.get("experiment", {}).get("name")
    if not isinstance(project_name, str) or not project_name.strip():
        project_name = payload.get("projectInfo", {}).get("name")
    if not isinstance(project_name, str) or not project_name.strip():
        project_name = str(project.get("project_id") or payload.get("project_id") or "未命名项目")

    base_code = payload.get("projectInfo", {}).get("baseCode")
    if not isinstance(base_code, str) or not base_code.strip():
        base_code = (payload.get("airports") or [{}])[0].get("airportCode") if isinstance(payload.get("airports"), list) and payload.get("airports") else ""
    if not isinstance(base_code, str) or not base_code.strip():
        base_code = str(payload.get("scenarioId") or payload.get("project_id") or project.get("project_id") or "NB")

    summary = payload.get("projectInfo", {}).get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = "后端持久化项目"
    project_info = payload.get("projectInfo") if isinstance(payload.get("projectInfo"), dict) else {}
    is_template = bool(project_info.get("isTemplate") or project_info.get("is_template"))

    return {
        "project_id": project.get("project_id"),
        "experiment_name": str(project_name).strip(),
        "base_code": str(base_code).strip(),
        "summary": str(summary).strip(),
        "is_template": is_template,
        "updated_at": project.get("updated_at"),
        "scenario_id": payload.get("scenarioId"),
        "source_import_id": payload.get("missionProfile", {}).get("sourceImportId"),
    }
