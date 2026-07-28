"""Function-level backend API facade for contract-first simulation flows."""

from __future__ import annotations

import copy
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import multiprocessing
from pathlib import Path
import signal
import sqlite3
import threading
import time
from typing import Any
from uuid import uuid4

from src.spare_mvp_backend.analysis_xlsx import AnalysisXlsxError, export_analysis_snapshot_xlsx
from src.spare_mvp_backend.errors import BackendApiError
from src.spare_mvp_backend.execution_context import (
    DEFAULT_CONTEXT_PARALLEL_CORES,
    DEFAULT_CONTEXT_SAMPLES,
    DEFAULT_CONTEXT_SEED,
    ResolvedExecutionContext,
    VisualizationSessionStore,
    canonical_fingerprint,
)
from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_backend.monte_carlo_config import normalize_monte_carlo_parallel_cores
from src.spare_mvp_backend.project_payload import (
    materialize_scenario_composition,
    normalize_project_basic_mission_support_activity_names,
    project_basic_mission_support_activity_name_errors,
    project_failure_distribution_errors,
    project_k_out_of_n_errors,
    project_runtime_config_paths,
    strip_project_sweep,
)
from src.spare_mvp_backend.project_xlsx import (
    MAX_XLSX_BYTES, ProjectXlsxError, locate_issues, parse_project_xlsx, preview_counts, validate_import_relations,
)
from src.spare_mvp_backend.repository import ContractRepository
from src.spare_mvp_backend.rms_allocation_xlsx import (
    RmsAllocationXlsxError,
    export_rms_allocation_xlsx,
    parse_rms_allocation_xlsx,
)
from src.spare_mvp_backend.run_service import ACTIVE_FORMAL_MODEL_FAMILY, RETIRED_FORMAL_MODEL_FAMILIES, RunService, RunServiceError
from src.spare_mvp_abm.aircraft_support_v1.mission_reliability import (
    mission_period_outcome,
    period_completion_summary,
)
from src.spare_mvp_abm.aircraft_support_v1.organization_observability import (
    aggregate_organization_dispatch_summaries,
    organization_dispatch_summary,
    organization_graph_identity,
)
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter
from src.spare_mvp_contract.downtime import (
    normalize_downtime_event_for_analysis,
    sanitize_downtime_user_projection,
)
from src.spare_mvp_contract.monte_carlo_moments import build_monte_carlo_metric_moments
from src.spare_mvp_contract.task_reliability import (
    build_task_reliability_result_fields,
    task_reliability_metrics,
)


ANALYSIS_PROJECTION_ARTIFACT_KINDS = {
    "spare_shortfall": "analysis_projection_spare_shortfall",
    "carry_list": "analysis_projection_carry_list",
    "mission_reliability": "analysis_projection_mission_reliability",
    "downtime_factors": "analysis_projection_downtime_factors",
}

# Keep a hard deadline for pathological samples while leaving headroom for
# supported long-horizon Projects on slower developer and deployment hosts.
LITE_MESA_SAMPLE_TIMEOUT_SECONDS = 90
LITE_MESA_SESSION_TIMEOUT_MIN_SECONDS = 180
LITE_MESA_SESSION_TIMEOUT_MAX_SECONDS = 900
_LITE_MESA_WORKER_INPUTS: dict[str, Any] | None = None


