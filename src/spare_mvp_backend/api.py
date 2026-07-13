"""Function-level backend API facade for contract-first simulation flows."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import math
from pathlib import Path
import threading
from typing import Any

from src.spare_mvp_backend.errors import BackendApiError
from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_backend.project_payload import (
    materialize_scenario_composition,
    project_basic_mission_support_activity_name_errors,
    project_k_out_of_n_errors,
    project_runtime_config_paths,
    strip_project_sweep,
)
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
        k_out_of_n_errors = project_k_out_of_n_errors(project_json)
        if k_out_of_n_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *k_out_of_n_errors]
        support_activity_name_errors = project_basic_mission_support_activity_name_errors(project_json)
        if support_activity_name_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *support_activity_name_errors]
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
            {"系统管理员"},
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

    def export_rms_allocation_xlsx(self, payload: dict[str, Any]) -> dict[str, Any]:
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "RMS分配结果"
        sheet.append(["项目", str(payload.get("project_name") or "")])
        sheet.append(["计算方法", str(payload.get("method") or "")])
        sheet.append(["生成时间", str(payload.get("generated_at") or "")])
        sheet.append([])
        sheet.append(["层级", "节点", "型号", "安装数", "运行比", "分配份额", "状态"])
        for row in payload.get("rows") or []:
            sheet.append([
                str(row.get("level") or ""), str(row.get("nodeName") or ""),
                str(row.get("model") or ""), int(row.get("installationCount") or 0),
                float(row.get("runningRatio") or 0), float(row.get("allocationShare") or 0),
                str(row.get("status") or ""),
            ])
        output = io.BytesIO()
        workbook.save(output)
        return {
            "body": output.getvalue(),
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "filename": "rms-allocation-result.xlsx",
        }

    def replace_project(
        self,
        project_id: str,
        project_json: dict[str, Any],
        *,
        expected_updated_at: str,
        actor_user_id: str,
    ) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="project.replace",
            resource_type="project",
            resource_id=project_id,
        )
        current_updated_at = self.repository.project_updated_at(project_id)
        if not expected_updated_at or expected_updated_at != current_updated_at:
            raise BackendApiError(
                "project_version_conflict",
                "Project has changed since it was loaded",
                expected_updated_at=expected_updated_at,
                current_updated_at=current_updated_at,
            )
        replacement = copy.deepcopy(project_json)
        replacement["project_id"] = project_id
        validation = self.validate_project(replacement)
        if not validation["ok"]:
            raise BackendApiError("invalid_project", "Project JSON failed validation", errors=validation["errors"])
        replacement = strip_project_sweep(replacement)
        replacement["schema_version"] = validation["project_schema_version"]
        replacement["project_version"] = validation["project_version"]
        replace_result = self.repository.replace_project_if_current(
            replacement,
            expected_updated_at=expected_updated_at,
            actor_user_id=actor_user_id,
        )
        if replace_result is None:
            raise BackendApiError(
                "project_version_conflict",
                "Project has changed since it was validated",
                expected_updated_at=expected_updated_at,
                current_updated_at=self.repository.project_updated_at(project_id),
            )
        updated_at = replace_result["updated_at"]
        audit = replace_result["audit"]
        return {
            "project_id": project_id,
            "project_version": replacement["project_version"],
            "schema_version": replacement["schema_version"],
            "updated_at": updated_at,
            "validation": validation,
            "audit_event_id": audit.get("audit_event_id") or audit.get("event_id"),
            "status": "replaced",
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
        return self._upsert_experiment_plan(project_id, config)

    def update_experiment_plan(
        self,
        project_id: str,
        experiment_plan_id: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            existing = self.repository.get_experiment_plan(experiment_plan_id)
        except KeyError as exc:
            raise BackendApiError(
                "experiment_plan_not_found",
                "ExperimentPlan not found",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            ) from exc
        if existing.get("project_id") != project_id:
            raise BackendApiError(
                "experiment_plan_project_mismatch",
                "ExperimentPlan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )
        return self._upsert_experiment_plan(
            project_id,
            config,
            experiment_plan_id=experiment_plan_id,
            status=existing.get("status", "draft"),
        )

    def _upsert_experiment_plan(
        self,
        project_id: str,
        config: dict[str, Any],
        *,
        experiment_plan_id: str | None = None,
        status: str = "draft",
    ) -> dict[str, Any]:
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
            "experiment_plan_id": experiment_plan_id or f"experiment-plan-{project_id}-{_stable_hash(plan_key)}",
            "project_id": project_id,
            "modeling_snapshot_id": snapshot["snapshot_id"],
            "schema_version": "experiment-plan-v0",
            "project_version": project["project_version"],
            "status": status,
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

    def run_lite_mesa_analysis(
        self,
        project_json: dict[str, Any],
        *,
        analysis_type: str,
        settings: dict[str, Any] | None = None,
        model_family: str = ACTIVE_FORMAL_MODEL_FAMILY,
    ) -> dict[str, Any]:
        """Run a current-project Mesa analysis in memory without formal run persistence."""
        normalized_analysis_type = _normalize_analysis_type(analysis_type)
        normalized_settings = _normalize_lite_mesa_analysis_settings(settings or {})
        if model_family != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "unsupported_lite_mesa_analysis_model_family",
                f"lite Mesa analysis supports only {ACTIVE_FORMAL_MODEL_FAMILY}",
                model_family=model_family,
                replacement_model_family=ACTIVE_FORMAL_MODEL_FAMILY,
            )
        if not isinstance(project_json, dict) or not project_json:
            raise BackendApiError(
                "bad_lite_mesa_analysis_request",
                "current Project JSON is required for lite Mesa analysis",
            )
        project = strip_project_sweep(materialize_scenario_composition(project_json))
        compile_gate = getattr(self.adapter, "compile_scenario_with_gate", None)
        if not callable(compile_gate):
            raise BackendApiError(
                "lite_mesa_analysis_compile_unavailable",
                "SimulationAdapter does not expose compile_scenario_with_gate",
            )
        compile_result = compile_gate(project, model_family=model_family)
        if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
            return _blocked_lite_mesa_analysis_payload(
                project=project,
                analysis_type=normalized_analysis_type,
                model_family=model_family,
                settings=normalized_settings,
                message="无法编译当前 Project 到 aircraft_support_v1；请补齐任务、装备、备件、保障节点和维修作业建模字段。",
                issues=compile_result.get("issues", []),
                errors=compile_result.get("errors", []),
                provenance=compile_result.get("provenance", {}),
            )

        scenario = copy.deepcopy(compile_result["scenario"])
        scenario.get("compiled_from", {}).setdefault("mapping_provenance", compile_result.get("provenance", {}))
        run_id = _lite_mesa_analysis_run_id(project, scenario, normalized_analysis_type, normalized_settings)
        inputs = copy.deepcopy(scenario["simulation_inputs"])
        base_seed = normalized_settings["seed"] if normalized_settings["seed"] is not None else int(inputs.get("seed", 0))
        samples: list[dict[str, Any]] = []
        failed_samples: list[dict[str, Any]] = []
        for sample_index in range(normalized_settings["samples"]):
            seed = base_seed + sample_index
            try:
                samples.append(
                    _run_aircraft_support_v1_analysis_sample(
                        inputs,
                        seed=seed,
                        sample_index=sample_index,
                        write_event_snapshots=normalized_settings["write_event_snapshots"],
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive fail-closed path.
                failed_samples.append(
                    {
                        "sample_index": sample_index,
                        "seed": seed,
                        "error": {"code": "sample_failed", "message": str(exc), "details": {}},
                    }
                )

        if not samples:
            return _blocked_lite_mesa_analysis_payload(
                project=project,
                analysis_type=normalized_analysis_type,
                model_family=model_family,
                settings=normalized_settings,
                message="Mesa 分析样本全部失败；当前建模粒度不足以生成会话内结果。",
                issues=[],
                errors=failed_samples,
                provenance=compile_result.get("provenance", {}),
                run_id=run_id,
            )

        aggregate = self.adapter._aggregate_sample_metrics(samples)  # noqa: SLF001 - in-memory aggregation, no writes.
        self.adapter._coerce_result_integer_metrics(aggregate)  # noqa: SLF001 - reuse canonical metric coercion.
        aggregate["mission_success_probability"] = aggregate.get(
            "mission_success_rate",
            aggregate.get("sortie_completion_rate", 0),
        )
        base_artifact_id = f"lite-mesa-analysis-base-{run_id}"
        projections = self.adapter._aircraft_support_v1_analysis_projections(  # noqa: SLF001 - projection payload only.
            aggregate,
            base_artifact_id,
            samples=samples,
            run_id=run_id,
            validation_scope=scenario.get("compiled_from", {}).get("mapping_provenance", {}),
            simulation_inputs=inputs,
        )
        page_result = _lite_mesa_analysis_page_result(
            normalized_analysis_type,
            projections[normalized_analysis_type],
            aggregate,
            samples,
            normalized_settings,
        )
        visualization_state_series = self.adapter._visualization_state_series_payload(  # noqa: SLF001 - session-only replay payload, no run persistence.
            run_id=run_id,
            scenario=scenario,
            model_family=model_family,
            result_summary_id=f"lite-mesa-analysis-summary-{run_id}",
            artifact_manifest_id=f"lite-mesa-analysis-manifest-{run_id}",
            frames=copy.deepcopy(samples[0].get("frames") or []),
        )
        return {
            "status": "session_complete",
            "source": "lite_mesa_aircraft_support_v1",
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": model_family,
            "model_id": "AircraftSupportV1Model",
            "analysis_type": normalized_analysis_type,
            "experiment_id": page_result["experiment_id"],
            "sample_count": len(samples),
            "seed_list": [sample["seed"] for sample in samples],
            "aggregate_metrics": aggregate,
            "projection": projections[normalized_analysis_type],
            "metrics": page_result["metrics"],
            "rows": page_result["rows"],
            "wave_rows": page_result.get("wave_rows", []),
            "daily_rows": page_result.get("daily_rows", []),
            "event_snapshots": page_result.get("event_snapshots", []),
            "profile_reliability": page_result.get("profile_reliability"),
            "period_completion_probability": page_result.get("period_completion_probability"),
            "successful_samples": page_result.get("successful_samples"),
            "valid_samples": page_result.get("valid_samples"),
            "visualization_state_series": visualization_state_series,
            "limitations": _lite_mesa_analysis_limitations(),
            "failed_samples": failed_samples,
            "compile_provenance": compile_result.get("provenance", {}),
        }

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

    clean_project = strip_project_sweep(materialize_scenario_composition(branch_project))
    if "projectJson" in plan_config:
        plan_config["projectJson"] = clean_project
    else:
        plan_config["project_json"] = clean_project
    return plan_config


def _normalize_lite_mesa_analysis_settings(settings: dict[str, Any]) -> dict[str, Any]:
    samples = _bounded_int(settings.get("samples"), default=4, minimum=1, maximum=1000)
    seed = _optional_int(settings.get("seed"))
    confidence_target = _bounded_float(
        settings.get("missionConfidenceTarget"),
        default=0.9,
        minimum=0.0,
        maximum=1.0,
    )
    max_time_window = _bounded_int(settings.get("maxTimeWindow"), default=0, minimum=0, maximum=10000)
    top_n = _bounded_int(settings.get("topN"), default=4, minimum=1, maximum=20)
    return {
        "samples": samples,
        "seed": seed,
        "missionConfidenceTarget": confidence_target,
        "maxTimeWindow": max_time_window,
        "topN": top_n,
        "write_event_snapshots": bool(settings.get("write_event_snapshots")),
    }


def _run_aircraft_support_v1_analysis_sample(
    inputs: dict[str, Any],
    *,
    seed: int,
    sample_index: int,
    write_event_snapshots: bool = False,
) -> dict[str, Any]:
    from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model

    sample_inputs = copy.deepcopy(inputs)
    sample_inputs["seed"] = seed
    sample_inputs["disable_visualization_frames"] = True
    if write_event_snapshots:
        sample_inputs["write_event_snapshots"] = True
    model = AircraftSupportV1Model(sample_inputs)
    execution = model.run()
    daily_mission_reliability = _sample_daily_mission_reliability(model.missions, aircraft_count=len(model.aircraft))
    mission_wave_reliability = _sample_mission_wave_reliability(model.missions)
    frames = []
    for sample_step, frame in enumerate(execution.get("frames", [])[:20]):
        item = copy.deepcopy(frame)
        item["sample_index"] = sample_index
        item["sample_step"] = sample_step
        item["seed"] = seed
        item["sweep"] = {}
        frames.append(item)
    return {
        "sample_index": sample_index,
        "seed": seed,
        "sweep": {},
        "metrics": copy.deepcopy(execution["metrics"]),
        "daily_mission_reliability": daily_mission_reliability,
        "mission_wave_reliability": mission_wave_reliability,
        "frames": frames,
        "events": copy.deepcopy(execution.get("events") or []),
    }


def _sample_daily_mission_reliability(missions: list[Any], *, aircraft_count: int = 1) -> list[dict[str, Any]]:
    by_day: dict[int, dict[str, float]] = {}
    aircraft_denominator = max(1.0, float(aircraft_count or 1))
    for mission in missions:
        day = max(1, _metric_int(getattr(mission, "day_index", 1), default=1))
        planned = max(1, _metric_int(getattr(mission, "required_aircraft", 1), default=1))
        assigned = len(getattr(mission, "assigned_tail_numbers", []) or [])
        evaluated = bool(getattr(mission, "success_evaluated", False))
        successful = int(bool(getattr(mission, "succeeded", False))) if evaluated else 0
        bucket = by_day.setdefault(
            day,
            {
                "plannedSorties": 0.0,
                "launchedSorties": 0.0,
                "successfulSorties": 0.0,
                "plannedWaves": 0.0,
                "successfulWaves": 0.0,
            },
        )
        bucket["plannedSorties"] += planned
        bucket["launchedSorties"] += max(0, min(planned, assigned))
        bucket["successfulSorties"] += successful
        bucket["plannedWaves"] += int(evaluated)
        bucket["successfulWaves"] += successful
    rows = []
    for day in sorted(by_day):
        bucket = by_day[day]
        planned_waves = max(1.0, float(bucket["plannedWaves"]))
        rows.append(
            {
                "day": day,
                "plannedSorties": bucket["plannedSorties"],
                "launchedSorties": bucket["launchedSorties"],
                "successfulSorties": bucket["successfulSorties"],
                "plannedWaves": bucket["plannedWaves"],
                "successfulWaves": bucket["successfulWaves"],
                "missionSuccessRate": bucket["successfulWaves"] / planned_waves,
                "sortieRate": bucket["launchedSorties"] / aircraft_denominator,
            }
        )
    return rows


def _mean_daily_mission_reliability(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[int, dict[str, float]] = {}
    for sample in samples:
        for row in sample.get("daily_mission_reliability") or []:
            day = max(1, _metric_int(row.get("day"), default=1))
            bucket = by_day.setdefault(
                day,
                {
                    "sampleCount": 0.0,
                    "plannedSorties": 0.0,
                    "launchedSorties": 0.0,
                    "successfulSorties": 0.0,
                    "plannedWaves": 0.0,
                    "successfulWaves": 0.0,
                    "missionSuccessRate": 0.0,
                    "sortieRate": 0.0,
                },
            )
            bucket["sampleCount"] += 1
            bucket["plannedSorties"] += _metric_float(row.get("plannedSorties"), default=0)
            bucket["launchedSorties"] += _metric_float(row.get("launchedSorties"), default=0)
            bucket["successfulSorties"] += _metric_float(row.get("successfulSorties"), default=0)
            bucket["plannedWaves"] += _metric_float(row.get("plannedWaves"), default=0)
            bucket["successfulWaves"] += _metric_float(row.get("successfulWaves"), default=0)
            bucket["missionSuccessRate"] += _metric_float(row.get("missionSuccessRate"), default=0)
            bucket["sortieRate"] += _metric_float(row.get("sortieRate"), default=0)
    rows = []
    for day in sorted(by_day):
        bucket = by_day[day]
        sample_count = max(1.0, bucket["sampleCount"])
        mission_success = (
            bucket["successfulWaves"] / bucket["plannedWaves"]
            if bucket["plannedWaves"] > 0
            else bucket["missionSuccessRate"] / sample_count
        )
        rows.append(
            {
                "day": day,
                "sampleCount": int(bucket["sampleCount"]),
                "plannedSorties": bucket["plannedSorties"] / sample_count,
                "launchedSorties": bucket["launchedSorties"] / sample_count,
                "successfulSorties": bucket["successfulSorties"] / sample_count,
                "plannedWaves": bucket["plannedWaves"] / sample_count,
                "successfulWaves": bucket["successfulWaves"] / sample_count,
                "meanMissionSuccessRate": _clamp01(mission_success),
                "meanSortieRate": bucket["sortieRate"] / sample_count,
            }
        )
    return rows


def _sample_mission_wave_reliability(missions: list[Any]) -> list[dict[str, Any]]:
    by_wave: dict[tuple[int, int], dict[str, float]] = {}
    for mission in missions:
        day = max(1, _metric_int(getattr(mission, "day_index", 1), default=1))
        wave = max(1, _metric_int(getattr(mission, "wave_index", 1), default=1))
        planned = max(1, _metric_int(getattr(mission, "required_aircraft", 1), default=1))
        assigned = len(getattr(mission, "assigned_tail_numbers", []) or [])
        evaluated = bool(getattr(mission, "success_evaluated", False))
        successful = int(bool(getattr(mission, "succeeded", False))) if evaluated else 0
        bucket = by_wave.setdefault(
            (day, wave),
            {
                "plannedSorties": 0.0,
                "launchedSorties": 0.0,
                "successfulSorties": 0.0,
                "plannedWaves": 0.0,
                "successfulWaves": 0.0,
            },
        )
        bucket["plannedSorties"] += planned
        bucket["launchedSorties"] += max(0, min(planned, assigned))
        bucket["successfulSorties"] += successful
        bucket["plannedWaves"] += int(evaluated)
        bucket["successfulWaves"] += successful
    rows = []
    for sequence, (day, wave) in enumerate(sorted(by_wave), start=1):
        bucket = by_wave[(day, wave)]
        planned_waves = max(1.0, float(bucket["plannedWaves"]))
        rows.append(
            {
                "sequence": sequence,
                "dayIndex": day,
                "waveIndex": wave,
                "waveKey": _mission_wave_key(day, wave),
                "waveLabel": _mission_wave_label(day, wave),
                "plannedSorties": bucket["plannedSorties"],
                "launchedSorties": bucket["launchedSorties"],
                "successfulSorties": bucket["successfulSorties"],
                "plannedWaves": bucket["plannedWaves"],
                "successfulWaves": bucket["successfulWaves"],
                "missionSuccessRate": _clamp01(bucket["successfulWaves"] / planned_waves),
                "sortieRate": _clamp01(bucket["launchedSorties"] / max(1.0, bucket["plannedSorties"])),
            }
        )
    return rows


def _mean_mission_wave_reliability(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_wave: dict[tuple[int, int], dict[str, float]] = {}
    for sample in samples:
        for row in sample.get("mission_wave_reliability") or []:
            day = max(1, _metric_int(row.get("dayIndex", row.get("day_index")), default=1))
            wave = max(1, _metric_int(row.get("waveIndex", row.get("wave_index")), default=1))
            bucket = by_wave.setdefault(
                (day, wave),
                {
                    "sampleCount": 0.0,
                    "plannedSorties": 0.0,
                    "launchedSorties": 0.0,
                    "successfulSorties": 0.0,
                    "plannedWaves": 0.0,
                    "successfulWaves": 0.0,
                    "missionSuccessRate": 0.0,
                    "sortieRate": 0.0,
                },
            )
            bucket["sampleCount"] += 1
            bucket["plannedSorties"] += _metric_float(row.get("plannedSorties", row.get("planned_sorties")), default=0)
            bucket["launchedSorties"] += _metric_float(row.get("launchedSorties", row.get("launched_sorties")), default=0)
            bucket["successfulSorties"] += _metric_float(
                row.get("successfulSorties", row.get("successful_sorties")),
                default=0,
            )
            bucket["plannedWaves"] += _metric_float(row.get("plannedWaves", row.get("planned_waves")), default=0)
            bucket["successfulWaves"] += _metric_float(row.get("successfulWaves", row.get("successful_waves")), default=0)
            bucket["missionSuccessRate"] += _clamp01(
                row.get("missionSuccessRate", row.get("mean_mission_success_rate"))
            )
            bucket["sortieRate"] += _clamp01(row.get("sortieRate", row.get("mean_sortie_rate")))
    rows = []
    for sequence, (day, wave) in enumerate(sorted(by_wave), start=1):
        bucket = by_wave[(day, wave)]
        sample_count = max(1.0, bucket["sampleCount"])
        if bucket["plannedWaves"] > 0:
            mission_success = _clamp01(bucket["successfulWaves"] / bucket["plannedWaves"])
            sortie_rate = _clamp01(bucket["launchedSorties"] / bucket["plannedSorties"])
        else:
            mission_success = _clamp01(bucket["missionSuccessRate"] / sample_count)
            sortie_rate = _clamp01(bucket["sortieRate"] / sample_count)
        rows.append(
            {
                "sequence": sequence,
                "dayIndex": day,
                "waveIndex": wave,
                "waveKey": _mission_wave_key(day, wave),
                "waveLabel": _mission_wave_label(day, wave),
                "sampleCount": int(bucket["sampleCount"]),
                "plannedSorties": bucket["plannedSorties"] / sample_count,
                "launchedSorties": bucket["launchedSorties"] / sample_count,
                "successfulSorties": bucket["successfulSorties"] / sample_count,
                "plannedWaves": bucket["plannedWaves"] / sample_count,
                "successfulWaves": bucket["successfulWaves"] / sample_count,
                "meanMissionSuccessRate": mission_success,
                "meanSortieRate": sortie_rate,
            }
        )
    return rows


def _mission_wave_key(day: int, wave: int) -> str:
    return f"d{day}-w{wave}"


def _mission_wave_label(day: int, wave: int) -> str:
    return f"第{day}天 第{wave}波"


def _lite_mesa_analysis_page_result(
    analysis_type: str,
    projection: dict[str, Any],
    aggregate: dict[str, Any],
    samples: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, Any]:
    if analysis_type == "spare_shortfall":
        return _lite_mesa_spare_shortfall_result(projection, aggregate, samples)
    if analysis_type == "carry_list":
        return _lite_mesa_carry_list_result(projection, aggregate, samples, settings)
    if analysis_type == "mission_reliability":
        return _lite_mesa_mission_reliability_result(projection, samples, settings)
    return _lite_mesa_downtime_factors_result(projection, aggregate, samples, settings)


def _lite_mesa_spare_shortfall_result(
    projection: dict[str, Any],
    aggregate: dict[str, Any],
    samples: list[dict[str, Any]],
) -> dict[str, Any]:
    planned = max(1, _metric_int(aggregate.get("planned_sorties"), default=len(samples)))
    mean_transport_delay = max(0.0, _metric_float(aggregate.get("mean_transport_delay"), default=0))
    rows = []
    for item in projection.get("data") or []:
        fill_rate = _metric_float(item.get("fill_rate"), default=aggregate.get("spare_fill_rate", 0))
        demand = max(0, int(round(_metric_float(item.get("demand_count"), default=planned))))
        filled = max(0, int(round(_metric_float(item.get("filled_count"), default=demand * fill_rate))))
        rows.append(
            {
                "aircraftModel": str(item.get("aircraft_model") or item.get("aircraftModel") or "全部机型"),
                "spareType": str(item.get("spare_type") or "aircraft_support_v1_spares"),
                "demand": demand,
                "filled": filled,
                "meanTransportDelayHours": _metric_float(item.get("mean_transport_delay"), default=mean_transport_delay),
                "fillRate": fill_rate,
                "riskLevel": _risk_label(item.get("risk_level")),
            }
        )
    if not rows:
        fill_rate = _metric_float(aggregate.get("spare_fill_rate"), default=0)
        rows.append(
            {
                "aircraftModel": "全部机型",
                "spareType": "aircraft_support_v1_spares",
                "demand": planned,
                "filled": max(0, int(round(planned * fill_rate))),
                "meanTransportDelayHours": mean_transport_delay,
                "fillRate": fill_rate,
                "riskLevel": _risk_label("low"),
            }
        )
    shortfall_rows = [
        row for row in rows
        if _metric_float(row.get("meanTransportDelayHours"), default=0) > 0
        or _metric_float(row.get("fillRate"), default=1) < 1
    ]
    max_shortage = max((max(0, int(row["demand"]) - int(row["filled"])) for row in rows), default=0)
    highest_shortfall = [str(row.get("spareType") or "") for row in rows if max_shortage > 0 and max(0, int(row["demand"]) - int(row["filled"])) == max_shortage]
    return {
        "experiment_id": "project_baseline_at_current_granularity",
        "metrics": [
            ["发生缺件备件", str(len(shortfall_rows))],
            ["平均备件延误时间(h)", f"{mean_transport_delay:.2f}"],
            ["最高缺件备件", "、".join(highest_shortfall) or "无"],
            ["因维修延误导致的任务取消次数", str(int(round(_sample_metric_sum(samples, "cancelled_sorties"))))],
        ],
        "rows": rows,
    }


def _lite_mesa_carry_list_result(
    projection: dict[str, Any],
    aggregate: dict[str, Any],
    samples: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, Any]:
    base_quantity = max(
        1,
        _metric_int(aggregate.get("spare_consumed_total"), default=0)
        + _metric_int(aggregate.get("shortage_events"), default=0),
    )
    planned = max(1, _metric_int(aggregate.get("planned_sorties"), default=len(samples)))
    rows = []
    for item in projection.get("data") or []:
        multiplier = max(1.0, _metric_float(item.get("recommended_multiplier"), default=1.0))
        baseline_quantity = max(0, _metric_int(item.get("baseline_quantity"), default=0))
        rows.append(
            {
                "aircraftModel": str(item.get("aircraft_model") or item.get("aircraftModel") or "全部机型"),
                "spareType": str(item.get("spare_type") or "aircraft_support_v1_spares"),
                "recommended": max(
                    0,
                    _metric_int(
                        item.get("recommended_quantity"),
                        default=int(math.ceil((baseline_quantity or base_quantity) * multiplier)),
                    ),
                ),
                "demand": max(0, _metric_int(item.get("demand_count"), default=planned)),
                "shortage": max(0, _metric_int(item.get("shortage_count"), default=aggregate.get("shortage_events"))),
                "riskLevel": _risk_label(item.get("risk_level")),
                "confidenceTarget": settings["missionConfidenceTarget"],
                "minimumSatisfactionRate": settings["missionConfidenceTarget"],
                "hideZeroDemand": True,
                "lifeLimited": bool(item.get("life_limited") or item.get("lifeLimited")),
                "lifeLandings": _metric_int(item.get("life_landings", item.get("lifeLandings")), default=0),
                "lifeCalendarDays": _metric_int(item.get("life_calendar_days", item.get("lifeCalendarDays")), default=0),
            }
        )
    if not rows:
        rows.append(
            {
                "aircraftModel": "全部机型",
                "spareType": "aircraft_support_v1_spares",
                "recommended": base_quantity,
                "demand": planned,
                "shortage": max(0, _metric_int(aggregate.get("shortage_events"), default=0)),
                "riskLevel": _risk_label("low"),
                "confidenceTarget": settings["missionConfidenceTarget"],
                "minimumSatisfactionRate": settings["missionConfidenceTarget"],
                "hideZeroDemand": True,
                "lifeLimited": False,
                "lifeLandings": 0,
                "lifeCalendarDays": 0,
            }
        )
    return {
        "experiment_id": "minimum_carry_list_search",
        "metrics": [
            ["建议携行总数", str(sum(int(row["recommended"]) for row in rows))],
            ["高优先级备件", str(sum(1 for row in rows if row["riskLevel"] == "高"))],
            ["置信度目标", f"{settings['missionConfidenceTarget']:.2f}"],
            ["样本数", str(len(samples))],
        ],
        "rows": rows,
    }


def _lite_mesa_mission_reliability_result(
    projection: dict[str, Any],
    samples: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, Any]:
    data = projection.get("data") if isinstance(projection.get("data"), dict) else {}
    rows = _mean_mission_wave_reliability(samples)
    max_rows = settings.get("maxTimeWindow")
    if max_rows:
        rows = rows[: max(1, _metric_int(max_rows, default=len(rows)))]
    valid_samples = 0
    successful_samples = 0
    for sample in samples:
        daily = [row for row in sample.get("daily_mission_reliability") or [] if 1 <= _metric_int(row.get("day"), default=0) <= 7]
        if _metric_float((sample.get("metrics") or {}).get("simulation_days"), default=0) < 7:
            continue
        valid_samples += 1
        if all(_metric_float(row.get("successfulWaves"), default=0) >= _metric_float(row.get("plannedWaves"), default=0) for row in daily):
            successful_samples += 1
    profile_reliability = _clamp01(data.get("mission_success_probability"))
    period_completion_probability = successful_samples / valid_samples if valid_samples else 0.0
    return {
        "experiment_id": "project_baseline_at_current_granularity",
        "metrics": [
            ["任务成功率", _pct(data.get("mission_success_probability"))],
            ["出动架次率", _decimal(data.get("sortie_rate"))],
            ["战备完好率", _pct(_sample_mean(samples, "ready_rate"))],
            ["任务失败次数", str(int(round(_sample_metric_sum(samples, "failed_sorties"))))],
            ["任务剖面可靠性", _pct(profile_reliability)],
            ["连续7天任务完成可靠性", _pct(period_completion_probability)],
        ],
        "rows": rows,
        "wave_rows": rows,
        "daily_rows": _mean_daily_mission_reliability(samples),
        "profile_reliability": profile_reliability,
        "period_completion_probability": period_completion_probability,
        "successful_samples": successful_samples,
        "valid_samples": valid_samples,
    }


def _lite_mesa_downtime_factors_result(
    projection: dict[str, Any],
    aggregate: dict[str, Any],
    samples: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, Any]:
    top_n = settings["topN"]
    factor_specs = [
        ("failure", "装备故障", "downtime_failure_events", "downtime_failure_hours"),
        ("equipment_shortage", "保障设备短缺", "downtime_equipment_shortage_events", "downtime_equipment_shortage_hours"),
        ("spare_shortage", "备件短缺", "downtime_spare_shortage_events", "downtime_spare_shortage_hours"),
        ("preventive", "预防性维修", "downtime_preventive_events", "downtime_preventive_hours"),
    ]
    total_hours = sum(max(0.0, _metric_float(aggregate.get(hours_key), default=0)) for _, _, _, hours_key in factor_specs)
    rows = []
    for reason, label, count_key, hours_key in factor_specs:
        downtime_hours = max(0.0, _metric_float(aggregate.get(hours_key), default=0))
        contribution = downtime_hours / total_hours if total_hours > 0 else 0.0
        rows.append({
            "label": label,
            "reason": reason,
            "count": max(0, _metric_int(aggregate.get(count_key), default=0)),
            "event_count": max(0, _metric_int(aggregate.get(count_key), default=0)),
            "downtime_hours": downtime_hours,
            "contribution": contribution,
            "duration_contribution": contribution,
        })
    rows = sorted(rows, key=lambda row: float(row.get("downtime_hours") or 0), reverse=True)
    top_row = rows[0] if rows else {}
    return {
        "experiment_id": "project_baseline_at_current_granularity",
        "metrics": [
            ["停机因素项", str(len(rows))],
            ["首要因素", str(top_row.get("label") or "无")],
            ["最高贡献度", _pct(top_row.get("contribution"))],
            ["样本数", str(len(samples))],
        ],
        "rows": rows,
        "event_snapshots": _lite_mesa_downtime_event_snapshots(samples, top_n),
    }


def _lite_mesa_downtime_event_snapshots(samples: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    limit = max(0, _metric_int(limit, default=0))
    if limit <= 0:
        return snapshots
    for sample in samples:
        sample_index = _metric_int(sample.get("sample_index"), default=0)
        seed = sample.get("seed")
        sweep = copy.deepcopy(sample.get("sweep") or {})
        snapshot_count_before_event_log = len(snapshots)
        for event in sample.get("events") or []:
            if not isinstance(event, dict):
                continue
            event_type = _lite_mesa_downtime_event_type(str(event.get("event_type") or event.get("event") or ""))
            event_snapshot = event.get("snapshot") if isinstance(event.get("snapshot"), dict) else None
            if not event_type or event_snapshot is None:
                continue
            snapshots.append(
                _lite_mesa_downtime_event_log_snapshot(
                    ordinal=len(snapshots) + 1,
                    sample_index=sample_index,
                    seed=seed,
                    sweep=sweep,
                    event_type=event_type,
                    event=event,
                    event_snapshot=event_snapshot,
                )
            )
            if len(snapshots) >= limit:
                return snapshots
        if len(snapshots) > snapshot_count_before_event_log:
            continue
        for frame in sample.get("frames") or []:
            if not isinstance(frame, dict):
                continue
            for event_type, event in _lite_mesa_downtime_snapshot_events(frame):
                snapshots.append(
                    _lite_mesa_downtime_frame_snapshot(
                        ordinal=len(snapshots) + 1,
                        sample_index=sample_index,
                        seed=seed,
                        sweep=sweep,
                        frame=frame,
                        event_type=event_type,
                        event=event,
                    )
                )
                if len(snapshots) >= limit:
                    return snapshots
    return snapshots


def _lite_mesa_downtime_event_log_snapshot(
    *,
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
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    job = active_jobs[0] if active_jobs else {}
    metrics = event_snapshot.get("metrics") if isinstance(event_snapshot.get("metrics"), dict) else {}
    simulation_time = _metric_float(event.get("time", event_snapshot.get("time", 0)), default=0)
    job_id = str(job.get("job_id") or details.get("job_id") or f"{event_type}-node")
    return {
        "snapshot_id": f"lite-downtime-{seed or 'run'}-{ordinal:04d}",
        "source": "model_event_log",
        "sample_index": sample_index,
        "seed": seed,
        "sweep": sweep,
        "simulation_time": simulation_time,
        "event_type": event_type,
        "event_label": _downtime_factor_label(event_type),
        "event": copy.deepcopy(event),
        "result": _lite_mesa_downtime_snapshot_result(event_type),
        "aircraft_state": aircraft_state,
        "support_resources": support_resources,
        "spare_shortages": spare_shortages,
        "support_activity_state": {
            "active_jobs": len(active_jobs),
            "repair_backlog": sum(1 for item in active_jobs if item.get("kind") == "repair"),
            "postflight_backlog": sum(1 for item in active_jobs if item.get("kind") == "postflight"),
            "preventive_backlog": sum(1 for item in active_jobs if item.get("kind") == "preventive"),
            "spare_fill_rate": _metric_float(metrics.get("spare_fill_rate"), default=0),
        },
        "job_node": {
            "job_id": job_id,
            "kind": str(job.get("kind") or details.get("kind") or event_type),
            "state": str(job.get("state") or details.get("state") or "observed"),
            "task": str(job.get("task") or details.get("task") or _lite_mesa_downtime_snapshot_result(event_type)),
            "tail_number": str(job.get("tail_number") or details.get("tail_number") or ""),
        },
        "frame_ref": {
            "sample_index": sample_index,
            "sample_step": int(simulation_time),
            "step": int(simulation_time),
        },
    }


def _lite_mesa_downtime_snapshot_events(frame: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for event in frame.get("events") or []:
        if not isinstance(event, dict):
            continue
        event_type = _lite_mesa_downtime_event_type(str(event.get("event_type") or event.get("event") or ""))
        if event_type:
            events.append((event_type, copy.deepcopy(event)))
    if events:
        return events
    summary = frame.get("event_summary") if isinstance(frame.get("event_summary"), dict) else {}
    fallback_map = [
        ("failure", "downtime_failure_events"),
        ("spare_shortage", "downtime_spare_shortage_events"),
        ("resource_delay", "downtime_resource_delay_events"),
    ]
    for event_type, metric in fallback_map:
        if _metric_float(summary.get(metric), default=0) > 0:
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


def _lite_mesa_downtime_frame_snapshot(
    *,
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
    simulation_time = _metric_float(frame.get("simulation_time", event.get("time", frame.get("step", 0))), default=0)
    return {
        "snapshot_id": f"lite-downtime-{seed or 'run'}-{ordinal:04d}",
        "source": "state_series_frame",
        "sample_index": sample_index,
        "seed": seed,
        "sweep": sweep,
        "simulation_time": simulation_time,
        "event_type": event_type,
        "event_label": _downtime_factor_label(event_type),
        "event": copy.deepcopy(event),
        "result": _lite_mesa_downtime_snapshot_result(event_type),
        "aircraft_state": copy.deepcopy(frame.get("aircraft_state") or {}),
        "support_resources": copy.deepcopy(frame.get("resources") or frame.get("support_resources") or []),
        "spare_shortages": _lite_mesa_downtime_frame_spare_shortages(frame, event),
        "support_activity_state": {
            "active_jobs": len(jobs),
            "repair_backlog": _metric_float(resource_state.get("repair_backlog"), default=0),
            "postflight_backlog": _metric_float(resource_state.get("postflight_backlog"), default=0),
            "preventive_backlog": _metric_float(resource_state.get("preventive_backlog"), default=0),
            "spare_fill_rate": _metric_float(resource_state.get("spare_fill_rate"), default=0),
        },
        "job_node": {
            "job_id": str(job.get("job_id") or f"{event_type}-node"),
            "kind": str(job.get("kind") or event_type),
            "state": str(job.get("state") or "observed"),
            "task": str(job.get("task") or _lite_mesa_downtime_snapshot_result(event_type)),
            "tail_number": str(job.get("tail_number") or ""),
        },
        "frame_ref": {
            "sample_index": sample_index,
            "sample_step": _metric_int(frame.get("sample_step", frame.get("step")), default=0),
            "step": _metric_int(frame.get("step", frame.get("sample_step")), default=0),
        },
    }


def _lite_mesa_downtime_frame_spare_shortages(frame: dict[str, Any], event: dict[str, Any]) -> list[dict[str, Any]]:
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    spare_type = str(details.get("spare_type") or "")
    if spare_type:
        return [
            {
                "spare_type": spare_type,
                "required_quantity": _metric_int(details.get("required_quantity"), default=0),
                "available_quantity": _metric_int(details.get("available_quantity"), default=0),
                "resource_id": str(details.get("resource_id") or ""),
                "job_id": str(details.get("job_id") or ""),
                "reason": str(details.get("reason") or "spare_shortage"),
            }
        ]
    shortages: list[dict[str, Any]] = []
    for spare in frame.get("spares") or []:
        if not isinstance(spare, dict):
            continue
        if _metric_float(spare.get("quantity"), default=0) <= 0 and _metric_float(spare.get("consumed"), default=0) >= 0:
            shortages.append(
                {
                    "spare_type": str(spare.get("name") or spare.get("part_id") or ""),
                    "required_quantity": 0,
                    "available_quantity": _metric_int(spare.get("quantity"), default=0),
                    "resource_id": "",
                    "job_id": "",
                    "reason": "spare_shortage",
                }
            )
    return shortages


def _lite_mesa_downtime_event_type(event_type: str) -> str:
    normalized = str(event_type or "").lower()
    if "spare" in normalized:
        return "spare_shortage"
    if "equipment_shortage" in normalized:
        return "equipment_shortage"
    if "fail" in normalized:
        return "failure"
    return ""


def _lite_mesa_downtime_snapshot_result(event_type: str) -> str:
    if event_type == "spare_shortage":
        return "mission_delayed_by_spare_shortage"
    if event_type == "equipment_shortage":
        return "mission_delayed_by_equipment_shortage"
    if event_type == "failure":
        return "aircraft_unavailable_after_failure"
    return "downtime_anomaly_recorded"


def _blocked_lite_mesa_analysis_payload(
    *,
    project: dict[str, Any],
    analysis_type: str,
    model_family: str,
    settings: dict[str, Any],
    message: str,
    issues: list[Any],
    errors: list[Any],
    provenance: dict[str, Any],
    run_id: str | None = None,
) -> dict[str, Any]:
    return {
        "status": "blocked",
        "source": "lite_mesa_aircraft_support_v1",
        "run_id": run_id,
        "project_id": project.get("project_id"),
        "model_family": model_family,
        "model_id": "AircraftSupportV1Model",
        "analysis_type": analysis_type,
        "experiment_id": _lite_mesa_analysis_experiment_id(analysis_type),
        "sample_count": 0,
        "seed_list": [],
        "metrics": [],
        "rows": [],
        "wave_rows": [],
        "event_snapshots": [],
        "limitations": _lite_mesa_analysis_limitations(),
        "settings": copy.deepcopy(settings),
        "message": message,
        "issues": copy.deepcopy(issues),
        "errors": copy.deepcopy(errors),
        "compile_provenance": copy.deepcopy(provenance),
    }


def _lite_mesa_analysis_limitations() -> list[str]:
    return [
        "本次分析结果不写入正式结果账本。",
        "未创建 run、result 或 artifact。",
        "结论只代表当前项目建模粒度和样本设置。",
    ]


def _lite_mesa_analysis_run_id(
    project: dict[str, Any],
    scenario: dict[str, Any],
    analysis_type: str,
    settings: dict[str, Any],
) -> str:
    project_id = _safe_run_id_part(str(scenario.get("project_id") or project.get("project_id") or "project"))
    digest = _stable_hash(
        {
            "project": project,
            "scenario_id": scenario.get("scenario_id"),
            "analysis_type": analysis_type,
            "settings": settings,
        }
    )
    return f"lite-mesa-analysis-{project_id}-{digest}"


def _lite_mesa_analysis_experiment_id(analysis_type: str) -> str:
    if analysis_type == "carry_list":
        return "minimum_carry_list_search"
    return "project_baseline_at_current_granularity"


def _safe_run_id_part(value: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.strip())
    normalized = "-".join(part for part in normalized.split("-") if part)
    return normalized or "project"


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        parsed = default
    else:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = default
    return max(minimum, min(maximum, parsed))


def _optional_int(value: Any) -> int | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bounded_float(value: Any, *, default: float, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        parsed = default
    else:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            parsed = default
    return max(minimum, min(maximum, parsed))


def _metric_int(value: Any, *, default: int) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def _metric_float(value: Any, *, default: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        try:
            return float(default)
        except (TypeError, ValueError):
            return 0.0


def _clamp01(value: Any) -> float:
    return min(1.0, max(0.0, _metric_float(value, default=0)))


def _sample_mean(samples: list[dict[str, Any]], metric: str) -> float:
    if not samples:
        return 0.0
    return sum(_metric_float(sample.get("metrics", {}).get(metric), default=0) for sample in samples) / len(samples)


def _sample_metric_sum(samples: list[dict[str, Any]], metric: str) -> float:
    return sum(_metric_float(sample.get("metrics", {}).get(metric), default=0) for sample in samples)


def _decimal(value: Any) -> str:
    return f"{_metric_float(value, default=0):.3f}"


def _pct(value: Any) -> str:
    return f"{round(_metric_float(value, default=0) * 100)}%"


def _risk_label(value: Any) -> str:
    normalized = str(value or "").lower()
    if normalized in {"高", "high"}:
        return "高"
    if normalized in {"中", "medium"}:
        return "中"
    if normalized in {"低", "low"}:
        return "低"
    return str(value or "低")


def _downtime_factor_count(factor: str, aggregate: dict[str, Any]) -> int:
    metric_by_factor = {
        "failure": "downtime_failure_events",
        "spare_shortage": "downtime_spare_shortage_events",
        "resource_delay": "downtime_resource_delay_events",
        "postflight": "postflight_backlog",
        "preventive": "preventive_backlog",
        "transport_delay": "transport_in_transit_count",
    }
    return max(0, _metric_int(aggregate.get(metric_by_factor.get(factor, "")), default=0))


def _downtime_factor_label(factor: str) -> str:
    return {
        "failure": "故障停机",
        "spare_shortage": "备件短缺",
        "resource_delay": "资源等待",
        "postflight": "飞后积压",
        "preventive": "定检积压",
        "transport_delay": "转运在途",
    }.get(factor, factor)


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
