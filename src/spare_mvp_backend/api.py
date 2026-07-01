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
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_backend.run_service import ACTIVE_FORMAL_MODEL_FAMILY, RETIRED_FORMAL_MODEL_FAMILIES, RunService, RunServiceError
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


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
        self._run_lock = run_lifecycle_lock or threading.Lock()
        self.run_service = RunService(repository, adapter, self.output_dir, run_lifecycle_lock=self._run_lock)

    def validate_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        return self.adapter.validate_project(project_json)

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
        return self.repository.get_project(project_id)

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
            "validationLevel": validation["validationLevel"],
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

        project_json = modeling_import_to_project(import_package, validation=validation)
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
        plan_config = copy.deepcopy(config)
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


def _steps_from_plan(plan: dict[str, Any]) -> int:
    steps = plan.get("config", {}).get("steps", 3)
    if isinstance(steps, bool):
        return 3
    try:
        return max(0, int(steps))
    except (TypeError, ValueError):
        return 3


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

    return {
        "project_id": project.get("project_id"),
        "experiment_name": str(project_name).strip(),
        "base_code": str(base_code).strip(),
        "summary": str(summary).strip(),
        "updated_at": project.get("updated_at"),
        "scenario_id": payload.get("scenarioId"),
        "source_import_id": payload.get("missionProfile", {}).get("sourceImportId"),
    }