class LiteMesaSampleTimeoutError(TimeoutError):
    def __init__(self, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(f"Mesa sample exceeded the {timeout_seconds:g}s execution limit")


class BackendApi:
    """Thin orchestration layer over the Simulation Adapter and repository."""

    def __init__(
        self,
        repository: ContractRepository,
        adapter: SimulationAdapter,
        output_dir: Path | str,
        run_lifecycle_lock: threading.Lock | None = None,
        visualization_session_store: VisualizationSessionStore | None = None,
        visualization_session_lifecycle_lock: threading.RLock | None = None,
    ) -> None:
        self.repository = repository
        self.adapter = adapter
        self.output_dir = Path(output_dir)
        lifecycle_lock = run_lifecycle_lock or threading.Lock()
        self.run_service = RunService(repository, adapter, self.output_dir, run_lifecycle_lock=lifecycle_lock)
        self.visualization_session_store = visualization_session_store or VisualizationSessionStore()
        self.visualization_session_lifecycle_lock = (
            visualization_session_lifecycle_lock or threading.RLock()
        )

    def validate_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        failure_distribution_errors = project_failure_distribution_errors(project_json)
        project = normalize_project_basic_mission_support_activity_names(project_json)
        validation = self.adapter.validate_project(project)
        if failure_distribution_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            existing = {
                (error.get("code"), error.get("path") or error.get("field_path"))
                for error in validation.get("errors", [])
            }
            validation["errors"] = [
                *validation.get("errors", []),
                *[
                    error
                    for error in failure_distribution_errors
                    if (error.get("code"), error.get("path") or error.get("field_path")) not in existing
                ],
            ]
        runtime_config_errors = [
            {
                "code": "unsupported_project_runtime_config",
                "path": path,
                "message": (
                    "Project JSON must not include runtime analysis or Monte Carlo config; "
                    "use ExperimentPlan.config / RunIntent / MonteCarloRunConfig"
                ),
            }
            for path in project_runtime_config_paths(project)
        ]
        if runtime_config_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *runtime_config_errors]
        k_out_of_n_errors = project_k_out_of_n_errors(project)
        if k_out_of_n_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *k_out_of_n_errors]
        support_activity_name_errors = project_basic_mission_support_activity_name_errors(project)
        if support_activity_name_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *support_activity_name_errors]
        equipment_integrity_codes = {
            "missing_component_parent",
            "invalid_component_failure_distribution",
            "missing_equipment_reference",
            "conflicting_product_failure_distribution",
        }
        equipment_integrity_errors = [
            issue
            for issue in self.adapter._aircraft_support_v1_compile_issues(project)
            if issue.get("code") in equipment_integrity_codes
        ]
        if equipment_integrity_errors:
            validation = copy.deepcopy(validation)
            validation["ok"] = False
            validation["errors"] = [*validation.get("errors", []), *equipment_integrity_errors]
        return validation

    def preview_project_xlsx(self, payload: dict[str, Any]) -> dict[str, Any]:
        encoded = str(payload.get("content_base64") or "")
        try:
            content = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise BackendApiError("invalid_project_xlsx", "XLSX 内容不是有效的 base64") from exc
        if len(content) > MAX_XLSX_BYTES:
            raise BackendApiError(
                "project_xlsx_too_large", "XLSX 文件超过导入上限",
                limit_bytes=MAX_XLSX_BYTES, received_bytes=len(content),
            )
        try:
            project, locations, parse_errors = parse_project_xlsx(content)
        except ProjectXlsxError as exc:
            raise BackendApiError("invalid_project_xlsx", str(exc)) from exc
        project = normalize_project_basic_mission_support_activity_names(project)
        validation = self.validate_project(project)
        relation_errors = validate_import_relations(project)
        compile_errors = self.adapter._aircraft_support_v1_compile_issues(project)
        errors = locate_issues([*parse_errors, *validation.get("errors", []), *relation_errors, *compile_errors], locations)
        return {
            "ok": not errors,
            "project_json": project,
            "errors": errors,
            "counts": preview_counts(project),
            "sheets": sorted({location["sheet"] for location in locations.values()}),
        }

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
        project = normalize_project_basic_mission_support_activity_names(self.repository.get_project(project_id))
        return strip_project_sweep(project)

    def compile_project_preflight(
        self,
        project_id: str,
        *,
        model_family: str = ACTIVE_FORMAL_MODEL_FAMILY,
        experiment_plan_id: str | None = None,
    ) -> dict[str, Any]:
        """Return run-readiness diagnostics without persisting compiler output."""
        try:
            result = self.run_service.compile_preflight(
                project_id,
                model_family=model_family,
                experiment_plan_id=experiment_plan_id,
            )
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc
        return {
            "schema_version": "project-compile-preflight-v0",
            "project_id": project_id,
            **({"experiment_plan_id": experiment_plan_id} if experiment_plan_id else {}),
            "model_family": model_family,
            "status": str(result.get("status") or "blocked"),
            "issues": [_project_compile_preflight_issue(issue) for issue in result.get("issues") or []],
            "warnings": copy.deepcopy(result.get("warnings") or []),
        }

    def list_projects(self) -> dict[str, Any]:
        projects = self.repository.list_projects()
        return {
            "projects": [_project_list_entry(project) for project in projects],
        }

    def save_aircraft_mission_reliability_analysis(
        self,
        project_id: str,
        payload: dict[str, Any],
        *,
        actor_user_id: str,
    ) -> dict[str, Any]:
        """Persist a server-owned, immutable copy of an analysis result."""
        self.repository.get_project(project_id)
        analysis_id = str(payload.get("analysis_id") or payload.get("analysisId") or "").strip()
        if not analysis_id:
            analysis_id = f"aircraft-mission-reliability-analysis-{uuid4()}"
        aircraft_model = _required_text(payload, "aircraft_model", "aircraftModel")
        mission_profile_id = _required_text(payload, "mission_profile_id", "missionProfileId")
        mission_profile_name = _required_text(payload, "mission_profile_name", "missionProfileName")
        duration_hours = _required_finite_number(payload, "duration_hours", "durationHours")
        if duration_hours <= 0:
            raise ValueError("duration_hours must be greater than 0")
        aircraft_reliability = _required_finite_number(
            payload,
            "aircraft_reliability",
            "aircraftReliability",
        )
        if not 0 <= aircraft_reliability <= 1:
            raise ValueError("aircraft_reliability must be between 0 and 1")
        snapshot = payload.get("snapshot")
        if not isinstance(snapshot, dict):
            raise ValueError("snapshot must be an object")
        analysis = {
            "analysis_id": analysis_id,
            "project_id": project_id,
            "created_by": actor_user_id,
            "aircraft_model": aircraft_model,
            "mission_profile_id": mission_profile_id,
            "mission_profile_name": mission_profile_name,
            "duration_hours": duration_hours,
            "aircraft_reliability": aircraft_reliability,
            "snapshot": copy.deepcopy(snapshot),
        }
        try:
            return self.repository.insert_aircraft_mission_reliability_analysis(analysis)
        except sqlite3.IntegrityError as exc:
            if "UNIQUE constraint failed" not in str(exc):
                raise
            raise BackendApiError(
                "analysis_already_exists",
                "Aircraft mission reliability analysis already exists",
                analysis_id=analysis_id,
            ) from exc

    def list_aircraft_mission_reliability_analyses(self, project_id: str) -> dict[str, Any]:
        self.repository.get_project(project_id)
        return {
            "project_id": project_id,
            "analyses": self.repository.list_aircraft_mission_reliability_analyses(project_id),
        }

    def delete_project(self, project_id: str) -> dict[str, Any]:
        try:
            return self.repository.delete_project(project_id)
        except ValueError as exc:
            raise BackendApiError("project_has_runs", str(exc)) from exc

    def save_project(self, project_json: dict[str, Any]) -> dict[str, Any]:
        project_json = normalize_project_basic_mission_support_activity_names(project_json)
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

    def create_imported_project(self, project_json: dict[str, Any], *, actor_user_id: str) -> dict[str, Any]:
        self._require_role(
            actor_user_id,
            {"系统管理员", "数据管理员"},
            action="project.import_xlsx.create",
            resource_type="project",
            resource_id=str(project_json.get("project_id") or ""),
        )
        project_json = normalize_project_basic_mission_support_activity_names(project_json)
        validation = self.validate_project(project_json)
        import_errors = [
            *validation.get("errors", []),
            *validate_import_relations(project_json),
            *self.adapter._aircraft_support_v1_compile_issues(project_json),
        ]
        if import_errors:
            raise BackendApiError("invalid_project", "Project JSON failed validation", errors=import_errors)
        project = strip_project_sweep(project_json)
        project["project_id"] = validation["project_id"]
        project["schema_version"] = validation["project_schema_version"]
        project["project_version"] = validation["project_version"]
        create_result = self.repository.create_project_if_absent(project, actor_user_id=actor_user_id)
        if create_result is None:
            raise BackendApiError(
                "project_already_exists",
                "Project ID already exists; import as new cannot overwrite it",
                project_id=project["project_id"],
            )
        audit = create_result["audit"]
        return {
            "project_id": project["project_id"],
            "project_version": project["project_version"],
            "schema_version": project["schema_version"],
            "updated_at": create_result["updated_at"],
            "audit_event_id": audit.get("audit_event_id") or audit.get("event_id"),
            "status": "created",
        }

    def export_rms_allocation_xlsx(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return export_rms_allocation_xlsx(payload)
        except RmsAllocationXlsxError as exc:
            raise BackendApiError("rms_allocation_export_invalid", str(exc)) from exc

    def preview_rms_allocation_xlsx(self, payload: dict[str, Any]) -> dict[str, Any]:
        encoded = str(payload.get("content_base64") or "")
        try:
            content = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise BackendApiError("invalid_rms_allocation_xlsx", "XLSX 内容不是有效的 base64") from exc
        if len(content) > MAX_XLSX_BYTES:
            raise BackendApiError(
                "rms_allocation_xlsx_too_large",
                "RMS XLSX 文件超过导入上限",
                limit_bytes=MAX_XLSX_BYTES,
                received_bytes=len(content),
            )
        try:
            preview = parse_rms_allocation_xlsx(content)
        except RmsAllocationXlsxError as exc:
            raise BackendApiError("invalid_rms_allocation_xlsx", str(exc)) from exc
        preview["fileName"] = str(payload.get("file_name") or "")
        return preview

    def export_analysis_xlsx(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return export_analysis_snapshot_xlsx(payload)
        except AnalysisXlsxError as exc:
            raise BackendApiError("analysis_export_invalid", str(exc)) from exc

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
        replacement = normalize_project_basic_mission_support_activity_names(replacement)
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
        if existing.get("status") == "frozen":
            raise BackendApiError(
                "experiment_plan_frozen",
                "Frozen ExperimentPlan cannot be updated",
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
        try:
            plan_config = _normalize_experiment_plan_config(config)
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc
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
        try:
            self.repository.upsert_experiment_plan(plan)
        except ValueError as exc:
            raise BackendApiError(
                "experiment_plan_frozen",
                "Frozen ExperimentPlan cannot be updated",
                project_id=project_id,
                experiment_plan_id=plan["experiment_plan_id"],
            ) from exc
        return plan

    def freeze_experiment_plan(self, project_id: str, experiment_plan_id: str) -> dict[str, Any]:
        try:
            plan = self.repository.get_experiment_plan(experiment_plan_id)
        except KeyError as exc:
            raise BackendApiError(
                "experiment_plan_not_found",
                "ExperimentPlan not found",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            ) from exc
        if plan.get("project_id") != project_id:
            raise BackendApiError(
                "experiment_plan_project_mismatch",
                "ExperimentPlan does not belong to project",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            )
        if plan.get("status") == "frozen":
            return plan

        config = copy.deepcopy(plan.get("config") or {})
        project_key = "projectJson" if "projectJson" in config else "project_json" if "project_json" in config else ""
        if project_key:
            project = config.get(project_key)
            if not isinstance(project, dict) or not project:
                raise BackendApiError(
                    "experiment_plan_freeze_invalid",
                    "ExperimentPlan config.projectJson must be a non-empty object",
                    experiment_plan_id=experiment_plan_id,
                    field="config.projectJson",
                )
        else:
            snapshot_id = str(plan.get("modeling_snapshot_id") or "").strip()
            if not snapshot_id:
                raise BackendApiError(
                    "experiment_plan_freeze_invalid",
                    "ExperimentPlan must reference a modeling snapshot",
                    experiment_plan_id=experiment_plan_id,
                    field="modeling_snapshot_id",
                )
            try:
                snapshot = self.repository.get_modeling_snapshot(snapshot_id)
            except KeyError as exc:
                raise BackendApiError(
                    "experiment_plan_freeze_invalid",
                    "ExperimentPlan modeling snapshot was not found",
                    experiment_plan_id=experiment_plan_id,
                    modeling_snapshot_id=snapshot_id,
                ) from exc
            if snapshot.get("project_id") != project_id or not isinstance(snapshot.get("project"), dict):
                raise BackendApiError(
                    "experiment_plan_freeze_invalid",
                    "ExperimentPlan modeling snapshot does not contain the plan Project",
                    experiment_plan_id=experiment_plan_id,
                    modeling_snapshot_id=snapshot_id,
                )
            project = snapshot["project"]

        frozen_project = strip_project_sweep(materialize_scenario_composition(copy.deepcopy(project)))
        if str(frozen_project.get("project_id") or "") != project_id:
            raise BackendApiError(
                "experiment_plan_project_mismatch",
                "ExperimentPlan Project JSON does not match the owning project",
                project_id=project_id,
                embedded_project_id=frozen_project.get("project_id"),
                experiment_plan_id=experiment_plan_id,
            )
        runtime_settings = _normalize_frozen_runtime_settings(config)
        compile_result = self.adapter.compile_scenario_with_gate(
            frozen_project,
            model_family=ACTIVE_FORMAL_MODEL_FAMILY,
            runtime_config={"seed": runtime_settings["seed"]},
        )
        if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
            raise BackendApiError(
                "experiment_plan_freeze_blocked",
                "ExperimentPlan Project did not pass the SimulationAdapter compile gate",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
                issues=compile_result.get("issues", []),
                errors=compile_result.get("errors", []),
            )

        config.pop("project_json", None)
        config["projectJson"] = frozen_project
        config.update(runtime_settings)
        fingerprint = canonical_fingerprint(
            {
                "projectJson": frozen_project,
                "samples": runtime_settings["samples"],
                "parallelCores": runtime_settings["parallelCores"],
                "seed": runtime_settings["seed"],
            }
        )
        frozen = {
            **plan,
            "status": "frozen",
            "config": config,
            "canonical_fingerprint": fingerprint,
            "frozen_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        try:
            self.repository.compare_and_swap_freeze_experiment_plan(
                frozen,
                expected_plan=plan,
            )
        except ValueError as exc:
            raise BackendApiError(
                "experiment_plan_version_conflict",
                "ExperimentPlan changed while it was being frozen; reload and retry",
                project_id=project_id,
                experiment_plan_id=experiment_plan_id,
            ) from exc
        return frozen

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
            with self.visualization_session_lifecycle_lock:
                deleted = self.run_service.delete_experiment_plan(
                    project_id,
                    experiment_plan_id,
                    actor_user_id=actor_user_id,
                )
                deleted["revoked_visualization_session_ids"] = (
                    self.visualization_session_store.delete_for_experiment_plan(experiment_plan_id)
                )
                return deleted
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
        project_json: dict[str, Any] | None = None,
        *,
        analysis_type: str,
        settings: dict[str, Any] | None = None,
        model_family: str = ACTIVE_FORMAL_MODEL_FAMILY,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Run a draft or frozen-plan Mesa analysis without formal persistence."""
        analysis_started = time.perf_counter()
        normalized_analysis_type = _normalize_analysis_type(analysis_type)
        resolved_context = self._resolve_execution_context(project_json=project_json, context=context)
        requested_settings = copy.deepcopy(settings or {})
        if resolved_context.context["type"] == "frozen_plan":
            requested_settings.update(resolved_context.runtime_settings)
        try:
            normalized_settings = _normalize_lite_mesa_analysis_settings(requested_settings)
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc
        if model_family != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "unsupported_lite_mesa_analysis_model_family",
                f"lite Mesa analysis supports only {ACTIVE_FORMAL_MODEL_FAMILY}",
                model_family=model_family,
                replacement_model_family=ACTIVE_FORMAL_MODEL_FAMILY,
            )
        project = copy.deepcopy(resolved_context.project)
        fingerprint = canonical_fingerprint(
            {
                "context_fingerprint": resolved_context.fingerprint,
                "analysis_type": normalized_analysis_type,
                "model_family": model_family,
                "effective_settings": normalized_settings,
            }
        )
        context_metadata = {
            "analysis_session_id": f"analysis-session-{uuid4().hex}",
            "context": copy.deepcopy(resolved_context.context),
            "fingerprint": fingerprint,
            "execution_fingerprint": fingerprint,
        }
        compile_gate = getattr(self.adapter, "compile_scenario_with_gate", None)
        if not callable(compile_gate):
            raise BackendApiError(
                "lite_mesa_analysis_compile_unavailable",
                "SimulationAdapter does not expose compile_scenario_with_gate",
            )
        compile_started = time.perf_counter()
        compile_result = compile_gate(project, model_family=model_family)
        compile_seconds = time.perf_counter() - compile_started
        if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
            payload = _blocked_lite_mesa_analysis_payload(
                project=project,
                analysis_type=normalized_analysis_type,
                model_family=model_family,
                settings=normalized_settings,
                message="无法编译当前 Project 到 aircraft_support_v1；请补齐任务、装备、备件、保障节点和维修作业建模字段。",
                issues=compile_result.get("issues", []),
                errors=compile_result.get("errors", []),
                provenance=compile_result.get("provenance", {}),
            )
            payload.update(context_metadata)
            return payload

        scenario = copy.deepcopy(compile_result["scenario"])
        scenario.get("compiled_from", {}).setdefault("mapping_provenance", compile_result.get("provenance", {}))
        run_id = _lite_mesa_analysis_run_id(project, scenario, normalized_analysis_type, normalized_settings)
        inputs = copy.deepcopy(scenario["simulation_inputs"])
        base_seed = normalized_settings["seed"] if normalized_settings["seed"] is not None else int(inputs.get("seed", 0))
        sample_started = time.perf_counter()
        samples, failed_samples, worker_count, sample_diagnostics = _run_lite_mesa_analysis_samples(
            inputs,
            base_seed=base_seed,
            settings=normalized_settings,
        )
        sample_execution_seconds = time.perf_counter() - sample_started

        if not samples:
            timeout_failures = [
                item for item in failed_samples
                if item.get("error", {}).get("code") in {"sample_timeout", "session_timeout"}
            ]
            payload = _blocked_lite_mesa_analysis_payload(
                project=project,
                analysis_type=normalized_analysis_type,
                model_family=model_family,
                settings=normalized_settings,
                message=(
                    "Mesa 分析样本全部超时；请减少样本数、提高并行核心数，或检查导致单样本异常缓慢的模型输入。"
                    if timeout_failures and len(timeout_failures) == len(failed_samples)
                    else "Mesa 分析样本全部失败；当前建模粒度不足以生成会话内结果。"
                ),
                issues=[],
                errors=failed_samples,
                provenance=compile_result.get("provenance", {}),
                run_id=run_id,
            )
            payload.update(
                _lite_mesa_execution_metadata(
                    settings=normalized_settings,
                    samples=samples,
                    failed_samples=failed_samples,
                    worker_count=worker_count,
                    sample_diagnostics=sample_diagnostics,
                    timings={
                        "compile_seconds": compile_seconds,
                        "sample_execution_seconds": sample_execution_seconds,
                        "aggregation_seconds": 0.0,
                        "projection_seconds": 0.0,
                        "total_seconds": time.perf_counter() - analysis_started,
                    },
                )
            )
            payload["failed_samples"] = copy.deepcopy(failed_samples)
            payload["metric_moments"] = build_monte_carlo_metric_moments(
                [],
                total_sample_count=normalized_settings["samples"],
                failed_sample_count=len(failed_samples),
            )
            payload.update(context_metadata)
            return payload

        aggregation_started = time.perf_counter()
        aggregate = self.adapter._aggregate_sample_metrics(samples)  # noqa: SLF001 - in-memory aggregation, no writes.
        metric_moments = build_monte_carlo_metric_moments(
            samples,
            total_sample_count=normalized_settings["samples"],
            failed_sample_count=len(failed_samples),
        )
        self.adapter._coerce_result_integer_metrics(aggregate)  # noqa: SLF001 - reuse canonical metric coercion.
        if "mission_success_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["mission_success_rate"]
        elif "sortie_completion_rate" in aggregate:
            aggregate["mission_success_probability"] = aggregate["sortie_completion_rate"]
        aggregation_seconds = time.perf_counter() - aggregation_started
        organization_identity = organization_graph_identity(
            inputs.get("support_network", {}).get("organization_graph")
        )
        organization_summary = aggregate_organization_dispatch_summaries(
            [sample.get("organization_dispatch_summary") or {} for sample in samples],
            identity=organization_identity,
        )
        projection_started = time.perf_counter()
        base_artifact_id = f"lite-mesa-analysis-base-{run_id}"
        projections = self.adapter._aircraft_support_v1_analysis_projections(  # noqa: SLF001 - projection payload only.
            aggregate,
            base_artifact_id,
            samples=samples,
            run_id=run_id,
            validation_scope=scenario.get("compiled_from", {}).get("mapping_provenance", {}),
            simulation_inputs=inputs,
            carry_minimum_satisfaction_rate=normalized_settings["missionConfidenceTarget"],
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
            organization_identity=organization_identity,
            organization_summary=samples[0]["organization_dispatch_summary"],
            representative_sample_index=samples[0]["sample_index"],
            representative_seed=samples[0]["seed"],
        )
        projection_seconds = time.perf_counter() - projection_started
        timings = {
            "compile_seconds": compile_seconds,
            "sample_execution_seconds": sample_execution_seconds,
            "aggregation_seconds": aggregation_seconds,
            "projection_seconds": projection_seconds,
            "total_seconds": 0.0,
        }
        payload = {
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
            "parallel_cores": normalized_settings["parallelCores"],
            "worker_count": worker_count,
            "aggregate_metrics": aggregate,
            "organization_graph_identity": organization_identity,
            "organization_dispatch_summary": organization_summary,
            "sample_organization_dispatch_summaries": [
                copy.deepcopy(sample.get("organization_dispatch_summary") or {}) for sample in samples
            ],
            "metric_moments": metric_moments,
            **context_metadata,
            "projection": projections[normalized_analysis_type],
            "metrics": page_result["metrics"],
            "result_fields": page_result.get("result_fields", []),
            "rows": page_result["rows"],
            "wave_rows": page_result.get("wave_rows", []),
            "daily_rows": page_result.get("daily_rows", []),
            "event_details": page_result.get("event_details", []),
            "event_snapshots": page_result.get("event_snapshots", []),
            "sortie_rate": page_result.get("sortie_rate"),
            "wave_success_rate": page_result.get("wave_success_rate"),
            "profile_reliability": page_result.get("profile_reliability"),
            "period_completion_probability": page_result.get("period_completion_probability"),
            "period_duration_days": page_result.get("period_duration_days"),
            "period_total_samples": page_result.get("total_samples"),
            "period_failed_samples": page_result.get("failed_samples"),
            "successful_samples": page_result.get("successful_samples"),
            "valid_samples": page_result.get("valid_samples"),
            "visualization_state_series": visualization_state_series,
            "lifecycle_trace": copy.deepcopy(samples[0].get("lifecycle_trace") or []),
            "limitations": _lite_mesa_analysis_limitations(),
            "failed_samples": failed_samples,
            "compile_provenance": compile_result.get("provenance", {}),
            **_lite_mesa_execution_metadata(
                settings=normalized_settings,
                samples=samples,
                failed_samples=failed_samples,
                worker_count=worker_count,
                sample_diagnostics=sample_diagnostics,
                timings=timings,
            ),
        }
        timings["total_seconds"] = time.perf_counter() - analysis_started
        return payload

    def create_visualization_session(
        self,
        *,
        context: dict[str, Any],
        settings: dict[str, Any] | None = None,
        model_family: str = ACTIVE_FORMAL_MODEL_FAMILY,
        playback_speed: Any = 1.0,
        actor_user_id: str,
        frame_sample_every_steps: Any | None = None,
    ) -> dict[str, Any]:
        if model_family != ACTIVE_FORMAL_MODEL_FAMILY:
            raise BackendApiError(
                "unsupported_visualization_model_family",
                f"visualization sessions support only {ACTIVE_FORMAL_MODEL_FAMILY}",
                model_family=model_family,
            )
        resolved = self._resolve_execution_context(context=context)
        requested_settings = copy.deepcopy(settings or {})
        if frame_sample_every_steps is None:
            frame_sample_every_steps = requested_settings.get(
                "frameSampleEverySteps",
                requested_settings.get("frame_sample_every_steps"),
            )
        if resolved.context["type"] == "frozen_plan":
            requested_settings.update(resolved.runtime_settings)
        try:
            normalized_settings = _normalize_lite_mesa_analysis_settings(requested_settings)
        except RunServiceError as exc:
            raise self._run_service_error_to_backend_error(exc) from exc
        try:
            normalized_playback_speed = float(playback_speed)
        except (TypeError, ValueError) as exc:
            raise BackendApiError(
                "bad_visualization_session_request",
                "playback_speed must be a positive number",
                field="playback_speed",
            ) from exc
        if not math.isfinite(normalized_playback_speed) or normalized_playback_speed <= 0:
            raise BackendApiError(
                "bad_visualization_session_request",
                "playback_speed must be a positive number",
                field="playback_speed",
            )

        compiled_inputs_cache_key = canonical_fingerprint({
            "context_fingerprint": resolved.fingerprint,
            "model_family": model_family,
            "seed": normalized_settings["seed"],
        })
        inputs = self.visualization_session_store.get_compiled_inputs(
            compiled_inputs_cache_key
        )
        if inputs is None:
            compile_result = self.adapter.compile_scenario_with_gate(
                copy.deepcopy(resolved.project),
                model_family=model_family,
                runtime_config={"seed": normalized_settings["seed"]},
            )
            if compile_result.get("status") != "compiled" or compile_result.get("scenario") is None:
                raise BackendApiError(
                    "visualization_session_compile_blocked",
                    "Execution context did not pass the SimulationAdapter compile gate",
                    issues=compile_result.get("issues", []),
                    errors=compile_result.get("errors", []),
                )
            inputs = copy.deepcopy(compile_result["scenario"]["simulation_inputs"])
            self.visualization_session_store.put_compiled_inputs(
                compiled_inputs_cache_key,
                inputs,
            )
        inputs["seed"] = normalized_settings["seed"]
        time_config = inputs.get("time") if isinstance(inputs.get("time"), dict) else {}
        duration_minutes = _positive_session_int(
            time_config.get("duration_minutes"),
            "simulation_inputs.time.duration_minutes",
        )
        tick_minutes = _positive_session_int(
            time_config.get("tick_minutes"),
            "simulation_inputs.time.tick_minutes",
        )
        sample_every_minutes = _positive_session_int(
            time_config.get("sample_every_minutes", tick_minutes),
            "simulation_inputs.time.sample_every_minutes",
        )
        if frame_sample_every_steps is None:
            normalized_frame_sample_every_steps = max(
                1,
                math.ceil(sample_every_minutes / tick_minutes),
            )
        else:
            normalized_frame_sample_every_steps = _positive_visualization_int(
                frame_sample_every_steps,
                "frameSampleEverySteps",
            )
            time_config["sample_every_minutes"] = (
                normalized_frame_sample_every_steps * tick_minutes
            )
        session_payload = {
            "context": copy.deepcopy(resolved.context),
            "context_key": _execution_context_key(resolved),
            "fingerprint": resolved.fingerprint,
            "input_fingerprint": canonical_fingerprint(inputs),
            "duration_minutes": duration_minutes,
            "tick_minutes": tick_minutes,
            "max_steps": math.ceil(duration_minutes / tick_minutes),
            "frame_sample_every_steps": normalized_frame_sample_every_steps,
            "seed": normalized_settings["seed"],
            "playback_speed": normalized_playback_speed,
            "simulation_inputs": inputs,
        }
        if resolved.experiment_plan_id is None:
            return self.visualization_session_store.create(
                session_payload,
                owner_user_id=actor_user_id,
            )
        with self.visualization_session_lifecycle_lock:
            self._assert_frozen_context_still_current(resolved)
            return self.visualization_session_store.create(
                session_payload,
                owner_user_id=actor_user_id,
                experiment_plan_id=resolved.experiment_plan_id,
            )

    def get_visualization_session(
        self,
        visualization_session_id: str,
        *,
        actor_user_id: str | None = None,
        actor_role: str | None = None,
        session_access_token: str | None = None,
    ) -> dict[str, Any]:
        try:
            return self.visualization_session_store.get(
                visualization_session_id,
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                session_access_token=session_access_token,
            )
        except PermissionError as exc:
            raise BackendApiError(
                "visualization_session_forbidden",
                "Visualization session access was denied",
                visualization_session_id=visualization_session_id,
            ) from exc

    def delete_visualization_session(
        self,
        visualization_session_id: str,
        *,
        actor_user_id: str,
        actor_role: str | None = None,
    ) -> dict[str, Any]:
        try:
            deleted = self.visualization_session_store.delete(
                visualization_session_id,
                actor_user_id=actor_user_id,
                actor_role=actor_role,
            )
        except PermissionError as exc:
            raise BackendApiError(
                "visualization_session_forbidden",
                "Visualization session deletion was denied",
                visualization_session_id=visualization_session_id,
            ) from exc
        return {
            "visualization_session_id": visualization_session_id,
            "deleted": deleted,
        }

    def _assert_frozen_context_still_current(self, resolved: ResolvedExecutionContext) -> None:
        if resolved.experiment_plan_id is None:
            return
        try:
            current = self.repository.get_experiment_plan(resolved.experiment_plan_id)
        except KeyError as exc:
            raise BackendApiError(
                "frozen_plan_changed",
                "Frozen ExperimentPlan was deleted while visualization inputs were compiling",
                experiment_plan_id=resolved.experiment_plan_id,
            ) from exc
        if (
            current.get("status") != "frozen"
            or current.get("canonical_fingerprint") != resolved.fingerprint
        ):
            raise BackendApiError(
                "frozen_plan_changed",
                "Frozen ExperimentPlan changed while visualization inputs were compiling",
                experiment_plan_id=resolved.experiment_plan_id,
            )

    def _resolve_execution_context(
        self,
        *,
        project_json: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> ResolvedExecutionContext:
        descriptor = copy.deepcopy(context) if isinstance(context, dict) else {}
        context_type = str(
            descriptor.get("type")
            or descriptor.get("kind")
            or descriptor.get("source")
            or ("current_project" if project_json is not None else "")
        ).strip()
        if context_type == "current_project":
            if any(
                descriptor.get(key)
                for key in ("experiment_plan_id", "experimentPlanId", "plan_id", "planId")
            ):
                raise BackendApiError(
                    "bad_execution_context",
                    "current_project context cannot reference an ExperimentPlan",
                )
            candidate = (
                descriptor.get("project")
                or descriptor.get("projectJson")
                or descriptor.get("project_json")
                or project_json
            )
            if not isinstance(candidate, dict) or not candidate:
                raise BackendApiError(
                    "bad_execution_context",
                    "current_project context requires request-local Project JSON",
                )
            project = strip_project_sweep(materialize_scenario_composition(copy.deepcopy(candidate)))
            runtime_settings = {
                "samples": DEFAULT_CONTEXT_SAMPLES,
                "parallelCores": DEFAULT_CONTEXT_PARALLEL_CORES,
                "seed": DEFAULT_CONTEXT_SEED,
            }
            return ResolvedExecutionContext(
                context={"type": "current_project"},
                project=project,
                runtime_settings=runtime_settings,
                fingerprint=canonical_fingerprint({"projectJson": project, **runtime_settings}),
            )
        if context_type != "frozen_plan":
            raise BackendApiError(
                "bad_execution_context",
                "context.type must be current_project or frozen_plan",
                context_type=context_type,
            )
        if project_json is not None or any(
            key in descriptor for key in ("project", "projectJson", "project_json")
        ):
            raise BackendApiError(
                "frozen_plan_client_override",
                "frozen_plan context does not accept client Project JSON",
            )
        experiment_plan_id = str(
            descriptor.get("experiment_plan_id")
            or descriptor.get("experimentPlanId")
            or descriptor.get("plan_id")
            or descriptor.get("planId")
            or ""
        ).strip()
        if not experiment_plan_id:
            raise BackendApiError(
                "bad_execution_context",
                "frozen_plan context requires experiment_plan_id",
                field="context.experiment_plan_id",
            )
        try:
            plan = self.repository.get_experiment_plan(experiment_plan_id)
        except KeyError as exc:
            raise BackendApiError(
                "experiment_plan_not_found",
                "ExperimentPlan not found",
                experiment_plan_id=experiment_plan_id,
            ) from exc
        requested_project_id = str(
            descriptor.get("project_id") or descriptor.get("projectId") or ""
        ).strip()
        if requested_project_id and requested_project_id != plan.get("project_id"):
            raise BackendApiError(
                "experiment_plan_project_mismatch",
                "ExperimentPlan does not belong to requested project",
                project_id=requested_project_id,
                experiment_plan_id=experiment_plan_id,
            )
        if plan.get("status") != "frozen":
            raise BackendApiError(
                "experiment_plan_not_frozen",
                "frozen_plan context requires a frozen ExperimentPlan",
                experiment_plan_id=experiment_plan_id,
                status=plan.get("status"),
            )
        config = plan.get("config") if isinstance(plan.get("config"), dict) else {}
        project = config.get("projectJson")
        fingerprint = str(plan.get("canonical_fingerprint") or "")
        if not isinstance(project, dict) or not project or not fingerprint:
            raise BackendApiError(
                "invalid_frozen_plan",
                "Frozen ExperimentPlan is missing its canonical Project snapshot or fingerprint",
                experiment_plan_id=experiment_plan_id,
            )
        requested_fingerprint = str(
            descriptor.get("planFingerprint")
            or descriptor.get("plan_fingerprint")
            or ""
        ).strip()
        if not requested_fingerprint:
            raise BackendApiError(
                "frozen_plan_fingerprint_required",
                "frozen_plan context requires planFingerprint",
                experiment_plan_id=experiment_plan_id,
                field="context.planFingerprint",
            )
        if requested_fingerprint != fingerprint:
            raise BackendApiError(
                "frozen_plan_fingerprint_mismatch",
                "frozen_plan planFingerprint does not match the current ExperimentPlan",
                experiment_plan_id=experiment_plan_id,
            )
        runtime_settings = _normalize_frozen_runtime_settings(config)
        expected_fingerprint = canonical_fingerprint({"projectJson": project, **runtime_settings})
        if fingerprint != expected_fingerprint:
            raise BackendApiError(
                "invalid_frozen_plan",
                "Frozen ExperimentPlan fingerprint does not match its canonical payload",
                experiment_plan_id=experiment_plan_id,
            )
        return ResolvedExecutionContext(
            context={
                "type": "frozen_plan",
                "project_id": plan["project_id"],
                "experiment_plan_id": experiment_plan_id,
                "planFingerprint": fingerprint,
            },
            project=copy.deepcopy(project),
            runtime_settings=runtime_settings,
            fingerprint=fingerprint,
            experiment_plan_id=experiment_plan_id,
        )

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


def _required_text(payload: dict[str, Any], field: str, alias: str) -> str:
    value = str(payload.get(field) or payload.get(alias) or "").strip()
    if not value:
        raise ValueError(f"{field} is required")
    return value


def _required_finite_number(payload: dict[str, Any], field: str, alias: str) -> float:
    raw = payload.get(field) if field in payload else payload.get(alias)
    if isinstance(raw, bool):
        raise ValueError(f"{field} must be a finite number")
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a finite number") from exc
    if not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number")
    return value


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
        plan_config["parallelCores"] = normalize_monte_carlo_parallel_cores(plan_config.get("parallelCores"))
        return plan_config

    experiment = branch_project.get("experiment") if isinstance(branch_project.get("experiment"), dict) else {}
    if "name" not in plan_config and experiment.get("name"):
        plan_config["name"] = experiment["name"]
    for key in ("steps", "samples", "seed", "parallelCores"):
        if key not in plan_config and key in experiment:
            plan_config[key] = copy.deepcopy(experiment[key])
    if "monteCarlo" not in plan_config and isinstance(branch_project.get("monteCarlo"), dict):
        plan_config["monteCarlo"] = copy.deepcopy(branch_project["monteCarlo"])
    if "analysisRequests" not in plan_config and isinstance(branch_project.get("analysisRequests"), dict):
        plan_config["analysisRequests"] = copy.deepcopy(branch_project["analysisRequests"])
    plan_config["parallelCores"] = normalize_monte_carlo_parallel_cores(plan_config.get("parallelCores"))

    clean_project = strip_project_sweep(materialize_scenario_composition(branch_project))
    if "projectJson" in plan_config:
        plan_config["projectJson"] = clean_project
    else:
        plan_config["project_json"] = clean_project
    return plan_config


def _normalize_lite_mesa_analysis_settings(settings: dict[str, Any]) -> dict[str, Any]:
    samples = _bounded_int(settings.get("samples"), default=4, minimum=1, maximum=1000)
    seed = _optional_int(settings.get("seed"))
    if seed is None:
        seed = DEFAULT_CONTEXT_SEED
    confidence_target = _bounded_float(
        settings.get("missionConfidenceTarget"),
        default=0.9,
        minimum=0.0,
        maximum=1.0,
    )
    top_n = _bounded_int(settings.get("topN"), default=4, minimum=1, maximum=20)
    parallel_cores = normalize_monte_carlo_parallel_cores(
        settings.get("parallelCores"),
        field_path="settings.parallelCores",
        default=DEFAULT_CONTEXT_PARALLEL_CORES,
    )
    sample_timeout_seconds = _bounded_int(
        settings.get("sampleTimeoutSeconds"),
        default=LITE_MESA_SAMPLE_TIMEOUT_SECONDS,
        minimum=1,
        maximum=300,
    )
    execution_waves = math.ceil(samples / min(parallel_cores, samples))
    default_session_timeout_seconds = min(
        LITE_MESA_SESSION_TIMEOUT_MAX_SECONDS,
        max(
            LITE_MESA_SESSION_TIMEOUT_MIN_SECONDS,
            execution_waves * sample_timeout_seconds + sample_timeout_seconds,
        ),
    )
    session_timeout_seconds = _bounded_int(
        settings.get("sessionTimeoutSeconds"),
        default=default_session_timeout_seconds,
        minimum=1,
        maximum=LITE_MESA_SESSION_TIMEOUT_MAX_SECONDS,
    )
    return {
        "samples": samples,
        "seed": seed,
        "missionConfidenceTarget": confidence_target,
        "topN": top_n,
        "parallelCores": parallel_cores,
        "sampleTimeoutSeconds": sample_timeout_seconds,
        "sessionTimeoutSeconds": session_timeout_seconds,
        "write_event_snapshots": bool(settings.get("write_event_snapshots")),
    }


def _normalize_frozen_runtime_settings(config: dict[str, Any]) -> dict[str, int]:
    return {
        "samples": _strict_context_int(
            config.get("samples", DEFAULT_CONTEXT_SAMPLES),
            field="config.samples",
            minimum=1,
            maximum=1000,
        ),
        "parallelCores": _strict_context_int(
            config.get("parallelCores", DEFAULT_CONTEXT_PARALLEL_CORES),
            field="config.parallelCores",
            minimum=1,
            maximum=32,
        ),
        "seed": _strict_context_int(
            config.get("seed", DEFAULT_CONTEXT_SEED),
            field="config.seed",
            minimum=0,
            maximum=2_147_483_647,
        ),
    }


def _strict_context_int(value: Any, *, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        parsed = None
    else:
        try:
            number = float(value)
            parsed = int(number) if math.isfinite(number) and number.is_integer() else None
        except (TypeError, ValueError):
            parsed = None
    if parsed is None or parsed < minimum or parsed > maximum:
        raise BackendApiError(
            "experiment_plan_freeze_invalid",
            f"{field} must be an integer between {minimum} and {maximum}",
            field=field,
            minimum=minimum,
            maximum=maximum,
        )
    return parsed


def _positive_session_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        parsed = 0
    else:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = 0
    if parsed < 1:
        raise BackendApiError(
            "visualization_session_compile_invalid",
            f"{field} must be a positive integer",
            field=field,
        )
    return parsed


def _positive_visualization_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        parsed = None
    else:
        try:
            number = float(value)
            parsed = int(number) if math.isfinite(number) and number.is_integer() else None
        except (TypeError, ValueError):
            parsed = None
    if parsed is None or parsed < 1:
        raise BackendApiError(
            "bad_visualization_session_request",
            f"{field} must be a positive integer",
            field=field,
        )
    return parsed


def _execution_context_key(resolved: ResolvedExecutionContext) -> str:
    if resolved.experiment_plan_id:
        return (
            f"frozen_plan:{resolved.experiment_plan_id}:"
            f"{resolved.fingerprint}"
        )
    return f"current_project:{resolved.fingerprint}"


def _run_lite_mesa_analysis_samples(
    inputs: dict[str, Any],
    *,
    base_seed: int,
    settings: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, list[dict[str, Any]]]:
    sample_count = settings["samples"]
    worker_count = min(settings["parallelCores"], sample_count)
    tasks = [
        (
            base_seed + sample_index,
            sample_index,
            settings["write_event_snapshots"],
            settings["sampleTimeoutSeconds"],
        )
        for sample_index in range(sample_count)
    ]
    outcomes: list[dict[str, Any]] = []
    context = multiprocessing.get_context("spawn")
    pool = context.Pool(
        processes=worker_count,
        initializer=_initialize_lite_mesa_sample_worker,
        initargs=(inputs,),
    )
    pending = [
        (task, pool.apply_async(_run_lite_mesa_analysis_sample_worker, (task,)))
        for task in tasks
    ]
    session_started = time.perf_counter()
    session_deadline = session_started + settings["sessionTimeoutSeconds"]
    terminated = False
    try:
        while pending:
            completed_any = False
            for task, async_result in list(pending):
                if not async_result.ready():
                    continue
                completed_any = True
                pending.remove((task, async_result))
                try:
                    outcomes.append(async_result.get())
                except Exception as exc:  # pragma: no cover - worker process failure guard.
                    outcomes.append(_lite_mesa_worker_process_failure(task, exc))
            if not pending:
                break
            if time.perf_counter() >= session_deadline:
                elapsed_seconds = time.perf_counter() - session_started
                outcomes.extend(
                    _lite_mesa_session_timeout_failure(task, settings, elapsed_seconds)
                    for task, _async_result in pending
                )
                pool.terminate()
                terminated = True
                pending.clear()
                break
            if not completed_any:
                time.sleep(0.01)
    finally:
        if not terminated:
            pool.close()
        pool.join()
    outcomes.sort(key=lambda outcome: outcome["sample_index"])
    samples = [outcome["sample"] for outcome in outcomes if outcome["status"] == "ok"]
    failed_samples = [outcome["failure"] for outcome in outcomes if outcome["status"] == "failed"]
    sample_diagnostics = [
        {
            "sample_index": outcome["sample_index"],
            "seed": outcome["seed"],
            "status": outcome["status"],
            "elapsed_seconds": outcome["elapsed_seconds"],
            **(
                {"error_code": outcome["failure"]["error"]["code"]}
                if outcome["status"] == "failed"
                else {}
            ),
        }
        for outcome in outcomes
    ]
    return samples, failed_samples, worker_count, sample_diagnostics


def _lite_mesa_worker_process_failure(
    task: tuple[Any, ...],
    exc: Exception,
) -> dict[str, Any]:
    seed, sample_index, _write_event_snapshots, _sample_timeout_seconds = (
        _lite_mesa_sample_task_metadata(task)
    )
    return {
        "status": "failed",
        "sample_index": sample_index,
        "seed": seed,
        "elapsed_seconds": 0.0,
        "failure": {
            "sample_index": sample_index,
            "seed": seed,
            "error": {
                "code": "sample_worker_failed",
                "message": str(exc),
                "details": {"phase": "worker_process"},
            },
        },
    }


def _lite_mesa_session_timeout_failure(
    task: tuple[Any, ...],
    settings: dict[str, Any],
    elapsed_seconds: float,
) -> dict[str, Any]:
    seed, sample_index, _write_event_snapshots, _sample_timeout_seconds = (
        _lite_mesa_sample_task_metadata(task)
    )
    return {
        "status": "failed",
        "sample_index": sample_index,
        "seed": seed,
        "elapsed_seconds": elapsed_seconds,
        "failure": {
            "sample_index": sample_index,
            "seed": seed,
            "error": {
                "code": "session_timeout",
                "message": f"Mesa analysis session exceeded {settings['sessionTimeoutSeconds']}s",
                "details": {
                    "phase": "sample_batch",
                    "timeout_seconds": settings["sessionTimeoutSeconds"],
                    "elapsed_seconds": elapsed_seconds,
                },
            },
        },
    }


@contextmanager
def _lite_mesa_sample_deadline(timeout_seconds: float):
    if timeout_seconds <= 0 or not hasattr(signal, "SIGALRM") or not hasattr(signal, "setitimer"):
        yield
        return

    def handle_timeout(_signum: int, _frame: Any) -> None:
        raise LiteMesaSampleTimeoutError(timeout_seconds)

    try:
        previous_handler = signal.getsignal(signal.SIGALRM)
        previous_timer = signal.getitimer(signal.ITIMER_REAL)
        signal.signal(signal.SIGALRM, handle_timeout)
        signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    except (ValueError, OSError):
        yield
        return
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, *previous_timer)


def _lite_mesa_execution_metadata(
    *,
    settings: dict[str, Any],
    samples: list[dict[str, Any]],
    failed_samples: list[dict[str, Any]],
    worker_count: int,
    sample_diagnostics: list[dict[str, Any]],
    timings: dict[str, float],
) -> dict[str, Any]:
    return {
        "requested_sample_count": settings["samples"],
        "completed_sample_count": len(samples),
        "failed_sample_count": len(failed_samples),
        "parallel_cores": settings["parallelCores"],
        "worker_count": worker_count,
        "sample_timeout_seconds": settings["sampleTimeoutSeconds"],
        "session_timeout_seconds": settings["sessionTimeoutSeconds"],
        "sample_diagnostics": sample_diagnostics,
        "timings": timings,
    }


def _run_lite_mesa_analysis_sample_worker(
    task: tuple[Any, ...],
) -> dict[str, Any]:
    inputs, seed, sample_index, write_event_snapshots, sample_timeout_seconds = (
        _lite_mesa_sample_task_values(task)
    )
    started = time.perf_counter()
    try:
        with _lite_mesa_sample_deadline(sample_timeout_seconds):
            sample = _run_aircraft_support_v1_analysis_sample(
                inputs,
                seed=seed,
                sample_index=sample_index,
                write_event_snapshots=write_event_snapshots,
            )
        return {
            "status": "ok",
            "sample_index": sample_index,
            "seed": seed,
            "elapsed_seconds": time.perf_counter() - started,
            "sample": sample,
        }
    except LiteMesaSampleTimeoutError as exc:
        elapsed_seconds = time.perf_counter() - started
        return {
            "status": "failed",
            "sample_index": sample_index,
            "seed": seed,
            "elapsed_seconds": elapsed_seconds,
            "failure": {
                "sample_index": sample_index,
                "seed": seed,
                "error": {
                    "code": "sample_timeout",
                    "message": str(exc),
                    "details": {
                        "phase": "model_execution",
                        "timeout_seconds": sample_timeout_seconds,
                        "elapsed_seconds": elapsed_seconds,
                    },
                },
            },
        }
    except Exception as exc:  # pragma: no cover - defensive fail-closed path.
        elapsed_seconds = time.perf_counter() - started
        return {
            "status": "failed",
            "sample_index": sample_index,
            "seed": seed,
            "elapsed_seconds": elapsed_seconds,
            "failure": {
                "sample_index": sample_index,
                "seed": seed,
                "error": {
                    "code": "sample_failed",
                    "message": str(exc),
                    "details": {"phase": "model_execution", "elapsed_seconds": elapsed_seconds},
                },
            },
        }


def _initialize_lite_mesa_sample_worker(inputs: dict[str, Any]) -> None:
    global _LITE_MESA_WORKER_INPUTS
    _LITE_MESA_WORKER_INPUTS = inputs


def _lite_mesa_sample_task_values(
    task: tuple[Any, ...],
) -> tuple[dict[str, Any], int, int, bool, float]:
    if len(task) == 5 and isinstance(task[0], dict):
        inputs = task[0]
    elif len(task) == 4:
        inputs = _LITE_MESA_WORKER_INPUTS
        if not isinstance(inputs, dict):
            raise RuntimeError("lite Mesa worker inputs were not initialized")
    else:
        raise ValueError("invalid lite Mesa sample task")
    seed, sample_index, write_event_snapshots, sample_timeout_seconds = (
        _lite_mesa_sample_task_metadata(task)
    )
    return (
        inputs,
        seed,
        sample_index,
        write_event_snapshots,
        sample_timeout_seconds,
    )


def _lite_mesa_sample_task_metadata(
    task: tuple[Any, ...],
) -> tuple[int, int, bool, float]:
    if len(task) == 5 and isinstance(task[0], dict):
        _inputs, seed, sample_index, write_event_snapshots, sample_timeout_seconds = task
    elif len(task) == 4:
        seed, sample_index, write_event_snapshots, sample_timeout_seconds = task
    else:
        raise ValueError("invalid lite Mesa sample task")
    return (
        int(seed),
        int(sample_index),
        bool(write_event_snapshots),
        float(sample_timeout_seconds),
    )


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
    period_outcome = mission_period_outcome(
        model.missions,
        duration_days=execution.get("metrics", {}).get("simulation_days", 0),
    )
    source_frames = execution.get("frames", [])[:20]
    if not source_frames:
        source_frames = [model.visualization_frame(run_id="", step=0)]
    frames = []
    for sample_step, frame in enumerate(source_frames):
        item = copy.deepcopy(frame)
        item["sample_index"] = sample_index
        item["sample_step"] = sample_step
        item["seed"] = seed
        item["sweep"] = {}
        frames.append(item)
    projection_events = [
        copy.deepcopy(event)
        for event in execution.get("events") or []
        if _lite_mesa_projection_event_required(event)
    ]
    return {
        "sample_index": sample_index,
        "seed": seed,
        "sweep": {},
        "metrics": copy.deepcopy(execution["metrics"]),
        "daily_mission_reliability": daily_mission_reliability,
        "mission_wave_reliability": mission_wave_reliability,
        "period_outcome": period_outcome,
        "frames": frames,
        "events": projection_events,
        "downtime_events": copy.deepcopy(execution.get("downtime_events") or []),
        "lifecycle_trace": copy.deepcopy(execution.get("lifecycle_trace") or []),
        "organization_graph_identity": copy.deepcopy(execution["organization_graph_identity"]),
        "organization_dispatch_summary": copy.deepcopy(execution["organization_dispatch_summary"]),
    }


def _lite_mesa_projection_event_required(event: Any) -> bool:
    if not isinstance(event, dict):
        return False
    event_name = str(event.get("event") or event.get("event_type") or "")
    return event_name in {"spare_shortage", "spare_consumed"} or isinstance(event.get("snapshot"), dict)


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
        bucket["plannedWaves"] += 1
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
        bucket["plannedWaves"] += 1
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


def _sample_mission_wave_rows(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows_by_wave_position: dict[int, list[dict[str, Any]]] = {}
    for sample in samples:
        for wave_position, row in enumerate(sample.get("mission_wave_reliability") or []):
            day = max(1, _metric_int(row.get("dayIndex", row.get("day_index")), default=1))
            wave = max(1, _metric_int(row.get("waveIndex", row.get("wave_index")), default=1))
            planned_sorties = _metric_float(row.get("plannedSorties", row.get("planned_sorties")), default=0)
            launched_sorties = _metric_float(row.get("launchedSorties", row.get("launched_sorties")), default=0)
            planned_waves = _metric_float(row.get("plannedWaves", row.get("planned_waves")), default=0)
            successful_waves = _metric_float(row.get("successfulWaves", row.get("successful_waves")), default=0)
            mission_success = _clamp01(
                successful_waves / planned_waves
                if planned_waves > 0
                else row.get("missionSuccessRate", row.get("mission_success_rate", row.get("mean_mission_success_rate")))
            )
            sortie_rate = _clamp01(
                launched_sorties / planned_sorties
                if planned_sorties > 0
                else row.get("sortieRate", row.get("sortie_rate", row.get("mean_sortie_rate")))
            )
            rows_by_wave_position.setdefault(wave_position, []).append({
                "dayIndex": day,
                "waveIndex": wave,
                "waveKey": _mission_wave_key(day, wave),
                "waveLabel": _mission_wave_label(day, wave),
                "plannedSorties": planned_sorties,
                "launchedSorties": launched_sorties,
                "successfulSorties": _metric_float(row.get("successfulSorties", row.get("successful_sorties")), default=0),
                "plannedWaves": planned_waves,
                "successfulWaves": successful_waves,
                "meanMissionSuccessRate": mission_success,
                "missionSuccessRate": mission_success,
                "meanSortieRate": sortie_rate,
                "sortieRate": sortie_rate,
            })

    rows: list[dict[str, Any]] = []
    for wave_position in sorted(rows_by_wave_position):
        sample_rows = rows_by_wave_position[wave_position]
        reference = sample_rows[0]
        sample_count = len(sample_rows)
        mission_success_rate = sum(row["missionSuccessRate"] for row in sample_rows) / sample_count
        sortie_rate = sum(row["sortieRate"] for row in sample_rows) / sample_count
        rows.append({
            "sequence": wave_position + 1,
            "dayIndex": reference["dayIndex"],
            "waveIndex": reference["waveIndex"],
            "waveKey": reference["waveKey"],
            "waveLabel": reference["waveLabel"],
            "sampleCount": sample_count,
            "plannedSorties": sum(row["plannedSorties"] for row in sample_rows) / sample_count,
            "launchedSorties": sum(row["launchedSorties"] for row in sample_rows) / sample_count,
            "successfulSorties": sum(row["successfulSorties"] for row in sample_rows) / sample_count,
            "plannedWaves": sum(row["plannedWaves"] for row in sample_rows) / sample_count,
            "successfulWaves": sum(row["successfulWaves"] for row in sample_rows) / sample_count,
            "meanMissionSuccessRate": mission_success_rate,
            "missionSuccessRate": mission_success_rate,
            "meanSortieRate": sortie_rate,
            "sortieRate": sortie_rate,
        })
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
        aircraft_model = str(item.get("aircraft_model") or item.get("aircraftModel") or "").strip()
        spare_type = str(item.get("spare_type") or "").strip()
        if not aircraft_model or not spare_type:
            continue
        fill_rate = _metric_float(item.get("fill_rate"), default=aggregate.get("spare_fill_rate", 0))
        demand = max(0, int(round(_metric_float(item.get("demand_count"), default=planned))))
        filled = max(0, int(round(_metric_float(item.get("filled_count"), default=demand * fill_rate))))
        rows.append(
            {
                "aircraftModel": aircraft_model,
                "productId": str(item.get("product_id") or item.get("productId") or ""),
                "spareType": spare_type,
                "demand": demand,
                "filled": filled,
                "meanTransportDelayHours": _metric_float(item.get("mean_transport_delay"), default=mean_transport_delay),
                "fillRate": fill_rate,
                "riskLevel": _risk_label(item.get("risk_level")),
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
    minimum_satisfaction_rate = settings["missionConfidenceTarget"]
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
        recommended = max(
            0,
            _metric_int(
                item.get("recommended_quantity"),
                default=int(math.ceil((baseline_quantity or base_quantity) * multiplier)),
            ),
        )
        carried_quantity = _optional_nonnegative_metric_float(item.get("carried_quantity"))
        used_quantity = _optional_nonnegative_metric_float(item.get("used_quantity"))
        has_raw_quantities = carried_quantity is not None and used_quantity is not None
        legacy_utilization = (
            max(0.0, _metric_float(item.get("utilization"), default=0))
            if item.get("utilization") is not None
            else None
        )
        satisfaction_rate = _clamp01(
            item.get("satisfaction_rate", item.get("fill_rate", 1.0))
        )
        satisfaction_constraint_met = bool(
            item.get(
                "satisfaction_constraint_met",
                satisfaction_rate + 1e-12 >= minimum_satisfaction_rate,
            )
        )
        satisfaction_constraint_margin = _metric_float(
            item.get("satisfaction_constraint_margin"),
            default=satisfaction_rate - minimum_satisfaction_rate,
        )
        rows.append(
            {
                "aircraftModel": str(item.get("aircraft_model") or item.get("aircraftModel") or "全部机型"),
                "productId": str(item.get("product_id") or item.get("productId") or ""),
                "spareType": str(item.get("spare_type") or "aircraft_support_v1_spares"),
                "recommended": recommended,
                "usedQuantity": used_quantity,
                "carriedQuantity": carried_quantity,
                "demand": max(0, _metric_int(item.get("demand_count"), default=planned)),
                "shortage": max(0, _metric_int(item.get("shortage_count"), default=aggregate.get("shortage_events"))),
                "observedFilled": max(0, _metric_int(item.get("observed_filled_count"), default=0)),
                "observedShortage": max(0, _metric_int(item.get("observed_shortage_count"), default=0)),
                "observedFillRate": _clamp01(item.get("observed_fill_rate", satisfaction_rate)),
                "satisfactionRate": satisfaction_rate,
                "satisfactionConstraintMet": satisfaction_constraint_met,
                "satisfactionConstraintMargin": satisfaction_constraint_margin,
                "utilization": (
                    used_quantity / carried_quantity
                    if has_raw_quantities and carried_quantity > 0
                    else legacy_utilization if not has_raw_quantities else None
                ),
                "riskLevel": _risk_label(item.get("risk_level")),
                "confidenceTarget": minimum_satisfaction_rate,
                "minimumSatisfactionRate": minimum_satisfaction_rate,
                "hideZeroDemand": True,
                "lifeLimited": bool(item.get("life_limited") or item.get("lifeLimited")),
                "lifeLandings": _metric_int(item.get("life_landings", item.get("lifeLandings")), default=0),
                "lifeHours": _metric_int(item.get("life_hours", item.get("lifeHours")), default=0),
            }
        )
    has_complete_raw_quantities = bool(rows) and all(
        row.get("usedQuantity") is not None and row.get("carriedQuantity") is not None
        for row in rows
    )
    used_total = sum(float(row["usedQuantity"]) for row in rows) if has_complete_raw_quantities else None
    carried_total = sum(float(row["carriedQuantity"]) for row in rows) if has_complete_raw_quantities else None
    overall_utilization = (
        used_total / carried_total
        if has_complete_raw_quantities and carried_total is not None and carried_total > 0
        else None
    )
    overall_utilization_status = (
        "data_unavailable"
        if not has_complete_raw_quantities
        else "zero_carried" if carried_total == 0
        else "available"
    )
    overall_utilization_display = (
        f"{overall_utilization * 100:.2f}%"
        if overall_utilization_status == "available"
        else "--" if overall_utilization_status == "zero_carried"
        else "数据不可用"
    )
    constrained_rows = [row for row in rows if row["demand"] > 0]
    satisfied_constraint_count = sum(
        1 for row in constrained_rows if row["satisfactionConstraintMet"]
    )
    return {
        "experiment_id": "minimum_carry_list_search",
        "spare_used_total": used_total,
        "spare_carried_total": carried_total,
        "overall_spare_utilization": overall_utilization,
        "overall_spare_utilization_status": overall_utilization_status,
        "metrics": [
            ["建议携行总数", str(sum(int(row["recommended"]) for row in rows))],
            ["高优先级备件", str(sum(1 for row in rows if row["riskLevel"] == "高"))],
            ["满足下限备件", f"{satisfied_constraint_count}/{len(constrained_rows)}"],
            ["总体备件利用率", overall_utilization_display],
            ["备件满足率下限", f"{minimum_satisfaction_rate:.2f}"],
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
    rows = _sample_mission_wave_rows(samples)
    period_summary = period_completion_summary(samples)
    total_samples = period_summary["total_samples"]
    successful_samples = period_summary["successful_samples"]
    failed_samples = period_summary["failed_samples"]
    profile_reliability = _clamp01(data.get("mission_success_probability"))
    sortie_rate = max(0.0, _metric_float(data.get("sortie_rate"), default=0))
    period_completion_probability = period_summary["completion_probability"]
    period_duration_days = period_summary["duration_days"]
    result_fields = build_task_reliability_result_fields(
        sortie_rate=sortie_rate,
        wave_success_rate=profile_reliability,
        period_completion_probability=period_completion_probability,
        period_duration_days=period_duration_days,
    )
    return {
        "experiment_id": "project_baseline_at_current_granularity",
        "metrics": [
            *task_reliability_metrics(result_fields),
            ["仿真总次数", str(total_samples)],
            ["成功次数", str(successful_samples)],
        ],
        "result_fields": result_fields,
        "rows": rows,
        "wave_rows": rows,
        "daily_rows": _mean_daily_mission_reliability(samples),
        "sortie_rate": sortie_rate,
        "wave_success_rate": profile_reliability,
        "profile_reliability": profile_reliability,
        "period_completion_probability": period_completion_probability,
        "period_duration_days": period_duration_days,
        "total_samples": total_samples,
        "successful_samples": successful_samples,
        "failed_samples": failed_samples,
        "valid_samples": total_samples,
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
    event_details = _lite_mesa_downtime_event_details(samples)
    event_summary: dict[str, dict[str, float | int]] = {
        reason: {"event_count": 0, "downtime_hours": 0.0}
        for reason, _, _, _ in factor_specs
    }
    for event in event_details:
        reason = str(event.get("factor") or "")
        if reason not in event_summary:
            continue
        event_summary[reason]["event_count"] = int(event_summary[reason]["event_count"]) + 1
        event_summary[reason]["downtime_hours"] = float(event_summary[reason]["downtime_hours"]) + (
            max(0.0, _metric_float(event.get("duration_minutes"), default=0)) / 60.0
        )
    use_event_details = bool(event_details)
    total_hours = sum(
        float(event_summary[reason]["downtime_hours"])
        if use_event_details
        else max(0.0, _metric_float(aggregate.get(hours_key), default=0))
        for reason, _, _, hours_key in factor_specs
    )
    rows = []
    for reason, label, count_key, hours_key in factor_specs:
        downtime_hours = (
            float(event_summary[reason]["downtime_hours"])
            if use_event_details
            else max(0.0, _metric_float(aggregate.get(hours_key), default=0))
        )
        event_count = (
            int(event_summary[reason]["event_count"])
            if use_event_details
            else max(0, _metric_int(aggregate.get(count_key), default=0))
        )
        contribution = downtime_hours / total_hours if total_hours > 0 else 0.0
        rows.append({
            "label": label,
            "reason": reason,
            "count": event_count,
            "event_count": event_count,
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
        "event_details": event_details,
        "event_snapshots": _lite_mesa_downtime_event_snapshots(samples, top_n),
    }


def _lite_mesa_downtime_event_details(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for sample in samples:
        sample_index = _metric_int(sample.get("sample_index"), default=0)
        seed = sample.get("seed")
        for event in sample.get("downtime_events") or []:
            if not isinstance(event, dict):
                continue
            factor = str(event.get("factor") or "")
            if factor not in {"failure", "equipment_shortage", "spare_shortage", "preventive"}:
                continue
            item = normalize_downtime_event_for_analysis(event)
            item["sample_index"] = sample_index
            item["seed"] = seed
            item["source_event_id"] = str(event.get("event_id") or "")
            item["event_id"] = f"sample-{sample_index}-{item['source_event_id'] or len(details) + 1}"
            item["factor_label"] = _downtime_factor_label(factor)
            details.append(item)
    return sorted(
        details,
        key=lambda item: (
            _metric_int(item.get("sample_index"), default=0),
            _metric_float(item.get("start_minute"), default=0),
            str(item.get("event_id") or ""),
        ),
    )


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
    return sanitize_downtime_user_projection({
        "snapshot_id": f"lite-downtime-{seed or 'run'}-{ordinal:04d}",
        "source": "model_event_log",
        "sample_index": sample_index,
        "seed": seed,
        "sweep": sweep,
        "simulation_time": simulation_time,
        "event_type": event_type,
        "event_label": _downtime_factor_label(event_type),
        "event": sanitize_downtime_user_projection(event),
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
    })


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
        ("equipment_shortage", "downtime_equipment_shortage_events"),
        ("spare_shortage", "downtime_spare_shortage_events"),
        ("preventive", "downtime_preventive_events"),
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
    return sanitize_downtime_user_projection({
        "snapshot_id": f"lite-downtime-{seed or 'run'}-{ordinal:04d}",
        "source": "state_series_frame",
        "sample_index": sample_index,
        "seed": seed,
        "sweep": sweep,
        "simulation_time": simulation_time,
        "event_type": event_type,
        "event_label": _downtime_factor_label(event_type),
        "event": sanitize_downtime_user_projection(event),
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
    })


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
    if "preventive" in normalized:
        return "preventive"
    if "fail" in normalized:
        return "failure"
    return ""


def _lite_mesa_downtime_snapshot_result(event_type: str) -> str:
    if event_type == "spare_shortage":
        return "mission_delayed_by_spare_shortage"
    if event_type == "equipment_shortage":
        return "mission_delayed_by_equipment_shortage"
    if event_type == "preventive":
        return "aircraft_unavailable_for_preventive_maintenance"
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
        "event_details": [],
        "event_snapshots": [],
        "metric_moments": build_monte_carlo_metric_moments(
            [],
            total_sample_count=settings["samples"],
            failed_sample_count=0,
        ),
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


def _optional_nonnegative_metric_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed >= 0 else None


def _clamp01(value: Any) -> float:
    return min(1.0, max(0.0, _metric_float(value, default=0)))


def _sample_mean(samples: list[dict[str, Any]], metric: str) -> float:
    if not samples:
        return 0.0
    return sum(_metric_float(sample.get("metrics", {}).get(metric), default=0) for sample in samples) / len(samples)


def _sample_metric_sum(samples: list[dict[str, Any]], metric: str) -> float:
    return sum(_metric_float(sample.get("metrics", {}).get(metric), default=0) for sample in samples)


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
        "failure": "装备故障",
        "spare_shortage": "备件短缺",
        "equipment_shortage": "保障设备短缺",
        "resource_delay": "资源等待",
        "postflight": "飞后积压",
        "preventive": "预防性维修",
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


def _project_compile_preflight_issue(issue: Any) -> dict[str, Any]:
    value = issue if isinstance(issue, dict) else {}
    return {
        "code": str(value.get("code") or "compile_gate_blocked"),
        "message": str(value.get("message") or "Project did not pass the Scenario compiler gate."),
        "field_path": str(value.get("field_path") or value.get("path") or "Project JSON"),
        "page": str(value.get("page") or "Project JSON"),
        "severity": str(value.get("severity") or "error"),
        "suggestion": str(value.get("suggestion") or "修正输入后重新执行运行编译预检。"),
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
        airports = payload.get("airports")
        first_airport = airports[0] if isinstance(airports, list) and airports else None
        base_code = first_airport.get("airportCode") if isinstance(first_airport, dict) else ""
    if not isinstance(base_code, str) or not base_code.strip():
        base_code = str(payload.get("scenarioId") or payload.get("project_id") or project.get("project_id") or "NB")

    summary = payload.get("projectInfo", {}).get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = "后端持久化项目"
    project_info = payload.get("projectInfo") if isinstance(payload.get("projectInfo"), dict) else {}
    template_flags = (
        project_info.get("isTemplate"),
        project_info.get("is_template"),
        payload.get("isTemplate"),
        payload.get("is_template"),
    )
    is_template = next((value for value in template_flags if isinstance(value, bool)), False)

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
